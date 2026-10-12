//==================================================================================================
//  ROADEDITOR — CORE
//==================================================================================================
//  Shared math, deterministic randomness, value noise, convex-polygon surgery and the mesh builder
//  every generator writes into.
//
//  Conventions (the same ones the Frontier engine uses):
//    * Z is up. X is east, Y is north. Metres are the unit for every length in the network model.
//    * Heading/bearing is measured in degrees clockwise from +Y so it reads like a compass.
//    * Polygons are 2D point lists of { x, y } and carry a winding; positive area is CCW.
//    * A "ribbon" is a quad strip built row by row from a swept cross-section.
//==================================================================================================

export const DEG = Math.PI / 180;
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const wrapPi = (a) => {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
};
export const dirFromBearing = (deg) => ({ x: Math.sin(deg * DEG), y: Math.cos(deg * DEG) });
export const bearingOf = (dx, dy) => (Math.atan2(dx, dy) / DEG + 360) % 360;

//--------------------------------------------------------------------------------------------------
//  Small vector helpers. Network data uses plain { x, y, z } objects so it stays readable and
//  JSON-serialisable; only the mesh hot path drops to typed arrays.
//--------------------------------------------------------------------------------------------------
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const v2 = (x = 0, y = 0) => ({ x, y });
export const add3 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const mul3 = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const len3 = (a) => Math.hypot(a.x, a.y, a.z);
export const len2 = (a) => Math.hypot(a.x, a.y);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const dist3 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
export function norm3(a) {
  const l = len3(a) || 1;
  return { x: a.x / l, y: a.y / l, z: a.z / l };
}
export function lerp3(a, b, t) {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}
/** Horizontal left normal of a 2D direction (90° CCW seen from above). */
export const left2 = (d) => ({ x: -d.y, y: d.x });
export const norm2 = (a) => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const dot2 = (a, b) => a.x * b.x + a.y * b.y;
export const cross2 = (a, b) => a.x * b.y - a.y * b.x;

//--------------------------------------------------------------------------------------------------
//  Deterministic randomness. Every generator takes an Rng so a seed reproduces a whole metro.
//--------------------------------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1, salt = 0) {
    this.seed = (seed ^ 0x9e3779b9) >>> 0;
    this.next = mulberry32(this.seed + salt * 0x85ebca6b);
    this.calls = 0;
  }
  f(a = 0, b = 1) {
    this.calls++;
    return a + (b - a) * this.next();
  }
  i(a, b) {
    return Math.floor(this.f(a, b + 1 - 1e-9));
  }
  bool(p = 0.5) {
    return this.next() < p;
  }
  pick(arr) {
    return arr[Math.min(arr.length - 1, Math.floor(this.f(0, arr.length)))];
  }
  /** Weighted pick: entries are [value, weight]. */
  weighted(entries) {
    let total = 0;
    for (const e of entries) total += e[1];
    let r = this.f(0, total);
    for (const e of entries) {
      r -= e[1];
      if (r <= 0) return e[0];
    }
    return entries[entries.length - 1][0];
  }
  /** Normal-ish via sum of uniforms; cheap and stable for layout jitter. */
  gauss(mu = 0, sigma = 1) {
    return mu + sigma * ((this.f() + this.f() + this.f() + this.f() - 2) * 0.866);
  }
  fork(salt) {
    return new Rng(this.seed, salt);
  }
}

//--------------------------------------------------------------------------------------------------
//  Value noise — used for terrain, surface tinting and district masks. Deterministic in (x, y, seed).
//--------------------------------------------------------------------------------------------------
export function hash2(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = smoothstep(xf);
  const v = smoothstep(yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}
export function fbm(x, y, octaves = 4, seed = 0, lacunarity = 2.03, gain = 0.5) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + o * 131);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

