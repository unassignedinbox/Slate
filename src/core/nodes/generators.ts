import { defineNode, type EvalCtx } from '../graph/types';
import { HEADER, NOISE, FRACTAL, shader } from '../shaders/lib';
import { t2 } from '../gl/GPU';
import type { Tex2D } from '../gl/GPU';

/** Rescale a field so its range fills [0,1]. Keeps erosion in a predictable band. */
export function autoLevel(ctx: EvalCtx, src: Tex2D, strength = 1): Tex2D {
  if (strength <= 0) return src;
  const [mn, mx] = ctx.gpu.minMax(src);
  if (mx - mn < 1e-5) return src;
  const out = ctx.alloc('R32F');
  ctx.gpu.pass({
    name: 'gen.level',
    frag: LEVEL_FRAG,
    uniforms: { uSrc: t2(src), uMin: mn, uMax: mx, uStrength: strength },
    target: out,
  });
  ctx.release(src);
  return out;
}

const LEVEL_FRAG = shader(HEADER, /* glsl */ `
uniform sampler2D uSrc; uniform float uMin, uMax, uStrength;
layout(location = 0) out vec4 o;
void main(){
  float v = texture(uSrc, vUV).r;
  float n = (v - uMin) / max(1e-6, uMax - uMin);
  o = vec4(mix(v, n, uStrength), 0.0, 0.0, 1.0);
}`);

// Shared post-chain: bias / gain / invert / clamp, applied inside each generator.
const POST = /* glsl */ `
uniform float uBias, uContrast;
uniform float uInvert;
float post(float v){
  v = saturate(v);
  // bias: shifts the midpoint without clipping (Schlick)
  float b = clamp(uBias, 0.001, 0.999);
  v = v / ((1.0 / b - 2.0) * (1.0 - v) + 1.0);
  // contrast around 0.5
  v = saturate((v - 0.5) * uContrast + 0.5);
  return mix(v, 1.0 - v, uInvert);
}
`;

const GEN_UNIFORMS = /* glsl */ `
uniform float uScale, uSeed, uRotation;
uniform vec2  uOffset;
uniform int   uOctaves;
vec2 genCoord(){
  vec2 p = (vUV - 0.5) * uScale;
  p = rot2(uRotation) * p + uOffset * uScale;
  return p;
}
`;

/** Only included alongside FRACTAL — keeping these out of GEN_UNIFORMS means a
 *  non-fractal generator never declares a uniform it does not bind. */
const FRACTAL_UNIFORMS = /* glsl */ `
uniform int   uBasis, uMode;
uniform float uLac, uGain, uH, uOffsetP, uWarp;
`;

const commonParams = (scale = 4) => [
  { id: 'scale', label: 'Scale', kind: 'float' as const, default: scale, min: 0.25, max: 64, step: 0.05, curve: 2, info: 'Feature repeats across the terrain.' },
  { id: 'offsetX', label: 'Offset X', kind: 'float' as const, default: 0, min: -8, max: 8, step: 0.001, group: 'Transform' },
  { id: 'offsetY', label: 'Offset Y', kind: 'float' as const, default: 0, min: -8, max: 8, step: 0.001, group: 'Transform' },
  { id: 'rotation', label: 'Rotation', kind: 'angle' as const, default: 0, min: -180, max: 180, step: 1, group: 'Transform' },
  { id: 'seed', label: 'Seed', kind: 'seed' as const, default: 0, group: 'Transform' },
  { id: 'bias', label: 'Bias', kind: 'float' as const, default: 0.5, min: 0.02, max: 0.98, step: 0.005, group: 'Levels' },
  { id: 'contrast', label: 'Contrast', kind: 'float' as const, default: 1, min: 0, max: 4, step: 0.01, group: 'Levels' },
  { id: 'invert', label: 'Invert', kind: 'bool' as const, default: false, group: 'Levels' },
  { id: 'autoLevel', label: 'Auto Level', kind: 'bool' as const, default: true, group: 'Levels', info: 'Rescale the result to fill 0–1.' },
];

