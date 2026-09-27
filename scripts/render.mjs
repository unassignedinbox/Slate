// Offline software rasteriser: renders the real three.js scene graph to a PNG
// so the build can be eyeballed without a browser. Flat shading + z-buffer +
// fog, which is exactly how the game looks in WebGL.
import * as THREE from 'three';
import zlib from 'node:zlib';
import fs from 'node:fs';
import { Game } from '../src/game.js';

const W = +(process.env.W || 1120);
const H = +(process.env.H || 630);

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunks = [];
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crcTable = png._crc || (png._crc = (() => {
      const t = new Int32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
      }
      return t;
    })());
    let crc = -1;
    for (const b of body) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeInt32BE(crc ^ -1);
    chunks.push(len, body, crcBuf);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  chunk('IHDR', ihdr);
  chunk('IDAT', zlib.deflateSync(raw, { level: 6 }));
  chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]);
}

export function renderScene(scene, camera, opts = {}) {
  const width = opts.width || W;
  const height = opts.height || H;
  const buf = Buffer.alloc(width * height * 3);
  const depth = new Float32Array(width * height).fill(Infinity);

  // match the WebGL pipeline: ACES filmic tone map then linear -> sRGB
  const aces = (x) => {
    x *= 1.08;
    const a = 2.51, b2 = 0.03, c2 = 2.43, d2 = 0.59, e2 = 0.14;
    return Math.min(1, Math.max(0, (x * (a * x + b2)) / (x * (c2 * x + d2) + e2)));
  };
  const encode = (x) => {
    const v = aces(x);
    return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  };
  const sky = scene.background ? scene.background : new THREE.Color(0x9fb4c0);
  const fog = scene.fog;
  for (let i = 0; i < width * height; i++) {
    const t = i / (width * height);
    buf[i * 3] = encode(sky.r * (0.92 + t * 0.16));
    buf[i * 3 + 1] = encode(sky.g * (0.92 + t * 0.16));
    buf[i * 3 + 2] = encode(sky.b * (0.92 + t * 0.16));
  }

  camera.updateMatrixWorld(true);
  scene.updateMatrixWorld(true);
  const vp = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  const L = new THREE.Vector3(-150, 210, 130).normalize();
  const camPos = camera.position;

  const meshes = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (o.name === 'sky') return;
    if (o.material && o.material.transparent && (o.material.opacity ?? 1) < 0.45) return;
    meshes.push(o);
  });

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const n = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const cl = [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()];
  const fogColor = fog ? fog.color : null;
  let drawn = 0;

  const tri = (mesh, m, pos, col, i0, i1, i2, matColor, hasVC, unlit) => {
    a.fromBufferAttribute(pos, i0).applyMatrix4(m);
    b.fromBufferAttribute(pos, i1).applyMatrix4(m);
    c.fromBufferAttribute(pos, i2).applyMatrix4(m);
    e1.subVectors(b, a);
    e2.subVectors(c, a);
    n.crossVectors(e1, e2);
    if (n.lengthSq() < 1e-12) return;
    n.normalize();

    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      cl[k].set(v.x, v.y, v.z, 1).applyMatrix4(vp);
      if (cl[k].w <= 0.02) return; // behind the eye - skip (cheap near clip)
    }
    const sx = [], sy = [], sz = [];
    for (let k = 0; k < 3; k++) {
      const iw = 1 / cl[k].w;
      sx.push((cl[k].x * iw * 0.5 + 0.5) * width);
      sy.push((1 - (cl[k].y * iw * 0.5 + 0.5)) * height);
      sz.push(cl[k].z * iw);
    }
    let minX = Math.max(0, Math.floor(Math.min(sx[0], sx[1], sx[2])));
    let maxX = Math.min(width - 1, Math.ceil(Math.max(sx[0], sx[1], sx[2])));
    let minY = Math.max(0, Math.floor(Math.min(sy[0], sy[1], sy[2])));
    let maxY = Math.min(height - 1, Math.ceil(Math.max(sy[0], sy[1], sy[2])));
    if (minX > maxX || minY > maxY) return;

    const area = (sx[1] - sx[0]) * (sy[2] - sy[0]) - (sx[2] - sx[0]) * (sy[1] - sy[0]);
    if (Math.abs(area) < 1e-8) return;

    // shading: two-sided (the renderer culls backfaces, we just light both
    // sides so flipped normals show up as *wrong* rather than invisible)
    let nd = n.dot(L);
    const facing = n.clone().dot(new THREE.Vector3().subVectors(camPos, a).normalize());
    if (facing < 0) nd = -nd;
    const lambert = Math.max(0, nd);
    const sky01 = 0.5 + 0.5 * (facing < 0 ? -n.y : n.y);
    let r, g, bl;
    if (hasVC && col) {
      r = (col.getX(i0) + col.getX(i1) + col.getX(i2)) / 3;
      g = (col.getY(i0) + col.getY(i1) + col.getY(i2)) / 3;
      bl = (col.getZ(i0) + col.getZ(i1) + col.getZ(i2)) / 3;
    } else {
      r = matColor.r; g = matColor.g; bl = matColor.b;
    }
    const amb = 0.34 + 0.42 * sky01;
    const li = unlit ? 1 : amb + lambert * 1.05;
    r *= li; g *= li; bl *= li;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let w0 = ((sx[1] - sx[0]) * (py - sy[0]) - (sy[1] - sy[0]) * (px - sx[0])) / area;
        let w1 = ((sx[2] - sx[1]) * (py - sy[1]) - (sy[2] - sy[1]) * (px - sx[1])) / area;
        let w2 = ((sx[0] - sx[2]) * (py - sy[2]) - (sy[0] - sy[2]) * (px - sx[2])) / area;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const l0 = w1, l1 = w2, l2 = w0;
        const z = sz[0] * l0 + sz[1] * l1 + sz[2] * l2;
        const idx = y * width + x;
        if (z >= depth[idx]) continue;
        depth[idx] = z;
        let rr = r, gg = g, bb = bl;
        if (fogColor) {
          const wz = cl[0].w * l0 + cl[1].w * l1 + cl[2].w * l2;
          const f = Math.min(1, Math.max(0, (wz - fog.near) / (fog.far - fog.near)));
          rr = rr * (1 - f) + fogColor.r * f;
          gg = gg * (1 - f) + fogColor.g * f;
          bb = bb * (1 - f) + fogColor.b * f;
        }
        buf[idx * 3] = encode(rr);
        buf[idx * 3 + 1] = encode(gg);
        buf[idx * 3 + 2] = encode(bb);
      }
    }
    drawn++;
  };

  const instMat = new THREE.Matrix4();
  const finalMat = new THREE.Matrix4();
  for (const mesh of meshes) {
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    if (!pos) continue;
    const col = geo.attributes.color;
    const hasVC = !!(mesh.material.vertexColors && col);
    let matColor = mesh.material.color || new THREE.Color(0xffffff);
    const unlit = !!mesh.material.isMeshBasicMaterial;
    const instColor = mesh.instanceColor;
    const index = geo.index;
    const count = index ? index.count : pos.count;
    const instances = mesh.isInstancedMesh ? mesh.count : 1;
    // frustum reject by bounding sphere
    if (!mesh.isInstancedMesh) {
      if (!geo.boundingSphere) geo.computeBoundingSphere();
      const s = geo.boundingSphere.clone().applyMatrix4(mesh.matrixWorld);
      const d = s.center.distanceTo(camPos);
      if (fog && d - s.radius > fog.far) continue;
    }
    for (let inst = 0; inst < instances; inst++) {
      if (mesh.isInstancedMesh) {
        mesh.getMatrixAt(inst, instMat);
        finalMat.multiplyMatrices(mesh.matrixWorld, instMat);
        if (Math.abs(instMat.elements[0]) < 1e-6 && Math.abs(instMat.elements[5]) < 1e-6) continue;
      } else {
        finalMat.copy(mesh.matrixWorld);
      }
      if (instColor) {
        matColor = new THREE.Color(
          instColor.array[inst * 3],
          instColor.array[inst * 3 + 1],
          instColor.array[inst * 3 + 2],
        ).multiply(mesh.material.color || new THREE.Color(0xffffff));
      }
      for (let i = 0; i < count; i += 3) {
        const i0 = index ? index.getX(i) : i;
        const i1 = index ? index.getX(i + 1) : i + 1;
        const i2 = index ? index.getX(i + 2) : i + 2;
        tri(mesh, finalMat, pos, col, i0, i1, i2, matColor, hasVC, unlit);
      }
    }
  }
  return { buf, width, height, drawn };
}

