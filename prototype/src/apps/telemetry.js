import { svgIcon } from '../ui/icons.js';
import { h, setText, svg, sparkline, meter } from '../ui/widgets.js';
import { state } from '../core/store.js';

// Track outline: a closed loop. Lap progress 0..1 maps to angle 0..2π.
const radius = (t) => 1 + 0.18 * Math.sin(3 * t) + 0.08 * Math.cos(5 * t);
const pt = (t) => [50 + 42 * radius(t) * Math.cos(t), 50 + 32 * radius(t) * Math.sin(t)];
const TRACK_D = (() => {
  let d = '';
  for (let i = 0; i <= 120; i++) {
    const [x, y] = pt((i / 120) * 2 * Math.PI);
    d += (i ? 'L' : 'M') + x.toFixed(2) + ' ' + y.toFixed(2);
  }
  return d + 'Z';
})();

export default {
  id: 'telemetry',
  name: 'Telemetry',
  icon: svgIcon('telemetry'),
  color: '#E10600',
  group: 'vehicle',
  create() {
    const dot = svg('circle', { r: 2.6, class: 'track-dot' });
    const map = svg('svg', { viewBox: '0 0 100 100', class: 'trackmap' },
      svg('path', { d: TRACK_D, class: 'track-line' }), dot);

    const steer = svg('svg', { viewBox: '0 0 100 100', class: 'steer' },
      svg('circle', { cx: 50, cy: 50, r: 42, class: 'steer-ring' }),
      svg('line', { x1: 50, y1: 8, x2: 50, y2: 40, class: 'steer-mark' }));
    const steerVal = h('span', { class: 'val' }, '0.0°');

    const throttle = meter('Throttle', { color: 'var(--ok)' });
    const brake = meter('Brake', { color: 'var(--crit)' });
    const speedSpark = sparkline({ w: 900, h: 110, min: 0, max: 360, points: 240 });

    const statVal = { lap: h('span', { class: 'val' }), pos: h('span', { class: 'val' }), drs: h('span', { class: 'val' }), rpm: h('span', { class: 'val' }) };
    const stat = (label, el) => h('div', { class: 'stat' }, h('span', { class: 'stat-label', text: label }), el);

    const el = h('div', { class: 'app-grid telemetry' },
      h('div', { class: 'card map-card' }, h('div', { class: 'card-title', text: 'Circuit · live position' }), map),
      h('div', { class: 'card' },
        h('div', { class: 'card-title', text: 'Driver input' }),
        throttle.el, brake.el,
        h('div', { class: 'steer-row' }, steer, h('div', { class: 'stat-col' }, h('span', { class: 'stat-label', text: 'Steering' }), steerVal))),
      h('div', { class: 'card wide' },
        h('div', { class: 'card-title', text: 'Speed · recent history (km/h)' }),
        speedSpark.el,
        h('div', { class: 'stat-strip' },
          stat('Lap', statVal.lap), stat('Position', statVal.pos), stat('DRS', statVal.drs), stat('RPM', statVal.rpm))));

    let n = 0;
    return {
      el,
      update(s) {
        const v = s.vehicle;
        const [x, y] = pt(v.lapProgress * 2 * Math.PI);
        dot.setAttribute('cx', x.toFixed(2));
        dot.setAttribute('cy', y.toFixed(2));
        steer.style.transform = `rotate(${(v.steerDeg * 2).toFixed(1)}deg)`;
        setText(steerVal, `${v.steerDeg.toFixed(1)}°`);
        throttle.set(v.throttle);
        brake.set(v.brake);
        if (++n % 6 === 0) speedSpark.push(v.speedKmh);
        setText(statVal.lap, `${v.lap} / ${v.lapsTotal}`);
        setText(statVal.pos, `P${v.position}`);
        setText(statVal.drs, v.drs.toUpperCase());
        setText(statVal.rpm, v.rpm.toLocaleString('en-US'));
      },
    };
  },
};

