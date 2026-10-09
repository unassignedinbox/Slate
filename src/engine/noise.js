// Deterministic noise primitives. All functions are pure and seed-driven so a
// project always regenerates identically.

export function hash2(ix, iy, seed) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 2246822519) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

export function hash2v(ix, iy, seed) {
  // two independent values in [0,1)
  return [hash2(ix, iy, seed), hash2(ix + 17, iy - 31, seed + 101)];
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;

export function valueNoise(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const tx = fade(x - x0), ty = fade(y - y0);
  const a = hash2(x0, y0, seed) * 2 - 1, b = hash2(x0 + 1, y0, seed) * 2 - 1;
  const c = hash2(x0, y0 + 1, seed) * 2 - 1, d = hash2(x0 + 1, y0 + 1, seed) * 2 - 1;
  return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
}

function grad(ix, iy, seed) {
  const a = hash2(ix, iy, seed + 7) * Math.PI * 2;
  return [Math.cos(a), Math.sin(a)];
}

export function perlin(x, y, seed) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const dx = x - x0, dy = y - y0;
  const g00 = grad(x0, y0, seed), g10 = grad(x0 + 1, y0, seed);
  const g01 = grad(x0, y0 + 1, seed), g11 = grad(x0 + 1, y0 + 1, seed);
  const n00 = g00[0] * dx + g00[1] * dy;
  const n10 = g10[0] * (dx - 1) + g10[1] * dy;
  const n01 = g01[0] * dx + g01[1] * (dy - 1);
  const n11 = g11[0] * (dx - 1) + g11[1] * (dy - 1);
  const tx = fade(dx), ty = fade(dy);
  return lerp(lerp(n00, n10, tx), lerp(n01, n11, tx), ty) * 1.41;
}

// Standard 2D simplex noise (Stefan Gustavson formulation), range ~[-1,1].
const SIMPLEX_GRAD = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
export function simplex(xin, yin, seed) {
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t), y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  let n = 0;
  const corner = (cx, cy, ix, iy) => {
    let t0 = 0.5 - cx * cx - cy * cy;
    if (t0 < 0) return 0;
    t0 *= t0;
    const g = SIMPLEX_GRAD[Math.floor(hash2(ix, iy, seed) * 8) & 7];
    return t0 * t0 * (g[0] * cx + g[1] * cy);
  };
  n += corner(x0, y0, i, j);
  n += corner(x1, y1, i + i1, j + j1);
  n += corner(x2, y2, i + 1, j + 1);
  return 70 * n;
}

// Voronoi: returns sorted distances to the nearest feature points (F1..F4).
// Feature points are jittered per unit cell.
export function voronoiDists(x, y, seed, jitter = 1) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const d = [9, 9, 9, 9];
  let id1 = 0;
  for (let oy = -2; oy <= 2; oy++) {
    for (let ox = -2; ox <= 2; ox++) {
      const cx = xi + ox, cy = yi + oy;
      const [rx, ry] = hash2v(cx, cy, seed);
      const px = cx + 0.5 + (rx - 0.5) * jitter;
      const py = cy + 0.5 + (ry - 0.5) * jitter;
      const dist = Math.hypot(px - x, py - y);
      if (dist < d[0]) {
        d[3] = d[2]; d[2] = d[1]; d[1] = d[0]; d[0] = dist;
        id1 = hash2(cx, cy, seed + 3);
      } else if (dist < d[1]) {
        d[3] = d[2]; d[2] = d[1]; d[1] = dist;
      } else if (dist < d[2]) {
        d[3] = d[2]; d[2] = dist;
      } else if (dist < d[3]) {
        d[3] = dist;
      }
    }
  }
  return { d, id: id1 };
}

// Gabor-like kernel noise: a sum of oriented sinusoids under a Gaussian window,
// one impulse per grid cell.
export function gaborNoise(x, y, seed, orient) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let s = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = xi + ox, cy = yi + oy;
    const [rx, ry] = hash2v(cx, cy, seed);
    const dx = x - (cx + rx), dy = y - (cy + ry);
    const r2 = dx * dx + dy * dy;
    const w = Math.exp(-r2 * 3.5);
    const ang = orient + (hash2(cx, cy, seed + 9) - 0.5) * 0.8;
    const phase = hash2(cx, cy, seed + 13) * Math.PI * 2;
    const proj = dx * Math.cos(ang) + dy * Math.sin(ang);
    s += w * Math.cos(proj * 9 + phase);
  }
  return s * 0.7;
}

// Sparse convolution: randomly placed Gaussian impulses per cell.
export function sparseConv(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let s = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = xi + ox, cy = yi + oy;
    if (hash2(cx, cy, seed) < 0.5) continue; // sparse: only half the cells host an impulse
    const [rx, ry] = hash2v(cx, cy, seed + 1);
    const dx = x - (cx + rx), dy = y - (cy + ry);
    s += Math.exp(-(dx * dx + dy * dy) * 6) * (hash2(cx, cy, seed + 2) * 2 - 1);
  }
  return s;
}

// Wavelet-like noise: Mexican-hat style band-pass per cell.
export function waveletNoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  let s = 0;
  for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
    const cx = xi + ox, cy = yi + oy;
    const [rx, ry] = hash2v(cx, cy, seed);
    const dx = x - (cx + rx), dy = y - (cy + ry);
    const r2 = (dx * dx + dy * dy) * 4;
    s += (1 - r2) * Math.exp(-r2 * 0.5) * (hash2(cx, cy, seed + 5) * 2 - 1);
  }
  return s * 0.8;
}

// Cellular automata field: random seeding smoothed by a cave-style rule over
// a coarse grid, sampled with bilinear interpolation.
const caCache = new Map();
export function cellularField(x, y, seed, size = 64) {
  const key = seed + ":" + size;
  let g = caCache.get(key);
  if (!g) {
    g = new Float32Array(size * size);
    let cur = new Uint8Array(size * size);
    for (let i = 0; i < cur.length; i++) cur[i] = hash2(i % size, (i / size) | 0, seed) < 0.48 ? 1 : 0;
    for (let it = 0; it < 4; it++) {
      const nxt = new Uint8Array(size * size);
      for (let yy = 0; yy < size; yy++) for (let xx = 0; xx < size; xx++) {
        let n = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          if (!ox && !oy) continue;
          const sx = (xx + ox + size) % size, sy = (yy + oy + size) % size;
          n += cur[sy * size + sx];
        }
        nxt[yy * size + xx] = n >= 5 || (cur[yy * size + xx] && n >= 4) ? 1 : 0;
      }
      cur = nxt;
    }
    for (let i = 0; i < g.length; i++) g[i] = cur[i] ? 1 : -1;
    caCache.set(key, g);
    if (caCache.size > 16) caCache.delete(caCache.keys().next().value);
  }
  const fx = ((x % size) + size) % size, fy = ((y % size) + size) % size;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fade(fx - x0), ty = fade(fy - y0);
  const at = (a, b) => g[(b % size) * size + (a % size)];
  return lerp(lerp(at(x0, y0), at(x0 + 1, y0), tx), lerp(at(x0, y0 + 1), at(x0 + 1, y0 + 1), tx), ty);
}

// Fractal Brownian motion over a base noise function fn(x,y,seed) -> [-1,1].
export function fbm(fn, x, y, seed, octaves = 6, lacunarity = 2, gain = 0.5) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * fn(x * freq, y * freq, seed + o * 17);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}
