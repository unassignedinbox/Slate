// Boots the real application (src/main.js) headlessly against a DOM stub, a recording
// WebGPU mock and a driven requestAnimationFrame clock, then plays a user session:
// frame the network, hover, click an intersection, drag its gizmo, wait for the deferred
// rebuild, and hit every keyboard shortcut. Catches browser-path crashes without a browser.

const fails = [];
const assert = (cond, msg) => { if (!cond) { fails.push(msg); console.log('\u001b[31m✗\u001b[0m', msg); } else console.log('\u001b[32m✓\u001b[0m', msg); };
const noop = () => {};

// ---------------------------------------------------------------- DOM stub
class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.style = new Proxy({ setProperty(k, v) { this[k] = v; }, removeProperty: noop }, {});
    this.dataset = {};
    this.attrs = new Map();
    this.listeners = new Map();
    this._class = new Set();
    this.classList = {
      add: (...c) => c.forEach((x) => this._class.add(x)),
      remove: (...c) => c.forEach((x) => this._class.delete(x)),
      contains: (c) => this._class.has(c),
      toggle: (c, on) => (on ?? !this._class.has(c)) ? this._class.add(c) : this._class.delete(c),
    };
    this.value = '';
    this.disabled = false;
  }
  set className(v) { this._class = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._class].join(' '); }
  appendChild(c) { if (c && c.nodeType !== 3) c.parentNode = this; this.children.push(c); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  prepend(...cs) { for (const c of cs.reverse()) { if (c.parentNode !== undefined) c.parentNode = this; this.children.unshift(c); } }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; }
  remove() { this.parentNode?.removeChild(this); }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'class') this.className = v; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(t, fn) { (this.listeners.get(t) || this.listeners.set(t, []).get(t)).push(fn); }
  removeEventListener(t, fn) { const l = this.listeners.get(t); if (l) l.splice(l.indexOf(fn), 1); }
  dispatchEvent(type, ev = {}) {
    const e = { type, target: this, currentTarget: this, preventDefault: noop, stopPropagation: noop, ...ev };
    for (const fn of this.listeners.get(type) || []) fn(e);
    return true;
  }
  setPointerCapture() {} releasePointerCapture() {} focus() {} blur() {}
  getBoundingClientRect() { return { left: 0, top: 0, right: 1280, bottom: 720, width: 1280, height: 720 }; }
  getContext(kind) { return kind === 'webgpu' ? context : null; }
  set innerHTML(v) { this._html = String(v); this.children.length = 0; }
  get innerHTML() { return this._html || ''; }
  set textContent(v) { this._text = String(v); this.children.length = 0; }
  get textContent() { return this._text !== undefined ? this._text : this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(''); }
  walk(fn) { fn(this); for (const c of this.children) if (c.walk) c.walk(fn); }
  querySelector(sel) {
    let found = null;
    this.walk((n) => {
      if (found) return;
      if (sel.startsWith('.') ? n._class.has(sel.slice(1)) : n.tagName === sel.toUpperCase()) found = n;
    });
    return found;
  }
  querySelectorAll(sel) { const out = []; this.walk((n) => { if (sel.startsWith('.') ? n._class.has(sel.slice(1)) : n.tagName === sel.toUpperCase()) out.push(n); }); return out; }
}
// Map#set returns the map, patch the listener helper to behave
El.prototype.addEventListener = function (t, fn) {
  if (!this.listeners.has(t)) this.listeners.set(t, []);
  this.listeners.get(t).push(fn);
};

const appRoot = new El('div');
globalThis.document = {
  createElement: (t) => new El(t),
  createTextNode: (t) => ({ nodeType: 3, text: String(t) }),
  getElementById: (id) => (id === 'app' ? appRoot : new El('div')),
  querySelector: (sel) => appRoot.querySelector(sel),
  querySelectorAll: (sel) => appRoot.querySelectorAll(sel),
  body: appRoot,
  documentElement: new El('html'),
  addEventListener: noop,
};
const keyListeners = [];
globalThis.window = {
  devicePixelRatio: 1, innerWidth: 1600, innerHeight: 900,
  addEventListener: (t, fn) => { if (t === 'keydown') keyListeners.push(fn); },
  removeEventListener: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop }),
};
globalThis.HTMLInputElement = class {};
globalThis.HTMLSelectElement = class {};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };

// driven animation clock
let clock = 0;
let rafQueue = [];
globalThis.requestAnimationFrame = (cb) => { rafQueue.push(cb); return rafQueue.length; };
globalThis.cancelAnimationFrame = noop;
async function runFrames(n, dtMs = 16.7) {
  for (let i = 0; i < n; i++) {
    const q = rafQueue; rafQueue = [];
    clock += dtMs;
    for (const cb of q) cb(clock);
    await null;  // let microtasks (awaited promises inside boot) drain
  }
}

