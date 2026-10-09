// Landscape presets.
//
// Each preset is a complete, hand-tuned project: generators for the base
// shape, filters for the structure, a sequence of erosion passes for the
// processes that actually shaped it, and a satmap stack to paint the result.
// They are starting points, not locked recipes — pull any slider afterwards.

import type {
  ErosionLayer,
  HeightBlend,
  FilterLayer,
  GeneratorLayer,
  HeightLayer,
  MaskConfig,
  Project,
  Resolution,
  SatLayer,
} from './types';
import { newId } from './types';
import { defaultParams } from './params';
import { EROSION_MAP, GENERATOR_MAP, FILTER_MAP } from './registry';

/* ------------------------------------------------------------ builders ---- */

type Common = {
  opacity?: number;
  low?: number;
  high?: number;
  blend?: HeightBlend;
  mask?: MaskConfig;
  enabled?: boolean;
};

function mk(type: string, params: Record<string, number | string | boolean> = {}, extra: Partial<MaskConfig> = {}): MaskConfig {
  return { type, params, invert: false, falloff: 0.4, strength: 1, ...extra };
}

function gen(
  id: string,
  name: string,
  generator: string,
  params: Record<string, number | string | boolean> = {},
  common: Common = {},
): GeneratorLayer {
  const def = GENERATOR_MAP[generator];
  return {
    id,
    name,
    role: 'generator',
    generator,
    params: { ...defaultParams(def.params), ...params },
    blend: common.blend ?? 'add',
    enabled: common.enabled ?? true,
    opacity: common.opacity ?? 1,
    low: common.low ?? 0,
    high: common.high ?? 1,
    mask: common.mask ?? mk('none'),
  };
}

function ero(
  id: string,
  name: string,
  erosion: string,
  params: Record<string, number | string | boolean> = {},
  common: Common = {},
): ErosionLayer {
  const def = EROSION_MAP[erosion];
  return {
    id,
    name,
    role: 'erosion',
    erosion,
    params: { ...defaultParams(def.params), ...params },
    enabled: common.enabled ?? true,
    opacity: common.opacity ?? 1,
    low: 0,
    high: 1,
    mask: common.mask ?? mk('none'),
  };
}

function fil(
  id: string,
  name: string,
  filter: string,
  params: Record<string, number | string | boolean> = {},
  common: Common = {},
): FilterLayer {
  const def = FILTER_MAP[filter];
  return {
    id,
    name,
    role: 'filter',
    filter,
    params: { ...defaultParams(def.params), ...params },
    enabled: common.enabled ?? true,
    opacity: common.opacity ?? 1,
    low: 0,
    high: 1,
    mask: common.mask ?? mk('none'),
  };
}

function sat(
  id: string,
  name: string,
  channel: SatLayer['channel'],
  ramp: [number, string][],
  options: Partial<SatLayer> = {},
): SatLayer {
  return {
    id,
    name,
    enabled: true,
    channel,
    ramp: ramp.map(([at, color]) => ({ at, color })),
    min: 0,
    max: 1,
    gamma: 1,
    invert: false,
    blend: 'normal',
    opacity: 1,
    detail: 0,
    detailScale: 48,
    jitter: 0,
    slopeBlend: 0,
    mask: mk('none'),
    ...options,
  };
}

/* -------------------------------------------------------------- presets --- */

export interface PresetDef {
  id: string;
  name: string;
  group: string;
  blurb: string;
  /** Small inline SVG-ish description used by the preset browser. */
  tags: string[];
  build: () => Project;
}

function base(overrides: Partial<Project>): Project {
  return {
    version: 1,
    name: 'Untitled terrain',
    seed: 1337,
    // Presets open at draft resolution: the whole stack recomputes in about a
    // second, and the inspector can take it to 512 or 1024 for a final render.
    resolution: 256 as Resolution,
    extent: 4000,
    heightScale: 900,
    seaLevel: 0.12,
    layers: [],
    satmap: [],
    render: {
      sunAzimuth: 315,
      sunElevation: 42,
      shading: 1,
      ambient: 0.35,
      occlusion: 0.4,
      water: false,
      waterLevel: 0.12,
      waterColor: '#2f5b6b',
      fog: 0.15,
      wireframe: false,
      contour: false,
      snowline: 0.75,
      snowAmount: 0.8,
    },
    ...overrides,
  };
}

