//==========================================================================================
// Thermal weathering — talus relaxation, plus the buffer resets that bracket every step.
//
// Why a column pass instead of a voxel pass: the angle of repose describes the free surface,
// and the free surface of a column is exactly what the elevation plane already stores. Each
// column evaluates the *same* flux expression for its neighbours that they evaluate for it,
// so losses and gains cancel to the last bit and material can neither appear nor vanish.
// The result is booked as a vertical change, which the apply pass converts to a normal
// displacement — the same path rivers use, so talus and alluvium behave alike.
//==========================================================================================

import { COMMON } from './common.js';
import { SIM_BINDINGS } from './bindings.js';

const TALUS_SHELL = /* wgsl */ `
// Volume moved from column a to column b in one step [m3]. Both endpoints evaluate this
// identical expression with identical inputs, which is what keeps the mass balance exact.
fn talusFlux(hardA : f32, hA : f32, hB : f32, span : f32, repose : f32, rate : f32) -> f32
{
    let drop = (hA - hB) / max(span, 1e-4);
    let excess = drop - repose;
    if (excess <= 0.0)
    {
        return 0.0;
    }
    let rigidity = 1.0 / (0.4 + max(hardA, 0.05));
    let distance = clamp(excess / max(repose, 0.2), 0.0, 3.0);
    return rate * rigidity * distance * span * span;
}
`;

const BODY = /* wgsl */ `
const TALUS_STEPS : array<vec2i, 8> = array<vec2i, 8>(
    vec2i(1, 0), vec2i(-1, 0), vec2i(0, 1), vec2i(0, -1),
    vec2i(1, 1), vec2i(-1, 1), vec2i(1, -1), vec2i(-1, -1));

@compute @workgroup_size(8, 8)
fn thermalStep(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    let cell = vec2i(gid.xy);
    if (any(cell >= vec2i(g)))
    {
        return;
    }

    let rate = frame.thermal.y;
    if (frame.thermal.w < 0.5 || rate <= 0.0)
    {
        gridStore(G_THERMAL, cell.x, cell.y, 0.0);
        return;
    }

    let span = cellSpan();
    let area = max(span * span, 1e-6);
    let repose = clamp(frame.thermal.x, 0.26, 2.5);
    let h = gridAt(G_ELEVATION, cell.x, cell.y);
    let hard = gridAt(G_HARDNESS, cell.x, cell.y);

    var net = 0.0;
    for (var i = 0; i < 8; i = i + 1)
    {
        let step = TALUS_STEPS[i];
        let other = cell + step;
        if (any(other < vec2i(0)) || any(other >= vec2i(g)))
        {
            continue;
        }
        let diagonal = (abs(step.x) + abs(step.y)) == 2;
        let dist = select(span, span * 1.41421356, diagonal);
        let hOther = gridAt(G_ELEVATION, other.x, other.y);
        let hardOther = gridAt(G_HARDNESS, other.x, other.y);
        let outward = talusFlux(hard, h, hOther, dist, repose, rate);
        let inward = talusFlux(hardOther, hOther, h, dist, repose, rate);
        // Positive means material left this column, which is the convention the planar delta
        // field uses: the apply pass adds both to the distance field, where a positive value
        // is the surface retreating. Signing this the other way made talus pile material into
        // the places it should have emptied.
        net += (outward - inward) / area;
    }
    let limit = max(frame.transport.w, 0.02) * frame.worldLo.w * 1.5;
    gridStore(G_THERMAL, cell.x, cell.y, clamp(net, -limit, limit));
}

// Zero the signed-delta accumulator. The planar change field is rebuilt by the surface scan,
// so only the voxel-sized particle brush needs an explicit clear.
@compute @workgroup_size(256)
fn clearDeltas(@builtin(global_invocation_id) gid : vec3u)
{
    let total = u32(frame.dims.x) * u32(frame.dims.y) * u32(frame.dims.z);
    let index = gid.x;
    if (index >= total)
    {
        return;
    }
    atomicStore(&deltas[index], 0);
}

// Reset the telemetry counters at the head of every step.
@compute @workgroup_size(1)
fn clearCounters()
{
    for (var i = 0u; i < 16u; i = i + 1u)
    {
        atomicStore(&counters[i], 0u);
    }
}
`;

export function thermalShader()
{
    return `${COMMON}\n${SIM_BINDINGS}\n${TALUS_SHELL}\n${BODY}`;
}

export const THERMAL_MODULE = thermalShader();
