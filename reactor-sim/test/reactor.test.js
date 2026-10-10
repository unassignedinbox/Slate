// System-level tests: energy conservation, steady operation, sensor noise, protection,
// failure modes, determinism and the coke-can envelope check.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ReactorSimulation, outcomeOf } from '../src/physics/reactor.js';
import { defaultDesign, checkDesign, deriveDesign } from '../src/physics/design.js';
import { CAN_RADIUS_M, CAN_HEIGHT_M } from '../src/physics/constants.js';

const make = (overrides = {}, opts = {}) => {
  const d = defaultDesign();
  Object.assign(d, overrides);
  return new ReactorSimulation(d, { seed: 1, noise: false, warmUpS: 3000, ...opts });
};

// ---------------------------------------------------------------- design envelope
test('default design fits the coke-can envelope (355 ml, 66.1 x 122.2 mm) with no violations', () => {
  const r = checkDesign(defaultDesign());
  assert.equal(r.ok, true, r.violations.join('; '));
  assert.ok(r.derived.usedVolume < r.derived.envelopeVolume);
  assert.ok(CAN_RADIUS_M * 2 * 1000 > 66 && CAN_RADIUS_M * 2 * 1000 < 66.2);
  assert.ok(CAN_HEIGHT_M * 1000 > 122 && CAN_HEIGHT_M * 1000 < 122.3);
});

test('shielding lies inside the can wall (outer shield radius < inner can radius)', () => {
  const g = deriveDesign(defaultDesign());
  assert.ok(g.r4 < g.innerCanRadius);
});

test('design check rejects a 15.5 MPa coolant in the 0.1 mm can (hoop-stress violation)', () => {
  const d = defaultDesign();
  d.coolantPressureMPa = 15.5;
  const r = checkDesign(d);
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.includes('hoop stress')));
});

test('design check rejects an oversized fuel stack', () => {
  const d = defaultDesign();
  d.fuelRadiusM = 0.02; // larger than the can allows
  const r = checkDesign(d);
  assert.equal(r.ok, false);
});

test('rated thermal power = specific power x fuel volume (~5.4 W)', () => {
  const g = deriveDesign(defaultDesign());
  assert.ok(Math.abs(g.ratedPowerW - 0.2 * g.fuelVolume * 1e6) < 1e-9);
  assert.ok(g.ratedPowerW > 5.3 && g.ratedPowerW < 5.5);
});

// ---------------------------------------------------------------- steady operation
test('warm-up hands over with continuous reactivity (|rho| < 1e-4 at t=0)', () => {
  const sim = make();
  const s = sim.snapshot();
  assert.ok(Math.abs(s.rho) < 1e-4, `rho at hand-over = ${s.rho}`);
});

test('steady operation holds rated power within 0.5 % for 600 s', () => {
  const sim = make();
  sim.run(600);
  const s = sim.snapshot();
  assert.ok(Math.abs(s.n - 1) < 0.005, `n = ${s.n}`);
  assert.ok(Math.abs(s.Pfis / sim.g.ratedPowerW - 1) < 0.005);
});

test('electric output is positive, below the thermal input, and below the Carnot limit', () => {
  const sim = make();
  sim.run(300);
  const s = sim.snapshot();
  assert.ok(s.Pe > 0, 'Pe must be positive');
  assert.ok(s.Pe < s.Pth);
  const carnot = 1 - s.Tw / s.Tc;
  assert.ok(s.efficiency < carnot, `efficiency ${s.efficiency} vs Carnot ${carnot}`);
});

test('Bi2Te3 output matches the converter efficiency formula at the operating temperatures', () => {
  const sim = make();
  sim.run(300);
  const s = sim.snapshot();
  const z = 1.0;
  const sq = Math.sqrt(1 + z);
  const eta = (1 - s.Tw / s.Tc) * ((sq - 1) / (sq + s.Tw / s.Tc));
  const Qcw = sim.lastOutputs.Qcw;
  assert.ok(Math.abs(s.Pe - eta * Qcw) / Math.max(s.Pe, 1e-12) < 1e-6);
});