const canyonPreset: PresetDef = {
  id: 'canyons',
  name: 'Sandstone canyons',
  group: 'Sandstone country',
  blurb: 'A tableland dissected by entrenched meanders. Fluvial incision does the heavy lifting; thermal erosion dresses the walls.',
  tags: ['Fluvial', 'Strata', 'Arid'],
  build: () =>
    base({
      name: 'Sandstone canyons',
      seed: 20418,
      extent: 3200,
      heightScale: 720,
      seaLevel: 0.04,
      render: {
        sunAzimuth: 290,
        sunElevation: 38,
        shading: 1,
        ambient: 0.3,
        occlusion: 0.55,
        water: false,
        waterLevel: 0.04,
        waterColor: '#3a5b63',
        fog: 0.12,
        wireframe: false,
        contour: false,
        snowline: 0.9,
        snowAmount: 0.4,
      },
      layers: [
        gen('canyons-l1', 'Bedrock floor', 'constant', { value: 0.03 }),
        gen('canyons-l2', 'Tableland', 'plateau', {
          frequency: 1.5,
          topLevel: 0.74,
          edge: 0.13,
          incision: 0.5,
          incisionScale: 6.5,
          steps: 3,
          roughness: 0.24,
          seed: 12,
        }, { high: 0.82 }),
        gen('canyons-l3', 'Regional warp', 'multifractal', {
          frequency: 3.4,
          octaves: 7,
          offset: 1.15,
          warp: 0.35,
          seed: 88,
        }, { low: -0.03, high: 0.09 }),
        fil('canyons-l4', 'Bench the cliffs', 'terrace', {
          steps: 24,
          softness: 0.3,
          jitter: 0.32,
          warp: 0.12,
          warpScale: 4,
        }, { opacity: 0.6, mask: mk('slope', { min: 16, max: 85, softness: 0.1 }, { falloff: 0.5 }) }),
        ero('canyons-l5', 'Entrenched drainage', 'fluvial', {
          erodibility: 0.16,
          areaExp: 0.55,
          slopeExp: 1.25,
          iterations: 38,
          timestep: 0.6,
          threshold: 0.03,
          deposition: 0.26,
          bankSlope: 24,
          lateral: 0.38,
          uplift: 0.0006,
        }),
        ero('canyons-l6', 'Runoff channels', 'droplet', {
          droplets: 130,
          lifetime: 62,
          inertia: 0.3,
          capacity: 3.6,
          erosion: 0.95,
          deposition: 0.26,
          radius: 2,
          seed: 3,
        }),
        ero('canyons-l7', 'Wall retreat', 'thermal', { angle: 44, rate: 0.6, iterations: 42 }, {
          mask: mk('slope', { min: 18, max: 88, softness: 0.12 }, { falloff: 0.45 }),
        }),
        fil('canyons-l8', 'Grain', 'detail', { frequency: 96, octaves: 4, amount: 0.07, gate: 'flat' }),
      ],
      satmap: [
        sat('canyons-s1', 'Sandstone beds', 'strata', [
          [0, '#5d3220'],
          [0.35, '#8f4f2c'],
          [0.62, '#c07a45'],
          [0.85, '#e0a86a'],
          [1, '#f0cfa0'],
        ], { detail: 0.14, detailScale: 55, slopeBlend: 0.25 }),
        sat('canyons-s2', 'Shadowed hollows', 'cavity', [
          [0, '#17100c'],
          [0.5, '#6d5642'],
          [1, '#ffffff'],
        ], { blend: 'multiply', opacity: 0.7 }),
        sat('canyons-s3', 'Cliff faces', 'slope', [
          [0, '#8a5231'],
          [1, '#e6b57e'],
        ], { opacity: 0.75, mask: mk('slope', { min: 32, max: 88, softness: 0.14 }), detail: 0.1 }),
        sat('canyons-s4', 'Valley fill', 'sediment', [
          [0, '#a8783f'],
          [1, '#e7c795'],
        ], { opacity: 0.85, mask: mk('sediment', { threshold: 0.08, softness: 0.3 }), detail: 0.12 }),
        sat('canyons-s5', 'Channel gravel', 'rivers', [
          [0, '#6a4a2e'],
          [1, '#b1936d'],
        ], { opacity: 0.9, mask: mk('river', { threshold: 0.5, width: 0.22, softness: 0.8 }) }),
        sat('canyons-s6', 'Desert varnish', 'protrusion', [
          [0, '#3a2519'],
          [1, '#a9713f'],
        ], { opacity: 0.35, blend: 'overlay' }),
        sat('canyons-s7', 'Scrub', 'wetness', [
          [0, '#4b4a2c'],
          [1, '#7d7c46'],
        ], { opacity: 0.3, mask: mk('wetness', { threshold: 0.6, softness: 0.25 }, { falloff: 0.5 }) }),
      ],
    }),
};

const sandstoneCliffsPreset: PresetDef = {
  id: 'sandstone-cliffs',
  name: 'Sandstone cliffs',
  group: 'Sandstone country',
  blurb: 'Vertical faces and benches. Steepened escarpments shed debris that piles into talus at the foot.',
  tags: ['Strata', 'Mass wasting', 'Arid'],
  build: () =>
    base({
      name: 'Sandstone cliffs',
      seed: 7741,
      extent: 2200,
      heightScale: 520,
      seaLevel: 0.03,
      render: {
        sunAzimuth: 250,
        sunElevation: 34,
        shading: 1,
        ambient: 0.28,
        occlusion: 0.6,
        water: false,
        waterLevel: 0.03,
        waterColor: '#3a5b63',
        fog: 0.1,
        wireframe: false,
        contour: false,
        snowline: 0.92,
        snowAmount: 0.3,
      },
      layers: [
        gen('sandstone-l1', 'Floor', 'constant', { value: 0.06 }),
        gen('sandstone-l2', 'Upland block', 'plateau', {
          frequency: 1.2,
          topLevel: 0.78,
          edge: 0.05,
          incision: 0.28,
          incisionScale: 5,
          steps: 2,
          roughness: 0.2,
          seed: 41,
        }, { high: 0.9 }),
        gen('sandstone-l3', 'Crest detail', 'ridge', {
          frequency: 5.5,
          octaves: 7,
          sharpness: 2.4,
          warp: 0.3,
          seed: 9,
        }, { low: 0, high: 0.1 }),
        fil('sandstone-l4', 'Bed the stack', 'terrace', {
          steps: 18,
          softness: 0.14,
          jitter: 0.26,
          warp: 0.08,
          warpScale: 3,
        }, { opacity: 0.85, mask: mk('height', { low: 0.12, high: 1, softness: 0.06 }) }),
        fil('sandstone-l5', 'Sharpen escarpments', 'amplify', { threshold: 8, amount: 1.2, radius: 4 }, { opacity: 0.7 }),
        ero('sandstone-l6', 'Shattering', 'thermal', { angle: 58, rate: 0.5, iterations: 34 }),
        ero('sandstone-l7', 'Rockfall', 'masswasting', {
          critical: 56,
          slump: 0.55,
          runout: 44,
          repose: 33,
          entrainment: 0.25,
          iterations: 7,
        }),
        ero('sandstone-l8', 'Gully wash', 'droplet', { droplets: 80, lifetime: 50, erosion: 0.7, seed: 5 }),
      ],
      satmap: [
        sat('sandstone-s1', 'Stacked beds', 'strata', [
          [0, '#6b3a22'],
          [0.3, '#9c5730'],
          [0.55, '#c9834b'],
          [0.8, '#eab77e'],
          [1, '#f6dcb4'],
        ], { detail: 0.1, detailScale: 40, slopeBlend: 0.1 }),
        sat('sandstone-s2', 'Vertical faces', 'slope', [
          [0, '#7d4526'],
          [1, '#e4ab72'],
        ], { opacity: 0.85, mask: mk('cliff', { minSlope: 45, convexity: 0.5, relief: 0.1 }), detail: 0.16, detailScale: 90 }),
        sat('sandstone-s3', 'Talus', 'sediment', [
          [0, '#8b5c34'],
          [1, '#c69a68'],
        ], { opacity: 0.9, mask: mk('sediment', { threshold: 0.06, softness: 0.25 }), detail: 0.18, detailScale: 120 }),
        sat('sandstone-s4', 'Occlusion', 'cavity', [
          [0, '#150f0a'],
          [0.55, '#7a6350'],
          [1, '#ffffff'],
        ], { blend: 'multiply', opacity: 0.65 }),
        sat('sandstone-s5', 'Mesa top', 'height', [
          [0, '#8a7a55'],
          [1, '#b7a06e'],
        ], { opacity: 0.35, mask: mk('slope', { min: 0, max: 18, softness: 0.08 }) }),
        sat('sandstone-s6', 'Iron staining', 'roughness', [
          [0, '#5e3a25'],
          [1, '#a8613a'],
        ], { opacity: 0.25, blend: 'overlay' }),
      ],
    }),
};

