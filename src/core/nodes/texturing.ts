import { defineNode } from '../graph/types';
import { HEADER, NOISE, shader } from '../shaders/lib';
import { t2 } from '../gl/GPU';

// ---------------------------------------------------------------------------
// SatMap gradient library — the Gaea-style "drive a colour ramp with a field"
// ---------------------------------------------------------------------------

export type Stop = [number, string];

export interface SatMapPreset {
  id: string;
  name: string;
  group: string;
  stops: Stop[];
}

export const SATMAPS: SatMapPreset[] = [
  { id: 'rocky', name: 'Rocky Grey', group: 'Rock', stops: [[0, '#2b2b2e'], [0.25, '#4a4a4d'], [0.5, '#6d6b66'], [0.72, '#918d84'], [1, '#c8c5bd']] },
  { id: 'slate', name: 'Slate Blue', group: 'Rock', stops: [[0, '#1b2028'], [0.3, '#333d4a'], [0.6, '#5b6b7c'], [0.85, '#8b9aa8'], [1, '#d3dae0']] },
  { id: 'sandstone', name: 'Sandstone', group: 'Desert', stops: [[0, '#4a2f20'], [0.22, '#7a4a2c'], [0.45, '#a9703c'], [0.68, '#c99a5e'], [0.86, '#e0c08b'], [1, '#f3e3bf']] },
  { id: 'canyon', name: 'Canyon Red', group: 'Desert', stops: [[0, '#331611'], [0.2, '#5e2318'], [0.42, '#8d3a22'], [0.62, '#b55d33'], [0.82, '#d68f5b'], [1, '#efc79a']] },
  { id: 'dune', name: 'Dune', group: 'Desert', stops: [[0, '#7a5f36'], [0.35, '#b18f56'], [0.65, '#d9bd85'], [1, '#f2e2bb']] },
  { id: 'alpine', name: 'Alpine', group: 'Temperate', stops: [[0, '#2c3a29'], [0.28, '#45543a'], [0.5, '#6b6b59'], [0.68, '#8d8677'], [0.82, '#b9b4ab'], [1, '#ffffff']] },
  { id: 'verdant', name: 'Verdant', group: 'Temperate', stops: [[0, '#1e3320'], [0.24, '#2f5130'], [0.46, '#4e703c'], [0.66, '#7e8c54'], [0.84, '#a99d78'], [1, '#e2ded1']] },
  { id: 'moss', name: 'Moss Stone', group: 'Temperate', stops: [[0, '#23281f'], [0.3, '#3c4630'], [0.55, '#5c6347'], [0.78, '#87856c'], [1, '#bdb8a2']] },
  { id: 'tundra', name: 'Tundra', group: 'Cold', stops: [[0, '#3a3a38'], [0.28, '#585a52'], [0.5, '#7e8078'], [0.7, '#a9ada4'], [0.86, '#d5d8d4'], [1, '#ffffff']] },
  { id: 'glacier', name: 'Glacier', group: 'Cold', stops: [[0, '#1c2b38'], [0.3, '#32515f'], [0.55, '#6d92a1'], [0.78, '#a8c6d1'], [1, '#f0f8fb']] },
  { id: 'volcanic', name: 'Volcanic', group: 'Exotic', stops: [[0, '#0e0d0f'], [0.3, '#241f21'], [0.55, '#43342f'], [0.72, '#7a4331'], [0.88, '#c2612e'], [1, '#f5c15a']] },
  { id: 'mars', name: 'Mars', group: 'Exotic', stops: [[0, '#2e1408'], [0.26, '#5b2a13'], [0.5, '#8d4520'], [0.72, '#b3663a'], [1, '#d9a276']] },
  { id: 'abyss', name: 'Abyss', group: 'Exotic', stops: [[0, '#08101a'], [0.3, '#14283c'], [0.6, '#2b4f63'], [0.82, '#5c8a94'], [1, '#b9d8d6']] },
  { id: 'ash', name: 'Ash', group: 'Exotic', stops: [[0, '#101012'], [0.35, '#2a2a2d'], [0.65, '#55555a'], [0.85, '#8b8b90'], [1, '#d6d6da']] },
  { id: 'autumn', name: 'Autumn', group: 'Temperate', stops: [[0, '#2b1f14'], [0.25, '#553a1f'], [0.48, '#8a5a24'], [0.68, '#b5822f'], [0.85, '#cfa757'], [1, '#e9d8a6']] },
];

