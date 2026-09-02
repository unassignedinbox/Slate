/**
 * tone.js — maps an engine state to audio parameters. Pure functions so the
 * whole acoustic mapping can be unit-tested without a Web Audio context.
 *
 * Output contract (consumed by src/audio/graph.js):
 *   {
 *     harmonics: [{ freq, gain }...],   // ordered by ascending frequency
 *     inductionGain, inductionFreq,
 *     mechanicalGain,
 *     topEndGain, topEndFreq, topEndDepth,
 *     turbo: { freq, gain, wastegate } | null,
 *     electric: { freq, gain } | null,
 *     crackleRate, crackleGain,
 *     drive,                            // saturation amount
 *     lowcut,
 *   }
 */

import { firingSpectrum } from './firing.js';

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (t) => t * t * (3 - 2 * t);

/**
 * Load: how hard the cylinders are working. Throttle is the driver's demand,
 * load also accounts for the fact that a naturally aspirated engine at 2000 rpm
 * wide open is moving far less air than at 8000 rpm.
 */
export function engineLoad(state, car) {
  const rpmNorm = clamp(state.rpm / car.engine.redline, 0, 1.2);
  const ve = 0.35 + 0.65 * smoothstep(clamp((rpmNorm - 0.1) / 0.75, 0, 1));
  const boostFill = car.engine.aspiration === 'turbo'
    ? clamp(state.boost / car.engine.maxBoost, 0, 1)
    : 1;
  return clamp(state.throttle * ve * boostFill, 0, 1);
}

/** Exhaust pressure-pulse spectrum: |H(f)| = 1 / (1 + (f/fc)^alpha) */
export function pulseResponse(freq, cutoff, alpha) {
  const x = freq / Math.max(cutoff, 1);
  return 1 / (1 + Math.pow(x, alpha));
}

/** Sum of Lorentzian resonance peaks (fixed Hz — a property of the exhaust, not of rpm). */
export function resonanceResponse(freq, resonances) {
  let g = 1;
  for (const r of resonances) {
    const bw = r.f / r.q;
    g += (r.gain - 1) / (1 + Math.pow((freq - r.f) / bw, 2));
  }
  return Math.max(g, 0.02);
}

/**
 * Build the oscillator bank: one entry per harmonic k of the 720° cycle.
 *
 * amplitude = firingPattern(k) × pulseSpectrum(k) × exhaustResonance(k) × tilt
 */
export function harmonicTargets(car, state, opts = {}) {
  const { maxCount = car.tone.harmonics.count, nyquist = 20000 } = opts;
  const engine = car.engine;
  const tone = car.tone;
  const load = state.load != null ? state.load : engineLoad(state, car);
  const rpm = Math.max(state.rpm, 1);
  const spec = firingSpectrum(engine.firingPhases, engine.cylinderWeights, maxCount);

  const cutoff = lerp(tone.pulse.cutoffIdle, tone.pulse.cutoffFull, smoothstep(load));
  const alpha = tone.pulse.alpha;
  const tilt = 1 + 0.35 * (1 - load); // part throttle = rounder, less top end

  // The array is always indexed by harmonic (out[k-1]), so the audio graph can
  // map oscillator k → harmonics[k] without gaps as rpm moves.
  const out = [];
  for (const h of spec) {
    const freq = (h.k * rpm) / 120;
    if (freq > nyquist) break;
    if (freq < 8) {
      out.push({ k: h.k, freq, gain: 0 });
      continue;
    }
    let amp = h.mag;
    // firing-order harmonics (k = multiples of cylinder count) dominate; the
    // orders in between are the "rumble" that runner mismatch lets through.
    const order = h.k / engine.cylinders;
    const isFiringOrder = Math.abs(order - Math.round(order)) < 1e-6;
    amp *= isFiringOrder ? 1 : tone.lowOrderBoost / (1 + 2.2 * Math.abs(order - Math.round(order) || 0.5));
    amp *= pulseResponse(freq, cutoff, alpha);
    amp *= resonanceResponse(freq, tone.resonances);
    amp /= Math.pow(freq / 100, tilt * 0.22);
    out.push({ k: h.k, freq, gain: Math.max(amp, 0) });
  }

  // normalise so the bank keeps a constant perceived level as rpm changes
  let sum = 0;
  for (const h of out) sum += h.gain * h.gain;
  const norm = sum > 0 ? 1 / Math.sqrt(sum) : 0;
  const level = tone.harmonics.gain * (0.55 + 0.45 * load);
  for (const h of out) h.gain *= norm * level;
  return out;
}

