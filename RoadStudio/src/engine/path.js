// Road centrelines: centripetal Catmull-Rom splines resampled to uniform arc length.
// A path is { pts, L, ds, n } where pts[k] is the position at arc length k * ds.
import { sub, scale, lerp, dist, norm, rightOf, horiz } from './math.js';

function interp(pa, pb, ta, tb, t) {
  const d = tb - ta || 1e-6;
  const w1 = (tb - t) / d, w2 = (t - ta) / d;
  return [pa[0] * w1 + pb[0] * w2, pa[1] * w1 + pb[1] * w2, pa[2] * w1 + pb[2] * w2];
}

export function catmullRom(ctrl, per = 24) {
  const n = ctrl.length;
  if (n < 2) return ctrl.map((p) => p.slice());
  const c0 = ctrl[0], c1 = ctrl[1], cl = ctrl[n - 1], cp = ctrl[n - 2];
  const ext = [
    sub(scale(c0, 2), c1),
    ...ctrl,
    sub(scale(cl, 2), cp),
  ];
  const out = [];
  for (let k = 0; k < n - 1; k++) {
    const p0 = ext[k], p1 = ext[k + 1], p2 = ext[k + 2], p3 = ext[k + 3];
    const t0 = 0;
    const t1 = t0 + Math.pow(Math.max(dist(p0, p1), 1e-4), 0.5);
    const t2 = t1 + Math.pow(Math.max(dist(p1, p2), 1e-4), 0.5);
    const t3 = t2 + Math.pow(Math.max(dist(p2, p3), 1e-4), 0.5);
    for (let j = 0; j < per; j++) {
      const t = t1 + ((t2 - t1) * j) / per;
      const A1 = interp(p0, p1, t0, t1, t);
      const A2 = interp(p1, p2, t1, t2, t);
      const A3 = interp(p2, p3, t2, t3, t);
      const B1 = interp(A1, A2, t0, t2, t);
      const B2 = interp(A2, A3, t1, t3, t);
      out.push(interp(B1, B2, t1, t2, t));
    }
  }
  out.push(ctrl[n - 1].slice());
  return out;
}

export function buildPath(ctrl, step = 0.5) {
  const dense = catmullRom(ctrl, 24);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dist(dense[i - 1], dense[i]));
  const L = cum[cum.length - 1];
  const n = Math.max(2, Math.ceil(L / step));
  const ds = L / n;
  const pts = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const target = Math.min(L, k * ds);
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j] || 1e-9;
    const t = Math.min(1, Math.max(0, (target - cum[j]) / seg));
    pts.push(lerp(dense[j], dense[j + 1], t));
  }
  return { pts, L, ds, n, ctrl };
}

// Position, 3D tangent, horizontal heading and right-hand normal at arc length s.
export function at(path, s) {
  const s1 = Math.min(path.L, Math.max(0, s));
  const f = s1 / path.ds;
  const i = Math.min(path.n - 1, Math.floor(f));
  const t = f - i;
  const p = lerp(path.pts[i], path.pts[i + 1], t);
  const d = sub(path.pts[i + 1], path.pts[i]);
  const tan = norm(d);
  let h = horiz(d);
  if (!Number.isFinite(h[0]) || (h[0] === 0 && h[2] === 0)) h = [1, 0, 0];
  return { p, t: tan, h, r: rightOf(h) };
}


