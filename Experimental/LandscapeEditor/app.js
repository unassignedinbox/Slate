// Landscape editor — Frontier Editor shell (layer stack · viewport · inspector).
import { icon } from './icons.js';
import {
  layerKinds, layerCategory, layerDefaults, generatorKinds, filterKinds,
  blendModes, maskKinds,
} from './heightfield.js';
import { compositeStack, computeSignals } from './terrain.js';
import { satSources, satBlends, satLayerDefaults, compositeSatmap, signalImage } from './satmap.js';
import { presets, makeDocument } from './presets.js';
import { Viewport } from './viewport.js';
import * as gfx from './graphics.js';

const VIEW_MODES = [
  ['Satmap', 'Image'], ['Height', 'Terrain'], ['Slope', 'Cliff'], ['Flow', 'Flow'],
  ['Sediment', 'Grain'], ['Hillshade', 'Gauge'], ['Normals', 'Globe'],
];

const CATEGORY_LABEL = {
  base: 'Base shape', generator: 'Generator', erosion: 'Erosion simulation', filter: 'Filter',
};

const state = {
  doc: makeDocument(presets[0]),
  selected: 'terrain',
  query: '',
  hidden: {},
  saved: true,
  viewMode: 0,
  busy: null,
  addMenu: false,
  addStep: null,
  presetMenu: false,
  features: {},
  waterEnabled: true,
};

let viewport = null;
let recomputeTimer = null;
let lastResult = null;

/* ─────────────────────────── persistence ─────────────────────────── */

