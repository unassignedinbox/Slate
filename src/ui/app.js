// Slate — app shell: layer stack panel · viewport · inspector.
import {
  LAYERS, LAYER_MAP, CATS, CAT_MAP, BLENDS, MASKS,
  defaultParams, makeLayer, makeMaskParams, coverageReport,
} from '../engine/registry.js';
import { evaluate } from '../engine/stack.js';
import { Viewport, exportPNG, exportOBJ, exportRAW } from './viewport.js';

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const LS_KEY = 'slate-stack-v1';

const state = {
  project: 'untitled-terrain',
  layers: [],
  selected: null,
  res: 256,
  auto: true,
  ctx: null,
  evalMs: 0,
  rebuilding: false,
  paintStores: new Map(), // uid -> Float32Array(res²)
  fileData: new Map(),    // uid -> Float32Array(res² @loadedRes) + meta
  abort: null,
  paintOn: false,
};

function defaultStack() {
  const mk = (type, params = {}, extra = {}) => {
    const l = makeLayer(type);
    Object.assign(l.params, params);
    Object.assign(l, extra);
    return l;
  };
  return [
    mk('fbm', { freq: 3, oct: 5, lac: 2, gain: 0.5, seed: 7 }, { name: 'Continent base' }),
    mk('mountain', { x: 0.5, y: 0.42, radius: 0.4, height: 0.85, rugged: 0.6, snow: 0, freq: 9, seed: 7 }, { name: 'Central peak', blend: 'max', opacity: 0.8 }),
    mk('thermal', { talus: 0.03, iters: 10, rate: 0.5 }, { name: 'Scree slopes' }),
    mk('hydro-stream', { count: 70, depth: 0.018, width: 1.2, length: 220, seed: 21 }, { name: 'Stream carve' }),
    mk('lake', { count: 2, size: 20, depth: 0.1, level: 0.3, round: 0.75, seed: 55 }, { name: 'Lakes' }),
    mk('splat', {}, { name: 'Ground cover' }),
    mk('scatter', { kind: 0, count: 2200, hLo: 0.3, hHi: 0.68, slopeMax: 34, moistMin: 0.1, sizeMin: 0.7, sizeMax: 1.6, seed: 91 }, { name: 'Forest' }),
  ];
}

