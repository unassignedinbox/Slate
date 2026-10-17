// Point-to-point race logic shared by the browser and the headless runner:
// progress along the current section's line, splits per beat, crumbling slabs,
// breakables, respawns and portal transfers between sections.
import * as THREE from 'three';
import { evalMotion } from '../core/motion.js';
import { F } from '../core/world.js';
import { RNG } from '../core/rng.js';

const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _l = new THREE.Vector3(), _qi = new THREE.Quaternion();

export class Race {
  constructor(level, car, opts = {}) {
    this.level = level;
    this.car = car;
    this.world = level.world;
    this.opts = opts;
    this.rng = new RNG(77);
    this.fracture = opts.fracture ?? true;
    this.events = [];
    this.log = [];
    this.reset();
  }

  get sec() { return this.level.sections[this.section]; }
  get route() { return this.sec.route; }

  reset() {
    const W = this.world;
    for (const s of this.level.sections) {
      for (const c of s.ctx.crumbles) { c.done = false; for (const b of c.bodies) { W.setFormula(b); b.visible = true; } }
    }
    for (const b of W.bodies) {
      if (b.flags & F.BREAKABLE) { b.visible = true; for (const c of b.userData.chunks || []) { c.visible = false; W.setFormula(c); } }
      if (b.flags & F.PROP && b.mode === 1) { W.setFormula(b); b.visible = true; }
    }
    this.section = 0;
    this.s = 0;
    this.time = 0;
    this.state = this.opts.countdown ? 'countdown' : 'racing';
    this.countdown = this.opts.countdown || 0;
    this.sectionStart = 0;
    this.sectionTimes = [];
    this.splits = {};
    this.lastBeat = '';
    this.respawnCount = 0;
    this.respawnLog = [];
    this.stuck = 0;
    this.flipped = 0;
    this.stats = { maxSpeed: 0, air: 0, maxAir: 0, walls: 0, props: 0, breaks: 0, crumbles: 0, dist: 0 };
    this.placeAt(this.level.start, 0);
  }

  placeAt(rs, speed = null) {
    const v = speed ?? rs.speed ?? 0;
    const f = this.route.at(rs.s ?? 0);
    let pos = rs.pos, quat = rs.quat, dir = f.t.clone();
    if (rs.parent) {
      // the respawn point rides a moving body (section 2's city plates): use where it is now
      const pp = new THREE.Vector3(), pq = new THREE.Quaternion();
      evalMotion(rs.parent, this.world.motionTime, pp, pq);
      const dq = rs.parent.baseQuat.clone().invert().premultiply(pq);
      pos = rs.pos.clone().sub(rs.parent.basePos).applyQuaternion(dq).add(pp);
      quat = dq.clone().multiply(rs.quat);
      dir.applyQuaternion(dq);
    }
    this.car.reset(pos, quat, dir.multiplyScalar(v));
    this.s = rs.s ?? 0;
    this._prev = this.car.pos.clone();
    this.stuck = 0; this.flipped = 0;
  }

  respawn(reason = 'manual') {
    const sec = this.sec;
    let best = sec.ctx.respawns[0];
    for (const r of sec.ctx.respawns) if (r.s <= this.s - 4 && r.s >= best.s) best = r;
    this.respawnCount++;
    this.respawnLog.push({ reason, s: Math.round(this.s), section: sec.id, t: +this.time.toFixed(2) });
    // re-form anything ahead of the respawn point
    for (const c of sec.ctx.crumbles) if (c.sTrigger > best.s && c.done) { c.done = false; for (const b of c.bodies) { this.world.setFormula(b); b.visible = true; } }
    this.placeAt(best);
    this.events.push({ type: 'respawn', reason });
  }

