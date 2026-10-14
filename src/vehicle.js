// Drivable ControlVehicle: DriverInputIntegrator keyboard behaviour replicated from
// Frontier DriverInputIntegrator.h (ramp rates / self-centring), chassis response built
// on VehicleGeometry's authored numbers (wheelbase, track, CoM, tyre radius, 0.52 rad lock)
// over DriveCourse's CourseHeight. This is a drivable rigid-chassis approximation for the
// web — Frontier's full Pacejka/drivetrain/solver stack stays native; what is identical
// here is the vehicle geometry, the input mapping and rates, and the ground it drives on.
import { courseHeight } from './course.js';
import { VEHICLE } from './scene.js';
import { V3 } from './math.js';

export class DriverInput {
  constructor() { this.throttle = 0; this.brake = 0; this.steer = 0; this.keys = {}; }
  // InputConfiguration keyboard rates from DriverInputIntegrator.h
  advance(dt, keys) {
    const ramp = (cur, up, down, rate, fall) => {
      if (up && !down) return Math.min(1, cur + rate * dt);
      if (down && !up) return Math.max(-1, cur - rate * dt);
      const s = Math.sign(cur); const v = Math.abs(cur) - fall * dt;
      return v <= 0 ? 0 : s * v;
    };
    // throttle/brake are [0..1] pedals, steer is [-1..1] (+1 = left, +Y)
    this.throttle = keys.KeyW ? Math.min(1, this.throttle + 3.0 * dt) : Math.max(0, this.throttle - 6.0 * dt);
    this.brake = keys.KeyS ? Math.min(1, this.brake + 4.0 * dt) : Math.max(0, this.brake - 8.0 * dt);
    const steerTarget = (keys.KeyA ? 1 : 0) + (keys.KeyD ? -1 : 0);
    if (steerTarget !== 0) {
      const rate = 3.5 * dt;
      this.steer += Math.sign(steerTarget - this.steer) * Math.min(Math.abs(steerTarget - this.steer), rate);
    } else {
      const v = Math.abs(this.steer) - 5.0 * dt; this.steer = v <= 0 ? 0 : Math.sign(this.steer) * v;
    }
    return { throttle: this.throttle, brake: this.brake, steer: this.steer, handbrake: !!keys.Space };
  }
}

const WAYPOINTS = [
  [6, 0], [14, 0.5], [22, 2.5], [26, 7], [20, 9.2], [8, 8.6], [-4, 9.0], [-12, 6.5],
  [-16.5, 0], [-12, -6.5], [-4, -9.0], [8, -8.6], [20, -7], [25, -2], [16, -0.5], [6, 0],
];

