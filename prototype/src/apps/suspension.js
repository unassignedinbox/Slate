import { svgIcon } from '../ui/icons.js';
import { h, meter, slider, button, toast } from '../ui/widgets.js';
import { state, set } from '../core/store.js';
import { SuspensionViewport } from '../render3d/scenes.js';

const PRESETS = {
  Qualifying: { front: 160, rear: 180, bump: 4, rebound: 6, arbF: 4, arbR: 3 },
  Race: { front: 200, rear: 220, bump: 6, rebound: 8, arbF: 3, arbR: 5 },
  Wet: { front: 140, rear: 160, bump: 3, rebound: 4, arbF: 2, arbR: 3 },
};

export default {
  id: 'suspension',
  name: 'Suspension',
  icon: svgIcon('suspension'),
  color: '#FF8A00',
  group: 'vehicle',
  create() {
    let vp = null;
    const host = h('div', { class: 'vp-host' }, h('div', { class: 'vp-label', text: 'LIVE 3D · SUSPENSION · DRAG TO ORBIT' }));

    const travel = {
      FL: meter('FL travel'), FR: meter('FR travel'), RL: meter('RL travel'), RR: meter('RR travel'),
    };
    const sus = () => state.vehicle.suspension;

    const sliders = {
      front: slider({ label: 'Front spring', min: 120, max: 300, step: 5, value: sus().springRate.front, unit: ' N/mm', onInput: (v) => set('vehicle.suspension.springRate.front', v) }),
      rear: slider({ label: 'Rear spring', min: 120, max: 300, step: 5, value: sus().springRate.rear, unit: ' N/mm', onInput: (v) => set('vehicle.suspension.springRate.rear', v) }),
      bump: slider({ label: 'Bump damping', min: 1, max: 12, value: sus().damper.bump, onInput: (v) => set('vehicle.suspension.damper.bump', v) }),
      rebound: slider({ label: 'Rebound damping', min: 1, max: 12, value: sus().damper.rebound, onInput: (v) => set('vehicle.suspension.damper.rebound', v) }),
      arbF: slider({ label: 'Front anti-roll bar', min: 1, max: 8, value: sus().antiRollBar.front, onInput: (v) => set('vehicle.suspension.antiRollBar.front', v) }),
      arbR: slider({ label: 'Rear anti-roll bar', min: 1, max: 8, value: sus().antiRollBar.rear, onInput: (v) => set('vehicle.suspension.antiRollBar.rear', v) }),
    };

    function applyPreset(name) {
      const p = PRESETS[name];
      set('vehicle.suspension.springRate.front', p.front);
      set('vehicle.suspension.springRate.rear', p.rear);
      set('vehicle.suspension.damper.bump', p.bump);
      set('vehicle.suspension.damper.rebound', p.rebound);
      set('vehicle.suspension.antiRollBar.front', p.arbF);
      set('vehicle.suspension.antiRollBar.rear', p.arbR);
      toast(`${name} setup loaded`);
    }

    const el = h('div', { class: 'split' },
      h('div', { class: 'split-left' }, host),
      h('div', { class: 'split-right' },
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Ride travel per corner' }),
          h('div', { class: 'travel-grid' }, Object.values(travel).map((m) => m.el))),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Setup presets' }),
          h('div', { class: 'btn-row' }, Object.keys(PRESETS).map((n) => button(n, () => applyPreset(n))))),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Springs, dampers, anti-roll' }),
          Object.values(sliders).map((s) => s.el))));

    return {
      el,
      mount() { vp ??= new SuspensionViewport(host); },
      unmount() { vp?.dispose(); vp = null; },
      update(s) {
        const t = s.vehicle.suspension.travelMm;
        for (const k of Object.keys(travel)) travel[k].set((t[k] - 10) / 80, `${t[k].toFixed(1)} mm`);
        const q = s.vehicle.suspension;
        sliders.front.set(q.springRate.front);
        sliders.rear.set(q.springRate.rear);
        sliders.bump.set(q.damper.bump);
        sliders.rebound.set(q.damper.rebound);
        sliders.arbF.set(q.antiRollBar.front);
        sliders.arbR.set(q.antiRollBar.rear);
      },
    };
  },
};