//--------------------------------------------------------------------------------------------------
//  Convex polygon surgery (all in 2D; the network carries z separately).
//--------------------------------------------------------------------------------------------------
export function polyArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}
export const polyCCW = (poly) => polyArea(poly) > 0;
export function ensureCCW(poly) {
  return polyArea(poly) > 0 ? poly : poly.slice().reverse();
}
export function polyCentroid(poly) {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const f = p.x * q.y - q.x * p.y;
    a += f;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-9) {
    let sx = 0;
    let sy = 0;
    for (const p of poly) {
      sx += p.x;
      sy += p.y;
    }
    return { x: sx / poly.length, y: sy / poly.length };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

/** Removes duplicate and collinear vertices; drops degenerate rings entirely. */
export function polyClean(poly, eps = 0.05) {
  const out = [];
  for (const p of poly) {
    const q = out[out.length - 1];
    if (q && Math.hypot(q.x - p.x, q.y - p.y) < eps) continue;
    out.push(p);
  }
  while (out.length > 1 && Math.hypot(out[0].x - out[out.length - 1].x, out[0].y - out[out.length - 1].y) < eps) out.pop();
  const res = [];
  for (let i = 0, n = out.length; i < n; i++) {
    const a = out[(i - 1 + n) % n];
    const b = out[i];
    const c = out[(i + 1) % n];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) > 1e-4) res.push(b);
  }
  return res.length >= 3 ? res : [];
}

/** Signed distance of p from the line through a→b; positive on the LEFT of a→b (CCW side). */
export function sideOfLine(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  return (dx * (p.y - a.y) - dy * (p.x - a.x)) / l;
}

/**
 * Sutherland–Hodgman clip of a CONVEX polygon against the half-plane on the left of a→b when
 * keepPositive is true, otherwise the right. The subdivision generator only ever cuts convex
 * regions, which keeps this exact and cheap.
 */
export function clipConvexHalfPlane(poly, a, b, keepPositive = true) {
  const out = [];
  const sgn = keepPositive ? 1 : -1;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const dp = sgn * sideOfLine(p, a, b);
    const dq = sgn * sideOfLine(q, a, b);
    if (dp >= 0) out.push(p);
    if ((dp > 0 && dq < 0) || (dp < 0 && dq > 0)) {
      const t = dp / (dp - dq);
      out.push({ x: lerp(p.x, q.x, t), y: lerp(p.y, q.y, t) });
    }
  }
  return polyClean(out);
}

/** Inward offset (inset) of a convex polygon by d metres on every edge. */
export function insetConvex(poly, d) {
  const n = poly.length;
  if (n < 3 || d <= 0) return poly.slice();
  const ccw = polyCCW(poly);
  const s = ccw ? 1 : -1;
  const lines = [];
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    let dx = q.x - p.x;
    let dy = q.y - p.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l;
    dy /= l;
    // Inward normal: for CCW winding the inward side is the right-hand side of the edge.
    const nx = -dy * s;
    const ny = dx * s;
    lines.push({ px: p.x + nx * d, py: p.y + ny * d, dx, dy });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const A = lines[(i - 1 + n) % n];
    const B = lines[i];
    const den = cross2(A, B) === 0 ? 0 : A.dx * B.dy - A.dy * B.dx;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((B.px - A.px) * B.dy - (B.py - A.py) * B.dx) / den;
    out.push({ x: A.px + A.dx * t, y: A.py + A.dy * t });
  }
  return polyClean(out);
}

