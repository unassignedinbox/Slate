// GameView: owns the three.js renderer, sky and lights, and keeps every simulated object's
// mesh in sync with the simulation each frame (vehicles, air units, bollards, gadgets).
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { CityRender } from './city.js';
import * as M from './models.js';
import { CameraController } from './camera.js';

const STATUS_RING = { stunned: 0xff3b3b, netted: 0xffb020, stalled: 0x45e0ff, jammed: 0xc77dff, spun: 0xff7ad9 };

function disposeTree(obj) {
  obj.traverse(c => {
    if (c.geometry && !c.geometry.userData?.shared) c.geometry.dispose();
    if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(m => m.dispose());
  });
}

export class GameView {
  constructor(canvas, sim, net, builder) {
    this.sim = sim;
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(58, 1, 0.5, 26000);
    this.camera.position.set(0, 80, 200);
    this.controls = new CameraController(this.camera, canvas);
    this.controls.pickPoint = (x, y) => this.pickPoint(x, y);

    this.setupEnvironment();
    this.city = new CityRender(r, this.scene, net);
    this.city.build(builder);

    this.cars = new Map(); this.air = new Map(); this.gates = new Map(); this.fx = new Map();
    this.time = 0;
    this.selectedId = null;
    this.selectRing = M.rippleMesh(0x45e0ff);
    this.selectRing.visible = false;
    this.scene.add(this.selectRing);
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
  }

