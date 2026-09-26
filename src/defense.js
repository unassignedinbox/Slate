import * as THREE from 'three';
import { mat } from './materials.js';
import { createCrewman } from './figures.js';
import { DIFFICULTY, COLORS } from './config.js';
import { clamp, damp, Rng } from './util.js';

const rng = new Rng(8081);

function createMG({ shield: withShield = true } = {}) {
  const g = new THREE.Group();
  const steel = mat(0x4b5155, { roughness: 0.6, metalness: 0.55 });
  const dark = mat(0x26292b, { roughness: 0.8, metalness: 0.3 });

  if (withShield) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 0.42, 9), steel);
    base.position.y = -0.3;
    g.add(base);
  }

  const yawGroup = new THREE.Group();
  g.add(yawGroup);

  if (withShield) {
    const shield = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.78, 0.09), steel);
    shield.position.set(0, 0.08, 0.34);
    shield.rotation.x = -0.12;
    shield.castShadow = true;
    yawGroup.add(shield);
  }

  const pitchGroup = new THREE.Group();
  yawGroup.add(pitchGroup);

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.24, 0.9), dark);
  body.position.z = 0.2;
  pitchGroup.add(body);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.058, 1.35, 7), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 1.2;
  pitchGroup.add(barrel);
  const jacket = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.5, 7), steel);
  jacket.rotation.x = Math.PI / 2;
  jacket.position.z = 0.78;
  pitchGroup.add(jacket);
  const ammo = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.24, 0.4), mat(0x4a5340, { roughness: 0.9 }));
  ammo.position.set(0.3, -0.12, 0.05);
  pitchGroup.add(ammo);

  const gunner = createCrewman();
  gunner.position.set(0, -0.12, -0.5);
  yawGroup.add(gunner);

  g.userData = { yawGroup, pitchGroup, muzzleZ: 1.9, crew: [gunner] };
  return g;
}

function createATGun() {
  const g = new THREE.Group();
  const steel = mat(0x4f5347, { roughness: 0.72, metalness: 0.4 });
  const dark = mat(0x2a2d2a, { roughness: 0.9 });

  const yawGroup = new THREE.Group();
  g.add(yawGroup);

  const shield = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.5, 0.12), steel);
  shield.position.set(0, 0.2, 0.5);
  shield.rotation.x = -0.1;
  shield.castShadow = true;
  yawGroup.add(shield);

  const pitchGroup = new THREE.Group();
  yawGroup.add(pitchGroup);
  const breech = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.46, 1.1), dark);
  breech.position.z = 0.1;
  pitchGroup.add(breech);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 4.4, 9), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 2.5;
  barrel.castShadow = true;
  pitchGroup.add(barrel);
  const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.55, 9), steel);
  brake.rotation.x = Math.PI / 2;
  brake.position.z = 4.6;
  pitchGroup.add(brake);

  const layer = createCrewman();
  layer.position.set(-0.62, -0.2, -0.55);
  layer.scale.setScalar(1.04);
  yawGroup.add(layer);
  const loader = createCrewman();
  loader.position.set(0.72, -0.26, -0.95);
  loader.rotation.y = -0.5;
  yawGroup.add(loader);

  g.userData = { yawGroup, pitchGroup, muzzleZ: 4.9, crew: [layer, loader] };
  return g;
}

class Sentry {
  constructor(mount, scene) {
    this.kind = mount.kind;
    this.position = mount.position.clone();
    this.baseYaw = mount.yaw;
    // A gun in a casemate has the concrete for protection; only the open
    // wall-top nests carry a shield and a pintle base.
    this.object =
      this.kind === 'at' ? createATGun() : createMG({ shield: !mount.host });
    this.object.position.copy(this.position);
    this.object.rotation.y = mount.yaw;
    scene.add(this.object);

    this.yaw = 0;
    this.pitch = 0;
    this.state = 'scan';
    this.timer = rng.float(0, 2);
    this.burstLeft = 0;
    this.shotTimer = 0;
    this.losTimer = rng.float(0, 0.2);
    this.hasLos = false;
    this.lockT = 0;
    this.alive = true;
    this.scanPhase = rng.float(0, Math.PI * 2);
    this.errX = 0;
    this.errY = 0;
    this.errZ = 0;
    this.reload = this.kind === 'at' ? rng.float(2, 6) : 0;
    this._aim = new THREE.Vector3();
    this._muzzle = new THREE.Vector3();
  }