/** Clips an infinite line segment list by a convex polygon — Liang–Barsky, used to trim roads. */
export function clipSegmentToConvex(a, b, poly) {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ccw = polyCCW(poly);
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    // Inward normal of the edge; for a CCW ring that is its left normal.
    let nx = -(q.y - p.y);
    let ny = q.x - p.x;
    if (!ccw) {
      nx = -nx;
      ny = -ny;
    }
    // Inside the half-plane means n·(P(t) - p) >= 0, i.e. num + t * den >= 0.
    const num = nx * (a.x - p.x) + ny * (a.y - p.y);
    const den = nx * dx + ny * dy;
    if (Math.abs(den) < 1e-9) {
      if (num < 0) return null;
      continue;
    }
    const t = -num / den;
    if (den > 0) {
      if (t > t0) t0 = t;
    } else if (t < t1) t1 = t;
    if (t0 > t1) return null;
  }
  return [
    { x: a.x + dx * t0, y: a.y + dy * t0 },
    { x: a.x + dx * t1, y: a.y + dy * t1 },
  ];
}

/** Point at distance u along a polyline, with the local tangent. */
export function polylinePoint(pts, u, closed = false) {
  const total = polylineLength(pts, closed);
  let target = clamp(u, 0, 1) * total;
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (target <= seg || i === last - 1) {
      const t = seg > 1e-9 ? target / seg : 0;
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        dx: (b.x - a.x) / (seg || 1),
        dy: (b.y - a.y) / (seg || 1),
      };
    }
    target -= seg;
  }
  const a = pts[n - 2];
  const b = pts[n - 1];
  const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return { x: b.x, y: b.y, dx: (b.x - a.x) / l, dy: (b.y - a.y) / l };
}

export function polylineLength(pts, closed = false) {
  let l = 0;
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    l += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return l;
}

//--------------------------------------------------------------------------------------------------
//  Uniform-grid spatial hash for segment queries (intersections, snapping, prop spacing).
//--------------------------------------------------------------------------------------------------
export class SegmentGrid {
  constructor(cell = 32) {
    this.cell = cell;
    this.map = new Map();
  }
  key(cx, cy) {
    return cx * 73856093 ^ cy * 19349663;
  }
  insert(item, ax, ay, bx, by) {
    const c = this.cell;
    const minx = Math.floor(Math.min(ax, bx) / c);
    const maxx = Math.floor(Math.max(ax, bx) / c);
    const miny = Math.floor(Math.min(ay, by) / c);
    const maxy = Math.floor(Math.max(ay, by) / c);
    for (let cx = minx; cx <= maxx; cx++) {
      for (let cy = miny; cy <= maxy; cy++) {
        const k = this.key(cx, cy);
        let bucket = this.map.get(k);
        if (!bucket) this.map.set(k, (bucket = []));
        bucket.push(item);
      }
    }
  }
  query(ax, ay, bx, by, cb) {
    const c = this.cell;
    const minx = Math.floor(Math.min(ax, bx) / c);
    const maxx = Math.floor(Math.max(ax, bx) / c);
    const miny = Math.floor(Math.min(ay, by) / c);
    const maxy = Math.floor(Math.max(ay, by) / c);
    const seen = new Set();
    for (let cx = minx - 1; cx <= maxx + 1; cx++) {
      for (let cy = miny - 1; cy <= maxy + 1; cy++) {
        const bucket = this.map.get(this.key(cx, cy));
        if (!bucket) continue;
        for (const it of bucket) {
          if (seen.has(it)) continue;
          seen.add(it);
          cb(it);
        }
      }
    }
  }
}

