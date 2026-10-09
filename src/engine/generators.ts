// Height generators — the "base shape" nodes of the layer stack.
// Every generator returns a normalised field in 0..1; the owning layer's
// remap + opacity + blend decide how much of it enters the terrain.

import { PowLut } from './fastmath';
import { Noise, clamp, smoothstep } from './noise';
import { Field } from './field';
import type { OpDef, Params } from './params';
import { num, str } from './params';
import { hashSeed } from './rng';

export interface GenContext {
  size: number;
  seed: number;
  noise: Noise;
  /** Height composed by the layers below this one. */
  below: Field;
  rng: () => number;
}

export type GeneratorFn = (ctx: GenContext, p: Params) => Field;

export interface GeneratorDef extends OpDef {
  run: GeneratorFn;
}

const TAU = Math.PI * 2;

/** Canyon incision profile — a fixed exponent worth tabulating. */
const CANYON_POW = new PowLut(2.2, 1);

/** Shared seed slider, injected into every generator's parameter set. */
const seedParam = {
  kind: 'slider' as const,
  key: 'seed',
  label: 'Seed offset',
  min: 0,
  max: 999,
  step: 1,
  def: 0,
  hint: 'Shifts the noise field without touching the rest of the layer',
};

function forEachCell(size: number, fn: (u: number, v: number, i: number, x: number, y: number) => number): Field {
  const out = Field.zeros(size);
  const inv = 1 / (size - 1);
  for (let y = 0; y < size; y++) {
    const v = y * inv;
    for (let x = 0; x < size; x++) {
      out.data[y * size + x] = fn(x * inv, v, y * size + x, x, y);
    }
  }
  return out;
}

function dirVec(degrees: number): [number, number] {
  const r = (degrees * Math.PI) / 180;
  return [Math.cos(r), Math.sin(r)];
}

/* ------------------------------------------------------------------ perlin */

const perlinDef: GeneratorDef = {
  id: 'perlin',
  label: 'Perlin fractal',
  blurb: 'Classic fractal Brownian motion. The all-round base shape for rolling country.',
  params: [
    {
      kind: 'dropdown',
      key: 'kernel',
      label: 'Kernel',
      def: 'perlin',
      options: [
        { value: 'perlin', label: 'Perlin' },
        { value: 'simplex', label: 'Simplex' },
      ],
    },
    { kind: 'slider', key: 'frequency', label: 'Frequency', min: 0.3, max: 14, step: 0.1, def: 3 },
    { kind: 'slider', key: 'octaves', label: 'Octaves', min: 1, max: 12, step: 1, def: 7 },
    { kind: 'slider', key: 'lacunarity', label: 'Lacunarity', min: 1.4, max: 3.6, step: 0.05, def: 2 },
    { kind: 'slider', key: 'gain', label: 'Gain', min: 0.15, max: 0.85, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'warp', label: 'Domain warp', min: 0, max: 1.5, step: 0.01, def: 0 },
    seedParam,
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const freq = num(p, 'frequency', 3);
    const octaves = num(p, 'octaves', 7);
    const lac = num(p, 'lacunarity', 2);
    const gain = num(p, 'gain', 0.5);
    const warp = num(p, 'warp', 0);
    const kernel = str(p, 'kernel', 'perlin') === 'simplex' ? 'simplex' : 'perlin';
    const field = forEachCell(ctx.size, (u, v) => {
      const [x, y] = warp ? noise.warp(u * freq, v * freq, warp, 0.35) : [u * freq, v * freq];
      return 0.5 + 0.5 * noise.fbm(x, y, octaves, lac, gain, kernel);
    });
    return field.stretch(1, 99).clamp(0, 1);
  },
};

/* ------------------------------------------------------------ multifractal */

