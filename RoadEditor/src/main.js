// main.js — Frontier road editor application.
// UI and chrome follow the Frontier Terrain Lab (streamlinkinbox/Frontier):
// same layout skeleton, components and viewport furniture. Geometry core lives
// in the pure, unit-tested modules spline.js / terrain.js / road.js.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';

import { icon } from './icons.js';
import { validateRoad } from './spline.js';
import { makeTerrainSampler, terrainHeightRange, defaultTerrainParams } from './terrain.js';
import {
  defaultRoadParams, sanitizeParams, sampleRoad, buildRoadMeshData,
  roadToJSON, parseRoadJSON, presetRoads,
} from './road.js';

// ── Icons (lucide markup inlined by icons.js, same set as the engine) ─────
document.querySelectorAll('[data-icon]').forEach((el) => { el.innerHTML = icon(el.dataset.icon); });

const $ = (id) => document.getElementById(id);

// ── Toast ─────────────────────────────────────────────────────────────────
let toastTimer;
function toast(text) {
  $('toast').textContent = text;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600);
}

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  name: 'Untitled road',
  points: [],
  params: { ...defaultRoadParams },
  terrain: {
    source: 'procedural', // procedural | obj
    seed: defaultTerrainParams.seed,
    size: defaultTerrainParams.size,
    height: defaultTerrainParams.height,
    roughness: defaultTerrainParams.roughness,
    objName: '',
  },
};
let dirty = false;
let selectedPoint = -1;
let editorMode = 'add'; // add | move
let showGizmos = true;
let snapToTerrain = true;

const history = { undo: [], redo: [] };
const HISTORY_LIMIT = 100;

function snapshot() {
  return JSON.stringify({
    name: state.name, points: state.points, params: state.params, terrain: state.terrain,
  });
}
function pushHistory() {
  history.undo.push(snapshot());
  if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
  history.redo.length = 0;
  updateHistoryButtons();
}
function restoreSnapshot(json) {
  const s = JSON.parse(json);
  state.name = s.name || 'Untitled road';
  state.points = Array.isArray(s.points) ? s.points : [];
  state.params = sanitizeParams(s.params || {});
  if (s.terrain) {
    state.terrain = {
      source: s.terrain.source === 'obj' ? 'obj' : 'procedural',
      seed: Number(s.terrain.seed) >>> 0 || 0,
      size: Number(s.terrain.size) || defaultTerrainParams.size,
      height: Number(s.terrain.height) || defaultTerrainParams.height,
      roughness: Number(s.terrain.roughness) ?? defaultTerrainParams.roughness,
      objName: typeof s.terrain.objName === 'string' ? s.terrain.objName : '',
    };
  }
  selectedPoint = -1;
}
function undo() {
  if (!history.undo.length) return;
  history.redo.push(snapshot());
  restoreSnapshot(history.undo.pop());
  updateHistoryButtons();
  afterStateChange('Undo');
}
function redo() {
  if (!history.redo.length) return;
  history.undo.push(snapshot());
  restoreSnapshot(history.redo.pop());
  updateHistoryButtons();
  afterStateChange('Redo');
}
function updateHistoryButtons() {
  $('undo').disabled = history.undo.length === 0;
  $('redo').disabled = history.redo.length === 0;
}

// ── Autosave (crash-safe local persistence) ───────────────────────────────
const AUTOSAVE_KEY = 'frontier-road-editor:v1';
let autosaveTimer;
function scheduleAutosave() {
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    try {
      localStorage.setItem(AUTOSAVE_KEY, snapshot());
    } catch { /* storage full or blocked — editing still works */ }
  }, 800);
}
function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return false;
    restoreSnapshot(raw);
    return true;
  } catch {
    return false;
  }
}
// ── Scene (engine chrome: same lights, fog, backdrop, render pacing) ──────
let renderer, scene, camera, controls;
let renderFrames = 4;
const invalidate = () => { renderFrames = 4; };
let glReady = false;

