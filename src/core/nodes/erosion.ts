/**
 * Erosion nodes.
 *
 * Everything here works in METRES, not texels. `cell = worldSize / resolution`
 * converts, and every rate/threshold parameter is a physical quantity (m/s,
 * degrees of repose, metres of incision). That is what makes the result
 * resolution-independent: raising the build resolution adds finer detail to the
 * same landform instead of changing it — and it is why erosion refuses to run
 * below `minRes`, where there simply are not enough texels to carve into and the
 * output would be a blurred smear.
 */
import { defineNode, type EvalCtx } from '../graph/types';
import { HEADER, NOISE, FIELD, shader } from '../shaders/lib';
import { t2 } from '../gl/GPU';
import type { Tex2D } from '../gl/GPU';
import { blur, copy, fill, flowAccumulate, normalize01 } from './ops';

/** Stable-ish explicit timestep from the cell size (CFL with a 10 m/s reference). */
function timeStep(cell: number) {
  return Math.min(0.25, Math.max(0.012, (0.35 * cell) / 10));
}

function heightIn(ctx: EvalCtx, id = 'height'): Tex2D | null {
  return ctx.input(id);
}

function requireRes(ctx: EvalCtx, min: number, what: string) {
  if (ctx.res < min) {
    ctx.warn(
      `${what} needs at least ${min}² to hold detail — building at ${ctx.res}². ` +
        `Raise Build Resolution or the result will read as a blur.`,
    );
  }
}

// ===========================================================================
// Hydraulic erosion — virtual pipes (Mešt'ák/Mei et al. shallow water)
// ===========================================================================

const HYD_INIT = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uH, uHard; uniform float uHasHard, uHeightScale;
layout(location=0) out vec4 o;
void main(){
  float h = texture(uH, vUV).r * uHeightScale;
  float hard = uHasHard > 0.5 ? clamp(texture(uHard, vUV).r, 0.0, 1.0) : 0.5;
  o = vec4(h, 0.0, 0.0, hard);
}`);

const HYD_FLUX = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uS, uF;
uniform float uDt, uCell, uG, uPipe;
layout(location=0) out vec4 oF;
void main(){
  vec4 s  = fetch4(uS, vUV);
  vec4 f  = fetch4(uF, vUV);
  vec4 sL = fetch4O(uS, vUV, vec2(-1, 0));
  vec4 sR = fetch4O(uS, vUV, vec2( 1, 0));
  vec4 sT = fetch4O(uS, vUV, vec2( 0, 1));
  vec4 sB = fetch4O(uS, vUV, vec2( 0,-1));
  float bd = s.x + s.y;
  float k = uDt * uPipe * uCell * uG;     // A = uPipe * cell^2, divided by cell
  vec4 nf;
  nf.x = max(0.0, f.x + k * (bd - (sL.x + sL.y)));
  nf.y = max(0.0, f.y + k * (bd - (sR.x + sR.y)));
  nf.z = max(0.0, f.z + k * (bd - (sT.x + sT.y)));
  nf.w = max(0.0, f.w + k * (bd - (sB.x + sB.y)));
  float total = nf.x + nf.y + nf.z + nf.w;
  // never move more water than the cell actually holds
  float K = min(1.0, s.y * uCell * uCell / max(1e-9, total * uDt));
  oF = nf * K;
}`);

const HYD_WATER = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uS, uF; uniform float uDt, uCell;
layout(location=0) out vec4 oS;
layout(location=1) out vec4 oV;
void main(){
  vec4 s = fetch4(uS, vUV);
  vec4 f = fetch4(uF, vUV);
  float inL = fetch4O(uF, vUV, vec2(-1, 0)).y;
  float inR = fetch4O(uF, vUV, vec2( 1, 0)).x;
  float inT = fetch4O(uF, vUV, vec2( 0, 1)).w;
  float inB = fetch4O(uF, vUV, vec2( 0,-1)).z;
  float dV  = uDt * ((inL + inR + inT + inB) - (f.x + f.y + f.z + f.w));
  float d1 = s.y;
  float d2 = max(0.0, d1 + dV / (uCell * uCell));
  float dAvg = max(2e-3, 0.5 * (d1 + d2));
  float vx = 0.5 * (inL - f.x + f.y - inR) / (uCell * dAvg);
  float vy = 0.5 * (inB - f.w + f.z - inT) / (uCell * dAvg);
  oS = vec4(s.x, d2, s.z, s.w);
  oV = vec4(vx, vy, dAvg, 0.0);
}`);

const HYD_ERODE = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uS, uV, uA;
uniform float uDt, uCell, uKc, uKs, uKd, uMinSlope, uHardInfl, uDepthRef, uMaxRate;
layout(location=0) out vec4 oS;
layout(location=1) out vec4 oA;
void main(){
  vec4 s = fetch4(uS, vUV);
  vec4 v = fetch4(uV, vUV);
  vec4 a = fetch4(uA, vUV);

  float l  = fetch4O(uS, vUV, vec2(-1, 0)).x;
  float r  = fetch4O(uS, vUV, vec2( 1, 0)).x;
  float dn = fetch4O(uS, vUV, vec2( 0,-1)).x;
  float up = fetch4O(uS, vUV, vec2( 0, 1)).x;
  vec2 g = vec2(r - l, up - dn) / (2.0 * uCell);
  float slope = length(g);
  float sinT = max(uMinSlope, slope / sqrt(1.0 + slope * slope));

  float speed = length(v.xy);
  // shallow sheets barely carry anything; standing lakes carry nothing.
  float depthK = smoothstep(0.0, uDepthRef, s.y) * (1.0 - smoothstep(uDepthRef * 12.0, uDepthRef * 40.0, s.y));
  float C = uKc * sinT * speed * depthK;

  // Differential erodibility. This is the cliff-maker: alternating hard and
  // soft bands retreat at different rates and leave benched escarpments.
  float resist = mix(1.0, 0.18 + 1.9 * s.w, uHardInfl);

  float b = s.x, sed = s.z, wear = 0.0, dep = 0.0;
  if (C > sed){
    float amt = min(uKs * (C - sed) * uDt / resist, uMaxRate * uDt);
    b -= amt; sed += amt; wear = amt;
  } else {
    float amt = min(uKd * (sed - C) * uDt, uMaxRate * uDt);
    b += amt; sed -= amt; dep = amt;
  }
  oS = vec4(b, s.y, max(0.0, sed), s.w);
  oA = vec4(max(a.x, speed * s.y), a.y + wear, a.z + dep, max(a.w, s.y));
}`);

