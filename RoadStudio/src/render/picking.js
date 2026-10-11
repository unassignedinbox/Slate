// Screen-space helpers: world to CSS pixels, pixels to a ground-plane point.
import { transform } from '../engine/math.js';

export function toScreen(vp, p, w, h) {
  const c = transform(vp, [p[0], p[1], p[2], 1]);
  if (c[3] <= 0.0001) return null;
  const x = c[0] / c[3], y = c[1] / c[3];
  return [(x * 0.5 + 0.5) * w, (0.5 - y * 0.5) * h];
}

// Returns the world-space ray through a CSS pixel position: { o, d }.
export function rayFromPixel(invVP, sx, sy, w, h) {
  const nx = (sx / w) * 2 - 1;
  const ny = 1 - (sy / h) * 2;
  const a = transform(invVP, [nx, ny, 0, 1]);
  const b = transform(invVP, [nx, ny, 1, 1]);
  const o = [a[0] / a[3], a[1] / a[3], a[2] / a[3]];
  const f = [b[0] / b[3], b[1] / b[3], b[2] / b[3]];
  const d = [f[0] - o[0], f[1] - o[1], f[2] - o[2]];
  const l = Math.hypot(d[0], d[1], d[2]) || 1;
  return { o, d: [d[0] / l, d[1] / l, d[2] / l] };
}

// Intersection of a ray with the horizontal plane y = planeY.
export function groundHit(ray, planeY = 0) {
  if (Math.abs(ray.d[1]) < 1e-6) return null;
  const t = (planeY - ray.o[1]) / ray.d[1];
  if (t < 0) return null;
  return [ray.o[0] + ray.d[0] * t, planeY, ray.o[2] + ray.d[2] * t];
}

// Distance in pixels from a point to a screen polyline.
export function distToPolyline(pt, pts) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1];
    const vx = b[0] - a[0], vy = b[1] - a[1];
    const L2 = vx * vx + vy * vy || 1e-9;
    const t = Math.max(0, Math.min(1, ((pt[0] - a[0]) * vx + (pt[1] - a[1]) * vy) / L2));
    const dx = a[0] + vx * t - pt[0], dy = a[1] + vy * t - pt[1];
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}
