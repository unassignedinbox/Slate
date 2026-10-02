struct DenoiseUniforms {
    // x: history enabled, y: GDF voxel size, z: current-frame response,
    // w: spatial radius in pixels.
    settings : vec4f,
};

@group(0) @binding(0) var<uniform> parameters : DenoiseUniforms;
@group(0) @binding(1) var currentIndirect : texture_2d<f32>;
@group(0) @binding(2) var currentPosition : texture_2d<f32>;
@group(0) @binding(3) var currentNormal : texture_2d<f32>;
@group(0) @binding(4) var currentMotionIdentity : texture_2d<f32>;
@group(0) @binding(5) var previousLighting : texture_2d<f32>;
@group(0) @binding(6) var previousPosition : texture_2d<f32>;
@group(0) @binding(7) var previousNormal : texture_2d<f32>;
@group(0) @binding(8) var previousIdentity : texture_2d<f32>;
@group(0) @binding(9) var outputLighting : texture_storage_2d<rgba16float, write>;
@group(0) @binding(10) var outputPosition : texture_storage_2d<rgba16float, write>;
@group(0) @binding(11) var outputNormal : texture_storage_2d<rgba16float, write>;
@group(0) @binding(12) var outputIdentity : texture_storage_2d<rgba16float, write>;

fn luminance(colour : vec3f) -> f32 {
    return dot(colour, vec3f(0.2126, 0.7152, 0.0722));
}

fn sameIdentity(a : vec2f, b : vec2f) -> bool {
    return all(abs(a - b) < vec2f(0.25));
}

