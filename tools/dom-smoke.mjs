/* DOM smoke test — builds the entire editor UI in jsdom with a stubbed 2D
   canvas, and drives the main interactions. Catches crashes, missing exports
   and undefined references without needing a real browser.

   Run:  node tools/dom-smoke.mjs        (requires: npm i --no-save jsdom)  */

import { JSDOM, VirtualConsole } from 'jsdom';

// uncaught exceptions inside DOM event listeners surface as jsdomError events;
// without this they scroll past silently and look like a pass
const jsdomErrors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => { jsdomErrors.push(e); console.log(`  JSDOM ERROR  ${e.detail?.message || e.message}`); });
vc.on('error', (...a) => { jsdomErrors.push(a.join(' ')); console.log(`  CONSOLE ERROR  ${a.join(' ')}`); });

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
  virtualConsole: vc,
});
const { window } = dom;

/* --- stub the 2D canvas context; jsdom has no rasteriser --- */
const ctx2d = new Proxy({}, {
  get(_t, k) {
    if (k === 'canvas') return { width: 300, height: 150 };
    if (k === 'measureText') return () => ({ width: 10 });
    if (k === 'createImageData') return (w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (k === 'getImageData') return (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4), width: w, height: h });
    if (k === 'createLinearGradient' || k === 'createRadialGradient') {
      return () => ({ addColorStop() {} });
    }
    if (k === 'putImageData') return () => {};
    return () => {};
  },
  set() { return true; },
});
window.HTMLCanvasElement.prototype.getContext = function (kind) {
  return kind === '2d' ? ctx2d : null;
};
window.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/png;base64,';
window.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };

globalThis.window = window;
globalThis.document = window.document;
try { Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true }); } catch {}
globalThis.HTMLElement = window.HTMLElement;
globalThis.Node = window.Node;
globalThis.ImageData = window.ImageData;
globalThis.ResizeObserver = window.ResizeObserver;
globalThis.requestAnimationFrame = window.requestAnimationFrame;
globalThis.cancelAnimationFrame = window.cancelAnimationFrame;
globalThis.devicePixelRatio = 1;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.Blob = window.Blob;
globalThis.URL = window.URL;
// jsdom ships no object-URL plumbing and no navigation; both are irrelevant here
window.URL.createObjectURL = () => 'blob:stub';
window.URL.revokeObjectURL = () => {};
window.HTMLAnchorElement.prototype.click = function () {};
window.HTMLElement.prototype.scrollIntoView = function () {};
const _clicks = { n: 0 };
window.HTMLInputElement.prototype.click = function () { _clicks.n++; };

const THREE = await import('three');
const { Editor } = await import('../src/core/Editor.js');
const { CameraController } = await import('../src/core/CameraController.js');
const { createApp } = await import('../src/ui/App.js');
const { generateCity } = await import('../src/gen/CityGenerator.js');

let fails = 0;
const ok = (n, c, x = '') => { if (!c) { fails++; console.log(`  FAIL  ${n} ${x}`); } else console.log(`  ok    ${n} ${x}`); };

/* ------------------------------------------------------------- fake GL ---- */
const fakeMaterials = new Map();
const fakeRenderer = { setSize() {}, render() {}, setPixelRatio() {}, domElement: null };

console.log('\n[1] bootstrap');
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1.6, 0.25, 30000);
const canvas = window.document.createElement('canvas');
canvas.className = 'viewport';

// a minimal material stand-in (real ones need textures + a GL context)
const SURF_KEYS = ['asphalt', 'concrete', 'kerb', 'paint_w', 'paint_y', 'symbol', 'ground', 'steel', 'galv',
  'rubber', 'ballast', 'planting', 'sett', 'paver', 'cobble', 'grass', 'tile', 'gravel', 'dirt', 'brick',
  'sleeper', 'concrete_brushed', 'asphalt_red', 'asphalt_green', 'asphalt_blue', 'asphalt_fine',
  'asphalt_coarse', 'paint_r', 'paint_g', 'paint_b', 'chequer',
  'prop:metal', 'prop:metalDark', 'prop:white', 'prop:red', 'prop:yellow', 'prop:trunk', 'prop:leaf', 'prop:crete',
  'helper:select', 'helper:hover', 'helper:node', 'helper:nodeSel'];
