// Layer masks.
//
// A mask answers "how much of this layer applies here?". Masks read the
// composed height and any derived channel, which is what makes the stack feel
// geological: stratify benches onto cliffs, keep dunes off the summits, run
// wave erosion only along the shoreline.

import { PowLut } from './fastmath';
import { Noise, clamp, ramp, smoothstep } from './noise';
import { Field, protrusion } from './field';
import type { ChannelSource } from './channels';
import type { OpDef, Params } from './params';
import { num, str } from './params';
import type { MaskConfig } from './types';

export interface MaskContext {
  size: number;
  noise: Noise;
  height: Field;
  channels: ChannelSource;
  env: {
    seaLevel: number;
    snowline: number;
    heightScale: number;
    cellSize: number;
  };
  rng: () => number;
}

export type MaskFn = (ctx: MaskContext, p: Params) => Field;

export interface MaskDef extends OpDef {
  run: MaskFn;
}

const TAU = Math.PI * 2;

function band(value: number, lo: number, hi: number, soft: number): number {
  const s = Math.max(0.001, soft);
  return smoothstep(lo - s, lo + s, value) * (1 - smoothstep(hi - s, hi + s, value));
}

/* -------------------------------------------------------------------- none */

const noneDef: MaskDef = {
  id: 'none',
  label: 'No mask',
  blurb: 'The layer applies everywhere.',
  params: [],
  run: (ctx) => Field.zeros(ctx.size).fill(1),
};

/* ------------------------------------------------------------------ height */

const heightDef: MaskDef = {
  id: 'height',
  label: 'Height band',
  blurb: 'Restricts the layer to an elevation band, e.g. only the summits or only the valley floors.',
  params: [
    { kind: 'slider', key: 'low', label: 'From height', min: 0, max: 1, step: 0.01, def: 0.2 },
    { kind: 'slider', key: 'high', label: 'To height', min: 0, max: 1, step: 0.01, def: 1 },
    { kind: 'slider', key: 'softness', label: 'Edge softness', min: 0.005, max: 0.4, step: 0.005, def: 0.08 },
  ],
  run: (ctx, p) => {
    const low = num(p, 'low', 0.2);
    const high = num(p, 'high', 1);
    const soft = num(p, 'softness', 0.08);
    const h = ctx.height.data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) out.data[i] = band(h[i], low, high, soft);
    return out;
  },
};

/* ------------------------------------------------------------------- slope */

const slopeDef: MaskDef = {
  id: 'slope',
  label: 'Slope range',
  blurb: 'Faces between two gradients — scree on the steep, soil on the gentle.',
  params: [
    { kind: 'slider', key: 'min', label: 'From slope', min: 0, max: 90, step: 1, def: 20, unit: '°' },
    { kind: 'slider', key: 'max', label: 'To slope', min: 0, max: 90, step: 1, def: 70, unit: '°' },
    { kind: 'slider', key: 'softness', label: 'Edge softness', min: 0.005, max: 0.4, step: 0.005, def: 0.06 },
  ],
  run: (ctx, p) => {
    const lo = num(p, 'min', 20) / 90;
    const hi = num(p, 'max', 70) / 90;
    const soft = num(p, 'softness', 0.06);
    const s = ctx.channels.get('slope').data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) out.data[i] = band(s[i], lo, hi, soft);
    return out;
  },
};

/* ----------------------------------------------------------------- coastal */

const coastalDef: MaskDef = {
  id: 'coastal',
  label: 'Coastal falloff',
  blurb: 'Fades out away from the waterline — the classic shoreline falloff for cliffs, beaches and wave action.',
  params: [
    { kind: 'slider', key: 'level', label: 'Waterline', min: 0, max: 1, step: 0.005, def: 0.28 },
    { kind: 'slider', key: 'width', label: 'Falloff width', min: 0.005, max: 0.6, step: 0.005, def: 0.12 },
    {
      kind: 'dropdown',
      key: 'side',
      label: 'Applies to',
      def: 'above',
      options: [
        { value: 'above', label: 'Land above the water' },
        { value: 'below', label: 'Water below the line' },
        { value: 'band', label: 'Both sides of the shore' },
      ],
    },
    { kind: 'slider', key: 'softness', label: 'Falloff curve', min: 0.2, max: 3, step: 0.05, def: 1.4 },
  ],
  run: (ctx, p) => {
    const level = num(p, 'level', ctx.env.seaLevel);
    const width = Math.max(0.002, num(p, 'width', 0.12));
    const side = str(p, 'side', 'above');
    const soft = num(p, 'softness', 1.4);
    const softLut = new PowLut(soft, 1);
    const h = ctx.height.data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) {
      const t = clamp(Math.abs(h[i] - level) / width, 0, 1);
      const fall = 1 - softLut.at(t);
      if (side === 'above') out.data[i] = h[i] >= level ? fall : 1;
      else if (side === 'below') out.data[i] = h[i] <= level ? fall : 1;
      else out.data[i] = fall;
    }
    return out;
  },
};

