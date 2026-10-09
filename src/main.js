import './style.css';
import { h, download } from './ui/dom.js';
import { renderStack, openAddDialog } from './ui/stack-panel.js';
import { renderProps } from './ui/props.js';
import { draw2d, VIEW_MODES } from './ui/view2d.js';
import { Terrain3D, Voxel3D, buildVoxels } from './ui/view3d.js';
import { starterProject, newProject, makeLayer, serialize, deserialize } from './engine/project.js';
import { encodePNG, encodeRaw16, decodeRaw16, lumaFromRGBA } from './engine/io.js';
import { NODES } from './engine/registry.js';
import { BLEND } from './engine/ops.js';

const BLEND_OPTIONS = Object.keys(BLEND);
const RES_OPTIONS = [128, 192, 256, 384, 512];

let project = starterProject(256);
let selectedId = project.layers.at(-1)?.id ?? null;
let result = null, reqId = 0, applied = 0, timer = null, evalError = null;
const paint = { on: false, radius: 12 };
const view = { tab: '2d', mode: 'height' };
let terrain3d = null, voxel3d = null;
const busy = () => { status.textContent = 'evaluating…'; };

// ---------- worker ----------
const worker = new Worker(new URL('./engine.worker.js', import.meta.url), { type: 'module' });
worker.onmessage = (e) => {
  const { id, result: r, error } = e.data;
  if (id !== reqId) return; // stale
  if (error) { evalError = error; result = null; } else { evalError = null; result = r; applied = id; }
  if (result && result.view && VIEW_MODES.includes(result.view.mode)) view.mode = result.view.mode;
  refreshViews();
};
function schedule(delay = 120) { busy(); clearTimeout(timer); timer = setTimeout(run, delay); }
function run() { reqId++; worker.postMessage({ id: reqId, project }); }

// ---------- layout ----------
const resSel = h('select', { title: 'Heightmap resolution' }, RES_OPTIONS.map((n) => h('option', { value: n, selected: n === project.N }, `${n}²`)));
resSel.addEventListener('change', () => { project.N = +resSel.value; project.layers.forEach((l) => { if (l.mask?.painted) l.mask.painted = { N: project.N, data: new Float32Array(project.N * project.N).fill(l.mask.painted.data[0] ?? 1) }; }); schedule(0); });
const seedIn = h('input', { type: 'number', value: project.seed, title: 'Project seed (reseeds every noise layer)', min: 0, max: 9999 });
seedIn.addEventListener('change', () => { project.seed = +seedIn.value; schedule(0); });
const status = h('span', { class: 'busy' }, '');
const fileOpen = h('input', { type: 'file', accept: '.json,application/json', class: 'hidden' });
const rawOpen = h('input', { type: 'file', accept: '.png,.jpg,.jpeg,.webp,.raw,.r16,.bin', class: 'hidden' });
let importTarget = null;
rawOpen.addEventListener('change', () => { const f = rawOpen.files[0]; if (f && importTarget) importFile(importTarget, f); rawOpen.value = ''; });
fileOpen.addEventListener('change', async () => { const f = fileOpen.files[0]; if (!f) return; project = deserialize(await f.text()); selectedId = project.layers.at(-1)?.id ?? null; seedIn.value = project.seed; resSel.value = project.N; renderAll(); schedule(0); fileOpen.value = ''; });
const exportSel = h('select', { title: 'Export' }, h('option', { value: '' }, 'Export…'), h('option', { value: 'png16' }, 'Heightmap PNG (16-bit)'), h('option', { value: 'raw16' }, 'Heightmap RAW (16-bit LE)'), h('option', { value: 'albedo' }, 'Albedo PNG (8-bit)'), h('option', { value: 'water' }, 'Water mask PNG'), h('option', { value: 'voxel' }, 'Voxel grid (.vox.raw)'), h('option', { value: 'project' }, 'Project JSON'));
exportSel.addEventListener('change', async () => { const v = exportSel.value; exportSel.value = ''; if (v) await exportAs(v); });

const topbar = h('div', { class: 'topbar' },
  h('span', { class: 'brand' }, 'SLATE'),
  h('button', { onclick: () => openAddDialog((id) => addLayer(id)) }, '+ Add layer'),
  h('span', { class: 'sep' }),
  h('button', { onclick: () => { project = starterProject(project.N); selectedId = project.layers.at(-1).id; seedIn.value = project.seed; renderAll(); schedule(0); } }, 'Load starter'),
  h('button', { onclick: () => { project = newProject(project.N); selectedId = null; renderAll(); schedule(0); } }, 'New'),
  h('button', { onclick: () => fileOpen.click() }, 'Open…'),
  h('button', { onclick: () => download(`${project.name.replace(/\W+/g, '_') || 'project'}.slate.json`, serialize(project), 'application/json') }, 'Save'),
  h('span', { class: 'sep' }),
  h('label', {}, 'Resolution ', resSel),
  h('label', {}, 'Seed ', seedIn),
  h('span', { class: 'sep' }),
  exportSel,
  fileOpen, rawOpen,
);
const stackEl = h('aside', { id: 'stack', class: 'panel' },
  h('div', { class: 'panel-h' }, h('b', {}, 'Layer stack'), h('small', { style: 'color:var(--dim)' }, 'top = applied last')));