function readStored() {
  try {
    const raw = localStorage.getItem('landscape-editor-doc');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveDoc() {
  try {
    localStorage.setItem('landscape-editor-doc', JSON.stringify({ doc: state.doc, features: state.features, viewMode: state.viewMode }));
    state.saved = true;
    renderInspectorChrome();
  } catch { /* storage full — stay unsaved */ }
}

/* ─────────────────────────── lookups ─────────────────────────────── */

function findLayer(id) {
  return state.doc.layers.find((l) => l.id === id) || state.doc.satLayers.find((l) => l.id === id) || null;
}
function selection() {
  return state.selected === 'terrain' ? null : findLayer(state.selected);
}
function isSat(layer) { return layer && state.doc.satLayers.includes(layer); }
function featureOn(layer, title) {
  const key = `${layer?.id || 'terrain'}::${title}`;
  return state.features[key] !== false;
}
function toggleFeature(layer, title) {
  const key = `${layer?.id || 'terrain'}::${title}`;
  state.features[key] = state.features[key] === false;
  // Hydraulic sediment feedback doubles as a simulation parameter.
  if (title === 'Sediment feedback' && layer?.params) {
    layer.params.sedimentFeedback = state.features[key] === false ? 0 : 1;
  }
  markDirty(true);
}

/* ─────────────────────────── recompute ───────────────────────────── */

function markDirty(immediate = false) {
  state.saved = false;
  clearTimeout(recomputeTimer);
  const heavy = state.doc.layers.some((l) => l.enabled && l.kind === 'hydraulic');
  recomputeTimer = setTimeout(recompute, immediate ? 10 : (heavy ? 260 : 120));
  renderInspectorChrome();
}

function recompute() {
  const t0 = performance.now();
  state.busy = 'Composing terrain';
  renderBusy();
  requestAnimationFrame(() => setTimeout(() => {
    try {
      const doc = state.doc;
      const { field, extra } = compositeStack(doc.layers, doc.resolution, {
        sunAz: doc.sun.azimuth, sunEl: doc.sun.elevation,
      });
      const signals = computeSignals(field, extra, doc.sun.azimuth, doc.sun.elevation);
      const satImg = compositeSatmap(signals, doc.satLayers, doc.resolution);
      const sigA = packSignals(signals, doc.resolution, true);
      const sigB = packSignals(signals, doc.resolution, false);
      lastResult = { field, signals, satImg, sigA, sigB, ms: performance.now() - t0 };
      viewport.sun = { ...doc.sun };
      viewport.water = {
        level: state.waterEnabled ? doc.water.level : 0,
        tint: doc.water.tint,
        enabled: state.waterEnabled,
      };
      viewport.setField(field, sigA, sigB, satImg);
      drawMinimap();
      state.busy = null;
      renderBusy();
      renderStats();
    } catch (err) {
      console.error(err);
      state.busy = null;
      renderBusy();
    }
  }, 10));
}

function packSignals(signals, size, A) {
  const img = new Uint8ClampedArray(size * size * 4);
  const a = signals.arrays;
  const keys = A
    ? [a.heightN, a.slope, a.flow, a.sediment]
    : [a.protrusion, a.wetness, a.aspect, a.ao];
  for (let i = 0; i < size * size; i++) {
    img[i * 4] = keys[0][i] * 255;
    img[i * 4 + 1] = keys[1][i] * 255;
    img[i * 4 + 2] = keys[2][i] * 255;
    img[i * 4 + 3] = keys[3][i] * 255;
  }
  return img;
}

/* ─────────────────────────── outliner ────────────────────────────── */

function renderOutliner() {
  const root = document.getElementById('outliner');
  const q = state.query.trim().toLowerCase();
  const layerRows = state.doc.layers.filter((l) => !q || l.name.toLowerCase().includes(q) || layerKinds[l.kind].name.toLowerCase().includes(q));
  const satRows = state.doc.satLayers.filter((l) => !q || l.name.toLowerCase().includes(q) || (satSources[l.source]?.name || '').toLowerCase().includes(q));

  const row = (l, sat = false) => {
    const spec = sat
      ? { name: satSources[l.source]?.name || 'Satmap', icon: satSources[l.source]?.icon || 'Palette', color: l.colorB }
      : layerKinds[l.kind];
    const hidden = state.hidden[l.id];
    return `<div class="tree-row ${state.selected === l.id ? 'selected' : ''} ${hidden ? 'hidden-object' : ''}" data-row="${l.id}">
      <button class="object-button" data-select="${l.id}" title="${spec.name}">
        ${icon(sat ? spec.icon : spec.icon, 15)}
        <span class="row-name">${l.name}<span class="row-sub">${sat ? 'Satmap · ' + (satSources[l.source]?.name || '') : spec.name}</span></span>
      </button>
      ${!sat ? `<span class="row-move">
        <button data-move="up" data-id="${l.id}" title="Move up" style="transform:rotate(-90deg)">${icon('ChevronRight', 11)}</button>
        <button data-move="down" data-id="${l.id}" title="Move down" style="transform:rotate(90deg)">${icon('ChevronRight', 11)}</button>
      </span>` : ''}
      <button class="visibility" data-vis="${l.id}" aria-label="Toggle visibility">${hidden ? icon('EyeOff', 14) : icon('Eye', 14)}</button>
      ${state.selected === l.id ? '<span class="selected-dot"/>' : ''}
    </div>`;
  };

  root.innerHTML = `
    <div class="brand">
      <div class="brand-symbol">${icon('Layers', 24, 1.5)}</div>
      <span>frontier<span class="brand-dot">.</span></span>
      <span class="version">LANDSCAPE / 01</span>
    </div>
    <div class="scene-label">WORKSPACE <span class="status-dot"/></div>
    <div class="scene-title"><span>${state.doc.name}</span><span class="scene-extension">.terrain</span></div>
    <div class="outliner-heading">
      <h2>Layer Stack <span>${String(state.doc.layers.length + state.doc.satLayers.length + 1).padStart(2, '0')}</span></h2>
      <button class="icon-button" aria-label="Open Add Layer" title="Add layer · Shift+A" data-act="add">${icon(state.addMenu ? 'X' : 'Plus', 17)}</button>
    </div>
    <label class="search">${icon('Search', 15)}
      <input placeholder="Find a layer..." value="${state.query}" data-act="query"/>
      ${state.query ? `<button aria-label="Clear search" data-act="clear-query">${icon('X', 13)}</button>` : '<span>⌕</span>'}
    </label>
    <div class="group">
      <div class="group-label">TERRAIN <span class="group-count">${state.doc.layers.length + 1}</span></div>
      <div class="tree-row ${state.selected === 'terrain' ? 'selected' : ''}" data-row="terrain">
        <button class="object-button" data-select="terrain">
          ${icon('Terrain', 15)}
          <span class="row-name">Terrain<span class="row-sub">Landscape · sun, water & scale</span></span>
        </button>
        ${state.selected === 'terrain' ? '<span class="selected-dot"/>' : ''}
      </div>
      ${layerRows.map((l) => row(l)).join('') || '<div class="empty">No matching layers</div>'}
    </div>
    <div class="group">
      <div class="group-label">SATMAP <span class="group-count">${state.doc.satLayers.length}</span></div>
      ${satRows.map((l) => row(l, true)).join('') || '<div class="empty">No matching satmap layers</div>'}
    </div>
    <div class="outliner-bottom">
      <div class="world-icon">${icon('Globe', 18)}</div>
      <div><strong>${state.doc.name}</strong><span>${state.doc.preset.replace(/-/g, ' ')} · local draft</span></div>
      <span class="little-dot"/>
    </div>`;
}

/* ─────────────────────────── viewport chrome ─────────────────────── */

function renderViewportChrome() {
  const panel = document.getElementById('viewport-panel');
  panel.innerHTML = `
    <div class="viewport-toolbar">
      <div class="view-modes" role="group" aria-label="View mode">
        ${VIEW_MODES.map(([name], i) => `<button class="view-mode ${state.viewMode === i ? 'active' : ''}" data-view="${i}">${name}</button>`).join('')}
      </div>
      <button class="tool-pill" data-act="presets">${icon('Map', 13)} ${state.doc.name}</button>
      <button class="tool-pill" data-act="toggle-water">${icon('Waves', 13)} Water ${state.waterEnabled ? 'on' : 'off'}</button>
      <button class="tool-pill" data-act="export-sat" title="Export satmap PNG">${icon('Download', 13)} Satmap</button>
      <button class="tool-pill" data-act="export-height" title="Export heightmap PNG">${icon('Download', 13)} Heightmap</button>
      <div class="viewport-stats" id="viewport-stats"></div>
    </div>
    <div class="viewport-canvas-wrap">
      <canvas id="terrain-canvas"></canvas>
      <div class="viewport-hud">
        <span class="hud-chip">ORBIT <b>drag</b></span>
        <span class="hud-chip">PAN <b>shift-drag</b></span>
        <span class="hud-chip">ZOOM <b>wheel</b></span>
      </div>
      <div class="sun-gizmo-mini" id="sun-mini"></div>
      <div class="map-mini"><canvas id="minimap" width="118" height="118"></canvas><div class="map-label">SATMAP</div></div>
      <div id="busy-slot"></div>
    </div>`;
  renderStats();
  renderBusy();
  renderSunMini();
}

function renderStats() {
  const el = document.getElementById('viewport-stats');
  if (!el || !lastResult) return;
  const { field } = lastResult;
  const { min, max } = field.minMax();
  const scaleM = 2400;
  el.innerHTML = `
    <span>ELEV <b>${Math.round(min * scaleM)} – ${Math.round(max * scaleM)} m</b></span>
    <span>LAYERS <b>${state.doc.layers.filter((l) => l.enabled).length} + ${state.doc.satLayers.filter((l) => l.enabled).length} sat</b></span>
    <span>SIM <b>${lastResult.ms.toFixed(0)} ms</b></span>`;
}

function renderBusy() {
  const slot = document.getElementById('busy-slot');
  if (!slot) return;
  slot.innerHTML = state.busy
    ? `<div class="busy-pill"><span class="spinner"></span>${state.busy}…</div>` : '';
}

function renderSunMini() {
  const el = document.getElementById('sun-mini');
  if (!el) return;
  const az = state.doc.sun.azimuth * Math.PI / 180;
  const elv = state.doc.sun.elevation / 90;
  const x = 37 + Math.cos(az) * 22 * (1 - elv * 0.3);
  const y = 37 + Math.sin(az) * 22 * (1 - elv * 0.3);
  el.innerHTML = `<svg viewBox="0 0 74 74" width="74" height="74">
    <circle cx="37" cy="37" r="24" stroke="#3a3a3a" fill="none" strokeDasharray="2 3"/>
    <path d="M37 13 V21 M37 53 V61 M13 37 H21 M53 37 H61" stroke="#4a4a4a"/>
    <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${5 + state.doc.sun.elevation / 18}" fill="#e9c889" opacity=".9"/>
    <text x="37" y="70" text-anchor="middle" font-size="7" fill="#7a7a7a">${Math.round(state.doc.sun.azimuth)}° · ${Math.round(state.doc.sun.elevation)}°</text>
  </svg>`;
}

function drawMinimap() {
  const canvas = document.getElementById('minimap');
  if (!canvas || !lastResult) return;
  const ctx = canvas.getContext('2d');
  const size = state.doc.resolution;
  const img = state.viewMode === 1
    ? signalImage(lastResult.signals.arrays.heightN, size, '#141414', '#e8e8e8')
    : state.viewMode === 3
      ? signalImage(lastResult.signals.arrays.flow, size, '#101318', '#6aa4e8')
      : lastResult.satImg;
  const tmp = document.createElement('canvas');
  tmp.width = size; tmp.height = size;
  tmp.getContext('2d').putImageData(new ImageData(img, size, size), 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, 118, 118);
}

/* ─────────────────────────── inspector ───────────────────────────── */

function sliderHtml(scope, key, val, min, max, step, label, unit = '') {
  const progress = ((val - min) / (max - min)) * 100;
  return `<label>
    <span>${label} <strong data-metric="${scope}:${key}">${fmt(val)}<small>${unit}</small></strong></span>
    <input type="range" min="${min}" max="${max}" step="${step}" value="${val}"
      data-scope="${scope}" data-key="${key}" data-unit="${unit}" style="--progress:${progress}%"/>
    <em>${fmt(min)}${unit} – ${fmt(max)}${unit}</em>
  </label>`;
}

function fmt(v) {
  if (typeof v !== 'number') return v;
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: Math.abs(v) < 1 ? 3 : 0 });
}

