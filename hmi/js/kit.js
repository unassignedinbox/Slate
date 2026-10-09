// App kit: shared visual components for the apps (automotive-style gauges, sheets, charts, tabs).
// Everything is plain DOM, SVG or canvas so it ports to a native toolkit with the same layout rules.
import { el } from './ui.js';

let uid = 0;
const polar = (cx, cy, r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
// Arc from angle a0 to a1 (degrees, SVG convention: 0 = right, clockwise positive), as an SVG path.
function arcPath(cx, cy, r, a0, a1) {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

// Automotive speedometer-style arc gauge. 270 degree sweep, gradient value arc, redline band,
// tick marks, and a glowing tip. set(value, text) updates it without reflowing the DOM.
export function arcGauge({ min = 0, max = 100, major = 20, minor = 4, redlineFrom = null, unit = '', color = '#2ee6c5', size = 300, label = '' } = {}) {
  const id = `g${++uid}`;
  const START = 135, END = 405, C = 100, R = 84;
  const span = END - START;
  const angleOf = (v) => START + ((v - min) / (max - min)) * span;
  const ticks = [];
  for (let v = min; v <= max + 1e-6; v += minor) {
    const isMajor = Math.abs((v - min) / major - Math.round((v - min) / major)) < 1e-6;
    const a = angleOf(v);
    const [x0, y0] = polar(C, C, R - 2, a);
    const [x1, y1] = polar(C, C, R - (isMajor ? 14 : 8), a);
    ticks.push(`<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" class="${isMajor ? 'major' : 'minor'}"/>`);
    if (isMajor) {
      const [tx, ty] = polar(C, C, R - 26, a);
      ticks.push(`<text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" class="num">${Math.round(v)}</text>`);
    }
  }
  const red = redlineFrom != null
    ? `<path d="${arcPath(C, C, R, angleOf(redlineFrom), END)}" class="redline" pathLength="100"/>`
    : '';
  const root = el('div', { class: 'gauge', style: { width: `${size}px`, height: `${size}px` } });
  root.innerHTML = `
    <svg viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stop-color="${color}" stop-opacity="0.55"/>
          <stop offset="1" stop-color="${color}"/>
        </linearGradient>
        <filter id="${id}f" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
      </defs>
      <path d="${arcPath(C, C, R, START, END)}" class="track" pathLength="100"/>
      ${red}
      <path d="${arcPath(C, C, R, START, END)}" class="glow" stroke="url(#${id})" pathLength="100" filter="url(#${id}f)" stroke-dasharray="0 100"/>
      <path d="${arcPath(C, C, R, START, END)}" class="value" stroke="url(#${id})" pathLength="100" stroke-dasharray="0 100"/>
      ${ticks.join('')}
      <circle class="tip" r="4.5" cx="0" cy="0"/>
    </svg>
    <div class="gauge-centre">
      <b class="gauge-value">0</b>
      <small class="gauge-unit">${unit}</small>
      <span class="gauge-label">${label}</span>
    </div>`;
  const valuePath = root.querySelector('.value');
  const glowPath = root.querySelector('.glow');
  const tip = root.querySelector('.tip');
  const valueEl = root.querySelector('.gauge-value');
  let shown = min;
  const drawFrac = (f) => {
    const dash = `${(f * 100).toFixed(2)} 100`;
    valuePath.setAttribute('stroke-dasharray', dash);
    glowPath.setAttribute('stroke-dasharray', dash);
    const [x, y] = polar(C, C, R, START + f * span);
    tip.setAttribute('cx', x.toFixed(2));
    tip.setAttribute('cy', y.toFixed(2));
  };
  drawFrac(0);
  return {
    root,
    set(v, text) {
      const clamped = Math.max(min, Math.min(max, v));
      // Ease toward the target so the needle sweeps instead of jumping.
      shown += (clamped - shown) * 0.35;
      drawFrac((shown - min) / (max - min));
      valueEl.textContent = text ?? Math.round(shown);
    },
    setColor(c) {
      root.style.setProperty('--gauge-color', c);
    },
  };
}

// Bottom sheet inside an app window. Returns { close }.
export function openSheet(body, { title, content, actions = [] }) {
  const scrim = el('div', { class: 'k-scrim' });
  const sheet = el('section', { class: 'k-sheet', role: 'dialog', 'aria-label': title },
    el('div', { class: 'k-grip' }),
    el('h2', {}, title),
    content,
    el('div', { class: 'k-sheet-actions' }, actions),
  );
  const close = () => { scrim.remove(); sheet.remove(); };
  scrim.addEventListener('click', close);
  body.append(scrim, sheet);
  return { close, sheet };
}

// Tabs with an animated underline (Android-style top tabs).
export function tabs(items, active, onChange) {
  let current = active;
  const bar = el('nav', { class: 'k-tabs', role: 'tablist' });
  const buttons = items.map(([key, label]) => el('button', {
    class: 'k-tab', role: 'tab', 'data-key': key,
    onclick: () => { set(key); onChange(key); },
  }, label));
  const marker = el('i', { class: 'k-tab-mark' });
  bar.append(...buttons, marker);
  function set(key) {
    current = key;
    buttons.forEach((b) => {
      const on = b.dataset.key === key;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on);
    });
    const idx = items.findIndex(([k]) => k === key);
    marker.style.transform = `translateX(${idx * 100}%)`;
    marker.style.width = `${100 / items.length}%`;
  }
  set(current);
  return { root: bar, set, get current() { return current; } };
}

// Multi-series line chart on canvas with axes, grid and optional fill. Redraws on demand.
export class LineChart {
  constructor(canvas, { min, max, series, xLabels = [], yFormat = (v) => Math.round(v) } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.min = min; this.max = max;
    this.series = series;     // [{ values: number[], color, fill?, width? }]
    this.xLabels = xLabels;
    this.yFormat = yFormat;
    this.marker = null;       // optional { x: index, label }
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(canvas);
    this.draw();
  }
  set(series, { min, max } = {}) {
    this.series = series;
    if (min != null) this.min = min;
    if (max != null) this.max = max;
    this.draw();
  }
  draw() {
    const c = this.canvas, ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    c.width = Math.floor(w * dpr); c.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const padL = 34, padB = 20, padT = 8, padR = 10;
    const pw = w - padL - padR, ph = h - padT - padB;
    const yOf = (v) => padT + ph - ((v - this.min) / (this.max - this.min)) * ph;
    ctx.font = '500 11px Roboto, system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 4; i++) {
      const v = this.min + ((this.max - this.min) * i) / 4;
      const y = yOf(v);
      ctx.strokeStyle = 'rgba(255,255,255,0.07)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, Math.round(y) + 0.5); ctx.lineTo(w - padR, Math.round(y) + 0.5); ctx.stroke();
      ctx.fillStyle = 'rgba(203,213,225,0.55)';
      ctx.textAlign = 'right';
      ctx.fillText(this.yFormat(v), padL - 6, y);
    }
    if (this.xLabels.length) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      const n = this.xLabels.length;
      this.xLabels.forEach((lab, i) => {
        const x = padL + (pw * i) / Math.max(1, n - 1);
        ctx.fillStyle = 'rgba(203,213,225,0.55)';
        ctx.fillText(lab, x, h - 4);
      });
    }
    for (const s of this.series) {
      const vals = s.values;
      if (!vals || vals.length < 2) continue;
      const n = vals.length;
      const xOf = (i) => padL + (pw * i) / (n - 1);
      if (s.fill) {
        const g = ctx.createLinearGradient(0, padT, 0, padT + ph);
        g.addColorStop(0, s.fill); g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.beginPath();
        vals.forEach((v, i) => (i ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v))));
        ctx.lineTo(xOf(n - 1), padT + ph); ctx.lineTo(xOf(0), padT + ph); ctx.closePath();
        ctx.fillStyle = g; ctx.fill();
      }
      ctx.beginPath();
      vals.forEach((v, i) => (i ? ctx.lineTo(xOf(i), yOf(v)) : ctx.moveTo(xOf(i), yOf(v))));
      ctx.strokeStyle = s.color; ctx.lineWidth = s.width ?? 2; ctx.lineJoin = 'round';
      ctx.shadowColor = s.color; ctx.shadowBlur = 8;
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (s.dot) {
        const last = n - 1;
        ctx.beginPath(); ctx.arc(xOf(last), yOf(vals[last]), 4, 0, Math.PI * 2);
        ctx.fillStyle = s.color; ctx.fill();
      }
    }
    if (this.marker) {
      const { x, label } = this.marker;
      const n = this.series[0]?.values.length ?? 2;
      const mx = padL + (pw * x) / Math.max(1, n - 1);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(mx, padT); ctx.lineTo(mx, padT + ph); ctx.stroke();
      ctx.setLineDash([]);
      if (label) { ctx.fillStyle = '#e6edf3'; ctx.textAlign = 'center'; ctx.fillText(label, mx, padT + 10); }
    }
  }
  dispose() { this.ro.disconnect(); }
}

// Sets a list of [label, value] pairs into a key-value grid element. Small helper for readouts.
export function readout(label, value, cls = '') {
  const v = el('b', {}, value);
  return { root: el('div', { class: `k-read ${cls}` }, el('span', {}, label), v), set(t) { v.textContent = t; } };
}
