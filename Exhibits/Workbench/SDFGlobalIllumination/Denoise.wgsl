struct DenoiseUniforms {
    previousViewProjection : mat4x4f,
    settings : vec4f,
};

@group(0) @binding(0) var<uniform> parameters : DenoiseUniforms;
@group(0) @binding(1) var currentIndirect : texture_2d<f32>;
@group(0) @binding(2) var currentPosition : texture_2d<f32>;
@group(0) @binding(3) var currentNormal : texture_2d<f32>;
@group(0) @binding(4) var previousLighting : texture_2d<f32>;
@group(0) @binding(5) var previousPosition : texture_2d<f32>;
@group(0) @binding(6) var previousNormal : texture_2d<f32>;
@group(0) @binding(7) var outputLighting : texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var outputPosition : texture_storage_2d<rgba16float, write>;
@group(0) @binding(9) var outputNormal : texture_storage_2d<rgba16float, write>;

fn sourceCoordinate(coordinate : vec2i, sourceDimensions : vec2u) -> vec2i {
    return min(coordinate * 2 + vec2i(1), vec2i(sourceDimensions) - vec2i(1));
}

@compute @workgroup_size(8, 8)
fn ComputeMain(@builtin(global_invocation_id) id : vec3u) {
    let dimensions = textureDimensions(outputLighting);
    if (any(id.xy >= dimensions)) {
        return;
    }

    let coordinate = vec2i(id.xy);
    let sourceDimensions = textureDimensions(currentPosition);
    let source = sourceCoordinate(coordinate, sourceDimensions);
    let positionSample = textureLoad(currentPosition, source, 0);
    let normalSample = textureLoad(currentNormal, source, 0);
    if (positionSample.w < 0.5 || normalSample.w < 0.5) {
        textureStore(outputLighting, coordinate, vec4f(0.0));
        textureStore(outputPosition, coordinate, vec4f(0.0));
        textureStore(outputNormal, coordinate, vec4f(0.0));
        return;
    }

    let centerPosition = positionSample.xyz;
    let centerNormal = normalize(normalSample.xyz);
    let voxelSize = parameters.settings.y;
    let spatialRadius = voxelSize * 5.0;
    var radianceSum = vec3f(0.0);
    var traceCostSum = 0.0;
    var weightSum = 0.0;
    var neighbourhoodMinimum = vec3f(1e20);
    var neighbourhoodMaximum = vec3f(-1e20);

    // Edge-aware reconstruction only: all radiance was already produced by
    // global-SDF hits. Screen depth is never searched for secondary geometry.
    for (var oy = -2; oy <= 2; oy += 1) {
        for (var ox = -2; ox <= 2; ox += 1) {
            let sampleCoordinate = clamp(
                coordinate + vec2i(ox, oy),
                vec2i(0),
                vec2i(dimensions) - vec2i(1)
            );
            let sampleSource = sourceCoordinate(sampleCoordinate, sourceDimensions);
            let samplePosition = textureLoad(currentPosition, sampleSource, 0);
            let sampleNormalRaw = textureLoad(currentNormal, sampleSource, 0);
            if (samplePosition.w < 0.5 || sampleNormalRaw.w < 0.5) {
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
    var resolvedRadiance = currentRadiance;
    var historyCount = 0.0;
    let historyEnabled = parameters.settings.x > 0.5;

    if (historyEnabled) {
        let previousClip = parameters.previousViewProjection * vec4f(centerPosition, 1.0);
        if (previousClip.w > 1e-5) {
            let previousNdc = previousClip.xy / previousClip.w;
            let previousUv = vec2f(previousNdc.x * 0.5 + 0.5, 0.5 - previousNdc.y * 0.5);
            if (all(previousUv >= vec2f(0.0)) && all(previousUv < vec2f(1.0))) {
                let previousCoordinate = min(
                    vec2i(previousUv * vec2f(dimensions)),
                    vec2i(dimensions) - vec2i(1)
                );
                let oldPosition = textureLoad(previousPosition, previousCoordinate, 0);
                let oldNormal = textureLoad(previousNormal, previousCoordinate, 0);
                let positionError = length(oldPosition.xyz - centerPosition);
                let normalAgreement = dot(normalize(oldNormal.xyz), centerNormal);
                if (oldPosition.w > 0.5 && oldNormal.w > 0.0
                    && positionError < voxelSize * 2.5 && normalAgreement > 0.88) {
                    let oldLighting = textureLoad(previousLighting, previousCoordinate, 0).rgb;
                    let range = max(neighbourhoodMaximum - neighbourhoodMinimum, vec3f(0.02));
                    let clampedHistory = clamp(
                        oldLighting,
                        neighbourhoodMinimum - range * 0.35,
                        neighbourhoodMaximum + range * 0.35
                    );
                    historyCount = min(oldNormal.w, 31.0);
                    let accumulationAlpha = max(
                        1.0 / (historyCount + 1.0),
                        parameters.settings.z
                    );
                    resolvedRadiance = mix(clampedHistory, currentRadiance, accumulationAlpha);
                }
            }
        }
    }

    textureStore(outputLighting, coordinate, vec4f(resolvedRadiance, currentTraceCost));
    textureStore(outputPosition, coordinate, vec4f(centerPosition, 1.0));
    textureStore(outputNormal, coordinate, vec4f(centerNormal, min(historyCount + 1.0, 32.0)));
}
