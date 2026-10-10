// Coke-can reactor simulator: builds the model from a configuration and advances it in time.
//
// Coupling per step (dt):
//   1. Scheduled events (pump trip, blockage, source surge, shield breach).
//   2. Flow: pump pulsation (bounded AR(1)), coast-down after a trip, blockage.
//   3. Reactivity: rods + Doppler + coolant-density feedback (+ core-kill poison).
//   4. Point kinetics (implicit) gives fission power.
//   5. Decay heat (Way-Wigner) after shutdown, and the operating inventory.
//   6. Thermal network (fuel, coolant, wall) with a flow-dependent film coefficient.
//   7. Thermoelectric output and vibration fatigue of the mount.
//   8. Radiation dose at the can surface, 10 cm and 1 m.
//   9. Sensors (noisy, 2-out-of-3 voting) -> protective SCRAM.
//      Physical limits on the true state -> accidents.
//  10. Accident with auto core-kill -> poison injection; fuel destroyed (irreversible).

import {
  FUEL, CLADDING, MODERATOR, REFLECTOR, SHIELD, COOLANT, STRUCTURE, ABSORBER,
  THERMOELECTRIC, POISON, coolantTmaxC, getMaterial,
} from './materials.js';
import { buildGeometry, coreVolumeFractions, PIN, ROD_RADIUS, TE_FILL, CAN } from './geometry.js';
import { buildRegionMacros, solveDiffusion, macroOfSinglePhase } from './neutronics.js';
import {
  stepKinetics, initialKinetics, sourceTerm, decayHeatFraction, generationTime, steadyPower,
} from './kinetics.js';
import {
  filmCoefficient, pinResistance, stepThermal, thermoelectricEta, teConductance,
  vesselBridge, canOuterArea, airConductance,
} from './thermal.js';
import {
  VIBRATION_PROFILES, psdAt, supportModel, milesDisplacement, rootStressRms,
  fatigueDamageRate, vibrationSensorNoise,
} from './vibration.js';
import { buildPaths, doseReport, sourceTerms, cf252Rate } from './radiation.js';
import { SAFETY_DEFAULTS, sensorReading, makeSensorSet, vote } from './safety.js';
import { createRng, boundedAr1 } from './rng.js';
import { E_FISSION_J, BETA_TOTAL, G0, K_OFFSET } from './constants.js';

export const DEFAULT_CONFIG = {
  materials: {
    fuel: 'UO2', cladding: 'ZRY4', moderator: 'NONE', reflector: 'BE', shield: 'W',
    coolant: 'H2O', structure: 'SS316L', absorber: 'B4C', te: 'BI2TE3',
  },
  enrichPct: 4.95,                                  // wt% U-235 (LEU)
  geometry: { shieldT: 6, reflT: 5, teT: 6, vesselT: 1.0 }, // mm
  coolant: { pMPa: 0.2, flowNominalGps: 5, ambientC: 25, hAirNatural: 10, fan: false },
  source: { kind: 'cf252', ug: 1e-5, nps: 0 },     // default: 10 pg Cf-252
  control: { rodsWithdrawn: 1.0 },                  // 1 = withdrawn (operating), 0 = inserted
  noise: {
    pulsationPct: 1.0,        // 1-sigma pump pulsation, AR(1)
    clampPct: 5.0,            // pulsation clamped to +/-5 %
    pulseTauS: 2.0,           // pulsation correlation time, s
    sensorBiasPct: 1.0,       // flow sensor bias range, +/-1 % (fixed per run)
    flowSensorNoisePct: 0.5,  // flow sensor random noise, 1-sigma
    powerNoisePct: 3,         // power channel noise, 1-sigma (%)
    dosimeterNoisePct: 10,    // GM-type dosimeter noise, 1-sigma (%)
  },
  vibration: { profile: 'none', scale: 1.0 },
  support: { dMm: 6, LMm: 20, zeta: null },         // zeta null -> material damping
  safety: { ...SAFETY_DEFAULTS },
  events: [],                                       // [{t, type, value, duration}]
  duration: 1800,
  seed: 1,
};

export function mergeConfig(partial = {}) {
  const out = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  for (const k of Object.keys(partial)) {
    const v = partial[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object') {
      out[k] = { ...out[k], ...v };
    } else {
      out[k] = v;
    }
  }
  out.safety = { ...SAFETY_DEFAULTS, ...(partial.safety || {}) };
  return out;
}

const NR = 40, NZ = 60;      // diffusion grid (radial x axial)