function hexToRgb(hex: string): [number, number, number] {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Build a 256px RGBA8 ramp. */
export function buildLUT(stops: Stop[], reverse: boolean, shift: number): Uint8Array {
  const data = new Uint8Array(256 * 4);
  const sorted = [...stops].sort((a, b) => a[0] - b[0]);
  for (let i = 0; i < 256; i++) {
    let t = i / 255;
    t = (t + shift) % 1;
    if (t < 0) t += 1;
    if (reverse) t = 1 - t;
    let a = sorted[0];
    let b = sorted[sorted.length - 1];
    for (let s = 0; s < sorted.length - 1; s++) {
      if (t >= sorted[s][0] && t <= sorted[s + 1][0]) { a = sorted[s]; b = sorted[s + 1]; break; }
    }
    const span = Math.max(1e-5, b[0] - a[0]);
    const f = Math.min(1, Math.max(0, (t - a[0]) / span));
    const ca = hexToRgb(a[1]);
    const cb = hexToRgb(b[1]);
    data[i * 4 + 0] = Math.round(ca[0] + (cb[0] - ca[0]) * f);
    data[i * 4 + 1] = Math.round(ca[1] + (cb[1] - ca[1]) * f);
    data[i * 4 + 2] = Math.round(ca[2] + (cb[2] - ca[2]) * f);
    data[i * 4 + 3] = 255;
  }
  return data;
}

export function lutCSS(stops: Stop[], reverse = false): string {
  const s = [...stops].sort((a, b) => a[0] - b[0]);
  const parts = (reverse ? s.map((x) => [1 - x[0], x[1]] as Stop) : s)
    .sort((a, b) => a[0] - b[0])
    .map(([t, c]) => `${c} ${(t * 100).toFixed(1)}%`);
  return `linear-gradient(90deg, ${parts.join(', ')})`;
}

export const SatMap = defineNode({
  type: 'satmap',
  title: 'SatMap',
  subtitle: 'Drive a colour ramp with a field',
  category: 'texturing',
  icon: 'palette',
  cost: 1,
  keywords: ['colour', 'color', 'gradient', 'ramp', 'texture', 'lut'],
  inputs: [
    { id: 'in', label: 'Driver', type: 'field', info: 'Usually height, but slope or flow gives very different reads.' },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
  ],
  outputs: [{ id: 'out', label: 'Colour', type: 'color' }],
  params: [
    { id: 'preset', label: 'Map', kind: 'enum', default: 'rocky', options: SATMAPS.map((s) => ({ value: s.id, label: `${s.name}` })) },
    { id: 'shift', label: 'Shift', kind: 'float', default: 0, min: 0, max: 1, step: 0.002 },
    { id: 'reverse', label: 'Reverse', kind: 'bool', default: false },
    { id: 'inLow', label: 'Input Low', kind: 'float', default: 0, min: 0, max: 1, step: 0.002, group: 'Range' },
    { id: 'inHigh', label: 'Input High', kind: 'float', default: 1, min: 0, max: 1, step: 0.002, group: 'Range' },
    { id: 'gamma', label: 'Gamma', kind: 'float', default: 1, min: 0.1, max: 4, step: 0.01, group: 'Range' },
    { id: 'saturation', label: 'Saturation', kind: 'float', default: 1, min: 0, max: 2.5, step: 0.01, group: 'Grade' },
    { id: 'brightness', label: 'Brightness', kind: 'float', default: 1, min: 0, max: 2.5, step: 0.01, group: 'Grade' },
    { id: 'variation', label: 'Variation', kind: 'float', default: 0.06, min: 0, max: 0.6, step: 0.002, group: 'Grade', info: 'Breaks up flat banding with fine noise.' },
    { id: 'variationScale', label: 'Variation Scale', kind: 'float', default: 48, min: 2, max: 400, step: 1, group: 'Grade' },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null };
    const mask = ctx.input('mask');
    const preset = SATMAPS.find((s) => s.id === ctx.p.preset) ?? SATMAPS[0];
    const key = `${preset.id}|${ctx.p.reverse}|${ctx.p.shift.toFixed(3)}`;
    const lut = ctx.gpu.lut(key, buildLUT(preset.stops, ctx.p.reverse, ctx.p.shift));

    const out = ctx.alloc('RGBA8');
    ctx.gpu.pass({
      name: 'tex.satmap',
      frag: shader(HEADER, NOISE, /* glsl */ `
uniform sampler2D uS, uLUT, uM;
uniform float uHasM, uIL, uIH, uG, uSat, uBri, uVar, uVarScale, uSeed;
layout(location=0) out vec4 o;
void main(){
  float v = clamp((texture(uS, vUV).r - uIL) / max(1e-5, uIH - uIL), 0.0, 1.0);
  v = pow(v, 1.0 / max(0.01, uG));
  if (uVar > 0.0){
    float n = valueNoise2((vUV - 0.5) * uVarScale + uSeed) * 0.5;
    n += valueNoise2((vUV - 0.5) * uVarScale * 3.1 - uSeed) * 0.25;
    v = clamp(v + n * uVar, 0.0, 1.0);
  }
  vec3 c = texture(uLUT, vec2(v, 0.5)).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat) * uBri;
  float a = uHasM > 0.5 ? clamp(texture(uM, vUV).r, 0.0, 1.0) : 1.0;
  o = vec4(clamp(c, 0.0, 1.0), a);
}`),
      uniforms: {
        uS: t2(src), uM: t2(mask), uHasM: mask ? 1 : 0,
        uLUT: { __texref: true as const, tex: lut, is3D: false },
        uIL: ctx.p.inLow, uIH: ctx.p.inHigh, uG: ctx.p.gamma,
        uSat: ctx.p.saturation, uBri: ctx.p.brightness,
        uVar: ctx.p.variation, uVarScale: ctx.p.variationScale, uSeed: ctx.seed * 0.91,
      },
      target: out,
    });
    return { out };
  },
});

