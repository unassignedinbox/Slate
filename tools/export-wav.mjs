/**
 * export-wav.mjs — renders each car through the real synthesis graph and writes
 * a WAV file, so the output can be auditioned outside the browser.
 *
 * Each file is a scripted run: crank, idle, then a full-throttle pull to the
 * rev limiter, a lift, and a second pull. The physics is simulated first and the
 * whole parameter trajectory is scheduled into one OfflineAudioContext, so the
 * result is sample-accurate and free of chunk seams.
 *
 * Usage: npm run export
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { renderTrajectory, toWav } from './offline.js';
import { CARS } from '../src/cars.js';
import { magnitudeSpectrum, refinePeak } from './fft.js';

const OUT = new URL('../renders/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const SCRIPT = [
  { hold: 1.4, throttle: 0 }, // crank + catch
  { hold: 1.2, throttle: 0.12 }, // settle / fast idle
  { hold: 5.0, throttle: 1 }, // full-throttle pull
  { hold: 0.9, throttle: 0 }, // lift (overrun)
  { hold: 3.0, throttle: 1 }, // second pull
  { hold: 1.5, throttle: 0 }, // lift out
];

let total = 0;
for (const car of CARS) {
  const t0 = Date.now();
  const { buffer, states, info } = await renderTrajectory(car.id, SCRIPT, { position: 'track' });
  const wav = toWav(buffer);
  const file = `${OUT}${car.id}-pull.wav`;
  writeFileSync(file, wav);
  total += wav.length;

  // measure what we just rendered: does the loudest partial near the expected
  // pitch actually sit on the engine's firing frequency?
  const sr = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const win = Math.floor(sr * 0.4);
  const trail = [];
  for (let i = 0; i + win < data.length; i += Math.floor(sr * 0.4)) {
    const idx = Math.min(states.length - 1, Math.floor((i / sr) * 60));
    const st = states[idx];
    const expected = (st.rpm * car.engine.cylinders) / 120;
    if (expected < 60 || st.rpm < 700) continue; // cranking/idle windows are not pitched
    // Only quasi-steady windows are measurable: during a shift or a fast sweep a
    // 0.4 s analysis window legitimately smears across a wide frequency range.
    const later = states[Math.min(states.length - 1, idx + 24)];
    const sweep = Math.abs(later.rpm - st.rpm) / 0.4; // rpm per second
    if (sweep > 900) continue;
    const mags = magnitudeSpectrum(data.subarray(i, i + win));
    const binHz = sr / (mags.length * 2);
    const span = Math.max(4, Math.ceil((expected * 0.06) / binHz));
    const peak = refinePeak(mags, sr, expected, span);
    trail.push({ at: (i / sr) | 0, rpm: st.rpm, expected, measured: peak.freq });
  }
  const errs = trail.map((t) => Math.abs(t.measured - t.expected) / t.expected);
  const worst = Math.max(...errs);
  const mean = errs.reduce((a, b) => a + b, 0) / errs.length;
  const within1 = errs.filter((x) => x < 0.01).length;

  console.log(
    `${car.id.padEnd(12)} ${(wav.length / 1048576).toFixed(1)} MB  ` +
      `${(buffer.length / sr).toFixed(1)} s  peak rpm ${Math.max(...states.map((s) => s.rpm)).toFixed(0)}  ` +
      `gear ${Math.max(...states.map((s) => s.gear))}  ${((Date.now() - t0) / 1000).toFixed(1)} s to render`
  );
  console.log(
    `             dominant partial vs firing frequency over ${trail.length} windows: ` +
      `mean error ${(mean * 100).toFixed(2)}%, worst ${(worst * 100).toFixed(2)}%, ` +
      `${within1}/${trail.length} within 1%`
  );
}
console.log(`\nwrote ${(total / 1048576).toFixed(1)} MB to renders/`);
