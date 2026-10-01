// Dedicated six-face near radiance field with dual deterministic RSM reservoirs.

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
    MotionMin8: vec4f,
    MotionMax8: vec4f,
    PersistentSettings: vec4f,
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
struct NearCell { Faces: array<vec4f, 6>, };
struct NearExtent { Cells: array<NearCell>, };
struct PackedBlocker { Low: u32, High: u32, };
struct BlockerExtent { Cells: array<PackedBlocker>, };
struct LocalEmitterSurfel { PositionTriangle: vec4f, NormalArea: vec4f, };
struct LocalEmitterExtent { Records: array<LocalEmitterSurfel>, };
struct CompactAtomicExtent { Entries: array<atomic<i32>>, };

@group(0) @binding(0) var<uniform> Frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> Surfels: SurfelExtent;
@group(0) @binding(2) var<storage, read_write> Reservoirs: ReservoirExtent;
@group(0) @binding(3) var<storage, read_write> NearAccumulation: AtomicExtent;
@group(0) @binding(4) var<storage, read> PreviousSource: NearExtent;
@group(0) @binding(5) var<storage, read_write> CurrentSource: NearExtent;
@group(0) @binding(6) var<storage, read> PreviousHistory: NearExtent;
@group(0) @binding(7) var<storage, read> SourceVolume: NearExtent;
@group(0) @binding(8) var<storage, read_write> DestinationVolume: NearExtent;
@group(0) @binding(9) var<storage, read> NearBlockers: BlockerExtent;
@group(0) @binding(10) var<storage, read> LocalEmitterSurfels: LocalEmitterExtent;
@group(0) @binding(11) var<storage, read_write> CompactAccumulation: CompactAtomicExtent;

const VolumeResolution: u32 = 48u;
const NearBlockerResolution: u32 = 80u;
const CellsPerCascade: u32 = 110592u;
const TotalVolumeCells: u32 = 331776u;
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

fn ReservoirKey(Identity: u32, RecordNumber: u32, Confidence: f32) -> u32
{
    let Quality = select(0u, 0x80000000u, Confidence > 0.8);
    let MixedIdentity = Identity ^ 0x9e3779b9u;
    let Priority = Quality | (Hash(MixedIdentity) & 0x7fff0000u);
    return Priority | (0xffffu - (RecordNumber & 0xffffu));
}

fn LocateCell(Position: vec3f, OriginCell: vec4f) -> vec4i
{
    let Coordinate = vec3i(floor((Position - OriginCell.xyz) / OriginCell.w));
    let Valid = all(Coordinate >= vec3i(0)) && all(Coordinate < vec3i(i32(VolumeResolution)));
    return vec4i(Coordinate, select(0, 1, Valid));
}

fn CellNumber(Coordinate: vec3i) -> u32
{
    return u32(Coordinate.x)
        + u32(Coordinate.y) * VolumeResolution
        + u32(Coordinate.z) * VolumeResolution * VolumeResolution;
}

