/**
 * Interactive 3D Orbit + Pan + Zoom Camera for the Cloth & Avatar Viewport
 * Supports 3D ray casting for interactive fabric grabbing, draping, and wind placement.
 */

export class OrbitCamera {
  constructor() {
    this.theta = 0.38; // Horizontal azimuth angle (radians)
    this.phi = 1.38; // Vertical polar angle from +Y (radians)
    this.distance = 2.55; // Framed for standing 1.72m human avatar + dress
    this.target = [0.0, 0.92, 0.0]; // Center around mannequin waist/torso
    this.fovY = (42 * Math.PI) / 180;
    this.aspect = 16 / 9;
    this.near = 0.05;
    this.far = 35.0;

    // Smooth damping state
    this.targetTheta = this.theta;
    this.targetPhi = this.phi;
    this.targetDistance = this.distance;
    this.targetCenter = [...this.target];

    // Computed vectors
    this.position = [0, 0, 0];
    this.forward = [0, 0, -1];
    this.right = [1, 0, 0];
    this.up = [0, 1, 0];

    this.update(1.0);
  }

  reset() {
    this.targetTheta = 0.38;
    this.targetPhi = 1.38;
    this.targetDistance = 2.55;
    this.targetCenter = [0.0, 0.92, 0.0];
  }

  update(dt = 0.016) {
    const lerpFactor = Math.min(1.0, dt * 16.0);
    this.theta += (this.targetTheta - this.theta) * lerpFactor;
    this.phi += (this.targetPhi - this.phi) * lerpFactor;
    this.distance += (this.targetDistance - this.distance) * lerpFactor;
    for (let i = 0; i < 3; i++) {
      this.target[i] += (this.targetCenter[i] - this.target[i]) * lerpFactor;
    }

    const sinPhi = Math.sin(this.phi);
    const cosPhi = Math.cos(this.phi);
    const sinTheta = Math.sin(this.theta);
    const cosTheta = Math.cos(this.theta);

    this.position[0] = this.target[0] + this.distance * sinPhi * sinTheta;
    this.position[1] = this.target[1] + this.distance * cosPhi;
    this.position[2] = this.target[2] + this.distance * sinPhi * cosTheta;

    const fx = this.target[0] - this.position[0];
    const fy = this.target[1] - this.position[1];
    const fz = this.target[2] - this.position[2];
    const fLen = Math.hypot(fx, fy, fz) || 1.0;
    this.forward[0] = fx / fLen;
    this.forward[1] = fy / fLen;
    this.forward[2] = fz / fLen;

    const worldUp = [0, 1, 0];
    let rx = this.forward[1] * worldUp[2] - this.forward[2] * worldUp[1];
    let ry = this.forward[2] * worldUp[0] - this.forward[0] * worldUp[2];
    let rz = this.forward[0] * worldUp[1] - this.forward[1] * worldUp[0];
    const rLen = Math.hypot(rx, ry, rz) || 1.0;
    this.right[0] = rx / rLen;
    this.right[1] = ry / rLen;
    this.right[2] = rz / rLen;

    this.up[0] = this.right[1] * this.forward[2] - this.right[2] * this.forward[1];
    this.up[1] = this.right[2] * this.forward[0] - this.right[0] * this.forward[2];
    this.up[2] = this.right[0] * this.forward[1] - this.right[1] * this.forward[0];
  }

  orbit(deltaX, deltaY) {
    this.targetTheta -= deltaX * 0.0075;
    this.targetPhi = Math.max(0.12, Math.min(Math.PI - 0.08, this.targetPhi - deltaY * 0.0075));
  }

  pan(deltaX, deltaY) {
    const scale = this.targetDistance * 0.0014;
    for (let i = 0; i < 3; i++) {
      this.targetCenter[i] -= this.right[i] * deltaX * scale;
      this.targetCenter[i] += this.up[i] * deltaY * scale;
    }
    this.targetCenter[1] = Math.max(0.15, Math.min(1.85, this.targetCenter[1]));
  }

