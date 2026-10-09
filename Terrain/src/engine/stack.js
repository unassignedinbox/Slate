// The layer stack evaluator. Layers are applied in order (index 0 = bottom of the stack, the last index = top).
// Each layer runs once against the shared context, then its outputs are combined into the running result with:
//   influence = opacity x mask x alpha,    result = blend(below, output) mixed by influence.
// Height, colour, named maps, water and scatter are all handled here, so terrain and texturing share one pipeline.
import { byId } from './registry.js';
import { createContext } from './context.js';
import { evaluateMask } from './masks.js';
import { blendFn } from './blend.js';
import { minMax, mean, clamp } from './grid.js';
import { newGrid } from './grid.js';

// Blend a single channel, then mix by influence.
function blendChannel(mode, base, src, t) {
  if (t <= 0) return base;
  const f = blendFn[mode] ?? blendFn.blend;
  const b = clamp(f(base, src));
  return base + (b - base) * t;
}

function applyHeight(ctx, src, mode, infl) {
  const N2 = ctx.N * ctx.N, H = ctx.H, out = new Float32Array(N2);
  for (let i = 0; i < N2; i++) {
    const t = typeof infl === 'number' ? infl : infl[i];
    const v = blendChannel(mode, H[i], clamp(src[i]), t);
    out[i] = Number.isFinite(v) ? v : H[i];
  }
  ctx.setHeight(out);
}

function applyColor(ctx, src, mode, infl) {
  const N2 = ctx.N * ctx.N, C = ctx.C, out = new Float32Array(C.length);
  for (let i = 0; i < N2; i++) {
    const t = typeof infl === 'number' ? infl : infl[i];
    for (let k = 0; k < 3; k++) {
      const j = i * 3 + k;
      out[j] = blendChannel(mode, C[j], clamp(src[j]), t);
    }
  }
  ctx.C = out;
}

function applyMap(ctx, name, ch, data, infl) {
  const N2 = ctx.N * ctx.N;
  const prev = ctx.maps[name];
  const out = new Float32Array(N2 * ch);
  const old = prev && prev.ch === ch ? prev.data : null;
  for (let i = 0; i < N2; i++) {
    const t = typeof infl === 'number' ? infl : infl[i];
    for (let k = 0; k < ch; k++) {
      const j = i * ch + k;
      const base = old ? old[j] : 0;
      out[j] = base + (data[j] - base) * t;
    }
  }
  ctx.maps[name] = { ch, data: out };
}

// Pick the snapshot a utility layer should read: the nearest cache point below the current layer.
function makeEnv(ctx0) {
  const env = {
    snapshots: [],
    views: {},
    pushSnapshot(ctx, id) {
      env.snapshots.push({ id, H: Float32Array.from(ctx.H), C: Float32Array.from(ctx.C) });
    },
    nearestSnapshot() {
      return env.snapshots[env.snapshots.length - 1] || null;
    },
    recordView(ctx, id, kind, split) {
      env.views[id] = { kind, split, H: Float32Array.from(ctx.H), C: Float32Array.from(ctx.C) };
    },
  };
  return env;
}

// Evaluate a document. `doc = { config: {resolution, worldSize, heightScale, seed}, layers: [...], previewLayerId }`.
export function evaluateStack(doc, options = {}) {
  const cfg = { resolution: 256, worldSize: 2048, heightScale: 600, seed: 1, ...doc.config };
  const N = cfg.resolution;
  const t0 = performance.now();
  const ctx = createContext(cfg, newGrid(N, 0), null);
  const env = makeEnv(ctx);
  const timings = [], errors = [];
  let preview = null;

  for (const layer of doc.layers) {
    if (!layer || layer.enabled === false) continue;
    const def = byId.get(layer.type);
    if (!def) { errors.push({ id: layer.id, message: `Unknown layer type ${layer.type}` }); continue; }
    const p = { ...def.defaults, ...(layer.params || {}) };
    const start = performance.now();
    try {
      const maskGrid = evaluateMask(ctx, layer.mask);
      const opacity = clamp(layer.opacity ?? 1, 0, 1);
      const res = def.run(ctx, p, layer, env) || {};
      // Influence per cell: opacity x mask x alpha. Use the scalar form when nothing varies per cell.
      let infl = opacity;
      if (maskGrid || res.alpha) {
        infl = new Float32Array(N * N);
        for (let i = 0; i < infl.length; i++) {
          infl[i] = opacity * (maskGrid ? maskGrid[i] : 1) * (res.alpha ? clamp(res.alpha[i]) : 1);
        }
      }
      const mode = layer.blend || 'blend';
      if (res.height) applyHeight(ctx, res.height, mode, infl);
      if (res.color) applyColor(ctx, res.color, mode, infl);
      if (res.map) applyMap(ctx, res.map.name, res.map.ch, res.map.data, infl);
      if (res.maps) for (const m of res.maps) applyMap(ctx, m.name, m.ch, m.data, infl);
      if (res.water) {
        const W = ctx.water, out = new Float32Array(W.length);
        for (let i = 0; i < W.length; i++) {
          const t = typeof infl === 'number' ? infl : infl[i];
          out[i] = W[i] + (res.water[i] - W[i]) * t;
        }
        ctx.water = out;
      }
      if (res.scatter) ctx.scatter = res.scatter;
      if (res.stats) ctx.stats[layer.id] = res.stats;
      if (options.previewId === layer.id) {
        preview = { layerId: layer.id, height: res.height ?? null, color: res.color ?? null, map: res.map ?? null, mask: maskGrid };
      }
    } catch (err) {
      errors.push({ id: layer.id, message: err?.message || String(err) });
    }
    timings.push({ id: layer.id, name: layer.name || def.name, ms: performance.now() - start });
  }

  const { min, max } = minMax(ctx.H);
  return {
    N,
    cfg,
    H: ctx.H,
    C: ctx.C,
    water: ctx.water,
    maps: ctx.maps,
    scatter: ctx.scatter,
    layerStats: ctx.stats,
    views: env.views,
    preview,
    errors,
    timings,
    summary: { min, max, mean: mean(ctx.H), ms: performance.now() - t0 },
  };
}
