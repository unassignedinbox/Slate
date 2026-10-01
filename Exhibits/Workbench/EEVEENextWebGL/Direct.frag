#version 300 es
precision highp float;
precision highp sampler2D;
precision highp samplerCube;

in vec2 vUv;
layout(location=0) out vec4 oDirect;

uniform sampler2D uPosition;
uniform sampler2D uNormalRoughness;
uniform sampler2D uAlbedoMetalness;
uniform sampler2D uShadowAtlas;
uniform samplerCube uPointShadow;
uniform mat4 uShadowMatrix[3];
uniform vec3 uShadowSplits;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uSunDirection;
uniform vec3 uSunColour;
uniform float uSunIntensity;
uniform vec3 uPointPosition;
uniform vec3 uPointColour;
uniform float uPointIntensity;
uniform float uPointRange;
uniform float uSunAngle;
uniform float uPointRadius;
uniform int uShadowRayCount;
uniform int uShadowStepCount;
uniform bool uShadowTrace;
uniform bool uShadowsEnabled;

const float PI = 3.141592653589793;
const int MAX_SHADOW_RAYS = 4;
const int MAX_SHADOW_STEPS = 16;

float D_GGX(float NoH, float a) {
    float a2 = a * a;
    float d = NoH * NoH * (a2 - 1.0) + 1.0;
    return a2 / max(PI * d * d, 1e-5);
}

float V_Smith(float NoV, float NoL, float a) {
    float a2 = a * a;
    float gv = NoL * sqrt(max(NoV * NoV * (1.0 - a2) + a2, 1e-5));
    float gl = NoV * sqrt(max(NoL * NoL * (1.0 - a2) + a2, 1e-5));
    return 0.5 / max(gv + gl, 1e-5);
}

vec3 Fresnel(vec3 f0, float VoH) {
    float f = pow(clamp(1.0 - VoH, 0.0, 1.0), 5.0);
    return f0 + (1.0 - f0) * f;
}

vec3 EvaluateLight(vec3 N, vec3 V, vec3 L, vec3 radiance, vec3 albedo, float metal, float rough) {
    float NoL = max(dot(N, L), 0.0);
    float NoV = max(dot(N, V), 1e-4);
    if (NoL <= 0.0) return vec3(0.0);
    vec3 H = normalize(V + L);
    float NoH = max(dot(N, H), 0.0);
    float VoH = max(dot(V, H), 0.0);
    float a = max(rough * rough, 0.035);
    vec3 F = Fresnel(mix(vec3(0.04), albedo, metal), VoH);
    vec3 specular = F * (D_GGX(NoH, a) * V_Smith(NoV, NoL, a));
    vec3 diffuse = albedo * (1.0 - metal) * (vec3(1.0) - F) * (1.0 / PI);
    return (diffuse + specular) * radiance * NoL;
}

// Integer-free hash and a concentric-enough square-to-disk mapping. The seed is
// world-locked, so low shadow-ray counts do not shimmer when the camera moves.
vec2 Random2(vec3 P, float sequence) {
    vec3 p = fract(P * vec3(0.1031, 0.1030, 0.0973) + sequence * vec3(0.1379, 0.1733, 0.1971));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xx + p.yz) * p.zy);
}

vec2 SampleDisk(vec3 P, float sequence) {
    vec2 xi = Random2(P, sequence);
    float radius = sqrt(xi.x);
    float angle = 2.0 * PI * xi.y;
    return vec2(cos(angle), sin(angle)) * radius;
}

int ShadowCascade(float viewDepth) {
    if (viewDepth < uShadowSplits.x) return 0;
    if (viewDepth < uShadowSplits.y) return 1;
    return 2;
}

vec2 AtlasOffset(int cascade) {
    if (cascade == 0) return vec2(0.0, 0.0);
    if (cascade == 1) return vec2(0.5, 0.0);
    return vec2(0.0, 0.5);
}

float DirectionalDepth(int cascade, vec2 localUv) {
    vec2 safeUv = clamp(localUv, vec2(0.0005), vec2(0.9995));
    return texture(uShadowAtlas, AtlasOffset(cascade) + safeUv * 0.5).r;
}

