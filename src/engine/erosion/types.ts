// Shared plumbing for the erosion passes.

import type { Noise } from '../noise';
import type { OpDef, Params } from '../params';

export interface ErosionContext {
  size: number;
  /** Heightfield in normalised units — modified in place. */
  height: Float32Array;
  /** Per-cell layer mask, or null when unmasked. */
  mask: Float32Array | null;
  /** Metres per cell. */
  cellSize: number;
  /** Metres represented by a normalised height of 1. */
  heightScale: number;
  noise: Noise;
  rng: () => number;
  /** Accumulator: material laid down (normalised units). */
  sediment: Float32Array;
  /** Accumulator: material removed (normalised units). */
  eroded: Float32Array;
}

export interface ErosionDef extends OpDef {
  run: (ctx: ErosionContext, p: Params) => void;
}

/** Per-cell helper: apply a masked change and book-keep the mass balance. */
export function applyDelta(ctx: ErosionContext, i: number, delta: number): void {
  if (delta === 0) return;
  const m = ctx.mask ? ctx.mask[i] : 1;
  if (m <= 0) return;
  const d = delta * m;
  ctx.height[i] += d;
  if (d > 0) ctx.sediment[i] += d;
  else ctx.eroded[i] -= d;
}
