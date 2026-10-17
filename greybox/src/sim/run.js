// A run = one attempt at the section. Owns the car, the current leg, portals,
// timing and respawns. The browser game and the headless checker both drive it,
// so the par times the checker prints are the ones a player will get.

import { Path } from './path.js';
import { makeCar, stepCar } from './car.js';
import { T } from './tuning.js';
import { clamp } from './rng.js';
import { shardOffset, propCenter } from './world.js';

export function createRun(level, town) {
  const shardById = new Map(level.shards.map((s) => [s.id, s]));
  const legs = level.legs.map((def, index) => {
    const shard = shardById.get(def.shard);
    if (!shard) throw new Error(`leg ${def.id} references unknown shard ${def.shard}`);
    return { def, index, shard, path: new Path(def), name: def.name, end: def.end };
  });

  const run = {
    level,
    town,
    legs,
    t: 0,                 // world time (drives waves and bobbing). Always runs
    clock: 0,             // race clock. Starts on first throttle input
    started: false,
    finished: false,
    legIndex: 0,
    legStartClock: 0,
    legTimes: [],         // race seconds per completed leg
    totalTime: 0,
    lastGoodS: 0,
    prevS: 0,
    respawns: 0,
    car: null,
    events: [],           // drained by the renderer each frame
  };
  spawnAtLegStart(run, 0);
  return run;
}

function groundPose(run, legIndex, s) {
  const leg = run.legs[legIndex];
  const off = shardOffset(leg.shard, run.t);
  const p = leg.path.poseAt(s, run.t);
  return { x: off.x + p.x, y: off.y + p.y, z: off.z + p.z, tx: p.tx, tz: p.tz, off };
}

function spawnAtLegStart(run, legIndex) {
  const g = groundPose(run, legIndex, 0);
  const car = makeCar(g.x, g.y + 0.05, g.z, Math.atan2(g.tx, g.tz));
  car.vf = 0;
  run.car = car;
  run.legIndex = legIndex;
  run.prevS = 0;
  run.lastGoodS = 0;
}

// Respawn: go back a little along the road from the last place the car was grounded.
export function respawn(run, why) {
  const leg = run.legs[run.legIndex];
  let s = Math.max(0, run.lastGoodS - T.respawnBack);
  let i = Math.round(s / T.step);
  while (i > 0 && !leg.path.samples[i].exists) i--;
  s = i * T.step;
  const g = groundPose(run, run.legIndex, s);
  const car = makeCar(g.x, g.y + 0.05, g.z, Math.atan2(g.tx, g.tz));
  run.car = car;
  run.prevS = s;
  run.lastGoodS = s;
  run.respawns++;
  run.events.push({ type: 'respawn', why });
}

// Solid collisions: buildings (static boxes) and floating props (moving spheres).
function collideSolids(run, car, off, shardTown) {
  const lx = car.x - off.x;
  const lz = car.z - off.z;
  const ly = car.y - off.y;
  const R = T.carRadius;

  const hit = (nx, nz, pen) => {
    car.x += nx * pen;
    car.z += nz * pen;
    const vn = car.vx * nx + car.vz * nz;
    if (vn < 0) {
      car.vx -= 1.2 * vn * nx;
      car.vz -= 1.2 * vn * nz;
      car.vx *= 0.92;
      car.vz *= 0.92;
    }
    if (car.hitCooldown <= 0) {
      run.events.push({ type: 'bump' });
      car.hitCooldown = 0.25;
    }
  };

  for (const b of shardTown.solids) {
    // Car is inside the box's height band only if its body is below the roof
    if (ly + 0.4 > b.h) continue;
    const x0 = b.x - b.w / 2, x1 = b.x + b.w / 2;
    const z0 = b.z - b.d / 2, z1 = b.z + b.d / 2;
    if (lx < x0 - R || lx > x1 + R || lz < z0 - R || lz > z1 + R) continue;
    const cx = clamp(lx, x0, x1);
    const cz = clamp(lz, z0, z1);
    const dx = lx - cx;
    const dz = lz - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 > R * R) continue;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      hit(dx / d, dz / d, R - d);
    } else {
      // centre is inside the box: push out through the nearest face
      const left = lx - x0, right = x1 - lx, back = lz - z0, front = z1 - lz;
      const m = Math.min(left, right, back, front);
      if (m === left) hit(-1, 0, left + R);
      else if (m === right) hit(1, 0, right + R);
      else if (m === back) hit(0, -1, back + R);
      else hit(0, 1, front + R);
    }
  }

  for (const p of shardTown.props) {
    if (!p.solid) continue;
    const c = propCenter(p, run.t);
    if (Math.abs(ly - c.y) > p.r + T.carHeight * 0.5) continue;
    const dx = lx - c.x;
    const dz = lz - c.z;
    const rr = p.r + R;
    const d2 = dx * dx + dz * dz;
    if (d2 >= rr * rr) continue;
    const d = Math.sqrt(d2) || 1e-6;
    hit(dx / d, dz / d, rr - d);
  }
}

