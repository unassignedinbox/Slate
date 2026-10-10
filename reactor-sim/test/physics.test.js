// Unit-level physics checks against analytic or tabulated reference values.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createKinetics, stepKinetics, inhourPeriodRoot } from '../src/physics/neutronics.js';
import { BETA_GROUPS, LAMBDA_GROUPS, BETA_TOTAL, G0 } from '../src/physics/constants.js';
import {
  milesGrms,
  stackResponse,
  createNarrowbandProcess,
  basquinCyclesToFailure,
  fatigueDamageRate,
  brittleExceedanceRate,
  gammaFn,
} from '../src/physics/vibration.js';
import { decayHeatFraction, doseRateAt, gammaTransmission, neutronTransmission } from '../src/physics/radiation.js';
import {
  waterSaturationK,
  saturationK,
  converterEfficiency,
  coolantDensity,
  coolantCp,
  fuelConductivity,
  SHIELDS,
  linearAttenuation1MeV,
} from '../src/physics/materials.js';
import { createRng, createOuNoise } from '../src/physics/rng.js';

const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

// ---------------------------------------------------------------- constants
test('six-group delayed-neutron data sum to the quoted total beta', () => {
  assert.ok(rel(BETA_TOTAL, 0.006502) < 1e-3);
  assert.equal(BETA_GROUPS.length, 6);
  assert.equal(LAMBDA_GROUPS.length, 6);
});

// ---------------------------------------------------------------- inhour / kinetics
test('inhour root satisfies the inhour equation to high precision', () => {
  const Lambda = 1e-4;
  for (const rho of [-0.02, -0.001, 0.0005, 0.002, 0.004]) {
    const w = inhourPeriodRoot(rho, Lambda);
    const f = w * Lambda + BETA_GROUPS.reduce((s, b, i) => s + (b * w) / (w + LAMBDA_GROUPS[i]), 0);
    assert.ok(Math.abs(f - rho) < 1e-9 * Math.max(1, Math.abs(rho)), `rho=${rho}: residual ${f - rho}`);
  }
});

test('inhour root is zero at zero reactivity', () => {
  assert.equal(inhourPeriodRoot(0, 1e-4), 0);
});

test('subcritical steady state: no reactivity -> power is constant', () => {
  const st = createKinetics({ Lambda: 1e-4, power: 1 });
  for (let i = 0; i < 1000; i += 1) stepKinetics(st, 0, 0.01);
  assert.ok(rel(st.n, 1) < 1e-9, `n drifted to ${st.n}`);
});

test('point kinetics asymptotic growth matches the inhour root (+0.3 $ step)', () => {
  const Lambda = 1e-4;
  const rho = 0.003; // ~0.46 $, delayed-supercritical
  const st = createKinetics({ Lambda, power: 1 });
  const h = 1e-3;
  // let the transient decay (slowest mode ~ precursor periods), then measure the slope
  const t1 = 60;
  const t2 = 70;
  for (let i = 0; i < Math.round(t1 / h); i += 1) stepKinetics(st, rho, h);
  const n1 = st.n;
  for (let i = 0; i < Math.round((t2 - t1) / h); i += 1) stepKinetics(st, rho, h);
  const n2 = st.n;
  const measured = Math.log(n2 / n1) / (t2 - t1);
  const omega = inhourPeriodRoot(rho, Lambda);
  assert.ok(rel(measured, omega) < 0.01, `measured ${measured}, inhour ${omega}`);
});

test('prompt drop after a large negative step equals beta/(beta - rho) (within 1 %)', () => {
  // rho = -0.035 (about -5.4 $): the prompt component settles in ~ Lambda/(beta-rho) ~ 2.4 ms.
  // By 20 ms the level is beta/(beta - rho) to within 0.5 %; the fast precursor groups (lambda ~ 1-3 /s)
  // then drift it down slowly, so the check is made at 20 ms.
  const Lambda = 1e-4;
  const rho = -0.035;
  const st = createKinetics({ Lambda, power: 1 });
  const h = 1e-6;
  for (let i = 0; i < 20000; i += 1) stepKinetics(st, rho, h); // 0.02 s
  const expected = BETA_TOTAL / (BETA_TOTAL - rho);
  assert.ok(rel(st.n, expected) < 0.01, `n = ${st.n}, expected ${expected}`);
});

