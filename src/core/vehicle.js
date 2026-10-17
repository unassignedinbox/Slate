// Arcade rigid-body car for testing the level.
//
// * Four raycast wheels with spring/damper suspension give real pitch, roll,
//   landing compression and tipping off edges (forces at the contact points,
//   integrated with an approximate inertia tensor).
// * Tyre forces are computed against the velocity of whatever the wheels stand
//   on (world.pointVelocity), so the car rides drifting fragments without sliding
//   off them - the single most important property for this level.
// * Yaw is arcade-controlled (bicycle-model target yaw rate, grip-limited), which
//   keeps handling predictable for blockout testing; the handbrake drops lateral
//   grip and raises the yaw ceiling for drifts.
// * The body is 12 spheres: walls, scenery and loose props are resolved against
//   them with simple impulses (props get knocked away, breakables shatter).
//
// Car space: +Z forward, +Y up, +X LEFT (a proper rotation of the ControlVehicle's
// authored +X fwd / +Y left / +Z up frame).
import * as THREE from 'three';
import { F } from './world.js';
import { clamp } from './rng.js';

export const CAR = {
  wheelRadius: 0.53,
  wheelPos: [[1.05, 0.42, 1.73], [-1.05, 0.42, 1.73], [1.05, 0.42, -1.67], [-1.05, 0.42, -1.67]], // FL FR RL RR (authored wheel centres)
  wheelbase: 3.4,
  rayUp: 0.9,
  travel: 0.32,
  bump: 0.14,
  springK: 14.5,
  springC: 2.1,
  bumpK: 160,
  gravity: 12.0,
  engine: 12.0,
  topSpeed: 54,
  reverseAccel: 8,
  reverseTop: 14,
  brake: 21,
  rolling: 0.02,
  drag: 0.0008,
  coast: 0.7,
  steerLow: 0.62,
  steerHigh: 0.07,
  steerFade: 40,
  steerRate: 5.0,
  steerReturn: 8.0,
  grip: 10.0,
  latMax: 16.0,
  handbrakeGrip: 1.6,
  handbrakeYaw: 1.55,
  yawResp: 9,
  downforce: 0.0024,
  airYaw: 1.3,
  airLevel: 2.2,
  airDamp: 0.9,
  inertia: [3.4, 3.7, 1.0], // about car X (pitch), Y (yaw), Z (roll), per unit mass
  spheres: [
    // x, y, z, r (car space)
    [0.72, 0.68, 2.62, 0.44], [-0.72, 0.68, 2.62, 0.44],
    [0.75, 0.6, 1.35, 0.5], [-0.75, 0.6, 1.35, 0.5],
    [0.75, 0.6, 0.0, 0.5], [-0.75, 0.6, 0.0, 0.5],
    [0.75, 0.6, -1.35, 0.5], [-0.75, 0.6, -1.35, 0.5],
    [0.72, 0.68, -2.62, 0.44], [-0.72, 0.68, -2.62, 0.44],
    [0.0, 0.95, 0.5, 0.42], [0.0, 0.95, -0.9, 0.42],
  ],
};

// hardpoints sit above the authored wheel centres by the static sag, so at rest the
// wheels render exactly where the ControlVehicle mesh has them
const SAG = CAR.travel - CAR.gravity / (4 * CAR.springK);
const HP = CAR.wheelPos.map(([x, y, z]) => new THREE.Vector3(x, y + SAG, z));
const SPH = CAR.spheres.map(([x, y, z, r]) => ({ c: new THREE.Vector3(x, y, z), r }));

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const _H = new THREE.Vector3(), _o = new THREE.Vector3(), _gv = new THREE.Vector3(), _q = new THREE.Quaternion();
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _n = new THREE.Vector3(), _tq = new THREE.Vector3();
const _invQ = new THREE.Quaternion(), _wup = new THREE.Vector3(0, 1, 0), _gw = new THREE.Vector3();

const wheelFilter = (col) => col.drivable && !(col.body.flags & (F.PROP | F.SCENERY));
const solidFilter = (col) => col.solid && !(col.body.flags & F.SCENERY);

