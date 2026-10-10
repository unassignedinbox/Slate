// Physics and reliability tests. Run with: npm test (node:test, no dependencies).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createReactor, buildBaseModel, mergeConfig } from '../src/physics/reactor.js';
import { stepKinetics, initialKinetics, steadyPower, sourceTerm, decayHeatFraction } from '../src/physics/kinetics.js';
import { createRng, boundedAr1 } from '../src/physics/rng.js';
import { supportModel, milesDisplacement, rootStressRms, psdAt, VIBRATION_PROFILES } from '../src/physics/vibration.js';
import { doseAt } from '../src/physics/radiation.js';
import { cf252Rate } from '../src/physics/radiation.js';
import { BETA_TOTAL, E_FISSION_J, U235, G0 } from '../src/physics/constants.js';
import { SCENARIOS, NOISE_OFF } from '../src/physics/scenarios.js';
import { getMaterial } from '../src/physics/materials.js';
import { DEFAULT_CONFIG } from '../src/physics/reactor.js';

const near = (a, b, relTol, msg = '') =>
  assert.ok(Math.abs(a - b) <= relTol * Math.abs(b), `${msg} expected ${b} got ${a} (rel ${(Math.abs(a - b) / Math.abs(b)).toExponential(2)})`);

// ------------------------------------------------------------------ materials and base model
test('default base model is valid and the four factors are physical', () => {
  const B = buildBaseModel({});
  assert.equal(B.valid, true, B.validity.reasons.join(' '));
  assert.ok(B.kInf0 > 1.0 && B.kInf0 < 1.4, `k_inf ${B.kInf0}`);
  assert.ok(B.ff.p > 0.6 && B.ff.p < 0.95, `p ${B.ff.p}`);
  assert.ok(B.k0 > 0.5 && B.k0 < 1.0, `k_eff ${B.k0}`);
  assert.ok(B.PNL > 0 && B.PNL < 1, `P_NL ${B.PNL}`);
  assert.ok(B.Lambda > 1e-6 && B.Lambda < 1e-2, `Lambda ${B.Lambda}`);
  assert.ok(B.rhoIn < B.rhoOut && B.rhoOut < 0, 'rods in must be more negative than rods out, both subcritical');
});

test('fast-spectrum or non-moderated coolants are rejected with a reason', () => {
  for (const c of ['NA', 'LBE', 'FLIBE', 'HE', 'D2O']) {
    const B = buildBaseModel({ materials: { coolant: c } });
    assert.equal(B.valid, false, `${c} should be outside the thermal model range`);
    assert.ok(B.validity.reasons.length > 0);
    assert.throws(() => createReactor({ materials: { coolant: c } }), /validated model range/);
  }
});

test('supercritical rods-withdrawn configuration is rejected (B4C shield)', () => {
  const B = buildBaseModel({ materials: { shield: 'B4C' } });
  assert.equal(B.valid, false);
  assert.match(B.validity.reasons.join(' '), /not subcritical/);
});

test('moderator options give valid thermal models', () => {
  for (const m of ['GRAPHITE', 'ZRH', 'BEO']) {
    const B = buildBaseModel({ materials: { moderator: m } });
    assert.equal(B.valid, true, `${m}: ${B.validity.reasons.join(' ')}`);
  }
});

test('material library records have the fields the model reads', () => {
  for (const r of ['cladding', 'structure']) {
    for (const id of ['ZRY4', 'SS316L', 'IN718', 'TI64', 'SIC_SIC'].filter((x) => r === 'structure' ? x !== 'ZRY4' && x !== 'SIC_SIC' : x !== 'SS316L' && x !== 'IN718' && x !== 'TI64')) {
      const m = getMaterial(r, id);
      assert.ok(m, `${r}/${id}`);
    }
  }
  for (const id of ['SS316L', 'IN718', 'TI64']) {
    const m = getMaterial('structure', id);
    assert.ok(Number.isFinite(m.k) && m.k > 0, `${id} thermal conductivity`);
    assert.ok(Number.isFinite(m.E) && m.E > 0, `${id} modulus`);
    assert.ok(Number.isFinite(m.yield) && m.yield > 0, `${id} yield`);
  }
});

