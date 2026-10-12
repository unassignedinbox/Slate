/* ============================================================================
   mathx — deterministic RNG, splines, arc-length frames, geometry helpers.
   All road geometry is built on arc-length-uniform sampling of a C1 cubic
   Hermite curve, which is what keeps the extruded topology clean: every
   station is a straight cross-section, no bunching, no self-intersection.
   ========================================================================== */

export const TAU = Math.PI * 2;

/* ---------------------------------------------------------------- RNG ----- */

/** Mulberry32 — small, fast, deterministic, decent distribution. */
export function makeRNG(seed = 1) {
  let a = seed >>> 0;
  const rng = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.range = (lo, hi) => lo + (hi - lo) * rng();
  rng.int = (lo, hi) => Math.floor(lo + (hi - lo + 1) * rng()) - (rng() === 1 ? 1 : 0);
  rng.pick = (arr) => arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
  rng.chance = (p) => rng() < p;
  rng.sign = () => (rng() < 0.5 ? -1 : 1);
  /** Approximately-normal deviate (sum of 3 uniforms, scaled). */
  rng.gauss = (mu = 0, sd = 1) => {
    const u = rng() + rng() + rng() - 1.5;
    return mu + u * 1.4142 * sd;
  };
  rng.shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };
  return rng;
}

/** String -> 32-bit hash, for seed inputs typed by the user. */
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* -------------------------------------------------------------- scalars ---- */

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;
export const snap = (v, s) => (s > 0 ? Math.round(v / s) * s : v);
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, clamp(invLerp(a, b, v), 0, 1));

/** Shortest signed angular difference, in radians. */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/* -------------------------------------------------- 2D vector helpers ----- */
/* Most of the network math is planar (x, z); height (y) is sampled from a
   terrain field. Keeping it 2D keeps the intersection solver stable. */

export const v2 = (x = 0, y = 0) => ({ x, y });
export const add2 = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const sub2 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const mul2 = (a, s) => ({ x: a.x * s, y: a.y * s });
export const dot2 = (a, b) => a.x * b.x + a.y * b.y;
export const cross2 = (a, b) => a.x * b.y - a.y * b.x;
export const len2 = (a) => Math.hypot(a.x, a.y);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const norm2 = (a) => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
export const perp2 = (a) => ({ x: -a.y, y: a.x });
export const rot2 = (a, ang) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c };
};
/** Uniform scale then rotate — used for the banking transform. */
export const lerp2 = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });

/** Closest point on segment ab to p, plus the parametric position. */
export function closestOnSegment2(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  if (l2 < 1e-12) return { x: ax, y: ay, t: 0, d: Math.hypot(px - ax, py - ay) };
  let t = ((px - ax) * dx + (py - ay) * dy) / l2;
  t = clamp(t, 0, 1);
  const x = ax + dx * t, y = ay + dy * t;
  return { x, y, t, d: Math.hypot(px - x, py - y) };
}

/** Intersection of the infinite lines p0+p0d*t and q0+q0d*s. Null if parallel. */
export function lineIntersect2(p0, pd, q0, qd) {
  const den = cross2(pd, qd);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross2(sub2(q0, p0), qd) / den;
  return { x: p0.x + pd.x * t, y: p0.y + pd.y * t, t };
}

/* ------------------------------------------------------------- splines ---- */

/**
 * Cubic Hermite segment. p0/p1 endpoints, m0/m1 tangents (already scaled for
 * the segment length — i.e. "velocity" not unit direction).
 * @param {number} t 0..1
 */
export function hermite(p0, m0, p1, m1, t, out = { x: 0, y: 0 }) {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  out.x = h00 * p0.x + h10 * m0.x + h01 * p1.x + h11 * m1.x;
  out.y = h00 * p0.y + h10 * m0.y + h01 * p1.y + h11 * m1.y;
  return out;
}

export function hermiteTangent(p0, m0, p1, m1, t, out = { x: 0, y: 0 }) {
  const t2 = t * t;
  const d00 = 6 * t2 - 6 * t;
  const d10 = 3 * t2 - 4 * t + 1;
  const d01 = -6 * t2 + 6 * t;
  const d11 = 3 * t2 - 2 * t;
  out.x = d00 * p0.x + d10 * m0.x + d01 * p1.x + d11 * m1.x;
  out.y = d00 * p0.y + d10 * m0.y + d01 * p1.y + d11 * m1.y;
  return out;
}

