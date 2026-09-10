// STRATA boot + UI wiring + simulation loop.
import { SdfField } from './sdf.js';
import { surfaceNets, buildRiverRibbons, scanHeightmap } from './mesher.js';
import { FlowMap, defaultHydro, defaultThermal, defaultWind } from './erosion.js';
import { Graph, Evaluator, NODE_DEFS, CATS, PRESETS, defaultParams } from './graph.js';
import { Viewport } from './viewport.js';
import { NodeEditor } from './editor.js';

const $ = id => document.getElementById(id);
const bootMsg = m => { $('bootMsg').textContent = m; };

// ---------------------------------------------------------------- state
const S = {
  res: 80, playing: true, speed: 1,
  water: 12, shade: 0, sliceY: 55, sliceOn: false,
  showDrops: true, showWind: true, showWater: true, showWire: false, showGrid: true,
  dropSize: 3.2, dropCap: 24000, remeshMs: 450, autoRemesh: true,
  sunAz: 135, sunEl: 42, exposure: 1.05,
  sel: null, lastMesh: null, lastEvalMs: 0,
};
let field, flowmap, graph, evaluator, viewport, editor;
let remeshTimer = 0, statTimer = 0, rebuildDeb = null, fpsEMA = 60, simTime = 0;

// ---------------------------------------------------------------- helpers
function toast(msg, kind = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 2600);
}
function hydroP(n) {
  const p = n.params, d = defaultHydro();
  return { ...d, spawn: p.spawn, rate: p.rate, sources: p.sources, capacity: p.capacity, erode: p.erode,
    deposit: p.deposit, evap: p.evap, lateral: p.lateral, radius: p.radius, maxLife: p.life,
    riverWidth: p.riverW, useRivers: p.rivers };
}
function thermalP(n) { return { ...defaultThermal(), talus: n.params.talus, rate: n.params.rate, samples: n.params.samples }; }
function windP(n) {
  const p = n.params, d = defaultWind();
  return { ...d, direction: p.direction, speed: p.speed, turbulence: p.turb, rate: p.rate, abrade: p.abrade, deposit: p.deposit };
}
function eroNodes() { return [...graph.nodes.values()].filter(n => n.sim && !n.bypass && !n.err); }

// ---------------------------------------------------------------- build / remesh
function fullEvaluate(reason = '') {
  const t0 = performance.now();
  evaluator.evaluate(graph);
  // refresh river sources for hydro nodes
  for (const n of graph.nodes.values()) {
    if (n.type === 'hydraulic' && n.sim) n.sim.sources = evaluator.computeSources(graph, n, n.params.sources || 4);
  }
  S.lastEvalMs = performance.now() - t0;
  $('graphStatus').textContent = `${graph.nodes.size} nodes · ${graph.links.length} links · eval ${S.lastEvalMs.toFixed(0)} ms${reason ? ' · ' + reason : ''}`;
  const out = [...graph.nodes.values()].find(n => n.type === 'output');
  $('vpBadge').classList.toggle('on', !!(out && out.err));
  if (out && out.err) $('vpBadge').textContent = '⚠ ' + out.err;
  refreshLayers();
}
function remesh(reason = '') {
  const t0 = performance.now();
  const m = surfaceNets(field);
  S.lastMeshMs = performance.now() - t0;
  S.lastMesh = m;
  viewport.setTerrain(m);
  const rivers = [];
  for (const n of graph.nodes.values()) {
    if (n.type === 'hydraulic' && n.sim && n.params.rivers) rivers.push(...n.sim.engine.rivers);
  }
  rivers.sort((a, b) => b.score - a.score);
  viewport.setRivers(buildRiverRibbons(rivers.slice(0, 40)));
}
function syncRemesh(reason = '') { // during play: refresh erosion caches + downstream, then remesh
  for (const n of eroNodes()) evaluator.markDirty(graph, n.id);
  evaluator.evaluate(graph);
  remesh(reason);
}
function scheduleRebuild() { // debounced geometry rebuild (sliders)
  clearTimeout(rebuildDeb);
  rebuildDeb = setTimeout(() => {
    fullEvaluate('rebuilt'); remesh();
    flowmap.reproject(field);
  }, 160);
}

