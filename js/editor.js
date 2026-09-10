// Canvas node-graph editor: render + pan/zoom/select/move/connect/delete.
import { NODE_DEFS, CATS } from './graph.js';

const NW = 168, HEAD = 26, ROW = 18, SOCK_R = 5;

export class NodeEditor {
  constructor(canvas, graph, cb = {}) {
    this.c = canvas; this.g = graph; this.cb = cb;
    this.ctx = canvas.getContext('2d');
    this.pan = { x: 60, y: 40 }; this.zoom = 1;
    this.sel = new Set(); this.hover = null; this.hoverSock = null;
    this.dragNode = null; this.dragOff = { x: 0, y: 0 }; this.moved = false;
    this.panning = false; this.panStart = null;
    this.linkDrag = null; // {a, ax, ay}
    this.mouse = { x: 0, y: 0 };
    this.quickCb = null;
    this.bind();
    this.resize();
  }
  resize() {
    const r = this.c.getBoundingClientRect();
    const pr = Math.min(devicePixelRatio || 1, 2);
    this.c.width = Math.max(2, r.width * pr); this.c.height = Math.max(2, r.height * pr);
    this.pr = pr;
  }
  toWorld(px, py) { return [(px - this.pan.x) / this.zoom, (py - this.pan.y) / this.zoom]; }
  nodeH(n) {
    const def = NODE_DEFS[n.type];
    const rows = Math.max(def.inputs.length, 1);
    return HEAD + rows * ROW + 22;
  }
  sockPos(n, side, idx) {
    if (side === 'out') return [n.x + NW, n.y + HEAD + ROW * 0.5];
    return [n.x, n.y + HEAD + ROW * (idx + 0.5)];
  }
  bind() {
    const c = this.c;
    c.addEventListener('pointerdown', e => {
      c.setPointerCapture(e.pointerId);
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      this.mouse = { x: px, y: py };
      const [wx, wy] = this.toWorld(px, py);
      if (e.button === 1 || e.button === 2 || e.shiftKey) { this.panning = true; this.panStart = { px, py, x: this.pan.x, y: this.pan.y }; return; }
      // socket?
      const s = this.pickSock(wx, wy);
      if (s) {
        if (s.side === 'out') { this.linkDrag = { a: s.node.id, x: px, y: py }; }
        else {
          // drag from input: start rewire if linked
          const l = this.g.inputLink(s.node.id, s.idx);
          if (l) { this.g.links = this.g.links.filter(x => x !== l); this.linkDrag = { a: l.a, x: px, y: py }; this.cb.onLinkChange && this.cb.onLinkChange(); }
        }
        return;
      }
      const n = this.pickNode(wx, wy);
      if (n) {
        if (!e.ctrlKey && !e.metaKey) this.sel.clear();
        this.sel.has(n.id) ? (e.ctrlKey || e.metaKey) && this.sel.delete(n.id) : this.sel.add(n.id);
        this.dragNode = n; this.moved = false;
        this.dragOff = { x: wx - n.x, y: wy - n.y };
        this.cb.onSelect && this.cb.onSelect(n);
      } else {
        this.sel.clear();
        this.cb.onSelect && this.cb.onSelect(null);
        this.panning = true; this.panStart = { px, py, x: this.pan.x, y: this.pan.y };
      }
    });
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      this.mouse = { x: px, y: py };
      const [wx, wy] = this.toWorld(px, py);
      if (this.linkDrag) { this.linkDrag.x = px; this.linkDrag.y = py; return; }
      if (this.panning && this.panStart) {
        this.pan.x = this.panStart.x + (px - this.panStart.px);
        this.pan.y = this.panStart.y + (py - this.panStart.py);
        return;
      }
      if (this.dragNode) {
        const dx = wx - this.dragOff.x - this.dragNode.x, dy = wy - this.dragOff.y - this.dragNode.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) this.moved = true;
        for (const id of this.sel) { const n = this.g.nodes.get(id); if (n) { n.x += dx; n.y += dy; } }
        return;
      }
      this.hover = this.pickNode(wx, wy);
      this.hoverSock = this.pickSock(wx, wy);
      c.style.cursor = this.hoverSock ? 'crosshair' : this.hover ? 'move' : 'default';
    });
    const up = e => {
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const [wx, wy] = this.toWorld(px, py);
      if (this.linkDrag) {
        const s = this.pickSock(wx, wy);
        if (s && s.side === 'in' && s.node.id !== this.linkDrag.a) {
          if (this.g.connect(this.linkDrag.a, 0, s.node.id, s.idx)) this.cb.onLinkChange && this.cb.onLinkChange();
          else this.cb.onToast && this.cb.onToast('Cannot connect (cycle or invalid)', 'warn');
        }
        this.linkDrag = null;
      }
      if (this.dragNode && this.moved) this.cb.onMoveEnd && this.cb.onMoveEnd();
      this.dragNode = null; this.panning = false; this.panStart = null;
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', () => { this.linkDrag = null; this.dragNode = null; this.panning = false; });
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
      const [wx, wy] = this.toWorld(px, py);
      const z0 = this.zoom;
      this.zoom = Math.min(1.8, Math.max(0.3, this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      this.pan.x = px - wx * this.zoom; this.pan.y = py - wy * this.zoom;
    }, { passive: false });
    c.addEventListener('dblclick', e => {
      const r = c.getBoundingClientRect();
      const [wx, wy] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      if (!this.pickNode(wx, wy)) this.cb.onQuickAdd && this.cb.onQuickAdd(e.clientX - r.left, e.clientY - r.top, wx, wy);
    });
    c.addEventListener('contextmenu', e => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const [wx, wy] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      const n = this.pickNode(wx, wy);
      if (n) { this.sel.clear(); this.sel.add(n.id); this.cb.onSelect && this.cb.onSelect(n); this.cb.onNodeMenu && this.cb.onNodeMenu(n, e.clientX, e.clientY); }
    });
  }
  pickNode(wx, wy) {
    for (const n of [...this.g.nodes.values()].reverse()) {
      if (wx >= n.x && wx <= n.x + NW && wy >= n.y && wy <= n.y + this.nodeH(n)) return n;
    }
    return null;
  }
  pickSock(wx, wy) {
    for (const n of this.g.nodes.values()) {
      const def = NODE_DEFS[n.type];
      const [ox, oy] = this.sockPos(n, 'out', 0);
      if (Math.hypot(wx - ox, wy - oy) < 10) return { node: n, side: 'out', idx: 0 };
      for (let i = 0; i < def.inputs.length; i++) {
        const [ix, iy] = this.sockPos(n, 'in', i);
        if (Math.hypot(wx - ix, wy - iy) < 10) return { node: n, side: 'in', idx: i };
      }
    }
    return null;
  }
  centerOn(wx, wy) {
    const r = this.c.getBoundingClientRect();
    this.pan.x = r.width / 2 - wx * this.zoom;
    this.pan.y = r.height / 2 - wy * this.zoom;
  }
  fit() {
    const nodes = [...this.g.nodes.values()];
    if (!nodes.length) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const n of nodes) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + NW); y1 = Math.max(y1, n.y + this.nodeH(n)); }
    const r = this.c.getBoundingClientRect();
    const zw = (r.width - 80) / Math.max(1, x1 - x0), zh = (r.height - 60) / Math.max(1, y1 - y0);
    this.zoom = Math.min(1.4, Math.max(0.3, Math.min(zw, zh)));
    this.pan.x = (r.width - (x1 - x0) * this.zoom) / 2 - x0 * this.zoom;
    this.pan.y = (r.height - (y1 - y0) * this.zoom) / 2 - y0 * this.zoom;
  }
  autoLayout() {
    // layered layout by topo depth
    const order = this.g.topo();
    const depth = new Map();
    for (const n of order) {
      let d = 0;
      for (const l of this.g.links) if (l.b === n.id) d = Math.max(d, (depth.get(l.a) || 0) + 1);
      depth.set(n.id, d);
    }
    const cols = new Map();
    for (const n of order) {
      const d = depth.get(n.id) || 0;
      const row = cols.get(d) || 0; cols.set(d, row + 1);
      n.x = d * 220 - 200; n.y = row * 130 - 60;
    }
  }
  draw() {
    const ctx = this.ctx, pr = this.pr || 1;
    const W = this.c.width, H = this.c.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#080b10';
    ctx.fillRect(0, 0, W, H);
    // dot grid
    ctx.fillStyle = '#141b26';
    const gs = 26 * this.zoom;
    const ox = this.pan.x * pr % gs, oy = this.pan.y * pr % gs;
    for (let y = oy; y < H; y += gs) for (let x = ox; x < W; x += gs) {
      ctx.fillRect(x < 0 ? x + gs : x, y < 0 ? y + gs : y, 1.6 * pr, 1.6 * pr);
    }
    ctx.setTransform(pr * this.zoom, 0, 0, pr * this.zoom, pr * this.pan.x, pr * this.pan.y);
    ctx.lineWidth = 1 / this.zoom;
    // links
    for (const l of this.g.links) {
      const a = this.g.nodes.get(l.a), b = this.g.nodes.get(l.b);
      if (!a || !b) continue;
      const [ax, ay] = this.sockPos(a, 'out', 0);
      const [bx, by] = this.sockPos(b, 'in', l.bi);
      this.bezier(ax, ay, bx, by, '#4cd7c4', 2.2);
    }
    if (this.linkDrag) {
      const a = this.g.nodes.get(this.linkDrag.a);
      if (a) {
        const [ax, ay] = this.sockPos(a, 'out', 0);
        const [wx, wy] = this.toWorld(this.linkDrag.x, this.linkDrag.y);
        this.bezier(ax, ay, wx, wy, '#ffb454', 2.2);
      }
    }
    // nodes
    ctx.textBaseline = 'middle';
    for (const n of this.g.nodes.values()) this.drawNode(n);
  }
  bezier(ax, ay, bx, by, col, w) {
    const ctx = this.ctx, dx = Math.max(40, Math.abs(bx - ax) * 0.5);
    ctx.strokeStyle = col; ctx.lineWidth = w / this.zoom;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.bezierCurveTo(ax + dx, ay, bx - dx, by, bx, by);
    ctx.stroke();
  }
  roundRect(x, y, w, h, r) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  drawNode(n) {
    const ctx = this.ctx, def = NODE_DEFS[n.type], cat = CATS[def.cat];
    const h = this.nodeH(n), sel = this.sel.has(n.id);
    ctx.save();
    if (n.bypass) ctx.globalAlpha = 0.55;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    this.roundRect(n.x + 3, n.y + 4, NW, h, 8); ctx.fill();
    // body
    ctx.fillStyle = '#0e141d';
    this.roundRect(n.x, n.y, NW, h, 8); ctx.fill();
    ctx.strokeStyle = sel ? '#5aa2ff' : '#26303f';
    ctx.lineWidth = (sel ? 2 : 1.2) / this.zoom;
    this.roundRect(n.x, n.y, NW, h, 8); ctx.stroke();
    // head
    ctx.fillStyle = cat.color + '22';
    this.roundRect(n.x, n.y, NW, HEAD, 8); ctx.fill();
    ctx.fillRect(n.x, n.y + HEAD - 8, NW, 8);
    ctx.fillStyle = cat.color;
    ctx.fillRect(n.x + 9, n.y + 8, 3, HEAD - 16);
    ctx.fillStyle = '#e6edf5';
    ctx.font = '600 12px Inter, system-ui, sans-serif';
    ctx.fillText(def.title, n.x + 18, n.y + HEAD / 2 + 0.5);
    // status dot
    let dot = '#5fd08a';
    if (n.err) dot = '#ff6b5e'; else if (n.dirty) dot = '#ffb454';
    else if (n.sim && n.sim.active) dot = '#4cd7c4';
    ctx.fillStyle = dot;
    ctx.beginPath(); ctx.arc(n.x + NW - 12, n.y + HEAD / 2, 4, 0, 7); ctx.fill();
    // sockets + labels
    ctx.font = '11px Inter, system-ui, sans-serif';
    if (n.type !== 'output') {
      const [ox, oy] = this.sockPos(n, 'out', 0);
      ctx.fillStyle = '#4cd7c4';
      ctx.beginPath(); ctx.arc(ox, oy, SOCK_R, 0, 7); ctx.fill();
      ctx.fillStyle = '#0e141d';
      ctx.beginPath(); ctx.arc(ox, oy, SOCK_R - 2.2, 0, 7); ctx.fill();
    }
    def.inputs.forEach((nm, i) => {
      const [ix, iy] = this.sockPos(n, 'in', i);
      ctx.fillStyle = '#8b98a9';
      ctx.beginPath(); ctx.arc(ix, iy, SOCK_R, 0, 7); ctx.fill();
      ctx.fillStyle = '#0e141d';
      ctx.beginPath(); ctx.arc(ix, iy, SOCK_R - 2.2, 0, 7); ctx.fill();
      ctx.fillStyle = '#8b98a9';
      ctx.fillText(nm, n.x + 12, iy);
    });
    // param summary
    ctx.fillStyle = '#5a6575';
    ctx.font = '10px "JetBrains Mono", monospace';
    const ps = this.summarize(n);
    ctx.fillText(ps, n.x + 12, n.y + h - 11, NW - 24);
    if (n.err) { ctx.fillStyle = '#ff6b5e'; ctx.fillText(n.err.slice(0, 24), n.x + 12, n.y + h - 11, NW - 24); }
    ctx.restore();
  }
  summarize(n) {
    const p = n.params, keys = Object.keys(p);
    if (!keys.length) return n.type === 'output' ? 'final ▸ viewport' : '';
    const fmt = v => typeof v === 'number' ? (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1)) : String(v);
    return keys.slice(0, 3).map(k => `${k} ${fmt(p[k])}`).join('  ');
  }
}
