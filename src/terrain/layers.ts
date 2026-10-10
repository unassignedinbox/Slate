/** Layer-stack data model: terrain (generation) layers and material layers. */
import { MAX_GEN_LAYERS, MAX_MAT_LAYERS, type ErosionSettings, type RenderSettings, type WorldSettings } from './engine';

export const GEN_TYPES = [
  'fBm', 'Ridged', 'Billow', 'Warped fBm', 'Cellular', 'Terrace', 'Curve', 'Radial', 'Tilt', 'Detail',
] as const;
export const BLEND_MODES = ['Add', 'Max', 'Min', 'Multiply', 'Replace', 'Subtract'] as const;

export interface GenLayer {
  id: number; name: string; type: number; blend: number; enabled: boolean;
  strength: number; freq: number; octaves: number; lacunarity: number; gain: number;
  warpAmp: number; warpFreq: number; offX: number; offY: number;
  maskLo: number; maskHi: number; maskSoft: number; extra: number; seedOffset: number;
}

export interface MatLayer {
  id: number; name: string; enabled: boolean; strength: number;
  albedo: [number, number, number]; albedo2: [number, number, number]; rough: number;
  altLo: number; altHi: number; slopeLo: number; slopeHi: number;
  soft: number; slopeSoft: number;
  wetW: number; depW: number; eroW: number; aoW: number; curvW: number;
  noiseScale: number; noiseAmt: number; detailScale: number; blendSharp: number; sparkle: number;
}

let uid = 1;
export const newId = () => uid++;

export function genLayer(p: Partial<GenLayer> = {}): GenLayer {
  return {
    id: newId(), name: 'Noise', type: 0, blend: 0, enabled: true,
    strength: 0.5, freq: 3, octaves: 8, lacunarity: 2.02, gain: 0.5,
    warpAmp: 0.4, warpFreq: 1.2, offX: 0, offY: 0,
    maskLo: -0.1, maskHi: 1.1, maskSoft: 0.08, extra: 0.5, seedOffset: 0,
    ...p,
  };
}

export function matLayer(p: Partial<MatLayer> = {}): MatLayer {
  return {
    id: newId(), name: 'Material', enabled: true, strength: 1,
    albedo: [0.34, 0.31, 0.28], albedo2: [0.26, 0.24, 0.22], rough: 0.9,
    altLo: -0.1, altHi: 1.1, slopeLo: -0.1, slopeHi: 1.1,
    soft: 0.08, slopeSoft: 0.08,
    wetW: 0, depW: 0, eroW: 0, aoW: 0, curvW: 0,
    noiseScale: 0.02, noiseAmt: 0, detailScale: 0.01, blendSharp: 1, sparkle: 0,
    ...p,
  };
}

/* ------------------------------ encoding ------------------------------ */

export function encodeGen(layers: GenLayer[]): { data: Float32Array; count: number } {
  const active = layers.filter(l => l.enabled).slice(0, MAX_GEN_LAYERS);
  const data = new Float32Array(MAX_GEN_LAYERS * 4 * 4);
  active.forEach((l, i) => {
    const o = i * 16;
    data[o + 0] = l.type; data[o + 1] = l.blend; data[o + 2] = l.strength; data[o + 3] = l.seedOffset;
    data[o + 4] = l.freq; data[o + 5] = l.octaves; data[o + 6] = l.lacunarity; data[o + 7] = l.gain;
    data[o + 8] = l.warpAmp; data[o + 9] = l.warpFreq; data[o + 10] = l.offX; data[o + 11] = l.offY;
    data[o + 12] = l.maskLo; data[o + 13] = l.maskHi; data[o + 14] = l.maskSoft; data[o + 15] = l.extra;
  });
  return { data, count: active.length };
}

