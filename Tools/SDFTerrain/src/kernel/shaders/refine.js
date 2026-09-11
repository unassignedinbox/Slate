//==========================================================================================
// Narrow-band re-distancing. Every few steps the field is rebuilt as |grad phi| ~ 1 within a
// band around the *current* zero set. Locating the interface happens by sign change along the
// sampled gradient direction (robust even when the stored field has been offset many times),
// then a short bisection refines the crossing. Values farther than the band saturate, which
// keeps sphere tracing conservative: the marcher's per-step cap is below the saturation value.
//==========================================================================================

import { COMMON } from './common.js';
import { SIM_BINDINGS, FIELD_WRITE_HELPERS } from './bindings.js';

const BODY = /* wgsl */ `
const REFINE_RADIUS : f32 = 6.5;      // band half-width in voxels (matches saturatedLimit)
const MARCH_STEPS   : i32 = 13;       // 0.55 voxel march steps -> 7 voxel reach
const BISECT_STEPS  : i32 = 4;

// Contiguous access along Z is the fastest axis for volume textures, so the search marches in
// small steps and stops at the first sign change; cost is paid only near the interface.
@compute @workgroup_size(4, 4, 4)
fn refineBand(@builtin(global_invocation_id) gid : vec3u)
{
    let dims = vec3i(frame.dims.xyz);
    let q = vec3i(gid);
    if (any(q >= dims))
    {
        return;
    }

    let vox = voxelSize();
    let lim = vox * REFINE_RADIUS;
    let p = gridToWorld(vec3f(q));
    let phi0 = terrainAt(sdfIn, p);
    let sgn = select(-1.0, 1.0, phi0 > 0.0);

    // Deep in the saturated exterior there is nothing to rebuild: copy through.
    if (abs(phi0) >= lim * 0.96)
    {
        // One cheap probe: a sign change within a single voxel means the interface arrived.
        let probe = terrainAt(sdfIn, p + vec3f(0.0, -sgn * vox * 1.25, 0.0));
        let grad0 = gradientAt(sdfIn, q);
        let gl0 = length(grad0);
        let nx = select(vec3f(0.0, 1.0, 0.0), grad0 / gl0, gl0 > 1e-6);
        let probe2 = terrainAt(sdfIn, p - nx * sgn * vox * 1.25);
        let near = min(abs(probe), abs(probe2));
        if (near >= lim * 0.96)
        {
            textureStore(sdfOut, q, vec4f(clamp(phi0, -lim, lim), 0.0, 0.0, 0.0));
            textureStore(matOut, q, textureLoad(matIn, q, 0));
            return;
        }
    }

    var dir = vec3f(0.0, 1.0, 0.0);
    let grad = gradientAt(sdfIn, q);
    let gl = length(grad);
    if (gl > 1e-6)
    {
        dir = grad / gl;
    }
    // The surface is opposite the outward gradient direction.
    dir = -dir * sgn;

    let step = vox * 0.55;
    var t = 0.0;
    var v = phi0;
    var found = false;
    var cross = 0.0;

    for (var i = 0; i < MARCH_STEPS; i = i + 1)
    {
        let nt = t + step;
        let nv = terrainAt(sdfIn, p + dir * nt);
        if (nv * v <= 0.0)
        {
            var a = t;
            var b = nt;
            var va = v;
            for (var k = 0; k < BISECT_STEPS; k = k + 1)
            {
                let m = 0.5 * (a + b);
                let vm = terrainAt(sdfIn, p + dir * m);
                if (vm * va <= 0.0)
                {
                    b = m;
                }
                else
                {
                    a = m;
                    va = vm;
                }
            }
            cross = 0.5 * (a + b);
            found = true;
            break;
        }
        t = nt;
        v = nv;
    }

    var outPhi = -sign(phi0) * lim;
    if (found)
    {
        outPhi = sign(phi0) * min(cross, lim);
    }
    else
    {
        // No crossing inside the search reach: this voxel is interior or exterior far field.
        // Saturation keeps the marcher safe and re-arms the band once the interface arrives.
        outPhi = sign(phi0) * lim * 0.98;
    }

    textureStore(sdfOut, q, vec4f(clamp(outPhi, -lim, lim), 0.0, 0.0, 0.0));
    textureStore(matOut, q, textureLoad(matIn, q, 0));
}
`;

export function refineShader()
{
    return `${COMMON}\n${SIM_BINDINGS}\n${FIELD_WRITE_HELPERS}\n${BODY}`;
}

export const REFINE_MODULE = refineShader();
