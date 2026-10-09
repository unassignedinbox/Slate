// Slate — procedural noise primitives. All deterministic in (x, y, seed).
import { hash2, hash2s, clamp, lerp, TAU } from './util.js';

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const fadeQ = (t) => t * t * (3 - 2 * t);

// Classic Perlin gradient noise, ~[-1,1].
export function perlin(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const g = (ix, iy) => {
    const h = hash2(ix, iy, seed);
    const a = h * TAU;
    return [Math.cos(a), Math.sin(a)];
  };
  const u = fade(xf), v = fade(yf);
  const [g00x, g00y] = g(xi, yi), [g10x, g10y] = g(xi + 1, yi);
  const [g01x, g01y] = g(xi, yi + 1), [g11x, g11y] = g(xi + 1, yi + 1);
  const n00 = g00x * xf + g00y * yf, n10 = g10x * (xf - 1) + g10y * yf;
  const n01 = g01x * xf + g01y * (yf - 1), n11 = g11x * (xf - 1) + g11y * (yf - 1);
  return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4142;
}

// 2D simplex noise, ~[-1,1].
const GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
export function simplex(x, y, seed = 0) {
  const F2 = 0.3660254037844386, G2 = 0.21132486540518713;
  const s = (x + y) * F2;
  const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const gi0 = Math.floor(hash2(i, j, seed) * 8) % 8;
  const gi1 = Math.floor(hash2(i + i1, j + j1, seed) * 8) % 8;
  const gi2 = Math.floor(hash2(i + 1, j + 1, seed) * 8) % 8;
  let n = 0, tt;
  tt = 0.5 - x0 * x0 - y0 * y0;
  if (tt > 0) { tt *= tt; const g = GRAD[gi0]; n += tt * tt * (g[0] * x0 + g[1] * y0); }
  tt = 0.5 - x1 * x1 - y1 * y1;
  if (tt > 0) { tt *= tt; const g = GRAD[gi1]; n += tt * tt * (g[0] * x1 + g[1] * y1); }
  tt = 0.5 - x2 * x2 - y2 * y2;
  if (tt > 0) { tt *= tt; const g = GRAD[gi2]; n += tt * tt * (g[0] * x2 + g[1] * y2); }
  return n * 70;
}

// Value noise, [0,1].
export function valueNoise(x, y, seed = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = fadeQ(x - xi), yf = fadeQ(y - yi);
  const a = hash2(xi, yi, seed), b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed), d = hash2(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, xf), lerp(c, d, xf), yf);
}

// Worley / Voronoi distances. Returns [F1, F2, F3, F4, cellId] with jitter.
export function worley(x, y, seed = 0, jitter = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const ds = [];
  let id = 0;
  for (let j = yi - 1; j <= yi + 1; j++) for (let i = xi - 1; i <= xi + 1; i++) {
    const px = i + 0.5 + (hash2(i, j, seed) - 0.5) * 2 * jitter * 0.5 + (hash2(i, j, seed ^ 0x9e37) - 0.5) * jitter * 0;
    const py = j + 0.5 + (hash2(i, j, seed ^ 0x51f3) - 0.5) * jitter;
    // note: px uses single hash term; keep symmetric:
    const qx = i + 0.5 + (hash2(i, j, seed) - 0.5) * jitter;
    const d = Math.hypot(qx - x, py - y);
    ds.push(d);
    if (d < (ds.best ?? Infinity)) { ds.best = d; id = hash2(i, j, seed ^ 0xabcd); }
  }
  ds.sort((a, b) => a - b);
  while (ds.length < 4) ds.push(ds[ds.length - 1] ?? 1);
  return [ds[0], ds[1], ds[2], ds[3], id];
}
export function voronoiCrackle(x, y, seed = 0, jitter = 1) {
  const [f1, f2] = worley(x, y, seed, jitter);
  return clamp(f2 - f1, 0, 1.5) / 1.5;
}

