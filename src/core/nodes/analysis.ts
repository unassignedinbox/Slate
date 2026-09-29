import { defineNode } from '../graph/types';
import { HEADER, NOISE, FIELD, shader } from '../shaders/lib';
import { t2 } from '../gl/GPU';
import { blur, flowAccumulate } from './ops';

export const Slope = defineNode({
  type: 'slope',
  title: 'Slope',
  subtitle: 'Gradient steepness mask',
  category: 'analysis',
  icon: 'scan',
  cost: 1,
  keywords: ['angle', 'steep', 'gradient', 'cliff'],
  inputs: [{ id: 'in', label: 'Height', type: 'field' }],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  params: [
    { id: 'minAngle', label: 'From', kind: 'float', default: 0, min: 0, max: 90, step: 0.5, unit: '°' },
    { id: 'maxAngle', label: 'To', kind: 'float', default: 55, min: 0, max: 90, step: 0.5, unit: '°' },
    { id: 'falloff', label: 'Falloff', kind: 'float', default: 1, min: 0.1, max: 4, step: 0.01 },
    { id: 'smooth', label: 'Smooth', kind: 'float', default: 1, min: 0, max: 32, step: 0.25, unit: 'px' },
    { id: 'invert', label: 'Invert', kind: 'bool', default: false },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null };
    let out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'an.slope',
      frag: shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uH; uniform float uCell, uHeightScale, uMin, uMax, uFall, uInv;
layout(location=0) out vec4 o;
void main(){
  float s = slopeOf(uH, vUV, uHeightScale, uCell);
  float ang = atan(s);
  float v = clamp((ang - uMin) / max(1e-4, uMax - uMin), 0.0, 1.0);
  v = pow(v, uFall);
  o = vec4(mix(v, 1.0 - v, uInv), 0.0, 0.0, 1.0);
}`),
      uniforms: {
        uH: t2(src), uCell: ctx.cell, uHeightScale: ctx.heightScale,
        uMin: (ctx.p.minAngle * Math.PI) / 180, uMax: (ctx.p.maxAngle * Math.PI) / 180,
        uFall: ctx.p.falloff, uInv: ctx.p.invert ? 1 : 0,
      },
      target: out,
    });
    if (ctx.p.smooth > 0.01) out = blur(ctx, out, ctx.p.smooth);
    return { out };
  },
});

export const Curvature = defineNode({
  type: 'curvature',
  title: 'Curvature',
  subtitle: 'Convexity and concavity',
  category: 'analysis',
  icon: 'scan',
  cost: 1,
  keywords: ['cavity', 'ridge', 'valley', 'convex', 'concave'],
  inputs: [{ id: 'in', label: 'Height', type: 'field' }],
  outputs: [
    { id: 'out', label: 'Out', type: 'field' },
    { id: 'ridges', label: 'Ridges', type: 'field' },
    { id: 'valleys', label: 'Valleys', type: 'field' },
  ],
  params: [
    { id: 'radius', label: 'Radius', kind: 'float', default: 3, min: 1, max: 64, step: 0.5, unit: 'px' },
    { id: 'strength', label: 'Strength', kind: 'float', default: 1, min: 0.05, max: 20, step: 0.05 },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null, ridges: null, valleys: null };
    const smoothed = blur(ctx, src, ctx.p.radius, true);
    const out = ctx.alloc('R32F');
    const ridges = ctx.alloc('R32F');
    const valleys = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'an.curv',
      frag: shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uH, uS; uniform float uK;
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
layout(location=2) out vec4 o2;
void main(){
  float d = (fetch(uH, vUV) - fetch(uS, vUV)) * uK * 40.0;
  o0 = vec4(clamp(d * 0.5 + 0.5, 0.0, 1.0), 0.0, 0.0, 1.0);
  o1 = vec4(clamp( d, 0.0, 1.0), 0.0, 0.0, 1.0);
  o2 = vec4(clamp(-d, 0.0, 1.0), 0.0, 0.0, 1.0);
}`),
      uniforms: { uH: t2(src), uS: t2(smoothed), uK: ctx.p.strength },
      target: [out, ridges, valleys],
    });
    ctx.release(smoothed);
    return { out, ridges, valleys };
  },
});

