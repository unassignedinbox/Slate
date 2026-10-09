import { svgIcon } from '../ui/icons.js';
import { h, segmented, statTile, meter, button, toast } from '../ui/widgets.js';
import { state, set } from '../core/store.js';
import { owns } from '../core/economy.js';
import { TyreViewport } from '../render3d/scenes.js';
import { CORNERS } from '../render3d/car.js';

const COMPOUNDS = [
  { id: 'soft', label: 'Soft', sku: 'TYRE_SOFT' },
  { id: 'medium', label: 'Medium', sku: 'TYRE_MEDIUM' },
  { id: 'hard', label: 'Hard', sku: 'TYRE_HARD' },
];

export default {
  id: 'tyres',
  name: 'Tyres',
  icon: svgIcon('tyres'),
  color: '#2EE59D',
  group: 'vehicle',
  create() {
    let vp = null;
    let corner = 'FL';
    const host = h('div', { class: 'vp-host' }, h('div', { class: 'vp-label', text: 'TYRE · TEMPERATURE ZONES' }));

    const cornerSeg = segmented(CORNERS.map((c) => ({ value: c, label: c })), corner, (c) => {
      corner = c;
      cornerSeg.set(c);
      vp?.setCorner(c);
    });
    const temp = statTile('Temperature', '°C');
    const pres = statTile('Pressure', 'bar');
    const wear = meter('Wear', { color: 'var(--warn)' });

    function applyCompound(c) {
      for (const k of CORNERS) set(`vehicle.tyres.${k}.compound`, c.id);
      toast(`${c.label} compound fitted`);
    }
    const compBtns = COMPOUNDS.map((c) => {
      const b = h('button', { class: 'seg', onclick: () => {
        if (!owns(c.sku)) { toast(`${c.label} locked: buy it in the Store`); return; }
        applyCompound(c);
      } }, c.label);
      b.dataset.id = c.id;
      return b;
    });

    const el = h('div', { class: 'split' },
      h('div', { class: 'split-left' }, host),
      h('div', { class: 'split-right' },
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Corner' }),
          cornerSeg.el),
        h('div', { class: 'card' },
          h('div', { class: 'side-tiles' }, temp.el, pres.el),
          wear.el),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Compound (applied to all four)' }),
          h('div', { class: 'segmented' }, compBtns)),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Pit stop' }),
          h('div', { class: 'btn-row' }, button('Fit fresh set (reset wear)', () => {
            for (const k of CORNERS) set(`vehicle.tyres.${k}.wearPct`, 0);
            toast('Fresh set fitted');
          }, 'btn primary')))));

    return {
      el,
      mount() { vp ??= new TyreViewport(host); vp.setCorner(corner); },
      unmount() { vp?.dispose(); vp = null; },
      update(s) {
        const t = s.vehicle.tyres[corner];
        temp.set(t.tempC.toFixed(0));
        pres.set(t.pressureBar.toFixed(2));
        wear.set(t.wearPct / 100, `${t.wearPct.toFixed(1)}%`);
        compBtns.forEach((b) => b.classList.toggle('on', t.compound === b.dataset.id));
      },
    };
  },
};
