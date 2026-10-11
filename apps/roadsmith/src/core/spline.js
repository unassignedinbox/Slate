// Centripetal Catmull-Rom centrelines with arc-length reparameterisation.
// Every road in Roadsmith is a Curve: geometry, lane graph and props all sample the same object,
// so a node move re-evaluates one curve and everything downstream stays consistent.

import { clamp, v3, v3add, v3sub, v3scale, v3norm, v3dist, lerp } from './math.js';

export class Curve {
  /**
   * @param {{x,y,z}[]} points control points (passed through, not approximated)
   * @param {{alpha?:number, samples?:number, closed?:boolean}} opts
   */
  constructor(points, opts = {}) {
    this.pts = points.map((p) => ({ x: p.x, y: p.y ?? 0, z: p.z }));
    this.alpha = opts.alpha ?? 0.5; // 0.5 = centripetal: no cusps, no self-intersection
    this.closed = !!opts.closed;
    this._buildKnots();
    this._buildLUT(opts.samples ?? Math.max(48, Math.ceil(this._roughLength() / 0.5)));
  }

  _roughLength() {
    let l = 0;
    for (let i = 1; i < this.pts.length; i++) l += v3dist(this.pts[i - 1], this.pts[i]);
    return Math.max(l, 1e-3);
  }

  _buildKnots() {
    const p = this.pts;
    const n = p.length;
    // reflected phantom endpoints so the spline actually spans p[0]..p[n-1]
    const cp = [
      { x: 2 * p[0].x - p[1].x, y: 2 * p[0].y - p[1].y, z: 2 * p[0].z - p[1].z },
      ...p,
      { x: 2 * p[n - 1].x - p[n - 2].x, y: 2 * p[n - 1].y - p[n - 2].y, z: 2 * p[n - 1].z - p[n - 2].z },
    ];
    this.cp = cp;
    this.knots = [0];
    for (let i = 1; i < cp.length; i++) {
      const d = Math.max(v3dist(cp[i - 1], cp[i]), 1e-5);
      this.knots.push(this.knots[i - 1] + Math.pow(d, this.alpha));
    }
    this.u0 = this.knots[1];
    this.u1 = this.knots[cp.length - 2];
  }

  /** Raw evaluation in knot space. */
  _evalU(u) {
    const p = this.cp, k = this.knots, n = p.length;
    u = clamp(u, this.u0, this.u1);
    let i = 1;
    while (i < n - 2 && u > k[i + 1]) i++;
    const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
    const t0 = k[i - 1], t1 = k[i], t2 = k[i + 1], t3 = k[i + 2];
    const t = clamp(u, t1, t2);
    const inv = (a, b) => 1 / Math.max(b - a, 1e-6);
    const a1 = mix(p0, p1, (t1 - t) * inv(t0, t1), (t - t0) * inv(t0, t1));
    const a2 = mix(p1, p2, (t2 - t) * inv(t1, t2), (t - t1) * inv(t1, t2));
    const a3 = mix(p2, p3, (t3 - t) * inv(t2, t3), (t - t2) * inv(t2, t3));
    const b1 = mix(a1, a2, (t2 - t) * inv(t0, t2), (t - t0) * inv(t0, t2));
    const b2 = mix(a2, a3, (t3 - t) * inv(t1, t3), (t - t1) * inv(t1, t3));
    return mix(b1, b2, (t2 - t) * inv(t1, t2), (t - t1) * inv(t1, t2));
  }

  _buildLUT(samples) {
    const u0 = this.u0, u1 = this.u1;
    const n = Math.max(8, samples);
    this._lutU = new Float64Array(n + 1);
    this._lutS = new Float64Array(n + 1);
    this._lutP = new Array(n + 1);
    let prev = null, acc = 0;
    for (let i = 0; i <= n; i++) {
      const u = u0 + ((u1 - u0) * i) / n;
      const pt = this._evalU(u);
      if (prev) acc += v3dist(prev, pt);
      this._lutU[i] = u;
      this._lutS[i] = acc;
      this._lutP[i] = pt;
      prev = pt;
    }
    this.length = acc;
  }

