// Small DOM + SVG helpers. No framework: views update via setText / setters.
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      } else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'text') el.textContent = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}

// Only touch the DOM when the text actually changed (keeps 60 Hz updates cheap).
export function setText(el, value) {
  const s = String(value);
  if (el.__t !== s) { el.__t = s; el.textContent = s; }
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...children);
  return el;
}

// 270° arc gauge with ticks. set(value) fills it to value / max.
export function arcGauge({ size = 220, max = 360 } = {}) {
  const c = size / 2, r = c - 14, start = 135, sweep = 270;
  const pol = (deg, rr = r) => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [c + rr * Math.cos(a), c + rr * Math.sin(a)];
  };
  const arc = (a0, a1) => {
    const [x0, y0] = pol(a0), [x1, y1] = pol(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const d = arc(start, start + sweep);
  const ticks = [];
  for (let i = 0; i <= 12; i++) {
    const deg = start + (sweep * i) / 12;
    const [x0, y0] = pol(deg, r - 6), [x1, y1] = pol(deg, r - 16);
    ticks.push(svg('line', { x1: x0, y1: y0, x2: x1, y2: y1, class: 'tick' }));
  }
  const fill = svg('path', { d, class: 'arc-fill', pathLength: 100, 'stroke-dasharray': '0 100' });
  const el = h('div', { class: 'gauge', style: { width: `${size}px`, height: `${size}px` } },
    svg('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size },
      svg('path', { d, class: 'arc-track', pathLength: 100 }), fill, ...ticks));
  return {
    el,
    set(v) { fill.setAttribute('stroke-dasharray', `${clamp(v / max, 0, 1) * 100} 100`); },
  };
}

// Horizontal bar with label + value. set(0..1, optionalText)
export function meter(label, { color = 'var(--accent)' } = {}) {
  const fill = h('div', { class: 'meter-fill', style: { background: color } });
  const val = h('span', { class: 'meter-val' });
  const el = h('div', { class: 'meter' },
    h('div', { class: 'meter-head' }, h('span', { text: label }), val),
    h('div', { class: 'meter-track' }, fill));
  return {
    el,
    set(v01, text) {
      const p = clamp(v01, 0, 1);
      fill.style.width = `${(p * 100).toFixed(1)}%`;
      setText(val, text ?? `${Math.round(p * 100)}%`);
    },
  };
}

// Rolling line chart. push(value) appends a sample.
export function sparkline({ w = 300, h: hh = 60, min = 0, max = 100, points = 150 } = {}) {
  const line = svg('polyline', { class: 'spark-line', fill: 'none', 'vector-effect': 'non-scaling-stroke' });
  const root = svg('svg', { viewBox: `0 0 ${w} ${hh}`, preserveAspectRatio: 'none', class: 'spark' }, line);
  const data = [];
  return {
    el: root,
    push(v) {
      data.push(v);
      if (data.length > points) data.shift();
      const step = w / (points - 1);
      line.setAttribute('points', data.map((d, i) => {
        const y = hh - ((clamp(d, min, max) - min) / (max - min)) * hh;
        return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
      }).join(' '));
    },
  };
}

export function slider({ label, min, max, step = 1, value, unit = '', fmt, onInput }) {
  const f = fmt ?? ((v) => `${v}${unit}`);
  const out = h('span', { class: 'val' });
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => { const v = Number(e.target.value); setText(out, f(v)); onInput?.(v); },
  });
  setText(out, f(value));
  const el = h('label', { class: 'slider' },
    h('div', { class: 'row' }, h('span', { text: label }), out), input);
  return {
    el,
    set(v) {
      if (document.activeElement !== input) input.value = v;
      setText(out, f(v));
    },
  };
}

export function segmented(options, value, onChange) {
  const btns = options.map((o) => {
    const b = h('button', { class: 'seg', onclick: () => onChange(o.value) }, o.label);
    b.dataset.v = String(o.value);
    return b;
  });
  const set = (v) => btns.forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
  set(value);
  return { el: h('div', { class: 'segmented' }, btns), set, buttons: btns };
}

export function toggle({ label, value, onChange }) {
  const sw = h('button', {
    class: 'switch', role: 'switch',
    onclick: () => { const nv = !sw.classList.contains('on'); apply(nv); onChange(nv); },
  });
  const apply = (v) => { sw.classList.toggle('on', !!v); sw.setAttribute('aria-checked', String(!!v)); };
  apply(value);
  return { el: h('div', { class: 'row toggle-row' }, h('span', { text: label }), sw), set: apply };
}

export function button(label, onClick, cls = 'btn') {
  return h('button', { class: cls, onclick: onClick }, label);
}

// Metric tile: small label + big value.
export function statTile(label, unit = '') {
  const val = h('div', { class: 'big' });
  return {
    el: h('div', { class: 'tile' },
      h('div', { class: 'k', text: label }),
      h('div', { class: 'row' }, val, h('span', { class: 's', text: unit }))),
    set(v) { setText(val, v); },
  };
}

let toastHost = null;
export function toast(msg) {
  if (!toastHost) {
    toastHost = h('div', { class: 'toast-host' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: 'toast' }, msg);
  toastHost.append(t);
  setTimeout(() => t.remove(), 2200);
}