function selectHtml(scope, key, val, options) {
  return `<select class="field-select" data-scope="${scope}" data-key="${key}">
    ${options.map(([v, name, note]) => `<option value="${v}" ${v === val ? 'selected' : ''}>${name}${note ? ` — ${note}` : ''}</option>`).join('')}
  </select>`;
}

function maskCard(layer) {
  const mask = layer.mask || { type: 'none', params: {} };
  const spec = maskKinds[mask.type] || maskKinds.none;
  const params = { ...spec.defaults, ...(mask.params || {}) };
  return `
    ${selectHtml('mask', 'type', mask.type, Object.entries(maskKinds).map(([k, s]) => [k, s.name, s.description]))}
    <p class="muted">${spec.description}</p>
    ${spec.sliders.map(([k, mn, mx, st, label, unit]) => sliderHtml('mask', k, params[k] ?? mn, mn, mx, st, label, unit)).join('')}
    ${gfx.maskDiagram(mask.type, params)}`;
}

function renderInspector() {
  const root = document.getElementById('inspector');
  const layer = selection();
  const accent = layer ? (isSat(layer) ? layer.colorB : layerKinds[layer.kind]?.color || '#d6a078') : '#d6a078';
  root.style.setProperty('--accent', accent);
  root.innerHTML = `
    <header class="inspector-top" id="inspector-top"></header>
    <div class="inspector-content" id="inspector-content"></div>`;
  renderInspectorChrome();
  renderInspectorBody();
}

function renderInspectorChrome() {
  const top = document.getElementById('inspector-top');
  if (!top) return;
  const layer = selection();
  const group = state.selected === 'terrain' ? 'World' : (isSat(layer) ? 'Satmap' : 'Layers');
  top.innerHTML = `
    <div>Inspector ${icon('ChevronRight', 13)} <span>${group}</span></div>
    <button class="save-status ${state.saved ? 'saved' : ''}" data-act="save">
      ${state.saved ? icon('Check', 13) : '<span class="unsaved-dot"/>'}${state.saved ? 'All changes saved' : 'Save changes'}
    </button>`;
}