// ---------------- shell ----------------
let vp, els = {};
function buildShell(root) {
  root.innerHTML = `
  <div class="app">
    <header class="topbar">
      <div class="brand"><span class="brand-glyph">▦</span><span>slate<em>terrain stack</em></span></div>
      <input class="project-name" value="${esc(state.project)}" spellcheck="false" title="Project name">
      <span class="cov" title="Layer types · blend modes · masks"></span>
      <div class="topbar-sp"></div>
      <label class="res-label">Res
        <select class="res-sel">
          <option value="128">128</option>
          <option value="256" selected>256</option>
          <option value="512">512</option>
        </select>
      </label>
      <label class="auto-label"><span>Auto</span><button class="toggle on" data-auto><span></span></button></label>
      <button class="btn ghost" data-act="save" title="Save project JSON">Save</button>
      <button class="btn ghost" data-act="load" title="Load project JSON">Load</button>
      <div class="menu-wrap">
        <button class="btn ghost" data-act="export-menu">Export ▾</button>
        <div class="menu hidden">
          <button data-exp="height">Heightmap PNG</button>
          <button data-exp="albedo">Albedo PNG</button>
          <button data-exp="normal">Normal map PNG</button>
          <button data-exp="obj">Mesh OBJ</button>
          <button data-exp="raw">Height RAW (f32)</button>
        </div>
      </div>
      <button class="btn primary" data-act="rebuild" title="Rebuild (Ctrl+Enter)">▶ Rebuild</button>
    </header>
    <main class="shell">
      <aside class="layers">
        <div class="panel-head">
          <h2>Layer stack <span class="count"></span></h2>
          <span class="order-note">top = foreground</span>
        </div>
        <div class="layer-list"></div>
        <div class="layer-foot">
          <button class="btn primary wide" data-act="add">+ Add layer</button>
          <div class="row-btns">
            <button class="icon-btn" data-act="dup" title="Duplicate">⧉</button>
            <button class="icon-btn" data-act="up" title="Move up">▲</button>
            <button class="icon-btn" data-act="down" title="Move down">▼</button>
            <button class="icon-btn danger" data-act="del" title="Delete">✕</button>
          </div>
        </div>
      </aside>
      <section class="center">
        <div class="vp-toolbar">
          <div class="tabs">
            <button data-view="3d" class="on">3D</button>
            <button data-view="maps">Maps</button>
            <button data-view="voxel">Voxel</button>
            <button data-view="compare">Compare</button>
          </div>
          <select class="map-sel hidden" title="Map buffer">
            <option value="height">Height</option><option value="color">Color</option>
            <option value="flow">Flow</option><option value="slope">Slope</option>
            <option value="ao">AO</option><option value="moist">Moisture</option>
            <option value="normal">Normal</option>
          </select>
          <select class="shade-sel" title="3D shading">
            <option value="textured">Textured</option><option value="clay">Clay</option>
            <option value="height">Height</option><option value="wireframe">Wireframe</option>
          </select>
          <label class="vp-tog" title="Water"><input type="checkbox" data-tog="water" checked> Water</label>
          <label class="vp-tog" title="Scatter"><input type="checkbox" data-tog="scatter" checked> Scatter</label>
          <label class="vp-tog" title="Wireframe"><input type="checkbox" data-tog="wire"> Wire</label>
          <label class="ex-label" title="Height exaggeration">Ex <input type="range" class="ex-range" min="2" max="60" step="1" value="18"></label>
          <div class="progress-wrap"><span class="progress-phase"></span><div class="progress-track"><i></i></div></div>
        </div>
        <div class="vp-host"></div>
        <div class="statusbar"><span class="st"></span><span class="hint">Ctrl+Enter rebuild · drag rows to reorder</span></div>
      </section>
      <aside class="inspector"><div class="inspector-content"></div></aside>
    </main>
    <div class="palette hidden"><div class="palette-box">
      <div class="palette-head"><input class="palette-search" placeholder="Search 190 layer types…  (e.g. river, voronoi, strata)"><button class="icon-btn" data-act="palette-close">✕</button></div>
      <div class="palette-note"></div>
      <div class="palette-list"></div>
    </div></div>
    <div class="toasts"></div>
    <input type="file" class="hidden-file" accept=".json" hidden>
    <input type="file" class="hidden-img" accept=".png,.jpg,.jpeg,.raw" hidden>
  </div>`;
  els = {
    cov: $('.cov', root), project: $('.project-name', root), res: $('.res-sel', root),
    list: $('.layer-list', root), count: $('.layers .count', root),
    inspector: $('.inspector-content', root), phase: $('.progress-phase', root),
    bar: $('.progress-track i', root), status: $('.statusbar .st', root),
    palette: $('.palette', root), palSearch: $('.palette-search', root), palList: $('.palette-list', root),
    palNote: $('.palette-note', root), toasts: $('.toasts', root),
    menu: $('.menu', root), fileJson: $('.hidden-file', root), fileImg: $('.hidden-img', root),
    mapSel: $('.map-sel', root), shadeSel: $('.shade-sel', root),
  };
  vp = new Viewport($('.vp-host', root), {
    onPaintStroke: () => scheduleRebuild(),
    onPaintDone: () => setPaintMode(false),
  });
}

// ---------------- toasts / progress ----------------
function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  els.toasts.appendChild(t);
  setTimeout(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 350); }, ms);
}
function progress(done, total, label) {
  els.bar.style.width = `${(done / Math.max(1, total)) * 100}%`;
  els.phase.textContent = done >= total ? `${total} layers · ${(state.evalMs / 1000).toFixed(2)}s` : `${done + 1}/${total} · ${label}`;
}

