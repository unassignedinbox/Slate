// Weather & track conditions. The model is a deterministic simulated feed; in production it is
// fed by the environment service (or the car's own sensors via the C++ backend).
import { el } from '../ui.js';
import { icon } from '../icons.js';
import { LineChart } from '../kit.js';

const wave = (t, period) => Math.sin(t / period);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function getWeather(ms, offsetSec = 0) {
  const t = ms / 1000 + offsetSec;
  const airC = 21 + 3.5 * wave(t, 900) + 0.6 * wave(t, 77);
  const humidity = clamp(58 + 14 * wave(t, 1200), 30, 95);
  const rainPct = clamp(12 + 80 * Math.max(0, wave(t, 2400) - 0.2), 0, 100);
  const windKph = 14 + 7 * wave(t, 300) + 3 * wave(t, 47);
  const windDir = (215 + 35 * wave(t, 1500) + 360) % 360;
  const pressure = 1013 + 5 * wave(t, 3000);
  const trackC = airC + 14 + 3 * wave(t, 600) - rainPct * 0.12;
  const grip = clamp(100 - rainPct * 0.6, 40, 100);
  const feelsC = airC - windKph * 0.08 + (humidity > 70 ? 1.5 : 0);
  const c = rainPct > 55 ? { label: 'Rain', icon: 'rain' } : rainPct > 28 ? { label: 'Cloudy', icon: 'cloud' } : { label: 'Clear', icon: 'sun' };
  return { airC, feelsC, humidity, rainPct, windKph, windDir, pressure, trackC, grip, label: c.label, icon: c.icon };
}

const SKY = {
  Clear: ['#0e3b52', '#0a1a26', '#f7c96b'],
  Cloudy: ['#24313d', '#0d141b', '#9fb3c4'],
  Rain: ['#1a2633', '#070c12', '#5b7388'],
};

const stat = (label, value) => el('div', { class: 'stat' }, el('span', { class: 'stat-l' }, label), el('strong', {}, value));

