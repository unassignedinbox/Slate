/* ============================================================================
   Chrome — menubar, toolbar, status bar and the viewport HUD layer.
   ========================================================================== */

import { h, $, $$, clear, icon, fmtInt } from './widgets.js';
import { TOOLS } from '../core/Editor.js';
import { PRESET_BY_ID } from '../model/Presets.js';

/* ============================================================== MENUBAR === */

export function createMenubar(root, editor, app) {
  const bar = h('div', { class: 'menubar' });
  bar.appendChild(h('div', { class: 'brand' },
    h('div', { class: 'brand-mark' }),
    h('div', { class: 'brand-name' }, 'SLATE', h('span', {}, ' road')),
  ));

  const menus = [
    {
      label: 'File', items: [
        { label: 'New network', kbd: '', act: () => { editor.net.clear(); editor.markAllDirty(); app.setDirty(true); } },
        { sep: true },
        { label: 'Open .slate.json…', kbd: '', act: () => app.openFile() },
        { label: 'Save .slate.json', kbd: '⌘S', act: () => app.saveFile() },
        { sep: true },
        { label: 'Export glTF / .glb', kbd: '', act: () => app.exportGLTF() },
        { label: 'Export OBJ', kbd: '', act: () => app.exportOBJ() },
        { label: 'Export CSV schedule', kbd: '', act: () => app.exportCSV() },
      ],
    },
    {
      label: 'Edit', items: [
        { label: 'Undo', kbd: '⌘Z', act: () => editor.undo(), dis: () => !editor.canUndo },
        { label: 'Redo', kbd: '⇧⌘Z', act: () => editor.redo(), dis: () => !editor.canRedo },
        { sep: true },
        { label: 'Select all', kbd: '⌘A', act: () => editor.selectAll() },
        { label: 'Deselect', kbd: 'Esc', act: () => editor.clearSelection() },
        { label: 'Invert selection', act: () => {
          const ids = [...editor.net.edges.keys()].filter((i) => !editor.selection.edges.has(i));
          editor.select(ids);
        } },
        { sep: true },
        { label: 'Delete selection', kbd: 'Del', act: () => editor.deleteSelection(), dis: () => !editor.selection.edges.size && !editor.selection.nodes.size },
        { label: 'Duplicate selection', kbd: '⌘D', act: () => app.duplicateSelection() },
      ],
    },
    {
      label: 'View', items: [
        { label: 'Perspective', kbd: 'Alt+1', act: () => app.setView('persp') },
        { label: 'Top — orthographic plan', kbd: 'Alt+2', act: () => app.setView('top') },
        { sep: true },
        { label: 'Frame selection', kbd: 'F', act: () => app.frameSelection() },
        { label: 'Frame whole city', kbd: 'Home', act: () => app.frameAll() },
        { sep: true },
        { label: 'Toggle grid', kbd: 'G', act: () => app.toggleGrid() },
        { label: 'Toggle wireframe', kbd: 'W', act: () => app.toggleWire() },
        { label: 'Toggle helpers', kbd: 'J', act: () => app.toggleHelpers() },
        { label: 'Toggle HUD', kbd: 'K', act: () => app.toggleHUD() },
      ],
    },
    {
      label: 'Create', items: [
        { label: 'Road from active preset', kbd: 'D', act: () => editor.setTool('draw') },
        { label: 'Insert junction node', kbd: 'N', act: () => editor.setTool('node') },
        { label: 'Apply preset to road', kbd: 'P', act: () => editor.setTool('paint') },
        { sep: true },
        { label: 'Force full rebuild', kbd: '⌘R', act: () => { editor.markAllDirty(); app.toast('Rebuilding world', 'ok'); } },
      ],
    },
    {
      label: 'Generate', items: [
        { label: 'Generate city…', kbd: '', act: () => app.showGenerate() },
        { label: 'Re-run with new seed', kbd: '', act: () => app.regenerate() },
        { sep: true },
        { label: 'Flatten terrain', act: () => { editor.setTerrain(0); app.toast('Terrain flattened'); } },
      ],
    },
    {
      label: 'Help', items: [
        { label: 'Viewport controls', kbd: 'H', act: () => app.toggleNavHelp() },
        { label: 'Road type reference', act: () => app.showReference() },
      ],
    },
  ];

  let open = null;
  const closeAll = () => {
    $('.menu-pop')?.remove();
    $$('.menu-item.open').forEach((e) => e.classList.remove('open'));
    open = null;
    window.removeEventListener('pointerdown', onDocDown);
  };
  function onDocDown(e) {
    if (!e.target.closest('.menu-pop') && !e.target.closest('.menu-item')) closeAll();
  }

  for (const m of menus) {
    const item = h('div', { class: 'menu-item' }, m.label);
    item.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      if (open === m) { closeAll(); return; }
      closeAll();
      open = m;
      item.classList.add('open');
      const pop = h('div', { class: 'menu-pop' });
      for (const it of m.items) {
        if (it.sep) { pop.appendChild(h('div', { class: 'menu-sep' })); continue; }
        const disabled = it.dis ? it.dis() : false;
        const row = h('div', { class: `mi${disabled ? ' disabled' : ''}` },
          h('span', {}, it.label),
          h('span', { class: 'kbd' }, it.kbd || ''),
        );
        row.addEventListener('click', () => { closeAll(); it.act(); });
        pop.appendChild(row);
      }
      const r = item.getBoundingClientRect();
      pop.style.left = `${r.left}px`;
      pop.style.top = `${r.bottom + 2}px`;
      document.body.appendChild(pop);
      window.addEventListener('pointerdown', onDocDown);
    });
    item.addEventListener('pointerenter', () => { if (open && open !== m) item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); });
    bar.appendChild(item);
  }

  bar.appendChild(h('div', { class: 'menubar-spacer' }));
  const badges = h('div', { class: 'badge-row' },
    h('span', { class: 'badge exp' }, 'experimental'),
    h('span', { class: 'badge live', id: 'badge-live' }, 'editor'),
  );
  bar.appendChild(badges);
  root.appendChild(bar);
  return { closeAll };
}

