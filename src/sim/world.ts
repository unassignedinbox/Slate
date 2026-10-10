/**
 * Rigid body layer.
 *
 * Deliberately small: fragments are convex (or extruded shells), so contacts
 * are resolved as point-vs-plane against the ground and as impulse exchanges
 * between bounding spheres for fragment-fragment. That is enough for debris —
 * the interesting physics in this project is in how the pieces were *made*.
 *
 * Bodies can be compound: a collapsing chunk of wall is one rigid island that
 * owns many block meshes, and it can shatter further on landing.
 */

import {
  V3, Quat, add, cross, dot, len, mul, norm, sub, v3, quat, qIntegrate, qRotate,
  qRotateInv, qToMat3, clamp, rng,
} from '../core/math';
import { MeshData } from '../geom/convex';
import { Material } from './materials';

export interface Piece {
  mesh: MeshData;
  offset: V3;        // local offset from body origin (= COM)
  mat: Material;
  seed: number;
  /** damage/whitening factor 0..1 for ductile materials */
  strain: number;
}

export interface BodyOpts {
  pos: V3; quat?: Quat; vel?: V3; omega?: V3;
  mass: number; inertia: Float32Array;  // body-space 3x3
  contacts: V3[]; radius: number;
  pieces: Piece[];
  mat: Material;
  isStatic?: boolean;
  /** blocks inside this island, used for further break-up */
  blocks?: BlockRef[];
}

export interface BlockRef {
  id: number;
  piece: Piece;
  contacts: V3[];
  mass: number;
  radius: number;
}

let BODY_ID = 1;

export class Body {
  id = BODY_ID++;
  pos: V3; quat: Quat; vel: V3; omega: V3;
  mass: number; invMass: number;
  invIbody: Float32Array;
  contacts: V3[];
  radius: number;
  pieces: Piece[];
  mat: Material;
  isStatic: boolean;
  sleeping = false;
  sleepTimer = 0;
  age = 0;
  blocks: BlockRef[];
  /** peak impact speed seen this frame, used to trigger secondary fracture */
  lastImpact = 0;

  constructor(o: BodyOpts) {
    this.pos = o.pos; this.quat = o.quat ?? quat();
    this.vel = o.vel ?? v3(); this.omega = o.omega ?? v3();
    this.mass = o.mass;
    this.isStatic = !!o.isStatic;
    this.invMass = this.isStatic ? 0 : 1 / Math.max(o.mass, 1e-6);
    this.invIbody = invert3(o.inertia, this.isStatic);
    this.contacts = o.contacts;
    this.radius = o.radius;
    this.pieces = o.pieces;
    this.mat = o.mat;
    this.blocks = o.blocks ?? [];
  }

  worldInvInertia(out = new Float32Array(9)): Float32Array {
    const R = qToMat3(this.quat);
    // out = R * Ibody^-1 * R^T
    const t = new Float32Array(9);
    mat3mul(R, this.invIbody, t);
    mat3mulT(t, R, out);
    return out;
  }

  pointVel(rWorld: V3): V3 {
    return add(this.vel, cross(this.omega, rWorld));
  }

  applyImpulse(j: V3, rWorld: V3): void {
    if (this.isStatic) return;
    this.vel = add(this.vel, mul(j, this.invMass));
    const invI = this.worldInvInertia();
    const t = cross(rWorld, j);
    this.omega = add(this.omega, v3(
      invI[0] * t.x + invI[3] * t.y + invI[6] * t.z,
      invI[1] * t.x + invI[4] * t.y + invI[7] * t.z,
      invI[2] * t.x + invI[5] * t.y + invI[8] * t.z,
    ));
  }
}

function invert3(m: Float32Array, isStatic: boolean): Float32Array {
  const out = new Float32Array(9);
  if (isStatic) return out;
  const a = m[0], b = m[3], c = m[6];
  const d = m[1], e = m[4], f = m[7];
  const g = m[2], h = m[5], i = m[8];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  let det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-16) {
    const s = 1 / Math.max(1e-9, (m[0] + m[4] + m[8]) / 3);
    out[0] = out[4] = out[8] = s;
    return out;
  }
  det = 1 / det;
  out[0] = A * det; out[1] = B * det; out[2] = C * det;
  out[3] = -(b * i - c * h) * det; out[4] = (a * i - c * g) * det; out[5] = -(a * h - b * g) * det;
  out[6] = (b * f - c * e) * det; out[7] = -(a * f - c * d) * det; out[8] = (a * e - b * d) * det;
  return out;
}

