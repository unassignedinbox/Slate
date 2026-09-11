// Canvas node-graph editor: pan/zoom, drag, typed connect, add-menu, delete.
import { NODE_TYPES, makeNode } from '../core/graph.js';

const NW = 196, HEAD_H = 26, ROW_H = 19, PORT_R = 6;
const LINK_COLOR = { field: '#7ee787', sim: '#6cb6ff' };

export class GraphEditor {
  constructor(canvas, menuEl, hooks = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.menu = menuEl; this.hooks = hooks;
    this.graph = null;
    this.cam = { x: 0, y: 0, z: 1 };
    this.sel = null; this.hover = null; this.hoverPort = null;
    this.drag = null; // {kind:'node'|'pan'|'link', ...}
    this.space = false;
    this._resize();
    new ResizeObserver(() => this._resize()).observe(canvas.parentElement);
    this._bind();
    this._draw();
  }
  setGraph(g) { this.graph = g; this.sel = null; this.fit(); this._draw(); }
  refresh() { this._draw(); }

  _resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.cv.width = Math.max(50, r.width - 0) * dpr;
    this.cv.height = Math.max(50, r.height - 32) * dpr;
    this.cv.style.height = Math.max(50, r.height - 32) + 'px';
    this.dpr = dpr;
    this._draw();
  }
  w2s(x, y) { return [(x - this.cam.x) * this.cam.z, (y - this.cam.y) * this.cam.z]; }
  s2w(x, y) {
    const r = this.cv.getBoundingClientRect();
    return [(x - r.left) / this.cam.z + this.cam.x, (y - r.top) / this.cam.z + this.cam.y];
  }
  nodeH(n) {
    const def = NODE_TYPES[n.type];
    const rows = Math.max(def.inputs.length, def.outputs.length, 1);
    const readouts = Math.min(def.params.filter(p => p.type === 'float' || p.type === 'int').length, 3);
    return HEAD_H + rows * ROW_H + 8 + readouts * 14;
  }
  portPos(n, portId, isOut) {
    const def = NODE_TYPES[n.type];
    const list = isOut ? def.outputs : def.inputs;
    const i = list.findIndex(p => p.id === portId);
    return [isOut ? n.x + NW : n.x, n.y + HEAD_H + i * ROW_H + ROW_H / 2];
  }

  _bind() {
    const cv = this.cv;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => this._down(e));
    window.addEventListener('pointermove', e => this._move(e));
    window.addEventListener('pointerup', e => this._up(e));
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      const [wx, wy] = this.s2w(e.clientX, e.clientY);
      const z0 = this.cam.z;
      this.cam.z = Math.min(2.2, Math.max(0.25, z0 * Math.exp(-e.deltaY * 0.0012)));
      const r = cv.getBoundingClientRect();
      this.cam.x = wx - (e.clientX - r.left) / this.cam.z;
      this.cam.y = wy - (e.clientY - r.top) / this.cam.z;
      this._draw();
    }, { passive: false });
    cv.addEventListener('dblclick', e => {
      const [wx, wy] = this.s2w(e.clientX, e.clientY);
      if (!this._hitNode(wx, wy)) this.openMenu(e.clientX, e.clientY);
    });
    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && document.activeElement === document.body) { this.space = true; e.preventDefault(); }
    });
    window.addEventListener('keyup', e => { if (e.code === 'Space') this.space = false; });
  }

  _hitNode(wx, wy) {
    if (!this.graph) return null;
    for (let i = this.graph.nodes.length - 1; i >= 0; i--) {
      const n = this.graph.nodes[i];
      if (wx >= n.x && wx <= n.x + NW && wy >= n.y && wy <= n.y + this.nodeH(n)) return n;
    }
    return null;
  }
  _hitPort(wx, wy) {
    if (!this.graph) return null;
    for (const n of this.graph.nodes) {
      const def = NODE_TYPES[n.type];
      for (const p of def.inputs) {
        const [px, py] = this.portPos(n, p.id, false);
        if (Math.hypot(wx - px, wy - py) < 10) return { node: n, port: p, isOut: false };
      }
      for (const p of def.outputs) {
        const [px, py] = this.portPos(n, p.id, true);
        if (Math.hypot(wx - px, wy - py) < 10) return { node: n, port: p, isOut: true };
      }
    }
    return null;
  }

  _down(e) {
    if (e.button === 2 && e.target !== this.cv) return;
    this.cv.setPointerCapture?.(e.pointerId);
    const [wx, wy] = this.s2w(e.clientX, e.clientY);
    this.closeMenu();
    if (e.button === 1 || this.space || e.button === 2) {
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y };
      return;
    }
    if (e.button !== 0) return;
    const hp = this._hitPort(wx, wy);
    if (hp) {
      this.drag = { kind: 'link', from: hp, mx: wx, my: wy };
      return;
    }
    const n = this._hitNode(wx, wy);
    if (n) {
      this.sel = n.id;
      this.hooks.onSelect?.(n.id);
      this.drag = { kind: 'node', node: n, dx: wx - n.x, dy: wy - n.y, moved: false };
    } else {
      this.sel = null;
      this.hooks.onSelect?.(null);
      this.drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, cx: this.cam.x, cy: this.cam.y };
    }
    this._draw();
  }
  _move(e) {
    if (!this.drag) {
      if (e.target === this.cv) {
        const [wx, wy] = this.s2w(e.clientX, e.clientY);
        this.hover = this._hitNode(wx, wy);
        this.hoverPort = this._hitPort(wx, wy);
        this.cv.style.cursor = this.hoverPort ? 'crosshair' : this.hover ? 'grab' : 'default';
        this._draw();
      }
      return;
    }
    if (this.drag.kind === 'pan') {
      this.cam.x = this.drag.cx - (e.clientX - this.drag.sx) / this.cam.z;
      this.cam.y = this.drag.cy - (e.clientY - this.drag.sy) / this.cam.z;
    } else if (this.drag.kind === 'node') {
      const [wx, wy] = this.s2w(e.clientX, e.clientY);
      this.drag.node.x = Math.round(wx - this.drag.dx);
      this.drag.node.y = Math.round(wy - this.drag.dy);
      this.drag.moved = true;
    } else if (this.drag.kind === 'link') {
      const [wx, wy] = this.s2w(e.clientX, e.clientY);
      this.drag.mx = wx; this.drag.my = wy;
      this.hoverPort = this._hitPort(wx, wy);
    }
    this._draw();
  }
  _up(e) {
    const d = this.drag; this.drag = null;
    if (!d) return;
    if (d.kind === 'node' && d.moved) this.hooks.onMove?.();
    if (d.kind === 'link') {
      const [wx, wy] = this.s2w(e.clientX, e.clientY);
      const hp = this._hitPort(wx, wy);
      const a = d.from;
      if (hp && hp.node.id !== a.node.id && hp.isOut !== a.isOut) {
        const out = a.isOut ? a : hp, inp = a.isOut ? hp : a;
        if (out.port.type === inp.port.type) {
          const r = this.graph.connect(out.node.id, out.port.id, inp.node.id, inp.port.id);
          if (r.ok) this.hooks.onStructure?.();
          else this.hooks.onError?.(r.error);
        } else this.hooks.onError?.('port type mismatch');
      } else if (hp && hp.node.id === a.node.id) {
        this.hooks.onError?.('cannot connect a node to itself');
      }
    }
    this._draw();
  }

  deleteSelected() {
    if (!this.sel || !this.graph) return;
    const n = this.graph.getNode(this.sel);
    if (!n || n.type === 'output') { this.hooks.onError?.('the Output node cannot be deleted'); return; }
    this.graph.removeNode(this.sel);
    this.sel = null;
    this.hooks.onSelect?.(null);
    this.hooks.onStructure?.();
    this._draw();
  }
  addNodeAt(type, sx, sy) {
    const [wx, wy] = this.s2w(sx, sy);
    const n = makeNode(type, Math.round(wx - NW / 2), Math.round(wy - 30));
    this.graph.addNode(n);
    this.sel = n.id;
    this.hooks.onSelect?.(n.id);
    this.hooks.onStructure?.();
    this._draw();
    return n;
  }
  openMenu(sx, sy) {
    const m = this.menu;
    m.innerHTML = '';
    const groups = [
      ['Sources', ['ground', 'box', 'sphere', 'ellipsoid', 'capsule', 'torus', 'cylinder', 'mesa']],
      ['Generators', ['mountain', 'hills', 'plateau', 'dunes', 'canyon', 'caves']],
      ['Combine', ['union', 'smoothUnion', 'subtract', 'intersect']],
      ['Modify', ['fbmDisplace', 'ridgedDisplace', 'terrace', 'warp', 'transform', 'materialPaint']],
      ['Simulate', ['rain', 'river', 'wind', 'thermal', 'rockfall', 'lake']],
    ];
    for (const [title, types] of groups) {
      const h = document.createElement('h5'); h.textContent = title; m.appendChild(h);
      for (const t of types) {
        const b = document.createElement('button');
        const dot = document.createElement('i');
        dot.style.background = NODE_TYPES[t].color;
        b.appendChild(dot);
        b.appendChild(document.createTextNode(NODE_TYPES[t].title));
        b.title = NODE_TYPES[t].desc;
        b.onclick = (ev) => { ev.stopPropagation(); this.closeMenu(); this.addNodeAt(t, sx, sy); };
        m.appendChild(b);
      }
    }
    const wrap = this.cv.parentElement.getBoundingClientRect();
    m.style.left = Math.min(sx - wrap.left, wrap.width - 260) + 'px';
    m.style.top = Math.min(sy - wrap.top, wrap.height - 350) + 'px';
    m.classList.remove('hidden');
  }
  closeMenu() { this.menu.classList.add('hidden'); }
  fit() {
    if (!this.graph || this.graph.nodes.length === 0) return;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const n of this.graph.nodes) {
      x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + NW); y1 = Math.max(y1, n.y + this.nodeH(n));
    }
    const r = this.cv.getBoundingClientRect();
    const zw = r.width / (x1 - x0 + 160), zh = (r.height - 32) / (y1 - y0 + 120);
    this.cam.z = Math.min(1.4, Math.max(0.25, Math.min(zw, zh)));
    this.cam.x = (x0 + x1) / 2 - r.width / this.cam.z / 2;
    this.cam.y = (y0 + y1) / 2 - (r.height - 32) / this.cam.z / 2;
    this._draw();
  }

  _draw() {
    const ctx = this.ctx, dpr = this.dpr || 1;
    const W = this.cv.width, H = this.cv.height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = W / dpr, h = H / dpr;
    ctx.fillStyle = '#090c10';
    ctx.fillRect(0, 0, w, h);
    // dot grid
    const gs = 26 * this.cam.z;
    if (gs > 7) {
      ctx.fillStyle = '#151c26';
      const ox = (-this.cam.x * this.cam.z) % gs, oy = (-this.cam.y * this.cam.z) % gs;
      for (let gx = ox; gx < w; gx += gs) for (let gy = oy; gy < h; gy += gs) {
        ctx.fillRect(gx, gy, 1.4, 1.4);
      }
    }
    if (!this.graph) return;
    // links
    const byId = new Map(this.graph.nodes.map(n => [n.id, n]));
    for (const l of this.graph.links) {
      const a = byId.get(l.from.node), b = byId.get(l.to.node);
      if (!a || !b) continue;
      const [ax, ay] = this.portPos(a, l.from.port, true);
      const [bx, by] = this.portPos(b, l.to.port, false);
      const [sx, sy] = this.w2s(ax, ay), [ex, ey] = this.w2s(bx, by);
      const def = NODE_TYPES[a.type];
      const od = def.outputs.find(o => o.id === l.from.port);
      ctx.strokeStyle = LINK_COLOR[od?.type] || '#888';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      const dx = Math.max(40, Math.abs(ex - sx) * 0.5);
      ctx.bezierCurveTo(sx + dx, sy, ex - dx, ey, ex, ey);
      ctx.stroke();
    }
    // pending link
    if (this.drag?.kind === 'link') {
      const a = this.drag.from;
      const [ax, ay] = this.portPos(a.node, a.port.id, a.isOut);
      const [sx, sy] = this.w2s(ax, ay);
      const [ex, ey] = this.w2s(this.drag.mx, this.drag.my);
      ctx.strokeStyle = LINK_COLOR[a.port.type] || '#888';
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sx, sy);
      const dx = Math.max(40, Math.abs(ex - sx) * 0.5);
      if (a.isOut) ctx.bezierCurveTo(sx + dx, sy, ex - dx, ey, ex, ey);
      else ctx.bezierCurveTo(sx - dx, sy, ex + dx, ey, ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // nodes
    for (const n of this.graph.nodes) this._drawNode(n);
  }

  _drawNode(n) {
    const ctx = this.ctx;
    const def = NODE_TYPES[n.type];
    const [sx, sy] = this.w2s(n.x, n.y);
    const z = this.cam.z;
    const w = NW * z, h = this.nodeH(n) * z;
    if (sx + w < 0 || sy + h < 0) return;
    const sel = n.id === this.sel, hov = n.id === this.hover?.id;
    ctx.fillStyle = n.disabled ? '#101319' : '#141a23';
    ctx.strokeStyle = sel ? '#e8a33d' : hov ? '#3d4a5e' : '#262f3d';
    ctx.lineWidth = sel ? 2 : 1.2;
    ctx.beginPath();
    ctx.roundRect(sx, sy, w, h, 8);
    ctx.fill(); ctx.stroke();
    // header
    ctx.fillStyle = def.color + (n.disabled ? '44' : '26');
    ctx.beginPath();
    ctx.roundRect(sx, sy, w, HEAD_H * z, [8, 8, 0, 0]);
    ctx.fill();
    ctx.fillStyle = n.disabled ? '#5b6575' : '#e8edf4';
    ctx.font = `600 ${12 * Math.min(z, 1.3)}px DM Sans, sans-serif`;
    ctx.fillText(def.title, sx + 9 * z, sy + 17 * z);
    // ports
    ctx.font = `${11 * Math.min(z, 1.3)}px DM Sans, sans-serif`;
    for (const inp of def.inputs) {
      const [px, py] = this.portPos(n, inp.id, false);
      const [qx, qy] = this.w2s(px, py);
      ctx.fillStyle = LINK_COLOR[inp.type];
      ctx.beginPath(); ctx.arc(qx, qy, PORT_R * Math.min(z, 1.2), 0, 7); ctx.fill();
      ctx.fillStyle = '#8b95a5';
      ctx.fillText(inp.id, qx + 10 * z, qy + 4 * z);
    }
    for (const out of def.outputs) {
      const [px, py] = this.portPos(n, out.id, true);
      const [qx, qy] = this.w2s(px, py);
      ctx.fillStyle = LINK_COLOR[out.type];
      ctx.beginPath(); ctx.arc(qx, qy, PORT_R * Math.min(z, 1.2), 0, 7); ctx.fill();
      ctx.fillStyle = '#8b95a5';
      const tw = ctx.measureText(out.id).width;
      ctx.fillText(out.id, qx - 10 * z - tw, qy + 4 * z);
    }
    // param readouts
    const rows = Math.max(def.inputs.length, def.outputs.length, 1);
    let ry = sy + (HEAD_H + rows * ROW_H + 8) * z;
    ctx.fillStyle = '#5b6575';
    ctx.font = `${10.5 * Math.min(z, 1.3)}px IBM Plex Mono, monospace`;
    let shown = 0;
    for (const p of def.params) {
      if (shown >= 3) break;
      if (p.type !== 'float' && p.type !== 'int') continue;
      let v = n.params[p.key];
      if (typeof v === 'number') v = Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2);
      ctx.fillText(`${p.label} ${v}`, sx + 10 * z, ry + 10 * z);
      ry += 14 * z; shown++;
    }
    if (n.type === 'river') {
      const c = (n.params.points || []).length;
      ctx.fillStyle = c >= 2 ? '#4fd1c5' : '#f0665f';
      ctx.fillText(c >= 2 ? `${c} pts ✓` : 'no path — edit me', sx + 10 * z, ry + 10 * z);
    }
  }
}
