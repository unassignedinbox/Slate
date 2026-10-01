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
    let Mixed = (Shifted.x * 73856093u)
              ^ (Shifted.y * 19349663u)
              ^ (Shifted.z * 83492791u);
    return Mixed % max(u32(Presentation.Counts.y), 1u);
}

fn GatherIrradiance(Position: vec3f, Normal: vec3f) -> vec3f
{
    let CellSize = Presentation.Counts.z;
    let Cell = vec3i(floor(Position / CellSize));
    let HashCount = i32(Presentation.Counts.y);
    var Irradiance = vec3f(0.0);
    var WeightSum = 0.0;

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
                    let Radius = Record.PositionRadius.w;
                    let NormalWeight = dot(Normal, Record.NormalArea.xyz);
                    let PlanarDistance = abs(dot(Delta, Record.NormalArea.xyz));
                    if (Distance < Radius && NormalWeight > 0.15 && PlanarDistance < Radius * 0.38)
                    {
                        let LinearWeight = 1.0 - Distance / Radius;
                        let Weight = NormalWeight * LinearWeight * LinearWeight;
                        Irradiance = Irradiance + Record.IrradianceAge.xyz * Weight;
                        WeightSum = WeightSum + Weight;
                    }
                    RecordNumber = CellLinks.Entries[HashCount + RecordNumber] - 1;
                    Guard = Guard + 1;
                }
            }
        }
    }

    if (WeightSum > 0.00001)
    {
        return Irradiance / WeightSum;
    }
    return vec3f(0.0);
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
    return textureSampleCompare(ShadowImage, ShadowComparison, TexturePosition, LightNdc.z - Bias);
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
