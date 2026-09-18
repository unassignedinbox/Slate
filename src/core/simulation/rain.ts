// Slate Rain / Selective Precipitation Engine
// Modeled after QuadSpinner Gaea's Rain & Selective Precipitation:
// - Orographic precipitation (windward cloud lift)
// - Leeward Rain Shadow
// - Altitude condensation limits
// - Directional wind vectors

import type { RainPrecipitationConfig } from '../../types/terrain';

export function computePrecipitationMask(
  heights: Float32Array,
  resolution: number,
  config: RainPrecipitationConfig,
  sculptedMask?: Float32Array
): Float32Array {
  const size = resolution;
  const totalCells = size * size;
  const mask = new Float32Array(totalCells);

  const rad = (config.windAngle * Math.PI) / 180.0;
  const windX = Math.cos(rad);
  const windZ = Math.sin(rad);

  const windStrength = config.windStrength;
  const rainShadowStrength = config.rainShadowStrength;
  const altMin = config.altitudeMin;
  const altMax = config.altitudeMax;
  const amount = config.precipitationAmount;

  for (let z = 1; z < size - 1; z++) {
    for (let x = 1; x < size - 1; x++) {
      const idx = z * size + x;
      const h = heights[idx];

      // Altitude condensation curve
      let altFactor = 1.0;
      if (h < altMin) {
        altFactor = Math.max(0, 1.0 - (altMin - h) * 4.0);
      } else if (h > altMax) {
        altFactor = Math.max(0, 1.0 - (h - altMax) * 4.0);
      }

      // Compute local slope gradient
      const dhdx = (heights[z * size + (x + 1)] - heights[z * size + (x - 1)]) * 0.5;
      const dhdz = (heights[(z + 1) * size + x] - heights[(z - 1) * size + x]) * 0.5;

      // Orographic lift: windward slope facing oncoming wind
      // dot product between surface normal projected into 2D and wind direction
      const facing = -(dhdx * windX + dhdz * windZ);

      let orographic = 1.0;
      if (windStrength > 0) {
        if (facing > 0) {
          // Windward slope: enhanced precipitation
          orographic += facing * windStrength * 4.0;
        } else {
          // Leeward slope: rain shadow
          orographic = Math.max(0.1, orographic + facing * rainShadowStrength * 2.0);
        }
      }

      let precip = altFactor * orographic * amount;

      // Combine with sculpted precipitation brush mask if available
      if (sculptedMask && sculptedMask[idx] > 0) {
        precip = Math.max(precip, sculptedMask[idx]);
      }

      mask[idx] = Math.max(0, Math.min(1.0, precip));
    }
  }

  return mask;
}