// ---------------------------------------------------------------- sim step
function simStep(dt) {
  simTime += dt;
  const dt60 = dt * 60;
  for (const n of eroNodes()) {
    n.sim.active = true;
    if (n.type === 'hydraulic') {
      const P = hydroP(n), e = n.sim.engine;
      e.spawn(field, Math.max(1, Math.round(P.rate * dt60 / 1)), P.spawn, P, n.sim.sources);
      e.step(field, flowmap, dt, P, n.sim, S.water);
    } else if (n.type === 'thermal') {
      const P = thermalP(n);
      n.sim.engine.step(field, Math.round(P.samples * dt60), P, n.sim);
    } else if (n.type === 'wind') {
      const P = windP(n), e = n.sim.engine;
      e.spawn(field, Math.max(1, Math.round(P.rate * dt60)), P);
      e.step(field, dt, P, n.sim);
    }
  }
  flowmap.decay(0.9996);
  // push live particle buffers (merged across nodes)
  const P0 = getHydroMerge();
  viewport.updateHydro(P0.pos, P0.col, Math.min(P0.count, S.dropCap));
  const W0 = getWindMerge();
  viewport.updateWind(W0.seg, W0.count);
  if (flowmap.dirty) viewport.setFlowBytes(flowmap.quantize());
}
const _hp = { pos: new Float32Array(24000 * 3), col: new Float32Array(24000 * 3), count: 0 };
function getHydroMerge() {
  _hp.count = 0;
  for (const n of eroNodes()) {
    if (n.type !== 'hydraulic') continue;
    const e = n.sim.engine, take = Math.min(e.rCount, 24000 - _hp.count);
    if (take <= 0) break;
    _hp.pos.set(e.rPos.subarray(0, take * 3), _hp.count * 3);
    _hp.col.set(e.rCol.subarray(0, take * 3), _hp.count * 3);
    _hp.count += take;
  }
  return _hp;
}
const _wp = { seg: new Float32Array(6000 * 6), count: 0 };
function getWindMerge() {
  _wp.count = 0;
  for (const n of eroNodes()) {
    if (n.type !== 'wind') continue;
    const e = n.sim.engine, take = Math.min(e.segN, 6000 - _wp.count);
    if (take <= 0) break;
    _wp.seg.set(e.seg.subarray(0, take * 6), _wp.count * 6);
    _wp.count += take;
  }
  return _wp;
}
function resetSimNode(n) {
  if (!n.sim) return;
  if (n.sim.delta) { n.sim.delta.fill(0); n.sim.flowA.fill(0); n.sim.sedA.fill(0); }
  n.sim.engine.reset();
  n.sim.sources = n.type === 'hydraulic' ? evaluator.computeSources(graph, n, n.params.sources || 4) : [];
  evaluator.markDirty(graph, n.id);
  fullEvaluate(); remesh(); flowmap.reproject(field);
}
function resetAllSims() {
  for (const n of graph.nodes.values()) if (n.sim) {
    if (n.sim.delta) { n.sim.delta.fill(0); n.sim.flowA.fill(0); n.sim.sedA.fill(0); }
    n.sim.engine.reset();
  }
  fullEvaluate('sims reset'); remesh(); flowmap.reproject(field);
  viewport.clearHydro(); viewport.clearWind();
  toast('All erosion simulations reset', 'good');
}

// ---------------------------------------------------------------- main loop
let lastT = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  let dt = Math.min(0.1, (now - lastT) / 1000);
  lastT = now;
  fpsEMA += ((1 / Math.max(1e-3, dt)) - fpsEMA) * 0.05;
  if (S.playing) {
    for (let s = 0; s < S.speed; s++) simStep(Math.min(dt, 1 / 30));
    remeshTimer += dt * 1000;
    if (S.autoRemesh && remeshTimer > S.remeshMs) { remeshTimer = 0; syncRemesh('live'); }
  }
  statTimer += dt * 1000;
  if (statTimer > 250) { statTimer = 0; updateStats(); }
  viewport.render(now / 1000);
  editor.draw();
}
function updateStats() {
  $('fpsChip').textContent = `${fpsEMA.toFixed(0)} fps`;
  $('triChip').textContent = `${(viewport.tris / 1000).toFixed(0)}k tris`;
  $('stFps').textContent = `${fpsEMA.toFixed(0)} fps`;
  $('stTris').textContent = `${(viewport.tris / 1000).toFixed(1)}k tris · ${(S.lastMesh ? (S.lastMesh.verts / 1000).toFixed(1) : 0)}k verts`;
  $('stVox').textContent = `SDF ${S.res}³ · eval ${S.lastEvalMs.toFixed(0)} ms · mesh ${(S.lastMeshMs || 0).toFixed(0)} ms`;
  let alive = 0, drops = 0, E = 0, D = 0;
  for (const n of graph.nodes.values()) {
    if (!n.sim) continue;
    const e = n.sim.engine;
    if (n.type === 'hydraulic' || n.type === 'wind') { alive += e.alive || 0; }
    drops += e.drops || 0; E += e.eroded || 0; D += e.deposited || 0;
    if (n.type === 'thermal') { E += e.moved * 0.5; D += e.moved * 0.5; }
  }
  $('stPart').textContent = `${alive.toLocaleString()} alive`;
  $('simClock').textContent = `${drops.toLocaleString()} drops`;
  const net = D - E;
  $('stMass').textContent = `E ${E.toFixed(1)} ▸ D ${D.toFixed(1)} · Δ ${net >= 0 ? '+' : ''}${net.toFixed(1)}`;
  $('stMass').style.color = Math.abs(net) < Math.max(1, E * 0.3) ? 'var(--good)' : 'var(--acc2)';
}