function mat3mul(a: Float32Array, b: Float32Array, out: Float32Array): void {
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++)
      out[c * 3 + r] = a[r] * b[c * 3] + a[3 + r] * b[c * 3 + 1] + a[6 + r] * b[c * 3 + 2];
}
/** out = a * b^T */
function mat3mulT(a: Float32Array, b: Float32Array, out: Float32Array): void {
  for (let c = 0; c < 3; c++)
    for (let r = 0; r < 3; r++)
      out[c * 3 + r] = a[r] * b[c] + a[3 + r] * b[3 + c] + a[6 + r] * b[6 + c];
}

export interface WorldOpts { gravity?: number; groundY?: number; }

export class World {
  bodies: Body[] = [];
  gravity: number;
  groundY: number;
  rand = rng(99);
  /** callback when a body lands hard enough to break further */
  onHardLanding: ((b: Body, speed: number, point: V3) => void) | null = null;
  timeScale = 1;

  constructor(o: WorldOpts = {}) {
    this.gravity = o.gravity ?? -9.81;
    this.groundY = o.groundY ?? 0;
  }

  add(b: Body): Body { this.bodies.push(b); return b; }
  remove(b: Body): void {
    const i = this.bodies.indexOf(b);
    if (i >= 0) this.bodies.splice(i, 1);
  }
  clear(): void { this.bodies.length = 0; }

