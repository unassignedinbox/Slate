// Unreal-style viewport camera: hold RMB to look, WASD to fly,
// Q/E for down/up, Shift to boost, Ctrl to creep, scroll-wheel speed.
import * as THREE from 'three';
import { clamp, lerp } from './util.js';

export class UnrealCamera {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.yaw = -Math.PI / 2 - 0.55;
    this.pitch = -0.42;
    this.speed = 26; // m/s baseline
    this.minSpeed = 1.5;
    this.maxSpeed = 260;
    this.boost = 3.2;
    this.creep = 0.28;
    this.looking = false;
    this.orbiting = false;
    this.keys = new Set();
    this.enabled = true;
    this._lastX = 0;
    this._lastY = 0;
    this._orbitPivot = new THREE.Vector3(0, 0, 0);
    this._orbitRadius = 30;
    this.onSpeedChange = null;

    // Sensible starting frame over the origin.
    this.camera.position.set(120, 95, 150);
    this.applyRotation();

    dom.addEventListener('contextmenu', (e) => e.preventDefault());

    dom.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.button === 2) {
        this.looking = true;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        dom.setPointerCapture(e.pointerId);
      } else if (e.button === 0 && e.altKey) {
        this.orbiting = true;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        this._orbitPivot.copy(this.getPivot());
        this._orbitRadius = clamp(this.camera.position.distanceTo(this._orbitPivot), 4, 800);
        dom.setPointerCapture(e.pointerId);
      }
    });

    dom.addEventListener('pointermove', (e) => {
      if (this.looking) {
        const dx = e.clientX - this._lastX;
        const dy = e.clientY - this._lastY;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        this.yaw += dx * 0.0032;
        this.pitch = clamp(this.pitch - dy * 0.0032, -1.53, 1.53);
        this.applyRotation();
      } else if (this.orbiting) {
        const dx = e.clientX - this._lastX;
        const dy = e.clientY - this._lastY;
        this._lastX = e.clientX;
        this._lastY = e.clientY;
        this.yaw += dx * 0.0042;
        this.pitch = clamp(this.pitch - dy * 0.0042, -1.53, 1.53);
        this.applyRotation();
        const back = new THREE.Vector3(0, 0, 1).applyQuaternion(this.camera.quaternion);
        this.camera.position.copy(this._orbitPivot).addScaledVector(back, this._orbitRadius);
      }
    });

    const endLook = (e) => {
      if (this.looking || this.orbiting) {
        try { dom.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      }
      this.looking = false;
      this.orbiting = false;
    };
    dom.addEventListener('pointerup', endLook);
    dom.addEventListener('pointercancel', endLook);

    dom.addEventListener('wheel', (e) => {
      if (!this.enabled) return;
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 / 1.35 : 1.35;
      this.speed = clamp(this.speed * dir, this.minSpeed, this.maxSpeed);
      this.onSpeedChange?.(this.speed);
    }, { passive: false });

    window.addEventListener('keydown', (e) => {
      if (this.isTyping(e)) return;
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  isTyping(e) {
    const t = e.target;
    return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  }

  applyRotation() {
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotateY(this.yaw);
    this.camera.rotateX(this.pitch);
  }

  /** A point ~35 m ahead of the camera, used for orbit + focus. */
  getPivot(dist = 35) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    return this.camera.position.clone().addScaledVector(dir, dist);
  }

  focus(target, radius = 24) {
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const back = dir.clone().negate();
    back.y = Math.max(back.y, 0.35);
    back.normalize();
    const dist = clamp(radius * 1.7, 12, 240);
    this.camera.position.copy(target).addScaledVector(back, dist);
    // Aim at target.
    const look = target.clone().sub(this.camera.position).normalize();
    this.pitch = Math.asin(clamp(look.y, -1, 1));
    this.yaw = Math.atan2(-look.x, -look.z);
    this.applyRotation();
    this._orbitPivot.copy(target);
    this._orbitRadius = dist;
  }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys;
    const typing = this.looking || this.orbiting || true; // movement allowed while not typing
    if (!typing) return;

    let mult = 1;
    if (k.has('ShiftLeft') || k.has('ShiftRight')) mult *= this.boost;
    if (k.has('ControlLeft') || k.has('ControlRight')) mult *= this.creep;

    const move = new THREE.Vector3();
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0);

    if (k.has('KeyW') || k.has('ArrowUp')) move.add(forward);
    if (k.has('KeyS') || k.has('ArrowDown')) move.sub(forward);
    if (k.has('KeyD') || k.has('ArrowRight')) move.add(right);
    if (k.has('KeyA') || k.has('ArrowLeft')) move.sub(right);
    if (k.has('KeyE') || k.has('Space')) move.add(up);
    if (k.has('KeyQ') || k.has('KeyC')) move.sub(up);

    if (move.lengthSq() > 0) {
      move.normalize();
      const dist = this.speed * mult * dt;
      this.camera.position.addScaledVector(move, dist);
      // Keep the camera out of the void below the terrain.
      if (this.camera.position.y < -22) this.camera.position.y = -22;
    }
  }

  get speedLabel() {
    return `${this.speed.toFixed(0)} m/s`;
  }
}