fn LocalCoordinate(Cell: u32) -> vec3i
{
    let Z = Cell / (VolumeResolution * VolumeResolution);
    let Remainder = Cell - Z * VolumeResolution * VolumeResolution;
    let Y = Remainder / VolumeResolution;
    return vec3i(i32(Remainder - Y * VolumeResolution), i32(Y), i32(Z));
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

fn AddFixed(Address: u32, Value: f32)
{
    atomicAdd(&NearAccumulation.Entries[Address], i32(round(clamp(Value, 0.0, 64.0) * FixedScale)));
}

fn SplatNear(Cell: u32, Weight: f32, Normal: vec3f, Radiance: vec3f)
{
    let Base = Cell * AtomicStride;
    for (var Face = 0u; Face < 6u; Face = Face + 1u)
    {
        let Lobe = 0.12 + 0.88 * max(dot(Normal, FaceDirection(Face)), 0.0);
        let Value = Radiance * (Weight * Lobe);
        AddFixed(Base + Face * 3u + 0u, Value.r);
        AddFixed(Base + Face * 3u + 1u, Value.g);
        AddFixed(Base + Face * 3u + 2u, Value.b);
    }
    AddFixed(Base + 18u, Weight);
}

fn AddCompactFixed(Address: u32, Value: f32)
{
    atomicAdd(&CompactAccumulation.Entries[Address], i32(round(clamp(Value, -64.0, 64.0) * FixedScale)));
}

fn SplatCompact(Cell: u32, Weight: f32, Normal: vec3f, Radiance: vec3f)
{
    let Base = Cell * 13u;
    let Red = vec4f(Radiance.r * 0.45, Radiance.r * Normal * 0.55);
    let Green = vec4f(Radiance.g * 0.45, Radiance.g * Normal * 0.55);
    let Blue = vec4f(Radiance.b * 0.45, Radiance.b * Normal * 0.55);
    for (var Component = 0u; Component < 4u; Component = Component + 1u)
    {
        AddCompactFixed(Base + Component, Red[Component] * Weight);
        AddCompactFixed(Base + 4u + Component, Green[Component] * Weight);
        AddCompactFixed(Base + 8u + Component, Blue[Component] * Weight);
    }
    AddCompactFixed(Base + 12u, Weight);
}

fn PersistentKernel(Weight: f32) -> f32
{
    return pow(max(Weight, 0.000001), 1.0 / max(Frame.PersistentSettings.y, 0.25));
}

@compute @workgroup_size(64)
fn InjectPersistentEmitters(@builtin(global_invocation_id) Global: vec3u)
{
    let RecordNumber = Global.x;
    if (RecordNumber >= u32(Frame.PersistentSettings.x + 0.5) || Frame.PersistentSettings.z < 0.5) { return; }
    let Local = LocalEmitterSurfels.Records[RecordNumber];
    let Scale = vec3f(3.7, 0.20, 0.30);
    let EmitterPosition = vec3f(sin(Frame.SunColourTime.w * 0.37) * 1.1, -6.5, 1.35);
    let Position = EmitterPosition + Local.PositionTriangle.xyz * Scale;
    let Normal = normalize(Local.NormalArea.xyz / Scale);
    let Radiance = vec3f(0.025, 0.68, 1.0) * 5.5;

    let NearLocated = LocateCell(Position, Frame.CascadeOrigin0);
    if (NearLocated.w != 0)
    {
        let Grid = (Position - Frame.CascadeOrigin0.xyz) / Frame.CascadeOrigin0.w - vec3f(0.5);
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
                    let Weight = select(1.0 - Fraction.x, Fraction.x, X == 1)
                        * select(1.0 - Fraction.y, Fraction.y, Y == 1)
                        * select(1.0 - Fraction.z, Fraction.z, Z == 1);
                    SplatNear(CellNumber(Coordinate), PersistentKernel(Weight), Normal, Radiance);
                }
            }
        }
    }

    for (var Cascade = 1u; Cascade < 3u; Cascade = Cascade + 1u)
    {
        let Origin = select(Frame.CascadeOrigin1, Frame.CascadeOrigin2, Cascade == 2u);
        let Located = LocateCell(Position, Origin);
        if (Located.w == 0) { continue; }
        let Grid = (Position - Origin.xyz) / Origin.w - vec3f(0.5);
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
                    let Weight = select(1.0 - Fraction.x, Fraction.x, X == 1)
                        * select(1.0 - Fraction.y, Fraction.y, Y == 1)
                        * select(1.0 - Fraction.z, Fraction.z, Z == 1);
                    SplatCompact(Cascade * CellsPerCascade + CellNumber(Coordinate), PersistentKernel(Weight), Normal, Radiance);
                }
            }
        }
    }
}

@compute @workgroup_size(64)
fn InjectNearSurfels(@builtin(global_invocation_id) Global: vec3u)
{
    let RecordNumber = Global.x;
    if (RecordNumber >= u32(Frame.Counts.y + 0.5)) { return; }
    let Record = Surfels.Records[RecordNumber];
    if (Record.NormalValid.w < 0.25) { return; }
    let Position = Record.PositionRadius.xyz;
    let Located = LocateCell(Position, Frame.CascadeOrigin0);
    if (Located.w == 0) { return; }
    let SourceCell = CellNumber(Located.xyz);
    let Identity = u32(round(Record.RadianceFrame.w));
    let Key = ReservoirKey(Identity, RecordNumber, Record.NormalValid.w);
    let Primary = atomicLoad(&Reservoirs.Entries[SourceCell]);
    let Secondary = atomicLoad(&Reservoirs.Entries[TotalVolumeCells + SourceCell]);
    if (Key != Primary && Key != Secondary) { return; }

    let Grid = (Position - Frame.CascadeOrigin0.xyz) / Frame.CascadeOrigin0.w - vec3f(0.5);
    let BaseCoordinate = vec3i(floor(Grid));
    let Fraction = fract(Grid);
    let Normal = normalize(Record.NormalValid.xyz);
    let Radiance = max(Record.RadianceFrame.xyz, vec3f(0.0)) * Record.NormalValid.w;
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
                SplatNear(CellNumber(Coordinate), WeightX * WeightY * WeightZ, Normal, Radiance);
            }
        }
    }
}

