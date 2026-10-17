// Physics world: moving rigid fragments with convex colliders.
//
// Bodies move kinematically (motion.js formulas) until something knocks them
// loose; then they switch to free flight (zero gravity, damped). Colliders are
// stored as face planes in body space, so a ray test is a slab clip and a sphere
// test is a max over plane distances. A static grid indexes the formula bodies by
// their base pose inflated by their motion reach; free bodies are scanned
// separately (there are only ever a few dozen).
import * as THREE from 'three';
import { evalMotion, motionReach } from './motion.js';

export const F = {
  DRIVABLE: 1,   // wheels can stand on it
  ROUTE: 2,      // part of the authored racing surface
  PROP: 4,       // loose object: knocked away by the car
  BREAKABLE: 8,  // shatters when hit hard
  CRUMBLE: 16,   // piece of a slab that breaks up after the car passes
  SCENERY: 32,   // non-colliding dressing
  PORTAL: 64,
  HAZARD: 128,
};

let _bodyId = 0;

export class Collider {
  constructor(body, planes, verts, opts = {}) {
    this.body = body;
    this.n = planes.length;
    this.planes = new Float32Array(this.n * 4);
    planes.forEach((p, i) => this.planes.set(p, i * 4));
    const c = new THREE.Vector3();
    for (const v of verts) c.add(v);
    c.multiplyScalar(1 / Math.max(1, verts.length));
    let r = 0;
    for (const v of verts) r = Math.max(r, v.distanceTo(c));
    this.center = c;
    this.radius = r;
    this.drivable = opts.drivable ?? true;
    this.solid = opts.solid ?? true;
    this.surface = opts.surface || 'road';
    this.mark = 0;
  }
}

export class Body {
  constructor(o) {
    this.id = _bodyId++;
    this.name = o.name || '';
    this.basePos = (o.pos || new THREE.Vector3()).clone();
    this.baseQuat = (o.quat || new THREE.Quaternion()).clone();
    this.motion = o.motion || null;
    this.flags = o.flags || 0;
    this.geometry = o.geometry || null;
    this.colliders = [];
    this.pos = this.basePos.clone();
    this.quat = this.baseQuat.clone();
    this.mode = 0; // 0 formula, 1 free
    this.vel = new THREE.Vector3();
    this.angVel = new THREE.Vector3();
    this.mass = o.mass ?? 1;
    this.radius = o.radius ?? 1;
    this.stamp = -1;
    this.vstamp = -1;
    this.lvel = new THREE.Vector3();
    this.avel = new THREE.Vector3();
    this.rot = new THREE.Matrix3();
    this.instanceId = -1;
    this.visible = true;
    this.beat = o.beat || '';
    this.group = o.group || null; // crumble / break group
    this.userData = o.userData || {};
    this.reach = 0;
    if (this.geometry) {
      const bs = this.geometry.boundingSphere || (this.geometry.computeBoundingSphere(), this.geometry.boundingSphere);
      this.radius = bs.center.length() + bs.radius;
    }
  }
  addCollider(planes, verts, opts) {
    const c = new Collider(this, planes, verts, opts);
    this.colliders.push(c);
    return c;
  }
  resetToFormula() {
    this.mode = 0;
    this.vel.set(0, 0, 0);
    this.angVel.set(0, 0, 0);
    this.stamp = -1;
  }
}

const _v = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3();
const _p0 = new THREE.Vector3(), _q0 = new THREE.Quaternion(), _qi = new THREE.Quaternion();

export class World {
  constructor() {
    this.bodies = [];
    this.time = 0;        // physics clock
    this.motionTime = 0;  // drives the town's motion (can be frozen / slowed)
    this.motionScale = 1;
    this.stamp = 0;
    this.cell = 24;
    this.grid = new Map();
    this.free = new Set();
    this._mark = 1;
    this._cands = [];
  }

  add(body) {
    this.bodies.push(body);
    return body;
  }

