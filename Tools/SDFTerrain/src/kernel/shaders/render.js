//==========================================================================================
// Viewport rendering.
//
//   terrainPass : sphere-traces the volumetric field (caves, overhangs and arches are real
//                 geometry here), shades rock / alluvium / vegetation / snow layers, and
//                 writes linear hit distance so water and particles can composite against it.
//   waterPass   : depth-and-velocity driven water surface. The surface is the SDF top surface
//                 lifted by the simulated water depth, so it exists only where the solver put
//                 water. Foam and stream lines are advected along the simulated current, so the
//                 shader follows the river exactly where the erosion is happening.
//   pointsPass  : agent parcels as camera-facing sprites, sized in metres, tinted by the
//                 material they currently carry.
//   accumulate / presentPass : progressive refinement while the camera is still, tonemapping,
//                 optional clip cut-away for inspecting interiors.
//==========================================================================================

import { COMMON } from './common.js';
import { SIM_BINDINGS } from './bindings.js';
import { GRAPH_STUB } from './graphStub.js';

const RENDER_BINDINGS = /* wgsl */ `
// The Frame uniform (binding 0) and graph parameters (binding 1) come from COMMON.
@group(0) @binding(2) var sdfIn : texture_3d<f32>;
@group(0) @binding(3) var matIn : texture_3d<f32>;
@group(0) @binding(4) var linearSampler : sampler;
@group(0) @binding(5) var waterTex : texture_2d<f32>;
@group(0) @binding(6) var waterTex2 : texture_2d<f32>;
@group(0) @binding(7) var<storage, read> grid : array<f32>;
@group(0) @binding(8) var<storage, read> particles : array<Particle>;
@group(0) @binding(9) var colorTex : texture_2d<f32>;
@group(0) @binding(10) var depthTex : texture_2d<f32>;
@group(0) @binding(11) var accumTex : texture_2d<f32>;
`;

const WATER_SAMPLE = /* wgsl */ `
// Packed in the solver: (surface height [m], depth [m], turbidity, flow speed [m/s])
// plus a second target: (velocity x, velocity z, discharge, exposure)
fn waterSampleAt(p : vec2f) -> vec4f
{
    let uv = (p - vec2f(frame.worldLo.x, frame.worldLo.z)) / vec2f(frame.worldHi.x - frame.worldLo.x, frame.worldHi.z - frame.worldLo.z);
    if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))
    {
        return vec4f(0.0);
    }
    return textureSampleLevel(waterTex, linearSampler, uv, 0.0);
}

fn waterFlowAt(p : vec2f) -> vec4f
{
    let uv = (p - vec2f(frame.worldLo.x, frame.worldLo.z)) / vec2f(frame.worldHi.x - frame.worldLo.x, frame.worldHi.z - frame.worldLo.z);
    if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)))
    {
        return vec4f(0.0);
    }
    return textureSampleLevel(waterTex2, linearSampler, uv, 0.0);
}

struct WaterHit
{
    hit   : f32,
    t     : f32,
    pos   : vec3f,
    depth : f32,
};

// Heightfield-style intersection against the simulated water surface.
fn traceWater(ro : vec3f, rd : vec3f, limit : f32) -> WaterHit
{
    var h : WaterHit;
    h.hit = 0.0;
    h.t = limit;
    h.pos = ro + rd * limit;
    h.depth = 0.0;
    if (abs(rd.y) < 0.004)
    {
        return h;
    }
    var t = 0.0;
    let step = max(voxelSize() * 0.6, 0.6);
    var prevDelta = 0.0;
    for (var i = 0; i < 220; i = i + 1)
    {
        let p = ro + rd * t;
        if (t > limit)
        {
            break;
        }
        let w = waterSampleAt(p.xz);
        if (w.y <= 0.001)
        {
            // No water in this column: keep marching with a longer step.
            t = t + step * 3.0;
            prevDelta = 0.0;
            continue;
        }
        let delta = p.y - w.x;
        if (delta < 0.0)
        {
            // Crossed the surface: refine between the previous and current sample.
            var a = max(t - step, 0.0);
            var b = t;
            for (var k = 0; k < 6; k = k + 1)
            {
                let m = 0.5 * (a + b);
                let pm = ro + rd * m;
                let wm = waterSampleAt(pm.xz);
                if (pm.y - wm.x > 0.0)
                {
                    a = m;
                }
                else
                {
                    b = m;
                }
            }
            let tc = 0.5 * (a + b);
            h.hit = 1.0;
            h.t = tc;
            h.pos = ro + rd * tc;
            h.depth = max(waterSampleAt(h.pos.xz).y, 0.0);
            return h;
        }
        prevDelta = delta;
        t = t + clamp(delta * 0.75, step * 0.5, voxelSize() * 2.5);
    }
    return h;
}
`;

