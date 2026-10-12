/* ============================================================================
   CameraController — Unreal-editor style perspective viewport navigation.

     RMB held          look around (mouse-look)
     RMB held + W A S D   fly
     Q / E             descend / ascend
     MMB drag          pan (track)
     Alt + LMB drag    orbit about the pivot
     Alt + MMB drag    pan
     Alt + RMB drag    dolly
     Wheel             dolly forward / back
     Shift             boost (x4)      Ctrl  precision (x0.2)
     [ / ]             camera speed down / up
     F                 frame the selection
     Home              frame the whole world

   Camera speed scales with altitude, like Unreal: you cross a city fast when
   you're high up and can still thread a junction at street level.
   ========================================================================== */

import * as THREE from 'three';
import { clamp, lerp } from './mathx.js';

export class CameraController {
  constructor(camera, domElement, { getGroundY } = {}) {
    this.camera = camera;
    this.dom = domElement;
    this.getGroundY = getGroundY || (() => 0);

    this.position = new THREE.Vector3(0, 60, 140);
    this.velocity = new THREE.Vector3();
    this.yaw = Math.PI;
    this.pitch = -0.42;
    this.baseSpeed = 30;          // m/s at ground level
    this.speedScale = 1;
    this.boost = 1;
    this.groundClamp = true;
    this.minGroundClear = 2.0;
    this.smoothing = 12;

    this.keys = new Set();
    this.look = false;
    this.pan = false;
    this.orbit = false;
    this.dolly = false;
    this.lastX = 0; this.lastY = 0;
    this.enabled = true;

    this._euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this._tmp = new THREE.Vector3();
    this._pivot = new THREE.Vector3();
    this._fov = camera.fov;
    this._targetFov = camera.fov;

    this._bind();
  }

