/* ============================================================================
   CrossSectionEditor — the widget the whole editor hangs off.

   Draws the compiled profile in true section (vertical scale exaggerated, as a
   real drawing would be), lets you drag any band boundary to re-allocate
   width, click a band to select it, and keeps a numeric readout of every lane.

   It edits the band list in place; the caller diffs and pushes undo.
   ========================================================================== */

import { h, $ } from './widgets.js';
import { KINDS, SURFACES } from '../model/Presets.js';
import { compileProfile } from '../gen/CrossSection.js';
import { clamp } from '../core/mathx.js';

const PAD = 16;
const BASE_PAD = 26;
const V_EXAG = 5;

export class CrossSectionEditor {
  constructor(container, { onChange, onSelect, onWidths } = {}) {
    this.onChange = onChange || (() => {});
    this.onSelect = onSelect || (() => {});
    this.onWidths = onWidths || (() => {});
    this.bands = [];
    this.camber = 0.025;
    this.selected = -1;
    this.hoverBoundary = -1;
    this.hoverBand = -1;
    this.showLabels = true;

    this.canvas = h('canvas', { id: 'xsCanvas' });
    this.canvas.style.height = '132px';
    container.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d');

    this._bind();
    this._resize();
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(container);
  }

  setBands(bands, camber = 0.025) {
    this.bands = bands.map((b) => ({ ...b }));
    this.camber = camber;
    if (this.selected >= this.bands.length) this.selected = -1;
    this.render();
  }

  setSelected(i) { this.selected = i; this.render(); }