export class Vehicle {
  constructor() { this.reset(); this.input = new DriverInput(); this.auto = true; this.wpIndex = 1; }
  reset() {
    this.pos = [-8, 0, VEHICLE.CoMHeight]; this.yaw = 0; this.pitch = 0; this.roll = 0;
    this.speed = 0; this.steerAngle = 0; this.wheelSpin = 0; this.wheelTravel = [0, 0, 0, 0];
    this.gear = 1; this.rpm = 900;
  }
  step(rawDt, keys) {
    const sub = Math.max(1, Math.ceil(rawDt / (1 / 240)));
    const dt = Math.min(rawDt, 0.05) / sub;
    let cmd = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    if (this.autoSteer === undefined) { this.autoSteer = 0; this.autoThrottle = 0; this.autoBrake = 0; }
    for (let s = 0; s < sub; s++) {
      cmd = this.input.advance(dt, keys);
      if (this.auto) {
        // Pure pursuit on the waypoint loop, expressed through the same pedal/steer
        // channels as the keyboard. The pursuit command is persistent state (smoothed
        // at 2.5/s like a driver's hands), not a per-substep impulse.
        let wp = WAYPOINTS[this.wpIndex];
        let dx = wp[0] - this.pos[0], dy = wp[1] - this.pos[1];
        let localX = dx * Math.cos(this.yaw) + dy * Math.sin(this.yaw);
        let localY = -dx * Math.sin(this.yaw) + dy * Math.cos(this.yaw);
        // Advance when close OR when the point falls behind the front axle — a waypoint
        // inside the minimum turning circle (L/tan(lock) = 5.9 m) can never be reached.
        if (Math.hypot(dx, dy) < 6.5 || localX < 0) {
          this.wpIndex = (this.wpIndex + 1) % WAYPOINTS.length;
          wp = WAYPOINTS[this.wpIndex];
          dx = wp[0] - this.pos[0]; dy = wp[1] - this.pos[1];
          localX = dx * Math.cos(this.yaw) + dy * Math.sin(this.yaw);
          localY = -dx * Math.sin(this.yaw) + dy * Math.cos(this.yaw);
        }
        const alpha = Math.atan2(localY, Math.max(localX, 0.5));
        const ld = V3.clamp(Math.hypot(dx, dy), 4, 12);
        const steerWant = V3.clamp(Math.atan(2 * VEHICLE.Wheelbase * Math.sin(alpha) / ld) / VEHICLE.MaxSteerRad, -1, 1);
        this.autoSteer += V3.clamp(steerWant - this.autoSteer, -dt * 2.5, dt * 2.5);
        const targetSpeed = 9.0 - Math.min(5.0, Math.abs(steerWant) * 4.0);
        if (this.speed < targetSpeed) { this.autoThrottle = Math.min(0.85, this.autoThrottle + dt * 1.5); this.autoBrake = Math.max(0, this.autoBrake - dt * 3); }
        else { this.autoThrottle = Math.max(0, this.autoThrottle - dt * 2); this.autoBrake = Math.min(0.55, this.autoBrake + dt * 1.5); }
        cmd.steer = this.autoSteer; cmd.throttle = this.autoThrottle; cmd.brake = this.autoBrake;
      }
      this.integrate(dt, cmd);
    }
    return cmd;
  }
  integrate(dt, cmd) {
    const G = VEHICLE;
    // Steering: first-order approach to lock (SteerRatePerSecond 6 in VehicleSolver config).
    const steerTarget = cmd.steer * G.MaxSteerRad;
    this.steerAngle += (steerTarget - this.steerAngle) * Math.min(1, 6.0 * dt);
    // Longitudinal: engine demand through an AMT-like gear ladder, drag, rolling resistance.
    const gearTop = [0, 9, 15, 23, 33, 45, 60];
    while (this.gear < 6 && this.speed > gearTop[this.gear]) this.gear++;
    while (this.gear > 1 && this.speed < gearTop[this.gear - 1] * 0.55) this.gear--;
    const gearRatio = [0, 3.2, 2.3, 1.7, 1.3, 1.0, 0.8][this.gear];
    this.rpm = 900 + Math.max(0, this.speed) * gearRatio * 260;
    const driveForce = cmd.throttle * 5200 * Math.min(1, gearRatio) * (this.speed < 0.5 && cmd.brake > 0 ? 0 : 1);
    const reverse = this.speed < 0.15 && cmd.throttle === 0 && cmd.brake > 0;
    const brakeForce = cmd.brake * (reverse ? -2600 : 9000 * Math.sign(this.speed || 0));
    const handForce = cmd.handbrake ? 9000 * Math.sign(this.speed || 0) : 0;
    const drag = 0.42 * this.speed * Math.abs(this.speed);
    const rolling = G.Mass * 9.81 * 0.015 * Math.tanh(this.speed * 2);
    let accel = (driveForce - brakeForce - handForce - drag - rolling) / G.Mass;
    if (!reverse && cmd.brake > 0 && this.speed <= 0.15 && cmd.throttle === 0) { accel = Math.min(accel, 0); if (this.speed < 0) this.speed = 0; }
    this.speed += accel * dt;
    if (cmd.handbrake) this.speed -= this.speed * 1.6 * dt;
    this.speed = V3.clamp(this.speed, -6, 58);
    // Bicycle yaw from the authored wheelbase; handbrake loosens the rear (more yaw per steer).
    const latGrip = cmd.handbrake ? 1.45 : 1.0;
    const yawRate = (this.speed / G.Wheelbase) * Math.tan(this.steerAngle) * latGrip;
    this.yaw += yawRate * dt;
    this.pos[0] += Math.cos(this.yaw) * this.speed * dt;
    this.pos[1] += Math.sin(this.yaw) * this.speed * dt;
    this.pos[0] = V3.clamp(this.pos[0], -55, 55); this.pos[1] = V3.clamp(this.pos[1], -55, 55);
    // Ground + suspension pose from DriveCourse heights at the four contact patches.
    const fwd = [Math.cos(this.yaw), Math.sin(this.yaw)], left = [-Math.sin(this.yaw), Math.cos(this.yaw)];
    const heights = G.Axles.map(([ax, ay], i) => {
      const wx = this.pos[0] + fwd[0] * ax + left[0] * ay, wy = this.pos[1] + fwd[1] * ax + left[1] * ay;
      const h = courseHeight(wx, wy);
      const target = V3.clamp(h - 0, -0.06, 0.14); // strut travel visual (m)
      this.wheelTravel[i] += (target - this.wheelTravel[i]) * Math.min(1, dt * 10);
      return h;
    });
    const groundZ = (heights[0] + heights[1] + heights[2] + heights[3]) / 4;
    const targetZ = groundZ + G.CoMHeight;
    this.pos[2] += (targetZ - this.pos[2]) * Math.min(1, dt * 8);
    const pitchT = Math.atan2(((heights[2] + heights[3]) / 2) - ((heights[0] + heights[1]) / 2), G.Wheelbase)
                 - V3.clamp(accel * 0.004, -0.03, 0.03);
    const rollT = Math.atan2(((heights[0] + heights[2]) / 2) - ((heights[1] + heights[3]) / 2), G.Track)
                + V3.clamp(yawRate * this.speed * 0.006, -0.05, 0.05);
    this.pitch += (pitchT - this.pitch) * Math.min(1, dt * 6);
    this.roll += (rollT - this.roll) * Math.min(1, dt * 6);
    this.wheelSpin += (this.speed / G.TyreRadius) * dt;
    this.cmd = cmd;
  }
  forward() { return [Math.cos(this.yaw), Math.sin(this.yaw), 0]; }
}