function initGL() {
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  $('canvas-container').appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', 'Interactive 3D road preview. Click the terrain to add control points in Add mode.');

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#252d23');
  scene.fog = new THREE.FogExp2('#252d23', 0.0016);

  camera = new THREE.PerspectiveCamera(36, 1, 0.015, 4000);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 0.5;
  controls.maxDistance = 3000;
  controls.maxPolarAngle = Math.PI * 0.485;
  controls.addEventListener('change', invalidate);

  const hemi = new THREE.HemisphereLight(0xe5ebef, 0x424036, 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff2df, 3);
  sun.position.set(-110, 125, 65);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -400; sun.shadow.camera.right = 400;
  sun.shadow.camera.top = 400; sun.shadow.camera.bottom = -400;
  sun.shadow.camera.far = 1200;
  sun.shadow.normalBias = 0.12;
  sun.shadow.bias = -0.0001;
  sun.shadow.radius = 3;
  scene.add(sun);
  state.sun = sun;
  const fill = new THREE.DirectionalLight(0xd0dbe3, 0.7);
  fill.position.set(80, 50, -100);
  scene.add(fill);

  // Backdrop plane + site grid, as in the engine.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000),
    new THREE.MeshStandardMaterial({ color: 0x20281f, roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.5;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(4800, 240, 0x46523b, 0x46523b);
  grid.position.y = -0.48;
  grid.material.transparent = true;
  grid.material.opacity = 0.14;
  scene.add(grid);

  glReady = true;
}

// ── Terrain ───────────────────────────────────────────────────────────────
let terrainMesh = null;   // procedural heightfield mesh
let terrainGroup = null;  // imported OBJ group
let terrainSampler = makeTerrainSampler(defaultTerrainParams);
const raycaster = new THREE.Raycaster();
const DOWN = new THREE.Vector3(0, -1, 0);

function terrainObjects() {
  if (state.terrain.source === 'obj' && terrainGroup) return [terrainGroup];
  return terrainMesh ? [terrainMesh] : [];
}

// Height of the terrain surface at (x, z). Analytic for the procedural
// heightfield (exact, instant); raycast for imported engine meshes.
function terrainHeightAt(x, z) {
  if (state.terrain.source === 'obj') {
    if (!terrainGroup) return 0;
    const top = terrainGroup.userData.top ?? 1000;
    raycaster.set(new THREE.Vector3(x, top + 100, z), DOWN);
    raycaster.far = top + 200;
    const hits = raycaster.intersectObject(terrainGroup, true);
    return hits.length ? hits[0].point.y : 0;
  }
  return terrainSampler(x, z);
}

function buildTerrain() {
  if (!scene) return;
  if (terrainMesh) { scene.remove(terrainMesh); terrainMesh.geometry.dispose(); terrainMesh.material.dispose(); terrainMesh = null; }
  if (state.terrain.source !== 'procedural') return;
  const { size, seed, height, roughness } = state.terrain;
  terrainSampler = makeTerrainSampler({ seed, size, height, roughness });
  const segments = Math.min(200, Math.max(64, Math.round(size / 2.5)));
  const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
  geometry.rotateX(-Math.PI / 2);
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color('#3f4c35'), mid = new THREE.Color('#77855a'), high = new THREE.Color('#9a927b');
  const { min, max } = terrainHeightRange(terrainSampler, size, 16);
  const range = Math.max(1e-6, max - min);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const y = terrainSampler(x, z);
    pos.setY(i, y);
    const t = Math.min(1, Math.max(0, (y - min) / range));
    if (t < 0.55) c.copy(low).lerp(mid, t / 0.55);
    else c.copy(mid).lerp(high, (t - 0.55) / 0.45);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  terrainMesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  terrainMesh.name = 'Terrain_heightfield';
  terrainMesh.receiveShadow = true;
  scene.add(terrainMesh);
  scene.fog.density = 0.64 / size;
  const bounds = size * 0.75;
  const sun = state.sun;
  sun.shadow.camera.left = -bounds; sun.shadow.camera.right = bounds;
  sun.shadow.camera.top = bounds; sun.shadow.camera.bottom = -bounds;
  sun.shadow.camera.far = bounds * 6;
  sun.position.set(-bounds * 0.8, bounds * 1.5, bounds * 0.6);
  sun.shadow.camera.updateProjectionMatrix();
  invalidate();
}

// ── Road meshes ───────────────────────────────────────────────────────────
let roadGroup = null;
let centerline = null;
let gizmoGroup = null;

const roadMaterials = {
  asphalt: new THREE.MeshStandardMaterial({ color: 0x2f3134, roughness: 0.95 }),
  shoulder: new THREE.MeshStandardMaterial({ color: 0x6e6353, roughness: 1 }),
  markEdges: new THREE.MeshStandardMaterial({ color: 0xe8e6da, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1 }),
  markDividers: new THREE.MeshStandardMaterial({ color: 0xe3c568, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1 }),
};

function stripMesh(strip, material, name) {
  if (!strip.indices.length) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(strip.positions, 3));
  geometry.setAttribute('uv', new THREE.BufferAttribute(strip.uvs, 2));
  geometry.setIndex(new THREE.BufferAttribute(strip.indices, 1));
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function clearRoadMeshes() {
  if (!roadGroup) return;
  scene.remove(roadGroup);
  roadGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  roadGroup = null;
  centerline = null;
  invalidate();
}

function applyRoadMeshes(meshData) {
  if (!scene) return;
  clearRoadMeshes();
  roadGroup = new THREE.Group();
  roadGroup.name = 'Road';
  const asphalt = stripMesh(meshData.asphalt, roadMaterials.asphalt, 'Road_Asphalt');
  const shoulder = stripMesh(meshData.shoulder, roadMaterials.shoulder, 'Road_Shoulder');
  const markEdges = stripMesh(meshData.markEdges, roadMaterials.markEdges, 'Road_EdgeLines');
  const markDividers = stripMesh(meshData.markDividers, roadMaterials.markDividers, 'Road_LaneDividers');
  if (asphalt) roadGroup.add(asphalt);
  if (shoulder) roadGroup.add(shoulder);
  if (markEdges) roadGroup.add(markEdges);
  if (markDividers) roadGroup.add(markDividers);
  if (meshData.centerline.length >= 2) {
    const lineGeometry = new THREE.BufferGeometry().setFromPoints(
      meshData.centerline.map((p) => new THREE.Vector3(p[0], p[1], p[2])),
    );
    centerline = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: 0xd5ec91, transparent: true, opacity: 0.85 }));
    centerline.name = 'Road_Centerline';
    roadGroup.add(centerline);
  }
  scene.add(roadGroup);
  invalidate();
}

