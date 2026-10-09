// Coastal / wave erosion.
//
// Wave energy peaks at the waterline and decays with depth, so cliffs are
// undercut at the toe, the toe collapses, and the debris is redistributed into
// beaches and shore platforms. The cliff retreats landward as it works.

import { Field, D8_DX, D8_DY, slopeMap } from '../field';
import { smoothstep } from '../noise';
import type { ErosionDef } from './types';
import { applyDelta } from './types';
import { num } from '../params';

export const coastalDef: ErosionDef = {
  id: 'coastal',
  label: 'Coastal — waves',
  blurb: 'Wave attack at the waterline undercuts cliffs, then redistributes the debris into beaches and shore platforms.',
  params: [
    { kind: 'slider', key: 'seaLevel', label: 'Sea level', min: 0, max: 1, step: 0.005, def: 0.28 },
    { kind: 'slider', key: 'waveHeight', label: 'Wave height', min: 0.002, max: 0.12, step: 0.002, def: 0.02 },
    { kind: 'slider', key: 'energy', label: 'Wave energy', min: 0, max: 1, step: 0.01, def: 0.55 },
    { kind: 'slider', key: 'undercut', label: 'Cliff undercutting', min: 0, max: 1, step: 0.01, def: 0.6 },
    { kind: 'slider', key: 'retreat', label: 'Retreat rate', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'beach', label: 'Beach deposition', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'platform', label: 'Shore platform', min: 0, max: 1, step: 0.01, def: 0.45 },
    { kind: 'slider', key: 'platformDepth', label: 'Platform depth', min: 0.002, max: 0.15, step: 0.002, def: 0.03 },
    { kind: 'slider', key: 'iterations', label: 'Iterations', min: 1, max: 120, step: 1, def: 24 },
  ],
  run: (ctx, p) => {
    const n = ctx.size;
    const N = n * n;
    const h = ctx.height;
    const sea = num(p, 'seaLevel', 0.28);
    const waveHeight = num(p, 'waveHeight', 0.02);
    const energy = num(p, 'energy', 0.55);
    const undercut = num(p, 'undercut', 0.6);
    const retreat = num(p, 'retreat', 0.5);
    const beach = num(p, 'beach', 0.5);
    const platform = num(p, 'platform', 0.45);
    const platformDepth = num(p, 'platformDepth', 0.03);
    const iterations = Math.round(num(p, 'iterations', 24));
    const field = new Field(n, h);

    for (let iter = 0; iter < iterations; iter++) {
      const slope = slopeMap(field, ctx.cellSize, ctx.heightScale);
      const cut = new Float32Array(N);
      const fill = new Float32Array(N);

      for (let y = 1; y < n - 1; y++) {
        for (let x = 1; x < n - 1; x++) {
          const i = y * n + x;
          const d = h[i] - sea;
          // Wave energy: strongest at the waterline, dying off above and below.
          const reach = Math.exp(-Math.abs(d) / waveHeight);
          if (reach < 0.02) continue;
          const power = reach * energy;

          if (d > 0) {
            // Cliff: only fails if there is deep water at its foot.
            let toe = false;
            let lowest = i;
            for (let dd = 0; dd < 8; dd++) {
              const nx = x + D8_DX[dd];
              const ny = y + D8_DY[dd];
              const j = ny * n + nx;
              if (h[j] < sea - waveHeight) toe = true;
              if (h[j] < h[lowest]) lowest = j;
            }
            if (!toe) continue;
            const steep = smoothstep(0.12, 0.45, slope.data[i] / (Math.PI / 2));
            const amount = undercut * power * steep * retreat * 0.006;
            if (amount > 0) {
              cut[i] += amount;
              // The debris lands at the foot of the cliff.
              fill[lowest] += amount * beach;
            }
          } else {
            // Submerged: plane the rock down towards a shore platform.
            const target = sea - platformDepth;
            if (h[i] < target) {
              const plane = (target - h[i]) * platform * power * 0.35;
              cut[i] += plane;
              fill[lowestNeighbour(h, i, n, x, y)] += plane * beach * 0.6;
            } else {
              const shave = (h[i] - target) * platform * power * 0.3;
              cut[i] += shave;
              fill[lowestNeighbour(h, i, n, x, y)] += shave * beach * 0.8;
            }
          }
        }
      }

      for (let i = 0; i < N; i++) {
        if (cut[i] > 0) applyDelta(ctx, i, -Math.min(cut[i], h[i] * 0.2 + 0.002));
        if (fill[i] > 0) applyDelta(ctx, i, fill[i]);
      }
    }
  },
};

function lowestNeighbour(h: Float32Array, i: number, n: number, x: number, y: number): number {
  let lowest = i;
  let best = h[i];
  for (let d = 0; d < 8; d++) {
    const nx = x + D8_DX[d];
    const ny = y + D8_DY[d];
    if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
    const j = ny * n + nx;
    if (h[j] < best) {
      best = h[j];
      lowest = j;
    }
  }
  return lowest;
}

export const COASTAL: ErosionDef[] = [coastalDef];
