// The concrete 3D viewports used by the apps.
import * as THREE from 'three';
import { Viewport3D } from './viewport.js';
import { buildCar, buildTyre, CORNERS } from './car.js';
import { state } from '../core/store.js';
import { liveryColor } from '../core/economy.js';

// Push the current vehicle state into a car model.
function syncCar(car) {
  const v = state.vehicle;
  car.update(v.suspension.travelMm);
  car.setWings(v.aero.frontWingDeg, v.aero.rearWingDeg);
  const temps = Object.fromEntries(CORNERS.map((c) => [c, v.tyres[c].tempC]));
  car.setTyreTemps(temps);
  car.setLivery(liveryColor(state.settings.liveryId));
  car.setAccent(state.settings.accent);
}

// Full car, orbit camera, live tyre heat, wings and livery.
export class CarViewport extends Viewport3D {
  constructor(container, opts = {}) {
    super(container, { distance: 7.2, phi: 1.22, autoRotate: 0.18, target: new THREE.Vector3(0, 0.45, 0), ...opts });
    this.car = buildCar({ accent: state.settings.accent });
    this.scene.add(this.car.root);
    if (opts.bodyOpacity != null) this.car.setBodyOpacity(opts.bodyOpacity);
  }
  update() {
    syncCar(this.car);
    this.stage?.ring.material.color.set(state.settings.accent);
  }
}

// Car with a semi-transparent body so springs, dampers and arms are visible.
export class SuspensionViewport extends CarViewport {
  constructor(container) {
    super(container, { distance: 5.6, phi: 1.28, autoRotate: 0.1, bodyOpacity: 0.22 });
  }
}

// Car with airflow particles that bend around the bodywork and speed up with road speed.
export class AeroViewport extends CarViewport {
  constructor(container) {
    super(container, { distance: 7.4, phi: 1.25, autoRotate: 0.12 });
    const N = 500;
    this.pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) this._respawn(i, true);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.flow = new THREE.Points(geo, new THREE.PointsMaterial({
      color: 0x9fe8ff, size: 0.045, transparent: true, opacity: 0.6, depthWrite: false,
    }));
    this.scene.add(this.flow);
  }
  _respawn(i, anywhere = false) {
    const p = this.pos;
    p[i * 3] = (Math.random() - 0.5) * 3.4;
    p[i * 3 + 1] = 0.1 + Math.random() * 1.6;
    p[i * 3 + 2] = anywhere ? (Math.random() - 0.5) * 12 : 6;
  }
  update(dt) {
    super.update();
    const speed = state.vehicle.speedKmh / 300;
    const p = this.pos;
    for (let i = 0; i < p.length / 3; i++) {
      p[i * 3 + 2] -= dt * (3 + speed * 12);
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      // Push particles around the body (rough deflection)
      if (Math.abs(z) < 2.6 && Math.abs(x) < 0.75 && y < 1.2) {
        p[i * 3] += Math.sign(x || 1) * dt * 1.6;
        p[i * 3 + 1] += dt * 0.4;
      }
      if (p[i * 3 + 2] < -6 || Math.abs(p[i * 3]) > 2.2 || p[i * 3 + 1] > 2.2) this._respawn(i);
    }
    this.flow.geometry.attributes.position.needsUpdate = true;
    this.flow.material.opacity = 0.25 + speed * 0.5;
  }
}

// Single tyre with three temperature zones. Use setCorner() to switch wheels.
export class TyreViewport extends Viewport3D {
  constructor(container) {
    super(container, {
      distance: 3.0, phi: 1.25, theta: 1.2, autoRotate: 0.3,
      target: new THREE.Vector3(0, 0, 0), stage: false,
    });
    this.tyre = buildTyre();
    this.scene.add(this.tyre.root);
    this.corner = 'FL';
  }
  setCorner(c) { this.corner = c; }
  update() {
    const t = state.vehicle.tyres[this.corner].tempC;
    this.tyre.setTemps({ inner: t - 5, mid: t, outer: t + 3 });
  }
}

// Car in a live weather scene: sky tint, fog, rain streaks, sun or clouds, wind.
export class WeatherViewport extends Viewport3D {
  constructor(container) {
    super(container, { distance: 9.5, phi: 1.38, autoRotate: 0.06, target: new THREE.Vector3(0, 1.1, 0) });
    this.car = buildCar({ livery: '#3a3f4a', accent: state.settings.accent });
    this.car.root.scale.setScalar(0.9);
    this.scene.add(this.car.root);

    this.dry = new THREE.Color(0x24344f);
    this.wet = new THREE.Color(0x0a0d14);
    this.skyCol = new THREE.Color();
    this.scene.fog = new THREE.Fog(this.skyCol, 12, 30);

    // Rain: N drops, each a line segment
    this.N = 900;
    this.dx = new Float32Array(this.N);
    this.dy = new Float32Array(this.N);
    this.dz = new Float32Array(this.N);
    for (let i = 0; i < this.N; i++) this._drop(i, true);
    this.rainPos = new Float32Array(this.N * 6);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0x9cc6ff, transparent: true, opacity: 0.55 }));
    this.scene.add(this.rain);

    // Sun (dry) and clouds (wet)
    this.sun = new THREE.Mesh(new THREE.SphereGeometry(0.7, 24, 16), new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    this.sun.position.set(-7, 7, -7);
    this.scene.add(this.sun);
    this.clouds = [];
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xcfd6e4, roughness: 1, transparent: true, opacity: 0.6 });
    for (let i = 0; i < 7; i++) {
      const c = new THREE.Mesh(new THREE.SphereGeometry(1.4 + Math.random(), 16, 12), cloudMat);
      c.position.set(-8 + i * 2.6, 7.5 + Math.random(), -6 + Math.random() * 4);
      c.scale.set(1.6, 0.7, 1);
      this.scene.add(c);
      this.clouds.push(c);
    }
    this.cloudMat = cloudMat;
  }

  _drop(i, anywhere = false) {
    this.dx[i] = (Math.random() - 0.5) * 22;
    this.dy[i] = anywhere ? Math.random() * 12 : 12;
    this.dz[i] = (Math.random() - 0.5) * 22;
  }

  update(dt) {
    const w = state.weather;
    const rain = w.rainIntensity;
    const wind = w.windKmh / 20;

    this.skyCol.copy(this.dry).lerp(this.wet, rain);
    this.scene.background = this.skyCol;
    this.sun.visible = rain < 0.35;
    this.cloudMat.opacity = 0.25 + rain * 0.55;
    this.clouds.forEach((c, i) => { c.position.x += dt * (0.2 + wind * 0.3) * (i % 2 ? 1 : 0.6); if (c.position.x > 8) c.position.x = -9; });

    const count = Math.round(rain * this.N);
    this.rain.geometry.setDrawRange(0, count * 2);
    this.rain.material.opacity = 0.2 + rain * 0.5;
    const p = this.rainPos;
    for (let i = 0; i < count; i++) {
      this.dy[i] -= dt * 14;
      this.dx[i] += dt * wind * 2;
      if (this.dy[i] < 0) this._drop(i);
      const x = this.dx[i], y = this.dy[i], z = this.dz[i];
      p[i * 6] = x; p[i * 6 + 1] = y + 0.35; p[i * 6 + 2] = z;
      p[i * 6 + 3] = x - wind * 0.08; p[i * 6 + 4] = y; p[i * 6 + 5] = z;
    }
    this.rain.geometry.attributes.position.needsUpdate = true;

    syncCar(this.car);
  }
}