const multifractalDef: GeneratorDef = {
  id: 'multifractal',
  label: 'Multifractal',
  blurb: 'Musgrave multifractal — spikier than fBm, with deep basins and sharp summits.',
  params: [
    { kind: 'slider', key: 'frequency', label: 'Frequency', min: 0.3, max: 14, step: 0.1, def: 2.4 },
    { kind: 'slider', key: 'octaves', label: 'Octaves', min: 1, max: 12, step: 1, def: 8 },
    { kind: 'slider', key: 'offset', label: 'Fractal offset', min: 0.2, max: 2, step: 0.01, def: 1 },
    { kind: 'slider', key: 'lacunarity', label: 'Lacunarity', min: 1.4, max: 3.6, step: 0.05, def: 2.1 },
    { kind: 'slider', key: 'gain', label: 'Gain', min: 0.15, max: 0.9, step: 0.01, def: 0.55 },
    { kind: 'slider', key: 'warp', label: 'Domain warp', min: 0, max: 1.5, step: 0.01, def: 0.28 },
    seedParam,
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const freq = num(p, 'frequency', 2.4);
    const octaves = num(p, 'octaves', 8);
    const offset = num(p, 'offset', 1);
    const lac = num(p, 'lacunarity', 2.1);
    const gain = num(p, 'gain', 0.55);
    const warp = num(p, 'warp', 0.28);
    const field = forEachCell(ctx.size, (u, v) => {
      const [x, y] = warp ? noise.warp(u * freq, v * freq, warp, 0.35) : [u * freq, v * freq];
      return noise.multifractal(x, y, octaves, offset, gain, lac);
    });
    return field.stretch(1, 99.5).clamp(0, 1);
  },
};

/* ------------------------------------------------------------------- ridge */

const ridgeDef: GeneratorDef = {
  id: 'ridge',
  label: 'Ridge noise',
  blurb: 'Ridged multifractal. Sharp crests and serrated spur lines — alpine bedrock.',
  params: [
    { kind: 'slider', key: 'frequency', label: 'Frequency', min: 0.3, max: 14, step: 0.1, def: 2.6 },
    { kind: 'slider', key: 'octaves', label: 'Octaves', min: 1, max: 12, step: 1, def: 8 },
    { kind: 'slider', key: 'sharpness', label: 'Crest sharpness', min: 0.4, max: 4, step: 0.05, def: 2 },
    { kind: 'slider', key: 'threshold', label: 'Coupling', min: 0, max: 2, step: 0.05, def: 1 },
    { kind: 'slider', key: 'gain', label: 'Gain', min: 0.15, max: 0.9, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'lacunarity', label: 'Lacunarity', min: 1.4, max: 3.6, step: 0.05, def: 2 },
    { kind: 'slider', key: 'warp', label: 'Domain warp', min: 0, max: 1.5, step: 0.01, def: 0.35 },
    seedParam,
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const freq = num(p, 'frequency', 2.6);
    const octaves = num(p, 'octaves', 8);
    const sharp = num(p, 'sharpness', 2);
    const threshold = num(p, 'threshold', 1);
    const gain = num(p, 'gain', 0.5);
    const lac = num(p, 'lacunarity', 2);
    const warp = num(p, 'warp', 0.35);
    const field = forEachCell(ctx.size, (u, v) => {
      const [x, y] = warp ? noise.warp(u * freq, v * freq, warp, 0.35) : [u * freq, v * freq];
      return noise.ridged(x, y, octaves, sharp, lac, gain, threshold);
    });
    return field.stretch(1, 99.5).clamp(0, 1);
  },
};

/* ---------------------------------------------------------------- mountain */