// ── Control-point gizmos ──────────────────────────────────────────────────
function buildGizmos() {
  if (!scene) return;
  if (gizmoGroup) { scene.remove(gizmoGroup); gizmoGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); gizmoGroup = null; }
  gizmoGroup = new THREE.Group();
  gizmoGroup.name = 'ControlPoints';
  const sphereGeometry = new THREE.SphereGeometry(0.35, 16, 12);
  state.points.forEach((p, i) => {
    const selected = i === selectedPoint;
    const material = new THREE.MeshStandardMaterial({
      color: selected ? 0xf0f2e8 : 0xd5ec91,
      emissive: selected ? 0x556033 : 0x2a3517,
      emissiveIntensity: selected ? 0.6 : 0.5,
      roughness: 0.4,
    });
    const gizmo = new THREE.Mesh(sphereGeometry, material);
    gizmo.name = `ControlPoint_${i}`;
    gizmo.userData.pointIndex = i;
    gizmo.scale.setScalar(selected ? 1.35 : 1);
    gizmo.position.set(p.x, terrainHeightAt(p.x, p.z) + 0.45, p.z);
    gizmoGroup.add(gizmo);
  });
  gizmoGroup.visible = showGizmos;
  scene.add(gizmoGroup);
  invalidate();
}

// ── Picking ───────────────────────────────────────────────────────────────
const pointer = new THREE.Vector2();
function setPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}
function pickTerrain(event) {
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(terrainObjects(), true);
  return hits.length ? hits[0].point : null;
}
function pickGizmo(event) {
  if (!gizmoGroup || !gizmoGroup.visible) return -1;
  setPointer(event);
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(gizmoGroup, true);
  return hits.length ? hits[0].object.userData.pointIndex : -1;
}

// ── Interaction ───────────────────────────────────────────────────────────
let dragIndex = -1;
let dragMoved = false;
let dragHistoryPushed = false;
let downX = 0, downY = 0;

function onPointerDown(event) {
  if (!glReady || event.button !== 0) return;
  downX = event.clientX; downY = event.clientY;
  dragMoved = false;
  dragHistoryPushed = false;
  if (editorMode === 'move') {
    const hit = pickGizmo(event);
    if (hit >= 0) {
      dragIndex = hit;
      selectPoint(hit);
      controls.enabled = false;
      event.preventDefault();
    }
  }
}
function onPointerMove(event) {
  if (Math.hypot(event.clientX - downX, event.clientY - downY) > 4) dragMoved = true;
  if (dragIndex < 0 || !glReady) return;
  if (!dragHistoryPushed) { pushHistory(); dragHistoryPushed = true; } // one undo step per drag
  const hit = pickTerrain(event);
  if (!hit) return;
  const p = state.points[dragIndex];
  p.x = hit.x;
  p.z = hit.z;
  if (snapToTerrain) p.y = hit.y;
  scheduleRebuild();
}
function onPointerUp(event) {
  if (dragIndex >= 0) {
    controls.enabled = true;
    dragIndex = -1;
    dragHistoryPushed = false;
    rebuildRoad();
    scheduleAutosave();
    return;
  }
  if (!glReady || dragMoved) return;
  // Treat as a click.
  if (editorMode === 'add') {
    const hit = pickTerrain(event);
    if (!hit) { toast('Aim at the terrain to place a point.'); return; }
    addPoint(hit);
  } else {
    const hit = pickGizmo(event);
    selectPoint(hit); // -1 clears the selection
  }
}

function addPoint(hit) {
  const last = state.points[state.points.length - 1];
  if (last && Math.hypot(hit.x - last.x, hit.z - last.z) < 0.5) {
    toast('That point overlaps the previous one — move further away.');
    return;
  }
  pushHistory();
  state.points.push({ x: hit.x, y: snapToTerrain ? hit.y : 0, z: hit.z });
  markDirty();
  rebuildRoad();
  scheduleAutosave();
}

function selectPoint(index) {
  selectedPoint = index;
  buildGizmos();
  $('delete-point').disabled = index < 0;
  $('insert-point').disabled = index < 0;
}

// ── Build pipeline ────────────────────────────────────────────────────────
let rebuildScheduled = false;
function scheduleRebuild() {
  if (rebuildScheduled) return;
  rebuildScheduled = true;
  requestAnimationFrame(() => { rebuildScheduled = false; rebuildRoad(); });
}

function rebuildRoad() {
  const validation = validateRoad(state.points, { closed: state.params.closed });
  if (validation.errors.length) {
    clearRoadMeshes();
    state.stats = null;
    updateStatsUI(null);
    updateValidationUI(validation);
    updateSceneLabel();
    buildGizmos();
    return;
  }
  const t = performance.now();
  let meshData;
  try {
    const stations = sampleRoad(state.points, state.params, terrainHeightAt);
    meshData = buildRoadMeshData(stations, state.params);
  } catch (e) {
    console.error(e);
    toast('Could not build this road. Please adjust the points and try again.');
    return;
  }
  // Stats and validation update even without WebGL; only the scene needs GL.
  state.stats = meshData.stats;
  updateStatsUI(meshData.stats);
  updateValidationUI(validation);
  if (glReady) {
    applyRoadMeshes(meshData);
    updateSceneLabel();
    buildGizmos();
  }
  return performance.now() - t;
}

