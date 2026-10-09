// Derived terrain channels.
//
// Everything the satmap paints with — protrusion, slope, rivers, sedimentation,
// snow — is computed here from the composed heightfield plus whatever the
// erosion passes deposited or removed. All channels are normalised to 0..1 so
// masks and ramps can share one remap model.

import { PowLut } from './fastmath';
import {
  Field,
  aspectMap,
  blur,
  cavityMap,
  curvatureMap,
  fillSinks,
  flowAccumulation,
  protrusion,
  roughness,
  slopeMap,
} from './field';
import { Noise, clamp, smoothstep } from './noise';
import type { ChannelId } from './types';

/** Sediment and erosion readouts are gamma-compressed for display. */
const SED_POW = new PowLut(0.65, 1);

export interface ChannelEnv {
  cellSize: number;
  heightScale: number;
  seaLevel: number;
  snowline: number;
  snowAmount: number;
  /** Accumulated deposition from every erosion pass below this point. */
  sediment: Field;
  /** Accumulated removal from every erosion pass below this point. */
  eroded: Field;
  noise: Noise;
}

/** Percentile-based normalisation: ignores outliers, keeps contrast sane. */
export function robustNormalize(src: Field, loPct = 2, hiPct = 98, center = false): Field {
  const n = Math.min(src.data.length, 60000);
  const stride = Math.max(1, Math.floor(src.data.length / n));
  const samples: number[] = [];
  for (let i = 0; i < src.data.length; i += stride) samples.push(src.data[i]);
  samples.sort((a, b) => a - b);
  const lo = samples[Math.floor((samples.length - 1) * (loPct / 100))];
  const hi = samples[Math.floor((samples.length - 1) * (hiPct / 100))];
  const out = Field.zeros(src.size);
  if (center) {
    const m = Math.max(1e-9, Math.max(Math.abs(lo), Math.abs(hi)));
    for (let i = 0; i < out.data.length; i++) out.data[i] = clamp(0.5 + (src.data[i] / m) * 0.5, 0, 1);
  } else {
    const span = Math.max(1e-9, hi - lo);
    for (let i = 0; i < out.data.length; i++) out.data[i] = clamp((src.data[i] - lo) / span, 0, 1);
  }
  return out;
}

/** Signed channel mapped so 0 → 0.5, useful for curvature. */
export function signedNormalize(src: Field): Field {
  let maxAbs = 0;
  const stride = Math.max(1, Math.floor(src.data.length / 40000));
  const samples: number[] = [];
  for (let i = 0; i < src.data.length; i += stride) samples.push(Math.abs(src.data[i]));
  samples.sort((a, b) => a - b);
  maxAbs = samples[Math.floor(samples.length * 0.98)] || 1;
  const out = Field.zeros(src.size);
  const m = Math.max(1e-12, maxAbs);
  for (let i = 0; i < out.data.length; i++) out.data[i] = clamp(0.5 + (src.data[i] / m) * 0.5, 0, 1);
  return out;
}

export class ChannelStore {
  private cache = new Map<ChannelId, Field>();

  constructor(
    readonly height: Field,
    readonly env: ChannelEnv,
  ) {}

  get(id: ChannelId): Field {
    const hit = this.cache.get(id);
    if (hit) return hit;
    const value = this.compute(id);
    this.cache.set(id, value);
    return value;
  }