const coastalCliffsPreset: PresetDef = {
  id: 'coastal-cliffs',
  name: 'Coastal cliffs',
  group: 'Coasts',
  blurb: 'A marine terrace cut by wave attack: undercut cliffs, collapsing toes, shore platforms and pocket beaches.',
  tags: ['Wave', 'Marine', 'Mass wasting'],
  build: () =>
    base({
      name: 'Coastal cliffs',
      seed: 51219,
      extent: 2600,
      heightScale: 380,
      seaLevel: 0.3,
      render: {
        sunAzimuth: 205,
        sunElevation: 36,
        shading: 1,
        ambient: 0.32,
        occlusion: 0.45,
        water: true,
        waterLevel: 0.3,
        waterColor: '#2b5566',
        fog: 0.28,
        wireframe: false,
        contour: false,
        snowline: 0.95,
        snowAmount: 0.2,
      },
      layers: [
        gen('coastal-l1', 'Shelf', 'gradient', { direction: 268, curve: 1.25, wobble: 0.35, wobbleScale: 3, seed: 4 }, { high: 0.55 }),
        gen('coastal-l2', 'Rolling headland', 'perlin', { frequency: 2.6, octaves: 8, gain: 0.5, warp: 0.25, seed: 21 }, { high: 0.42 }),
        gen('coastal-l3', 'Chalk texture', 'multifractal', { frequency: 6, octaves: 6, offset: 1.1, seed: 77 }, { low: 0, high: 0.06 }),
        fil('coastal-l4', 'Marine terrace', 'planation', { level: 0.52, softness: 0.07, mix: 0.7, side: 'above' }, { opacity: 0.8 }),
        ero('coastal-l5', 'Wave attack', 'coastal', {
          seaLevel: 0.3,
          waveHeight: 0.022,
          energy: 0.6,
          undercut: 0.85,
          retreat: 0.75,
          beach: 0.55,
          platform: 0.5,
          platformDepth: 0.035,
          iterations: 34,
        }),
        ero('coastal-l6', 'Cliff collapse', 'thermal', { angle: 50, rate: 0.55, iterations: 32 }, {
          mask: mk('coastal', { level: 0.3, width: 0.35, side: 'above', softness: 1.1 }),
        }),
        ero('coastal-l7', 'Slumps', 'masswasting', { critical: 50, slump: 0.45, runout: 22, repose: 30, iterations: 6 }),
        ero('coastal-l8', 'Stream catchments', 'droplet', { droplets: 70, lifetime: 46, erosion: 0.6, seed: 2 }),
        fil('coastal-l9', 'Surface grain', 'detail', { frequency: 110, octaves: 3, amount: 0.05, gate: 'flat' }),
      ],
      satmap: [
        sat('coastal-s1', 'Cliff rock', 'strata', [
          [0, '#5f5a4c'],
          [0.4, '#8d8878'],
          [0.7, '#c3bda9'],
          [1, '#e8e3d3'],
        ], { detail: 0.12, detailScale: 70, slopeBlend: 0.2 }),
        sat('coastal-s2', 'Grass tops', 'height', [
          [0, '#4d5a30'],
          [1, '#7e8b4a'],
        ], { opacity: 0.85, mask: mk('slope', { min: 0, max: 30, softness: 0.1 }, { falloff: 0.5 }), detail: 0.14, detailScale: 90 }),
        sat('coastal-s3', 'Fresh rock face', 'slope', [
          [0, '#7c7566'],
          [1, '#ddd6c2'],
        ], { opacity: 0.8, mask: mk('cliff', { minSlope: 38, convexity: 0.45, relief: 0.08 }), detail: 0.12 }),
        sat('coastal-s4', 'Beach & debris', 'sediment', [
          [0, '#8d7f63'],
          [1, '#d9c8a4'],
        ], { opacity: 0.9, mask: mk('sediment', { threshold: 0.05, softness: 0.25 }), detail: 0.15, detailScale: 110 }),
        sat('coastal-s5', 'Wet shore', 'sea', [
          [0, '#6b6350'],
          [1, '#3f4a45'],
        ], { opacity: 0.7, mask: mk('sea', { level: 0.3, softness: 0.05, mode: 'shore' }) }),
        sat('coastal-s6', 'Occlusion', 'cavity', [
          [0, '#141210'],
          [0.55, '#7b7568'],
          [1, '#ffffff'],
        ], { blend: 'multiply', opacity: 0.6 }),
      ],
    }),
};

