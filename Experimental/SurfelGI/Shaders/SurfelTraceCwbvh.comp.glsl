#version 460
#extension GL_GOOGLE_include_directive : require
// Software path tracing for surfel rays. There is no ray-query/DXR/VK_KHR_ray_tracing_pipeline use in this file.
#include "SurfelTypes.glsl"

layout(local_size_x = 64, local_size_y = 1, local_size_z = 1) in;

layout(push_constant) uniform TraceConstants
{
    vec4 cameraPosition;
    uvec4 control;                 // x frame index, y path steps (6), z ray step (3), w luminaire count
};

struct FlatTriangle
{
    vec4 v0Material;               // xyz world vertex, w uint material index
    vec4 v1;
    vec4 v2;
    vec4 unusedUv;
};
struct BasicMaterial
{
    vec4 albedoRoughness;
    vec4 emissiveMetalness;
};
struct Luminaire
{
    uint triangleIndex;
    uint instanceIndex;
    uint primitiveIndex;
    uint aliasSlot;
    float threshold;
    float area;
    float probability;
    float padding;
};

layout(std430, set = 0, binding = 0) readonly buffer SurfelBuffer { Surfel surfels[]; };
layout(std430, set = 0, binding = 1) readonly buffer ValidIndices { uint validIndices[]; };
layout(std430, set = 0, binding = 2) readonly buffer CellInfos { CellInfo cells[]; };
layout(std430, set = 0, binding = 3) readonly buffer CellToSurfel { uint cellToSurfel[]; };
layout(std430, set = 0, binding = 4) buffer RayResults { RayResult rayResults[]; };
layout(std430, set = 0, binding = 5) buffer RefCounts { uint referenceCount[]; };
layout(std430, set = 0, binding = 6) buffer Counters { uint counter[]; };
layout(std430, set = 0, binding = 7) readonly buffer TraversalNodeExtent { vec4 CwbvhNodes[]; };
layout(std430, set = 0, binding = 8) readonly buffer TraversalLeafExtent { vec4 CwbvhTris[]; };
layout(std430, set = 0, binding = 9) readonly buffer TriangleExtent { FlatTriangle triangles[]; };
layout(std430, set = 0, binding = 10) readonly buffer MaterialExtent { BasicMaterial materials[]; };
layout(std430, set = 0, binding = 11) readonly buffer LuminaireExtent { Luminaire luminaires[]; };

// Reuse Slate's portable CWBVH code. It reads the two SSBOs above and has no hardware-RT dependency.
#include "../../../Engine/Shaders/TraversalCWBVH.slang"

vec3 TriangleNormal(FlatTriangle triangle)
{
    return normalize(cross(triangle.v1.xyz - triangle.v0Material.xyz, triangle.v2.xyz - triangle.v0Material.xyz));
}

vec3 SampleTriangle(uint triangleIndex, float u, float v)
{
    FlatTriangle triangle = triangles[triangleIndex];
    float su = sqrt(u);
    return (1.0 - su) * triangle.v0Material.xyz + su * (1.0 - v) * triangle.v1.xyz + su * v * triangle.v2.xyz;
}

// Equivalent to the upstream pass's surfel-radiance path termination. It intentionally has the same 64-neighbour
// cutoff and 20% continuation lottery: both avoid biasedly overusing a dense local set.
bool ReuseSurfelRadiance(vec3 position, vec3 normal, inout uint rng, inout vec3 accumulated, vec3 throughput)
{
    ivec3 cell = CellPosition(position, cameraPosition.xyz);
    if (!IsCellValid(cell)) return false;
    CellInfo info = cells[FlattenCell(cell)];
    if (info.count > 64u || Random01(rng) < 0.2)
    {
        atomicAdd(counter[kCounterMissBounce], 1u);
        return false;
    }

    vec4 radiance = vec4(0.0);
    for (uint i = 0u; i < info.count; ++i)
    {
        uint index = cellToSurfel[info.offset + i];
        Surfel surfel = surfels[index];
        if ((surfel.rayAndFlags.w & kStatusSleeping) != 0u) continue;
        float contribution = Coverage(surfel, position, normal);
        if (contribution <= 0.0) continue;
        radiance += vec4(surfel.radianceLuminance.xyz, 1.0) * contribution;
        atomicAdd(referenceCount[index], 1u);
    }
    if (radiance.w <= 0.0)
    {
        atomicAdd(counter[kCounterMissBounce], 1u);
        return false;
    }
    accumulated += throughput * (radiance.xyz / radiance.w);
    return true;
}

