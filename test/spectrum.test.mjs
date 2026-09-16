// Validates oceanographic formulas, cascade partitioning, bathymetry,
// shoaling, and the analytic-source JS mirror. Run: npm test
import assert from 'node:assert/strict';
import {
  G, dispersionOmega, dispersionDeriv, fetchRelations, jonswapS, tmaPhi,
  donelanBeta, donelanD, pmSwellS, phillips, cosFade, defaultSeaParams,
  cascadeBands, wavenumberSpectrum, predictedHs, dominantWave,
} from '../src/ocean/spectra.js';
import { defaultBathyParams, depthAt, shoalingGain } from '../src/ocean/bathymetry.js';
import { analyticHeightJS } from '../src/ocean/sources.js';

// --- dispersion ---
{
  const w = dispersionOmega(0.1, 0);
  assert.ok(Math.abs(w - Math.sqrt(G * 0.1)) < 1e-9, 'deep dispersion');
  const ws = dispersionOmega(0.1, 1);
  assert.ok(ws < w && ws > 0.2 && ws < 0.4, `shallow dispersion slows waves (got ${ws})`);
  const d = dispersionDeriv(0.1, 0);
  assert.ok(Math.abs(d - 0.5 * Math.sqrt(G / 0.1)) < 1e-9, 'deep group velocity');
  assert.equal(dispersionOmega(0, 100), 0);
}

// --- fetch relations (Hasselmann): U=10 m/s, fully developed F~224km ---
{
  const { fp, Hs } = fetchRelations(10, 224000);
  const Tp = 1 / fp;
  console.log(`fetch: Tp=${Tp.toFixed(2)}s Hs=${Hs.toFixed(2)}m (expect ~7.9s, ~2.4m)`);
  assert.ok(Tp > 7 && Tp < 9, 'fully developed Tp');
  assert.ok(Hs > 1.8 && Hs < 3.0, 'fully developed Hs');
  const young = fetchRelations(10, 20000);
  assert.ok(young.fp > fp, 'young seas peak at higher frequency');
}

// --- JONSWAP peaks at wp ---
{
  const { alpha, wp } = fetchRelations(9, 120000);
  const atPeak = jonswapS(wp, alpha, wp, 3.3);
  assert.ok(atPeak > jonswapS(wp * 0.7, alpha, wp, 3.3), 'JONSWAP rises to peak');
  assert.ok(atPeak > jonswapS(wp * 1.4, alpha, wp, 3.3), 'JONSWAP falls past peak');
}

// --- TMA depth factor ---
{
  assert.ok(Math.abs(tmaPhi(0.5, 250) - 1) < 1e-9, 'deep water: no attenuation');
  const shallow = tmaPhi(1.0, 2);
  assert.ok(shallow < 0.05, `shallow attenuates (got ${shallow})`);
  assert.ok(tmaPhi(2.0, 2) > tmaPhi(0.8, 2), 'TMA attenuates less toward the tail');
  assert.ok(Math.abs(tmaPhi(0.6, 250) - 1) < 1e-9, 'deep keeps the peak');
}

// --- Donelan-Banner spreading is normalized ---
for (const beta of [1.24, 2.6, 9]) {
  let sum = 0;
  const M = 720;
  for (let i = 0; i < M; i++) sum += donelanD((-Math.PI + (2 * Math.PI * i) / M), 0.3, beta);
  sum *= (2 * Math.PI) / M;
  console.log(`donelan beta=${beta}: integral=${sum.toFixed(4)}`);
  assert.ok(Math.abs(sum - 1) < 0.02, 'spreading normalization');
}
assert.ok(donelanBeta(0.5, 1) > 1 && donelanBeta(3, 1) < 1.5, 'beta shape');

// --- PM swell integrates to Hs^2/16 ---
{
  let m0 = 0;
  const Hs = 2, Tp = 10, wp = (2 * Math.PI) / Tp;
  for (let w = 0.05; w < 4; w += 0.005) m0 += pmSwellS(w, Hs, Tp) * 0.005;
  console.log(`PM m0=${m0.toFixed(4)} target=${((Hs * Hs) / 16).toFixed(4)}`);
  assert.ok(Math.abs(m0 - (Hs * Hs) / 16) / ((Hs * Hs) / 16) < 0.03, 'PM normalization');
}

// --- Phillips: one-sided, finite ---
{
  const p1 = phillips(0.1, 0, 9, 0, 1);
  const p2 = phillips(-0.1, 0, 9, 0, 1);
  assert.ok(p1 > 0 && p2 === 0, 'phillips one-sided');
  assert.equal(phillips(0, 0, 9, 0, 1), 0);
}

// --- cascade bands partition k without gaps/double-count at crossovers ---
{
  const bands = cascadeBands([1024, 256, 64], 256);
  assert.equal(bands.length, 3);
  assert.ok(bands[0].kHi0 > 0 && bands[0].kLo1 === 0, 'cascade 0 high edge only');
  assert.ok(bands[1].kLo1 > 0 && bands[1].kHi0 > 0, 'cascade 1 both edges');
  assert.ok(bands[2].kLo1 > 0 && bands[2].kHi0 === 0, 'cascade 2 low edge only');
  // complementary at crossover
  const kc = Math.sqrt(bands[0].kHi0 * bands[0].kHi1);
  const w0 = 1 - cosFade(kc, bands[0].kHi0, bands[0].kHi1);
  const w1 = cosFade(kc, bands[1].kLo0, bands[1].kLo1);
  assert.ok(Math.abs(w0 + w1 - 1) < 1e-9, 'crossover complementary');
  assert.ok(kc > 0.1 && kc < 0.2, `crossover kc01=${kc.toFixed(3)} sensible`);
}

