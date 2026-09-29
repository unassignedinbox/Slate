/**
 * Shared GPU building blocks used by several nodes.
 *
 * The important one here is flowAccumulate(): a real drainage network is what
 * makes rivers legible, and everything downstream (river carving, alluvial fans,
 * wetness masks for the satmap) keys off it.
 */
import type { EvalCtx } from '../graph/types';
import { HEADER, FIELD, shader } from '../shaders/lib';
import { t2 } from '../gl/GPU';
import type { Tex2D } from '../gl/GPU';

const FILL_FRAG = shader(HEADER, `uniform float uV; layout(location=0) out vec4 o; void main(){ o = vec4(uV); }`);

export function fill(ctx: EvalCtx, value: number, fmt: 'R32F' | 'RGBA32F' = 'R32F'): Tex2D {
  const out = ctx.alloc(fmt);
  ctx.gpu.pass({
    name: 'op.fill',
    frag: FILL_FRAG,
    uniforms: { uV: value },
    target: out,
  });
  return out;
}

export function copy(ctx: EvalCtx, src: Tex2D, fmt: 'R32F' | 'RGBA32F' = 'R32F'): Tex2D {
  const out = ctx.alloc(fmt);
  ctx.gpu.pass({
    name: 'op.copy',
    frag: shader(HEADER, `uniform sampler2D uS; layout(location=0) out vec4 o; void main(){ o = texture(uS, vUV); }`),
    uniforms: { uS: t2(src) },
    target: out,
  });
  return out;
}

const BLUR_FRAG = shader(HEADER, /* glsl */ `
uniform sampler2D uS; uniform vec2 uDir; uniform float uRadius;
layout(location=0) out vec4 o;
void main(){
  float r = max(0.0, uRadius);
  int n = int(min(24.0, ceil(r * 2.0)));
  if (n <= 0){ o = texture(uS, vUV); return; }
  float sigma = max(0.5, r * 0.5);
  vec4 sum = vec4(0.0); float wsum = 0.0;
  for (int i = -24; i <= 24; i++){
    if (i < -n || i > n) continue;
    float x = float(i);
    float w = exp(-0.5 * x * x / (sigma * sigma));
    vec2 uv = clamp(vUV + uDir * x * uTexel, uTexel * 0.5, 1.0 - uTexel * 0.5);
    sum += texture(uS, uv) * w;
    wsum += w;
  }
  o = sum / wsum;
}`);

/** Separable gaussian. `radius` is in texels. Frees `src` unless keepSrc. */
export function blur(ctx: EvalCtx, src: Tex2D, radius: number, keepSrc = false): Tex2D {
  if (radius <= 0.01) return keepSrc ? copy(ctx, src, src.fmt as any) : src;
  const tmp = ctx.alloc(src.fmt as any);
  const out = ctx.alloc(src.fmt as any);
  ctx.gpu.pass({ name: 'op.blur', frag: BLUR_FRAG, uniforms: { uS: t2(src), uDir: [1, 0], uRadius: radius }, target: tmp });
  ctx.gpu.pass({ name: 'op.blur', frag: BLUR_FRAG, uniforms: { uS: t2(tmp), uDir: [0, 1], uRadius: radius }, target: out });
  ctx.release(tmp);
  if (!keepSrc) ctx.release(src);
  return out;
}

/** Normalise into 0..1 using the actual min/max. */
export function normalize01(ctx: EvalCtx, src: Tex2D): Tex2D {
  const [mn, mx] = ctx.gpu.minMax(src);
  const out = ctx.alloc('R32F');
  ctx.gpu.pass({
    name: 'op.norm01',
    frag: shader(HEADER, `uniform sampler2D uS; uniform float uMin,uMax; layout(location=0) out vec4 o;
      void main(){ o = vec4(clamp((texture(uS,vUV).r - uMin)/max(1e-6,uMax-uMin), 0.0, 1.0)); }`),
    uniforms: { uS: t2(src), uMin: mn, uMax: mx },
    target: out,
  });
  ctx.release(src);
  return out;
}

