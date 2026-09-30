// ---------------------------------------------------------------------------
// Lightweight rigid-body world for fracture debris: semi-implicit integration,
// vertex-vs-ground contacts with impulse + friction, angular response,
// sleeping, debris lifetime management. This is intentionally shard-focused —
// in a shipping AAA title you'd feed the same hulls to PhysX/Jolt/Chaos.
// ---------------------------------------------------------------------------
import * as THREE from 'three';

export interface BodyOptions {
  mass?: number;
  restitution?: number;
  friction?: number;
  /** seconds until the body shrinks away and is removed (0 = keep forever) */
  life?: number;
  onSleep?: (b: RigidBody) => void;
}

export class RigidBody {
  mesh: THREE.Object3D;
  verts: THREE.Vector3[]; // local-space contact points (centroid at origin)
  radius: number;
  pos: THREE.Vector3;
  quat = new THREE.Quaternion();
  vel = new THREE.Vector3();
  angVel = new THREE.Vector3();
  invMass: number;
  invI: number;
  restitution: number;
  friction: number;
  sleeping = false;
  sleepTimer = 0;
  age = 0;
  life: number;
  onSleep?: (b: RigidBody) => void;

  constructor(mesh: THREE.Object3D, verts: THREE.Vector3[], radius: number, opts: BodyOptions = {}) {
    this.mesh = mesh;
    this.verts = verts;
    this.radius = Math.max(radius, 0.005);
    this.pos = mesh.position.clone();
    this.quat.copy(mesh.quaternion);
    const mass = opts.mass ?? 1;
    this.invMass = mass > 0 ? 1 / mass : 0;
    // sphere-ish inertia approximation
    const I = 0.4 * mass * this.radius * this.radius;
    this.invI = I > 0 ? 1 / I : 0;
    this.restitution = opts.restitution ?? 0.25;
    this.friction = opts.friction ?? 0.55;
    this.life = opts.life ?? 0;
    this.onSleep = opts.onSleep;
  }

  wake(): void {
    this.sleeping = false;
    this.sleepTimer = 0;
  }
}

const tmpV = new THREE.Vector3();
const tmpV2 = new THREE.Vector3();
const tmpV3 = new THREE.Vector3();

export class PhysicsWorld {
  bodies: RigidBody[] = [];
  gravity = new THREE.Vector3(0, -9.81, 0);
  maxBodies = 420;
  /** static AABB obstacles (only their top faces push bodies up — enough for
   * debris resting on supports/pedestals) */
  staticBoxes: THREE.Box3[] = [];
  private removeQueue: RigidBody[] = [];
  onRemove?: (b: RigidBody) => void;

  add(body: RigidBody): void {
    this.bodies.push(body);
    // Debris budget: evict oldest sleeping small bodies first (AAA trick:
    // debris pools with priority eviction).
    if (this.bodies.length > this.maxBodies) {
      let evict: RigidBody | null = null;
      for (const b of this.bodies) {
        if (b.sleeping && (evict === null || b.radius < evict.radius)) evict = b;
      }
      if (!evict) evict = this.bodies[0];
      this.remove(evict);
    }
  }

  remove(body: RigidBody): void {
    const i = this.bodies.indexOf(body);
    if (i >= 0) this.bodies.splice(i, 1);
    this.onRemove?.(body);
  }

  step(dt: number): void {
    if (dt <= 0) return;
    this.removeQueue.length = 0;

    for (const b of this.bodies) {
      b.age += dt;
      if (b.life > 0 && b.age > b.life) {
        // shrink out
        const k = Math.max(0, 1 - (b.age - b.life) / 0.4);
        b.mesh.scale.setScalar(k);
        if (k <= 0.02) {
          this.removeQueue.push(b);
          continue;
        }
      }
      if (b.sleeping) continue;

      // integrate
      b.vel.addScaledVector(this.gravity, dt);
      b.vel.multiplyScalar(1 - 0.06 * dt);
      b.angVel.multiplyScalar(1 - 0.35 * dt);
      b.pos.addScaledVector(b.vel, dt);
      if (b.angVel.lengthSq() > 1e-10) {
        const w = b.angVel;
        const q = new THREE.Quaternion(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0);
        q.multiply(b.quat);
        b.quat.x += q.x; b.quat.y += q.y; b.quat.z += q.z; b.quat.w += q.w;
        b.quat.normalize();
      }

      // ground contacts (y = 0)
      let touching = false;
      let deepest = 0;
      for (const lv of b.verts) {
        tmpV.copy(lv).applyQuaternion(b.quat).add(b.pos);
        let pen = -tmpV.y;
        // static box tops act as local ground
        for (const box of this.staticBoxes) {
          if (
            tmpV.x > box.min.x && tmpV.x < box.max.x &&
            tmpV.z > box.min.z && tmpV.z < box.max.z &&
            tmpV.y < box.max.y && tmpV.y > box.min.y - 0.02
          ) {
            const boxPen = box.max.y - tmpV.y;
            if (boxPen < 0.12 && boxPen > pen) pen = boxPen;
          }
        }
        if (pen > 0) {
          touching = true;
          if (pen > deepest) deepest = pen;
          // contact impulse at this vertex
          const r = tmpV2.copy(tmpV).sub(b.pos); // contact offset
          // velocity at point
          const vp = tmpV3.copy(b.angVel).cross(r).add(b.vel);
          if (vp.y < 0) {
            const rCrossN = new THREE.Vector3(r.z, 0, -r.x); // r x n, n = (0,1,0)
            const k = b.invMass + b.invI * rCrossN.lengthSq();
            const jn = (-(1 + b.restitution) * vp.y) / k;
            const imp = new THREE.Vector3(0, jn, 0);
            // friction
            const vt = new THREE.Vector3(vp.x, 0, vp.z);
            const vtLen = vt.length();
            if (vtLen > 1e-5) {
              const jt = Math.min(b.friction * jn, vtLen / k);
              imp.addScaledVector(vt.normalize(), -jt);
            }
            b.vel.addScaledVector(imp, b.invMass);
            b.angVel.addScaledVector(new THREE.Vector3().crossVectors(r, imp), b.invI);
          }
        }
      }
      if (deepest > 0) b.pos.y += deepest;

      // sleeping
      if (touching && b.vel.lengthSq() < 0.0035 && b.angVel.lengthSq() < 0.02) {
        b.sleepTimer += dt;
        if (b.sleepTimer > 0.6) {
          b.sleeping = true;
          b.vel.set(0, 0, 0);
          b.angVel.set(0, 0, 0);
          b.onSleep?.(b);
        }
      } else {
        b.sleepTimer = 0;
      }

      // kill-plane
      if (b.pos.y < -20) this.removeQueue.push(b);

      b.mesh.position.copy(b.pos);
      b.mesh.quaternion.copy(b.quat);
    }

    for (const b of this.removeQueue) this.remove(b);
  }

  clear(): void {
    for (const b of this.bodies.slice()) this.remove(b);
  }
}
