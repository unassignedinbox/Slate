#version 460
#extension GL_GOOGLE_include_directive : require
// Updates life / radius, creates this frame's valid list, requests adaptive rays and counts cell memberships.
#include "SurfelTypes.glsl"

layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;
layout(push_constant) uniform CollectConstants
{
    vec4 cameraCellUnit;            // xyz camera position, w must equal kCellUnit in reference mode
    uvec4 render;                   // xy resolution, z lock surfels, w frame index
    vec4 tuning;                    // x vertical FOV radians, y variance sensitivity, z min rays, w max rays
};

layout(std430, set = 0, binding = 0) buffer SurfelBuffer { Surfel surfels[]; };
layout(std430, set = 0, binding = 1) readonly buffer DirtyIndices { uint dirtyIndices[]; };
layout(std430, set = 0, binding = 2) buffer ValidIndices { uint validIndices[]; };
layout(std430, set = 0, binding = 3) buffer FreeIndices { uint freeIndices[]; };
layout(std430, set = 0, binding = 4) buffer CellInfos { CellInfo cells[]; };
layout(std430, set = 0, binding = 5) buffer RayResults { RayResult rays[]; };
layout(std430, set = 0, binding = 6) buffer Counters { uint counter[]; };
layout(std430, set = 0, binding = 7) buffer RefCounts { uint referenceCount[]; };

void main()
{
    uint workIndex = gl_GlobalInvocationID.x;
    uint dirtyCount = min(counter[kCounterDirty], kSurfelLimit);
    if (workIndex >= dirtyCount) return;

    uint index = dirtyIndices[workIndex];
    Surfel surfel = surfels[index];
    bool sleeping = (surfel.rayAndFlags.w & kStatusSleeping) != 0u;
    bool seenLastFrame = (surfel.rayAndFlags.w & kStatusLastSeen) != 0u;

    surfel.rayAndFlags.z = surfel.rayAndFlags.z > 0u ? surfel.rayAndFlags.z - 1u : 0u;
    surfel.reserved.y = min(surfel.reserved.y + 1u, 65535u); // age / blended-frame count
    if (seenLastFrame)
    {
        surfel.rayAndFlags.z = kMaxLife;
        sleeping = false;
    }
    if (sleeping && referenceCount[index] > kRefCountThreshold) surfel.rayAndFlags.z = kSleepingMaxLife;

    if (surfel.positionRadius.w <= 0.0 || surfel.rayAndFlags.z == 0u)
    {
        int freeSlot = atomicAdd(counter[kCounterFree], 1);
        if (freeSlot >= 0 && uint(freeSlot) < kSurfelLimit) freeIndices[freeSlot] = index;
        return;
    }

    uint validSlot = atomicAdd(counter[kCounterValid], 1u);
    if (validSlot >= kSurfelLimit) return;
    validIndices[validSlot] = index;

    if (render.z == 0u)
    {
        float distanceToCamera = length(surfel.positionRadius.xyz - cameraCellUnit.xyz);
        float radius = ApproximateSurfelRadius(distanceToCamera, tuning.x, render.xy);
        if (sleeping) radius = max(radius * 4.0, kCellUnit * 0.5);
        surfel.positionRadius.w = radius;

        uint lower = sleeping ? uint(tuning.z) / 4u : uint(tuning.w) / 4u;
        uint upper = sleeping ? uint(tuning.z) : uint(tuning.w);
        float variance = length(max(surfel.varianceInconsistency.xyz, vec3(0.0)));
        uint requested = uint(clamp(mix(float(lower), float(upper), variance * tuning.y), float(lower), float(upper)));
        uint rayOffset = atomicAdd(counter[kCounterRequestedRay], requested);
        surfel.normalRayOffset.w = uintBitsToFloat(rayOffset);
        surfel.rayAndFlags.x = rayOffset < kRayBudget ? min(requested, kRayBudget - rayOffset) : 0u;
        surfel.rayAndFlags.w = sleeping ? kStatusSleeping : 0u;
        referenceCount[index] = 0u;

        for (uint r = 0u; r < surfel.rayAndFlags.x; ++r)
        {
            uint destination = rayOffset + r;
            rays[destination].radianceSurfel.w = uintBitsToFloat(index);
        }
    }

    ivec3 center = CellPosition(surfel.positionRadius.xyz, cameraCellUnit.xyz);
    for (int z = -2; z <= 2; ++z)
    for (int y = -2; y <= 2; ++y)
    for (int x = -2; x <= 2; ++x)
    {
        ivec3 cell = center + ivec3(x, y, z);
        if (IntersectsCell(surfel, cell, cameraCellUnit.xyz)) atomicAdd(cells[FlattenCell(cell)].count, 1u);
    }
    surfels[index] = surfel;
}
