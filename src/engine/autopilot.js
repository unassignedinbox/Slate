// A simple driver used by the tests and the level report. It follows the
// centreline of whichever zone the car is in, slows for corners, and lets the
// portals do the rest. It is deliberately conservative: it shows the route is
// drivable, not how fast a human can finish it.

import { routeAt, nearestS } from './spline.js';
import { clamp, dot } from './math.js';

export function createAutopilot(level, { cruise = 26, lookBase = 8, lookPerMs = 0.6, lateralG = 8 } = {}) {
  const state = { partId: null, s: 0 };
  return function autopilot(world) {
    const car = world.car;
    const part = level.partsById[world.partId];
    const route = part.route;
    if (state.partId !== part.id) {
      state.partId = part.id;
      state.s = nearestS(route, car.pos, 0, 1e9);
    }
    state.s = nearestS(route, car.pos, state.s, 40);

    const { F, R } = car.frame;
    const speed = Math.abs(car.speed);
    const target = routeAt(route, Math.min(route.length, state.s + lookBase + lookPerMs * speed));
    const d = [target.p[0] - car.pos[0], 0, target.p[2] - car.pos[2]];
    const err = Math.atan2(dot(d, R), dot(d, F));
    const steer = clamp(err * 2.2, -1, 1);

    const a = routeAt(route, state.s + 15);
    const b = routeAt(route, state.s + 40);
    const turn = Math.acos(clamp(dot(a.F, b.F), -1, 1));
    const kappa = turn / 25;
    const vTarget = Math.min(cruise, Math.sqrt(lateralG / Math.max(kappa, 1e-4)));

    let throttle = 0;
    let brake = 0;
    if (speed < vTarget - 1) throttle = 1;
    else if (speed > vTarget + 2) brake = clamp((speed - vTarget) / 6, 0, 1);
    return { throttle, brake, steer, handbrake: false };
  };
}

// Drive the whole level headlessly with the autopilot and report what happened.
// Used by the tests and by tools/level-report.mjs.
export function runAutopilot(level, { physicsDt = 1 / 120, maxSeconds = 400, ...opts } = {}) {
  // Imported lazily so this module stays usable without the world module.
  return import('./world.js').then(({ World }) => {
    const world = new World(level);
    const ap = createAutopilot(level, opts);
    let collisionsWithScenery = 0;
    let collisionsWithKerbs = 0;
    const steps = Math.ceil(maxSeconds / physicsDt);
    const legTimes = {};
    for (let i = 0; i < steps && !world.finished; i++) {
      world.step(physicsDt, ap(world));
      if (world.car.lastHitSolid) {
        if (world.car.lastHitSolid.role === 'kerb') collisionsWithKerbs++;
        else collisionsWithScenery++;
      }
      for (const ev of world.events) {
        if (ev.type === 'portal' || ev.type === 'finish' || ev.type === 'start') legTimes[ev.type + (ev.from ? `:${ev.from}` : '')] = world.t;
      }
    }
    return {
      finished: world.finished,
      time: world.race.elapsed,
      splits: world.race.splits.map((s) => ({ id: s.id, label: s.label, t: s.t })),
      falls: world.stats.falls,
      portals: world.stats.portals,
      collisionsWithScenery,
      collisionsWithKerbs,
      simSeconds: world.t,
    };
  });
}
