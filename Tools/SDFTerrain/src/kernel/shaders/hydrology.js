//==========================================================================================
// Fluvial solver — a real drainage network, not a drawn river path.
//
//   hydFillSeed / hydFillStep : depression filling by relaxation toward the filled surface.
//                               Basins fill until they spill, so trunk rivers cross valleys
//                               while closed basins become lakes that overflow or evaporate.
//   flowRoute                 : steepest descent (D8) on the filled surface -> channel network,
//                               channel slope, downstream direction.
//   flowAccumulate            : flow accumulation by repeated pull relaxation (ping-pong),
//                               seeded from the previous step, so drainage area converges in a
//                               few iterations per step and stays consistent over time.
//   waterFlux / waterApply    : virtual-pipe overland flow with an open boundary. Velocity is
//                               derived from the actual water surface gradient and the routing
//                               field, so the water shader and river particles advect along the
//                               same field the erosion uses.
//   erodeDeposit              : stream power incision E = K * A^m * S^n, limited by bedrock
//                               hardness and alluvial cover (the cover effect), plus
//                               capacity-driven deposition, still-water settling (lake beds,
//                               deltas) and hillslope diffusion.
//   publishWater              : packs depth / velocity / turbidity for the renderer.
//
// Model sources are cited in RESEARCH.md (stream power law, Davy & Lague transport length,
// Mei et al. virtual pipes, Weiss voxel erosion, Hartley et al. flexible erosion).
//==========================================================================================

import { COMMON } from './common.js';
import { SIM_BINDINGS, FIELD_WRITE_HELPERS } from './bindings.js';
import { GRAPH_STUB } from './graphStub.js';