export function encodeMat(layers: MatLayer[]): { data: Float32Array; count: number } {
  const active = layers.filter(l => l.enabled).slice(0, MAX_MAT_LAYERS);
  const data = new Float32Array(72 * 4);
  active.forEach((l, i) => {
    const o = i * 24;
    data[o + 0] = l.albedo[0]; data[o + 1] = l.albedo[1]; data[o + 2] = l.albedo[2]; data[o + 3] = l.rough;
    data[o + 4] = l.altLo; data[o + 5] = l.altHi; data[o + 6] = l.slopeLo; data[o + 7] = l.slopeHi;
    data[o + 8] = l.soft; data[o + 9] = l.wetW; data[o + 10] = l.depW; data[o + 11] = l.noiseScale;
    data[o + 12] = l.noiseAmt; data[o + 13] = l.curvW; data[o + 14] = l.aoW; data[o + 15] = l.strength;
    data[o + 16] = l.albedo2[0]; data[o + 17] = l.albedo2[1]; data[o + 18] = l.albedo2[2]; data[o + 19] = l.detailScale;
    data[o + 20] = l.slopeSoft; data[o + 21] = l.blendSharp; data[o + 22] = l.eroW; data[o + 23] = l.sparkle;
  });
  return { data, count: active.length };
}

/* ------------------------------ defaults ------------------------------ */

export const defaultWorld = (): WorldSettings => ({
  seed: 1337, worldSize: 8000, heightScale: 1600,
  strataScale: 9, strataContrast: 0.65, strataTilt: 0.25,
  seaLevel: 0.12,
  aoDirs: 12, aoSteps: 12, aoRadius: 900,
  flowGain: 90, depGain: 26, eroGain: 30,
});

export const defaultErosion = (): ErosionSettings => ({
  iterations: 260,
  rain: 0.0115, evaporation: 0.022, capacity: 0.95, dissolve: 0.35, deposit: 0.35,
  minSlope: 0.018, gravity: 9.81, pipeArea: 1.0, inertia: 0.92, dt: 0.085,
  hardnessInfluence: 0.85, talus: 0.72, thermalRate: 0.28, thermalEvery: 3,
  rainSpotScale: 2.6, rainSpotAmount: 0.55,
});

export const defaultRender = (): RenderSettings => ({
  sunAzimuth: 128, sunElevation: 26, sunIntensity: 4.1,
  sunColor: [1.0, 0.86, 0.68],
  zenith: [0.22, 0.38, 0.68], horizon: [0.62, 0.68, 0.76],
  ambient: 0.85, bounce: 0.22, exposure: 1.05, fog: 1.0,
  shadowSteps: 48, detail: 0.35, shadingMode: 0,
  showWater: true, wireframe: false,
});

/* ------------------------------- presets ------------------------------ */

export interface Preset {
  name: string;
  gen: GenLayer[];
  mats: MatLayer[];
  world?: Partial<WorldSettings>;
  erosion?: Partial<ErosionSettings>;
  render?: Partial<RenderSettings>;
}

const rock = (p: Partial<MatLayer>) => matLayer(p);

