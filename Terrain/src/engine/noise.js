// Noise primitives used by the generator layers. All functions are pure and take a seed.
// Coordinates are in lattice units (one unit = one feature cell at scale 1).
import { hash2, hashSigned } from './rng.js';

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

export function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = fade(x - x0), ty = fade(y - y0);
  const a = hashSigned(x0, y0, seed), b = hashSigned(x0 + 1, y0, seed);
  const c = hashSigned(x0, y0 + 1, seed), d = hashSigned(x0 + 1, y0 + 1, seed);
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function gradient(ix, iy, seed) {
  const a = hash2(ix, iy, seed) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

// Classic gradient (Perlin) noise, normalised to roughly [-1, 1].
export function perlin(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const dx = x - x0, dy = y - y0;
  const g00 = gradient(x0, y0, seed), g10 = gradient(x0 + 1, y0, seed);
  const g01 = gradient(x0, y0 + 1, seed), g11 = gradient(x0 + 1, y0 + 1, seed);
  const n00 = g00[0] * dx + g00[1] * dy;
  const n10 = g10[0] * (dx - 1) + g10[1] * dy;
  const n01 = g01[0] * dx + g01[1] * (dy - 1);
  const n11 = g11[0] * (dx - 1) + g11[1] * (dy - 1);
  const tx = fade(dx), ty = fade(dy);
  return lerp(lerp(n00, n10, tx), lerp(n01, n11, tx), ty) * 1.4142;
}

// 2-D simplex noise (Gustavson formulation), range roughly [-1, 1].
const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
const corner = (x, y, ix, iy, seed) => {
  const t = 0.5 - x * x - y * y;
  if (t < 0) return 0;
  const a = hash2(ix, iy, seed) * Math.PI * 2;
  const g = Math.cos(a) * x + Math.sin(a) * y;
  const t2 = t * t;
  return t2 * t2 * g;
};
export function simplex(x, y, seed) {
  const s = (x + y) * F2;
  const i = Math.floor(x + s), j = Math.floor(y + s);
  const t = (i + j) * G2;
  const x0 = x - (i - t), y0 = y - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  return 70 * (corner(x0, y0, i, j, seed) + corner(x1, y1, i + i1, j + j1, seed) + corner(x2, y2, i + 1, j + 1, seed));
}

// Voronoi / Worley: sorted distances to the four nearest feature points plus the nearest cell id.
// `jitter` moves feature points inside their cells (1 = fully random, 0 = cell centres).
export function worleyF4(x, y, seed, jitter = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let d0 = 9, d1 = 9, d2 = 9, d3 = 9, id0 = 0;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const cx = xi + i, cy = yi + j;
      const px = cx + 0.5 + jitter * 0.5 * hashSigned(cx, cy, seed);
      const py = cy + 0.5 + jitter * 0.5 * hashSigned(cx, cy, seed + 101);
      const dx = px - x, dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d0) { d3 = d2; d2 = d1; d1 = d0; d0 = d; id0 = hash2(cx, cy, seed + 7); }
      else if (d < d1) { d3 = d2; d2 = d1; d1 = d; }
      else if (d < d2) { d3 = d2; d2 = d; }
      else if (d < d3) { d3 = d; }
    }
  }
  return { f: [d0, d1, d2, d3], id: id0 };
}

// Sum of gaussian impulses with random signs, one per lattice cell: sparse convolution noise.
export function sparseKernel(x, y, seed, radius = 1.2) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let s = 0;
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      const cx = xi + i, cy = yi + j;
      const px = cx + hash2(cx, cy, seed), py = cy + hash2(cx, cy, seed + 13);
      const dx = x - px, dy = y - py;
      const d2 = (dx * dx + dy * dy) / (radius * radius);
      if (d2 < 9) s += hashSigned(cx, cy, seed + 29) * Math.exp(-d2 * 1.5);
    }
  }
  return s;
}

// Gabor-style noise: oriented cosine carriers under gaussian envelopes, one per lattice cell.
export function gaborNoise(x, y, seed, angle = 0.6, freq = 3.0) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const ca = Math.cos(angle), sa = Math.sin(angle);
  let s = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = xi + i, cy = yi + j;
      const px = cx + hash2(cx, cy, seed), py = cy + hash2(cx, cy, seed + 5);
      const dx = x - px, dy = y - py;
      const env = Math.exp(-3.14 * (dx * dx + dy * dy));
      const phase = hash2(cx, cy, seed + 9) * Math.PI * 2;
      const u = dx * ca + dy * sa;
      s += env * Math.cos(2 * Math.PI * freq * u + phase) * hashSigned(cx, cy, seed + 17);
    }
  }
  return s;
}

// Wavelet-style noise: weighted sum of three band-limited value noise bands (fine, mid, coarse).
export function waveletNoise(x, y, seed) {
  return valueNoise(x, y, seed) * 0.7 + valueNoise(x * 2 + 17.3, y * 2 - 4.1, seed + 3) * 0.3 - valueNoise(x * 0.5, y * 0.5, seed + 9) * 0.2;
}

// Fractal sum of any base noise. `kind` picks the octave combination (fbm, ridged, billow, swiss, jordan).
export function fractal(base, x, y, seed, octaves = 6, lacunarity = 2, gain = 0.5, kind = 'fbm') {
  let amp = 1, freq = 1, sum = 0, norm = 0, prev = 1;
  for (let o = 0; o < octaves; o++) {
    const px = x * freq, py = y * freq, s = seed + o * 31;
    let n = base(px, py, s);
    if (kind === 'ridged') { n = 1 - Math.abs(n); n *= n; }
    else if (kind === 'billow') { n = Math.abs(n) * 2 - 1; }
    else if (kind === 'swiss') { n = 1 - Math.abs(n); n = n * n * (1 - 0.15 * prev); }
    else if (kind === 'jordan') { n = 1 - Math.abs(n); n *= 1 - 0.5 * Math.max(0, base(px * 0.5, py * 0.5, s + 23)) ** 2; }
    prev = n;
    sum += n * amp; norm += amp;
    amp *= gain; freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