// ---------------------------------------------------------------------------
// Depression filling (iterative Planchon–Darboux)
// ---------------------------------------------------------------------------

const FILL_INIT = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uH;
layout(location=0) out vec4 o;
void main(){
  float h = fetch(uH, vUV);
  bool border = vUV.x < uTexel.x || vUV.y < uTexel.y || vUV.x > 1.0 - uTexel.x || vUV.y > 1.0 - uTexel.y;
  o = vec4(border ? h : 1e6, 0.0, 0.0, 1.0);
}`);

const FILL_STEP = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uW, uH; uniform float uEps;
layout(location=0) out vec4 o;
void main(){
  float h = fetch(uH, vUV);
  float w = fetch(uW, vUV);
  if (w <= h){ o = vec4(h); return; }
  float mn = 1e7;
  mn = min(mn, fetchO(uW, vUV, vec2(-1, 0)));
  mn = min(mn, fetchO(uW, vUV, vec2( 1, 0)));
  mn = min(mn, fetchO(uW, vUV, vec2( 0,-1)));
  mn = min(mn, fetchO(uW, vUV, vec2( 0, 1)));
  mn = min(mn, fetchO(uW, vUV, vec2(-1,-1)));
  mn = min(mn, fetchO(uW, vUV, vec2( 1,-1)));
  mn = min(mn, fetchO(uW, vUV, vec2(-1, 1)));
  mn = min(mn, fetchO(uW, vUV, vec2( 1, 1)));
  float cand = mn + uEps;
  o = vec4(max(h, min(w, cand)));
}`);

/**
 * Removes pits so water can actually route to the border. Without this the
 * drainage network shatters into disconnected puddles and you never see a river.
 */
export function fillDepressions(ctx: EvalCtx, height: Tex2D, iterations: number, eps = 1e-5): Tex2D {
  let a = ctx.alloc('R32F');
  ctx.gpu.pass({ name: 'op.fillinit', frag: FILL_INIT, uniforms: { uH: t2(height) }, target: a });
  let b = ctx.alloc('R32F');
  for (let i = 0; i < iterations; i++) {
    ctx.gpu.pass({ name: 'op.fillstep', frag: FILL_STEP, uniforms: { uW: t2(a), uH: t2(height), uEps: eps }, target: b });
    const t = a; a = b; b = t;
    if ((i & 31) === 0) {
      ctx.tick(i / iterations);
      if (ctx.aborted()) break;
    }
  }
  ctx.release(b);
  return a;
}

// ---------------------------------------------------------------------------
// Flow accumulation (multiple-flow-direction, 8 neighbours)
// ---------------------------------------------------------------------------

