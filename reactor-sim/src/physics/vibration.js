// Random vibration of the fuel stack and its supports.
//
// Miles' equation (single-degree-of-freedom response to a base PSD P in g^2/Hz):
//     grms = sqrt( (pi/2) fn Q P )          Q = 1 / (2 zeta)
// Stack natural frequency:  fn = (1/2pi) sqrt(k/m),  k = E A / L  (supports in parallel).
// Stationary narrowband displacement x(t) is generated with an AR(2) recursion whose
// variance is set from the Miles response (x_rms = a_rms / omega^2).
//
// Failure criteria:
//   * brittle fracture: Gaussian peak exceedance rate  lambda = fn exp(-s_u^2 / (2 s_rms^2))
//   * ductile fatigue: Rayleigh-amplitude Basquin damage rate  D' = fn (sqrt2 s_rms)^m Gamma(1+m/2) / C
//     with N = C S^-m, C = 0.5 sigma_f'^m, m = -1/b.

import { G0 } from './constants.js';

export function milesGrms(psdAtFn, fnHz, Q) {
  if (psdAtFn <= 0 || fnHz <= 0) return 0;
  return Math.sqrt((Math.PI / 2) * fnHz * Q * psdAtFn);
}

/** Stack natural frequency (Hz) from supports in parallel. */
export function stackNaturalFrequency(E, supportAreaM2, supportLengthM, massKg) {
  const k = (E * supportAreaM2) / supportLengthM;
  return Math.sqrt(k / massKg) / (2 * Math.PI);
}

/** Miles-based response for a flat base PSD band [fLo, fHi]. */
export function stackResponse({ psd, fLo, fHi, fnHz, zeta }) {
  const inBand = fnHz >= fLo && fnHz <= fHi;
  const Q = 1 / (2 * zeta);
  const grms = inBand ? milesGrms(psd, fnHz, Q) : 0; // g
  const aRms = grms * G0; // m/s^2
  const omega = 2 * Math.PI * fnHz;
  const xRms = omega > 0 ? aRms / (omega * omega) : 0; // m
  return { grms, aRms, xRms, Q };
}

/** Stationary narrowband AR(2) process with target standard deviation `sigma`.
 *  Coefficients follow the discretised damped oscillator. Returns a stepper. */
export function createNarrowbandProcess({ fnHz, zeta, sigma, h, rng }) {
  const w = 2 * Math.PI * fnHz;
  const wd = w * Math.sqrt(Math.max(1e-12, 1 - zeta * zeta));
  const r = Math.exp(-zeta * w * h);
  const a1 = 2 * r * Math.cos(wd * h);
  const a2 = -r * r;
  // Yule-Walker: Var(x) = s_e^2 (1 - a2) / [(1 + a2)((1 - a2)^2 - a1^2)]
  const unitVar = (1 - a2) / ((1 + a2) * ((1 - a2) * (1 - a2) - a1 * a1));
  const sigmaE = sigma > 0 ? sigma / Math.sqrt(unitVar) : 0;
  let x1 = 0;
  let x2 = 0;
  return {
    step(){
      const x = a1 * x1 + a2 * x2 + sigmaE * rng.gaussian();
      x2 = x1;
      x1 = x;
      return x;
    },
    coefficients: { a1, a2, sigmaE },
  };
}

/** Rate (1/s) of Gaussian peak exceedance of level `levelPa` for stress rms `sRms` at fn. */
export function brittleExceedanceRate(sRms, levelPa, fnHz) {
  if (sRms <= 0) return 0;
  return fnHz * Math.exp(-(levelPa * levelPa) / (2 * sRms * sRms));
}

/** Basquin S-N curve: cycles to failure for amplitude S (Pa). */
export function basquinCyclesToFailure(S, sigmaFPrime, b) {
  // N = 0.5 (S/sigma_f')^(1/b); with b < 0, N falls as S rises.
  if (S <= 0) return Infinity;
  return 0.5 * Math.pow(S / sigmaFPrime, 1 / b);
}

/** Expected Miner damage rate (1/s) for a narrowband Gaussian stress of rms `sRms`. */
export function fatigueDamageRate(sRms, fnHz, sigmaFPrime, b) {
  if (sRms <= 0) return 0;
  const m = -1 / b;
  const C = 0.5 * Math.pow(sigmaFPrime, m);
  // E[A^m] for Rayleigh amplitude with parameter sRms is (sqrt2 sRms)^m Gamma(1 + m/2)
  return (fnHz * Math.pow(Math.SQRT2 * sRms, m) * gammaFn(1 + m / 2)) / C;
}

/**
 * Gamma(x) for x > 0 (reflection for x < 0.5).
 * Shifts the argument up to z >= 15 with the recurrence Gamma(x+1) = x Gamma(x), then uses the
 * Stirling series ln Gamma(z) = (z-1/2) ln z - z + ln(2 pi)/2 + 1/(12z) - 1/(360z^3) + 1/(1260z^5) - 1/(1680z^7).
 * Truncation error at z >= 15 is below 1e-13 relative.
 */
export function gammaFn(x) {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaFn(1 - x));
  let z = x;
  let prod = 1;
  while (z < 15) {
    prod *= z;
    z += 1;
  }
  const z2 = z * z;
  const lnG =
    (z - 0.5) * Math.log(z) -
    z +
    0.5 * Math.log(2 * Math.PI) +
    1 / (12 * z) -
    1 / (360 * z * z2) +
    1 / (1260 * z * z2 * z2) -
    1 / (1680 * z * z2 * z2 * z2);
  return Math.exp(lnG) / prod;
}
