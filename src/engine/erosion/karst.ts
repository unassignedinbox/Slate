// Chemical erosion — karst.
//
// Rain weakly acidified by CO₂ dissolves soluble rock. Water follows the joint
// network and the drainage lines, widening them into grikes and dolines; on a
// large scale the surface breaks up into cockpit (polygonal) karst with
// residual cones between the closed depressions.

import { Field, curvatureMap, slopeMap } from '../field';
import { clamp, smoothstep } from '../noise';
import type { ErosionDef } from './types';
import { applyDelta } from './types';
import { num } from '../params';

export const karstDef: ErosionDef = {
  id: 'karst',
  label: 'Chemical — karst',
  blurb: 'Dissolution along joints and drainage lines: grikes, dolines, sinkholes and cockpit karst.',
  params: [
    { kind: 'slider', key: 'dissolution', label: 'Dissolution rate', min: 0, max: 1, step: 0.01, def: 0.45 },
    { kind: 'slider', key: 'jointing', label: 'Joint density', min: 1, max: 30, step: 0.5, def: 8 },
    { kind: 'slider', key: 'jointWidth', label: 'Joint width', min: 0.01, max: 0.4, step: 0.01, def: 0.12 },
    { kind: 'slider', key: 'sinkholes', label: 'Sinkholes', min: 0, max: 1, step: 0.01, def: 0.35 },
    { kind: 'slider', key: 'sinkholeSize', label: 'Sinkhole size', min: 2, max: 60, step: 1, def: 14 },
    { kind: 'slider', key: 'cockpit', label: 'Cockpit karst', min: 0, max: 1, step: 0.01, def: 0.25 },
    { kind: 'slider', key: 'cockpitScale', label: 'Cockpit scale', min: 1, max: 24, step: 0.5, def: 6 },
    { kind: 'slider', key: 'lowering', label: 'Surface lowering', min: 0, max: 1, step: 0.01, def: 0.2 },
    { kind: 'slider', key: 'iterations', label: 'Iterations', min: 1, max: 40, step: 1, def: 6 },
  ],
  run: (ctx, p) => {
    const n = ctx.size;
    const h = ctx.height;
    const dissolution = num(p, 'dissolution', 0.45);
    const jointing = num(p, 'jointing', 8);
    const jointWidth = num(p, 'jointWidth', 0.12);
    const sinkholes = num(p, 'sinkholes', 0.35);
    const sinkholeSize = num(p, 'sinkholeSize', 14);
    const cockpit = num(p, 'cockpit', 0.25);
    const cockpitScale = num(p, 'cockpitScale', 6);
    const lowering = num(p, 'lowering', 0.2);
    const iterations = Math.round(num(p, 'iterations', 6));
    const noise = ctx.noise;
    const field = new Field(n, h);
    const inv = 1 / (n - 1);

    for (let iter = 0; iter < iterations; iter++) {
      const slope = slopeMap(field, ctx.cellSize, ctx.heightScale);
      const curv = curvatureMap(field);

      for (let y = 0; y < n; y++) {
        const v = y * inv;
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const u = x * inv;

          // Joint-controlled grikes: dissolution follows the fracture network.
          const jx = noise.worley(u * jointing + iter * 0.11, v * jointing - iter * 0.07, 1, 0.85);
          const joint = 1 - smoothstep(0, Math.max(0.01, jointWidth), Math.abs(jx) * 2);

          // Water throughput concentrates in hollows and along drainage.
          const trough = clamp(0.5 - curv.data[i] * 220, 0, 1);
          const flat = 1 - smoothstep(0.05, 0.5, slope.data[i] / (Math.PI / 2));

          const rate = dissolution * (joint * 0.7 + trough * 0.5 + flat * 0.25);
          const amount = rate * 0.0025;
          if (amount > 0) applyDelta(ctx, i, -amount);

          if (lowering > 0) {
            applyDelta(ctx, i, -lowering * (0.4 + 0.6 * flat) * 0.0009);
          }
        }
      }
    }

    // Closed depressions: dolines where water converges in a soluble basin.
    if (sinkholes > 0) {
      const curv = curvatureMap(field);
      const radius = Math.max(2, Math.round(sinkholeSize));
      // Dolines are spaced out on a jittered lattice, so each one digs its own
      // basin instead of stacking hundreds of overlapping pits on every cell.
      const spacing = Math.max(4, radius * 2);
      for (let gy = radius; gy < n - radius; gy += spacing) {
        for (let gx = radius; gx < n - radius; gx += spacing) {
          const jitterX = Math.round(ctx.rng() * spacing * 0.6 - spacing * 0.3);
          const jitterY = Math.round(ctx.rng() * spacing * 0.6 - spacing * 0.3);
          const x = Math.min(n - radius - 1, Math.max(radius, gx + jitterX));
          const y = Math.min(n - radius - 1, Math.max(radius, gy + jitterY));
          const i = y * n + x;
          const convergence = clamp(0.5 - curv.data[i] * 300, 0, 1);
          const seed = noise.perlin(x * 0.06 + 21.3, y * 0.06 - 8.8);
          if (seed * 0.5 + 0.5 < 0.35) continue;
          const depth = sinkholes * convergence * 0.06 * (0.4 + 0.6 * (seed * 0.5 + 0.5));
          if (depth <= 0.0005) continue;
          for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
              const d = Math.sqrt(dx * dx + dy * dy) / radius;
              if (d > 1) continue;
              const profile = Math.pow(Math.cos(d * Math.PI * 0.5), 1.6);
              applyDelta(ctx, (y + dy) * n + (x + dx), -depth * profile);
            }
          }
        }
      }
    }

    // Cockpit karst: star-shaped closed depressions between residual cones.
    if (cockpit > 0) {
      for (let y = 0; y < n; y++) {
        const v = y * inv;
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const u = x * inv;
          const cell = noise.worley(u * cockpitScale + 5.5, v * cockpitScale - 2.5, 2, 0.7);
          const bowl = clamp((cell + 1) * 0.5, 0, 1);
          const amount = (0.5 - bowl) * cockpit * 0.05;
          if (amount !== 0) applyDelta(ctx, i, amount);
        }
      }
    }
  },
};

export const CHEMICAL: ErosionDef[] = [karstDef];
