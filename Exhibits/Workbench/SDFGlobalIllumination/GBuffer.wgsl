struct CameraUniforms {
    currentViewProjection : mat4x4f,
    previousViewProjection : mat4x4f,
};

@group(0) @binding(0) var<uniform> camera : CameraUniforms;

struct VertexInput {
    @location(0) position : vec3f,
    @location(1) normal : vec3f,
    @location(2) albedo : vec3f,
    @location(3) emissive : f32,
    @location(4) objectMaterial : vec2f,
};

struct VertexOutput {
    @builtin(position) clipPosition : vec4f,
    @location(0) worldPosition : vec3f,
    @location(1) worldNormal : vec3f,
    @location(2) albedo : vec3f,
    @location(3) emissive : f32,
    @location(4) @interpolate(flat) objectMaterial : vec2f,
};

@vertex
fn VertexMain(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.clipPosition = camera.currentViewProjection * vec4f(input.position, 1.0);
    output.worldPosition = input.position;
    output.worldNormal = input.normal;
    output.albedo = input.albedo;
    output.emissive = input.emissive;
    output.objectMaterial = input.objectMaterial;
    return output;
}

struct FragmentOutput {
    @location(0) worldPosition : vec4f,
    @location(1) worldNormal : vec4f,
    @location(2) albedo : vec4f,
    @location(3) motionIdentity : vec4f,
};

fn clipToUv(clip : vec4f) -> vec2f {
    let ndc = clip.xy / max(abs(clip.w), 1e-6);
    return vec2f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5);
}

@fragment
fn FragmentMain(input : VertexOutput) -> FragmentOutput {
    let world = vec4f(input.worldPosition, 1.0);
    let currentUv = clipToUv(camera.currentViewProjection * world);
    let previousUv = clipToUv(camera.previousViewProjection * world);

    var output : FragmentOutput;
    output.worldPosition = world;
    output.worldNormal = vec4f(normalize(input.worldNormal), 1.0);
    output.albedo = vec4f(input.albedo, input.emissive);
    // Motion points from the current pixel to the previous-frame sample.
    output.motionIdentity = vec4f(previousUv - currentUv, input.objectMaterial);
    return output;
}