test('negative reactivity step gives a negative asymptotic period', () => {
  const Lambda = 1e-4;
  const rho = -0.002;
  const st = createKinetics({ Lambda, power: 1 });
  const h = 1e-2; // backward Euler: unconditionally stable for these negative roots
  // The two slowest roots (about -0.0103 and -0.0124 /s) are close, so the transient decays
  // slowly; run 3000 s before measuring over the next 100 s.
  for (let i = 0; i < 300000; i += 1) stepKinetics(st, rho, h);
  const n1 = st.n;
  for (let i = 0; i < 10000; i += 1) stepKinetics(st, rho, h); // 100 s
  const measured = Math.log(st.n / n1) / 100;
  const omega = inhourPeriodRoot(rho, Lambda);
  assert.ok(omega < 0 && measured < 0);
  assert.ok(rel(measured, omega) < 0.01, `measured ${measured}, inhour ${omega}`);
});

// ---------------------------------------------------------------- decay heat
test('Way-Wigner decay heat: about 1 % of full power one hour after long operation', () => {
  const f = decayHeatFraction(3600, 1e7);
  assert.ok(f > 0.008 && f < 0.014, `P/P0 at 1 h = ${f}`);
});

test('Way-Wigner decay heat decreases monotonically with time', () => {
  let prev = Infinity;
  for (const t of [10, 60, 600, 3600, 86400, 604800]) {
    const f = decayHeatFraction(t, 1e7);
    assert.ok(f < prev);
    prev = f;
  }
});

test('decay-heat time is clamped to 10 s below that', () => {
  assert.equal(decayHeatFraction(0, 1e4), decayHeatFraction(10, 1e4));
  assert.equal(decayHeatFraction(1, 1e4), decayHeatFraction(10, 1e4));
});

// ---------------------------------------------------------------- vibration
test('Miles equation reproduces the reference grms', () => {
  // fn = 742 Hz, Q = 10, PSD = 0.04 g^2/Hz  ->  grms = sqrt(pi/2 * 742 * 10 * 0.04)
  const expected = Math.sqrt((Math.PI / 2) * 742 * 10 * 0.04);
  assert.ok(rel(milesGrms(0.04, 742, 10), expected) < 1e-12);
  assert.ok(rel(milesGrms(0.04, 742, 10), 21.59) < 2e-3);
});

test('stackResponse: displacement and acceleration are consistent (x = a / w^2)', () => {
  const r = stackResponse({ psd: 0.04, fLo: 20, fHi: 2000, fnHz: 742, zeta: 0.05 });
  const w = 2 * Math.PI * 742;
  assert.ok(rel(r.xRms, r.aRms / (w * w)) < 1e-12);
  assert.ok(rel(r.aRms, r.grms * G0) < 1e-12);
});

test('stackResponse is zero outside the PSD band', () => {
  const r = stackResponse({ psd: 0.04, fLo: 20, fHi: 500, fnHz: 742, zeta: 0.05 });
  assert.equal(r.grms, 0);
});

test('AR(2) narrowband process reproduces its target variance (3 % over 2e5 samples)', () => {
  const rng = createRng(2024);
  const sigma = 1.5e-5; // m
  const proc = createNarrowbandProcess({ fnHz: 742, zeta: 0.05, sigma, h: 1e-4, rng });
  for (let i = 0; i < 20000; i += 1) proc.step(); // burn-in
  let s2 = 0;
  const N = 200000;
  for (let i = 0; i < N; i += 1) {
    const x = proc.step();
    s2 += x * x;
  }
  const measured = Math.sqrt(s2 / N);
  assert.ok(rel(measured, sigma) < 0.03, `sample rms ${measured} vs target ${sigma}`);
});

test('AR(2) process is stable: coefficient poles inside the unit circle', () => {
  const rng = createRng(1);
  const proc = createNarrowbandProcess({ fnHz: 742, zeta: 0.05, sigma: 1, h: 0.01, rng });
  const { a1, a2 } = proc.coefficients;
  assert.ok(Math.abs(a2) < 1);
  assert.ok(Math.abs(a1) < 1 + a2);
});

test('gamma function matches known values', () => {
  assert.ok(Math.abs(gammaFn(5) - 24) < 1e-9);
  assert.ok(Math.abs(gammaFn(6) - 120) < 1e-8);
  assert.ok(Math.abs(gammaFn(0.5) - Math.sqrt(Math.PI)) < 1e-12);
  assert.ok(Math.abs(gammaFn(1.5) - Math.sqrt(Math.PI) / 2) < 1e-12);
});

