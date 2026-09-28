import * as THREE from 'three';

// ---------- small math helpers ----------
const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (t) => t * t * (3 - 2 * t);              // smoothstep
const smoother = (t) => t * t * t * (t * (t * 6 - 15) + 10);

// sample a looping keyframe track [{t,v}] (t normalised 0..1)
function track(keys, tt, loop = 1) {
  const t = ((tt % loop) + loop) % loop;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i], b = keys[i + 1];
    if (t >= a.t && t <= b.t) {
      const k = smoother((t - a.t) / (b.t - a.t));
      return a.v + (b.v - a.v) * k;
    }
  }
  return keys[keys.length - 1].v;
}

// tuning for wing poses
const WING = {
  fold:   { sh: [0.0, 0.16, 0.10], el: [0, 2.15, 0], wr: [0, 1.45, 0] },
  extend: { sh: [0.0, -0.05, 0.02], el: [0, 0.10, 0], wr: [0, 0.06, 0] },
};

// ================= Animator =================
export class EagleAnimator {
  constructor(rig) {
    this.rig = rig;
    this.nodes = [];
    this.map = new Map();
    this.time = 0;

    const reg = (obj, opts = {}) => {
      if (!obj) return;
      const baseRot = obj.userData.base
        ? { x: obj.userData.base.x, y: obj.userData.base.y, z: obj.userData.base.z }
        : { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z };
      const n = {
        obj,
        base: baseRot,
        basePos: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        pos: !!opts.pos,
        resp: opts.resp ?? 18,
        respPos: opts.respPos ?? 12,
        cur: { ...baseRot },
        tgt: { ...baseRot },
        curPos: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
        tgtPos: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
      };
      this.nodes.push(n);
      this.map.set(obj, n);
    };

    reg(rig.root, { pos: true, resp: 8, respPos: 5 });
    reg(rig.body, { pos: true, resp: 12, respPos: 11 });
    reg(rig.neck, { resp: 11 });
    reg(rig.head, { pos: true, resp: 12, respPos: 12 });
    reg(rig.jaw, { resp: 26 });
    reg(rig.tail, { resp: 13 });

    for (const side of ['R', 'L']) {
      const w = rig.wings[side];
      reg(w.shoulder, { resp: 30 });
      reg(w.elbow, { resp: 28 });
      reg(w.wrist, { resp: 26 });
      for (const arr of [w.primaries, w.secondaries, w.tertials, w.coverts])
        for (const f of arr) reg(f, { resp: 20 });
      const l = rig.legs[side];
      reg(l.hip, { resp: 18 });
      reg(l.knee, { resp: 18 });
      reg(l.ankle, { resp: 18 });
    }
    for (const f of rig.tailFeathers) reg(f, { resp: 16 });
    for (const f of rig.contour) reg(f, { resp: 14 });

    // public write API bound to this
    this.api = {
      rig,
      addR: (o, x = 0, y = 0, z = 0) => { const n = this.map.get(o); if (n) { n.tgt.x += x; n.tgt.y += y; n.tgt.z += z; } },
      setR: (o, x = 0, y = 0, z = 0) => { const n = this.map.get(o); if (n) { n.tgt.x = n.base.x + x; n.tgt.y = n.base.y + y; n.tgt.z = n.base.z + z; } },
      addP: (o, x = 0, y = 0, z = 0) => { const n = this.map.get(o); if (n) { n.tgtPos.x += x; n.tgtPos.y += y; n.tgtPos.z += z; } },
      setP: (o, x, y, z) => { const n = this.map.get(o); if (n) { n.tgtPos.x = x; n.tgtPos.y = y; n.tgtPos.z = z; } },
    };
  }

  // ---- reusable pose fragments ----
  wing(pose, dih = 0) {
    const a = this.api, W = WING[pose];
    for (const side of ['R', 'L']) {
      const w = this.rig.wings[side];
      a.addR(w.shoulder, W.sh[0], W.sh[1], W.sh[2] + dih);
      a.addR(w.elbow, W.el[0], W.el[1], W.el[2]);
      a.addR(w.wrist, W.wr[0], W.wr[1], W.wr[2]);
    }
  }
  legsStand() {
    const a = this.api;
    for (const s of ['R', 'L']) {
      const l = this.rig.legs[s];
      a.addR(l.hip, 0.18, 0, 0);
      a.addR(l.knee, -0.65, 0, 0);
      a.addR(l.ankle, 0.55, 0, 0);
    }
  }
  legsTuck() {
    const a = this.api;
    for (const s of ['R', 'L']) {
      const l = this.rig.legs[s];
      a.addR(l.hip, 1.55, 0, 0);
      a.addR(l.knee, -1.9, 0, 0);
      a.addR(l.ankle, 0.9, 0, 0);
    }
  }