const mountainDef: GeneratorDef = {
  id: 'mountain',
  label: 'Mountain noise',
  blurb: 'Uplift model: a continent mask gates ridged relief, so ranges gather into massifs instead of covering everything.',
  params: [
    { kind: 'slider', key: 'frequency', label: 'Frequency', min: 0.3, max: 10, step: 0.1, def: 2.2 },
    { kind: 'slider', key: 'octaves', label: 'Octaves', min: 1, max: 12, step: 1, def: 9 },
    { kind: 'slider', key: 'sharpness', label: 'Crest sharpness', min: 0.4, max: 4, step: 0.05, def: 2.2 },
    { kind: 'slider', key: 'uplift', label: 'Uplift exponent', min: 0.4, max: 3, step: 0.05, def: 1.35 },
    { kind: 'slider', key: 'continents', label: 'Continent scale', min: 0.3, max: 4, step: 0.05, def: 1.1 },
    { kind: 'slider', key: 'roughness', label: 'Summit roughness', min: 0, max: 1, step: 0.01, def: 0.45 },
    { kind: 'slider', key: 'warp', label: 'Domain warp', min: 0, max: 1.5, step: 0.01, def: 0.4 },
    { kind: 'slider', key: 'plains', label: 'Plains floor', min: 0, max: 0.8, step: 0.01, def: 0.12 },
    seedParam,
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const freq = num(p, 'frequency', 2.2);
    const octaves = num(p, 'octaves', 9);
    const sharp = num(p, 'sharpness', 2.2);
    const uplift = num(p, 'uplift', 1.35);
    const contScale = num(p, 'continents', 1.1);
    const rough = num(p, 'roughness', 0.45);
    const warp = num(p, 'warp', 0.4);
    const plains = num(p, 'plains', 0.12);
    // Stretch the kernels first: raw fractals cluster around their mean and
    // would leave the whole range sitting in a narrow band of heights.
    const ridgeField = forEachCell(ctx.size, (u, v) => {
      const [x, y] = warp ? noise.warp(u * freq, v * freq, warp, 0.35) : [u * freq, v * freq];
      return noise.ridged(x, y, octaves, sharp, 2.02, 0.5, 1);
    }).stretch(0.5, 99.5);
    const detailField = forEachCell(ctx.size, (u, v) => {
      const [x, y] = warp ? noise.warp(u * freq, v * freq, warp, 0.35) : [u * freq, v * freq];
      return 0.5 + 0.5 * noise.fbm(x * 3.1, y * 3.1, 5, 2.1, 0.5);
    }).stretch(1, 99);
    const continent = forEachCell(ctx.size, (u, v) =>
      0.5 + 0.5 * noise.fbm(u * contScale * 1.1, v * contScale * 1.1, 4, 2, 0.5),
    ).stretch(1, 99);
    const upliftLut = new PowLut(uplift, 1);
    const field = Field.zeros(ctx.size);
    for (let i = 0; i < field.data.length; i++) {
      const ridge = ridgeField.data[i];
      const detail = detailField.data[i];
      // Continent / massif envelope: low frequency, sharpened by the exponent
      // so ranges gather into massifs instead of covering the whole map.
      const mask = upliftLut.at(smoothstep(0.02, 0.98, continent.data[i]));
      const combined = ridge * (1 + rough * (detail * 2 - 1) * 0.5);
      field.data[i] = clamp(plains + combined * mask * (1 - plains), 0, 1);
    }
    return field.stretch(0, 99.5).clamp(0, 1);
  },
};

/* ------------------------------------------------------------------ billow */

const billowDef: GeneratorDef = {
  id: 'billow',
  label: 'Billow',
  blurb: 'Puffy, cloud-like shapes. Good for dune fields, moraine hummocks and volcanic uplands.',
  params: [
    { kind: 'slider', key: 'frequency', label: 'Frequency', min: 0.3, max: 14, step: 0.1, def: 3.2 },
    { kind: 'slider', key: 'octaves', label: 'Octaves', min: 1, max: 12, step: 1, def: 6 },
    { kind: 'slider', key: 'gain', label: 'Gain', min: 0.15, max: 0.9, step: 0.01, def: 0.55 },
    { kind: 'slider', key: 'lacunarity', label: 'Lacunarity', min: 1.4, max: 3.6, step: 0.05, def: 2.2 },
    { kind: 'slider', key: 'warp', label: 'Domain warp', min: 0, max: 1.5, step: 0.01, def: 0.2 },
    seedParam,
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const freq = num(p, 'frequency', 3.2);
    const octaves = num(p, 'octaves', 6);
    const gain = num(p, 'gain', 0.55);
    const lac = num(p, 'lacunarity', 2.2);
    const warp = num(p, 'warp', 0.2);
    const field = forEachCell(ctx.size, (u, v) => {
      const [x, y] = warp ? noise.warp(u * freq, v * freq, warp, 0.35) : [u * freq, v * freq];
      return 0.5 + 0.5 * noise.billow(x, y, octaves, lac, gain);
    });
    return field.stretch(1, 99).clamp(0, 1);
  },
};

/* ------------------------------------------------------------------ worley */

