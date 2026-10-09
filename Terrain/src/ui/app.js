// Application controller: layer stack list, inspector (built from each definition's parameter schema), mask controls,
// views, painting, and project/export actions. All processing goes through evaluateStack; the UI holds no terrain logic.
import { createPreset, presetNames, createLayer, createBlank, serializeDocument, deserializeDocument } from '../engine/document.js';
import { evaluateStack } from '../engine/stack.js';
import { categories, byId, MASK_TYPES, BLEND_OPTIONS } from '../engine/registry.js';
import { maskDefByKey } from '../engine/masks.js';
import { createViewport2d } from '../view/viewport2d.js';
import { createTerrain3d } from '../view/terrain3d.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function startApp() {
  const state = {
    doc: createPreset('Alpine valley', 192),
    selectedId: null,
    view: '3d',
    viewMode: 'colour',
    mapName: null,
    voxel: false,
    paint: false,
    brush: { radius: 0.035, strength: 1, erase: false },
    result: null,
    busy: false,
    pending: false,
    timer: null,
    voxelInfo: null,
  };
  state.selectedId = state.doc.layers[state.doc.layers.length - 1]?.id ?? null;

  const vp2 = createViewport2d($('#view2d'), { onPaint: paintStroke });
  const vp3 = createTerrain3d($('#view3d'));

  // ---- Evaluation -------------------------------------------------------------------------------------------
  function schedule(delay = 120) {
    clearTimeout(state.timer);
    state.timer = setTimeout(run, delay);
  }
  function run() {
    if (state.busy) { state.pending = true; return; }
    state.busy = true;
    try {
      state.result = evaluateStack(state.doc, { previewId: state.selectedId });
    } catch (err) {
      console.error(err);
      state.result = null;
      $('#status').textContent = `Evaluation failed: ${err.message}`;
    } finally {
      state.busy = false;
    }
    if (state.pending) { state.pending = false; schedule(0); }
    renderViews();
    renderStats();
  }

  function renderViews() {
    const r = state.result;
    if (!r) return;
    const sel = selected();
    const maskGrid = r.preview?.mask ?? null;
    if (state.view === '2d') {
      const painting = state.paint && sel && sel.mask && sel.mask.type === 'painted';
      vp2.draw(r, { mode: painting ? 'mask' : state.viewMode, mapName: state.mapName, layerMask: maskGrid });
    } else {
      state.voxelInfo = vp3.setResult(r, { voxel: state.voxel, exaggeration: Number($('#exag').value) || 1 });
    }
    $('#viewport2d').hidden = state.view !== '2d';
    $('#viewport3d').hidden = state.view !== '3d';
    $('#voxelInfo').textContent = state.voxel && state.voxelInfo
      ? `Voxels: ${state.voxelInfo.count.toLocaleString()} exposed${state.voxelInfo.truncated ? ' (truncated)' : ''}`
      : '';
    $('#paintHint').hidden = !(state.paint && sel && sel.mask && sel.mask.type === 'painted');
    void sel;
  }

  function renderStats() {
    const r = state.result;
    if (!r) return;
    const s = r.summary;
    const water = Array.from(r.water).reduce((a, v) => a + (v > 0 ? 1 : 0), 0) / r.water.length;
    const timings = [...r.timings].sort((a, b) => b.ms - a.ms).slice(0, 4)
      .map((t) => `${esc(t.name)} ${t.ms.toFixed(0)}ms`).join(' · ');
    $('#stats').innerHTML = `
      <span>Height ${s.min.toFixed(3)}–${s.max.toFixed(3)} (mean ${s.mean.toFixed(3)})</span>
      <span>≈ ${(s.max - s.min) * r.cfg.heightScale | 0} m relief</span>
      <span>Water ${(water * 100).toFixed(1)}%</span>
      <span>Total ${s.ms.toFixed(0)} ms</span>
      <span class="muted">Slowest: ${timings || '—'}</span>`;
    const errs = r.errors.map((e) => `<li>Layer ${esc(e.id)}: ${esc(e.message)}</li>`).join('');
    $('#errors').innerHTML = errs ? `<ul>${errs}</ul>` : '';
    const names = Object.keys(r.maps);
    const mapSel = $('#mapSel');
    mapSel.innerHTML = names.length
      ? names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('')
      : '<option value="">(no maps)</option>';
    if (state.mapName && names.includes(state.mapName)) mapSel.value = state.mapName;
    else state.mapName = names[0] || null;
  }

  // ---- Layer stack ------------------------------------------------------------------------------------------
  const selected = () => state.doc.layers.find((l) => l.id === state.selectedId) || null;
  const indexOf = (id) => state.doc.layers.findIndex((l) => l.id === id);

  function renderStack() {
    const list = $('#stack');
    const rows = [...state.doc.layers].map((l, i) => ({ l, i })).reverse();
    list.innerHTML = rows.map(({ l, i }) => {
      const def = byId.get(l.type);
      const cls = [l.id === state.selectedId ? 'sel' : '', l.enabled ? '' : 'off'].join(' ');
      return `<li class="${cls}" data-id="${esc(l.id)}">
        <button class="eye" data-act="toggle" title="Enable / disable">${l.enabled ? '●' : '○'}</button>
        <span class="lname">${esc(l.name)}</span>
        <span class="tag">${esc(def ? `${def.id}` : '?')}${l.mask && l.mask.type ? ' ◧' : ''}</span>
        <span class="row-btns">
          <button data-act="up" title="Move up" ${i === state.doc.layers.length - 1 ? 'disabled' : ''}>↑</button>
          <button data-act="down" title="Move down" ${i === 0 ? 'disabled' : ''}>↓</button>
          <button data-act="dup" title="Duplicate">⧉</button>
          <button data-act="del" title="Delete">✕</button>
        </span></li>`;
    }).join('');
    const opts = categories.map((c) => `<optgroup label="${esc(c.name)}">${c.defs.map((d) => `<option value="${d.id}">${d.id} · ${esc(d.name)}</option>`).join('')}</optgroup>`).join('');
    $('#addSel').innerHTML = opts;
    $('#presetSel').innerHTML = presetNames.map((n) => `<option>${esc(n)}</option>`).join('');
    renderInspector();
  }

  function addLayer(typeId) {
    const def = byId.get(Number(typeId));
    if (!def) return;
    const layer = createLayer(def.id);
    const at = indexOf(state.selectedId);
    state.doc.layers.splice(at < 0 ? state.doc.layers.length : at + 1, 0, layer);
    state.selectedId = layer.id;
    afterEdit();
  }

  function afterEdit() {
    renderStack();
    schedule(0);
  }

  $('#stack').addEventListener('click', (ev) => {
    const row = ev.target.closest('li');
    if (!row) return;
    const id = row.dataset.id;
    const act = ev.target.closest('button')?.dataset.act;
    const i = indexOf(id);
    const L = state.doc.layers;
    if (!act) { state.selectedId = id; renderStack(); renderViews(); return; }
    if (act === 'toggle') L[i].enabled = !L[i].enabled;
    if (act === 'up' && i < L.length - 1) [L[i], L[i + 1]] = [L[i + 1], L[i]];
    if (act === 'down' && i > 0) [L[i], L[i - 1]] = [L[i - 1], L[i]];
    if (act === 'dup') {
      const copy = JSON.parse(JSON.stringify(L[i]));
      copy.id = createLayer(L[i].type).id;
      copy.name = `${L[i].name} copy`;
      if (L[i].mask && L[i].mask.paint) copy.mask.paint = new Uint8Array(L[i].mask.paint);
      L.splice(i + 1, 0, copy);
      state.selectedId = copy.id;
    }
    if (act === 'del') {
      L.splice(i, 1);
      state.selectedId = L[Math.min(i, L.length - 1)]?.id ?? null;
    }
    afterEdit();
  });

  $('#addBtn').addEventListener('click', () => addLayer($('#addSel').value));

  // ---- Inspector --------------------------------------------------------------------------------------------
  function paramControl(p, value, scope) {
    const id = `${scope}-${p.k}`;
    const label = `<label for="${id}">${esc(p.label)}</label>`;
    if (p.t === 'sel') {
      return `<div class="field">${label}<select id="${id}" data-scope="${scope}" data-k="${p.k}">${p.options.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>`;
    }
    if (p.t === 'bool') {
      return `<div class="field check">${label}<input type="checkbox" id="${id}" data-scope="${scope}" data-k="${p.k}" ${value ? 'checked' : ''}></div>`;
    }
    if (p.t === 'color') {
      return `<div class="field">${label}<input type="color" id="${id}" data-scope="${scope}" data-k="${p.k}" value="${esc(value)}"></div>`;
    }
    const step = p.step ?? (p.t === 'int' ? 1 : 0.01);
    return `<div class="field">${label}
      <input type="range" min="${p.min}" max="${p.max}" step="${step}" value="${value}" data-scope="${scope}" data-k="${p.k}" data-kind="range">
      <input type="number" min="${p.min}" max="${p.max}" step="${step}" value="${value}" id="${id}" data-scope="${scope}" data-k="${p.k}" data-kind="num"></div>`;
  }

  function renderInspector() {
    const l = selected();
    const box = $('#inspector');
    if (!l) { box.innerHTML = '<p class="muted">Select a layer to edit it.</p>'; return; }
    const def = byId.get(l.type);
    const maskDef = l.mask && l.mask.type ? maskDefByKey[`mask_${l.mask.type}`] : null;
    const maskOpts = `<option value="">None</option>` + MASK_TYPES.map((m) => `<option value="${esc(m.key)}" ${l.mask && l.mask.type === m.key ? 'selected' : ''}>${esc(m.def.name)}</option>`).join('');
    const blendOpts = BLEND_OPTIONS.map(([v, t]) => `<option value="${esc(v)}" ${l.blend === v ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const layerParams = def.params.map((p) => paramControl(p, l.params[p.k] ?? p.def, 'layer')).join('');
    const maskParams = maskDef ? maskDef.params.map((p) => paramControl(p, (l.mask.params || {})[p.k] ?? p.def, 'mask')).join('') : '';
    box.innerHTML = `
      <div class="layer-head"><strong>${esc(def.name)}</strong><span class="badge ${def.status}">${esc(def.status)}</span><span class="muted">#${def.id} · ${esc(def.cat)}</span></div>
      <p class="desc">${esc(def.desc)}</p>
      <div class="field"><label>Name</label><input type="text" id="layerName" value="${esc(l.name)}"></div>
      <div class="field"><label>Opacity</label><input type="range" min="0" max="1" step="0.01" value="${l.opacity}" id="opacity"><span class="val">${l.opacity.toFixed(2)}</span></div>
      <div class="field"><label>Blend</label><select id="blend">${blendOpts}</select></div>
      <div class="field check"><label>Enabled</label><input type="checkbox" id="enabled" ${l.enabled ? 'checked' : ''}></div>
      <details open><summary>Influence mask</summary>
        <div class="field"><label>Mask</label><select id="maskType">${maskOpts}</select></div>
        ${l.mask && l.mask.type ? `<div class="field check"><label>Invert</label><input type="checkbox" id="maskInvert" ${l.mask.invert ? 'checked' : ''}></div>` : ''}
        ${maskParams}
        ${l.mask && l.mask.type === 'painted' ? `<div class="paint-row"><button id="paintToggle" class="${state.paint ? 'on' : ''}">${state.paint ? 'Stop painting' : 'Paint mask'}</button><button id="paintClear">Clear</button><span class="muted">Brush: switch to 2D view, drag on the canvas.</span></div>` : ''}
      </details>
      <details open><summary>Parameters</summary>${layerParams || '<p class="muted">No parameters.</p>'}
        <button id="resetParams">Reset to defaults</button>
      </details>`;
  }

  $('#inspector').addEventListener('input', onInspectorChange);
  $('#inspector').addEventListener('change', onInspectorChange);
  function onInspectorChange(ev) {
    const l = selected();
    if (!l) return;
    const t = ev.target;
    if (t.id === 'layerName') { l.name = t.value; renderStack(); return; }
    if (t.id === 'opacity') { l.opacity = Number(t.value); t.nextElementSibling.textContent = l.opacity.toFixed(2); schedule(); return; }
    if (t.id === 'blend') { l.blend = t.value; schedule(0); return; }
    if (t.id === 'enabled') { l.enabled = t.checked; afterEdit(); return; }
    if (t.id === 'maskType') {
      if (!t.value) l.mask = null;
      else {
        const md = maskDefByKey[`mask_${t.value}`];
        l.mask = { type: t.value, invert: false, params: { ...md.defaults } };
      }
      afterEdit();
      return;
    }
    if (t.id === 'maskInvert') { l.mask.invert = t.checked; schedule(0); return; }
    if (t.id === 'resetParams') return;
    if (!t.dataset.k) return;
    const def = byId.get(l.type);
    const scope = t.dataset.scope;
    const pdef = scope === 'layer'
      ? def.params.find((p) => p.k === t.dataset.k)
      : maskDefByKey[`mask_${l.mask.type}`].params.find((p) => p.k === t.dataset.k);
    let v;
    if (pdef.t === 'bool') v = t.checked;
    else if (pdef.t === 'color' || pdef.t === 'sel') v = t.value;
    else v = pdef.t === 'int' ? Math.round(Number(t.value)) : Number(t.value);
    const bag = scope === 'layer' ? l.params : (l.mask.params ||= {});
    bag[t.dataset.k] = v;
    // Keep the range and number inputs in step.
    const pair = t.closest('.field')?.querySelectorAll('[data-k]');
    if (pair) pair.forEach((el) => { if (el !== t && el.dataset.kind) el.value = v; });
    if (pdef.t === 'sel' || pdef.t === 'bool') afterEdit(); else schedule();
  }

  $('#inspector').addEventListener('click', (ev) => {
    const l = selected();
    if (!l) return;
    if (ev.target.id === 'resetParams') {
      l.params = { ...byId.get(l.type).defaults };
      afterEdit();
    }
    if (ev.target.id === 'paintToggle') {
      state.paint = !state.paint;
      if (state.paint) {
        const N = state.doc.config.resolution;
        if (!l.mask.paint) l.mask.paint = new Uint8Array(N * N);
        state.view = '2d';
        setView('2d');
      }
      renderInspector();
      renderViews();
    }
    if (ev.target.id === 'paintClear' && l.mask) {
      l.mask.paint = new Uint8Array(state.doc.config.resolution ** 2);
      schedule(0);
    }
  });

  // Brush painting on the 2-D view: writes into the selected layer's painted mask (N×N, 0-255).
  let lastPaint = null;
  function paintStroke(nx, ny, phase) {
    if (phase === 'end') { lastPaint = null; schedule(0); return; }
    const l = selected();
    if (!state.paint || !l || !l.mask || l.mask.type !== 'painted' || !state.result) return;
    if (phase === 'start') lastPaint = null;
    const N = state.doc.config.resolution;
    const paint = l.mask.paint || (l.mask.paint = new Uint8Array(N * N));
    const { radius, strength, erase } = state.brush;
    const r = radius * N;
    const cx = Math.floor(nx * N), cy = Math.floor(ny * N);
    const from = lastPaint ?? [cx, cy];
    const steps = Math.max(1, Math.hypot(cx - from[0], cy - from[1]) | 0);
    for (let s = 0; s <= steps; s++) {
      const px = from[0] + ((cx - from[0]) * s) / steps, py = from[1] + ((cy - from[1]) * s) / steps;
      for (let y = Math.max(0, Math.floor(py - r)); y <= Math.min(N - 1, Math.ceil(py + r)); y++) {
        for (let x = Math.max(0, Math.floor(px - r)); x <= Math.min(N - 1, Math.ceil(px + r)); x++) {
          const d = Math.hypot(x - px, y - py) / r;
          if (d > 1) continue;
          const f = (1 - d * d) * strength;
          const i = y * N + x;
          const v = paint[i] / 255;
          paint[i] = Math.round(255 * Math.max(0, Math.min(1, erase ? v - f * 0.3 : v + f * 0.3)) );
        }
      }
    }
    lastPaint = [cx, cy];
    // Live feedback: debounced re-evaluation while the stroke continues.
    schedule(60);
  }

  // ---- Top bar and views -----------------------------------------------------------------------------------
  function setView(v) {
    state.view = v;
    document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
    renderViews();
  }
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

  $('#viewMode').addEventListener('change', (ev) => { state.viewMode = ev.target.value; $('#mapSel').hidden = state.viewMode !== 'map'; renderViews(); });
  $('#mapSel').addEventListener('change', (ev) => { state.mapName = ev.target.value; renderViews(); });
  $('#voxelToggle').addEventListener('change', (ev) => { state.voxel = ev.target.checked; renderViews(); });
  $('#exag').addEventListener('input', () => { if (state.view === '3d' && state.result) renderViews(); });

  $('#presetSel').addEventListener('change', (ev) => {
    state.doc = createPreset(ev.target.value, state.doc.config.resolution);
    state.selectedId = state.doc.layers[state.doc.layers.length - 1]?.id ?? null;
    state.mapName = null;
    afterEdit();
  });
  $('#resSel').addEventListener('change', (ev) => {
    state.doc.config.resolution = Number(ev.target.value);
    schedule(0);
  });
  $('#seedInp').addEventListener('change', (ev) => {
    state.doc.config.seed = Number(ev.target.value) || 1;
    schedule(0);
  });
  $('#newBtn').addEventListener('click', () => {
    state.doc = createBlank(state.doc.config.resolution);
    state.selectedId = state.doc.layers[0].id;
    afterEdit();
  });

  // Project save/load.
  $('#saveBtn').addEventListener('click', () => download(new Blob([serializeDocument(state.doc)], { type: 'application/json' }), 'terrain-stack.json'));
  $('#openInp').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try {
      const data = deserializeDocument(await file.text());
      state.doc = { config: data.config, layers: data.layers, previewLayerId: data.previewLayerId };
      state.selectedId = state.doc.layers[state.doc.layers.length - 1]?.id ?? null;
      afterEdit();
    } catch (err) { $('#status').textContent = `Open failed: ${err.message}`; }
    ev.target.value = '';
  });

  // Export: 16-bit little-endian raw heightmap (.r16) and a PNG of the current view.
  $('#exportR16').addEventListener('click', () => {
    const r = state.result;
    if (!r) return;
    const buf = new Uint16Array(r.N * r.N);
    for (let i = 0; i < buf.length; i++) buf[i] = Math.round(Math.max(0, Math.min(1, r.H[i])) * 65535);
    download(new Blob([buf.buffer], { type: 'application/octet-stream' }), `heightmap-${r.N}.r16`);
  });
  $('#exportPng').addEventListener('click', () => {
    const c = $('#view2d');
    if (state.view !== '2d') setView('2d');
    renderViews();
    c.toBlob((b) => b && download(b, 'terrain-view.png'), 'image/png');
  });

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // Initial state.
  $('#resSel').value = String(state.doc.config.resolution);
  $('#seedInp').value = String(state.doc.config.seed);
  renderStack();
  setView('3d');
  schedule(0);

  // Keep the 2-D canvas sized when the window changes.
  window.addEventListener('resize', () => renderViews());
  return state;
}
