import { defineNode } from '../graph/types';
import { HEADER, NOISE, FRACTAL, shader } from '../shaders/lib';
import { t2 } from '../gl/GPU';
import { blur as blurOp, copy, normalize01 } from './ops';

const BLEND_MODES = [
  'mix', 'add', 'subtract', 'multiply', 'divide', 'screen', 'overlay',
  'softlight', 'hardlight', 'min', 'max', 'difference', 'exclusion',
];

export const Blend = defineNode({
  type: 'blend',
  title: 'Blend',
  subtitle: 'Combine two fields',
  category: 'shape',
  icon: 'layers',
  cost: 1,
  keywords: ['mix', 'combine', 'add', 'multiply', 'overlay'],
  inputs: [
    { id: 'a', label: 'A', type: 'field' },
    { id: 'b', label: 'B', type: 'field' },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
  ],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  params: [
    { id: 'mode', label: 'Mode', kind: 'enum', default: 'mix', options: BLEND_MODES.map((m) => ({ value: m, label: m[0].toUpperCase() + m.slice(1) })) },
    { id: 'opacity', label: 'Opacity', kind: 'float', default: 1, min: 0, max: 1, step: 0.01 },
    { id: 'clamp', label: 'Clamp', kind: 'bool', default: true },
  ],
  evaluate(ctx) {
    const a = ctx.input('a');
    const b = ctx.input('b');
    if (!a && !b) return { out: null };
    if (!a) return { out: copy(ctx, b!) };
    if (!b) return { out: copy(ctx, a) };
    const mask = ctx.input('mask');
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'shape.blend',
      frag: shader(HEADER, /* glsl */ `
uniform sampler2D uA, uB, uM; uniform float uHasM, uOpacity, uClamp; uniform int uMode;
layout(location=0) out vec4 o;
float blend(float a, float b, int m){
  if (m == 0)  return b;
  if (m == 1)  return a + b;
  if (m == 2)  return a - b;
  if (m == 3)  return a * b;
  if (m == 4)  return a / max(1e-4, b);
  if (m == 5)  return 1.0 - (1.0 - a) * (1.0 - b);
  if (m == 6)  return a < 0.5 ? 2.0*a*b : 1.0 - 2.0*(1.0-a)*(1.0-b);
  if (m == 7)  return (1.0 - 2.0*b) * a * a + 2.0 * b * a;
  if (m == 8)  return b < 0.5 ? 2.0*a*b : 1.0 - 2.0*(1.0-a)*(1.0-b);
  if (m == 9)  return min(a, b);
  if (m == 10) return max(a, b);
  if (m == 11) return abs(a - b);
  return a + b - 2.0 * a * b;
}
void main(){
  float a = texture(uA, vUV).r;
  float b = texture(uB, vUV).r;
  float t = uOpacity * (uHasM > 0.5 ? clamp(texture(uM, vUV).r, 0.0, 1.0) : 1.0);
  float v = mix(a, blend(a, b, uMode), t);
  o = vec4(uClamp > 0.5 ? clamp(v, 0.0, 1.0) : v, 0.0, 0.0, 1.0);
}`),
      uniforms: { uA: t2(a), uB: t2(b), uM: t2(mask), uHasM: mask ? 1 : 0, uOpacity: ctx.p.opacity, uClamp: ctx.p.clamp ? 1 : 0 },
      ints: { uMode: Math.max(0, BLEND_MODES.indexOf(ctx.p.mode)) },
      target: out,
    });
    return { out };
  },
});

const MATH_OPS = ['scaleOffset', 'invert', 'abs', 'power', 'sqrt', 'clamp', 'remap', 'quantize', 'threshold', 'smoothstep'];

