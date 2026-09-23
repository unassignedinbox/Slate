/* ============================================================================
 * TyreForge — editor.js
 * 2D tread-pattern lab: live tile preview + primitive list with sliders.
 * Tools: longitudinal channels, lateral grooves, sipes, chevrons, CIRCLES,
 * HEXAGONS, hex grids, lug pockets, studs.
 * ========================================================================== */

'use strict';
import { TOOL_DEFAULTS, TOOL_META } from './treads.js';

export class TreadEditor {
  /**
   * @param root    container element
   * @param ctx     { getPattern(), setPattern(p), tyreView, requestRebake(fast) }
   */
  constructor(root, ctx) {
    this.root = root; this.ctx = ctx;
    this.sel = -1;
    this._build();
  }

  get pattern() { return this.ctx.getPattern(); }

  /* ---------------- UI skeleton ---------------- */
  _build() {
    this.root.innerHTML = `
      <div class="ed-canvas-wrap">
        <canvas class="ed-canvas" width="768" height="300"></canvas>
        <div class="ed-canvas-tag">ONE PATTERN TILE · → rolling direction · ⇕ tread width</div>
      </div>
      <div class="ed-row ed-tiles-row">
        <label>Pattern pitch<t data-v="tiles"></t></label>
        <input type="range" min="1" max="34" step="1" class="ed-tiles">
      </div>
      <div class="ed-row">
        <label>Tread depth (mm)<t data-v="depth"></t></label>
        <input type="range" min="1.5" max="20" step="0.1" class="ed-depth">
      </div>
      <div class="ed-tools"></div>
      <div class="ed-prims"></div>
      <div class="ed-hint">Tip: select an element and drag it on the tile.</div>
    `;
    this.canvas = this.root.querySelector('.ed-canvas');
    this.g = this.canvas.getContext('2d');
    this.toolsEl = this.root.querySelector('.ed-tools');
    this.primsEl = this.root.querySelector('.ed-prims');

    /* tool buttons */
    for (const k of Object.keys(TOOL_DEFAULTS)) {
      const b = document.createElement('button');
      b.className = 'tool-btn'; b.title = TOOL_META[k].label;
      b.innerHTML = TOOL_META[k].label;
      b.onclick = () => this.addPrim(k);
      this.toolsEl.appendChild(b);
    }

    const tilesS = this.root.querySelector('.ed-tiles');
    const depthS = this.root.querySelector('.ed-depth');
    const syncGlobals = () => {
      const p = this.pattern;
      tilesS.value = p.tiles;
      depthS.value = p.depth;
      this.root.querySelector('[data-v=tiles]').textContent = ` ×${p.tiles}`;
      this.root.querySelector('[data-v=depth]').textContent = ` ${p.depth.toFixed(1)}`;
    };
    tilesS.oninput = () => { this.pattern.tiles = +tilesS.value; syncGlobals(); this.commit(); };
    depthS.oninput = () => { this.pattern.depth = +depthS.value; syncGlobals(); this.commit(); };
    this._syncGlobals = syncGlobals;

    /* drag primitives on the tile */
    let dragging = false;
    this.canvas.addEventListener('pointerdown', e => {
      if (this.sel < 0 || this.sel >= this.pattern.prims.length) return;
      dragging = true; this.canvas.setPointerCapture(e.pointerId);
      this._dragMove(e);
    });
    this.canvas.addEventListener('pointermove', e => dragging && this._dragMove(e));
    this.canvas.addEventListener('pointerup', () => { dragging = false; this.commit(); });
  }

  _dragMove(e) {
    const p = this.pattern.prims[this.sel];
    if (!p) return;
    const r = this.canvas.getBoundingClientRect();
    const x = clamp01((e.clientX - r.left) / r.width);
    const y = clamp01((e.clientY - r.top) / r.height);
    const q = v => Math.round(v * 200) / 200;
    if ('x' in p) p.x = q(x);
    if ('y' in p) p.y = q(y);
    if (p.kind === 'longi') p.y = q(y);
    if ('apexY' in p && p.kind === 'chevron') p.apexY = q(y);
    this.syncList(); this.drawPreview();
    this.ctx.requestRebake(true);
  }

  addPrim(kind) {
    const def = JSON.parse(JSON.stringify(TOOL_DEFAULTS[kind]));
    this.pattern.prims.push(def);
    this.sel = this.pattern.prims.length - 1;
    this.syncList(); this.commit();
  }

  removePrim(i) {
    this.pattern.prims.splice(i, 1);
    if (this.sel >= this.pattern.prims.length) this.sel = this.pattern.prims.length - 1;
    this.syncList(); this.commit();
  }

  commit() { this.drawPreview(); this.ctx.requestRebake(false); }

  /** full sync after a pattern swap */
  sync() {
    this._syncGlobals();
    this.syncList();
    this.drawPreview();
  }