for (const k of SURF_KEYS) fakeMaterials.set(k, new THREE.MeshStandardMaterial({ name: k }));

const editor = new Editor({ scene, renderer: fakeRenderer, camera, materials: fakeMaterials });
ok('editor constructed', !!editor.net);

const cameraCtrl = new CameraController(camera, canvas, { getGroundY: () => 0 });
ok('camera controller', !!cameraCtrl);

console.log('\n[2] build the UI');
let app;
try {
  app = createApp({ scene, renderer: fakeRenderer, canvas, camera, cameraCtrl, editor, materials: fakeMaterials });
  ok('createApp', !!app);
} catch (e) {
  fails++; console.log(`  FAIL  createApp threw: ${e.message}\n${e.stack?.split('\n').slice(0, 6).join('\n')}`);
  process.exit(1);
}

const q = (s) => window.document.querySelector(s);
ok('menubar rendered', !!q('.menubar'), `${window.document.querySelectorAll('.menu-item').length} menus`);
ok('toolbar rendered', !!q('.toolbar'));
ok('mode strip', window.document.querySelectorAll('.mode-strip .tbtn').length === 4);
ok('library presets', window.document.querySelectorAll('.preset').length > 20,
  `${window.document.querySelectorAll('.preset').length} presets`);
ok('inspector empty state', !!q('.empty-state'));
ok('status bar', !!q('.statusbar'));
ok('overlays', !!q('#navhelp') && !!q('.compass'));
ok('generator panel', !!q('.sect.collapsed'));

console.log('\n[3] generate a city through the panel');
const genBtn = [...window.document.querySelectorAll('.btn')].find(
  (b) => b.textContent === 'Generate City' && b.classList.contains('primary'));
ok('generate button exists', !!genBtn);
genBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
const st = editor.net.stats();
ok('city generated', st.edges > 50, `${st.edges} edges · ${st.km.toFixed(1)} km`);

console.log('\n[4] selection + inspector');
const ids = [...editor.net.edges.keys()];
editor.select([ids[0]]);
await new Promise((r) => setTimeout(r, 10));
ok('cross-section canvas', !!window.document.querySelector('#xsCanvas'));
const laneRows = window.document.querySelectorAll('.lane-row');
ok('lane list', laneRows.length > 0, `${laneRows.length} bands`);

// select a band and make sure the band property panel appears
laneRows[1]?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
await new Promise((r) => setTimeout(r, 10));
ok('band props', window.document.querySelectorAll('.sect').length > 4);

console.log('\n[5] tools');
for (const t of ['draw', 'node', 'paint', 'select']) {
  editor.setTool(t);
  ok(`tool ${t}`, editor.tool === t);
}

console.log('\n[6] editing operations');
const before = editor.net.edges.size;
if (ids.length < 3) { console.log('  FAIL  not enough edges to edit'); process.exit(1); }
editor.select([ids[1], ids[2]]);
editor.pushHistory();
editor.applyBands([{ k: 'sidewalk', w: 2, s: 'concrete', h: 0.15 }, { k: 'driving', w: 6, s: 'asphalt', dir: 0 }]);
ok('applyBands', editor.net.edges.get(ids[1]).bands.length === 2);
editor.undo();
ok('undo', editor.net.edges.size === before || !!editor.net.edges.get(ids[1]));
editor.redo();
ok('redo', !!editor.net.edges.get(ids[1]));

editor.setTerrain(18);
const gy = editor.terrain.height(120, 80);
ok('terrain', Math.abs(gy) > 0.01, `h(120,80)=${gy.toFixed(2)}`);
editor.setTerrain(0);

console.log('\n[7] view actions');
app.setView('top'); ok('top view', app.isTop() === true);
app.setView('persp'); ok('persp view', app.isTop() === false);
app.frameAll(); ok('frameAll', true);
editor.select(ids.slice(0, 5));
app.frameSelection(); ok('frameSelection', true);
app.toggleGrid(); app.toggleWire(); app.toggleHelpers(); app.toggleHUD();
app.toggleGrid(); app.toggleWire(); app.toggleHelpers(); app.toggleHUD();
ok('toggles', true);

