// Motion: how the floating town moves.
//
// 1. THE SWELL. A few slow travelling waves run through the whole town. Every
//    fragment rides the swell like a raft: its height and tilt come from the field
//    sampled across its own footprint. Neighbouring fragments therefore rise and
//    tilt *together*, which is what keeps a broken road drivable while it moves:
//    two slabs either side of a crack sample nearly the same field, so the crack
//    never turns into a kerb. Nothing is keyframed or looped - the waves have
//    unrelated periods so the motion never visibly repeats.
// 2. WOBBLE. Small independent rotations/bob per fragment (sum of incommensurate
//    sines) so nothing moves in lockstep. Route pieces get very little; loose
//    scenery and props get more.
// 3. SPIN. Props tumble slowly and continuously (zero gravity).
// 4. Optional scripted channels (yaw sway, lateral drift) for the handful of path
//    pieces that are meant to visibly "move around".
import * as THREE from 'three';

export const SWELL = [
  { dx: 0.8, dz: 0.6, len: 150, period: 13.0, amp: 0.58, phase: 0.3 },
  { dx: -0.5, dz: 0.866, len: 105, period: 9.7, amp: 0.36, phase: 2.1 },
  { dx: 0.2, dz: -0.98, len: 230, period: 17.3, amp: 0.52, phase: 4.0 },
].map((w) => ({ ...w, kx: (2 * Math.PI / w.len) * w.dx, kz: (2 * Math.PI / w.len) * w.dz, w: 2 * Math.PI / w.period }));

export const SWELL_MAX = SWELL.reduce((s, w) => s + w.amp, 0);

export function swellAt(x, z, t) {
  let s = 0;
  for (let i = 0; i < SWELL.length; i++) {
    const W = SWELL[i];
    s += W.amp * Math.sin(W.kx * x + W.kz * z - W.w * t + W.phase);
  }
  return s;
}

/** Smooth non-repeating scalar in [-1,1]: two incommensurate sines. */
export function wob(freq, phase, t) {
  return (Math.sin(freq * t + phase) + 0.45 * Math.sin(2.37 * freq * t + 1.7 * phase + 0.6)) / 1.45;
}

const _ax = new THREE.Vector3(), _az = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0), _n = new THREE.Vector3(), _axis = new THREE.Vector3();

/**
 * motion descriptor (all optional):
 *  swell: multiplier (1 = rides the field)       ext: [hx, hz] footprint half-extents for tilt sampling
 *  ends:  true for route pieces - height matched exactly at the +-hz ends (joint continuity)
 *  bob:   { a, f, p }   extra vertical bob (m)    rot: { x, y, z, f, p } wobble amplitude (rad) per local axis
 *  sway:  { x, z, f, p } horizontal drift (m)      spin: { axis:[x,y,z], rate (rad/s), p }
 *  yaw:   { a, f, p }   world-vertical yaw sway about the body origin (path pieces that drift around)
 *  swing: { a, f, p }   pendulum swing (rad) about the body origin - hanging things in the heavy world
 */
const _pp = new THREE.Vector3(), _pq = new THREE.Quaternion(), _dq = new THREE.Quaternion();

/**
 * A motion parent is a virtual rigid body { basePos, baseQuat, motion } that several
 * bodies ride together (chunks of one house, pieces of one crumbling slab). Its pose
 * is cached per motion time because all children ask for it in the same frame.
 */
export function makeParent(pos, quat, motion) {
  return { basePos: pos.clone(), baseQuat: quat.clone(), motion, _t: NaN, _pos: new THREE.Vector3(), _quat: new THREE.Quaternion() };
}

function parentPose(par, tm) {
  if (par._t !== tm) {
    evalMotion(par, tm, par._pos, par._quat);
    par._t = tm;
  }
}