const fuelDensity = (mat) =>
  (mat.phases ? mat.phases.reduce((s, p) => s + p.vf * FUEL[p.ref].rho, 0) : mat.rho);

function resolveMaterials(cfg) {
  const m = cfg.materials;
  return {
    fuel: getMaterial('fuel', m.fuel),
    cladding: getMaterial('cladding', m.cladding),
    moderator: getMaterial('moderator', m.moderator),
    reflector: getMaterial('reflector', m.reflector),
    shield: getMaterial('shield', m.shield),
    coolant: getMaterial('coolant', m.coolant),
    structure: getMaterial('structure', m.structure),
    absorber: getMaterial('absorber', m.absorber),
    te: getMaterial('te', m.te),
  };
}

// Map a point (r, z) in cm to the region key used by the diffusion solver.
function regionOfFactory(geom) {
  const layers = geom.layers;
  return (rcm, zcm) => {
    const r = rcm * 10, z = zcm * 10;
    if (r > geom.R_in) return 'vessel';
    const L = layers.find((l) => z >= l.z0 && z < l.z1) || layers[layers.length - 1];
    switch (L.role) {
      case 'vessel': return 'vessel';
      case 'core':
        if (r <= geom.R_core) return 'core';
        if (r <= geom.R_core + geom.reflT) return 'refl';
        return 'shield';
      case 'reflector': return 'refl';
      case 'shield': return 'shield';
      case 'coolant': return 'coolant';
      case 'te': return 'te';
      default: return 'vessel';
    }
  };
}

// Validity of the thermal four-factor / two-stage diffusion model.
// The four-factor formula is a thermal-spectrum approximation: resonance escape p collapses when the
// moderating ratio of the core is too small (fast-spectrum cores such as helium, sodium, LBE or FLIBE
// in this compact can, where coolant is only a few per cent of the core volume). In that regime the
// model cannot give a meaningful k_inf, so the configuration is rejected with the reasons stated.
export const VALIDITY_LIMITS = { pMin: 0.5, kInfMin: 0.5, kInfMax: 3.0, k0Max: 1.2 };

export function modelValidity({ ff, k0, kInf0, PNL, rhoOut }) {
  const reasons = [];
  if (!(rhoOut < 0)) {
    reasons.push(`rods-withdrawn reactivity ${Number(rhoOut).toFixed(4)} is not subcritical: a source-driven steady state is undefined.`);
  }
  if (!(ff && ff.p >= VALIDITY_LIMITS.pMin)) {
    reasons.push(`resonance escape p = ${ff ? ff.p.toFixed(3) : 'n/a'} < ${VALIDITY_LIMITS.pMin}: `
      + 'the core is not moderated enough for the thermal four-factor model (fast spectrum).');
  }
  if (!(kInf0 >= VALIDITY_LIMITS.kInfMin && kInf0 <= VALIDITY_LIMITS.kInfMax)) {
    reasons.push(`k_inf = ${Number(kInf0).toFixed(3)} outside [${VALIDITY_LIMITS.kInfMin}, ${VALIDITY_LIMITS.kInfMax}].`);
  }
  if (!(k0 > 0 && k0 <= VALIDITY_LIMITS.k0Max && Number.isFinite(PNL))) {
    reasons.push(`diffusion k_eff = ${Number(k0).toFixed(3)} or P_NL = ${Number(PNL).toFixed(3)} is not physical.`);
  }
  return { valid: reasons.length === 0, reasons };
}