// --- full spectrum sanity + predicted Hs ---
{
  const P = defaultSeaParams();
  const bands = cascadeBands([1024, 256, 64], 64);
  bands.forEach((b) => (b.N = 64));
  const Hs = predictedHs(P, [1024, 256, 64], 64);
  console.log(`predicted Hs (JONSWAP+swell) = ${Hs.toFixed(2)}m (expect ~2.0-2.6)`);
  assert.ok(Hs > 1.4 && Hs < 3.2, 'predicted Hs range');
  const Ppm = { ...P, specMode: 1 };
  const HsPm = predictedHs(Ppm, [1024, 256, 64], 64);
  console.log(`predicted Hs (PM+swell) = ${HsPm.toFixed(2)}m`);
  assert.ok(HsPm > 1.0 && HsPm < 3.5, 'PM Hs range');
  const Pph = { ...P, specMode: 2 };
  const HsPh = predictedHs(Pph, [1024, 256, 64], 64);
  console.log(`predicted Hs (Phillips+swell) = ${HsPh.toFixed(2)}m`);
  assert.ok(HsPh > 1.0 && HsPh < 3.5, 'Phillips normalized Hs range');
  // zero wavenumber carries nothing; downwind has energy
  assert.equal(wavenumberSpectrum(0, 0, P, null, P.refDepth).psi, 0);
  const down = wavenumberSpectrum(0.1, 0, P, null, P.refDepth).psi;
  assert.ok(down > 0, 'downwind energy');
}

// --- dominant wave ---
{
  const P = defaultSeaParams(); // swell 1.6m/11s should dominate
  const dom = dominantWave(P);
  console.log(`dominant: Tp=${dom.Tp.toFixed(1)}s k=${dom.k.toFixed(4)} dir=${dom.dirDeg}`);
  assert.ok(Math.abs(dom.Tp - 11) < 0.01, 'swell dominates default sea');
  assert.ok(Math.abs(dom.k - (dom.omega ** 2) / G) < 1e-9, 'deep-water k-w link');
}

// --- bathymetry ---
{
  const P = defaultBathyParams();
  P.mode = 0;
  assert.equal(depthAt(0, 0, P), 250);
  P.mode = 1; P.shoreX = 40; P.slope = 0.02; P.tide = 0;
  const dIn = depthAt(140, 0, P), dOut = depthAt(190, 0, P);
  assert.ok(dOut > dIn && dIn > 0, 'beach deepens offshore');
  assert.ok(depthAt(-60, 0, P) < 0, 'sand above waterline');
  P.mode = 3; P.reefEdge = -160; P.reefDepth = 1.6; P.reefDeep = 30; P.shoreX = 260;
  assert.ok(Math.abs(depthAt(-400, 0, P) - 30) < 0.01, 'deep off reef');
  const flat = depthAt(-100, 0, P);
  assert.ok(Math.abs(flat - 1.6) < 0.05, `reef flat (got ${flat})`);
  assert.ok(depthAt(500, 0, P) < 0, 'sand behind reef');
  P.mode = 2; P.barX = 190; P.barH = 2.4; P.barW = 38;
  P.mode = 2;
  const over = depthAt(190, 0, { ...P, mode: 2 });
  const off = depthAt(320, 0, { ...P, mode: 2 });
  assert.ok(off > over, 'sandbar shallower than surroundings');
}

// --- shoaling gain ---
{
  const g1 = shoalingGain(0.05, 250);
  assert.ok(Math.abs(g1 - 1) < 0.03, `deep gain ~1 (got ${g1})`);
  const g2 = shoalingGain(0.05, 3);
  assert.ok(g2 > 1.03 && g2 < 1.35, `shoals up (got ${g2})`);
  assert.equal(shoalingGain(0.05, 0), 1);
}

// --- analytic sources mirror ---
{
  const src = [{ type: 0, x: 0, z: 0, amp: 1, lambda: 2 * Math.PI, dirX: 1, dirZ: 0, phase: 0, beam: 60, decay: 300, on: true }];
  const h = analyticHeightJS(src, Math.PI / 2, 0, 0); // r = lambda/4 -> sin(pi/2)=1
  const env = Math.exp(-(Math.PI / 2) / 300) * 0.5; // smoothstep(0, pi, pi/2)=0.5
  assert.ok(Math.abs(h - env) < 0.01, `point source (got ${h}, want ${env})`);
  const cancel = [{ type: 2, x: 0, z: 0, amp: 1, lambda: 40, dirX: 1, dirZ: 0, phase: 0, beam: 120, decay: 500, on: true }];
  assert.equal(analyticHeightJS(cancel, -40, 0, 0), 0); // nothing up-wave of gate... (sin may be 0 anyway)
  const hs = analyticHeightJS(cancel, 30, 0, 0);
  assert.ok(Number.isFinite(hs), 'plane gate finite');
}

console.log('spectrum.test.mjs: ALL PASS');
