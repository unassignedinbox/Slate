// Slate Alluvial Deposits Engine
// Modeled after QuadSpinner Gaea's Alluvium & Deposits:
// - Crevice filling & concave valley settling
// - Alluvial fan formation at steep-to-flat slope transitions
// - Settling viscosity and chaotic sediment drift
// - Data map generation

import { fbm2D, getPermutationTable } from '../math/noise';
import type { AlluvialDepositsConfig } from '../../types/terrain';

export interface AlluvialOutputs {
  heightmap: Float32Array;
  depositMap: Float32Array;
}

export function simulateAlluvialDeposits(
  initialHeights: Float32Array,
  resolution: number,
  config: AlluvialDepositsConfig,
  existingDeposits?: Float32Array
): AlluvialOutputs {
  const size = resolution;
  const totalCells = size * size;

  const heights = new Float32Array(initialHeights);
  const depositMap = new Float32Array(totalCells);
  if (existingDeposits) {
    depositMap.set(existingDeposits);
  }

  const perm = getPermutationTable(config.seed);
  const iterations = Math.min(50, Math.max(1, config.iterations));
  const amount = config.amount * 0.15;
  const settling = config.settling;
  const chaos = config.chaos;

  // Temporary buffers for iterative multi-step diffusion
  const bufferA = new Float32Array(heights);
  const bufferB = new Float32Array(heights);

  let current = bufferA;
  let next = bufferB;

  for (let it = 0; it < iterations; it++) {
    for (let z = 1; z < size - 1; z++) {
      for (let x = 1; x < size - 1; x++) {
        const idx = z * size + x;
        const h = current[idx];

        // 4-neighbor heights
        const hL = current[idx - 1];
        const hR = current[idx + 1];
        const hU = current[idx - size];
        const hD = current[idx + size];

        // Laplacian curvature: positive = concave valley / crevice; negative = sharp peak/ridge
        const laplacian = (hL + hR + hU + hD) * 0.25 - h;

        // Local slope
        const slope = Math.hypot((hR - hL) * 0.5, (hD - hU) * 0.5);

        // Sediment drift perturbation
        let noiseOffset = 0;
        if (chaos > 0) {
          noiseOffset = fbm2D(x * 0.08, z * 0.08, 2, 0.5, 2.0, perm) * chaos * 0.02;
        }

        let depositInc = 0;

        if (config.mode === 'crevices') {
          // Crevice filling: targets deep narrow cracks and concave indentations
          if (laplacian > 0) {
            depositInc = Math.pow(laplacian * 4.0, config.power) * amount * (0.5 + settling * 1.5) + noiseOffset;
          }
        } else if (config.mode === 'valley_fans') {
          // Valley fans: deposits at slope breaks where water slows down
          const slopeBreak = Math.max(0, 0.35 - slope);
          const valleyWeight = Math.max(0, laplacian * 2.0 + slopeBreak * 0.5);
          depositInc = valleyWeight * amount * (1.0 + settling) + noiseOffset;
        } else {
          // Drift mode: large volume sediment drifts filling depressions
          if (slope < 0.2) {
            depositInc = (0.2 - slope) * amount * 2.5 + noiseOffset;
          }
        }

        depositInc = Math.max(0, depositInc * (1.0 - config.hardness * 0.7));
        next[idx] = h + depositInc;
        depositMap[idx] += depositInc;
      }
    }

    // Swap buffers
    const tmp = current;
    current = next;
    next = tmp;
  }

  return {
    heightmap: current,
    depositMap,
  };
}
