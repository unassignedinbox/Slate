// The racing line, authored like a track designer would: a turtle that drives
// straights, arcs and airborne gaps with explicit lengths, heights and banking.
// Everything drivable in the level is then built *onto* this line, so the line
// is also the ground truth for progress, respawns, splits, the autopilot and the
// designer overlay.
//
// Heading convention: psi = 0 drives +X; positive psi turns LEFT (towards -Z).
// Bank convention: positive bank lowers the RIGHT side (banked for right turns).
import * as THREE from 'three';
import { DEG, clamp } from './rng.js';

const DS = 0.5;

export class RouteBuilder {
  constructor({ start, heading = 0, width = 12, speed = 60 }) {
    this.p = new THREE.Vector3(...start);
    this.psi = heading * DEG;
    this.bank = 0;
    this.width = width;
    this.grade = 0;
    this.speed = speed;
    this.s = 0;
    this.samples = [];
    this.beats = [];
    this.marks = []; // named stations: { name, s }
    this.segs = [];
    this._beat = '';
    this._push('road', speed);
  }

  _push(surface, speed) {
    this.samples.push({
      s: this.s, p: this.p.clone(), psi: this.psi, grade: this.grade, bank: this.bank,
      width: this.width, surface, speed, beat: this._beat, seg: this.segs.length,
    });
  }

  beat(id, name) {
    if (this.beats.length) this.beats[this.beats.length - 1].s1 = this.s;
    this.beats.push({ id, name, s0: this.s, s1: this.s });
    this._beat = id;
    return this;
  }

  mark(name) { this.marks.push({ name, s: this.s }); return this; }

  /**
   * Generic segment. o: { y (absolute end height) | dy, turn (deg, +left), bank (deg at end),
   *  width, surface, speed (m/s cap), arc: 'parabola' for air gaps,
   *  on: { heightAt(x,z), bankAt(x,z,psi) } to lay the line exactly on a tilted surface }
   */
  seg(len, o = {}) {
    const n = Math.max(1, Math.round(len / DS));
    const ds = len / n;
    const y0 = this.p.y;
    const y1 = o.y !== undefined ? o.y : y0 + (o.dy || 0);
    const turn = (o.turn || 0) * DEG;
    const b0 = o.bank0 !== undefined ? o.bank0 * DEG : this.bank;
    const b1 = o.bank !== undefined ? o.bank * DEG : b0;
    const w0 = this.width, w1 = o.width ?? this.width;
    const surface = o.surface || 'road';
    const speed = o.speed ?? this.speed;
    const g0 = this.grade;
    const psi0 = this.psi;
    const segInfo = { i: this.segs.length, s0: this.s, s1: this.s + len, surface, beat: this._beat, len, turn: o.turn || 0, y0, y1, name: o.name || '' };
    for (let k = 1; k <= n; k++) {
      const u = k / n;
      const psiMid = psi0 + turn * (k - 0.5) / n;
      this.p.x += Math.cos(psiMid) * ds;
      this.p.z -= Math.sin(psiMid) * ds;
      let y;
      if (o.on) {
        // the line lies ON a (tilted) surface: height and banking come from it, per sample
        y = o.on.heightAt(this.p.x, this.p.z) + (o.lift || 0);
        this.grade = (y - this.p.y) / ds;
        this.p.y = y;
        this.psi = psi0 + turn * u;
        this.bank = o.on.bankAt(this.p.x, this.p.z, this.psi);
        this.width = w0 + (w1 - w0) * u;
        this.s += ds;
        this._push(surface, speed);
        continue;
      }
      if (o.arc === 'parabola') {
        // continue the launch slope, land on y1
        y = y0 + g0 * len * u + (y1 - y0 - g0 * len) * u * u;
        this.grade = g0 + 2 * (y1 - y0 - g0 * len) * u / len;
      } else if (o.ease) {
        const e = u * u * (3 - 2 * u);
        y = y0 + (y1 - y0) * e;
        this.grade = (y1 - y0) * 6 * u * (1 - u) / len;
      } else {
        y = y0 + (y1 - y0) * u;
        this.grade = (y1 - y0) / len;
      }
      this.p.y = y;
      this.psi = psi0 + turn * u;
      this.bank = b0 + (b1 - b0) * u;
      this.width = w0 + (w1 - w0) * u;
      this.s += ds;
      this._push(surface, speed);
    }
    segInfo.y1 = this.p.y;
    this.segs.push(segInfo);
    return this;
  }