/* -------------------------------------------------------------------- peak */

const peakDef: MaskDef = {
  id: 'peak',
  label: 'Mountain falloff',
  blurb: 'Smooth falloff measured from the summits down, so a layer breaks into isolated mountain tops instead of covering the range continuously.',
  params: [
    { kind: 'slider', key: 'radius', label: 'Prominence radius', min: 2, max: 120, step: 1, def: 28 },
    { kind: 'slider', key: 'threshold', label: 'Summit threshold', min: 0, max: 1, step: 0.01, def: 0.4 },
    { kind: 'slider', key: 'softness', label: 'Falloff', min: 0.02, max: 1, step: 0.01, def: 0.35 },
    { kind: 'slider', key: 'heightGate', label: 'Minimum height', min: 0, max: 1, step: 0.01, def: 0.25 },
    { kind: 'slider', key: 'feather', label: 'Feather', min: 0, max: 1, step: 0.01, def: 0.5 },
  ],
  run: (ctx, p) => {
    const radius = Math.max(2, Math.round(num(p, 'radius', 28)));
    const threshold = num(p, 'threshold', 0.4);
    const soft = Math.max(0.01, num(p, 'softness', 0.35));
    const gate = num(p, 'heightGate', 0.25);
    const feather = num(p, 'feather', 0.5);
    const prom = protrusion(ctx.height, radius);
    // Robust normalise against the 97th percentile of positive prominence.
    let peak = 0;
    const stride = Math.max(1, Math.floor(prom.data.length / 20000));
    const samples: number[] = [];
    for (let i = 0; i < prom.data.length; i += stride) samples.push(prom.data[i]);
    samples.sort((a, b) => a - b);
    peak = Math.max(1e-6, samples[Math.floor(samples.length * 0.97)]);
    const h = ctx.height.data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) {
      const t = clamp(prom.data[i] / peak, 0, 1);
      let m = smoothstep(threshold, Math.min(1, threshold + soft), t);
      m *= smoothstep(gate - 0.06, gate + 0.06, h[i]);
      if (feather > 0) m = m * (1 - feather) + smoothstep(0, 1, t) * m * feather;
      out.data[i] = clamp(m, 0, 1);
    }
    return out;
  },
};

/* ---------------------------------------------------------------- stratify */

const stratifyDef: MaskDef = {
  id: 'stratify',
  label: 'Stratify / stacks',
  blurb: 'Repeating beds through the elevation range — the layer-cake look of sedimentary stacks.',
  params: [
    { kind: 'slider', key: 'bands', label: 'Beds', min: 1, max: 40, step: 1, def: 10 },
    { kind: 'slider', key: 'thickness', label: 'Bed thickness', min: 0.05, max: 0.95, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'softness', label: 'Contact softness', min: 0.005, max: 0.5, step: 0.005, def: 0.1 },
    { kind: 'slider', key: 'jitter', label: 'Thickness jitter', min: 0, max: 1, step: 0.01, def: 0.3 },
    { kind: 'slider', key: 'offset', label: 'Offset', min: 0, max: 1, step: 0.01, def: 0 },
    {
      kind: 'dropdown',
      key: 'mode',
      label: 'Placement',
      def: 'bands',
      options: [
        { value: 'bands', label: 'Inside the beds' },
        { value: 'edges', label: 'On the contacts' },
      ],
    },
  ],
  run: (ctx, p) => {
    const bands = Math.max(1, Math.round(num(p, 'bands', 10)));
    const duty = num(p, 'thickness', 0.5);
    const soft = Math.max(0.002, num(p, 'softness', 0.1));
    const jitter = num(p, 'jitter', 0.3);
    const offset = num(p, 'offset', 0);
    const edges = str(p, 'mode', 'bands') === 'edges';
    const noise = ctx.noise;
    const n = ctx.size;
    const h = ctx.height.data;
    const out = Field.zeros(n);
    const inv = 1 / (n - 1);
    for (let y = 0; y < n; y++) {
      const v = y * inv;
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const u = x * inv;
        const j = jitter > 0 ? noise.fbm(u * 2.2 + 19.4, v * 2.2 - 5.3, 3, 2, 0.5) * jitter * 0.5 : 0;
        let t = (h[i] + offset + j) * bands;
        t -= Math.floor(t);
        out.data[i] = edges
          ? clamp(1 - smoothstep(0, soft * 2, Math.abs(t - duty)), 0, 1)
          : clamp(1 - smoothstep(duty - soft, duty + soft, t), 0, 1);
      }
    }
    return out;
  },
};

