import * as THREE from 'three';
import { hash, smoothstep as ss, clamp, lerp, noise1 } from './util.js';

const D = Math.PI / 180;
const EULER_ORDER = 'YXZ';

// ============================================================
// Pose = additive offsets from rest pose.
//   e: bone -> [x,y,z] euler offsets (radians)
//   p: bone -> [x,y,z] position offsets
//   s: scalars
// ============================================================
function newPose() {
  return { e: {}, p: {}, s: { height: 0, spread: 0.05, pspread: 0.6, tailFan: 0.25, mouth: 0, blink: 0, rustle: 0, scroll: 0, flutter: 0 } };
}
function addE(P, b, x, y, z, w = 1) {
  const a = P.e[b] || (P.e[b] = [0, 0, 0]);
  a[0] += x * w; a[1] += y * w; a[2] += z * w;
}
function addP(P, b, x, y, z, w = 1) {
  const a = P.p[b] || (P.p[b] = [0, 0, 0]);
  a[0] += x * w; a[1] += y * w; a[2] += z * w;
}
// mirrored wing/leg writers: right = given, left = (x, -y, -z)
function addWing(P, base, x, y, z, w = 1) {
  addE(P, base + 'R', x, y, z, w);
  addE(P, base + 'L', x, -y, -z, w);
}
function addLegs(P, base, x, w = 1, dx = 0) {
  addE(P, base + 'R', x + dx, 0, 0, w);
  addE(P, base + 'L', x - dx, 0, 0, w);
}

// ============================================================
// Low-level pose builders (write with weight w)
// ============================================================

// standing pose: upright perched posture
function applyStand(P, w, t, opts = {}) {
  const crouch = opts.crouch || 0;           // 0..1 extra crouch
  const pitch = opts.pitch !== undefined ? opts.pitch : -0.52;
  addE(P, 'body', pitch, 0, 0, w);
  P.s.height += (-0.095 - crouch * 0.075) * w;
  // legs compensate body pitch + stance bend (+ crouch)
  addLegs(P, 'thigh', -0.10 - pitch - crouch * 0.35, w);
  addLegs(P, 'shin', 1.02 + crouch * 0.55, w);
  addLegs(P, 'tarsus', -1.05 - crouch * 0.45, w);
  addLegs(P, 'foot', 0.13 + 0.25 * crouch, w);
  // neck curves back up so gaze is level
  addE(P, 'neckA', 0.34 - pitch * 0.55, 0, 0, w);
  addE(P, 'neckB', 0.10 - pitch * 0.35, 0, 0, w);
  addE(P, 'head', -0.28 - pitch * 0.28, 0, 0, w);
  // tail continues body line downward slightly
  addE(P, 'tail', 0.14, 0, 0, w);
  // wings folded
  applyWingFold(P, w);
  P.s.spread += 0.04 * w;
  P.s.tailFan += 0.18 * w;
}

function applyWingFold(P, w) {
  addWing(P, 'shoulder', -0.10, 1.20, -0.42, w);
  addWing(P, 'elbow', 0.12, -2.50, 0.05, w);
  addWing(P, 'wrist', -0.06, 2.42, 0.05, w);
}

