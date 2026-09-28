/**
 * animation.js — procedural 3D animation for the eagle rig.
 *
 * Six cycles, all driven from measured raptor kinematics:
 *
 *  FLAP    ~2.6 Hz wingbeat (bald eagles cruise at 2.2-3.0 Hz), downstroke
 *          ratio 0.54, humeral elevation +42 deg to -48 deg, wrist and elbow
 *          flexed through the upstroke to cut the negative-lift area, humeral
 *          long-axis pronation leading the stroke by ~35 deg of phase.
 *  GLIDE   wings held at a small positive dihedral with the wrist slightly
 *          flexed, alula closed, tail part-fanned, body riding low-frequency
 *          thermal perturbations in roll, pitch and heave.
 *  WALK    1.15 s stride, 0.72 duty factor, sprawled-femur avian gait where
 *          the knee stays tucked in the body and the visible joint is the
 *          ankle; includes the classic thrust-and-hold head bob.
 *  IDLE    perched: breathing, weight shifts, micro head saccades, rousing
 *          (feather shake), tail twitches, grip adjustments.
 *  SCREECH anticipation crouch -> neck extension, 38 deg gape with 5 call
 *          pulses, wings lifted off the flanks, tail depressed, then settle.
 *  HEADTURN  180 deg cervical rotation distributed over 14 vertebrae with
 *          counter-rotation anticipation, hold with saccades, and return.
 *
 * Secondary motion is layered on top: feather aeroelastic lag and flex,
 * primary separation, tail fanning, neck counter-motion that stabilises the
 * head, body heave/roll/pitch, and toe grip compliance.
 */
import * as THREE from 'three';

const D = Math.PI / 180;
const TAU = Math.PI * 2;

/* deterministic smooth noise ---------------------------------------- */
function hash(n) { const s = Math.sin(n * 127.1) * 43758.5453; return s - Math.floor(s); }
function noise1(x) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  return (hash(i) * (1 - u) + hash(i + 1) * u) * 2 - 1;
}
function fbm(x, oct = 3) {
  let a = 0.6, s = 0, f = 1;
  for (let i = 0; i < oct; i++) { s += a * noise1(x * f + i * 17.3); a *= 0.5; f *= 2.07; }
  return s;
}
const sat = (v) => Math.min(1, Math.max(0, v));
const sstep = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = THREE.MathUtils.lerp;

/* ------------------------------------------------------------------ */
/* pose helpers                                                        */
/* ------------------------------------------------------------------ */

function P() { return { j: {}, root: { p: [0, 0, 0], r: [0, 0, 0] }, fx: {} }; }
function set(p, joint, x, y, z) { p.j[joint] = [x * D, y * D, z * D]; }
function add(p, joint, x, y, z) {
  const a = p.j[joint] || (p.j[joint] = [0, 0, 0]);
  a[0] += x * D; a[1] += y * D; a[2] += z * D;
}
/** Apply to both wings / both legs. */
function setB(p, joint, x, y, z) { set(p, joint + '.R', x, y, z); set(p, joint + '.L', x, y, z); }

function blendPose(a, b, w) {
  if (w <= 0) return a; if (w >= 1) return b;
  const out = P();
  const keys = new Set([...Object.keys(a.j), ...Object.keys(b.j)]);
  for (const k of keys) {
    const A = a.j[k] || [0, 0, 0], B = b.j[k] || [0, 0, 0];
    out.j[k] = [lerp(A[0], B[0], w), lerp(A[1], B[1], w), lerp(A[2], B[2], w)];
  }
  for (let i = 0; i < 3; i++) {
    out.root.p[i] = lerp(a.root.p[i], b.root.p[i], w);
    out.root.r[i] = lerp(a.root.r[i], b.root.r[i], w);
  }
  const fk = new Set([...Object.keys(a.fx), ...Object.keys(b.fx)]);
  for (const k of fk) out.fx[k] = lerp(a.fx[k] ?? 0, b.fx[k] ?? 0, w);
  return out;
}

/* ------------------------------------------------------------------ */
/* shared building blocks                                              */
/* ------------------------------------------------------------------ */

/** Extended (gliding) wing. */
function wingExtended(p, o = {}) {
  // +Y rotation sweeps a bone caudally, -Y cranially; elbow/wrist flexion is
  // therefore negative at the elbow and positive at the wrist (the Z-fold).
  setB(p, 'shoulder', o.tw ?? -4, o.sw ?? -4, o.el ?? 6);
  setB(p, 'elbow', 0, o.elb ?? -12, 0);
  setB(p, 'wrist', 0, o.wr ?? 8, 0);
  setB(p, 'digit', 0, o.dg ?? -2, 0);
  setB(p, 'alula', 0, o.al ?? 4, 0);
}

