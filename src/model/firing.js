/**
 * firing.js — firing-pattern → harmonic-spectrum mathematics.
 *
 * A 4-stroke cylinder fires once every 720° of crank rotation. If cylinder `i`
 * fires at crank angle `phase[i]` (degrees, measured inside the 720° cycle) then
 * the summed exhaust pressure is
 *
 *     p(θ) = Σ_i  w_i · pulse(θ - phase_i)
 *
 * Expanding `pulse` into its own Fourier series (harmonics of the 720° cycle,
 * i.e. multiples of half crank speed) and collecting terms gives, for harmonic k
 *
 *     |P_k| = |Σ_i w_i · e^{-j·2π·k·phase_i/720}| / N
 *     arg   = -atan2( Σ_i w_i sin(2π·k·phase_i/720), Σ_i w_i cos(2π·k·phase_i/720) )
 *
 * which is exactly what this module computes. It is the reason an even-firing V8
 * produces a strong 4th-order-of-crank tone, an even-firing V6 a 3rd-order tone
 * and a V12 a 6th-order tone — and why unequal exhaust runner lengths (the `w_i`)
 * leak lower orders back in and make an engine "lope".
 *
 * Pure functions, no dependencies — unit tested in test/firing.test.js.
 */

export const CYCLE_DEG = 720;

/** Even-firing phase angles for `cylinders` cylinders, in firing order. */
export function evenFiringPhases(cylinders) {
  const out = new Array(cylinders);
  for (let i = 0; i < cylinders; i++) out[i] = (i * CYCLE_DEG) / cylinders;
  return out;
}

/**
 * Harmonic content of a firing pattern.
 *
 * @param {number[]} phases  firing angle (deg, 0..720) of each cylinder in firing order
 * @param {number[]} [weights] per-cylinder exhaust strength (unequal runners etc.)
 * @param {number} maxHarmonic highest harmonic of the 720° cycle to evaluate
 * @returns {{k:number, mag:number, phase:number}[]}
 */
export function firingSpectrum(phases, weights, maxHarmonic) {
  const n = phases.length;
  const w = weights && weights.length === n ? weights : new Array(n).fill(1);
  const out = new Array(maxHarmonic);
  for (let k = 1; k <= maxHarmonic; k++) {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const a = (2 * Math.PI * k * phases[i]) / CYCLE_DEG;
      re += w[i] * Math.cos(a);
      im += w[i] * Math.sin(a);
    }
    out[k - 1] = { k, mag: Math.hypot(re, im) / n, phase: -Math.atan2(im, re) };
  }
  return out;
}

/**
 * Which harmonic of the 720° cycle carries the dominant (firing) tone, and how
 * pure it is. For an even-firing engine with N cylinders the answer is k = N
 * (frequency = N/2 × crank speed) and purity ≈ 1.
 *
 * `purity` is the share of the total harmonic magnitude that sits on integer
 * multiples of the cylinder count. Even firing gives exactly 1; unequal exhaust
 * runners pull it down by leaking the orders in between (the classic lope).
 */
export function dominantOrder(phases, weights) {
  const n = phases.length;
  const spec = firingSpectrum(phases, weights, 4 * n);
  let best = spec[0];
  for (const s of spec) if (s.mag > best.mag) best = s;
  const total = spec.reduce((a, s) => a + s.mag, 0) || 1;
  const onOrder = spec.reduce((a, s) => (s.k % n === 0 ? a + s.mag : a), 0);
  return { k: best.k, mag: best.mag, purity: onOrder / total, spectrum: spec };
}

/**
 * Frequency (Hz) of harmonic k of the 720° cycle at a given engine speed.
 * k = 2 is one-per-crank-revolution, k = cylinders is the firing tone.
 */
export function harmonicFrequency(k, rpm) {
  return (k * rpm) / 120;
}

/** Firing tone frequency in Hz. */
export function firingFrequency(rpm, cylinders) {
  return (rpm * cylinders) / 120;
}
