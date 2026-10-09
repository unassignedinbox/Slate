// Slate — layer-stack evaluator. Bottom layers apply first; the top row of the
// panel is the foreground (applied last), Substance / Photoshop convention.
import {
  clamp, makeField, slopeAspect, curvature, flowAccum, ambientOcc,
} from './util.js';
import { LAYER_MAP, BLEND_MAP, MASK_MAP } from './registry.js';

export function createContext(n) {
  const ctx = {
    n,
    h: makeField(n, 0.4),
    alb: new Float32Array(n * n * 3).fill(0.5),
    rough: makeField(n, 0.8),
    moist: makeField(n, 0.3),
    snow: makeField(n, 0),
    flow: makeField(n, 0),
    ao: makeField(n, 1),
    waterLevel: 0.22,
    maps: {},
    scatter: [],
    biome: null,
    cache: [null, null, null, null],
    history: [],
    exports: [],
    outputAt: -1,
    previewSolo: null,
    compare: null,
    view3d: null,
    layerIndex: -1,
    layerData: null,   // external file data for Input layers
    maskPaint: null,   // painted mask for the current layer
    layerResult: null,
    version: 0,
    _fields: new Map(),
    field(name) {
      const key = `${name}@${this.version}`;
      if (this._fields.has(key)) return this._fields.get(key);
      const v = computeField(this, name);
      if (this._fields.size > 40) this._fields.clear();
      this._fields.set(key, v);
      return v;
    },
    bump() { this.version++; },
  };
  return ctx;
}

function computeField(ctx, name) {
  const n = ctx.n;
  switch (name) {
    case 'height01': {
      const o = new Float32Array(n * n);
      for (let i = 0; i < o.length; i++) o[i] = clamp(ctx.h[i]);
      return o;
    }
    case 'slope': return slopeAspect(ctx.h, n).slope;
    case 'slopeN': {
      const s = slopeAspect(ctx.h, n).slope, o = new Float32Array(n * n);
      for (let i = 0; i < o.length; i++) o[i] = clamp(s[i] * 2);
      return o;
    }
    case 'aspect': return slopeAspect(ctx.h, n).aspect;
    case 'curv': return curvature(ctx.h, n);
    case 'curvN': {
      const c = curvature(ctx.h, n);
      let mx = 1e-6;
      for (let i = 0; i < c.length; i++) mx = Math.max(mx, Math.abs(c[i]));
      const o = new Float32Array(n * n);
      for (let i = 0; i < o.length; i++) o[i] = clamp(c[i] / mx, -1, 1);
      return o;
    }
    case 'convex':
    case 'concave':
    case 'cavity': {
      const c = curvature(ctx.h, n);
      let mx = 1e-6;
      for (let i = 0; i < c.length; i++) mx = Math.max(mx, Math.abs(c[i]));
      const o = new Float32Array(n * n);
      for (let i = 0; i < o.length; i++) {
        const v = c[i] / mx;
        o[i] = name === 'convex' ? clamp(v * 2, 0, 1) : clamp(-v * 2, 0, 1);
      }
      return o;
    }
    case 'flow': return flowAccum(ctx.h, n);
    case 'ao': return ambientOcc(ctx.h, n, 4, 1);
    case 'rough': {
      const o = new Float32Array(n * n);
      o.set(ctx.rough);
      return o;
    }
    case 'luma': {
      const o = new Float32Array(n * n);
      for (let i = 0; i < o.length; i++)
        o[i] = 0.2126 * ctx.alb[i * 3] + 0.7152 * ctx.alb[i * 3 + 1] + 0.0722 * ctx.alb[i * 3 + 2];
      return o;
    }
    case 'edge': {
      const o = new Float32Array(n * n);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = Math.min(x, n - 1 - x) / (n - 1), dy = Math.min(y, n - 1 - y) / (n - 1);
        o[y * n + x] = Math.min(dx, dy) * 2;
      }
      return o;
    }
    case 'waterM': {
      const o = new Float32Array(n * n);
      for (let i = 0; i < o.length; i++) o[i] = ctx.h[i] < ctx.waterLevel ? 1 : 0;
      return o;
    }
    case 'snowM': {
      const o = new Float32Array(n * n);
      const s = slopeAspect(ctx.h, n).slope;
      for (let i = 0; i < o.length; i++) {
        const a = Math.atan(s[i]) * 180 / Math.PI;
        const hs = clamp((ctx.h[i] - 0.55) / 0.2);
        o[i] = hs * (1 - clamp((a - 30) / 25));
      }
      return o;
    }
    default: throw new Error(`unknown field: ${name}`);
  }
}