const HYD_ADVECT = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uS, uV, uRain;
uniform float uDt, uCell, uKe, uRainAmt, uHasRain, uOpenBoundary;
layout(location=0) out vec4 oS;
void main(){
  vec4 s = fetch4(uS, vUV);
  vec4 v = fetch4(uV, vUV);
  vec2 prev = vUV - v.xy * uDt * uTexel / uCell;
  float sed = fetch4(uS, prev).z;
  float d = s.y * max(0.0, 1.0 - uKe * uDt);
  float rf = uHasRain > 0.5 ? max(0.0, texture(uRain, vUV).r) : 1.0;
  d += uRainAmt * rf * uDt;
  if (uOpenBoundary > 0.5){
    vec2 e = uTexel * 1.5;
    if (vUV.x < e.x || vUV.y < e.y || vUV.x > 1.0 - e.x || vUV.y > 1.0 - e.y){ d = 0.0; sed = 0.0; }
  }
  oS = vec4(s.x, d, max(0.0, sed), s.w);
}`);

const EXTRACT = shader(HEADER, /* glsl */ `
uniform sampler2D uS; uniform float uHeightScale; uniform int uChan;
layout(location=0) out vec4 o;
void main(){
  vec4 s = texture(uS, vUV);
  float v = uChan == 0 ? s.x : uChan == 1 ? s.y : uChan == 2 ? s.z : s.w;
  o = vec4(v / uHeightScale, 0.0, 0.0, 1.0);
}`);

function extract(ctx: EvalCtx, src: Tex2D, chan: number, divide = 1): Tex2D {
  const out = ctx.alloc('R32F');
  ctx.gpu.pass({
    name: 'ero.extract',
    frag: EXTRACT,
    uniforms: { uS: t2(src), uHeightScale: divide },
    ints: { uChan: chan },
    target: out,
  });
  return out;
}

export const HydraulicErosion = defineNode({
  type: 'hydraulic',
  title: 'Hydraulic Erosion',
  subtitle: 'Shallow-water pipe model',
  category: 'erosion',
  icon: 'droplet',
  minRes: 512,
  cost: 30,
  keywords: ['water', 'rain', 'fluvial', 'valley', 'sediment'],
  inputs: [
    { id: 'height', label: 'Height', type: 'field' },
    { id: 'rain', label: 'Rain', type: 'field', optional: true, info: 'Per-cell rainfall multiplier.' },
    { id: 'hardness', label: 'Hardness', type: 'field', optional: true, info: '0 = soft, 1 = hard. Drives differential erosion and benched cliffs.' },
  ],
  outputs: [
    { id: 'out', label: 'Height', type: 'field' },
    { id: 'flow', label: 'Flow', type: 'field' },
    { id: 'wear', label: 'Wear', type: 'field' },
    { id: 'deposits', label: 'Deposits', type: 'field' },
    { id: 'water', label: 'Water', type: 'field' },
  ],
  params: [
    { id: 'iterations', label: 'Iterations', kind: 'int', default: 140, min: 10, max: 600, step: 5, info: 'Simulation steps. More = deeper, more mature drainage.' },
    { id: 'rainfall', label: 'Rainfall', kind: 'float', default: 0.35, min: 0, max: 3, step: 0.005, unit: 'm/s' },
    { id: 'evaporation', label: 'Evaporation', kind: 'float', default: 0.035, min: 0, max: 0.5, step: 0.001 },
    { id: 'capacity', label: 'Carry Capacity', kind: 'float', default: 1.15, min: 0, max: 5, step: 0.01, info: 'How much sediment moving water can hold.' },
    { id: 'dissolve', label: 'Dissolve Rate', kind: 'float', default: 0.55, min: 0, max: 3, step: 0.01 },
    { id: 'deposition', label: 'Deposition Rate', kind: 'float', default: 0.75, min: 0, max: 3, step: 0.01 },
    { id: 'hardInfluence', label: 'Hardness Influence', kind: 'float', default: 1, min: 0, max: 1, step: 0.01, group: 'Advanced' },
    { id: 'minSlope', label: 'Min Slope', kind: 'float', default: 0.02, min: 0.0, max: 0.4, step: 0.001, group: 'Advanced', info: 'Stops flats from becoming perfectly inert.' },
    { id: 'depthRef', label: 'Active Depth', kind: 'float', default: 0.06, min: 0.005, max: 1, step: 0.005, unit: 'm', group: 'Advanced' },
    { id: 'pipe', label: 'Pipe Area', kind: 'float', default: 1.0, min: 0.1, max: 4, step: 0.01, group: 'Advanced' },
    { id: 'maxRate', label: 'Max Rate', kind: 'float', default: 0.9, min: 0.05, max: 8, step: 0.01, unit: 'm/s', group: 'Advanced', info: 'Clamp per-step height change — keeps the sim stable.' },
    { id: 'openBoundary', label: 'Open Boundary', kind: 'bool', default: true, group: 'Advanced', info: 'Let water drain off the tile edges.' },
    { id: 'amount', label: 'Amount', kind: 'float', default: 1, min: 0, max: 1, step: 0.01, info: 'Blend the eroded result back over the input.' },
  ],
  evaluate(ctx) {
    const h = heightIn(ctx);
    if (!h) return { out: null, flow: null, wear: null, deposits: null, water: null };
    requireRes(ctx, 512, 'Hydraulic erosion');

    const gpu = ctx.gpu;
    const p = ctx.p;
    const dt = timeStep(ctx.cell);
    const hard = ctx.input('hardness');
    const rain = ctx.input('rain');

    let S = ctx.alloc('RGBA32F');
    let S2 = ctx.alloc('RGBA32F');
    let F = fill(ctx, 0, 'RGBA32F');
    let F2 = ctx.alloc('RGBA32F');
    const V = ctx.alloc('RGBA32F');
    let A = fill(ctx, 0, 'RGBA32F');
    let A2 = ctx.alloc('RGBA32F');

    gpu.pass({
      name: 'ero.hyd.init',
      frag: HYD_INIT,
      uniforms: { uH: t2(h), uHard: t2(hard), uHasHard: hard ? 1 : 0, uHeightScale: ctx.heightScale },
      target: S,
    });

    const base = {
      uDt: dt, uCell: ctx.cell, uG: 9.81, uPipe: p.pipe,
    };
    const n = p.iterations | 0;
    for (let i = 0; i < n; i++) {
      gpu.pass({ name: 'ero.hyd.flux', frag: HYD_FLUX, uniforms: { ...base, uS: t2(S), uF: t2(F) }, target: F2 });
      [F, F2] = [F2, F];

      gpu.pass({ name: 'ero.hyd.water', frag: HYD_WATER, uniforms: { ...base, uS: t2(S), uF: t2(F) }, target: [S2, V] });
      [S, S2] = [S2, S];

      gpu.pass({
        name: 'ero.hyd.erode',
        frag: HYD_ERODE,
        uniforms: {
          ...base,
          uS: t2(S), uV: t2(V), uA: t2(A),
          uKc: p.capacity * 0.05,
          uKs: p.dissolve,
          uKd: p.deposition,
          uMinSlope: p.minSlope,
          uHardInfl: p.hardInfluence,
          uDepthRef: p.depthRef,
          uMaxRate: p.maxRate,
        },
        target: [S2, A2],
      });
      [S, S2] = [S2, S];
      [A, A2] = [A2, A];

      gpu.pass({
        name: 'ero.hyd.advect',
        frag: HYD_ADVECT,
        uniforms: {
          ...base,
          uS: t2(S), uV: t2(V),
          uRain: t2(rain), uHasRain: rain ? 1 : 0,
          uKe: p.evaporation, uRainAmt: p.rainfall,
          uOpenBoundary: p.openBoundary ? 1 : 0,
        },
        target: S2,
      });
      [S, S2] = [S2, S];

      if ((i & 7) === 0) {
        ctx.tick(i / n);
        if (ctx.aborted()) break;
      }
    }

    let out = extract(ctx, S, 0, ctx.heightScale);
    const water = extract(ctx, S, 1, 1);

    if (p.amount < 0.999) {
      const mixed = ctx.alloc('R32F');
      gpu.pass({
        name: 'ero.mix',
        frag: shader(HEADER, `uniform sampler2D uA,uB; uniform float uT; layout(location=0) out vec4 o;
          void main(){ o = vec4(mix(texture(uA,vUV).r, texture(uB,vUV).r, uT), 0.0,0.0,1.0); }`),
        uniforms: { uA: t2(h), uB: t2(out), uT: p.amount },
        target: mixed,
      });
      ctx.release(out);
      out = mixed;
    }

    const flow = normalize01(ctx, extract(ctx, A, 0, 1));
    const wear = normalize01(ctx, extract(ctx, A, 1, 1));
    const deposits = normalize01(ctx, extract(ctx, A, 2, 1));

    ctx.release(S); ctx.release(S2);
    ctx.release(F); ctx.release(F2); ctx.release(V);
    ctx.release(A); ctx.release(A2);

    return { out, flow, wear, deposits, water };
  },
});

// ===========================================================================
// Thermal erosion / talus — the cliff + scree machine
// ===========================================================================

const THERM_FLOW = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uH, uHard; uniform float uHasHard;
uniform float uTanTalus, uCell, uRate, uHeightScale, uHardInfl, uNoise, uSeed;
layout(location=0) out vec4 o1;   // L  R  T  B
layout(location=1) out vec4 o2;   // TL TR BL BR
void main(){
  float h = fetch(uH, vUV) * uHeightScale;
  float hard = uHasHard > 0.5 ? clamp(texture(uHard, vUV).r, 0.0, 1.0) : 0.5;
  // Harder rock stands at a steeper angle of repose before it collapses.
  float stand = mix(1.0, 0.45 + 1.55 * hard, uHardInfl);
  float jitter = 1.0 + (hash12(vUV * uRes + uSeed) - 0.5) * uNoise;
  float tS = uTanTalus * stand * jitter * uCell;
  float tD = tS * 1.41421356;

  float d[8];
  d[0] = h - fetchO(uH, vUV, vec2(-1, 0)) * uHeightScale - tS;
  d[1] = h - fetchO(uH, vUV, vec2( 1, 0)) * uHeightScale - tS;
  d[2] = h - fetchO(uH, vUV, vec2( 0, 1)) * uHeightScale - tS;
  d[3] = h - fetchO(uH, vUV, vec2( 0,-1)) * uHeightScale - tS;
  d[4] = h - fetchO(uH, vUV, vec2(-1, 1)) * uHeightScale - tD;
  d[5] = h - fetchO(uH, vUV, vec2( 1, 1)) * uHeightScale - tD;
  d[6] = h - fetchO(uH, vUV, vec2(-1,-1)) * uHeightScale - tD;
  d[7] = h - fetchO(uH, vUV, vec2( 1,-1)) * uHeightScale - tD;

  float total = 0.0, mx = 0.0;
  for (int i = 0; i < 8; i++){ d[i] = max(0.0, d[i]); total += d[i]; mx = max(mx, d[i]); }
  if (total <= 0.0){ o1 = vec4(0.0); o2 = vec4(0.0); return; }
  float move = uRate * mx * 0.5;
  float k = move / total;
  o1 = vec4(d[0], d[1], d[2], d[3]) * k;
  o2 = vec4(d[4], d[5], d[6], d[7]) * k;
}`);

