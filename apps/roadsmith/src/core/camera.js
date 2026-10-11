// Orbit / fly camera with smooth damping. DOM-free: main.js feeds it input events.

import { mat4Perspective, mat4LookAt, mat4Mul, mat4Invert, mat4Ortho, rayFromNDC, clamp } from './math.js';

export class Camera {
  constructor(opts = {}) {
    this.target = opts.target ? { ...opts.target } : { x: 0, y: 0, z: 0 };
    this.distance = opts.distance ?? 180;
    this.yaw = opts.yaw ?? 0.9;
    this.pitch = opts.pitch ?? 0.62;
    this.fov = opts.fov ?? 0.78;
    this.near = 0.25;
    this.far = 4200;
    this.aspect = 16 / 9;

    this._t = { ...this.target };
    this._d = this.distance;
    this._yaw = this.yaw;
    this._pitch = this.pitch;

    this.view = new Float32Array(16);
    this.proj = new Float32Array(16);
    this.viewProj = new Float32Array(16);
    this.invViewProj = new Float32Array(16);
    this.position = { x: 0, y: 0, z: 0 };
    this.minPitch = 0.035;
    this.maxPitch = 1.5533;
    this.minDistance = 4;
    this.maxDistance = 1600;
  }

  orbit(dx, dy) {
    this.yaw -= dx * 0.0062;
    this.pitch = clamp(this.pitch + dy * 0.0062, this.minPitch, this.maxPitch);
  }

  pan(dx, dy) {
    const s = this.distance * 0.0016;
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    // screen-right and screen-forward projected on the ground plane
    this.target.x += (-dx * cy - dy * sy) * s;
    this.target.z += (-dx * -sy - dy * cy) * s;
  }

  dolly(amount) {
    this.distance = clamp(this.distance * Math.pow(1.0016, amount), this.minDistance, this.maxDistance);
  }

  /** Move the orbit pivot (used by "frame selection"). */
  focus(p, distance) {
    this.target.x = p.x; this.target.y = p.y; this.target.z = p.z;
    if (distance) this.distance = clamp(distance, this.minDistance, this.maxDistance);
  }

  snapTo() {
    this._t = { ...this.target };
    this._d = this.distance;
    this._yaw = this.yaw;
    this._pitch = this.pitch;
  }

  update(dt, aspect) {
    this.aspect = aspect || this.aspect;
    const k = 1 - Math.pow(0.0015, Math.min(dt, 0.1));
    this._t.x += (this.target.x - this._t.x) * k;
    this._t.y += (this.target.y - this._t.y) * k;
    this._t.z += (this.target.z - this._t.z) * k;
    this._d += (this.distance - this._d) * k;
    this._yaw += (this.yaw - this._yaw) * k;
    this._pitch += (this.pitch - this._pitch) * k;

    const cp = Math.cos(this._pitch), sp = Math.sin(this._pitch);
    this.position = {
      x: this._t.x + Math.cos(this._yaw) * cp * this._d,
      y: this._t.y + sp * this._d,
      z: this._t.z + Math.sin(this._yaw) * cp * this._d,
    };
    // scale the near plane with the orbit distance so the 24-bit depth buffer keeps precision
    this.near = clamp(this._d * 0.004, 0.2, 2.5);
    this.far = Math.max(1800, this._d * 8);
    mat4LookAt(this.view, this.position, this._t, { x: 0, y: 1, z: 0 });
    mat4Perspective(this.proj, this.fov, this.aspect, this.near, this.far);
    mat4Mul(this.viewProj, this.proj, this.view);
    mat4Invert(this.invViewProj, this.viewProj);
  }

  /** NDC (-1..1, y up) -> world ray. */
  ray(ndcX, ndcY) {
    return rayFromNDC(this.invViewProj, ndcX, ndcY, this.position);
  }
}

/** Sun shadow volume fitted around the camera pivot. */
export function sunMatrix(out, sunDir, centre, radius) {
  // sunDir points TOWARDS the sun, so the shadow camera sits on the sun's side looking back
  const eye = {
    x: centre.x + sunDir.x * radius * 2.2,
    y: centre.y + Math.max(sunDir.y, 0.12) * radius * 2.2,
    z: centre.z + sunDir.z * radius * 2.2,
  };
  const view = new Float32Array(16);
  const proj = new Float32Array(16);
  const up = Math.abs(sunDir.y) > 0.96 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  mat4LookAt(view, eye, centre, up);
  mat4Ortho(proj, -radius, radius, -radius, radius, 0.5, radius * 5.0);
  mat4Mul(out, proj, view);
  return out;
}
