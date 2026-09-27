import * as THREE from 'three';
import { MAT } from '../props/materials.js';
import { box, cyl, mergeInPlace } from '../util/geo.js';
import { WEAPONS } from '../config.js';
import { angleDelta, clamp, damp } from '../util/mathx.js';

// ---------------------------------------------------------------------------
// Sentry machine-gun turrets.
//
// A real MG on a pintle: perforated cooling jacket, flash hider, receiver,
// belt feed out of an ammo can, armoured shield, spade grips. It traverses
// and elevates onto the car, checks line of sight against the actual terrain
// (so trenches, mounds and wrecks really are cover), leads its target, fires
// 7-round bursts and then has to cool down.
// ---------------------------------------------------------------------------

export function buildMG() {
  const root = new THREE.Group();

  // pintle / pedestal
  root.add(cyl(0.16, 0.22, 0.75, 8, MAT.steelDark, 0, 0.375, 0));
  root.add(cyl(0.34, 0.38, 0.1, 10, MAT.steelDark, 0, 0.05, 0));

  const yawPivot = new THREE.Group();
  yawPivot.position.y = 0.78;
  root.add(yawPivot);

  // armoured shield travels with the traverse
  const shield = box(1.5, 0.72, 0.07, MAT.steelDark, 0, 0.18, 0.42);
  yawPivot.add(shield);
  yawPivot.add(box(1.5, 0.16, 0.07, MAT.steelDark, 0, 0.56, 0.36, 0.35, 0, 0));
  yawPivot.add(box(0.26, 0.2, 0.08, MAT.black, 0, 0.3, 0.44)); // sight slot

  const pitchPivot = new THREE.Group();
  pitchPivot.position.set(0, 0.2, 0.1);
  yawPivot.add(pitchPivot);

  // receiver + jacket + barrel
  pitchPivot.add(box(0.2, 0.2, 0.78, MAT.gunmetal, 0, 0, -0.1));
  pitchPivot.add(box(0.16, 0.14, 0.3, MAT.gunmetal, 0, 0.12, -0.35));
  const jacket = cyl(0.085, 0.085, 0.86, 8, MAT.gunmetal, 0, 0.02, 0.72, Math.PI / 2, 0, 0);
  pitchPivot.add(jacket);
  for (let i = 0; i < 7; i++) {
    pitchPivot.add(cyl(0.092, 0.092, 0.035, 8, MAT.steelDark, 0, 0.02, 0.38 + i * 0.12, Math.PI / 2, 0, 0));
  }
  pitchPivot.add(cyl(0.04, 0.045, 0.5, 6, MAT.gunmetal, 0, 0.02, 1.36, Math.PI / 2, 0, 0));
  pitchPivot.add(cyl(0.07, 0.06, 0.16, 6, MAT.steelDark, 0, 0.02, 1.66, Math.PI / 2, 0, 0)); // flash hider
  pitchPivot.add(box(0.06, 0.12, 0.05, MAT.steelDark, 0, 0.12, 1.2)); // foresight
  // spade grips
  for (const s of [-1, 1]) {
    pitchPivot.add(box(0.05, 0.3, 0.05, MAT.woodDark, s * 0.18, -0.16, -0.5, 0.25, 0, 0));
  }
  // ammo can + belt
  const can = box(0.34, 0.26, 0.44, MAT.olive, 0.34, -0.12, -0.05);
  pitchPivot.add(can);
  for (let i = 0; i < 7; i++) {
    pitchPivot.add(box(0.05, 0.035, 0.07, MAT.rust, 0.3 - i * 0.035, -0.02 + i * 0.012, 0.05 + i * 0.008, 0, 0, 0.2 * i));
  }

  // muzzle flash (hidden until it fires)
  const flash = new THREE.Group();
  const flashMat = new THREE.MeshBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0.95, fog: false });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.62, 5), flashMat);
  cone.rotation.x = Math.PI / 2;
  cone.position.z = 0.3;
  flash.add(cone);
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), flashMat);
  flash.add(star);
  flash.position.set(0, 0.02, 1.78);
  flash.visible = false;
  pitchPivot.add(flash);

  // collapse the static parts: 3 draw calls per turret instead of ~40
  mergeInPlace(pitchPivot);
  mergeInPlace(yawPivot);
  mergeInPlace(root);
  root.userData = { yawPivot, pitchPivot, flash, muzzle: new THREE.Vector3(0, 0.02, 1.8) };
  return root;
}

const _world = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _aim = new THREE.Vector3();

export class Sentry {
  /**
   * @param {THREE.Vector3} position world position of the pintle
   * @param {number} facing yaw the position is built to cover
   */
  constructor(position, facing, field, opts = {}) {
    this.model = buildMG();
    this.model.position.copy(position);
    this.model.rotation.y = facing;
    this.field = field;
    this.home = facing;
    this.pos = position.clone();
    this.arc = opts.arc ?? 1.25;             // traverse limit either side
    this.range = opts.range ?? WEAPONS.mgRange;
    this.skill = opts.skill ?? 1;
    this.yaw = 0;
    this.pitch = 0;
    this.state = 'idle';
    this.timer = Math.random() * 2;
    this.rounds = 0;
    this.flashTimer = 0;
    this.scanPhase = Math.random() * 6.28;
    this.alerted = 0;
    this.muzzleWorld = new THREE.Vector3();
    this._losTimer = Math.random() * 0.14;
    this._los = false;
  }