// airborne pose. phase = flap phase (rad), amp = flap amplitude 0..1
// legTuck 0 = dangling, 1 = tucked
function applyAir(P, w, t, { phase = 0, amp = 1, legTuck = 1, pitch = 0, dihedral = 0.10 } = {}) {
  // --- wing beat waveform (asymmetric: fast/strong downstroke) ---
  const skew = Math.sin(phase + 0.45 * Math.sin(phase));    // skewed sine
  const elev = dihedral + amp * 0.78 * skew;
  const downFactor = clamp(-Math.cos(phase + 0.45 * Math.sin(phase)), -1, 1); // +1 mid-downstroke
  // wing folds slightly on upstroke
  const upFold = amp * 0.55 * Math.pow(Math.max(0, Math.sin(phase - 1.85)), 1.4);
  // twist: leading edge pitches down during downstroke
  const twist = amp * 0.28 * Math.max(0, downFactor);
  const wristTwist = amp * 0.38 * Math.max(0, downFactor);

  addWing(P, 'shoulder', twist * 0.5, 0.06 + upFold * 0.25, elev, w);
  addWing(P, 'elbow', twist * 0.4, -upFold * 0.85, elev * 0.28, w);
  addWing(P, 'wrist', wristTwist * 0.5, upFold * 1.15, elev * 0.16, w);

  addE(P, 'body', pitch + amp * 0.05 * Math.sin(phase - 2.3), 0, 0, w);
  addP(P, 'body', 0, amp * 0.030 * Math.sin(phase - 2.1), 0, w);

  // neck stretched forward, head stabilized
  addE(P, 'neckA', -0.30, 0, 0, w);
  addE(P, 'neckB', -0.12, 0, 0, w);
  addE(P, 'head', 0.38 - pitch * 0.5 - amp * 0.04 * Math.sin(phase - 2.1), 0, 0, w);

  // legs
  const tk = legTuck;
  addLegs(P, 'thigh', lerp(-0.55, 1.05, tk), w);
  addLegs(P, 'shin', lerp(0.45, 0.25, tk), w);
  addLegs(P, 'tarsus', lerp(-0.25, 0.35, tk), w);
  addLegs(P, 'foot', lerp(0.3, 1.5, tk), w);
  addP(P, 'thighR', 0, 0.030 * tk, -0.015 * tk, w);
  addP(P, 'thighL', 0, 0.030 * tk, -0.015 * tk, w);
  // toes curled when tucked
  for (const sd of ['R', 'L']) for (let i = 0; i < 4; i++)
    addE(P, `toe${i}${sd}`, tk * 0.9 * (i === 3 ? -1 : 1), 0, 0, w);

  addE(P, 'tail', -0.06, 0, 0, w);
  P.s.spread += 1.0 * w;
  P.s.pspread += (0.55 + 0.45 * Math.max(0, downFactor)) * w;
  P.s.tailFan += 0.42 * w;
}

// ============================================================
export class Animator {
  constructor(eagle) {
    this.eagle = eagle;
    this.rest = {};
    for (const [name, b] of Object.entries(eagle.bones)) {
      this.rest[name] = { p: b.position.clone(), q: b.quaternion.clone() };
    }
    this.time = 0;
    this.flapPhase = 0;
    this.flapFreq = 2.5;             // Hz — large raptor wingbeat
    this.state = 'idle';
    this.grounded = true;
    this.weights = { idle: 1, walk: 0, flight: 0, glide: 0, takeoff: 0, landing: 0 };
    this.oneshot = null;             // {name, t, dur}
    this.screech = -10;              // time screech started
    this.speed = 1;
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._scratch = newPose();
    this.onGroundScroll = null;      // callback(speed m/s)
    this.listeners = [];
  }

  // -------- public controls --------
  request(name) {
    if (name === this.state && !this.oneshot) return;
    if (name === 'takeoff') { if (this.grounded) this._startOneshot('takeoff'); return; }
    if (name === 'landing') { if (!this.grounded) this._startOneshot('landing'); return; }
    const airStates = ['flight', 'glide'];
    if (airStates.includes(name) && this.grounded) {
      this._pending = name;
      this._startOneshot('takeoff');
      return;
    }
    if (!airStates.includes(name) && !this.grounded) {
      this._pending = name;
      this._startOneshot('landing');
      return;
    }
    this.state = name;
    this._notify();
  }
  doScreech() { this.screech = this.time; }
  _startOneshot(name) {
    this.oneshot = { name, t: 0, dur: name === 'takeoff' ? 2.5 : 3.0 };
    this.state = name;
    this._notify();
  }
  _notify() { for (const f of this.listeners) f(this.state); }