const worleyDef: GeneratorDef = {
  id: 'worley',
  label: 'Cellular (Worley)',
  blurb: 'Voronoi cells. Borders read as rift valleys or joint networks; cells read as plateaus.',
  params: [
    {
      kind: 'dropdown',
      key: 'mode',
      label: 'Cell feature',
      def: 'borders',
      options: [
        { value: 'cells', label: 'Cell bodies (F1)' },
        { value: 'borders', label: 'Cell borders (F2−F1)' },
        { value: 'distance', label: 'Cell distance (F2)' },
      ],
    },
    { kind: 'slider', key: 'frequency', label: 'Frequency', min: 1, max: 24, step: 0.1, def: 6 },
    { kind: 'slider', key: 'jitter', label: 'Cell jitter', min: 0, max: 1, step: 0.01, def: 0.8 },
    { kind: 'slider', key: 'flatten', label: 'Flatten', min: 0, max: 1, step: 0.01, def: 0 },
    { kind: 'slider', key: 'warp', label: 'Domain warp', min: 0, max: 1.5, step: 0.01, def: 0.15 },
    seedParam,
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const mode = str(p, 'mode', 'borders') === 'cells' ? 0 : str(p, 'mode', 'borders') === 'distance' ? 2 : 1;
    const freq = num(p, 'frequency', 6);
    const jitter = num(p, 'jitter', 0.8);
    const flatten = num(p, 'flatten', 0);
    const warp = num(p, 'warp', 0.15);
    const field = forEachCell(ctx.size, (u, v) => {
      const [x, y] = warp ? noise.warp(u * freq, v * freq, warp, 0.3) : [u * freq, v * freq];
      let value = 0.5 + 0.5 * noise.worley(x, y, mode, jitter);
      if (flatten > 0) {
        const steps = 8;
        const q = Math.round(value * steps) / steps;
        value = value + (q - value) * flatten;
      }
      return clamp(value, 0, 1);
    });
    return field.stretch(1, 99).clamp(0, 1);
  },
};

/* ------------------------------------------------------------------- dunes */

const dunesDef: GeneratorDef = {
  id: 'dunes',
  label: 'Dunes',
  blurb: 'Transverse dune trains with wind ripples, drifting over a noisy sand sheet.',
  params: [
    { kind: 'slider', key: 'direction', label: 'Wind direction', min: 0, max: 360, step: 1, def: 35 },
    { kind: 'slider', key: 'spacing', label: 'Dune spacing', min: 4, max: 90, step: 1, def: 26 },
    { kind: 'slider', key: 'height', label: 'Dune height', min: 0.05, max: 1, step: 0.01, def: 0.6 },
    { kind: 'slider', key: 'asymmetry', label: 'Lee slope', min: 0.4, max: 4, step: 0.05, def: 1.6 },
    { kind: 'slider', key: 'ripples', label: 'Wind ripples', min: 0, max: 1, step: 0.01, def: 0.35 },
    { kind: 'slider', key: 'rippleScale', label: 'Ripple scale', min: 20, max: 240, step: 1, def: 90 },
    { kind: 'slider', key: 'meander', label: 'Crest meander', min: 0, max: 2, step: 0.01, def: 0.8 },
    { kind: 'slider', key: 'fields', label: 'Field coverage', min: 0.2, max: 1, step: 0.01, def: 0.75 },
    seedParam,
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const [dx, dy] = dirVec(num(p, 'direction', 35));
    const spacing = num(p, 'spacing', 26);
    const height = num(p, 'height', 0.6);
    const asym = num(p, 'asymmetry', 1.6);
    const ripples = num(p, 'ripples', 0.35);
    const rippleScale = num(p, 'rippleScale', 90);
    const meander = num(p, 'meander', 0.8);
    const fields = num(p, 'fields', 0.75);
    const sheetField = forEachCell(ctx.size, (u, v) =>
      0.5 + 0.5 * noise.fbm(u * 1.6 + 5.5, v * 1.6 - 3.2, 4, 2.1, 0.5),
    ).stretch(1, 99);
    const windLut = new PowLut(1 / Math.max(0.05, asym), 1);
    const leeLut = new PowLut(Math.max(0.05, asym), 1);
    const field = forEachCell(ctx.size, (u, v, i) => {
      const along = u * dx + v * dy;
      const across = -u * dy + v * dx;
      const drift = noise.fbm(across * 2.2 + 31.7, along * 0.8 - 12.4, 3, 2, 0.5) * meander;
      const t = (along * spacing + drift) / TAU;
      const phase = t - Math.floor(t);
      // Asymmetric dune profile: long windward ramp, steep lee face.
      const windward = phase < 0.72 ? windLut.at(phase / 0.72) : 1;
      const lee = phase < 0.72 ? 0 : leeLut.at(1 - (phase - 0.72) / 0.28);
      const profile = phase < 0.72 ? windward : lee;
      const sheet = sheetField.data[i];
      const cover = smoothstep(1 - fields, 1 - fields + 0.35, sheet);
      const ripple = Math.sin(along * rippleScale + drift * 6) * 0.5 + 0.5;
      return clamp(sheet * (1 - height * 0.35) + profile * height * cover + ripple * ripples * 0.06 * cover, 0, 1);
    });
    return field.normalize().clamp(0, 1);
  },
};

