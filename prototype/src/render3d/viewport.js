// Base class for every 3D view embedded in a 2D app.
// Each Viewport3D owns one WebGL renderer + canvas inside a container <div>.
// Rendering pauses when the container is off-screen or hidden.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { state } from '../core/store.js';
import { clamp } from '../ui/widgets.js';

export function addLights(scene, accent) {
  scene.add(new THREE.HemisphereLight(0xdfe7ff, 0x0b0c10, 0.5));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(4, 8, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(accent, 1.4);
  rim.position.set(-5, 4, -6);
  scene.add(rim);
  return rim;
}

export function addStage(scene, accent, radius = 6) {
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 72),
    new THREE.MeshStandardMaterial({ color: 0x0c0e12, roughness: 0.85, metalness: 0.1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(radius * 0.92, radius * 0.93, 128),
    new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.5 }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.002;
  const grid = new THREE.GridHelper(radius * 2, 24, 0x222834, 0x171b23);
  grid.position.y = 0.001;
  grid.material.transparent = true;
  grid.material.opacity = 0.5;
  scene.add(ground, ring, grid);
  addLights(scene, accent);
  return { ground, ring };
}

export class Viewport3D {
  constructor(container, opts = {}) {
    this.opts = {
      fov: 35, distance: 7, theta: 0.7, phi: 1.2, autoRotate: 0.2,
      target: new THREE.Vector3(0, 0.45, 0), minDistance: 2, maxDistance: 16,
      stage: true, ...opts,
    };
    this.container = container;
    container.classList.add('vp3d');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'gl';
    container.prepend(this.canvas);

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = this.envTex;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(this.opts.fov, 1, 0.1, 200);
    this.orbit = {
      theta: this.opts.theta, phi: this.opts.phi, distance: this.opts.distance,
      target: this.opts.target.clone(), minD: this.opts.minDistance, maxD: this.opts.maxDistance,
    };
    this.stage = this.opts.stage ? addStage(this.scene, state.settings.accent) : null;
    if (!this.stage) addLights(this.scene, state.settings.accent);

    this.dragging = false;
    this.idle = 3;           // seconds since last drag; auto-rotate resumes after 3 s
    this.visible = true;
    this.running = true;
    this.last = performance.now();
    this._bind();

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
    this._io = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; });
    this._io.observe(container);
    this.resize();
    this._raf = requestAnimationFrame((t) => this._loop(t));
  }

  resize() {
    const w = this.container.clientWidth, hh = this.container.clientHeight;
    if (!w || !hh) return;
    this.renderer.setSize(w, hh, false);
    this.camera.aspect = w / hh;
    this.camera.updateProjectionMatrix();
  }

  _bind() {
    const c = this.canvas;
    let last = null;
    c.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      last = { x: e.clientX, y: e.clientY };
      c.setPointerCapture(e.pointerId);
      this.idle = 0;
    });
    c.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      this.orbit.theta -= dx * 0.008;
      this.orbit.phi = clamp(this.orbit.phi - dy * 0.006, 0.25, 1.5);
    });
    const end = () => { this.dragging = false; };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      const o = this.orbit;
      o.distance = clamp(o.distance * Math.exp(e.deltaY * 0.001), o.minD, o.maxD);
    }, { passive: false });
  }

  _loop(now) {
    if (!this.running) return;
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.visible && this.canvas.clientWidth) {
      if (!this.dragging) {
        this.idle += dt;
        if (this.idle > 3) this.orbit.theta += this.opts.autoRotate * dt;
      }
      const o = this.orbit, s = Math.sin(o.phi);
      this.camera.position.set(
        o.target.x + o.distance * s * Math.sin(o.theta),
        o.target.y + o.distance * Math.cos(o.phi),
        o.target.z + o.distance * s * Math.cos(o.theta),
      );
      this.camera.lookAt(o.target);
      this.update?.(dt);
      this.renderer.render(this.scene, this.camera);
    }
    this._raf = requestAnimationFrame((t) => this._loop(t));
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this._io.disconnect();
    this.scene.traverse((o) => {
      o.geometry?.dispose();
      const m = o.material;
      if (m) (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
    });
    this.envTex?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    this.canvas.remove();
  }
}