  step(dt, input) {
    const W = this.world, car = this.car;
    this.events.length = 0;
    if (this.state === 'countdown') {
      W.step(dt);
      this.countdown -= dt;
      // hold the car on the grid (no input = hold; brake at a standstill would mean reverse)
      car.step(dt, { throttle: 0, brake: 0, steer: 0 });
      if (this.countdown <= 0) { this.state = 'racing'; this.events.push({ type: 'go' }); }
      return;
    }
    this._prev.copy(car.pos);
    W.step(dt);
    car.step(dt, this.state === 'finished' ? { throttle: 0, brake: car.speed > 1 ? 0.6 : 0, steer: 0 } : input);
    if (this.state === 'racing') this.time += dt;
    const sp = car.vel.length();
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, sp);
    this.stats.dist += sp * dt;
    if (car.contacts === 0) { this.stats.air += dt; this.stats.maxAir = Math.max(this.stats.maxAir, car.airTime); }
    for (const e of car.events) this.onCarEvent(e);
    // progress
    const n = this.route.nearest(car.pos, this.s, 25, 45);
    this.s = n.s;
    this.dist = n.dist;
    const b = this.route.beatAt(this.s);
    if (b && b.id !== this.lastBeat && this.state === 'racing') {
      if (!(b.id in this.splits)) this.splits[b.id] = this.time;
      this.lastBeat = b.id;
      this.events.push({ type: 'beat', beat: b });
    }
    if (this.fracture) this.checkCrumbles();
    if (this.checkPortals()) return;
    if (this.sec.finishS !== undefined && this.s >= this.sec.finishS && this.state === 'racing') {
      this.state = 'finished';
      this.sectionTimes.push({ id: this.sec.id, time: this.time - this.sectionStart });
      this.events.push({ type: 'finish' });
    }
    this.checkRespawn(dt, input);
  }

  onCarEvent(e) {
    if (e.type === 'wall') this.stats.walls++;
    else if (e.type === 'prop') this.stats.props++;
    else if (e.type === 'break') { this.breakBody(e.body, e.vel); this.stats.breaks++; }
    this.events.push(e);
  }

  breakBody(body, vel) {
    const W = this.world;
    if (!body.visible) return;
    body.visible = false;
    W.ensure(body);
    for (const c of body.userData.chunks || []) {
      c.visible = true;
      W.ensure(c);
      const out = c.pos.clone().sub(body.pos).normalize();
      const v = vel.clone().multiplyScalar(this.rng.range(0.35, 0.85)).addScaledVector(out, this.rng.range(1, 4));
      v.y += this.rng.range(0, 2.5);
      W.setFree(c, v, new THREE.Vector3(this.rng.range(-3, 3), this.rng.range(-3, 3), this.rng.range(-3, 3)));
      if (body.userData.heavy) Object.assign(c.userData, { gravity: 12, collide: true, rad: 0.35, linDamp: 0.1, bounce: 0.25 });
    }
  }

  checkCrumbles() {
    const W = this.world;
    for (const c of this.sec.ctx.crumbles) {
      if (c.done || this.s < c.sTrigger || this.s > c.sTrigger + 120) continue;
      c.done = true;
      this.stats.crumbles++;
      for (const b of c.bodies) {
        W.ensure(b);
        const v0 = W.pointVelocity(b, b.pos, new THREE.Vector3());
        const out = b.pos.clone().sub(c.centre);
        out.addScaledVector(c.up, -out.dot(c.up)).normalize();
        const v = v0.addScaledVector(out, this.rng.range(0.6, 2.0)).addScaledVector(c.up, this.rng.range(-0.8, 0.5)).addScaledVector(c.along, this.rng.range(-0.5, 0.5));
        if (c.gravity) {
          // heavy world: the pieces drop away into the gap
          v.addScaledVector(c.up, -this.rng.range(1, 3));
          W.setFree(b, v, new THREE.Vector3(this.rng.range(-0.6, 0.6), this.rng.range(-0.3, 0.3), this.rng.range(-0.6, 0.6)));
          b.userData.gravity = 12; b.userData.linDamp = 0.02; b.userData.angDamp = 0.05;
        } else {
          W.setFree(b, v, new THREE.Vector3(this.rng.range(-0.25, 0.25), this.rng.range(-0.15, 0.15), this.rng.range(-0.25, 0.25)));
          b.userData.linDamp = 0.05; b.userData.angDamp = 0.02;
        }
      }
      this.events.push({ type: 'crumble', group: c });
    }
  }

  portalPose(end, outPos, outQuat) {
    if (end.parent) { evalMotion(end.parent, this.world.motionTime, outPos, outQuat); }
    else { outPos.copy(end.centre); outQuat.copy(end.quat); }
  }

  checkPortals() {
    const car = this.car;
    for (const P of this.level.portals) {
      if (P.fromSection !== this.section) continue;
      this.portalPose(P.from, _p, _q);
      _qi.copy(_q).invert();
      const a = _l.copy(this._prev).sub(_p).applyQuaternion(_qi);
      const za = a.z;
      const b = car.pos.clone().sub(_p).applyQuaternion(_qi);
      if (!(za < 0 && b.z >= 0)) continue;
      if (Math.abs(b.x) > P.from.w / 2 + 0.5 || Math.abs(b.y) > P.from.h / 2 + 0.5) continue;
      // carry the car (and anything that follows it) through
      const toP = new THREE.Vector3(), toQ = new THREE.Quaternion();
      this.portalPose(P.to, toP, toQ);
      const dq = toQ.clone().multiply(_qi); // rotation from source frame to destination frame
      // keep the crossing point, but emerge just above the destination road whatever the jump height
      const dy = THREE.MathUtils.clamp(b.y, P.to.minY ?? -1, P.to.maxY ?? 3) - b.y;
      const xf = { fromPos: _p.clone(), fromQuat: _q.clone(), toPos: toP.clone().add(new THREE.Vector3(0, dy, 0).applyQuaternion(toQ)), toQuat: toQ, dq };
      car.pos.copy(b.applyQuaternion(toQ).add(xf.toPos));
      car.quat.premultiply(dq).normalize();
      car.vel.applyQuaternion(dq);
      car.angVel.applyQuaternion(dq);
      this._prev.copy(car.pos);
      this.sectionTimes.push({ id: this.sec.id, time: this.time - this.sectionStart });
      this.sectionStart = this.time;
      this.section = P.toSection;
      this.s = 0;
      this.lastBeat = '';
      this.events.push({ type: 'portal', portal: P, xf });
      return true;
    }
    return false;
  }

  checkRespawn(dt, input) {
    const car = this.car;
    const f = this.route.at(this.s);
    if (car.pos.y < f.p.y - 24) return this.respawn('fell');
    if (this.dist > 60) return this.respawn('off-route');
    car.axes();
    if (car.up.y < 0.25) {
      this.flipped += dt;
      if (this.flipped > 1.6) return this.respawn('flipped');
    } else this.flipped = 0;
    if (this.state === 'racing' && (input?.throttle ?? 0) > 0.3 && Math.abs(car.speed) < 1.0) {
      this.stuck += dt;
      if (this.stuck > 5) return this.respawn('stuck');
    } else this.stuck = 0;
  }
}