// ---------------- rebuild ----------------
let rebuildTimer = null;
function scheduleRebuild() {
  if (!state.auto && state.ctx) { /* still update status */ }
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => rebuild(), state.auto ? 220 : 220);
}
async function rebuild() {
  if (state.rebuilding) {
    if (state.abort) state.abort.abort();
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => rebuild(), 120);
    return;
  }
  state.rebuilding = true;
  state.abort = new AbortController();
  const t0 = performance.now();
  try {
    const ctx = await evaluate(state.layers, state.res, {
      signal: state.abort.signal,
      onProgress: (d, t, l) => progress(d, t, l),
      dataFor: (layer) => {
        const f = state.fileData.get(layer.uid);
        if (!f) return null;
        return resampleTo(f.data, f.res, state.res);
      },
      paintFor: (layer) => {
        if (layer.mask !== 'painted') return null;
        let s = state.paintStores.get(layer.uid);
        if (!s || s.length !== state.res * state.res) {
          s = new Float32Array(state.res * state.res).fill(1);
          state.paintStores.set(layer.uid, s);
        }
        return s;
      },
    });
    state.evalMs = performance.now() - t0;
    state.ctx = ctx;
    // honor view markers from utility layers
    if (ctx.view3d) {
      setViewTab('3d');
      vp.shade3d = ['textured', 'clay', 'height', 'wireframe'][ctx.view3d.shade];
      els.shadeSel.value = vp.shade3d;
    }
    if (ctx.previewSolo && !state.paintOn) {
      const m = { height: 'height', color: 'color', flow: 'flow', slope: 'slope', ao: 'ao', moisture: 'moist' }[ctx.previewSolo.buffer];
      if (m) { setViewTab('maps'); els.mapSel.value = m; vp.showMaps(m); }
    }
    if (ctx.compare && !state.paintOn) setViewTab('compare');
    vp.setData(ctx);
    updateStatus();
    // Don't clobber the inspector mid-interaction (slider drags keep focus).
    if (els.inspector.contains(document.activeElement)) updateResultInPlace();
    else renderInspector();
    autosave();
  } catch (e) {
    if (!/abort/i.test(String(e.message))) toast(`Rebuild failed: ${e.message}`);
  } finally {
    state.rebuilding = false;
    progress(state.layers.length, state.layers.length, 'done');
  }
}
function resampleTo(src, srcRes, dstRes) {
  if (srcRes === dstRes) return src;
  const out = new Float32Array(dstRes * dstRes);
  for (let y = 0; y < dstRes; y++) for (let x = 0; x < dstRes; x++) {
    const sx = Math.min(srcRes - 1, Math.round((x / (dstRes - 1)) * (srcRes - 1)));
    const sy = Math.min(srcRes - 1, Math.round((y / (dstRes - 1)) * (srcRes - 1)));
    out[y * dstRes + x] = src[sy * srcRes + sx];
  }
  return out;
}
function updateStatus() {
  const c = state.ctx;
  if (!c) return;
  const n = c.n, tris = ((n - 1) * (n - 1) * 2 / 1000).toFixed(0);
  els.status.textContent =
    `${n}² · ${state.layers.length} layers · ${(state.evalMs / 1000).toFixed(2)}s · ${tris}k tris · water ${c.waterLevel.toFixed(3)} · scatter ${c.scatter.length}`;
}

// ---------------- layer panel ----------------
function selectedLayer() {
  return state.layers.find((l) => l.uid === state.selected) || null;
}
function renderLayers() {
  els.count.textContent = String(state.layers.length).padStart(2, '0');
  // display order: top row = last applied (foreground)
  const order = [...state.layers].reverse();
  els.list.innerHTML = order.map((l) => {
    const def = LAYER_MAP[l.type];
    const cat = CAT_MAP[def.cat];
    const sel = l.uid === state.selected ? 'sel' : '';
    const vis = l.visible === false ? 'off' : '';
    const maskBadge = l.mask && l.mask !== 'none' ? `<span class="mask-dot" title="Mask: ${esc(l.mask)}">◐</span>` : '';
    return `<div class="lrow ${sel}" draggable="true" data-uid="${l.uid}">
      <button class="eye ${vis}" data-eye title="Visibility">${l.visible === false ? '◌' : '●'}</button>
      <span class="cat-bar" style="--c:${cat.color}"></span>
      <span class="lnum">#${def.n}</span>
      <span class="lname"><b>${esc(l.name)}</b><small>${esc(def.name)} · ${esc(l.blend)} · ${Math.round(l.opacity * 100)}%</small></span>
      ${maskBadge}
    </div>`;
  }).join('') || `<div class="empty">Empty stack — add a generator.<br>The heightmap starts flat.</div>`;
  els.list.querySelectorAll('.lrow').forEach((row) => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-eye]')) return;
      selectLayer(row.dataset.uid);
    });
    row.querySelector('[data-eye]').addEventListener('click', () => {
      const l = state.layers.find((x) => x.uid === row.dataset.uid);
      l.visible = l.visible === false ? true : false;
      renderLayers();
      scheduleRebuild();
    });
    row.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/uid', row.dataset.uid));
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('drop'); });
    row.addEventListener('dragleave', () => row.classList.remove('drop'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('drop');
      reorderRows(e.dataTransfer.getData('text/uid'), row.dataset.uid);
    });
  });
}
function reorderRows(fromUid, toUid) {
  if (fromUid === toUid) return;
  // operate in display order (reversed), then flip back
  const disp = [...state.layers].reverse();
  const fi = disp.findIndex((l) => l.uid === fromUid);
  const ti = disp.findIndex((l) => l.uid === toUid);
  const [m] = disp.splice(fi, 1);
  disp.splice(ti, 0, m);
  state.layers = disp.reverse();
  renderLayers();
  scheduleRebuild();
}
function selectLayer(uid) {
  state.selected = uid;
  renderLayers();
  renderInspector();
}
function moveSelected(dir) { // dir +1 = up in display = toward array end
  const i = state.layers.findIndex((l) => l.uid === state.selected);
  if (i < 0) return;
  const j = i + dir;
  if (j < 0 || j >= state.layers.length) return;
  const [m] = state.layers.splice(i, 1);
  state.layers.splice(j, 0, m);
  renderLayers();
  scheduleRebuild();
}

