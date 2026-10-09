// Display names for Gaea combiner blend modes and mask types (ids match the registry).
import { BLEND } from '../engine/ops.js';
import { maskNames } from '../engine/masks.js';
import { NODES } from '../engine/registry.js';
export const BLEND_NAMES = Object.fromEntries(Object.keys(BLEND).map((k) => [k, NODES[k].name]));
export const MASK_NAMES = maskNames;
