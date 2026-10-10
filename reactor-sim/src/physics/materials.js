// Swappable material library. Each entry carries the properties the physics modules read.
// Values are handbook-order-of-magnitude unless a source is cited in docs/RESEARCH-NOTES.md.
// Anything marked `estimate: true` is NOT sourced and is flagged in the UI.

import { R_GAS, AVOGADRO, R_ELECTRON_CM } from './constants.js';

// ---------------------------------------------------------------- fuels
// k(T) for UO2 uses the Lucuta-type correlation for unirradiated ~95% dense pellets.
export const FUELS = {
  uo2: {
    name: 'UO₂ ceramic pellets',
    rho: 10970, // kg/m^3
    cp: 350, // J/(kg K) near 1000 K
    kModel: 'uo2',
    tMelt: 3120, // K
    damageFraction: 0.7, // fraction of Tmelt where fuel/cladding damage begins
    alphaDoppler: -2.5e-5, // Δk/k per K (order of magnitude)
    sigmaUlt: 100e6, // Pa, brittle ceramic tensile strength (order of magnitude)
    brittle: true,
  },
  un: {
    name: 'UN nitride pellets',
    rho: 14320,
    cp: 230,
    k: 20,
    kModel: 'constant',
    tMelt: 3030,
    damageFraction: 0.7,
    alphaDoppler: -2.0e-5,
    sigmaUlt: 150e6,
    brittle: true,
  },
  uzr: {
    name: 'U-10Zr metal alloy',
    rho: 15300,
    cp: 180,
    k: 22,
    kModel: 'constant',
    tMelt: 1400,
    damageFraction: 0.75,
    alphaDoppler: -1.0e-5,
    sigmaUlt: 600e6,
    brittle: false,
    estimate: true,
  },
  uzrh: {
    name: 'UZrH hydride',
    rho: 6900,
    cp: 300,
    k: 18,
    kModel: 'constant',
    tMelt: 1500,
    damageFraction: 0.6, // hydrogen dissociation risk starts well below melting
    alphaDoppler: -5.0e-5,
    sigmaUlt: 300e6,
    brittle: true,
    estimate: true,
  },
  triso: {
    name: 'TRISO particles in graphite',
    rho: 1800,
    cp: 1700,
    k: 25,
    kModel: 'constant',
    tMelt: 2500,
    damageFraction: 0.8,
    alphaDoppler: -2.0e-5,
    sigmaUlt: 40e6,
    brittle: true,
    estimate: true,
  },
};

/** Fuel thermal conductivity, W/(m K). */
export function fuelConductivity(fuelId, T) {
  const fuel = FUELS[fuelId];
  if (fuel.kModel === 'uo2') {
    // k = 1/(0.0375 + 2.165e-4 T) + 4.715e9/T^2 exp(-16361/T)
    return 1 / (0.0375 + 2.165e-4 * T) + (4.715e9 / (T * T)) * Math.exp(-16361 / T);
  }
  return fuel.k;
}

// ---------------------------------------------------------------- coolants / moderators
// Saturation temperature (K) at pressure p (MPa).
// Water uses a tabulated IAPWS-IF97 saturation line; liquid metals use Clausius-Clapeyron
// anchored at their normal boiling point (the approximation is tested in test/materials.test.js).
const WATER_SAT_TABLE = [
  [0.1, 372.8],
  [0.2, 393.4], // IAPWS-IF97 saturation, 120.2 °C
  [0.3, 406.7], // IAPWS-IF97 saturation, 133.5 °C
  [0.5, 424.9],
  [1.0, 453.0],
  [2.0, 485.6],
  [5.0, 537.1],
  [10.0, 584.2],
  [15.5, 618.9],
];

export function waterSaturationK(pMPa) {
  const table = WATER_SAT_TABLE;
  if (pMPa <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i += 1) {
    const [p1, t1] = table[i - 1];
    const [p2, t2] = table[i];
    if (pMPa <= p2) {
      // interpolate linearly in ln(p), the natural variable for the saturation line
      const f = (Math.log(pMPa) - Math.log(p1)) / (Math.log(p2) - Math.log(p1));
      return t1 + f * (t2 - t1);
    }
  }
  return table[table.length - 1][1];
}

