/**
 * buffers.js — procedural audio buffers (noise, impulse responses, one-shots).
 * Everything is synthesised at load time: no samples, no downloads.
 */

/** White or pink noise, loopable (endpoints matched to avoid a seam click). */
export function createNoiseBuffer(ctx, { seconds = 2, pink = true } = {}) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  if (!pink) {
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  } else {
    // Paul Kellet's refined pink-noise filter
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
  }
  // fade the seam
  const fade = Math.floor(ctx.sampleRate * 0.01);
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    d[i] *= g;
    d[len - 1 - i] *= g;
  }
  return buf;
}

/**
 * Synthetic impulse response: early discrete reflections + exponentially decaying
 * diffuse tail. Used to place the car in a space (cabin / pit lane / trackside).
 */
export function createImpulseResponse(ctx, { seconds = 1.6, decay = 2.6, predelay = 0.008, reflections = 9, level = 0.35 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    d[0] = 1;
    const start = Math.floor(sr * predelay);
    for (let r = 0; r < reflections; r++) {
      const t = start + Math.floor(((r + 1) / reflections) * sr * 0.05 * (0.6 + Math.random()));
      if (t < len) d[t] += (1 - r / reflections) * level * (c === 0 ? 1 : 0.85);
    }
    let lp = 0;
    for (let i = start; i < len; i++) {
      const x = i / len;
      const env = Math.pow(1 - x, decay);
      const n = (Math.random() * 2 - 1) * env;
      lp += (n - lp) * 0.35; // dull the tail like a real space
      d[i] += lp * level * 1.6;
    }
  }
  return buf;
}

/** A single exhaust crackle: a few milliseconds of sharp, band-limited noise. */
export function createCrackleBuffer(ctx, { ms = 26, seed = 1 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.max(16, Math.floor((sr * ms) / 1000));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let v = 0;
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 2147483648 - 1;
  };
  for (let i = 0; i < len; i++) {
    const x = i / len;
    const env = Math.pow(1 - x, 3.2);
    v += (rand() - v) * 0.55;
    d[i] = v * env;
  }
  return buf;
}

/** Starter-motor whir: broadband noise with a rotating-machine comb. */
export function createStarterBuffer(ctx, { seconds = 0.5 } = {}) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const n = Math.random() * 2 - 1;
    const comb = 0.5 + 0.5 * Math.sin(2 * Math.PI * 34 * t) + 0.25 * Math.sin(2 * Math.PI * 68 * t + 0.7);
    d[i] = n * 0.6 * comb + 0.12 * Math.sin(2 * Math.PI * 62 * t);
  }
  return buf;
}

/** Soft-clip (tanh) curve for the waveshaper. */
export function saturationCurve(drive, points = 2048) {
  const curve = new Float32Array(points);
  const k = Math.max(0.05, drive);
  for (let i = 0; i < points; i++) {
    const x = (i / (points - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}
