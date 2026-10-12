// ---------------------------------------------------------------------------
// SHIPS — anti-gravity craft: procedural hulls, engine glow, trails, and the
// arcade drag/steer model shared by the player and the rivals.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { CONFIG, clamp, damp, lerp } from './config.js';
import { glowTexture } from './textures.js';

// ---------------------------------------------------------------------------
// hull: lofted from cross-sections, so it reads as a sharp AG dart
// ---------------------------------------------------------------------------
function loftHull(sections) {
  const pos = [], idx = [];
  const rings = sections.map((sct) => {
    // octagonal cross-section: wide, flat-bottomed, chamfered
    const { z, w, y, h } = sct;
    const ring = [
      [0, y + h * 0.62, z + 0],
      [w * 0.55, y + h * 0.42, z],
      [w, y + h * 0.02, z],
      [w * 0.86, y - h * 0.55, z],
      [0, y - h * 0.78, z],
      [-w * 0.86, y - h * 0.55, z],
      [-w, y + h * 0.02, z],
      [-w * 0.55, y + h * 0.42, z],
    ];
    return ring;
  });
  for (const ring of rings) for (const p of ring) pos.push(p[0], p[1], p[2]);
  const R = rings.length, N = 8;
  for (let r = 0; r < R - 1; r++) {
    for (let i = 0; i < N; i++) {
      const a = r * N + i, b = r * N + ((i + 1) % N);
      const c = (r + 1) * N + i, d = (r + 1) * N + ((i + 1) % N);
      idx.push(a, c, b, b, c, d);
    }
  }
  // caps
  for (let i = 1; i < N - 1; i++) idx.push(0, i + 1, i);
  const base = (R - 1) * N;
  for (let i = 1; i < N - 1; i++) idx.push(base, base + i, base + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function makeShipMesh(color) {
  const g = new THREE.Group();
  const accent = new THREE.Color(color);
  const body = new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.42, metalness: 0.85 });
  const trim = new THREE.MeshStandardMaterial({
    color: accent.clone().multiplyScalar(0.25), emissive: accent, emissiveIntensity: 1.25,
    roughness: 0.3, metalness: 0.4,
  });
  const glass = new THREE.MeshStandardMaterial({
    color: 0x0a1420, roughness: 0.08, metalness: 0.9, transparent: true, opacity: 0.72,
  });

  const hull = new THREE.Mesh(loftHull([
    { z: 4.10, w: 0.10, y: 0.02, h: 0.07 },
    { z: 3.05, w: 0.44, y: 0.05, h: 0.24 },
    { z: 1.65, w: 0.90, y: 0.10, h: 0.42 },
    { z: 0.30, w: 1.32, y: 0.14, h: 0.50 },
    { z: -1.35, w: 1.36, y: 0.12, h: 0.46 },
    { z: -2.85, w: 1.06, y: 0.14, h: 0.38 },
    { z: -3.75, w: 0.66, y: 0.18, h: 0.28 },
  ]), body);
  g.add(hull);

  // team stripe down the spine
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, 5.6), trim);
  spine.position.set(0, 0.44, -0.5);
  g.add(spine);

  // canopy
  const canopy = new THREE.Mesh(new THREE.SphereGeometry(0.62, 14, 10), glass);
  canopy.scale.set(0.82, 0.5, 1.65);
  canopy.position.set(0, 0.42, 0.75);
  g.add(canopy);

  // engine nacelles
  const nac = new THREE.CylinderGeometry(0.34, 0.42, 2.5, 12);
  nac.rotateX(Math.PI / 2);
  for (const sx of [-1, 1]) {
    const m = new THREE.Mesh(nac, body);
    m.position.set(sx * 1.18, 0.06, -2.35);
    g.add(m);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.075, 6, 14), trim);
    ring.position.set(sx * 1.18, 0.06, -3.58);
    g.add(ring);
  }

  // fins
  for (const sx of [-1, 1]) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.9, 1.7), body);
    fin.position.set(sx * 1.42, 0.34, -1.9);
    fin.rotation.z = sx * -0.42;
    g.add(fin);
  }
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.0, 1.5), trim);
  tail.position.set(0, 0.72, -3.0);
  g.add(tail);

  // hover cushion
  const cushion = new THREE.Mesh(
    new THREE.PlaneGeometry(3.4, 8.6),
    new THREE.MeshBasicMaterial({
      map: glowTexture(), color: accent, transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }),
  );
  cushion.rotation.x = -Math.PI / 2;
  cushion.position.y = -0.62;
  g.add(cushion);

  const glowMat = new THREE.SpriteMaterial({
    map: glowTexture(), color: accent, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, opacity: 0.95,
  });
  const glows = [];
  for (const [x, y, z, s] of [[-1.18, 0.06, -3.9, 1.5], [1.18, 0.06, -3.9, 1.5], [0, -0.4, -1.2, 3.4]]) {
    const sp = new THREE.Sprite(glowMat.clone());
    sp.position.set(x, y, z);
    sp.scale.setScalar(s);
    g.add(sp);
    glows.push(sp);
  }
  // headlight strip
  const lamp = new THREE.Mesh(
    new THREE.PlaneGeometry(1.5, 0.3),
    new THREE.MeshBasicMaterial({
      map: glowTexture(), color: 0xdff2ff, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.85,
    }),
  );
  lamp.position.set(0, 0.22, 4.15);
  g.add(lamp);
  g.userData = { glows, cushion, lamp, trim, accent };
  return g;
}

