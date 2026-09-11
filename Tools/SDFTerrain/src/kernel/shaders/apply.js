//==========================================================================================
// Field application — the single point where the volumetric signed distance field changes.
//
// Why this shape: erosion and deposition are expressed as a *signed offset of the distance
// field* inside a smooth band around the zero set, not as voxel occupancy add/subtract. An
// offset moves the surface along its own normal, so slopes stay slopes: no scallops, no
// pitting, no "pushed/pulled" bulges from overlapping particle brushes. Total movement per
// step is clamped to a fraction of a voxel, and the narrow-band re-distancing pass
// (refine.js) restores |grad phi| ~ 1 afterwards.
//==========================================================================================

import { COMMON } from './common.js';
import { SIM_BINDINGS, FIELD_WRITE_HELPERS } from './bindings.js';

const BODY = /* wgsl */ `
@compute @workgroup_size(4, 4, 4)
fn applyDeltas(@builtin(global_invocation_id) gid : vec3u)
{
    let dims = vec3i(frame.dims.xyz);
    let q = vec3i(gid);
    if (any(q >= dims))
    {
        return;
    }

    let vox = voxelSize();
    let phiIn = fieldAt(sdfIn, q);
    let mat = textureLoad(matIn, q, 0);
    let band = vox * 2.5;
    let w = bandWeight(phiIn, band);

    var phi = phiIn;
    var deposit = mat.y;
    var cover = mat.w;
    var wet = mat.z;

    if (w > 0.004)
    {
        // Particle / thermal contribution: already normal-displacement metres, + = erosion.
        let d3 = f32(atomicLoad(&deltas[volumeIndex(q)])) * (1.0 / FIXED_SCALE);

        // Planar contribution: a vertical surface change converts to a normal displacement
        // by |n.y| (a vertical wall barely retreats when its top is lowered).
        let g = hydGridSize();
        let hx = i32(f32(q.x) * f32(g) / f32(dims.x));
        let hz = i32(f32(q.z) * f32(g) / f32(dims.z));
        var colDelta = gridAt(G_DELTA, hx, hz);
        let grad = gradientAt(sdfIn, q);
        let gl = length(grad);
        let ny = select(1.0, abs(grad.y / gl), gl > 1e-6);
        colDelta = colDelta * clamp(ny, 0.12, 1.0);

        // Talus relaxation books a vertical height change the same way rivers do.
        let talus = gridAt(G_THERMAL, hx, hz) * clamp(ny, 0.12, 1.0);
        var total = (d3 + colDelta + talus) * w;
        let maxStep = max(frame.transport.w, 0.02) * vox;
        total = clamp(total, -maxStep, maxStep);
        phi = phiIn + total;

        if (total > 0.0)
        {
            // Eroded: remove loose cover first, then cut into bedrock.
            deposit = max(deposit - total, 0.0);
            atomicAdd(&counters[C_ERODED], u32(max(total, 0.0) * vox * vox * vox * FIXED_SCALE * 0.001));
        }
        else
        {
            deposit = deposit - total;
            atomicAdd(&counters[C_DEPOSITED], u32(max(-total, 0.0) * vox * vox * vox * FIXED_SCALE * 0.001));
        }
        cover = clamp(deposit / max(vox * 1.5, 1e-4), 0.0, 1.0);

        // Soil moisture: planar wetness plus standing water, faded below the surface so the
        // interior does not glow wet through thin walls.
        let water = gridAt(G_WATER, hx, hz);
        let moist = gridAt(G_WETNESS, hx, hz);
        let surfaceFade = smoothstep(-vox * 2.0, vox * 0.25, phi);
        wet = clamp((moist + water * 0.45) * surfaceFade, 0.0, 1.0);
    }

    let lim = saturatedLimit();
    textureStore(sdfOut, q, vec4f(clamp(phi, -lim, lim), 0.0, 0.0, 0.0));
    textureStore(matOut, q, vec4f(mat.x, clamp(deposit, 0.0, 512.0), clamp(wet, 0.0, 1.0), cover));
}
`;

export function applyShader()
{
    return `${COMMON}\n${SIM_BINDINGS}\n${FIELD_WRITE_HELPERS}\n${BODY}`;
}

export const APPLY_MODULE = applyShader();