test('power conversion: no converter output when there is no temperature difference', () => {
  const sim = make();
  sim.Tw = sim.Tc; // isothermal
  sim.step(0.01);
  assert.equal(sim.snapshot().Pe, 0);
});

// ---------------------------------------------------------------- energy conservation
test('energy ledger closes: thermal = electric + environment + stored (relative 1e-9)', () => {
  const sim = make();
  sim.run(900, [{ t: 100, action: 'scram' }]);
  const e = sim.snapshot().energy;
  const residual = e.thermal - e.electric - e.environment - e.stored;
  assert.ok(Math.abs(residual) / e.thermal < 1e-9, `residual ${residual} of ${e.thermal}`);
});

test('energy ledger closes through a pump trip and a vibration excursion', () => {
  const sim = make({}, { noise: true, seed: 3 });
  sim.run(300, [
    { t: 20, action: 'pumpTrip' },
    { t: 60, action: 'vibration', params: { multiplier: 4 } },
  ]);
  const e = sim.snapshot().energy;
  const residual = e.thermal - e.electric - e.environment - e.stored;
  assert.ok(Math.abs(residual) / e.thermal < 1e-9, `residual ${residual}`);
});

test('time step convergence: fuel temperature changes by < 0.05 K between dt = 0.01 and 0.005 s', () => {
  const a = make({}, { warmUpS: 1000 });
  const b = make({}, { warmUpS: 1000, dt: 0.005 });
  a.run(120, [{ t: 30, action: 'scram' }]);
  b.run(120, [{ t: 30, action: 'scram' }]);
  assert.ok(Math.abs(a.Tf - b.Tf) < 0.05, `Tf ${a.Tf} vs ${b.Tf}`);
  assert.ok(Math.abs(a.snapshot().n - b.snapshot().n) < 1e-3);
});

// ---------------------------------------------------------------- noise and measurement
test('flow sensor scatter matches the configured 2 % (1 sigma) error about the true flow', () => {
  // The measured flow is compared with the true flow of the same step, so the real flow
  // fluctuation from vibration (about 2 %) is excluded: only the sensor error is tested.
  const sim = make({}, { noise: true, seed: 21, warmUpS: 600 });
  const readings = [];
  for (let i = 0; i < 6000; i += 1) {
    sim.step(0.01);
    const trueRel = sim.lastOutputs.mdotEff / sim.g.flowNom;
    readings.push(sim.readings.flow[0] / trueRel);
  }
  const mean = readings.reduce((s, x) => s + x, 0) / readings.length;
  const sd = Math.sqrt(readings.reduce((s, x) => s + (x - mean) ** 2, 0) / readings.length);
  assert.ok(Math.abs(sd - 0.02) < 0.006, `flow measurement sd = ${sd}`);
  assert.ok(Math.abs(mean - 1) < 0.01, `flow measurement mean = ${mean}`);
  assert.ok(sd > 0);
});

test('true flow fluctuation starts at zero and stays within 5 sigma of the vibration-driven level', () => {
  const sim = make({}, { noise: true, seed: 31, warmUpS: 600 });
  const sigma = sim.design.pump.vibrationFlowPerG * sim.vibration.grms;
  let maxDev = 0;
  for (let i = 0; i < 3000; i += 1) {
    sim.step(0.01);
    maxDev = Math.max(maxDev, Math.abs(sim.lastOutputs.mdotTrue / (sim.g.flowNom * (1 + sim.pump.toleranceFrac)) - 1));
  }
  assert.ok(maxDev < 5 * sigma, `max flow deviation ${maxDev} vs sigma ${sigma}`);
  assert.equal(sim.snapshot().scramRequested, false, 'flow fluctuation must not trip the reactor');
});

test('nominal noisy operation never trips the protection system (10 seeds, 300 s)', () => {
  for (let seed = 1; seed <= 10; seed += 1) {
    const sim = new ReactorSimulation(defaultDesign(), { seed, noise: true, warmUpS: 1500 });
    sim.run(300);
    assert.equal(sim.snapshot().scramRequested, false, `seed ${seed} tripped: ${sim.trip.causes}`);
  }
});