const WEIGHTS_FRAG = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uH; uniform float uExp;
layout(location=0) out vec4 oA;  // L, R, T, B
layout(location=1) out vec4 oB;  // TL, TR, BL, BR
void main(){
  float h = fetch(uH, vUV);
  const float S2 = 0.70710678;
  float d[8];
  d[0] = (h - fetchO(uH, vUV, vec2(-1, 0)));
  d[1] = (h - fetchO(uH, vUV, vec2( 1, 0)));
  d[2] = (h - fetchO(uH, vUV, vec2( 0, 1)));
  d[3] = (h - fetchO(uH, vUV, vec2( 0,-1)));
  d[4] = (h - fetchO(uH, vUV, vec2(-1, 1))) * S2;
  d[5] = (h - fetchO(uH, vUV, vec2( 1, 1))) * S2;
  d[6] = (h - fetchO(uH, vUV, vec2(-1,-1))) * S2;
  d[7] = (h - fetchO(uH, vUV, vec2( 1,-1))) * S2;
  float w[8]; float sum = 0.0;
  for (int i = 0; i < 8; i++){
    w[i] = d[i] > 0.0 ? pow(d[i] * 1000.0, uExp) : 0.0;
    sum += w[i];
  }
  if (sum <= 0.0){ oA = vec4(0.0); oB = vec4(0.0); return; }
  oA = vec4(w[0], w[1], w[2], w[3]) / sum;
  oB = vec4(w[4], w[5], w[6], w[7]) / sum;
}`);

const ACCUM_FRAG = shader(HEADER, FIELD, /* glsl */ `
uniform sampler2D uA, uWA, uWB, uRain; uniform float uHasRain;
layout(location=0) out vec4 o;
void main(){
  // Gather: every neighbour that drains toward us contributes its accumulation
  // times the share of its outflow pointed our way.
  float acc = uHasRain > 0.5 ? max(0.0, texture(uRain, vUV).r) : 1.0;

  // neighbour on the left sends us its "R" share (index 1 of WA)
  acc += fetchO(uA, vUV, vec2(-1, 0)) * fetch4O(uWA, vUV, vec2(-1, 0)).y;
  acc += fetchO(uA, vUV, vec2( 1, 0)) * fetch4O(uWA, vUV, vec2( 1, 0)).x;
  acc += fetchO(uA, vUV, vec2( 0, 1)) * fetch4O(uWA, vUV, vec2( 0, 1)).w;
  acc += fetchO(uA, vUV, vec2( 0,-1)) * fetch4O(uWA, vUV, vec2( 0,-1)).z;
  // diagonals: neighbour TL sends its BR share, etc.
  acc += fetchO(uA, vUV, vec2(-1, 1)) * fetch4O(uWB, vUV, vec2(-1, 1)).w;
  acc += fetchO(uA, vUV, vec2( 1, 1)) * fetch4O(uWB, vUV, vec2( 1, 1)).z;
  acc += fetchO(uA, vUV, vec2(-1,-1)) * fetch4O(uWB, vUV, vec2(-1,-1)).y;
  acc += fetchO(uA, vUV, vec2( 1,-1)) * fetch4O(uWB, vUV, vec2( 1,-1)).x;
  o = vec4(acc, 0.0, 0.0, 1.0);
}`);

const UPSAMPLE_FRAG = shader(HEADER, /* glsl */ `
uniform sampler2D uS; uniform float uGain;
layout(location=0) out vec4 o;
void main(){ o = vec4(texture(uS, vUV).r * uGain, 0.0, 0.0, 1.0); }`);

const DOWNSAMPLE_FRAG = shader(HEADER, /* glsl */ `
uniform sampler2D uS;
layout(location=0) out vec4 o;
void main(){ o = vec4(texture(uS, vUV).r, 0.0, 0.0, 1.0); }`);

export interface FlowOptions {
  /** gather iterations at full resolution */
  iterations: number;
  /** slope exponent — higher concentrates flow into fewer, sharper channels */
  exponent: number;
  /** pre-fill pits so the network is connected */
  fillPits: boolean;
  fillIterations?: number;
  /** optional per-cell rainfall weight */
  rain?: Tex2D | null;
  /** coarse pre-pass to propagate drainage across the whole tile cheaply */
  pyramid?: boolean;
}

export interface FlowResult {
  /** raw accumulation, in "upstream cells" */
  accum: Tex2D;
  /** hydrologically corrected surface (pits filled) */
  filled: Tex2D;
}

export function flowAccumulate(ctx: EvalCtx, height: Tex2D, opts: FlowOptions): FlowResult {
  const gpu = ctx.gpu;
  const filled = opts.fillPits
    ? fillDepressions(ctx, height, opts.fillIterations ?? Math.max(64, Math.round(ctx.res * 0.35)))
    : copy(ctx, height);

  const wa = ctx.alloc('RGBA32F');
  const wb = ctx.alloc('RGBA32F');
  gpu.pass({
    name: 'op.flowweights',
    frag: WEIGHTS_FRAG,
    uniforms: { uH: t2(filled), uExp: opts.exponent },
    target: [wa, wb],
  });

  let acc = fill(ctx, 1);

  // Coarse seeding: drainage information travels one texel per iteration, so a
  // quarter-res pass propagates 4x further for the same cost.
  if (opts.pyramid !== false && ctx.res >= 512) {
    const cr = Math.max(128, ctx.res >> 2);
    const cH = ctx.alloc('R32F', cr);
    gpu.pass({ name: 'op.down', frag: DOWNSAMPLE_FRAG, uniforms: { uS: t2(filled) }, target: cH });
    const cwa = ctx.alloc('RGBA32F', cr);
    const cwb = ctx.alloc('RGBA32F', cr);
    gpu.pass({ name: 'op.flowweights', frag: WEIGHTS_FRAG, uniforms: { uH: t2(cH), uExp: opts.exponent }, target: [cwa, cwb] });
    let ca = ctx.alloc('R32F', cr);
    let cb = ctx.alloc('R32F', cr);
    gpu.pass({ name: 'op.fill', frag: FILL_FRAG, uniforms: { uV: 1 }, target: ca });
    const coarseIters = Math.round(cr * 1.2);
    for (let i = 0; i < coarseIters; i++) {
      gpu.pass({
        name: 'op.accum',
        frag: ACCUM_FRAG,
        uniforms: { uA: t2(ca), uWA: t2(cwa), uWB: t2(cwb), uRain: 0, uHasRain: 0 },
        target: cb,
      });
      const t = ca; ca = cb; cb = t;
      if ((i & 63) === 0 && ctx.aborted()) break;
    }
    // scale up: a coarse cell represents (res/cr)^2 fine cells
    const scale = (ctx.res / cr) ** 2;
    ctx.release(acc);
    acc = ctx.alloc('R32F');
    gpu.pass({ name: 'op.up', frag: UPSAMPLE_FRAG, uniforms: { uS: t2(ca), uGain: scale }, target: acc });
    ctx.release(ca); ctx.release(cb); ctx.release(cH); ctx.release(cwa); ctx.release(cwb);
  }

  let back = ctx.alloc('R32F');
  const n = Math.max(1, opts.iterations);
  for (let i = 0; i < n; i++) {
    gpu.pass({
      name: 'op.accum',
      frag: ACCUM_FRAG,
      uniforms: {
        uA: t2(acc), uWA: t2(wa), uWB: t2(wb),
        uRain: t2(opts.rain ?? null), uHasRain: opts.rain ? 1 : 0,
      },
      target: back,
    });
    const t = acc; acc = back; back = t;
    if ((i & 15) === 0) {
      ctx.tick(i / n);
      if (ctx.aborted()) break;
    }
  }

  ctx.release(back);
  ctx.release(wa);
  ctx.release(wb);
  return { accum: acc, filled };
}

/** log-compressed, 0..1 normalised view of a flow accumulation field. */
export function flowToMask(ctx: EvalCtx, accum: Tex2D, threshold: number, softness: number): Tex2D {
  const out = ctx.alloc('R32F');
  ctx.gpu.pass({
    name: 'op.flowmask',
    frag: shader(HEADER, /* glsl */ `
uniform sampler2D uA; uniform float uT, uS, uMaxLog;
layout(location=0) out vec4 o;
void main(){
  float a = max(1.0, texture(uA, vUV).r);
  float v = log(a) / max(1e-4, uMaxLog);
  o = vec4(smoothstep(uT, uT + max(1e-4, uS), v), 0.0, 0.0, 1.0);
}`),
    uniforms: { uA: t2(accum), uT: threshold, uS: softness, uMaxLog: Math.log(ctx.res * ctx.res * 0.25) },
    target: out,
  });
  return out;
}

export const SLOPE_CHUNK = /* glsl */ `
uniform float uCell, uHeightScale;
`;