console.log('\n[8] picking');
{
  const ray = new THREE.Raycaster();
  const A = editor.net.nodes.get(editor.net.edges.get(ids[0]).a);
  ray.set(new THREE.Vector3(A.x, 300, A.z), new THREE.Vector3(0, -1, 0));
  const hit = editor.pick(ray, camera);
  ok('pick finds something', !!hit, hit ? `${hit.type} ${hit.id}` : 'none');
  const t0 = performance.now();
  for (let i = 0; i < 40; i++) {
    ray.set(new THREE.Vector3((i % 7) * 60 - 200, 300, Math.floor(i / 7) * 60 - 200), new THREE.Vector3(0, -1, 0));
    editor.pick(ray, camera);
  }
  ok('pick is fast', (performance.now() - t0) / 40 < 6, `${((performance.now() - t0) / 40).toFixed(2)} ms/pick`);
}

console.log('\n[9] app.update loop');
{
  const t0 = performance.now();
  for (let i = 0; i < 60; i++) {
    cameraCtrl.update(1 / 60);
    editor.update(1 / 60, cameraCtrl.position);
    app.update(1 / 60);
  }
  ok('60 frames', true, `${(performance.now() - t0).toFixed(0)} ms · ${editor.world.stats.tiles} tiles built`);
}

console.log('\n[10] keyboard');
{
  const kd = (key, opts = {}) => {
    const e = new window.KeyboardEvent('keydown', { key, bubbles: true, ...opts });
    window.dispatchEvent(e);
  };
  kd('2'); ok('key 2 -> draw', editor.tool === 'draw');
  kd('Escape'); ok('escape -> select', editor.tool === 'select');
  kd('g'); kd('j'); kd('k'); kd('h');
  kd('Home'); kd('f');
  ok('keys safe', true);
}

console.log('\n[11] menu bar + toolbar');
{
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const menus = [...window.document.querySelectorAll('.menubar .menu-item')];
  const openMenu = (m) => m.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true }));
  let opened = 0;
  for (const m of menus) { openMenu(m); if (window.document.querySelector('.menu-pop')) opened++; }
  ok('all menus open', opened >= 5, `${opened}/${menus.length} menus`);

  // click every enabled entry in every dropdown (each click closes the pop)
  let acted = 0, threw = null;
  for (const m of [...menus]) {
    openMenu(m);
    const rows = [...window.document.querySelectorAll('.menu-pop .mi')];
    for (const it of rows) {
      if (it.classList.contains('disabled')) continue;
      try { click(it); acted++; } catch (e) { threw = e; break; }
      if (threw) break;
      openMenu(m);
    }
    if (threw) break;
  }
  ok('menu actions run', !threw && acted > 20, threw ? threw.message : `${acted} actions`);

  const tb = [...window.document.querySelectorAll('.toolbar .tbtn')];
  for (const b of tb) { try { click(b); } catch (e) { threw = e; } }
  ok('toolbar buttons run', !threw, threw ? threw.message : `${tb.length} buttons`);
  editor.setTool('select');
}

console.log('\n[12] export + reference');
{
  try {
    app.saveFile();
    ok('saveFile (JSON)', true);
  } catch (e) { ok('saveFile (JSON)', false, e.message); }
  try {
    app.exportCSV();
    ok('exportCSV', true);
  } catch (e) { ok('exportCSV', false, e.message); }
  try {
    app.showReference();
    await new Promise((r) => setTimeout(r, 30));
    const rows = window.document.querySelectorAll('.modal .kv-table tr').length;
    ok('reference modal', rows > 10, `${rows} rows`);
    const closeBtn = [...window.document.querySelectorAll('.modal .btn, .modal .modal-x')]
      .find((b) => /close/i.test(b.textContent) || b.classList.contains('modal-x'));
    if (closeBtn) closeBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    ok('modal closes', !window.document.querySelector('.modal.open') || !!closeBtn);
  } catch (e) { ok('reference modal', false, e.message); }
  try {
    editor.select([]);
    app.openFile();
    ok('openFile dialog', _clicks.n > 0);
  } catch (e) { ok('openFile dialog', false, e.message); }
}

