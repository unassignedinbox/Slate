// A leg's road: evenly sampled centreline + the surface probe the car drives on.
//
// The road is never perfectly still. Every sample is displaced by a travelling wave
// (vertical bob + small sideways sway) so the road looks like it is breathing and
// rolling through the air. Amplitudes are smaller on roofs/ramps and zero at gaps,
// so the surface stays readable and never breaks where the car must land.

import { T } from './tuning.js';
import { clamp } from './rng.js';
import { buildCenterline } from './centerline.js';

const TYPE_WEIGHT = { street: 1, bridge: 0.85, roof: 0.5, ramp: 0.6, gap: 0 };
const TAU = Math.PI * 2;

// Vertical bob (m) of the road at arc-length s and time t. Unweighted.
export function swayVertical(s, t) {
  return (
    0.32 * Math.sin((TAU * s) / 92 - (TAU * t) / 9 + 0.7) +
    0.18 * Math.sin((TAU * s) / 47 + (TAU * t) / 13 + 2.1) +
    0.1 * Math.sin((TAU * s) / 23 - (TAU * t) / 5.5 + 4.0)
  );
}

// Sideways sway (m). Visual only: the car is carried by the vertical bob and
// stays inside the 9 m road because it is far narrower than the lane.
export function swayLateral(s, t) {
  return (
    0.4 * Math.sin((TAU * s) / 150 + (TAU * t) / 17 + 1.3) +
    0.12 * Math.sin((TAU * s) / 61 - (TAU * t) / 11 + 0.4)
  );
}

export class Path {
  constructor(leg) {
    this.id = leg.id;
    const c = buildCenterline(leg.points);
    const N = c.x.length;
    this.N = N;
    this.step = T.step;
    this.length = c.length;
    this.gateS = c.length;
    this.samples = new Array(N);

    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(N - 1, i + 1);
      const dx = c.x[b] - c.x[a];
      const dz = c.z[b] - c.z[a];
      const len = Math.hypot(dx, dz) || 1;
      const tx = dx / len;
      const tz = dz / len;
      const slope = (c.y[b] - c.y[a]) / ((b - a) * T.step || 1);
      this.samples[i] = {
        x: c.x[i], y: c.y[i], z: c.z[i],
        tx, tz,
        nx: tz, nz: -tx,              // right-hand normal (positive lat = right of travel)
        slope,
        type: c.type[i],
        exists: c.type[i] !== 'gap',
        w: 0,                          // filled below
        kappa: 0,                      // filled below
      };
    }

    // Heading curvature, smoothed (1/m). Used by the autopilot's speed plan.
    const head = this.samples.map((s) => Math.atan2(s.tx, s.tz));
    const raw = new Array(N).fill(0);
    for (let i = 0; i < N; i++) {
      const a = Math.max(0, i - 2);
      const b = Math.min(N - 1, i + 2);
      let d = head[b] - head[a];
      while (d > Math.PI) d -= TAU;
      while (d < -Math.PI) d += TAU;
      raw[i] = Math.abs(d) / Math.max(1e-6, (b - a) * T.step);
    }
    for (let i = 0; i < N; i++) this.samples[i].kappa = raw[i];

    // Sway weight: type weight, fading to zero near any gap (so landings are stable).
    const gapDist = new Array(N).fill(Infinity);
    for (let i = 0; i < N; i++) if (!this.samples[i].exists) gapDist[i] = 0;
    for (let i = 1; i < N; i++) gapDist[i] = Math.min(gapDist[i], gapDist[i - 1] + 1);
    for (let i = N - 2; i >= 0; i--) gapDist[i] = Math.min(gapDist[i], gapDist[i + 1] + 1);
    for (let i = 0; i < N; i++) {
      const sm = this.samples[i];
      const near = clamp((gapDist[i] * T.step) / 10, 0, 1);
      sm.w = (TYPE_WEIGHT[sm.type] ?? 1) * near;
    }

    // Render tiles: contiguous runs of the same type, max T.tileLength long.
    this.tiles = [];
    const maxN = Math.max(1, Math.round(T.tileLength / T.step));
    let i0 = 0;
    for (let i = 1; i <= N; i++) {
      const breakHere =
        i === N ||
        this.samples[i].type !== this.samples[i0].type ||
        i - i0 >= maxN;
      if (breakHere) {
        this.tiles.push({ i0, i1: i - 1, type: this.samples[i0].type, exists: this.samples[i0].exists });
        i0 = i;
      }
    }
  }

  // Sample index -> arc length
  sAt(i) { return i * this.step; }

  // Nearest centreline point to (lx, lz) in shard-local coordinates.
  // Returns arc length s, signed lateral offset (positive = right of travel), and the index.
  project(lx, lz) {
    const S = this.samples;
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.N; i++) {
      const dx = lx - S[i].x;
      const dz = lz - S[i].z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    const sm = S[best];
    const dx = lx - sm.x;
    const dz = lz - sm.z;
    const along = dx * sm.tx + dz * sm.tz;
    const lat = dx * sm.nx + dz * sm.nz;
    return { i: best, s: best * this.step + along, lat };
  }

  // Everything the car needs to know about the road under (lx, lz) at time t.
  // All heights are shard-local; the caller adds the shard offset.
  probe(lx, lz, t) {
    const { i, s, lat } = this.project(lx, lz);
    const inRange = s >= 0 && s <= this.length;
    const k = clamp(Math.round(s / this.step), 0, this.N - 1);
    const sm = this.samples[k];
    const exists = inRange && sm.exists;

    // Base height: linear interpolation between samples.
    const fk = clamp(s / this.step, 0, this.N - 1);
    const k0 = Math.floor(fk);
    const k1 = Math.min(this.N - 1, k0 + 1);
    const f = fk - k0;
    const baseY = this.samples[k0].y + (this.samples[k1].y - this.samples[k0].y) * f;

    const w = sm.w;
    const dv = w * swayVertical(s, t);
    const dvds = (w * (swayVertical(s + 0.25, t) - swayVertical(s - 0.25, t))) / 0.5;

    return {
      i,
      s,
      lat,
      exists,
      onRoad: exists && Math.abs(lat) <= T.roadHalfWidth,
      surfaceY: baseY + dv,
      slope: sm.slope + dvds,
      tx: sm.tx,
      tz: sm.tz,
      type: sm.type,
    };
  }

  // Pose of the road at arc length s and time t (for rendering tiles / spawning).
  poseAt(s, t) {
    const fk = clamp(s / this.step, 0, this.N - 1);
    const k0 = Math.floor(fk);
    const k1 = Math.min(this.N - 1, k0 + 1);
    const f = fk - k0;
    const a = this.samples[k0];
    const b = this.samples[k1];
    const w = a.w + (b.w - a.w) * f;
    const baseX = a.x + (b.x - a.x) * f;
    const baseZ = a.z + (b.z - a.z) * f;
    const baseY = a.y + (b.y - a.y) * f;
    const dvert = w * swayVertical(s, t);
    const dlat = w * swayLateral(s, t);
    const tx = a.tx + (b.tx - a.tx) * f;
    const tz = a.tz + (b.tz - a.tz) * f;
    const n = Math.hypot(tx, tz) || 1;
    return {
      x: baseX + (tz / n) * dlat,
      y: baseY + dvert,
      z: baseZ + (-tx / n) * dlat,
      tx: tx / n,
      tz: tz / n,
      slope: a.slope + (w * (swayVertical(s + 0.25, t) - swayVertical(s - 0.25, t))) / 0.5,
      type: a.type,
    };
  }
}
