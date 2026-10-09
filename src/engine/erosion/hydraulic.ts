// Hydraulic erosion — water-driven, in two flavours.
//
//  droplet: particle simulation (Hans Theobald Beyer). Fast, great for
//           branching drainage and crisp channel incision.
//  pipe:    virtual pipes / shallow water (Mei et al.). Slower, but it moves
//           sediment as a suspended load and produces fans, floodplains and
//           deltas rather than just grooves.

import { Noise } from '../noise';
import type { ErosionDef } from './types';
import { applyDelta } from './types';
import { num } from '../params';

/* ----------------------------------------------------------------- droplet */

function brushOffsets(radius: number): { dx: Int32Array; dy: Int32Array; w: Float32Array } {
  const dx: number[] = [];
  const dy: number[] = [];
  const w: number[] = [];
  let total = 0;
  const r = Math.max(1, Math.round(radius));
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d > r + 0.001) continue;
      const weight = 1 - d / (r + 1);
      dx.push(x);
      dy.push(y);
      w.push(weight);
      total += weight;
    }
  }
  const wf = new Float32Array(w.length);
  for (let i = 0; i < w.length; i++) wf[i] = w[i] / total;
  return { dx: Int32Array.from(dx), dy: Int32Array.from(dy), w: wf };
}

export const dropletDef: ErosionDef = {
  id: 'droplet',
  label: 'Hydraulic — droplets',
  blurb: 'Raindrops run downhill, picking up and dropping sediment. Carves branching drainage networks.',
  params: [
    { kind: 'slider', key: 'droplets', label: 'Droplets', min: 1, max: 600, step: 1, def: 90, unit: 'k' },
    { kind: 'slider', key: 'lifetime', label: 'Lifetime', min: 8, max: 160, step: 1, def: 48, unit: ' steps' },
    { kind: 'slider', key: 'inertia', label: 'Inertia', min: 0, max: 0.95, step: 0.01, def: 0.32 },
    { kind: 'slider', key: 'capacity', label: 'Sediment capacity', min: 0.1, max: 8, step: 0.05, def: 3.2 },
    { kind: 'slider', key: 'minSlope', label: 'Minimum slope', min: 0, max: 0.2, step: 0.002, def: 0.008 },
    { kind: 'slider', key: 'deposition', label: 'Deposition rate', min: 0, max: 1, step: 0.01, def: 0.28 },
    { kind: 'slider', key: 'erosion', label: 'Erosion strength', min: 0, max: 2, step: 0.01, def: 0.7 },
    { kind: 'slider', key: 'evaporation', label: 'Evaporation', min: 0, max: 0.2, step: 0.002, def: 0.018 },
    { kind: 'slider', key: 'gravity', label: 'Gravity', min: 1, max: 16, step: 0.1, def: 4 },
    { kind: 'slider', key: 'radius', label: 'Erosion radius', min: 1, max: 6, step: 1, def: 2 },
  ],
  run: (ctx, p) => {
    const n = ctx.size;
    const h = ctx.height;
    const scale = (n * n) / (512 * 512);
    const droplets = Math.round(num(p, 'droplets', 90) * 1000 * scale);
    const lifetime = Math.round(num(p, 'lifetime', 48));
    const inertia = num(p, 'inertia', 0.32);
    const capacityFactor = num(p, 'capacity', 3.2);
    const minSlope = num(p, 'minSlope', 0.008);
    const depositSpeed = num(p, 'deposition', 0.28);
    const erodeSpeed = num(p, 'erosion', 0.7) * 0.5;
    const evaporate = num(p, 'evaporation', 0.018);
    const gravity = num(p, 'gravity', 4);
    const brush = brushOffsets(num(p, 'radius', 2));
    const stepCap = 0.0016;
    const brushCount = brush.dx.length;
    const rng = ctx.rng;

    // Vertical exaggeration: a droplet on a steep cell must be able to pick up
    // a meaningful amount, otherwise the simulation is invisible at map scale.
    const relief = ctx.heightScale;
    const pick = 260 / Math.max(80, relief);

    for (let d = 0; d < droplets; d++) {
      let px = rng() * (n - 1);
      let py = rng() * (n - 1);
      let dirX = 0;
      let dirY = 0;
      let speed = 1;
      let water = 1;
      let sediment = 0;

      for (let life = 0; life < lifetime; life++) {
        const cellX = px | 0;
        const cellY = py | 0;
        const cellIndex = cellY * n + cellX;
        const fx = px - cellX;
        const fy = py - cellY;

        // Bilinear height + gradient from the four surrounding nodes.
        const h00 = h[cellIndex];
        const h10 = h[cellIndex + (cellX < n - 1 ? 1 : 0)];
        const h01 = h[cellIndex + (cellY < n - 1 ? n : 0)];
        const h11 = h[cellIndex + (cellX < n - 1 && cellY < n - 1 ? n + 1 : 0)];
        const gx = (h10 - h00) * (1 - fy) + (h11 - h01) * fy;
        const gy = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;

        dirX = dirX * inertia - gx * (1 - inertia);
        dirY = dirY * inertia - gy * (1 - inertia);
        const len = Math.sqrt(dirX * dirX + dirY * dirY);
        if (len < 1e-8) {
          // Flat spot: drop everything and start a new droplet.
          if (sediment > 0) {
            applyDelta(ctx, cellIndex, sediment * 0.25);
          }
          break;
        }
        dirX /= len;
        dirY /= len;
        px += dirX;
        py += dirY;
        if (px < 1 || py < 1 || px >= n - 2 || py >= n - 2) break;

        const nx = px | 0;
        const ny = py | 0;
        const nIndex = ny * n + nx;
        const nfx = px - nx;
        const nfy = py - ny;
        const g00 = h[nIndex];
        const g10 = h[nIndex + (nx < n - 1 ? 1 : 0)];
        const g01 = h[nIndex + (ny < n - 1 ? n : 0)];
        const g11 = h[nIndex + (nx < n - 1 && ny < n - 1 ? n + 1 : 0)];
        const newHeight = g00 * (1 - nfx) * (1 - nfy) + g10 * nfx * (1 - nfy) + g01 * (1 - nfx) * nfy + g11 * nfx * nfy;
        const oldHeight = h00 * (1 - fx) * (1 - fy) + h10 * fx * (1 - fy) + h01 * (1 - fx) * fy + h11 * fx * fy;
        const dh = newHeight - oldHeight;

        const capacity = Math.max(-dh * speed * water * capacityFactor * pick, minSlope);

        if (sediment > capacity || dh > 0) {
          // Slowing down or climbing: drop the excess load.
          const amount = dh > 0 ? Math.min(dh, sediment) : (sediment - capacity) * depositSpeed;
          if (amount > 0) {
            sediment -= amount;
            for (let b = 0; b < brushCount; b++) {
              const bx = cellX + brush.dx[b];
              const by = cellY + brush.dy[b];
              if (bx < 0 || by < 0 || bx >= n || by >= n) continue;
              applyDelta(ctx, by * n + bx, amount * brush.w[b]);
            }
          }
        } else {
          // Picking up: erode from the brush, limited by the available drop.
          const amount = Math.min((capacity - sediment) * erodeSpeed, -dh * 0.9, stepCap);
          if (amount > 0) {
            for (let b = 0; b < brushCount; b++) {
              const bx = cellX + brush.dx[b];
              const by = cellY + brush.dy[b];
              if (bx < 0 || by < 0 || bx >= n || by >= n) continue;
              const w = brush.w[b];
              const take = Math.min(amount * w, h[by * n + bx] * 0.25);
              if (take <= 0) continue;
              applyDelta(ctx, by * n + bx, -take);
              sediment += take;
            }
          }
        }

        speed = Math.sqrt(Math.max(0, speed * speed + -dh * gravity * 40));
        water *= 1 - evaporate;
        if (water < 0.01) break;
      }

      // Whatever the droplet still carries when it dies or leaves the map.
      if (sediment > 0) {
        const cellX = Math.min(n - 1, Math.max(0, px | 0));
        const cellY = Math.min(n - 1, Math.max(0, py | 0));
        applyDelta(ctx, cellY * n + cellX, sediment * 0.5);
      }
    }
  },
};

