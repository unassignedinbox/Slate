// Minimal software rasteriser + PNG writer.
// Dev-only tool: lets us eyeball the low-poly geometry from Node, since the
// sandbox has no GPU and cannot download a headless browser.
import zlib from 'node:zlib';
import * as THREE from 'three';

/* ------------------------------ PNG ------------------------------ */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

export function encodePNG(width, height, rgb) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgb.buffer, y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* --------------------------- Rasteriser --------------------------- */

export class Raster {
  constructor(width, height, opts = {}) {
    this.w = width;
    this.h = height;
    this.color = new Float32Array(width * height * 3);
    this.depth = new Float32Array(width * height).fill(Infinity);
    this.sun = (opts.sun || new THREE.Vector3(-0.34, 0.38, 0.78)).clone().normalize();
    this.ambient = opts.ambient || new THREE.Color(0.42, 0.47, 0.53);
    this.sunColor = opts.sunColor || new THREE.Color(1.0, 0.94, 0.84);
    this.fogColor = opts.fogColor || new THREE.Color(0.66, 0.72, 0.77);
    this.fogNear = opts.fogNear ?? 260;
    this.fogFar = opts.fogFar ?? 1150;
    this.tris = 0;
  }

  clearSky(topColor, horizonColor, bottomColor, camera) {
    const top = new THREE.Color(topColor);
    const hor = new THREE.Color(horizonColor);
    const bot = new THREE.Color(bottomColor);
    const dir = new THREE.Vector3();
    const inv = new THREE.Matrix4().copy(camera.projectionMatrixInverse);
    const camWorld = camera.matrixWorld;
    const v = new THREE.Vector3();
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        const ndcX = (x / this.w) * 2 - 1;
        const ndcY = 1 - (y / this.h) * 2;
        v.set(ndcX, ndcY, 0.5).applyMatrix4(inv);
        dir.copy(v).normalize().transformDirection(camWorld);
        const t = dir.y;
        const c = new THREE.Color();
        if (t >= 0) c.copy(hor).lerp(top, Math.min(1, Math.max(0, t / 0.55)) ** 0.9);
        else c.copy(hor).lerp(bot, Math.min(1, -t / 0.3));
        const i = (y * this.w + x) * 3;
        this.color[i] = c.r;
        this.color[i + 1] = c.g;
        this.color[i + 2] = c.b;
      }
    }
  }

  /** Draw one world-space triangle with flat shading. */
  triangle(a, b, c, baseColor, viewProj, alpha = 1, unlit = false) {
    // Backface-independent flat normal.
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const acx = c.x - a.x, acy = c.y - a.y, acz = c.z - a.z;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    const p = [a, b, c].map((v) => {
      const x = v.x * viewProj.elements[0] + v.y * viewProj.elements[4] + v.z * viewProj.elements[8] + viewProj.elements[12];
      const y = v.x * viewProj.elements[1] + v.y * viewProj.elements[5] + v.z * viewProj.elements[9] + viewProj.elements[13];
      const z = v.x * viewProj.elements[2] + v.y * viewProj.elements[6] + v.z * viewProj.elements[10] + viewProj.elements[14];
      const w = v.x * viewProj.elements[3] + v.y * viewProj.elements[7] + v.z * viewProj.elements[11] + viewProj.elements[15];
      return { x, y, z, w };
    });
    if (p[0].w <= 0.05 || p[1].w <= 0.05 || p[2].w <= 0.05) return; // skip near-plane clipping

    const s = p.map((q) => ({
      x: (q.x / q.w * 0.5 + 0.5) * this.w,
      y: (1 - (q.y / q.w * 0.5 + 0.5)) * this.h,
      z: q.w,
    }));

    let minX = Math.max(0, Math.floor(Math.min(s[0].x, s[1].x, s[2].x)));
    let maxX = Math.min(this.w - 1, Math.ceil(Math.max(s[0].x, s[1].x, s[2].x)));
    let minY = Math.max(0, Math.floor(Math.min(s[0].y, s[1].y, s[2].y)));
    let maxY = Math.min(this.h - 1, Math.ceil(Math.max(s[0].y, s[1].y, s[2].y)));
    if (minX > maxX || minY > maxY) return;

    const area = (s[1].x - s[0].x) * (s[2].y - s[0].y) - (s[1].y - s[0].y) * (s[2].x - s[0].x);
    if (Math.abs(area) < 1e-9) return;
    this.tris++;

    // Lighting (two-sided so we do not care about winding).
    let diff = nx * this.sun.x + ny * this.sun.y + nz * this.sun.z;
    diff = Math.abs(diff) * 0.15 + Math.max(0, diff) * 0.85;
    const up = Math.max(0, ny) * 0.25;
    const r0 = baseColor.r, g0 = baseColor.g, b0 = baseColor.b;
    let rr, gg, bb;
    if (unlit) {
      rr = r0; gg = g0; bb = b0;
    } else {
      rr = r0 * (this.ambient.r + up * 0.14 + this.sunColor.r * diff * 0.82);
      gg = g0 * (this.ambient.g + up * 0.14 + this.sunColor.g * diff * 0.82);
      bb = b0 * (this.ambient.b + up * 0.14 + this.sunColor.b * diff * 0.82);
    }

    const invArea = 1 / area;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const w0 = ((s[1].x - s[0].x) * (py - s[0].y) - (s[1].y - s[0].y) * (px - s[0].x)) * invArea;
        const w1 = ((px - s[0].x) * (s[2].y - s[0].y) - (py - s[0].y) * (s[2].x - s[0].x)) * invArea;
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
        const depth = s[0].z + w1 * (s[1].z - s[0].z) + w0 * (s[2].z - s[0].z);
        const idx = y * this.w + x;
        if (depth >= this.depth[idx]) continue;

        // Fog
        const f = Math.min(1, Math.max(0, (depth - this.fogNear) / (this.fogFar - this.fogNear)));
        let cr = rr * (1 - f) + this.fogColor.r * f;
        let cg = gg * (1 - f) + this.fogColor.g * f;
        let cb = bb * (1 - f) + this.fogColor.b * f;

        const o = idx * 3;
        if (alpha >= 1) {
          this.depth[idx] = depth;
          this.color[o] = cr;
          this.color[o + 1] = cg;
          this.color[o + 2] = cb;
        } else {
          this.color[o] = this.color[o] * (1 - alpha) + cr * alpha;
          this.color[o + 1] = this.color[o + 1] * (1 - alpha) + cg * alpha;
          this.color[o + 2] = this.color[o + 2] * (1 - alpha) + cb * alpha;
        }
      }
    }
  }

  /** Walk a three.js scene graph and rasterise every mesh. */
  renderScene(scene, camera, opts = {}) {
    scene.updateMatrixWorld(true);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
    const viewProj = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse
    );
    const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProj);

    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const m = new THREE.Matrix4();
    const instMatrix = new THREE.Matrix4();
    const sphere = new THREE.Sphere();
    const transparents = [];

    const faceColor = new THREE.Color();
    const drawMesh = (mesh, matrix, color, alpha, unlit) => {
      const geo = mesh.geometry;
      const pos = geo.attributes.position;
      if (!pos) return;
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const vcol = material && material.vertexColors ? geo.attributes.color : null;
      const index = geo.index;
      const count = index ? index.count : pos.count;
      for (let i = 0; i < count; i += 3) {
        const i0 = index ? index.getX(i) : i;
        const i1 = index ? index.getX(i + 1) : i + 1;
        const i2 = index ? index.getX(i + 2) : i + 2;
        a.fromBufferAttribute(pos, i0).applyMatrix4(matrix);
        b.fromBufferAttribute(pos, i1).applyMatrix4(matrix);
        c.fromBufferAttribute(pos, i2).applyMatrix4(matrix);
        let col = color;
        if (vcol) {
          faceColor.setRGB(
            (vcol.getX(i0) + vcol.getX(i1) + vcol.getX(i2)) / 3,
            (vcol.getY(i0) + vcol.getY(i1) + vcol.getY(i2)) / 3,
            (vcol.getZ(i0) + vcol.getZ(i1) + vcol.getZ(i2)) / 3
          );
          col = faceColor;
        }
        this.triangle(a, b, c, col, viewProj, alpha, unlit);
      }
    };

    scene.traverseVisible((obj) => {
      if (!obj.isMesh) return;
      if (opts.skip && opts.skip(obj)) return;
      const material = Array.isArray(obj.material) ? obj.material[0] : obj.material;
      if (!material) return;
      let color = material.color ? material.color.clone() : new THREE.Color(0xcccccc);
      if (obj.name === 'ocean' && opts.waterColor) color = new THREE.Color(opts.waterColor);
      const alpha = material.transparent ? Math.min(1, material.opacity ?? 1) : 1;
      if (alpha < 0.03) return;
      const unlit = !!material.isMeshBasicMaterial;

      if (obj.isInstancedMesh) {
        for (let i = 0; i < obj.count; i++) {
          obj.getMatrixAt(i, instMatrix);
          m.multiplyMatrices(obj.matrixWorld, instMatrix);
          if (obj.geometry.boundingSphere === null) obj.geometry.computeBoundingSphere();
          sphere.copy(obj.geometry.boundingSphere).applyMatrix4(m);
          if (!frustum.intersectsSphere(sphere)) continue;
          if (alpha < 1) transparents.push({ mesh: obj, matrix: m.clone(), color, alpha, unlit });
          else drawMesh(obj, m, color, alpha, unlit);
        }
        return;
      }

      if (obj.geometry.boundingSphere === null) obj.geometry.computeBoundingSphere();
      if (obj.geometry.boundingSphere) {
        sphere.copy(obj.geometry.boundingSphere).applyMatrix4(obj.matrixWorld);
        if (sphere.radius < 2000 && !frustum.intersectsSphere(sphere)) return;
      }
      if (alpha < 1) {
        transparents.push({ mesh: obj, matrix: obj.matrixWorld.clone(), color, alpha, unlit });
      } else {
        drawMesh(obj, obj.matrixWorld, color, alpha, unlit);
      }
    });

    for (const t of transparents) drawMesh(t.mesh, t.matrix, t.color, t.alpha, t.unlit);
  }

  toPNG(exposure = 1.0) {
    const out = new Uint8Array(this.w * this.h * 3);
    for (let i = 0; i < this.color.length; i++) {
      let v = this.color[i] * exposure;
      // Cheap filmic-ish curve so it reads like the in-game tone mapping.
      v = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
      v = Math.pow(Math.min(1, Math.max(0, v)), 1 / 2.2);
      out[i] = Math.round(v * 255);
    }
    return encodePNG(this.w, this.h, out);
  }
}
