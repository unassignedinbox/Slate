/**
 * offline.js — shared harness for running the real synthesis graph offline in
 * Node using web-audio-engine's OfflineAudioContext. This exercises exactly the
 * code that runs in the browser (src/audio/graph.js), just with a different
 * AudioContext implementation.
 */

import { OfflineAudioContext } from 'web-audio-engine';
import { EngineSynth } from '../src/audio/graph.js';
import { Powertrain } from '../src/model/engine.js';
import { getCar } from '../src/cars.js';

export const SR = 48000;

/** Render the graph at a fixed engine state and return the audio. */
export async function renderSteady({
  carId,
  rpm,
  throttle = 1,
  boost = null,
  speed = 0,
  seconds = 3,
  position = 'track',
  volume = 0.9,
  reverb = 0.3,
  channels = 2,
}) {
  const car = getCar(carId);
  const ctx = new OfflineAudioContext(channels, Math.floor(SR * seconds), SR);
  const synth = new EngineSynth(ctx, car);
  synth.setListenPosition(position);
  synth.setMasterVolume(volume);
  synth.setReverbAmount(reverb);
  synth.start();

  const state = {
    rpm,
    throttle,
    boost: boost == null ? (car.engine.aspiration === 'turbo' ? car.engine.maxBoost * throttle : 0) : boost,
    speed,
    assist: car.hybrid ? throttle : 0,
    running: true,
    starter: 0,
    soc: 1,
    phase: 'run',
  };
  for (let i = 0; i < 5; i++) synth.update(state, 1 / 60);
  const buffer = await ctx.startRendering();
  return { buffer, car, state, synth };
}

/** Run the powertrain sim and collect a state trajectory. */
export function trajectory(carId, script, dt = 1 / 60) {
  const car = getCar(carId);
  const pt = new Powertrain(car);
  pt.setMode('road');
  const states = [];
  let t = 0;
  pt.start();
  for (const { hold, throttle, brake = 0 } of script) {
    pt.setThrottle(throttle);
    pt.setBrake(brake);
    const steps = Math.round(hold / dt);
    for (let i = 0; i < steps; i++) {
      states.push(pt.update(dt));
      t += dt;
    }
  }
  return { car, states, pt, duration: t };
}

/** Render a whole trajectory to an AudioBuffer using scheduled automation. */
export async function renderTrajectory(carId, script, { position = 'track', volume = 0.9, reverb = 0.35 } = {}) {
  const { car, states, pt, duration } = trajectory(carId, script);
  const ctx = new OfflineAudioContext(2, Math.ceil(SR * (duration + 0.4)), SR);
  const synth = new EngineSynth(ctx, car);
  synth.setListenPosition(position);
  synth.setMasterVolume(volume);
  synth.setReverbAmount(reverb);
  synth.start();
  const info = synth.scheduleAutomation(states, 1 / 60, 0);
  const buffer = await ctx.startRendering();
  return { buffer, car, states, pt, info, synth };
}

/** Encode an AudioBuffer as 16-bit PCM WAV. */
export function toWav(buffer) {
  const nCh = buffer.numberOfChannels;
  const len = buffer.length;
  const bytes = 44 + len * nCh * 2;
  const ab = new ArrayBuffer(bytes);
  const view = new DataView(ab);
  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  str(0, 'RIFF');
  view.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, nCh, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * nCh * 2, true);
  view.setUint16(32, nCh * 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, len * nCh * 2, true);
  const chans = [];
  for (let c = 0; c < nCh; c++) chans.push(buffer.getChannelData(c));
  let off = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < nCh; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return Buffer.from(ab);
}