// ---------------------------------------------------------------------------
// motion trail ribbon
// ---------------------------------------------------------------------------
class Trail {
  constructor(scene, color, width = 0.5, len = 26, offX = 0) {
    this.len = len;
    this.width = width;
    this.offX = offX;
    this.pts = new Float32Array(len * 2 * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pts, 3));
    const cols = new Float32Array(len * 2 * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const idx = [];
    for (let i = 0; i < len - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    g.setIndex(idx);
    this.cols = cols;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide, opacity: 0.9,
    }));
    this.mesh.frustumCulled = false;
    this.c = new THREE.Color(color);
    this.inited = false;
    scene.add(this.mesh);
  }

  update(pos, right) {
    const L = this.len, p = this.pts;
    if (!this.inited) {
      for (let i = 0; i < L; i++) {
        p[i * 6 + 0] = pos.x; p[i * 6 + 1] = pos.y; p[i * 6 + 2] = pos.z;
        p[i * 6 + 3] = pos.x; p[i * 6 + 4] = pos.y; p[i * 6 + 5] = pos.z;
      }
      this.inited = true;
    }
    // shift back
    for (let i = L - 1; i > 0; i--) {
      const a = i * 6, b = (i - 1) * 6;
      p[a] = p[b]; p[a + 1] = p[b + 1]; p[a + 2] = p[b + 2];
      p[a + 3] = p[b + 3]; p[a + 4] = p[b + 4]; p[a + 5] = p[b + 5];
    }
    const w = this.width;
    p[0] = pos.x + right.x * this.offX - right.x * w;
    p[1] = pos.y + this.offX * 0 - 0.25; p[2] = pos.z + right.z * this.offX - right.z * w;
    p[3] = pos.x + right.x * this.offX + right.x * w;
    p[4] = pos.y - 0.25;
    p[5] = pos.z + right.z * this.offX + right.z * w;
    for (let i = 0; i < L; i++) {
      const f = Math.pow(1 - i / (L - 1), 2.1);
      const a = i * 6;
      this.cols[a] = this.c.r * f; this.cols[a + 1] = this.c.g * f; this.cols[a + 2] = this.c.b * f;
      this.cols[a + 3] = this.c.r * f; this.cols[a + 4] = this.c.g * f; this.cols[a + 5] = this.c.b * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }

  setVisible(v) { this.mesh.visible = v; }
}

