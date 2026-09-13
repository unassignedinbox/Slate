// Resolution tiers (GTX-first) + curated project presets (layer stacks + eroder tuning).
import { makeLayer } from './sdf.js';
import { HYDRO_DEFAULTS } from './erode-hydraulic.js';
import { THERMAL_DEFAULTS } from './erode-thermal.js';
import { WIND_DEFAULTS } from './erode-wind.js';
import { RIVER_DEFAULTS } from './erode-river.js';

export const RESOLUTIONS = [
  { n: 64, label: '64 · iGPU / GT 1030', mem: '~2 MB' },
  { n: 96, label: '96 · GTX 1050', mem: '~7 MB' },
  { n: 128, label: '128 · GTX 1060 ★', mem: '~17 MB' },
  { n: 160, label: '160 · GTX 1070', mem: '~33 MB' },
  { n: 192, label: '192 · GTX 1080', mem: '~57 MB' },
  { n: 256, label: '256 · RTX (slow)', mem: '~134 MB' },
];

export const WORLD_SIZE = 120; // meters across; volume is N x N/2 x N

export function defaultErosion() {
  return {
    hydro: { ...HYDRO_DEFAULTS },
    thermal: { ...THERMAL_DEFAULTS },
    wind: { ...WIND_DEFAULTS },
    river: { ...RIVER_DEFAULTS },
  };
}
export function defaultProject() {
  return {
    name: 'Untitled terrain', seed: 2026, resN: 128, size: WORLD_SIZE,
    seaLevel: 7.5, snowline: 34, warpAmp: 0, warpFreq: 0.02,
  };
}

function stack(...layers) { return layers; }

