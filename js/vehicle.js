//============================================================================================================================================
//                                                              VEHICLE.JS
//============================================================================================================================================
// 📦 Drive model for the authored ControlVehicle. Same driver contract as Project-Drive:
//      W/S throttle·brake · A/D steer · Space handbrake · R respawn · plus an autopilot tour so the global
//      distance field visibly rebuilds even before the user touches the keys.
//
//    Chassis: kinematic bicycle on the authored geometry (wheelbase 3.396 m, track 2.095 m, hub sockets off
//    Socket_AxleMount_*, tyre radius 0.50855 m). Ride: ground follows DriveCourse.courseHeight through a
//    sprung second-order system per corner, ballistic when the crest drops out from under the car.

import { Course, courseHeight, courseNormal, coneOrigin } from "./course.js";
import { clamp, lerp, damp } from "./math.js";

export const VehicleSpec = {
  Wheelbase: 3.396,
  Track: 2.095,
  TyreRadius: 0.50855,
  HubLocalZ: 0.0914,          // axle sockets sit at model Z +0.0914
  Hubs: [                     // Socket_AxleMount_* — front +X, left +Y
    [1.7274, 1.0475, 0.0914], // FL
    [1.7274, -1.0475, 0.0914],// FR
    [-1.6686, 1.0475, 0.0914],// RL
    [-1.6686, -1.0475, 0.0914],// RR
  ],
  SteerMax: 0.62,             // [rad] at standstill
  SteerRate: 3.0,             // [rad/s] hand speed
  Accel: 7.5,                 // [m/s²] wide-open
  Brake: 11.0,
  Handbrake: 14.0,
  Drag: 0.0038,               // quadratic aero
  RollingDrag: 0.42,
  MaxSpeed: 34.0,
  Gravity: 9.81,
};

export function makeVehicleState() {
  return {
    x: 0, y: -2.5, z: 0, yaw: 0,               // horizontal state
    vLong: 0,                                   // signed forward speed [m/s]
    steer: 0,                                   // smoothed acknowledged steer [rad]
    vz: 0, pitch: 0, roll: 0, vPitch: 0, vRoll: 0, airborne: false,
    wheelSpin: 0,                               // rotation of every rigid wheel about its axle [rad]
    shaftSpeed: 0, throttlePrev: 0,
    compression: [0, 0, 0, 0],                  // visual strut compression per corner
  };
}

export function spawnPoint() { return { x: 0, y: -2.5, yaw: 0 }; }

export function respawn(s) {
  const sp = spawnPoint();
  Object.assign(s, makeVehicleState(), sp);
}

// Ground target for the body: the four hubs' support heights + authored ride height.
function cornerSupports(s) {
  const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
  const out = [];
  for (const h of VehicleSpec.Hubs) {
    const hx = s.x + cy * h[0] - sy * h[1];
    const hy = s.y + sy * h[0] + cy * h[1];
    out.push({ x: hx, y: hy, gz: courseHeight(hx, hy) });
  }
  return out;
}

