#version 460
#extension GL_GOOGLE_include_directive : require
// Converts each cell's membership count into an append range.  The counter buffer stores the total required entries.
#include "SurfelTypes.glsl"

layout(local_size_x = 128, local_size_y = 1, local_size_z = 1) in;
layout(std430, set = 0, binding = 0) buffer CellInfos { CellInfo cells[]; };
layout(std430, set = 0, binding = 1) buffer CellReservations { uint reservation[]; };
layout(std430, set = 0, binding = 2) buffer Counters { uint counter[]; };

void main()
{
    uint cellIndex = gl_GlobalInvocationID.x;
    if (cellIndex >= kCellCount) return;
    reservation[cellIndex] = 0u;
    uint count = cells[cellIndex].count;
    if (count == 0u) return;

    uint offset = atomicAdd(counter[kCounterCell], count);
    cells[cellIndex].offset = offset;
    // A cell count is consumed by ScatterCells as a per-cell cursor; after this it starts at zero.
    cells[cellIndex].count = 0u;
}