function renderInspectorBody() {
  const body = document.getElementById('inspector-content');
  if (!body) return;
  const layer = selection();

  const header = (eyebrow, name, canReset) => `
    <div class="object-header">
      <div class="object-title"><div><div class="eyebrow">${eyebrow}</div><h1>${name}</h1></div></div>
      <div class="object-actions">
        ${canReset ? `<button class="reset" data-act="reset">${icon('RotateCcw', 14)}Reset</button>` : ''}
        <button class="enabled-pill ${layer && state.hidden[layer.id] ? 'disabled' : ''}" data-act="toggle-enabled">
          <span/>${layer ? (state.hidden[layer.id] ? 'Disabled' : 'Enabled') : 'World'}
        </button>
      </div>
    </div>`;

  const label = (right) => `<div class="section-label"><span>PROPERTIES</span><span>${right}</span></div>`;

  const cards = (inner) => `<div class="cards">${inner}</div>`;

  const card = (title, iconName, bodyHtml, cls = '') => `
    <section class="card ${cls}">
      <div class="card-heading"><span>${icon(iconName, 16)}${title}</span></div>
      <fieldset class="card-body" style="border:0;padding:0;margin:0">${bodyHtml}</fieldset>
    </section>`;

  if (!layer) {
    // ── Terrain root ──
    body.innerHTML = `
      ${header('Landscape', state.doc.name, false)}
      ${label('Sun, water, terrain scale & presets')}
      ${cards(`
        ${card('Sun direction', 'Sun', `
          <div class="scattering-top">
            <div><div class="metric">${Math.round(state.doc.sun.elevation)}<small>°</small></div>
            <p class="muted">${state.doc.sun.elevation < 0 ? 'Below the horizon' : 'Above the horizon'} · drives lighting and the sun aspect signal</p></div>
            <span class="small-pill">${Math.round(state.doc.sun.azimuth)}° azimuth</span>
          </div>
          ${sliderHtml('sun', 'azimuth', state.doc.sun.azimuth, 0, 360, 1, 'Azimuth', '°')}
          ${sliderHtml('sun', 'elevation', state.doc.sun.elevation, -8, 88, 1, 'Elevation', '°')}
        `, 'wide-card')}
        ${card('Water level', 'Waves', `
          <div class="scattering-top">
            <div><div class="metric">${(state.doc.water.level * 2400).toFixed(0)}<small>m</small></div>
            <p class="muted">Sea / lake plane across the landscape datum</p></div>
            <span class="small-pill">${state.waterEnabled ? 'Visible' : 'Hidden'}</span>
          </div>
          ${sliderHtml('water', 'level', state.doc.water.level, 0, 0.7, 0.005, 'Water level', '')}
          <div class="swatch-row"><input type="color" value="${state.doc.water.tint}" data-scope="water" data-key="tint"/><span>Water tint</span></div>
        `)}
        ${card('Terrain scale', 'Sliders', `
          <div class="metric medium">${state.doc.resolution}<small>²</small></div>
          <p class="muted">Simulation grid · higher resolution keeps fine erosion detail</p>
          ${selectHtml('doc', 'resolution', String(state.doc.resolution), [['224', '224 × 224', 'fast'], ['288', '288 × 288', 'balanced'], ['320', '320 × 320', 'standard'], ['384', '384 × 384', 'detailed'], ['448', '448 × 448', 'heavy']])}
          <div class="control-line"><span>World elevation span</span><span>2 400 m</span></div>
        `)}
        ${card('Stack summary', 'Layers', `
          <div class="metric medium">${state.doc.layers.length}<small>height</small></div>
          <p class="muted">${state.doc.layers.filter((l) => l.enabled).length} active height layers · ${state.doc.satLayers.filter((l) => l.enabled).length} satmap layers painting from terrain signals</p>
          <div class="control-line"><span>Preset</span><span>${state.doc.name}</span></div>
          <p class="muted">${state.doc.blurb}</p>
          <button class="tool-pill" data-act="presets" style="margin-top:14px">${icon('Map', 13)} Browse presets</button>
        `)}
      `)}
      <footer class="inspector-footer"><span><span class="footer-dot"/>Changes apply in real time</span><span>${state.doc.name} <span class="footer-slash">/</span> Landscape</span></footer>`;
    return;
  }

  const sat = isSat(layer);
  const spec = sat ? satSources[layer.source] : layerKinds[layer.kind];
  const cat = sat ? 'satmap' : layerCategory(layer.kind);
  const desc = sat
    ? spec.description
    : layerKinds[layer.kind].description;

  let inner = '';

  if (sat) {
    const maskOn = featureOn(layer, 'Mask');
    const patternOn = featureOn(layer, 'Pattern');
    const detailOn = featureOn(layer, 'Detail');
    body.innerHTML = `
      ${header('Satmap layer', layer.name, true)}
      ${label(desc)}
      <div class="property-switches" role="group" aria-label="Property switches">
        ${propSwitch(layer, 'Mask', 'Mask', 'Shield')}
        ${propSwitch(layer, 'Pattern', 'Pattern', 'Sparkles')}
        ${propSwitch(layer, 'Detail', 'Detail grain', 'Grain')}
      </div>
      ${cards(`
        ${card('Source signal', 'Activity', `
          <div class="metric medium" style="font-size:20px;letter-spacing:-.5px">${spec.name}</div>
          <p class="muted">${spec.description}</p>
          ${selectHtml('sat', 'source', layer.source, Object.entries(satSources).map(([k, s]) => [k, s.name, s.description]))}
          ${gfx.rampDiagram(layer)}
        `, 'wide-card')}
        ${card('Signal ramp', 'Sliders', `
          ${sliderHtml('ramp', 'lo', layer.ramp.lo, 0, 1, 0.01, 'Lower threshold', '')}
          ${sliderHtml('ramp', 'hi', layer.ramp.hi, 0, 1, 0.01, 'Upper threshold', '')}
          ${sliderHtml('ramp', 'softness', layer.ramp.softness, 0, 0.5, 0.01, 'Shoulder softness', '')}
        `)}
        ${card('Tint & blend', 'Palette', `
          <div class="swatch-row"><input type="color" value="${layer.colorA}" data-scope="sat" data-key="colorA"/><span>Low colour</span></div>
          <div class="swatch-row"><input type="color" value="${layer.colorB}" data-scope="sat" data-key="colorB"/><span>High colour</span></div>
          <div class="gradient-strip" style="background:linear-gradient(90deg,${layer.colorA},${layer.colorB})"></div>
          ${selectHtml('sat', 'blend', layer.blend, Object.entries(satBlends).map(([k, s]) => [k, s.name, s.hint]))}
          ${sliderHtml('sat', 'opacity', layer.opacity, 0, 1, 0.01, 'Layer opacity', '')}
        `)}
        ${patternOn ? card('Pattern generator', 'Sparkles', `
          ${selectHtml('pattern', 'kind', layer.pattern.kind, [['fbm', 'Multifractal noise', ''], ['ridged', 'Ridged noise', ''], ['voronoi', 'Voronoi cells', '']])}
          ${sliderHtml('pattern', 'amount', layer.pattern.amount, 0, 1, 0.01, 'Pattern mix', '')}
          ${sliderHtml('pattern', 'scale', layer.pattern.scale, 0.5, 10, 0.1, 'Pattern scale', '×')}
          ${sliderHtml('pattern', 'seed', layer.pattern.seed, 1, 999, 1, 'Pattern seed', '')}
        `) : ''}
        ${detailOn ? card('Detail grain', 'Grain', `
          ${sliderHtml('detail', 'amount', layer.detail.amount, 0, 1, 0.01, 'Grain amount', '')}
          ${sliderHtml('detail', 'scale', layer.detail.scale, 1, 24, 0.5, 'Grain scale', '×')}
          ${sliderHtml('detail', 'seed', layer.detail.seed, 1, 999, 1, 'Grain seed', '')}
        `) : ''}
        ${maskOn ? card('Mask', 'Shield', maskCard(layer), 'wide-card') : ''}
      `)}
      <footer class="inspector-footer"><span><span class="footer-dot"/>Changes apply in real time</span><span>${layer.name} <span class="footer-slash">/</span> Satmap</span></footer>`;
    return;
  }

  // ── height layer ──
  const maskOn = featureOn(layer, 'Mask');
  const params = layer.params;
  const spec2 = layerKinds[layer.kind];
  const switchDefs = [['Mask', 'Mask', 'Shield']];
  if (layer.kind === 'hydraulic') switchDefs.push(['Sediment feedback', 'Sediment', 'Grain']);

  let simCard = '';
  if (layer.kind === 'hydraulic') {
    simCard = card('Droplet simulation', 'Droplets', `
      ${spec2.sliders.map(([k, mn, mx, st, l, u]) => sliderHtml('param', k, params[k], mn, mx, st, l, u)).join('')}
      ${gfx.dropletBudget(params.droplets, params.lifetime)}
      <div class="diagram-caption"><span>EROSION / DEPOSITION BUDGET</span><span>${Math.round(params.droplets / 1000)}k droplets</span></div>
    `, 'wide-card');
  } else if (layer.kind === 'thermal') {
    simCard = card('Talus slumping', 'Mountain', `
      ${spec2.sliders.map(([k, mn, mx, st, l, u]) => sliderHtml('param', k, params[k], mn, mx, st, l, u)).join('')}
      ${gfx.talusDiagram(params.talus, params.rate)}
    `);
  } else if (layer.kind === 'wind') {
    simCard = card('Aeolian drift', 'Wind', `
      ${spec2.sliders.map(([k, mn, mx, st, l, u]) => sliderHtml('param', k, params[k], mn, mx, st, l, u)).join('')}
      ${gfx.windDiagram(params.strength * 100, params.direction)}
    `, 'wide-card');
  } else if (layer.kind === 'river') {
    simCard = card('Channel carving', 'Flow', `
      ${spec2.sliders.map(([k, mn, mx, st, l, u]) => sliderHtml('param', k, params[k], mn, mx, st, l, u)).join('')}
      ${gfx.riverDiagram(params.power, params.depth * 100)}
    `, 'wide-card');
  } else {
    const visual = layer.kind === 'mountain' || layer.kind === 'ridged'
      ? gfx.contourDiagram(200 + (params.amplitude || 0.3) * 700, 40 + (params.persistence || 0.5) * 60, 20)
      : layer.kind === 'dunes'
        ? gfx.duneProfile(params.angle, 40 + (params.amplitude || 0.2) * 120)
        : layer.kind === 'perlin' || layer.kind === 'fbm' || layer.kind === 'billow' || layer.kind === 'warped'
          ? gfx.roughnessProfile(30 + (params.persistence ?? 0.5) * 80)
          : layer.kind === 'strata'
            ? gfx.maskDiagram('strata', params)
            : layer.kind === 'voronoi'
              ? gfx.maskDiagram('noise', { threshold: 0.45, softness: 0.4, scale: params.scale || 2, seed: params.seed || 3 })
              : layer.kind === 'smooth'
                ? gfx.roughnessProfile(60 - params.strength * 50)
                : layer.kind === 'terrace'
                  ? gfx.maskDiagram('strata', { frequency: params.steps })
                  : '';
    simCard = card('Generator', spec2.icon, `
      ${spec2.sliders.map(([k, mn, mx, st, l, u]) => sliderHtml('param', k, params[k], mn, mx, st, l, u)).join('')}
      ${params.seed !== undefined ? `<div class="seed"><span>Generator seed</span><button data-act="roll-seed">${params.seed} ${icon('RotateCcw', 12)}</button></div>` : ''}
      ${visual}
    `, layer.kind === 'smooth' || layer.kind === 'terrace' || layer.kind === 'clamp' || layer.kind === 'mound' ? '' : 'wide-card');
  }

  body.innerHTML = `
    ${header(CATEGORY_LABEL[cat] || 'Layer', layer.name, true)}
    ${label(desc)}
    <div class="property-switches" role="group" aria-label="Property switches">
      ${switchDefs.map(([title, labelName, ic]) => propSwitch(layer, title, labelName, ic)).join('')}
    </div>
    ${cards(`
      ${simCard}
      ${card('Blend & strength', 'Layers', `
        ${selectHtml('layer', 'blend', layer.blend, Object.entries(blendModes).map(([k, s]) => [k, s.name, s.hint]))}
        ${sliderHtml('layer', 'opacity', layer.opacity, 0, 1, 0.01, 'Layer opacity', '')}
        <p class="muted">${blendModes[layer.blend]?.hint || ''}</p>
      `)}
      ${maskOn ? card('Mask', 'Shield', maskCard(layer), 'wide-card') : ''}
    `)}
    <footer class="inspector-footer"><span><span class="footer-dot"/>Changes apply in real time</span><span>${layer.name} <span class="footer-slash">/</span> ${spec2.name}</span></footer>`;
}

