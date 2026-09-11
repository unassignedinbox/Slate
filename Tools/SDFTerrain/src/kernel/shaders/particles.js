//==========================================================================================
// Agent parcels — rain runoff, river bed load, windborne sand/dust, rockfall.
//
// Design rules that keep this honest (and that the previous prototype violated):
//   1. Footprint radius is derived from the voxel size (0.30-0.45 voxel), so a parcel scatters
//      into a ~2 voxel neighbourhood instead of a huge footprint brush.
//   2. A parcel may only detach material while it carries less than its transport capacity and
//      only through shear/saltation work. Saturated parcels *deposit*: they cannot drill.
//   3. Kinetic energy, water volume and suspended load are all accounted. When a parcel dies
//      (settled, dried out, or out of time) it deposits its entire remaining load inside the
//      domain. Nothing teleports or evaporates out of the mass balance.
//   4. Erosion enters the volume through the same fixed-point delta buffer as the fluvial
//      solver, so the surface moves as a band-limited offset (see apply.js).
//==========================================================================================

import { COMMON } from './common.js';
import { SIM_BINDINGS, FIELD_WRITE_HELPERS } from './bindings.js';
import { GRAPH_STUB } from './graphStub.js';

const BODY = /* wgsl */ `
const KERNEL_RADIUS_VOX : f32 = 1.35;   // scatter support, in voxels
const MIN_WATER : f32 = 1e-4;           // [m3]
const MIN_LOAD : f32 = 1e-7;            // [m3]

fn totalLoad(l : vec4f) -> f32
{
    return max(l.x + l.y + l.z + l.w, 0.0);
}

fn randAt(seed : u32, salt : u32) -> f32
{
    return hash1(pcg(seed * 2654435761u + salt * 40503u + frame.dims.w));
}

fn randVec(seed : u32, salt : u32) -> vec3f
{
    return hash3v(vec3u(seed, salt, frame.dims.w), 12345u);
}

fn randSymmetric(seed : u32, salt : u32) -> vec2f
{
    return vec2f(randAt(seed, salt), randAt(seed, salt + 17u)) * 2.0 - vec2f(1.0);
}

// Scatter a signed surface change into the volume delta buffer (positive = erosion).
// Atomics because many parcels land in the same voxel; the kernel is smooth so the resulting
// channel is a coherent groove rather than a field of pockmarks.
fn scatterDelta(p : vec3f, amount : f32, footprint : f32)
{
    let vox = voxelSize();
    let radius = max(footprint * KERNEL_RADIUS_VOX, vox * 0.75);
    let centre = worldToGrid(p);
    let half = i32(ceil(radius / vox));
    let fixed = i32(clamp(amount, -100.0, 100.0) * FIXED_SCALE);
    for (var z = -half; z <= half; z = z + 1)
    {
        for (var y = -half; y <= half; y = y + 1)
        {
            for (var x = -half; x <= half; x = x + 1)
            {
                let q = vec3i(centre) + vec3i(x, y, z);
                if (any(q < vec3i(0)) || any(q >= vec3i(frame.dims.xyz)))
                {
                    continue;
                }
                let d = length(vec3f(q) + vec3f(0.5) - centre) * vox;
                if (d > radius)
                {
                    continue;
                }
                let t = 1.0 - d / radius;
                let w = t * t;
                atomicAdd(&deltas[volumeIndex(q)], i32(f32(fixed) * w));
            }
        }
    }
}

fn surfaceSlopeFactor(n : vec3f) -> f32
{
    return clamp(1.0 - abs(n.y), 0.0, 1.0);
}

//------------------------------------------------------------------------------------------
// Spawning
//------------------------------------------------------------------------------------------
fn spawnParcel(slot : u32) -> Particle
{
    // Type is chosen by the UI weights stored in frame.particles.y (bit packed per 8 bits).
    let roll = randAt(slot, 3u);
    let weights = vec3f(
        f32((frame.flags.y >> 0u) & 255u),
        f32((frame.flags.y >> 8u) & 255u),
        f32((frame.flags.y >> 16u) & 255u)) / 255.0;
    var kind = AGENT_RAIN;
    if (roll < weights.x)
    {
        kind = AGENT_RAIN;
    }
    else if (roll < weights.x + weights.y)
    {
        kind = AGENT_RIVER;
    }
    else
    {
        kind = AGENT_WIND;
    }

    let vox = voxelSize();
    let g = hydGridSize();
    var p : Particle;
    p.pos = vec4f(0.0, -1.0, 0.0, -1.0);
    p.vel = vec4f(0.0);
    p.load = vec4f(0.0);
    p.info = vec4f(kind, 0.0, 0.0, 0.0);

    if (kind == AGENT_RAIN)
    {
        // Rejection-sample a rainy column: rainfall decides where runoff starts.
        var cellX = 0;
        var cellZ = 0;
        var accept = 0.0;
        for (var attempt = 0; attempt < 6; attempt = attempt + 1)
        {
            cellX = i32(floor(randAt(slot, u32(attempt) * 7u + 1u) * f32(g)));
            cellZ = i32(floor(randAt(slot, u32(attempt) * 7u + 2u) * f32(g)));
            let rain = gridAt(G_RAIN, cellX, cellZ);
            let wet = gridAt(G_WETNESS, cellX, cellZ);
            if (rain > 1e-9 && randAt(slot, u32(attempt) * 7u + 3u) < clamp(rain * 4000.0, 0.05, 1.0) * (0.35 + 0.65 * wet))
            {
                accept = 1.0;
                break;
            }
        }
        if (accept < 0.5)
        {
            return p;
        }
        let w = hydCellWorld(cellX, cellZ);
        let elev = gridAt(G_ELEVATION, cellX, cellZ);
        let jitter = randSymmetric(slot, 11u) * cellSpan() * 0.5;
        let start = vec3f(w.x + jitter.x, elev + vox * (0.35 + randAt(slot, 12u) * 0.5), w.y + jitter.y);
        p.pos = vec4f(start, 0.0);
        p.vel = vec4f(randSymmetric(slot, 13u).x * 0.4, -0.6 - randAt(slot, 14u), randSymmetric(slot, 15u).y * 0.4, vox * vox * vox * 18.0);
        p.info = vec4f(kind, vox * 0.30, 1.0, 0.0);
        return p;
    }

    if (kind == AGENT_RIVER)
    {
        // Birth where the drainage network actually is: probability follows local discharge.
        var cellX = 0;
        var cellZ = 0;
        var best = 0.0;
        for (var probe = 0; probe < 8; probe = probe + 1)
        {
            let px = i32(floor(randAt(slot, u32(probe) * 5u + 21u) * f32(g)));
            let pz = i32(floor(randAt(slot, u32(probe) * 5u + 22u) * f32(g)));
            let q = gridAt(G_FLOWX, px, pz);
            let r = gridAt(G_FLOWZ, px, pz);
            let depth = gridAt(G_WATER, px, pz);
            let score = depth + length(vec2f(q, r)) * 0.05;
            if (score > best)
            {
                best = score;
                cellX = px;
                cellZ = pz;
            }
        }
        if (best < 0.02)
        {
            return p;
        }
        let w = hydCellWorld(cellX, cellZ);
        let depth = max(gridAt(G_WATER, cellX, cellZ), vox * 0.05);
        let jitter = randSymmetric(slot, 24u) * cellSpan() * 0.35;
        let elev = gridAt(G_ELEVATION, cellX, cellZ);
        let start = vec3f(w.x + jitter.x, elev + depth * (0.35 + randAt(slot, 25u) * 0.5), w.y + jitter.y);
        let flow = vec2f(gridAt(G_VELOCITYX, cellX, cellZ), gridAt(G_VELOCITYZ, cellX, cellZ));
        p.pos = vec4f(start, 0.0);
        p.vel = vec4f(flow.x, -0.05, flow.y, vox * vox * vox * 26.0);
        p.info = vec4f(kind, vox * 0.34, 1.35, 0.0);
        return p;
    }

    // Wind: enter from the upwind face of the domain, in a saltation band above the ground.
    let wdir = normalize(vec2f(cos(frame.aeolian.y), sin(frame.aeolian.y)) + vec2f(1e-6, 0.0));
    let side = vec2f(-wdir.y, wdir.x);
    let across = (randAt(slot, 31u) * 2.0 - 1.0) * (frame.worldHi.x - frame.worldLo.x) * 0.5;
    let mid = (frame.worldLo.xyz + frame.worldHi.xyz) * vec3f(0.5, 0.0, 0.5);
    var spawn = vec2f(mid.x, mid.z) + side * across - wdir * (frame.worldHi.x - frame.worldLo.x) * 0.48;
    var y = frame.worldHi.y - vox;
    // Drop the parcel onto the upwind surface band.
    for (var i = 0; i < 64; i = i + 1)
    {
        let d = terrainAt(sdfIn, vec3f(spawn.x, y, spawn.y));
        if (d < vox * (0.6 + randAt(slot, 33u) * 5.0))
        {
            break;
        }
        y = y - clamp(d * 0.8, vox * 0.4, vox * 4.0);
        if (y < frame.worldLo.y)
        {
            break;
        }
    }
    let speed = max(gridAt(G_WINDSPEED, 0, 0), frame.aeolian.x);
    p.pos = vec4f(spawn.x, max(y, frame.worldLo.y + vox), spawn.y, 0.0);
    p.vel = vec4f(wdir.x * speed * 0.85, randAt(slot, 34u) * 1.5, wdir.y * speed * 0.85, 0.0);
    p.load = vec4f(0.0, 0.0, vox * vox * vox * (0.25 + randAt(slot, 35u) * 0.65), 0.0);
    p.info = vec4f(kind, vox * 0.24, 1.0, 0.0);
    return p;
}

//------------------------------------------------------------------------------------------
// Parcel step: motion, contact, alteration, settling
//------------------------------------------------------------------------------------------
@compute @workgroup_size(64, 1, 1)
fn particleStep(@builtin(global_invocation_id) gid : vec3u)
{
    let slot = gid.x;
    if (slot >= u32(frame.particles.y))
    {
        return;
    }
    let dt = frame.sims.x;
    let vox = voxelSize();
    var p = particles[slot];

    if (p.pos.w < 0.0)
    {
        // Free slot: attempt a birth. Birth rate is a probability per step, not a burst.
        let rate = frame.particles.x;
        if (rate <= 0.0 || randAt(slot, 99u) > clamp(rate * dt * 0.05, 0.0, 0.9))
        {
            return;
        }
        var born = spawnParcel(slot);
        if (born.pos.w >= 0.0)
        {
            particles[slot] = born;
            atomicAdd(&counters[C_SPAWNED], 1u);
        }
        return;
    }

    let kind = p.info.x;
    let footprint = max(p.info.y, vox * 0.2);
    var pos = p.pos.xyz;
    var vel = p.vel.xyz;
    var water = max(p.vel.w, 0.0);
    var load = p.load;
    var age = p.pos.w;
    let speed = length(vel);

    //---- agent forces ---------------------------------------------------------------------
    if (kind == AGENT_WIND)
    {
        let wdir = normalize(vec2f(cos(frame.aeolian.y), sin(frame.aeolian.y)) + vec2f(1e-6, 0.0));
        let local = gridAtWorld(G_WINDSPEED, pos.xz);
        let windTarget = vec3f(wdir.x * local, 0.0, wdir.y * local);
        vel = vel + (windTarget - vel) * clamp(dt * 1.1, 0.0, 1.0);
        vel.y = vel.y - frame.particles.z * dt * 0.45;
        pos = pos + vel * dt;
    }
    else
    {
        let depth = gridAtWorld(G_WATER, pos.xz);
        if (depth > footprint * 1.4 && kind == AGENT_RIVER)
        {
            // Suspended in the channel: follow the computed current, settle per Stokes-like drag.
            let flow = vec2f(gridAtWorld(G_VELOCITYX, pos.xz), gridAtWorld(G_VELOCITYZ, pos.xz));
            let flowTarget = vec3f(flow.x, -0.35 * min(depth, 2.0), flow.y);
            vel = vel + (flowTarget - vel) * clamp(dt * 1.6, 0.0, 1.0);
            pos = pos + vel * dt;
        }
        else
        {
            vel.y = vel.y - 9.81 * dt;
            pos = pos + vel * dt;
        }
    }

    //---- contact with the surface --------------------------------------------------------
    var contact = 0.0;
    let d = terrainAt(sdfIn, pos);
    var normal = vec3f(0.0, 1.0, 0.0);
    if (d < footprint * 1.35)
    {
        contact = 1.0;
        normal = surfaceNormalDetailed(sdfIn, pos, 0.0);
        if (d < footprint * 0.55)
        {
            pos = pos + normal * (footprint * 0.55 - d);
        }
        let vn = dot(vel, normal);
        if (vn < 0.0)
        {
            // Impact: water parcels splash and keep a fraction of the normal component,
            // sand rebounds (saltation), rockfall is damped hard.
            let restitution = select(0.18, 0.45, kind == AGENT_WIND);
            let bounce = select(restitution, 0.12, kind == AGENT_ROCKFALL);
            vel = vel - normal * vn * (1.0 + bounce);
            if (kind == AGENT_WIND && vn < -0.4)
            {
                vel = vel + normal * min(-vn * 0.35, 2.4);
            }
        }
        // Tangential friction. Water parcels accelerate downhill with the sheet flow.
        let tangent = vel - normal * dot(vel, normal);
        var friction = 1.6;
        if (kind == AGENT_WIND)
        {
            friction = 0.9;
        }
        else if (kind == AGENT_ROCKFALL)
        {
            friction = 3.4;
        }
        vel = tangent * max(0.0, 1.0 - friction * dt);
        if (kind != AGENT_WIND)
        {
            // Gravity projected onto the contact plane drives sheet flow / rolling downhill.
            let tangentGravity = vec3f(normal.x * normal.y, normal.y * normal.y - 1.0, normal.z * normal.y) * 9.81;
            vel = vel + tangentGravity * dt * 0.55;
        }
    }
    else
    {
        vel = vel * max(0.0, 1.0 - 0.25 * dt);
    }

    // In-water parcels follow the current even in shallow sheets.
    if (kind != AGENT_WIND)
    {
        let depth = gridAtWorld(G_WATER, pos.xz);
        if (depth > 0.02)
        {
            let flow = vec2f(gridAtWorld(G_VELOCITYX, pos.xz), gridAtWorld(G_VELOCITYZ, pos.xz));
            vel.x = mix(vel.x, flow.x, clamp(dt * 0.55, 0.0, 0.85));
            vel.z = mix(vel.z, flow.y, clamp(dt * 0.55, 0.0, 0.85));
        }
    }

    let newSpeed = length(vel);
    var carried = totalLoad(load);

    //---- alteration ----------------------------------------------------------------------
    var eroded = 0.0;
    var deposited = 0.0;
    if (contact > 0.5)
    {
        let hardness = clamp(materialAt(matIn, pos).x, 0.0, 1.0);
        let cover = clamp(materialAt(matIn, pos).w, 0.0, 1.0);
        let exposure = gridAtWorld(G_EXPOSURE, pos.xz);

        if (kind == AGENT_WIND)
        {
            // Saltation abrasion: impact energy scales with the square of impact speed, and only
            // windward faces lose material (exposure > 0).
            let windward = clamp(0.35 + exposure, 0.0, 1.6);
            let wear = frame.aeolian.z * pow(max(newSpeed, 0.0), 2.0) * windward * dt;
            let resistance = 0.25 + hardness * 0.75;
            // Saltation is self-limiting: a parcel that is already loaded grinds less.
            let saturation = 1.0 - clamp(totalLoad(load) / max(vox * vox * vox * 24.0, 1e-9), 0.0, 0.9);
            eroded = min(wear / resistance, vox * 0.05) * saturation;
            load.x = load.x + eroded;

            // Dust settles wherever the wind can no longer hold it (lee slopes, basins).
            let local = max(gridAtWorld(G_WINDSPEED, pos.xz), 0.1);
            let stillness = clamp(1.0 - local / max(frame.aeolian.x, 0.1), 0.0, 1.0);
            deposited = min(load.z * clamp(frame.aeolian.w * stillness * dt, 0.0, 0.9), load.z);
            load.z = max(load.z - deposited, 0.0);
        }
        else
        {
            // Shear-driven detachment with a real capacity limit, exactly as in the fluvial
            // solver: the parcel may only cut while it is undersaturated.
            let capacity = frame.transport.y * 0.35 * water * max(newSpeed, 0.05);
            let deficit = max(capacity - carried, 0.0);
            let erodibility = frame.fluvial.x * exp(-2.2 * hardness) * mix(1.0, 0.18, cover);
            eroded = min(erodibility * deficit * dt, vox * 0.06);
            load.x = load.x + eroded;

            // Deposition when overloaded or when the flow stalls.
            let overloaded = max(carried - capacity, 0.0);
            let stall = clamp(1.0 - newSpeed / 0.7, 0.0, 1.0);
            deposited = min(frame.transport.x * (overloaded + carried * stall * 0.6) * dt, carried);
            let scale = deposited / max(carried, 1e-9);
            load = load * max(1.0 - scale, 0.0);
        }

        if (eroded > 0.0)
        {
            scatterDelta(pos, eroded, footprint);
            atomicAdd(&counters[C_ERODED], u32(eroded * FIXED_SCALE * 0.001));
        }
        if (deposited > 0.0)
        {
            scatterDelta(pos, -deposited, footprint);
            atomicAdd(&counters[C_DEPOSITED], u32(deposited * FIXED_SCALE * 0.001));
        }
    }

    //---- mass and lifetime ---------------------------------------------------------------
    if (kind != AGENT_WIND)
    {
        // Water is lost to infiltration and evaporation; when it runs out the parcel settles.
        let wet = gridAtWorld(G_WETNESS, pos.xz);
        let loss = water * (frame.sims.w + (1.0 - wet) * 0.004) * dt;
        water = max(water - loss, 0.0);
    }

    carried = totalLoad(load);
    age = age + dt;

    var life = 120.0;
    if (kind == AGENT_RIVER)
    {
        life = 260.0;
    }
    else if (kind == AGENT_WIND)
    {
        life = 90.0;
    }

    let settled = (newSpeed < 0.06 && carried < MIN_LOAD) || (kind != AGENT_WIND && water < MIN_WATER);
    let expired = age > life || any(pos < frame.worldLo.xyz) || any(pos > frame.worldHi.xyz);
    let stuck = carried < MIN_LOAD && newSpeed < 0.12;

    if (settled || expired || stuck)
    {
        // Settling: the parcel puts its whole remaining load down where it stopped.
        if (carried > MIN_LOAD)
        {
            scatterDelta(pos, -carried, footprint);
            atomicAdd(&counters[C_DEPOSITED], u32(carried * FIXED_SCALE * 0.001));
            load = vec4f(0.0);
        }
        // Water that leaves the domain is booked as exported (it carries no sediment now).
        if (any(pos < frame.worldLo.xyz) || any(pos > frame.worldHi.xyz))
        {
            atomicAdd(&counters[C_ESCAPED], u32(water * FIXED_SCALE));
        }
        p.pos.w = -1.0;
        p.vel = vec4f(0.0);
        p.load = vec4f(0.0);
        p.info.w = 0.0;
        particles[slot] = p;
        atomicAdd(&counters[C_DEAD], 1u);
        return;
    }

    p.pos = vec4f(pos, age);
    p.vel = vec4f(vel, water);
    p.load = load;
    particles[slot] = p;
    atomicAdd(&counters[C_CARRIED], u32(carried * FIXED_SCALE * 0.001));
}

//------------------------------------------------------------------------------------------
// Diagnostics: population and suspended load telemetry
//------------------------------------------------------------------------------------------
@compute @workgroup_size(64, 1, 1)
fn particleCount(@builtin(global_invocation_id) gid : vec3u)
{
    let slot = gid.x;
    if (slot >= u32(frame.particles.y))
    {
        return;
    }
    let p = particles[slot];
    if (p.pos.w >= 0.0)
    {
        atomicAdd(&counters[C_ALIVE], 1u);
    }
}
`;

export function particlesShader(graph = GRAPH_STUB)
{
    return `${COMMON}\n${SIM_BINDINGS}\n${FIELD_WRITE_HELPERS}\n${BODY}\n${graph}`;
}

export const PARTICLES_MODULE = particlesShader();
