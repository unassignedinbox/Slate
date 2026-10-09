// Height filters — non-destructive operations applied to whatever the stack
// has composed so far. (Simulation lives in erosion/, sculpting lives here.)

import { PowLut } from './fastmath';
import { Noise, clamp, smoothstep } from './noise';
import { Field, blur, slopeMap } from './field';
import type { OpDef, Params } from './params';
import { num, str } from './params';

export interface FilterContext {
  size: number;
  seed: number;
  noise: Noise;
  height: Field;
  /** Metres per cell. */
  cellSize: number;
  /** Metres represented by a normalised height of 1. */
  heightScale: number;
  rng: () => number;
}

export type FilterFn = (ctx: FilterContext, p: Params) => Field;

export interface FilterDef extends OpDef {
  run: FilterFn;
}

const terraceDef: FilterDef = {
  id: 'terrace',
  label: 'Terrace / strata',
  blurb: 'Steps the surface into benches. The geological stack that sandstone country is famous for.',
  params: [
    { kind: 'slider', key: 'steps', label: 'Steps', min: 2, max: 60, step: 1, def: 14 },
    { kind: 'slider', key: 'softness', label: 'Step softness', min: 0, max: 1, step: 0.01, def: 0.35 },
    { kind: 'slider', key: 'jitter', label: 'Thickness jitter', min: 0, max: 1, step: 0.01, def: 0.35 },
    { kind: 'slider', key: 'offset', label: 'Step offset', min: 0, max: 1, step: 0.01, def: 0 },
    { kind: 'slider', key: 'warp', label: 'Layer warp', min: 0, max: 1, step: 0.01, def: 0.15 },
    { kind: 'slider', key: 'warpScale', label: 'Warp scale', min: 0.5, max: 20, step: 0.5, def: 4 },
  ],
  run: (ctx, p) => {
    const steps = Math.max(2, Math.round(num(p, 'steps', 14)));
    const softness = clamp(num(p, 'softness', 0.35), 0, 1);
    const jitter = num(p, 'jitter', 0.35);
    const offset = num(p, 'offset', 0);
    const warp = num(p, 'warp', 0.15);
    const warpScale = num(p, 'warpScale', 4);
    const noise = ctx.noise;
    const n = ctx.size;
    const src = ctx.height.data;
    const out = Field.zeros(n);
    const inv = 1 / (n - 1);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const u = x * inv;
        const v = y * inv;
        let h = src[i];
        if (warp > 0) h += noise.fbm(u * warpScale, v * warpScale, 4, 2, 0.5) * warp * 0.05;
        // Jitter the bench thickness with a second noise field.
        const j = jitter > 0 ? noise.fbm(u * 2.3 + 41.1, v * 2.3 - 17.6, 3, 2, 0.5) * jitter * 0.5 : 0;
        const t = (h + offset + j) * steps;
        const idx = Math.floor(t);
        const frac = t - idx;
        const shaped = softness >= 1 ? frac : smoothstep(0.5 - softness * 0.5, 0.5 + softness * 0.5, frac);
        out.data[i] = clamp((idx + shaped) / steps - offset - j, 0, 1.2);
      }
    }
    return out.normalize().clamp(0, 1);
  },
};

