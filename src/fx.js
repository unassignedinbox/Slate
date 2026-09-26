import * as THREE from 'three';
import { clamp, lerp, Rng } from './util.js';

const rng = new Rng(4242);

function softCircleTexture(inner = 0.0, power = 2.2) {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.sqrt(dx * dx + dy * dy) * 2;
      let a = clamp(1 - d, 0, 1);
      a = Math.pow(a, power);
      if (d < inner) a = 1;
      const i = (y * size + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const particleVert = /* glsl */ `
  attribute float psize;
  attribute float palpha;
  attribute vec3 pcolor;
  varying vec3 vC;
  varying float vA;
  void main() {
    vC = pcolor;
    vA = palpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = psize * (420.0 / max(-mv.z, 1.0));
    gl_Position = projectionMatrix * mv;
  }
`;

const particleFrag = /* glsl */ `
  uniform sampler2D uMap;
  varying vec3 vC;
  varying float vA;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    float a = t.a * vA;
    if (a < 0.01) discard;
    gl_FragColor = vec4(vC, a);
  }
`;

class ParticlePool {
  constructor(scene, max, blending, texture, renderOrder = 5) {
    this.max = max;
    this.count = 0;
    this.cursor = 0;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.alphas = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.size1 = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    this.gravity = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.active = new Uint8Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geo.setAttribute('pcolor', new THREE.BufferAttribute(this.colors, 3));
    geo.setAttribute('psize', new THREE.BufferAttribute(this.sizes, 1));
    geo.setAttribute('palpha', new THREE.BufferAttribute(this.alphas, 1));
    geo.setDrawRange(0, max);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 3000);

    const matl = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: texture } },
      vertexShader: particleVert,
      fragmentShader: particleFrag,
      transparent: true,
      depthWrite: false,
      blending,
    });
    this.points = new THREE.Points(geo, matl);
    this.points.frustumCulled = false;
    this.points.renderOrder = renderOrder;
    scene.add(this.points);
    this.geo = geo;
  }

  spawn(x, y, z, opts) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.positions[i3] = x;
    this.positions[i3 + 1] = y;
    this.positions[i3 + 2] = z;
    this.vel[i3] = opts.vx || 0;
    this.vel[i3 + 1] = opts.vy || 0;
    this.vel[i3 + 2] = opts.vz || 0;
    const c = opts.color !== undefined ? opts.color : 0xffffff;
    const col = typeof c === 'number' ? new THREE.Color(c) : c;
    this.colors[i3] = col.r;
    this.colors[i3 + 1] = col.g;
    this.colors[i3 + 2] = col.b;
    this.life[i] = 0;
    this.maxLife[i] = opts.life || 1;
    this.size0[i] = opts.size || 1;
    this.size1[i] = opts.size1 !== undefined ? opts.size1 : opts.size || 1;
    this.alpha0[i] = opts.alpha !== undefined ? opts.alpha : 1;
    this.gravity[i] = opts.gravity !== undefined ? opts.gravity : 0;
    this.drag[i] = opts.drag !== undefined ? opts.drag : 0.6;
    this.sizes[i] = this.size0[i];
    this.alphas[i] = this.alpha0[i];
    this.active[i] = 1;
  }

  update(dt) {
    const { positions, vel, life, maxLife } = this;
    for (let i = 0; i < this.max; i++) {
      if (!this.active[i]) continue;
      const i3 = i * 3;
      life[i] += dt;
      const t = life[i] / maxLife[i];
      if (t >= 1) {
        this.active[i] = 0;
        this.alphas[i] = 0;
        this.sizes[i] = 0;
        continue;
      }
      const d = Math.exp(-this.drag[i] * dt);
      vel[i3] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d + this.gravity[i] * dt;
      vel[i3 + 2] *= d;
      positions[i3] += vel[i3] * dt;
      positions[i3 + 1] += vel[i3 + 1] * dt;
      positions[i3 + 2] += vel[i3 + 2] * dt;
      this.sizes[i] = lerp(this.size0[i], this.size1[i], t);
      this.alphas[i] = this.alpha0[i] * (1 - t * t);
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.psize.needsUpdate = true;
    this.geo.attributes.palpha.needsUpdate = true;
    this.geo.attributes.pcolor.needsUpdate = true;
  }
}

