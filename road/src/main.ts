/** Causeway — procedural road network editor on WebGPU. */
import './ui/style.css';
import {
  v3, V3, add, sub, mul, norm, dot, len, clamp, m4Perspective, m4LookAt, m4Mul, m4Invert,
  m4XformPoint, M4,
} from './core/vec';
import { RoadGraph, RoadEdge } from './road/graph';
import { PROFILES, PROFILE_IDS } from './road/profile';
import { buildCity } from './road/city';
import { buildNetwork, BuildOut } from './road/build';
import { Renderer, GpuMesh, LineMesh } from './gfx/renderer';
import { defaultStack, packLayers, Layer } from './ui/layers';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $('view') as unknown as HTMLCanvasElement;
const failBox = $('fail');

function die(msg: string): void {
  failBox.hidden = false;
  failBox.textContent = msg;
  $('gpu').textContent = 'no WebGPU';
  $('gpu').classList.add('bad');
}

// ---------------------------------------------------------------- state
let graph = buildCity();
let built: BuildOut;
let stack: Layer[] = defaultStack();
let selLayer = 0;
let selNode: number | null = null;
let selEdge: number | null = null;
let hoverNode: number | null = null;
let tool: 'select' | 'draw' | 'feature' = 'select';
let viewMode = 0;                       // 0 lit, 1 wire, 2 material, 3 topology
const layerData = new Float32Array(64);

const cam = { tgt: v3(0, 0, 0), yaw: 0.7, pitch: 0.62, dist: 230 };
let renderer: Renderer;
let solid: GpuMesh | null = null;
let wire: LineMesh | null = null;
let gizmo: LineMesh | null = null;

// ---------------------------------------------------------------- geometry
function rebuild(): void {
  const t0 = performance.now();
  built = buildNetwork(graph);
  const ms = performance.now() - t0;
  const { verts, idx } = built.mesh.toBuffers();

  // the ground, as one big quad under everything
  const G = 2600, F = 16;
  const gv = new Float32Array(4 * F);
  const corners: [number, number][] = [[-G, -G], [G, -G], [G, G], [-G, G]];
  corners.forEach((c, i) => {
    const o = i * F;
    gv[o] = c[0]; gv[o + 1] = -0.09; gv[o + 2] = c[1];
    gv[o + 4] = 0; gv[o + 5] = 1; gv[o + 6] = 0;
    gv[o + 8] = 9;                    // material: ground
  });
  const all = new Float32Array(verts.length + gv.length);
  all.set(verts); all.set(gv, verts.length);
  const base = verts.length / F;
  const gi = new Uint32Array([base, base + 1, base + 2, base, base + 2, base + 3]);
  const allIdx = new Uint32Array(idx.length + gi.length);
  allIdx.set(idx); allIdx.set(gi, idx.length);

  solid?.vbo.destroy(); solid?.ibo.destroy();
  solid = renderer.upload(all, allIdx);

  // quad wireframe
  const q = built.mesh.quads;
  const lv = new Float32Array((q.length) * 2 * 6);
  let k = 0;
  for (let i = 0; i < q.length; i += 4) {
    for (let e = 0; e < 4; e++) {
      const a = built.mesh.verts[q[i + e]].p, b = built.mesh.verts[q[i + ((e + 1) % 4)]].p;
      lv[k++] = a.x; lv[k++] = a.y + 0.012; lv[k++] = a.z; lv[k++] = 0.12; lv[k++] = 0.78; lv[k++] = 0.72;
      lv[k++] = b.x; lv[k++] = b.y + 0.012; lv[k++] = b.z; lv[k++] = 0.12; lv[k++] = 0.78; lv[k++] = 0.72;
    }
  }
  wire?.vbo.destroy();
  wire = renderer.uploadLines(lv);

  const s = built.stats;
  $('stats').innerHTML =
    `<b>${s.quads.toLocaleString()}</b> quads · <b>${s.tris}</b> tris · ` +
    `<b>${(100 * built.mesh.quadRatio).toFixed(2)}%</b> quad · ` +
    `<b>${s.verts.toLocaleString()}</b> verts · ${s.links} links · ${s.junctions} junctions · ` +
    `rebuilt in <b>${ms.toFixed(0)} ms</b>`;
  buildOutliner();
}

