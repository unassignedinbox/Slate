// 3D preview: heightfield mesh with albedo vertex colours; water is a transparent surface that
// sits inside carved depressions (never a separate blue overlay mesh).
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export class Terrain3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    container.append(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e1218);
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    this.camera.position.set(0, 180, 220);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6); sun.position.set(-120, 200, 80); this.scene.add(sun);
    this.group = new THREE.Group(); this.scene.add(this.group);
    this.ro = new ResizeObserver(() => this.resize()); this.ro.observe(container);
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); this.raf = requestAnimationFrame(loop); };
    loop();
  }
  resize() {
    const w = this.container.clientWidth || 800, hgt = this.container.clientHeight || 600;
    this.renderer.setSize(w, hgt, false); this.camera.aspect = w / hgt; this.camera.updateProjectionMatrix();
  }
  clearGroup() {
    for (const c of this.group.children) c.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    this.group.clear();
  }
  update(st, exaggeration = 1) {
    this.clearGroup();
    const N = st.N, S = N - 1, H = N * 0.25 * exaggeration;
    const geo = new THREE.PlaneGeometry(S, S, N - 1, N - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position, col = new Float32Array(N * N * 3);
    for (let i = 0; i < N * N; i++) {
      const x = i % N, z = (i / N) | 0; // plane vertices run row-major from -S/2 (z) to +S/2
      const vi = i;
      pos.setY(vi, st.h[z * N + x] * H);
      col[i * 3] = st.albedo[i * 3]; col[i * 3 + 1] = st.albedo[i * 3 + 1]; col[i * 3 + 2] = st.albedo[i * 3 + 2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    this.group.add(terrain);
    // water: quads only where the water surface is recorded; sits at its level.
    if (st.water) {
      const verts = [];
      for (let z = 0; z < N - 1; z++) for (let x = 0; x < N - 1; x++) {
        const i0 = z * N + x, i1 = i0 + 1, i2 = i0 + N, i3 = i2 + 1;
        const w = [st.water[i0], st.water[i1], st.water[i2], st.water[i3]];
        if (w.some((v) => Number.isNaN(v))) continue;
        const pts = [[i0, w[0]], [i1, w[1]], [i2, w[2]], [i0, w[0]], [i2, w[2]], [i3, w[3]]];
        for (const [idx, level] of pts) {
          const xx = (idx % N) - S / 2, zz = ((idx / N) | 0) - S / 2;
          verts.push(xx, level * H, zz);
        }
      }
      if (verts.length) {
        const wg = new THREE.BufferGeometry();
        wg.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
        wg.computeVertexNormals();
        const wm = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: 0x2a78c8, transparent: true, opacity: 0.55, roughness: 0.15, metalness: 0, depthWrite: false, side: THREE.DoubleSide }));
        this.group.add(wm);
      }
    }
  }
  dispose() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.renderer.dispose(); }
}

// Voxelised view (derived from the heightmap): columns of voxels up to height * levels.
export function buildVoxels(st, opts = {}) {
  const N = Math.min(st.N, opts.res ?? 96), L = opts.levels ?? 40;
  const grid = new Uint8Array(N * L * N); // index: (y*L + z)*N + x  (y is height level)
  const colour = new Float32Array(N * N * 3);
  const sx = st.N / N;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const si = Math.floor(z * sx) * st.N + Math.floor(x * sx);
    const top = Math.max(0, Math.min(L, Math.round(st.h[si] * L)));
    for (let y = 0; y < top; y++) grid[(y * N + z) * N + x] = 1;
    colour[(z * N + x) * 3] = st.albedo[si * 3]; colour[(z * N + x) * 3 + 1] = st.albedo[si * 3 + 1]; colour[(z * N + x) * 3 + 2] = st.albedo[si * 3 + 2];
  }
  return { N, L, grid, colour };
}

export class Voxel3D extends Terrain3D {
  update(st) {
    this.clearGroup();
    const { N, L, grid, colour } = buildVoxels(st, { res: 96, levels: 40 });
    const solid = (x, y, z) => x >= 0 && z >= 0 && y >= 0 && x < N && z < N && y < L && grid[(y * N + z) * N + x] === 1;
    const exposed = [];
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) for (let y = 0; y < L; y++) {
      if (!solid(x, y, z)) continue;
      if (!solid(x, y + 1, z) || !solid(x + 1, y, z) || !solid(x - 1, y, z) || !solid(x, y, z + 1) || !solid(x, y, z - 1)) exposed.push([x, y, z]);
    }
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.85 });
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, exposed.length));
    const m4 = new THREE.Matrix4(), c = new THREE.Color();
    exposed.forEach(([x, y, z], k) => {
      m4.makeTranslation(x - N / 2, y, z - N / 2);
      mesh.setMatrixAt(k, m4);
      const ci = (z * N + x) * 3;
      c.setRGB(colour[ci], colour[ci + 1], colour[ci + 2]);
      mesh.setColorAt(k, c);
    });
    mesh.count = exposed.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.voxelCount = exposed.length;
    this.lastVoxels = { N, L, grid };
  }
}