  /* ---------------- primitive list ---------------- */
  syncList() {
    const p = this.pattern;
    this.primsEl.innerHTML = '';
    p.prims.forEach((prim, i) => {
      const meta = TOOL_META[prim.kind];
      const d = document.createElement('div');
      d.className = 'prim' + (i === this.sel ? ' sel' : '');
      const head = document.createElement('div');
      head.className = 'prim-head';
      head.innerHTML = `<span>${meta?.label ?? prim.kind}</span>
        <span class="prim-btns"><button class="p-up">▲</button><button class="p-dn">▼</button><button class="p-del">✕</button></span>`;
      head.onclick = e => {
        if (e.target.closest('button')) return;
        this.sel = this.sel === i ? -1 : i; this.syncList(); this.drawPreview();
      };
      head.querySelector('.p-del').onclick = () => this.removePrim(i);
      head.querySelector('.p-up').onclick = () => { if (i > 0) { [p.prims[i - 1], p.prims[i]] = [p.prims[i], p.prims[i - 1]]; this.syncList(); this.commit(); } };
      head.querySelector('.p-dn').onclick = () => { if (i < p.prims.length - 1) { [p.prims[i + 1], p.prims[i]] = [p.prims[i], p.prims[i + 1]]; this.syncList(); this.commit(); } };
      d.appendChild(head);

      if (i === this.sel && meta) {
        const body = document.createElement('div');
        body.className = 'prim-body';
        for (const [key, spec] of Object.entries(meta.params)) {
          if (spec === undefined) continue;
          if (spec[1] === 'bool') {
            const row = document.createElement('label');
            row.className = 'bool-row';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.checked = !!prim[key];
            cb.onchange = () => { prim[key] = cb.checked; this.commit(); };
            row.append(cb, spec[0]);
            body.appendChild(row);
          } else {
            const [label, min, max, step = 0.005] = spec;
            /* don't mutate unset optional params until the user moves the slider */
            const cur = typeof prim[key] === 'number' ? prim[key] : (min + max) / 2;
            const row = document.createElement('div');
            row.className = 'ed-row';
            row.innerHTML = `<label>${label}<t>${fmt(cur)}</t></label>`;
            const sl = document.createElement('input');
            sl.type = 'range'; sl.min = min; sl.max = max; sl.step = step;
            sl.value = cur;
            sl.oninput = () => {
              prim[key] = +sl.value;
              row.querySelector('t').textContent = fmt(prim[key]);
              this.drawPreview(); this.ctx.requestRebake(true);
            };
            sl.onchange = () => this.commit();
            row.appendChild(sl);
            body.appendChild(row);
          }
        }
        d.appendChild(body);
      }
      this.primsEl.appendChild(d);
    });
  }

  /* ---------------- tile preview ---------------- */
  drawPreview() {
    const g = this.g, W = this.canvas.width, H = this.canvas.height;
    const worn = this.ctx.tyreView?.worn;
    const fw = this.ctx.tyreView?.hfW ?? 0;
    const fh = this.ctx.tyreView?.hfH ?? 0;
    g.fillStyle = '#14161a'; g.fillRect(0, 0, W, H);

    if (worn && fw) {
      /* downsample the worn field with shading */
      const img = g.createImageData(W, H);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const fx = (x / W * fw) | 0, fy = (y / H * fh) | 0;
          const h = worn[fy * fw + fx];
          /* fake top-left lighting from neighbour */
          const hx = worn[fy * fw + Math.min(fw - 1, fx + 2)] - h;
          const c = 26 + h * 180 + hx * 260;
          const o = (y * W + x) * 4;
          img.data[o] = Math.max(0, Math.min(255, c * 0.92));
          img.data[o + 1] = Math.max(0, Math.min(255, c * 0.96));
          img.data[o + 2] = Math.max(0, Math.min(255, Math.min(255, c) * 1.0 + (1 - h) * 26));
          img.data[o + 3] = 255;
        }
      }
      g.putImageData(img, 0, 0);
      /* studs */
      const studs = this.ctx.tyreView?.field?.studs ?? [];
      g.fillStyle = '#cfd6dd';
      for (const [sx, sy, sr] of studs) {
        g.beginPath(); g.arc(sx * W, sy * H, Math.max(2, sr * H), 0, 7); g.fill();
      }
    }

    /* centre rib line + edges */
    g.strokeStyle = 'rgba(255,255,255,0.18)'; g.setLineDash([6, 6]);
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.setLineDash([]);
    g.strokeStyle = 'rgba(255,180,60,0.5)';
    g.strokeRect(0.5, 0.5, W - 1, H - 1);

    /* selected primitive marker */
    if (this.sel >= 0) {
      const p = this.pattern.prims[this.sel];
      const mx = ('x' in p ? p.x : 0.5) * W;
      const my = ('y' in p ? p.y : p.y0 != null ? (p.y0 + (p.y1 ?? p.y0)) / 2 : 0.5) * H;
      g.strokeStyle = '#ffb43c'; g.lineWidth = 1.6;
      g.beginPath(); g.arc(mx, my, 12, 0, 7); g.stroke();
      g.beginPath(); g.moveTo(mx - 18, my); g.lineTo(mx - 8, my); g.moveTo(mx + 8, my); g.lineTo(mx + 18, my); g.stroke();
    }
  }
}

function fmt(v) { return typeof v === 'number' ? (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2)) : v; }
function clamp01(v) { return Math.max(0, Math.min(1, v)); }