  finalize() {
    this.grid.clear();
    const cs = this.cell;
    for (const b of this.bodies) {
      const lever = b.motion && b.motion.parent ? b.basePos.distanceTo(b.motion.parent.basePos) : 0;
      b.reach = motionReach(b.motion, b.radius, lever) + 0.5;
      for (const c of b.colliders) {
        const wc = c.center.clone().applyQuaternion(b.baseQuat).add(b.basePos);
        const r = c.radius + b.reach;
        const x0 = Math.floor((wc.x - r) / cs), x1 = Math.floor((wc.x + r) / cs);
        const y0 = Math.floor((wc.y - r) / cs), y1 = Math.floor((wc.y + r) / cs);
        const z0 = Math.floor((wc.z - r) / cs), z1 = Math.floor((wc.z + r) / cs);
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
          const k = `${x},${y},${z}`;
          let arr = this.grid.get(k);
          if (!arr) this.grid.set(k, (arr = []));
          arr.push(c);
        }
      }
    }
  }

  /** Advance clocks and free-flying bodies. */
  step(dt) {
    this.time += dt;
    this.motionTime += dt * this.motionScale;
    this.stamp++;
    for (const b of this.free) {
      b.pos.addScaledVector(b.vel, dt);
      const w = b.angVel.length();
      if (w > 1e-6) {
        _qi.setFromAxisAngle(_v.copy(b.angVel).multiplyScalar(1 / w), w * dt);
        b.quat.premultiply(_qi).normalize();
      }
      const lin = Math.exp(-(b.userData.linDamp ?? 0.35) * dt), ang = Math.exp(-(b.userData.angDamp ?? 0.25) * dt);
      b.vel.multiplyScalar(lin);
      b.angVel.multiplyScalar(ang);
      if (b.userData.gravity) b.vel.y -= b.userData.gravity * dt;
      b.rot.setFromMatrix4(_m4.makeRotationFromQuaternion(b.quat));
      b.stamp = this.stamp;
      if (b.userData.collide) this.collideFree(b, dt);
      if (b.pos.y < (b.userData.killY ?? -600)) { b.visible = false; this.free.delete(b); }
    }
  }

  /** Heavy-world loose bodies (section 2): a sphere proxy that lands, bounces and slides on solid ground. */
  collideFree(b, dt) {
    const r = b.userData.rad ?? Math.min(1.4, Math.max(0.3, b.radius * 0.45));
    const out = this._freeHits || (this._freeHits = []);
    out.length = 0;
    this.sphereContacts(b.pos, r, (c) => c.solid && c.body !== b && c.body.mode === 0 && !(c.body.flags & (F.PROP | F.SCENERY | F.BREAKABLE)), out);
    for (const h of out) {
      b.pos.addScaledVector(h.normal, h.depth);
      const vn = b.vel.dot(h.normal);
      if (vn < 0) {
        b.vel.addScaledVector(h.normal, -(1 + (b.userData.bounce ?? 0.18)) * vn);
        // ground friction on the tangential part
        const k = Math.exp(-(b.userData.friction ?? 2.2) * dt);
        _v.copy(h.normal).multiplyScalar(b.vel.dot(h.normal));
        b.vel.sub(_v).multiplyScalar(k).add(_v);
        b.angVel.multiplyScalar(Math.exp(-3 * dt));
      }
    }
  }

  setFree(b, vel, angVel) {
    if (b.mode === 0) { this.ensure(b); }
    b.mode = 1;
    b.vel.copy(vel);
    b.angVel.copy(angVel);
    this.free.add(b);
  }

  setFormula(b) {
    b.resetToFormula();
    this.free.delete(b);
  }

  /** Make sure body transform is evaluated for the current stamp. */
  ensure(b) {
    if (b.stamp === this.stamp) return b;
    if (b.mode === 0) evalMotion(b, this.motionTime, b.pos, b.quat);
    b.rot.setFromMatrix4(_m4.makeRotationFromQuaternion(b.quat));
    b.stamp = this.stamp;
    return b;
  }

  /** World velocity of body at world point p. */
  pointVelocity(b, p, out) {
    this.ensure(b);
    if (b.mode === 1) {
      return out.copy(b.angVel).cross(_v.subVectors(p, b.pos)).add(b.vel);
    }
    if (b.vstamp !== this.stamp) {
      b.vstamp = this.stamp;
      if (!b.motion || this.motionScale === 0) { b.lvel.set(0, 0, 0); b.avel.set(0, 0, 0); }
      else {
        const h = 1 / 120;
        evalMotion(b, this.motionTime - h, _p0, _q0);
        b.lvel.subVectors(b.pos, _p0).multiplyScalar(this.motionScale / h);
        _qi.copy(_q0).invert().premultiply(b.quat); // q * q0^-1
        if (_qi.w < 0) { _qi.x = -_qi.x; _qi.y = -_qi.y; _qi.z = -_qi.z; _qi.w = -_qi.w; }
        const s = Math.sqrt(Math.max(0, 1 - _qi.w * _qi.w));
        const ang = 2 * Math.acos(Math.min(1, _qi.w));
        if (s < 1e-8) b.avel.set(0, 0, 0);
        else b.avel.set(_qi.x / s, _qi.y / s, _qi.z / s).multiplyScalar((ang * this.motionScale) / h);
      }
    }
    return out.copy(b.avel).cross(_v.subVectors(p, b.pos)).add(b.lvel);
  }

  /** Candidate colliders whose inflated bounds touch the sphere (c, r). */
  query(c, r, out = this._cands) {
    out.length = 0;
    const mark = ++this._mark;
    const cs = this.cell;
    const x0 = Math.floor((c.x - r) / cs), x1 = Math.floor((c.x + r) / cs);
    const y0 = Math.floor((c.y - r) / cs), y1 = Math.floor((c.y + r) / cs);
    const z0 = Math.floor((c.z - r) / cs), z1 = Math.floor((c.z + r) / cs);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const arr = this.grid.get(`${x},${y},${z}`);
      if (!arr) continue;
      for (const col of arr) {
        if (col.mark === mark || col.body.mode === 1 || !col.body.visible) continue;
        col.mark = mark;
        out.push(col);
      }
    }
    for (const b of this.free) {
      if (!b.visible) continue;
      for (const col of b.colliders) if (col.mark !== mark) { col.mark = mark; out.push(col); }
    }
    // exact bounding-sphere cull with current transforms
    let w = 0;
    for (let i = 0; i < out.length; i++) {
      const col = out[i];
      const b = this.ensure(col.body);
      _v.copy(col.center).applyQuaternion(b.quat).add(b.pos);
      const rr = col.radius + r;
      if (_v.distanceToSquared(c) <= rr * rr) out[w++] = col;
    }
    out.length = w;
    return out;
  }

  /** Raycast against colliders. filter(col) -> bool. Returns hit or null. */
  raycast(origin, dir, maxT, filter = null, hit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null }) {
    _rc.copy(origin).addScaledVector(dir, maxT * 0.5);
    const cands = this.query(_rc, maxT * 0.5 + 0.01, this._rayCands || (this._rayCands = []));
    let best = maxT, bestCol = null;
    const bn = _bn;
    for (const col of cands) {
      if (filter && !filter(col)) continue;
      const b = col.body;
      // to body space
      _o.subVectors(origin, b.pos);
      const e = b.rot.elements; // column-major; local = R^T * world
      const ox = e[0] * _o.x + e[1] * _o.y + e[2] * _o.z;
      const oy = e[3] * _o.x + e[4] * _o.y + e[5] * _o.z;
      const oz = e[6] * _o.x + e[7] * _o.y + e[8] * _o.z;
      const dx = e[0] * dir.x + e[1] * dir.y + e[2] * dir.z;
      const dy = e[3] * dir.x + e[4] * dir.y + e[5] * dir.z;
      const dz = e[6] * dir.x + e[7] * dir.y + e[8] * dir.z;
      let tIn = 0, tOut = best, inIdx = -1, inside = true, maxS = -Infinity, maxIdx = 0;
      const P = col.planes;
      let miss = false;
      for (let i = 0; i < col.n; i++) {
        const nx = P[i * 4], ny = P[i * 4 + 1], nz = P[i * 4 + 2], pd = P[i * 4 + 3];
        const s = nx * ox + ny * oy + nz * oz - pd;
        const den = nx * dx + ny * dy + nz * dz;
        if (s > 0) inside = false;
        if (s > maxS) { maxS = s; maxIdx = i; }
        if (Math.abs(den) < 1e-12) { if (s > 0) { miss = true; break; } continue; }
        const t = -s / den;
        if (den < 0) { if (t > tIn) { tIn = t; inIdx = i; } }
        else if (t < tOut) tOut = t;
        if (tIn > tOut) { miss = true; break; }
      }
      if (miss) continue;
      let idx = inIdx;
      if (inside) { tIn = 0; idx = maxIdx; }
      if (idx < 0 || tIn >= best) continue;
      best = tIn; bestCol = col;
      bn.set(P[idx * 4], P[idx * 4 + 1], P[idx * 4 + 2]).applyMatrix3(b.rot);
      hit.inside = inside;
    }
    if (!bestCol) return null;
    hit.t = best;
    hit.point.copy(origin).addScaledVector(dir, best);
    hit.normal.copy(bn).normalize();
    hit.collider = bestCol;
    return hit;
  }

  /**
   * Sphere vs colliders. Pushes contacts {normal, depth, point, collider} into out.
   * Uses max-plane distance (exact on faces, slightly generous near edges).
   */
  sphereContacts(c, r, filter, out) {
    const cands = this.query(c, r, this._sphCands || (this._sphCands = []));
    for (const col of cands) {
      if (filter && !filter(col)) continue;
      const b = col.body;
      _o.subVectors(c, b.pos);
      const e = b.rot.elements;
      const ox = e[0] * _o.x + e[1] * _o.y + e[2] * _o.z;
      const oy = e[3] * _o.x + e[4] * _o.y + e[5] * _o.z;
      const oz = e[6] * _o.x + e[7] * _o.y + e[8] * _o.z;
      const P = col.planes;
      let maxS = -Infinity, idx = -1;
      for (let i = 0; i < col.n; i++) {
        const s = P[i * 4] * ox + P[i * 4 + 1] * oy + P[i * 4 + 2] * oz - P[i * 4 + 3];
        if (s > maxS) { maxS = s; idx = i; if (s >= r) break; }
      }
      if (maxS >= r || idx < 0) continue;
      const n = new THREE.Vector3(P[idx * 4], P[idx * 4 + 1], P[idx * 4 + 2]).applyMatrix3(b.rot).normalize();
      out.push({ normal: n, depth: r - maxS, point: c.clone().addScaledVector(n, -Math.max(0, maxS)), collider: col });
    }
    return out;
  }
}

const _m4 = new THREE.Matrix4();
const _bn = new THREE.Vector3();
const _rc = new THREE.Vector3();