const stackList = h('div', { id: 'layers' });
stackEl.append(stackList);

const tabBtn = (id, label) => h('button', { class: view.tab === id ? 'on' : '', 'data-tab': id, onclick: () => setTab(id) }, label);
const modeSel = h('select', { title: 'Map view' }, VIEW_MODES.map((m) => h('option', { value: m }, m)));
modeSel.addEventListener('change', () => { view.mode = modeSel.value; refreshViews(); });
const canvas2d = h('canvas', { width: 256, height: 256 });
const tabs = h('div', { class: 'tabs' }, tabBtn('2d', '2D map'), tabBtn('3d', '3D terrain'), tabBtn('voxel', 'Voxels (derived)'), h('span', { class: 'spacer' }), h('label', { class: 'inline' }, 'View ', modeSel));
const view2dEl = h('div', { id: 'view2d' }, h('div', { class: 'stage' }, canvas2d));
const view3dEl = h('div', { id: 'view3d', class: 'hidden' });
const voxelEl = h('div', { id: 'voxel', class: 'hidden' });
const wrap = h('div', { class: 'viewwrap' }, view2dEl, view3dEl, voxelEl);
const center = h('section', { class: 'center' }, tabs, wrap);
const propsEl = h('aside', { id: 'props', class: 'panel' });
const footer = h('footer', {});
document.querySelector('#app').replaceChildren(h('div', { class: 'app' }, topbar, h('div', { class: 'grid' }, stackEl, center, propsEl), footer));

// paint on the 2D view
let painting = null;
canvas2d.addEventListener('pointerdown', (e) => { if (view.tab !== '2d') return; const l = selectedLayer(); if (!paint.on || !l || l.mask?.type !== 178) return; painting = { erase: e.shiftKey }; canvas2d.setPointerCapture(e.pointerId); paintAt(e); });
canvas2d.addEventListener('pointermove', (e) => { if (painting) paintAt(e); });
canvas2d.addEventListener('pointerup', () => { painting = null; });
function paintAt(e) {
  const l = selectedLayer(); const N = project.N;
  const r = canvas2d.getBoundingClientRect();
  const cx = Math.floor((e.clientX - r.left) / r.width * N), cy = Math.floor((e.clientY - r.top) / r.height * N);
  const m = l.mask; if (!m.painted || m.painted.N !== N) m.painted = { N, data: new Float32Array(N * N).fill(m.painted?.data?.[0] ?? 1) };
  const R = paint.radius * N / 256, v = painting?.erase ? 0 : 1;
  for (let y = Math.max(0, cy - R | 0); y <= Math.min(N - 1, cy + R); y++) for (let x = Math.max(0, cx - R | 0); x <= Math.min(N - 1, cx + R); x++) {
    const d = Math.hypot(x - cx, y - cy); if (d > R) continue;
    const k = y * N + x, a = 1 - d / R;
    m.painted.data[k] += (v - m.painted.data[k]) * a * 0.6;
  }
  schedule(60);
}

// ---------- state helpers ----------
const selectedLayer = () => project.layers.find((l) => l.id === selectedId) || null;
function addLayer(nodeId) {
  const layer = makeLayer(nodeId);
  const idx = project.layers.findIndex((l) => l.id === selectedId);
  if (idx >= 0) project.layers.splice(idx + 1, 0, layer); else project.layers.push(layer);
  selectedId = layer.id;
  renderAll(); schedule(0);
}
function moveLayer(id, dir) {
  const i = project.layers.findIndex((l) => l.id === id), j = i + dir;
  if (j < 0 || j >= project.layers.length) return;
  [project.layers[i], project.layers[j]] = [project.layers[j], project.layers[i]];
  renderAll(); schedule(0);
}
function deleteLayer(id) { project.layers = project.layers.filter((l) => l.id !== id); if (selectedId === id) selectedId = project.layers.at(-1)?.id ?? null; renderAll(); schedule(0); }
function toggleLayer(id) { const l = project.layers.find((x) => x.id === id); if (l) { l.enabled = !l.enabled; renderAll(); schedule(0); } }