export const MathNode = defineNode({
  type: 'math',
  title: 'Math',
  subtitle: 'Per-texel operations',
  category: 'shape',
  icon: 'sliders',
  cost: 1,
  keywords: ['invert', 'clamp', 'power', 'remap', 'levels'],
  inputs: [{ id: 'in', label: 'In', type: 'field' }],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  params: [
    {
      id: 'op', label: 'Operation', kind: 'enum', default: 'scaleOffset',
      options: [
        { value: 'scaleOffset', label: 'Scale + Offset' },
        { value: 'invert', label: 'Invert' },
        { value: 'abs', label: 'Absolute' },
        { value: 'power', label: 'Power' },
        { value: 'sqrt', label: 'Square Root' },
        { value: 'clamp', label: 'Clamp' },
        { value: 'remap', label: 'Remap' },
        { value: 'quantize', label: 'Quantize' },
        { value: 'threshold', label: 'Threshold' },
        { value: 'smoothstep', label: 'Smoothstep' },
      ],
    },
    { id: 'scale', label: 'Scale', kind: 'float', default: 1, min: -4, max: 4, step: 0.005 },
    { id: 'offset', label: 'Offset', kind: 'float', default: 0, min: -2, max: 2, step: 0.005 },
    { id: 'lo', label: 'Low', kind: 'float', default: 0, min: -2, max: 2, step: 0.005 },
    { id: 'hi', label: 'High', kind: 'float', default: 1, min: -2, max: 2, step: 0.005 },
    { id: 'steps', label: 'Steps', kind: 'float', default: 8, min: 2, max: 128, step: 1, when: (p) => p.op === 'quantize' },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null };
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'shape.math',
      frag: shader(HEADER, /* glsl */ `
uniform sampler2D uS; uniform int uOp; uniform float uScale, uOffset, uLo, uHi, uSteps;
layout(location=0) out vec4 o;
void main(){
  float v = texture(uS, vUV).r;
  if (uOp == 0) v = v * uScale + uOffset;
  else if (uOp == 1) v = 1.0 - v;
  else if (uOp == 2) v = abs(v);
  else if (uOp == 3) v = pow(max(0.0, v), max(0.001, uScale));
  else if (uOp == 4) v = sqrt(max(0.0, v));
  else if (uOp == 5) v = clamp(v, uLo, uHi);
  else if (uOp == 6) v = (v - uLo) / max(1e-5, uHi - uLo);
  else if (uOp == 7) v = floor(v * uSteps) / uSteps;
  else if (uOp == 8) v = step(uLo, v);
  else v = smoothstep(uLo, uHi, v);
  o = vec4(v, 0.0, 0.0, 1.0);
}`),
      uniforms: { uS: t2(src), uScale: ctx.p.scale, uOffset: ctx.p.offset, uLo: ctx.p.lo, uHi: ctx.p.hi, uSteps: ctx.p.steps },
      ints: { uOp: Math.max(0, MATH_OPS.indexOf(ctx.p.op)) },
      target: out,
    });
    return { out };
  },
});

export const Levels = defineNode({
  type: 'levels',
  title: 'Levels',
  subtitle: 'Contrast, bias and gamma',
  category: 'shape',
  icon: 'sliders',
  cost: 1,
  inputs: [{ id: 'in', label: 'In', type: 'field' }],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  params: [
    { id: 'inLow', label: 'Input Low', kind: 'float', default: 0, min: 0, max: 1, step: 0.002 },
    { id: 'inHigh', label: 'Input High', kind: 'float', default: 1, min: 0, max: 1, step: 0.002 },
    { id: 'gamma', label: 'Gamma', kind: 'float', default: 1, min: 0.1, max: 4, step: 0.01 },
    { id: 'outLow', label: 'Output Low', kind: 'float', default: 0, min: 0, max: 1, step: 0.002 },
    { id: 'outHigh', label: 'Output High', kind: 'float', default: 1, min: 0, max: 1, step: 0.002 },
    { id: 'autoLevel', label: 'Auto Level First', kind: 'bool', default: false },
  ],
  evaluate(ctx) {
    let src = ctx.input('in');
    if (!src) return { out: null };
    if (ctx.p.autoLevel) src = normalize01(ctx, copy(ctx, src));
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'shape.levels',
      frag: shader(HEADER, /* glsl */ `
uniform sampler2D uS; uniform float uIL, uIH, uG, uOL, uOH;
layout(location=0) out vec4 o;
void main(){
  float v = clamp((texture(uS, vUV).r - uIL) / max(1e-5, uIH - uIL), 0.0, 1.0);
  v = pow(v, 1.0 / max(0.01, uG));
  o = vec4(mix(uOL, uOH, v), 0.0, 0.0, 1.0);
}`),
      uniforms: { uS: t2(src), uIL: ctx.p.inLow, uIH: ctx.p.inHigh, uG: ctx.p.gamma, uOL: ctx.p.outLow, uOH: ctx.p.outHigh },
      target: out,
    });
    if (ctx.p.autoLevel) ctx.release(src);
    return { out };
  },
});

