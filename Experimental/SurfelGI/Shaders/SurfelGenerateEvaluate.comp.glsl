#version 460
#extension GL_GOOGLE_include_directive : require
// Gathers persistent surfels on Slate's visibility-resolved primary surfaces and probabilistically creates/removes surfels.
#include "SurfelTypes.glsl"

layout(local_size_x = 16, local_size_y = 16, local_size_z = 1) in;
layout(push_constant) uniform GenerateConstants
{
    vec4 cameraPositionFov;       // xyz camera position, w vertical FOV in radians
    uvec4 render;                 // xy resolution, z frame index, w overlay (0 = indirect radiance)
    vec4 tuning;                  // x placement, y removal, z chance multiplier, w chance power
    vec4 filtering;               // x blend delay, y variance sensitivity, z max surfels/cell, w depth-moment enable
};

layout(std430, set = 0, binding = 0) buffer SurfelBuffer { Surfel surfels[]; };
layout(std430, set = 0, binding = 1) buffer GeometryBuffer { uint geometry[]; };
layout(std430, set = 0, binding = 2) buffer ValidIndices { uint validIndices[]; };
layout(std430, set = 0, binding = 3) buffer FreeIndices { uint freeIndices[]; };
layout(std430, set = 0, binding = 4) readonly buffer CellInfos { CellInfo cells[]; };
layout(std430, set = 0, binding = 5) readonly buffer CellToSurfel { uint cellToSurfel[]; };
layout(std430, set = 0, binding = 6) buffer Counters { uint counter[]; };
layout(std430, set = 0, binding = 7) buffer RefCounts { uint referenceCount[]; };
layout(std430, set = 0, binding = 8) buffer CellReservations { uint reservation[]; };
layout(rgba32f, set = 0, binding = 9) uniform readonly image2D SurfaceImage;
layout(rgba16f, set = 0, binding = 10) uniform readonly image2D NormalImage;
layout(rg32f, set = 0, binding = 11) uniform readonly image2D SurfelDepthMoments;
layout(rgba32f, set = 0, binding = 12) uniform writeonly image2D IndirectImage;
layout(set = 0, binding = 13) uniform sampler2D DeviceDepth;

shared uint groupMinimumCoverage;
shared uint groupMaximumContribution;

ivec2 MomentTileOrigin(uint surfelIndex)
{
    const uint columns = 3840u / 7u;
    return ivec2(int((surfelIndex % columns) * 7u), int((surfelIndex / columns) * 7u));
}

float MomentVisibility(uint surfelIndex, vec3 direction, vec3 normal, float distanceToSurfel)
{
    mat3 tangent = TangentFrame(normal);
    vec3 local = transpose(tangent) * direction;
    vec2 oct = OctEncode(normalize(local));
    ivec2 coord = MomentTileOrigin(surfelIndex) + clamp(ivec2(3) + ivec2(round(oct * 2.0)), ivec2(1), ivec2(5));
    vec2 moments = imageLoad(SurfelDepthMoments, coord).xy;
    if (distanceToSurfel <= moments.x) return 1.0;
    float variance = max(0.0, moments.y - moments.x * moments.x);
    return variance / max(variance + (distanceToSurfel - moments.x) * (distanceToSurfel - moments.x), 1e-6);
}