// Advisory only — surfaced in the validation status line, never a toast.
function gradeWarnings(stats) {
  if (!stats || stats.length < 2) return null;
  if (stats.maxGradePct > 25) return `Very steep — max grade ${stats.maxGradePct.toFixed(1)}%. Real roads stay under ~12%.`;
  if (stats.maxGradePct > 12) return `Steep road — max grade ${stats.maxGradePct.toFixed(1)}%.`;
  return null;
}

// ── UI updates ────────────────────────────────────────────────────────────
const rangeFormat = {
  width: (v) => `${v.toFixed(1)} <small>m</small>`,
  lanes: (v) => `${v}`,
  shoulderWidth: (v) => `${v.toFixed(1)} <small>m</small>`,
  banking: (v) => `${v}<small>%</small>`,
  maxBankAngle: (v) => `${v}<small>°</small>`,
  smoothing: (v) => `${v}<small>%</small>`,
  sampleLength: (v) => `${v.toFixed(1)} <small>m</small>`,
  rideHeight: (v) => `${v.toFixed(2)} <small>m</small>`,
  terrainSize: (v) => `${v} <small>m</small>`,
  terrainHeight: (v) => `${v} <small>m</small>`,
  roughness: (v) => `${v}<small>%</small>`,
};
const roadRangeIds = ['width', 'lanes', 'shoulderWidth', 'banking', 'maxBankAngle', 'smoothing', 'sampleLength'];
const terrainRangeIds = ['terrainSize', 'terrainHeight', 'roughness'];
const terrainRangeKeys = { terrainSize: 'size', terrainHeight: 'height', roughness: 'roughness' };

function updateRange(id) {
  const e = $(id);
  const p = ((e.value - e.min) / (e.max - e.min)) * 100;
  e.style.background = `linear-gradient(to right, #c4dba0 ${p}%, #454d3c ${p}%)`;
  $(`${id}-out`).innerHTML = (rangeFormat[id] || ((v) => `${v}`))(Number(e.value));
}

function syncInputs() {
  roadRangeIds.forEach((id) => { $(id).value = state.params[id]; updateRange(id); });
  terrainRangeIds.forEach((id) => { $(id).value = state.terrain[terrainRangeKeys[id]]; updateRange(id); });
  $('rideHeight').value = state.params.rideHeight; updateRange('rideHeight');
  $('markings').checked = state.params.markings;
  $('closed').checked = state.params.closed;
  $('elevation').value = state.params.elevation;
  $('seed').value = state.terrain.seed;
  $('terrainSource').value = state.terrain.source;
  updateTerrainSourceUI();
}

function updateTerrainSourceUI() {
  const procedural = state.terrain.source === 'procedural';
  $('procedural-controls').hidden = !procedural;
  $('obj-row').hidden = procedural;
  const chip = $('obj-chip');
  chip.hidden = procedural || !state.terrain.objName || !terrainGroup;
  if (!chip.hidden) $('obj-chip-name').textContent = state.terrain.objName;
}

function markDirty() {
  dirty = true;
  $('build-status').textContent = 'Parameters changed';
  $('project-dot').classList.add('dirty');
  invalidate();
}

function updateValidationUI(validation) {
  const el = $('validation');
  const gradeWarning = gradeWarnings(state.stats);
  if (validation.errors.length) {
    el.className = 'status-line err';
    el.innerHTML = `${icon('triangle-alert')} ${validation.errors[0]}`;
  } else if (validation.warnings.length) {
    el.className = 'status-line warn';
    el.innerHTML = `${icon('triangle-alert')} ${validation.warnings[0]}`;
  } else if (gradeWarning) {
    el.className = 'status-line warn';
    el.innerHTML = `${icon('gauge')} ${gradeWarning}`;
  } else if (state.points.length >= 2) {
    const stats = state.stats;
    el.className = 'status-line';
    el.innerHTML = stats
      ? `${icon('check')} ${state.points.length} points · ${stats.length.toFixed(1)} m · ${stats.triangles.toLocaleString()} triangles`
      : `${icon('check')} ${state.points.length} points · press Build road`;
  } else {
    el.className = 'status-line';
    el.innerHTML = `${icon('route')} ${state.points.length} point${state.points.length === 1 ? '' : 's'} · click the terrain to add more`;
  }
}

function updateStatsUI(stats) {
  $('stat-length').innerHTML = stats ? `${stats.length.toFixed(1)} <small>m</small>` : '—';
  $('stat-points').textContent = String(state.points.length).padStart(2, '0');
  $('stat-tris').textContent = stats ? stats.triangles.toLocaleString() : '—';
  $('stat-grade').innerHTML = stats && stats.length >= 2 ? `${stats.maxGradePct.toFixed(1)} <small>%</small>` : '—';
}