/** Clausius-Clapeyron saturation temperature, anchored at 1 atm boiling point. */
export function clausiusSaturationK(pMPa, boilingK, deltaHmolJ) {
  const pAtm = 0.101325;
  const invT = 1 / boilingK - (R_GAS / deltaHmolJ) * Math.log(pMPa / pAtm);
  return 1 / invT;
}

export const COOLANTS = {
  sodium: {
    name: 'Liquid sodium',
    freezeK: 371,
    boilingK: 1156,
    deltaHvapJmol: 97000,
    h0: 5.0e4, // W/(m^2 K) film coefficient at nominal flow (Nu ~ 7 with D ~ 10 mm)
    spectrum: 'fast',
    alphaModerator: -1.0e-6, // Δk/k per K
    alphaVoid: 3.0e-4, // positive void coefficient typical of sodium-cooled cores
    defaultPressureMPa: 0.1,
    gas: false,
  },
  water: {
    name: 'Pressurised water (moderator)',
    freezeK: 273.15,
    boilingK: 373.15,
    h0: 3.0e4,
    spectrum: 'thermal',
    alphaModerator: -3.5e-4,
    alphaVoid: -3.0e-3,
    defaultPressureMPa: 0.2, // low-pressure design, see RESEARCH-NOTES (can hoop-stress limit)
    gas: false,
    tableSaturation: true,
  },
  lbe: {
    name: 'Lead-bismuth eutectic',
    freezeK: 398,
    boilingK: 1943,
    deltaHvapJmol: 179000,
    h0: 4.0e4,
    spectrum: 'fast',
    alphaModerator: -1.0e-6,
    alphaVoid: -1.0e-4,
    defaultPressureMPa: 0.1,
    gas: false,
  },
  helium: {
    name: 'Helium gas',
    freezeK: 0,
    boilingK: 1e9, // never boils in this model
    h0: 1.2e3,
    spectrum: 'fast',
    alphaModerator: 0,
    alphaVoid: 0,
    defaultPressureMPa: 4.0,
    gas: true,
  },
};

// Saturated liquid water (IAPWS-IF97 order of magnitude; to be verified against the
// IAPWS release in docs/RESEARCH-NOTES.md before publication). [K, kg/m^3] and [K, J/kgK].
const WATER_LIQUID_DENSITY = [
  [273.15, 999.8], [293.15, 998.2], [313.15, 992.2], [333.15, 983.2], [353.15, 971.8],
  [373.15, 958.4], [400, 937.5], [423.15, 915.5], [450, 890.2], [500, 832.6], [550, 752.6], [600, 616.0],
];
const WATER_LIQUID_CP = [
  [273.15, 4217], [293.15, 4183], [313.15, 4179], [333.15, 4184], [353.15, 4199],
  [373.15, 4217], [423.15, 4283], [473.15, 4426], [523.15, 4748], [573.15, 5600],
];

/** Piecewise-linear interpolation; clamps at the table ends. */
export function interpTable(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i += 1) {
    const [x1, y1] = table[i - 1];
    const [x2, y2] = table[i];
    if (x <= x2) return y1 + ((x - x1) / (x2 - x1)) * (y2 - y1);
  }
  return table[table.length - 1][1];
}

/** Coolant density (kg/m^3) at temperature T (K) and pressure p (MPa). */
export function coolantDensity(id, T, pMPa) {
  switch (id) {
    case 'sodium': {
      // Fink & Leibowitz (1995) correlation
      const x = 1 - T / 2503.7;
      return 219 + 275.32 * x + 511.58 * Math.sqrt(Math.max(0, x));
    }
    case 'lbe':
      return 10520 - 1.19 * (T - 273.15);
    case 'helium':
      return (pMPa * 1e6 * 0.004003) / (R_GAS * T); // ideal gas, M = 4.003 g/mol
    case 'water':
      return interpTable(WATER_LIQUID_DENSITY, T); // saturated liquid; pressure effect < 1 %
    default:
      throw new Error(`Unknown coolant ${id}`);
  }
}