  muzzleWorld(target = new THREE.Vector3()) {
    const ud = this.object.userData;
    target.set(0, 0, ud.muzzleZ);
    ud.pitchGroup.localToWorld(target);
    return target;
  }

  update(dt, car, ctx) {
    if (!this.alive) return;
    const ud = this.object.userData;
    const range = this.kind === 'at' ? DIFFICULTY.atRange : DIFFICULTY.sentryRange;

    const dx = car.pos.x - this.position.x;
    const dz = car.pos.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const inRange = dist < range && car.alive && ctx.playerVisible !== false;

    // Line of sight, rechecked a few times a second.
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.14 + Math.random() * 0.1;
      if (!inRange) {
        this.hasLos = false;
      } else {
        const m = this.muzzleWorld(this._muzzle);
        const ty = car.pos.y + 0.8;
        const blockedByProps = ctx.colliders.blocksLine(m.x, m.y, m.z, car.pos.x, ty, car.pos.z);
        const blockedByGround =
          !blockedByProps && ctx.terrain.terrainBlocksLine(m.x, m.y, m.z, car.pos.x, ty, car.pos.z, 30);
        this.hasLos = !blockedByProps && !blockedByGround;
      }
    }

    // Aim point with a little lead so fast cars still get chased.
    const speed = this.kind === 'at' ? DIFFICULTY.atShellSpeed : DIFFICULTY.bulletSpeed;
    const tof = dist / speed;
    const lead = this.kind === 'at' ? 0.95 : 0.7;
    // Gunners are good, not clairvoyant: a per-burst aim error keeps steady
    // targets from being an automatic kill and rewards changing speed.
    this._aim.set(
      car.pos.x + car.vel.x * tof * lead + this.errX * dist,
      car.pos.y + 0.75 + this.errY * dist,
      car.pos.z + car.vel.z * tof * lead + this.errZ * dist
    );

    let targetYaw;
    let targetPitch;
    if (this.hasLos) {
      const lx = this._aim.x - this.position.x;
      const lz = this._aim.z - this.position.z;
      const ly = this._aim.y - this.position.y;
      const worldYaw = Math.atan2(lx, lz);
      targetYaw = worldYaw - this.baseYaw;
      targetPitch = Math.atan2(ly, Math.hypot(lx, lz));
    } else {
      this.scanPhase += dt * 0.35;
      targetYaw = Math.sin(this.scanPhase) * 0.55;
      targetPitch = -0.06;
    }
    // Normalise into (-pi, pi]
    while (targetYaw > Math.PI) targetYaw -= Math.PI * 2;
    while (targetYaw < -Math.PI) targetYaw += Math.PI * 2;
    targetYaw = clamp(targetYaw, -1.35, 1.35);
    targetPitch = clamp(targetPitch, -0.55, 0.32);

    const turnSpeed = this.kind === 'at' ? 3.0 : 5.5;
    this.yaw = damp(this.yaw, targetYaw, turnSpeed, dt);
    this.pitch = damp(this.pitch, targetPitch, turnSpeed, dt);
    ud.yawGroup.rotation.y = this.yaw;
    ud.pitchGroup.rotation.x = -this.pitch;

    const aimed = Math.abs(this.yaw - targetYaw) < 0.09;

    if (!this.hasLos) {
      this.lockT = Math.max(0, this.lockT - dt * 1.6);
      this.targeting = false;
      return;
    }

    if (this.kind === 'at') {
      this.reload -= dt;
      this.lockT = clamp(this.lockT + dt, 0, 2);
      this.targeting = this.reload < 1.2;
      if (this.reload <= 0 && aimed && this.lockT > 1.0) {
        this.reload = DIFFICULTY.atReload * (0.8 + Math.random() * 0.5);
        const e = DIFFICULTY.atAimError;
        this.errX = (Math.random() - 0.5) * e;
        this.errZ = (Math.random() - 0.5) * e;
        const m = this.muzzleWorld(this._muzzle);
        const dir = this._aim.clone().sub(m).normalize();
        ctx.spawnShell(m, dir, this);
        ctx.fx.glowPool.spawn(m.x, m.y, m.z, {
          color: 0xffdca0,
          size: 3.4,
          size1: 0.6,
          alpha: 1,
          life: 0.14,
        });
        ctx.fx.smoke({ x: m.x, y: m.y, z: m.z }, { size: 1.6, size1: 6, alpha: 0.5, life: 1.6, vy: 0.6, color: 0x8a857c });
        if (ctx.audio) ctx.audio.cannon(this.position, ctx.listener);
      }
      return;
    }

