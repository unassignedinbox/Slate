// Project / document schema for Slate.
//
// A project is a stack of height layers (generators, filters and erosion
// passes), each with its own mask and blend, plus a stack of satmap layers that
// paint the result using derived terrain channels.

import type { Params } from './params';

export type Resolution = 64 | 128 | 256 | 512 | 1024 | 2048;

export type ChannelId =
  | 'height'
  | 'protrusion'
  | 'slope'
  | 'aspect'
  | 'curvature'
  | 'flow'
  | 'rivers'
  | 'sediment'
  | 'eroded'
  | 'wetness'
  | 'roughness'
  | 'cavity'
  | 'snow'
  | 'strata'
  | 'sea'
  | 'noise'
  | 'grain'
  | 'cells'
  | 'constant';

export interface ChannelDef {
  id: ChannelId;
  label: string;
  group: string;
  blurb: string;
  /** Channels that read 0..1 by construction (no auto-normalisation needed). */
  unit?: boolean;
}

export const CHANNELS: ChannelDef[] = [
  { id: 'height', label: 'Height', group: 'Elevation', blurb: 'Normalised elevation of the composed terrain', unit: true },
  { id: 'protrusion', label: 'Protrusion', group: 'Elevation', blurb: 'Local prominence — how far a cell stands above its surroundings' },
  { id: 'strata', label: 'Stratification', group: 'Elevation', blurb: 'Position within the geological stack, banded for layer cake shading' },
  { id: 'slope', label: 'Slope', group: 'Surface', blurb: 'Gradient steepness in degrees', unit: true },
  { id: 'aspect', label: 'Aspect', group: 'Surface', blurb: 'Compass direction the surface faces', unit: true },
  { id: 'curvature', label: 'Curvature', group: 'Surface', blurb: 'Convex crests (+) to concave hollows (−)' },
  { id: 'roughness', label: 'Roughness', group: 'Surface', blurb: 'Local deviation from the smoothed surface' },
  { id: 'cavity', label: 'Occlusion', group: 'Surface', blurb: 'Multi-scale cavity / ambient occlusion proxy', unit: true },
  { id: 'flow', label: 'Flow accumulation', group: 'Hydrology', blurb: 'Upslope contributing area — drainage network energy' },
  { id: 'rivers', label: 'River channels', group: 'Hydrology', blurb: 'Thresholded drainage network, ready for water shading' },
  { id: 'wetness', label: 'Wetness', group: 'Hydrology', blurb: 'Topographic wetness index — where water lingers' },
  { id: 'sediment', label: 'Sedimentation', group: 'Simulation', blurb: 'Material deposited by erosion passes' },
  { id: 'eroded', label: 'Erosion', group: 'Simulation', blurb: 'Material removed by erosion passes' },
  { id: 'snow', label: 'Snow cover', group: 'Climate', blurb: 'Accumulation above the snow line, reduced on cliffs', unit: true },
  { id: 'sea', label: 'Submerged', group: 'Climate', blurb: 'Distance-weighted depth below the water level', unit: true },
  { id: 'noise', label: 'Noise field', group: 'Procedural', blurb: 'Broad fractal noise — a generator you can paint with, independent of the terrain', unit: true },
  { id: 'grain', label: 'Fine grain', group: 'Procedural', blurb: 'High frequency noise: speckle, salt weathering, shingle', unit: true },
  { id: 'cells', label: 'Cellular patches', group: 'Procedural', blurb: 'Worley cells — patchy vegetation, lichen, frost heave', unit: true },
  { id: 'constant', label: 'Constant', group: 'Utility', blurb: 'Flat fill — use it as a base tint or a mask carrier', unit: true },
];

export const CHANNEL_MAP: Record<string, ChannelDef> = Object.fromEntries(
  CHANNELS.map((c) => [c.id, c]),
);

export type HeightBlend =
  | 'add'
  | 'subtract'
  | 'max'
  | 'min'
  | 'multiply'
  | 'average'
  | 'replace'
  | 'difference';

export const HEIGHT_BLENDS: { value: HeightBlend; label: string }[] = [
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'max', label: 'Lighten (max)' },
  { value: 'min', label: 'Darken (min)' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'average', label: 'Average' },
  { value: 'replace', label: 'Replace' },
  { value: 'difference', label: 'Difference' },
];

export type ColorBlend =
  | 'normal'
  | 'multiply'
  | 'overlay'
  | 'softlight'
  | 'screen'
  | 'add'
  | 'luminosity';

export const COLOR_BLENDS: { value: ColorBlend; label: string }[] = [
  { value: 'normal', label: 'Normal' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'softlight', label: 'Soft light' },
  { value: 'screen', label: 'Screen' },
  { value: 'add', label: 'Linear dodge' },
  { value: 'luminosity', label: 'Shade only' },
];

export interface MaskConfig {
  type: string;
  params: Params;
  invert: boolean;
  /** 0 = hard edged, 1 = feathered across the whole range. */
  falloff: number;
  strength: number;
}

export interface LayerBase {
  id: string;
  name: string;
  enabled: boolean;
  /** Layer strength: blend weight for generators, mix for filters, rate for erosion. */
  opacity: number;
  /** Output remap — the layer's 0..1 value is stretched to [low, high]. */
  low: number;
  high: number;
  mask: MaskConfig;
}

export interface GeneratorLayer extends LayerBase {
  role: 'generator';
  generator: string;
  params: Params;
  /** How the generated field combines with what is already there. */
  blend: HeightBlend;
}

export interface ErosionLayer extends LayerBase {
  role: 'erosion';
  erosion: string;
  params: Params;
}

export interface FilterLayer extends LayerBase {
  role: 'filter';
  filter: string;
  params: Params;
}

export type HeightLayer = GeneratorLayer | ErosionLayer | FilterLayer;

export interface ColorStop {
  at: number;
  color: string;
}

export interface SatLayer {
  id: string;
  name: string;
  enabled: boolean;
  /** Satmap layers are painted bottom-up: the last enabled row sits on top. */

  channel: ChannelId;
  /** Colour ramp sampled across the channel, 0..1. */
  ramp: ColorStop[];
  min: number;
  max: number;
  gamma: number;
  invert: boolean;
  blend: ColorBlend;
  opacity: number;
  /** High frequency breakdown mixed in with the channel value. */
  detail: number;
  detailScale: number;
  /** Per-cell colour variation, breaks up flat ramp areas. */
  jitter: number;
  /** Flatten the ramp by local slope — keeps colour off near-vertical faces. */
  slopeBlend: number;
  mask: MaskConfig;
}

export interface RenderSettings {
  sunAzimuth: number;
  sunElevation: number;
  shading: number;
  ambient: number;
  /** Strength of the baked cavity/occlusion term in the satmap. */
  occlusion: number;
  water: boolean;
  waterLevel: number;
  waterColor: string;
  fog: number;
  wireframe: boolean;
  contour: boolean;
  snowline: number;
  snowAmount: number;
}

export interface Project {
  version: number;
  name: string;
  seed: number;
  resolution: Resolution;
  /** Metres across the terrain patch. */
  extent: number;
  /** Vertical scale in metres for a normalised height of 1. */
  heightScale: number;
  seaLevel: number;
  layers: HeightLayer[];
  satmap: SatLayer[];
  render: RenderSettings;
}

export const PROJECT_VERSION = 1;

let uid = 0;
export function newId(prefix: string): string {
  uid += 1;
  return `${prefix}-${Date.now().toString(36)}-${uid.toString(36)}`;
}
