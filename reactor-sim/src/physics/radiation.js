// Radiation transport (point-kernel) and dose rates for the can.
//
// Source: fission neutrons and gammas from the core, plus a neutron source term (Cf-252 or
// an external generator) and decay gamma. The source is treated as a point at the core
// centre, with the path length to the core edge taken as half the core dimension.
//
// Neutrons:  phi_n = S_eff * exp(-Sigma_R x) / (4 pi d^2)
//            S_eff = S_src + nu F (1 - P_NL)            (escaping neutrons, isotropic)
//            Sigma_R = fast-neutron removal (fission spectrum); mass-removal approach.
// Gammas:    phi_g = S_g * exp(-mu x) * B(mu x) / (4 pi d^2),  B = 1 + mu x (linear buildup)
// Dose:      H*(10) = phi_n * 1.39 uSv/h per (n/cm^2 s)  +  phi_g * 0.0193 uSv/h per (g/cm^2 s)
//
// Checks (tests): Cf-252 at 1 m gives 25.6 uSv/h per microgram (OSTI 1184089, 2.55 mrem/h).

import {
  NEUTRON_UH10_PER_FLUX, KAIR_TO_H10, MU_EN_AIR_1MEV_CM2_G, MEV_TO_J,
  GAMMA_PHOTONS_PER_FISSION, CF252_NEUTRONS_PER_UG_S, CF252_GAMMA_TO_NEUTRON_DOSE, GAMMA_MEAN_MEV,
} from './constants.js';

// Dose per unit photon fluence at 1 MeV, uSv/h per (photon/cm^2 s).
export const GAMMA_UH10_PER_FLUX = (1.602176634e-10 * MU_EN_AIR_1MEV_CM2_G * KAIR_TO_H10 * 3600) * 1e6;

// Photons per Cf-252 neutron implied by the OSTI gamma-to-neutron dose ratio.
export const CF252_PHOTONS_PER_NEUTRON =
  (CF252_GAMMA_TO_NEUTRON_DOSE * NEUTRON_UH10_PER_FLUX) / GAMMA_UH10_PER_FLUX;

// Neutron source rate in n/s for a Cf-252 mass in micrograms.
export function cf252Rate(ug) {
  return CF252_NEUTRONS_PER_UG_S * ug;
}

// Gamma photons (1 MeV equivalent) per second from decay heat, assuming about half of the
// decay power is emitted as gamma rays at mean energy GAMMA_MEAN_MEV.
export function decayGammaRate(PdecayW) {
  return (0.5 * PdecayW) / (GAMMA_MEAN_MEV * MEV_TO_J);
}

// Attenuation path description. Each segment: {Sigma_R (cm^-1), mu (cm^-1), x (cm)}.
export function makePath(segments) {
  let sigR = 0, mu = 0, mux = 0, sigRx = 0;
  for (const s of segments) {
    sigRx += s.Sigma_R * s.x;
    mux += s.mu * s.x;
  }
  return { sigRx, mux, segments };
}

// Dose rates (uSv/h) at distance d (cm) from the source centre along a path.
export function doseAt({ d, path, Sn_eff, Sg }) {
  const d2 = Math.max(d, 1e-3) ** 2;
  const geom = 1 / (4 * Math.PI * d2);
  const phiN = Sn_eff * Math.exp(-path.sigRx) * geom;
  const B = 1 + path.mux;                              // linear buildup, conservative for dense shields
  const phiG = Sg * Math.exp(-path.mux) * B * geom;
  const neutron = phiN * NEUTRON_UH10_PER_FLUX;
  const gamma = phiG * GAMMA_UH10_PER_FLUX;
  return { neutron, gamma, total: neutron + gamma, phiN, phiG };
}

// Build the radial and axial attenuation paths for the geometry and material set.
//   geom: from buildGeometry (mm); mats: { core, refl, shield, vessel, coolant, te } each
//   {mu (cm^-1), Sigma_R (cm^-1)} from the homogenised region (mu and Sigma_R per volume).
export function buildPaths(geom, mats) {
  const cm = (mm) => mm / 10;
  const radial = makePath([
    { ...mats.core, x: cm(geom.R_core) / 2 },
    { ...mats.refl, x: cm(geom.reflT) },
    { ...mats.shield, x: cm(geom.shieldT) },
    { ...mats.vessel, x: cm(geom.vesselT) },
  ]);
  const topAxial = makePath([
    { ...mats.core, x: cm(geom.H_core) / 2 },
    { ...mats.refl, x: cm(geom.reflT) },
    { ...mats.shield, x: cm(geom.shieldT) },
    { ...mats.coolant, x: cm(4) },
    { ...mats.te, x: cm(geom.teT) },
    { ...mats.vessel, x: cm(2) },
  ]);
  const bottomAxial = makePath([
    { ...mats.core, x: cm(geom.H_core) / 2 },
    { ...mats.refl, x: cm(geom.reflT) },
    { ...mats.shield, x: cm(geom.shieldT) },
    { ...mats.vessel, x: cm(2) },
  ]);
  return { radial, topAxial, bottomAxial, dSideCm: cm(geom.R_env), dTopCm: cm(geom.H_env / 2) };
}

// Surface dose (uSv/h) on the can wall, and at 10 cm and 1 m, using the worst direction
// (the one with the least attenuation at that distance).
export function doseReport({ paths, Sn_eff, Sg }) {
  const side = doseAt({ d: paths.dSideCm, path: paths.radial, Sn_eff, Sg });
  const top = doseAt({ d: paths.dTopCm, path: paths.topAxial, Sn_eff, Sg });
  const bottom = doseAt({ d: paths.dTopCm, path: paths.bottomAxial, Sn_eff, Sg });
  const surface = Math.max(side.total, top.total, bottom.total);
  const at10cm = worstAt(10, paths, Sn_eff, Sg);
  const at1m = worstAt(100, paths, Sn_eff, Sg);
  return { surface, at10cm, at1m, side: side.total, top: top.total, bottom: bottom.total };
}

function worstAt(dCm, paths, Sn, Sg) {
  // Beyond the can the path is air (negligible attenuation). Use the radial path but with
  // the distance measured from the centre; this is the most conservative direction.
  return doseAt({ d: dCm, path: paths.radial, Sn_eff: Sn, Sg }).total;
}

// Source terms for a given state.
//   srcNps: external neutron source (n/s) = Cf-252 rate, or generator rate
//   F: fission rate (1/s); k: effective multiplication; kInf: infinite-medium k; nu: neutrons/fission
//   Pdecay: decay power (W)
export function sourceTerms({ srcNps, F, kEff, kInf, nu = 2.4355, Pdecay = 0, pNL = null }) {
  const PNL = pNL ?? Math.min(1, kEff / Math.max(kInf, 1e-9));
  const escaping = (srcNps + nu * F) * (1 - PNL);
  const Sg = GAMMA_PHOTONS_PER_FISSION * F + CF252_PHOTONS_PER_NEUTRON * srcNps + decayGammaRate(Pdecay);
  return { Sn_eff: escaping, Sg, PNL };
}
