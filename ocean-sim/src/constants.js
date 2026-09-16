// src/constants.js
// Physical and mathematical constants for GTA 6 / AAA grade ocean fluid simulation

export const PHYSICS = {
  GRAVITY: 9.80665,             // m/s^2 standard gravitational acceleration
  WATER_DENSITY: 1025.0,        // kg/m^3 (Salt water oceanic density)
  AIR_DENSITY: 1.225,           // kg/m^3
  WATER_IOR: 1.3333,            // Index of refraction for seawater
  FRESNEL_F0: 0.02037,          // Normal reflectance ((1.3333 - 1) / (1.3333 + 1))^2
  MICHE_CRITERION_LIMIT: 0.142, // H / lambda limit for wave breaking
  STOKES_MAX_STEEPNESS: 0.4432, // k * A limit for Stokes wave
};

// Ocean optical extinction parameters (Beer-Lambert law absorption per meter)
export const OPTICS = {
  // Red is absorbed within 4-5m; Blue penetrates deepest (up to 40m+)
  ABSORPTION_COEFFS: {
    r: 0.26,
    g: 0.048,
    b: 0.012
  },
  // Subsurface scattering tint (emerald/cyan wave crest translucency)
  SSS_TINT: {
    r: 0.08,
    g: 0.78,
    b: 0.65
  },
  // Deep abyssal oceanic body color
  DEEP_WATER_COLOR: {
    r: 0.008,
    g: 0.045,
    b: 0.12
  },
  // Shallow clear turquoise color
  SHALLOW_WATER_COLOR: {
    r: 0.02,
    g: 0.35,
    b: 0.42
  }
};

export const PARTICLE_CONFIG = {
  MAX_PARTICLES: 28000,         // Optimized for 60 FPS on GTX cards (GTX 1060+)
  SPRAY_LIFETIME_MIN: 0.8,
  SPRAY_LIFETIME_MAX: 2.2,
  FOAM_LIFETIME_MIN: 3.5,
  FOAM_LIFETIME_MAX: 8.0,
  GRAVITY: 9.81,
  DRAG_COEFFICIENT: 0.45,
  STOKES_DRIFT_FACTOR: 1.3,
  WIND_SHEAR_FACTOR: 0.035,
};