function genUniforms(ctx: EvalCtx) {
  const p = ctx.p;
  return {
    uScale: p.scale,
    uOffset: [p.offsetX ?? 0, p.offsetY ?? 0],
    uRotation: ((p.rotation ?? 0) * Math.PI) / 180,
    uSeed: (p.seed ?? 0) + ctx.seed * 0.7351,
    uBias: p.bias ?? 0.5,
    uContrast: p.contrast ?? 1,
    uInvert: p.invert ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Simple single-basis noises
// ---------------------------------------------------------------------------

function simpleNoise(
  type: string,
  title: string,
  subtitle: string,
  basis: number,
  defaultScale: number,
  extra?: { params?: any[]; body?: string },
) {
  return defineNode({
    type,
    title,
    subtitle,
    category: 'generators',
    icon: 'sparkles',
    inputs: [],
    outputs: [{ id: 'out', label: 'Out', type: 'field' }],
    cost: 1,
    params: [
      { id: 'octaves', label: 'Octaves', kind: 'int', default: 6, min: 1, max: 16, step: 1 },
      { id: 'lacunarity', label: 'Lacunarity', kind: 'float', default: 2.0, min: 1.2, max: 4, step: 0.01 },
      { id: 'gain', label: 'Gain', kind: 'float', default: 0.5, min: 0.1, max: 0.9, step: 0.005 },
      ...(extra?.params ?? []),
      ...commonParams(defaultScale),
    ],
    evaluate(ctx) {
      const out = ctx.alloc('R32F');
      ctx.gpu.pass({
        name: `gen.${type}`,
        frag: shader(HEADER, NOISE, FRACTAL, GEN_UNIFORMS, FRACTAL_UNIFORMS, POST, extra?.body ?? SIMPLE_BODY),
        uniforms: {
          ...genUniforms(ctx),
          uLac: ctx.p.lacunarity,
          uGain: ctx.p.gain,
          uH: 1,
          uOffsetP: 1,
          uWarp: 0,
        },
        ints: { uOctaves: ctx.p.octaves, uBasis: basis, uMode: 0 },
        target: out,
      });
      return { out: ctx.p.autoLevel ? autoLevel(ctx, out) : out };
    },
  });
}

const SIMPLE_BODY = /* glsl */ `
layout(location = 0) out vec4 o;
void main(){
  float v = fractal2(genCoord(), uMode, uBasis, uOctaves, uLac, uGain, uH, uOffsetP, uWarp, uSeed);
  o = vec4(post(v * 0.5 + 0.5), 0.0, 0.0, 1.0);
}`;

export const PerlinNoise = simpleNoise('perlin', 'Perlin Noise', 'Classic gradient noise', 0, 4);
export const SimplexNoise = simpleNoise('simplex', 'Simplex Noise', 'Continuous 2D/3D noise', 1, 4);
export const ValueNoise = simpleNoise('value', 'Value Noise', 'Smooth interpolated noise', 2, 4);

export const CellularNoise = defineNode({
  type: 'cellular',
  title: 'Cellular (Voronoi)',
  subtitle: 'Distance-based cellular noise',
  category: 'generators',
  icon: 'sparkles',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  cost: 1,
  keywords: ['worley', 'voronoi', 'cell'],
  params: [
    {
      id: 'mode', label: 'Distance', kind: 'enum', default: 'f1',
      options: [
        { value: 'f1', label: 'F1 (cells)' },
        { value: 'f2f1', label: 'F2 − F1 (edges)' },
        { value: 'f2', label: 'F2' },
        { value: 'id', label: 'Cell ID (plates)' },
      ],
    },
    { id: 'jitter', label: 'Jitter', kind: 'float', default: 1, min: 0, max: 1, step: 0.01 },
    { id: 'octaves', label: 'Octaves', kind: 'int', default: 1, min: 1, max: 8, step: 1 },
    ...commonParams(8),
  ],
  evaluate(ctx) {
    const out = ctx.alloc('R32F');
    const modeIdx = { f1: 0, f2f1: 1, f2: 2, id: 3 }[ctx.p.mode as string] ?? 0;
    ctx.gpu.pass({
      name: 'gen.cellular',
      frag: shader(HEADER, NOISE, GEN_UNIFORMS, POST, /* glsl */ `
uniform float uJitter; uniform int uCellMode;
layout(location = 0) out vec4 o;
vec3 cell(vec2 p){
  vec2 ip = floor(p), fp = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){
    vec2 g = vec2(float(i), float(j));
    vec2 rnd = hash22(ip + g + uSeed);
    vec2 offs = mix(vec2(0.5), rnd, uJitter);
    float d = length(g + offs - fp);
    if (d < f1){ f2 = f1; f1 = d; id = hash12(ip + g + uSeed); }
    else if (d < f2) f2 = d;
  }
  return vec3(f1, f2, id);
}
void main(){
  vec2 p = genCoord();
  float amp = 1.0, freq = 1.0, sum = 0.0, norm = 0.0;
  for (int i=0;i<8;i++){
    if (i >= uOctaves) break;
    vec3 c = cell(p * freq);
    float v = uCellMode == 0 ? c.x
            : uCellMode == 1 ? (c.y - c.x)
            : uCellMode == 2 ? c.y
            : c.z;
    sum += v * amp; norm += amp;
    amp *= 0.5; freq *= 2.0;
  }
  o = vec4(post(sum / max(1e-6, norm)), 0.0, 0.0, 1.0);
}`),
      uniforms: { ...genUniforms(ctx), uJitter: ctx.p.jitter },
      ints: { uOctaves: ctx.p.octaves, uCellMode: modeIdx },
      target: out,
    });
    return { out: ctx.p.autoLevel ? autoLevel(ctx, out) : out };
  },
});

export const WhiteNoise = defineNode({
  type: 'white',
  title: 'White Noise',
  subtitle: 'Random static noise',
  category: 'generators',
  icon: 'sparkles',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  cost: 1,
  params: [
    { id: 'seed', label: 'Seed', kind: 'seed', default: 0 },
    { id: 'bias', label: 'Bias', kind: 'float', default: 0.5, min: 0.02, max: 0.98, step: 0.005, group: 'Levels' },
    { id: 'contrast', label: 'Contrast', kind: 'float', default: 1, min: 0, max: 4, step: 0.01, group: 'Levels' },
    { id: 'invert', label: 'Invert', kind: 'bool', default: false, group: 'Levels' },
  ],
  evaluate(ctx) {
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'gen.white',
      frag: shader(HEADER, NOISE, POST, /* glsl */ `
uniform float uSeed;
layout(location = 0) out vec4 o;
void main(){ o = vec4(post(hash12(floor(vUV * uRes) + uSeed * 17.0)), 0.0, 0.0, 1.0); }`),
      uniforms: {
        uSeed: (ctx.p.seed ?? 0) + ctx.seed * 0.7351,
        uBias: ctx.p.bias, uContrast: ctx.p.contrast, uInvert: ctx.p.invert ? 1 : 0,
      },
      target: out,
    });
    return { out };
  },
});