const himalayaPreset: PresetDef = {
  id: 'himalaya',
  name: 'Himalayan range',
  group: 'High mountains',
  blurb: 'Continent-scale uplift, glacial overprint and monsoon drainage. Relief measured in kilometres.',
  tags: ['Glacial', 'Fluvial', 'Uplift'],
  build: () =>
    base({
      name: 'Himalayan range',
      seed: 90821,
      extent: 9000,
      heightScale: 2800,
      seaLevel: 0.02,
      render: {
        sunAzimuth: 135,
        sunElevation: 46,
        shading: 1,
        ambient: 0.34,
        occlusion: 0.42,
        water: false,
        waterLevel: 0.02,
        waterColor: '#375f6b',
        fog: 0.2,
        wireframe: false,
        contour: false,
        snowline: 0.68,
        snowAmount: 0.9,
      },
      layers: [
        gen('himalaya-l1', 'Basement', 'constant', { value: 0.05 }),
        gen('himalaya-l2', 'Orogen', 'mountain', {
          frequency: 1.7,
          octaves: 10,
          sharpness: 2.5,
          uplift: 1.55,
          continents: 1.05,
          roughness: 0.5,
          warp: 0.45,
          plains: 0.05,
          seed: 6,
        }, { high: 0.98 }),
        gen('himalaya-l3', 'Serrated crests', 'ridge', {
          frequency: 5.5,
          octaves: 8,
          sharpness: 2.8,
          warp: 0.4,
          seed: 33,
        }, { low: 0, high: 0.13, mask: mk('peak', { radius: 30, threshold: 0.28, softness: 0.45, heightGate: 0.3 }) }),
        ero('himalaya-l4', 'Monsoon rivers', 'fluvial', {
          erodibility: 0.18,
          areaExp: 0.5,
          slopeExp: 1.4,
          iterations: 42,
          timestep: 0.55,
          threshold: 0.02,
          deposition: 0.24,
          bankSlope: 28,
          lateral: 0.3,
          uplift: 0.005,
        }),
        ero('himalaya-l5', 'Valley glaciers', 'glacial', {
          ela: 0.6,
          accumulation: 0.6,
          abrasion: 0.62,
          plucking: 0.55,
          uShape: 0.72,
          cirque: 0.6,
          moraine: 0.5,
          iterations: 18,
        }),
        ero('himalaya-l6', 'Frost shatter', 'thermal', { angle: 41, rate: 0.55, iterations: 36 }),
        ero('himalaya-l7', 'Rock & ice fall', 'masswasting', { critical: 49, slump: 0.5, runout: 34, repose: 33, iterations: 7 }),
        ero('himalaya-l8', 'Solifluction', 'periglacial', {
          intensity: 0.5,
          cycles: 16,
          creep: 0.45,
          sorting: 0.32,
          sortingScale: 16,
          maxSlope: 42,
        }),
        ero('himalaya-l9', 'Slope wash', 'droplet', { droplets: 110, lifetime: 55, erosion: 0.8, capacity: 3.4, seed: 7 }),
      ],
      satmap: [
        sat('himalaya-s1', 'Bedrock', 'protrusion', [
          [0, '#3b3630'],
          [0.45, '#6b6259'],
          [0.75, '#968b7e'],
          [1, '#c0b4a4'],
        ], { detail: 0.16, detailScale: 80, slopeBlend: 0.3 }),
        sat('himalaya-s2', 'Scree & till', 'sediment', [
          [0, '#6a5f52'],
          [1, '#a89a86'],
        ], { opacity: 0.8, mask: mk('sediment', { threshold: 0.06, softness: 0.28 }), detail: 0.16, detailScale: 100 }),
        sat('himalaya-s3', 'Exposed rock', 'slope', [
          [0, '#4a443c'],
          [1, '#b3a896'],
        ], { opacity: 0.7, mask: mk('slope', { min: 34, max: 88, softness: 0.14 }), detail: 0.14 }),
        sat('himalaya-s4', 'Snow & ice', 'snow', [
          [0, '#b9c3cc'],
          [0.5, '#e2e8ee'],
          [1, '#ffffff'],
        ], { opacity: 1, detail: 0.06, detailScale: 30, mask: mk('snow', { snowline: 0.66, softness: 0.08, shedding: 0.7 }) }),
        sat('himalaya-s5', 'Glacier ice', 'rivers', [
          [0, '#8fa6b5'],
          [1, '#d6e4ec'],
        ], { opacity: 0.75, mask: mk('height', { low: 0.6, high: 1, softness: 0.08 }), detail: 0.1 }),
        sat('himalaya-s6', 'Alpine meadow', 'wetness', [
          [0, '#3f4a2b'],
          [1, '#6d7742'],
        ], { opacity: 0.45, mask: mk('height', { low: 0, high: 0.42, softness: 0.1 }), detail: 0.16 }),
        sat('himalaya-s7', 'Occlusion', 'cavity', [
          [0, '#100f0e'],
          [0.55, '#7b7368'],
          [1, '#ffffff'],
        ], { blend: 'multiply', opacity: 0.55 }),
      ],
    }),
};

