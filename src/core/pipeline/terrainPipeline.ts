// Slate Layer-Stack Pipeline Execution Engine
// Sequentially executes the Layer Stack (Generators, Sculpting, Modifiers,
// Hydraulic Erosion, Rain Precipitation, Alluvial Deposits, Rocky Thermal, and SatMaps)

import type {
  TerrainLayer,
  TerrainSimulationResult,
  BlendMode,
  SatMapConfig,
} from '../../types/terrain';
import {
  evaluateMountain,
  evaluateVoronoi,
  evaluateRidge,
  evaluatePlateau,
  evaluateCaldera,
  evaluateCanyon,
  evaluateDunes,
  applyStrataTerrace,
  applyDisplace,
} from '../sdf/primitives';
import { simulateHydraulicErosion } from '../simulation/hydraulic';
import { computePrecipitationMask } from '../simulation/rain';
import { simulateAlluvialDeposits } from '../simulation/alluvial';
import { simulateRockyThermal } from '../simulation/rocky';
import { applySculptStrokes } from '../simulation/sculpt';
import { generateSatMapAlbedo } from '../satmaps/shader';
import { getSatMapPresetById } from '../satmaps/library';

// Layer Blending Operators
function blendValues(base: number, layer: number, mode: BlendMode, opacity: number): number {
  let res = base;
  switch (mode) {
    case 'normal':
      res = layer;
      break;
    case 'add':
      res = base + layer;
      break;
    case 'subtract':
      res = base - layer;
      break;
    case 'multiply':
      res = base * layer;
      break;
    case 'min':
      res = Math.min(base, layer);
      break;
    case 'max':
      res = Math.max(base, layer);
      break;
    case 'screen':
      res = 1.0 - (1.0 - base) * (1.0 - layer);
      break;
    case 'overlay':
      res = base < 0.5 ? 2.0 * base * layer : 1.0 - 2.0 * (1.0 - base) * (1.0 - layer);
      break;
  }
  return base * (1.0 - opacity) + res * opacity;
}

// Compute accurate 3D surface normals
export function computeNormals(
  heights: Float32Array,
  resolution: number,
  heightScale: number = 0.5
): Float32Array {
  const size = resolution;
  const normals = new Float32Array(size * size * 3);
  const cellStep = 1.0 / (size - 1);

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const idx = z * size + x;
      const nIdx = idx * 3;

      const xL = Math.max(0, x - 1);
      const xR = Math.min(size - 1, x + 1);
      const zU = Math.max(0, z - 1);
      const zD = Math.min(size - 1, z + 1);

      const hL = heights[z * size + xL];
      const hR = heights[z * size + xR];
      const hU = heights[zU * size + x];
      const hD = heights[zD * size + x];

      // Central difference
      const dx = (xR - xL) * cellStep;
      const dz = (zD - zU) * cellStep;
      const dy_dx = (hR - hL) * heightScale;
      const dy_dz = (hD - hU) * heightScale;

      // Normal is (-dy/dx, 1, -dy/dz) normalized
      let nx = -dy_dx / dx;
      let ny = 1.0;
      let nz = -dy_dz / dz;

      const len = Math.hypot(nx, ny, nz) || 1.0;
      normals[nIdx] = nx / len;
      normals[nIdx + 1] = ny / len;
      normals[nIdx + 2] = nz / len;
    }
  }

  return normals;
}