const BODY = /* wgsl */ `

const DIAG : f32 = 1.41421356;

// Contributing area, in cells, where sheet wash gives way to a channel, and how much of the
// hillslope erodibility survives below the threshold.
const GATE_LOW : f32 = 8.0;
const GATE_HIGH : f32 = 40.0;

fn inDomain(x : i32, z : i32) -> bool
{
    let g = hydGridSize();
    return x >= 0 && z >= 0 && x < g && z < g;
}

fn neighbourElevation(x : i32, z : i32) -> f32
{
    if (!inDomain(x, z))
    {
        // Open boundary: water and sediment leave the domain instead of piling up.
        return -1e7;
    }
    return gridAt(G_FILLED, x, z);
}

//------------------------------------------------------------------------------------------
// Depression filling
//------------------------------------------------------------------------------------------
@compute @workgroup_size(8, 8, 1)
fn hydFillSeed(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    gridStore(frame.push.y, x, z, gridAt(G_ELEVATION, x, z));
}

@compute @workgroup_size(8, 8, 1)
fn hydFillStep(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let src = frame.push.x;
    let dst = frame.push.y;
    let own = gridAt(G_ELEVATION, x, z);

    var low = 1e30;
    for (var dz = -1; dz <= 1; dz = dz + 1)
    {
        for (var dx = -1; dx <= 1; dx = dx + 1)
        {
            if (dx == 0 && dz == 0)
            {
                continue;
            }
            if (!inDomain(x + dx, z + dz))
            {
                low = min(low, -1e6);
                continue;
            }
            low = min(low, gridAt(src, x + dx, z + dz));
        }
    }
    gridStore(dst, x, z, max(own, low));
}

// Chebyshev distance to the open boundary of the map: a closed-form distance transform, no
// pass required, used as the tie-break that orders otherwise flat ground.
fn edgeDistance(x : i32, z : i32) -> i32
{
    let g = hydGridSize();
    return min(min(x, z), min(g - 1 - x, g - 1 - z));
}

fn cellOrder(x : i32, z : i32) -> i32
{
    return z * hydGridSize() + x;
}

// Lexicographic (elevation, edge distance, index) ordering. Routing to the smallest-key
// neighbour means every flow path strictly decreases a total order, which makes loops
// impossible — not merely unlikely. Loops are what make a drainage network produce rivers
// that flow in circles, so this is the difference between a real network and a plausible
// looking one.
fn keyBetter(wA : f32, eA : i32, iA : i32, wB : f32, eB : i32, iB : i32) -> bool
{
    if (wA < wB - 1e-7)
    {
        return true;
    }
    if (wA > wB + 1e-7)
    {
        return false;
    }
    if (eA != eB)
    {
        return eA < eB;
    }
    return iA < iB;
}

//------------------------------------------------------------------------------------------
// D8 routing
//------------------------------------------------------------------------------------------
@compute @workgroup_size(8, 8, 1)
fn flowRoute(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let span = cellSpan();
    let here = gridAt(G_FILLED, x, z);

    // Start from this cell's own key; a cell only routes if a neighbour is strictly better,
    // otherwise it is a sink and its water becomes a lake. Sinks are physically meaningful
    // (closed basins) and they cannot form a loop.
    var bestW = here;
    var bestEdge = edgeDistance(x, z);
    var bestIndex = cellOrder(x, z);
    var bx = 0.0;
    var bz = 0.0;
    // The routing may leave the map, but the incision law needs a real base level: the drop
    // toward the best neighbour that actually exists in the domain.
    var innerDrop = 0.0;

    for (var dz = -1; dz <= 1; dz = dz + 1)
    {
        for (var dx = -1; dx <= 1; dx = dx + 1)
        {
            if (dx == 0 && dz == 0)
            {
                continue;
            }
            let nx = x + dx;
            let nz = z + dz;
            let stepDist = span * select(DIAG, 1.0, dx == 0 || dz == 0);
            if (!inDomain(nx, nz))
            {
                // Leaving the map is always the lowest key: this is the open boundary that
                // lets rivers deliver their load to the edge of the world.
                if (keyBetter(-1e9, -1, -1, bestW, bestEdge, bestIndex))
                {
                    bestW = -1e9;
                    bestEdge = -1;
                    bestIndex = -1;
                    bx = f32(dx);
                    bz = f32(dz);
                }
                continue;
            }
            let w = gridAt(G_FILLED, nx, nz);
            let e = edgeDistance(nx, nz);
            let index = cellOrder(nx, nz);
            if (gridAt(G_ELEVATION, nx, nz) < gridAt(G_ELEVATION, x, z))
            {
                innerDrop = max(innerDrop, (gridAt(G_ELEVATION, x, z) - gridAt(G_ELEVATION, nx, nz)) / stepDist);
            }
            if (keyBetter(w, e, index, bestW, bestEdge, bestIndex))
            {
                bestW = w;
                bestEdge = e;
                bestIndex = index;
                bx = f32(dx);
                bz = f32(dz);
            }
        }
    }

    let descended = bestW < here - 1e-7;

    gridStore(G_FLOWX, x, z, bx);
    gridStore(G_FLOWZ, x, z, bz);
    gridStore(G_SLOPE, x, z, max(innerDrop, 0.0));
}

//------------------------------------------------------------------------------------------
// Flow accumulation
//------------------------------------------------------------------------------------------
@compute @workgroup_size(8, 8, 1)
fn flowAccumulate(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let src = frame.push.x;
    let dst = frame.push.y;
    let area = cellArea();

    // Discharge is rainfall plus whatever the upstream cells route in — and nothing else. An
    // earlier version also fed the standing water back in on every relaxation pass, which
    // multiplied the discharge by roughly one and a half per pass: the incision law then saw a
    // hundred times the water the sky supplied and cut a uniform honeycomb instead of valleys.
    var v = gridAt(G_RAIN, x, z) * frame.sims.x * area;

    for (var dz = -1; dz <= 1; dz = dz + 1)
    {
        for (var dx = -1; dx <= 1; dx = dx + 1)
        {
            if (dx == 0 && dz == 0)
            {
                continue;
            }
            let nx = x + dx;
            let nz = z + dz;
            if (!inDomain(nx, nz))
            {
                continue;
            }
            let fx = i32(round(gridAt(G_FLOWX, nx, nz)));
            let fz = i32(round(gridAt(G_FLOWZ, nx, nz)));
            if (fx == -dx && fz == -dz)
            {
                v = v + max(gridAt(src, nx, nz), 0.0);
            }
        }
    }
    // Hard ceiling: no cell can carry more water than falls on the entire map. Besides being
    // true, it makes the relaxation unconditionally stable even if the flow field ever
    // contains a loop (deposited flats are the usual way one appears).
    let cells = f32(hydGridSize()) * f32(hydGridSize());
    let ceiling = gridAt(G_RAIN, x, z) * frame.sims.x * area * cells;
    gridStore(dst, x, z, clamp(v, 0.0, max(ceiling, 1.0)));
}

//------------------------------------------------------------------------------------------
// Overland flow (virtual pipes)
//------------------------------------------------------------------------------------------
@compute @workgroup_size(8, 8, 1)
fn waterFlux(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let idx = hydIndex(x, z);
    let span = cellSpan();
    let area = cellArea();
    let dt = frame.sims.x;
    let water = gridAt(G_WATER, x, z);
    // Head measured on the filled surface: a lake in a closed basin then drains toward its
    // spill point instead of sitting on a perfectly flat bed for ever.
    let here = gridAt(G_FILLED, x, z) + water;

    gridStore(G_OUTFLOW, x, z, 0.0);
    if (water <= 1e-6)
    {
        return;
    }

    let budget = water * area;
    var weights : array<f32, 8>;
    var dirsX : array<i32, 8>;
    var dirsZ : array<i32, 8>;
    var totalWeight = 0.0;
    var k = 0;
    for (var dz = -1; dz <= 1; dz = dz + 1)
    {
        for (var dx = -1; dx <= 1; dx = dx + 1)
        {
            if (dx == 0 && dz == 0)
            {
                continue;
            }
            let h = neighbourElevation(x + dx, z + dz);
            let dist = span * select(DIAG, 1.0, dx == 0 || dz == 0);
            let drop = here - h;
            var w = 0.0;
            if (drop > 0.0)
            {
                w = sqrt(drop) * pow(max(water, 1e-4), 1.35) / dist;
            }
            weights[k] = w;
            dirsX[k] = dx;
            dirsZ[k] = dz;
            totalWeight = totalWeight + w;
            k = k + 1;
        }
    }

    var outflow = 0.0;
    var exported = 0.0;
    if (totalWeight > 0.0)
    {
        let flow = min(budget * 0.6, frame.transport.z * dt * span * totalWeight * area);
        for (var i = 0; i < 8; i = i + 1)
        {
            if (weights[i] <= 0.0)
            {
                continue;
            }
            let share = flow * weights[i] / totalWeight;
            let dx = dirsX[i];
            let dz = dirsZ[i];
            if (!inDomain(x + dx, z + dz))
            {
                exported = exported + share;
            }
            else
            {
                atomicAdd(&gridAtomic[atomSlot(AB_WATER, x + dx, z + dz)], i32(share * 1000.0));
            }
            outflow = outflow + share;
        }
    }
    gridStore(G_OUTFLOW, x, z, outflow);
    if (exported > 0.0)
    {
        atomicAdd(&counters[C_ESCAPED], u32(exported * FIXED_SCALE));
    }
}

@compute @workgroup_size(8, 8, 1)
fn waterApply(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let area = max(cellArea(), 1e-6);
    let span = cellSpan();
    let dt = frame.sims.x;

    let inflow = f32(atomicLoad(&gridAtomic[atomSlot(AB_WATER, x, z)])) * 0.001;
    atomicStore(&gridAtomic[atomSlot(AB_WATER, x, z)], 0);

    var depth = gridAt(G_WATER, x, z) - (gridAt(G_OUTFLOW, x, z) - inflow) / area;
    let wet = gridAt(G_WETNESS, x, z);
    depth = depth - max(depth, 0.0) * (frame.sims.w * dt + (1.0 - wet) * 0.0006);
    depth = clamp(depth, 0.0, 120.0);

    gridStore(G_WATER, x, z, depth);
}

// Velocity is published separately so the water surface it derives from is fully settled, and
// so the erosion pass downstream reads one consistent flow field.
@compute @workgroup_size(8, 8, 1)
fn waterVelocity(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let span = cellSpan();
    let dt = max(frame.sims.x, 1e-4);
    let storage = max(gridAt(G_WATER, x, z), 0.0);
    let fx = gridAt(G_FLOWX, x, z);
    let fz = gridAt(G_FLOWZ, x, z);

    // Discharge routed into this cell, converted to a channel cross-section. The exponent and
    // coefficients are the usual hydraulic geometry / Manning pair; RESEARCH.md cites them.
    let discharge = max(gridAt(frame.push.x, x, z), 0.0) / dt;
    let slope_ = max(gridAt(G_SLOPE, x, z), 1e-5);
    let width = clamp(2.0 * sqrt(max(discharge, 0.0)), span * 0.25, span);
    let rough = 0.035;
    let hydraulic = pow(discharge * rough / max(width * sqrt(slope_), 1e-6), 0.6);
    let depth = clamp(max(storage, min(hydraulic, slope_ * span * 4.0 + 0.05)), 0.0, 60.0);
    let velocity = clamp(pow(max(depth, 1e-4), 0.666667) * sqrt(slope_) / rough, 0.0, 12.0);

    // Downhill direction from the water surface, blended with the routed channel direction:
    // the channels are where the terrain already committed itself, the gradient is where the
    // standing water currently wants to go.
    let hx = (gridAt(G_ELEVATION, x + 1, z) + gridAt(G_WATER, x + 1, z))
           - (gridAt(G_ELEVATION, x - 1, z) + gridAt(G_WATER, x - 1, z));
    let hz = (gridAt(G_ELEVATION, x, z + 1) + gridAt(G_WATER, x, z + 1))
           - (gridAt(G_ELEVATION, x, z - 1) + gridAt(G_WATER, x, z - 1));
    let grad = vec2f(-hx, -hz) / max(span * 2.0, 1e-4);
    let routed = vec2f(fx, fz);
    var dir = vec2f(1.0, 0.0);
    if (length(routed + grad) > 1e-5)
    {
        dir = normalize(normalize(routed * 0.72 + grad * 0.45) + vec2f(1e-6, 0.0));
    }

    // Depth is republished: the renderer and the incision law both use the hydraulically
    // consistent value, so a river looks as deep as it is capable of eroding.
    gridStore(G_WATER, x, z, depth);
    gridStore(G_VELOCITYX, x, z, dir.x * velocity);
    gridStore(G_VELOCITYZ, x, z, dir.y * velocity);
    gridStore(G_SPEED, x, z, velocity);
}

//------------------------------------------------------------------------------------------
// Incision, transport and deposition
//------------------------------------------------------------------------------------------
@compute @workgroup_size(8, 8, 1)
fn erodeDeposit(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let area = max(cellArea(), 1e-6);
    let span = cellSpan();
    let dt = max(frame.sims.x, 1e-4);
    let maxDrop = max(frame.transport.w, 0.02) * voxelSize();

    // frame.push.x carries the plane that holds the converged flow accumulation for this step.
    let flux = max(gridAt(frame.push.x, x, z), 0.0);
    let q = flux / dt;
    // Slope along the descent direction, capped: past ~60% a face is a cliff, and letting the
    // slope term keep growing there is what turns one cut into an ever-deepening notch.
    let slope = clamp(gridAt(G_SLOPE, x, z), 1e-6, 0.6);
    let hardness = clamp(gridAt(G_HARDNESS, x, z), 0.0, 1.0);
    let cover = clamp(gridAt(G_COVER, x, z), 0.0, 1.0);
    var sediment = max(gridAt(G_SEDIMENT, x, z), 0.0);
    let water = max(gridAt(G_WATER, x, z), 0.0);

    // Contributing area in square metres, then in cells: the classic drainage-area term. It is
    // dimensionless on purpose — previous revisions mixed metres with cell counts and the
    // erosion budget stopped being a function of anything but its own clamps.
    let rain = max(gridAt(G_RAIN, x, z), 1e-7);
    let drainage = q / rain;
    let cells = max(drainage / area, 1.0);
    let areaTerm = pow(cells, frame.fluvial.y);
    let slopeTerm = pow(slope, frame.fluvial.z);

    // Channel initiation: a handful of cells of contributing area is where sheet wash turns
    // into a channel. Below the threshold only a small fraction of the erodibility applies,
    // which is what keeps hillslopes rounded while valleys cut into them.
    let channel = mix(0.02, 1.0, smoothstep(GATE_LOW, GATE_HIGH, cells));

    // Detachment is the stream-power law E = K * A^m * S^n, modulated by hardness and by
    // alluvial cover. The cover effect is what stops a channel deepening forever: once it is
    // full of its own load, the supply term closes and deposition takes over.
    let detachment = frame.fluvial.x * channel * exp(-2.2 * hardness) * mix(1.0, 0.18, cover)
                   * areaTerm * slopeTerm;

    // Two limits, both physical rather than numerical. The flow cannot remove more rock than
    // the water column above it can attack in a step, and a cell cannot dig below its own
    // downstream base level in a single step — that is what stops a channel from pitting
    // instead of widening, which is the classic way a hillslope model eats a hole in the map.
    let drop = max(gridAt(G_ELEVATION, x, z) - gridAt(G_ELEVATION, x + i32(gridAt(G_FLOWX, x, z)), z + i32(gridAt(G_FLOWZ, x, z))), 0.0);
    var erosion = min(detachment, water * 0.30 + 0.01);
    erosion = clamp(erosion, 0.0, min(maxDrop * 0.25, drop * 0.35));

    // Deposition from the transport-length picture: the fraction of the load that settles in a
    // cell is the settling velocity over the flow velocity. Still water therefore drops its
    // load fast and builds lake beds and deltas, while a fast river carries its sediment on.
    let speed = max(gridAt(G_SPEED, x, z), 0.02);
    let settleFraction = clamp(frame.transport.x / speed, 0.0, 0.5);
    let capacity = frame.transport.y * areaTerm * slopeTerm;
    let overload = max(sediment - capacity, 0.0);
    let deposition = clamp(sediment * settleFraction + overload * 0.20, 0.0, min(sediment, maxDrop * 0.25));

    // Hillslope creep. The coefficient is floored by the grid: a diffusivity above a quarter of
    // the cell area per step makes the discrete Laplacian oscillate instead of smoothing.
    let creep = min(max(frame.thermal.z, 0.0) * dt, span * span * 0.2);
    let own = gridAt(G_ELEVATION, x, z);
    let laplacian = (gridAt(G_ELEVATION, x + 1, z) + gridAt(G_ELEVATION, x - 1, z)
                   + gridAt(G_ELEVATION, x, z + 1) + gridAt(G_ELEVATION, x, z - 1) - 4.0 * own) / (span * span);
    // Diffusion is subtracted, not added: a positive Laplacian means the cell sits in a dip,
    // and smoothing has to fill the dip. With the sign the other way round this term sharpens
    // every bump into a spike, which pits the whole surface and swallows the drainage.
    let diffusion = clamp(-creep * laplacian, -maxDrop * 0.06, maxDrop * 0.06);

    var delta = clamp(erosion - deposition + diffusion, -maxDrop, maxDrop);
    sediment = max(sediment + erosion - deposition, 0.0);

    gridStore(G_DELTA, x, z, delta);
    gridStore(G_SEDIMENT, x, z, sediment);
    gridStore(G_DEPOSIT, x, z, deposition);
    gridStore(G_COVER, x, z, clamp(cover * 0.985 + deposition / max(voxelSize(), 1e-3), 0.0, 1.0));

    if (erosion > 0.0)
    {
        atomicAdd(&counters[C_ERODED], u32(erosion * area * FIXED_SCALE));
    }
    if (deposition > 0.0)
    {
        atomicAdd(&counters[C_DEPOSITED], u32(deposition * area * FIXED_SCALE));
    }
}

// One downstream hop of suspended load. Each cell first collects what the previous hop
// delivered into its atomic slot, then hands a velocity-dependent fraction to the cell its
// flow field points at. Running several hops per step is what lets a river carry sediment
// kilometres in one step without an explicit timestep limit: the load physically walks.
@compute @workgroup_size(8, 8, 1)
fn sedimentTransport(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let area = max(cellArea(), 1e-6);
    let span = cellSpan();
    let dt = max(frame.sims.x, 1e-4);

    let carried = f32(atomicLoad(&gridAtomic[atomSlot(AB_SEDIMENT, x, z)])) * 0.000001;
    atomicStore(&gridAtomic[atomSlot(AB_SEDIMENT, x, z)], 0);

    var suspended = max(gridAt(G_SEDIMENT, x, z), 0.0) + max(carried, 0.0);
    if (suspended <= 1e-9)
    {
        gridStore(G_SEDIMENT, x, z, 0.0);
        return;
    }

    let speed = gridAt(G_SPEED, x, z);
    // Fraction that covers one cell this hop; a fast river empties its load downstream.
    let fraction = clamp(speed * dt / max(span, 1e-3), 0.0, 1.0) * 0.75;
    let moved = suspended * fraction;
    suspended = suspended - moved;

    let fx = i32(round(gridAt(G_FLOWX, x, z)));
    let fz = i32(round(gridAt(G_FLOWZ, x, z)));
    if (inDomain(x + fx, z + fz) && (fx != 0 || fz != 0))
    {
        atomicAdd(&gridAtomic[atomSlot(AB_SEDIMENT, x + fx, z + fz)], i32(moved * 1000000.0));
    }
    else if (moved > 0.0)
    {
        // Leaving the map: counted against the escaped total so the audit still closes.
        atomicAdd(&counters[C_ESCAPED], u32(moved * area * FIXED_SCALE));
    }
    gridStore(G_SEDIMENT, x, z, suspended);
}

@compute @workgroup_size(8, 8, 1)
fn sedimentGather(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let incoming = f32(atomicLoad(&gridAtomic[atomSlot(AB_SEDIMENT, x, z)])) * 0.000001;
    atomicStore(&gridAtomic[atomSlot(AB_SEDIMENT, x, z)], 0);
    if (incoming > 0.0)
    {
        gridStore(G_SEDIMENT, x, z, gridAt(G_SEDIMENT, x, z) + incoming);
    }
}

//------------------------------------------------------------------------------------------
// Publish the water surface for rendering
//------------------------------------------------------------------------------------------
@compute @workgroup_size(8, 8, 1)
fn publishWater(@builtin(global_invocation_id) gid : vec3u)
{
    let g = hydGridSize();
    if (gid.x >= u32(g) || gid.y >= u32(g))
    {
        return;
    }
    let x = i32(gid.x);
    let z = i32(gid.y);
    let depth = max(gridAt(G_WATER, x, z), 0.0);
    let speed = gridAt(G_SPEED, x, z);
    let turbidity = clamp(gridAt(G_SEDIMENT, x, z) * 6.0, 0.0, 1.0);
    let surface = gridAt(G_ELEVATION, x, z) + depth;

    // Target A: what a shading ray needs to hit the water surface.
    textureStore(waterOut, vec2i(x, z), vec4f(surface, depth, turbidity, speed));
    // Target B: the current itself, for streak advection and the flow-vector overlay.
    textureStore(waterOut2, vec2i(x, z), vec4f(
        gridAt(G_VELOCITYX, x, z),
        gridAt(G_VELOCITYZ, x, z),
        gridAt(G_ACCUMA, x, z) + gridAt(G_ACCUMB, x, z),
        gridAt(G_EXPOSURE, x, z)));
}
`;

export function hydrologyShader(graph = GRAPH_STUB)
{
    return `${COMMON}\n${SIM_BINDINGS}\n${FIELD_WRITE_HELPERS}\n${BODY}\n${graph}`;
}

export const HYDROLOGY_MODULE = hydrologyShader();