//--------------------------------------------------------------------------------------------------
//  Mesh builder. One interleaved vertex format serves every generator:
//     position  vec3   float32   (12 B)
//     normal    vec3   int8 snorm packed as 2 bytes (octahedral)  -> read as 4 bytes padded
//     tintRGBA  vec4   uint8     RGB = tint, A = material id (0..1 -> 0..255)
//  Materials are procedural in the fragment shader, so a per-vertex id avoids material-sorted draws.
//--------------------------------------------------------------------------------------------------
export const MAT = {
  ASPHALT: 0,
  ASPHALT_LIGHT: 1,
  CONCRETE: 2,
  COBBLE: 3,
  PAVER: 4,
  PAINT_WHITE: 5,
  PAINT_YELLOW: 6,
  PAINT_RED: 7,
  PAINT_GREEN: 8,
  PAINT_BLUE: 9,
  DIRT: 10,
  GRAVEL: 11,
  GRASS: 12,
  SAND: 13,
  ROCK: 14,
  METAL: 15,
  RUBBER: 16,
  BALLAST: 17,
  RAILSTEEL: 18,
  WOOD: 19,
  TUNNEL_WALL: 20,
  TUNNEL_FLOOR: 21,
  WATER: 22,
  GLASS: 23,
  SIGN_FACE: 24,
  MARK_WHITE: 25,
  MARK_YELLOW: 26,
  MARK_RED: 27,
  MARK_BLUE: 28,
  MARK_GREEN: 29,
  FOLIAGE: 30,
  MARK_AMBER: 31,
};
export const MAT_COUNT = 32; // ids 0..31; 31 is the last usable slot

export function packNormalOct(n) {
  let x = n.x;
  let y = n.y;
  let z = n.z;
  const l = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  x /= l;
  y /= l;
  z /= l;
  let ox = 0;
  let oy = 0;
  if (z >= 0) {
    ox = x;
    oy = y;
  } else {
    ox = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1);
    oy = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1);
  }
  const ex = Math.round(clamp(ox, -1, 1) * 127);
  const ey = Math.round(clamp(oy, -1, 1) * 127);
  return [ex & 0xff, ey & 0xff];
}