float DirectionalPCF(int cascade, vec2 localUv, float reference, float bias) {
    // Explicit depth comparison keeps this path usable as the hard/PCF control.
    vec2 localTexel = vec2(1.0 / 2048.0);
    float visibility = 0.0;
    for (int y = -1; y <= 1; ++y) {
        for (int x = -1; x <= 1; ++x) {
            float depth = DirectionalDepth(cascade, localUv + vec2(x, y) * localTexel);
            visibility += step(reference - bias, depth);
        }
    }
    return visibility / 9.0;
}

float TraceDirectionalRay(int cascade, vec2 receiverUv, float receiverDepth,
                          float bias, vec2 diskPoint, vec2 receiverJitter) {
    // Recover the UV/depth scale ratio from the orthographic shadow matrix.
    // This turns the sun's angular radius into the slope of a light-to-receiver
    // ray in shadow-map space instead of merely widening a PCF kernel.
    mat4 m = uShadowMatrix[cascade];
    float uvPerWorld = 0.5 * length(vec3(m[0][0], m[1][0], m[2][0]));
    float depthPerWorld = 0.5 * length(vec3(m[0][2], m[1][2], m[2][2]));
    float uvPerDepth = uvPerWorld / max(depthPerWorld, 1e-5);
    vec2 raySlope = diskPoint * tan(uSunAngle) * uvPerDepth;
    float endDepth = receiverDepth - bias;

    // Traverse from the sampled point on the light toward the receiver. The
    // single-layer depth map is treated as a conservative height field, as in
    // EEVEE's last-occluder shadow-map tracing approximation.
    for (int stepIndex = 0; stepIndex < MAX_SHADOW_STEPS; ++stepIndex) {
        if (stepIndex >= uShadowStepCount) break;
        float t = (float(stepIndex) + 0.5) / float(uShadowStepCount);
        float rayDepth = endDepth * t;
        vec2 rayUv = receiverUv + raySlope * (endDepth - rayDepth) + receiverJitter * t;
        if (any(lessThanEqual(rayUv, vec2(0.0005))) || any(greaterThanEqual(rayUv, vec2(0.9995)))) continue;
        float mapDepth = DirectionalDepth(cascade, rayUv);
        float traversalBias = bias + 0.00018;
        if (mapDepth < rayDepth - traversalBias) return 0.0;
    }
    return 1.0;
}

float DirectionalShadow(vec3 P, vec3 N) {
    if (!uShadowsEnabled) return 1.0;
    float viewDepth = max(dot(P - uCameraPosition, uCameraForward), 0.0);
    int cascade = ShadowCascade(viewDepth);
    // The depth pass stores light-facing surfaces, so only a small normal lift is
    // needed. A light-direction position offset would visibly detach the shadow.
    vec4 clip = uShadowMatrix[cascade] * vec4(P + N * 0.004, 1.0);
    vec3 ndc = clip.xyz / max(clip.w, 1e-5);
    vec2 localUv = ndc.xy * 0.5 + 0.5;
    float reference = ndc.z * 0.5 + 0.5;
    if (any(lessThanEqual(localUv, vec2(0.002))) || any(greaterThanEqual(localUv, vec2(0.998))) ||
        reference <= 0.0 || reference >= 1.0) return 1.0;
    float slope = 1.0 - max(dot(N, uSunDirection), 0.0);
    float bias = 0.00012 + 0.00042 * slope;
    if (!uShadowTrace) return DirectionalPCF(cascade, localUv, reference, bias);

    float visibility = 0.0;
    vec2 localTexel = vec2(1.0 / 2048.0);
    for (int rayIndex = 0; rayIndex < MAX_SHADOW_RAYS; ++rayIndex) {
        if (rayIndex >= uShadowRayCount) break;
        float sequence = float(rayIndex) + float(cascade) * 7.0;
        vec2 lightSample = SampleDisk(P * 19.0, sequence);
        vec2 jitter = (Random2(P * 43.0, sequence + 11.0) - 0.5) * localTexel * 1.5;
        visibility += TraceDirectionalRay(cascade, localUv, reference, bias, lightSample, jitter);
    }
    return visibility / float(max(uShadowRayCount, 1));
}

