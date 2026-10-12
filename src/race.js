// ---------------------------------------------------------------------------
// RACE — session state machine: grid, countdown, laps, positions, results,
// and the cinematic showcase run.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG, clamp, formatTime } from './config.js';
import { PlayerShip } from './ship.js';
import { RivalShip, solveRacingLine } from './ai.js';

const RIVAL_SPECS = [
  { name: 'VYPER-09', color: 0xff3ec8, skill: 0.99, aggression: 0.7, topMul: 1.03 },
  { name: 'KOWLOON KR', color: 0xa6ff2e, skill: 0.965, aggression: 0.55, topMul: 0.995 },
  { name: 'AKIRA-7', color: 0xffb42e, skill: 0.94, aggression: 0.4, topMul: 0.965 },
  { name: 'NULLSET', color: 0x8f7dff, skill: 0.915, aggression: 0.3, topMul: 0.94 },
];

export class Race {
  constructor(opts) {
    this.scene = opts.scene;
    this.track = opts.track;
    this.hazards = opts.hazards;
    this.audio = opts.audio;
    this.hud = opts.hud;
    this.showcase = !!opts.showcase;

    this.profile = solveRacingLine(this.track);
    this.vehicles = [];
    this.time = 0;
    this.state = 'countdown';
    this.countdown = CONFIG.countdown;
    this.pulseCooldown = 0;
    this.pulseActive = 0;
    this.lastLapT = 0;
    this.captions = [];
    this.caption = null;
    this.player = null;
    this.finishOrder = [];
    this.started = false;
    this.messages = [];
    this._v = new THREE.Vector3();

    this.buildVehicles();
  }

  buildVehicles() {
    const { scene, track } = this;
    const rivals = CONFIG.rivals;
    for (let i = 0; i < rivals; i++) {
      const spec = RIVAL_SPECS[i % RIVAL_SPECS.length];
      const r = new RivalShip({
        scene, track, color: spec.color, name: spec.name, gridIndex: i + 1, racerIndex: i + 1,
        profile: this.profile, skill: spec.skill, aggression: spec.aggression, topMul: spec.topMul,
      });
      r.isPlayer = false;
      this.vehicles.push(r);
    }
    this.player = new PlayerShip({
      scene, track, color: 0x38f2ff, name: 'YOU', isPlayer: true, gridIndex: 0, racerIndex: 0,
    });
    this.player.autoThrottle = true;
    this.vehicles.unshift(this.player);
    // hooks
    for (const v of this.vehicles) {
      v.onSpark = (x, y, z, n, c) => this.hazards.sparks.burst(x, y, z, n, c);
      v.onCaption = (t, s) => this.caption = { title: t, sub: s, t: 2.6 };
      v.onWreck = () => { this.audio.tone('wreck', 0.6); };
    }
    this.player.onWallHit = () => this.audio.tone('scrape', 0.3);
    this.player.mesh.traverse((o) => { o.renderOrder = 2; });
  }

  get running() { return this.state === 'racing' || this.state === 'showcase'; }

  reset(toShowcase = false) {
    this.showcase = toShowcase;
    this.time = 0;
    this.state = toShowcase ? 'showcase' : 'countdown';
    this.countdown = CONFIG.countdown;
    this.finishOrder = [];
    this.pulseCooldown = 0;
    this.pulseActive = 0;
    this.caption = null;
    this.started = false;
    for (const v of this.vehicles) {
      v.reset(v.gridIndex);
      v.energy = 100;
    }
    this.player.mesh.visible = !toShowcase;
    this.trailVisible(!toShowcase);
  }

  trailVisible(v) {
    this.player.trailL.setVisible(v);
    this.player.trailR.setVisible(v);
  }

  // ---- progress helpers ----------------------------------------------------
  /** arc length of a craft along the *main* spine, folding branch sections in */
  effectiveS(v) {
    if (v.path === this.track.deck) return v.s;
    const br = v.path;
    const t = clamp(v.s / br.length, 0, 1);
    return br.s0World + t * (br.s1World - br.s0World);
  }

  totalProgress(v) { return v.lap * this.track.length + this.effectiveS(v); }

  onLap(v) {
    v.lap++;
    const now = this.time;
    const lapTime = now - v.lapStart;
    v.lapStart = now;
    v.lapTimes.push(lapTime);
    if (v.bestLap == null || lapTime < v.bestLap) v.bestLap = lapTime;
    v.lastLap = lapTime;
    if (v.lap >= CONFIG.laps && !v.finished) {
      v.finished = true;
      v.finishTime = now;
      this.finishOrder.push(v);
      if (v === this.player) {
        this.state = 'finished';
        this.audio.tone('finish', 0.6);
        this.player.onFinished?.();
        return;
      }
      v.place = this.finishOrder.length;
    } else if (v === this.player) {
      this.audio.tone('lap', 0.4);
      const left = CONFIG.laps - v.lap;
      this.caption = {
        title: left === 1 ? 'FINAL LAP' : `LAP ${v.lap + 1} / ${CONFIG.laps}`,
        sub: `sector ${formatTime(lapTime)}  ·  best ${formatTime(v.bestLap)}`,
        t: 2.4,
      };
    }
  }