const icelandPreset: PresetDef = {
  id: 'iceland',
  name: 'Icelandic basalt',
  group: 'Volcanic',
  blurb: 'Tabular basalt plateaus sliced by rifts, capped by ice caps and stitched with braided outwash plains.',
  tags: ['Glacial', 'Volcanic', 'Rift'],
  build: () =>
    base({
      name: 'Icelandic basalt',
      seed: 33127,
      extent: 6500,
      heightScale: 1150,
      seaLevel: 0.14,
      render: {
        sunAzimuth: 20,
        sunElevation: 28,
        shading: 1,
        ambient: 0.4,
        occlusion: 0.38,
        water: true,
        waterLevel: 0.14,
        waterColor: '#20414f',
        fog: 0.3,
        wireframe: false,
        contour: false,
        snowline: 0.76,
        snowAmount: 0.75,
      },
      layers: [
        gen('iceland-l1', 'Sea floor', 'constant', { value: 0.08 }),
        gen('iceland-l2', 'Basalt plateau', 'billow', { frequency: 2.1, octaves: 6, gain: 0.55, warp: 0.24, seed: 15 }, { high: 0.52 }),
        gen('iceland-l3', 'Tabular blocks', 'worley', { mode: 'cells', frequency: 4.2, jitter: 0.7, flatten: 0.55, seed: 61 }, { high: 0.16 }),
        gen('iceland-l4', 'Central volcano', 'volcano', {
          centerX: 0.34,
          centerY: 0.62,
          radius: 0.2,
          height: 0.5,
          flank: 1.6,
          crater: 0.5,
          craterWidth: 0.15,
          rough: 0.35,
          seed: 3,
        }, { high: 0.45 }),
        gen('iceland-l5', 'Rift grabens', 'rift', {
          frequency: 3.6,
          jitter: 0.55,
          width: 0.16,
          depth: 0.75,
          uplift: 0.22,
          direction: 24,
          grain: 0.55,
          seed: 44,
        }, { low: -0.14, high: 0.05 }),
        ero('iceland-l6', 'Ice caps', 'glacial', {
          ela: 0.58,
          accumulation: 0.55,
          abrasion: 0.58,
          plucking: 0.42,
          uShape: 0.62,
          cirque: 0.42,
          moraine: 0.45,
          iterations: 14,
        }),
        ero('iceland-l7', 'Braided outwash', 'fluvial', {
          erodibility: 0.13,
          areaExp: 0.42,
          slopeExp: 1.05,
          iterations: 26,
          timestep: 0.55,
          threshold: 0.02,
          deposition: 0.45,
          bankSlope: 18,
          lateral: 0.3,
        }),
        ero('iceland-l8', 'Frost weathering', 'periglacial', {
          intensity: 0.65,
          cycles: 22,
          creep: 0.5,
          sorting: 0.42,
          sortingScale: 14,
          maxSlope: 38,
        }),
        ero('iceland-l9', 'Talus', 'thermal', { angle: 37, rate: 0.5, iterations: 26 }),
        ero('iceland-l10', 'Meltwater', 'droplet', { droplets: 95, lifetime: 52, erosion: 0.75, capacity: 3.2, seed: 8 }),
      ],
      satmap: [
        sat('iceland-s1', 'Basalt', 'protrusion', [
          [0, '#23231f'],
          [0.4, '#3f403a'],
          [0.7, '#5a5a52'],
          [1, '#7d7b70'],
        ], { detail: 0.18, detailScale: 90, slopeBlend: 0.3 }),
        sat('iceland-s2', 'Moss & heath', 'wetness', [
          [0, '#33391f'],
          [1, '#5c6a35'],
        ], { opacity: 0.6, mask: mk('slope', { min: 0, max: 34, softness: 0.12 }), detail: 0.2, detailScale: 80 }),
        sat('iceland-s3', 'Ash & sandur', 'sediment', [
          [0, '#4a4741'],
          [1, '#9a948a'],
        ], { opacity: 0.85, mask: mk('sediment', { threshold: 0.05, softness: 0.25 }), detail: 0.15, detailScale: 130 }),
        sat('iceland-s4', 'Braided channels', 'rivers', [
          [0, '#5d5b52'],
          [1, '#9fa39a'],
        ], { opacity: 0.85, mask: mk('river', { threshold: 0.42, width: 0.28, softness: 0.7 }), detail: 0.12 }),
        sat('iceland-s5', 'Snow patches', 'snow', [
          [0, '#c3cdd4'],
          [1, '#f6fafd'],
        ], { opacity: 0.95, detail: 0.08, mask: mk('snow', { snowline: 0.7, softness: 0.1, shedding: 0.65 }) }),
        sat('iceland-s6', 'Scoria cones', 'roughness', [
          [0, '#2a2320'],
          [1, '#6b5145'],
        ], { opacity: 0.3, blend: 'overlay' }),
        sat('iceland-s7', 'Occlusion', 'cavity', [
          [0, '#0f0f0e'],
          [0.55, '#767470'],
          [1, '#ffffff'],
        ], { blend: 'multiply', opacity: 0.5 }),
      ],
    }),
};

const alpsPreset: PresetDef = {
  id: 'alps',
  name: 'Alps',
  group: 'High mountains',
  blurb: 'Limestone ranges reworked by ice: U-shaped troughs, hanging valleys, cirques and bright scree.',
  tags: ['Glacial', 'Limestone', 'Alpine'],
  build: () =>
    base({
      name: 'Alps',
      seed: 61610,
      extent: 5200,
      heightScale: 1750,
      seaLevel: 0.05,
      render: {
        sunAzimuth: 165,
        sunElevation: 40,
        shading: 1,
        ambient: 0.34,
        occlusion: 0.45,
        water: true,
        waterLevel: 0.1,
        waterColor: '#2d5f6e',
        fog: 0.22,
        wireframe: false,
        contour: false,
        snowline: 0.66,
        snowAmount: 0.85,
      },
      layers: [
        gen('alps-l1', 'Basement', 'constant', { value: 0.04 }),
        gen('alps-l2', 'Folded ranges', 'ridge', {
          frequency: 2.3,
          octaves: 9,
          sharpness: 2.2,
          threshold: 1,
          warp: 0.5,
          seed: 19,
        }, { high: 0.88 }),
        gen('alps-l3', 'Massifs', 'mountain', {
          frequency: 3.1,
          octaves: 8,
          sharpness: 2.1,
          uplift: 1.2,
          continents: 1.4,
          roughness: 0.45,
          plains: 0.1,
          seed: 72,
        }, { low: 0, high: 0.22, mask: mk('peak', { radius: 34, threshold: 0.2, softness: 0.5, heightGate: 0.35 }) }),
        ero('alps-l4', 'Ice ages', 'glacial', {
          ela: 0.56,
          accumulation: 0.6,
          abrasion: 0.6,
          plucking: 0.5,
          uShape: 0.78,
          cirque: 0.72,
          moraine: 0.48,
          iterations: 20,
        }),
        ero('alps-l5', 'Valley rivers', 'fluvial', {
          erodibility: 0.11,
          areaExp: 0.5,
          slopeExp: 1.15,
          iterations: 30,
          timestep: 0.5,
          threshold: 0.03,
          deposition: 0.34,
          bankSlope: 24,
          lateral: 0.32,
        }),
        ero('alps-l6', 'Scree slopes', 'thermal', { angle: 39, rate: 0.58, iterations: 38 }),
        ero('alps-l7', 'Rockfall', 'masswasting', { critical: 47, slump: 0.5, runout: 26, repose: 32, iterations: 7 }),
        ero('alps-l8', 'Frost creep', 'periglacial', {
          intensity: 0.45,
          cycles: 14,
          creep: 0.4,
          sorting: 0.22,
          sortingScale: 18,
          maxSlope: 40,
        }),
        ero('alps-l9', 'Torrents', 'droplet', { droplets: 110, lifetime: 54, erosion: 0.85, seed: 11 }),
      ],
      satmap: [
        sat('alps-s1', 'Limestone', 'strata', [
          [0, '#4e4f47'],
          [0.4, '#7c7d71'],
          [0.72, '#a9a898'],
          [1, '#d6d3c4'],
        ], { detail: 0.14, detailScale: 60, slopeBlend: 0.25 }),
        sat('alps-s2', 'Alpine pasture', 'height', [
          [0, '#46512b'],
          [1, '#7b8449'],
        ], { opacity: 0.8, mask: mk('height', { low: 0, high: 0.5, softness: 0.12 }), detail: 0.18, detailScale: 100 }),
        sat('alps-s3', 'Crags', 'slope', [
          [0, '#4b4941'],
          [1, '#b8b3a2'],
        ], { opacity: 0.75, mask: mk('slope', { min: 36, max: 88, softness: 0.14 }), detail: 0.16 }),
        sat('alps-s4', 'Scree & moraine', 'sediment', [
          [0, '#736d61'],
          [1, '#b5ad9c'],
        ], { opacity: 0.85, mask: mk('sediment', { threshold: 0.05, softness: 0.25 }), detail: 0.18, detailScale: 120 }),
        sat('alps-s5', 'Snow', 'snow', [
          [0, '#c2cbd4'],
          [1, '#ffffff'],
        ], { opacity: 1, detail: 0.07, mask: mk('snow', { snowline: 0.64, softness: 0.08, shedding: 0.75 }) }),
        sat('alps-s6', 'Occlusion', 'cavity', [
          [0, '#111110'],
          [0.55, '#7a7871'],
          [1, '#ffffff'],
        ], { blend: 'multiply', opacity: 0.55 }),
      ],
    }),
};

