// Final resolve for direct lighting, cascaded LPV, screen-space refinement, and diagnostic views.

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

struct VolumeCell
{
    Red: vec4f,
    Green: vec4f,
    Blue: vec4f,
};

struct VolumeExtent
{
    Cells: array<VolumeCell>,
};

struct NearCell { Faces: array<vec4f, 6>, }
struct NearExtent { Cells: array<NearCell>, }
struct PackedBlocker { Low: u32, High: u32, }
struct BlockerExtent { Cells: array<PackedBlocker>, }

struct FullscreenVarying
{
    @builtin(position) ClipPosition: vec4f,
    @location(0) TexturePosition: vec2f,
};

@group(0) @binding(0) var<uniform> Frame: FrameUniforms;
@group(0) @binding(1) var PositionImage: texture_2d<f32>;
@group(0) @binding(2) var NormalImage: texture_2d<f32>;
@group(0) @binding(3) var AlbedoImage: texture_2d<f32>;
@group(0) @binding(4) var CsmNear: texture_depth_2d;
@group(0) @binding(10) var CsmMiddle: texture_depth_2d;
@group(0) @binding(11) var CsmFar: texture_depth_2d;
@group(0) @binding(5) var ShadowComparison: sampler_comparison;
@group(0) @binding(6) var GtaoTexture: texture_2d<f32>;
@group(0) @binding(7) var LinearSampler: sampler;
@group(0) @binding(8) var<storage, read> RadianceVolume: VolumeExtent;
@group(0) @binding(9) var<storage, read> NearBlockerVolume: BlockerExtent;
@group(0) @binding(12) var<storage, read> NearRadianceVolume: NearExtent;
@group(0) @binding(13) var<storage, read> FarBlockerVolume: BlockerExtent;

const VolumeResolution: u32 = 48u;
const CellsPerCascade: u32 = 110592u;
const InversePi: f32 = 0.31830988618;

fn CascadeOrigin(Cascade: u32) -> vec4f
{
    if (Cascade == 0u) { return Frame.CascadeOrigin0; }
    if (Cascade == 1u) { return Frame.CascadeOrigin1; }
    return Frame.CascadeOrigin2;
}

fn CellNumber(Coordinate: vec3i, Cascade: u32) -> u32
{
    return Cascade * CellsPerCascade
        + u32(Coordinate.x)
        + u32(Coordinate.y) * VolumeResolution
        + u32(Coordinate.z) * VolumeResolution * VolumeResolution;
}

fn CascadeEdge(Position: vec3f, Cascade: u32) -> f32
{
    let OriginCell = CascadeOrigin(Cascade);
    let Grid = (Position - OriginCell.xyz) / OriginCell.w;
    return min(min(min(Grid.x, Grid.y), Grid.z), min(min(47.0 - Grid.x, 47.0 - Grid.y), 47.0 - Grid.z));
}

fn Evaluate(Coefficients: vec4f, Direction: vec3f) -> f32
{
    return max(Coefficients.x + dot(Coefficients.yzw, Direction), 0.0);
}

fn FaceDirection(Face: u32) -> vec3f
{
    let Directions = array<vec3f, 6>(
        vec3f(1.0, 0.0, 0.0), vec3f(-1.0, 0.0, 0.0),
        vec3f(0.0, 1.0, 0.0), vec3f(0.0, -1.0, 0.0),
        vec3f(0.0, 0.0, 1.0), vec3f(0.0, 0.0, -1.0)
    );
    return Directions[Face];
}

fn EvaluateNear(Cell: NearCell, Direction: vec3f) -> vec3f
{
    var Value = vec3f(0.0);
    var Weight = 0.0;
    for (var Face = 0u; Face < 6u; Face = Face + 1u)
    {
        let FaceWeight = max(dot(FaceDirection(Face), Direction), 0.0);
        Value = Value + Cell.Faces[Face].rgb * FaceWeight;
        Weight = Weight + FaceWeight;
    }
    return Value / max(Weight, 0.0001);
}