test('pump tolerance draw stays inside the design band when noise is on', () => {
  for (let seed = 1; seed <= 20; seed += 1) {
    const sim = new ReactorSimulation(defaultDesign(), { seed, noise: true, warmUpS: 60 });
    assert.ok(Math.abs(sim.pump.toleranceFrac) <= defaultDesign().pump.toleranceFrac + 1e-12);
  }
});

test('noise off gives deterministic exact readings', () => {
  const sim = make();
  sim.step(0.01);
  assert.equal(sim.readings.flux[0], sim.readings.flux[1]);
  assert.equal(sim.readings.flux[0], sim.readings.flux[2]);
});

test('same seed reproduces the run exactly; different seeds differ', () => {
  const run = (seed) => {
    const sim = new ReactorSimulation(defaultDesign(), { seed, noise: true, warmUpS: 300 });
    sim.run(200, [{ t: 50, action: 'vibration', params: { multiplier: 3 } }]);
    return sim.snapshot();
  };
  const a = run(5);
  const b = run(5);
  const c = run(6);
  assert.equal(a.Tf, b.Tf);
  assert.equal(a.flowTrue, b.flowTrue);
  assert.notEqual(a.flowTrue, c.flowTrue);
});

// ---------------------------------------------------------------- protection
test('protection trip (power) SCRAMs the reactor and power falls to decay heat', () => {
  const sim = make();
  sim.run(10, [{ t: 5, action: 'withdraw', params: { rate: 0.05 } }]);
  // unprotected withdrawal would push power above the trip; with protection the trip fires
  sim.run(120);
  const s = sim.snapshot();
  assert.ok(s.scramRequested, 'SCRAM expected');
  assert.ok(s.n < 0.01, `n after SCRAM = ${s.n}`);
  assert.equal(outcomeOf(sim), 'SHUTDOWN');
});

test('pump trip: coolant flow falls and the flow trip SCRAMs', () => {
  const sim = make();
  sim.run(60, [{ t: 10, action: 'pumpTrip' }]);
  const s = sim.snapshot();
  assert.ok(s.scramRequested);
  assert.ok(s.tripCauses.includes('flow'));
  assert.ok(s.flowTrue < 0.2 * s.flowNom);
});

test('vibration above the 30 g trip SCRAMs the reactor', () => {
  const sim = make({}, { noise: true, seed: 2 });
  sim.run(60, [{ t: 10, action: 'vibration', params: { multiplier: 10 } }]);
  const s = sim.snapshot();
  assert.ok(s.scramRequested);
  assert.ok(s.tripCauses.includes('vibration'));
});

test('stuck rods: rods remain at their position on SCRAM and the redundant shut-down is reported', () => {
  const sim = make();
  sim.run(20, [{ t: 5, action: 'stuckRods' }, { t: 10, action: 'scram' }]);
  const s = sim.snapshot();
  assert.ok(s.rods.every((r) => r.stuck));
  assert.ok(s.rods.every((r) => r.z < 1), 'stuck rods must not reach full insertion');
});

test('a SCRAM with all rods free fully inserts them and stops fission', () => {
  const sim = make();
  sim.run(5, [{ t: 0, action: 'scram' }]);
  sim.run(3);
  const s = sim.snapshot();
  assert.ok(s.rods.every((r) => r.z > 0.99), 'rods must reach full insertion');
  assert.ok(s.rho < -0.02, `rho after insertion = ${s.rho}`);
  assert.ok(s.n < 0.3, `n = ${s.n}`);
});

test('after a SCRAM power decays on the precursors and falls below 5 % within 60 s', () => {
  const sim = make();
  sim.run(5, [{ t: 0, action: 'scram' }]);
  sim.run(60);
  assert.ok(sim.snapshot().n < 0.05, `n after 60 s = ${sim.snapshot().n}`);
});