const smoothDef: FilterDef = {
  id: 'smooth',
  label: 'Smooth',
  blurb: 'Blurs the surface. Weathering, burial, or just taking the edge off a generator.',
  params: [
    { kind: 'slider', key: 'radius', label: 'Radius', min: 1, max: 64, step: 1, def: 4 },
    { kind: 'slider', key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
  ],
  run: (ctx, p) => {
    const radius = num(p, 'radius', 4);
    const mix = num(p, 'mix', 1);
    const blurred = blur(ctx.height, radius);
    const out = ctx.height.clone();
    const a = out.data;
    const b = blurred.data;
    for (let i = 0; i < a.length; i++) a[i] = a[i] + (b[i] - a[i]) * mix;
    return out;
  },
};

const sharpenDef: FilterDef = {
  id: 'sharpen',
  label: 'Sharpen',
  blurb: 'Pushes high-frequency detail back out. Crispens crests and breaks up soft blobs.',
  params: [
    { kind: 'slider', key: 'radius', label: 'Radius', min: 1, max: 32, step: 1, def: 3 },
    { kind: 'slider', key: 'amount', label: 'Amount', min: 0, max: 3, step: 0.01, def: 0.6 },
  ],
  run: (ctx, p) => {
    const radius = num(p, 'radius', 3);
    const amount = num(p, 'amount', 0.6);
    const blurred = blur(ctx.height, radius);
    const out = ctx.height.clone();
    const a = out.data;
    const b = blurred.data;
    for (let i = 0; i < a.length; i++) a[i] = b[i] + (a[i] - b[i]) * (1 + amount);
    return out.clamp(0, 1.4);
  },
};

const levelsDef: FilterDef = {
  id: 'levels',
  label: 'Levels',
  blurb: 'Remap the composed height: black point, white point and gamma.',
  params: [
    { kind: 'slider', key: 'low', label: 'Black point', min: 0, max: 1, step: 0.01, def: 0 },
    { kind: 'slider', key: 'high', label: 'White point', min: 0, max: 1, step: 0.01, def: 1 },
    { kind: 'slider', key: 'gamma', label: 'Gamma', min: 0.2, max: 3, step: 0.01, def: 1 },
  ],
  run: (ctx, p) => {
    const low = num(p, 'low', 0);
    const high = Math.max(low + 0.001, num(p, 'high', 1));
    const gamma = num(p, 'gamma', 1);
    const gammaLut = Math.abs(gamma - 1) < 0.01 ? null : new PowLut(gamma, 1);
    const out = ctx.height.clone();
    const d = out.data;
    const inv = 1 / (high - low);
    for (let i = 0; i < d.length; i++) {
      const t = clamp((d[i] - low) * inv, 0, 1);
      d[i] = gammaLut ? gammaLut.at(t) : t;
    }
    return out;
  },
};

const detailDef: FilterDef = {
  id: 'detail',
  label: 'Surface detail',
  blurb: 'Adds fine fractal grain, optionally gated so it only bites on open ground.',
  params: [
    { kind: 'slider', key: 'frequency', label: 'Frequency', min: 4, max: 200, step: 1, def: 48 },
    { kind: 'slider', key: 'octaves', label: 'Octaves', min: 1, max: 8, step: 1, def: 4 },
    { kind: 'slider', key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.12 },
    {
      kind: 'dropdown',
      key: 'gate',
      label: 'Placement',
      def: 'all',
      options: [
        { value: 'all', label: 'Everywhere' },
        { value: 'flat', label: 'Flat ground only' },
        { value: 'steep', label: 'Slopes only' },
      ],
    },
    { kind: 'slider', key: 'gateSharpness', label: 'Gate sharpness', min: 0.05, max: 1, step: 0.05, def: 0.4 },
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const freq = num(p, 'frequency', 48);
    const octaves = num(p, 'octaves', 4);
    const amount = num(p, 'amount', 0.12);
    const gate = str(p, 'gate', 'all');
    const gateSharp = num(p, 'gateSharpness', 0.4);
    const n = ctx.size;
    const out = ctx.height.clone();
    const inv = 1 / (n - 1);
    let gateField: Float32Array | null = null;
    if (gate !== 'all') {
      const slope = slopeMap(ctx.height, ctx.cellSize, ctx.heightScale);
      gateField = new Float32Array(n * n);
      for (let i = 0; i < gateField.length; i++) {
        const s = slope.data[i] / (Math.PI / 2);
        gateField[i] = gate === 'flat' ? 1 - smoothstep(0, gateSharp, s) : smoothstep(1 - gateSharp, 1, s);
      }
    }
    const d = out.data;
    for (let y = 0; y < n; y++) {
      const v = y * inv;
      for (let x = 0; x < n; x++) {
        const i = y * n + x;
        const u = x * inv;
        const grain = noise.fbm(u * freq, v * freq, octaves, 2.1, 0.5);
        const g = gateField ? gateField[i] : 1;
        d[i] += grain * amount * 0.06 * g;
      }
    }
    return out.clamp(0, 1.4);
  },
};

const warpDef: FilterDef = {
  id: 'warp',
  label: 'Domain warp',
  blurb: 'Pushes the terrain sideways through a noise field — folded strata and creeping slopes.',
  params: [
    { kind: 'slider', key: 'strength', label: 'Strength', min: 0, max: 0.3, step: 0.005, def: 0.05 },
    { kind: 'slider', key: 'frequency', label: 'Frequency', min: 0.5, max: 20, step: 0.1, def: 3 },
  ],
  run: (ctx, p) => {
    const strength = num(p, 'strength', 0.05);
    const freq = num(p, 'frequency', 3);
    const noise = ctx.noise;
    const n = ctx.size;
    const src = ctx.height;
    const out = Field.zeros(n);
    const inv = 1 / (n - 1);
    for (let y = 0; y < n; y++) {
      const v = y * inv;
      for (let x = 0; x < n; x++) {
        const u = x * inv;
        const [wx, wy] = noise.warp(u * freq, v * freq, strength * freq, 0.4);
        out.data[y * n + x] = src.sample(wx / freq * (n - 1), wy / freq * (n - 1));
      }
    }
    return out;
  },
};

const clampDef: FilterDef = {
  id: 'clamp',
  label: 'Clamp',
  blurb: 'Hard ceiling and floor for the composed height.',
  params: [
    { kind: 'slider', key: 'min', label: 'Floor', min: 0, max: 1, step: 0.01, def: 0 },
    { kind: 'slider', key: 'max', label: 'Ceiling', min: 0, max: 1, step: 0.01, def: 1 },
  ],
  run: (ctx, p) => {
    const lo = num(p, 'min', 0);
    const hi = num(p, 'max', 1);
    return ctx.height.clone().clamp(lo, hi);
  },
};

const planationDef: FilterDef = {
  id: 'planation',
  label: 'Planation / flatten',
  blurb: 'Truncates the surface at a level — pediments, marine terraces and planation surfaces.',
  params: [
    { kind: 'slider', key: 'level', label: 'Level', min: 0, max: 1, step: 0.01, def: 0.5 },
    { kind: 'slider', key: 'softness', label: 'Blend', min: 0.01, max: 0.5, step: 0.01, def: 0.08 },
    { kind: 'slider', key: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, def: 1 },
    {
      kind: 'dropdown',
      key: 'side',
      label: 'Affects',
      def: 'above',
      options: [
        { value: 'above', label: 'Above the level' },
        { value: 'below', label: 'Below the level' },
      ],
    },
  ],
  run: (ctx, p) => {
    const level = num(p, 'level', 0.5);
    const soft = num(p, 'softness', 0.08);
    const mix = num(p, 'mix', 1);
    const above = str(p, 'side', 'above') === 'above';
    const out = ctx.height.clone();
    const d = out.data;
    for (let i = 0; i < d.length; i++) {
      const t = above ? smoothstep(level - soft, level + soft, d[i]) : 1 - smoothstep(level - soft, level + soft, d[i]);
      d[i] = d[i] + (level - d[i]) * t * mix;
    }
    return out;
  },
};

const reposeDef: FilterDef = {
  id: 'repose',
  label: 'Slope limiter',
  blurb: 'Relaxes slopes steeper than the angle of repose — instant talus and scree aprons.',
  params: [
    { kind: 'slider', key: 'angle', label: 'Angle of repose', min: 5, max: 75, step: 1, def: 38 },
    { kind: 'slider', key: 'iterations', label: 'Passes', min: 1, max: 40, step: 1, def: 12 },
    { kind: 'slider', key: 'strength', label: 'Strength', min: 0, max: 1, step: 0.01, def: 0.5 },
  ],
  run: (ctx, p) => {
    const angle = (num(p, 'angle', 38) * Math.PI) / 180;
    const iterations = Math.round(num(p, 'iterations', 12));
    const strength = num(p, 'strength', 0.5);
    const maxDh = (Math.tan(angle) * ctx.cellSize) / ctx.heightScale;
    const n = ctx.size;
    const h = new Float32Array(ctx.height.data);
    const delta = new Float32Array(h.length);
    for (let it = 0; it < iterations; it++) {
      delta.fill(0);
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const i = y * n + x;
          const hi = h[i];
          let target = -1;
          let excess = 0;
          for (let d = 0; d < 4; d++) {
            const nx = x + (d === 0 ? 1 : d === 2 ? -1 : 0);
            const ny = y + (d === 1 ? 1 : d === 3 ? -1 : 0);
            if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
            const j = ny * n + nx;
            const e = hi - h[j] - maxDh;
            if (e > excess) {
              excess = e;
              target = j;
            }
          }
          if (target < 0) continue;
          const move = excess * strength * 0.5;
          delta[i] -= move;
          delta[target] += move;
        }
      }
      for (let i = 0; i < h.length; i++) h[i] += delta[i];
    }
    return new Field(n, h).clamp(0, 1.4);
  },
};

