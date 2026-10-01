// Compact first-order propagation for the middle/far cascades through packed six-face blockers.

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

struct VolumeCell { Red: vec4f, Green: vec4f, Blue: vec4f, };
struct VolumeExtent { Cells: array<VolumeCell>, };
struct PackedBlocker { Low: u32, High: u32, };
struct BlockerExtent { Cells: array<PackedBlocker>, };

@group(0) @binding(0) var<uniform> Frame: FrameUniforms;
@group(0) @binding(1) var<storage, read> InjectionVolume: VolumeExtent;
@group(0) @binding(2) var<storage, read> BlockerVolume: BlockerExtent;
@group(0) @binding(3) var<storage, read> SourceVolume: VolumeExtent;
@group(0) @binding(4) var<storage, read_write> DestinationVolume: VolumeExtent;

const VolumeResolution: u32 = 48u;
const CellsPerCascade: u32 = 110592u;

fn LocalCoordinate(Cell: u32) -> vec3i
{
    let Local = Cell % CellsPerCascade;
    let Z = Local / (VolumeResolution * VolumeResolution);
    let Remainder = Local - Z * VolumeResolution * VolumeResolution;
    let Y = Remainder / VolumeResolution;
    return vec3i(i32(Remainder - Y * VolumeResolution), i32(Y), i32(Z));
}

fn LocalIndex(Coordinate: vec3i, Cascade: u32) -> u32
{
    return Cascade * CellsPerCascade + u32(Coordinate.x)
        + u32(Coordinate.y) * VolumeResolution
        + u32(Coordinate.z) * VolumeResolution * VolumeResolution;
}

fn Evaluate(Coefficients: vec4f, Direction: vec3f) -> f32
{
    return max(Coefficients.x + dot(Coefficients.yzw, Direction), 0.0);
}

fn UnpackChannel(Blocker: PackedBlocker, Face: u32) -> f32
{
    if (Face < 4u)
    {
        return f32((Blocker.Low >> (Face * 8u)) & 255u) * (1.0 / 255.0);
    }
    return f32((Blocker.High >> ((Face - 4u) * 8u)) & 255u) * (1.0 / 255.0);
}

fn DirectionalOpacity(Blocker: PackedBlocker, Direction: vec3f) -> f32
{
    return clamp(
        UnpackChannel(Blocker, 0u) * max(Direction.x, 0.0)
        + UnpackChannel(Blocker, 1u) * max(-Direction.x, 0.0)
        + UnpackChannel(Blocker, 2u) * max(Direction.y, 0.0)
        + UnpackChannel(Blocker, 3u) * max(-Direction.y, 0.0)
        + UnpackChannel(Blocker, 4u) * max(Direction.z, 0.0)
        + UnpackChannel(Blocker, 5u) * max(-Direction.z, 0.0),
        0.0,
        1.0
    );
}

fn ClampCell(Cell: VolumeCell) -> VolumeCell
{
    return VolumeCell(
        vec4f(clamp(Cell.Red.x, 0.0, 8.0), clamp(Cell.Red.yzw, vec3f(-8.0), vec3f(8.0))),
        vec4f(clamp(Cell.Green.x, 0.0, 8.0), clamp(Cell.Green.yzw, vec3f(-8.0), vec3f(8.0))),
        vec4f(clamp(Cell.Blue.x, 0.0, 8.0), clamp(Cell.Blue.yzw, vec3f(-8.0), vec3f(8.0)))
    );
}

@compute @workgroup_size(64)
fn PropagateMain(@builtin(global_invocation_id) Global: vec3u)
{
    let CellNumber = Global.x + CellsPerCascade;
    if (CellNumber >= CellsPerCascade * 3u) { return; }
    let Cascade = CellNumber / CellsPerCascade;
    let Coordinate = LocalCoordinate(CellNumber);
    let PackedNumber = (Cascade - 1u) * CellsPerCascade + (CellNumber % CellsPerCascade);
    let DestinationBlocker = BlockerVolume.Cells[PackedNumber];
    let Offsets = array<vec3i, 6>(
        vec3i(-1, 0, 0), vec3i(1, 0, 0), vec3i(0, -1, 0),
        vec3i(0, 1, 0), vec3i(0, 0, -1), vec3i(0, 0, 1)
    );

    let SourceCell = SourceVolume.Cells[CellNumber];
    let InjectionCell = InjectionVolume.Cells[CellNumber];
    var Result = VolumeCell(
        SourceCell.Red * 0.48 + InjectionCell.Red * 0.52,
        SourceCell.Green * 0.48 + InjectionCell.Green * 0.52,
        SourceCell.Blue * 0.48 + InjectionCell.Blue * 0.52
    );
    for (var DirectionNumber = 0u; DirectionNumber < 6u; DirectionNumber = DirectionNumber + 1u)
    {
        let SourceCoordinate = Coordinate + Offsets[DirectionNumber];
        if (any(SourceCoordinate < vec3i(0)) || any(SourceCoordinate >= vec3i(i32(VolumeResolution)))) { continue; }
        let SourceNumber = LocalIndex(SourceCoordinate, Cascade);
        let Source = SourceVolume.Cells[SourceNumber];
        let TravelDirection = normalize(vec3f(-Offsets[DirectionNumber]));
        var Visibility = 1.0;
        if (Frame.Settings.y > 0.5)
        {
            let FacingDirection = -TravelDirection;
            let DestinationOpacity = DirectionalOpacity(DestinationBlocker, FacingDirection);
            let SourcePackedNumber = (Cascade - 1u) * CellsPerCascade + (SourceNumber % CellsPerCascade);
            let SourceOpacity = DirectionalOpacity(BlockerVolume.Cells[SourcePackedNumber], FacingDirection);
            Visibility = 1.0 - clamp(max(DestinationOpacity * 0.82, SourceOpacity * 0.90), 0.0, 0.96);
        }
        let Incoming = vec3f(
            Evaluate(Source.Red, TravelDirection),
            Evaluate(Source.Green, TravelDirection),
            Evaluate(Source.Blue, TravelDirection)
        ) * (0.082 * Visibility);
        Result.Red = Result.Red + vec4f(Incoming.r * 0.45, Incoming.r * TravelDirection * 0.55);
        Result.Green = Result.Green + vec4f(Incoming.g * 0.45, Incoming.g * TravelDirection * 0.55);
        Result.Blue = Result.Blue + vec4f(Incoming.b * 0.45, Incoming.b * TravelDirection * 0.55);
    }
    DestinationVolume.Cells[CellNumber] = ClampCell(Result);
}