// ---------------------------------------------------------------------------
// Vehicle — shared state + visuals
// ---------------------------------------------------------------------------
export class Vehicle {
  constructor(opts) {
    const { scene, track, color, name, isPlayer, gridIndex, racerIndex } = opts;
    this.scene = scene;
    this.track = track;
    this.name = name;
    this.color = new THREE.Color(color);
    this.isPlayer = !!isPlayer;
    this.gridIndex = gridIndex ?? 0;
    this.racerIndex = racerIndex ?? gridIndex ?? 0;

    this.mesh = makeShipMesh(color);
    scene.add(this.mesh);
    this.trailL = new Trail(scene, color, 0.42, 22, -1.2);
    this.trailR = new Trail(scene, color, 0.42, 22, 1.2);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.right = new THREE.Vector3(1, 0, 0);
    this.fwd = new THREE.Vector3(0, 0, 1);
    this.path = track.deck;
    this.s = 0; this.e = 0; this.yaw = 0;
    this.speed = 0; this.latVel = 0;
    this.roll = 0; this.pitch = 0;
    this.hull = CONFIG.hullMax;
    this.energy = 100;
    this.boostHeat = 0;
    this.invuln = 0;
    this.wrecked = false;
    this.wreckT = 0;
    this.lifted = false;
    this.capture = null;
    this.shake = 0;
    this.hitFlash = 0;
    this.respawnHold = 0;
    this.radius = 1.7;

    // race bookkeeping
    this.lap = 0;
    this.totalS = 0;
    this.lastS = 0;
    this.lapTimes = [];
    this.bestLap = null;
    this.lapStart = 0;
    this.finished = false;
    this.finishTime = null;
    this.place = 1;
    this.lastHazardHit = '';
    this.reset(this.gridIndex);
  }

  reset(gridIndex = this.gridIndex) {
    const gp = this.track.startPositions[gridIndex % 4];
    this.s = gp.s; this.e = gp.e;
    this.yaw = gp.yaw;
    this.speed = 0; this.latVel = 0;
    this.hull = CONFIG.hullMax; this.energy = 100;
    this.wrecked = false; this.wreckT = 0; this.lifted = false; this.capture = null;
    this.path = this.track.deck;
    this.lap = 0; this.totalS = gp.s; this.lastS = gp.s;
    this.lapTimes = []; this.bestLap = null; this.finished = false; this.finishTime = null;
    this.respawnHold = 0; this.invuln = CONFIG.invulnTime;
    this.pos.set(gp.x, gp.y, gp.z);
    this.syncMesh(1);
  }

  get speedKmh() { return this.speed * 3.6; }
  get lapDistance() { return this.totalS; }