/* -------------------------------------------------------------------- rift */

const riftDef: MaskDef = {
  id: 'rift',
  label: 'Rifts / fracture lines',
  blurb: 'Tectonic fracture corridors — grabens, joint sets and fissure swarms.',
  params: [
    { kind: 'slider', key: 'density', label: 'Fracture density', min: 1, max: 24, step: 0.5, def: 6 },
    { kind: 'slider', key: 'width', label: 'Corridor width', min: 0.01, max: 0.5, step: 0.01, def: 0.12 },
    { kind: 'slider', key: 'jitter', label: 'Path jitter', min: 0, max: 1, step: 0.01, def: 0.6 },
    { kind: 'slider', key: 'grain', label: 'Structural grain', min: 0, max: 180, step: 1, def: 0 },
    { kind: 'slider', key: 'grainBias', label: 'Grain bias', min: 0, max: 1, step: 0.01, def: 0 },
    {
      kind: 'dropdown',
      key: 'mode',
      label: 'Feature',
      def: 'graben',
      options: [
        { value: 'graben', label: 'Fracture corridors' },
        { value: 'horst', label: 'Blocks between them' },
      ],
    },
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const density = num(p, 'density', 6);
    const width = num(p, 'width', 0.12);
    const jitter = num(p, 'jitter', 0.6);
    const grain = (num(p, 'grain', 0) * Math.PI) / 180;
    const bias = num(p, 'grainBias', 0);
    const horst = str(p, 'mode', 'graben') === 'horst';
    const gx = Math.cos(grain);
    const gy = Math.sin(grain);
    const n = ctx.size;
    const inv = 1 / (n - 1);
    const out = Field.zeros(n);
    for (let y = 0; y < n; y++) {
      const v = y * inv;
      for (let x = 0; x < n; x++) {
        const u = x * inv;
        const along = u * gx + v * gy;
        const across = -u * gy + v * gx;
        const ax = (across * (1 + bias * 2) + along * (1 - bias) * 0.4) * density;
        const ay = (along * (1 - bias) * 0.6 + across * 0.2) * density + 31.7;
        const [wx, wy] = noise.warp(ax, ay, 0.2 + jitter * 0.6, 0.35);
        const border = clamp(Math.abs(noise.worley(wx, wy, 1, jitter)) * 2, 0, 1);
        const corridor = 1 - smoothstep(0, Math.max(0.005, width), border);
        out.data[y * n + x] = horst ? 1 - corridor : corridor;
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------- cliff */

const cliffDef: MaskDef = {
  id: 'cliff',
  label: 'Cliffs / scarps',
  blurb: 'Steep convex faces: escarpments, canyon walls and crags.',
  params: [
    { kind: 'slider', key: 'minSlope', label: 'Minimum slope', min: 5, max: 89, step: 1, def: 42, unit: '°' },
    { kind: 'slider', key: 'softness', label: 'Edge softness', min: 0.01, max: 0.4, step: 0.01, def: 0.12 },
    { kind: 'slider', key: 'convexity', label: 'Convex bias', min: 0, max: 1, step: 0.01, def: 0.4 },
    { kind: 'slider', key: 'relief', label: 'Relief gate', min: 0, max: 1, step: 0.01, def: 0.15 },
  ],
  run: (ctx, p) => {
    const minSlope = num(p, 'minSlope', 42) / 90;
    const soft = num(p, 'softness', 0.12);
    const convexity = num(p, 'convexity', 0.4);
    const reliefGate = num(p, 'relief', 0.15);
    const slope = ctx.channels.get('slope').data;
    const curv = ctx.channels.get('curvature').data;
    const prom = ctx.channels.get('protrusion').data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) {
      const s = smoothstep(minSlope - soft, minSlope + soft, slope[i]);
      const convex = smoothstep(0.5, 0.86, curv[i]);
      const relief = smoothstep(reliefGate - 0.1, reliefGate + 0.2, prom[i]);
      out.data[i] = clamp(s * (1 - convexity + convexity * convex * 2) * (0.25 + 0.75 * relief), 0, 1);
    }
    return out;
  },
};

/* ------------------------------------------------------------------- river */

const riverDef: MaskDef = {
  id: 'river',
  label: 'Rivers / drainage',
  blurb: 'Follows flow accumulation — channel beds, floodplains and alluvial fans.',
  params: [
    { kind: 'slider', key: 'threshold', label: 'Channel threshold', min: 0.1, max: 1, step: 0.01, def: 0.62 },
    { kind: 'slider', key: 'width', label: 'Corridor width', min: 0.02, max: 0.6, step: 0.01, def: 0.18 },
    { kind: 'slider', key: 'softness', label: 'Falloff', min: 0.2, max: 3, step: 0.05, def: 1 },
    {
      kind: 'dropdown',
      key: 'source',
      label: 'Source',
      def: 'flow',
      options: [
        { value: 'flow', label: 'Flow accumulation' },
        { value: 'wetness', label: 'Topographic wetness' },
      ],
    },
  ],
  run: (ctx, p) => {
    const threshold = num(p, 'threshold', 0.62);
    const width = Math.max(0.01, num(p, 'width', 0.18));
    const soft = num(p, 'softness', 1);
    const softLut = new PowLut(soft, 1);
    const src = ctx.channels.get(str(p, 'source', 'flow') === 'wetness' ? 'wetness' : 'flow').data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) {
      const t = clamp((src[i] - (threshold - width)) / width, 0, 1);
      out.data[i] = softLut.at(t);
    }
    return out;
  },
};

/* ---------------------------------------------------------------- sediment */

const sedimentDef: MaskDef = {
  id: 'sediment',
  label: 'Sedimentation',
  blurb: 'Where the simulation put material down — fans, floodplains, deltas, moraines.',
  params: [
    { kind: 'slider', key: 'threshold', label: 'Deposit threshold', min: 0, max: 1, step: 0.01, def: 0.2 },
    { kind: 'slider', key: 'softness', label: 'Falloff', min: 0.02, max: 1, step: 0.01, def: 0.35 },
  ],
  run: (ctx, p) => {
    const threshold = num(p, 'threshold', 0.2);
    const soft = Math.max(0.01, num(p, 'softness', 0.35));
    const src = ctx.channels.get('sediment').data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) out.data[i] = smoothstep(threshold, Math.min(1, threshold + soft), src[i]);
    return out;
  },
};

/* ------------------------------------------------------------------ eroded */

const erodedDef: MaskDef = {
  id: 'eroded',
  label: 'Eroded ground',
  blurb: 'Where the simulation removed material — scoured bedrock and dissected slopes.',
  params: [
    { kind: 'slider', key: 'threshold', label: 'Removal threshold', min: 0, max: 1, step: 0.01, def: 0.2 },
    { kind: 'slider', key: 'softness', label: 'Falloff', min: 0.02, max: 1, step: 0.01, def: 0.35 },
  ],
  run: (ctx, p) => {
    const threshold = num(p, 'threshold', 0.2);
    const soft = Math.max(0.01, num(p, 'softness', 0.35));
    const src = ctx.channels.get('eroded').data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) out.data[i] = smoothstep(threshold, Math.min(1, threshold + soft), src[i]);
    return out;
  },
};

