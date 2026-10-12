// ---------------------------------------------------------------------------
// AI RIVALS
//
// Rivals are kinematic racers that follow a solved speed profile:
//   1. racing line  — clips the apex, derived from the track's own banking
//   2. speed profile — vmax = sqrt(a_lat/κ) then a backward braking pass and a
//      forward traction pass, so they brake *before* corners like real racers
//   3. situational layers — zipper corridors, train clocks, traffic lanes,
//      the yard divider, overtaking moves, and human-enough mistakes
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG, clamp, damp } from './config.js';
import { Vehicle } from './ship.js';

const LAT_ACC = 26;      // m/s² cornering the AI is willing to commit to
const BRAKE_ACC = 36;

export function solveRacingLine(track) {
  const d = track.deck, n = d.n;
  const line = new Float32Array(n);
  const vmax = new Float32Array(n);
  const cap = new Float32Array(n);
  // racing line: bias toward the inside of the corner (bank sign tells us which way)
  for (let i = 0; i < n; i++) {
    const limit = d.hw[i] * 0.52;
    let e = d.tilt[i] * 52;
    // hug the middle of the wide deck (don't cut the zipper / traffic lanes)
    if (d.zone[i] === 'zipper' || d.zone[i] === 'traffic') e *= 0.25;
    line[i] = clamp(e, -limit, limit);
  }
  // curvature magnitude per sample
  for (let i = 0; i < n; i++) {
    const a = d.th[(i - 2 + n) % n], b = d.th[(i + 2) % n];
    let dth = b - a;
    if (dth > Math.PI) dth -= Math.PI * 2; else if (dth < -Math.PI) dth += Math.PI * 2;
    const k = Math.abs(dth) / (4 * d.ds);
    cap[i] = k > 1e-5 ? Math.sqrt(LAT_ACC / k) : 1e9;
  }
  // rivals drive a base-speed profile: hyperboost is the player's edge
  cap.set(cap.map((v) => Math.min(v, CONFIG.baseTopSpeed)));
  // backward braking pass + forward traction pass, twice for convergence
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      const limit = Math.sqrt(cap[j] * cap[j] + 2 * BRAKE_ACC * d.ds);
      cap[i] = Math.min(cap[i], limit);
    }
    for (let i = 0; i < n; i++) {
      const j = (i - 1 + n) % n;
      const limit = Math.sqrt(cap[j] * cap[j] + 2 * CONFIG.accel * 1.15 * d.ds);
      cap[i] = Math.min(cap[i], limit);
    }
  }
  vmax.set(cap);
  return { line, vmax };
}

export class RivalShip extends Vehicle {
  constructor(opts) {
    super(opts);
    this.profile = opts.profile;
    this.skill = opts.skill ?? 0.97;
    this.aggression = opts.aggression ?? 0.5;
    this.topMul = opts.topMul ?? 0.98;
    this.mistake = 0;
    this.mistakeT = 0;
    this.reactionLag = 0.15 + Math.random() * 0.25;
    this.lookahead = 0;
    this.autoThrottle = true;
    this.rubber = 0;
    this._t = 0;
  }

  reset(gridIndex = this.gridIndex) {
    super.reset(gridIndex);
    this.mistake = 0; this.mistakeT = 2 + Math.random() * 4;
    this._lapS = this.s;
  }

