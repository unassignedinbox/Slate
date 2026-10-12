// ---------------------------------------------------------------------------
// DYNAMIC TRACK ELEMENTS
//
//  1. BOLLARD ZIPPER      a whole avenue of bollards rising in a travelling wave
//                         with a slowly sliding open corridor + PULSE teammate call
//  2. MAGLEV CROSSINGS    freight trains sweeping across the deck on random clocks
//  3. TRAFFIC DISTRICT    municipal hover traffic, half of it oncoming
//  4. MAGNETIC CRANES     capture cones that lift your craft and throw it down a
//                         branch — the Y fork (yard lanes) and the T split (high line)
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG, clamp, damp, smoothstep } from './config.js';
import { glowTexture, chevronTexture, stripTexture } from './textures.js';
import { ZONE_COLOR } from './track.js';
import { wrapPi } from './ship.js';

const TWO = Math.PI * 2;

// ---------------------------------------------------------------------------
// spark pool — shared by every hazard and by wall strikes
// ---------------------------------------------------------------------------
export class Sparks {
  constructor(scene, max = 260) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const sizes = new Float32Array(max).fill(2.6);
    g.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    this.geo = g;
    this.pts = new THREE.Points(g, new THREE.PointsMaterial({
      size: 2.4, vertexColors: true, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, map: glowTexture(),
      sizeAttenuation: true,
    }));
    this.pts.frustumCulled = false;
    scene.add(this.pts);
    this.cursor = 0;
    this.c = new THREE.Color();
  }

  burst(x, y, z, n = 18, color = 0xffc25a, spread = 14) {
    this.c.set(color);
    for (let k = 0; k < n; k++) {
      const i = this.cursor = (this.cursor + 1) % this.max;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.vel[i * 3] = (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = Math.random() * spread * 0.6;
      this.vel[i * 3 + 2] = (Math.random() - 0.5) * spread;
      this.life[i] = this.maxLife[i] = 0.35 + Math.random() * 0.5;
      this.col[i * 3] = this.c.r; this.col[i * 3 + 1] = this.c.g; this.col[i * 3 + 2] = this.c.b;
    }
    this.geo.attributes.color.needsUpdate = true;
  }

  update(dt) {
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= 26 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.col[i * 3] *= 0.985; this.col[i * 3 + 1] *= 0.985; this.col[i * 3 + 2] *= 0.985;
      if (f <= 0) this.pos[i * 3 + 1] = -9999;
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
  }
}

// ---------------------------------------------------------------------------
// 1. BOLLARD ZIPPER
// ---------------------------------------------------------------------------
class Zipper {
  /**
   * The deck is carpeted with bollards. A corridor of them stays down; that
   * corridor slides across the deck on a slow sine (so it is *readable* at
   * 300 km/h) while the rise/fall animation travels along the avenue as a wave
   * (so it *looks* like a zipper being pulled at speed).
   */
  constructor(scene, track, span, opts = {}) {
    this.track = track;
    this.deck = track.deck;
    this.s0 = span.s0;
    this.s1 = span.s1;
    this.colSpacing = opts.colSpacing ?? 2.6;
    this.rowSpacing = opts.rowSpacing ?? 3.4;
    this.speed = opts.speed ?? 1;
    this.amp = opts.amp ?? 17;
    this.period = opts.period ?? 9.0;      // seconds for a full sweep
    this.wavelength = opts.wavelength ?? 820;
    this.openHalf = opts.openHalf ?? 3.6;  // metres of clear deck at the corridor
    this.lanes = opts.lanes ?? 2;
    this.rows = [];
    this.bollards = [];
    this.time = 0;
    this.pulse = { active: false, t: 0, mix: 0 };
    this.build(scene);
  }

  build(scene) {
    const d = this.deck;
    const ns = this.s1 - this.s0;
    this.rowCount = Math.floor(ns / this.rowSpacing);
    const f0 = d.frame(this.s0 + 2, {});
    this.maxCols = Math.floor((f0.hw * 2 - 6) / this.colSpacing);
    const count = this.rowCount * this.maxCols;

    const geo = new THREE.CylinderGeometry(0.42, 0.52, 1, 8);
    geo.translate(0, 0.5, 0);   // pivot at the base so scaling rises from the deck
    const mat = new THREE.MeshStandardMaterial({
      color: 0xcfd8e2, emissive: 0x1b6f80, emissiveIntensity: 0.5, roughness: 0.42, metalness: 0.75,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);

    // glowing caps so the wave reads at distance
    const capGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.14, 8);
    const capMat = new THREE.MeshBasicMaterial({ color: 0xff3ec8, transparent: true, opacity: 0.9 });
    this.caps = new THREE.InstancedMesh(capGeo, capMat, count);
    this.caps.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.caps.frustumCulled = false;
    scene.add(this.caps);

    this.heights = new Float32Array(count);
    this.targets = new Float32Array(count);
    this.ringCol = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);

    // per-row placement in world space
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this._s = new THREE.Vector3(1, 1, 1);
    for (let r = 0; r < this.rowCount; r++) {
      const s = this.s0 + 2 + r * this.rowSpacing;
      const f = d.frame(s, {});
      const cols = Math.floor((f.hw * 2 - 6) / this.colSpacing);
      const row = { s, f: { ...f }, cols, base: this.bollards.length };
      for (let c = 0; c < cols; c++) {
        const e = -f.hw + 3 + this.colSpacing * (c + 0.5);
        this.bollards.push({ row: r, col: c, e, s, x: f.x + f.rx * e, z: f.z + f.rz * e, y: f.y + e * f.tilt, th: f.th });
      }
      this.rows.push(row);
    }

