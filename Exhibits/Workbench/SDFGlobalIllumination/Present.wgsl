struct PresentUniforms {
    lightDirection : vec4f,
    lightColour : vec4f,
    settings : vec4f,
    environment : vec4f,
};

@group(0) @binding(0) var<uniform> parameters : PresentUniforms;
@group(0) @binding(1) var worldPositionTexture : texture_2d<f32>;
@group(0) @binding(2) var worldNormalTexture : texture_2d<f32>;
@group(0) @binding(3) var albedoTexture : texture_2d<f32>;
@group(0) @binding(4) var indirectTexture : texture_2d<f32>;
@group(0) @binding(5) var linearSampler : sampler;
@group(0) @binding(6) var motionIdentityTexture : texture_2d<f32>;
@group(0) @binding(7) var historyIdentityTexture : texture_2d<f32>;
@group(0) @binding(8) var historyNormalTexture : texture_2d<f32>;

struct VertexOutput {
    @builtin(position) position : vec4f,
    @location(0) uv : vec2f,
};

@vertex
fn VertexMain(@builtin(vertex_index) vertexIndex : u32) -> VertexOutput {
    let positions = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );
    var output : VertexOutput;
    output.position = vec4f(positions[vertexIndex], 0.0, 1.0);
    output.uv = positions[vertexIndex] * vec2f(0.5, -0.5) + vec2f(0.5);
    return output;
}

fn environmentRadiance(directionY : f32) -> vec3f {
    return mix(
        vec3f(0.025, 0.035, 0.05),
        vec3f(0.18, 0.27, 0.42),
        clamp(directionY * 0.5 + 0.5, 0.0, 1.0)
    ) * parameters.environment.x;
}

fn toneMap(colour : vec3f) -> vec3f {
    let exposed = max(colour, vec3f(0.0)) * parameters.settings.w;
    let mapped = exposed / (vec3f(1.0) + exposed);
    return pow(mapped, vec3f(1.0 / 2.2));
}

fn heatMap(value : f32) -> vec3f {
    let cold = vec3f(0.015, 0.12, 0.42);
    let middle = vec3f(0.04, 0.85, 0.52);
    let hot = vec3f(1.0, 0.10, 0.015);
    return select(
        mix(cold, middle, value * 2.0),
        mix(middle, hot, value * 2.0 - 1.0),
        value > 0.5
    );
}

@fragment
fn FragmentMain(input : VertexOutput) -> @location(0) vec4f {
    let dimensions = textureDimensions(worldPositionTexture);
    let coordinate = min(vec2u(input.uv * vec2f(dimensions)), dimensions - vec2u(1u));
    let positionSample = textureLoad(worldPositionTexture, coordinate, 0);
    let mode = u32(parameters.settings.x + 0.5);
    if (positionSample.w < 0.5) {
        if (mode >= 4u) {
            return vec4f(0.0, 0.0, 0.0, 1.0);
        }
        let background = environmentRadiance(0.45 - input.uv.y * 0.7);
        return vec4f(toneMap(background), 1.0);
    }

    let normal = normalize(textureLoad(worldNormalTexture, coordinate, 0).xyz);
    let material = textureLoad(albedoTexture, coordinate, 0);
    let indirect = textureSampleLevel(indirectTexture, linearSampler, input.uv, 0.0);
    let nDotL = max(dot(normal, parameters.lightDirection.xyz), 0.0);

    // Direct light is intentionally unshadowed in this GI milestone.
    let direct = material.rgb * (
        parameters.environment.y
        + parameters.lightColour.rgb * nDotL * parameters.settings.z
    );
    let emission = material.rgb * material.a * parameters.environment.z;
    let sdfIndirect = indirect.rgb * material.rgb * parameters.settings.y;

    var colour = direct + emission + sdfIndirect;
    if (mode == 1u) {
        colour = sdfIndirect;
    } else if (mode == 2u) {
        colour = direct + emission;
    } else if (mode == 3u) {
        colour = heatMap(clamp(indirect.a, 0.0, 1.0));
        return vec4f(colour, 1.0);
    } else if (mode == 4u) {
        let motion = textureLoad(motionIdentityTexture, coordinate, 0).xy;
        let magnitude = clamp(length(motion) * 45.0, 0.0, 1.0);
        colour = vec3f(
            clamp(0.5 + motion.x * 35.0, 0.0, 1.0),
            clamp(0.5 + motion.y * 35.0, 0.0, 1.0),
            magnitude
        );
        return vec4f(colour, 1.0);
    } else if (mode == 5u) {
        let moments = textureLoad(historyIdentityTexture, coordinate, 0).zw;
        let variance = max(moments.y - moments.x * moments.x, 0.0);
        colour = heatMap(clamp(sqrt(variance) * 2.5, 0.0, 1.0));
        return vec4f(colour, 1.0);
    } else if (mode == 6u) {
        let historyLength = textureLoad(historyNormalTexture, coordinate, 0).w;
        colour = heatMap(clamp(historyLength / 32.0, 0.0, 1.0));
        return vec4f(colour, 1.0);
    }
    return vec4f(toneMap(colour), 1.0);
}
