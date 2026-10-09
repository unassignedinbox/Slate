// Noise kernels used by every generator and mask in Slate.
// All kernels are deterministic for a given seed and return roughly [-1, 1],
// except the fractal combinators which document their own range.

import { PowLut } from './fastmath';
import { makeRng, shuffle } from './rng';

const GRAD_X = new Float32Array([1, -1, 1, -1, 1, -1, 0, 0]);
const GRAD_Y = new Float32Array([1, 1, -1, -1, 0, 0, 1, -1]);

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export class Noise {
  readonly perm: Uint8Array;
  readonly permMod8: Uint8Array;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed;
    const rng = makeRng(seed >>> 0 || 1);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    shuffle(p as unknown as number[], rng);
    const perm = new Uint8Array(512);
    const mod8 = new Uint8Array(512);
    for (let i = 0; i < 512; i++) {
      perm[i] = p[i & 255];
      mod8[i] = perm[i] % 8;
    }
    this.perm = perm;
    this.permMod8 = mod8;
  }

  /** Classic improved Perlin gradient noise, range ≈ [-1, 1]. */
  perlin(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const perm = this.perm;
    const aa = perm[perm[X] + Y];
    const ab = perm[perm[X] + Y + 1];
    const ba = perm[perm[X + 1] + Y];
    const bb = perm[perm[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 1.4;
  }

  /** Simplex noise (2D), range ≈ [-1, 1]. Slightly cheaper than Perlin. */
  simplex(x: number, y: number): number {
    const s = (x + y) * F2;
    const i = Math.floor(x + s);
    const j = Math.floor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const perm = this.perm;
    const mod8 = this.permMod8;
    let n = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 > 0) {
      const g = mod8[perm[ii + perm[jj]] & 255];
      t0 *= t0;
      n += t0 * t0 * (GRAD_X[g] * x0 + GRAD_Y[g] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 > 0) {
      const g = mod8[perm[ii + i1 + perm[jj + j1]] & 255];
      t1 *= t1;
      n += t1 * t1 * (GRAD_X[g] * x1 + GRAD_Y[g] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 > 0) {
      const g = mod8[perm[ii + 1 + perm[jj + 1]] & 255];
      t2 *= t2;
      n += t2 * t2 * (GRAD_X[g] * x2 + GRAD_Y[g] * y2);
    }
    return n * 70;
  }

  /** Fractal Brownian motion, range ≈ [-1, 1]. */
  fbm(
    x: number,
    y: number,
    octaves: number,
    lacunarity = 2,
    gain = 0.5,
    kernel: 'perlin' | 'simplex' = 'perlin',
  ): number {
    const f = kernel === 'simplex' ? this.simplex : this.perlin;
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;
    const count = Math.max(1, Math.round(octaves));
    for (let o = 0; o < count; o++) {
      sum += amp * f.call(this, fx, fy);
      norm += amp;
      amp *= gain;
      fx *= lacunarity;
      fy *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  /** Tabulated powers, keyed by exponent — one table per distinct exponent. */
  private luts = new Map<number, PowLut>();
  private lut(exp: number, max = 1): PowLut {
    const key = Math.round(exp * 4096) + max * 1e7;
    let found = this.luts.get(key);
    if (!found) {
      if (this.luts.size > 48) this.luts.clear();
      found = new PowLut(exp, max);
      this.luts.set(key, found);
    }
    return found;
  }

  /** Musgrave multifractal — the workhorse for natural-looking mountains. */
  multifractal(
    x: number,
    y: number,
    octaves: number,
    offset = 1,
    gain = 0.5,
    lacunarity = 2,
    kernel: 'perlin' | 'simplex' = 'perlin',
  ): number {
    const f = kernel === 'simplex' ? this.simplex : this.perlin;
    const offsetLut = this.lut(offset);
    const count = Math.max(1, Math.round(octaves));
    let value = 1;
    let signal = f.call(this, x, y) * 0.5 + 0.5;
    if (signal <= 0) signal = 0.0001;
    value = offset * signal;
    let amp = 1;
    let freq = lacunarity;
    for (let o = 1; o < count; o++) {
      signal = f.call(this, x * freq, y * freq) * 0.5 + 0.5;
      if (signal <= 0) signal = 0.0001;
      signal = offsetLut.at(signal);
      value += signal * amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return clamp(value * 0.5, 0, 2);
  }

  /** Ridged multifractal — sharp crests, the classic "mountain ridge" kernel. */
  ridged(
    x: number,
    y: number,
    octaves: number,
    sharpness = 2,
    lacunarity = 2,
    gain = 0.5,
    threshold = 1,
    kernel: 'perlin' | 'simplex' = 'perlin',
  ): number {
    const f = kernel === 'simplex' ? this.simplex : this.perlin;
    const sharpLut = this.lut(Math.max(0.05, sharpness * 0.5));
    const count = Math.max(1, Math.round(octaves));
    let sum = 0;
    let amp = 0.5;
    let weight = 1;
    let fx = x;
    let fy = y;
    let norm = 0;
    for (let o = 0; o < count; o++) {
      let signal = 1 - Math.abs(f.call(this, fx, fy));
      signal *= signal;
      signal = sharpLut.at(signal);
      signal *= weight;
      weight = clamp(signal * threshold, 0, 1);
      sum += signal * amp;
      norm += amp;
      amp *= gain;
      fx *= lacunarity;
      fy *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  /** Billow — puffy, cloud-like; good for dunes, plateaus and volcanic fields. */
  billow(
    x: number,
    y: number,
    octaves: number,
    lacunarity = 2,
    gain = 0.5,
    kernel: 'perlin' | 'simplex' = 'perlin',
  ): number {
    const f = kernel === 'simplex' ? this.simplex : this.perlin;
    const count = Math.max(1, Math.round(octaves));
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let o = 0; o < count; o++) {
      let signal = Math.abs(f.call(this, fx, fy));
      signal = 1 - signal * 2;
      sum += signal * amp;
      norm += amp;
      amp *= gain;
      fx *= lacunarity;
      fy *= lacunarity;
    }
    return norm > 0 ? sum / norm : 0;
  }

  /**
   * Worley (cellular) noise.
   * mode 0 → F1 (distance to nearest point)
   * mode 1 → F2 − F1 (cell borders, used for rifts and tectonic plates)
   * mode 2 → F2
   */
  worley(x: number, y: number, mode = 0, jitter = 1): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    let f1 = 8;
    let f2 = 8;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx;
        const cy = yi + dy;
        const h = this.perm[(this.perm[cx & 255] + (cy & 255)) & 511] / 255;
        const h2 = this.perm[(this.perm[(cx * 7 + 13) & 255] + ((cy * 3 + 7) & 255)) & 511] / 255;
        const px = dx + 0.5 + (h - 0.5) * jitter;
        const py = dy + 0.5 + (h2 - 0.5) * jitter;
        const d = Math.sqrt((xf - px) * (xf - px) + (yf - py) * (yf - py));
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) {
          f2 = d;
        }
      }
    }
    if (mode === 1) return clamp(1 - (f2 - f1) * 1.6, 0, 1) * 2 - 1;
    if (mode === 2) return clamp(f2 * 0.9, 0, 1) * 2 - 1;
    return clamp(f1 * 1.2, 0, 1) * 2 - 1;
  }

  /** Domain warp — pushes coordinates through another noise field first. */
  warp(x: number, y: number, strength: number, freq: number): [number, number] {
    if (strength === 0) return [x, y];
    const wx = this.perlin(x * freq + 11.3, y * freq - 4.7);
    const wy = this.perlin(x * freq - 7.1, y * freq + 19.2);
    return [x + wx * strength, y + wy * strength];
  }
}

function grad(hash: number, x: number, y: number): number {
  return GRAD_X[hash & 7] * x + GRAD_Y[hash & 7] * y;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Smooth ramp with an adjustable plateau width (0 = hard step, 1 = full ramp). */
export function ramp(edge0: number, edge1: number, x: number, softness: number): number {
  const s = clamp(softness, 0.001, 1);
  const mid = (edge0 + edge1) * 0.5;
  const half = Math.max(1e-5, (edge1 - edge0) * 0.5 * s + 1e-5);
  const lo = mid - half;
  const hi = mid + half;
  if (s >= 0.999) return smoothstep(lo, hi, x);
  // Sharpen the interior of the transition, keep the ends smooth.
  const t = clamp((x - lo) / (hi - lo), 0, 1);
  const shaped = t * t * (3 - 2 * t);
  return rampLut(1 / Math.max(0.15, s), s).at(shaped);
}

const RAMP_LUTS = new Map<number, PowLut>();

function rampLut(exp: number, softness: number): PowLut {
  const key = Math.round(softness * 4096);
  let found = RAMP_LUTS.get(key);
  if (!found) {
    if (RAMP_LUTS.size > 64) RAMP_LUTS.clear();
    found = new PowLut(exp, 1);
    RAMP_LUTS.set(key, found);
  }
  return found;
}