// ---------------------------------------------------------------- palette / layers
function buildPalette(filter = '') {
  const pal = $('palette'); pal.innerHTML = '';
  const f = filter.trim().toLowerCase();
  for (const [ck, cat] of Object.entries(CATS)) {
    const items = Object.entries(NODE_DEFS).filter(([t, d]) => d.cat === ck &&
      (!f || d.title.toLowerCase().includes(f) || t.includes(f)));
    if (!items.length) continue;
    const h = document.createElement('div');
    h.className = 'pal-cat'; h.innerHTML = `<i style="background:${cat.color}"></i>${cat.label.toUpperCase()}`;
    pal.appendChild(h);
    for (const [t, d] of items) {
      const b = document.createElement('button');
      b.className = 'pal-item';
      b.innerHTML = `<span class="pal-dot" style="background:${cat.color}"></span><span><b>${d.title}</b><small>${d.desc}</small></span>`;
      b.onclick = () => addNodeAtCenter(t);
      pal.appendChild(b);
    }
  }
}
function addNodeAtCenter(type, wx = null, wy = null) {
  const r = $('graph').getBoundingClientRect();
  const cx = wx ?? (r.width / 2 - editor.pan.x) / editor.zoom - 84;
  const cy = wy ?? (r.height / 2 - editor.pan.y) / editor.zoom - 40;
  const n = graph.addNode(type, cx + (Math.random() - 0.5) * 30, cy + (Math.random() - 0.5) * 30);
  editor.sel.clear(); editor.sel.add(n.id);
  selectNode(n);
  if (n.sim) { evaluator.ensureCache(n); if (n.type === 'hydraulic') n.sim.sources = evaluator.computeSources(graph, n, n.params.sources || 4); }
  fullEvaluate(); remesh();
  return n;
}
function refreshLayers() {
  const el = $('layers'); el.innerHTML = '';
  const order = graph.topo();
  $('layerCount').textContent = `· ${order.length}`;
  order.forEach((n, i) => {
    const d = NODE_DEFS[n.type];
    const row = document.createElement('div');
    row.className = 'layer-row' + (S.sel && S.sel.id === n.id ? ' sel' : '');
    const badge = n.err ? '<span class="badge err">err</span>' : n.sim ? '<span class="badge sim">sim</span>' : n.dirty ? '<span class="badge dirty">…</span>' : '';
    row.innerHTML = `<span class="pal-dot" style="background:${CATS[d.cat].color}"></span><span class="t">${d.title}</span>${badge}<span class="n">#${n.id}</span><button class="eye ${n.bypass ? 'off' : ''}" title="Bypass">👁</button>`;
    row.onclick = e => {
      if (e.target.classList.contains('eye')) {
        n.bypass = !n.bypass;
        evaluator.markDirty(graph, n.id); fullEvaluate(); remesh();
        refreshLayers(); buildInspector();
        return;
      }
      editor.sel.clear(); editor.sel.add(n.id); selectNode(n);
    };
    el.appendChild(row);
  });
}

