// Slate Rocky & Thermal Weathering Simulation Engine
// Modeled after QuadSpinner Gaea's Rocky & Thermal Shaper:
// - Talus scree slopes via Angle of Repose failure
// - Cellular rock shattering on cliff faces
// - Exposed bedrock vs scree deposition tracking

import { voronoi2D, getPermutationTable } from '../math/noise';
import type { RockyThermalConfig } from '../../types/terrain';

export interface RockyThermalOutputs {
  heightmap: Float32Array;
  wearMap: Float32Array;
  depositMap: Float32Array;
}

export function simulateRockyThermal(
  initialHeights: Float32Array,
  resolution: number,
  config: RockyThermalConfig,
  existingWear?: Float32Array,
  existingDeposits?: Float32Array
): RockyThermalOutputs {
  const size = resolution;
  const totalCells = size * size;

  const heights = new Float32Array(initialHeights);
  const wearMap = new Float32Array(totalCells);
  const depositMap = new Float32Array(totalCells);

  if (existingWear) wearMap.set(existingWear);
  if (existingDeposits) depositMap.set(existingDeposits);

  const perm = getPermutationTable(config.seed);
  const iterations = Math.min(60, Math.max(1, config.iterations));

  // Critical angle of repose in normalized height units per grid cell
  const reposeRad = (config.angleRepose * Math.PI) / 180.0;
  // Cell spacing in normalized [0, 1] domain
  const cellDist = 1.0 / size;
  const criticalSlope = Math.tan(reposeRad) * cellDist * 0.45;

  const talusFactor = config.talusVolume * 0.5;

  // 1. Thermal slope relaxation / scree cascade
  for (let iter = 0; iter < iterations; iter++) {
    for (let z = 1; z < size - 1; z++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = z * size + x;
        const h = heights[idx];

        // Find neighbor with largest downhill drop
        let maxDrop = 0;
        let lowestIdx = -1;

        const neighbors = [
          idx - 1,
          idx + 1,
          idx - size,
          idx + size,
          idx - size - 1,
          idx - size + 1,
          idx + size - 1,
          idx + size + 1,
        ];

        for (const nIdx of neighbors) {
          const drop = h - heights[nIdx];
          if (drop > maxDrop) {
            maxDrop = drop;
            lowestIdx = nIdx;
          }
        }

        // If slope exceeds angle of repose, cascade unstable material
        if (maxDrop > criticalSlope && lowestIdx !== -1) {
          const excess = (maxDrop - criticalSlope) * 0.35;
          heights[idx] -= excess;
          heights[lowestIdx] += excess * talusFactor;

          wearMap[idx] += excess;
          depositMap[lowestIdx] += excess * talusFactor;
        }
      }
    }
  }

  // 2. Cellular Rock Shatter on steep bare faces
  if (config.shatterStrength > 0) {
    const shatterScale = config.shatterScale;
    const shatterStrength = config.shatterStrength * 0.04;

    for (let z = 1; z < size - 1; z++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = z * size + x;
        const hL = heights[idx - 1];
        const hR = heights[idx + 1];
        const hU = heights[idx - size];
        const hD = heights[idx + size];

        const slope = Math.hypot((hR - hL) * 0.5, (hD - hU) * 0.5) / cellDist;

        // Rock shatter primarily targets steep exposed cliffs
        if (slope > 0.4) {
          const u = x / size;
          const v = z / size;
          const vor = voronoi2D(u * shatterScale, v * shatterScale, 0.9, perm);
          const fracture = (vor.f2_f1 - 0.5) * shatterStrength;
          heights[idx] = Math.max(0, heights[idx] + fracture);
          wearMap[idx] += Math.abs(fracture);
        }
      }
    }
  }

  return {
    heightmap: heights,
    wearMap,
    depositMap,
  };
}