/* -------------------------------------------------------------- protrusion */

const protrusionDef: MaskDef = {
  id: 'protrusion',
  label: 'Protrusion',
  blurb: 'Local prominence: exposed crests and spur ends, or the hollows between them.',
  params: [
    { kind: 'slider', key: 'radius', label: 'Prominence radius', min: 2, max: 120, step: 1, def: 26 },
    { kind: 'slider', key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'softness', label: 'Falloff', min: 0.02, max: 1, step: 0.01, def: 0.3 },
    {
      kind: 'dropdown',
      key: 'mode',
      label: 'Feature',
      def: 'crests',
      options: [
        { value: 'crests', label: 'Protruding crests' },
        { value: 'hollows', label: 'Sheltered hollows' },
      ],
    },
  ],
  run: (ctx, p) => {
    const radius = Math.max(2, Math.round(num(p, 'radius', 26)));
    const threshold = num(p, 'threshold', 0.5);
    const soft = Math.max(0.01, num(p, 'softness', 0.3));
    const hollows = str(p, 'mode', 'crests') === 'hollows';
    const src = protrusion(ctx.height, radius);
    let peak = 0;
    const samples: number[] = [];
    const stride = Math.max(1, Math.floor(src.data.length / 20000));
    for (let i = 0; i < src.data.length; i += stride) samples.push(Math.abs(src.data[i]));
    samples.sort((a, b) => a - b);
    peak = Math.max(1e-6, samples[Math.floor(samples.length * 0.97)]);
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) {
      const t = hollows ? clamp(-src.data[i] / peak, 0, 1) : clamp(src.data[i] / peak, 0, 1);
      out.data[i] = smoothstep(threshold, Math.min(1, threshold + soft), t);
    }
    return out;
  },
};

