// The evaluation pipeline.
//
// Height layers run top → bottom through the panel: each one works on whatever
// the layers above it produced, resolves its own mask, and writes back through
// its blend mode. Erosion passes intercept the height in place and book-keep
// every cubic metre they move into the sedimentation / erosion channels, which
// the satmap and the masks can then read.
//
// Two caches keep this interactive:
//   · generator fields, keyed by their own parameters
//   · a checkpoint after every height layer, so editing the bottom of the stack
//     (or the satmap) never re-runs the erosion above it

import { Field, downsample, resample } from './field';
import { ChannelStore } from './channels';
import { buildSatmap } from './satmap';
import { GENERATOR_MAP, layerNoise, type GenContext } from './generators';
import { FILTER_MAP, type FilterContext } from './filters';
import { EROSION_MAP, type ErosionContext } from './erosion';
import { evaluateMask, type MaskContext } from './masks';
import { Noise, clamp } from './noise';
import { hashSeed, makeRng } from './rng';
import { num } from './params';
import type { ChannelId, HeightBlend, Project, SatLayer } from './types';

export interface LayerThumb {
  id: string;
  role: 'generator' | 'erosion' | 'filter' | 'satmap';
  size: number;
  /** Height delta (or RGBA for satmap rows), row-major. */
  data: Float32Array | Uint8ClampedArray;
  range: [number, number];
  mask: Float32Array | null;
}

export interface ComputeStats {
  minHeight: number;
  maxHeight: number;
  meanHeight: number;
  moved: number;
  cut: number;
  fill: number;
  seaCoverage: number;
  timeMs: number;
  cellSize: number;
  triangles: number;
  /** How many height layers were recomputed this pass. */
  reused: number;
}

export interface ComputeResult {
  size: number;
  height: Float32Array;
  rgba: Uint8ClampedArray;
  thumbs: LayerThumb[];
  preview: { channel: ChannelId; size: number; data: Float32Array } | null;
  maskPreview: { id: string; size: number; data: Float32Array } | null;
  stats: ComputeStats;
}

export interface ComputeOptions {
  thumbSize?: number;
  previewChannel?: ChannelId | null;
  previewSize?: number;
  /** Layer whose mask should be returned as a larger preview for the inspector. */
  maskPreviewId?: string | null;
}

/* --------------------------------------------------------------- caching -- */

/** Generator fields are expensive; keep the last few around between runs. */
const generatorCache = new Map<string, { key: string; data: Float32Array }>();
const CACHE_LIMIT = 24;

interface Checkpoint {
  key: string;
  height: Float32Array;
  sediment: Float32Array;
  eroded: Float32Array;
  thumbs: LayerThumb[];
  moved: number;
  cut: number;
  fill: number;
}

let checkpoints: Checkpoint[] = [];
let satCache: { key: string; rgba: Uint8ClampedArray; thumbs: LayerThumb[] } | null = null;

export function clearCaches(): void {
  generatorCache.clear();
  checkpoints = [];
  satCache = null;
}

function settingsKey(project: Project): string {
  return JSON.stringify([
    project.resolution,
    project.seed,
    project.extent,
    project.heightScale,
    project.seaLevel,
    project.render.snowline,
    project.render.snowAmount,
  ]);
}

function cloneThumbs(thumbs: LayerThumb[]): LayerThumb[] {
  return thumbs.map((t) => ({
    ...t,
    data: t.data instanceof Float32Array ? new Float32Array(t.data) : new Uint8ClampedArray(t.data),
    mask: t.mask ? new Float32Array(t.mask) : null,
  }));
}

/* -------------------------------------------------------------- pipeline -- */