fn EmptyNearCell() -> NearCell
{
    var Cell: NearCell;
    for (var Face = 0u; Face < 6u; Face = Face + 1u) { Cell.Faces[Face] = vec4f(0.0); }
    return Cell;
}

fn PreviousCellAt(Position: vec3f, SourceHistory: bool) -> NearCell
{
    let Located = LocateCell(Position, Frame.PreviousCascadeOrigin0);
    if (Located.w == 0) { return EmptyNearCell(); }
    let Cell = CellNumber(Located.xyz);
    if (SourceHistory) { return PreviousSource.Cells[Cell]; }
    return PreviousHistory.Cells[Cell];
}

fn InsideBox(Position: vec3f, Minimum: vec4f, Maximum: vec4f, Radius: f32) -> bool
{
    return Minimum.w > 0.5
        && all(Position >= Minimum.xyz - vec3f(Radius))
        && all(Position <= Maximum.xyz + vec3f(Radius));
}

fn IsDynamic(Position: vec3f, Radius: f32) -> bool
{
    return InsideBox(Position, Frame.MotionMin0, Frame.MotionMax0, Radius)
        || InsideBox(Position, Frame.MotionMin1, Frame.MotionMax1, Radius)
        || InsideBox(Position, Frame.MotionMin2, Frame.MotionMax2, Radius)
        || InsideBox(Position, Frame.MotionMin3, Frame.MotionMax3, Radius)
        || InsideBox(Position, Frame.MotionMin4, Frame.MotionMax4, Radius)
        || InsideBox(Position, Frame.MotionMin5, Frame.MotionMax5, Radius)
        || InsideBox(Position, Frame.MotionMin6, Frame.MotionMax6, Radius)
        || InsideBox(Position, Frame.MotionMin7, Frame.MotionMax7, Radius)
        || InsideBox(Position, Frame.MotionMin8, Frame.MotionMax8, Radius);
}

@compute @workgroup_size(64)
fn NormalizeNear(@builtin(global_invocation_id) Global: vec3u)
{
    let Cell = Global.x;
    if (Cell >= CellsPerCascade) { return; }
    let Base = Cell * AtomicStride;
    let Weight = f32(atomicExchange(&NearAccumulation.Entries[Base + 18u], 0)) / FixedScale;
    var Current = EmptyNearCell();
    for (var Face = 0u; Face < 6u; Face = Face + 1u)
    {
        let Red = f32(atomicExchange(&NearAccumulation.Entries[Base + Face * 3u + 0u], 0)) / FixedScale;
        let Green = f32(atomicExchange(&NearAccumulation.Entries[Base + Face * 3u + 1u], 0)) / FixedScale;
        let Blue = f32(atomicExchange(&NearAccumulation.Entries[Base + Face * 3u + 2u], 0)) / FixedScale;
        if (Weight > 0.0001) { Current.Faces[Face] = vec4f(vec3f(Red, Green, Blue) / max(Weight, 1.0), 0.0); }
    }

    let Coordinate = LocalCoordinate(Cell);
    let WorldPosition = Frame.CascadeOrigin0.xyz + (vec3f(Coordinate) + vec3f(0.5)) * Frame.CascadeOrigin0.w;
    let Dynamic = IsDynamic(WorldPosition, Frame.CascadeOrigin0.w * 1.75);
    let HistoryValid = Frame.CameraPosition.w > 1.5 && Frame.ScreenSettings.z > 0.5 && !Dynamic;
    let Stability = select(0.0, 0.91, HistoryValid);
    var OldSource = PreviousCellAt(WorldPosition, true);
    var OldHistory = PreviousCellAt(WorldPosition, false);
    if (!HistoryValid)
    {
        OldSource = EmptyNearCell();
        OldHistory = EmptyNearCell();
    }
    var Filtered = EmptyNearCell();
    var Initial = EmptyNearCell();
    for (var Face = 0u; Face < 6u; Face = Face + 1u)
    {
        let HasSample = Weight > 0.0001;
        Filtered.Faces[Face] = select(OldSource.Faces[Face] * 0.94, mix(Current.Faces[Face], OldSource.Faces[Face], Stability), HasSample);
        Initial.Faces[Face] = mix(Filtered.Faces[Face], OldHistory.Faces[Face], select(0.0, 0.82, HistoryValid));
    }
    CurrentSource.Cells[Cell] = Filtered;
    DestinationVolume.Cells[Cell] = Initial;
}

