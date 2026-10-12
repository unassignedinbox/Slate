/* ============================================================================
   Panels — library, inspector, generator, outliner.

   All panels are plain DOM built from widgets.js and driven by editor events.
   ========================================================================== */

import * as THREE from 'three';
import { h, $, clear, section, field, numberInput, slider, checkbox, select, segmented, button, kv, fmtInt, icon } from './widgets.js';
import { PRESETS, GROUPS, KINDS, KIND_KEYS, SURFACES, SURFACE_KEYS, MARKING_STYLES } from '../model/Presets.js';
import { CrossSectionEditor } from './CrossSectionEditor.js';
import { PATTERNS, DEFAULTS } from '../gen/CityGenerator.js';

/* ============================================================== LIBRARY === */

export function createLibrary(container, editor) {
  const list = h('div', { style: { flex: '1', overflowY: 'auto', paddingBottom: '8px' } });
  const search = h('input', { type: 'text', placeholder: 'Search 34 road types…' });

  const root = h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } },
    h('div', { class: 'lib-search' }, search),
    list,
  );
  container.appendChild(root);

  let activeId = editor.activePreset;

  function thumb(preset) {
    const c = h('canvas', { class: 'thumb' });
    c.width = 80; c.height = 52;
    const g = c.getContext('2d');
    const total = preset.bands.reduce((s, b) => s + Math.max(0, b.w || 0), 0) || 10;
    let x = 4;
    const wpx = 72;
    for (const b of preset.bands) {
      const w = (Math.max(0, b.w || 0) / total) * wpx;
      const k = KINDS[b.k] || KINDS.none;
      g.fillStyle = k.color;
      g.fillRect(x, 8, Math.max(1, w), 30);
      if (b.k === 'rail' || b.k === 'tram') {
        g.fillStyle = '#d8dde3';
        g.fillRect(x + w / 2 - 2.5, 12, 1.6, 22);
        g.fillRect(x + w / 2 + 1, 12, 1.6, 22);
      }
      x += w;
    }
    // crown highlight
    g.fillStyle = 'rgba(255,255,255,.16)';
    g.fillRect(4, 8, wpx, 3);
    // kerb ticks
    g.fillStyle = 'rgba(255,255,255,.45)';
    let xx = 4;
    for (const b of preset.bands) {
      const w = (Math.max(0, b.w || 0) / total) * wpx;
      if (b.h > 0.05) g.fillRect(xx, 6, w, 2);
      xx += w;
    }
    return c;
  }

  function build() {
    clear(list);
    const q = search.value.trim().toLowerCase();
    for (const grp of GROUPS) {
      const items = PRESETS.filter((p) =>
        p.group === grp && (!q || p.name.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q) || p.id.includes(q)));
      if (!items.length) continue;
      list.appendChild(h('div', { class: 'lib-group-label' }, grp));
      for (const p of items) {
        const row = h('div', { class: `preset${p.id === activeId ? ' active' : ''}` },
          thumb(p),
          h('div', { class: 'meta' },
            h('div', { class: 'nm' }, p.name),
            h('div', { class: 'ds' }, p.desc),
          ),
          h('span', { class: `tag ${p.tag}` }, p.tag.toUpperCase()),
        );
        row.addEventListener('click', () => {
          activeId = p.id;
          editor.setPreset(p.id);
          // painting the preset onto the current selection is the fast path
          if (editor.selection.edges.size) {
            editor.pushHistory();
            for (const id of editor.selection.edges) {
              const e = editor.net.edges.get(id);
              if (!e) continue;
              e.preset = p.id; e.bands = null; e.features = null;
              editor.markDirty([id]);
            }
            editor.emit('inspector');
          }
          build();
        });
        list.appendChild(row);
      }
    }
    if (!list.children.length) {
      list.appendChild(h('div', { class: 'ot-empty' }, 'no road types match'));
    }
  }

  search.addEventListener('input', build);
  editor.on('preset', (id) => { activeId = id; build(); });
  build();
  return { refresh: build };
}

/* ============================================================ INSPECTOR === */

