//==========================================================================================
// Graph bake — evaluates the compiled node graph into the volumetric SDF and its material
// companion. Supports a block stride so live parameter edits re-bake at 1/8 or 1/64 cost.
//==========================================================================================

import { COMMON } from './common.js';
import { GRAPH_STUB } from './graphStub.js';

const BINDINGS = /* wgsl */ `
@group(0) @binding(2) var sdfIn : texture_3d<f32>;
@group(0) @binding(3) var matIn : texture_3d<f32>;
@group(0) @binding(4) var linearSampler : sampler;
@group(0) @binding(5) var sdfOut : texture_storage_3d<r32float, write>;
@group(0) @binding(6) var matOut : texture_storage_3d<rgba16float, write>;
`;

const BODY = /* wgsl */ `
struct BakeParams
{
    stride    : u32,
    zFirst    : u32,
    zCount    : u32,
    reserved  : u32,
};

@group(0) @binding(7) var<storage, read_write> deltas : array<atomic<i32>>;
@group(0) @binding(8) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(9) var<storage, read_write> grid : array<f32>;
@group(0) @binding(10) var<storage, read_write> gridAtomic : array<atomic<i32>>;
@group(0) @binding(11) var<storage, read_write> counters : array<atomic<u32>>;
@group(0) @binding(12) var waterOut : texture_storage_2d<rgba16float, write>;

fn boxFaceDistance(p : vec3f) -> f32
{
    let d = min(p - frame.worldLo.xyz, frame.worldHi.xyz - p);
    return min(min(d.x, d.y), d.z);
}

// Evaluated once per stride-aligned block; the block shares the value. Coarse strides keep
// interactive graph editing affordable, and the marcher filters the blocky field smoothly.
@compute @workgroup_size(4, 4, 4)
fn bakeGraph(@builtin(global_invocation_id) gid : vec3u)
{
    let dims = frame.dims.xyz;
    let stride = max(frame.flags.w >> 16u, 1u);
    let block = gid * stride;
    if (any(block >= dims))
    {
        return;
    }
    let zLo = frame.flags.w & 65535u;
    let zHi = zLo + u32(frame.stats.w);
    if (block.z < zLo || block.z >= zHi)
    {
        return;
    }

    // Sample at the block centre for a symmetric footprint.
    let centre = gridToWorldCorner(vec3f(block)) + vec3f(voxelSize() * f32(stride) * 0.5);
    var phi = graphSdf(centre);
    phi = min(phi, max(boxFaceDistance(centre), 0.0));
    let hardness = clamp(graphHardness(centre), 0.0, 1.0);
    let rock = vec4f(hardness, 0.0, 0.0, 0.0);

    for (var z = 0u; z < stride; z = z + 1u)
    {
        for (var y = 0u; y < stride; y = y + 1u)
        {
            for (var x = 0u; x < stride; x = x + 1u)
            {
                let q = block + vec3u(x, y, z);
                if (any(q >= dims))
                {
                    continue;
                }
                textureStore(sdfOut, vec3i(q), vec4f(phi, 0.0, 0.0, 0.0));
                textureStore(matOut, vec3i(q), rock);
            }
        }
    }
}
`;

export function bakeShader(graph = GRAPH_STUB)
{
    return `${COMMON}\n${BINDINGS}\n${BODY}\n${graph}`;
}

export const BAKE_MODULE = bakeShader();
