// Point reactor kinetics with six delayed-neutron groups.
//
//   dn/dt   = [(rho - beta)/Lambda] n + sum_i lambda_i C_i
//   dC_i/dt = (beta_i/Lambda) n - lambda_i C_i
//
// Time stepping is backward Euler (unconditionally stable for subcritical and
// slightly supercritical states). The 1x1 implicit system is solved in closed form.
// For prompt-supercritical states (rho > beta) the step is sub-cycled so that
// h*(rho-beta)/Lambda stays small, because backward Euler is inaccurate there.

import { BETA_GROUPS, LAMBDA_GROUPS, BETA_TOTAL } from './constants.js';

export function createKinetics({ Lambda, power = 1 }) {
  // Equilibrium precursors for n = power (per unit n): C_i = beta_i n / (Lambda lambda_i)
  const C = BETA_GROUPS.map((b, i) => (b * power) / (Lambda * LAMBDA_GROUPS[i]));
  return { Lambda, n: power, C };
}

/** Advance (n, C) by time h with constant reactivity rho (Δk/k). Mutates state. */
export function stepKinetics(state, rho, h) {
  const { Lambda } = state;
  const excess = rho - BETA_TOTAL;
  // Sub-cycle when the prompt growth term would make a single backward-Euler step inaccurate.
  let remaining = h;
  while (remaining > 1e-15) {
    let dt = remaining;
    if (excess > 0) {
      dt = Math.min(dt, (0.05 * Lambda) / excess);
    }
    implicitStep(state, rho, dt);
    remaining -= dt;
  }
  return state.n;
}

function implicitStep(state, rho, h) {
  const { Lambda, C } = state;
  const alpha = (rho - BETA_TOTAL) / Lambda;
  let denom = 1 - h * alpha;
  let numer = state.n;
  for (let i = 0; i < 6; i += 1) {
    const l = LAMBDA_GROUPS[i];
    const b = BETA_GROUPS[i] / Lambda;
    const g = 1 + h * l;
    // C_i^+ = (C_i + h b n^+)/g  ->  substitute into n^+ equation
    denom -= (h * l * h * b) / g;
    numer += (h * l * C[i]) / g;
  }
  const nNew = numer / denom;
  for (let i = 0; i < 6; i += 1) {
    const l = LAMBDA_GROUPS[i];
    const b = BETA_GROUPS[i] / Lambda;
    C[i] = (C[i] + h * b * nNew) / (1 + h * l);
  }
  state.n = nNew;
}

/** Asymptotic (inhour) growth rate omega (1/s) for constant rho, found by bisection
 *  on the inhour equation  rho = omega Lambda + sum_i beta_i omega / (omega + lambda_i).
 *  Returns the largest real root; 0 when rho = 0. */
export function inhourPeriodRoot(rho, Lambda) {
  const f = (w) => w * Lambda + BETA_GROUPS.reduce((s, b, i) => s + (b * w) / (w + LAMBDA_GROUPS[i]), 0) - rho;
  if (rho === 0) return 0;
  // search bracket for root with omega > -min(lambda)
  let lo = -LAMBDA_GROUPS[0] + 1e-12;
  let hi = rho > 0 ? 1e4 : 0;
  if (rho < 0) {
    hi = 1e-12;
  }
  // f is monotonic increasing on (-lambda_min, inf)
  for (let iter = 0; iter < 200; iter += 1) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) > 0) hi = mid;
    else lo = mid;
  }
  return 0.5 * (lo + hi);
}