export function createInspector(container, editor) {
  const body = h('div', { style: { padding: '8px' } });
  container.appendChild(body);
  let xs = null;
  let selectedBand = -1;

  function emptyState() {
    clear(body);
    body.appendChild(h('div', { class: 'empty-state' },
      h('div', { class: 'ic', html: icon('road').innerHTML }),
      h('div', { class: 't' }, 'Nothing selected'),
      h('div', { class: 's' }, 'Pick a road in the viewport, draw one, or generate a city.'),
    ));
    body.appendChild(h('div', { class: 'info-note' },
      h('b', {}, 'Tip: '), 'hold right mouse button and use ', h('b', {}, 'WASD'), ' to fly. Press ', h('b', {}, 'H'), ' for the full control list.'));
  }

  /* ------------------------------------------------------------ edge UI -- */
  function buildEdge(edge) {
    clear(body);
    selectedBand = -1;
    const bands = () => edge.bandsOf();
    const preset = edge.presetOf();
    const count = editor.selection.edges.size;

    /* header */
    body.appendChild(h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' } },
      h('div', { style: { flex: '1', minWidth: 0 } },
        h('div', { style: { font: '600 12px/1.3 var(--ui)', color: 'var(--t-hi)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, edge.name || preset.name),
        h('div', { style: { font: '400 9.5px/1.3 var(--mono)', color: 'var(--t-dim)' } },
          `${edge.id} · ${count > 1 ? `${count} selected · ` : ''}${edge.length(editor.net).toFixed(1)} m`),
      ),
    ));

    /* preset */
    const presetSel = select(PRESETS.map((p) => ({ value: p.id, label: p.name })), edge.preset, (v) => {
      editor.pushHistory();
      for (const id of editor.selection.edges) {
        const e = editor.net.edges.get(id);
        if (!e) continue;
        e.preset = v; e.bands = null; e.features = null;
        editor.markDirty([id]);
      }
      editor.emit('inspector');
    });
    const secPreset = section('Road Type', { aux: preset.group });
    secPreset.body.appendChild(field('Preset', presetSel.root));
    secPreset.body.appendChild(h('div', { class: 'btn-row' },
      button('Reset to preset', () => editor.resetSelectionToPreset(), 'sm'),
      button('Copy to all', () => {
        editor.pushHistory();
        const src = edge;
        for (const e of editor.net.edges.values()) {
          if (e.id === src.id) continue;
          e.preset = src.preset; e.bands = src.bands ? src.bands.map((b) => ({ ...b })) : null;
          e.features = src.features ? JSON.parse(JSON.stringify(src.features)) : null;
        }
        editor.markAllDirty();
      }, 'sm'),
    ));
    body.appendChild(secPreset.root);

    /* cross-section */
    const secXS = section('Cross Section', { aux: `${edge.width().toFixed(1)} m` });
    const xsHost = h('div', {});
    secXS.body.appendChild(xsHost);
    xs = new CrossSectionEditor(xsHost, {
      onChange: (b) => editor.applyBands(b),
      onSelect: (i) => { selectedBand = i; clampBand(); buildLaneList(); },
      onWidths: (b) => { secXS.setAux(`${b.reduce((s, x) => s + (x.w || 0), 0).toFixed(1)} m`); },
    });
    xs.setBands(bands(), edge.camber ?? 0.025);

    const xsTools = h('div', { class: 'xs-toolbar' },
      btnIcon('plus', 'Add band', () => addBand(0)),
      btnIcon('minus', 'Remove band', () => removeBand()),
      btnIcon('copy', 'Duplicate band', () => duplicateBand()),
      h('div', { style: { flex: '1' } }),
      button('Mirror', () => mirrorBands(), 'sm'),
      button('Reset', () => { editor.resetSelectionToPreset(); }, 'sm'),
    );
    secXS.body.insertBefore(xsTools, secXS.body.firstChild);

    const laneList = h('div', { class: 'lane-list' });
    secXS.body.appendChild(laneList);
    secXS.body.appendChild(h('div', { class: 'xs-hint' },
      'Drag a ', h('b', {}, 'boundary'), ' to re-allocate width · click a band to select · double-click to reset a width.'));
    body.appendChild(secXS.root);

    /* lane properties */
    const secBand = section('Band', { collapsed: true, aux: '—' });
    body.appendChild(secBand.root);

    /* surface + geometry */
    const secGeo = section('Geometry', { collapsed: false });
    const camber = slider(edge.camber ?? 0.025, {
      min: 0, max: 0.08, step: 0.0025,
      format: (v) => `${(v * 100).toFixed(2)}%`,
      onInput: (v) => {
        for (const id of editor.selection.edges) {
          const e = editor.net.edges.get(id); if (e) e.camber = v;
        }
        editor.markDirty([...editor.selection.edges]);
        xs.camber = v; xs.render();
      },
    });
    secGeo.body.appendChild(field('Crossfall', camber.root));

    const bank = slider(edge.bankGain ?? 0, {
      min: 0, max: 1, step: 0.05,
      format: (v) => (v === 0 ? 'off' : `${(v * 100) | 0}%`),
      onInput: (v) => {
        for (const id of editor.selection.edges) {
          const e = editor.net.edges.get(id); if (e) { e.bankGain = v; e.maxBank = 0.08; }
        }
        editor.markDirty([...editor.selection.edges]);
      },
    });
    secGeo.body.appendChild(field('Banking', bank.root));

    const ms = select(Object.entries(MARKING_STYLES).map(([k, v]) => ({ value: k, label: v.label })), edge.markStyle, (v) => {
      for (const id of editor.selection.edges) { const e = editor.net.edges.get(id); if (e) e.markStyle = v; }
      editor.markDirty([...editor.selection.edges]);
    });
    secGeo.body.appendChild(field('Marking code', ms.root));

    const spd = numberInput(edge.speed ?? 50, {
      min: 5, max: 140, step: 5, unit: 'km/h', precision: 0,
      onInput: (v) => { for (const id of editor.selection.edges) { const e = editor.net.edges.get(id); if (e) e.speed = v; } },
    });
    secGeo.body.appendChild(field('Design speed', spd.root));

    secGeo.body.appendChild(h('div', { class: 'btn-row', style: { marginTop: '6px' } },
      button('Bridge', () => toggleBridge(), 'sm'),
      button('Tunnel', () => toggleTunnel(), 'sm'),
      button('Reverse', () => reverse(), 'sm'),
    ));
    body.appendChild(secGeo.root);

    /* features */
    const secFeat = section('Street Features', { collapsed: false });
    buildFeatures(secFeat.body, edge);
    body.appendChild(secFeat.root);

    /* actions */
    const secAct = section('Actions', { collapsed: true });
    secAct.body.appendChild(h('div', { class: 'btn-row' },
      button('Split at mid', () => {
        editor.pushHistory();
        const c = edge.curve(editor.net);
        const r = editor.net.splitEdge(edge.id, ...(() => { const p = c.pos(c.length / 2); return [p.x, p.y]; })());
        if (r) editor.markDirty([r.e0.id, r.e1.id]);
      }, 'sm'),
      button('Select same', () => {
        const ids = [...editor.net.edges.values()].filter((e) => e.preset === edge.preset).map((e) => e.id);
        editor.select(ids);
      }, 'sm'),
    ));
    secAct.body.appendChild(h('div', { class: 'btn-row', style: { marginTop: '5px' } },
      button('Delete', () => editor.deleteSelection(), 'sm danger'),
      button('Focus', () => editor.emit('focusSelection'), 'sm'),
    ));
    body.appendChild(secAct.root);

    /* ------------------------------------------------------------ lanes -- */
    function buildLaneList() {
      clear(laneList);
      const b = bands();
      b.forEach((band, i) => {
        const k = KINDS[band.k] || KINDS.none;
        const row = h('div', { class: `lane-row${i === selectedBand ? ' sel' : ''}` },
          h('span', { class: 'sw', style: { background: k.color } }),
          h('span', { class: 'nm' }, k.label),
          h('span', { class: 'wd' }, `${(band.w ?? 0).toFixed(2)}m`),
          h('span', { class: 'x', onclick: (e) => { e.stopPropagation(); selectedBand = i; removeBand(); } }, '×'),
        );
        row.addEventListener('click', () => { selectedBand = i; xs.setSelected(i); buildLaneList(); buildBandProps(); });
        laneList.appendChild(row);
      });
      const kindSel = select(KIND_KEYS.map((k) => ({ value: k, label: KINDS[k].label })), 'driving', () => {});
      const addRow = h('div', { class: 'lane-add' },
        kindSel.root,
        button('+ Left', () => addBand(0, kindSel.el.value), 'sm'),
        button('+ Right', () => addBand(1, kindSel.el.value), 'sm'),
      );
      laneList.appendChild(addRow);
    }

    /** Keep the band cursor inside the array after any structural change. */
    function clampBand() {
      const n = bands().length;
      if (selectedBand >= n) selectedBand = n - 1;
      if (selectedBand < -1) selectedBand = -1;
    }

    /** Mutate the selected band, no-op if the cursor is stale. */
    function editBand(fn) {
      const bb = bands();
      const t = bb[selectedBand];
      if (!t) { clampBand(); return; }
      fn(bb, t);
    }

    function buildBandProps() {
      clear(secBand.body);
      clampBand();
      const b = bands()[selectedBand];
      if (!b) { secBand.setAux('—'); return; }
      const k = KINDS[b.k] || KINDS.none;
      secBand.setAux(k.label);
      secBand.root.classList.remove('collapsed');

      const kindSel = select(KIND_KEYS.map((kk) => ({ value: kk, label: KINDS[kk].label })), b.k, (v) => {
        editBand((bb, t) => { bb[selectedBand] = { ...t, k: v, s: KINDS[v].surface, h: KINDS[v].h ?? t.h }; });
        editor.applyBands(bands());
        xs.setBands(bands(), edge.camber); buildLaneList(); buildBandProps();
      });
      secBand.body.appendChild(field('Kind', kindSel.root));

      const w = numberInput(b.w ?? 1, {
        min: 0, max: 40, step: 0.05, unit: 'm', precision: 2,
        onInput: (v) => {
          editBand((bb, t) => { t.w = v; xs.setBands(bb, edge.camber); });
        },
      });
      w.input.addEventListener('change', () => {
        editBand((bb, t) => { t.w = parseFloat(w.input.value); editor.applyBands(bb); });
      });
      secBand.body.appendChild(field('Width', w.root));

      const surfSel = select(SURFACE_KEYS.map((s) => ({ value: s, label: SURFACES[s].label })), b.s, (v) => {
        editBand((bb, t) => { t.s = v; editor.applyBands(bb); });
        xs.setBands(bands(), edge.camber);
      });
      secBand.body.appendChild(field('Surface', surfSel.root));

      const hgt = numberInput(b.h ?? 0, {
        min: -12, max: 12, step: 0.01, unit: 'm', precision: 2,
        onInput: (v) => { editBand((bb, t) => { t.h = v; xs.setBands(bb, edge.camber); }); },
      });
      hgt.input.addEventListener('change', () => {
        editBand((bb, t) => { t.h = parseFloat(hgt.input.value); editor.applyBands(bb); });
      });
      secBand.body.appendChild(field('Height', hgt.root));

      secBand.body.appendChild(field('Direction', segmented([
        { value: '-1', label: 'Back' }, { value: '0', label: 'Both' }, { value: '1', label: 'Fwd' },
      ], String(b.dir || 0), (v) => {
        editBand((bb, t) => { t.dir = parseInt(v, 10); editor.applyBands(bb); });
      }).root));

      secBand.body.appendChild(field('Riser', segmented([
        { value: 'curb', label: 'Kerb' }, { value: 'slope', label: 'Ramp' }, { value: 'wall', label: 'Wall' }, { value: 'none', label: 'Flush' },
      ], b.riser || 'curb', (v) => {
        editBand((bb, t) => { t.riser = v; editor.applyBands(bb); });
      }).root));

      if (b.k === 'rail' || b.k === 'tram') {
        const gauge = numberInput(b.gauge ?? 1.435, { min: 0.6, max: 2.2, step: 0.005, unit: 'm', precision: 3,
          onInput: (v) => { editBand((bb, t) => { t.gauge = v; editor.applyBands(bb); }); } });
        secBand.body.appendChild(field('Gauge', gauge.root));
      }
    }

    /* --------------------------------------------------------- helpers -- */
    function addBand(side, kind = 'driving') {
      const bb = bands();
      const nb = { k: kind, w: KINDS[kind].w ?? 3, s: KINDS[kind].surface, h: KINDS[kind].h ?? 0, dir: 0 };
      if (side === 0) bb.unshift(nb); else bb.push(nb);
      editor.applyBands(bb);
      xs.setBands(bands(), edge.camber); buildLaneList();
    }
    function removeBand() {
      clampBand();
      if (selectedBand < 0) return;
      const bb = bands();
      if (bb.length <= 1) return;
      bb.splice(selectedBand, 1);
      selectedBand = -1;
      editor.applyBands(bb);
      xs.setBands(bands(), edge.camber); xs.setSelected(-1); buildLaneList(); buildBandProps();
    }
    function duplicateBand() {
      clampBand();
      if (selectedBand < 0) return;
      const bb = bands();
      if (!bb[selectedBand]) return;
      bb.splice(selectedBand + 1, 0, { ...bb[selectedBand] });
      editor.applyBands(bb);
      xs.setBands(bands(), edge.camber); clampBand(); buildLaneList(); buildBandProps();
    }
    function mirrorBands() {
      const bb = bands().slice().reverse().map((b) => ({ ...b, dir: -(b.dir || 0) }));
      editor.applyBands(bb);
      xs.setBands(bands(), edge.camber); buildLaneList();
    }
    function toggleBridge() {
      editor.pushHistory();
      const on = !edge.bridge;
      for (const id of editor.selection.edges) {
        const e = editor.net.edges.get(id); if (!e) continue;
        e.bridge = on ? { spacing: 32, deckThickness: 1.4 } : null;
        editor.markDirty([id]);
      }
      editor.emit('inspector');
    }
    function toggleTunnel() {
      editor.pushHistory();
      const on = !edge.tunnel;
      for (const id of editor.selection.edges) {
        const e = editor.net.edges.get(id); if (!e) continue;
        e.tunnel = on;
        editor.markDirty([id]);
      }
      editor.emit('inspector');
    }
    function reverse() {
      editor.pushHistory();
      const e = edge;
      const a = e.a; e.a = e.b; e.b = a;
      e.pts = e.pts.slice().reverse();
      e.bands = e.bandsOf().slice().reverse().map((b) => ({ ...b, dir: -(b.dir || 0) }));
      e.invalidate();
      editor.markDirty([e.id]);
      editor.emit('inspector');
    }

    buildLaneList();
  }

  /* ------------------------------------------------------------ node UI -- */
  function buildNode(node) {
    clear(body);
    const deg = editor.net.degree(node.id);
    body.appendChild(h('div', { style: { marginBottom: '8px' } },
      h('div', { style: { font: '600 12px/1.3 var(--ui)', color: 'var(--t-hi)' } }, 'Junction'),
      h('div', { style: { font: '400 9.5px/1.3 var(--mono)', color: 'var(--t-dim)' } }, `${node.id} · ${deg} arm${deg === 1 ? '' : 's'}`),
    ));

    const sec = section('Junction', { aux: `${deg} arms` });
    const typeSel = select([
      { value: 'auto', label: 'Automatic' },
      { value: 'priority', label: 'Priority / give way' },
      { value: 'signal', label: 'Signalised' },
      { value: 'roundabout', label: 'Roundabout' },
      { value: 'none', label: 'No patch' },
    ], node.junction?.type || 'auto', (v) => {
      node.junction = { ...(node.junction || {}), type: v };
      editor.markDirty(editor.net.edgesAt(node.id).map((e) => e.id));
      editor.emit('inspector');
    });
    sec.body.appendChild(field('Control', typeSel.root));

    const r = numberInput(node.junction?.radius || 0, {
      min: 0, max: 40, step: 0.5, unit: 'm', precision: 1,
      onInput: (v) => {
        node.junction = { ...(node.junction || {}), radius: v };
        editor.markDirty(editor.net.edgesAt(node.id).map((e) => e.id));
      },
    });
    sec.body.appendChild(field('Kerb radius', r.root));
    sec.body.appendChild(h('div', { class: 'xs-hint' }, h('b', {}, '0'), ' = derive from the widest approach.'));

    if ((node.junction?.type || 'auto') === 'roundabout') {
      const w = numberInput(node.junction?.width || 7.5, { min: 4, max: 16, step: 0.5, unit: 'm', precision: 1,
        onInput: (v) => { node.junction = { ...node.junction, width: v }; editor.markDirty(editor.net.edgesAt(node.id).map((e) => e.id)); } });
      sec.body.appendChild(field('Circulatory w', w.root));
      const o = numberInput(node.junction?.outer || 22, { min: 8, max: 60, step: 1, unit: 'm', precision: 1,
        onInput: (v) => { node.junction = { ...node.junction, outer: v }; editor.markDirty(editor.net.edgesAt(node.id).map((e) => e.id)); } });
      sec.body.appendChild(field('Outer radius', o.root));
    }
    body.appendChild(sec.root);

    const secPos = section('Position');
    const px = numberInput(node.x, { min: -1e5, max: 1e5, step: 0.5, unit: 'm', precision: 2,
      onInput: (v) => editor.moveNode(node.id, v, node.z) });
    const pz = numberInput(node.z, { min: -1e5, max: 1e5, step: 0.5, unit: 'm', precision: 2,
      onInput: (v) => editor.moveNode(node.id, node.x, v) });
    const py = numberInput(node.y, { min: -200, max: 400, step: 0.25, unit: 'm', precision: 2,
      onInput: (v) => { node.y = v; node.elevLocked = true; editor.markDirty(editor.net.edgesAt(node.id).map((e) => e.id)); } });
    secPos.body.appendChild(field('X', px.root));
    secPos.body.appendChild(field('Z', pz.root));
    secPos.body.appendChild(field('Elevation', py.root));
    secPos.body.appendChild(checkbox('Lock elevation', node.elevLocked, (v) => { node.elevLocked = v; }));
    body.appendChild(secPos.root);

    const secAct = section('Actions', { collapsed: true });
    secAct.body.appendChild(h('div', { class: 'btn-row' },
      button('Select arms', () => editor.select(editor.net.edgesAt(node.id).map((e) => e.id)), 'sm'),
      button('Focus', () => editor.emit('focusSelection'), 'sm'),
    ));
    secAct.body.appendChild(h('div', { class: 'btn-row', style: { marginTop: '5px' } },
      button('Delete junction', () => editor.deleteSelection(), 'sm danger'),
    ));
    body.appendChild(secAct.root);
  }

  /* --------------------------------------------------------- features UI -- */
  function buildFeatures(host, edge) {
    const f = edge.featuresOf();
    const apply = () => editor.applyFeatures(f);

    const marks = checkbox('Road markings', f.markings !== false, (v) => { f.markings = v; apply(); });
    const gullies = checkbox('Drainage gullies', !!f.gullies, (v) => { f.gullies = v; apply(); });
    const busStops = checkbox('Bus stops / cages', !!f.busStops, (v) => { f.busStops = v; apply(); });
    const rumbles = checkbox('Rumble strips', !!f.rumbles, (v) => { f.rumbles = v; apply(); });
    const signals = checkbox('Signal heads', !!f.signals, (v) => { f.signals = v; apply(); });
    const bar = checkbox('Safety barrier', !!(f.barrier?.on), (v) => { f.barrier = { ...(f.barrier || { side: 'both' }), on: v }; apply(); });
    host.appendChild(field('', h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 12px' } },
      marks.root, gullies.root, busStops.root, rumbles.root, signals.root, bar.root)));

    const li = f.lighting || { on: false };
    const lightOn = checkbox('Street lighting', !!li.on, (v) => { f.lighting = { ...li, on: v, spacing: li.spacing || 26, side: li.side || 'right', h: li.h || 8 }; apply(); build(); });
    host.appendChild(field('', lightOn.root));
    if (li.on) {
      host.appendChild(field('Spacing', numberInput(li.spacing || 26, { min: 8, max: 80, step: 1, unit: 'm', precision: 0,
        onInput: (v) => { f.lighting = { ...f.lighting, spacing: v }; apply(); } }).root));
      host.appendChild(field('Side', segmented([
        { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }, { value: 'both', label: 'Both' },
      ], li.side || 'right', (v) => { f.lighting = { ...f.lighting, side: v }; apply(); }).root));
      host.appendChild(field('Column', numberInput(li.h || 8, { min: 3, max: 16, step: 0.5, unit: 'm', precision: 1,
        onInput: (v) => { f.lighting = { ...f.lighting, h: v }; apply(); } }).root));
    }

    const bol = f.bollards || { on: false };
    const bolOn = checkbox('Bollards', !!bol.on, (v) => { f.bollards = { ...bol, on: v, spacing: bol.spacing || 8, offset: bol.offset || 0.35 }; apply(); build(); });
    host.appendChild(field('', bolOn.root));
    if (bol.on) {
      host.appendChild(field('Spacing', numberInput(bol.spacing || 8, { min: 1.5, max: 30, step: 0.5, unit: 'm', precision: 1,
        onInput: (v) => { f.bollards = { ...f.bollards, spacing: v }; apply(); } }).root));
    }

    const humps = f.humps || { on: false };
    const humpOn = checkbox('Traffic calming', !!humps.on, (v) => {
      f.humps = { on: v, spacing: humps.spacing || 60, type: humps.type || 'hump', height: humps.height, length: humps.length };
      apply(); build();
    });
    host.appendChild(field('', humpOn.root));
    if (humps.on) {
      host.appendChild(field('Type', segmented([
        { value: 'hump', label: 'Hump' }, { value: 'table', label: 'Table' },
      ], humps.type || 'hump', (v) => { f.humps = { ...f.humps, type: v }; apply(); }).root));
      host.appendChild(field('Every', numberInput(humps.spacing || 60, { min: 15, max: 300, step: 5, unit: 'm', precision: 0,
        onInput: (v) => { f.humps = { ...f.humps, spacing: v }; apply(); } }).root));
    }

    const tr = f.trees || { on: false };
    const treeOn = checkbox('Street trees', !!tr.on, (v) => { f.trees = { ...tr, on: v, spacing: tr.spacing || 12 }; apply(); build(); });
    host.appendChild(field('', treeOn.root));
    if (tr.on) {
      host.appendChild(field('Spacing', numberInput(tr.spacing || 12, { min: 4, max: 40, step: 1, unit: 'm', precision: 0,
        onInput: (v) => { f.trees = { ...f.trees, spacing: v }; apply(); } }).root));
    }

    if (edge.isRail()) {
      host.appendChild(h('div', { class: 'divider' }));
      const cat = checkbox('Overhead line', !!f.catenary, (v) => { f.catenary = v; apply(); });
      const plat = checkbox('Station platforms', !!f.platforms, (v) => { f.platforms = v; apply(); });
      const lx = checkbox('Level crossings', f.levelCrossing !== false, (v) => { f.levelCrossing = v; apply(); });
      host.appendChild(field('', h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 12px' } }, cat.root, plat.root, lx.root)));
    }

    function build() {
      clear(host);
      buildFeatures(host, edge);
    }
  }

  function btnIcon(name, title, onClick) {
    const b = h('button', { class: 'tbtn', type: 'button', title, html: icon(name).innerHTML }, );
    b.addEventListener('click', onClick);
    return b;
  }

  /* ------------------------------------------------------------ refresh -- */
  function refresh() {
    const edge = editor.primaryEdge;
    const node = editor.primaryNode;
    if (edge) buildEdge(edge);
    else if (node) buildNode(node);
    else emptyState();
  }

  editor.on('selection', refresh);
  editor.on('inspector', refresh);
  editor.on('network', refresh);
  refresh();
  return { refresh };
}

/* ============================================================ GENERATOR === */

export function createGeneratePanel(container, editor) {
  const o = { ...DEFAULTS };
  const body = h('div', { style: { padding: '8px' } });
  container.appendChild(body);

  const status = h('div', { class: 'info-note', style: { display: 'none' } });
  const statsBox = h('div', { class: 'kv-table' });

  /* pattern */
  const secPat = section('Pattern');
  const patButtons = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' } });
  const patBtns = new Map();
  for (const p of PATTERNS) {
    const b = h('button', { class: `btn sm${p.id === o.pattern ? ' primary' : ''}`, type: 'button', style: { textAlign: 'left', padding: '5px 7px' } },
      h('div', { style: { font: '600 10.5px/1.2 var(--ui)' } }, p.label),
      h('div', { style: { font: '400 8.5px/1.2 var(--mono)', opacity: '.7' } }, p.desc),
    );
    b.addEventListener('click', () => {
      o.pattern = p.id;
      for (const [k, bb] of patBtns) bb.classList.toggle('primary', k === p.id);
    });
    patBtns.set(p.id, b);
    patButtons.appendChild(b);
  }
  secPat.body.appendChild(patButtons);
  body.appendChild(secPat.root);

  /* extent */
  const secSize = section('Scale');
  const ext = slider(o.extent, { min: 600, max: 10000, step: 100, format: (v) => `${(v / 1000).toFixed(1)} km`,
    onInput: (v) => { o.extent = v; updateEstimate(); } });
  secSize.body.appendChild(field('Map extent', ext.root));
  const bl = slider(o.blockLength, { min: 60, max: 420, step: 10, format: (v) => `${v | 0} m`,
    onInput: (v) => { o.blockLength = v; updateEstimate(); } });
  secSize.body.appendChild(field('Block length', bl.root));
  const bw = slider(o.blockWidth, { min: 40, max: 300, step: 5, format: (v) => `${v | 0} m`,
    onInput: (v) => { o.blockWidth = v; updateEstimate(); } });
  secSize.body.appendChild(field('Block width', bw.root));
  const jit = slider(o.jitter, { min: 0, max: 1, step: 0.05, format: (v) => (v === 0 ? 'none' : `${(v * 100) | 0}%`),
    onInput: (v) => { o.jitter = v; } });
  secSize.body.appendChild(field('Irregularity', jit.root));
  body.appendChild(secSize.root);

  const est = h('div', { class: 'info-note', style: { marginTop: '0' } });
  secSize.body.appendChild(est);

  /* network */
  const secNet = section('Network', { collapsed: false });
  secNet.body.appendChild(field('', checkbox('Road hierarchy', o.hierarchy, (v) => { o.hierarchy = v; })));
  secNet.body.appendChild(field('', checkbox('Bus lanes + stops', o.busLanes, (v) => { o.busLanes = v; })));
  secNet.body.appendChild(field('', checkbox('Cycle lanes', o.cycleLanes, (v) => { o.cycleLanes = v; })));
  secNet.body.appendChild(field('', checkbox('Parking bays', o.parking, (v) => { o.parking = v; })));
  secNet.body.appendChild(field('', checkbox('Traffic calming', o.humps, (v) => { o.humps = v; })));
  secNet.body.appendChild(field('', checkbox('Street lighting', o.lighting, (v) => { o.lighting = v; })));
  secNet.body.appendChild(field('', checkbox('Orbital beltway', o.beltway, (v) => { o.beltway = v; })));
  const rnd = slider(o.roundabouts, { min: 0, max: 0.6, step: 0.02, format: (v) => (v === 0 ? 'none' : `${(v * 100) | 0}%`),
    onInput: (v) => { o.roundabouts = v; } });
  secNet.body.appendChild(field('Roundabouts', rnd.root));
  const ow = slider(o.oneWayRatio, { min: 0, max: 1, step: 0.05, format: (v) => `${(v * 100) | 0}%`,
    onInput: (v) => { o.oneWayRatio = v; } });
  secNet.body.appendChild(field('One-way ratio', ow.root));
  body.appendChild(secNet.root);

  /* transit */
  const secRail = section('Transit', { collapsed: false });
  const rl = slider(o.railLines, { min: 0, max: 4, step: 1, format: (v) => (v === 0 ? 'none' : `${v | 0}`),
    onInput: (v) => { o.railLines = v; } });
  secRail.body.appendChild(field('Heavy rail lines', rl.root));
  const ml = slider(o.metroLines, { min: 0, max: 4, step: 1, format: (v) => (v === 0 ? 'none' : `${v | 0}`),
    onInput: (v) => { o.metroLines = v; } });
  secRail.body.appendChild(field('Subway lines', ml.root));
  secRail.body.appendChild(h('div', { class: 'xs-hint' },
    'Subways alternate between ', h('b', {}, 'cut-and-cover trench'), ' and ', h('b', {}, 'elevated viaduct'), ' along each line.'));
  body.appendChild(secRail.root);

  /* terrain */
  const secTerr = section('Terrain', { collapsed: true });
  const ta = slider(o.terrain, { min: 0, max: 60, step: 1, format: (v) => (v === 0 ? 'flat' : `${v | 0} m`),
    onInput: (v) => { o.terrain = v; } });
  secTerr.body.appendChild(field('Relief', ta.root));
  secTerr.body.appendChild(h('div', { class: 'xs-hint' }, 'Roads drape over the heightfield; vertical curves are smoothed automatically.'));
  body.appendChild(secTerr.root);

  /* seed */
  const secSeed = section('Seed');
  const seedInput = h('input', { type: 'text', value: String(o.seed) });
  seedInput.addEventListener('input', () => { o.seed = parseInt(seedInput.value.replace(/\D/g, ''), 10) || 0; });
  const seedRow = h('div', { class: 'seed-row' }, seedInput,
    button('⟳', () => { o.seed = Math.floor(Math.random() * 999999); seedInput.value = String(o.seed); }, 'sm'));
  secSeed.body.appendChild(field('Seed', seedRow));
  body.appendChild(secSeed.root);

  /* run */
  const runRow = h('div', { class: 'btn-row' });
  const genBtn = button('Generate City', () => run(), 'primary wide');
  runRow.appendChild(genBtn);
  const stopRow = h('div', { class: 'btn-row', style: { marginTop: '5px' } },
    button('Clear', () => { editor.net.clear(); editor.markAllDirty(); editor.clearSelection(); status.style.display = 'none'; }, 'sm'),
    button('Add to scene', () => run(true), 'sm'),
  );
  body.appendChild(h('div', { style: { paddingTop: '8px' } }, runRow, stopRow, status, statsBox));

  function updateEstimate() {
    const cols = Math.floor(o.extent / o.blockLength) + 1;
    const rows = Math.floor(o.extent / o.blockWidth) + 1;
    const edges = Math.max(0, cols * (rows - 1) + rows * (cols - 1));
    const km = ((edges * ((o.blockLength + o.blockWidth) / 2)) / 1000).toFixed(0);
    est.innerHTML = `<b>${fmtInt(edges)}</b> segments · <b>${fmtInt(cols * rows)}</b> junctions · ≈<b>${km} km</b> of carriageway`;
  }

  function run(append = false) {
    status.style.display = 'block';
    status.className = 'info-note';
    status.innerHTML = 'Generating network…';
    const t0 = performance.now();
    if (!append) editor.net.clear();
    const before = editor.net.edges.size;
    const stats = editor.generate(o);
    const ms = (performance.now() - t0).toFixed(0);
    status.className = 'info-note';
    status.innerHTML = `<b>${fmtInt(stats.edges)}</b> segments · <b>${stats.km.toFixed(1)} km</b> · `
      + `<b>${fmtInt(stats.nodes)}</b> junctions · ${fmtInt(stats.roundabouts)} roundabouts · `
      + `${fmtInt(stats.gradeSeparations)} grade separations · <b>${ms} ms</b>`;
    clear(statsBox);
    const rows = [
      ['edges', fmtInt(stats.edges)],
      ['nodes', fmtInt(stats.nodes)],
      ['length', `${stats.km.toFixed(2)} km`],
      ['rail / metro', `${stats.rail}`],
      ['bridges', fmtInt(stats.bridge)],
      ['signals', fmtInt(stats.signals)],
    ];
    for (const [k, v] of rows) statsBox.appendChild(h('tr', {}, h('td', { class: 'k' }, k), h('td', { class: 'v' }, v)));
    editor.emit('generatedStats', stats);
  }

  updateEstimate();
  return { refresh: () => {}, runOnce: () => run(false) };
}

/* ============================================================= OUTLINER === */

export function createOutliner(container, editor) {
  const list = h('div', { style: { flex: '1', overflowY: 'auto' } });
  const head = h('div', { style: { display: 'flex', gap: '4px', padding: '4px 6px', borderBottom: '1px solid var(--s-20)' } },
    button('All', () => editor.selectAll(), 'sm'),
    button('None', () => editor.clearSelection(), 'sm'),
  );
  container.appendChild(h('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } }, head, list));

  function refresh() {
    clear(list);
    const groups = new Map();
    for (const e of editor.net.edges.values()) {
      const p = e.presetOf();
      if (!groups.has(p.name)) groups.set(p.name, { color: KINDS[p.bands[0].k]?.color || '#888', items: [] });
      groups.get(p.name).items.push(e);
    }
    if (!groups.size) {
      list.appendChild(h('div', { class: 'ot-empty' }, 'network is empty'));
      return;
    }
    for (const [name, grp] of groups) {
      const row = h('div', { class: 'ot-row' },
        h('span', { class: 'dot', style: { background: grp.color } }),
        h('span', { class: 'nm' }, name),
        h('span', { class: 'ct' }, fmtInt(grp.items.length)),
      );
      row.addEventListener('click', () => editor.select(grp.items.map((e) => e.id)));
      list.appendChild(row);
      if (editor.selection.edges.size) {
        const sel = grp.items.filter((e) => editor.selection.edges.has(e.id));
        if (sel.length && sel.length < 40) {
          for (const e of sel) {
            const sub = h('div', { class: 'ot-row sel', style: { paddingLeft: '20px' } },
              h('span', { class: 'nm' }, e.name || e.id),
              h('span', { class: 'ct' }, `${e.length(editor.net).toFixed(0)}m`),
            );
            sub.addEventListener('click', (ev) => { ev.stopPropagation(); editor.select([e.id], ev.shiftKey); });
            list.appendChild(sub);
          }
        }
      }
    }
  }

  editor.on('selection', refresh);
  editor.on('network', refresh);
  refresh();
  return { refresh };
}