/* ============================================================== TOOLBAR === */

export function createToolbar(root, editor, app) {
  const bar = h('div', { class: 'toolbar' });

  const tb = (name, title, onClick, label) => {
    const b = h('button', { class: 'tbtn', type: 'button', title, html: `${icon(name).innerHTML}${label ? `<span class="lbl">${label}</span>` : ''}` });
    b.addEventListener('click', onClick);
    return b;
  };

  /* mode strip */
  const strip = h('div', { class: 'mode-strip' });
  const modeBtns = new Map();
  for (const t of Object.values(TOOLS)) {
    const b = h('button', {
      class: `tbtn${editor.tool === t.id ? ' active' : ''}`, type: 'button', title: t.hint,
      html: `${icon(t.id === 'draw' ? 'pen' : t.id === 'select' ? 'cursor' : t.id === 'node' ? 'nodePlus' : 'brush').innerHTML}<span class="lbl">${t.label}</span>`,
    });
    b.addEventListener('click', () => editor.setTool(t.id));
    modeBtns.set(t.id, b);
    strip.appendChild(b);
  }
  bar.appendChild(strip);
  bar.appendChild(h('div', { class: 'tb-sep' }));

  /* history */
  const undoBtn = tb('undo', 'Undo (⌘Z)', () => editor.undo());
  const redoBtn = tb('redo', 'Redo (⇧⌘Z)', () => editor.redo());
  const delBtn = tb('trash', 'Delete selection (Del)', () => editor.deleteSelection());
  const g1 = h('div', { class: 'tb-group' }, undoBtn, redoBtn, delBtn);
  bar.appendChild(g1);
  bar.appendChild(h('div', { class: 'tb-sep' }));

  /* active preset */
  const presetChip = h('button', { class: 'tbtn', type: 'button', title: 'Active road preset — click to open the library' });
  const updatePresetChip = (id) => {
    const p = PRESET_BY_ID[id];
    if (!p) return;
    const w = p.bands.reduce((s, b) => s + (b.w || 0), 0);
    presetChip.innerHTML = `${icon('road').innerHTML}<span class="lbl">${p.name}</span><span style="font:400 9.5px/1 var(--mono);opacity:.65">${w.toFixed(1)}m</span>`;
  };
  presetChip.addEventListener('click', () => app.showLibrary());
  updatePresetChip(editor.activePreset);
  bar.appendChild(h('div', { class: 'tb-group' }, presetChip));
  bar.appendChild(h('div', { class: 'tb-sep' }));

  /* view toggles */
  const gridBtn = tb('grid', 'Grid (G)', () => app.toggleGrid());
  const wireBtn = tb('wire', 'Wireframe (W)', () => app.toggleWire());
  const helpBtn = tb('layers', 'Helpers (J)', () => app.toggleHelpers());
  bar.appendChild(h('div', { class: 'tb-group' }, gridBtn, wireBtn, helpBtn));
  bar.appendChild(h('div', { class: 'tb-sep' }));

  const focusBtn = tb('focus', 'Frame selection (F)', () => app.frameSelection());
  const topBtn = tb('compass', 'Top view (Alt+2)', () => app.setView('top'));
  const perBtn = tb('camera', 'Perspective (Alt+1)', () => app.setView('persp'));
  bar.appendChild(h('div', { class: 'tb-group' }, focusBtn, topBtn, perBtn));

  bar.appendChild(h('div', { class: 'tb-spacer' }));

  /* camera speed */
  const speedLabel = h('span', { class: 'lbl', style: { font: '400 10px/1 var(--mono)', color: 'var(--t-lo)' } }, '30 m/s');
  const speedDown = h('button', { class: 'tbtn', type: 'button', title: 'Slower ( [ )', html: icon('minus').innerHTML });
  const speedUp = h('button', { class: 'tbtn', type: 'button', title: 'Faster ( ] )', html: icon('plus').innerHTML });
  speedDown.addEventListener('click', () => app.nudgeSpeed(1 / 1.4));
  speedUp.addEventListener('click', () => app.nudgeSpeed(1.4));
  bar.appendChild(h('div', { class: 'tb-group' }, speedDown, speedLabel, speedUp));
  bar.appendChild(h('div', { class: 'tb-sep' }));

  const genBtn = h('button', { class: 'btn accent sm', type: 'button', style: { height: '24px' } }, 'Generate City');
  genBtn.addEventListener('click', () => app.showGenerate());
  bar.appendChild(h('div', { class: 'tb-group' }, genBtn));

  root.appendChild(bar);

  editor.on('tool', (t) => { for (const [k, b] of modeBtns) b.classList.toggle('active', k === t); });
  editor.on('preset', updatePresetChip);
  editor.on('history', () => {
    undoBtn.style.opacity = editor.canUndo ? '1' : '.35';
    redoBtn.style.opacity = editor.canRedo ? '1' : '.35';
  });

  return {
    setSpeed: (v) => { speedLabel.textContent = `${v < 10 ? v.toFixed(1) : Math.round(v)} m/s`; },
    setToggle: (name, on) => {
      const map = { grid: gridBtn, wire: wireBtn, helpers: helpBtn };
      map[name]?.classList.toggle('toggle-on', on);
    },
  };
}

