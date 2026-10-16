//============================================================================================================================================
//                                                             GHOSTRASTER.WGSL
//============================================================================================================================================
// 🧩 The X-ray ghost: the car behind the scan front drawn back as a hologram — a fresnel shell, scanlines, a glowing
//    wavefront — plus the shell's hard edges as lines, over the recombined radiance before antialiasing.

// 📝 The configurator's scan mode, in this renderer: the surface raster dissolves the vehicle behind the front, and
//    this pass draws the same vertex records (the same instanced runs, the same tyre deformation and steering wheel)
//    with a hologram shading, premultiplied over what is behind — like the cabin overlay it depth-tests read-only
//    against the opaque surface. The edges are the body's hard edges (> 14°, the configurator's EdgesGeometry angle)
//    extracted once on the CPU over the shell families, drawn as a line list. The derez mask applies here too, so a
//    car coming apart does not leave a ghost of its released cells.

//! include "FrameDescriptor.wgsl"
//! include "EffectRecords.wgsl"
//! include "TyreCarcass.wgsl"
//! include "GhostRecords.wgsl"

@group(0) @binding(1) var<storage, read> Occupants    : array<OccupantRecord>;
@group(0) @binding(2) var<storage, read> VehicleState : VehicleRecord;
@group(0) @binding(3) var<uniform> Effect             : EffectRecord;
@group(0) @binding(4) var<uniform> Ghost              : GhostRecord;

const VehicleOccupantCount : u32 = 5u;   // the body and four wheels lead the occupant list

struct GhostVarying
{
    @builtin(position) Position             : vec4f,
    @location(0) WorldPosition              : vec3f,
    @location(1) Normal                     : vec3f,
    @location(2) BodyLocal                  : vec3f,   // car-body frame, for the scan front and the derez mask
}

// 📝 The derez mask as the surface raster applies it: released cells are gone, hidden is all gone.
fn ClassifyGhostMasked(BodyLocal: vec3f) -> bool
{
    if (Effect.MaskMode == 0u)
    {
        return false;
    }
    if (Effect.MaskMode == 3u)
    {
        return true;
    }
    let Unit = (BodyLocal - Effect.BodyMinimum.xyz) / max(Effect.BodyMaximum.xyz - Effect.BodyMinimum.xyz, vec3f(1.0e-3));
    let Elapsed = Effect.Clock - Effect.MaskStart;
    let Seed = u32(Effect.Emitters[0].Centre.w);
    if (Effect.MaskMode == 1u)
    {
        return Elapsed >= ResolveDerezRelease(Unit, Seed, Effect.Style, 1.0);
    }
    return Elapsed < ResolveRezArrival(Unit, Seed, Effect.Style, 1.0);
}

@vertex
fn GhostVertex(@location(0) Position: vec3f, @location(1) Family: u32, @location(2) Normal: vec3f,
               @location(3) OccupantOffset: u32, @builtin(instance_index) OccupantIndex: u32) -> GhostVarying
{
    let Index = OccupantIndex + OccupantOffset;
    let Occupant = Occupants[Index];
    var Moved: DeformedVertex;
    Moved.Position = Position;
    Moved.Normal = Normal;
    if (Index >= 1u && Index < VehicleOccupantCount)
    {
        Moved = DeformTyre(Index - 1u, Position, Normal);
    }
    else if (Index == 0u)
    {
        Moved = DeformBodyVertex(Family, Position, Normal);
    }
    let World = Occupant.LocalToWorld * vec4f(Moved.Position, 1.0);
    var Varying: GhostVarying;
    Varying.Position = Frame.ViewProjection * World;
    Varying.WorldPosition = World.xyz;
    Varying.Normal = (Occupant.LocalToWorld * vec4f(Moved.Normal, 0.0)).xyz;
    Varying.BodyLocal = (Occupants[0].WorldToLocal * World).xyz;
    return Varying;
}

@fragment
fn GhostFragment(Varying: GhostVarying) -> @location(0) vec4f
{
    if (Ghost.Scan.y < 0.003)
    {
        discard;
    }
    if (ClassifyGhostMasked(Varying.BodyLocal))
    {
        discard;
    }
    // 📝 Behind the front the shell fades in over ~0.85 m; ahead of it the solid car shows.
    let ScanD = Varying.BodyLocal.x - Ghost.Scan.x;
    let Region = smoothstep(-0.9, -0.05, ScanD);
    let Vis = Region * Ghost.Scan.y;
    if (Vis < 0.003)
    {
        discard;
    }
    var Normal = normalize(Varying.Normal);
    let View = normalize(Frame.CameraPosition - Varying.WorldPosition);
    if (dot(Normal, View) < 0.0)
    {
        Normal = -Normal;
    }
    let Fresnel = pow(1.0 - abs(dot(Normal, View)), 2.3);
    let Lines = smoothstep(0.72, 1.0, sin(Varying.WorldPosition.y * 85.0) * 0.5 + 0.5);
    let Front = (ScanD + 0.18) * 4.2;
    let Edge = exp(-Front * Front);
    let A = (0.028 + Fresnel * 0.50 + Lines * 0.040 + Edge * 0.30) * Vis;
    let Colour = Ghost.Tint.rgb + vec3f(Edge * 1.15);
    // 📝 Premultiplied over the recombined radiance: the emission adds, the background dims through (1 − A).
    return vec4f(Colour * A * Ghost.Tint.w, A);
}

struct GhostEdgeVarying
{
    @builtin(position) Position             : vec4f,
    @location(0) BodyLocal                  : vec3f,   // car-body frame: the edge buffer is the shell's own
}

// 📝 The shell's edges ride with occupant 0; the buffer holds no deforming family, so no deformation applies.
@vertex
fn GhostEdgeVertex(@location(0) Position: vec3f) -> GhostEdgeVarying
{
    let Body = Occupants[0];
    var Varying: GhostEdgeVarying;
    Varying.Position = Frame.ViewProjection * Body.LocalToWorld * vec4f(Position, 1.0);
    Varying.BodyLocal = Position;
    return Varying;
}

@fragment
fn GhostEdgeFragment(Varying: GhostEdgeVarying) -> @location(0) vec4f
{
    if (Ghost.Scan.y < 0.003)
    {
        discard;
    }
    if (ClassifyGhostMasked(Varying.BodyLocal))
    {
        discard;
    }
    let Region = smoothstep(-0.9, -0.05, Varying.BodyLocal.x - Ghost.Scan.x);
    let A = Region * Ghost.Scan.y * Ghost.Scan.z;
    if (A < 0.003)
    {
        discard;
    }
    return vec4f(Ghost.Tint.rgb * A * Ghost.Tint.w, A);
}
