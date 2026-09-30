// Tiny procedural impact audio — a modal ring plus a noise burst.
let ctx: AudioContext | null = null;
export function ensureAudio() { if (!ctx) ctx = new AudioContext(); if (ctx.state === 'suspended') ctx.resume(); }

const MODES: Record<string, number[]> = {
  glass: [2400, 3300, 4700, 6100], stone: [180, 260, 420], wood: [220, 340, 520, 900], plastic: [380, 640],
};

export function playImpact(kind: string, energy: number, shatter: boolean) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  const amp = Math.min(0.5, 0.06 + energy / 2500);
  gain.gain.setValueAtTime(0, t);

  // noise burst (comminution)
  const n = ctx.createBufferSource();
  const dur = shatter ? (kind === 'glass' ? 1.1 : 0.55) : 0.12;
  const buf = ctx.createBuffer(1, (ctx.sampleRate * dur) | 0, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) {
    const e = Math.exp(-i / d.length * (kind === 'glass' ? 3 : 8));
    d[i] = (Math.random() * 2 - 1) * e * (kind === 'glass' ? (0.4 + 0.6 * Math.random()) : 1);
  }
  n.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = kind === 'glass' ? 'highpass' : kind === 'stone' ? 'bandpass' : 'lowpass';
  bp.frequency.value = kind === 'glass' ? 2200 : kind === 'stone' ? 700 : 900;
  n.connect(bp); bp.connect(gain);

  gain.gain.linearRampToValueAtTime(amp, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  n.start(t); n.stop(t + dur);

  for (const f of MODES[kind] ?? MODES.stone) {
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.frequency.value = f * (0.94 + Math.random() * 0.12);
    o.type = 'sine'; o.connect(g); g.connect(ctx.destination);
    g.gain.setValueAtTime(amp * 0.35, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (shatter ? 0.8 : 0.25));
    o.start(t); o.stop(t + 1.0);
  }
}
