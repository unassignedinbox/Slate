// Suspension: live 3D car with exposed wishbones, pushrods and coilovers, plus corner travel
// readouts, a trace, and setup sliders. Slider changes go straight to the vehicle model;
// on the real car they become setup writes to the C++ control layer.
import { el, slider, Trace } from '../ui.js';
import { createCarView } from '../car3d.js';
import { liveryColor } from '../backend.js';

const CORNER_NAMES = { fl: 'Front left', fr: 'Front right', rl: 'Rear left', rr: 'Rear right' };

export default {
  id: 'suspension', name: 'Suspension', icon: 'suspension', color: '#f59e0b',
  open(body, ctx) {
    const viewport = el('div', { class: 'viewport' });
    const tag = el('div', { class: 'vp-tag' }, 'LIVE · visual ×2.5');
    const presets = ['orbit', 'front', 'side', 'rear', 'top'].map((p) =>
      el('button', { class: 'chip', onclick: () => view.setPreset(p) }, p[0].toUpperCase() + p.slice(1)));
    viewport.append(el('div', { class: 'vp-bar' }, presets), tag);

    const S = ctx.sim.settings;
    const sliders = {
      rideHeight: slider({ label: 'Ride height', min: -25, max: 25, step: 1, value: S.rideHeight, format: (v) => `${v > 0 ? '+' : ''}${v} mm`, onInput: (v) => ctx.sim.set({ rideHeight: v }) }),
      springRate: slider({ label: 'Spring rate', min: 0, max: 1, step: 0.01, value: S.springRate, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ctx.sim.set({ springRate: v }) }),
      damping: slider({ label: 'Damping', min: 0, max: 1, step: 0.01, value: S.damping, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ctx.sim.set({ damping: v }) }),
      antiRoll: slider({ label: 'Anti-roll bar', min: 0, max: 1, step: 0.01, value: S.antiRoll, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ctx.sim.set({ antiRoll: v }) }),
    };

    const corners = {};
    const cornerGrid = el('div', { class: 'corner-grid' }, ['fl', 'fr', 'rl', 'rr'].map((c) => {
      const val = el('b', {}, '0.0');
      const mark = el('i', { class: 'mark' });
      const node = el('div', { class: 'corner' }, el('span', {}, CORNER_NAMES[c]), val, el('small', {}, 'mm travel'),
        el('div', { class: 'travel' }, el('i', { class: 'zero' }), mark));
      corners[c] = { val, mark };
      return node;
    }));

    const roll = el('b', {}, '0.0°'), pitch = el('b', {}, '0.0°'), heave = el('b', {}, '0 mm');
    const traceCanvas = el('canvas', { class: 'trace' });
    const trace = new Trace(traceCanvas, {
      min: -50, max: 70, samples: 240,
      series: [
        { label: 'FL', color: '#2ee6c5' }, { label: 'FR', color: '#38bdf8' },
        { label: 'RL', color: '#f59e0b' }, { label: 'RR', color: '#f472b6' },
      ],
    });
    const panel = el('aside', { class: 'panel' },
      el('h3', {}, 'Setup'),
      ...Object.values(sliders).map((s) => s.root),
      el('h3', {}, 'Corner travel'),
      cornerGrid,
      el('div', { class: 'attitude' }, el('span', {}, 'Roll'), roll, el('span', {}, 'Pitch'), pitch, el('span', {}, 'Heave'), heave),
      el('h3', {}, 'Travel · last 8 s'),
      traceCanvas,
    );

    body.append(el('div', { class: 'split' }, viewport, panel));

    let view;
    try {
      view = createCarView(viewport, { accent: liveryColor(ctx.backend.account.equippedLivery) });
    } catch (err) {
      viewport.append(el('div', { class: 'app-error' }, '3D view unavailable (WebGL is required).'));
      view = { update() {}, setPreset() {}, setAccent() {}, dispose() {} };
    }
    const offLivery = ctx.bus.on('livery', (hex) => view.setAccent(hex));

    let frameNo = 0;
    function update(f) {
      frameNo++;
      view.update(f);
      for (const c of ['fl', 'fr', 'rl', 'rr']) {
        const mm = f.susp[c];
        corners[c].val.textContent = mm.toFixed(1);
        const pct = Math.max(0, Math.min(100, ((mm + 50) / 120) * 100));
        corners[c].mark.style.left = `${pct}%`;
        corners[c].mark.classList.toggle('hot', Math.abs(mm) > 45);
      }
      roll.textContent = `${f.attitude.rollDeg.toFixed(1)}°`;
      pitch.textContent = `${f.attitude.pitchDeg.toFixed(1)}°`;
      heave.textContent = `${f.attitude.heaveMm.toFixed(0)} mm`;
      if (frameNo % 3 === 0) trace.push([f.susp.fl, f.susp.fr, f.susp.rl, f.susp.rr]);
      // Keep sliders in sync when settings change elsewhere (setup packs).
      for (const [key, s] of Object.entries(sliders)) {
        if (document.activeElement !== s.input && Math.abs(parseFloat(s.input.value) - f.settings[key]) > 1e-3) s.set(f.settings[key]);
      }
    }

    return {
      update,
      destroy() {
        offLivery();
        trace.dispose();
        view.dispose();
      },
    };
  },
};
