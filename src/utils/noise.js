import { createNoise2D, createNoise3D } from 'simplex-noise';

// Deterministic seeded PRNG (mulberry32) so the cave/spider details are
// reproducible between reloads while still looking organic.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeNoise(seed = 1337) {
  const rng = mulberry32(seed);
  const n2 = createNoise2D(rng);
  const n3 = createNoise3D(rng);

  function fbm2(x, y, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amp = 0.5, freq = 1.0, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * n2(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  function fbm3(x, y, z, octaves = 4, lacunarity = 2.0, gain = 0.5) {
    let amp = 0.5, freq = 1.0, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * n3(x * freq, y * freq, z * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / norm;
  }

  return { rng, n2, n3, fbm2, fbm3 };
}
