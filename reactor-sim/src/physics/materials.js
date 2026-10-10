// Modular material library.
//
// Each role (fuel, cladding, moderator, reflector, shield, coolant, structure,
// absorber, thermoelectric) has several interchangeable options. The simulator reads
// every property from here, so swapping a material changes neutronics, heat transfer,
// radiation attenuation, fatigue life and the limits that trip the safety system.
//
// Compositions are weight fractions of elements (ELEMENTS in nuclear-data.js).
// Property values are room-temperature or representative engineering values.
// Anything marked "approx." is a rounded literature value and is listed in the notes.

import { c2k, k2c } from './constants.js';

// --- helpers ---------------------------------------------------------------

// Saturated-pressure lookup for water (IAPWS-IF97, rounded). Returns degC.
const WATER_TSAT = [
  [0.1, 99.6], [0.5, 151.8], [1.0, 179.9], [2.0, 212.4],
  [5.0, 263.9], [10.0, 311.0], [15.5, 345.8], [20.0, 365.8],
];
export function waterSaturationC(pMPa) {
  const p = Math.max(WATER_TSAT[0][0], Math.min(pMPa, WATER_TSAT[WATER_TSAT.length - 1][0]));
  for (let i = 1; i < WATER_TSAT.length; i++) {
    const [p0, t0] = WATER_TSAT[i - 1];
    const [p1, t1] = WATER_TSAT[i];
    if (p <= p1) return t0 + (t1 - t0) * (p - p0) / (p1 - p0);
  }
  return WATER_TSAT[WATER_TSAT.length - 1][1];
}

// Saturated-liquid water density, g/cm^3 (IAPWS, rounded table at 10 K steps around 300 C).
const WATER_RHO = [
  [0, 0.99984], [20, 0.99820], [50, 0.98804], [100, 0.95835], [150, 0.91706],
  [200, 0.86523], [250, 0.79970], [300, 0.71640], [340, 0.60566], [360, 0.4],
];
function interp(table, x) {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x0, y0] = table[i - 1];
    const [x1, y1] = table[i];
    if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
  }
  return table[table.length - 1][1];
}

// Ideal-gas density for helium, g/cm^3, at Tk (K) and pMPa (MPa).
const heDensity = (Tk, pMPa) => (pMPa * 1e6 * 4.0026e-3) / (8.314462618 * Tk) / 1000;

// --- fuel phases ------------------------------------------------------------
// vf fractions inside a fuel pin.

export const FUEL = {
  UO2: {
    id: 'UO2', label: 'UO2 ceramic pellet', role: 'fuel',
    rho: 10.42,                 // 95 % theoretical density
    comp: { U: 0.8815, O: 0.1185 },
    enrichable: true,
    kFn: (Tk) => 1 / (0.0375 + 2.165e-4 * Tk),  // Fink-type correlation (approx.), W/m K
    cp: 260,
    alphaD: -2.5e-5,            // Doppler reactivity coefficient, 1/K (approx. for UO2)
    Tmelt: 2865,                // degC
    Tlimit: 2200,               // degC design limit for fuel centreline
    note: 'Workhorse LWR fuel. Melting ~2865 degC, low thermal conductivity.',
  },
  UN: {
    id: 'UN', label: 'UN nitride pellet', role: 'fuel',
    rho: 13.6, comp: { U: 0.9447, N: 0.0553 }, enrichable: true,
    kFn: () => 20,              // approx., W/m K, roughly 3-5x UO2
    cp: 230,
    alphaD: -2.8e-5,
    Tmelt: 2847,
    Tlimit: 2200,
    note: 'Higher thermal conductivity and U density than UO2; pyrophoric in air.',
  },
  UCO_KERNEL: {
    id: 'UCO_KERNEL', label: 'UO2 kernel (TRISO)', role: 'kernel',
    rho: 10.4, comp: { U: 0.8815, O: 0.1185 }, enrichable: true,
    kFn: (Tk) => 1 / (0.0375 + 2.165e-4 * Tk),
    cp: 260, alphaD: -2.5e-5, Tmelt: 2865, Tlimit: 1600,
  },
  GRAPHITE_MATRIX: {
    id: 'GRAPHITE_MATRIX', label: 'Graphite matrix', role: 'matrix',
    rho: 1.75, comp: { C: 1.0 }, kFn: () => 30, cp: 1700, Tmelt: 3500, Tlimit: 1600,
  },
  TRISO: {
    id: 'TRISO', label: 'TRISO particles in graphite', role: 'fuel',
    rho: null,                 // homogenised below
    phases: [{ ref: 'UCO_KERNEL', vf: 0.30 }, { ref: 'GRAPHITE_MATRIX', vf: 0.70 }],
    enrichable: true,
    kFn: () => 8,              // approx. effective conductivity of the compact, W/m K
    cp: 1000,
    alphaD: -1.5e-5,           // approx., reduced Doppler effect in graphite-dominated compact
    Tmelt: 2000,               // SiC layer decomposition, approx.
    Tlimit: 1600,              // accident-condition failure limit used for TRISO, approx.
    note: 'Coated-particle fuel (Antares/BWXT style). Survives high T; poor pellet-to-matrix k.',
  },
};