function createScratch(ctx) {
  const n = ctx.n;
  return {
    h: new Float32Array(n * n),
    alb: new Float32Array(n * n * 3),
    rough: new Float32Array(n * n),
    moist: new Float32Array(n * n),
    snow: new Float32Array(n * n),
    flow: new Float32Array(n * n),
    ao: new Float32Array(n * n),
  };
}
const BUF = { height: 'h', alb: 'alb', rough: 'rough', moist: 'moist', snow: 'snow', flow: 'flow', ao: 'ao' };

function applyBlend(ctx, S, def, layer, mask) {
  const blend = BLEND_MAP[layer.blend] || BLEND_MAP.blend;
  const fn = blend.fn;
  const op = clamp(layer.opacity, 0, 1);
  const targets = [...(def.targets || []), ...(def.also || [])];
  for (const t of targets) {
    const key = BUF[t];
    if (!key) continue;
    const base = ctx[key], cand = S[key];
    if (t === 'alb') {
      for (let i = 0; i < ctx.n * ctx.n; i++) {
        const m = (mask ? mask[i] : 1) * op;
        if (m <= 0) continue;
        for (let c = 0; c < 3; c++) {
          const j = i * 3 + c;
          base[j] = clamp(fn(clamp(base[j]), clamp(cand[j]), m), -0.25, 1.5);
        }
      }
    } else {
      for (let i = 0; i < base.length; i++) {
        const m = (mask ? mask[i] : 1) * op;
        if (m <= 0) continue;
        base[i] = fn(base[i], cand[i], m);
      }
    }
  }
}

// Evaluate the full stack. `layers` bottom→top (index 0 applies first).
// onProgress(done, total, label) may be async-friendly; yields between layers.
export async function evaluate(layers, n, opts = {}) {
  const { onProgress = null, dataFor = null, paintFor = null, signal = null } = opts;
  const ctx = createContext(n);
  const S = createScratch(ctx);
  const maskBuf = new Float32Array(n * n);
  const total = layers.length;
  for (let li = 0; li < layers.length; li++) {
    if (signal && signal.aborted) throw new Error('aborted');
    const layer = layers[li];
    const def = LAYER_MAP[layer.type];
    if (!def) continue;
    if (onProgress) onProgress(li, total, def.name);
    if (layer.visible === false) continue;
    ctx.layerIndex = li;
    ctx.layerResult = null;
    ctx.layerData = dataFor ? dataFor(layer) : null;
    ctx.maskPaint = paintFor ? paintFor(layer) : null;
    // Scratch starts as a copy of current state so partial writes stay safe.
    const targets = [...(def.targets || []), ...(def.also || [])];
    for (const t of targets) {
      const key = BUF[t];
      if (key) S[key].set(ctx[key]);
    }
    try {
      def.run(ctx, layer.params || {}, S);
    } catch (err) {
      ctx.layerResult = { error: String(err && err.message || err) };
      if (opts.strict) throw err;
    }
    // Mask
    let mask = null;
    if (layer.mask && layer.mask !== 'none' && targets.length) {
      const mdef = MASK_MAP[layer.mask];
      if (mdef) {
        maskBuf.fill(1);
        try {
          mdef.run(ctx, layer.maskParams || {}, maskBuf);
        } catch (err) { maskBuf.fill(1); }
        mask = maskBuf;
      }
    }
    if (targets.length) applyBlend(ctx, S, def, layer, mask);
    layer._result = ctx.layerResult;
    if (ctx.history.length > 48) ctx.history.shift();
    ctx.history.push({ h: Float32Array.from(ctx.h), alb: Float32Array.from(ctx.alb) });
    ctx.bump();
    // yield to the event loop so progress paints
    await new Promise((r) => setTimeout(r, 0));
  }
  if (onProgress) onProgress(total, total, 'done');
  return ctx;
}

export function waterDepth(ctx) {
  const o = new Float32Array(ctx.n * ctx.n);
  for (let i = 0; i < o.length; i++) o[i] = Math.max(0, ctx.waterLevel - ctx.h[i]);
  return o;
}