function renderAll() {
  renderStack(stackList, project, selectedId, {
    onSelect: (id) => { selectedId = id; renderAll(); },
    onToggle: toggleLayer, onMove: moveLayer, onDelete: deleteLayer,
  });
  renderPropsPanel();
  refreshViews();
}
function renderPropsPanel() {
  const l = selectedLayer();
  renderProps(propsEl, project, l, {
    paint,
    onChange: (rebuild = true) => { if (rebuild) { renderStack(stackList, project, selectedId, { onSelect: (id) => { selectedId = id; renderAll(); }, onToggle: toggleLayer, onMove: moveLayer, onDelete: deleteLayer }); renderPropsPanel(); } schedule(rebuild ? 0 : 120); },
    onPaintChange: () => { renderPropsPanel(); refreshViews(); },
    onImport: (layer, file) => { importTarget = layer; importFile(layer, file); },
  });
}
async function importFile(layer, file) {
  try {
    let imp;
    if (/\.(raw|r16|bin)$/i.test(file.name)) imp = decodeRaw16(await file.arrayBuffer());
    else {
      const bmp = await createImageBitmap(file);
      const c = new OffscreenCanvas(bmp.width, bmp.height), cx = c.getContext('2d');
      cx.drawImage(bmp, 0, 0);
      const d = cx.getImageData(0, 0, bmp.width, bmp.height).data;
      imp = lumaFromRGBA(d, bmp.width, bmp.height);
    }
    layer.imported = { N: imp.N, data: imp.data };
    renderPropsPanel(); schedule(0);
  } catch (err) { evalError = `Import failed: ${err.message}`; refreshViews(); }
}

// ---------- views ----------
function setTab(id) {
  view.tab = id;
  for (const b of tabs.querySelectorAll('[data-tab]')) b.classList.toggle('on', b.dataset.tab === id);
  view2dEl.classList.toggle('hidden', id !== '2d');
  view3dEl.classList.toggle('hidden', id !== '3d');
  voxelEl.classList.toggle('hidden', id !== 'voxel');
  if (id === '3d' && !terrain3d) terrain3d = new Terrain3D(view3dEl);
  if (id === 'voxel' && !voxel3d) voxel3d = new Voxel3D(voxelEl);
  refreshViews();
}
function refreshViews() {
  modeSel.value = view.mode;
  const l = selectedLayer();
  const paintOverlay = paint.on && l && l.mask?.type === 178 ? l.mask.painted : null;
  if (result) {
    if (view.tab === '2d') draw2d(canvas2d, result, view.mode, paintOverlay);
    if (view.tab === '3d' && terrain3d) terrain3d.update(result, result.view3D?.exaggeration ?? 1);
    if (view.tab === 'voxel' && voxel3d) voxel3d.update(result);
  }
  const s = result;
  const wet = s?.water ? s.water.reduce((a, v) => a + (Number.isNaN(v) ? 0 : 1), 0) / s.water.length : 0;
  const mean = s ? s.h.reduce((a, b) => a + b, 0) / s.h.length : 0;
  const total = s ? s.timings.reduce((a, t) => a + t.ms, 0) : 0;
  footer.replaceChildren(
    h('span', {}, 'Grid ', h('b', {}, `${project.N}²`)),
    h('span', {}, 'Layers ', h('b', {}, project.layers.filter((x) => x.enabled).length), ` / ${project.layers.length}`),
    h('span', {}, 'Height ', h('b', {}, s ? `${s.range.min.toFixed(3)}…${s.range.max.toFixed(3)}` : '—'), ' mean ', h('b', {}, mean.toFixed(3))),
    h('span', {}, 'Water ', h('b', {}, `${(wet * 100).toFixed(1)}%`)),
    h('span', {}, 'Eval ', h('b', {}, `${total} ms`)),
    voxel3d && voxel3d.voxelCount != null && view.tab === 'voxel' ? h('span', {}, 'Voxels ', h('b', {}, voxel3d.voxelCount.toLocaleString())) : null,
    evalError ? h('span', { class: 'err' }, evalError.split('\n')[0]) : null,
  );
  status.textContent = '';
}

// ---------- export ----------
async function exportAs(kind) {
  if (!result) return;
  const N = result.N, base = (project.name || 'terrain').replace(/\W+/g, '_');
  if (kind === 'png16') download(`${base}_height_${N}.png`, await encodePNG(N, N, 1, 16, result.h), 'image/png');
  if (kind === 'raw16') download(`${base}_height_${N}.r16`, encodeRaw16(result.h));
  if (kind === 'albedo') download(`${base}_albedo_${N}.png`, await encodePNG(N, N, 3, 8, result.albedo), 'image/png');
  if (kind === 'water') {
    const m = new Float32Array(N * N); for (let i = 0; i < m.length; i++) m[i] = result.water && !Number.isNaN(result.water[i]) ? 1 : 0;
    download(`${base}_water_${N}.png`, await encodePNG(N, N, 1, 8, m), 'image/png');
  }
  if (kind === 'voxel') {
    const { N: vn, L, grid } = buildVoxels(result, { res: Math.min(N, 96), levels: 40 });
    download(`${base}_voxels_${vn}x${L}x${vn}.vox.raw`, grid);
  }
  if (kind === 'project') download(`${base}.slate.json`, serialize(project), 'application/json');
}

// expose for console debugging / tests
window.__slate = { get project() { return project; }, get result() { return result; }, schedule };
setTab('2d');
renderAll();
schedule(0);
