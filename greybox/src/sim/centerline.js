// Turns hand-placed control points into an evenly spaced centreline.
//
// Control point format: [x, z, y, type]
//   x, z : shard-local position in metres (x = east, z = north, y = up)
//   y    : height of the road surface at this point (m)
//   type : what the road is made of for the segment STARTING at this point:
//          'street' : ground-level road
//          'ramp'   : climbing / descending road
//          'roof'   : road running over a building roof (building must sit underneath)
//          'bridge' : raised span across a hole in the shard
//          'gap'    : fractured section with no road. Car must jump it (see DESIGN.md)

import { T } from './tuning.js';

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// Centripetal Catmull-Rom (alpha = 0.5). Avoids the loops and overshoot of uniform splines.
function crPoint(p0, p1, p2, p3, u) {
  const t0 = 0;
  const t1 = t0 + Math.pow(dist3(p0, p1), 0.5);
  const t2 = t1 + Math.pow(dist3(p1, p2), 0.5);
  const t3 = t2 + Math.pow(dist3(p2, p3), 0.5);
  const t = t1 + (t2 - t1) * u;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const A1 = ((t1 - t) / (t1 - t0)) * p0[k] + ((t - t0) / (t1 - t0)) * p1[k];
    const A2 = ((t2 - t) / (t2 - t1)) * p1[k] + ((t - t1) / (t2 - t1)) * p2[k];
    const A3 = ((t3 - t) / (t3 - t2)) * p2[k] + ((t - t2) / (t3 - t2)) * p3[k];
    const B1 = ((t2 - t) / (t2 - t0)) * A1 + ((t - t0) / (t2 - t0)) * A2;
    const B2 = ((t3 - t) / (t3 - t1)) * A2 + ((t - t1) / (t3 - t1)) * A3;
    out[k] = ((t2 - t) / (t2 - t1)) * B1 + ((t - t1) / (t2 - t1)) * B2;
  }
  return out;
}

// Returns { x[], y[], z[], type[] } sampled every T.step metres, plus total length.
export function buildCenterline(controls) {
  const P = controls.map((c) => [c[0], c[2], c[1]]); // -> [x, y, z]
  const types = controls.map((c) => c[3] || 'street');
  const n = P.length;
  if (n < 2) throw new Error('centerline needs at least 2 control points');

  // 1. Dense polyline along the spline.
  const dense = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = i > 0 ? P[i - 1] : P[0].map((v, k) => 2 * v - P[1][k]);
    const p3 = i + 2 < n ? P[i + 2] : P[n - 1].map((v, k) => 2 * v - P[n - 2][k]);
    const m = Math.max(4, Math.ceil(dist3(P[i], P[i + 1]) / 0.2));
    for (let k = 0; k < m; k++) {
      const p = crPoint(p0, P[i], P[i + 1], p3, k / m);
      dense.push({ p, type: types[i] });
    }
  }
  dense.push({ p: P[n - 1], type: types[n - 1] });

  // 2. Cumulative arc length on the dense polyline.
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dist3(dense[i - 1].p, dense[i].p));
  const total = cum[cum.length - 1];

  // 3. Resample at exact spacing.
  const count = Math.floor(total / T.step) + 1;
  const out = { x: [], y: [], z: [], type: [], length: (count - 1) * T.step };
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = Math.min(k * T.step, total);
    while (j < cum.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j];
    const f = seg > 1e-9 ? (target - cum[j]) / seg : 0;
    const a = dense[j].p;
    const b = dense[Math.min(j + 1, dense.length - 1)].p;
    out.x.push(a[0] + (b[0] - a[0]) * f);
    out.y.push(a[1] + (b[1] - a[1]) * f);
    out.z.push(a[2] + (b[2] - a[2]) * f);
    out.type.push(dense[j].type);
  }
  return out;
}
