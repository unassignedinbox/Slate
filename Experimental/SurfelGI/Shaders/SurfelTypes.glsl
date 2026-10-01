// Shared GLSL ABI and math for the non-RTX SurfelGI pass set.
// The values mirror the W298/SurfelGI reference profile. See ../NOTICE.md.
#ifndef SLATE_EXPERIMENTAL_SURFEL_GI_TYPES
#define SLATE_EXPERIMENTAL_SURFEL_GI_TYPES

const uint  kSurfelLimit            = 150000u;
const uint  kRayBudget               = 9600000u;
const uint  kCellDimension           = 250u;
const uint  kCellCount               = 15625000u;
const uint  kCellsTouchedPerSurfel   = 125u;
const uint  kMaxLife                 = 240u;
const uint  kSleepingMaxLife         = 60u;
const uint  kRefCountThreshold       = 32u;
const float kCellUnit                = 0.05;
const float kSurfelTargetArea        = 40000.0;
const float kRayEpsilon              = 0.0005;
const float kPi                       = 3.14159265358979323846;
const uint  kStatusSleeping           = 1u;
const uint  kStatusLastSeen           = 2u;
const uint  kCounterValid             = 0u;
const uint  kCounterDirty             = 1u;
const uint  kCounterFree              = 2u;
const uint  kCounterCell              = 3u;
const uint  kCounterRequestedRay      = 4u;
const uint  kCounterMissBounce        = 5u;

// std430: 128 B. Keeping the records vec4-aligned avoids a DXR/Falcor ABI and is safe on Pascal drivers.
struct Surfel
{
    vec4 positionRadius;           // xyz position, w radius
    vec4 normalRayOffset;          // xyz normal, w uintBitsToFloat(ray offset)
    vec4 radianceLuminance;        // xyz filtered outgoing radiance, w guided luminance sum
    vec4 meanVbbr;                 // xyz long mean, w variance-based blend reduction
    vec4 shortMean;                // xyz short mean
    vec4 varianceInconsistency;    // xyz variance, w inconsistency
    uvec4 rayAndFlags;             // x ray count, y geometry / flat primitive, z life, w status
    uvec4 reserved;
};

struct CellInfo { uint count; uint offset; };

// 48 B. `firstLength < 0` means no first geometric hit; radiance is valid in both hit/miss cases.
struct RayResult
{
    vec4 directionLocalPdf;        // xyz cosine direction in surfel tangent space, w pdf
    vec4 directionWorldFirstLength; // xyz world direction, w first hit length
    vec4 radianceSurfel;           // xyz path estimate, w surfel index encoded as uint
};

uint Hash(uint x)
{
    x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
    return x;
}

float Random01(inout uint state)
{
    state = Hash(state + 0x9e3779b9u);
    return float(state & 0x00ffffffu) * (1.0 / 16777216.0);
}

vec3 TangentX(vec3 n)
{
    vec3 helper = abs(n.x) > 0.99 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
    return normalize(cross(n, helper));
}

mat3 TangentFrame(vec3 n)
{
    vec3 tangent = TangentX(n);
    return mat3(tangent, normalize(cross(n, tangent)), n);
}

vec3 CosineHemisphere(inout uint rng)
{
    float u = Random01(rng);
    float v = Random01(rng);
    float phi = 2.0 * kPi * v;
    float r = sqrt(u);
    return vec3(cos(phi) * r, sin(phi) * r, sqrt(max(0.0, 1.0 - u)));
}

vec2 OctEncode(vec3 v)
{
    float l1 = abs(v.x) + abs(v.y) + abs(v.z);
    vec2 r = v.xy / max(l1, 1e-20);
    return vec2(r.x - r.y, r.x + r.y);
}

vec3 OctDecode(vec2 uv)
{
    vec2 r = vec2((uv.x + uv.y) * 0.5, (uv.y - uv.x) * 0.5);
    return normalize(vec3(r, 1.0 - abs(r.x) - abs(r.y)));
}

ivec3 CellPosition(vec3 worldPosition, vec3 cameraPosition)
{
    return ivec3(round((worldPosition - cameraPosition) / kCellUnit));
}

