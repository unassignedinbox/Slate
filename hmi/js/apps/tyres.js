// Tyres: per-corner tread temperature across the contact patch (inner, centre, outer), pressure
// against the working window, wear, the compound choice (which changes the model), and a trace.
import { el, tempHex } from '../ui.js';
import { LineChart } from '../kit.js';
import { CORNERS } from '../vehicle.js';

const NAMES = { fl: 'Front left', fr: 'Front right', rl: 'Rear left', rr: 'Rear right' };
const COMPOUNDS = [
  ['soft', 'Soft', 'Most grip, shortest life. Best for slow corners.'],
  ['medium', 'Medium', 'Balanced grip and life. Default race compound.'],
  ['hard', 'Hard', 'Longest life, least grip. For long stints and wet setups.'],
];
const P_LO = 2.0, P_HI = 2.25;   // working pressure window (bar)

// Tread SVG: three zones across the contact patch, coloured by temperature.
function tread(zones) {
  const [a, b, c] = zones.map(tempHex);
  return `<svg viewBox="0 0 80 150" class="tread" aria-hidden="true">
    <defs><linearGradient id="sh" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity=".35"/><stop offset=".5" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient></defs>
    <rect x="6" y="6" width="68" height="138" rx="26" class="tyre-body"/>
    <rect x="14" y="14" width="18" height="122" rx="9" fill="${a}"/>
    <rect x="31" y="14" width="18" height="122" fill="${b}"/>
    <rect x="48" y="14" width="18" height="122" rx="9" fill="${c}"/>
    <rect x="6" y="6" width="68" height="138" rx="26" fill="url(#sh)"/>
    <g class="tread-lines"><path d="M31 16V136M49 16V136"/></g>
  </svg>`;
}

