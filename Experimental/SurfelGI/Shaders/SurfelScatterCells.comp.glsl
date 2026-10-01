#version 460
#extension GL_GOOGLE_include_directive : require
// Fills the cell → surfel relation built by SurfelPrefixCells. Dispatch ceil(validSurfels / 64) groups.
#include "SurfelTypes.glsl"

layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;
layout(push_constant) uniform ScatterConstants { vec4 cameraPosition; };

layout(std430, set = 0, binding = 0) readonly buffer SurfelBuffer { Surfel surfels[]; };
layout(std430, set = 0, binding = 1) readonly buffer ValidIndices { uint validIndices[]; };
layout(std430, set = 0, binding = 2) buffer CellInfos { CellInfo cells[]; };
layout(std430, set = 0, binding = 3) buffer CellToSurfel { uint cellToSurfel[]; };
layout(std430, set = 0, binding = 4) readonly buffer Counters { uint counter[]; };

void main()
{
    uint workIndex = gl_GlobalInvocationID.x;
    uint validCount = min(counter[kCounterValid], kSurfelLimit);
    if (workIndex >= validCount) return;

    uint surfelIndex = validIndices[workIndex];
    Surfel surfel = surfels[surfelIndex];
    ivec3 center = CellPosition(surfel.positionRadius.xyz, cameraPosition.xyz);
    for (int z = -2; z <= 2; ++z)
    for (int y = -2; y <= 2; ++y)
    for (int x = -2; x <= 2; ++x)
    {
        ivec3 cell = center + ivec3(x, y, z);
        if (!IntersectsCell(surfel, cell, cameraPosition.xyz)) continue;
        uint cellIndex = FlattenCell(cell);
        uint slot = atomicAdd(cells[cellIndex].count, 1u);
        uint outputIndex = cells[cellIndex].offset + slot;
        // The reference allocation is exactly SurfelLimit * 125. Preserve this guard against data corruption.
        if (outputIndex < kSurfelLimit * kCellsTouchedPerSurfel) cellToSurfel[outputIndex] = surfelIndex;
    }
}
