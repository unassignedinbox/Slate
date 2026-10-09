// Stack compositing + derived terrain signals (satmap sources).
import { Heightfield, layerCategory, sampleGenerator, applyFilter, evalMask, blendApply, maskKinds } from './heightfield.js';
import { hydraulicErode, thermalErode, windErode, riverIncise, flowAccumulation } from './erosion.js';

function maskWithDefaults(maskDef) {
  const type = maskDef?.type || 'none';
  const spec = maskKinds[type] || maskKinds.none;
  return { type, params: { ...spec.defaults, ...(maskDef?.params || {}) } };
}

/**
 * Derive per-cell signals from a heightfield.
 * All arrays are Float32Array(size*size) roughly normalised to [0,1].
 */
export function computeSignals(field, extra = {}, sunAz = 135, sunEl = 38) {
  const s = field.size, d = field.data;
  const heightN = new Float32Array(s * s);
  const slope = new Float32Array(s * s);
  const protrusion = new Float32Array(s * s);
  const wetness = new Float32Array(s * s);
  const aspect = new Float32Array(s * s);
  const ao = new Float32Array(s * s);

  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < d.length; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
  const span = Math.max(1e-5, mx - mn);

  const az = sunAz * Math.PI / 180;
  const sunX = Math.cos(az), sunY = Math.sin(az);

  for (let i = 0; i < d.length; i++) heightN[i] = (d[i] - mn) / span;

  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const i = y * s + x;
      const x0 = Math.max(0, x - 1), x1 = Math.min(s - 1, x + 1);
      const y0 = Math.max(0, y - 1), y1 = Math.min(s - 1, y + 1);
      const gx = (d[y * s + x1] - d[y * s + x0]) / span * 2;
      const gy = (d[y1 * s + x] - d[y0 * s + x]) / span * 2;
      slope[i] = Math.min(1, Math.sqrt(gx * gx + gy * gy) * 0.5);
      // protrusion — positive curvature (crests, ribs, outcrops)
      const lap = (d[y * s + x1] + d[y * s + x0] + d[y1 * s + x] + d[y0 * s + x]) / 4 - d[i];
      protrusion[i] = Math.max(0, Math.min(1, (-lap / span) * 22 + 0.28));
      // aspect — sun-facing slopes (1 = faces the sun)
      const gLen = Math.sqrt(gx * gx + gy * gy) + 1e-5;
      aspect[i] = Math.max(0, Math.min(1, 0.5 + 0.5 * (-gx / gLen * sunX - gy / gLen * sunY)));
      // cheap horizon AO — how much of the neighbourhood sits above us
      const r = 3;
      let above = 0, n = 0;
      for (let k = 1; k <= r; k++) {
        const samples = [
          d[y * s + Math.min(s - 1, x + k)],
          d[y * s + Math.max(0, x - k)],
          d[Math.min(s - 1, y + k) * s + x],
          d[Math.max(0, y - k) * s + x],
        ];
        for (const h2 of samples) { if (h2 > d[i]) above += (h2 - d[i]) / span; n++; }
      }
      ao[i] = Math.max(0, Math.min(1, 1 - (above / Math.max(1, n)) * 3.2));
    }
  }

  // flow: prefer the recorded erosion buffer, else run D8
  let flow = extra.flow;
  if (!flow || flow.length !== s * s) {
    const acc = flowAccumulation(field);
    flow = new Float32Array(s * s);
    let logMax = 1;
    for (let i = 0; i < acc.length; i++) logMax = Math.max(logMax, Math.log(1 + acc[i]));
    for (let i = 0; i < acc.length; i++) flow[i] = Math.log(1 + acc[i]) / logMax;
  }
  // sharpen — drainage channels should read as lines, not a uniform wash
  for (let i = 0; i < flow.length; i++) flow[i] = Math.pow(Math.max(0, Math.min(1, flow[i])), 1.9);

  // sediment: recorded deposition (gamma-lifted — deposits cluster), else
  // concave low-lying accumulation
  let sediment = extra.deposition;
  if (!sediment || sediment.length !== s * s) {
    sediment = new Float32Array(s * s);
    for (let y = 1; y < s - 1; y++) {
      for (let x = 1; x < s - 1; x++) {
        const i = y * s + x;
        const concave = 1 - protrusion[i];
        sediment[i] = Math.max(0, Math.min(1, concave * (1 - slope[i]) * (1 - heightN[i] * 0.6) * 1.15));
      }
    }
  } else {
    const lifted = new Float32Array(sediment.length);
    for (let i = 0; i < sediment.length; i++) lifted[i] = Math.pow(Math.max(0, Math.min(1, sediment[i])), 0.45);
    sediment = lifted;
  }

  for (let i = 0; i < wetness.length; i++) {
    wetness[i] = Math.max(0, Math.min(1, flow[i] * 0.75 + sediment[i] * 0.35 + (1 - heightN[i]) * 0.18 - slope[i] * 0.25));
  }

  const bil = (arr, u, v) => {
    const x = Math.max(0, Math.min(s - 1.001, u * (s - 1)));
    const y = Math.max(0, Math.min(s - 1.001, v * (s - 1)));
    const x0 = x | 0, y0 = y | 0;
    const fx = x - x0, fy = y - y0;
    const a = arr[y0 * s + x0], b = arr[y0 * s + x0 + 1];
    const c = arr[(y0 + 1) * s + x0], e = arr[(y0 + 1) * s + x0 + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
  };

  return {
    size: s,
    arrays: { heightN, slope, protrusion, flow, sediment, wetness, aspect, ao, slide: extra.slide, drift: extra.drift },
    height: (u, v) => bil(heightN, u, v),
    slope: (u, v) => bil(slope, u, v),
    protrusion: (u, v) => bil(protrusion, u, v),
    flow: (u, v) => bil(flow, u, v),
    sediment: (u, v) => bil(sediment, u, v),
    wetness: (u, v) => bil(wetness, u, v),
    aspect: (u, v) => bil(aspect, u, v),
    ao: (u, v) => bil(ao, u, v),
  };
}