// Cellular-automata pattern: run a tiny CA seeded by hashed soup, sample result.
// Implemented as: 3x3 neighbourhood hash diffusion over a few steps — cheap per-pixel approx.
export function cellular(x, y, seed = 0, steps = 4) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let a = hash2(xi, yi, seed);
  for (let s = 0; s < steps; s++) {
    let n = 0;
    n += hash2(xi + 1 + s, yi, seed ^ (s * 7919));
    n += hash2(xi - 1 - s, yi + 1, seed ^ (s * 104729));
    n += hash2(xi, yi + 1 + s, seed ^ (s * 1299709));
    n += hash2(xi + 1, yi - 1 - s, seed ^ (s * 15485863));
    a = (a * 0.5 + n * 0.125 + hash2(xi + s, yi - s, seed ^ 0x1234) * 0.25) % 1;
  }
  // smooth within cell for continuity
  const xf = fadeQ(x - xi), yf = fadeQ(y - yi);
  const b = hash2(xi + 1, yi, seed ^ 0x77) * 0.15, c = hash2(xi, yi + 1, seed ^ 0x77) * 0.15;
  return clamp(a + (b - 0.075) * xf + (c - 0.075) * yf, 0, 1);
}

// Gabor noise approximation: sparse kernels * oriented cos wave * gaussian envelope.
export function gabor(x, y, seed = 0, freq = 4, angle = 0.6, bandwidth = 1.2) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let sum = 0, wsum = 0;
  for (let j = yi - 1; j <= yi + 1; j++) for (let i = xi - 1; i <= xi + 1; i++) {
    const px = i + hash2(i, j, seed), py = j + hash2(i, j, seed ^ 0x2b2b);
    const dx = x - px, dy = y - py;
    const r2 = dx * dx + dy * dy;
    if (r2 > 4) continue;
    const env = Math.exp(-Math.PI * bandwidth * bandwidth * r2);
    const ph = TAU * freq * (dx * ca + dy * sa) + hash2(i, j, seed ^ 0x777) * TAU;
    sum += env * Math.cos(ph);
    wsum += env;
  }
  return clamp(0.5 + (wsum > 1e-6 ? sum / (wsum + 0.35) : 0) * 0.7, 0, 1);
}

// Sparse convolution noise: sparse random impulses convolved with a kernel.
export function sparseConv(x, y, seed = 0, density = 6, kernel = 0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let sum = 0;
  for (let j = yi - 1; j <= yi + 1; j++) for (let i = xi - 1; i <= xi + 1; i++) {
    const cnt = Math.floor(hash2(i, j, seed) * density) + 1;
    for (let k = 0; k < cnt; k++) {
      const ks = seed ^ Math.imul(k + 1, 2654435761);
      const px = i + hash2(i, j, ks), py = j + hash2(i, j, ks ^ 0x5bd1);
      const amp = hash2s(i, j, ks ^ 0xe9e9);
      const dx = x - px, dy = y - py;
      const r = Math.hypot(dx, dy);
      let wgt;
      if (kernel === 0) wgt = Math.exp(-r * r * 4);            // gaussian
      else if (kernel === 1) wgt = Math.exp(-r * 5) * Math.cos(r * 6); // ring
      else wgt = Math.max(0, 1 - r) ** 2;                      // cone
      sum += amp * wgt;
    }
  }
  return clamp(0.5 + sum * 0.35, 0, 1);
}

// Wavelet-ish noise: band-limited sum of difference-of-gaussian octaves on value lattice.
export function wavelet(x, y, seed = 0, octaves = 4) {
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    const a = valueNoise(x * f, y * f, seed + o * 101);
    const b = valueNoise(x * f * 0.5 + 13.7, y * f * 0.5 + 7.1, seed + o * 101);
    sum += (a - b) * amp;
    norm += amp;
    amp *= 0.55; f *= 2.03;
  }
  return clamp(0.5 + sum / (norm || 1), 0, 1);
}