// ------------------------------------------------------------------ neutronics and kinetics
test('steady subcritical power matches the source-driven closed form', () => {
  const r = createReactor({});
  const x = r.run(0.5, 60, { sampleEvery: 60 }).at(-1);
  const S = cf252Rate(DEFAULT_CONFIG.source.ug);
  const k = x.kEff;
  const closed = (E_FISSION_J * S * k) / (U235.nu * (1 - k));   // W, using k_eff with P_NL included
  near(x.Pfis, closed, 0.05, 'steady P');
  assert.ok(x.Pfis > 1e-10 && x.Pfis < 1e-7, `P ${x.Pfis}`);
});

test('point kinetics: steady source-driven state reproduces q*Lambda/(-rho)', () => {
  const Lambda = 1e-4, rho = -0.3, q = 1e-6;
  let st = initialKinetics(steadyPower({ rho, Lambda, q }), Lambda);
  for (let i = 0; i < 4000; i++) st = stepKinetics(st, { rho, Lambda, q, dt: 0.05 });
  near(st.P, steadyPower({ rho, Lambda, q }), 1e-6, 'source-driven steady P');
});

test('point kinetics: delayed precursors hold an equilibrium at rho = 0 with no source', () => {
  const Lambda = 1e-4;
  const st0 = initialKinetics(1.0, Lambda);
  const st = stepKinetics(st0, { rho: 0, Lambda, q: 0, dt: 1 });
  near(st.P, 1.0, 1e-9, 'P at critical');
});

test('point kinetics: beta is the prompt-critical threshold used by the accident logic', () => {
  assert.ok(BETA_TOTAL > 0.006 && BETA_TOTAL < 0.0075, `beta ${BETA_TOTAL}`);
});

test('Way-Wigner decay heat: matches the closed form and decays monotonically', () => {
  const f = (td, T) => 0.066 * (Math.pow(td, -0.2) - Math.pow(td + T, -0.2));
  near(decayHeatFraction(300, 1800), f(300, 1800), 1e-6, 'WW at 300 s');
  assert.ok(decayHeatFraction(10, 1800) > decayHeatFraction(1000, 1800));
  assert.ok(decayHeatFraction(1e5, 1800) < 0.01 * decayHeatFraction(10, 1800));
});

test('dose falls with the square of distance (point-source geometry)', () => {
  const path = { sigRx: 0.5, mux: 0.2 };
  const d1 = doseAt({ d: 10, path, Sn_eff: 1e3, Sg: 1e3 }).total;
  const d2 = doseAt({ d: 100, path, Sn_eff: 1e3, Sg: 1e3 }).total;
  near(d1 / d2, 100, 1e-9, 'inverse square ratio');
});

test('Cf-252 source strength and unshielded neutron dose match the published reference', () => {
  // OSTI 1184089: 2.314e6 n/s per ug; H*(10) for neutrons at 1 m is about 2.55 mrem/h per ug
  // i.e. 25.5 uSv/h per ug. Allow 10 % for the fission-spectrum dose-conversion approximation.
  near(cf252Rate(1), 2.314e6, 0.01, 'source rate');
  const d = doseAt({ d: 100, path: { sigRx: 0, mux: 0 }, Sn_eff: cf252Rate(1), Sg: 0 });
  near(d.neutron, 25.5, 0.1, 'unshielded neutron H*(10) at 1 m per ug');
});

// ------------------------------------------------------------------ vibration
test('support frequency matches cantilever stiffness (3EI/L^3)/m', () => {
  const s = supportModel({ E_GPa: 193, dMm: 6, LMm: 20, mKg: 3.85, zeta: 0.005 });
  const I = Math.PI * (6e-3) ** 4 / 64;
  const fn = Math.sqrt(3 * 193e9 * I / (20e-3) ** 3 / 3.85) / (2 * Math.PI);
  near(s.fn, fn, 1e-9, 'fn');
  assert.ok(s.fn > 150 && s.fn < 200, `fn ${s.fn}`);
});