/** Wing folded against the flank, primaries laid back over the tail. */
function wingFolded(p, k = 1) {
  // humerus laid back along the flank, forearm folded cranially against it,
  // hand folded caudally again so the primaries lie back over the tail
  setB(p, 'shoulder', -16 * k, 80 * k, 2 * k);
  setB(p, 'elbow', 0, -158 * k, 0);
  setB(p, 'wrist', 0, 152 * k, -4 * k);
  setB(p, 'digit', 0, 22 * k, 0);
  setB(p, 'alula', 0, 14 * k, 0);
}

/** Legs folded up into the belly for flight. */
function legsTucked(p) {
  for (const s of ['.R', '.L']) {
    set(p, 'hip' + s, 10, -8, 52);
    set(p, 'knee' + s, 0, 0, -146);
    set(p, 'ankle' + s, 0, 0, 118);
    for (const t of ['I', 'II', 'III', 'IV']) curlToe(p, t, s, 1.0);
  }
}

/** Standing leg base pose (crouched raptor stance). */
function legStand(p, s, o = {}) {
  set(p, 'hip' + s, o.abd ?? 4, o.yaw ?? 0, o.hip ?? -40);
  set(p, 'knee' + s, 0, 0, o.knee ?? -80);
  set(p, 'ankle' + s, 0, 0, o.ankle ?? 40);
  curlToe(p, 'I', s, o.grip ?? 0.25);
  curlToe(p, 'II', s, o.grip ?? 0.25);
  curlToe(p, 'III', s, o.grip ?? 0.25);
  curlToe(p, 'IV', s, o.grip ?? 0.25);
}

/** Curl one toe chain; k = 0 flat, 1 = fully clenched. */
function curlToe(p, t, s, k) {
  const n = { I: 2, II: 3, III: 4, IV: 5 }[t];
  const base = t === 'I' ? 66 : 74;
  set(p, `toe${t}${s}`, 0, 0, base - 46 * k);
  // per-phalanx flexion is handled by the joint-name convention in Animator
  for (let i = 1; i <= n - 1; i++) p.j[`toe${t}${s}_${i}`] = [0, 0, -(10 + 26 * k) * D];
}

/** Distribute a yaw / pitch through the 14 cervicals with a natural weighting. */
function neckYaw(p, deg, weightBias = 1.0) {
  const N = 14;
  let tot = 0; const w = [];
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    // mid and upper cervicals carry most of the rotation in raptors
    const wi = Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * t)), 1.4) * (0.5 + t) * weightBias;
    w.push(wi); tot += wi;
  }
  for (let i = 0; i < N; i++) add(p, 'c' + i, 0, deg * w[i] / tot, 0);
}
function neckPitch(p, deg) {
  const N = 14; let tot = 0; const w = [];
  for (let i = 0; i < N; i++) { const wi = 0.4 + Math.sin(Math.PI * (i + 0.5) / N); w.push(wi); tot += wi; }
  for (let i = 0; i < N; i++) add(p, 'c' + i, deg * w[i] / tot, 0, 0);
}
/** e > 0 straightens the S-curve (head moves forward and up), e < 0 retracts. */
function neckExtend(p, rig, e) {
  const curve = rig.neckRestCurve;
  for (let i = 0; i < curve.length; i++) add(p, 'c' + i, -curve[i] * 0.55 * e, 0, 0);
}
function tail(p, pitch, yaw, roll = 0) {
  const n = 6;
  for (let i = 0; i < n; i++) {
    const key = i === 0 ? 'tailBase' : 'caudal' + (i - 1);
    add(p, key, pitch / n, yaw / n, roll / n);
  }
}

/* ------------------------------------------------------------------ */
/* 1. WING FLAP                                                        */
/* ------------------------------------------------------------------ */

const FLAP_HZ = 2.6;
const DSR = 0.54;              // downstroke ratio

function flapPhase(t) {
  const ph = (t * FLAP_HZ) % 1;
  // time-warp so the downstroke occupies DSR of the cycle but the stroke
  // angle still sweeps a clean half-cycle
  return ph < DSR ? (ph / DSR) * 0.5 : 0.5 + ((ph - DSR) / (1 - DSR)) * 0.5;
}