// Fractal builders over a base noise fn(x, y, seed) in ~[0,1] (or signed for perlin/simplex).
export function fbm(base, x, y, o = {}) {
  const { octaves = 5, lacunarity = 2.0, gain = 0.5, seed = 0, signed = false } = o;
  let sum = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    let v = base(x * f, y * f, seed + i * 131);
    if (signed) v = v * 0.5 + 0.5;
    sum += v * amp; norm += amp;
    amp *= gain; f *= lacunarity;
  }
  return sum / (norm || 1);
}
export function ridged(base, x, y, o = {}) {
  const { octaves = 5, lacunarity = 2.1, gain = 0.5, seed = 0, offset = 1, sharp = 2 } = o;
  let sum = 0, amp = 0.55, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    let v = base(x * f, y * f, seed + i * 137);
    if (base === valueNoise) v = v * 2 - 1; // signed domain
    v = 1 - Math.abs(clamp(v, -1.2, 1.2));
    v = clamp(v ** sharp, 0, 1.5) * offset;
    sum += v * amp; norm += amp;
    amp *= gain; f *= lacunarity;
  }
  return clamp(sum / (norm || 1), 0, 1);
}
export function billow(base, x, y, o = {}) {
  const { octaves = 5, lacunarity = 2.0, gain = 0.5, seed = 0 } = o;
  let sum = 0, amp = 1, f = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    let v = base(x * f, y * f, seed + i * 149);
    if (base === valueNoise) v = v * 2 - 1;
    sum += Math.abs(v) * amp; norm += amp;
    amp *= gain; f *= lacunarity;
  }
  return clamp(sum / (norm || 1), 0, 1);
}
export function swiss(base, x, y, o = {}) {
  // fBm minus "cheese holes" carved by thresholded worley.
  const v = fbm(base, x, y, o);
  const [f1] = worley(x * 0.9 + 3.1, y * 0.9 + 9.4, (o.seed || 0) ^ 0xcee5, 1);
  const hole = smoothstepJS(0.28, 0.05, f1);
  return clamp(v * (1 - hole * 0.85), 0, 1);
}
function smoothstepJS(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export function jordan(base, x, y, o = {}) {
  // Jordan: ridged fBm with gradient-perturbation warp per octave.
  const { octaves = 5, lacunarity = 2.0, gain = 0.5, seed = 0, warp = 0.35 } = o;
  let sum = 0, amp = 0.5, f = 1, norm = 0;
  let wx = x, wy = y;
  for (let i = 0; i < octaves; i++) {
    let v = base(wx * f, wy * f, seed + i * 157);
    if (base === valueNoise) v = v * 2 - 1;
    const r = 1 - Math.abs(v);
    sum += r * r * amp; norm += amp;
    // warp next octave coords by local gradient estimate
    const e = 0.08;
    const gx = base(wx * f + e, wy * f, seed + i * 157) - v;
    const gy = base(wx * f, wy * f + e, seed + i * 157) - v;
    wx += gx * warp * 8; wy += gy * warp * 8;
    amp *= gain; f *= lacunarity;
  }
  return clamp(sum / (norm || 1), 0, 1);
}

// Pattern helpers (all [0,1]).
export const patGrid = (x, y, o = {}) => {
  const { width = 0.08 } = o;
  const fx = Math.abs(((x % 1) + 1) % 1 - 0.5) * 2, fy = Math.abs(((y % 1) + 1) % 1 - 0.5) * 2;
  const d = Math.min(1 - fx, 1 - fy);
  return clamp(d / Math.max(1e-3, width), 0, 1);
};
export const patChecker = (x, y) => ((Math.floor(x) + Math.floor(y)) & 1 ? 1 : 0);
export const patStripes = (x, y, o = {}) => {
  const { angle = 0, width = 0.5 } = o;
  const t = x * Math.cos(angle) + y * Math.sin(angle);
  return ((((t % 1) + 1) % 1) < width ? 1 : 0);
};
export function patHex(x, y) {
  // Hexagonal grid lines via cube-round distance.
  const sx = x * 1.7320508, sy = y * 1.5;
  const ix = Math.round(sx), iy = Math.round(sy);
  const px = sx - ix, py = sy - iy;
  const d = Math.min(Math.abs(px) * 0.9, Math.abs(py) * 0.55 + Math.abs(px) * 0.25);
  return clamp(d * 2.4, 0, 1);
}
export function patBrick(x, y, o = {}) {
  const { mortar = 0.06 } = o;
  const row = Math.floor(y);
  const xx = x + (row & 1 ? 0.5 : 0);
  const fx = Math.abs((((xx % 1) + 1) % 1) - 0.5) * 2;
  const fy = Math.abs((((y % 1) + 1) % 1) - 0.5) * 2;
  return clamp(Math.min((1 - fx), (1 - fy) * 1.4) / Math.max(1e-3, mortar), 0, 1);
}
export const waveSine = (x, y, o = {}) => {
  const { angle = 0, freq = 1 } = o;
  return 0.5 + 0.5 * Math.sin(TAU * freq * (x * Math.cos(angle) + y * Math.sin(angle)));
};
export const waveSaw = (x, y, o = {}) => {
  const { angle = 0, freq = 1 } = o;
  return (((freq * (x * Math.cos(angle) + y * Math.sin(angle)) % 1) + 1) % 1);
};
export const waveTri = (x, y, o = {}) => {
  const t = waveSaw(x, y, o);
  return 1 - Math.abs(t * 2 - 1);
};