//------------------------------------------------------------------------------------------
// Terrain shading
//------------------------------------------------------------------------------------------
const TERRAIN = /* wgsl */ `
struct TerrainOut
{
    @location(0) color : vec4f,
    @location(1) depth : f32,
};

struct FullscreenOut
{
    @builtin(position) position : vec4f,
    @location(0) uv : vec2f,
};

@vertex
fn fullscreenVertex(@builtin(vertex_index) index : u32) -> FullscreenOut
{
    var out : FullscreenOut;
    let x = f32((index << 1u) & 2u);
    let y = f32(index & 2u);
    out.uv = vec2f(x, y);
    out.position = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
    return out;
}

fn strataColor(p : vec3f) -> vec3f
{
    let band = sin(p.y * 0.045 + fbm(p * 0.004, 2, 2.0, 0.5, 7u) * 3.0);
    let layer = fract(band * 2.5);
    let warm = vec3f(0.42, 0.31, 0.23);
    let pale = vec3f(0.55, 0.50, 0.42);
    let dark = vec3f(0.28, 0.24, 0.22);
    var col = mix(dark, warm, clamp(layer * 1.4, 0.0, 1.0));
    col = mix(col, pale, clamp(fbm(p * 0.02, 3, 2.0, 0.5, 19u) * 0.9 + 0.2, 0.0, 1.0));
    return col;
}

fn surfaceAlbedo(p : vec3f, n : vec3f, mat : vec4f, slope : f32, wet : f32) -> vec3f
{
    let biome = frame.tint.x;
    var rock = strataColor(p);
    if (biome > 1.5 && biome < 2.5)
    {
        rock = mix(vec3f(0.36, 0.33, 0.30), vec3f(0.52, 0.46, 0.40), fbm(p * 0.06, 2, 2.0, 0.5, 33u) * 0.6 + 0.4);
    }
    else if (biome > 2.5)
    {
        rock = mix(vec3f(0.16, 0.15, 0.16), vec3f(0.30, 0.24, 0.22), fbm(p * 0.05, 3, 2.0, 0.5, 41u) * 0.8 + 0.2);
    }

    // Alluvium: freshly deposited sediment paints the bed and the fans.
    let deposit = clamp(mat.y / max(voxelSize() * 0.6, 1e-3), 0.0, 1.0);
    let sand = mix(vec3f(0.58, 0.51, 0.38), vec3f(0.72, 0.66, 0.52), fbm(p * 0.15, 2, 2.0, 0.5, 55u) * 0.5 + 0.5);
    var col = mix(rock, sand, deposit * 0.85);

    // Dry dust vs exposed rock: flats collect material, cliffs stay bare.
    let dust = clamp(1.0 - slope * 2.2, 0.0, 1.0) * clamp(mat.y * 8.0 + 0.35, 0.0, 1.0);
    col = mix(col, col * 1.12 + vec3f(0.05, 0.04, 0.02), dust * 0.35);

    // Vegetation: only where it can hold on (gentle slopes, moisture, below the tree line).
    let vegetation = frame.tint.y;
    if (vegetation > 0.001)
    {
        let treeLine = frame.climate.x + 380.0;
        let altitude = clamp(1.0 - max(p.y - treeLine * 0.35, 0.0) / 260.0, 0.0, 1.0);
        let live = vegetation * altitude * clamp(1.0 - slope * 2.6, 0.0, 1.0) * clamp(0.25 + wet * 2.4, 0.0, 1.0);
        let grass = mix(vec3f(0.20, 0.28, 0.13), vec3f(0.34, 0.36, 0.18), fbm(p * 0.09, 2, 2.0, 0.5, 71u) * 0.6 + 0.4);
        col = mix(col, grass, clamp(live, 0.0, 0.92));
    }

    // Snow: altitude and slope driven, with wind scouring on the steepest faces.
    let snowAmount = clamp((p.y - frame.climate.x) / 120.0, 0.0, 1.0) * clamp(1.0 - slope * 3.0, 0.0, 1.0);
    col = mix(col, vec3f(0.86, 0.89, 0.95), clamp(snowAmount * 1.1, 0.0, 0.95));

    // Wet rock darkens and reads darker in the crevices.
    col = mix(col, col * 0.55 + vec3f(0.01, 0.012, 0.02), clamp(wet * frame.tint.w, 0.0, 0.9));
    return col;
}

fn shadeSurface(rd : vec3f, p : vec3f, n : vec3f, mat : vec4f) -> vec3f
{
    let sunDir = normalize(frame.sun.xyz);
    let slope = clamp(1.0 - n.y, 0.0, 1.0);
    let wet = clamp(mat.z, 0.0, 1.0);
    var albedo = surfaceAlbedo(p, n, mat, slope, wet);

    let ao = ambientOcclusion(sdfIn, p + n * voxelSize() * 0.35, n, voxelSize() * 3.2);
    let shadow = softShadow(sdfIn, p + n * voxelSize() * 0.25, sunDir, voxelSize() * 0.4, 900.0);

    let ndl = clamp(dot(n, sunDir), 0.0, 1.0);
    let wrapped = clamp((ndl + 0.22) / 1.22, 0.0, 1.0);
    let sun = vec3f(1.0, 0.93, 0.82) * frame.sun.w * 3.1;
    var col = albedo * sun * wrapped * shadow * mix(0.35, 1.0, ao);

    // Sky dome ambient with a ground bounce.
    let skyL = skyColor(n) * frame.sky.x * 1.2;
    let bounce = vec3f(0.16, 0.14, 0.11) * clamp(1.0 - n.y, 0.0, 1.0) * frame.sun.w;
    col = col + albedo * (skyL * mix(0.35, 1.0, ao) + bounce * ao);

    // Specular: wet rock and ice only.
    let spec = pow(max(dot(reflect(rd, n), sunDir), 0.0), mix(24.0, 180.0, wet));
    col = col + sun * spec * (0.05 + wet * 0.55) * shadow;

    // Sky reflection at grazing angles for wet slabs.
    let fres = pow(clamp(1.0 - dot(n, -rd), 0.0, 1.0), 5.0);
    col = col + skyColor(reflect(rd, n)) * fres * (0.05 + wet * 0.5);
    return col;
}

fn debugColor(p : vec3f, n : vec3f, mat : vec4f, view : u32) -> vec3f
{
    if (view == 1u)
    {
        return n * 0.5 + vec3f(0.5);
    }
    if (view == 2u)
    {
        return vec3f(clamp(1.0 - n.y, 0.0, 1.0));
    }
    if (view == 3u)
    {
        return vec3f(ambientOcclusion(sdfIn, p + n * voxelSize() * 0.35, n, voxelSize() * 4.0));
    }
    if (view == 4u)
    {
        return vec3f(mat.z, mat.z * 0.4, 0.05);
    }
    if (view == 5u)
    {
        return vec3f(clamp(mat.y / max(voxelSize() * 0.5, 1e-3), 0.0, 1.0), 0.0, 0.2);
    }
    if (view == 6u)
    {
        return vec3f(mat.x, mat.x * 0.55, 0.0);
    }
    let flow = waterFlowAt(p.xz);
    if (view == 7u)
    {
        let speed = waterSampleAt(p.xz).w;
        return vec3f(clamp(speed / 4.0, 0.0, 1.0));
    }
    if (view == 8u)
    {
        let d = clamp(log(1.0 + flow.z) / 12.0, 0.0, 1.0);
        return vec3f(d, d * d, clamp(d * 3.0, 0.0, 1.0));
    }
    return vec3f(0.0);
}

@fragment
fn terrainFragment(in : FullscreenOut) -> TerrainOut
{
    let uv = in.uv;
    let ro = frame.camPos.xyz;
    let rd = primaryRay(uv);
    let maxSteps = i32(clamp(f32(frame.flags.z & 1023u), 32.0, 900.0));

    var out : TerrainOut;
    var hit = traceTerrain(sdfIn, ro, rd, maxSteps);

    // Clip cut-away for inspecting caves and overhangs.
    if ((frame.flags.z & 2048u) != 0u && hit.hit > 0.5)
    {
        if (hit.pos.y > frame.bake.z)
        {
            hit.hit = 0.0;
        }
    }

    if (hit.hit < 0.5)
    {
        out.color = vec4f(skyColor(rd), 1.0);
        out.depth = 1e9;
        return out;
    }

    let n = surfaceNormalDetailed(sdfIn, hit.pos, detailAmp());
    let mat = materialAt(matIn, hit.pos);
    let view = frame.flags.x;
    var col = vec3f(0.0);
    if (view == 0u)
    {
        col = shadeSurface(rd, hit.pos, n, mat);
        col = integrateFog(col, length(hit.pos - ro), rd);
    }
    else
    {
        col = debugColor(hit.pos, n, mat, view);
    }

    // Contour / slice helpers.
    if ((frame.flags.z & 4096u) != 0u)
    {
        let band = abs(fract(hit.pos.y / 25.0) - 0.5);
        col = mix(col, vec3f(0.9), smoothstep(0.48, 0.5, band) * 0.22);
    }
    if ((frame.flags.z & 8192u) != 0u)
    {
        let slice = abs(hit.pos.x - frame.bake.z);
        col = mix(col, vec3f(1.0, 0.25, 0.1), smoothstep(voxelSize() * 0.4, 0.0, slice) * 0.8);
    }
    out.color = vec4f(col, 1.0);
    out.depth = length(hit.pos - ro);
    return out;
}
`;

