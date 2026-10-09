// Small DOM helpers shared by every app (no framework: keeps the port to a native toolkit simple).
export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) n.setAttribute(k, '');
    else n.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

export function slider({ label, min, max, step = 0.01, value, format = (v) => v.toFixed(2), onInput }) {
  const out = el('output', {}, format(value));
  const input = el('input', {
    type: 'range', min, max, step, value,
    onInput: (e) => {
      const v = parseFloat(e.target.value);
      out.textContent = format(v);
      onInput(v);
    },
  });
  const root = el('label', { class: 'slider' }, el('div', { class: 'slider-head' }, el('span', {}, label), out), input);
  return {
    root,
    input,
    set(v) { input.value = v; out.textContent = format(v); },
  };
}

// Scrolling multi-series trace on a canvas (suspension travel, tyre temps, ...).
export class Trace {
  constructor(canvas, { series, min, max, samples = 240 }) {
    this.canvas = canvas;
    this.series = series; // [{ label, color }]
    this.min = min; this.max = max; this.samples = samples;
    this.data = series.map(() => []);
    this.ctx = canvas.getContext('2d');
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(canvas);
    this.fit();
  }
  fit() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.canvas.width = Math.max(1, Math.floor(w * dpr));
    this.canvas.height = Math.max(1, Math.floor(h * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = w; this.h = h;
    this.draw();
  }
  push(values) {
    values.forEach((v, i) => {
      const arr = this.data[i];
      arr.push(v);
      if (arr.length > this.samples) arr.shift();
    });
    this.draw();
  }
  draw() {
    const { ctx, w, h } = this;
    if (!w || !h) return;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = Math.round((h * i) / 4) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    const yOf = (v) => h - ((v - this.min) / (this.max - this.min)) * h;
    this.series.forEach((s, si) => {
      const arr = this.data[si];
      if (arr.length < 2) return;
      ctx.beginPath();
      arr.forEach((v, i) => {
        const x = (i / (this.samples - 1)) * w;
        const y = yOf(v);
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      });
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }
  dispose() { this.ro.disconnect(); }
}

// Maps a temperature (degC) to a color: cold blue -> optimal green -> hot amber -> red.
const TEMP_STOPS = [[60, '#3b82f6'], [90, '#22c55e'], [110, '#f59e0b'], [130, '#ef4444']];
export function tempHex(t) {
  if (t <= TEMP_STOPS[0][0]) return TEMP_STOPS[0][1];
  for (let i = 1; i < TEMP_STOPS.length; i++) {
    const [t1, c1] = TEMP_STOPS[i];
    if (t <= t1) {
      const [t0, c0] = TEMP_STOPS[i - 1];
      return mix(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return TEMP_STOPS[TEMP_STOPS.length - 1][1];
}
export function mix(a, b, f) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (s) => [(s >> 16) & 255, (s >> 8) & 255, s & 255];
  const A = ch(pa), B = ch(pb);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * Math.min(1, Math.max(0, f))));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export const fmt = {
  time(s) {
    if (s == null || !isFinite(s)) return '--:--.---';
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${r.toFixed(3).padStart(6, '0')}`;
  },
  kn: (n) => (n / 1000).toFixed(1),
};
