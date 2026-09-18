// Slate SDF Sculpting Engine for Interactive Custom Erosion and Terrain Shaping
// Enables artists to sculpt custom downcutting gullies, talus deposits, alluvial washes, and rock fractures

import { voronoi2D, getPermutationTable } from '../math/noise';
import type { SculptStroke } from '../../types/terrain';

export interface SculptOutputs {
  heightmap: Float32Array;
  wearMap: Float32Array;
  depositMap: Float32Array;
  precipitationMask: Float32Array;
}

export function applySculptStrokes(
  initialHeights: Float32Array,
  resolution: number,
  strokes: SculptStroke[],
  existingWear?: Float32Array,
  existingDeposits?: Float32Array,
  existingPrecip?: Float32Array
): SculptOutputs {
  const size = resolution;
  const totalCells = size * size;

  const heights = new Float32Array(initialHeights);
  const wearMap = new Float32Array(totalCells);
  const depositMap = new Float32Array(totalCells);
  const precipMask = new Float32Array(totalCells);

  if (existingWear) wearMap.set(existingWear);
  if (existingDeposits) depositMap.set(existingDeposits);
  if (existingPrecip) precipMask.set(existingPrecip);

  const perm = getPermutationTable(42);

  for (const stroke of strokes) {
    const cx = stroke.x * size;
    const cz = stroke.y * size;
    const r = Math.max(1, stroke.radius * size);
    const rSq = r * r;
    const strength = stroke.strength;

    const minX = Math.max(0, Math.floor(cx - r));
    const maxX = Math.min(size - 1, Math.ceil(cx + r));
    const minZ = Math.max(0, Math.floor(cz - r));
    const maxZ = Math.min(size - 1, Math.ceil(cz + r));

    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - cx;
        const dz = z - cz;
        const distSq = dx * dx + dz * dz;

        if (distSq <= rSq) {
          const dist = Math.sqrt(distSq);
          const normDist = dist / r; // [0, 1]
          const idx = z * size + x;

          // Smooth cosine falloff: (cos(pi * d) + 1) / 2
          const falloff = 0.5 * (Math.cos(Math.PI * normDist) + 1.0);

          switch (stroke.tool) {
            case 'carve_gully': {
              // Directed downcutting: V-shaped incision profile with sharp channel bed
              // Profile: (1 - normDist)^1.5 creates sharp riverbed cut
              const carveAmount = Math.pow(1.0 - normDist, 1.8) * strength * 0.15;
              heights[idx] = Math.max(0, heights[idx] - carveAmount);
              wearMap[idx] += carveAmount;
              break;
            }

            case 'deposit_talus': {
              // Talus scree mound with natural conical repose angle
              // Profile: cone slope (1 - normDist)
              const depositAmount = (1.0 - normDist) * strength * 0.12;
              heights[idx] = Math.min(1.0, heights[idx] + depositAmount);
              depositMap[idx] += depositAmount;
              break;
            }

            case 'alluvial_wash': {
              // Smooths local area into gentle alluvial flats
              // Sample local 3x3 neighborhood average
              let avgH = 0;
              let count = 0;
              for (let sy = -1; sy <= 1; sy++) {
                for (let sx = -1; sx <= 1; sx++) {
                  const nx = Math.max(0, Math.min(size - 1, x + sx));
                  const nz = Math.max(0, Math.min(size - 1, z + sy));
                  avgH += heights[nz * size + nx];
                  count++;
                }
              }
              avgH /= count;
              const blend = falloff * strength * 0.5;
              heights[idx] = heights[idx] * (1.0 - blend) + avgH * blend;
              depositMap[idx] += Math.max(0, avgH - heights[idx]) * blend;
              break;
            }

            case 'rock_chisel': {
              // Fractured rock sculpting: stamps cellular fractures
              const vor = voronoi2D(x * 0.15, z * 0.15, 0.9, perm);
              const fracture = (vor.f2_f1 - 0.5) * strength * 0.08 * falloff;
              heights[idx] = Math.max(0, Math.min(1.0, heights[idx] + fracture));
              wearMap[idx] += Math.abs(fracture);
              break;
            }

            case 'raise_peak': {
              const delta = falloff * strength * 0.15;
              heights[idx] = Math.min(1.0, heights[idx] + delta);
              break;
            }

            case 'lower_valley': {
              const delta = falloff * strength * 0.15;
              heights[idx] = Math.max(0, heights[idx] - delta);
              wearMap[idx] += delta;
              break;
            }

            case 'flatten_plateau': {
              const target = stroke.targetHeight ?? 0.5;
              const diff = target - heights[idx];
              const delta = diff * falloff * strength * 0.4;
              heights[idx] = Math.max(0, Math.min(1.0, heights[idx] + delta));
              if (delta < 0) wearMap[idx] += -delta;
              else depositMap[idx] += delta;
              break;
            }

            case 'rain_painter': {
              // Paints precipitation probability mask
              const delta = falloff * strength;
              precipMask[idx] = Math.min(1.0, precipMask[idx] + delta);
              break;
            }
          }
        }
      }
    }
  }

  return {
    heightmap: heights,
    wearMap,
    depositMap,
    precipitationMask: precipMask,
  };
}
