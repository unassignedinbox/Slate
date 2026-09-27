import * as THREE from 'three';
import { clamp } from '../util/mathx.js';

// ---------------------------------------------------------------------------
// Particle + decal system: explosions, dust, sparks, engine smoke, scorch
// marks. Everything is pooled into two instanced meshes.
// ---------------------------------------------------------------------------

const MAX = 900;
const MAX_DECALS = 80;

const _c = new THREE.Color();

export class Effects {
  constructor(scene, field) {
    this.field = field;
    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    // unlit: the colour ramp *is* the look, and it stops fireballs blowing
    // out to white under the tone mapper
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.92, depthWrite: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'particles';
    scene.add(this.mesh);

    this.p = [];
    for (let i = 0; i < MAX; i++) {
      this.p.push({
        alive: false,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        rot: new THREE.Euler(),
        spin: new THREE.Vector3(),
        life: 0,
        maxLife: 1,
        size0: 1,
        size1: 1,
        c0: new THREE.Color(),
        c1: new THREE.Color(),
        gravity: -9,
        drag: 0.6,
        bounce: false,
      });
    }
    this._dummy = new THREE.Object3D();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
    this._cursor = 0;

    // scorch decals
    const dgeo = new THREE.CircleGeometry(1, 12);
    dgeo.rotateX(-Math.PI / 2);
    const dmat = new THREE.MeshLambertMaterial({ color: 0x1d1a16, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.decals = new THREE.InstancedMesh(dgeo, dmat, MAX_DECALS);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decals.frustumCulled = false;
    this.decals.count = MAX_DECALS;
    for (let i = 0; i < MAX_DECALS; i++) this.decals.setMatrixAt(i, this._zero);
    scene.add(this.decals);
    this._decalCursor = 0;
  }

  _take() {
    for (let i = 0; i < MAX; i++) {
      const p = this.p[(this._cursor + i) % MAX];
      if (!p.alive) {
        this._cursor = (this._cursor + i + 1) % MAX;
        return p;
      }
    }
    return null;
  }

  spawn(opts) {
    const p = this._take();
    if (!p) return;
    p.alive = true;
    p.pos.copy(opts.pos);
    p.vel.copy(opts.vel || { x: 0, y: 0, z: 0 });
    p.rot.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
    p.spin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    p.life = 0;
    p.maxLife = opts.life ?? 1;
    p.size0 = opts.size0 ?? 1;
    p.size1 = opts.size1 ?? 1;
    p.c0.set(opts.c0 ?? 0xffffff);
    p.c1.set(opts.c1 ?? 0x888888);
    p.gravity = opts.gravity ?? -9;
    p.drag = opts.drag ?? 0.6;
    p.bounce = !!opts.bounce;
  }

  scorch(x, z, radius) {
    const i = this._decalCursor++ % MAX_DECALS;
    const d = this._dummy;
    d.position.set(x, this.field.height(x, z) + 0.08, z);
    d.rotation.set(0, Math.random() * 6.28, 0);
    d.scale.setScalar(radius);
    d.updateMatrix();
    this.decals.setMatrixAt(i, d.matrix);
    this.decals.instanceMatrix.needsUpdate = true;
  }

  explosion(pos, power = 1, { scorch = true } = {}) {
    const n = Math.round(10 + power * 8);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (4 + Math.random() * 11) * power;
      this.spawn({
        pos,
        vel: new THREE.Vector3(Math.cos(a) * sp * 0.6, 4 + Math.random() * 9 * power, Math.sin(a) * sp * 0.6),
        life: 0.45 + Math.random() * 0.6,
        size0: 0.55 * power,
        size1: 1.9 * power,
        c0: 0xff9226,
        c1: 0x3f3d39,
        gravity: 1.5,
        drag: 1.8,
      });
    }
    // earth thrown up
    for (let i = 0; i < Math.round(8 + power * 6); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (5 + Math.random() * 14) * power;
      this.spawn({
        pos,
        vel: new THREE.Vector3(Math.cos(a) * sp, 8 + Math.random() * 14 * power, Math.sin(a) * sp),
        life: 1.1 + Math.random() * 0.9,
        size0: 0.5 * power,
        size1: 0.35 * power,
        c0: 0x6a5a40,
        c1: 0x4a4030,
        gravity: -19,
        drag: 0.2,
      });
    }
    // low dust ring
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.spawn({
        pos: new THREE.Vector3(pos.x + Math.cos(a) * 1.5, pos.y + 0.4, pos.z + Math.sin(a) * 1.5),
        vel: new THREE.Vector3(Math.cos(a) * 13 * power, 1.2, Math.sin(a) * 13 * power),
        life: 0.85,
        size0: 0.8 * power,
        size1: 2.8 * power,
        c0: 0xa8977b,
        c1: 0x8d7f68,
        gravity: 0.4,
        drag: 2.6,
      });
    }
    // a couple of slow smoke balls left hanging over the crater
    for (let i = 0; i < 3 + Math.round(power); i++) {
      this.spawn({
        pos: new THREE.Vector3(pos.x + (Math.random() - 0.5) * 2, pos.y + 1, pos.z + (Math.random() - 0.5) * 2),
        vel: new THREE.Vector3((Math.random() - 0.5) * 2, 2.5 + Math.random() * 2, (Math.random() - 0.5) * 2),
        life: 1.8 + Math.random(),
        size0: 0.9 * power,
        size1: 2.6 * power,
        c0: 0x4a4744,
        c1: 0x8e8a84,
        gravity: 1.0,
        drag: 1.3,
      });
    }
    if (scorch) this.scorch(pos.x, pos.z, 3 + power * 2.4);
  }

