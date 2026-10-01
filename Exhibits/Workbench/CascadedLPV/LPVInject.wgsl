// Stable per-cell surfel reservoirs, trilinear radiance splats, persistent history, and six-face blockers.

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
    MotionMin0: vec4f,
    MotionMax0: vec4f,
    MotionMin1: vec4f,
    MotionMax1: vec4f,
    MotionMin2: vec4f,
    MotionMax2: vec4f,
    MotionMin3: vec4f,
    MotionMax3: vec4f,
    MotionMin4: vec4f,
    MotionMax4: vec4f,
    MotionMin5: vec4f,
    MotionMax5: vec4f,
    MotionMin6: vec4f,
    MotionMax6: vec4f,
    MotionMin7: vec4f,
    MotionMax7: vec4f,
};

struct SurfelRecord
{
    PositionRadius: vec4f,
    NormalValid: vec4f,
    AlbedoFlux: vec4f,
    RadianceFrame: vec4f,
};
struct SurfelExtent { Records: array<SurfelRecord>, };
struct AtomicExtent { Entries: array<atomic<i32>>, };
struct ReservoirExtent { Entries: array<atomic<u32>>, };

struct VolumeCell
{
    Red: vec4f,
    Green: vec4f,
    Blue: vec4f,
};
struct VolumeExtent { Cells: array<VolumeCell>, };

struct BlockerCell
{
    Axis0: vec4f,
    Axis1: vec4f,
};
struct BlockerExtent { Cells: array<BlockerCell>, };

@group(0) @binding(0) var<uniform> Frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> Surfels: SurfelExtent;
@group(0) @binding(2) var<storage, read_write> Accumulation: AtomicExtent;
@group(0) @binding(3) var PositionImage: texture_2d<f32>;
@group(0) @binding(4) var NormalImage: texture_2d<f32>;
@group(0) @binding(5) var<storage, read_write> InjectionVolume: VolumeExtent;
@group(0) @binding(6) var<storage, read_write> RawBlockers: BlockerExtent;
@group(0) @binding(7) var<storage, read_write> InitialPropagation: VolumeExtent;
@group(0) @binding(8) var<storage, read_write> Reservoirs: ReservoirExtent;
@group(0) @binding(9) var<storage, read> HistoryVolume: VolumeExtent;
@group(0) @binding(10) var<storage, read_write> DilatedBlockers: BlockerExtent;

const VolumeResolution: u32 = 40u;
const CellsPerCascade: u32 = 64000u;
const AtomicStride: u32 = 19u;
const FixedScale: f32 = 1024.0;

fn Hash(Value: u32) -> u32
{
    var State = Value;
    State = State ^ (State >> 16u);
    State = State * 0x7feb352du;
    State = State ^ (State >> 15u);
    State = State * 0x846ca68bu;
    return State ^ (State >> 16u);
}

fn CascadeOrigin(Cascade: u32) -> vec4f
{
    if (Cascade == 0u) { return Frame.CascadeOrigin0; }
    if (Cascade == 1u) { return Frame.CascadeOrigin1; }
    return Frame.CascadeOrigin2;
}

fn PreviousCascadeOrigin(Cascade: u32) -> vec4f
{
    if (Cascade == 0u) { return Frame.PreviousCascadeOrigin0; }
    if (Cascade == 1u) { return Frame.PreviousCascadeOrigin1; }
    return Frame.PreviousCascadeOrigin2;
}