const THERM_GATHER = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uH, uO1, uO2, uAcc; uniform float uHeightScale;
layout(location=0) out vec4 oH;
layout(location=1) out vec4 oAcc;
void main(){
  float h = fetch(uH, vUV) * uHeightScale;
  vec4 a = fetch4(uO1, vUV), b = fetch4(uO2, vUV);
  float outflow = a.x + a.y + a.z + a.w + b.x + b.y + b.z + b.w;
  float inflow = 0.0;
  inflow += fetch4O(uO1, vUV, vec2(-1, 0)).y;
  inflow += fetch4O(uO1, vUV, vec2( 1, 0)).x;
  inflow += fetch4O(uO1, vUV, vec2( 0, 1)).w;
  inflow += fetch4O(uO1, vUV, vec2( 0,-1)).z;
  inflow += fetch4O(uO2, vUV, vec2(-1, 1)).w;
  inflow += fetch4O(uO2, vUV, vec2( 1, 1)).z;
  inflow += fetch4O(uO2, vUV, vec2(-1,-1)).y;
  inflow += fetch4O(uO2, vUV, vec2( 1,-1)).x;
  oH = vec4((h - outflow + inflow) / uHeightScale, 0.0, 0.0, 1.0);
  vec2 acc = fetch4(uAcc, vUV).xy;
  oAcc = vec4(acc.x + inflow, acc.y + outflow, 0.0, 1.0);
}`);

export const ThermalErosion = defineNode({
  type: 'thermal',
  title: 'Thermal Erosion',
  subtitle: 'Talus collapse and scree',
  category: 'erosion',
  icon: 'droplet',
  minRes: 256,
  cost: 12,
  keywords: ['talus', 'scree', 'repose', 'cliff', 'debris', 'slump'],
  inputs: [
    { id: 'height', label: 'Height', type: 'field' },
    { id: 'hardness', label: 'Hardness', type: 'field', optional: true },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
  ],
  outputs: [
    { id: 'out', label: 'Height', type: 'field' },
    { id: 'scree', label: 'Scree', type: 'field', info: 'Where debris piled up — perfect satmap mask for talus.' },
    { id: 'wear', label: 'Wear', type: 'field' },
  ],
  params: [
    { id: 'iterations', label: 'Iterations', kind: 'int', default: 60, min: 1, max: 400, step: 1 },
    {
      id: 'angle', label: 'Angle of Repose', kind: 'float', default: 42, min: 5, max: 85, step: 0.5, unit: '°',
      info: 'Slopes steeper than this collapse. High values (65–80°) preserve cliff faces and only shed the overhanging lip.',
    },
    { id: 'rate', label: 'Rate', kind: 'float', default: 0.6, min: 0.01, max: 1, step: 0.01 },
    { id: 'hardInfluence', label: 'Hardness Influence', kind: 'float', default: 0.8, min: 0, max: 1, step: 0.01 },
    { id: 'variance', label: 'Angle Variance', kind: 'float', default: 0.12, min: 0, max: 1, step: 0.01, info: 'Breaks up perfectly uniform talus planes.' },
    { id: 'amount', label: 'Amount', kind: 'float', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  evaluate(ctx) {
    const h = heightIn(ctx);
    if (!h) return { out: null, scree: null, wear: null };
    const gpu = ctx.gpu;
    const p = ctx.p;
    const hard = ctx.input('hardness');
    const mask = ctx.input('mask');

    let H = copy(ctx, h);
    let H2 = ctx.alloc('R32F');
    const o1 = ctx.alloc('RGBA32F');
    const o2 = ctx.alloc('RGBA32F');
    let acc = fill(ctx, 0, 'RGBA32F');
    let acc2 = ctx.alloc('RGBA32F');

    const tanTalus = Math.tan((p.angle * Math.PI) / 180);
    const n = p.iterations | 0;
    for (let i = 0; i < n; i++) {
      gpu.pass({
        name: 'ero.therm.flow',
        frag: THERM_FLOW,
        uniforms: {
          uH: t2(H), uHard: t2(hard), uHasHard: hard ? 1 : 0,
          uTanTalus: tanTalus, uCell: ctx.cell, uRate: p.rate,
          uHeightScale: ctx.heightScale, uHardInfl: p.hardInfluence,
          uNoise: p.variance, uSeed: ctx.seed * 0.317,
        },
        target: [o1, o2],
      });
      gpu.pass({
        name: 'ero.therm.gather',
        frag: THERM_GATHER,
        uniforms: { uH: t2(H), uO1: t2(o1), uO2: t2(o2), uAcc: t2(acc), uHeightScale: ctx.heightScale },
        target: [H2, acc2],
      });
      [H, H2] = [H2, H];
      [acc, acc2] = [acc2, acc];
      if ((i & 7) === 0) { ctx.tick(i / n); if (ctx.aborted()) break; }
    }

    let out = H;
    if (mask || p.amount < 0.999) {
      const mixed = ctx.alloc('R32F');
      gpu.pass({
        name: 'ero.therm.mix',
        frag: shader(HEADER, `uniform sampler2D uA,uB,uM; uniform float uT,uHasM; layout(location=0) out vec4 o;
          void main(){ float t = uT * (uHasM > 0.5 ? clamp(texture(uM,vUV).r,0.0,1.0) : 1.0);
            o = vec4(mix(texture(uA,vUV).r, texture(uB,vUV).r, t), 0.0,0.0,1.0); }`),
        uniforms: { uA: t2(h), uB: t2(out), uM: t2(mask), uHasM: mask ? 1 : 0, uT: p.amount },
        target: mixed,
      });
      ctx.release(out);
      out = mixed;
    }

    const scree = normalize01(ctx, extract(ctx, acc, 0, 1));
    const wear = normalize01(ctx, extract(ctx, acc, 1, 1));

    ctx.release(H2); ctx.release(o1); ctx.release(o2);
    ctx.release(acc); ctx.release(acc2);
    return { out, scree, wear };
  },
});

// ===========================================================================
// Wind / aeolian erosion — yardangs, polish, lee-side dunes
// ===========================================================================

const WIND_ERODE = shader(HEADER, NOISE, FIELD, /* glsl */ `
uniform sampler2D uH, uSand, uMask;
uniform vec2 uWind;
uniform float uCell, uHeightScale, uDt, uAbrasion, uPickup, uShelterTan,
              uStep, uHasMask, uSeed;