function propSwitch(layer, title, labelName, ic) {
  const on = featureOn(layer, title);
  return `<button class="property-switch ${on ? 'is-on' : 'is-off'}" data-feature="${title}" aria-pressed="${on}">
    <span class="switch-icon">${icon(ic, 18, 1.7)}</span>
    <span class="switch-name">${labelName}</span>
    <span class="switch-state">${on ? 'ON' : 'OFF'}</span>
  </button>`;
}

/* ─────────────────────────── overlays ────────────────────────────── */

function renderOverlays() {
  const root = document.getElementById('overlay-root');
  if (state.presetMenu) {
    root.innerHTML = `<div class="construct-backdrop" data-act="close-overlay">
      <section class="construct-panel" role="dialog" aria-label="Landscape presets" onclick="event.stopPropagation()">
        <header>
          <div class="construct-emblem">${icon('Map', 19)}</div>
          <div><h2>Presets</h2><p>Curated layer stacks · generators, erosion and satmap</p></div>
          <span class="construct-engine">LANDSCAPE / 01</span>
          <button class="construct-close" data-act="close-overlay" aria-label="Close">${icon('X', 17)}</button>
        </header>
        <div class="construct-content" style="overflow-y:auto">
          <div class="construct-grid" style="grid-template-columns:1fr 1fr 1fr">
            ${presets.map((p) => `
              <button class="construct-tile" data-preset="${p.id}">
                <div class="preset-thumb"><canvas width="220" height="72" data-thumb="${p.id}"></canvas></div>
                <strong>${p.name}</strong>
                <span>${p.blurb}</span>
              </button>`).join('')}
          </div>
          <p class="construct-caveat">Applying a preset replaces the current stack. Presets encode generator layers, erosion simulations, masks and full satmap painting.</p>
        </div>
      </section>
    </div>`;
    drawPresetThumbs();
    return;
  }
  if (state.addMenu) {
    const kinds = state.addStep === 'sat'
      ? Object.entries(satSources)
      : Object.entries(layerKinds).filter(([k]) => {
        if (state.addStep === 'generator') return layerCategory(k) === 'generator' || layerCategory(k) === 'base';
        if (state.addStep === 'erosion') return layerCategory(k) === 'erosion';
        return layerCategory(k) === 'filter';
      });
    root.innerHTML = `<div class="construct-backdrop" data-act="close-overlay">
      <section class="construct-panel" role="dialog" aria-label="Add layer" onclick="event.stopPropagation()">
        <header>
          <div class="construct-emblem">${icon('Layers', 19)}</div>
          <div><h2>Add layer</h2><p>${state.addStep ? 'Configure the new layer' : 'Choose a layer type for the stack'}</p></div>
          <span class="construct-engine">LANDSCAPE / 01</span>
          <button class="construct-close" data-act="close-overlay" aria-label="Close">${icon('X', 17)}</button>
        </header>
        <div class="construct-context">
          <span class="current">01 &nbsp; Catalogue</span>${icon('ChevronRight', 12)}
          <span>02 &nbsp; Layer</span>
          <span class="construct-context-end">${state.addStep ? state.addStep : 'Generators · erosion · filters · satmap'}</span>
        </div>
        <div class="construct-layout">
          <nav aria-label="Layer categories">
            ${[['all', 'All', 'Boxes'], ['generator', 'Generators', 'Ripples'], ['erosion', 'Erosion', 'Droplets'], ['filter', 'Filters', 'Sliders'], ['sat', 'Satmap', 'Palette']].map(([k, name, ic]) => `
              <button data-add-cat="${k}" class="${(state.addStep || 'all') === k ? 'active' : ''}">${icon(ic, 16)}${name}
                <small>${k === 'all' ? Object.keys(layerKinds).length : k === 'sat' ? Object.keys(satSources).length : Object.keys(layerKinds).filter((kk) => (k === 'generator' ? (layerCategory(kk) === 'generator' || layerCategory(kk) === 'base') : layerCategory(kk) === k)).length}</small>
              </button>`).join('')}
          </nav>
          <div class="construct-content">
            <div class="construct-section-title">${state.addStep ? state.addStep : 'All layers'}<span>${String(kinds.length).padStart(2, '0')}</span></div>
            <div class="construct-grid">
              ${state.addStep === null || state.addStep === 'all'
                ? Object.entries(layerKinds).map(([k, s]) => addTile(k, s, 'height')).join('')
                : state.addStep === 'sat'
                  ? kinds.map(([k, s]) => addTile(k, s, 'sat')).join('')
                  : kinds.map(([k, s]) => addTile(k, s, 'height')).join('')}
            </div>
            <p class="construct-caveat">Generator layers sample noise fields · erosion layers run simulations over the stack below · filters reshape · satmap layers paint the satellite texture from terrain signals.</p>
          </div>
        </div>
      </section>
    </div>`;
    return;
  }
  root.innerHTML = '';
}