/* -------------------------------------------------------------------- pipe */

export const pipeDef: ErosionDef = {
  id: 'pipe',
  label: 'Hydraulic — shallow water',
  blurb: 'Virtual pipes carry water and suspended sediment. Builds alluvial fans, floodplains and deltas.',
  params: [
    { kind: 'slider', key: 'rainfall', label: 'Rainfall', min: 0, max: 10, step: 0.05, def: 1.6, unit: ' mm' },
    { kind: 'slider', key: 'iterations', label: 'Iterations', min: 1, max: 400, step: 1, def: 32 },
    { kind: 'slider', key: 'timestep', label: 'Timestep', min: 0.005, max: 0.3, step: 0.005, def: 0.06 },
    { kind: 'slider', key: 'capacity', label: 'Sediment capacity', min: 0.002, max: 0.2, step: 0.002, def: 0.022 },
    { kind: 'slider', key: 'dissolution', label: 'Dissolution', min: 0, max: 1, step: 0.01, def: 0.32 },
    { kind: 'slider', key: 'deposition', label: 'Deposition', min: 0, max: 1, step: 0.01, def: 0.24 },
    { kind: 'slider', key: 'evaporation', label: 'Evaporation', min: 0, max: 0.4, step: 0.005, def: 0.02 },
    { kind: 'slider', key: 'pipeArea', label: 'Pipe cross-section', min: 0.05, max: 4, step: 0.05, def: 1 },
    { kind: 'slider', key: 'minTilt', label: 'Minimum tilt', min: 0, max: 0.2, step: 0.005, def: 0.05 },
  ],
  run: (ctx, p) => {
    const n = ctx.size;
    const N = n * n;
    const h = ctx.height;
    const rain = (num(p, 'rainfall', 1.6) / 1000) * (ctx.heightScale / 900);
    const iterations = Math.round(num(p, 'iterations', 90));
    const dt = num(p, 'timestep', 0.06);
    const Kc = num(p, 'capacity', 1.1);
    const Ks = num(p, 'dissolution', 0.32);
    const Kd = num(p, 'deposition', 0.24);
    const Ke = num(p, 'evaporation', 0.02);
    const A = num(p, 'pipeArea', 1);
    const minTilt = num(p, 'minTilt', 0.05);
    const g = 9.81;
    const l = ctx.cellSize;
    const hs = ctx.heightScale;
    const mask = ctx.mask;

    const fL = new Float32Array(N);
    const fR = new Float32Array(N);
    const fT = new Float32Array(N);
    const fB = new Float32Array(N);
    const water = new Float32Array(N);
    const sed = new Float32Array(N);
    const sedNext = new Float32Array(N);
    const vel = new Float32Array(N * 2);

    // Erosion gain: converts physically-scaled metres per iteration into the
    // relief change an artist expects from the slider.
    const gain = 1100;
    // Hard ceiling per iteration, in normalised height. Without it a single
    // fast, deep cell can incise the whole map in a handful of steps.
    const maxStep = 0.002;
    const maxSpeed = 8;
    const maxCapacity = 0.35;
    // A single pass may not excavate a cell by more than this much of the
    // height range, nor bury it under more than this much fill. Keeps one
    // over-enthusiastic slider from inventing a new landscape.
    const maxCutTotal = 0.35;
    const maxFillTotal = 0.14;
    const h0 = new Float32Array(h);

    for (let iter = 0; iter < iterations; iter++) {
      // 1 — rainfall.
      for (let i = 0; i < N; i++) water[i] += rain;

      // 2 — flux through the four virtual pipes.
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const hi = h[i] * hs + water[i];
          let f0 = fL[i];
          let f1 = fR[i];
          let f2 = fT[i];
          let f3 = fB[i];
          if (x > 0) {
            const j = i - 1;
            f0 = Math.max(0, f0 + dt * A * g * (hi - (h[j] * hs + water[j])) / l);
          } else f0 = 0;
          if (x < n - 1) {
            const j = i + 1;
            f1 = Math.max(0, f1 + dt * A * g * (hi - (h[j] * hs + water[j])) / l);
          } else f1 = 0;
          if (y > 0) {
            const j = i - n;
            f2 = Math.max(0, f2 + dt * A * g * (hi - (h[j] * hs + water[j])) / l);
          } else f2 = 0;
          if (y < n - 1) {
            const j = i + n;
            f3 = Math.max(0, f3 + dt * A * g * (hi - (h[j] * hs + water[j])) / l);
          } else f3 = 0;

          let total = f0 + f1 + f2 + f3;
          if (total > 0) {
            const available = water[i] * l * l;
            const wanted = total * dt;
            if (wanted > available) {
              const k = available / wanted;
              f0 *= k;
              f1 *= k;
              f2 *= k;
              f3 *= k;
              total *= k;
            }
          }
          fL[i] = f0;
          fR[i] = f1;
          fT[i] = f2;
          fB[i] = f3;
        }
      }

      // 3 — water height, velocity, erosion and deposition.
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const inflow =
            (x > 0 ? fR[i - 1] : 0) + (x < n - 1 ? fL[i + 1] : 0) + (y > 0 ? fB[i - n] : 0) + (y < n - 1 ? fT[i + n] : 0);
          const outflow = fL[i] + fR[i] + fT[i] + fB[i];
          let d = water[i] + (dt * (inflow - outflow)) / (l * l);
          if (d < 0) d = 0;
          water[i] = d;
          if (d < 1e-7) {
            vel[i * 2] = 0;
            vel[i * 2 + 1] = 0;
            continue;
          }
          const u = ((x > 0 ? fR[i - 1] : 0) - fL[i] + fR[i] - (x < n - 1 ? fL[i + 1] : 0)) * 0.5;
          const v = ((y > 0 ? fB[i - n] : 0) - fT[i] + fB[i] - (y < n - 1 ? fT[i + n] : 0)) * 0.5;
          const vu = u / (l * d);
          const vv = v / (l * d);
          vel[i * 2] = vu;
          vel[i * 2 + 1] = vv;

          let speed = Math.sqrt(vu * vu + vv * vv);
          if (speed > maxSpeed) speed = maxSpeed;
          // Tilt of the terrain surface itself.
          const hl = h[y * n + (x > 0 ? x - 1 : x)];
          const hr = h[y * n + (x < n - 1 ? x + 1 : x)];
          const ht = h[(y > 0 ? y - 1 : y) * n + x];
          const hb = h[(y < n - 1 ? y + 1 : y) * n + x];
          const dhx = ((hr - hl) * hs) / (2 * l);
          const dhy = ((hb - ht) * hs) / (2 * l);
          const grad = Math.sqrt(dhx * dhx + dhy * dhy);
          const tilt = Math.max(minTilt, grad / Math.sqrt(1 + grad * grad));

          const capacity = Math.min(maxCapacity, Kc * tilt * speed * Math.min(1, d * 40));
          const s = sed[i];
          const m = mask ? mask[i] : 1;
          if (m > 0) {
            if (capacity > s) {
              const room = maxCutTotal - (h0[i] - h[i]);
              const amount = Math.min((capacity - s) * Ks * dt * gain / hs, maxStep, Math.max(0, room)) * m;
              if (amount > 0) {
                applyDelta(ctx, i, -amount);
                sed[i] = s + amount;
              }
            } else {
              const room = maxFillTotal - (h[i] - h0[i]);
              const amount = Math.min((s - capacity) * Kd * dt * gain / hs, maxStep, Math.max(0, room)) * m;
              if (amount > 0) {
                applyDelta(ctx, i, amount);
                sed[i] = s - amount;
              }
            }
          }
        }
      }

      // 4 — conservative advection of the suspended load: every gram that
      // leaves a cell arrives at the neighbour it was carried to.
      sedNext.fill(0);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const s = sed[i];
          if (s <= 1e-12) continue;
          const total = fL[i] + fR[i] + fT[i] + fB[i];
          if (total <= 1e-12) continue;
          const depth = Math.max(1e-6, water[i]);
          const leaving = Math.min(s, (s / depth) * total * dt);
          if (leaving <= 1e-12) continue;
          sedNext[i] -= leaving;
          if (x > 0 && fL[i] > 0) sedNext[i - 1] += (leaving * fL[i]) / total;
          if (x < n - 1 && fR[i] > 0) sedNext[i + 1] += (leaving * fR[i]) / total;
          if (y > 0 && fT[i] > 0) sedNext[i - n] += (leaving * fT[i]) / total;
          if (y < n - 1 && fB[i] > 0) sedNext[i + n] += (leaving * fB[i]) / total;
        }
      }
      for (let i = 0; i < N; i++) sed[i] = Math.max(0, sed[i] + sedNext[i]);

      // 5 — evaporation, and let the map drain at the edges.
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          water[i] *= 1 - Ke * dt;
          if (x === 0 || y === 0 || x === n - 1 || y === n - 1) {
            water[i] *= 0.35;
            sed[i] *= 0.6;
          }
        }
      }
    }

    // Everything still in suspension settles when the rain stops — but only
    // up to the same fill budget, so a basin cannot be buried by one pass.
    for (let i = 0; i < N; i++) {
      if (sed[i] <= 0) continue;
      const stays = Math.min(sed[i], Math.max(0, maxFillTotal - (h[i] - h0[i])));
      if (stays > 0) applyDelta(ctx, i, stays);
    }
  },
};

export const HYDRAULIC: ErosionDef[] = [dropletDef, pipeDef];
export type { Noise };
