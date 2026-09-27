// Deterministic, allocation-free value noise + fBm.
// Smooth (quintic) interpolation keeps the terrain silky - no stair-stepping,
// which matters because the brief calls for a *clean* low-poly terrain.

function hash2(ix, iy, seed) {
  let h = ix * 374761393 + iy * 668265263 + seed * 2147483647;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function valueNoise2(x, y, seed = 0) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const a = hash2(x0, y0, seed);
  const b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed);
  const d = hash2(x0 + 1, y0 + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return (top + (bottom - top) * fy) * 2 - 1; // -1..1
}

/** Fractal brownian motion. */
export function fbm(x, y, { octaves = 4, freq = 1, amp = 1, lacunarity = 2.03, gain = 0.5, seed = 0 } = {}) {
  let sum = 0;
  let a = amp;
  let f = freq;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x * f, y * f, seed + i * 131) * a;
    f *= lacunarity;
    a *= gain;
  }
  return sum;
}
