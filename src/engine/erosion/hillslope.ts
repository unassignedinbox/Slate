// Hillslope processes: the things that happen without a river in sight.

import { Field, D8_DIST, D8_DX, D8_DY, slopeMap, sortIndicesDesc } from '../field';
import { smoothstep } from '../noise';
import type { ErosionDef } from './types';
import { applyDelta } from './types';
import { num } from '../params';

/* ----------------------------------------------------------------- thermal */

export const thermalDef: ErosionDef = {
  id: 'thermal',
  label: 'Thermal — talus',
  blurb: 'Freeze–thaw shattering and dry ravel. Nothing stands steeper than the angle of repose.',
  params: [
    { kind: 'slider', key: 'angle', label: 'Angle of repose', min: 10, max: 70, step: 1, def: 34, unit: '°' },
    { kind: 'slider', key: 'rate', label: 'Rate', min: 0, max: 1, step: 0.01, def: 0.55 },
    { kind: 'slider', key: 'iterations', label: 'Passes', min: 1, max: 200, step: 1, def: 45 },
  ],
  run: (ctx, p) => {
    const n = ctx.size;
    const N = n * n;
    const h = ctx.height;
    const angle = (num(p, 'angle', 34) * Math.PI) / 180;
    const rate = num(p, 'rate', 0.55);
    const iterations = Math.round(num(p, 'iterations', 45));
    const tanAngle = Math.tan(angle);
    const delta = new Float32Array(N);

    for (let iter = 0; iter < iterations; iter++) {
      delta.fill(0);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const hi = h[i];
          // One transfer per pass, down the steepest oversteepened slope.
          // Splitting the excess across every neighbour at once would drain a
          // cell far past its own neighbours and the surface would oscillate.
          let target = -1;
          let excess = 0;
          for (let d = 0; d < 8; d++) {
            const nx = x + D8_DX[d];
            const ny = y + D8_DY[d];
            if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
            const j = ny * n + nx;
            const e = hi - h[j] - (tanAngle * ctx.cellSize * D8_DIST[d]) / ctx.heightScale;
            if (e > excess) {
              excess = e;
              target = j;
            }
          }
          if (target < 0) continue;
          const move = excess * rate * 0.5;
          delta[i] -= move;
          delta[target] += move;
        }
      }
      for (let i = 0; i < N; i++) {
        if (delta[i] !== 0) applyDelta(ctx, i, delta[i]);
      }
    }
  },
};

/* -------------------------------------------------------------- mass waste */

export const massWastingDef: ErosionDef = {
  id: 'masswasting',
  label: 'Mass wasting — landslides',
  blurb: 'Slopes steeper than the rock can hold fail and run out as debris. Builds talus aprons and slump scarps.',
  params: [
    { kind: 'slider', key: 'critical', label: 'Failure slope', min: 20, max: 75, step: 1, def: 44, unit: '°' },
    { kind: 'slider', key: 'slump', label: 'Slump volume', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'runout', label: 'Runout', min: 2, max: 120, step: 1, def: 28 },
    { kind: 'slider', key: 'repose', label: 'Deposit angle', min: 10, max: 45, step: 1, def: 30, unit: '°' },
    { kind: 'slider', key: 'entrainment', label: 'Entrainment', min: 0, max: 1, step: 0.01, def: 0.2 },
    { kind: 'slider', key: 'iterations', label: 'Events', min: 1, max: 40, step: 1, def: 8 },
  ],
  run: (ctx, p) => {
    const n = ctx.size;
    const N = n * n;
    const h = ctx.height;
    const critical = (num(p, 'critical', 44) * Math.PI) / 180;
    const slump = num(p, 'slump', 0.5);
    const runout = Math.round(num(p, 'runout', 28));
    const repose = (num(p, 'repose', 30) * Math.PI) / 180;
    const entrainment = num(p, 'entrainment', 0.2);
    const iterations = Math.round(num(p, 'iterations', 8));
    const slopeField = new Field(n, h);
    const order = new Uint32Array(N);

    for (let iter = 0; iter < iterations; iter++) {
      const slope = slopeMap(slopeField, ctx.cellSize, ctx.heightScale);
      sortIndicesDesc(h, order);
      const tanRepose = Math.tan(repose);
      for (let k = 0; k < N; k++) {
        const i = order[k];
        if (slope.data[i] < critical) continue;
        let x = i % n;
        let y = (i / n) | 0;
        const oversteep = slope.data[i] - critical;
        let volume = (Math.tan(oversteep) * ctx.cellSize * slump) / ctx.heightScale;
        if (volume <= 1e-7) continue;
        applyDelta(ctx, i, -volume);

        for (let step = 0; step < runout && volume > 1e-8; step++) {
          // Steepest descent from the current position.
          const ci = y * n + x;
          let best = -1;
          let bestDrop = 0;
          for (let d = 0; d < 8; d++) {
            const nx = x + D8_DX[d];
            const ny = y + D8_DY[d];
            if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
            const j = ny * n + nx;
            const drop = (h[ci] - h[j]) / D8_DIST[d];
            if (drop > bestDrop) {
              bestDrop = drop;
              best = j;
            }
          }
          const localSlope = slope.data[ci];
          const maxReposeDrop = (tanRepose * ctx.cellSize) / ctx.heightScale;
          if (best < 0 || bestDrop < maxReposeDrop || localSlope < repose * 0.6) {
            // Settled: spread the remaining debris over a small apron.
            const share = volume / 5;
            for (let d = 0; d < 5; d++) {
              const ox = x + (d === 0 ? 0 : D8_DX[(d - 1) * 2]);
              const oy = y + (d === 0 ? 0 : D8_DY[(d - 1) * 2]);
              if (ox < 0 || oy < 0 || ox >= n || oy >= n) continue;
              applyDelta(ctx, oy * n + ox, d === 0 ? share * 2 : share * 0.75);
            }
            volume = 0;
            break;
          }
          x = best % n;
          y = (best / n) | 0;
          // Pick up more material on the way down.
          if (localSlope > repose) {
            const pick = Math.min(volume * entrainment, (bestDrop - maxReposeDrop) * 0.4);
            if (pick > 0) {
              applyDelta(ctx, ci, -pick);
              volume += pick;
            }
          }
        }
        if (volume > 1e-8) applyDelta(ctx, y * n + x, volume);
      }
    }
  },
};

