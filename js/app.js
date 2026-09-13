// Slate Terrain Lab — app shell: layer stack + eroders + inspector + worker client.
import { LAYERS, makeLayer } from './sim/sdf.js';
import { PRESETS, RESOLUTIONS, defaultErosion, defaultProject } from './sim/presets.js';
import { COLOR_MODES } from './sim/mesher.js';
import { Viewport } from './viewport.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const fmtInt = (n) => Math.round(n).toLocaleString('en-US');

// ---------------- state ----------------
const state = {
  project: defaultProject(),
  layers: [],
  erosion: defaultErosion(),
  selected: null,
  colorMode: 'material',
  showParticles: true, seaVisible: true, wireframe: false,
  clipOn: false, clipY: 30, autoRotate: false, autoBuild: true,
  stale: false, running: null, queue: [],
  particleColor: '#4db8ff',
};
const KIND_COLORS = { hydro: '#4db8ff', wind: '#ffd27a', thermal: '#ff9a5c', river: '#2fe0a8' };

// ---------------- worker client ----------------
const worker = new Worker(new URL('./worker/sim-worker.js', import.meta.url), { type: 'module' });
let msgSeq = 1;
const pending = new Map();
function call(type, payload = {}) {
  const id = msgSeq++;
  return new Promise((resolve) => { pending.set(id, resolve); worker.postMessage({ ...payload, type, id }); });
}
let viewport, stats = { tris: 0, verts: 0, meshMs: 0 };
let globalLedger = { eroded: 0, deposited: 0, particles: 0 };

worker.onmessage = (ev) => {
  const m = ev.data;
  if (m.type === 'progress') return setBuildProgress(m.frac, m.label);
  if (m.type === 'built' || m.type === 'mesh') {
    viewport.setMesh(m);
    stats.tris = m.tris; stats.verts = m.nv; stats.meshMs = m.meshMs || 0;
    if (m.type === 'built') {
      setBuildProgress(1, 'done');
      log(`built ${fmtInt(m.stats.solid)}/${fmtInt(m.stats.voxels)} solid · mesh ${fmtInt(m.tris)} tris in ${m.meshMs | 0}ms`);
      const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m); }
      state.stale = false; updateBuildBtn();
    }
    updateStatsChip();
    return;
  }
  if (m.type === 'erodeProgress') {
    setErodeProgress(m.kind, m.frac);
    if (m.viz && state.showParticles) viewport.setParticles(m.viz, m.vizN, KIND_COLORS[m.kind]);
    return;
  }
  if (m.type === 'eroded') {
    setErodeProgress(m.kind, 1);
    globalLedger = m.global;
    const L = m.ledger;
    log(`${m.kind}: ${fmtInt(L.particles)} particles · eroded ${L.eroded.toFixed(1)} / deposited ${L.deposited.toFixed(1)} · drift ${m.driftPct}%${L.cancelled ? ' · CANCELLED' : ''}`);
    if (m.kind === 'river' && m.rivers) viewport.setRivers(fitRivers(m.rivers));
    const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m); }
    updateLedger(); pumpQueue();
    return;
  }
  if (m.type === 'colors') { viewport.setColors(m.colors); return; }
  if (m.type === 'heightmapData') {
    const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m); }
    return;
  }
  if (m.type === 'obj') {
    const r = pending.get(m.id); if (r) { pending.delete(m.id); r(m); }
    return;
  }
};
function fitRivers(paths) { return paths; } // paths already in world coords