const snowyPreset: PresetDef = {
  id: 'snowy',
  name: 'Snowy mountains',
  group: 'High mountains',
  blurb: 'A low snow line and heavy ice: white summits, blue glacier tongues and dark rock where the wind scours it clean.',
  tags: ['Glacial', 'Snow', 'Ice'],
  build: () =>
    base({
      name: 'Snowy mountains',
      seed: 71717,
      extent: 6200,
      heightScale: 2100,
      seaLevel: 0.04,
      render: {
        sunAzimuth: 300,
        sunElevation: 44,
        shading: 1,
        ambient: 0.42,
        occlusion: 0.35,
        water: false,
        waterLevel: 0.04,
        waterColor: '#2f5a68',
        fog: 0.24,
        wireframe: false,
        contour: false,
        snowline: 0.46,
        snowAmount: 1,
      },
      layers: [
        gen('snowy-l1', 'Basement', 'constant', { value: 0.05 }),
        gen('snowy-l2', 'Range', 'mountain', {
          frequency: 1.9,
          octaves: 10,
          sharpness: 2.6,
          uplift: 1.6,
          continents: 1.1,
          roughness: 0.55,
          warp: 0.5,
          plains: 0.04,
          seed: 24,
        }, { high: 1 }),
        gen('snowy-l3', 'Summit ridges', 'ridge', {
          frequency: 6.5,
          octaves: 7,
          sharpness: 3,
          warp: 0.45,
          seed: 55,
        }, { low: 0, high: 0.12, mask: mk('peak', { radius: 26, threshold: 0.25, softness: 0.5, heightGate: 0.3 }) }),
        ero('snowy-l4', 'Ice', 'glacial', {
          ela: 0.42,
          accumulation: 0.65,
          abrasion: 0.65,
          plucking: 0.6,
          uShape: 0.7,
          cirque: 0.78,
          moraine: 0.5,
          iterations: 20,
        }),
        ero('snowy-l5', 'Freeze–thaw', 'periglacial', {
          intensity: 0.6,
          cycles: 18,
          creep: 0.5,
          sorting: 0.35,
          sortingScale: 16,
          maxSlope: 44,
        }),
        ero('snowy-l6', 'Rockfall', 'thermal', { angle: 37, rate: 0.55, iterations: 32 }),
        ero('snowy-l7', 'Meltwater', 'fluvial', {
          erodibility: 0.09,
          iterations: 22,
          threshold: 0.03,
          deposition: 0.35,
          lateral: 0.28,
        }),
        ero('snowy-l8', 'Slope wash', 'droplet', { droplets: 85, lifetime: 50, erosion: 0.6, seed: 13 }),
      ],
      satmap: [
        sat('snowy-s1', 'Dark rock', 'protrusion', [
          [0, '#2c2b2a'],
          [0.5, '#55534e'],
          [1, '#8a877e'],
        ], { detail: 0.15, detailScale: 80, slopeBlend: 0.3 }),
        sat('snowy-s2', 'Snow cover', 'snow', [
          [0, '#aebbc6'],
          [0.45, '#dce6ee'],
          [1, '#ffffff'],
        ], { opacity: 1, detail: 0.05, detailScale: 26 }),
        sat('snowy-s3', 'Glacier ice', 'rivers', [
          [0, '#7f9cae'],
          [1, '#cfe0ea'],
        ], { opacity: 0.8, mask: mk('height', { low: 0.45, high: 1, softness: 0.1 }), detail: 0.12 }),
        sat('snowy-s4', 'Moraine', 'sediment', [
          [0, '#5c564d'],
          [1, '#a49a8a'],
        ], { opacity: 0.8, mask: mk('sediment', { threshold: 0.05, softness: 0.25 }), detail: 0.16 }),
        sat('snowy-s5', 'Wind-scoured rock', 'slope', [
          [0, '#3a3733'],
          [1, '#9b958a'],
        ], { opacity: 0.7, mask: mk('slope', { min: 38, max: 88, softness: 0.14 }) }),
        sat('snowy-s6', 'Valley forest', 'height', [
          [0, '#26301f'],
          [1, '#3f5030'],
        ], { opacity: 0.6, mask: mk('height', { low: 0, high: 0.34, softness: 0.1 }), detail: 0.2 }),
        sat('snowy-s7', 'Occlusion', 'cavity', [
          [0, '#0e0f11'],
          [0.55, '#7c7d80'],
          [1, '#ffffff'],
        ], { blend: 'multiply', opacity: 0.45 }),
      ],
    }),
};

