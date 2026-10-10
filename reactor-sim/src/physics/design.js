// Design definition and derived geometry for the coke-can reactor.
// All lengths are metres inside the physics; the UI converts to mm / cm.

import {
  CAN_RADIUS_M,
  CAN_HEIGHT_M,
  CAN_WALL_M,
  G0,
  SIGMA_SB,
} from './constants.js';
import {
  FUELS,
  COOLANTS,
  SHIELDS,
  STRUCTURAL,
  VESSELS,
  CONVERTERS,
  saturationK,
  coolantDensity,
  coolantCp,
  fuelConductivity,
} from './materials.js';
import { stackNaturalFrequency } from './vibration.js';

// Reference conductivities for conduction paths outside the core (W/(m K), order of magnitude).
export const SHIELD_CONDUCTIVITY = {
  lead: 35,
  tungsten: 170,
  borated_pe: 0.4,
  water: 0.6,
};
export const SHIELD_CP = {
  lead: 129,
  tungsten: 132,
  borated_pe: 1900,
  water: 4186,
};
export const CONVERTER_CONDUCTIVITY = {
  bi2te3: 1.5,
  skutterudite: 2.5,
  sige: 5,
  stirling: 10,
};

/** The reference design. Every field is editable in the UI. */
export function defaultDesign() {
  return {
    fuel: 'uo2',
    coolant: 'water',
    coolantPressureMPa: COOLANTS.water.defaultPressureMPa,
    vessel: 'al3004',
    vesselThicknessM: CAN_WALL_M,
    structure: 'ss316',
    fuelRadiusM: 0.012,
    fuelHeightM: 0.06,
    coolantGapM: 0.003,
    specificPowerWPerCm3: 0.2, // sets rated thermal power = q''' x fuel volume
    coolantRiseDesignK: 20, // flow sized for this coolant temperature rise at rated power
    flowGps: null, // null -> derived from coolantRiseDesignK
    sinkUAWPerK: 0.2, // external radiator / heat-sink conductance on the can wall (W/K)
    emissivity: 0.3,
    convectionWPerM2K: 8,
    converter: 'bi2te3',
    gammaShield: { id: 'lead', thicknessM: 0.006 },
    neutronShield: { id: 'borated_pe', thicknessM: 0.004 },
    rods: { count: 3, worthTotal: 0.06, dropTimeS: 1.5, signalDelayS: 0.2, pStuck: 0.002 },
    excessReactivity: 0.025, // hot-state excess: covers moderator + Doppler feedback at full power
    supportAreaM2: 2e-6,
    supportLengthM: 0.06,
    vibration: { psd: 0.04, fLoHz: 20, fHiHz: 2000, zeta: 0.05, fnOverrideHz: null },
    vibrationReactivityPerMm: 2e-3,
    sensors: { fluxSigma: 0.01, tempSigmaK: 3, flowSigma: 0.02, vibrationSigmaG: 0.5, tauS: 0.2 },
    pump: { toleranceFrac: 0.03, coastDownTauS: 3, naturalCirculationFrac: 0.03, vibrationFlowPerG: 0.001 },
    ambientK: 293.15,
    trips: { powerFrac: 1.15, fuelTempFrac: 0.9, flowFrac: 0.7, grmsG: 30, wallTempMargin: 0.95, coolantMarginK: 10 },
    controller: { setpointFrac: 1.0, kp: 0.6, ki: 0.05, maxRateSPerS: 0.02 },
    meltRatePerKPerS: 0.02,
    releaseFractionDestroyed: 0.2,
    releaseFractionBreach: 0.05,
    dosePointM: 1.0,
  };
}