/* ---------------------------------------------------------------- curvature */

const curvatureDef: MaskDef = {
  id: 'curvature',
  label: 'Curvature',
  blurb: 'Convex crests, concave hollows or flat ground, from the surface curvature.',
  params: [
    {
      kind: 'dropdown',
      key: 'mode',
      label: 'Feature',
      def: 'convex',
      options: [
        { value: 'convex', label: 'Convex crests' },
        { value: 'concave', label: 'Concave hollows' },
        { value: 'flat', label: 'Flat ground' },
      ],
    },
    { kind: 'slider', key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, def: 0.55 },
    { kind: 'slider', key: 'softness', label: 'Falloff', min: 0.02, max: 1, step: 0.01, def: 0.25 },
  ],
  run: (ctx, p) => {
    const mode = str(p, 'mode', 'convex');
    const threshold = num(p, 'threshold', 0.55);
    const soft = Math.max(0.01, num(p, 'softness', 0.25));
    const src = ctx.channels.get('curvature').data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) {
      const c = src[i];
      if (mode === 'flat') {
        out.data[i] = 1 - smoothstep(0, soft, Math.abs(c - 0.5) * 2);
      } else if (mode === 'convex') {
        out.data[i] = smoothstep(threshold, Math.min(1, threshold + soft), c);
      } else {
        out.data[i] = smoothstep(threshold, Math.min(1, threshold + soft), 1 - c);
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ aspect */

const aspectDef: MaskDef = {
  id: 'aspect',
  label: 'Aspect / facing',
  blurb: 'Slopes facing a compass direction — sun-exposed versus shaded aspects.',
  params: [
    { kind: 'slider', key: 'direction', label: 'Direction', min: 0, max: 360, step: 1, def: 180, unit: '°' },
    { kind: 'slider', key: 'spread', label: 'Spread', min: 15, max: 180, step: 1, def: 90, unit: '°' },
    { kind: 'slider', key: 'softness', label: 'Falloff', min: 0.2, max: 4, step: 0.05, def: 1 },
  ],
  run: (ctx, p) => {
    const dir = (num(p, 'direction', 180) / 360) * TAU;
    const spread = (num(p, 'spread', 90) / 360) * TAU;
    const soft = num(p, 'softness', 1);
    const softLut = new PowLut(soft, 1);
    const src = ctx.channels.get('aspect').data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) {
      let d = Math.abs(src[i] * TAU - dir);
      if (d > Math.PI) d = TAU - d;
      const t = 1 - clamp(d / Math.max(0.01, spread * 0.5), 0, 1);
      out.data[i] = softLut.at(t);
    }
    return out;
  },
};

/* ------------------------------------------------------------------- noise */

const noiseDef: MaskDef = {
  id: 'noise',
  label: 'Fractal noise',
  blurb: 'Broken, organic coverage from a fractal field — nothing in nature is a clean band.',
  params: [
    { kind: 'slider', key: 'frequency', label: 'Frequency', min: 0.5, max: 30, step: 0.1, def: 4 },
    { kind: 'slider', key: 'octaves', label: 'Octaves', min: 1, max: 10, step: 1, def: 5 },
    { kind: 'slider', key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'softness', label: 'Falloff', min: 0.02, max: 1, step: 0.01, def: 0.3 },
    { kind: 'slider', key: 'warp', label: 'Domain warp', min: 0, max: 1.5, step: 0.01, def: 0.2 },
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const freq = num(p, 'frequency', 4);
    const octaves = num(p, 'octaves', 5);
    const threshold = num(p, 'threshold', 0.5);
    const soft = Math.max(0.01, num(p, 'softness', 0.3));
    const warp = num(p, 'warp', 0.2);
    const n = ctx.size;
    const inv = 1 / (n - 1);
    const out = Field.zeros(n);
    for (let y = 0; y < n; y++) {
      const v = y * inv;
      for (let x = 0; x < n; x++) {
        const u = x * inv;
        const [wx, wy] = warp ? noise.warp(u * freq, v * freq, warp, 0.35) : [u * freq, v * freq];
        const value = 0.5 + 0.5 * noise.fbm(wx, wy, octaves, 2.1, 0.5);
        out.data[y * n + x] = smoothstep(threshold - soft * 0.5, threshold + soft * 0.5, value);
      }
    }
    return out;
  },
};

/* ------------------------------------------------------------------ radial */

const radialDef: MaskDef = {
  id: 'radial',
  label: 'Radial',
  blurb: 'A soft disc centred anywhere on the patch — local uplift, a crater, an island.',
  params: [
    { kind: 'slider', key: 'centerX', label: 'Centre X', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'centerY', label: 'Centre Y', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'radius', label: 'Radius', min: 0.05, max: 1.2, step: 0.01, def: 0.4 },
    { kind: 'slider', key: 'softness', label: 'Falloff', min: 0.02, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'invert', label: 'Outside instead', min: 0, max: 1, step: 1, def: 0 },
  ],
  run: (ctx, p) => {
    const cx = num(p, 'centerX', 0.5);
    const cy = num(p, 'centerY', 0.5);
    const radius = num(p, 'radius', 0.4);
    const soft = Math.max(0.01, num(p, 'softness', 0.5));
    const invert = num(p, 'invert', 0) > 0.5;
    const n = ctx.size;
    const inv = 1 / (n - 1);
    const out = Field.zeros(n);
    for (let y = 0; y < n; y++) {
      const v = y * inv;
      for (let x = 0; x < n; x++) {
        const u = x * inv;
        const d = Math.sqrt((u - cx) * (u - cx) + (v - cy) * (v - cy)) / Math.max(0.02, radius);
        const m = 1 - smoothstep(1 - soft, 1 + soft * 0.2, d);
        out.data[y * n + x] = invert ? 1 - m : m;
      }
    }
    return out;
  },
};

/* -------------------------------------------------------------------- snow */

const snowDef: MaskDef = {
  id: 'snow',
  label: 'Snow line',
  blurb: 'Everything above the snow line, thinned off the cliffs where snow will not settle.',
  params: [
    { kind: 'slider', key: 'snowline', label: 'Snow line', min: 0, max: 1, step: 0.01, def: 0.7 },
    { kind: 'slider', key: 'softness', label: 'Transition', min: 0.005, max: 0.3, step: 0.005, def: 0.06 },
    { kind: 'slider', key: 'shedding', label: 'Cliff shedding', min: 0, max: 1, step: 0.01, def: 0.6 },
  ],
  run: (ctx, p) => {
    const line = num(p, 'snowline', ctx.env.snowline);
    const soft = Math.max(0.002, num(p, 'softness', 0.06));
    const shedding = num(p, 'shedding', 0.6);
    const h = ctx.height.data;
    const slope = ctx.channels.get('slope').data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) {
      const alt = smoothstep(line - soft, line + soft, h[i]);
      const keep = 1 - shedding * smoothstep(0.5, 0.85, slope[i]);
      out.data[i] = clamp(alt * keep, 0, 1);
    }
    return out;
  },
};

/* ----------------------------------------------------------------- wetness */

const wetnessDef: MaskDef = {
  id: 'wetness',
  label: 'Wetness',
  blurb: 'Topographic wetness — seeps, bogs and water-logged hollows.',
  params: [
    { kind: 'slider', key: 'threshold', label: 'Wetness threshold', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'softness', label: 'Falloff', min: 0.02, max: 1, step: 0.01, def: 0.3 },
  ],
  run: (ctx, p) => {
    const threshold = num(p, 'threshold', 0.5);
    const soft = Math.max(0.01, num(p, 'softness', 0.3));
    const src = ctx.channels.get('wetness').data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) out.data[i] = smoothstep(threshold, Math.min(1, threshold + soft), src[i]);
    return out;
  },
};