// ---------------------------------------------------------------------------
// MultiFractal — the workhorse terrain generator
// ---------------------------------------------------------------------------

export const MultiFractal = defineNode({
  type: 'multifractal',
  title: 'MultiFractal',
  subtitle: 'Complex ridged noise',
  category: 'generators',
  icon: 'sparkles',
  inputs: [{ id: 'warp', label: 'Warp', type: 'field', optional: true, info: 'Domain-warps the noise lookup.' }],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  cost: 2,
  keywords: ['musgrave', 'fbm', 'ridged', 'hybrid', 'mountain', 'terrain'],
  params: [
    {
      id: 'mode', label: 'Fractal', kind: 'enum', default: 'ridgedmf',
      options: [
        { value: 'fbm', label: 'fBm' },
        { value: 'billow', label: 'Billow' },
        { value: 'ridged', label: 'Ridged' },
        { value: 'hybrid', label: 'Hybrid Multifractal' },
        { value: 'ridgedmf', label: 'Ridged Multifractal' },
        { value: 'swiss', label: 'Swiss (damped)' },
        { value: 'jordan', label: 'Jordan Turbulence' },
      ],
      info: 'Ridged MF → badlands and spires. Hybrid MF → smooth valleys, rough peaks. Swiss → believable mountain mass.',
    },
    {
      id: 'basis', label: 'Basis', kind: 'enum', default: 'perlin',
      options: [
        { value: 'perlin', label: 'Perlin' },
        { value: 'simplex', label: 'Simplex' },
        { value: 'value', label: 'Value' },
        { value: 'worleyF1', label: 'Worley F1' },
        { value: 'worleyEdge', label: 'Worley Edge' },
      ],
    },
    { id: 'octaves', label: 'Octaves', kind: 'int', default: 9, min: 1, max: 20, step: 1 },
    { id: 'lacunarity', label: 'Lacunarity', kind: 'float', default: 2.03, min: 1.2, max: 4, step: 0.005 },
    { id: 'gain', label: 'Gain', kind: 'float', default: 0.52, min: 0.1, max: 0.95, step: 0.005 },
    { id: 'H', label: 'Roughness (H)', kind: 'float', default: 0.92, min: 0.1, max: 2, step: 0.005, info: 'Fractal dimension for the multifractal modes.' },
    { id: 'offsetP', label: 'Offset', kind: 'float', default: 0.9, min: 0, max: 2, step: 0.005, info: 'Musgrave offset — controls how sharp the ridges cut.' },
    { id: 'warpAmt', label: 'Self Warp', kind: 'float', default: 0.18, min: 0, max: 2, step: 0.005 },
    { id: 'warpInput', label: 'Input Warp', kind: 'float', default: 0.35, min: 0, max: 4, step: 0.01, when: () => true },
    ...commonParams(3.5),
  ],
  evaluate(ctx) {
    const out = ctx.alloc('R32F');
    const modeIdx = { fbm: 0, billow: 1, ridged: 2, hybrid: 3, ridgedmf: 4, swiss: 5, jordan: 6 }[ctx.p.mode as string] ?? 0;
    const basisIdx = { perlin: 0, simplex: 1, value: 2, worleyF1: 3, worleyEdge: 4 }[ctx.p.basis as string] ?? 0;
    const warp = ctx.input('warp');
    ctx.gpu.pass({
      name: 'gen.multifractal',
      frag: shader(HEADER, NOISE, FRACTAL, GEN_UNIFORMS, FRACTAL_UNIFORMS, POST, /* glsl */ `
uniform sampler2D uWarpTex; uniform float uHasWarp, uWarpInput;
layout(location = 0) out vec4 o;
void main(){
  vec2 p = genCoord();
  if (uHasWarp > 0.5){
    vec2 t = 1.0 / uRes;
    float c = texture(uWarpTex, vUV).r;
    float dx = texture(uWarpTex, vUV + vec2(t.x, 0.0)).r - texture(uWarpTex, vUV - vec2(t.x, 0.0)).r;
    float dy = texture(uWarpTex, vUV + vec2(0.0, t.y)).r - texture(uWarpTex, vUV - vec2(0.0, t.y)).r;
    p += (vec2(dx, dy) * uRes.x * 0.02 + (c - 0.5)) * uWarpInput;
  }
  float v = fractal2(p, uMode, uBasis, uOctaves, uLac, uGain, uH, uOffsetP, uWarp, uSeed);
  o = vec4(post(v * 0.5 + 0.5), 0.0, 0.0, 1.0);
}`),
      uniforms: {
        ...genUniforms(ctx),
        uLac: ctx.p.lacunarity,
        uGain: ctx.p.gain,
        uH: ctx.p.H,
        uOffsetP: ctx.p.offsetP,
        uWarp: ctx.p.warpAmt,
        uWarpTex: t2(warp),
        uHasWarp: warp ? 1 : 0,
        uWarpInput: ctx.p.warpInput,
      },
      ints: { uOctaves: ctx.p.octaves, uBasis: basisIdx, uMode: modeIdx },
      target: out,
    });
    return { out: ctx.p.autoLevel ? autoLevel(ctx, out) : out };
  },
});