/** Derive geometry, masses, conductances and rated power from a design. */
export function deriveDesign(design) {
  const d = design;
  const fuel = FUELS[d.fuel];
  const coolant = COOLANTS[d.coolant];
  const structure = STRUCTURAL[d.structure];
  const vessel = VESSELS[d.vessel];
  const converter = CONVERTERS[d.converter];
  const gShield = SHIELDS[d.gammaShield.id];
  const nShield = SHIELDS[d.neutronShield.id];

  const rf = d.fuelRadiusM;
  const H = d.fuelHeightM;
  const rc = rf + d.coolantGapM; // coolant outer radius
  const fuelVolume = Math.PI * rf * rf * H;
  const coolantVolume = Math.PI * (rc * rc - rf * rf) * H;
  const fuelVolumeCm3 = fuelVolume * 1e6;
  const ratedPowerW = d.specificPowerWPerCm3 * fuelVolumeCm3;

  // Converter wraps the coolant as a sheet of thickness set by its volume.
  const converterVolume = converter.volumeCm3 * 1e-6;
  const converterThickness = converterVolume / (2 * Math.PI * rc * H);
  const r1 = rc;
  const r2 = rc + converterThickness;
  const r3 = r2 + d.gammaShield.thicknessM;
  const r4 = r3 + d.neutronShield.thicknessM;
  const innerCanRadius = CAN_RADIUS_M - CAN_WALL_M;
  const shieldVolume = Math.PI * (r3 * r3 - r2 * r2) * CAN_HEIGHT_M + Math.PI * (r4 * r4 - r3 * r3) * CAN_HEIGHT_M;
  const gammaShieldVolume = Math.PI * (r3 * r3 - r2 * r2) * CAN_HEIGHT_M;
  const neutronShieldVolume = Math.PI * (r4 * r4 - r3 * r3) * CAN_HEIGHT_M;
  const shieldMass = gammaShieldVolume * gShield.rho + neutronShieldVolume * nShield.rho;
  const shieldHeatCapacity =
    gammaShieldVolume * gShield.rho * SHIELD_CP[d.gammaShield.id] +
    neutronShieldVolume * nShield.rho * SHIELD_CP[d.neutronShield.id];

  const supportCount = 1;
  const supportVolume = supportCount * d.supportAreaM2 * d.supportLengthM;
  const envelopeVolume = Math.PI * CAN_RADIUS_M * CAN_RADIUS_M * CAN_HEIGHT_M;
  const usedVolume = fuelVolume + coolantVolume + converterVolume + shieldVolume + supportVolume;

  const fuelMass = fuel.rho * fuelVolume;
  const coolantDensityNom = coolantDensity(d.coolant, 340, d.coolantPressureMPa);
  const coolantMassFull = coolantDensityNom * coolantVolume;
  const structureMass = structure.rho * supportVolume;

  // Coolant flow (kg/s) sized for the design temperature rise, unless overridden.
  const cpRef = coolantCp(d.coolant, 340); // operating coolant temperature (K)
  const flowNom = d.flowGps != null ? d.flowGps / 1000 : ratedPowerW / (cpRef * d.coolantRiseDesignK);

  // Stack natural frequency and mass.
  const fnStack =
    d.vibration.fnOverrideHz ??
    stackNaturalFrequency(structure.E, d.supportAreaM2, d.supportLengthM, fuelMass || 1e-9);

  // Fuel-to-coolant conduction resistance term, 1/(8 pi k H), at the reference temperature.
  const kFuelRef = fuelConductivity(d.fuel, 1000);
  const conductionG = 8 * Math.PI * kFuelRef * H; // W/K (uniform generation, average-to-surface)

  // Coolant<->can wall path: converter, then gamma shield, then neutron shield (series cylinders).
  const cyl = (k, ra, rb) => (2 * Math.PI * k * H) / Math.log(rb / ra);
  const gConv = cyl(CONVERTER_CONDUCTIVITY[d.converter], r1, r2);
  const gGam = cyl(SHIELD_CONDUCTIVITY[d.gammaShield.id], r2, r3);
  const gNeu = cyl(SHIELD_CONDUCTIVITY[d.neutronShield.id], r3, r4);
  const gCoolantToWall = 1 / (1 / gConv + 1 / gGam + 1 / gNeu);

  const canOuterArea = 2 * Math.PI * CAN_RADIUS_M * CAN_HEIGHT_M + 2 * Math.PI * CAN_RADIUS_M * CAN_RADIUS_M;
  const wallHeatCapacity = vessel.rho * canOuterArea * CAN_WALL_M * vessel.cp + shieldHeatCapacity;

  // Lambda (prompt neutron generation time): thermal spectrum for water, fast for others.
  const Lambda = coolant.spectrum === 'thermal' ? 1.0e-4 : 5.0e-7;

  // Hoop stress in the can (thin-wall) for the design pressure.
  const meanRadius = CAN_RADIUS_M - CAN_WALL_M / 2;
  const hoopStress = (d.coolantPressureMPa * 1e6 * meanRadius) / d.vesselThicknessM;
  const hoopLimit = vessel.yieldPa / 1.5;

  // Coolant saturation at the design pressure.
  const tSat = saturationK(d.coolant, d.coolantPressureMPa);

  return {
    fuel,
    coolant,
    structure,
    vessel,
    converter,
    gammaShield: { ...gShield, id: d.gammaShield.id, thicknessM: d.gammaShield.thicknessM },
    neutronShield: { ...nShield, id: d.neutronShield.id, thicknessM: d.neutronShield.thicknessM },
    rf,
    H,
    rc,
    r1,
    r2,
    r3,
    r4,
    innerCanRadius,
    fuelVolume,
    coolantVolume,
    converterVolume,
    converterThickness,
    shieldVolume,
    supportVolume,
    envelopeVolume,
    usedVolume,
    fuelMass,
    coolantMassFull,
    structureMass,
    shieldMass,
    shieldHeatCapacity,
    wallHeatCapacity,
    ratedPowerW,
    flowNom,
    fnStack,
    conductionG,
    gCoolantToWall,
    gConv,
    gGam,
    gNeu,
    canOuterArea,
    Lambda,
    hoopStress,
    hoopLimit,
    tSat,
    tFuelDamage: fuel.damageFraction * fuel.tMelt,
    tFuelMelt: fuel.tMelt,
    tWallLimit: vessel.maxK,
    supportCount,
  };
}

