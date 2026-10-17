// Autopilot: pure-pursuit steering on the racing line + the route's curvature /
// braking speed profile. It is the level's test driver: the headless run uses it
// to prove the section is completable and to measure a reference time, and the
// browser build can hand the car to it ("demo run") to preview a whole section.
import * as THREE from 'three';
import { clamp } from './rng.js';

const _d = new THREE.Vector3(), _p = new THREE.Vector3();

export class Autopilot {
  constructor() { this.out = { throttle: 0, brake: 0, steer: 0, handbrake: false }; }

  control(car, route, s) {
    const o = this.out;
    car.axes();
    const v = Math.max(0, car.speed);
    const look = clamp(7 + 0.5 * v, 10, 30);
    route.pos(s + look, _p);
    _d.subVectors(_p, car.pos);
    const x = _d.dot(car.left), z = _d.dot(car.fwd);
    const ang = Math.atan2(x, Math.max(0.5, z)); // + = target to the left
    const gain = clamp(1.6 + 40 / Math.max(8, v), 1.6, 3.4);
    const steer = clamp(-ang * gain, -1, 1);
    // speed: look a little ahead on the profile
    const i = route.index(s + 3 + v * 0.25);
    const vt = route.vmax[i];
    const err = vt - v;
    o.steer = steer;
    o.throttle = err > 0 ? clamp(0.35 + err * 0.3, 0, 1) : 0;
    o.brake = err < -1.5 ? clamp(-err * 0.18, 0, 1) : 0;
    o.handbrake = false;
    if (car.contacts === 0) { o.brake = 0; }
    return o;
  }
}