test('Miles relative-displacement response matches the analytic expression', () => {
  const fn = 180, Q = 50, gPsd = 0.01;
  const z = milesDisplacement({ fn, Q, gPsdAtFn: gPsd });
  const S = gPsd * G0 * G0;
  near(z, Math.sqrt((Math.PI / 2) * fn * Q * S) / (2 * Math.PI * fn) ** 2, 1e-9, 'Miles');
});

test('root stress is linear in displacement (cantilever tip-load relation)', () => {
  const s1 = rootStressRms({ E: 200e9, d: 6e-3, L: 20e-3, zRms: 1e-4 });
  const s2 = rootStressRms({ E: 200e9, d: 6e-3, L: 20e-3, zRms: 2e-4 });
  near(s2 / s1, 2, 1e-12, 'linearity');
});

test('vibration profile PSD interpolation is non-negative and defined at the support frequency', () => {
  for (const id of ['seismic', 'truck', 'aircraft']) {
    const P = VIBRATION_PROFILES[id];
    assert.ok(P && P.psd, id);
    const g = psdAt(P.psd, 181);
    assert.ok(Number.isFinite(g) && g >= 0, `${id} PSD at 181 Hz`);
  }
});

// ------------------------------------------------------------------ noise and RNG
test('seeded RNG is reproducible and different seeds diverge', () => {
  const a = createRng(7), b = createRng(7), c = createRng(8);
  const va = Array.from({ length: 50 }, () => a.next());
  const vb = Array.from({ length: 50 }, () => b.next());
  const vc = Array.from({ length: 50 }, () => c.next());
  assert.deepEqual(va, vb);
  assert.notDeepEqual(va, vc);
});

test('pump pulsation AR(1) has the configured sigma and is bounded by the clamp', () => {
  const rng = createRng(11);
  const sigma = 0.01, bound = 0.05, phi = Math.exp(-0.25 / 2);
  let x = 0, s = 0, s2 = 0, n = 200000, maxAbs = 0;
  for (let i = 0; i < n; i++) {
    x = boundedAr1(rng, x, { phi, sigma, bound });
    s += x; s2 += x * x; maxAbs = Math.max(maxAbs, Math.abs(x));
  }
  const mean = s / n, sd = Math.sqrt(s2 / n - mean * mean);
  near(sd, sigma, 0.05, 'AR(1) sigma');
  assert.ok(Math.abs(mean) < 1e-3, `mean ${mean}`);
  assert.ok(maxAbs <= bound + 1e-12, 'clamp');
});

test('measured flow error stays inside the configured sensor envelope', () => {
  const noise = { ...DEFAULT_CONFIG.noise };
  const r = createReactor({ noise: { ...noise }, seed: 3 });
  const rec = r.run(0.25, 300, { sampleEvery: 0.25 });
  for (const x of rec) {
    for (const m of x.meas.flow) {
      // Sensor error vs the true flow: bias (+/-1 %) + 0.5 % noise, 3-sigma envelope ~ +/-2.5 %
      const rel = m / x.flowTrueGps - 1;
      assert.ok(Math.abs(rel) < 0.06, `flow reading error ${rel}`);
    }
  }
});

test('with noise switched off, measured flow equals the true flow', () => {
  const r = createReactor({ noise: { ...NOISE_OFF }, seed: 3 });
  const x = r.run(0.5, 30, { sampleEvery: 1 }).at(-1);
  // Sensor biases are zero with NOISE_OFF, so the readings are exact.
  for (const m of x.meas.flow) near(m, x.flowTrueGps, 1e-9, 'flow reading');
});