function addTile(k, s, mode) {
  return `<button class="construct-tile" data-add-kind="${k}" data-add-mode="${mode}">
    <div class="tile-glyph" style="color:${s.color || '#c9a06a'}">${icon(s.icon || 'Layers', 34, 1.3)}</div>
    <strong>${s.name}</strong>
    <span>${s.description}</span>
    ${icon('ChevronRight', 12)}
  </button>`;
}

function drawPresetThumbs() {
  document.querySelectorAll('canvas[data-thumb]').forEach((cv) => {
    const p = presets.find((x) => x.id === cv.dataset.thumb);
    const ctx = cv.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 72);
    g.addColorStop(0, '#20222a');
    g.addColorStop(1, p.colors[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 220, 72);
    // ridge silhouettes
    for (let layer = 0; layer < 3; layer++) {
      ctx.beginPath();
      ctx.moveTo(0, 72);
      for (let x = 0; x <= 220; x += 4) {
        const n = Math.sin(x * 0.035 + layer * 2.1) * 9 + Math.sin(x * 0.011 + layer) * 14 + Math.sin(x * 0.09 + layer * 3) * 3;
        ctx.lineTo(x, 34 + layer * 12 - n * (1 - layer * 0.22));
      }
      ctx.lineTo(220, 72);
      ctx.closePath();
      ctx.fillStyle = layer === 0 ? p.colors[0] + 'cc' : layer === 1 ? p.colors[0] + '99' : p.colors[1] + 'cc';
      ctx.fill();
    }
  });
}

