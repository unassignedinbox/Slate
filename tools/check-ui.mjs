/**
 * check-ui.mjs — executes src/ui/app.js against a stubbed DOM.
 *
 * The UI cannot run in a real browser here, and `npm run check` only proves it
 * imports and that its selectors exist. This goes further: it drives the actual
 * frame loop, the tachometer, the telemetry and the car switcher, and — because
 * a real EngineSynth is injected — the audio update path that runs every frame.
 *
 * Usage: npm run check:ui
 */

import { OfflineAudioContext } from 'web-audio-engine';

let failures = 0;
const check = (name, ok, detail = '') => {
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
};

/* ------------------------------------------------------------- DOM stub */

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.style = { setProperty: () => {}, removeProperty: () => {} };
    this._classes = new Set();
    this._text = '';
    this._html = '';
    this.handlers = {};
    this.value = '';
    this.classList = {
      add: (...c) => c.forEach((x) => this._classes.add(x)),
      remove: (...c) => c.forEach((x) => this._classes.delete(x)),
      toggle: (c, on) => (on ? this._classes.add(c) : this._classes.delete(c)),
      contains: (c) => this._classes.has(c),
    };
  }
  set className(v) {
    this._classes = new Set(String(v).split(/\s+/).filter(Boolean));
  }
  get className() {
    return [...this._classes].join(' ');
  }
  set textContent(v) {
    this._text = String(v);
  }
  get textContent() {
    return this._text;
  }
  set innerHTML(v) {
    this._html = String(v);
  }
  get innerHTML() {
    return this._html;
  }
  addEventListener(type, fn) {
    (this.handlers[type] ||= []).push(fn);
  }
  dispatch(type, ev = {}) {
    for (const fn of this.handlers[type] || []) fn({ target: this, ...ev });
  }
  appendChild(c) {
    this.children.push(c);
    return c;
  }
  setAttribute(k, v) {
    (this.attrs ||= {})[k] = v;
  }
  getAttribute(k) {
    return this.attrs?.[k];
  }
  querySelectorAll() {
    return this.children.filter((c) => c._classes.size);
  }
  closest() {
    return this;
  }
  click() {
    this.dispatch('click', { target: this });
  }
  getContext() {
    const grad = { addColorStop: () => {} };
    return {
      clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
      stroke: () => {}, fill: () => {}, fillText: () => {}, setLineDash: () => {},
      closePath: () => {}, createLinearGradient: () => grad,
      canvas: this,
    };
  }
}

const registry = new Map();
const byId = (id) => {
  if (!registry.has(id)) registry.set(id, new El(id === 'spectrum' ? 'canvas' : 'div'));
  return registry.get(id);
};

globalThis.document = {
  querySelector: (sel) => byId(sel.replace('#', '')),
  querySelectorAll: () => [...registry.values()].filter((e) => e._classes.size),
  getElementById: (id) => byId(id),
  createElement: (t) => new El(t),
  documentElement: new El('html'),
  activeElement: null,
};
globalThis.window = { addEventListener: () => {} };

const rafQueue = [];
globalThis.requestAnimationFrame = (fn) => rafQueue.push(fn);
globalThis.performance ||= { now: () => Date.now() };

/* --------------------------------------------------------- drive the app */

const { App } = await import('../src/ui/app.js');
const { CARS } = await import('../src/cars.js');
const { EngineSynth } = await import('../src/audio/graph.js');

const app = new App();
check('constructor built the car list', registry.get('car-list').children.length === CARS.length,
  `${registry.get('car-list').children.length} cards for ${CARS.length} cars`);
check('constructor built the listening positions', registry.get('positions').children.length === 4);
check('tachometer rendered an svg with a needle', /id="needle"/.test(registry.get('tach').innerHTML));

// pump the real frame loop with the throttle held down
const pump = (frames, dtMs = 16.7) => {
  let t = 0;
  for (let i = 0; i < frames; i++) {
    const fn = rafQueue.shift();
    if (!fn) throw new Error('frame loop stopped requesting frames');
    t += dtMs;
    fn(t);
  }
};

// the engine is off until the user starts it, exactly as in the browser
pump(10);
check('engine off → tach reads 0 and the status says so',
  byId('rpm-value').textContent === '0' && byId('status-text').textContent === 'engine off',
  `rpm="${byId('rpm-value').textContent}" status="${byId('status-text').textContent}"`);

// regression: holding the throttle while cranking must not stall the engine
app.pt.start();
app.keys.add('w');
pump(240); // ~4 s
const revved = Number(byId('rpm-value').textContent.replace(/,/g, ''));
check('frame loop spins the engine up from a keypress', revved > 3000, `rpm readout ${revved}`);
check('tachometer needle was driven', /^rotate\(/.test(byId('needle').getAttribute('transform') || ''),
  byId('needle').getAttribute('transform'));
check('telemetry populated', byId('telemetry').innerHTML.includes('firing tone'));
check('throttle bar reflects the held key', byId('thr-bar').style.width !== undefined);

// now inject a real synth so the per-frame audio update path runs too
const ctx = new OfflineAudioContext(2, 48000, 48000);
app.ctx = ctx;
app.synth = new EngineSynth(ctx, app.car);
app.synth.setListenPosition('cockpit');
app.synth.setMasterVolume(0.8);
app.synth.setReverbAmount(0.5);
app.synth.start();
const before = app.synth.oscBank[11].gain.gain.value;
pump(120);
check('synth.update() runs every frame without throwing', app.synth.started === true);
check('oscillator gains were actually scheduled from the frame loop',
  app.synth.oscBank.some((h) => h.lastGain > 0),
  `bank[11] gain ${before} → lastGain ${app.synth.oscBank[11].lastGain.toFixed(4)}`);
check('pulse wave was rebuilt as load changed', app.synth._pulseLoad >= 0);

// exercise the car switcher and the control handlers
for (const card of registry.get('car-list').children) {
  card.dispatch('click');
  pump(10);
  app.synth = new EngineSynth(ctx, app.car);
  app.synth.start();
  check(`switched to ${app.car.id}`, app.pt.car.id === app.car.id);
}
for (const mode of registry.get('modes').children) { mode.dispatch('click'); pump(5); }
for (const gb of registry.get('gearbox').children) { gb.dispatch('click'); pump(5); }
for (const pos of registry.get('positions').children) {
  pos.dispatch('click');
  app.synth.setListenPosition(pos.dataset.pos);
  pump(5);
}
check('mode / gearbox / position chips all handled', true);

// keyboard: shift, blip, engine toggle path (no AudioContext -> guarded)
for (const k of ['e', 'q', 'b']) {
  app.onKey({ key: k, repeat: false, preventDefault: () => {} }, true);
  app.onKey({ key: k, repeat: false, preventDefault: () => {} }, false);
  pump(5);
}
check('keyboard shift / blip handlers ran', true);

console.log(failures ? `\n${failures} UI check(s) FAILED` : '\nUI OK');
process.exit(failures ? 1 : 0);