const outcropsPreset: PresetDef = {
  id: 'outcrops',
  name: 'Rugged outcrops',
  group: 'Lowland',
  blurb: 'Jointed bedrock breaking through a thin soil cover: tors, crags and blockfields on a human scale.',
  tags: ['Thermal', 'Fluvial', 'Granite'],
  build: () =>
    base({
      name: 'Rugged outcrops',
      seed: 28190,
      extent: 1800,
      heightScale: 420,
      seaLevel: 0.05,
      render: {
        sunAzimuth: 230,
        sunElevation: 32,
        shading: 1,
        ambient: 0.33,
        occlusion: 0.6,
        water: false,
        waterLevel: 0.05,
        waterColor: '#33555c',
        fog: 0.14,
        wireframe: false,
        contour: false,
        snowline: 0.95,
        snowAmount: 0.2,
      },
      layers: [
        gen('outcrops-l1', 'Bedrock', 'constant', { value: 0.14 }),
        gen('outcrops-l2', 'Joint blocks', 'worley', { mode: 'borders', frequency: 3.6, jitter: 0.8, flatten: 0, seed: 27 }, { high: 0.3 }),
        gen('outcrops-l3', 'Swells', 'billow', { frequency: 5, octaves: 6, gain: 0.6, warp: 0.3, seed: 91 }, { high: 0.24 }),
        gen('outcrops-l4', 'Crag detail', 'multifractal', { frequency: 7, octaves: 7, offset: 1.3, warp: 0.4, seed: 5 }, { high: 0.18 }),
        ero('outcrops-l5', 'Grus & ravel', 'thermal', { angle: 43, rate: 0.62, iterations: 46 }),
        ero('outcrops-l6', 'Runoff', 'droplet', { droplets: 140, lifetime: 58, erosion: 1, capacity: 3.4, radius: 2, seed: 17 }),
        fil('outcrops-l7', 'Crispen', 'amplify', { threshold: 10, amount: 1, radius: 3 }, { opacity: 0.6 }),
        fil('outcrops-l8', 'Grain', 'detail', { frequency: 130, octaves: 4, amount: 0.1, gate: 'all' }),
      ],
      satmap: [
        sat('outcrops-s1', 'Soil & grass', 'height', [
          [0, '#3d4227'],
          [1, '#6f7346'],
        ], { detail: 0.18, detailScale: 100 }),
        sat('outcrops-s2', 'Granite', 'slope', [
          [0, '#6f6a61'],
          [1, '#cfc7b6'],
        ], { opacity: 0.9, mask: mk('slope', { min: 26, max: 88, softness: 0.12 }), detail: 0.2, detailScale: 110 }),
        sat('outcrops-s3', 'Tors', 'protrusion', [
          [0, '#5c564d'],
          [1, '#b9b1a0'],
        ], { opacity: 0.8, mask: mk('peak', { radius: 18, threshold: 0.3, softness: 0.4, heightGate: 0.1 }), detail: 0.16 }),
        sat('outcrops-s4', 'Blockfield', 'roughness', [
          [0, '#4a463e'],
          [1, '#8d857a'],
        ], { opacity: 0.5, mask: mk('roughness', { threshold: 0.45, softness: 0.3 }), detail: 0.2, detailScale: 140 }),
        sat('outcrops-s5', 'Lichen', 'aspect', [
          [0, '#5d6350'],
          [1, '#98a08a'],
        ], { opacity: 0.25, blend: 'softlight' }),
        sat('outcrops-s6', 'Occlusion', 'cavity', [
          [0, '#100f0d'],
          [0.55, '#7a7468'],
          [1, '#ffffff'],
        ], { blend: 'multiply', opacity: 0.7 }),
      ],
    }),
};

const dunesPreset: PresetDef = {
  id: 'dunes',
  name: 'Desert dunes',
  group: 'Deserts',
  blurb: 'A sand sea built entirely by wind: transverse ridges, slipping lee faces, wind ripples and damp interdune flats.',
  tags: ['Aeolian', 'Sand', 'Arid'],
  build: () =>
    base({
      name: 'Desert dunes',
      seed: 44902,
      extent: 4200,
      heightScale: 300,
      seaLevel: 0.005,
      render: {
        sunAzimuth: 95,
        sunElevation: 30,
        shading: 1,
        ambient: 0.45,
        occlusion: 0.3,
        water: false,
        waterLevel: 0.005,
        waterColor: '#3a5a5a',
        fog: 0.16,
        wireframe: false,
        contour: false,
        snowline: 0.98,
        snowAmount: 0,
      },
      layers: [
        gen('dunes-l1', 'Sand sheet', 'constant', { value: 0.16 }),
        gen('dunes-l2', 'Dune train', 'dunes', {
          direction: 38,
          spacing: 30,
          height: 0.72,
          asymmetry: 1.9,
          ripples: 0.4,
          rippleScale: 95,
          meander: 0.9,
          fields: 0.82,
          seed: 31,
        }, { high: 0.68 }),
        gen('dunes-l3', 'Bedrock swell', 'perlin', { frequency: 1.3, octaves: 4, gain: 0.5, warp: 0.2, seed: 64 }, { high: 0.14 }),
        ero('dunes-l4', 'Prevailing wind', 'aeolian', {
          direction: 38,
          strength: 0.62,
          deflation: 0.5,
          saltation: 0.7,
          shelter: 0.75,
          repose: 32,
          abrasion: 0.18,
          ripples: 0.35,
          rippleScale: 26,
          iterations: 20,
        }),
        ero('dunes-l5', 'Cross wind', 'aeolian', {
          direction: 78,
          strength: 0.34,
          deflation: 0.3,
          saltation: 0.5,
          shelter: 0.6,
          repose: 31,
          abrasion: 0.1,
          ripples: 0.2,
          rippleScale: 34,
          iterations: 8,
        }),
        ero('dunes-l6', 'Slip faces', 'thermal', { angle: 31, rate: 0.42, iterations: 16 }),
      ],
      satmap: [
        sat('dunes-s1', 'Sand', 'protrusion', [
          [0, '#b08752'],
          [0.45, '#d8ae72'],
          [0.8, '#ecd39b'],
          [1, '#f7e9c6'],
        ], { detail: 0.08, detailScale: 70, slopeBlend: 0.35 }),
        sat('dunes-s2', 'Slip faces', 'slope', [
          [0, '#c99f65'],
          [1, '#8f6a3f'],
        ], { opacity: 0.8, mask: mk('slope', { min: 14, max: 60, softness: 0.12 }), detail: 0.1 }),
        sat('dunes-s3', 'Damp interdune', 'height', [
          [0, '#8e6f47'],
          [1, '#e0bd83'],
        ], { opacity: 0.7, mask: mk('height', { low: 0, high: 0.22, softness: 0.08 }), detail: 0.12 }),
        sat('dunes-s4', 'Ripple sheen', 'roughness', [
          [0, '#c8a06a'],
          [1, '#f2ddb0'],
        ], { opacity: 0.4, blend: 'softlight', detail: 0.2, detailScale: 160 }),
        sat('dunes-s5', 'Occlusion', 'cavity', [
          [0, '#1a140c'],
          [0.55, '#8b7a5e'],
          [1, '#ffffff'],
        ], { blend: 'multiply', opacity: 0.4 }),
      ],
    }),
};