export function evalMotion(body, tm, outPos, outQuat) {
  const m = body.motion;
  if (!m) { outPos.copy(body.basePos); outQuat.copy(body.baseQuat); return; }
  if (m.parent) {
    const par = m.parent;
    parentPose(par, tm);
    _dq.copy(par.baseQuat).invert().premultiply(par._quat); // q_parent(t) * q_parent0^-1
    outPos.copy(body.basePos).sub(par.basePos).applyQuaternion(_dq).add(par._pos);
    outQuat.copy(_dq).multiply(body.baseQuat);
  } else {
    outPos.copy(body.basePos);
    outQuat.copy(body.baseQuat);
  }
  const bx = body.basePos.x, bz = body.basePos.z;

  if (m.swell && !m.parent) {
    const hx = m.ext ? m.ext[0] : 2, hz = m.ext ? m.ext[1] : 2;
    _ax.set(1, 0, 0).applyQuaternion(body.baseQuat); _ax.y = 0;
    _az.set(0, 0, 1).applyQuaternion(body.baseQuat); _az.y = 0;
    if (_ax.lengthSq() < 1e-6) _ax.set(1, 0, 0); else _ax.normalize();
    if (_az.lengthSq() < 1e-6) _az.set(0, 0, 1); else _az.normalize();
    const fxp = swellAt(bx + _ax.x * hx, bz + _ax.z * hx, tm), fxm = swellAt(bx - _ax.x * hx, bz - _ax.z * hx, tm);
    const fzp = swellAt(bx + _az.x * hz, bz + _az.z * hz, tm), fzm = swellAt(bx - _az.x * hz, bz - _az.z * hz, tm);
    // route pieces ('ends') match the field exactly at their two ends along Z, where
    // their joints are; everything else takes the least-squares plane of the 4 samples
    const h = m.ends ? (fzp + fzm) * 0.5 : (fxp + fxm + fzp + fzm) * 0.25;
    const sx = (fxp - fxm) / (2 * hx), sz = (fzp - fzm) / (2 * hz); // directional slopes
    // world gradient (axes are orthonormal in the horizontal plane for un-rolled bodies)
    const gx = sx * _ax.x + sz * _az.x, gz = sx * _ax.z + sz * _az.z;
    const k = m.swell;
    outPos.y += h * k;
    _n.set(-gx * k, 1, -gz * k).normalize();
    _q.setFromUnitVectors(_up, _n);
    outQuat.premultiply(_q);
  }
  if (m.yaw) {
    _q.setFromAxisAngle(_up, m.yaw.a * wob(m.yaw.f, m.yaw.p, tm));
    outQuat.premultiply(_q);
  }
  if (m.drift) {
    // slow separation along a fixed direction (cracks opening and closing)
    const k = m.drift.a * wob(m.drift.f, m.drift.p, tm);
    outPos.x += m.drift.d[0] * k; outPos.y += m.drift.d[1] * k; outPos.z += m.drift.d[2] * k;
  }
  if (m.bob) outPos.y += m.bob.a * wob(m.bob.f, m.bob.p, tm);
  if (m.sway) {
    outPos.x += m.sway.x * wob(m.sway.f, m.sway.p, tm);
    outPos.z += m.sway.z * wob(m.sway.f * 0.83, m.sway.p + 1.9, tm);
  }
  if (m.rot) {
    const r = m.rot;
    _e.set(r.x * wob(r.f, r.p, tm), r.y * wob(r.f * 0.71, r.p + 2.3, tm), r.z * wob(r.f * 1.13, r.p + 4.1, tm), 'YXZ');
    _q.setFromEuler(_e);
    outQuat.multiply(_q);
  }
  if (m.swing) {
    // a hanging thing (lamp, signal head, chandelier) swinging on its pivot = body origin
    const w = m.swing, env = 0.7 + 0.3 * Math.sin(0.11 * w.f * tm + 2 * w.p);
    _e.set(w.a * Math.sin(w.f * tm + w.p) * env, 0, w.a * 0.55 * Math.sin(w.f * tm + w.p + 1.3) * env, 'XYZ');
    _q.setFromEuler(_e);
    outQuat.multiply(_q);
  }
  if (m.spin) {
    _axis.fromArray(m.spin.axis).normalize();
    _q.setFromAxisAngle(_axis, m.spin.rate * tm + (m.spin.p || 0));
    outQuat.multiply(_q);
  }
}

/** Upper bound of how far a body can move away from its base pose (for broadphase). */
export function motionReach(m, radius, lever = 0) {
  if (!m) return 0;
  let d = 0;
  if (m.parent) d += motionReach(m.parent.motion, radius + lever);
  if (m.drift) d += Math.abs(m.drift.a);
  if (m.swell) d += SWELL_MAX * m.swell + radius * 0.06 * m.swell;
  if (m.bob) d += Math.abs(m.bob.a);
  if (m.sway) d += Math.hypot(m.sway.x, m.sway.z);
  if (m.rot) d += radius * (Math.abs(m.rot.x) + Math.abs(m.rot.y) + Math.abs(m.rot.z));
  if (m.yaw) d += radius * Math.abs(m.yaw.a);
  if (m.spin) d += radius;
  if (m.swing) d += radius * Math.abs(m.swing.a) * 1.6;
  return d;
}