export class Car {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.steer = 0;
    this.wheels = HP.map((hp, i) => ({
      hp, front: i < 2, contact: false, comp: 0, offset: -CAR.travel, spin: 0,
      point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), body: null, hit: { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null },
    }));
    this.contacts = 0;
    this.groundNormal = new THREE.Vector3(0, 1, 0);
    this.groundVel = new THREE.Vector3();
    this.groundBody = null;
    this.speed = 0;       // forward speed relative to ground (m/s)
    this.airTime = 0;
    this.lastAir = 0;
    this.events = [];
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.up = new THREE.Vector3(0, 1, 0);
    this.left = new THREE.Vector3(1, 0, 0);
    this.latAcc = 0;
    this.lonAcc = 0;
    this.drifting = false;
    this.disabled = false;
  }

  reset(pos, quat, vel = null) {
    this.pos.copy(pos);
    this.quat.copy(quat).normalize();
    this.vel.copy(vel || _v.set(0, 0, 0));
    this.angVel.set(0, 0, 0);
    this.steer = 0;
    this.airTime = 0;
    for (const w of this.wheels) { w.contact = false; w.comp = 0; w.offset = -CAR.travel; }
  }

  axes() {
    this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
    this.up.set(0, 1, 0).applyQuaternion(this.quat);
    this.left.set(1, 0, 0).applyQuaternion(this.quat);
  }

  /** input: { throttle 0..1, brake 0..1, steer -1..1 (right +), handbrake bool } */
  step(dt, input) {
    const W = this.world;
    this.events.length = 0;
    this.axes();
    const up = this.up, fwd = this.fwd;
    const g = CAR.gravity;

    // ---------- steering input smoothing ----------
    const sIn = clamp(input.steer || 0, -1, 1);
    const rate = Math.abs(sIn) > Math.abs(this.steer) && Math.sign(sIn) === Math.sign(this.steer || sIn) ? CAR.steerRate : CAR.steerReturn;
    this.steer += clamp(sIn - this.steer, -rate * dt, rate * dt);

    // ---------- suspension ----------
    const maxLen = CAR.rayUp + CAR.wheelRadius + CAR.travel;
    let contacts = 0;
    const lin = _a.set(0, 0, 0);
    const torque = _tq.set(0, 0, 0);
    _n.set(0, 0, 0);
    _gv.set(0, 0, 0);
    let groundBody = null;
    for (const w of this.wheels) {
      _H.copy(w.hp).applyQuaternion(this.quat).add(this.pos);
      _o.copy(_H).addScaledVector(up, CAR.rayUp);
      _v.copy(up).negate();
      const hit = W.raycast(_o, _v, maxLen, wheelFilter, w.hit);
      if (!hit) {
        w.contact = false;
        w.offset += (-CAR.travel - w.offset) * Math.min(1, dt * 12);
        w.comp = 0;
        continue;
      }
      let off = CAR.rayUp + CAR.wheelRadius - hit.t; // wheel centre offset along up from hardpoint
      const c = off + CAR.travel;
      w.contact = true;
      w.offset = Math.min(off, CAR.bump);
      w.comp = c;
      w.point.copy(hit.point);
      w.normal.copy(hit.normal);
      w.body = hit.collider.body;
      groundBody = groundBody || w.body;
      // relative normal velocity at the contact
      W.pointVelocity(w.body, hit.point, _gw);
      _gv.add(_gw);
      _b.subVectors(hit.point, this.pos);
      _v.copy(this.angVel).cross(_b).add(this.vel).sub(_gw);
      const vn = _v.dot(up);
      let a = CAR.springK * c - CAR.springC * vn;
      if (c > CAR.travel + CAR.bump) a += CAR.bumpK * (c - CAR.travel - CAR.bump) - 6 * vn;
      if (a < 0) a = 0;
      // force along contact normal (pure support; friction handled below)
      _v.copy(hit.normal).multiplyScalar(a);
      lin.add(_v);
      torque.add(_w.copy(_b).cross(_v));
      _n.add(hit.normal);
      contacts++;
    }
    this.contacts = contacts;
    const grounded = contacts > 0;
    if (grounded) {
      this.groundNormal.copy(_n.normalize());
      this.groundVel.copy(_gv.multiplyScalar(1 / contacts));
      this.groundBody = groundBody;
      if (this.airTime > 0.25) this.events.push({ type: 'land', air: this.airTime, vy: this.vel.y });
      this.lastAir = this.airTime;
      this.airTime = 0;
    } else {
      this.airTime += dt;
      this.groundBody = null;
    }

    // apply suspension
    this.vel.addScaledVector(lin, dt);
    this.applyTorque(torque, dt);

    // ---------- gravity + drag ----------
    this.vel.y -= g * dt;
    const sp = this.vel.length();
    this.vel.addScaledVector(this.vel, -CAR.drag * sp * dt);

    // ---------- tyres ----------
    if (grounded) {
      const n = this.groundNormal;
      _f.copy(fwd).addScaledVector(n, -n.dot(fwd)).normalize();
      _r.crossVectors(_f, n).normalize(); // right
      _v.subVectors(this.vel, this.groundVel);
      const vf = _v.dot(_f), vr = _v.dot(_r);
      this.speed = vf;
      const k = Math.min(1, contacts / 3);
      const T = clamp(input.throttle || 0, 0, 1), B = clamp(input.brake || 0, 0, 1);
      let al = 0;
      if (T > 0) {
        if (vf > -0.5) al += T * CAR.engine * Math.max(0.08, 1 - (vf / CAR.topSpeed) ** 2);
        else al += T * CAR.brake;
      }
      if (B > 0) {
        if (vf > 0.5) al -= B * CAR.brake;
        else al -= B * CAR.reverseAccel * Math.max(0, 1 - Math.max(0, -vf) / CAR.reverseTop);
      }
      al -= CAR.rolling * vf;
      if (T === 0 && B === 0) {
        if (Math.abs(vf) < 0.4) al = -vf / dt * 0.5;
        else al -= Math.sign(vf) * CAR.coast;
      }
      // hold the car against gravity along the slope when nearly stopped
      const gl = -g * _f.y; // gravity component along f
      if (Math.abs(vf) < 1.5 && T === 0) al -= gl;
      const hb = !!input.handbrake;
      const grip = hb ? CAR.handbrakeGrip : CAR.grip;
      let ar = -vr * grip - (-g * _r.y); // cancel lateral gravity (banked roofs)
      const lim = CAR.latMax * (hb ? 0.75 : 1);
      ar = clamp(ar, -lim, lim);
      const tot = Math.hypot(al, ar), cap = CAR.latMax * 1.2;
      if (tot > cap) { al *= cap / tot; ar *= cap / tot; }
      this.vel.addScaledVector(_f, al * k * dt);
      this.vel.addScaledVector(_r, ar * k * dt);
      this.vel.addScaledVector(n, -CAR.downforce * vf * vf * k * dt);
      this.latAcc = ar;
      this.lonAcc = al;
      this.drifting = hb && Math.abs(vr) > 3;

      // yaw: bicycle model target, grip limited
      const dmax = CAR.steerHigh + (CAR.steerLow - CAR.steerHigh) * Math.exp(-Math.abs(vf) / (CAR.steerFade * 0.45));
      const delta = -this.steer * dmax;
      let wt = vf * Math.tan(delta) / CAR.wheelbase;
      const wl = (CAR.latMax * 1.08) / Math.max(Math.abs(vf), 3);
      wt = clamp(wt, -wl, wl);
      if (hb) wt *= CAR.handbrakeYaw;
      const gYaw = groundBody ? (groundBody.mode === 0 ? groundBody.avel : groundBody.angVel).dot(n) : 0;
      const wcur = this.angVel.dot(n) - gYaw;
      const dw = (wt - wcur) * Math.min(1, CAR.yawResp * dt) * k;
      this.angVel.addScaledVector(n, dw);
      // mild pitch/roll damping relative to ground
      _w.copy(this.angVel).addScaledVector(n, -this.angVel.dot(n));
      this.angVel.addScaledVector(_w, -Math.min(1, 2.5 * dt));
    } else {
      // ---------- air control ----------
      this.speed = this.vel.dot(fwd);
      // level towards the ground below (or world up), steer adjusts yaw
      let target = _wup;
      _o.copy(this.pos);
      const hit = W.raycast(_o, _v.set(0, -1, 0), 40, wheelFilter, this._airHit || (this._airHit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null }));
      if (hit) target = hit.normal;
      _w.crossVectors(up, target);
      const s = _w.length();
      if (s > 1e-5) {
        const ang = Math.asin(Math.min(1, s));
        this.angVel.addScaledVector(_w.multiplyScalar(1 / s), ang * CAR.airLevel * 6 * dt);
      }
      const yaw = this.angVel.dot(up);
      const yt = -this.steer * CAR.airYaw;
      this.angVel.addScaledVector(up, (yt - yaw) * Math.min(1, 3 * dt));
      this.angVel.multiplyScalar(Math.exp(-CAR.airDamp * dt));
      this.latAcc = 0; this.lonAcc = 0; this.drifting = false;
    }

    // ---------- integrate ----------
    this.pos.addScaledVector(this.vel, dt);
    const wl2 = this.angVel.length();
    if (wl2 > 1e-7) {
      _q.setFromAxisAngle(_v.copy(this.angVel).multiplyScalar(1 / wl2), wl2 * dt);
      this.quat.premultiply(_q).normalize();
    }

    // ---------- body collisions ----------
    this.collide(dt);

    // wheel spin (visual)
    for (const w of this.wheels) w.spin += (this.speed / CAR.wheelRadius) * dt;
  }

  applyTorque(tq, dt) {
    // world torque -> car space, divide by inertia, back to world
    _invQ.copy(this.quat).invert();
    _v.copy(tq).applyQuaternion(_invQ);
    _v.x /= CAR.inertia[0]; _v.y /= CAR.inertia[1]; _v.z /= CAR.inertia[2];
    _v.applyQuaternion(this.quat);
    this.angVel.addScaledVector(_v, dt);
  }

  collide(dt) {
    const W = this.world;
    const contacts = this._contacts || (this._contacts = []);
    for (let iter = 0; iter < 2; iter++) {
      contacts.length = 0;
      for (const s of SPH) {
        _H.copy(s.c).applyQuaternion(this.quat).add(this.pos);
        const before = contacts.length;
        W.sphereContacts(_H, s.r, solidFilter, contacts);
        for (let i = before; i < contacts.length; i++) contacts[i].sphere = s;
      }
      if (!contacts.length) return;
      // props / breakables first: they get knocked, the car mostly keeps going
      let pushed = false;
      const push = _gv.set(0, 0, 0);
      for (const ct of contacts) {
        const body = ct.collider.body;
        if (body.flags & (F.PROP | F.BREAKABLE)) {
          if (iter === 0) this.hitLoose(ct, dt);
          continue;
        }
        // positional: accumulate the largest push along each contact normal
        const along = push.dot(ct.normal);
        if (ct.depth > along) push.addScaledVector(ct.normal, ct.depth - along);
        pushed = true;
      }
      if (!pushed) return;
      this.pos.add(push);
      // velocity response per contact
      for (const ct of contacts) {
        const body = ct.collider.body;
        if (body.flags & (F.PROP | F.BREAKABLE)) continue;
        const n = ct.normal;
        W.pointVelocity(body, ct.point, _w);
        _b.subVectors(ct.point, this.pos);
        _v.copy(this.angVel).cross(_b).add(this.vel).sub(_w);
        const vn = _v.dot(n);
        if (vn >= 0) continue;
        const floor = n.y > 0.6;
        const e = floor ? 0.0 : 0.12;
        const dv = -(1 + e) * vn;
        this.vel.addScaledVector(n, dv);
        // scrape friction
        _a.copy(_v).addScaledVector(n, -vn);
        const vt = _a.length();
        if (vt > 1e-4) this.vel.addScaledVector(_a, -Math.min(1, (floor ? 0.08 : 0.35) * dv / vt));
        if (!floor) {
          // yaw kick from off-centre hits (car turns away from the wall)
          _tq.copy(_b).cross(_a.copy(n).multiplyScalar(dv));
          _tq.multiplyScalar(0.35);
          this.applyTorque(_tq, 1);
          if (dv > 4) this.events.push({ type: 'wall', dv, point: ct.point.clone() });
        }
      }
    }
  }

  hitLoose(ct, dt) {
    const W = this.world;
    const body = ct.collider.body;
    const n = ct.normal; // points from body to car
    W.pointVelocity(body, ct.point, _w);
    _v.subVectors(this.vel, _w);
    const vn = _v.dot(n);
    if (body.flags & F.BREAKABLE) {
      if (-vn > (body.userData.breakSpeed ?? 6)) {
        this.events.push({ type: 'break', body, vel: this.vel.clone(), point: ct.point.clone() });
        this.vel.multiplyScalar(1 - (body.userData.breakCost ?? 0.08));
        return;
      }
      // too slow to break: treat as a wall
      this.pos.addScaledVector(n, ct.depth);
      if (vn < 0) this.vel.addScaledVector(n, -vn * 1.05);
      return;
    }
    if (vn >= 0) return;
    const mc = 1, mp = body.mass;
    const j = (-(1.25) * vn) / (1 / mc + 1 / mp);
    if (body.mode === 0) W.setFree(body, _w.clone(), body.angVel.set(0, 0, 0).clone());
    body.vel.addScaledVector(n, -j / mp);
    body.vel.addScaledVector(this.vel, 0.15 * Math.min(1, 3 / mp));
    body.vel.y += Math.min(4, -vn * 0.25);
    const spin = Math.min(6, -vn * 0.4 / Math.max(0.4, Math.sqrt(mp)));
    body.angVel.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
    this.vel.addScaledVector(n, (j / mc) * Math.min(1, mp / 4) * 0.6);
    body.pos.addScaledVector(n, -ct.depth);
    this.events.push({ type: 'prop', body, dv: -vn });
  }

  isUpsideDown() {
    this.axes();
    return this.up.y < 0.15;
  }
}
