#!/usr/bin/env node
/* ------------------------------------------------------------------------------------------------------------------
   QuadTreadViewerProof — boots References/QuadTreadModelling.html in Node.

   QuadTreadAudit checks the geometry; this checks the page around it. The module body is run against a stub DOM
   and a stub three.js, and then the UI is actually driven: every design at every step of the pipeline, the audit
   button, the OBJ export (which must emit four-index faces with in-range indices) and the GLB path. It catches
   the class of mistake a syntax check cannot — a renamed element, a property that moved, a step that throws only
   for one design.

   Usage:  node Exhibits/Workbench/Tyre/QuadTreadViewerProof.mjs
   Exit code is 1 if anything fails.
------------------------------------------------------------------------------------------------------------------ */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const HTML = path.resolve(here, '../../../References/QuadTreadModelling.html');
const html = fs.readFileSync(HTML, 'utf8');
const body = html.split('<script type="module">')[1].split('</script>')[0].replace(/^import .*$/gm, '');

/* ---- stub DOM ---- */
const nodes = new Map();
const mkEl = (id) => {
  const el = {
    id, textContent: '', className: '', innerHTML: '', style: {}, dataset: {}, value: '0', checked: false,
    children: [], classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { this.children.push(c); },
    querySelector(sel) {
      if (sel === 'input') return this._input || (this._input = mkEl(id + ':input'));
      if (sel === '.val') return this._val || (this._val = mkEl(id + ':val'));
      return mkEl(id + sel);
    },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    getBoundingClientRect: () => ({ width: 1200, height: 800 }),
    clientWidth: 1200, clientHeight: 800,
    click() { if (this.onclick) this.onclick(); },
  };
  return el;
};
for (const id of html.match(/id="([^"]+)"/g).map(s => s.slice(4, -1))) nodes.set(id, mkEl(id));
const steps = [1, 2, 3, 4, 5].map(n => { const e = mkEl('step' + n); e.dataset.stage = String(n); return e; });

globalThis.document = {
  getElementById: id => nodes.get(id) || (nodes.set(id, mkEl(id)), nodes.get(id)),
  createElement: tag => mkEl(tag),
  querySelectorAll: sel => (sel === '.step' ? steps : []),
  body: mkEl('body'),
};
globalThis.devicePixelRatio = 2;
globalThis.ResizeObserver = class { observe() {} };
globalThis.performance = { now: () => Date.now() };
globalThis.URL.createObjectURL = () => 'blob:stub';
globalThis.URL.revokeObjectURL = () => {};
globalThis.Blob = class { constructor(parts) { this.size = parts.join('').length; globalThis.__lastBlob = parts.join(''); } };

/* ---- stub three.js ---- */
const V3 = class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } copy(v) { return this.set(v.x, v.y, v.z); } multiplyScalar(s) { return this.set(this.x * s, this.y * s, this.z * s); } };
const THREE = {
  WebGLRenderer: class { constructor() { this.domElement = mkEl('canvas'); } setPixelRatio() {} setSize() {} setAnimationLoop() {} render() {} },
  Scene: class { constructor() { this.children = []; } add(...o) { this.children.push(...o); } },
  Color: class { constructor() {} set() {} },
  PerspectiveCamera: class { constructor() { this.position = new V3(); } updateProjectionMatrix() {} },
  PMREMGenerator: class { fromScene() { return { texture: {} }; } },
  DirectionalLight: class { constructor() { this.position = new V3(); } },
  HemisphereLight: class {},
  MeshStandardMaterial: class { constructor() { this.color = { set() {} }; } },
  LineBasicMaterial: class {},
  Group: class { constructor() { this.children = []; } add(...o) { this.children.push(...o); } remove(o) { this.children = this.children.filter(c => c !== o); } },
  BufferGeometry: class { setAttribute(n, a) { this[n] = a; } dispose() {} },
  Float32BufferAttribute: class { constructor(a) { this.count = a.length / 3; if (!a.length) globalThis.__emptyAttr = (globalThis.__emptyAttr || 0) + 1; } },
  Mesh: class { constructor(g) { this.geometry = g; } },
  LineSegments: class { constructor(g) { this.geometry = g; } },
  Box3: class { setFromObject() { return this; } isEmpty() { return false; } getCenter(v) { return v.set(0, 0, 0); } getSize(v) { return v.set(400, 400, 200); } },
  Vector3: V3,
};
const OrbitControls = class { constructor() { this.target = new V3(); } update() {} };
const RoomEnvironment = class {};
const GLTFExporter = class { parse(_s, cb) { cb(new ArrayBuffer(8)); } };

const run = new Function('THREE', 'OrbitControls', 'RoomEnvironment', 'GLTFExporter',
  body + '\nreturn { setStage, applyDesign, DESIGNS, T, auditTread };');
const api = run(THREE, OrbitControls, RoomEnvironment, GLTFExporter);

let fails = 0;
const say = (ok, msg) => { if (!ok) fails++; console.log(`${ok ? '  ok  ' : ' FAIL '} ${msg}`); };
console.log(`QuadTreadViewerProof — ${path.relative(process.cwd(), HTML)}\n`);
say(true, 'page module evaluated and booted');

for (const key of Object.keys(api.DESIGNS)) {
  for (const st of [1, 2, 3, 4, 5]) {
    try {
      api.setStage(st);
      api.applyDesign(key);
      const q = +nodes.get('stQuads').textContent.replace(/,/g, '');
      say(q > 0, `${key} step ${st} — ${nodes.get('stQuads').textContent} quads, ${nodes.get('stTiles').textContent} tiles`);
    } catch (e) { say(false, `${key} step ${st} — ${e.message}`); }
  }
}

/* the audit button (deferred by setTimeout inside the page) */
api.setStage(5); api.applyDesign('breaker');
nodes.get('runAudit').click();
await new Promise(r => setTimeout(r, 400));
say(/topology verified/.test(nodes.get('auditBadge').textContent), `audit button: "${nodes.get('auditBadge').textContent}"`);
console.log(nodes.get('auditOut').textContent.split('\n').map(s => '        ' + s).join('\n'));

/* OBJ export */
api.setStage(2); api.applyDesign('cruise');
nodes.get('exportObj').click();
const obj = globalThis.__lastBlob || '';
const fLines = obj.split('\n').filter(l => l.startsWith('f '));
const vLines = obj.split('\n').filter(l => l.startsWith('v '));
say(fLines.length > 0 && fLines.every(l => l.trim().split(/\s+/).length === 5), `OBJ: ${fLines.length} faces, all with four indices`);
say(vLines.length > 0 && vLines.every(l => l.trim().split(/\s+/).length === 4), `OBJ: ${vLines.length} vertices`);
const maxIdx = Math.max(...fLines.slice(0, 5000).flatMap(l => l.split(/\s+/).slice(1).map(Number)));
say(maxIdx <= vLines.length, `OBJ: largest face index ${maxIdx} ≤ ${vLines.length} vertices`);

nodes.get('exportGlb').click();
say(true, 'GLB export path ran');

console.log(fails ? `\nFAILED: ${fails} checks` : '\nPASSED: every design, every step, the audit button and both exports');
process.exit(fails ? 1 : 0);
