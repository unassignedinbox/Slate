// ---------------------------------------------------------------------------
// Procedural impact audio: material-tuned filtered noise bursts (no assets).
// Glass = bright shimmering crash, wood = mid crack, concrete = low rumble,
// plastic = dull snap, rock = heavy thud.
// ---------------------------------------------------------------------------
type MaterialSound = 'glass' | 'wood' | 'concrete' | 'plastic' | 'rock' | 'shot';

let ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

interface SoundDef {
  freq: number;
  q: number;
  dur: number;
  gain: number;
  type: BiquadFilterType;
  sweep?: number; // multiply freq by this over the duration
}

const DEFS: Record<MaterialSound, SoundDef> = {
  glass:    { freq: 5200, q: 1.0, dur: 0.7,  gain: 0.5,  type: 'bandpass', sweep: 0.6 },
  wood:     { freq: 900,  q: 1.6, dur: 0.28, gain: 0.7,  type: 'bandpass', sweep: 0.5 },
  concrete: { freq: 260,  q: 0.8, dur: 0.9,  gain: 0.9,  type: 'lowpass',  sweep: 0.4 },
  plastic:  { freq: 1500, q: 2.2, dur: 0.16, gain: 0.55, type: 'bandpass', sweep: 0.7 },
  rock:     { freq: 180,  q: 0.7, dur: 0.7,  gain: 1.0,  type: 'lowpass',  sweep: 0.5 },
  shot:     { freq: 2400, q: 3.0, dur: 0.06, gain: 0.25, type: 'bandpass' },
};

export function playImpact(kind: MaterialSound, intensity = 1): void {
  const c = ensureCtx();
  if (!c) return;
  const def = DEFS[kind];
  const src = c.createBufferSource();
  src.buffer = noiseBuffer(c, def.dur);
  const filter = c.createBiquadFilter();
  filter.type = def.type;
  filter.frequency.value = def.freq;
  filter.Q.value = def.q;
  if (def.sweep) {
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(40, def.freq * def.sweep),
      c.currentTime + def.dur
    );
  }
  const gain = c.createGain();
  const g = Math.min(1.2, def.gain * intensity);
  gain.gain.setValueAtTime(g, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + def.dur);
  src.connect(filter).connect(gain).connect(c.destination);
  src.start();

  // glass: add a few descending ring "tinks" for shard rain
  if (kind === 'glass') {
    for (let i = 0; i < 5; i++) {
      const t = c.currentTime + 0.08 + Math.random() * 0.5;
      const osc = c.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 2500 + Math.random() * 4500;
      const og = c.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(0.08 * intensity, t + 0.005);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      osc.connect(og).connect(c.destination);
      osc.start(t);
      osc.stop(t + 0.15);
    }
  }
}
