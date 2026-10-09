// Fluvial incision — the stream-power law.
//
// E = K · A^m · S^n, coupled to hillslope response. This is what turns a plain
// noise field into a drainage basin: valleys lengthen headward, divides sharpen
// and the network self-organises into dendritic patterns.

import { Field, D8_DIST, D8_DX, D8_DY, flowAccumulation, sortIndicesDesc } from '../field';
import type { ErosionDef } from './types';
import { applyDelta } from './types';
import { num } from '../params';
import { PowLut } from '../fastmath';

/** Reciprocals of the D8 distances — the hot loops multiply instead of dividing. */
const D8_INV = new Float32Array(D8_DIST.length);
for (let i = 0; i < D8_DIST.length; i++) D8_INV[i] = 1 / D8_DIST[i];

export const fluvialDef: ErosionDef = {
  id: 'fluvial',
  label: 'Fluvial — stream power',
  blurb: 'Rivers incise in proportion to their discharge and slope. Dendritic valleys, headward capture, graded profiles.',
  params: [
    { kind: 'slider', key: 'erodibility', label: 'Bedrock erodibility', min: 0, max: 0.4, step: 0.005, def: 0.06 },
    { kind: 'slider', key: 'areaExp', label: 'Area exponent (m)', min: 0.2, max: 1.4, step: 0.05, def: 0.5 },
    { kind: 'slider', key: 'slopeExp', label: 'Slope exponent (n)', min: 0.6, max: 2.5, step: 0.05, def: 1.1 },
    { kind: 'slider', key: 'iterations', label: 'Iterations', min: 1, max: 120, step: 1, def: 20 },
    { kind: 'slider', key: 'timestep', label: 'Timestep', min: 0.05, max: 3, step: 0.05, def: 0.5 },
    { kind: 'slider', key: 'threshold', label: 'Channel threshold', min: 0, max: 0.6, step: 0.01, def: 0.06 },
    { kind: 'slider', key: 'deposition', label: 'Deposition', min: 0, max: 1, step: 0.01, def: 0.32 },
    { kind: 'slider', key: 'bankSlope', label: 'Bank slope', min: 5, max: 50, step: 1, def: 26, unit: '°' },
    { kind: 'slider', key: 'lateral', label: 'Valley widening', min: 0, max: 1, step: 0.01, def: 0.25 },
    { kind: 'slider', key: 'uplift', label: 'Uplift', min: 0, max: 0.02, step: 0.0002, def: 0 },
  ],
  run: (ctx, p) => {
    const n = ctx.size;
    const N = n * n;
    const h = ctx.height;
    const K = num(p, 'erodibility', 0.09);
    const m = num(p, 'areaExp', 0.5);
    const expN = num(p, 'slopeExp', 1.1);
    const iterations = Math.round(num(p, 'iterations', 26));
    const dt = num(p, 'timestep', 0.5);
    const threshold = num(p, 'threshold', 0.06);
    const deposition = num(p, 'deposition', 0.32);
    const bankSlope = (num(p, 'bankSlope', 26) * Math.PI) / 180;
    const lateral = num(p, 'lateral', 0.25);
    const uplift = num(p, 'uplift', 0);
    const hs = ctx.heightScale;
    const cell = ctx.cellSize;
    const field = new Field(n, h);
    const sed = new Float32Array(N);
    const recv = new Int32Array(N);
    const drop = new Float32Array(N);
    const order = new Uint32Array(N);
    const maxStep = 0.004;
    // Sediment that reaches a closed basin fills it at a finite rate; the rest
    // is exported. Without this a single pit swallows the whole watershed.
    const lakeFill = 0.0012;
    const maxFillTotal = 0.14;
    const h0 = new Float32Array(h);
    // The drainage net evolves far more slowly than the bed, so it is only
    // re-solved every few iterations.
    const stride = 4;
    const slopeScale = hs / (cell * D8_DIST[1]);
    // Tabulated powers: the incision loop runs millions of times.
    const areaPow = new PowLut(m, 1);
    const gradePow = new PowLut(expN, 6);

    let acc: Float32Array = new Float32Array(N);
    let maxAcc = 1;
    let receiversReady = -1;
    for (let iter = 0; iter < iterations; iter++) {
      // The drainage net — and with it the routing order — evolves far more
      // slowly than the bed, so both are only re-solved every few iterations.
      if (iter - receiversReady >= stride || iter === 0) {
        acc = flowAccumulation(field) as Float32Array;
        maxAcc = 1;
        for (let i = 0; i < N; i++) if (acc[i] > maxAcc) maxAcc = acc[i];

        for (let y = 0; y < n; y++) {
          const row = y * n;
          for (let x = 0; x < n; x++) {
            const i = row + x;
            let best = -1;
            let bestDrop = 0;
            const hi = h[i];
            for (let d = 0; d < 8; d++) {
              const nx = x + D8_DX[d];
              const ny = y + D8_DY[d];
              if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
              const d2 = (hi - h[ny * n + nx]) * D8_INV[d];
              if (d2 > bestDrop) {
                bestDrop = d2;
                best = ny * n + nx;
              }
            }
            recv[i] = best;
            drop[i] = bestDrop;
          }
        }
        sortIndicesDesc(h, order);
        receiversReady = iter;
      }

      // Incision.
      for (let i = 0; i < N; i++) {
        const area = acc[i] / maxAcc;
        if (area < threshold) continue;
        const slope = drop[i] * slopeScale;
        if (slope <= 0) continue;
        const discharge = areaPow.at(area);
        const grade = gradePow.at(Math.max(slope, 1e-4));
        const erosion = K * discharge * grade * dt;
        if (erosion <= 0) continue;
        // Ceiling per iteration: deeply incised channels must not invert.
        const cut = Math.min(erosion, drop[i] * 0.4, maxStep);
        applyDelta(ctx, i, -cut);
        sed[i] += cut;
      }
      // Lateral planation: channels eat into their own banks.
      if (lateral > 0) {
        for (let y = 1; y < n - 1; y++) {
          for (let x = 1; x < n - 1; x++) {
            const i = y * n + x;
            const area = acc[i] / maxAcc;
            if (area < threshold) continue;
            const cut = sed[i] * lateral * 0.35;
            if (cut <= 0) continue;
            for (let d = 0; d < 4; d++) {
              const nx = x + D8_DX[d * 2];
              const ny = y + D8_DY[d * 2];
              const j = ny * n + nx;
              if (h[j] > h[i]) {
                const take = Math.min(cut * 0.25, (h[j] - h[i]) * 0.35);
                if (take > 0) {
                  applyDelta(ctx, j, -take);
                  sed[i] += take;
                }
              }
            }
          }
        }
      }
      // Route the load downstream, highest first, settling on gentle ground.
      const tanBank = Math.tan(bankSlope);
      for (let k = 0; k < N; k++) {
        const i = order[k];
        if (sed[i] <= 0) continue;
        const r = recv[i];
        if (r >= 0) {
          const localSlope = drop[i] * slopeScale;
          const settle = localSlope < tanBank ? deposition : deposition * 0.15;
          const keeps = 1 - settle;
          const move = sed[i] * keeps * 0.92;
          sed[i] -= move;
          sed[r] += move;
          let stays = sed[i] * settle;
          const room = Math.max(0, maxFillTotal - (h[i] - h0[i]));
          if (stays > room) stays = room;
          if (stays > 0) {
            applyDelta(ctx, i, stays);
            sed[i] -= stays;
          }
        } else {
          // Closed basin: it fills like a lake, the surplus leaves the map.
          const stays = Math.min(sed[i], lakeFill, Math.max(0, maxFillTotal - (h[i] - h0[i])));
          if (stays > 0) applyDelta(ctx, i, stays);
          sed[i] = 0;
        }
      }
      if (uplift > 0) {
        for (let i = 0; i < N; i++) applyDelta(ctx, i, uplift * dt * 0.01);
      }
    }

    // Flush whatever is still in transit, within the same fill budget.
    for (let i = 0; i < N; i++) {
      if (sed[i] > 0) {
        const stays = Math.min(sed[i], Math.max(0, maxFillTotal - (h[i] - h0[i])));
        if (stays > 0) applyDelta(ctx, i, stays);
        sed[i] = 0;
      }
    }
  },
};

export const FLUVIAL: ErosionDef[] = [fluvialDef];