fn SampleNearCascade(Position: vec3f, Normal: vec3f) -> vec3f
{
    let OriginCell = Frame.CascadeOrigin0;
    let SamplePosition = Position + Normal * min(OriginCell.w * 0.48, 0.36);
    let Grid = (SamplePosition - OriginCell.xyz) / OriginCell.w - vec3f(0.5);
    let Base = vec3i(floor(Grid));
    let Fraction = fract(Grid);
    if (any(Base < vec3i(0)) || any(Base >= vec3i(47))) { return vec3f(0.0); }
    var Value = vec3f(0.0);
    for (var Z = 0; Z <= 1; Z = Z + 1)
    {
        for (var Y = 0; Y <= 1; Y = Y + 1)
        {
            for (var X = 0; X <= 1; X = X + 1)
            {
                let Offset = vec3i(X, Y, Z);
                let WeightX = select(1.0 - Fraction.x, Fraction.x, X == 1);
                let WeightY = select(1.0 - Fraction.y, Fraction.y, Y == 1);
                let WeightZ = select(1.0 - Fraction.z, Fraction.z, Z == 1);
                Value = Value + EvaluateNear(NearRadianceVolume.Cells[CellNumber(Base + Offset, 0u)], -Normal)
                    * (WeightX * WeightY * WeightZ);
            }
        }
    }
    return Value;
}

fn SampleCascade(Position: vec3f, Normal: vec3f, Cascade: u32) -> vec3f
{
    let OriginCell = CascadeOrigin(Cascade);
    let SamplePosition = Position + Normal * min(OriginCell.w * 0.48, 0.36);
    let Grid = (SamplePosition - OriginCell.xyz) / OriginCell.w - vec3f(0.5);
    let Base = vec3i(floor(Grid));
    let Fraction = fract(Grid);
    if (any(Base < vec3i(0)) || any(Base >= vec3i(47))) { return vec3f(0.0); }

    var Red = vec4f(0.0);
    var Green = vec4f(0.0);
    var Blue = vec4f(0.0);
    for (var Z = 0; Z <= 1; Z = Z + 1)
    {
        for (var Y = 0; Y <= 1; Y = Y + 1)
        {
            for (var X = 0; X <= 1; X = X + 1)
            {
                let Offset = vec3i(X, Y, Z);
                let WeightX = select(1.0 - Fraction.x, Fraction.x, X == 1);
                let WeightY = select(1.0 - Fraction.y, Fraction.y, Y == 1);
                let WeightZ = select(1.0 - Fraction.z, Fraction.z, Z == 1);
                let Weight = WeightX * WeightY * WeightZ;
                let Cell = RadianceVolume.Cells[CellNumber(Base + Offset, Cascade)];
                Red = Red + Cell.Red * Weight;
                Green = Green + Cell.Green * Weight;
                Blue = Blue + Cell.Blue * Weight;
            }
        }
    }
    let IncomingDirection = -Normal;
    return vec3f(
        Evaluate(Red, IncomingDirection),
        Evaluate(Green, IncomingDirection),
        Evaluate(Blue, IncomingDirection)
    );
}

fn SampleLPV(Position: vec3f, Normal: vec3f) -> vec4f
{
    let NearEdge = CascadeEdge(Position, 0u);
    if (NearEdge > 0.0)
    {
        let NearValue = SampleNearCascade(Position, Normal);
        let MiddleValue = SampleCascade(Position, Normal, 1u);
        let NearWeight = smoothstep(0.45, 2.5, NearEdge);
        return vec4f(mix(MiddleValue, NearValue, NearWeight), 0.0);
    }
    let MiddleEdge = CascadeEdge(Position, 1u);
    if (MiddleEdge > 0.0)
    {
        let MiddleValue = SampleCascade(Position, Normal, 1u);
        let FarValue = SampleCascade(Position, Normal, 2u);
        let MiddleWeight = smoothstep(0.45, 2.5, MiddleEdge);
        return vec4f(mix(FarValue, MiddleValue, MiddleWeight), 1.0);
    }
    if (CascadeEdge(Position, 2u) > 0.0)
    {
        return vec4f(SampleCascade(Position, Normal, 2u), 2.0);
    }
    return vec4f(0.0, 0.0, 0.0, 3.0);
}

fn BlockerChannels(Blocker: PackedBlocker) -> array<f32, 6>
{
    return array<f32, 6>(
        f32(Blocker.Low & 255u) * (1.0 / 255.0),
        f32((Blocker.Low >> 8u) & 255u) * (1.0 / 255.0),
        f32((Blocker.Low >> 16u) & 255u) * (1.0 / 255.0),
        f32((Blocker.Low >> 24u) & 255u) * (1.0 / 255.0),
        f32(Blocker.High & 255u) * (1.0 / 255.0),
        f32((Blocker.High >> 8u) & 255u) * (1.0 / 255.0)
    );
}