  update(dt, speed, animFn) {
    this.time += dt * speed;
    const t = this.time;
    // reset targets to rest
    for (const n of this.nodes) {
      n.tgt.x = n.base.x; n.tgt.y = n.base.y; n.tgt.z = n.base.z;
      n.tgtPos.x = n.basePos.x; n.tgtPos.y = n.basePos.y; n.tgtPos.z = n.basePos.z;
    }
    animFn(this, this.api, t, dt * speed);
    // critically-damped follow using real dt for stability
    for (const n of this.nodes) {
      const k = 1 - Math.exp(-n.resp * dt);
      n.cur.x += (n.tgt.x - n.cur.x) * k;
      n.cur.y += (n.tgt.y - n.cur.y) * k;
      n.cur.z += (n.tgt.z - n.cur.z) * k;
      n.obj.rotation.set(n.cur.x, n.cur.y, n.cur.z);
      if (n.pos) {
        const kp = 1 - Math.exp(-n.respPos * dt);
        n.curPos.x += (n.tgtPos.x - n.curPos.x) * kp;
        n.curPos.y += (n.tgtPos.y - n.curPos.y) * kp;
        n.curPos.z += (n.tgtPos.z - n.curPos.z) * kp;
        n.obj.position.set(n.curPos.x, n.curPos.y, n.curPos.z);
      }
    }
  }
}

// ================= Animation definitions =================
// Each fn(self, api, t, dt) writes target offsets for this frame.

const GROUND_Y = 0.38;
const AIR_Y = 1.25;

function idle(self, api, t) {
  const rig = api.rig;
  api.setP(rig.root, 0, GROUND_Y, 0);
  self.wing('fold');
  self.legsStand();
  api.addR(rig.body, -0.22, 0, 0); // upright perched carriage

  // breathing
  const br = Math.sin(t * 1.6);
  api.addP(rig.body, 0, 0.006 * br, 0);
  api.addR(rig.body, 0.01 * br, 0, 0);
  api.addR(rig.body, 0, 0, 0.01 * Math.sin(t * 0.5)); // slow weight shift

  // living head: slow drift + occasional quick tick
  const drift = Math.sin(t * 0.6) * 0.12 + Math.sin(t * 0.23 + 1.3) * 0.08;
  const pitch = Math.sin(t * 0.5 + 2.0) * 0.05;
  const tick = (Math.sin(t * 0.9) > 0.985) ? 0.25 : 0; // sudden alert glance
  api.addR(rig.head, pitch, drift + tick, drift * 0.15);
  api.addR(rig.neck, 0.02 * br, drift * 0.25, 0);

  // subtle tail settle
  api.addR(rig.tail, 0.04 + 0.01 * br, 0, 0);
  // occasional contour ruffle
  const ruffle = Math.max(0, Math.sin(t * 0.4) - 0.9) * 3;
  for (let i = 0; i < rig.contour.length; i += 5)
    api.addR(rig.contour[i], 0, 0, 0.15 * ruffle * Math.sin(i));
}

function flap(self, api, t) {
  const rig = api.rig;
  const freq = 2.0;
  const ph = t * TAU * freq;
  api.setP(rig.root, 0, AIR_Y + 0.05 * Math.sin(ph), 0);
  self.wing('extend', 0.05);
  self.legsTuck();

  const down = Math.max(0, Math.sin(ph));   // downstroke load
  const up = Math.max(0, -Math.sin(ph));    // upstroke fold
  const dih = Math.cos(ph);                 // +1 top, -1 bottom

  for (const side of ['R', 'L']) {
    const w = rig.wings[side];
    // main stroke: raise/lower whole wing
    api.addR(w.shoulder, 0, 0.18 * down - 0.10 * up, 0.95 * dih);
    // fold on upstroke, extend & snap forward on downstroke
    api.addR(w.elbow, 0, 0.95 * up, -0.10 * down);
    api.addR(w.wrist, 0, 1.15 * up, -0.25 * down); // wrist pushes forward at bottom
    api.addR(w.shoulder, 0, 0, 0.10 * up);         // lift a touch more on recovery

    // feather aerodynamics: trailing feathers flex up under load,
    // primaries separate & twist ("open slots") on the upstroke
    const flex = 0.20 * Math.sin(ph);
    w.secondaries.forEach((f) => api.addR(f, 0, 0, flex));
    w.primaries.forEach((f, i) => {
      const outer = 1 - i / (w.primaries.length - 1);
      api.addR(f, 0, up * 0.20 * outer, flex + up * 0.28 * outer); // splay + twist
    });
  }

  // body: rises during downstroke, gentle pitch, head kept steady
  api.addP(rig.body, 0, 0.05 * Math.sin(ph), 0);
  api.addR(rig.body, 0.06 * Math.sin(ph), 0, 0);
  api.addR(rig.head, -0.05 * Math.sin(ph), 0, 0);        // gaze stabilised
  api.addR(rig.neck, -0.03 * Math.sin(ph), 0, 0);
  api.addR(rig.tail, -0.04 * Math.sin(ph), 0, 0);
  // slight tail spread while working
  rig.tailFeathers.forEach((f) => api.addR(f, 0, 0.12 * f.userData.fanU, 0));
}

