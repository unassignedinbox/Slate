// Tiny DOM helpers shared by the panels. No framework, no build step.

export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

export function card(title, hint, ...body) {
  return h('div', { class: 'card' },
    title ? h('h3', {}, title) : null,
    hint ? h('p', { class: 'hint' }, hint) : null,
    ...body);
}

export function slider(name, value, { min = 0, max = 1, step = 0.01, format, onInput, minLabel, maxLabel } = {}) {
  const fmt = format || ((v) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)));
  const val = h('span', { class: 'sval' }, fmt(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => {
      const v = Number(e.target.value);
      val.textContent = fmt(v);
      e.target.style.setProperty('--progress', `${((v - min) / (max - min)) * 100}%`);
      onInput?.(v);
    },
  });
  input.style.setProperty('--progress', `${((value - min) / (max - min)) * 100}%`);
  return h('div', { class: 'slider' },
    h('div', { class: 'srow' }, h('span', { class: 'sname' }, name), val),
    input,
    h('div', { class: 'minmax' },
      h('span', {}, minLabel ?? fmt(min)),
      h('span', {}, maxLabel ?? fmt(max))));
}

export function toggleRow(name, value, onChange, hint) {
  const btn = h('button', {
    class: 'toggle', 'aria-pressed': value ? 'true' : 'false', title: hint || name,
    onclick: () => {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', next ? 'true' : 'false');
      onChange(next);
    },
  });
  return h('div', { class: 'prop' }, h('span', { class: 'pname' }, name), btn);
}

export function selectRow(name, value, options, onChange) {
  const sel = h('select', { class: 'plain', onchange: (e) => onChange(e.target.value) },
    ...options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));
  return h('div', { class: 'slider' },
    h('div', { class: 'srow' }, h('span', { class: 'sname' }, name)), sel);
}

export function readout(name, value) {
  return h('div', { class: 'prop' }, h('span', { class: 'pname' }, name), h('span', { class: 'pval' }, value));
}

export function swatches(colours, current, onPick) {
  const match = (c) => Math.abs(c[0] - current[0]) < 0.02 && Math.abs(c[1] - current[1]) < 0.02 && Math.abs(c[2] - current[2]) < 0.02;
  return h('div', { class: 'swatches' },
    ...colours.map((c) => h('button', {
      class: 'swatch',
      'aria-pressed': match(c) ? 'true' : 'false',
      style: { background: rgb(c) },
      onclick: (e) => {
        for (const s of e.target.parentElement.children) s.setAttribute('aria-pressed', 'false');
        e.target.setAttribute('aria-pressed', 'true');
        onPick(c);
      },
    })));
}

export const rgb = (c) => `rgb(${Math.round(linToSrgb(c[0]) * 255)},${Math.round(linToSrgb(c[1]) * 255)},${Math.round(linToSrgb(c[2]) * 255)})`;
const linToSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055);

export function actions(...buttons) {
  return h('div', { class: 'inline-actions' }, ...buttons);
}

export function mini(label, onClick, cls = '') {
  return h('button', { class: `mini ${cls}`, onclick: onClick }, label);
}
