// Fixed-point scatter injection for transient surfels and rasterized geometry blockers.

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

struct AtomicExtent
{
    Entries: array<atomic<i32>>,
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

struct VectorExtent
{
    Cells: array<vec4f>,
};

@group(0) @binding(0) var<uniform> Frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> Surfels: SurfelExtent;
@group(0) @binding(2) var<storage, read_write> Accumulation: AtomicExtent;
@group(0) @binding(3) var PositionImage: texture_2d<f32>;
@group(0) @binding(4) var NormalImage: texture_2d<f32>;
@group(0) @binding(5) var<storage, read_write> InjectionVolume: VolumeExtent;
@group(0) @binding(6) var<storage, read_write> BlockerVolume: VectorExtent;
@group(0) @binding(7) var<storage, read_write> InitialPropagation: VolumeExtent;
@group(0) @binding(8) var AlbedoImage: texture_2d<f32>;
@group(0) @binding(9) var RsmDepth: texture_depth_2d;

const VolumeResolution: u32 = 32u;
const CellsPerCascade: u32 = 32768u;
const AtomicStride: u32 = 17u;
const FixedScale: f32 = 1024.0;

fn CascadeOrigin(Cascade: u32) -> vec4f
{
    if (Cascade == 0u) { return Frame.CascadeOrigin0; }
    if (Cascade == 1u) { return Frame.CascadeOrigin1; }
    return Frame.CascadeOrigin2;
}

fn LocateCell(Position: vec3f, Cascade: u32) -> vec4i
{
    let OriginCell = CascadeOrigin(Cascade);
    let Coordinate = vec3i(floor((Position - OriginCell.xyz) / OriginCell.w));
    let Valid = all(Coordinate >= vec3i(0)) && all(Coordinate < vec3i(i32(VolumeResolution)));
    return vec4i(Coordinate, select(0, 1, Valid));
}

fn CellNumber(Coordinate: vec3i, Cascade: u32) -> u32
{
    return Cascade * CellsPerCascade
        + u32(Coordinate.x)
        + u32(Coordinate.y) * VolumeResolution
        + u32(Coordinate.z) * VolumeResolution * VolumeResolution;
}

fn AddFixed(Address: u32, Value: f32)
{
    let Encoded = i32(round(clamp(Value, -32.0, 32.0) * FixedScale));
    atomicAdd(&Accumulation.Entries[Address], Encoded);
}

fn InjectBlocker(Position: vec3f, Normal: vec3f)
{
    for (var Cascade = 0u; Cascade < 3u; Cascade = Cascade + 1u)
    {
        let Located = LocateCell(Position, Cascade);
        if (Located.w == 0) { continue; }
        let Base = CellNumber(Located.xyz, Cascade) * AtomicStride;
        AddFixed(Base + 12u, Normal.x);
        AddFixed(Base + 13u, Normal.y);
        AddFixed(Base + 14u, Normal.z);
        atomicAdd(&Accumulation.Entries[Base + 15u], 1);
    }
}

@compute @workgroup_size(64)
fn InjectSurfels(@builtin(global_invocation_id) Global: vec3u)
{
    let RecordNumber = Global.x;
    let RecordCount = u32(Frame.Counts.y + 0.5);
    if (RecordNumber >= RecordCount) { return; }
    let Record = Surfels.Records[RecordNumber];
    if (Record.NormalValid.w < 0.5) { return; }

    let Position = Record.PositionRadius.xyz;
    let Normal = normalize(Record.NormalValid.xyz);
    let Radiance = max(Record.RadianceFrame.xyz, vec3f(0.0));
    let Red = vec4f(Radiance.r * 0.45, Radiance.r * Normal * 0.55);
    let Green = vec4f(Radiance.g * 0.45, Radiance.g * Normal * 0.55);
    let Blue = vec4f(Radiance.b * 0.45, Radiance.b * Normal * 0.55);

    for (var Cascade = 0u; Cascade < 3u; Cascade = Cascade + 1u)
    {
        let Located = LocateCell(Position, Cascade);
        if (Located.w == 0) { continue; }
        let Base = CellNumber(Located.xyz, Cascade) * AtomicStride;
        AddFixed(Base + 0u, Red.x);
        AddFixed(Base + 1u, Red.y);
        AddFixed(Base + 2u, Red.z);
        AddFixed(Base + 3u, Red.w);
        AddFixed(Base + 4u, Green.x);
        AddFixed(Base + 5u, Green.y);
        AddFixed(Base + 6u, Green.z);
        AddFixed(Base + 7u, Green.w);
        AddFixed(Base + 8u, Blue.x);
        AddFixed(Base + 9u, Blue.y);
        AddFixed(Base + 10u, Blue.z);
        AddFixed(Base + 11u, Blue.w);
        AddFixed(Base + 12u, Normal.x);
        AddFixed(Base + 13u, Normal.y);
        AddFixed(Base + 14u, Normal.z);
        atomicAdd(&Accumulation.Entries[Base + 15u], 1);
        atomicAdd(&Accumulation.Entries[Base + 16u], 1);
    }
}

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
    return select(0.0, 1.0, Ndc.z - 0.0022 <= StoredDepth);
}