function addLayer(kind, mode) {
  if (mode === 'sat') {
    const l = satLayerDefaults();
    l.name = `${satSources[kind].name} layer`;
    l.source = kind;
    l.colorA = '#4a4438';
    l.colorB = '#b09a72';
    state.doc.satLayers.push(l);
    state.selected = l.id;
  } else {
    const l = layerDefaults(kind);
    state.doc.layers.push(l);
    state.selected = l.id;
  }
  state.addMenu = false;
  state.addStep = null;
  renderAll();
  markDirty();
}

/* ─────────────────────────── events ──────────────────────────────── */

function readSlider(input) {
  const v = parseFloat(input.value);
  return v;
}

function setByScope(scope, key, value) {
  const layer = selection();
  switch (scope) {
    case 'param': layer.params[key] = value; break;
    case 'mask':
      if (key === 'type') {
        layer.mask = layer.mask || { type: 'none', params: {} };
        layer.mask.type = value;
        layer.mask.params = { ...(maskKinds[value]?.defaults || {}), ...(layer.mask.params || {}) };
      } else {
        layer.mask = layer.mask || { type: 'none', params: {} };
        layer.mask.params = layer.mask.params || {};
        layer.mask.params[key] = value;
      }
      break;
    case 'ramp': layer.ramp[key] = value; break;
    case 'detail': layer.detail[key] = value; break;
    case 'pattern': layer.pattern[key] = value; break;
    case 'sat': layer[key] = value; break;
    case 'layer': layer[key] = value; break;
    case 'sun': state.doc.sun[key] = value; renderSunMini(); break;
    case 'water':
      state.doc.water[key] = value;
      if (viewport) viewport.water = { level: state.waterEnabled ? state.doc.water.level : 0, tint: state.doc.water.tint, enabled: state.waterEnabled };
      break;
    case 'doc':
      if (key === 'resolution') state.doc.resolution = parseInt(value, 10);
      break;
  }
  if (['mask', 'ramp', 'detail', 'pattern', 'sat', 'layer', 'sun', 'water', 'doc'].includes(scope) && (key === 'type' || key === 'source' || key === 'kind' || key === 'blend' || key === 'resolution')) {
    renderInspectorBody();
    renderOutliner();
  }
}

function onInput(e) {
  const t = e.target;
  if (t.matches('input[type=range][data-scope]')) {
    const value = readSlider(t);
    const min = parseFloat(t.min), max = parseFloat(t.max);
    t.style.setProperty('--progress', `${((value - min) / (max - min)) * 100}%`);
    setByScope(t.dataset.scope, t.dataset.key, value);
    const metric = t.parentElement.querySelector(`[data-metric="${t.dataset.scope}:${t.dataset.key}"]`);
    if (metric) metric.innerHTML = `${fmt(value)}<small>${t.dataset.unit || ''}</small>`;
    markDirty();
    if (t.dataset.scope === 'sun' || t.dataset.scope === 'water') {
      // live preview without full recompute for camera-ish params
    }
  } else if (t.matches('select[data-scope]')) {
    let v = t.value;
    if (t.dataset.key === 'resolution') v = parseInt(v, 10);
    if (['amount', 'scale', 'seed', 'opacity', 'lo', 'hi', 'softness', 'blend'].includes(t.dataset.key) && t.dataset.scope !== 'doc') {
      // keep strings for enum fields
    }
    if (t.dataset.key === 'seed' || t.dataset.key === 'steps' || t.dataset.key === 'octaves') v = parseInt(v, 10);
    setByScope(t.dataset.scope, t.dataset.key, v);
    markDirty();
  } else if (t.matches('input[type=color][data-scope]')) {
    setByScope(t.dataset.scope, t.dataset.key, t.value);
    markDirty();
  } else if (t.matches('input[data-act=query]')) {
    state.query = t.value;
    renderOutliner();
    const input = document.querySelector('input[data-act=query]');
    if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }
  }
}

