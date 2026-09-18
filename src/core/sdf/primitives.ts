// SDF Primitives, CSG, and Procedural Terrain Generators for Slate Studio

import {
  fbm2D,
  ridgeNoise2D,
  voronoi2D,
  domainWarp2D,
  smin,
  smax,
  simplex2D,
  getPermutationTable,
} from '../math/noise';
import type {
  MountainGeneratorConfig,
  VoronoiGeneratorConfig,
  RidgeGeneratorConfig,
  PlateauGeneratorConfig,
  CalderaGeneratorConfig,
  CanyonGeneratorConfig,
  DunesGeneratorConfig,
  StrataTerraceConfig,
  DisplacePerturbConfig,
} from '../../types/terrain';

/**
 * Evaluates Mountain Generator using SDF Cone + Fractal Brownian Motion
 */
export function evaluateMountain(
  u: number,
  v: number,
  config: MountainGeneratorConfig
): number {
  const perm = getPermutationTable(config.seed);
  // Center coordinates [-1, 1]
  const x = (u - 0.5) * 2.0 * config.scale;
  const z = (v - 0.5) * 2.0 * config.scale;

  const r = Math.hypot(x, z);
  // Primary conical profile
  let baseShape = Math.max(0, 1.0 - Math.pow(r, config.peakSharpness * 0.7));

  // Multi-octave fBm perturbation
  const noise = fbm2D(
    x * 1.5,
    z * 1.5,
    Math.min(config.octaves, 8),
    config.roughness,
    config.lacunarity,
    perm
  );

  // Secondary radial ridges
  const angle = Math.atan2(z, x);
  const radialRidges = Math.abs(Math.sin(angle * 4.0 + noise * 2.0)) * 0.25;

  let h = baseShape * (0.8 + noise * 0.4 * config.roughness + radialRidges);
  h = Math.max(0, Math.min(1, h * config.height));
  return h;
}

/**
 * Evaluates Voronoi Generator (matching Gaea's classic displaced Voronoi technique)
 */
export function evaluateVoronoi(
  u: number,
  v: number,
  config: VoronoiGeneratorConfig
): number {
  const perm = getPermutationTable(config.seed);
  const x = u * config.scale * 4.0;
  const z = v * config.scale * 4.0;

  // Domain warp to break artificial hexagonal cell alignment
  const { wx, wy } = domainWarp2D(x, z, config.jitter * 0.4, 0.8, perm);

  const vor = voronoi2D(wx, wy, config.jitter, perm);
  let val: number;

  if (config.inverted) {
    // Inverted creates stepped canyon walls and basins
    val = Math.pow(1.0 - Math.min(1.0, vor.f1 * 0.8), config.ridgeSharpness);
  } else {
    // F2 - F1 gives dramatic razor ridges and shattered slope facets
    val = Math.pow(Math.min(1.0, vor.f2_f1 * 1.6), config.ridgeSharpness);
  }

  // Add subtle fractal detail
  const micro = fbm2D(wx * 2.0, wy * 2.0, 3, 0.4, 2.0, perm);
  val = Math.max(0, Math.min(1, (val + micro * 0.15) * config.height));
  return val;
}

/**
 * Evaluates Ridge Generator for sharp alpine arêtes and glacial horns
 */
export function evaluateRidge(
  u: number,
  v: number,
  config: RidgeGeneratorConfig
): number {
  const perm = getPermutationTable(config.seed);
  const x = (u - 0.5) * config.scale * 5.0;
  const z = (v - 0.5) * config.scale * 5.0;

  const ridge = ridgeNoise2D(x, z, config.octaves, config.gain, 2.0, perm);
  // Mountain falloff towards edges
  const r = Math.hypot((u - 0.5) * 2, (v - 0.5) * 2);
  const falloff = Math.max(0, 1.0 - Math.pow(r, config.sharpness));

  return Math.max(0, Math.min(1, ridge * falloff * config.height));
}

/**
 * Evaluates Plateau / Mesa Generator (SDF Rounded Box profile with talus slope)
 */
export function evaluatePlateau(
  u: number,
  v: number,
  config: PlateauGeneratorConfig
): number {
  const perm = getPermutationTable(config.seed);
  const x = Math.abs((u - 0.5) * 2.0 * config.scale);
  const z = Math.abs((v - 0.5) * 2.0 * config.scale);

  // SDF box distance in 2D
  const bx = 0.55;
  const bz = 0.55;
  const dx = x - bx;
  const dz = z - bz;
  const outsideDist = Math.hypot(Math.max(dx, 0), Math.max(dz, 0));
  const insideDist = Math.min(Math.max(dx, dz), 0);
  const dist = outsideDist + insideDist;

  // Steep cliff falloff with bevel
  const bevel = Math.max(0.01, config.bevelWidth);
  let h = 1.0 - Math.min(1.0, Math.max(0.0, (dist + bevel) / (bevel * 2.0)));

  // Terrace stepping for mesa strata layers
  if (config.terraceSteps > 1) {
    const steps = config.terraceSteps;
    const stepVal = Math.floor(h * steps) / steps;
    const stepFrac = (h * steps) - Math.floor(h * steps);
    const smoothedStep = stepVal + (Math.pow(stepFrac, 3.0) / steps);
    h = h * 0.3 + smoothedStep * 0.7;
  }

  // Micro surface rock roughness
  const noise = fbm2D(u * 8.0, v * 8.0, 4, 0.45, 2.0, perm);
  h += noise * 0.05 * config.roughness;

  return Math.max(0, Math.min(1, h * config.height));
}

