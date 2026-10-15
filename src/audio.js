// Procedural Web Audio Engine for Portal Circuit Racing
class SoundSystem {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.musicGain = null;
    this.sfxGain = null;
    this.muted = false;

    // Engine sound nodes
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineFilter = null;
    this.engineGain = null;

    // Skid noise nodes
    this.skidGain = null;
    this.skidFilter = null;

    // Nitro sound nodes
    this.nitroGain = null;

    // Magnetic hum
    this.magnetOsc = null;
    this.magnetGain = null;

    // Music playback state
    this.musicPlaying = false;
    this.musicTimer = null;
    this.musicStep = 0;

    this.initialized = false;
  }

  init() {
    if (this.initialized) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(0.7, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.setValueAtTime(0.8, this.ctx.currentTime);
      this.sfxGain.connect(this.masterGain);

      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.setValueAtTime(0.35, this.ctx.currentTime);
      this.musicGain.connect(this.masterGain);

      this._setupEngine();
      this._setupSkid();
      this._setupNitro();
      this._setupMagnet();
      this._startMusic();

      this.initialized = true;
    } catch (e) {
      console.warn('Web Audio not supported or blocked:', e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime);
    }
    return this.muted;
  }

  _setupEngine() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;

    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.setValueAtTime(45, now);

    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.setValueAtTime(90, now);

    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(250, now);
    this.engineFilter.Q.setValueAtTime(3.0, now);

    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.setValueAtTime(0.01, now);

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxGain);

    this.engineOsc1.start();
    this.engineOsc2.start();
  }

  _setupSkid() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    this.skidFilter = this.ctx.createBiquadFilter();
    this.skidFilter.type = 'bandpass';
    this.skidFilter.frequency.setValueAtTime(950, this.ctx.currentTime);
    this.skidFilter.Q.setValueAtTime(2.5, this.ctx.currentTime);

    this.skidGain = this.ctx.createGain();
    this.skidGain.gain.setValueAtTime(0, this.ctx.currentTime);

    whiteNoise.connect(this.skidFilter);
    this.skidFilter.connect(this.skidGain);
    this.skidGain.connect(this.sfxGain);

    whiteNoise.start();
  }

  _setupNitro() {
    if (!this.ctx) return;
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    const nitroFilter = this.ctx.createBiquadFilter();
    nitroFilter.type = 'lowpass';
    nitroFilter.frequency.setValueAtTime(450, this.ctx.currentTime);

    this.nitroGain = this.ctx.createGain();
    this.nitroGain.gain.setValueAtTime(0, this.ctx.currentTime);

    whiteNoise.connect(nitroFilter);
    nitroFilter.connect(this.nitroGain);
    this.nitroGain.connect(this.sfxGain);

    whiteNoise.start();
  }

  _setupMagnet() {
    if (!this.ctx) return;
    this.magnetOsc = this.ctx.createOscillator();
    this.magnetOsc.type = 'sawtooth';
    this.magnetOsc.frequency.setValueAtTime(55, this.ctx.currentTime);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(120, this.ctx.currentTime);

    this.magnetGain = this.ctx.createGain();
    this.magnetGain.gain.setValueAtTime(0, this.ctx.currentTime);

    this.magnetOsc.connect(filter);
    filter.connect(this.magnetGain);
    this.magnetGain.connect(this.sfxGain);

    this.magnetOsc.start();
  }

  updateEngine(rpmRatio, throttle, speedRatio) {
    if (!this.initialized || !this.engineOsc1 || this.muted) return;
    const now = this.ctx.currentTime;

    const baseFreq = 42 + rpmRatio * 180 + speedRatio * 40;
    this.engineOsc1.frequency.setTargetAtTime(baseFreq, now, 0.05);
    this.engineOsc2.frequency.setTargetAtTime(baseFreq * 1.5, now, 0.05);

    const filterFreq = 180 + throttle * 1200 + rpmRatio * 900;
    this.engineFilter.frequency.setTargetAtTime(filterFreq, now, 0.08);

    const targetGain = 0.12 + throttle * 0.15 + speedRatio * 0.08;
    this.engineGain.gain.setTargetAtTime(targetGain, now, 0.06);
  }

  updateSkid(intensity) {
    if (!this.initialized || !this.skidGain || this.muted) return;
    const gain = Math.min(Math.max(intensity, 0), 1) * 0.28;
    this.skidGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.04);
  }

  updateNitro(active) {
    if (!this.initialized || !this.nitroGain || this.muted) return;
    const gain = active ? 0.35 : 0;
    this.nitroGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.08);
  }

  updateMagnetHum(intensity) {
    if (!this.initialized || !this.magnetGain || this.muted) return;
    const gain = Math.min(Math.max(intensity, 0), 1) * 0.35;
    this.magnetGain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.1);
  }

  playCrash(severity = 0.5) {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;

    // Thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(30, now + 0.3);

    const s = Math.min(Math.max(severity, 0.2), 1.0);
    gain.gain.setValueAtTime(s * 0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.35);

    // Metal crunch noise
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.25);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(s * 0.4, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1400, now);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.sfxGain);
    noise.start(now);
  }

  playPortalWarp() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;

    // Rising sweep
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, now);
    osc.frequency.exponentialRampToValueAtTime(1200, now + 0.8);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.4, now + 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.9);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.9);

    // Sub-bass thump
    const subOsc = this.ctx.createOscillator();
    const subGain = this.ctx.createGain();
    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(80, now + 0.1);
    subOsc.frequency.exponentialRampToValueAtTime(25, now + 0.7);

    subGain.gain.setValueAtTime(0.5, now + 0.1);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

    subOsc.connect(subGain);
    subGain.connect(this.sfxGain);
    subOsc.start(now + 0.1);
    subOsc.stop(now + 0.8);
  }

  playSteamHiss(intensity = 0.5) {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const dur = 0.4;
    const bufferSize = Math.floor(this.ctx.sampleRate * dur);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2200, now);
    filter.Q.setValueAtTime(3.0, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(intensity * 0.35, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    noise.start(now);
  }

  playBoulderThud() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(95, now);
    osc.frequency.exponentialRampToValueAtTime(35, now + 0.25);

    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.28);
  }

  playCrossingBell() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1480, now);

    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.2);
  }

  playMonorailWhoosh() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(110, now);
    osc.frequency.linearRampToValueAtTime(190, now + 0.4);
    osc.frequency.exponentialRampToValueAtTime(70, now + 1.2);

    gain.gain.setValueAtTime(0.01, now);
    gain.gain.linearRampToValueAtTime(0.35, now + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 1.2);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 1.2);
  }

  playTurretFire() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;

    // Gunshot snap
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(520, now);
    osc.frequency.exponentialRampToValueAtTime(90, now + 0.08);

    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.1);

    // Noise pop
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.06);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.2));
    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;
    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.2, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
    noise.connect(nGain);
    nGain.connect(this.sfxGain);
    noise.start(now);
  }

  playExplosion() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;

    // Sub-bass boom
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(160, now);
    osc.frequency.exponentialRampToValueAtTime(20, now + 0.6);

    gain.gain.setValueAtTime(0.7, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(now);
    osc.stop(now + 0.7);

    // Rumble blast
    const bufferSize = Math.floor(this.ctx.sampleRate * 0.7);
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));

    const noise = this.ctx.createBufferSource();
    noise.buffer = noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(600, now);
    filter.frequency.exponentialRampToValueAtTime(80, now + 0.7);

    const nGain = this.ctx.createGain();
    nGain.gain.setValueAtTime(0.6, now);
    nGain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

    noise.connect(filter);
    filter.connect(nGain);
    nGain.connect(this.sfxGain);
    noise.start(now);
  }

  playVictoryFanfare() {
    if (!this.initialized || this.muted) return;
    const now = this.ctx.currentTime;
    const notes = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
    notes.forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.12);

      gain.gain.setValueAtTime(0.01, now + idx * 0.12);
      gain.gain.linearRampToValueAtTime(0.25, now + idx * 0.12 + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.6);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now + idx * 0.12);
      osc.stop(now + idx * 0.12 + 0.6);
    });
  }

  _startMusic() {
    if (this.musicPlaying) return;
    this.musicPlaying = true;

    // Synthwave bassline chords
    const bassline = [
      65.41, 65.41, 65.41, 73.42, 82.41, 82.41, 73.42, 65.41,
      58.27, 58.27, 58.27, 65.41, 73.42, 73.42, 65.41, 58.27
    ];
    const leadNotes = [
      261.63, 0, 329.63, 392.00, 0, 440.00, 392.00, 0,
      349.23, 0, 329.63, 293.66, 0, 261.63, 293.66, 0
    ];

    const stepTime = 140; // ms per 16th note

    const tick = () => {
      if (!this.musicPlaying) return;
      if (this.ctx && this.ctx.state === 'running' && !this.muted) {
        const now = this.ctx.currentTime;
        const bFreq = bassline[this.musicStep % bassline.length];
        const lFreq = leadNotes[this.musicStep % leadNotes.length];

        // Bass synth
        const bOsc = this.ctx.createOscillator();
        const bGain = this.ctx.createGain();
        bOsc.type = 'sawtooth';
        bOsc.frequency.setValueAtTime(bFreq, now);

        const bFilter = this.ctx.createBiquadFilter();
        bFilter.type = 'lowpass';
        bFilter.frequency.setValueAtTime(320, now);

        bGain.gain.setValueAtTime(0.16, now);
        bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

        bOsc.connect(bFilter);
        bFilter.connect(bGain);
        bGain.connect(this.musicGain);
        bOsc.start(now);
        bOsc.stop(now + 0.13);

        // Arp / Lead
        if (lFreq > 0 && this.musicStep % 2 === 0) {
          const lOsc = this.ctx.createOscillator();
          const lGain = this.ctx.createGain();
          lOsc.type = 'square';
          lOsc.frequency.setValueAtTime(lFreq, now);

          const lFilter = this.ctx.createBiquadFilter();
          lFilter.type = 'lowpass';
          lFilter.frequency.setValueAtTime(900, now);

          lGain.gain.setValueAtTime(0.08, now);
          lGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

          lOsc.connect(lFilter);
          lFilter.connect(lGain);
          lGain.connect(this.musicGain);
          lOsc.start(now);
          lOsc.stop(now + 0.2);
        }

        // Kick drum on quarters
        if (this.musicStep % 4 === 0) {
          const kOsc = this.ctx.createOscillator();
          const kGain = this.ctx.createGain();
          kOsc.type = 'sine';
          kOsc.frequency.setValueAtTime(130, now);
          kOsc.frequency.exponentialRampToValueAtTime(35, now + 0.08);

          kGain.gain.setValueAtTime(0.25, now);
          kGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

          kOsc.connect(kGain);
          kGain.connect(this.musicGain);
          kOsc.start(now);
          kOsc.stop(now + 0.1);
        }

        this.musicStep++;
      }
      this.musicTimer = setTimeout(tick, stepTime);
    };

    tick();
  }
}

export const sound = new SoundSystem();