export class MeshBuilder {
  /**
   * @param {string} name  human label used by the stats footer
   */
  constructor(name = 'mesh') {
    this.name = name;
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.idx = [];
    this.groups = [];
    this._group = null;
    this._aabb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  }
  get vertexCount() {
    return this.pos.length / 3;
  }
  get triCount() {
    return this.idx.length / 3;
  }
  beginGroup(name, meta = null) {
    this.endGroup();
    this._group = { name, meta, start: this.idx.length, aabb: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] };
  }
  endGroup() {
    if (!this._group) return;
    this._group.count = this.idx.length - this._group.start;
    if (this._group.count > 0) this.groups.push(this._group);
    this._group = null;
  }
  _touch(x, y, z) {
    const a = this._group ? this._group.aabb : this._aabb;
    if (x < a[0]) a[0] = x;
    if (y < a[1]) a[1] = y;
    if (z < a[2]) a[2] = z;
    if (x > a[3]) a[3] = x;
    if (y > a[4]) a[4] = y;
    if (z > a[5]) a[5] = z;
    if (this._group) {
      if (x < this._aabb[0]) this._aabb[0] = x;
      if (y < this._aabb[1]) this._aabb[1] = y;
      if (z < this._aabb[2]) this._aabb[2] = z;
      if (x > this._aabb[3]) this._aabb[3] = x;
      if (y > this._aabb[4]) this._aabb[4] = y;
      if (z > this._aabb[5]) this._aabb[5] = z;
    }
  }
  get bounds() {
    return this._aabb;
  }
  vertex(p, n, tint = [1, 1, 1], mat = MAT.ASPHALT) {
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z);
    const [ex, ey] = packNormalOct(n);
    this.nrm.push(ex, ey, 0, 0);
    this.col.push(
      Math.round(clamp(tint[0], 0, 1) * 255),
      Math.round(clamp(tint[1], 0, 1) * 255),
      Math.round(clamp(tint[2], 0, 1) * 255),
      mat & 0xff,
    );
    this._touch(p.x, p.y, p.z);
    return i;
  }
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  quadIdx(a, b, c, d, flip = false) {
    if (flip) this.idx.push(a, c, b, b, c, d);
    else this.idx.push(a, b, c, b, d, c);
  }
  /** Two matching rows of vertex indices -> a quad strip (rowA[0] is paired with rowB[0]). */
  strip(rowA, rowB, flip = false) {
    const n = Math.min(rowA.length, rowB.length);
    for (let i = 0; i < n - 1; i++) {
      if (flip) this.quadIdx(rowA[i], rowA[i + 1], rowB[i], rowB[i + 1], true);
      else this.quadIdx(rowA[i], rowA[i + 1], rowB[i], rowB[i + 1]);
    }
  }
  /** Closes a ring of rows (used by tunnels and closed roundabout ribbons). */
  stripClosed(rowA, rowB, flip = false) {
    const n = Math.min(rowA.length, rowB.length);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) this.quadIdx(rowA[i], rowA[j], rowB[i], rowB[j], true);
      else this.quadIdx(rowA[i], rowA[j], rowB[i], rowB[j]);
    }
  }
  polyFan(row, flip = false) {
    for (let i = 1; i < row.length - 1; i++) {
      if (flip) this.tri(row[0], row[i + 1], row[i]);
      else this.tri(row[0], row[i], row[i + 1]);
    }
  }
  /** Axis-aligned box with an explicit tint and material. */
  box(cx, cy, cz, sx, sy, sz, mat, tint = [1, 1, 1], yaw = 0) {
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const P = (x, y, z) => ({ x: cx + x * c - y * s, y: cy + x * s + y * c, z: cz + z });
    const faces = [
      [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz], [0, 0, 1]],
      [[-hx, hy, -hz], [hx, hy, -hz], [hx, -hy, -hz], [-hx, -hy, -hz], [0, 0, -1]],
      [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz], [0, -1, 0]],
      [[hx, hy, -hz], [-hx, hy, -hz], [-hx, hy, hz], [hx, hy, hz], [0, 1, 0]],
      [[hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz], [hx, -hy, hz], [1, 0, 0]],
      [[-hx, hy, -hz], [-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-1, 0, 0]],
    ];
    for (const f of faces) {
      const row = f.slice(0, 4).map(([x, y, z]) => this.vertex(P(x, y, z), { x: f[4][0] * c - f[4][1] * s, y: f[4][0] * s + f[4][1] * c, z: f[4][2] }, tint, mat));
      this.quadIdx(row[0], row[1], row[2], row[3], true);
    }
  }
  toArrays() {
    this.endGroup();
    return {
      position: new Float32Array(this.pos),
      normalPacked: new Uint8Array(this.nrm),
      color: new Uint8Array(this.col),
      index: this.vertexCount > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx),
      index32: this.vertexCount > 65535,
      groups: this.groups,
      triCount: this.triCount,
      vertexCount: this.vertexCount,
    };
  }
}