export function hermiteCurvature(p0, m0, p1, m1, t) {
  const d1 = hermiteTangent(p0, m0, p1, m1, t, { x: 0, y: 0 });
  // second derivative: d/dt of tangent basis
  const d00 = 12 * t - 6, d10 = 6 * t - 4, d01 = -12 * t + 6, d11 = 6 * t - 2;
  const d2x = d00 * p0.x + d10 * m0.x + d01 * p1.x + d11 * m1.x;
  const d2y = d00 * p0.y + d10 * m0.y + d01 * p1.y + d11 * m1.y;
  const sp = Math.hypot(d1.x, d1.y);
  if (sp < 1e-9) return 0;
  return (d1.x * d2y - d1.y * d2x) / (sp * sp * sp);
}

/**
 * Catmull-Rom tangents for a polyline. `alpha` 0.5 = centripetal (no cusps or
 * self-intersections on uneven point spacing — important for hand-drawn roads).
 */
export function catmullRomTangents(pts, closed = false, alpha = 0.5, tension = 1) {
  const n = pts.length;
  const m = new Array(n);
  const at = (i) => {
    if (closed) return pts[(i + n) % n];
    return pts[clamp(i, 0, n - 1)];
  };
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1);
    if (closed || (i > 0 && i < n - 1)) {
      if (alpha === 0) {
        m[i] = mul2(sub2(p2, p0), 0.5 * tension);
      } else {
        const d01 = Math.pow(dist2(p0, p1), alpha) || 1e-6;
        const d12 = Math.pow(dist2(p1, p2), alpha) || 1e-6;
        const t01 = mul2(sub2(p1, p0), 1 / d01);
        const t12 = mul2(sub2(p2, p1), 1 / d12);
        const blend = mul2(add2(t01, t12), (d01 + d12) * 0.5 * tension);
        m[i] = blend;
      }
    } else {
      m[i] = mul2(sub2(p2, p1), tension);
    }
  }
  return m;
}

/* --------------------------------------------------------------- Curve ---- */

/**
 * A resampled curve: an arc-length table over a Catmull-Rom / Hermite spline
 * through control points. Provides position/tangent/curvature at ANY distance,
 * which is what the road extruder needs.
 */
export class Curve {
  /** @param {{x:number,y:number}[]} pts  control points (planar) */
  constructor(pts, { closed = false, alpha = 0.5, tension = 1, resample = 64 } = {}) {
    this.pts = pts.map((p) => ({ x: p.x, y: p.y }));
    this.closed = closed;
    this.alpha = alpha;
    this.tension = tension;
    if (this.pts.length < 2) this.pts.push({ x: this.pts[0].x + 1, y: this.pts[0].y });
    this._build(resample);
  }

  _build(resample) {
    const pts = this.pts;
    const n = pts.length;
    this.m = catmullRomTangents(pts, this.closed, this.alpha, this.tension);
    const segs = this.closed ? n : n - 1;
    const per = Math.max(8, Math.ceil(resample / Math.max(1, segs)));

    // dense polyline sample -> arc length table
    const samples = [];
    let total = 0;
    for (let s = 0; s < segs; s++) {
      const i0 = s, i1 = (s + 1) % n;
      const p0 = pts[i0], p1 = pts[i1], m0 = this.m[i0], m1 = this.m[i1];
      for (let k = 0; k <= per; k++) {
        if (s > 0 && k === 0) continue;
        const t = k / per;
        const p = hermite(p0, m0, p1, m1, t, { x: 0, y: 0 });
        if (samples.length) {
          const prev = samples[samples.length - 1];
          total += Math.hypot(p.x - prev.x, p.y - prev.y);
        }
        samples.push({ x: p.x, y: p.y, s: total, seg: s, t });
      }
    }
    this.length = total;
    this.samples = samples;
    this.segs = segs;
  }

