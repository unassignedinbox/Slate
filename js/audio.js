// audio.js — all sound synthesized with WebAudio (no assets)
import { clamp, clamp01, lerp } from './utils.js';
import { S } from './state.js';

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.engineOn = false;
    this.engineS = 0;
  }

  init() {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.85;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 19000;
    this.master.connect(this.muffle);
    this.muffle.connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 1;
    this.amb.connect(this.master);

    // white noise buffer
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // ocean loop
    this.ocean = this._loop(420, 'lowpass');
    this.ocean.gain.gain.value = 0.06;
    // wind loop
    this.wind = this._loop(700, 'bandpass', 0.45);
    this.wind.gain.gain.value = 0.014;

    // engine
    this.engOsc = ctx.createOscillator();
    this.engOsc.type = 'sawtooth';
    this.engOsc.frequency.value = 55;
    this.engSub = ctx.createOscillator();
    this.engSub.type = 'square';
    this.engSub.frequency.value = 27;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 620;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engOsc.connect(this.engFilter);
    this.engSub.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.engOsc.start();
    this.engSub.start();

    this.ready = true;
  }

  _loop(freq, type, q = 0.8) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.amb);
    src.start();
    return { src, filter: f, gain: g };
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.85;
  }

  // position → volume/pan relative to camera
  _spatial(pos, maxDist = 260) {
    if (!this.ctx) return null;
    const cam = S.camera;
    if (!cam) return null;
    const dx = pos.x - cam.position.x;
    const dy = (pos.y !== undefined ? pos.y : cam.position.y) - cam.position.y;
    const dz = pos.z - cam.position.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > maxDist) return null;
    const vol = clamp(1 / (1 + dist / 55), 0.02, 1);
    const e = cam.matrixWorld.elements;
    const pan = clamp((dx * e[0] + dz * e[2]) / (dist || 1), -1, 1) * 0.7;
    return { vol, pan, dist };
  }

  _out(vol, pan) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = vol;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfx);
    } else {
      g.connect(this.sfx);
    }
    return g;
  }

  _noise(dest, t0, dur, type, f0, f1, peak, attack = 0.008) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(f0, t0);
    if (f1 !== null) f.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  _tone(dest, t0, dur, type, f0, f1, peak) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0);
    if (f1 !== null) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 20), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  // ------------------------------------------------------------------
  shot(pos, big) {
    if (!this.ready) return;
    const sp = this._spatial(pos, 420);
    if (!sp) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = this._out(1, sp.pan);
    const v = sp.vol * (big ? 0.5 : 0.34);
    this._noise(out, t0, 0.07, 'bandpass', 1400, 500, v);
    this._tone(out, t0, 0.06, 'square', 130, 60, v * 0.7);
  }

  explosion(pos, big, delay = 0) {
    if (!this.ready) return;
    const sp = this._spatial(pos, 700);
    if (!sp) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + delay;
    const out = this._out(1, sp.pan);
    const v = sp.vol * (big ? 1 : 0.6);
    this._noise(out, t0, big ? 1.5 : 0.9, 'lowpass', 3000, 110, v * 0.9, 0.012);
    this._tone(out, t0, big ? 1.0 : 0.6, 'sine', 64, 30, v * 0.8);
    this._noise(out, t0 + 0.29, big ? 1.1 : 0.5, 'lowpass', 700, 90, v * 0.25, 0.05);
  }

  crash(pos, f = 0.4) {
    if (!this.ready) return;
    const sp = this._spatial(pos);
    if (!sp) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = this._out(1, sp.pan);
    this._noise(out, t0, 0.22, 'lowpass', 900, 160, sp.vol * f);
    this._tone(out, t0, 0.09, 'triangle', 220, 90, sp.vol * f * 0.5);
  }

  wireSnag(pos) {
    if (!this.ready) return;
    const sp = this._spatial(pos);
    if (!sp) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = this._out(1, sp.pan);
    this._noise(out, t0, 0.1, 'bandpass', 3400, 2400, sp.vol * 0.3);
    this._tone(out, t0 + 0.03, 0.12, 'triangle', 2300, 1400, sp.vol * 0.14);
  }

  splash(pos, depth = 0.5) {
    if (!this.ready) return;
    const sp = this._spatial(pos);
    if (!sp) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = this._out(1, sp.pan);
    this._noise(out, t0, 0.4, 'lowpass', 1200, 300, sp.vol * clamp(0.2 + depth, 0.2, 0.7), 0.02);
  }

  hurt() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = this._out(0.5, 0);
    this._tone(out, t0, 0.14, 'square', 110, 60, 0.22);
    this._noise(out, t0, 0.1, 'lowpass', 600, 200, 0.14);
  }

  door() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = this._out(0.7, 0);
    this._tone(out, t0, 0.05, 'square', 190, 120, 0.12);
    this._noise(out, t0 + 0.04, 0.09, 'lowpass', 500, 200, 0.12);
  }

  floodWarn() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = this._out(0.8, 0);
    this._tone(out, t0, 0.16, 'sawtooth', 340, 300, 0.1);
    this._tone(out, t0 + 0.22, 0.2, 'sawtooth', 250, 210, 0.1);
  }

  death() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = this._out(0.9, 0);
    this._tone(out, t0, 1.8, 'sawtooth', 70, 38, 0.22);
    this._noise(out, t0, 1.4, 'lowpass', 400, 90, 0.16, 0.05);
  }

  win() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const out = this._out(0.9, 0);
    const notes = [392, 494, 587, 784];
    for (let i = 0; i < notes.length; i++) {
      const f = notes[i];
      this._tone(out, t0 + i * 0.17, 0.55, 'triangle', f, f, 0.16);
      this._tone(out, t0 + i * 0.17, 0.5, 'sine', f * 2, f * 2, 0.05);
    }
  }

  setEngine(on, s01) {
    this.engineOn = on;
    this.engineS = s01;
  }

  update(dt, time) {
    if (!this.ready) return;
    // engine
    const targetG = this.engineOn ? 0.05 + this.engineS * 0.13 : 0;
    const targetF = 55 + this.engineS * 150 + Math.sin(time * 27) * 3 * this.engineS;
    this.engGain.gain.value = lerp(this.engGain.gain.value, targetG, clamp01(dt * 5));
    this.engOsc.frequency.value = lerp(this.engOsc.frequency.value, targetF, clamp01(dt * 8));
    this.engSub.frequency.value = this.engOsc.frequency.value * 0.5;

    // ocean loudness near the waterline / underwater
    const p = S.player;
    let boost = 0;
    if (p) {
      const dWater = Math.abs(p.pos.z - S.waterlineZ);
      boost = clamp(1 - dWater / 130, 0, 1) * 0.1;
      const depth = S.waterLevel - p.pos.y;
      if (depth > 0.4) boost += 0.22;
    }
    const wave = 0.05 + 0.028 * Math.sin(time * 0.4) + 0.02 * Math.sin(time * 0.93 + 1);
    this.ocean.gain.gain.value = lerp(this.ocean.gain.gain.value, wave + boost, clamp01(dt * 2));

    // underwater muffle
    const cam = S.camera;
    const under = cam && S.waterLevel > cam.position.y + 0.05;
    const fTarget = under ? 420 : 19000;
    this.muffle.frequency.value = lerp(this.muffle.frequency.value, fTarget, clamp01(dt * 6));
  }
}
