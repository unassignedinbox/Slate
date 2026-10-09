import { svgIcon } from '../ui/icons.js';
import { h, segmented, statTile, meter, svg } from '../ui/widgets.js';
import { state, set } from '../core/store.js';
import { WeatherViewport } from '../render3d/scenes.js';

export default {
  id: 'weather',
  name: 'Weather',
  icon: svgIcon('weather'),
  color: '#4DA3FF',
  group: 'vehicle',
  create() {
    let vp = null;
    const host = h('div', { class: 'vp-host' }, h('div', { class: 'vp-label', text: 'TRACK WEATHER · LIVE' }));

    const air = statTile('Air', '°C');
    const track = statTile('Track', '°C');
    const hum = statTile('Humidity', '%');
    const wind = statTile('Wind', 'km/h');
    const arrow = svg('svg', { viewBox: '0 0 24 24', class: 'wind-arrow' }, svg('path', { d: 'M12 2 L19 21 L12 17 L5 21 Z' }));
    const rain = meter('Rain intensity', { color: '#4da3ff' });
    const mode = segmented(
      [{ value: 'auto', label: 'Auto' }, { value: 'dry', label: 'Dry' }, { value: 'rain', label: 'Rain' }],
      state.settings.weatherOverride,
      (v) => set('settings.weatherOverride', v),
    );

    const el = h('div', { class: 'split' },
      h('div', { class: 'split-left' }, host),
      h('div', { class: 'split-right' },
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Conditions' }),
          h('div', { class: 'side-tiles' }, air.el, track.el, hum.el, wind.el)),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Wind direction' }),
          h('div', { class: 'wind-row' }, arrow, h('span', { class: 'val', text: '' }))),
        h('div', { class: 'card' },
          h('div', { class: 'card-title', text: 'Rain' }),
          rain.el,
          mode.el)));

    const windVal = el.querySelector('.wind-row .val');

    return {
      el,
      mount() { vp ??= new WeatherViewport(host); },
      unmount() { vp?.dispose(); vp = null; },
      update(s) {
        const w = s.weather;
        air.set(w.airTempC.toFixed(1));
        track.set(w.trackTempC.toFixed(1));
        hum.set(Math.round(w.humidityPct));
        wind.set(w.windKmh.toFixed(0));
        arrow.style.transform = `rotate(${w.windDeg.toFixed(0)}deg)`;
        windVal.textContent = `from ${Math.round(w.windDeg)}°`;
        rain.set(w.rainIntensity, `${Math.round(w.rainIntensity * 100)}%`);
        mode.set(s.settings.weatherOverride);
      },
    };
  },
};
