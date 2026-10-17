// A simple driver used by the headless checker to prove each leg is drivable and to
// estimate a par time. It follows the centreline with pure pursuit and plans speed from
// the road's curvature, using the SAME limits the car physics imposes.

import { T } from './tuning.js';
import { clamp, wrapAngle } from './rng.js';
import { shardOffset } from './world.js';

// Highest speed at which the car can turn a corner of curvature k (1/m) with its yaw limit.
// Solves v * k * (1 + v / K) = Y0 for v.
export function speedForCurvature(k) {
  if (k < 1e-4) return Infinity;
  const K = T.yawFalloff;
  const Y0 = T.yaw0;
  const a = k / K;
  const b = k;
  return (-b + Math.sqrt(b * b + 4 * a * Y0)) / (2 * a);
}

export function autopilotInput(run) {
  const leg = run.legs[run.legIndex];
  const path = leg.path;
  const off = shardOffset(leg.shard, run.t);
  const car = run.car;
  const lx = car.x - off.x;
  const lz = car.z - off.z;
  const p = path.project(lx, lz);
  const v = Math.max(0, car.vf);

  // Steering: aim at a point a short distance ahead on the centreline
  const look = 6 + 0.45 * v;
  const sT = Math.min(path.length, p.s + look);
  const k = clamp(Math.round(sT / T.step), 0, path.N - 1);
  const tgt = path.samples[k];
  const desired = Math.atan2(tgt.x - lx, tgt.z - lz);
  const err = wrapAngle(desired - car.h);
  const steer = clamp(err * 2.4, -1, 1);

  // Speed plan: slow for the sharpest bend in the next 80 m, with a little margin
  let vAllow = T.engineTopSpeed * 0.95;
  for (let d = 0; d <= 80; d += 4) {
    const idx = clamp(Math.round((p.s + d) / T.step), 0, path.N - 1);
    vAllow = Math.min(vAllow, speedForCurvature(path.samples[idx].kappa) * 0.92);
  }

  let throttle = 0;
  let brake = 0;
  if (car.vf < vAllow - 0.5) throttle = 1;
  else if (car.vf > vAllow + 1) brake = clamp((car.vf - vAllow) / 4, 0.2, 1);

  return { throttle, brake, steer, handbrake: false };
}
