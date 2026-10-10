// Physical constants and reference nuclear data.
// Every number here is either an exact SI/CODATA constant or a documented
// approximation. Sources and uncertainty notes live in docs/REACTOR-SIM-NOTES.md.

export const N_A = 6.02214076e23;          // Avogadro, 1/mol (exact, SI 2019)
export const MEV_TO_J = 1.602176634e-13;   // J per MeV (exact, SI 2019)
export const BARN_CM2 = 1e-24;             // cm^2 per barn
export const G0 = 9.80665;                 // m/s^2 standard gravity (exact)
export const R_GAS = 8.314462618;          // J/(mol K) (exact)
export const K_OFFSET = 273.15;            // K at 0 degC
export const SIGMA_SB = 5.670374419e-8;    // W/(m^2 K^4) (exact combination)
export const EMISS_OUTER = 0.3;            // effective emissivity of the oxidised steel can

// Energy released per fission (recoverable, rounded textbook value).
export const E_FISSION_MEV = 200;
export const E_FISSION_J = E_FISSION_MEV * MEV_TO_J;

// Neutron speed for thermal (2200 m/s) reference. Used for prompt-neutron lifetime.
export const V_THERMAL_CM_S = 2.2e5;

// U-235 thermal data, 2200 m/s, rounded ENDF/B-VIII.0 values (barns).
export const U235 = { M: 235.0439, sigma_a: 680.9, sigma_f: 580.2, nu: 2.4355 };
// U-238 thermal capture (barns); fission negligible at thermal energies.
export const U238 = { M: 238.0508, sigma_a: 2.68 };

// Effective resonance integral of U-238 in a lattice (barns). A calibration parameter:
// with 45 b a 3.1 wt% UO2 / light-water lattice (volume ratio 2) gives p ~ 0.91, the
// textbook range. It bundles Dancoff and self-shielding effects.
export const I_EFF_U238_BARN = 45;

// Thermal flux-depression (disadvantage factor) for fuel rods: DF = 1 + c * Sigma_a,F * r_F.
// With c = 1.0 a 3.1 % lattice gives DF ~ 1.24, consistent with textbook LWR values (1.2-1.3).
// Calibration parameter; four-factor k_inf is accurate to about +/-5 % for LWR-type lattices.
export const DISADVANTAGE_COEF = 1.0;

// Fast-fission factor for oxide LWR-type fuel. Standard textbook value.
export const EPSILON_FAST = 1.03;

// Six-group delayed-neutron data for thermal fission of U-235
// (Keepin-type group constants, rounded).
export const DELAYED_GROUPS = [
  { beta: 0.000215, lambda: 0.0124 },
  { beta: 0.001424, lambda: 0.0305 },
  { beta: 0.001274, lambda: 0.111 },
  { beta: 0.002568, lambda: 0.301 },
  { beta: 0.000748, lambda: 1.14 },
  { beta: 0.000273, lambda: 3.01 },
];
export const BETA_TOTAL = DELAYED_GROUPS.reduce((s, g) => s + g.beta, 0);

// Way-Wigner decay-heat constants (Wigner & Way, 1952; fitted form in common
// texts). Valid roughly from 10 s to 100 days after shutdown.
export const WAY_WIGNER_A = 0.066;
export const WAY_WIGNER_EXP = -0.2;
export const DECAY_HEAT_MIN_TIME_S = 10;

// Radiation constants.
export const GAMMA_PHOTONS_PER_FISSION = 7;   // approx. prompt+fission-product gamma, 1 MeV-equivalent each
export const GAMMA_MEAN_MEV = 1.0;
export const MU_EN_AIR_1MEV_CM2_G = 0.0279;   // NIST air energy-absorption coefficient at 1 MeV
export const KAIR_TO_H10 = 1.2;               // Sv per Gy for ~1 MeV photons (approximate)
// Neutron ambient dose-equivalent per unit fluence (fission-type spectrum):
// 1.39 uSv/h per (n/cm^2 s). Matches Nucleonica 2.65e7 uSv/h at 1 m for 1 g Cf-252
// (1.91e7 n/cm^2 s), and OSTI 1184089's 2.55 mrem/h per microgram at 1 m.
export const NEUTRON_UH10_PER_FLUX = 1.39;
export const CF252_NEUTRONS_PER_UG_S = 2.314e6; // OSTI 1184089
export const CF252_GAMMA_TO_NEUTRON_DOSE = 0.055; // OSTI: 0.140 / 2.55 mrem/h per unit mass
export const SHIELD_BUILDUP_LINEAR = true;    // B = 1 + mu*x (conservative for dense shields)

// Unit helpers.
export const mm = 1e-3;
export const uSv_per_h_to_Sv_s = 1e-6 / 3600;
export const Sv_s_to_uSv_per_h = 3600 * 1e6;

export const c2k = (c) => c + K_OFFSET;
export const k2c = (k) => k - K_OFFSET;
