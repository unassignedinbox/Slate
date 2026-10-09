// Deterministic gradient-noise family: Perlin, fBm (multifractal), ridged,
// mountain (hybrid multifractal), billow, voronoi, dune fields, domain warp.

function hashSeed(seed) {
  let h = (seed | 0) * 374761393 + 1442695040;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

function buildPerm(seed) {
  const key = seed | 0;
  const cached = permCache.get(key);
  if (cached) return cached;
  const p = new Uint8Array(512);
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  let s = hashSeed(seed) || 1;
  const rnd = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const t = base[i]; base[i] = base[j]; base[j] = t;
  }
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  permCache.set(key, p);
  return p;
}

const permCache = new Map();

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
];

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + (b - a) * t; }

function perlin2(p, x, y) {
  const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x), yf = y - Math.floor(y);
  const u = fade(xf), v = fade(yf);
  const g = (h, dx, dy) => {
    const gr = GRAD[h & 7];
    return gr[0] * dx + gr[1] * dy;
  };
  const aa = p[p[X] + Y], ab = p[p[X] + Y + 1];
  const ba = p[p[X + 1] + Y], bb = p[p[X + 1] + Y + 1];
  const x1 = lerp(g(aa, xf, yf), g(ba, xf - 1, yf), u);
  const x2 = lerp(g(ab, xf, yf - 1), g(bb, xf - 1, yf - 1), u);
  return lerp(x1, x2, v); // ~[-1, 1]
}

function perlin2Norm(p, x, y) {
  return perlin2(p, x, y) * 0.7071 + 0.5; // ~[0, 1]
}