export function save(path, r) {
  fs.writeFileSync(path, png(r.width, r.height, r.buf));
  console.log('wrote', path, r.drawn, 'tris');
}

// --- CLI: render a set of set-piece shots --------------------------------
if (process.argv[1].endsWith('render.mjs')) {
  const game = new Game(null, null, null, { headless: true });
  await game.load();
  const { scene, camera, field, roads, car } = game;
  game.start();
  for (let i = 0; i < 12; i++) game.step(1 / 60);

  const shots = JSON.parse(process.env.SHOTS || '[]');
  const put = (name, from, to, fov = 60) => {
    camera.fov = fov;
    camera.position.set(...from);
    camera.lookAt(...to);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    const t = Date.now();
    save(`shots/${name}.png`, renderScene(scene, camera));
    console.log('  ', (Date.now() - t) / 1000 + 's');
  };
  fs.mkdirSync('shots', { recursive: true });

  const at = (t, lat = 0) => {
    const s = roads.main.at(t);
    return [s.x + s.nx * lat, s.z + s.nz * lat];
  };
  const y = (x, z, h) => field.height(x, z) + h;

  const only = process.env.SHOT ? process.env.SHOT.split(',') : null;
  const want = (n) => !only || only.includes(n);

  // 1: the car, close up
  if (want('car')) {
    const [cx, cz] = [car.pos.x, car.pos.z];
    put('car', [cx + 5.5, y(cx, cz, 2.2), cz + 6.5], [cx, y(cx, cz, 0.9), cz]);
  }
  // 2: the surf, looking back out to sea from the beach
  if (want('surf')) {
    const [cx, cz] = [car.pos.x, car.pos.z];
    put('surf', [cx - 6, y(cx, cz, 7), cz - 26], [cx, y(cx, cz, 0) + 2, cz + 120], 66);
  }
  // 3: chase view off the beach
  if (want('beach')) {
    const [cx, cz] = [car.pos.x, car.pos.z];
    put('beach', [cx + 2, y(cx, cz, 5), cz + 12], [cx - 30, y(cx, cz, 1), cz - 90]);
  }
  if (want('hairpin')) {
    const [rx, rz] = at(0.33);
    put('hairpin', [rx + 40, y(rx, rz, 60), rz + 90], [rx, y(rx, rz, 0), rz - 30]);
  }
  if (want('bunker')) {
    const b = game.layout.bunkers[3];
    put('bunker', [b.x + 14, y(b.x, b.z, 6), b.z + 20], [b.x, y(b.x, b.z, 2.5), b.z]);
  }
  if (want('wall')) put('wall', [0, y(0, -2560, 26), -2480], [0, y(0, -2690, 14), -2700], 62);
  if (want('ridge')) {
    const [tx, tz] = at(0.66, 40);
    put('ridge', [tx + 25, y(tx, tz, 12), tz + 45], [tx, y(tx, tz, 1), tz - 20]);
  }
  // driver's eye on a mined chokepoint
  if (want('mines')) {
    const [mx, mz] = at(0.862, 2);
    const [ax, az] = at(0.845, 1);
    put('mines', [ax, y(ax, az, 2.6), az], [mx, y(mx, mz, 0.6), mz], 58);
  }
  // the tank park
  if (want('park')) {
    const [px, pz] = at(0.53, 92);
    put('park', [px + 30, y(px, pz, 14), pz + 46], [px, y(px, pz, 2), pz], 60);
  }
  // obstacle detail: concertina wire
  if (want('detail')) {
    const run = game.layout.wire.find((r) => r.kind === 'concertina');
    const w = run.points[Math.floor(run.points.length / 2)];
    put('detail', [w.x + 6, y(w.x, w.z, 2.0), w.z + 7], [w.x, y(w.x, w.z, 0.7), w.z], 46);
  }
  // a field repair dump beside the road
  if (want('depot')) {
    const d = game.depots[2];
    put('depot', [d.x + 7, y(d.x, d.z, 3.2), d.z + 9], [d.x, y(d.x, d.z, 1.1), d.z], 48);
  }
  // teller mine, hedgehog and teeth at eye level
  if (want('detail2')) {
    const m = game.layout.mines.find((mm) => mm.kind === 'tank');
    put('detail2', [m.x + 3.2, y(m.x, m.z, 1.5), m.z + 4.2], [m.x, y(m.x, m.z, 0.3), m.z], 42);
  }
  if (want('detail3')) {
    const h = game.layout.hedgehogs[40];
    put('detail3', [h.x + 6, y(h.x, h.z, 3), h.z + 8], [h.x, y(h.x, h.z, 1.2), h.z], 46);
  }
  // under fire: tracers in flight and a shell burst
  if (want('combat')) {
    const t0 = 0.805;
    const s0 = roads.main.at(t0);
    car.pos.set(s0.x, field.height(s0.x, s0.z), s0.z);
    car.yaw = Math.atan2(s0.dx, s0.dz);
    car.speed = 26;
    game.input.throttle = 1;
    for (let i = 0; i < 400; i++) game.step(1 / 60);
    game.effects.explosion(new THREE.Vector3(car.pos.x + 9, car.pos.y + 1.2, car.pos.z - 34), 2.2);
    game.effects.explosion(new THREE.Vector3(car.pos.x - 16, car.pos.y + 1.2, car.pos.z - 58), 1.6);
    for (let i = 0; i < 18; i++) game.step(1 / 60);
    const live = game.bullets.bullets.filter((b) => b.alive).length;
    console.log('   tracers in flight:', live, 'particles:', game.effects.p.filter((p) => p.alive).length);
    const cx = car.pos.x, cz = car.pos.z;
    put('combat', [cx - Math.sin(car.yaw) * 11 + 3, y(cx, cz, 4.4), cz - Math.cos(car.yaw) * 11],
        [cx + Math.sin(car.yaw) * 22, y(cx, cz, 2.2), cz + Math.cos(car.yaw) * 22], 64);
  }
  // aircraft attack run
  if (want('air')) {
    game.planes.launch(car, 1);
    for (let i = 0; i < 260; i++) game.step(1 / 60);
    const p = game.planes.planes[0];
    if (p) {
      put('air', [p.pos.x + 26, p.pos.y + 9, p.pos.z + 34], [p.pos.x, p.pos.y, p.pos.z], 55);
    }
  }
}