export default {
  id: 'weather', name: 'Weather', icon: 'weather', color: '#38bdf8',
  open(body, ctx) {
    const accent = '#38bdf8';

    // ---- hero with an animated sky behind the numbers
    const sky = el('canvas', { class: 'wx-sky' });
    const icoBox = el('div', { class: 'wx-ico' });
    const tempEl = el('div', { class: 'wx-temp' }, '--');
    const condEl = el('div', { class: 'wx-cond' }, '');
    const feelsEl = el('div', { class: 'muted' }, '');
    const statsEl = el('div', { class: 'stats' });
    const hero = el('section', { class: 'k-card wx-hero' },
      sky,
      el('div', { class: 'wx-top' }, icoBox, el('div', {}, tempEl, condEl, feelsEl)),
      statsEl);

    // ---- wind compass
    const compass = el('div', { class: 'compass' });
    compass.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" class="cmp-ring"/><text x="50" y="16" text-anchor="middle">N</text><text x="50" y="92" text-anchor="middle">S</text><text x="90" y="54" text-anchor="middle">E</text><text x="10" y="54" text-anchor="middle">W</text><g id="needle"><path d="M50 14 L58 50 L50 86 L42 50 Z"/></g></svg>`;
    const needle = compass.querySelector('#needle');
    const windTxt = el('strong', {}, '--');
    const windCard = el('section', { class: 'k-card wx-wind-card' }, el('div', { class: 'k-cap' }, 'WIND'),
      el('div', { class: 'wx-wind' }, compass, el('div', {}, windTxt, el('div', { class: 'muted' }, 'Gusts shown as a 7 km/h band'))));

    // ---- track conditions
    const trackStats = el('div', { class: 'track-stats' });
    const rainBar = el('div', { class: 'k-bar' }, el('i', { style: { width: '0%' } }));
    const gripBar = el('div', { class: 'k-bar grip' }, el('i', { style: { width: '0%' } }));
    const advice = el('p', { class: 'advice' }, '');
    const trackCard = el('section', { class: 'k-card wx-track' },
      el('div', { class: 'k-cap' }, 'TRACK CONDITIONS'), trackStats,
      el('div', { class: 'bar-row' }, el('span', {}, 'Rain probability'), rainBar),
      el('div', { class: 'bar-row' }, el('span', {}, 'Grip index'), gripBar), advice);

    // ---- radar (drifting rain cells, wind-driven)
    const radarCanvas = el('canvas', { class: 'wx-radar' });
    const radarCard = el('section', { class: 'k-card wx-radarcard' }, el('div', { class: 'k-cap' }, 'RAIN RADAR · 30 MIN'), radarCanvas);
    const cells = Array.from({ length: 22 }, (_, i) => ({ x: Math.random(), y: Math.random(), r: 0.05 + Math.random() * 0.09, s: 0.6 + Math.random() * 0.8, seed: i }));

    // ---- 8-hour forecast chart + hours row
    const chartCanvas = el('canvas', { class: 'k-chart wx-chart' });
    const hoursRow = el('div', { class: 'hours' });
    const forecast = el('section', { class: 'k-card wx-forecast' },
      el('div', { class: 'k-cap' }, 'NEXT 8 HOURS · AIR TEMP & RAIN'), chartCanvas, hoursRow);
    const chart = new LineChart(chartCanvas, { min: 10, max: 32, xLabels: [], yFormat: (v) => `${Math.round(v)}°` , series: [] });

    body.append(
      el('div', { class: 'wx-grid' }, hero, el('div', { class: 'wx-col' }, windCard, trackCard)),
      el('div', { class: 'wx-bottom' }, forecast, radarCard),
      el('p', { class: 'footnote' }, 'Simulated environment feed · production source: backend environment service'),
    );

    const skyCtx = sky.getContext('2d');
    const rCtx = radarCanvas.getContext('2d');
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);

    function drawSky(w, label, rainPct, t) {
      const [top, bottom, glow] = SKY[label] ?? SKY.Clear;
      const d = dpr();
      const W = sky.clientWidth, H = sky.clientHeight;
      if (!W) return;
      if (sky.width !== Math.floor(W * d)) { sky.width = Math.floor(W * d); sky.height = Math.floor(H * d); }
      skyCtx.setTransform(d, 0, 0, d, 0, 0);
      const g = skyCtx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, top); g.addColorStop(1, bottom);
      skyCtx.fillStyle = g; skyCtx.fillRect(0, 0, W, H);
      // Sun or moon glow
      const sx = W * 0.82, sy = H * 0.28;
      const sg = skyCtx.createRadialGradient(sx, sy, 0, sx, sy, 180);
      sg.addColorStop(0, label === 'Clear' ? glow : 'rgba(0,0,0,0)');
      sg.addColorStop(1, 'rgba(0,0,0,0)');
      skyCtx.globalAlpha = label === 'Clear' ? 0.55 : 0.08;
      skyCtx.fillStyle = sg; skyCtx.fillRect(0, 0, W, H);
      // Clouds (slow drift)
      skyCtx.globalAlpha = label === 'Clear' ? 0.12 : 0.28;
      for (let i = 0; i < 6; i++) {
        const cx = ((i * 233 + t * 9) % (W + 240)) - 120, cy = 30 + ((i * 71) % 90);
        const cg = skyCtx.createRadialGradient(cx, cy, 4, cx, cy, 90 + (i % 3) * 22);
        cg.addColorStop(0, '#ffffff'); cg.addColorStop(1, 'rgba(255,255,255,0)');
        skyCtx.fillStyle = cg; skyCtx.fillRect(cx - 130, cy - 110, 260, 220);
      }
      // Rain streaks scale with probability
      const n = Math.round(rainPct * 1.6);
      skyCtx.globalAlpha = 0.5; skyCtx.strokeStyle = '#a5d8ff'; skyCtx.lineWidth = 1;
      skyCtx.beginPath();
      for (let i = 0; i < n; i++) {
        const x = (i * 97.3 + t * 260) % W;
        const y = (i * 53.7 + t * 520) % H;
        skyCtx.moveTo(x, y); skyCtx.lineTo(x - 5, y + 13);
      }
      skyCtx.stroke();
      skyCtx.globalAlpha = 1;
    }

    function drawRadar(w, t, windDir, rainPct) {
      const d = dpr();
      const W = radarCanvas.clientWidth, H = radarCanvas.clientHeight;
      if (!W) return;
      if (radarCanvas.width !== Math.floor(W * d)) { radarCanvas.width = Math.floor(W * d); radarCanvas.height = Math.floor(H * d); }
      const c = rCtx;
      c.setTransform(d, 0, 0, d, 0, 0);
      c.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 4;
      c.fillStyle = '#060b10'; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(56,189,248,0.18)';
      [0.33, 0.66, 1].forEach((k) => { c.beginPath(); c.arc(cx, cy, R * k, 0, Math.PI * 2); c.stroke(); });
      const rad = (windDir * Math.PI) / 180;
      const vx = Math.sin(rad), vy = -Math.cos(rad);
      const intensity = rainPct / 100;
      for (const cell of cells) {
        const px = ((cell.x + vx * t * 0.01 * cell.s + 1) % 1);
        const py = ((cell.y + vy * t * 0.01 * cell.s + 1) % 1);
        const x = cx + (px - 0.5) * 2 * R, y = cy + (py - 0.5) * 2 * R;
        if (Math.hypot(x - cx, y - cy) > R) continue;
        const rr = R * cell.r * (0.6 + intensity);
        const g = c.createRadialGradient(x, y, 0, x, y, rr);
        const a = 0.15 + intensity * 0.6;
        g.addColorStop(0, `rgba(96,165,250,${a})`); g.addColorStop(0.6, `rgba(59,130,246,${a * 0.5})`); g.addColorStop(1, 'rgba(59,130,246,0)');
        c.fillStyle = g; c.beginPath(); c.arc(x, y, rr, 0, Math.PI * 2); c.fill();
      }
      c.fillStyle = accent; c.beginPath(); c.arc(cx, cy, 4, 0, Math.PI * 2); c.fill();
    }

    let lastSlow = 0, frameNo = 0;
    function update(f) {
      frameNo++;
      const now = performance.now();
      const w = getWeather(Date.now());
      drawSky(0, w.label, w.rainPct, now / 1000);
      if (now - lastSlow < 250) return;
      lastSlow = now;
      icoBox.innerHTML = icon(w.icon, 56);
      tempEl.textContent = `${Math.round(w.airC)}°C`;
      condEl.textContent = w.label;
      feelsEl.textContent = `Feels like ${Math.round(w.feelsC)}°C`;
      statsEl.replaceChildren(stat('Humidity', `${Math.round(w.humidity)}%`), stat('Pressure', `${Math.round(w.pressure)} hPa`), stat('Wind', `${Math.round(w.windKph)} km/h`), stat('Rain', `${Math.round(w.rainPct)}%`));
      needle.setAttribute('transform', `rotate(${w.windDir} 50 50)`);
      windTxt.textContent = `${Math.round(w.windKph)} km/h · from ${Math.round(w.windDir)}°`;
      trackStats.replaceChildren(stat('Air', `${Math.round(w.airC)}°C`), stat('Track', `${Math.round(w.trackC)}°C`), stat('Humidity', `${Math.round(w.humidity)}%`));
      rainBar.firstChild.style.width = `${w.rainPct}%`;
      gripBar.firstChild.style.width = `${w.grip}%`;
      advice.textContent = w.rainPct > 55
        ? 'Wet running expected: consider the Wet Weather setup pack (Store).'
        : w.rainPct > 28 ? 'Changing conditions: keep tyre temps under watch.' : 'Dry track: standard setup recommended.';
      drawRadar(0, now / 1000, w.windDir, w.rainPct);

      // Forecast: one point per hour, from the same model.
      const hours = Array.from({ length: 8 }, (_, i) => getWeather(Date.now(), i * 3600));
      chart.xLabels = hours.map((_, i) => (i === 0 ? 'Now' : `+${i}h`));
      chart.set([
        { values: hours.map((h) => h.airC), color: accent, fill: 'rgba(56,189,248,0.2)', width: 2.4, dot: true },
        { values: hours.map((h) => h.trackC), color: '#f59e0b', width: 1.6 },
      ], { min: 10, max: 36 });
      const hourNow = new Date();
      hoursRow.replaceChildren(...hours.map((h, i) => {
        const hr = new Date(hourNow.getTime() + i * 3600e3).getHours();
        const node = el('div', { class: 'hour' }, el('span', {}, i === 0 ? 'Now' : `${String(hr).padStart(2, '0')}:00`),
          el('span', { class: 'hour-ico' }), el('strong', {}, `${Math.round(h.airC)}°`), el('small', {}, `${Math.round(h.rainPct)}% rain`));
        node.querySelector('.hour-ico').innerHTML = icon(h.icon, 26);
        return node;
      }));
    }

    return {
      update,
      destroy() { chart.dispose(); },
    };
  },
};