layout(location=0) out vec4 oH;
layout(location=1) out vec4 oS;
void main(){
  float h = fetch(uH, vUV) * uHeightScale;
  float sand = fetch(uSand, vUV);

  // Wind shadow: look upwind and find the largest blocking angle.
  float block = 0.0;
  for (int i = 1; i <= 12; i++){
    float t = float(i) * uStep;
    vec2 uv = vUV - uWind * t * uTexel;
    float hs = fetch(uH, uv) * uHeightScale;
    block = max(block, (hs - h) / max(1e-4, t * uCell));
  }
  float shelter = saturate(block / max(1e-3, uShelterTan));
  float exposure = 1.0 - shelter;

  vec2 g = gradient(uH, vUV, uHeightScale, uCell);
  // windward faces rise in the direction the wind travels
  float facing = saturate(dot(g, uWind) / (1.0 + length(g)));

  float m = uHasMask > 0.5 ? clamp(texture(uMask, vUV).r, 0.0, 1.0) : 1.0;

  // Abrasion strips material from exposed windward faces; the amount of sand
  // already in the air is the abrasive, so it is self-limiting.
  float abrade = uAbrasion * exposure * facing * (0.25 + sand) * uDt * m;
  float pick   = uPickup  * exposure * (0.35 + 0.65 * (1.0 - facing)) * uDt * m;

  h -= (abrade + pick);
  sand += (abrade + pick);

  oH = vec4(h / uHeightScale, 0.0, 0.0, 1.0);
  oS = vec4(sand, exposure, shelter, 0.0);
}`);

const WIND_DEPOSIT = shader(HEADER, NOISE, FIELD, /* glsl */ `
uniform sampler2D uH, uSand;
uniform vec2 uWind;
uniform float uCell, uHeightScale, uDt, uDeposit, uDrift, uRipple, uRippleScale, uSeed;
layout(location=0) out vec4 oH;
layout(location=1) out vec4 oS;
layout(location=2) out vec4 oD;
void main(){
  // advect airborne sand downwind
  vec2 prev = vUV - uWind * uDrift * uDt * uTexel;
  vec4 sp = fetch4(uSand, prev);
  float sand = sp.x;
  vec4 here = fetch4(uSand, vUV);
  float shelter = here.z;

  float h = fetch(uH, vUV) * uHeightScale;

  // Transverse ripples: a banded pattern perpendicular to the wind direction.
  vec2 perp = vec2(-uWind.y, uWind.x);
  vec2 wp = (vUV - 0.5) * uRippleScale;
  float ripple = sin(dot(wp, uWind) * 24.0 + valueNoise2(wp * 3.0 + uSeed) * 6.0) * 0.5 + 0.5;
  ripple = mix(1.0, ripple, uRipple);

  float drop = uDeposit * sand * shelter * ripple * uDt;
  drop = min(drop, sand);
  h += drop;
  sand -= drop;

  oH = vec4(h / uHeightScale, 0.0, 0.0, 1.0);
  oS = vec4(max(0.0, sand), here.y, shelter, 0.0);
  oD = vec4(drop, 0.0, 0.0, 1.0);
}`);

export const WindErosion = defineNode({
  type: 'wind',
  title: 'Wind Erosion',
  subtitle: 'Aeolian abrasion and dunes',
  category: 'erosion',
  icon: 'wind',
  minRes: 512,
  cost: 14,
  keywords: ['aeolian', 'sand', 'dune', 'desert', 'yardang', 'polish'],
  inputs: [
    { id: 'height', label: 'Height', type: 'field' },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
  ],
  outputs: [
    { id: 'out', label: 'Height', type: 'field' },
    { id: 'sand', label: 'Sand', type: 'field' },
    { id: 'exposure', label: 'Exposure', type: 'field' },
  ],
  params: [
    { id: 'iterations', label: 'Iterations', kind: 'int', default: 55, min: 1, max: 400, step: 1 },
    { id: 'direction', label: 'Direction', kind: 'angle', default: 35, min: -180, max: 180, step: 1, unit: '°' },
    { id: 'abrasion', label: 'Abrasion', kind: 'float', default: 0.5, min: 0, max: 4, step: 0.01, info: 'Sand-blasting of exposed windward faces.' },
    { id: 'pickup', label: 'Pickup', kind: 'float', default: 0.35, min: 0, max: 4, step: 0.01 },
    { id: 'deposit', label: 'Deposition', kind: 'float', default: 0.6, min: 0, max: 4, step: 0.01 },
    { id: 'drift', label: 'Drift Distance', kind: 'float', default: 9, min: 0.5, max: 60, step: 0.5, info: 'Texels of travel per step before sand settles.' },
    { id: 'shelter', label: 'Shelter Angle', kind: 'float', default: 22, min: 2, max: 80, step: 0.5, unit: '°' },
    { id: 'reach', label: 'Shadow Reach', kind: 'float', default: 6, min: 1, max: 40, step: 0.5, group: 'Advanced' },
    { id: 'ripple', label: 'Ripples', kind: 'float', default: 0.35, min: 0, max: 1, step: 0.01, group: 'Advanced' },
    { id: 'rippleScale', label: 'Ripple Scale', kind: 'float', default: 8, min: 1, max: 64, step: 0.5, group: 'Advanced' },
    { id: 'amount', label: 'Amount', kind: 'float', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  evaluate(ctx) {
    const h = heightIn(ctx);
    if (!h) return { out: null, sand: null, exposure: null };
    requireRes(ctx, 512, 'Wind erosion');
    const gpu = ctx.gpu;
    const p = ctx.p;
    const mask = ctx.input('mask');
    const a = (p.direction * Math.PI) / 180;
    const wind = [Math.cos(a), Math.sin(a)];

    let H = copy(ctx, h);
    let H2 = ctx.alloc('R32F');
    let S = fill(ctx, 0, 'RGBA32F');
    let S2 = ctx.alloc('RGBA32F');
    const D = ctx.alloc('R32F');
    const dt = 1.0;

    const n = p.iterations | 0;
    for (let i = 0; i < n; i++) {
      gpu.pass({
        name: 'ero.wind.erode',
        frag: WIND_ERODE,
        uniforms: {
          uH: t2(H), uSand: t2(S), uMask: t2(mask), uHasMask: mask ? 1 : 0,
          uWind: wind, uCell: ctx.cell, uHeightScale: ctx.heightScale, uDt: dt,
          uAbrasion: p.abrasion * 0.02, uPickup: p.pickup * 0.012,
          uShelterTan: Math.tan((p.shelter * Math.PI) / 180),
          uStep: p.reach / 12, uSeed: ctx.seed * 0.71,
        },
        target: [H2, S2],
      });
      [H, H2] = [H2, H];
      [S, S2] = [S2, S];

      gpu.pass({
        name: 'ero.wind.deposit',
        frag: WIND_DEPOSIT,
        uniforms: {
          uH: t2(H), uSand: t2(S), uWind: wind, uCell: ctx.cell,
          uHeightScale: ctx.heightScale, uDt: dt,
          uDeposit: p.deposit * 0.06, uDrift: p.drift,
          uRipple: p.ripple, uRippleScale: p.rippleScale, uSeed: ctx.seed * 1.37,
        },
        target: [H2, S2, D],
      });
      [H, H2] = [H2, H];
      [S, S2] = [S2, S];
      if ((i & 7) === 0) { ctx.tick(i / n); if (ctx.aborted()) break; }
    }

    let out = H;
    if (p.amount < 0.999) {
      const mixed = ctx.alloc('R32F');
      gpu.pass({
        name: 'ero.mix2',
        frag: shader(HEADER, `uniform sampler2D uA,uB; uniform float uT; layout(location=0) out vec4 o;
          void main(){ o = vec4(mix(texture(uA,vUV).r, texture(uB,vUV).r, uT),0.0,0.0,1.0); }`),
        uniforms: { uA: t2(h), uB: t2(out), uT: p.amount },
        target: mixed,
      });
      ctx.release(out); out = mixed;
    }

    const sand = normalize01(ctx, extract(ctx, S, 0, 1));
    const exposure = extract(ctx, S, 1, 1);
    ctx.release(H2); ctx.release(S); ctx.release(S2); ctx.release(D);
    return { out, sand, exposure };
  },
});

// ===========================================================================
// Rivers — stream-power incision + explicit channel carving
// ===========================================================================

const INCISE = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uH, uA, uMask;
uniform float uCell, uHeightScale, uK, uM, uN, uAref, uMaxCut, uHasMask, uBaseLevel;
layout(location=0) out vec4 o;
void main(){
  float h = fetch(uH, vUV);
  float hm = h * uHeightScale;
  float a = max(1.0, texture(uA, vUV).r) / uAref;
  float s = slopeOf(uH, vUV, uHeightScale, uCell);
  // detachment-limited stream power:  dz/dt = -K * A^m * S^n
  float cut = uK * pow(a, uM) * pow(max(0.0, s), uN);
  cut = min(cut, uMaxCut);
  if (uHasMask > 0.5) cut *= clamp(texture(uMask, vUV).r, 0.0, 1.0);
  // never incise below the base level (sea / valley floor)
  float floorM = uBaseLevel * uHeightScale;
  hm = max(floorM, hm - cut);
  o = vec4(hm / uHeightScale, 0.0, 0.0, 1.0);
}`);