//------------------------------------------------------------------------------------------
// Water
//------------------------------------------------------------------------------------------
const WATER = /* wgsl */ `
@vertex
fn waterVertex(@builtin(vertex_index) index : u32) -> FullscreenOut
{
    var out : FullscreenOut;
    let x = f32((index << 1u) & 2u);
    let y = f32(index & 2u);
    out.uv = vec2f(x, y);
    out.position = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
    return out;
}

// Anisotropic flow noise: the streak axis follows the simulated current, so surface detail
// moves downstream exactly where the solver routes water.
fn flowStreaks(p : vec3f, flow : vec2f, speed : f32, time : f32) -> f32
{
    let dir = normalize(flow + vec2f(1e-5, 0.0));
    let advected = p.xz - dir * time * clamp(speed, 0.0, 6.0) * 0.35;
    let along = dot(advected, dir);
    let across = dot(advected, vec2f(-dir.y, dir.x));
    // Stretch along the flow: high frequency across, low frequency along.
    let q = vec3f(across * 0.55, along * 0.08, p.y * 0.3);
    var v = fbm(q, 4, 2.1, 0.55, 613u);
    v = v + 0.5 * gradientNoise(vec3f(across * 1.6, along * 0.22, time * 0.05), 617u);
    return clamp(v * 0.75 + 0.5, 0.0, 1.0);
}

fn waterNormal(p : vec3f, flow : vec2f, speed : f32, time : f32) -> vec3f
{
    let e = max(voxelSize() * 0.08, 0.05);
    let h = flowStreaks(p, flow, speed, time);
    let hx = flowStreaks(p + vec3f(e, 0.0, 0.0), flow, speed, time) - h;
    let hz = flowStreaks(p + vec3f(0.0, 0.0, e), flow, speed, time) - h;
    let amp = clamp(0.35 + speed * 0.12, 0.2, 1.4) * clamp(frame.water.x * 2.86, 0.0, 4.0);
    return normalize(vec3f(-hx * amp * 6.0, 1.0, -hz * amp * 6.0));
}

struct WaterOut
{
    @location(0) color : vec4f,
};

@fragment
fn waterFragment(in : FullscreenOut) -> WaterOut
{
    var out : WaterOut;
    let ro = frame.camPos.xyz;
    let rd = primaryRay(in.uv);
    let terrainDepth = textureLoad(depthTex, vec2i(in.position.xy), 0).r;

    let wh = traceWater(ro, rd, min(terrainDepth + 2.0, 1.0e5));
    if (wh.hit < 0.5 || wh.t > terrainDepth)
    {
        discard;
    }

    let sample = waterSampleAt(wh.pos.xz);
    let flowSample = waterFlowAt(wh.pos.xz);
    let flow = vec2f(flowSample.x, flowSample.y);
    let speed = sample.w;
    let time = frame.worldHi.w;
    let n = waterNormal(wh.pos, flow, speed, time);
    let sunDir = normalize(frame.sun.xyz);
    let v = -rd;

    // Fresnel reflectance.
    let f0 = 0.02;
    let fres = f0 + (1.0 - f0) * pow(clamp(1.0 - dot(n, v), 0.0, 1.0), 5.0);
    let refl = skyColor(reflect(rd, n));
    let specular = clamp(frame.waterOptics.x, 0.0, 2.0);
    let spec = pow(max(dot(reflect(rd, n), sunDir), 0.0), 420.0) * 3.4 * frame.sun.w * specular;
    let glint = pow(max(dot(reflect(rd, n), sunDir), 0.0), 26.0) * 0.28 * frame.sun.w * specular;

    // Refraction: march the bed a short distance and reuse the terrain shader.
    let depth = max(sample.y, 0.0);
    var bedDepth = 1.0;
    var bedColor = vec3f(0.10, 0.12, 0.11);
    let wobble = normalize(mix(vec3f(0.0, 1.0, 0.0), n, clamp(frame.water.y, 0.0, 1.0)));
    let refracted = refract(rd, wobble, 1.0 / 1.333);
    if (dot(refracted, refracted) > 0.01)
    {
        var t = max(voxelSize() * 0.5, 0.35);
        var prev = terrainAt(sdfIn, wh.pos);
        for (var i = 0; i < 64; i = i + 1)
        {
            let p = wh.pos + refracted * t;
            let d = terrainAt(sdfIn, p);
            if (d < voxelSize() * 0.08)
            {
                bedColor = shadeSurface(refracted, p, surfaceNormalDetailed(sdfIn, p, detailAmp() * 0.4), materialAt(matIn, p));
                bedDepth = length(p - wh.pos);
                break;
            }
            t = t + clamp(d * 0.8, voxelSize() * 0.3, voxelSize() * 3.0);
            prev = d;
            if (t > depth * 22.0 + voxelSize() * 6.0)
            {
                break;
            }
        }
    }

    // Beer-Lambert absorption with a shallow-water bed transmission term.
    let turbidity = clamp(sample.z * 0.6 + frame.waterOptics.z, 0.0, 1.0);
    let absorption = clamp(frame.waterOptics.y, 0.0, 0.6);
    // Absorption per channel: red dies first, which is why deep rivers read blue-green.
    let absorb = vec3f(0.42, 0.16, 0.10) * absorption * 11.0 * (0.55 + turbidity * 3.4);
    let trans = exp(-absorb * bedDepth);
    var body = bedColor * trans + frame.waterDeep.rgb * (1.0 - trans) * 0.6;
    body = mix(body, mix(bedColor, vec3f(0.30, 0.26, 0.19), 0.7), turbidity * 0.85);
    // Shallow water shows the bed through a tinted sheet rather than pure absorption.
    body = mix(frame.waterShallow.rgb, body, smoothstep(0.0, 0.55, depth));
    body = mix(body, vec3f(0.40, 0.32, 0.22), clamp(frame.waterOptics.w, 0.0, 1.0) * clamp(sample.z, 0.0, 1.0) * 0.6);

    // Foam: banks, shallows, broken crests and high-Froude flow.
    let shore = 1.0 - smoothstep(0.0, voxelSize() * 0.9, depth * 5.0);
    let turbulent = clamp(speed / 5.0, 0.0, 1.0);
    let foamNoise = flowStreaks(wh.pos, flow, speed * 1.7, time) * clamp(frame.water.w, 0.0, 2.0);
    let foam = clamp(shore * 0.75 + turbulent * 0.6, 0.0, 1.0) * smoothstep(0.45, 0.95, foamNoise) * 1.4;
    body = mix(body, vec3f(0.92, 0.94, 0.95), clamp(foam * frame.water.z, 0.0, 0.85));

    var col = mix(body, refl, clamp(fres * 1.05, 0.0, 0.92));
    col = col + vec3f(1.0, 0.95, 0.85) * (spec + glint);
    col = integrateFog(col, wh.t, rd);

    out.color = vec4f(col, 0.97);
    return out;
}
`;