function poseFlap(t, rig) {
  const p = P();
  const u = flapPhase(t);
  const a = TAU * u;
  const down = u < 0.5;
  // 0 at top of stroke, 1 at bottom
  const strokeDown = 0.5 - 0.5 * Math.cos(a);
  const upAmt = down ? 0 : Math.sin(Math.PI * (u - 0.5) / 0.5);

  const elev = -3 + 45 * Math.cos(a);                 // +42 top .. -48 bottom
  const sweep = -4 - 14 * Math.sin(a) + 16 * upAmt;   // protract on downstroke
  const twist = -6 + 26 * Math.sin(a + 0.55);         // pronation leads the stroke

  setB(p, 'shoulder', twist, sweep, elev);
  setB(p, 'elbow', 0, -10 - 56 * upAmt, 0);
  setB(p, 'wrist', 0, 6 + 68 * upAmt, -6 * upAmt);
  setB(p, 'digit', 0, -2 + 18 * upAmt, 0);
  setB(p, 'alula', 0, 4 + 6 * upAmt, 0);

  legsTucked(p);

  /* body: the mass heaves against the wings — it rises late in the downstroke
     and drops during the upstroke; pitch nods with the inertial reaction. */
  const heave = 0.030 * Math.cos(a - 0.9);
  const surge = 0.012 * Math.sin(a - 0.5);
  p.root.p = [0, heave, surge];
  p.root.r = [(-2.5 + 4.5 * Math.cos(a + 1.5)) * D, 0, 0];

  /* neck counter-motion keeps the head on a near-straight line (raptors
     stabilise the head to within a few millimetres in level flapping flight) */
  neckExtend(p, rig, 0.30);
  // the cervical column works as the bird's gimbal: ~26 deg of counter-pitch
  // spread over 14 joints removes about half of the body's vertical heave
  // from the head (numerically tuned against the measured head trajectory)
  neckPitch(p, 26 * Math.cos(a - 0.9));
  add(p, 'skull', -11.7 * Math.cos(a - 0.9), 0, 0);

  // tail: trims against the pitching moment, fanned a little for stability
  tail(p, 6 + 7 * Math.cos(a + 2.2), 0);

  p.fx = {
    wingLoad: Math.cos(a) * -1,          // +1 at mid-downstroke (max load)
    airspeed: 1.0,
    tailFan: 0.35,
    tailTwist: 0,
    ruffle: 0.25,
    flapPhase: u,
    fold: 0.34 * upAmt,
    spreadOuter: 0.25 + 0.55 * upAmt,    // primaries separate on the upstroke
  };
  return p;
}

/* ------------------------------------------------------------------ */
/* 2. GLIDE                                                            */
/* ------------------------------------------------------------------ */

function poseGlide(t, rig) {
  const p = P();
  // slow thermal / gust perturbations
  const g1 = fbm(t * 0.23), g2 = fbm(t * 0.31 + 11.0), g3 = fbm(t * 0.17 + 5.0);
  const trim = fbm(t * 0.11 + 3.0);

  wingExtended(p, {
    tw: -5 + 2.5 * g1,
    sw: -8 + 2.0 * g2,
    el: 7 + 2.6 * g1 + 1.4 * g3,
    elb: 10 + 3.0 * g2,
    wr: -8 + 2.5 * g3,
    dg: -3 + 2.0 * g1,
    al: 3,
  });
  // small independent wing trim = roll control
  add(p, 'shoulder.R', 0, 0, 1.6 * trim);
  add(p, 'shoulder.L', 0, 0, -1.6 * trim);
  add(p, 'wrist.R', 0, 1.2 * trim, 0);
  add(p, 'wrist.L', 0, -1.2 * trim, 0);

  legsTucked(p);

  p.root.p = [0.03 * g3, 0.045 * g1, 0.02 * g2];
  p.root.r = [(-1.5 + 2.2 * g2) * D, 3.0 * trim * D, -5.0 * trim * D];

  neckExtend(p, rig, 0.22);
  // head stays locked on the horizon while the body rolls
  neckPitch(p, -2.0 * g2);
  neckYaw(p, -4.0 * trim + 3.0 * fbm(t * 0.5 + 21.0));
  add(p, 'skull', 1.2 * g2, 5.0 * trim, -4.0 * trim);

  tail(p, 4 + 3 * g1, 6 * trim, -3 * trim);

  p.fx = {
    wingLoad: 0.55 + 0.12 * g1,
    airspeed: 1.0,
    tailFan: 0.55 + 0.1 * g3,
    tailTwist: 4 * trim,
    ruffle: 0.18, fold: 0,
    spreadOuter: 0.40,     // gliding eagles hold the primary slots open
  };
  return p;
}

