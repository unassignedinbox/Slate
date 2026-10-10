// Physical constants and literature values used by the simulator.
// Every numeric source is listed in docs/RESEARCH-NOTES.md.

export const G0 = 9.80665; // standard gravity, m/s^2
export const SIGMA_SB = 5.670374419e-8; // Stefan-Boltzmann, W/(m^2 K^4)
export const R_GAS = 8.314462618; // J/(mol K)
export const MEV_TO_J = 1.602176634e-13; // J per MeV
export const CM2_PER_M2 = 1e4;
export const AVOGADRO = 6.02214076e23;
export const R_ELECTRON_CM = 2.8179403e-13; // classical electron radius, cm

// Fission energetics (U-235 thermal fission, standard textbook values).
export const RECOVERABLE_MEV_PER_FISSION = 200; // ~200 MeV recoverable per fission
export const NEUTRONS_PER_FISSION = 2.43; // prompt neutrons per thermal U-235 fission
export const PROMPT_GAMMA_MEV_PER_FISSION = 7; // prompt gamma energy per fission (~7 MeV)
// Total gamma energy fraction of thermal power (prompt + fission-product gammas).
// Order-of-magnitude assumption; see research notes.
export const GAMMA_FRACTION_OF_POWER = 0.07; // (legacy, unused) see PROMPT_GAMMA_MEV_PER_FISSION and DECAY_GAMMA_FRACTION
// Fraction of decay-heat energy emitted as gamma (beta energy is deposited in the fuel). Order of
// magnitude from fission-product decay data; verify against ANS-5.1 tables (docs/RESEARCH-NOTES.md).
export const DECAY_GAMMA_FRACTION = 0.6;
export const REPRESENTATIVE_GAMMA_MEV = 1.0; // monoenergetic approximation for shielding
export const NEUTRON_FLUENCE_TO_DOSE_PSV_CM2 = 290; // effective dose per n/cm^2 at 1 MeV (AP, ICRP-74)

// Delayed-neutron data for thermal U-235 (six-group, Keepin-type set).
export const BETA_GROUPS = [0.000215, 0.001424, 0.001274, 0.002568, 0.000748, 0.000273];
export const LAMBDA_GROUPS = [0.0124, 0.0305, 0.111, 0.301, 1.14, 3.01]; // 1/s
export const BETA_TOTAL = BETA_GROUPS.reduce((a, b) => a + b, 0); // 0.006502

// Way-Wigner decay heat correlation (valid ~10 s to 100 days after shutdown).
export const WAY_WIGNER_COEFF = 0.066;

// Radiation protection limits (10 CFR 20.1301 / 20.1201).
export const PUBLIC_LIMIT_SV_PER_YEAR = 1e-3; // 1 mSv per year
export const PUBLIC_LIMIT_SV_PER_HOUR = 2e-5; // 0.02 mSv in any one hour, unrestricted area
export const OCCUPATIONAL_LIMIT_SV_PER_YEAR = 0.05; // 50 mSv per year

// Gamma air-kerma conversion: NIST mass energy-absorption coefficient of dry air at 1 MeV.
export const AIR_MU_EN_OVER_RHO_1MEV = 0.02789; // cm^2/g

// Coca-Cola 355 mL (12 fl oz) can envelope, from manufacturer-quoted standard sizes.
export const CAN_RADIUS_M = 0.03305; // 66.1 mm outer diameter
export const CAN_HEIGHT_M = 0.1222; // 122.2 mm
export const CAN_WALL_M = 1.0e-4; // ~0.1 mm aluminium sidewall (typical)
