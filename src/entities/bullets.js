import * as THREE from 'three';
import { WEAPONS } from '../config.js';

// ---------------------------------------------------------------------------
// Ballistics. These are NOT laser beams: each round is a short tracer streak
// that travels at ~235 m/s, drops under gravity, arrives late at long range
// and can miss behind you. Only every third round carries a tracer element,
// so the fire reads as bursts of aimed shots rather than a light show.
// ---------------------------------------------------------------------------

const GRAVITY = 9.0;

export class BulletPool {
  constructor(scene, max = 512) {
    this.max = max;
    this.bullets = [];
    for (let i = 0; i < max; i++) {
      this.bullets.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        life: 0,
        tracer: false,
      });
    }
    const geo = new THREE.BoxGeometry(0.075, 0.075, 1.0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc457, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'tracers';
    scene.add(this.mesh);

    // dull core rounds (non-tracer) - tiny, grey, barely visible
    const geo2 = new THREE.BoxGeometry(0.05, 0.05, 0.5);
    const mat2 = new THREE.MeshBasicMaterial({ color: 0x8b8b7a, fog: true });
    this.meshDull = new THREE.InstancedMesh(geo2, mat2, max);
    this.meshDull.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.meshDull.frustumCulled = false;
    scene.add(this.meshDull);

    this._dummy = new THREE.Object3D();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._next = 0;
  }

  spawn(origin, dir, speed = WEAPONS.bulletSpeed, tracer = false) {
    let b = null;
    for (let i = 0; i < this.max; i++) {
      const cand = this.bullets[(this._next + i) % this.max];
      if (!cand.alive) {
        b = cand;
        this._next = (this._next + i + 1) % this.max;
        break;
      }
    }
    if (!b) return null;
    b.alive = true;
    b.pos.copy(origin);
    b.vel.copy(dir).normalize().multiplyScalar(speed);
    b.life = 4.0;
    b.tracer = tracer;
    return b;
  }

  /**
   * @param {function} onHit (bulletPos, kind) -> void
   * @param {object} target { pos: Vector3, radius } or null
   */
  update(dt, field, target, onHit) {
    const d = this._dummy;
    for (let i = 0; i < this.max; i++) {
      const b = this.bullets[i];
      const mesh = b.tracer ? this.mesh : this.meshDull;
      const other = b.tracer ? this.meshDull : this.mesh;
      if (!b.alive) {
        this.mesh.setMatrixAt(i, this._zero);
        this.meshDull.setMatrixAt(i, this._zero);
        continue;
      }
      b.vel.y -= GRAVITY * dt;
      const step = b.vel.clone().multiplyScalar(dt);
      const nx = b.pos.x + step.x;
      const ny = b.pos.y + step.y;
      const nz = b.pos.z + step.z;

      // hit the car? (swept sphere test against the segment)
      if (target) {
        const cx = target.pos.x - b.pos.x;
        const cy = target.pos.y + 0.8 - b.pos.y;
        const cz = target.pos.z - b.pos.z;
        const sl = step.length();
        if (sl > 1e-5) {
          const t = Math.max(0, Math.min(1, (cx * step.x + cy * step.y + cz * step.z) / (sl * sl)));
          const px = b.pos.x + step.x * t;
          const py = b.pos.y + step.y * t;
          const pz = b.pos.z + step.z * t;
          if (Math.hypot(px - target.pos.x, py - (target.pos.y + 0.8), pz - target.pos.z) < target.radius) {
            b.alive = false;
            onHit({ x: px, y: py, z: pz }, 'car');
            continue;
          }
        }
      }

      const ground = field.height(nx, nz);
      if (ny <= ground) {
        b.alive = false;
        onHit({ x: nx, y: ground, z: nz }, 'ground');
        continue;
      }

      b.pos.set(nx, ny, nz);
      b.life -= dt;
      if (b.life <= 0 || Math.abs(nx) > 900 || nz > 900 || nz < -3400) {
        b.alive = false;
        continue;
      }

      d.position.copy(b.pos);
      d.lookAt(b.pos.x + b.vel.x, b.pos.y + b.vel.y, b.pos.z + b.vel.z);
      const stretch = b.tracer ? 2.4 : 1.4;
      d.scale.set(1, 1, stretch);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      other.setMatrixAt(i, this._zero);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.meshDull.instanceMatrix.needsUpdate = true;
  }
}
