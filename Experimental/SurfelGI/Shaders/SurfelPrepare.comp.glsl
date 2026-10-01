#version 460
#extension GL_GOOGLE_include_directive : require
// First pass of every frame. Dispatch exactly one workgroup.
#include "SurfelTypes.glsl"

layout(local_size_x = 1, local_size_y = 1, local_size_z = 1) in;
layout(std430, set = 0, binding = 0) buffer Counters { uint counter[]; };

void main()
{
    uint dirty = min(counter[kCounterValid], kSurfelLimit);
    counter[kCounterValid] = 0u;
    counter[kCounterDirty] = dirty;
    counter[kCounterFree] = min(counter[kCounterFree], kSurfelLimit);
    counter[kCounterCell] = 0u;
    counter[kCounterRequestedRay] = 0u;
    counter[kCounterMissBounce] = 0u;
}
