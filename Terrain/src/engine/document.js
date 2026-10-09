// Document model: a project is { config, layers, previewLayerId }. Layers are plain JSON except for binary payloads
// (custom painted masks and imported heightmaps), which are base64-encoded in saved files.
import { byId, byKey } from './registry.js';

let counter = 1;
export const newLayerId = () => `L${Date.now().toString(36)}${(counter++).toString(36)}`;

export function createLayer(typeOrKey, overrides = {}) {
  const def = typeof typeOrKey === 'number' ? byId.get(typeOrKey) : byKey.get(typeOrKey);
  if (!def) throw new Error(`Unknown layer type ${typeOrKey}`);
  return {
    id: newLayerId(),
    type: def.id,
    name: def.name,
    enabled: true,
    opacity: 1,
    blend: 'blend',
    mask: null,
    params: { ...def.defaults },
    ...overrides,
  };
}

export function defaultConfig() {
  return { resolution: 256, worldSize: 2048, heightScale: 600, seed: 428 };
}

// Light-weight presets: each is a list of [catalogue key, params, extras] tuples.
const PRESETS = {
  'Alpine valley': {
    config: { seed: 428 },
    layers: [
      ['fbm', { scale: 2, octaves: 7, seed: 428 }],
      ['ridged', { scale: 2.4, octaves: 5, seed: 17 }, { blend: 'add', opacity: 0.6 }],
      ['mountain', { cx: -0.2, cy: 0.1, radius: 0.9, height: 0.5, seed: 9 }, { blend: 'max', opacity: 0.8 }],
      ['hydraulicFlow', { strength: 0.6 }],
      ['thermal', { talus: 40, iterations: 30 }, { mask: { type: 'slope', params: { min: 35, max: 90, soft: 8 } } }],
      ['glacial', { threshold: 0.7, radius: 12, depth: 0.08 }],
      ['river', { threshold: 0.72, width: 2, depth: 0.03 }],
      ['stream', { threshold: 0.55, width: 1, depth: 0.01 }],
      ['lake', { count: 2, radius: 0.05, depth: 0.04 }],
      ['colorHeight', { low: '#4c6b3a', mid: '#8a7a52', high: '#e9eef2', split: 0.82 }],
      ['colorSnow', null],
    ],
  },
  'Desert mesa': {
    config: { seed: 71 },
    layers: [
      ['constant', { value: 0.2 }],
      ['mesa', { cx: 0, cy: 0, radius: 0.55, height: 0.6, cliff: 0.14 }, { blend: 'max' }],
      ['mesa', { cx: 0.5, cy: -0.4, radius: 0.3, height: 0.35, cliff: 0.1 }, { blend: 'max' }],
      ['dunes', { wavelength: 0.18, direction: 40, amp: 0.25, coverage: 0.7 }, { blend: 'add', opacity: 0.5, mask: { type: 'slope', params: { min: 0, max: 30, soft: 6 } } }],
      ['wind', { direction: 40, strength: 0.25, iterations: 6 }],
      ['thermal', { talus: 32, iterations: 25 }],
      ['flowErosion', { strength: 0.2, passes: 2 }],
      ['colorDesert', { sand: '#d7b98a', dry: 0.8 }],
      ['colorRock', { rock: '#8a6548', threshold: 42 }],
    ],
  },
  'Volcanic island': {
    config: { seed: 13 },
    layers: [
      ['island', { land: 0.6, peak: 0.6, coast: 0.2, sea: 0.22 }],
      ['volcano', { cx: 0, cy: 0, radius: 0.5, height: 0.7, craterR: 0.12, craterDepth: 0.4 }, { blend: 'max' }],
      ['lavaFlow', { width: 8, amount: 0.8 }],
      ['ocean', { level: 0.22, bed: 0.4, shore: 0.5 }],
      ['hydraulicRain', { drops: 90, life: 40 }],
      ['colorHeight', { low: '#3b5f33', mid: '#5d6b44', high: '#2a2a2c', split: 0.45 }],
      ['splat', {}],
    ],
  },
  'Coastal shelf': {
    config: { seed: 220 },
    layers: [
      ['coast', { land: 0.7, coast: 0.25, shelf: 0.3, sea: 0.3 }],
      ['hills', { amp: 0.3, roundness: 0.6, scale: 3, seed: 220 }, { blend: 'add', opacity: 0.5 }],
      ['hydraulic', { drops: 40, life: 50 }],
      ['ocean', { level: 0.28, bed: 0.5, shore: 0.6 }],
      ['delta', { sea: 0.28, threshold: 0.6 }],
      ['coastal', { sea: 0.3, band: 0.05, strength: 0.6 }],
      ['satmap', null],
    ],
  },
};

export const presetNames = Object.keys(PRESETS);

// Build a document from a preset. Entries referencing a missing definition fall back to the nearest available layer.
export function createPreset(name, resolution = 256) {
  const preset = PRESETS[name] || PRESETS[presetNames[0]];
  const layers = [];
  for (const [key, params, extra] of preset.layers) {
    if (!byKey.has(key)) continue;
    const def = byKey.get(key);
    layers.push(createLayer(key, { params: { ...def.defaults, ...(params || {}) }, ...(extra || {}), name: def.name }));
  }
  const config = { ...defaultConfig(), ...preset.config, resolution };
  return { config, layers, previewLayerId: null };
}

// Make an empty stack, starting from a flat base.
export function createBlank(resolution = 256) {
  return { config: { ...defaultConfig(), resolution }, layers: [createLayer('constant', { params: { value: 0.3 }, name: 'Base' })], previewLayerId: null };
}

// ---- Serialization -------------------------------------------------------------------------------------------

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function serializeDocument(doc) {
  const layers = doc.layers.map((l) => {
    const copy = { ...l };
    if (l.mask && l.mask.paint) copy.mask = { ...l.mask, paint: { b64: bytesToBase64(l.mask.paint) } };
    if (l.imported) copy.imported = { n: l.imported.n, b64: bytesToBase64(new Uint8Array(l.imported.data.buffer)) };
    return copy;
  });
  return JSON.stringify({ format: 'slate-terrain-stack', version: 1, config: doc.config, previewLayerId: doc.previewLayerId, layers }, null, 2);
}

export function deserializeDocument(text) {
  const raw = JSON.parse(text);
  if (raw.format !== 'slate-terrain-stack') throw new Error('Not a Slate terrain stack file');
  const layers = raw.layers.map((l) => {
    const copy = { ...l };
    if (l.mask && l.mask.paint && l.mask.paint.b64) copy.mask = { ...l.mask, paint: base64ToBytes(l.mask.paint.b64) };
    if (l.imported && l.imported.b64) {
      const bytes = base64ToBytes(l.imported.b64);
      copy.imported = { n: l.imported.n, data: new Float32Array(bytes.buffer) };
    }
    return copy;
  });
  return { config: raw.config, previewLayerId: raw.previewLayerId ?? null, layers };
}
