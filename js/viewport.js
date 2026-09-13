// Three.js viewport: terrain mesh, sea, erosion particles, river ribbons, clip plane.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class Viewport {
  constructor(container, onFps) {
    this.container = container;
    this.onFps = onFps;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0e13);
    this.scene.fog = new THREE.Fog(0x0b0e13, 220, 520);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.5, 2000);
    this.camera.position.set(95, 70, 95);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 12, 0);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 8;
    this.controls.maxDistance = 420;
    // lights
    this.scene.add(new THREE.HemisphereLight(0xbdd5ff, 0x2a2018, 0.85));
    const sun = new THREE.DirectionalLight(0xfff1dd, 1.6);
    sun.position.set(80, 120, 40);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x88aaff, 0.35);
    fill.position.set(-60, 40, -80);
    this.scene.add(fill);
    // clip plane (cross-section to inspect caves/overhangs)
    this.clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 1e9);
    this.renderer.clippingPlanes = [];
    // terrain
    this.terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.95, metalness: 0.0,
      clippingPlanes: [this.clipPlane], clipShadows: false,
    });
    this.terrain = new THREE.Mesh(new THREE.BufferGeometry(), this.terrainMat);
    this.scene.add(this.terrain);
    this.wire = null;
    // sea
    this.seaMat = new THREE.MeshStandardMaterial({
      color: 0x1a6fa8, transparent: true, opacity: 0.72, roughness: 0.25, metalness: 0.1,
    });
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.seaMat);
    this.sea.rotation.x = -Math.PI / 2;
    this.scene.add(this.sea);
    // particles
    const PMAX = 20000;
    this.pGeo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(PMAX * 3);
    this.pGeo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    this.pGeo.setDrawRange(0, 0);
    this.pMat = new THREE.PointsMaterial({ color: 0x4db8ff, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false });
    this.points = new THREE.Points(this.pGeo, this.pMat);
    this.points.frustumCulled = false;
    this.scene.add(this.points);
    // rivers
    this.riverGroup = new THREE.Group();
    this.scene.add(this.riverGroup);
    this.riverMat = new THREE.MeshStandardMaterial({
      color: 0x2fa8e0, transparent: true, opacity: 0.8, roughness: 0.2, metalness: 0.1,
      side: THREE.DoubleSide, emissive: 0x0a3040, emissiveIntensity: 0.4,
    });
    // ground grid
    this.grid = new THREE.GridHelper(120, 24, 0x2a3646, 0x1a2230);
    this.grid.position.y = 0.02;
    this.scene.add(this.grid);
    this.showParticles = true;
    this.resize();
    addEventListener('resize', () => this.resize());
    // loop
    this.frames = 0; this.lastFpsT = performance.now();
    this.t0 = performance.now();
    const loop = () => {
      requestAnimationFrame(loop);
      this.controls.update();
      const t = (performance.now() - this.t0) / 1000;
      this.seaMat.opacity = 0.68 + Math.sin(t * 0.8) * 0.05;
      this.renderer.render(this.scene, this.camera);
      this.frames++;
      const now = performance.now();
      if (now - this.lastFpsT > 500) {
        if (this.onFps) this.onFps(Math.round((this.frames * 1000) / (now - this.lastFpsT)));
        this.frames = 0; this.lastFpsT = now;
      }
    };
    loop();
  }
  resize() {
    const w = this.container.clientWidth || 2, h = this.container.clientHeight || 2;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
  setMesh({ positions, normals, colors, indices }) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.setIndex(new THREE.BufferAttribute(indices, 1));
    this.terrain.geometry.dispose();
    this.terrain.geometry = g;
    if (this.wire) {
      this.terrain.remove(this.wire);
      this.wire.geometry = g;
      this.terrain.add(this.wire);
    }
  }
  setColors(colors) {
    const g = this.terrain.geometry;
    if (!g || !g.getAttribute('position')) return;
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.attributes.color.needsUpdate = true;
  }
  setWireframe(on) {
    if (on && !this.wire) {
      this.wire = new THREE.Mesh(this.terrain.geometry, new THREE.MeshBasicMaterial({ wireframe: true, color: 0x59c2ff, transparent: true, opacity: 0.12 }));
      this.terrain.add(this.wire);
    } else if (!on && this.wire) {
      this.terrain.remove(this.wire);
      this.wire.material.dispose();
      this.wire = null;
    }
  }
  setParticles(viz, n, color) {
    if (!this.showParticles || !viz) { this.pGeo.setDrawRange(0, 0); return; }
    const m = Math.min(n, 20000);
    this.pPos.set(viz.subarray(0, m * 3));
    this.pGeo.attributes.position.needsUpdate = true;
    this.pGeo.setDrawRange(0, m);
    if (color) this.pMat.color.set(color);
  }
  clearParticles() { this.pGeo.setDrawRange(0, 0); }
  setRivers(paths, lift = 0.35) {
    while (this.riverGroup.children.length) {
      const c = this.riverGroup.children.pop();
      c.geometry.dispose();
    }
    if (!paths) return;
    for (const pts of paths) {
      if (pts.length < 4) continue;
      const vp = [], idx = [];
      for (let i = 0; i < pts.length; i++) {
        const [x, y, z, w] = pts[i];
        const q = pts[Math.min(pts.length - 1, i + 1)], p = pts[Math.max(0, i - 1)];
        let dx = q[0] - p[0], dz = q[2] - p[2];
        const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        const hw = Math.max(0.4, w * 0.55);
        vp.push(x - dz * hw, y + lift, z + dx * hw, x + dz * hw, y + lift, z - dx * hw);
        if (i > 0) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vp), 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.riverGroup.add(new THREE.Mesh(g, this.riverMat));
    }
  }
  setSea(level, size, visible) {
    this.sea.visible = visible;
    this.sea.position.y = level;
    this.sea.scale.set(size, size, 1);
  }
  setClip(y) {
    if (y === null || y === undefined) { this.renderer.clippingPlanes = []; }
    else { this.clipPlane.constant = y; this.renderer.clippingPlanes = [this.clipPlane]; }
  }
  setAutoRotate(on) { this.controls.autoRotate = on; this.controls.autoRotateSpeed = 0.7; }
  resetCamera() {
    this.camera.position.set(95, 70, 95);
    this.controls.target.set(0, 12, 0);
  }
}
