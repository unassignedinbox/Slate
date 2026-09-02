/**
 * graph.js — the Web Audio synthesis graph.
 *
 * Signal flow
 * -----------
 *   48 phase-coherent oscillators (harmonics of the 720° firing cycle)
 *      → saturation waveshaper → exhaust EQ → engine bus
 *   amplitude-modulated pink noise (exhaust turbulence, top-end shimmer)
 *   band-passed induction noise, valve-train hiss, turbo whine / wastegate,
 *   e-machine whine, overrun crackles, road+wind noise, starter whir
 *      → engine bus → listen-position filters → dry + convolution reverb
 *      → master → limiter → destination / analyser
 *
 * The constructor takes an AudioContext-like object, so the exact same code runs
 * in a browser (real AudioContext) and in Node (web-audio-engine
 * OfflineAudioContext) — tools/render-check.mjs relies on that.
 */

import { firingSpectrum } from '../model/firing.js';
import { computeTone, pulseResponse, clamp } from '../model/tone.js';
import {
  createNoiseBuffer,
  createImpulseResponse,
  createCrackleBuffer,
  createStarterBuffer,
  saturationCurve,
} from './buffers.js';

const HARMONIC_COUNT = 48;
const PULSE_HARMONICS = 24;
const SPEED_OF_SOUND = 343;

export const LISTEN_POSITIONS = {
  cockpit: { lpf: 2600, hpf: 45, reverb: 0.2, gain: 1.0, mechBoost: 0.4, doppler: false, boom: { f: 88, gain: 6, q: 1.3 } },
  hood: { lpf: 9500, hpf: 60, reverb: 0.06, gain: 1.05, mechBoost: 2.6, doppler: false, boom: { f: 260, gain: 2.5, q: 1.0 } },
  track: { lpf: 16000, hpf: 30, reverb: 0.42, gain: 0.9, mechBoost: 0, doppler: false, boom: null },
  roadside: { lpf: 14000, hpf: 25, reverb: 0.5, gain: 1.0, mechBoost: 0, doppler: true, boom: null },
};

export class EngineSynth {
  constructor(ctx, car, options = {}) {
    this.ctx = ctx;
    this.car = car;
    this.options = options;
    this.started = false;
    this.muted = false;
    this._freqScale = 1;
    this._roadX = -420;
    this._nextCrackle = 0;
    this._pulseLoad = -1;
    this._driveStep = -1;
    this._lastThrottle = 0;
    this._lastBoost = 0;
    this.reverbTrim = 1;
    this.position = LISTEN_POSITIONS.cockpit;

    this._build();
  }

  /* ------------------------------------------------------------- build */

