import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evenFiringPhases,
  firingSpectrum,
  dominantOrder,
  firingFrequency,
  harmonicFrequency,
} from '../src/model/firing.js';
import { CARS } from '../src/cars.js';

test('even-firing phases span the 720° four-stroke cycle', () => {
  assert.deepEqual(evenFiringPhases(8), [0, 90, 180, 270, 360, 450, 540, 630]);
  assert.equal(evenFiringPhases(6).length, 6);
  assert.equal(evenFiringPhases(12)[11], 660);
});

test('even-firing V8 puts all its energy in the 8th harmonic of the cycle (= 4th crank order)', () => {
  const dom = dominantOrder(evenFiringPhases(8));
  assert.equal(dom.k, 8);
  assert.ok(dom.mag > 0.99, `magnitude ${dom.mag} should be ~1`);
  const spec = firingSpectrum(evenFiringPhases(8), null, 16);
  assert.ok(spec[3].mag < 1e-9, 'no 4th-harmonic (2nd crank order) content for an even-firing V8');
});

test('V6 → 3rd crank order, V12 → 6th crank order', () => {
  assert.equal(dominantOrder(evenFiringPhases(6)).k, 6);
  assert.equal(dominantOrder(evenFiringPhases(12)).k, 12);
});

test('firing frequency = rpm/60 × cylinders/2', () => {
  assert.ok(Math.abs(firingFrequency(4000, 8) - 800 / 3) < 1e-9);
  assert.equal(firingFrequency(6000, 6), 300);
  assert.equal(harmonicFrequency(12, 8000), 800);
});

test('unequal exhaust runners leak lower orders back in (engine lope)', () => {
  const even = dominantOrder(evenFiringPhases(8));
  const uneven = dominantOrder([0, 90, 180, 270, 360, 450, 540, 630], [1, 1, 1, 1, 0.55, 1, 1, 1]);
  assert.ok(uneven.purity < even.purity, 'uneven runners reduce the purity of the firing tone');
  const spec = firingSpectrum([0, 90, 180, 270, 360, 450, 540, 630], [1, 1, 1, 1, 0.55, 1, 1, 1], 16);
  assert.ok(spec[3].mag > 1e-6, 'a 4th harmonic appears once runners are unequal');
});

test('every car in the catalogue has an even-firing pattern matching its cylinder count', () => {
  for (const car of CARS) {
    const e = car.engine;
    const dom = dominantOrder(e.firingPhases, e.cylinderWeights);
    assert.equal(dom.k, e.cylinders, `${car.id}: dominant harmonic should equal cylinder count`);
    assert.equal(e.firingPhases.length, e.cylinders);
    assert.equal(e.firingOrder.length, e.cylinders);
    assert.ok(dom.purity > 0.85, `${car.id}: purity ${dom.purity} too low for an even-firing engine`);
  }
});

test('published peak power/torque figures are internally consistent', () => {
  for (const car of CARS) {
    const e = car.engine;
    const implied = (e.peakPower * 7127) / e.peakPowerRpm; // Nm at peak power
    assert.ok(implied <= e.peakTorque * 1.02, `${car.id}: peak power implies more torque than the peak figure`);
    assert.ok(e.redline > e.peakPowerRpm, `${car.id}: redline must sit above peak power`);
    assert.ok(e.fuelCut >= e.redline, `${car.id}: fuel cut must not be below redline`);
  }
});
