// High-performance procedural noise & math utilities for Gaea-style terrain generation

// Fast, deterministic PRNG (Mulberry32)
export function createRNG(seed: number) {
  let s = (seed ^ 0xdeadbeef) >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Permutation table generator based on seed
function buildPermutationTable(seed: number): Uint8Array {
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;

  const rng = createRNG(seed);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = base[i];
    base[i] = base[j];
    base[j] = tmp;
  }
  for (let i = 0; i < 512; i++) {
    p[i] = base[i & 255];
  }
  return p;
}

// Default global permutation table
const defaultPerm = buildPermutationTable(1337);

// Gradient table for 2D Perlin
const grad2 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

// Quintic interpolation curve (smoother than cubic)
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + t * (b - a);
}

// 2D Perlin Noise with smooth derivatives
export function perlin2D(x: number, y: number, perm: Uint8Array = defaultPerm): number {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;

  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);

  const u = fade(xf);
  const v = fade(yf);

  const g00 = grad2[perm[X + perm[Y]] & 7];
  const g10 = grad2[perm[X + 1 + perm[Y]] & 7];
  const g01 = grad2[perm[X + perm[Y + 1]] & 7];
  const g11 = grad2[perm[X + 1 + perm[Y + 1]] & 7];

  const n00 = g00[0] * xf + g00[1] * yf;
  const n10 = g10[0] * (xf - 1) + g10[1] * yf;
  const n01 = g01[0] * xf + g01[1] * (yf - 1);
  const n11 = g11[0] * (xf - 1) + g11[1] * (yf - 1);

  const nx0 = lerp(n00, n10, u);
  const nx1 = lerp(n01, n11, u);

  return lerp(nx0, nx1, v); // Returns ~[-1, 1]
}

// Simplex-like fast 2D noise
export function simplex2D(xin: number, yin: number, perm: Uint8Array = defaultPerm): number {
  const F2 = 0.5 * (Math.sqrt(3.0) - 1.0);
  const G2 = (3.0 - Math.sqrt(3.0)) / 6.0;

  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const X0 = i - t;
  const Y0 = j - t;
  const x0 = xin - X0;
  const y0 = yin - Y0;

  let i1: number, j1: number;
  if (x0 > y0) {
    i1 = 1; j1 = 0;
  } else {
    i1 = 0; j1 = 1;
  }

  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1.0 + 2.0 * G2;
  const y2 = y0 - 1.0 + 2.0 * G2;

  const ii = i & 255;
  const jj = j & 255;

  let n0 = 0.0, n1 = 0.0, n2 = 0.0;

  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    t0 *= t0;
    const gi0 = perm[ii + perm[jj]] & 7;
    n0 = t0 * t0 * (grad2[gi0][0] * x0 + grad2[gi0][1] * y0);
  }

  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    t1 *= t1;
    const gi1 = perm[ii + i1 + perm[jj + j1]] & 7;
    n1 = t1 * t1 * (grad2[gi1][0] * x1 + grad2[gi1][1] * y1);
  }

  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    t2 *= t2;
    const gi2 = perm[ii + 1 + perm[jj + 1]] & 7;
    n2 = t2 * t2 * (grad2[gi2][0] * x2 + grad2[gi2][1] * y2);
  }

  return 70.0 * (n0 + n1 + n2); // Normalized ~[-1, 1]
}

// Fractal Brownian Motion (fBm)
export function fbm2D(
  x: number,
  y: number,
  octaves: number = 6,
  roughness: number = 0.5,
  lacunarity: number = 2.0,
  perm: Uint8Array = defaultPerm
): number {
  let sum = 0;
  let freq = 1.0;
  let amp = 1.0;
  let maxAmp = 0;

  for (let i = 0; i < octaves; i++) {
    sum += simplex2D(x * freq, y * freq, perm) * amp;
    maxAmp += amp;
    amp *= roughness;
    freq *= lacunarity;
  }

  return sum / maxAmp; // [-1, 1]
}

// Gaea-style Billow / Ridge Noise for mountain arêtes and razor peaks
export function ridgeNoise2D(
  x: number,
  y: number,
  octaves: number = 6,
  gain: number = 0.5,
  lacunarity: number = 2.0,
  perm: Uint8Array = defaultPerm
): number {
  let sum = 0;
  let freq = 1.0;
  let amp = 1.0;
  let maxAmp = 0;
  let weight = 1.0;

  for (let i = 0; i < octaves; i++) {
    // 1 - abs(noise) creates knife-edge ridges
    let signal = 1.0 - Math.abs(perlin2D(x * freq, y * freq, perm));
    signal *= signal; // sharp ridge
    signal *= weight;
    weight = Math.min(1.0, Math.max(0.0, signal * 2.0));

    sum += signal * amp;
    maxAmp += amp;
    amp *= gain;
    freq *= lacunarity;
  }

  return sum / maxAmp; // [0, 1]
}

// Fast Voronoi / Worley Cellular Noise
// Returns { f1: distance to nearest, f2: distance to second nearest, f2_f1: difference (ridge) }
export function voronoi2D(
  x: number,
  y: number,
  jitter: number = 1.0,
  perm: Uint8Array = defaultPerm
): { f1: number; f2: number; f2_f1: number; cellId: number } {
  const ix = Math.floor(x);
  const iy = Math.floor(y);

  let f1 = 999.0;
  let f2 = 999.0;
  let bestId = 0;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;

      const px = perm[(cx & 255) + perm[cy & 255]];
      const py = perm[((cx + 17) & 255) + perm[(cy + 37) & 255]];

      const rx = (px / 255.0 - 0.5) * jitter;
      const ry = (py / 255.0 - 0.5) * jitter;

      const featureX = cx + 0.5 + rx;
      const featureY = cy + 0.5 + ry;

      const dist = Math.hypot(x - featureX, y - featureY);

      if (dist < f1) {
        f2 = f1;
        f1 = dist;
        bestId = px;
      } else if (dist < f2) {
        f2 = dist;
      }
    }
  }

  return { f1, f2, f2_f1: f2 - f1, cellId: bestId };
}

// Domain Warping: Distorts (x, y) by fractal noise vectors
export function domainWarp2D(
  x: number,
  y: number,
  strength: number = 0.5,
  freq: number = 1.0,
  perm: Uint8Array = defaultPerm
): { wx: number; wy: number } {
  const qx = simplex2D(x * freq, y * freq, perm);
  const qy = simplex2D((x + 5.2) * freq, (y + 1.3) * freq, perm);

  const rx = simplex2D((x + 4.0 * qx + 1.7) * freq, (y + 4.0 * qy + 9.2) * freq, perm);
  const ry = simplex2D((x + 4.0 * qx + 8.3) * freq, (y + 4.0 * qy + 2.8) * freq, perm);

  return {
    wx: x + strength * rx,
    wy: y + strength * ry,
  };
}

// Smooth min function for CSG / SDF blending
export function smin(a: number, b: number, k: number = 0.1): number {
  if (k <= 0.0001) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0.0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Smooth max function (useful for smooth subtraction / carving)
export function smax(a: number, b: number, k: number = 0.1): number {
  return -smin(-a, -b, k);
}

// Cache permutation tables per seed
const permCache = new Map<number, Uint8Array>();
export function getPermutationTable(seed: number): Uint8Array {
  let table = permCache.get(seed);
  if (!table) {
    table = buildPermutationTable(seed);
    permCache.set(seed, table);
  }
  return table;
}