// ---------------------------------------------------------------- inspector
function ctlSlider(body, label, min, max, step, val, on) {
  const d = document.createElement('div'); d.className = 'ctl';
  d.innerHTML = `<div class="ctl-head"><label>${label}</label><output>${val}</output></div>`;
  const r = document.createElement('input');
  r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = val;
  const o = d.querySelector('output');
  r.oninput = () => { o.textContent = r.value; on(parseFloat(r.value)); };
  d.appendChild(r); body.appendChild(d);
  return r;
}
function ctlInt(body, label, min, max, val, on) {
  const d = document.createElement('div'); d.className = 'ctl';
  d.innerHTML = `<div class="ctl-head"><label>${label}</label></div>`;
  const r = document.createElement('input');
  r.type = 'number'; r.min = min; r.max = max; r.step = 1; r.value = val;
  r.oninput = () => on(Math.round(parseFloat(r.value) || min));
  d.appendChild(r); body.appendChild(d);
}
function ctlSelect(body, label, opts, val, on) {
  const d = document.createElement('div'); d.className = 'ctl';
  d.innerHTML = `<div class="ctl-head"><label>${label}</label></div>`;
  const s = document.createElement('select');
  for (const o of opts) { const op = document.createElement('option'); op.value = o; op.textContent = o; s.appendChild(op); }
  s.value = val; s.onchange = () => on(s.value);
  d.appendChild(s); body.appendChild(d);
}
function ctlBool(body, label, val, on) {
  const l = document.createElement('label'); l.className = 'chk';
  const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!val;
  c.onchange = () => on(c.checked);
  l.appendChild(c); l.appendChild(document.createTextNode(label));
  body.appendChild(l);
}
function selectNode(n) {
  S.sel = n;
  buildInspector();
  refreshLayers();
}
function buildInspector() {
  const body = $('inspBody'); body.innerHTML = '';
  const n = S.sel;
  if (!n || !graph.nodes.has(n.id)) {
    $('inspTitle').textContent = 'Nothing selected';
    $('inspType').textContent = '';
    body.innerHTML = '<p class="dim">Select a node in the graph to edit its parameters.<br><br>Double-click empty canvas to quick-add.</p>';
    return;
  }
  const def = NODE_DEFS[n.type];
  $('inspTitle').textContent = def.title + '  #' + n.id;
  $('inspType').textContent = '· ' + CATS[def.cat].label;
  const isGeo = !n.sim && n.type !== 'output';
  for (const p of (def.params || [])) {
    const set = v => {
      n.params[p.key] = v;
      if (isGeo) { evaluator.markDirty(graph, n.id); scheduleRebuild(); }
      else if (n.type === 'hydraulic' && p.key === 'sources') n.sim.sources = evaluator.computeSources(graph, n, v);
    };
    if (p.type === 'slider') ctlSlider(body, p.label, p.min, p.max, p.step, n.params[p.key], set);
    else if (p.type === 'int') ctlInt(body, p.label, p.min, p.max, n.params[p.key], set);
    else if (p.type === 'select') ctlSelect(body, p.label, p.opts, n.params[p.key], set);
    else if (p.type === 'bool') ctlBool(body, p.label, n.params[p.key], set);
  }
  if (n.sim) {
    const d = document.createElement('div'); d.className = 'hr'; body.appendChild(d);
    const e = n.sim.engine;
    const kv = document.createElement('div');
    const E = e.eroded || 0, D = e.deposited || (e.moved || 0);
    kv.innerHTML = `<div class="kv"><span>eroded</span><b>${E.toFixed(1)}</b></div>
      <div class="kv"><span>deposited</span><b>${D.toFixed(1)}</b></div>
      <div class="kv"><span>alive</span><b>${e.alive || '—'}</b></div>
      ${e.rivers ? `<div class="kv"><span>rivers</span><b>${e.rivers.length}</b></div>` : ''}`;
    body.appendChild(kv);
  }
  const row = document.createElement('div'); row.className = 'row-btns';
  const mk = (label, fn, cls = '') => { const b = document.createElement('button'); b.className = 'tbtn ' + cls; b.textContent = label; b.onclick = fn; row.appendChild(b); };
  mk(n.bypass ? 'Unbypass' : 'Bypass', () => { n.bypass = !n.bypass; evaluator.markDirty(graph, n.id); fullEvaluate(); remesh(); buildInspector(); });
  if (n.sim) mk('Reset sim', () => { resetSimNode(n); buildInspector(); toast('Sim reset', 'good'); });
  if (n.type !== 'output') mk('Delete', () => deleteSelected(), 'warn');
  body.appendChild(row);
  if (n.err) { const p = document.createElement('p'); p.className = 'dim small'; p.style.color = 'var(--warn)'; p.textContent = '⚠ ' + n.err; body.appendChild(p); }
}
function deleteSelected() {
  const ids = [...editor.sel].filter(id => graph.nodes.get(id)?.type !== 'output');
  if (!ids.length) return;
  for (const id of ids) graph.removeNode(id);
  editor.sel.clear(); selectNode(null);
  fullEvaluate(); remesh();
}

