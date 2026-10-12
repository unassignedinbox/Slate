/* ============================================================================
   MeshSink — geometry accumulator.

   Everything generated for a chunk funnels into one sink keyed by material.
   At build time each key becomes a single merged BufferGeometry, so a whole
   city block of road, kerb, markings and rails is a handful of draw calls.

   Vertex layout: position(3) + normal(3) + uv(2). No vertex colours —
   surfacing is done by material + tiling textures authored in metres.
   ========================================================================== */

import * as THREE from 'three';

class Bucket {
  constructor(key) {
    this.key = key;
    this.pos = [];
    this.nor = [];
    this.uv = [];
    this.idx = [];
    this.n = 0;
  }
  vert(x, y, z, nx, ny, nz, u, v) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    return this.n++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); }
  get empty() { return this.idx.length === 0; }
}

export class MeshSink {
  constructor() {
    this.buckets = new Map();
  }

  b(key) {
    let bk = this.buckets.get(key);
    if (!bk) { bk = new Bucket(key); this.buckets.set(key, bk); }
    return bk;
  }

  get triCount() {
    let t = 0;
    for (const b of this.buckets.values()) t += b.idx.length / 3;
    return Math.floor(t);
  }
  get vertCount() {
    let t = 0;
    for (const b of this.buckets.values()) t += b.n;
    return t;
  }

  /* ------------------------------------------------------------ primitives */

  /** Quad with per-vertex normals + uvs. Winding a->b->c->d. */
  quad(key, P, N, UV) {
    const bk = this.b(key);
    const i0 = bk.vert(P[0], P[1], P[2], N[0], N[1], N[2], UV[0], UV[1]);
    const i1 = bk.vert(P[3], P[4], P[5], N[3], N[4], N[5], UV[2], UV[3]);
    const i2 = bk.vert(P[6], P[7], P[8], N[6], N[7], N[8], UV[4], UV[5]);
    const i3 = bk.vert(P[9], P[10], P[11], N[9], N[10], N[11], UV[6], UV[7]);
    bk.tri(i0, i1, i2); bk.tri(i0, i2, i3);
  }

