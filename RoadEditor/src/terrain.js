// terrain.js — seeded, mapless procedural heightfield for the Frontier road
// editor. Pure functions only (no DOM, no three.js) so the sampler is testable
// in Node. Units: meters, Y-up. Deterministic: the same seed always produces
// the same terrain, on any platform (integer hashing, no Math.sin noise).

import { clamp, smoothstep } from './spline.js';

export const defaultTerrainParams = {
  seed: 28491,
  size: 400,     // meters across
  height: 28,    // meters of relief
  roughness: 55, // 0..100 — ridge sharpness and detail
};

// Integer hash → [0, 1). Deterministic across platforms and runs.
function hash2(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1013904223)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// Smooth value noise on a unit-ish lattice.
function valueNoise(x, z, seed) {
  const x0 = Math.floor(x), z0 = Math.floor(z);
  const fx = smoothstep(0, 1, x - x0);
  const fz = smoothstep(0, 1, z - z0);
  const v00 = hash2(x0, z0, seed);
  const v10 = hash2(x0 + 1, z0, seed);
  const v01 = hash2(x0, z0 + 1, seed);
  const v11 = hash2(x0 + 1, z0 + 1, seed);
  return v00 + (v10 - v00) * fx + (v01 - v00) * fz + (v00 - v10 - v01 + v11) * fx * fz;
}

// Fractal Brownian motion, roughly in [0, 1].
function fbm(x, z, seed, octaves) {
  let total = 0, amplitude = 0.5, frequency = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    total += valueNoise(x * frequency, z * frequency, seed + o * 101) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return norm > 0 ? total / norm : 0;
}

// Build a deterministic height sampler (x, z) → y in meters.
// The terrain fades to y = 0 at the borders so roads can run off the edge.
export function makeTerrainSampler(params) {
  const { seed, size, height, roughness } = { ...defaultTerrainParams, ...params };
  const rough = clamp(roughness / 100, 0, 1);
  const s = (seed >>> 0) || 1;
  return (x, z) => {
    const nx = x / size, nz = z / size; // centered: [-0.5, 0.5]
    const broad = fbm(nx * 2.2 + 0.5, nz * 2.2 + 0.5, s, 5);
    const ridge = 1 - Math.abs(fbm(nx * 5.5 + 9.7, nz * 5.5 + 3.1, s ^ 0x9e37, 4) * 2 - 1);
    const detail = fbm(nx * 11 + 4.2, nz * 11 + 7.9, s ^ 0x85eb, 3);
    let y = (broad * 0.62 + ridge * 0.6 * rough + detail * 0.08 - 0.16) * height;
    y += broad * broad * height * 0.45 * rough; // sharpen the peaks
    // Fade to sea level at the borders.
    const u = nx + 0.5, v = nz + 0.5;
    const edge = Math.min(u, 1 - u, v, 1 - v) * 2; // 1 at center, 0 at border
    return y * smoothstep(0, 0.22, edge);
  };
}

// Min/max height over a coarse grid — used for framing and sanity checks.
export function terrainHeightRange(sampler, size, steps = 24) {
  let min = Infinity, max = -Infinity;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const y = sampler(-size / 2 + (size * i) / steps, -size / 2 + (size * j) / steps);
      if (Number.isFinite(y)) { min = Math.min(min, y); max = Math.max(max, y); }
    }
  }
  if (!Number.isFinite(min)) return { min: 0, max: 0 };
  return { min, max };
}
