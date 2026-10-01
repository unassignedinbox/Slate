//============================================================================================================================================
//                                                            SURFELPRESENT.WGSL                                                            //
//============================================================================================================================================
// 📦 Bilateral surfel gather, sun visibility, sky reflection and display transform for the resolved browser image.

struct SurfelRecord
{
    PositionRadius: vec4f,
    NormalArea: vec4f,
    AlbedoIdentity: vec4f,
    IrradianceAge: vec4f,
    ShortMeanVariance: vec4f,
};

struct PresentationUniforms
{
    LightProjection: mat4x4f,
    CameraPosition: vec4f,
    CameraForwardTan: vec4f,
    CameraRightAspect: vec4f,
    CameraUpGain: vec4f,
    SunDirectionIntensity: vec4f,
    SunColourIndirect: vec4f,
    SkyHorizon: vec4f,
    SkyZenith: vec4f,
    Counts: vec4f,
};

struct SurfelExtent
{
    Records: array<SurfelRecord>,
};

struct IntegerExtent
{
    Entries: array<i32>,
};

struct FullscreenVarying
{
    @builtin(position) ClipPosition: vec4f,
    @location(0) TexturePosition: vec2f,
};

@group(0) @binding(0) var<uniform> Presentation: PresentationUniforms;
@group(0) @binding(1) var PositionImage: texture_2d<f32>;
@group(0) @binding(2) var NormalImage: texture_2d<f32>;
@group(0) @binding(3) var AlbedoImage: texture_2d<f32>;
@group(0) @binding(4) var ShadowImage: texture_depth_2d;
@group(0) @binding(5) var ShadowComparison: sampler_comparison;
@group(0) @binding(6) var<storage, read> PublishedField: SurfelExtent;
@group(0) @binding(7) var<storage, read> CellLinks: IntegerExtent;

const InversePi: f32 = 0.3183098861837907;

fn SkyRadiance(Direction: vec3f) -> vec3f
{
    let ZenithWeight = clamp(Direction.z * 0.5 + 0.5, 0.0, 1.0);
    let Horizon = Presentation.SkyHorizon.xyz;
    let Zenith = Presentation.SkyZenith.xyz;
    return mix(Horizon, Zenith, ZenithWeight);
}

fn CellHash(Cell: vec3i) -> u32
{
    let Shifted = vec3u(Cell + vec3i(2048));
    let HashedX = Shifted.x * 73856093u;
    let HashedY = Shifted.y * 19349663u;
    let HashedZ = Shifted.z * 83492791u;
    let Mixed = HashedX ^ HashedY ^ HashedZ;
    return Mixed % max(u32(Presentation.Counts.y), 1u);
}

