// WebAudio: procedural engine, wind, and one-shot SFX. No asset downloads.
export class Audio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.started = false;
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.started = true;

    this.master = ctx.createGain();
    this.master.gain.value = 0.75;
    this.master.connect(ctx.destination);

    // --- engine: two detuned saw oscillators through a lowpass, plus noise ---
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0.0;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 900;
    engFilter.Q.value = 3.2;
    this.engFilter = engFilter;

    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth';
    this.oscB = ctx.createOscillator(); this.oscB.type = 'square';
    this.oscA.frequency.value = 60; this.oscB.frequency.value = 90.5;
    const oa = ctx.createGain(); oa.gain.value = 0.5;
    const ob = ctx.createGain(); ob.gain.value = 0.16;
    this.oscA.connect(oa).connect(engFilter);
    this.oscB.connect(ob).connect(engFilter);
    engFilter.connect(this.engGain).connect(this.master);
    this.oscA.start(); this.oscB.start();

    // --- wind / slipstream noise ---
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let l = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; l = l * 0.86 + w * 0.14; d[i] = l * 3; }
    this.noiseBuf = buf;
    this.windSrc = ctx.createBufferSource();
    this.windSrc.buffer = buf; this.windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 600; this.windFilter.Q.value = 0.7;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter).connect(this.windGain).connect(this.master);
    this.windSrc.start();

    this.tone('ui', 0.001);
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.value = m ? 0 : 0.75; }
  toggleMute() { this.setMuted(!this.muted); return this.muted; }

  /** per-frame engine state */
  update(speed, maxSpeed, boost, dt, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const n = Math.max(0, Math.min(1.35, speed / maxSpeed));
    const f = 46 + n * 165 + (boost ? 22 : 0);
    this.oscA.frequency.setTargetAtTime(f, t, 0.06);
    this.oscB.frequency.setTargetAtTime(f * 1.503, t, 0.06);
    this.engFilter.frequency.setTargetAtTime(420 + n * 2100 + (boost ? 900 : 0), t, 0.08);
    this.engGain.gain.setTargetAtTime(active ? 0.085 + n * 0.12 : 0.0, t, 0.12);
    this.windGain.gain.setTargetAtTime(active ? Math.pow(n, 2) * 0.3 : 0, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(400 + n * 2600, t, 0.12);
  }

  /** short procedural blips */
  tone(kind, vol = 0.3, dur = null) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const recipes = {
      ui:      { f: 620, f2: 880, type: 'triangle', d: 0.07 },
      boost:   { f: 220, f2: 1150, type: 'sawtooth', d: 0.42 },
      hit:     { f: 180, f2: 42, type: 'square', d: 0.34 },
      wreck:   { f: 320, f2: 30, type: 'sawtooth', d: 0.8 },
      pulse:   { f: 880, f2: 1650, type: 'triangle', d: 0.3 },
      lap:     { f: 720, f2: 1180, type: 'square', d: 0.28 },
      count:   { f: 520, f2: 520, type: 'square', d: 0.14 },
      go:      { f: 320, f2: 1400, type: 'sawtooth', d: 0.5 },
      gate:    { f: 150, f2: 96, type: 'square', d: 0.5 },
      magnet:  { f: 92, f2: 320, type: 'sine', d: 0.9 },
      thrown:  { f: 1400, f2: 260, type: 'triangle', d: 0.5 },
      scrape:  { f: 900, f2: 1600, type: 'bandpass', d: 0.12 },
      finish:  { f: 560, f2: 1560, type: 'triangle', d: 1.2 },
    };
    const r = recipes[kind] || recipes.ui;
    const d = dur || r.d;

    if (kind === 'wreck' || kind === 'hit' || kind === 'scrape') {
      const s = ctx.createBufferSource();
      s.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = kind === 'hit' ? 260 : 500; f.Q.value = 0.9;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol * 0.8, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      f.frequency.setValueAtTime(kind === 'scrape' ? 1500 : 420, t);
      f.frequency.exponentialRampToValueAtTime(80, t + d);
      s.connect(f).connect(g).connect(this.master);
      s.start(t); s.stop(t + d);
    }
    const o = ctx.createOscillator();
    o.type = r.type;
    const g = ctx.createGain();
    o.frequency.setValueAtTime(Math.max(20, r.f), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, r.f2), t + d * 0.9);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol * 0.55, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + d + 0.02);
  }
}