const ELEVATION_LABELS = { follow: 'FOLLOW TERRAIN', flat: 'CONSTANT HEIGHT', grade: 'END-TO-END GRADE' };
function updateSceneLabel() {
  const p = state.params;
  $('scene-subtitle').textContent =
    `${state.points.length} POINT${state.points.length === 1 ? '' : 'S'} · ${ELEVATION_LABELS[p.elevation]} · ${p.width.toFixed(1)} M · ${p.closed ? 'LOOP' : 'OPEN'}`;
}

function updateProjectUI() {
  $('project-name').textContent = state.name;
  $('workspace-name').textContent = state.name;
  document.title = `Frontier — ${state.name}`;
}

function afterStateChange(label) {
  syncInputs();
  updateProjectUI();
  rebuildRoad();
  scheduleAutosave();
  markDirty();
  if (label) toast(label);
}

// ── Camera ────────────────────────────────────────────────────────────────
function resetCamera(top = false) {
  if (!glReady) return;
  let box = new THREE.Box3();
  if (terrainMesh) box.setFromObject(terrainMesh);
  if (terrainGroup) box.union(new THREE.Box3().setFromObject(terrainGroup));
  if (roadGroup) box.union(new THREE.Box3().setFromObject(roadGroup));
  if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(400, 40, 400));
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  controls.target.copy(sphere.center);
  const size = state.terrain.source === 'procedural' ? state.terrain.size : Math.max(sphere.radius * 2, 100);
  const direction = new THREE.Vector3(top ? 0.001 : 0.7, top ? 3.4 : 0.8, top ? 0 : 2.5).normalize();
  const halfVertical = THREE.MathUtils.degToRad(camera.fov / 2);
  const halfHorizontal = Math.atan(Math.tan(halfVertical) * camera.aspect);
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  let distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    const offset = new THREE.Vector3(x, y, z).sub(controls.target);
    distance = Math.max(distance, offset.dot(direction) + Math.max(Math.abs(offset.dot(right)) / Math.tan(halfHorizontal), Math.abs(offset.dot(up)) / Math.tan(halfVertical)));
  }
  distance = Math.max(distance * 1.22, size * 0.4);
  camera.position.copy(controls.target).addScaledVector(direction, distance);
  controls.maxDistance = Math.max(3000, distance * 3);
  camera.far = Math.max(4000, distance * 8);
  camera.updateProjectionMatrix();
  camera.lookAt(controls.target);
  controls.update();
  invalidate();
  $('top-view').classList.toggle('active', top);
  $('orbit-view').classList.toggle('active', !top);
}