export const PRESETS: Preset[] = [
  {
    name: 'Alpine Massif',
    gen: [
      genLayer({ name: 'Continental base', type: 0, blend: 4, strength: 1, freq: 1.1, octaves: 6, gain: 0.52 }),
      genLayer({ name: 'Ranges', type: 1, blend: 0, strength: 0.72, freq: 2.2, octaves: 9, gain: 0.5, extra: 0.55 }),
      genLayer({ name: 'Warped relief', type: 3, blend: 0, strength: 0.22, freq: 1.6, octaves: 6, warpAmp: 0.55, warpFreq: 1.1 }),
      genLayer({ name: 'Peak sharpening', type: 6, blend: 4, strength: 0.75, freq: 1.45, maskLo: 0.35, maskHi: 1.2, maskSoft: 0.2 }),
      genLayer({ name: 'Ridge detail', type: 1, blend: 0, strength: 0.10, freq: 9, octaves: 6, extra: 0.8, maskLo: 0.3, maskHi: 1.2, maskSoft: 0.22 }),
    ],
    mats: [
      rock({ name: 'Bedrock', albedo: [0.27, 0.26, 0.25], albedo2: [0.19, 0.18, 0.18], rough: 0.92, detailScale: 0.004, noiseAmt: 0 }),
      rock({ name: 'Cliff granite', albedo: [0.33, 0.31, 0.3], albedo2: [0.22, 0.21, 0.21], rough: 0.85, slopeLo: 0.42, slopeHi: 1.2, slopeSoft: 0.12, eroW: 0.35, detailScale: 0.012 }),
      rock({ name: 'Scree', albedo: [0.38, 0.35, 0.31], albedo2: [0.3, 0.28, 0.25], rough: 0.95, slopeLo: 0.18, slopeHi: 0.52, slopeSoft: 0.1, depW: 0.55, curvW: 0.4, noiseScale: 0.05, noiseAmt: 0.22 }),
      rock({ name: 'Alpine turf', albedo: [0.12, 0.17, 0.08], albedo2: [0.17, 0.21, 0.1], rough: 0.95, altLo: 0.12, altHi: 0.52, soft: 0.1, slopeLo: -0.1, slopeHi: 0.3, slopeSoft: 0.1, curvW: 0.3, noiseScale: 0.012, noiseAmt: 0.25 }),
      rock({ name: 'Valley sediment', albedo: [0.42, 0.37, 0.3], albedo2: [0.33, 0.29, 0.24], rough: 0.9, slopeLo: -0.1, slopeHi: 0.18, slopeSoft: 0.07, depW: 0.9, curvW: 0.5 }),
      rock({ name: 'Snow', albedo: [0.92, 0.94, 0.98], albedo2: [0.82, 0.86, 0.95], rough: 0.32, altLo: 0.58, altHi: 1.2, soft: 0.12, slopeLo: -0.1, slopeHi: 0.46, slopeSoft: 0.14, curvW: 0.35, sparkle: 0.5, detailScale: 0.02 }),
    ],
  },
  {
    name: 'Desert Mesas',
    gen: [
      genLayer({ name: 'Plain', type: 0, blend: 4, strength: 1, freq: 0.9, octaves: 5, gain: 0.45 }),
      genLayer({ name: 'Plateaus', type: 4, blend: 0, strength: 0.55, freq: 2.6 }),
      genLayer({ name: 'Mesa benches', type: 5, blend: 4, strength: 0.85, freq: 0.7, extra: 9 }),
      genLayer({ name: 'Wind detail', type: 2, blend: 0, strength: 0.06, freq: 12, octaves: 5 }),
    ],
    mats: [
      rock({ name: 'Red bed', albedo: [0.42, 0.21, 0.12], albedo2: [0.33, 0.16, 0.09], rough: 0.95, detailScale: 0.006 }),
      rock({ name: 'Buff strata', albedo: [0.56, 0.42, 0.26], albedo2: [0.47, 0.34, 0.2], rough: 0.92, eroW: 0.5, slopeLo: 0.3, slopeHi: 1.2, slopeSoft: 0.12, detailScale: 0.03 }),
      rock({ name: 'Caprock', albedo: [0.3, 0.26, 0.22], albedo2: [0.24, 0.2, 0.17], rough: 0.88, slopeLo: -0.1, slopeHi: 0.2, slopeSoft: 0.06, altLo: 0.45, altHi: 1.2, soft: 0.1 }),
      rock({ name: 'Dune sand', albedo: [0.72, 0.58, 0.36], albedo2: [0.62, 0.49, 0.3], rough: 0.85, slopeLo: -0.1, slopeHi: 0.22, slopeSoft: 0.08, depW: 0.85, curvW: 0.5, sparkle: 0.12 }),
      rock({ name: 'Wash gravel', albedo: [0.5, 0.44, 0.34], albedo2: [0.4, 0.35, 0.28], rough: 0.93, wetW: 0.6, depW: 0.4 }),
    ],
    world: { heightScale: 1100, strataScale: 16, strataContrast: 0.9, seaLevel: 0.02 },
    erosion: { rain: 0.006, capacity: 0.75, talus: 1.15, thermalRate: 0.22, iterations: 200 },
    render: { sunAzimuth: 58, sunElevation: 19, sunColor: [1.0, 0.78, 0.55], horizon: [0.76, 0.66, 0.55], zenith: [0.28, 0.44, 0.7] },
  },
  {
    name: 'Coastal Fjords',
    gen: [
      genLayer({ name: 'Shelf', type: 0, blend: 4, strength: 1, freq: 1.3, octaves: 7, gain: 0.55 }),
      genLayer({ name: 'Coast ranges', type: 1, blend: 0, strength: 0.6, freq: 2.8, octaves: 9, extra: 0.6 }),
      genLayer({ name: 'Inlets', type: 3, blend: 5, strength: 0.3, freq: 1.5, octaves: 5, warpAmp: 0.9, warpFreq: 0.8 }),
      genLayer({ name: 'Island falloff', type: 7, blend: 3, strength: 0.9, freq: 1.0, maskLo: 0.55, maskHi: 1.25 }),
    ],
    mats: [
      rock({ name: 'Wet bedrock', albedo: [0.2, 0.21, 0.21], albedo2: [0.14, 0.15, 0.16], rough: 0.7, detailScale: 0.008 }),
      rock({ name: 'Sea cliff', albedo: [0.3, 0.3, 0.31], albedo2: [0.21, 0.22, 0.23], rough: 0.8, slopeLo: 0.4, slopeHi: 1.2, slopeSoft: 0.1, eroW: 0.4 }),
      rock({ name: 'Moss', albedo: [0.1, 0.16, 0.08], albedo2: [0.14, 0.2, 0.1], rough: 0.96, altLo: 0.14, altHi: 0.6, soft: 0.12, slopeLo: -0.1, slopeHi: 0.34, slopeSoft: 0.1, curvW: 0.35, noiseScale: 0.01, noiseAmt: 0.3 }),
      rock({ name: 'Shore sand', albedo: [0.56, 0.52, 0.44], albedo2: [0.46, 0.43, 0.36], rough: 0.88, altLo: 0.1, altHi: 0.17, soft: 0.03, depW: 0.5 }),
      rock({ name: 'Snowline', albedo: [0.9, 0.93, 0.97], albedo2: [0.8, 0.85, 0.93], rough: 0.35, altLo: 0.66, altHi: 1.2, soft: 0.1, slopeLo: -0.1, slopeHi: 0.42, slopeSoft: 0.12, sparkle: 0.45 }),
    ],
    world: { seaLevel: 0.17, heightScale: 1500, worldSize: 9000 },
    erosion: { rain: 0.016, evaporation: 0.016, iterations: 300 },
    render: { sunAzimuth: 210, sunElevation: 15, sunColor: [1.0, 0.8, 0.62], zenith: [0.2, 0.33, 0.62], horizon: [0.7, 0.74, 0.8], fog: 1.6 },
  },
  {
    name: 'Volcanic Badlands',
    gen: [
      genLayer({ name: 'Shield', type: 0, blend: 4, strength: 1, freq: 0.8, octaves: 6, gain: 0.5 }),
      genLayer({ name: 'Cone', type: 7, blend: 0, strength: 0.75, freq: 1.0, maskLo: 0.0, maskHi: 1.2 }),
      genLayer({ name: 'Flows', type: 3, blend: 0, strength: 0.25, freq: 3.2, octaves: 7, warpAmp: 0.7, warpFreq: 1.6 }),
      genLayer({ name: 'Gullies', type: 1, blend: 5, strength: 0.14, freq: 10, octaves: 6, extra: 0.9, maskLo: 0.2, maskHi: 0.95, maskSoft: 0.2 }),
    ],
    mats: [
      rock({ name: 'Basalt', albedo: [0.1, 0.095, 0.1], albedo2: [0.07, 0.07, 0.075], rough: 0.78, detailScale: 0.01 }),
      rock({ name: 'Scoria', albedo: [0.26, 0.12, 0.09], albedo2: [0.18, 0.09, 0.07], rough: 0.95, slopeLo: 0.25, slopeHi: 1.2, slopeSoft: 0.12, eroW: 0.45 }),
      rock({ name: 'Ash drift', albedo: [0.34, 0.32, 0.31], albedo2: [0.27, 0.26, 0.26], rough: 0.97, depW: 0.8, curvW: 0.5, slopeLo: -0.1, slopeHi: 0.3, slopeSoft: 0.1 }),
      rock({ name: 'Sulphur', albedo: [0.62, 0.55, 0.16], albedo2: [0.5, 0.45, 0.14], rough: 0.8, wetW: 0.7, noiseScale: 0.03, noiseAmt: 0.35, strength: 0.7 }),
    ],
    world: { heightScale: 1800, strataScale: 6, strataContrast: 0.4, seaLevel: 0.03 },
    erosion: { rain: 0.013, dissolve: 0.45, talus: 0.85, iterations: 240 },
    render: { sunAzimuth: 300, sunElevation: 12, sunColor: [1.0, 0.72, 0.5], zenith: [0.18, 0.22, 0.34], horizon: [0.5, 0.42, 0.4], exposure: 1.15 },
  },
];