fn SampleBlocker(Position: vec3f, Cascade: u32) -> vec4f
{
    let OriginCell = CascadeOrigin(Cascade);
    var Blocker: PackedBlocker;
    if (Cascade == 0u)
    {
        let NearResolution = 80u;
        let NearCellSize = OriginCell.w * f32(VolumeResolution) / f32(NearResolution);
        let Coordinate = vec3i(floor((Position - OriginCell.xyz) / NearCellSize));
        if (any(Coordinate < vec3i(0)) || any(Coordinate >= vec3i(80))) { return vec4f(0.0); }
        let Index = u32(Coordinate.x) + u32(Coordinate.y) * NearResolution
            + u32(Coordinate.z) * NearResolution * NearResolution;
        Blocker = NearBlockerVolume.Cells[Index];
    }
    else
    {
        let Coordinate = vec3i(floor((Position - OriginCell.xyz) / OriginCell.w));
        if (any(Coordinate < vec3i(0)) || any(Coordinate >= vec3i(48))) { return vec4f(0.0); }
        let Local = u32(Coordinate.x) + u32(Coordinate.y) * VolumeResolution
            + u32(Coordinate.z) * VolumeResolution * VolumeResolution;
        Blocker = FarBlockerVolume.Cells[(Cascade - 1u) * CellsPerCascade + Local];
    }
    let Channels = BlockerChannels(Blocker);
    let Axes = vec3f(max(Channels[0], Channels[1]), max(Channels[2], Channels[3]), max(Channels[4], Channels[5]));
    return vec4f(Axes, max(Axes.x, max(Axes.y, Axes.z)));
}

fn SkyRadiance(Direction: vec3f) -> vec3f
{
    let Zenith = clamp(Direction.z * 0.5 + 0.5, 0.0, 1.0);
    let HorizonColour = vec3f(0.18, 0.26, 0.29) * (0.45 + Frame.SunColourTime.xyz * 0.10);
    let ZenithColour = vec3f(0.025, 0.075, 0.12) + Frame.SunColourTime.xyz * 0.035;
    return mix(HorizonColour, ZenithColour, Zenith);
}

fn ShadowProjection(Cascade: u32) -> mat4x4f
{
    if (Cascade == 0u) { return Frame.ShadowProjection0; }
    if (Cascade == 1u) { return Frame.ShadowProjection1; }
    return Frame.ShadowProjection2;
}

fn CascadeVisibility(Position: vec3f, Normal: vec3f, Cascade: u32) -> f32
{
    let ReceiverPosition = Position + Normal * 0.006 + Frame.SunDirectionIntensity.xyz * 0.008;
    let Clip = ShadowProjection(Cascade) * vec4f(ReceiverPosition, 1.0);
    let Ndc = Clip.xyz / max(Clip.w, 0.0001);
    let Uv = vec2f(Ndc.x * 0.5 + 0.5, 0.5 - Ndc.y * 0.5);
    if (any(Uv <= vec2f(0.0)) || any(Uv >= vec2f(1.0)) || Ndc.z <= 0.0 || Ndc.z >= 1.0)
    {
        return 1.0;
    }
    var Extent = textureDimensions(CsmNear);
    if (Cascade == 1u) { Extent = textureDimensions(CsmMiddle); }
    if (Cascade == 2u) { Extent = textureDimensions(CsmFar); }
    let Texel = 1.0 / vec2f(Extent);
    // CSM depth spans are much larger than the former RSM span; a millidepth bias
    // erases contact shadows. Keep this below roughly one near-cascade texel in depth.
    let Bias = 0.00010 + 0.00038 * (1.0 - max(dot(Normal, Frame.SunDirectionIntensity.xyz), 0.0));
    let FilterRadius = i32(clamp(Frame.Settings.w, 1.0, 2.0));
    var Visibility = 0.0;
    var Weight = 0.0;
    for (var Y = -2; Y <= 2; Y = Y + 1)
    {
        for (var X = -2; X <= 2; X = X + 1)
        {
            if (abs(X) > FilterRadius || abs(Y) > FilterRadius) { continue; }
            let SampleUv = Uv + vec2f(f32(X), f32(Y)) * Texel;
            var Tap = 0.0;
            if (Cascade == 0u)
            {
                Tap = textureSampleCompareLevel(CsmNear, ShadowComparison, SampleUv, Ndc.z - Bias);
            }
            else if (Cascade == 1u)
            {
                Tap = textureSampleCompareLevel(CsmMiddle, ShadowComparison, SampleUv, Ndc.z - Bias);
            }
            else
            {
                Tap = textureSampleCompareLevel(CsmFar, ShadowComparison, SampleUv, Ndc.z - Bias);
            }
            Visibility = Visibility + Tap;
            Weight = Weight + 1.0;
        }
    }
    let Filtered = Visibility / max(Weight, 1.0);
    return smoothstep(0.08, 0.92, Filtered);
}