const amplifyDef: FilterDef = {
  id: 'amplify',
  label: 'Amplify slopes',
  blurb: 'Exaggerates local relief above a slope threshold — crisper escarpments and spur lines.',
  params: [
    { kind: 'slider', key: 'threshold', label: 'Slope threshold', min: 0, max: 60, step: 1, def: 12 },
    { kind: 'slider', key: 'amount', label: 'Amount', min: 0, max: 3, step: 0.05, def: 0.8 },
    { kind: 'slider', key: 'radius', label: 'Detail radius', min: 1, max: 24, step: 1, def: 4 },
  ],
  run: (ctx, p) => {
    const threshold = (num(p, 'threshold', 12) * Math.PI) / 180;
    const amount = num(p, 'amount', 0.8);
    const radius = num(p, 'radius', 4);
    const slope = slopeMap(ctx.height, ctx.cellSize, ctx.heightScale);
    const smoothed = blur(ctx.height, radius);
    const out = ctx.height.clone();
    const d = out.data;
    for (let i = 0; i < d.length; i++) {
      const s = slope.data[i];
      const gate = smoothstep(threshold * 0.5, threshold * 1.5, s);
      d[i] = smoothed.data[i] + (d[i] - smoothed.data[i]) * (1 + amount * gate);
    }
    return out.clamp(0, 1.4);
  },
};