// --- cladding ---------------------------------------------------------------

export const CLADDING = {
  ZRY4: {
    id: 'ZRY4', label: 'Zircaloy-4', role: 'cladding', rho: 6.56,
    comp: { Zr: 0.9826, Sn: 0.0145, Fe: 0.0021, Cr: 0.0010 },
    k: 13, cp: 300, Tmelt: 1850, Tmax: 1204, E: 90, zeta: 0.005,
    sigF: 500, bFat: -0.09, yield: 300,
    note: '1204 degC is the 10 CFR 50.46 peak-clad-temperature criterion; 17 % ECR limit.',
  },
  SS316L: {
    id: 'SS316L', label: '316L stainless', role: 'cladding', rho: 8.0,
    comp: { Fe: 0.655, Cr: 0.17, Ni: 0.12, Mo: 0.025, Mn: 0.02, Si: 0.01 },
    k: 16, cp: 500, Tmelt: 1375, Tmax: 800, E: 193, zeta: 0.005,
    sigF: 1000, bFat: -0.085, yield: 205,
    note: 'Fatigue data approx.; design T limit approx. 800 degC.',
  },
  IN718: {
    id: 'IN718', label: 'Inconel 718', role: 'cladding', rho: 8.19,
    comp: { Ni: 0.53, Cr: 0.19, Fe: 0.18, Nb: 0.05, Mo: 0.03, Ti: 0.01, Al: 0.01 },
    k: 11.4, cp: 435, Tmelt: 1260, Tmax: 700, E: 200, zeta: 0.004,
    sigF: 1500, bFat: -0.066, yield: 1035,
    note: 'Strong at temperature; approx. 700 degC design limit.',
  },
  SIC_SIC: {
    id: 'SIC_SIC', label: 'SiC/SiC composite', role: 'cladding', rho: 3.0,
    comp: { Si: 0.7, C: 0.3 },
    k: 25, cp: 700, Tmelt: 2700, Tmax: 1600, E: 230, zeta: 0.002,
    sigF: 300, bFat: -0.05, yield: 250,
    note: 'Brittle: fatigue modelled with a conservative low-strength curve (approx.).',
  },
};

// --- moderators (solid, inside the core lattice) -------------------------

export const MODERATOR = {
  NONE: { id: 'NONE', label: 'None (coolant only)', role: 'moderator', rho: 0, comp: {} },
  GRAPHITE: {
    id: 'GRAPHITE', label: 'Graphite block', role: 'moderator', rho: 1.75,
    comp: { C: 1.0 }, k: 30, cp: 1700, Tmelt: 3500, Tmax: 1600,
  },
  ZRH: {
    id: 'ZRH', label: 'ZrH1.6 hydride', role: 'moderator', rho: 5.6,
    comp: { Zr: 0.9826, Hz: 0.0174 }, k: 18, cp: 330, Tmelt: 1500, Tmax: 800,
    note: 'Hydrogen bound in zirconium: hydrogen loss above ~600 degC (approx.).',
  },
  BEO: {
    id: 'BEO', label: 'Beryllium oxide', role: 'moderator', rho: 2.85,
    comp: { Be: 0.3603, O: 0.6397 }, k: 250, cp: 1000, Tmelt: 2550, Tmax: 1800,
  },
};

