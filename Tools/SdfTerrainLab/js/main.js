// SLATE · SDF Terrain Lab — boot, transport, rebake/remesh scheduling, I/O.
import * as THREE from 'three';
import { Graph, NODE_TYPES, makeNode, defaultParams, collectSim } from './core/graph.js';
import { compileField, makeFieldNoise } from './core/sdf.js';
import { Volume, RESOLUTIONS } from './core/volume.js';
import { ErosionSim, resamplePath } from './core/erosion.js';
import { surfaceNets, bakeColors } from './core/meshing.js';
import { meshToOBJ, meshToPLY, heightmapData, flowmapData, download, downloadImageData } from './core/exporters.js';
import { makeRng } from './core/noise.js';
import { GraphEditor } from './ui/graphEditor.js';
import { Panels } from './ui/panels.js';
import { Viewport } from './render.js';

const $ = id => document.getElementById(id);
const state = {
  graph: null, vol: null, sim: null, mesh: null,
  playing: false, speed: 1, sel: null, tab: 'node', shade: 'full',
  bakeMs: 0, meshMs: 0, pathEdit: null, interacting: false,
  render: {
    pSize: 3, pOpacity: 0.95, showParticles: true, showWater: true,
    waterDeep: '#0b3b4a', waterShallow: '#3f9aa5', sunI: 2.6,
    exposure: 1.05, snowY: 46, grassY: 34, wire: false, shadows: true, guides: true, ortho: false,
  },
};
let viewport, editor, panels;
let rebakeTimer = 0, lastRemesh = 0, lastWater = 0, lastStatus = 0, lastInsp = 0;
let frames = 0, lastFps = performance.now(), fps = 60;

// ── boot ──
async function boot() {
  viewport = new Viewport($('viewport'));
  viewport.frameHome();
  editor = new GraphEditor($('graphCanvas'), $('nodeMenu'), {
    onSelect: id => { state.sel = id; panels.refreshOutliner(); if (state.tab === 'node') panels.refreshInspector(); },
    onStructure: () => { afterStructure(); },
    onMove: () => scheduleAutosave(),
    onError: msg => setMsg(msg, true),
  });
  panels = new Panels(document, {
    graph: () => state.graph, sel: () => state.sel, tab: () => state.tab,
    sim: () => state.sim, playing: () => state.playing, render: () => state.render,
    stats: () => ({
      verts: state.mesh ? (state.mesh.positions.length / 3).toLocaleString() : '—',
      tris: state.mesh ? (state.mesh.indices.length / 3).toLocaleString() : '—',
      meshMs: state.meshMs.toFixed(0) + ' ms', bakeMs: state.bakeMs.toFixed(0) + ' ms',
      solid: state.vol ? (state.vol.stats().solidM3 / 1000).toFixed(1) + 'k m³' : '—',
    }),
    onSelect: id => {
      state.sel = id;
      if (state.tab !== 'node') { state.tab = 'node'; panels.setTab('node'); }
      else panels.refreshInspector();
      panels.refreshOutliner(); editor.sel = id; editor.refresh();
    },
    onParam: (id, key, val, commit) => onParam(id, key, val, commit),
    onTab: tab => { state.tab = tab; panels.setTab(tab); },
    onAction: (name, arg) => onAction(name, arg),
  });

  bindChrome();
  // restore previous session, else canyon preset
  let g = null;
  try {
    const saved = localStorage.getItem('slate-terrain-lab.graph');
    if (saved) g = Graph.fromJSON(JSON.parse(saved));
  } catch { /* ignore */ }
  if (!g) {
    try {
      const r = await fetch('./presets/canyon.json');
      if (r.ok) g = Graph.fromJSON(await r.json());
    } catch { /* ignore */ }
  }
  if (!g) g = emptyGraph();
  useGraph(g, false);
  editor.fit();
  window.__labBooted = true;
  requestAnimationFrame(loop);
}

function emptyGraph() {
  const g = new Graph();
  const out = makeNode('output', 420, 60);
  const gr = makeNode('ground', 120, 120);
  g.addNode(out); g.addNode(gr);
  g.connect(gr.id, 'f', out.id, 'field');
  return g;
}