  // -------- state evaluators --------
  evalIdle(P, w, t) {
    // micro-behaviors: breathing, head scan, weight shift, tail flick
    const k = Math.floor(t / 2.6);
    const f = t / 2.6 - k;
    const yawT = (kk) => (hash(kk * 7.1) - 0.5) * 1.7;
    const pitT = (kk) => (hash(kk * 3.7 + 5) - 0.5) * 0.55;
    const blendIn = ss(0, 0.09, f);
    const hy = lerp(yawT(k - 1), yawT(k), blendIn);
    const hp = lerp(pitT(k - 1), pitT(k), blendIn);
    applyStand(P, w, t);
    addE(P, 'head', hp * 0.55, hy * 0.7, 0, w);
    addE(P, 'neckB', hp * 0.3, hy * 0.3, 0, w);
    // breathing
    addP(P, 'body', 0, 0.004 * Math.sin(t * 2.2), 0, w);
    // slow weight shift
    const shift = noise1(t * 0.17, 3) * 0.5;
    addP(P, 'body', 0.010 * shift, 0, 0, w);
    addE(P, 'body', 0, 0, 0.05 * shift, w);
    // occasional tail flick
    const tk = Math.floor(t / 7.3);
    if (hash(tk * 11.3) > 0.45) {
      const tf = t / 7.3 - tk;
      const pulse = Math.max(0, Math.sin(clamp((tf - 0.4) * 12, 0, Math.PI)));
      addE(P, 'tail', -0.14 * pulse, 0.1 * pulse * (hash(tk) - 0.5), 0, w);
    }
    // occasional rouse (feather shake)
    const rk = Math.floor(t / 13);
    if (hash(rk * 5.7) > 0.55) {
      const rf = t / 13 - rk;
      if (rf > 0.3 && rf < 0.46) P.s.rustle += w * Math.sin((rf - 0.3) / 0.16 * Math.PI);
    }
    // blink
    const bk = Math.floor(t / 3.1);
    if (hash(bk * 3.3) > 0.25) {
      const bf = t / 3.1 - bk;
      if (bf > 0.5 && bf < 0.58) P.s.blink += w * Math.sin((bf - 0.5) / 0.08 * Math.PI);
    }
  }

  evalWalk(P, w, t) {
    const g = t * 2 * Math.PI * 1.15;           // gait phase
    applyStand(P, w, t, { pitch: -0.42, crouch: 0.12 });
    // legs alternate
    for (const [sd, ph] of [['R', 0], ['L', Math.PI]]) {
      const p = g + ph;
      const swing = Math.sin(p);
      const liftW = Math.pow(Math.max(0, Math.sin(p + 0.5)), 1.5);
      addE(P, 'thigh' + sd, -swing * 0.42, 0, 0, w);
      addE(P, 'shin' + sd, liftW * 0.75, 0, 0, w);
      addE(P, 'tarsus' + sd, -liftW * 0.85, 0, 0, w);
      addE(P, 'foot' + sd, liftW * 0.55, 0, 0, w);
      for (let i = 0; i < 3; i++) addE(P, `toe${i}${sd}`, liftW * 0.5, 0, 0, w);
    }
    // body: waddle roll + bob, slight yaw
    addE(P, 'body', 0, 0.045 * Math.sin(g), 0.085 * Math.sin(g), w);
    addP(P, 'body', 0.014 * Math.sin(g), 0.012 * Math.abs(Math.cos(g)), 0, w);
    // characteristic head-bob: thrust each step
    const bob = Math.pow(Math.max(0, Math.sin(2 * g + 0.8)), 2);
    addE(P, 'neckA', -0.16 * bob, 0, 0, w);
    addE(P, 'neckB', 0.10 * bob, 0, 0, w);
    addE(P, 'head', 0.06 * bob, 0, 0, w);
    addP(P, 'neckA', 0, 0, 0.012 * bob, w);
    addE(P, 'tail', 0.05 * Math.sin(g), 0.06 * Math.sin(g), 0, w);
    P.s.scroll += 0.30 * w;
    // blink
    const bk = Math.floor(t / 2.9);
    if (hash(bk * 3.9) > 0.3) {
      const bf = t / 2.9 - bk;
      if (bf > 0.5 && bf < 0.57) P.s.blink += w * Math.sin((bf - 0.5) / 0.07 * Math.PI);
    }
  }

