/* =====================================================================================================================
   A deliberately small DOM and three.js stand-in, just large enough to boot References/TyreGenerator.html in Node.

   There is no browser and no network in this workspace, so the only way to find out whether the page actually comes
   up — and whether a control is reachable — is to run its module against fakes. Nothing here tries to be correct in
   general; it is correct for the handful of calls the generator makes.
   ===================================================================================================================== */

const VOID = new Set(['input', 'br', 'img', 'link', 'meta', 'hr', 'source', 'path', 'circle', 'line', 'rect', 'use']);

export class FakeElement {
  constructor(tag = 'div', attrs = {}) {
    this.tagName = tag.toUpperCase();
    this.nodeName = this.tagName;
    this.childNodes = [];
    this.parentNode = null;
    this.style = new Proxy({}, { set: (t, k, v) => { t[k] = v; return true; } });
    this.dataset = {};
    this.attributes = {};
    this.textContent = '';
    this.value = '';
    this.checked = false;
    this.files = [];
    this._html = '';
    this._classes = new Set();
    const self = this;
    this.classList = {
      add: (...c) => c.forEach(x => self._classes.add(x)),
      remove: (...c) => c.forEach(x => self._classes.delete(x)),
      toggle: (c, force) => { const on = force === undefined ? !self._classes.has(c) : !!force; on ? self._classes.add(c) : self._classes.delete(c); return on; },
      contains: c => self._classes.has(c)
    };
    for (const [k, v] of Object.entries(attrs)) this.setAttribute(k, v);
  }
  get className() { return [...this._classes].join(' '); }
  set className(v) { this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get children() { return this.childNodes; }
  get firstChild() { return this.childNodes[0] || null; }
  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this.className = v;
    else if (k === 'id') this.id = v;
    else if (k.startsWith('data-')) this.dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = String(v);
    else if (k === 'value') this.value = v;
  }
  getAttribute(k) { return k in this.attributes ? this.attributes[k] : null; }
  removeAttribute(k) { delete this.attributes[k]; }
  appendChild(child) { child.parentNode = this; this.childNodes.push(child); return child; }
  removeChild(child) { this.childNodes = this.childNodes.filter(c => c !== child); return child; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  prepend(...nodes) { for (const n of nodes.reverse()) { n.parentNode = this; this.childNodes.unshift(n); } }
  append(...nodes) { for (const n of nodes) this.appendChild(n); }
  insertBefore(child, ref) { const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, child); child.parentNode = this; return child; }
  get innerHTML() { return this._html; }
  set innerHTML(html) {
    this._html = String(html);
    this.childNodes = parseFragment(this._html, this);
  }
  addEventListener() { }
  removeEventListener() { }
  setPointerCapture() { }
  releasePointerCapture() { }
  focus() { }
  click() { if (typeof this.onclick === 'function') this.onclick({ target: this, stopPropagation() { }, preventDefault() { } }); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600, right: 800, bottom: 600 }; }
  // --- selectors: tag, .class, #id, [attr], and a single level of descendant ---
  querySelectorAll(selector) {
    const out = [];
    for (const part of String(selector).split(',').map(s => s.trim()).filter(Boolean)) {
      const steps = part.split(/\s+/);
      let scope = [this];
      for (const step of steps) scope = scope.flatMap(node => descendants(node).filter(el => matches(el, step)));
      for (const el of scope) if (!out.includes(el)) out.push(el);
    }
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  matches(selector) { return String(selector).split(',').some(s => matches(this, s.trim())); }
  closest(selector) { let n = this; while (n) { if (n.matches && n.matches(selector)) return n; n = n.parentNode; } return null; }
  // --- canvas and svg surface ---
  getContext() { return makeContext2D(); }
  toDataURL() { return 'data:image/png;base64,'; }
  createSVGPoint() { return { x: 0, y: 0, matrixTransform: () => ({ x: 0, y: 0 }) }; }
  getScreenCTM() { return { inverse: () => ({}) }; }
}

function descendants(node) {
  const out = [];
  const walk = n => { for (const c of n.childNodes) { out.push(c); walk(c); } };
  walk(node);
  return out;
}
function matches(el, step) {
  if (!el || !el.tagName) return false;
  const m = step.match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)((?:\[[^\]]+\])*)$/);
  if (!m) return false;
  const [, tag, chunk, attrs] = m;
  if (tag && el.tagName !== tag.toUpperCase()) return false;
  for (const token of chunk.match(/[.#][\w-]+/g) || []) {
    if (token[0] === '.' && !el._classes.has(token.slice(1))) return false;
    if (token[0] === '#' && el.id !== token.slice(1)) return false;
  }
  for (const token of attrs.match(/\[[^\]]+\]/g) || []) {
    const [k, v] = token.slice(1, -1).split('=');
    if (!(k in el.attributes)) return false;
    if (v !== undefined && el.attributes[k] !== v.replace(/^["']|["']$/g, '')) return false;
  }
  return true;
}

// Stack-based tag reader. Text content is kept only as the concatenated text of a node.
export function parseFragment(html, parent = null) {
  const roots = [];
  const stack = [];
  const tagRe = /<\/?([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  let last = 0, m;
  const addText = text => {
    if (!text.trim()) return;
    const host = stack[stack.length - 1];
    if (host) host.textContent += text.replace(/<[^>]*>/g, '');
  };
  while ((m = tagRe.exec(html))) {
    addText(html.slice(last, m.index));
    last = tagRe.lastIndex;
    const [full, tag, attrText, selfClose] = m;
    if (full[1] === '/') { stack.pop(); continue; }
    const attrs = {};
    const attrRe = /([\w:-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
    let a;
    while ((a = attrRe.exec(attrText))) attrs[a[1]] = a[2] ?? a[3] ?? a[4] ?? '';
    const el = new FakeElement(tag, attrs);
    const host = stack[stack.length - 1];
    if (host) { el.parentNode = host; host.childNodes.push(el); } else { el.parentNode = parent; roots.push(el); }
    if (!selfClose && !VOID.has(tag.toLowerCase())) stack.push(el);
  }
  addText(html.slice(last));
  return roots;
}

function makeContext2D() {
  const noop = () => { };
  const gradient = { addColorStop: noop };
  return new Proxy({
    canvas: null, measureText: () => ({ width: 8, actualBoundingBoxAscent: 6, actualBoundingBoxDescent: 2 }),
    createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    createLinearGradient: () => gradient, createRadialGradient: () => gradient, createPattern: () => ({}),
    isPointInPath: () => false, getLineDash: () => []
  }, { get: (t, k) => (k in t ? t[k] : (typeof k === 'string' ? noop : undefined)), set: (t, k, v) => { t[k] = v; return true; } });
}

export function makeDocument(bodyHtml) {
  const root = new FakeElement('body');
  root.childNodes = parseFragment(bodyHtml, root);
  const byId = new Map();
  for (const el of descendants(root)) if (el.id) byId.set(el.id, el);
  const doc = {
    body: root,
    documentElement: new FakeElement('html'),
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve(), add: () => { } },
    getElementById: id => byId.get(id) || null,
    querySelector: s => root.querySelector(s),
    querySelectorAll: s => root.querySelectorAll(s),
    createElement: tag => { const el = new FakeElement(tag); if (tag === 'canvas') { el.width = 1; el.height = 1; } return el; },
    createElementNS: (ns, tag) => doc.createElement(tag),
    addEventListener: () => { }, removeEventListener: () => { },
    _root: root, _byId: byId
  };
  return doc;
}
