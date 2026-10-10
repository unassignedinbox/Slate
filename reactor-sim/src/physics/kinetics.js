// Point kinetics with six delayed-neutron groups, solved implicitly (backward Euler),
// plus Way-Wigner decay heat.
//
//   dP/dt   = ((rho - beta)/Lambda) P + sum_i lambda_i C_i + q
//   dC_i/dt = (beta_i/Lambda) P - lambda_i C_i
//
// where q = E_f * S / (nu * Lambda) is the external-source term (W/s). For a subcritical
// core with a steady source, this gives P = E_f * k * S / (nu (1 - k)) (checked in tests).
// Backward Euler is unconditionally stable. It remains accurate for the quasi-static
// time steps used here, which are much longer than Lambda.

import { DELAYED_GROUPS, BETA_TOTAL, WAY_WIGNER_A, WAY_WIGNER_EXP, DECAY_HEAT_MIN_TIME_S, E_FISSION_J, U235 } from './constants.js';

const NG = DELAYED_GROUPS.length;
const N = NG + 1;

// Steady-state precursor concentrations for a given power and Lambda.
export function initialKinetics(P, Lambda) {
  const C = DELAYED_GROUPS.map((g) => (g.beta * P) / (Lambda * g.lambda));
  return { P, C };
}

// Solve a dense linear system (Gaussian elimination with partial pivoting).
function solveDense(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / d;
      if (f === 0) continue;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

// One implicit step. rho (dimensionless), Lambda (s), q (W/s), dt (s).
export function stepKinetics(state, { rho, Lambda, q, dt }) {
  const { P, C } = state;
  const beta = BETA_TOTAL;
  // Continuous-time matrix M and source b: x' = M x + b, x = [P, C1..C6].
  const M = Array.from({ length: N }, () => new Array(N).fill(0));
  M[0][0] = (rho - beta) / Lambda;
  for (let i = 0; i < NG; i++) {
    M[0][i + 1] = DELAYED_GROUPS[i].lambda;
    M[i + 1][0] = DELAYED_GROUPS[i].beta / Lambda;
    M[i + 1][i + 1] = -DELAYED_GROUPS[i].lambda;
  }
  // (I - dt M) x_new = x_old + dt b
  const A = Array.from({ length: N }, (_, i) => Array.from({ length: N }, (_, j) => (i === j ? 1 : 0) - dt * M[i][j]));
  const rhs = [P + dt * q, ...C];
  const x = solveDense(A, rhs);
  return { P: Math.max(0, x[0]), C: x.slice(1).map((c) => Math.max(0, c)) };
}

// Reactivity-independent quasi-static power for a subcritical core with source term q.
export function steadyPower({ rho, Lambda, q }) {
  if (rho >= 0) return Infinity;
  return (-q * Lambda) / rho;
}

// Source term q (W/s) from an external neutron rate S (n/s), multiplication nu, and
// generation time Lambda (s).
export function sourceTerm(S, Lambda) {
  return (E_FISSION_J * S) / (U235.nu * Lambda);
}

// Way-Wigner decay heat fraction P_decay / P_0.
// tShutdown: seconds since shutdown; tOperate: seconds of operation at P_0.
export function decayHeatFraction(tShutdown, tOperate) {
  if (!(tOperate > 0)) return 0;
  const t = Math.max(tShutdown, DECAY_HEAT_MIN_TIME_S);
  const f = WAY_WIGNER_A * (Math.pow(t, WAY_WIGNER_EXP) - Math.pow(t + tOperate, WAY_WIGNER_EXP));
  return Math.max(0, f);
}

// Prompt-neutron generation time from a region-resolved flux shape:
//   Lambda = (sum phi_c V_c / v) / (sum nuSf_c phi_c V_c)
export function generationTime(cells, v = 2.2e5) {
  let num = 0, den = 0;
  for (const c of cells) {
    num += (c.phi * c.V) / v;
    den += c.nuSf * c.phi * c.V;
  }
  return den > 0 ? num / den : 1e-4;
}