class TracerRenderer {
  constructor(scene, max = 220) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const matl = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, matl, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.count = 0;
    scene.add(this.mesh);
    this.max = max;
    this.count = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 0, 1);
    this._dir = new THREE.Vector3();
    this._color = new THREE.Color();
  }

  begin() {
    this.count = 0;
  }

  push(pos, dir, length, thickness, color) {
    if (this.count >= this.max) return;
    this._dir.copy(dir).normalize();
    this._q.setFromUnitVectors(this._up, this._dir);
    this._p.copy(pos).addScaledVector(this._dir, -length * 0.5);
    this._s.set(thickness, thickness, length);
    this._m.compose(this._p, this._q, this._s);
    this.mesh.setMatrixAt(this.count, this._m);
    this.mesh.setColorAt(this.count, this._color.set(color));
    this.count++;
  }

  end() {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

class RingPool {
  constructor(scene, max = 18) {
    this.items = [];
    const geo = new THREE.RingGeometry(0.55, 1, 28);
    geo.rotateX(-Math.PI / 2);
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0xffe0b0,
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      m.visible = false;
      m.renderOrder = 7;
      scene.add(m);
      this.items.push({ mesh: m, life: 0, maxLife: 1, r0: 1, r1: 10 });
    }
    this.cursor = 0;
  }

  spawn(pos, r0, r1, life, color = 0xffd9a0) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.mesh.position.copy(pos);
    it.mesh.visible = true;
    it.mesh.material.color.set(color);
    it.life = 0;
    it.maxLife = life;
    it.r0 = r0;
    it.r1 = r1;
  }

  clear() {
    for (const it of this.items) {
      it.mesh.visible = false;
      it.mesh.material.opacity = 0;
      it.life = 0;
    }
  }

  update(dt) {
    for (const it of this.items) {
      if (!it.mesh.visible) continue;
      it.life += dt;
      const t = it.life / it.maxLife;
      if (t >= 1) {
        it.mesh.visible = false;
        continue;
      }
      const r = lerp(it.r0, it.r1, Math.pow(t, 0.55));
      it.mesh.scale.set(r, 1, r);
      it.mesh.material.opacity = (1 - t) * 0.75;
    }
  }
}

class DecalPool {
  constructor(scene, terrain, max = 56) {
    this.terrain = terrain;
    this.items = [];
    const geo = new THREE.CircleGeometry(1, 16);
    geo.rotateX(-Math.PI / 2);
    const tex = softCircleTexture(0.15, 1.3);
    for (let i = 0; i < max; i++) {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0x2a2521,
          map: tex,
          transparent: true,
          opacity: 0,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -4,
          polygonOffsetUnits: -4,
        })
      );
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      this.items.push(m);
    }
    this.cursor = 0;
  }

  clear() {
    for (const m of this.items) {
      m.visible = false;
      m.material.opacity = 0;
    }
  }

  spawn(x, z, radius, color = 0x2a2521, opacity = 0.75) {
    const m = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    const y = this.terrain.heightAt(x, z) + 0.09;
    m.position.set(x, y, z);
    m.scale.setScalar(radius);
    m.material.color.set(color);
    m.material.opacity = opacity;
    m.visible = true;
    const n = this.terrain.normalAt(x, z);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
  }
}

