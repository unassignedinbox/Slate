// Dynamic scene rasterization for the primary G-buffer and reflective shadow map.

struct FrameUniforms
{
    CameraProjection: mat4x4f,
    PreviousCameraProjection: mat4x4f,
    LightProjection: mat4x4f,
    CameraPosition: vec4f,
    CameraForwardTan: vec4f,
    CameraRightAspect: vec4f,
    CameraUpGain: vec4f,
    SunDirectionIntensity: vec4f,
    SunColourTime: vec4f,
    CascadeOrigin0: vec4f,
    CascadeOrigin1: vec4f,
    CascadeOrigin2: vec4f,
    ScreenRsm: vec4f,
    Settings: vec4f,
    ScreenSettings: vec4f,
    Counts: vec4f,
};

struct RasterInput
{
    @location(0) Position: vec3f,
    @location(1) Normal: vec3f,
    @location(2) TranslationFlags: vec4f,
    @location(3) AlbedoMetalness: vec4f,
    @location(4) ScaleRoughness: vec4f,
};

struct RasterVarying
{
    @builtin(position) ClipPosition: vec4f,
    @location(0) WorldPosition: vec3f,
    @location(1) WorldNormal: vec3f,
    @location(2) AlbedoMetalness: vec4f,
    @location(3) Roughness: f32,
};

struct RasterTargets
{
    @location(0) PositionHit: vec4f,
    @location(1) NormalRoughness: vec4f,
    @location(2) AlbedoMetalness: vec4f,
};

struct RsmTargets
{
    @location(0) PositionHit: vec4f,
    @location(1) NormalFlux: vec4f,
    @location(2) AlbedoMetalness: vec4f,
};

@group(0) @binding(0) var<uniform> Frame: FrameUniforms;

fn WorldVertex(Input: RasterInput) -> RasterVarying
{
    var Result: RasterVarying;
    let SafeScale = max(abs(Input.ScaleRoughness.xyz), vec3f(0.0001));
    Result.WorldPosition = Input.Position * Input.ScaleRoughness.xyz + Input.TranslationFlags.xyz;
    Result.WorldNormal = normalize(Input.Normal / SafeScale);
    Result.AlbedoMetalness = Input.AlbedoMetalness;
    Result.Roughness = Input.ScaleRoughness.w;
    return Result;
}

@vertex
fn CameraVertex(Input: RasterInput) -> RasterVarying
{
    var Result = WorldVertex(Input);
    Result.ClipPosition = Frame.CameraProjection * vec4f(Result.WorldPosition, 1.0);
    return Result;
}

@fragment
fn CameraFragment(Input: RasterVarying) -> RasterTargets
{
    var Result: RasterTargets;
    Result.PositionHit = vec4f(Input.WorldPosition, 1.0);
    Result.NormalRoughness = vec4f(normalize(Input.WorldNormal), Input.Roughness);
    Result.AlbedoMetalness = Input.AlbedoMetalness;
    return Result;
}

@vertex
fn RsmVertex(Input: RasterInput) -> RasterVarying
{
    var Result = WorldVertex(Input);
    Result.ClipPosition = Frame.LightProjection * vec4f(Result.WorldPosition, 1.0);
    return Result;
}

@fragment
fn RsmFragment(Input: RasterVarying) -> RsmTargets
{
    var Result: RsmTargets;
    let Normal = normalize(Input.WorldNormal);
    let Flux = max(dot(Normal, Frame.SunDirectionIntensity.xyz), 0.0);
    Result.PositionHit = vec4f(Input.WorldPosition, 1.0);
    Result.NormalFlux = vec4f(Normal, Flux);
    Result.AlbedoMetalness = Input.AlbedoMetalness;
    return Result;
}
