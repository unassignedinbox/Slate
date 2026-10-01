// Stabilized cascaded sun-shadow rasterization, deliberately separate from the GI RSM.

struct ShadowUniforms
{
    LightProjection: mat4x4f,
};

struct RasterInput
{
    @location(0) Position: vec3f,
    @location(1) Normal: vec3f,
    @location(2) TranslationFlags: vec4f,
    @location(3) AlbedoMetalness: vec4f,
    @location(4) ScaleRoughness: vec4f,
};

@group(0) @binding(0) var<uniform> Shadow: ShadowUniforms;

@vertex
fn ShadowVertex(Input: RasterInput) -> @builtin(position) vec4f
{
    let WorldPosition = Input.Position * Input.ScaleRoughness.xyz + Input.TranslationFlags.xyz;
    return Shadow.LightProjection * vec4f(WorldPosition, 1.0);
}
