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
};

@group(0) @binding(0) var<uniform> Frame: FrameUniforms;
@group(0) @binding(1) var PositionImage: texture_2d<f32>;
@group(0) @binding(2) var NormalImage: texture_2d<f32>;
@group(0) @binding(3) var AlbedoImage: texture_2d<f32>;
@group(0) @binding(4) var RsmDepth: texture_depth_2d;
@group(0) @binding(5) var PreviousScreenGI: texture_2d<f32>;
@group(0) @binding(6) var PreviousPosition: texture_2d<f32>;
@group(0) @binding(7) var CurrentScreenGI: texture_storage_2d<rgba16float, write>;
@group(0) @binding(8) var CurrentPosition: texture_storage_2d<rgba16float, write>;

fn SunVisibility(Position: vec3f, Normal: vec3f) -> f32
{
    let Clip = Frame.LightProjection * vec4f(Position + Normal * 0.015, 1.0);
    if (Clip.w <= 0.0) { return 1.0; }
    let Ndc = Clip.xyz / Clip.w;
    let Uv = vec2f(Ndc.x * 0.5 + 0.5, 0.5 - Ndc.y * 0.5);
    if (any(Uv <= vec2f(0.0)) || any(Uv >= vec2f(1.0)) || Ndc.z <= 0.0 || Ndc.z >= 1.0)
    {
        return 1.0;
    }
    let Extent = textureDimensions(RsmDepth);
    let Pixel = vec2i(clamp(Uv * vec2f(Extent), vec2f(0.0), vec2f(Extent) - vec2f(1.0)));
    let StoredDepth = textureLoad(RsmDepth, Pixel, 0);
    let Bias = 0.0018 + 0.0035 * (1.0 - max(dot(Normal, Frame.SunDirectionIntensity.xyz), 0.0));
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
    let FrameRotation = fract(Frame.CameraPosition.w * 0.61803398875) * 6.28318530718;
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
            if (HistoryPosition.w > 0.5 && distance(HistoryPosition.xyz, Position) < 0.18)
            {
                let History = textureLoad(PreviousScreenGI, PreviousPixel, 0);
                let HistoryWeight = clamp(Frame.ScreenSettings.x, 0.0, 0.94);
                Current = mix(Current, History, HistoryWeight);
            }
        }
    }

    textureStore(CurrentScreenGI, vec2i(Global.xy), Current);
    textureStore(CurrentPosition, vec2i(Global.xy), vec4f(Position, 1.0));
}