  private compute(id: ChannelId): Field {
    const { height, env } = this;
    const size = height.size;
    switch (id) {
      case 'height':
        return new Field(size, new Float32Array(height.data)).clamp(0, 1.2);
      case 'constant':
        return Field.zeros(size).fill(1);
      case 'protrusion':
        return robustNormalize(protrusion(height, Math.max(2, Math.round(size / 26))), 3, 99.5);
      case 'roughness':
        return robustNormalize(roughness(height, Math.max(2, Math.round(size / 90))), 2, 98);
      case 'cavity':
        return cavityMap(height, 0.35);
      case 'slope': {
        const s = slopeMap(height, env.cellSize, env.heightScale);
        const out = Field.zeros(size);
        for (let i = 0; i < out.data.length; i++) out.data[i] = clamp(s.data[i] / (Math.PI / 2), 0, 1);
        return out;
      }
      case 'aspect':
        return aspectMap(height).scale(1 / (Math.PI * 2));
      case 'curvature':
        return signedNormalize(curvatureMap(height));
      case 'flow': {
        const filled = fillSinks(height);
        const acc = flowAccumulation(filled);
        const out = Field.zeros(size);
        let max = 1;
        for (let i = 0; i < acc.length; i++) if (acc[i] > max) max = acc[i];
        const logMax = Math.log(1 + max);
        for (let i = 0; i < acc.length; i++) out.data[i] = Math.log(1 + acc[i]) / logMax;
        return out;
      }
      case 'rivers': {
        const flow = this.get('flow');
        const out = Field.zeros(size);
        for (let i = 0; i < out.data.length; i++) {
          out.data[i] = smoothstep(0.45, 0.92, flow.data[i]);
        }
        return out;
      }
      case 'wetness': {
        const flow = this.get('flow');
        const slopeRad = slopeMap(height, env.cellSize, env.heightScale);
        const out = Field.zeros(size);
        for (let i = 0; i < out.data.length; i++) {
          const tan = Math.max(0.008, Math.tan(slopeRad.data[i]));
          const twi = Math.log(Math.max(1, flow.data[i] * 900) / tan);
          out.data[i] = clamp((twi - 2) / 10, 0, 1);
        }
        return out;
      }
      case 'sediment': {
        const out = Field.zeros(size);
        let max = 0;
        for (let i = 0; i < env.sediment.data.length; i++) if (env.sediment.data[i] > max) max = env.sediment.data[i];
        const m = Math.max(1e-9, max);
        for (let i = 0; i < out.data.length; i++) {
          out.data[i] = clamp(SED_POW.at(env.sediment.data[i] / m), 0, 1);
        }
        return out;
      }
      case 'eroded': {
        const out = Field.zeros(size);
        let max = 0;
        for (let i = 0; i < env.eroded.data.length; i++) if (env.eroded.data[i] > max) max = env.eroded.data[i];
        const m = Math.max(1e-9, max);
        for (let i = 0; i < out.data.length; i++) {
          out.data[i] = clamp(SED_POW.at(env.eroded.data[i] / m), 0, 1);
        }
        return out;
      }
      case 'strata': {
        // Position within the geological stack, with a gentle dip warp so the
        // beds are not perfectly flat.
        const bands = 16;
        const out = Field.zeros(size);
        const inv = 1 / (size - 1);
        const smoothed = blur(height, Math.max(1, Math.round(size / 40)));
        for (let y = 0; y < size; y++) {
          const v = y * inv;
          for (let x = 0; x < size; x++) {
            const i = y * size + x;
            const u = x * inv;
            const dip = env.noise.fbm(u * 1.4 + 3.7, v * 1.4 - 9.1, 3, 2, 0.5) * 0.28;
            const t = (smoothed.data[i] + dip) * bands;
            out.data[i] = t - Math.floor(t);
          }
        }
        return out;
      }
      case 'snow': {
        const slope = this.get('slope');
        const out = Field.zeros(size);
        const soft = 0.06;
        for (let i = 0; i < out.data.length; i++) {
          const alt = smoothstep(env.snowline - soft, env.snowline + soft * 2, height.data[i]);
          const shedding = 1 - smoothstep(0.55, 0.9, slope.data[i]);
          out.data[i] = clamp(alt * (0.25 + 0.75 * shedding) * env.snowAmount, 0, 1);
        }
        return out;
      }
      case 'sea': {
        const out = Field.zeros(size);
        const level = env.seaLevel;
        for (let i = 0; i < out.data.length; i++) {
          out.data[i] = clamp((level - height.data[i]) / Math.max(0.02, level), 0, 1);
        }
        return out;
      }
      default:
        return Field.zeros(size).fill(1);
    }
  }
}

/** Cheap accessor used by masks and satmaps. */
export interface ChannelSource {
  get(id: ChannelId): Field;
}