export function executeTerrainPipeline(
  layers: TerrainLayer[],
  resolution: number
): TerrainSimulationResult {
  const startTime = performance.now();
  const size = resolution;
  const totalCells = size * size;

  let heights: Float32Array<any> = new Float32Array(totalCells);
  let wearMap: Float32Array<any> = new Float32Array(totalCells);
  let depositMap: Float32Array<any> = new Float32Array(totalCells);
  let flowMap: Float32Array<any> = new Float32Array(totalCells);
  let precipitationMask: Float32Array<any> = new Float32Array(totalCells);
  let satMapConfig: SatMapConfig | null = null;

  // Initialize precipitation with standard uniform probability
  precipitationMask.fill(1.0);

  // Execute layers in stack order (bottom to top)
  for (const layer of layers) {
    if (!layer.enabled) continue;

    switch (layer.type) {
      // --- GENERATORS ---
      case 'mountain_generator':
      case 'voronoi_generator':
      case 'ridge_generator':
      case 'plateau_generator':
      case 'caldera_generator':
      case 'canyon_generator':
      case 'dunes_generator': {
        const layerHeights = new Float32Array(totalCells);
        for (let z = 0; z < size; z++) {
          const v = z / (size - 1);
          for (let x = 0; x < size; x++) {
            const u = x / (size - 1);
            const idx = z * size + x;
            let val = 0;

            if (layer.type === 'mountain_generator') {
              val = evaluateMountain(u, v, layer);
            } else if (layer.type === 'voronoi_generator') {
              val = evaluateVoronoi(u, v, layer);
            } else if (layer.type === 'ridge_generator') {
              val = evaluateRidge(u, v, layer);
            } else if (layer.type === 'plateau_generator') {
              val = evaluatePlateau(u, v, layer);
            } else if (layer.type === 'caldera_generator') {
              val = evaluateCaldera(u, v, layer);
            } else if (layer.type === 'canyon_generator') {
              val = evaluateCanyon(u, v, layer);
            } else if (layer.type === 'dunes_generator') {
              val = evaluateDunes(u, v, layer);
            }

            layerHeights[idx] = val;
          }
        }

        // Apply layer mask & blend with base terrain
        for (let i = 0; i < totalCells; i++) {
          const baseH = heights[i];
          const genH = layerHeights[i];

          // Altitude masking
          let maskWeight = 1.0;
          if (layer.maskAltitudeMin > 0 && baseH < layer.maskAltitudeMin) {
            maskWeight *= Math.max(0, 1.0 - (layer.maskAltitudeMin - baseH) * 5.0);
          }
          if (layer.maskAltitudeMax < 1 && baseH > layer.maskAltitudeMax) {
            maskWeight *= Math.max(0, 1.0 - (baseH - layer.maskAltitudeMax) * 5.0);
          }
          if (layer.maskInvert) maskWeight = 1.0 - maskWeight;

          const blended = blendValues(baseH, genH, layer.blendMode, layer.opacity * maskWeight);
          heights[i] = Math.max(0, Math.min(1.0, blended));
        }
        break;
      }

      // --- SDF SCULPT LAYER ---
      case 'sdf_sculpt': {
        if (layer.strokes.length > 0) {
          const sculptRes = applySculptStrokes(
            heights,
            size,
            layer.strokes,
            wearMap,
            depositMap,
            precipitationMask
          );
          heights = sculptRes.heightmap;
          wearMap = sculptRes.wearMap;
          depositMap = sculptRes.depositMap;
          precipitationMask = sculptRes.precipitationMask;
        }
        break;
      }

      // --- MODIFIERS ---
      case 'strata_terrace': {
        for (let z = 0; z < size; z++) {
          const v = z / (size - 1);
          for (let x = 0; x < size; x++) {
            const u = x / (size - 1);
            const idx = z * size + x;
            const h = heights[idx];
            const terraced = applyStrataTerrace(h, u, v, layer);
            const blended = blendValues(h, terraced, layer.blendMode, layer.opacity);
            heights[idx] = Math.max(0, Math.min(1.0, blended));
          }
        }
        break;
      }

      case 'displace_perturb': {
        const displacedHeights = new Float32Array(totalCells);
        for (let z = 0; z < size; z++) {
          const v = z / (size - 1);
          for (let x = 0; x < size; x++) {
            const u = x / (size - 1);
            const idx = z * size + x;
            const h = heights[idx];
            const { du, dv } = applyDisplace(u, v, h, layer);

            const nu = Math.max(0, Math.min(1, u + du));
            const nv = Math.max(0, Math.min(1, v + dv));
            const nx = Math.floor(nu * (size - 1));
            const nz = Math.floor(nv * (size - 1));

            displacedHeights[idx] = heights[nz * size + nx];
          }
        }
        for (let i = 0; i < totalCells; i++) {
          const blended = blendValues(heights[i], displacedHeights[i], layer.blendMode, layer.opacity);
          heights[i] = Math.max(0, Math.min(1.0, blended));
        }
        break;
      }

      // --- RAIN / SELECTIVE PRECIPITATION ---
      case 'rain_precipitation': {
        precipitationMask = computePrecipitationMask(heights, size, layer, precipitationMask);
        break;
      }

      // --- GAEA HYDRAULIC EROSION ---
      case 'hydraulic_erosion': {
        const erosionRes = simulateHydraulicErosion(
          heights,
          size,
          layer,
          precipitationMask
        );

        // Blend eroded heightmap based on layer opacity
        for (let i = 0; i < totalCells; i++) {
          const blended = blendValues(heights[i], erosionRes.heightmap[i], layer.blendMode, layer.opacity);
          heights[i] = Math.max(0, Math.min(1.0, blended));
          wearMap[i] += erosionRes.wearMap[i] * layer.opacity;
          depositMap[i] += erosionRes.depositMap[i] * layer.opacity;
          flowMap[i] = Math.max(flowMap[i], erosionRes.flowMap[i]);
        }
        break;
      }

      // --- GAEA ALLUVIAL DEPOSITS ---
      case 'alluvial_deposits': {
        const alluvialRes = simulateAlluvialDeposits(
          heights,
          size,
          layer,
          depositMap
        );
        for (let i = 0; i < totalCells; i++) {
          const blended = blendValues(heights[i], alluvialRes.heightmap[i], layer.blendMode, layer.opacity);
          heights[i] = Math.max(0, Math.min(1.0, blended));
          depositMap[i] = alluvialRes.depositMap[i];
        }
        break;
      }

      // --- GAEA ROCKY / THERMAL WEATHERING ---
      case 'rocky_thermal': {
        const rockyRes = simulateRockyThermal(
          heights,
          size,
          layer,
          wearMap,
          depositMap
        );
        for (let i = 0; i < totalCells; i++) {
          const blended = blendValues(heights[i], rockyRes.heightmap[i], layer.blendMode, layer.opacity);
          heights[i] = Math.max(0, Math.min(1.0, blended));
          wearMap[i] = rockyRes.wearMap[i];
          depositMap[i] = rockyRes.depositMap[i];
        }
        break;
      }

      // --- SATMAP SATELLITE TEXTURING ---
      case 'satmap_color': {
        satMapConfig = layer;
        break;
      }
    }
  }

  // Calculate elevation statistics
  let minH = 1.0;
  let maxH = 0.0;
  for (let i = 0; i < totalCells; i++) {
    const h = heights[i];
    if (h < minH) minH = h;
    if (h > maxH) maxH = h;
  }
  if (minH > maxH) {
    minH = 0;
    maxH = 1;
  }

  // Calculate 3D Normals
  const normals = computeNormals(heights, size, 0.45);

  // Generate SatMap Albedo Texture
  const finalSatMapConfig: SatMapConfig = satMapConfig ?? {
    id: 'default_satmap',
    name: 'SatMap',
    type: 'satmap_color',
    enabled: true,
    opacity: 1.0,
    blendMode: 'normal',
    maskAltitudeMin: 0,
    maskAltitudeMax: 1,
    maskSlopeMin: 0,
    maskSlopeMax: 90,
    maskInvert: false,
    presetId: 'rocky_grand_canyon',
    category: 'rocky',
    driver: 'composite',
    slopeInfluence: 0.65,
    altitudeBias: 0.0,
    rockHighlightStrength: 0.6,
    flowWetness: 0.7,
    depositSiltBlend: 0.75,
    contrast: 1.15,
    brightness: 0.0,
    saturation: 1.1,
  };

  const albedoTexture = generateSatMapAlbedo(
    size,
    heights,
    normals,
    wearMap,
    depositMap,
    flowMap,
    finalSatMapConfig
  );

  const executionTimeMs = Math.round(performance.now() - startTime);

  return {
    resolution: size,
    heightmap: heights,
    normals,
    wearMap,
    depositMap,
    flowMap,
    precipitationMask,
    albedoTexture,
    minHeight: minH,
    maxHeight: maxH,
    executionTimeMs,
  };
}