function glide(self, api, t) {
  const rig = api.rig;
  api.setP(rig.root, 0, AIR_Y, 0);
  api.addR(rig.body, -0.05, 0, 0); // slight nose-down trim
  self.wing('extend', 0.14);       // shallow dihedral V
  self.legsTuck();

  // slotted, spread primaries (fingered wingtips)
  for (const side of ['R', 'L']) {
    const w = rig.wings[side];
    w.primaries.forEach((f, i) => {
      const outer = 1 - i / (w.primaries.length - 1);
      api.addR(f, 0, -0.12 * outer, 0.10 * outer); // splay & tips up
    });
    // micro turbulence flex at the tips
    const turb = Math.sin(t * 3.1 + (side === 'R' ? 0 : 1.7));
    api.addR(w.wrist, 0, 0, 0.03 * turb);
    api.addR(w.shoulder, 0, 0, 0.02 * Math.sin(t * 0.9 + (side === 'R' ? 0 : Math.PI)));
  }

  // slow soaring adjustments: gentle bank & pitch, tail fanned for lift
  api.addR(rig.body, 0.02 * Math.sin(t * 0.7), 0.0, 0.10 * Math.sin(t * 0.35));
  api.addR(rig.tail, -0.02, 0.08 * Math.sin(t * 0.35), 0);
  rig.tailFeathers.forEach((f) => api.addR(f, 0, 0.22 * f.userData.fanU, 0)); // fan open
  // head scans slowly, stays level
  api.addR(rig.head, 0.03 * Math.sin(t * 0.5), 0.25 * Math.sin(t * 0.3), -0.08 * Math.sin(t * 0.35));
}

function walk(self, api, t) {
  const rig = api.rig;
  const freq = 1.15;
  const ph = t * TAU * freq;
  api.setP(rig.root, 0, GROUND_Y, 0);
  self.wing('fold');

  // forward, more horizontal carriage
  api.addR(rig.body, 0.22, 0, 0);

  for (const side of ['R', 'L']) {
    const l = rig.legs[side];
    const lp = ph + (side === 'R' ? 0 : Math.PI);
    const swing = Math.sin(lp);
    const lift = Math.max(0, Math.sin(lp + 0.2));     // lift while swinging forward
    api.addR(l.hip, 0.15 + 0.5 * swing, 0, 0);        // stride
    api.addR(l.knee, -0.6 - 1.0 * lift, 0, 0);        // tuck up on lift
    api.addR(l.ankle, 0.55 + 0.7 * lift - 0.2 * Math.max(0, -swing), 0, 0);
  }

  // body: double bob per stride + side sway leaning over the stance leg
  api.addP(rig.body, 0.02 * Math.sin(ph), -0.02 + 0.02 * Math.cos(2 * ph), 0);
  api.addR(rig.body, 0, 0, 0.07 * Math.sin(ph));

  // classic avian head-bob (thrust & hold)
  const bob = Math.sin(ph - 0.7);
  api.addR(rig.neck, 0.14 * bob + 0.1, 0.05 * Math.sin(ph), 0);
  api.addR(rig.head, -0.09 * bob, 0.03 * Math.sin(ph), 0);
  api.addP(rig.head, 0, 0, 0.02 * bob);

  // raised tail counter-balancing side to side
  api.addR(rig.tail, -0.12, 0, -0.06 * Math.sin(ph));
}