  resize() {
    const el = this.canvas.parentElement;
    const w = el.clientWidth || window.innerWidth, h = el.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  setupEnvironment() {
    this.sky = new Sky();
    this.sky.scale.setScalar(20000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 6; u.rayleigh.value = 1.2; u.mieCoefficient.value = 0.006; u.mieDirectionalG.value = 0.8;
    this.scene.add(this.sky);
    this.sun = new THREE.DirectionalLight(0xffe2b8, 2.6);
    this.sun.castShadow = true;
    const sc = this.sun.shadow;
    sc.mapSize.set(2048, 2048);
    sc.camera.near = 1; sc.camera.far = 900;
    sc.camera.left = -240; sc.camera.right = 240; sc.camera.top = 240; sc.camera.bottom = -240;
    sc.camera.updateProjectionMatrix();
    sc.bias = -0.0004; sc.normalBias = 0.3;
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xbcd4ff, 0x3a3a3a, 0.6);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.Fog(0x202a3a, 900, 7000);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.setHour(20.4);
  }

  // Time of day from 0..24. Night keeps headlights, light bars and lamps readable.
  setHour(h) {
    this.hour = h;
    const day = Math.sin(((h - 6) / 12) * Math.PI);
    const elev = Math.max(-0.2, day) * 60;
    const az = ((h - 6) / 12) * 180 - 90 + 35;
    const phi = THREE.MathUtils.degToRad(90 - elev), theta = THREE.MathUtils.degToRad(az);
    this.sunDir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const k = THREE.MathUtils.clamp(day * 3, 0, 1);
    this.sun.position.copy(this.sunDir).multiplyScalar(400);
    this.sun.intensity = 2.8 * k + 0.05;
    this.hemi.intensity = 0.25 + 0.45 * k;
    this.night = 1 - THREE.MathUtils.clamp((day + 0.1) * 4, 0, 1);
    this.renderer.toneMappingExposure = 0.85 + this.night * 0.35;
    this.scene.fog.color.setHSL(0.6, 0.35, 0.05 + 0.5 * THREE.MathUtils.clamp(day + 0.15, 0, 1) ** 0.6);
    // Image-based light from a sky dome of the current sun position.
    if (this._env) this._env.dispose();
    const tmp = new THREE.Scene(); const dome = new Sky(); dome.scale.setScalar(1000);
    dome.material.uniforms.sunPosition.value.copy(this.sunDir);
    tmp.add(dome);
    this._env = this.pmrem.fromScene(tmp, 0, 1, 3000);
    this.scene.environment = this._env.texture;
    this.scene.environmentIntensity = 0.25 + 0.2 * k;
    dome.geometry.dispose(); dome.material.dispose();
  }

  // ------------------------------------------------------------------ per-frame sync
  sync(dt) {
    this.time += dt;
    const t = this.time;
    this.syncVehicles(t);
    this.syncAir(t, dt);
    this.syncGates(t);
    this.syncGadgets(t, dt);
    this.city.cull(this.camera);
    const v = this.selectedId != null ? this.sim.vehicles.find(x => x.id === this.selectedId) : null;
    if (v && v.alive) {
      this.selectRing.visible = true;
      this.selectRing.position.set(v.x, v.y + 0.12, v.z);
      this.selectRing.scale.setScalar(4.2);
    } else this.selectRing.visible = false;
  }

  syncVehicles(t) {
    const alive = new Set();
    for (const v of this.sim.vehicles) {
      if (!v.alive) continue;
      alive.add(v.id);
      const o = this.cars.get(v.id) || this.makeCar(v);
      let x = v.x + v.vx, z = v.z + v.vz;
      if (v.jammed > 0) { x += Math.sin(v.wobble * 7.1) * 0.9; z += Math.cos(v.wobble * 5.3) * 0.6; }
      o.group.position.set(x, v.y + 0.02, z);
      o.group.rotation.y = Math.atan2(v.hx, v.hz) + (v.spun > 0 ? Math.sin(t * 22) * 0.6 : 0);
      if (o.lights) this.animateLightBar(o.lights, v, t);
      this.syncStatusRing(o, v, t);
    }
    for (const [id, o] of this.cars) if (!alive.has(id)) this.dropCar(id, o);
  }

  makeCar(v) {
    const group = new THREE.Group();
    const kind = ['sedan', 'van', 'sport', 'muscle', 'cruiser'].includes(v.model) ? v.model : 'sedan';
    const geo = M.vehicleGeometry(kind);
    const paint = new THREE.Mesh(geo.paint, M.paintMaterial(v.kind === 'police' ? 0xf4f6f8 : v.color));
    paint.castShadow = true;
    const trim = new THREE.Mesh(geo.trim, M.MATS.trim);
    trim.castShadow = true;
    group.add(paint, trim);
    if (geo.glow) group.add(new THREE.Mesh(geo.glow, M.MATS.glow));
    let lights = null;
    if (kind === 'cruiser') { lights = M.lightBar(); group.add(lights.group); }
    this.scene.add(group);
    const o = { group, lights, ring: null };
    this.cars.set(v.id, o);
    return o;
  }

  animateLightBar(lb, v, t) {
    const phase = (t * 6.5 + (v.lightPhase || 0)) % 2;
    const onRed = phase < 0.9, onBlue = phase >= 1.0 && phase < 1.9;
    for (const l of lb.lamps) {
      const on = l.red ? onRed : onBlue;
      l.mesh.material.color.copy(l.base).multiplyScalar(on ? 1.8 : 0.12);
    }
  }

  syncStatusRing(o, v, t) {
    let status = null;
    if (v.stunned > 0) status = 'stunned';
    else if (v.netted > 0) status = 'netted';
    else if (v.stalled > 0) status = 'stalled';
    else if (v.jammed > 0) status = 'jammed';
    else if (v.spun > 0) status = 'spun';
    if (!status) { if (o.ring) o.ring.visible = false; return; }
    if (!o.ring) {
      o.ring = M.rippleMesh(STATUS_RING[status]);
      o.ring.scale.setScalar(3.6);
      this.scene.add(o.ring);
    }
    o.ring.material.color.setHex(STATUS_RING[status]);
    o.ring.visible = true;
    o.ring.position.set(v.x, v.y + 0.1, v.z);
    o.ring.material.opacity = 0.45 + 0.4 * Math.sin(t * 9);
  }

  dropCar(id, o) {
    this.scene.remove(o.group);
    if (o.ring) { this.scene.remove(o.ring); o.ring.geometry.dispose(); o.ring.material.dispose(); }
    if (o.lights) o.lights.group.traverse(c => { if (c.material) c.material.dispose(); if (c.geometry) c.geometry.dispose(); });
    this.cars.delete(id);
  }

  // ------------------------------------------------------------------ air units
  syncAir(t, dt) {
    const alive = new Set();
    for (const u of this.sim.air.units) {
      if (!u.alive) continue;
      alive.add(u.id);
      const o = this.air.get(u.id) || this.makeAir(u);
      o.group.position.set(u.x, u.y, u.z);
      o.group.rotation.y = Math.atan2(u.hx, u.hz);
      const d = o.group.userData;
      if (u.kind === 'heli') {
        d.rotor.rotation.y += dt * 40;
        d.tail.rotation.x += dt * 60;
        d.beacon.visible = Math.sin(t * 6) > -0.2;
        this.updateBeam(o, u);
      } else {
        d.rotors.forEach(r => { r.rotation.y += dt * 60; });
        d.led.visible = Math.sin(t * 8 + u.id) > -0.3;
      }
    }
    for (const [id, o] of this.air) {
      if (alive.has(id)) continue;
      this.scene.remove(o.group);
      if (o.beam) this.scene.remove(o.beam);
      if (o.pool) this.scene.remove(o.pool);
      this.air.delete(id);
    }
  }

  makeAir(u) {
    const group = u.kind === 'heli' ? M.helicopter() : M.drone(u.kind === 'intercept' ? 0x3a1f1f : 0x2b2f36);
    group.traverse(c => { if (c.isMesh) c.castShadow = true; });
    this.scene.add(group);
    const o = { group, beam: null, pool: null };
    if (u.kind === 'heli') {
      o.beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 16, 1, 18, 1, true), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.12, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }));
      o.pool = new THREE.Mesh(new THREE.CircleGeometry(16, 32), new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
      o.pool.rotation.x = -Math.PI / 2;
      this.scene.add(o.beam, o.pool);
    }
    this.air.set(u.id, o);
    return o;
  }

  // Searchlight: a beam from the helicopter nose down onto its target.
  updateBeam(o, u) {
    const t = u.target;
    const on = !!(t && t.alive);
    o.beam.visible = o.pool.visible = on;
    if (!on) return;
    const from = new THREE.Vector3(u.x, u.y - 1.0, u.z + 1.5);
    const to = new THREE.Vector3(t.x, t.y + 1.0, t.z);
    o.beam.scale.set(1, from.distanceTo(to), 1);
    o.beam.position.copy(from).lerp(to, 0.5);
    o.beam.lookAt(to);
    o.beam.rotateX(Math.PI / 2);
    o.pool.position.set(t.x, t.y + 0.15, t.z);
  }

  // ------------------------------------------------------------------ bollards
  syncGates(t) {
    const gates = this.sim.bollards.gates;
    const live = new Set(gates.map(g => g.id));
    for (const g of gates) {
      const o = this.gates.get(g.id) || this.makeGate(g);
      o.posts.forEach(p => { p.position.y = -0.95 + 0.95 * g.phase; });
      o.lamp.material.color.setHex(g.state === 'down' ? 0x3a2a10 : (Math.sin(t * 10) > 0 ? 0xffa000 : 0x6a4000));
    }
    for (const [id, o] of this.gates) {
      if (live.has(id)) continue;
      for (const p of o.posts) this.scene.remove(p);
      this.scene.remove(o.lamp);
      this.gates.delete(id);
    }
  }

  makeGate(g) {
    const graph = this.sim.graph;
    const posts = [];
    for (let i = 0; i < g.posts; i++) {
      const o = g.o0 + 0.6 + ((g.o1 - g.o0 - 1.2) * i) / Math.max(1, g.posts - 1);
      const p = graph.pointAt(g.e, g.s, o);
      const post = M.bollardPost(0.95, 0x8d939a);
      post.position.set(p.x, -0.95, p.z);
      post.rotation.y = Math.atan2(p.tx, p.tz);
      this.scene.add(post);
      posts.push(post);
    }
    const mid = graph.pointAt(g.e, g.s, (g.o0 + g.o1) / 2);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.12, 0.18), new THREE.MeshBasicMaterial({ color: 0x3a2a10, toneMapped: false }));
    lamp.position.set(mid.x, 0.02, mid.z);
    lamp.rotation.y = Math.atan2(mid.tx, mid.tz);
    this.scene.add(lamp);
    const o = { posts, lamp };
    this.gates.set(g.id, o);
    return o;
  }

  // ------------------------------------------------------------------ gadgets
  syncGadgets(t, dt) {
    const items = this.sim.gadgets.items;
    const live = new Set(items.map(i => i.id));
    for (const it of items) {
      const o = this.fx.get(it.id) || this.makeFx(it);
      if (it.kind === 'net') {
        o.plane.visible = !it.used;
        o.plane.material.opacity = Math.min(1, it.life / 2) * (0.75 + 0.25 * Math.sin(t * 6));
      } else if (it.kind === 'emp') {
        const k = Math.min(1, it.age / it.life);
        o.mesh.scale.setScalar(1 + k * (it.r - 1));
        o.mesh.material.opacity = 0.9 * (1 - k);
      } else if (it.kind === 'jam') {
        o.mesh.material.opacity = (0.08 + 0.05 * Math.sin(t * 5)) * Math.min(1, it.life / 2);
        o.ring.material.opacity = 0.4 + 0.3 * Math.sin(t * 4);
        o.ring.rotation.z += dt * 0.5;
      } else if (it.kind === 'photon') {
        o.mesh.material.uniforms.uTime.value = t;
        o.mesh.material.uniforms.uAlpha.value = it.overload > 0 ? 0.25 + 0.3 * Math.random() : Math.min(1, it.life / 2);
      }
    }
    for (const [id, o] of this.fx) {
      if (live.has(id)) continue;
      this.scene.remove(o.mesh);
      if (o.ring) { this.scene.remove(o.ring); o.ring.geometry.dispose(); o.ring.material.dispose(); }
      disposeTree(o.mesh);
      (o.extra || []).forEach(x => { this.scene.remove(x); disposeTree(x); });
      this.fx.delete(id);
    }
  }

  makeFx(it) {
    const g = this.sim.graph;
    const o = { mesh: null, plane: null, ring: null, extra: [] };
    if (it.kind === 'net') {
      const p = g.pointAt(it.e, it.s, (it.o0 + it.o1) / 2);
      const root = new THREE.Group();
      o.plane = M.tireNetMesh(5.5, it.o1 - it.o0);
      o.plane.material.transparent = true;
      root.add(o.plane);
      root.position.set(p.x, 0.12, p.z);
      root.rotation.y = Math.atan2(p.tx, p.tz);
      o.mesh = root;
    } else if (it.kind === 'emp') {
      o.mesh = M.rippleMesh(0x7fe7ff);
      o.mesh.position.set(it.x, it.y, it.z);
    } else if (it.kind === 'jam') {
      o.mesh = new THREE.Mesh(new THREE.CylinderGeometry(it.r, it.r, 10, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0xb36bff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
      o.mesh.position.set(it.x, 5, it.z);
      o.ring = M.rippleMesh(0xb36bff);
      o.ring.scale.setScalar(it.r * 2);
      o.ring.position.set(it.x, 0.2, it.z);
      this.scene.add(o.ring);
    } else if (it.kind === 'photon') {
      const p = g.pointAt(it.e, it.s, (it.o0 + it.o1) / 2);
      o.mesh = new THREE.Mesh(new THREE.PlaneGeometry(it.o1 - it.o0, 3.2), M.photonWallMaterial());
      o.mesh.position.set(p.x, 1.6, p.z);
      o.mesh.rotation.y = Math.atan2(p.tx, p.tz);
      for (const side of [it.o0 - 0.2, it.o1 + 0.2]) {
        const q = g.pointAt(it.e, it.s, side);
        const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.3, 0.3), new THREE.MeshStandardMaterial({ color: 0x20262e, roughness: 0.5 }));
        post.position.set(q.x, 0.65, q.z);
        this.scene.add(post);
        o.extra.push(post);
      }
    }
    this.scene.add(o.mesh);
    this.fx.set(it.id, o);
    return o;
  }

  // ------------------------------------------------------------------ frame
  render() { this.renderer.render(this.scene, this.camera); }

  // World-space ground point under the cursor (used by the camera controller for pivots).
  pickPoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new THREE.Vector3();
    return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), p) ? p : null;
  }
}