test('reproducibility: identical seeds produce identical runs', () => {
  const cfg = { seed: 42, vibration: { profile: 'seismic', scale: 0.2 }, support: { dMm: 12, LMm: 20, zeta: null } };
  const a = createReactor(cfg).run(0.5, 120, { sampleEvery: 10 });
  const b = createReactor(cfg).run(0.5, 120, { sampleEvery: 10 });
  assert.deepEqual(a.map((x) => x.Pfis), b.map((x) => x.Pfis));
  assert.deepEqual(a.map((x) => x.flowMeasGps), b.map((x) => x.flowMeasGps));
});

// ------------------------------------------------------------------ thermal network
test('thermal network reaches the analytic steady state (wall and bulk)', () => {
  const cfg = {
    source: { kind: 'nps', nps: 2e9 },
    safety: { autoCoreKill: false, designPowerW: 1e3, doseLimitSurfaceUSvh: 1e12 },
    noise: { ...NOISE_OFF },
  };
  const r = createReactor(cfg);
  const x = r.run(1, 60000, { sampleEvery: 60000 }).at(-1);
  const Pth = x.Pth;
  near(x.TwC, 25 + Pth / x.Gwa, 2e-3, 'wall steady state');
  near(x.TbC, x.TwC + Pth / x.Gbw, 2e-3, 'bulk steady state');
  assert.ok(x.TfMaxC > x.TbC, 'fuel hotter than bulk');
});

test('thermoelectric output stays below the Carnot limit', () => {
  const x = createReactor({ source: { kind: 'nps', nps: 2e9 } }).run(1, 100, { sampleEvery: 100 }).at(-1);
  const Th = x.TbC + 273.15, Tc = x.TwC + 273.15;
  assert.ok(x.etaTE < 1 - Tc / Th + 1e-12, 'eta below Carnot');
  assert.ok(x.Pe <= x.Pth, 'electrical power not above thermal');
});

// ------------------------------------------------------------------ scenarios (expected behaviour)
for (const s of SCENARIOS) {
  test(`scenario: ${s.id} - ${s.name}`, () => {
    const r = createReactor({ ...s.config, seed: 1 });
    const rec = r.run(s.dt, s.duration, { sampleEvery: Math.max(s.dt, s.duration / 20) });
    const x = rec.at(-1);
    const st = r.state;
    const e = s.expect || {};
    const trips = st.trips.map((t) => t.reason);
    const accs = st.accidents.map((a) => a.reason);
    assert.ok(rec.every((y) => Number.isFinite(y.Pfis) && Number.isFinite(y.TfMaxC) && Number.isFinite(y.dose.surface)),
      'all outputs finite');
    if (e.state) assert.equal(x.state, e.state, `state (trips ${trips}, accidents ${accs})`);
    for (const t of e.trips || []) assert.ok(trips.includes(t), `expected trip ${t}; got ${trips}`);
    if (e.accidents) assert.deepEqual([...new Set(accs)].sort(), [...e.accidents].sort(), 'accidents');
    if (e.accidentAny) assert.ok(accs.some((a) => e.accidentAny.includes(a)), `expected one of ${e.accidentAny}; got ${accs}`);
    if (e.killReason) assert.equal(st.killReason, e.killReason);
    if (e.doseRises) assert.ok(rec.at(-1).dose.surface > rec[0].dose.surface * 1.05, 'dose rises after breach');
  });
}

// ------------------------------------------------------------------ repeated-run reliability
test('reliability: nominal run is trip-free and stable over 5 seeds', () => {
  const finals = [];
  for (const seed of [1, 2, 3, 4, 5]) {
    const r = createReactor({ seed });
    r.run(0.5, 1800, { sampleEvery: 1800 });
    const st = r.state;
    assert.equal(st.trips.length, 0, `seed ${seed} tripped`);
    assert.equal(st.accidents.length, 0, `seed ${seed} accident`);
    finals.push(r.last.energyThJ);
  }
  const mean = finals.reduce((a, b) => a + b, 0) / finals.length;
  // Thermal energy is set by the physics (identical source), not the sensor noise.
  for (const f of finals) near(f, mean, 0.02, 'energy spread across seeds');
});