  /** Local (seg, t) at arc-length distance d. */
  _locate(d) {
    const S = this.samples;
    if (d <= 0) return { seg: 0, t: 0 };
    if (d >= this.length) return { seg: this.segs - 1, t: 1, end: true };
    // binary search
    let lo = 0, hi = S.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (S[mid].s <= d) lo = mid; else hi = mid;
    }
    const a = S[lo], b = S[hi];
    const span = b.s - a.s || 1e-9;
    const f = (d - a.s) / span;
    // a and b normally live in the same cubic segment
    if (a.seg === b.seg) {
      return { seg: a.seg, t: lerp(a.t, b.t, f) };
    }
    return { seg: f < 0.5 ? a.seg : b.seg, t: f < 0.5 ? a.t : b.t };
  }

  /** Position at arc-length d. */
  pos(d, out = { x: 0, y: 0 }) {
    const { seg, t } = this._locate(d);
    const n = this.pts.length;
    const i0 = seg, i1 = (seg + 1) % n;
    return hermite(this.pts[i0], this.m[i0], this.pts[i1], this.m[i1], t, out);
  }

  /** Unit tangent at arc-length d. */
  tangent(d, out = { x: 1, y: 0 }) {
    const { seg, t } = this._locate(d);
    const n = this.pts.length;
    const i0 = seg, i1 = (seg + 1) % n;
    hermiteTangent(this.pts[i0], this.m[i0], this.pts[i1], this.m[i1], t, out);
    const l = Math.hypot(out.x, out.y) || 1;
    out.x /= l; out.y /= l;
    return out;
  }

  /** Signed curvature (1/radius) at arc-length d. Positive = turning left. */
  curvature(d) {
    const { seg, t } = this._locate(d);
    const n = this.pts.length;
    const i0 = seg, i1 = (seg + 1) % n;
    return hermiteCurvature(this.pts[i0], this.m[i0], this.pts[i1], this.m[i1], t);
  }

  /**
   * Full orthonormal frame at d.
   * right = perpendicular to tangent in the ground plane (lateral axis).
   */
  frame(d) {
    const p = this.pos(d, { x: 0, y: 0 });
    const t = this.tangent(d, { x: 0, y: 0 });
    return { p, t, r: { x: -t.y, y: t.x }, k: this.curvature(d) };
  }

  /** Uniformly spaced frames — the station list the extruder walks. */
  stations(step, { minStep = 0.6, maxStep = 40 } = {}) {
    const L = this.length;
    if (L < 1e-6) return [];
    // curvature-adaptive: tighter curves get denser stations
    const raw = [];
    let d = 0;
    let guard = 0;
    while (d < L && guard++ < 20000) {
      const k = Math.abs(this.curvature(d));
      // radius -> clamp the step so the chord error stays under ~2 cm
      const r = k > 1e-7 ? 1 / k : Infinity;
      const adaptive = r === Infinity ? step : Math.min(step, Math.sqrt(Math.max(0.0001, 2 * 0.02 * r)));
      const s = clamp(Math.min(adaptive, step), minStep, maxStep);
      raw.push(d);
      d += s;
    }
    raw.push(L);
    return raw;
  }

  /** Nearest arc-length distance to a planar point (coarse + refine). */
  nearest(x, y) {
    const S = this.samples;
    let best = Infinity, bestS = 0;
    for (let i = 0; i < S.length; i++) {
      const dx = S[i].x - x, dy = S[i].y - y;
      const d2v = dx * dx + dy * dy;
      if (d2v < best) { best = d2v; bestS = S[i].s; }
    }
    // golden-section refine around bestS
    let lo = Math.max(0, bestS - (this.length / S.length) * 2);
    let hi = Math.min(this.length, bestS + (this.length / S.length) * 2);
    for (let i = 0; i < 24; i++) {
      const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
      const p1 = this.pos(m1, { x: 0, y: 0 }), p2 = this.pos(m2, { x: 0, y: 0 });
      if ((p1.x - x) ** 2 + (p1.y - y) ** 2 < (p2.x - x) ** 2 + (p2.y - y) ** 2) hi = m2;
      else lo = m1;
    }
    return (lo + hi) * 0.5;
  }

  bounds() {
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (const p of this.pts) {
      mnx = Math.min(mnx, p.x); mny = Math.min(mny, p.y);
      mxx = Math.max(mxx, p.x); mxy = Math.max(mxy, p.y);
    }
    return { mnx, mny, mxx, mxy };
  }
}

/* ------------------------------------------------------------- terrain ---- */

/** Cheap smooth value-noise field used for terrain height + surface jitter. */
export class NoiseField {
  constructor(seed = 1, size = 256) {
    this.size = size;
    const rng = makeRNG(seed);
    this.g = new Float32Array(size * size);
    for (let i = 0; i < this.g.length; i++) this.g[i] = rng() * 2 - 1;
  }
  _at(ix, iy) {
    const s = this.size;
    return this.g[(((iy % s) + s) % s) * s + (((ix % s) + s) % s)];
  }
  sample(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = x - x0, fy = y - y0;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const a = this._at(x0, y0), b = this._at(x0 + 1, y0);
    const c = this._at(x0, y0 + 1), d = this._at(x0 + 1, y0 + 1);
    return lerp(lerp(a, b, ux), lerp(c, d, ux), uy);
  }
  fbm(x, y, octaves = 4, lac = 2, gain = 0.5) {
    let f = 1, a = 1, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += a * this.sample(x * f, y * f);
      norm += a;
      f *= lac; a *= gain;
    }
    return sum / (norm || 1);
  }
}

