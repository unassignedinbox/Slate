// Tyres: temperature, pressure and wear per corner. Tyre temperature is the same signal the 3D
// car uses for its rim colour, so the views stay consistent. Compound choice is a setup input.
import { el, Trace, tempHex } from '../ui.js';

const NAMES = { fl: 'Front left', fr: 'Front right', rl: 'Rear left', rr: 'Rear right' };
const COMPOUNDS = ['soft', 'medium', 'hard'];

function status(t) {
  if (t < 80) return ['COLD', 'cold'];
  if (t <= 105) return ['OPTIMAL', 'ok'];
  if (t <= 110) return ['HOT', 'hot'];
  return ['OVERHEAT', 'over'];
}

export default {
  id: 'tyres', name: 'Tyres', icon: 'tyre', color: '#22c55e',
  open(body, ctx) {
    const cards = {};
    const grid = el('div', { class: 'tyre-grid' }, ['fl', 'fr', 'rl', 'rr'].map((c) => {
      const rect = el('rect', { x: 14, y: 8, width: 52, height: 84, rx: 12, fill: '#22c55e' });
      const svg = el('svg', { viewBox: '0 0 80 100', class: 'tyre-svg' },
        rect,
        el('rect', { x: 26, y: 20, width: 28, height: 60, rx: 6, fill: 'rgba(0,0,0,0.35)' }),
        el('line', { x1: 14, y1: 28, x2: 66, y2: 28, stroke: 'rgba(255,255,255,0.15)' }),
        el('line', { x1: 14, y1: 50, x2: 66, y2: 50, stroke: 'rgba(255,255,255,0.15)' }),
        el('line', { x1: 14, y1: 72, x2: 66, y2: 72, stroke: 'rgba(255,255,255,0.15)' }));
      const temp = el('b', { class: 'tyre-temp' }, '--');
      const pres = el('span', {}, '--');
      const wear = el('i');
      const badge = el('em', { class: 'badge' }, '--');
      cards[c] = { rect, temp, pres, wear, badge };
      return el('section', { class: 'tcard' },
        el('header', {}, el('span', {}, NAMES[c]), badge),
        el('div', { class: 'tcard-body' }, svg, el('div', { class: 'tcard-nums' }, temp, el('small', {}, 'tyre temperature'))),
        el('div', { class: 'tcard-row' }, el('span', {}, 'Pressure'), pres),
        el('div', { class: 'tcard-row' }, el('span', {}, 'Wear'), el('div', { class: 'bar' }, wear)));
    }));

    const S = ctx.sim.settings;
    const compoundBtns = COMPOUNDS.map((k) => el('button', {
      class: `seg ${S.compound === k ? 'on' : ''}`,
      onclick: () => { ctx.sim.set({ compound: k }); syncCompound(k); },
    }, k[0].toUpperCase() + k.slice(1)));
    const syncCompound = (k) => compoundBtns.forEach((b, i) => b.classList.toggle('on', COMPOUNDS[i] === k));

    const traceCanvas = el('canvas', { class: 'trace' });
    const trace = new Trace(traceCanvas, {
      min: 60, max: 125, samples: 240,
      series: [
        { label: 'FL', color: '#2ee6c5' }, { label: 'FR', color: '#38bdf8' },
        { label: 'RL', color: '#f59e0b' }, { label: 'RR', color: '#f472b6' },
      ],
    });
    const advice = el('p', { class: 'advice' }, '');
    const panel = el('aside', { class: 'panel' },
      el('h3', {}, 'Compound'),
      el('div', { class: 'seg-row' }, compoundBtns),
      el('p', { class: 'footnote' }, 'Soft: grip now, faster wear. Hard: durable, needs heat.'),
      el('h3', {}, 'Temperature · last 8 s'),
      traceCanvas,
      advice,
    );
    body.append(el('div', { class: 'split' }, grid, panel));

    let n = 0;
    function update(f) {
      for (const c of ['fl', 'fr', 'rl', 'rr']) {
        const t = f.tyres[c];
        const cd = cards[c];
        cd.rect.setAttribute('fill', tempHex(t.tempC));
        cd.temp.textContent = `${Math.round(t.tempC)}°C`;
        cd.pres.textContent = `${t.pressureBar.toFixed(2)} bar`;
        cd.wear.style.width = `${Math.min(100, t.wearPct * 10)}%`;
        const [label, cls] = status(t.tempC);
        cd.badge.textContent = label;
        cd.badge.className = `badge ${cls}`;
      }
      if (++n % 3 === 0) trace.push(['fl', 'fr', 'rl', 'rr'].map((c) => f.tyres[c].tempC));
      const hot = Object.entries(f.tyres).filter(([, t]) => t.tempC > 110).map(([c]) => c.toUpperCase());
      advice.textContent = hot.length
        ? `Overheating: ${hot.join(', ')}. Lift off or reduce lateral load to bring temperatures down.`
        : `Most worn tyre: ${Math.max(...Object.values(f.tyres).map((t) => t.wearPct)).toFixed(2)}% wear this stint.`;
    }

    return {
      update,
      destroy() { trace.dispose(); },
    };
  },
};