export class Fx {
  constructor(scene, terrain) {
    this.scene = scene;
    this.terrain = terrain;
    const smokeTex = softCircleTexture(0.0, 1.6);
    const sparkTex = softCircleTexture(0.25, 2.6);
    this.smokePool = new ParticlePool(scene, 2600, THREE.NormalBlending, smokeTex, 5);
    this.glowPool = new ParticlePool(scene, 1400, THREE.AdditiveBlending, sparkTex, 6);
    this.tracers = new TracerRenderer(scene, 240);
    this.rings = new RingPool(scene, 20);
    this.decals = new DecalPool(scene, terrain, 60);
    this.shake = 0;
    this.emitters = [];
    this._v = new THREE.Vector3();
  }

  /** Drop every live particle, ring and decal (used when a run restarts). */
  reset() {
    for (const pool of [this.smokePool, this.glowPool, this.debrisPool].filter(Boolean)) {
      pool.active.fill(0);
      pool.alphas.fill(0);
      pool.count = 0;
      pool.cursor = 0;
      pool.geo.attributes.palpha.needsUpdate = true;
    }
    if (this.rings) this.rings.clear();
    if (this.decals) this.decals.clear();
    this.shake = 0;
  }

  addShake(amount) {
    this.shake = Math.min(1.6, this.shake + amount);
  }

  /** Continuous smoke source (burning wrecks, damaged car, ...). */
  addEmitter(fn) {
    const e = { fn, timer: 0, enabled: true };
    this.emitters.push(e);
    return e;
  }

  smoke(pos, opts = {}) {
    this.smokePool.spawn(pos.x, pos.y, pos.z, {
      vx: (opts.vx || 0) + rng.float(-0.4, 0.4),
      vy: (opts.vy !== undefined ? opts.vy : 1.4) + rng.float(-0.2, 0.5),
      vz: (opts.vz || 0) + rng.float(-0.4, 0.4),
      color: opts.color !== undefined ? opts.color : 0x6b6b68,
      size: opts.size || 3,
      size1: opts.size1 || (opts.size || 3) * 3.2,
      alpha: opts.alpha !== undefined ? opts.alpha : 0.55,
      life: opts.life || 3.2,
      gravity: opts.gravity !== undefined ? opts.gravity : 0.5,
      drag: opts.drag !== undefined ? opts.drag : 0.5,
    });
  }

  dust(pos, dir, amount = 1, color = 0xd7c69a) {
    for (let i = 0; i < amount; i++) {
      this.smokePool.spawn(pos.x + rng.float(-0.3, 0.3), pos.y + 0.1, pos.z + rng.float(-0.3, 0.3), {
        vx: (dir ? dir.x : 0) * rng.float(-0.4, -0.1) + rng.float(-0.8, 0.8),
        vy: rng.float(0.5, 1.6),
        vz: (dir ? dir.z : 0) * rng.float(-0.4, -0.1) + rng.float(-0.8, 0.8),
        color,
        size: rng.float(0.7, 1.4),
        size1: rng.float(2.5, 4.2),
        alpha: rng.float(0.28, 0.5),
        life: rng.float(0.7, 1.5),
        gravity: -0.2,
        drag: 1.1,
      });
    }
  }

  splash(pos, power = 1) {
    const n = Math.round(clamp(power * 8, 2, 18));
    for (let i = 0; i < n; i++) {
      this.smokePool.spawn(pos.x + rng.float(-0.6, 0.6), pos.y, pos.z + rng.float(-0.6, 0.6), {
        vx: rng.float(-2.2, 2.2) * power,
        vy: rng.float(1.5, 5) * power,
        vz: rng.float(-2.2, 2.2) * power,
        color: 0xe6f2f2,
        size: rng.float(0.5, 1.1),
        size1: rng.float(1.4, 2.6),
        alpha: rng.float(0.45, 0.8),
        life: rng.float(0.5, 1.1),
        gravity: -9,
        drag: 0.35,
      });
    }
  }