    // the corridor: an additive ribbon painted on the deck showing the open lane
    const N = 96;
    const cpos = new Float32Array(N * 2 * 3);
    const cc = new Float32Array(N * 2 * 3);
    const cuv = new Float32Array(N * 2 * 2);
    for (let i = 0; i < N; i++) {
      cuv.set([0, i / 8], i * 4); cuv.set([1, i / 8], i * 4 + 2);
    }
    const cidx = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2, b = (i + 1) * 2;
      cidx.push(a, b, a + 1, a + 1, b, b + 1);
    }
    this.corrGeo = new THREE.BufferGeometry();
    this.corrGeo.setAttribute('position', new THREE.BufferAttribute(cpos, 3));
    this.corrGeo.setAttribute('color', new THREE.BufferAttribute(cc, 3));
    this.corrGeo.setAttribute('uv', new THREE.BufferAttribute(cuv, 2));
    this.corrGeo.setIndex(cidx);
    this.corridor = new THREE.Mesh(this.corrGeo, new THREE.MeshBasicMaterial({
      map: stripTexture(), vertexColors: true, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
    this.corridor.frustumCulled = false;
    this.corridorN = N;
    scene.add(this.corridor);
    void this.ringCol;
  }

  /** corridor centre (lateral metres) at arc length s, for the current time */
  corridorAt(s, pulseE = null) {
    const ph = this.time / this.period + (s - this.s0) / this.wavelength;
    let out = [];
    for (let k = 0; k < this.lanes; k++) {
      const c = Math.sin(TWO * (ph + k / this.lanes)) * this.amp;
      out.push(c);
    }
    if (this.pulse.mix > 0.001 && pulseE != null) {
      // PULSE: draw the pattern toward the teammate's lane
      const pull = out.reduce((a, b) => (Math.abs(b - pulseE) < Math.abs(a - pulseE) ? b : a), out[0]);
      out = out.map((c) => c + (pull + (pulseE - pull) * 1.0 - c) * this.pulse.mix);
      out[0] = pull + (pulseE - pull) * this.pulse.mix;
    }
    return out;
  }

  /** lateral windows of clear deck at s (used by the AI) */
  gapAt(s, pulseE = null) {
    const cs = this.corridorAt(s, pulseE);
    const half = this.openHalf + this.pulse.mix * 2.4;
    return cs.map((c) => [c - half, c + half]);
  }

  /** true if (s,e) is inside a raised bollard — the swept test lives in update() */
  blockedAt(s, e, pulseE = null) {
    const f = this.deck.frame(s, {});
    if (Math.abs(e) > f.hw - 1.2) return true;
    const gaps = this.gapAt(s, pulseE);
    for (const [a, b] of gaps) if (e > a && e < b) return false;
    return true;
  }

  update(dt, t, vehicles, player, audio) {
    this.time = t;
    const d = this.deck;
    const pulseE = (this.pulse.active && this.pulse.owner) ? this.pulse.owner.e
      : (player ? player.e : null);
    // PULSE call state
    const P = this.pulse;
    if (P.active) {
      P.t -= dt;
      P.mix = damp(P.mix, 1, 5, dt);
      if (P.t <= 0) { P.active = false; }
    } else {
      P.mix = damp(P.mix, 0, 2.4, dt);
    }

    // --- bollard heights ---
    const H = this.heights, TG = this.targets, M = this.mesh, C = this.caps;
    const col = new THREE.Color();
    const upCol = new THREE.Color(0xff3ec8), downCol = new THREE.Color(0x14323d);
    let idx = 0;
    const pulseHalf = this.openHalf + P.mix * 2.4;
    for (let r = 0; r < this.rowCount; r++) {
      const row = this.rows[r];
      const cs = this.corridorAt(row.s, pulseE);
      // travelling rise wave: bollards snap up in a diagonal sweep along s
      const wavePhase = (row.s / 26) - t * 3.1;
      for (let c = 0; c < row.cols; c++) {
        const b = this.bollards[idx];
        let open = false;
        for (const cc of cs) if (b.e > cc - pulseHalf && b.e < cc + pulseHalf) { open = true; break; }
        const stagger = Math.sin(wavePhase + b.e * 0.06) * 0.5 + 0.5;
        const target = open ? 0.03 : 1.0 + stagger * 0.12;
        const rate = (target > H[idx] ? 7.5 : 4.2) * this.speed;
        H[idx] += (target - H[idx]) * Math.min(1, rate * dt);
        const h = Math.max(0.03, H[idx]);
        this._q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.th);
        this._v.set(b.x, b.y, b.z);
        this._s.set(1, 1.85 * h, 1);
        this._m.compose(this._v, this._q, this._s);
        M.setMatrixAt(idx, this._m);
        this._v.set(b.x, b.y + 1.85 * h, b.z);
        this._s.set(1, 1, 1);
        this._m.compose(this._v, this._q, this._s);
        C.setMatrixAt(idx, this._m);
        const heat = clamp((h - 0.5) / 0.6, 0, 1);
        col.copy(downCol).lerp(upCol, heat);
        M.setColorAt(idx, col);
        idx++;
      }
    }
    M.instanceMatrix.needsUpdate = true;
    C.instanceMatrix.needsUpdate = true;
    if (M.instanceColor) M.instanceColor.needsUpdate = true;

    // --- corridor ribbon on the deck ---
    const cp = this.corrGeo.attributes.position.array;
    const ccol = this.corrGeo.attributes.color.array;
    const N = this.corridorN;
    const bright = 0.5 + P.mix * 0.9;
    for (let i = 0; i < N; i++) {
      const s = this.s0 + (i / (N - 1)) * (this.s1 - this.s0);
      const f = d.frame(s, {});
      const cs = this.corridorAt(s, pulseE);
      const c = cs[0] + (cs[1] !== undefined ? (cs[1] - cs[0]) * 0 : 0);
      const half = pulseHalf + 0.7;
      const y = f.y + 0.09;
      for (let k = 0; k < 2; k++) {
        const e = c + (k === 0 ? -half : half);
        const j = (i * 2 + k);
        cp[j * 3] = f.x + f.rx * e;
        cp[j * 3 + 1] = y + e * f.tilt;
        cp[j * 3 + 2] = f.z + f.rz * e;
        ccol[j * 3] = 0.16 * bright; ccol[j * 3 + 1] = 0.95 * bright; ccol[j * 3 + 2] = 1.0 * bright;
      }
    }
    this.corrGeo.attributes.position.needsUpdate = true;
    this.corrGeo.attributes.color.needsUpdate = true;

    // --- swept collision: walk every row between the previous and current s ---
    for (const v of vehicles) {
      if (v.lifted || v.wrecked || v.path !== d) continue;
      const pulseActive = P.mix > 0.4;
      const e = v.e;
      const sPrev = v.prevS ?? v.s;
      const sNow = v.s;
      const a = Math.min(sPrev, sNow), b = Math.max(sPrev, sNow);
      if (b < this.s0 - 4 || a > this.s1 + 4) continue;
      const r0 = Math.max(0, Math.floor((a - this.s0 - 2) / this.rowSpacing));
      const r1 = Math.min(this.rowCount - 1, Math.ceil((b - this.s0 + 2) / this.rowSpacing));
      let hit = null;
      for (let r = r0; r <= r1 && !hit; r++) {
        const row = this.rows[r];
        if (row.s < this.s0 || row.s > this.s1) continue;
        const cs = this.corridorAt(row.s, pulseE);
        const half = pulseHalf;
        let open = false;
        for (const cc of cs) if (e > cc - half && e < cc + half) { open = true; break; }
        if (open) continue;
        // is there actually a raised bollard near this lateral position?
        for (const bidx of [0]) {
          void bidx;
          const near = Math.round((e + row.f.hw - 3) / this.colSpacing - 0.5);
          for (let dc = -1; dc <= 1; dc++) {
            const cIdx = near + dc;
            if (cIdx < 0 || cIdx >= row.cols) continue;
            const gi = row.base + cIdx;
            if (this.heights[gi] > 0.55) { hit = { x: this.bollards[gi], row }; break; }
          }
          if (hit) break;
        }
      }
      if (hit && t - (v._zipT ?? -9) > 0.75) {
        v._zipT = t;
        const impact = Math.abs(v.speed);
        v.addHullDamage(impact * 0.13, 'zipper');
        v.speed *= 0.52;
        // shove the craft toward the open corridor so it doesn't grind along the field
        const cs2 = this.corridorAt(v.s, pulseE);
        let bc = cs2[0], bd = 1e9;
        for (const cc of cs2) { const d = Math.abs(cc - v.e); if (d < bd) { bd = d; bc = cc; } }
        v.e += Math.sign(bc - v.e) * 1.6;
        v.latVel *= -0.3;
        v.shake = Math.min(1.4, 0.4 + impact * 0.004);
        if (v.latVel === 0) v.latVel = (Math.random() - 0.5) * 6;
        v.onSpark?.(hit.x.x, hit.x.y + 1.2, hit.x.z, 22, 0xff3ec8);
        audio?.tone('hit', 0.5);
      }
    }
  }

  /** is the player close enough for a pulse to matter? */
  inRange(s) { return s > this.s0 - 240 && s < this.s1 + 40; }

  callPulse(entity) {
    if (this.pulse.active) return false;
    this.pulse.active = true;
    this.pulse.t = 2.6;
    this.pulse.owner = entity;
    return true;
  }
}