export function computeProject(project: Project, options: ComputeOptions = {}): ComputeResult {
  const start = Date.now();
  const size = project.resolution;
  const N = size * size;
  const thumbSize = options.thumbSize === 0 ? 0 : options.thumbSize ?? 76;
  const cellSize = project.extent / size;
  const heightScale = Math.max(1, project.heightScale);
  const maskPreviewId = options.maskPreviewId ?? null;

  const baseKey = settingsKey(project);
  const keyParts: string[] = [];
  for (const layer of project.layers) keyParts.push(JSON.stringify(layer));

  // Rewind to the deepest checkpoint that still matches.
  let reuseIndex = -1;
  for (let i = Math.min(checkpoints.length, project.layers.length) - 1; i >= 0; i--) {
    const expected = baseKey + '|' + keyParts.slice(0, i + 1).join('|');
    if (checkpoints[i].key === expected) {
      reuseIndex = i;
      break;
    }
  }

  let height: Float32Array;
  let sediment: Float32Array;
  let eroded: Float32Array;
  let thumbs: LayerThumb[];
  let moved = 0;
  let cut = 0;
  let fill = 0;

  if (reuseIndex >= 0) {
    const cp = checkpoints[reuseIndex];
    height = new Float32Array(cp.height);
    sediment = new Float32Array(cp.sediment);
    eroded = new Float32Array(cp.eroded);
    thumbs = cloneThumbs(cp.thumbs);
    moved = cp.moved;
    cut = cp.cut;
    fill = cp.fill;
  } else {
    height = new Float32Array(N);
    sediment = new Float32Array(N);
    eroded = new Float32Array(N);
    thumbs = [];
  }

  const channelEnv = () => ({
    cellSize,
    heightScale,
    seaLevel: project.seaLevel,
    snowline: project.render.snowline,
    snowAmount: project.render.snowAmount,
    sediment: new Field(size, sediment),
    eroded: new Field(size, eroded),
    noise: new Noise(hashSeed(project.seed, 4242)),
  });

  const maskContext = (): MaskContext => ({
    size,
    noise: new Noise(hashSeed(project.seed, 77)),
    height: new Field(size, height),
    channels: new ChannelStore(new Field(size, height), channelEnv()),
    env: {
      seaLevel: project.seaLevel,
      snowline: project.render.snowline,
      heightScale,
      cellSize,
    },
    rng: makeRng(hashSeed(project.seed, 9137)),
  });

  const nextCheckpoints: Checkpoint[] = reuseIndex >= 0 ? checkpoints.slice(0, reuseIndex + 1) : [];
  let maskPreview: { id: string; size: number; data: Float32Array } | null = null;

  for (let index = 0; index < project.layers.length; index++) {
    const layer = project.layers[index];
    const key = baseKey + '|' + keyParts.slice(0, index + 1).join('|');

    if (index <= reuseIndex) {
      continue;
    }

    if (!layer.enabled) {
      nextCheckpoints.push({
        key,
        height: new Float32Array(height),
        sediment: new Float32Array(sediment),
        eroded: new Float32Array(eroded),
        thumbs: cloneThumbs(thumbs),
        moved,
        cut,
        fill,
      });
      continue;
    }

    const before = new Float32Array(height);
    const maskField = evaluateMask(layer.mask, maskContext());
    const mask = maskField ? maskField.data : null;
    if (mask && layer.id === maskPreviewId) {
      maskPreview = { id: layer.id, size: 128, data: resample(mask, size, 128) };
    }

    if (layer.role === 'generator') {
      const def = GENERATOR_MAP[layer.generator] ?? GENERATOR_MAP.perlin;
      const offset = num(layer.params, 'seed', 0);
      const genKey = `${size}|${project.seed}|${offset}|${JSON.stringify(layer.params)}`;
      const cached = generatorCache.get(layer.id);
      let data: Float32Array;
      if (cached && cached.key === genKey) {
        data = cached.data;
      } else {
        const noise = layerNoise(project.seed, layer.id, offset);
        const ctx: GenContext = {
          size,
          seed: hashSeed(project.seed, offset),
          noise,
          below: new Field(size, height),
          rng: makeRng(hashSeed(project.seed + offset, 31)),
        };
        data = def.run(ctx, layer.params).data;
        generatorCache.set(layer.id, { key: genKey, data });
        if (generatorCache.size > CACHE_LIMIT) {
          const first = generatorCache.keys().next().value;
          if (first !== undefined) generatorCache.delete(first);
        }
      }
      applyBlend(height, data, mask, layer.opacity, layer.blend ?? 'add', layer.low, layer.high);
    } else if (layer.role === 'filter') {
      const def = FILTER_MAP[layer.filter] ?? FILTER_MAP.smooth;
      const noise = layerNoise(project.seed, layer.id, 0);
      const ctx: FilterContext = {
        size,
        seed: hashSeed(project.seed, 17),
        noise,
        height: new Field(size, height),
        cellSize,
        heightScale,
        rng: makeRng(hashSeed(project.seed, 51)),
      };
      const result = def.run(ctx, layer.params).data;
      // Filters always mix towards their result, gated by mask × opacity.
      const m = layer.opacity;
      for (let i = 0; i < N; i++) {
        const k = (mask ? mask[i] : 1) * m;
        height[i] += (result[i] - height[i]) * k;
      }
    } else if (layer.role === 'erosion') {
      const def = EROSION_MAP[layer.erosion] ?? EROSION_MAP.droplet;
      const seedOffset = Number(layer.params.seed ?? 0) | 0;
      const noise = layerNoise(project.seed, layer.id, seedOffset);
      const scaledMask =
        mask ? scaleMask(mask, layer.opacity) : layer.opacity < 0.999 ? uniformMask(N, layer.opacity) : null;
      const ctx: ErosionContext = {
        size,
        height,
        mask: scaledMask,
        cellSize,
        heightScale,
        noise,
        rng: makeRng(hashSeed(project.seed + seedOffset, 7919)),
        sediment,
        eroded,
      };
      def.run(ctx, layer.params);
    }

    // Book-keeping: what this layer actually changed.
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < N; i++) {
      const d = height[i] - before[i];
      if (d < lo) lo = d;
      if (d > hi) hi = d;
      if (d > 0) fill += d;
      else cut -= d;
      moved += Math.abs(d);
    }
    if (!Number.isFinite(lo)) {
      lo = 0;
      hi = 0;
    }
    const delta = new Float32Array(N);
    for (let i = 0; i < N; i++) delta[i] = height[i] - before[i];
    if (thumbSize > 0) thumbs.push({
      id: layer.id,
      role: layer.role,
      size: thumbSize,
      data: downsample(new Field(size, delta), thumbSize),
      range: [lo, hi],
      mask: mask ? downsample(new Field(size, mask), thumbSize) : null,
    });

    nextCheckpoints.push({
      key,
      height: new Float32Array(height),
      sediment: new Float32Array(sediment),
      eroded: new Float32Array(eroded),
      thumbs: cloneThumbs(thumbs),
      moved,
      cut,
      fill,
    });
  }

  checkpoints = nextCheckpoints;

  const heightKey = baseKey + '|' + keyParts.join('|');
  for (let i = 0; i < N; i++) height[i] = clamp(height[i], -0.05, 1.6);

  const finalHeight = new Field(size, height);
  const env = channelEnv();
  const channels = new ChannelStore(finalHeight, env);

  // Satmap: composite bottom-up, snapshotting a thumbnail after every row.
  const satKey = JSON.stringify([
    heightKey,
    project.satmap,
    project.render.occlusion,
    project.render.snowline,
    project.render.snowAmount,
    project.seaLevel,
  ]);
  let satThumbs: LayerThumb[];
  let satRgba: Uint8ClampedArray;
  if (satCache && satCache.key === satKey) {
    satRgba = satCache.rgba;
    satThumbs = satCache.thumbs;
  } else {
    const fresh: LayerThumb[] = [];
    const satNoise = new Noise(hashSeed(project.seed, 5150));
    satRgba = buildSatmap(
      project.satmap,
      {
        size,
        height: finalHeight,
        channels,
        noise: satNoise,
        seaLevel: project.seaLevel,
        snowline: project.render.snowline,
        snowAmount: project.render.snowAmount,
        occlusion: project.render.occlusion,
      },
      (index, rgb, mask) => {
        const layer = project.satmap[index];
        if (thumbSize > 0) fresh.push({
          id: layer ? layer.id : '__sat__' + index,
          role: 'satmap',
          size: thumbSize,
          data: thumbnailRgb(rgb, size, thumbSize),
          range: [0, 1],
          mask: mask && layer && layer.id === maskPreviewId ? downsample(new Field(size, mask), thumbSize) : null,
        });
        if (mask && layer && layer.id === maskPreviewId) {
          maskPreview = { id: layer.id, size: 128, data: resample(mask, size, 128) };
        }
      },
    );
    satThumbs = fresh;
    satCache = { key: satKey, rgba: satRgba, thumbs: satThumbs };
  }

  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let sum = 0;
  let below = 0;
  for (let i = 0; i < N; i++) {
    const v = height[i];
    if (v < minHeight) minHeight = v;
    if (v > maxHeight) maxHeight = v;
    sum += v;
    if (v < project.seaLevel) below++;
  }

  let preview: ComputeResult['preview'] = null;
  if (options.previewChannel) {
    const field = channels.get(options.previewChannel);
    const previewSize = options.previewSize ?? Math.min(size, 384);
    preview = {
      channel: options.previewChannel,
      size: previewSize,
      data: previewSize === size ? new Float32Array(field.data) : resample(field.data, size, previewSize),
    };
  }

  return {
    size,
    height,
    rgba: new Uint8ClampedArray(satRgba),
    thumbs: [...cloneThumbs(thumbs), ...cloneThumbs(satThumbs)],
    preview,
    maskPreview,
    stats: {
      minHeight,
      maxHeight,
      meanHeight: sum / N,
      moved,
      cut,
      fill,
      seaCoverage: below / N,
      timeMs: Date.now() - start,
      cellSize,
      triangles: (size - 1) * (size - 1) * 2,
      reused: reuseIndex + 1,
    },
  };
}

