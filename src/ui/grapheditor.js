// Node graph editor — draggable nodes, bezier wires, pan/zoom, add-menu.
import { DEFS, CAT, makeNode } from '../core/graph.js';
import { el } from './widgets.js';

export class GraphEditor {
  constructor(app) {
    this.app = app;
    this.drawer = document.getElementById('graphdrawer');
    this.canvas = document.getElementById('gdcanvas');
    this.nodesEl = document.getElementById('gdnodes');
    this.wires = document.getElementById('gdwires');
    this.pan = [40, 20];
    this.zoom = 1;
    this.dragging = null;   // {kind:'node'|'pan'|'wire', ...}
    this.elMap = new Map(); // nodeId -> {root, ports}
    this.wireMap = new Map(); // key -> path
    this.bind();
  }

  show(v) {
    this.drawer.classList.toggle('hid', !v);
    this.app.graphOpen = v;
    if (v) this.sync();
  }

  bind() {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      if (e.target === cv || e.target === this.nodesEl || e.target === this.wires) {
        this.dragging = { kind: 'pan', x: e.clientX, y: e.clientY, pan: [this.pan[0], this.pan[1]] };
        cv.setPointerCapture(e.pointerId);
        cv.classList.add('pan');
        this.app.select(null);
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      if (this.dragging.kind === 'pan') {
        this.pan[0] = this.dragging.pan[0] + (e.clientX - this.dragging.x);
        this.pan[1] = this.dragging.pan[1] + (e.clientY - this.dragging.y);
        this.apply();
      } else if (this.dragging.kind === 'node') {
        const n = this.dragging.node;
        n.x = Math.round((e.clientX - this.dragging.ox - this.pan[0]) / this.zoom);
        n.y = Math.round((e.clientY - this.dragging.oy - this.pan[1]) / this.zoom);
        this.dragging.el.style.left = `${n.x}px`;
        this.dragging.el.style.top = `${n.y}px`;
        this.drawWires();
      } else if (this.dragging.kind === 'wire') {
        this.tempWire(e.clientX, e.clientY);
      }
    });
    const up = (e) => {
      if (this.dragging && this.dragging.kind === 'wire') this.dropWire(e);
      this.dragging = null;
      cv.classList.remove('pan');
      this.clearTemp();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const k = Math.exp(-e.deltaY * 0.0011);
      const nz = Math.min(Math.max(this.zoom * k, 0.45), 1.6);
      // zoom toward cursor
      const r = cv.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      this.pan[0] = mx - (mx - this.pan[0]) * (nz / this.zoom);
      this.pan[1] = my - (my - this.pan[1]) * (nz / this.zoom);
      this.zoom = nz;
      this.apply();
    }, { passive: false });
    cv.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.app.addMenu(e.clientX, e.clientY, (type) => {
        const r = cv.getBoundingClientRect();
        const n = makeNode(type, (e.clientX - r.left - this.pan[0]) / this.zoom, (e.clientY - r.top - this.pan[1]) / this.zoom);
        this.app.graph.add(n);
        this.app.select(n.id);
      });
    });
    // drawer grip resize
    const grip = document.getElementById('gdgrip');
    grip.addEventListener('pointerdown', (e) => {
      grip.setPointerCapture(e.pointerId);
      const h0 = this.drawer.offsetHeight, y0 = e.clientY;
      const move = (ev) => {
        const h = Math.min(Math.max(h0 + (y0 - ev.clientY), 180), Math.floor(window.innerHeight * 0.7));
        this.drawer.style.height = `${h}px`;
      };
      const end = () => {
        grip.removeEventListener('pointermove', move);
        grip.removeEventListener('pointerup', end);
      };
      grip.addEventListener('pointermove', move);
      grip.addEventListener('pointerup', end);
    });
  }

  apply() {
    this.nodesEl.style.transform = `translate(${this.pan[0]}px,${this.pan[1]}px) scale(${this.zoom})`;
    this.wires.style.transform = `translate(${this.pan[0]}px,${this.pan[1]}px) scale(${this.zoom})`;
    this.wires.setAttribute('width', '100%');
    this.drawWires();
  }

  sync() {
    // rebuild node DOM to match the graph
    const app = this.app;
    const seen = new Set();
    app.graph.nodes.forEach(n => {
      seen.add(n.id);
      if (!this.elMap.has(n.id)) this.makeNodeEl(n);
      this.updateNodeEl(n);
    });
    for (const [id, rec] of [...this.elMap]) {
      if (!seen.has(id)) { rec.root.remove(); this.elMap.delete(id); }
    }
    this.drawWires();
  }

  makeNodeEl(n) {
    const app = this.app;
    const def = DEFS[n.type];
    const root = el('div', 'gnode', this.nodesEl);
    root.dataset.id = n.id;
    const head = el('div', 'ghead', root);
    const dot = el('span', 'gdot', head);
    dot.style.background = CAT[def.cat].color;
    dot.style.boxShadow = `0 0 10px ${CAT[def.cat].color}`;
    const nm = el('div', 'gname', head); nm.textContent = def.label;
    const tp = el('div', 'gtype', root); tp.textContent = CAT[def.cat].label;
    const meta = el('div', 'gmeta', root);
    // ports
    const ports = {};
    def.inputs.forEach((inp, i) => {
      const p = el('div', 'port in', root);
      p.style.top = `${18 + i * 17}px`;
      p.dataset.id = n.id; p.dataset.io = 'in'; p.dataset.slot = inp;
      ports['in_' + inp] = p;
      const lb = el('span', 'port-label in', root);
      lb.style.top = `${18 + i * 17}px`;
      lb.textContent = inp;
      p.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.dragging = { kind: 'wire', from: { id: n.id, io: 'in', slot: inp } };
        this.tempWire(e.clientX, e.clientY);
      });
    });
    if (def.output) {
      const p = el('div', 'port out', root);
      p.style.top = '21px';
      p.dataset.id = n.id; p.dataset.io = 'out';
      ports.out = p;
      p.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.dragging = { kind: 'wire', from: { id: n.id, io: 'out' } };
        this.tempWire(e.clientX, e.clientY);
      });
    }
    root.addEventListener('pointerdown', (e) => {
      if (e.target.classList.contains('port')) return;
      e.stopPropagation();
      this.app.select(n.id);
      this.dragging = { kind: 'node', node: n, el: root, ox: e.clientX - (n.x * this.zoom + this.pan[0]), oy: e.clientY - (n.y * this.zoom + this.pan[1]) };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.elMap.set(n.id, { root, ports, meta, head });
  }

  updateNodeEl(n) {
    const rec = this.elMap.get(n.id);
    if (!rec) return;
    const def = DEFS[n.type];
    rec.root.style.left = `${n.x}px`;
    rec.root.style.top = `${n.y}px`;
    rec.root.classList.toggle('sel', this.app.selection === n.id);
    rec.root.classList.toggle('dim', !n.enabled);
    // key params as chips
    const keys = Object.keys(n.params).slice(0, 2);
    rec.meta.innerHTML = keys.map(k => `<span>${k} ${n.params[k]}</span>`).join('');
    // port fill state
    def.inputs.forEach(inp => {
      const p = rec.ports['in_' + inp];
      if (p) p.classList.toggle('filled', !!this.app.graph.inputOf(n.id, inp));
    });
    if (rec.ports.out) rec.ports.out.classList.add('filled');
  }

  portPos(id, io, slot) {
    const n = this.app.graph.node(id);
    const rec = this.elMap.get(id);
    if (!n || !rec) return null;
    const p = io === 'out' ? rec.ports.out : rec.ports['in_' + slot];
    if (!p) return null;
    return [n.x + p.offsetLeft + p.offsetWidth / 2, n.y + p.offsetTop + p.offsetHeight / 2];
  }

  wirePath(x1, y1, x2, y2) {
    const dx = Math.max(Math.abs(x2 - x1) * 0.5, 30);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  drawWires() {
    const app = this.app;
    const live = new Set();
    app.graph.links.forEach(l => {
      const key = `${l.from}-${l.to}-${l.toInput}`;
      live.add(key);
      let path = this.wireMap.get(key);
      if (!path) {
        path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        this.wires.appendChild(path);
        this.wireMap.set(key, path);
      }
      const a = this.portPos(l.from, 'out');
      const b = this.portPos(l.to, 'in', l.toInput);
      if (!a || !b) { path.setAttribute('d', ''); return; }
      path.setAttribute('d', this.wirePath(a[0], a[1], b[0], b[1]));
      const srcCat = DEFS[app.graph.node(l.from).type].cat;
      path.setAttribute('stroke', catStroke(srcCat));
      path.classList.toggle('hot', app.selection === l.from || app.selection === l.to);
    });
    for (const [key, path] of [...this.wireMap]) {
      if (!live.has(key)) { path.remove(); this.wireMap.delete(key); }
    }
  }

  // temp wire while dragging
  tempWire(cx, cy) {
    this.clearTemp();
    const r = this.canvas.getBoundingClientRect();
    const from = this.dragging.from;
    const a = this.portPos(from.id, from.io, from.slot);
    if (!a) return;
    const mx = (cx - r.left - this.pan[0]) / this.zoom;
    const my = (cy - r.top - this.pan[1]) / this.zoom;
    const [x1, y1] = from.io === 'out' ? a : [mx, my];
    const [x2, y2] = from.io === 'out' ? [mx, my] : a;
    this.temp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    this.temp.setAttribute('d', this.wirePath(x1, y1, x2, y2));
    this.temp.setAttribute('stroke', 'rgba(255,255,255,.65)');
    this.temp.setAttribute('stroke-dasharray', '5 4');
    this.wires.appendChild(this.temp);
  }
  clearTemp() {
    if (this.temp) { this.temp.remove(); this.temp = null; }
  }
  dropWire(e) {
    const elUnder = document.elementFromPoint(e.clientX, e.clientY);
    if (!elUnder) return;
    const port = elUnder.closest('.port');
    if (!port) return;
    const from = this.dragging.from;
    const toId = parseInt(port.dataset.id);
    const io = port.dataset.io;
    if (from.io === 'out' && io === 'in') this.app.graph.link(from.id, toId, port.dataset.slot);
    else if (from.io === 'in' && io === 'out') this.app.graph.link(parseInt(port.dataset.id), from.id, from.slot);
    this.app.onGraphStructure();
  }

  tidy() {
    // layered layout by topological depth
    const app = this.app;
    const depth = new Map();
    const calc = (n, d) => {
      if ((depth.get(n.id) ?? -1) >= d) return;
      depth.set(n.id, d);
      DEFS[n.type].inputs.forEach(inp => {
        const c = app.graph.inputOf(n.id, inp);
        if (c) calc(c, d + 1);
      });
    };
    const out = app.graph.outputNode();
    if (out) calc(out, 0);
    const colCount = new Map();
    [...depth.entries()].sort((a, b) => b[1] - a[1]).forEach(([id, d]) => {
      const n = app.graph.node(id);
      const col = colCount.get(d) || 0;
      colCount.set(d, col + 1);
      n.x = 60 + d * 218;
      n.y = 40 + col * 108;
    });
    this.sync();
  }
}

function catStroke(cat) {
  return { source: '#4fd8e0', pattern: '#b48cff', operator: '#e8e8e8', sim: '#ffb454', output: '#34c759' }[cat] || '#fff';
}
