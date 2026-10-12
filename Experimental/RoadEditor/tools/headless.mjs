//==================================================================================================
//  Headless harness: runs the editor's module graph, build pipeline, picking and panels against a
//  minimal DOM and a no-op WebGL2 context. It cannot judge pixels, but it does catch the runtime
//  errors that would otherwise only show up as a blank canvas.
//
//    node tools/headless.mjs [preset] [seed]
//==================================================================================================

const nodes = new Map();

class ClassList {
  constructor(node) {
    this.node = node;
    this.set = new Set();
  }
  add(...c) { c.forEach((x) => this.set.add(x)); this.sync(); }
  remove(...c) { c.forEach((x) => this.set.delete(x)); this.sync(); }
  toggle(c, force) {
    const want = force === undefined ? !this.set.has(c) : force;
    if (want) this.set.add(c); else this.set.delete(c);
    this.sync();
    return want;
  }
  contains(c) { return this.set.has(c); }
  sync() { this.node._className = [...this.set].join(' '); }
}

class StubNode {
  constructor(tag = 'div', id = '') {
    this.tagName = tag.toUpperCase();
    this.id = id;
    this.children = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.attributes = {};
    this._className = '';
    this._listeners = {};
    this.value = '';
    this.textContent = '';
    this._html = '';
    this.classList = new ClassList(this);
    this.width = 1280;
    this.height = 720;
    this.clientWidth = 1280;
    this.clientHeight = 720;
    this.selected = false;
  }
  get className() { return this._className; }
  set className(v) {
    this._className = v;
    this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; }
  get firstChild() { return this.children[0] || null; }
  appendChild(c) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  removeChild(c) {
    const i = this.children.indexOf(c);
    if (i >= 0) this.children.splice(i, 1);
    return c;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this.className = String(v);
    if (k === 'id') this.id = String(v);
  }
  getAttribute(k) { return this.attributes[k]; }
  addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
  removeEventListener() {}
  dispatch(type, event = {}) { (this._listeners[type] || []).forEach((fn) => fn({ target: this, preventDefault() {}, ...event })); }
  allDescendants(out = []) {
    for (const c of this.children) {
      out.push(c);
      c.allDescendants && c.allDescendants(out);
    }
    return out;
  }
  querySelectorAll(sel) {
    const tag = sel.replace(/^[.#]/, '').split(/[ >.]/)[0].toUpperCase();
    return this.allDescendants().filter((n) => n.tagName === tag);
  }
  querySelector(sel) {
    const found = this.querySelectorAll(sel);
    return found[0] || null;
  }
  getBoundingClientRect() { return { left: 0, top: 0, width: this.clientWidth, height: this.clientHeight, right: this.clientWidth, bottom: this.clientHeight }; }
  focus() {}
  click() { this.dispatch('click', {}); }
  getContext(kind) {
    if (kind !== 'webgl2') return null;
    return makeGL();
  }
  toDataURL() { return 'data:image/png;base64,'; }
  setPointerCapture() {}
}

function makeGL() {
  const constants = {
    TEXTURE_2D: 3553, DEPTH_COMPONENT24: 33190, DEPTH_COMPONENT: 6402, UNSIGNED_INT: 5125, NEAREST: 9728,
    CLAMP_TO_EDGE: 33071, FRAMEBUFFER: 36160, DEPTH_ATTACHMENT: 36096, FRAMEBUFFER_COMPLETE: 36053,
    ARRAY_BUFFER: 34962, ELEMENT_ARRAY_BUFFER: 34963, STATIC_DRAW: 35044, FLOAT: 5126, BYTE: 5120,
    UNSIGNED_BYTE: 5121, UNSIGNED_SHORT: 5123, TRIANGLES: 4, DEPTH_TEST: 2929, LEQUAL: 515, CULL_FACE: 2884,
    BLEND: 3042, SRC_ALPHA: 770, ONE_MINUS_SRC_ALPHA: 771, ONE: 1, COLOR_BUFFER_BIT: 16384, DEPTH_BUFFER_BIT: 256,
    VERTEX_SHADER: 35633, FRAGMENT_SHADER: 35632, COMPILE_STATUS: 35713, LINK_STATUS: 35714, ACTIVE_UNIFORMS: 35718,
    TEXTURE0: 33984, LINEAR: 9729, TEXTURE_MIN_FILTER: 10241, TEXTURE_MAG_FILTER: 10240, TEXTURE_WRAP_S: 10242, TEXTURE_WRAP_T: 10243,
  };
  const gl = { ...constants, _programs: 0, _draws: 0 };
  gl.getExtension = () => null;
  gl.createShader = () => ({});
  gl.shaderSource = () => {};
  gl.compileShader = () => {};
  gl.getShaderParameter = () => true;
  gl.getShaderInfoLog = () => '';
  gl.createProgram = () => ({ id: ++gl._programs });
  gl.attachShader = () => {};
  gl.linkProgram = () => {};
  gl.getProgramParameter = (p, what) => (what === gl.ACTIVE_UNIFORMS ? 3 : true);
  gl.getProgramInfoLog = () => '';
  gl.getActiveUniform = (p, i) => ({ name: ['uViewProj', 'uSunDir', 'uTime'][i] || `u${i}` });
  gl.getUniformLocation = () => ({});
  gl.createVertexArray = () => ({});
  gl.bindVertexArray = () => {};
  gl.createBuffer = () => ({});
  gl.bindBuffer = () => {};
  gl.bufferData = () => {};
  gl.enableVertexAttribArray = () => {};
  gl.vertexAttribPointer = () => {};
  gl.vertexAttribDivisor = () => {};
  gl.deleteBuffer = () => {};
  gl.deleteVertexArray = () => {};
  gl.createFramebuffer = () => ({});
  gl.createTexture = () => ({});
  gl.bindTexture = () => {};
  gl.texImage2D = () => {};
  gl.texParameteri = () => {};
  gl.bindFramebuffer = () => {};
  gl.framebufferTexture2D = () => {};
  gl.checkFramebufferStatus = () => gl.FRAMEBUFFER_COMPLETE;
  gl.viewport = () => {};
  gl.enable = () => {};
  gl.disable = () => {};
  gl.depthFunc = () => {};
  gl.depthMask = () => {};
  gl.clear = () => {};
  gl.clearColor = () => {};
  gl.useProgram = () => {};
  gl.uniform1i = () => {};
  gl.uniform1f = () => {};
  gl.uniform3fv = () => {};
  gl.uniformMatrix4fv = () => {};
  gl.activeTexture = () => {};
  gl.drawArrays = () => { gl._draws++; };
  gl.drawElements = () => { gl._draws++; };
  gl.drawElementsInstanced = () => { gl._draws++; };
  gl.blendFunc = () => {};
  gl.finish = () => {};
  return gl;
}

const document = {
  getElementById: (id) => {
    if (!nodes.has(id)) {
      const node = new StubNode(id === 'gl' ? 'canvas' : 'div', id);
      nodes.set(id, node);
    }
    return nodes.get(id);
  },
  createElement: (tag) => new StubNode(tag),
  createTextNode: (text) => {
    const n = new StubNode('#text');
    n.textContent = text;
    return n;
  },
  querySelectorAll: () => [],
  querySelector: () => null,
  body: new StubNode('body'),
  addEventListener: () => {},
  head: new StubNode('head'),
};
// querySelectorAll on the real tabs returns buttons; the harness feeds them a stub list instead.
document.querySelectorAll = (sel) => {
  if (sel.startsWith('#')) return [];
  return [];
};

globalThis.document = document;
globalThis.window = {
  addEventListener: () => {},
  devicePixelRatio: 1,
  location: { href: 'http://localhost/' },
  setTimeout: (fn, t) => setTimeout(fn, t),
};
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(performance.now()), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.localStorage = {
  _d: new Map(),
  getItem(k) { return this._d.get(k) ?? null; },
  setItem(k, v) { this._d.set(k, v); },
  removeItem(k) { this._d.delete(k); },
};
globalThis.Blob = class { constructor(parts) { this.parts = parts; } };
globalThis.URL = { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} };
// navigator already exists in modern node; nothing to stub

// Mirror the real markup: the progress element owns a bar and a label.
const progress = document.getElementById('progress');
const bar = new StubNode('div');
bar.className = 'bar';
bar.appendChild(new StubNode('i'));
progress.appendChild(bar);
progress.appendChild(new StubNode('span'));
for (const id of ['hud', 'viewTools', 'legend', 'leftBody', 'rightBody', 'viewPresets', 'helpOverlay', 'fatal', 'sceneName', 'dirtyDot', 'status', 'perf']) {
  document.getElementById(id);
}

const args = process.argv.slice(2);
const preset = args[0] || 'town';
const seed = Number(args[1] || 20261012);

globalThis.__SLATE_HEADLESS = true;
const app = await import('../src/app.js');
const State = app.__state;

// Generate synchronously through the same code path the button uses.
console.log(`[harness] booting app with preset=${preset} seed=${seed}`);
app.__setParams({ preset, seed });
const tGen = performance.now();
await app.__regenerateForTest();
console.log(`[harness] generate ${Math.round(State.generated || 0)} ms, geometry ${Math.round(State.buildMs || 0)} ms, wall ${Math.round(performance.now() - tGen)} ms`);
console.log('[harness] model timings', Object.fromEntries(Object.entries(State.model.timings).map(([k, v]) => [k, Math.round(v)])));
console.log('[harness] ternary counts', {
  surfaces: State.model.surfaces.triCount,
  markings: State.model.markings.triCount,
  terrainVerts: State.model.terrainVerts,
  instances: State.model.instances.length,
});
app.__camera.update(0.016, { mode: app.__camera.mode });
const stats = app.__renderer.stats;
console.log('[harness] render stats', stats);

// Exercise picking, panels and the export surfaces.
const probe = app.__probePick(640, 360);
console.log('[harness] pick probe:', probe);
app.__selectNearest(640, 360);
const sel = State.selection;
console.log('[harness] selection after pick:', sel ? `${sel.kind} ${sel.id}` : 'none');
app.__refreshPanels();
app.__refreshHud();
for (const tab of ['build', 'library', 'issues']) {
  app.__setLeftTab(tab);
}
for (const tab of ['inspect', 'book', 'stats']) {
  app.__setRightTab(tab);
}
app.__setPreset('top');
app.__setPreset('street');
app.__setView('xray', true);
app.__setView('markings', false);
app.__setView('props', false);
app.__setView('shadows', false);
app.__setView('xray', false);
app.__setView('markings', true);
app.__setView('props', true);
app.__exportJSONForTest();
app.__camera.update(0.016, { mode: app.__camera.mode });
app.__selectNearest(700, 380);
const sel2 = State.selection;
console.log('[harness] second pick:', sel2 ? `${sel2.kind} ${sel2.id}` : 'none');
if (sel2 && sel2.kind === 'node') {
  app.__setRightTab('inspect');
}
app.__setView('xray', true);
app.__renderOnce();
console.log('[harness] all subsystems exercised without throwing');
process.exit(0);