function applyBlend(
  dst: Float32Array,
  src: Float32Array,
  mask: Float32Array | null,
  opacity: number,
  mode: HeightBlend,
  low: number,
  high: number,
): void {
  const span = high - low;
  for (let i = 0; i < dst.length; i++) {
    const v = low + src[i] * span;
    const m = mask ? mask[i] * opacity : opacity;
    if (m <= 0) continue;
    const d = dst[i];
    switch (mode) {
      case 'add':
        dst[i] = d + v * m;
        break;
      case 'subtract':
        dst[i] = d - v * m;
        break;
      case 'max': {
        const t = d + (v - d) * m;
        if (t > d) dst[i] = t;
        break;
      }
      case 'min': {
        const t = d + (v - d) * m;
        if (t < d) dst[i] = t;
        break;
      }
      case 'multiply':
        dst[i] = d * (1 + (v - 1) * m);
        break;
      case 'average':
        dst[i] = d + ((d + v) * 0.5 - d) * m;
        break;
      case 'replace':
        dst[i] = d + (v - d) * m;
        break;
      case 'difference':
        dst[i] = d + (Math.abs(d - v) - d) * m;
        break;
      default:
        dst[i] = d + v * m;
    }
  }
}

function scaleMask(mask: Float32Array, factor: number): Float32Array {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = mask[i] * factor;
  return out;
}