function buildGizmo(): void {
  if (selNode === null) { gizmo?.vbo.destroy(); gizmo = null; return; }
  const n = graph.nodes.get(selNode);
  if (!n) { gizmo = null; return; }
  const pts: number[] = [];
  const seg = (a: V3, b: V3, c: [number, number, number]) => {
    pts.push(a.x, a.y, a.z, c[0], c[1], c[2], b.x, b.y, b.z, c[0], c[1], c[2]);
  };
  const o = v3(n.p.x, n.p.y + 0.3, n.p.z);
  const L = 9;
  seg(o, add(o, v3(L, 0, 0)), [0.93, 0.33, 0.33]);
  seg(o, add(o, v3(0, L * 0.7, 0)), [0.42, 0.92, 0.45]);
  seg(o, add(o, v3(0, 0, L)), [0.36, 0.60, 0.98]);
  // arrow heads
  for (const [d, c] of [[v3(L, 0, 0), [0.93, 0.33, 0.33]], [v3(0, 0, L), [0.36, 0.6, 0.98]]] as const) {
    const tip = add(o, d as V3);
    const perp = v3((d as V3).z * 0.12, 0, -(d as V3).x * 0.12);
    seg(tip, add(sub(tip, mul(d as V3, 0.16)), perp), c as [number, number, number]);
    seg(tip, sub(sub(tip, mul(d as V3, 0.16)), perp), c as [number, number, number]);
  }
  // ring at the junction radius
  const r = built.junctions.get(selNode)?.radius ?? 10;
  let prev: V3 | null = null;
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const p = v3(n.p.x + Math.cos(a) * r, n.p.y + 0.18, n.p.z + Math.sin(a) * r);
    if (prev) seg(prev, p, [0.95, 0.68, 0.22]);
    prev = p;
  }
  gizmo?.vbo.destroy();
  gizmo = renderer.uploadLines(new Float32Array(pts));
}

// ---------------------------------------------------------------- UI: outliner
function buildOutliner(): void {
  const el = $('outliner');
  el.innerHTML = '';
  const group = (t: string) => { const d = document.createElement('div'); d.className = 'group'; d.textContent = t; el.appendChild(d); };
  group(`Junctions (${[...graph.nodes.values()].filter((n) => n.edges.length >= 3).length})`);
  for (const n of graph.nodes.values()) {
    if (n.edges.length < 3) continue;
    const row = document.createElement('div');
    row.className = 'row' + (selNode === n.id ? ' sel' : '');
    row.innerHTML = `<span class="ico">◆</span>Junction ${n.id}<span class="tag">${n.edges.length}-way${n.signals ? ' · signals' : ''}</span>`;
    row.onclick = () => { selNode = n.id; selEdge = null; buildGizmo(); buildInspector(); buildOutliner(); };
    el.appendChild(row);
  }
  group(`Roads (${graph.edges.size})`);
  for (const e of graph.edges.values()) {
    const row = document.createElement('div');
    row.className = 'row' + (selEdge === e.id ? ' sel' : '');
    row.innerHTML = `<span class="ico">—</span>${PROFILES[e.profile].label} ${e.id}` +
      `<span class="tag">${e.features.length ? `${e.features.length} feat` : ''}</span>`;
    row.onclick = () => { selEdge = e.id; selNode = null; buildGizmo(); buildInspector(); buildOutliner(); };
    el.appendChild(row);
  }
}

// ---------------------------------------------------------------- UI: stack
function buildStack(): void {
  const el = $('layers');
  el.innerHTML = '';
  stack.forEach((l, i) => {
    const row = document.createElement('div');
    row.className = 'layer' + (i === selLayer ? ' sel' : '');
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = l.on;
    cb.onclick = (ev) => { ev.stopPropagation(); l.on = cb.checked; sync(); };
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.innerHTML = `<b>${l.name}</b><span>${l.note}</span>`;
    const op = document.createElement('div');
    op.className = 'op'; op.textContent = `${Math.round(l.opacity * 100)}%`;
    row.append(cb, nm, op);
    row.onclick = () => { selLayer = i; buildStack(); buildInspector(); };
    el.appendChild(row);
  });
  $('layerCount').textContent = `${stack.filter((l) => l.on).length}/${stack.length} on`;
}