  _bind() {
    const d = this.dom;
    this._onKeyDown = (e) => {
      if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
      this.keys.add(e.code);
      if (e.code === 'BracketRight') { this.setSpeed(this.speedScale * 1.35); e.preventDefault(); }
      if (e.code === 'BracketLeft') { this.setSpeed(this.speedScale / 1.35); e.preventDefault(); }
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this._onBlur = () => { this.keys.clear(); this.look = this.pan = this.orbit = this.dolly = false; };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);

    d.addEventListener('contextmenu', (e) => e.preventDefault());
    d.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      d.setPointerCapture?.(e.pointerId);
      this.lastX = e.clientX; this.lastY = e.clientY;
      const alt = e.altKey;
      if (alt) {
        if (e.button === 0) this.orbit = true;
        else if (e.button === 1) this.pan = true;
        else this.dolly = true;
        e.preventDefault();
      } else {
        if (e.button === 2) this.look = true;
        else if (e.button === 1) this.pan = true;
        this.onPointerDown?.(e);
      }
    });
    d.addEventListener('pointermove', (e) => {
      if (!this.enabled) return;
      const dx = e.clientX - this.lastX, dy = e.clientY - this.lastY;
      this.lastX = e.clientX; this.lastY = e.clientY;
      this.onPointerMove?.(e, dx, dy);
      if (this.look) {
        this.yaw -= dx * 0.0032;
        this.pitch -= dy * 0.0032;
        this.pitch = clamp(this.pitch, -1.553, 1.553);
      } else if (this.orbit) {
        this.yaw -= dx * 0.005;
        this.pitch -= dy * 0.005;
        this.pitch = clamp(this.pitch, -1.553, 1.553);
        // keep the pivot distance, swing around it
        const r = this._tmp.copy(this.position).sub(this._pivot);
        const spherical = new THREE.Spherical().setFromVector3(r);
        spherical.theta -= dx * 0.005;
        spherical.phi = clamp(spherical.phi - dy * 0.005, 0.02, Math.PI - 0.02);
        this.position.copy(this._pivot).add(new THREE.Vector3().setFromSpherical(spherical));
        this.yaw = Math.atan2(-r.x, -r.z);
        this.pitch = Math.asin(clamp(-r.y / (r.length() || 1), -1, 1));
      } else if (this.pan) {
        const panScale = this.currentSpeed() * 0.02;
        this._applyPan(dx * panScale, dy * panScale);
      } else if (this.dolly) {
        this._dolly(dy * this.currentSpeed() * 0.02);
      }
    });
    const up = (e) => {
      d.releasePointerCapture?.(e.pointerId);
      if (e.button === 2) this.look = false;
      if (e.button === 1) { this.pan = false; this.dolly = false; }
      if (e.button === 0) this.orbit = false;
      this.onPointerUp?.(e);
    };
    d.addEventListener('pointerup', up);
    d.addEventListener('pointercancel', up);
    d.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      if (e.shiftKey) { this.setSpeed(this.speedScale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); return; }
      this._dolly(-e.deltaY * 0.02 * Math.max(3, this.currentSpeed() * 0.35));
    }, { passive: false });
  }

  setSpeed(s) { this.speedScale = clamp(s, 0.05, 60); }

  /** Effective metres/second, scaled by altitude above the ground. */
  currentSpeed() {
    const agl = Math.max(1, this.position.y - this.getGroundY(this.position.x, this.position.z));
    const alt = clamp(agl / 30, 1, 40);
    return this.baseSpeed * this.speedScale * this.boost * alt;
  }

  _dolly(delta) {
    const fwd = new THREE.Vector3(0, 0, -1).applyEuler(this._quat());
    this.position.addScaledVector(fwd, -delta);
  }

  _applyPan(dx, dy) {
    const q = this._quat();
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
    this.position.addScaledVector(right, -dx);
    this.position.addScaledVector(up, dy);
  }

  _quat() {
    this._euler.set(this.pitch, this.yaw, 0);
    return new THREE.Quaternion().setFromEuler(this._euler);
  }

  /** Direction the camera is facing. */
  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this._quat());
  }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;
    const boost = (k.has('ShiftLeft') || k.has('ShiftRight')) ? 4 : (k.has('ControlLeft') || k.has('ControlRight')) ? 0.2 : 1;
    this.boost = lerp(this.boost, boost, 1 - Math.exp(-dt * 14));

    const q = this._quat();
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const worldUp = new THREE.Vector3(0, 1, 0);

    const wish = new THREE.Vector3();
    if (k.has('KeyW') || k.has('ArrowUp')) wish.add(fwd);
    if (k.has('KeyS') || k.has('ArrowDown')) wish.sub(fwd);
    if (k.has('KeyD') || k.has('ArrowRight')) wish.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) wish.sub(right);
    if (k.has('KeyE')) wish.add(worldUp);
    if (k.has('KeyQ')) wish.sub(worldUp);
    if (wish.lengthSq() > 0) wish.normalize().multiplyScalar(this.currentSpeed());

    // critically-damped-ish approach so movement has weight
    const a = 1 - Math.exp(-dt * this.smoothing);
    this.velocity.lerp(wish, a);
    if (this.velocity.lengthSq() < 1e-6) this.velocity.set(0, 0, 0);
    this.position.addScaledVector(this.velocity, dt);

    // keep a minimum clearance above the terrain
    if (this.groundClamp) {
      const gy = this.getGroundY(this.position.x, this.position.z);
      const minY = gy + this.minGroundClear;
      if (this.position.y < minY) {
        this.position.y = minY;
        if (this.velocity.y < 0) this.velocity.y = 0;
      }
    }

    this.camera.position.copy(this.position);
    this.camera.quaternion.copy(q);
    if (Math.abs(this.camera.fov - this._targetFov) > 0.01) {
      this.camera.fov = lerp(this.camera.fov, this._targetFov, 1 - Math.exp(-dt * 10));
      this.camera.updateProjectionMatrix();
    }
  }

  /** Frame a bounding box (Unreal's "F" key). */
  frame(box, { instant = false } = {}) {
    if (!box || box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(4, box.getSize(new THREE.Vector3()).length() * 0.5);
    const dist = (r / Math.sin((this.camera.fov * Math.PI) / 360)) * 1.15;
    const fwd = this.forward(new THREE.Vector3());
    const target = c.clone().addScaledVector(fwd, -dist);
    this._frameTarget = target;
    this._pivot.copy(c);
    if (instant) this.position.copy(target);
  }

  get frameTarget() { return this._frameTarget; }
  clearFrameTarget() { this._frameTarget = null; }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
  }
}
