// World-anchored blue-noise candidate extraction from the GI-only reflective shadow map.

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

fn Hash(Value: u32) -> u32
{
    var State = Value;
    State = State ^ (State >> 16u);
    State = State * 0x7feb352du;
    State = State ^ (State >> 15u);
    State = State * 0x846ca68bu;
    return State ^ (State >> 16u);
}

fn WorldIdentity(Position: vec3f, Normal: vec3f) -> u32
{
    let Cell = vec3i(floor(Position * 4.0));
    let NormalCell = vec3i(floor((Normal * 0.5 + 0.5) * 15.0));
    var Identity = Hash(bitcast<u32>(Cell.x) ^ 0x68bc21ebu);
    let YTerm = bitcast<u32>(Cell.y) * 0x02e5be93u;
    Identity = Hash(Identity ^ YTerm);
    let ZTerm = bitcast<u32>(Cell.z) * 0x967a889bu;
    Identity = Hash(Identity ^ ZTerm);
    let NormalTerm = u32(NormalCell.x + NormalCell.y * 17 + NormalCell.z * 289);
    Identity = Hash(Identity ^ NormalTerm);
    return (Identity & 0x00ffffffu) | 1u;
}

fn BlueNoiseChoice(Position: vec3f, Normal: vec3f) -> u32
{
    let Quantized = floor(Position * 4.0);
    let Axis = abs(Normal);
    var Plane = Quantized.xy;
    if (Axis.x > Axis.y && Axis.x > Axis.z) { Plane = Quantized.yz; }
    else if (Axis.y > Axis.z) { Plane = Quantized.xz; }
    // World-space interleaved-gradient rank: stable under light/camera motion and blue-noise-like locally.
    let Rank = fract(52.9829189 * fract(dot(Plane, vec2f(0.06711056, 0.00583715))));
    return min(u32(floor(Rank * 4.0)), 3u);
}

fn InBounds(Pixel: vec2i, Extent: vec2u) -> bool
{
    return all(Pixel >= vec2i(0)) && all(Pixel < vec2i(Extent));
}

@compute @workgroup_size(64)
fn ExtractMain(@builtin(global_invocation_id) Global: vec3u)
{
    let RecordNumber = Global.x;
    let RecordCount = u32(Frame.Counts.y + 0.5);
    if (RecordNumber >= RecordCount) { return; }

    let RsmExtent = textureDimensions(RsmPosition);
    let SampleWidth = RsmExtent.x / 2u;
    let Tile = vec2u(RecordNumber % SampleWidth, RecordNumber / SampleWidth);
    let TileCentre = vec2i(Tile * 2u + vec2u(1u));
    let CentrePosition = textureLoad(RsmPosition, TileCentre, 0);
    if (CentrePosition.w < 0.5)
    {
        Surfels.Records[RecordNumber] = SurfelRecord(vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
        return;
    }

    let CentreNormal = normalize(textureLoad(RsmNormal, TileCentre, 0).xyz);
    let BlueChoice = BlueNoiseChoice(CentrePosition.xyz, CentreNormal);
    let BlueOffset = vec2u(BlueChoice & 1u, (BlueChoice >> 1u) & 1u);
    let SamplePosition = vec2i(Tile * 2u + BlueOffset);
    let PositionHit = textureLoad(RsmPosition, SamplePosition, 0);
    if (PositionHit.w < 0.5)
    {
        Surfels.Records[RecordNumber] = SurfelRecord(vec4f(0.0), vec4f(0.0), vec4f(0.0), vec4f(0.0));
        return;
    }

    let NormalFlux = textureLoad(RsmNormal, SamplePosition, 0);
    let Normal = normalize(NormalFlux.xyz);
    let StableIdentity = WorldIdentity(PositionHit.xyz, Normal);
    var EdgeScore = 0.0;
    let Neighbours = array<vec2i, 4>(vec2i(-1, 0), vec2i(1, 0), vec2i(0, -1), vec2i(0, 1));
    for (var NeighbourNumber = 0u; NeighbourNumber < 4u; NeighbourNumber = NeighbourNumber + 1u)
    {
        let NeighbourPixel = SamplePosition + Neighbours[NeighbourNumber];
        if (!InBounds(NeighbourPixel, RsmExtent))
        {
            EdgeScore = EdgeScore + 1.0;
            continue;
        }
        let NeighbourPosition = textureLoad(RsmPosition, NeighbourPixel, 0);
        if (NeighbourPosition.w < 0.5)
        {
            EdgeScore = EdgeScore + 1.0;
            continue;
        }
        let NeighbourNormal = normalize(textureLoad(RsmNormal, NeighbourPixel, 0).xyz);
        let PositionBreak = select(0.0, 1.0, distance(NeighbourPosition.xyz, PositionHit.xyz) > 0.48);
        let NormalBreak = select(0.0, 1.0, dot(NeighbourNormal, Normal) < 0.72);
        EdgeScore = EdgeScore + max(PositionBreak, NormalBreak);
    }

    let AlbedoMetalness = textureLoad(RsmAlbedo, SamplePosition, 0);
    let Flux = max(NormalFlux.w, 0.0);
    let DiffuseAlbedo = AlbedoMetalness.xyz * (1.0 - AlbedoMetalness.w * 0.88);
    let Radiance = DiffuseAlbedo * Frame.SunColourTime.xyz
        * (Flux * Frame.SunDirectionIntensity.w * 0.78);
    let BaseRadius = Frame.ScreenRsm.w / max(f32(SampleWidth), 1.0) * 0.82;
    let EdgeConfidence = select(1.0, 0.58, EdgeScore > 0.5);
    let Radius = BaseRadius * mix(1.0, 0.55, clamp(EdgeScore * 0.25, 0.0, 1.0));

    Surfels.Records[RecordNumber].PositionRadius = vec4f(PositionHit.xyz, Radius);
    Surfels.Records[RecordNumber].NormalValid = vec4f(Normal, EdgeConfidence);
    Surfels.Records[RecordNumber].AlbedoFlux = vec4f(AlbedoMetalness.xyz, Flux);
    Surfels.Records[RecordNumber].RadianceFrame = vec4f(Radiance, f32(StableIdentity));
}
