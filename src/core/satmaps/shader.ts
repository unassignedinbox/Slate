// Slate SatMap Evaluation Engine
// Generates photorealistic terrain albedo maps using Gaea SatMap CLUT gradients,
// combining elevation, slope, wear, deposits, flow wetness, and Surfacer rock highlights.

import type { SatMapConfig, SatMapPreset } from '../../types/terrain';
import { getSatMapPresetById } from './library';

// Helper to convert hex '#rrggbb' to RGB [r, g, b]
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

// Sample gradient color from multi-stop preset
function sampleGradient(stops: { position: number; color: string }[], t: number): [number, number, number] {
  const clampedT = Math.max(0, Math.min(1, t));

  if (clampedT <= stops[0].position) {
    return hexToRgb(stops[0].color);
  }
  if (clampedT >= stops[stops.length - 1].position) {
    return hexToRgb(stops[stops.length - 1].color);
  }

  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (clampedT >= s0.position && clampedT <= s1.position) {
      const range = s1.position - s0.position;
      const factor = range > 0.0001 ? (clampedT - s0.position) / range : 0;
      const c0 = hexToRgb(s0.color);
      const c1 = hexToRgb(s1.color);
      return [
        c0[0] + factor * (c1[0] - c0[0]),
        c0[1] + factor * (c1[1] - c0[1]),
        c0[2] + factor * (c1[2] - c0[2]),
      ];
    }
  }

  return hexToRgb(stops[0].color);
}

// Screen blend helper
function blendScreen(base: number, blend: number): number {
  return 255 - ((255 - base) * (255 - blend)) / 255;
}

export function generateSatMapAlbedo(
  resolution: number,
  heights: Float32Array,
  normals: Float32Array,
  wearMap: Float32Array,
  depositMap: Float32Array,
  flowMap: Float32Array,
  config: SatMapConfig
): Uint8ClampedArray {
  const size = resolution;
  const totalCells = size * size;
  const pixels = new Uint8ClampedArray(totalCells * 4);

  const preset: SatMapPreset = getSatMapPresetById(config.presetId);
  const rockTintRgb = preset.rockTint ? hexToRgb(preset.rockTint) : [255, 255, 255];
  const siltTintRgb = preset.siltTint ? hexToRgb(preset.siltTint) : [160, 130, 95];
  const wetnessTintRgb = preset.wetnessTint ? hexToRgb(preset.wetnessTint) : [30, 25, 20];

  const slopeInfluence = config.slopeInfluence;
  const altitudeBias = config.altitudeBias;
  const rockHighlight = config.rockHighlightStrength;
  const flowWetness = config.flowWetness;
  const depositSiltBlend = config.depositSiltBlend;
  const contrast = config.contrast;
  const brightness = config.brightness;
  const saturation = config.saturation;

  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const idx = z * size + x;
      const nIdx = idx * 3;
      const pIdx = idx * 4;

      const h = heights[idx];
      const ny = normals[nIdx + 1]; // Up component of normal
      // Slope: 0 is completely flat, 1 is vertical cliff
      const slope = Math.max(0, Math.min(1, 1.0 - ny));

      const wear = wearMap[idx];
      const deposit = depositMap[idx];
      const flow = flowMap[idx];

      // Curvature / Convexity for Gaea Surfacer rock highlight
      // Sharp protruding ridges have lower neighbor averages
      let laplacian = 0;
      if (x > 0 && x < size - 1 && z > 0 && z < size - 1) {
        const hL = heights[idx - 1];
        const hR = heights[idx + 1];
        const hU = heights[idx - size];
        const hD = heights[idx + size];
        laplacian = (hL + hR + hU + hD) * 0.25 - h;
      }
      // Protruding ridge if laplacian < 0
      const ridgeProtrusion = Math.max(0, -laplacian * 15.0);

      // Determine CLUT driver coordinate
      let driverVal = h;
      switch (config.driver) {
        case 'elevation':
          driverVal = h;
          break;
        case 'slope':
          driverVal = slope;
          break;
        case 'wear':
          driverVal = Math.min(1.0, wear * 3.0);
          break;
        case 'deposit':
          driverVal = Math.min(1.0, deposit * 4.0);
          break;
        case 'flow':
          driverVal = flow;
          break;
        case 'composite':
        default:
          // Gaea-style composite driver: combines altitude, slope modulation, and wear exposure
          driverVal = h * (1.0 - slopeInfluence * 0.5) + slope * slopeInfluence * 0.5;
          driverVal += wear * 0.2 - deposit * 0.1;
          break;
      }

      // Apply altitude bias
      driverVal = Math.max(0, Math.min(1.0, driverVal + altitudeBias * 0.3));

      // Sample base color from SatMap preset
      let [r, g, b] = sampleGradient(preset.stops, driverVal);

      // 1. Apply Deposit Silt Tinting in sedimentation zones
      if (depositSiltBlend > 0 && deposit > 0.001) {
        const siltWeight = Math.min(1.0, deposit * 3.5) * depositSiltBlend;
        r = r * (1 - siltWeight) + siltTintRgb[0] * siltWeight;
        g = g * (1 - siltWeight) + siltTintRgb[1] * siltWeight;
        b = b * (1 - siltWeight) + siltTintRgb[2] * siltWeight;
      }

      // 2. Apply Gaea Surfacer Rock Highlight (Screen blend mode for protruding wind streaks)
      if (rockHighlight > 0) {
        const highlightFactor = Math.min(1.0, (ridgeProtrusion * 0.8 + slope * 0.3 + wear * 0.5) * rockHighlight);
        if (highlightFactor > 0) {
          const screenR = blendScreen(r, rockTintRgb[0]);
          const screenG = blendScreen(g, rockTintRgb[1]);
          const screenB = blendScreen(b, rockTintRgb[2]);
          r = r * (1 - highlightFactor) + screenR * highlightFactor;
          g = g * (1 - highlightFactor) + screenG * highlightFactor;
          b = b * (1 - highlightFactor) + screenB * highlightFactor;
        }
      }

      // 3. Apply Flow Wetness: Darkens & saturates active stream channels
      if (flowWetness > 0 && flow > 0.02) {
        const wetFactor = Math.min(1.0, flow * 1.5) * flowWetness;
        r = r * (1 - wetFactor * 0.6) + wetnessTintRgb[0] * (wetFactor * 0.6);
        g = g * (1 - wetFactor * 0.6) + wetnessTintRgb[1] * (wetFactor * 0.6);
        b = b * (1 - wetFactor * 0.6) + wetnessTintRgb[2] * (wetFactor * 0.6);
      }

      // 4. Color Grading: Brightness & Contrast
      r = ((r / 255.0 - 0.5) * contrast + 0.5 + brightness) * 255.0;
      g = ((g / 255.0 - 0.5) * contrast + 0.5 + brightness) * 255.0;
      b = ((b / 255.0 - 0.5) * contrast + 0.5 + brightness) * 255.0;

      // 5. Saturation
      if (saturation !== 1.0) {
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray + saturation * (r - gray);
        g = gray + saturation * (g - gray);
        b = gray + saturation * (b - gray);
      }

      pixels[pIdx] = Math.max(0, Math.min(255, Math.round(r)));
      pixels[pIdx + 1] = Math.max(0, Math.min(255, Math.round(g)));
      pixels[pIdx + 2] = Math.max(0, Math.min(255, Math.round(b)));
      pixels[pIdx + 3] = 255;
    }
  }

  return pixels;
}