export const AmbientOcclusion = defineNode({
  type: 'ao',
  title: 'Ambient Occlusion',
  subtitle: 'Horizon-scan cavity shading',
  category: 'analysis',
  icon: 'scan',
  cost: 6,
  keywords: ['occlusion', 'shadow', 'dirt', 'cavity'],
  inputs: [{ id: 'in', label: 'Height', type: 'field' }],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  params: [
    { id: 'radius', label: 'Radius', kind: 'float', default: 48, min: 2, max: 256, step: 1, unit: 'px' },
    { id: 'samples', label: 'Directions', kind: 'int', default: 12, min: 4, max: 32, step: 1 },
    { id: 'steps', label: 'Steps', kind: 'int', default: 10, min: 3, max: 32, step: 1 },
    { id: 'strength', label: 'Strength', kind: 'float', default: 1, min: 0, max: 3, step: 0.01 },
    { id: 'invert', label: 'Invert', kind: 'bool', default: false },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null };
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'an.ao',
      frag: shader(HEADER, NOISE, FIELD, /* glsl */ `
uniform sampler2D uH; uniform float uCell, uHeightScale, uRadius, uStrength, uInv;
uniform int uDirs, uSteps;
layout(location=0) out vec4 o;
void main(){
  float h = fetch(uH, vUV) * uHeightScale;
  float occ = 0.0;
  float jitter = hash12(vUV * uRes) * TAU;
  for (int d = 0; d < 32; d++){
    if (d >= uDirs) break;
    float a = jitter + float(d) / float(uDirs) * TAU;
    vec2 dir = vec2(cos(a), sin(a));
    float maxTan = 0.0;
    for (int s = 1; s <= 32; s++){
      if (s > uSteps) break;
      float t = uRadius * float(s) / float(uSteps);
      float hs = fetch(uH, vUV + dir * t * uTexel) * uHeightScale;
      maxTan = max(maxTan, (hs - h) / (t * uCell));
    }
    occ += maxTan / sqrt(1.0 + maxTan * maxTan);
  }
  occ /= float(uDirs);
  float v = clamp(1.0 - occ * uStrength, 0.0, 1.0);
  o = vec4(mix(v, 1.0 - v, uInv), 0.0, 0.0, 1.0);
}`),
      uniforms: {
        uH: t2(src), uCell: ctx.cell, uHeightScale: ctx.heightScale,
        uRadius: ctx.p.radius, uStrength: ctx.p.strength, uInv: ctx.p.invert ? 1 : 0,
      },
      ints: { uDirs: ctx.p.samples, uSteps: ctx.p.steps },
      target: out,
    });
    return { out };
  },
});

export const HeightSelect = defineNode({
  type: 'heightselect',
  title: 'Height Select',
  subtitle: 'Altitude band mask',
  category: 'analysis',
  icon: 'scan',
  cost: 1,
  keywords: ['band', 'altitude', 'range', 'mask'],
  inputs: [{ id: 'in', label: 'Height', type: 'field' }],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  params: [
    { id: 'center', label: 'Center', kind: 'float', default: 0.5, min: 0, max: 1, step: 0.002 },
    { id: 'width', label: 'Width', kind: 'float', default: 0.25, min: 0, max: 1, step: 0.002 },
    { id: 'falloff', label: 'Falloff', kind: 'float', default: 0.18, min: 0.001, max: 1, step: 0.002 },
    { id: 'noise', label: 'Edge Noise', kind: 'float', default: 0.06, min: 0, max: 0.5, step: 0.002 },
    { id: 'noiseScale', label: 'Noise Scale', kind: 'float', default: 12, min: 1, max: 96, step: 0.5 },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null };
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'an.heightselect',
      frag: shader(HEADER, NOISE, /* glsl */ `
uniform sampler2D uH; uniform float uC, uW, uF, uN, uNS, uSeed;
layout(location=0) out vec4 o;
void main(){
  float h = texture(uH, vUV).r;
  float n = (valueNoise2((vUV - 0.5) * uNS + uSeed) * 0.5 + 0.5 - 0.5) * uN;
  float d = abs(h + n - uC);
  o = vec4(1.0 - smoothstep(uW * 0.5, uW * 0.5 + uF, d), 0.0, 0.0, 1.0);
}`),
      uniforms: {
        uH: t2(src), uC: ctx.p.center, uW: ctx.p.width, uF: ctx.p.falloff,
        uN: ctx.p.noise, uNS: ctx.p.noiseScale, uSeed: ctx.seed * 0.29,
      },
      target: out,
    });
    return { out };
  },
});

