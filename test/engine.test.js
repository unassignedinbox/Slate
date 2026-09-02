import test from 'node:test';
import assert from 'node:assert/strict';
import { Powertrain, torqueAt } from '../src/model/engine.js';
import { CARS } from '../src/cars.js';

const DT = 1 / 400;
const run = (pt, seconds) => {
  const steps = Math.round(seconds / DT);
  let s = pt.snapshot();
  for (let i = 0; i < steps; i++) s = pt.update(DT);
  return s;
};

test('torque curve interpolates linearly and clamps at both ends', () => {
  const curve = [[1000, 100], [2000, 300], [3000, 200]];
  assert.equal(torqueAt(curve, 1500), 200);
  assert.equal(torqueAt(curve, 500), 0); // clamped low, never negative
  assert.equal(torqueAt(curve, 9000), 200);
});

test('every car starts, cranks and settles at its idle speed', () => {
  for (const car of CARS) {
    const pt = new Powertrain(car);
    pt.start();
    const cranking = run(pt, 0.3);
    assert.equal(cranking.phase, 'cranking', `${car.id} should still be cranking at 0.3 s`);
    assert.ok(cranking.rpm > 100, `${car.id} starter should be turning the engine`);
    const settled = run(pt, 4);
    assert.equal(settled.phase, 'run');
    assert.ok(
      settled.rpm > car.engine.idle * 0.8 && settled.rpm < car.engine.idle + 700,
      `${car.id} idled at ${settled.rpm.toFixed(0)} rpm, expected near ${car.engine.idle}`
    );
  }
});

test('holding the throttle while cranking still catches and revs', () => {
  // regression: the torque curves used to be undefined below 1000 rpm, so an
  // open throttle at cranking speed produced zero torque and killed the engine
  for (const car of CARS) {
    const pt = new Powertrain(car);
    pt.start();
    pt.setThrottle(1); // driver gives it gas while starting
    const s = run(pt, 4);
    assert.equal(s.phase, 'run', `${car.id} stalled while starting on throttle`);
    assert.ok(s.rpm > 3000, `${car.id} only reached ${s.rpm.toFixed(0)} rpm on full throttle`);
  }
});

test('a stalled engine stops turning', () => {
  const pt = new Powertrain(CARS[2]);
  pt.start();
  run(pt, 2);
  pt.shutdown();
  const s = run(pt, 6);
  assert.equal(s.phase, 'off');
  assert.equal(s.rpm, 0);
});

test('full throttle from idle climbs towards the redline in the dyno', () => {
  for (const car of CARS) {
    const pt = new Powertrain(car);
    pt.start();
    run(pt, 2);
    pt.setThrottle(1);
    const s = run(pt, 6);
    assert.ok(s.rpm > car.engine.redline * 0.75, `${car.id} only reached ${s.rpm.toFixed(0)} rpm`);
    assert.ok(s.rpm <= car.engine.fuelCut + 50, `${car.id} oversped to ${s.rpm.toFixed(0)}`);
  }
});

test('the rev limiter cuts fuelling instead of letting the engine overspeed', () => {
  const pt = new Powertrain(CARS[0]);
  pt.start();
  run(pt, 1.5);
  pt.setThrottle(1);
  const s = run(pt, 12);
  assert.ok(s.rpm <= CARS[0].engine.fuelCut + 60, `rpm ${s.rpm}`);
  assert.ok(s.torque < 200, 'torque should be cut near the limiter');
});

test('revs fall back when the throttle is lifted, at a rate the model limits', () => {
  const pt = new Powertrain(CARS[1]);
  pt.start();
  run(pt, 1.5);
  pt.setThrottle(1);
  run(pt, 3);
  const hot = pt.rpm;
  pt.setThrottle(0);
  const after = run(pt, 0.5);
  const drop = (hot - after.rpm) / 0.5;
  assert.ok(after.rpm < hot, 'engine should decelerate');
  assert.ok(drop > 800, `drop of ${drop.toFixed(0)} rpm/s is too lazy`);
  assert.ok(drop < 12000, `drop of ${drop.toFixed(0)} rpm/s is unrealistically fast`);
});