  /** Horizontal end point of a straight of length len from the current pose. */
  ahead(len) { return { x: this.p.x + Math.cos(this.psi) * len, z: this.p.z - Math.sin(this.psi) * len }; }

  straight(len, o = {}) { return this.seg(len, o); }
  arc(len, turnDeg, o = {}) { return this.seg(len, { ...o, turn: turnDeg }); }
  gap(len, o = {}) { return this.seg(len, { arc: 'parabola', ...o, surface: 'air' }); }

  build() {
    if (this.beats.length) this.beats[this.beats.length - 1].s1 = this.s;
    return new Route(this.samples, this.beats, this.marks, this.segs);
  }
}

const _t = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();

export class Route {
  constructor(samples, beats, marks, segs) {
    this.samples = samples;
    this.beats = beats;
    this.marks = marks;
    this.segs = segs;
    this.length = samples[samples.length - 1].s;
    this.ds = samples.length > 1 ? samples[1].s - samples[0].s : DS;
    for (const sm of samples) Route.frame(sm.psi, sm.grade, sm.bank, sm);
    this.computeSpeedProfile();
  }

  static frame(psi, grade, bank, out) {
    out.t = new THREE.Vector3(Math.cos(psi), grade, -Math.sin(psi)).normalize();
    const rh = new THREE.Vector3(Math.sin(psi), 0, Math.cos(psi));
    const u0 = new THREE.Vector3().crossVectors(rh, out.t).normalize();
    out.u = u0.clone().multiplyScalar(Math.cos(bank)).addScaledVector(rh, Math.sin(bank));
    out.r = rh.clone().multiplyScalar(Math.cos(bank)).addScaledVector(u0, -Math.sin(bank));
    return out;
  }

  index(s) { return clamp(Math.round(s / this.ds), 0, this.samples.length - 1); }
  at(s) { return this.samples[this.index(s)]; }

  /** Interpolated position at s. */
  pos(s, out = new THREE.Vector3()) {
    const f = clamp(s / this.ds, 0, this.samples.length - 1);
    const i = Math.floor(f), j = Math.min(i + 1, this.samples.length - 1);
    return out.copy(this.samples[i].p).lerp(this.samples[j].p, f - i);
  }

  beatAt(s) {
    for (let i = this.beats.length - 1; i >= 0; i--) if (s >= this.beats[i].s0) return this.beats[i];
    return this.beats[0];
  }

  /** Closest route station to p, searched inside [sHint-back, sHint+fwd]. */
  nearest(p, sHint = null, back = 40, fwd = 80) {
    let i0 = 0, i1 = this.samples.length - 1;
    if (sHint !== null) { i0 = this.index(sHint - back); i1 = this.index(sHint + fwd); }
    let best = Infinity, bi = i0;
    for (let i = i0; i <= i1; i += 2) {
      const d = this.samples[i].p.distanceToSquared(p);
      if (d < best) { best = d; bi = i; }
    }
    for (let i = Math.max(0, bi - 3); i <= Math.min(this.samples.length - 1, bi + 3); i++) {
      const d = this.samples[i].p.distanceToSquared(p);
      if (d < best) { best = d; bi = i; }
    }
    return { s: this.samples[bi].s, dist: Math.sqrt(best), i: bi };
  }

  /** Curvature-limited speed with braking look-ahead; drives the autopilot + overlay. */
  computeSpeedProfile(aLat = 13.5, aBrake = 14, aAcc = 7) {
    const S = this.samples, n = S.length;
    const v = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = S[Math.max(0, i - 6)], b = S[Math.min(n - 1, i + 6)];
      let dpsi = b.psi - a.psi;
      const ds = Math.max(1e-3, b.s - a.s);
      const k = Math.abs(dpsi) / ds;
      const vc = k > 1e-5 ? Math.sqrt(aLat / k) : 999;
      v[i] = Math.min(S[i].speed, vc);
    }
    for (let i = n - 2; i >= 0; i--) v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * aBrake * (S[i + 1].s - S[i].s)));
    this.vmax = v;
    // nominal time along the line, assuming perfect accel from rest
    let vt = 0, t = 0;
    const tt = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      const ds = S[i].s - S[i - 1].s;
      vt = Math.min(v[i], Math.sqrt(vt * vt + 2 * aAcc * ds));
      t += ds / Math.max(vt, 1);
      tt[i] = t;
    }
    this.nominalTime = tt;
  }
}
