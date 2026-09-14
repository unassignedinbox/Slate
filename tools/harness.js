// Load SolidArc's inline <script> into a Node VM behind a permissive DOM stub,
// so the geometry kernel (solidBuild / profileSegs / ringOf / cornerGeom ...)
// can be exercised and measured headlessly.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const APP = process.env.APP || path.join(__dirname, '..', 'app', 'index.html');

function extractScript(html) {
  const parts = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) parts.push(m[1]);
  return parts.join('\n;\n');
}

// A stub that swallows arbitrary property access / calls / construction.
function makeStub(name = 'stub') {
  const fn = function () { return makeStub(name + '()'); };
  fn._stub = name;
  return new Proxy(fn, {
    get(t, p) {
      if (p === Symbol.toPrimitive) return () => 0;
      if (p === Symbol.iterator) return function* () {};
      if (p === 'toString') return () => '';
      if (p === 'valueOf') return () => 0;
      if (p === 'then') return undefined; // never thenable
      if (p === 'length') return 0;
      if (p === 'style' || p === 'dataset' || p === 'classList') return makeStub(name + '.' + String(p));
      if (p === 'children' || p === 'childNodes') return [];
      if (p === 'nodeType') return 1;
      if (p === 'textContent' || p === 'innerHTML' || p === 'value' || p === 'id') return '';
      if (p === 'width' || p === 'height' || p === 'clientWidth' || p === 'clientHeight') return 1000;
      if (p === 'parentNode' || p === 'parentElement' || p === 'firstChild') return null;
      return makeStub(name + '.' + String(p));
    },
    set() { return true; },
    has() { return true; },
    apply() { return makeStub(name + '()'); },
    construct() { return makeStub('new ' + name); },
  });
}

function buildSandbox() {
  const doc = makeStub('document');
  const win = {};
  const ctx = {
    console,
    Math, JSON, Date, Object, Array, String, Number, Boolean, Error, RegExp,
    Map, Set, WeakMap, WeakSet, Promise, Symbol, Proxy, Reflect,
    Float32Array, Float64Array, Uint8Array, Uint16Array, Uint32Array, Int32Array,
    ArrayBuffer, DataView, isNaN, isFinite, parseInt, parseFloat, encodeURIComponent,
    decodeURIComponent, structuredClone,
    setTimeout: (f) => { return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => {},
    queueMicrotask: () => {},
    document: doc,
    navigator: { userAgent: 'node', platform: 'linux', clipboard: makeStub('clip') },
    location: { href: 'http://localhost/?demo', search: process.env.DEMO ? '?demo' : '', hash: '' },
    localStorage: {
      _d: new Map(),
      getItem(k) { return this._d.has(k) ? this._d.get(k) : null; },
      setItem(k, v) { this._d.set(k, String(v)); },
      removeItem(k) { this._d.delete(k); },
      clear() { this._d.clear(); },
    },
    matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    getComputedStyle: () => makeStub('css'),
    devicePixelRatio: 1,
    innerWidth: 1400,
    innerHeight: 900,
    performance: { now: () => Date.now() },
    alert: () => {}, confirm: () => true, prompt: () => null,
    addEventListener: () => {}, removeEventListener: () => {},
    ResizeObserver: function () { return { observe() {}, unobserve() {}, disconnect() {} }; },
    Image: function () { return makeStub('img'); },
    Path2D: function () { return makeStub('path2d'); },
    DOMMatrix: function () { return makeStub('m'); },
    Blob: function () { return makeStub('blob'); },
    URL: { createObjectURL: () => '', revokeObjectURL: () => {} },
    fetch: () => Promise.resolve(makeStub('resp')),
    FileReader: function () { return makeStub('fr'); },
    URLSearchParams,
    TextEncoder, TextDecoder,
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.self = ctx;
  return ctx;
}

function load(appPath = APP) {
  const html = fs.readFileSync(appPath, 'utf8');
  const src = extractScript(html);
  const sandbox = buildSandbox();
  vm.createContext(sandbox);
  // Expose the app's module-scoped internals for measurement.
  const EXPORTS = ['doc', 'byId', 'mk', 'solidBuild', 'profileSegs', 'loopSubs', 'ringOf',
    'cornerGeom', 'loopApplySideEdits', 'applyFaceOps', 'bodyMeshWith', 'meshOf', 'topo',
    'invalidate', 'solidEditKeys', 'solidEditApply', 'brepState', 'brepMesh', 'opVertexBevel', 'signedArea', 'arcPoints',
    'bulgeArc', 'earClipHoles', 'nid', 'meshCache', 'topoCache', 'build'];
  const epilogue = '\n;globalThis.__app = {' +
    EXPORTS.map((n) => `get ${n}(){try{return ${n};}catch(e){return undefined;}}`).join(',') +
    '};\n';

  const loadErrors = [];
  try {
    vm.runInContext(src + epilogue, sandbox, { filename: 'solidarc-inline.js', timeout: 60000 });
  } catch (e) {
    loadErrors.push(String(e && e.stack ? e.stack.split('\n').slice(0, 4).join('\n') : e));
  }
  return { sandbox, loadErrors };
}

module.exports = { load, extractScript, makeStub };

if (require.main === module) {
  const { sandbox, loadErrors } = load();
  const names = ['solidBuild', 'profileSegs', 'loopSubs', 'ringOf', 'cornerGeom',
    'loopApplySideEdits', 'applyFaceOps', 'opVertexBevel', 'brepState', 'brepMesh',
    'doc', 'byId', 'mk'];
  console.log('load errors:', loadErrors.length ? loadErrors : 'none');
  console.log('symbols:', names.map((n) => `${n}=${typeof sandbox[n]}`).join('  '));
  if (sandbox.doc && sandbox.doc.figures) {
    console.log('figures:', sandbox.doc.figures.map((f) => `${f.kind}:${f.name}`).join(', '));
  }
}