fn GatherIrradiance(Position: vec3f, Normal: vec3f) -> vec3f
{
    let CellSize = Presentation.Counts.z;
    let Cell = vec3i(floor(Position / CellSize));
    let HashCount = i32(Presentation.Counts.y);
    let ReconstructionMode = u32(Presentation.SkyHorizon.w + 0.5);
    let UseLeakGuard = Presentation.SkyZenith.w > 0.5;
    let Reference = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(Normal.z) < 0.9);
    let Tangent = normalize(cross(Reference, Normal));
    let Bitangent = cross(Normal, Tangent);

    var Irradiance = vec3f(0.0);
    var WeightSum = 0.0;
    var XMoment = 0.0;
    var YMoment = 0.0;
    var XXMoment = 0.0;
    var XYMoment = 0.0;
    var YYMoment = 0.0;
    var IrradianceX = vec3f(0.0);
    var IrradianceY = vec3f(0.0);
    var MinimumIrradiance = vec3f(1.0e20);
    var MaximumIrradiance = vec3f(0.0);
    var RadiusMoment = 0.0;
    var NearestDistance = 1.0e20;
    var NearestIrradiance = vec3f(0.0);

    for (var OffsetZ = -1; OffsetZ <= 1; OffsetZ = OffsetZ + 1)
    {
        for (var OffsetY = -1; OffsetY <= 1; OffsetY = OffsetY + 1)
        {
            for (var OffsetX = -1; OffsetX <= 1; OffsetX = OffsetX + 1)
            {
                let CellNumber = i32(CellHash(Cell + vec3i(OffsetX, OffsetY, OffsetZ)));
                var RecordNumber = CellLinks.Entries[CellNumber] - 1;
                var Guard = 0;
                while (RecordNumber >= 0 && Guard < 96)
                {
                    let Record = PublishedField.Records[RecordNumber];
                    let Delta = Position - Record.PositionRadius.xyz;
                    let Distance = length(Delta);
                    let Radius = Record.PositionRadius.w * Presentation.CameraPosition.w;
                    let NormalWeight = dot(Normal, Record.NormalArea.xyz);
                    let SourcePlaneDistance = abs(dot(Delta, Record.NormalArea.xyz));
                    let ReceiverPlaneDistance = abs(dot(Delta, Normal));
                    if (
                        NormalWeight > 0.25
                        && SourcePlaneDistance < Radius * 0.45
                        && ReceiverPlaneDistance < Radius * 0.45
                        && Distance < NearestDistance
                    )
                    {
                        NearestDistance = Distance;
                        NearestIrradiance = Record.IrradianceAge.xyz;
                    }

                    var Weight = 0.0;
                    if (ReconstructionMode == 0u)
                    {
                        let ReceiverValid = !UseLeakGuard || ReceiverPlaneDistance < Radius * 0.30;
                        if (
                            Distance < Radius
                            && NormalWeight > 0.15
                            && SourcePlaneDistance < Radius * 0.38
                            && ReceiverValid
                        )
                        {
                            let LinearWeight = 1.0 - Distance / Radius;
                            Weight = NormalWeight * LinearWeight * LinearWeight;
                        }
                    }
                    else
                    {
                        let ReceiverValid = !UseLeakGuard || ReceiverPlaneDistance < Radius * 0.24;
                        if (
                            Distance < Radius
                            && NormalWeight > 0.35
                            && SourcePlaneDistance < Radius * 0.30
                            && ReceiverValid
                        )
                        {
                            let NormalisedDistance = Distance / Radius;
                            let Remainder = max(1.0 - NormalisedDistance, 0.0);
                            let CompactWeight = Remainder * Remainder * Remainder * Remainder
                                * (1.0 + 4.0 * NormalisedDistance);
                            let SquaredNormalWeight = NormalWeight * NormalWeight;
                            Weight = CompactWeight * SquaredNormalWeight * SquaredNormalWeight;
                        }
                    }

                    if (Weight > 0.0)
                    {
                        let SampleOffset = Record.PositionRadius.xyz - Position;
                        let X = dot(SampleOffset, Tangent);
                        let Y = dot(SampleOffset, Bitangent);
                        let SampleIrradiance = Record.IrradianceAge.xyz;
                        Irradiance = Irradiance + SampleIrradiance * Weight;
                        WeightSum = WeightSum + Weight;
                        XMoment = XMoment + X * Weight;
                        YMoment = YMoment + Y * Weight;
                        XXMoment = XXMoment + X * X * Weight;
                        XYMoment = XYMoment + X * Y * Weight;
                        YYMoment = YYMoment + Y * Y * Weight;
                        IrradianceX = IrradianceX + SampleIrradiance * (X * Weight);
                        IrradianceY = IrradianceY + SampleIrradiance * (Y * Weight);
                        MinimumIrradiance = min(MinimumIrradiance, SampleIrradiance);
                        MaximumIrradiance = max(MaximumIrradiance, SampleIrradiance);
                        RadiusMoment = RadiusMoment + Radius * Weight;
                    }
                    RecordNumber = CellLinks.Entries[HashCount + RecordNumber] - 1;
                    Guard = Guard + 1;
                }
            }
        }
    }

    if (WeightSum <= 0.00001)
    {
        return select(vec3f(0.0), NearestIrradiance, NearestDistance < CellSize * 0.9);
    }
    let NormalisedAverage = Irradiance / WeightSum;
    if (ReconstructionMode != 2u)
    {
        return NormalisedAverage;
    }

    let AverageRadius = RadiusMoment / WeightSum;
    let Regularisation = WeightSum * AverageRadius * AverageRadius * 0.0125 + 1.0e-7;
    let A = WeightSum;
    let B = XMoment;
    let C = YMoment;
    let D = XXMoment + Regularisation;
    let E = XYMoment;
    let F = YYMoment + Regularisation;
    let CofactorZero = D * F - E * E;
    let CofactorOne = C * E - B * F;
    let CofactorTwo = B * E - C * D;
    let Determinant = A * CofactorZero + B * CofactorOne + C * CofactorTwo;
    if (abs(Determinant) <= 1.0e-9)
    {
        return NormalisedAverage;
    }
    let Reconstructed = (
        Irradiance * CofactorZero
        + IrradianceX * CofactorOne
        + IrradianceY * CofactorTwo
    ) / Determinant;
    return clamp(Reconstructed, MinimumIrradiance, MaximumIrradiance);
}