/** Induction (intake) noise: rises with throttle and tracks rpm. */
export function inductionParams(car, state) {
  const t = car.tone.induction;
  const load = state.load != null ? state.load : engineLoad(state, car);
  const rpmNorm = clamp(state.rpm / car.engine.redline, 0, 1);
  return {
    gain: t.gain * Math.pow(load, 1.3) * (0.4 + 0.6 * rpmNorm) * (state.rpm > 1 ? 1 : 0),
    freq: lerp(t.freqIdle, t.freqFull, rpmNorm),
    q: t.q,
  };
}

/** Valve train / injector / gear lash hiss. */
export function mechanicalParams(car, state) {
  const t = car.tone.mechanical;
  const rpmNorm = clamp(state.rpm / car.engine.redline, 0, 1.2);
  return {
    gain: t.gain * Math.pow(rpmNorm, 2.2) * (0.6 + 0.4 * (state.throttle || 0)),
    hpf: t.hpf,
  };
}

/** High-frequency "shimmer" — noise amplitude-modulated at the firing rate. */
export function topEndParams(car, state) {
  const t = car.tone.topEnd;
  const load = state.load != null ? state.load : engineLoad(state, car);
  const rpmNorm = clamp(state.rpm / car.engine.redline, 0, 1.2);
  const fFire = (state.rpm * car.engine.cylinders) / 120;
  return {
    gain: t.gain * load * Math.pow(rpmNorm, 1.5),
    center: t.center,
    q: t.q,
    modHz: fFire,
    depth: 0.85,
  };
}

/** Turbocharger: compressor/turbine whine + wastegate + blow-off. */
export function turboParams(car, state) {
  const t = car.tone.turbo;
  if (!t) return null;
  const e = car.engine;
  const boostNorm = clamp(state.boost / e.maxBoost, 0, 1.3);
  const rpmNorm = clamp(state.rpm / e.redline, 0, 1);
  // turbine speed tracks mass flow: boost × rpm
  const flow = clamp(boostNorm * (0.45 + 0.55 * rpmNorm), 0, 1.3);
  return {
    freq: lerp(t.minHz, t.maxHz, Math.pow(clamp(flow, 0, 1), 0.85)),
    gain: t.gain * Math.pow(boostNorm, 1.15) * (0.3 + 0.7 * rpmNorm),
    wastegate: t.gain * 1.4 * clamp(boostNorm - 0.72, 0, 0.6) * (1 - state.throttle * 0.5),
    wastegateHz: t.wastegateHz,
  };
}

/** Hybrid e-machine whine (918 / LaFerrari). */
export function electricParams(car, state) {
  const t = car.tone.electric;
  if (!t) return null;
  // e-machines are geared to the output shaft: whine tracks road speed, with a
  // floor from the rear motor's idle creep.
  const speedHz = state.speed * t.baseHz * t.ratio;
  const assist = clamp(state.assist || 0, 0, 1);
  return {
    freq: Math.max(speedHz, t.baseHz * 0.35 + 0.02 * state.rpm),
    gain: t.gain * (0.25 + 0.75 * assist) * (state.rpm > 1 || state.speed > 0.2 ? 1 : 0),
    harmonics: t.harmonics,
  };
}

/** Overrun crackle / pops on closed throttle. */
export function crackleParams(car, state) {
  const t = car.tone.crackle;
  if (!t) return { rate: 0, gain: 0 };
  const overrun = state.throttle < 0.06 && state.rpm > t.minRpm ? 1 : 0;
  const rpmNorm = clamp((state.rpm - t.minRpm) / 2500, 0, 1);
  return {
    rate: t.rate * overrun * rpmNorm,
    gain: t.gain * overrun * (0.4 + 0.6 * rpmNorm),
    center: t.center,
  };
}

/** Waveshaper drive — exhaust saturation/compression under load. */
export function saturationParams(car, state) {
  const t = car.tone.saturation;
  const load = state.load != null ? state.load : engineLoad(state, car);
  return { drive: lerp(t.driveIdle, t.driveFull, load) };
}

/** Road + wind noise for the moving-car case. */
export function roadNoiseParams(car, state) {
  const v = Math.max(state.speed, 0);
  const norm = clamp(v / 70, 0, 1.2);
  return { gain: 0.5 * Math.pow(norm, 2.4) };
}

/**
 * Everything, in one call.
 */
export function computeTone(car, state, opts) {
  const withLoad = { ...state, load: state.load != null ? state.load : engineLoad(state, car) };
  return {
    harmonics: harmonicTargets(car, withLoad, opts),
    induction: inductionParams(car, withLoad),
    mechanical: mechanicalParams(car, withLoad),
    topEnd: topEndParams(car, withLoad),
    turbo: turboParams(car, withLoad),
    electric: electricParams(car, withLoad),
    crackle: crackleParams(car, withLoad),
    saturation: saturationParams(car, withLoad),
    road: roadNoiseParams(car, withLoad),
    load: withLoad.load,
  };
}