// ---------------------------------------------------------------- side panels
function buildSidePanels() {
  const sim = $('simBody'); sim.innerHTML = '';
  ctlSlider(sim, 'Remesh interval (ms)', 120, 2000, 10, S.remeshMs, v => S.remeshMs = v);
  ctlBool(sim, 'Auto remesh while simulating', S.autoRemesh, v => S.autoRemesh = v);
  const row = document.createElement('div'); row.className = 'row-btns';
  const b1 = document.createElement('button'); b1.className = 'tbtn warn'; b1.textContent = 'Reset all sims';
  b1.onclick = resetAllSims; row.appendChild(b1);
  const b2 = document.createElement('button'); b2.className = 'tbtn'; b2.textContent = 'Remesh now';
  b2.onclick = () => { syncRemesh('manual'); }; row.appendChild(b2);
  sim.appendChild(row);
  const tip = document.createElement('p'); tip.className = 'dim small';
  tip.textContent = 'Droplets settle on death: remaining sediment is deposited locally, so channels stabilise instead of drilling forever.';
  sim.appendChild(tip);

  const part = $('partBody'); part.innerHTML = '';
  ctlBool(part, 'Show droplets', S.showDrops, v => { S.showDrops = v; viewport.showParticles(v); $('tgParticles').classList.toggle('active', v); });
  ctlSlider(part, 'Droplet size', 1, 9, 0.1, S.dropSize, v => { S.dropSize = v; viewport.setParticleSize(v); });
  ctlSlider(part, 'Display cap', 2000, 24000, 1000, S.dropCap, v => S.dropCap = v);
  ctlBool(part, 'Show wind streaks', S.showWind, v => { S.showWind = v; viewport.showWind(v); $('tgWind').classList.toggle('active', v); });
  const leg = document.createElement('div');
  leg.innerHTML = `<div class="kv"><span><i style="color:#ff8c33">●</i> eroding</span><b>cutting</b></div>
    <div class="kv"><span><i style="color:#4dd2ff">●</i> depositing</span><b>settling</b></div>
    <div class="kv"><span><i style="color:#739eff">●</i> airborne</span><b>falling</b></div>`;
  part.appendChild(leg);

  const wat = $('waterBody'); wat.innerHTML = '';
  ctlSlider(wat, 'Water level', 0, 60, 0.25, S.water, v => { S.water = v; viewport.setWaterLevel(v); if (S.autoRemesh) remesh(); });
  ctlBool(wat, 'Show water + rivers', S.showWater, v => { S.showWater = v; viewport.showWater(v); $('tgWater').classList.toggle('active', v); });
  ctlSlider(wat, 'Sun azimuth°', 0, 360, 1, S.sunAz, v => { S.sunAz = v; viewport.setSun(S.sunAz, S.sunEl); });
  ctlSlider(wat, 'Sun elevation°', 5, 90, 1, S.sunEl, v => { S.sunEl = v; viewport.setSun(S.sunAz, S.sunEl); });
  ctlSlider(wat, 'Exposure', 0.4, 2, 0.01, S.exposure, v => { S.exposure = v; viewport.setExposure(v); });
}