  _build() {
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.9;

    this.limiter = ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -6;
    this.limiter.knee.value = 3;
    this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.002;
    this.limiter.release.value = 0.18;

    this.analyser = ctx.createAnalyser ? ctx.createAnalyser() : null;
    if (this.analyser) {
      this.analyser.fftSize = 4096;
      this.analyser.smoothingTimeConstant = 0.6;
    }

    this.engineBus = ctx.createGain();
    this.engineBus.gain.value = 1;

    // --- listen-position chain -------------------------------------------
    this.posHPF = ctx.createBiquadFilter();
    this.posHPF.type = 'highpass';
    this.posLPF = ctx.createBiquadFilter();
    this.posLPF.type = 'lowpass';
    this.posBoom = ctx.createBiquadFilter();
    this.posBoom.type = 'peaking';
    this.posBoom.Q.value = 1.3;
    this.posBoom.gain.value = 0;
    this.posGain = ctx.createGain();

    this.dry = ctx.createGain();
    this.dry.gain.value = 1;
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.2;
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = createImpulseResponse(ctx, { seconds: 1.8, decay: 2.8, level: 0.3 });

    this.propDelay = ctx.createDelay(1.0);
    this.propDelay.delayTime.value = 0;
    this.propGain = ctx.createGain();
    this.propGain.gain.value = 1;

    this.engineBus.connect(this.propDelay);
    this.propDelay.connect(this.propGain);
    this.propGain.connect(this.posHPF);
    this.posHPF.connect(this.posLPF);
    this.posLPF.connect(this.posBoom);
    this.posBoom.connect(this.posGain);
    this.posGain.connect(this.dry);
    this.posGain.connect(this.convolver);
    this.convolver.connect(this.wet);
    this.dry.connect(this.master);
    this.wet.connect(this.master);
    this.master.connect(this.limiter);
    this.limiter.connect(ctx.destination);
    if (this.analyser) this.limiter.connect(this.analyser);

    // --- harmonic oscillator bank ---------------------------------------
    this.exhaustIn = ctx.createGain();
    this.exhaustIn.gain.value = 1;
    this.preGain = ctx.createGain();
    this.preGain.gain.value = 0.9;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = saturationCurve(1.5);
    this.shaper.oversample = '2x';
    this.postGain = ctx.createGain();
    this.postGain.gain.value = 0.4;
    this.eq = (this.car.tone.eq || []).map((s) => {
      const f = ctx.createBiquadFilter();
      f.type = s.type;
      f.frequency.value = s.f;
      f.Q.value = s.q;
      f.gain.value = s.gain;
      return f;
    });
    this.exhaustIn.connect(this.preGain);
    this.preGain.connect(this.shaper);
    this.shaper.connect(this.postGain);
    let tail = this.postGain;
    for (const f of this.eq) {
      tail.connect(f);
      tail = f;
    }
    tail.connect(this.engineBus);

    const spec = firingSpectrum(
      this.car.engine.firingPhases,
      this.car.engine.cylinderWeights,
      HARMONIC_COUNT
    );
    this.oscBank = [];
    for (let i = 0; i < HARMONIC_COUNT; i++) {
      const ph = spec[i].phase;
      const real = new Float32Array([0, Math.sin(ph)]);
      const imag = new Float32Array([0, Math.cos(ph)]);
      const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: true });
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.frequency.value = 40 + i * 10;
      const g = ctx.createGain();
      g.gain.value = 0;
      const p = ctx.createStereoPanner();
      p.pan.value = i < 4 ? 0.08 * (i % 2 ? 1 : -1) : 0.3 * (i % 2 ? 1 : -1);
      osc.connect(g);
      g.connect(p);
      p.connect(this.exhaustIn);
      this.oscBank.push({ osc, gain: g, lastGain: -1, lastFreq: -1, freq: osc.frequency.value });
    }

    // --- noise sources ---------------------------------------------------
    this.noisePink = ctx.createBufferSource();
    this.noisePink.buffer = createNoiseBuffer(ctx, { seconds: 2.5, pink: true });
    this.noisePink.loop = true;
    this.noiseWhite = ctx.createBufferSource();
    this.noiseWhite.buffer = createNoiseBuffer(ctx, { seconds: 1.5, pink: false });
    this.noiseWhite.loop = true;

    // exhaust turbulence: noise AM'd by the exhaust pulse train
    this.pulseOsc = ctx.createOscillator();
    this.pulseOsc.setPeriodicWave(this._buildPulseWave(0.4, 300));
    this.pulseScale = ctx.createGain();
    this.pulseScale.gain.value = 0.45;
    this.pulseOsc.connect(this.pulseScale);

    this.turbFilter = ctx.createBiquadFilter();
    this.turbFilter.type = 'bandpass';
    this.turbFilter.frequency.value = 700;
    this.turbFilter.Q.value = 0.7;
    this.turbGain = ctx.createGain();
    this.turbGain.gain.value = 0.5;
    // Gate nodes are needed because the AM signal is *summed into* the gain
    // AudioParam: setting turbGain.gain to 0 would still let ±depth through.
    this.turbGate = ctx.createGain();
    this.turbGate.gain.value = 0;
    this.pulseScale.connect(this.turbGain.gain);
    this.noisePink.connect(this.turbFilter);
    this.turbFilter.connect(this.turbGain);
    this.turbGain.connect(this.turbGate);
    this.turbGate.connect(this.exhaustIn);

    // induction
    this.indFilter = ctx.createBiquadFilter();
    this.indFilter.type = 'bandpass';
    this.indFilter.frequency.value = 500;
    this.indFilter.Q.value = 1.2;
    this.indGain = ctx.createGain();
    this.indGain.gain.value = 0;
    this.noisePink.connect(this.indFilter);
    this.indFilter.connect(this.indGain);
    this.indGain.connect(this.engineBus);

    // valve train / mechanical
    this.mechFilter = ctx.createBiquadFilter();
    this.mechFilter.type = 'highpass';
    this.mechFilter.frequency.value = 2800;
    this.mechGain = ctx.createGain();
    this.mechGain.gain.value = 0;
    this.noiseWhite.connect(this.mechFilter);
    this.mechFilter.connect(this.mechGain);
    this.mechGain.connect(this.engineBus);

    // top-end shimmer: noise AM'd at the firing rate
    this.topMod = ctx.createGain();
    this.topMod.gain.value = 0.5;
    this.topGain = ctx.createGain();
    this.topGain.gain.value = 0.5;
    this.topGate = ctx.createGain();
    this.topGate.gain.value = 0;
    this.topFilter = ctx.createBiquadFilter();
    this.topFilter.type = 'bandpass';
    this.topFilter.frequency.value = 3000;
    this.topFilter.Q.value = 0.9;
    this.pulseOsc.connect(this.topMod);
    this.topMod.connect(this.topGain.gain);
    this.noiseWhite.connect(this.topFilter);
    this.topFilter.connect(this.topGain);
    this.topGain.connect(this.topGate);
    this.topGate.connect(this.engineBus);

    // --- turbo ------------------------------------------------------------
    const turboSpec = this.car.tone.turbo;
    this.turboBus = ctx.createGain();
    this.turboBus.gain.value = 1;
    this.turboBus.connect(this.engineBus);
    this.turbos = [];
    if (turboSpec) {
      for (let i = 0; i < turboSpec.turbos; i++) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 600;
        o.detune.value = (i - (turboSpec.turbos - 1) / 2) * turboSpec.detuneCents;
        const g = ctx.createGain();
        g.gain.value = 0;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = 1200;
        bp.Q.value = 2.5;
        o.connect(bp);
        bp.connect(g);
        g.connect(this.turboBus);
        this.turbos.push({ osc: o, gain: g, filter: bp });
      }
      // wastegate rattle
      this.wgFilter = ctx.createBiquadFilter();
      this.wgFilter.type = 'bandpass';
      this.wgFilter.frequency.value = turboSpec.wastegateHz;
      this.wgFilter.Q.value = 9;
      this.wgGain = ctx.createGain();
      this.wgGain.gain.value = 0;
      this.noiseWhite.connect(this.wgFilter);
      this.wgFilter.connect(this.wgGain);
      this.wgGain.connect(this.turboBus);
      this.crackleBuf = createCrackleBuffer(ctx, { ms: 90, seed: 7 });
    } else {
      this.crackleBuf = createCrackleBuffer(ctx, { ms: 26, seed: 7 });
    }

    // --- hybrid e-machines ------------------------------------------------
    this.electric = [];
    if (this.car.tone.electric) {
      this.electricBus = ctx.createGain();
      this.electricBus.gain.value = 1;
      this.electricBus.connect(this.engineBus);
      for (let h = 1; h <= this.car.tone.electric.harmonics; h++) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = 400 * h;
        const g = ctx.createGain();
        g.gain.value = 0;
        o.connect(g);
        g.connect(this.electricBus);
        this.electric.push({ osc: o, gain: g, h });
      }
    }

    // --- road + wind ------------------------------------------------------
    this.roadFilter = ctx.createBiquadFilter();
    this.roadFilter.type = 'lowpass';
    this.roadFilter.frequency.value = 400;
    this.roadGain = ctx.createGain();
    this.roadGain.gain.value = 0;
    this.noisePink.connect(this.roadFilter);
    this.roadFilter.connect(this.roadGain);
    this.roadGain.connect(this.engineBus);

    // --- starter ----------------------------------------------------------
    this.starterSrc = ctx.createBufferSource();
    this.starterSrc.buffer = createStarterBuffer(ctx);
    this.starterSrc.loop = true;
    this.starterGain = ctx.createGain();
    this.starterGain.gain.value = 0;
    this.starterSrc.connect(this.starterGain);
    this.starterGain.connect(this.engineBus);

    // --- crackles ---------------------------------------------------------
    this.crackleGain = ctx.createGain();
    this.crackleGain.gain.value = 1;
    this.crackleFilter = ctx.createBiquadFilter();
    this.crackleFilter.type = 'bandpass';
    this.crackleFilter.frequency.value = 2400;
    this.crackleFilter.Q.value = 1.1;
    this.crackleFilter.connect(this.crackleGain);
    this.crackleGain.connect(this.engineBus);
  }

  /** Periodic waveform of one cylinder-bank exhaust pulse train. */
  _buildPulseWave(load, rpm) {
    const ctx = this.ctx;
    const tone = this.car.tone;
    const K = PULSE_HARMONICS;
    const spec = firingSpectrum(this.car.engine.firingPhases, this.car.engine.cylinderWeights, K);
    const cutoff = 170 + (tone.pulse.cutoffFull - tone.pulse.cutoffIdle) * load;
    const real = new Float32Array(K + 1);
    const imag = new Float32Array(K + 1);
    let peak = 0;
    const N = 256;
    for (let n = 0; n < N; n++) {
      const th = (2 * Math.PI * n) / N;
      let v = 0;
      for (let k = 1; k <= K; k++) {
        const freq = (k * Math.max(rpm, 400)) / 120;
        const mag = spec[k - 1].mag * pulseResponse(freq, cutoff, tone.pulse.alpha);
        v += mag * Math.sin(k * th + spec[k - 1].phase);
      }
      peak = Math.max(peak, Math.abs(v));
    }
    const scale = peak > 0 ? 0.95 / peak : 0;
    for (let k = 1; k <= K; k++) {
      const freq = (k * Math.max(rpm, 400)) / 120;
      const mag = spec[k - 1].mag * pulseResponse(freq, cutoff, tone.pulse.alpha) * scale;
      real[k] = mag * Math.sin(spec[k - 1].phase);
      imag[k] = mag * Math.cos(spec[k - 1].phase);
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: true });
  }

  /* ------------------------------------------------------------- control */

  start() {
    if (this.started) return;
    const t = this.ctx.currentTime;
    for (const h of this.oscBank) h.osc.start(t);
    this.pulseOsc.start(t);
    this.noisePink.start(t);
    this.noiseWhite.start(t);
    this.starterSrc.start(t);
    for (const tr of this.turbos) tr.osc.start(t);
    for (const e of this.electric) e.osc.start(t);
    this.started = true;
  }

  stop() {
    if (!this.started) return;
    const t = this.ctx.currentTime;
    const stopAt = t + 0.05;
    for (const h of this.oscBank) h.osc.stop(stopAt);
    this.pulseOsc.stop(stopAt);
    this.noisePink.stop(stopAt);
    this.noiseWhite.stop(stopAt);
    this.starterSrc.stop(stopAt);
    for (const tr of this.turbos) tr.osc.stop(stopAt);
    for (const e of this.electric) e.osc.stop(stopAt);
    this.started = false;
  }

  setListenPosition(pos) {
    const p = LISTEN_POSITIONS[pos] || LISTEN_POSITIONS.cockpit;
    const t = this.ctx.currentTime;
    this.position = p;
    this.positionName = pos;
    this.posHPF.frequency.setTargetAtTime(p.hpf, t, 0.02);
    this.posLPF.frequency.setTargetAtTime(p.lpf, t, 0.02);
    this.posBoom.frequency.value = p.boom ? p.boom.f : 1000;
    this.posBoom.Q.value = p.boom ? p.boom.q : 0.7;
    this.posBoom.gain.setTargetAtTime(p.boom ? p.boom.gain : 0, t, 0.02);
    this.wet.gain.setTargetAtTime(p.reverb * this.reverbTrim * 2, t, 0.05);
    this.dry.gain.setTargetAtTime(1 - 0.4 * p.reverb * this.reverbTrim * 2, t, 0.05);
    this.posGain.gain.setTargetAtTime(p.gain, t, 0.02);
  }

  setMasterVolume(v) {
    this.master.gain.setTargetAtTime(clamp(v, 0, 1.5), this.ctx.currentTime, 0.02);
  }

  /** Extra wet/dry control on top of the listen-position preset. */
  setReverbAmount(v) {
    this.reverbTrim = clamp(v, 0, 1);
    const p = this.position || LISTEN_POSITIONS.cockpit;
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(p.reverb * this.reverbTrim * 2, t, 0.05);
    this.dry.gain.setTargetAtTime(1 - 0.4 * p.reverb * this.reverbTrim * 2, t, 0.05);
  }

  /** Route the post-limiter signal somewhere else (recorder, extra analysers…). */
  tap(node) {
    this.limiter.connect(node);
    return node;
  }

  /* -------------------------------------------------------------- update */

  update(state, dt = 1 / 60) {
    if (!this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const car = this.car;
    const tone = computeTone(car, state);
    const on = state.running && state.rpm > 30;

    /* --- Doppler / distance for the roadside position --- */
    let freqScale = 1;
    let distanceGain = 1;
    if (this.position && this.position.doppler) {
      this._roadX += state.speed * dt;
      if (this._roadX > 620) this._roadX = -620;
      const off = 9;
      const dist = Math.hypot(this._roadX, off);
      const vRadial = dist > 0.01 ? (state.speed * this._roadX) / dist : 0;
      freqScale = SPEED_OF_SOUND / (SPEED_OF_SOUND + vRadial);
      distanceGain = clamp(4.2 / (dist * 0.35 + 1), 0.03, 1.25);
      this.propDelay.delayTime.setTargetAtTime(Math.min(dist / SPEED_OF_SOUND, 0.9), t, 0.02);
    } else {
      this.propDelay.delayTime.setTargetAtTime(0, t, 0.01);
    }
    this._freqScale = freqScale;
    this.propGain.gain.setTargetAtTime(distanceGain, t, 0.03);

    /* --- harmonic bank --- */
    const bankLevel = on ? 1 : 0;
    const harmonics = tone.harmonics;
    for (let i = 0; i < this.oscBank.length; i++) {
      const h = this.oscBank[i];
      const target = harmonics[i];
      const gain = (target ? target.gain : 0) * bankLevel;
      const freq = target ? target.freq * freqScale : h.freq;
      if (Math.abs(gain - h.lastGain) > 1e-4) {
        h.gain.gain.setTargetAtTime(gain, t, 0.025);
        h.lastGain = gain;
      }
      if (freq > 0 && Math.abs(freq - h.lastFreq) / Math.max(freq, 1) > 2e-3) {
        h.osc.frequency.setTargetAtTime(freq, t, 0.008);
        h.lastFreq = freq;
        h.freq = freq;
      }
    }

    /* --- pulse wave refresh (shape tracks load) --- */
    const loadKey = Math.round(tone.load * 8) + Math.round(state.rpm / 900);
    if (loadKey !== this._pulseLoad) {
      this._pulseLoad = loadKey;
      this.pulseOsc.setPeriodicWave(this._buildPulseWave(tone.load, state.rpm));
    }
    const fFire = (state.rpm * car.engine.cylinders) / 120 * freqScale;
    this.pulseOsc.frequency.setTargetAtTime(Math.max(fFire, 1), t, 0.01);

    /* --- turbulence / induction / mechanical / shimmer --- */
    this.turbGate.gain.setTargetAtTime(on ? 0.1 + 0.22 * tone.load : 0, t, 0.05);
    this.turbFilter.frequency.setTargetAtTime(clamp(280 + 2400 * tone.load + state.rpm * 0.05, 120, 4000), t, 0.05);
    this.indGain.gain.setTargetAtTime(on ? tone.induction.gain : 0, t, 0.04);
    this.indFilter.frequency.setTargetAtTime(clamp(tone.induction.freq * freqScale, 80, 6000), t, 0.04);
    this.mechGain.gain.setTargetAtTime(
      on ? tone.mechanical.gain * (1 + (this.position ? this.position.mechBoost : 0)) : 0,
      t, 0.06
    );
    this.topGate.gain.setTargetAtTime(on ? tone.topEnd.gain * 0.35 : 0, t, 0.05);
    this.topFilter.frequency.setTargetAtTime(clamp(tone.topEnd.center * freqScale, 200, 14000), t, 0.05);

    /* --- turbo --- */
    if (tone.turbo && this.turbos.length) {
      for (let i = 0; i < this.turbos.length; i++) {
        const tr = this.turbos[i];
        tr.gain.gain.setTargetAtTime(on ? tone.turbo.gain / this.turbos.length : 0, t, 0.08);
        tr.osc.frequency.setTargetAtTime(clamp(tone.turbo.freq * (1 + i * 0.04) * freqScale, 60, 6000), t, 0.08);
        tr.filter.frequency.setTargetAtTime(clamp(tone.turbo.freq * 2.1 * freqScale, 200, 9000), t, 0.08);
      }
      this.wgGain.gain.setTargetAtTime(on ? tone.turbo.wastegate : 0, t, 0.05);
    }

    /* --- hybrid e-machines --- */
    if (tone.electric && this.electric.length) {
      for (const e of this.electric) {
        e.gain.gain.setTargetAtTime(
          state.running || state.speed > 0.2 ? (tone.electric.gain / e.h) * 0.7 : 0,
          t, 0.08
        );
        e.osc.frequency.setTargetAtTime(clamp(tone.electric.freq * e.h * freqScale, 20, 12000), t, 0.06);
      }
    }

    /* --- road + wind --- */
    const roadOn = this.position && !this.position.doppler;
    this.roadGain.gain.setTargetAtTime(roadOn ? tone.road.gain : 0, t, 0.1);
    this.roadFilter.frequency.setTargetAtTime(clamp(250 + state.speed * 12, 150, 2500), t, 0.1);

    /* --- starter --- */
    this.starterGain.gain.setTargetAtTime(state.starter > 0.5 ? 0.5 : 0, t, 0.02);

    /* --- saturation --- */
    const drive = on ? tone.saturation.drive : 0.6;
    const step = Math.round(drive * 4);
    if (step !== this._driveStep) {
      this._driveStep = step;
      this.shaper.curve = saturationCurve(step / 4);
    }

    /* --- overrun crackles --- */
    this.crackleFilter.frequency.setTargetAtTime(
      clamp((tone.crackle.center || 2400) * freqScale, 200, 9000), t, 0.1
    );
    if (on && tone.crackle.rate > 0.2) {
      const now = ctx.currentTime;
      if (this._nextCrackle < now) this._nextCrackle = now + 0.01;
      let guard = 0;
      while (this._nextCrackle < now + 0.12 && guard++ < 12) {
        this._scheduleCrackle(this._nextCrackle, tone.crackle.gain * (0.5 + Math.random() * 0.8));
        this._nextCrackle += (1 / tone.crackle.rate) * (0.35 + Math.random() * 1.5);
      }
    }

    /* --- blow-off valve on lift --- */
    if (tone.turbo) {
      const lift = this._lastThrottle > 0.45 && state.throttle < 0.12 && state.boost > 0.3 && state.rpm > 2800;
      if (lift) this.triggerBOV(state.boost);
    }
    this._lastThrottle = state.throttle;
    this._lastBoost = state.boost;
  }

  /**
   * Offline export: instead of chasing the state in real time, schedule the whole
   * trajectory of every parameter up front with setValueCurveAtTime. Used by
   * tools/export-wav.mjs to write sample-accurate WAV files of a run.
   */
  scheduleAutomation(states, dt, t0 = 0) {
    if (states.length < 2) throw new Error('need at least two states');
    const dur = states.length * dt;
    const curve = (param, values) => {
      const arr = new Float32Array(values.length);
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        arr[i] = Number.isFinite(v) ? v : 0;
      }
      param.setValueCurveAtTime(arr, t0, dur);
    };
    const tones = states.map((s) => computeTone(this.car, s));
    const K = this.oscBank.length;

    for (let k = 0; k < K; k++) {
      curve(this.oscBank[k].osc.frequency, tones.map((t) => (t.harmonics[k] ? t.harmonics[k].freq : 40)));
      curve(this.oscBank[k].gain.gain, tones.map((t) => (t.harmonics[k] ? t.harmonics[k].gain : 0)));
    }
    curve(this.pulseOsc.frequency, states.map((s) => Math.max((s.rpm * this.car.engine.cylinders) / 120, 1)));
    curve(this.turbGate.gain, tones.map((t) => (t.harmonics[0] && states[0].rpm > 30 ? 0.1 + 0.22 * t.load : 0)));
    curve(this.turbFilter.frequency, tones.map((t) => clamp(280 + 2400 * t.load, 120, 4000)));
    curve(this.indGain.gain, tones.map((t) => t.induction.gain));
    curve(this.indFilter.frequency, tones.map((t) => clamp(t.induction.freq, 80, 6000)));
    curve(this.mechGain.gain, tones.map((t) => t.mechanical.gain));
    curve(this.topGate.gain, tones.map((t) => t.topEnd.gain * 0.35));
    curve(this.topFilter.frequency, tones.map((t) => clamp(t.topEnd.center, 200, 14000)));

    if (this.turbos.length) {
      for (let i = 0; i < this.turbos.length; i++) {
        curve(this.turbos[i].gain.gain, tones.map((t) => (t.turbo ? t.turbo.gain / this.turbos.length : 0)));
        curve(this.turbos[i].osc.frequency, tones.map((t) => (t.turbo ? clamp(t.turbo.freq * (1 + i * 0.04), 60, 6000) : 60)));
        curve(this.turbos[i].filter.frequency, tones.map((t) => (t.turbo ? clamp(t.turbo.freq * 2.1, 200, 9000) : 200)));
      }
      curve(this.wgGain.gain, tones.map((t) => (t.turbo ? t.turbo.wastegate : 0)));
    }
    if (this.electric.length) {
      for (const e of this.electric) {
        curve(e.gain.gain, tones.map((t) => (t.electric ? (t.electric.gain / e.h) * 0.7 : 0)));
        curve(e.osc.frequency, tones.map((t) => (t.electric ? clamp(t.electric.freq * e.h, 20, 12000) : 20)));
      }
    }
    curve(this.roadGain.gain, tones.map((t) => t.road.gain));
    curve(this.roadFilter.frequency, states.map((s) => clamp(250 + s.speed * 12, 150, 2500)));
    curve(this.starterGain.gain, states.map((s) => (s.starter > 0.5 ? 0.5 : 0)));

    const meanLoad = tones.reduce((a, t) => a + t.load, 0) / tones.length;
    const meanDrive = this.car.tone.saturation.driveIdle + (this.car.tone.saturation.driveFull - this.car.tone.saturation.driveIdle) * meanLoad;
    this.shaper.curve = saturationCurve(meanDrive);
    this.pulseOsc.setPeriodicWave(this._buildPulseWave(meanLoad, states[states.length - 1].rpm));
    return { duration: dur, meanLoad, meanDrive };
  }

  _scheduleCrackle(when, gain) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.crackleBuf;
    src.playbackRate.value = 0.7 + Math.random() * 1.1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, when);
    g.gain.exponentialRampToValueAtTime(0.0008, when + this.crackleBuf.duration);
    src.connect(g);
    g.connect(this.crackleFilter);
    src.start(when);
    src.stop(when + this.crackleBuf.duration + 0.01);
  }

  /** Turbo blow-off / dump valve: a short choked whoosh. */
  triggerBOV(boost = 0.6) {
    if (!this.car.tone.turbo) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = this.car.tone.turbo.bov.decay;
    const src = ctx.createBufferSource();
    src.buffer = createNoiseBuffer(ctx, { seconds: 0.3, pink: false });
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3.5;
    bp.frequency.setValueAtTime(1400 + 900 * boost, now);
    bp.frequency.exponentialRampToValueAtTime(420, now + dur);
    const g = ctx.createGain();
    const peak = this.car.tone.turbo.bov.gain * clamp(boost, 0.1, 1.2) * 0.35;
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.001), now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0005, now + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.engineBus);
    src.start(now);
    src.stop(now + dur + 0.02);
  }

  dispose() {
    this.stop();
  }
}
