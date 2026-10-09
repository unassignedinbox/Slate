// Digital cockpit: the F1-style dash. Speed, gear, shift lights, pedals, G-meter, lap timing,
// and a live minimap. Everything is a pure function of the telemetry frame.
import { el, fmt } from '../ui.js';
import { TRACK, trackAt } from '../track.js';

const LEDS = 15;

export default {
  id: 'cockpit', name: 'Cockpit', icon: 'cockpit', color: '#2ee6c5',
  open(body) {
    const leds = Array.from({ length: LEDS }, () => el('i'));
    const thr = el('i'), brk = el('i');
    const gear = el('b', { class: 'ck-gear' }, '1');
    const speed = el('b', {}, '0');
    const rpmTxt = el('span', {}, '0 rpm');
    const rpmBar = el('i');
    const lapNo = el('b', {}, '1'), lapCur = el('b', {}, '0:00.000'), lapLast = el('b', {}, '--'), lapBest = el('b', {}, '--');
    const gCanvas = el('canvas', { class: 'gmeter', width: 220, height: 220 });
    const gLat = el('b', {}, '0.0 g'), gLong = el('b', {}, '0.0 g');
    const mini = el('canvas', { class: 'minimap' });
    const tyreTiles = ['fl', 'fr', 'rl', 'rr'].map((c) => {
      const t = el('div', { class: 'ck-tile' }, el('span', {}, c.toUpperCase()), el('b', {}, '--'), el('small', {}, '--'));
      return { c, node: t, b: t.querySelector('b'), s: t.querySelector('small') };
    });
    const aeroTxt = el('b', {}, '--');
    const alertsEl = el('div', { class: 'ck-alerts' });

    body.append(
      el('div', { class: 'cockpit' },
        el('section', { class: 'ck-col ck-left' },
          el('div', { class: 'pedal' }, el('span', {}, 'THR'), el('div', { class: 'vbar' }, thr)),
          el('div', { class: 'pedal brake' }, el('span', {}, 'BRK'), el('div', { class: 'vbar' }, brk)),
        ),
        el('section', { class: 'ck-col ck-center' },
          el('div', { class: 'ck-top' }, gear, el('div', { class: 'ck-speed' }, speed, el('span', {}, 'km/h'))),
          el('div', { class: 'leds' }, ...leds),
          el('div', { class: 'rpm' }, el('div', { class: 'rpm-bar' }, rpmBar), rpmTxt),
          el('div', { class: 'ck-g' }, gCanvas, el('div', { class: 'ck-g-txt' }, el('span', {}, 'LAT '), gLat, el('span', {}, 'LONG '), gLong)),
        ),
        el('section', { class: 'ck-col ck-right' },
          el('div', { class: 'ck-lap' },
            el('div', {}, el('span', {}, 'LAP'), lapNo),
            el('div', {}, el('span', {}, 'CURRENT'), lapCur),
            el('div', {}, el('span', {}, 'LAST'), lapLast),
            el('div', {}, el('span', {}, 'BEST'), lapBest)),
          mini,
          el('div', { class: 'ck-tiles' }, ...tyreTiles.map((t) => t.node)),
          el('div', { class: 'ck-aero' }, el('span', {}, 'DOWNFORCE'), aeroTxt),
          alertsEl,
        ),
      ),
    );

    // Minimap: track outline cached as a Path2D, rescaled on resize.
    const mctx = mini.getContext('2d');
    const gctx = gCanvas.getContext('2d');
    let path = null, bounds = null;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function fitCanvas(cv, w, h) {
      cv.width = w * dpr; cv.height = h * dpr;
      const c = cv.getContext('2d'); c.setTransform(dpr, 0, 0, dpr, 0, 0);
      return c;
    }
    function buildPath() {
      const w = mini.clientWidth || 300, h = mini.clientHeight || 200;
      fitCanvas(mini, w, h);
      const xs = TRACK.points.map((p) => p.x), ys = TRACK.points.map((p) => p.y);
      bounds = { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys), w, h };
      path = new Path2D();
      TRACK.points.forEach((p, i) => {
        const [X, Y] = toMini(p);
        i ? path.lineTo(X, Y) : path.moveTo(X, Y);
      });
      path.closePath();
    }
    function toMini(p) {
      const { x0, x1, y0, y1, w, h } = bounds;
      const s = Math.min((w - 24) / (x1 - x0), (h - 24) / (y1 - y0));
      const ox = (w - (x1 - x0) * s) / 2, oy = (h - (y1 - y0) * s) / 2;
      return [ox + (p.x - x0) * s, h - (oy + (p.y - y0) * s)];
    }
    const ro = new ResizeObserver(buildPath);
    ro.observe(mini);
    buildPath();

    let lastAlertsKey = '';
    function update(f) {
      const pct = (v) => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;
      thr.style.height = pct(f.throttle);
      brk.style.height = pct(f.brake);
      gear.textContent = f.gear;
      speed.textContent = Math.round(f.speedKph);
      const lit = Math.round(Math.max(0, Math.min(1, (f.rpm - 8000) / 3500)) * LEDS);
      leds.forEach((led, i) => {
        led.className = i < lit ? (i < LEDS - 3 ? 'on g' : 'on r') : '';
      });
      rpmBar.style.width = pct(f.rpm / 12000);
      rpmTxt.textContent = `${Math.round(f.rpm)} rpm`;
      lapNo.textContent = f.lap;
      lapCur.textContent = fmt.time(f.lapTimeS);
      lapLast.textContent = fmt.time(f.lastLapS);
      lapBest.textContent = fmt.time(f.bestLapS);
      aeroTxt.textContent = `${fmt.kn(f.aero.downforceN)} kN`;
      tyreTiles.forEach(({ c, node, b, s }) => {
        const t = f.tyres[c];
        b.textContent = `${Math.round(t.tempC)}°`;
        s.textContent = `${t.pressureBar.toFixed(2)} bar`;
        node.style.setProperty('--t', t.tempC > 110 ? '#ef4444' : t.tempC > 95 ? '#f59e0b' : '#22c55e');
      });
      const key = f.alerts.map((a) => a.text).join('|');
      if (key !== lastAlertsKey) {
        lastAlertsKey = key;
        alertsEl.replaceChildren(...f.alerts.map((a) => el('div', { class: `ck-alert ${a.level}` }, a.text)));
      }

      // G-meter
      const W = gCanvas.width, H = gCanvas.height, R = W / 2 - 14;
      gctx.clearRect(0, 0, W, H);
      gctx.strokeStyle = 'rgba(46,230,197,0.35)'; gctx.lineWidth = 1.5;
      [1, 2, 3].forEach((r) => { gctx.beginPath(); gctx.arc(W / 2, H / 2, (R * r) / 3, 0, Math.PI * 2); gctx.stroke(); });
      gctx.beginPath(); gctx.moveTo(W / 2, 8); gctx.lineTo(W / 2, H - 8); gctx.moveTo(8, H / 2); gctx.lineTo(W - 8, H / 2); gctx.stroke();
      const gx = W / 2 + (f.latG / 3) * R, gy = H / 2 - (f.longG / 3) * R;
      gctx.fillStyle = '#2ee6c5';
      gctx.beginPath(); gctx.arc(gx, gy, 9, 0, Math.PI * 2); gctx.fill();
      gLat.textContent = `${f.latG.toFixed(1)} g`;
      gLong.textContent = `${f.longG.toFixed(1)} g`;

      // Minimap car position
      const { w, h } = bounds;
      mctx.clearRect(0, 0, w, h);
      mctx.lineWidth = 10; mctx.strokeStyle = 'rgba(255,255,255,0.08)'; mctx.stroke(path);
      mctx.lineWidth = 2.5; mctx.strokeStyle = 'rgba(46,230,197,0.9)'; mctx.stroke(path);
      const pos = trackAt(TRACK, f.distanceM);
      const [cx, cy] = toMini(pos);
      mctx.fillStyle = '#ffffff'; mctx.beginPath(); mctx.arc(cx, cy, 6, 0, Math.PI * 2); mctx.fill();
      mctx.fillStyle = 'rgba(46,230,197,0.25)'; mctx.beginPath(); mctx.arc(cx, cy, 14, 0, Math.PI * 2); mctx.fill();
    }

    return { update, destroy() { ro.disconnect(); } };
  },
};