  syncMesh(dt) {
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.yaw, 0);
    this.mesh.rotateZ(this.roll);
    this.mesh.rotateX(this.pitch);
    const u = this.mesh.userData;
    const heat = clamp(this.boostHeat, 0, 1);
    for (const s of u.glows) {
      s.material.opacity = 0.55 + heat * 0.45;
      s.scale.setScalar((s.scale.x || 1) * 0 + (1.4 + heat * 1.6) * (s === u.glows[2] ? 2.2 : 1));
    }
    u.cushion.material.opacity = 0.25 + this.e * 0.004 + heat * 0.25;
    u.trim.emissiveIntensity = 1.0 + heat * 1.6 + (this.hitFlash > 0 ? 3 : 0);
  }

  /** place the craft on the deck surface under its (s,e) */
  snapToDeck() {
    const f = this.path.frame(this.s, this._f || (this._f = {}));
    this.pos.x = f.x + f.rx * this.e;
    this.pos.z = f.z + f.rz * this.e;
    this.deckY = f.y + this.e * f.tilt;
    this.pos.y = this.deckY + CONFIG.hoverHeight + this.bob;
    this.yaw = this.yaw;
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }

  /** move the craft to a spot on a deck without desyncing the projection */
  teleport(path, s, e = 0) {
    this.path = path;
    this.s = s; this.e = e; this.lastS = s;
    this._hint = path === this.track.deck ? path.idx(s) : undefined;
    const f = path.frame(s, this._f || (this._f = {}));
    this.deckY = f.y + e * f.tilt;
    this.pos.set(f.x + f.rx * e, this.deckY + CONFIG.hoverHeight, f.z + f.rz * e);
    this.yaw = f.th;
    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(0, this.yaw, 0);
    return this;
  }

  updateVisuals(dt, t, camera) {
    const u = this.mesh.userData;
    // hover bob + engine heat
    this.bob = Math.sin(t * 4.4 + this.racerIndex * 1.7) * 0.09;
    const targetHeat = this.lifted ? 1 : 0.35 + clamp(this.speed / CONFIG.baseTopSpeed, 0, 1.3) * 0.5;
    this.boostHeat = damp(this.boostHeat, targetHeat, 6, dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 2.4);
    if (this.wrecked) {
      this.mesh.visible = this.wreckT < 2.4;
    } else {
      this.mesh.visible = true;
    }
    if (!this.lifted) this.syncMesh(dt);
    const showTrail = !this.wrecked;
    this.trailL.setVisible(showTrail); this.trailR.setVisible(showTrail);
    if (showTrail) {
      const tp = this._tp || (this._tp = new THREE.Vector3());
      tp.copy(this.pos).addScaledVector(this.fwd, -3.6);
      tp.y -= 0.35;
      this.trailL.update(tp, this.right);
      this.trailR.update(tp, this.right);
    }
    void camera;
  }

  addHullDamage(amount, reason) {
    if (this.invuln > 0 || this.wrecked) return false;
    this.hull = Math.max(0, this.hull - amount);
    this.hitFlash = 1;
    this.lastHazardHit = reason || '';
    if (this.hull <= 0) this.wreck(reason);
    return true;
  }

  wreck(reason) {
    if (this.wrecked) return;
    this.wrecked = true;
    this.wreckT = 0;
    this.wreckReason = reason;
    this.speed *= 0.2;
    this.onWreck?.();
  }

  updateHull(dt) {
    if (this.wrecked) {
      this.wreckT += dt;
      if (this.wreckT > 2.4 && this.respawnPending !== true) {
        this.respawnPending = true;
        this.respawnTimer = 0.6;
      }
      if (this.respawnPending) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          this.respawnPending = false;
          this.respawn();
        }
      }
      // tumble
      this.mesh.rotation.z += dt * 3.4;
      this.mesh.rotation.x += dt * 2.1;
      this.pos.y = Math.max(this.deckY + 0.4, this.pos.y - dt * 9);
      return;
    }
    this.invuln = Math.max(0, this.invuln - dt);
    this.hull = Math.min(CONFIG.hullMax, this.hull + CONFIG.hullRegen * dt);
  }

  respawn() {
    // back onto the racing line, a little behind where it went wrong
    const back = 26;
    const len = this.path.length;
    const s = this.path === this.track.deck
      ? (this.s - back + len) % len
      : Math.max(4, this.s - back);
    const f = this.path.frame(s, this._f || (this._f = {}));
    this.s = s; this.lastS = s;
    this._hint = this.path === this.track.deck ? this.path.idx(s) : undefined;
    this.e *= 0.4;
    this.pos.set(f.x + f.rx * this.e, f.y + CONFIG.hoverHeight, f.z + f.rz * this.e);
    this.yaw = f.th;
    this.speed = 42;
    this.latVel = 0;
    this.hull = CONFIG.hullMax * 0.72;
    this.energy = Math.max(35, this.energy);
    this.wrecked = false;
    this.invuln = CONFIG.invulnTime;
    this.respawnHold = CONFIG.respawnHold;
    this.lifted = false;
    this.capture = null;
    this.mesh.rotation.set(0, this.yaw, 0);
    this.roll = 0; this.pitch = 0;
  }

  /** advance lap/progress counters; lap events are reported to the race */
  trackProgress(race) {
    if (this.path !== this.track.deck) return;
    const L = this.path.length;
    const ds = this.s - this.lastS;
    if (ds < -L * 0.5) {
      // crossed the seam forwards
      if (race) race.onLap(this); else this.lap++;
    } else if (ds > L * 0.5) {
      this.lap = Math.max(0, this.lap - 1);
    }
    this.lastS = this.s;
    this.totalS = this.lap * L + this.s;
  }
}

