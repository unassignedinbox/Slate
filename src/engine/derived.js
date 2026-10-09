// Cached derived terrain fields (slope, curvature, flow, gradients) keyed by state version.
import { slopeOf, curvatureOf, gradient, fillDepressions, d8Receivers, flowAccumulation } from './grid.js';

export function cacheFor(st) {
  if (st._derived && st._derived.version === st.version) return st._derived.data;
  const N = st.N, h = st.h;
  const { gx, gy } = gradient(h, N);
  const slope = slopeOf(h, N, st.heightScale ?? 1);
  const curv = curvatureOf(h, N, 2);
  const filled = fillDepressions(h, N);
  const recv = d8Receivers(filled, N);
  const { acc } = flowAccumulation(filled, N, recv);
  const lg = new Float32Array(acc.length);
  let mx = 1;
  for (let i = 0; i < acc.length; i++) { lg[i] = Math.log(acc[i]); if (lg[i] > mx) mx = lg[i]; }
  for (let i = 0; i < lg.length; i++) lg[i] /= mx;
  const data = { gx, gy, slope, curv, acc, flow: lg, recv };
  st._derived = { version: st.version, data };
  return data;
}