// ── Wire the panel ────────────────────────────────────────────────────────
function wirePanel() {
  roadRangeIds.forEach((id) => {
    updateRange(id);
    $(id).addEventListener('input', () => {
      state.params[id] = Number($(id).value);
      updateRange(id);
      markDirty();
      scheduleAutosave();
    });
  });
  terrainRangeIds.forEach((id) => {
    updateRange(id);
    $(id).addEventListener('input', () => {
      state.terrain[terrainRangeKeys[id]] = Number($(id).value);
      updateRange(id);
      markDirty();
      if (state.terrain.source === 'procedural') buildTerrain();
      scheduleAutosave();
    });
  });
  $('rideHeight').addEventListener('input', () => {
    state.params.rideHeight = Number($('rideHeight').value);
    updateRange('rideHeight');
    markDirty();
    scheduleAutosave();
  });
  $('markings').addEventListener('change', () => { state.params.markings = $('markings').checked; markDirty(); scheduleAutosave(); });
  $('closed').addEventListener('change', () => { state.params.closed = $('closed').checked; markDirty(); rebuildRoad(); scheduleAutosave(); });
  $('elevation').addEventListener('change', () => { state.params.elevation = $('elevation').value; markDirty(); rebuildRoad(); scheduleAutosave(); });
  $('seed').addEventListener('input', () => {
    state.terrain.seed = Math.max(0, Math.min(999999, Number($('seed').value) || 0));
    $('seed').value = state.terrain.seed;
    markDirty();
    if (state.terrain.source === 'procedural') buildTerrain();
    scheduleAutosave();
  });
  $('randomize').addEventListener('click', () => {
    state.terrain.seed = Math.floor(Math.random() * 1000000);
    $('seed').value = state.terrain.seed;
    markDirty();
    if (state.terrain.source === 'procedural') buildTerrain();
    scheduleAutosave();
  });
  $('terrainSource').addEventListener('change', () => {
    const next = $('terrainSource').value;
    if (next === 'obj' && !terrainGroup) {
      toast('Load an engine OBJ first — the file picker is in this section.');
      $('terrainSource').value = 'procedural';
      return;
    }
    state.terrain.source = next;
    updateTerrainSourceUI();
    markDirty();
    rebuildRoad();
    scheduleAutosave();
  });

  // Editing mode
  const setMode = (mode) => {
    editorMode = mode;
    $('mode-add').setAttribute('aria-pressed', String(mode === 'add'));
    $('mode-move').setAttribute('aria-pressed', String(mode === 'move'));
    $('nav-hint-action').textContent = mode === 'add' ? 'Click to add points' : 'Click a handle to select';
    invalidate();
  };
  $('mode-add').addEventListener('click', () => setMode('add'));
  $('mode-move').addEventListener('click', () => setMode('move'));
  $('snap').addEventListener('change', () => {
    snapToTerrain = $('snap').checked;
    $('toggle-snap').setAttribute('aria-pressed', String(snapToTerrain));
    $('toggle-snap').classList.toggle('active', snapToTerrain);
  });
  $('gizmos').addEventListener('change', () => {
    showGizmos = $('gizmos').checked;
    $('toggle-gizmos').setAttribute('aria-pressed', String(showGizmos));
    $('toggle-gizmos').classList.toggle('active', showGizmos);
    if (gizmoGroup) { gizmoGroup.visible = showGizmos; invalidate(); }
  });
  $('toggle-gizmos').addEventListener('click', () => { $('gizmos').checked = !showGizmos; $('gizmos').dispatchEvent(new Event('change')); });
  $('toggle-snap').addEventListener('click', () => { $('snap').checked = !snapToTerrain; $('snap').dispatchEvent(new Event('change')); });

  // Tools
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('delete-point').addEventListener('click', () => {
    if (selectedPoint < 0) { toast('Select a control point first (Select & move mode).'); return; }
    pushHistory();
    state.points.splice(selectedPoint, 1);
    selectedPoint = -1;
    markDirty();
    rebuildRoad();
    scheduleAutosave();
    toast('Control point deleted');
  });
  $('insert-point').addEventListener('click', () => {
    if (selectedPoint < 0) { toast('Select a control point first (Select & move mode).'); return; }
    pushHistory();
    const i = selectedPoint;
    const a = state.points[i];
    let next;
    if (i + 1 < state.points.length) next = state.points[i + 1];
    else if (state.params.closed && state.points.length > 1) next = state.points[0];
    else if (state.points.length > 1) {
      const prev = state.points[i - 1];
      next = { x: a.x + (a.x - prev.x), y: a.y, z: a.z + (a.z - prev.z) };
    } else next = { x: a.x + 10, y: a.y, z: a.z };
    const mid = { x: (a.x + next.x) / 2, y: (a.y + next.y) / 2, z: (a.z + next.z) / 2 };
    mid.y = terrainHeightAt(mid.x, mid.z);
    state.points.splice(i + 1, 0, mid);
    selectedPoint = i + 1;
    markDirty();
    rebuildRoad();
    scheduleAutosave();
    toast('Control point inserted');
  });
  $('clear-road').addEventListener('click', () => {
    if (!state.points.length) { toast('The road is already empty.'); return; }
    pushHistory();
    state.points = [];
    selectedPoint = -1;
    markDirty();
    rebuildRoad();
    scheduleAutosave();
    toast('Road cleared');
  });

  // Build
  $('build').addEventListener('click', () => {
    $('build').disabled = true;
    $('build-status').textContent = 'Building road geometry…';
    requestAnimationFrame(() => requestAnimationFrame(() => {
      try {
        const ms = rebuildRoad();
        if (ms !== undefined && state.stats) {
          dirty = false;
          $('build-status').textContent = 'Road built';
          $('project-dot').classList.remove('dirty');
          $('build-time').textContent = `${(ms / 1000).toFixed(2)}s`;
          toast(`Road built · ${state.stats.length.toFixed(0)} m · ${state.stats.triangles.toLocaleString()} triangles`);
        } else {
          $('build-status').textContent = 'Check the road points';
          $('build-time').textContent = '—';
        }
      } catch (e) {
        console.error(e);
        toast('Could not build this road. Please try again.');
      } finally {
        $('build').disabled = false;
      }
    }));
  });

  // Presets
  $('preset').addEventListener('click', () => { $('preset-menu').hidden = !$('preset-menu').hidden; });
  const presetMeta = {
    straight: ['Straight haul road', 'Open · two points'],
    valley: ['Valley crossing', 'Open · asphalt ribbon'],
    switchback: ['Switchback climb', 'Open · hairpins'],
    circuit: ['Closed circuit', 'Loop · banked corners'],
  };
  document.querySelectorAll('[data-preset]').forEach((btn) => {
    btn.addEventListener('click', () => {
      pushHistory();
      const preset = presetRoads(btn.dataset.preset, terrainHeightAt, state.terrain.size);
      state.points = preset.points;
      state.params.closed = preset.closed;
      selectedPoint = -1;
      $('preset-name').textContent = presetMeta[btn.dataset.preset][0];
      $('preset-kind').textContent = presetMeta[btn.dataset.preset][1];
      $('preset-menu').hidden = true;
      afterStateChange(`Preset loaded · ${presetMeta[btn.dataset.preset][0]}`);
    });
  });

  // Viewport toolbar
  $('top-view').addEventListener('click', () => resetCamera(true));
  $('orbit-view').addEventListener('click', () => resetCamera());
  $('reset-view').addEventListener('click', () => { controls.autoRotate = false; $('rotate').classList.remove('active'); resetCamera(); toast('Camera reset'); });
  let wireframe = false;
  $('wireframe').addEventListener('click', () => {
    invalidate();
    wireframe = !wireframe;
    $('wireframe').classList.toggle('active', wireframe);
    scene.traverse((o) => {
      if (o.isMesh && o.material && !(gizmoGroup && gizmoGroup.contains(o))) o.material.wireframe = wireframe;
    });
  });
  $('rotate').addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    controls.autoRotateSpeed = 0.6;
    $('rotate').classList.toggle('active', controls.autoRotate);
  });
  $('help').addEventListener('click', () => { $('help-panel').hidden = !$('help-panel').hidden; });
  $('about').addEventListener('click', (e) => { e.preventDefault(); toast('Frontier · Geometry-first road tools. Built locally in your browser.'); });
  $('screenshot').addEventListener('click', () => {
    if (!glReady) return;
    renderer.render(scene, camera);
    renderer.domElement.toBlob((blob) => {
      if (blob) { download(blob, `${slug(state.name)}.png`); toast('Screenshot saved'); }
    });
  });

  // Export menu
  $('export').addEventListener('click', () => { $('export-menu').hidden = !$('export-menu').hidden; });
  document.addEventListener('click', (e) => {
    if (!$('export-menu').hidden && !$('export-menu').contains(e.target) && e.target !== $('export') && !$('export').contains(e.target)) {
      $('export-menu').hidden = true;
    }
  });
  $('export-obj').addEventListener('click', () => { $('export-menu').hidden = true; exportOBJ(); });
  $('export-json').addEventListener('click', () => { $('export-menu').hidden = true; exportProject(); });
  $('import-json').addEventListener('click', () => { $('export-menu').hidden = true; $('project-file').click(); });

  // OBJ terrain import
  $('load-obj').addEventListener('click', () => $('obj-file').click());
  $('obj-file').addEventListener('change', onObjFile);
  $('obj-clear').addEventListener('click', () => {
    if (terrainGroup) {
      scene.remove(terrainGroup);
      terrainGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
      terrainGroup = null;
    }
    state.terrain.source = 'procedural';
    state.terrain.objName = '';
    $('terrainSource').value = 'procedural';
    updateTerrainSourceUI();
    buildTerrain();
    markDirty();
    rebuildRoad();
    scheduleAutosave();
    toast('Loaded mesh removed · procedural terrain restored');
  });

  // Project import
  $('project-file').addEventListener('change', onProjectFile);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Delete' || e.key === 'Backspace') { $('delete-point').click(); }
    else if (e.key.toLowerCase() === 'i') { $('insert-point').click(); }
    else if (e.key.toLowerCase() === 'b') { $('build').click(); }
    else if (e.key.toLowerCase() === 'a') { setMode('add'); }
    else if (e.key.toLowerCase() === 'm') { setMode('move'); }
    else if (e.key === 'Escape') { selectPoint(-1); }
    else if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (e.key.toLowerCase() === 'y' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); redo(); }
  });
}