export const ColorBlend = defineNode({
  type: 'colorblend',
  title: 'Colour Blend',
  subtitle: 'Layer two colour maps',
  category: 'texturing',
  icon: 'palette',
  cost: 1,
  keywords: ['layer', 'mix', 'composite'],
  inputs: [
    { id: 'base', label: 'Base', type: 'color' },
    { id: 'top', label: 'Top', type: 'color' },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
  ],
  outputs: [{ id: 'out', label: 'Colour', type: 'color' }],
  params: [
    {
      id: 'mode', label: 'Mode', kind: 'enum', default: 'over',
      options: [
        { value: 'over', label: 'Over' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'screen', label: 'Screen' },
        { value: 'overlay', label: 'Overlay' },
        { value: 'softlight', label: 'Soft Light' },
        { value: 'add', label: 'Add' },
      ],
    },
    { id: 'opacity', label: 'Opacity', kind: 'float', default: 1, min: 0, max: 1, step: 0.01 },
    { id: 'useTopAlpha', label: 'Use Top Alpha', kind: 'bool', default: true },
  ],
  evaluate(ctx) {
    const base = ctx.input('base');
    const top = ctx.input('top');
    if (!base) return { out: top ?? null };
    if (!top) return { out: base };
    const mask = ctx.input('mask');
    const modes = ['over', 'multiply', 'screen', 'overlay', 'softlight', 'add'];
    const out = ctx.alloc('RGBA8');
    ctx.gpu.pass({
      name: 'tex.colorblend',
      frag: shader(HEADER, /* glsl */ `
uniform sampler2D uA, uB, uM; uniform float uHasM, uOpacity, uUseAlpha; uniform int uMode;
layout(location=0) out vec4 o;
vec3 bl(vec3 a, vec3 b, int m){
  if (m == 1) return a * b;
  if (m == 2) return 1.0 - (1.0 - a) * (1.0 - b);
  if (m == 3) return mix(2.0*a*b, 1.0 - 2.0*(1.0-a)*(1.0-b), step(0.5, a));
  if (m == 4) return (1.0 - 2.0*b) * a * a + 2.0 * b * a;
  if (m == 5) return a + b;
  return b;
}
void main(){
  vec4 a = texture(uA, vUV);
  vec4 b = texture(uB, vUV);
  float t = uOpacity;
  if (uUseAlpha > 0.5) t *= b.a;
  if (uHasM > 0.5) t *= clamp(texture(uM, vUV).r, 0.0, 1.0);
  o = vec4(clamp(mix(a.rgb, bl(a.rgb, b.rgb, uMode), t), 0.0, 1.0), max(a.a, t));
}`),
      uniforms: { uA: t2(base), uB: t2(top), uM: t2(mask), uHasM: mask ? 1 : 0, uOpacity: ctx.p.opacity, uUseAlpha: ctx.p.useTopAlpha ? 1 : 0 },
      ints: { uMode: Math.max(0, modes.indexOf(ctx.p.mode)) },
      target: out,
    });
    return { out };
  },
});