const faultDef: FilterDef = {
  id: 'fault',
  label: 'Fault offset',
  blurb: 'Offsets one side of a line — normal faults, graben walls and tilted blocks.',
  params: [
    { kind: 'slider', key: 'direction', label: 'Strike', min: 0, max: 180, step: 1, def: 0 },
    { kind: 'slider', key: 'position', label: 'Position', min: -0.6, max: 0.6, step: 0.01, def: 0 },
    { kind: 'slider', key: 'throw', label: 'Throw', min: -0.6, max: 0.6, step: 0.01, def: 0.15 },
    { kind: 'slider', key: 'width', label: 'Drag width', min: 0.005, max: 0.4, step: 0.005, def: 0.06 },
    { kind: 'slider', key: 'roughness', label: 'Trace roughness', min: 0, max: 1, step: 0.01, def: 0.3 },
  ],
  run: (ctx, p) => {
    const noise = ctx.noise;
    const dir = (num(p, 'direction', 0) * Math.PI) / 180;
    const nx = Math.cos(dir);
    const ny = Math.sin(dir);
    const position = num(p, 'position', 0);
    const throwAmount = num(p, 'throw', 0.15);
    const width = num(p, 'width', 0.06);
    const rough = num(p, 'roughness', 0.3);
    const n = ctx.size;
    const inv = 1 / (n - 1);
    const out = ctx.height.clone();
    const d = out.data;
    for (let y = 0; y < n; y++) {
      const v = y * inv - 0.5;
      for (let x = 0; x < n; x++) {
        const u = x * inv - 0.5;
        let s = u * nx + v * ny - position;
        if (rough > 0) s += noise.fbm(u * 3 + 12.2, v * 3 - 7.4, 4, 2, 0.5) * rough * 0.15;
        d[y * n + x] += throwAmount * 0.5 * (1 - smoothstep(-width, width, s)) - throwAmount * 0.5 * (1 - smoothstep(-width, width, -s));
      }
    }
    return out.clamp(0, 1.4);
  },
};

export const FILTERS: FilterDef[] = [
  terraceDef,
  smoothDef,
  sharpenDef,
  levelsDef,
  detailDef,
  warpDef,
  clampDef,
  planationDef,
  reposeDef,
  amplifyDef,
  faultDef,
];

export const FILTER_MAP: Record<string, FilterDef> = Object.fromEntries(
  FILTERS.map((f) => [f.id, f]),
);