/* ---------------------------------------------------------------- roughness */

const roughDef: MaskDef = {
  id: 'roughness',
  label: 'Roughness',
  blurb: 'Broken, irregular ground — blockfields, moraine and crag-and-tail.',
  params: [
    { kind: 'slider', key: 'threshold', label: 'Roughness threshold', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'softness', label: 'Falloff', min: 0.02, max: 1, step: 0.01, def: 0.3 },
  ],
  run: (ctx, p) => {
    const threshold = num(p, 'threshold', 0.5);
    const soft = Math.max(0.01, num(p, 'softness', 0.3));
    const src = ctx.channels.get('roughness').data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) out.data[i] = smoothstep(threshold, Math.min(1, threshold + soft), src[i]);
    return out;
  },
};

/* --------------------------------------------------------------------- sea */

const seaDef: MaskDef = {
  id: 'sea',
  label: 'Water level',
  blurb: 'Submerged ground, dry land, or the narrow intertidal strip between them.',
  params: [
    { kind: 'slider', key: 'level', label: 'Water level', min: 0, max: 1, step: 0.005, def: 0.28 },
    { kind: 'slider', key: 'softness', label: 'Transition', min: 0.002, max: 0.3, step: 0.002, def: 0.03 },
    {
      kind: 'dropdown',
      key: 'mode',
      label: 'Applies to',
      def: 'below',
      options: [
        { value: 'below', label: 'Below water' },
        { value: 'above', label: 'Above water' },
        { value: 'shore', label: 'Shoreline band' },
      ],
    },
  ],
  run: (ctx, p) => {
    const level = num(p, 'level', ctx.env.seaLevel);
    const soft = Math.max(0.001, num(p, 'softness', 0.03));
    const mode = str(p, 'mode', 'below');
    const h = ctx.height.data;
    const out = Field.zeros(ctx.size);
    for (let i = 0; i < out.data.length; i++) {
      if (mode === 'below') out.data[i] = 1 - smoothstep(level - soft, level + soft, h[i]);
      else if (mode === 'above') out.data[i] = smoothstep(level - soft, level + soft, h[i]);
      else out.data[i] = 1 - smoothstep(0, soft * 3, Math.abs(h[i] - level));
    }
    return out;
  },
};