  /** Terrain line of sight from the muzzle to a point. */
  hasLOS(target) {
    this.model.updateMatrixWorld();
    this.model.userData.pitchPivot.localToWorld(_muzzle.copy(this.model.userData.muzzle));
    const steps = 14;
    for (let i = 2; i <= steps; i++) {
      const t = i / steps;
      const x = _muzzle.x + (target.x - _muzzle.x) * t;
      const y = _muzzle.y + (target.y + 0.9 - _muzzle.y) * t;
      const z = _muzzle.z + (target.z - _muzzle.z) * t;
      if (this.field.height(x, z) > y + 0.35) return false;
    }
    return true;
  }

  update(dt, car, bullets, audio, camera) {
    const ud = this.model.userData;
    this.flashTimer -= dt;
    ud.flash.visible = this.flashTimer > 0;

    const dx = car.pos.x - this.pos.x;
    const dz = car.pos.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // cull distant sentries entirely
    if (dist > this.range + 140) {
      this.model.visible = false;
      return;
    }
    this.model.visible = true;

    const worldYaw = Math.atan2(dx, dz);
    const local = angleDelta(this.home, worldYaw);
    const inArc = Math.abs(local) < this.arc;
    // line of sight is the expensive part - re-check it at ~8 Hz, staggered
    this._losTimer -= dt;
    if (this._losTimer <= 0) {
      this._losTimer = 0.12 + Math.random() * 0.06;
      this._los = dist < this.range * 1.05 && inArc ? this.hasLOS(car.pos) : false;
    }
    const canSee = car.alive && dist < this.range && inArc && this._los;

    if (canSee) this.alerted = Math.min(1.5, this.alerted + dt * 2);
    else this.alerted = Math.max(0, this.alerted - dt * 0.6);

    let targetYaw;
    let targetPitch;
    if (canSee || this.alerted > 0.4) {
      // lead the target: time of flight x its velocity
      const tof = dist / WEAPONS.bulletSpeed;
      const lead = 0.55 + 0.45 * this.skill;
      _aim.set(
        car.pos.x + Math.sin(car.yaw) * car.speed * tof * lead,
        car.pos.y + 0.75,
        car.pos.z + Math.cos(car.yaw) * car.speed * tof * lead,
      );
      const ax = _aim.x - this.pos.x;
      const az = _aim.z - this.pos.z;
      const ay = _aim.y - (this.pos.y + 1.0);
      const adist = Math.hypot(ax, az);
      targetYaw = angleDelta(this.home, Math.atan2(ax, az));
      // compensate drop
      const drop = (9.0 * (adist / WEAPONS.bulletSpeed) ** 2) / 2;
      targetPitch = Math.atan2(ay + drop, adist);
    } else {
      this.scanPhase += dt * 0.35;
      targetYaw = Math.sin(this.scanPhase) * this.arc * 0.7;
      targetPitch = -0.02;
    }

    const traverseSpeed = canSee ? 3.2 : 1.1;
    this.yaw = damp(this.yaw, clamp(targetYaw, -this.arc, this.arc), traverseSpeed, dt);
    this.pitch = damp(this.pitch, clamp(targetPitch, -0.5, 0.42), 4.5, dt);
    ud.yawPivot.rotation.y = this.yaw;
    ud.pitchPivot.rotation.x = -this.pitch;

    // --- firing ---------------------------------------------------------------
    this.timer -= dt;
    const onTarget = canSee && Math.abs(angleDelta(this.yaw, targetYaw)) < 0.09;
    if (this.state === 'idle') {
      if (onTarget && this.timer <= 0) {
        this.state = 'burst';
        this.rounds = WEAPONS.mgBurst + Math.floor(Math.random() * 4);
        this.timer = 0;
      }
    } else if (this.state === 'burst') {
      if (!canSee) {
        this.state = 'idle';
        this.timer = 0.8;
      } else if (this.timer <= 0) {
        this.fire(bullets, dist, audio, camera);
        this.rounds--;
        this.timer = WEAPONS.mgBurstGap;
        if (this.rounds <= 0) {
          this.state = 'idle';
          this.timer = WEAPONS.mgReload * (0.7 + Math.random() * 0.6);
        }
      }
    }
  }

  fire(bullets, dist, audio, camera) {
    const ud = this.model.userData;
    this.model.updateMatrixWorld();
    ud.pitchPivot.localToWorld(_muzzle.copy(ud.muzzle));
    ud.pitchPivot.localToWorld(_world.set(0, 0.02, 3));
    _dir.subVectors(_world, _muzzle).normalize();

    const spread = WEAPONS.mgSpread * (1.4 - 0.5 * this.skill) * (1 + dist / 500);
    _dir.x += (Math.random() - 0.5) * spread * 2;
    _dir.y += (Math.random() - 0.5) * spread * 1.4;
    _dir.z += (Math.random() - 0.5) * spread * 2;

    this._shot = (this._shot || 0) + 1;
    bullets.spawn(_muzzle, _dir, WEAPONS.bulletSpeed * (0.97 + Math.random() * 0.06), this._shot % 3 === 0);
    this.flashTimer = 0.035;
    this.muzzleWorld.copy(_muzzle);
    if (audio && camera) audio.mgShot(_muzzle, camera.position);
  }
}
