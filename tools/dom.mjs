//============================================================================================================================================
// 🧪 tools/dom.mjs — A micro DOM, just enough of one to run the real editor in Node
//============================================================================================================================================
// There is no browser in CI, and the expensive bugs in an editor like this are not in the kernel (that has Check.js) but in the wiring: a panel that
//    touches a member the viewport never had, a hotkey bound twice, a tool that starts a session no prompt answers. All of that is plain JavaScript
//    against a very small slice of the DOM, so the slice is implemented here — about 150 lines — and the app boots for real: same modules, same boot().
// Deliberately unsupported: layout, CSS, events bubbling, hit-testing, text measurement. Anything the app needs beyond this is a missing feature in the
//    app, not in the harness — the error it throws is the point.
export function installDom({ width = 1600, height = 900 } = {}) {
    let unique = 0;
    class El {
        constructor(tag) {
            this.tagName = String(tag).toUpperCase();
            this.uid = ++unique;
            this.childNodes = [];
            this.parentNode = null;
            this.attrs = {};
            this.handlers = new Map();
            this.classes = new Set();
            this.style = makeStyle();
            this.dataset = {};
            this.value = '';
            this.checked = false;
            this._text = '';
            this.width = 300; this.height = 150;
            const self = this;
            this.classList = {
                add: (...c) => c.forEach((x) => self.classes.add(x)),
                remove: (...c) => c.forEach((x) => self.classes.delete(x)),
                toggle: (c, force) => { const on = force === undefined ? !self.classes.has(c) : !!force; on ? self.classes.add(c) : self.classes.delete(c); return on; },
                contains: (c) => self.classes.has(c),
            };
        }
        get className() { return Array.from(this.classes).join(' '); }
        set className(v) { this.classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
        get children() { return this.childNodes.filter((n) => n instanceof El); }
        get parentElement() { return this.parentNode; }
        setAttribute(k, v) {
            this.attrs[k] = String(v);
            if (k === 'value') this.value = String(v);
            if (k === 'class') this.className = v;
        }
        getAttribute(k) { return this.attrs[k] ?? null; }
        removeAttribute(k) { delete this.attrs[k]; }
        append(...nodes) { for (const n of nodes) { if (n == null || n === false) continue; const kid = typeof n === 'object' ? n : new Text(String(n)); kid.parentNode = this; this.childNodes.push(kid); } }
        appendChild(n) { this.append(n); return n; }
        replaceChildren(...nodes) { this.childNodes = []; this.append(...nodes); }
        insertBefore(n, ref) { const i = this.childNodes.indexOf(ref); this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, n); n.parentNode = this; return n; }
        contains(n) { for (const c of this.walk()) if (c === n) return true; return false; }
        remove() { if (this.parentNode) this.parentNode.childNodes = this.parentNode.childNodes.filter((c) => c !== this); }
        get textContent() { return this.childNodes.map((c) => c.textContent).join(''); }
        set textContent(v) { this._text = String(v); this.childNodes = [new Text(this._text)]; this.childNodes[0].parentNode = this; }
        set innerHTML(v) { this._html = String(v); this.childNodes = [new Text(String(v).replace(/<[^>]*>/g, ''))]; }
        get innerHTML() { return this._html || ''; }
        addEventListener(t, fn) { if (!this.handlers.has(t)) this.handlers.set(t, []); this.handlers.get(t).push(fn); }
        removeEventListener(t, fn) { const a = this.handlers.get(t); if (a) this.handlers.set(t, a.filter((f) => f !== fn)); }
        dispatch(type, ev = {}) {
            const list = this.handlers.get(type) || [];
            for (const fn of list) fn({ type, target: this, currentTarget: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { }, button: 0, bubbles: true, ...ev });
            const inline = this['on' + type];
            if (typeof inline === 'function') inline({ type, target: this, preventDefault() { } });
            return list.length > 0 || !!inline;
        }
        focus() { document.activeElement = this; }
        blur() { if (document.activeElement === this) document.activeElement = null; }
        click() { this.dispatch('click'); if (typeof this.onclick === 'function') this.onclick({ preventDefault() { }, target: this }); }
        getBoundingClientRect() { return { left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0 }; }
        getContext(kind) { return kind === '2d' ? (this._ctx || (this._ctx = makeCtx2D())) : null; }
        /** Depth-first walk over every element below this one. */
        *walk() { for (const c of this.children) { yield c; yield* c.walk(); } }
        matches(sel) {
            if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
            if (sel.startsWith('#')) return this.id === sel.slice(1) || this.attrs.id === sel.slice(1);
            return this.tagName === sel.toUpperCase();
        }
        querySelectorAll(sel) { const out = []; for (const n of this.walk()) if (n.matches(sel)) out.push(n); return out; }
        querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
        get id() { return this.attrs.id || ''; }
        set id(v) { this.attrs.id = v; }
    }
    class Text {
        constructor(s) { this.nodeType = 3; this.textContent = String(s); this.parentNode = null; }
        get children() { return []; }
        walk() { return [][Symbol.iterator](); }
    }
    function makeStyle() {
        const s = {};
        Object.defineProperty(s, 'cssText', { set(v) { for (const part of String(v).split(';')) { const [k, val] = part.split(':').map((x) => x && x.trim()); if (k) s[k.replace(/-([a-z])/g, (m, c) => c.toUpperCase())] = val; } }, get() { return ''; }, enumerable: false });
        s.setProperty = (k, v) => { s[k] = v; };
        return s;
    }
    /** A canvas 2D context that records its calls, so the minimap can be exercised and the drawing order inspected without pixels. */
    function makeCtx2D() {
        const log = [];
        const noop = (name) => (...args) => { log.push([name, args.length]); };
        return new Proxy({ __log: log }, {
            get(t, k) {
                if (k in t) return t[k];
                if (['canvas', 'measureText'].includes(k)) return k === 'measureText' ? () => ({ width: 6 }) : { width: 300, height: 150 };
                return noop(k);
            },
            set(t, k, v) { t[k] = v; return true; },
        });
    }

    const document = {
        activeElement: null,
        createElement: (tag) => new El(tag),
        createTextNode: (s) => new Text(s),
        body: new El('body'),
        documentElement: new El('html'),
        getElementById(id) { for (const n of this.body.walk()) if (n.id === id) return n; return this.body.childNodes.find((c) => c instanceof El && c.id === id) || null; },
        addEventListener: (t, fn) => { (windowHandlers[t] || (windowHandlers[t] = [])).push(fn); },
        removeEventListener: () => { },
        querySelector(sel) { return this.body.querySelector(sel); },
        querySelectorAll(sel) { return this.body.querySelectorAll(sel); },
    };
    const windowHandlers = {};
    const window = {
        innerWidth: width, innerHeight: height, devicePixelRatio: 1,
        addEventListener: (t, fn) => { (windowHandlers[t] || (windowHandlers[t] = [])).push(fn); },
        removeEventListener: () => { },
        dispatch(type, ev = {}) { for (const fn of windowHandlers[type] || []) fn({ type, preventDefault() { this.defaultPrevented = true; }, ...ev }); },
        requestAnimationFrame: (fn) => rafQueue.push(fn),
        cancelAnimationFrame: () => { },
        localStorage: store(),
        matchMedia: () => ({ matches: false, addEventListener() { }, addListener() { } }),
        Blob: class Blob { constructor(parts) { this.parts = parts; this.size = parts.reduce((a, p) => a + String(p).length, 0); this.type = (parts[1] || {}).type; } },
        URL: Object.assign(globalThis.URL || URL, { createObjectURL: () => 'blob:stub', revokeObjectURL: () => { } }),
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
    };
    const rafQueue = [];
    function store() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), clear: () => m.clear() }; }

    const appHost = new El('div');
    appHost.setAttribute('id', 'app');
    document.body.append(appHost);

    // Node already owns some of these names (`navigator` is a getter), so define rather than assign.
    const def = (k, v) => Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true, enumerable: true });
    def('window', window);
    def('document', document);
    def('requestAnimationFrame', window.requestAnimationFrame);
    def('cancelAnimationFrame', window.cancelAnimationFrame);
    def('addEventListener', window.addEventListener);
    def('removeEventListener', window.removeEventListener);
    def('localStorage', window.localStorage);
    def('Blob', window.Blob);
    def('self', window);
    if (!globalThis.navigator) def('navigator', { userAgent: 'node', platform: 'linux' });
    def('__el', El);
    def('__text', Text);
    return {
        El, Text, document, window, host: appHost,
        /** Drain up to n queued animation frames (the render loop re-queues itself). */
        tick(n = 3) {
            for (let i = 0; i < n; ++i) {
                const q = rafQueue.splice(0, rafQueue.length);
                for (const fn of q) fn(performance.now());
            }
        },
        key(k, mods = {}) { window.dispatch('keydown', { key: k, ...mods }); },
    };
}