// ---------------------------------------------------------------------------
// 2. MAGLEV CROSSINGS
// ---------------------------------------------------------------------------
class TrainLine {
  constructor(scene, track, s, opts = {}) {
    this.track = track;
    this.deck = track.deck;
    this.s = s;
    this.f = { ...this.deck.frame(s, {}) };
    this.speed = opts.speed ?? 62;        // m/s, perpendicular
    this.carLen = 24;
    this.cars = opts.cars ?? 3;
    this.width = 5.6;
    this.height = 4.6;
    this.dir = opts.dir ?? (Math.random() < 0.5 ? 1 : -1);
    // A consist crosses the deck along its RIGHT vector, so in the deck-local
    // frame the crossing axis is x (local +z is the racing direction). x0 is
    // where car 0's centre starts, and travel is how far it moves for the whole
    // consist to enter one side and clear the other.
    this.margin = 2.5;
    this.x0 = -(this.f.hw + this.carLen * 0.5 + this.margin);
    this.travel = 2 * (this.f.hw + this.carLen * 0.5 + this.margin) + (this.cars - 1) * (this.carLen + 1);
    this.x = this.x0;
    this.state = 'idle';
    this.timer = 3 + Math.random() * 9;
    this.offset = this.dir * this.x0;
    this.doubleUp = false;
    this.hits = new Map();

    // --- geometry: parallel to the deck's right vector ---
    this.group = new THREE.Group();
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2a313c, roughness: 0.6, metalness: 0.7 });
    const carMat = new THREE.MeshStandardMaterial({
      color: 0xc8d2de, roughness: 0.42, metalness: 0.35,
      emissive: 0x141a24, emissiveIntensity: 1,
    });
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffb42e });
    const windowMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff });
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff0c0 });
    this.carMeshes = [];
    for (let i = 0; i < this.cars; i++) {
      const g = new THREE.Group();
      // long axis runs ACROSS the deck (local x); width spans the racing line
      const body = new THREE.Mesh(new THREE.BoxGeometry(this.carLen - 1.2, this.height, this.width), carMat);
      body.position.y = this.height * 0.5 + 0.5;
      g.add(body);
      const nose = new THREE.Mesh(new THREE.BoxGeometry(2.4, this.height * 0.7, this.width * 0.92), carMat);
      nose.position.set((this.carLen / 2) * this.dir, this.height * 0.42 + 0.5, 0);
      g.add(nose);
      for (const sz of [-1, 1]) {
        const strip = new THREE.Mesh(new THREE.BoxGeometry(this.carLen - 2, 0.5, 0.22), stripeMat);
        strip.position.set(0, this.height * 0.74, sz * (this.width / 2 + 0.05));
        g.add(strip);
        // lit window band: the consist reads as a train even in the dark
        for (let w = 0; w < 5; w++) {
          const win = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.15, 0.18), windowMat);
          win.position.set(-(this.carLen / 2 - 4) + w * 4.2, this.height * 0.46, sz * (this.width / 2 + 0.06));
          g.add(win);
        }
        // running lamps along the flank
        const flank = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture(), color: 0x7fd8ff, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5,
        }));
        flank.position.set(0, this.height * 0.55, sz * (this.width / 2 + 0.3));
        flank.scale.set(this.carLen * 0.9, 3.4, 1);
        g.add(flank);
      }
      // headlight cone at the nose, so the sweep is legible from the deck
      const beam = new THREE.Mesh(new THREE.ConeGeometry(2.2, 16, 10, 1, true), new THREE.MeshBasicMaterial({
        color: 0xcfeaff, transparent: true, opacity: 0.12, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      beam.rotation.z = -Math.PI / 2 * this.dir;
      beam.position.set((this.carLen / 2 + 8) * this.dir, this.height * 0.4, 0);
      g.add(beam);
      const noseLamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 10, 8), lampMat);
      noseLamp.position.set((this.carLen / 2) * this.dir, this.height * 0.5, 0);
      g.add(noseLamp);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(this.carLen * 0.9, this.width * 0.8), new THREE.MeshBasicMaterial({
        map: glowTexture(), color: 0x5ad8ff, transparent: true, opacity: 0.35,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.35;
      g.add(glow);
      g.traverse((o) => { o.frustumCulled = false; });
      const headlight = new THREE.PointLight(0xbfe4ff, 1.5, 60, 2);
      headlight.position.set((this.carLen / 2) * this.dir, 3.2, 0);
      g.add(headlight);
      if (i === 0) this.headlight = headlight;
      this.group.add(g);
      this.carMeshes.push(g);
    }
    // guide rails: parallel to the crossing, either side of the consist
    for (const side of [-1, 1]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(150, 1.2, 0.9), railMat);
      beam.position.set(0, 0.4, side * (this.width * 0.5 + 1.5));
      this.group.add(beam);
    }
    this.group.rotation.y = this.f.th;
    this.group.position.set(this.f.x, this.f.y, this.f.z);
    scene.add(this.group);

    // warning gantries: posts + lamps on both shoulders
    this.lamps = [];
    for (const side of [-1, 1]) {
      for (const lx of [-2, 2]) {
        const e = side * (this.f.hw - 1.4);
        const px = this.f.x + this.f.rx * e + this.f.tx * lx;
        const pz = this.f.z + this.f.rz * e + this.f.tz * lx;
        const post = new THREE.Mesh(
          new THREE.CylinderGeometry(0.3, 0.34, 6.4, 8),
          new THREE.MeshStandardMaterial({ color: 0x232a35, roughness: 0.7, metalness: 0.5 }),
        );
        post.position.set(px, this.f.y + 3.2, pz);
        scene.add(post);
        const lampMat = new THREE.MeshBasicMaterial({ color: 0xff3b3b });
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), lampMat);
        lamp.position.set(px, this.f.y + 6.4, pz);
        const halo = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture(), color: 0xff3b3b, transparent: true, blending: THREE.AdditiveBlending,
          depthWrite: false, opacity: 0.9,
        }));
        halo.position.copy(lamp.position);
        halo.scale.setScalar(4.6);
        scene.add(lamp, halo);
        this.lamps.push({ lamp, halo, mat: lampMat });
      }
    }
    this.light = new THREE.PointLight(0xff5a3b, 0, 90, 2);
    this.light.position.set(this.f.x, this.f.y + 7, this.f.z);
    scene.add(this.light);
  }

  /** clearance: 0 = deck blocked, 1 = fully open */
  openness() {
    if (this.state === 'crossing' || this.state === 'warn') return 0;
    return 1;
  }

  /** how long the consist takes to sweep past a fixed point on the deck */
  get sweepDuration() {
    return this.travel / this.speed;
  }

  /** danger window in seconds from now: [start, end] (end may be negative = past) */
  dangerWindow() {
    if (this.state === 'crossing') return { start: 0, end: Math.max(0, this.timer) };
    if (this.state === 'warn') return { start: this.timer, end: this.timer + this.sweepDuration };
    return { start: this.timer + 3.4, end: this.timer + 3.4 + this.sweepDuration };
  }

  timeToDanger() {
    if (this.state === 'crossing') return 0;
    if (this.state === 'warn') return this.timer;
    return this.timer + 3.4;
  }

  update(dt, t, vehicles, player, audio) {
    // --- state machine: staggered random clocks ---
    if (this.state === 'idle') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'warn';
        this.timer = 3.4;
        this.dir = Math.random() < 0.5 ? 1 : -1;
        this.doubleUp = Math.random() < 0.35;
        this.x = this.x0;
        this.offset = this.dir * this.x0;
        audio?.tone('gate', 0.32);
      }
    } else if (this.state === 'warn') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'crossing';
        this.timer = this.sweepDuration;
      }
    } else {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.state = 'idle';
        this.timer = 6.5 + Math.random() * 9;
        if (this.doubleUp) { this.timer = 1.1; this.doubleUp = false; }
      }
    }

    // --- move the consist along the crossing axis (local x) ---
    const moving = this.state === 'crossing';
    if (moving) this.x = Math.min(this.x0 + this.travel, this.x + this.speed * dt);
    const x = moving ? this.x : this.x0;
    for (let i = 0; i < this.cars; i++) {
      const carX = this.dir * (x - i * (this.carLen + 1.0));
      this.carMeshes[i].position.set(carX, 0, 0);
    }

    // --- lamps: idle dark, warn flashing, crossing solid ---
    const flash = this.state === 'warn' ? (Math.sin(t * 16) > 0 ? 1 : 0.12) : this.state === 'crossing' ? 1 : 0.06;
    for (const l of this.lamps) {
      l.mat.color.setRGB(flash, flash * 0.22, flash * 0.14);
      l.halo.material.opacity = 0.12 + flash * 0.9;
      l.halo.scale.setScalar(3.4 + flash * 2.6);
    }
    this.light.intensity = flash * 26;

    // --- collision: any part of a car overlapping the vehicle ---
    if (moving) {
      // a car is a long body laid across the deck: cars occupy this.s exactly,
      // with only their own half-width along the racing direction
      const halfWS = this.width * 0.5 + 0.7;
      for (const v of vehicles) {
        if (v.lifted || v.wrecked || v.path !== this.deck) continue;
        if (Math.abs(v.s - this.s) > halfWS + v.radius) continue;
        const e = v.e;
        for (let i = 0; i < this.cars; i++) {
          const carOff = this.dir * (x - i * (this.carLen + 1.0));
          const carHalf = this.carLen / 2;
          if (e > carOff - carHalf - v.radius && e < carOff + carHalf + v.radius) {
            const key = i;
            const last = this.hits.get(v.racerIndex) ?? -99;
            if (t - last < 1.2) break;
            this.hits.set(v.racerIndex, t);
            v.addHullDamage(58, 'train');
            v.speed *= 0.18;
            v.shake = 1.6;
            v.latVel += Math.sign(v.e || 1) * 9;
            const p = v.pos;
            v.onSpark?.(p.x, p.y, p.z, 34, 0xff7a2a);
            audio?.tone('wreck', 0.7);
            void key;
            break;
          }
        }
      }
    }
  }
}