export const BlurNode = defineNode({
  type: 'blur',
  title: 'Blur',
  subtitle: 'Gaussian smoothing',
  category: 'shape',
  icon: 'sliders',
  cost: 2,
  inputs: [
    { id: 'in', label: 'In', type: 'field' },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
  ],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  params: [
    { id: 'radius', label: 'Radius', kind: 'float', default: 4, min: 0, max: 48, step: 0.25, unit: 'px' },
    { id: 'amount', label: 'Amount', kind: 'float', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null };
    const mask = ctx.input('mask');
    const b = blurOp(ctx, src, ctx.p.radius, true);
    if (!mask && ctx.p.amount >= 0.999) return { out: b };
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'shape.blurmix',
      frag: shader(HEADER, `uniform sampler2D uA,uB,uM; uniform float uT,uHasM; layout(location=0) out vec4 o;
        void main(){ float t = uT * (uHasM>0.5 ? clamp(texture(uM,vUV).r,0.0,1.0) : 1.0);
          o = vec4(mix(texture(uA,vUV).r, texture(uB,vUV).r, t),0.0,0.0,1.0); }`),
      uniforms: { uA: t2(src), uB: t2(b), uM: t2(mask), uHasM: mask ? 1 : 0, uT: ctx.p.amount },
      target: out,
    });
    ctx.release(b);
    return { out };
  },
});

export const Warp = defineNode({
  type: 'warp',
  title: 'Warp',
  subtitle: 'Domain distortion',
  category: 'shape',
  icon: 'layers',
  cost: 2,
  keywords: ['distort', 'displace', 'turbulence'],
  inputs: [
    { id: 'in', label: 'In', type: 'field' },
    { id: 'x', label: 'Warp X', type: 'field', optional: true },
    { id: 'y', label: 'Warp Y', type: 'field', optional: true },
  ],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  params: [
    { id: 'amount', label: 'Amount', kind: 'float', default: 24, min: 0, max: 256, step: 0.5, unit: 'px' },
    { id: 'noiseScale', label: 'Internal Scale', kind: 'float', default: 3, min: 0.2, max: 32, step: 0.05, info: 'Used when no warp inputs are connected.' },
    { id: 'octaves', label: 'Internal Octaves', kind: 'int', default: 4, min: 1, max: 10, step: 1 },
    { id: 'seed', label: 'Seed', kind: 'seed', default: 0 },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null };
    const wx = ctx.input('x');
    const wy = ctx.input('y');
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'shape.warp',
      frag: shader(HEADER, NOISE, FRACTAL, /* glsl */ `
uniform sampler2D uS, uX, uY; uniform float uHasX, uHasY, uAmt, uScale, uSeed; uniform int uOct;
layout(location=0) out vec4 o;
void main(){
  vec2 d;
  if (uHasX > 0.5 || uHasY > 0.5){
    float dx = uHasX > 0.5 ? texture(uX, vUV).r - 0.5 : 0.0;
    float dy = uHasY > 0.5 ? texture(uY, vUV).r - 0.5 : 0.0;
    d = vec2(dx, dy) * 2.0;
  } else {
    vec2 p = (vUV - 0.5) * uScale;
    d = vec2(fractal2(p + 3.1, 0, 0, uOct, 2.0, 0.5, 1.0, 1.0, 0.0, uSeed),
             fractal2(p - 5.7, 0, 0, uOct, 2.0, 0.5, 1.0, 1.0, 0.0, uSeed + 4.0));
  }
  vec2 uv = clamp(vUV + d * uAmt * uTexel, uTexel * 0.5, 1.0 - uTexel * 0.5);
  o = vec4(texture(uS, uv).r, 0.0, 0.0, 1.0);
}`),
      uniforms: {
        uS: t2(src), uX: t2(wx), uY: t2(wy), uHasX: wx ? 1 : 0, uHasY: wy ? 1 : 0,
        uAmt: ctx.p.amount, uScale: ctx.p.noiseScale, uSeed: ctx.p.seed + ctx.seed * 0.11,
      },
      ints: { uOct: ctx.p.octaves },
      target: out,
    });
    return { out };
  },
});