/* ------------------------------------------------------------------ */
/* 3. WALK                                                             */
/* ------------------------------------------------------------------ */

const STRIDE = 1.15;   // seconds per full cycle (both feet)
const DUTY = 0.72;     // fraction of the cycle each foot is on the ground

function legWalk(p, s, ph) {
  ph = ph % 1; if (ph < 0) ph += 1;
  const stance = ph < DUTY;
  let hip, knee, ankle, grip, abd = 5;
  if (stance) {
    const q = ph / DUTY;                       // 0 = touchdown, 1 = toe-off
    hip = lerp(-30, -50, q);                   // femur retracts
    knee = lerp(-86, -66, q) - 6 * Math.sin(Math.PI * q);  // yields under load
    ankle = lerp(30, 58, q);                   // ankle extends to push off
    grip = 0.30 + 0.25 * Math.sin(Math.PI * q);
  } else {
    const q = (ph - DUTY) / (1 - DUTY);        // swing
    const e = sstep(0, 1, q);
    hip = lerp(-50, -30, e) + 9 * Math.sin(Math.PI * q);
    knee = lerp(-66, -86, e) - 46 * Math.sin(Math.PI * q);   // flex to clear
    ankle = lerp(58, 30, e) - 34 * Math.sin(Math.PI * q);
    grip = 0.30 + 0.55 * Math.sin(Math.PI * q);              // toes curl up
    abd = 5 + 3 * Math.sin(Math.PI * q);
  }
  set(p, 'hip' + s, abd, 3, hip);
  set(p, 'knee' + s, 0, 0, knee);
  set(p, 'ankle' + s, 0, 0, ankle);
  for (const t of ['I', 'II', 'III', 'IV']) curlToe(p, t, s, grip);
  return { stance, ph };
}

function poseWalk(t, rig) {
  const p = P();
  const ph = (t / STRIDE) % 1;
  legWalk(p, '.R', ph);
  legWalk(p, '.L', ph + 0.5);

  // folded wings, with a little sway and an occasional balance adjustment
  wingFolded(p, 1);
  const balance = fbm(t * 0.6 + 4.0);
  add(p, 'shoulder.R', 0, 0, 2.5 * Math.sin(TAU * ph) + 2 * balance);
  add(p, 'shoulder.L', 0, 0, -2.5 * Math.sin(TAU * ph) - 2 * balance);
  add(p, 'elbow.R', 0, 3 * Math.sin(TAU * ph + 1), 0);
  add(p, 'elbow.L', 0, -3 * Math.sin(TAU * ph + 1), 0);

  /* body: twice-per-stride heave, once-per-stride lateral sway toward the
     supporting foot, plus the rolling waddle that goes with a wide gait */
  const sway = 0.021 * Math.sin(TAU * ph);
  const heave = -0.013 * Math.cos(2 * TAU * ph) - 0.004;
  p.root.p = [sway, heave, 0];
  p.root.r = [(-4 + 1.8 * Math.cos(2 * TAU * ph)) * D,
              2.2 * Math.sin(TAU * ph) * D,
              -7.0 * Math.sin(TAU * ph) * D];

  /* head bob: hold (head fixed in space) then a fast forward thrust, twice
     per stride — the signature of a walking bird */
  const bobPh = (ph * 2) % 1;
  const thrust = sstep(0.62, 0.92, bobPh);              // fast thrust
  const hold = 1 - sstep(0.0, 0.55, bobPh);             // slow relative drift
  const e = 0.18 + 0.55 * thrust - 0.35 * (1 - hold);
  neckExtend(p, rig, e);
  neckPitch(p, 6 - 10 * thrust);
  neckYaw(p, 4.5 * Math.sin(TAU * ph + 1.2) + 4 * fbm(t * 0.7 + 9.0));
  add(p, 'skull', -6 + 8 * thrust + 4 * Math.cos(2 * TAU * ph), 0,
      6.0 * Math.sin(TAU * ph) * -1);

  // tail counter-sways and bobs against the body
  tail(p, -6 + 5 * Math.cos(2 * TAU * ph), -9 * Math.sin(TAU * ph), 4 * Math.sin(TAU * ph));

  p.fx = {
    wingLoad: 0, airspeed: 0.08, tailFan: 0.12, tailTwist: 0,
    ruffle: 0.35 + 0.2 * Math.abs(Math.sin(TAU * ph)), spreadOuter: 0.05, fold: 1,
  };
  return p;
}