/* ============================================================ STATUS BAR === */

export function createStatusBar(root, editor, app) {
  const bar = h('div', { class: 'statusbar' });
  const dot = h('span', { class: 'sb-dot' });
  const state = h('span', {});
  bar.appendChild(h('div', { class: 'sb-item' }, dot, state));

  const mk = (k) => {
    const v = h('span', { class: 'v' }, '—');
    bar.appendChild(h('div', { class: 'sb-item' }, h('span', { class: 'k' }, k), v));
    return v;
  };
  const vTris = mk('tris');
  const vDraws = mk('draws');
  const vTiles = mk('chunks');
  const vProps = mk('props');
  bar.appendChild(h('div', { class: 'sb-item' }, h('span', { class: 'k' }, 'net'), h('span', { class: 'v', id: 'sb-net' }, '—')));
  const vNet = bar.lastChild.querySelector('.v');
  bar.appendChild(h('div', { class: 'sb-spacer' }));
  const vFps = mk('fps');
  const vCam = mk('cam');
  const vSel = mk('sel');

  root.appendChild(bar);
  let acc = 0, frames = 0, fps = 0;

  return {
    update(dt) {
      acc += dt; frames++;
      if (acc >= 0.5) { fps = frames / acc; acc = 0; frames = 0; }
      const s = editor.world.stats;
      vTris.textContent = fmtInt(s.tris);
      vDraws.textContent = fmtInt(s.draws);
      vTiles.textContent = fmtInt(s.tiles);
      vProps.textContent = fmtInt(s.props);
      const st = editor.net.stats();
      vNet.textContent = `${fmtInt(st.edges)} e / ${fmtInt(st.nodes)} n / ${st.km.toFixed(1)} km`;
      vFps.textContent = fps.toFixed(0);
      vFps.className = `v ${fps > 50 ? 'good' : fps > 28 ? 'warn' : 'bad'}`;
      const p = app.camera.position;
      vCam.textContent = `${p.x.toFixed(0)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0)}`;
      const sel = editor.selection.edges.size + editor.selection.nodes.size;
      vSel.textContent = sel ? `${sel} selected` : '—';
      const busy = editor.world.building;
      dot.className = `sb-dot${busy ? ' build' : ''}`;
      state.textContent = busy ? `building ${(editor.world.progress * 100).toFixed(0)}%` : 'ready';
      state.style.color = busy ? 'var(--amber)' : 'var(--t-md)';
    },
  };
}