// --- reflectors --------------------------------------------------------------
// sigR: fast-neutron removal per gram, cm^2/g (fission spectrum). See notes.

export const REFLECTOR = {
  BE: {
    id: 'BE', label: 'Beryllium', role: 'reflector', rho: 1.85,
    comp: { Be: 1.0 }, k: 200, cp: 1820, Tmelt: 1287, Tmax: 1000, sigR: 0.040,
    note: 'Best neutron reflector, toxic dust hazard.',
  },
  GRAPHITE: {
    id: 'GRAPHITE', label: 'Graphite', role: 'reflector', rho: 1.75,
    comp: { C: 1.0 }, k: 60, cp: 1700, Tmelt: 3500, Tmax: 1600, sigR: 0.045,
  },
  BEO: {
    id: 'BEO', label: 'Beryllium oxide', role: 'reflector', rho: 2.85,
    comp: { Be: 0.3603, O: 0.6397 }, k: 250, cp: 1000, Tmelt: 2550, Tmax: 1800, sigR: 0.040,
  },
  SS316L: {
    id: 'SS316L', label: '316L stainless (poor reflector)', role: 'reflector', rho: 8.0,
    comp: { Fe: 0.655, Cr: 0.17, Ni: 0.12, Mo: 0.025, Mn: 0.02, Si: 0.01 },
    k: 16, cp: 500, Tmelt: 1375, Tmax: 800, sigR: 0.025,
  },
};

// --- shields (radiation attenuation) -----------------------------------------
// mu1 is evaluated from element data; sigR is removal per gram (cm^2/g).

export const SHIELD = {
  W: {
    id: 'W', label: 'Tungsten', role: 'shield', rho: 19.25, comp: { W: 1.0 },
    k: 170, cp: 132, Tmelt: 3422, Tmax: 1500, sigR: 0.020,
    note: 'Densest practical gamma shield. Poor for neutrons.',
  },
  PB: {
    id: 'PB', label: 'Lead', role: 'shield', rho: 11.34, comp: { Pb: 1.0 },
    k: 35, cp: 129, Tmelt: 327, Tmax: 300, sigR: 0.0126,
    note: 'Low melting point; creeps under vibration.',
  },
  BPE: {
    id: 'BPE', label: 'Borated polyethylene (5 wt% B)', role: 'shield', rho: 0.95,
    comp: { C: 0.755, H: 0.195, B: 0.05 }, k: 0.4, cp: 2300, Tmelt: 130, Tmax: 80,
    sigR: 0.110,
    note: 'Best neutron shield per cm; hydrogen-rich. Lower gamma shielding.',
  },
  SS316L: {
    id: 'SS316L', label: '316L stainless', role: 'shield', rho: 8.0,
    comp: { Fe: 0.655, Cr: 0.17, Ni: 0.12, Mo: 0.025, Mn: 0.02, Si: 0.01 },
    k: 16, cp: 500, Tmelt: 1375, Tmax: 800, sigR: 0.025,
  },
  B4C: {
    id: 'B4C', label: 'Boron carbide', role: 'shield', rho: 2.52,
    comp: { B: 0.7827, C: 0.2173 }, k: 30, cp: 950, Tmelt: 2450, Tmax: 1000,
    sigR: 0.0283, note: 'Neutron absorber. Helium build-up can swell the pellets.',
  },
};

// --- coolants ------------------------------------------------------------
// rhoFn(TK, pMPa) -> g/cm^3 ; muFn(TK) -> Pa s ; kFn(TK) -> W/m K ; cp J/kg K.

