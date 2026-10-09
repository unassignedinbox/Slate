// Cockpit: the driver's main view. Speed arc, gear and shift lights, pedals, G-meter, lap timing,
// a speed and brake trace, the live track map and the car's alerts. Every number is derived from the
// telemetry frame (the same struct the C++ backend publishes).
import { el, fmt } from '../ui.js';
import { arcGauge, LineChart } from '../kit.js';
import { createTrackMap } from '../minimap.js';
import { TRACK, trackAt } from '../track.js';

const LEDS = 15;
const RPM_MIN = 3000, RPM_MAX = 11300;
const G_RANGE = 3;               // G-meter radius = 3 g
const TRAIL = 45;

export default {
  id: 'cockpit', name: 'Cockpit', icon: 'cockpit', color: '#2ee6c5',
  open(body, ctx) {
    const accent = '#2ee6c5';

    // ---- left: speed arc, gear, shift lights
    const gauge = arcGauge({ min: 0, max: 300, major: 50, minor: 10, unit: 'km/h', color: accent, size: 330, label: 'SPEED' });
    const gear = el('div', { class: 'cp-gear' }, el('span', { class: 'k-cap' }, 'GEAR'), el('b', {}, '1'));
    const leds = Array.from({ length: LEDS }, () => el('i'));
    const rpmText = el('span', { class: 'cp-rpm-txt' }, '0 rpm');
    const left = el('section', { class: 'cp-left' },
      el('div', { class: 'cp-gauge-wrap' }, gauge.root),
      el('div', { class: 'cp-row' }, gear, el('div', { class: 'cp-rpm' },
        el('div', { class: 'cp-leds' }, leds), rpmText)));

    // ---- right: lap, pedals, G, trace, map, alerts
    const lapNow = el('b', { class: 'cp-lap-now' }, '0:00.000');
    const lapLast = el('b', {}, '--:--.---');
    const lapBest = el('b', {}, '--:--.---');
    const lapDelta = el('b', { class: 'cp-delta' }, '—');
    const sectors = [0, 1, 2].map(() => el('i'));
    const lapCard = el('section', { class: 'k-card cp-lap' },
      el('div', { class: 'k-cap' }, 'LAP'), el('div', { class: 'cp-lap-main' }, el('span', {}, 'Lap ', el('b', { class: 'cp-lapno' }, '1')), lapNow),
      el('div', { class: 'cp-lap-grid' },
        el('div', {}, el('span', { class: 'k-cap' }, 'LAST'), lapLast),
        el('div', {}, el('span', { class: 'k-cap' }, 'BEST'), lapBest),
        el('div', {}, el('span', { class: 'k-cap' }, 'LAST vs BEST'), lapDelta)),
      el('div', { class: 'cp-sectors' }, sectors.map((s, i) => el('div', { class: 'cp-sec' }, el('span', {}, `S${i + 1}`), el('div', { class: 'k-bar' }, s)))));

    const thr = el('i'), brk = el('i');
    const thrTxt = el('span', {}, '0%'), brkTxt = el('span', {}, '0%');
    const pedals = el('section', { class: 'k-card cp-pedals' },
      el('div', { class: 'k-cap' }, 'PEDALS'),
      el('div', { class: 'cp-ped-row' },
        el('div', { class: 'cp-ped' }, el('div', { class: 'cp-ped-bar thr' }, thr), el('span', {}, 'Throttle'), thrTxt),
        el('div', { class: 'cp-ped' }, el('div', { class: 'cp-ped-bar brk' }, brk), el('span', {}, 'Brake'), brkTxt)));

    const gCanvas = el('canvas', { class: 'cp-g' });
    const gText = el('span', { class: 'cp-g-txt' }, '0.0 g');
    const gCard = el('section', { class: 'k-card cp-gcard' }, el('div', { class: 'k-cap' }, 'G-FORCE'), gCanvas, gText);

    const traceCanvas = el('canvas', { class: 'k-chart cp-trace' });
    const traceCard = el('section', { class: 'k-card cp-tracecard' },
      el('div', { class: 'k-cap' }, 'SPEED · BRAKE · LAST 30 S'), traceCanvas);

    const mapCanvas = el('canvas', { class: 'cp-map' });
    const mapCard = el('section', { class: 'k-card cp-mapcard' }, el('div', { class: 'k-cap' }, 'TRACK'), mapCanvas);

    const alertList = el('div', { class: 'cp-alerts' });
    const alertCard = el('section', { class: 'k-card cp-alertcard' }, el('div', { class: 'k-cap' }, 'CAR STATUS'), alertList);

    const right = el('section', { class: 'cp-right' },
      el('div', { class: 'cp-r-top' }, lapCard, pedals, gCard),
      el('div', { class: 'cp-r-mid' }, traceCard),
      el('div', { class: 'cp-r-bot' }, mapCard, alertCard));

    body.append(el('div', { class: 'cp-grid' }, left, right));

    const map = createTrackMap(mapCanvas);
    const trace = new LineChart(traceCanvas, {
      min: 0, max: 300, xLabels: [],
      series: [{ values: [], color: accent, fill: 'rgba(46,230,197,0.18)', width: 2.2 }, { values: [], color: '#ef4444', width: 1.6 }],
    });
    const gCtx = gCanvas.getContext('2d');
    const trail = [];
    const speeds = [], brakes = [];
    let frameNo = 0, lastAlertKey = '';
    let lastSector = -1;

    function drawG(f) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = gCanvas.clientWidth, h = gCanvas.clientHeight;
      if (!w) return;
      if (gCanvas.width !== Math.floor(w * dpr)) { gCanvas.width = Math.floor(w * dpr); gCanvas.height = Math.floor(h * dpr); }
      const c = gCtx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 8;
      const g = c.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, 'rgba(46,230,197,0.12)'); g.addColorStop(1, 'rgba(0,0,0,0.0)');
      c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 1;
      [1, 2, 3].forEach((r) => { c.beginPath(); c.arc(cx, cy, (R * r) / G_RANGE, 0, Math.PI * 2); c.stroke(); });
      c.beginPath(); c.moveTo(cx - R, cy); c.lineTo(cx + R, cy); c.moveTo(cx, cy - R); c.lineTo(cx, cy + R); c.stroke();
      const px = (gv) => cx + (Math.max(-G_RANGE, Math.min(G_RANGE, gv)) / G_RANGE) * R;
      const py = (gv) => cy - (Math.max(-G_RANGE, Math.min(G_RANGE, gv)) / G_RANGE) * R;
      trail.push([px(f.latG), py(f.longG)]);
      if (trail.length > TRAIL) trail.shift();
      trail.forEach(([x, y], i) => {
        c.fillStyle = `rgba(46,230,197,${(i / trail.length) * 0.5})`;
        c.beginPath(); c.arc(x, y, 1 + (i / trail.length) * 2.5, 0, Math.PI * 2); c.fill();
      });
      const [x, y] = trail[trail.length - 1];
      c.fillStyle = accent; c.shadowColor = accent; c.shadowBlur = 14;
      c.beginPath(); c.arc(x, y, 6, 0, Math.PI * 2); c.fill();
      c.shadowBlur = 0;
    }

    function update(f) {
      frameNo++;
      gauge.set(f.speedKph, Math.round(f.speedKph).toString());
      gear.querySelector('b').textContent = String(f.gear);

      // Shift lights: green to amber to red as rpm climbs.
      const lit = Math.max(0, Math.min(LEDS, Math.round(((f.rpm - RPM_MIN) / (RPM_MAX - RPM_MIN)) * LEDS)));
      for (let i = 0; i < LEDS; i++) {
        const on = i < lit;
        const zone = i >= 12 ? 'red' : i >= 9 ? 'amber' : 'green';
        leds[i].className = on ? `on ${zone}` : '';
      }
      rpmText.textContent = `${Math.round(f.rpm).toLocaleString('en-ZA')} rpm`;

      thr.style.height = `${(f.throttle * 100).toFixed(0)}%`;
      brk.style.height = `${(f.brake * 100).toFixed(0)}%`;
      thrTxt.textContent = `${Math.round(f.throttle * 100)}%`;
      brkTxt.textContent = `${Math.round(f.brake * 100)}%`;

      gText.textContent = `${Math.hypot(f.latG, f.longG).toFixed(2)} g`;
      drawG(f);

      lapNow.textContent = fmt.time(f.lapTimeS);
      body.querySelector('.cp-lapno').textContent = String(f.lap);
      lapLast.textContent = fmt.time(f.lastLapS);
      lapBest.textContent = fmt.time(f.bestLapS);
      if (f.lastLapS != null && f.bestLapS != null) {
        const d = f.lastLapS - f.bestLapS;
        lapDelta.textContent = `${d >= 0 ? '+' : ''}${d.toFixed(3)} s`;
        lapDelta.classList.toggle('good', d <= 0.0005);
        lapDelta.classList.toggle('bad', d > 0.0005);
      }
      const progress = f.track.progress;
      const sec = Math.min(2, Math.floor(progress * 3));
      sectors.forEach((bar, i) => {
        const p = i < sec ? 1 : i === sec ? progress * 3 - sec : 0;
        bar.style.width = `${Math.min(100, p * 100).toFixed(1)}%`;
        bar.classList.toggle('done', i < sec);
      });
      if (sec !== lastSector) lastSector = sec;

      if (frameNo % 3 === 0) {
        speeds.push(f.speedKph); brakes.push(f.brake * 300);
        if (speeds.length > 90) { speeds.shift(); brakes.shift(); }
        trace.set([{ values: speeds.slice(), color: accent, fill: 'rgba(46,230,197,0.18)', width: 2.2, dot: true },
          { values: brakes.slice(), color: '#ef4444', width: 1.6 }]);
      }
      if (frameNo % 2 === 0) {
        map.draw([{ pos: trackAt(TRACK, f.distanceM), color: accent, r: 7, label: 'YOU' }]);
      }

      const key = (f.alerts || []).map((a) => a.key).join('|');
      if (key !== lastAlertKey) {
        lastAlertKey = key;
        alertList.replaceChildren(...(f.alerts.length
          ? f.alerts.slice(0, 4).map((a) => el('div', { class: `cp-alert ${a.level}` }, el('i'), a.text))
          : [el('div', { class: 'cp-alert ok' }, el('i'), 'All systems nominal')]));
      }
    }

    return {
      update,
      destroy() {
        map.dispose();
        trace.dispose();
      },
    };
  },
};
