/* anim.js — locomotion + secondary motion for the T. rex rig.
 *
 * Legs are solved with analytic 3-segment IK against a world-anchored foot
 * trajectory, so planted feet never slide: the body moves over the foot rather
 * than the foot being swept under the body.
 *
 * The tail and neck are driven by a delay-line + critically-damped spring
 * chain: each vertebra reacts to what the pelvis did a few milliseconds ago,
 * which produces the travelling wave / overshoot / settle behaviour you see in
 * real animal tails instead of a rigid sine.
 */
import * as THREE from 'three';
import { lerp, clamp, smooth } from './boneKit.js';
import { DIM } from './skeleton.js';

const TAU = Math.PI * 2;

/* Critically damped spring toward a target (Game Programming Gems style). */
class Spring {
  constructor(omega = 14) { this.x = 0; this.v = 0; this.w = omega; }
  step(target, dt) {
    const w = this.w, f = 1 + 2 * dt * w, oo = w * w, hoo = dt * oo, hhoo = dt * hoo;
    const det = 1 / (f + hhoo);
    this.x = (f * this.x + dt * this.v + hhoo * target) * det;
    this.v = (this.v + hoo * (target - this.x)) * det;
    return this.x;
  }
}

/* Fixed-step delay line for propagating motion down a chain. */
class DelayLine {
  constructor(size = 256) { this.buf = new Float32Array(size); this.i = 0; this.n = size; this.dt = 1 / 120; }
  push(v) { this.i = (this.i + 1) % this.n; this.buf[this.i] = v; }
  sample(delaySec) {
    const s = clamp(delaySec / this.dt, 0, this.n - 2);
    const i0 = Math.floor(s), f = s - i0;
    const a = this.buf[(this.i - i0 + this.n * 2) % this.n];
    const b = this.buf[(this.i - i0 - 1 + this.n * 2) % this.n];
    return lerp(a, b, f);
  }
}

/* Non-slip constraint: during stance the planted foot is fixed in the world, so
 * the body must advance exactly one stride per stance phase:
 *      speed = stride * freq / duty
 * Every entry below satisfies it. Duty stays above 0.5 in both gaits — an adult
 * T. rex never had an aerial phase, it just took faster, longer steps.  */
const gait = (speed, freq, duty, extra) =>
  ({ speed, freq, duty, stride: speed * duty / freq, ...extra });

export const GAITS = {
  idle: { speed: 0, freq: 0, stride: 0, duty: 1, lift: 0, bob: 0.010, pitch: 0.0 },
  walk: gait(1.60, 0.45, 0.62, { lift: 0.40, bob: 0.055, pitch: 0.018 }),   // stride 2.20 m
  run:  gait(4.60, 0.95, 0.54, { lift: 0.62, bob: 0.105, pitch: 0.050 }),   // stride 2.61 m
};

