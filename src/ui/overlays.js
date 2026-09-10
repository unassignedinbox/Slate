// Overlays — help sheet, add-node & preset menus, diagnostics console.
import { DEFS, CAT } from '../core/graph.js';
import { el } from './widgets.js';

export function buildHelp() {
  const h = document.getElementById('help');
  h.innerHTML = '';
  const card = el('div', 'glass help-card', h);
  const h2 = el('h2', '', card);
  h2.innerHTML = '<span class="dot"></span> SLATE — SDF Terrain Studio';
  const sub = el('div', 'sub', card);
  sub.textContent = 'Node-based volumetric terrain: true SDF caves & overhangs, GPU particle erosion (rain · river · wind · thermal), sediment transport with settling, and a water shader advected by the simulated flow field.';
  const grid = el('div', 'help-grid', card);
  const col = (title, rows) => {
    const c = el('div', '', grid);
    const t = el('h3', '', c); t.textContent = title;
    rows.forEach(([k, v]) => {
      const r = el('div', 'hk', c);
      const a = el('span', '', r); a.textContent = k;
      const b = el('span', '', r); b.innerHTML = v;
    });
  };
  col('Viewport', [
    ['Orbit', 'LMB drag'],
    ['Pan', '<kbd>⇧</kbd> LMB / MMB'],
    ['Dolly', 'wheel'],
    ['Frame scene', '<kbd>F</kbd>'],
    ['View modes', '<kbd>1</kbd>–<kbd>5</kbd>'],
  ]);
  col('Simulation', [
    ['Run / pause', '<kbd>Space</kbd>'],
    ['Single step', '<kbd>.</kbd>'],
    ['Rebuild field', '<kbd>B</kbd>'],
    ['Speed', 'header ×0.5–×4'],
  ]);
  col('Graph', [
    ['Toggle drawer', '<kbd>Tab</kbd>'],
    ['Add node', 'right-click graph'],
    ['Delete node', '<kbd>⌫</kbd>'],
    ['Duplicate', '<kbd>Ctrl</kbd> <kbd>D</kbd>'],
    ['Tidy layout', '<kbd>L</kbd>'],
  ]);
  col('Interface', [
    ['Help', '<kbd>?</kbd>'],
    ['Diagnostics', '<kbd>`</kbd>'],
    ['Save graph', '<kbd>Ctrl</kbd> <kbd>S</kbd>'],
    ['Escape', 'close overlays'],
  ]);
  const tips = el('div', 'note', card);
  tips.style.marginTop = '20px';
  tips.innerHTML = `<b>Workflow</b> — start from a Terrain Mass primitive, shape it with Patterns (Ridged, Warp, Terrace), then chain Erosion nodes and press <b>Space</b>. Rain, river and wind agents cut and deposit in realtime; particles settle once their load or cut-cap is reached, so terrain keeps its mass. Drop a Subtract→Sphere <b>after</b> an erosion node to carve cave entrances into the eroded result.`;
  h.addEventListener('click', (e) => { if (e.target === h) h.hidden = true; });
}

export class Menus {
  constructor(app) {
    this.app = app;
    this.addEl = document.getElementById('addmenu');
    this.presetEl = document.getElementById('presetmenu');
    this.open = null;
    document.addEventListener('pointerdown', (e) => {
      if (this.open && !this[this.open].contains(e.target)) this.hide();
    });
  }
  hide() {
    this.addEl.classList.remove('show');
    this.presetEl.classList.remove('show');
    this.open = null;
  }
  addMenu(x, y, onPick) {
    const m = this.addEl;
    m.innerHTML = '';
    const search = el('input', 'mi-search', m);
    search.placeholder = 'Add node…';
    const listWrap = el('div', '', m);
    listWrap.style.overflowY = 'auto';
    const build = (filter) => {
      listWrap.innerHTML = '';
      Object.entries(CAT).forEach(([cat, meta]) => {
        const items = Object.entries(DEFS).filter(([t, d]) => d.cat === cat && (!filter || d.label.toLowerCase().includes(filter)));
        if (!items.length) return;
        const c = el('div', 'mi-cat', listWrap);
        c.textContent = meta.label.toUpperCase();
        items.forEach(([type, d]) => {
          if (type === 'output') return;
          const it = el('div', 'mi', listWrap);
          it.style.setProperty('--acc', meta.color);
          const ico = el('div', 'ico', it); ico.textContent = d.icon;
          const t = el('div', 't', it); t.textContent = d.label;
          it.addEventListener('click', () => { this.hide(); onPick(type); });
        });
      });
    };
    build('');
    search.addEventListener('input', () => build(search.value.toLowerCase()));
    search.addEventListener('keydown', (e) => e.stopPropagation());
    m.classList.add('show');
    m.style.left = `${Math.min(x, window.innerWidth - 330)}px`;
    m.style.top = `${Math.min(y, window.innerHeight - 460)}px`;
    this.open = 'addEl';
    setTimeout(() => search.focus(), 30);
  }
  presetMenu(x, y, onPick) {
    const m = this.presetEl;
    m.innerHTML = '';
    const c = el('div', 'mi-cat', m); c.textContent = 'PRESETS';
    this.app.presets.forEach(p => {
      const it = el('div', 'mi', m);
      it.style.setProperty('--acc', 'var(--cyan)');
      const ico = el('div', 'ico', it); ico.textContent = p.icon || '⛰';
      const t = el('div', 't', it); t.textContent = p.name;
      it.title = p.desc || '';
      it.addEventListener('click', () => { this.hide(); onPick(p); });
    });
    m.classList.add('show');
    m.style.left = `${Math.min(x, window.innerWidth - 330)}px`;
    m.style.top = `${Math.min(y, window.innerHeight - 320)}px`;
    this.open = 'presetEl';
  }
}

// diagnostics console: capture shader errors + runtime errors
export const Console = {
  lines: [],
  show(v) { document.getElementById('consolep').hidden = !v; },
  log(msg) {
    this.lines.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (this.lines.length > 400) this.lines.shift();
    const body = document.getElementById('conBody');
    if (body) {
      body.textContent = this.lines.join('\n');
      body.scrollTop = body.scrollHeight;
    }
  },
};
window.addEventListener('error', (e) => Console.log('error: ' + e.message));
