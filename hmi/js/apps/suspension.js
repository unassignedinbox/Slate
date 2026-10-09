// Suspension: live 3D car with exposed wishbones, pushrods and coilovers, corner travel readouts,
// roll/pitch/heave, a travel trace, and setup controls. Slider changes go straight to the vehicle
// model; on the real car they become setup writes to the C++ control layer.
import { el, slider, Trace } from '../ui.js';
import { createCarView } from '../car3d.js';
import { liveryColor } from '../backend.js';
import { DEFAULT_SETTINGS } from '../vehicle.js';

const CORNERS = [['fl', 'Front left'], ['fr', 'Front right'], ['rl', 'Rear left'], ['rr', 'Rear right']];

export default {
  id: 'suspension', name: 'Suspension', icon: 'suspension', color: '#f59e0b',
  open(body, ctx) {
    // ---- 3D viewport with camera presets
    const viewport = el('div', { class: 'viewport sus-vp' });
    let view;
    const presets = ['orbit', 'front', 'side', 'rear', 'top'].map((p) =>
      el('button', { class: 'k-chip', onclick: () => { view.setPreset(p); presets.forEach((b) => b.classList.toggle('on', b.dataset.p === p)); }, 'data-p': p }, p[0].toUpperCase() + p.slice(1)));
    presets[0].classList.add('on');
    viewport.append(el('div', { class: 'vp-bar' }, presets), el('div', { class: 'vp-tag' }, 'LIVE · VISUAL ×2.5 · DRAG TO ORBIT'));

    // ---- setup panel
    const S = ctx.sim.settings;
    const sliders = {
      rideHeight: slider({ label: 'Ride height', min: -25, max: 25, step: 1, value: S.rideHeight, format: (v) => `${v > 0 ? '+' : ''}${v} mm`, onInput: (v) => ctx.sim.set({ rideHeight: v }) }),
      springRate: slider({ label: 'Spring rate', min: 0, max: 1, step: 0.01, value: S.springRate, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ctx.sim.set({ springRate: v }) }),
      damping: slider({ label: 'Damping', min: 0, max: 1, step: 0.01, value: S.damping, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ctx.sim.set({ damping: v }) }),
      antiRoll: slider({ label: 'Anti-roll bar', min: 0, max: 1, step: 0.01, value: S.antiRoll, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ctx.sim.set({ antiRoll: v }) }),
    };
    const reset = el('button', {
      class: 'k-btn ghost',
      onclick: () => {
        const d = { rideHeight: DEFAULT_SETTINGS.rideHeight, springRate: DEFAULT_SETTINGS.springRate, damping: DEFAULT_SETTINGS.damping, antiRoll: DEFAULT_SETTINGS.antiRoll };
        ctx.sim.set(d);
        for (const [k, s] of Object.entries(sliders)) s.set(d[k]);
        ctx.toast('Suspension reset to baseline', 'info');
      },
    }, 'Reset to baseline');
    const setupCard = el('section', { class: 'k-card sus-setup' },
      el('div', { class: 'k-cap' }, 'SETUP'),
      ...Object.values(sliders).map((s) => s.root),
      reset);

    // ---- corner travel
    const corners = {};
    const cornerGrid = el('div', { class: 'sus-corners' }, CORNERS.map(([c, name]) => {
      const val = el('b', {}, '0.0');
      const mark = el('i', { class: 'mark' });
      const fill = el('i', { class: 'fill' });
      const node = el('div', { class: 'sus-corner' },
        el('div', { class: 'sus-corner-h' }, el('span', {}, name), val),
        el('div', { class: 'travel' }, el('i', { class: 'zero' }), fill, mark),
        el('small', {}, 'mm · compression ← → rebound'));
      corners[c] = { val, mark, fill };
      return node;
    }));
    const roll = el('b', {}, '0.0°'), pitch = el('b', {}, '0.0°'), heave = el('b', {}, '0 mm');
    const attitude = el('div', { class: 'sus-att' },
      el('div', {}, el('span', { class: 'k-cap' }, 'ROLL'), roll),
      el('div', {}, el('span', { class: 'k-cap' }, 'PITCH'), pitch),
      el('div', {}, el('span', { class: 'k-cap' }, 'HEAVE'), heave));
    const cornerCard = el('section', { class: 'k-card sus-travel' }, el('div', { class: 'k-cap' }, 'CORNER TRAVEL'), cornerGrid, attitude);

    const traceCanvas = el('canvas', { class: 'trace sus-trace' });
    const trace = new Trace(traceCanvas, {
      min: -50, max: 70, samples: 240,
      series: [
        { label: 'FL', color: '#2ee6c5' }, { label: 'FR', color: '#38bdf8' },
        { label: 'RL', color: '#f59e0b' }, { label: 'RR', color: '#f472b6' },
      ],
    });
    const traceCard = el('section', { class: 'k-card sus-tracecard' },
      el('div', { class: 'k-cap' }, 'TRAVEL · LAST 8 S'),
      traceCanvas,
      el('div', { class: 'sus-legend' }, ['FL', 'FR', 'RL', 'RR'].map((n, i) => el('span', {}, el('i', { style: { background: ['#2ee6c5', '#38bdf8', '#f59e0b', '#f472b6'][i] } }), n))));

    body.append(el('div', { class: 'sus-grid' }, viewport, el('aside', { class: 'sus-side' }, setupCard, cornerCard, traceCard)));

    try {
      view = createCarView(viewport, { accent: liveryColor(ctx.backend.account.equippedLivery), autoRotate: ctx.kiosk });
    } catch (err) {
      viewport.append(el('div', { class: 'app-error' }, '3D view unavailable (WebGL is required).'));
      view = { update() {}, setPreset() {}, setAccent() {}, dispose() {} };
    }
    const offLivery = ctx.bus.on('livery', (hex) => view.setAccent(hex));

    let frameNo = 0;
    function update(f) {
      frameNo++;
      view.update(f);
      for (const [c] of CORNERS) {
        const mm = f.susp[c];
        corners[c].val.textContent = mm.toFixed(1);
        const pct = Math.max(0, Math.min(100, ((mm + 50) / 120) * 100));
        corners[c].mark.style.left = `${pct}%`;
        // Fill from the centre zero line to the current travel.
        const zero = 41.7;
        corners[c].fill.style.left = `${Math.min(pct, zero)}%`;
        corners[c].fill.style.width = `${Math.abs(pct - zero)}%`;
        corners[c].fill.classList.toggle('reb', mm < 0);
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