/** Compose the layer stack into a fresh heightfield + erosion signal extras. */
export function compositeStack(layers, size, opts = {}) {
  const field = new Heightfield(size);
  const extra = {};
  const maskArr = new Float32Array(size * size);
  const onProgress = opts.onProgress || (() => {});

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    if (!layer.enabled) continue;
    onProgress(layer.name, li / layers.length);
    const cat = layerCategory(layer.kind);
    const p = { ...(layer.params || {}) };
    const opacity = layer.opacity ?? 1;
    const maskDef = maskWithDefaults(layer.mask);
    const useMask = maskDef.type !== 'none';

    // Masks sample the *underlying* terrain — only computed when a mask is used.
    if (useMask) {
      const signals = computeSignals(field, extra, opts.sunAz ?? 135, opts.sunEl ?? 38);
      for (let y = 0; y < size; y++) {
        const v = y / (size - 1);
        for (let x = 0; x < size; x++) {
          maskArr[y * size + x] = evalMask(maskDef, x / (size - 1), v, signals);
        }
      }
    }

    if (cat === 'erosion') {
      const before = opacity < 1 ? Float32Array.from(field.data) : null;
      const work = field.clone();
      let res = {};
      if (layer.kind === 'hydraulic') res = hydraulicErode(work, p);
      else if (layer.kind === 'thermal') res = thermalErode(work, p);
      else if (layer.kind === 'wind') res = windErode(work, p);
      else if (layer.kind === 'river') res = riverIncise(work, p, extra.flow);
      if (res.flow) extra.flow = res.flow;
      if (res.deposition) extra.deposition = res.deposition;
      if (res.slide) extra.slide = res.slide;
      if (res.drift) extra.drift = res.drift;

      const d = field.data, wd = work.data;
      if (!useMask && !before) {
        d.set(wd);
      } else {
        for (let i = 0; i < d.length; i++) {
          const m = (useMask ? maskArr[i] : 1) * opacity;
          d[i] = d[i] + (wd[i] - d[i]) * m;
        }
      }
    } else if (cat === 'filter') {
      const before = opacity < 1 ? Float32Array.from(field.data) : null;
      applyFilter(layer.kind, p, field, useMask ? maskArr : null);
      if (before) {
        const d = field.data;
        for (let i = 0; i < d.length; i++) d[i] = before[i] + (d[i] - before[i]) * opacity;
      }
    } else {
      const d = field.data;
      const mode = layer.blend || 'add';
      for (let y = 0; y < size; y++) {
        const v = y / (size - 1);
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const u = x / (size - 1);
          const top = sampleGenerator(layer.kind, p, u, v, layer.kind === 'strata' ? d[i] : undefined);
          const m = useMask ? maskArr[i] : 1;
          d[i] = blendApply(d[i], top, opacity * m, mode);
        }
      }
    }
  }
  // hard safety rail — keeps pathological stacks finite
  const d = field.data;
  for (let i = 0; i < d.length; i++) {
    if (!Number.isFinite(d[i])) d[i] = 0;
    else if (d[i] < -1.5) d[i] = -1.5;
    else if (d[i] > 2.5) d[i] = 2.5;
  }
  return { field, extra };
}