fn LocateCell(Position: vec3f, OriginCell: vec4f) -> vec4i
{
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

fn LocalCoordinate(Cell: u32) -> vec3i
{
    let Local = Cell % CellsPerCascade;
    let Z = Local / (VolumeResolution * VolumeResolution);
    let Remainder = Local - Z * VolumeResolution * VolumeResolution;
    let Y = Remainder / VolumeResolution;
    return vec3i(i32(Remainder - Y * VolumeResolution), i32(Y), i32(Z));
}

fn AddFixed(Address: u32, Value: f32)
{
    let Encoded = i32(round(clamp(Value, -32.0, 32.0) * FixedScale));
    atomicAdd(&Accumulation.Entries[Address], Encoded);
}

fn ExchangeFixed(Address: u32) -> f32
{
    return f32(atomicExchange(&Accumulation.Entries[Address], 0)) / FixedScale;
}

fn ReservoirKey(Identity: u32, Cascade: u32, RecordNumber: u32, Confidence: f32) -> u32
{
    let Quality = select(0u, 0x80000000u, Confidence > 0.8);
    let CascadeSalt = (Cascade + 1u) * 0x9e3779b9u;
    let MixedIdentity = Identity ^ CascadeSalt;
    let Priority = Quality | (Hash(MixedIdentity) & 0x7fff0000u);
    let StableTieBreak = 0xffffu - (RecordNumber & 0xffffu);
    return Priority | StableTieBreak;
}

fn InjectBlocker(Position: vec3f, Normal: vec3f)
{
    let Directional = array<f32, 6>(
        max(Normal.x, 0.0), max(-Normal.x, 0.0),
        max(Normal.y, 0.0), max(-Normal.y, 0.0),
        max(Normal.z, 0.0), max(-Normal.z, 0.0)
    );
    for (var Cascade = 0u; Cascade < 3u; Cascade = Cascade + 1u)
    {
        let Located = LocateCell(Position, CascadeOrigin(Cascade));
        if (Located.w == 0) { continue; }
        let Base = CellNumber(Located.xyz, Cascade) * AtomicStride;
        for (var Axis = 0u; Axis < 6u; Axis = Axis + 1u)
        {
            AddFixed(Base + 12u + Axis, Directional[Axis]);
        }
    }
}

@compute @workgroup_size(64)
fn ClaimSurfels(@builtin(global_invocation_id) Global: vec3u)
{
    let RecordNumber = Global.x;
    if (RecordNumber >= u32(Frame.Counts.y + 0.5)) { return; }
    let Record = Surfels.Records[RecordNumber];
    if (Record.NormalValid.w < 0.25) { return; }
    let Position = Record.PositionRadius.xyz;
    let Normal = normalize(Record.NormalValid.xyz);
    let Identity = u32(round(Record.RadianceFrame.w));
    InjectBlocker(Position, Normal);
    for (var Cascade = 0u; Cascade < 3u; Cascade = Cascade + 1u)
    {
        let Located = LocateCell(Position, CascadeOrigin(Cascade));
        if (Located.w == 0) { continue; }
        let Cell = CellNumber(Located.xyz, Cascade);
        atomicMax(&Reservoirs.Entries[Cell], ReservoirKey(Identity, Cascade, RecordNumber, Record.NormalValid.w));
    }
}

fn SplatRadiance(Cell: u32, Weight: f32, Red: vec4f, Green: vec4f, Blue: vec4f)
{
    let Base = Cell * AtomicStride;
    AddFixed(Base + 0u, Red.x * Weight);
    AddFixed(Base + 1u, Red.y * Weight);
    AddFixed(Base + 2u, Red.z * Weight);
    AddFixed(Base + 3u, Red.w * Weight);
    AddFixed(Base + 4u, Green.x * Weight);
    AddFixed(Base + 5u, Green.y * Weight);
    AddFixed(Base + 6u, Green.z * Weight);
    AddFixed(Base + 7u, Green.w * Weight);
    AddFixed(Base + 8u, Blue.x * Weight);
    AddFixed(Base + 9u, Blue.y * Weight);
    AddFixed(Base + 10u, Blue.z * Weight);
    AddFixed(Base + 11u, Blue.w * Weight);
    AddFixed(Base + 18u, Weight);
}

@compute @workgroup_size(64)
fn InjectSelectedSurfels(@builtin(global_invocation_id) Global: vec3u)
{
    let RecordNumber = Global.x;
    if (RecordNumber >= u32(Frame.Counts.y + 0.5)) { return; }
    let Record = Surfels.Records[RecordNumber];
    if (Record.NormalValid.w < 0.25) { return; }
    let Position = Record.PositionRadius.xyz;
    let Normal = normalize(Record.NormalValid.xyz);
    let Identity = u32(round(Record.RadianceFrame.w));
    let Radiance = max(Record.RadianceFrame.xyz, vec3f(0.0)) * Record.NormalValid.w;
    let Red = vec4f(Radiance.r * 0.45, Radiance.r * Normal * 0.55);
    let Green = vec4f(Radiance.g * 0.45, Radiance.g * Normal * 0.55);
    let Blue = vec4f(Radiance.b * 0.45, Radiance.b * Normal * 0.55);

    for (var Cascade = 0u; Cascade < 3u; Cascade = Cascade + 1u)
    {
        let OriginCell = CascadeOrigin(Cascade);
        let Located = LocateCell(Position, OriginCell);
        if (Located.w == 0) { continue; }
        let SourceCell = CellNumber(Located.xyz, Cascade);
        if (atomicLoad(&Reservoirs.Entries[SourceCell]) != ReservoirKey(Identity, Cascade, RecordNumber, Record.NormalValid.w)) { continue; }

        let Grid = (Position - OriginCell.xyz) / OriginCell.w - vec3f(0.5);
        let BaseCoordinate = vec3i(floor(Grid));
        let Fraction = fract(Grid);
        for (var Z = 0; Z <= 1; Z = Z + 1)
        {
            for (var Y = 0; Y <= 1; Y = Y + 1)
            {
                for (var X = 0; X <= 1; X = X + 1)
                {
                    let Coordinate = BaseCoordinate + vec3i(X, Y, Z);
                    if (any(Coordinate < vec3i(0)) || any(Coordinate >= vec3i(i32(VolumeResolution)))) { continue; }
                    let WeightX = select(1.0 - Fraction.x, Fraction.x, X == 1);
                    let WeightY = select(1.0 - Fraction.y, Fraction.y, Y == 1);
                    let WeightZ = select(1.0 - Fraction.z, Fraction.z, Z == 1);
                    SplatRadiance(CellNumber(Coordinate, Cascade), WeightX * WeightY * WeightZ, Red, Green, Blue);
                }
            }
        }
    }
}

@compute @workgroup_size(8, 8)
fn InjectCameraBlockers(@builtin(global_invocation_id) Global: vec3u)
{
    let Pixel = vec2i(Global.xy * 4u + vec2u(2u));
    let Extent = textureDimensions(PositionImage);
    if (Pixel.x >= i32(Extent.x) || Pixel.y >= i32(Extent.y)) { return; }
    let PositionHit = textureLoad(PositionImage, Pixel, 0);
    if (PositionHit.w < 0.5) { return; }
    InjectBlocker(PositionHit.xyz, normalize(textureLoad(NormalImage, Pixel, 0).xyz));
}

fn InsideBox(Position: vec3f, Minimum: vec4f, Maximum: vec4f, CellRadius: f32) -> bool
{
    return Minimum.w > 0.5
        && all(Position >= Minimum.xyz - vec3f(CellRadius))
        && all(Position <= Maximum.xyz + vec3f(CellRadius));
}

fn IsDynamic(Position: vec3f, CellRadius: f32) -> bool
{
    return InsideBox(Position, Frame.MotionMin0, Frame.MotionMax0, CellRadius)
        || InsideBox(Position, Frame.MotionMin1, Frame.MotionMax1, CellRadius)
        || InsideBox(Position, Frame.MotionMin2, Frame.MotionMax2, CellRadius)
        || InsideBox(Position, Frame.MotionMin3, Frame.MotionMax3, CellRadius)
        || InsideBox(Position, Frame.MotionMin4, Frame.MotionMax4, CellRadius)
        || InsideBox(Position, Frame.MotionMin5, Frame.MotionMax5, CellRadius)
        || InsideBox(Position, Frame.MotionMin6, Frame.MotionMax6, CellRadius)
        || InsideBox(Position, Frame.MotionMin7, Frame.MotionMax7, CellRadius);
}

fn HistoryAt(Position: vec3f, Cascade: u32) -> VolumeCell
{
    let Located = LocateCell(Position, PreviousCascadeOrigin(Cascade));
    if (Located.w == 0) { return VolumeCell(vec4f(0.0), vec4f(0.0), vec4f(0.0)); }
    return HistoryVolume.Cells[CellNumber(Located.xyz, Cascade)];
}

@compute @workgroup_size(64)
fn NormalizeMain(@builtin(global_invocation_id) Global: vec3u)
{
    let Cell = Global.x;
    if (Cell >= CellsPerCascade * 3u) { return; }
    let Base = Cell * AtomicStride;
    var Red = vec4f(ExchangeFixed(Base + 0u), ExchangeFixed(Base + 1u), ExchangeFixed(Base + 2u), ExchangeFixed(Base + 3u));
    var Green = vec4f(ExchangeFixed(Base + 4u), ExchangeFixed(Base + 5u), ExchangeFixed(Base + 6u), ExchangeFixed(Base + 7u));
    var Blue = vec4f(ExchangeFixed(Base + 8u), ExchangeFixed(Base + 9u), ExchangeFixed(Base + 10u), ExchangeFixed(Base + 11u));
    let DirectionalSum = array<f32, 6>(
        ExchangeFixed(Base + 12u), ExchangeFixed(Base + 13u),
        ExchangeFixed(Base + 14u), ExchangeFixed(Base + 15u),
        ExchangeFixed(Base + 16u), ExchangeFixed(Base + 17u)
    );
    let RadianceWeight = ExchangeFixed(Base + 18u);
    atomicExchange(&Reservoirs.Entries[Cell], 0u);
    if (RadianceWeight > 0.0001)
    {
        Red = Red / RadianceWeight;
        Green = Green / RadianceWeight;
        Blue = Blue / RadianceWeight;
    }
    let Injection = VolumeCell(Red, Green, Blue);
    InjectionVolume.Cells[Cell] = Injection;

    let Cascade = Cell / CellsPerCascade;
    let Coordinate = LocalCoordinate(Cell);
    let OriginCell = CascadeOrigin(Cascade);
    let WorldPosition = OriginCell.xyz + (vec3f(Coordinate) + vec3f(0.5)) * OriginCell.w;
    let History = HistoryAt(WorldPosition, Cascade);
    let HistoryEnergy = History.Red.x + History.Green.x + History.Blue.x;
    let HistoryWeight = select(0.0, 0.82, Frame.CameraPosition.w > 1.5 && HistoryEnergy > 0.0001 && !IsDynamic(WorldPosition, OriginCell.w * 0.5));
    InitialPropagation.Cells[Cell] = VolumeCell(
        mix(Injection.Red, History.Red, HistoryWeight),
        mix(Injection.Green, History.Green, HistoryWeight),
        mix(Injection.Blue, History.Blue, HistoryWeight)
    );

    let Opacity = vec3f(1.0) - exp(-vec3f(DirectionalSum[0], DirectionalSum[1], DirectionalSum[2]) * 0.16);
    let OpacityTwo = vec3f(1.0) - exp(-vec3f(DirectionalSum[3], DirectionalSum[4], DirectionalSum[5]) * 0.16);
    RawBlockers.Cells[Cell] = BlockerCell(
        vec4f(Opacity.x, Opacity.y, Opacity.z, OpacityTwo.x),
        vec4f(OpacityTwo.y, OpacityTwo.z, 0.0, 0.0)
    );
}

fn MaxBlocker(Alpha: BlockerCell, Beta: BlockerCell) -> BlockerCell
{
    return BlockerCell(max(Alpha.Axis0, Beta.Axis0), max(Alpha.Axis1, Beta.Axis1));
}

@compute @workgroup_size(64)
fn DilateBlockersMain(@builtin(global_invocation_id) Global: vec3u)
{
    let Cell = Global.x;
    if (Cell >= CellsPerCascade * 3u) { return; }
    let Cascade = Cell / CellsPerCascade;
    var Result = RawBlockers.Cells[Cell];
    if (Cascade == 0u)
    {
        let Coordinate = LocalCoordinate(Cell);
        for (var Z = -1; Z <= 1; Z = Z + 1)
        {
            for (var Y = -1; Y <= 1; Y = Y + 1)
            {
                for (var X = -1; X <= 1; X = X + 1)
                {
                    let Neighbour = Coordinate + vec3i(X, Y, Z);
                    if (any(Neighbour < vec3i(0)) || any(Neighbour >= vec3i(i32(VolumeResolution)))) { continue; }
                    Result = MaxBlocker(Result, RawBlockers.Cells[CellNumber(Neighbour, Cascade)]);
                }
            }
        }
    }
    DilatedBlockers.Cells[Cell] = Result;
}