/* ------------------------------------------------------------------ */
/* 4. IDLE (perched)                                                   */
/* ------------------------------------------------------------------ */

function poseIdle(t, rig) {
  const p = P();
  const breathe = Math.sin(t * TAU * 0.42);            // ~25 breaths / minute
  const shift = fbm(t * 0.13);                         // slow weight shift
  const rouse = Math.max(0, Math.sin(t * 0.19) - 0.965) * 28;  // occasional shake
  const rouseWob = rouse * Math.sin(t * 46.0);

  legStand(p, '.R', { hip: -40 + 3 * shift, knee: -80 - 2 * shift, ankle: 40 + 2 * shift, grip: 0.42 + 0.06 * shift });
  legStand(p, '.L', { hip: -40 - 3 * shift, knee: -80 + 2 * shift, ankle: 40 - 2 * shift, grip: 0.42 - 0.06 * shift });

  wingFolded(p, 1);
  add(p, 'shoulder.R', 0, 0, 1.2 * breathe + rouseWob * 0.5);
  add(p, 'shoulder.L', 0, 0, 1.2 * breathe - rouseWob * 0.5);
  add(p, 'elbow.R', 0, 1.5 * breathe, 0);
  add(p, 'elbow.L', 0, 1.5 * breathe, 0);

  p.root.p = [0.008 * shift, 0.004 * breathe, 0.004 * breathe];
  p.root.r = [(-2 + 0.8 * breathe) * D, 1.5 * shift * D, -3.0 * shift * D + rouseWob * 0.3 * D];

  // micro-saccades: birds re-aim the head in small discrete jumps
  const sac = Math.round(fbm(t * 0.55 + 31.0) * 2.2) * 9;
  const sacP = Math.round(fbm(t * 0.47 + 77.0) * 1.6) * 5;
  neckExtend(p, rig, -0.08 + 0.05 * breathe);
  neckYaw(p, sac * 0.55);
  neckPitch(p, 2 + sacP * 0.4 + 1.2 * breathe);
  add(p, 'skull', sacP * 0.6 - 2, sac * 0.45, sac * 0.10 + rouseWob * 0.6);

  tail(p, -2 + 1.5 * breathe + rouse * 1.2, 3 * shift + rouseWob, 0);

  p.fx = {
    wingLoad: 0, airspeed: 0.02, tailFan: 0.06, tailTwist: 0,
    ruffle: 0.25 + rouse * 0.9, spreadOuter: 0.0, fold: 1,
  };
  return p;
}

/* ------------------------------------------------------------------ */
/* 5. SCREECH                                                          */
/* ------------------------------------------------------------------ */

const SCREECH_T = 2.8;

function poseScreech(t, rig) {
  const p = P();
  const x = (t % SCREECH_T) / SCREECH_T;

  // envelope: crouch (anticipation) -> lunge + call -> settle
  const crouch = sstep(0.0, 0.14, x) * (1 - sstep(0.14, 0.30, x));
  const call = sstep(0.16, 0.30, x) * (1 - sstep(0.72, 0.95, x));
  // 5 discrete call pulses
  const pulse = call * (0.55 + 0.45 * Math.pow(Math.abs(Math.sin((x - 0.18) * Math.PI * 9.0)), 0.6));

  legStand(p, '.R', { hip: -40 + 6 * crouch - 3 * call, knee: -80 - 9 * crouch, ankle: 40 + 7 * crouch, grip: 0.5 + 0.35 * call });
  legStand(p, '.L', { hip: -40 + 6 * crouch - 3 * call, knee: -80 - 9 * crouch, ankle: 40 + 7 * crouch, grip: 0.5 + 0.35 * call });

  // wings lift off the flanks and the carpals open slightly during the call
  wingFolded(p, 1);
  setB(p, 'shoulder', -16 + 6 * pulse, 80 - 16 * pulse, 2 + 26 * pulse);
  setB(p, 'elbow', 0, -158 + 30 * pulse, 0);
  setB(p, 'wrist', 0, 152 - 20 * pulse, -4);

  p.root.p = [0, -0.020 * crouch + 0.016 * pulse, -0.02 * crouch + 0.035 * pulse];
  p.root.r = [(-2 + 7 * crouch - 9 * pulse) * D, 0, 0];

  // neck extends and lifts, head tips back, beak opens
  neckExtend(p, rig, -0.25 * crouch + 0.85 * pulse);
  neckPitch(p, 10 * crouch - 26 * pulse);
  add(p, 'skull', -6 * crouch + 20 * pulse + 1.6 * Math.sin(x * 120), 0, 0);
  set(p, 'mandible', 0, 0, -(4 + 34 * pulse));

  tail(p, -4 - 14 * pulse, 0);

  p.fx = {
    wingLoad: 0.1 * pulse, airspeed: 0.05, tailFan: 0.10 + 0.35 * pulse,
    tailTwist: 0, ruffle: 0.3 + 0.9 * pulse, spreadOuter: 0.15 * pulse,
    fold: 1 - 0.25 * pulse,
  };
  return p;
}