// ---------------------------------------------------------------------------
// Ridged Badlands — stacked ridged MF + strata, the classic mesa/canyon start
// ---------------------------------------------------------------------------

export const RidgedBadlands = defineNode({
  type: 'badlands',
  title: 'Ridged Badlands',
  subtitle: 'Mesas, strata and canyon walls',
  category: 'generators',
  icon: 'sparkles',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  cost: 3,
  keywords: ['mesa', 'canyon', 'strata', 'desert', 'terrace'],
  params: [
    { id: 'octaves', label: 'Octaves', kind: 'int', default: 10, min: 2, max: 18, step: 1 },
    { id: 'sharpness', label: 'Ridge Sharpness', kind: 'float', default: 0.95, min: 0.3, max: 1.6, step: 0.005 },
    { id: 'warpAmt', label: 'Warp', kind: 'float', default: 0.45, min: 0, max: 2, step: 0.01 },
    { id: 'strata', label: 'Strata Count', kind: 'float', default: 14, min: 0, max: 64, step: 0.5, group: 'Stratification', info: '0 disables terracing.' },
    { id: 'strataHard', label: 'Strata Hardness', kind: 'float', default: 0.6, min: 0, max: 1, step: 0.01, group: 'Stratification' },
    { id: 'strataTilt', label: 'Strata Tilt', kind: 'float', default: 0.08, min: -1, max: 1, step: 0.005, group: 'Stratification' },
    { id: 'plateau', label: 'Plateau', kind: 'float', default: 0.35, min: 0, max: 1, step: 0.01, group: 'Stratification' },
    ...commonParams(3),
  ],
  evaluate(ctx) {
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'gen.badlands',
      frag: shader(HEADER, NOISE, FRACTAL, GEN_UNIFORMS, FRACTAL_UNIFORMS, POST, /* glsl */ `
uniform float uSharp, uStrata, uStrataHard, uStrataTilt, uPlateau;
layout(location = 0) out vec4 o;
void main(){
  vec2 p = genCoord();

  // large-scale mass so mesas sit on a believable plain
  float mass = fractal2(p * 0.35, 0, 0, 5, 2.0, 0.55, 1.0, 1.0, 0.0, uSeed + 9.0) * 0.5 + 0.5;

  // ridged multifractal body
  float r = fractal2(p, 4, 0, uOctaves, uLac, uGain, uH, uSharp, uWarp, uSeed);
  r = saturate(r);

  float v = mix(r, mass, 0.28);

  // Plateau: flatten the tops so mesas read as tables rather than cones
  v = mix(v, smoothstep(0.0, 1.0, pow(v, 0.55)), uPlateau);

  // Strata: quantise height with a tilt so bands read as sedimentary layers
  if (uStrata > 0.5){
    float tilt = (p.x * 0.5 + p.y * 0.3) * uStrataTilt;
    float s = (v + tilt) * uStrata;
    float f = fract(s);
    // soft step keeps the band edges crisp but not aliased
    float band = floor(s) + smoothstep(0.5 - 0.5 * (1.0 - uStrataHard) - 0.001,
                                       0.5 + 0.5 * (1.0 - uStrataHard) + 0.001, f);
    float terraced = band / uStrata - tilt;
    v = mix(v, terraced, uStrataHard);
  }

  o = vec4(post(v), 0.0, 0.0, 1.0);
}`),
      uniforms: {
        ...genUniforms(ctx),
        uLac: 2.07, uGain: 0.5, uH: 0.9,
        uWarp: ctx.p.warpAmt,
        uSharp: ctx.p.sharpness,
        uStrata: ctx.p.strata,
        uStrataHard: ctx.p.strataHard,
        uStrataTilt: ctx.p.strataTilt,
        uPlateau: ctx.p.plateau,
        uOffsetP: ctx.p.sharpness,
      },
      ints: { uOctaves: ctx.p.octaves, uBasis: 0, uMode: 4 },
      target: out,
    });
    return { out: ctx.p.autoLevel ? autoLevel(ctx, out) : out };
  },
});

