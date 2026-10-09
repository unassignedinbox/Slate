// Slate — registry: all 240 items (190 layers + 24 blends + 26 masks).
import { LAYERS_PRIMITIVE } from './layers_primitive.js';
import { LAYERS_SHAPE } from './layers_shape.js';
import { LAYERS_EROSION } from './layers_erosion.js';
import { LAYERS_GEO } from './layers_geo.js';
import { LAYERS_WATER } from './layers_water.js';
import { LAYERS_FILTER } from './layers_filter.js';
import { LAYERS_COLOR } from './layers_color.js';
import { LAYERS_TRANSFORM } from './layers_transform.js';
import { LAYERS_UTILITY } from './layers_utility.js';
import { LAYERS_VEG } from './layers_veg.js';
import { BLENDS, BLEND_MAP } from './blend.js';
import { MASKS, MASK_MAP } from './masks.js';

export const CATS = [
  { id: 'primitive', name: 'Primitives', range: '1–28', color: '#7dd3fc', hint: 'Raw height from scratch' },
  { id: 'shape', name: 'Shapes', range: '29–52', color: '#a5b4fc', hint: 'Macro landforms' },
  { id: 'erosion', name: 'Erosion', range: '53–69', color: '#f0abfc', hint: 'Natural wear, carves' },
  { id: 'geo', name: 'Geology', range: '70–84', color: '#fda4af', hint: 'Tectonic processes' },
  { id: 'water', name: 'Water', range: '85–94', color: '#67e8f9', hint: 'Carves basins/channels' },
  { id: 'filter', name: 'Filters', range: '95–128', color: '#fcd34d', hint: 'Transform height data' },
  { id: 'color', name: 'Color', range: '179–203', color: '#86efac', hint: 'Surface texturing' },
  { id: 'transform', name: 'Transforms', range: '204–216', color: '#fdba74', hint: 'Spatial manipulation' },
  { id: 'utility', name: 'Utility', range: '217–235', color: '#c4b5fd', hint: 'Pipeline + I/O' },
  { id: 'vegetation', name: 'Vegetation', range: '236–240', color: '#4ade80', hint: 'Scatter + biomes' },
];
export const CAT_MAP = Object.fromEntries(CATS.map((c) => [c.id, c]));

export const LAYERS = [
  ...LAYERS_PRIMITIVE, ...LAYERS_SHAPE, ...LAYERS_EROSION, ...LAYERS_GEO,
  ...LAYERS_WATER, ...LAYERS_FILTER, ...LAYERS_COLOR, ...LAYERS_TRANSFORM,
  ...LAYERS_UTILITY, ...LAYERS_VEG,
].sort((a, b) => a.n - b.n);

export const LAYER_MAP = Object.fromEntries(LAYERS.map((l) => [l.id, l]));
export { BLENDS, BLEND_MAP, MASKS, MASK_MAP };

// Combiners #129–152 live as per-layer blend modes (stack-native, like Substance).
export const COMBINER_NOTE = 'Items 129–152 are blend modes: every layer blends with the stack below it.';

export function defaultParams(def) {
  const o = {};
  for (const p of def.params || []) o[p.k] = p.def;
  return o;
}
export function makeLayer(typeId, overrides = {}) {
  const def = LAYER_MAP[typeId];
  if (!def) throw new Error(`unknown layer type: ${typeId}`);
  return {
    uid: `L${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`,
    type: typeId,
    name: def.name,
    visible: true,
    opacity: 1,
    blend: 'blend',
    mask: 'none',
    maskParams: {},
    params: { ...defaultParams(def), ...(overrides.params || {}) },
    ...overrides.meta,
  };
}
export function makeMaskParams(maskId) {
  if (maskId === 'none') return {};
  const def = MASK_MAP[maskId];
  return def ? defaultParams(def) : {};
}
// Verify complete coverage 1..240 with no gaps or duplicates.
export function coverageReport() {
  const nums = new Set([...LAYERS.map((l) => l.n), ...BLENDS.map((b) => b.n), ...MASKS.map((m) => m.n)]);
  const missing = [], dup = [];
  const seen = new Set();
  for (const l of [...LAYERS, ...BLENDS, ...MASKS]) {
    if (seen.has(l.n)) dup.push(l.n);
    seen.add(l.n);
  }
  for (let i = 1; i <= 240; i++) if (!nums.has(i)) missing.push(i);
  return { total: nums.size, layers: LAYERS.length, blends: BLENDS.length, masks: MASKS.length, missing, dup };
}