function useGraph(g, fit = true) {
  state.graph = g;
  state.sel = null;
  state.playing = false; updatePlayBtn();
  editor.setGraph(g);
  const out = g.outputNode();
  ensureVolume(out?.params.resolution || 'standard');
  if (fit) editor.fit();
  panels.refreshOutliner(); panels.refreshInspector();
  rebake('new graph');
}

// ── bake / remesh / water ──
function ensureVolume(resKey) {
  const res = RESOLUTIONS[resKey] || RESOLUTIONS.standard;
  if (state.vol && state.vol.nx === res.nx && state.vol.ny === res.ny && state.vol.nz === res.nz) return;
  state.vol = new Volume(res);
  if (!state.sim) state.sim = new ErosionSim(state.vol);
  else state.sim.setVolume(state.vol);
  $('stVol').textContent = `${res.nx}×${res.ny}×${res.nz}`;
}

let baking = false;
async function rebake(reason = '') {
  if (baking || !state.graph) return;
  baking = true;
  setMsg(`baking SDF… ${reason}`);
  await new Promise(r => setTimeout(r, 20)); // let UI paint
  try {
    const out = state.graph.outputNode();
    ensureVolume(out?.params.resolution || 'standard');
    const noise = makeFieldNoise(out?.params.seed ?? 1337);
    const field = compileField(state.graph, noise);
    state.bakeMs = state.vol.bake((x, y, z, o) => field.eval(x, y, z, o));
    state.sim.rng = makeRng((out?.params.seed ?? 1337) * 31 + 7);
    state.sim.reset();
    state.sim.setEmitters(collectSim(state.graph));
    remesh();
    rebuildWater();
    refreshHelpers();
    setMsg(`baked in ${state.bakeMs.toFixed(0)} ms · ${field.order.length} field nodes`);
  } catch (err) {
    console.error(err);
    setMsg('bake failed: ' + err.message, true);
  }
  baking = false;
  panels.refreshOutliner();
  if (state.tab === 'render') panels.refreshInspector();
}

function remesh() {
  const t0 = performance.now();
  state.mesh = surfaceNets(state.vol, { mode: state.shade === 'wire' ? 'full' : state.shade, snowY: state.render.snowY, grassUpTo: state.render.grassY });
  viewport.setTerrain(state.mesh);
  state.meshMs = performance.now() - t0;
  $('stMesh').textContent = `mesh ${state.meshMs.toFixed(0)} ms · ${(state.mesh.positions.length / 3 / 1000).toFixed(0)}k v`;
}

function recolor() {
  if (!state.mesh) return;
  bakeColors(state.vol, state.mesh, state.shade === 'wire' ? 'full' : state.shade, { snowY: state.render.snowY, grassUpTo: state.render.grassY });
  viewport.updateTerrainColors(state.mesh);
}

function rebuildWater() {
  viewport.clearWater();
  if (!state.render.showWater) return;
  const sim = collectSim(state.graph);
  const wind = sim.wind[0]?.p;
  const drift = wind ? [Math.cos(wind.dir * Math.PI / 180), Math.sin(wind.dir * Math.PI / 180)] : [0.8, 0.35];
  for (const L of sim.lake) {
    const p = L.p;
    if (p.showWater === false) continue;
    viewport.addLakeMesh(p.cx, p.level, p.cz, p.rx, p.rz, drift, p.flow, state.vol);
  }
  for (const R of sim.river) {
    const p = R.p;
    if (p.showWater === false) continue;
    const path = resamplePath(p.points, 2.5);
    if (path.pts.length >= 2) viewport.addRiverMesh(path.pts, p.width, p.speed, state.vol);
  }
}

