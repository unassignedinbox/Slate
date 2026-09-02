import test from 'node:test';
import assert from 'node:assert/strict';
import {
  engineLoad,
  pulseResponse,
  resonanceResponse,
  harmonicTargets,
  inductionParams,
  turboParams,
  electricParams,
  crackleParams,
  computeTone,
} from '../src/model/tone.js';
import { CARS, getCar } from '../src/cars.js';
import { firingFrequency } from '../src/model/firing.js';

const state = (rpm, throttle, extra = {}) => ({
  rpm,
  throttle,
  boost: 0,
  speed: 0,
  assist: 0,
  running: true,
  ...extra,
});

test('load rises with throttle and with engine speed', () => {
  const car = getCar('laferrari');
  const lo = engineLoad(state(2000, 0.5), car);
  const hi = engineLoad(state(8000, 0.5), car);
  assert.ok(hi > lo, 'same throttle at higher rpm should mean more load');
  assert.ok(engineLoad(state(5000, 1), car) > engineLoad(state(5000, 0.2), car));
  assert.ok(engineLoad(state(5000, 0), car) < 1e-6, 'closed throttle is no load');
});

test('turbo load depends on boost', () => {
  const car = getCar('gtr-nismo');
  const flat = engineLoad(state(4000, 1, { boost: 0 }), car);
  const spooled = engineLoad(state(4000, 1, { boost: car.engine.maxBoost }), car);
  assert.ok(spooled > flat * 1.2, 'a spooled turbo should raise the load');
});

test('pulse spectrum is low-pass and opens up with load', () => {
  assert.ok(pulseResponse(100, 300, 1.7) > pulseResponse(1000, 300, 1.7));
  assert.ok(pulseResponse(2000, 1500, 1.5) > pulseResponse(2000, 300, 1.5));
});

test('exhaust resonances peak at their own frequency', () => {
  const r = [{ f: 900, q: 3, gain: 2 }];
  const at = resonanceResponse(900, r);
  assert.ok(Math.abs(at - 2) < 1e-9);
  assert.ok(resonanceResponse(300, r) < at);
  assert.ok(resonanceResponse(2700, r) < at);
});

test('the strongest oscillator is the firing tone of that engine', () => {
  const cases = [
    ['gtr-nismo', 4000, 3],
    ['p918', 6000, 4],
    ['laferrari', 8000, 6],
    ['spyder-718', 5000, 3],
  ];
  for (const [id, rpm, order] of cases) {
    const car = getCar(id);
    const h = harmonicTargets(car, state(rpm, 1));
    const top = h.reduce((a, b) => (b.gain > a.gain ? b : a));
    const expected = (order * rpm) / 60;
    assert.ok(
      Math.abs(top.freq - expected) / expected < 0.01,
      `${id} @ ${rpm}: strongest partial ${top.freq.toFixed(1)} Hz, expected ${expected} Hz`
    );
    // ...and it sits inside 1% of the analytic firing frequency
    assert.ok(Math.abs(top.freq - firingFrequency(rpm, car.engine.cylinders)) < 1e-6);
  }
});

test('part throttle is rounder than full throttle (less high-frequency energy)', () => {
  const car = getCar('laferrari');
  const hf = (throttle) =>
    harmonicTargets(car, state(7000, throttle))
      .filter((h) => h.freq > 2000)
      .reduce((a, h) => a + h.gain, 0);
  assert.ok(hf(1) > hf(0.15) * 1.5, 'opening the throttle must add top end');
});

test('the bank stays finite, positive and roughly level-matched', () => {
  for (const car of CARS) {
    for (const rpm of [900, 2500, 5000, car.engine.redline]) {
      for (const throttle of [0, 0.3, 1]) {
        const h = harmonicTargets(car, state(rpm, throttle));
        assert.ok(h.length > 4, `${car.id} @ ${rpm}: only ${h.length} harmonics`);
        let sum = 0;
        for (const x of h) {
          assert.ok(Number.isFinite(x.gain) && x.gain >= 0, `${car.id}: bad gain ${x.gain}`);
          assert.ok(Number.isFinite(x.freq) && x.freq > 0);
          sum += x.gain;
        }
        assert.ok(sum < 200, `${car.id} @ ${rpm}: bank level ${sum} is out of control`);
      }
    }
  }
});

test('induction noise follows throttle, not just rpm', () => {
  const car = getCar('p918');
  assert.ok(inductionParams(car, state(7000, 1)).gain > inductionParams(car, state(7000, 0.1)).gain);
  assert.ok(inductionParams(car, state(8000, 1)).freq > inductionParams(car, state(2000, 1)).freq);
});

test('only the turbo car gets a turbo, only the hybrids get e-machines', () => {
  assert.ok(turboParams(getCar('gtr-nismo'), state(4000, 1, { boost: 0.8 })));
  for (const id of ['p918', 'laferrari', 'spyder-718']) {
    assert.equal(turboParams(getCar(id), state(4000, 1)), null, `${id} should have no turbo`);
  }
  for (const id of ['p918', 'laferrari']) {
    assert.ok(electricParams(getCar(id), state(4000, 1, { speed: 30, assist: 1 })), id);
  }
  assert.equal(electricParams(getCar('gtr-nismo'), state(4000, 1)), null);
});

test('turbo whine rises with boost and mass flow', () => {
  const car = getCar('gtr-nismo');
  const low = turboParams(car, state(2500, 0.5, { boost: 0.2 }));
  const high = turboParams(car, state(6000, 1, { boost: 1.05 }));
  assert.ok(high.freq > low.freq, 'turbine should speed up');
  assert.ok(high.gain > low.gain, 'more boost should be louder');
  assert.ok(low.freq >= car.tone.turbo.minHz * 0.99);
});

test('overrun crackles only happen off-throttle above the threshold', () => {
  const car = getCar('gtr-nismo');
  assert.equal(crackleParams(car, state(5000, 0.8)).rate, 0);
  assert.equal(crackleParams(car, state(1200, 0)).rate, 0);
  assert.ok(crackleParams(car, state(5000, 0)).rate > 5);
});

test('computeTone returns a complete, finite parameter set for every car', () => {
  for (const car of CARS) {
    for (const s of [state(1000, 0), state(4500, 0.6, { boost: 0.7, speed: 25, assist: 0.8 }), state(car.engine.redline, 1, { boost: 1.1, speed: 70, assist: 1 })]) {
      const t = computeTone(car, s);
      for (const key of ['harmonics', 'induction', 'mechanical', 'topEnd', 'crackle', 'saturation', 'road']) {
        assert.ok(t[key], `${car.id}: missing ${key}`);
      }
      assert.ok(Number.isFinite(t.load) && t.load >= 0 && t.load <= 1.0001);
      assert.ok(t.saturation.drive > 0.5);
    }
  }
});