export function stepVehicle(s, input, dt) {
  const V = VehicleSpec;
  dt = Math.min(dt, 1 / 30);

  // ---- steering: rate-limited toward requested, speed-sensitive cap (understeer envelope ~ Kus·v²) ----
  const steerCap = V.SteerMax / (1 + 0.020 * s.vLong * s.vLong);
  const target = clamp(input.steer, -1, 1) * steerCap;
  const rate = V.SteerRate * dt;
  s.steer += clamp(target - s.steer, -rate, rate);

  // ---- longitudinal ----
  const aDrag = V.Drag * s.vLong * Math.abs(s.vLong) + Math.sign(s.vLong) * V.RollingDrag;
  let a = 0;
  if (input.throttle > 0 && s.vLong < V.MaxSpeed) a += input.throttle * V.Accel;
  if (input.throttle < 0) a += input.throttle * (s.vLong > 0.5 ? V.Brake : V.Accel * 0.45); // brake / reverse
  if (input.handbrake) a -= Math.sign(s.vLong) * V.Handbrake;
  if (Math.abs(s.vLong) < 0.15 && input.throttle === 0) s.vLong = 0;
  else s.vLong = clamp(s.vLong + (a - aDrag) * dt, -V.MaxSpeed * 0.35, V.MaxSpeed);

  // ---- kinematic bicycle yaw ----
  s.yaw += (s.vLong / V.Wheelbase) * Math.tan(s.steer) * dt;
  const cy = Math.cos(s.yaw), sy = Math.sin(s.yaw);
  s.x += cy * s.vLong * dt;
  s.y += sy * s.vLong * dt;
  s.wheelSpin += (s.vLong / V.TyreRadius) * dt;
  s.shaftSpeed = Math.abs(s.vLong / V.TyreRadius);

  // ---- course cone contact (visual: push out + scrub speed) ----
  for (let k = 0; k < Course.ConeCount; k++) {
    const [cx, cyk] = coneOrigin(k);
    const dx = s.x - cx, dy = s.y - cyk;
    const d = Math.hypot(dx, dy), minD = Course.ConeRadius + 2.35;
    if (d < minD && courseHeight(s.x, s.y) < 0.4) {
      const push = (minD - d);
      if (d > 1e-4) { s.x += (dx / d) * push; s.y += (dy / d) * push; }
      s.vLong *= 0.985;
    }
  }

  // ---- vertical: sprung chassis over the four hub supports ----
  const sup = cornerSupports(s);
  const avgG = 0.25 * (sup[0].gz + sup[1].gz + sup[2].gz + sup[3].gz);
  const front = 0.5 * (sup[0].gz + sup[1].gz), rear = 0.5 * (sup[2].gz + sup[3].gz);
  const left = 0.5 * (sup[0].gz + sup[2].gz), right = 0.5 * (sup[1].gz + sup[3].gz);
  const targetZ = avgG;
  const targetPitch = Math.atan2(front - rear, V.Wheelbase);
  const targetRoll = Math.atan2(right - left, V.Track);

  // strut travel estimate: how far the sprung body sits over each support (visual compression + air detect)
  const bodyZ = s.z;
  let minClear = Infinity;
  for (let i = 0; i < 4; i++) minClear = Math.min(minClear, bodyZ - sup[i].gz);

  if (s.airborne || minClear > 0.055) {
    s.airborne = true;
    s.vz -= V.Gravity * dt;
    s.z += s.vz * dt;
    s.pitch = damp(s.pitch, 0.0, 1.2, dt);
    s.roll = damp(s.roll, 0.0, 1.2, dt);
    if (s.z <= targetZ && s.vz < 0) {           // touch-down: dump the fall into the springs
      s.airborne = false;
      s.z = targetZ;
      s.vz = 0;
      s.vPitch += (targetPitch - s.pitch) * 6;
      s.vRoll += (targetRoll - s.roll) * 6;
    }
  } else {
    // critically-damped-ish spring toward support
    const w = 7.0, zeta = 0.85;
    const acc = w * w * (targetZ - s.z) - 2 * zeta * w * s.vz;
    s.vz += acc * dt;
    s.z += s.vz * dt;
    const wR = 8.0;
    s.vPitch += (wR * wR * (targetPitch - s.pitch) - 2 * 0.8 * wR * s.vPitch) * dt;
    s.vRoll += (wR * wR * (targetRoll - s.roll) - 2 * 0.8 * wR * s.vRoll) * dt;
    s.pitch += s.vPitch * dt;
    s.roll += s.vRoll * dt;
  }

  for (let i = 0; i < 4; i++)
    s.compression[i] = clamp(0.05 - (s.z - sup[i].gz) + (s.airborne ? 0.10 : 0), -0.09, 0.16);

  s.throttlePrev = input.throttle;
}

// Body model origin world position: hubs hang HubLocalZ below it and contact happens TyreRadius below the hub.
export function bodyOrigin(s) {
  return [s.x, s.y, s.z + VehicleSpec.TyreRadius - VehicleSpec.HubLocalZ + 0.02];
}

//--------------------------------------------------------------------------------------------------------------------------------------------
// Autopilot tour — a loop of waypoints over every course feature so the GI/GDF continuously sees fresh
// geometry: launch the ramp, thread the slalom, swing past the kerb, roll the speed bumps, repeat.
//--------------------------------------------------------------------------------------------------------------------------------------------
const TOUR = [
  { x: 7.5, y: -1.2, v: 9 }, { x: 16.5, y: 0.6, v: 10 }, { x: 24, y: -1.5, v: 10 },
  { x: 25.5, y: 0.1, v: 6 }, { x: 30.6, y: -2.0, v: 6 }, { x: 35.4, y: 2.1, v: 6 },
  { x: 40.6, y: -2.0, v: 6 }, { x: 45.4, y: 2.1, v: 6 }, { x: 50.6, y: -2.0, v: 6 },
  { x: 55, y: -1.0, v: 8 }, { x: 52, y: -8.5, v: 9 }, { x: 40, y: -11.5, v: 11 },
  { x: 24, y: -11.0, v: 12 }, { x: 6, y: -9.0, v: 11 }, { x: -4, y: -5.0, v: 9 },
  { x: -9.2, y: 0.8, v: 7 }, { x: -18.5, y: 0.4, v: 7 }, { x: -24, y: -1.8, v: 8 },
  { x: -16, y: -6.5, v: 10 }, { x: -4, y: -5.2, v: 9 },
];

export function makeAutopilot() { return { i: 0, pauseT: 0 }; }

export function autopilotInput(ap, s, dt, manualActive) {
  if (manualActive) { ap.pauseT = 3.5; return null; }
  if (ap.pauseT > 0) { ap.pauseT -= dt; return null; }
  const wp = TOUR[ap.i % TOUR.length];
  const dx = wp.x - s.x, dy = wp.y - s.y;
  const d = Math.hypot(dx, dy);
  if (d < 3.2) { ap.i++; return autopilotInput(ap, s, dt, false); }
  const desired = Math.atan2(dy, dx);
  let err = desired - s.yaw;
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  const steer = clamp(err * 2.2, -1, 1);
  const throttle = clamp((wp.v - s.vLong) * 0.45, -1, 1);
  return { steer, throttle, handbrake: false };
}
