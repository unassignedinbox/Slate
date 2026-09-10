// UI control kit — mirrors the Slate component reference:
// thin sliders · value pills with exact-entry · seg controls · switches.
export function el(tag, cls, parent) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

export function fmtVal(v, unit) {
  const a = Math.abs(v);
  let s;
  if (a >= 100) s = v.toFixed(0);
  else if (a >= 10) s = v.toFixed(1);
  else s = v.toFixed(2);
  if (s === '-0.00' || s === '-0.0') s = '0';
  return s + (unit ? `<span class="unit">${unit}</span>` : '');
}

// ── slider row ────────────────────────────────────────────
export function slider(parent, { label, min, max, step, value, unit = '', fmt, onChange }) {
  const row = el('div', 'ctl', parent);
  const lab = el('label', '', row);
  lab.textContent = label;
  const track = el('div', 'track', row);
  const fill = el('div', 'fill', track);
  const knob = el('div', 'knob', track);
  const pill = el('div', 'vpill', row);

  let val = value;
  const clamp01 = v => Math.min(Math.max((v - min) / (max - min), 0), 1);
  const draw = () => {
    const t = clamp01(val);
    fill.style.width = `${t * 100}%`;
    knob.style.left = `${t * 100}%`;
    pill.innerHTML = fmt ? fmt(val) : fmtVal(val, unit);
  };
  const commit = (v, fire = true) => {
    val = Math.min(Math.max(Math.round(v / step) * step, min), max);
    draw();
    if (fire && onChange) onChange(val);
  };
  // drag
  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const r = track.getBoundingClientRect();
      commit(min + (max - min) * ((ev.clientX - r.left) / r.width));
    };
    move(e);
    const up = () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
  });
  // exact entry
  const edit = () => {
    pill.innerHTML = '';
    const inp = el('input', '', pill);
    inp.value = String(val);
    inp.focus(); inp.select();
    const done = (ok) => {
      if (ok && inp.value.trim() !== '') {
        const v = parseFloat(inp.value);
        if (!Number.isNaN(v)) commit(v);
      } else draw();
    };
    inp.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') done(true);
      else if (ev.key === 'Escape') done(false);
      ev.stopPropagation();
    });
    inp.addEventListener('blur', () => done(true));
  };
  pill.addEventListener('click', edit);
  pill.tabIndex = 0;
  draw();
  return {
    row, get value() { return val; },
    set(v) { commit(v, false); },
    destroy() { row.remove(); },
  };
}

// ── toggle row ────────────────────────────────────────────
export function toggle(parent, { label, hint, value, onChange }) {
  const row = el('div', 'tgl-row', parent);
  const lab = el('label', '', row);
  lab.textContent = label;
  if (hint) { const h = el('span', 'hint', row); h.textContent = hint; }
  const sw = el('div', 'switch' + (value ? ' on' : ''), row);
  row.addEventListener('click', () => {
    const on = sw.classList.toggle('on');
    if (onChange) onChange(on);
  });
  return { row, get value() { return sw.classList.contains('on'); }, set(v) { sw.classList.toggle('on', !!v); } };
}

// ── segmented control ─────────────────────────────────────
export function seg(parent, options, value, onChange, small) {
  const s = el('div', 'seg' + (small ? ' small' : ''), parent);
  const btns = new Map();
  options.forEach(o => {
    const b = el('button', '', s);
    b.innerHTML = (o.icon ? `<span>${o.icon}</span>` : '') + o.label + (o.kbd ? ` <kbd>${o.kbd}</kbd>` : '');
    b.addEventListener('click', () => { set(o.id); if (onChange) onChange(o.id); });
    btns.set(o.id, b);
  });
  function set(v) {
    btns.forEach((b, id) => b.classList.toggle('on', id === v));
  }
  set(value);
  return { root: s, set };
}

// ── buttons ───────────────────────────────────────────────
export function buttonRow(parent, buttons) {
  const row = el('div', 'ctlrow', parent);
  const out = {};
  buttons.forEach(b => {
    const btn = el('button', 'cbtn' + (b.danger ? ' danger' : '') + (b.on ? ' on' : ''), row);
    btn.textContent = b.label;
    btn.addEventListener('click', b.onClick);
    out[b.id] = btn;
  });
  return out;
}

export function section(parent, title) {
  const s = el('div', 'sect', parent);
  const t = el('div', 'sect-title', s);
  t.textContent = title;
  const well = el('div', 'well', s);
  return { root: s, well };
}

export function kv(parent, pairs) {
  const w = el('div', '', parent);
  const map = {};
  pairs.forEach(([k, v]) => {
    const r = el('div', 'kv', w);
    const kl = el('span', '', r); kl.textContent = k;
    const vl = el('b', '', r); vl.textContent = v;
    map[k] = vl;
  });
  return { root: w, set(k, v) { if (map[k]) map[k].textContent = v; } };
}

export function note(parent, html) {
  const n = el('div', 'note', parent);
  n.innerHTML = html;
  return n;
}

// ── toasts ────────────────────────────────────────────────
export function toast(msg, err = false) {
  const holder = document.getElementById('toasts');
  const t = el('div', 'toast' + (err ? ' err' : ''), holder);
  t.textContent = msg;
  setTimeout(() => {
    t.style.transition = 'opacity .4s';
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 420);
  }, 2600);
}