const CARVE = shader(HEADER, NOISE, FIELD, /* glsl */ `
uniform sampler2D uH, uRiver, uWide;
uniform float uHeightScale, uDepth, uBankSlope, uProfile;
layout(location=0) out vec4 oH;
layout(location=1) out vec4 oW;
void main(){
  float h = fetch(uH, vUV) * uHeightScale;
  float core = clamp(texture(uRiver, vUV).r, 0.0, 1.0);
  float wide = clamp(texture(uWide, vUV).r, 0.0, 1.0);
  // a wide, soft shoulder plus a narrow deep thalweg reads as a real channel
  float bed = uDepth * (pow(core, uProfile) * 0.75 + wide * uBankSlope * 0.45);
  float nh = h - bed;
  oH = vec4(nh / uHeightScale, 0.0, 0.0, 1.0);
  // water surface sits a little above the carved bed inside the channel
  float surf = nh + uDepth * 0.45 * smoothstep(0.02, 0.35, core);
  oW = vec4(mix(-1e4, surf, step(0.02, wide)) / uHeightScale, core, wide, 1.0);
}`);

export const Rivers = defineNode({
  type: 'rivers',
  title: 'Rivers',
  subtitle: 'Drainage network and channels',
  category: 'erosion',
  icon: 'river',
  minRes: 512,
  cost: 40,
  keywords: ['stream', 'power', 'channel', 'drainage', 'fluvial', 'water'],
  inputs: [
    { id: 'height', label: 'Height', type: 'field' },
    { id: 'rain', label: 'Rain', type: 'field', optional: true },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
  ],
  outputs: [
    { id: 'out', label: 'Height', type: 'field' },
    { id: 'rivers', label: 'Rivers', type: 'field', info: 'Channel mask — wire this into a SatMap for wet rock and gravel bars.' },
    { id: 'flow', label: 'Flow', type: 'field' },
    { id: 'water', label: 'Water', type: 'field', info: 'Water surface height. Feeds the viewport river shading.' },
  ],
  params: [
    { id: 'passes', label: 'Passes', kind: 'int', default: 2, min: 1, max: 6, step: 1, info: 'Each pass recomputes drainage — more passes let valleys reorganise.' },
    { id: 'accumIters', label: 'Routing Steps', kind: 'int', default: 160, min: 32, max: 640, step: 8, info: 'Flow information travels one texel per step.' },
    { id: 'fillPits', label: 'Fill Pits', kind: 'bool', default: true, info: 'Required for connected rivers. Off = broken puddles.' },
    { id: 'concentration', label: 'Concentration', kind: 'float', default: 1.6, min: 0.5, max: 6, step: 0.05, info: 'Slope exponent. Higher = fewer, sharper channels.' },
    { id: 'incision', label: 'Incision', kind: 'float', default: 0.55, min: 0, max: 4, step: 0.01, unit: 'm', info: 'Stream-power valley cutting.' },
    { id: 'mExp', label: 'Area Exponent (m)', kind: 'float', default: 0.5, min: 0.1, max: 1.2, step: 0.01, group: 'Stream Power' },
    { id: 'nExp', label: 'Slope Exponent (n)', kind: 'float', default: 1.0, min: 0.3, max: 2.5, step: 0.01, group: 'Stream Power' },
    { id: 'inciseIters', label: 'Incision Steps', kind: 'int', default: 24, min: 1, max: 120, step: 1, group: 'Stream Power' },
    { id: 'threshold', label: 'Channel Threshold', kind: 'float', default: 0.42, min: 0.05, max: 0.95, step: 0.005, group: 'Channel', info: 'Where accumulation becomes a visible river.' },
    { id: 'softness', label: 'Bank Softness', kind: 'float', default: 0.12, min: 0.005, max: 0.6, step: 0.005, group: 'Channel' },
    { id: 'depth', label: 'Channel Depth', kind: 'float', default: 24, min: 0, max: 220, step: 0.5, unit: 'm', group: 'Channel' },
    { id: 'width', label: 'Channel Width', kind: 'float', default: 4, min: 0, max: 40, step: 0.25, group: 'Channel', info: 'Blur radius of the valley shoulder, in texels.' },
    { id: 'profile', label: 'Bed Profile', kind: 'float', default: 0.75, min: 0.2, max: 4, step: 0.01, group: 'Channel' },
    { id: 'baseLevel', label: 'Base Level', kind: 'float', default: 0.02, min: 0, max: 1, step: 0.005, group: 'Channel', info: 'Rivers will not cut below this height.' },
  ],
  evaluate(ctx) {
    const src = heightIn(ctx);
    if (!src) return { out: null, rivers: null, flow: null, water: null };
    requireRes(ctx, 512, 'River routing');

    const gpu = ctx.gpu;
    const p = ctx.p;
    const rain = ctx.input('rain');
    const mask = ctx.input('mask');
    const Aref = ctx.res * 0.25;

    let H = copy(ctx, src);
    let accum: Tex2D | null = null;
    let filled: Tex2D | null = null;

    const passes = p.passes | 0;
    for (let pass = 0; pass < passes; pass++) {
      if (accum) { ctx.release(accum); accum = null; }
      if (filled) { ctx.release(filled); filled = null; }
      const r = flowAccumulate(ctx, H, {
        iterations: p.accumIters,
        exponent: p.concentration,
        fillPits: p.fillPits,
        fillIterations: Math.max(48, Math.round(ctx.res * 0.25)),
        rain,
      });
      accum = r.accum;
      filled = r.filled;

      if (p.incision > 0) {
        let H2 = ctx.alloc('R32F');
        for (let i = 0; i < (p.inciseIters | 0); i++) {
          gpu.pass({
            name: 'ero.incise',
            frag: INCISE,
            uniforms: {
              uH: t2(H), uA: t2(accum), uMask: t2(mask), uHasMask: mask ? 1 : 0,
              uCell: ctx.cell, uHeightScale: ctx.heightScale,
              uK: p.incision, uM: p.mExp, uN: p.nExp, uAref: Aref,
              uMaxCut: ctx.heightScale * 0.02, uBaseLevel: p.baseLevel,
            },
            target: H2,
          });
          [H, H2] = [H2, H];
        }
        ctx.release(H2);
      }
      ctx.tick((pass + 1) / passes);
      if (ctx.aborted()) break;
    }

    // Channel mask from the final accumulation
    const river = ctx.alloc('R32F');
    gpu.pass({
      name: 'ero.rivermask',
      frag: shader(HEADER, /* glsl */ `
uniform sampler2D uA; uniform float uT, uS, uMaxLog;
layout(location=0) out vec4 o;
void main(){
  float a = max(1.0, texture(uA, vUV).r);
  float v = log(a) / uMaxLog;
  o = vec4(smoothstep(uT, uT + uS, v), 0.0, 0.0, 1.0);
}`),
      uniforms: { uA: t2(accum!), uT: p.threshold, uS: p.softness, uMaxLog: Math.log(ctx.res * ctx.res * 0.25) },
      target: river,
    });

    const wide = blur(ctx, river, p.width, true);

    const out = ctx.alloc('R32F');
    const water = ctx.alloc('RGBA32F');
    gpu.pass({
      name: 'ero.carve',
      frag: CARVE,
      uniforms: {
        uH: t2(H), uRiver: t2(river), uWide: t2(wide),
        uHeightScale: ctx.heightScale, uDepth: p.depth,
        uBankSlope: 1.0, uProfile: p.profile,
      },
      target: [out, water],
    });

    const flowNorm = ctx.alloc('R32F');
    gpu.pass({
      name: 'ero.flownorm',
      frag: shader(HEADER, `uniform sampler2D uA; uniform float uMaxLog; layout(location=0) out vec4 o;
        void main(){ o = vec4(clamp(log(max(1.0,texture(uA,vUV).r))/uMaxLog, 0.0, 1.0),0.0,0.0,1.0); }`),
      uniforms: { uA: t2(accum!), uMaxLog: Math.log(ctx.res * ctx.res * 0.25) },
      target: flowNorm,
    });

    const waterH = extract(ctx, water, 0, 1);

    ctx.release(H); ctx.release(accum); ctx.release(filled);
    ctx.release(wide); ctx.release(water);
    return { out, rivers: river, flow: flowNorm, water: waterH };
  },
});