fn SunVisibility(Position: vec3f, Normal: vec3f) -> f32
{
    let ViewDepth = max(dot(Position - Frame.CameraPosition.xyz, Frame.CameraForwardTan.xyz), 0.0);
    let NearBlendWidth = 1.25;
    let FarBlendWidth = 3.0;
    if (ViewDepth < Frame.ShadowSplits.x - NearBlendWidth)
    {
        return CascadeVisibility(Position, Normal, 0u);
    }
    if (ViewDepth < Frame.ShadowSplits.x + NearBlendWidth)
    {
        let Blend = smoothstep(
            Frame.ShadowSplits.x - NearBlendWidth,
            Frame.ShadowSplits.x + NearBlendWidth,
            ViewDepth
        );
        return mix(
            CascadeVisibility(Position, Normal, 0u),
            CascadeVisibility(Position, Normal, 1u),
            Blend
        );
    }
    if (ViewDepth < Frame.ShadowSplits.y - FarBlendWidth)
    {
        return CascadeVisibility(Position, Normal, 1u);
    }
    if (ViewDepth < Frame.ShadowSplits.y + FarBlendWidth)
    {
        let Blend = smoothstep(
            Frame.ShadowSplits.y - FarBlendWidth,
            Frame.ShadowSplits.y + FarBlendWidth,
            ViewDepth
        );
        return mix(
            CascadeVisibility(Position, Normal, 1u),
            CascadeVisibility(Position, Normal, 2u),
            Blend
        );
    }
    return CascadeVisibility(Position, Normal, 2u);
}

fn Fresnel(SpecularZero: vec3f, Cosine: f32) -> vec3f
{
    let Remainder = clamp(1.0 - Cosine, 0.0, 1.0);
    let Squared = Remainder * Remainder;
    return SpecularZero + (vec3f(1.0) - SpecularZero) * Squared * Squared * Remainder;
}

fn DisplayTransform(LinearColour: vec3f) -> vec3f
{
    let Exposed = max(LinearColour * Frame.Counts.w, vec3f(0.0));
    let Numerator = Exposed * (2.51 * Exposed + vec3f(0.03));
    let Denominator = Exposed * (2.43 * Exposed + vec3f(0.59)) + vec3f(0.14);
    return pow(clamp(Numerator / Denominator, vec3f(0.0), vec3f(1.0)), vec3f(1.0 / 2.2));
}

@vertex
fn FullscreenVertex(@builtin(vertex_index) VertexNumber: u32) -> FullscreenVarying
{
    let Position = array<vec2f, 3>(
        vec2f(-1.0, -1.0),
        vec2f(3.0, -1.0),
        vec2f(-1.0, 3.0)
    );
    var Result: FullscreenVarying;
    Result.ClipPosition = vec4f(Position[VertexNumber], 0.0, 1.0);
    Result.TexturePosition = Position[VertexNumber] * vec2f(0.5, -0.5) + vec2f(0.5);
    return Result;
}

