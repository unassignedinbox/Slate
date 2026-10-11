// Non-React controller for the viewport: owns the WebGPU renderer, the orbit camera,
// the scene worker, traffic, and the 2D overlay (gizmo, picking, spline preview).
import { Renderer, GLOBALS_FLOATS } from './renderer.js';
import { OrbitCamera } from './camera.js';
import { toScreen, rayFromPixel, groundHit, distToPolyline } from './picking.js';
import { buildGlobals } from './globals.js';
import { Traffic, MAX_VEHICLES } from '../engine/traffic.js';
import { buildCarModel } from '../engine/carModel.js';

const GIZMO_LEN = 14;   // metres, world-space length of gizmo arms
const HIT_JUNCTION_PX = 14;
const HIT_ROAD_PX = 8;
const SNAP = 0.5;

export class Stage {
  constructor({ canvas, overlay, handlers }) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.h = handlers;             // { onSelect, onMoveBegin, onMoveJunction, onMoveEnd, onDraftClick, onDraftFinish, onStats, onBuildStart }
    this.doc = null;
    this.paths = null;
    this.ui = { selection: null, mode: 'select', draft: null, snap: true };
    this.cam = new OrbitCamera();
    this.traffic = new Traffic(7);
    this.hover = null;
    this.drag = null;
    this.busy = false;
    this.pending = false;
    this.buildId = 0;
    this.lastT = 0;
    this.running = false;
    this.cursorGround = null;
    this.ready = false;
    this._bind();
  }

  async start() {
    this.renderer = await new Renderer(this.canvas).init();
    this.renderer.setCarModel(buildCarModel());
    this.worker = new Worker(new URL('../workers/scene.worker.js', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e) => this._onBuilt(e.data);
    this.worker.onerror = (e) => this.h.onError?.(String(e.message || e));
    this.running = true;
    this.ready = true;
    this.raf = requestAnimationFrame((t) => this._frame(t));
  }

  dispose() {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.worker?.terminate();
    this._unbind?.();
  }

  setDoc(doc) {
    this.doc = doc;
    this.traffic.sync(doc, this.paths || {});
    this._requestBuild();
  }

  setUi(patch) {
    this.ui = { ...this.ui, ...patch };
    this.overlay.style.cursor = this.ui.mode === 'draw' ? 'crosshair' : 'default';
  }

  focusSelection() {
    const sel = this.ui.selection;
    const J = sel?.kind === 'junction' ? this.doc?.junctions[sel.id] : null;
    if (J) this.cam.target = [...J.p];
    else this.cam.target = [0, 0, 0];
  }

  // ---- build pipeline --------------------------------------------------------------

  _requestBuild() {
    if (!this.worker) return;
    if (this.busy) { this.pending = true; return; }
    this.busy = true;
    this.pending = false;
    this.buildId++;
    this.h.onBuildStart?.();
    this.worker.postMessage({ id: this.buildId, doc: this.doc });
  }

  _onBuilt(msg) {
    this.busy = false;
    if (msg.ok) {
      if (msg.id === this.buildId) {
        this.paths = msg.paths;
        this.renderer.setStatic(msg.data);
        this.traffic.sync(this.doc, this.paths);
        this.h.onStats?.(msg.stats);
      }
    } else {
      this.h.onError?.(msg.error);
    }
    if (this.pending) this._requestBuild();
  }

  // ---- frame -----------------------------------------------------------------------

  _resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(2, Math.round(r.width * dpr));
    const h = Math.max(2, Math.round(r.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.overlay.width = w;
      this.overlay.height = h;
    }
    this.cssW = r.width;
    this.cssH = r.height;
    this.dpr = dpr;
  }

  _frame(t) {
    if (!this.running) return;
    const dt = Math.min(0.05, Math.max(0, (t - (this.lastT || t)) / 1000));
    this.lastT = t;
    this._resize();
    const view = this.cam.matrices(this.canvas.width / this.canvas.height);
    const env = this.doc?.env ?? { time: 12, fog: 0, exposure: 1, shadows: true, wetness: 0 };
    let inst = [];
    if (this.doc && this.paths) {
      this.traffic.update(dt, this.doc, this.paths);
      inst = this.traffic.instances(this.doc, this.paths);
    }
    const count = Math.min(MAX_VEHICLES, inst.length);
    const instData = new Float32Array(Math.max(1, count) * 20);
    for (let i = 0; i < count; i++) {
      instData.set(inst[i].m, i * 20);
      instData[i * 20 + 16] = inst[i].paint;
    }
    const stacks = this.doc?.stacks ?? { asphalt: [], paving: [] };
    const globals = buildGlobals({ cam: this.cam, view, env, stacks });
    if (globals.length !== GLOBALS_FLOATS) throw new Error('globals size');
    this.renderer.render(globals, instData, count, !!env.shadows);
    this._drawOverlay(view);
    this.raf = requestAnimationFrame((tt) => this._frame(tt));
  }

  // ---- overlay ---------------------------------------------------------------------

  _screen(p, view) {
    return toScreen(view.viewProj, p, this.cssW, this.cssH);
  }

  _drawOverlay(view) {
    const ctx = this.overlay.getContext('2d');
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    if (!this.doc) return;
    const sel = this.ui.selection;

    // Selected road: centreline highlight.
    if (sel?.kind === 'road' && this.paths?.[sel.id]) {
      const pts = this.paths[sel.id].pts.filter((_, i, a) => i % 3 === 0 || i === a.length - 1);
      const scr = pts.map((p) => this._screen(p, view)).filter(Boolean);
      strokePath(ctx, scr, 'rgba(230,230,230,0.9)', 2);
    }

    // Junction markers.
    for (const J of Object.values(this.doc.junctions)) {
      const s = this._screen(J.p, view);
      if (!s) continue;
      const isSel = sel?.kind === 'junction' && sel.id === J.id;
      const isHover = this.hover?.kind === 'junction' && this.hover.id === J.id;
      ctx.beginPath();
      ctx.arc(s[0], s[1], isSel ? 6 : 4, 0, Math.PI * 2);
      ctx.fillStyle = isSel ? '#ffffff' : isHover ? '#cfcfcf' : 'rgba(180,180,180,0.7)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1;
      ctx.stroke();
      if (isSel || isHover) label(ctx, J.name, s[0] + 9, s[1] - 9);
    }

    // Spline draft preview.
    const draft = this.ui.draft;
    if (draft && this.ui.mode === 'draw') {
      const pts = [];
      const a = this.doc.junctions[draft.a];
      if (a) pts.push(a.p);
      pts.push(...draft.wps);
      if (this.cursorGround) pts.push(this.cursorGround);
      const scr = pts.map((p) => this._screen(p, view)).filter(Boolean);
      strokePath(ctx, scr, 'rgba(255,255,255,0.95)', 2, [6, 4]);
      for (const w of draft.wps) {
        const s = this._screen(w, view);
        if (s) { ctx.beginPath(); ctx.arc(s[0], s[1], 4, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill(); }
      }
    }

    // Gizmo for the selected junction: two arms (x red, z blue) and a centre handle.
    if (sel?.kind === 'junction' && this.ui.mode === 'select' && this.doc.junctions[sel.id]) {
      const p = this.doc.junctions[sel.id].p;
      const o = this._screen(p, view);
      const ax = this._screen([p[0] + GIZMO_LEN, p[1], p[2]], view);
      const az = this._screen([p[0], p[1], p[2] + GIZMO_LEN], view);
      if (o && ax && az) {
        arrow(ctx, o, ax, '#e0524a');
        arrow(ctx, o, az, '#4e8fe0');
        ctx.fillStyle = '#f2f2f2';
        ctx.strokeStyle = '#101010';
        ctx.fillRect(o[0] - 5, o[1] - 5, 10, 10);
        ctx.strokeRect(o[0] - 5, o[1] - 5, 10, 10);
      }
    }
  }

  // ---- picking ---------------------------------------------------------------------

  _local(e) {
    const r = this.overlay.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _view() {
    return this.cam.matrices(this.canvas.width / this.canvas.height);
  }

  _groundAt(sx, sy) {
    const ray = rayFromPixel(this._view().invViewProj, sx, sy, this.cssW, this.cssH);
    return groundHit(ray, 0);
  }

  _hitGizmo(sx, sy, view) {
    const sel = this.ui.selection;
    if (sel?.kind !== 'junction' || !this.doc.junctions[sel.id] || this.ui.mode !== 'select') return null;
    const p = this.doc.junctions[sel.id].p;
    const o = this._screen(p, view);
    if (!o) return null;
    if (Math.hypot(sx - o[0], sy - o[1]) < 11) return 'xz';
    const ax = this._screen([p[0] + GIZMO_LEN, p[1], p[2]], view);
    const az = this._screen([p[0], p[1], p[2] + GIZMO_LEN], view);
    if (ax && distToSeg([sx, sy], o, ax) < 7) return 'x';
    if (az && distToSeg([sx, sy], o, az) < 7) return 'z';
    return null;
  }

  _hitJunction(sx, sy, view) {
    let best = null, bd = HIT_JUNCTION_PX;
    for (const J of Object.values(this.doc.junctions)) {
      const s = this._screen(J.p, view);
      if (!s) continue;
      const d = Math.hypot(sx - s[0], sy - s[1]);
      if (d < bd) { bd = d; best = J.id; }
    }
    return best;
  }

  _hitRoad(sx, sy, view) {
    let best = null, bd = HIT_ROAD_PX;
    for (const id of Object.keys(this.paths || {})) {
      const pts = this.paths[id].pts;
      const scr = [];
      for (let i = 0; i < pts.length; i += 4) { const s = this._screen(pts[i], view); if (s) scr.push(s); }
      if (scr.length < 2) continue;
      const d = distToPolyline([sx, sy], scr);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  }

  _snapP(p) {
    return this.ui.snap ? [Math.round(p[0] / SNAP) * SNAP, p[1], Math.round(p[2] / SNAP) * SNAP] : p;
  }

  // ---- input -----------------------------------------------------------------------

  _bind() {
    const el = this.overlay;
    const down = (e) => this._onDown(e);
    const move = (e) => this._onMove(e);
    const up = (e) => this._onUp(e);
    const wheel = (e) => { e.preventDefault(); this.cam.zoom(e.deltaY > 0 ? 1.12 : 0.89); };
    const dbl = (e) => {
      if (this.ui.mode !== 'draw') return;
      const [sx, sy] = this._local(e);
      const view = this._view();
      const jid = this._hitJunction(sx, sy, view);
      const p = jid ? this.doc.junctions[jid].p : this._groundAt(sx, sy);
      if (p) this.h.onDraftFinish?.({ p, jid });
    };
    const ctx = (e) => e.preventDefault();
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('dblclick', dbl);
    el.addEventListener('contextmenu', ctx);
    this._unbind = () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('dblclick', dbl);
      el.removeEventListener('contextmenu', ctx);
    };
  }

  _onDown(e) {
    if (!this.doc) return;
    const [sx, sy] = this._local(e);
    const view = this._view();
    this.overlay.setPointerCapture(e.pointerId);
    const g = e.button === 0 && !e.shiftKey ? this._hitGizmo(sx, sy, view) : null;
    if (g) {
      const id = this.ui.selection.id;
      this.drag = { mode: 'gizmo', axis: g, id, startP: [...this.doc.junctions[id].p], startHit: this._groundAt(sx, sy), x0: sx, y0: sy, moved: false };
      this.h.onMoveBegin?.(id);
      return;
    }
    const mode = e.button === 1 || e.button === 2 || e.shiftKey ? 'pan' : 'orbit';
    this.drag = { mode, x0: sx, y0: sy, moved: false, button: e.button };
  }

  _onMove(e) {
    const [sx, sy] = this._local(e);
    const view = this._view();
    if (!this.drag) {
      this.cursorGround = this.ui.mode === 'draw' ? this._groundAt(sx, sy) : null;
      const j = this._hitJunction(sx, sy, view);
      const g = this._hitGizmo(sx, sy, view);
      const hov = j ? { kind: 'junction', id: j } : null;
      if (JSON.stringify(hov) !== JSON.stringify(this.hover)) this.hover = hov;
      this.overlay.style.cursor = g ? (g === 'xz' ? 'move' : g === 'x' ? 'ew-resize' : 'ns-resize') : this.ui.mode === 'draw' ? 'crosshair' : j ? 'pointer' : 'default';
      return;
    }
    const d = this.drag;
    if (Math.hypot(sx - d.x0, sy - d.y0) > 3) d.moved = true;
    if (d.mode === 'orbit' && d.moved) this.cam.orbit(e.movementX, e.movementY);
    if (d.mode === 'pan') this.cam.pan(e.movementX, e.movementY);
    if (d.mode === 'gizmo') {
      const hit = this._groundAt(sx, sy);
      if (!hit || !d.startHit) return;
      const delta = [hit[0] - d.startHit[0], 0, hit[2] - d.startHit[2]];
      let p = [d.startP[0] + delta[0], d.startP[1], d.startP[2] + delta[2]];
      if (d.axis === 'x') p[2] = d.startP[2];
      if (d.axis === 'z') p[0] = d.startP[0];
      p = this._snapP(p);
      this.h.onMoveJunction?.(d.id, p);
    }
    if (d.mode === 'orbit' || d.mode === 'pan') this.cursorGround = null;
  }

  _onUp(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.mode === 'gizmo') { this.h.onMoveEnd?.(d.id); return; }
    if (d.moved || d.mode === 'pan' || d.button !== 0) return;
    const [sx, sy] = this._local(e);
    const view = this._view();
    if (this.ui.mode === 'draw') {
      const jid = this._hitJunction(sx, sy, view);
      const p = jid ? this.doc.junctions[jid].p : this._groundAt(sx, sy);
      if (p) this.h.onDraftClick?.({ p, jid });
      return;
    }
    const jid = this._hitJunction(sx, sy, view);
    if (jid) { this.h.onSelect?.({ kind: 'junction', id: jid }); return; }
    const rid = this._hitRoad(sx, sy, view);
    if (rid) { this.h.onSelect?.({ kind: 'road', id: rid }); return; }
    this.h.onSelect?.(null);
  }
}

// ---- overlay drawing helpers -------------------------------------------------------

function strokePath(ctx, pts, color, width, dash = []) {
  if (pts.length < 2) return;
  ctx.save();
  ctx.setLineDash(dash);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
  ctx.stroke();
  ctx.restore();
}

function arrow(ctx, a, b, color) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const ux = dx / L, uy = dy / L;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0] - ux * 8, b[1] - uy * 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b[0], b[1]);
  ctx.lineTo(b[0] - ux * 10 - uy * 5, b[1] - uy * 10 + ux * 5);
  ctx.lineTo(b[0] - ux * 10 + uy * 5, b[1] - uy * 10 - ux * 5);
  ctx.closePath();
  ctx.fill();
}

function label(ctx, text, x, y) {
  ctx.font = '12px "DM Sans", system-ui, sans-serif';
  const w = ctx.measureText(text).width + 10;
  ctx.fillStyle = 'rgba(16,16,16,0.85)';
  ctx.fillRect(x - 4, y - 12, w, 18);
  ctx.fillStyle = '#e8e8e8';
  ctx.fillText(text, x + 1, y + 1);
}

function distToSeg(p, a, b) {
  return distToPolyline(p, [a, b]);
}