fn SunVisibility(Position: vec3f, Normal: vec3f) -> f32
{
    let LightClip = Presentation.LightProjection * vec4f(Position + Normal * 0.004, 1.0);
    let LightNdc = LightClip.xyz / LightClip.w;
    let TexturePosition = vec2f(LightNdc.x * 0.5 + 0.5, 0.5 - LightNdc.y * 0.5);
    if (
        TexturePosition.x <= 0.0
        || TexturePosition.x >= 1.0
        || TexturePosition.y <= 0.0
        || TexturePosition.y >= 1.0
        || LightNdc.z <= 0.0
        || LightNdc.z >= 1.0
    )
    {
        return 1.0;
    }
    let Bias = 0.0015 + 0.003 * (1.0 - max(dot(Normal, Presentation.SunDirectionIntensity.xyz), 0.0));
    return textureSampleCompareLevel(ShadowImage, ShadowComparison, TexturePosition, LightNdc.z - Bias);
}

fn Fresnel(SpecularZero: vec3f, Cosine: f32) -> vec3f
{
    let Remainder = clamp(1.0 - Cosine, 0.0, 1.0);
    let Squared = Remainder * Remainder;
    return SpecularZero + (vec3f(1.0) - SpecularZero) * Squared * Squared * Remainder;
}

fn DisplayTransform(LinearColour: vec3f) -> vec3f
{
    let Exposed = max(LinearColour * Presentation.Counts.w, vec3f(0.0));
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
        vec2f(-1.0, 3.0),
    );
    var Result: FullscreenVarying;
    Result.ClipPosition = vec4f(Position[VertexNumber], 0.0, 1.0);
    Result.TexturePosition = Position[VertexNumber] * vec2f(0.5, -0.5) + vec2f(0.5);
    return Result;
}

@fragment
fn PresentFragment(Input: FullscreenVarying) -> @location(0) vec4f
{
    let ImageExtent = textureDimensions(PositionImage);
    let ClampedPosition = clamp(Input.TexturePosition, vec2f(0.0), vec2f(0.999999));
    let Pixel = vec2i(ClampedPosition * vec2f(ImageExtent));
    let PositionHit = textureLoad(PositionImage, Pixel, 0);
    let ScreenPosition = Input.TexturePosition * 2.0 - vec2f(1.0);
    let ViewDirection = normalize(
        Presentation.CameraForwardTan.xyz
        + Presentation.CameraRightAspect.xyz
            * (ScreenPosition.x * Presentation.CameraForwardTan.w * Presentation.CameraRightAspect.w)
        - Presentation.CameraUpGain.xyz * (ScreenPosition.y * Presentation.CameraForwardTan.w)
    );

    if (PositionHit.w < 0.5)
    {
        return vec4f(DisplayTransform(SkyRadiance(ViewDirection)), 1.0);
    }

    let NormalRoughness = textureLoad(NormalImage, Pixel, 0);
    let AlbedoMetalness = textureLoad(AlbedoImage, Pixel, 0);
    let Position = PositionHit.xyz;
    let Normal = normalize(NormalRoughness.xyz);
    let Roughness = NormalRoughness.w;
    let Albedo = AlbedoMetalness.xyz;
    let Metalness = AlbedoMetalness.w;
    let View = normalize(Presentation.CameraPosition.xyz - Position);
    let SunFacing = max(dot(Normal, Presentation.SunDirectionIntensity.xyz), 0.0);
    let Visibility = SunVisibility(Position, Normal);
    let DiffuseColour = Albedo * (1.0 - Metalness);

    var LinearColour = DiffuseColour * InversePi
        * Presentation.SunColourIndirect.xyz
        * (SunFacing * Visibility * Presentation.SunDirectionIntensity.w);

    if (Presentation.SunColourIndirect.w > 0.5)
    {
        let Indirect = GatherIrradiance(Position, Normal) * Presentation.CameraUpGain.w;
        LinearColour = LinearColour + DiffuseColour * InversePi * Indirect;
    }

    let ReflectionDirection = reflect(-View, Normal);
    let ReflectedSky = mix(
        SkyRadiance(ReflectionDirection),
        Presentation.SkyHorizon.xyz,
        Roughness * Roughness * 0.72,
    );
    let SpecularZero = mix(vec3f(0.04), Albedo, Metalness);
    let ReflectionWeight = Fresnel(SpecularZero, max(dot(Normal, View), 0.0));
    LinearColour = LinearColour + ReflectedSky * ReflectionWeight * (1.0 - Roughness * 0.48);

    return vec4f(DisplayTransform(LinearColour), 1.0);
}
