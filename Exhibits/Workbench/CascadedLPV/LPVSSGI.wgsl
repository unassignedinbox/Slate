// Half-resolution short-range screen-space colour transfer, GTAO, and world-position history rejection.

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
    PreviousCascadeOrigin0: vec4f,
    PreviousCascadeOrigin1: vec4f,
    PreviousCascadeOrigin2: vec4f,
    ShadowProjection0: mat4x4f,
    ShadowProjection1: mat4x4f,
    ShadowProjection2: mat4x4f,
    ShadowSplits: vec4f,
};

@group(0) @binding(0) var<uniform> Frame: FrameUniforms;
@group(0) @binding(1) var PositionImage: texture_2d<f32>;
@group(0) @binding(2) var NormalImage: texture_2d<f32>;
@group(0) @binding(3) var AlbedoImage: texture_2d<f32>;
@group(0) @binding(4) var CsmDepth: texture_depth_2d_array;
@group(0) @binding(5) var PreviousScreenGI: texture_2d<f32>;
@group(0) @binding(6) var PreviousPosition: texture_2d<f32>;
@group(0) @binding(7) var CurrentScreenGI: texture_storage_2d<rgba16float, write>;
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

fn ShadowProjection(Cascade: u32) -> mat4x4f
{
    if (Cascade == 0u) { return Frame.ShadowProjection0; }
    if (Cascade == 1u) { return Frame.ShadowProjection1; }
    return Frame.ShadowProjection2;
}

fn SunVisibility(Position: vec3f, Normal: vec3f) -> f32
{
    let ViewDepth = max(dot(Position - Frame.CameraPosition.xyz, Frame.CameraForwardTan.xyz), 0.0);
    var Cascade = 0u;
    if (ViewDepth > Frame.ShadowSplits.x) { Cascade = 1u; }
    if (ViewDepth > Frame.ShadowSplits.y) { Cascade = 2u; }
    let ReceiverPosition = Position + Normal * 0.006 + Frame.SunDirectionIntensity.xyz * 0.008;
    let Clip = ShadowProjection(Cascade) * vec4f(ReceiverPosition, 1.0);
    if (Clip.w <= 0.0) { return 1.0; }
    let Ndc = Clip.xyz / Clip.w;
    let Uv = vec2f(Ndc.x * 0.5 + 0.5, 0.5 - Ndc.y * 0.5);
    if (any(Uv <= vec2f(0.0)) || any(Uv >= vec2f(1.0)) || Ndc.z <= 0.0 || Ndc.z >= 1.0) { return 1.0; }
    let Extent = textureDimensions(CsmDepth);
    let Pixel = vec2i(clamp(Uv * vec2f(Extent), vec2f(0.0), vec2f(Extent) - vec2f(1.0)));
    let StoredDepth = textureLoad(CsmDepth, Pixel, i32(Cascade), 0);
    let Bias = 0.00012 + 0.00042 * (1.0 - max(dot(Normal, Frame.SunDirectionIntensity.xyz), 0.0));
    return select(0.0, 1.0, Ndc.z - Bias <= StoredDepth);
}