// Advance the run by dt seconds (frame time). Input shape:
// { throttle, brake, steer, handbrake }
export function stepRun(run, input, dt) {
  if (run.finished) return;
  run.t += dt;
  if (!run.started && (input.throttle > 0 || input.brake > 0 || Math.abs(input.steer || 0) > 0)) {
    run.started = true;
  }
  if (run.started) run.clock += dt;

  const leg = run.legs[run.legIndex];
  const off = shardOffset(leg.shard, run.t);
  const shardTown = run.town.shards[leg.shard.id];
  const car = run.car;
  if (car.hitCooldown > 0) car.hitCooldown -= dt;

  const env = {
    probe: (x, y, z) => {
      const r = leg.path.probe(x - off.x, z - off.z, run.t);
      return { onRoad: r.onRoad, surfaceY: r.surfaceY + off.y, slope: r.slope, s: r.s, lat: r.lat };
    },
    collide: (c) => collideSolids(run, c, off, shardTown),
  };

  stepCar(car, input, env, dt);

  // Bookkeeping on the road
  const lx = car.x - off.x;
  const lz = car.z - off.z;
  const proj = leg.path.project(lx, lz);
  if (car.grounded) run.lastGoodS = Math.max(0, proj.s);

  // Portal / finish: crossing the leg's gate plane
  const gateS = leg.path.gateS;
  const crossed = run.prevS < gateS && proj.s >= gateS;
  const surf = leg.path.probe(lx, lz, run.t).surfaceY + off.y;
  const inGateBand = car.y <= surf + 6 && car.y >= surf - 3;
  if (crossed && Math.abs(proj.lat) <= T.gateTriggerLat && inGateBand) {
    onGate(run, leg);
    return;
  }
  run.prevS = proj.s;

  // Falling off the world, or spending too long in the air
  const offNow = shardOffset(leg.shard, run.t);
  if (car.y < offNow.y - T.fallY || car.airTime > T.maxAirTime) {
    respawn(run, car.y < offNow.y - T.fallY ? 'fell' : 'airborne');
    return;
  }
  // Drifted way off the road sideways while airborne
  if (!car.grounded && Math.abs(proj.lat) > 25 && car.airTime > 1.2) {
    respawn(run, 'off-road');
  }
}

function onGate(run, leg) {
  const speed = Math.hypot(run.car.vx, run.car.vz);
  const legTime = run.clock - run.legStartClock;
  run.legTimes.push(legTime);

  if (leg.end.kind === 'finish') {
    run.finished = true;
    run.totalTime = run.clock;
    run.events.push({ type: 'finish', legTime, total: run.clock });
    return;
  }

  run.events.push({ type: 'checkpoint', name: leg.end.name, legTime, total: run.clock, from: leg.name });
  const next = run.legIndex + 1;
  run.legStartClock = run.clock;
  spawnAtLegStart(run, next);
  // The portal keeps your speed: exit along the new leg's direction at the same speed
  const nl = run.legs[next];
  const p0 = nl.path.samples[0];
  run.car.vx = p0.tx * speed;
  run.car.vz = p0.tz * speed;
  run.car.vf = speed;
  run.car.h = Math.atan2(p0.tx, p0.tz);
  run.car.grounded = true;
}

export function legTimeNow(run) {
  return run.clock - run.legStartClock;
}
