// One place to reach every operation registry. Keeps the UI and the presets
// from importing a dozen modules each.

export { GENERATORS, GENERATOR_MAP } from './generators';
export type { GeneratorDef, GenContext } from './generators';
export { EROSIONS, EROSION_MAP, EROSION_GROUPS } from './erosion';
export type { ErosionDef, ErosionContext } from './erosion/types';
export { FILTERS, FILTER_MAP } from './filters';
export type { FilterDef, FilterContext } from './filters';
export { CHANNELS, CHANNEL_MAP } from './types';
export { MASKS, MASK_MAP, makeMaskConfig } from './masks';
export type { MaskDef, MaskContext } from './masks';
