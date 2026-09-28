/**
 * Web Audio API Procedural Avian Synthesizer.
 * Synthesizes realistic raptor vocalizations, wing flap whooshes, ambient wind, and ground steps.
 */
export class EagleSoundEngine {
  private ctx: AudioContext | null = null;
  public isMuted = false;
  public masterVolume = 0.65;
  private masterGain: GainNode | null = null;

  private windGain: GainNode | null = null;
  private windNode: AudioNode | null = null;

  constructor() {}

  private initContext(): void {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.setValueAtTime(this.isMuted ? 0 : this.masterVolume, this.ctx.currentTime);
      this.masterGain.connect(this.ctx.destination);

      this.startAmbientWind();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : this.masterVolume, this.ctx.currentTime);
    }
  }

  public setVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1, vol));
    if (this.masterGain && this.ctx && !this.isMuted) {
      this.masterGain.gain.setValueAtTime(this.masterVolume, this.ctx.currentTime);
    }
  }

  /**
   * Synthesizes an authentic, piercing Raptor Screech / Call.
   */
  public playEagleScreech(): void {
    this.initContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;

    // Series of 3 staccato raptor chirps followed by a long descending screech
    const chirps = [
      { start: t, duration: 0.15, freqStart: 2800, freqEnd: 2100 },
      { start: t + 0.22, duration: 0.18, freqStart: 3100, freqEnd: 2300 },
      { start: t + 0.48, duration: 0.22, freqStart: 3400, freqEnd: 2400 },
      { start: t + 0.78, duration: 1.4, freqStart: 3800, freqEnd: 1600 }, // Main long piercing scream
    ];

    chirps.forEach((chirp) => {
      if (!this.ctx || !this.masterGain) return;

      // Primary Syrinx Oscillator (FM synthesis)
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const modGain = this.ctx.createGain();
      const gain = this.ctx.createGain();
      const filter = this.ctx.createBiquadFilter();

      // FM Modulation for raptor throat resonance
      osc1.type = 'sawtooth';
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(140, chirp.start);
      modGain.gain.setValueAtTime(80, chirp.start);

      osc2.connect(modGain);
      modGain.connect(osc1.frequency);

      // Frequency curve (piercing high chirp descending into guttural screech)
      osc1.frequency.setValueAtTime(chirp.freqStart, chirp.start);
      osc1.frequency.exponentialRampToValueAtTime(chirp.freqEnd, chirp.start + chirp.duration);

      // Bandpass filter for beak & oral cavity acoustic formant
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2600, chirp.start);
      filter.frequency.exponentialRampToValueAtTime(1800, chirp.start + chirp.duration);
      filter.Q.setValueAtTime(4.5, chirp.start);

      // Amplitude envelope
      gain.gain.setValueAtTime(0.001, chirp.start);
      gain.gain.exponentialRampToValueAtTime(0.55, chirp.start + 0.04);
      gain.gain.exponentialRampToValueAtTime(0.001, chirp.start + chirp.duration);

      osc1.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);

      osc1.start(chirp.start);
      osc2.start(chirp.start);
      osc1.stop(chirp.start + chirp.duration);
      osc2.stop(chirp.start + chirp.duration);
    });
  }

  /**
   * Synthesizes low aerodynamic downstroke whoosh.
   */
  public playWingWhoosh(): void {
    this.initContext();
    if (!this.ctx || this.isMuted) return;

    const t = this.ctx.currentTime;
    const duration = 0.35;

    // Pink noise burst through lowpass filter
    const bufferSize = this.ctx.sampleRate * duration;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      data[i] = (b0 + b1 + b2) * 0.15;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(180, t);
    filter.frequency.exponentialRampToValueAtTime(550, t + 0.12);
    filter.frequency.exponentialRampToValueAtTime(120, t + duration);
    filter.Q.setValueAtTime(2.0, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.01, t);
    gain.gain.exponentialRampToValueAtTime(0.45, t + 0.1);
    gain.gain.exponentialRampToValueAtTime(0.01, t + duration);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain!);

    noise.start(t);
    noise.stop(t + duration);
  }

  /**
   * Synthesizes continuous ambient mountain wind.
   */
  private startAmbientWind(): void {
    if (!this.ctx || !this.masterGain) return;

    const bufferSize = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);

    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * 0.08;
    }

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(250, this.ctx.currentTime);
    filter.Q.setValueAtTime(1.5, this.ctx.currentTime);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.12, this.ctx.currentTime);

    noise.connect(filter);
    filter.connect(this.windGain);
    this.windGain.connect(this.masterGain);

    noise.start();
    this.windNode = noise;
  }
}