  step(dt: number): void {
    const g = this.gravity;
    // integrate
    for (const b of this.bodies) {
      if (b.isStatic || b.sleeping) continue;
      b.age += dt;
      b.vel.y += g * dt;
      const damp = Math.exp(-0.25 * dt);
      b.vel = mul(b.vel, damp);
      b.omega = mul(b.omega, Math.exp(-0.5 * dt));
      b.pos = add(b.pos, mul(b.vel, dt));
      b.quat = qIntegrate(b.quat, b.omega, dt);
      b.lastImpact = 0;
    }

    // ground contacts (2 relaxation passes)
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.bodies) {
        if (b.isStatic || b.sleeping) continue;
        this.groundContacts(b, dt, iter === 0);
      }
    }
    this.pairCollisions();

    // sleeping + culling
    for (let i = this.bodies.length - 1; i >= 0; i--) {
      const b = this.bodies[i];
      if (b.isStatic) continue;
      if (b.pos.y < this.groundY - 20) { this.bodies.splice(i, 1); continue; }
      const speed = len(b.vel) + len(b.omega) * b.radius;
      if (speed < 0.06) {
        b.sleepTimer += dt;
        if (b.sleepTimer > 0.55) { b.sleeping = true; b.vel = v3(); b.omega = v3(); }
      } else b.sleepTimer = 0;
    }
  }

  wake(b: Body): void { b.sleeping = false; b.sleepTimer = 0; }

  private groundContacts(b: Body, dt: number, reportImpact: boolean): void {
    const mat = b.mat;
    let deepest = 0;
    let impactSpeed = 0;
    let impactPoint: V3 | null = null;

    for (const c of b.contacts) {
      const r = qRotate(b.quat, c);
      const p = add(b.pos, r);
      const pen = this.groundY - p.y;
      if (pen <= 0) continue;
      deepest = Math.max(deepest, pen);
      const vAt = b.pointVel(r);
      const vn = vAt.y;
      if (vn < -impactSpeed) { impactSpeed = -vn; impactPoint = p; }
      if (vn > 0) continue;

      const n = v3(0, 1, 0);
      const invI = b.worldInvInertia();
      const rn = cross(r, n);
      const term = v3(
        invI[0] * rn.x + invI[3] * rn.y + invI[6] * rn.z,
        invI[1] * rn.x + invI[4] * rn.y + invI[7] * rn.z,
        invI[2] * rn.x + invI[5] * rn.y + invI[8] * rn.z,
      );
      const denom = b.invMass + dot(cross(term, r), n);
      if (denom <= 0) continue;
      const e = len(b.vel) > 0.4 ? mat.restitution : 0;
      const bias = Math.max(0, pen - 0.0008) * 0.25 / Math.max(dt, 1e-4);
      let jn = (-(1 + e) * vn + bias) / denom;
      jn = Math.max(0, jn) / Math.max(1, b.contacts.length * 0.35);
      b.applyImpulse(mul(n, jn), r);

      // Coulomb friction
      const vAt2 = b.pointVel(r);
      const vt = v3(vAt2.x, 0, vAt2.z);
      const vtl = len(vt);
      if (vtl > 1e-5) {
        const tdir = mul(vt, -1 / vtl);
        const rt = cross(r, tdir);
        const termT = v3(
          invI[0] * rt.x + invI[3] * rt.y + invI[6] * rt.z,
          invI[1] * rt.x + invI[4] * rt.y + invI[7] * rt.z,
          invI[2] * rt.x + invI[5] * rt.y + invI[8] * rt.z,
        );
        const dt2 = b.invMass + dot(cross(termT, r), tdir);
        let jt = vtl / Math.max(dt2, 1e-9) / Math.max(1, b.contacts.length * 0.35);
        jt = Math.min(jt, mat.friction * jn);
        b.applyImpulse(mul(tdir, jt), r);
      }
    }
    if (deepest > 0) {
      b.pos.y += Math.min(deepest, 0.05) * 0.4;
      this.wake(b);
    }
    if (reportImpact && impactSpeed > 1.2 && impactPoint && this.onHardLanding) {
      b.lastImpact = impactSpeed;
      this.onHardLanding(b, impactSpeed, impactPoint);
    }
  }

  /** Bounding-sphere impulses so debris piles instead of interpenetrating. */
  private pairCollisions(): void {
    const n = this.bodies.length;
    if (n < 2) return;
    // uniform grid broadphase
    let cell = 0;
    for (const b of this.bodies) cell += b.radius;
    cell = Math.max(0.05, (cell / n) * 2.2);
    const map = new Map<number, Body[]>();
    const key = (x: number, y: number, z: number) =>
      (((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) | 0);
    for (const b of this.bodies) {
      const k = key(Math.floor(b.pos.x / cell), Math.floor(b.pos.y / cell), Math.floor(b.pos.z / cell));
      const l = map.get(k);
      if (l) l.push(b); else map.set(k, [b]);
    }
    const checked = new Set<number>();
    for (const b of this.bodies) {
      const bi = Math.floor(b.pos.x / cell), bj = Math.floor(b.pos.y / cell), bk = Math.floor(b.pos.z / cell);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        const l = map.get(key(bi + dx, bj + dy, bk + dz));
        if (!l) continue;
        for (const o of l) {
          if (o.id <= b.id) continue;
          const pk = b.id * 100003 + o.id;
          if (checked.has(pk)) continue;
          checked.add(pk);
          this.resolvePair(b, o);
        }
      }
    }
  }

  private resolvePair(a: Body, b: Body): void {
    if (a.isStatic && b.isStatic) return;
    // Slightly shrunken spheres: real fragments are flat, full spheres bounce.
    const ra = a.radius * 0.72, rb = b.radius * 0.72;
    const d = sub(b.pos, a.pos);
    const dist = len(d);
    const pen = ra + rb - dist;
    if (pen <= 0 || dist < 1e-9) return;
    const n = mul(d, 1 / dist);
    const rel = sub(b.pointVel(mul(n, -rb)), a.pointVel(mul(n, ra)));
    const vn = dot(rel, n);
    const invSum = a.invMass + b.invMass;
    if (invSum <= 0) return;
    if (vn < 0) {
      const e = Math.min(a.mat.restitution, b.mat.restitution) * 0.5;
      const j = (-(1 + e) * vn) / invSum;
      const J = mul(n, j);
      a.applyImpulse(mul(J, -1), mul(n, ra));
      b.applyImpulse(J, mul(n, -rb));
      if (Math.abs(vn) > 0.3) { this.wake(a); this.wake(b); }
    }
    const corr = mul(n, (pen * 0.35) / invSum);
    if (!a.isStatic) a.pos = sub(a.pos, mul(corr, a.invMass));
    if (!b.isStatic) b.pos = add(b.pos, mul(corr, b.invMass));
  }
}