//------------------------------------------------------------------------------------------
// Agent parcels
//------------------------------------------------------------------------------------------
const POINTS = /* wgsl */ `
struct PointOut
{
    @builtin(position) position : vec4f,
    @location(0) uv : vec2f,
    @location(1) color : vec4f,
};

@vertex
fn pointVertex(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> PointOut
{
    var out : PointOut;
    let p = particles[instanceIndex];
    var corners : array<vec2f, 6> = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0));
    let corner = corners[vertexIndex];

    if (p.pos.w < 0.0)
    {
        // Free slot: collapse off-screen.
        out.position = vec4f(0.0, 0.0, 2.0, 1.0);
        out.uv = corner;
        out.color = vec4f(0.0);
        return out;
    }

    let worldPos = p.pos.xyz;
    let toEye = frame.camPos.xyz - worldPos;
    let dist = length(toEye);
    let viewDir = toEye / max(dist, 1e-4);
    let right = normalize(cross(vec3f(0.0, 1.0, 0.0), viewDir) + vec3f(1e-6, 0.0, 0.0));
    let up = cross(viewDir, right);

    var size = p.info.y * frame.particles.w * 2.4;
    size = clamp(size, voxelSize() * 0.12, voxelSize() * 3.0);
    let world = worldPos + right * (corner.x * size) + up * (corner.y * size);

    let view = frame.camFwd.xyz;
    // Manual perspective: camera basis is orthonormal, so project onto it.
    let rel = world - frame.camPos.xyz;
    let x = dot(rel, frame.camRight.xyz);
    let y = dot(rel, frame.camUp.xyz);
    let z = max(dot(rel, view), 1e-4);
    let aspect = frame.view.x / max(frame.view.y, 1.0);
    let f = 1.0 / frame.camPos.w;
    out.position = vec4f(x * f / aspect, y * f, z * 0.5, z);
    out.uv = corner;

    let kind = p.info.x;
    let load = p.load;
    var tint = vec3f(0.35, 0.62, 0.95);
    if (kind > 2.5)
    {
        tint = vec3f(0.62, 0.34, 0.22);
    }
    else if (kind > 1.5)
    {
        tint = vec3f(0.78, 0.72, 0.52);
    }
    else if (kind > 0.5)
    {
        tint = vec3f(0.28, 0.55, 0.72);
    }
    let loadTotal = max(load.x + load.y + load.z + load.w, 0.0);
    let loading = clamp(loadTotal / max(voxelSize() * voxelSize() * voxelSize() * 20.0, 1e-9), 0.0, 1.0);
    tint = mix(tint, vec3f(0.72, 0.55, 0.31), loading * 0.85);
    let fade = clamp(1.0 - dist / 2600.0, 0.25, 1.0);
    out.color = vec4f(tint, 0.85 * fade);
    return out;
}

@fragment
fn pointFragment(in : PointOut) -> @location(0) vec4f
{
    let r = length(in.uv);
    if (r > 1.0)
    {
        discard;
    }
    // Soft core with a bright rim reads better than a hard disc at 2-4 px.
    let alpha = in.color.a * smoothstep(1.0, 0.35, r) * 0.85 + in.color.a * smoothstep(0.85, 1.0, r) * 0.5;
    return vec4f(in.color.rgb * (1.0 + (1.0 - r) * 0.6), clamp(alpha, 0.0, 1.0));
}
`;

