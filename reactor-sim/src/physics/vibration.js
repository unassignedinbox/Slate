// Random-vibration response and fatigue of the core mount.
//
// Model: the core and shielding are carried on a cantilever stub (E, d, L). The mount
// is a single-degree-of-freedom oscillator with stiffness k = 3 E I / L^3, I = pi d^4/64.
// Base-excitation random vibration is described by an acceleration PSD G(f) in g^2/Hz.
//
//   Miles' equation (flat PSD within about an octave of f_n):
//     z_rms   = sqrt(pi/2 * f_n * Q * S_a(f_n)) / omega_n^2          (relative displacement, m)
//   Root bending stress (cantilever, tip displacement z):
//     sigma_root = 3 E d z / (2 L^2)
//   Fatigue (Basquin, narrowband Rayleigh amplitudes, Miner's rule):
//     sigma_a = sigma_f' (2N)^b,   m = -1/b
//     E[1/N] = 2 (sqrt(2) sigma_rms / sigma_f')^m Gamma(1 + m/2)
//     damage rate = f_n * E[1/N]   (1/s);   failure when accumulated damage D >= 1
//
// Profiles are illustrative random-vibration spectra, not a qualification standard.

import { G0 } from './constants.js';

export const VIBRATION_PROFILES = {
  none: {
    id: 'none', label: 'Bench (no vibration)',
    psd: [[5, 0], [2000, 0]],
    note: 'Laboratory bench.',
  },
  seismic: {
    id: 'seismic', label: 'Seismic (low frequency)',
    psd: [[0.5, 0], [1, 0.002], [8, 0.002], [15, 0.0004], [100, 0.00005], [2000, 0]],
    note: 'Illustrative low-frequency ground motion.',
  },
  truck: {
    id: 'truck', label: 'Road transport (random)',
    psd: [[5, 0.0005], [10, 0.01], [40, 0.01], [200, 0.01], [500, 0.001], [2000, 0.0001]],
    note: 'Illustrative road-transport random vibration (about 1.5 g rms overall).',
  },
  aircraft: {
    id: 'aircraft', label: 'Airframe mounted (random)',
    psd: [[20, 0.02], [300, 0.02], [600, 0.005], [2000, 0.0005]],
    note: 'Illustrative airframe random vibration.',
  },
};

// Interpolated PSD value (g^2/Hz) at frequency f from breakpoints [[f, G], ...].
export function psdAt(psd, f) {
  if (f <= psd[0][0]) return psd[0][1];
  for (let i = 1; i < psd.length; i++) {
    const [f0, g0] = psd[i - 1];
    const [f1, g1] = psd[i];
    if (f <= f1) return g0 + (g1 - g0) * (f - f0) / (f1 - f0);
  }
  return psd[psd.length - 1][1];
}

// Overall g rms over the profile (trapezoidal integration in frequency).
export function overallGrms(psd) {
  let s = 0;
  for (let i = 1; i < psd.length; i++) {
    const [f0, g0] = psd[i - 1];
    const [f1, g1] = psd[i];
    s += 0.5 * (g0 + g1) * (f1 - f0);
  }
  return Math.sqrt(s);
}

// Cantilever support model. Lengths in mm, E in GPa, mass in kg.
export function supportModel({ E_GPa, dMm, LMm, mKg, zeta }) {
  const d = dMm * 1e-3, L = LMm * 1e-3;
  const E = E_GPa * 1e9;
  const I = (Math.PI * d ** 4) / 64;
  const k = (3 * E * I) / L ** 3;
  const fn = Math.sqrt(k / mKg) / (2 * Math.PI);
  return { k, I, fn, omega: 2 * Math.PI * fn, Q: 1 / (2 * zeta), zeta, E, d, L, m: mKg };
}

// Miles relative-displacement rms (m).
export function milesDisplacement({ fn, Q, gPsdAtFn }) {
  const S = gPsdAtFn * G0 * G0;     // m^2/s^4/Hz
  const w = 2 * Math.PI * fn;
  return Math.sqrt((Math.PI / 2) * fn * Q * S) / (w * w);
}

// Root bending stress rms (Pa) from tip displacement rms (m).
export function rootStressRms({ E, d, L, zRms }) {
  return (3 * E * d * zRms) / (2 * L * L);
}

// Lanczos approximation for the gamma function (double precision good to ~1e-13 here).
export function gammaFn(z) {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61503916999385, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
    1.5056327351493116e-7,
  ];
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x;
}

// Expected Miner damage rate (1/s) for a narrowband Rayleigh stress process.
export function fatigueDamageRate({ fn, sigmaRms, sigmaF, b }) {
  if (sigmaRms <= 0 || !(sigmaF > 0)) return 0;
  const m = -1 / b;
  const ratio = (Math.SQRT2 * sigmaRms) / sigmaF;
  const EinvN = 2 * Math.pow(ratio, m) * gammaFn(1 + m / 2);
  return fn * EinvN;
}

// Expected cycles to failure at a constant stress amplitude (Basquin, Pa).
export function basquinLife(sigmaA, sigmaF, b) {
  if (sigmaA <= 0) return Infinity;
  return 0.5 * Math.pow(sigmaA / sigmaF, 1 / b);
}

// Sensor-noise inflation caused by vibration (fraction of reading). Illustrative: 0.2 % per g rms.
export function vibrationSensorNoise(gRms) {
  return Math.min(0.05, 0.002 * gRms);
}

// Time-domain SDOF response to white base acceleration. Used to verify Miles' equation.
// Newmark average-acceleration integration (unconditionally stable).
// S0: one-sided white PSD of base acceleration (m^2/s^4/Hz). Returns rms relative displacement (m).
export function simulateSDOFRms({ fn, zeta, S0, duration, dt, rng, burnIn = 0.2 }) {
  const w = 2 * Math.PI * fn;
  const k = w * w, c = 2 * zeta * w, m = 1;
  const beta = 0.25, gamma = 0.5;
  const sigmaA = Math.sqrt(S0 / (2 * dt));      // discrete white noise, one-sided PSD S0
  const n = Math.round(duration / dt);
  const nBurn = Math.round(burnIn * n);

  const kEff = k + (gamma / (beta * dt)) * c + m / (beta * dt * dt);
  let z = 0, zd = 0, zdd = 0;
  let F = -sigmaA * rng.gaussian();
  zdd = F;                     // m=1 initial acceleration
  let sumSq = 0, cnt = 0;
  for (let i = 1; i <= n; i++) {
    const Fn = -sigmaA * rng.gaussian();
    const rhs = Fn
      + m * (z / (beta * dt * dt) + zd / (beta * dt) + (1 / (2 * beta) - 1) * zdd)
      + c * ((gamma / (beta * dt)) * z + (gamma / beta - 1) * zd + dt * (gamma / (2 * beta) - 1) * zdd);
    const zNew = rhs / kEff;
    const zdNew = (gamma / (beta * dt)) * (zNew - z) + (1 - gamma / beta) * zd + dt * (1 - gamma / (2 * beta)) * zdd;
    const zddNew = (zNew - z) / (beta * dt * dt) - zd / (beta * dt) - (1 / (2 * beta) - 1) * zdd;
    z = zNew; zd = zdNew; zdd = zddNew;
    if (i > nBurn) { sumSq += z * z; cnt++; }
  }
  void F;
  return Math.sqrt(sumSq / Math.max(1, cnt));
}
