// Landscape presets — complete layer-stack documents.
import { layerDefaults, layerKinds, generatorKinds, filterKinds } from './heightfield.js';
import { satLayerDefaults } from './satmap.js';

function L(kind, name, params = {}, opts = {}) {
  const base = layerDefaults(kind);
  base.name = name;
  base.params = { ...base.params, ...params };
  if (opts.blend) base.blend = opts.blend;
  if (opts.opacity !== undefined) base.opacity = opts.opacity;
  if (opts.mask) base.mask = opts.mask;
  return base;
}

function S(name, source, colorA, colorB, opts = {}) {
  const l = satLayerDefaults();
  l.name = name;
  l.source = source;
  l.colorA = colorA;
  l.colorB = colorB;
  Object.assign(l, {
    ramp: { ...l.ramp, ...(opts.ramp || {}) },
    detail: { ...l.detail, ...(opts.detail || {}) },
    pattern: { ...l.pattern, ...(opts.pattern || {}) },
    opacity: opts.opacity ?? l.opacity,
    blend: opts.blend || l.blend,
    mask: opts.mask || l.mask,
  });
  return l;
}

export const presets = [
  {
    id: 'sandstone-canyons',
    name: 'Sandstone Canyons',
    blurb: 'Incised sandstone gorges · stacked benches and desert varnish',
    colors: ['#c98f5c', '#8b5a3c'],
    water: { level: 0.14, tint: '#4a7a76' },
    sun: { azimuth: 128, elevation: 42 },
    layers: [
      L('plane', 'Base shape', { level: 0.24 }, { blend: 'replace', opacity: 1 }),
      L('warped', 'Mesas & benches', { scale: 1.35, amplitude: 0.42, warp: 0.85, octaves: 5, seed: 142 }, { blend: 'add', opacity: 1 }),
      L('strata', 'Strata stacks', { scale: 2.6, amplitude: 0.16, sharpness: 0.72, warp: 0.3, angle: 24, seed: 143 }, { blend: 'add', opacity: 0.85 }),
      L('terrace', 'Canyon benches', { steps: 9, sharpness: 0.55 }, { blend: 'replace', opacity: 0.7 }),
      L('thermal', 'Rockfall weathering', { talus: 0.78, iterations: 26, rate: 0.35 }, { opacity: 1 }),
      L('river', 'Gorge incision', { power: 1.55, depth: 0.34, bankSoftness: 0.3, threshold: 0.05, tributary: 0.5 }, {
        opacity: 1,
        mask: { type: 'flow', params: { threshold: 0.04, falloff: 0.4, wetBias: 0.2 } },
      }),
      L('hydraulic', 'Runoff carving', {
        droplets: 26000, lifetime: 48, inertia: 0.05, capacity: 3.4, deposition: 0.24,
        erosion: 0.4, evaporation: 0.02, gravity: 5.5, minSlope: 0.012, radius: 3, seed: 21,
      }, { opacity: 1 }),
    ],
    satLayers: [
      S('Sandstone mass', 'height', '#6e4630', '#e0b07c', { ramp: { lo: 0.25, hi: 0.85, softness: 0.25 }, detail: { amount: 0.3, scale: 7, seed: 4 }, opacity: 1 }),
      S('Strata banding', 'height', '#5c3b2c', '#e8c088', {
        ramp: { lo: 0.35, hi: 0.6, softness: 0.06 }, detail: { amount: 0.18, scale: 12, seed: 8 },
        pattern: { kind: 'fbm', amount: 0.38, scale: 2.1, seed: 12 }, opacity: 0.42, blend: 'overlay',
        mask: { type: 'strata', params: { frequency: 3.0, warp: 0.55, sharpness: 0.55, angle: 24 } },
      }),
      S('Desert varnish', 'protrusion', '#3f2d22', '#7c5338', {
        ramp: { lo: 0.3, hi: 0.85, softness: 0.3 }, detail: { amount: 0.35, scale: 10, seed: 15 }, opacity: 0.35, blend: 'multiply',
      }),
      S('Canyon floor sediment', 'sediment', '#7c5c3d', '#c9a678', {
        ramp: { lo: 0.25, hi: 0.8, softness: 0.3 }, opacity: 0.6,
        mask: { type: 'flow', params: { threshold: 0.1, falloff: 0.45, wetBias: 0.5 } },
      }),
      S('Shade pockets', 'ao', '#241610', '#6b4630', { ramp: { lo: 0.15, hi: 0.75, softness: 0.4 }, opacity: 0.4, blend: 'multiply' }),
    ],
  },
  {
    id: 'sandstone-cliffs',
    name: 'Sandstone Cliffs',
    blurb: 'Banded cliff faces and mesas · vertical walls over soft aprons',
    colors: ['#d1a06b', '#7c4c2e'],
    water: { level: 0.1, tint: '#5d7f78' },
    sun: { azimuth: 210, elevation: 36 },
    layers: [
      L('plane', 'Base shape', { level: 0.2 }, { blend: 'replace', opacity: 1 }),
      L('voronoi', 'Mesa blocks', { scale: 1.9, amplitude: 0.5, jitter: 0.72, seed: 311 }, { blend: 'add', opacity: 1 }),
      L('fbm', 'Cliff detail', { scale: 3.1, octaves: 5, persistence: 0.5, amplitude: 0.16, warp: 0.5, seed: 312 }, { blend: 'add', opacity: 0.9 }),
      L('clamp', 'Cap rock', { min: 0.16, max: 0.72, softness: 0.1 }, { blend: 'replace', opacity: 0.55 }),
      L('strata', 'Banding', { scale: 3.4, amplitude: 0.1, sharpness: 0.8, warp: 0.22, angle: 8, seed: 313 }, { blend: 'add', opacity: 0.75 }),
      L('thermal', 'Scree aprons', { talus: 0.58, iterations: 52, rate: 0.5 }, { opacity: 1 }),
      L('hydraulic', 'Cliff runoff', {
        droplets: 18000, lifetime: 36, inertia: 0.04, capacity: 2.8, deposition: 0.32,
        erosion: 0.3, evaporation: 0.026, gravity: 5.2, minSlope: 0.014, radius: 2, seed: 33,
      }, { opacity: 0.85 }),
    ],
    satLayers: [
      S('Warm cliff rock', 'height', '#8a5a38', '#e2b184', { ramp: { lo: 0.3, hi: 0.9, softness: 0.22 }, detail: { amount: 0.26, scale: 8, seed: 21 }, opacity: 1 }),
      S('Vertical faces', 'slope', '#5c3620', '#c98d5c', {
        ramp: { lo: 0.35, hi: 0.8, softness: 0.2 }, opacity: 0.8, blend: 'overlay',
        mask: { type: 'cliff', params: { threshold: 0.42, sharpness: 2.4, ledgeBias: 0.25 } },
      }),
      S('Band striping', 'height', '#6b4128', '#efc997', {
        ramp: { lo: 0.4, hi: 0.55, softness: 0.015 }, opacity: 0.55, blend: 'overlay',
        mask: { type: 'strata', params: { frequency: 5.5, warp: 0.2, sharpness: 0.85, angle: 8 } },
      }),
      S('Apron scree', 'sediment', '#7d5738', '#b98d64', {
        ramp: { lo: 0.3, hi: 0.85, softness: 0.3 }, opacity: 0.75,
        mask: { type: 'slope', params: { lo: 0.08, hi: 0.45, softness: 0.18 } },
      }),
    ],
  },
  {
    id: 'coastal-cliffs',
    name: 'Coastal Cliffs',
    blurb: 'Headlands falling into the sea · surf-cut faces and green tops',
    colors: ['#5d8c6e', '#3b5d6e'],
    water: { level: 0.3, tint: '#39627c' },
    sun: { azimuth: 305, elevation: 34 },
    layers: [
      L('plane', 'Base shape', { level: 0.22 }, { blend: 'replace', opacity: 1 }),
      L('fbm', 'Coastal hills', { scale: 1.6, octaves: 5, persistence: 0.5, amplitude: 0.34, warp: 0.55, seed: 411 }, { blend: 'add', opacity: 1 }),
      L('ridged', 'Headland spines', { scale: 2.4, octaves: 5, amplitude: 0.2, sharpness: 0.75, seed: 412 }, {
        blend: 'add', opacity: 0.8,
        mask: { type: 'mountain', params: { start: 0.42, falloff: 0.3, smoothing: 0.5 } },
      }),
      L('hydraulic', 'Rainwash', {
        droplets: 30000, lifetime: 44, inertia: 0.05, capacity: 3.2, deposition: 0.3,
        erosion: 0.36, evaporation: 0.022, gravity: 5.6, minSlope: 0.012, radius: 3, seed: 44,
      }, { opacity: 1 }),
      L('thermal', 'Coastal slumping', { talus: 0.55, iterations: 34, rate: 0.45 }, { opacity: 0.9 }),
      L('river', 'Stream beds', { power: 1.25, depth: 0.22, bankSoftness: 0.45, threshold: 0.09, tributary: 0.6 }, { opacity: 0.9 }),
      L('smooth', 'Wave-cut smoothing', { radius: 2, strength: 0.5 }, {
        blend: 'replace', opacity: 0.75,
        mask: { type: 'coastal', params: { seaLevel: 0.3, falloff: 0.16, coastNoise: 0.6, coastScale: 1.8 } },
      }),
    ],
    satLayers: [
      S('Pasture tops', 'height', '#4c6b3c', '#8fae62', {
        ramp: { lo: 0.45, hi: 0.95, softness: 0.25 }, detail: { amount: 0.3, scale: 9, seed: 31 }, opacity: 0.95,
      }),
      S('Cliff faces', 'slope', '#5b5348', '#9b8d76', {
        ramp: { lo: 0.35, hi: 0.85, softness: 0.22 }, opacity: 0.9, blend: 'overlay',
        mask: { type: 'cliff', params: { threshold: 0.4, sharpness: 2.6, ledgeBias: 0.2 } },
      }),
      S('Beach & shallows', 'height', '#b7a67c', '#d8c9a0', {
        ramp: { lo: 0.18, hi: 0.36, softness: 0.12 }, opacity: 0.95,
        mask: { type: 'coastal', params: { seaLevel: 0.32, falloff: 0.14, coastNoise: 0.5, coastScale: 2.2 } },
      }),
      S('River staining', 'flow', '#3e4c34', '#7c8a62', {
        ramp: { lo: 0.18, hi: 0.75, softness: 0.3 }, opacity: 0.45, blend: 'multiply',
      }),
      S('Wet dark rock', 'wetness', '#2c3230', '#5d665c', { ramp: { lo: 0.35, hi: 0.9, softness: 0.3 }, opacity: 0.3, blend: 'multiply' }),
    ],
  },
  {
    id: 'himalayan',
    name: 'Himalayan',
    blurb: 'High massifs and arêtes · glacial valleys with deep moraine',
    colors: ['#9aa4b8', '#4b4e5c'],
    water: { level: 0.12, tint: '#4d6e86' },
    sun: { azimuth: 150, elevation: 38 },
    layers: [
      L('plane', 'Base shape', { level: 0.12 }, { blend: 'replace', opacity: 1 }),
      L('mountain', 'Great massif', { scale: 1.15, octaves: 6, persistence: 0.5, amplitude: 0.78, gain: 0.52, seed: 511 }, { blend: 'add', opacity: 1 }),
      L('ridged', 'Arêtes & spines', { scale: 2.8, octaves: 6, persistence: 0.52, amplitude: 0.32, sharpness: 0.8, seed: 512 }, {
        blend: 'max', opacity: 0.75,
        mask: { type: 'mountain', params: { start: 0.4, falloff: 0.35, smoothing: 0.35 } },
      }),
      L('thermal', 'Scree & talus', { talus: 0.5, iterations: 60, rate: 0.5 }, { opacity: 1 }),
      L('hydraulic', 'Glacial runoff', {
        droplets: 38000, lifetime: 52, inertia: 0.055, capacity: 3.8, deposition: 0.22,
        erosion: 0.42, evaporation: 0.018, gravity: 6.2, minSlope: 0.01, radius: 3, seed: 55,
      }, { opacity: 1 }),
      L('river', 'Valley floors', { power: 1.5, depth: 0.3, bankSoftness: 0.4, threshold: 0.07, tributary: 0.55 }, { opacity: 0.95 }),
      L('smooth', 'Glacial polish', { radius: 1, strength: 0.32 }, {
        opacity: 0.6,
        mask: { type: 'altitude', params: { lo: 0.1, hi: 0.45, softness: 0.18 } },
      }),
    ],
    satLayers: [
      S('Granite mass', 'height', '#4c4e56', '#8d8f96', { ramp: { lo: 0.35, hi: 0.95, softness: 0.3 }, detail: { amount: 0.28, scale: 9, seed: 41 }, opacity: 1 }),
      S('Snow & ice', 'height', '#c8d2e2', '#f2f5fa', {
        ramp: { lo: 0.48, hi: 0.88, softness: 0.18 }, opacity: 0.98,
        mask: { type: 'mountain', params: { start: 0.44, falloff: 0.34, smoothing: 0.5 } },
      }),
      S('Exposed ribs', 'protrusion', '#3c3d44', '#7e8088', {
        ramp: { lo: 0.35, hi: 0.85, softness: 0.25 }, opacity: 0.8, blend: 'overlay',
        mask: { type: 'slope', params: { lo: 0.3, hi: 0.95, softness: 0.2 } },
      }),
      S('Moraine & fans', 'sediment', '#5a5248', '#95887a', {
        ramp: { lo: 0.25, hi: 0.8, softness: 0.3 }, opacity: 0.8,
        mask: { type: 'altitude', params: { lo: 0.05, hi: 0.5, softness: 0.2 } },
      }),
      S('Valley shade', 'ao', '#1c2026', '#565e6c', { ramp: { lo: 0.15, hi: 0.8, softness: 0.4 }, opacity: 0.55, blend: 'multiply' }),
    ],
  },
  {
    id: 'icelandic',
    name: 'Icelandic',
    blurb: 'Basalt ridges and moss fields · black sand and braided outwash',
    colors: ['#5c6b52', '#2e3438'],
    water: { level: 0.18, tint: '#3f5a66' },
    sun: { azimuth: 232, elevation: 24 },
    layers: [
      L('plane', 'Base shape', { level: 0.18 }, { blend: 'replace', opacity: 1 }),
      L('ridged', 'Basalt ridges', { scale: 2.2, octaves: 5, persistence: 0.48, amplitude: 0.3, sharpness: 0.72, seed: 611 }, { blend: 'add', opacity: 1 }),
      L('fbm', 'Lava field', { scale: 3.4, octaves: 5, amplitude: 0.12, warp: 0.7, seed: 612 }, { blend: 'add', opacity: 0.85 }),
      L('thermal', 'Block talus', { talus: 0.7, iterations: 34, rate: 0.4 }, { opacity: 1 }),
      L('hydraulic', 'Meltwater', {
        droplets: 32000, lifetime: 46, inertia: 0.06, capacity: 3.0, deposition: 0.34,
        erosion: 0.32, evaporation: 0.024, gravity: 5.4, minSlope: 0.01, radius: 3, seed: 66,
      }, { opacity: 1 }),
      L('river', 'Braided outwash', { power: 1.2, depth: 0.16, bankSoftness: 0.6, threshold: 0.1, tributary: 0.7 }, {
        opacity: 0.85,
        mask: { type: 'coastal', params: { seaLevel: 0.34, falloff: 0.3, coastNoise: 0.45, coastScale: 1.4 } },
      }),
    ],
    satLayers: [
      S('Dark basalt', 'height', '#22262a', '#4c5257', { ramp: { lo: 0.25, hi: 0.9, softness: 0.3 }, detail: { amount: 0.32, scale: 8, seed: 51 }, opacity: 1 }),
      S('Moss fields', 'sediment', '#3f4d32', '#6d7f4a', {
        ramp: { lo: 0.3, hi: 0.85, softness: 0.35 }, opacity: 0.85,
        mask: { type: 'slope', params: { lo: 0, hi: 0.5, softness: 0.2 } },
      }),
      S('Black sand flats', 'flow', '#2a2b2c', '#575552', {
        ramp: { lo: 0.15, hi: 0.7, softness: 0.3 }, opacity: 0.8,
        mask: { type: 'altitude', params: { lo: 0.05, hi: 0.42, softness: 0.16 } },
      }),
      S('Snow dusting', 'height', '#b8c0c6', '#e8edf0', {
        ramp: { lo: 0.72, hi: 1, softness: 0.2 }, opacity: 0.65,
        mask: { type: 'mountain', params: { start: 0.7, falloff: 0.22, smoothing: 0.4 } },
      }),
    ],
  },
  {
    id: 'alps',
    name: 'Alps',
    blurb: 'Classic alpine relief · meadows, rock bands and snowfields',
    colors: ['#7fa06b', '#6d7484'],
    water: { level: 0.16, tint: '#41708a' },
    sun: { azimuth: 170, elevation: 41 },
    layers: [
      L('plane', 'Base shape', { level: 0.16 }, { blend: 'replace', opacity: 1 }),
      L('mountain', 'Alpine massif', { scale: 1.05, octaves: 6, amplitude: 0.72, gain: 0.46, seed: 711 }, { blend: 'add', opacity: 1 }),
      L('billow', 'Foothill swells', { scale: 2.4, octaves: 4, amplitude: 0.16, seed: 712 }, {
        blend: 'add', opacity: 0.85,
        mask: { type: 'altitude', params: { lo: 0.08, hi: 0.55, softness: 0.22 } },
      }),
      L('thermal', 'Talus slopes', { talus: 0.56, iterations: 44, rate: 0.45 }, { opacity: 1 }),
      L('hydraulic', 'Alpine runoff', {
        droplets: 34000, lifetime: 50, inertia: 0.05, capacity: 3.5, deposition: 0.26,
        erosion: 0.38, evaporation: 0.02, gravity: 5.8, minSlope: 0.011, radius: 3, seed: 77,
      }, { opacity: 1 }),
      L('river', 'Valley carving', { power: 1.4, depth: 0.26, bankSoftness: 0.42, threshold: 0.08, tributary: 0.5 }, { opacity: 0.95 }),
      L('smooth', 'Meadow softening', { radius: 2, strength: 0.4 }, {
        opacity: 0.55,
        mask: { type: 'altitude', params: { lo: 0.05, hi: 0.4, softness: 0.15 } },
      }),
    ],
    satLayers: [
      S('Meadows', 'height', '#4d6b34', '#87a356', {
        ramp: { lo: 0.12, hi: 0.42, softness: 0.16 }, detail: { amount: 0.28, scale: 8, seed: 61 }, opacity: 0.95,
      }),
      S('Rock bands', 'slope', '#5b5348', '#8f8574', {
        ramp: { lo: 0.32, hi: 0.85, softness: 0.22 }, opacity: 0.9, blend: 'overlay',
        mask: { type: 'mountain', params: { start: 0.4, falloff: 0.3, smoothing: 0.4 } },
      }),
      S('Snowfields', 'height', '#c5cede', '#f4f6fa', {
        ramp: { lo: 0.5, hi: 0.9, softness: 0.18 }, opacity: 0.95,
        mask: { type: 'mountain', params: { start: 0.46, falloff: 0.32, smoothing: 0.45 } },
      }),
      S('Alluvial valley floors', 'sediment', '#6c6046', '#a89878', {
        ramp: { lo: 0.3, hi: 0.85, softness: 0.3 }, opacity: 0.8,
        mask: { type: 'flow', params: { threshold: 0.12, falloff: 0.5, wetBias: 0.4 } },
      }),
    ],
  },
  {
    id: 'snowy-mountains',
    name: 'Snowy Mountains',
    blurb: 'Deep winter pack · wind-scoured ridges and buried valleys',
    colors: ['#cfd8e4', '#5c6a80'],
    water: { level: 0.12, tint: '#54748e' },
    sun: { azimuth: 138, elevation: 28 },
    layers: [
      L('plane', 'Base shape', { level: 0.12 }, { blend: 'replace', opacity: 1 }),
      L('mountain', 'Range backbone', { scale: 1.2, octaves: 6, amplitude: 0.75, gain: 0.5, seed: 811 }, { blend: 'add', opacity: 1 }),
      L('ridged', 'Wind-scoured crests', { scale: 3.2, octaves: 6, amplitude: 0.28, sharpness: 0.85, seed: 812 }, {
        blend: 'max', opacity: 0.7,
        mask: { type: 'mountain', params: { start: 0.5, falloff: 0.3, smoothing: 0.3 } },
      }),
      L('fbm', 'Drift detail', { scale: 4, octaves: 4, amplitude: 0.08, warp: 0.4, seed: 813 }, { blend: 'add', opacity: 0.6 }),
      L('thermal', 'Snow slough', { talus: 0.48, iterations: 30, rate: 0.3 }, { opacity: 0.8 }),
      L('hydraulic', 'Spring melt', {
        droplets: 24000, lifetime: 44, inertia: 0.05, capacity: 3.0, deposition: 0.3,
        erosion: 0.3, evaporation: 0.024, gravity: 5.6, minSlope: 0.012, radius: 3, seed: 88,
      }, { opacity: 0.9 }),
    ],
    satLayers: [
      S('Deep snow', 'height', '#c3ccda', '#f6f8fb', { ramp: { lo: 0.3, hi: 1, softness: 0.25 }, detail: { amount: 0.16, scale: 6, seed: 71 }, opacity: 1 }),
      S('Rock outcrops', 'protrusion', '#3a3f48', '#6d7480', {
        ramp: { lo: 0.55, hi: 0.95, softness: 0.2 }, opacity: 0.85, blend: 'multiply',
        mask: { type: 'slope', params: { lo: 0.45, hi: 1, softness: 0.2 } },
      }),
      S('Blue ice shade', 'ao', '#7d90ad', '#c8d4e6', { ramp: { lo: 0.1, hi: 0.7, softness: 0.4 }, opacity: 0.55, blend: 'overlay' }),
      S('Tree line dark', 'height', '#2e3a2c', '#5b6a4c', {
        ramp: { lo: 0.08, hi: 0.3, softness: 0.12 }, opacity: 0.7,
        mask: { type: 'altitude', params: { lo: 0.05, hi: 0.34, softness: 0.1 } },
      }),
    ],
  },
  {
    id: 'rugged-outcrops',
    name: 'Rugged Outcrops',
    blurb: 'Broken rocky terrain · knuckles, tors and shallow debris',
    colors: ['#8d8478', '#4c4740'],
    water: { level: 0.1, tint: '#4c6670' },
    sun: { azimuth: 220, elevation: 32 },
    layers: [
      L('plane', 'Base shape', { level: 0.16 }, { blend: 'replace', opacity: 1 }),
      L('voronoi', 'Tors & knuckles', { scale: 2.8, amplitude: 0.34, jitter: 0.95, seed: 911 }, { blend: 'add', opacity: 1 }),
      L('billow', 'Broken ground', { scale: 3.8, octaves: 5, amplitude: 0.18, seed: 912 }, { blend: 'add', opacity: 0.9 }),
      L('ridged', 'Rock ribs', { scale: 3.6, octaves: 5, amplitude: 0.14, sharpness: 0.85, seed: 913 }, {
        blend: 'add', opacity: 0.75,
        mask: { type: 'noise', params: { scale: 2.2, octaves: 3, threshold: 0.42, softness: 0.3, seed: 19 } },
      }),
      L('thermal', 'Debris creep', { talus: 0.52, iterations: 48, rate: 0.5 }, { opacity: 1 }),
      L('hydraulic', 'Storm runoff', {
        droplets: 22000, lifetime: 38, inertia: 0.04, capacity: 2.6, deposition: 0.36,
        erosion: 0.28, evaporation: 0.03, gravity: 5.2, minSlope: 0.014, radius: 2, seed: 99,
      }, { opacity: 0.85 }),
    ],
    satLayers: [
      S('Weathered rock', 'height', '#5c5348', '#a89a86', { ramp: { lo: 0.3, hi: 0.9, softness: 0.28 }, detail: { amount: 0.34, scale: 10, seed: 81 }, opacity: 1 }),
      S('Exposed knuckles', 'protrusion', '#2f2b26', '#7a7060', {
        ramp: { lo: 0.45, hi: 0.95, softness: 0.2 }, opacity: 0.55, blend: 'overlay',
      }),
      S('Debris & lichen', 'sediment', '#4a4e3c', '#7d8260', {
        ramp: { lo: 0.35, hi: 0.9, softness: 0.35 }, opacity: 0.45,
        mask: { type: 'slope', params: { lo: 0, hi: 0.55, softness: 0.22 } },
      }),
      S('Crevice shadow', 'ao', '#17161a', '#4c4740', { ramp: { lo: 0.1, hi: 0.7, softness: 0.4 }, opacity: 0.35, blend: 'multiply' }),
    ],
  },
  {
    id: 'desert-dunes',
    name: 'Desert Dunes',
    blurb: 'Windward dune seas · barchan trains and interdune flats',
    colors: ['#d9b078', '#8a6238'],
    water: { level: 0.04, tint: '#5b7d7a' },
    sun: { azimuth: 245, elevation: 46 },
    layers: [
      L('plane', 'Base shape', { level: 0.2 }, { blend: 'replace', opacity: 1 }),
      L('dunes', 'Dune sea', { scale: 2.2, amplitude: 0.3, angle: 38, braid: 0.68, seed: 1011 }, { blend: 'add', opacity: 1 }),
      L('dunes', 'Secondary trains', { scale: 5.2, amplitude: 0.12, angle: 84, braid: 0.85, seed: 1012 }, { blend: 'add', opacity: 0.7 }),
      L('fbm', 'Sand relief', { scale: 2, octaves: 4, amplitude: 0.1, warp: 0.5, seed: 1013 }, { blend: 'add', opacity: 0.7 }),
      L('wind', 'Aeolian drift', { strength: 0.55, direction: 38, abrasion: 0.4, deposition: 0.65, duneScale: 3.2, iterations: 22, seed: 111 }, { opacity: 1 }),
      L('smooth', 'Slipface polish', { radius: 2, strength: 0.45 }, { opacity: 0.5 }),
    ],
    satLayers: [
      S('Sunlit sand', 'height', '#a97f4c', '#e8c790', { ramp: { lo: 0.3, hi: 0.9, softness: 0.3 }, detail: { amount: 0.22, scale: 9, seed: 91 }, opacity: 1 }),
      S('Windward faces', 'aspect', '#8a663c', '#e0bc82', {
        ramp: { lo: 0.35, hi: 0.8, softness: 0.25 }, opacity: 0.55, blend: 'overlay',
      }),
      S('Dark streaks', 'protrusion', '#6b4c2c', '#b48c58', {
        ramp: { lo: 0.55, hi: 0.95, softness: 0.3 }, opacity: 0.45, blend: 'multiply',
      }),
      S('Grain texture', 'noise', '#b08a58', '#d9b986', {
        ramp: { lo: 0.35, hi: 0.75, softness: 0.35 }, detail: { amount: 0.4, scale: 16, seed: 93 },
        pattern: { kind: 'ridged', amount: 0.3, scale: 6, seed: 94 }, opacity: 0.4, blend: 'overlay',
      }),
    ],
  },
  {
    id: 'rocky-desert',
    name: 'Rocky Desert',
    blurb: 'Desert pavement and inselbergs · alluvial fans after rare rain',
    colors: ['#b08a5e', '#5e4a36'],
    water: { level: 0.07, tint: '#57716c' },
    sun: { azimuth: 195, elevation: 44 },
    layers: [
      L('plane', 'Base shape', { level: 0.18 }, { blend: 'replace', opacity: 1 }),
      L('fbm', 'Pavement relief', { scale: 1.8, octaves: 5, amplitude: 0.22, warp: 0.4, seed: 1111 }, { blend: 'add', opacity: 1 }),
      L('voronoi', 'Inselbergs', { scale: 1.6, amplitude: 0.32, jitter: 0.65, seed: 1112 }, {
        blend: 'max', opacity: 0.8,
        mask: { type: 'noise', params: { scale: 1.6, octaves: 3, threshold: 0.5, softness: 0.22, seed: 23 } },
      }),
      L('strata', 'Eroded bedding', { scale: 2.8, amplitude: 0.08, sharpness: 0.7, warp: 0.3, angle: 42, seed: 1113 }, { blend: 'add', opacity: 0.6 }),
      L('thermal', 'Desert varnish slopes', { talus: 0.6, iterations: 36, rate: 0.4 }, { opacity: 1 }),
      L('hydraulic', 'Flash floods', {
        droplets: 20000, lifetime: 40, inertia: 0.05, capacity: 3.6, deposition: 0.42,
        erosion: 0.3, evaporation: 0.035, gravity: 5.4, minSlope: 0.012, radius: 3, seed: 122,
      }, { opacity: 0.9 }),
      L('river', 'Wadi network', { power: 1.3, depth: 0.18, bankSoftness: 0.5, threshold: 0.08, tributary: 0.65 }, { opacity: 0.8 }),
    ],
    satLayers: [
      S('Desert pavement', 'height', '#6c5238', '#c2a06e', { ramp: { lo: 0.25, hi: 0.9, softness: 0.3 }, detail: { amount: 0.3, scale: 8, seed: 101 }, opacity: 1 }),
      S('Rock varnish', 'protrusion', '#3a2c20', '#6e563c', {
        ramp: { lo: 0.45, hi: 0.95, softness: 0.25 }, opacity: 0.75, blend: 'multiply',
      }),
      S('Alluvial fans', 'sediment', '#7c6244', '#c8ae84', {
        ramp: { lo: 0.3, hi: 0.9, softness: 0.35 }, opacity: 0.85,
        mask: { type: 'flow', params: { threshold: 0.08, falloff: 0.55, wetBias: 0.45 } },
      }),
      S('Sun-warmed faces', 'aspect', '#8a6a46', '#d0b084', { ramp: { lo: 0.4, hi: 0.85, softness: 0.3 }, opacity: 0.5, blend: 'overlay' }),
    ],
  },
];

export function makeDocument(preset, overrides = {}) {
  return {
    preset: preset.id,
    name: preset.name,
    blurb: preset.blurb,
    resolution: overrides.resolution || 320,
    layers: preset.layers.map((l) => ({ ...l, params: { ...l.params }, mask: JSON.parse(JSON.stringify(l.mask || { type: 'none', params: {} })) })),
    satLayers: preset.satLayers.map((l) => ({ ...l, ramp: { ...l.ramp }, detail: { ...l.detail }, pattern: { ...l.pattern }, mask: JSON.parse(JSON.stringify(l.mask || { type: 'none', params: {} })) })),
    water: { ...preset.water },
    sun: { ...preset.sun },
    camera: { yaw: 0.62, pitch: 0.42, dist: 2.55 },
  };
}