//------------------------------------------------------------------------------------------
// Accumulation and presentation
//------------------------------------------------------------------------------------------
const PRESENT = /* wgsl */ `
struct ShadeOut
{
    @location(0) color : vec4f,
};

@vertex
fn presentVertex(@builtin(vertex_index) index : u32) -> FullscreenOut
{
    var out : FullscreenOut;
    let x = f32((index << 1u) & 2u);
    let y = f32(index & 2u);
    out.uv = vec2f(x, y);
    out.position = vec4f(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
    return out;
}

@fragment
fn accumulateFragment(in : FullscreenOut) -> ShadeOut
{
    var out : ShadeOut;
    let texel = vec2i(in.position.xy);
    out.color = textureLoad(colorTex, texel, 0);
    return out;
}

@fragment
fn presentFragment(in : FullscreenOut) -> ShadeOut
{
    var out : ShadeOut;
    let texel = vec2i(in.position.xy);
    let samples = max(frame.view.z, 1.0);
    var col = textureLoad(accumTex, texel, 0).rgb / samples;
    col = tonemap(col);
    // Vignette + subtle filmic contrast keeps the image from looking flat.
    let uv = in.uv * 2.0 - vec2f(1.0);
    let vig = 1.0 - 0.22 * dot(uv, uv);
    col = col * vig;
    out.color = vec4f(col, 1.0);
    return out;
}
`;

export function renderShader(graph = GRAPH_STUB)
{
    return `${COMMON}\n${RENDER_BINDINGS}\n${WATER_SAMPLE}\n${TERRAIN}\n${WATER}\n${POINTS}\n${PRESENT}\n${graph}`;
}

export const RENDER_MODULE = renderShader();
