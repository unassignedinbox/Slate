// Satmap: channel-driven surface texturing.
//
// A satmap layer picks a terrain channel (protrusion, height, rivers,
// sedimentation, slope…) and paints a colour ramp across it, blended and masked
// exactly like a paint layer. Stacking a handful of these is what turns grey
// geometry into sandstone, scree, snow fields and braided river gravel.

import { PowLut } from './fastmath';
import { Field } from './field';
import type { ChannelSource } from './channels';
import { clamp } from './noise';
import type { ColorStop, SatLayer } from './types';
import { evaluateMask, type MaskContext } from './masks';
import type { Noise } from './noise';

export function hexToRgb(hex: string): [number, number, number] {
  let v = hex.replace('#', '');
  if (v.length === 3) v = v.split('').map((c) => c + c).join('');
  const n = parseInt(v, 16);
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** Ramps are sampled millions of times per pass — tabulate once per layer. */
function buildRampLut(stops: ColorStop[]): Float32Array {
  const lut = new Float32Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const c = sampleRamp(stops, i / 255);
    lut[i * 3] = c[0];
    lut[i * 3 + 1] = c[1];
    lut[i * 3 + 2] = c[2];
  }
  return lut;
}

function sampleRamp(stops: ColorStop[], t: number): [number, number, number] {
  if (!stops.length) return [128, 128, 128];
  if (stops.length === 1) return hexToRgb(stops[0].color);
  const x = clamp(t, 0, 1);
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (x >= a.at && x <= b.at) {
      const span = Math.max(1e-6, b.at - a.at);
      const f = (x - a.at) / span;
      const ca = hexToRgb(a.color);
      const cb = hexToRgb(b.color);
      return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f];
    }
  }
  if (x <= stops[0].at) return hexToRgb(stops[0].color);
  return hexToRgb(stops[stops.length - 1].color);
}

export interface SatEnv {
  size: number;
  height: Field;
  channels: ChannelSource;
  noise: Noise;
  seaLevel: number;
  snowline: number;
  snowAmount: number;
  /** Baked cavity/occlusion strength. */
  occlusion: number;
}