// ---------------------------------------------------------------------------
// PlayerShip — arcade AG physics
// ---------------------------------------------------------------------------
export class PlayerShip extends Vehicle {
  update(dt, input, race) {
    const C = CONFIG;
    this.updateHull(dt);
    if (this.wrecked) {
      this.lastInput = { boost: 0, airL: 0, airR: 0 };
      return;
    }
    if (this.respawnHold > 0) {
      this.respawnHold -= dt;
      this.speed = damp(this.speed, 30, 3, dt);
    }
    if (this.lifted && this.capture) return;   // the crane owns the craft

    const steer = clamp(input.steer, -1, 1);
    const wantBoost = input.boost > 0.5 && this.energy > C.boostMinToEngage;
    const boosting = wantBoost && this.speed > 12;

    // --- longitudinal ---
    const topSpeed = boosting ? C.boostTopSpeed : C.baseTopSpeed;
    if (this.respawnHold <= 0) {
      if (input.throttle > 0.02 || (!input.brake && !this.isPlayer)) {
        this.speed += C.accel * input.throttle * dt + (this.autoThrottle ? C.accel * 0.55 * dt : 0);
      }
      if (input.brake > 0.02) this.speed -= C.brakeDecel * input.brake * dt;
      if (boosting) {
        this.speed += C.boostAccel * dt;
        this.energy -= C.boostDrain * dt;
        this.boostActive = true;
      } else {
        this.boostActive = false;
        this.energy = Math.min(100, this.energy + C.boostRegen * dt);
      }
      // drag above the ceiling, gentle rolling drag below it
      if (this.speed > topSpeed) this.speed = damp(this.speed, topSpeed, 2.4, dt);
      // coasting decays toward zero — never drags a parked craft backwards
      if (this.speed > 0) this.speed = Math.max(0, this.speed - C.coastDecel * dt);
      else if (this.speed < 0 && input.brake < 0.02) {
        this.speed = Math.min(0, this.speed + C.coastDecel * 2 * dt);
      }
      this.speed = clamp(this.speed, -C.reverseSpeed, topSpeed);
    } else {
      this.energy = Math.min(100, this.energy + C.boostRegen * dt);
    }
    this.speed = Math.max(-C.reverseSpeed, this.speed);

    // --- yaw authority ---
    const sn = clamp(this.speed / C.baseTopSpeed, 0, 1.5);
    const airbrake = (input.airR > 0.02 ? input.airR : 0) - (input.airL > 0.02 ? input.airL : 0);
    const authority = C.steerRate * (C.steerSpeedFactor + (1 - C.steerSpeedFactor) * Math.min(1, sn));
    // +steer = right = yaw decreases (see forward(yaw) convention)
    let yawRate = -steer * authority;
    if (Math.abs(airbrake) > 0.02) yawRate += -airbrake * C.driftSteerRate * 0.55;
    // align toward the deck tangent — makes long sweepers flow, tight stuff still bites
    const f = this.path.frame(this.s, this._f || (this._f = {}));
    let align = wrapPi(f.th - this.yaw);
    const alignGain = C.alignRate * Math.pow(Math.min(1, sn), C.alignSpeedExp);
    yawRate += align * alignGain * (1 - Math.min(0.85, Math.abs(steer) * 0.8));
    this.yaw = wrapPi(this.yaw + yawRate * dt);

    // --- lateral ---
    this.latVel += -airbrake * C.airbrakeLatAccel * dt;
    this.latVel = damp(this.latVel, 0, C.lateralGrip, dt);
    this.latVel = clamp(this.latVel, -C.maxLateralSpeed, C.maxLateralSpeed);

    // --- integrate ---
    this.fwd.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.right.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
    this.vel.set(0, 0, 0)
      .addScaledVector(this.fwd, this.speed)
      .addScaledVector(this.right, this.latVel);
    this.pos.addScaledVector(this.vel, dt);

    // --- project onto the racing surface ---
    const pr = this.projectToDeck();
    // walls
    const hw = pr.hw - this.radius;
    if (Math.abs(this.e) > hw) {
      const over = Math.abs(this.e) - hw;
      const side = Math.sign(this.e);
      this.e = side * hw;
      const f2 = this.path.frame(this.s, this._f);
      this.pos.x = f2.x + f2.rx * this.e;
      this.pos.z = f2.z + f2.rz * this.e;
      const impact = Math.abs(this.latVel) + Math.abs(steer) * 12;
      this.latVel *= -0.18;
      this._wallT = (this._wallT ?? -9);
      if (impact > 7 && race && race.time - this._wallT > 0.4) {
        this._wallT = race.time;
        const dmg = impact * C.wallDamagePerSpeed * (this.invuln > 0 ? 0.15 : 1);
        this.addHullDamage(dmg, 'wall');
        this.shake = Math.min(1.2, impact * 0.045);
        this.onWallHit?.(impact);
      } else if (impact > 3) {
        this.shake = Math.min(0.5, impact * 0.02);
      }
      this.speed *= (1 - clamp(impact / 220, 0, 0.42));
      void over;
    }

    // --- riding height / attitude ---
    const f3 = this.path.frame(this.s, this._f);
    this.deckY = f3.y + this.e * f3.tilt;
    const targetY = this.deckY + C.hoverHeight + (this.bob || 0);
    this.pos.y = damp(this.pos.y, targetY, 9, dt);
    const targetRoll = -f3.tilt * 1.5 - this.latVel * 0.012 - steer * 0.16;
    const targetPitch = -clamp((this.speed - C.baseTopSpeed) / 260, -0.06, 0.09)
      - Math.abs(steer) * 0.05;
    this.roll = damp(this.roll, targetRoll, 7, dt);
    this.pitch = damp(this.pitch, targetPitch, 5, dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.trackProgress(race);
    // a player thrown onto the skyway by a crane must come back down again —
    // either by reaching the far end, or by a safety clock so a bad landing
    // (stalled against the skyway rail) can never soft-lock the race
    if (this.path !== this.track.deck) {
      this._branchT = (this._branchT ?? 0) + dt;
      if (!this.lifted && (this.s > this.path.length - 2 || this._branchT > 13)) {
        race?.onBranchEnd?.(this);
      }
    } else {
      this._branchT = 0;
    }
    this.lastInput = { boost: boosting ? 1 : 0, steer, airL: input.airL, airR: input.airR };
  }

  projectToDeck() {
    const onDeck = this.path === this.track.deck;
    const win = onDeck ? 150 : 40;
    if (onDeck && this._hint == null) this._hint = this.path.idx(this.s);
    let pr = this.path.project(this.pos.x, this.pos.z, onDeck ? this._hint : undefined, win, this._pr || (this._pr = {}));
    // Anything that writes s discontinuously (crane throw, respawn, branch
    // rejoin) can strand the window search in the wrong part of the loop, which
    // pins s and freezes the craft. If the hit is outside the deck, re-search
    // the whole loop once — cheap (2270 samples) and self-healing.
    if (onDeck && !(pr.dist <= pr.hw + 6)) {
      pr = this.path.project(this.pos.x, this.pos.z, null, this.path.n, this._pr);
    }
    this.s = pr.s; this.e = pr.e;
    if (onDeck) this._hint = pr.i;
    return pr;
  }

}

export function wrapPi(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
export { lerp };