bool IsCellValid(ivec3 cell)
{
    return all(lessThan(abs(cell), ivec3(int(kCellDimension / 2u))));
}

uint FlattenCell(ivec3 cell)
{
    uvec3 p = uvec3(cell + ivec3(int(kCellDimension / 2u)));
    return p.z * kCellDimension * kCellDimension + p.y * kCellDimension + p.x;
}

bool IntersectsCell(Surfel surfel, ivec3 cell, vec3 cameraPosition)
{
    if (!IsCellValid(cell)) return false;
    vec3 center = vec3(cell) * kCellUnit + cameraPosition;
    vec3 closest = clamp(surfel.positionRadius.xyz,
                         center - vec3(kCellUnit * 0.5),
                         center + vec3(kCellUnit * 0.5));
    vec3 delta = closest - surfel.positionRadius.xyz;
    return dot(delta, delta) < surfel.positionRadius.w * surfel.positionRadius.w;
}

float ApproximateSurfelRadius(float distanceToCamera, float verticalFov, uvec2 resolution)
{
    float projectedRadius = sqrt(kSurfelTargetArea / kPi) * verticalFov / float(max(resolution.x, resolution.y));
    return min(distanceToCamera * tan(projectedRadius), 2.0 * kCellUnit);
}

float Coverage(Surfel surfel, vec3 position, vec3 normal)
{
    vec3 delta = position - surfel.positionRadius.xyz;
    float distanceSquared = dot(delta, delta);
    float radius = surfel.positionRadius.w;
    if (distanceSquared >= radius * radius || radius <= 0.0) return 0.0;
    float distanceToSurfel = sqrt(max(distanceSquared, 1e-12));
    float c = max(0.0, dot(normal, normalize(surfel.normalRayOffset.xyz)));
    c *= max(0.0, 1.0 - distanceToSurfel / radius);
    return smoothstep(0.0, 1.0, c);
}

// Multi-Scale Mean Estimator, carried over from the upstream pass.
vec3 UpdateMsme(vec3 sample, inout Surfel surfel, float shortWindowBlend)
{
    vec3 mean = surfel.meanVbbr.xyz;
    vec3 shortMean = surfel.shortMean.xyz;
    vec3 variance = max(surfel.varianceInconsistency.xyz, vec3(0.0));
    float vbbr = surfel.meanVbbr.w;
    float inconsistency = surfel.varianceInconsistency.w;

    vec3 deviation = sqrt(max(vec3(1e-5), variance));
    vec3 highThreshold = vec3(0.1) + shortMean + deviation * 8.0;
    sample -= max(vec3(0.0), sample - highThreshold); // firefly suppression

    vec3 delta = sample - shortMean;
    shortMean = mix(shortMean, sample, shortWindowBlend);
    vec3 delta2 = sample - shortMean;
    variance = mix(variance, delta * delta2, shortWindowBlend * 0.5);
    deviation = sqrt(max(vec3(1e-5), variance));

    float relativeDifference = dot(vec3(0.299, 0.587, 0.114), abs(mean - shortMean) / max(vec3(1e-5), deviation));
    inconsistency = mix(inconsistency, relativeDifference, 0.08);
    float reduction = clamp(dot(vec3(0.299, 0.587, 0.114), 0.5 * shortMean / max(vec3(1e-5), deviation)), 1.0 / 32.0, 1.0);
    float catchUp = clamp(smoothstep(0.0, 1.0, relativeDifference * max(0.02, inconsistency - 0.2)), 1.0 / 256.0, 1.0) * vbbr;

    surfel.meanVbbr.w = mix(vbbr, reduction, 0.1);
    surfel.meanVbbr.xyz = mix(mean, sample, clamp(catchUp, 0.0, 1.0));
    surfel.shortMean.xyz = shortMean;
    surfel.varianceInconsistency.xyz = variance;
    surfel.varianceInconsistency.w = inconsistency;
    return surfel.meanVbbr.xyz;
}

#endif // SLATE_EXPERIMENTAL_SURFEL_GI_TYPES
