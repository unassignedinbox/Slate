// Neutronics: macroscopic cross sections, four-factor k_inf, and an r-z one-group
// diffusion eigenvalue solver.
//
// Units: cross sections in cm^-1, atom densities in atoms/cm^3, lengths in cm.
//
// Method
//  1. Atom densities from weight fractions, with U-235 enrichment applied to uranium.
//  2. Per-region macroscopic cross sections, homogenised by volume fraction.
//  3. Four-factor k_inf = eta * f * p * eps, with f corrected by a flux-depression
//     factor, p from an effective resonance integral, and eta from U-235 data.
//  4. One-group diffusion in (r, z), with the absorption term set so that the
//     infinite-medium limit reproduces the four-factor k_inf. The system is solved on
//     a cylindrical finite-difference grid with a banded Cholesky factorisation,
//     and k_eff comes from power iteration.
//
// Known limitations (see docs): one energy group, homogenised core, Marshak vacuum
// boundary, no thermal-spectrum shifts beyond the coolant-density derivative.

import {
  N_A, BARN_CM2, U235, U238, I_EFF_U238_BARN, EPSILON_FAST, DISADVANTAGE_COEF, V_THERMAL_CM_S,
} from './constants.js';
import { ELEMENTS, xiOf, muBarOf } from './nuclear-data.js';
import { TE_FILL } from './geometry.js';
import { FUEL } from './materials.js';

// ---------------------------------------------------------------- nuclide data

// Returns per-atom properties for a nuclide symbol with optional enrichment handling.
function nucleus(sym) {
  const e = ELEMENTS[sym];
  if (!e) throw new Error(`No nuclear data for ${sym}`);
  return e;
}

// Atom density list {sym, N} for a weight-fraction composition of density rho (g/cm^3).
// Uranium is split into U-235 and U-238 using the enrichment (wt% U-235 in U).
export function nuclideDensities(comp, rho, enrichPct = 0) {
  const out = [];
  if (comp.U !== undefined) {
    const e = Math.max(0, Math.min(100, enrichPct)) / 100;
    const x5 = (e / U235.M) / (e / U235.M + (1 - e) / U238.M);   // atom fraction of U-235
    const Mavg = x5 * U235.M + (1 - x5) * U238.M;
    const NU = rho * comp.U * N_A / Mavg;
    out.push({ sym: 'U235', N: NU * x5 });
    out.push({ sym: 'U238', N: NU * (1 - x5) });
  }
  for (const [sym, w] of Object.entries(comp)) {
    if (sym === 'U') continue;
    const e = nucleus(sym);
    out.push({ sym, N: rho * w * N_A / e.M });
  }
  return out;
}

// Macroscopic properties of a single-phase homogeneous material, per unit volume.
export function macroOfSinglePhase(comp, rho, enrichPct = 0) {
  const nuc = nuclideDensities(comp, rho, enrichPct);
  let Sa = 0, Ss = 0, Sf = 0, nuSf = 0, SsXi = 0, SsTr = 0, N5 = 0, N8 = 0, Nnuc = 0;
  let mu1Mass = 0; // sum of w_i * mu/rho_i (cm^2/g)
  let mass = 0;
  for (const { sym, N } of nuc) {
    if (N <= 0) continue;
    const e = nucleus(sym);
    const sa = e.sa, ss = e.ss;
    const A = e.A;
    Sa += N * sa * BARN_CM2;
    Ss += N * ss * BARN_CM2;
    SsXi += N * ss * BARN_CM2 * xiOf(A, sym);
    SsTr += N * ss * BARN_CM2 * (1 - muBarOf(A));
    if (e.sf) {
      Sf += N * e.sf * BARN_CM2;
      nuSf += N * e.nu * e.sf * BARN_CM2;
    }
    if (sym === 'U235') N5 = N;
    if (sym === 'U238') N8 = N;
    Nnuc += N;
    mass += N * e.M / N_A;
  }
  // Mass attenuation at 1 MeV, mixture rule by weight fraction.
  const wsum = Object.entries(comp).reduce((s, [, w]) => s + w, 0) || 1;
  for (const [sym, w] of Object.entries(comp)) {
    const key = sym === 'U' ? 'U235' : sym;
    const e = ELEMENTS[key] || ELEMENTS.U238;
    mu1Mass += (w / wsum) * (sym === 'U' ? 0.0690 : e.mu1);
  }
  return {
    Sa, Ss, SsXi, SsTr, Sf, nuSf, N5, N8, Ntot: Nnuc, rho,
    Smu1: rho * mu1Mass,
    mu1Mass,
    Str: Sa + SsTr,           // transport cross section (abs + transport-corrected scatter)
  };
}