// ---------------------------------------------------------------- export
function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function exportOBJ() {
  const m = S.lastMesh;
  if (!m || !m.positions.length) { toast('Nothing to export', 'warn'); return; }
  let s = '# STRATA SDF terrain export\n';
  const P = m.positions, N = m.normals, Ix = m.index;
  for (let i = 0; i < P.length; i += 3) s += `v ${P[i].toFixed(3)} ${P[i + 1].toFixed(3)} ${P[i + 2].toFixed(3)}\n`;
  for (let i = 0; i < N.length; i += 3) s += `vn ${N[i].toFixed(4)} ${N[i + 1].toFixed(4)} ${N[i + 2].toFixed(4)}\n`;
  for (let i = 0; i < Ix.length; i += 3) s += `f ${Ix[i] + 1}//${Ix[i] + 1} ${Ix[i + 1] + 1}//${Ix[i + 1] + 1} ${Ix[i + 2] + 1}//${Ix[i + 2] + 1}\n`;
  download('strata-terrain.obj', new Blob([s], { type: 'text/plain' }));
  toast(`Mesh exported (${(m.tris / 1000).toFixed(0)}k tris)`, 'good');
}
function exportHeight() {
  const size = 512, h = scanHeightmap(field, size);
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const cx = cv.getContext('2d'), img = cx.createImageData(size, size);
  for (let i = 0; i < h.length; i++) {
    const v = h[i] < 0 ? 0 : Math.round(255 * Math.min(1, h[i] / field.h));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  cx.putImageData(img, 0, 0);
  cv.toBlob(b => { download('strata-height.png', b); toast('Heightmap exported', 'good'); });
}
function exportFlow() {
  const n = flowmap.n, bytes = flowmap.quantize();
  const cv = document.createElement('canvas'); cv.width = cv.height = n;
  const cx = cv.getContext('2d'), img = cx.createImageData(n, n);
  img.data.set(bytes); cx.putImageData(img, 0, 0);
  cv.toBlob(b => { download('strata-flow.png', b); toast('Flowmap exported (R=discharge GB=dir)', 'good'); });
}
function exportJSON() {
  const data = { app: 'strata', v: 1, res: S.res, water: S.water, graph: graph.serialize() };
  download('strata-project.json', new Blob([JSON.stringify(data)], { type: 'application/json' }));
  toast('Project saved', 'good');
}
function importJSON(obj) {
  try {
    if (obj.res && obj.res !== S.res) setRes(obj.res, true);
    graph.deserialize(obj.graph || { nodes: [], links: [] });
    if (obj.water !== undefined) { S.water = obj.water; viewport.setWaterLevel(S.water); }
    editor.sel.clear(); selectNode(null);
    fullEvaluate('loaded'); remesh(); flowmap.reproject(field);
    editor.fit();
    toast('Project loaded', 'good');
  } catch (e) { toast('Load failed: ' + e.message, 'err'); }
}

// ---------------------------------------------------------------- res / presets / modal
function setRes(res, silent = false) {
  S.res = res; $('resSelect').value = String(res);
  field = new SdfField(res, 100, 80);
  evaluator.setField(field);
  for (const n of graph.nodes.values()) { n.cacheD = null; n.cacheH = null; n.dirty = true; if (n.sim) { n.sim.delta = null; n.sim.flowA = null; n.sim.sedA = null; n.sim.engine.reset(); } }
  fullEvaluate(); remesh(); flowmap.reset();
  if (!silent) toast(`SDF resolution ${res}³ — sims reset (deltas are resolution-bound)`, 'warn');
}
function loadPreset(key) {
  graph = new Graph();
  editor.g = graph;
  PRESETS[key].build(graph);
  editor.sel.clear(); selectNode(null);
  fullEvaluate(); remesh(); editor.fit();
}
function showPresets() {
  const mc = $('modalCard');
  mc.innerHTML = `<h2>New landscape</h2><div class="sub">Pick a starting point — every graph is fully editable, and erosion simulates live on the volume.</div><div class="preset-grid"></div><div class="modal-btns"><button class="tbtn" id="mClose">Keep current</button></div>`;
  const grid = mc.querySelector('.preset-grid');
  for (const [k, p] of Object.entries(PRESETS)) {
    const b = document.createElement('button');
    b.className = 'preset'; b.innerHTML = `<b>${p.label}</b><span>${p.desc}</span>`;
    b.onclick = () => { loadPreset(k); closeModal(); toast(p.label + ' loaded — press Space to erode', 'good'); };
    grid.appendChild(b);
  }
  mc.querySelector('#mClose').onclick = closeModal;
  $('modal').classList.remove('hidden');
}
function showHelp() {
  const mc = $('modalCard');
  mc.innerHTML = `<h2>STRATA workflow</h2>
  <div class="sub">Volumetric SDF terrain: caves, arches and overhangs are real geometry — not a heightmap.</div>
  <ul class="help-list">
    <li><b>Build</b> — chain Sources → Modify → Combine → Carve. Double-click the graph to quick-add, drag sockets to connect.</li>
    <li><b>Erode live</b> — add Hydraulic / Thermal / Wind nodes, press <kbd>Space</kbd>. Orange drops cut, cyan drops settle, blue drops fall (waterfalls).</li>
    <li><b>Settling</b> — every droplet deposits its remaining load on death, so rivers stabilise instead of drilling to the void. Watch mass balance Δ in the status bar.</li>
    <li><b>Rivers</b> — high-discharge trails become ribbon meshes; the water shader scrolls along the live flow field. Lower droplets drown &amp; sediment in lakes.</li>
    <li><b>Wind</b> — sandblasts windward faces, dumps dunes on leeward shadows. Slice view (<i>Cut</i>) reveals caves.</li>
    <li><b>Inspect</b> — keys <kbd>1</kbd>–<kbd>7</kbd> switch shading (solid/clay/height/slope/flow/hardness/normal).</li>
    <li><b>Export</b> — OBJ mesh, heightmap, flowmap (for engine water shaders), project JSON.</li>
  </ul>
  <div class="modal-btns"><button class="tbtn primary" id="mClose">Back to work</button></div>`;
  mc.querySelector('#mClose').onclick = closeModal;
  $('modal').classList.remove('hidden');
}
function closeModal() { $('modal').classList.add('hidden'); }

// ---------------------------------------------------------------- boot
function bindChrome() {
  $('tPlay').onclick = () => setPlaying(!S.playing);
  $('tStep').onclick = () => { if (S.playing) setPlaying(false); simStep(1 / 60); syncRemesh('step'); };
  $('tReset').onclick = resetAllSims;
  $('tSpeed').onchange = e => S.speed = parseFloat(e.target.value);
  $('resSelect').onchange = e => setRes(parseInt(e.target.value));
  $('btnRebuild').onclick = () => { fullEvaluate('manual'); remesh(); flowmap.reproject(field); toast('Rebuilt', 'good'); };
  $('btnNew').onclick = () => { loadPreset('empty'); toast('New empty graph'); };
  $('btnPresets').onclick = showPresets;
  $('btnSave').onclick = exportJSON;
  $('btnOpen').onclick = () => $('fileOpen').click();
  $('fileOpen').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    f.text().then(t => importJSON(JSON.parse(t)));
    e.target.value = '';
  };
  $('btnHelp').onclick = showHelp;
  // left tabs
  document.querySelectorAll('.stab').forEach(b => b.onclick = () => {
    document.querySelectorAll('.stab').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    $('tab-nodes').classList.toggle('hidden', b.dataset.tab !== 'nodes');
    $('tab-layers').classList.toggle('hidden', b.dataset.tab !== 'layers');
  });
  $('paletteSearch').oninput = e => buildPalette(e.target.value);
  // viewport toolbar
  document.querySelectorAll('[data-shade]').forEach(b => b.onclick = () => setShade(parseInt(b.dataset.shade)));
  const tog = (id, key, fn) => $(id).onclick = () => { S[key] = !S[key]; $(id).classList.toggle('active', S[key]); fn(S[key]); };
  tog('tgParticles', 'showDrops', v => viewport.showParticles(v));
  tog('tgWind', 'showWind', v => viewport.showWind(v));
  tog('tgWater', 'showWater', v => viewport.showWater(v));
  tog('tgWire', 'showWire', v => viewport.showWire(v));
  tog('tgGrid', 'showGrid', v => viewport.showGrid(v));
  tog('tgSlice', 'sliceOn', () => viewport.setSlice(S.sliceY, S.sliceOn));
  $('sliceY').oninput = e => { S.sliceY = parseFloat(e.target.value); $('sliceVal').textContent = S.sliceY; viewport.setSlice(S.sliceY, S.sliceOn); };
  document.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => viewport.focusView(b.dataset.cam));
  // graph bar
  $('btnAdd').onclick = () => quickAddAtCenter();
  $('btnFit').onclick = () => editor.fit();
  $('btnAuto').onclick = () => { editor.autoLayout(); editor.fit(); };
  // export
  $('exObj').onclick = exportOBJ; $('exHeight').onclick = exportHeight;
  $('exFlow').onclick = exportFlow; $('exJson').onclick = exportJSON;
  // splitter
  const sp = $('splitter'), vw = $('viewportWrap'), gw = $('graphWrap');
  let drag = false, y0 = 0, f0 = 1.25;
  sp.addEventListener('pointerdown', e => { drag = true; y0 = e.clientY; f0 = parseFloat(vw.style.flexGrow || 1.25); sp.setPointerCapture(e.pointerId); });
  sp.addEventListener('pointermove', e => {
    if (!drag) return;
    const total = vw.parentElement.clientHeight - 7;
    const f = Math.min(6, Math.max(0.35, f0 + (e.clientY - y0) / (total / 7.35)));
    vw.style.flexGrow = f; gw.style.flexGrow = 7.35 - f + 0; // keep sum-ish
    gw.style.flexGrow = Math.max(0.35, 2.25 - (f - 1.25));
    editor.resize();
  });
  sp.addEventListener('pointerup', () => { drag = false; editor.resize(); });
  // keyboard
  window.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.code === 'Space') { e.preventDefault(); setPlaying(!S.playing); }
    else if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
    else if (e.key === 'f' || e.key === 'F') editor.fit();
    else if (e.key === 'h' || e.key === 'H' || e.key === '?') showHelp();
    else if (e.key >= '1' && e.key <= '7') setShade(parseInt(e.key) - 1);
    else if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); exportJSON(); }
    else if (e.key === 'Escape') { closeModal(); hideQuickAdd(); }
  });
  window.addEventListener('resize', () => editor.resize());
  $('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
}
function setPlaying(v) {
  S.playing = v;
  $('tPlay').textContent = v ? '⏸' : '▶';
  $('tPlay').classList.toggle('paused', !v);
  if (!v) syncRemesh('paused'); // settle caches + mesh on pause
}
function setShade(m) {
  S.shade = m;
  document.querySelectorAll('[data-shade]').forEach(b => b.classList.toggle('active', parseInt(b.dataset.shade) === m));
  viewport.setShade(m);
}
// quick add popup
function quickAddAtCenter() {
  const r = $('graph').getBoundingClientRect();
  showQuickAdd(r.width / 2, r.height / 2 - 100, (r.width / 2 - editor.pan.x) / editor.zoom - 84, (r.height / 2 - editor.pan.y) / editor.zoom - 40);
}
function showQuickAdd(px, py, wx, wy) {
  const q = $('quickAdd');
  q.innerHTML = '<input placeholder="type to filter…" autocomplete="off">';
  const list = document.createElement('div'); q.appendChild(list);
  const inp = q.querySelector('input');
  const render = (f = '') => {
    list.innerHTML = '';
    const fl = f.toLowerCase();
    for (const [t, d] of Object.entries(NODE_DEFS)) {
      if (fl && !d.title.toLowerCase().includes(fl)) continue;
      const b = document.createElement('button');
      b.className = 'qa-item';
      b.innerHTML = `<span class="pal-dot" style="background:${CATS[d.cat].color}"></span>${d.title}<small>${CATS[d.cat].label}</small>`;
      b.onclick = () => { addNodeAtCenter(t, wx, wy); hideQuickAdd(); };
      list.appendChild(b);
    }
  };
  render();
  inp.oninput = () => render(inp.value);
  inp.onkeydown = e => {
    if (e.key === 'Enter') { const first = list.querySelector('.qa-item'); if (first) first.click(); }
  };
  const wrap = $('graphWrap').getBoundingClientRect();
  q.style.left = Math.min(wrap.width - 240, Math.max(8, px)) + 'px';
  q.style.top = Math.max(40, py) + 'px';
  q.classList.remove('hidden');
  setTimeout(() => inp.focus(), 30);
}
function hideQuickAdd() { $('quickAdd').classList.add('hidden'); }
// node context menu
let ctxMenu = null;
function showNodeMenu(n, cx, cy) {
  hideNodeMenu();
  ctxMenu = document.createElement('div');
  ctxMenu.id = 'quickAdd';
  ctxMenu.style.position = 'fixed'; ctxMenu.style.left = cx + 'px'; ctxMenu.style.top = cy + 'px'; ctxMenu.style.zIndex = 90;
  const mk = (label, fn) => { const b = document.createElement('button'); b.className = 'qa-item'; b.textContent = label; b.onclick = () => { fn(); hideNodeMenu(); }; ctxMenu.appendChild(b); };
  mk(n.bypass ? 'Unbypass' : 'Bypass', () => { n.bypass = !n.bypass; evaluator.markDirty(graph, n.id); fullEvaluate(); remesh(); });
  if (n.sim) mk('Reset simulation', () => { resetSimNode(n); buildInspector(); });
  if (n.type !== 'output') {
    mk('Duplicate', () => {
      const c = graph.addNode(n.type, n.x + 40, n.y + 40, { ...n.params });
      editor.sel.clear(); editor.sel.add(c.id); selectNode(c);
      fullEvaluate(); remesh();
    });
    mk('Delete', () => deleteSelected());
  }
  document.body.appendChild(ctxMenu);
  const off = () => { hideNodeMenu(); window.removeEventListener('pointerdown', off); };
  setTimeout(() => window.addEventListener('pointerdown', off), 50);
}
function hideNodeMenu() { if (ctxMenu) { ctxMenu.remove(); ctxMenu = null; } }

