// Three.js viewport: sky + sun (with PMREM environment), shadowed terrain block, instanced rocks,
// water plane, atmospheric fog, orbit camera and export helpers.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildTerrainGeometry, buildSkirtGeometry } from './terrain-geometry.js';
import { buildRockLibrary } from './rock-geometry.js';
import { placeRocks, buildRockMeshes } from './rock-placement.js';
import { makeSurfaceUniforms, updateSurfaceUniforms, makeSurfaceMaterial } from './surface-shader.js';

export class CliffScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.55;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 60000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;

    this.sky = new Sky();
    this.sky.scale.setScalar(450000);
    this.scene.add(this.sky);
    this.sunDir = new THREE.Vector3(0, 1, 0);

    this.sun = new THREE.DirectionalLight(0xffffff, 3.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.00015;
    this.sun.shadow.normalBias = 1.5;
    this.sun.shadow.radius = 2;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.hemi = new THREE.HemisphereLight(0x8fb0e0, 0x4a4036, 0.25);
    this.scene.add(this.hemi);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
    this.envTarget = null;

    this.scene.fog = new THREE.FogExp2(0xb9c7d8, 0.0002);

    this.uniforms = makeSurfaceUniforms();
    this.terrainMaterial = makeSurfaceMaterial(this.uniforms, { isRock: false });
    this.rockMaterial = makeSurfaceMaterial(this.uniforms, { isRock: true });

    this.terrainGroup = new THREE.Group();
    this.rockGroup = new THREE.Group();
    this.scene.add(this.terrainGroup, this.rockGroup);

    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ color: 0x15303c, roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.9, envMapIntensity: 1.2 }),
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.receiveShadow = true;
    this.scene.add(this.water);

    this.field = null;
    this.rockLibrary = null;
    this.rockCount = 0;
    this.stats = { triangles: 0 };

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.canvas.parentElement;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  frame() {
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  // ---- lighting -------------------------------------------------------------------------------
  setSky(v) {
    const phi = THREE.MathUtils.degToRad(90 - v.sunElevation);
    const theta = THREE.MathUtils.degToRad(v.sunAzimuth);
    this.sunDir.setFromSphericalCoords(1, phi, theta);
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(this.sunDir);
    u.turbidity.value = v.turbidity;
    u.rayleigh.value = 1.6 + (1 - Math.min(1, v.sunElevation / 30)) * 1.2;
    u.mieCoefficient.value = 0.004 + v.turbidity * 0.0006;
    u.mieDirectionalG.value = 0.8;
    this.renderer.toneMappingExposure = v.exposure;

    const extent = this.field ? this.field.worldSize : 2048;
    this.sun.position.copy(this.sunDir).multiplyScalar(extent * 1.5);
    this.sun.target.position.set(0, 0, 0);
    const sunCol = new THREE.Color().setHSL(0.09, 0.55, 0.5 + Math.min(0.5, v.sunElevation / 60));
    this.sun.color.copy(sunCol.lerp(new THREE.Color(0xfff4e6), Math.min(1, v.sunElevation / 35)));
    this.sun.intensity = 2.4 + Math.min(1, v.sunElevation / 40) * 1.6;
    const cam = this.sun.shadow.camera;
    cam.left = -extent * 0.72; cam.right = extent * 0.72; cam.top = extent * 0.72; cam.bottom = -extent * 0.72;
    cam.near = extent * 0.2; cam.far = extent * 3.2;
    cam.updateProjectionMatrix();

    const fogCol = new THREE.Color(0xc4d0e0).lerp(new THREE.Color(0xe7c7a8), 1 - Math.min(1, v.sunElevation / 25));
    this.scene.fog.color.copy(fogCol);
    this.scene.fog.density = (v.fogDensity * 0.0007) / Math.max(1, extent / 2048);

    this.updateEnvironment();
  }

  updateEnvironment() {
    if (this.envTarget) this.envTarget.dispose();
    const envScene = new THREE.Scene();
    envScene.add(this.sky);
    this.envTarget = this.pmrem.fromScene(envScene, 0.02);
    this.scene.add(this.sky);
    this.scene.environment = this.envTarget.texture;
    this.scene.environmentIntensity = 0.55;
  }

  setWater(v) {
    this.water.visible = !!v.waterEnabled;
    const extent = this.field ? this.field.worldSize : 2048;
    this.water.scale.set(extent * 4, extent * 4, 1);
    this.water.position.y = v.seaLevel;
  }

  // ---- terrain ----------------------------------------------------------------------------------
  setField(field, v) {
    const first = !this.field || this.field !== field;
    this.field = field;
    this.buildTerrainMeshes(v);
    if (first) this.frameCamera(v);
    this.setSky(v);
    this.setWater(v);
  }

  // Rebuild only the surface mesh (face displacement changed) and re-seat the rocks.
  rebuildMesh(v) {
    if (!this.field) return;
    this.buildTerrainMeshes(v);
    this.setRocks(v);
  }

  buildTerrainMeshes(v) {
    const field = this.field;
    this.disposeGroup(this.terrainGroup);
    const geometry = buildTerrainGeometry(field, v);
    const floorY = field.stats.min - Math.max(40, (field.stats.max - field.stats.min) * 0.12);
    const skirt = buildSkirtGeometry(field, floorY);
    const terrain = new THREE.Mesh(geometry, this.terrainMaterial);
    terrain.castShadow = true;
    terrain.receiveShadow = true;
    terrain.name = 'terrain';
    const skirtMesh = new THREE.Mesh(skirt, this.terrainMaterial);
    skirtMesh.receiveShadow = true;
    skirtMesh.name = 'skirt';
    this.terrainGroup.add(terrain, skirtMesh);
    this.terrain = terrain;
    this.stats.triangles = geometry.index.count / 3;
  }

  frameCamera(v) {
    if (!this.field) return;
    const size = this.field.worldSize;
    const mid = (this.field.stats.max + this.field.stats.min) * 0.5;
    this.controls.target.set(0, mid, 0);
    this.camera.position.set(size * 0.62, mid + size * 0.28, size * 0.78);
    this.camera.near = size * 0.0005;
    this.camera.far = size * 40;
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  setRocks(v) {
    this.disposeGroup(this.rockGroup);
    this.rockCount = 0;
    if (!this.field || !v.rocksEnabled) return;
    const key = `${v.rockSeed}:${v.rockAngularity}`;
    if (!this.rockLibrary || this.rockLibrary.key !== key) {
      if (this.rockLibrary) for (const set of ['large', 'small']) this.rockLibrary[set].forEach((g) => g.dispose());
      this.rockLibrary = buildRockLibrary(v.rockSeed, v.rockAngularity);
      this.rockLibrary.key = key;
    }
    const placements = placeRocks(this.field, v, this.rockLibrary);
    const meshes = buildRockMeshes(placements, this.rockLibrary, this.rockMaterial);
    meshes.forEach((m) => this.rockGroup.add(m));
    this.rockCount = placements.length;
    this.rockGroup.visible = !!v.showRocks;
  }

  setSurface(v) {
    updateSurfaceUniforms(this.uniforms, v);
  }

  setDisplay(v) {
    this.terrainMaterial.wireframe = !!v.wireframe;
    this.rockMaterial.wireframe = !!v.wireframe;
    this.rockGroup.visible = !!v.showRocks && !!v.rocksEnabled;
    this.controls.autoRotate = !!v.autoRotate;
    this.controls.autoRotateSpeed = 0.5;
  }

  disposeGroup(group) {
    for (const child of [...group.children]) {
      group.remove(child);
      if (child.geometry && !child.isInstancedMesh) child.geometry.dispose();
      if (child.isInstancedMesh) child.dispose();
    }
  }

  // ---- export -----------------------------------------------------------------------------------
  exportGroup(includeRocks) {
    const group = new THREE.Group();
    group.add(this.terrainGroup.clone());
    if (includeRocks) group.add(this.rockGroup.clone());
    return group;
  }

  exportOBJ(includeRocks = true) {
    const exporter = new OBJExporter();
    const text = exporter.parse(this.exportGroup(includeRocks));
    downloadBlob(new Blob([text], { type: 'text/plain' }), 'cliff-terrain.obj');
  }

  async exportGLB(includeRocks = true) {
    const exporter = new GLTFExporter();
    const group = this.exportGroup(includeRocks);
    const plain = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 1 });
    group.traverse((o) => { if (o.isMesh) o.material = plain; });
    const result = await exporter.parseAsync(group, { binary: true });
    downloadBlob(new Blob([result], { type: 'model/gltf-binary' }), 'cliff-terrain.glb');
  }

  exportHeightmap() {
    if (!this.field) return;
    const { resolution: N, height, stats } = this.field;
    const canvas = document.createElement('canvas');
    canvas.width = N; canvas.height = N;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(N, N);
    const range = Math.max(1e-6, stats.max - stats.min);
    for (let i = 0; i < N * N; i++) {
      const t = (height[i] - stats.min) / range;
      const v16 = Math.round(t * 65535);
      // 16-bit height packed as R = high byte, G = low byte, B = 8-bit preview
      img.data[i * 4] = v16 >> 8;
      img.data[i * 4 + 1] = v16 & 255;
      img.data[i * 4 + 2] = Math.round(t * 255);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    canvas.toBlob((blob) => downloadBlob(blob, `heightmap-${N}-min${stats.min.toFixed(0)}-max${stats.max.toFixed(0)}.png`));
  }

  // Top-down orthographic render of the lit terrain (rocks included) in the heightmap frame.
  exportSatmap(resolution = 2048) {
    if (!this.field) return;
    const size = this.field.worldSize;
    const cam = new THREE.OrthographicCamera(-size / 2, size / 2, size / 2, -size / 2, 1, size * 4);
    cam.position.set(0, this.field.stats.max + size, 0);
    cam.up.set(0, 0, -1);
    cam.lookAt(0, 0, 0);
    const target = new THREE.WebGLRenderTarget(resolution, resolution, { type: THREE.FloatType, colorSpace: THREE.LinearSRGBColorSpace });
    const fog = this.scene.fog;
    const skyVisible = this.sky.visible;
    this.scene.fog = null;
    this.sky.visible = false;
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this.scene, cam);
    const pixels = new Float32Array(resolution * resolution * 4);
    this.renderer.readRenderTargetPixels(target, 0, 0, resolution, resolution, pixels);
    this.renderer.setRenderTarget(null);
    this.scene.fog = fog;
    this.sky.visible = skyVisible;
    target.dispose();

    // Apply the same exposure / ACES / sRGB chain the viewport uses.
    const exposure = this.renderer.toneMappingExposure;
    const aces = (x) => Math.min(1, Math.max(0, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)));
    const srgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
    const canvas = document.createElement('canvas');
    canvas.width = resolution; canvas.height = resolution;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(resolution, resolution);
    for (let y = 0; y < resolution; y++) {
      const srcRow = (resolution - 1 - y) * resolution;    // GL rows are bottom-up
      for (let x = 0; x < resolution; x++) {
        const si = (srcRow + x) * 4, di = (y * resolution + x) * 4;
        img.data[di] = Math.round(srgb(aces(pixels[si] * exposure)) * 255);
        img.data[di + 1] = Math.round(srgb(aces(pixels[si + 1] * exposure)) * 255);
        img.data[di + 2] = Math.round(srgb(aces(pixels[si + 2] * exposure)) * 255);
        img.data[di + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    canvas.toBlob((blob) => downloadBlob(blob, `satmap-${resolution}.png`));
  }

  // Material masks in the heightmap frame: R exposed rock, G scree/gravel, B wetness/flow, A hardness.
  exportMasks() {
    if (!this.field) return;
    const { resolution: N, slope, deposit, flow, hardness } = this.field;
    const canvas = document.createElement('canvas');
    canvas.width = N; canvas.height = N;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const angle = Math.atan(slope[i]);
      const rock = Math.min(1, Math.max(0, (angle - 0.5) / 0.5));
      img.data[i * 4] = Math.round(rock * 255);
      img.data[i * 4 + 1] = Math.round(Math.min(1, deposit[i]) * 255);
      img.data[i * 4 + 2] = Math.round(Math.min(1, flow[i]) * 255);
      img.data[i * 4 + 3] = Math.round(Math.min(1, hardness[i]) * 255);
    }
    ctx.putImageData(img, 0, 0);
    canvas.toBlob((blob) => downloadBlob(blob, `splat-masks-${N}.png`));
  }

  exportNormalMap() {
    if (!this.field) return;
    const { resolution: N, height, worldSize } = this.field;
    const cell = worldSize / (N - 1);
    const canvas = document.createElement('canvas');
    canvas.width = N; canvas.height = N;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(N, N);
    for (let j = 0; j < N; j++) {
      const j0 = Math.max(0, j - 1), j1 = Math.min(N - 1, j + 1);
      for (let i = 0; i < N; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(N - 1, i + 1);
        const dx = (height[j * N + i1] - height[j * N + i0]) / ((i1 - i0) * cell);
        const dz = (height[j1 * N + i] - height[j0 * N + i]) / ((j1 - j0) * cell);
        const l = 1 / Math.hypot(dx, 1, dz);
        const k = (j * N + i) * 4;
        img.data[k] = Math.round((-dx * l * 0.5 + 0.5) * 255);
        img.data[k + 1] = Math.round((dz * l * 0.5 + 0.5) * 255);   // +Y up in texture space = -Z world
        img.data[k + 2] = Math.round((l * 0.5 + 0.5) * 255);
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    canvas.toBlob((blob) => downloadBlob(blob, `normalmap-${N}.png`));
  }

  screenshot() {
    this.renderer.render(this.scene, this.camera);
    this.canvas.toBlob((blob) => downloadBlob(blob, 'cliff-view.png'));
  }
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
