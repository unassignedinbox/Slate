// Unreal-style fly camera: hold right mouse to look, WASD to move, Q/E down/up,
// Shift for boost, wheel to change base speed (or dolly when RMB is up).
import * as THREE from 'three';

export class FlyCamera {
  yaw = 0.6;
  pitch = -0.55;
  speed = 80; // metres per second
  readonly pos = new THREE.Vector3(0, 160, 260);
  readonly keys = new Set<string>();
  rmb = false;

  constructor(readonly cam: THREE.PerspectiveCamera) {
    this.apply();
  }

  forward(): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return new THREE.Vector3(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  right(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  look(dx: number, dy: number): void {
    this.yaw -= dx * 0.0035;
    this.pitch = Math.max(-1.52, Math.min(1.52, this.pitch - dy * 0.0035));
  }

  wheel(deltaY: number): void {
    if (this.rmb) {
      this.speed = Math.max(2, Math.min(3000, this.speed * (deltaY < 0 ? 1.15 : 1 / 1.15)));
    } else {
      this.pos.addScaledVector(this.forward(), -Math.sign(deltaY) * Math.min(400, this.speed * 0.6));
    }
  }

  update(dt: number): boolean {
    if (!this.rmb) return false;
    const k = this.keys;
    const dir = new THREE.Vector3();
    if (k.has('w')) dir.add(this.forward());
    if (k.has('s')) dir.sub(this.forward());
    if (k.has('d')) dir.add(this.right());
    if (k.has('a')) dir.sub(this.right());
    if (k.has('e')) dir.y += 1;
    if (k.has('q')) dir.y -= 1;
    if (dir.lengthSq() === 0) return false;
    const boost = k.has('shift') ? 3 : 1;
    dir.normalize().multiplyScalar(this.speed * boost * dt);
    this.pos.add(dir);
    this.apply();
    return true;
  }

  lookAt(target: THREE.Vector3, distance: number): void {
    const dir = this.pos.clone().sub(target);
    if (dir.lengthSq() < 1e-6) dir.set(0, 1, 1);
    dir.setLength(distance);
    this.pos.copy(target).add(dir);
    const f = target.clone().sub(this.pos).normalize();
    this.yaw = Math.atan2(-f.x, -f.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, f.y)));
    this.apply();
  }

  apply(): void {
    this.cam.position.copy(this.pos);
    this.cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }
}