/* ----------------------------------------------------------------- volcano */

const volcanoDef: GeneratorDef = {
  id: 'volcano',
  label: 'Volcano / crater',
  blurb: 'A conical edifice with a summit crater, caldera collapse and noisy flanks.',
  params: [
    { kind: 'slider', key: 'centerX', label: 'Centre X', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'centerY', label: 'Centre Y', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'radius', label: 'Radius', min: 0.05, max: 1, step: 0.01, def: 0.36 },
    { kind: 'slider', key: 'height', label: 'Edifice height', min: 0.05, max: 1, step: 0.01, def: 0.8 },
    { kind: 'slider', key: 'flank', label: 'Flank curve', min: 0.5, max: 4, step: 0.05, def: 1.7 },
    { kind: 'slider', key: 'crater', label: 'Crater depth', min: 0, max: 1, step: 0.01, def: 0.35 },
    { kind: 'slider', key: 'craterWidth', label: 'Crater width', min: 0, max: 0.6, step: 0.01, def: 0.16 },
    { kind: 'slider', key: 'rough', label: 'Flank roughness', min: 0, max: 1, step: 0.01, def: 0.3 },
    seedParam,
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const cx = num(p, 'centerX', 0.5);
    const cy = num(p, 'centerY', 0.5);
    const radius = num(p, 'radius', 0.36);
    const height = num(p, 'height', 0.8);
    const flank = num(p, 'flank', 1.7);
    const crater = num(p, 'crater', 0.35);
    const flankLut = new PowLut(Math.max(0.05, flank), 1);
    const craterWidth = num(p, 'craterWidth', 0.16);
    const rough = num(p, 'rough', 0.3);
    return forEachCell(ctx.size, (u, v) => {
      const du = u - cx;
      const dv = v - cy;
      let d = Math.sqrt(du * du + dv * dv) / Math.max(0.01, radius);
      const n = noise.fbm(u * 5 + 8.2, v * 5 - 4.4, 4, 2, 0.5);
      d += n * 0.06 * rough * 4;
      if (d >= 1) return 0;
      const cone = flankLut.at(1 - d);
      let value = cone * height;
      if (craterWidth > 0.001) {
        const rim = smoothstep(craterWidth * 0.4, craterWidth, d);
        value -= (1 - rim) * crater * height;
      }
      value += cone * rough * 0.12 * (0.5 + 0.5 * n);
      return clamp(value, 0, 1);
    });
  },
};

/* ----------------------------------------------------------------- plateau */

