// Pure geometry helpers (no three.js dependency) so they can be unit-tested
// in Node. Coordinate system: y is up, the ground plane is XZ.
// "Right" of a travel direction t is perpRight(t) = (-t.z, 0, t.x).

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export const V = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const add = (a: V3, b: V3): V3 => V(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: V3, b: V3): V3 => V(a.x - b.x, a.y - b.y, a.z - b.z);
export const mul = (a: V3, k: number): V3 => V(a.x * k, a.y * k, a.z * k);
export const lerp3 = (a: V3, b: V3, t: number): V3 => V(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
export const len2 = (a: V3): number => Math.hypot(a.x, a.z);
export const len3 = (a: V3): number => Math.hypot(a.x, a.y, a.z);
export const dist2 = (a: V3, b: V3): number => Math.hypot(a.x - b.x, a.z - b.z);
export const cross2 = (a: V3, b: V3): number => a.x * b.z - a.z * b.x;
export const dot2 = (a: V3, b: V3): number => a.x * b.x + a.z * b.z;

export function unit2(a: V3): V3 {
  const l = len2(a);
  return l < 1e-9 ? V(0, 0, 1) : V(a.x / l, 0, a.z / l);
}

export function perpRight(t: V3): V3 {
  return V(-t.z, 0, t.x);
}

export function cross3(a: V3, b: V3): V3 {
  return V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

export function clonePts(pts: V3[]): V3[] {
  return pts.map((p) => V(p.x, p.y, p.z));
}

/** Uniform Catmull-Rom through all control points (C1 continuous, passes through them). */
export function smoothPath(pts: V3[], perSeg = 8): V3[] {
  if (pts.length < 3) return clonePts(pts);
  const out: V3[] = [];
  const f = (a: number, b: number, c: number, d: number, t: number): number => {
    const t2 = t * t;
    const t3 = t2 * t;
    return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < perSeg; k++) {
      const t = k / perSeg;
      out.push(V(f(p0.x, p1.x, p2.x, p3.x, t), f(p0.y, p1.y, p2.y, p3.y, t), f(p0.z, p1.z, p2.z, p3.z, t)));
    }
  }
  out.push(V(pts[pts.length - 1].x, pts[pts.length - 1].y, pts[pts.length - 1].z));
  return out;
}

/** An arc-length parameterised polyline. s[i] is the distance from the start to pts[i]. */
export interface Sampled {
  pts: V3[];
  tan: V3[]; // unit XZ tangent per sample
  s: number[];
  length: number;
}

/** Resample a dense polyline at (approximately) uniform arc length `step`. */
export function resample(dense: V3[], step: number): Sampled {
  if (dense.length === 0) return { pts: [], tan: [], s: [], length: 0 };
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + len3(sub(dense[i], dense[i - 1])));
  const L = cum[cum.length - 1];
  if (L < 1e-6 || dense.length === 1) {
    return { pts: [V(dense[0].x, dense[0].y, dense[0].z)], tan: [V(0, 0, 1)], s: [0], length: 0 };
  }
  const n = Math.max(1, Math.ceil(L / step));
  const pts: V3[] = [];
  const s: number[] = [];
  let j = 1;
  for (let k = 0; k <= n; k++) {
    const target = (L * k) / n;
    while (j < dense.length - 1 && cum[j] < target) j++;
    const seg = cum[j] - cum[j - 1];
    const t = seg > 1e-12 ? Math.min(1, Math.max(0, (target - cum[j - 1]) / seg)) : 0;
    pts.push(lerp3(dense[j - 1], dense[j], t));
    s.push(target);
  }
  const tan: V3[] = pts.map((_, k) => {
    const a = pts[Math.max(0, k - 1)];
    const b = pts[Math.min(pts.length - 1, k + 1)];
    return unit2(sub(b, a));
  });
  return { pts, tan, s, length: L };
}

/** Interpolated point, tangent and right-normal at arc length `s`. */
export function at(S: Sampled, s: number): { p: V3; t: V3; n: V3 } {
  const n = S.pts.length;
  if (n === 1) return { p: S.pts[0], t: S.tan[0], n: perpRight(S.tan[0]) };
  const x = Math.min(Math.max(s, 0), S.length);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (S.s[mid] <= x) lo = mid;
    else hi = mid;
  }
  const seg = S.s[hi] - S.s[lo];
  const f = seg > 1e-12 ? (x - S.s[lo]) / seg : 0;
  const t = unit2(lerp3(S.tan[lo], S.tan[hi], f));
  return { p: lerp3(S.pts[lo], S.pts[hi], f), t, n: perpRight(t) };
}

export interface NearestHit {
  s: number;
  dist: number;   // horizontal distance from the query point to the line
  offset: number; // signed lateral offset (+ = right of travel direction)
  p: V3;
  t: V3;
}

/** Closest point on the sampled polyline to a horizontal query point. */
export function nearest(S: Sampled, q: V3): NearestHit | null {
  if (S.pts.length === 0) return null;
  if (S.pts.length === 1) {
    const d = dist2(S.pts[0], q);
    return { s: 0, dist: d, offset: 0, p: S.pts[0], t: S.tan[0] };
  }
  let best: NearestHit | null = null;
  for (let i = 0; i < S.pts.length - 1; i++) {
    const a = S.pts[i];
    const b = S.pts[i + 1];
    const abx = b.x - a.x;
    const abz = b.z - a.z;
    const l2 = abx * abx + abz * abz;
    let f = l2 > 1e-12 ? ((q.x - a.x) * abx + (q.z - a.z) * abz) / l2 : 0;
    f = Math.min(1, Math.max(0, f));
    const p = lerp3(a, b, f);
    const d = dist2(p, q);
    if (!best || d < best.dist) {
      const t = unit2(V(abx, 0, abz));
      const n = perpRight(t);
      const off = (q.x - p.x) * n.x + (q.z - p.z) * n.z;
      best = { s: S.s[i] + (S.s[i + 1] - S.s[i]) * f, dist: d, offset: off, p, t };
    }
  }
  return best;
}

/** 2D (XZ) segment intersection. Returns parameters along both segments, or null. */
export function segIntersect(a: V3, b: V3, c: V3, d: V3): { t: number; u: number } | null {
  const r = V(b.x - a.x, 0, b.z - a.z);
  const q = V(d.x - c.x, 0, d.z - c.z);
  const denom = cross2(r, q);
  if (Math.abs(denom) < 1e-9) return null;
  const ca = V(c.x - a.x, 0, c.z - a.z);
  const t = cross2(ca, q) / denom;
  const u = cross2(ca, r) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

export function polylineLength(pts: V3[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += len3(sub(pts[i], pts[i - 1]));
  return L;
}