export const FlowMap = defineNode({
  type: 'flowmap',
  title: 'Flow Map',
  subtitle: 'Drainage accumulation',
  category: 'analysis',
  icon: 'river',
  cost: 25,
  minRes: 256,
  keywords: ['accumulation', 'wetness', 'watershed', 'stream'],
  inputs: [
    { id: 'in', label: 'Height', type: 'field' },
    { id: 'rain', label: 'Rain', type: 'field', optional: true },
  ],
  outputs: [
    { id: 'out', label: 'Flow', type: 'field' },
    { id: 'wetness', label: 'Wetness', type: 'field' },
    { id: 'filled', label: 'Filled', type: 'field', info: 'Depression-filled surface.' },
  ],
  params: [
    { id: 'iterations', label: 'Routing Steps', kind: 'int', default: 150, min: 16, max: 640, step: 8 },
    { id: 'concentration', label: 'Concentration', kind: 'float', default: 1.5, min: 0.5, max: 6, step: 0.05 },
    { id: 'fillPits', label: 'Fill Pits', kind: 'bool', default: true },
    { id: 'wetSpread', label: 'Wetness Spread', kind: 'float', default: 6, min: 0, max: 48, step: 0.5, unit: 'px' },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null, wetness: null, filled: null };
    const r = flowAccumulate(ctx, src, {
      iterations: ctx.p.iterations,
      exponent: ctx.p.concentration,
      fillPits: ctx.p.fillPits,
      rain: ctx.input('rain'),
    });
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'an.flownorm',
      frag: shader(HEADER, `uniform sampler2D uA; uniform float uMaxLog; layout(location=0) out vec4 o;
        void main(){ o = vec4(clamp(log(max(1.0, texture(uA,vUV).r)) / uMaxLog, 0.0, 1.0), 0.0,0.0,1.0); }`),
      uniforms: { uA: t2(r.accum), uMaxLog: Math.log(ctx.res * ctx.res * 0.25) },
      target: out,
    });
    ctx.release(r.accum);
    const wetness = blur(ctx, out, ctx.p.wetSpread, true);
    return { out, wetness, filled: r.filled };
  },
});

export const Aspect = defineNode({
  type: 'aspect',
  title: 'Aspect',
  subtitle: 'Slope facing direction',
  category: 'analysis',
  icon: 'scan',
  cost: 1,
  keywords: ['direction', 'facing', 'sun', 'north'],
  inputs: [{ id: 'in', label: 'Height', type: 'field' }],
  outputs: [{ id: 'out', label: 'Out', type: 'field' }],
  params: [
    { id: 'direction', label: 'Direction', kind: 'angle', default: 0, min: -180, max: 180, step: 1 },
    { id: 'spread', label: 'Spread', kind: 'float', default: 1, min: 0.1, max: 6, step: 0.01 },
    { id: 'slopeWeight', label: 'Slope Weight', kind: 'float', default: 0.6, min: 0, max: 1, step: 0.01 },
  ],
  evaluate(ctx) {
    const src = ctx.input('in');
    if (!src) return { out: null };
    const a = (ctx.p.direction * Math.PI) / 180;
    const out = ctx.alloc('R32F');
    ctx.gpu.pass({
      name: 'an.aspect',
      frag: shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uH; uniform vec2 uDir; uniform float uCell, uHeightScale, uSpread, uSW;
layout(location=0) out vec4 o;
void main(){
  vec2 g = gradient(uH, vUV, uHeightScale, uCell);
  float len = length(g);
  vec2 dn = len > 1e-6 ? -g / len : vec2(0.0);
  float d = dot(dn, uDir) * 0.5 + 0.5;
  d = pow(clamp(d, 0.0, 1.0), uSpread);
  float w = mix(1.0, len / (1.0 + len), uSW);
  o = vec4(d * w, 0.0, 0.0, 1.0);
}`),
      uniforms: {
        uH: t2(src), uDir: [Math.cos(a), Math.sin(a)],
        uCell: ctx.cell, uHeightScale: ctx.heightScale,
        uSpread: ctx.p.spread, uSW: ctx.p.slopeWeight,
      },
      target: out,
    });
    return { out };
  },
});