console.log('\n[13] cross-section editor interactions');
{
  const ids2 = [...editor.net.edges.keys()];
  editor.select([ids2[3]]);
  await new Promise((r) => setTimeout(r, 10));
  const rows = [...window.document.querySelectorAll('.lane-row')];
  let threw = null;
  for (const r of rows) { try { r.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); } catch (e) { threw = e; } }
  ok('select every band', !threw, threw ? threw.message : `${rows.length} bands`);

  const inputs = [...window.document.querySelectorAll('.panel.right input, .panel.right select')];
  let changed = 0;
  for (const el of inputs.slice(0, 40)) {
    try {
      if (el.type === 'checkbox') { el.checked = !el.checked; el.dispatchEvent(new window.Event('change', { bubbles: true })); }
      else if (el.tagName === 'SELECT') { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new window.Event('change', { bubbles: true })); }
      else { el.value = String(Number(el.value) || 3); el.dispatchEvent(new window.Event('change', { bubbles: true })); el.dispatchEvent(new window.Event('input', { bubbles: true })); }
      changed++;
    } catch (e) { threw = e; break; }
  }
  ok('inspector controls', !threw, threw ? threw.message : `${changed} controls`);

  // cross-section drag: nudge a band boundary
  const xs = window.document.querySelector('#xsCanvas');
  if (xs) {
    const r = { left: 0, top: 0, width: 340, height: 190 };
    xs.getBoundingClientRect = () => ({ ...r, right: r.width, bottom: r.height, x: 0, y: 0, toJSON() {} });
    const md = new window.MouseEvent('mousedown', { bubbles: true, clientX: 170, clientY: 95 });
    try {
      xs.dispatchEvent(md);
      window.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: 210, clientY: 95 }));
      window.dispatchEvent(new window.MouseEvent('mouseup', { bubbles: true, clientX: 210, clientY: 95 }));
      ok('cross-section drag', true);
    } catch (e) { ok('cross-section drag', false, e.message); }
  } else ok('cross-section drag', false, 'no canvas');
}

console.log('\n[14] outliner + library');
{
  const rows = [...window.document.querySelectorAll('.ot-row')];
  let threw = null;
  for (const r of rows.slice(0, 25)) {
    try { r.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); } catch (e) { threw = e; break; }
  }
  ok('outliner rows', !threw, threw ? threw.message : `${rows.length} rows clicked`);

  const presets = [...window.document.querySelectorAll('.preset')];
  let applied = 0;
  const ids3 = [...editor.net.edges.keys()];
  editor.select([ids3[10]]);
  for (const p of presets.slice(0, 12)) {
    try { p.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); applied++; } catch (e) { threw = e; break; }
  }
  ok('preset application', !threw, threw ? threw.message : `${applied} presets`);

  const search = window.document.querySelector('.lib-search input, input.lib-search');
  if (search) {
    search.value = 'boulevard';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
    ok('library search', true);
    search.value = '';
    search.dispatchEvent(new window.Event('input', { bubbles: true }));
  } else ok('library search', false, 'no input');
}

console.log('\n[15] teardown');
{
  let threw = null;
  try {
    editor.select([]);
    app.toggleHUD(); app.toggleHUD();
    app.setView('top'); app.update(1 / 60); app.setView('persp'); app.update(1 / 60);
    app.onResize();
    editor.clearNetwork ? editor.clearNetwork() : editor.net.clear();
    await new Promise((r) => setTimeout(r, 20));
    app.update(1 / 60);
  } catch (e) { threw = e; }
  ok('clear + resize safe', !threw, threw ? threw.message : `${editor.net.edges.size} edges left`);
}

if (jsdomErrors.length) { fails += jsdomErrors.length; console.log(`  FAIL  ${jsdomErrors.length} uncaught DOM error(s)`); }
else console.log('  ok    no uncaught DOM errors');

console.log(`\n${fails === 0 ? 'ALL PASS' : `${fails} FAILURE(S)`}\n`);
process.exit(fails ? 1 : 0);