  evalFlight(P, w, t) {
    applyAir(P, w, t, { phase: this.flapPhase, amp: 1, legTuck: 1, pitch: 0.02 });
    P.s.height += 1.50 * w;
    P.s.scroll += 7.0 * w;
    P.s.flutter += 0.25 * w;
    const bk = Math.floor(t / 4.1);
    if (hash(bk * 2.3) > 0.4) {
      const bf = t / 4.1 - bk;
      if (bf > 0.5 && bf < 0.56) P.s.blink += w * Math.sin((bf - 0.5) / 0.06 * Math.PI);
    }
  }

  evalGlide(P, w, t) {
    applyAir(P, w, t, { phase: 0, amp: 0, legTuck: 1, pitch: 0.05, dihedral: 0.14 });
    // slow soaring wander: gentle banking + wing trim
    const bank = noise1(t * 0.22, 7) * 0.16;
    addE(P, 'body', noise1(t * 0.3, 11) * 0.04, 0, bank, w);
    addE(P, 'tail', noise1(t * 0.35, 13) * 0.05, -bank * 0.4, bank * 0.3, w);
    addWing(P, 'shoulder', 0, 0, noise1(t * 0.5, 17) * 0.035, w);
    addWing(P, 'wrist', 0, noise1(t * 0.6, 19) * 0.05, 0, w);
    // head hunts for prey below
    const k = Math.floor(t / 3.2), f = t / 3.2 - k;
    const hy = lerp((hash(k * 9.1) - 0.5) * 1.5, (hash((k + 1) * 9.1) - 0.5) * 1.5, ss(0, 0.1, f));
    addE(P, 'head', 0.35, hy * 0.6, 0, w);
    addE(P, 'neckB', 0.08, hy * 0.25, 0, w);
    P.s.height += 1.60 * w;
    P.s.scroll += 9.0 * w;
    P.s.flutter += 1.0 * w;
    P.s.tailFan += 0.30 * w;   // broader fan while soaring
  }

  evalTakeoff(P, w, t, u) {
    // u: 0..1 through the 2.5 s takeoff
    const crouchK = ss(0, 0.24, u) * (1 - ss(0.30, 0.46, u));
    const launch = ss(0.30, 0.48, u);
    const climb = ss(0.48, 1.0, u);
    const wingOpen = ss(0.10, 0.34, u);
    const legTuck = ss(0.60, 0.92, u);
    // scripted flap: 3.2 beats after launch begins
    const phase = Math.max(0, u - 0.26) * 3.2 * 2 * Math.PI / 0.74 - 1.9;
    this._takeoffPhase = phase;

    const standW = w * (1 - wingOpen);
    const airW = w * wingOpen;
    if (standW > 0.001) applyStand(P, standW / Math.max(w, 1e-6) * w, t, { crouch: crouchK * 0.9 });
    if (airW > 0.001) {
      applyAir(P, airW, t, {
        phase, amp: 0.7 + 0.3 * launch,
        legTuck, pitch: 0.42 * launch * (1 - climb * 0.9) - 0.55 * (1 - launch),
      });
    }
    // height: crouch dip -> leap -> climb
    const h = -0.115 * (1 - wingOpen) - 0.075 * crouchK
      + launch * 0.50 + climb * 1.00;
    P.s.height += h * w;
    P.s.tailFan += 0.5 * launch * w;
    P.s.scroll += (launch * 2 + climb * 5) * w;
    if (u > 0.2 && u < 0.5) P.s.mouth += w * Math.sin((u - 0.2) / 0.3 * Math.PI) * 0.5; // cry on launch
  }