  zoom(delta) {
    this.targetDistance = Math.max(0.75, Math.min(7.5, this.targetDistance * (1.0 + delta * 0.001)));
  }

  getViewProjectionMatrix() {
    const f = 1.0 / Math.tan(this.fovY * 0.5);
    const nf = 1.0 / (this.near - this.far);
    const aspect = this.aspect || 1.0;

    // View matrix columns from right, up, -forward
    const rx = this.right[0], ry = this.right[1], rz = this.right[2];
    const ux = this.up[0], uy = this.up[1], uz = this.up[2];
    const fx = -this.forward[0], fy = -this.forward[1], fz = -this.forward[2];
    const px = this.position[0], py = this.position[1], pz = this.position[2];

    const tx = -(rx * px + ry * py + rz * pz);
    const ty = -(ux * px + uy * py + uz * pz);
    const tz = -(fx * px + fy * py + fz * pz);

    const view = [
      rx, ux, fx, 0,
      ry, uy, fy, 0,
      rz, uz, fz, 0,
      tx, ty, tz, 1,
    ];

    // Standard WebGPU/OpenGL clip matrix (0..1 depth in WebGPU, mapped cleanly)
    const p00 = f / aspect;
    const p11 = f;
    const p22 = (this.far + this.near) * nf;
    const p23 = -1.0;
    const p32 = 2.0 * this.far * this.near * nf;

    const proj = [
      p00, 0, 0, 0,
      0, p11, 0, 0,
      0, 0, p22, p23,
      0, 0, p32, 0,
    ];

    const out = new Float32Array(16);
    for (let col = 0; col < 4; col++) {
      for (let row = 0; row < 4; row++) {
        out[col * 4 + row] =
          proj[0 * 4 + row] * view[col * 4 + 0] +
          proj[1 * 4 + row] * view[col * 4 + 1] +
          proj[2 * 4 + row] * view[col * 4 + 2] +
          proj[3 * 4 + row] * view[col * 4 + 3];
      }
    }
    return out;
  }

  getRay(ndcX, ndcY) {
    const tanHalfFov = Math.tan(this.fovY * 0.5);
    const px = ndcX * this.aspect * tanHalfFov;
    const py = ndcY * tanHalfFov;

    const dx = this.forward[0] + px * this.right[0] + py * this.up[0];
    const dy = this.forward[1] + px * this.right[1] + py * this.up[1];
    const dz = this.forward[2] + px * this.right[2] + py * this.up[2];
    const len = Math.hypot(dx, dy, dz) || 1.0;

    return {
      origin: [...this.position],
      dir: [dx / len, dy / len, dz / len],
    };
  }

  /**
   * Intersects screen click ray with the active world-space garment bounding box
   * Returns world-space hit point [x, y, z] or null if missed.
   */
  raycastVolumeUVW(ndcX, ndcY, boxMin = [-0.65, 0.0, -0.65], boxMax = [0.65, 1.75, 0.65]) {
    const { origin, dir } = this.getRay(ndcX, ndcY);

    let tMin = -Infinity;
    let tMax = Infinity;

    for (let i = 0; i < 3; i++) {
      const invD = 1.0 / (Math.abs(dir[i]) < 1e-6 ? 1e-6 : dir[i]);
      let t0 = (boxMin[i] - origin[i]) * invD;
      let t1 = (boxMax[i] - origin[i]) * invD;
      if (t0 > t1) {
        const tmp = t0;
        t0 = t1;
        t1 = tmp;
      }
      tMin = Math.max(tMin, t0);
      tMax = Math.min(tMax, t1);
    }

    if (tMax < Math.max(tMin, 0.0)) {
      return null;
    }

    const tEnter = Math.max(tMin, 0.0);
    const tHit = tEnter + (tMax - tEnter) * 0.35;
    const wx = origin[0] + dir[0] * tHit;
    const wy = origin[1] + dir[1] * tHit;
    const wz = origin[2] + dir[2] * tHit;

    return [wx, wy, wz];
  }
}
