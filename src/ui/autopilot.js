import * as THREE from 'three';

// Scripted "grand tour" waypoints (theta, phi on the cave shell) chosen to
// walk the spider from the floor, up a wall, across the ceiling, and back
// down a different wall — the clearest possible demonstration of the
// wall/ceiling locomotion.
const WAYPOINTS = [
  { theta: 0.2, phi: 2.35 },
  { theta: 0.9, phi: 2.0 },
  { theta: 1.6, phi: 1.55 },
  { theta: 2.0, phi: 1.05 },
  { theta: 2.35, phi: 0.55 },
  { theta: 2.9, phi: 0.22 },
  { theta: 3.6, phi: 0.30 },
  { theta: 4.2, phi: 0.75 },
  { theta: 4.7, phi: 1.3 },
  { theta: 5.2, phi: 1.9 },
  { theta: 5.9, phi: 2.3 },
];

export class Autopilot {
  constructor(cave, controller) {
    this.cave = cave;
    this.controller = controller;
    this.active = false;
    this.index = 0;
    this._target = new THREE.Vector3();
    this._toTarget = new THREE.Vector3();
    this._updateTargetPoint();
  }

  toggle() {
    this.active = !this.active;
    if (!this.active) {
      this.controller.setMoveInput(0, 0, false);
      this.controller.setYawInput(0);
    }
    return this.active;
  }

  _updateTargetPoint() {
    const wp = WAYPOINTS[this.index % WAYPOINTS.length];
    const { point } = this.cave.pointOnShell(wp.theta, wp.phi);
    this._target.copy(point);
  }

  update(dt) {
    if (!this.active) return;
    if (this.controller.isBusy()) return;

    this._toTarget.subVectors(this._target, this.controller.position);
    const distAlongUp = this._toTarget.dot(this.controller.up);
    this._toTarget.addScaledVector(this.controller.up, -distAlongUp);
    const dist = this._toTarget.length();

    if (dist < 0.18) {
      this.index = (this.index + 1) % WAYPOINTS.length;
      this._updateTargetPoint();
      return;
    }
    this._toTarget.normalize();
    const fwd = this.controller.forward;
    const right = this.controller.right;
    const cos = THREE.MathUtils.clamp(fwd.dot(this._toTarget), -1, 1);
    const sin = right.dot(this._toTarget);
    const angle = Math.atan2(sin, cos);

    this.controller.setYawInput(THREE.MathUtils.clamp(angle * 2.2, -1, 1));
    const forwardAmt = THREE.MathUtils.clamp(1.0 - Math.abs(angle) * 0.5, 0.25, 1);
    this.controller.setMoveInput(forwardAmt, 0, false);
  }
}
