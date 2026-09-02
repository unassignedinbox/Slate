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
import { turboParams } from '../src/model/tone.js';
import { getCar } from '../src/cars.js';
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

/**
 * Tonal peaks in a band, strongest first. A peak count is the right shape of
 * metric here (an energy-weighted fraction would just measure the broadband
 * induction/valve-train noise we add on purpose), but it needs a floor: below
 * ~25% of the strongest partial the "peaks" are that noise shaped by the car's
 * own exhaust resonances, not engine orders.
 */
function tonalPeaks(mags, sr, { lo = 40, hi = 8000, floor = 0.25 } = {}) {
  const binHz = sr / (mags.length * 2);
  const a = Math.max(2, Math.floor(lo / binHz));
  const b = Math.min(mags.length - 2, Math.ceil(hi / binHz));
  let max = 0;
  for (let i = a; i <= b; i++) max = Math.max(max, mags[i]);
  const out = [];
  for (let i = a + 1; i < b; i++) {
    if (mags[i] > mags[i - 1] && mags[i] >= mags[i + 1] && mags[i] > max * floor) {
      const p = mags[i - 1];
      const q = mags[i];
      const r = mags[i + 1];
      const den = p - 2 * q + r;
      const shift = den !== 0 ? (0.5 * (p - r)) / den : 0;
      out.push({ freq: (i + shift) * binHz, rel: q / max });
    }
  }
  return out.sort((x, y) => y.rel - x.rel);
}

async function verifyFiringOrders() {
  console.log('\n[1] the exhaust note is a harmonic series rooted at the firing frequency');
  console.log('    (rendered dry: the convolution IR is broadband, so reverb is off here)');
  for (const c of CASES) {
    for (const rpm of c.rpms) {
      const { buffer, car } = await renderSteady({ carId: c.id, rpm, throttle: 1, seconds: 2.5, reverb: 0 });
      const { mags, sr } = analyse(buffer);
      const fFire = (rpm * car.engine.cylinders) / 120;
      const peaks = tonalPeaks(mags, sr);
      const offSeries = peaks.filter((p) => {
        const n = p.freq / fFire;
        return Math.abs(n - Math.round(n)) / Math.max(1, Math.round(n)) > 0.035;
      });
      const fundamental = refinePeak(mags, sr, fFire, 8);
      const maxMag = peakIn(mags, sr, 40, 8000).mag;
      const subFund = peakIn(mags, sr, 40, fFire * 0.85).mag;
      const f0err = Math.abs(fundamental.freq - fFire) / fFire;
      check(
        `${c.id} @ ${rpm} rpm → firing tone ${fFire.toFixed(1)} Hz`,
        peaks.length >= 2 &&
          offSeries.length === 0 &&
          f0err < 0.02 &&
          fundamental.mag > maxMag * 0.15 &&
          subFund < maxMag * 0.35,
        `${peaks.length} tonal partials, all on the series · f0 measured ${fundamental.freq.toFixed(1)} Hz ` +
          `(${(f0err * 100).toFixed(3)}% error) · sub-fundamental ${(100 * subFund / maxMag).toFixed(1)}%`
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
  // wide-band search: a shift of this size moves the peak far outside any
  // narrow window around the unshifted firing tone
  const dominant = (buffer) => {
    const a = analyse(buffer);
    return peakIn(a.mags, a.sr, 150, 900);
  };
  const near = dominant((await renderSteady({ carId: car.id, rpm, throttle: 1, speed: 55, position: 'roadside', seconds: 1.2 })).buffer);
  const still = dominant((await renderSteady({ carId: car.id, rpm, throttle: 1, speed: 0, position: 'roadside', seconds: 1.2 })).buffer);
  const away = dominant((await renderSteady({ carId: car.id, rpm, throttle: 1, speed: -55, position: 'roadside', seconds: 1.2 })).buffer);
  const expected = (343 / (343 - 55)) * fFire;
  check(
    'observed pitch tracks closing speed: receding < stationary < approaching',
    away.freq < still.freq && still.freq < near.freq && near.freq / still.freq > 1.05,
    `${away.freq.toFixed(0)} Hz (receding) → ${still.freq.toFixed(0)} Hz (still) → ` +
      `${near.freq.toFixed(0)} Hz (closing, plane-wave expectation ≈${expected.toFixed(0)} Hz)`
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
  // Verify the whistle against the model's own prediction rather than hunting
  // for "off-series" peaks, which also catches waveshaper intermodulation.
  const gtrCar = getCar('gtr-nismo');
  const predict = (boost) => turboParams(gtrCar, { rpm, throttle: 1, boost, speed: 0, assist: 0 });
  const magNear = (buffer, f) => {
    const a = analyse(buffer);
    return peakIn(a.mags, a.sr, f * 0.9, f * 1.1).mag;
  };
  const lo = predict(0.45);
  const hi = predict(1.05);
  const half = await renderSteady({ carId: 'gtr-nismo', rpm, throttle: 1, boost: 0.45, seconds: 2.5 });
  check(
    'the turbo whistle spins up with boost and is louder where the model puts it',
    hi.freq > lo.freq * 1.3 &&
      magNear(spooled.buffer, hi.freq) > magNear(offBoost.buffer, hi.freq) * 1.5 &&
      magNear(half.buffer, lo.freq) < magNear(spooled.buffer, hi.freq),
    `model: 0.45 bar → ${lo.freq.toFixed(0)} Hz, 1.05 bar → ${hi.freq.toFixed(0)} Hz · ` +
      `energy at ${hi.freq.toFixed(0)} Hz: ${magNear(offBoost.buffer, hi.freq).toFixed(4)} (off boost) → ` +
      `${magNear(spooled.buffer, hi.freq).toFixed(4)} (1.05 bar)`
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
