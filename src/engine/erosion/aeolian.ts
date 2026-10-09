// Aeolian (wind) erosion.
//
// A downwind saltation model: sand is lifted from windward slopes, carried in
// hops, and dropped in the lee or wherever the pile exceeds its repose angle.
// That feedback is what grows barchans, transverse ridges and sand seas.

import { Field, D8_DIST, D8_DX, D8_DY, slopeMap } from '../field';
import { clamp, smoothstep } from '../noise';
import type { ErosionDef } from './types';
import { applyDelta } from './types';
import { num } from '../params';

export const aeolianDef: ErosionDef = {
  id: 'aeolian',
  label: 'Aeolian — wind',
  blurb: 'Saltation and deflation: sand is stripped from windward faces and piled into dunes downwind.',
  params: [
    { kind: 'slider', key: 'direction', label: 'Wind direction', min: 0, max: 360, step: 1, def: 35, unit: '°' },
    { kind: 'slider', key: 'strength', label: 'Wind strength', min: 0, max: 1, step: 0.01, def: 0.55 },
    { kind: 'slider', key: 'deflation', label: 'Deflation', min: 0, max: 1, step: 0.01, def: 0.45 },
    { kind: 'slider', key: 'saltation', label: 'Saltation hops', min: 0, max: 1, step: 0.01, def: 0.6 },
    { kind: 'slider', key: 'shelter', label: 'Lee deposition', min: 0, max: 1, step: 0.01, def: 0.65 },
    { kind: 'slider', key: 'repose', label: 'Dune repose', min: 15, max: 45, step: 1, def: 32, unit: '°' },
    { kind: 'slider', key: 'abrasion', label: 'Abrasion', min: 0, max: 1, step: 0.01, def: 0.2 },
    { kind: 'slider', key: 'ripples', label: 'Wind ripples', min: 0, max: 1, step: 0.01, def: 0.3 },
    { kind: 'slider', key: 'rippleScale', label: 'Ripple spacing', min: 4, max: 160, step: 1, def: 26 },
    { kind: 'slider', key: 'iterations', label: 'Iterations', min: 1, max: 80, step: 1, def: 14 },
  ],
  run: (ctx, p) => {
    const n = ctx.size;
    const N = n * n;
    const h = ctx.height;
    const dir = (num(p, 'direction', 35) * Math.PI) / 180;
    const wx = Math.cos(dir);
    const wy = Math.sin(dir);
    const strength = num(p, 'strength', 0.55);
    const deflation = num(p, 'deflation', 0.45);
    const saltation = num(p, 'saltation', 0.6);
    const shelter = num(p, 'shelter', 0.65);
    const repose = (num(p, 'repose', 32) * Math.PI) / 180;
    const abrasion = num(p, 'abrasion', 0.2);
    const ripples = num(p, 'ripples', 0.3);
    const rippleScale = num(p, 'rippleScale', 26);
    const iterations = Math.round(num(p, 'iterations', 14));
    const hs = ctx.heightScale;
    const cell = ctx.cellSize;
    const tanRepose = Math.tan(repose);
    const sand = new Float32Array(N);
    const field = new Field(n, h);

    // Walk the grid in the order the wind would reach it.
    const order = new Uint32Array(N);
    for (let i = 0; i < N; i++) order[i] = i;
    const along = new Float32Array(N);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        along[y * n + x] = x * wx + y * wy;
      }
    }
    const sorted = Array.from(order).sort((a, b) => along[a] - along[b]);
    const walk = Uint32Array.from(sorted);

    // The wind steps one whole cell along its dominant axis.
    const ux = Math.abs(wx) > Math.abs(wy) ? (wx >= 0 ? 1 : -1) : 0;
    const uy = Math.abs(wx) > Math.abs(wy) ? 0 : wy >= 0 ? 1 : -1;

    for (let iter = 0; iter < iterations; iter++) {
      for (let k = 0; k < N; k++) {
        const i = walk[k];
        const x = i % n;
        const y = (i / n) | 0;
        // Upwind sample: the cell the wind came from.
        const px = x - ux;
        const py = y - uy;
        const up = py >= 0 && py < n && px >= 0 && px < n ? py * n + px : i;
        // Slope along the wind direction, in metres per metre.
        const windSlope = ((h[i] - h[up]) * hs) / cell;
        const exposure = clamp(windSlope * 2.2, -1, 1);

        if (exposure > 0) {
          // Windward face: lift sand.
          const lift = deflation * exposure * strength * 0.004;
          if (lift > 0) {
            const take = Math.min(lift, h[i] * 0.02 + 1e-6);
            applyDelta(ctx, i, -take);
            sand[i] += take;
          }
          // Abrasion: exposed crests get sandblasted, not just stripped.
          if (abrasion > 0) {
            const blast = abrasion * exposure * strength * 0.0012;
            applyDelta(ctx, i, -blast);
            sand[i] += blast * 0.5;
          }
        }

        // Transport downwind.
        if (sand[i] > 1e-9) {
          const dx = x + ux;
          const dy = y + uy;
          const hop = sand[i] * (0.35 + saltation * 0.45) * strength;
          sand[i] -= hop;
          if (dx >= 0 && dy >= 0 && dx < n && dy < n) sand[dy * n + dx] += hop;
        }

        // Settling: in the lee, or wherever the pile is oversteepened.
        if (sand[i] > 1e-9) {
          let steepest = 0;
          for (let d = 0; d < 8; d++) {
            const nx = x + D8_DX[d];
            const ny = y + D8_DY[d];
            if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
            const j = ny * n + nx;
            const s = ((h[i] - h[j]) * hs) / (cell * D8_DIST[d]);
            if (s > steepest) steepest = s;
          }
          let rate = 0;
          if (exposure < 0) rate += shelter * -exposure * 0.6;
          if (steepest > tanRepose) rate += shelter * clamp((steepest - tanRepose) * 1.5, 0, 1);
          rate += 0.04;
          const drop = Math.min(sand[i], sand[i] * clamp(rate, 0, 1));
          if (drop > 0) {
            applyDelta(ctx, i, drop);
            sand[i] -= drop;
          }
        }
      }
    }

    // Ripples, laid over the sand cover.
    if (ripples > 0) {
      const slope = slopeMap(field, cell, hs);
      const inv = 1 / (n - 1);
      for (let y = 0; y < n; y++) {
        const v = y * inv;
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const u = x * inv;
          const s = slope.data[i];
          if (s > 0.6) continue;
          const phase = (u * wx + v * wy) * rippleScale;
          const drift = ctx.noise.fbm(u * 2.4 + 13.1, v * 2.4 - 4.8, 3, 2.1, 0.5) * 4;
          const wave = Math.sin(phase + drift) * 0.5 + 0.5;
          const cover = 1 - smoothstep(0.15, 0.6, s);
          const amount = (wave - 0.5) * ripples * 0.012 * cover;
          applyDelta(ctx, i, amount);
        }
      }
    }

    // Any sand still airborne settles where it stands.
    for (let i = 0; i < N; i++) {
      if (sand[i] > 1e-9) applyDelta(ctx, i, sand[i]);
    }
  },
};

export const AEOLIAN: ErosionDef[] = [aeolianDef];
