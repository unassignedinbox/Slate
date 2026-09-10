// Outliner — left panel: graph nodes + scene overlays, with eye toggles.
import { DEFS, CAT } from '../core/graph.js';
import { el } from './widgets.js';

export class Outliner {
  constructor(app) {
    this.app = app;
    this.list = document.getElementById('nodeList');
    this.ovl = document.getElementById('overlayList');
    this.render();
  }

  render() {
    const app = this.app;
    this.list.innerHTML = '';
    this.ovl.innerHTML = '';
    // nodes in graph order (output last)
    const order = app.graph.chain();
    order.forEach(n => {
      const def = DEFS[n.type];
      const row = el('div', 'row' + (app.selection === n.id ? ' sel' : '') + (n.enabled ? '' : ' hid'), this.list);
      row.style.setProperty('--acc', CAT[def.cat].color);
      const ico = el('div', 'ico', row); ico.textContent = def.icon;
      const txt = el('div', 'txt', row);
      const nm = el('div', 'name', txt); nm.textContent = def.label;
      const mt = el('div', 'meta', txt);
      mt.textContent = def.sim ? Object.entries(n.params).slice(0, 2).map(([k, v]) => `${k} ${v}`).join(' · ') : CAT[def.cat].label;
      const eye = el('div', 'eye', row); eye.textContent = n.enabled ? '◉' : '◌';
      eye.addEventListener('click', (e) => {
        e.stopPropagation();
        n.enabled = !n.enabled;
        app.onGraphStructure();
      });
      if (n.type !== 'output') {
        const del = el('div', 'del', row); del.textContent = '✕';
        del.addEventListener('click', (e) => { e.stopPropagation(); app.deleteNode(n.id); });
      }
      row.addEventListener('click', () => app.select(n.id));
    });
    // overlays
    const offLevel = app.waterOffLevel();
    [
      { id: 'particles', label: 'Agent particles', get: () => app.renderer.showParticles, set: v => { app.renderer.showParticles = v; } },
      { id: 'flow', label: 'Flow overlay', get: () => app.renderer.mode === 5, set: v => { app.renderer.mode = v ? 5 : 0; } },
      {
        id: 'water', label: 'Water surface',
        get: () => app.renderer.opts.waterLevel > offLevel,
        set: v => {
          if (v) app.renderer.opts.waterLevel = app.savedWater ?? 0;
          else { app.savedWater = app.renderer.opts.waterLevel; app.renderer.opts.waterLevel = offLevel; }
        },
      },
    ].forEach(o => {
      const on = o.get();
      const row = el('div', 'row' + (on ? '' : ' hid'), this.ovl);
      row.style.setProperty('--acc', 'var(--blue)');
      const ico = el('div', 'ico', row); ico.textContent = o.id === 'particles' ? '⁘' : o.id === 'flow' ? '↭' : '≈';
      const txt = el('div', 'txt', row);
      const nm = el('div', 'name', txt); nm.textContent = o.label;
      const eye = el('div', 'eye', row); eye.textContent = on ? '◉' : '◌';
      eye.addEventListener('click', (e) => { e.stopPropagation(); o.set(!o.get()); this.render(); });
      row.addEventListener('click', () => { o.set(!o.get()); this.render(); });
    });
  }
}