const rockyDesertPreset: PresetDef = {
  id: 'rocky-desert',
  name: 'Rocky desert',
  group: 'Deserts',
  blurb: 'Mesa-and-basin country: desert pavement, varnished boulders, dry washes and sand drifting against the scrub.',
  tags: ['Aeolian', 'Fluvial', 'Arid'],
  build: () =>
    base({
      name: 'Rocky desert',
      seed: 90211,
      extent: 3600,
      heightScale: 620,
      seaLevel: 0.03,
      render: {
        sunAzimuth: 275,
        sunElevation: 36,
        shading: 1,
        ambient: 0.36,
        occlusion: 0.5,
        water: false,
        waterLevel: 0.03,
        waterColor: '#3c5a5a',
        fog: 0.18,
        wireframe: false,
        contour: false,
        snowline: 0.95,
        snowAmount: 0.2,
      },
      layers: [
        gen('rocky-l1', 'Basin floor', 'constant', { value: 0.1 }),
        gen('rocky-l2', 'Mesas', 'plateau', {
          frequency: 1.4,
          topLevel: 0.56,
          edge: 0.2,
          incision: 0.34,
          incisionScale: 5,
          steps: 2,
          roughness: 0.3,
          seed: 8,
        }, { high: 0.62 }),
        gen('rocky-l3', 'Block jointing', 'worley', { mode: 'cells', frequency: 3.2, jitter: 0.75, flatten: 0.6, seed: 22 }, { high: 0.12 }),
        gen('rocky-l4', 'Broken ground', 'multifractal', { frequency: 8, octaves: 6, offset: 1.25, seed: 39 }, { high: 0.08 }),
        ero('rocky-l5', 'Flash floods', 'fluvial', {
          erodibility: 0.07,
          areaExp: 0.45,
          slopeExp: 1.1,
          iterations: 20,
          timestep: 0.5,
          threshold: 0.04,
          deposition: 0.42,
          bankSlope: 20,
          lateral: 0.25,
        }),
        ero('rocky-l6', 'Sand drift', 'aeolian', {
          direction: 118,
          strength: 0.42,
          deflation: 0.35,
          saltation: 0.5,
          shelter: 0.62,
          repose: 30,
          abrasion: 0.14,
          ripples: 0.18,
          rippleScale: 22,
          iterations: 12,
        }, { mask: mk('slope', { min: 0, max: 30, softness: 0.12 }, { falloff: 0.6 }) }),
        ero('rocky-l7', 'Talus', 'thermal', { angle: 40, rate: 0.5, iterations: 30 }),
        ero('rocky-l8', 'Sheet wash', 'droplet', { droplets: 70, lifetime: 48, erosion: 0.7, seed: 26 }),
      ],
      satmap: [
        sat('rocky-s1', 'Desert pavement', 'protrusion', [
          [0, '#4a3a2e'],
          [0.5, '#7a6249'],
          [1, '#a98a64'],
        ], { detail: 0.16, detailScale: 110, slopeBlend: 0.3 }),
        sat('rocky-s2', 'Gravel', 'roughness', [
          [0, '#5c4a38'],
          [1, '#9d8564'],
        ], { opacity: 0.55, blend: 'overlay', detail: 0.2, detailScale: 150 }),
        sat('rocky-s3', 'Mesa cliffs', 'slope', [
          [0, '#7a4529'],
          [1, '#c88f5c'],
        ], { opacity: 0.85, mask: mk('slope', { min: 30, max: 88, softness: 0.13 }), detail: 0.14 }),
        sat('rocky-s4', 'Dry washes', 'rivers', [
          [0, '#8c7350'],
          [1, '#d3bb8e'],
        ], { opacity: 0.85, mask: mk('river', { threshold: 0.45, width: 0.26, softness: 0.75 }), detail: 0.12 }),
        sat('rocky-s5', 'Drift sand', 'sediment', [
          [0, '#9b7c4e'],
          [1, '#e0c391'],
        ], { opacity: 0.8, mask: mk('sediment', { threshold: 0.05, softness: 0.25 }), detail: 0.14 }),
        sat('rocky-s6', 'Scrub', 'wetness', [
          [0, '#4b4a2f'],
          [1, '#76734a'],
        ], { opacity: 0.35, mask: mk('wetness', { threshold: 0.62, softness: 0.22 }) }),
        sat('rocky-s7', 'Occlusion', 'cavity', [
          [0, '#120e0a'],
          [0.55, '#7e6f5c'],
          [1, '#ffffff'],
        ], { blend: 'multiply', opacity: 0.6 }),
      ],
    }),
};

export const PRESETS: PresetDef[] = [
  canyonPreset,
  sandstoneCliffsPreset,
  coastalCliffsPreset,
  himalayaPreset,
  icelandPreset,
  alpsPreset,
  snowyPreset,
  outcropsPreset,
  dunesPreset,
  rockyDesertPreset,
];

export const PRESET_MAP: Record<string, PresetDef> = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

export function buildPreset(id: string): Project {
  const preset = PRESET_MAP[id] ?? PRESETS[0];
  const project = preset.build();
  // Stable ids per instance so two copies never collide in the cache.
  const stamp = newId('p').slice(2);
  return {
    ...project,
    name: preset.name,
    layers: project.layers.map((l) => ({ ...l, id: `${l.id}-${stamp}` })) as HeightLayer[],
    satmap: project.satmap.map((l) => ({ ...l, id: `${l.id}-${stamp}` })),
  };
}

export const DEFAULT_PRESET = 'canyons';