export default {
  id: 'tyres', name: 'Tyres', icon: 'tyre', color: '#22c55e',
  open(body, ctx) {
    const accent = '#22c55e';
    const cards = {};
    const grid = el('div', { class: 'ty-grid' }, CORNERS.map((c) => {
      const svg = el('div', { class: 'ty-svg' });
      const temp = el('b', { class: 'ty-temp' }, '--');
      const badge = el('span', { class: 'k-badge' }, '—');
      const pBar = el('i');
      const pVal = el('span', {}, '—');
      const wBar = el('i');
      const wVal = el('span', {}, '—');
      const card = el('section', { class: 'k-card ty-card' },
        el('header', {}, el('span', {}, NAMES[c]), badge),
        el('div', { class: 'ty-body' }, svg,
          el('div', { class: 'ty-nums' }, el('span', { class: 'k-cap' }, 'CORE TEMP'), temp,
            el('div', { class: 'ty-row' }, el('span', {}, 'Pressure'), pVal),
            el('div', { class: 'k-bar pwin' }, pBar),
            el('div', { class: 'ty-row' }, el('span', {}, 'Wear'), wVal),
            el('div', { class: 'k-bar wear' }, wBar))));
      cards[c] = { svg, temp, badge, pBar, pVal, wBar, wVal };
      return card;
    }));

    // Compound selector (applies to the simulation).
    const desc = el('p', { class: 'ty-desc' }, '');
    const compBtns = COMPOUNDS.map(([k, label]) => el('button', {
      class: 'ty-comp', 'data-k': k,
      onclick: () => { ctx.sim.set({ compound: k }); select(k); ctx.toast(`${label} compound fitted`, 'info'); },
    }, el('span', { class: `ty-dot ${k}` }), el('b', {}, label)));
    let shownComp = null;
    function select(k) {
      if (k === shownComp) return;
      shownComp = k;
      compBtns.forEach((b) => b.classList.toggle('on', b.dataset.k === k));
      desc.textContent = COMPOUNDS.find(([x]) => x === k)[2];
    }
    const compCard = el('section', { class: 'k-card ty-comp-card' },
      el('div', { class: 'k-cap' }, 'COMPOUND'), el('div', { class: 'ty-comps' }, compBtns), desc);
    select(ctx.sim.settings.compound);

    const traceCanvas = el('canvas', { class: 'k-chart ty-trace' });
    const traceCard = el('section', { class: 'k-card ty-trace-card' },
      el('div', { class: 'k-cap' }, 'CORE TEMPERATURE · LAST 60 S'), traceCanvas,
      el('div', { class: 'sus-legend' }, [['FL', '#2ee6c5'], ['FR', '#38bdf8'], ['RL', '#f59e0b'], ['RR', '#f472b6']].map(([n, col]) => el('span', {}, el('i', { style: { background: col } }), n))));
    const trace = new LineChart(traceCanvas, { min: 60, max: 130, xLabels: [], yFormat: (v) => `${Math.round(v)}°`, series: [] });
    const hist = { fl: [], fr: [], rl: [], rr: [] };

    const adviceEl = el('p', { class: 'ty-advice' }, '');
    body.append(el('div', { class: 'ty-layout' }, grid, el('aside', { class: 'ty-side' }, compCard, traceCard, el('section', { class: 'k-card' }, el('div', { class: 'k-cap' }, 'ADVICE'), adviceEl))));

    let frameNo = 0;
    function update(f) {
      frameNo++;
      let worst = null;
      for (const c of CORNERS) {
        const t = f.tyres[c];
        const side = c[1] === 'l' ? 1 : -1;               // left corners are 'l'
        // Load moves to the outside tyre in a corner: that shoulder runs hotter.
        const shift = Math.max(-1, Math.min(1, f.latG / 2.6)) * 6;
        const outerShift = side * shift;
        const zones = [t.tempC - 3 + outerShift * 0.5, t.tempC, t.tempC + 3 - outerShift * 0.5];
        const card = cards[c];
        card.svg.innerHTML = tread(zones);
        card.temp.textContent = `${Math.round(t.tempC)}°`;
        const state = t.tempC < 80 ? ['cold', 'Cold'] : t.tempC <= 105 ? ['ok', 'In window'] : t.tempC <= 120 ? ['hot', 'Hot'] : ['over', 'Overheating'];
        card.badge.className = `k-badge ${state[0]}`;
        card.badge.textContent = state[1];
        const pf = Math.max(0, Math.min(1, (t.pressureBar - 1.8) / 0.8));
        card.pBar.style.width = `${(pf * 100).toFixed(1)}%`;
        card.pVal.textContent = `${t.pressureBar.toFixed(2)} bar`;
        card.pBar.style.background = t.pressureBar >= P_LO && t.pressureBar <= P_HI ? accent : '#f59e0b';
        card.wBar.style.width = `${Math.min(100, t.wearPct).toFixed(1)}%`;
        card.wVal.textContent = `${t.wearPct.toFixed(2)} %`;
        hist[c].push(t.tempC); if (hist[c].length > 240) hist[c].shift();
        if (!worst || t.tempC > worst.t) worst = { c, t: t.tempC };
      }
      if (frameNo % 6 === 0) {
        trace.set([
          { values: hist.fl.slice(), color: '#2ee6c5', width: 2 },
          { values: hist.fr.slice(), color: '#38bdf8', width: 2 },
          { values: hist.rl.slice(), color: '#f59e0b', width: 2 },
          { values: hist.rr.slice(), color: '#f472b6', width: 2 },
        ], { min: 60, max: Math.max(120, worst.t + 5) });
      }
      const msg = worst.t > 115
        ? `${NAMES[worst.c]} is overheating (${Math.round(worst.t)}°C). Lift and lower the speed through the corner.`
        : worst.t < 80
          ? 'Tyres are cold. Expect reduced grip until they reach 85°C.'
          : 'All four tyres are in their working window.';
      if (adviceEl.textContent !== msg) adviceEl.textContent = msg;
      select(f.settings.compound);   // follows the model (e.g. a setup pack changing the compound)
    }

    return {
      update,
      destroy() { trace.dispose(); },
    };
  },
};
