// Converts a regularly sampled reflective shadow map into current-frame surfel/VPL records.

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

struct SurfelRecord
{
    PositionRadius: vec4f,
    NormalValid: vec4f,
    AlbedoFlux: vec4f,
    RadianceFrame: vec4f,
};

struct SurfelExtent
{
    Records: array<SurfelRecord>,
};

@group(0) @binding(0) var<uniform> Frame: FrameUniforms;
@group(0) @binding(1) var RsmPosition: texture_2d<f32>;
@group(0) @binding(2) var RsmNormal: texture_2d<f32>;
@group(0) @binding(3) var RsmAlbedo: texture_2d<f32>;
@group(0) @binding(4) var<storage, read_write> Surfels: SurfelExtent;

@compute @workgroup_size(64)
fn ExtractMain(@builtin(global_invocation_id) Global: vec3u)
{
    let RecordNumber = Global.x;
    let RecordCount = u32(Frame.Counts.y + 0.5);
    if (RecordNumber >= RecordCount)
    {
        return;
    }

    let SampleWidth = u32(Frame.ScreenRsm.z + 0.5) / 2u;
    let SamplePosition = vec2i(
        i32((RecordNumber % SampleWidth) * 2u + 1u),
        i32((RecordNumber / SampleWidth) * 2u + 1u)
    );
    let PositionHit = textureLoad(RsmPosition, SamplePosition, 0);
    if (PositionHit.w < 0.5)
    {
        Surfels.Records[RecordNumber].PositionRadius = vec4f(0.0);
        Surfels.Records[RecordNumber].NormalValid = vec4f(0.0);
        Surfels.Records[RecordNumber].AlbedoFlux = vec4f(0.0);
        Surfels.Records[RecordNumber].RadianceFrame = vec4f(0.0);
        return;
    }

    let NormalFlux = textureLoad(RsmNormal, SamplePosition, 0);
    let AlbedoMetalness = textureLoad(RsmAlbedo, SamplePosition, 0);
    let Flux = max(NormalFlux.w, 0.0);
    let DiffuseAlbedo = AlbedoMetalness.xyz * (1.0 - AlbedoMetalness.w * 0.88);
    let Radiance = DiffuseAlbedo * Frame.SunColourTime.xyz
        * (Flux * Frame.SunDirectionIntensity.w * 0.78);
    let Radius = Frame.ScreenRsm.w / max(f32(SampleWidth), 1.0) * 0.82;

    Surfels.Records[RecordNumber].PositionRadius = vec4f(PositionHit.xyz, Radius);
    Surfels.Records[RecordNumber].NormalValid = vec4f(normalize(NormalFlux.xyz), 1.0);
    Surfels.Records[RecordNumber].AlbedoFlux = vec4f(AlbedoMetalness.xyz, Flux);
    Surfels.Records[RecordNumber].RadianceFrame = vec4f(Radiance, Frame.CameraPosition.w);
}
