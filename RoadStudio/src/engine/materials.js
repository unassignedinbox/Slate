// Material ids shared by geometry (vertex attribute) and shader (palette uniform).
export const MAT = {
  DEFAULT: 0,
  ASPHALT: 1,      // carriageway; texture stack 0
  SHOULDER: 2,     // hard shoulder; texture stack 0
  CURB_FACE: 3,
  CURB_TOP: 4,
  PAVING: 5,       // sidewalk / plaza; texture stack 1
  SKIRT: 6,        // exposed kerb / slab edge / bridge deck edge
  MEDIAN: 7,
  MARK_WHITE: 8,
  MARK_YELLOW: 9,
  GROUND: 10,
  METAL: 11,
  GALV: 12,
  EMISSIVE: 13,
  PIER: 14,
  GLASS: 15,
  TIRE: 16,
  POLE: 17,
  BOLLARD_CONCRETE: 18,
  BOLLARD_PAINT: 19,
  CAR_PAINT: 20,   // 20..27 are car paints; instance paint index selects one
  JERSEY: 28,
  LAMP_HOUSING: 29,
};

// Linear-ish albedo (rgb) and base roughness per id. Index 20..27 are car paints.
export const PALETTE = (() => {
  const p = new Array(32).fill(null).map(() => [0.5, 0.5, 0.5, 0.8]);
  p[MAT.DEFAULT] = [0.5, 0.5, 0.5, 0.8];
  p[MAT.ASPHALT] = [0.075, 0.077, 0.082, 0.85];
  p[MAT.SHOULDER] = [0.13, 0.125, 0.115, 0.9];
  p[MAT.CURB_FACE] = [0.42, 0.41, 0.39, 0.75];
  p[MAT.CURB_TOP] = [0.52, 0.51, 0.49, 0.7];
  p[MAT.PAVING] = [0.46, 0.45, 0.43, 0.7];
  p[MAT.SKIRT] = [0.3, 0.29, 0.28, 0.8];
  p[MAT.MEDIAN] = [0.34, 0.33, 0.31, 0.8];
  p[MAT.MARK_WHITE] = [0.82, 0.82, 0.8, 0.55];
  p[MAT.MARK_YELLOW] = [0.8, 0.62, 0.12, 0.55];
  p[MAT.GROUND] = [0.085, 0.11, 0.06, 0.95];
  p[MAT.METAL] = [0.09, 0.095, 0.1, 0.4];
  p[MAT.GALV] = [0.55, 0.56, 0.58, 0.3];
  p[MAT.EMISSIVE] = [1.0, 0.86, 0.6, 0.4];
  p[MAT.PIER] = [0.4, 0.39, 0.37, 0.85];
  p[MAT.GLASS] = [0.03, 0.035, 0.04, 0.08];
  p[MAT.TIRE] = [0.02, 0.02, 0.02, 0.9];
  p[MAT.POLE] = [0.22, 0.23, 0.24, 0.45];
  p[MAT.BOLLARD_CONCRETE] = [0.6, 0.59, 0.56, 0.8];
  p[MAT.BOLLARD_PAINT] = [0.7, 0.12, 0.08, 0.5];
  const cars = [[0.75, 0.05, 0.05], [0.9, 0.9, 0.92], [0.05, 0.08, 0.14], [0.55, 0.56, 0.6], [0.12, 0.3, 0.6], [0.85, 0.7, 0.1], [0.1, 0.45, 0.25], [0.5, 0.2, 0.55]];
  cars.forEach((c, i) => (p[MAT.CAR_PAINT + i] = [...c, 0.35]));
  p[MAT.JERSEY] = [0.62, 0.61, 0.58, 0.8];
  p[MAT.LAMP_HOUSING] = [0.12, 0.12, 0.13, 0.4];
  return p;
})();