void main()
{
    uvec2 pixel = gl_GlobalInvocationID.xy;
    uint localIndex = gl_LocalInvocationIndex;
    if (localIndex == 0u)
    {
        groupMinimumCoverage = 0xffffffffu;
        groupMaximumContribution = 0u;
    }
    barrier();

    bool inBounds = pixel.x < render.x && pixel.y < render.y;
    vec4 surface = inBounds ? imageLoad(SurfaceImage, ivec2(pixel)) : vec4(0.0);
    uint visibility = floatBitsToUint(surface.w);
    bool valid = inBounds && visibility != 0xffffffffu;
    vec3 position = surface.xyz;
    vec3 normal = valid ? normalize(imageLoad(NormalImage, ivec2(pixel)).xyz) : vec3(0.0, 0.0, 1.0);
    float coverage = 65504.0; // an invalid lane cannot win the min reduction
    float maximumContribution = 0.0;
    uint maximumContributionSlot = 0u;
    vec4 indirect = vec4(0.0);
    CellInfo cellInfo;
    uint cellIndex = 0u;

    if (valid)
    {
        ivec3 cell = CellPosition(position, cameraPositionFov.xyz);
        valid = IsCellValid(cell);
        if (valid)
        {
            cellIndex = FlattenCell(cell);
            cellInfo = cells[cellIndex];
            coverage = 0.0;
            for (uint i = 0u; i < cellInfo.count; ++i)
            {
                uint surfelIndex = cellToSurfel[cellInfo.offset + i];
                Surfel surfel = surfels[surfelIndex];
                float c = Coverage(surfel, position, normal);
                if (c <= 0.0) continue;
                vec3 delta = position - surfel.positionRadius.xyz;
                float distanceToSurfel = length(delta);
                if (filtering.w > 0.5 && distanceToSurfel > 1e-5)
                    c *= MomentVisibility(surfelIndex, delta / distanceToSurfel, normalize(surfel.normalRayOffset.xyz), distanceToSurfel);

                if ((surfel.rayAndFlags.w & kStatusSleeping) == 0u)
                {
                    coverage += c;
                    float warmup = smoothstep(0.0, filtering.x, float(surfel.reserved.y));
                    indirect += vec4(surfel.radianceLuminance.xyz, 1.0) * c * warmup;
                    if (c > maximumContribution) { maximumContribution = c; maximumContributionSlot = i; }
                }
                // Last-seen is a persistent bit consumed by CollectCells on the following frame.
                atomicOr(surfels[surfelIndex].rayAndFlags.w, kStatusLastSeen);
            }
            if (indirect.w > 0.0) indirect = vec4(indirect.xyz / indirect.w, clamp(indirect.w, 0.0, 1.0));
        }
    }

    // Positive IEEE half values preserve numeric order; high 16 bits are coverage, low bits give a deterministic lane.
    uint coveragePacked = packHalf2x16(vec2(0.0, coverage));
    uint minimumData = (coveragePacked & 0xffff0000u) | ((localIndex & 0xffu) << 8u) | (Hash(pixel.x + pixel.y * 4099u + render.z) & 0xffu);
    uint contributionPacked = packHalf2x16(vec2(0.0, maximumContribution));
    uint maximumData = (contributionPacked & 0xffff0000u) | (maximumContributionSlot & 0xffffu);
    atomicMin(groupMinimumCoverage, minimumData);
    atomicMax(groupMaximumContribution, maximumData);
    barrier();

    if (valid && localIndex == ((groupMinimumCoverage >> 8u) & 0xffu))
    {
        float groupCoverage = unpackHalf2x16(groupMinimumCoverage).y;
        uint rng = Hash(pixel.x + pixel.y * render.x + render.z * 0x9e3779b9u);
        float depthChance = pow(clamp(texelFetch(DeviceDepth, ivec2(pixel), 0).r, 0.0, 1.0), tuning.w);
        if (groupCoverage <= tuning.x && cellInfo.count < uint(filtering.z) && Random01(rng) < depthChance * tuning.z)
        {
            uint reservation = atomicAdd(reservation[cellIndex], 1u);
            // The original pass limits creation through a cell occupancy cap. The reservation additionally keeps racing
            // 16x16 groups from consuming the same free-list capacity without a bound.
            if (reservation < 8u)
            {
                // CAS preserves the upstream stack-pop behaviour while preventing unsigned underflow when the free
                // stack is exhausted (the original used a signed ByteAddressBuffer counter).
                uint oldFree = counter[kCounterFree];
                bool acquiredFreeSlot = false;
                while (oldFree > 0u)
                {
                    uint observed = atomicCompSwap(counter[kCounterFree], oldFree, oldFree - 1u);
                    if (observed == oldFree) { acquiredFreeSlot = true; break; }
                    oldFree = observed;
                }
                if (acquiredFreeSlot && oldFree <= kSurfelLimit)
                {
                    uint validSlot = atomicAdd(counter[kCounterValid], 1u);
                    if (validSlot < kSurfelLimit)
                    {
                        uint newIndex = freeIndices[oldFree - 1u];
                        float radius = ApproximateSurfelRadius(length(position - cameraPositionFov.xyz), cameraPositionFov.w, render.xy);
                        Surfel spawned;
                        spawned.positionRadius = vec4(position, radius);
                        spawned.normalRayOffset = vec4(normal, uintBitsToFloat(0u));
                        spawned.radianceLuminance = vec4(indirect.xyz, 0.0);
                        spawned.meanVbbr = vec4(indirect.xyz, 0.0);
                        spawned.shortMean = vec4(indirect.xyz, 0.0);
                        spawned.varianceInconsistency = vec4(0.0, 1.0);
                        spawned.rayAndFlags = uvec4(0u, 0u, kMaxLife, 0u);
                        spawned.reserved = uvec4(0u);
                        surfels[newIndex] = spawned;
                        geometry[newIndex] = visibility;
                        referenceCount[newIndex] = 0u;
                        validIndices[validSlot] = newIndex;
                    }
                }
            }
        }

        if (groupCoverage > tuning.y && cellInfo.count > 0u && Random01(rng) < depthChance * tuning.z)
        {
            uint worstSlot = groupMaximumContribution & 0xffffu;
            if (worstSlot < cellInfo.count)
            {
                uint removeIndex = cellToSurfel[cellInfo.offset + worstSlot];
                surfels[removeIndex].positionRadius.w = 0.0;
            }
        }
    }

    if (inBounds) imageStore(IndirectImage, ivec2(pixel), indirect);
}