// ---------------- inspector ----------------
function fmtVal(v, step) {
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return Number(v).toLocaleString('en-US', { maximumFractionDigits: digits });
}
function controlHTML(p, val) {
  if (p.type === 'color') {
    return `<div class="control-line color-line"><span>${esc(p.label)}${p.hint ? `<small> · ${esc(p.hint)}</small>` : ''}</span>
      <label class="color-chip" style="--chip:${esc(val)}"><input type="color" data-pk="${p.k}" value="${esc(val)}"><code>${esc(val)}</code></label></div>`;
  }
  if (p.unit === 'enum') {
    const opts = p.hint.split('|');
    return `<div class="control"><div class="control-line"><span>${esc(p.label)}</span></div>
      <div class="pill-row">${opts.map((o, i) => `<button class="pill ${+val === i ? '' : 'off'}" data-enum="${p.k}" data-i="${i}">${esc(o)}</button>`).join('')}</div></div>`;
  }
  const isToggle = p.min === 0 && p.max === 1 && p.step === 1;
  if (isToggle) {
    return `<div class="control-line toggle-line"><span>${esc(p.label)}${p.hint ? `<small> · ${esc(p.hint)}</small>` : ''}</span>
      <button class="toggle ${+val ? 'on' : ''}" data-toggle="${p.k}"><span></span></button></div>`;
  }
  const pct = ((val - p.min) / (p.max - p.min)) * 100;
  return `<div class="control"><div class="control-line"><span>${esc(p.label)}</span>
    <span class="control-value" data-pval="${p.k}">${fmtVal(val, p.step)}<small>${esc(p.unit || '')}</small></span></div>
    <input type="range" data-prange="${p.k}" min="${p.min}" max="${p.max}" step="${p.step}" value="${val}" style="--progress:${pct}%" aria-label="${esc(p.label)}">
    ${p.hint ? `<p class="muted">${esc(p.hint)}</p>` : ''}</div>`;
}
function renderInspector() {
  const l = selectedLayer();
  if (!l) {
    els.inspector.innerHTML = `<div class="object-header"><div class="object-title"><div><div class="eyebrow">STACK</div><h1>No layer selected</h1></div></div></div>
      <p class="muted">Pick a row in the layer stack, or add a generator to begin.</p>`;
    return;
  }
  const def = LAYER_MAP[l.type];
  const cat = CAT_MAP[def.cat];
  const isInput = l.type === 'input' || l.type === 'file-import';
  const fileState = state.fileData.get(l.uid);
  const result = l._result;
  els.inspector.innerHTML = `
    <div class="object-header">
      <div class="object-title"><div class="object-icon" style="--accent:${cat.color}">#${def.n}</div>
        <div><div class="eyebrow">${esc(cat.name)} · ${esc(def.cat === 'color' || def.cat === 'vegetation' ? 'surface' : 'height')}</div>
        <h1>${esc(def.name)}</h1></div></div>
      <div class="object-actions"><button class="toggle ${l.visible !== false ? 'on' : ''}" data-vis><span></span></button></div>
    </div>
    <div class="section-label"><span>LAYER</span><span>#${def.n} / 240</span></div>
    <section class="card"><div class="card-body">
      <div class="control"><div class="control-line"><span>Name</span></div>
        <input type="text" class="text-in" data-name value="${esc(l.name)}"></div>
      <p class="muted">${esc(def.desc)}</p>
      <div class="control"><div class="control-line"><span>Opacity</span>
        <span class="control-value" data-pval="__op">${Math.round(l.opacity * 100)}<small>%</small></span></div>
        <input type="range" data-opacity min="0" max="1" step="0.01" value="${l.opacity}" style="--progress:${l.opacity * 100}%"></div>
      <div class="control"><div class="control-line"><span>Blend mode</span></div>
        <select data-blend>${BLENDS.map((b) => `<option value="${b.id}" ${l.blend === b.id ? 'selected' : ''}>#${b.n} · ${esc(b.name)}</option>`).join('')}</select>
        <p class="muted">${esc((BLENDS.find((b) => b.id === l.blend) || {}).desc || '')}</p></div>
      ${isInput ? `<div class="control"><div class="control-line"><span>Source file</span></div>
        <button class="btn ghost wide" data-loadfile>${fileState ? `↻ Replace (${fileState.res}² loaded)` : 'Load heightmap file…'}</button>
        <p class="muted">PNG/JPG (luma) or RAW float32, resampled to stack resolution.</p></div>` : ''}
    </div></section>
    <div class="section-label"><span>PARAMETERS</span><span>${def.params.length} controls</span></div>
    <section class="card"><div class="card-body">
      ${def.params.map((p) => controlHTML(p, l.params[p.k])).join('') || '<p class="muted">No parameters.</p>'}
    </div></section>
    <div class="section-label"><span>MASK</span><span>${l.mask === 'none' ? 'off' : esc(l.mask)}</span></div>
    <section class="card"><div class="card-body">
      <div class="control"><div class="control-line"><span>Mask type</span></div>
        <select data-mask><option value="none">None (full effect)</option>
        ${MASKS.map((m) => `<option value="${m.id}" ${l.mask === m.id ? 'selected' : ''}>#${m.n} · ${esc(m.name)}</option>`).join('')}</select></div>
      <div class="mask-params">${l.mask !== 'none' && MASKS.find((m) => m.id === l.mask)
        ? MASKS.find((m) => m.id === l.mask).params.map((p) => controlHTML(p, l.maskParams[p.k] ?? p.def)).join('')
        : '<p class="muted">Gaea-style grayscale influence: slope, height, flow, painted…</p>'}</div>
      ${l.mask === 'painted' ? `<button class="btn ${state.paintOn ? 'primary' : 'ghost'} wide" data-paint>${state.paintOn ? '■ Stop painting' : '✎ Paint mask in viewport'}</button>` : ''}
    </div></section>
    ${result ? `<div class="section-label"><span>RESULT</span></div>
    <section class="card"><div class="card-body result-body">${resultHTML(result)}</div></section>` : ''}
    <div class="section-label"><span>STACK</span></div>
    <section class="card"><div class="card-body">
      <div class="kv"><span>Layers</span><b>${state.layers.length}</b></div>
      <div class="kv"><span>Resolution</span><b>${state.res}²</b></div>
      <div class="kv"><span>Water level</span><b>${state.ctx ? state.ctx.waterLevel.toFixed(3) : '—'}</b></div>
      <div class="kv"><span>Last build</span><b>${(state.evalMs / 1000).toFixed(2)}s</b></div>
    </div></section>
    <footer class="inspector-footer"><span><span class="footer-dot"></span>Bottom applies first · top is foreground</span></footer>`;
  wireInspector(l, def);
}
function resultHTML(r) {
  if (r.error) return `<p class="err">${esc(r.error)}</p>`;
  let html = '';
  for (const [k, v] of Object.entries(r)) {
    if (k === 'histogram' && Array.isArray(v)) {
      const mx = Math.max(...v, 1);
      html += `<div class="hist">${v.map((c) => `<i style="height:${Math.max(2, (c / mx) * 44)}px"></i>`).join('')}</div>`;
    } else if (Array.isArray(v)) {
      html += `<div class="kv"><span>${esc(k)}</span><b>${v.map((x) => typeof x === 'number' ? x.toFixed(3) : esc(x)).join(' · ')}</b></div>`;
    } else {
      html += `<div class="kv"><span>${esc(k)}</span><b>${esc(v)}</b></div>`;
    }
  }
  return html;
}
function wireInspector(l, def) {
  const root = els.inspector;
  $('[data-vis]', root).addEventListener('click', (e) => {
    l.visible = l.visible === false ? true : false;
    e.currentTarget.classList.toggle('on', l.visible !== false);
    renderLayers(); scheduleRebuild();
  });
  $('[data-name]', root).addEventListener('input', (e) => { l.name = e.target.value; renderLayers(); });
  const op = $('[data-opacity]', root);
  op.addEventListener('input', () => {
    l.opacity = +op.value;
    op.style.setProperty('--progress', `${l.opacity * 100}%`);
    $('[data-pval="__op"]', root).innerHTML = `${Math.round(l.opacity * 100)}<small>%</small>`;
    renderLayers(); scheduleRebuild();
  });
  $('[data-blend]', root).addEventListener('change', (e) => { l.blend = e.target.value; renderLayers(); renderInspector(); scheduleRebuild(); });
  $('[data-mask]', root).addEventListener('change', (e) => {
    l.mask = e.target.value;
    l.maskParams = l.mask === 'none' ? {} : { ...makeMaskParams(l.mask), ...l.maskParams };
    if (l.mask !== 'painted' && state.paintOn) setPaintMode(false);
    renderLayers(); renderInspector(); scheduleRebuild();
  });
  const paintBtn = $('[data-paint]', root);
  if (paintBtn) paintBtn.addEventListener('click', () => setPaintMode(!state.paintOn));
  const loadBtn = $('[data-loadfile]', root);
  if (loadBtn) loadBtn.addEventListener('click', () => { els.fileImg.click(); });
  // param controls (layer params)
  root.querySelectorAll('[data-prange]').forEach((input) => {
    const inMask = !!input.closest('.mask-params');
    input.addEventListener('input', () => {
      const key = input.dataset.prange;
      const all = inMask ? MASKS.find((m) => m.id === l.mask).params : def.params;
      const p = all.find((x) => x.k === key);
      const val = +input.value;
      if (inMask) l.maskParams[key] = val; else l.params[key] = val;
      input.style.setProperty('--progress', `${((val - p.min) / (p.max - p.min)) * 100}%`);
      const out = root.querySelector(`[data-pval="${key}"]`);
      if (out) out.innerHTML = `${fmtVal(val, p.step)}<small>${esc(p.unit || '')}</small>`;
      scheduleRebuild();
    });
  });
  root.querySelectorAll('[data-toggle]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.toggle;
    const inMask = !!btn.closest('.mask-params');
    const store = inMask ? l.maskParams : l.params;
    store[key] = store[key] ? 0 : 1;
    btn.classList.toggle('on', !!store[key]);
    scheduleRebuild();
  }));
  root.querySelectorAll('[data-enum]').forEach((btn) => btn.addEventListener('click', () => {
    const key = btn.dataset.enum;
    const inMask = !!btn.closest('.mask-params');
    (inMask ? l.maskParams : l.params)[key] = +btn.dataset.i;
    btn.parentElement.querySelectorAll('.pill').forEach((x) => x.classList.toggle('off', x !== btn));
    scheduleRebuild();
  }));
  root.querySelectorAll('input[type=color]').forEach((input) => input.addEventListener('input', () => {
    const key = input.dataset.pk;
    const inMask = !!input.closest('.mask-params');
    (inMask ? l.maskParams : l.params)[key] = input.value;
    input.parentElement.style.setProperty('--chip', input.value);
    input.parentElement.querySelector('code').textContent = input.value;
    scheduleRebuild();
  }));
}

// ---------------- paint mode ----------------
function setPaintMode(on) {
  const l = selectedLayer();
  if (on && (!l || l.mask !== 'painted')) {
    toast('Select the Custom Painted mask first');
    return;
  }
  state.paintOn = on;
  if (on) {
    let s = state.paintStores.get(l.uid);
    if (!s || s.length !== state.res * state.res) {
      s = new Float32Array(state.res * state.res).fill(1);
      state.paintStores.set(l.uid, s);
    }
    setViewTab('maps');
    els.mapSel.value = 'height';
    vp.setPaint(s, state.res);
    toast('Painting mask — red = masked area');
  } else {
    vp.setPaint(null);
  }
  renderInspector();
}

// ---------------- palette ----------------
function openPalette() {
  els.palette.classList.remove('hidden');
  els.palSearch.value = '';
  renderPalette('');
  setTimeout(() => els.palSearch.focus(), 30);
}
function closePalette() { els.palette.classList.add('hidden'); }
function renderPalette(q) {
  q = q.trim().toLowerCase();
  els.palNote.textContent = '190 layer types · 24 blend modes (on every layer) · 26 mask types (on every layer)';
  els.palList.innerHTML = CATS.map((cat) => {
    const items = LAYERS.filter((l) => l.cat === cat.id &&
      (!q || l.name.toLowerCase().includes(q) || l.id.includes(q) || String(l.n) === q || (l.desc || '').toLowerCase().includes(q)));
    if (!items.length) return '';
    return `<div class="pal-group"><div class="pal-ghead" style="--c:${cat.color}">${esc(cat.name)} <span>${cat.range}</span></div>
      ${items.map((l) => `<button class="pal-item" data-add="${l.id}">
        <span class="pal-num">#${l.n}</span>
        <span class="pal-name">${esc(l.name)}<small>${esc(l.desc || '')}</small></span>
      </button>`).join('')}</div>`;
  }).join('') || `<p class="muted" style="padding:16px">No matches.</p>`;
  els.palList.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    addLayer(b.dataset.add);
    closePalette();
  }));
}
function addLayer(typeId) {
  const l = makeLayer(typeId);
  if (state.paintOn) setPaintMode(false);
  state.layers.push(l); // top = foreground = applied last
  state.selected = l.uid;
  renderLayers();
  renderInspector();
  scheduleRebuild();
}

// ---------------- view tabs ----------------
function setViewTab(v) {
  document.querySelectorAll('.tabs [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === v));
  els.mapSel.classList.toggle('hidden', v !== 'maps');
  els.shadeSel.classList.toggle('hidden', v !== '3d');
  if (v === 'maps') vp.showMaps(els.mapSel.value);
  else vp.setView(v);
}

// ---------------- project I/O ----------------
function serialize() {
  const paints = {};
  for (const [uid, store] of state.paintStores) {
    if (store.length !== state.res * state.res) continue;
    const q = new Uint8Array(store.length);
    for (let i = 0; i < store.length; i++) q[i] = Math.round(Math.min(1, Math.max(0, store[i])) * 255);
    let bin = '';
    for (let i = 0; i < q.length; i++) bin += String.fromCharCode(q[i]);
    paints[uid] = { res: state.res, b64: btoa(bin) };
  }
  return {
    app: 'slate-terrain-stack', v: 1, project: state.project, res: state.res,
    layers: state.layers.map(({ _result, ...l }) => l),
    paints,
  };
}
function deserialize(json) {
  if (json.app !== 'slate-terrain-stack') throw new Error('not a Slate project');
  state.project = json.project || 'untitled-terrain';
  state.res = [128, 256, 512].includes(json.res) ? json.res : 256;
  state.layers = (json.layers || []).filter((l) => LAYER_MAP[l.type]).map((l) => ({ ...makeLayer(l.type), ...l }));
  state.paintStores.clear();
  for (const [uid, p] of Object.entries(json.paints || {})) {
    const bin = atob(p.b64);
    const store = new Float32Array(bin.length);
    for (let i = 0; i < bin.length; i++) store[i] = bin.charCodeAt(i) / 255;
    state.paintStores.set(uid, resampleTo(store, p.res, state.res));
  }
  state.fileData.clear();
  state.selected = state.layers.length ? state.layers[state.layers.length - 1].uid : null;
}
function autosave() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(serialize())); } catch { /* quota */ }
}
function autoload() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) { deserialize(JSON.parse(raw)); return true; }
  } catch { /* ignore */ }
  return false;
}
function downloadJSON() {
  const blob = new Blob([JSON.stringify(serialize())], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.project}.slate.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
function loadImageFile(file, layer) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'raw') {
    const rd = new FileReader();
    rd.onload = () => {
      const buf = rd.result;
      const f32 = new Float32Array(buf);
      const side = Math.sqrt(f32.length);
      if (!Number.isInteger(side)) { toast('RAW must be square float32'); return; }
      state.fileData.set(layer.uid, { data: Float32Array.from(f32), res: side });
      toast(`Loaded RAW ${side}²`);
      renderInspector(); scheduleRebuild();
    };
    rd.readAsArrayBuffer(file);
    return;
  }
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = state.res; cv.height = state.res;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, state.res, state.res);
    const d = g.getImageData(0, 0, state.res, state.res).data;
    const out = new Float32Array(state.res * state.res);
    for (let i = 0; i < out.length; i++)
      out[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255;
    state.fileData.set(layer.uid, { data: out, res: state.res });
    URL.revokeObjectURL(img.src);
    toast(`Loaded ${file.name}`);
    renderInspector(); scheduleRebuild();
  };
  img.onerror = () => toast('Could not read image');
  img.src = URL.createObjectURL(file);
}

// ---------------- events ----------------
function wireEvents() {
  const cov = coverageReport();
  els.cov.textContent = `${cov.layers} layers · ${cov.blends} blends · ${cov.masks} masks`;
  els.project.value = state.project;
  els.project.addEventListener('input', (e) => { state.project = e.target.value || 'untitled-terrain'; });
  els.res.value = String(state.res);
  els.res.addEventListener('change', () => {
    const old = state.res;
    state.res = +els.res.value;
    // resample paint stores
    for (const [uid, s] of state.paintStores) state.paintStores.set(uid, resampleTo(s, old, state.res));
    if (state.paintOn) setPaintMode(false);
    scheduleRebuild();
  });
  document.querySelector('[data-auto]').addEventListener('click', (e) => {
    state.auto = !state.auto;
    e.currentTarget.classList.toggle('on', state.auto);
  });
  document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'rebuild') rebuild();
    else if (a === 'add') openPalette();
    else if (a === 'palette-close') closePalette();
    else if (a === 'del') {
      const i = state.layers.findIndex((l) => l.uid === state.selected);
      if (i < 0) return;
      if (state.paintOn) setPaintMode(false);
      state.paintStores.delete(state.selected);
      state.fileData.delete(state.selected);
      state.layers.splice(i, 1);
      state.selected = state.layers.length ? state.layers[Math.min(i, state.layers.length - 1)].uid : null;
      renderLayers(); renderInspector(); scheduleRebuild();
    } else if (a === 'dup') {
      const l = selectedLayer();
      if (!l) return;
      const c = JSON.parse(JSON.stringify({ ...l, _result: undefined }));
      c.uid = `L${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
      c.name = `${l.name} copy`;
      state.layers.splice(state.layers.indexOf(l) + 1, 0, c);
      const ps = state.paintStores.get(l.uid);
      if (ps) state.paintStores.set(c.uid, Float32Array.from(ps));
      state.selected = c.uid;
      renderLayers(); renderInspector(); scheduleRebuild();
    } else if (a === 'up') moveSelected(1);
    else if (a === 'down') moveSelected(-1);
    else if (a === 'save') { downloadJSON(); toast('Project saved'); }
    else if (a === 'load') els.fileJson.click();
    else if (a === 'export-menu') els.menu.classList.toggle('hidden');
  }));
  els.menu.querySelectorAll('[data-exp]').forEach((b) => b.addEventListener('click', () => {
    els.menu.classList.add('hidden');
    if (!state.ctx) return;
    const k = b.dataset.exp;
    if (k === 'obj') exportOBJ(state.ctx, state.project, vp.heightEx);
    else if (k === 'raw') exportRAW(state.ctx, state.project);
    else exportPNG(state.ctx, k, state.project);
    toast('Export started');
  }));
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.menu-wrap')) els.menu.classList.add('hidden');
  });
  els.palSearch.addEventListener('input', () => renderPalette(els.palSearch.value));
  els.palette.addEventListener('click', (e) => { if (e.target === els.palette) closePalette(); });
  document.querySelectorAll('.tabs [data-view]').forEach((b) => b.addEventListener('click', () => {
    if (state.paintOn && b.dataset.view !== 'maps') setPaintMode(false);
    setViewTab(b.dataset.view);
    updateStatus();
  }));
  els.mapSel.addEventListener('change', () => vp.showMaps(els.mapSel.value));
  els.shadeSel.addEventListener('change', () => { vp.shade3d = els.shadeSel.value; vp.refresh3D(); });
  document.querySelector('[data-tog="water"]').addEventListener('change', (e) => { vp.showWater = e.target.checked; vp.refresh3D(); });
  document.querySelector('[data-tog="scatter"]').addEventListener('change', (e) => { vp.showScatter = e.target.checked; vp.refresh3D(); });
  document.querySelector('[data-tog="wire"]').addEventListener('change', (e) => { vp.wireframe = e.target.checked; vp.refresh3D(); });
  document.querySelector('.ex-range').addEventListener('input', (e) => { vp.heightEx = +e.target.value; vp.refresh3D(); });
  els.fileJson.addEventListener('change', () => {
    const f = els.fileJson.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      try {
        if (state.paintOn) setPaintMode(false);
        deserialize(JSON.parse(rd.result));
        els.project.value = state.project;
        els.res.value = String(state.res);
        renderLayers(); renderInspector(); scheduleRebuild();
        toast(`Loaded ${state.layers.length} layers`);
      } catch (e2) { toast(`Load failed: ${e2.message}`); }
    };
    rd.readAsText(f);
    els.fileJson.value = '';
  });
  els.fileImg.addEventListener('change', () => {
    const f = els.fileImg.files[0];
    const l = selectedLayer();
    if (f && l) loadImageFile(f, l);
    els.fileImg.value = '';
  });
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); rebuild(); }
    if (e.key === 'Escape' && !els.palette.classList.contains('hidden')) closePalette();
  });
}

// ---------------- boot ----------------
export function boot() {
  buildShell(document.getElementById('root'));
  if (!autoload()) {
    state.layers = defaultStack();
    state.selected = state.layers[state.layers.length - 1].uid;
  } else {
    toast(`Restored ${state.layers.length} layers`);
  }
  els.project.value = state.project;
  els.res.value = String(state.res);
  wireEvents();
  renderLayers();
  renderInspector();
  setViewTab('3d');
  rebuild();
}
boot();