//--------------------------------------------------------------------------------------------------
//  Stroke font. Markings need real glyphs (BUS, STOP, X at crossings, arrows, a bike). Each glyph is
//  a list of polylines in a 0..1 x 0..1 box, y up; the marking generator strokes them into quads.
//--------------------------------------------------------------------------------------------------
export const GLYPHS = {
  B: [[[0.1, 0], [0.1, 1], [0.62, 1], [0.78, 0.86], [0.78, 0.64], [0.62, 0.5], [0.1, 0.5]], [[0.62, 0.5], [0.78, 0.36], [0.78, 0.14], [0.62, 0], [0.1, 0]]],
  U: [[[0.1, 1], [0.1, 0.25], [0.28, 0.02], [0.55, 0.02], [0.73, 0.25], [0.73, 1]]],
  S: [[[0.85, 0.86], [0.68, 1], [0.24, 1], [0.08, 0.82], [0.08, 0.68], [0.24, 0.53], [0.68, 0.48], [0.85, 0.32], [0.85, 0.16], [0.68, 0], [0.24, 0], [0.08, 0.14]]],
  T: [[[0.06, 1], [0.9, 1]], [[0.48, 1], [0.48, 0]]],
  O: [[[0.12, 0.2], [0.2, 0.02], [0.7, 0.02], [0.82, 0.22], [0.82, 0.78], [0.7, 0.98], [0.2, 0.98], [0.12, 0.8], [0.12, 0.2]]],
  P: [[[0.1, 0], [0.1, 1], [0.66, 1], [0.82, 0.84], [0.82, 0.6], [0.66, 0.46], [0.1, 0.46]]],
  X: [[[0.08, 0], [0.86, 1]], [[0.86, 0], [0.08, 1]]],
  R: [[[0.1, 0], [0.1, 1], [0.66, 1], [0.82, 0.84], [0.82, 0.62], [0.66, 0.46], [0.1, 0.46]], [[0.44, 0.46], [0.82, 0]]],
  A: [[[0.08, 0], [0.46, 1], [0.84, 0]], [[0.22, 0.34], [0.7, 0.34]]],
  K: [[[0.1, 0], [0.1, 1]], [[0.8, 1], [0.1, 0.44]], [[0.32, 0.62], [0.84, 0]]],
  E: [[[0.82, 1], [0.1, 1], [0.1, 0], [0.82, 0]], [[0.1, 0.52], [0.62, 0.52]]],
  // Directional arrows for turn lanes; drawn in a 0..1 box, base at y = 0, tip at y = 1.
  ARROW_STRAIGHT: [[[0.5, 0], [0.5, 0.66]], [[0.5, 1], [0.2, 0.58], [0.8, 0.58], [0.5, 1]]],
  ARROW_LEFT: [[[0.5, 0], [0.5, 0.7]], [[0.5, 0.78], [0.1, 0.78], [0.1, 0.62]], [[0.1, 0.95], [0.1, 0.62], [0.32, 0.62]]],
  ARROW_RIGHT: [[[0.5, 0], [0.5, 0.7]], [[0.5, 0.78], [0.9, 0.78], [0.9, 0.62]], [[0.9, 0.95], [0.9, 0.62], [0.68, 0.62]]],
  ARROW_UTURN: [[[0.32, 0], [0.32, 0.5], [0.5, 0.78], [0.68, 0.5], [0.68, 0.2]], [[0.68, 0.3], [0.55, 0.3]], [[0.68, 0.3], [0.55, 0.44]]],
  BICYCLE: [
    [[0.16, 0.28], [0.28, 0.1], [0.42, 0.1], [0.5, 0.28], [0.42, 0.46], [0.28, 0.46], [0.16, 0.28]],
    [[0.58, 0.28], [0.7, 0.1], [0.84, 0.1], [0.92, 0.28], [0.84, 0.46], [0.7, 0.46], [0.58, 0.28]],
    [[0.34, 0.28], [0.52, 0.28], [0.62, 0.72], [0.42, 0.72], [0.34, 0.28]],
    [[0.44, 0.72], [0.36, 0.86], [0.6, 0.9]],
  ],
  PEDESTRIAN: [
    [[0.5, 0.88], [0.62, 0.8], [0.6, 0.62], [0.48, 0.52], [0.42, 0.34]],
    [[0.48, 0.52], [0.6, 0.3], [0.58, 0.06]],
    [[0.44, 0.14], [0.36, 0.02]],
    [[0.52, 0.6], [0.34, 0.56], [0.3, 0.4]],
    [[0.56, 0.56], [0.68, 0.44]],
    [[0.5, 0.88], [0.48, 1.0], [0.56, 1.0]],
  ],
};

/** Converts a glyph word into a pill of stroked polylines scaled to a target height in metres. */
export function glyphWord(word, height, spacing = 0.22) {
  const strokes = [];
  let cursor = 0;
  for (const ch of word.toUpperCase()) {
    const g = GLYPHS[ch];
    if (!g) {
      cursor += 0.8 + spacing;
      continue;
    }
    for (const s of g) strokes.push(s.map(([x, y]) => ({ x: cursor + x, y: y * height })));
    cursor += 0.86 + spacing;
  }
  return { strokes, width: cursor * 1 };
}