  uAt(s) {
    const S = this._lutS, n = S.length - 1;
    const target = clamp(s, 0, this.length);
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (S[mid] < target) lo = mid + 1; else hi = mid;
    }
    const i = Math.max(1, lo);
    const s0 = S[i - 1], s1 = S[i];
    const f = s1 - s0 > 1e-9 ? (target - s0) / (s1 - s0) : 0;
    return this._lutU[i - 1] + (this._lutU[i] - this._lutU[i - 1]) * f;
  }

  pointAt(s) { return this._evalU(this.uAt(s)); }

  tangentAt(s, eps = 0.05) {
    const a = this.pointAt(clamp(s - eps, 0, this.length));
    const b = this.pointAt(clamp(s + eps, 0, this.length));
    const d = v3sub(b, a);
    if (Math.hypot(d.x, d.y, d.z) < 1e-7) return { x: 1, y: 0, z: 0 };
    return v3norm(d);
  }

  /** Signed curvature in the XZ plane (positive = turning left). 1/radius. */
  curvatureAt(s, eps = 1.0) {
    const h = Math.min(eps, Math.max(0.25, this.length / 8));
    const a = this.pointAt(clamp(s - h, 0, this.length));
    const b = this.pointAt(clamp(s, 0, this.length));
    const c = this.pointAt(clamp(s + h, 0, this.length));
    const v1x = b.x - a.x, v1z = b.z - a.z;
    const v2x = c.x - b.x, v2z = c.z - b.z;
    const l1 = Math.hypot(v1x, v1z), l2 = Math.hypot(v2x, v2z);
    if (l1 < 1e-6 || l2 < 1e-6) return 0;
    const cross = (v1x * v2z - v1z * v2x) / (l1 * l2);
    const ang = Math.asin(clamp(cross, -1, 1));
    return ang / ((l1 + l2) * 0.5);
  }

  /** Orthonormal road frame at arc-length s. right = +90° from tangent (driver's right). */
  frameAt(s) {
    const p = this.pointAt(s);
    const t = this.tangentAt(s);
    const flat = Math.hypot(t.x, t.z) || 1;
    const right = { x: t.z / flat, y: 0, z: -t.x / flat };
    const up = v3norm({
      x: right.y * t.z - right.z * t.y,
      y: right.z * t.x - right.x * t.z,
      z: right.x * t.y - right.y * t.x,
    });
    return { p, t, right, up, s, k: this.curvatureAt(s) };
  }

  /** Nearest arc-length to a world point (coarse LUT scan then local refine). */
  closestS(q) {
    let best = 0, bestD = Infinity;
    const P = this._lutP, S = this._lutS;
    for (let i = 0; i < P.length; i++) {
      const d = (P[i].x - q.x) ** 2 + (P[i].z - q.z) ** 2;
      if (d < bestD) { bestD = d; best = S[i]; }
    }
    let step = this.length / (P.length - 1);
    for (let iter = 0; iter < 20; iter++) {
      const a = clamp(best - step, 0, this.length), b = clamp(best + step, 0, this.length);
      const pa = this.pointAt(a), pb = this.pointAt(b);
      const da = (pa.x - q.x) ** 2 + (pa.z - q.z) ** 2;
      const db = (pb.x - q.x) ** 2 + (pb.z - q.z) ** 2;
      if (da < bestD && da <= db) { bestD = da; best = a; }
      else if (db < bestD) { bestD = db; best = b; }
      step *= 0.6;
    }
    return best;
  }

  /** Polyline offset at constant lateral distance; used for lane centrelines. */
  offsetPolyline(offset, step = 2, s0 = 0, s1 = this.length) {
    const out = [];
    const span = Math.max(0, s1 - s0);
    const n = Math.max(1, Math.ceil(span / step));
    for (let i = 0; i <= n; i++) {
      const s = s0 + (span * i) / n;
      const f = this.frameAt(s);
      out.push({ x: f.p.x + f.right.x * offset, y: f.p.y, z: f.p.z + f.right.z * offset, s });
    }
    return out;
  }
}

function mix(a, b, wa, wb) {
  return { x: a.x * wa + b.x * wb, y: a.y * wa + b.y * wb, z: a.z * wa + b.z * wb };
}

/** Cubic Hermite through two endpoints with tangents — used for junction turn paths and ramps. */
export function hermite(p0, m0, p1, m1, t) {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return {
    x: h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x,
    y: h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y,
    z: h00 * p0.z + h10 * m0.z + h01 * p1.z + h11 * m1.z,
  };
}

export function hermitePolyline(p0, m0, p1, m1, segments = 12) {
  const out = [];
  for (let i = 0; i <= segments; i++) out.push(hermite(p0, m0, p1, m1, i / segments));
  return out;
}

export function polylineLength(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += v3dist(pts[i - 1], pts[i]);
  return l;
}

/** Resample a polyline to uniform spacing, preserving endpoints. */
export function resamplePolyline(pts, spacing) {
  if (pts.length < 2) return pts.slice();
  const total = polylineLength(pts);
  const n = Math.max(1, Math.round(total / spacing));
  const out = [pts[0]];
  let seg = 1, acc = 0, prev = pts[0];
  for (let i = 1; i <= n; i++) {
    const target = (total * i) / n;
    while (seg < pts.length && acc + v3dist(prev, pts[seg]) < target) {
      acc += v3dist(prev, pts[seg]);
      prev = pts[seg++];
    }
    if (seg >= pts.length) { out.push(pts[pts.length - 1]); break; }
    const d = v3dist(prev, pts[seg]) || 1;
    const f = (target - acc) / d;
    out.push({
      x: lerp(prev.x, pts[seg].x, f),
      y: lerp(prev.y, pts[seg].y, f),
      z: lerp(prev.z, pts[seg].z, f),
    });
  }
  return out;
}
