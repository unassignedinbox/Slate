import { svgIcon } from '../ui/icons.js';
import { h, slider, statTile, button, toast } from '../ui/widgets.js';
import { state, set } from '../core/store.js';
import { owns } from '../core/economy.js';
import { AeroViewport } from '../render3d/scenes.js';

const PRESETS = [
  { label: 'Balanced', front: 12, rear: 18 },
  { label: 'High downforce', front: 26, rear: 32 },
  { label: 'Low drag', front: 6, rear: 8, sku: 'AERO_LOWDRAG' },
];

export default {
  id: 'aero',
  name: 'Aerodynamics',
  icon: svgIcon('aero'),
  color: '#00A3FF',
  group: 'vehicle',
  create() {
    let vp = null;
    const host = h('div', { class: 'vp-host' }, h('div', { class: 'vp-label', text: 'AIRFLOW · DRAG TO ORBIT' }));

    const setWing = (k, v) => set(`vehicle.aero.${k}`, v);
    const front = slider({ label: 'Front wing angle', min: 0, max: 30, value: state.vehicle.aero.frontWingDeg, unit: '°', onInput: (v) => setWing('frontWingDeg', v) });
    const rear = slider({ label: 'Rear wing angle', min: 0, max: 35, value: state.vehicle.aero.rearWingDeg, unit: '°', onInput: (v) => setWing('rearWingDeg', v) });
    const df = statTile('Downforce', 'N');
    const drag = statTile('Drag', 'N');
    const balance = statTile('Front balance', '%');

    function applyPreset(p) {
      if (p.sku && !owns(p.sku)) { toast('Locked: buy the Low-drag kit in the Store'); return; }
      setWing('frontWingDeg', p.front);
      setWing('rearWingDeg', p.rear);
      toast(`${p.label} preset`);
    }

    const presetBtns = PRESETS.map((p) => button(p.label, () => applyPreset(p)));
    const lockLabels = () => PRESETS.forEach((p, i) => {
      presetBtns[i].textContent = p.sku && !owns(p.sku) ? `Locked · ${p.label}` : p.label;
    });

    const el = h('div', { class: 'split' },
      h('div', { class: 'split-left' }, host),
      h('div', { class: 'split-right' },
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Live load' }),
          h('div', { class: 'side-tiles' }, df.el, drag.el, balance.el)),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Presets' }),
          h('div', { class: 'btn-row' }, presetBtns)),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Wing trim' }),
          front.el, rear.el)));

    return {
      el,
      mount() { vp ??= new AeroViewport(host); },
      unmount() { vp?.dispose(); vp = null; },
      update(s, path) {
        if (path === '*' || path === 'wallet') lockLabels();
        const a = s.vehicle.aero;
        front.set(a.frontWingDeg);
        rear.set(a.rearWingDeg);
        df.set(a.downforceN.toLocaleString('en-US'));
        drag.set(a.dragN.toLocaleString('en-US'));
        balance.set(Math.round(Math.min(70, Math.max(30, 50 + (a.frontWingDeg - a.rearWingDeg) * 0.8))));
      },
    };
  },
};
