//==========================================================================================
// Shared simulation bindings (group 0). Every solver pass declares this same set so a single
// bind group layout and one pair of ping-pong bind groups serve the whole pipeline.
//   binding 0  Frame uniform
//   binding 1  graph parameter block
//   binding 2  sdfIn   texture_3d<f32>          (read)
//   binding 3  matIn   texture_3d<f32>          (read, rgba16f)
//   binding 4  linear sampler
//   binding 5  sdfOut  texture_storage_3d<r32float, write>
//   binding 6  matOut  texture_storage_3d<rgba16float, write>
//   binding 7  deltas  array<atomic<i32>>       (fixed-point micrometres, + = erosion)
//   binding 8  particles array<Particle>
//   binding 9  grid    array<f32>               (planar hydrology/climate fields)
//   binding 10 gridAtomic array<atomic<i32>>
//   binding 11 counters  array<atomic<u32>>
//   binding 12 waterOut  texture_storage_2d<rgba16float, write>
//   binding 13 waterOut2 texture_storage_2d<rgba16float, write>
//==========================================================================================

import { gridConsts } from '../gridPlanes.js';

export const SIM_BINDINGS = /* wgsl */ `
@group(0) @binding(2) var sdfIn : texture_3d<f32>;
@group(0) @binding(3) var matIn : texture_3d<f32>;
@group(0) @binding(4) var linearSampler : sampler;
@group(0) @binding(5) var sdfOut : texture_storage_3d<r32float, write>;
@group(0) @binding(6) var matOut : texture_storage_3d<rgba16float, write>;
@group(0) @binding(7) var<storage, read_write> deltas : array<atomic<i32>>;
@group(0) @binding(8) var<storage, read_write> particles : array<Particle>;
@group(0) @binding(9) var<storage, read_write> grid : array<f32>;
@group(0) @binding(10) var<storage, read_write> gridAtomic : array<atomic<i32>>;
@group(0) @binding(11) var<storage, read_write> counters : array<atomic<u32>>;
@group(0) @binding(12) var waterOut : texture_storage_2d<rgba16float, write>;
@group(0) @binding(13) var waterOut2 : texture_storage_2d<rgba16float, write>;

${gridConsts()}

// Counter slots
const C_ERODED     : u32 = 0u;   // fixed-point m3 of solid removed
const C_DEPOSITED  : u32 = 1u;   // fixed-point m3 of solid added
const C_CARRIED    : u32 = 2u;   // fixed-point m3 currently suspended in particles
const C_ESCAPED    : u32 = 3u;   // fixed-point m3 exported past the domain boundary
const C_ALIVE      : u32 = 4u;   // live particle count
const C_DEAD       : u32 = 5u;   // particles that finished this step
const C_SPAWNED    : u32 = 6u;   // particles born this step
const C_PEAKDELTA  : u32 = 7u;   // largest single-step surface change (fixed-point m)

fn gridAt(plane : u32, x : i32, z : i32) -> f32
{
    let g = i32(frame.dims.w);
    return grid[plane * u32(g * g) + hydIndex(x, z)];
}

fn gridStore(plane : u32, x : i32, z : i32, v : f32)
{
    let g = i32(frame.dims.w);
    grid[plane * u32(g * g) + hydIndex(x, z)] = v;
}

fn gridAtWorld(plane : u32, p : vec2f) -> f32
{
    let g = f32(frame.dims.w);
    let dx = (frame.worldHi.x - frame.worldLo.x) / g;
    let dz = (frame.worldHi.z - frame.worldLo.z) / g;
    let x = i32(floor((p.x - frame.worldLo.x) / dx));
    let z = i32(floor((p.y - frame.worldLo.z) / dz));
    return gridAt(plane, x, z);
}

// Atomic grid blocks (fixed-point, since WGSL has no float atomics).
const AB_WATER    : u32 = 0u;   // water volume routed into the cell [m3] x 1000
const AB_SEDIMENT : u32 = 1u;   // sediment volume routed into the cell [m3] x 1000000

fn atomSlot(block : u32, x : i32, z : i32) -> u32
{
    let g = u32(hydGridSize());
    return block * g * g + hydIndex(x, z);
}

fn hydGridSize() -> i32
{
    return i32(frame.dims.w);
}

fn cellArea() -> f32
{
    let g = f32(frame.dims.w);
    let dx = (frame.worldHi.x - frame.worldLo.x) / g;
    let dz = (frame.worldHi.z - frame.worldLo.z) / g;
    return dx * dz;
}

fn cellSpan() -> f32
{
    let g = f32(frame.dims.w);
    return (frame.worldHi.x - frame.worldLo.x) / g;
}

// WGSL forbids passing pointers to atomic types into user functions, so conversions are
// inlined at each call site (see apply.js / hydrology.js / particles.js).
`;

// Shared helpers used by every 3D solver pass that writes the volumetric field.
export const FIELD_WRITE_HELPERS = /* wgsl */ `
// Band-limited signed-distance offset. Because phi is offset (never voxel occupancy), the
// surface stays a smooth manifold: no pitting, no bulging, no brush scallops.
fn bandWeight(phi : f32, band : f32) -> f32
{
    return 1.0 - smoothstep(0.0, band, abs(phi));
}

fn saturatedLimit() -> f32
{
    // Field magnitude cap (metres). The marcher's per-step cap is strictly below this, so
    // sphere tracing stays conservative even in the saturated far field.
    return voxelSize() * 6.5;
}

fn gradientAt(tex : texture_3d<f32>, q : vec3i) -> vec3f
{
    let d = vec3i(frame.dims.xyz);
    let xm = textureLoad(tex, clamp(q - vec3i(1, 0, 0), vec3i(0), d - vec3i(1)), 0).r;
    let xp = textureLoad(tex, clamp(q + vec3i(1, 0, 0), vec3i(0), d - vec3i(1)), 0).r;
    let ym = textureLoad(tex, clamp(q - vec3i(0, 1, 0), vec3i(0), d - vec3i(1)), 0).r;
    let yp = textureLoad(tex, clamp(q + vec3i(0, 1, 0), vec3i(0), d - vec3i(1)), 0).r;
    let zm = textureLoad(tex, clamp(q - vec3i(0, 0, 1), vec3i(0), d - vec3i(1)), 0).r;
    let zp = textureLoad(tex, clamp(q + vec3i(0, 0, 1), vec3i(0), d - vec3i(1)), 0).r;
    return vec3f(xp - xm, yp - ym, zp - zm) * (0.5 / voxelSize());
}

fn fieldAt(tex : texture_3d<f32>, q : vec3i) -> f32
{
    let d = vec3i(frame.dims.xyz);
    return textureLoad(tex, clamp(q, vec3i(0), d - vec3i(1)), 0).r;
}
`;