  evalLanding(P, w, t, u) {
    // u: 0..1 through the 3.0 s landing
    const flare = ss(0.10, 0.45, u);           // pitch up, legs deploy
    const touchdown = ss(0.72, 0.80, u);       // feet meet ground
    const settle = ss(0.80, 1.0, u);           // fold wings, stand up
    // 2.4 slow braking beats
    const phase = u * 2.4 * 2 * Math.PI - 0.8;
    this._landingPhase = phase;

    const airW = w * (1 - settle);
    const standW = w * settle;
    if (airW > 0.001) {
      applyAir(P, airW, t, {
        phase, amp: (0.55 + 0.45 * flare) * (1 - touchdown),
        legTuck: 1 - flare,                    // legs reach forward
        pitch: -0.72 * flare * (1 - settle),   // strong nose-up flare
        dihedral: 0.12 + 0.45 * flare * (1 - touchdown),
      });
      // legs reach forward-down for the perch
      addLegs(P, 'thigh', -0.85 * flare * (1 - settle), airW);
      addLegs(P, 'tarsus', -0.35 * flare * (1 - settle), airW);
      for (const sd of ['R', 'L']) for (let i = 0; i < 3; i++)
        addE(P, `toe${i}${sd}`, -0.35 * flare * (1 - touchdown), 0, 0, airW);
      // tail fans hard down as an airbrake
      addE(P, 'tail', 0.55 * flare * (1 - settle), 0, 0, airW);
    }
    if (standW > 0.001) {
      const absorb = Math.max(0, Math.sin(clamp((u - 0.78) * 9, 0, Math.PI))) * 0.8;
      applyStand(P, standW, t, { crouch: absorb });
    }
    // height: descend, flare-brake, touch
    const h = 1.50 * (1 - ss(0.0, 0.72, u)) - 0.095 * settle
      - 0.06 * Math.max(0, Math.sin(clamp((u - 0.76) * 10, 0, Math.PI)));
    P.s.height += h * w;
    P.s.tailFan += (0.55 * flare * (1 - settle)) * w;
    P.s.spread += 0; // applyAir/applyStand already blend spread
    P.s.scroll += (6 * (1 - flare) + 1.2 * (1 - touchdown)) * w;
  }

  // -------- main update --------
  update(dt) {
    dt *= this.speed;
    this.time += dt;
    const t = this.time;
    this.flapPhase += dt * 2 * Math.PI * this.flapFreq *
      (this.weights.flight > 0.02 || this.state === 'flight' ? 1 : 0.2);

    // one-shot bookkeeping
    if (this.oneshot) {
      this.oneshot.t += dt;
      if (this.oneshot.t >= this.oneshot.dur) {
        const finished = this.oneshot.name;
        this.oneshot = null;
        if (finished === 'takeoff') {
          this.grounded = false;
          this.flapPhase = this._takeoffPhase || 0;
          this.state = (this._pending && ['flight', 'glide'].includes(this._pending)) ? this._pending : 'flight';
        } else {
          this.grounded = true;
          this.state = (this._pending && ['idle', 'walk'].includes(this._pending)) ? this._pending : 'idle';
        }
        this._pending = null;
        this._notify();
      }
    }

    // weight transitions
    const rate = clamp(dt * 3.2, 0, 1);
    let sum = 0;
    for (const k of Object.keys(this.weights)) {
      const target = this.state === k ? 1 : 0;
      this.weights[k] += (target - this.weights[k]) * rate;
      if (this.weights[k] < 0.003) this.weights[k] = 0;
      sum += this.weights[k];
    }
    for (const k of Object.keys(this.weights)) this.weights[k] /= sum;

    // ----- evaluate & blend -----
    const P = newPose();
    // zero scalars (they accumulate weighted)
    P.s = { height: 0, spread: 0, pspread: 0, tailFan: 0, mouth: 0, blink: 0, rustle: 0, scroll: 0, flutter: 0 };
    const W = this.weights;
    if (W.idle > 0) this.evalIdle(P, W.idle, t);
    if (W.walk > 0) this.evalWalk(P, W.walk, t);
    if (W.flight > 0) this.evalFlight(P, W.flight, t);
    if (W.glide > 0) this.evalGlide(P, W.glide, t);
    if (W.takeoff > 0 && this.oneshot?.name === 'takeoff')
      this.evalTakeoff(P, W.takeoff, t, clamp(this.oneshot.t / this.oneshot.dur, 0, 1));
    if (W.landing > 0 && this.oneshot?.name === 'landing')
      this.evalLanding(P, W.landing, t, clamp(this.oneshot.t / this.oneshot.dur, 0, 1));

    // screech overlay (any state)
    const sc = t - this.screech;
    if (sc > 0 && sc < 1.4) {
      const open = ss(0, 0.15, sc) * (1 - ss(0.9, 1.3, sc));
      P.s.mouth += open;
      addE(P, 'head', -0.30 * open, 0, 0, 1);
      addE(P, 'neckB', -0.12 * open, 0, 0, 1);
    }

    this.apply(P, t);
    return P;
  }

