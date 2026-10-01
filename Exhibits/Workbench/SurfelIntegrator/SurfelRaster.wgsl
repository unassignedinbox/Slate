//============================================================================================================================================
//                                                            SURFELRASTER.WGSL                                                             //
//============================================================================================================================================
// 📦 Shared-topology visibility and light-depth projection for the browser surfel demonstration.

struct ProjectionUniforms
{
    SpatialProjection: mat4x4f,
};

struct RasterInput
{
    @location(0) Position: vec3f,
    @location(1) Normal: vec3f,
    @location(2) Translation: vec4f,
    @location(3) AlbedoMetalness: vec4f,
    @location(4) RoughnessScale: vec4f,
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

@group(0) @binding(0) var<uniform> Projection: ProjectionUniforms;

@vertex
fn RasterVertex(Input: RasterInput) -> RasterVarying
{
    var Result: RasterVarying;
    let WorldPosition = Input.Position * Input.RoughnessScale.y + Input.Translation.xyz;
    Result.ClipPosition = Projection.SpatialProjection * vec4f(WorldPosition, 1.0);
    Result.WorldPosition = WorldPosition;
    Result.WorldNormal = normalize(Input.Normal);
    Result.AlbedoMetalness = Input.AlbedoMetalness;
    Result.Roughness = Input.RoughnessScale.x;
    return Result;
}

@fragment
fn RasterFragment(Input: RasterVarying) -> RasterTargets
{
    var Result: RasterTargets;
    Result.PositionHit = vec4f(Input.WorldPosition, 1.0);
    Result.NormalRoughness = vec4f(normalize(Input.WorldNormal), Input.Roughness);
    Result.AlbedoMetalness = Input.AlbedoMetalness;
    return Result;
}

@vertex
fn ShadowVertex(Input: RasterInput) -> @builtin(position) vec4f
{
    let WorldPosition = Input.Position * Input.RoughnessScale.y + Input.Translation.xyz;
    return Projection.SpatialProjection * vec4f(WorldPosition, 1.0);
}