  dust(pos, power = 1) {
    for (let i = 0; i < 4; i++) {
      this.spawn({
        pos,
        vel: new THREE.Vector3((Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3),
        life: 0.35 + Math.random() * 0.3,
        size0: 0.18 * power,
        size1: 0.85 * power,
        c0: 0xc4b596,
        c1: 0xa2937a,
        gravity: -1.5,
        drag: 2.2,
      });
    }
  }

  sparks(pos, dir) {
    for (let i = 0; i < 6; i++) {
      this.spawn({
        pos,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 9 + (dir ? dir.x * 4 : 0),
          Math.random() * 6,
          (Math.random() - 0.5) * 9 + (dir ? dir.z * 4 : 0),
        ),
        life: 0.22 + Math.random() * 0.2,
        size0: 0.12,
        size1: 0.02,
        c0: 0xffe9a8,
        c1: 0xff7a2a,
        gravity: -14,
        drag: 0.3,
      });
    }
  }

  smoke(pos, power = 1, colorA = 0x3c3c3c, colorB = 0x8a8a8a) {
    this.spawn({
      pos,
      vel: new THREE.Vector3((Math.random() - 0.5) * 1.2, 1.6 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2),
      life: 1.2 + Math.random(),
      size0: 0.4 * power,
      size1: 2.4 * power,
      c0: colorA,
      c1: colorB,
      gravity: 1.1,
      drag: 1.0,
    });
  }

  splash(pos, power = 1) {
    for (let i = 0; i < 8; i++) {
      const a = Math.random() * Math.PI * 2;
      this.spawn({
        pos,
        vel: new THREE.Vector3(Math.cos(a) * 4 * power, 5 + Math.random() * 6, Math.sin(a) * 4 * power),
        life: 0.6,
        size0: 0.3 * power,
        size1: 1.1 * power,
        c0: 0xdfeef2,
        c1: 0x86b2c0,
        gravity: -13,
        drag: 0.8,
      });
    }
  }

  update(dt) {
    const d = this._dummy;
    for (let i = 0; i < MAX; i++) {
      const p = this.p[i];
      if (!p.alive) {
        this.mesh.setMatrixAt(i, this._zero);
        continue;
      }
      p.life += dt;
      const t = p.life / p.maxLife;
      if (t >= 1) {
        p.alive = false;
        this.mesh.setMatrixAt(i, this._zero);
        continue;
      }
      p.vel.y += p.gravity * dt;
      p.vel.multiplyScalar(clamp(1 - p.drag * dt, 0, 1));
      p.pos.addScaledVector(p.vel, dt);
      if (p.bounce) {
        const g = this.field.height(p.pos.x, p.pos.z);
        if (p.pos.y < g) {
          p.pos.y = g;
          p.vel.y *= -0.35;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
        }
      }
      p.rot.x += p.spin.x * dt;
      p.rot.y += p.spin.y * dt;
      p.rot.z += p.spin.z * dt;

      const size = p.size0 + (p.size1 - p.size0) * t;
      d.position.copy(p.pos);
      d.rotation.copy(p.rot);
      d.scale.setScalar(Math.max(0.001, size * (1 - Math.pow(t, 6))));
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
      _c.copy(p.c0).lerp(p.c1, clamp(t * 1.4, 0, 1));
      this.mesh.setColorAt(i, _c);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