@fragment
fn PresentFragment(Input: FullscreenVarying) -> @location(0) vec4f
{
    let RequestedMode = u32(Frame.Settings.x + 0.5);
    var LocalUv = Input.TexturePosition;
    var Mode = RequestedMode;
    if (RequestedMode == 0u)
    {
        let Panel = vec2u(min(vec2u(LocalUv * 2.0), vec2u(1u)));
        LocalUv = fract(LocalUv * 2.0);
        if (Panel.y == 0u && Panel.x == 0u) { Mode = 2u; }
        if (Panel.y == 0u && Panel.x == 1u) { Mode = 3u; }
        if (Panel.y == 1u && Panel.x == 0u) { Mode = 4u; }
        if (Panel.y == 1u && Panel.x == 1u) { Mode = 1u; }
    }

    let ImageExtent = textureDimensions(PositionImage);
    let Pixel = vec2i(clamp(LocalUv * vec2f(ImageExtent), vec2f(0.0), vec2f(ImageExtent) - vec2f(1.0)));
    let PositionHit = textureLoad(PositionImage, Pixel, 0);
    let ScreenPosition = LocalUv * 2.0 - vec2f(1.0);
    let ViewDirection = normalize(
        Frame.CameraForwardTan.xyz
        + Frame.CameraRightAspect.xyz * (ScreenPosition.x * Frame.CameraForwardTan.w * Frame.CameraRightAspect.w)
        - Frame.CameraUpGain.xyz * (ScreenPosition.y * Frame.CameraForwardTan.w)
    );

    var LinearColour = select(SkyRadiance(ViewDirection), vec3f(0.002), Mode == 8u);
    if (PositionHit.w > 0.5)
    {
        let NormalRoughness = textureLoad(NormalImage, Pixel, 0);
        let AlbedoMetalness = textureLoad(AlbedoImage, Pixel, 0);
        let Position = PositionHit.xyz;
        let Normal = normalize(NormalRoughness.xyz);
        let Roughness = NormalRoughness.w;
        let Albedo = AlbedoMetalness.xyz;
        let Metalness = AlbedoMetalness.w;
        let EmissiveStrength = max(PositionHit.w - 1.0, 0.0);
        let Emissive = Albedo * EmissiveStrength;
        let DiffuseColour = Albedo * (1.0 - Metalness);
        let View = normalize(Frame.CameraPosition.xyz - Position);
        let SunFacing = max(dot(Normal, Frame.SunDirectionIntensity.xyz), 0.0);
        let Visibility = SunVisibility(Position, Normal);
        let DirectDiffuse = DiffuseColour * InversePi * Frame.SunColourTime.xyz
            * (SunFacing * Visibility * Frame.SunDirectionIntensity.w);
        let GtaoSample = textureSampleLevel(GtaoTexture, LinearSampler, LocalUv, 0.0);
        let AmbientVisibility = select(1.0, GtaoSample.w, Frame.Settings.z > 0.5);
        let Ambient = DiffuseColour * SkyRadiance(Normal) * (0.22 * AmbientVisibility);
        let LPVSample = SampleLPV(Position, Normal);
        let LPVIndirect = DiffuseColour * InversePi * LPVSample.xyz
            * Frame.CameraUpGain.w * 0.62;

        let ReflectionDirection = reflect(-View, Normal);
        let ReflectedSky = mix(SkyRadiance(ReflectionDirection), SkyRadiance(Normal), Roughness * Roughness * 0.72);
        let SpecularZero = mix(vec3f(0.04), Albedo, Metalness);
        let ReflectionWeight = Fresnel(SpecularZero, max(dot(Normal, View), 0.0));
        let Specular = ReflectedSky * ReflectionWeight * (1.0 - Roughness * 0.46);

        if (Mode == 2u)
        {
            LinearColour = DirectDiffuse + Ambient + Specular + Emissive;
        }
        else if (Mode == 3u)
        {
            LinearColour = LPVIndirect * 1.42 + vec3f(0.006);
        }
        else if (Mode == 4u)
        {
            // GTAO is retained only as an ambient-visibility term: white is open,
            // dark is occluded. No screen-space colour is interpreted as GI.
            LinearColour = vec3f(0.01 + AmbientVisibility * 0.72);
        }
        else if (Mode == 7u)
        {
            // White is sun-visible and black is shadowed; this bypasses GI so CSM
            // coverage and PCF can be inspected without indirect-light fill.
            LinearColour = vec3f(0.015 + Visibility * 0.82);
        }
        else if (Mode == 8u)
        {
            // LPVExtract injects zero solar radiance here. Only self-emission and
            // the persistent local-space emitter surfels can remain.
            LinearColour = Emissive + LPVIndirect * 1.35;
        }
        else if (Mode == 5u)
        {
            let Tints = array<vec3f, 4>(
                vec3f(0.18, 1.0, 0.55),
                vec3f(0.20, 0.62, 1.0),
                vec3f(1.0, 0.55, 0.18),
                vec3f(0.24)
            );
            LinearColour = (DirectDiffuse + Ambient + LPVIndirect + Specular + Emissive) * 0.62
                + Tints[u32(LPVSample.w + 0.5)] * 0.18;
        }
        else if (Mode == 6u)
        {
            let Cascade = min(u32(LPVSample.w + 0.5), 2u);
            let Blocker = SampleBlocker(Position, Cascade);
            LinearColour = mix(vec3f(0.015, 0.025, 0.023), abs(Blocker.xyz) * 0.7 + vec3f(0.25, 0.08, 0.03), Blocker.w);
        }
        else
        {
            LinearColour = DirectDiffuse + Ambient + LPVIndirect + Specular + Emissive;
        }
    }

    var DisplayColour = DisplayTransform(LinearColour);
    if (RequestedMode == 0u)
    {
        let Divider = min(abs(Input.TexturePosition.x - 0.5), abs(Input.TexturePosition.y - 0.5));
        if (Divider < 0.0014) { DisplayColour = vec3f(0.035, 0.05, 0.047); }
    }
    return vec4f(DisplayColour, 1.0);
}