export class RexAnimator {
  constructor(rig) {
    this.rig = rig;
    this.t = 0;
    this.phase = 0;
    this.gait = 'idle';
    this.blend = { walk: 0, run: 0 };     // 0..1 weights, cross-faded
    this.speedScale = 1.0;
    this.distance = 0;
    this.heading = 0;

    // secondary-motion state
    this.tailYawLine = new DelayLine();
    this.tailPitchLine = new DelayLine();
    this.neckLine = new DelayLine();
    this.accum = 0;

    this.tailSprings = rig.joints.caudals.map((_, i) => ({ y: new Spring(lerp(20, 7, i / 39)), z: new Spring(lerp(22, 8, i / 39)) }));
    this.neckSprings = rig.joints.cervicals.map((_, i) => ({ y: new Spring(lerp(18, 12, i / 9)), z: new Spring(lerp(18, 12, i / 9)) }));
    this.headSpring = { y: new Spring(13), z: new Spring(13) };
    this.jawSpring = new Spring(26);
    this.pelvisSprings = { y: new Spring(18), roll: new Spring(16), pitch: new Spring(14), yaw: new Spring(15) };

    // one-shot actions
    this.action = null;        // {name, t, dur}
    this.actionQueue = [];

    // cached rest rotations so additive animation never drifts
    this.rest = new Map();
    const remember = (o) => this.rest.set(o, o.rotation.clone());
    rig.joints.caudals.forEach(remember);
    rig.joints.cervicals.forEach(remember);
    rig.joints.dorsals.forEach(remember);
    remember(rig.joints.skull); remember(rig.joints.jaw); remember(rig.joints.pelvis);
    for (const k of ['armL', 'armR']) for (const j of Object.values(rig.joints[k])) remember(j);

    this.footPhase = { L: 0.0, R: 0.5 };
    this.legState = { L: {}, R: {} };
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  setGait(g) { this.gait = g; }
  trigger(name) { this.actionQueue.push(name); }

  get params() {
    // blend between gaits for smooth transitions
    const target = GAITS[this.gait];
    if (!this._p) this._p = { ...GAITS.idle, speed: 0, freq: 0, stride: 0, duty: 1, lift: 0, bob: 0.01, pitch: 0 };
    return this._p;
  }

  update(dt) {
    dt = Math.min(dt, 1 / 30);
    this.t += dt;
    const rig = this.rig;

    /* ---------- gait parameter blending ---------- */
    const tgt = GAITS[this.gait];
    const p = this.params;
    const k = 1 - Math.exp(-dt * 2.6);
    for (const key of ['speed', 'freq', 'stride', 'duty', 'lift', 'bob', 'pitch']) p[key] += (tgt[key] - p[key]) * k;
    const moving = p.freq > 0.02;

    /* ---------- one-shot actions ---------- */
    if (!this.action && this.actionQueue.length) {
      const name = this.actionQueue.shift();
      this.action = { name, t: 0, dur: name === 'roar' ? 4.2 : name === 'sniff' ? 5.0 : 2.0 };
    }
    let act = { jaw: 0, headPitch: 0, headYaw: 0, neckCurl: 0, neckRaise: 0, bodyPitch: 0, bodyPush: 0, shake: 0, breathe: 1, headRoll: 0 };
    if (this.action) {
      this.action.t += dt;
      const u = this.action.t / this.action.dur;
      if (u >= 1) this.action = null;
      else if (this.action.name === 'roar') act = { ...act, ...this.roarPose(u) };
      else if (this.action.name === 'sniff') act = { ...act, ...this.sniffPose(u) };
    }

    /* ---------- stride phase & forward travel ---------- */
    this.phase = (this.phase + p.freq * dt) % 1;
    const travel = p.speed * dt;
    this.distance += travel;
    rig.root.position.x += Math.cos(this.heading) * travel;
    rig.root.position.z -= Math.sin(this.heading) * travel;
    rig.root.rotation.y = this.heading;

    /* ---------- pelvis / body carriage ---------- */
    const ph = this.phase * TAU;
    const breathe = Math.sin(this.t * (moving ? 1.6 : 0.62)) * (moving ? 0.006 : 0.012) * act.breathe;
    const gaitAmp = clamp(p.freq / GAITS.walk.freq, 0, 2);   // silences gait sway at idle
    const bobRaw = -Math.cos(2 * ph) * p.bob * gaitAmp + breathe;
    const rollRaw = Math.sin(ph) * (0.035 + 0.055 * (p.speed / 6.2)) * gaitAmp;
    const yawRaw = Math.sin(ph + 0.9) * (0.030 + 0.055 * (p.speed / 6.2)) * gaitAmp;
    const pitchRaw = -p.pitch - Math.sin(2 * ph + 0.6) * p.pitch * 0.55 * gaitAmp + act.bodyPitch;

    const body = rig.body, pelvis = rig.joints.pelvis;
    const bob = this.pelvisSprings.y.step(bobRaw, dt);
    const roll = this.pelvisSprings.roll.step(rollRaw, dt);
    const yaw = this.pelvisSprings.yaw.step(yawRaw, dt);
    const pitch = this.pelvisSprings.pitch.step(pitchRaw, dt);
    body.position.y = DIM.hipHeight + bob + act.bodyPush * 0.05;
    body.position.x = act.bodyPush * -0.35;
    const rp = this.rest.get(pelvis);
    pelvis.rotation.set(roll * 0.9, yaw, pitch + rp.z);

    /* ---------- legs: world-anchored foot trajectory + 3-segment IK ---------- */
    for (const side of ['L', 'R']) {
      const leg = rig.joints[side === 'L' ? 'legL' : 'legR'];
      const off = side === 'L' ? 0 : 0.5;
      const ph2 = (this.phase + off) % 1;
      this.solveLeg(leg, ph2, p, dt, side);
    }

    /* ---------- tail: delay-line travelling wave + gait sway + droop ---------- */
    const tailDriveYaw = yaw * 1.0 + Math.sin(ph + 1.5) * (0.022 + 0.052 * (p.speed / 6.2)) * gaitAmp
      + Math.sin(this.t * 0.31) * 0.004;   // idle: a barely-there drift, never a static bend
    const tailDrivePitch = -bob * 0.55 + Math.sin(2 * ph + 1.2) * (0.006 + 0.020 * (p.speed / 6.2)) * gaitAmp;
    this.accum += dt;
    while (this.accum >= 1 / 120) {
      this.accum -= 1 / 120;
      this.tailYawLine.push(tailDriveYaw);
      this.tailPitchLine.push(tailDrivePitch);
      this.neckLine.push(yaw);
    }

    const caud = rig.joints.caudals;
    for (let i = 0; i < caud.length; i++) {
      const t = i / (caud.length - 1);
      const lag = 0.035 + t * 0.62;                       // wave travels tip-ward
      const gain = (0.05 + 0.20 * Math.pow(t, 0.7)) * (1 - 0.30 * t);   // summed over 40 joints this is a gentle S, not a whip
      const yTarget = -this.tailYawLine.sample(lag) * gain;
      const droop = 0.0042 * Math.pow(t, 1.4) * (1 - 0.55 * smooth(clamp(p.speed / 5, 0, 1)));
      const zTarget = this.tailPitchLine.sample(lag * 0.8) * gain * 1.25
        + Math.sin(this.t * 1.1 + t * 3.0) * 0.0022 * t          // idle micro-life
        - droop;                                                 // gravity sag, straightens at speed
      const s = this.tailSprings[i], rr = this.rest.get(caud[i]);
      caud[i].rotation.y = rr.y + s.y.step(yTarget, dt);
      caud[i].rotation.z = rr.z + s.z.step(zTarget, dt);
    }

    /* ---------- neck: counter-rotate to stabilise the skull (gaze fixation) ---------- */
    const cerv = rig.joints.cervicals;
    for (let i = 0; i < cerv.length; i++) {
      const t = i / (cerv.length - 1);
      const lag = 0.018 + t * 0.075;
      const counter = -this.neckLine.sample(lag) * lerp(0.18, 0.55, t);
      const bobComp = -bob * lerp(0.25, 0.9, t) * 1.4;
      const gaitBounce = Math.sin(2 * ph - 0.8) * (0.004 + 0.016 * (p.speed / 6.2)) * lerp(0.4, 1.2, t);
      const rr = this.rest.get(cerv[i]);
      const s = this.neckSprings[i];
      const curl = act.neckCurl * lerp(0.3, 1.0, t) + act.neckRaise * lerp(1.0, 0.25, t);
      cerv[i].rotation.y = rr.y + s.y.step(counter + act.headYaw * lerp(0.15, 0.5, t), dt);
      cerv[i].rotation.z = rr.z + s.z.step(bobComp + gaitBounce + curl, dt);
    }

    /* ---------- skull & jaw ---------- */
    const skull = rig.joints.skull, rs = this.rest.get(skull);
    const headStab = -bob * 0.6 + Math.sin(2 * ph + 2.2) * (0.006 + 0.018 * (p.speed / 6.2));
    skull.rotation.z = rs.z + this.headSpring.z.step(headStab + act.headPitch, dt);
    skull.rotation.y = rs.y + this.headSpring.y.step(act.headYaw, dt) + Math.sin(this.t * 0.37) * 0.010;
    skull.rotation.x = rs.x + act.headRoll + Math.sin(this.t * 0.51) * 0.006;

    const jaw = rig.joints.jaw, rj = this.rest.get(jaw);
    const idleJaw = 0.012 * (1 + Math.sin(this.t * 0.8)) + (moving ? 0.02 * Math.max(0, Math.sin(2 * ph)) : 0);
    jaw.rotation.z = rj.z - this.jawSpring.step(act.jaw + idleJaw, dt);

    /* ---------- arms: they swing subtly, never flail ---------- */
    for (const side of [1, -1]) {
      const a = rig.joints[side > 0 ? 'armL' : 'armR'];
      const rsh = this.rest.get(a.shoulder), rel = this.rest.get(a.elbow);
      const sw = Math.sin(ph + (side > 0 ? 0 : Math.PI)) * (0.05 + 0.12 * (p.speed / 6.2));
      a.shoulder.rotation.z = rsh.z + sw * 0.6 + act.jaw * 0.25;
      a.shoulder.rotation.x = rsh.x + Math.sin(ph + 1.2) * 0.04 * side;
      a.elbow.rotation.z = rel.z - Math.abs(sw) * 0.5 - act.jaw * 0.35;
    }

    /* ---------- dorsal column: breathing + stride flex wave ---------- */
    const dor = rig.joints.dorsals;
    for (let i = 0; i < dor.length; i++) {
      const t = i / (dor.length - 1);
      const rr = this.rest.get(dor[i]);
      const flex = Math.sin(2 * ph - t * 1.6) * (0.0012 + 0.0055 * (p.speed / 6.2));
      const br = Math.sin(this.t * (moving ? 1.6 : 0.62) - t * 0.8) * 0.0020 * act.breathe;
      dor[i].rotation.z = rr.z + flex + br;
      dor[i].rotation.y = rr.y + Math.sin(ph + 0.4 - t * 1.1) * (0.0015 + 0.0065 * (p.speed / 6.2));
    }
  }

  /* ---- foot trajectory + IK ---- */
  solveLeg(leg, phase, p, dt, side) {
    const A = DIM.femur, B = DIM.tibia, MT = DIM.metatarsus, TOE = 0.30;
    const duty = clamp(p.duty, 0.35, 1.0);
    const stride = p.stride;
    const sgn = leg.side;

    let fx, fy, mtAngle, toeRoll;
    if (phase < duty) {
      // ---- STANCE: the foot is planted; the body travels over it ----
      const u = phase / duty;
      fx = lerp(stride * 0.5, -stride * 0.5, u);
      fy = 0;
      // heel-down → flat → toe-off roll
      toeRoll = u < 0.12 ? lerp(-0.10, 0, u / 0.12) : u > 0.72 ? lerp(0, 0.62, (u - 0.72) / 0.28) : 0;
      fy = u > 0.80 ? (u - 0.80) / 0.20 * 0.10 : 0;    // ankle lifts as it rolls onto the toes
      mtAngle = lerp(0.34, -0.42, u);
    } else {
      // ---- SWING: arc forward, knee tucks, foot levels out for touchdown ----
      const u = (phase - duty) / (1 - duty);
      const e = smooth(smooth(u));
      fx = lerp(-stride * 0.5, stride * 0.5, e);
      fy = Math.sin(Math.PI * u) * p.lift * (0.75 + 0.25 * Math.sin(Math.PI * u));
      toeRoll = lerp(0.62, -0.10, smooth(clamp(u * 1.25, 0, 1)));
      mtAngle = lerp(-0.42, 0.34, smooth(u));
    }

    // Target in ROOT space (ground = y 0), then transported into pelvis space.
    const lateral = DIM.hipHalfWidth * sgn + Math.sin(this.phase * TAU) * 0.02 * sgn;
    const target = this._v.set(fx + 0.18, fy + 0.40, lateral);   // foot node sits above the sole
    this.rig.root.localToWorld(target);
    this.rig.joints.pelvis.worldToLocal(target);

    const hip = leg.hip.position;
    // ankle sits "above" the foot along the metatarsus
    const ax = target.x + Math.sin(mtAngle) * MT;
    const ay = target.y + Math.cos(mtAngle) * MT;
    const az = target.z;

    let dx = ax - hip.x, dy = ay - hip.y, dz = az - hip.z;
    const planar = Math.hypot(dx, dy);
    let d = clamp(planar, Math.abs(A - B) + 0.02, A + B - 0.012);

    const dirAng = Math.atan2(dx, -dy);
    const cosA = clamp((A * A + d * d - B * B) / (2 * A * d), -1, 1);
    const cosB = clamp((A * A + B * B - d * d) / (2 * A * B), -1, 1);
    const angA = Math.acos(cosA), angB = Math.acos(cosB);

    const hipZ = dirAng + angA;                 // knee bends forward (theropod)
    const kneeZ = -(Math.PI - angB);
    const ankleZ = -mtAngle - (hipZ + kneeZ);

    const sm = 1 - Math.exp(-dt * 55);
    leg.hip.rotation.z += (hipZ - leg.hip.rotation.z) * sm;
    leg.knee.rotation.z += (kneeZ - leg.knee.rotation.z) * sm;
    leg.ankle.rotation.z += (ankleZ - leg.ankle.rotation.z) * sm;

    // lateral: keep the shank under the hip, slight abduction, knees track forward
    const abduct = Math.atan2(dz, Math.max(0.2, -dy)) * 0.9;
    leg.hip.rotation.x += (-abduct * sgn * 0 + (-abduct) - leg.hip.rotation.x) * sm;

    // foot / toes
    const footZ = -(hipZ + kneeZ + ankleZ) + toeRoll;
    leg.foot.rotation.z += (footZ - leg.foot.rotation.z) * sm;
    for (let i = 0; i < leg.toes.length; i++) {
      const spread = [0.30, 0.0, -0.30][i];
      const curl = -toeRoll * 0.55 + (phase < duty ? 0.05 : -0.18);
      leg.toes[i].rotation.z += (curl - leg.toes[i].rotation.z) * sm;
      leg.toes[i].rotation.y += (spread * 0.2 - leg.toes[i].rotation.y) * sm;
    }
    leg._plant = phase < duty;
    leg._contact = phase < duty && phase > 0.02;
  }

  /* ---- ROAR: inhale, rear back, head thrown up, jaw gapes, body recoil, settle ---- */
  roarPose(u) {
    const a = {};
    // 0.00-0.18 inhale & coil  |  0.18-0.34 lunge  |  0.34-0.70 sustain  | 0.70-1 settle
    const inhale = smooth(clamp(u / 0.18, 0, 1));
    const lunge = smooth(clamp((u - 0.18) / 0.16, 0, 1));
    const release = smooth(clamp((u - 0.70) / 0.30, 0, 1));
    const sustain = clamp((u - 0.34) / 0.36, 0, 1);

    const open = (lunge - release) ;
    const tremor = Math.sin(u * 140) * 0.018 * (u > 0.34 && u < 0.72 ? 1 : 0)
      + Math.sin(u * 61) * 0.030 * (u > 0.30 && u < 0.75 ? 1 : 0);
    a.jaw = clamp(open, 0, 1) * 1.08 + tremor * clamp(open, 0, 1);   // ~62° gape
    a.headPitch = -inhale * 0.18 + lunge * 0.55 - release * 0.38 + tremor * 0.4;
    a.neckRaise = -inhale * 0.060 + lunge * 0.105 - release * 0.075;
    a.neckCurl = inhale * 0.030 - lunge * 0.045 + release * 0.020;
    a.bodyPitch = -inhale * 0.035 + lunge * 0.055 - release * 0.030;
    a.bodyPush = inhale * 0.9 - lunge * 1.4 + release * 0.5;
    a.breathe = 1 + inhale * 2.2 - sustain * 0.6;
    a.headYaw = Math.sin(u * 9.0) * 0.05 * clamp(open, 0, 1);
    a.headRoll = Math.sin(u * 5.0) * 0.03 * clamp(open, 0, 1);
    return a;
  }

  /* ---- SNIFF: head swings down, short rapid nasal pulses, scent-track, lift ---- */
  sniffPose(u) {
    const a = {};
    const down = smooth(clamp(u / 0.22, 0, 1));
    const up = smooth(clamp((u - 0.78) / 0.22, 0, 1));
    const active = clamp((u - 0.2) / 0.58, 0, 1) * (1 - up);
    const lower = down - up;
    a.headPitch = lower * -0.95 + Math.sin(u * 46) * 0.020 * active;
    a.neckCurl = lower * -0.235;
    a.neckRaise = lower * -0.070;
    a.headYaw = Math.sin(u * 3.4) * 0.32 * active + Math.sin(u * 21) * 0.02 * active;
    a.headRoll = Math.sin(u * 3.4 + 1.0) * 0.10 * active;
    // rapid low-amplitude jaw flutter = nostril pumping
    a.jaw = (0.035 + 0.030 * Math.sin(u * 52)) * active + lower * 0.02;
    a.bodyPitch = lower * -0.020;
    a.breathe = 1 + active * 1.6;
    return a;
  }
}
