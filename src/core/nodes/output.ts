import { defineNode } from '../graph/types';

/**
 * The viewport target. Whatever reaches this node is what gets rendered:
 *  Height  -> the analytic ground SDF term (full resolution, never voxelised)
 *  Colour  -> surface albedo, normally from a SatMap chain
 *  Caves   -> the 3D SDF subtracted from the ground
 *  Water   -> per-texel water surface height, drawn as rivers/lakes
 */
export const TerrainOutput = defineNode({
  type: 'output',
  title: 'Terrain Output',
  subtitle: 'Viewport target',
  category: 'output',
  icon: 'monitor',
  cost: 0,
  keywords: ['render', 'final', 'result', 'viewport'],
  inputs: [
    { id: 'height', label: 'Height', type: 'field' },
    { id: 'color', label: 'Colour', type: 'color', optional: true },
    { id: 'volume', label: 'Caves', type: 'volume', optional: true },
    { id: 'water', label: 'Water', type: 'field', optional: true },
  ],
  outputs: [],
  params: [
    { id: 'seaLevel', label: 'Sea Level', kind: 'float', default: 0.0, min: 0, max: 1, step: 0.002, info: 'Flat water plane. 0 disables it.' },
    { id: 'caveBlend', label: 'Cave Blend', kind: 'float', default: 14, min: 0, max: 200, step: 0.5, unit: 'm', info: 'Smoothness of the cave subtraction where it meets the surface.' },
    { id: 'exaggeration', label: 'Height Exaggeration', kind: 'float', default: 1, min: 0.05, max: 3, step: 0.01 },
  ],
  evaluate() {
    // Terminal node — the evaluator reads its resolved inputs directly.
    return {};
  },
});