fn UnpackChannel(Blocker: PackedBlocker, Face: u32) -> f32
{
    if (Face < 4u) { return f32((Blocker.Low >> (Face * 8u)) & 255u) * (1.0 / 255.0); }
    return f32((Blocker.High >> ((Face - 4u) * 8u)) & 255u) * (1.0 / 255.0);
}

fn BlockerAtWorld(Position: vec3f, Face: u32) -> f32
{
    let Span = Frame.CascadeOrigin0.w * f32(VolumeResolution);
    let CellSize = Span / f32(NearBlockerResolution);
    let Coordinate = vec3i(floor((Position - Frame.CascadeOrigin0.xyz) / CellSize));
    if (any(Coordinate < vec3i(0)) || any(Coordinate >= vec3i(i32(NearBlockerResolution)))) { return 0.0; }
    let Cell = u32(Coordinate.x)
        + u32(Coordinate.y) * NearBlockerResolution
        + u32(Coordinate.z) * NearBlockerResolution * NearBlockerResolution;
    return UnpackChannel(NearBlockers.Cells[Cell], Face);
}

fn DirectionFace(Direction: vec3f) -> u32
{
    let Absolute = abs(Direction);
    if (Absolute.x >= Absolute.y && Absolute.x >= Absolute.z) { return select(1u, 0u, Direction.x >= 0.0); }
    if (Absolute.y >= Absolute.z) { return select(3u, 2u, Direction.y >= 0.0); }
    return select(5u, 4u, Direction.z >= 0.0);
}

fn LinkVisibility(SourcePosition: vec3f, DestinationPosition: vec3f, FacingFace: u32) -> f32
{
    if (Frame.Settings.y <= 0.5) { return 1.0; }
    var Opacity = 0.0;
    for (var Sample = 1u; Sample <= 3u; Sample = Sample + 1u)
    {
        let T = f32(Sample) * 0.25;
        Opacity = max(Opacity, BlockerAtWorld(mix(SourcePosition, DestinationPosition, T), FacingFace));
    }
    return 1.0 - clamp(Opacity * 0.94, 0.0, 0.97);
}

@compute @workgroup_size(64)
fn PropagateNear(@builtin(global_invocation_id) Global: vec3u)
{
    let Cell = Global.x;
    if (Cell >= CellsPerCascade) { return; }
    let Coordinate = LocalCoordinate(Cell);
    let WorldPosition = Frame.CascadeOrigin0.xyz + (vec3f(Coordinate) + vec3f(0.5)) * Frame.CascadeOrigin0.w;
    let Offsets = array<vec3i, 6>(
        vec3i(-1, 0, 0), vec3i(1, 0, 0), vec3i(0, -1, 0),
        vec3i(0, 1, 0), vec3i(0, 0, -1), vec3i(0, 0, 1)
    );
    let Old = SourceVolume.Cells[Cell];
    let Injected = CurrentSource.Cells[Cell];
    var Result = EmptyNearCell();
    for (var Face = 0u; Face < 6u; Face = Face + 1u)
    {
        Result.Faces[Face] = Old.Faces[Face] * 0.48 + Injected.Faces[Face] * 0.52;
    }

    for (var NeighbourNumber = 0u; NeighbourNumber < 6u; NeighbourNumber = NeighbourNumber + 1u)
    {
        let SourceCoordinate = Coordinate + Offsets[NeighbourNumber];
        if (any(SourceCoordinate < vec3i(0)) || any(SourceCoordinate >= vec3i(i32(VolumeResolution)))) { continue; }
        let SourceCell = SourceVolume.Cells[CellNumber(SourceCoordinate)];
        let TravelDirection = normalize(vec3f(-Offsets[NeighbourNumber]));
        let SourceFace = DirectionFace(TravelDirection);
        let FacingFace = DirectionFace(-TravelDirection);
        let SourcePosition = WorldPosition + vec3f(Offsets[NeighbourNumber]) * Frame.CascadeOrigin0.w;
        let Visibility = LinkVisibility(SourcePosition, WorldPosition, FacingFace);
        let Incoming = SourceCell.Faces[SourceFace].rgb * (0.105 * Visibility);
        for (var Face = 0u; Face < 6u; Face = Face + 1u)
        {
            let Scatter = 0.30 + 0.70 * max(dot(FaceDirection(Face), TravelDirection), 0.0);
            Result.Faces[Face] = Result.Faces[Face] + vec4f(Incoming * Scatter, 0.0);
        }
    }
    for (var Face = 0u; Face < 6u; Face = Face + 1u)
    {
        Result.Faces[Face] = vec4f(clamp(Result.Faces[Face].rgb, vec3f(0.0), vec3f(10.0)), 0.0);
    }
    DestinationVolume.Cells[Cell] = Result;
}
