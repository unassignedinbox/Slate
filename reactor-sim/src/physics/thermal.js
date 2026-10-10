// Lumped thermal network, heat-transfer correlations, and thermoelectric conversion.
//
// Nodes (K):   T_f  fuel (centreline-equivalent, lumped)
//              T_b  coolant loop bulk (core + plenum)
//              T_w  vessel / shield / TE cold-side wall
// Paths:       fuel -> coolant   G_fb = N_pins * H_core / R'_tot   (R' from fuel, clad, film)
//              coolant -> wall   G_bw = G_TE + G_bridge              (TE legs in parallel with vessel wall)
//              wall -> air       G_wa = (h_conv + h_rad) * A_out
//
// Time integration is backward Euler on the three nodes, which is unconditionally stable.
// The coolant node is stiff (its time constant is ~0.1 s at low flow), so an explicit
// scheme would need very small steps.

import { SIGMA_SB, EMISS_OUTER, K_OFFSET } from './constants.js';
import { TE_FILL } from './geometry.js';

// ---------------------------------------------------------------- correlations

// Heat-transfer coefficient for a pin bundle, W/(m^2 K).
//  mdot  kg/s,  A_flow m^2,  Dh m,  rho kg/m^3,  mu Pa s,  k W/(m K),  cp J/(kg K)
export function filmCoefficient({ mdot, A_flow, Dh, rho, mu, k, cp }) {
  const m = Math.max(mdot, 1e-9);
  const v = m / (rho * A_flow);
  const Re = (rho * v * Dh) / mu;
  const Pr = (mu * cp) / k;
  const Pe = Re * Pr;
  let Nu;
  if (Pr < 0.1) {
    // Liquid metals (Skupinski-type). Valid for Pe ~100-10^4.
    Nu = 4.82 + 0.0185 * Math.pow(Math.max(Pe, 1), 0.827);
  } else if (Re < 2300) {
    Nu = 4.36;                                   // laminar, fully developed (constant heat flux)
  } else {
    Nu = 0.023 * Math.pow(Re, 0.8) * Math.pow(Pr, 0.4); // Dittus-Boelter (heating)
  }
  return { h: (Nu * k) / Dh, Re, Pr, Nu, velocity: v };
}

// Per-pin thermal resistance per unit length, m K/W. Radii in metres.
// R_f = 1/(4 pi k_f)  (uniform heat generation, centreline-to-surface)
// R_c = ln(r_co/r_ci)/(2 pi k_c)
// R_h = 1/(h 2 pi r_co)
export function pinResistance({ kFuel, kClad, h, rCladIn, rCladOut }) {
  const Rf = 1 / (4 * Math.PI * kFuel);
  const Rc = Math.log(rCladOut / rCladIn) / (2 * Math.PI * kClad);
  const Rh = 1 / (h * 2 * Math.PI * rCladOut);
  return { Rf, Rc, Rh, Rtot: Rf + Rc + Rh };
}

// ---------------------------------------------------------------- thermoelectric

// Efficiency of a thermoelectric generator with matched load, figure of merit ZT
// evaluated at the mean temperature (Ioffe / Rowe form):
//   eta = (1 - Tc/Th) * (sqrt(1+ZT) - 1) / (sqrt(1+ZT) + Tc/Th)
export function thermoelectricEta(ThK, TcK, ZT) {
  if (!(ThK > TcK) || ZT <= 0) return 0;
  const carnot = 1 - TcK / ThK;
  const s = Math.sqrt(1 + ZT);
  return carnot * (s - 1) / (s + TcK / ThK);
}

// Thermal conductance of the TE legs (W/K): k * A_legs / L.
export function teConductance({ k, areaM2, lengthM }) {
  return (k * areaM2 * TE_FILL) / lengthM;
}

// Vessel side-wall conduction bridge (W/K).
export function vesselBridge({ kVessel, RinM, wallM, HM }) {
  return (kVessel * 2 * Math.PI * RinM * wallM) / HM;
}

// Outer surface area of the can (m^2), including both ends.
export function canOuterArea(D_m, H_m) {
  const R = D_m / 2;
  return Math.PI * D_m * H_m + 2 * Math.PI * R * R;
}

// ---------------------------------------------------------------- 3-node solver

// Solve a 3x3 linear system with Gaussian elimination.
function solve3(A, b) {
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < 3; c++) {
    let piv = c;
    for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < 3; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k < 4; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = [0, 0, 0];
  for (let r = 2; r >= 0; r--) {
    let s = M[r][3];
    for (let k = r + 1; k < 3; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// Advance the three nodes by dt using backward Euler.
//  state: {Tf, Tb, Tw} (K)
//  p: { Cf, Cb, Cw (J/K), Gfb, Gbw, Gwa (W/K), Pin (W, heat into fuel), Tair (K) }
export function stepThermal(state, p, dt) {
  const { Cf, Cb, Cw, Gfb, Gbw, Gwa, Pin, Tair } = p;
  // (C/dt + G) T_new - coupling = C/dt T_old + sources
  const a11 = Cf / dt + Gfb;
  const a12 = -Gfb;
  const a22 = Cb / dt + Gfb + Gbw;
  const a23 = -Gbw;
  const a32 = -Gbw;
  const a33 = Cw / dt + Gbw + Gwa;
  const A = [
    [a11, a12, 0],
    [a12, a22, a23],
    [0, a32, a33],
  ];
  const b = [
    (Cf / dt) * state.Tf + Pin,
    (Cb / dt) * state.Tb,
    (Cw / dt) * state.Tw + Gwa * Tair,
  ];
  const [Tf, Tb, Tw] = solve3(A, b);
  return { Tf, Tb, Tw };
}

export function kelvin(c) { return c + K_OFFSET; }
export function celsius(k) { return k - K_OFFSET; }

// Convective + radiative conductance of the can to air, W/K (linearised radiation).
export function airConductance({ area, hConv, TwK, TairK, emissivity = EMISS_OUTER }) {
  const hRad = 4 * emissivity * SIGMA_SB * Math.pow(0.5 * (TwK + TairK), 3);
  return (hConv + hRad) * area;
}