/* ------------------------------------------------------------ geometry ---- */

/** Signed area of a simple polygon (positive = counter-clockwise in x/z). */
export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a * 0.5;
}

export function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-20) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Ear-clipping triangulation of a simple polygon.
 * @returns {number[]} flat index triples
 */
export function triangulate(poly) {
  const n = poly.length;
  if (n < 3) return [];
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (polygonArea(poly) < 0) idx.reverse(); // force CCW
  const tris = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < n * n + 1000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const a = poly[i0], b = poly[i1], c = poly[i2];
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (area <= 1e-12) continue; // reflex / degenerate
      // no other vertex inside this ear
      let ok = true;
      for (const k of idx) {
        if (k === i0 || k === i1 || k === i2) continue;
        const p = poly[k];
        const d1 = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        const d2 = (c.x - b.x) * (p.y - b.y) - (c.y - b.y) * (p.x - b.x);
        const d3 = (a.x - c.x) * (p.y - c.y) - (a.y - c.y) * (p.x - c.x);
        if (d1 >= -1e-9 && d2 >= -1e-9 && d3 >= -1e-9) { ok = false; break; }
      }
      if (!ok) continue;
      tris.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // fallback: fan from 0
  }
  if (idx.length === 3) tris.push(idx[0], idx[1], idx[2]);
  else if (idx.length > 3) {
    for (let i = 1; i < idx.length - 1; i++) tris.push(idx[0], idx[i], idx[i + 1]);
  }
  return tris;
}

/**
 * Offset a polyline outward by `d`, inserting rounded joins.
 * Used to build the sidewalk ring around a junction polygon.
 */
export function offsetPolygon(poly, d, cornerRadius = 0) {
  const n = poly.length;
  const ccw = polygonArea(poly) > 0;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n], cur = poly[i], next = poly[(i + 1) % n];
    const e0 = norm2(sub2(cur, prev));
    const e1 = norm2(sub2(next, cur));
    const n0 = { x: -e0.y, y: e0.x };
    const n1 = { x: -e1.y, y: e1.x };
    // mitre
    const bis = norm2(add2(n0, n1));
    const denom = dot2(bis, n1);
    const mitre = denom > 0.2 ? d / denom : d;
    const px = cur.x + bis.x * Math.min(mitre, d * 4);
    const py = cur.y + bis.y * Math.min(mitre, d * 4);
    if (cornerRadius > 0.05) {
      // insert an arc: step back along each edge and round the corner
      const cr = Math.min(cornerRadius, dist2(prev, cur) * 0.45, dist2(cur, next) * 0.45);
      const a = { x: cur.x + n0.x * d - e0.x * cr, y: cur.y + n0.y * d - e0.y * cr };
      const b = { x: cur.x + n1.x * d + e1.x * cr, y: cur.y + n1.y * d + e1.y * cr };
      const apex = { x: px, y: py };
      const segs = 4;
      out.push(a);
      for (let k = 1; k < segs; k++) {
        const t = k / segs;
        // quadratic bezier a -> apex -> b
        const q = (p, q2, r) => ({
          x: (1 - t) * (1 - t) * p.x + 2 * (1 - t) * t * q2.x + t * t * r.x,
          y: (1 - t) * (1 - t) * p.y + 2 * (1 - t) * t * q2.y + t * t * r.y,
        });
        out.push(q(a, apex, b));
      }
      out.push(b);
    } else {
      out.push({ x: px, y: py });
    }
  }
  return ccw ? out : out.reverse();
}

/** Resample a closed polygon so no edge exceeds `maxLen`. */
export function densifyPolygon(poly, maxLen) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const d = dist2(a, b);
    const steps = Math.max(1, Math.ceil(d / maxLen));
    for (let k = 0; k < steps; k++) {
      out.push({ x: lerp(a.x, b.x, k / steps), y: lerp(a.y, b.y, k / steps) });
    }
  }
  return out;
}

/* ------------------------------------------------------- mesh helpers ---- */

/**
 * Emit a quad into an index buffer (two triangles, CCW when a,b,c,d are given
 * in ring order).
 */
export function pushQuad(idx, a, b, c, d) {
  idx.push(a, b, c, a, c, d);
}

/** Catmull-Rom sampled height helper for smooth vertical profiles. */
export function smoothProfile(heights, iterations = 2) {
  const h = heights.slice();
  for (let it = 0; it < iterations; it++) {
    const c = h.slice();
    for (let i = 1; i < h.length - 1; i++) {
      h[i] = c[i] * 0.5 + (c[i - 1] + c[i + 1]) * 0.25;
    }
  }
  return h;
}
