//============================================================================================================================================
// SolidScape — Node type declarations (UI only; no SDF field solving yet)
//============================================================================================================================================

export type PortType = 'field' | 'scalar' | 'vector' | 'colour' | 'flow';

export interface PortSpecification
{
    key:   string;
    label: string;
    type:  PortType;
}

export interface ParameterSpecification
{
    key:    string;
    label:  string;
    min:    number;
    max:    number;
    step:   number;
    value:  number;
    suffix: string;
}

export interface NodeSpecification
{
    id:      string;
    name:    string;
    kind:    string;
    glyph:   string;
    group:   string;
    desc:    string;
    inputs:  PortSpecification[];
    outputs: PortSpecification[];
    params:  ParameterSpecification[];
}

const P = (key: string, label: string, type: PortType): PortSpecification => ({ key, label, type });
const V = (key: string, label: string, min: number, max: number, step: number, value: number, suffix = ''):
    ParameterSpecification => ({ key, label, min, max, step, value, suffix });

//--------------------------------------------------------------------------------------------------------------------------
export const NodeCatalogue: NodeSpecification[] =
[
    //---------------------------------------------------------------- Generators
    {
        id: 'simplex', name: 'Simplex Noise', kind: 'Generator', glyph: 'noise', group: 'Generators',
        desc: 'Continuous 2D/3D noise',
        inputs:  [P('seed', 'Seed', 'scalar'), P('warp', 'Warp', 'vector')],
        outputs: [P('height', 'Height', 'field')],
        params:  [V('scale', 'Scale', 0.01, 8, 0.01, 1.4, '×'), V('octaves', 'Octaves', 1, 12, 1, 6),
                  V('gain', 'Gain', 0, 1, 0.01, 0.5)],
    },
    {
        id: 'perlin', name: 'Perlin Noise', kind: 'Generator', glyph: 'noise', group: 'Generators',
        desc: 'Classic gradient noise',
        inputs:  [P('seed', 'Seed', 'scalar')],
        outputs: [P('height', 'Height', 'field')],
        params:  [V('scale', 'Scale', 0.01, 8, 0.01, 2.0, '×'), V('lacunarity', 'Lacun.', 1, 4, 0.01, 2.0)],
    },
    {
        id: 'value', name: 'Value Noise', kind: 'Generator', glyph: 'noise', group: 'Generators',
        desc: 'Smooth interpolated noise',
        inputs:  [P('seed', 'Seed', 'scalar')],
        outputs: [P('height', 'Height', 'field')],
        params:  [V('scale', 'Scale', 0.01, 8, 0.01, 1.0, '×')],
    },
    {
        id: 'multifractal', name: 'MultiFractal', kind: 'Generator', glyph: 'noise', group: 'Generators',
        desc: 'Complex ridged noise',
        inputs:  [P('seed', 'Seed', 'scalar'), P('mask', 'Mask', 'field')],
        outputs: [P('height', 'Height', 'field')],
        params:  [V('ridge', 'Ridge', 0, 1, 0.01, 0.72), V('octaves', 'Octaves', 1, 14, 1, 8),
                  V('offset', 'Offset', -2, 2, 0.01, 0.35)],
    },
    {
        id: 'cellular', name: 'Cellular (Voronoi)', kind: 'Generator', glyph: 'grid', group: 'Generators',
        desc: 'Distance-based cellular noise',
        inputs:  [P('seed', 'Seed', 'scalar')],
        outputs: [P('height', 'Height', 'field'), P('cellId', 'Cell ID', 'scalar')],
        params:  [V('density', 'Density', 0.1, 10, 0.1, 3.0), V('jitter', 'Jitter', 0, 1, 0.01, 0.85)],
    },
    {
        id: 'white', name: 'White Noise', kind: 'Generator', glyph: 'noise', group: 'Generators',
        desc: 'Random static noise',
        inputs:  [P('seed', 'Seed', 'scalar')],
        outputs: [P('height', 'Height', 'field')],
        params:  [V('amplitude', 'Amp', 0, 4, 0.01, 1.0)],
    },

    //---------------------------------------------------------------- Primitives
    {
        id: 'sdf-sphere', name: 'SDF Sphere', kind: 'Primitive', glyph: 'circle', group: 'Primitives',
        desc: 'Sculptable distance sphere',
        inputs:  [P('centre', 'Centre', 'vector')],
        outputs: [P('sdf', 'Distance', 'field')],
        params:  [V('radius', 'Radius', 0.1, 200, 0.1, 8, ' m'),
                  V('posX', 'Pos X', -200, 200, 0.5, 0, ' m'), V('posY', 'Pos Y', -200, 200, 0.5, 8, ' m'),
                  V('posZ', 'Pos Z', -200, 200, 0.5, 0, ' m')],
    },
    {
        id: 'sdf-box', name: 'SDF Box', kind: 'Primitive', glyph: 'square', group: 'Primitives',
        desc: 'Sculptable rounded box',
        inputs:  [P('centre', 'Centre', 'vector')],
        outputs: [P('sdf', 'Distance', 'field')],
        params:  [V('extent', 'Extent', 0.1, 200, 0.1, 6, ' m'), V('round', 'Round', 0, 30, 0.1, 1.0, ' m'),
                  V('posX', 'Pos X', -200, 200, 0.5, 0, ' m'), V('posY', 'Pos Y', -200, 200, 0.5, 6, ' m'),
                  V('posZ', 'Pos Z', -200, 200, 0.5, 0, ' m')],
    },
    {
        id: 'sdf-plane', name: 'SDF Ground', kind: 'Primitive', glyph: 'sdf', group: 'Primitives',
        desc: 'Infinite ground half-space',
        inputs:  [P('normal', 'Normal', 'vector')],
        outputs: [P('sdf', 'Distance', 'field')],
        params:  [V('offset', 'Offset', -200, 200, 0.1, 0, ' m')],
    },
    {
        id: 'sdf-cylinder', name: 'SDF Cylinder', kind: 'Primitive', glyph: 'cylinder', group: 'Primitives',
        desc: 'Sculptable capped cylinder',
        inputs:  [P('centre', 'Centre', 'vector')],
        outputs: [P('sdf', 'Distance', 'field')],
        params:  [V('radius', 'Radius', 0.1, 200, 0.1, 4, ' m'), V('height', 'Height', 0.1, 200, 0.1, 12, ' m'),
                  V('posX', 'Pos X', -200, 200, 0.5, 0, ' m'), V('posY', 'Pos Y', -200, 200, 0.5, 6, ' m'),
                  V('posZ', 'Pos Z', -200, 200, 0.5, 0, ' m')],
    },

    //---------------------------------------------------------------- Combinators
    {
        id: 'union', name: 'Smooth Union', kind: 'Combinator', glyph: 'combine', group: 'Combinators',
        desc: 'Blended boolean union',
        inputs:  [P('a', 'A', 'field'), P('b', 'B', 'field')],
        outputs: [P('sdf', 'Distance', 'field')],
        params:  [V('smooth', 'Smooth', 0, 40, 0.1, 6.0, ' m')],
    },
    {
        id: 'subtract', name: 'Subtract', kind: 'Combinator', glyph: 'combine', group: 'Combinators',
        desc: 'Boolean difference A − B',
        inputs:  [P('a', 'A', 'field'), P('b', 'B', 'field')],
        outputs: [P('sdf', 'Distance', 'field')],
        params:  [V('smooth', 'Smooth', 0, 40, 0.1, 2.0, ' m')],
    },
    {
        id: 'intersect', name: 'Intersect', kind: 'Combinator', glyph: 'combine', group: 'Combinators',
        desc: 'Boolean intersection',
        inputs:  [P('a', 'A', 'field'), P('b', 'B', 'field')],
        outputs: [P('sdf', 'Distance', 'field')],
        params:  [V('smooth', 'Smooth', 0, 40, 0.1, 1.5, ' m')],
    },
    {
        id: 'mix', name: 'Mix Fields', kind: 'Combinator', glyph: 'layers', group: 'Combinators',
        desc: 'Weighted field blend',
        inputs:  [P('a', 'A', 'field'), P('b', 'B', 'field'), P('mask', 'Mask', 'field')],
        outputs: [P('out', 'Result', 'field')],
        params:  [V('weight', 'Weight', 0, 1, 0.01, 0.5)],
    },

    //---------------------------------------------------------------- Deformers
    {
        id: 'warp', name: 'Domain Warp', kind: 'Deformer', glyph: 'warp', group: 'Deformers',
        desc: 'Offsets sample coordinates',
        inputs:  [P('in', 'Field', 'field'), P('vec', 'Vector', 'vector')],
        outputs: [P('out', 'Field', 'field')],
        params:  [V('strength', 'Strength', 0, 60, 0.1, 8.0, ' m'), V('scale', 'Scale', 0.01, 6, 0.01, 0.8, '×')],
    },
    {
        id: 'terrace', name: 'Terrace', kind: 'Deformer', glyph: 'layers', group: 'Deformers',
        desc: 'Quantises height into steps',
        inputs:  [P('in', 'Field', 'field')],
        outputs: [P('out', 'Field', 'field')],
        params:  [V('steps', 'Steps', 2, 64, 1, 12), V('sharp', 'Sharp', 0, 1, 0.01, 0.6)],
    },
    // Erode node removed 2026-05-14 — see docs/Erosion-Attempts-and-Failures.md
    // All 7 SDF erosion algorithms (heightfield pillar, mesh icosphere shred/hybrid,
    // SDF heightfield, 68³-128³ voxels, y-weighted 512² dome) produced pillars / holes /
    // blocky 0.38m voxels / fence curtains. Code deleted: src/erosion/*, sdfPass uErosion*,
    // main ErosionPreview panel. Node kept hidden for old saves — not shown in palette filter.

    {
        id: 'displace', name: 'Displace', kind: 'Deformer', glyph: 'warp', group: 'Deformers',
        desc: 'Adds a field along the normal',
        inputs:  [P('in', 'Field', 'field'), P('by', 'Amount', 'field')],
        outputs: [P('out', 'Field', 'field')],
        params:  [V('gain', 'Gain', -20, 20, 0.1, 3.0, ' m')],
    },

    //---------------------------------------------------------------- Texturing
    {
        id: 'slope-mask', name: 'Slope Mask', kind: 'Texturing', glyph: 'texture', group: 'Texturing',
        desc: 'Gradient-angle selection mask',
        inputs:  [P('in', 'Field', 'field')],
        outputs: [P('mask', 'Mask', 'field')],
        params:  [V('min', 'Min', 0, 90, 0.5, 18, '°'), V('max', 'Max', 0, 90, 0.5, 54, '°'),
                  V('feather', 'Feather', 0, 30, 0.5, 8, '°')],
    },
    {
        id: 'height-mask', name: 'Height Mask', kind: 'Texturing', glyph: 'texture', group: 'Texturing',
        desc: 'Altitude band selection',
        inputs:  [P('in', 'Field', 'field')],
        outputs: [P('mask', 'Mask', 'field')],
        params:  [V('low', 'Low', -200, 400, 0.5, 20, ' m'), V('high', 'High', -200, 400, 0.5, 140, ' m')],
    },
    {
        id: 'material', name: 'Material Layer', kind: 'Texturing', glyph: 'texture', group: 'Texturing',
        desc: 'Binds albedo to a mask',
        inputs:  [P('mask', 'Mask', 'field'), P('albedo', 'Albedo', 'colour')],
        outputs: [P('layer', 'Layer', 'colour')],
        params:  [V('roughness', 'Rough', 0, 1, 0.01, 0.82), V('tiling', 'Tiling', 0.1, 40, 0.1, 6.0, '×')],
    },

    //---------------------------------------------------------------- Output
    {
        id: 'terrain-out', name: 'Terrain Output', kind: 'Output', glyph: 'output', group: 'Output',
        desc: 'Final surface written to viewport',
        inputs:  [P('sdf', 'Distance', 'field'), P('shade', 'Shading', 'colour')],
        outputs: [],
        params:  [V('resolution', 'Res', 32, 1024, 32, 256, ' px'), V('isoLevel', 'Iso', -10, 10, 0.05, 0, ' m')],
    },
    {
        id: 'start', name: 'Start', kind: 'Entry Point', glyph: 'cube', group: 'Output',
        desc: 'Graph entry point',
        inputs:  [],
        outputs: [P('flow', 'Flow', 'flow')],
        params:  [],
    },
];

export const CatalogueIndex = new Map(NodeCatalogue.map((n) => [n.id, n]));

export const GroupOrder = ['Generators', 'Primitives', 'Combinators', 'Deformers', 'Texturing', 'Output'];

export const GroupGlyphs: Record<string, string> = {
    Generators:  'sparkles',
    Primitives:  'sdf',
    Combinators: 'combine',
    Deformers:   'warp',
    Texturing:   'layers',
    Output:      'output',
};