// ---------------------------------------------------------------------------
// 3. TRAFFIC DISTRICT
// ---------------------------------------------------------------------------
class Traffic {
  constructor(scene, track, span, count = 16) {
    this.track = track;
    this.deck = track.deck;
    this.s0 = span.s0 + 6;
    this.s1 = span.s1 - 6;
    this.span = this.s1 - this.s0;
    this.vehicles = [];
    this.hitCooldown = new Map();
    this.group = new THREE.Group();
    scene.add(this.group);

    const types = [
      { name: 'hauler', w: 3.4, h: 3.2, len: 11, color: 0x6c7b4b, speed: [30, 42] },
      { name: 'taxi', w: 2.6, h: 1.9, len: 6.2, color: 0xd8b23a, speed: [38, 54] },
      { name: 'bus', w: 3.0, h: 3.4, len: 13, color: 0x3d5a7a, speed: [26, 36] },
      { name: 'coupe', w: 2.4, h: 1.6, len: 5.4, color: 0xb43a4a, speed: [44, 60] },
    ];
    const lanes = [-21, -10.5, 10.5, 21];      // left two are oncoming
    for (let i = 0; i < count; i++) {
      const lane = i % lanes.length;
      const e = lanes[lane];
      const oncoming = e < 0;
      const type = types[(Math.random() * types.length) | 0];
      const laneSpeed = oncoming ? 0.55 : 1;   // oncoming traffic is slow, closing speed is not
      const g = new THREE.Group();
      const bodyMat = new THREE.MeshStandardMaterial({ color: type.color, roughness: 0.45, metalness: 0.6 });
      const body = new THREE.Mesh(new THREE.BoxGeometry(type.w, type.h * 0.72, type.len), bodyMat);
      body.position.y = type.h * 0.36 + 0.5;
      g.add(body);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(type.w * 0.86, type.h * 0.4, type.len * 0.5), bodyMat);
      cab.position.set(0, type.h * 0.78, -type.len * 0.05);
      g.add(cab);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(type.w * 1.35, type.len * 1.15), new THREE.MeshBasicMaterial({
        map: glowTexture(), color: oncoming ? 0xffd2a0 : 0x9fe8ff, transparent: true, opacity: 0.42,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = 0.16;
      g.add(glow);
      // headlights face the way it is travelling
      const lampZ = oncoming ? -type.len / 2 - 0.1 : type.len / 2 + 0.1;
      for (const sx of [-1, 1]) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glowTexture(), color: oncoming ? 0xfff0d0 : 0xff6a4a, transparent: true,
          blending: THREE.AdditiveBlending, depthWrite: false, opacity: oncoming ? 0.95 : 0.7,
        }));
        sp.position.set(sx * type.w * 0.32, type.h * 0.45, lampZ);
        sp.scale.setScalar(oncoming ? 3.2 : 2.1);
        g.add(sp);
      }
      this.group.add(g);
      const speed = (type.speed[0] + Math.random() * (type.speed[1] - type.speed[0])) * laneSpeed;
      this.vehicles.push({
        g, type, e, oncoming, speed, s: this.s0 + Math.random() * this.span,
        dir: oncoming ? -1 : 1, halfLen: type.len * 0.5 + 1.2, halfW: type.w * 0.5 + 0.6,
      });
    }
  }

  update(dt, t, vehicles, player, audio) {
    const d = this.deck;
    for (const tv of this.vehicles) {
      tv.s += tv.dir * tv.speed * dt;
      if (tv.s > this.s1) tv.s = this.s0;
      if (tv.s < this.s0) tv.s = this.s1;
      const f = d.frame(tv.s, {});
      const x = f.x + f.rx * tv.e, z = f.z + f.rz * tv.e;
      const y = f.y + tv.e * f.tilt + CONFIG.hoverHeight * 0.55 + Math.sin(t * 3.4 + tv.e) * 0.12;
      tv.g.position.set(x, y, z);
      tv.g.rotation.set(0, tv.dir > 0 ? f.th : f.th + Math.PI, 0);
      tv.g.rotateZ(-f.tilt * 0.8);
      tv.g.rotateY(Math.sin(t * 1.1 + tv.s * 0.01) * 0.02);
    }
    // collisions
    for (const v of vehicles) {
      if (v.lifted || v.wrecked || v.path !== d) continue;
      const last = this.hitCooldown.get(v.racerIndex) ?? -99;
      if (t - last < 0.9) continue;
      for (const tv of this.vehicles) {
        let ds = v.s - tv.s;
        if (ds > d.length * 0.5) ds -= d.length; else if (ds < -d.length * 0.5) ds += d.length;
        const de = v.e - tv.e;
        if (Math.abs(ds) < tv.halfLen + 3.0 && Math.abs(de) < tv.halfW + 2.2) {
          this.hitCooldown.set(v.racerIndex, t);
          v.addHullDamage(20, 'traffic');
          v.speed *= 0.8;
          v.latVel += Math.sign(de || 1) * 8;
          v.e += Math.sign(de || 1) * 1.5;
          v.shake = Math.min(1.2, 0.35 + Math.abs(v.speed) * 0.004);
          v.onSpark?.(v.pos.x, v.pos.y, v.pos.z, 26, 0xffd07a);
          audio?.tone('hit', 0.45);
          break;
        }
      }
    }
  }

  /** nearest lane to thread (AI) */
  laneAt(e) {
    let best = this.vehicles[0]?.e ?? 0, bd = 1e9;
    for (const tv of this.vehicles) { const dd = Math.abs(tv.e - e); if (dd < bd) { bd = dd; best = tv.e; } }
    return best;
  }
}