function onClick(e) {
  const t = e.target.closest('[data-act],[data-select],[data-vis],[data-view],[data-preset],[data-add-kind],[data-add-cat],[data-feature],[data-move]');
  if (!t) return;

  if (t.dataset.select) {
    state.selected = t.dataset.select;
    renderAll();
    return;
  }
  if (t.dataset.vis) {
    state.hidden[t.dataset.vis] = !state.hidden[t.dataset.vis];
    applyVisibility();
    renderOutliner();
    markDirty();
    return;
  }
  if (t.dataset.move) {
    const id = t.dataset.id;
    const i = state.doc.layers.findIndex((l) => l.id === id);
    if (i >= 0) {
      const j = t.dataset.move === 'up' ? i - 1 : i + 1;
      if (j >= 0 && j < state.doc.layers.length) {
        const arr = state.doc.layers;
        [arr[i], arr[j]] = [arr[j], arr[i]];
        renderOutliner();
        markDirty();
      }
    }
    return;
  }
  if (t.dataset.view !== undefined) {
    state.viewMode = parseInt(t.dataset.view, 10);
    if (viewport) viewport.viewMode = state.viewMode;
    renderViewportChrome();
    drawMinimap();
    return;
  }
  if (t.dataset.preset) {
    const p = presets.find((x) => x.id === t.dataset.preset);
    if (p) {
      state.doc = makeDocument(p);
      state.selected = 'terrain';
      state.hidden = {};
      state.presetMenu = false;
      renderAll();
      markDirty(true);
    }
    return;
  }
  if (t.dataset.addCat) {
    state.addStep = t.dataset.addCat === 'all' ? null : t.dataset.addCat;
    renderOverlays();
    return;
  }
  if (t.dataset.addKind) {
    addLayer(t.dataset.addKind, t.dataset.addMode);
    return;
  }
  if (t.dataset.feature) {
    toggleFeature(selection() || { id: 'terrain' }, t.dataset.feature);
    renderInspectorBody();
    return;
  }

  switch (t.dataset.act) {
    case 'add':
      state.addMenu = !state.addMenu;
      state.presetMenu = false;
      state.addStep = null;
      renderOutliner();
      renderOverlays();
      break;
    case 'presets':
      state.presetMenu = true;
      state.addMenu = false;
      renderOverlays();
      break;
    case 'close-overlay':
      state.presetMenu = false;
      state.addMenu = false;
      renderOverlays();
      break;
    case 'toggle-water':
      state.waterEnabled = !state.waterEnabled;
      if (viewport) viewport.water = {
        level: state.waterEnabled ? state.doc.water.level : 0,
        tint: state.doc.water.tint,
        enabled: state.waterEnabled,
      };
      renderViewportChrome();
      drawMinimap();
      break;
    case 'save':
      saveDoc();
      break;
    case 'reset': {
      const layer = selection();
      if (layer) {
        const fresh = isSat(layer) ? satLayerDefaults() : layerDefaults(layer.kind);
        layer.params = fresh.params;
        layer.ramp = fresh.ramp;
        layer.detail = fresh.detail;
        layer.pattern = fresh.pattern;
        layer.opacity = fresh.opacity;
        layer.blend = fresh.blend;
        layer.mask = { type: 'none', params: {} };
        renderInspectorBody();
        markDirty();
      }
      break;
    }
    case 'toggle-enabled': {
      const layer = selection();
      if (layer) {
        state.hidden[layer.id] = !state.hidden[layer.id];
        applyVisibility();
        renderOutliner();
        renderInspectorBody();
        markDirty();
      }
      break;
    }
    case 'roll-seed': {
      const layer = selection();
      if (layer?.params?.seed !== undefined) {
        layer.params.seed = Math.floor(Math.random() * 999) + 1;
        renderInspectorBody();
        markDirty();
      }
      break;
    }
    case 'export-sat':
      if (lastResult) exportPng(lastResult.satImg, state.doc.resolution, `${state.doc.preset}-satmap.png`);
      break;
    case 'export-height': {
      if (!lastResult) break;
      const { heightN } = lastResult.signals.arrays;
      const img = signalImage(heightN, state.doc.resolution, '#000000', '#ffffff');
      exportPng(img, state.doc.resolution, `${state.doc.preset}-heightmap.png`);
      break;
    }
    case 'clear-query':
      state.query = '';
      renderOutliner();
      break;
  }
}

function exportPng(rgba, size, filename) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  cv.getContext('2d').putImageData(new ImageData(rgba, size, size), 0, 0);
  cv.toBlob((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });
}

function applyVisibility() {
  // hidden height layers are removed from the stack evaluation via layer.enabled
  for (const l of [...state.doc.layers, ...state.doc.satLayers]) {
    l.enabled = !state.hidden[l.id];
  }
  markDirty();
}

/* ─────────────────────────── keyboard ────────────────────────────── */

function onKey(e) {
  const typing = /INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable;
  if (e.shiftKey && e.code === 'KeyA' && !typing) {
    e.preventDefault();
    state.addMenu = !state.addMenu;
    state.presetMenu = false;
    state.addStep = null;
    renderOutliner();
    renderOverlays();
    return;
  }
  if (e.key === 'Escape') {
    if (state.addMenu || state.presetMenu) {
      state.addMenu = false;
      state.presetMenu = false;
      renderOutliner();
      renderOverlays();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
    e.preventDefault();
    saveDoc();
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && state.selected !== 'terrain') {
    const layer = selection();
    if (layer) {
      const arr = isSat(layer) ? state.doc.satLayers : state.doc.layers;
      const i = arr.indexOf(layer);
      if (i >= 0) arr.splice(i, 1);
      state.selected = 'terrain';
      renderAll();
      markDirty();
    }
  }
}

/* ─────────────────────────── boot ────────────────────────────────── */

function renderAll() {
  renderOutliner();
  renderInspector();
  renderOverlays();
}

function boot() {
  const stored = readStored();
  if (stored?.doc?.layers?.length) {
    state.doc = stored.doc;
    state.features = stored.features || {};
    state.viewMode = stored.viewMode || 0;
    state.saved = true;
  }

  renderViewportChrome();
  renderAll();

  const canvas = document.getElementById('terrain-canvas');
  viewport = new Viewport(canvas);
  viewport.viewMode = state.viewMode;
  viewport.sun = { ...state.doc.sun };
  viewport.water = { level: state.doc.water.level, tint: state.doc.water.tint, enabled: true };
  viewport.cam = { ...state.doc.camera, target: [0, 0.1, 0] };

  document.getElementById('root').addEventListener('input', onInput);
  document.getElementById('root').addEventListener('change', (e) => {
    if (e.target.matches('select[data-scope],input[type=color][data-scope]')) onInput(e);
  });
  document.getElementById('root').addEventListener('click', onClick);
  document.getElementById('overlay-root').addEventListener('click', onClick);
  document.getElementById('overlay-root').addEventListener('input', onInput);
  window.addEventListener('keydown', onKey);

  recompute();
}

boot();
