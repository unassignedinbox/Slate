//============================================================================================================================================
//                                                            SURFELOVERLAY.WGSL                                                            //
//============================================================================================================================================
// 📦 Depth-tested tangent discs exposing world-space placement density and integrated irradiance.

struct SurfelRecord
{
    PositionRadius: vec4f,
    NormalArea: vec4f,
    AlbedoIdentity: vec4f,
    IrradianceAge: vec4f,
    ShortMeanVariance: vec4f,
};

struct OverlayUniforms
{
    ViewProjection: mat4x4f,
    Tuning: vec4f,
};

struct SurfelExtent
{
    Records: array<SurfelRecord>,
};

struct OverlayVarying
{
    @builtin(position) ClipPosition: vec4f,
    @location(0) DiscPosition: vec2f,
    @location(1) DiscColour: vec3f,
};

@group(0) @binding(0) var<uniform> Overlay: OverlayUniforms;
@group(0) @binding(1) var<storage, read> PublishedField: SurfelExtent;

@vertex
fn OverlayVertex(
    @builtin(vertex_index) VertexNumber: u32,
    @builtin(instance_index) RecordNumber: u32,
) -> OverlayVarying
{
    let Corners = array<vec2f, 6>(
        vec2f(-1.0, -1.0),
        vec2f(1.0, -1.0),
        vec2f(-1.0, 1.0),
        vec2f(-1.0, 1.0),
        vec2f(1.0, -1.0),
        vec2f(1.0, 1.0),
    );
    let Record = PublishedField.Records[RecordNumber];
    let Normal = normalize(Record.NormalArea.xyz);
    let Reference = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(Normal.z) < 0.9);
    let Tangent = normalize(cross(Reference, Normal));
    let Bitangent = cross(Normal, Tangent);
    let Corner = Corners[VertexNumber];
    let DiscRadius = Record.PositionRadius.w * Overlay.Tuning.x;
    let Position = Record.PositionRadius.xyz
        + Normal * 0.006
        + (Tangent * Corner.x + Bitangent * Corner.y) * DiscRadius;
    let Irradiance = max(Record.IrradianceAge.xyz * Overlay.Tuning.y, vec3f(0.0));

    var Result: OverlayVarying;
    Result.ClipPosition = Overlay.ViewProjection * vec4f(Position, 1.0);
    Result.DiscPosition = Corner;
    Result.DiscColour = pow(Irradiance / (Irradiance + vec3f(1.0)), vec3f(1.0 / 2.2));
    return Result;
}

@fragment
fn OverlayFragment(Input: OverlayVarying) -> @location(0) vec4f
{
    if (dot(Input.DiscPosition, Input.DiscPosition) > 1.0)
    {
        discard;
    }
    let Ring = smoothstep(1.0, 0.72, length(Input.DiscPosition));
    let Colour = mix(vec3f(1.0, 0.58, 0.16), Input.DiscColour + vec3f(0.08), Ring);
    return vec4f(Colour, 0.78);
}
