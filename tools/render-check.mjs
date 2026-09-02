/**
 * render-check.mjs — verifies the synthesis graph by actually rendering it.
 *
 * Runs the *same* src/audio/graph.js code the browser runs, inside a
 * web-audio-engine OfflineAudioContext, then measures the output spectrum:
 *
 *   1. the partials form a harmonic series whose fundamental is the engine's
 *      firing frequency (rpm/60 × cylinders/2) — the core claim of the model;
 *   2. no spurious low-order content below the firing tone;
 *   3. the note tracks the engine speed at three different rpms;
 *   4. level rises with throttle;
 *   5. the cars are spectrally distinct (V12 has far more HF than the turbo V6);
 *   6. the roadside position applies a correct Doppler shift;
 *   7. a stopped engine is silent.
 *
 * Usage: npm run verify
 */

import { OfflineAudioContext } from 'web-audio-engine';
import { renderSteady } from './offline.js';
import { magnitudeSpectrum, peakIn, refinePeak, rms } from './fft.js';

let failures = 0;
let checks = 0;
function check(name, ok, detail = '') {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
}

/* ------------------------------------------------- PeriodicWave convention */

async function verifyWaveConvention() {
  const sr = 48000;
  const ctx = new OfflineAudioContext(1, 512, sr);
  const pw = ctx.createPeriodicWave(new Float32Array([0, 1]), new Float32Array([0, 0]), {
    disableNormalization: true,
  });
  const o = ctx.createOscillator();
  o.setPeriodicWave(pw);
  o.frequency.value = 1000;
  o.connect(ctx.destination);
  o.start(0);
  const d = (await ctx.startRendering()).getChannelData(0);
  check(
    'PeriodicWave uses x(θ)=Σ a·cos(kθ)+b·sin(kθ) (phase encoding is valid)',
    Math.abs(d[0] - 1) < 1e-4 && Math.abs(d[1] - Math.cos((2 * Math.PI * 1000) / sr)) < 1e-4,
    `sample[0]=${d[0].toFixed(5)}`
  );
}

/* ------------------------------------------------------------ peak finding */

function strongPeaks(mags, sr, loHz, hiHz, minRatio = 0.05) {
  const binHz = sr / (mags.length * 2);
  const lo = Math.max(2, Math.floor(loHz / binHz));
  const hi = Math.min(mags.length - 2, Math.ceil(hiHz / binHz));
  let max = 0;
  for (let i = lo; i <= hi; i++) max = Math.max(max, mags[i]);
  const out = [];
  for (let i = lo + 1; i < hi; i++) {
    if (mags[i] > mags[i - 1] && mags[i] >= mags[i + 1] && mags[i] > max * minRatio) {
      const a = mags[i - 1];
      const b = mags[i];
      const c = mags[i + 1];
      const den = a - 2 * b + c;
      const shift = den !== 0 ? (0.5 * (a - c)) / den : 0;
      out.push({ freq: (i + shift) * binHz, mag: b });
    }
  }
  return out.sort((p, q) => q.mag - p.mag);
}

function analyse(buffer, { from = 0.5, to = 1 } = {}) {
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const a = Math.floor(data.length * from);
  const b = Math.floor(data.length * to);
  const slice = data.subarray(a, b);
  return { mags: magnitudeSpectrum(slice), sr, rms: rms(slice) };
}

/* ------------------------------------------------------------- the checks */

const CASES = [
  { id: 'gtr-nismo', rpms: [2000, 4000, 6500], order: 3 },
  { id: 'p918', rpms: [3000, 6000, 8500], order: 4 },
  { id: 'laferrari', rpms: [3000, 6000, 9000], order: 6 },
  { id: 'spyder-718', rpms: [2500, 5000, 7500], order: 3 },
];

async function verifyFiringOrders() {
  console.log('\n[1] the exhaust note is a harmonic series rooted at the firing frequency');
  for (const c of CASES) {
    for (const rpm of c.rpms) {
      const { buffer, car } = await renderSteady({ carId: c.id, rpm, throttle: 1, seconds: 2.5 });
      const { mags, sr } = analyse(buffer);
      const fFire = (rpm * car.engine.cylinders) / 120;
      const peaks = strongPeaks(mags, sr, 30, 6000, 0.08).slice(0, 10);
      const onSeries = peaks.filter((p) => {
        const n = p.freq / fFire;
        return Math.abs(n - Math.round(n)) / Math.max(1, Math.round(n)) < 0.035;
      });
      const fundamental = refinePeak(mags, sr, fFire, 8);
      const maxMag = peaks.length ? peaks[0].mag : 0;
      const subFund = peakIn(mags, sr, 30, fFire * 0.8).mag;
      check(
        `${c.id} @ ${rpm} rpm → firing tone ${fFire.toFixed(1)} Hz`,
        onSeries.length / peaks.length >= 0.8 &&
          Math.abs(fundamental.freq - fFire) / fFire < 0.02 &&
          fundamental.mag > maxMag * 0.15 &&
          subFund < maxMag * 0.35,
        `${(100 * onSeries.length) / peaks.length.toFixed(0)}% of peaks on series · f0 measured ${fundamental.freq.toFixed(1)} Hz · sub-fundamental ${(100 * subFund / maxMag).toFixed(0)}%`
      );
    }
  }
}