// ── Import / export ───────────────────────────────────────────────────────
function onObjFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const group = new OBJLoader().parse(String(reader.result));
      let triangles = 0;
      group.traverse((o) => { if (o.isMesh && o.geometry) triangles += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
      const box = new THREE.Box3().setFromObject(group);
      const size = box.getSize(new THREE.Vector3()).length();
      if (!Number.isFinite(size) || size < 1e-6) throw new Error('empty mesh');
      if (size > 5000) toast('That mesh is very large — draping the road may take a moment.');
      // Rest on y = 0, matching the procedural terrain's sea level.
      group.position.y -= box.min.y;
      group.updateMatrixWorld(true);
      if (terrainGroup) { scene.remove(terrainGroup); terrainGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
      terrainGroup = group;
      terrainGroup.name = 'Terrain_imported';
      terrainGroup.userData.top = box.max.y - box.min.y;
      scene.add(terrainGroup);
      terrainGroup.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          if (o.material) {
            o.material.vertexColors = false;
            o.material.color.set('#6d7a5e');
            o.material.roughness = 0.95;
            o.material.needsUpdate = true;
          }
        }
      });
      state.terrain.source = 'obj';
      state.terrain.objName = `${file.name} · ${Math.round(triangles).toLocaleString()} tris`;
      $('terrainSource').value = 'obj';
      updateTerrainSourceUI();
      markDirty();
      rebuildRoad();
      scheduleAutosave();
      resetCamera();
      toast(`Loaded ${file.name} · ${Math.round(triangles).toLocaleString()} triangles`);
    } catch (err) {
      console.error(err);
      toast('Could not read that OBJ file.');
    }
  };
  reader.onerror = () => toast('Could not read that file.');
  reader.readAsText(file);
}

function onProjectFile(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseRoadJSON(String(reader.result));
      const raw = JSON.parse(String(reader.result));
      pushHistory();
      state.name = parsed.name;
      state.points = parsed.points;
      state.params = parsed.params;
      if (raw.terrain && raw.terrain.source === 'procedural') {
        state.terrain = { ...state.terrain, ...raw.terrain, source: 'procedural', objName: '' };
      } else if (raw.terrain && raw.terrain.source === 'obj') {
        toast('This project was saved with a loaded mesh — load its OBJ again to drape the road.');
      }
      selectedPoint = -1;
      if (state.terrain.source === 'procedural') buildTerrain();
      updateProjectUI();
      syncInputs();
      rebuildRoad();
      scheduleAutosave();
      resetCamera();
      toast(`Loaded project · ${parsed.name}`);
    } catch (err) {
      toast(err.message || 'Could not load that project.');
    }
  };
  reader.onerror = () => toast('Could not read that file.');
  reader.readAsText(file);
}