// ---------------------------------------------------------------------------
// Mountain Range — ridge-line driven uplift, good erosion input
// ---------------------------------------------------------------------------

export const MountainRange = defineNode({
  type: 'mountain',
  title: 'Mountain Range',
  subtitle: 'Ridgeline uplift with flanks',
  category: 'generators',
  icon: 'sparkles',
  inputs: [{ id: 'mask', label: 'Mask', type: 'field', optional: true }],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  cost: 3,
  keywords: ['alps', 'peak', 'range', 'uplift'],
  params: [
    { id: 'ranges', label: 'Ranges', kind: 'float', default: 2.2, min: 0.5, max: 10, step: 0.05 },
    { id: 'ridgeWidth', label: 'Ridge Width', kind: 'float', default: 0.34, min: 0.05, max: 1, step: 0.005 },
    { id: 'flank', label: 'Flank Falloff', kind: 'float', default: 1.5, min: 0.3, max: 4, step: 0.01 },
    { id: 'detail', label: 'Detail', kind: 'float', default: 0.42, min: 0, max: 1, step: 0.005 },
    { id: 'octaves', label: 'Detail Octaves', kind: 'int', default: 9, min: 1, max: 16, step: 1 },
    { id: 'warpAmt', label: 'Warp', kind: 'float', default: 0.5, min: 0, max: 3, step: 0.01 },
    { id: 'peaks', label: 'Peak Variation', kind: 'float', default: 0.55, min: 0, max: 1, step: 0.01 },
    ...commonParams(2),
  ],
  evaluate(ctx) {
    const out = ctx.alloc('R32F');
    const mask = ctx.input('mask');
    ctx.gpu.pass({
      name: 'gen.mountain',
      frag: shader(HEADER, NOISE, FRACTAL, GEN_UNIFORMS, FRACTAL_UNIFORMS, POST, /* glsl */ `
uniform float uRanges, uRidgeWidth, uFlank, uDetail, uPeaks;
uniform sampler2D uMask; uniform float uHasMask;
layout(location = 0) out vec4 o;
void main(){
  vec2 p = genCoord();

  // Ridge skeleton: worley edges warped by low-frequency noise gives sinuous,
  // branching crest lines rather than blobby lumps.
  vec2 w = vec2(
    fractal2(p * 0.4 + 11.0, 0, 0, 4, 2.0, 0.5, 1.0, 1.0, 0.0, uSeed),
    fractal2(p * 0.4 - 7.0,  0, 0, 4, 2.0, 0.5, 1.0, 1.0, 0.0, uSeed + 3.0));
  vec2 q = p * uRanges + w * uWarp;

  vec3 c = worley2(q + uSeed * 13.0);
  float edge = c.y - c.x;                       // 0 on the crest, grows outward
  float crest = 1.0 - smoothstep(0.0, uRidgeWidth, edge);
  crest = pow(crest, uFlank);

  // per-cell peak height variation so not every summit is the same altitude
  float peakVar = mix(1.0, 0.45 + hash11(c.z * 91.7) * 0.9, uPeaks);
  float base = crest * peakVar;

  // fractal detail modulated by the ridge so valleys stay calmer than peaks
  float det = fractal2(p * 2.0, 4, 0, uOctaves, uLac, uGain, uH, 0.92, 0.25, uSeed + 21.0);
  base += det * uDetail * (0.25 + 0.75 * base);

  if (uHasMask > 0.5) base *= texture(uMask, vUV).r;

  o = vec4(post(base), 0.0, 0.0, 1.0);
}`),
      uniforms: {
        ...genUniforms(ctx),
        uLac: 2.05, uGain: 0.5, uH: 0.9, uOffsetP: 0.92,
        uWarp: ctx.p.warpAmt,
        uRanges: ctx.p.ranges,
        uRidgeWidth: ctx.p.ridgeWidth,
        uFlank: ctx.p.flank,
        uDetail: ctx.p.detail,
        uPeaks: ctx.p.peaks,
        uMask: t2(mask),
        uHasMask: mask ? 1 : 0,
      },
      ints: { uOctaves: ctx.p.octaves, uBasis: 0, uMode: 4 },
      target: out,
    });
    return { out: ctx.p.autoLevel ? autoLevel(ctx, out) : out };
  },
});

