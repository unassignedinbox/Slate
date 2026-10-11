// Boot: build the editor state, the WebGPU renderer and the UI, then drive the frame loop.

import { Editor } from './app/state.js';
import { buildShell } from './ui/shell.js';
import { Renderer, GPU_UNSUPPORTED } from './gfx/renderer.js';
import { Camera } from './core/camera.js';
import { OverlayBuffer, buildOverlay, pickScene, pickGizmo } from './app/gizmo.js';
import { rayPlaneY } from './core/math.js';
import { updateInstances, updateSignals } from './app/frame.js';

const editor = new Editor();
const camera = new Camera({ distance: 240, yaw: 0.85, pitch: 0.58, target: { x: 0, y: 0, z: 0 } });
const overlay = new OverlayBuffer(1 << 17);

let renderer = null;
let shell = null;
let hover = null;
let dragging = null;        // {part, startHit, origin:{x,z}, nodeId}
let dirtyTimer = 0;
let needsRebuild = false;
let lastFrame = performance.now();
let fps = 60;
let simTimeMs = 0;
let lastChannelVersion = -1;
let hudTimer = 0;

const api = {
  generate() {
    shell.setBusy(true, 'Generating road network…');
    // two frames: the first paints the veil, the second does the (blocking) work
    afterPaint(() => {
      try {
        editor.generate();
        applyScene();
        frameNetwork();
      } finally {
        shell.setBusy(false);
      }
    });
  },
  rebuild() { doRebuild(); },
  markDirty() { needsRebuild = true; dirtyTimer = 0.28; },
  moveNode(id, x, z) { editor.moveNode(id, x, z); api.markDirty(); },
  frame(p, dist) { camera.focus({ x: p.x, y: p.y, z: p.z }, dist); },
  refreshStack() { shell.refreshStack(); },
  refreshInspector() { shell.refreshInspector(); },
  refreshAll() { shell.syncTopbar(); shell.refreshStack(); shell.refreshInspector(); },
  setFleet(n) {
    const sim = editor.scene?.traffic;
    if (!sim) return;
    sim.maxVehicles = Math.min(25, Math.round(n));
    while (sim.vehicles.length > sim.maxVehicles) {
      const v = sim.vehicles.pop();
      const list = v.conn ? null : v.lane?.vehicles;
      if (list) { const i = list.indexOf(v); if (i >= 0) list.splice(i, 1); }
    }
    if (sim.vehicles.length < sim.maxVehicles) sim.populate();
  },
  addFeature(edge, kind) {
    const L = edge.curve.length;
    const r = () => 0.2 + Math.random() * 0.6;
    if (kind === 'pothole') edge.features.potholes.push({ s: L * r(), t: (Math.random() - 0.5) * 4, r: 0.35 + Math.random() * 0.5, depth: 0.05 + Math.random() * 0.05 });
    else if (kind === 'bump') edge.features.speedBumps.push({ s: L * r(), height: 0.09, width: 3.6, type: 'table' });
    else if (kind === 'works') {
      const s0 = L * (0.25 + Math.random() * 0.4);
      edge.features.construction.push({ s0, s1: Math.min(L - 6, s0 + 24), side: Math.random() < 0.5 ? -1 : 1, kind: 'trench', t0: -3, t1: 0.5 });
    } else if (kind === 'clear') {
      edge.features.potholes.length = 0;
      edge.features.speedBumps.length = 0;
      edge.features.construction.length = 0;
      edge.features.patches.length = 0;
    }
    api.markDirty();
    shell.refreshInspector();
  },
};

