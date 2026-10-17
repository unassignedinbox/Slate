// Cameras: chase (default), free fly (inspect the blockout), overview (orbit the section).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { F } from '../core/world.js';

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const camFilter = (c) => c.solid && !(c.body.flags & (F.PROP | F.SCENERY | F.BREAKABLE));

export class CameraRig {
  constructor(camera, dom, world) {
    this.camera = camera;
    this.dom = dom;
    this.world = world;
    this.mode = 'chase';
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.dir = new THREE.Vector3(0, 0, 1);
    this.fov = 64;
    this.shake = 0;
    this.orbit = new OrbitControls(camera, dom);
    this.orbit.enabled = false;
    this.orbit.enableDamping = true;
    this.orbit.maxDistance = 2600;
    this.free = { yaw: 0, pitch: -0.2, drag: false };
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('mousedown', (e) => { if (this.mode === 'free' && (e.button === 2 || e.button === 0)) { this.free.drag = true; this.free.lx = e.clientX; this.free.ly = e.clientY; } });
    window.addEventListener('mouseup', () => { this.free.drag = false; });
    window.addEventListener('mousemove', (e) => {
      if (this.mode !== 'free' || !this.free.drag) return;
      this.free.yaw -= (e.clientX - this.free.lx) * 0.004;
      this.free.pitch = THREE.MathUtils.clamp(this.free.pitch - (e.clientY - this.free.ly) * 0.004, -1.5, 1.5);
      this.free.lx = e.clientX; this.free.ly = e.clientY;
    });
    this._hit = { t: 0, point: new THREE.Vector3(), normal: new THREE.Vector3(), collider: null };
  }

  setMode(mode, centre = null, span = 600) {
    this.mode = mode;
    this.orbit.enabled = mode === 'overview';
    if (mode === 'overview' && centre) {
      this.orbit.target.copy(centre);
      this.camera.position.copy(centre).add(new THREE.Vector3(span * 0.55, span * 0.75, span * 0.75));
      this.camera.fov = 50;
      this.camera.updateProjectionMatrix();
    }
    if (mode === 'free') {
      const d = new THREE.Vector3();
      this.camera.getWorldDirection(d);
      this.free.yaw = Math.atan2(-d.x, -d.z);
      this.free.pitch = Math.asin(THREE.MathUtils.clamp(d.y, -1, 1));
    }
  }

  snap(carPos, carQuat) {
    _a.set(0, 0, 1).applyQuaternion(carQuat); _a.y = 0; _a.normalize();
    this.dir.copy(_a);
    this.pos.copy(carPos).addScaledVector(_a, -9).addScaledVector(UP, 3.2);
    this.look.copy(carPos).addScaledVector(_a, 6).addScaledVector(UP, 1.2);
  }

  /** Carry the camera through a portal with the car. */
  teleport(xf) {
    for (const v of [this.pos, this.look]) v.sub(xf.fromPos).applyQuaternion(xf.dq).add(xf.toPos);
    this.dir.applyQuaternion(xf.dq);
    this.camera.position.sub(xf.fromPos).applyQuaternion(xf.dq).add(xf.toPos);
  }

  update(dt, car, carPos, carQuat, keys) {
    const cam = this.camera;
    if (this.mode === 'overview') { this.orbit.update(); return; }
    if (this.mode === 'free') {
      const sp = (keys.has('ShiftLeft') || keys.has('ShiftRight') ? 160 : 40) * dt;
      const f = new THREE.Vector3(-Math.sin(this.free.yaw) * Math.cos(this.free.pitch), Math.sin(this.free.pitch), -Math.cos(this.free.yaw) * Math.cos(this.free.pitch));
      const r = new THREE.Vector3().crossVectors(f, UP).normalize();
      if (keys.has('KeyW') || keys.has('ArrowUp')) cam.position.addScaledVector(f, sp);
      if (keys.has('KeyS') || keys.has('ArrowDown')) cam.position.addScaledVector(f, -sp);
      if (keys.has('KeyD') || keys.has('ArrowRight')) cam.position.addScaledVector(r, sp);
      if (keys.has('KeyA') || keys.has('ArrowLeft')) cam.position.addScaledVector(r, -sp);
      if (keys.has('KeyE')) cam.position.y += sp;
      if (keys.has('KeyQ')) cam.position.y -= sp;
      cam.lookAt(_a.copy(cam.position).add(f));
      return;
    }
    // ---- chase ----
    const speed = car.vel.length();
    _a.set(0, 0, 1).applyQuaternion(carQuat); _a.y = 0;
    if (_a.lengthSq() < 1e-4) _a.copy(this.dir); _a.normalize();
    _b.copy(car.vel); _b.y = 0;
    if (speed > 8 && _b.lengthSq() > 1) { _b.normalize(); _a.lerp(_b, 0.35).normalize(); }
    this.dir.lerp(_a, 1 - Math.exp(-dt * 4.5)).normalize();
    const dist = 8.6 + Math.min(4, speed * 0.05);
    const height = 2.9 + Math.min(1.2, speed * 0.012);
    const desired = _c.copy(carPos).addScaledVector(this.dir, -dist).addScaledVector(UP, height);
    // keep the camera out of walls and decks
    const from = _b.copy(carPos).addScaledVector(UP, 1.6);
    const toCam = desired.clone().sub(from);
    const len = toCam.length();
    toCam.multiplyScalar(1 / len);
    const hit = this.world.raycast(from, toCam, len, camFilter, this._hit);
    if (hit && hit.t > 1.5) desired.copy(from).addScaledVector(toCam, hit.t - 0.5);
    const kx = 1 - Math.exp(-dt * 9), ky = 1 - Math.exp(-dt * 6);
    this.pos.x += (desired.x - this.pos.x) * kx;
    this.pos.z += (desired.z - this.pos.z) * kx;
    this.pos.y += (desired.y - this.pos.y) * ky;
    const lookT = _a.copy(carPos).addScaledVector(this.dir, 5.5).addScaledVector(UP, 1.15);
    this.look.lerp(lookT, 1 - Math.exp(-dt * 12));
    this.shake = Math.max(0, this.shake - dt * 3);
    cam.position.copy(this.pos);
    if (this.shake > 0) cam.position.add(new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake));
    cam.lookAt(this.look);
    const fov = 63 + Math.min(14, speed * 0.24);
    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 3));
    if (Math.abs(cam.fov - this.fov) > 0.05) { cam.fov = this.fov; cam.updateProjectionMatrix(); }
  }
}