// Volume-weighted combination of several macro objects. parts = [{m, f}] with sum f = 1
// (or f = volume fraction of that material in the region).
export function combineMacro(parts) {
  const out = { Sa: 0, Ss: 0, SsXi: 0, SsTr: 0, Sf: 0, nuSf: 0, N5: 0, N8: 0, Ntot: 0, rho: 0, Smu1: 0, Str: 0 };
  for (const { m, f } of parts) {
    if (!m || f <= 0) continue;
    for (const k of Object.keys(out)) out[k] += f * (m[k] || 0);
  }
  return out;
}

// Single-phase material macro derived from a material record (phases handled separately).
export function materialMacro(mat, { enrichPct = 0, rhoOverride = null, rhoFn = null, pMPa = 0.1, TK = 300 } = {}) {
  if (mat.phases) {
    // Phase-composite fuel (TRISO): kernels and matrix combined by volume fraction.
    return combineMacro(mat.phases.map((ph) => ({
      m: materialMacroRecord(ph.ref, { enrichPct }),
      f: ph.vf,
    })));
  }
  const rho = rhoOverride ?? (rhoFn ? rhoFn(TK, pMPa) : mat.rho);
  if (!rho || rho <= 0) {
    return { Sa: 0, Ss: 0, SsXi: 0, SsTr: 0, Sf: 0, nuSf: 0, N5: 0, N8: 0, Ntot: 0, rho: 0, Smu1: 0, Str: 0 };
  }
  return macroOfSinglePhase(mat.comp, rho, enrichPct);
}

// Phase references (e.g. TRISO kernel and matrix) resolve against the FUEL table.
function materialMacroRecord(ref, opts) {
  const rec = FUEL[ref];
  if (!rec) throw new Error(`Unknown phase ${ref}`);
  return materialMacro(rec, opts);
}

// ---------------------------------------------------------------- four factor

// Fuel-only properties (per cm^3 of fuel region) for k_inf and eta.
export function fourFactor({ fuelMacro, fuelRadiusCm, fuelFracCore, coreMacro, mod, pinDensityCm }) {
  // fuelMacro: macro of the fuel region (per fuel volume)
  // fuelFracCore: fuel volume fraction of the core
  // mod: {SsXi, Ss} of moderating (coolant + moderator) region, per core volume
  // coreMacro: homogenised core macro (per core volume)
  void pinDensityCm;

  const eta = fuelMacro.N5 > 0
    ? U235.nu * U235.sigma_f * fuelMacro.N5 / (U235.sigma_a * fuelMacro.N5 + U238.sigma_a * fuelMacro.N8)
    : 0;

  // Thermal utilisation, with a flux-depression (disadvantage) factor for fuel rods.
  const SaFuelCore = fuelFracCore * fuelMacro.Sa;
  const SaTotal = coreMacro.Sa;
  const fHom = SaTotal > 0 ? SaFuelCore / SaTotal : 0;
  const DF = 1 + DISADVANTAGE_COEF * fuelMacro.Sa * fuelRadiusCm;
  const f = fHom / DF;

  // Resonance escape probability.
  const N8core = fuelFracCore * fuelMacro.N8;
  const xiMod = mod.Ss > 0 ? mod.SsXi / mod.Ss : 1;
  const p = mod.Ss > 0
    ? Math.exp(-(N8core * I_EFF_U238_BARN * BARN_CM2) / (xiMod * mod.Ss))
    : 0;

  const eps = EPSILON_FAST;
  const kInf = eta * f * p * eps;
  return { eta, f, fHom, DF, p, eps, xiMod, kInf };
}

