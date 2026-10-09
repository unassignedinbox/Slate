// Weather & track conditions. The model is a deterministic simulated feed; in production it is
// fed by the environment service (or the car's own sensors via the C++ backend).
import { el } from '../ui.js';
import { icon } from '../icons.js';

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

const stat = (label, value) => el('div', { class: 'stat' }, el('span', { class: 'stat-l' }, label), el('strong', {}, value));

export default {
  id: 'weather', name: 'Weather', icon: 'weather', color: '#38bdf8',
  open(body, ctx) {
    const hero = el('section', { class: 'card wx-hero' });
    const icoBox = el('div', { class: 'wx-ico' });
    const tempEl = el('div', { class: 'wx-temp' }, '--');
    const condEl = el('div', { class: 'wx-cond' }, '');
    const feelsEl = el('div', { class: 'muted' }, '');
    const statsEl = el('div', { class: 'stats' });
    const compass = el('div', { class: 'compass' });
    compass.innerHTML = `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" class="cmp-ring"/><text x="50" y="16" text-anchor="middle">N</text><text x="50" y="92" text-anchor="middle">S</text><text x="90" y="54" text-anchor="middle">E</text><text x="10" y="54" text-anchor="middle">W</text><g id="needle"><path d="M50 14 L58 50 L50 86 L42 50 Z"/></g></svg>`;
    const needle = compass.querySelector('#needle');
    const windTxt = el('strong', {}, '--');
    hero.append(el('div', { class: 'wx-top' }, icoBox, el('div', {}, tempEl, condEl, feelsEl)), statsEl, el('div', { class: 'wx-wind' }, compass, el('div', {}, el('div', { class: 'stat-l' }, 'Wind'), windTxt)));

    const track = el('section', { class: 'card' });
    const trackStats = el('div', { class: 'track-stats' });
    const rainBar = el('div', { class: 'bar' }, el('i', { style: { width: '0%' } }));
    const gripBar = el('div', { class: 'bar grip' }, el('i', { style: { width: '0%' } }));
    const advice = el('p', { class: 'advice' }, '');
    track.append(el('h3', {}, 'Track conditions'), trackStats,
      el('div', { class: 'bar-row' }, el('span', {}, 'Rain probability'), rainBar),
      el('div', { class: 'bar-row' }, el('span', {}, 'Grip index'), gripBar), advice);

    const forecast = el('section', { class: 'card forecast' }, el('h3', {}, 'Next 8 hours'));
    const hoursRow = el('div', { class: 'hours' });
    forecast.append(hoursRow);

    body.append(
      el('div', { class: 'wx-grid' }, hero, track),
      forecast,
      el('p', { class: 'footnote' }, 'Simulated environment feed · production source: backend environment service'),
    );

    const rowHtml = (w, hour) => {
      const h = el('div', { class: 'hour' }, el('span', {}, hour), el('span', { class: 'hour-ico' }), el('strong', {}, `${Math.round(w.airC)}°`), el('small', {}, `${Math.round(w.rainPct)}% rain`));
      h.querySelector('.hour-ico').innerHTML = icon(w.icon, 26);
      return h;
    };

    function render(ms) {
      const w = getWeather(ms);
      icoBox.innerHTML = icon(w.icon, 56);
      tempEl.textContent = `${Math.round(w.airC)}°C`;
      condEl.textContent = w.label;
      feelsEl.textContent = `Feels like ${Math.round(w.feelsC)}°C`;
      statsEl.replaceChildren(stat('Humidity', `${Math.round(w.humidity)}%`), stat('Pressure', `${Math.round(w.pressure)} hPa`), stat('Wind', `${Math.round(w.windKph)} km/h`));
      needle.setAttribute('transform', `rotate(${w.windDir} 50 50)`);
      windTxt.textContent = `${Math.round(w.windKph)} km/h · from ${Math.round(w.windDir)}°`;
      trackStats.replaceChildren(stat('Air', `${Math.round(w.airC)}°C`), stat('Track', `${Math.round(w.trackC)}°C`), stat('Humidity', `${Math.round(w.humidity)}%`));
      rainBar.firstChild.style.width = `${w.rainPct}%`;
      gripBar.firstChild.style.width = `${w.grip}%`;
      advice.textContent = w.rainPct > 55
        ? 'Wet running expected: consider the Wet Weather setup pack (Store).'
        : w.rainPct > 28 ? 'Changing conditions: keep tyre temps under watch.' : 'Dry track: standard setup recommended.';
      hoursRow.replaceChildren(...[1, 2, 3, 4, 5, 6, 7, 8].map((hh) => {
        const f = getWeather(ms, hh * 3600);
        return rowHtml(f, `${new Date(ms + hh * 3600e3).getHours()}:00`);
      }));
    }

    const timer = setInterval(() => render(Date.now()), 1000);
    render(Date.now());
    return { destroy() { clearInterval(timer); } };
  },
};
