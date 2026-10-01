// Optional depth-tested visualization of the transient RSM surfel stream.

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

struct OverlayVarying
{
    @builtin(position) ClipPosition: vec4f,
    @location(0) DiscPosition: vec2f,
    @location(1) Colour: vec3f,
    @location(2) Valid: f32,
};

@group(0) @binding(0) var<uniform> Frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> Surfels: SurfelExtent;

@vertex
fn OverlayVertex(
    @builtin(vertex_index) VertexNumber: u32,
    @builtin(instance_index) InstanceNumber: u32
) -> OverlayVarying
{
    let Corners = array<vec2f, 6>(
        vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
    );
    let Record = Surfels.Records[InstanceNumber];
    let Normal = normalize(Record.NormalValid.xyz + vec3f(0.0, 0.0, 0.0001));
    let Reference = select(vec3f(0.0, 0.0, 1.0), vec3f(1.0, 0.0, 0.0), abs(Normal.z) > 0.88);
    let Tangent = normalize(cross(Reference, Normal));
    let Bitangent = cross(Normal, Tangent);
    let Corner = Corners[VertexNumber];
    let Radius = Record.PositionRadius.w * 0.34;
    let WorldPosition = Record.PositionRadius.xyz
        + Normal * 0.018
        + (Tangent * Corner.x + Bitangent * Corner.y) * Radius;

    var Result: OverlayVarying;
    Result.ClipPosition = Frame.CameraProjection * vec4f(WorldPosition, 1.0);
    if (Record.NormalValid.w < 0.5)
    {
        Result.ClipPosition = vec4f(2.0, 2.0, 2.0, 1.0);
    }
    Result.DiscPosition = Corner;
    Result.Colour = mix(vec3f(0.25, 0.95, 0.65), Record.AlbedoFlux.xyz, 0.42);
    Result.Valid = Record.NormalValid.w;
    return Result;
}

@fragment
fn OverlayFragment(Input: OverlayVarying) -> @location(0) vec4f
{
    let RadiusSquared = dot(Input.DiscPosition, Input.DiscPosition);
    if (RadiusSquared > 1.0 || Input.Valid < 0.5) { discard; }
    let Edge = smoothstep(1.0, 0.58, RadiusSquared);
    return vec4f(Input.Colour * (1.15 + Edge * 0.35), 0.35 + Edge * 0.46);
}
