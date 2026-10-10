// Decay heat and radiation dose.
//
// Decay heat (Way-Wigner):  P_d / P0 = 0.066 [ t^-0.2 - (t + T_op)^-0.2 ]
//     t = seconds since shutdown, T_op = seconds at power before shutdown.
//     Valid roughly 10 s to 100 days; the time is clamped to 10 s below that.
//
// Gamma dose (point-source kernel with exponential attenuation and a linear buildup):
//     Phi_gamma = S_gamma exp(-sum mu_i x_i) B / (4 pi d^2)
//     B = 1 + kappa sum mu_i x_i       (kappa = 0.5 high-Z, 1.0 low-Z; approximate)
//     Kerma in air = Phi E (mu_en/rho)_air  ->  Gy/s  (photon weighting factor 1)
// Neutron dose uses the fission neutron source, exp(-sum Sigma_R,i x_i) attenuation,
// and an ICRP-74 fluence-to-effective-dose coefficient at 1 MeV.

import {
  WAY_WIGNER_COEFF,
  RECOVERABLE_MEV_PER_FISSION,
  NEUTRONS_PER_FISSION,
  PROMPT_GAMMA_MEV_PER_FISSION,
  DECAY_GAMMA_FRACTION,
  REPRESENTATIVE_GAMMA_MEV,
  NEUTRON_FLUENCE_TO_DOSE_PSV_CM2,
  AIR_MU_EN_OVER_RHO_1MEV,
  MEV_TO_J,
} from './constants.js';
import { SHIELDS, linearAttenuation1MeV } from './materials.js';

/** Way-Wigner decay heat fraction (P_d / P0) at t seconds after shutdown. */
export function decayHeatFraction(tSinceShutdownS, operatingTimeS) {
  const t = Math.max(tSinceShutdownS, 10);
  const top = Math.max(operatingTimeS, 0);
  return WAY_WIGNER_COEFF * (Math.pow(t, -0.2) - Math.pow(t + top, -0.2));
}

/** Fission neutron emission rate (n/s) for fission power P (W). */
export function neutronSourceRate(fissionPowerW) {
  return (fissionPowerW / (RECOVERABLE_MEV_PER_FISSION * MEV_TO_J)) * NEUTRONS_PER_FISSION;
}

/** Gamma emission rate (photons/s at the representative energy).
 *  Prompt gamma: PROMPT_GAMMA_MEV_PER_FISSION of the RECOVERABLE_MEV_PER_FISSION per fission.
 *  Decay gamma: DECAY_GAMMA_FRACTION of decay power. */
export function gammaSourceRate(fissionPowerW, decayPowerW = 0) {
  const promptFraction = PROMPT_GAMMA_MEV_PER_FISSION / RECOVERABLE_MEV_PER_FISSION;
  const gammaPowerW = fissionPowerW * promptFraction + decayPowerW * DECAY_GAMMA_FRACTION;
  return gammaPowerW / (REPRESENTATIVE_GAMMA_MEV * MEV_TO_J);
}

/** Shield attenuation for the gamma field: returns transmission factor T = exp(-Σμx) B. */
export function gammaTransmission(layers) {
  let tau = 0; // sum of mu_i x_i
  let kappaWeighted = 0;
  for (const layer of layers) {
    const shield = SHIELDS[layer.id];
    if (!shield || layer.thicknessM <= 0) continue;
    const mux = linearAttenuation1MeV(layer.id) * layer.thicknessM * 100; // x in cm
    tau += mux;
    kappaWeighted += mux * (shield.rho > 5000 ? 0.5 : 1.0);
  }
  const buildup = 1 + kappaWeighted;
  return Math.exp(-tau) * buildup;
}

/** Fast-neutron transmission exp(-Σ_R x). */
export function neutronTransmission(layers) {
  let tau = 0;
  for (const layer of layers) {
    const shield = SHIELDS[layer.id];
    if (!shield || layer.thicknessM <= 0) continue;
    tau += shield.sigmaR * layer.thicknessM * 100;
  }
  return Math.exp(-tau);
}

/**
 * Dose rates at a distance from the core.
 * @param {object} p
 * @param {number} p.fissionPowerW  fission power, W
 * @param {number} p.decayPowerW  decay-heat power, W
 * @param {number} p.distanceM  distance from core centre, m
 * @param {Array}  p.gammaLayers  [{id, thicknessM}] gamma-attenuating layers
 * @param {Array}  p.neutronLayers [{id, thicknessM}] neutron-attenuating layers
 * @returns {{gammaSvPerH, neutronSvPerH, totalSvPerH}}
 */
export function doseRateAt({ fissionPowerW = 0, decayPowerW = 0, distanceM, gammaLayers = [], neutronLayers = [] }) {
  const dCm = Math.max(distanceM, 1e-3) * 100;
  const geom = 1 / (4 * Math.PI * dCm * dCm);
  const gammaFlux = gammaSourceRate(fissionPowerW, decayPowerW) * geom * gammaTransmission(gammaLayers); // photons/cm^2/s
  // Kerma (Gy/s) = Phi * E * (mu_en/rho)_air * MeV->J * 1000 g/kg
  const gammaSvPerS = gammaFlux * REPRESENTATIVE_GAMMA_MEV * AIR_MU_EN_OVER_RHO_1MEV * MEV_TO_J * 1000;
  const neutronFlux = neutronSourceRate(fissionPowerW) * geom * neutronTransmission(neutronLayers); // n/cm^2/s
  const neutronSvPerS = (neutronFlux * NEUTRON_FLUENCE_TO_DOSE_PSV_CM2 * 1e-12);
  return {
    gammaSvPerH: gammaSvPerS * 3600,
    neutronSvPerH: neutronSvPerS * 3600,
    totalSvPerH: (gammaSvPerS + neutronSvPerS) * 3600,
  };
}

/** Hours of continuous exposure at dose rate `svPerH` before reaching `limitSv`. */
export function hoursToLimit(svPerH, limitSv) {
  return svPerH > 0 ? limitSv / svPerH : Infinity;
}