/**
 * Evaluates Caldera / Volcanic Crater SDF
 */
export function evaluateCaldera(
  u: number,
  v: number,
  config: CalderaGeneratorConfig
): number {
  const perm = getPermutationTable(config.seed);
  const x = (u - 0.5) * 2.0;
  const z = (v - 0.5) * 2.0;
  const r = Math.hypot(x, z);

  // Outer volcano slope
  let h = Math.max(0, 1.0 - r * 0.9);

  // Ring crater ridge
  const rimRadius = config.radius;
  const distToRim = Math.abs(r - rimRadius);
  const rimEffect = Math.exp(-Math.pow(distToRim * 4.0, 2.0)) * config.rimHeight;
  h += rimEffect;

  // Crater bowl depression inside rim
  if (r < rimRadius) {
    const insideRatio = r / rimRadius;
    const bowlDepth = Math.cos(insideRatio * Math.PI * 0.5) * config.floorDepth;
    h -= bowlDepth;

    // Resurgent central cone
    if (config.centralConeHeight > 0) {
      const coneR = r / (rimRadius * 0.35);
      if (coneR < 1.0) {
        h += (1.0 - coneR) * config.centralConeHeight;
      }
    }
  }

  // Add volcanic tephra roughness
  const tephra = fbm2D(u * 12.0, v * 12.0, 4, 0.5, 2.0, perm);
  h += tephra * 0.08 * config.roughness;

  return Math.max(0, Math.min(1, h));
}

/**
 * Evaluates Canyon / Ravine Carving Generator
 */
export function evaluateCanyon(
  u: number,
  v: number,
  config: CanyonGeneratorConfig
): number {
  const perm = getPermutationTable(config.seed);
  // Sinuous meander path
  const meanderOffset = Math.sin(v * Math.PI * 2.0 * config.meander) * 0.2 +
                        Math.cos(v * Math.PI * 4.0 * config.meander) * 0.1;
  const distToCenter = Math.abs(u - 0.5 - meanderOffset);

  const canyonWidth = Math.max(0.02, config.width);
  if (distToCenter < canyonWidth) {
    const normDist = distToCenter / canyonWidth;
    let carveDepth = Math.cos(normDist * Math.PI * 0.5) * config.depth;

    // Terrace canyon walls like Grand Canyon
    if (config.terraces > 1) {
      const steps = config.terraces;
      carveDepth = Math.floor(carveDepth * steps) / steps;
    }
    return 1.0 - carveDepth;
  }
  return 1.0;
}

/**
 * Evaluates Sand Dunes Generator (Directional asymmetrical wind slip-faces)
 */
export function evaluateDunes(
  u: number,
  v: number,
  config: DunesGeneratorConfig
): number {
  const perm = getPermutationTable(config.seed);
  const rad = (config.windAngle * Math.PI) / 180.0;
  const cosA = Math.cos(rad);
  const sinA = Math.sin(rad);

  // Rotate coordinates aligned with wind direction
  const rx = (u - 0.5) * cosA - (v - 0.5) * sinA;
  const ry = (u - 0.5) * sinA + (v - 0.5) * cosA;

  // Sinuous wave perturbation
  const waveWarp = fbm2D(rx * 3.0, ry * 1.5, 3, 0.4, 2.0, perm) * 0.3;
  const phase = (rx * config.scale * 6.0 + waveWarp) * Math.PI * 2.0;

  // Asymmetric slip face: gentle stoss slope, steep leeward drop
  const sinVal = Math.sin(phase);
  let duneWave = (sinVal + 1.0) * 0.5;
  if (config.asymmetry > 0) {
    // Skew the wave curve
    duneWave = Math.pow(duneWave, 1.0 + config.asymmetry * 2.0);
  }

  // Secondary ripples
  const ripplePhase = (rx * config.scale * 30.0) * Math.PI * 2.0;
  const ripple = Math.sin(ripplePhase) * 0.04;

  return Math.max(0, Math.min(1, (duneWave * 0.9 + ripple) * config.height));
}

/**
 * Applies Geological Strata / Terracing Modifier
 */
export function applyStrataTerrace(
  h: number,
  u: number,
  v: number,
  config: StrataTerraceConfig
): number {
  const clampedH = Math.max(0, Math.min(1, h));
  const freq = config.frequency;
  const warp = Math.sin(u * 10.0 + v * 8.0) * config.warpStrength * 0.1;
  const scaledH = Math.max(0, (clampedH + warp) * freq);
  const floorH = Math.floor(scaledH);
  const fracH = Math.max(0, Math.min(1, scaledH - floorH));

  // S-curve smoothstep for sharp shelf-and-step strata
  const sharpness = Math.max(0.01, config.sharpness);
  const exponent = 1.0 / Math.max(0.001, 1.0 - sharpness * 0.9);
  const t = Math.pow(fracH, exponent);
  const terraced = (floorH + t) / freq;

  return Math.max(0, Math.min(1, terraced - warp));
}

/**
 * Applies Gaea-style Displace / Perturb to break uniform slope lines
 */
export function applyDisplace(
  u: number,
  v: number,
  h: number,
  config: DisplacePerturbConfig
): { du: number; dv: number } {
  const perm = getPermutationTable(config.seed);
  const dx = simplex2D(u * config.frequency, v * config.frequency, perm) * config.strength * 0.05;
  const dy = simplex2D((u + 4.3) * config.frequency, (v + 1.7) * config.frequency, perm) * config.strength * 0.05;
  return { du: dx, dv: dy };
}
