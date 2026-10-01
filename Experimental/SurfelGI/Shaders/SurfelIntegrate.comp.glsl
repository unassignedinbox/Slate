#version 460
#extension GL_GOOGLE_include_directive : require
// Integrates the software-traced ray results, maintains surfel depth moments and updates MSME-filtered radiance.
#include "SurfelTypes.glsl"

layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;
layout(push_constant) uniform IntegrateConstants
{
    vec4 cameraShortWindow;       // xyz camera position, w short mean blend (0.03)
    vec4 tuning;                  // x variance sensitivity, y irradiance sharing enable, z depth moments enable, w reserved
};

layout(std430, set = 0, binding = 0) buffer SurfelBuffer { Surfel surfels[]; };
layout(std430, set = 0, binding = 1) readonly buffer ValidIndices { uint validIndices[]; };
layout(std430, set = 0, binding = 2) readonly buffer CellInfos { CellInfo cells[]; };
layout(std430, set = 0, binding = 3) readonly buffer CellToSurfel { uint cellToSurfel[]; };
layout(std430, set = 0, binding = 4) readonly buffer RayResults { RayResult rayResults[]; };
layout(std430, set = 0, binding = 5) readonly buffer Counters { uint counter[]; };
layout(rg32f, set = 0, binding = 6) uniform coherent image2D SurfelDepthMoments;

const ivec2 kMomentExtent = ivec2(3840, 2160);
const ivec2 kMomentTile = ivec2(7, 7);

ivec2 MomentTileOrigin(uint surfelIndex)
{
    uint columns = uint(kMomentExtent.x / kMomentTile.x);
    return ivec2(int((surfelIndex % columns) * uint(kMomentTile.x)), int((surfelIndex / columns) * uint(kMomentTile.y)));
}

void WriteDepthMoment(uint surfelIndex, vec3 localDirection, float distanceValue)
{
    vec2 oct = OctEncode(normalize(localDirection));
    ivec2 inner = ivec2(3) + ivec2(round(oct * 2.0));
    inner = clamp(inner, ivec2(1), kMomentTile - ivec2(2));
    ivec2 target = MomentTileOrigin(surfelIndex) + inner;
    vec3 texelDirection = OctDecode(vec2(inner - ivec2(3)) / 2.0);
    float weight = max(0.0, dot(normalize(localDirection), texelDirection));
    vec2 oldValue = imageLoad(SurfelDepthMoments, target).xy;
    vec2 targetValue = vec2(distanceValue, distanceValue * distanceValue);
    imageStore(SurfelDepthMoments, target, vec4(mix(oldValue, targetValue, 0.01 * weight), 0.0, 0.0));
}

void CloseMomentBorder(uint surfelIndex)
{
    ivec2 origin = MomentTileOrigin(surfelIndex);
    for (int x = 1; x < 6; ++x)
    {
        imageStore(SurfelDepthMoments, origin + ivec2(x, 0), imageLoad(SurfelDepthMoments, origin + ivec2(x, 1)));
        imageStore(SurfelDepthMoments, origin + ivec2(x, 6), imageLoad(SurfelDepthMoments, origin + ivec2(x, 5)));
    }
    for (int y = 1; y < 6; ++y)
    {
        imageStore(SurfelDepthMoments, origin + ivec2(0, y), imageLoad(SurfelDepthMoments, origin + ivec2(1, y)));
        imageStore(SurfelDepthMoments, origin + ivec2(6, y), imageLoad(SurfelDepthMoments, origin + ivec2(5, y)));
    }
}

vec3 SharedIrradiance(uint selfIndex, Surfel source)
{
    ivec3 cell = CellPosition(source.positionRadius.xyz, cameraShortWindow.xyz);
    if (!IsCellValid(cell)) return vec3(0.0);
    CellInfo info = cells[FlattenCell(cell)];
    vec4 shared = vec4(0.0);
    float radius = kCellUnit * sqrt(2.0);
    for (uint i = 0u; i < info.count; ++i)
    {
        uint neighbourIndex = cellToSurfel[info.offset + i];
        if (neighbourIndex == selfIndex) continue;
        Surfel neighbour = surfels[neighbourIndex];
        vec3 delta = source.positionRadius.xyz - neighbour.positionRadius.xyz;
        float d2 = dot(delta, delta);
        if (d2 >= radius * radius) continue;
        float c = max(0.0, dot(source.normalRayOffset.xyz, neighbour.normalRayOffset.xyz));
        c *= max(0.0, 1.0 - sqrt(max(d2, 0.0)) / radius);
        c = smoothstep(0.0, 1.0, c);
        shared += vec4(neighbour.radianceLuminance.xyz, 1.0) * c;
    }
    return shared.w > 0.0 ? shared.xyz / shared.w : vec3(0.0);
}

void main()
{
    uint validSlot = gl_GlobalInvocationID.x;
    if (validSlot >= min(counter[kCounterValid], kSurfelLimit)) return;
    uint surfelIndex = validIndices[validSlot];
    Surfel surfel = surfels[surfelIndex];
    uint rayCount = surfel.rayAndFlags.x;
    if (rayCount == 0u) return;

    uint rayOffset = floatBitsToUint(surfel.normalRayOffset.w);
    vec3 radiance = vec3(0.0);
    for (uint r = 0u; r < rayCount; ++r)
    {
        RayResult result = rayResults[rayOffset + r];
        float distanceValue = result.directionWorldFirstLength.w > 0.0
            ? clamp(result.directionWorldFirstLength.w, 0.0, surfel.positionRadius.w)
            : surfel.positionRadius.w;
        if (tuning.z > 0.5) WriteDepthMoment(surfelIndex, result.directionLocalPdf.xyz, distanceValue);
        radiance += result.radianceSurfel.xyz * max(0.0, dot(result.directionWorldFirstLength.xyz, surfel.normalRayOffset.xyz)) /
                    max(16.0 * kPi * result.directionLocalPdf.w, 1e-12);
    }
    radiance /= float(rayCount);
    if (tuning.z > 0.5) CloseMomentBorder(surfelIndex);

    if (tuning.y > 0.5)
    {
        vec3 shared = SharedIrradiance(surfelIndex, surfel);
        if (dot(shared, shared) > 0.0)
        {
            float blend = clamp(length(surfel.varianceInconsistency.xyz) * tuning.x, 0.0, 1.0);
            radiance = mix(radiance, shared, blend);
        }
    }

    surfel.radianceLuminance.xyz = UpdateMsme(radiance, surfel, cameraShortWindow.w);
    surfels[surfelIndex] = surfel;
}