// ===========================================================================
// Alluvial deposition — fans, valley fill, deltas
// ===========================================================================

const ALLUVIAL = shader(HEADER, NOISE, FIELD, /* glsl */ `
uniform sampler2D uH, uA, uMask;
uniform float uCell, uHeightScale, uRate, uM, uScrit, uAref, uHasMask, uBase, uBaseBoost;
layout(location=0) out vec4 oH;
layout(location=1) out vec4 oD;
void main(){
  float h = fetch(uH, vUV);
  float hm = h * uHeightScale;
  float a = max(1.0, texture(uA, vUV).r) / uAref;
  float s = slopeOf(uH, vUV, uHeightScale, uCell);

  // Transport capacity falls off as the gradient flattens; the sediment the
  // stream can no longer carry is exactly what builds the fan.
  float slack = smoothstep(uScrit * 1.8, uScrit * 0.15, s);
  float dep = uRate * pow(a, uM) * slack;

  // deltas: extra dumping as the flow approaches the base level
  float nearBase = 1.0 - smoothstep(uBase, uBase + 0.08, h);
  dep *= 1.0 + uBaseBoost * nearBase;

  if (uHasMask > 0.5) dep *= clamp(texture(uMask, vUV).r, 0.0, 1.0);

  oH = vec4((hm + dep) / uHeightScale, 0.0, 0.0, 1.0);
  oD = vec4(dep, 0.0, 0.0, 1.0);
}`);