async function boot() {
  try {
    bootMsg('allocating SDF volume…');
    field = new SdfField(S.res, 100, 80);
    flowmap = new FlowMap(256, 100);
    graph = new Graph();
    evaluator = new Evaluator(field);
    bootMsg('starting renderer…');
    viewport = new Viewport($('viewport'));
    viewport.setWaterLevel(S.water);
    viewport.setSun(S.sunAz, S.sunEl);
    viewport.setParticleSize(S.dropSize);
    editor = new NodeEditor($('graph'), graph, {
      onSelect: n => selectNode(n),
      onLinkChange: () => { evaluator.markAllDirty(graph); fullEvaluate(); remesh(); },
      onMoveEnd: () => {},
      onQuickAdd: (px, py, wx, wy) => showQuickAdd(px, py, wx, wy),
      onNodeMenu: (n, cx, cy) => showNodeMenu(n, cx, cy),
      onToast: (m, k) => toast(m, k),
    });
    bindChrome();
    buildPalette();
    buildSidePanels();
    bootMsg('building starter landscape…');
    loadPreset('canyon');
    setPlaying(true);
    loop();
    requestAnimationFrame(() => setTimeout(() => {
      $('boot').classList.add('done');
      editor.resize(); editor.fit();
      showPresets();
    }, 350));
  } catch (err) {
    console.error(err);
    const msg = String((err && err.stack) || err).split('\n').slice(0, 2).join(' · ').slice(0, 220);
    bootMsg('failed: ' + msg);
  }
}
boot();
