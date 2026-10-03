/* =====================================================================================================================
   Boots References/TyreGenerator.html in Node against the fake DOM and a three.js stand-in, then drives the interface
   the way a person would: press the editor button, draw, rename, duplicate, delete, close.

   This file exists because of a real defect. The 2D tread editor was fully built and fully wired, but the only way in
   was to select a polygon lug layer in the Layers card, and the preset the page opens on is a slick with no such
   layer. The editor was therefore unreachable from a cold start and looked missing. The checks below start from that
   same cold start.

   Clipper is deliberately absent, which is also the state of a browser that failed to reach the CDN — the page must
   still come up and the editor must still be reachable.
   Run:  node Scratchpad/TyreGeneratorChecks/check-page-boot.mjs
   ===================================================================================================================== */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import { makeDocument, FakeElement } from './fake-dom.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(resolve(here, '../../References/TyreGenerator.html'), 'utf8');

let passed = 0, failed = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { passed++; console.log(`  pass  ${label}${extra ? ' — ' + extra : ''}`); }
  else { failed++; console.log(`  FAIL  ${label}${extra ? ' — ' + extra : ''}`); }
};
const section = t => console.log(`\n${t}\n${'-'.repeat(t.length)}`);

// ------------------------------------------------------------------ three.js stand-in
const vec = (x = 0, y = 0, z = 0) => ({
  x, y, z, isVector: true,
  set(a, b, c) { this.x = a; this.y = b; this.z = c; return this; },
  setScalar(s) { this.x = this.y = this.z = s; return this; },
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; },
  clone() { return vec(this.x, this.y, this.z); },
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; },
  length() { return Math.hypot(this.x, this.y, this.z); },
  sub() { return this; }, add() { return this; }, normalize() { return this; },
  addScaledVector() { return this; }, subVectors() { return this; }, addVectors() { return this; },
  cross() { return this; }, crossVectors() { return this; }, dot() { return 0; }, negate() { return this; },
  applyQuaternion() { return this; }, applyMatrix4() { return this; }, lerp() { return this; },
  lerpVectors() { return this; }, distanceTo() { return 1; }, equals() { return false; },
  toArray() { return [this.x, this.y, this.z]; }, fromArray(a) { [this.x, this.y, this.z] = a; return this; }
});
class Obj3D {
  constructor() { this.children = []; this.position = vec(); this.rotation = vec(); this.scale = vec(1, 1, 1); this.userData = {}; this.visible = true; }
  add(...c) { this.children.push(...c); return this; }
  remove(...c) { this.children = this.children.filter(x => !c.includes(x)); return this; }
  clear() { this.children = []; return this; }
  traverse(fn) { fn(this); for (const c of this.children) c.traverse ? c.traverse(fn) : fn(c); }
  clone() { const o = new Obj3D(); o.children = this.children.slice(); return o; }
  lookAt() { } updateMatrixWorld() { } getWorldPosition() { return vec(); }
  translateX() { return this; } translateY() { return this; } translateZ() { return this; }
  rotateX() { return this; } rotateY() { return this; } rotateZ() { return this; }
}
const Mat = class { constructor(o = {}) { Object.assign(this, o); this.isMaterial = true; } dispose() { } };
const Geo = class {
  constructor() { this.attributes = {}; this.userData = {}; this.groups = []; }
  setAttribute(k, v) { this.attributes[k] = v; return this; }
  getAttribute(k) { return this.attributes[k]; }
  setIndex(i) { this.index = { count: i.length, array: i }; return this; }
  addGroup(a, b, c) { this.groups.push([a, b, c]); }
  computeVertexNormals() { } computeBoundingSphere() { } dispose() { }
  translate() { return this; } rotateX() { return this; } rotateY() { return this; } rotateZ() { return this; }
  applyMatrix4() { return this; }
};
const THREE = {
  Scene: class extends Obj3D { constructor() { super(); this.background = null; this.environment = null; } },
  Group: class extends Obj3D { },
  Mesh: class extends Obj3D { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isMesh = true; } },
  LineSegments: class extends Obj3D { constructor(g, m) { super(); this.geometry = g; this.material = m; this.isLineSegments = true; } },
  GridHelper: class extends Obj3D { constructor() { super(); this.material = new Mat(); } },
  PerspectiveCamera: class extends Obj3D { updateProjectionMatrix() { } },
  WebGLRenderer: class {
    constructor() { this.domElement = new FakeElement('canvas'); this.shadowMap = {}; this.toneMapping = 0; this.outputColorSpace = ''; }
    setSize() { } setPixelRatio() { } setClearColor() { } render() { } dispose() { }
    setAnimationLoop() { } getContext() { return {}; }
  },
  PMREMGenerator: class { fromScene() { return { texture: {} }; } compileEquirectangularShader() { } dispose() { } },
  DirectionalLight: class extends Obj3D { constructor() { super(); this.shadow = { mapSize: vec(), camera: { top: 0, bottom: 0, left: 0, right: 0, near: 0, far: 0 }, bias: 0, normalBias: 0 }; this.castShadow = false; this.target = new Obj3D(); } },
  HemisphereLight: class extends Obj3D { },
  AmbientLight: class extends Obj3D { },
  BufferGeometry: Geo, PlaneGeometry: Geo, BoxGeometry: Geo, CylinderGeometry: Geo, TorusGeometry: Geo, CircleGeometry: Geo,
  MeshStandardMaterial: Mat, MeshBasicMaterial: Mat, LineBasicMaterial: Mat, ShadowMaterial: Mat, MeshPhysicalMaterial: Mat,
  Float32BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; this.count = (a.length || 0) / n; } },
  BufferAttribute: class { constructor(a, n) { this.array = a; this.itemSize = n; this.count = (a.length || 0) / n; } },
  CanvasTexture: class { constructor(c) { this.image = c; this.wrapS = 0; this.wrapT = 0; this.anisotropy = 1; this.colorSpace = ''; this.flipY = true; } dispose() { } },
  Color: class {
    constructor(c) { this.r = 0.5; this.g = 0.5; this.b = 0.5; this.c = c; }
    set() { return this; } copy(o) { this.r = o.r; this.g = o.g; this.b = o.b; return this; } clone() { return new THREE.Color(this.c); }
    lerp() { return this; } multiply() { return this; } multiplyScalar() { return this; } add() { return this; } addScalar() { return this; }
    offsetHSL() { return this; } setHSL() { return this; } setRGB(r, g, b) { this.r = r; this.g = g; this.b = b; return this; }
    getHexString() { return '808080'; } getHex() { return 0x808080; } convertSRGBToLinear() { return this; } convertLinearToSRGB() { return this; }
  },
  Vector2: class { constructor(x = 0, y = 0) { this.x = x; this.y = y; } set(a, b) { this.x = a; this.y = b; return this; } },
  Vector3: class { constructor(x, y, z) { Object.assign(this, vec(x, y, z)); } },
  ShapeUtils: { triangulateShape: () => [] },
  RepeatWrapping: 1000, ClampToEdgeWrapping: 1001, SRGBColorSpace: 'srgb', NoColorSpace: '', LinearSRGBColorSpace: 'srgb-linear',
  ACESFilmicToneMapping: 4, PCFSoftShadowMap: 2, DoubleSide: 2, FrontSide: 0, BackSide: 1, EquirectangularReflectionMapping: 303,
  MathUtils: { lerp: (a, b, t) => a + (b - a) * t, clamp: (v, a, b) => Math.min(b, Math.max(a, v)), degToRad: d => d * Math.PI / 180 }
};
class OrbitControls { constructor() { this.target = vec(); this.enableDamping = false; } update() { } addEventListener() { } }
class RoomEnvironment { }
class GLTFExporter { parse(scene, done) { done(new ArrayBuffer(8)); } }

