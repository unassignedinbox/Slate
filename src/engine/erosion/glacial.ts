// Glacial erosion.
//
// Ice accumulates above the equilibrium line, flows downhill under its own
// weight, and reworks the bed three ways: abrasion polishes and deepens the
// trough, plucking quarries the lee side of bedrock steps, and the combination
// of both converts V-shaped river valleys into U-shaped glacial troughs.

import { PowLut } from '../fastmath';
import { Field, D8_DIST, D8_DX, D8_DY, blur, curvatureMap, slopeMap, sortIndicesDesc } from '../field';
import { clamp, smoothstep } from '../noise';
import type { ErosionDef } from './types';
import { applyDelta } from './types';

/** Ice velocity reads flux^0.6 · slope^0.8 — tabulated once. */
const FLUX_POW = new PowLut(0.6, 1e6);
const SIN_POW = new PowLut(0.8, 1);
import { num } from '../params';

export const glacialDef: ErosionDef = {
  id: 'glacial',
  label: 'Glacial — ice',
  blurb: 'Ice accumulates above the snow line, then abrades, plucks and widens the valleys it occupies.',
  params: [
    { kind: 'slider', key: 'ela', label: 'Equilibrium line (ELA)', min: 0.1, max: 1, step: 0.01, def: 0.62 },
    { kind: 'slider', key: 'accumulation', label: 'Accumulation', min: 0, max: 1, step: 0.01, def: 0.55 },
    { kind: 'slider', key: 'abrasion', label: 'Abrasion', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'plucking', label: 'Plucking', min: 0, max: 1, step: 0.01, def: 0.4 },
    { kind: 'slider', key: 'uShape', label: 'U-valley widening', min: 0, max: 1, step: 0.01, def: 0.6 },
    { kind: 'slider', key: 'cirque', label: 'Cirque cutting', min: 0, max: 1, step: 0.01, def: 0.45 },
    { kind: 'slider', key: 'moraine', label: 'Moraine deposition', min: 0, max: 1, step: 0.01, def: 0.4 },
    { kind: 'slider', key: 'iterations', label: 'Iterations', min: 1, max: 60, step: 1, def: 14 },
  ],
  run: (ctx, p) => {
    const n = ctx.size;
    const N = n * n;
    const h = ctx.height;
    const ela = num(p, 'ela', 0.62);
    const accumulation = num(p, 'accumulation', 0.55);
    const abrasion = num(p, 'abrasion', 0.5);
    const plucking = num(p, 'plucking', 0.4);
    const uShape = num(p, 'uShape', 0.6);
    const cirque = num(p, 'cirque', 0.45);
    const moraine = num(p, 'moraine', 0.4);
    const iterations = Math.round(num(p, 'iterations', 14));
    const hs = ctx.heightScale;
    const cell = ctx.cellSize;
    const field = new Field(n, h);
    const order = new Uint32Array(N);
    const ice = new Float32Array(N);
    const flux = new Float32Array(N);
    const velocity = new Float32Array(N);
    const till = new Float32Array(N);

    for (let iter = 0; iter < iterations; iter++) {
      // 1 — accumulation above the equilibrium line.
      const band = Math.max(0.05, 1 - ela);
      for (let i = 0; i < N; i++) {
        const alt = smoothstep(ela - 0.04, ela + band * 0.6, h[i]);
        const drift = 0.75 + 0.25 * (0.5 + 0.5 * ctx.noise.perlin((i % n) * 0.02 + 3.1, ((i / n) | 0) * 0.02 - 7.4));
        ice[i] = accumulation * alt * drift * 0.02;
      }

      // 2 — route the ice downhill, highest cell first.
      sortIndicesDesc(h, order);
      flux.fill(0);
      for (let k = 0; k < N; k++) {
        const i = order[k];
        const x = i % n;
        const y = (i / n) | 0;
        let best = -1;
        let bestDrop = 0;
        for (let d = 0; d < 8; d++) {
          const nx = x + D8_DX[d];
          const ny = y + D8_DY[d];
          if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
          const j = ny * n + nx;
          const slope = (h[i] + ice[i] - (h[j] + ice[j])) / D8_DIST[d];
          if (slope > bestDrop) {
            bestDrop = slope;
            best = j;
          }
        }
        flux[i] += ice[i];
        if (best >= 0) {
          // Most of the ice survives the step down; the rest ablates.
          const ablation = clamp(0.02 + (ela - h[i]) * 0.35, 0.02, 0.95);
          flux[best] += flux[i] * (1 - ablation);
        }
      }

      // 3 — basal velocity ∝ thickness × surface slope.
      const slope = slopeMap(field, cell, hs);
      for (let i = 0; i < N; i++) {
        const s = slope.data[i];
        velocity[i] = flux[i] > 0 ? FLUX_POW.at(flux[i]) * SIN_POW.at(Math.sin(Math.min(s, 1.4))) : 0;
      }
      let maxV = 1e-6;
      for (let i = 0; i < N; i++) if (velocity[i] > maxV) maxV = velocity[i];
      for (let i = 0; i < N; i++) velocity[i] /= maxV;

      const curv = curvatureMap(field);

      // 4 — erosion and deposition.
      for (let y = 1; y < n - 1; y++) {
        for (let x = 1; x < n - 1; x++) {
          const i = y * n + x;
          const v = velocity[i];
          if (v <= 0.001) continue;

          // Abrasion polishes the bed under fast ice.
          const grind = abrasion * v * 0.030;
          if (grind > 0) {
            applyDelta(ctx, i, -grind);
            till[i] += grind;
          }

          // Plucking quarries the lee side of bedrock steps.
          const s = slope.data[i];
          const step = smoothstep(0.28, 0.62, s / (Math.PI / 2));
          const quarry = plucking * v * step * 0.026;
          if (quarry > 0) {
            applyDelta(ctx, i, -quarry);
            till[i] += quarry;
          }

          // Cirque cutting: overdeepening where ice is born.
          if (cirque > 0) {
            const concavity = clamp(0.5 - curv.data[i] * 260, 0, 1);
            const headwall = smoothstep(ela - 0.06, ela + 0.12, h[i]) * (1 - smoothstep(ela + 0.2, ela + 0.45, h[i]));
            const cut = cirque * concavity * headwall * v * 0.045;
            if (cut > 0) {
              applyDelta(ctx, i, -cut);
              till[i] += cut;
            }
          }

          // U-shape: the trough walls are attacked from the side.
          if (uShape > 0) {
            for (let d = 0; d < 4; d++) {
              const nx = x + D8_DX[d * 2];
              const ny = y + D8_DY[d * 2];
              const j = ny * n + nx;
              if (h[j] <= h[i]) continue;
              const wall = clamp((h[j] - h[i]) * hs * 0.02, 0, 1);
              const take = uShape * v * (1 - wall) * 0.020;
              if (take > 0) {
                applyDelta(ctx, j, -take);
                till[i] += take;
              }
            }
          }
        }
      }

      // 5 — till is dropped where the ice slows down.
      const smoothedV = blur(new Field(n, velocity), Math.max(1, Math.round(n / 120)));
      for (let i = 0; i < N; i++) {
        const slow = smoothedV.data[i] * 0.8 - velocity[i];
        if (slow > 0 && till[i] > 0) {
          const drop = Math.min(till[i], till[i] * moraine * clamp(slow * 12, 0, 1));
          if (drop > 0) {
            applyDelta(ctx, i, drop);
            till[i] -= drop;
          }
        }
      }
    }

    // Ice has melted: dump the remaining till as ground moraine.
    for (let i = 0; i < N; i++) {
      if (till[i] > 0) applyDelta(ctx, i, till[i]);
    }
  },
};

export const GLACIAL: ErosionDef[] = [glacialDef];