/** Run work after the browser has painted the current frame (so busy veils are visible). */
function afterPaint(fn) {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

function applyScene() {
  const scene = editor.scene;
  scene.channels = editor.channels;
  renderer.setScene(scene, { wireLayers: ['surface', 'blocks'] });
  renderer.setMaterialsFromChannels(editor.channels);
  for (const id of editor.hidden) renderer.setLayerVisible(id, false);
  shell.refreshStack();
  shell.refreshInspector();
  shell.syncTopbar();
}

function doRebuild() {
  if (!editor.scene) return;
  shell.setBusy(true, 'Rebuilding road network…');
  afterPaint(() => {
    try {
      editor.rebuildGeometry();
      applyScene();
    } finally {
      shell.setBusy(false);
      needsRebuild = false;
      dirtyTimer = 0;
    }
  });
}

function frameNetwork() {
  const b = editor.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const span = Math.max(b.max.x - b.min.x, b.max.z - b.min.z);
  camera.focus({ x: cx, y: 0, z: cz }, span * 0.78);
  camera.snapTo();
}

// ---------------------------------------------------------------- input
function setupInput(canvas) {
  const buttons = new Set();
  let last = { x: 0, y: 0 };
  let downAt = null;
  let moved = 0;

  const ndc = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: 1 - ((e.clientY - r.top) / r.height) * 2 };
  };

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    buttons.add(e.button);
    last = { x: e.clientX, y: e.clientY };
    downAt = ndc(e);
    moved = 0;
    if (e.button === 0 && editor.selection?.type === 'junction' && editor.view.gizmo) {
      const node = editor.scene.net.nodes.get(editor.selection.id);
      if (node && !node.locked) {
        const ray = camera.ray(downAt.x, downAt.y);
        const g = pickGizmo(camera, node.p, ray);
        if (g && g.hit) {
          dragging = { part: g.part, origin: { x: node.p.x, z: node.p.z }, start: g.hit, nodeId: node.id };
        }
      }
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    moved += Math.abs(dx) + Math.abs(dy);
    const p = ndc(e);

    if (dragging) {
      const ray = camera.ray(p.x, p.y);
      const plane = rayPlaneY(ray, dragging.start.y);
      const hit = plane ? plane.point : null;
      if (hit) {
        let nx = dragging.origin.x + (hit.x - dragging.start.x);
        let nz = dragging.origin.z + (hit.z - dragging.start.z);
        if (dragging.part === 'x') nz = dragging.origin.z;
        if (dragging.part === 'z') nx = dragging.origin.x;
        if (e.shiftKey) { nx = Math.round(nx); nz = Math.round(nz); }
        editor.moveNode(dragging.nodeId, nx, nz);
      }
      return;
    }
    if (buttons.has(0) && !buttons.has(1)) {
      if (e.shiftKey) camera.pan(dx, dy); else camera.orbit(dx, dy);
    } else if (buttons.has(1) || buttons.has(2)) {
      camera.pan(dx, dy);
    } else {
      const ray = camera.ray(p.x, p.y);
      hover = pickScene(editor.scene, ray);
      canvas.style.cursor = hover ? (hover.type === 'junction' ? 'pointer' : 'crosshair') : 'default';
    }
  });

  const endDrag = (e) => {
    buttons.delete(e.button);
    if (dragging) {
      dragging = null;
      api.markDirty();
      shell.refreshInspector();
      return;
    }
    if (e.button === 0 && moved < 6 && downAt) {
      const ray = camera.ray(downAt.x, downAt.y);
      const hit = pickScene(editor.scene, ray);
      if (hit) {
        editor.select({ type: hit.type, id: hit.id });
        if (editor.stackTab === 'texture') { shell.setTab('scene'); }
      } else {
        editor.select(null);
      }
      shell.refreshStack();
      shell.refreshInspector();
    }
    downAt = null;
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    // deltaMode 1 is lines and 2 is pages; normalise both to pixels, and treat a
    // trackpad pinch (which arrives as ctrl+wheel) as a faster zoom
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 380 : 1;
    const p = ndc(e);
    const hit = rayPlaneY(camera.ray(p.x, p.y), camera.target.y);
    camera.dollyTowards(e.deltaY * unit * (e.ctrlKey ? 2.4 : 1), hit ? hit.point : null);
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    const k = e.key.toLowerCase();
    if (k === 'f') {
      const sel = editor.selection;
      if (sel?.type === 'junction') api.frame(editor.scene.net.nodes.get(sel.id).p, 60);
      else if (sel?.type === 'road') api.frame(editor.scene.net.edges.get(sel.id).curve.pointAt(editor.scene.net.edges.get(sel.id).curve.length / 2), 90);
      else frameNetwork();
    } else if (k === 'escape') {
      editor.select(null); shell.refreshStack(); shell.refreshInspector();
    } else if (k === 'g') {
      api.generate();
    } else if (k === 'q') {
      editor.setView('wireframe', !editor.view.wireframe);
      shell.syncView();
    } else if (k === 'l') {
      editor.setView('laneGraph', !editor.view.laneGraph);
      shell.syncView();
    } else if (k === 'n') {
      editor.setView('network', !editor.view.network);
      shell.syncView();
    } else if (k === ' ') {
      e.preventDefault();
      editor.setView('simulate', !editor.view.simulate);
      shell.syncView();
    }
  });
}