const plateauDef: GeneratorDef = {
  id: 'plateau',
  label: 'Plateau / canyon country',
  blurb: 'Flat-topped tableland cut by dendritic incisions — the starting point for sandstone canyons.',
  params: [
    { kind: 'slider', key: 'frequency', label: 'Frequency', min: 0.3, max: 8, step: 0.1, def: 1.6 },
    { kind: 'slider', key: 'topLevel', label: 'Tableland level', min: 0.1, max: 1, step: 0.01, def: 0.72 },
    { kind: 'slider', key: 'edge', label: 'Edge sharpness', min: 0.02, max: 0.6, step: 0.01, def: 0.16 },
    { kind: 'slider', key: 'incision', label: 'Canyon incision', min: 0, max: 1, step: 0.01, def: 0.55 },
    { kind: 'slider', key: 'incisionScale', label: 'Canyon scale', min: 1, max: 20, step: 0.5, def: 7 },
    { kind: 'slider', key: 'steps', label: 'Bench steps', min: 0, max: 8, step: 1, def: 3 },
    { kind: 'slider', key: 'roughness', label: 'Surface detail', min: 0, max: 1, step: 0.01, def: 0.22 },
    seedParam,
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const freq = num(p, 'frequency', 1.6);
    const top = num(p, 'topLevel', 0.72);
    const edge = num(p, 'edge', 0.16);
    const incision = num(p, 'incision', 0.55);
    const incisionScale = num(p, 'incisionScale', 7);
    const steps = Math.round(num(p, 'steps', 3));
    const rough = num(p, 'roughness', 0.22);
    // Stretch the relief field first: raw fBm clusters around its mean, which
    // would leave almost nothing on top of the tableland.
    const reliefField = forEachCell(ctx.size, (u, v) =>
      0.5 + 0.5 * noise.fbm(u * freq, v * freq, 6, 2.05, 0.5),
    ).stretch(1, 99);
    const field = forEachCell(ctx.size, (u, v, i) => {
      const relief = reliefField.data[i];
      let h = smoothstep(top - edge, top + edge * 0.35, relief) * (1 - top) + top * smoothstep(top - edge * 2.4, top, relief);
      if (steps > 0) {
        const q = Math.floor(relief * steps) / steps;
        h = h * (1 - 0.18) + q * 0.18 * top;
      }
      // Canyon incision follows the low-frequency drainage pattern.
      const canyon = 1 - clamp(Math.abs(noise.worley(u * incisionScale, v * incisionScale, 1, 0.9)) * 2.4, 0, 1);
      const depth = CANYON_POW.at(canyon) * incision;
      h -= depth * smoothstep(0.18, 0.62, relief);
      h += (0.5 + 0.5 * noise.fbm(u * 14, v * 14, 3, 2, 0.5) - 0.5) * rough * 0.06;
      return clamp(h, 0, 1);
    });
    return field.stretch(0, 99.5).clamp(0, 1);
  },
};

/* -------------------------------------------------------------------- rift */

const riftDef: GeneratorDef = {
  id: 'rift',
  label: 'Rift / fault network',
  blurb: 'Tectonic fracture lines: linear grabens and horsts from warped cellular borders.',
  params: [
    { kind: 'slider', key: 'frequency', label: 'Fracture density', min: 1, max: 20, step: 0.1, def: 5 },
    { kind: 'slider', key: 'jitter', label: 'Path jitter', min: 0, max: 1, step: 0.01, def: 0.55 },
    { kind: 'slider', key: 'width', label: 'Fracture width', min: 0.01, max: 0.5, step: 0.01, def: 0.12 },
    { kind: 'slider', key: 'depth', label: 'Graben depth', min: 0, max: 1, step: 0.01, def: 0.7 },
    { kind: 'slider', key: 'uplift', label: 'Horst uplift', min: 0, max: 1, step: 0.01, def: 0.25 },
    { kind: 'slider', key: 'direction', label: 'Structural grain', min: 0, max: 180, step: 1, def: 0 },
    { kind: 'slider', key: 'grain', label: 'Grain bias', min: 0, max: 1, step: 0.01, def: 0 },
    seedParam,
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const freq = num(p, 'frequency', 5);
    const jitter = num(p, 'jitter', 0.55);
    const width = num(p, 'width', 0.12);
    const depth = num(p, 'depth', 0.7);
    const uplift = num(p, 'uplift', 0.25);
    const grainDeg = num(p, 'direction', 0);
    const grain = num(p, 'grain', 0);
    const [gx, gy] = dirVec(grainDeg);
    const field = forEachCell(ctx.size, (u, v) => {
      let sx = u * freq;
      let sy = v * freq;
      if (grain > 0) {
        // Stretch the cell field along the structural grain.
        const along = u * gx + v * gy;
        const across = -u * gy + v * gx;
        sx = (across * 2.2 + along * 0.35) * freq;
        sy = (along * 0.55) * freq + 17.3;
      }
      const [wx, wy] = noise.warp(sx, sy, 0.25 + jitter * 0.5, 0.35);
      const border = clamp(Math.abs(noise.worley(wx, wy, 1, jitter)) * 2, 0, 1);
      const graben = 1 - smoothstep(0, width, border);
      const horst = smoothstep(width, width * 2.4, border);
      return clamp(0.5 - graben * depth * 0.5 + horst * uplift * 0.5, 0, 1);
    });
    return field.normalize().clamp(0, 1);
  },
};

/* ---------------------------------------------------------------- gradient */

