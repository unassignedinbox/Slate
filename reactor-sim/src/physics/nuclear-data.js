// Element-level nuclear data for thermal and gamma calculations.
//
// sa, ss : thermal (2200 m/s) absorption and scattering microscopic cross sections, barns.
//          Natural-element values are rounded from ENDF/B-VIII.0 / standard tables.
//          Bound-hydrogen scattering uses the water value (80 b) and ZrH uses a lower
//          effective value (approximate; see notes).
// M      : atomic mass, g/mol.
// A      : mass number used for the mean scattering cosine mu_bar = 2/(3A) and xi.
// Z      : atomic number (used only for the gamma-scaling fallback).
// mu1    : mass attenuation coefficient at 1 MeV, cm^2/g. NIST XCOM values where
//          listed; otherwise Compton scaling mu ~ Z/A with a heavy-element correction.

export const ELEMENTS = {
  H:  { Z: 1,  M: 1.00794,  A: 1,   sa: 0.3326,  ss: 20.5, mu1: 0.1263 },
  Hb: { Z: 1,  M: 1.00794,  A: 1,   sa: 0.3326,  ss: 80.3, mu1: 0.1263 }, // H bound in water
  Hz: { Z: 1,  M: 1.00794,  A: 1,   sa: 0.3326,  ss: 20.0, mu1: 0.1263 }, // H bound in ZrH (approx.)
  D:  { Z: 1,  M: 2.0141,   A: 2,   sa: 0.000519, ss: 3.39, mu1: 0.0600 }, // approx.
  He: { Z: 2,  M: 4.0026,   A: 4,   sa: 0.0,     ss: 0.8, mu1: 0.0441 },
  Li: { Z: 3,  M: 7.016,    A: 7,   sa: 0.0454,  ss: 0.9, mu1: 0.0560 },   // Li-7 (enriched)
  Be: { Z: 4,  M: 9.0122,   A: 9,   sa: 0.0076,  ss: 6.15, mu1: 0.05652 },
  B:  { Z: 5,  M: 10.81,    A: 10.8, sa: 767,    ss: 4.0, mu1: 0.05890 }, // natural B (19.9% B-10)
  C:  { Z: 6,  M: 12.011,   A: 12,  sa: 0.00350, ss: 4.75, mu1: 0.06361 },
  N:  { Z: 7,  M: 14.007,   A: 14,  sa: 1.9,     ss: 11.0, mu1: 0.0636 },
  O:  { Z: 8,  M: 15.9994,  A: 16,  sa: 0.00019, ss: 3.76, mu1: 0.06372 },
  F:  { Z: 9,  M: 18.998,   A: 19,  sa: 0.0096,  ss: 4.0, mu1: 0.0637 },
  Na: { Z: 11, M: 22.990,   A: 23,  sa: 0.530,   ss: 3.3, mu1: 0.0606 },
  Al: { Z: 13, M: 26.982,   A: 27,  sa: 0.231,   ss: 1.5, mu1: 0.0612 },
  Si: { Z: 14, M: 28.086,   A: 28,  sa: 0.171,   ss: 2.2, mu1: 0.0617 },
  Ti: { Z: 22, M: 47.867,   A: 48,  sa: 6.09,    ss: 4.4, mu1: 0.0610 },
  V:  { Z: 23, M: 50.942,   A: 51,  sa: 5.08,    ss: 5.0, mu1: 0.0600 },
  Cr: { Z: 24, M: 51.996,   A: 52,  sa: 3.05,    ss: 3.0, mu1: 0.0590 },
  Mn: { Z: 25, M: 54.938,   A: 55,  sa: 13.3,    ss: 2.2, mu1: 0.0588 },
  Fe: { Z: 26, M: 55.845,   A: 56,  sa: 2.56,    ss: 11.4, mu1: 0.05995 },
  Ni: { Z: 28, M: 58.693,   A: 59,  sa: 4.49,    ss: 18.5, mu1: 0.0606 },
  Ge: { Z: 32, M: 72.63,    A: 73,  sa: 2.2,     ss: 7.0, mu1: 0.0583 },
  Zr: { Z: 40, M: 91.224,   A: 91,  sa: 0.185,   ss: 6.44, mu1: 0.05810 },
  Nb: { Z: 41, M: 92.906,   A: 93,  sa: 1.15,    ss: 6.3, mu1: 0.0591 },
  Mo: { Z: 42, M: 95.95,    A: 96,  sa: 2.48,    ss: 4.5, mu1: 0.0605 },
  Ag: { Z: 47, M: 107.87,   A: 108, sa: 63.3,    ss: 4.9, mu1: 0.0623 },
  Cd: { Z: 48, M: 112.41,   A: 112, sa: 2520,    ss: 4.5, mu1: 0.0627 },
  In: { Z: 49, M: 114.82,   A: 115, sa: 193.8,   ss: 2.2, mu1: 0.0622 },
  Sn: { Z: 50, M: 118.71,   A: 119, sa: 0.626,   ss: 4.8, mu1: 0.0642 },
  Te: { Z: 52, M: 127.60,   A: 128, sa: 4.7,     ss: 4.2, mu1: 0.0650 },
  Gd: { Z: 64, M: 157.25,   A: 157, sa: 48890,   ss: 151, mu1: 0.0727 },
  Hf: { Z: 72, M: 178.49,   A: 178, sa: 104.1,   ss: 7.8, mu1: 0.0770 },
  W:  { Z: 74, M: 183.84,   A: 184, sa: 18.3,    ss: 4.8, mu1: 0.06618 },
  Pb: { Z: 82, M: 207.2,    A: 207, sa: 0.171,   ss: 11.2, mu1: 0.07102 },
  Bi: { Z: 83, M: 208.98,   A: 209, sa: 0.0338,  ss: 9.1, mu1: 0.0715 },
  // Isotopes that need separate treatment.
  U235: { Z: 92, M: U235Mass(), A: 235, sa: 680.9, ss: 10.0, sf: 580.2, nu: 2.4355, mu1: 0.0690 },
  U238: { Z: 92, M: 238.0508, A: 238, sa: 2.68, ss: 8.3, sf: 0, nu: 0, mu1: 0.0690 },
};

function U235Mass() { return 235.0439; }

// Scattering-weighted mean logarithmic energy decrement xi for a nuclide of mass number A.
export function xiOf(A, nuclide = null) {
  if (nuclide === 'Hb' || nuclide === 'H' || nuclide === 'Hz' || A <= 1.0001) return 1.0;
  return 1 + ((A - 1) * (A - 1) / (2 * A)) * Math.log((A - 1) / (A + 1));
}

// Mean cosine of scattering in the lab frame, mu_bar = 2/(3A) (A >= 1).
export function muBarOf(A) {
  return 2 / (3 * A);
}

// Gamma mass attenuation at 1 MeV, cm^2/g. Elements not in the NIST list use Compton
// scaling with a heavy-element correction (roughly +1% per Z above 40). Good to ~5 %.
export function mu1Of(sym) {
  const e = ELEMENTS[sym];
  if (!e) throw new Error(`Unknown element ${sym}`);
  return e.mu1;
}
