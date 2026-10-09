// Aerodynamics: front and rear flap control, live downforce / drag / balance, a downforce-vs-speed
// curve, and airflow particles around the car. Presets set both flaps at once.
import { el, slider } from '../ui.js';
import { createCarView } from '../car3d.js';
import { liveryColor } from '../backend.js';

const PRESETS = {
  Straight: { wingRear: 0.12, wingFront: 0.2 },
  Balanced: { wingRear: 0.45, wingFront: 0.5 },
  Corner: { wingRear: 0.9, wingFront: 0.8 },
};

export default {
  id: 'aero', name: 'Aero', icon: 'aero', color: '#a78bfa',
  open(body, ctx) {
    const viewport = el('div', { class: 'viewport' });
    const airBtn = el('button', { class: 'chip on', onclick: () => {
      const on = !airBtn.classList.contains('on');
      airBtn.classList.toggle('on', on);
      view.setAirflow(on);
    } }, 'Airflow');
    viewport.append(el('div', { class: 'vp-bar' },
      ...Object.keys(PRESETS).map((name) => el('button', { class: 'chip', onclick: () => apply(PRESETS[name]) }, name)),
      airBtn));

    const S = ctx.sim.settings;
    const sFront = slider({ label: 'Front wing flap', min: 0, max: 1, step: 0.01, value: S.wingFront, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ctx.sim.set({ wingFront: v }) });
    const sRear = slider({ label: 'Rear wing flap', min: 0, max: 1, step: 0.01, value: S.wingRear, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ctx.sim.set({ wingRear: v }) });
    const apply = (p) => { ctx.sim.set(p); sFront.set(p.wingFront); sRear.set(p.wingRear); };

    const readout = (label) => {
      const v = el('b', {}, '--');
      return { node: el('div', { class: 'read' }, el('span', {}, label), v), v };
    };
    const df = readout('Downforce'), drag = readout('Drag'), ld = readout('L / D'), bal = readout('Front balance');

    const curve = el('canvas', { class: 'trace curve' });
    const panel = el('aside', { class: 'panel' },
      el('h3', {}, 'Aero balance'),
      el('div', { class: 'reads' }, df.node, drag.node, ld.node, bal.node),
      el('h3', {}, 'Flaps'),
      sFront.root, sRear.root,
      el('h3', {}, 'Downforce vs speed'),
      curve,
      el('p', { class: 'footnote' }, 'Curve uses current flap settings. Airflow is a visual approximation, not CFD.'),
    );
    body.append(el('div', { class: 'split' }, viewport, panel));

    let view;
    try {
      view = createCarView(viewport, { accent: liveryColor(ctx.backend.account.equippedLivery), airflow: false });
    } catch (err) {
      viewport.append(el('div', { class: 'app-error' }, '3D view unavailable (WebGL is required).'));
      view = { update() {}, setPreset() {}, setAccent() {}, setAirflow() {}, dispose() {} };
    }
    const offLivery = ctx.bus.on('livery', (hex) => view.setAccent(hex));

    // Downforce curve, redrawn when the flaps move.
    const cctx = curve.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let lastKey = '';
    function drawCurve(f) {
      const w = curve.clientWidth || 300, h = curve.clientHeight || 160;
      if (curve.width !== Math.round(w * dpr)) { curve.width = Math.round(w * dpr); curve.height = Math.round(h * dpr); }
      cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cctx.clearRect(0, 0, w, h);
      const vmax = 340, dfMax = 25000;
      const Cl = (0.9 + 1.9 * f.aero.wingRear) + (0.5 + 1.1 * f.aero.wingFront);
      const pt = (kph) => [(kph / vmax) * w, h - ((0.5 * 1.225 * (kph / 3.6) ** 2 * 1.6 * Cl) / dfMax) * h];
      cctx.strokeStyle = '#a78bfa'; cctx.lineWidth = 2.5; cctx.beginPath();
      for (let k = 0; k <= vmax; k += 5) { const [x, y] = pt(k); k ? cctx.lineTo(x, y) : cctx.moveTo(x, y); }
      cctx.stroke();
      const [px, py] = pt(f.speedKph);
      cctx.fillStyle = '#fff'; cctx.beginPath(); cctx.arc(px, py, 5, 0, Math.PI * 2); cctx.fill();
      cctx.fillStyle = 'rgba(255,255,255,0.5)'; cctx.font = '12px system-ui'; cctx.fillText('0', 4, h - 4); cctx.fillText('340 km/h', w - 64, h - 4);
    }

    function update(f) {
      view.update(f);
      df.v.textContent = `${(f.aero.downforceN / 1000).toFixed(1)} kN`;
      drag.v.textContent = `${(f.aero.dragN / 1000).toFixed(2)} kN`;
      ld.v.textContent = f.aero.lOverD.toFixed(2);
      bal.v.textContent = `${f.aero.balanceFrontPct.toFixed(1)} %`;
      const key = `${f.aero.wingFront.toFixed(2)}|${f.aero.wingRear.toFixed(2)}|${Math.round(f.speedKph)}`;
      if (key !== lastKey) { lastKey = key; drawCurve(f); }
      for (const [key2, s] of [['wingFront', sFront], ['wingRear', sRear]]) {
        if (document.activeElement !== s.input && Math.abs(parseFloat(s.input.value) - f.settings[key2]) > 1e-3) s.set(f.settings[key2]);
      }
    }

    return {
      update,
      destroy() { offLivery(); view.dispose(); },
    };
  },
};