export const MASKS: MaskDef[] = [
  noneDef,
  heightDef,
  slopeDef,
  coastalDef,
  peakDef,
  stratifyDef,
  riftDef,
  cliffDef,
  riverDef,
  sedimentDef,
  erodedDef,
  protrusionDef,
  curvatureDef,
  aspectDef,
  noiseDef,
  radialDef,
  snowDef,
  wetnessDef,
  roughDef,
  seaDef,
];

export const MASK_MAP: Record<string, MaskDef> = Object.fromEntries(MASKS.map((m) => [m.id, m]));

export function makeMaskConfig(type = 'none'): MaskConfig {
  return { type, params: {}, invert: false, falloff: 0.35, strength: 1 };
}

/** Evaluate a mask to a 0..1 field, applying invert, falloff and strength. */
export function evaluateMask(cfg: MaskConfig, ctx: MaskContext): Field | null {
  const def = MASK_MAP[cfg.type] ?? noneDef;
  if (cfg.type === 'none' || def === noneDef) {
    if (cfg.strength >= 0.999 && !cfg.invert) return null;
  }
  let field = def.run(ctx, cfg.params);
  const d = field.data;
  const invert = cfg.invert;
  const falloff = clamp(cfg.falloff, 0, 1);
  const strength = clamp(cfg.strength, 0, 1);
  for (let i = 0; i < d.length; i++) {
    let m = d[i];
    if (invert) m = 1 - m;
    if (falloff < 1) m = ramp(0, 1, m, Math.max(0.02, falloff));
    d[i] = clamp(m * strength, 0, 1);
  }
  return field;
}
