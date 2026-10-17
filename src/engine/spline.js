// Routes: a smooth centreline through designer control points, resampled at a
// uniform arc-length step so that every sample has a stable tangent.
//
// Centripetal Catmull-Rom avoids the loops and overshoot that uniform
// Catmull-Rom produces when control points are unevenly spaced, which matters
// for the long, meandering roads in this level.

import { dist, norm, frameFromForward, lerpV } from './math.js';

function lerpPt(a, b, ta, tb, t) {
  const d = tb - ta;
  const w1 = (tb - t) / d;
  const w2 = (t - ta) / d;
  return [w1 * a[0] + w2 * b[0], w1 * a[1] + w2 * b[1], w1 * a[2] + w2 * b[2]];
}

// Barry–Goldman evaluation of one centripetal Catmull-Rom segment.
function evalSegment(p0, p1, p2, p3, t0, t1, t2, t3, t) {
  const A1 = lerpPt(p0, p1, t0, t1, t);
  const A2 = lerpPt(p1, p2, t1, t2, t);
  const A3 = lerpPt(p2, p3, t2, t3, t);
  const B1 = lerpPt(A1, A2, t0, t2, t);
  const B2 = lerpPt(A2, A3, t1, t3, t);
  return lerpPt(B1, B2, t1, t2, t);
}

export function sampleCentripetal(points, perSegment = 24) {
  if (points.length < 2) throw new Error('A route needs at least two control points');
  const first = points[0].map((v, i) => 2 * v - points[1][i]);
  const last = points[points.length - 1].map((v, i) => 2 * v - points[points.length - 2][i]);
  const Q = [first, ...points, last];
  const out = [];
  for (let i = 1; i < Q.length - 2; i++) {
    const p0 = Q[i - 1];
    const p1 = Q[i];
    const p2 = Q[i + 1];
    const p3 = Q[i + 2];
    const t0 = 0;
    const t1 = t0 + Math.pow(Math.max(dist(p0, p1), 1e-6), 0.5);
    const t2 = t1 + Math.pow(Math.max(dist(p1, p2), 1e-6), 0.5);
    const t3 = t2 + Math.pow(Math.max(dist(p2, p3), 1e-6), 0.5);
    for (let k = 0; k < perSegment; k++) {
      const t = t1 + ((t2 - t1) * k) / perSegment;
      out.push(evalSegment(p0, p1, p2, p3, t0, t1, t2, t3, t));
    }
  }
  out.push(points[points.length - 1].slice());
  return out;
}

// Build a Route: uniform 1 m samples, tangents, cumulative distance.
export function buildRoute(id, controlPoints, { step = 1 } = {}) {
  const dense = sampleCentripetal(controlPoints);
  // Cumulative arc length of the dense polyline.
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dist(dense[i - 1], dense[i]));
  const length = cum[cum.length - 1];
  const count = Math.max(2, Math.round(length / step) + 1);
  const pts = [];
  let j = 0;
  for (let i = 0; i < count; i++) {
    const s = Math.min(length, (i * length) / (count - 1));
    while (j < cum.length - 2 && cum[j + 1] < s) j++;
    const seg = cum[j + 1] - cum[j] || 1;
    const u = Math.min(1, Math.max(0, (s - cum[j]) / seg));
    pts.push(lerpV(dense[j], dense[j + 1], u));
  }
  const n = pts.length;
  const spacing = length / (n - 1);
  // Tangents from a smoothed central difference (window of ±2 samples).
  const tan = pts.map((_, i) => {
    const a = pts[Math.max(0, i - 2)];
    const b = pts[Math.min(n - 1, i + 2)];
    return norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  });
  return { id, length, spacing, s: pts.map((_, i) => i * spacing), pts, tan, controlPoints };
}

// Position + frame along a route at arc length s (metres from route start).
export function routeAt(route, s) {
  const sc = Math.min(route.length, Math.max(0, s));
  const f = sc / route.spacing;
  const i = Math.min(route.pts.length - 2, Math.floor(f));
  const u = f - i;
  const p = lerpV(route.pts[i], route.pts[i + 1], u);
  const F = norm(lerpV(route.tan[i], route.tan[i + 1], u));
  const { R, N } = frameFromForward(F);
  return { s: sc, p, F, R, N };
}

// Nearest arc-length to a point, searching a window around a hint (fast in
// the common case where the car moves forward along the route).
export function nearestS(route, p, hintS = 0, window = 40) {
  const lo = Math.max(0, Math.floor((hintS - window) / route.spacing));
  const hi = Math.min(route.pts.length - 1, Math.ceil((hintS + window) / route.spacing));
  let best = lo;
  let bestD = Infinity;
  for (let i = lo; i <= hi; i++) {
    const q = route.pts[i];
    const dx = q[0] - p[0];
    const dz = q[2] - p[2];
    const d = dx * dx + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return route.s[best];
}