export const Tint = defineNode({
  type: 'tint',
  title: 'Tint',
  subtitle: 'Solid colour through a mask',
  category: 'texturing',
  icon: 'palette',
  cost: 1,
  inputs: [{ id: 'mask', label: 'Mask', type: 'field', optional: true }],
  outputs: [{ id: 'out', label: 'Colour', type: 'color' }],
  params: [
    { id: 'r', label: 'Red', kind: 'float', default: 0.55, min: 0, max: 1, step: 0.002 },
    { id: 'g', label: 'Green', kind: 'float', default: 0.52, min: 0, max: 1, step: 0.002 },
    { id: 'b', label: 'Blue', kind: 'float', default: 0.46, min: 0, max: 1, step: 0.002 },
    { id: 'variation', label: 'Variation', kind: 'float', default: 0.05, min: 0, max: 0.5, step: 0.002 },
    { id: 'variationScale', label: 'Variation Scale', kind: 'float', default: 64, min: 2, max: 400, step: 1 },
  ],
  evaluate(ctx) {
    const mask = ctx.input('mask');
    const out = ctx.alloc('RGBA8');
    ctx.gpu.pass({
      name: 'tex.tint',
      frag: shader(HEADER, NOISE, /* glsl */ `
uniform sampler2D uM; uniform float uHasM, uVar, uVarScale, uSeed; uniform vec3 uColor;
layout(location=0) out vec4 o;
void main(){
  float n = uVar > 0.0 ? (valueNoise2((vUV - 0.5) * uVarScale + uSeed) * 0.5) * uVar : 0.0;
  vec3 c = clamp(uColor + n, 0.0, 1.0);
  float a = uHasM > 0.5 ? clamp(texture(uM, vUV).r, 0.0, 1.0) : 1.0;
  o = vec4(c, a);
}`),
      uniforms: {
        uM: t2(mask), uHasM: mask ? 1 : 0,
        uColor: [ctx.p.r, ctx.p.g, ctx.p.b],
        uVar: ctx.p.variation, uVarScale: ctx.p.variationScale, uSeed: ctx.seed * 0.37,
      },
      target: out,
    });
    return { out };
  },
});