export const PRESETS = {
  canyon: {
    name: 'Canyon rivers',
    blurb: 'Slab + mesas + strata, heavy rain + rivers. The Frontier rain-erosion look, volumetric.',
    project: { seaLevel: 6.5, snowline: 40, warpAmp: 3, warpFreq: 0.02 },
    layers: () => stack(
      makeLayer('slab', 'add', { y0: 9, thick: 14, noiseAmp: 2.5, noiseFreq: 0.045, hard: 0.55 }),
      makeLayer('mesa', 'add', { x: -20, z: 6, rTop: 10, rBot: 17, height: 18, yBase: 6, terrace: 4, noiseAmp: 1.4, seed: 5, hard: 0.75 }),
      makeLayer('mesa', 'add', { x: 22, z: -10, rTop: 8, rBot: 14, height: 14, yBase: 6, terrace: 3, noiseAmp: 1.2, seed: 9, hard: 0.75 }),
      makeLayer('strata', 'add', { freq: 0.55, contrast: 0.7, hardBase: 0.55, carve: 0.9, phase: 0 }),
    ),
    erosion: () => {
      const e = defaultErosion();
      e.hydro.count = 90000; e.hydro.erodeK = 0.4; e.hydro.capacity = 5;
      e.thermal.samples = 150000;
      e.river.rivers = 8; e.river.width0 = 1.8; e.river.carveK = 0.8;
      e.wind.count = 15000;
      return e;
    },
  },
  coastal: {
    name: 'Coastal arch',
    blurb: 'Sea cliffs + rock arch + alcoves. Rain + thermal, high sea.',
    project: { seaLevel: 9.5, snowline: 44, warpAmp: 2, warpFreq: 0.025 },
    layers: () => stack(
      makeLayer('slab', 'add', { y0: 7, thick: 13, noiseAmp: 3, noiseFreq: 0.05, hard: 0.5 }),
      makeLayer('box', 'add', { x: -14, y: 16, z: -6, sx: 30, sy: 18, sz: 22, round: 3, hard: 0.7 }),
      makeLayer('torus', 'add', { x: 12, y: 11, z: 6, R: 7, r: 2.6, plane: 0, hard: 0.72 }),
      makeLayer('sphere', 'sub', { x: -14, y: 10, z: 6, r: 6, hard: 0.6 }),
      makeLayer('strata', 'add', { freq: 0.7, contrast: 0.6, hardBase: 0.55, carve: 0.7, phase: 1 }),
    ),
    erosion: () => {
      const e = defaultErosion();
      e.hydro.count = 70000;
      e.thermal.samples = 120000; e.thermal.talusDeg = 38;
      e.river.rivers = 4;
      e.wind.count = 25000; e.wind.dirDeg = 120;
      return e;
    },
  },
  caves: {
    name: 'Cave network',
    blurb: 'Mountain block threaded with cave worms. Use clip plane to inspect.',
    project: { seaLevel: 4, snowline: 40, warpAmp: 4, warpFreq: 0.018 },
    layers: () => stack(
      makeLayer('slab', 'add', { y0: 8, thick: 14, noiseAmp: 2, noiseFreq: 0.04, hard: 0.55 }),
      makeLayer('mountain', 'add', { x: 0, z: 0, radius: 42, height: 26, yBase: 5, stretch: 1.3, ridgeAmp: 5, ridgeFreq: 0.06, seed: 21, hard: 0.7 }),
      makeLayer('worms', 'sub', { count: 9, len: 110, radius: 2.6, yMin: 4, yMax: 15, wander: 0.5, seed: 42 }),
      makeLayer('worms', 'sub', { count: 5, len: 60, radius: 1.6, yMin: 10, yMax: 20, wander: 0.6, seed: 77 }),
    ),
    erosion: () => {
      const e = defaultErosion();
      e.hydro.count = 50000;
      e.thermal.samples = 80000;
      e.river.rivers = 3;
      e.wind.count = 10000;
      return e;
    },
  },
  dunes: {
    name: 'Desert dunes',
    blurb: 'Low dunes + mesas. Wind-dominated with light rain.',
    project: { seaLevel: 3, snowline: 60, warpAmp: 2, warpFreq: 0.02 },
    layers: () => stack(
      makeLayer('slab', 'add', { y0: 6, thick: 12, noiseAmp: 1.6, noiseFreq: 0.03, hard: 0.3 }),
      makeLayer('mesa', 'add', { x: -24, z: -14, rTop: 7, rBot: 12, height: 15, yBase: 5, terrace: 5, noiseAmp: 0.8, seed: 3, hard: 0.8 }),
      makeLayer('mesa', 'add', { x: 20, z: 16, rTop: 6, rBot: 10, height: 11, yBase: 5, terrace: 4, noiseAmp: 0.8, seed: 8, hard: 0.8 }),
    ),
    erosion: () => {
      const e = defaultErosion();
      e.wind.count = 120000; e.wind.abrasion = 0.7; e.wind.sand = 1.4; e.wind.speed = 7.5;
      e.hydro.count = 20000;
      e.thermal.samples = 150000; e.thermal.talusDeg = 30;
      e.river.rivers = 0;
      return e;
    },
  },
  alpine: {
    name: 'Alpine peaks',
    blurb: 'Ridged peaks + crater lake + rivers. Full erosion stack.',
    project: { seaLevel: 6, snowline: 26, warpAmp: 3, warpFreq: 0.02 },
    layers: () => stack(
      makeLayer('slab', 'add', { y0: 7, thick: 13, noiseAmp: 2, noiseFreq: 0.04, hard: 0.5 }),
      makeLayer('mountain', 'add', { x: -12, z: -8, radius: 30, height: 30, yBase: 5, stretch: 1, ridgeAmp: 8, ridgeFreq: 0.08, seed: 31, hard: 0.75 }),
      makeLayer('mountain', 'smooth', { x: 16, z: 12, radius: 24, height: 24, yBase: 5, stretch: 1.2, ridgeAmp: 7, ridgeFreq: 0.085, seed: 77, hard: 0.75 }),
      makeLayer('crater', 'sub', { x: 2, z: 20, radius: 10, depth: 6, rim: 1.5 }),
    ),
    erosion: () => {
      const e = defaultErosion();
      e.hydro.count = 80000;
      e.thermal.samples = 120000;
      e.river.rivers = 7; e.river.width0 = 1.5;
      e.wind.count = 20000; e.wind.dirDeg = 300;
      return e;
    },
  },
};
