import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const CAMERA_MODES = ['Follow', 'Free Orbit', 'Cinematic'];

export class CameraRig {
  constructor(camera, domElement, controller, colliders) {
    this.camera = camera;
    this.controller = controller;
    this.colliders = colliders;
    this.mode = 0; // index into CAMERA_MODES
    this.raycaster = new THREE.Raycaster();

    this.orbit = new OrbitControls(camera, domElement);
    this.orbit.enableDamping = true;
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 0.15;
    this.orbit.maxDistance = 4;
    this.orbit.enabled = false;

    this._camPos = new THREE.Vector3();
    this._camUp = new THREE.Vector3(0, 1, 0);
    this._lookAt = new THREE.Vector3();
    this._followDist = 0.46;
    this._followHeight = 0.22;
    this._cineT = 0;

    camera.position.set(0.4, 0.5, 0.9);
  }

  cycle() {
    this.mode = (this.mode + 1) % CAMERA_MODES.length;
    this.orbit.enabled = CAMERA_MODES[this.mode] === 'Free Orbit';
    return CAMERA_MODES[this.mode];
  }

  update(dt) {
    const c = this.controller;
    const mode = CAMERA_MODES[this.mode];

    if (mode === 'Free Orbit') {
      this.orbit.target.lerp(c.position, 0.12);
      this.orbit.update();
      return;
    }

    if (mode === 'Cinematic') {
      this._cineT += dt * 0.12;
      const radius = 0.55;
      const desired = c.position.clone()
        .addScaledVector(c.up, 0.22)
        .add(new THREE.Vector3(Math.cos(this._cineT) * radius, 0, Math.sin(this._cineT) * radius));
      this._camPos.lerp(desired, 1 - Math.pow(0.0002, dt));
      this._lookAt.lerp(c.position.clone().addScaledVector(c.up, 0.05), 1 - Math.pow(0.001, dt));
      this._camUp.lerp(c.up, 1 - Math.pow(0.001, dt));
    } else {
      // Follow: a third-person rig that respects the spider's *current*
      // up axis, so the camera itself banks onto walls/ceiling with it —
      // exactly like modern wall-crawling character cameras.
      const behind = c.forward.clone().multiplyScalar(-this._followDist);
      const above = c.up.clone().multiplyScalar(this._followHeight);
      const desired = c.position.clone().add(behind).add(above);

      // pull the camera in if a wall is between it and the desired spot
      const toDesired = desired.clone().sub(c.position);
      const dist = toDesired.length();
      if (dist > 1e-5) {
        this.raycaster.set(c.position.clone().addScaledVector(c.up, 0.05), toDesired.clone().normalize());
        this.raycaster.far = dist;
        const hits = this.raycaster.intersectObjects(this.colliders, false);
        if (hits.length > 0) {
          desired.copy(hits[0].point).addScaledVector(toDesired.clone().normalize(), -0.06);
        }
      }

      this._camPos.lerp(desired, 1 - Math.pow(0.00002, dt));
      this._lookAt.lerp(c.position.clone().addScaledVector(c.forward, 0.12).addScaledVector(c.up, 0.03), 1 - Math.pow(0.0006, dt));
      this._camUp.lerp(c.up, 1 - Math.pow(0.0005, dt)).normalize();
    }

    this.camera.up.copy(this._camUp);
    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._lookAt);
  }
}
