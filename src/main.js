import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import './style.css';

const canvas = document.querySelector('#terrain-canvas');
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x101912, 0.0115);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.25;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.1, 720);
camera.position.set(131, 94, 139);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.target.set(0, 10, 0);
controls.minDistance = 50;
controls.maxDistance = 300;
controls.minPolarAngle = 0.34;
controls.maxPolarAngle = Math.PI * 0.465;
controls.zoomSpeed = 0.72;
controls.panSpeed = 0.55;
controls.enablePan = false;

const world = new THREE.Group();
scene.add(world);

const hemi = new THREE.HemisphereLight(0x9ac0cc, 0x1b2817, 2.2);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xffd89b, 3.25);
sun.position.set(-104, 143, 55);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 400;
sun.shadow.camera.left = -145;
sun.shadow.camera.right = 145;
sun.shadow.camera.top = 145;
sun.shadow.camera.bottom = -145;
sun.shadow.bias = -0.00016;
scene.add(sun);
scene.add(sun.target);
sun.target.position.set(0, 0, 0);

const fillLight = new THREE.DirectionalLight(0x7c9eb4, 0.7);
fillLight.position.set(108, 54, -115);
scene.add(fillLight);

const terrainGroup = new THREE.Group();
world.add(terrainGroup);

const TERRAIN_SIZE = 212;
const DESKTOP_SEGMENTS = 192;
const MOBILE_SEGMENTS = 144;

const PRESETS = {
  alpine: {
    label: 'ALPINE ESCARPMENT',
    formations: ['Northern shelf', 'Moraine crown', 'Granite rampart', 'High valley wall'],
    copy: 'Layered alpine cliff',
    biome: 'highland',
    water: -30,
    terrainGain: 1.0,
    baseFrequency: 0.013,
    featureStyle: 'shelf',
    values: { height: 62, roughness: 0.68, scale: 1.1, cliffness: 0.84, strata: 0.58, erosion: 0.46 },
  },
  coastal: {
    label: 'COASTAL HEADLAND',
    formations: ['Windward headland', 'Tide-cut shelf', 'Saltstone bluff', 'West cape face'],
    copy: 'Weathered sea-cliff mesh',
    biome: 'basalt',
    water: -25,
    terrainGain: 0.72,
    baseFrequency: 0.014,
    featureStyle: 'coast',
    values: { height: 48, roughness: 0.54, scale: 1.24, cliffness: 0.91, strata: 0.47, erosion: 0.73 },
  },
  canyon: {
    label: 'CANYON ESCARPMENT',
    formations: ['Red river wall', 'Split mesa', 'Sundown strata', 'Dry gorge rim'],
    copy: 'Eroded canyon cliff mesh',
    biome: 'badlands',
    water: -34,
    terrainGain: 0.9,
    baseFrequency: 0.012,
    featureStyle: 'canyon',
    values: { height: 70, roughness: 0.6, scale: 1.0, cliffness: 0.88, strata: 0.82, erosion: 0.76 },
  },
};

const PALETTES = {
  highland: {
    low: new THREE.Color(0x25351b),
    grass: new THREE.Color(0x5d642c),
    dry: new THREE.Color(0x777040),
    soil: new THREE.Color(0x51432c),
    rock: new THREE.Color(0x504b43),
    rockLight: new THREE.Color(0x837864),
    snow: new THREE.Color(0xd4d5c1),
    rockBias: 0.0,
  },
  badlands: {
    low: new THREE.Color(0x4f3321),
    grass: new THREE.Color(0x855637),
    dry: new THREE.Color(0x9b6d43),
    soil: new THREE.Color(0x6c3f28),
    rock: new THREE.Color(0x6d4a37),
    rockLight: new THREE.Color(0xaf7955),
    snow: new THREE.Color(0xcebd9c),
    rockBias: 0.12,
  },
  basalt: {
    low: new THREE.Color(0x1e2f28),
    grass: new THREE.Color(0x385342),
    dry: new THREE.Color(0x68735b),
    soil: new THREE.Color(0x353b32),
    rock: new THREE.Color(0x30383a),
    rockLight: new THREE.Color(0x6c746d),
    snow: new THREE.Color(0xb7c2bb),
    rockBias: 0.2,
  },
};

