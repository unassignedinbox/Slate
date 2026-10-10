// Geometry of the coke-can reactor. All lengths in millimetres unless noted.
//
// Envelope: a standard 355 mL aluminium can, 66.04 mm x 122.2 mm (manufacturer data).
// The model uses a 66.0 mm diameter so the envelope is never larger than the can.
//
// Axial stack, bottom to top:
//   bottom cap (2) | lower shield (t_sh) | lower reflector (t_r) | CORE (H_core) |
//   upper reflector (t_r) | upper shield (t_sh) | coolant plenum (4) | TE generator (t_te) | top cap (2)
// Radial stack, outside to inside: vessel wall (1.0) | radial shield (t_sh) | radial reflector (t_r) | CORE.

export const CAN = { D_mm: 66.0, H_mm: 122.2, source: 'Standard 355 mL can, 66.04 x 122.2 mm (manufacturer data)' };

export const VESSEL_WALL_MM = 1.0;
export const CAP_MM = 2.0;
export const PLENUM_MM = 4.0;
export const TE_FILL = 0.4;            // fraction of the TE layer that is active leg material

export const PIN = { rFuel: 3.3, rCladIn: 3.4, rCladOut: 4.0, count: 18 }; // fuel radius, clad ID/OD (mm)
export const GUIDE = { rOut: 3.0, rBore: 2.5 };                             // control-rod guide tube
export const ROD_RADIUS = 2.4;                                              // absorber rod, mm
export const PIN_RINGS = [
  { r: 8.5, n: 6, phaseDeg: 0 },     // inner ring
  { r: 16.0, n: 12, phaseDeg: 15 },  // outer ring; 15 deg offset keeps pin spacing > 8 mm
];

// Pin centre positions in mm (x, y), core axis at origin.
export function pinPositions() {
  const out = [];
  for (const ring of PIN_RINGS) {
    for (let i = 0; i < ring.n; i++) {
      const a = ((ring.phaseDeg + (360 * i) / ring.n) * Math.PI) / 180;
      out.push({ x: ring.r * Math.cos(a), y: ring.r * Math.sin(a), ring: ring.r });
    }
  }
  return out;
}

export function buildGeometry({ shieldT = 6, reflT = 5, teT = 6, vesselT = VESSEL_WALL_MM } = {}) {
  const R_env = CAN.D_mm / 2;
  const H_env = CAN.H_mm;
  const R_in = R_env - vesselT;
  const R_core = R_in - shieldT - reflT;
  const H_core = H_env - (2 * CAP_MM + 2 * shieldT + 2 * reflT + PLENUM_MM + teT);

  // Axial z-bands (mm, bottom = 0).
  const layers = [];
  let z = 0;
  const add = (name, role, t) => { layers.push({ name, role, z0: z, z1: z + t }); z += t; };
  add('bottom cap', 'vessel', CAP_MM);
  add('lower shield', 'shield', shieldT);
  add('lower reflector', 'reflector', reflT);
  add('core', 'core', H_core);
  add('upper reflector', 'reflector', reflT);
  add('upper shield', 'shield', shieldT);
  add('coolant plenum', 'coolant', PLENUM_MM);
  add('TE generator', 'te', teT);
  add('top cap', 'vessel', CAP_MM);
  const core = layers.find((l) => l.role === 'core');

  const pins = pinPositions();
  const A_core = Math.PI * R_core * R_core;
  const A_pins = pins.length * Math.PI * PIN.rCladOut ** 2;
  const A_guide_outer = Math.PI * GUIDE.rOut ** 2;
  const A_guide_wall = Math.PI * (GUIDE.rOut ** 2 - GUIDE.rBore ** 2);
  const A_fuel = pins.length * Math.PI * PIN.rFuel ** 2;
  const A_clad = pins.length * Math.PI * (PIN.rCladOut ** 2 - PIN.rCladIn ** 2);
  // Coolant channel area: core minus pins minus guide-tube wall (the guide bore is coolant).
  const A_void_clean = A_core - A_pins - A_guide_wall;

  const P_wet = pins.length * 2 * Math.PI * PIN.rCladOut + 2 * Math.PI * GUIDE.rOut;
  const hydraulicDiameter = (4 * A_void_clean) / P_wet;   // mm

  // Radial reflector and shield, and axial layers.
  const V = {
    fuel: A_fuel * H_core,
    clad: A_clad * H_core,
    guideWall: A_guide_wall * H_core,
    coreVoid: A_void_clean * H_core,
    reflector: Math.PI * R_in * R_in * 2 * reflT + Math.PI * ((R_core + reflT) ** 2 - R_core ** 2) * H_core,
    shield: Math.PI * R_in * R_in * 2 * shieldT + Math.PI * (R_in * R_in - (R_core + reflT) ** 2) * H_core,
    vessel: Math.PI * (R_env * R_env - R_in * R_in) * H_env + 2 * Math.PI * R_in * R_in * CAP_MM,
    plenum: Math.PI * R_in * R_in * PLENUM_MM,
    te: Math.PI * R_in * R_in * teT,
  };
  V.coreTotal = Math.PI * R_core * R_core * H_core;

  return {
    R_env, H_env, R_in, R_core, H_core, vesselT, shieldT, reflT, teT,
    layers, coreZ0: core.z0, coreZ1: core.z1,
    pins, pinCount: pins.length,
    A_core, A_pins, A_guide_wall, A_void: A_void_clean, A_fuel, A_clad,
    fractions: {
      fuel: A_fuel / A_core,
      clad: A_clad / A_core,
      guideWall: A_guide_wall / A_core,
      void: A_void_clean / A_core,
    },
    hydraulicDiameter,
    wettedPerimeter: P_wet,
    V,
    // Fit checks against the can envelope.
    checks: {
      fitsDiameter: R_env * 2 <= CAN.D_mm + 1e-9,
      fitsHeight: H_env <= CAN.H_mm + 1e-9,
      coreHeightPositive: H_core > 20,
      pinsInCore: Math.max(...pins.map((p) => Math.hypot(p.x, p.y))) + PIN.rCladOut <= R_core,
      pinSpacing: minPinSpacing(pins) >= 2 * PIN.rCladOut - 1e-9,
      guideClearsPins: Math.min(...pins.map((p) => Math.hypot(p.x, p.y))) - PIN.rCladOut >= GUIDE.rOut,
      radialStackPositive: R_core > 10,
    },
  };
}

export function minPinSpacing(pins) {
  let m = Infinity;
  for (let i = 0; i < pins.length; i++) {
    for (let j = i + 1; j < pins.length; j++) {
      const d = Math.hypot(pins[i].x - pins[j].x, pins[i].y - pins[j].y);
      if (d < m) m = d;
    }
  }
  return m;
}

// Volume-based fractions inside the core for a given moderator choice.
// With no solid moderator, all void is coolant. With a solid moderator, the void is split
// evenly between coolant channels and moderator (documented simplification).
export function coreVolumeFractions(geom, hasModerator) {
  const v = geom.fractions.void;
  const coolant = hasModerator ? 0.5 * v : v;
  const moderator = hasModerator ? 0.5 * v : 0;
  return {
    fuel: geom.fractions.fuel,
    clad: geom.fractions.clad,
    guideWall: geom.fractions.guideWall,
    coolant,
    moderator,
  };
}