/* ------------------------------------------------------------------ */
/* 6. HEAD TURN                                                        */
/* ------------------------------------------------------------------ */

const TURN_T = 5.0;

function poseHeadTurn(t, rig) {
  const p = P();
  const x = (t % TURN_T) / TURN_T;

  // anticipation -> 175 deg turn -> hold with saccades -> return
  const anticip = sstep(0.02, 0.10, x) * (1 - sstep(0.10, 0.20, x));
  const outT = sstep(0.12, 0.34, x);
  const backT = sstep(0.64, 0.86, x);
  const turn = (outT - backT);
  const holding = outT * (1 - backT);
  const sacc = holding * (Math.round(fbm(t * 0.9 + 3.0) * 1.8) * 5);

  const yaw = 175 * turn - 14 * anticip + sacc;

  legStand(p, '.R', { hip: -40, knee: -80, ankle: 40, grip: 0.45, yaw: 2 });
  legStand(p, '.L', { hip: -40, knee: -80, ankle: 40, grip: 0.45, yaw: 2 });
  wingFolded(p, 1);

  // the body barely moves — that is the whole point of 14 cervicals
  p.root.p = [0.004 * turn, 0, 0];
  p.root.r = [-2 * D, 2.5 * turn * D, -1.5 * turn * D];

  neckExtend(p, rig, 0.12 + 0.30 * holding - 0.15 * anticip);
  neckYaw(p, yaw * 0.72);
  neckPitch(p, -3 * holding + 4 * anticip);
  // skull contributes the last part of the rotation plus the head roll that
  // raptors add when they inspect something off-axis
  add(p, 'skull', 2 * holding, yaw * 0.28, -16 * holding * Math.sin(x * 6.0));

  tail(p, -2, -6 * turn, 3 * turn);

  p.fx = { wingLoad: 0, airspeed: 0.02, tailFan: 0.08, tailTwist: 0, ruffle: 0.2, spreadOuter: 0, fold: 1 };
  return p;
}

/* ------------------------------------------------------------------ */
/* Animator                                                            */
/* ------------------------------------------------------------------ */

export const STATES = {
  flap: { fn: poseFlap, label: 'Wing flap cycle', airborne: true },
  glide: { fn: poseGlide, label: 'Glide cycle', airborne: true },
  walk: { fn: poseWalk, label: 'Walk cycle (ground)', airborne: false },
  idle: { fn: poseIdle, label: 'Idle (perched)', airborne: false },
  screech: { fn: poseScreech, label: 'Screech', airborne: false },
  headturn: { fn: poseHeadTurn, label: 'Head turn (180 deg)', airborne: false },
};

export class Animator {
  constructor(rig) {
    this.rig = rig;
    this.state = 'glide';
    this.prev = null;
    this.blend = 1;
    this.blendDur = 0.5;
    this.time = 0;
    this.stateTime = 0;
    this.prevTime = 0;
    this.speed = 1;
    this._e = new THREE.Euler();
    this._q = new THREE.Quaternion();
    this._qf = new THREE.Quaternion();
    this.groundY = 0;
    this.flyY = 1.35;
    this.curY = 0;
    this.fx = {};
    // talon tips used for ground contact when the bird is not airborne
    this.contacts = [];
    rig.root.traverse((o) => {
      if (o.isMesh && o.userData.isClaw) {
        o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        this.contacts.push({ mesh: o, local: new THREE.Vector3(bb.max.x, bb.min.y, (bb.min.z + bb.max.z) / 2) });
      }
    });
    this._v = new THREE.Vector3();
    this.calibrateFold();
  }

