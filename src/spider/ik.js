import * as THREE from 'three';

// -----------------------------------------------------------------------
// Planar FABRIK inverse-kinematics solver.
//
// Real spider legs bend almost entirely within a single plane that
// contains the hip, the foot target and a "pole" direction (the body's
// dorsal/up axis carried into the leg). We exploit that biomechanical
// fact: instead of solving free 3D IK (which is prone to the knee
// randomly flipping to the wrong side — a classic tell-tale "fake" look)
// we build an orthonormal basis for that bend-plane every frame, solve a
// simple 2D FABRIK chain in it, and lift the result back into world
// space. This keeps every joint bending the anatomically correct way
// (upward/outward, exactly like the femur-patella "knee" of a real
// theraphosid) no matter how the target moves, including up walls and
// across ceilings.
// -----------------------------------------------------------------------

const EPS = 1e-6;

export class LegIKChain {
  /**
   * @param {number[]} lengths segment lengths, proximal -> distal
   *   (femur, patella, tibia, metatarsus, tarsus)
   */
  constructor(lengths) {
    this.lengths = lengths.slice();
    this.totalLength = lengths.reduce((a, b) => a + b, 0);
    this.n = lengths.length; // number of segments -> n+1 joints
    // 2D joint cache (in bend-plane space), persisted for temporal coherence.
    this.joints2D = null;
    this._initDefaultPose();
  }

  _initDefaultPose(bulge = 0.32) {
    const pts = [{ x: 0, y: 0 }];
    let cum = 0;
    for (let i = 0; i < this.n; i++) {
      cum += this.lengths[i];
      const frac = cum / this.totalLength;
      const x = cum * 0.92; // slightly folded, not fully extended at rest
      const y = Math.sin(Math.PI * frac) * this.totalLength * bulge;
      pts.push({ x, y });
    }
    this.joints2D = pts;
  }

  /**
   * Solve the chain so its tip reaches (as closely as reach allows) the
   * world-space target, hinging in the plane spanned by (hip->target) and
   * poleDir. Returns an array of THREE.Vector3 world joint positions,
   * length n+1 (hip included).
   */
  solve(hipWorld, targetWorld, poleDir, out) {
    const d = _v1.subVectors(targetWorld, hipWorld);
    let dist = d.length();
    if (dist < EPS) dist = EPS;
    const u = _v2.copy(d).multiplyScalar(1 / dist);

    // Build plane normal from (direction-to-target) x (pole).
    let n = _v3.crossVectors(u, poleDir);
    if (n.lengthSq() < 1e-8) {
      // pole nearly parallel to u -> fall back to world up, then to an
      // arbitrary perpendicular as a last resort.
      n.crossVectors(u, _worldUp);
      if (n.lengthSq() < 1e-8) n.crossVectors(u, _worldRight);
    }
    n.normalize();
    const v = _v4.crossVectors(n, u).normalize();

    // Clamp reach very slightly under full extension to avoid the
    // singularity jitter you get when a chain is perfectly straight.
    const maxReach = this.totalLength * 0.998;
    const reachDist = Math.min(dist, maxReach);

    const pts = this.joints2D;
    pts[0].x = 0; pts[0].y = 0;

    if (dist >= maxReach) {
      // Target out of reach: fully extend toward it in a straight line.
      let cum = 0;
      for (let i = 0; i < this.n; i++) {
        cum += this.lengths[i];
        pts[i + 1].x = (cum / this.totalLength) * reachDist;
        pts[i + 1].y = 0;
      }
    } else {
      const target2D = { x: reachDist, y: 0 };
      _fabrik(pts, this.lengths, target2D, 10);
    }

    // Lift 2D -> 3D.
    for (let i = 0; i <= this.n; i++) {
      const p = pts[i];
      out[i].copy(hipWorld).addScaledVector(u, p.x).addScaledVector(v, p.y);
    }
    return out;
  }
}

function _fabrik(pts, lengths, target, iterations) {
  const n = lengths.length;
  const origin = pts[0];
  for (let iter = 0; iter < iterations; iter++) {
    // backward: pull tip to target, walk toward base
    pts[n].x = target.x; pts[n].y = target.y;
    for (let i = n - 1; i >= 0; i--) {
      _stepTowards(pts[i + 1], pts[i], lengths[i], pts[i]);
    }
    // forward: pin base, walk toward tip
    pts[0].x = origin.x; pts[0].y = origin.y;
    for (let i = 0; i < n; i++) {
      _stepTowards(pts[i], pts[i + 1], lengths[i], pts[i + 1]);
    }
    const dx = pts[n].x - target.x, dy = pts[n].y - target.y;
    if (dx * dx + dy * dy < 1e-8) break;
  }
}

function _stepTowards(from, to, length, out) {
  const dx = to.x - from.x, dy = to.y - from.y;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < EPS) d = EPS;
  const s = length / d;
  out.x = from.x + dx * s;
  out.y = from.y + dy * s;
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _worldUp = new THREE.Vector3(0, 1, 0);
const _worldRight = new THREE.Vector3(1, 0, 0);