// Build the base (time-independent) model from a configuration.
export function buildBaseModel(partialCfg) {
  const cfg = mergeConfig(partialCfg);
  const mats = resolveMaterials(cfg);
  const geom = buildGeometry(cfg.geometry);
  const hasMod = mats.moderator.rho > 0;
  const fr = coreVolumeFractions(geom, hasMod);
  const pMPa = cfg.coolant.pMPa;

  // Initial temperature: ambient, raised for liquid metals and salts so that they start liquid.
  const Tamb = cfg.coolant.ambientC + K_OFFSET;
  const T0 = Math.max(Tamb, mats.coolant.Tmelt + K_OFFSET + 20);
  const rho0 = mats.coolant.rhoFn(T0, pMPa);

  const buildAt = (rhoC) => buildRegionMacros({
    fuelMat: mats.fuel, cladMat: mats.cladding, wallMat: mats.structure,
    moderatorMat: mats.moderator, reflMat: mats.reflector, shieldMat: mats.shield,
    coolantMat: mats.coolant, teMat: mats.te, fractions: fr, enrichPct: cfg.enrichPct,
    coolantRho: rhoC, pMPa, TK: T0, fuelRadiusCm: PIN.rFuel / 10,
  });

  const base = buildAt(rho0);
  const regionOf = regionOfFactory(geom);
  const solve0 = solveDiffusion({ Rcm: geom.R_env / 10, Hcm: geom.H_env / 10, NR, NZ, regionOf, macros: base.macros });
  const k0 = solve0.k;
  const kInf0 = base.ff.kInf;
  const PNL = k0 / kInf0;

  // Generation time from the fundamental-mode flux (includes leakage).
  const cells = solve0.flux.map((phi, c) => ({
    phi, V: solve0.Vcell[c], nuSf: base.macros[solve0.cellRegion[c]].nuSf || 0,
  }));
  const Lambda = generationTime(cells, 2.2e5);

  // Control rods: absorber in the guide bore, flux-weighted by 0.2 (assumption; see notes).
  const absM = macroOfSinglePhase(mats.absorber.comp, mats.absorber.rho, 0);
  const fRod = (Math.PI * ROD_RADIUS ** 2) / geom.A_core;
  const W_FLUX = 0.2;
  const SaTot = base.coreM.Sa;
  const dSaRod = fRod * absM.Sa * W_FLUX;
  const kIn = k0 * SaTot / (SaTot + dSaRod);
  const rhoOf = (k) => (k - 1) / k;
  const rhoOut = rhoOf(k0);
  const rhoIn = rhoOf(kIn);

  // Core kill: Gd2O3 slurry in 5 % of the core volume.
  const poiM = macroOfSinglePhase(POISON.comp, POISON.rho, 0);
  const dSaPoison = 0.05 * poiM.Sa;
  const kKill = Math.max(k0 * SaTot / (SaTot + dSaPoison), 1e-12);
  const rhoKill = rhoOf(kKill);

  // Coolant-density reactivity table, rho_C(r) with r = rho / rho0 (four-factor k_inf ratio).
  const rTab = [0.3, 0.5, 0.7, 0.85, 1.0, 1.1, 1.25, 1.5, 2.0];
  const rhoTab = rTab.map((r) => {
    const kI = buildAt(rho0 * r).ff.kInf;
    return rhoOf(k0 * kI / kInf0) - rhoOut;
  });

  // Thermal masses (kg). Volumes are in mm^3 from the geometry.
  const V = geom.V;
  const fuelRho = fuelDensity(mats.fuel);
  const coolVol = (V.coreVoid * fr.coolant / geom.fractions.void || 0) + V.plenum;   // mm^3
  const modVol = hasMod ? (V.coreVoid * fr.moderator / geom.fractions.void || 0) : 0;
  const mFuel = (V.fuel / 1e3) * fuelRho / 1e3;
  const mClad = (V.clad / 1e3) * mats.cladding.rho / 1e3;
  const mCool = (coolVol / 1e3) * rho0 / 1e3;
  const mMod = (modVol / 1e3) * mats.moderator.rho / 1e3;
  const mShield = (V.shield / 1e3) * mats.shield.rho / 1e3;
  const mRefl = (V.reflector / 1e3) * mats.reflector.rho / 1e3;
  const mTE = (V.te / 1e3) * TE_FILL * mats.te.rho / 1e3;
  const mVessel = (V.vessel / 1e3) * mats.structure.rho / 1e3 + (V.guideWall / 1e3) * mats.structure.rho / 1e3;
  const mPayload = mFuel + mClad + mCool + mMod + mShield + mRefl + mTE;
  const mTotal = mPayload + mVessel;

  const Cf = mFuel * mats.fuel.cp + mClad * mats.cladding.cp + mMod * (mats.moderator.cp || 0);
  const Cb = mCool * mats.coolant.cp + 1e-3;
  const Cw = mVessel * mats.structure.cp + mShield * mats.shield.cp + mRefl * mats.reflector.cp + mTE * mats.te.cp + 1e-3;

  // Radiation attenuation per region: mu (cm^-1, 1 MeV) and Sigma_R (cm^-1, fast removal).
  const radOf = (macro, rho, sigR) => ({ mu: macro.Smu1, Sigma_R: rho * sigR });
  const fuelM = base.fuelM;
  const radFuel = radOf(fuelM, fuelRho, 0.0126);
  const cladM = macroOfSinglePhase(mats.cladding.comp, mats.cladding.rho, 0);
  const radClad = radOf(cladM, mats.cladding.rho, 0.0126);
  const radCool = radOf(base.coolM, rho0, mats.coolant.sigR ?? 0.05);
  const wallM = macroOfSinglePhase(mats.structure.comp, mats.structure.rho, 0);
  const radWall = radOf(wallM, mats.structure.rho, 0.025);
  const radCore = {
    mu: fr.fuel * radFuel.mu + fr.clad * radClad.mu + fr.guideWall * radWall.mu + fr.coolant * radCool.mu,
    Sigma_R: fr.fuel * radFuel.Sigma_R + fr.clad * radClad.Sigma_R + fr.guideWall * radWall.Sigma_R + fr.coolant * radCool.Sigma_R,
  };
  if (hasMod) {
    const mm = macroOfSinglePhase(mats.moderator.comp, mats.moderator.rho, 0);
    const rr = radOf(mm, mats.moderator.rho, 0.04);
    radCore.mu += fr.moderator * rr.mu;
    radCore.Sigma_R += fr.moderator * rr.Sigma_R;
  }
  const radShield = radOf(macroOfSinglePhase(mats.shield.comp, mats.shield.rho, 0), mats.shield.rho, mats.shield.sigR);
  const radRefl = radOf(macroOfSinglePhase(mats.reflector.comp, mats.reflector.rho, 0), mats.reflector.rho, mats.reflector.sigR);
  const teM = macroOfSinglePhase(mats.te.comp, mats.te.rho, 0);
  const radTE = { mu: TE_FILL * teM.Smu1, Sigma_R: TE_FILL * mats.te.rho * 0.02 };
  const radMats = { core: radCore, refl: radRefl, shield: radShield, vessel: radWall, coolant: radCool, te: radTE };

  // Support mount: cantilever stub carrying the payload.
  const zeta = cfg.support.zeta ?? mats.structure.zeta;
  const sup = supportModel({
    E_GPa: mats.structure.E, dMm: cfg.support.dMm, LMm: cfg.support.LMm,
    mKg: Math.max(mPayload, 1e-3), zeta,
  });

  const validity = modelValidity({ ff: base.ff, k0, kInf0, PNL, Lambda, rhoOut });

  return {
    cfg, geom, mats, fr, hasMod, pMPa, T0, rho0, valid: validity.valid, validity, ff: base.ff,
    k0, kInf0, PNL, Lambda, kIn, rhoIn, rhoOut, rhoKill, kKill, dSaRod, dSaPoison,
    rTab, rhoTab, alphaD: mats.fuel.alphaD,
    coreM: base.coreM, fuelM, coolM: base.coolM,
    thermal: { Cf, Cb, Cw, mFuel, mClad, mCool, mMod, mShield, mRefl, mTE, mVessel, mPayload, mTotal },
    radMats,
    paths: buildPaths(geom, radMats),
    buildPathsFor: (shieldScale) => buildPaths({ ...geom, shieldT: geom.shieldT * shieldScale }, radMats),
    vib: { sup, supMat: mats.structure, zeta },
    peaking: solve0.radialPeaking,
    solveIters: solve0.iterations,
    pinCount: geom.pinCount,
    coreHeightM: geom.H_core * 1e-3,
    coolFlowAreaM2: geom.A_void * 1e-6,
    hydraulicDiameterM: geom.hydraulicDiameter * 1e-3,
    G: {
      TE: teConductance({ k: mats.te.k, areaM2: Math.PI * (geom.R_in * 1e-3) ** 2, lengthM: geom.teT * 1e-3 }),
      bridge: vesselBridge({ kVessel: mats.structure.k, RinM: geom.R_in * 1e-3, wallM: geom.vesselT * 1e-3, HM: geom.H_env * 1e-3 }),
      area: canOuterArea(CAN.D_mm * 1e-3, CAN.H_mm * 1e-3),
    },
  };
}