/* --------------------------- inspector schema -------------------------- */

export interface Field {
  key: string; label: string; min?: number; max?: number; step?: number;
  type?: 'range' | 'color' | 'select' | 'check'; options?: readonly string[];
  show?: (l: never) => boolean;
}

export const GEN_FIELDS: Field[] = [
  { key: 'type', label: 'Operator', type: 'select', options: GEN_TYPES },
  { key: 'blend', label: 'Blend', type: 'select', options: BLEND_MODES },
  { key: 'strength', label: 'Strength', min: 0, max: 2, step: 0.005 },
  { key: 'freq', label: 'Scale', min: 0.05, max: 24, step: 0.01 },
  { key: 'octaves', label: 'Octaves', min: 1, max: 12, step: 1 },
  { key: 'lacunarity', label: 'Lacunarity', min: 1.2, max: 3.2, step: 0.01 },
  { key: 'gain', label: 'Gain', min: 0.2, max: 0.8, step: 0.005 },
  { key: 'extra', label: 'Sharpness / Steps', min: 0, max: 16, step: 0.05 },
  { key: 'warpAmp', label: 'Warp amount', min: 0, max: 2, step: 0.01 },
  { key: 'warpFreq', label: 'Warp scale', min: 0.1, max: 6, step: 0.01 },
  { key: 'offX', label: 'Offset X', min: -20, max: 20, step: 0.05 },
  { key: 'offY', label: 'Offset Y', min: -20, max: 20, step: 0.05 },
  { key: 'maskLo', label: 'Mask from', min: -0.1, max: 1.1, step: 0.005 },
  { key: 'maskHi', label: 'Mask to', min: -0.1, max: 1.2, step: 0.005 },
  { key: 'maskSoft', label: 'Mask falloff', min: 0.001, max: 0.4, step: 0.001 },
  { key: 'seedOffset', label: 'Seed offset', min: 0, max: 64, step: 1 },
];

