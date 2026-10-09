// Catalogue of every Gaea-equivalent node (240 entries). Numbers match the brief; `key` is the stable identifier
// used in saved projects and `type` on a layer is the catalogue number.
import { generatorDefs } from './generators.js';
import { shapeDefs } from './shapes.js';
import { erosionDefs } from './erosion.js';
import { geologyDefs } from './geology.js';
import { waterDefs } from './water.js';
import { filterDefs } from './filters.js';
import { blendDefs, BLEND_MODES } from './blend.js';
import { maskDefs } from './masks.js';
import { colorDefs } from './color.js';
import { transformDefs } from './transforms.js';
import { utilityDefs } from './utility.js';
import { vegetationDefs } from './vegetation.js';

export const ALL_DEFS = [
  ...generatorDefs, ...shapeDefs, ...erosionDefs, ...geologyDefs, ...waterDefs, ...filterDefs,
  ...blendDefs, ...maskDefs, ...colorDefs, ...transformDefs, ...utilityDefs, ...vegetationDefs,
].sort((a, b) => a.id - b.id);

export const byId = new Map(ALL_DEFS.map((d) => [d.id, d]));
export const byKey = new Map(ALL_DEFS.map((d) => [d.key, d]));

export const CATEGORY_ORDER = [
  'Primitives', 'Shapes', 'Erosion', 'Geology', 'Water', 'Filters', 'Combiners', 'Masks', 'Color', 'Transforms', 'Utility', 'Vegetation',
];

export const categories = CATEGORY_ORDER.map((name) => ({ name, defs: ALL_DEFS.filter((d) => d.cat === name) }));

// Mask definitions by their short name (used when a layer's mask type is chosen).
export const MASK_TYPES = maskDefs.map((d) => ({ key: d.key.replace(/^mask_/, ''), def: d }));
export const BLEND_OPTIONS = BLEND_MODES.map((m) => [m.key, m.name]);
