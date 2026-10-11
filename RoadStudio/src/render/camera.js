// Orbit camera around a target point. Angles in radians, distance in metres.
import { perspective, lookAt, mul, invert } from '../engine/math.js';

export class OrbitCamera {
  constructor() {
    this.target = [0, 0, 0];
    this.yaw = 0.6;
    this.pitch = 0.9;
    this.dist = 380;
    this.fovy = (38 * Math.PI) / 180;
  }

  eye() {
    const cp = Math.cos(this.pitch);
    return [
      this.target[0] + this.dist * cp * Math.sin(this.yaw),
      this.target[1] + this.dist * Math.sin(this.pitch),
      this.target[2] + this.dist * cp * Math.cos(this.yaw),
    ];
  }

  matrices(aspect) {
    const eye = this.eye();
    const view = lookAt(eye, this.target, [0, 1, 0]);
    const proj = perspective(this.fovy, aspect, 0.5, 6000);
    const viewProj = mul(proj, view);
    return { eye, view, proj, viewProj, invViewProj: invert(viewProj) };
  }

  orbit(dx, dy) {
    this.yaw -= dx * 0.005;
    this.pitch = Math.min(1.5, Math.max(0.12, this.pitch + dy * 0.005));
  }

  // Pan in the ground plane, scaled to the current distance.
  pan(dx, dy) {
    const k = this.dist * 0.0016;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
    this.target[0] += (-dx * rx + dy * fx) * k;
    this.target[2] += (-dx * rz + dy * fz) * k;
  }

  zoom(factor) {
    this.dist = Math.min(2400, Math.max(12, this.dist * factor));
  }
}