/** Specific heat, J/(kg K). */
export function coolantCp(id, T) {
  switch (id) {
    case 'sodium':
      // Fink & Leibowitz (1995): 1658.2 - 0.8479 T + 4.4541e-4 T^2
      return 1658.2 - 0.8479 * T + 4.4541e-4 * T * T;
    case 'lbe':
      return 146;
    case 'helium':
      return 5193;
    case 'water':
      return interpTable(WATER_LIQUID_CP, T);
    default:
      throw new Error(`Unknown coolant ${id}`);
  }
}

/** Thermal conductivity, W/(m K). */
export function coolantConductivity(id, T) {
  switch (id) {
    case 'sodium':
      // Fink & Leibowitz (1995): 124.67 - 0.11381 T + 5.5226e-5 T^2 - 1.1842e-8 T^3
      return 124.67 - 0.11381 * T + 5.5226e-5 * T * T - 1.1842e-8 * T * T * T;
    case 'lbe':
      return 13;
    case 'helium':
      return 0.3;
    case 'water':
      return 0.55;
    default:
      throw new Error(`Unknown coolant ${id}`);
  }
}

export function saturationK(id, pMPa) {
  const c = COOLANTS[id];
  if (c.gas) return Infinity;
  if (c.tableSaturation) return waterSaturationK(pMPa);
  return clausiusSaturationK(pMPa, c.boilingK, c.deltaHvapJmol);
}

// ---------------------------------------------------------------- shielding
/** Electrons per gram from mass fractions. */
function electronsPerGram(components) {
  // components: [{w, Z, A}] with w the mass fraction
  return components.reduce((sum, c) => sum + c.w * (c.Z / c.A), 0) * AVOGADRO;
}

/** Klein-Nishina total cross section per electron (cm^2) at photon energy E (MeV). */
export function kleinNishinaPerElectronCm2(E) {
  const a = E / 0.51099895;
  const re2 = R_ELECTRON_CM * R_ELECTRON_CM;
  const t1 = ((1 + a) / (a * a)) * ((2 * (1 + a)) / (1 + 2 * a) - Math.log(1 + 2 * a) / a);
  const t2 = Math.log(1 + 2 * a) / (2 * a);
  const t3 = (1 + 3 * a) / ((1 + 2 * a) * (1 + 2 * a));
  return 2 * Math.PI * re2 * (t1 + t2 - t3);
}

/** Compton-dominated mass attenuation (cm^2/g) for low-Z media. Valid where photoelectric
 *  absorption is negligible (about 0.5 MeV and above for light materials). */
export function comptonMassAttenuation(components, E) {
  return electronsPerGram(components) * kleinNishinaPerElectronCm2(E);
}

export const SHIELDS = {
  lead: {
    name: 'Lead',
    rho: 11340,
    muOverRho1MeV: 0.07102, // cm^2/g, NIST XCOM (Pb, 1 MeV)
    sigmaR: 0.118, // cm^-1 fast-neutron removal, from the cited removal table
    role: 'gamma',
    mpK: 600,
  },
  tungsten: {
    name: 'Tungsten',
    rho: 19250,
    muOverRho1MeV: 0.06618, // NIST XCOM (W, 1 MeV)
    sigmaR: 0.1, // NOT sourced; estimate
    estimate: true,
    role: 'gamma',
    mpK: 3695,
  },
  borated_pe: {
    name: 'Borated polyethylene (5 wt% B)',
    rho: 950,
    muOverRho1MeV: 0, // filled below from a composition-based Compton estimate
    sigmaR: 0.107, // cm^-1, polyethylene reference value; boron absorption not modelled
    role: 'neutron',
    mpK: 400,
  },
  water: {
    name: 'Water',
    rho: 1000,
    muOverRho1MeV: 0.07072, // NIST XCOM (liquid water, 1 MeV)
    sigmaR: 0.1023, // cm^-1
    role: 'neutron',
    mpK: 273,
  },
};