// ---------------------------------------------------------------- grid diffusion

// Banded symmetric positive-definite Cholesky.
// Storage: AB[i*(bw+1)+d] = A[i][i-d] for d in 0..bw (lower band, including diagonal).
export function bandCholeskyFactor(AB, N, bw) {
  const W = bw + 1;
  for (let i = 0; i < N; i++) {
    const kStart = Math.max(0, i - bw);
    for (let j = kStart; j <= i; j++) {
      let s = AB[i * W + (i - j)];
      const kMin = Math.max(0, i - bw, j - bw);
      for (let k = kMin; k < j; k++) {
        s -= AB[i * W + (i - k)] * AB[j * W + (j - k)];
      }
      if (j < i) {
        AB[i * W + (i - j)] = s / AB[j * W + 0];
      } else {
        if (s <= 0) throw new Error('Matrix not positive definite');
        AB[i * W + 0] = Math.sqrt(s);
      }
    }
  }
  return AB;
}

export function bandCholeskySolve(LB, N, bw, b) {
  const W = bw + 1;
  const y = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    let s = b[i];
    const kMin = Math.max(0, i - bw);
    for (let k = kMin; k < i; k++) s -= LB[i * W + (i - k)] * y[k];
    y[i] = s / LB[i * W + 0];
  }
  const x = new Float64Array(N);
  for (let i = N - 1; i >= 0; i--) {
    let s = y[i];
    const kMax = Math.min(N - 1, i + bw);
    for (let k = i + 1; k <= kMax; k++) s -= LB[k * W + (k - i)] * x[k];
    x[i] = s / LB[i * W + 0];
  }
  return x;
}

