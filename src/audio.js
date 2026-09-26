import { clamp, lerp } from './util.js';

/** Discrete pan positions shared by every one-shot sound. */
const PAN_STEPS = 9;

/**
 * Tiny procedural sound bank — no asset files, everything is synthesised
 * with the WebAudio API so the game stays a single JS bundle.
 */
export class Audio {
  constructor() {
    this.ready = false;
    this.muted = false;
    this.ctx = null;
    this.lastMg = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(ctx.destination);

      // Noise buffer reused by most of the effects.
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buf;

      /* ---- engine ---- */
      this.engineGain = ctx.createGain();
      this.engineGain.gain.value = 0;
      const eFilter = ctx.createBiquadFilter();
      eFilter.type = 'lowpass';
      eFilter.frequency.value = 760;
      eFilter.Q.value = 3.2;
      this.engineFilter = eFilter;
      this.osc1 = ctx.createOscillator();
      this.osc1.type = 'sawtooth';
      this.osc1.frequency.value = 62;
      this.osc2 = ctx.createOscillator();
      this.osc2.type = 'square';
      this.osc2.frequency.value = 31;
      const oGain2 = ctx.createGain();
      oGain2.gain.value = 0.32;
      this.osc1.connect(eFilter);
      this.osc2.connect(oGain2).connect(eFilter);
      eFilter.connect(this.engineGain).connect(this.master);
      this.osc1.start();
      this.osc2.start();

      /* ---- surf ---- */
      this.surfGain = ctx.createGain();
      this.surfGain.gain.value = 0;
      const surfSrc = ctx.createBufferSource();
      surfSrc.buffer = buf;
      surfSrc.loop = true;
      const surfFilter = ctx.createBiquadFilter();
      surfFilter.type = 'lowpass';
      surfFilter.frequency.value = 460;
      const surfLfo = ctx.createOscillator();
      surfLfo.frequency.value = 0.12;
      const surfLfoGain = ctx.createGain();
      surfLfoGain.gain.value = 180;
      surfLfo.connect(surfLfoGain).connect(surfFilter.frequency);
      surfLfo.start();
      surfSrc.connect(surfFilter).connect(this.surfGain).connect(this.master);
      surfSrc.start();

      /* ---- wind ---- */
      this.windGain = ctx.createGain();
      this.windGain.gain.value = 0.02;
      const windSrc = ctx.createBufferSource();
      windSrc.buffer = buf;
      windSrc.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 620;
      windFilter.Q.value = 0.7;
      windSrc.connect(windFilter).connect(this.windGain).connect(this.master);
      windSrc.start();

      this.ready = true;
    } catch (e) {
      console.warn('audio unavailable', e);
    }
  }

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.7;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _pan(pos, listener) {
    if (!pos || !listener) return { gain: 1, pan: 0 };
    const dx = pos.x - listener.pos.x;
    const dz = pos.z - listener.pos.z;
    const d = Math.hypot(dx, dz);
    const gain = clamp(1 / (1 + d / 45), 0.02, 1);
    const pan = clamp((dx * listener.right.x + dz * listener.right.z) / Math.max(d, 1), -1, 1);
    return { gain, pan, dist: d };
  }

  /**
   * Panning output. One-shots fire hundreds of times a run, so instead of
   * creating (and leaking) a StereoPannerNode per sound we keep a fixed ladder
   * of panners and snap to the nearest one.
   */
  _out(pan = 0) {
    const ctx = this.ctx;
    if (!ctx.createStereoPanner) return this.master;
    if (!this._panners) {
      this._panners = [];
      for (let i = 0; i < PAN_STEPS; i++) {
        const p = ctx.createStereoPanner();
        p.pan.value = (i / (PAN_STEPS - 1)) * 2 - 1;
        p.connect(this.master);
        this._panners.push(p);
      }
    }
    const idx = Math.round(((clamp(pan, -1, 1) + 1) / 2) * (PAN_STEPS - 1));
    return this._panners[idx];
  }

  noiseBurst({ duration = 0.4, gain = 0.4, freq = 900, sweep = 120, type = 'lowpass', pan = 0, q = 1 }) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(freq, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), now + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0005, now + duration);
    src.connect(filter).connect(g).connect(this._out(pan));
    src.start(now);
    src.stop(now + duration + 0.05);
  }

  explosion(pos, listener, scale = 1) {
    const { gain, pan } = this._pan(pos, listener);
    this.noiseBurst({
      duration: 1.1 * scale,
      gain: 0.55 * gain * scale,
      freq: 420,
      sweep: 48,
      pan,
    });
    this.noiseBurst({ duration: 0.25, gain: 0.3 * gain, freq: 2600, sweep: 700, type: 'bandpass', pan, q: 0.6 });
    if (!this.ready || this.muted) return;
    // Sub thump
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90 * scale, now);
    osc.frequency.exponentialRampToValueAtTime(26, now + 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * gain * scale, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.7);
    osc.connect(g).connect(this._out(pan));
    osc.start(now);
    osc.stop(now + 0.75);
  }

  cannon(pos, listener) {
    const { gain, pan } = this._pan(pos, listener);
    this.noiseBurst({ duration: 0.7, gain: 0.42 * gain, freq: 700, sweep: 70, pan });
  }

  mg(pos, listener) {
    if (!this.ready || this.muted) return;
    const now = this.ctx.currentTime;
    if (now - this.lastMg < 0.035) return;
    this.lastMg = now;
    const { gain, pan } = this._pan(pos, listener);
    this.noiseBurst({ duration: 0.11, gain: 0.3 * gain, freq: 2100, sweep: 380, type: 'bandpass', pan, q: 0.8 });
  }

  hit() {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1400 + Math.random() * 900, now);
    osc.frequency.exponentialRampToValueAtTime(320, now + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.14, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.18);
  }

  crash(power = 1) {
    this.noiseBurst({ duration: 0.34, gain: clamp(0.22 * power, 0.04, 0.5), freq: 1500, sweep: 160, type: 'bandpass', q: 0.5 });
  }

  splash(power = 1) {
    this.noiseBurst({ duration: 0.45, gain: clamp(0.18 * power, 0.03, 0.4), freq: 3200, sweep: 500, type: 'bandpass', q: 0.4 });
  }

  beep(freq = 880, duration = 0.08, gain = 0.09) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(gain, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, now + duration);
    osc.connect(g).connect(this.master);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /** Called every frame with the live vehicle state. */
  updateEngine(dt, { speed, throttle, alive, submerged = 0 }) {
    if (!this.ready) return;
    const rpm = clamp(Math.abs(speed) / 40, 0, 1);
    const idle = alive ? 0.16 : 0;
    const target = alive ? idle + rpm * 0.34 + throttle * 0.12 : 0;
    const g = this.engineGain.gain;
    g.setTargetAtTime(clamp(target * (1 - submerged * 0.7), 0, 0.6), this.ctx.currentTime, 0.08);
    const baseFreq = 54 + rpm * 190 + throttle * 26;
    this.osc1.frequency.setTargetAtTime(baseFreq, this.ctx.currentTime, 0.07);
    this.osc2.frequency.setTargetAtTime(baseFreq * 0.5, this.ctx.currentTime, 0.07);
    this.engineFilter.frequency.setTargetAtTime(520 + rpm * 1500, this.ctx.currentTime, 0.1);
  }

  updateAmbience(distanceToWater, speed) {
    if (!this.ready) return;
    const surf = clamp(1 - distanceToWater / 220, 0, 1);
    this.surfGain.gain.setTargetAtTime(0.02 + surf * 0.2, this.ctx.currentTime, 0.4);
    this.windGain.gain.setTargetAtTime(0.014 + clamp(speed / 40, 0, 1) * 0.05, this.ctx.currentTime, 0.2);
  }
}