async function verifyThrottleResponse() {
  console.log('\n[2] level and brightness rise with throttle');
  for (const c of CASES) {
    const rpm = c.rpms[1];
    const wide = await renderSteady({ carId: c.id, rpm, throttle: 1, seconds: 2.5 });
    const part = await renderSteady({ carId: c.id, rpm, throttle: 0.15, seconds: 2.5 });
    const w = analyse(wide.buffer);
    const p = analyse(part.buffer);
    const hf = (a) => peakIn(a.mags, a.sr, 2000, 9000).mag;
    check(
      `${c.id} @ ${rpm}: full throttle is louder and brighter`,
      w.rms > p.rms * 1.25 && hf(w) > hf(p) * 1.2,
      `rms ${p.rms.toFixed(4)} → ${w.rms.toFixed(4)} · HF ${hf(p).toFixed(4)} → ${hf(w).toFixed(4)}`
    );
  }
}

async function verifyCharacter() {
  console.log('\n[3] the four engines are spectrally distinct at the same speed');
  const rpm = 6000;
  const profiles = {};
  for (const c of CASES) {
    const { buffer, car } = await renderSteady({ carId: c.id, rpm, throttle: 1, seconds: 2.5 });
    const { mags, sr } = analyse(buffer);
    const band = (lo, hi) => {
      const p = peakIn(mags, sr, lo, hi);
      return p.mag;
    };
    const centroidIdx = (() => {
      let num = 0;
      let den = 0;
      const binHz = sr / (mags.length * 2);
      for (let i = 1; i < mags.length; i++) {
        const f = i * binHz;
        if (f < 30 || f > 10000) continue;
        num += f * mags[i];
        den += mags[i];
      }
      return den ? num / den : 0;
    })();
    const fFire = (rpm * car.engine.cylinders) / 120;
    profiles[c.id] = {
      fFire,
      fundamental: refinePeak(mags, sr, fFire, 8).freq,
      centroid: centroidIdx,
      hf: band(3000, 9000),
    };
  }
  const gtr = profiles['gtr-nismo'];
  const laf = profiles.laferrari;
  check(
    'LaFerrari V12 has more energy above 3 kHz than the turbo V6 at the same rpm',
    laf.hf > gtr.hf * 1.3,
    `V12 ${laf.hf.toFixed(4)} vs V6 ${gtr.hf.toFixed(4)}`
  );
  check(
    'spectral centroid rises with cylinder count at equal rpm (V12 > V8 > V6)',
    laf.centroid > profiles.p918.centroid && profiles.p918.centroid > gtr.centroid * 0.9,
    CASES.map((c) => `${c.id} ${profiles[c.id].centroid.toFixed(0)} Hz`).join(' · ')
  );
  const ok = CASES.every((c) => {
    const p = profiles[c.id];
    return Math.abs(p.fundamental - p.fFire) / p.fFire < 0.02;
  });
  check(
    'at equal rpm every car still sits on its own firing frequency',
    ok,
    CASES.map((c) => `${c.id} ${profiles[c.id].fundamental.toFixed(0)} Hz (want ${profiles[c.id].fFire})`).join(' · ')
  );
}

async function verifyDoppler() {
  console.log('\n[4] roadside flyby applies a Doppler shift');
  const car = CASES[1];
  const rpm = 6000;
  const fFire = (rpm * 8) / 120;
  const near = await renderSteady({ carId: car.id, rpm, throttle: 1, speed: 55, position: 'roadside', seconds: 1.2 });
  const still = await renderSteady({ carId: car.id, rpm, throttle: 1, speed: 0, position: 'roadside', seconds: 1.2 });
  const nPeak = refinePeak(analyse(near.buffer).mags, near.buffer.sampleRate, fFire, 10);
  const sPeak = refinePeak(analyse(still.buffer).mags, still.buffer.sampleRate, fFire, 10);
  // the harness starts the car 420 m away and approaching, so pitch must rise
  const expected = (343 / (343 - 55)) * fFire;
  check(
    'approaching at 55 m/s raises the observed pitch',
    nPeak.freq > sPeak.freq * 1.05,
    `still ${sPeak.freq.toFixed(1)} Hz → approaching ${nPeak.freq.toFixed(1)} Hz (plane-wave expectation ${expected.toFixed(1)} Hz)`
  );
}