// ---------------------------------------------------------------------------
// Constant / Gradient — plumbing generators
// ---------------------------------------------------------------------------

export const Constant = defineNode({
  type: 'constant',
  title: 'Constant',
  subtitle: 'Uniform value',
  category: 'generators',
  icon: 'circle',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  cost: 0,
  params: [{ id: 'value', label: 'Value', kind: 'float', default: 0.5, min: -2, max: 2, step: 0.001 }],
  evaluate(ctx) {
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'gen.constant',
      frag: shader(HEADER, `uniform float uValue; layout(location=0) out vec4 o; void main(){ o = vec4(uValue,0.0,0.0,1.0); }`),
      uniforms: { uValue: ctx.p.value },
      target: out,
    });
    return { out };
  },
});

export const Gradient = defineNode({
  type: 'gradient',
  title: 'Gradient',
  subtitle: 'Linear / radial ramp',
  category: 'generators',
  icon: 'circle',
  inputs: [],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  cost: 0,
  params: [
    {
      id: 'mode', label: 'Mode', kind: 'enum', default: 'radial',
      options: [
        { value: 'linear', label: 'Linear' },
        { value: 'radial', label: 'Radial' },
        { value: 'box', label: 'Box' },
      ],
    },
    { id: 'angle', label: 'Angle', kind: 'angle', default: 0, min: -180, max: 180, step: 1, when: (p) => p.mode === 'linear' },
    { id: 'centerX', label: 'Center X', kind: 'float', default: 0, min: -1, max: 1, step: 0.005 },
    { id: 'centerY', label: 'Center Y', kind: 'float', default: 0, min: -1, max: 1, step: 0.005 },
    { id: 'inner', label: 'Inner', kind: 'float', default: 0.0, min: 0, max: 2, step: 0.005 },
    { id: 'outer', label: 'Outer', kind: 'float', default: 0.75, min: 0, max: 2, step: 0.005 },
    { id: 'falloff', label: 'Falloff', kind: 'float', default: 1.4, min: 0.2, max: 6, step: 0.01 },
    { id: 'invert', label: 'Invert', kind: 'bool', default: false },
  ],
  evaluate(ctx) {
    const out = ctx.alloc('R32F');
    const modeIdx = { linear: 0, radial: 1, box: 2 }[ctx.p.mode as string] ?? 1;
    ctx.gpu.pass({
      name: 'gen.gradient',
      frag: shader(HEADER, /* glsl */ `
uniform int uMode; uniform float uAngle, uInner, uOuter, uFalloff, uInvert;
uniform vec2 uCenter;
layout(location=0) out vec4 o;
void main(){
  vec2 p = (vUV - 0.5) * 2.0 - uCenter;
  float d;
  if (uMode == 0){ vec2 dir = vec2(cos(uAngle), sin(uAngle)); d = dot(p, dir) * 0.5 + 0.5; }
  else if (uMode == 1) d = length(p);
  else d = max(abs(p.x), abs(p.y));
  float v = 1.0 - clamp((d - uInner) / max(1e-4, uOuter - uInner), 0.0, 1.0);
  v = pow(v, uFalloff);
  o = vec4(mix(v, 1.0 - v, uInvert), 0.0, 0.0, 1.0);
}`),
      uniforms: {
        uAngle: ((ctx.p.angle ?? 0) * Math.PI) / 180,
        uCenter: [ctx.p.centerX, ctx.p.centerY],
        uInner: ctx.p.inner, uOuter: ctx.p.outer,
        uFalloff: ctx.p.falloff, uInvert: ctx.p.invert ? 1 : 0,
      },
      ints: { uMode: modeIdx },
      target: out,
    });
    return { out };
  },
});