  sparks(pos, dir, count = 10, color = 0xffc46b) {
    for (let i = 0; i < count; i++) {
      this.glowPool.spawn(pos.x, pos.y, pos.z, {
        vx: (dir ? dir.x * 3 : 0) + rng.float(-6, 6),
        vy: rng.float(1, 7),
        vz: (dir ? dir.z * 3 : 0) + rng.float(-6, 6),
        color,
        size: rng.float(0.16, 0.36),
        size1: 0.03,
        alpha: 1,
        life: rng.float(0.25, 0.7),
        gravity: -14,
        drag: 0.5,
      });
    }
  }

  bulletImpact(pos, normal, surfaceColor = 0xd7c69a) {
    this.dust(pos, normal, 3, surfaceColor);
    this.sparks(pos, normal, 3, 0xffd9a0);
  }

  explosion(pos, scale = 1, opts = {}) {
    const p = this._v.copy(pos);
    // Flash
    this.glowPool.spawn(p.x, p.y + 0.6 * scale, p.z, {
      color: 0xfff0c0,
      size: 5 * scale,
      size1: 12 * scale,
      alpha: 1,
      life: 0.16,
      drag: 2,
    });
    // Fireball
    for (let i = 0; i < Math.round(8 * scale); i++) {
      this.glowPool.spawn(
        p.x + rng.float(-0.8, 0.8) * scale,
        p.y + rng.float(0.2, 1.4) * scale,
        p.z + rng.float(-0.8, 0.8) * scale,
        {
          vx: rng.float(-3, 3) * scale,
          vy: rng.float(1.5, 6) * scale,
          vz: rng.float(-3, 3) * scale,
          color: rng.chance(0.5) ? 0xffb347 : 0xff7a21,
          size: rng.float(1.6, 3.4) * scale,
          size1: rng.float(0.4, 1.2) * scale,
          alpha: 1,
          life: rng.float(0.3, 0.75),
          gravity: 3,
          drag: 1.4,
        }
      );
    }
    // Smoke column
    for (let i = 0; i < Math.round(11 * scale); i++) {
      this.smokePool.spawn(
        p.x + rng.float(-1.2, 1.2) * scale,
        p.y + rng.float(0.3, 2) * scale,
        p.z + rng.float(-1.2, 1.2) * scale,
        {
          vx: rng.float(-2, 2) * scale,
          vy: rng.float(1.5, 4.5) * scale,
          vz: rng.float(-2, 2) * scale,
          color: rng.chance(0.4) ? 0x3a3733 : 0x585450,
          size: rng.float(1.8, 3.4) * scale,
          size1: rng.float(7, 13) * scale,
          alpha: rng.float(0.45, 0.72),
          life: rng.float(1.8, 3.6),
          gravity: 0.8,
          drag: 0.9,
        }
      );
    }
    // Ejecta / sand
    const ejectaColor = opts.debrisColor !== undefined ? opts.debrisColor : 0xa8946c;
    for (let i = 0; i < Math.round(16 * scale); i++) {
      this.smokePool.spawn(p.x, p.y + 0.3, p.z, {
        vx: rng.float(-10, 10) * scale,
        vy: rng.float(4, 15) * scale,
        vz: rng.float(-10, 10) * scale,
        color: ejectaColor,
        size: rng.float(0.3, 0.8) * scale,
        size1: rng.float(0.1, 0.4) * scale,
        alpha: 0.95,
        life: rng.float(0.8, 1.7),
        gravity: -16,
        drag: 0.12,
      });
    }
    this.sparks(p, null, Math.round(12 * scale), 0xffd27a);
    this.rings.spawn(
      new THREE.Vector3(p.x, this.terrain.heightAt(p.x, p.z) + 0.4, p.z),
      1.2 * scale,
      11 * scale,
      0.55
    );
    this.decals.spawn(p.x, p.z, 2.6 * scale, 0x2b2621, 0.7);
    return true;
  }

  update(dt, camera) {
    for (const e of this.emitters) {
      if (e.enabled) e.fn(dt, this);
    }
    this.smokePool.update(dt);
    this.glowPool.update(dt);
    this.rings.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.9);
  }
}