// ------------------------------------------------------------------ assemble the page
const bodyHtml = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'));
const document = makeDocument(bodyHtml);
const scripts = [...html.matchAll(/<script(?![^>]*src=)(?![^>]*importmap)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const coreSrc = scripts.find(s => s.includes('SlateTread'));
const moduleSrc = scripts.find(s => s.includes('const PRESETS')).replace(/^import[\s\S]*?from\s+'[^']*';?$/gm, '');

const windowStub = {
  document, devicePixelRatio: 1, innerWidth: 1600, innerHeight: 900,
  addEventListener: (type, fn) => { (windowStub._on[type] = windowStub._on[type] || []).push(fn); },
  removeEventListener: () => { }, _on: {},
  matchMedia: () => ({ matches: false, addEventListener: () => { } }),
  requestAnimationFrame: () => 0, cancelAnimationFrame: () => { },
  getComputedStyle: () => ({ getPropertyValue: () => '' })
};
const sandbox = {
  console, Math, JSON, Date, Set, Map, WeakMap, Array, Object, Number, String, Boolean, Error, RegExp, Promise, Symbol,
  isNaN, isFinite, parseFloat, parseInt, Infinity, NaN, undefined,
  Uint8Array, Uint8ClampedArray, Uint16Array, Uint32Array, Int32Array, Float32Array, Float64Array, ArrayBuffer,
  structuredClone, performance: { now: () => Date.now() },
  setTimeout: fn => 0, clearTimeout: () => { }, setInterval: () => 0, clearInterval: () => { },
  requestAnimationFrame: () => 0,
  URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => { } },
  Blob: class { constructor(parts) { this.parts = parts; } text() { return Promise.resolve(String(this.parts[0])); } },
  document, window: windowStub, navigator: { userAgent: 'node', clipboard: { writeText: () => Promise.resolve() } },
  devicePixelRatio: 1, innerWidth: 1600, innerHeight: 900, alert: () => { }, prompt: () => null, confirm: () => true,
  location: { href: 'file:///TyreGenerator.html', search: '' }, localStorage: { getItem: () => null, setItem: () => { } },
  addEventListener: windowStub.addEventListener, removeEventListener: () => { }, matchMedia: windowStub.matchMedia,
  getComputedStyle: windowStub.getComputedStyle, FileReader: class { readAsText() { } },
  Image: class { constructor() { this.width = 1; this.height = 1; } set src(v) { } },
  ResizeObserver: class { observe() { } unobserve() { } disconnect() { } },
  MutationObserver: class { observe() { } disconnect() { } },
  ImageData: class { constructor(a, b, c) { const n = typeof a === 'number'; this.width = n ? a : b; this.height = n ? b : c; this.data = n ? new Uint8ClampedArray(a * b * 4) : a; } },
  OffscreenCanvas: class { getContext() { return document.createElement('canvas').getContext('2d'); } },
  THREE, OrbitControls, RoomEnvironment, GLTFExporter
};
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
vm.createContext(sandbox);

section('Page boot without Clipper');
let bootError = null;
try { vm.runInContext(coreSrc, sandbox, { filename: 'tread-core.js' }); }
catch (e) { bootError = e; }
ok('the tread core script evaluates', !bootError, bootError ? bootError.message : 'window.SlateTread published');
ok('the tread library is exposed to the page', !!sandbox.window.SlateTread && sandbox.window.SlateTread.TREAD_LIBRARY.length >= 12,
  `${sandbox.window.SlateTread ? sandbox.window.SlateTread.TREAD_LIBRARY.length : 0} designs`);

let moduleError = null;
try { vm.runInContext(moduleSrc, sandbox, { filename: 'tyre-generator-module.js' }); }
catch (e) { moduleError = e; }
ok('the page module evaluates end to end', !moduleError,
  moduleError ? `${moduleError.message}\n        ${String(moduleError.stack).split('\n')[1] || ''}` : 'no exception');
if (moduleError) { console.log(`\n${passed}/${passed + failed} checks passed`); process.exit(1); }

// ------------------------------------------------------------------ is the editor reachable?
section('Reaching the tread editor from a cold start');
const $ = id => document.getElementById(id);
const P = vm.runInContext('P', sandbox), UI = vm.runInContext('UI', sandbox);
const PRESETS = vm.runInContext('PRESETS', sandbox);
ok('a pattern loaded on boot', !!P.name, `${P.name} (${P.type})`);

// The defect this file was written for: the preset the page opens on is a slick, so the only route into the editor —
// a selected polygon lug layer — did not exist, and the editor looked missing.
ok('the opening preset still has no lug layer, so the old route alone would be dead',
  P.layers.findIndex(l => l.type === 'blocks') < 0, P.layers.map(l => l.type).join(', '));

const headerBtn = $('editorBtn');
ok('the top bar carries an editor button', !!headerBtn, headerBtn ? JSON.stringify(headerBtn.textContent.trim()) : 'absent');
headerBtn.click();
ok('pressing it opens the editor', $('editor').classList.contains('on'));
ok('it gave the pattern a lug layer to work on', P.layers.some(l => l.type === 'blocks'),
  P.layers.map(l => l.type).join(', '));
ok('the button reads as active while open', headerBtn.classList.contains('on'));
const lugIndex = P.layers.findIndex(l => l.type === 'blocks');
ok('the editor is bound to that layer', UI.editing === lugIndex, `UI.editing = ${UI.editing}`);
ok('the layer is selected behind the overlay', UI.sel === lugIndex, `UI.sel = ${UI.sel}`);
ok('the layer carries a library design', !!P.layers[lugIndex].design, P.layers[lugIndex].design);

headerBtn.click();
ok('pressing it again closes the editor', !$('editor').classList.contains('on') && UI.editing === -1);
ok('and the button clears its active look', !headerBtn.classList.contains('on'));
headerBtn.click();
ok('reopening reuses that layer rather than stacking another',
  P.layers.filter(l => l.type === 'blocks').length === 1 && $('editor').classList.contains('on'),
  `${P.layers.filter(l => l.type === 'blocks').length} lug layer(s)`);

const props = $('layerProps');
ok('the layer panel still offers its own editor button',
  props.querySelectorAll('button').some(b => /tread editor/i.test(b.textContent)));
ok('the layer panel exposes the library picker', props.querySelectorAll('select').length === 1);

const lugPresets = PRESETS.filter(pr => pr.layers.some(l => l.type === 'blocks'));
ok('the preset grid holds the editable designs', lugPresets.length === 12, `${lugPresets.length} of ${PRESETS.length}`);
ok('editable presets are badged in the grid',
  $('presets').querySelectorAll('.preset.editable').length === lugPresets.length,
  `${$('presets').querySelectorAll('.preset.editable').length} badged`);

// ------------------------------------------------------------------ does it actually draw and edit?
section('Editor contents');
const svg = $('edSvg');
ok('the canvas has a view box', !!svg.getAttribute('viewBox'), svg.getAttribute('viewBox') || '');
ok('the pitch cell is drawn', svg.innerHTML.includes('class="band"'));
ok('lug outlines are drawn', (svg.innerHTML.match(/class="lug/g) || []).length > 0,
  `${(svg.innerHTML.match(/class="lug/g) || []).length} outlines`);
ok('neighbouring pitches are ghosted', svg.innerHTML.includes('ghost'));
ok('vertex handles are drawn for the selected shape', (svg.innerHTML.match(/class="vtx/g) || []).length > 0,
  `${(svg.innerHTML.match(/class="vtx/g) || []).length} handles`);
ok('no coordinate came out as NaN', !/NaN/.test(svg.innerHTML));

const shapes = P.layers[lugIndex].shapes;
ok('the shape list is populated', $('edList').querySelectorAll('.it').length === shapes.length,
  `${$('edList').querySelectorAll('.it').length} of ${shapes.length}`);
ok('the inspector is populated', $('edProps').querySelectorAll('select').length >= 3,
  `${$('edProps').querySelectorAll('select').length} selects, ${$('edProps').querySelectorAll('input').length} inputs`);
ok('the pitch cell controls are populated', $('edCell').querySelectorAll('input').length === 6,
  `${$('edCell').querySelectorAll('input').length} sliders`);
ok('all six tools are offered', $('edTools').querySelectorAll('button').length === 6,
  $('edTools').querySelectorAll('button').map(b => b.dataset.tool).join(', '));

// ------------------------------------------------------------------ the squash, and the view controls
section('The canvas keeps the cell in proportion');
const dims = vm.runInContext('dims', sandbox), blocksMetrics = vm.runInContext('blocksMetrics', sandbox);
const d = dims(vm.runInContext('T', sandbox)), met = blocksMetrics(P.layers[lugIndex], d);
const cellW = 2 * met.bandHalf, cellH = met.pitch;
ok('the pitch cell is far from square, which is why a unit square squashed it',
  cellW / cellH > 3, `${cellW.toFixed(0)} mm across vs ${cellH.toFixed(0)} mm per pitch, ratio ${(cellW / cellH).toFixed(1)}:1`);

const band = $('edSvg').querySelectorAll('.band')[0];
ok('the band is drawn at its true width in millimetres',
  Math.abs(parseFloat(band.getAttribute('width')) - cellW) < 0.01,
  `${band.getAttribute('width')} vs ${cellW.toFixed(3)}`);
ok('and spans the pitch at true height', Math.abs(parseFloat(band.getAttribute('height')) - cellH * 2.15) < 0.05,
  `${band.getAttribute('height')} vs ${(cellH * 2.15).toFixed(3)}`);

const vb = () => $('edSvg').getAttribute('viewBox').split(' ').map(Number);
const fitted = vb();
ok('the view box matches the stage aspect, so nothing is letterboxed or stretched',
  Math.abs(fitted[2] / fitted[3] - 800 / 600) < 1e-6, `${(fitted[2] / fitted[3]).toFixed(4)}`);
ok('the whole cell width is inside the view', fitted[2] >= cellW, `${fitted[2].toFixed(0)} mm wide view`);

$('edZoomIn').click();
const zoomed = vb();
ok('zoom in narrows the view', zoomed[2] < fitted[2], `${fitted[2].toFixed(0)} → ${zoomed[2].toFixed(0)} mm`);
ok('zoom keeps the centre fixed',
  Math.abs((zoomed[0] + zoomed[2] / 2) - (fitted[0] + fitted[2] / 2)) < 1e-6 &&
  Math.abs((zoomed[1] + zoomed[3] / 2) - (fitted[1] + fitted[3] / 2)) < 1e-6);
ok('zoom keeps the aspect', Math.abs(zoomed[2] / zoomed[3] - fitted[2] / fitted[3]) < 1e-9);
$('edZoomOut').click();
ok('zoom out widens it again', Math.abs(vb()[2] - fitted[2]) < 1e-6);
$('edZoomIn').click(); $('edZoomIn').click();
ok('reset view restores the fit', ($('edFit').click(), Math.abs(vb()[2] - fitted[2]) < 1e-6));
ok('handles are sized from the view, not fixed in design units',
  parseFloat($('edSvg').querySelectorAll('.vtx')[0].getAttribute('r')) > 0.1,
  `r = ${$('edSvg').querySelectorAll('.vtx')[0].getAttribute('r')} mm`);
ok('the stats strip reports the real cell size',
  /cell/.test($('edStats').innerHTML) && $('edStats').innerHTML.includes(String(Math.round(cellW))),
  $('edStats').querySelectorAll('span').map(x => x.textContent).join(' | '));

// ------------------------------------------------------------------ topology and retopology
section('Topology view');
ok('a topology button is offered', !!$('edTopo'));
$('edTopo').click();
ok('it turns on without throwing', UI.edTopo === true);
ok('the button reads as active', $('edTopo').classList.contains('primary'));
// Clipper is absent here, which is exactly the case the preview has to survive rather than crash on.
ok('without Clipper it says so instead of failing', /Clipper/.test($('edStats').innerHTML),
  $('edStats').querySelectorAll('span').map(x => x.textContent).join(' | '));
ok('the design still draws underneath it', (($('edSvg').innerHTML.match(/class="lug/g) || []).length > 0));
$('edTopo').click();
ok('it turns off again', UI.edTopo === false && !$('edTopo').classList.contains('primary'));

section('Retopology controls');
const panel = $('edTopoPanel');
ok('the panel offers the two density sliders', panel.querySelectorAll('input[type=range]').length === 2,
  `${panel.querySelectorAll('input[type=range]').length} sliders`);
ok('it offers pin and clear', panel.querySelectorAll('button').length >= 2,
  panel.querySelectorAll('button').map(b => b.textContent).join(' | '));
ok('it says there are no loops yet', /No edge loops/.test(panel.innerHTML));

const lug = P.layers[lugIndex];
ok('a fresh lug layer carries empty loop lists',
  Array.isArray(lug.loopsCirc) && Array.isArray(lug.loopsLat) && !lug.loopsCirc.length && !lug.loopsLat.length);

panel.querySelectorAll('button')[0].click();                       // pin grid to pitch
ok('pinning sets both densities', lug.topoAlong > 0 && lug.topoAcross > 0,
  `${lug.topoAlong} along × ${lug.topoAcross} across`);

// The whole point of pinning: the ring divides into whole pitches, so every repeat is meshed identically.
const treadGridLines = vm.runInContext('treadGridLines', sandbox);
const plain = treadGridLines(d, 6);
const pinned = treadGridLines(d, 6, P);
ok('the pinned grid is exactly the pitch subdivided',
  pinned.xs.length === met.count * lug.topoAlong + 1,
  `${plain.xs.length} auto → ${pinned.xs.length} pinned (${met.count} × ${lug.topoAlong} + 1)`);
ok('every pitch boundary is a grid line',
  Array.from({ length: met.count }, (_, i) => i * met.pitch).every(x => pinned.xs.some(v => Math.abs(v - x) < 1e-3)));
const steps = pinned.xs.slice(1).map((x, i) => x - pinned.xs[i]);
ok('and the spacing is uniform, so no repeat is meshed differently',
  Math.max(...steps) - Math.min(...steps) < 1e-4, `step ${steps[0].toFixed(4)} mm, spread ${(Math.max(...steps) - Math.min(...steps)).toExponential(1)}`);
ok('the auto grid was not, which is the defect pinning fixes',
  plain.xs.length % met.count !== 0, `${plain.xs.length} lines over ${met.count} pitches`);

lug.loopsCirc.push(0.22, -0.22); lug.loopsLat.push(0.3);
vm.runInContext('edDraw(); edSidebar();', sandbox);
ok('pinned loops are drawn on the canvas', $('edSvg').querySelectorAll('.loopHit').length === 3,
  `${$('edSvg').querySelectorAll('.loopHit').length} loops`);
ok('each loop gets a drag handle', $('edSvg').querySelectorAll('.loopTag').length === 3);
ok('the panel lists them', $('edTopoPanel').querySelectorAll('.lp').length === 3,
  $('edTopoPanel').querySelectorAll('.lp').map(x => x.textContent.replace('✕', '')).join(', '));

const tuned = treadGridLines(d, 6, P);
ok('a lateral loop adds one line to every pitch',
  tuned.xs.length === pinned.xs.length + met.count,
  `${pinned.xs.length} → ${tuned.xs.length} circumferential lines`);
ok('it lands at the same place inside each pitch',
  Array.from({ length: met.count }, (_, i) => (i + 0.3) * met.pitch)
    .every(x => tuned.xs.some(v => Math.abs(v - x) < 1e-3)));
ok('a circumferential loop lands at its millimetre position',
  [0.22, -0.22].every(u => tuned.ys.some(y => Math.abs(y - u * 2 * met.bandHalf) < 1e-3)),
  `±${(0.22 * 2 * met.bandHalf).toFixed(2)} mm`);
ok('the grid is sorted and free of duplicates',
  tuned.xs.every((x, i) => i === 0 || x > tuned.xs[i - 1]) && tuned.ys.every((y, i) => i === 0 || y > tuned.ys[i - 1]));
ok('the shoulder arc samples survive retopology',
  [10, 30, 50, 70].every(ph => tuned.ys.some(y => Math.abs(y - (d.treadHalf + d.sr * Math.sin(ph * Math.PI / 180))) < 1e-3)));
ok('with no lug layer the grid is byte-identical to before',
  JSON.stringify(treadGridLines(d, 6, { layers: [] })) === JSON.stringify(plain));

$('edTopoPanel').querySelectorAll('.lp')[0].querySelectorAll('button')[0].click();
ok('a loop can be removed from the panel', lug.loopsCirc.length === 1, `${lug.loopsCirc.length} left`);
$('edTopoPanel').querySelectorAll('button').find(b => /Clear loops/.test(b.textContent)).click();
ok('clear removes the rest', !lug.loopsCirc.length && !lug.loopsLat.length);

section('Editing through the panel');
const before = P.layers[lugIndex].shapes.length;
$('edAddBtn').click();
ok('the add button appends a shape', P.layers[lugIndex].shapes.length === before + 1,
  `${before} → ${P.layers[lugIndex].shapes.length}`);
ok('the new shape is selected and drawn', UI.editSel === before && !/NaN/.test($('edSvg').innerHTML));
ok('the list grew with it', $('edList').querySelectorAll('.it').length === before + 1);

const roleSelect = $('edProps').querySelectorAll('select')[0];
if (roleSelect && roleSelect.onchange) roleSelect.onchange({ target: { value: 'cut' } });
ok('changing a property rewrites the shape', P.layers[lugIndex].shapes[UI.editSel].role === 'cut',
  P.layers[lugIndex].shapes[UI.editSel].role);
ok('the redraw survives it', !/NaN/.test($('edSvg').innerHTML) && $('edSvg').innerHTML.length > 100);

$('edLoad').click();
ok('the design can be reloaded from the library', P.layers[lugIndex].shapes.length === before,
  `${P.layers[lugIndex].shapes.length} shapes restored`);

section('Closing up');
$('edClose').click();
ok('the overlay closes', !$('editor').classList.contains('on') && UI.editing === -1);
ok('the top bar button resets with it', !$('editorBtn').classList.contains('on'));
ok('the layer panel comes back', $('layerProps').querySelectorAll('button').length > 0);

section('The casing is untouched by all of that');
const T = vm.runInContext('T', sandbox);
ok('the tyre is still the opening slick', T.width === 305 && T.aspect === 30 && T.rim === 19,
  `${T.width}/${T.aspect}R${T.rim}`);

console.log(`\n${passed}/${passed + failed} checks passed`);
process.exit(failed ? 1 : 0);