export const Transform = defineNode({
  type: 'transform',
  title: 'Transform',
  subtitle: 'Pan, scale and rotate',
  category: 'shape',
  icon: 'layers',
  cost: 1,
  inputs: [{ id: 'in', label: 'In', type: 'field' }],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  params: [
    { id: 'scale', label: 'Scale', kind: 'float', default: 1, min: 0.05, max: 8, step: 0.005 },
    { id: 'offsetX', label: 'Offset X', kind: 'float', default: 0, min: -2, max: 2, step: 0.002 },
    { id: 'offsetY', label: 'Offset Y', kind: 'float', default: 0, min: -2, max: 2, step: 0.002 },
    { id: 'rotation', label: 'Rotation', kind: 'angle', default: 0, min: -180, max: 180, step: 0.5 },
    { id: 'wrap', label: 'Edges', kind: 'enum', default: 'clamp', options: [{ value: 'clamp', label: 'Clamp' }, { value: 'repeat', label: 'Repeat' }, { value: 'mirror', label: 'Mirror' }] },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null };
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'shape.transform',
      frag: shader(HEADER, /* glsl */ `
uniform sampler2D uS; uniform float uScale, uRot; uniform vec2 uOff; uniform int uWrap;
layout(location=0) out vec4 o;
void main(){
  vec2 p = (vUV - 0.5) / max(1e-4, uScale);
  p = rot2(uRot) * p + uOff + 0.5;
  if (uWrap == 1) p = fract(p);
  else if (uWrap == 2){ p = abs(fract(p * 0.5) * 2.0 - 1.0); }
  else p = clamp(p, uTexel * 0.5, 1.0 - uTexel * 0.5);
  o = vec4(texture(uS, p).r, 0.0, 0.0, 1.0);
}`),
      uniforms: { uS: t2(src), uScale: ctx.p.scale, uRot: (ctx.p.rotation * Math.PI) / 180, uOff: [ctx.p.offsetX, ctx.p.offsetY] },
      ints: { uWrap: { clamp: 0, repeat: 1, mirror: 2 }[ctx.p.wrap as string] ?? 0 },
      target: out,
    });
    return { out };
  },
});