    // Machine gun: short aimed bursts.
    this.lockT = clamp(this.lockT + dt, 0, DIFFICULTY.sentryLockTime + 1);
    this.targeting = true;
    if (this.state === 'scan') {
      if (this.lockT >= DIFFICULTY.sentryLockTime && aimed && ctx.requestFire && ctx.requestFire()) {
        this.state = 'burst';
        const e = DIFFICULTY.sentryAimError;
        this.errX = (Math.random() - 0.5) * e;
        this.errY = (Math.random() - 0.5) * e * 0.35;
        this.errZ = (Math.random() - 0.5) * e;
        this.burstLeft = DIFFICULTY.sentryBurst + Math.floor(Math.random() * 4);
        this.shotTimer = 0;
      }
    } else if (this.state === 'burst') {
      this.shotTimer -= dt;
      if (this.shotTimer <= 0) {
        this.shotTimer = DIFFICULTY.sentryShotGap;
        this.burstLeft--;
        const m = this.muzzleWorld(this._muzzle);
        const dir = this._aim.clone().sub(m).normalize();
        dir.x += (Math.random() - 0.5) * DIFFICULTY.sentrySpread * 2;
        dir.y += (Math.random() - 0.5) * DIFFICULTY.sentrySpread;
        dir.z += (Math.random() - 0.5) * DIFFICULTY.sentrySpread * 2;
        dir.normalize();
        ctx.spawnBullet(m, dir, this);
        ctx.fx.glowPool.spawn(m.x, m.y, m.z, {
          color: 0xffe2a8,
          size: 1.1,
          size1: 0.1,
          alpha: 0.9,
          life: 0.06,
        });
        if (ctx.audio) ctx.audio.mg(this.position, ctx.listener);
        if (this.burstLeft <= 0) {
          this.state = 'cool';
          this.timer = DIFFICULTY.sentryBurstGap * (0.7 + Math.random() * 0.8);
        }
      }
    } else if (this.state === 'cool') {
      this.timer -= dt;
      if (this.timer <= 0) this.state = 'scan';
    }
  }
}

export class DefenseNetwork {
  constructor(scene, terrain, colliders, fx, mounts) {
    this.scene = scene;
    this.terrain = terrain;
    this.colliders = colliders;
    this.fx = fx;
    this.sentries = mounts.map((m) => new Sentry(m, scene));
    this.bullets = [];
    this.shells = [];
    this.maxBullets = 200;
    this._v = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this.underFire = 0;
    this.targeted = false;
  }

  /** Clear tracers, shells and gun state between attempts. */
  reset() {
    this.bullets.length = 0;
    this.shells.length = 0;
    this.targeted = false;
    this.underFire = 0;
    for (const s of this.sentries) {
      s.state = 'scan';
      s.lockT = 0;
      s.burstLeft = 0;
      s.timer = 0;
      s.targeting = false;
      s.hasLos = false;
      s.reload = DIFFICULTY.atReload * 0.6;
    }
  }

  spawnBullet(pos, dir, owner) {
    if (this.bullets.length >= this.maxBullets) this.bullets.shift();
    this.bullets.push({
      pos: pos.clone(),
      prev: pos.clone(),
      vel: dir.clone().multiplyScalar(DIFFICULTY.bulletSpeed),
      life: 2.2,
      owner,
    });
  }

  spawnShell(pos, dir, owner) {
    this.shells.push({
      pos: pos.clone(),
      prev: pos.clone(),
      vel: dir.clone().multiplyScalar(DIFFICULTY.atShellSpeed),
      life: 6,
      owner,
    });
  }

