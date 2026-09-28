/**
 * Web Audio Synthesizer for Eagle Raptor Screech and Flight Aero-Acoustics
 */
export class EagleAudio {
  constructor() {
    this.ctx = null;
    this.isMuted = false;
    this.volume = 0.7;
    this.initAudioContext();
  }

  initAudioContext() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.ctx = new AudioContext();
      }
    } catch (e) {
      console.warn('Web Audio API not supported or blocked:', e);
    }
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  /**
   * Synthesize an authentic raptor / eagle screech cry
   * Bald eagles produce a high-pitched, piercing, modulated chatter/whistle cry (1.8 kHz - 4.5 kHz)
   * with rapid frequency modulation and resonant formants.
   */
  playScreech() {
    if (this.isMuted) return;
    this.resume();
    if (!this.ctx) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(this.volume * 0.8, now);
    masterGain.connect(ctx.destination);

    // Raptor Cry Structure: 3 rapid pulse cries followed by a sustained descending screech
    const pulses = [
      { start: 0.0, dur: 0.18, fStart: 2400, fEnd: 3200 },
      { start: 0.22, dur: 0.22, fStart: 2600, fEnd: 3600 },
      { start: 0.48, dur: 0.25, fStart: 2800, fEnd: 3800 },
      { start: 0.78, dur: 0.85, fStart: 3900, fEnd: 1900 } // Sustained piercing apex cry
    ];

    pulses.forEach(p => {
      const startTime = now + p.start;
      const endTime = startTime + p.dur;

      // Carrier Oscillator (Sharp predatory tone)
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';

      // Modulator for raspy avian vocal throat tremor (FM Synthesis)
      const mod = ctx.createOscillator();
      mod.type = 'sine';
      mod.frequency.setValueAtTime(42, startTime); // 42 Hz throat vibration

      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(280, startTime);
      mod.connect(modGain);
      modGain.connect(osc.frequency);

      // Pitch sweep
      osc.frequency.setValueAtTime(p.fStart, startTime);
      osc.frequency.exponentialRampToValueAtTime(p.fEnd, endTime);

      // Resonant Bandpass Filter (Formant of eagle beak acoustic cavity)
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(p.fStart * 1.1, startTime);
      filter.frequency.exponentialRampToValueAtTime(p.fEnd * 1.05, endTime);
      filter.Q.setValueAtTime(4.5, startTime);

      // Gain Envelope
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.7, startTime + 0.03);
      gain.gain.exponentialRampToValueAtTime(0.001, endTime);

      // Connect pipeline
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);

      // Start & Stop
      osc.start(startTime);
      mod.start(startTime);
      osc.stop(endTime);
      mod.stop(endTime);
    });
  }

  /**
   * Aerodynamic Wing Flap Whoosh Sound
   */
  playWingWhoosh() {
    if (this.isMuted) return;
    this.resume();
    if (!this.ctx) return;

    const ctx = this.ctx;
    const now = ctx.currentTime;
    const dur = 0.35;

    // Filtered noise buffer
    const bufferSize = ctx.sampleRate * dur;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    // Lowpass filter for deep air displacement whoosh
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140, now);
    filter.frequency.exponentialRampToValueAtTime(480, now + dur * 0.4);
    filter.frequency.exponentialRampToValueAtTime(100, now + dur);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.exponentialRampToValueAtTime(this.volume * 0.25, now + dur * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);

    noise.start(now);
    noise.stop(now + dur);
  }

  setMuted(muted) {
    this.isMuted = muted;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
  }
}