function refreshHelpers() {
  const g = state.graph;
  viewport.setDynHelpers((grp, T) => {
    // river paths
    for (const n of g.nodes.filter(n => n.type === 'river')) {
      const pts = n.params.points || [];
      if (pts.length === 0) continue;
      const v = pts.map(p => {
        const y = state.vol.topSurfaceY(p.x, p.z);
        return new T.Vector3(p.x, (y > 0 ? y : 12) + 1.2, p.z);
      });
      grp.add(new T.Line(new T.BufferGeometry().setFromPoints(v),
        new T.LineBasicMaterial({ color: state.pathEdit?.nodeId === n.id ? 0xf5c86e : 0x4fd1c5 })));
      const dots = new T.Points(new T.BufferGeometry().setFromPoints(v),
        new T.PointsMaterial({ color: 0xf5c86e, size: 6, sizeAttenuation: false }));
      grp.add(dots);
    }
    // emitter boxes
    const box = (c, s, color) => {
      const geo = new T.EdgesGeometry(new T.BoxGeometry(s[0], s[1], s[2]));
      const m = new T.LineSegments(geo, new T.LineBasicMaterial({ color, transparent: true, opacity: 0.5 }));
      m.position.set(c[0], c[1], c[2]);
      grp.add(m);
    };
    for (const n of g.nodes.filter(n => n.type === 'rain' && !n.disabled)) box(n.params.center, n.params.size, 0x6cb6ff);
    // lake rings
    for (const n of g.nodes.filter(n => n.type === 'lake' && !n.disabled)) {
      const p = n.params, v = [];
      for (let i = 0; i <= 64; i++) {
        const a = i / 64 * Math.PI * 2;
        v.push(new T.Vector3(p.cx + Math.cos(a) * p.rx, p.level + 0.15, p.cz + Math.sin(a) * p.rz));
      }
      grp.add(new T.Line(new T.BufferGeometry().setFromPoints(v), new T.LineBasicMaterial({ color: 0x4fd1c5, transparent: true, opacity: 0.7 })));
    }
  });
}

// ── params / actions ──
function afterStructure() {
  editor.refresh();
  panels.refreshOutliner();
  panels.refreshInspector();
  const out = state.graph.outputNode();
  if (out?.params.autoRebake) scheduleRebake();
  else setMsg('graph changed — press B to rebake');
  scheduleAutosave();
  // sim membership may have changed
  state.sim.setEmitters(collectSim(state.graph));
  refreshHelpers();
  rebuildWater();
}

function onParam(id, key, val, commit) {
  const n = state.graph.getNode(id);
  if (!n) return;
  n.params[key] = val;
  const cat = NODE_TYPES[n.type].cat;
  if (n.type === 'output' && key === 'resolution' && commit) {
    ensureVolume(val);
    rebake('resolution change');
    return;
  }
  if (cat === 'field' || n.type === 'output') {
    editor.refresh();
    if (commit) {
      const out = state.graph.outputNode();
      if (out?.params.autoRebake || n.type === 'output') rebake('param');
      else setMsg('press B to rebake');
    } else {
      const out = state.graph.outputNode();
      if (out?.params.autoRebake) scheduleRebake();
    }
  } else {
    // sim nodes apply live
    state.sim.setEmitters(collectSim(state.graph));
    if ((n.type === 'river' || n.type === 'lake') && commit) { rebuildWater(); refreshHelpers(); }
    if (state.tab === 'erosion' && commit) panels.refreshInspector();
  }
  scheduleAutosave();
}

function scheduleRebake() {
  clearTimeout(rebakeTimer);
  rebakeTimer = setTimeout(() => rebake('auto'), 450);
}
let saveTimer = 0;
function scheduleAutosave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('slate-terrain-lab.graph', JSON.stringify(state.graph.toJSON())); } catch { /* quota */ }
  }, 800);
}

