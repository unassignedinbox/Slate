// player.js — first-person controller: run, jump, wade, drown, enter/exit vehicle
import * as THREE from './vendor/three.module.min.js';
import { clamp, clamp01, lerp } from './utils.js';
import { S, CFG } from './state.js';
import { H } from './world.js';

const _v = new THREE.Vector3();

export class Player {
  constructor() {
    this.pos = new THREE.Vector3(CFG.spawn.x, 0, CFG.spawn.z);
    this.pos.y = H(this.pos.x, this.pos.z);
    this.yaw = 0;
    this.pitch = 0;
    this.vy = 0;
    this.vel = new THREE.Vector3();
    this.knock = new THREE.Vector3();
    this.health = 100;
    this.alive = true;
    this.inCar = false;
    this.eyeH = 1.62;
    this.bobT = 0;
    this.lastDamage = -99;
    this.deathCause = '';
    this.hurtT = 0;
    this.wasInWater = false;
    this.grounded = true;
  }

  forward(out) { return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw)); }

  update(dt, input) {
    if (!this.alive) return;
    const car = S.car;

    if (this.inCar && car) {
      this.pos.copy(car.pos);
      this.pos.y = car.pos.y + 0.5;
      // drown inside a flooded vehicle
      if (car.alive && S.waterLevel > car.pos.y + 1.35) {
        this.damage(13 * dt, 'drowned with the vehicle');
        if (!this.floodWarned) {
          this.floodWarned = true;
          S.banners.push({ text: 'VEHICLE FLOODING — GET OUT', ttl: 3, color: '#4fc3f7' });
        }
      } else this.floodWarned = false;
      return;
    }

    // ---- movement ----
    const depth = S.waterLevel - H(this.pos.x, this.pos.z);
    let speed = input.sprint ? 8.4 : 5.5;
    if (depth > 0.12) speed *= depth > 0.95 ? 0.36 : 0.62;
    if (S.wireSlow > 0) speed *= 0.42;

    const f = input.fwd || 0, s = input.side || 0;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const lx = -fz, lz = fx;
    let mx = fx * f + lx * s, mz = fz * f + lz * s;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }

    const k = clamp01(dt * 9);
    this.vel.x = lerp(this.vel.x, mx * speed, k);
    this.vel.z = lerp(this.vel.z, mz * speed, k);

    this.pos.x += (this.vel.x + this.knock.x) * dt;
    this.pos.z += (this.vel.z + this.knock.z) * dt;
    this.knock.multiplyScalar(1 - clamp01(dt * 4));

    // ---- gravity / jump ----
    const ground = H(this.pos.x, this.pos.z);
    if (input.jump && this.grounded && depth < 0.4) {
      this.vy = 5.7;
      this.grounded = false;
    }
    this.vy -= 16 * dt;
    this.pos.y += this.vy * dt;
    if (this.pos.y <= ground) {
      this.pos.y = ground;
      this.vy = 0;
      this.grounded = true;
    }

    // ---- obstacles ----
    for (const o of S.obstacles) {
      const dx = this.pos.x - o.x, dz = this.pos.z - o.z;
      const rr = o.r + 0.45;
      const d2 = dx * dx + dz * dz;
      if (d2 < rr * rr && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        this.pos.x = o.x + (dx / d) * rr;
        this.pos.z = o.z + (dz / d) * rr;
      }
    }
    this.pos.x = clamp(this.pos.x, CFG.minX + 1.5, CFG.maxX - 1.5);
    this.pos.z = clamp(this.pos.z, CFG.minZ + 10, 165.7);

    // ---- drowning ----
    if (depth > 1.25) {
      this.damage(13 * dt, 'drowned in the rising tide');
      if (!this.drownWarned) {
        this.drownWarned = true;
        S.banners.push({ text: 'THE TIDE IS OVER YOUR HEAD — MOVE!', ttl: 3.5, color: '#4fc3f7' });
      }
    } else this.drownWarned = false;

    // splashes
    const inWater = depth > 0.2;
    if (inWater !== this.wasInWater) {
      S.audio.splash(this.pos, depth);
      this.wasInWater = inWater;
    }

    // ---- regen ----
    if (S.t - this.lastDamage > 6 && this.health < 100) {
      this.health = Math.min(100, this.health + 7 * dt);
    }

    // head bob
    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.bobT += dt * (4 + spd * 1.1);
  }

  eyeY() {
    return this.pos.y + this.eyeH + Math.sin(this.bobT) * 0.028 * clamp01(Math.hypot(this.vel.x, this.vel.z) / 5);
  }

  applyCamera(camera, dt) {
    if (this.inCar && S.car) {
      const car = S.car;
      const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
      _v.set(car.pos.x - fx * 8.4, car.pos.y + 3.9, car.pos.z - fz * 8.4);
      const minY = H(_v.x, _v.z) + 0.8;
      if (_v.y < minY) _v.y = minY;
      camera.position.lerp(_v, clamp01(dt * 6));
      camera.lookAt(car.pos.x + fx * 3, car.pos.y + 1.5, car.pos.z + fz * 3);
      return;
    }
    camera.position.set(this.pos.x, this.eyeY(), this.pos.z);
    camera.rotation.set(this.pitch, this.yaw + Math.PI, 0, 'YXZ');
  }

  damage(n, cause) {
    if (!this.alive || S.mode !== 'play') return;
    this.health -= n;
    this.lastDamage = S.t;
    if (n > 3) S.audio.hurt();
    if (this.health <= 0) {
      this.health = 0;
      this.die(cause);
    }
  }

  die(cause) {
    if (!this.alive) return;
    this.alive = false;
    this.deathCause = cause || 'killed in action';
    S.stats.deaths++;
    S.mode = 'dead';
    S.audio.death();
    if (this.inCar) this.inCar = false;
  }

  respawn() {
    const car = S.car;
    if (car && car.alive) {
      // come back beside the vehicle — this run is vehicle-first
      const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
      this.pos.set(car.pos.x - fz * 2.3, 0, car.pos.z + fx * 2.3);
      this.pos.y = H(this.pos.x, this.pos.z);
    } else {
      const x = clamp(this.pos.x, -24, 24) + (Math.random() - 0.5) * 8;
      let z = S.waterlineZ + 16;
      for (let i = 0; i < 12; i++) {
        if (H(x, z) > S.waterLevel + 0.7) break;
        z += 4;
      }
      this.pos.set(x, H(x, z), z);
    }
    this.vel.set(0, 0, 0);
    this.vy = 0;
    this.health = 100;
    this.alive = true;
    this.knock.set(0, 0, 0);
  }

  tryEnterExit() {
    const car = S.car;
    if (!car) return;
    if (this.inCar) {
      // step out beside the car
      const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw);
      const lx = -fz, lz = fx;
      this.pos.set(car.pos.x + lx * 2.1, 0, car.pos.z + lz * 2.1);
      this.pos.y = H(this.pos.x, this.pos.z);
      this.inCar = false;
      S.audio.door();
      return;
    }
    if (!car.alive) return;
    const d = Math.hypot(this.pos.x - car.pos.x, this.pos.z - car.pos.z);
    if (d < 3.6) {
      this.inCar = true;
      S.audio.door();
    }
  }
}