function makeRng(seed) {
  let s = hashSeed(seed) || 1;
  return () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/** fBm / multifractal perlin — returns ~[0, 1]. */
export function fbm(seed, x, y, {
  octaves = 4, persistence = 0.5, lacunarity = 2.0, frequency = 1.0,
} = {}) {
  const p = buildPerm(seed);
  let amp = 1, freq = frequency, sum = 0, norm = 0;
  for (let o = 0; o < Math.max(1, octaves); o++) {
    sum += perlin2Norm(p, x * freq, y * freq) * amp;
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return sum / Math.max(norm, 1e-6);
}

/** Ridged multifractal — sharp crest lines, ~[0, 1]. */
export function ridged(seed, x, y, {
  octaves = 5, persistence = 0.5, lacunarity = 2.1, frequency = 1.0, sharpness = 1.0,
} = {}) {
  const p = buildPerm(seed);
  let amp = 1, freq = frequency, sum = 0, norm = 0, prev = 1;
  for (let o = 0; o < Math.max(1, octaves); o++) {
    let n = 1 - Math.abs(perlin2(p, x * freq, y * freq) * 1.4);
    n = Math.pow(Math.max(n, 0), 2 - sharpness * 0.9);
    sum += n * amp * prev;
    prev = n;
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return Math.min(1, sum / Math.max(norm, 1e-6));
}

/** Hybrid multifractal — mountain ranges with foothills, ~[0, 1]. */
export function mountain(seed, x, y, {
  octaves = 5, persistence = 0.5, lacunarity = 2.1, frequency = 1.0, gain = 0.5,
} = {}) {
  const p = buildPerm(seed);
  let amp = 1, freq = frequency, sum = 0, norm = 0, prev = 1;
  for (let o = 0; o < Math.max(1, octaves); o++) {
    let n = perlin2Norm(p, x * freq, y * freq);
    n = n * (1 - gain) + Math.abs(perlin2(p, x * freq, y * freq)) * gain;
    sum += n * amp * prev;
    prev = n;
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return Math.min(1, sum / Math.max(norm, 1e-6));
}

/** Billow noise — rounded puffs / rolling hills, ~[0, 1]. */
export function billow(seed, x, y, {
  octaves = 4, persistence = 0.5, lacunarity = 2.0, frequency = 1.0,
} = {}) {
  const p = buildPerm(seed);
  let amp = 1, freq = frequency, sum = 0, norm = 0;
  for (let o = 0; o < Math.max(1, octaves); o++) {
    sum += Math.abs(perlin2(p, x * freq, y * freq)) * amp;
    norm += amp;
    amp *= persistence;
    freq *= lacunarity;
  }
  return Math.min(1, sum / Math.max(norm, 1e-6));
}

/** Cellular / voronoi F1 — plateau cells with jittered borders, ~[0, 1]. */
export function voronoi(seed, x, y, { jitter = 0.8, cellScale = 1.0 } = {}) {
  const xi = Math.floor(x * cellScale), yi = Math.floor(y * cellScale);
  const rng = (ix, iy) => {
    let h = hashSeed(seed + ix * 374761393 + iy * 668265263);
    return h / 4294967296;
  };
  let minD = 1e9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx, cy = yi + dy;
      const px = cx + 0.5 + (rng(cx, cy) - 0.5) * jitter;
      const py = cy + 0.5 + (rng(cx + 911, cy - 357) - 0.5) * jitter;
      const ddx = px - x * cellScale, ddy = py - y * cellScale;
      const d = ddx * ddx + ddy * ddy;
      if (d < minD) minD = d;
    }
  }
  return Math.min(1, Math.sqrt(minD) * 0.9);
}

/** Domain-warped fBm — meandering, naturalistic forms. */
export function warpedFbm(seed, x, y, { warp = 0.6, octaves = 4, persistence = 0.5, lacunarity = 2, frequency = 1 } = {}) {
  const p = buildPerm(seed + 7919);
  const wx = perlin2(p, x * frequency * 0.5 + 11.3, y * frequency * 0.5 + 5.7) * warp;
  const wy = perlin2(p, x * frequency * 0.5 - 3.1, y * frequency * 0.5 + 9.2) * warp;
  return fbm(seed, (x + wx) * frequency, (y + wy) * frequency, { octaves, persistence, lacunarity });
}

/** Dune field — wind-aligned ridges with braided, irregular crests, ~[0, 1]. */
export function dunes(seed, x, y, {
  frequency = 2.4, angleDeg = 42, braid = 0.45, octaveMix = 0.35,
} = {}) {
  const a = angleDeg * Math.PI / 180;
  const u = x * Math.cos(a) - y * Math.sin(a);
  const v = x * Math.sin(a) + y * Math.cos(a);
  const p = buildPerm(seed + 313);
  const warp = perlin2(p, u * 0.55, v * 0.32) * (braid * 1.8);
  const warp2 = perlin2(p, u * 0.16 + 4.2, v * 0.14 + 2.2) * (braid * 1.1);
  let d = Math.sin((u * frequency + warp * 1.4 + warp2) * Math.PI * 2);
  d = Math.abs(d);
  d = Math.pow(d, 1.35 + braid * 0.8);
  // crest amplitude waxes and wanes along the wind, plus a faint crossing set
  const ampMod = 0.55 + 0.45 * (perlin2(p, u * 0.22 + 9, v * 0.2 + 3) * 2);
  const second = Math.abs(Math.sin((u * frequency * 0.47 + warp2 * 1.2) * Math.PI * 2));
  d = d * ampMod + second * 0.22 * braid;
  const det = fbm(seed, x * frequency * 2.4, y * frequency * 2.4, { octaves: 3 }) - 0.5;
  return Math.max(0, Math.min(1, 0.5 + (d - 0.5) * 0.78 + det * octaveMix));
}

/** Strata / stack bands — layered heights with noisy band edges, ~[0, 1]. */
export function strata(seed, x, y, {
  frequency = 3.0, warp = 0.35, sharpness = 0.65, angleDeg = 0,
} = {}) {
  const a = angleDeg * Math.PI / 180;
  const u = x * Math.cos(a) - y * Math.sin(a);
  const v = x * Math.sin(a) + y * Math.cos(a);
  const p = buildPerm(seed + 5231);
  const n = perlin2(p, u * frequency * 0.5, v * frequency * 0.5) * warp
    + perlin2(p, u * frequency * 1.6, v * frequency * 1.6) * warp * 0.4;
  const t = (u * frequency + n) % 1;
  const band = t < 0 ? t + 1 : t;
  const q = Math.abs(band * 2 - 1); // triangle
  return 1 - Math.pow(q, 1 + sharpness * 2.2);
}

/** Cheap 2D value noise (for masks / detail). */
export function valueNoise(seed, x, y, scale = 1) {
  const p = buildPerm(seed + 4177);
  return perlin2Norm(p, x * scale, y * scale);
}

/** Smoothstep helper. */
export function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export { buildPerm, perlin2, makeRng };
