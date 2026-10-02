struct GiUniforms {
    boundsMinimum : vec4f,
    boundsMaximum : vec4f,
    settings : vec4f,
    environment : vec4f,
};

@group(0) @binding(0) var<uniform> parameters : GiUniforms;
@group(0) @binding(1) var worldPositionTexture : texture_2d<f32>;
@group(0) @binding(2) var worldNormalTexture : texture_2d<f32>;
@group(0) @binding(3) var globalDistanceField : texture_3d<f32>;
@group(0) @binding(4) var linearSampler : sampler;
@group(0) @binding(5) var surfaceRadiance : texture_3d<f32>;
@group(0) @binding(6) var indirectOutput : texture_storage_2d<rgba16float, write>;

struct TraceResult {
    radiance : vec3f,
    steps : f32,
};

fn fieldUv(worldPosition : vec3f) -> vec3f {
    return (worldPosition - parameters.boundsMinimum.xyz)
        / (parameters.boundsMaximum.xyz - parameters.boundsMinimum.xyz);
}

fn insideField(uv : vec3f) -> bool {
    return all(uv >= vec3f(0.0)) && all(uv <= vec3f(1.0));
}

fn sampleDistance(worldPosition : vec3f, level : f32) -> f32 {
    return textureSampleLevel(globalDistanceField, linearSampler, fieldUv(worldPosition), level).r;
}

fn hash12(value : vec2u) -> f32 {
    var state = value.x * 1664525u + value.y * 1013904223u + 0x9e3779b9u;
    state ^= state >> 16u;
    state *= 2246822519u;
    state ^= state >> 13u;
    return f32(state & 0x00ffffffu) / 16777216.0;
}

fn cosineDirection(index : u32, count : u32, noise : vec2f) -> vec3f {
    let u = (f32(index) + noise.x) / max(1.0, f32(count));
    let v = fract((f32(index) + 0.5) * 0.61803398875 + noise.y);
    let radius = sqrt(clamp(u, 0.0, 1.0));
    let angle = v * 6.28318530718;
    return vec3f(cos(angle) * radius, sin(angle) * radius, sqrt(max(0.0, 1.0 - u)));
}

fn tangentBasis(normal : vec3f) -> mat3x3f {
    let helper = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(normal.y) > 0.92);
    let tangent = normalize(cross(helper, normal));
    let bitangent = cross(normal, tangent);
    return mat3x3f(tangent, bitangent, normal);
}

fn environmentRadiance(direction : vec3f) -> vec3f {
    let horizon = vec3f(0.055, 0.070, 0.085);
    let zenith = vec3f(0.18, 0.26, 0.38);
    return mix(horizon, zenith, clamp(direction.y * 0.5 + 0.5, 0.0, 1.0))
        * parameters.environment.x;
}

fn traceGlobalDistanceField(origin : vec3f, direction : vec3f) -> TraceResult {
    let voxelSize = parameters.settings.y;
    let maximumDistance = parameters.settings.x;
    let maximumMip = parameters.environment.y;
    var distanceAlongRay = voxelSize * 1.8;
    var steps = 0u;

    for (var iteration = 0u; iteration < 72u; iteration += 1u) {
        steps = iteration + 1u;
        if (distanceAlongRay >= maximumDistance) {
            break;
        }
        let position = origin + direction * distanceAlongRay;
        let uv = fieldUv(position);
        if (!insideField(uv)) {
            return TraceResult(environmentRadiance(direction), f32(steps));
        }

        let coneWidth = max(voxelSize, distanceAlongRay * 0.025);
        let level = clamp(floor(log2(coneWidth / voxelSize)), 0.0, maximumMip);
        var distance = sampleDistance(position, level);
        if (abs(distance) < coneWidth * 2.5) {
            distance = sampleDistance(position, 0.0);
        }

        if (abs(distance) < voxelSize * 0.72) {
            let cacheRadiance = textureSampleLevel(surfaceRadiance, linearSampler, uv, 0.0);
            return TraceResult(cacheRadiance.rgb, f32(steps));
        }
        distanceAlongRay += max(abs(distance) * 0.72, voxelSize * 0.32);
    }
    return TraceResult(environmentRadiance(direction), f32(steps));
}

@compute @workgroup_size(8, 8)
fn ComputeMain(@builtin(global_invocation_id) id : vec3u) {
    let outputDimensions = textureDimensions(indirectOutput);
    if (any(id.xy >= outputDimensions)) {
        return;
    }

    let sourceDimensions = textureDimensions(worldPositionTexture);
    let sourceCoordinate = min(id.xy * 2u + vec2u(1u), sourceDimensions - vec2u(1u));
    let positionSample = textureLoad(worldPositionTexture, sourceCoordinate, 0);
    let normalSample = textureLoad(worldNormalTexture, sourceCoordinate, 0);
    if (positionSample.w < 0.5 || normalSample.w < 0.5) {
        textureStore(indirectOutput, id.xy, vec4f(0.0));
        return;
    }

    let normal = normalize(normalSample.xyz);
    let basis = tangentBasis(normal);
    let rayCount = clamp(u32(parameters.settings.z + 0.5), 1u, 4u);
    let frame = u32(parameters.settings.w + 0.5);
    let noise = vec2f(
        hash12(id.xy + vec2u(frame * 17u, frame * 29u)),
        hash12(id.yx + vec2u(frame * 43u + 11u, frame * 7u + 3u))
    );
    var sum = vec3f(0.0);
    var stepSum = 0.0;
    let origin = positionSample.xyz + normal * parameters.settings.y * 1.9;
    for (var ray = 0u; ray < 4u; ray += 1u) {
        if (ray >= rayCount) {
            break;
        }
        let direction = normalize(basis * cosineDirection(ray, rayCount, noise));
        let result = traceGlobalDistanceField(origin, direction);
        sum += result.radiance;
        stepSum += result.steps;
    }

    let inverseCount = 1.0 / f32(rayCount);
    textureStore(
        indirectOutput,
        id.xy,
        vec4f(sum * inverseCount, stepSum * inverseCount / 72.0)
    );
}
