// Arcade car: sticks to whatever road surface is under its four wheels, so it
// can follow the bobbing, tilted, fragmented roads of the town without
// needing a global "down". When nothing is underneath it, gravity takes over
// and it falls.
//
// All quantities are SI-ish: metres, seconds, m/s. Tune numbers in CAR.

import {
  add,
  sub,
  scale,
  madd,
  dot,
  cross,
  len,
  norm,
  clamp,
  forwardFromYaw,
  UP,
  mat4InverseRigid,
  mat4TransformPoint,
  mat4TransformDir,
} from './math.js';
import { probeGround } from './ground.js';

export const CAR = {
  maxSpeed: 34, // m/s  (~122 km/h)
  maxReverse: 9,
  engine: 15, // m/s² at standstill
  brake: 30,
  reverseAccel: 6,
  coast: 2.5,
  drag: 0.0012,
  handBrake: 9,
  grip: 9, // lateral grip (1/s) — higher = less slide
  gripHand: 1.8,
  gripAir: 0.5,
  steerRate: 2.3, // rad/s at low speed
  gravity: 24,
  ride: 0.42, // height of the body above the contact point (rendering)
  probeUp: 0.9, // wheel probes start this far above the contact point...
  probeDown: 1.3, // ...and reach this far below it (max "stick" distance)
  wheelX: 0.9,
  wheelZ: 1.35,
  bodyR: 1.15, // collision sphere radius
  bodyLift: 0.75, // sphere centre above the contact point
  bodyRestitution: 0.15,
  maxSnap: 1.0, // max vertical correction per physics step
};

// Orthonormal car basis for a yaw and a surface normal.
export function basisOf(yaw, N) {
  const F0 = forwardFromYaw(yaw);
  const Fp = norm(madd(F0, N, -dot(F0, N)));
  const R = norm(cross(N, Fp));
  const F = cross(R, N);
  return { F, R, N };
}

export class Car {
  constructor(pose) {
    this.reset(pose);
  }

  reset({ pos, yaw, speed = 0 }) {
    this.pos = pos.slice();
    this.yaw = yaw;
    this.N = UP.slice();
    this.vel = scale(forwardFromYaw(yaw), speed);
    this.grounded = false;
    this.airTime = 0;
    this.contacts = 0;
    this.lastHitSolid = null;
    this.frame = basisOf(yaw, this.N);
  }

  // Teleport (portal exit or respawn), keeping a speed but taking the new heading.
  teleport({ pos, yaw }, speed) {
    this.reset({ pos, yaw, speed });
  }

  get speed() {
    return dot(this.vel, this.frame.F);
  }

