// ============================================================================
// audio.js — tiny procedural racing audio: detuned-oscillator engine with
// fake gears, wind noise with speed, extra hiss while drifting, nitro roar.
// ============================================================================
export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this._muted = false;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();

    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    // ---- engine voice
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0;
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = 'lowpass';
    this.engFilter.frequency.value = 700;
    this.engFilter.Q.value = 2.5;
    this.osc1 = ctx.createOscillator(); this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator(); this.osc2.type = 'square';
    this.osc3 = ctx.createOscillator(); this.osc3.type = 'sine'; // sub
    this.osc2.detune.value = -9;
    this.osc1.frequency.value = 80;
    this.osc2.frequency.value = 80;
    this.osc3.frequency.value = 40;
    this.osc1.connect(this.engFilter);
    this.osc2.connect(this.engFilter);
    this.osc3.connect(this.engFilter);
    this.engFilter.connect(this.engGain);
    this.engGain.connect(this.master);
    this.osc1.start(); this.osc2.start(); this.osc3.start();

    // ---- noise bed (wind / drift)
    const len = ctx.sampleRate * 1.5;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf; this.noise.loop = true;

    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.noise.connect(this.windFilter).connect(this.windGain).connect(this.master);

    this.driftFilter = ctx.createBiquadFilter();
    this.driftFilter.type = 'bandpass';
    this.driftFilter.frequency.value = 950;
    this.driftFilter.Q.value = 1.4;
    this.driftGain = ctx.createGain(); this.driftGain.gain.value = 0;
    this.noise.connect(this.driftFilter).connect(this.driftGain).connect(this.master);
    this.noise.start();
  }

  toggleMute() {
    this._muted = !this._muted;
    if (this.master) this.master.gain.value = this._muted ? 0 : 0.55;
    return this._muted;
  }

  update(dt, { speed, vmax, throttle, drift, boosting, offLine }) {
    if (!this.ctx || this._muted) return;
    const t = this.ctx.currentTime;
    const sr = Math.min(1, Math.abs(speed) / vmax);

    // fake 5-speed gearbox
    const gearPos = Math.min(4, Math.floor(sr * 5));
    const inGear = (sr * 5) - gearPos;
    const rpm = 0.25 + inGear * 0.75;
    const freq = 62 + rpm * 250 + (boosting ? 22 : 0);
    this.osc1.frequency.setTargetAtTime(freq, t, 0.03);
    this.osc2.frequency.setTargetAtTime(freq * 0.5 + 1.5, t, 0.03);
    this.osc3.frequency.setTargetAtTime(freq * 0.5, t, 0.03);
    this.engFilter.frequency.setTargetAtTime(450 + rpm * 1500 + (boosting ? 500 : 0), t, 0.05);
    const eg = 0.05 + throttle * 0.11 + sr * 0.045 + (boosting ? 0.03 : 0);
    this.engGain.gain.setTargetAtTime(throttle > 0.02 || sr > 0.02 ? eg : 0.035, t, 0.06);

    this.windGain.gain.setTargetAtTime(sr * sr * 0.075, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(320 + sr * 900, t, 0.1);

    const dg = drift > 0.25 ? Math.min(0.13, (drift - 0.25) * 0.22) : 0;
    this.driftGain.gain.setTargetAtTime(dg + (offLine ? 0.05 : 0), t, 0.05);
    this.driftFilter.frequency.setTargetAtTime(offLine ? 480 : 900 + drift * 500, t, 0.08);
  }
}