  /**
   * Solve, once, how far each remex/covert must rotate about its own follicle
   * axis so that the closed wing stacks its feathers back along the body.
   * Done numerically because the fold chain accumulates humeral twist.
   */
  calibrateFold() {
    const p = P();
    wingFolded(p, 1);
    legStand(p, '.R'); legStand(p, '.L');
    this.applyPoseRaw(p);
    this.rig.root.updateMatrixWorld(true);

    const pq = new THREE.Quaternion(), ps = new THREE.Vector3(), pp = new THREE.Vector3();
    const tX = new THREE.Vector3(), tY = new THREE.Vector3(), tZ = new THREE.Vector3();
    const m = new THREE.Matrix4();
    /* Solve on the right wing only: the left wing lives under a mirroring
       group, so the identical local rotation produces the mirrored result
       (and quaternion maths is not valid through a reflection). */
    const solved = {};
    for (const f of this.rig.feathers) {
      if (!['primary', 'secondary', 'tertial', 'covert', 'alula'].includes(f.kind)) continue;
      if (f.side === '.L') continue;
      const side = 1;
      const i = f.idx || 0;
      /* Closed-wing target: every remex lies back along the body, shingled,
         vane facing dorsally. Slight per-feather offsets keep them stacked
         rather than coincident. */
      const inboard = f.kind === 'primary' ? 0.06 + 0.012 * i : 0.10;
      const droop = f.kind === 'primary' ? 0.10 + 0.012 * i : 0.14 + 0.01 * i;
      tX.set(-side * inboard, -droop, -1).normalize();
      tY.set(-side * (0.10 + 0.015 * i), 1, 0).normalize();      // vane faces up
      tZ.crossVectors(tX, tY).normalize();
      tY.crossVectors(tZ, tX).normalize();
      m.makeBasis(tX, tY, tZ);
      const targetWorld = new THREE.Quaternion().setFromRotationMatrix(m);

      // local rotation that takes the rest pose to that world orientation
      f.node.parent.matrixWorld.decompose(pp, pq, ps);
      const local = pq.clone().multiply(f.node.userData.rest).invert().multiply(targetWorld);
      f.foldQ = local;
      solved[f.name.slice(0, -2)] = local;
    }
    for (const f of this.rig.feathers) {
      if (f.side === '.L' && f.name && solved[f.name.slice(0, -2)]) {
        f.foldQ = solved[f.name.slice(0, -2)];
      }
    }
  }

  /** Apply joint angles only (no ground solve, no feather pass). */
  applyPoseRaw(pose) {
    const J = this.rig.joints;
    for (const k in J) {
      const j = J[k];
      const a = pose.j[k];
      if (!a) { j.quaternion.copy(j.userData.rest); continue; }
      this._e.set(a[0], a[1], a[2], 'ZYX');
      this._q.setFromEuler(this._e);
      j.quaternion.copy(j.userData.rest).multiply(this._q);
    }
  }

  setState(name) {
    if (name === this.state) return;
    this.prev = this.state;
    this.prevTime = this.stateTime;
    this.state = name;
    this.stateTime = 0;
    this.blend = 0;
  }

  update(dt) {
    dt *= this.speed;
    this.time += dt;
    this.stateTime += dt;
    this.prevTime += dt;
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / this.blendDur);

