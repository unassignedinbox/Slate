// Layer-stack evaluator. Layers are applied bottom (index 0) to top (last).
// Every layer: enabled flag, node id, params, blend mode (Gaea combiner id), opacity, optional mask.
import { NODES, defaultParams } from './registry.js';
import { blendValue, blendFields } from './ops.js';
import { clamp01, gaussBlur, minmax, sample, make } from './grid.js';
import { deriveFor } from './masks.js';

export const DEFAULT_BLEND = 136; // Gaea "Blend": layer replaces what is below, weighted by opacity

export function newState(N, heightScale = 1) {
  const albedo = new Float32Array(N * N * 3).fill(0.5);
  return { N, version: 0, heightScale, h: make(N, 0), albedo, water: null, maps: {}, seaLevel: -1, stats: null, view: null, view3D: null, importData: null, histogram: null, log: [] };
}

function resampleTo(src, srcN, N) {
  if (srcN === N) return src;
  const out = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) out[y * N + x] = sample(src, srcN, (x + 0.5) * srcN / N - 0.5, (y + 0.5) * srcN / N - 0.5);
  return out;
}

// Mask pipeline: raw mask -> contrast -> feather -> invert
export function layerMask(m, st) {
  if (!m || m.type == null || m.type === '') return null;
  const node = NODES[m.type];
  if (!node || node.mode !== 'mask') return null;
  const p = { ...defaultParams(node), ...(m.params || {}) };
  if (m.type === 178) p._painted = m.painted ? resampleTo(m.painted.data, m.painted.N, st.N) : null;
  let f = node.run(p, st);
  if (m.contrast != null && m.contrast !== 1) { const c = m.contrast; f = Float32Array.from(f, (v) => clamp01((v - 0.5) * c + 0.5)); }
  if (m.feather > 0) f = gaussBlur(f, st.N, m.feather);
  if (m.invert) f = Float32Array.from(f, (v) => 1 - v);
  return f;
}

function mul(a, b) { if (!a) return b; if (!b) return a; const o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] * b[i]; return o; }

function lerpInto(dst, src, w) {
  for (let i = 0; i < dst.length; i++) { const k = w ? w[i] : 1; dst[i] += (src[i] - dst[i]) * k; }
}

function blendRGB(mode, albedo, rgb, wN, N) {
  const out = Float32Array.from(albedo);
  for (let i = 0; i < N * N; i++) {
    const w = wN ? wN[i] : 1;
    if (w <= 0) continue;
    for (let k = 0; k < 3; k++) {
      const b = albedo[i * 3 + k], t = blendValue(mode, b, rgb[i * 3 + k]);
      out[i * 3 + k] = b + (t - b) * w;
    }
  }
  return out;
}

// Remap every channel of the state through a coordinate function (transform layers).
function remapState(st, coordFn, weight) {
  const N = st.N;
  // Generic channel resampler: ch=1 scalar, ch=3 RGB. Coordinates wrap-free, clamped at edges.
  const mapN = (src, ch) => {
    const out = new Float32Array(src.length);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const [sx, sy] = coordFn(x, y);
      const cx = Math.min(Math.max(sx, 0), N - 1), cy = Math.min(Math.max(sy, 0), N - 1);
      for (let k = 0; k < ch; k++) out[(y * N + x) * ch + k] = sampleCh(src, N, ch, k, cx, cy);
    }
    return out;
  };
  const h2 = mapN(st.h, 1);
  const a2 = mapN(st.albedo, 3);
  for (let i = 0; i < st.h.length; i++) { const w = weight ? weight[i] : 1; st.h[i] += (h2[i] - st.h[i]) * w; }
  for (let i = 0; i < st.albedo.length / 3; i++) { const w = weight ? weight[i] : 1; for (let k = 0; k < 3; k++) st.albedo[i * 3 + k] += (a2[i * 3 + k] - st.albedo[i * 3 + k]) * w; }
  if (st.water) {
    const wat = mapN(Float32Array.from(st.water, (v) => (Number.isNaN(v) ? -1 : v)), 1);
    for (let i = 0; i < st.water.length; i++) st.water[i] = wat[i] < 0 ? NaN : wat[i];
  }
  for (const k of Object.keys(st.maps)) {
    const arr = st.maps[k]; const ch = arr.length === N * N * 3 ? 3 : 1;
    lerpInto(arr, mapN(arr, ch), weight);
  }
}
function sampleCh(src, N, ch, k, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y), tx = x - x0, ty = y - y0;
  const xa = Math.min(N - 1, x0), xb = Math.min(N - 1, x0 + 1), ya = Math.min(N - 1, y0), yb = Math.min(N - 1, y0 + 1);
  const g = (xx, yy) => src[(yy * N + xx) * ch + k];
  const top = g(xa, ya) + (g(xb, ya) - g(xa, ya)) * tx, bot = g(xa, yb) + (g(xb, yb) - g(xa, yb)) * tx;
  return top + (bot - top) * ty;
}

