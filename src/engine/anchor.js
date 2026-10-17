// Anchors are the scene graph used by the level.
//
// Every thing in the level (a road plate, a building shard, a floating chair,
// a gate pillar) is an Anchor: a home transform relative to an optional parent,
// plus an optional "wobble" that makes it move gently over time. Physics and
// rendering both read the same world transform, so what you see is what you
// collide with.
//
// World transforms are cached per time value, so asking for the same anchor
// twice in one frame is cheap.

import {
  mat4Identity,
  mat4Mul,
  mat4Translation,
  mat4RotX,
  mat4RotY,
  mat4RotZ,
} from './math.js';

// Wobble description (all fields optional):
//   w      angular frequency (rad/s) of the base oscillation
//   p      phase offset (radians); give neighbours a shared p*k for travelling waves
//   ax/ay/az  translation amplitudes in the anchor's own frame (metres)
//   rx/rz  tilt amplitudes (radians); ry  yaw amplitude (radians)
//   spinY  constant yaw rate (rad/s), used for slowly turning props
//   spinZ  constant roll rate (rad/s) about the local Z axis (a wheel turning)
export function wobbleMatrix(w, t) {
  const f = w.w || 0;
  const ph = w.p || 0;
  const tx = (w.ax || 0) * Math.sin(f * 1.3 * t + ph * 1.7 + 0.5);
  const ty = (w.ay || 0) * Math.sin(f * t + ph);
  const tz = (w.az || 0) * Math.sin(f * 0.8 * t + ph * 2.3 + 1.1);
  const rx = (w.rx || 0) * Math.sin(f * 0.9 * t + ph * 1.3);
  const rz = (w.rz || 0) * Math.sin(f * 1.1 * t + ph * 0.7 + 2.0) + (w.spinZ || 0) * t;
  const ry = (w.ry || 0) * Math.sin(f * 0.7 * t + ph * 0.4) + (w.spinY || 0) * t;
  const T = mat4Translation([tx, ty, tz]);
  const R = mat4Mul(mat4RotX(rx), mat4Mul(mat4RotZ(rz), mat4RotY(ry)));
  return mat4Mul(T, R);
}

export class Anchor {
  constructor({ parent = null, home = mat4Identity(), wob = null } = {}) {
    this.parent = parent;
    this.home = home;
    this.wob = wob;
    this._t = NaN;
    this._m = null;
  }

  // World transform at time t (seconds).
  world(t) {
    if (this._t === t && this._m) return this._m;
    const local = this.wob ? mat4Mul(this.home, wobbleMatrix(this.wob, t)) : this.home;
    this._m = this.parent ? mat4Mul(this.parent.world(t), local) : local;
    this._t = t;
    return this._m;
  }

  // World transform with all wobbles removed (used for coarse culling).
  homeWorld() {
    return this.parent ? mat4Mul(this.parent.homeWorld(), this.home) : this.home;
  }
}