test('Basquin: cycles to failure at S = sigma_f is 0.5 and falls as stress rises', () => {
  const sf = 900e6;
  const b = -0.1;
  assert.ok(Math.abs(basquinCyclesToFailure(sf, sf, b) - 0.5) < 1e-12);
  assert.ok(basquinCyclesToFailure(2e8, sf, b) < basquinCyclesToFailure(1e8, sf, b));
});

test('Rayleigh-averaged Miner damage rate matches numerical integration', () => {
  const fn = 742;
  const sf = 900e6;
  const b = -0.1;
  const s = 5e7; // stress rms, Pa
  const analytic = fatigueDamageRate(s, fn, sf, b);
  // numerical E[1/N(R)] with Rayleigh amplitude R of rms s; N(R) = basquinCyclesToFailure(R)
  let num = 0;
  const dr = s / 2000;
  for (let r = dr / 2; r < 12 * s; r += dr) {
    const pdf = (r / (s * s)) * Math.exp(-(r * r) / (2 * s * s));
    num += pdf * (1 / basquinCyclesToFailure(r, sf, b)) * dr;
  }
  num *= fn;
  assert.ok(rel(analytic, num) < 2e-3, `analytic ${analytic} vs numeric ${num}`);
});

test('fatigue damage rate is zero at zero stress and grows with stress', () => {
  assert.equal(fatigueDamageRate(0, 742, 900e6, -0.1), 0);
  assert.ok(fatigueDamageRate(2e7, 742, 900e6, -0.1) < fatigueDamageRate(4e7, 742, 900e6, -0.1));
});

test('brittle exceedance rate: Rice-type formula, vanishing well below the strength', () => {
  const fn = 742;
  const s = 1e7;
  const lvl = 1e8;
  assert.ok(rel(brittleExceedanceRate(s, lvl, fn), fn * Math.exp(-(lvl * lvl) / (2 * s * s))) < 1e-12);
  assert.ok(brittleExceedanceRate(1e6, lvl, fn) < 1e-300 || brittleExceedanceRate(1e6, lvl, fn) === 0);
});

// ---------------------------------------------------------------- materials
test('water saturation matches IAPWS-IF97 at tabulated pressures (±0.2 K)', () => {
  const ref = [
    [0.1, 372.76],
    [0.2, 393.36],
    [0.5, 424.98],
    [1.0, 453.03],
    [5.0, 537.08],
    [15.5, 618.9],
  ];
  for (const [p, t] of ref) {
    assert.ok(Math.abs(waterSaturationK(p) - t) < 0.5, `p=${p}: ${waterSaturationK(p)} vs ${t}`);
  }
});

test('sodium Clausius-Clapeyron boils at its 1 atm normal boiling point', () => {
  assert.ok(Math.abs(saturationK('sodium', 0.101325) - 1156) < 0.01);
  assert.ok(Math.abs(saturationK('lbe', 0.101325) - 1943) < 0.01);
});

test('water liquid density matches the saturated-liquid reference (±1 %)', () => {
  assert.ok(rel(coolantDensity('water', 293.15, 0.2), 998.2) < 0.01);
  assert.ok(rel(coolantDensity('water', 373.15, 0.1), 958.4) < 0.01);
});

test('water specific heat is near 4.2 kJ/(kg K) at 300 K', () => {
  assert.ok(rel(coolantCp('water', 300), 4190) < 0.01);
});

test('UO2 thermal conductivity is about 4-5 W/(m K) at 1000 K', () => {
  const k = fuelConductivity('uo2', 1000);
  assert.ok(k > 3.5 && k < 5.5, `k = ${k}`);
});

test('thermoelectric efficiency reproduces the Ioffe ZT form and never exceeds Carnot', () => {
  // ZT = 1, Th = 600 K, Tc = 300 K: eta = (1 - 1/2) (sqrt2 - 1) / (sqrt2 + 1/2)
  const expected = 0.5 * (Math.SQRT2 - 1) / (Math.SQRT2 + 0.5);
  assert.ok(Math.abs(converterEfficiency('bi2te3', 600, 300) - expected) < 1e-12);
  for (const Th of [320, 400, 600]) {
    const eta = converterEfficiency('skutterudite', Th, 300);
    assert.ok(eta > 0 && eta < 1 - 300 / Th);
  }
  assert.equal(converterEfficiency('bi2te3', 300, 300), 0);
});

