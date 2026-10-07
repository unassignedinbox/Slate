// Entry: wires the editor chrome to the heightfield worker and the Three.js viewport.
import { defaults, presets, groups, stageOf, palettes, paletteKeys } from './params.js';
import { Editor } from './ui.js';
import { CliffScene } from './scene.js';

const STORAGE_KEY = 'frontier-cliff-generator';
const SCHEMA = 3; // bump when parameter semantics change so stale saved values do not override new defaults

function readStored() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); } catch { return {}; }
}

const stored = readStored();
const storedValues = stored.schema === SCHEMA ? stored.values || {} : {};
const values = { ...defaults, ...presets['Alpine granite'], ...storedValues };

function applyPalette(name) {
  const p = palettes[name];
  if (!p) return;
  values.palette = name;
  for (const k of paletteKeys) values[k] = p[k];
}

let scene = null;
let worker = null;
let generation = 0;
let rockTimer = 0;
let lastField = null;

const editor = new Editor(document.getElementById('root'), {
  values,
  onChange(key, val) {
    values[key] = val;
    if (key === 'palette') applyPalette(val);
    persist();
    const stage = stageOf(key);
    if (stage === 'terrain') editor.setPending(true);
    else if (stage === 'rocks') scheduleRocks();
    else if (stage === 'mesh') scheduleMesh();
    else applyLive();
    // some live keys also affect rock placement (water) or need camera re-frame (nothing yet)
    if (key === 'seaLevel' || key === 'waterEnabled') scheduleRocks();
  },
  onPreset(name) {
    Object.assign(values, defaults, presets[name]);
    applyPalette(values.palette);
    persist();
    applyLive();
    generate();
  },
  onGenerate: () => generate(),
  onReset(group) {
    for (const card of group.cards) for (const [key] of card.controls || []) values[key] = defaults[key];
    if (group.id === 'material') applyPalette(defaults.palette);
    persist();
    if (group.stage === 'terrain') editor.setPending(true);
    else if (group.stage === 'rocks') scheduleRocks();
    else if (group.stage === 'mesh') scheduleMesh();
    else applyLive();
  },
  onAction(action) {
    if (!scene) return;
    if (action === 'frame') scene.frameCamera(values);
    if (action === 'screenshot') scene.screenshot();
    if (action === 'export-obj') scene.exportOBJ(true);
    if (action === 'export-glb') scene.exportGLB(true);
    if (action === 'export-heightmap') scene.exportHeightmap();
    if (action === 'export-satmap') scene.exportSatmap(2048);
    if (action === 'export-masks') scene.exportMasks();
    if (action === 'export-normal') scene.exportNormalMap();
  },
});

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ schema: SCHEMA, values })); } catch { /* private mode */ }
}

function applyLive() {
  if (!scene) return;
  scene.setSurface(values);
  scene.setSky(values);
  scene.setWater(values);
  scene.setDisplay(values);
}

function scheduleRocks() {
  clearTimeout(rockTimer);
  rockTimer = setTimeout(() => {
    if (!scene || !lastField) return;
    const t0 = performance.now();
    scene.setRocks(values);
    updateStats({ rockMs: performance.now() - t0 });
  }, 350);
}

let meshTimer = 0;
function scheduleMesh() {
  clearTimeout(meshTimer);
  meshTimer = setTimeout(() => {
    if (!scene || !lastField) return;
    scene.rebuildMesh(values);
    updateStats();
  }, 400);
}

const statCache = {};
function updateStats(extra = {}) {
  Object.assign(statCache, extra);
  if (!lastField) return;
  editor.setStats({
    'Grid': `${lastField.resolution}²${scene.meshField && scene.meshField !== lastField ? ` → ${scene.meshField.resolution}²` : ''} · ${values.worldSize} m`,
    'Triangles': (scene.stats.triangles + scene.rockGroup.children.reduce((n, m) => n + (m.geometry.getAttribute('position').count / 3) * m.count, 0)).toLocaleString('en-US', { maximumFractionDigits: 0 }),
    'Rocks': scene.rockCount.toLocaleString('en-US'),
    'Relief': `${lastField.stats.min.toFixed(0)} – ${lastField.stats.max.toFixed(0)} m`,
    'Heightfield': `${(lastField.stats.elapsedMs / 1000).toFixed(1)} s`,
  });
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./generate.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.id !== generation) return;
    if (msg.type === 'progress') editor.setProgress(msg.phase, msg.fraction);
    if (msg.type === 'error') {
      editor.setProgress(null);
      console.error(msg.message);
      alert(`Generation failed:\n${msg.message}`);
    }
    if (msg.type === 'done') {
      lastField = msg.result;
      editor.setProgress('Building surface', 1);
      requestAnimationFrame(() => {
        scene.setField(lastField, values);
        scene.setSurface(values);
        scene.setDisplay(values);
        scene.setRocks(values);
        editor.setProgress(null);
        editor.setPending(false);
        updateStats();
      });
    }
  };
  worker.onerror = (e) => { editor.setProgress(null); console.error(e); alert(`Worker error: ${e.message}`); };
  return worker;
}

function generate() {
  generation += 1;
  editor.setProgress('Starting', 0);
  const params = { ...values };
  // Scale droplet count with resolution so erosion intensity is resolution-independent.
  params.droplets = Math.round(values.droplets * (values.resolution * values.resolution) / (512 * 512));
  ensureWorker().postMessage({ id: generation, params });
}

function boot() {
  try {
    scene = new CliffScene(editor.canvas);
  } catch (error) {
    document.querySelector('.canvas-wrap').innerHTML = `<div class="empty">WebGL 2 is required to run the cliff generator.<br>${error.message}</div>`;
    return;
  }
  applyLive();
  generate();
}

boot();