export const COOLANT = {
  H2O: {
    id: 'H2O', label: 'Light water (pressurised)', role: 'coolant',
    comp: { Hb: 0.1119, O: 0.8881 }, moderating: true, sigR: 0.1029,
    rhoFn: (TK) => interp(WATER_RHO, k2c(TK)),
    muFn: (TK) => 2.414e-5 * Math.pow(10, 247.8 / (TK - 140)),  // Vogel correlation
    kFn: (TK) => 0.6 - 1.2e-3 * (TK - 300) / 10,               // rough linear fit
    cp: 4300,
    Tmelt: 0, Tboil: (p) => waterSaturationC(p),
    Tmax: (p) => waterSaturationC(p) - 15,        // margin below saturation
    note: 'Saturation: 179.9 degC at 1 MPa, 345.8 degC at 15.5 MPa. Margin is set 15 K below saturation.',
  },
  D2O: {
    id: 'D2O', label: 'Heavy water (pressurised)', role: 'coolant',
    comp: { D: 0.2016, O: 0.7984 }, moderating: true, sigR: 0.0527,
    rhoFn: (TK) => 1.105 * interp(WATER_RHO, k2c(TK)),
    muFn: (TK) => 2.414e-5 * Math.pow(10, 247.8 / (TK - 140)) * 1.23,
    kFn: (TK) => 0.6 - 1.2e-3 * (TK - 300) / 10,
    cp: 4200,
    Tmelt: 3.8, Tboil: (p) => waterSaturationC(p),
    Tmax: (p) => waterSaturationC(p) - 15,
    note: 'Better moderator (lower absorption) than H2O. Tritium and cost penalty.',
  },
  HE: {
    id: 'HE', label: 'Helium gas (5 MPa default)', role: 'coolant',
    comp: { He: 1.0 }, moderating: false, sigR: 0.0,
    rhoFn: (TK, pMPa) => heDensity(TK, pMPa),
    muFn: (TK) => 3.0e-5 * Math.pow(TK / 300, 0.7),
    kFn: (TK) => 0.152 * Math.pow(TK / 300, 0.7),
    cp: 5193,
    Tmelt: -272, Tboil: () => -269,
    Tmax: () => 750,
    note: 'Inert and transparent to neutrons. Poor heat transfer at low pressure.',
  },
  NA: {
    id: 'NA', label: 'Liquid sodium', role: 'coolant',
    comp: { Na: 1.0 }, moderating: true, sigR: 0.0276,
    rhoFn: (TK) => 0.9275 - 2.2833e-4 * k2c(TK),
    muFn: (TK) => 7.0e-4 * Math.exp(1000 / (TK) - 1000 / 673),   // approx. Arrhenius
    kFn: (TK) => 90 - 0.05 * (TK - 500),
    cp: 1270,
    Tmelt: 98, Tboil: () => 883,
    Tmax: () => 550,
    note: 'Excellent heat transfer; reacts violently with water and air.',
  },
  LBE: {
    id: 'LBE', label: 'Lead-bismuth eutectic', role: 'coolant',
    comp: { Pb: 0.445, Bi: 0.555 }, moderating: false, sigR: 0.0126,
    rhoFn: (TK) => 11.096 - 1.32e-3 * k2c(TK),
    muFn: (TK) => 1.94e-4 * Math.exp(754 / TK),        // approx.
    kFn: () => 14,
    cp: 146,
    Tmelt: 124, Tboil: () => 1670,
    Tmax: () => 650,
    note: 'Freezes at 124 degC. Corrosive to steels; polonium inventory.',
  },
  FLIBE: {
    id: 'FLIBE', label: 'FLiBe molten salt (7LiF-BeF2)', role: 'coolant',
    comp: { Li: 0.1417, Be: 0.0910, F: 0.7674 }, moderating: true, sigR: 0.0355,
    rhoFn: (TK) => 2.146 - 4.88e-4 * k2c(TK),
    muFn: (TK) => 1.16e-4 * Math.exp(3755 / TK),        // approx.
    kFn: () => 1.0,
    cp: 2386,
    Tmelt: 459, Tboil: () => 1430,
    Tmax: () => 700,
    note: 'Freezes at 459 degC. Li-7 enriched; very low tritium with Li-7.',
  },
};

// --- structural materials for vessel, support, guide tube -------------------

export const STRUCTURE = {
  SS316L: { ...CLADDING.SS316L, id: 'SS316L', label: '316L stainless (vessel)' },
  IN718: { ...CLADDING.IN718, id: 'IN718', label: 'Inconel 718 (vessel)' },
  TI64: {
    id: 'TI64', label: 'Ti-6Al-4V (vessel)', role: 'structure', rho: 4.43,
    comp: { Ti: 0.9, Al: 0.06, V: 0.04 }, k: 6.7, cp: 526, Tmelt: 1600, Tmax: 400,
    E: 114, zeta: 0.004, sigF: 1200, bFat: -0.07, yield: 880,
    note: 'Light; fatigue data approx.',
  },
};