float PointPCF(vec3 P, vec3 N) {
    vec3 delta = P - uPointPosition;
    float distanceToLight = length(delta);
    vec3 direction = delta / max(distanceToLight, 1e-4);
    float reference = distanceToLight / uPointRange;
    float bias = (0.012 + 0.024 * (1.0 - max(dot(N, -direction), 0.0))) / uPointRange;
    vec3 axis = abs(direction.z) < 0.8 ? vec3(0, 0, 1) : vec3(0, 1, 0);
    vec3 tangent = normalize(cross(axis, direction));
    vec3 bitangent = cross(direction, tangent);
    float visibility = 0.0;
    float radius = 0.0045 * (1.0 + reference * 3.0);
    for (int i = 0; i < 8; ++i) {
        float angle = 2.0 * PI * (float(i) + 0.5) / 8.0;
        vec3 tap = normalize(direction + (tangent * cos(angle) + bitangent * sin(angle)) * radius);
        visibility += step(reference - bias, texture(uPointShadow, tap).r);
    }
    return visibility / 8.0;
}

float TracePointRay(vec3 P, vec3 N, vec3 lightToReceiver, vec2 diskPoint) {
    vec3 axis = abs(lightToReceiver.z) < 0.8 ? vec3(0, 0, 1) : vec3(0, 1, 0);
    vec3 tangent = normalize(cross(axis, lightToReceiver));
    vec3 bitangent = cross(lightToReceiver, tangent);
    float hemisphere = sqrt(max(1.0 - dot(diskPoint, diskPoint), 0.0));
    vec3 lightSample = uPointPosition + uPointRadius *
        (tangent * diskPoint.x + bitangent * diskPoint.y + lightToReceiver * hemisphere);
    vec3 receiver = P + N * 0.006;
    float depthBias = (0.012 + 0.024 * (1.0 - max(dot(N, -lightToReceiver), 0.0))) / uPointRange;

    for (int stepIndex = 0; stepIndex < MAX_SHADOW_STEPS; ++stepIndex) {
        if (stepIndex >= uShadowStepCount) break;
        float t = (float(stepIndex) + 0.5) / float(uShadowStepCount);
        vec3 rayPosition = mix(lightSample, receiver, t);
        vec3 fromCentre = rayPosition - uPointPosition;
        float radialDepth = length(fromCentre) / uPointRange;
        float mapDepth = texture(uPointShadow, fromCentre).r;
        if (mapDepth < radialDepth - depthBias) return 0.0;
    }
    return 1.0;
}

float PointShadow(vec3 P, vec3 N) {
    if (!uShadowsEnabled) return 1.0;
    vec3 delta = P - uPointPosition;
    float distanceToLight = length(delta);
    if (distanceToLight >= uPointRange) return 1.0;
    if (!uShadowTrace) return PointPCF(P, N);

    vec3 direction = delta / max(distanceToLight, 1e-4);
    float visibility = 0.0;
    for (int rayIndex = 0; rayIndex < MAX_SHADOW_RAYS; ++rayIndex) {
        if (rayIndex >= uShadowRayCount) break;
        vec2 lightSample = SampleDisk(P * 23.0, float(rayIndex) + 29.0);
        visibility += TracePointRay(P, N, direction, lightSample);
    }
    return visibility / float(max(uShadowRayCount, 1));
}

void main() {
    vec4 positionHit = texture(uPosition, vUv);
    if (positionHit.w < 0.5) {
        oDirect = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }
    vec4 nr = texture(uNormalRoughness, vUv);
    vec4 am = texture(uAlbedoMetalness, vUv);
    vec3 P = positionHit.xyz;
    vec3 N = normalize(nr.xyz);
    vec3 V = normalize(uCameraPosition - P);
    float rough = nr.w;
    float metal = am.a;

    float sunVisibility = DirectionalShadow(P, N);
    vec3 colour = EvaluateLight(N, V, uSunDirection, uSunColour * uSunIntensity * sunVisibility,
                                am.rgb, metal, rough);
    vec3 toPoint = uPointPosition - P;
    float pointDistance = length(toPoint);
    if (pointDistance < uPointRange) {
        float attenuation = pow(clamp(1.0 - pointDistance / uPointRange, 0.0, 1.0), 2.0) /
                            max(pointDistance * pointDistance, 0.25);
        colour += EvaluateLight(N, V, toPoint / max(pointDistance, 1e-4),
                                uPointColour * (uPointIntensity * attenuation * PointShadow(P, N)),
                                am.rgb, metal, rough);
    }
    float emissive = max(positionHit.w - 1.0, 0.0);
    colour += am.rgb * emissive;
    oDirect = vec4(max(colour, vec3(0.0)), sunVisibility);
}