vec3 SampleDirectLight(vec3 position, vec3 normal, inout uint rng)
{
    if (control.w == 0u) return vec3(0.0);
    uint lightSlot = min(uint(Random01(rng) * float(control.w)), control.w - 1u);
    Luminaire light = luminaires[lightSlot];
    FlatTriangle lightTriangle = triangles[light.triangleIndex];
    vec3 lightPoint = SampleTriangle(light.triangleIndex, Random01(rng), Random01(rng));
    vec3 toLight = lightPoint - position;
    float distanceToLight = length(toLight);
    if (distanceToLight <= kRayEpsilon) return vec3(0.0);
    vec3 direction = toLight / distanceToLight;
    if (dot(normal, direction) <= 0.0) return vec3(0.0);

    // The CWBVH any-hit query stops before the sampled light to avoid self-occlusion.
    if (TraverseOccluded(position + normal * kRayEpsilon, direction, 1.0 / direction,
                         max(kRayEpsilon, distanceToLight - 2.0 * kRayEpsilon))) return vec3(0.0);

    uint materialIndex = floatBitsToUint(lightTriangle.v0Material.w);
    vec3 emission = materials[materialIndex].emissiveMetalness.xyz;
    float area = max(light.area, 1e-5);
    float lightCos = max(0.0, dot(-direction, TriangleNormal(lightTriangle)));
    // Uniform luminaire selection + uniform area sample; diffuse BRDF at the receiving point.
    return emission * (max(0.0, dot(normal, direction)) * lightCos * area * float(control.w) /
                       max(distanceToLight * distanceToLight, 1e-5) / kPi);
}

void main()
{
    uint rayIndex = gl_GlobalInvocationID.x;
    uint requested = min(counter[kCounterRequestedRay], kRayBudget);
    if (rayIndex >= requested) return;

    uint surfelIndex = floatBitsToUint(rayResults[rayIndex].radianceSurfel.w);
    if (surfelIndex >= kSurfelLimit) return;
    Surfel source = surfels[surfelIndex];
    uint rng = Hash(rayIndex ^ (control.x * 0x9e3779b9u));

    mat3 frame = TangentFrame(normalize(source.normalRayOffset.xyz));
    vec3 localDirection = CosineHemisphere(rng);
    vec3 direction = normalize(frame * localDirection);
    vec3 initialDirection = direction;
    float pdf = max(localDirection.z / kPi, 1e-6);
    vec3 origin = source.positionRadius.xyz + normalize(source.normalRayOffset.xyz) * kRayEpsilon;
    vec3 throughput = vec3(1.0);
    vec3 radiance = vec3(0.0);
    float firstLength = -1.0;

    uint steps = min(max(control.y, 1u), 6u);
    for (uint step = 0u; step < steps; ++step)
    {
        TraversalHit hit = TraverseClosest(origin, direction, 1.0 / direction, 1e30);
        if (hit.primitive == 0xffffffffu) break;
        if (step == 0u) firstLength = hit.t;

        FlatTriangle triangle = triangles[hit.primitive];
        uint materialIndex = floatBitsToUint(triangle.v0Material.w);
        BasicMaterial material = materials[materialIndex];
        vec3 normal = TriangleNormal(triangle);
        if (dot(normal, -direction) < 0.0) normal = -normal;
        vec3 position = origin + direction * hit.t;

        radiance += throughput * material.emissiveMetalness.xyz;
        radiance += throughput * material.albedoRoughness.xyz * SampleDirectLight(position, normal, rng);
        if (ReuseSurfelRadiance(position, normal, rng, radiance, throughput)) break;

        // Lambertian continuation: cosine sampling makes f*cos/pdf equal the linear albedo.
        throughput *= material.albedoRoughness.xyz;
        mat3 hitFrame = TangentFrame(normal);
        direction = normalize(hitFrame * CosineHemisphere(rng));
        origin = position + normal * kRayEpsilon;
    }

    rayResults[rayIndex].directionLocalPdf = vec4(localDirection, pdf);
    rayResults[rayIndex].directionWorldFirstLength = vec4(initialDirection, firstLength);
    rayResults[rayIndex].radianceSurfel = vec4(radiance, uintBitsToFloat(surfelIndex));
}