export const MAT_FIELDS: Field[] = [
  { key: 'albedo', label: 'Albedo A', type: 'color' },
  { key: 'albedo2', label: 'Albedo B', type: 'color' },
  { key: 'rough', label: 'Roughness', min: 0.02, max: 1, step: 0.005 },
  { key: 'strength', label: 'Coverage', min: 0, max: 1, step: 0.005 },
  { key: 'altLo', label: 'Altitude from', min: -0.1, max: 1.1, step: 0.005 },
  { key: 'altHi', label: 'Altitude to', min: -0.1, max: 1.2, step: 0.005 },
  { key: 'soft', label: 'Altitude falloff', min: 0.002, max: 0.4, step: 0.002 },
  { key: 'slopeLo', label: 'Slope from', min: -0.1, max: 1.1, step: 0.005 },
  { key: 'slopeHi', label: 'Slope to', min: -0.1, max: 1.2, step: 0.005 },
  { key: 'slopeSoft', label: 'Slope falloff', min: 0.002, max: 0.4, step: 0.002 },
  { key: 'curvW', label: 'Concavity (−convex)', min: -1, max: 1, step: 0.01 },
  { key: 'wetW', label: 'Flow / wetness', min: 0, max: 1, step: 0.01 },
  { key: 'depW', label: 'Sediment', min: 0, max: 1, step: 0.01 },
  { key: 'eroW', label: 'Scoured rock', min: 0, max: 1, step: 0.01 },
  { key: 'aoW', label: 'Openness', min: 0, max: 1, step: 0.01 },
  { key: 'noiseScale', label: 'Breakup scale', min: 0.001, max: 0.2, step: 0.001 },
  { key: 'noiseAmt', label: 'Breakup amount', min: 0, max: 0.5, step: 0.005 },
  { key: 'detailScale', label: 'Macro variation', min: 0.0005, max: 0.08, step: 0.0005 },
  { key: 'blendSharp', label: 'Blend sharpness', min: 0.1, max: 4, step: 0.02 },
  { key: 'sparkle', label: 'Glitter', min: 0, max: 1, step: 0.01 },
];
