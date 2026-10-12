/* ============================================================================
   App — the editor shell: layout, viewport interaction, shortcuts, exports.
   ========================================================================== */

import * as THREE from 'three';
import { h, $, fmtInt, icon } from './widgets.js';
import { createMenubar, createToolbar, createStatusBar, createOverlays } from './Chrome.js';
import { createLibrary, createInspector, createGeneratePanel, createOutliner } from './Panels.js';
import { createExporter } from './ExporterUI.js';
import { RoadNetwork } from '../model/RoadGraph.js';
import { PRESET_BY_ID } from '../model/Presets.js';
import { clamp } from '../core/mathx.js';

export function createApp({ scene, renderer, canvas, camera, cameraCtrl, editor, materials }) {
  const app = {};
  let wire = false, showHUD = true, topMode = false;

  /* ---------------------------------------------------------- top camera -- */
  const orthoCam = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 6000);
  orthoCam.position.set(0, 800, 0);
  orthoCam.lookAt(0, 0, 0);
  let topZoom = 260;
  let topCenter = new THREE.Vector3(0, 0, 0);
  const updateOrtho = () => {
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const v = topZoom;
    orthoCam.left = -v * aspect; orthoCam.right = v * aspect;
    orthoCam.top = v; orthoCam.bottom = -v;
    orthoCam.position.set(topCenter.x, 1200, topCenter.z + 0.001);
    orthoCam.lookAt(topCenter.x, 0, topCenter.z);
    orthoCam.updateProjectionMatrix();
  };

  Object.defineProperty(app, 'camera', { get: () => (topMode ? orthoCam : camera) });

  /* ------------------------------------------------------------- layout -- */
  const viewport = h('div', { class: 'viewport-wrap' });
  viewport.appendChild(canvas);

  const leftPanel = h('div', { class: 'panel left' });
  const rightPanel = h('div', { class: 'panel right' });

  const libSect = { root: h('div', { class: 'sect scroll', style: { flex: '1 1 40%' } }) };
  libSect.root.appendChild(h('div', { class: 'sect-head' },
    h('span', { class: 'caret', html: icon('caret').innerHTML }),
    h('span', { class: 'title' }, 'Road Library'),
    h('span', { class: 'aux' }, `${Object.keys(PRESET_BY_ID).length}`)));
  const libBody = h('div', { class: 'sect-body', style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column' } });
  libSect.root.appendChild(libBody);
  libSect.root.querySelector('.sect-head').addEventListener('click', () => libSect.root.classList.toggle('collapsed'));

  const genSect = h('div', { class: 'sect collapsed' });
  const genHead = h('div', { class: 'sect-head' },
    h('span', { class: 'caret', html: icon('caret').innerHTML }),
    h('span', { class: 'title' }, 'City Generator'),
    h('span', { class: 'aux' }, 'procedural'));
  const genBody = h('div', { class: 'sect-body', style: { maxHeight: '48vh', overflowY: 'auto' } });
  genSect.appendChild(genHead); genSect.appendChild(genBody);
  genHead.addEventListener('click', () => genSect.classList.toggle('collapsed'));

  const outSect = h('div', { class: 'sect', style: { flex: '0 0 auto', maxHeight: '210px', display: 'flex', flexDirection: 'column' } });
  const outHead = h('div', { class: 'sect-head' },
    h('span', { class: 'caret', html: icon('caret').innerHTML }),
    h('span', { class: 'title' }, 'Outliner'),
    h('span', { class: 'aux', id: 'out-count' }, '—'));
  const outBody = h('div', { class: 'sect-body', style: { flex: '1', minHeight: '0', display: 'flex', flexDirection: 'column', padding: '0' } });
  outSect.appendChild(outHead); outSect.appendChild(outBody);
  outHead.addEventListener('click', () => outSect.classList.toggle('collapsed'));

  leftPanel.appendChild(libSect.root);
  leftPanel.appendChild(genSect);
  leftPanel.appendChild(outSect);

  const inspHead = h('div', { class: 'sect-head' },
    h('span', { class: 'title' }, 'Inspector'),
    h('span', { class: 'aux', id: 'insp-aux' }, '—'));
  const inspBody = h('div', { class: 'sect-body', style: { flex: '1', minHeight: '0', overflowY: 'auto', padding: '0' } });
  rightPanel.appendChild(inspHead);
  rightPanel.appendChild(inspBody);

  const gutterL = h('div', { class: 'gutter' });
  const gutterR = h('div', { class: 'gutter' });

  const workspace = h('div', { class: 'workspace' },
    leftPanel, gutterL, viewport, gutterR, rightPanel);

  const menuHost = h('div', {});
  const toolHost = h('div', {});
  const statusHost = h('div', {});

  const rootEl = document.getElementById('app');
  rootEl.appendChild(menuHost);
  rootEl.appendChild(toolHost);
  rootEl.appendChild(workspace);
  rootEl.appendChild(statusHost);

  /* -------------------------------------------------------------- panels -- */
  const overlays = createOverlays(viewport, editor, app);
  const library = createLibrary(libBody, editor);
  const inspector = createInspector(inspBody, editor);
  const generator = createGeneratePanel(genBody, editor);
  const outliner = createOutliner(outBody, editor);
  const exporter = createExporter(editor, app);
  const menubar = createMenubar(menuHost, editor, app);
  const toolbar = createToolbar(toolHost, editor, app);
  const statusbar = createStatusBar(statusHost, editor, app);

  /* ------------------------------------------------------------- gutters -- */
  function bindGutter(gutter, panel, side) {
    let dragging = false, startX = 0, startW = 0;
    gutter.addEventListener('pointerdown', (e) => {
      dragging = true; startX = e.clientX; startW = panel.getBoundingClientRect().width;
      gutter.setPointerCapture(e.pointerId);
      gutter.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });
    gutter.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const d = e.clientX - startX;
      const w = clamp(startW + (side === 'left' ? d : -d), 180, 520);
      panel.style.flex = `0 0 ${w}px`;
      panel.style.width = `${w}px`;
      app.onResize?.();
    });
    const stop = (e) => {
      if (!dragging) return;
      dragging = false;
      try { gutter.releasePointerCapture(e.pointerId); } catch {}
      gutter.classList.remove('dragging');
      document.body.style.cursor = '';
      app.onResize?.();
    };
    gutter.addEventListener('pointerup', stop);
    gutter.addEventListener('pointercancel', stop);
  }
  bindGutter(gutterL, leftPanel, 'left');
  bindGutter(gutterR, rightPanel, 'right');

  /* ------------------------------------------------------------ viewport -- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let dragNode = null;
  let dragMoved = false;
  let panning = false;
  let lastPointer = { x: 0, y: 0 };

  const toPointer = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  };

  canvas.addEventListener('pointermove', (e) => {
    toPointer(e);
    const r = canvas.getBoundingClientRect();
    const dx = e.clientX - lastPointer.x, dy = e.clientY - lastPointer.y;
    lastPointer = { x: e.clientX, y: e.clientY };

    if (topMode && panning) {
      const scale = (topZoom * 2) / r.height;
      topCenter.x -= dx * scale;
      topCenter.z -= dy * scale / Math.cos(0);
      updateOrtho();
      return;
    }

    if (dragNode) {
      dragMoved = true;
      raycaster.setFromCamera(pointer, app.camera);
      const p = editor.groundPoint(raycaster);
      if (p) {
        const g = editor.snapping.gridSize;
        let x = p.x, z = p.z;
        if (editor.snapping.grid && !e.altKey) { x = Math.round(x / g) * g; z = Math.round(z / g) * g; }
        editor.moveNode(dragNode, x, z);
        editor.refreshHelpers();
      }
      return;
    }

    // hover highlight (throttled by frame budget in the render loop)
    if (editor.tool !== 'draw') {
      raycaster.setFromCamera(pointer, app.camera);
      const hit = editor.pick(raycaster, app.camera);
      const id = hit && (hit.type === 'edge' || hit.type === 'node') ? hit.id : null;
      if (id !== editor.hover?.id) {
        editor.hover = hit;
        editor.refreshHelpers();
        const r2 = hit?.point;
        overlays.setReadout(r2 ? `X ${r2.x.toFixed(1)}  Z ${r2.z.toFixed(1)}  Y ${r2.y.toFixed(1)}` : '—');
      }
    } else {
      const p = editor.groundPoint(raycaster.setFromCamera(pointer, app.camera) || raycaster);
      if (p) overlays.setReadout(`X ${p.x.toFixed(1)}  Z ${p.z.toFixed(1)}`);
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 2 || e.button === 1) return; // camera handles these
    toPointer(e);
    lastPointer = { x: e.clientX, y: e.clientY };
    raycaster.setFromCamera(pointer, app.camera);

    if (topMode) {
      if (e.button === 0) {
        panning = true;
        canvas.setPointerCapture(e.pointerId);
        const hit = editor.pick(raycaster, app.camera);
        if (hit && hit.type === 'node') { editor.select([hit.id], e.shiftKey); }
        else if (hit && hit.type === 'edge') { editor.select([hit.id], e.shiftKey); }
      }
      return;
    }

    const hit = editor.pick(raycaster, app.camera);
    if (hit && hit.type === 'node' && editor.tool === 'select') {
      dragNode = hit.id;
      dragMoved = false;
      editor.pushHistory();
      editor.select([hit.id], e.shiftKey);
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
      return;
    }
    editor.handleClick(raycaster, app.camera, { additive: e.shiftKey, alt: e.altKey });
    editor.refreshHelpers();
  });

  const endPointer = (e) => {
    if (dragNode) {
      if (dragMoved) editor.emit('inspector');
      dragNode = null;
      try { canvas.releasePointerCapture(e.pointerId); } catch {}
    }
    panning = false;
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  canvas.addEventListener('dblclick', () => {
    if (editor.tool === 'draw') editor.finishDraw(false);
  });

  /* ------------------------------------------------------------ keyboard -- */
  const onKey = (e) => {
    if (e.target && /input|select|textarea/i.test(e.target.tagName)) return;
    const meta = e.metaKey || e.ctrlKey;
    const k = e.key;

    if (meta) {
      switch (k.toLowerCase()) {
        case 'z': e.preventDefault(); e.shiftKey ? editor.redo() : editor.undo(); return;
        case 'y': e.preventDefault(); editor.redo(); return;
        case 'a': e.preventDefault(); editor.selectAll(); return;
        case 'd': e.preventDefault(); duplicateSelection(); return;
        case 's': e.preventDefault(); app.saveFile(); return;
        case 'r': e.preventDefault(); editor.markAllDirty(); app.toast('Rebuilding world', 'ok'); return;
        default: return;
      }
    }
    if (e.altKey) {
      if (k === '1') { app.setView('persp'); e.preventDefault(); return; }
      if (k === '2') { app.setView('top'); e.preventDefault(); return; }
      return;
    }

    switch (k) {
      case 'Delete': case 'Backspace': e.preventDefault(); editor.deleteSelection(); break;
      case 'Escape':
        if (editor.tool === 'draw' && editor.drawChain.length) editor.cancelDraw();
        else if (editor.tool !== 'select') editor.setTool('select');
        else editor.clearSelection();
        break;
      case 'Enter': e.preventDefault(); editor.finishDraw(e.shiftKey); break;
      case '1': editor.setTool('select'); break;
      case '2': editor.setTool('draw'); break;
      case '3': editor.setTool('node'); break;
      case '4': editor.setTool('paint'); break;
      case 'f': case 'F': app.frameSelection(); break;
      case 'Home': app.frameAll(); break;
      case 'g': case 'G': app.toggleGrid(); break;
      case 'j': case 'J': app.toggleHelpers(); break;
      case 'k': case 'K': app.toggleHUD(); break;
      case 'h': case 'H': app.toggleNavHelp(); break;
      default: break;
    }
  };
  window.addEventListener('keydown', onKey);

  /* ------------------------------------------------------------- actions -- */

  function duplicateSelection() {
    const ids = [...editor.selection.edges];
    if (!ids.length) return;
    editor.pushHistory();
    const off = 14;
    const newIds = [];
    for (const id of ids) {
      const e = editor.net.edges.get(id);
      if (!e) continue;
      const A = editor.net.nodes.get(e.a), B = editor.net.nodes.get(e.b);
      if (!A || !B) continue;
      const na = editor.net.addNode(A.x + off, A.y, A.z + off);
      const nb = editor.net.addNode(B.x + off, B.y, B.z + off);
      const ne = editor.net.addEdge(na.id, nb.id, {
        pts: e.pts.map((p) => ({ x: p.x + off, z: p.z + off })),
        preset: e.preset,
        bands: e.bands ? e.bands.map((b) => ({ ...b })) : null,
        features: e.features,
        name: e.name ? `${e.name} copy` : '',
        camber: e.camber, markStyle: e.markStyle,
      });
      newIds.push(ne.id);
      editor.markDirty([ne.id]);
    }
    editor.select(newIds);
    app.toast(`Duplicated ${newIds.length} segment${newIds.length === 1 ? '' : 's'}`, 'ok');
  }

  app.duplicateSelection = duplicateSelection;

  app.toast = (msg, kind = '') => overlays.toast(msg, kind);

  app.setView = (which) => {
    topMode = which === 'top';
    cameraCtrl.enabled = !topMode;
    toolbar.setToggle('grid', editor.showGrid);
    if (topMode) {
      const c = cameraCtrl.position;
      topCenter.set(c.x, 0, c.z);
      updateOrtho();
      app.toast('Top · orthographic plan — drag to pan, wheel to zoom');
    } else {
      app.toast('Perspective — hold RMB + WASD to fly');
    }
    app.onResize?.();
  };

  app.frameSelection = () => {
    const box = new THREE.Box3();
    let any = false;
    for (const id of editor.selection.edges) {
      const e = editor.net.edges.get(id);
      const c = e?.curve(editor.net);
      if (!c) continue;
      const b = c.bounds();
      box.expandByPoint(new THREE.Vector3(b.mnx, 0, b.mny));
      box.expandByPoint(new THREE.Vector3(b.mxx, 0, b.mxy));
      any = true;
    }
    for (const id of editor.selection.nodes) {
      const n = editor.net.nodes.get(id);
      if (n) { box.expandByPoint(new THREE.Vector3(n.x, n.y, n.z)); any = true; }
    }
    if (!any) { app.frameAll(); return; }
    box.expandByScalar(6);
    if (topMode) {
      box.getCenter(topCenter);
      const size = box.getSize(new THREE.Vector3());
      topZoom = Math.max(20, Math.max(size.x, size.z) * 0.62);
      updateOrtho();
    } else {
      cameraCtrl.frame(box);
      const t = cameraCtrl.frameTarget;
      if (t) cameraCtrl.position.copy(t);
      cameraCtrl.clearFrameTarget();
    }
  };

  app.frameAll = () => {
    const b = editor.net.bounds();
    const box = new THREE.Box3(
      new THREE.Vector3(b.mnx, -20, b.mnz),
      new THREE.Vector3(b.mxx, 60, b.mxz),
    );
    if (topMode) {
      box.getCenter(topCenter);
      const size = box.getSize(new THREE.Vector3());
      topZoom = Math.max(30, Math.max(size.x, size.z) * 0.58);
      updateOrtho();
    } else {
      cameraCtrl.frame(box);
      const t = cameraCtrl.frameTarget;
      if (t) cameraCtrl.position.copy(t);
      cameraCtrl.clearFrameTarget();
    }
  };

  app.toggleGrid = () => {
    editor.showGrid = !editor.showGrid;
    editor.grid.visible = editor.showGrid && !topMode;
    toolbar.setToggle('grid', editor.showGrid);
  };
  app.toggleWire = () => {
    wire = !wire;
    for (const m of materials.values()) {
      if (m.isMeshStandardMaterial) { m.wireframe = wire; m.needsUpdate = true; }
    }
    toolbar.setToggle('wire', wire);
  };
  app.toggleHelpers = () => {
    editor.showHelpers = !editor.showHelpers;
    editor.refreshHelpers();
    toolbar.setToggle('helpers', editor.showHelpers);
  };
  app.toggleHUD = () => { showHUD = !showHUD; overlays.setVisible(showHUD); };
  app.toggleNavHelp = () => overlays.toggleNav();
  app.showGenerate = () => { genSect.classList.remove('collapsed'); app.toast('City generator ready'); };
  app.showLibrary = () => { libSect.root.classList.remove('collapsed'); };
  app.showReference = () => exporter.showReference();
  app.regenerate = () => generator.runOnce();
  app.nudgeSpeed = (f) => {
    cameraCtrl.setSpeed(cameraCtrl.speedScale * f);
    toolbar.setSpeed(cameraCtrl.baseSpeed * cameraCtrl.speedScale);
  };
  app.setDirty = () => {};

  app.saveFile = () => exporter.saveJSON();
  app.openFile = () => exporter.openFile((json) => {
    const restored = RoadNetwork.fromJSON(json);
    editor._suspendHistory = true;
    editor.net.nodes = restored.nodes;
    editor.net.edges = restored.edges;
    editor.net.ground = restored.ground;
    editor.net._adj = null;
    for (const e of editor.net.edges.values()) e.invalidate();
    editor._suspendHistory = false;
    editor.clearSelection();
    editor.markAllDirty();
    editor.pushHistory('import');
    app.toast(`Loaded ${editor.net.edges.size} segments`, 'ok');
  });
  app.exportGLTF = () => exporter.exportGLTF(editor.world);
  app.exportOBJ = () => exporter.exportOBJ(editor.world);
  app.exportCSV = () => exporter.exportCSV(editor.net);

  /* ------------------------------------------------------------- events -- */
  editor.on('generatedStats', (st) => {
    overlays.setInfo(infoHTML(st));
  });
  editor.on('network', () => {
    const st = editor.net.stats();
    $('#out-count', outSect).textContent = `${fmtInt(st.edges)}`;
    const n = editor.selection.edges.size + editor.selection.nodes.size;
    $('#insp-aux', rightPanel).textContent = n ? `${n} sel` : '—';
  });
  editor.on('selection', () => {
    const n = editor.selection.edges.size + editor.selection.nodes.size;
    $('#insp-aux', rightPanel).textContent = n ? `${n} sel` : '—';
    editor.refreshHelpers();
  });
  editor.on('focusSelection', () => app.frameSelection());
  editor.on('inspector', () => editor.refreshHelpers());

  function infoHTML(st) {
    const o = editor.lastGenStats?.opts || {};
    return `<div class="row"><span class="k">network</span><span class="v"><b>${fmtInt(st.edges)}</b> seg</span></div>`
      + `<div class="row"><span class="k">junctions</span><span class="v"><b>${fmtInt(st.nodes)}</b></span></div>`
      + `<div class="row"><span class="k">carriageway</span><span class="v"><b>${st.km.toFixed(1)}</b> km</span></div>`
      + `<div class="row"><span class="k">pattern</span><span class="v">${o.pattern || '—'} · ${o.extent ? `${(o.extent / 1000).toFixed(1)}km` : ''}</span></div>`
      + `<div class="row"><span class="k">seed</span><span class="v">${o.seed ?? '—'}</span></div>`;
  }

  /* ------------------------------------------------------------- update -- */
  app.update = (dt) => {
    statusbar.update(dt);
    overlays.pushFrame(dt * 1000);
    overlays.setHeading(cameraCtrl.yaw + Math.PI);
    const sp = cameraCtrl.currentSpeed();
    toolbar.setSpeed(sp);
  };

  app.onResize = () => {
    const w = canvas.clientWidth || 1, hgt = canvas.clientHeight || 1;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    updateOrtho();
  };

  app.isTop = () => topMode;
  app.updateOrtho = updateOrtho;
  app.setTopCenter = (v) => { topCenter.copy(v); updateOrtho(); };
  app.setTopZoom = (v) => { topZoom = clamp(v, 8, 6000); updateOrtho(); };
  app.getTopZoom = () => topZoom;
  app.getTopCenter = () => topCenter;

  overlays.setInfo(infoHTML(editor.net.stats()));

  return app;
}