function moveLayer(d: number): void {
  const j = selLayer + d;
  if (j < 0 || j >= stack.length) return;
  [stack[selLayer], stack[j]] = [stack[j], stack[selLayer]];
  selLayer = j;
  buildStack(); sync();
}

// ---------------------------------------------------------------- UI: inspector
function field(parent: HTMLElement, label: string, v: number, min: number, max: number,
  step: number, fmt: (x: number) => string, on: (x: number) => void): void {
  const d = document.createElement('div');
  d.className = 'fld';
  const l = document.createElement('label'); l.textContent = label;
  const r = document.createElement('input');
  r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step); r.value = String(v);
  const o = document.createElement('div'); o.className = 'val'; o.textContent = fmt(v);
  r.oninput = () => { const x = parseFloat(r.value); o.textContent = fmt(x); on(x); };
  d.append(l, r, o);
  parent.appendChild(d);
}

function grp(parent: HTMLElement, t: string): void {
  const d = document.createElement('div'); d.className = 'grp'; d.textContent = t; parent.appendChild(d);
}

function buildInspector(): void {
  const el = $('inspector');
  el.innerHTML = '';
  const who = $('inspectorFor');

  if (selNode !== null && graph.nodes.get(selNode)) {
    const n = graph.nodes.get(selNode)!;
    who.textContent = `junction ${n.id}`;
    grp(el, 'Transform');
    field(el, 'Position X', n.p.x, n.p.x - 120, n.p.x + 120, 0.5, (v) => `${v.toFixed(1)}`,
      (v) => { n.p.x = v; rebuild(); buildGizmo(); });
    field(el, 'Position Z', n.p.z, n.p.z - 120, n.p.z + 120, 0.5, (v) => `${v.toFixed(1)}`,
      (v) => { n.p.z = v; rebuild(); buildGizmo(); });
    field(el, 'Elevation', n.p.y, -14, 14, 0.1, (v) => `${v.toFixed(1)} m`,
      (v) => { n.p.y = v; rebuild(); buildGizmo(); });
    grp(el, 'Control');
    const c = document.createElement('div'); c.className = 'fld check';
    c.innerHTML = '<label>Signalised</label>';
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = n.signals;
    cb.onchange = () => { n.signals = cb.checked; buildOutliner(); };
    c.appendChild(cb); el.appendChild(c);
    grp(el, 'Approaches');
    for (const f of graph.fan(n.id)) {
      const e = graph.edges.get(f.edge)!;
      const d = document.createElement('div'); d.className = 'fld';
      d.innerHTML = `<label>Road ${e.id}</label><div class="val" style="grid-column:2/span 2;text-align:left">` +
        `${PROFILES[e.profile].label} · ${(f.ang * 180 / Math.PI).toFixed(0)}°</div>`;
      el.appendChild(d);
    }
    return;
  }

  if (selEdge !== null && graph.edges.get(selEdge)) {
    const e = graph.edges.get(selEdge)!;
    who.textContent = `road ${e.id}`;
    grp(el, 'Classification');
    const sd = document.createElement('div'); sd.className = 'fld';
    sd.innerHTML = '<label>Profile</label>';
    const sel = document.createElement('select');
    for (const id of PROFILE_IDS) {
      const o = document.createElement('option');
      o.value = id; o.textContent = PROFILES[id].label; o.selected = id === e.profile;
      sel.appendChild(o);
    }
    sel.onchange = () => { e.profile = sel.value; rebuild(); buildInspector(); };
    sd.appendChild(sel); el.appendChild(sd);
    const p = PROFILES[e.profile];
    grp(el, 'Geometry');
    const info = document.createElement('div'); info.className = 'fld';
    info.innerHTML = `<label>Cross section</label><div class="val" style="grid-column:2/span 2;text-align:left">` +
      `${p.lanes}+${p.lanes} × ${p.laneWidth} m · kerb ${(p.kerbH * 1000).toFixed(0)} mm · ` +
      `footway ${p.footway} m · R${p.kerbRadius}</div>`;
    el.appendChild(info);
    field(el, 'Curve in', e.ha, 0.05, 0.9, 0.01, (v) => v.toFixed(2), (v) => { e.ha = v; rebuild(); });
    field(el, 'Curve out', e.hb, 0.05, 0.9, 0.01, (v) => v.toFixed(2), (v) => { e.hb = v; rebuild(); });
    grp(el, `Features (${e.features.length})`);
    const btns = document.createElement('div'); btns.className = 'rowbtns';
    for (const k of ['crossing', 'bump', 'pothole', 'works'] as const) {
      const b = document.createElement('button');
      b.textContent = `+ ${k}`;
      b.onclick = () => {
        e.features.push({
          kind: k, t: 0.5, seed: Math.floor(Math.random() * 9999),
          size: k === 'crossing' ? 4 : k === 'bump' ? 3.7 : k === 'works' ? 14 : 0.6,
          u: (Math.random() - 0.5) * p.carriageHalf,
        });
        rebuild(); buildInspector();
      };
      btns.appendChild(b);
    }
    el.appendChild(btns);
    e.features.forEach((f, i) => {
      field(el, `${f.kind} ${i + 1} · at`, f.t, 0.05, 0.95, 0.005, (v) => `${(v * 100).toFixed(0)}%`,
        (v) => { f.t = v; rebuild(); });
    });
    if (e.features.length) {
      const clr = document.createElement('div'); clr.className = 'rowbtns';
      const b = document.createElement('button'); b.className = 'danger'; b.textContent = 'Clear features';
      b.onclick = () => { e.features.length = 0; rebuild(); buildInspector(); };
      clr.appendChild(b); el.appendChild(clr);
    }
    return;
  }

  // nothing selected: show the layer being edited
  const l = stack[selLayer];
  who.textContent = `layer · ${l.name}`;
  grp(el, 'Layer');
  const c = document.createElement('div'); c.className = 'fld check';
  c.innerHTML = '<label>Enabled</label>';
  const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = l.on;
  cb.onchange = () => { l.on = cb.checked; buildStack(); sync(); };
  c.appendChild(cb); el.appendChild(c);
  field(el, 'Opacity', l.opacity, 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`,
    (v) => { l.opacity = v; buildStack(); sync(); });
  grp(el, 'Parameters');
  l.params.forEach((p, i) => {
    field(el, p.label, l.values[i], p.min, p.max, p.step, p.fmt ?? ((v) => v.toFixed(2)),
      (v) => { l.values[i] = v; sync(); });
  });
  grp(el, 'Scene');
  field(el, 'Sun height', sun.h, 0.08, 1.4, 0.01, (v) => `${(v * 57).toFixed(0)}°`, (v) => { sun.h = v; });
  field(el, 'Sun azimuth', sun.a, -3.14, 3.14, 0.01, (v) => `${(v * 57).toFixed(0)}°`, (v) => { sun.a = v; });
  field(el, 'Sun strength', sun.i, 0, 3, 0.01, (v) => v.toFixed(2), (v) => { sun.i = v; });
}

const sun = { h: 0.62, a: 0.9, i: 1.5 };
function sync(): void { packLayers(stack, layerData); }

// ---------------------------------------------------------------- camera / input
function viewProj(): { vp: M4; eye: V3 } {
  const r = canvas.width / Math.max(1, canvas.height);
  const eye = add(cam.tgt, v3(
    Math.cos(cam.pitch) * Math.sin(cam.yaw) * cam.dist,
    Math.sin(cam.pitch) * cam.dist,
    Math.cos(cam.pitch) * Math.cos(cam.yaw) * cam.dist));
  const proj = m4Perspective(0.86, r, 0.6, 6000);
  return { vp: m4Mul(proj, m4LookAt(eye, cam.tgt, v3(0, 1, 0))), eye };
}

function ray(sx: number, sy: number): { ro: V3; rd: V3 } {
  const rect = canvas.getBoundingClientRect();
  const x = ((sx - rect.left) / rect.width) * 2 - 1;
  const y = 1 - ((sy - rect.top) / rect.height) * 2;
  const { vp } = viewProj();
  const inv = m4Invert(vp);
  const a = m4XformPoint(inv, v3(x, y, 0));
  const b = m4XformPoint(inv, v3(x, y, 1));
  return { ro: a, rd: norm(sub(b, a)) };
}

function groundHit(ro: V3, rd: V3, y = 0): V3 | null {
  if (Math.abs(rd.y) < 1e-6) return null;
  const t = (y - ro.y) / rd.y;
  return t > 0 ? add(ro, mul(rd, t)) : null;
}

function pickNode(sx: number, sy: number): number | null {
  const { ro, rd } = ray(sx, sy);
  const g = groundHit(ro, rd);
  if (!g) return null;
  let best: number | null = null, bd = Infinity;
  for (const [id, j] of built.junctions) {
    const d = Math.hypot(g.x - j.centre.x, g.z - j.centre.z);
    if (d < j.radius * 0.85 && d < bd) { bd = d; best = id; }
  }
  if (best !== null) return best;
  for (const n of graph.nodes.values()) {
    const d = Math.hypot(g.x - n.p.x, g.z - n.p.z);
    if (d < 9 && d < bd) { bd = d; best = n.id; }
  }
  return best;
}

function pickEdge(sx: number, sy: number): number | null {
  const { ro, rd } = ray(sx, sy);
  const g = groundHit(ro, rd);
  if (!g) return null;
  let best: number | null = null, bd = Infinity;
  for (const e of graph.edges.values()) {
    const tab = graph.arcTable(e, 24);
    for (let i = 0; i <= 24; i++) {
      const p = RoadGraph.evalBezier(tab.c, i / 24);
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      if (d < graph.profileOf(e).totalHalf && d < bd) { bd = d; best = e.id; }
    }
  }
  return best;
}

let drag: null | { mode: 'orbit' | 'pan' | 'node'; x: number; y: number; moved: number } = null;

canvas.addEventListener('pointerdown', (ev) => {
  canvas.setPointerCapture(ev.pointerId);
  if (ev.button === 2) { drag = { mode: 'pan', x: ev.clientX, y: ev.clientY, moved: 0 }; return; }
  if (tool === 'select' && selNode !== null && pickNode(ev.clientX, ev.clientY) === selNode) {
    drag = { mode: 'node', x: ev.clientX, y: ev.clientY, moved: 0 };
    return;
  }
  drag = { mode: 'orbit', x: ev.clientX, y: ev.clientY, moved: 0 };
});

canvas.addEventListener('pointermove', (ev) => {
  if (!drag) {
    const h = tool === 'select' ? pickNode(ev.clientX, ev.clientY) : null;
    if (h !== hoverNode) { hoverNode = h; canvas.style.cursor = h !== null ? 'move' : 'default'; }
    return;
  }
  const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
  drag.x = ev.clientX; drag.y = ev.clientY;
  drag.moved += Math.abs(dx) + Math.abs(dy);
  if (drag.mode === 'orbit') {
    cam.yaw -= dx * 0.005;
    cam.pitch = clamp(cam.pitch + dy * 0.004, 0.06, 1.48);
  } else if (drag.mode === 'pan') {
    const s = cam.dist * 0.0016;
    const right = v3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
    const fwd = v3(Math.sin(cam.yaw), 0, Math.cos(cam.yaw));
    cam.tgt = add(cam.tgt, add(mul(right, -dx * s), mul(fwd, -dy * s)));
  } else if (drag.mode === 'node' && selNode !== null) {
    const r = ray(ev.clientX, ev.clientY);
    const g = groundHit(r.ro, r.rd);
    const n = graph.nodes.get(selNode);
    if (g && n) { n.p.x = g.x; n.p.z = g.z; rebuild(); buildGizmo(); }
  }
});

canvas.addEventListener('pointerup', (ev) => {
  const wasDrag = drag;
  drag = null;
  if (!wasDrag || wasDrag.moved > 5) { if (wasDrag?.mode === 'node') buildInspector(); return; }
  if (ev.button !== 0) return;
  if (tool === 'select') {
    const n = pickNode(ev.clientX, ev.clientY);
    if (n !== null) { selNode = n; selEdge = null; } else {
      const e = pickEdge(ev.clientX, ev.clientY);
      selEdge = e; selNode = null;
    }
    buildGizmo(); buildInspector(); buildOutliner();
  } else if (tool === 'draw') {
    const r0 = ray(ev.clientX, ev.clientY);
    const g = groundHit(r0.ro, r0.rd);
    if (!g) return;
    const near = pickNode(ev.clientX, ev.clientY);
    const target = near !== null ? near : graph.addNode(v3(g.x, 0, g.z)).id;
    if (selNode !== null && selNode !== target) graph.addEdge(selNode, target, 'street');
    selNode = target;
    rebuild(); buildGizmo(); buildInspector(); buildOutliner();
  } else if (tool === 'feature') {
    const e = pickEdge(ev.clientX, ev.clientY);
    if (e === null) return;
    const ed = graph.edges.get(e)!;
    const r1 = ray(ev.clientX, ev.clientY);
    const g = groundHit(r1.ro, r1.rd)!;
    const tab = graph.arcTable(ed, 48);
    let bt = 0.5, bd = Infinity;
    for (let i = 0; i <= 48; i++) {
      const p = RoadGraph.evalBezier(tab.c, i / 48);
      const d = Math.hypot(g.x - p.x, g.z - p.z);
      if (d < bd) { bd = d; bt = i / 48; }
    }
    ed.features.push({ kind: 'bump', t: clamp(bt, 0.06, 0.94), size: 3.7, seed: (Math.random() * 9999) | 0 });
    selEdge = e; selNode = null;
    rebuild(); buildInspector(); buildOutliner();
  }
});

canvas.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  cam.dist = clamp(cam.dist * Math.exp(ev.deltaY * 0.0012), 9, 1800);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

for (const b of Array.from(document.querySelectorAll('#topbar nav button'))) {
  b.addEventListener('click', () => {
    for (const o of Array.from(document.querySelectorAll('#topbar nav button'))) o.classList.remove('on');
    b.classList.add('on');
    tool = (b as HTMLElement).dataset.tool as typeof tool;
  });
}
for (const b of Array.from(document.querySelectorAll('.viewmode button'))) {
  b.addEventListener('click', () => {
    for (const o of Array.from(document.querySelectorAll('.viewmode button'))) o.classList.remove('on');
    b.classList.add('on');
    viewMode = ['lit', 'wire', 'mat', 'topo'].indexOf((b as HTMLElement).dataset.view!);
  });
}
$('layerUp').onclick = () => moveLayer(-1);
$('layerDown').onclick = () => moveLayer(1);
window.addEventListener('keydown', (e) => {
  if (e.key === 'q') (document.querySelector('[data-tool=select]') as HTMLElement).click();
  if (e.key === 'w') (document.querySelector('[data-tool=draw]') as HTMLElement).click();
  if (e.key === 'e') (document.querySelector('[data-tool=feature]') as HTMLElement).click();
  if (e.key === 'Delete' && selEdge !== null) { graph.removeEdge(selEdge); selEdge = null; rebuild(); buildInspector(); }
  if (e.key === 'f' && selNode !== null) { cam.tgt = { ...graph.nodes.get(selNode)!.p }; cam.dist = 70; }
});

// ---------------------------------------------------------------- frame loop
function resize(): void {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w; canvas.height = h;
  renderer.resize(w, h);
}

let last = performance.now(), fps = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  fps = fps * 0.92 + (1 / Math.max(dt, 1e-4)) * 0.08;
  resize();
  const { vp, eye } = viewProj();
  const sd = norm(v3(Math.cos(sun.a) * Math.cos(sun.h), Math.sin(sun.h), Math.sin(sun.a) * Math.cos(sun.h)));
  renderer.setUniforms(vp, [eye.x, eye.y, eye.z], [sd.x, sd.y, sd.z, sun.i],
    [now / 1000, viewMode, hoverNode ?? -1, selNode ?? -1], [0, 0, 0, 0], layerData);

  const lines: LineMesh | null = viewMode === 1 || viewMode === 3 ? wire : gizmo;
  renderer.frame(solid, lines, [0.055, 0.065, 0.08]);
  if (viewMode !== 1 && viewMode !== 3 && gizmo && wire) { /* gizmo already drawn */ }

  $('hud').textContent =
    `${fps.toFixed(0)} fps\n${graph.nodes.size} nodes · ${graph.edges.size} roads\n` +
    `tool: ${tool}${selNode !== null ? `\nselected: junction ${selNode}` : selEdge !== null ? `\nselected: road ${selEdge}` : ''}`;
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
(async () => {
  const why = await Renderer.supported();
  if (why) { die(why); return; }
  renderer = new Renderer();
  try {
    await renderer.init(canvas);
  } catch (e) {
    die(`WebGPU initialisation failed.\n\n${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
    return;
  }
  resize();
  sync();
  rebuild();
  buildStack();
  buildInspector();
  requestAnimationFrame(frame);
})();