function screech(self, api, t) {
  const rig = api.rig;
  api.setP(rig.root, 0, GROUND_Y, 0);
  self.legsStand();
  api.addR(rig.body, -0.18, 0, 0);

  const loop = 2.4;
  const c = (t % loop) / loop;
  // envelope: windup -> throw head back + open -> hold call -> relax
  const open = track([
    { t: 0.0, v: 0 }, { t: 0.12, v: -0.15 }, { t: 0.28, v: 1.0 },
    { t: 0.62, v: 1.0 }, { t: 0.78, v: 0.0 }, { t: 1.0, v: 0.0 },
  ], c);
  const oPos = Math.max(0, open);
  const vibrato = Math.sin(t * 46) * 0.04 * oPos;

  // wings flare with the call (aggression)
  self.wing('fold');
  for (const side of ['R', 'L']) {
    const w = rig.wings[side];
    api.addR(w.shoulder, 0, -0.25 * oPos, -0.35 * oPos);
    api.addR(w.elbow, 0, -0.6 * oPos, 0);
  }

  // jaw gapes; head thrown up & back; chest puffs; slight recoil each pulse
  api.addR(rig.jaw, 0.62 * oPos + vibrato, 0, 0);
  api.addR(rig.head, -0.35 * oPos, 0.04 * Math.sin(t * 3), 0);
  api.addR(rig.neck, -0.22 * oPos + 0.06 * (open < 0 ? open : 0), 0, 0);
  api.addR(rig.body, -0.10 * oPos, 0, 0);
  api.addP(rig.body, 0, 0.02 * oPos + vibrato * 0.3, -0.02 * oPos);

  // tail raises & fans a little during the call
  api.addR(rig.tail, -0.15 * oPos, 0, 0);
  rig.tailFeathers.forEach((f) => api.addR(f, 0, 0.15 * oPos * f.userData.fanU, 0));

  // hackles: contour feathers on neck/back bristle
  for (let i = 0; i < rig.contour.length; i += 3)
    api.addR(rig.contour[i], 0, 0, 0.3 * oPos);

  // breathing underlay
  api.addP(rig.body, 0, 0.005 * Math.sin(t * 1.6), 0);
}

function headTurn(self, api, t) {
  const rig = api.rig;
  api.setP(rig.root, 0, GROUND_Y, 0);
  self.wing('fold');
  self.legsStand();
  api.addR(rig.body, -0.22, 0, 0);

  const loop = 7.0;
  const c = (t % loop) / loop;
  // sharp raptor look-around: quick snaps, held scans, a look-up
  const yaw = track([
    { t: 0.00, v: 0.0 },
    { t: 0.08, v: 1.45 },   // snap right
    { t: 0.26, v: 1.45 },   // hold / scan
    { t: 0.30, v: 1.20 },   // small double-take
    { t: 0.34, v: 1.45 },
    { t: 0.44, v: 1.45 },
    { t: 0.52, v: -1.30 },  // snap left
    { t: 0.70, v: -1.30 },  // hold
    { t: 0.80, v: -0.20 },
    { t: 0.90, v: 0.10 },
    { t: 1.00, v: 0.0 },
  ], c);
  const pitch = track([
    { t: 0.0, v: 0 }, { t: 0.44, v: 0 }, { t: 0.46, v: -0.05 },
    { t: 0.70, v: 0.0 }, { t: 0.74, v: -0.35 }, { t: 0.82, v: 0.0 }, { t: 1.0, v: 0.0 },
  ], c); // includes a look-up

  api.addR(rig.head, pitch, yaw, -0.12 * Math.sin(yaw)); // head banks slightly into turn
  api.addR(rig.neck, 0.02, 0.35 * yaw, 0);               // neck follows partly
  api.addR(rig.body, 0, 0.06 * yaw, 0);                  // faint shoulder follow

  // breathing / life
  const br = Math.sin(t * 1.6);
  api.addP(rig.body, 0, 0.005 * br, 0);
  api.addR(rig.tail, 0.04, 0.05 * yaw, 0);
}

export const ANIMATIONS = [
  { id: 'idle', name: 'Idle', icon: '🪶', desc: 'Perched: breathing, weight shifts, alert glances and feather settle.', fn: idle },
  { id: 'flap', name: 'Wing Flap', icon: '🦅', desc: 'Powered flight: fold on upstroke, thrust on downstroke, body lift & feather flex.', fn: flap },
  { id: 'glide', name: 'Glide', icon: '🌬️', desc: 'Soaring on a shallow dihedral with slotted fingertip primaries and a fanned tail.', fn: glide },
  { id: 'walk', name: 'Walk', icon: '🚶', desc: 'Ground gait: alternating stride, body sway/bob and the classic avian head-bob.', fn: walk },
  { id: 'screech', name: 'Screech', icon: '📣', desc: 'Head thrown back, gaping beak with call vibrato, flared wings and bristled hackles.', fn: screech },
  { id: 'headturn', name: 'Head Turn', icon: '👁️', desc: 'Sharp raptor scanning: quick snaps, held gazes, a look-up and neck follow-through.', fn: headTurn },
];