  _resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = this.canvas.clientWidth || 280;
    const hgt = 132;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(hgt * dpr);
    this.canvas.style.height = `${hgt}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = w; this.H = hgt;
    this.render();
  }

  /* ------------------------------------------------------------ mapping -- */

  _scale() {
    const W = this.bands.reduce((s, b) => s + Math.max(0, b.w || 0), 0) || 10;
    return (this.W - PAD * 2) / W;
  }
  _x(l) { return PAD + (l + this._total() / 2) * this._scale(); }
  _y(hh) { return this.H - BASE_PAD - hh * this._scale() * V_EXAG; }
  _total() { return this.bands.reduce((s, b) => s + Math.max(0, b.w || 0), 0); }

  /** Lateral coordinate of each band boundary, in metres. */
  _bounds() {
    const out = [];
    let l = -this._total() / 2;
    for (const b of this.bands) { out.push(l); l += Math.max(0, b.w || 0); }
    out.push(l);
    return out;
  }

  /* --------------------------------------------------------------- input -- */

  _bind() {
    const c = this.canvas;
    let dragging = false;
    let dragIdx = 0;

    const localX = (e) => {
      const r = c.getBoundingClientRect();
      return e.clientX - r.left;
    };
    const localY = (e) => {
      const r = c.getBoundingClientRect();
      return e.clientY - r.top;
    };

    const nearestBoundary = (px) => {
      const b = this._bounds();
      let best = -1, bd = 8;
      for (let i = 1; i < b.length - 1; i++) {
        const d = Math.abs(this._x(b[i]) - px);
        if (d < bd) { bd = d; best = i; }
      }
      return best;
    };
    const bandAt = (px) => {
      const b = this._bounds();
      for (let i = 0; i < b.length - 1; i++) {
        if (px >= this._x(b[i]) && px <= this._x(b[i + 1])) return i;
      }
      return -1;
    };

    c.addEventListener('pointermove', (e) => {
      const px = localX(e), py = localY(e);
      if (dragging) {
        const s = this._scale();
        const total = this._total();
        const l = clamp((px - PAD) / s - total / 2, -total / 2, total / 2);
        const b = this._bounds();
        const prev = b[dragIdx - 1];
        const next = b[dragIdx + 1];
        const nl = clamp(l, prev + 0.15, next - 0.15);
        const a = this.bands[dragIdx - 1], bb = this.bands[dragIdx];
        if (a && bb) {
          a.w = Math.round((nl - prev) * 100) / 100;
          bb.w = Math.round((next - nl) * 100) / 100;
          this.render();
          this.onWidths(this.bands);
        }
        return;
      }
      const nb = nearestBoundary(px);
      const nb2 = bandAt(px);
      if (nb !== this.hoverBoundary || nb2 !== this.hoverBand) {
        this.hoverBoundary = nb;
        this.hoverBand = nb2;
        c.style.cursor = nb >= 0 ? 'ew-resize' : nb2 >= 0 ? 'pointer' : 'default';
        this.render();
      }
    });

    c.addEventListener('pointerdown', (e) => {
      const px = localX(e);
      const nb = nearestBoundary(px);
      if (nb >= 0) {
        dragging = true; dragIdx = nb;
        c.setPointerCapture(e.pointerId);
        e.preventDefault();
      } else {
        const b = bandAt(px);
        if (b >= 0) {
          this.selected = this.selected === b ? -1 : b;
          this.render();
          this.onSelect(this.selected);
        }
      }
    });
    const stop = (e) => {
      if (dragging) {
        dragging = false;
        try { c.releasePointerCapture(e.pointerId); } catch {}
        this.onChange(this.bands);
      }
    };
    c.addEventListener('pointerup', stop);
    c.addEventListener('pointercancel', stop);
    c.addEventListener('pointerleave', () => {
      if (!dragging) { this.hoverBoundary = -1; this.hoverBand = -1; this.render(); }
    });
    c.addEventListener('dblclick', (e) => {
      const px = localX(e);
      const b = bandAt(px);
      if (b >= 0 && this.bands[b]) {
        const k = this.bands[b].k;
        const def = KINDS[k];
        if (def) this.bands[b].w = def.w;
        this.render();
        this.onChange(this.bands);
      }
    });
  }

  /* --------------------------------------------------------------- draw -- */

  render() {
    const g = this.ctx;
    const W = this.W, H = this.H;
    if (!g || !W) return;
    g.clearRect(0, 0, W, H);

    if (!this.bands.length) {
      g.fillStyle = '#535d6a';
      g.font = '11px ui-monospace, monospace';
      g.textAlign = 'center';
      g.fillText('no road selected', W / 2, H / 2);
      return;
    }

    const sec = compileProfile(this.bands, { camber: this.camber });
    const s = this._scale();
    const baseY = this.H - BASE_PAD;
    const minH = Math.min(0, ...sec.nodes.map((n) => n.h));
    const floorY = baseY - minH * s * V_EXAG + 30;

    /* backdrop */
    g.fillStyle = '#0c1016';
    g.fillRect(0, 0, W, H);

    /* ground hatch */
    g.save();
    g.beginPath();
    g.rect(0, floorY, W, H - floorY);
    g.clip();
    g.fillStyle = '#151a22';
    g.fillRect(0, floorY, W, H - floorY);
    g.strokeStyle = '#222a35';
    g.lineWidth = 1;
    for (let x = -H; x < W + H; x += 7) {
      g.beginPath(); g.moveTo(x, H); g.lineTo(x + (H - floorY), floorY); g.stroke();
    }
    g.restore();
    g.strokeStyle = '#2e3745';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, floorY); g.lineTo(W, floorY); g.stroke();

    /* datum (road centreline level) */
    g.strokeStyle = 'rgba(53,200,255,.28)';
    g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(0, baseY); g.lineTo(W, baseY); g.stroke();
    g.setLineDash([]);

    /* band bodies */
    const bounds = this._bounds();
    for (let i = 0; i < this.bands.length; i++) {
      const b = this.bands[i];
      const k = KINDS[b.k] || KINDS.none;
      const surf = SURFACES[b.s] || SURFACES.asphalt;
      const x0 = this._x(bounds[i]);
      const x1 = this._x(bounds[i + 1]);
      const isSel = i === this.selected;
      const isHov = i === this.hoverBand;

      // find the section nodes covering this band
      const ys = [];
      for (let n = 0; n < sec.nodes.length; n++) {
        const nd = sec.nodes[n];
        if (nd.l >= bounds[i] - 1e-4 && nd.l <= bounds[i + 1] + 1e-4) ys.push({ x: nd.l, h: nd.h });
      }
      if (!ys.length) ys.push({ x: bounds[i], h: b.h ?? 0 }, { x: bounds[i + 1], h: b.h ?? 0 });

      g.beginPath();
      g.moveTo(this._x(ys[0].x), this._y(ys[0].h));
      for (const p of ys) g.lineTo(this._x(p.x), this._y(p.h));
      g.lineTo(this._x(ys[ys.length - 1].x), floorY);
      g.lineTo(this._x(ys[0].x), floorY);
      g.closePath();
      g.fillStyle = shade(surf.base, isSel ? 0.18 : isHov ? 0.08 : -0.28);
      g.fill();

      // running surface
      g.beginPath();
      g.moveTo(this._x(ys[0].x), this._y(ys[0].h));
      for (const p of ys) g.lineTo(this._x(p.x), this._y(p.h));
      g.strokeStyle = isSel ? '#35c8ff' : isHov ? '#9fd8ee' : shade(surf.base, 0.35);
      g.lineWidth = isSel ? 2.6 : 1.8;
      g.stroke();

      // selection glow
      if (isSel) {
        g.strokeStyle = 'rgba(53,200,255,.5)';
        g.lineWidth = 1;
        g.strokeRect(x0 + 0.5, this._y(Math.max(...ys.map((p) => p.h))) - 3.5, x1 - x0 - 1, floorY - this._y(Math.max(...ys.map((p) => p.h))) + 3);
      }
    }

    /* kerb risers */
    for (const st of sec.strips) {
      if (!st.vertical) continue;
      const a = sec.nodes[st.startNode], b = sec.nodes[st.endNode];
      g.strokeStyle = '#cfd3d8';
      g.lineWidth = 3.2;
      g.beginPath();
      g.moveTo(this._x(a.l), this._y(a.h));
      g.lineTo(this._x(b.l), this._y(b.h));
      g.stroke();
    }

    /* boundary handles */
    for (let i = 1; i < bounds.length - 1; i++) {
      const x = this._x(bounds[i]);
      const on = this.hoverBoundary === i;
      g.strokeStyle = on ? '#ffb340' : 'rgba(255,255,255,.20)';
      g.lineWidth = on ? 2 : 1;
      g.setLineDash(on ? [] : [2, 3]);
      g.beginPath();
      g.moveTo(x, 6); g.lineTo(x, floorY);
      g.stroke();
      g.setLineDash([]);
      if (on) {
        g.fillStyle = '#ffb340';
        g.fillRect(x - 2, 8, 4, 4);
        g.fillRect(x - 2, floorY - 12, 4, 4);
      }
    }

    /* labels */
    if (this.showLabels) {
      g.font = '600 8.5px ui-monospace, monospace';
      g.textAlign = 'center';
      for (let i = 0; i < this.bands.length; i++) {
        const w = Math.max(0, this.bands[i].w || 0);
        const x0 = this._x(bounds[i]), x1 = this._x(bounds[i + 1]);
        const cx = (x0 + x1) / 2;
        const k = KINDS[this.bands[i].k] || KINDS.none;
        if (x1 - x0 > 17) {
          g.fillStyle = i === this.selected ? '#eaf9ff' : 'rgba(255,255,255,.82)';
          g.fillText(k.short, cx, 15);
        }
        if (x1 - x0 > 24) {
          g.font = '400 8px ui-monospace, monospace';
          g.fillStyle = 'rgba(174,185,200,.75)';
          g.fillText(w.toFixed(1), cx, this.H - 14);
          g.font = '600 8.5px ui-monospace, monospace';
        }
      }
      // direction arrows
      g.font = '700 9px ui-monospace, monospace';
      for (let i = 0; i < this.bands.length; i++) {
        const b = this.bands[i];
        if (!b.dir) continue;
        const x0 = this._x(bounds[i]), x1 = this._x(bounds[i + 1]);
        if (x1 - x0 < 14) continue;
        g.fillStyle = 'rgba(255,255,255,.5)';
        g.fillText(b.dir > 0 ? '▲' : '▼', (x0 + x1) / 2, 27);
      }
    }

    /* total width readout */
    g.font = '500 9px ui-monospace, monospace';
    g.textAlign = 'left';
    g.fillStyle = 'rgba(53,200,255,.9)';
    g.fillText(`${this._total().toFixed(2)} m`, 6, 12);
    g.textAlign = 'right';
    g.fillStyle = 'rgba(118,130,143,.9)';
    g.fillText(`V ×${V_EXAG}`, W - 6, 12);
  }

  dispose() { this._ro?.disconnect(); }
}

function shade(hex, amt) {
  const v = parseInt(hex.slice(1), 16);
  let r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  if (amt >= 0) {
    r = r + (255 - r) * amt; g = g + (255 - g) * amt; b = b + (255 - b) * amt;
  } else {
    const k = 1 + amt;
    r *= k; g *= k; b *= k;
  }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