@compute @workgroup_size(8, 8)
fn ScreenMain(@builtin(global_invocation_id) Global: vec3u)
{
    let HalfExtent = textureDimensions(CurrentScreenGI);
    if (Global.x >= HalfExtent.x || Global.y >= HalfExtent.y) { return; }
    let FullExtent = textureDimensions(PositionImage);
    let FullPixel = vec2i(min(Global.xy * 2u + vec2u(1u), FullExtent - vec2u(1u)));
    let PositionHit = textureLoad(PositionImage, FullPixel, 0);
    if (PositionHit.w < 0.5)
    {
        textureStore(CurrentScreenGI, vec2i(Global.xy), vec4f(0.0, 0.0, 0.0, 1.0));
        textureStore(CurrentPosition, vec2i(Global.xy), vec4f(0.0));
        return;
    }

    let Position = PositionHit.xyz;
    let Normal = normalize(textureLoad(NormalImage, FullPixel, 0).xyz);
    let Radius = Frame.ScreenSettings.y;
    // Keep the sampling pattern fixed in world space. The former frame-wide golden-angle
    // rotation made every receiver change all 32 taps every frame and visibly sparkled.
    let FrameRotation = StableBlueAngle(Position, Normal);
    let PixelScale = max(f32(FullExtent.y) / 720.0, 0.65);
    var Indirect = vec3f(0.0);
    var Occlusion = 0.0;
    var ValidSamples = 0.0;

    for (var DirectionNumber = 0u; DirectionNumber < 8u; DirectionNumber = DirectionNumber + 1u)
    {
        let Angle = (f32(DirectionNumber) + 0.5) * 0.78539816339 + FrameRotation;
        let ScreenDirection = vec2f(cos(Angle), sin(Angle));
        for (var StepNumber = 0u; StepNumber < 4u; StepNumber = StepNumber + 1u)
        {
            let StepPixels = array<f32, 4>(3.0, 7.0, 14.0, 25.0)[StepNumber] * PixelScale;
            let SamplePixel = FullPixel + vec2i(round(ScreenDirection * StepPixels));
            if (any(SamplePixel < vec2i(0)) || any(SamplePixel >= vec2i(FullExtent))) { continue; }
            let SamplePositionHit = textureLoad(PositionImage, SamplePixel, 0);
            if (SamplePositionHit.w < 0.5) { continue; }
            let Delta = SamplePositionHit.xyz - Position;
            let Distance = length(Delta);
            if (Distance < 0.035 || Distance > Radius) { continue; }
            let Direction = Delta / Distance;
            let ReceiverFacing = max(dot(Normal, Direction) - 0.04, 0.0);
            if (ReceiverFacing <= 0.0) { continue; }

            let SampleNormal = normalize(textureLoad(NormalImage, SamplePixel, 0).xyz);
            let SourceFacing = max(dot(SampleNormal, -Direction), 0.0);
            let SampleAlbedoMetalness = textureLoad(AlbedoImage, SamplePixel, 0);
            let SunFacing = max(dot(SampleNormal, Frame.SunDirectionIntensity.xyz), 0.0);
            let Visibility = SunVisibility(SamplePositionHit.xyz, SampleNormal);
            let Falloff = exp(-Distance * 0.62) / (0.35 + Distance * Distance);
            let SourceRadiance = SampleAlbedoMetalness.xyz
                * (1.0 - SampleAlbedoMetalness.w * 0.85)
                * Frame.SunColourTime.xyz
                * (SunFacing * Visibility * Frame.SunDirectionIntensity.w);
            Indirect = Indirect + SourceRadiance
                * (ReceiverFacing * SourceFacing * Falloff * 0.42);
            Occlusion = Occlusion + ReceiverFacing
                * (0.35 + 0.65 * (1.0 - SourceFacing))
                * exp(-Distance * 0.9);
            ValidSamples = ValidSamples + 1.0;
        }
    }

    if (ValidSamples > 0.0)
    {
        let DensityCompensation = 12.0 / max(ValidSamples, 12.0);
        Indirect = Indirect * DensityCompensation;
        Occlusion = Occlusion * DensityCompensation;
    }
    let AmbientVisibility = clamp(exp(-Occlusion * 0.26), 0.28, 1.0);
    var Current = vec4f(clamp(Indirect, vec3f(0.0), vec3f(8.0)), AmbientVisibility);

    let PreviousClip = Frame.PreviousCameraProjection * vec4f(Position, 1.0);
    if (PreviousClip.w > 0.0)
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
            if (
                Frame.ScreenSettings.z > 0.5
                && Frame.CameraPosition.w > 1.5
                && HistoryPosition.w > 0.5
                && distance(HistoryPosition.xyz, Position) < 0.18
            )
            {
                let History = textureLoad(PreviousScreenGI, PreviousPixel, 0);
                let Luminance = vec3f(0.2126, 0.7152, 0.0722);
                let ColourDifference = abs(dot(Current.xyz - History.xyz, Luminance));
                let OcclusionDifference = abs(Current.w - History.w);
                let ChangeConfidence = smoothstep(0.025, 0.32, ColourDifference + OcclusionDifference * 0.18);
                let StableWeight = clamp(Frame.ScreenSettings.x, 0.0, 0.95);
                let HistoryWeight = mix(StableWeight, 0.48, ChangeConfidence);
                let ColourBand = vec3f(0.075) + Current.xyz * 0.62;
                let ClampedHistory = vec4f(
                    clamp(History.xyz, max(Current.xyz - ColourBand, vec3f(0.0)), Current.xyz + ColourBand),
                    clamp(History.w, Current.w - 0.16, Current.w + 0.16)
                );
                Current = mix(Current, ClampedHistory, HistoryWeight);
            }
        }
    }

    textureStore(CurrentScreenGI, vec2i(Global.xy), Current);
    textureStore(CurrentPosition, vec2i(Global.xy), vec4f(Position, 1.0));
}