export const Terrace = defineNode({
  type: 'terrace',
  title: 'Terrace',
  subtitle: 'Sedimentary banding',
  category: 'shape',
  icon: 'layers',
  cost: 1,
  keywords: ['strata', 'step', 'bench', 'layer'],
  inputs: [
    { id: 'in', label: 'In', type: 'field' },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
  ],
  outputs: [
    { id: 'out', label: 'Out', type: 'field' },
    { id: 'bands', label: 'Bands', type: 'field', info: 'Alternating hard/soft banding — wire into Hardness on an erosion node.' },
  ],
  params: [
    { id: 'count', label: 'Layers', kind: 'float', default: 18, min: 2, max: 128, step: 0.5 },
    { id: 'hardness', label: 'Sharpness', kind: 'float', default: 0.65, min: 0, max: 1, step: 0.01 },
    { id: 'tilt', label: 'Tilt', kind: 'float', default: 0.05, min: -1, max: 1, step: 0.002 },
    { id: 'tiltAngle', label: 'Tilt Direction', kind: 'angle', default: 30, min: -180, max: 180, step: 1 },
    { id: 'irregular', label: 'Irregularity', kind: 'float', default: 0.25, min: 0, max: 1, step: 0.01 },
    { id: 'amount', label: 'Amount', kind: 'float', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null, bands: null };
    const mask = ctx.input('mask');
    const out = ctx.alloc('R32F');
    const bands = ctx.alloc('R32F');
    const a = (ctx.p.tiltAngle * Math.PI) / 180;
    ctx.gpu.pass({
      name: 'shape.terrace',
      frag: shader(HEADER, NOISE, FRACTAL, /* glsl */ `
uniform sampler2D uS, uM; uniform float uHasM, uCount, uHard, uTilt, uIrr, uAmt, uSeed;
uniform vec2 uDir;
layout(location=0) out vec4 oH;
layout(location=1) out vec4 oB;
void main(){
  float v = texture(uS, vUV).r;
  vec2 p = (vUV - 0.5);
  float tilt = dot(p, uDir) * uTilt;
  float wob = fractal2(p * 5.0, 0, 0, 4, 2.0, 0.5, 1.0, 1.0, 0.0, uSeed) * uIrr * 0.08;
  float s = (v + tilt + wob) * uCount;
  float f = fract(s);
  float e = max(0.001, 1.0 - uHard);
  float band = floor(s) + smoothstep(0.5 - e * 0.5, 0.5 + e * 0.5, f);
  float terraced = band / uCount - tilt - wob;
  float t = uAmt * (uHasM > 0.5 ? clamp(texture(uM, vUV).r, 0.0, 1.0) : 1.0);
  oH = vec4(mix(v, terraced, t), 0.0, 0.0, 1.0);
  // alternating strata hardness, offset so beds differ
  float idx = floor(s);
  oB = vec4(0.25 + 0.75 * hash11(idx * 3.71 + uSeed), 0.0, 0.0, 1.0);
}`),
      uniforms: {
        uS: t2(src), uM: t2(mask), uHasM: mask ? 1 : 0,
        uCount: ctx.p.count, uHard: ctx.p.hardness, uTilt: ctx.p.tilt,
        uIrr: ctx.p.irregular, uAmt: ctx.p.amount,
        uSeed: ctx.seed * 0.53, uDir: [Math.cos(a), Math.sin(a)],
      },
      target: [out, bands],
    });
    return { out, bands };
  },
});

export const Combine = defineNode({
  type: 'combine',
  title: 'Combine',
  subtitle: 'Min / max / average of two',
  category: 'shape',
  icon: 'layers',
  cost: 1,
  inputs: [
    { id: 'a', label: 'A', type: 'field' },
    { id: 'b', label: 'B', type: 'field' },
  ],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  params: [
    {
      id: 'mode', label: 'Mode', kind: 'enum', default: 'smoothmax',
      options: [
        { value: 'min', label: 'Min' },
        { value: 'max', label: 'Max' },
        { value: 'average', label: 'Average' },
        { value: 'smoothmin', label: 'Smooth Min' },
        { value: 'smoothmax', label: 'Smooth Max' },
      ],
    },
    { id: 'k', label: 'Smoothness', kind: 'float', default: 0.1, min: 0.001, max: 1, step: 0.002, when: (p) => p.mode.startsWith('smooth') },
  ],
  evaluate(ctx) {
    const a = ctx.input('a');
    const b = ctx.input('b');
    if (!a || !b) return { out: a ? copy(ctx, a) : b ? copy(ctx, b) : null };
    const out = ctx.alloc('R32F');
    const modes = ['min', 'max', 'average', 'smoothmin', 'smoothmax'];
    ctx.gpu.pass({
      name: 'shape.combine',
      frag: shader(HEADER, /* glsl */ `
uniform sampler2D uA, uB; uniform int uMode; uniform float uK;
layout(location=0) out vec4 o;
float smin(float a, float b, float k){ float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0); return mix(b, a, h) - k*h*(1.0-h); }
void main(){
  float a = texture(uA, vUV).r, b = texture(uB, vUV).r;
  float v;
  if (uMode == 0) v = min(a, b);
  else if (uMode == 1) v = max(a, b);
  else if (uMode == 2) v = (a + b) * 0.5;
  else if (uMode == 3) v = smin(a, b, uK);
  else v = -smin(-a, -b, uK);
  o = vec4(v, 0.0, 0.0, 1.0);
}`),
      uniforms: { uA: t2(a), uB: t2(b), uK: ctx.p.k },
      ints: { uMode: Math.max(0, modes.indexOf(ctx.p.mode)) },
      target: out,
    });
    return { out };
  },
});