function slug(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'road';
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function exportOBJ() {
  if (!roadGroup || !state.stats) { toast('Build the road first — nothing to export.'); return; }
  $('export').disabled = true;
  toast('Preparing OBJ geometry…');
  setTimeout(() => {
    try {
      const exporter = new OBJExporter();
      const exportGroup = new THREE.Group();
      roadGroup.updateMatrixWorld(true);
      roadGroup.traverse((o) => {
        if (o.isMesh && o.name.startsWith('Road_')) {
          const m = new THREE.Mesh(o.geometry, o.material);
          m.matrix.copy(o.matrixWorld);
          m.matrixAutoUpdate = false;
          m.name = o.name;
          exportGroup.add(m);
        }
      });
      const output = exporter.parse(exportGroup);
      const header = [
        `# Frontier road | units: meters | Y-up`,
        `# Name: ${state.name}`,
        `# Parameters: ${JSON.stringify(state.params)}`,
        `# Stats: ${JSON.stringify(state.stats)}`,
        `# Control points: ${state.points.length} · length ${state.stats.length.toFixed(2)} m`,
        `# Geometry only — rebuild the centerline from the matching .json project for editing.`,
        '',
      ].join('\n');
      download(new Blob([header, output], { type: 'text/plain' }), `frontier-road-${slug(state.name)}.obj`);
      toast('OBJ exported · geometry only');
    } catch (e) {
      console.error(e);
      toast('Export failed. Try a smaller road.');
    } finally {
      $('export').disabled = false;
    }
  }, 70);
}

function exportProject() {
  const project = {
    ...roadToJSON({ name: state.name, points: state.points, params: state.params, stats: state.stats || null }),
    terrain: state.terrain,
  };
  download(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }), `frontier-road-${slug(state.name)}.json`);
  toast('Road project saved · reload it from the Export menu');
}

// ── Viewport loop (engine render pacing + live scale ruler) ───────────────
function startLoop() {
  const scaleStart = new THREE.Vector3(), scaleEnd = new THREE.Vector3(), cameraRight = new THREE.Vector3();
  renderer.setAnimationLoop(() => {
    controls.update();
    if (renderFrames <= 0 && !controls.autoRotate) return;
    renderFrames--;
    // A true 10 m screen-space ruler at the orbit target, updated as the camera zooms.
    const distance = camera.position.distanceTo(controls.target);
    const ruler = distance < 3 ? 0.05 : distance < 15 ? 0.5 : 10;
    document.querySelector('.scale').lastChild.textContent = distance < 3 ? '5 CENTIMETERS' : distance < 15 ? '50 CENTIMETERS' : '10 METERS';
    cameraRight.setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(ruler);
    scaleStart.copy(controls.target).project(camera);
    scaleEnd.copy(controls.target).add(cameraRight).project(camera);
    document.querySelector('.scale > span').style.width = `${Math.abs(scaleEnd.x - scaleStart.x) * renderer.domElement.clientWidth / 2}px`;
    renderer.render(scene, camera);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────
function boot() {
  wirePanel();
  try {
    initGL();
  } catch (e) {
    console.error(e);
    $('webgl-fallback').hidden = false;
    toast('WebGL is unavailable — the 3D preview cannot start.');
    syncInputs();
    updateProjectUI();
    updateHistoryButtons();
    selectPoint(-1);
    updateValidationUI(validateRoad(state.points, { closed: state.params.closed }));
    updateStatsUI(null);
    return;
  }
  const restored = loadAutosave();
  if (!restored) {
    // First run: lay a sample road so the viewport is never empty.
    const preset = presetRoads('valley', makeTerrainSampler(defaultTerrainParams), defaultTerrainParams.size);
    state.points = preset.points;
    state.terrain = { ...state.terrain, ...defaultTerrainParams };
  }
  buildTerrain();
  syncInputs();
  updateProjectUI();
  updateHistoryButtons();
  selectPoint(-1);
  rebuildRoad();
  resetCamera();
  startLoop();

  if (renderer?.domElement) {
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }
  new ResizeObserver(() => {
    const box = $('canvas-container').getBoundingClientRect();
    const oldAspect = camera.aspect;
    renderer.setSize(box.width, box.height);
    camera.aspect = box.width / box.height;
    camera.updateProjectionMatrix();
    if (Math.abs(oldAspect - camera.aspect) > 0.01) resetCamera($('top-view').classList.contains('active'));
    invalidate();
  }).observe($('canvas-container'));

  if (restored) {
    toast('Restored your unsaved road from this browser');
    if (state.terrain.source === 'obj') toast('This road was saved with a loaded mesh — load its OBJ again to drape it.');
  } else {
    toast('Sample road loaded · draw over it, or clear it and start fresh');
  }
  scheduleAutosave();
}

boot();
