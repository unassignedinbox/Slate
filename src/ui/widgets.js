/* ============================================================================
   widgets — a 60-line DOM helper plus the editor's icon set and form controls.
   ========================================================================== */

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  const add = (c) => {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) { c.forEach(add); return; }
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  };
  children.forEach(add);
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }

/* ----------------------------------------------------------------- icons -- */

const S = (d, extra = '') =>
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;

export const Icon = {
  cursor: S('<path d="M5 3l6.5 16 2.2-6.4 6.3-2.2z"/>'),
  pen: S('<path d="M4 20h4L20 8l-4-4L4 16z"/><path d="M14 6l4 4"/>'),
  nodePlus: S('<circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="6" r="2.4"/><path d="M8 16.4l8-8.2"/>'),
  brush: S('<path d="M4 14c3 0 3-4 6-4s3 4 6 4 3-4 4-4"/><path d="M4 18h16"/>'),
  grid: S('<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),
  wire: S('<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>'),
  undo: S('<path d="M4 9h11a5 5 0 010 10H9"/><path d="M8 5L4 9l4 4"/>'),
  redo: S('<path d="M20 9H9a5 5 0 000 10h6"/><path d="M16 5l4 4-4 4"/>'),
  trash: S('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  focus: S('<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>'),
  camera: S('<path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/>'),
  dice: S('<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><circle cx="15" cy="15" r="1"/><circle cx="9" cy="15" r="1"/><circle cx="15" cy="9" r="1"/>'),
  save: S('<path d="M4 5h11l5 5v9H4z"/><path d="M8 5v5h7"/><rect x="8" y="13" width="8" height="6"/>'),
  open: S('<path d="M3 7h6l2 2h10v9H3z"/>'),
  export: S('<path d="M12 15V4"/><path d="M8 8l4-4 4 4"/><path d="M4 15v4h16v-4"/>'),
  layers: S('<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  minus: S('<path d="M5 12h14"/>'),
  x: S('<path d="M6 6l12 12M18 6L6 18"/>'),
  split: S('<path d="M4 12h16"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/>'),
  merge: S('<circle cx="7" cy="12" r="2"/><circle cx="17" cy="12" r="2"/><path d="M9 12h6"/>'),
  eye: S('<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/>'),
  caret: '<svg viewBox="0 0 24 24" width="9" height="9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  road: S('<path d="M7 3L4 21M17 3l3 18"/><path d="M12 4v2M12 9v2M12 14v2M12 19v2"/>'),
  rail: S('<path d="M6 3v18M18 3v18"/><path d="M4 7h16M4 12h16M4 17h16"/>'),
  path: S('<path d="M6 21c0-6 3-8 6-8s6 2 6 8"/><circle cx="12" cy="6" r="2.5"/>'),
  stats: S('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
  settings: S('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>'),
  chevronRight: S('<path d="M9 6l6 6-6 6"/>'),
  compass: S('<circle cx="12" cy="12" r="9"/><path d="M15 9l-2 5-5 2 2-5z"/>'),
  copy: S('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 012-2h10"/>'),
  width: S('<path d="M4 12h16"/><path d="M6 8v8M18 8v8"/>'),
};

export function icon(name, cls = '') {
  const span = document.createElement('span');
  span.className = `ic ${cls}`;
  span.innerHTML = Icon[name] || '';
  span.style.display = 'inline-flex';
  return span;
}

/* --------------------------------------------------------------- controls -- */

export function section(title, { collapsed = false, aux = '', scroll = false, id = '' } = {}) {
  const body = h('div', { class: 'sect-body' });
  const caret = h('span', { class: 'caret', html: Icon.caret });
  const head = h('div', { class: 'sect-head' }, caret, h('span', { class: 'title' }, title), h('span', { class: 'aux' }, aux));
  const root = h('div', { class: `sect${collapsed ? ' collapsed' : ''}${scroll ? ' scroll' : ''}`, id }, head, body);
  head.addEventListener('click', () => root.classList.toggle('collapsed'));
  return { root, body, head, setAux: (t) => { $(' .aux', head).textContent = t; } };
}

export function field(label, control, { wide = false } = {}) {
  return h('div', { class: `field${wide ? ' wide' : ''}` }, label ? h('label', {}, label) : null, h('div', { class: 'ctl' }, control));
}

export function numberInput(value, { min, max, step = 0.1, unit = '', onInput, precision = 2 } = {}) {
  const input = h('input', { type: 'number', value: fmtNum(value, precision), min, max, step });
  const wrap = h('div', { class: 'num' }, input, unit ? h('span', { class: 'unit' }, unit) : null, h('div', { class: 'drag' }));
  input.addEventListener('input', () => onInput?.(parseFloat(input.value)));
  input.addEventListener('change', () => { input.value = fmtNum(parseFloat(input.value), precision); });

  // drag-to-scrub on the grip
  const grip = wrap.lastChild;
  let dragging = false, startX = 0, startV = 0;
  grip.addEventListener('pointerdown', (e) => {
    dragging = true; startX = e.clientX; startV = parseFloat(input.value) || 0;
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const s = step ?? 0.1;
    let v = startV + (e.clientX - startX) * s * (e.shiftKey ? 4 : e.altKey ? 0.2 : 1);
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    v = Math.round(v / s) * s;
    input.value = fmtNum(v, precision);
    onInput?.(v);
  });
  const stop = (e) => { dragging = false; try { grip.releasePointerCapture(e.pointerId); } catch {} };
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);
  return { root: wrap, input, set: (v) => { input.value = fmtNum(v, precision); } };
}

export function slider(value, { min = 0, max = 1, step = 0.01, onInput, format = (v) => v.toFixed(2) } = {}) {
  const input = h('input', { type: 'range', value, min, max, step });
  const val = h('span', { class: 'val' }, format(value));
  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    val.textContent = format(v);
    onInput?.(v);
  });
  const row = h('div', { class: 'slider-row' }, input, val);
  return { root: row, input, set: (v) => { input.value = v; val.textContent = format(v); } };
}

export function checkbox(label, value, onChange) {
  const input = h('input', { type: 'checkbox' });
  input.checked = !!value;
  const root = h('label', { class: 'check' }, input, h('span', { class: 'box' }), h('span', {}, label));
  input.addEventListener('change', () => onChange?.(input.checked));
  return { root, input, set: (v) => { input.checked = !!v; } };
}

export function select(options, value, onChange, { placeholder = '' } = {}) {
  const sel = h('select', {});
  if (placeholder) sel.appendChild(h('option', { value: '', disabled: true }, placeholder));
  for (const o of options) {
    const opt = typeof o === 'string' ? h('option', { value: o }, o) : h('option', { value: o.value }, o.label);
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.addEventListener('change', () => onChange?.(sel.value));
  return { root: sel, el: sel, set: (v) => { sel.value = v; } };
}

export function segmented(options, value, onChange) {
  const root = h('div', { class: 'seg' });
  const btns = new Map();
  for (const o of options) {
    const b = h('button', { type: 'button', class: value === o.value ? 'on' : '' }, o.label);
    b.addEventListener('click', () => {
      for (const [, bb] of btns) bb.classList.remove('on');
      b.classList.add('on');
      onChange?.(o.value);
    });
    btns.set(o.value, b);
    root.appendChild(b);
  }
  return { root, set: (v) => { for (const [k, b] of btns) b.classList.toggle('on', k === v); } };
}

export function button(label, onClick, cls = '') {
  return h('button', { class: `btn ${cls}`, type: 'button', onclick: onClick }, label);
}

export function chip(label, active, onClick) {
  const c = h('span', { class: `chip${active ? ' on' : ''}` }, label);
  c.addEventListener('click', () => onClick?.());
  return c;
}

export function kv(rows) {
  const t = h('table', { class: 'kv-table' });
  for (const [k, v] of rows) t.appendChild(h('tr', {}, h('td', { class: 'k' }, k), h('td', { class: 'v' }, v)));
  return t;
}

export function fmtNum(v, p = 2) {
  if (v === null || v === undefined || Number.isNaN(v)) return '0';
  const s = v.toFixed(p);
  return s.replace(/\.?0+$/, '') || '0';
}

export function fmtInt(v) {
  return Math.round(v || 0).toLocaleString('en-US');
}