const gradientDef: GeneratorDef = {
  id: 'gradient',
  label: 'Gradient',
  blurb: 'A directional ramp — coastal shelves, tilted blocks and uplift gradients.',
  params: [
    { kind: 'slider', key: 'direction', label: 'Direction', min: 0, max: 360, step: 1, def: 90 },
    { kind: 'slider', key: 'curve', label: 'Curve', min: 0.25, max: 4, step: 0.05, def: 1 },
    { kind: 'slider', key: 'wobble', label: 'Wobble', min: 0, max: 1, step: 0.01, def: 0 },
    { kind: 'slider', key: 'wobbleScale', label: 'Wobble scale', min: 1, max: 20, step: 0.5, def: 4 },
    seedParam,
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const [dx, dy] = dirVec(num(p, 'direction', 90));
    const curve = num(p, 'curve', 1);
    const wobble = num(p, 'wobble', 0);
    const wobbleScale = num(p, 'wobbleScale', 4);
    const curveLut = new PowLut(Math.max(0.05, curve), 1);
    return forEachCell(ctx.size, (u, v) => {
      let t = (u - 0.5) * dx + (v - 0.5) * dy + 0.5;
      if (wobble > 0) t += noise.fbm(u * wobbleScale, v * wobbleScale, 3, 2, 0.5) * wobble * 0.3;
      return clamp(curveLut.at(clamp(t, 0, 1)), 0, 1);
    });
  },
};

/* -------------------------------------------------------------------- dome */

const domeDef: GeneratorDef = {
  id: 'dome',
  label: 'Dome / basin',
  blurb: 'A radial bulge or depression — shield volcanoes, craters, pull-apart basins.',
  params: [
    { kind: 'slider', key: 'centerX', label: 'Centre X', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'centerY', label: 'Centre Y', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'radius', label: 'Radius', min: 0.05, max: 1.2, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'falloff', label: 'Falloff', min: 0.3, max: 5, step: 0.05, def: 2 },
    { kind: 'slider', key: 'invert', label: 'Basin instead of dome', min: 0, max: 1, step: 1, def: 0 },
    { kind: 'slider', key: 'stretch', label: 'Stretch', min: 0.2, max: 3, step: 0.05, def: 1 },
    seedParam,
  ],
  run: (ctx, p) => {
    const cx = num(p, 'centerX', 0.5);
    const cy = num(p, 'centerY', 0.5);
    const radius = num(p, 'radius', 0.5);
    const falloff = num(p, 'falloff', 2);
    const invert = num(p, 'invert', 0) > 0.5;
    const stretch = num(p, 'stretch', 1);
    const fallLut = new PowLut(Math.max(0.05, falloff), 1);
    return forEachCell(ctx.size, (u, v) => {
      const du = (u - cx) * stretch;
      const dv = v - cy;
      const d = Math.sqrt(du * du + dv * dv) / Math.max(0.02, radius);
      const value = fallLut.at(clamp(1 - d, 0, 1));
      return invert ? 1 - value : value;
    });
  },
};

/* ---------------------------------------------------------------- constant */

const constantDef: GeneratorDef = {
  id: 'constant',
  label: 'Constant',
  blurb: 'A flat fill. Use it as the bedrock floor every other layer builds on.',
  params: [{ kind: 'slider', key: 'value', label: 'Height', min: 0, max: 1, step: 0.01, def: 0.2 }],
  run: (ctx, p) => {
    const value = clamp(num(p, 'value', 0.2), 0, 1);
    return forEachCell(ctx.size, () => value);
  },
};

export const GENERATORS: GeneratorDef[] = [
  perlinDef,
  multifractalDef,
  ridgeDef,
  mountainDef,
  billowDef,
  worleyDef,
  dunesDef,
  volcanoDef,
  plateauDef,
  riftDef,
  gradientDef,
  domeDef,
  constantDef,
];

export const GENERATOR_MAP: Record<string, GeneratorDef> = Object.fromEntries(
  GENERATORS.map((g) => [g.id, g]),
);

/** Per-layer noise object, seeded from the project seed and the layer's offset. */
export function layerNoise(projectSeed: number, layerId: string, offset: number): Noise {
  let h = 0;
  for (let i = 0; i < layerId.length; i++) h = (Math.imul(h, 31) + layerId.charCodeAt(i)) | 0;
  return new Noise(hashSeed(projectSeed + h, offset * 7919));
}
