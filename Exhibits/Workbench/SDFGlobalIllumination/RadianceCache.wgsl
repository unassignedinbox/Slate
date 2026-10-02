struct CacheUniforms {
    boundsMinimum : vec4f,
    boundsMaximum : vec4f,
    lightDirection : vec4f,
    lightColour : vec4f,
    settings : vec4f,
};

@group(0) @binding(0) var<uniform> parameters : CacheUniforms;
@group(0) @binding(1) var globalDistanceField : texture_3d<f32>;
@group(0) @binding(2) var linearSampler : sampler;
@group(0) @binding(3) var materialField : texture_3d<f32>;
@group(0) @binding(4) var nearestSampler : sampler;
@group(0) @binding(5) var surfaceRadiance : texture_storage_3d<rgba16float, write>;

fn fieldUv(worldPosition : vec3f) -> vec3f {
    return (worldPosition - parameters.boundsMinimum.xyz)
        / (parameters.boundsMaximum.xyz - parameters.boundsMinimum.xyz);
}

fn sampleDistance(worldPosition : vec3f) -> f32 {
    return textureSampleLevel(globalDistanceField, linearSampler, fieldUv(worldPosition), 0.0).r;
}

fn distanceNormal(worldPosition : vec3f, epsilon : f32) -> vec3f {
    let x = vec3f(epsilon, 0.0, 0.0);
    let y = vec3f(0.0, epsilon, 0.0);
    let z = vec3f(0.0, 0.0, epsilon);
    return normalize(vec3f(
        sampleDistance(worldPosition + x) - sampleDistance(worldPosition - x),
        sampleDistance(worldPosition + y) - sampleDistance(worldPosition - y),
        sampleDistance(worldPosition + z) - sampleDistance(worldPosition - z)
    ));
}

@compute @workgroup_size(4, 4, 4)
fn ComputeMain(@builtin(global_invocation_id) id : vec3u) {
    let dimensions = textureDimensions(surfaceRadiance);
    if (any(id >= dimensions)) {
        return;
    }

    let uv = (vec3f(id) + vec3f(0.5)) / vec3f(dimensions);
    let worldPosition = mix(parameters.boundsMinimum.xyz, parameters.boundsMaximum.xyz, uv);
    let distance = textureSampleLevel(globalDistanceField, linearSampler, uv, 0.0).r;
    let voxelSize = parameters.settings.z;
    if (abs(distance) > voxelSize * 1.8) {
        textureStore(surfaceRadiance, id, vec4f(0.0));
        return;
    }

    let normal = distanceNormal(worldPosition, voxelSize * 0.8);
    let material = textureSampleLevel(materialField, nearestSampler, uv, 0.0);
    let nDotL = max(dot(normal, parameters.lightDirection.xyz), 0.0);

    // Phase 1 deliberately injects unshadowed source radiance. The global SDF
    // is used for diffuse GI visibility; source-to-surface SDF shadows are the
    // separate next phase requested for this exhibit.
    let ambient = material.rgb * parameters.settings.w;
    let reflectedSun = material.rgb * parameters.lightColour.rgb
        * nDotL * parameters.settings.x * 0.318309886;
    let emitted = material.rgb * material.a * parameters.settings.y;
    textureStore(surfaceRadiance, id, vec4f(ambient + reflectedSun + emitted, 1.0));
}