@compute @workgroup_size(8, 8)
fn InjectCameraBlockers(@builtin(global_invocation_id) Global: vec3u)
{
    let Pixel = vec2i(Global.xy * 4u + vec2u(2u));
    let Extent = textureDimensions(PositionImage);
    if (Pixel.x >= i32(Extent.x) || Pixel.y >= i32(Extent.y)) { return; }
    let PositionHit = textureLoad(PositionImage, Pixel, 0);
    if (PositionHit.w < 0.5) { return; }
    let Position = PositionHit.xyz;
    let Normal = normalize(textureLoad(NormalImage, Pixel, 0).xyz);
    InjectBlocker(Position, Normal);

    let SunFacing = max(dot(Normal, Frame.SunDirectionIntensity.xyz), 0.0);
    let Visibility = SunVisibility(Position, Normal);
    if (SunFacing * Visibility <= 0.001) { return; }
    let AlbedoMetalness = textureLoad(AlbedoImage, Pixel, 0);
    let DiffuseAlbedo = AlbedoMetalness.xyz * (1.0 - AlbedoMetalness.w * 0.88);
    let Radiance = DiffuseAlbedo * Frame.SunColourTime.xyz
        * (SunFacing * Visibility * Frame.SunDirectionIntensity.w * 0.78);
    let Red = vec4f(Radiance.r * 0.45, Radiance.r * Normal * 0.55);
    let Green = vec4f(Radiance.g * 0.45, Radiance.g * Normal * 0.55);
    let Blue = vec4f(Radiance.b * 0.45, Radiance.b * Normal * 0.55);

    for (var Cascade = 0u; Cascade < 3u; Cascade = Cascade + 1u)
    {
        let Located = LocateCell(Position, Cascade);
        if (Located.w == 0) { continue; }
        let Base = CellNumber(Located.xyz, Cascade) * AtomicStride;
        AddFixed(Base + 0u, Red.x);
        AddFixed(Base + 1u, Red.y);
        AddFixed(Base + 2u, Red.z);
        AddFixed(Base + 3u, Red.w);
        AddFixed(Base + 4u, Green.x);
        AddFixed(Base + 5u, Green.y);
        AddFixed(Base + 6u, Green.z);
        AddFixed(Base + 7u, Green.w);
        AddFixed(Base + 8u, Blue.x);
        AddFixed(Base + 9u, Blue.y);
        AddFixed(Base + 10u, Blue.z);
        AddFixed(Base + 11u, Blue.w);
        atomicAdd(&Accumulation.Entries[Base + 16u], 1);
    }
}

fn ExchangeFixed(Address: u32) -> f32
{
    return f32(atomicExchange(&Accumulation.Entries[Address], 0)) / FixedScale;
}

@compute @workgroup_size(64)
fn NormalizeMain(@builtin(global_invocation_id) Global: vec3u)
{
    let Cell = Global.x;
    if (Cell >= CellsPerCascade * 3u) { return; }
    let Base = Cell * AtomicStride;

    var Red = vec4f(0.0);
    var Green = vec4f(0.0);
    var Blue = vec4f(0.0);
    Red.x = ExchangeFixed(Base + 0u);
    Red.y = ExchangeFixed(Base + 1u);
    Red.z = ExchangeFixed(Base + 2u);
    Red.w = ExchangeFixed(Base + 3u);
    Green.x = ExchangeFixed(Base + 4u);
    Green.y = ExchangeFixed(Base + 5u);
    Green.z = ExchangeFixed(Base + 6u);
    Green.w = ExchangeFixed(Base + 7u);
    Blue.x = ExchangeFixed(Base + 8u);
    Blue.y = ExchangeFixed(Base + 9u);
    Blue.z = ExchangeFixed(Base + 10u);
    Blue.w = ExchangeFixed(Base + 11u);
    let BlockerNormalSum = vec3f(
        ExchangeFixed(Base + 12u),
        ExchangeFixed(Base + 13u),
        ExchangeFixed(Base + 14u)
    );
    let BlockerCount = f32(atomicExchange(&Accumulation.Entries[Base + 15u], 0));
    let RadianceCount = f32(atomicExchange(&Accumulation.Entries[Base + 16u], 0));

    if (RadianceCount > 0.0)
    {
        let InverseCount = 1.0 / RadianceCount;
        Red = Red * InverseCount;
        Green = Green * InverseCount;
        Blue = Blue * InverseCount;
    }
    let CellValue = VolumeCell(Red, Green, Blue);
    InjectionVolume.Cells[Cell] = CellValue;
    InitialPropagation.Cells[Cell] = CellValue;

    var BlockerNormal = vec3f(0.0, 0.0, 1.0);
    if (dot(BlockerNormalSum, BlockerNormalSum) > 0.00001)
    {
        BlockerNormal = normalize(BlockerNormalSum);
    }
    let Opacity = clamp(BlockerCount * 0.19, 0.0, 1.0);
    BlockerVolume.Cells[Cell] = vec4f(BlockerNormal, Opacity);
}