test('turbo lag: boost builds over ~1 s, not instantly', () => {
  const pt = new Powertrain(CARS[0]);
  pt.start();
  run(pt, 1.5);
  pt.setThrottle(1);
  run(pt, 0.8); // spool up in rpm first
  const early = run(pt, 0.15).boost;
  const late = run(pt, 3).boost;
  assert.ok(early < CARS[0].engine.maxBoost * 0.75, `boost built too fast: ${early.toFixed(2)} bar`);
  assert.ok(late > CARS[0].engine.maxBoost * 0.9, `boost never arrived: ${late.toFixed(2)} bar`);
  // and it decays when the throttle is lifted
  pt.setThrottle(0);
  assert.ok(run(pt, 2).boost < CARS[0].engine.maxBoost * 0.2);
});

test('naturally aspirated cars make no boost at all', () => {
  for (const car of CARS.filter((c) => c.engine.aspiration === 'na')) {
    const pt = new Powertrain(car);
    pt.start();
    run(pt, 1.5);
    pt.setThrottle(1);
    assert.equal(run(pt, 2).boost, 0, car.id);
  }
});

test('in road mode the car accelerates, shifts up and reaches a plausible top speed', () => {
  const pt = new Powertrain(CARS[2]); // LaFerrari
  pt.setMode('road');
  pt.start();
  run(pt, 2);
  pt.setThrottle(1);
  run(pt, 12);
  const mid = pt.snapshot();
  assert.ok(mid.gear > 2, `should have shifted up, still in gear ${mid.gear}`);
  assert.ok(mid.speedKph > 150, `only reached ${mid.speedKph.toFixed(0)} km/h`);
  const top = run(pt, 25);
  assert.ok(top.speedKph > 280, `top speed ${top.speedKph.toFixed(0)} km/h is too low`);
  assert.ok(top.speedKph < CARS[2].topSpeedKph + 25, `exceeded the stated top speed: ${top.speedKph}`);
});

test('the gearbox never leaves its ratio set and downshifts on demand', () => {
  const pt = new Powertrain(CARS[0]);
  pt.setMode('road');
  pt.auto = false;
  pt.start();
  run(pt, 2);
  pt.setThrottle(1);
  run(pt, 4);
  assert.ok(pt.shiftUp());
  const up = run(pt, 1);
  assert.equal(up.gear, 2);
  assert.ok(pt.shiftDown());
  const down = run(pt, 1);
  assert.equal(down.gear, 1);
  assert.equal(pt.shiftDown(), false, 'cannot go below first gear');
});

test('braking brings the car to a stop', () => {
  const pt = new Powertrain(CARS[0]);
  pt.setMode('road');
  pt.start();
  run(pt, 2);
  pt.setThrottle(1);
  run(pt, 8);
  assert.ok(pt.speed > 10);
  pt.setThrottle(0);
  pt.setBrake(1);
  const s = run(pt, 8);
  assert.ok(s.speed < 1, `still doing ${s.speed.toFixed(2)} m/s after 8 s of braking`);
});

test('hybrid ERS drains under full assist and recovers on the overrun', () => {
  const pt = new Powertrain(CARS[1]);
  pt.setMode('road');
  pt.start();
  run(pt, 2);
  pt.setThrottle(1);
  run(pt, 6);
  const drained = pt.soc;
  assert.ok(drained < 1, `battery never discharged: ${drained}`);
  assert.ok(pt.assist > 0, 'no motor assist while on throttle');
  pt.setThrottle(0);
  pt.setBrake(1);
  run(pt, 4);
  assert.ok(pt.soc > drained, 'regen should have added charge back');
});

test('non-hybrid cars report no assist', () => {
  const pt = new Powertrain(CARS[0]);
  pt.start();
  run(pt, 2);
  pt.setThrottle(1);
  assert.equal(run(pt, 2).assist, 0);
});