// ---------------- UI helpers ----------------
function sliderRow(parent, label, min, max, step, get, set, fmt = (v) => v) {
  const row = el('div', 'srow');
  const lab = el('span', 'slabel', label);
  const range = el('input', 'srange'); range.type = 'range'; range.min = min; range.max = max; range.step = step; range.value = get();
  const num = el('input', 'snum'); num.type = 'number'; num.min = min; num.max = max; num.step = step; num.value = get();
  const show = () => { num.value = fmt(get()); };
  range.oninput = () => { set(parseFloat(range.value)); num.value = range.value; };
  num.onchange = () => { let v = parseFloat(num.value); if (isFinite(v)) { v = Math.min(max, Math.max(min, v)); set(v); range.value = v; } show(); };
  row.append(lab, range, num);
  parent.appendChild(row);
  return { refresh: () => { range.value = get(); show(); } };
}
function toggleRow(parent, label, get, set) {
  const row = el('div', 'srow');
  row.append(el('span', 'slabel', label));
  const b = el('button', 'pill' + (get() ? ' on' : ''), get() ? 'ON' : 'OFF');
  b.onclick = () => { set(!get()); b.className = 'pill' + (get() ? ' on' : ''); b.textContent = get() ? 'ON' : 'OFF'; };
  row.appendChild(b);
  parent.appendChild(row);
  return { refresh: () => { b.className = 'pill' + (get() ? ' on' : ''); b.textContent = get() ? 'ON' : 'OFF'; } };
}
function log(msg) {
  const t = new Date().toLocaleTimeString('en-GB', { hour12: false });
  $('#log').textContent = `[${t}] ${msg}`;
  console.log('[slate]', msg);
}
function updateStatsChip() {
  $('#chip').innerHTML = `<b>${fmtInt(stats.tris)}</b> tris · <b>${fmtInt(stats.verts)}</b> verts · mesh ${stats.meshMs | 0}ms`;
}
function updateLedger() {
  const d = globalLedger.eroded - globalLedger.deposited;
  const pct = globalLedger.eroded > 0 ? (100 * Math.abs(d) / globalLedger.eroded).toFixed(2) : '0.00';
  $('#ledger').innerHTML = `ledger <b>E ${globalLedger.eroded.toFixed(1)}</b> / <b>D ${globalLedger.deposited.toFixed(1)}</b> · drift <b>${pct}%</b> · <b>${fmtInt(globalLedger.particles)}</b> particles`;
}

// ---------------- left: layer stack ----------------
function renderLayers() {
  const list = $('#layerList');
  list.innerHTML = '';
  if (!state.layers.length) list.appendChild(el('div', 'empty', 'Empty stack — add a primitive below.'));
  state.layers.forEach((l, i) => {
    const def = LAYERS[l.kind];
    const row = el('div', 'lrow' + (l.id === state.selected ? ' sel' : '') + (l.enabled ? '' : ' off'));
    row.onclick = () => { state.selected = l.id; renderLayers(); renderInspector(); };
    const eye = el('button', 'iconbtn', l.enabled ? '◉' : '○');
    eye.title = 'toggle';
    eye.onclick = (e) => { e.stopPropagation(); l.enabled = !l.enabled; markStale(); renderLayers(); };
    const nm = el('span', 'lname', `${def.icon} ${l.name}`);
    const op = el('span', 'op ' + l.op, l.op);
    const up = el('button', 'iconbtn', '↑'); up.title = 'move up (earlier)';
    up.onclick = (e) => { e.stopPropagation(); if (i > 0) { state.layers.splice(i - 1, 0, state.layers.splice(i, 1)[0]); markStale(); renderLayers(); } };
    const dn = el('button', 'iconbtn', '↓');
    dn.onclick = (e) => { e.stopPropagation(); if (i < state.layers.length - 1) { state.layers.splice(i + 1, 0, state.layers.splice(i, 1)[0]); markStale(); renderLayers(); } };
    const del = el('button', 'iconbtn danger', '✕');
    del.onclick = (e) => { e.stopPropagation(); state.layers.splice(i, 1); if (state.selected === l.id) state.selected = null; markStale(); renderLayers(); renderInspector(); };
    row.append(eye, nm, op, up, dn, del);
    list.appendChild(row);
  });
}
function initAddLayer() {
  const sel = $('#addKind');
  sel.innerHTML = '';
  for (const [kind, def] of Object.entries(LAYERS)) {
    const o = document.createElement('option');
    o.value = kind; o.textContent = def.icon + ' ' + def.name;
    sel.appendChild(o);
  }
  $('#addBtn').onclick = () => {
    const l = makeLayer(sel.value);
    state.layers.push(l);
    state.selected = l.id;
    markStale(); renderLayers(); renderInspector();
    log(`added ${l.name}`);
  };
}

