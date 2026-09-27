// -----------------------------------------------------------------------
// Biometric reference data for the model.
//
// Modeled after a large New-World theraphosid in the same size class as
// Theraphosa blondi / Brachypelma hamorii hybrids commonly referenced in
// arachnology literature: ~12 cm body length, ~30 cm total leg span,
// 8 legs of 7 segments each (coxa, trochanter, femur, patella, tibia,
// metatarsus, tarsus), 2 pedipalps (6 segments), chelicerae with
// orthognath (downward-striking, non-crossing) fangs, 8 eyes on an
// ocular tubercle, and paired spinnerets. All figures are in meters and
// are proportioned from published leg-segment ratios and gait studies
// (see project notes / chat for citations).
// -----------------------------------------------------------------------

export const BODY = {
  prosomaLength: 0.048,
  prosomaWidth: 0.040,
  prosomaHeight: 0.024,
  pedicelLength: 0.009,
  pedicelRadius: 0.006,
  opisthosomaLength: 0.070,
  opisthosomaWidth: 0.054,
  opisthosomaHeight: 0.050,
  // ground clearance target when standing in a relaxed stance
  standHeight: 0.052,
};

// Fractional split of one leg's total length across its seven segments,
// proximal -> distal. Sums to 1.
export const LEG_SEGMENT_FRACTIONS = {
  coxa: 0.065,
  trochanter: 0.045,
  femur: 0.27,
  patella: 0.12,
  tibia: 0.205,
  metatarsus: 0.175,
  tarsus: 0.12,
};

// Radius (thickness) of each segment expressed as a fraction of the total
// leg length; segments taper continuously from their own radius to the
// next segment's radius.
export const LEG_SEGMENT_RADII = {
  coxa: 0.062,
  trochanter: 0.052,
  femur: 0.040,
  patella: 0.032,
  tibia: 0.026,
  metatarsus: 0.019,
  tarsus: 0.013,
  tip: 0.006,
};

export const LEG_ORDER = ['coxa', 'trochanter', 'femur', 'patella', 'tibia', 'metatarsus', 'tarsus'];

// Per leg-pair (I-IV) tuning: overall length scale, resting splay angle
// (degrees from the body's forward axis, measured at the top-down plane),
// attach position along the prosoma (-1 rear .. +1 front), and elevation
// of the attach point.
export const LEG_PAIRS = [
  { id: 'I', lengthScale: 0.90, splayDeg: 38, attachT: 0.86, elevDeg: 12 },
  { id: 'II', lengthScale: 0.78, splayDeg: 68, attachT: 0.55, elevDeg: 6 },
  { id: 'III', lengthScale: 0.76, splayDeg: 112, attachT: 0.18, elevDeg: 2 },
  { id: 'IV', lengthScale: 1.0, splayDeg: 146, attachT: -0.35, elevDeg: -4 },
];

export const BASE_LEG_LENGTH = 0.148; // longest pair (IV) reference length

export const PEDIPALP = {
  lengthScale: 0.40,
  fractions: { coxa: 0.14, trochanter: 0.09, femur: 0.30, patella: 0.16, tibia: 0.19, tarsus: 0.12 },
  radii: { coxa: 0.09, trochanter: 0.075, femur: 0.06, patella: 0.05, tibia: 0.04, tarsus: 0.028, tip: 0.012 },
};

export const CHELICERA = {
  length: 0.020,
  radius: 0.012,
  fangLength: 0.014,
  fangRadius: 0.0028,
  restAngleDeg: 12, // fang folded angle from chelicera axis at rest
  strikeAngleDeg: 92, // fang swung angle at full strike
};

export const EYES = {
  count: 8,
  radius: 0.0019,
};

// Colors approximate the "Mexican redknee" (Brachypelma hamorii) pattern:
// jet-black body with warm burnt-orange joints and pale carapace guard
// hairs — chosen because it is both scientifically documented and highly
// legible at a glance (important for a creature meant to read clearly in
// real time).
export const PALETTE = {
  exoDark: 0x0c0906,
  exoDarkBrown: 0x1c120b,
  jointOrange: 0xa84a1c,
  jointOrangeBright: 0xc96324,
  carapaceHair: 0xcfa876,
  furBrown: 0x3a2415,
  furBlack: 0x120c08,
  urticatingPatch: 0x7a4a22,
  fang: 0x1a0f0c,
  eye: 0x050403,
  claw: 0x2a1c12,
};
