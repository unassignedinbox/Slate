// Aero: 3D car with airflow, front and rear flap controls, live downforce, drag, balance and
// a downforce / drag curve over speed for the current flap settings.
import { el, slider } from '../ui.js';
import { createCarView } from '../car3d.js';
import { liveryColor } from '../backend.js';
import { LineChart } from '../kit.js';

const RHO = 1.225, AREA = 1.6;
// Same coefficient model as the vehicle simulation (kept in sync with vehicle.js).
const coeffs = (S) => ({
  Cl: (0.9 + 1.9 * S.wingRear) + (0.5 + 1.1 * S.wingFront),
  Cd: 0.32 + 0.35 * S.wingRear + 0.2 * S.wingFront,
});

export default {
  id: 'aero', name: 'Aero', icon: 'aero', color: '#a78bfa',
  open(body, ctx) {
    const accent = '#a78bfa';
    const S = ctx.sim.settings;

    const viewport = el('div', { class: 'viewport aero-vp' });
    let view;
    let airflowOn = true;
    const flowChip = el('button', {
      class: 'k-chip on',
      onclick: () => { airflowOn = !airflowOn; flowChip.classList.toggle('on', airflowOn); view.setAirflow?.(airflowOn); },
    }, 'Airflow');
    viewport.append(el('div', { class: 'vp-bar' }, flowChip), el('div', { class: 'vp-tag' }, 'AIRFLOW · SPEED-DRIVEN'));

    const sFront = slider({ label: 'Front wing flap', min: 0, max: 1, step: 0.01, value: S.wingFront, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ctx.sim.set({ wingFront: v }) });
    const sRear = slider({ label: 'Rear wing flap', min: 0, max: 1, step: 0.01, value: S.wingRear, format: (v) => `${Math.round(v * 100)}%`, onInput: (v) => ctx.sim.set({ wingRear: v }) });
    const flapCard = el('section', { class: 'k-card aero-flaps' }, el('div', { class: 'k-cap' }, 'FLAPS'), sFront.root, sRear.root);

    const df = el('b', {}, '0'), drag = el('b', {}, '0'), ld = el('b', {}, '0.00'), bal = el('b', {}, '50 / 50');
    const balFill = el('i');
    const balBar = el('div', { class: 'aero-bal' }, balFill);
    const readCard = el('section', { class: 'k-card aero-reads' },
      el('div', { class: 'k-cap' }, 'AT SPEED'),
      el('div', { class: 'aero-read-grid' },
        el('div', { class: 'k-read' }, el('span', {}, 'DOWNFORCE'), el('div', {}, df, el('small', {}, ' kN'))),
        el('div', { class: 'k-read' }, el('span', {}, 'DRAG'), el('div', {}, drag, el('small', {}, ' N'))),
        el('div', { class: 'k-read' }, el('span', {}, 'L / D'), ld),
        el('div', { class: 'k-read' }, el('span', {}, 'FRONT / REAR'), bal)),
      el('div', { class: 'aero-bal-wrap' }, el('span', { class: 'k-cap' }, 'AERO BALANCE · FRONT'), balBar));

    const curveCanvas = el('canvas', { class: 'k-chart aero-curve' });
    const curveCard = el('section', { class: 'k-card aero-curvecard' },
      el('div', { class: 'k-cap' }, 'DOWNFORCE & DRAG VS SPEED'), curveCanvas);
    const curve = new LineChart(curveCanvas, {
      min: 0, max: 25, xLabels: ['60', '120', '180', '240', '300'],
      yFormat: (v) => `${Math.round(v)}`,
      series: [],
    });

    body.append(el('div', { class: 'aero-grid' }, viewport, el('aside', { class: 'aero-side' }, flapCard, readCard, curveCard)));

    try {
      view = createCarView(viewport, { accent: liveryColor(ctx.backend.account.equippedLivery), airflow: true, autoRotate: ctx.kiosk });
    } catch (err) {
      viewport.append(el('div', { class: 'app-error' }, '3D view unavailable (WebGL is required).'));
      view = { update() {}, setPreset() {}, setAccent() {}, setAirflow() {}, dispose() {} };
    }
    const offLivery = ctx.bus.on('livery', (hex) => view.setAccent(hex));

    let frameNo = 0, lastCurveKey = '';
    function drawCurve(s) {
      const key = `${s.wingFront.toFixed(2)}|${s.wingRear.toFixed(2)}`;
      if (key === lastCurveKey) return;
      lastCurveKey = key;
      const { Cl, Cd } = coeffs(s);
      const speeds = [], dfs = [], drags = [];
      for (let kph = 60; kph <= 300; kph += 6) {
        const v = kph / 3.6;
        const q = 0.5 * RHO * v * v;
        speeds.push(kph);
        dfs.push((q * AREA * Cl) / 1000);
        drags.push((q * AREA * Cd) / 1000);
      }
      curve.set([
        { values: dfs, color: accent, fill: 'rgba(167,139,250,0.18)', width: 2.2 },
        { values: drags, color: '#38bdf8', width: 1.8 },
      ]);
      curve.xLabels = ['60', '120', '180', '240', '300'];
    }

    function update(f) {
      frameNo++;
      view.update(f);
      const a = f.aero;
      df.textContent = (a.downforceN / 1000).toFixed(1);
      drag.textContent = Math.round(a.dragN).toLocaleString('en-ZA');
      ld.textContent = a.lOverD.toFixed(2);
      bal.textContent = `${a.balanceFrontPct.toFixed(0)} / ${(100 - a.balanceFrontPct).toFixed(0)}`;
      balFill.style.width = `${a.balanceFrontPct.toFixed(1)}%`;
      if (frameNo % 6 === 0) drawCurve(f.settings);
      for (const [sl, key] of [[sFront, 'wingFront'], [sRear, 'wingRear']]) {
        if (document.activeElement !== sl.input && Math.abs(parseFloat(sl.input.value) - f.settings[key]) > 1e-3) sl.set(f.settings[key]);
      }
    }

    return {
      update,
      destroy() {
        offLivery();
        curve.dispose();
        view.dispose();
      },
    };
  },
};
