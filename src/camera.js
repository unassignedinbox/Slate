import * as THREE from 'three';
import { CAR } from './config.js';
import { clamp, lerp, damp, dampAngle, angleDelta } from './util.js';

export const CAM_MODES = ['Chase camera', 'Bonnet camera', 'Wide camera'];

/**
 * Chase camera.
 *
 * The important part is that the rig carries its own heading. Pointing the
 * camera straight down the chassis axis means every kerb strike, countersteer
 * flick and collision yaw is transmitted to the view one-for-one, which reads
 * as harsh no matter how smooth the car is. Here the heading is damped, the
 * look-at point is damped separately, and both lean slightly toward the
 * direction of travel so a slide looks like a slide.
 */
export class ChaseCamera {
  constructor(camera, terrain, ocean) {
    this.camera = camera;
    this.terrain = terrain;
    this.ocean = ocean;
    this.mode = 0;
    this.yaw = 0;
    this.roll = 0;
    this.initialised = false;
    this._pos = new THREE.Vector3();
    this._target = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
  }

  setMode(mode) {
    this.mode = ((mode % 3) + 3) % 3;
    return this.mode;
  }

  /** Jump the rig to where it belongs, for spawns, restarts and recoveries. */
  snap(car) {
    const pos = car.object.position;
    this.yaw = car.yaw;
    const cx = Math.sin(this.yaw);
    const cz = Math.cos(this.yaw);
    this._look.set(pos.x + cx * 10, pos.y + 1.6, pos.z + cz * 10);
    this.camera.position.set(pos.x - cx * 9, pos.y + 3.6, pos.z - cz * 9);
    this.camera.lookAt(this._look);
    this.initialised = true;
  }

  update(dt, car, { state = 'running', shake = 0 } = {}) {
    const cam = this.camera;
    const pos = car.object.position;
    const speedT = clamp(Math.abs(car.speed) / CAR.maxSpeed, 0, 1);
    if (!this.initialised) this.snap(car);

    // Heading the rig wants: the chassis, leaning toward where it is actually
    // going. Reversing keeps the nose heading so the view does not flip.
    let travelYaw = car.yaw;
    const planarSpeed = Math.hypot(car.vel.x, car.vel.z);
    if (planarSpeed > 3 && car.speed > 0.5) travelYaw = Math.atan2(car.vel.x, car.vel.z);
    const lean = clamp(angleDelta(car.yaw, travelYaw), -0.7, 0.7) * 0.3;
    this.yaw = dampAngle(this.yaw, car.yaw + lean, this.mode === 2 ? 2.2 : 3.4, dt);

    if (this.mode === 1) {
      // Bonnet: rigid mount on the scuttle, ahead of the tinted screen.
      const p = car.object.localToWorld(this._tmp.set(0, 1.17, 1.52));
      cam.position.copy(p);
      const look = car.object.localToWorld(this._target.set(0, 0.7, 16));
      this._look.lerp(look, 1 - Math.exp(-14 * dt));
      cam.lookAt(this._look);
      cam.fov = damp(cam.fov, 68 + speedT * 6, 3, dt);
      cam.updateProjectionMatrix();
    } else {
      const wide = this.mode === 2;
      const dist = wide ? 17 : lerp(8.6, 12.2, speedT);
      const height = wide ? 8.4 : lerp(3.4, 4.4, speedT);
      const cx = Math.sin(this.yaw);
      const cz = Math.cos(this.yaw);

      this._pos.set(pos.x - cx * dist, pos.y + height, pos.z - cz * dist);
      const groundY = this.terrain.heightAt(this._pos.x, this._pos.z) + 1.9;
      const waterY = this.ocean.level + 1.1;
      this._pos.y = Math.max(this._pos.y, groundY, waterY);

      if (cam.position.distanceToSquared(this._pos) > 60 * 60) this.snap(car);

      const follow = state === 'running' ? (wide ? 3.4 : 6.2) : 2.4;
      cam.position.x = damp(cam.position.x, this._pos.x, follow, dt);
      cam.position.y = damp(cam.position.y, this._pos.y, follow * 0.75, dt);
      cam.position.z = damp(cam.position.z, this._pos.z, follow, dt);

      const ahead = wide ? 6 : lerp(7, 13, speedT);
      this._target.set(pos.x + cx * ahead, pos.y + 1.9, pos.z + cz * ahead);
      if (state === 'lost' || state === 'won') {
        this._target.set(pos.x, pos.y + 1.4, pos.z);
      }
      this._look.lerp(this._target, 1 - Math.exp(-7 * dt));
      cam.lookAt(this._look);

      // Roll into the corner, driven by real lateral acceleration.
      const latG = clamp((car.yawRate * car.speed) / 9.81, -1.4, 1.4);
      this.roll = damp(this.roll, -latG * 0.03, 4, dt);
      cam.rotateZ(this.roll);

      cam.fov = damp(cam.fov, 56 + speedT * 11, 2.5, dt);
      cam.updateProjectionMatrix();
    }

    if (shake > 0.001) {
      const s = shake * 0.4;
      cam.position.x += (Math.random() - 0.5) * s;
      cam.position.y += (Math.random() - 0.5) * s;
      cam.position.z += (Math.random() - 0.5) * s;
      cam.rotateZ((Math.random() - 0.5) * shake * 0.012);
    }
  }
}