  update(dt, car, ctx) {
    const context = {
      ...ctx,
      colliders: this.colliders,
      terrain: this.terrain,
      fx: this.fx,
      spawnBullet: (p, d, o) => this.spawnBullet(p, d, o),
      spawnShell: (p, d, o) => this.spawnShell(p, d, o),
    };

    // Only a few guns engage at once: the beach should feel dangerous, not
    // instantly fatal when six bunkers all have line of sight.
    let firing = this.sentries.reduce(
      (n, s) => n + (s.kind !== 'at' && s.state === 'burst' ? 1 : 0),
      0
    );
    context.requestFire = () => {
      if (firing >= DIFFICULTY.maxFiringSentries) return false;
      firing++;
      return true;
    };

    let targeted = false;
    let engaging = 0;
    for (const s of this.sentries) {
      s.update(dt, car, context);
      if (s.targeting && s.hasLos) targeted = true;
      if (s.state === 'burst') engaging++;
    }
    this.targeted = targeted;
    this.engaging = engaging;

    const fx = this.fx;
    fx.tracers.begin();

    /* ---- bullets ---- */
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.prev.copy(b.pos);
      b.vel.y -= 2.2 * dt;
      b.pos.addScaledVector(b.vel, dt);
      b.life -= dt;

      let dead = false;
      // Car hit test (segment vs sphere).
      if (car.alive) {
        const hit = segmentSphere(b.prev, b.pos, car.pos, 1.45);
        if (hit) {
          car.damage(DIFFICULTY.sentryDamage, 'gunfire');
          fx.sparks(hit, null, 5, 0xffd08a);
          fx.addShake(0.16);
          if (ctx.audio) ctx.audio.hit();
          dead = true;
        }
      }
      // Ground / prop hit test.
      if (!dead) {
        const gh = this.terrain.heightAt(b.pos.x, b.pos.z);
        if (b.pos.y <= gh) {
          this._p.set(b.pos.x, gh + 0.1, b.pos.z);
          fx.bulletImpact(this._p, null, 0xcbb890);
          dead = true;
        } else if (this.colliders.blocksLine(b.prev.x, b.prev.y, b.prev.z, b.pos.x, b.pos.y, b.pos.z)) {
          fx.sparks(b.pos, null, 4, 0xffcc88);
          dead = true;
        }
      }
      if (b.life <= 0) dead = true;

      if (dead) {
        this.bullets.splice(i, 1);
        continue;
      }
      this._v.copy(b.vel).normalize();
      fx.tracers.push(b.pos, this._v, 4.5, 0.075, 0xffcc70);
    }

    /* ---- AT shells ---- */
    for (let i = this.shells.length - 1; i >= 0; i--) {
      const s = this.shells[i];
      s.prev.copy(s.pos);
      s.vel.y -= 9.81 * dt;
      s.pos.addScaledVector(s.vel, dt);
      s.life -= dt;

      let boom = null;
      if (car.alive) {
        const hit = segmentSphere(s.prev, s.pos, car.pos, 2.4);
        if (hit) boom = hit;
      }
      if (!boom) {
        const gh = this.terrain.heightAt(s.pos.x, s.pos.z);
        if (s.pos.y <= gh) boom = new THREE.Vector3(s.pos.x, gh + 0.2, s.pos.z);
        else if (this.colliders.blocksLine(s.prev.x, s.prev.y, s.prev.z, s.pos.x, s.pos.y, s.pos.z))
          boom = s.pos.clone();
      }
      if (s.life <= 0 && !boom) boom = s.pos.clone();

      if (boom) {
        this.shells.splice(i, 1);
        if (ctx.onShellImpact) ctx.onShellImpact(boom);
        continue;
      }
      this._v.copy(s.vel).normalize();
      fx.tracers.push(s.pos, this._v, 3.2, 0.2, 0xffb45a);
    }

    fx.tracers.end();
  }
}

/** Closest approach of a segment to a sphere; returns the hit point or null. */
function segmentSphere(a, b, center, radius) {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const acx = center.x - a.x;
  const acy = center.y + 0.7 - a.y;
  const acz = center.z - a.z;
  const ab2 = abx * abx + aby * aby + abz * abz;
  if (ab2 < 1e-8) return null;
  let t = (acx * abx + acy * aby + acz * abz) / ab2;
  t = clamp(t, 0, 1);
  const px = a.x + abx * t;
  const py = a.y + aby * t;
  const pz = a.z + abz * t;
  const dx = px - center.x;
  const dy = py - (center.y + 0.7);
  const dz = pz - center.z;
  if (dx * dx + dy * dy + dz * dz <= radius * radius) {
    return new THREE.Vector3(px, py, pz);
  }
  return null;
}
