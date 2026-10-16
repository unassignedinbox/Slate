// 48-sector pneumatic shell skinning. Same mapping in surface and shadow passes.
struct TyreCarcass
{
    Shape : vec4f, // tread radius, bead radius, half width, plane distance from hub [m]
    Pose : vec4f,  // road angle in spinning wheel frame, diagnostic shear, spread, bulge coefficient
    Folds : vec4f, // fold amplitude, count, material phase, pressure ratio
    Radial : array<vec4f, 12>,
    Axial : array<vec4f, 12>,
}
struct DeformedVertex { Position : vec3f, Normal : vec3f }
const CarcassNodeCount : i32 = 48;

fn ReadCarcassNode(Wheel: u32, Node: i32) -> vec2f
{
    let I = u32(((Node % CarcassNodeCount) + CarcassNodeCount) % CarcassNodeCount);
    return vec2f(Carcasses[Wheel].Radial[I / 4u][I % 4u], Carcasses[Wheel].Axial[I / 4u][I % 4u]);
}
fn SampleCarcass(Wheel: u32, Angle: f32) -> vec2f
{
    let U = fract(Angle / 6.28318530718) * f32(CarcassNodeCount);
    let I = i32(floor(U));
    let T = fract(U);
    // Linear interpolation is bounded (Catmull-Rom overshot the road and the bead stop).
    return mix(ReadCarcassNode(Wheel, I), ReadCarcassNode(Wheel, I + 1), T);
}
fn CarcassPosition(Wheel: u32, Position: vec3f) -> vec3f
{
    let Shape = Carcasses[Wheel].Shape;
    let Pose = Carcasses[Wheel].Pose;
    let Folds = Carcasses[Wheel].Folds;
    let Radius = length(Position.xz);
    let Share = clamp((Radius - Shape.y) / max(Shape.x - Shape.y, 0.001), 0.0, 1.0);
    if (Share <= 0.0) { return Position; }
    let Angle = atan2(Position.z, Position.x);
    let FromRoad = Angle - Pose.x;
    let Belt = SampleCarcass(Wheel, FromRoad);
    let Arch = sin(3.14159265359 * Share);
    let Fold = Folds.x * sin(Folds.y * Angle + Folds.z) * Arch;
    var Reach = max(Shape.y + 0.002 * Share, Radius - Belt.x * Share - Fold);
    // Exact plane guard between sectors; only the outer belt is constrained, beads remain rigid.
    let Cosine = cos(FromRoad);
    if (Cosine > 0.05 && Share > 0.95)
    {
        Reach = min(Reach, Shape.w / Cosine);
    }
    let Side = clamp(Position.y / max(Shape.z, 0.001), -1.0, 1.0);
    let Bulge = min(0.075, Pose.w * max(Belt.x, 0.0)) * Arch;
    return vec3f(cos(Angle) * Reach, Position.y + Bulge * Side + Belt.y * Share, sin(Angle) * Reach);
}
fn DeformTyre(Wheel: u32, Position: vec3f, Normal: vec3f) -> DeformedVertex
{
    var Result: DeformedVertex;
    Result.Position = CarcassPosition(Wheel, Position);
    Result.Normal = Normal;
    if (length(Position.xz) <= Carcasses[Wheel].Shape.y) { return Result; }
    // Cofactor(J)*n = det(J)*inverse-transpose(J)*n. Includes shear, bulge and folds, not just a radial tilt.
    let E = 0.0005;
    let Dx = (CarcassPosition(Wheel, Position + vec3f(E, 0.0, 0.0)) - Result.Position) / E;
    let Dy = (CarcassPosition(Wheel, Position + vec3f(0.0, E, 0.0)) - Result.Position) / E;
    let Dz = (CarcassPosition(Wheel, Position + vec3f(0.0, 0.0, E)) - Result.Position) / E;
    let N = Normal.x * cross(Dy, Dz) + Normal.y * cross(Dz, Dx) + Normal.z * cross(Dx, Dy);
    if (dot(N, N) > 1.0e-10) { Result.Normal = normalize(N); }
    return Result;
}