export function evaluate(project) {
  const N = project.N;
  const st = newState(N, project.heightScale ?? 1);
  let pendingMask = null;
  const timings = [];
  for (const layer of project.layers) {
    if (layer.enabled === false) continue;
    const node = NODES[layer.nodeId];
    if (!node) continue;
    const t0 = Date.now();
    const p = { ...defaultParams(node), ...(layer.params || {}) };
    if (p.seed != null) p.seed = p.seed + (project.seed ?? 0) * 1000;
    st.importData = layer.imported ? resampleTo(layer.imported.data, layer.imported.N, N) : null;

    if (node.mode === 'mask') { // standalone mask layer: feeds the next layer
      pendingMask = mul(pendingMask, node.run(p, st));
      continue;
    }
    const mask = mul(layerMask(layer.mask, st), pendingMask);
    pendingMask = null;
    const op = layer.opacity ?? 1;
    const blend = layer.blend ?? DEFAULT_BLEND;
    const w = mask ? Float32Array.from(mask, (v) => v * op) : op;
    const wArr = mask ? w : null;
    const hw = (i) => (wArr ? wArr[i] : w);

    if (node.mode === 'gen') {
      const F = node.run(p, st, st.h);
      const out = blendFields(blend, st.h, F, wArr || fillW(N, op));
      st.h.set(out);
    } else if (node.mode === 'mod' || node.mode === 'combine') {
      const r = node.run(p, st, st.h);
      const H = r instanceof Float32Array ? r : r.h;
      if (H) {
        for (let i = 0; i < st.h.length; i++) st.h[i] += (H[i] - st.h[i]) * hw(i);
      }
    } else if (node.mode === 'xform') {
      const coord = node.run(p, st);
      remapState(st, coord, wArr || fillW(N, op));
    } else if (node.mode === 'obj') {
      const d = deriveFor(st);
      const r = node.run(p, st, st.h, d);
      if (r && r.type === 'color') {
        const ww = new Float32Array(N * N);
        for (let i = 0; i < N * N; i++) ww[i] = r.w[i] * hw(i);
        st.albedo.set(blendRGB(blend, st.albedo, r.rgb, ww, N));
        if (r.extra && r.extra.roughness) st.maps.roughness = Float32Array.from(r.extra.roughness);
      } else if (r && r.type === 'rawalbedo') {
        for (let i = 0; i < st.albedo.length; i++) st.albedo[i] += (r.rgb[i] - st.albedo[i]) * (wArr ? wArr[(i / 3) | 0] : op);
      } else if (r && r.type === 'mod') {
        for (let i = 0; i < st.h.length; i++) st.h[i] += (r.h[i] - st.h[i]) * hw(i);
      } else if (r && r.type === 'map') {
        const cur = st.maps[r.name];
        const isRGB = r.data.length === N * N * 3;
        if (!cur) st.maps[r.name] = new Float32Array(r.data.length);
        const dst = st.maps[r.name];
        if (isRGB) {
          for (let i = 0; i < N * N; i++) for (let k = 0; k < 3; k++) dst[i * 3 + k] += (r.data[i * 3 + k] - dst[i * 3 + k]) * hw(i);
        } else {
          for (let i = 0; i < N * N; i++) dst[i] += (r.data[i] - dst[i]) * hw(i);
        }
      }
      if (r && r.output) st.outputs = { ...(st.outputs || {}), [r.output]: Float32Array.from(st.h) };
    }
    for (let i = 0; i < st.h.length; i++) st.h[i] = clamp01(st.h[i]); // keep every layer inside the 0..1 height range
    st.version++;
    timings.push({ id: layer.id, ms: Date.now() - t0 });
  }
  // clamp + consistency: water surface must sit at or above the bed and be dry where terrain rose above it
  for (let i = 0; i < st.h.length; i++) {
    st.h[i] = clamp01(st.h[i]);
    if (st.water && !Number.isNaN(st.water[i]) && st.water[i] < st.h[i] - 1e-5) st.water[i] = NaN;
  }
  const [mn, mx] = minmax(st.h);
  st.range = { min: mn, max: mx };
  st.timings = timings;
  return st;
}

function fillW(N, v) { return new Float32Array(N * N).fill(v); }