// --- control-rod absorbers ---------------------------------------------------

export const ABSORBER = {
  B4C: { id: 'B4C', label: 'B4C (natural boron)', rho: 2.52, comp: { B: 0.7827, C: 0.2173 } },
  HF: { id: 'HF', label: 'Hafnium', rho: 13.3, comp: { Hf: 1.0 } },
  AGINCD: { id: 'AGINCD', label: 'Ag-In-Cd (80/15/5)', rho: 10.17, comp: { Ag: 0.8, In: 0.15, Cd: 0.05 } },
  GD2O3: { id: 'GD2O3', label: 'Gadolinia (Gd2O3)', rho: 7.41, comp: { Gd: 0.8676, O: 0.1324 } },
};

// --- thermoelectric legs -------------------------------------------------------
// ZT is the figure of merit at the mean operating temperature (approximate).

export const THERMOELECTRIC = {
  BI2TE3: {
    id: 'BI2TE3', label: 'Bi2Te3 (n/p-type)', role: 'te', rho: 7.86,
    comp: { Bi: 0.5226, Te: 0.4774 }, k: 1.5, cp: 544, ZT: 1.0, Tmax: 230,
    note: 'Near-room-temperature workhorse; ZT ~0.8-1.0 (Wikipedia / OSTI review).',
  },
  PBTE: {
    id: 'PBTE', label: 'PbTe (doped)', role: 'te', rho: 8.16,
    comp: { Pb: 0.6191, Te: 0.3809 }, k: 2.0, cp: 160, ZT: 1.5, Tmax: 500,
    note: 'Mid-temperature; ZT ~1.5 used for a conservative module (lab peaks >2).',
  },
  SIGE: {
    id: 'SIGE', label: 'SiGe (high-temperature)', role: 'te', rho: 3.2,
    comp: { Si: 0.7, Ge: 0.3 }, k: 5.0, cp: 700, ZT: 1.1, Tmax: 900,
    note: 'High-temperature option; ZT ~1.1 at ~1000 K (OSTI review).',
  },
};

// --- neutron-absorbing poison used for core kill ----------------------------
// Fuel-region removal per gram (heavy-nucleus value; approximate).
export const FUEL_SIGR = 0.0126;

export const POISON = { id: 'GD2O3_SLURRY', label: 'Gd2O3 slurry (core kill)', rho: 7.41, comp: { Gd: 0.8676, O: 0.1324 } };

// Convert the Tmax function or number to a number at a given pressure.
export function coolantTmaxC(coolant, pMPa) {
  return typeof coolant.Tmax === 'function' ? coolant.Tmax(pMPa) : coolant.Tmax;
}
export function coolantBoilC(coolant, pMPa) {
  return typeof coolant.Tboil === 'function' ? coolant.Tboil(pMPa) : coolant.Tboil;
}

export const LIBRARY = { FUEL, CLADDING, MODERATOR, REFLECTOR, SHIELD, COOLANT, STRUCTURE, ABSORBER, THERMOELECTRIC };

export function getMaterial(role, id) {
  const table = {
    fuel: FUEL, cladding: CLADDING, moderator: MODERATOR, reflector: REFLECTOR,
    shield: SHIELD, coolant: COOLANT, structure: STRUCTURE, absorber: ABSORBER, te: THERMOELECTRIC,
  }[role];
  if (!table) throw new Error(`Unknown material role ${role}`);
  const m = table[id];
  if (!m) throw new Error(`Unknown ${role} material "${id}"`);
  return m;
}

export const DEFAULT_CONFIG_MATERIALS = {
  fuel: 'UO2',
  cladding: 'ZRY4',
  moderator: 'NONE',
  reflector: 'BE',
  shield: 'W',
  coolant: 'H2O',
  structure: 'SS316L',
  absorber: 'B4C',
  te: 'BI2TE3',
};

export { c2k, k2c };