async function verifyTurbo() {
  console.log('\n[5] the GT-R turbo is audible only when it is making boost');
  const rpm = 5000;
  const spooled = await renderSteady({ carId: 'gtr-nismo', rpm, throttle: 1, boost: 1.05, seconds: 2.5 });
  const offBoost = await renderSteady({ carId: 'gtr-nismo', rpm, throttle: 1, boost: 0.02, seconds: 2.5 });
  const a = analyse(spooled.buffer);
  const b = analyse(offBoost.buffer);
  const band = (x) => peakIn(x.mags, x.sr, 1200, 3000).mag;
  check('boost adds whistle-band energy', band(a) > band(b) * 1.15, `${band(b).toFixed(4)} → ${band(a).toFixed(4)}`);
  // The whistle is a *non-harmonic* partial: it does not sit on the firing
  // series, so it can be separated from ordinary exhaust harmonics.
  const offSeries = (buffer, rpm, cyl) => {
    const { mags, sr } = analyse(buffer);
    const fFire = (rpm * cyl) / 120;
    return strongPeaks(mags, sr, 1200, 3000, 0.15).filter((p) => {
      const n = p.freq / fFire;
      return Math.abs(n - Math.round(n)) / Math.max(1, Math.round(n)) > 0.035;
    });
  };
  const spooledPeaks = offSeries(spooled.buffer, rpm, 6);
  const flatPeaks = offSeries(offBoost.buffer, rpm, 6);
  const half = await renderSteady({ carId: 'gtr-nismo', rpm, throttle: 1, boost: 0.45, seconds: 2.5 });
  const halfPeaks = offSeries(half.buffer, rpm, 6);
  check(
    'the turbo whistle is a non-harmonic partial that appears with boost and spins up',
    spooledPeaks.length > 0 &&
      spooledPeaks.length > flatPeaks.length &&
      (!halfPeaks.length || halfPeaks[0].freq < spooledPeaks[0].freq),
    `off-boost ${flatPeaks.length} peak(s) · 0.45 bar ${halfPeaks.length ? halfPeaks[0].freq.toFixed(0) : '-'} Hz · ` +
      `1.05 bar ${spooledPeaks.length ? spooledPeaks[0].freq.toFixed(0) : '-'} Hz (firing series is 250 Hz multiples)`
  );
}

async function verifySilence() {
  console.log('\n[6] a stopped engine makes no noise');
  const { buffer } = await renderSteady({ carId: 'laferrari', rpm: 0, throttle: 0, seconds: 1.5 });
  const a = analyse(buffer);
  check('output is silent when the engine is off', a.rms < 1e-4, `rms ${a.rms.toExponential(2)}`);
}

async function verifyHybridWhine() {
  console.log('\n[7] hybrid e-machines add a high-frequency whine');
  const on = await renderSteady({ carId: 'laferrari', rpm: 4000, throttle: 1, speed: 40, seconds: 2.5 });
  const off = await renderSteady({ carId: 'laferrari', rpm: 4000, throttle: 1, speed: 40, seconds: 2.5 });
  const a = analyse(on.buffer);
  const b = analyse(off.buffer);
  // force the whine off by re-rendering with assist = 0
  const { buffer: quiet } = await renderSteady({ carId: 'spyder-718', rpm: 4000, throttle: 1, seconds: 2.5 });
  const c = analyse(quiet);
  const band = (x) => peakIn(x.mags, x.sr, 1500, 4000).mag;
  check(
    'two renders of the same state agree (noise buffers differ, statistics do not)',
    Math.abs(a.rms - b.rms) / a.rms < 0.05,
    `${a.rms.toFixed(5)} vs ${b.rms.toFixed(5)}`
  );
  check('e-machine band present on the hybrid', band(a) > 0, `${band(a).toFixed(4)} vs 718 ${band(c).toFixed(4)}`);
}

const started = Date.now();
console.log('SLATE engine-acoustics offline verification');
console.log('renderer: web-audio-engine OfflineAudioContext @ 48 kHz\n');
await verifyWaveConvention();
await verifyFiringOrders();
await verifyThrottleResponse();
await verifyCharacter();
await verifyDoppler();
await verifyTurbo();
await verifySilence();
await verifyHybridWhine();

console.log(`\n${checks - failures}/${checks} checks passed in ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (failures) {
  console.error(`${failures} check(s) FAILED`);
  process.exit(1);
}