@compute @workgroup_size(8, 8)
fn ComputeMain(@builtin(global_invocation_id) id : vec3u) {
    let dimensions = textureDimensions(outputLighting);
    if (any(id.xy >= dimensions)) {
        return;
    }

    let coordinate = vec2i(id.xy);
    let positionSample = textureLoad(currentPosition, coordinate, 0);
    let normalSample = textureLoad(currentNormal, coordinate, 0);
    let motionIdentity = textureLoad(currentMotionIdentity, coordinate, 0);
    if (positionSample.w < 0.5 || normalSample.w < 0.5) {
        textureStore(outputLighting, coordinate, vec4f(0.0));
        textureStore(outputPosition, coordinate, vec4f(0.0));
        textureStore(outputNormal, coordinate, vec4f(0.0));
        textureStore(outputIdentity, coordinate, vec4f(0.0));
        return;
    }

    let centerPosition = positionSample.xyz;
    let centerNormal = normalize(normalSample.xyz);
    let centerIdentity = motionIdentity.zw;
    let voxelSize = parameters.settings.y;
    let filterRadius = i32(clamp(parameters.settings.w, 0.0, 2.0) + 0.5);
    let spatialRadius = voxelSize * (3.0 + f32(filterRadius));
    var radianceSum = vec3f(0.0);
    var traceCostSum = 0.0;
    var weightSum = 0.0;
    var neighbourhoodMinimum = vec3f(1e20);
    var neighbourhoodMaximum = vec3f(-1e20);

    // This is reconstruction only. Every radiance sample was produced by a
    // world-space global-SDF trace; the G-buffer is never searched for hits.
    for (var oy = -2; oy <= 2; oy += 1) {
        for (var ox = -2; ox <= 2; ox += 1) {
            if (abs(ox) > filterRadius || abs(oy) > filterRadius) {
                continue;
            }
            let sampleCoordinate = clamp(
                coordinate + vec2i(ox, oy),
                vec2i(0),
                vec2i(dimensions) - vec2i(1)
            );
            let samplePosition = textureLoad(currentPosition, sampleCoordinate, 0);
            let sampleNormalRaw = textureLoad(currentNormal, sampleCoordinate, 0);
            let sampleIdentity = textureLoad(currentMotionIdentity, sampleCoordinate, 0).zw;
            if (samplePosition.w < 0.5 || sampleNormalRaw.w < 0.5
                || !sameIdentity(sampleIdentity, centerIdentity)) {
                continue;
            }
            let sampleNormal = normalize(sampleNormalRaw.xyz);
            let delta = samplePosition.xyz - centerPosition;
            let distanceSquared = dot(delta, delta);
            let normalAgreement = max(dot(sampleNormal, centerNormal), 0.0);
            let kernel = exp(-f32(ox * ox + oy * oy) * 0.22);
            let geometryWeight = exp(-distanceSquared / max(spatialRadius * spatialRadius, 1e-5))
                * pow(normalAgreement, 24.0);
            let weight = kernel * geometryWeight;
            let sampleLighting = textureLoad(currentIndirect, sampleCoordinate, 0);
            radianceSum += sampleLighting.rgb * weight;
            traceCostSum += sampleLighting.a * weight;
            weightSum += weight;
            if (weight > 0.08) {
                neighbourhoodMinimum = min(neighbourhoodMinimum, sampleLighting.rgb);
                neighbourhoodMaximum = max(neighbourhoodMaximum, sampleLighting.rgb);
            }
        }
    }

    let currentRadiance = radianceSum / max(weightSum, 1e-5);
    let currentTraceCost = traceCostSum / max(weightSum, 1e-5);
    let currentLuminance = luminance(currentRadiance);
    var resolvedRadiance = currentRadiance;
    var resolvedMoments = vec2f(currentLuminance, currentLuminance * currentLuminance);
    var historyCount = 0.0;

    if (parameters.settings.x > 0.5) {
        let currentUv = (vec2f(coordinate) + vec2f(0.5)) / vec2f(dimensions);
        let previousUv = currentUv + motionIdentity.xy;
        if (all(previousUv >= vec2f(0.0)) && all(previousUv < vec2f(1.0))) {
            let previousCoordinate = min(
                vec2i(previousUv * vec2f(dimensions)),
                vec2i(dimensions) - vec2i(1)
            );
            let oldPosition = textureLoad(previousPosition, previousCoordinate, 0);
            let oldNormal = textureLoad(previousNormal, previousCoordinate, 0);
            let oldIdentity = textureLoad(previousIdentity, previousCoordinate, 0);
            let positionError = length(oldPosition.xyz - centerPosition);
            let normalAgreement = dot(normalize(oldNormal.xyz), centerNormal);
            let validHistory = oldPosition.w > 0.5
                && oldNormal.w > 0.0
                && sameIdentity(oldIdentity.xy, centerIdentity)
                && positionError < voxelSize * 1.5
                && normalAgreement > 0.92;
            if (validHistory) {
                let oldLighting = textureLoad(previousLighting, previousCoordinate, 0).rgb;
                let oldVariance = max(oldIdentity.w - oldIdentity.z * oldIdentity.z, 0.0);
                let sigma = sqrt(oldVariance);
                let range = max(
                    neighbourhoodMaximum - neighbourhoodMinimum,
                    vec3f(max(0.015, sigma * 1.5))
                );
                let clampedHistory = clamp(
                    oldLighting,
                    neighbourhoodMinimum - range * 0.25,
                    neighbourhoodMaximum + range * 0.25
                );
                historyCount = min(oldNormal.w, 31.0);
                let accumulationAlpha = max(
                    1.0 / (historyCount + 1.0),
                    parameters.settings.z
                );
                resolvedRadiance = mix(clampedHistory, currentRadiance, accumulationAlpha);
                resolvedMoments = mix(oldIdentity.zw, resolvedMoments, accumulationAlpha);
            }
        }
    }

    textureStore(outputLighting, coordinate, vec4f(resolvedRadiance, currentTraceCost));
    textureStore(outputPosition, coordinate, vec4f(centerPosition, 1.0));
    textureStore(outputNormal, coordinate, vec4f(centerNormal, min(historyCount + 1.0, 32.0)));
    textureStore(outputIdentity, coordinate, vec4f(centerIdentity, resolvedMoments));
}
