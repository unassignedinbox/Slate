//==========================================================================================
// Surface + climate + wind passes.
//
//   surfaceScan : per column, sphere-trace down the volume to find the top solid surface and
//                 cache its hardness. This is why hydrology works on real 3D geometry: the
//                 elevation comes from the SDF, not from a stored heightmap.
//   climatePass : rainfall (graph climate mask), snow accumulation/ablation by elevation,
//                 soil moisture. Snowfields feed rivers long after the rain stops.
//   windPass    : upwind exposure sampling produces a deflected wind field. Ridges accelerate,
//                 lee slopes shelter; the field drives saltation, abrasion and loess deposit.
//==========================================================================================

import { COMMON } from './common.js';
import { SIM_BINDINGS, FIELD_WRITE_HELPERS } from './bindings.js';
import { GRAPH_STUB } from './graphStub.js';

const BODY = /* wgsl */ `
//------------------------------------------------------------------------------------------
// Column scan
//------------------------------------------------------------------------------------------
@compute @workgroup_size(8, 8, 1)
fn surfaceScan(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let w = hydCellWorld(x, z);

    var y = frame.worldHi.y - voxelSize();
    var hit = 0.0;
    let eps = voxelSize() * 0.35;
    for (var i = 0; i < 96; i = i + 1)
    {
        let p = vec3f(w.x, y, w.y);
        let d = terrainAt(sdfIn, p);
        if (d < eps)
        {
            hit = 1.0;
            break;
        }
        y = y - clamp(d * 0.8, voxelSize() * 0.35, voxelSize() * 4.0);
        if (y < frame.worldLo.y)
        {
            break;
        }
    }

    if (hit < 0.5)
    {
        gridStore(G_ELEVATION, x, z, frame.worldLo.y);
        gridStore(G_HARDNESS, x, z, 0.0);
        return;
    }

    // Two refinement steps to land on the trilinear zero crossing.
    for (var k = 0; k < 3; k = k + 1)
    {
        let d = terrainAt(sdfIn, vec3f(w.x, y, w.y));
        if (abs(d) < voxelSize() * 0.02)
        {
            break;
        }
        y = y - d * 0.9;
    }

    gridStore(G_ELEVATION, x, z, y);
    let q = vec3i(clamp(floor(worldToGrid(vec3f(w.x, y, w.y))), vec3f(0.0), gridDimsF() - vec3f(1.0)));
    let mat = textureLoad(matIn, q, 0);
    gridStore(G_HARDNESS, x, z, mat.x);
    // Alluvium cover is retained between steps and only decays slowly when not re-deposited.
    let cover = gridAt(G_COVER, x, z);
    gridStore(G_COVER, x, z, max(cover * 0.995, mat.w));
}

//------------------------------------------------------------------------------------------
// Climate
//------------------------------------------------------------------------------------------
@compute @workgroup_size(8, 8, 1)
fn climatePass(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let w = hydCellWorld(x, z);
    let elev = gridAt(G_ELEVATION, x, z);
    let dt = frame.sims.x;

    let mask = clamp(graphRainMask(vec3f(w.x, elev, w.y)), 0.0, 1.0);
    let rain = frame.sims.z * mask;
    gridStore(G_RAIN, x, z, rain);

    // Temperature lapse: snow accumulates above the snowline and melts below it.
    let snowline = frame.climate.x;
    let lapse = frame.climate.y;
    let temp = 12.0 - (elev - frame.worldLo.y) * lapse;
    var snow = gridAt(G_SNOW, x, z);
    var water = gridAt(G_WATER, x, z);

    if (temp < 0.0)
    {
        // Cold: precipitation is stored as snowpack, not delivered to the river.
        snow = snow + rain * dt * 8.0 * clamp(-temp * 0.35, 0.05, 1.0);
    }
    else
    {
        let melt = min(snow, (0.6 + temp * 0.55) * dt * 0.00004 * frame.climate.z);
        snow = snow - melt;
        water = water + melt * 4.0;
    }
    gridStore(G_SNOW, x, z, max(snow, 0.0));

    // Infiltration: dry soil absorbs the first water, saturated soil routes it.
    var wet = gridAt(G_WETNESS, x, z);
    // Rainfall [m] over this step, minus what the soil takes up. The rest is runoff and is
    // routed downhill; on dry ground most of a light shower infiltrates, on saturated ground
    // almost nothing does.
    let rainVolume = rain * dt;
    let absorbed = rainVolume * (1.0 - wet) * 0.55;
    water = water + (rainVolume - absorbed);
    wet = clamp(wet + absorbed * 40.0 - frame.sims.w * dt * 0.02, 0.0, 1.0);
    gridStore(G_WETNESS, x, z, wet);
    gridStore(G_WATER, x, z, max(water, 0.0));
}

//------------------------------------------------------------------------------------------
// Wind field: upwind exposure + cross-slope deflection
//------------------------------------------------------------------------------------------
@compute @workgroup_size(8, 8, 1)
fn windPass(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let span = cellSpan();
    let dir = frame.aeolian.y;
    let ux = cos(dir);
    let uz = sin(dir);
    let here = gridAt(G_ELEVATION, x, z);

    // Sample the terrain upwind: positive exposure means we are standing on the ridge.
    var exposure = 0.0;
    var weight = 1.0;
    for (var i = 0; i < 8; i = i + 1)
    {
        let d = span * (2.0 * pow(1.7, f32(i)));
        let sx = x - i32(round(ux * d / span));
        let sz = z - i32(round(uz * d / span));
        let other = gridAt(G_ELEVATION, sx, sz);
        exposure = exposure + (here - other) / d * weight;
        weight = weight * 0.82;
    }
    exposure = clamp(exposure * 0.55, -1.5, 1.5);

    // Slope-driven deflection: wind bends around hills rather than through them.
    let hx = gridAt(G_ELEVATION, x + 1, z) - gridAt(G_ELEVATION, x - 1, z);
    let hz = gridAt(G_ELEVATION, x, z + 1) - gridAt(G_ELEVATION, x, z - 1);
    let defl = vec2f(-hz, hx) / max(span * 2.0, 1e-4);
    var wdir = normalize(vec2f(ux, uz) + defl * 0.85 + vec2f(1e-6, 0.0));
    let speed = frame.aeolian.x * clamp(1.0 + exposure * 0.85, 0.12, 2.6);

    gridStore(G_EXPOSURE, x, z, exposure);
    gridStore(G_WINDSPEED, x, z, speed);
    // Direction is published through the momentum planes so particles can read one field.
    gridStore(G_WINDDIRX, x, z, wdir.x);
    gridStore(G_WINDDIRZ, x, z, wdir.y);
}
`;

export function surfaceShader(graph = GRAPH_STUB)
{
    return `${COMMON}\n${SIM_BINDINGS}\n${FIELD_WRITE_HELPERS}\n${BODY}\n${graph}`;
}

export const SURFACE_MODULE = surfaceShader();
