/** Tiny synthesised engine / tyre audio — no sample assets required. */
export class EngineAudio {
  constructor() {
    this.enabled = false;
    this.ctx = null;
  }

  start() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    // engine: two detuned saws through a lowpass
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 6;
    this.filter.connect(this.master);

    this.osc = [];
    for (const detune of [-8, 6, 0]) {
      const o = ctx.createOscillator();
      o.type = detune === 0 ? 'square' : 'sawtooth';
      o.frequency.value = 60;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = detune === 0 ? 0.18 : 0.32;
      o.connect(g).connect(this.filter);
      o.start();
      this.osc.push(o);
    }

    // tyre / wind noise
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 1400;
    this.noiseFilter.Q.value = 1.2;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseFilter).connect(this.noiseGain).connect(this.master);
    this.noise.start();

    this.enabled = true;
    this.master.gain.setTargetAtTime(0.22, ctx.currentTime, 0.4);
  }

  toggle() {
    if (!this.ctx) {
      this.start();
      return true;
    }
    this.enabled = !this.enabled;
    this.master.gain.setTargetAtTime(this.enabled ? 0.22 : 0.0, this.ctx.currentTime, 0.15);
    return this.enabled;
  }

  update(car) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const speed = Math.abs(car.speed);
    const rev = (speed % 16) / 16;
    const base = 52 + rev * 120 + Math.min(speed, 120) * 0.55 + (car.boosting ? 40 : 0);
    for (const o of this.osc) o.frequency.setTargetAtTime(base, t, 0.04);
    this.filter.frequency.setTargetAtTime(500 + speed * 26 + (car.boosting ? 900 : 0), t, 0.08);
    const load = car.grounded ? 0.5 + 0.5 * Math.min(1, speed / 40) : 0.25;
    this.master.gain.setTargetAtTime(0.1 + 0.16 * load, t, 0.1);
    this.noiseGain.gain.setTargetAtTime(car.slip * 0.22 + Math.min(speed / 110, 1) * 0.05, t, 0.06);
    this.noiseFilter.frequency.setTargetAtTime(900 + car.slip * 2200, t, 0.06);
  }
}