// ---------------------------------------------------------------- WebGPU mock
globalThis.GPUBufferUsage = { VERTEX: 32, INDEX: 16, UNIFORM: 64, COPY_DST: 8, STORAGE: 128 };
globalThis.GPUTextureUsage = { RENDER_ATTACHMENT: 16, TEXTURE_BINDING: 4, COPY_SRC: 1 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

const gpu = { buffers: 0, bytes: 0, draws: 0, writes: 0, frames: 0, destroyed: 0 };
class Buffer {
  constructor(d) { this.size = d.size; this.label = d.label; gpu.buffers++; gpu.bytes += d.size; }
  destroy() { gpu.destroyed++; }
}
class Texture {
  constructor(d) { this.desc = d; }
  createView() { return { __texture: this }; }
  destroy() {}
}
class Pass {
  setPipeline() {} setBindGroup() {} setVertexBuffer() {} setIndexBuffer() {}
  drawIndexed() { gpu.draws++; } draw() { gpu.draws++; } end() {}
}
const device = {
  features: new Set(), limits: {},
  createBuffer: (d) => new Buffer(d),
  createTexture: (d) => new Texture(d),
  createSampler: () => ({}),
  createBindGroupLayout: () => ({}),
  createBindGroup: () => ({}),
  createPipelineLayout: () => ({}),
  createShaderModule: () => ({}),
  createRenderPipeline: () => ({}),
  createCommandEncoder: () => ({ beginRenderPass: () => new Pass(), finish: () => ({}) }),
  queue: { writeBuffer: () => { gpu.writes++; }, submit: () => { gpu.frames++; } },
  addEventListener: noop,
};
const context = { configure: noop, getCurrentTexture: () => new Texture({ label: 'swap' }) };
const gpuApi = {
  requestAdapter: async () => ({ limits: { maxBufferSize: 2 ** 31, maxStorageBufferBindingSize: 2 ** 27 }, info: { vendor: 'mock' }, requestDevice: async () => device }),
  getPreferredCanvasFormat: () => 'bgra8unorm',
};
// globalThis.navigator is a getter-only accessor in Node: redefine the whole property
try {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, writable: true, value: { gpu: gpuApi, userAgent: 'node' } });
} catch (e) { console.log('navigator stub failed:', e.message); }

// capture anything the app logs as an error
const realError = console.error;
const errors = [];
console.error = (...a) => { errors.push(a.map(String).join(' ')); realError('\u001b[33m  app console.error:\u001b[0m', ...a); };
process.on('uncaughtException', (e) => { errors.push(`uncaught: ${e.message}`); realError(e); });

// ---------------------------------------------------------------- boot
console.log('booting src/main.js …');
await import('../../src/main.js');
await runFrames(4);                 // boot() awaits a 16 ms timeout before generating
await new Promise((r) => setTimeout(r, 40));
await runFrames(4);

const app = globalThis.window.roadsmith;
assert(!!app, 'app booted and exposed window.roadsmith');
if (!app) process.exit(1);
const { editor, camera, api } = app;
assert(!!editor.scene, 'scene generated during boot');
assert(!!app.renderer, 'renderer created');
assert(gpu.buffers > 20, `GPU buffers uploaded — ${gpu.buffers} buffers, ${(gpu.bytes / 1048576).toFixed(1)} MB`);

await runFrames(10);
assert(gpu.frames >= 8, `frame loop is running — ${gpu.frames} submits`);
assert(gpu.draws > 100, `draw calls recorded — ${gpu.draws}`);

const canvas = app.shell.canvas;
const rect = canvas.getBoundingClientRect();
const toClient = (ndc) => ({ clientX: ((ndc.x + 1) / 2) * rect.width, clientY: ((1 - ndc.y) / 2) * rect.height });
const project = (vp, p) => {
  const w = vp[3] * p.x + vp[7] * p.y + vp[11] * p.z + vp[15];
  return { x: (vp[0] * p.x + vp[4] * p.y + vp[8] * p.z + vp[12]) / w, y: (vp[1] * p.x + vp[5] * p.y + vp[9] * p.z + vp[13]) / w };
};

// ---------------------------------------------------------------- select an intersection
const junction = [...editor.scene.net.nodes.values()].find((n) => n.edges.length >= 3 && !n.locked);
api.frame(junction.p, 80);
camera.snapTo();
await runFrames(3);
const ndcJ = project(camera.viewProj, junction.p);
const posJ = toClient(ndcJ);

canvas.dispatchEvent('pointermove', { ...posJ, button: -1, buttons: 0, pointerId: 1 });
await runFrames(1);
canvas.dispatchEvent('pointerdown', { ...posJ, button: 0, pointerId: 1 });
canvas.dispatchEvent('pointerup', { ...posJ, button: 0, pointerId: 1 });
await runFrames(2);
assert(editor.selection?.type === 'junction' && editor.selection.id === junction.id,
  `clicking the viewport selected ${editor.selection?.type} ${editor.selection?.id} (wanted junction ${junction.id})`);