    let pose = STATES[this.state].fn(this.stateTime, this.rig);
    if (this.prev && this.blend < 1) {
      const prevPose = STATES[this.prev].fn(this.prevTime, this.rig);
      pose = blendPose(prevPose, pose, this.blend);
    }
    this.applyPose(pose);
    this.driveFeathers(pose.fx);
    this.fx = pose.fx;
    return pose;
  }

  applyPose(pose) {
    const J = this.rig.joints;
    for (const k in J) {
      const j = J[k];
      const a = pose.j[k];
      if (!a) { j.quaternion.copy(j.userData.rest); continue; }
      this._e.set(a[0], a[1], a[2], 'ZYX');
      this._q.setFromEuler(this._e);
      j.quaternion.copy(j.userData.rest).multiply(this._q);
    }
    // root: body height blends between perched and airborne
    const airborne = STATES[this.state].airborne;
    const targetY = airborne ? this.flyY : this.groundY + this.rig.standHeight;
    this.curY = lerp(this.curY || targetY, targetY, 1 - Math.pow(0.001, 0.016));
    const r = this.rig.root, b = this.rig.body;
    r.position.set(pose.root.p[0], this.curY + pose.root.p[1], pose.root.p[2]);
    b.rotation.set(pose.root.r[0], pose.root.r[1], pose.root.r[2], 'ZYX');

    /* Ground contact: with the bird standing or walking, body height is a
       consequence of the limb kinematics, so plant the lowest talon exactly
       on the ground instead of guessing a body height. */
    if (!airborne && this.contacts.length) {
      r.updateMatrixWorld(true);
      let minY = Infinity;
      for (const c of this.contacts) {
        this._v.copy(c.local).applyMatrix4(c.mesh.matrixWorld);
        if (this._v.y < minY) minY = this._v.y;
      }
      if (isFinite(minY)) {
        r.position.y += (this.groundY - minY);
        this.curY += (this.groundY - minY) * 0.5;
      }
    }
  }

  /** Secondary animation: aeroelastic feather flex, spread, fan and ruffle. */
  driveFeathers(fx) {
    const t = this.time;
    const load = fx.wingLoad ?? 0;
    const air = fx.airspeed ?? 0;
    const spread = fx.spreadOuter ?? 0;
    const ruffle = fx.ruffle ?? 0;
    const fan = fx.tailFan ?? 0;
    const twist = fx.tailTwist ?? 0;
    /* When the wing closes, the remiges rotate about their follicles and
       stack along the forearm; without this they would swing out sideways. */
    const fold = fx.fold ?? 0;

    for (const f of this.rig.feathers) {
      const n = f.node;
      let rx = 0, ry = 0, rz = 0;
      switch (f.kind) {
        case 'primary': {
          const sp = f.span;                                  // 0 inner .. 1 outer
          const lag = load * (0.25 + 0.75 * sp);              // tip lags the bone
          // vane bends up under aerodynamic load, and twists nose-down
          rz = (14 * lag + 2.5 * fbm(t * 6 + f.idx * 3) * air) * D;
          rx = (-9 * lag * sp - 3 * air * fbm(t * 5 + f.idx)) * D;
          // slot separation: outer primaries splay apart
          ry = (spread * (f.idx - 4.5) * 1.5 + 1.5 * fbm(t * 3 + f.idx * 7) * air) * D;
          break;
        }
        case 'secondary': {
          const lag = load * (0.35 + 0.35 * f.span);
          rz = (10 * lag + 1.6 * fbm(t * 5 + f.idx * 2) * air) * D;
          rx = (-4 * lag) * D;
          ry = (1.0 * fbm(t * 2.5 + f.idx * 5) * air) * D;
          break;
        }
        case 'tertial':
          rz = (6 * load + ruffle * 2.0 * fbm(t * 4 + f.idx)) * D;
          break;
        case 'covert':
          rz = (3.5 * load + ruffle * 6.0 * fbm(t * 7 + f.idx * 11)) * D;
          ry = (ruffle * 4.0 * fbm(t * 6 + f.idx * 5)) * D;
          break;
        case 'alula':
          // the alular slat deploys with load (and on landing / low speed)
          ry = (-26 * sat(load) * 0.5 - 8 * spread) * D;
          rz = (6 * load) * D;
          break;
        case 'rectrix': {
          const sgn = Math.sign(f.k) || 1;
          const tt = Math.abs(f.k) / 5.5;
          ry = (sgn * fan * tt * 34 + twist * 0.4 * sgn) * D;
          rz = (-sgn * twist * 0.8 - fan * tt * 5 + 2.0 * ruffle * fbm(t * 4 + f.idx)) * D;
          rx = (1.5 * ruffle * fbm(t * 5 + f.idx * 3)) * D;
          break;
        }
        case 'tailCovert':
          rz = (ruffle * 5 * fbm(t * 5 + f.idx * 9)) * D;
          break;
        case 'contour':
          rz = (ruffle * 9 * fbm(t * 3.5 + f.idx * 13)) * D;
          ry = (ruffle * 6 * fbm(t * 3.0 + f.idx * 4)) * D;
          break;
      }
      this._e.set(rx, ry, rz, 'ZYX');
      this._q.setFromEuler(this._e);
      if (f.foldQ && fold > 0.0005) {
        this._qf.identity().slerp(f.foldQ, fold);
        n.quaternion.copy(n.userData.rest).multiply(this._qf).multiply(this._q);
      } else {
        n.quaternion.copy(n.userData.rest).multiply(this._q);
      }
    }
  }
}