  /** Flat quad from 4 world points; normal derived, uv from metres. */
  flatQuad(key, a, b, c, d, uScale = 1, vScale = 1, uOff = 0, vOff = 0, flip = false) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const adx = d.x - a.x, ady = d.y - a.y, adz = d.z - a.z;
    let nx = aby * adz - abz * ady;
    let ny = abz * adx - abx * adz;
    let nz = abx * ady - aby * adx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    if (flip) { nx = -nx; ny = -ny; nz = -nz; }
    const lab = Math.hypot(abx, aby, abz);
    const lad = Math.hypot(adx, ady, adz);
    const P = [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z];
    const N = [nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz];
    const UV = [
      uOff, vOff,
      uOff + lab * uScale, vOff,
      uOff + lab * uScale, vOff + lad * vScale,
      uOff, vOff + lad * vScale,
    ];
    this.quad(key, P, N, UV);
  }

  tri(key, a, b, c, n, uv) {
    const bk = this.b(key);
    const i0 = bk.vert(a.x, a.y, a.z, n.x, n.y, n.z, uv[0], uv[1]);
    const i1 = bk.vert(b.x, b.y, b.z, n.x, n.y, n.z, uv[2], uv[3]);
    const i2 = bk.vert(c.x, c.y, c.z, n.x, n.y, n.z, uv[4], uv[5]);
    bk.tri(i0, i1, i2);
  }

  /**
   * Extrude a closed 2D profile (array of {x,y}) along a path of frames.
   * `frames` = [{ origin{THREE.Vector3}, right, up, forward, s }]
   * Profile is in local (right, up). Used for rails, parapets, piers, pipes.
   */
  extrude(key, profile, frames, { uvScale = 1, caps = false, closedProfile = true, facing = null } = {}) {
    const bk = this.b(key);
    const m = profile.length;
    const fm = frames.length;
    if (m < 3 || fm < 2) return;
    const base = bk.n;
    const idxFrom = bk.idx.length;
    for (let f = 0; f < fm; f++) {
      const fr = frames[f];
      for (let i = 0; i < m; i++) {
        const p = profile[i];
        bk.vert(
          fr.o.x + fr.r.x * p.x + fr.u.x * p.y,
          fr.o.y + fr.r.y * p.x + fr.u.y * p.y,
          fr.o.z + fr.r.z * p.x + fr.u.z * p.y,
          0, 0, 0,
          (i / m) * uvScale, fr.s * uvScale,
        );
      }
    }
    for (let f = 0; f < fm - 1; f++) {
      for (let i = 0; i < m; i++) {
        const i0 = base + f * m + i;
        const i1 = base + f * m + ((i + 1) % m);
        const i2 = base + (f + 1) * m + i;
        const i3 = base + (f + 1) * m + ((i + 1) % m);
        if (closedProfile || i < m - 1) {
          bk.tri(i0, i2, i1);
          bk.tri(i1, i2, i3);
        }
      }
    }
    if (facing && frames.length > 1) {
      // orient each quad radially about its own frame origin, so closed
      // profiles (rails, wires, parapets) face out — or in, for a tunnel bore
      const sign = facing === 'in' ? -1 : 1;
      const m2 = profile.length;
      for (let t = idxFrom; t < bk.idx.length; t += 3) {
        const v0 = bk.idx[t] - base;
        const fi = Math.min(frames.length - 1, Math.max(0, Math.floor(v0 / m2)));
        const o = frames[fi].o;
        const ax = bk.pos[bk.idx[t] * 3], ay = bk.pos[bk.idx[t] * 3 + 1], az = bk.pos[bk.idx[t] * 3 + 2];
        const bx = bk.pos[bk.idx[t + 1] * 3], by = bk.pos[bk.idx[t + 1] * 3 + 1], bz = bk.pos[bk.idx[t + 1] * 3 + 2];
        const cx = bk.pos[bk.idx[t + 2] * 3], cy = bk.pos[bk.idx[t + 2] * 3 + 1], cz = bk.pos[bk.idx[t + 2] * 3 + 2];
        const ux = bx - ax, uy = by - ay, uz = bz - az;
        const vx = cx - ax, vy = cy - ay, vz = cz - az;
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const mx = (ax + bx + cx) / 3 - o.x;
        const my = (ay + by + cy) / 3 - o.y;
        const mz = (az + bz + cz) / 3 - o.z;
        if ((nx * mx + ny * my + nz * mz) * sign < 0) {
          const tmp = bk.idx[t + 1]; bk.idx[t + 1] = bk.idx[t + 2]; bk.idx[t + 2] = tmp;
        }
      }
    }

    if (caps) {
      for (const [f, flip] of [[0, true], [fm - 1, false]]) {
        // fan cap
        const c0 = bk.vert(frames[f].o.x, frames[f].o.y, frames[f].o.z, 0, 0, 0, 0.5, 0.5);
        const ring = [];
        for (let i = 0; i < m; i++) {
          const fr = frames[f];
          const p = profile[i];
          ring.push(bk.vert(
            fr.o.x + fr.r.x * p.x + fr.u.x * p.y,
            fr.o.y + fr.r.y * p.x + fr.u.y * p.y,
            fr.o.z + fr.r.z * p.x + fr.u.z * p.y, 0, 0, 0, p.x * 0.5 + 0.5, p.y * 0.5 + 0.5,
          ));
        }
        for (let i = 0; i < m; i++) {
          const a = ring[i], b2 = ring[(i + 1) % m];
          if (flip) bk.tri(c0, b2, a); else bk.tri(c0, a, b2);
        }
      }
    }
    this._computeRangeNormals(bk, base);
  }

  /**
   * Start a strip: snapshot the vertex + index cursor so normals can be
   * recomputed for just this strip. Without the index cursor the cost is
   * O(total indices) per strip, i.e. quadratic over a whole city.
   */
  mark(bk) { return { v: bk.n, i: bk.idx.length }; }

  /** Recompute smooth normals for vertices/indices added since `mark`. */
  _computeRangeNormals(bk, from, idxFrom = 0) {
    const nrm = bk.nor, pos = bk.pos;
    for (let i = from; i < bk.n; i++) { nrm[i * 3] = 0; nrm[i * 3 + 1] = 0; nrm[i * 3 + 2] = 0; }
    const idx = bk.idx;
    for (let i = idxFrom; i < idx.length; i += 3) {
      const a = idx[i], b = idx[i + 1], c = idx[i + 2];
      if (a < from || b < from || c < from) continue;
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      nrm[a * 3] += nx; nrm[a * 3 + 1] += ny; nrm[a * 3 + 2] += nz;
      nrm[b * 3] += nx; nrm[b * 3 + 1] += ny; nrm[b * 3 + 2] += nz;
      nrm[c * 3] += nx; nrm[c * 3 + 1] += ny; nrm[c * 3 + 2] += nz;
    }
    for (let i = from; i < bk.n; i++) {
      const x = nrm[i * 3], y = nrm[i * 3 + 1], z = nrm[i * 3 + 2];
      const l = Math.hypot(x, y, z);
      if (l > 1e-12) { nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l; }
      else { nrm[i * 3] = 0; nrm[i * 3 + 1] = 1; nrm[i * 3 + 2] = 0; }
    }
  }

  /* ------------------------------------------------------- orientation -- */

  /**
   * Flip any triangle in the range whose normal points downward.
   * Use for strips that must face up (carriageways, footways, markings).
   * Near-vertical triangles are left alone.
   */
  orientUp(bk, idxFrom) {
    const p = bk.pos, idx = bk.idx;
    for (let i = idxFrom; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const ny = uz * vx - ux * vz;
      const l = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx) || 1;
      if (ny / l < -0.12) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    }
  }

  /**
   * Orient a ring strip radially about (cx, cz).
   * sign +1 => faces outward, -1 => faces inward. For kerbs and facades.
   */
  orientRadial(bk, idxFrom, cx, cz, sign = 1) {
    const p = bk.pos, idx = bk.idx;
    for (let i = idxFrom; i < idx.length; i += 3) {
      const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const mx = (p[a] + p[b] + p[c]) / 3 - cx;
      const mz = (p[a + 2] + p[b + 2] + p[c + 2]) / 3 - cz;
      const d = (nx * mx + nz * mz) * sign;
      if (d < 0) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    }
  }

  /** Convenience: orient the last strip of a bucket upward. */
  orientLastUp(key, idxFrom) { this.orientUp(this.b(key), idxFrom); }

  /* ---------------------------------------------------------------- build */

  build(materialFor) {
    const out = [];
    for (const [key, bk] of this.buckets) {
      if (bk.empty) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(bk.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(bk.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(bk.uv, 2));
      g.setIndex(bk.idx.length > 65535 ? new THREE.Uint32BufferAttribute(bk.idx, 1) : new THREE.Uint16BufferAttribute(bk.idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      out.push({ key, geometry: g, material: materialFor ? materialFor(key) : null });
    }
    return out;
  }

  dispose() {
    this.buckets.clear();
  }
}

/* --------------------------------------------------------- instanced props -- */

/**
 * Collects transforms for instanced props (bollards, lamps, trees, gullies,
 * catenary masts …) keyed by prop type, then builds InstancedMesh objects.
 */
export class PropSink {
  constructor() { this.groups = new Map(); }

  add(type, matrix) {
    let g = this.groups.get(type);
    if (!g) { g = []; this.groups.set(type, g); }
    g.push(matrix);
  }

  addTRS(type, x, y, z, ry, sx = 1, sy = 1, sz = 1) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    this.add(type, m);
  }

  build(geoFor, matFor) {
    const out = [];
    for (const [type, mats] of this.groups) {
      if (!mats.length) continue;
      const geo = geoFor(type);
      const mat = matFor(type);
      if (!geo || !mat) continue;
      const im = new THREE.InstancedMesh(geo, mat, mats.length);
      im.name = `props:${type}`;
      for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = false;
      im.receiveShadow = false;
      im.frustumCulled = true;
      im.computeBoundingSphere();
      im.userData.propType = type;
      out.push(im);
    }
    return out;
  }

  get count() { let n = 0; for (const g of this.groups.values()) n += g.length; return n; }
  dispose() { this.groups.clear(); }
}
