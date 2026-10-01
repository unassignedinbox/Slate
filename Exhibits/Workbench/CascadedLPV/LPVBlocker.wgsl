// Packed six-direction geometry volumes: 80^3 near blockers and 48^3 middle/far blockers.

struct AtomicExtent { Entries: array<atomic<i32>>, };
struct PackedExtent { Cells: array<vec2u>, };

@group(0) @binding(0) var<storage, read_write> NearAccumulation: AtomicExtent;
@group(0) @binding(1) var<storage, read_write> FarAccumulation: AtomicExtent;
@group(0) @binding(2) var<storage, read_write> NearRaw: PackedExtent;
@group(0) @binding(3) var<storage, read_write> NearDilated: PackedExtent;
@group(0) @binding(4) var<storage, read_write> FarPacked: PackedExtent;

const NearResolution: u32 = 80u;
const NearCellCount: u32 = 512000u;
const VolumeResolution: u32 = 48u;
const CellsPerCascade: u32 = 110592u;
const FixedScale: f32 = 1024.0;

fn ExchangeOpacity(Address: u32, Near: bool) -> f32
{
    var Sum = 0.0;
    if (Near)
    {
        Sum = f32(atomicExchange(&NearAccumulation.Entries[Address], 0)) / FixedScale;
    }
    else
    {
        Sum = f32(atomicExchange(&FarAccumulation.Entries[Address], 0)) / FixedScale;
    }
    return 1.0 - exp(-max(Sum, 0.0) * 0.16);
}

fn PackBlocker(First: vec4f, Second: vec2f) -> vec2u
{
    return vec2u(
        pack4x8unorm(clamp(First, vec4f(0.0), vec4f(1.0))),
        pack4x8unorm(vec4f(clamp(Second, vec2f(0.0), vec2f(1.0)), 0.0, 0.0))
    );
}

fn MaxPacked(Alpha: vec2u, Beta: vec2u) -> vec2u
{
    return PackBlocker(
        max(unpack4x8unorm(Alpha.x), unpack4x8unorm(Beta.x)),
        max(unpack4x8unorm(Alpha.y).xy, unpack4x8unorm(Beta.y).xy)
    );
}

fn NearCoordinate(Cell: u32) -> vec3i
{
    let Z = Cell / (NearResolution * NearResolution);
    let Remainder = Cell - Z * NearResolution * NearResolution;
    let Y = Remainder / NearResolution;
    return vec3i(i32(Remainder - Y * NearResolution), i32(Y), i32(Z));
}

fn NearIndex(Coordinate: vec3i) -> u32
{
    return u32(Coordinate.x)
        + u32(Coordinate.y) * NearResolution
        + u32(Coordinate.z) * NearResolution * NearResolution;
}

@compute @workgroup_size(64)
fn NormalizeNear(@builtin(global_invocation_id) Global: vec3u)
{
    let Cell = Global.x;
    if (Cell >= NearCellCount) { return; }
    let Base = Cell * 6u;
    let First = vec4f(
        ExchangeOpacity(Base + 0u, true),
        ExchangeOpacity(Base + 1u, true),
        ExchangeOpacity(Base + 2u, true),
        ExchangeOpacity(Base + 3u, true)
    );
    let Second = vec2f(
        ExchangeOpacity(Base + 4u, true),
        ExchangeOpacity(Base + 5u, true)
    );
    NearRaw.Cells[Cell] = PackBlocker(First, Second);
}

@compute @workgroup_size(64)
fn NormalizeFar(@builtin(global_invocation_id) Global: vec3u)
{
    let Cell = Global.x;
    if (Cell >= CellsPerCascade * 2u) { return; }
    let Base = Cell * 6u;
    let First = vec4f(
        ExchangeOpacity(Base + 0u, false),
        ExchangeOpacity(Base + 1u, false),
        ExchangeOpacity(Base + 2u, false),
        ExchangeOpacity(Base + 3u, false)
    );
    let Second = vec2f(
        ExchangeOpacity(Base + 4u, false),
        ExchangeOpacity(Base + 5u, false)
    );
    FarPacked.Cells[Cell] = PackBlocker(First, Second);
}

@compute @workgroup_size(64)
fn DilateNear(@builtin(global_invocation_id) Global: vec3u)
{
    let Cell = Global.x;
    if (Cell >= NearCellCount) { return; }
    let Coordinate = NearCoordinate(Cell);
    var Result = NearRaw.Cells[Cell];
    for (var Z = -1; Z <= 1; Z = Z + 1)
    {
        for (var Y = -1; Y <= 1; Y = Y + 1)
        {
            for (var X = -1; X <= 1; X = X + 1)
            {
                let Neighbour = Coordinate + vec3i(X, Y, Z);
                if (any(Neighbour < vec3i(0)) || any(Neighbour >= vec3i(i32(NearResolution)))) { continue; }
                Result = MaxPacked(Result, NearRaw.Cells[NearIndex(Neighbour)]);
            }
        }
    }
    NearDilated.Cells[Cell] = Result;
}