// Solve k_eff for a region-assigned cylindrical grid.
//   geom: { R_env_cm, H_env_cm }
//   regionOf(rcm, zcm) -> key of a region macro in `macros`
//   macros: { key: { D (cm), Sa (cm^-1), nuSf (cm^-1) } }
export function solveDiffusion({ Rcm, Hcm, NR = 40, NZ = 60, regionOf, macros, boundary = 'marshak' }) {
  const dr = Rcm / NR;
  const dz = Hcm / NZ;
  const N = NR * NZ;
  const bw = NZ;
  const W = bw + 1;
  const AB = new Float64Array(N * W);
  const Fdiag = new Float64Array(N);   // nuSf * V per cell
  const cellRegion = new Array(N);
  const Vcell = new Float64Array(N);
  const Dcell = new Float64Array(N);
  const Scell = new Float64Array(N);

  for (let i = 0; i < NR; i++) {
    const r0 = i * dr, r1 = (i + 1) * dr, rc = 0.5 * (r0 + r1);
    for (let j = 0; j < NZ; j++) {
      const zc = (j + 0.5) * dz;
      const idx = i * NZ + j;
      const key = regionOf(rc, zc);
      const m = macros[key];
      if (!m) throw new Error(`No macro for region ${key}`);
      cellRegion[idx] = key;
      Vcell[idx] = Math.PI * (r1 * r1 - r0 * r0) * dz;
      Dcell[idx] = m.D;
      Scell[idx] = m.Sa;
      Fdiag[idx] = (m.nuSf || 0) * Vcell[idx];
    }
  }

  // Assemble: diagonal in d=0; off-diagonals in lower band d = NZ (radial neighbour) and d = 1 (axial).
  for (let i = 0; i < NR; i++) {
    const r0 = i * dr, r1 = (i + 1) * dr;
    for (let j = 0; j < NZ; j++) {
      const idx = i * NZ + j;
      let diag = Scell[idx] * Vcell[idx];

      // Radial neighbour outward (i+1), face at r1, area 2*pi*r1*dz.
      const Aeast = 2 * Math.PI * r1 * dz;
      if (i + 1 < NR) {
        const nb = idx + NZ;
        const G = Aeast / (dr / (2 * Dcell[idx]) + dr / (2 * Dcell[nb]));
        diag += G;
        AB[nb * W + (nb - idx)] = -G;  // lower band entry A[nb][idx] (nb > idx)
      } else {
        // Outer boundary: Marshak extrapolated zero-flux at 2.13 D beyond the face.
        const D = Dcell[idx];
        const G = boundary === 'marshak' ? Aeast * D / (dr / 2 + 2.13 * D) : 0;
        diag += G;
      }
      // Radial neighbour inward (i-1): handled when processing i-1 (symmetry), so add only the diagonal here.
      if (i - 1 >= 0) {
        const Aw = 2 * Math.PI * r0 * dz;
        const nb = idx - NZ;
        const G = Aw / (dr / (2 * Dcell[idx]) + dr / (2 * Dcell[nb]));
        diag += G;
      } else {
        // Symmetry at r = 0: zero-flux-gradient, no conductance.
      }

      // Axial neighbours.
      const Aaxial = Math.PI * (r1 * r1 - r0 * r0);
      if (j + 1 < NZ) {
        const nb = idx + 1;
        const G = Aaxial / (dz / (2 * Dcell[idx]) + dz / (2 * Dcell[nb]));
        diag += G;
        AB[nb * W + (nb - idx)] = -G;
      } else {
        const D = Dcell[idx];
        const G = boundary === 'marshak' ? Aaxial * D / (dz / 2 + 2.13 * D) : 0;
        diag += G;
      }
      if (j - 1 >= 0) {
        const nb = idx - 1;
        const G = Aaxial / (dz / (2 * Dcell[idx]) + dz / (2 * Dcell[nb]));
        diag += G;
      } else {
        const D = Dcell[idx];
        const G = boundary === 'marshak' ? Aaxial * D / (dz / 2 + 2.13 * D) : 0;
        diag += G;
      }
      AB[idx * W] = diag;
    }
  }

  // The radial inward/axial inward off-diagonals are already set by the outward/axial-up pass.
  // Make sure the diagonal entries used for conductance include both sides: the loops above
  // add each face's conductance once from each side, which is the standard symmetric build.
  bandCholeskyFactor(AB, N, bw);

  // Power iteration on the fission source.
  let x = new Float64Array(N).fill(1);
  let sumF = 0;
  for (let c = 0; c < N; c++) sumF += Fdiag[c] * x[c];
  for (let c = 0; c < N; c++) x[c] /= sumF;
  let k = 1;
  let kPrev = 0;
  let iter = 0;
  const maxIter = 400;
  for (iter = 0; iter < maxIter; iter++) {
    const rhs = new Float64Array(N);
    for (let c = 0; c < N; c++) rhs[c] = Fdiag[c] * x[c];
    const y = bandCholeskySolve(AB, N, bw, rhs);
    let kNew = 0;
    for (let c = 0; c < N; c++) kNew += Fdiag[c] * y[c];
    let diff = 0, norm = 0;
    for (let c = 0; c < N; c++) {
      const xn = y[c] / kNew;
      diff = Math.max(diff, Math.abs(xn - x[c]));
      norm = Math.max(norm, Math.abs(xn));
      x[c] = xn;
    }
    kPrev = k;
    k = kNew;
    if (Math.abs(k - kPrev) < 1e-10 && diff / Math.max(norm, 1e-30) < 1e-9 && iter > 5) break;
  }

  // Fission density per cell (per unit normalised flux) and summary.
  const fission = new Float64Array(N);
  let fMax = 0, fSum = 0, fCore = 0, nCore = 0;
  for (let c = 0; c < N; c++) {
    fission[c] = Fdiag[c] * x[c] / Vcell[c];
    if (cellRegion[c] === 'core') {
      fSum += fission[c];
      nCore++;
      if (fission[c] > fMax) fMax = fission[c];
    }
  }
  fCore = nCore ? fSum / nCore : 0;
  return {
    k, iterations: iter + 1, flux: x, fission, cellRegion, NR, NZ, dr, dz,
    radialPeaking: fCore > 0 ? fMax / fCore : 1,
    Vcell,
  };
}

// --------------------------------------------------------------- full model