/* ============================================================== OVERLAYS === */

export function createOverlays(viewport, editor, app) {
  const wrap = h('div', { class: 'vp-overlay', style: { inset: '0' } });

  /* top-left: identity + scene summary */
  const tl = h('div', { class: 'hud', id: 'hud-info', style: { minWidth: '186px' } });
  wrap.appendChild(h('div', { class: 'vp-topleft' }, tl));

  /* top-right: performance */
  const tr = h('div', { class: 'hud cam-hud', style: { minWidth: '150px' } });
  const graph = h('canvas', { class: 'perf-graph', width: '150', height: '30' });
  tr.appendChild(graph);
  wrap.appendChild(h('div', { class: 'vp-topright' }, tr));

  /* bottom-right: compass + view buttons */
  const br = h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' } });
  const compass = h('div', { class: 'compass', title: 'Click for top view' },
    h('div', { class: 'n' }, 'N'),
    h('div', { class: 'needle', id: 'compass-needle' }),
  );
  compass.addEventListener('click', () => app.setView('top'));
  const viewBtns = h('div', { class: 'hud', style: { display: 'flex', gap: '4px', padding: '4px' } },
    h('button', { class: 'btn sm', type: 'button', onclick: () => app.setView('persp') }, 'PERSP'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => app.setView('top') }, 'TOP'),
    h('button', { class: 'btn sm', type: 'button', onclick: () => app.frameAll() }, 'FIT'),
  );
  br.appendChild(compass);
  br.appendChild(viewBtns);
  wrap.appendChild(h('div', { class: 'vp-botright' }, br));

  /* nav help */
  const nav = h('div', { class: 'navhelp', id: 'navhelp' },
    h('div', { class: 'hd' }, 'Viewport navigation'),
    line('RMB drag', 'look around'),
    line('RMB + W A S D', 'fly'),
    line('Q / E', 'down / up'),
    line('Wheel', 'dolly'),
    line('⇧Wheel', 'camera speed'),
    line('MMB drag', 'pan'),
    line('⌥LMB / ⌥MMB', 'orbit / pan'),
    line('F', 'frame selection'),
    line('Home', 'frame city'),
    line('[ / ]', 'speed − / +'),
    line('Enter', 'finish road'),
    line('⇧Enter', 'close loop'),
    line('Esc', 'cancel / deselect'),
    line('Del', 'delete'),
    line('H', 'hide this'),
  );
  wrap.appendChild(nav);

  /* cursor readout */
  const readout = h('div', { class: 'cursor-readout', id: 'cursor-readout' }, '—');
  wrap.appendChild(h('div', { class: 'vp-botleft' }, readout));

  /* toasts */
  const toasts = h('div', { id: 'toasts' });
  wrap.appendChild(toasts);

  viewport.appendChild(wrap);

  const gctx = graph.getContext('2d');
  const hist = new Array(75).fill(0);
  let hi = 0;

  return {
    setInfo(html) { tl.innerHTML = html; },
    setReadout(text) { readout.textContent = text; },
    pushFrame(ms) {
      hist[hi] = ms; hi = (hi + 1) % hist.length;
      gctx.clearRect(0, 0, graph.width, graph.height);
      for (let i = 0; i < hist.length; i++) {
        const v = hist[(hi + i) % hist.length];
        const hgt = Math.min(30, (v / 34) * 30);
        gctx.fillStyle = v < 17 ? '#7ddc6a' : v < 28 ? '#ffb340' : '#ff5d5d';
        gctx.fillRect(i * 2, 30 - hgt, 2, hgt);
      }
    },
    setHeading(rad) {
      const needle = $('#compass-needle', compass);
      if (needle) needle.style.transform = `rotate(${(rad * 180) / Math.PI}deg)`;
    },
    toast(msg, kind = '') {
      const t = h('div', { class: `toast ${kind}` }, msg);
      toasts.appendChild(t);
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 220); }, 2400);
    },
    toggleNav(force) {
      const on = force !== undefined ? force : !nav.classList.contains('show');
      nav.classList.toggle('show', on);
      return on;
    },
    setVisible(v) { wrap.style.display = v ? '' : 'none'; },
  };
}

function line(k, v) {
  return h('div', { class: 'line' }, h('span', { html: kbd(k) }), h('span', {}, v));
}
function kbd(s) {
  return s.split(' ').map((t) => (t.startsWith('⌥') || t.startsWith('⇧') || t.length > 3 ? t : `<kbd>${t}</kbd>`)).join(' ');
}