export const Alluvial = defineNode({
  type: 'alluvial',
  title: 'Alluvial Deposition',
  subtitle: 'Fans, valley fill and deltas',
  category: 'erosion',
  icon: 'droplet',
  minRes: 512,
  cost: 25,
  keywords: ['sediment', 'fan', 'delta', 'deposit', 'silt', 'floodplain'],
  inputs: [
    { id: 'height', label: 'Height', type: 'field' },
    { id: 'flow', label: 'Flow', type: 'field', optional: true, info: 'Reuse an accumulation from Rivers instead of recomputing it.' },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
  ],
  outputs: [
    { id: 'out', label: 'Height', type: 'field' },
    { id: 'deposits', label: 'Deposits', type: 'field' },
  ],
  params: [
    { id: 'iterations', label: 'Iterations', kind: 'int', default: 14, min: 1, max: 80, step: 1 },
    { id: 'rate', label: 'Deposition', kind: 'float', default: 1.4, min: 0, max: 12, step: 0.01, unit: 'm' },
    { id: 'mExp', label: 'Area Exponent', kind: 'float', default: 0.42, min: 0.05, max: 1.2, step: 0.01 },
    { id: 'critSlope', label: 'Critical Slope', kind: 'float', default: 0.22, min: 0.01, max: 1.5, step: 0.005, info: 'Below this gradient the stream drops its load.' },
    { id: 'spread', label: 'Fan Spread', kind: 'float', default: 2.5, min: 0, max: 16, step: 0.1, info: 'Lateral smoothing of each deposition step.' },
    { id: 'baseLevel', label: 'Base Level', kind: 'float', default: 0.06, min: 0, max: 1, step: 0.005, group: 'Delta' },
    { id: 'deltaBoost', label: 'Delta Boost', kind: 'float', default: 1.4, min: 0, max: 6, step: 0.05, group: 'Delta' },
    { id: 'accumIters', label: 'Routing Steps', kind: 'int', default: 140, min: 32, max: 512, step: 8, group: 'Advanced' },
    { id: 'concentration', label: 'Concentration', kind: 'float', default: 1.4, min: 0.5, max: 6, step: 0.05, group: 'Advanced' },
  ],
  evaluate(ctx) {
    const src = heightIn(ctx);
    if (!src) return { out: null, deposits: null };
    requireRes(ctx, 512, 'Alluvial deposition');
    const gpu = ctx.gpu;
    const p = ctx.p;
    const mask = ctx.input('mask');
    const providedFlow = ctx.input('flow');

    let accum: Tex2D;
    let filled: Tex2D | null = null;
    if (providedFlow) {
      // treat the supplied 0..1 flow as a normalised accumulation
      accum = ctx.alloc('R32F');
      gpu.pass({
        name: 'ero.flowexp',
        frag: shader(HEADER, `uniform sampler2D uF; uniform float uMaxLog; layout(location=0) out vec4 o;
          void main(){ o = vec4(exp(clamp(texture(uF,vUV).r,0.0,1.0) * uMaxLog),0.0,0.0,1.0); }`),
        uniforms: { uF: t2(providedFlow), uMaxLog: Math.log(ctx.res * ctx.res * 0.25) },
        target: accum,
      });
    } else {
      const r = flowAccumulate(ctx, src, {
        iterations: p.accumIters, exponent: p.concentration, fillPits: true,
        fillIterations: Math.max(48, Math.round(ctx.res * 0.2)),
      });
      accum = r.accum;
      filled = r.filled;
    }

    let H = copy(ctx, src);
    let H2 = ctx.alloc('R32F');
    const D = ctx.alloc('R32F');
    let total = fill(ctx, 0, 'R32F');
    const Aref = ctx.res * 0.25;
    const n = p.iterations | 0;

    for (let i = 0; i < n; i++) {
      gpu.pass({
        name: 'ero.alluvial',
        frag: ALLUVIAL,
        uniforms: {
          uH: t2(H), uA: t2(accum), uMask: t2(mask), uHasMask: mask ? 1 : 0,
          uCell: ctx.cell, uHeightScale: ctx.heightScale,
          uRate: p.rate / Math.max(1, n) * 4, uM: p.mExp, uScrit: p.critSlope,
          uAref: Aref, uBase: p.baseLevel, uBaseBoost: p.deltaBoost,
        },
        target: [H2, D],
      });
      [H, H2] = [H2, H];

      if (p.spread > 0.01) {
        const sm = blur(ctx, H, p.spread, true);
        // only keep the smoothing where we actually deposited
        gpu.pass({
          name: 'ero.alluvial.smooth',
          frag: shader(HEADER, `uniform sampler2D uH,uS,uD; uniform float uK; layout(location=0) out vec4 o;
            void main(){ float d = clamp(texture(uD,vUV).r * uK, 0.0, 1.0);
              o = vec4(mix(texture(uH,vUV).r, texture(uS,vUV).r, d),0.0,0.0,1.0); }`),
          uniforms: { uH: t2(H), uS: t2(sm), uD: t2(D), uK: 40 },
          target: H2,
        });
        ctx.release(sm);
        [H, H2] = [H2, H];
      }

      // accumulate the deposit mask
      const acc2 = ctx.alloc('R32F');
      gpu.pass({
        name: 'ero.accumadd',
        frag: shader(HEADER, `uniform sampler2D uA,uB; layout(location=0) out vec4 o;
          void main(){ o = vec4(texture(uA,vUV).r + texture(uB,vUV).r,0.0,0.0,1.0); }`),
        uniforms: { uA: t2(total), uB: t2(D) },
        target: acc2,
      });
      ctx.release(total); total = acc2;

      if ((i & 3) === 0) { ctx.tick(i / n); if (ctx.aborted()) break; }
    }

    const deposits = normalize01(ctx, total);
    ctx.release(H2); ctx.release(D); ctx.release(accum); ctx.release(filled);
    return { out: H, deposits };
  },
});