  /** kinematic drive; `world` carries hazards + rivals for situational awareness */
  update(dt, world) {
    const d = this.track.deck;
    const P = this.profile;
    this._t += dt;
    this.updateHull(dt);
    if (this.wrecked) return;
    if (this.respawnHold > 0) this.respawnHold -= dt;
    if (this.lifted && this.capture) return;   // riding the crane

    if (world.hold) {
      // engines lit, brakes on — nothing moves before the flag
      this.speed = 0;
      const hf = this.path.frame(this.s, this._f || (this._f = {}));
      this.pos.set(hf.x + hf.rx * this.e, hf.y + this.e * hf.tilt + CONFIG.hoverHeight + (this.bob || 0),
        hf.z + hf.rz * this.e);
      this.yaw = hf.th;
      this.syncMesh(dt);
      void world;
      return;
    }
    const path = this.path;
    const n = path.n;
    const cyclic = path.closed;
    const idx = path.idx(this.s);
    const dLen = path.closed ? path.length : path.length;

    // --- target speed from the solved profile ---
    let vTarget = P.vmax[idx % P.vmax.length];
    // personal top speed, and a straight-line surge when the deck is clear
    vTarget = Math.min(vTarget, CONFIG.baseTopSpeed * this.topMul);
    if (vTarget > 102 && this.path === d) {
      const zone = d.zone[idx];
      if (zone === 'normal' || zone === 'grid') vTarget *= 1.045;
    }
    vTarget *= 0.995 + this.skill * 0.01;
    if (this.path !== d) vTarget = Math.min(vTarget, 150);
    // rubber band: keep the pack near the player without being obvious
    vTarget *= 1 + clamp(this.rubber, -0.06, 0.08);
    // hazard-aware braking
    const brakeForTrain = world.hazards.trainBrake(this.s + 26, this.speed);
    if (brakeForTrain >= 1) vTarget = Math.min(vTarget, 34 + this.aggression * 18);
    else if (brakeForTrain > 0.4) vTarget *= 0.82;
    if (this.mistake > 0) vTarget *= this.mistake > 0.5 ? 0.82 : 0.93;
    if (this.path === d && d.zone[idx] === 'zipper') vTarget = Math.min(vTarget, 96 * this.skill);

    this.speed = damp(this.speed, vTarget, vTarget > this.speed ? 1.5 : 3.2, dt);
    this.speed = Math.max(12, this.speed);

    // --- lateral target ---
    const la = 22 + this.speed * 0.42;
    this.lookahead = la;
    const sLook = this.s + la;
    let targetE = this.lineAt(path, sLook);
    // zipper corridor
    const safe = world.hazards.safeLane(this.s + 16, this.e);
    if (safe != null) targetE = safe;
    // divider island
    const isl = this.track.island;
    if (this.path === d && this.s > isl.s0 - 60 && this.s < isl.s1 + 20) {
      targetE = (this.e >= 0 ? 1 : -1) * Math.max(11, Math.abs(targetE));
    }
    // traffic weaving
    for (const tv of world.hazards.traffic.vehicles) {
      let dsv = this.s - tv.s;
      if (dsv > dLen * 0.5) dsv -= dLen; else if (dsv < -dLen * 0.5) dsv += dLen;
      if (Math.abs(dsv) > 8 && Math.abs(dsv) < 34 && Math.abs(this.e - tv.e) < 5.4) {
        targetE += (this.e >= tv.e ? 1 : -1) * 5.2;
      }
    }
    // crane cones: don't volunteer
    for (const c of world.hazards.cranes) {
      if (Math.abs(this.s - c.s) < 30) {
        const cc = c.coneCenterE();
        if (Math.abs(this.e - cc) < c.coneHalf + 2) targetE += (this.e >= cc ? 1 : -1) * 7;
      }
    }
    // overtaking: if a rival is just ahead in the same lane, pull around it
    for (const other of world.vehicles) {
      if (other === this) continue;
      let dsv = other.s - this.s;
      if (cyclic) { if (dsv > dLen * 0.5) dsv -= dLen; else if (dsv < -dLen * 0.5) dsv += dLen; }
      if (dsv > 0 && dsv < 26 && Math.abs(other.e - this.e) < 4.5) {
        targetE += (this.e >= other.e ? 1 : -1) * (4.2 + this.aggression * 3);
      }
    }
    // mistakes: a wobble, a late reaction, a wide line
    this.mistakeT -= dt;
    if (this.mistakeT <= 0) {
      this.mistakeT = 5 + Math.random() * 9;
      this.mistake = Math.random() < (1 - this.skill) * 3 ? Math.random() : 0;
    }
    if (this.mistake > 0.5) targetE += Math.sin(this._t * 1.7) * 6 * this.mistake;
    const hwLimit = path.hw[idx] - 3.2;
    targetE = clamp(targetE, -hwLimit, hwLimit);

    // --- integrate along the surface ---
    const latRate = 15 + this.speed * 0.12;
    const prevE = this.e;
    this.e = damp(this.e, targetE, latRate / (1 + Math.abs(targetE - this.e) * 0.06), dt);
    const latVel = (this.e - prevE) / Math.max(1e-4, dt);
    this.latVel = latVel;

    const prevS = this.s;
    this.s += this.speed * dt;
    if (cyclic) {
      if (this.s >= path.length) this.s -= path.length;
    } else if (this.s > path.length - 1.5) {
      this.s = path.length - 1.5;
      world.onBranchEnd?.(this);
    }
    if (this.s < prevS && cyclic) world.onLap?.(this);

    const f = path.frame(this.s, this._f || (this._f = {}));
    this.deckY = f.y + this.e * f.tilt;
    this.pos.set(f.x + f.rx * this.e, this.deckY + CONFIG.hoverHeight + (this.bob || 0), f.z + f.rz * this.e);
    this.yaw = f.th - Math.atan2(latVel, Math.max(20, this.speed)) * 0.8;
    const targetRoll = -f.tilt * 1.6 - latVel * 0.014;
    const targetPitch = (vTarget > this.speed ? 0.05 : -0.04);
    this.roll = damp(this.roll, targetRoll, 6, dt);
    this.pitch = damp(this.pitch, targetPitch, 4, dt);
    this.syncMesh(dt);
    void n;
  }

  lineAt(path, s) {
    const P = this.profile;
    if (path === this.track.deck) {
      const i = this.track.deck.idx(s) % P.line.length;
      return P.line[i];
    }
    // branch: hug the centre
    return 0;
  }
}
