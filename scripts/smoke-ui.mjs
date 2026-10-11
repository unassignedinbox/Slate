// Headless UI smoke test (jsdom): shell, outliner, inspector, construct menu.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  url: 'http://localhost/',
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.HTMLElement = dom.window.HTMLElement;
globalThis.performance = dom.window.performance;

// 2D canvas stub (jsdom has no canvas backend)
function makeCtxStub() {
  const gradient = { addColorStop() {} };
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', font: '',
    textAlign: 'start', textBaseline: 'alphabetic',
    fillRect() {}, strokeRect() {}, clearRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, bezierCurveTo() {}, arc() {}, fill() {}, stroke() {},
    fillText() {}, strokeText() {}, save() {}, restore() {}, translate() {}, rotate() {},
    scale() {}, setTransform() {}, drawImage() {}, putImageData() {},
    createLinearGradient() { return gradient; },
    createRadialGradient() { return gradient; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(Math.max(1, w * h * 4)), width: w, height: h }; },
    measureText() { return { width: 10 }; },
  };
}
dom.window.HTMLCanvasElement.prototype.getContext = function () { return makeCtxStub(); };

const { RoadDocument } = await import('../src/model.js');
const { generateCity } = await import('../src/citygen.js');
const { buildShell } = await import('../src/ui.js');
const { openConstruct } = await import('../src/construct.js');

const doc = new RoadDocument();
generateCity(doc, { seed: 3, blocks: 4 });

const calls = [];
const track = (name) => (...args) => { calls.push(name); };

const ctrl = {
  doc,
  hiddenKinds: new Set(),
  selection: null,
  getSelection: () => ctrl.selection,
  getSceneName: () => doc.sceneName,
  setSceneName: track('setSceneName'),
  getSnap: () => 5,
  setSnap: track('setSnap'),
  getDrawProfile: () => 'boulevard',
  startDrawRoad: track('startDrawRoad'),
  startPlaceProp: track('startPlaceProp'),
  startDrawRail: track('startDrawRail'),
  setTool: track('setTool'),
  setViewMode: track('setViewMode'),
  select: (id) => { ctrl.selection = id; calls.push('select'); },
  focusSelected: track('focusSelected'),
  focusCollection: track('focusCollection'),
  deleteSelected: track('deleteSelected'),
  deleteCollection: track('deleteCollection'),
  duplicateSelected: track('duplicateSelected'),
  updateSegment: track('updateSegment'),
  updateProp: track('updateProp'),
  toggleHidden: track('toggleHidden'),
  toggleGrid: track('toggleGrid'),
  clearScene: track('clearScene'),
  generateCity: track('generateCity'),
  getGenParams: () => ({ seed: 3, blocks: 4, rail: true, subway: true, river: true, busNetwork: true, bikeNetwork: true, parking: true, furniture: true, speedBumps: true }),
  setGenParams: track('setGenParams'),
  exportJSON: track('exportJSON'),
  importJSON: track('importJSON'),
  undo: track('undo'),
  redo: track('redo'),
  openConstruct: () => openConstruct(ctrl),
  getCameraSpeed: () => 26,
  setCameraSpeed: track('setCameraSpeed'),
};

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok  ', msg);
}

const ui = buildShell(ctrl);
ui.updateAll();

assert(document.querySelector('.shell'), 'shell mounts');
assert(document.querySelector('.outliner'), 'outliner mounts');
assert(document.querySelector('.toolbar'), 'toolbar mounts');
assert(document.querySelector('.viewport'), 'viewport mounts');
assert(document.querySelector('.inspector'), 'inspector mounts');
assert(document.querySelector('.statusbar'), 'status bar mounts');
assert(document.querySelectorAll('.tree-row').length > 10, `tree rows rendered (${document.querySelectorAll('.tree-row').length})`);
assert(document.querySelector('.object-header h1')?.textContent === 'Scene overview', 'scene overview inspector');
assert(document.querySelectorAll('.stat-cell').length === 6, 'stat strip cells');

// select a road segment
const seg = doc.segments[0];
ctrl.selection = seg.id;
ui.updateAll();
assert(document.querySelector('.object-header h1')?.textContent === seg.name, 'segment inspector header');
assert(document.querySelector('.lane-diagram'), 'lane cross-section diagram');
assert(document.querySelectorAll('.property-switch').length === 4, 'segment property switches');

// select a prop
const prop = doc.props[0];
ctrl.selection = prop.id;
ui.updateAll();
assert(document.querySelector('.object-header p')?.textContent.includes('Street furniture'), 'prop inspector');

// select a rail
ctrl.selection = doc.rails[0].id;
ui.updateAll();
assert(document.querySelector('.object-header h1')?.textContent === doc.rails[0].name, 'rail inspector');

// select subway
ctrl.selection = doc.subways[0].id;
ui.updateAll();
assert(document.body.textContent.includes('Metro line'), 'subway inspector');

// collection
ctrl.selection = 'coll:streetlight';
ui.updateAll();
assert(document.body.textContent.includes('Collection'), 'collection inspector');

// construct modal
ctrl.selection = null;
ui.updateAll();
openConstruct(ctrl);
assert(document.querySelector('.construct-panel'), 'construct panel mounts');
assert(document.querySelector('.construct-layout'), 'construct layout wraps nav + content');
assert(document.querySelectorAll('.construct-nav-caption, nav button').length > 3, 'construct nav tabs');
assert(document.querySelectorAll('.construct-tile').length >= 10, `construct road tiles (${document.querySelectorAll('.construct-tile').length})`);

// switch to generate tab
const genBtn = [...document.querySelectorAll('.construct-layout nav button')].find((b) => b.textContent.includes('Generate'));
genBtn.click();
assert(document.querySelectorAll('.gen-row').length === 10, `generate form rows (${document.querySelectorAll('.gen-row').length})`);
assert(document.querySelector('.construct-submit')?.textContent.includes('Generate City'), 'generate submit');

// furniture tab
const furnBtn = [...document.querySelectorAll('.construct-layout nav button')].find((b) => b.textContent.includes('Furniture'));
furnBtn.click();
assert(document.querySelectorAll('.construct-tile').length >= 12, `furniture tiles (${document.querySelectorAll('.construct-tile').length})`);
document.querySelector('.construct-tile').click();
assert(calls.includes('startPlaceProp'), 'tile click starts prop tool');

// road tile -> draw tool
openConstruct(ctrl);
const roadsBtn = [...document.querySelectorAll('.construct-layout nav button')].find((b) => b.textContent.includes('Roads'));
roadsBtn.click();
const roadTile = document.querySelector('.construct-tile');
roadTile.click();
assert(calls.includes('startDrawRoad'), 'road tile click starts draw tool');

console.log('\nUI SMOKE TEST PASSED');
process.exit(0);