// ===========================================================================
// Snow — accumulation mask that slides off steep ground
// ===========================================================================

export const Snowfall = defineNode({
  type: 'snow',
  title: 'Snowfall',
  subtitle: 'Altitude and slope limited cover',
  category: 'erosion',
  icon: 'snow',
  minRes: 128,
  cost: 6,
  inputs: [
    { id: 'height', label: 'Height', type: 'field' },
    { id: 'mask', label: 'Mask', type: 'field', optional: true },
  ],
  outputs: [
    { id: 'out', label: 'Height', type: 'field' },
    { id: 'snow', label: 'Snow', type: 'field' },
  ],
  params: [
    { id: 'line', label: 'Snow Line', kind: 'float', default: 0.62, min: 0, max: 1, step: 0.005 },
    { id: 'falloff', label: 'Line Softness', kind: 'float', default: 0.14, min: 0.005, max: 0.6, step: 0.005 },
    { id: 'slipAngle', label: 'Slip Angle', kind: 'float', default: 38, min: 5, max: 85, step: 0.5, unit: '°' },
    { id: 'thickness', label: 'Thickness', kind: 'float', default: 14, min: 0, max: 120, step: 0.5, unit: 'm' },
    { id: 'settle', label: 'Settle', kind: 'int', default: 18, min: 0, max: 80, step: 1 },
    { id: 'drift', label: 'Wind Drift', kind: 'float', default: 0.3, min: 0, max: 1, step: 0.01 },
    { id: 'driftDir', label: 'Drift Direction', kind: 'angle', default: 200, min: -180, max: 360, step: 1 },
  ],
  evaluate(ctx) {
    const h = heightIn(ctx);
    if (!h) return { out: null, snow: null };
    const gpu = ctx.gpu;
    const p = ctx.p;
    const mask = ctx.input('mask');
    const a = (p.driftDir * Math.PI) / 180;

    let snow = ctx.alloc('R32F');
    gpu.pass({
      name: 'ero.snow.seed',
      frag: shader(HEADER, NOISE, FIELD, /* glsl */ `
uniform sampler2D uH, uMask; uniform float uHasMask;
uniform float uLine, uFall, uSlipTan, uCell, uHeightScale, uDrift; uniform vec2 uDir;
layout(location=0) out vec4 o;
void main(){
  float h = fetch(uH, vUV);
  float alt = smoothstep(uLine - uFall, uLine + uFall, h);
  float s = slopeOf(uH, vUV, uHeightScale, uCell);
  float hold = 1.0 - smoothstep(uSlipTan * 0.6, uSlipTan * 1.3, s);
  vec2 g = gradient(uH, vUV, uHeightScale, uCell);
  float lee = saturate(-dot(normalize(g + 1e-5), uDir)) * uDrift;
  o = vec4(saturate(alt * hold * (1.0 + lee)) * (uHasMask > 0.5 ? texture(uMask, vUV).r : 1.0), 0.0, 0.0, 1.0);
}`),
      uniforms: {
        uH: t2(h), uMask: t2(mask), uHasMask: mask ? 1 : 0,
        uLine: p.line, uFall: p.falloff,
        uSlipTan: Math.tan((p.slipAngle * Math.PI) / 180),
        uCell: ctx.cell, uHeightScale: ctx.heightScale,
        uDrift: p.drift, uDir: [Math.cos(a), Math.sin(a)],
      },
      target: snow,
    });
    if (p.settle > 0) snow = blur(ctx, snow, p.settle * 0.25);

    const out = ctx.alloc('R32F');
    gpu.pass({
      name: 'ero.snow.apply',
      frag: shader(HEADER, `uniform sampler2D uH,uS; uniform float uT, uHeightScale; layout(location=0) out vec4 o;
        void main(){ o = vec4(texture(uH,vUV).r + texture(uS,vUV).r * uT / uHeightScale, 0.0,0.0,1.0); }`),
      uniforms: { uH: t2(h), uS: t2(snow), uT: p.thickness, uHeightScale: ctx.heightScale },
      target: out,
    });
    return { out, snow };
  },
});