  onBranchEnd(v) {
    if (v.path === this.track.deck) return;
    // rejoin the main deck after the flyover
    const T = this.track.anchors.tsplit;
    const s = T.s1 - 12;
    const e = clamp(v.e, -10, 10);
    if (v.teleport) v.teleport(this.track.deck, s, e);
    else {
      v.path = this.track.deck; v.s = s; v.e = e; v.lastS = s;
      const f = this.track.deck.frame(s, this._f || (this._f = {}));
      v.pos.set(f.x + f.rx * e, f.y + e * f.tilt + CONFIG.hoverHeight, f.z + f.rz * e);
      v.yaw = f.th;
      v._hint = this.track.deck.idx(s);
    }
  }

  /** player calls the PULSE teammate */
  callPulse() {
    if (this.pulseCooldown > 0 || !this.player) return false;
    const ok = this.hazards.pulse(this.player);
    if (ok) {
      this.pulseCooldown = 8.5;
      this.pulseActive = 2.6;
      this.audio.tone('pulse', 0.45);
      this.caption = { title: 'PULSE — PATTERN DRAWN', sub: 'teammate pulls the zipper into your lane', t: 2.2 };
    } else {
      this.caption = { title: 'PULSE — NO TARGET', sub: 'the zipper is out of range', t: 1.4 };
    }
    return ok;
  }

  positions() {
    const list = this.vehicles.slice().sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return this.totalProgress(b) - this.totalProgress(a);
    });
    list.forEach((v, i) => { if (!v.finished) v.place = i + 1; });
    return list;
  }

  update(dt, t, input) {
    const haz = this.hazards;
    // countdown
    if (this.state === 'countdown') {
      const prev = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== prev) {
        if (now >= 1 && now <= 3) this.audio.tone('count', 0.4);
        if (now === 0) { this.audio.tone('go', 0.5); this.state = 'racing'; }
      }
    }

    const released = this.state === 'racing' || this.state === 'showcase';
    // pre-start: hold ships on the grid but let them rev
    for (const v of this.vehicles) {
      v.prevS = v.s;
      v.rubber = 0;
    }
    // rubber band rivals around the player
    if (released && this.player) {
      const pp = this.totalProgress(this.player);
      for (const v of this.vehicles) {
        if (v === this.player) continue;
        const dp = this.totalProgress(v) - pp;
        v.rubber = clamp(-dp / 900, -0.06, 0.08);
      }
    }

    const world = {
      hazards: haz, vehicles: this.vehicles, hold: !released,
      onLap: (v) => this.onLap(v), onBranchEnd: (v) => this.onBranchEnd(v),
    };

    for (const v of this.vehicles) {
      if (v === this.player) {
        if (this.showcase) { v.update(dt, { steer: 0, throttle: 0, brake: 0, airL: 0, airR: 0, boost: 0 }, this); continue; }
        const inp = released ? input.read() : { steer: 0, throttle: 0, brake: 0, airL: 0, airR: 0, boost: 0 };
        v.update(dt, inp, this);
      } else {
        v.update(dt, world);
      }
      v.updateVisuals(dt, t);
    }

    if (released) {
      this.time += dt;
      this.pulseCooldown = Math.max(0, this.pulseCooldown - dt);
      this.pulseActive = Math.max(0, this.pulseActive - dt);
    }
    haz.update(dt, t, this.vehicles, this.player, this);

    if (this.caption) {
      this.caption.t -= dt;
      if (this.caption.t <= 0) this.caption = null;
    }
    this.positions();
  }

  /** results table data */
  results() {
    const list = this.positions();
    const playerP = this.player;
    const leadProg = Math.max(...list.map((v) => this.totalProgress(v)));
    return list.map((v) => {
      const prog = this.totalProgress(v);
      let gap = null;
      if (!v.finished) {
        const remaining = CONFIG.laps * this.track.length - prog;
        gap = remaining / Math.max(30, v.speed);
      }
      return {
        name: v.name,
        you: v === playerP,
        place: v.place,
        finished: v.finished,
        time: v.finishTime,
        gap,
        behind: (leadProg - prog),
        bestLap: v.bestLap,
        hull: v.hull,
      };
    });
  }
}