  apply(P, t) {
    const { bones, feathers, parts } = this.eagle;
    // bones
    for (const [name, b] of Object.entries(bones)) {
      const rest = this.rest[name];
      if (!rest) continue;
      const e = P.e[name];
      if (e) {
        this._e.set(e[0], e[1], e[2], EULER_ORDER);
        this._q.setFromEuler(this._e);
        b.quaternion.copy(rest.q).multiply(this._q);
      } else {
        b.quaternion.copy(rest.q);
      }
      const p = P.p[name];
      if (p) b.position.set(rest.p.x + p[0], rest.p.y + p[1], rest.p.z + p[2]);
      else b.position.copy(rest.p);
    }
    // jaw from mouth scalar
    bones.jaw.rotation.x = P.s.mouth * 0.5;
    // root height
    bones.root.position.y = P.s.height;

    // ----- feathers -----
    const spread = clamp(P.s.spread, 0, 1);
    const flut = P.s.flutter;
    for (const f of feathers.wing) {
      let sp = spread;
      if (f.group === 'P') {
        // primaries: extra separation during downstroke / glide
        sp = clamp(spread * (0.72 + 0.28 * P.s.pspread), 0, 1);
      }
      f.tmpQ.copy(f.foldQ).slerp(f.spreadQ, sp);
      if (flut > 0.02 && (f.group === 'P' || f.group === 'S')) {
        const a = flut * (f.group === 'P' ? 0.045 : 0.02);
        f.flutterE.set(
          Math.sin(t * 9 + f.phase) * a,
          0,
          Math.sin(t * 7.3 + f.phase * 1.7) * a * 0.6);
        this._q.setFromEuler(f.flutterE);
        f.tmpQ.multiply(this._q);
      }
      if (P.s.rustle > 0.02) {
        f.flutterE.set(Math.sin(t * 33 + f.phase) * 0.05 * P.s.rustle, 0, 0);
        this._q.setFromEuler(f.flutterE);
        f.tmpQ.multiply(this._q);
      }
      f.mesh.quaternion.copy(f.tmpQ);
    }
    // tail fan
    const fan = clamp(P.s.tailFan, 0, 1);
    for (const f of feathers.tail) {
      const yawSpace = (1.6 + 7.4 * fan) * D;
      const jit = (hash(f.idx * 17.3) - 0.5) * 0.05;
      f.flutterE.set(
        0.05 + jit + Math.abs(f.k) * (0.004 + 0.016 * fan) + (flut > 0.02 ? Math.sin(t * 8 + f.phase) * 0.02 * flut : 0),
        Math.PI + f.k * yawSpace,
        -Math.sign(f.k) * 0.10 * (1 - fan * 0.5),
        EULER_ORDER);
      f.mesh.quaternion.setFromEuler(f.flutterE);
    }
    // body feathers: breeze + rustle
    const rustle = P.s.rustle;
    if (this._bodyIdle === undefined) this._bodyIdle = 0;
    const breeze = 0.012;
    for (let i = 0; i < feathers.body.length; i++) {
      const f = feathers.body[i];
      if (rustle > 0.02) {
        f.mesh.quaternion.copy(f.baseQ);
        this._e.set(Math.sin(t * 34 + f.phase) * 0.10 * rustle, 0, Math.sin(t * 29 + f.phase) * 0.06 * rustle);
        this._q.setFromEuler(this._e);
        f.mesh.quaternion.multiply(this._q);
      } else if (i % 3 === 0) { // cheap breeze on a third of them
        f.mesh.quaternion.copy(f.baseQ);
        this._e.set(Math.sin(t * 2.1 + f.phase) * breeze, 0, 0);
        this._q.setFromEuler(this._e);
        f.mesh.quaternion.multiply(this._q);
      } else {
        f.mesh.quaternion.copy(f.baseQ);
      }
    }
    // blink
    const blink = clamp(P.s.blink, 0, 1);
    for (const eye of parts.eyes) eye.scale.setScalar(1).setY(1 - 0.9 * blink);

    if (this.onGroundScroll) this.onGroundScroll(P.s.scroll);
  }
}