// ---------------- left: eroders ----------------
const ERODE_UI = {
  hydro: { title: '🌧 Hydraulic rain', fields: [
    ['count', 'Droplets', 2000, 250000, 5000], ['erodeK', 'Erode', 0.05, 1, 0.01],
    ['depositK', 'Deposit', 0.05, 1, 0.01], ['capacity', 'Capacity', 0.5, 12, 0.1],
    ['radius', 'Brush (vox)', 0.6, 3, 0.05],
  ], adv: [
    ['ttl', 'Lifetime', 8, 120, 1], ['gravity', 'Gravity', 0.5, 12, 0.1],
    ['inertia', 'Inertia', 0, 0.9, 0.01], ['evap', 'Evaporation', 0.002, 0.08, 0.001],
    ['minSlope', 'Min slope', 0, 0.1, 0.001], ['impact', 'Rain impact', 0, 1, 0.05],
    ['hardResist', 'Hard resist', 0, 1, 0.05], ['seed', 'Seed', 0, 99999, 1],
  ]},
  thermal: { title: '⛰ Thermal talus', fields: [
    ['samples', 'Samples', 10000, 500000, 10000], ['talusDeg', 'Talus °', 20, 50, 0.5], ['rate', 'Rate', 0.05, 1, 0.05],
  ], adv: [['hardResist', 'Hard resist', 0, 1, 0.05], ['seed', 'Seed', 0, 99999, 1]] },
  wind: { title: '🌪 Wind', fields: [
    ['count', 'Grains', 5000, 250000, 5000], ['dirDeg', 'Direction °', 0, 360, 5],
    ['speed', 'Speed', 1, 15, 0.5], ['abrasion', 'Abrasion', 0, 1.5, 0.05], ['sand', 'Sand supply', 0, 2.5, 0.1],
  ], adv: [
    ['ttl', 'Lifetime', 20, 200, 5], ['gust', 'Gustiness', 0, 1, 0.05],
    ['saltation', 'Saltation', 0.2, 2, 0.1], ['depositK', 'Deposit', 0.05, 1, 0.05],
    ['hardResist', 'Hard resist', 0, 1, 0.05], ['windH', 'Wind height', 0.2, 1, 0.05], ['seed', 'Seed', 0, 99999, 1],
  ]},
  river: { title: '🌊 Rivers', fields: [
    ['rivers', 'River count', 0, 16, 1], ['width0', 'Width', 0.5, 4, 0.1],
    ['depth0', 'Depth', 0.1, 1.5, 0.05], ['carveK', 'Carve', 0.1, 2, 0.05], ['meander', 'Meander', 0, 1.5, 0.05],
  ], adv: [
    ['ttl', 'Max length', 100, 800, 10], ['momentum', 'Momentum', 0, 0.9, 0.05],
    ['rainFeed', 'Tributaries', 0, 0.05, 0.001], ['depositK', 'Deposit', 0.05, 1, 0.05],
    ['leveeK', 'Levees', 0, 0.5, 0.01], ['hardResist', 'Hard resist', 0, 1, 0.05], ['seed', 'Seed', 0, 99999, 1],
  ]},
};
function buildEroders() {
  const host = $('#eroders');
  host.innerHTML = '';
  for (const [kind, ui] of Object.entries(ERODE_UI)) {
    const box = el('div', 'erode');
    const head = el('div', 'erode-head');
    const dot = el('span', 'dot', ''); dot.style.background = KIND_COLORS[kind];
    head.append(dot, el('b', '', ui.title));
    const run = el('button', 'btn small', '▶ Run');
    run.onclick = () => runKind(kind);
    head.append(run);
    box.appendChild(head);
    const bar = el('div', 'pbar', '<i></i>');
    bar.id = 'prog-' + kind;
    box.appendChild(bar);
    for (const [key, label, min, max, step] of ui.fields) {
      sliderRow(box, label, min, max, step, () => state.erosion[kind][key], (v) => { state.erosion[kind][key] = v; });
    }
    const adv = el('details', 'adv');
    adv.appendChild(el('summary', '', 'advanced'));
    for (const [key, label, min, max, step] of ui.adv) {
      sliderRow(adv, label, min, max, step, () => state.erosion[kind][key], (v) => { state.erosion[kind][key] = v; });
    }
    box.appendChild(adv);
    host.appendChild(box);
  }
}
function setErodeProgress(kind, frac) {
  const bar = document.querySelector('#prog-' + kind + ' i');
  if (bar) bar.style.width = (frac * 100).toFixed(1) + '%';
}
function setBuildProgress(frac, label) {
  $('#buildBar i').style.width = (frac * 100).toFixed(1) + '%';
  $('#buildLabel').textContent = label || '';
}

