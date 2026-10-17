// Arcade car. The car does not simulate suspension. It rides the road surface when
// it is on road and falls with low gravity when it is not. That makes gap-jumps and
// the drift of the floating road read clearly.
//
// Coordinates here are WORLD coordinates (x, y up, z). `env` maps them to road space.

import { T } from './tuning.js';
import { clamp, wrapAngle } from './rng.js';

export function makeCar(x, y, z, heading) {
  return {
    x, y, z,
    h: heading,            // yaw. Forward = (sin h, 0, cos h)
    vx: 0, vy: 0, vz: 0,
    vf: 0,                 // forward speed (m/s, negative = reversing)
    grounded: true,
    airTime: 0,
    wheel: 0,              // wheel spin angle, cosmetic
    hitCooldown: 0,
  };
}

// inp: { throttle 0..1, brake 0..1, steer -1..1, handbrake bool }
// env: {
//   probe(x, y, z) -> { onRoad, surfaceY, slope }      // world space
//   collide(car)  -> void                              // pushes car out of solids, may reduce speed
// }
export function stepCar(car, inp, env, dt) {
  const fixed = T.fixedDt;
  let remaining = dt;
  while (remaining > 1e-9) {
    const h = Math.min(fixed, remaining);
    remaining -= h;
    substep(car, inp, env, h);
  }
}

function substep(car, inp, env, dt) {
  const throttle = clamp(inp.throttle || 0, 0, 1);
  const brake = clamp(inp.brake || 0, 0, 1);
  const steer = clamp(inp.steer || 0, -1, 1);
  const handbrake = !!inp.handbrake && car.grounded;

  const fx = Math.sin(car.h);
  const fz = Math.cos(car.h);
  const rx = fz;   // right vector
  const rz = -fx;

  let vf = car.vx * fx + car.vz * fz;
  let vl = car.vx * rx + car.vz * rz;

  // --- steering: yaw rate falls off with speed, and needs some speed to bite
  const yawMax = T.yaw0 / (1 + Math.abs(vf) / T.yawFalloff);
  const yawScale = Math.min(1, Math.abs(vf) / 2.5);
  const reverseSign = vf < -0.5 ? -1 : 1;
  car.h += steer * yawMax * yawScale * reverseSign * (handbrake ? 1.25 : 1) * dt;
  car.h = wrapAngle(car.h);

  // --- longitudinal
  const authority = car.grounded ? 1 : T.airEngine;
  let a = 0;
  if (throttle > 0) a += throttle * T.engineAccel * authority * Math.max(0, 1 - vf / T.engineTopSpeed);
  if (brake > 0) {
    if (vf > 0.5) a -= brake * T.brakeDecel * authority;
    else if (vf > -T.reverseTopSpeed) a -= brake * T.engineAccel * 0.8 * authority;
  }
  a -= T.rollResist * vf + T.dragQuad * vf * Math.abs(vf);
  vf += a * dt;

  // --- lateral grip (kills sideways slide quickly on road, lets the car float off-road)
  const grip = (car.grounded ? T.gripRoad : T.gripAir) * (handbrake ? 0.3 : 1);
  vl *= Math.exp(-grip * dt);

  car.vx = fx * vf + rx * vl;
  car.vz = fz * vf + rz * vl;
  car.vf = vf;
  car.wheel += (vf * dt) / 0.36;

  // --- integrate position
  car.x += car.vx * dt;
  car.z += car.vz * dt;

  if (!car.grounded) {
    car.vy -= T.gravity * dt;
    car.vy *= Math.exp(-T.airDrag * dt);
    car.y += car.vy * dt;
    car.airTime += dt;
  }

  // --- collisions with solids (buildings, props)
  env.collide(car);

  // --- road contact
  const g = env.probe(car.x, car.y, car.z);
  if (car.grounded) {
    if (g.onRoad) {
      car.y = g.surfaceY;
      car.vy = vf * g.slope;        // keep the launch arc if the road drops away
      car.airTime = 0;
    } else {
      car.grounded = false;         // drove off the road (edge, gap, or a fall)
      car.airTime = 0;
    }
  } else if (g.onRoad && car.vy <= 0 && car.y <= g.surfaceY + 0.3 && car.y >= g.surfaceY - 1.5) {
    car.grounded = true;            // landed
    car.y = g.surfaceY;
    car.vy = 0;
    car.airTime = 0;
  }
}
