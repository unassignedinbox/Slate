// Ray and box queries against the level's oriented boxes.
//
// Road plates are oriented boxes whose transforms animate over time, so we
// test rays against the current world transform rather than baked meshes.

import { mat4Axis, mat4Position, sub, dot, madd, scale, UP } from './math.js';

// Ray (o, d) vs oriented box with world matrix M and half extents h.
// Returns { t, point, normal } for the nearest entry point within [0, maxT],
// or null.
export function rayObb(o, d, M, h, maxT) {
  const ax = mat4Axis(M, 0);
  const ay = mat4Axis(M, 1);
  const az = mat4Axis(M, 2);
  const oc = sub(o, mat4Position(M));
  const lo = [dot(oc, ax), dot(oc, ay), dot(oc, az)];
  const ld = [dot(d, ax), dot(d, ay), dot(d, az)];
  const axes = [ax, ay, az];

  let tmin = -Infinity;
  let tmax = Infinity;
  let hitAxis = -1;
  let hitSign = 0;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(ld[i]) < 1e-9) {
      if (lo[i] < -h[i] || lo[i] > h[i]) return null;
      continue;
    }
    let t1 = (-h[i] - lo[i]) / ld[i];
    let t2 = (h[i] - lo[i]) / ld[i];
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      hitAxis = i;
      hitSign = sign;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax || tmax < 0) return null;
  }
  if (hitAxis < 0 || tmin < 0 || tmin > maxT) return null;
  const normal = scale(axes[hitAxis], hitSign);
  return { t: tmin, point: madd(o, d, tmin), normal };
}

// Nearest downward hit against a list of ground items (items with .anchor and .half).
// Items are culled by their static home position first, so this stays cheap
// even with a few hundred road plates.
export function probeGround(o, d, items, t, maxT) {
  let best = null;
  const reach = maxT + 14;
  for (const item of items) {
    const c = item.staticCenter;
    const dx = c[0] - o[0];
    const dy = c[1] - o[1];
    const dz = c[2] - o[2];
    if (dx * dx + dy * dy + dz * dz > reach * reach) continue;
    const hit = rayObb(o, d, item.anchor.world(t), item.half, maxT);
    if (hit && (!best || hit.t < best.t)) {
      best = { ...hit, item };
    }
  }
  return best;
}

export const WORLD_UP = UP;