const state = {
  activePreset: 'alpine',
  biome: 'highland',
  seed: '184720',
  height: 62,
  roughness: 0.68,
  scale: 1.1,
  cliffness: 0.84,
  strata: 0.58,
  erosion: 0.46,
  view: 'beauty',
};

let terrainGeometry;
let terrainMesh;
let boulderMesh;
let buildContext;
let buildTimeout;
let toastTimeout;
let currentStats = { vertices: 0, triangles: 0, segments: 0 };

const ui = {
  profileName: document.querySelector('#profile-name'),
  topMeshReadout: document.querySelector('#top-mesh-readout'),
  formationName: document.querySelector('#formation-name'),
  formationCopy: document.querySelector('#formation-copy'),
  meshStats: document.querySelector('#mesh-stats'),
  meshResolution: document.querySelector('#mesh-resolution'),
  cameraAlt: document.querySelector('#camera-alt'),
  cameraAz: document.querySelector('#camera-az'),
  renderStatus: document.querySelector('#render-status'),
  toast: document.querySelector('#toast'),
  seed: document.querySelector('#seed'),
  water: null,
};

const sliderKeys = ['height', 'roughness', 'scale', 'cliffness', 'strata', 'erosion'];
const sliders = Object.fromEntries(sliderKeys.map((key) => [key, document.querySelector(`#${key}`)]));
const outputs = Object.fromEntries(sliderKeys.map((key) => [key, document.querySelector(`#${key}-output`)]));

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function smootherstep(edge0, edge1, value) {
  const t = clamp((value - edge0) / (edge1 - edge0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function hash2(x, z, seed) {
  let value = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ Math.imul(seed, 1442695041);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function valueNoise(x, z, seed) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const tx = x - x0;
  const tz = z - z0;
  const u = tx * tx * (3 - 2 * tx);
  const v = tz * tz * (3 - 2 * tz);
  const a = hash2(x0, z0, seed);
  const b = hash2(x0 + 1, z0, seed);
  const c = hash2(x0, z0 + 1, seed);
  const d = hash2(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function fbm(x, z, seed, octaves = 5, gain = 0.5, lacunarity = 2.02) {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += (valueNoise(x * frequency, z * frequency, seed + octave * 1013) * 2 - 1) * amplitude;
    normalizer += amplitude;
    frequency *= lacunarity;
    amplitude *= gain;
  }
  return sum / normalizer;
}

function ridgedFbm(x, z, seed, octaves = 4) {
  let sum = 0;
  let amplitude = 0.52;
  let frequency = 1;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const signal = 1 - Math.abs(valueNoise(x * frequency, z * frequency, seed + octave * 733) * 2 - 1);
    sum += signal * signal * amplitude;
    normalizer += amplitude;
    frequency *= 2.07;
    amplitude *= 0.53;
  }
  return sum / normalizer;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function numericSeed(value) {
  const trimmed = String(value).trim();
  if (!trimmed) return 184720;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) >>> 0;
  return hashString(trimmed);
}

function createDetailTexture() {
  const size = 128;
  const pixels = new Uint8Array(size * size * 4);
  for (let z = 0; z < size; z += 1) {
    for (let x = 0; x < size; x += 1) {
      const fine = fbm(x / 13, z / 13, 92731, 4, 0.55, 2.05);
      const grain = valueNoise(x / 2.5, z / 2.5, 1717) * 2 - 1;
      const value = Math.round(clamp(0.55 + fine * 0.24 + grain * 0.11, 0.13, 0.92) * 255);
      const index = (z * size + x) * 4;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

const detailTexture = createDetailTexture();
const materialBeauty = new THREE.MeshStandardMaterial({
  vertexColors: true,
  roughness: 0.82,
  metalness: 0,
  bumpMap: detailTexture,
  bumpScale: 0.72,
  roughnessMap: detailTexture,
  dithering: true,
});
const materialAlbedo = new THREE.MeshBasicMaterial({ vertexColors: true });
const materialWire = new THREE.MeshBasicMaterial({
  color: 0xb8d4a6,
  wireframe: true,
  transparent: true,
  opacity: 0.94,
});
const rockMaterial = new THREE.MeshStandardMaterial({
  color: 0x756a54,
  roughness: 0.93,
  metalness: 0,
  vertexColors: true,
});
const rockGeometry = new THREE.DodecahedronGeometry(1, 1);

const waterGeometry = new THREE.PlaneGeometry(620, 620, 1, 1);
const waterMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x1b3a39,
  roughness: 0.24,
  metalness: 0.05,
  transparent: true,
  opacity: 0.62,
  clearcoat: 0.45,
  clearcoatRoughness: 0.28,
  side: THREE.DoubleSide,
});
const water = new THREE.Mesh(waterGeometry, waterMaterial);
water.rotation.x = -Math.PI / 2;
water.receiveShadow = true;
world.add(water);
ui.water = water;

const hazeGeometry = new THREE.PlaneGeometry(620, 620, 1, 1);
const hazeMaterial = new THREE.MeshBasicMaterial({
  color: 0x76949a,
  transparent: true,
  opacity: 0.07,
  depthWrite: false,
  side: THREE.DoubleSide,
});
const haze = new THREE.Mesh(hazeGeometry, hazeMaterial);
haze.rotation.x = -Math.PI / 2;
haze.position.y = -27.4;
world.add(haze);

function profile() {
  return PRESETS[state.activePreset];
}

function currentParams() {
  return {
    height: state.height,
    roughness: state.roughness,
    scale: state.scale,
    cliffness: state.cliffness,
    strata: state.strata,
    erosion: state.erosion,
  };
}

function buildFormations(seed, terrainProfile, params) {
  const random = mulberry32(seed ^ 0x7f4a7c15);
  const formations = [];
  const mainOffsetX = (random() - 0.5) * 13;
  const mainOffsetZ = (random() - 0.5) * 10 - 4;

  if (terrainProfile.featureStyle === 'canyon') {
    formations.push(
      { x: -43 + mainOffsetX * 0.35, z: -2 + mainOffsetZ * 0.3, a: 39 + random() * 8, b: 57 + random() * 10, angle: -0.28, amp: params.height * (0.64 + random() * 0.12), rim: 0.59 + random() * 0.06, seed: seed + 410, phase: random() * 10 },
      { x: 40 + mainOffsetX * 0.4, z: 6 + mainOffsetZ * 0.45, a: 34 + random() * 9, b: 54 + random() * 10, angle: 0.2, amp: params.height * (0.55 + random() * 0.12), rim: 0.61 + random() * 0.05, seed: seed + 920, phase: random() * 10 },
      { x: -4 + mainOffsetX, z: -55 + mainOffsetZ * 0.5, a: 34 + random() * 8, b: 21 + random() * 5, angle: -0.1, amp: params.height * 0.36, rim: 0.63, seed: seed + 1330, phase: random() * 10 },
    );
  } else if (terrainProfile.featureStyle === 'coast') {
    formations.push(
      { x: -7 + mainOffsetX, z: -1 + mainOffsetZ, a: 67 + random() * 10, b: 29 + random() * 8, angle: -0.2, amp: params.height * (0.68 + random() * 0.08), rim: 0.61 + random() * 0.05, seed: seed + 410, phase: random() * 10 },
      { x: 49 + mainOffsetX * 0.2, z: -45 + mainOffsetZ * 0.4, a: 26 + random() * 8, b: 20 + random() * 6, angle: 0.5, amp: params.height * 0.38, rim: 0.62, seed: seed + 920, phase: random() * 10 },
      { x: -57 + mainOffsetX * 0.2, z: 27 + mainOffsetZ * 0.4, a: 24 + random() * 6, b: 28 + random() * 7, angle: 0.4, amp: params.height * 0.34, rim: 0.6, seed: seed + 1330, phase: random() * 10 },
    );
  } else {
    formations.push(
      { x: -5 + mainOffsetX, z: -2 + mainOffsetZ, a: 52 + random() * 11, b: 38 + random() * 8, angle: -0.17 + random() * 0.28, amp: params.height * (0.64 + random() * 0.14), rim: 0.59 + random() * 0.05, seed: seed + 410, phase: random() * 10 },
      { x: 53 + mainOffsetX * 0.3, z: -31 + mainOffsetZ * 0.3, a: 25 + random() * 8, b: 28 + random() * 8, angle: 0.45, amp: params.height * (0.36 + random() * 0.1), rim: 0.62, seed: seed + 920, phase: random() * 10 },
      { x: -49 + mainOffsetX * 0.35, z: 28 + mainOffsetZ * 0.25, a: 26 + random() * 8, b: 24 + random() * 7, angle: -0.45, amp: params.height * (0.31 + random() * 0.1), rim: 0.6, seed: seed + 1330, phase: random() * 10 },
    );
  }

  return formations.map((formation) => ({
    ...formation,
    cos: Math.cos(formation.angle),
    sin: Math.sin(formation.angle),
  }));
}

function sampleTerrain(x, z, context) {
  const { params, seed, terrainProfile, formations } = context;
  const featureScale = params.scale;
  const frequency = terrainProfile.baseFrequency / featureScale;
  const warpStrength = 10 + params.roughness * 13;
  const warpX = fbm(x * frequency * 0.63 + 41, z * frequency * 0.63 - 13, seed + 71, 3, 0.54) * warpStrength;
  const warpZ = fbm(x * frequency * 0.63 - 77, z * frequency * 0.63 + 8, seed + 191, 3, 0.54) * warpStrength;
  const px = x + warpX;
  const pz = z + warpZ;

  const broad = fbm(px * frequency, pz * frequency, seed + 1, 5, 0.52);
  const hills = fbm(px * frequency * 2.9 + 19, pz * frequency * 2.9 - 9, seed + 121, 4, 0.5);
  const ridge = ridgedFbm(px * frequency * 1.14, pz * frequency * 1.14, seed + 251, 5);
  const smallRidge = ridgedFbm(px * frequency * 4.4, pz * frequency * 4.4, seed + 500, 3);

  let height = (broad * 0.34 + hills * 0.115 * (0.45 + params.roughness) + (ridge - 0.47) * 0.55) * params.height * terrainProfile.terrainGain;
  height += (smallRidge - 0.5) * params.height * params.roughness * 0.12;

  let rockMask = 0;
  let sedimentMask = 0;

  for (const formation of formations) {
    const dx = px - formation.x;
    const dz = pz - formation.z;
    const rotatedX = (dx * formation.cos + dz * formation.sin) / formation.a;
    const rotatedZ = (-dx * formation.sin + dz * formation.cos) / formation.b;
    const radial = Math.sqrt(rotatedX * rotatedX + rotatedZ * rotatedZ);
    if (radial > 1.45) continue;

    const edgeNoise = fbm((px + formation.seed * 0.01) * 0.065, (pz - formation.seed * 0.014) * 0.065, formation.seed, 3, 0.55) * 0.105;
    const rim = formation.rim + edgeNoise;
    const width = Math.max(0.03, 0.145 - params.cliffness * 0.108);
    const shelf = 1 - smootherstep(rim - width * 0.5, rim + width * 0.5, radial);
    const presence = 1 - smoothstep(0.72, 1.37, radial);
    const cliffBand = smoothstep(rim - width * 1.9, rim - width * 0.15, radial)
      * (1 - smoothstep(rim + width * 0.15, rim + width * 1.85, radial));

    const plateauGrain = fbm(px * 0.08 + 7, pz * 0.08 - 4, formation.seed + 209, 3, 0.56);
    height += formation.amp * shelf * presence;
    height += plateauGrain * formation.amp * shelf * 0.055;

    const verticalGullies = Math.pow(ridgedFbm(px * 0.105 + 14, pz * 0.105 - 9, formation.seed + 609, 3), 5.2);
    height -= verticalGullies * formation.amp * params.erosion * cliffBand * 0.17;

    const strataWave = Math.sin((height * 0.54) + rotatedX * 5.6 + formation.phase)
      + Math.sin((height * 1.18) - rotatedZ * 4.1 + formation.phase * 1.8) * 0.38;
    height += strataWave * params.strata * cliffBand * (1.15 + params.cliffness * 0.85);
    height += (fbm(px * 0.2, pz * 0.2, formation.seed + 991, 2) * 0.9) * params.strata * cliffBand;

    rockMask = Math.max(rockMask, cliffBand * 0.96 + (1 - shelf) * presence * 0.11);
    sedimentMask = Math.max(sedimentMask, (1 - shelf) * presence * 0.35);
  }

  if (terrainProfile.featureStyle === 'canyon') {
    const canyonPath = pz * 0.78 + px * 0.22 + fbm(px * 0.029, pz * 0.029, seed + 801, 3) * 15;
    const channel = Math.exp(-Math.pow(canyonPath / (12.5 * featureScale), 2));
    height -= channel * params.height * 0.62;
    const channelBank = Math.exp(-Math.pow((Math.abs(canyonPath) - 13 * featureScale) / (7.2 * featureScale), 2));
    rockMask = Math.max(rockMask, channelBank * 0.68);
    sedimentMask = Math.max(sedimentMask, channel * 0.7);
  }

  if (terrainProfile.featureStyle === 'coast') {
    const tideDirection = smoothstep(-90, 92, pz + fbm(px * 0.025, pz * 0.025, seed + 91, 2) * 15);
    height -= (1 - tideDirection) * params.height * 0.19;
    sedimentMask = Math.max(sedimentMask, 1 - tideDirection);
  }

  const drainage = Math.pow(ridgedFbm(px * frequency * 5.8 + 3, pz * frequency * 5.8 - 15, seed + 390, 3), 7);
  height -= drainage * params.erosion * params.height * (0.017 + rockMask * 0.065);

  const boundary = Math.max(Math.abs(x), Math.abs(z)) / (TERRAIN_SIZE * 0.5);
  const edgeFade = smootherstep(0.73, 0.985, boundary);
  const edgeHeight = terrainProfile.water + 3 + fbm(x * 0.045, z * 0.045, seed + 1005, 3) * 3;
  height = lerp(height, edgeHeight, edgeFade);

  return {
    height,
    rock: clamp(rockMask + (ridge - 0.56) * 0.22, 0, 1),
    sediment: clamp(sedimentMask, 0, 1),
  };
}

function colorForVertex(color, height, normalY, rockSignal, sedimentSignal, x, z, context) {
  const palette = PALETTES[state.biome];
  const { params, terrainProfile, seed } = context;
  const slope = clamp(1 - normalY, 0, 1);
  const micro = fbm(x * 0.11, z * 0.11, seed + 1703, 3, 0.52);
  const elevation = clamp((height - terrainProfile.water) / (params.height * 1.28), 0, 1);
  const lowland = 1 - smoothstep(0.1, 0.34, elevation);
  const dryland = smoothstep(0.34, 0.82, elevation);
  const steepness = smoothstep(0.11, 0.38, slope);
  const rock = clamp(steepness * 0.84 + rockSignal * 0.7 + palette.rockBias, 0, 1);

  color.copy(palette.grass).lerp(palette.low, lowland * 0.75);
  color.lerp(palette.dry, dryland * (0.38 + micro * 0.12));
  color.lerp(palette.soil, sedimentSignal * 0.5 + lowland * 0.14);
  color.lerp(palette.rock, rock * 0.92);
  color.lerp(palette.rockLight, clamp((rock - 0.38) * 0.7 + micro * 0.12, 0, 0.42));

  if (state.biome === 'highland') {
    const snow = smoothstep(0.86, 1.03, elevation) * (1 - smoothstep(0.16, 0.5, slope)) * 0.58;
    color.lerp(palette.snow, snow);
  }

  const variation = micro * 0.09;
  color.offsetHSL(variation * 0.09, variation * 0.13, variation * 0.12);
}

function buildTerrain() {
  const terrainProfile = profile();
  const params = currentParams();
  const seed = numericSeed(state.seed);
  const segments = window.innerWidth < 720 ? MOBILE_SEGMENTS : DESKTOP_SEGMENTS;
  const row = segments + 1;
  const vertices = row * row;
  const indicesCount = segments * segments * 6;
  const positions = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const indices = new Uint32Array(indicesCount);
  const rockSignals = new Float32Array(vertices);
  const sedimentSignals = new Float32Array(vertices);
  const formations = buildFormations(seed, terrainProfile, params);
  const context = { params, seed, terrainProfile, formations };

  let minHeight = Infinity;
  let maxHeight = -Infinity;
  let vertexIndex = 0;
  for (let iz = 0; iz <= segments; iz += 1) {
    const z = (iz / segments - 0.5) * TERRAIN_SIZE;
    for (let ix = 0; ix <= segments; ix += 1) {
      const x = (ix / segments - 0.5) * TERRAIN_SIZE;
      const sample = sampleTerrain(x, z, context);
      const positionOffset = vertexIndex * 3;
      positions[positionOffset] = x;
      positions[positionOffset + 1] = sample.height;
      positions[positionOffset + 2] = z;
      const uvOffset = vertexIndex * 2;
      uvs[uvOffset] = (ix / segments) * 7.5;
      uvs[uvOffset + 1] = (iz / segments) * 7.5;
      rockSignals[vertexIndex] = sample.rock;
      sedimentSignals[vertexIndex] = sample.sediment;
      minHeight = Math.min(minHeight, sample.height);
      maxHeight = Math.max(maxHeight, sample.height);
      vertexIndex += 1;
    }
  }

  let indexOffset = 0;
  for (let iz = 0; iz < segments; iz += 1) {
    for (let ix = 0; ix < segments; ix += 1) {
      const a = iz * row + ix;
      const b = a + row;
      const c = a + 1;
      const d = b + 1;
      indices[indexOffset] = a;
      indices[indexOffset + 1] = b;
      indices[indexOffset + 2] = c;
      indices[indexOffset + 3] = c;
      indices[indexOffset + 4] = b;
      indices[indexOffset + 5] = d;
      indexOffset += 6;
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(indices, 1));
  geometry.computeVertexNormals();

  const normal = geometry.getAttribute('normal');
  const color = new THREE.Color();
  for (let i = 0; i < vertices; i += 1) {
    const offset = i * 3;
    colorForVertex(
      color,
      positions[offset + 1],
      normal.getY(i),
      rockSignals[i],
      sedimentSignals[i],
      positions[offset],
      positions[offset + 2],
      context,
    );
    colors[offset] = color.r;
    colors[offset + 1] = color.g;
    colors[offset + 2] = color.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();

  if (terrainMesh) {
    terrainGroup.remove(terrainMesh);
    terrainGeometry.dispose();
  }
  if (boulderMesh) {
    terrainGroup.remove(boulderMesh);
    boulderMesh.dispose();
  }

  terrainGeometry = geometry;
  terrainMesh = new THREE.Mesh(geometry, viewMaterial());
  terrainMesh.castShadow = true;
  terrainMesh.receiveShadow = true;
  terrainGroup.add(terrainMesh);
  boulderMesh = createBoulders(context, minHeight, maxHeight);
  terrainGroup.add(boulderMesh);

  water.position.y = terrainProfile.water;
  haze.position.y = terrainProfile.water + 0.28;
  waterMaterial.color.set(state.biome === 'badlands' ? 0x3b3328 : state.biome === 'basalt' ? 0x203d3d : 0x1b3a39);
  buildContext = context;
  currentStats = { vertices, triangles: indicesCount / 3, segments };
  updateMeshReadout(minHeight, maxHeight);
  applyViewMode();
}

function createBoulders(context, minHeight) {
  const random = mulberry32(context.seed ^ 0xa9f1642d);
  const maximum = context.terrainProfile.featureStyle === 'canyon' ? 120 : 92;
  const mesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, maximum);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const euler = new THREE.Euler();
  const rockColor = new THREE.Color();
  let count = 0;
  let attempts = 0;

  while (count < maximum && attempts < maximum * 11) {
    attempts += 1;
    const x = (random() - 0.5) * TERRAIN_SIZE * 0.78;
    const z = (random() - 0.5) * TERRAIN_SIZE * 0.78;
    const sample = sampleTerrain(x, z, context);
    if (sample.height < context.terrainProfile.water + 2 || (sample.rock < 0.18 && random() < 0.66)) continue;
    const size = 0.18 + random() * random() * 1.45;
    position.set(x, sample.height + size * 0.28, z);
    euler.set((random() - 0.5) * 0.28, random() * Math.PI, (random() - 0.5) * 0.28);
    quaternion.setFromEuler(euler);
    scale.set(size * (0.65 + random() * 0.45), size * (0.45 + random() * 0.42), size * (0.65 + random() * 0.45));
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(count, matrix);
    rockColor.copy(PALETTES[state.biome].rock).lerp(PALETTES[state.biome].rockLight, random() * 0.35);
    mesh.setColorAt(count, rockColor);
    count += 1;
  }

  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  return mesh;
}

function viewMaterial() {
  if (state.view === 'albedo') return materialAlbedo;
  if (state.view === 'wire') return materialWire;
  return materialBeauty;
}

function applyViewMode() {
  if (!terrainMesh) return;
  terrainMesh.material = viewMaterial();
  const wire = state.view === 'wire';
  const albedo = state.view === 'albedo';
  if (boulderMesh) boulderMesh.visible = !wire;
  water.visible = !wire && !albedo;
  haze.visible = !wire && !albedo;
  scene.fog.density = wire || albedo ? 0.0075 : 0.0115;
  renderer.toneMappingExposure = albedo ? 1 : 1.25;
  ui.renderStatus.textContent = wire ? 'MODE: MESH TOPOLOGY' : albedo ? 'MODE: MATERIAL MAP' : 'LIGHTING: GOLDEN HOUR';
}

function updateMeshReadout(minHeight, maxHeight) {
  const { vertices, triangles, segments } = currentStats;
  ui.topMeshReadout.textContent = `${vertices.toLocaleString()} VERTICES`;
  ui.meshStats.textContent = `${triangles.toLocaleString()} TRIANGLES`;
  ui.meshResolution.textContent = `${segments + 1} × ${segments + 1} GRID · ${Math.round(maxHeight - minHeight)} M RANGE`;
  const terrainProfile = profile();
  const names = terrainProfile.formations;
  const formation = names[numericSeed(state.seed) % names.length];
  ui.formationName.textContent = formation;
  ui.formationCopy.textContent = `${terrainProfile.copy} / ${Math.round(maxHeight)} m`;
}

function updateCameraReadout() {
  const offset = camera.position.clone().sub(controls.target);
  const radius = offset.length();
  const azimuth = Math.atan2(offset.x, offset.z) * (180 / Math.PI);
  ui.cameraAlt.textContent = `${Math.round(radius)} m`;
  ui.cameraAz.textContent = `${Math.round((azimuth + 360) % 360)}°`;
}

function updateOutput(key) {
  const value = state[key];
  const formats = {
    height: `${Math.round(value)} m`,
    roughness: Number(value).toFixed(2),
    scale: `${Number(value).toFixed(2)}×`,
    cliffness: `${Math.round(value * 100)}%`,
    strata: Number(value).toFixed(2),
    erosion: Number(value).toFixed(2),
  };
  outputs[key].textContent = formats[key];
}

function syncControls() {
  for (const key of sliderKeys) {
    sliders[key].value = state[key];
    updateOutput(key);
  }
  ui.seed.value = state.seed;
  document.querySelectorAll('.preset').forEach((button) => {
    button.classList.toggle('active', button.dataset.preset === state.activePreset);
  });
  document.querySelectorAll('.biome-option').forEach((button) => {
    const active = button.dataset.biome === state.biome;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  ui.profileName.textContent = profile().label;
}

function scheduleBuild(delay = 120) {
  window.clearTimeout(buildTimeout);
  buildTimeout = window.setTimeout(() => {
    buildTerrain();
  }, delay);
}

function randomizeSeed() {
  state.seed = String(Math.floor(100000 + Math.random() * 899999));
  syncControls();
  buildTerrain();
  showToast('Fresh terrain seed generated');
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => ui.toast.classList.remove('show'), 2200);
}

function resetCamera() {
  camera.position.set(131, 94, 139);
  controls.target.set(0, 10, 0);
  controls.update();
  showToast('Camera reset to study angle');
}

function exportOBJ() {
  if (!terrainGeometry) return;
  const position = terrainGeometry.getAttribute('position');
  const index = terrainGeometry.getIndex();
  const lines = [
    '# Terrain Forge cliff mesh',
    `# seed ${state.seed} · ${profile().label.toLowerCase()}`,
    `# ${position.count} vertices · ${index.count / 3} triangles`,
    'o terrain_forge_landscape',
  ];
  for (let i = 0; i < position.count; i += 1) {
    lines.push(`v ${position.getX(i).toFixed(5)} ${position.getY(i).toFixed(5)} ${position.getZ(i).toFixed(5)}`);
  }
  for (let i = 0; i < index.count; i += 3) {
    lines.push(`f ${index.getX(i) + 1} ${index.getX(i + 1) + 1} ${index.getX(i + 2) + 1}`);
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `terrain-forge-${state.seed}.obj`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  showToast('OBJ mesh exported');
}

function setPreset(presetName) {
  const nextProfile = PRESETS[presetName];
  if (!nextProfile) return;
  state.activePreset = presetName;
  Object.assign(state, nextProfile.values);
  setBiome(nextProfile.biome, false);
  syncControls();
  buildTerrain();
  showToast(`${nextProfile.label.toLowerCase()} profile loaded`);
}

function setBiome(biome, regenerate = true) {
  if (!PALETTES[biome]) return;
  state.biome = biome;
  syncControls();
  if (regenerate) {
    buildTerrain();
    showToast(`${biome} material applied`);
  }
}

function setView(view) {
  state.view = view;
  document.querySelectorAll('.view-mode').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  applyViewMode();
}

for (const key of sliderKeys) {
  sliders[key].addEventListener('input', (event) => {
    state[key] = Number(event.target.value);
    updateOutput(key);
    scheduleBuild();
  });
}

document.querySelectorAll('.preset').forEach((button) => {
  button.addEventListener('click', () => setPreset(button.dataset.preset));
});

document.querySelectorAll('.biome-option').forEach((button) => {
  button.addEventListener('click', () => setBiome(button.dataset.biome));
});

document.querySelectorAll('.view-mode').forEach((button) => {
  button.addEventListener('click', () => setView(button.dataset.view));
});

document.querySelector('#generate-button').addEventListener('click', () => {
  buildTerrain();
  showToast('Terrain mesh regenerated');
});
document.querySelector('#random-button').addEventListener('click', randomizeSeed);
document.querySelector('#seed-refresh').addEventListener('click', () => {
  state.seed = ui.seed.value.trim() || '184720';
  ui.seed.value = state.seed;
  buildTerrain();
  showToast(`Generated seed ${state.seed}`);
});
ui.seed.addEventListener('change', () => {
  state.seed = ui.seed.value.trim() || '184720';
  ui.seed.value = state.seed;
  buildTerrain();
});
ui.seed.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    state.seed = ui.seed.value.trim() || '184720';
    ui.seed.value = state.seed;
    buildTerrain();
  }
});

document.querySelector('#export-button').addEventListener('click', exportOBJ);
document.querySelector('#camera-reset').addEventListener('click', resetCamera);

document.querySelector('#fullscreen-button').addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch {
    showToast('Fullscreen is unavailable in this preview');
  }
});

const helpModal = document.querySelector('#help-modal');
document.querySelector('#help-button').addEventListener('click', () => {
  helpModal.hidden = false;
});
document.querySelector('#help-close').addEventListener('click', () => {
  helpModal.hidden = true;
});
helpModal.addEventListener('click', (event) => {
  if (event.target === helpModal) helpModal.hidden = true;
});

document.addEventListener('keydown', (event) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (event.key === 'Escape') helpModal.hidden = true;
  if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
  if (event.key.toLowerCase() === 'g') {
    buildTerrain();
    showToast('Terrain mesh regenerated');
  }
  if (event.key.toLowerCase() === 'r') randomizeSeed();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

syncControls();
buildTerrain();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  updateCameraReadout();
  renderer.render(scene, camera);
}
animate();
