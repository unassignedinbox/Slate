// Jacobi-style directional light propagation through three independent camera-relative cascades.

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
@group(0) @binding(1) var<storage, read> InjectionVolume: VolumeExtent;
@group(0) @binding(2) var<storage, read> BlockerVolume: VectorExtent;
@group(0) @binding(3) var<storage, read> SourceVolume: VolumeExtent;
@group(0) @binding(4) var<storage, read_write> DestinationVolume: VolumeExtent;

const VolumeResolution: u32 = 32u;
const CellsPerCascade: u32 = 32768u;

fn LocalCoordinate(Cell: u32) -> vec3i
{
    let Local = Cell % CellsPerCascade;
    let Z = Local / (VolumeResolution * VolumeResolution);
    let Remainder = Local - Z * VolumeResolution * VolumeResolution;
    let Y = Remainder / VolumeResolution;
    let X = Remainder - Y * VolumeResolution;
    return vec3i(i32(X), i32(Y), i32(Z));
}

fn LocalIndex(Coordinate: vec3i, Cascade: u32) -> u32
{
    return Cascade * CellsPerCascade
        + u32(Coordinate.x)
        + u32(Coordinate.y) * VolumeResolution
        + u32(Coordinate.z) * VolumeResolution * VolumeResolution;
}

fn Evaluate(Coefficients: vec4f, Direction: vec3f) -> f32
{
    return max(Coefficients.x + dot(Coefficients.yzw, Direction), 0.0);
}

fn ClampCell(Cell: VolumeCell) -> VolumeCell
{
    return VolumeCell(
        vec4f(clamp(Cell.Red.x, 0.0, 20.0), clamp(Cell.Red.yzw, vec3f(-20.0), vec3f(20.0))),
        vec4f(clamp(Cell.Green.x, 0.0, 20.0), clamp(Cell.Green.yzw, vec3f(-20.0), vec3f(20.0))),
        vec4f(clamp(Cell.Blue.x, 0.0, 20.0), clamp(Cell.Blue.yzw, vec3f(-20.0), vec3f(20.0)))
    );
}

@compute @workgroup_size(64)
fn PropagateMain(@builtin(global_invocation_id) Global: vec3u)
{
    let CellNumber = Global.x;
    if (CellNumber >= CellsPerCascade * 3u) { return; }

    let Cascade = CellNumber / CellsPerCascade;
    let Coordinate = LocalCoordinate(CellNumber);
    let DestinationBlocker = BlockerVolume.Cells[CellNumber];
    let Offsets = array<vec3i, 6>(
        vec3i(-1, 0, 0), vec3i(1, 0, 0),
        vec3i(0, -1, 0), vec3i(0, 1, 0),
        vec3i(0, 0, -1), vec3i(0, 0, 1)
    );

    var Result = InjectionVolume.Cells[CellNumber];
    for (var DirectionNumber = 0u; DirectionNumber < 6u; DirectionNumber = DirectionNumber + 1u)
    {
        let SourceCoordinate = Coordinate + Offsets[DirectionNumber];
        if (any(SourceCoordinate < vec3i(0)) || any(SourceCoordinate >= vec3i(i32(VolumeResolution))))
        {
            continue;
        }
        let SourceNumber = LocalIndex(SourceCoordinate, Cascade);
        let Source = SourceVolume.Cells[SourceNumber];
        let TravelDirection = normalize(vec3f(-Offsets[DirectionNumber]));
        var Visibility = 1.0;
        if (Frame.Settings.y > 0.5)
        {
            let SourceBlocker = BlockerVolume.Cells[SourceNumber];
            let DestinationCrossing = smoothstep(
                0.12,
                0.92,
                abs(dot(TravelDirection, DestinationBlocker.xyz))
            ) * DestinationBlocker.w;
            let SourceBackface = smoothstep(
                0.05,
                0.82,
                -dot(TravelDirection, SourceBlocker.xyz)
            ) * SourceBlocker.w;
            Visibility = 1.0 - clamp(max(DestinationCrossing * 0.58, SourceBackface * 0.78), 0.0, 0.90);
        }

        let Incoming = vec3f(
            Evaluate(Source.Red, TravelDirection),
            Evaluate(Source.Green, TravelDirection),
            Evaluate(Source.Blue, TravelDirection)
        ) * (0.115 * Visibility);
        Result.Red = Result.Red + vec4f(Incoming.r * 0.45, Incoming.r * TravelDirection * 0.55);
        Result.Green = Result.Green + vec4f(Incoming.g * 0.45, Incoming.g * TravelDirection * 0.55);
        Result.Blue = Result.Blue + vec4f(Incoming.b * 0.45, Incoming.b * TravelDirection * 0.55);
    }

    DestinationVolume.Cells[CellNumber] = ClampCell(Result);
}