// ---------------------------------------------------------------------------
// Tectonic Plates — large scale uplift field, feeds erosion nicely
// ---------------------------------------------------------------------------

export const TectonicPlates = defineNode({
  type: 'plates',
  title: 'Tectonic Plates',
  subtitle: 'Plate uplift and rifts',
  category: 'generators',
  icon: 'sparkles',
  inputs: [],
  outputs: [
    { id: 'out', label: 'Height', type: 'field' },
    { id: 'uplift', label: 'Uplift', type: 'field', info: 'Collision zones — drive erosion strength with this.' },
  ],
  cost: 2,
  keywords: ['continent', 'rift', 'plate', 'uplift'],
  params: [
    { id: 'plates', label: 'Plates', kind: 'float', default: 5, min: 2, max: 32, step: 0.5 },
    { id: 'drift', label: 'Drift', kind: 'float', default: 0.5, min: 0, max: 2, step: 0.01 },
    { id: 'collision', label: 'Collision Uplift', kind: 'float', default: 0.75, min: 0, max: 2, step: 0.01 },
    { id: 'rift', label: 'Rift Depth', kind: 'float', default: 0.3, min: 0, max: 1, step: 0.01 },
    { id: 'warpAmt', label: 'Boundary Warp', kind: 'float', default: 0.6, min: 0, max: 3, step: 0.01 },
    ...commonParams(1),
  ],
  evaluate(ctx) {
    const out = ctx.alloc('R32F');
    const uplift = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'gen.plates',
      frag: shader(HEADER, NOISE, FRACTAL, GEN_UNIFORMS, FRACTAL_UNIFORMS, POST, /* glsl */ `
uniform float uPlates, uDrift, uCollision, uRift;
layout(location=0) out vec4 oH;
layout(location=1) out vec4 oU;
void main(){
  vec2 p = genCoord();
  vec2 w = vec2(fractal2(p*0.6+5.0, 0,0,4,2.0,0.5,1.0,1.0,0.0,uSeed),
                fractal2(p*0.6-5.0, 0,0,4,2.0,0.5,1.0,1.0,0.0,uSeed+2.0));
  vec2 q = p * uPlates * 0.25 + w * uWarp;
  vec3 c = worley2(q + uSeed * 5.0);

  float boundary = 1.0 - smoothstep(0.0, 0.22, c.y - c.x);
  float plateH = hash11(c.z * 57.3) ;                    // continental vs oceanic
  float drift  = (hash11(c.z * 13.1) - 0.5) * 2.0 * uDrift;

  // Convergent boundaries (two "high" plates meeting) uplift; divergent rift.
  float conv = saturate(plateH + drift);
  float up = boundary * conv * uCollision;
  float rift = boundary * (1.0 - conv) * uRift;

  float base = mix(0.25, 0.75, plateH);
  float h = base + up - rift;
  h += fractal2(p * 4.0, 0, 0, 6, 2.0, 0.5, 1.0, 1.0, 0.0, uSeed + 31.0) * 0.06;

  oH = vec4(post(h), 0.0, 0.0, 1.0);
  oU = vec4(saturate(up), 0.0, 0.0, 1.0);
}`),
      uniforms: {
        ...genUniforms(ctx),
        uLac: 2.0, uGain: 0.5, uH: 1, uOffsetP: 1,
        uWarp: ctx.p.warpAmt,
        uPlates: ctx.p.plates,
        uDrift: ctx.p.drift,
        uCollision: ctx.p.collision,
        uRift: ctx.p.rift,
      },
      ints: { uOctaves: 6, uBasis: 0, uMode: 0 },
      target: [out, uplift],
    });
    return { out: ctx.p.autoLevel ? autoLevel(ctx, out) : out, uplift };
  },
});