// ---------------------------------------------------------------------------
// 4. MAGNETIC CRANES
// ---------------------------------------------------------------------------
class Crane {
  /**
   * A yard crane whose magnet swings a capture cone across the deck. Any craft
   * inside the cone is lifted, carried, and thrown down whichever branch the
   * magnet has locked. Ride it for a launch boost, or fight it with airbrakes
   * to break the lock and keep your line.
   */
  constructor(scene, track, opts) {
    this.track = track;
    this.deck = track.deck;
    this.s = opts.s;                       // arc length of the capture zone centre
    this.sHalf = opts.sHalf ?? 16;
    this.f = { ...track.deck.frame(this.s, {}) };
    this.branches = opts.branches;         // [{e, y, path, label}]
    // the magnet field swings *between its two claimed lanes* so the head is
    // always physically over the lane it is about to claim
    this.laneSpan = Math.abs(this.branches[1].e - this.branches[0].e) * 0.5;
    this.laneMid = (this.branches[0].e + this.branches[1].e) * 0.5;
    this.side = opts.side ?? 1;            // which shoulder the tower stands on
    this.swingSpeed = opts.swingSpeed ?? 0.33;
    this.coneHalf = opts.coneHalf ?? 8.4;
    this.color = opts.color ?? 0xff3ec8;
    this.capture = [];
    this.claim = 0;
    this.t = Math.random() * 10;

    const e = this.side * (this.f.hw + 13);
    this.towerPos = new THREE.Vector3(this.f.x + this.f.rx * e, this.f.y - 6, this.f.z + this.f.rz * e);
    const g = new THREE.Group();
    g.position.copy(this.towerPos);
    g.rotation.y = this.f.th;
    scene.add(g);
    this.group = g;

    const steel = new THREE.MeshStandardMaterial({ color: 0x2c3340, roughness: 0.62, metalness: 0.75 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x3a1a33, emissive: this.color, emissiveIntensity: 0.6, roughness: 0.4 });
    // legs
    for (const [dx, dz] of [[-3.4, -3.4], [3.4, -3.4], [-3.4, 3.4], [3.4, 3.4]]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.1, 34, 1.1), steel);
      leg.position.set(dx, 17, dz);
      g.add(leg);
    }
    const deckTop = new THREE.Mesh(new THREE.BoxGeometry(9, 1.4, 9), steel);
    deckTop.position.y = 34.6;
    g.add(deckTop);
    // jib: swings over the racing deck
    this.jib = new THREE.Group();
    this.jib.position.y = 35.4;
    g.add(this.jib);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(34, 1.5, 1.8), steel);
    arm.position.set(-this.side * 15, 0, 0);
    this.jib.add(arm);
    const counter = new THREE.Mesh(new THREE.BoxGeometry(7, 2.2, 3.2), accent);
    counter.position.set(this.side * 5, 0, 0);
    this.jib.add(counter);
    // trolley + magnet head
    this.trolley = new THREE.Group();
    this.trolley.position.set(-this.side * 4, 0, 0);
    this.jib.add(this.trolley);
    const block = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.0, 3.2), steel);
    this.trolley.add(block);
    this.head = new THREE.Group();
    this.head.position.y = -12;
    this.trolley.add(this.head);
    const magnet = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.9, 1.5, 12), new THREE.MeshStandardMaterial({
      color: 0x552244, emissive: this.color, emissiveIntensity: 1.0, roughness: 0.3, metalness: 0.7,
    }));
    this.head.add(magnet);
    this.cable = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 12, 6), steel);
    this.cable.position.y = 6;
    this.head.add(this.cable);
    this.halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture(), color: this.color, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.75,
    }));
    this.halo.position.y = -1.4;
    this.halo.scale.setScalar(9);
    this.head.add(this.halo);

    // capture beam + deck footprint glow
    this.beam = new THREE.Mesh(new THREE.ConeGeometry(this.coneHalf, 22, 16, 1, true), new THREE.MeshBasicMaterial({
      color: this.color, transparent: true, opacity: 0.1, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.beam.rotation.x = Math.PI;
    this.group.parent.add(this.beam);
    this.foot = new THREE.Mesh(new THREE.PlaneGeometry(this.coneHalf * 2.2, this.sHalf * 2), new THREE.MeshBasicMaterial({
      map: chevronTexture('#ff3ec8', '#000000'), color: 0xffffff, transparent: true, opacity: 0.34,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    this.foot.rotation.x = -Math.PI / 2;
    this.group.parent.add(this.foot);
  }

  /** magnet head world position */
  headWorld(out = new THREE.Vector3()) {
    return this.head.getWorldPosition(out);
  }

  /** magnet field centre in deck-lateral coords, in metres */
  coneCenterE(t = this.t) {
    return this.laneMid + Math.sin(t * this.swingSpeed * TWO) * this.laneSpan;
  }

  /** which branch is claimed right now — the one nearest the field centre */
  claimedBranch(t = this.t) {
    const cE = this.coneCenterE(t);
    let best = 0;
    for (let i = 1; i < this.branches.length; i++) {
      if (Math.abs(cE - this.branches[i].e) < Math.abs(cE - this.branches[best].e)) best = i;
    }
    this.claim = best;
    return this.branches[best];
  }

  update(dt, t, vehicles, player, audio, track) {
    this.t = t;
    const cE = this.coneCenterE(t);
    // swing the jib so the head tracks the cone centre
    const localE = cE;
    const f = this.f;
    // local: x = -side * distance from tower along the right vector
    const dist = (this.side * (f.hw + 13)) - localE;
    this.trolley.position.x = -this.side * dist;
    this.trolley.position.z = 0;
    const bob = Math.sin(t * 0.9) * 0.4;
    this.head.position.y = -12 + bob;
    this.jib.rotation.y = Math.sin(t * 0.21) * 0.06;

    const headPos = this.headWorld(this._hw || (this._hw = new THREE.Vector3()));
    this.beam.position.copy(headPos);
    this.beam.rotation.z = 0;
    this.beam.rotation.x = Math.PI;
    this.beam.updateMatrixWorld();

    const branch = this.claimedBranch(t);
    const fh = f.hw;
    this.foot.position.set(f.x + f.rx * cE, f.y + 0.1, f.z + f.rz * cE);
    this.foot.rotation.z = -f.th;
    this.foot.material.color.setHex(branch.y > 1 ? 0xffb42e : 0xffffff);
    this.beam.material.opacity = 0.1 + 0.14 * Math.abs(Math.sin(t * 3.1));

    // --- capture / release ---
    for (const v of vehicles) {
      if (v.wrecked || v.capture) continue;
      const cap = v.captureState;
      if (!cap) {
        if (v.path !== this.deck && v.path !== track.branches.high) continue;
        if (Math.abs(v.s - this.s) > this.sHalf) continue;
        if (Math.abs(v.e - cE) > this.coneHalf) continue;
        if (v.speed < 22) continue;
        if (v.invuln > 0) continue;
        v.captureState = {
          t: 0, dur: 2.9, crane: this, branch, startE: v.e, startS: v.s,
          entrySpeed: v.speed, escape: 0, released: false,
        };
        v.lifted = true;
        v.capture = this;
        audio?.tone('magnet', 0.5);
        v.onCaption?.('MAGNET LOCK', `yard crane seizes the craft — ${branch.label} claimed`);
      }
    }
    for (const v of vehicles) {
      const cap = v.captureState;
      if (!cap || cap.crane !== this) continue;
      cap.t += dt;
      const u = clamp(cap.t / cap.dur, 0, 1);
      // player fights the magnet with airbrakes
      if (v.isPlayer && v.lastInput && (v.lastInput.airL > 0.3 || v.lastInput.airR > 0.3)) {
        cap.escape += dt;
        v.shake = 0.6;
      }
      const escaped = cap.escape > 0.55;
      // path: lift, carry, throw
      const lift = smoothstep(clamp(u / 0.28, 0, 1));
      const carry = smoothstep(clamp((u - 0.2) / 0.5, 0, 1));
      const drop = smoothstep(clamp((u - 0.72) / 0.28, 0, 1));
      const sNow = cap.startS + (this.s + 16 - cap.startS) * carry;
      const fNow = this.deck.frame(sNow, {});
      const targetE = escaped ? cap.startE : (branch.e ?? 0);
      const eNow = cap.startE + (targetE - cap.startE) * carry;
      const deckY = fNow.y + eNow * fNow.tilt;
      const h = 26 * lift * (1 - drop) + CONFIG.hoverHeight;
      const spin = u * 6;
      v.pos.set(
        fNow.x + fNow.rx * eNow + Math.sin(spin) * 0.5,
        deckY + h,
        fNow.z + fNow.rz * eNow + Math.cos(spin * 1.3) * 0.5,
      );
      v.yaw = fNow.th;
      v.s = sNow; v.e = eNow;
      v.speed = cap.entrySpeed * (0.7 + 0.5 * carry);
      v.roll = Math.sin(spin * 1.7) * 0.35;
      v.pitch = Math.sin(spin) * 0.2;
      v.mesh.position.copy(v.pos);
      v.mesh.rotation.set(0, v.yaw, 0);
      v.mesh.rotateZ(v.roll);
      v.mesh.rotateX(v.pitch);
      v.rotorSpin = spin;

      if (u >= 1 || (escaped && u > 0.35)) {
        // release
        const target = escaped ? null : branch;
        if (target && target.path) {
          v.teleport ? v.teleport(target.path, target.s0 ?? 4, target.e ?? 0)
            : (v.path = target.path, v.s = target.s0 ?? 4, v.e = target.e ?? 0, v.lastS = v.s);
        } else {
          v.teleport ? v.teleport(this.deck, this.s + 16, clamp(targetE, -fh + 4, fh - 4))
            : (v.path = this.deck, v.e = clamp(targetE, -fh + 4, fh - 4), v.s = this.s + 16);
        }
        v.lastS = v.s;
        v.speed = cap.entrySpeed * (escaped ? 0.86 : 1.34);
        v.lifted = false;
        v.capture = null;
        v.captureState = null;
        v.roll = 0; v.pitch = 0;
        v.invuln = Math.max(v.invuln, 0.7);
        v.shake = escaped ? 0.5 : 0.9;
        audio?.tone(escaped ? 'hit' : 'thrown', 0.5);
        if (v.isPlayer) {
          v.onCaption?.(escaped ? 'LOCK BROKEN' : 'LAUNCHED', escaped
            ? 'you fought the field — staying on your line'
            : `crane released you down the ${target?.label ?? 'deck'} (+34% speed)`);
        }
      }
    }

    // the Y-fork divider island is solid
    if (track.island) {
      const isl = track.island;
      for (const v of vehicles) {
        if (v.lifted || v.wrecked || v.path !== this.deck) continue;
        if (v.s < isl.s0 || v.s > isl.s1) continue;
        const lim = isl.halfWidth + v.radius;
        if (Math.abs(v.e) < lim) {
          const side = Math.sign(v.e || 1);
          v.e = side * lim;
          const f2 = this.deck.frame(v.s, {});
          v.pos.x = f2.x + f2.rx * v.e;
          v.pos.z = f2.z + f2.rz * v.e;
          v.addHullDamage(48, 'divider');
          v.speed *= 0.55;
          v.shake = 1.2;
          v.onSpark?.(v.pos.x, v.pos.y, v.pos.z, 26, 0xffb42e);
          audio?.tone('hit', 0.55);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Hazards — owns all four systems + shared FX
// ---------------------------------------------------------------------------
export class Hazards {
  constructor(scene, track, audio) {
    this.scene = scene;
    this.track = track;
    this.audio = audio;
    this.sparks = new Sparks(scene, 320);
    const A = track.anchors;

    this.zipper = new Zipper(scene, track, { s0: A.zipper.s0 + 6, s1: A.zipper.s1 - 6 }, {
      amp: 17.5, period: 9.4, wavelength: 820, openHalf: 4.0, lanes: 2,
    });
    if (A.zipper2) {
      this.zipper2 = new Zipper(scene, track, { s0: A.zipper2.s0 + 4, s1: A.zipper2.s1 - 4 }, {
        amp: 12.5, period: 7.0, wavelength: 620, openHalf: 4.4, lanes: 1, rowSpacing: 4.2,
      });
    }

    const T = A.train;
    this.trains = [
      new TrainLine(scene, track, T.s0 + 52, { cars: 3, dir: 1 }),
      new TrainLine(scene, track, T.s0 + 118, { cars: 4, dir: -1 }),
      new TrainLine(scene, track, T.s0 + 186, { cars: 3, dir: 1 }),
    ];

    this.traffic = new Traffic(scene, track, A.traffic, 13);

    const high = track.branches.high;
    this.cranes = [
      new Crane(scene, track, {
        s: A.crane.s0 + 62, sHalf: 17, color: 0xff3ec8, side: 1, swingSpeed: 0.3, coneHalf: 8.4,
        branches: [
          { e: -11.5, label: 'LEFT LANE', y: 0 },
          { e: 11.5, label: 'RIGHT LANE', y: 0 },
        ],
      }),
      new Crane(scene, track, {
        s: A.tsplit.s0 + 46, sHalf: 17, color: 0xffb42e, side: -1, swingSpeed: 0.26, coneHalf: 6.0,
        branches: [
          { e: -9.5, label: 'HIGH LINE', y: 9.5, path: high, s0: 6 },
          { e: 0, label: 'LOW LINE', y: 0 },
        ],
      }),
    ];
    this.lights = new THREE.AmbientLight(0x0, 0);
    void this.lights;
  }

  /** PULSE teammate call — only meaningful around a zipper */
  pulse(player) {
    if (this.zipper.inRange(player.s)) return this.zipper.callPulse(player);
    if (this.zipper2 && this.zipper2.inRange(player.s)) return this.zipper2.callPulse(player);
    return false;
  }

  zipperNear(s) {
    if (this.zipper.inRange(s)) return this.zipper;
    if (this.zipper2 && this.zipper2.inRange(s)) return this.zipper2;
    return null;
  }

  /** AI helper: lateral target that threads the current zipper */
  safeLane(s, e) {
    const z = this.zipperNear(s);
    if (!z) return null;
    const gaps = z.gapAt(s + 20, e);
    let best = null, bd = 1e9;
    for (const [a, b] of gaps) {
      const c = (a + b) * 0.5;
      const d = Math.abs(c - e);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  /**
   * Should a craft travelling at `speed` and currently at `s` slow down?
   * 1 = the crossing will be swept exactly when you get there, 0 = clear.
   */
  trainBrake(s, speed, clearance = 0.9) {
    let out = 0;
    for (const t of this.trains) {
      let ds = t.s - s;
      const L = this.track.length;
      if (ds < -L * 0.5) ds += L; else if (ds > L * 0.5) ds -= L;
      if (ds < 12 || ds > 340) continue;
      const arrive = ds / Math.max(24, speed);
      const w = t.dangerWindow();
      if (arrive > w.start - clearance && arrive < w.end + 0.5) {
        out = Math.max(out, 1);
      } else if (arrive > w.start - 3 && arrive < w.end + 2) {
        out = Math.max(out, 0.5);
      }
    }
    return out;
  }

  /** AI helper: 0..1 risk of a train at this s right now */
  trainRisk(s, speed = 100) {
    let risk = 0;
    for (const t of this.trains) {
      const dt = t.timeToDanger();
      const ds = Math.abs(s - t.s);
      if (ds > 260) continue;
      const travelTime = ds / Math.max(25, speed);
      const w = 1 - clamp(Math.abs(travelTime - dt) / 1.6, 0, 1);
      const near = clamp(1 - ds / 260, 0, 1);
      risk = Math.max(risk, t.state === 'crossing' ? near : w);
    }
    return risk;
  }

  update(dt, t, vehicles, player, race) {
    const ctx = { vehicles, player, audio: this.audio };
    // stagger: if one crossing is live, hold the others back
    const live = this.trains.some((tr) => tr.state !== 'idle');
    if (live) for (const tr of this.trains) if (tr.state === 'idle') tr.timer = Math.max(tr.timer, 1.4);
    this.zipper.update(dt, t, vehicles, player, this.audio);
    if (this.zipper2) this.zipper2.update(dt, t, vehicles, player, this.audio);
    for (const tr of this.trains) tr.update(dt, t, vehicles, player, this.audio);
    this.traffic.update(dt, t, vehicles, player, this.audio);
    for (const c of this.cranes) c.update(dt, t, vehicles, player, this.audio, this.track);
    this.sparks.update(dt);
    void ctx; void race;
  }

  /** HUD: the most urgent thing ahead of the player */
  threatList(player) {
    const out = [];
    const s = player.totalS;
    const Z = this.zipperNear(player.s);
    if (Z) {
      const d = ((Z.s0 - player.s) % this.track.length + this.track.length) % this.track.length;
      out.push({ kind: 't-zip', label: Z === this.zipper ? 'BOLLARD ZIPPER' : 'ZIPPER RUN 2', d, active: player.s > Z.s0 - 20 && player.s < Z.s1 + 20 });
    }
    let nearest = null;
    for (const tr of this.trains) {
      const d = ((tr.s - player.s) % this.track.length + this.track.length) % this.track.length;
      if (d < 420 && (!nearest || d < nearest.d)) nearest = { kind: 't-train', label: 'MAGLEV CROSSING', d, active: d < 70 };
    }
    if (nearest) out.push(nearest);
    { // traffic
      const A = this.track.anchors.traffic;
      const d = ((A.s0 - player.s) % this.track.length + this.track.length) % this.track.length;
      if (d < 500) out.push({ kind: 't-traf', label: 'TRAFFIC DISTRICT', d, active: player.s > A.s0 - 20 && player.s < A.s1 + 20 });
    }
    for (const c of this.cranes) {
      const d = ((c.s - player.s) % this.track.length + this.track.length) % this.track.length;
      if (d < 500) out.push({ kind: 't-crane', label: 'MAGNETIC CRANE', d, active: d < 40 });
    }
    out.sort((a, b) => a.d - b.d);
    return out.slice(0, 4);
  }
}