// -------------------------------------------------------------- structures

/**
 * Bonded structure (buildings).
 *
 * Each block is a node; bonds are mortar joints with a tensile/shear strength
 * proportional to their contact area. A structural pass pushes gravity load
 * down the graph; joints that exceed their strength snap, islands that lose
 * their path to the ground go dynamic. That is how Red Faction: Guerrilla and
 * The Finals do progressive collapse, and it is dramatically better than
 * "spawn debris at the impact point".
 */
export interface Bond { a: number; b: number; strength: number; area: number; broken: boolean; }

export class Structure {
  bonds: Bond[] = [];
  /** per-block accumulated load [N] */
  load: Float64Array;
  grounded: Uint8Array;
  alive: Uint8Array;

  constructor(public blockCount: number, public weights: Float64Array, public heights: Float64Array) {
    this.load = new Float64Array(blockCount);
    this.grounded = new Uint8Array(blockCount);
    this.alive = new Uint8Array(blockCount).fill(1);
  }

  addBond(a: number, b: number, area: number, strength: number): void {
    this.bonds.push({ a, b, strength: strength * area, area, broken: false });
  }

  /** Union-find over intact bonds; returns island id per block. */
  islands(): Int32Array {
    const p = new Int32Array(this.blockCount);
    for (let i = 0; i < p.length; i++) p[i] = i;
    const find = (x: number): number => { while (p[x] !== x) { p[x] = p[p[x]]; x = p[x]; } return x; };
    for (const b of this.bonds) {
      if (b.broken || !this.alive[b.a] || !this.alive[b.b]) continue;
      const ra = find(b.a), rb = find(b.b);
      if (ra !== rb) p[ra] = rb;
    }
    for (let i = 0; i < p.length; i++) p[i] = find(i);
    return p;
  }

  /**
   * Propagate weight down the bond graph and snap overloaded joints.
   * Returns true if anything broke (caller should re-island).
   */
  relax(): boolean {
    const order = Array.from({ length: this.blockCount }, (_, i) => i)
      .filter((i) => this.alive[i])
      .sort((a, b) => this.heights[b] - this.heights[a]);   // top first
    this.load.fill(0);
    for (const i of order) this.load[i] += this.weights[i];

    let broke = false;
    for (const i of order) {
      // find bonded neighbours strictly below
      const below: Bond[] = [];
      let areaSum = 0;
      for (const bd of this.bonds) {
        if (bd.broken) continue;
        const other = bd.a === i ? bd.b : bd.b === i ? bd.a : -1;
        if (other < 0 || !this.alive[other]) continue;
        if (this.heights[other] < this.heights[i] - 1e-4) { below.push(bd); areaSum += bd.area; }
      }
      if (!below.length) continue;
      for (const bd of below) {
        const share = this.load[i] * (bd.area / areaSum);
        const other = bd.a === i ? bd.b : bd.a;
        if (share > bd.strength) { bd.broken = true; broke = true; }
        else this.load[other] += share;
      }
    }
    return broke;
  }

  /** Break every bond touching a block (it was destroyed). */
  kill(block: number): void {
    this.alive[block] = 0;
    for (const b of this.bonds) if (b.a === block || b.b === block) b.broken = true;
  }

  /** Weaken bonds within radius of a blast, snapping the weakest. */
  blast(centres: V3[], positions: V3[], radius: number, energy: number): void {
    for (const b of this.bonds) {
      if (b.broken) continue;
      const mid = mul(add(positions[b.a], positions[b.b]), 0.5);
      let d = Infinity;
      for (const c of centres) d = Math.min(d, len(sub(mid, c)));
      if (d > radius) continue;
      const f = energy * Math.pow(clamp(1 - d / radius, 0, 1), 2);
      if (f * 1000 > b.strength) b.broken = true;
    }
  }
}

export { qRotateInv, norm };
