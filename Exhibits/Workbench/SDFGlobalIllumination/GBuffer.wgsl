struct CameraUniforms {
    viewProjection : mat4x4f,
};

@group(0) @binding(0) var<uniform> camera : CameraUniforms;

struct VertexInput {
    @location(0) position : vec3f,
    @location(1) normal : vec3f,
    @location(2) albedo : vec3f,
    @location(3) emissive : f32,
};

struct VertexOutput {
    @builtin(position) clipPosition : vec4f,
    @location(0) worldPosition : vec3f,
    @location(1) worldNormal : vec3f,
    @location(2) albedo : vec3f,
    @location(3) emissive : f32,
};

@vertex
fn VertexMain(input : VertexInput) -> VertexOutput {
    var output : VertexOutput;
    output.clipPosition = camera.viewProjection * vec4f(input.position, 1.0);
    output.worldPosition = input.position;
    output.worldNormal = input.normal;
    output.albedo = input.albedo;
    output.emissive = input.emissive;
    return output;
}

struct FragmentOutput {
    @location(0) worldPosition : vec4f,
    @location(1) worldNormal : vec4f,
    @location(2) albedo : vec4f,
};

@fragment
fn FragmentMain(input : VertexOutput) -> FragmentOutput {
    var output : FragmentOutput;
    output.worldPosition = vec4f(input.worldPosition, 1.0);
    output.worldNormal = vec4f(normalize(input.worldNormal), 1.0);
    output.albedo = vec4f(input.albedo, input.emissive);
    return output;
}
