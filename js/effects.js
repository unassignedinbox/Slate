// effects.js — particles, tracers, shockwaves, muzzle/light flashes, camera shake
import * as THREE from './vendor/three.module.min.js';
import { clamp, clamp01 } from './utils.js';
import { S } from './state.js';
import { H } from './world.js';

const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const FWD = new THREE.Vector3(0, 0, 1);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.trauma = 0;
    this.time = 0;

    // --- ember pool (additive fire/spark particles) ---
    const emberGeo = new THREE.TetrahedronGeometry(0.15, 0);
    this.emberMat = new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.emberN = 260;
    this.emberIM = new THREE.InstancedMesh(emberGeo, this.emberMat, this.emberN);
    this.emberIM.frustumCulled = false;
    this.emberIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.emberIM);
    this.embers = [];
    for (let i = 0; i < this.emberN; i++) this.embers.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, ttl: 1, s: 1 });

    // --- dirt clods ---
    const clodGeo = new THREE.TetrahedronGeometry(0.28, 0);
    this.clodMat = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 });
    this.clodN = 180;
    this.clodIM = new THREE.InstancedMesh(clodGeo, this.clodMat, this.clodN);
    this.clodIM.frustumCulled = false;
    this.clodIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.clodIM.castShadow = false;
    scene.add(this.clodIM);
    this.clods = [];
    for (let i = 0; i < this.clodN; i++) this.clods.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, ttl: 1, s: 1, rx: 0, rz: 0 });

    // --- smoke puffs ---
    const smokeGeo = new THREE.IcosahedronGeometry(1, 0);
    this.smokeMat = new THREE.MeshStandardMaterial({ flatShading: true, transparent: true, opacity: 0.5, depthWrite: false, roughness: 1 });
    this.smokeN = 150;
    this.smokeIM = new THREE.InstancedMesh(smokeGeo, this.smokeMat, this.smokeN);
    this.smokeIM.frustumCulled = false;
    this.smokeIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.smokeIM);
    this.smoke = [];
    for (let i = 0; i < this.smokeN; i++) this.smoke.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, ttl: 1, s0: 1, s1: 2 });

    // --- tracer pool: short fast dashes (machine-gun rounds, not laser beams)
    const trGeo = new THREE.BoxGeometry(0.05, 0.05, 1.15);
    this.trMat = new THREE.MeshBasicMaterial({ color: 0xffcf8e, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false });
    this.trN = 150;
    this.trIM = new THREE.InstancedMesh(trGeo, this.trMat, this.trN);
    this.trIM.frustumCulled = false;
    this.trIM.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(this.trIM);
    this.tracers = [];
    for (let i = 0; i < this.trN; i++) this.tracers.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), ttl: 0, cb: null });

    // --- shockwave rings ---
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.6, 1.05, 26);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff3d8, transparent: true, opacity: 0, depthWrite: false }));
      m.visible = false;
      scene.add(m);
      this.rings.push({ m, life: 0 });
    }

    // --- flash lights ---
    this.lights = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffa04a, 0, 55, 1.8);
      scene.add(l);
      this.lights.push({ l, life: 0, peak: 0 });
    }

    // hide all instances initially
    this._hideAll(this.emberIM, this.emberN);
    this._hideAll(this.clodIM, this.clodN);
    this._hideAll(this.smokeIM, this.smokeN);
    this._hideAll(this.trIM, this.trN);
  }

  _hideAll(im, n) {
    _m4.makeScale(0.0001, 0.0001, 0.0001);
    for (let i = 0; i < n; i++) im.setMatrixAt(i, _m4);
    im.instanceMatrix.needsUpdate = true;
  }

  addTrauma(n) { this.trauma = Math.min(1, this.trauma + n); }

  // ------------------------------------------------------------------
  ember(x, y, z, n, spread, up, colA, colB) {
    for (let k = 0; k < n; k++) {
      const e = this._free(this.embers);
      if (!e) return;
      e.on = true;
      e.p.set(x, y, z);
      e.v.set((Math.random() - 0.5) * spread, Math.random() * up + up * 0.3, (Math.random() - 0.5) * spread);
      e.ttl = e.life = 0.35 + Math.random() * 0.75;
      e.s = 0.5 + Math.random() * 1.1;
      e.colA = colA; e.colB = colB;
    }
  }

  clod(x, y, z, n, spread, up) {
    for (let k = 0; k < n; k++) {
      const c = this._free(this.clods);
      if (!c) return;
      c.on = true;
      c.p.set(x, y, z);
      c.v.set((Math.random() - 0.5) * spread, Math.random() * up + 2, (Math.random() - 0.5) * spread);
      c.ttl = c.life = 0.8 + Math.random() * 0.9;
      c.s = 0.5 + Math.random() * 1.3;
      c.rx = Math.random() * 8 - 4; c.rz = Math.random() * 8 - 4;
    }
  }

  puff(x, y, z, n, fire) {
    for (let k = 0; k < n; k++) {
      const s = this._free(this.smoke);
      if (!s) return;
      s.on = true;
      s.p.set(x + (Math.random() - 0.5) * 0.8, y + Math.random() * 0.6, z + (Math.random() - 0.5) * 0.8);
      s.v.set((Math.random() - 0.5) * 1.2, 1 + Math.random() * 1.4, (Math.random() - 0.5) * 1.2);
      s.ttl = s.life = 1.8 + Math.random() * 1.6;
      s.s0 = 0.5 + Math.random() * 0.5;
      s.s1 = 1.8 + Math.random() * 1.4;
      s.dark = fire ? 0.28 + Math.random() * 0.12 : 0.5 + Math.random() * 0.2;
      s.tint = fire ? 0 : 1; // 0 grey smoke, 1 dusty brown
    }
  }

  spark(x, y, z, n) {
    this.ember(x, y, z, n, 5, 3, 0xffe9a0, 0xd0641e);
  }

  burst(x, y, z, scale = 1, opts = {}) {
    this.ember(x, y, z, Math.round(22 * scale), 10 * scale, 7 * scale, 0xffdf90, 0xc23c14);
    this.clod(x, y, z, Math.round(16 * scale), 9 * scale, 8 * scale);
    this.puff(x, y + 0.5, z, Math.round(9 * scale), true);
    this.puff(x, y + 0.2, z, Math.round(5 * scale), false);
    // ring
    const r = this.rings.find((rr) => rr.life <= 0);
    if (r) {
      r.life = 0.55;
      r.m.visible = true;
      r.m.position.set(x, y + 0.3, z);
      r.m.scale.setScalar(0.6);
      r.m.material.opacity = 0.7;
    }
    // light
    const l = this.lights.find((ll) => ll.life <= 0);
    if (l) {
      l.life = 0.4;
      l.peak = 380 * scale;
      l.l.position.set(x, y + 1.2, z);
      l.l.intensity = l.peak;
    }
    // camera trauma by proximity
    const cam = S.camera;
    if (cam) {
      const d = cam.position.distanceTo(_v.set(x, y, z));
      this.addTrauma(clamp(0.75 * scale * (1 - d / 110), 0, 0.65));
    }
    if (opts.flashOnly) return;
  }

  tracer(from, to, onArrive) {
    const t = this._free(this.tracers);
    if (!t) return;
    t.on = true;
    t.p.copy(from);
    _v.copy(to).sub(from);
    const dist = _v.length();
    _v.normalize().multiplyScalar(300);
    t.v.copy(_v);
    t.ttl = dist / 300;
    t.cb = onArrive || null;
  }

  _free(arr) {
    for (let i = 0; i < arr.length; i++) if (!arr[i].on) return arr[i];
    return null;
  }

  // ------------------------------------------------------------------
  update(dt) {
    this.time += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.25);

    // embers
    for (let i = 0; i < this.emberN; i++) {
      const e = this.embers[i];
      if (!e.on) continue;
      e.life -= dt;
      if (e.life <= 0) { e.on = false; _m4.makeScale(0.0001, 0.0001, 0.0001); this.emberIM.setMatrixAt(i, _m4); continue; }
      e.v.y -= 5.5 * dt;
      e.v.multiplyScalar(1 - 1.4 * dt);
      e.p.addScaledVector(e.v, dt);
      const f = e.life / e.ttl;
      _q.setFromEuler(_e.set(e.p.x * 3 + this.time * 6, this.time * 7 + e.p.z, 0));
      _m4.compose(e.p, _q, _v2.setScalar(e.s * (0.4 + f * 0.8)));
      this.emberIM.setMatrixAt(i, _m4);
      _c.set(e.colA !== undefined ? e.colA : 0xffcf80).lerp(_c2.set(e.colB !== undefined ? e.colB : 0x992f10), 1 - f);
      this.emberIM.setColorAt(i, _c);
    }
    this.emberIM.instanceMatrix.needsUpdate = true;
    if (this.emberIM.instanceColor) this.emberIM.instanceColor.needsUpdate = true;

    // clods
    for (let i = 0; i < this.clodN; i++) {
      const c = this.clods[i];
      if (!c.on) continue;
      c.life -= dt;
      c.v.y -= 15 * dt;
      c.p.addScaledVector(c.v, dt);
      if (c.life <= 0 || c.p.y < H(c.p.x, c.p.z) - 0.2) { c.on = false; _m4.makeScale(0.0001, 0.0001, 0.0001); this.clodIM.setMatrixAt(i, _m4); continue; }
      _q.setFromEuler(_e.set(c.rx * c.life * 4, 0, c.rz * c.life * 4));
      _m4.compose(c.p, _q, _v2.setScalar(c.s * clamp01(c.life / c.ttl + 0.3)));
      this.clodIM.setMatrixAt(i, _m4);
      _c.setHSL(0.09, 0.38, 0.24 + 0.1 * ((i * 37) % 10) / 10);
      this.clodIM.setColorAt(i, _c);
    }
    this.clodIM.instanceMatrix.needsUpdate = true;
    if (this.clodIM.instanceColor) this.clodIM.instanceColor.needsUpdate = true;

    // smoke
    for (let i = 0; i < this.smokeN; i++) {
      const s = this.smoke[i];
      if (!s.on) continue;
      s.life -= dt;
      if (s.life <= 0) { s.on = false; _m4.makeScale(0.0001, 0.0001, 0.0001); this.smokeIM.setMatrixAt(i, _m4); continue; }
      s.p.addScaledVector(s.v, dt);
      s.v.y += 0.35 * dt;
      s.v.x *= 1 - 0.4 * dt; s.v.z *= 1 - 0.4 * dt;
      const f = s.life / s.ttl; // 1 → 0
      const grow = 1 - f; // 0 → 1
      let sc = s.s0 + (s.s1 - s.s0) * grow;
      if (f < 0.18) sc *= f / 0.18; // shrink out
      _q.identity();
      _m4.compose(s.p, _q, _v2.setScalar(sc));
      this.smokeIM.setMatrixAt(i, _m4);
      const g = s.dark;
      if (s.tint === 1) _c.setRGB(g * 1.25, g * 1.05, g * 0.78);
      else _c.setRGB(g, g * 0.97, g * 0.95);
      this.smokeIM.setColorAt(i, _c);
    }
    this.smokeIM.instanceMatrix.needsUpdate = true;
    if (this.smokeIM.instanceColor) this.smokeIM.instanceColor.needsUpdate = true;

    // tracers
    for (let i = 0; i < this.trN; i++) {
      const t = this.tracers[i];
      if (!t.on) continue;
      t.ttl -= dt;
      t.p.addScaledVector(t.v, dt);
      const ground = H(t.p.x, t.p.z);
      const water = S.waterLevel;
      if (t.ttl <= 0) {
        t.on = false;
        if (t.cb) { const cb = t.cb; t.cb = null; cb(); }
        _m4.makeScale(0.0001, 0.0001, 0.0001);
        this.trIM.setMatrixAt(i, _m4);
        continue;
      }
      if (t.p.y < Math.max(ground, water) + 0.05) {
        // hit dirt or water
        if (water > ground) this.puff(t.p.x, water + 0.2, t.p.z, 1, false);
        else this.puff(t.p.x, ground + 0.15, t.p.z, 1, false);
        if (t.cb) { const cb = t.cb; t.cb = null; cb(); }
        t.on = false;
        _m4.makeScale(0.0001, 0.0001, 0.0001);
        this.trIM.setMatrixAt(i, _m4);
        continue;
      }
      _v2.copy(t.v).normalize();
      _q.setFromUnitVectors(FWD, _v2);
      _m4.compose(t.p, _q, _v2.set(1, 1, 1));
      this.trIM.setMatrixAt(i, _m4);
    }
    this.trIM.instanceMatrix.needsUpdate = true;

    // rings
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) { r.m.visible = false; continue; }
      const f = r.life / 0.55;
      r.m.scale.setScalar(0.6 + (1 - f) * 9);
      r.m.material.opacity = 0.7 * f;
    }

    // lights
    for (const l of this.lights) {
      if (l.life <= 0) continue;
      l.life -= dt;
      if (l.life <= 0) { l.l.intensity = 0; continue; }
      l.l.intensity = l.peak * clamp01(l.life / 0.4);
    }

    // smoke columns from burning wrecks
    if (S.smokeSpots && S.camera) {
      for (const spot of S.smokeSpots) {
        spot.t -= dt;
        if (spot.t <= 0) {
          spot.t = 0.5 / spot.rate;
          if (Math.hypot(spot.x - S.camera.position.x, spot.z - S.camera.position.z) < 420) {
            this.puff(spot.x + (Math.random() - 0.5) * 1.5, spot.y, spot.z + (Math.random() - 0.5) * 1.5, 1, true);
          }
        }
      }
    }
  }

  // shake offsets for the camera
  shakeOffsets() {
    const t = this.trauma * this.trauma;
    const tt = this.time * 31;
    return {
      rx: t * 0.045 * Math.sin(tt * 1.1),
      ry: t * 0.05 * Math.sin(tt * 0.9 + 2.0),
      tx: t * 0.35 * Math.sin(tt * 0.8 + 4.0),
      ty: t * 0.3 * Math.sin(tt * 1.3 + 1.0),
    };
  }
}