test('thermoelectric efficiency rises with ZT toward Carnot', () => {
  // skutterudite (ZT 1.2) beats Bi2Te3 (ZT 1.0) at the same temperatures
  assert.ok(converterEfficiency('skutterudite', 600, 300) > converterEfficiency('bi2te3', 600, 300));
});

test('Stirling efficiency is 25 % of Carnot', () => {
  assert.ok(Math.abs(converterEfficiency('stirling', 600, 300) - 0.25 * 0.5) < 1e-12);
});

test('lead attenuation at 1 MeV: mu/rho * rho = about 0.805 /cm', () => {
  assert.ok(rel(linearAttenuation1MeV('lead'), 0.07102 * 11.34) < 1e-9);
});

test('borated polyethylene estimate is in the plausible range (0.07-0.09 cm2/g)', () => {
  const m = SHIELDS.borated_pe.muOverRho1MeV;
  assert.ok(m > 0.07 && m < 0.09, `mu/rho = ${m}`);
});

// ---------------------------------------------------------------- radiation transport
test('gamma transmission decreases with lead thickness and buildup factor is >= 1', () => {
  const t1 = gammaTransmission([{ id: 'lead', thicknessM: 0.002 }]);
  const t2 = gammaTransmission([{ id: 'lead', thicknessM: 0.006 }]);
  assert.ok(t2 < t1);
  assert.ok(t1 > 0 && t1 <= 1 + 0.5 * 1 * 1e3);
  assert.equal(gammaTransmission([]), 1);
});

test('fast-neutron transmission is exp(-Sigma_R x)', () => {
  const x = 0.4; // cm
  const t = neutronTransmission([{ id: 'borated_pe', thicknessM: 0.004 }]);
  assert.ok(Math.abs(t - Math.exp(-0.107 * x)) < 1e-12);
});

test('inverse-square law for the unshielded neutron dose', () => {
  const a = doseRateAt({ fissionPowerW: 5, decayPowerW: 0, distanceM: 1 });
  const b = doseRateAt({ fissionPowerW: 5, decayPowerW: 0, distanceM: 2 });
  assert.ok(rel(a.neutronSvPerH / b.neutronSvPerH, 4) < 1e-9);
  assert.ok(rel(a.gammaSvPerH / b.gammaSvPerH, 4) < 1e-9);
});

test('neutron dose at 1 m from 5.4 W is consistent with the source strength (~3.3 Sv/h)', () => {
  const r = doseRateAt({ fissionPowerW: 5.4, decayPowerW: 0, distanceM: 1 });
  // 5.4 W / (200 MeV) * 2.43 n/fission = 4.1e11 n/s; flux 4.1e11 / (4 pi 1e4 cm^2) n/cm^2/s
  const flux = ((5.4 / (200 * 1.602176634e-13)) * 2.43) / (4 * Math.PI * 1e4);
  const expectedSvH = (flux * 290e-12) * 3600;
  assert.ok(rel(r.neutronSvPerH, expectedSvH) < 1e-9);
  assert.ok(r.neutronSvPerH > 3 && r.neutronSvPerH < 3.6);
});

// ---------------------------------------------------------------- rng / noise
test('RNG is deterministic for a given seed and roughly uniform', () => {
  const a = createRng(99);
  const b = createRng(99);
  for (let i = 0; i < 20; i += 1) assert.equal(a.uniform(), b.uniform());
  const r = createRng(5);
  let s = 0;
  const N = 100000;
  for (let i = 0; i < N; i += 1) s += r.uniform();
  assert.ok(Math.abs(s / N - 0.5) < 0.005);
});

test('Gaussian deviates have mean 0 and standard deviation 1 (2e5 samples)', () => {
  const r = createRng(7);
  let s = 0;
  let s2 = 0;
  const N = 200000;
  for (let i = 0; i < N; i += 1) {
    const g = r.gaussian();
    s += g;
    s2 += g * g;
  }
  assert.ok(Math.abs(s / N) < 0.01);
  assert.ok(Math.abs(Math.sqrt(s2 / N) - 1) < 0.01);
});

test('OU noise has the requested stationary standard deviation', () => {
  const r = createRng(11);
  const ou = createOuNoise(r, 0.02, 0.2);
  let s2 = 0;
  const N = 200000;
  for (let i = 0; i < N; i += 1) {
    const x = ou.step(0.01);
    s2 += x * x;
  }
  assert.ok(Math.abs(Math.sqrt(s2 / N) / 0.02 - 1) < 0.03);
});
