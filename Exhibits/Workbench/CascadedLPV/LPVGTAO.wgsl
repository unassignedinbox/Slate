// Half-resolution GTAO only. Screen-space colour transfer was deliberately removed:
// visible pixels cannot provide reliable indirect-light visibility or off-screen radiance.

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

@group(0) @binding(0) var<uniform> Frame: FrameUniforms;
@group(0) @binding(1) var PositionImage: texture_2d<f32>;
@group(0) @binding(2) var NormalImage: texture_2d<f32>;
@group(0) @binding(5) var PreviousGtao: texture_2d<f32>;
@group(0) @binding(6) var PreviousPosition: texture_2d<f32>;
@group(0) @binding(7) var CurrentGtao: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var CurrentPosition: texture_storage_2d<rgba16float, write>;

fn Hash(Value: u32) -> u32
{
    var State = Value;
    State = State ^ (State >> 16u);
    State = State * 0x7feb352du;
    State = State ^ (State >> 15u);
    State = State * 0x846ca68bu;
    return State ^ (State >> 16u);
}

fn StableBlueAngle(Position: vec3f, Normal: vec3f) -> f32
{
    let Cell = vec3i(floor(Position * 8.0));
    var Identity = Hash(bitcast<u32>(Cell.x) ^ 0x68bc21ebu);
    let YTerm = bitcast<u32>(Cell.y) * 0x02e5be93u;
    Identity = Hash(Identity ^ YTerm);
    let ZTerm = bitcast<u32>(Cell.z) * 0x967a889bu;
    Identity = Hash(Identity ^ ZTerm);
    let NormalCell = vec3i(floor((Normal * 0.5 + 0.5) * 7.0));
    let NormalTerm = u32(NormalCell.x + NormalCell.y * 9 + NormalCell.z * 81);
    Identity = Hash(Identity ^ NormalTerm);
    return f32(Identity >> 8u) * (6.28318530718 / 16777216.0);
}

@compute @workgroup_size(8, 8)
fn ScreenMain(@builtin(global_invocation_id) Global: vec3u)
{
    let HalfExtent = textureDimensions(CurrentGtao);
    if (Global.x >= HalfExtent.x || Global.y >= HalfExtent.y) { return; }
    let FullExtent = textureDimensions(PositionImage);
    let FullPixel = vec2i(min(Global.xy * 2u + vec2u(1u), FullExtent - vec2u(1u)));
    let PositionHit = textureLoad(PositionImage, FullPixel, 0);
    if (PositionHit.w < 0.5)
    {
        textureStore(CurrentGtao, vec2i(Global.xy), vec4f(0.0, 0.0, 0.0, 1.0));
        textureStore(CurrentPosition, vec2i(Global.xy), vec4f(0.0));
        return;
    }

    let Position = PositionHit.xyz;
    let Normal = normalize(textureLoad(NormalImage, FullPixel, 0).xyz);
    let Radius = max(Frame.ScreenSettings.y, 0.1);
    let BlueAngle = StableBlueAngle(Position, Normal);
    let PixelScale = max(f32(FullExtent.y) / 720.0, 0.65);
    var HorizonOcclusion = 0.0;

    // Eight azimuthal horizon searches. Unlike the removed colour-transfer pass,
    // this only estimates ambient visibility and makes no claim about radiance.
    for (var DirectionNumber = 0u; DirectionNumber < 8u; DirectionNumber = DirectionNumber + 1u)
    {
        let Angle = (f32(DirectionNumber) + 0.5) * 0.78539816339 + BlueAngle;
        let ScreenDirection = vec2f(cos(Angle), sin(Angle));
        var DirectionHorizon = 0.0;
        for (var StepNumber = 0u; StepNumber < 4u; StepNumber = StepNumber + 1u)
        {
            let StepPixels = array<f32, 4>(3.0, 7.0, 14.0, 25.0)[StepNumber] * PixelScale;
            let SamplePixel = FullPixel + vec2i(round(ScreenDirection * StepPixels));
            if (any(SamplePixel < vec2i(0)) || any(SamplePixel >= vec2i(FullExtent))) { continue; }
            let SampleHit = textureLoad(PositionImage, SamplePixel, 0);
            if (SampleHit.w < 0.5) { continue; }
            let Delta = SampleHit.xyz - Position;
            let Distance = length(Delta);
            if (Distance < 0.035 || Distance > Radius) { continue; }
            let Direction = Delta / Distance;
            let Elevation = max(dot(Normal, Direction) - 0.045, 0.0);
            let Remainder = max(1.0 - Distance / Radius, 0.0);
            DirectionHorizon = max(DirectionHorizon, Elevation * Remainder * Remainder);
        }
        HorizonOcclusion = HorizonOcclusion + DirectionHorizon;
    }

    var AmbientVisibility = clamp(exp(-HorizonOcclusion * 0.43), 0.28, 1.0);
    let PreviousClip = Frame.PreviousCameraProjection * vec4f(Position, 1.0);
    if (PreviousClip.w > 0.0 && Frame.ScreenSettings.z > 0.5 && Frame.CameraPosition.w > 1.5)
    {
        let PreviousNdc = PreviousClip.xy / PreviousClip.w;
        let PreviousUv = vec2f(PreviousNdc.x * 0.5 + 0.5, 0.5 - PreviousNdc.y * 0.5);
        if (all(PreviousUv > vec2f(0.0)) && all(PreviousUv < vec2f(1.0)))
        {
            let PreviousPixel = vec2i(clamp(
                PreviousUv * vec2f(HalfExtent),
                vec2f(0.0),
                vec2f(HalfExtent) - vec2f(1.0)
            ));
            let HistoryPosition = textureLoad(PreviousPosition, PreviousPixel, 0);
            if (HistoryPosition.w > 0.5 && distance(HistoryPosition.xyz, Position) < 0.18)
            {
                let History = textureLoad(PreviousGtao, PreviousPixel, 0).w;
                let ChangeConfidence = smoothstep(0.025, 0.24, abs(AmbientVisibility - History));
                let StableWeight = clamp(Frame.ScreenSettings.x, 0.0, 0.95);
                let HistoryWeight = mix(StableWeight, 0.45, ChangeConfidence);
                AmbientVisibility = mix(
                    AmbientVisibility,
                    clamp(History, AmbientVisibility - 0.12, AmbientVisibility + 0.12),
                    HistoryWeight
                );
            }
        }
    }

    textureStore(CurrentGtao, vec2i(Global.xy), vec4f(0.0, 0.0, 0.0, AmbientVisibility));
    textureStore(CurrentPosition, vec2i(Global.xy), vec4f(Position, 1.0));
}