function tick(now) {
  requestAnimationFrame(tick);
  const dtRaw = Math.min((now - lastFrame) / 1000, 0.1);
  lastFrame = now;
  fps = fps * 0.92 + (1 / Math.max(dtRaw, 1e-4)) * 0.08;

  const scene = editor.scene;
  if (!scene || !renderer) return;

  // deferred geometry rebuild after edits settle
  if (needsRebuild && !dragging) {
    dirtyTimer -= dtRaw;
    if (dirtyTimer <= 0) doRebuild();
  }

  const dt = dtRaw * (editor.view.simulate ? editor.view.timeScale : 0);
  const t0 = performance.now();
  if (dt > 0) {
    scene.traffic.step(dt);
    if (scene.trains) scene.trains.step(dt, scene.traffic);
  }
  simTimeMs = simTimeMs * 0.9 + (performance.now() - t0) * 0.1;

  const rect = shell.canvas.getBoundingClientRect();
  renderer.resize(rect.width, rect.height);
  camera.setViewport(rect.width, rect.height);
  camera.update(dtRaw, Math.max(rect.width / Math.max(rect.height, 1), 0.1));

  updateInstances(renderer, scene, editor.hidden);
  updateSignals(renderer, scene, now / 1000);
  if (editor.channelVersion !== lastChannelVersion) {
    lastChannelVersion = editor.channelVersion;
    renderer.setMaterialsFromChannels(editor.channels);
  }

  buildOverlay(overlay, scene, {
    camera, view: editor.view, selection: editor.selection, hover,
    dragging: dragging?.part,
  });

  let selectionInfo = null;
  if (editor.selection?.type === 'junction') {
    const node = scene.net.nodes.get(editor.selection.id);
    const info = scene.surface.junctions.get(editor.selection.id);
    if (node) selectionInfo = { x: node.p.x, y: node.p.y, z: node.p.z, radius: Math.max(6, (info?.radius ?? 8) + 1.5) };
  }

  renderer.render({
    camera, env: editor.env, time: now / 1000,
    overlay: { ...overlay, depthTest: true, depthTestTris: false },
    selection: selectionInfo,
    wireframe: editor.view.wireframe,
    hiddenLayers: editor.hidden,
  });

  // the HUD and status bar are DOM writes: 8 Hz is plenty
  hudTimer -= dtRaw;
  if (hudTimer > 0) return;
  hudTimer = 0.125;

  const st = renderer.stats;
  shell.setHud([
    ['fps', fps.toFixed(0)],
    ['tris', `${(st.tris / 1000).toFixed(0)}k`],
    ['draws', String(st.draws)],
    ['inst', String(st.instances)],
    ['sim', `${simTimeMs.toFixed(2)} ms`],
    ['cars', String(scene.traffic.vehicles.length)],
  ]);

  const sel = editor.selection;
  shell.setStatus(
    `<b>${scene.stats.roads}</b> roads · <b>${scene.stats.junctions}</b> intersections · <b>${scene.stats.lengthKm.toFixed(2)}</b> km · <b>${scene.stats.blocks}</b> blocks`,
    needsRebuild ? '<span class="warn">rebuild pending…</span>' : `<span class="ok">${(scene.stats.quadRatio * 100).toFixed(1)}% quads</span>`,
    sel ? `${sel.type}: <b>${sel.id}</b>` : 'nothing selected',
  );
}

// ---------------------------------------------------------------- boot
async function boot() {
  shell = buildShell(editor, api);
  setupInput(shell.canvas);
  try {
    renderer = await Renderer.create(shell.canvas);
  } catch (err) {
    showGpuError(err);
    return;
  }
  renderer.device.addEventListener?.('uncapturederror', (e) => console.error('WebGPU error:', e.error?.message || e));
  shell.setBusy(true, 'Generating road network…');
  await new Promise((r) => setTimeout(r, 16));
  editor.generate();
  applyScene();
  frameNetwork();
  shell.setBusy(false);

  editor.on('view', () => { /* read live by the loop */ });
  editor.on('layers', () => {
    for (const l of editor.scene.layers) renderer.setLayerVisible(l.id, !editor.hidden.has(l.id));
    shell.refreshStack();
  });
  editor.on('channels', () => { renderer.setMaterialsFromChannels(editor.channels); shell.refreshStack(); });
  editor.on('selection', () => { shell.refreshStack(); shell.refreshInspector(); });

  // handy in the browser console, and the hook the headless boot harness drives
  window.roadsmith = { editor, camera, api, overlay, get renderer() { return renderer; }, get shell() { return shell; } };

  requestAnimationFrame(tick);
}

function showGpuError(err) {
  const vp = document.querySelector('.viewport');
  const msg = String(err?.message || err);
  const box = document.createElement('div');
  box.className = 'gpu-error';
  box.innerHTML = `<div>
    <h2>WebGPU unavailable</h2>
    <p>${msg === GPU_UNSUPPORTED ? 'This browser did not expose <code>navigator.gpu</code>.' : msg}</p>
    <p>Roadsmith needs a WebGPU-capable browser: Chrome or Edge 113+, Safari 18+, or Firefox with <code>dom.webgpu.enabled</code>.</p>
    <p>The generator itself is headless — run <code>node tools/validate.mjs --scene</code> to audit the mesh without a GPU.</p>
  </div>`;
  vp?.append(box);
  shell?.setBusy(false);
}

boot();