  // Advance the car by dt seconds.
  //   input: { throttle 0..1, brake 0..1, steer -1..1, handbrake bool }
  //   env:   { t, ground: [items], solids: [items] }
  step(dt, input, env) {
    const t = env.t;
    let { F, R, N } = basisOf(this.yaw, this.N);
    let V = this.vel;
    const grounded = this.grounded;

    // 1. Steering: yaw changes, and velocity keeps its old direction until
    //    grip pulls it round, which gives natural understeer and slides.
    if (grounded) {
      const fwdSpeed = dot(V, F);
      const dir = fwdSpeed < -0.3 ? -1 : 1;
      const authority = clamp(Math.abs(fwdSpeed) / 5, 0.2, 1);
      const rate = (CAR.steerRate / (1 + Math.abs(fwdSpeed) / 18)) * authority;
      this.yaw += input.steer * rate * dir * dt;
      ({ F, R, N } = basisOf(this.yaw, N));
    }

    // 2. Split velocity into forward, lateral and normal parts.
    let s = dot(V, F);
    let l = dot(V, R);
    const vn = dot(V, N);

    // 3. Longitudinal forces.
    let a = 0;
    if (input.throttle > 0) a += input.throttle * CAR.engine * Math.max(0, 1 - s / CAR.maxSpeed);
    if (input.brake > 0) {
      if (s > 0.5) a -= input.brake * CAR.brake;
      else a -= input.brake * CAR.reverseAccel * Math.max(0, 1 + s / CAR.maxReverse);
    }
    s += a * dt;
    if (input.throttle <= 0 && input.brake <= 0) s -= clamp(s, -CAR.coast * dt, CAR.coast * dt);
    s -= s * Math.abs(s) * CAR.drag * dt;
    if (input.handbrake) s -= clamp(s, -CAR.handBrake * dt, CAR.handBrake * dt);
    s = clamp(s, -CAR.maxReverse, CAR.maxSpeed);

    // 4. Lateral grip (sliding dies off over time).
    const grip = grounded ? (input.handbrake ? CAR.gripHand : CAR.grip) : CAR.gripAir;
    l *= Math.exp(-grip * dt);

    // 5. Rebuild velocity; gravity acts along the surface when grounded.
    V = add(scale(F, s), scale(R, l));
    V = add(V, scale(N, grounded ? 0 : vn));
    const G = [0, -CAR.gravity, 0];
    if (grounded) {
      V = madd(V, madd(G, N, -dot(G, N)), dt);
    } else {
      V = madd(V, G, dt);
    }

    // 6. Integrate position.
    let pos = madd(this.pos, V, dt);

    // 7. Wheel probes: find the road under each wheel and settle onto it.
    const hits = [];
    const wheels = [
      [-CAR.wheelX, CAR.wheelZ],
      [CAR.wheelX, CAR.wheelZ],
      [-CAR.wheelX, -CAR.wheelZ],
      [CAR.wheelX, -CAR.wheelZ],
    ];
    const down = scale(N, -1);
    for (const [wx, wz] of wheels) {
      const o = madd(madd(madd(pos, R, wx), F, wz), N, CAR.probeUp);
      const hit = probeGround(o, down, env.ground, t, CAR.probeUp + CAR.probeDown);
      if (hit && dot(hit.normal, UP) > 0.3) hits.push(hit);
    }

    if (hits.length) {
      let avgDh = 0;
      let nSum = [0, 0, 0];
      for (const h of hits) {
        avgDh += dot(sub(h.point, pos), N);
        nSum = add(nSum, h.normal);
      }
      avgDh /= hits.length;
      pos = madd(pos, N, clamp(avgDh, -CAR.maxSnap, CAR.maxSnap));
      const Nt = norm(nSum);
      N = norm(madd(N, sub(Nt, N), Math.min(1, 12 * dt)));
      const vDot = dot(V, N);
      if (vDot < 0) V = madd(V, N, -vDot);
      this.grounded = true;
      this.airTime = 0;
      this.contacts = hits.length;
    } else {
      this.grounded = false;
      this.airTime += dt;
      this.contacts = 0;
    }

    // 8. Solid obstacles: a sphere around the body pushes the car out of walls,
    //    kerbs and floating furniture.
    this.lastHitSolid = null;
    for (const item of env.solids) {
      const reach = item.reach + CAR.bodyR + 3.5;
      const c0 = madd(pos, N, CAR.bodyLift);
      const sc = item.staticCenter;
      const ddx = sc[0] - c0[0];
      const ddy = sc[1] - c0[1];
      const ddz = sc[2] - c0[2];
      if (ddx * ddx + ddy * ddy + ddz * ddz > reach * reach) continue;

      const M = item.anchor.world(t);
      const lc = mat4TransformPoint(mat4InverseRigid(M), c0);
      const h = item.half;
      const q = [clamp(lc[0], -h[0], h[0]), clamp(lc[1], -h[1], h[1]), clamp(lc[2], -h[2], h[2])];
      const dv = sub(lc, q);
      const d = len(dv);
      const r = CAR.bodyR;
      if (d >= r) continue;

      let nL;
      let pen;
      if (d > 1e-6) {
        nL = scale(dv, 1 / d);
        pen = r - d;
      } else {
        // Centre is inside the box: leave through the nearest face.
        let best = Infinity;
        let ax = 0;
        let sg = 1;
        for (let i = 0; i < 3; i++) {
          const ext = h[i] - Math.abs(lc[i]);
          if (ext < best) {
            best = ext;
            ax = i;
            sg = lc[i] >= 0 ? 1 : -1;
          }
        }
        nL = [0, 0, 0];
        nL[ax] = sg;
        pen = best + r;
      }
      const nW = mat4TransformDir(M, nL);
      pos = madd(pos, nW, pen);
      const vIn = dot(V, nW);
      if (vIn < 0) V = madd(V, nW, -vIn * (1 + CAR.bodyRestitution));
      this.lastHitSolid = item;
    }

    this.pos = pos;
    this.N = N;
    this.vel = V;
    this.frame = basisOf(this.yaw, N);
    return this;
  }
}