// ---------------------------------------------------------------- drag the gizmo
const before = { x: junction.p.x, z: junction.p.z };
const drawsBefore = gpu.draws;
canvas.dispatchEvent('pointerdown', { ...posJ, button: 0, pointerId: 1 });
for (let i = 1; i <= 6; i++) {
  const p = toClient({ x: ndcJ.x + 0.02 * i, y: ndcJ.y - 0.012 * i });
  canvas.dispatchEvent('pointermove', { ...p, button: 0, buttons: 1, pointerId: 1 });
  await runFrames(1);
}
const end = toClient({ x: ndcJ.x + 0.12, y: ndcJ.y - 0.072 });
canvas.dispatchEvent('pointerup', { ...end, button: 0, pointerId: 1 });
const movedBy = Math.hypot(junction.p.x - before.x, junction.p.z - before.z);
assert(movedBy > 1.0, `gizmo drag moved the junction ${movedBy.toFixed(2)} m`);

// the rebuild is deferred ~0.28 s and runs behind the busy veil (two rAF ticks)
await runFrames(40);
await new Promise((r) => setTimeout(r, 10));
await runFrames(8);
const node = editor.scene.net.nodes.get(junction.id);
const plate = editor.scene.surface.junctions.get(junction.id);
assert(!!plate, 'junction plate survived the rebuild');
assert(plate && Math.hypot(plate.centre.x - node.p.x, plate.centre.z - node.p.z) < Math.max(5, plate.radius * 0.4),
  `rebuilt plate re-centred on the dragged node (${plate ? Math.hypot(plate.centre.x - node.p.x, plate.centre.z - node.p.z).toFixed(2) : '–'} m off)`);
assert(gpu.destroyed > 10, `old GPU buffers released on rebuild — ${gpu.destroyed} destroyed`);
assert(gpu.draws > drawsBefore, 'still drawing after the rebuild');

// ---------------------------------------------------------------- keyboard + UI
const key = (k) => { for (const fn of keyListeners) fn({ key: k, target: appRoot, preventDefault: noop }); };
const view0 = { ...editor.view };
key('q'); key('l'); key(' '); key('n');
assert(editor.view.wireframe !== view0.wireframe && editor.view.laneGraph !== view0.laneGraph
  && editor.view.simulate !== view0.simulate && editor.view.network !== view0.network, 'Q/L/Space/N toggle view modes');
key('q'); key('l'); key(' '); key('n');
key('f'); key('escape');
assert(editor.selection === null, 'Esc cleared the selection');
await runFrames(4);

// texturing stack: switch tab, select a channel, change a value
app.shell.setTab('texture');
await runFrames(2);
assert(editor.selection?.type === 'channel', `texture tab selected channel ${editor.selection?.id}`);
const chan = editor.channels[0];
const v0 = editor.channelVersion;
editor.setChannelValue(chan.id, 'roughness', 0.42);
editor.setChannelValue(chan.id, 'enabled', false);
await runFrames(3);
assert(editor.channelVersion === v0 + 2 && chan.roughness === 0.42, 'texture channel edits propagate');
app.shell.setTab('scene');

// every layer toggles off and back on
let toggled = 0;
for (const l of editor.scene.layers) { editor.toggleLayer(l.id, false); toggled++; }
await runFrames(3);
for (const l of editor.scene.layers) editor.toggleLayer(l.id, true);
await runFrames(3);
assert(toggled >= 6 && editor.hidden.size === 0, `all ${toggled} layers hidden and restored`);

// environment presets
for (const name of ['overcast', 'wet', 'dusk', 'night', 'clear']) { editor.setEnv(name); await runFrames(2); }
assert(editor.envName === 'clear', 'cycled every lighting preset');

// fleet cap through the inspector action
api.setFleet(40);
await runFrames(3);
assert(editor.scene.traffic.vehicles.length <= 25, `fleet clamped to ${editor.scene.traffic.vehicles.length} vehicles`);

// road feature authoring
const edge = [...editor.scene.net.edges.values()].find((e) => e.curve.length > 60);
editor.select({ type: 'road', id: edge.id });
api.addFeature(edge, 'pothole'); api.addFeature(edge, 'bump'); api.addFeature(edge, 'works');
await runFrames(40);
await new Promise((r) => setTimeout(r, 10));
await runFrames(8);
assert(edge.features.potholes.length > 0 && edge.features.speedBumps.length > 0, 'road damage/works authored and rebuilt');

await runFrames(20);
assert(errors.length === 0, errors.length ? `no runtime errors (saw ${errors.length}: ${errors[0]})` : 'no runtime errors during the session');

console.log(`\nsession: ${gpu.frames} frames · ${gpu.draws} draws · ${gpu.writes} buffer writes · ${gpu.buffers} buffers allocated`);
if (fails.length) { console.log(`\u001b[31m${fails.length} failure(s)\u001b[0m`); process.exit(1); }
console.log('\u001b[32m✓\u001b[0m headless app session clean');
process.exit(0);