/* ------------------------------------------------------------- periglacial */

export const periglacialDef: ErosionDef = {
  id: 'periglacial',
  label: 'Periglacial — frost creep',
  blurb: 'Freeze–thaw creep, solifluction lobes and sorted ground. Rounds off summits and stripes the slopes.',
  params: [
    { kind: 'slider', key: 'intensity', label: 'Frost intensity', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'cycles', label: 'Freeze–thaw cycles', min: 1, max: 80, step: 1, def: 20 },
    { kind: 'slider', key: 'creep', label: 'Downslope creep', min: 0, max: 1, step: 0.01, def: 0.45 },
    { kind: 'slider', key: 'sorting', label: 'Sorted ground', min: 0, max: 1, step: 0.01, def: 0.25 },
    { kind: 'slider', key: 'sortingScale', label: 'Stripe spacing', min: 4, max: 80, step: 1, def: 18 },
    { kind: 'slider', key: 'maxSlope', label: 'Bare rock above', min: 10, max: 70, step: 1, def: 40, unit: '°' },
  ],
  run: (ctx, p) => {
    const n = ctx.size;
    const N = n * n;
    const h = ctx.height;
    const intensity = num(p, 'intensity', 0.5);
    const cycles = Math.round(num(p, 'cycles', 20));
    const creep = num(p, 'creep', 0.45);
    const sorting = num(p, 'sorting', 0.25);
    const sortingScale = num(p, 'sortingScale', 18);
    const maxSlope = (num(p, 'maxSlope', 40) * Math.PI) / 180;
    const field = new Field(n, h);
    const delta = new Float32Array(N);

    for (let cycle = 0; cycle < cycles; cycle++) {
      delta.fill(0);
      const slope = slopeMap(field, ctx.cellSize, ctx.heightScale);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const s = slope.data[i];
          // Frost action needs a soil mantle: it stops working on bare rock.
          const gate = 1 - smoothstep(maxSlope * 0.6, maxSlope, s);
          if (gate <= 0.001) continue;

          // Diffusive creep.
          const c = h[i];
          const sum =
            h[y * n + (x > 0 ? x - 1 : x)] +
            h[y * n + (x < n - 1 ? x + 1 : x)] +
            h[(y > 0 ? y - 1 : y) * n + x] +
            h[(y < n - 1 ? y + 1 : y) * n + x];
          const laplace = (sum * 0.25 - c) * intensity * gate * 0.4;
          delta[i] += laplace;

          // Gelifluction: slow downslope flow of saturated soil, ∝ slope².
          if (creep > 0) {
            let best = -1;
            let bestDrop = 0;
            for (let d = 0; d < 8; d++) {
              const nx = x + D8_DX[d];
              const ny = y + D8_DY[d];
              if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
              const j = ny * n + nx;
              const drop = (c - h[j]) / D8_DIST[d];
              if (drop > bestDrop) {
                bestDrop = drop;
                best = j;
              }
            }
            if (best >= 0) {
              const flow = Math.min(Math.abs(laplace) * 4, (bestDrop / D8_DIST[1]) * (s / maxSlope)) * creep * gate;
              const move = Math.min(flow, bestDrop * 0.4);
              if (move > 0) {
                delta[i] -= move;
                delta[best] += move;
              }
            }
          }
        }
      }
      for (let i = 0; i < N; i++) if (delta[i] !== 0) applyDelta(ctx, i, delta[i]);
    }

    if (sorting > 0) {
      // Sorted stripes and stone nets: shallow relief aligned with the contour
      // on ground that is gentle enough for frost heave to organise it.
      const slope = slopeMap(field, ctx.cellSize, ctx.heightScale);
      const inv = 1 / (n - 1);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const s = slope.data[i];
          if (s > maxSlope * 0.5) continue;
          const u = x * inv;
          const v = y * inv;
          const warp = ctx.noise.fbm(u * 3.2 + 7.7, v * 3.2 - 2.1, 3, 2.1, 0.5);
          const phase = (u * Math.cos(0.6) + v * Math.sin(0.6)) * sortingScale + warp * 3;
          const stripe = Math.sin(phase) * 0.5 + 0.5;
          const amount = (stripe - 0.5) * sorting * 0.006 * (1 - s / (maxSlope * 0.5));
          applyDelta(ctx, i, amount);
        }
      }
    }
  },
};

export const HILLSLOPE: ErosionDef[] = [thermalDef, massWastingDef, periglacialDef];