// Build region macros for a configuration. Pure function of the configuration and
// the coolant state (density at temperature).
//   parts: { fuelMat, cladMat, wallMat, moderatorMat, reflMat, shieldMat, coolantMat,
//            teMat, fractions:{fuel,clad,guideWall,coolant,moderator}, enrichPct,
//            coolantRho, pMPa, TK }
export function buildRegionMacros(p) {
  const { fuelMat, cladMat, wallMat, moderatorMat, reflMat, shieldMat, coolantMat, teMat, fractions, enrichPct = 3, coolantRho, pMPa, TK } = p;
  const fuelM = materialMacro(fuelMat, { enrichPct });
  const cladM = materialMacro(cladMat, {});
  const wallM = materialMacro(wallMat, {});
  const coolM = coolantRho != null
    ? macroOfSinglePhase(coolantMat.comp, coolantRho, 0)
    : materialMacro(coolantMat, { rhoFn: coolantMat.rhoFn, pMPa, TK });
  const modM = moderatorMat.rho > 0 ? materialMacro(moderatorMat, {}) : null;
  const reflM = materialMacro(reflMat, {});
  const shieldM = materialMacro(shieldMat, {});
  const teM = materialMacro(teMat, {});

  // Core homogenised per core volume.
  const coreParts = [
    { m: fuelM, f: fractions.fuel },
    { m: cladM, f: fractions.clad },
    { m: wallM, f: fractions.guideWall },
    { m: coolM, f: fractions.coolant },
  ];
  if (modM && fractions.moderator > 0) coreParts.push({ m: modM, f: fractions.moderator });
  const coreM = combineMacro(coreParts);
  // Moderating part of the core (coolant + moderator) for p and xi.
  const modPart = combineMacro([
    { m: coolM, f: fractions.coolant },
    ...(modM && fractions.moderator > 0 ? [{ m: modM, f: fractions.moderator }] : []),
  ]);

  const ff = fourFactor({
    fuelMacro: fuelM,
    fuelRadiusCm: p.fuelRadiusCm,
    fuelFracCore: fractions.fuel,
    coreMacro: coreM,
    mod: { SsXi: modPart.SsXi, Ss: modPart.Ss },
  });

  // Core one-group absorption that reproduces k_inf: Sa_eff = nuSf / k_inf.
  const nuSfCore = coreM.nuSf;
  const SaEff = ff.kInf > 0 ? nuSfCore / ff.kInf : coreM.Sa;
  const Str = coreM.Str;
  const macroCore = {
    D: 1 / (3 * Str),
    Sa: SaEff,
    nuSf: nuSfCore,
    Sa_actual: coreM.Sa,
    Str,
  };
  const teScaled = { ...teM, Sa: teM.Sa * TE_FILL, Str: teM.Str * TE_FILL, nuSf: 0 };
  const macros = {
    core: macroCore,
    refl: { D: 1 / (3 * reflM.Str), Sa: reflM.Sa, nuSf: 0, Sa_actual: reflM.Sa, Str: reflM.Str },
    shield: { D: 1 / (3 * shieldM.Str), Sa: shieldM.Sa, nuSf: 0, Sa_actual: shieldM.Sa, Str: shieldM.Str },
    vessel: { D: 1 / (3 * wallM.Str), Sa: wallM.Sa, nuSf: 0, Sa_actual: wallM.Sa, Str: wallM.Str },
    coolant: { D: 1 / (3 * coolM.Str), Sa: coolM.Sa, nuSf: 0, Sa_actual: coolM.Sa, Str: coolM.Str },
    te: { D: 1 / (3 * Math.max(teScaled.Str, 1e-6)), Sa: teScaled.Sa, nuSf: 0, Sa_actual: teScaled.Sa, Str: teScaled.Str },
  };
  return {
    macros, coreM, fuelM, coolM, modM, ff,
    kInfApprox: ff.kInf,
    // Expose SaEff for kinetics, plus the core homogenised values for the rod and poison models.
    SaEffCore: SaEff,
    coreSa: coreM.Sa,
    coreNuSf: nuSfCore,
    coreStr: Str,
    coreRSigma: null,
    fuelFrac: fractions.fuel,
    meanLocalFuel: fuelM,
  };
}
