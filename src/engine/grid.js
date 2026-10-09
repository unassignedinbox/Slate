// Grid utilities for square heightfields stored as row-major Float32Array(N*N).
import { hash2 } from './noise.js';

export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a || 1e-9));
  return t * t * (3 - 2 * t);
};

export function make(N, v = 0) {
  const a = new Float32Array(N * N);
  if (v) a.fill(v);
  return a;
}

export function minmax(a) {
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < a.length; i++) {
    const v = a[i];
    if (Number.isNaN(v)) continue;
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  return [mn, mx];
}

export function normalize(a) {
  const [mn, mx] = minmax(a);
  const out = new Float32Array(a.length);
  const r = mx - mn || 1;
  for (let i = 0; i < a.length; i++) out[i] = (a[i] - mn) / r;
  return out;
}

// Bilinear sample with clamped edges, in cell coordinates.
export function sample(a, N, x, y) {
  x = clamp(x, 0, N - 1.001); y = clamp(y, 0, N - 1.001);
  const x0 = x | 0, y0 = y | 0, tx = x - x0, ty = y - y0;
  const i = y0 * N + x0;
  const top = a[i] + (a[i + 1] - a[i]) * tx;
  const bot = a[i + N] + (a[i + N + 1] - a[i + N]) * tx;
  return top + (bot - top) * ty;
}

// Separable box blur with running sums, edge-clamped.
export function boxBlur(src, N, r) {
  if (r < 1) return Float32Array.from(src);
  const tmp = new Float32Array(N * N), out = new Float32Array(N * N);
  const inv = 1 / (2 * r + 1);
  for (let y = 0; y < N; y++) {
    const row = y * N;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[row + clamp(k, 0, N - 1)];
    for (let x = 0; x < N; x++) {
      tmp[row + x] = acc * inv;
      acc += src[row + clamp(x + r + 1, 0, N - 1)] - src[row + clamp(x - r, 0, N - 1)];
    }
  }
  for (let x = 0; x < N; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, N - 1) * N + x];
    for (let y = 0; y < N; y++) {
      out[y * N + x] = acc * inv;
      acc += tmp[clamp(y + r + 1, 0, N - 1) * N + x] - tmp[clamp(y - r, 0, N - 1) * N + x];
    }
  }
  return out;
}

export function gaussBlur(src, N, sigma) {
  if (sigma <= 0.05) return Float32Array.from(src);
  // three box passes approximate a gaussian
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  let o = boxBlur(src, N, r);
  o = boxBlur(o, N, r);
  return boxBlur(o, N, r);
}

// Central-difference gradient in cell units.
export function gradient(h, N) {
  const gx = new Float32Array(N * N), gy = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const xl = x > 0 ? x - 1 : x, xr = x < N - 1 ? x + 1 : x;
    const yu = y > 0 ? y - 1 : y, yd = y < N - 1 ? y + 1 : y;
    const i = y * N + x;
    gx[i] = (h[y * N + xr] - h[y * N + xl]) * 0.5 / Math.max(1, xr - xl);
    gy[i] = (h[yd * N + x] - h[yu * N + x]) * 0.5 / Math.max(1, yd - yu);
  }
  return { gx, gy };
}

// Slope in [0,1] where 1 means ~90 degrees. heightScale maps unit height to cells.
export function slopeOf(h, N, heightScale = 1) {
  const { gx, gy } = gradient(h, N);
  const out = new Float32Array(N * N);
  for (let i = 0; i < out.length; i++) {
    const g = Math.hypot(gx[i], gy[i]) * heightScale * N / 256;
    out[i] = clamp01(Math.atan(g) / (Math.PI / 2));
  }
  return out;
}

// Laplacian curvature: positive = convex (ridge), negative = concave (valley).
export function curvatureOf(h, N, radius = 2) {
  const b = boxBlur(h, N, radius);
  const out = new Float32Array(N * N);
  let mx = 1e-9;
  for (let i = 0; i < out.length; i++) { out[i] = b[i] - h[i]; mx = Math.max(mx, Math.abs(out[i])); }
  for (let i = 0; i < out.length; i++) out[i] = 0.5 + 0.5 * out[i] / mx;
  return out; // 0.5 = flat, >0.5 convex, <0.5 concave
}

// Priority-flood depression filling (Barnes et al. 2014 style, epsilon-free).
export function fillDepressions(h, N) {
  const filled = new Float32Array(h.length);
  const open = new Uint8Array(h.length);
  // binary heap of [height, index]
  const heapH = [], heapI = [];
  const push = (hv, i) => {
    heapH.push(hv); heapI.push(i);
    let k = heapH.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapH[p] <= heapH[k]) break;
      [heapH[p], heapH[k]] = [heapH[k], heapH[p]];
      [heapI[p], heapI[k]] = [heapI[k], heapI[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heapI[0];
    const lastH = heapH.pop(), lastI = heapI.pop();
    if (heapH.length) {
      heapH[0] = lastH; heapI[0] = lastI;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heapH.length && heapH[l] < heapH[m]) m = l;
        if (r < heapH.length && heapH[r] < heapH[m]) m = r;
        if (m === k) break;
        [heapH[m], heapH[k]] = [heapH[k], heapH[m]];
        [heapI[m], heapI[k]] = [heapI[k], heapI[m]];
        k = m;
      }
    }
    return top;
  };
  for (let x = 0; x < N; x++) for (const y of [0, N - 1]) {
    const i = y * N + x; open[i] = 1; filled[i] = h[i]; push(h[i], i);
  }
  for (let y = 1; y < N - 1; y++) for (const x of [0, N - 1]) {
    const i = y * N + x; open[i] = 1; filled[i] = h[i]; push(h[i], i);
  }
  const eps = 1e-6;
  while (heapI.length) {
    const i = pop();
    const x = i % N, y = (i / N) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      if (open[j]) continue;
      open[j] = 1;
      filled[j] = Math.max(h[j], filled[i] + eps);
      push(filled[j], j);
    }
  }
  return filled;
}

const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
const D8W = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

// D8 steepest-descent receiver for each cell. Pits receive themselves.
export function d8Receivers(h, N) {
  const recv = new Int32Array(h.length);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x;
    let best = 0, bi = i;
    for (let k = 0; k < 8; k++) {
      const nx = x + D8[k][0], ny = y + D8[k][1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const j = ny * N + nx;
      const drop = (h[i] - h[j]) / D8W[k];
      if (drop > best) { best = drop; bi = j; }
    }
    recv[i] = bi;
  }
  return recv;
}

// Flow accumulation (number of upstream cells, including self) on a filled surface.
export function flowAccumulation(h, N, recv = d8Receivers(fillDepressions(h, N), N)) {
  const order = new Uint32Array(h.length);
  for (let i = 0; i < order.length; i++) order[i] = i;
  const sorted = Array.from(order).sort((a, b) => h[b] - h[a]);
  const acc = new Float32Array(h.length).fill(1);
  for (const i of sorted) {
    const r = recv[i];
    if (r !== i) acc[r] += acc[i];
  }
  return { acc, recv };
}

export function hashNoise2(x, y, seed) { return hash2(x, y, seed); }