function onAction(name, arg) {
  const R = state.render;
  switch (name) {
    case 'toggleNode': {
      const n = state.graph.getNode(arg);
      if (n) { n.disabled = !n.disabled; afterStructure(); }
      break;
    }
    case 'deleteNode': {
      const n = state.graph.getNode(arg);
      if (n && n.type !== 'output') { state.graph.removeNode(arg); if (state.sel === arg) state.sel = null; afterStructure(); }
      else setMsg('the Output node cannot be deleted', true);
      break;
    }
    case 'addMenu': {
      const r = $('graphCanvas').getBoundingClientRect();
      editor.openMenu(r.left + r.width / 2, r.top + r.height / 2);
      break;
    }
    case 'fitGraph': editor.fit(); break;
    case 'rebake': rebake('manual'); break;
    case 'togglePlay': setPlaying(!state.playing); break;
    case 'step': if (!state.playing) { state.sim.step(1 / 60); remesh(); rebuildWater(); updateStatus(true); } break;
    case 'resetSim':
      state.sim.reset();
      state.vol.restoreBase();
      remesh(); rebuildWater();
      setMsg('sim reset — base field restored');
      if (state.tab === 'erosion') panels.refreshInspector();
      break;
    case 'editPath': startPathEdit(arg); break;
    case 'clearPath': {
      const n = state.graph.getNode(arg);
      if (n) { n.params.points = []; state.sim.setEmitters(collectSim(state.graph)); rebuildWater(); refreshHelpers(); panels.refreshInspector(); editor.refresh(); scheduleAutosave(); }
      break;
    }
    case 'rebuildWater': rebuildWater(); setMsg('water rebuilt'); break;
    case 'toggleWater': R.showWater = !R.showWater; $('btnWaterVis').classList.toggle('on', R.showWater); rebuildWater(); panels.refreshInspector(); break;
    case 'toggleParticles': R.showParticles = !R.showParticles; viewport.points.visible = R.showParticles; $('btnParticles').classList.toggle('on', R.showParticles); if (state.tab === 'erosion') panels.refreshInspector(); break;
    case 'pSize': R.pSize = arg; viewport.pMat.uniforms.uSize.value = arg; break;
    case 'pOpacity': R.pOpacity = arg; viewport.pMat.uniforms.uOpacity.value = arg; break;
    case 'waterDeep': R.waterDeep = arg; viewport.waterUniforms.uDeep.value.set(arg); break;
    case 'waterShallow': R.waterShallow = arg; viewport.waterUniforms.uShallow.value.set(arg); break;
    case 'sunI': R.sunI = arg; viewport.sun.intensity = arg; break;
    case 'exposure': R.exposure = arg; viewport.renderer.toneMappingExposure = arg; break;
    case 'snowY': R.snowY = arg; recolor(); break;
    case 'grassY': R.grassY = arg; recolor(); break;
    case 'toggleWire': R.wire = !R.wire; viewport.setWireframe(R.wire); panels.refreshInspector(); break;
    case 'toggleShadows': R.shadows = !R.shadows; viewport.renderer.shadowMap.enabled = R.shadows; viewport.sun.castShadow = R.shadows; state.mesh && (viewport.terrain.material.needsUpdate = true); panels.refreshInspector(); break;
    case 'toggleGuides': R.guides = !R.guides; viewport.helperGroup.visible = R.guides; $('btnHelpers').classList.toggle('on', R.guides); panels.refreshInspector(); break;
    case 'toggleOrtho': R.ortho = !R.ortho; viewport.setOrtho(R.ortho); panels.refreshInspector(); break;
    case 'exportOBJ': state.mesh && download('terrain.obj', meshToOBJ(state.mesh)); setMsg('exported terrain.obj'); break;
    case 'exportPLY': state.mesh && download('terrain.ply', meshToPLY(state.mesh)); setMsg('exported terrain.ply'); break;
    case 'exportHeight': downloadImageData('heightmap.png', heightmapData(state.vol)); setMsg('exported heightmap.png'); break;
    case 'exportFlow': downloadImageData('flowmap.png', flowmapData(state.vol)); setMsg('exported flowmap.png'); break;
    case 'saveGraph': download('terrain-graph.json', JSON.stringify(state.graph.toJSON(), null, 1), 'application/json'); break;
    case 'screenshot': {
      viewport.update(0);
      const a = document.createElement('a');
      a.href = viewport.canvas.toDataURL('image/png');
      a.download = 'terrain.png'; a.click();
      break;
    }
  }
}