/**
 * Geometry and budget checks. Returns { ok, violations[], warnings[] } where a violation
 * means the design cannot physically be built inside the Coke-can envelope.
 */
export function checkDesign(design) {
  const g = deriveDesign(design);
  const violations = [];
  const warnings = [];
  const fitRadius = g.r4 + 0; // outer edge of neutron shield
  if (fitRadius > g.innerCanRadius) {
    violations.push(
      `Shielding reaches ${(fitRadius * 1000).toFixed(1)} mm radius, beyond the can inner wall at ${(g.innerCanRadius * 1000).toFixed(1)} mm.`,
    );
  }
  if (design.fuelHeightM + 0.01 > CAN_HEIGHT_M) {
    violations.push('Fuel stack does not fit the 122 mm can height with end allowances.');
  }
  if (g.usedVolume > g.envelopeVolume) {
    violations.push(
      `Component volume ${(g.usedVolume * 1e6).toFixed(0)} cm³ exceeds the ${(g.envelopeVolume * 1e6).toFixed(0)} cm³ can envelope.`,
    );
  }
  if (g.hoopStress > g.hoopLimit) {
    violations.push(
      `Coolant pressure ${design.coolantPressureMPa} MPa gives a can hoop stress of ${(g.hoopStress / 1e6).toFixed(0)} MPa, above the ${(g.hoopLimit / 1e6).toFixed(0)} MPa allowable for a ${(design.vesselThicknessM * 1000).toFixed(2)} mm wall.`,
    );
  }
  if (design.coolantPressureMPa > 0 && g.tSat <= 0) {
    violations.push('Invalid saturation state.');
  }
  if (g.usedVolume / g.envelopeVolume > 0.9) {
    warnings.push('Above 90% of the can volume is used; little room for manufacturing tolerance.');
  }
  const fuelLimit = g.tFuelDamage;
  if (design.trips.fuelTempFrac > 1) warnings.push('Fuel trip set above the damage temperature.');
  if (g.coolant.freezeK > 0 && design.ambientK < g.coolant.freezeK) {
    warnings.push('Ambient is below the coolant freezing point; start-up requires heating.');
  }
  return { ok: violations.length === 0, violations, warnings, derived: g, fuelLimit };
}

/** Radiative plus convective conductance of the can surface (W/K) at wall temperature Tw. */
export function canSurfaceConductance(g, design, Tw, Ta) {
  const eps = design.emissivity;
  const radiative = eps * SIGMA_SB * (Tw * Tw + Ta * Ta) * (Tw + Ta);
  return g.canOuterArea * (design.convectionWPerM2K + radiative);
}

export { G0 };