function uniformMask(n: number, value: number): Float32Array {
  const out = new Float32Array(n);
  out.fill(value);
  return out;
}

function thumbnailRgb(rgb: Float32Array, size: number, thumb: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(thumb * thumb * 4);
  const step = size / thumb;
  const radius = Math.max(1, Math.floor(step / 2));
  for (let y = 0; y < thumb; y++) {
    const cy = Math.min(size - 1, Math.floor((y + 0.5) * step));
    for (let x = 0; x < thumb; x++) {
      const cx = Math.min(size - 1, Math.floor((x + 0.5) * step));
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = Math.max(0, Math.min(size - 1, cy + dy));
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = Math.max(0, Math.min(size - 1, cx + dx));
          const i = (yy * size + xx) * 3;
          r += rgb[i];
          g += rgb[i + 1];
          b += rgb[i + 2];
          count++;
        }
      }
      const o = (y * thumb + x) * 4;
      out[o] = r / count;
      out[o + 1] = g / count;
      out[o + 2] = b / count;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Default satmap layer, used when presets or the UI need a starting row. */
export function defaultSatLayer(partial: Partial<SatLayer> = {}): SatLayer {
  return {
    id: 'sat-' + Math.random().toString(36).slice(2, 9),
    name: 'New surface',
    enabled: true,
    channel: 'height',
    ramp: [
      { at: 0, color: '#4a4034' },
      { at: 1, color: '#b6a382' },
    ],
    min: 0,
    max: 1,
    gamma: 1,
    invert: false,
    blend: 'normal',
    opacity: 1,
    detail: 0,
    detailScale: 40,
    jitter: 0,
    slopeBlend: 0,
    mask: { type: 'none', params: {}, invert: false, falloff: 0.35, strength: 1 },
    ...partial,
  };
}