// ── river path editing ──
function startPathEdit(nodeId) {
  const n = state.graph.getNode(nodeId);
  if (!n || n.type !== 'river') return;
  state.pathEdit = { nodeId, drag: -1 };
  viewport.enabled = false;
  $('pathBar').classList.remove('hidden');
  $('pathLabel').innerHTML = `River path: click terrain to append · drag points to move · <b>Enter</b> finish · <b>Esc</b> cancel`;
  refreshHelpers();
  setMsg('path edit — orbit disabled');
}
function finishPathEdit(commit) {
  const pe = state.pathEdit;
  state.pathEdit = null;
  viewport.enabled = true;
  $('pathBar').classList.add('hidden');
  if (pe && commit) {
    state.sim.setEmitters(collectSim(state.graph));
    rebuildWater(); refreshHelpers();
    panels.refreshInspector(); editor.refresh();
    scheduleAutosave();
    setMsg('river path updated');
  } else { refreshHelpers(); setMsg('path edit cancelled'); }
}
function bindPathEdit() {
  const cv = viewport.canvas;
  const toScreen = (p) => {
    const v = new THREE.Vector3(p.x, 0, p.z);
    v.y = state.vol.topSurfaceY(p.x, p.z) + 1;
    v.project(viewport.camera);
    const r = cv.getBoundingClientRect();
    return [(v.x * 0.5 + 0.5) * r.width, (-v.y * 0.5 + 0.5) * r.height];
  };
  cv.addEventListener('pointerdown', e => {
    const pe = state.pathEdit;
    if (!pe || e.button !== 0) return;
    const n = state.graph.getNode(pe.nodeId);
    if (!n) return;
    // near an existing point? → drag it
    let best = -1, bd = 14;
    const r = cv.getBoundingClientRect();
    (n.params.points || []).forEach((p, i) => {
      const [sx, sy] = toScreen(p);
      const d = Math.hypot(e.clientX - r.left - sx, e.clientY - r.top - sy);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { pe.drag = best; cv.setPointerCapture?.(e.pointerId); return; }
    const hit = viewport.pick(e.clientX, e.clientY);
    if (hit) {
      n.params.points.push({ x: +hit.x.toFixed(1), z: +hit.z.toFixed(1) });
      refreshHelpers();
    }
  });
  cv.addEventListener('pointermove', e => {
    const pe = state.pathEdit;
    if (!pe || pe.drag < 0) return;
    const n = state.graph.getNode(pe.nodeId);
    const hit = viewport.pick(e.clientX, e.clientY);
    if (n && hit) {
      n.params.points[pe.drag] = { x: +hit.x.toFixed(1), z: +hit.z.toFixed(1) };
      refreshHelpers();
    }
  });
  cv.addEventListener('pointerup', () => { if (state.pathEdit) state.pathEdit.drag = -1; });
}

// ── chrome / shortcuts ──
function setMsg(m, warn = false) {
  const s = $('stMsg');
  s.textContent = m;
  s.style.color = warn ? '#f0665f' : '';
}
function setPlaying(p) {
  state.playing = p;
  updatePlayBtn();
}
function updatePlayBtn() {
  const b = $('btnPlay');
  b.innerHTML = state.playing ? '⏸ Pause' : '▶ Run';
  b.classList.toggle('running', state.playing);
  $('simChip').textContent = state.playing ? `live ×${state.speed}` : 'paused';
  $('simChip').classList.toggle('live', state.playing);
}

function setShade(mode) {
  state.shade = mode;
  document.querySelectorAll('#shadeModes button').forEach(b => b.classList.toggle('on', b.dataset.shade === mode));
  viewport.setWireframe(mode === 'wire');
  state.render.wire = mode === 'wire';
  recolor();
}

function bindChrome() {
  $('btnPlay').onclick = () => setPlaying(!state.playing);
  $('btnStep').onclick = () => onAction('step');
  $('btnResetSim').onclick = () => onAction('resetSim');
  $('btnRebake').onclick = () => rebake('manual');
  $('selSpeed').onchange = e => { state.speed = parseFloat(e.target.value); updatePlayBtn(); };
  $('btnNew').onclick = () => useGraph(emptyGraph());
  $('btnSave').onclick = () => onAction('saveGraph');
  $('btnOpen').onclick = () => $('fileOpen').click();
  $('fileOpen').onchange = e => {
    const f = e.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { useGraph(Graph.fromJSON(JSON.parse(rd.result))); setMsg(`opened ${f.name}`); }
      catch (err) { setMsg('open failed: ' + err.message, true); }
    };
    rd.readAsText(f);
    e.target.value = '';
  };
  const loadPreset = async name => {
    try {
      const r = await fetch(`./presets/${name}.json`);
      if (!r.ok) throw new Error(r.status);
      useGraph(Graph.fromJSON(await r.json()));
      setMsg(`preset: ${name}`);
    } catch { setMsg(`preset ${name} failed to load`, true); }
  };
  $('btnPresetCanyon').onclick = () => loadPreset('canyon');
  $('btnPresetCoast').onclick = () => loadPreset('coast');
  $('btnPresetDunes').onclick = () => loadPreset('dunes');
  document.querySelectorAll('#presetStrip button').forEach(b => b.onclick = () => {
    if (b.dataset.preset === 'empty') useGraph(emptyGraph());
    else loadPreset(b.dataset.preset);
  });
  // dock
  const vw = $('viewportWrap'), gw = $('graphWrap'), dv = $('dockDivider');
  const setDock = m => {
    $('btnDockBoth').classList.toggle('on', m === 0);
    $('btnDockView').classList.toggle('on', m === 1);
    $('btnDockGraph').classList.toggle('on', m === 2);
    vw.style.display = m === 2 ? 'none' : '';
    gw.style.display = m === 1 ? 'none' : '';
    dv.style.display = m === 0 ? '' : 'none';
    if (m !== 2) { vw.style.flex = m === 1 ? '1' : ''; gw.style.flex = m === 0 ? '' : '1'; }
    viewport._resize();
    editor._resize();
  };
  $('btnDockBoth').onclick = () => setDock(0);
  $('btnDockView').onclick = () => setDock(1);
  $('btnDockGraph').onclick = () => setDock(2);
  let divDrag = null;
  dv.addEventListener('pointerdown', e => { divDrag = { y: e.clientY, vh: vw.getBoundingClientRect().height, gh: gw.getBoundingClientRect().height }; dv.setPointerCapture(e.pointerId); });
  dv.addEventListener('pointermove', e => {
    if (!divDrag) return;
    const dy = e.clientY - divDrag.y;
    vw.style.flex = `${Math.max(120, divDrag.vh + dy)}px`;
    vw.style.flexGrow = '0';
    gw.style.flex = '1';
    viewport._resize(); editor._resize();
  });
  dv.addEventListener('pointerup', () => { divDrag = null; });
  // viewport overlay
  document.querySelectorAll('#shadeModes button').forEach(b => b.onclick = () => setShade(b.dataset.shade));
  $('btnIso').onclick = () => viewport.frameHome();
  $('btnTop').onclick = () => viewport.setTop();
  $('btnFront').onclick = () => viewport.setFront();
  $('btnParticles').onclick = () => onAction('toggleParticles');
  $('btnWaterVis').onclick = () => onAction('toggleWater');
  $('btnHelpers').onclick = () => onAction('toggleGuides');
  $('btnAddNode').onclick = () => onAction('addMenu');
  $('btnAddNode2').onclick = () => onAction('addMenu');
  $('btnFitGraph').onclick = () => editor.fit();
  $('btnPathDone').onclick = () => finishPathEdit(true);
  // diag + help
  $('btnDiag').onclick = () => {
    const p = $('diagPanel');
    p.classList.toggle('hidden');
    if (!p.classList.hidden) fillDiag();
  };
  $('btnDiagClose').onclick = () => $('diagPanel').classList.add('hidden');
  $('btnDiagCopy').onclick = () => navigator.clipboard?.writeText($('diagBody').textContent).then(() => setMsg('diagnostics copied'));
  $('btnHelp').onclick = () => $('helpPanel').classList.toggle('hidden');
  $('btnHelpClose').onclick = () => $('helpPanel').classList.add('hidden');
  $('inspBody').addEventListener('pointerdown', () => { state.interacting = true; });
  window.addEventListener('pointerup', () => { state.interacting = false; });

  bindPathEdit();
  window.addEventListener('keydown', e => {
    const tag = (document.activeElement?.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'select' || tag === 'textarea';
    if (e.key === 'Tab' && !typing) {
      e.preventDefault();
      const r = $('graphCanvas').getBoundingClientRect();
      editor.openMenu(r.left + r.width / 2, r.top + r.height / 3);
      return;
    }
    if (state.pathEdit) {
      if (e.key === 'Enter') finishPathEdit(true);
      else if (e.key === 'Escape') finishPathEdit(false);
      return;
    }
    if (typing) return;
    if (e.key === ' ') { e.preventDefault(); setPlaying(!state.playing); }
    else if (e.key === 'b' || e.key === 'B') rebake('manual');
    else if (e.key === 'r' || e.key === 'R') onAction('resetSim');
    else if (e.key === '.') onAction('step');
    else if (e.key === 'Delete' || e.key === 'Backspace') editor.deleteSelected();
    else if (e.key === 'f' || e.key === 'F') viewport.frameHome();
    else if (e.key === 'p' || e.key === 'P') onAction('toggleParticles');
    else if (e.key === '1') viewport.setFront();
    else if (e.key === '7') viewport.setTop();
    else if (e.key === '5') onAction('toggleOrtho');
    else if (e.key === 'g' || e.key === 'G') rebake('clean');
    else if (e.key === 'Escape') {
      editor.closeMenu();
      state.sel = null; panels.refreshOutliner(); panels.refreshInspector(); editor.sel = null; editor.refresh();
    }
  });
}

function fillDiag() {
  const L = state.sim.ledger;
  $('diagBody').textContent =
    `SLATE SDF Terrain Lab — diagnostics\n` +
    `graph: ${state.graph.nodes.length} nodes, ${state.graph.links.length} links\n` +
    `volume: ${state.vol.nx}×${state.vol.ny}×${state.vol.nz} (voxel ${state.vol.vx.toFixed(2)}×${state.vol.vy.toFixed(2)}×${state.vol.vz.toFixed(2)} m)\n` +
    `bake: ${state.bakeMs.toFixed(0)} ms · remesh: ${state.meshMs.toFixed(0)} ms · ${state.mesh ? (state.mesh.indices.length / 3).toLocaleString() : 0} tris\n` +
    `sim: step ${state.sim.stepCount}, t=${state.sim.simTime.toFixed(1)}s, alive ${state.sim.n}/${state.sim.maxAlive} (${state.sim.aliveByType.join('/')})\n` +
    `ledger: eroded ${L.eroded.toFixed(2)} m³ · deposited ${L.deposited.toFixed(2)} · suspended ${L.suspended.toFixed(2)} · exited ${L.exited.toFixed(2)}\n` +
    `balance: ${(state.sim.balance() * 100).toFixed(1)}% · settled ${L.settled} · starved ${L.starved}\n` +
    `---\n${viewport.diagnostics()}`;
}

// ── main loop ──
let lastT = performance.now();
function loop(t) {
  requestAnimationFrame(loop);
  const dt = Math.min((t - lastT) / 1000, 0.05);
  lastT = t;
  frames++;
  if (t - lastFps > 500) {
    fps = Math.round(frames * 1000 / (t - lastFps));
    frames = 0; lastFps = t;
    $('fpsChip').textContent = `${fps} fps`;
  }
  if (state.playing && !baking) {
    for (let k = 0; k < state.speed; k++) state.sim.step(dt);
    if (t - lastRemesh > 380) { lastRemesh = t; remesh(); }
    if (t - lastWater > 1600) { lastWater = t; rebuildWater(); }
  }
  // particles → GPU
  if (state.render.showParticles && state.sim.n > 0) {
    const n = state.sim.fillRender(viewport.pPos, viewport.pCol, viewport.MAXP);
    viewport.setParticleCount(n);
  } else viewport.setParticleCount(0);
  viewport.update(dt);
  if (t - lastStatus > 250) { lastStatus = t; updateStatus(false); }
  if (state.tab === 'erosion' && t - lastInsp > 1200 && !state.interacting) { lastInsp = t; panels.refreshInspector(); }
}

function updateStatus(force) {
  const L = state.sim.ledger;
  $('stSim').textContent = `◉ ${state.sim.n} particles`;
  $('stMass').textContent = `eroded ${L.eroded.toFixed(1)} · deposited ${L.deposited.toFixed(1)} · susp ${L.suspended.toFixed(2)} · exit ${L.exited.toFixed(1)} m³`;
  const bal = state.sim.balance();
  const el = $('stBal');
  if (L.eroded > 1e-6) {
    el.textContent = `balance ${(bal * 100).toFixed(1)}%`;
    el.className = Math.abs(bal - 1) < 0.08 ? 'good' : 'warn';
  } else { el.textContent = 'balance —'; el.className = ''; }
  if (force && state.tab === 'erosion') panels.refreshInspector();
  if (!$('diagPanel').classList.contains('hidden')) fillDiag();
}

boot().catch(err => {
  console.error(err);
  const e = $('bootError');
  e.classList.remove('hidden');
  e.innerHTML = '<b>Failed to start:</b> ' + String(err.message || err);
});
