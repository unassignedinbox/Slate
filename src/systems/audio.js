// Fully procedural WebAudio - no asset downloads. Engine note, MG bursts,
// bomb whistles, explosions, aircraft drone and the surf behind you.

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Sound {
  constructor() {
    this.ready = false;
    this.enabled = true;
    this.shotBudget = 0;
  }

  init() {
    if (this.ready) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(ctx.destination);

    // shared noise buffer
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noise = buf;

    // --- engine ---
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 900;
    this.engineFilter = engFilter;
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc1.frequency.value = 60;
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    this.osc2.frequency.value = 30;
    const o2g = ctx.createGain();
    o2g.gain.value = 0.35;
    this.osc1.connect(engFilter);
    this.osc2.connect(o2g).connect(engFilter);
    engFilter.connect(this.engineGain).connect(this.master);
    this.osc1.start();
    this.osc2.start();

    // --- surf ---
    this.surfGain = ctx.createGain();
    this.surfGain.gain.value = 0;
    const surfSrc = ctx.createBufferSource();
    surfSrc.buffer = buf;
    surfSrc.loop = true;
    const surfFilter = ctx.createBiquadFilter();
    surfFilter.type = 'lowpass';
    surfFilter.frequency.value = 480;
    surfSrc.connect(surfFilter).connect(this.surfGain).connect(this.master);
    surfSrc.start();
    this.surfFilter = surfFilter;

    // --- aircraft drone ---
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    this.drone1 = ctx.createOscillator();
    this.drone1.type = 'sawtooth';
    this.drone1.frequency.value = 96;
    this.drone2 = ctx.createOscillator();
    this.drone2.type = 'sawtooth';
    this.drone2.frequency.value = 101;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 700;
    this.drone1.connect(droneFilter);
    this.drone2.connect(droneFilter);
    droneFilter.connect(this.droneGain).connect(this.master);
    this.drone1.start();
    this.drone2.start();

    // --- bomb whistle ---
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.whistle = ctx.createOscillator();
    this.whistle.type = 'sine';
    this.whistle.frequency.value = 800;
    this.whistle.connect(this.whistleGain).connect(this.master);
    this.whistle.start();

    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _dist(pos, listener) {
    return Math.hypot(pos.x - listener.x, (pos.y || 0) - listener.y, pos.z - listener.z);
  }

  _burst({ duration = 0.12, freq = 1400, q = 1.2, gain = 0.4, type = 'bandpass', sweep = null }) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(gain, now);
    g.gain.exponentialRampToValueAtTime(0.0008, now + duration);
    if (sweep) f.frequency.exponentialRampToValueAtTime(sweep, now + duration);
    src.connect(f).connect(g).connect(this.master);
    src.start(now);
    src.stop(now + duration + 0.02);
  }

  mgShot(pos, listener) {
    if (!this.ready) return;
    if (this.shotBudget <= 0) return;
    this.shotBudget--;
    const d = this._dist(pos, listener);
    const gain = clamp(1 - d / 400, 0, 1) ** 2 * 0.5;
    if (gain < 0.01) return;
    this._burst({ duration: 0.07, freq: 1700, q: 0.9, gain: gain * 0.8 });
    this._burst({ duration: 0.13, freq: 220, q: 0.7, gain: gain * 0.5, type: 'lowpass' });
  }

  /** Two-note chime when you roll through a repair dump. */
  pickup() {
    if (!this.ready) return;
    const ctx = this.ctx;
    [[660, 0], [990, 0.11]].forEach(([f, t]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, ctx.currentTime + t);
      g.gain.linearRampToValueAtTime(0.16, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.3);
      o.connect(g).connect(this.master);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.32);
    });
  }

  bulletCrack(gain = 0.35) {
    this._burst({ duration: 0.045, freq: 3200, q: 2.5, gain });
  }

  explosion(pos, power = 1, listener = null) {
    if (!this.ready) return;
    const d = listener ? this._dist(pos, listener) : 0;
    const g = clamp(1 - d / 600, 0, 1) ** 1.5 * power;
    if (g < 0.02) return;
    this._burst({ duration: 0.9 * power, freq: 320, q: 0.6, gain: 0.85 * g, type: 'lowpass', sweep: 60 });
    this._burst({ duration: 0.25, freq: 1200, q: 0.5, gain: 0.35 * g });
  }

  mineBlast(power = 1) {
    this._burst({ duration: 0.6 * power, freq: 420, q: 0.7, gain: 0.8, type: 'lowpass', sweep: 80 });
  }

  impact(strength = 1) {
    this._burst({ duration: 0.18, freq: 160 + Math.random() * 120, q: 0.8, gain: clamp(strength, 0, 1) * 0.6, type: 'lowpass' });
    this._burst({ duration: 0.09, freq: 2600, q: 1.5, gain: clamp(strength, 0, 1) * 0.25 });
  }

  splash() {
    this._burst({ duration: 0.5, freq: 900, q: 0.4, gain: 0.35, sweep: 200 });
  }

  planeIncoming() {
    this._droneTarget = 0.18;
  }

  planeDrone(pos, dist) {
    if (!this.ready) return;
    this._droneWanted = Math.max(this._droneWanted || 0, clamp(1 - dist / 420, 0, 1) * 0.22);
    this._droneFreq = 88 + clamp(220 / Math.max(dist, 20), 0, 1) * 30;
  }

  bombWhistle(pos, vy) {
    if (!this.ready) return;
    this._whistleWanted = 0.12;
    this._whistleFreq = clamp(500 + Math.abs(vy) * 14, 400, 1800);
  }

  update(dt, { rpm = 0, load = 0, surf = 0, playing = true } = {}) {
    if (!this.ready) return;
    this.shotBudget = Math.min(6, this.shotBudget + dt * 26);
    const now = this.ctx.currentTime;
    const target = playing ? 0.13 + load * 0.1 : 0;
    this.engineGain.gain.setTargetAtTime(target, now, 0.15);
    this.osc1.frequency.setTargetAtTime(48 + rpm * 150, now, 0.08);
    this.osc2.frequency.setTargetAtTime(24 + rpm * 75, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(500 + rpm * 1600 + load * 400, now, 0.1);
    this.surfGain.gain.setTargetAtTime(surf * 0.4, now, 0.4);
    this.droneGain.gain.setTargetAtTime(this._droneWanted || 0, now, 0.25);
    if (this._droneFreq) {
      this.drone1.frequency.setTargetAtTime(this._droneFreq, now, 0.2);
      this.drone2.frequency.setTargetAtTime(this._droneFreq * 1.04, now, 0.2);
    }
    this._droneWanted = Math.max(0, (this._droneWanted || 0) - dt * 0.25);
    this.whistleGain.gain.setTargetAtTime(this._whistleWanted || 0, now, 0.08);
    if (this._whistleFreq) this.whistle.frequency.setTargetAtTime(this._whistleFreq, now, 0.1);
    this._whistleWanted = Math.max(0, (this._whistleWanted || 0) - dt * 0.6);
  }
}