// ---------------- run control ----------------
async function runKind(kind) {
  if (state.running) { state.queue.push(kind); log(`queued ${kind}`); return; }
  state.running = kind;
  document.body.classList.add('busy');
  viewport.setRivers(null);
  log(`running ${kind}…`);
  const t0 = performance.now();
  await call('erode', { kind, params: state.erosion[kind], seaLevel: state.project.seaLevel, slice: 9000 });
  state.running = null;
  document.body.classList.remove('busy');
  log(`${kind} pass finished in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
  autosave();
}
function pumpQueue() {
  if (state.running || !state.queue.length) return;
  runKind(state.queue.shift());
}
function runAll() {
  state.queue = ['hydro', 'thermal', 'wind', 'river'].filter((k) => {
    if (k === 'river') return state.erosion.river.rivers > 0;
    return true;
  });
  if (!state.running) pumpQueue();
}
function stopRun() {
  state.queue = [];
  worker.postMessage({ type: 'cancel' });
  log('stop requested');
}

// ---------------- build ----------------
async function rebuild() {
  if (state.running) { log('wait for erosion to finish'); return; }
  state.running = 'build';
  document.body.classList.add('busy');
  viewport.setRivers(null);
  viewport.clearParticles();
  log(`building ${state.project.resN}³ volume…`);
  await call('build', { project: state.project, layers: state.layers });
  state.running = null;
  document.body.classList.remove('busy');
  viewport.setSea(state.project.seaLevel, state.project.size, state.seaVisible);
  recolorSoon();
  autosave();
}
function markStale() {
  state.stale = true; updateBuildBtn();
  if (state.autoBuild) { clearTimeout(markStale.t); markStale.t = setTimeout(() => { if (state.stale && !state.running) rebuild(); }, 700); }
}
function updateBuildBtn() {
  const b = $('#buildBtn');
  b.classList.toggle('stale', state.stale);
  b.textContent = state.stale ? '⬢ Build *' : '⬢ Build';
}
function setBuildProgressWrap() {}

// ---------------- right: inspector ----------------
function renderInspector() {
  const host = $('#tab-layer');
  host.innerHTML = '';
  const l = state.layers.find((x) => x.id === state.selected);
  if (!l) { host.appendChild(el('div', 'empty', 'Select a layer in the stack.')); return; }
  const def = LAYERS[l.kind];
  host.appendChild(el('h3', '', `${def.icon} ${l.name}`));
  const opRow = el('div', 'srow');
  opRow.appendChild(el('span', 'slabel', 'Blend op'));
  const sel = el('select', 'sel');
  for (const o of def.ops) { const op = document.createElement('option'); op.value = o; op.textContent = o; if (l.op === o) op.selected = true; sel.appendChild(op); }
  sel.onchange = () => { l.op = sel.value; markStale(); renderLayers(); };
  opRow.appendChild(sel);
  host.appendChild(opRow);
  if (l.op === 'smooth') sliderRow(host, 'Blend radius', 0.5, 12, 0.5, () => l.k, (v) => { l.k = v; markStale(); });
  for (const p of def.params) {
    sliderRow(host, p.label, p.min, p.max, p.step, () => l.params[p.key], (v) => { l.params[p.key] = v; markStale(); });
  }
  toggleRow(host, 'Enabled', () => l.enabled, (v) => { l.enabled = v; markStale(); renderLayers(); });
}
function buildViewTab() {
  const host = $('#tab-view');
  host.innerHTML = '';
  const cm = el('div', 'srow');
  cm.appendChild(el('span', 'slabel', 'Color mode'));
  const sel = el('select', 'sel');
  for (const m of COLOR_MODES) { const o = document.createElement('option'); o.value = m; o.textContent = m; sel.appendChild(o); }
  sel.value = state.colorMode;
  sel.onchange = () => { state.colorMode = sel.value; recolorSoon(); };
  cm.appendChild(sel);
  host.appendChild(cm);
  sliderRow(host, 'Sea level', -5, 30, 0.25, () => state.project.seaLevel, (v) => {
    state.project.seaLevel = v;
    viewport.setSea(v, state.project.size, state.seaVisible);
    recolorSoon();
  });
  sliderRow(host, 'Snowline', 10, 60, 1, () => state.project.snowline, (v) => { state.project.snowline = v; recolorSoon(); });
  toggleRow(host, 'Show sea', () => state.seaVisible, (v) => { state.seaVisible = v; viewport.setSea(state.project.seaLevel, state.project.size, v); });
  toggleRow(host, 'Particles', () => state.showParticles, (v) => { state.showParticles = v; viewport.showParticles = v; if (!v) viewport.clearParticles(); });
  toggleRow(host, 'Wireframe', () => state.wireframe, (v) => { state.wireframe = v; viewport.setWireframe(v); });
  toggleRow(host, 'Clip plane (caves!)', () => state.clipOn, (v) => { state.clipOn = v; viewport.setClip(v ? state.clipY : null); });
  sliderRow(host, 'Clip Y', 0, 55, 0.5, () => state.clipY, (v) => { state.clipY = v; if (state.clipOn) viewport.setClip(v); });
  toggleRow(host, 'Auto-rotate', () => state.autoRotate, (v) => { state.autoRotate = v; viewport.setAutoRotate(v); });
  const rc = el('div', 'btnrow');
  const rb = el('button', 'btn small', '⌂ Reset camera');
  rb.onclick = () => viewport.resetCamera();
  const mb = el('button', 'btn small', '◈ Remesh');
  mb.onclick = async () => { await call('remesh'); log('remeshed'); };
  rc.append(rb, mb);
  host.appendChild(rc);
}
let recolorT = null;
function recolorSoon() {
  clearTimeout(recolorT);
  recolorT = setTimeout(() => {
    worker.postMessage({ type: 'recolor', id: msgSeq++, mode: state.colorMode, sea: state.project.seaLevel, snow: state.project.snowline });
  }, 120);
}
function buildProjectTab() {
  const host = $('#tab-project');
  host.innerHTML = '';
  const nm = el('div', 'srow');
  nm.appendChild(el('span', 'slabel', 'Name'));
  const ni = el('input', 'txt'); ni.value = state.project.name;
  ni.onchange = () => { state.project.name = ni.value; };
  nm.appendChild(ni);
  host.appendChild(nm);
  sliderRow(host, 'Seed', 0, 9999, 1, () => state.project.seed, (v) => { state.project.seed = v; markStale(); });
  const rr = el('div', 'srow');
  rr.appendChild(el('span', 'slabel', 'Resolution'));
  const rs = el('select', 'sel');
  for (const r of RESOLUTIONS) { const o = document.createElement('option'); o.value = r.n; o.textContent = `${r.label} (${r.mem})`; rs.appendChild(o); }
  rs.value = String(state.project.resN);
  rs.onchange = () => { state.project.resN = parseInt(rs.value); markStale(); };
  rr.appendChild(rs);
  host.appendChild(rr);
  sliderRow(host, 'Warp amp', 0, 10, 0.5, () => state.project.warpAmp, (v) => { state.project.warpAmp = v; markStale(); });
  sliderRow(host, 'Warp freq', 0.005, 0.06, 0.005, () => state.project.warpFreq, (v) => { state.project.warpFreq = v; markStale(); });
  toggleRow(host, 'Auto-build', () => state.autoBuild, (v) => { state.autoBuild = v; });
  host.appendChild(el('h4', '', 'Presets'));
  const pr = el('div', 'btnrow');
  for (const [key, p] of Object.entries(PRESETS)) {
    const b = el('button', 'btn small', p.name);
    b.title = p.blurb;
    b.onclick = () => applyPreset(key);
    pr.appendChild(b);
  }
  host.appendChild(pr);
  host.appendChild(el('h4', '', 'Save / load'));
  const sr = el('div', 'btnrow');
  const sv = el('button', 'btn small', '💾 Save JSON');
  sv.onclick = saveProject;
  const ld = el('button', 'btn small', '📂 Load JSON');
  ld.onclick = () => $('#fileInput').click();
  sr.append(sv, ld);
  host.appendChild(sr);
  host.appendChild(el('h4', '', 'Export'));
  const er = el('div', 'btnrow');
  const ob = el('button', 'btn small', '⬢ Mesh .OBJ');
  ob.onclick = exportOBJ;
  const hm = el('button', 'btn small', '🖼 Heightmap .PNG');
  hm.onclick = exportHeightmap;
  er.append(ob, hm);
  host.appendChild(er);
}

// ---------------- presets / save / export ----------------
function applyPreset(key) {
  const p = PRESETS[key];
  if (!p) return;
  Object.assign(state.project, p.project);
  state.layers = p.layers();
  state.erosion = p.erosion();
  state.selected = state.layers[0] ? state.layers[0].id : null;
  globalLedger = { eroded: 0, deposited: 0, particles: 0 };
  updateLedger();
  renderLayers(); renderInspector(); buildEroders(); buildViewTab(); buildProjectTab();
  $('#presetSel').value = key;
  log(`preset: ${p.name} — ${p.blurb}`);
  rebuild();
}
function serialize() {
  return JSON.stringify({ app: 'slate-terrain-lab', version: 1, project: state.project, layers: state.layers, erosion: state.erosion, colorMode: state.colorMode }, null, 1);
}
function saveProject() {
  download(state.project.name.replace(/\s+/g, '-').toLowerCase() + '.slate.json', serialize(), 'application/json');
  log('project saved');
}
function deserialize(json) {
  const d = JSON.parse(json);
  state.project = { ...defaultProject(), ...d.project };
  state.layers = d.layers || [];
  state.erosion = { ...defaultErosion(), ...d.erosion };
  state.colorMode = d.colorMode || 'material';
  state.selected = state.layers[0] ? state.layers[0].id : null;
  globalLedger = { eroded: 0, deposited: 0, particles: 0 };
  updateLedger();
  renderLayers(); renderInspector(); buildEroders(); buildViewTab(); buildProjectTab();
  rebuild();
}
function download(name, content, mime) {
  const b = content instanceof Blob ? content : new Blob([content], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(b);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
async function exportOBJ() {
  log('exporting OBJ…');
  const m = await call('exportObj');
  download(state.project.name.replace(/\s+/g, '-').toLowerCase() + '.obj', m.text, 'text/plain');
  log(`OBJ exported (${(m.text.length / 1048576).toFixed(1)} MB)`);
}
async function exportHeightmap() {
  log('rendering heightmap…');
  const m = await call('heightmap');
  const { w, h, data } = m;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < data.length; i++) { const v = data[i]; if (v > -1e8) { if (v < mn) mn = v; if (v > mx) mx = v; } }
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    let g = v < -1e8 ? 0 : Math.round((255 * (v - mn)) / Math.max(1e-6, mx - mn));
    img.data[i * 4] = g; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = g; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  cv.toBlob((b) => download(state.project.name.replace(/\s+/g, '-').toLowerCase() + '-height.png', b, 'image/png'));
  log(`heightmap ${w}×${h} exported`);
}
let saveT = null;
function autosave() {
  clearTimeout(saveT);
  saveT = setTimeout(() => { try { localStorage.setItem('slate-terrain-lab', serialize()); } catch (e) { /* quota */ } }, 800);
}
function autoload() {
  try {
    const s = localStorage.getItem('slate-terrain-lab');
    if (!s) return false;
    const d = JSON.parse(s);
    if (d.app !== 'slate-terrain-lab') return false;
    state.project = { ...defaultProject(), ...d.project };
    state.layers = d.layers || [];
    state.erosion = { ...defaultErosion(), ...d.erosion };
    state.colorMode = d.colorMode || 'material';
    state.selected = state.layers[0] ? state.layers[0].id : null;
    return state.layers.length > 0;
  } catch (e) { return false; }
}

// ---------------- tabs / header ----------------
function initTabs() {
  document.querySelectorAll('.tabbtn').forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll('.tabbtn').forEach((x) => x.classList.remove('on'));
      document.querySelectorAll('.tab').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      $('#tab-' + b.dataset.tab).classList.add('on');
    };
  });
}
function initHeader() {
  const ps = $('#presetSel');
  for (const [key, p] of Object.entries(PRESETS)) {
    const o = document.createElement('option');
    o.value = key; o.textContent = p.name;
    ps.appendChild(o);
  }
  ps.onchange = () => applyPreset(ps.value);
  $('#buildBtn').onclick = rebuild;
  $('#runAllBtn').onclick = runAll;
  $('#stopBtn').onclick = stopRun;
  const rs = $('#resSel');
  for (const r of RESOLUTIONS) { const o = document.createElement('option'); o.value = r.n; o.textContent = r.label; rs.appendChild(o); }
  rs.value = String(state.project.resN);
  rs.onchange = () => { state.project.resN = parseInt(rs.value); markStale(); buildProjectTab(); };
  $('#diagBtn').onclick = () => {
    const gl = viewport.renderer.getContext();
    log(`diag: ${gl.getParameter(gl.VERSION)} · ${gl.getParameter(gl.RENDERER)} · field ${(state.project.resN * Math.round(state.project.resN / 2) * state.project.resN * 16 / 1048576).toFixed(0)}MB · tris ${fmtInt(stats.tris)}`);
  };
  $('#fileInput').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => { try { deserialize(r.result); log(`loaded ${f.name}`); } catch (err) { log('load failed: ' + err.message); } };
    r.readAsText(f);
    e.target.value = '';
  };
  $('#collapseL').onclick = () => document.body.classList.toggle('hideL');
  $('#collapseR').onclick = () => document.body.classList.toggle('hideR');
}

// ---------------- boot ----------------
function boot() {
  viewport = new Viewport($('#gl'), (fps) => { $('#fps').textContent = fps + ' fps'; });
  viewport.showParticles = state.showParticles;
  initHeader(); initTabs(); initAddLayer();
  const had = autoload();
  if (!had) {
    const p = PRESETS.canyon;
    Object.assign(state.project, p.project);
    state.layers = p.layers();
    state.erosion = p.erosion();
    state.selected = state.layers[0].id;
  }
  $('#presetSel').value = 'canyon';
  $('#resSel').value = String(state.project.resN);
  renderLayers(); renderInspector(); buildEroders(); buildViewTab(); buildProjectTab();
  viewport.setSea(state.project.seaLevel, state.project.size, state.seaVisible);
  updateLedger(); updateStatsChip();
  log(had ? 'restored autosave — building…' : 'welcome to Slate Terrain Lab — building canyon preset…');
  rebuild();
}
boot();