// Cache base models keyed by the design-relevant parts of the configuration.
const baseCache = new Map();
export function getBaseModel(partialCfg) {
  const cfg = mergeConfig(partialCfg);
  const key = JSON.stringify({
    m: cfg.materials, e: cfg.enrichPct, g: cfg.geometry, p: cfg.coolant.pMPa,
    a: cfg.coolant.ambientC, s: cfg.support,
  });
  if (!baseCache.has(key)) {
    if (baseCache.size > 64) baseCache.clear();
    baseCache.set(key, buildBaseModel(cfg));
  }
  return baseCache.get(key);
}

// Generation time helper (exported for tests).
export { generationTime };

// ------------------------------------------------------------------ simulator

export function createReactor(partialCfg = {}) {
  const cfg = mergeConfig(partialCfg);
  const B = getBaseModel(cfg);
  if (!B.valid && !partialCfg.allowInvalid) {
    throw new Error(`Configuration outside the validated model range: ${B.validity.reasons.join(' ')}`);
  }
  const mats = B.mats;
  const pMPa = cfg.coolant.pMPa;
  const rng = createRng(cfg.seed);

  // Sensors (biases fixed for the run; noise drawn each step).
  const flowSensors = makeSensorSet(rng, {
    relNoise: cfg.noise.flowSensorNoisePct / 100, biasRange: cfg.noise.sensorBiasPct / 100,
  });
  const powerSensors = makeSensorSet(rng, { relNoise: cfg.noise.powerNoisePct / 100, biasRange: 0.02 });
  const tempSensors = makeSensorSet(rng, { absNoise: 0.5, absBiasRange: 1.0 });
  const doseSensors = makeSensorSet(rng, { relNoise: cfg.noise.dosimeterNoisePct / 100, biasRange: 0.1 });

  const srcRate = () => (cfg.source.kind === 'cf252' ? cf252Rate(cfg.source.ug) : (cfg.source.nps || 0));
  const flowNom = cfg.coolant.flowNominalGps * 1e-3;          // kg/s
  const profile = VIBRATION_PROFILES[cfg.vibration.profile] || VIBRATION_PROFILES.none;
  const sup = B.vib.sup;
  const supMat = B.vib.supMat;

  // Initial state: equilibrium power for the initial reactivity.
  const Lambda = B.Lambda;
  const rho0 = B.rhoOut + (B.rhoIn - B.rhoOut) * (1 - cfg.control.rodsWithdrawn);
  const q0 = sourceTerm(srcRate(), Lambda);
  const P0 = Math.max(0, steadyPower({ rho: rho0, Lambda, q: q0 }) || 0);

  const st = {
    t: 0,
    Tf: B.T0, Tb: B.T0, Tw: B.T0,
    kin: initialKinetics(P0, Lambda),
    rodW: cfg.control.rodsWithdrawn,
    scrammed: false, tScram: null, P0Scram: 0,
    destroyed: false, tKill: null, killReason: null,
    pumpTripped: false, tPumpTrip: null,
    blockage: 0,
    sourceFactor: 1, sourceFactorUntil: -1,
    shieldScale: 1,
    vibOn: cfg.vibration.profile !== 'none' && cfg.vibration.scale > 0,
    pulse: 0,
    damage: 0,
    energyTh: 0, energyE: 0,
    trips: [], accidents: [],
    lowFlowT: 0, lossFlowT: 0, scramHoldT: 0,
    Ppower: P0,
    flowTrue: flowNom,
    eventsDone: new Set(),
    paths: B.paths,
  };
  let last = null;

  // Coolant reactivity: linear interpolation in the density-ratio table.
  function coolantReactivity(TbK) {
    const r = mats.coolant.rhoFn(TbK, pMPa) / B.rho0;
    const tab = B.rTab, val = B.rhoTab;
    if (r <= tab[0]) return val[0];
    if (r >= tab[tab.length - 1]) return val[val.length - 1];
    for (let i = 1; i < tab.length; i++) {
      if (r <= tab[i]) {
        const f = (r - tab[i - 1]) / (tab[i] - tab[i - 1]);
        return val[i - 1] + f * (val[i] - val[i - 1]);
      }
    }
    return 0;
  }

  function doScram(t, reason) {
    if (st.scrammed) return;
    st.scrammed = true;
    st.tScram = t;
    st.P0Scram = st.Ppower;
    st.trips.push({ t, reason });
  }

  function killCore(t, reason) {
    if (st.destroyed) return;
    st.destroyed = true;
    st.tKill = t;
    st.killReason = reason;
    if (!st.scrammed) { st.scrammed = true; st.tScram = t; st.P0Scram = st.Ppower; }
  }

  function accident(t, reason) {
    if (!st.accidents.some((a) => a.reason === reason)) st.accidents.push({ t, reason });
    if (cfg.safety.autoCoreKill) killCore(t, reason);
  }

  function applyEvents(t) {
    cfg.events.forEach((ev, i) => {
      if (st.eventsDone.has(i) || t < ev.t) return;
      st.eventsDone.add(i);
      switch (ev.type) {
        case 'pump_trip': st.pumpTripped = true; st.tPumpTrip = t; break;
        case 'blockage': st.blockage = Math.min(0.95, Math.max(0, ev.value ?? 0.5)); break;
        case 'source_surge':
          st.sourceFactor = ev.value ?? 10;
          st.sourceFactorUntil = t + (ev.duration ?? 60);
          break;
        case 'shield_breach':
          st.shieldScale = Math.max(0, Math.min(1, ev.value ?? 0.5));
          st.paths = B.buildPathsFor(st.shieldScale);
          break;
        case 'manual_scram': doScram(t, 'manual'); break;
        case 'manual_kill': killCore(t, 'manual_kill'); break;
        default: break;
      }
    });
  }

  function step(dt) {
    const t = st.t;
    applyEvents(t);
    const S_ = cfg.safety;

    // 2. Flow ---------------------------------------------------------------
    st.pulse = boundedAr1(rng, st.pulse, {
      phi: Math.exp(-dt / cfg.noise.pulseTauS),
      sigma: cfg.noise.pulsationPct / 100,
      bound: cfg.noise.clampPct / 100,
    });
    let mdot;
    if (st.pumpTripped) {
      const tau = 2.0, floor = 0.03;               // coast-down to natural circulation
      mdot = flowNom * (floor + (1 - floor) * Math.exp(-(t - st.tPumpTrip) / tau));
    } else {
      mdot = flowNom * (1 + st.pulse);
    }
    mdot *= 1 - st.blockage;
    st.flowTrue = mdot;

    // Film coefficient and conductances ------------------------------------
    const coolRho = mats.coolant.rhoFn(st.Tb, pMPa) * 1000;   // kg/m^3
    const fc = filmCoefficient({
      mdot: Math.max(mdot, 1e-9), A_flow: B.coolFlowAreaM2, Dh: B.hydraulicDiameterM,
      rho: coolRho, mu: mats.coolant.muFn(st.Tb), k: mats.coolant.kFn(st.Tb), cp: mats.coolant.cp,
    });
    const pr = pinResistance({
      kFuel: mats.fuel.kFn(st.Tf), kClad: mats.cladding.k, h: fc.h,
      rCladIn: PIN.rCladIn * 1e-3, rCladOut: PIN.rCladOut * 1e-3,
    });
    const Gfb = B.pinCount * B.coreHeightM / pr.Rtot;
    const TairK = cfg.coolant.ambientC + K_OFFSET;
    const Gwa = airConductance({
      area: B.G.area, hConv: cfg.coolant.hAirNatural * (cfg.coolant.fan ? 3 : 1), TwK: st.Tw, TairK,
    });
    const Gbw = B.G.TE + B.G.bridge;

    // 3. Reactivity -----------------------------------------------------------
    st.rodW = st.scrammed ? Math.max(0, st.rodW - dt / 2.5) : cfg.control.rodsWithdrawn;
    const rhoRods = B.rhoOut + (B.rhoIn - B.rhoOut) * (1 - st.rodW);
    const rhoDoppler = B.alphaD * (st.Tf - B.T0);
    const rhoCool = coolantReactivity(st.Tb);
    let rho = rhoRods + rhoDoppler + rhoCool;
    if (st.destroyed) rho = B.rhoKill;
    const kEff = 1 / (1 - rho);

    // 4. Kinetics -------------------------------------------------------------
    const srcFactor = st.sourceFactorUntil > t ? st.sourceFactor : 1;
    const genOff = st.scrammed && cfg.source.kind === 'nps' && S_.scramCutsGenerator;
    const S = genOff ? 0 : srcRate() * srcFactor;
    if (rho >= BETA_TOTAL && !st.destroyed) accident(t, 'prompt_critical');
    const q = st.destroyed ? 0 : sourceTerm(S, Lambda);
    st.kin = stepKinetics(st.kin, { rho, Lambda, q, dt });
    const Pfis = st.kin.P;
    st.Ppower = Pfis;

    // 5. Decay heat -----------------------------------------------------------
    let Pdec;
    if (st.scrammed && st.tScram !== null) {
      Pdec = st.P0Scram * decayHeatFraction(t - st.tScram, Math.max(st.tScram, 1));
    } else {
      // Operating inventory: Way-Wigner evaluated at 10 s after an imaginary shutdown.
      Pdec = Pfis * decayHeatFraction(10, Math.max(t, 1));
    }
    const Pth = Pfis + Pdec;

    // 6. Thermal -------------------------------------------------------------
    const th = stepThermal(
      { Tf: st.Tf, Tb: st.Tb, Tw: st.Tw },
      { Cf: B.thermal.Cf, Cb: B.thermal.Cb, Cw: B.thermal.Cw, Gfb, Gbw, Gwa, Pin: Pth, Tair: TairK },
      dt,
    );
    st.Tf = th.Tf; st.Tb = th.Tb; st.Tw = th.Tw;

    // Peak (local) temperatures from the fission-rate peaking factor.
    const pk = B.peaking;
    const TfMax = st.Tb + Math.max(0, st.Tf - st.Tb) * pk;
    const TcladMax = st.Tb + Math.max(0, st.Tf - st.Tb) * ((pr.Rh + pr.Rc) / pr.Rtot) * pk;

    // 7. Thermoelectric output -------------------------------------------------
    const etaTE = thermoelectricEta(st.Tb, st.Tw, mats.te.ZT);
    const QTE = B.G.TE * Math.max(0, st.Tb - st.Tw);
    const teOver = st.Tb - K_OFFSET > mats.te.Tmax;
    const Pe = teOver ? 0 : etaTE * QTE;

    // 8. Vibration -------------------------------------------------------------
    let zRms = 0, sigRms = 0, peakStress = 0, dRate = 0;
    if (st.vibOn) {
      const Gf = psdAt(profile.psd, sup.fn) * cfg.vibration.scale;
      zRms = milesDisplacement({ fn: sup.fn, Q: sup.Q, gPsdAtFn: Gf });
      sigRms = rootStressRms({ E: sup.E, d: sup.d, L: sup.L, zRms });
      peakStress = 3 * sigRms;
      dRate = fatigueDamageRate({ fn: sup.fn, sigmaRms: sigRms, sigmaF: supMat.sigF * 1e6, b: supMat.bFat });
      st.damage += dRate * dt;
    }
    const aRmsG = st.vibOn ? (zRms * (2 * Math.PI * sup.fn) ** 2) / G0 : 0;
    const vibNoise = st.vibOn ? vibrationSensorNoise(aRmsG) : 0;

    // 9. Radiation -------------------------------------------------------------
    const F = Pfis / E_FISSION_J;
    const src = sourceTerms({ srcNps: S, F, kEff, kInf: B.kInf0, pNL: B.PNL, Pdecay: Pdec });
    const dose = doseReport({ paths: st.paths, Sn_eff: src.Sn_eff, Sg: src.Sg });

    // 10. Sensors and voting ---------------------------------------------------
    const ext = (s) => ({ ...s, extraNoise: vibNoise });
    const flowMeas = flowSensors.map((s) => sensorReading(st.flowTrue * 1000, ext(s), rng));  // g/s
    const pMeas = powerSensors.map((s) => sensorReading(Pfis, ext(s), rng));
    const tfMeas = tempSensors.map((s) => sensorReading(TfMax - K_OFFSET, ext(s), rng));
    const tcMeas = tempSensors.map((s) => sensorReading(TcladMax - K_OFFSET, ext(s), rng));
    const tbMeas = tempSensors.map((s) => sensorReading(st.Tb - K_OFFSET, ext(s), rng));
    const doseMeas = doseSensors.map((s) => sensorReading(dose.surface, ext(s), rng));

    const flowNomGps = flowNom * 1000;
    const tbLim = coolantTmaxC(mats.coolant, pMPa) + K_OFFSET;
    const tfLim = mats.fuel.Tlimit + K_OFFSET;
    const tcLim = mats.cladding.Tmax + K_OFFSET;
    const tfMelt = mats.fuel.Tmelt + K_OFFSET;
    const mode = S_.voting;

    if (!st.destroyed && !st.scrammed) {
      const over = vote(pMeas, (p) => p > S_.designPowerW * S_.overpowerFactor, mode);
      const lowFlow = vote(flowMeas, (f) => f < flowNomGps * S_.flowLowFrac, mode);
      st.lowFlowT = lowFlow ? st.lowFlowT + dt : 0;
      const tempTrip =
        vote(tfMeas, (T) => T + K_OFFSET > tfLim - S_.tripMarginK, mode) ||
        vote(tcMeas, (T) => T + K_OFFSET > tcLim - S_.tripMarginK, mode) ||
        vote(tbMeas, (T) => T + K_OFFSET > tbLim - S_.tripMarginK, mode);
      const doseTrip = vote(doseMeas, (d) => d > S_.doseLimitSurfaceUSvh, mode);
      if (over) doScram(t, 'overpower');
      else if (st.lowFlowT >= S_.flowLowHoldS) doScram(t, 'low_flow');
      else if (tempTrip) doScram(t, 'temperature');
      else if (doseTrip) doScram(t, 'dose');
      else if (st.vibOn && st.damage > S_.fatigueAlarm) doScram(t, 'fatigue');
    }

    // Accidents on the TRUE physical state (sensors do not change physics).
    if (!st.destroyed) {
      if (TfMax >= tfMelt) accident(t, 'fuel_melt');
      else if (TcladMax >= tcLim) accident(t, 'clad_breach');
      else if (st.Tb >= tbLim) accident(t, 'coolant_overtemp');
      else if (mats.coolant.Tmelt > -100 && st.Tb <= mats.coolant.Tmelt + K_OFFSET) accident(t, 'coolant_freeze');
    }
    if (!st.destroyed) {
      if (mdot / flowNom < S_.lossOfCoolingFlowFrac) {
        st.lossFlowT += dt;
        if (st.lossFlowT >= S_.lossOfCoolingHoldS) accident(t, 'loss_of_cooling');
      } else {
        st.lossFlowT = 0;
      }
      if (st.vibOn && st.damage >= S_.fatigueFailure) accident(t, 'structural_fatigue');
      else if (st.vibOn && peakStress >= supMat.yield * 1e6) accident(t, 'structural_yield');
      if (dose.surface > S_.doseLimitSurfaceUSvh) accident(t, 'dose_exceeded');
      if (st.scrammed && (TfMax > tfLim || TcladMax > tcLim)) {
        st.scramHoldT += dt;
        if (st.scramHoldT >= S_.scramHoldS) accident(t, 'scram_failed');
      } else {
        st.scramHoldT = 0;
      }
    }

    // Integrated outputs --------------------------------------------------------
    st.energyTh += Pth * dt;
    st.energyE += Pe * dt;
    st.t = t + dt;

    last = {
      t: st.t,
      state: st.destroyed ? 'DESTROYED' : st.scrammed ? 'SCRAMMED' : 'RUNNING',
      Pfis, Pdec, Pth, Pe, etaTE,
      kEff, rho, rhoRods, rhoDoppler, rhoCool,
      rodW: st.rodW,
      TfMaxC: TfMax - K_OFFSET, TcladMaxC: TcladMax - K_OFFSET, TbC: st.Tb - K_OFFSET, TwC: st.Tw - K_OFFSET,
      teHotC: st.Tb - K_OFFSET, teOver,
      flowTrueGps: st.flowTrue * 1000,
      flowMeasGps: flowMeas,
      flowNomGps,
      h: fc.h, Re: fc.Re, Pr: fc.Pr, Nu: fc.Nu, velocity: fc.velocity,
      Gfb, Gbw, Gwa,
      vib: {
        on: st.vibOn, profile: profile.id, fn: sup.fn, zRmsMm: zRms * 1e3,
        sigmaRmsMPa: sigRms / 1e6, peakMPa: peakStress / 1e6, yieldMPa: supMat.yield,
        damage: st.damage, dRate, aRmsG,
      },
      dose: {
        surface: dose.surface, at10cm: dose.at10cm, at1m: dose.at1m,
        side: dose.side, top: dose.top, bottom: dose.bottom, Sn: src.Sn_eff, Sg: src.Sg,
      },
      trips: st.trips.slice(-5),
      accidents: st.accidents.slice(-5),
      destroyed: st.destroyed, killReason: st.killReason, tKill: st.tKill, tScram: st.tScram,
      sourceFactor: srcFactor,
      meas: { P: pMeas, flow: flowMeas, tf: tfMeas, tc: tcMeas, dose: doseMeas },
      energyThJ: st.energyTh, energyEJ: st.energyE,
      mass: B.thermal.mTotal,
      PNL: B.PNL,
      Lambda,
      shieldScale: st.shieldScale,
    };
    return last;
  }

  // Run for a duration, sampling every `sampleEvery` seconds.
  function run(dt, duration, { sampleEvery = 1 } = {}) {
    const rec = [];
    let nextSample = 0;
    const n = Math.round(duration / dt);
    for (let i = 0; i < n; i++) {
      const r = step(dt);
      if (r.t >= nextSample - 1e-9) {
        rec.push(r);
        nextSample += sampleEvery;
      }
    }
    return rec;
  }

  return {
    cfg,
    base: B,
    step,
    run,
    get state() { return st; },
    get last() { return last; },
  };
}