// Borated polyethylene: composition-based Compton estimate (95% CH2 + 5 wt% natural boron).
SHIELDS.borated_pe.muOverRho1MeV = comptonMassAttenuation(
  [
    { w: 0.95 * 0.856, Z: 6, A: 12.011 },
    { w: 0.95 * 0.144, Z: 1, A: 1.008 },
    { w: 0.05, Z: 5, A: 10.81 },
  ],
  1.0,
);

/** Linear attenuation coefficient (1/cm) at 1 MeV. */
export function linearAttenuation1MeV(shieldId) {
  const s = SHIELDS[shieldId];
  return s.muOverRho1MeV * s.rho / 1000; // cm^2/g * g/cm^3 -> 1/cm
}

// ---------------------------------------------------------------- structure & vessel
export const STRUCTURAL = {
  ss316: {
    name: 'Stainless steel 316L',
    E: 193e9, // Pa
    rho: 8000,
    sigmaUlt: 580e6,
    fatigueCoeff: 900e6, // Basquin sigma_f' (Pa), generic
    fatigueExponent: -0.1, // Basquin b, generic
    estimate: true,
  },
  inconel718: {
    name: 'Inconel 718',
    E: 200e9,
    rho: 8190,
    sigmaUlt: 1240e6,
    fatigueCoeff: 1500e6,
    fatigueExponent: -0.09,
    estimate: true,
  },
  ti64: {
    name: 'Titanium Ti-6Al-4V',
    E: 114e9,
    rho: 4430,
    sigmaUlt: 950e6,
    fatigueCoeff: 1100e6,
    fatigueExponent: -0.09,
    estimate: true,
  },
};

export const VESSELS = {
  al3004: {
    name: 'Aluminium 3004 can',
    E: 69e9,
    rho: 2720,
    cp: 900,
    k: 160,
    yieldPa: 145e6, // H32-temper order of magnitude
    maxK: 473, // softening-related containment limit (order of magnitude)
    emissivity: 0.3, // oxidised aluminium (order of magnitude)
    estimate: true,
  },
};

// ---------------------------------------------------------------- power conversion
export const CONVERTERS = {
  bi2te3: {
    name: 'Bi₂Te₃ thermoelectric (ZT ≈ 1.0)',
    type: 'TE',
    ZT: 1.0,
    tHotMax: 500,
    volumeCm3: 8,
    vibLimitG: 40,
  },
  skutterudite: {
    name: 'Skutterudite thermoelectric (ZT ≈ 1.2)',
    type: 'TE',
    ZT: 1.2,
    tHotMax: 800,
    volumeCm3: 9,
    vibLimitG: 40,
  },
  sige: {
    name: 'SiGe thermoelectric (ZT ≈ 1.0 at high T)',
    type: 'TE',
    ZT: 1.0,
    tHotMax: 1100,
    volumeCm3: 10,
    vibLimitG: 40,
  },
  stirling: {
    name: 'Free-piston Stirling (25% of Carnot)',
    type: 'Stirling',
    carnotFraction: 0.25,
    tHotMax: 1000,
    volumeCm3: 40,
    vibLimitG: 6, // moving piston: far less tolerant of vibration
    estimate: true,
  },
};

/** Conversion efficiency for a converter between hot (Th) and cold (Tc) temperatures (K).
 *  TE: η = (1 - Tc/Th) (sqrt(1+ZT) - 1) / (sqrt(1+ZT) + Tc/Th)  (Ioffe; maximum-power-of-ZT form).
 *  Stirling: η = f_Carnot (1 - Tc/Th). */
export function converterEfficiency(id, Th, Tc) {
  const c = CONVERTERS[id];
  if (Th <= Tc) return 0;
  const carnot = 1 - Tc / Th;
  if (c.type === 'Stirling') return c.carnotFraction * carnot;
  const s = Math.sqrt(1 + c.ZT);
  return carnot * ((s - 1) / (s + Tc / Th));
}