export function buildSatmap(
  layers: SatLayer[],
  env: SatEnv,
  onLayer?: (index: number, rgb: Float32Array, mask: Float32Array | null) => void,
): Uint8ClampedArray {
  const size = env.size;
  const N = size * size;
  const dst = new Float32Array(N * 3);
  // Neutral base so a half-transparent top layer reads sensibly.
  const base = hexToRgb('#6b6152');
  for (let i = 0; i < N; i++) {
    dst[i * 3] = base[0];
    dst[i * 3 + 1] = base[1];
    dst[i * 3 + 2] = base[2];
  }

  const inv = 1 / (size - 1);
  const layerRgb = new Float32Array(N * 3);
  const layerAlpha = new Float32Array(N);

  let layerIndex = -1;
  for (const layer of layers) {
    layerIndex++;
    if (!layer.enabled) continue;
    const src = env.channels.get(layer.channel).data;
    const ramp = [...layer.ramp].sort((a, b) => a.at - b.at);
    const min = layer.min;
    const span = Math.max(1e-4, layer.max - layer.min);
    const gamma = Math.max(0.05, layer.gamma);
    const gammaLut = Math.abs(gamma - 1) < 0.01 ? null : new PowLut(gamma, 1);
    const rampLut = buildRampLut(ramp);
    const invert = layer.invert;
    const detail = layer.detail;
    const detailScale = Math.max(1, layer.detailScale);
    const jitter = layer.jitter;
    const noise = env.noise;
    const needDetail = detail > 0.001;
    const needJitter = Math.abs(jitter) > 0.001;
    const slopeBlend = layer.slopeBlend;
    const slope = slopeBlend > 0.001 ? env.channels.get('slope').data : null;

    for (let y = 0; y < size; y++) {
      const v = y * inv;
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        let t = clamp((src[i] - min) / span, 0, 1);
        if (invert) t = 1 - t;
        if (needDetail) {
          const grain = noise.fbm((x * inv) * detailScale, v * detailScale, 3, 2.1, 0.5);
          t += grain * detail;
        }
        if (needJitter) {
          const j = noise.perlin(x * 0.7 + 91.3, y * 0.7 - 41.9);
          t += j * jitter;
        }
        if (slope) {
          // Flatten the ramp's contrast as the ground tips up, so cliff faces
          // read as rock rather than as contour banding.
          const s = slope[i];
          t = 0.5 + (t - 0.5) * (1 - slopeBlend * s);
        }
        t = clamp(t, 0, 1);
        if (gammaLut) t = gammaLut.at(t);
        const tk = t * 255;
        const k0 = tk | 0;
        const k1 = k0 > 254 ? 255 : k0 + 1;
        const f = tk - k0;
        const a0 = k0 * 3;
        const a1 = k1 * 3;
        layerRgb[i * 3] = rampLut[a0] + (rampLut[a1] - rampLut[a0]) * f;
        layerRgb[i * 3 + 1] = rampLut[a0 + 1] + (rampLut[a1 + 1] - rampLut[a0 + 1]) * f;
        layerRgb[i * 3 + 2] = rampLut[a0 + 2] + (rampLut[a1 + 2] - rampLut[a0 + 2]) * f;
        layerAlpha[i] = 1;
      }
    }

    let mask: Float32Array | null = null;
    if (layer.mask && layer.mask.type !== 'none') {
      const ctx: MaskContext = {
        size,
        noise,
        height: env.height,
        channels: env.channels,
        env: {
          seaLevel: env.seaLevel,
          snowline: env.snowline,
          heightScale: 1,
          cellSize: 1,
        },
        rng: () => 0.5,
      };
      const field = evaluateMask(layer.mask, ctx);
      mask = field ? field.data : null;
    }

    const alpha = clamp(layer.opacity, 0, 1);
    const blend = layer.blend;
    for (let i = 0; i < N; i++) {
      const a = mask ? mask[i] * alpha : alpha;
      if (a <= 0.001) continue;
      const di = i * 3;
      const sr = layerRgb[di];
      const sg = layerRgb[di + 1];
      const sb = layerRgb[di + 2];
      const dr = dst[di];
      const dg = dst[di + 1];
      const db = dst[di + 2];
      let or = sr;
      let og = sg;
      let ob = sb;
      switch (blend) {
        case 'multiply':
          or = (dr * sr) / 255;
          og = (dg * sg) / 255;
          ob = (db * sb) / 255;
          break;
        case 'screen':
          or = 255 - ((255 - dr) * (255 - sr)) / 255;
          og = 255 - ((255 - dg) * (255 - sg)) / 255;
          ob = 255 - ((255 - db) * (255 - sb)) / 255;
          break;
        case 'overlay':
          or = dr < 128 ? (2 * dr * sr) / 255 : 255 - (2 * (255 - dr) * (255 - sr)) / 255;
          og = dg < 128 ? (2 * dg * sg) / 255 : 255 - (2 * (255 - dg) * (255 - sg)) / 255;
          ob = db < 128 ? (2 * db * sb) / 255 : 255 - (2 * (255 - db) * (255 - sb)) / 255;
          break;
        case 'softlight': {
          const f = (b: number, s: number) => {
            const bb = b / 255;
            const ss = s / 255;
            return 255 * ((1 - 2 * ss) * bb * bb + 2 * ss * bb);
          };
          or = f(dr, sr);
          og = f(dg, sg);
          ob = f(db, sb);
          break;
        }
        case 'add':
          or = dr + sr;
          og = dg + sg;
          ob = db + sb;
          break;
        case 'luminosity': {
          const lum = (sr * 0.299 + sg * 0.587 + sb * 0.114) / 255;
          const k = 0.35 + lum * 1.3;
          or = dr * k;
          og = dg * k;
          ob = db * k;
          break;
        }
        default:
          break;
      }
      dst[di] = dr + (or - dr) * a;
      dst[di + 1] = dg + (og - dg) * a;
      dst[di + 2] = db + (ob - db) * a;
    }

    if (onLayer) onLayer(layerIndex, dst, mask);
  }

  // Bake the cavity term: cheap contact darkening that survives any lighting.
  const out = new Uint8ClampedArray(N * 4);
  const occlusion = clamp(env.occlusion, 0, 1);
  const ao = occlusion > 0.001 ? env.channels.get('cavity').data : null;
  for (let i = 0; i < N; i++) {
    const k = ao ? 1 - occlusion * (1 - ao[i]) : 1;
    out[i * 4] = clamp(dst[i * 3] * k, 0, 255);
    out[i * 4 + 1] = clamp(dst[i * 3 + 1] * k, 0, 255);
    out[i * 4 + 2] = clamp(dst[i * 3 + 2] * k, 0, 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}
