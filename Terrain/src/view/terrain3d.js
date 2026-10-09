// 3-D viewport. The heightmap is the geometry. Water is not a separate surface laid on top: it is a translucent fill
// drawn only over cells where the carved basin holds water (water depth > 0), sitting at the water level.
// The voxel mode renders the derived voxel form (exposed faces only) for the same heightmap.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { voxelize, exposedVoxels } from '../engine/voxels.js';

export function createTerrain3d(container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  container.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15171c);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 50);
  camera.position.set(1.1, 0.9, 1.3);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.12, 0);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303038, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-1, 2, 1);
  scene.add(sun);
  let group = null;

  function resize() {
    const w = container.clientWidth || 1, h = container.clientHeight || 1;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = `${w}px`;
    renderer.domElement.style.height = `${h}px`;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

  function clear() {
    if (!group) return;
    group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    scene.remove(group);
    group = null;
  }

  // Build the surface and water. `exaggeration` scales vertical relief relative to the 1 m-wide tile.
  function buildSurface(r, exaggeration) {
    const N = r.N, S = 1, cs = S / (N - 1), vh = 0.35 * exaggeration;
    const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x;
      pos[i * 3] = x * cs - 0.5; pos[i * 3 + 1] = r.H[i] * vh; pos[i * 3 + 2] = y * cs - 0.5;
      col[i * 3] = r.C[i * 3]; col[i * 3 + 1] = r.C[i * 3 + 1]; col[i * 3 + 2] = r.C[i * 3 + 2];
    }
    const idx = [];
    for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
      const a = y * N + x, b = a + 1, c = a + N, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
    group.add(mesh);

    // Water: one quad per wet cell, level = mean surface + depth, alpha from depth.
    const wet = [], wpos = [], wcol = [];
    let k = 0;
    for (let y = 0; y < N - 1; y++) for (let x = 0; x < N - 1; x++) {
      const a = y * N + x, b = a + 1, c = a + N, d = c + 1;
      const w = (r.water[a] + r.water[b] + r.water[c] + r.water[d]) / 4;
      if (w <= 1e-5) continue;
      const level = (r.H[a] + r.H[b] + r.H[c] + r.H[d]) / 4 + w;
      const alpha = Math.min(1, w / 0.02) * 0.6;
      const x0 = x * cs - 0.5, z0 = y * cs - 0.5, x1 = x0 + cs, z1 = z0 + cs, Y = level * vh;
      wpos.push(x0, Y, z0, x1, Y, z0, x0, Y, z1, x1, Y, z1);
      for (let q = 0; q < 4; q++) wcol.push(0.2, 0.45, 0.7, alpha);
      wet.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
      k += 4;
    }
    if (wet.length) {
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(wpos, 3));
      wg.setAttribute('color', new THREE.Float32BufferAttribute(wcol, 4));
      wg.setIndex(wet);
      const wm = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, depthWrite: false, roughness: 0.2, metalness: 0 }));
      group.add(wm);
    }
  }

  function buildVoxels(r) {
    const N = r.N, Z = 40;
    const solid = voxelize(r.H, N, Z);
    const { list, truncated } = exposedVoxels(solid, N, Z);
    const count = list.length / 3;
    const s = 1 / (N - 1), sz = 0.35 / Z * 1.0;
    const geo = new THREE.BoxGeometry(s, sz, s);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: false, roughness: 0.9 });
    const inst = new THREE.InstancedMesh(geo, mat, count);
    const m = new THREE.Matrix4(), c = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const x = list[i * 3], y = list[i * 3 + 1], z = list[i * 3 + 2];
      m.makeTranslation(x * s - 0.5, (z + 0.5) * sz, y * s - 0.5);
      inst.setMatrixAt(i, m);
      const p = (y * N + x) * 3;
      c.setRGB(r.C[p], r.C[p + 1], r.C[p + 2]);
      inst.setColorAt(i, c);
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
    return { count, truncated, solid: solid.reduce((a, b) => a + b, 0) };
  }

  function setResult(r, { voxel = false, exaggeration = 1 } = {}) {
    clear();
    group = new THREE.Group();
    scene.add(group);
    let info = null;
    if (voxel) info = buildVoxels(r);
    else buildSurface(r, exaggeration);
    return info;
  }

  return { setResult, resize, dispose: () => { clear(); renderer.dispose(); } };
}
