// Height-field compositing: generator + filter layers, mask library, blends.
import { fbm, ridged, mountain, billow, voronoi, dunes, strata as strataNoise, warpedFbm, valueNoise, smoothstep } from './noise.js';

export class Heightfield {
  constructor(size, fill = 0) {
    this.size = size;
    this.data = new Float32Array(size * size);
    if (fill) this.data.fill(fill);
  }
  clone() {
    const h = new Heightfield(this.size);
    h.data.set(this.data);
    return h;
  }
  copyFrom(other) { this.data.set(other.data); return this; }
  idx(x, y) { return y * this.size + x; }
  get(x, y) { return this.data[y * this.size + x]; }
  set(x, y, v) { this.data[y * this.size + x] = v; }
  /** Bilinear sample with normalized coords [0,1]. */
  sample(u, v) {
    const s = this.size;
    const x = Math.max(0, Math.min(s - 1.001, u * (s - 1)));
    const y = Math.max(0, Math.min(s - 1.001, v * (s - 1)));
    const x0 = x | 0, y0 = y | 0;
    const fx = x - x0, fy = y - y0;
    const d = this.data;
    const a = d[y0 * s + x0], b = d[y0 * s + x0 + 1];
    const c = d[(y0 + 1) * s + x0], e = d[(y0 + 1) * s + x0 + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
  }
  minMax() {
    let mn = Infinity, mx = -Infinity;
    const d = this.data;
    for (let i = 0; i < d.length; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
    return { min: mn, max: mx };
  }
}

/* ─────────────────────────── blend modes ─────────────────────────── */

export const blendModes = {
  add:     { name: 'Add',        hint: 'Sum onto the height below' },
  max:     { name: 'Peak',       hint: 'Keep the taller surface' },
  min:     { name: 'Valley',     hint: 'Keep the lower surface' },
  replace: { name: 'Replace',    hint: 'Fade over the height below' },
  multiply:{ name: 'Multiply',   hint: 'Scale the height below' },
  screen:  { name: 'Screen',     hint: 'Soften-weighted lift' },
  subtract:{ name: 'Subtract',   hint: 'Carve downward' },
};

export function blendApply(base, top, amount, mode) {
  switch (mode) {
    case 'max': return base + (Math.max(base, top) - base) * amount;
    case 'min': return base + (Math.min(base, top) - base) * amount;
    case 'replace': return base + (top - base) * amount;
    case 'multiply': return base * (1 - amount) + base * top * 1.6 * amount;
    case 'screen': return base + (1 - (1 - base) * (1 - top * 0.65)) * amount * 0.8 - base * amount * 0.2;
    case 'subtract': return base - top * amount;
    case 'add':
    default: return base + top * amount;
  }
}

/* ─────────────────────────── mask library ────────────────────────── */

export const maskKinds = {
  none: {
    name: 'None', icon: 'Grid', description: 'Unmasked · the layer applies everywhere',
    defaults: {}, sliders: [],
  },
  coastal: {
    name: 'Coastal falloff', icon: 'Waves',
    description: 'Effect hugs the shoreline with a soft seaward falloff',
    defaults: { seaLevel: 0.30, falloff: 0.22, coastNoise: 0.55, coastScale: 1.7 },
    sliders: [
      ['seaLevel', 0.05, 0.6, 0.01, 'Sea level', ''],
      ['falloff', 0.02, 0.6, 0.01, 'Falloff width', ''],
      ['coastNoise', 0, 1, 0.01, 'Coast raggedness', ''],
      ['coastScale', 0.5, 4, 0.05, 'Coastline scale', '×'],
    ],
  },
  mountain: {
    name: 'Mountain falloff', icon: 'Mountain',
    description: 'Smooth envelope around high ground so the effect is not continuous',
    defaults: { start: 0.38, falloff: 0.30, smoothing: 0.55 },
    sliders: [
      ['start', 0.05, 0.95, 0.01, 'Start altitude', ''],
      ['falloff', 0.05, 0.8, 0.01, 'Falloff', ''],
      ['smoothing', 0, 1, 0.01, 'Smoothing', ''],
    ],
  },
  altitude: {
    name: 'Altitude band', icon: 'Activity',
    description: 'Band-pass between two elevations with soft shoulders',
    defaults: { lo: 0.25, hi: 0.75, softness: 0.15 },
    sliders: [
      ['lo', 0, 1, 0.01, 'Lower bound', ''],
      ['hi', 0, 1, 0.01, 'Upper bound', ''],
      ['softness', 0, 0.5, 0.01, 'Shoulder softness', ''],
    ],
  },
  slope: {
    name: 'Slope band', icon: 'Cliff',
    description: 'Emphasises faces within a steepness range',
    defaults: { lo: 0.25, hi: 0.9, softness: 0.2 },
    sliders: [
      ['lo', 0, 1, 0.01, 'Min slope', ''],
      ['hi', 0, 1, 0.01, 'Max slope', ''],
      ['softness', 0, 0.5, 0.01, 'Shoulder softness', ''],
    ],
  },
  strata: {
    name: 'Strata / stacks', icon: 'Strata',
    description: 'Stacked geological bands with warped edges',
    defaults: { frequency: 3.2, warp: 0.35, sharpness: 0.6, angle: 0 },
    sliders: [
      ['frequency', 0.5, 10, 0.1, 'Band frequency', '×'],
      ['warp', 0, 1, 0.01, 'Edge warp', ''],
      ['sharpness', 0, 1, 0.01, 'Band hardness', ''],
      ['angle', 0, 180, 1, 'Band angle', '°'],
    ],
  },
  rift: {
    name: 'Rifts & cracks', icon: 'Rift',
    description: 'Fracture network — valleys in the rift cores, intact between',
    defaults: { frequency: 2.4, depth: 0.7, warp: 0.6, width: 0.35 },
    sliders: [
      ['frequency', 0.5, 8, 0.1, 'Rift frequency', '×'],
      ['depth', 0, 1, 0.01, 'Rift strength', ''],
      ['warp', 0, 1, 0.01, 'Meander', ''],
      ['width', 0.05, 1, 0.01, 'Rift width', ''],
    ],
  },
  cliff: {
    name: 'Cliff faces', icon: 'Cliff',
    description: 'Isolates near-vertical faces and ledges',
    defaults: { threshold: 0.45, sharpness: 2.2, ledgeBias: 0.3 },
    sliders: [
      ['threshold', 0, 1, 0.01, 'Steepness threshold', ''],
      ['sharpness', 0.5, 5, 0.1, 'Edge hardness', '×'],
      ['ledgeBias', 0, 1, 0.01, 'Ledge bias', ''],
    ],
  },
  noise: {
    name: 'Noise pattern', icon: 'Sparkles',
    description: 'Breaks the effect up with a generator pattern',
    defaults: { scale: 2.5, octaves: 3, threshold: 0.42, softness: 0.3, seed: 7 },
    sliders: [
      ['scale', 0.3, 8, 0.05, 'Scale', '×'],
      ['octaves', 1, 6, 1, 'Octaves', ''],
      ['threshold', 0, 1, 0.01, 'Threshold', ''],
      ['softness', 0.01, 0.6, 0.01, 'Softness', ''],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  flow: {
    name: 'Rivers & flow', icon: 'Flow',
    description: 'Follows drainage lines and floodplains',
    defaults: { threshold: 0.12, falloff: 0.35, wetBias: 0.3 },
    sliders: [
      ['threshold', 0.01, 0.6, 0.01, 'Flow threshold', ''],
      ['falloff', 0.02, 0.8, 0.01, 'Bank falloff', ''],
      ['wetBias', 0, 1, 0.01, 'Wetland bias', ''],
    ],
  },
};

/** Evaluate a mask at normalized (u,v) against the terrain signals. */
export function evalMask(mask, u, v, signals) {
  const k = mask?.type || 'none';
  const m = mask?.params || {};
  const h = signals.height(u, v);
  const s = signals.slope(u, v);
  switch (k) {
    case 'coastal': {
      const coast = smoothstep(m.seaLevel - m.falloff, m.seaLevel + m.falloff, h);
      const ragged = 1 - (valueNoise(21, u, v, m.coastScale) * m.coastNoise * 0.85);
      return Math.max(0, Math.min(1, coast * ragged));
    }
    case 'mountain': {
      const env = smoothstep(m.start - m.falloff * 0.5, m.start + m.falloff, h);
      const soften = 1 - m.smoothing * 0.55 * valueNoise(33, u, v, 3.2);
      return Math.max(0, Math.min(1, env * soften));
    }
    case 'altitude': {
      const { lo, hi, softness } = m;
      return smoothstep(lo - softness, lo + softness, h) * (1 - smoothstep(hi - softness, hi + softness, h));
    }
    case 'slope': {
      const { lo, hi, softness } = m;
      return smoothstep(lo - softness, lo + softness, s) * (1 - smoothstep(hi - softness, hi + softness, s));
    }
    case 'strata': {
      // geological bands follow elevation contours with warped edges —
      // benching on slopes, solid colour across flats
      const p2 = 91;
      const n = valueNoise(p2, u, v, m.frequency * 0.55) * 0.5
        + valueNoise(p2 + 17, u, v, m.frequency * 1.6) * 0.22;
      const t = ((h + (n - 0.36) * m.warp * 0.55) * m.frequency * 2.2) % 1;
      const tt = t < 0 ? t + 1 : t;
      const band = 1 - Math.pow(Math.abs(tt * 2 - 1), 1 + m.sharpness * 2.2);
      return Math.max(0, Math.min(1, band));
    }
    case 'rift': {
      const w = warpedFbm(55, u * m.frequency, v * m.frequency, { warp: m.warp, octaves: 3 });
      const crack = 1 - Math.abs(w * 2 - 1);
      return Math.max(0, Math.min(1, smoothstep(1 - m.width, 1, crack) * m.depth));
    }
    case 'cliff': {
      const steep = smoothstep(m.threshold - 0.12, m.threshold + 0.12, s);
      const ledge = valueNoise(77, u, v, 6) * m.ledgeBias;
      return Math.max(0, Math.min(1, Math.pow(steep, m.sharpness * 0.5) * (1 - ledge * 0.5)));
    }
    case 'noise': {
      const n = fbm(m.seed || 7, u * m.scale, v * m.scale, { octaves: m.octaves | 0 });
      return smoothstep(m.threshold - m.softness, m.threshold + m.softness, n);
    }
    case 'flow': {
      const f = signals.flow(u, v);
      const wet = signals.wetness(u, v) * m.wetBias;
      return Math.max(0, Math.min(1, smoothstep(m.threshold, m.threshold + m.falloff, f) * (1 - wet * 0.35) + wet * 0.35));
    }
    default:
      return 1;
  }
}

/* ────────────────────────── generator layers ────────────────────── */

export const generatorKinds = {
  perlin: {
    name: 'Perlin noise', icon: 'Waves', color: '#8ec8c0',
    description: 'Classic gradient noise · smooth rolling base forms',
    defaults: { scale: 2.2, octaves: 4, persistence: 0.5, lacunarity: 2.0, amplitude: 0.22, seed: 11 },
    sliders: [
      ['scale', 0.2, 8, 0.05, 'Frequency', '×'],
      ['octaves', 1, 8, 1, 'Octaves', ''],
      ['persistence', 0.15, 0.8, 0.01, 'Persistence', ''],
      ['lacunarity', 1.2, 3.2, 0.05, 'Lacunarity', ''],
      ['amplitude', 0, 1, 0.01, 'Amplitude', 'm'],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  fbm: {
    name: 'Multifractal', icon: 'Ripples', color: '#a6a0d9',
    description: 'Layered fractal octaves · multifractal relief detail',
    defaults: { scale: 1.6, octaves: 6, persistence: 0.52, lacunarity: 2.05, amplitude: 0.3, seed: 23, warp: 0.35 },
    sliders: [
      ['scale', 0.2, 8, 0.05, 'Frequency', '×'],
      ['octaves', 1, 8, 1, 'Octaves', ''],
      ['persistence', 0.15, 0.8, 0.01, 'Persistence', ''],
      ['lacunarity', 1.2, 3.2, 0.05, 'Lacunarity', ''],
      ['amplitude', 0, 1, 0.01, 'Amplitude', 'm'],
      ['warp', 0, 1.5, 0.01, 'Domain warp', ''],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  ridged: {
    name: 'Ridged noise', icon: 'Rift', color: '#c29583',
    description: 'Sharp crest lines · ridged multifractal for arêtes & spines',
    defaults: { scale: 2.0, octaves: 5, persistence: 0.5, lacunarity: 2.1, amplitude: 0.34, sharpness: 0.7, seed: 37 },
    sliders: [
      ['scale', 0.2, 8, 0.05, 'Frequency', '×'],
      ['octaves', 1, 8, 1, 'Octaves', ''],
      ['persistence', 0.15, 0.8, 0.01, 'Persistence', ''],
      ['lacunarity', 1.2, 3.2, 0.05, 'Lacunarity', ''],
      ['amplitude', 0, 1, 0.01, 'Amplitude', 'm'],
      ['sharpness', 0, 1, 0.01, 'Crest sharpness', ''],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  mountain: {
    name: 'Mountain noise', icon: 'Mountain', color: '#d6a078',
    description: 'Hybrid multifractal · massifs with foothills and natural skirts',
    defaults: { scale: 1.35, octaves: 6, persistence: 0.5, lacunarity: 2.1, amplitude: 0.52, gain: 0.48, seed: 48 },
    sliders: [
      ['scale', 0.2, 6, 0.05, 'Frequency', '×'],
      ['octaves', 1, 8, 1, 'Octaves', ''],
      ['persistence', 0.15, 0.8, 0.01, 'Persistence', ''],
      ['lacunarity', 1.2, 3.2, 0.05, 'Lacunarity', ''],
      ['amplitude', 0, 1, 0.01, 'Amplitude', 'm'],
      ['gain', 0, 1, 0.01, 'Fractal gain', ''],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  billow: {
    name: 'Billow noise', icon: 'Cloud', color: '#93c779',
    description: 'Rounded puffs · rolling hills and dune-like swells',
    defaults: { scale: 2.6, octaves: 4, persistence: 0.5, lacunarity: 2.0, amplitude: 0.2, seed: 61 },
    sliders: [
      ['scale', 0.2, 8, 0.05, 'Frequency', '×'],
      ['octaves', 1, 8, 1, 'Octaves', ''],
      ['persistence', 0.15, 0.8, 0.01, 'Persistence', ''],
      ['lacunarity', 1.2, 3.2, 0.05, 'Lacunarity', ''],
      ['amplitude', 0, 1, 0.01, 'Amplitude', 'm'],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  voronoi: {
    name: 'Voronoi cells', icon: 'Boxes', color: '#b3b3d5',
    description: 'Cellular plateaus · blocky outcrops and mesa fragments',
    defaults: { scale: 2.4, amplitude: 0.22, jitter: 0.85, seed: 71 },
    sliders: [
      ['scale', 0.4, 8, 0.05, 'Cell density', '×'],
      ['amplitude', 0, 1, 0.01, 'Amplitude', 'm'],
      ['jitter', 0, 1, 0.01, 'Cell jitter', ''],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  dunes: {
    name: 'Dune field', icon: 'Dunes', color: '#e0c083',
    description: 'Wind-aligned dune trains with braided crests',
    defaults: { scale: 2.1, amplitude: 0.16, angle: 42, braid: 0.5, seed: 83 },
    sliders: [
      ['scale', 0.4, 8, 0.05, 'Dune frequency', '×'],
      ['amplitude', 0, 1, 0.01, 'Amplitude', 'm'],
      ['angle', 0, 360, 1, 'Dune angle', '°'],
      ['braid', 0, 1, 0.01, 'Crest braid', ''],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  strata: {
    name: 'Strata stacks', icon: 'Strata', color: '#c8a06a',
    description: 'Layered geological benches · stacked plateau steps',
    defaults: { scale: 1.9, amplitude: 0.2, sharpness: 0.62, warp: 0.35, angle: 18, seed: 97 },
    sliders: [
      ['scale', 0.4, 8, 0.05, 'Band frequency', '×'],
      ['amplitude', 0, 1, 0.01, 'Amplitude', 'm'],
      ['sharpness', 0, 1, 0.01, 'Step hardness', ''],
      ['warp', 0, 1, 0.01, 'Edge warp', ''],
      ['angle', 0, 180, 1, 'Band angle', '°'],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  warped: {
    name: 'Warped ridges', icon: 'Compass', color: '#87c1ba',
    description: 'Domain-warped fractal · meandering ridge networks',
    defaults: { scale: 1.7, octaves: 5, persistence: 0.5, amplitude: 0.3, warp: 0.75, seed: 109 },
    sliders: [
      ['scale', 0.2, 6, 0.05, 'Frequency', '×'],
      ['octaves', 1, 8, 1, 'Octaves', ''],
      ['persistence', 0.15, 0.8, 0.01, 'Persistence', ''],
      ['amplitude', 0, 1, 0.01, 'Amplitude', 'm'],
      ['warp', 0, 1.5, 0.01, 'Warp', ''],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  plane: {
    name: 'Height plane', icon: 'Grid', color: '#a5b8c7',
    description: 'Constant elevation · base datum for the stack',
    defaults: { level: 0.18 },
    sliders: [
      ['level', 0, 1, 0.01, 'Base level', ''],
    ],
  },
};

/** Filter / modifier layers. */
export const filterKinds = {
  smooth: {
    name: 'Smooth', icon: 'Ripples', color: '#9cbde7',
    description: 'Box-blur relaxation · softens ridges and scars',
    defaults: { radius: 2, strength: 0.6 },
    sliders: [
      ['radius', 1, 6, 1, 'Kernel radius', 'px'],
      ['strength', 0, 1, 0.01, 'Strength', ''],
    ],
  },
  terrace: {
    name: 'Terrace', icon: 'Strata', color: '#d4b970',
    description: 'Quantises elevation into benches and steps',
    defaults: { steps: 7, sharpness: 0.6 },
    sliders: [
      ['steps', 2, 24, 1, 'Steps', ''],
      ['sharpness', 0, 1, 0.01, 'Step hardness', ''],
    ],
  },
  clamp: {
    name: 'Clamp / plateau', icon: 'Grid', color: '#c5a6d7',
    description: 'Lifts low ground and caps peaks · mesa levelling',
    defaults: { min: 0.1, max: 0.85, softness: 0.12 },
    sliders: [
      ['min', 0, 1, 0.01, 'Floor', ''],
      ['max', 0, 1, 0.01, 'Ceiling', ''],
      ['softness', 0, 0.5, 0.01, 'Knee softness', ''],
    ],
  },
  mound: {
    name: 'Radial mound', icon: 'Gauge', color: '#e2b58a',
    description: 'Smooth dome or basin at a chosen position',
    defaults: { x: 0.5, y: 0.5, radius: 0.35, height: 0.25, falloff: 2 },
    sliders: [
      ['x', 0, 1, 0.01, 'Position X', ''],
      ['y', 0, 1, 0.01, 'Position Y', ''],
      ['radius', 0.05, 1, 0.01, 'Radius', ''],
      ['height', -1, 1, 0.01, 'Height', 'm'],
      ['falloff', 0.5, 4, 0.1, 'Falloff power', ''],
    ],
  },
};

export const layerKinds = {
  ...generatorKinds,
  hydraulic: {
    name: 'Hydraulic erosion', icon: 'Droplets', color: '#74bdd4',
    category: 'erosion',
    description: 'Droplet simulation · runoff carves channels and deposits sediment',
    defaults: {
      droplets: 28000, lifetime: 42, inertia: 0.045, capacity: 3.2, deposition: 0.28,
      erosion: 0.35, evaporation: 0.022, gravity: 5.5, minSlope: 0.012, radius: 3,
      seed: 12, sedimentFeedback: 1,
    },
    sliders: [
      ['droplets', 2000, 90000, 1000, 'Droplets', ''],
      ['lifetime', 8, 96, 1, 'Droplet lifetime', 'steps'],
      ['inertia', 0, 0.25, 0.005, 'Flow inertia', ''],
      ['capacity', 0.5, 10, 0.1, 'Sediment capacity', '×'],
      ['deposition', 0.02, 1, 0.01, 'Deposition rate', ''],
      ['erosion', 0.02, 1, 0.01, 'Erosion rate', ''],
      ['evaporation', 0.002, 0.1, 0.002, 'Evaporation', ''],
      ['gravity', 1, 12, 0.1, 'Gravity', ''],
      ['minSlope', 0, 0.08, 0.002, 'Min slope', ''],
      ['radius', 1, 6, 1, 'Brush radius', 'px'],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  thermal: {
    name: 'Thermal erosion', icon: 'Mountain', color: '#c29583',
    category: 'erosion',
    description: 'Talus slumping · loose material slides past the repose angle',
    defaults: { talus: 0.62, iterations: 42, rate: 0.42 },
    sliders: [
      ['talus', 0.15, 1.4, 0.01, 'Talus angle', ''],
      ['iterations', 4, 140, 1, 'Iterations', ''],
      ['rate', 0.05, 1, 0.01, 'Transfer rate', ''],
    ],
  },
  wind: {
    name: 'Wind erosion', icon: 'Wind', color: '#72c8b3',
    category: 'erosion',
    description: 'Aeolian abrasion and lee deposition · streaks and drifts',
    defaults: { strength: 0.45, direction: 38, abrasion: 0.55, deposition: 0.5, duneScale: 2.6, iterations: 18, seed: 27 },
    sliders: [
      ['strength', 0, 1, 0.01, 'Wind strength', ''],
      ['direction', 0, 360, 1, 'Direction', '°'],
      ['abrasion', 0, 1, 0.01, 'Abrasion', ''],
      ['deposition', 0, 1, 0.01, 'Lee deposition', ''],
      ['duneScale', 0.5, 6, 0.1, 'Dune scale', '×'],
      ['iterations', 2, 60, 1, 'Iterations', ''],
      ['seed', 1, 999, 1, 'Seed', ''],
    ],
  },
  river: {
    name: 'River incision', icon: 'Flow', color: '#82abc9',
    category: 'erosion',
    description: 'Flow-accumulation channels carve valleys with alluvial banks',
    defaults: { power: 1.35, depth: 0.35, bankSoftness: 0.35, threshold: 0.06, tributary: 0.4 },
    sliders: [
      ['power', 0.4, 3, 0.05, 'Flow power', ''],
      ['depth', 0, 1, 0.01, 'Incision depth', 'm'],
      ['bankSoftness', 0, 1, 0.01, 'Bank softness', ''],
      ['threshold', 0.01, 0.4, 0.01, 'Channel threshold', ''],
      ['tributary', 0, 1, 0.01, 'Tributary spread', ''],
    ],
  },
  ...filterKinds,
};

export function layerCategory(kind) {
  if (generatorKinds[kind]) return kind === 'plane' ? 'base' : 'generator';
  if (kind === 'smooth' || kind === 'terrace' || kind === 'clamp' || kind === 'mound') return 'filter';
  return 'erosion';
}

export function layerDefaults(kind) {
  const spec = layerKinds[kind];
  const params = { ...spec.defaults };
  return {
    id: `${kind}-${Math.random().toString(36).slice(2, 9)}`,
    kind,
    name: spec.name,
    enabled: true,
    blend: kind === 'plane' ? 'replace' : (kind === 'terrace' || kind === 'clamp' ? 'replace' : 'add'),
    opacity: kind === 'plane' ? 1 : 0.85,
    params,
    mask: { type: 'none', params: {} },
  };
}

/** Evaluate a generator layer into `out` (same size as field). */
export function evalGenerator(kind, params, field, out) {
  const s = field.size;
  for (let y = 0; y < s; y++) {
    const v = y / (s - 1);
    for (let x = 0; x < s; x++) {
      const u = x / (s - 1);
      out[y * s + x] = sampleGenerator(kind, params, u, v);
    }
  }
}

export function sampleGenerator(kind, p, u, v, h0) {
  switch (kind) {
    case 'plane': return p.level;
    case 'perlin':
      return (fbm(p.seed, u * p.scale, v * p.scale, p) - 0.5) * 2 * p.amplitude * 0.5 + 0.5;
    case 'fbm':
      return warpedFbm(p.seed, u, v, { warp: p.warp, octaves: p.octaves | 0, persistence: p.persistence, lacunarity: p.lacunarity, frequency: p.scale }) * p.amplitude + 0.5 * (1 - p.amplitude) * 0.4;
    case 'ridged':
      return ridged(p.seed, u * p.scale, v * p.scale, p) * p.amplitude * 1.2;
    case 'mountain':
      return mountain(p.seed, u * p.scale, v * p.scale, p) * p.amplitude * 1.25;
    case 'billow':
      return billow(p.seed, u * p.scale, v * p.scale, p) * p.amplitude * 1.2;
    case 'voronoi':
      return voronoi(p.seed, u, v, { jitter: p.jitter, cellScale: p.scale }) * p.amplitude * 1.3;
    case 'dunes':
      return dunes(p.seed, u, v, { frequency: p.scale, angleDeg: p.angle, braid: p.braid }) * p.amplitude * 1.2;
    case 'strata': {
      // geological benches stepped along the *underlying* elevation (h0),
      // with warped edges — benching follows the landform, not map axes
      const n = valueNoise(p.seed, u, v, p.scale * 0.55) * 0.5
        + valueNoise(p.seed + 17, u, v, p.scale * 1.6) * 0.22;
      const t0 = (((h0 ?? 0.5) + (n - 0.36) * p.warp * 0.5) * p.scale * 2.2);
      const t = t0 - Math.floor(t0);
      const band = 1 - Math.pow(Math.abs(t * 2 - 1), 1 + p.sharpness * 2.2);
      return band * p.amplitude * 1.25;
    }
    case 'warped':
      return warpedFbm(p.seed, u * p.scale, v * p.scale, { warp: p.warp, octaves: p.octaves | 0, persistence: p.persistence, frequency: 1 }) * p.amplitude * 1.2;
    default:
      return 0;
  }
}

/** Apply a filter layer in-place over `field` restricted by `mask` (0..1 per cell). */
export function applyFilter(kind, params, field, maskArr) {
  const s = field.size, d = field.data;
  if (kind === 'smooth') {
    const src = d.slice();
    const r = Math.round(params.radius);
    const inv = 1 / (2 * r + 1);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        let sum = 0, n = 0;
        for (let k = -r; k <= r; k++) {
          const xx = Math.min(s - 1, Math.max(0, x + k));
          sum += src[y * s + xx]; n++;
        }
        const tmp = sum / n * inv * (2 * r + 1);
        d[y * s + x] = src[y * s + x] + (tmp - src[y * s + x]) * params.strength;
      }
    }
    const src2 = d.slice();
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        let sum = 0, n = 0;
        for (let k = -r; k <= r; k++) {
          const yy = Math.min(s - 1, Math.max(0, y + k));
          sum += src2[yy * s + x]; n++;
        }
        const tmp = sum / n;
        d[y * s + x] = src2[y * s + x] + (tmp - src2[y * s + x]) * params.strength;
      }
    }
    return;
  }
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = y * s + x;
      const m = maskArr ? maskArr[i] : 1;
      if (m <= 0.001) continue;
      const h = d[i];
      let nh = h;
      if (kind === 'terrace') {
        const t = h * params.steps;
        const lo = Math.floor(t) / params.steps;
        const frac = t - Math.floor(t);
        const shaped = frac < params.sharpness ? 0 : (frac - params.sharpness) / (1 - params.sharpness);
        nh = lo + shaped / params.steps;
      } else if (kind === 'clamp') {
        // compress into [min,max] with soft knees — mesa / plateau levelling
        const knee = Math.max(1e-4, params.softness);
        if (h < params.min) nh = params.min - (params.min - h) * (1 - smoothstep(0, knee * 3, params.min - h));
        else if (h > params.max) nh = params.max + (h - params.max) * (1 - smoothstep(0, knee * 3, h - params.max));
        else nh = h;
      } else if (kind === 'mound') {
        const dx = u01(x, s) - params.x, dy = u01(y, s) - params.y;
        const r = Math.sqrt(dx * dx + dy * dy) / Math.max(0.02, params.radius);
        const g = Math.max(0, 1 - r * r);
        nh = h + params.height * Math.pow(g, params.falloff);
      }
      d[i] = h + (nh - h) * m;
    }
  }
}

function u01(i, s) { return i / (s - 1); }