test('kill: permanent poison plus SCRAM shuts the core down and the state is reported as killed', () => {
  const sim = make();
  sim.run(60, [{ t: 10, action: 'kill' }]);
  const s = sim.snapshot();
  assert.ok(s.killed);
  assert.ok(s.n < 0.01, `n = ${s.n}`);
  assert.equal(outcomeOf(sim), 'SHUTDOWN');
});

test('destroy: fission stops at once, decay heat and a release remain, outcome DESTROYED', () => {
  const sim = make();
  sim.run(20, [{ t: 5, action: 'destroy' }]);
  const s = sim.snapshot();
  assert.ok(s.destroyed);
  assert.equal(s.destroyCause, 'scripted destruct');
  assert.equal(s.Pfis, 0);
  assert.ok(s.Pdecay > 0);
  assert.ok(s.releaseFraction > 0);
  assert.equal(outcomeOf(sim), 'DESTROYED');
});

test('decay heat after shutdown decreases monotonically', () => {
  const sim = make();
  sim.run(10, [{ t: 0.1, action: 'scram' }]);
  let prev = Infinity;
  for (let i = 0; i < 40; i += 1) {
    sim.run(5);
    const p = sim.snapshot().Pdecay;
    assert.ok(p <= prev + 1e-15, `decay heat rose: ${p} > ${prev}`);
    prev = p;
  }
});

// ---------------------------------------------------------------- failure modes
test('high vibration fatigues the fuel supports until the core is destroyed', () => {
  const sim = make({}, { noise: true, seed: 4 });
  sim.run(2000, [{ t: 10, action: 'vibration', params: { multiplier: 100 } }]);
  const s = sim.snapshot();
  assert.ok(s.destroyed, 'expected fatigue destruction');
  assert.equal(s.destroyCause, 'fatigue failure of fuel supports');
});

test('converter fails above its vibration limit (Stirling 6 g limit)', () => {
  const sim = make({ converter: 'stirling' }, { noise: false });
  sim.run(20, [{ t: 5, action: 'vibration', params: { multiplier: 1 } }]);
  const s = sim.snapshot();
  assert.equal(s.converterFailed, true);
  assert.equal(s.Pe, 0);
});

test('nominal vibration: no structural damage in 600 s (fatigue damage << 1)', () => {
  const sim = make({}, { noise: true, seed: 8 });
  sim.run(600);
  assert.ok(sim.snapshot().fatigueDamage < 1e-3);
  assert.equal(sim.snapshot().destroyed, false);
});

test('a heat-sink loss raises the fuel temperature, but a 5 W core remains self-limiting', () => {
  const sim = make();
  sim.run(10, [{ t: 0, action: 'sink', params: { factor: 0 } }]);
  const t0 = sim.Tf;
  sim.run(600);
  assert.ok(sim.Tf > t0);
  assert.ok(sim.Tf < sim.g.tFuelDamage, 'a 5 W core cannot reach fuel damage from a sink loss alone');
});

// ---------------------------------------------------------------- outputs
test('snapshot exposes the power and dose quantities needed by the UI', () => {
  const sim = make();
  sim.run(10);
  const s = sim.snapshot();
  for (const k of ['Pth', 'Pe', 'Tf', 'Tc', 'Tw', 'flowTrue', 'flowEff', 'grms', 'fn']) {
    assert.ok(Number.isFinite(s[k]), `${k} is not finite`);
  }
  assert.ok(s.radiation.at1m.totalSvPerH >= 0);
  assert.ok(s.radiation.atCanSurface.totalSvPerH >= s.radiation.at1m.totalSvPerH);
});

test('neutron dose at 1 m is far above the public limit (documented finding)', () => {
  // A 5 W coke-can core emits ~4e11 n/s. A 4 mm borated PE layer removes ~4 % of fast neutrons,
  // so the neutron shield cannot meet the 20 uSv/h public limit within this envelope.
  const sim = make();
  sim.run(10);
  assert.ok(sim.snapshot().radiation.at1m.totalSvPerH > 2e-5 * 1e4);
});
