//============================================================================================================================================
//                                                          VEHICLEOVERLAY.WGSL
//============================================================================================================================================
// 🧩 Screen-door-free ghost fill and antialiased triangle edges for the live vehicle, over the deferred scene.

//! include "FrameDescriptor.wgsl"
//! include "SurfaceReflectance.wgsl"
//! include "EffectRecords.wgsl"
//! include "TyreCarcass.wgsl"

@group(0) @binding(1) var<storage, read> Occupants    : array<OccupantRecord>;
@group(0) @binding(2) var<storage, read> Materials    : array<MaterialRecord>;
@group(0) @binding(3) var<storage, read> VehicleState : VehicleRecord;
@group(0) @binding(4) var<uniform> Effect           : EffectRecord;

const VehicleOccupantCount : u32 = 5u;

struct VehicleViewVarying
{
    @builtin(position) Position             : vec4f,
    @location(0) Normal                     : vec3f,
    @location(1) @interpolate(flat) Family  : u32,
    @location(2) WorldPosition              : vec3f,
    @location(3) BodyLocal                  : vec3f,
    @location(4) @interpolate(flat) Vehicle : u32,
    @location(5) Barycentric                : vec3f,
}

@vertex
fn VehicleViewVertex(@location(0) Position: vec3f, @location(1) Family: u32, @location(2) Normal: vec3f,
                     @location(3) OccupantOffset: u32, @builtin(vertex_index) VertexIndex: u32,
                     @builtin(instance_index) OccupantIndex: u32) -> VehicleViewVarying
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
    var Barycentric = vec3f(0.0);
    switch (VertexIndex % 3u)
    {
        case 0u: { Barycentric.x = 1.0; }
        case 1u: { Barycentric.y = 1.0; }
        default: { Barycentric.z = 1.0; }
    }
    var Varying: VehicleViewVarying;
    Varying.Position = Frame.ViewProjection * World;
    Varying.Normal = (Occupant.LocalToWorld * vec4f(Moved.Normal, 0.0)).xyz;
    Varying.Family = select(Family, Occupant.MaterialOverride, Occupant.MaterialOverride != NoMaterialOverride);
    Varying.WorldPosition = World.xyz;
    Varying.BodyLocal = (Occupants[0].WorldToLocal * World).xyz;
    Varying.Vehicle = select(0u, 1u, Index < VehicleOccupantCount);
    Varying.Barycentric = Barycentric;
    return Varying;
}

// 📝 Match the deferred and mirror passes: cells that have released in a derez/rez are not filled back in by the
//    transparent overlay.
fn IsDerezMasked(BodyLocal: vec3f) -> bool
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

@fragment
fn VehicleViewFragment(Varying: VehicleViewVarying) -> @location(0) vec4f
{
    let Mode = u32(Frame.VehicleVisual.x + 0.5); // 0 solid, 1 ghost, 2 wireframe
    if (Mode == 0u || Varying.Vehicle == 0u)
    {
        discard;
    }
    if ((Varying.Family == VehicleGlassFamily && VehicleState.Cabin.y > 0.5) || Varying.Family == MirrorGlassFamily)
    {
        discard;
    }
    if (IsDerezMasked(Varying.BodyLocal))
    {
        discard;
    }

    let Normal = normalize(Varying.Normal);
    let View = normalize(Frame.CameraPosition - Varying.WorldPosition);
    let Facing = abs(dot(Normal, View));
    let Fresnel = pow(1.0 - Facing, 2.4);
    let Edge = min(Varying.Barycentric.x, min(Varying.Barycentric.y, Varying.Barycentric.z));
    let EdgeWidth = max(fwidth(Edge) * 1.65, 0.0015);
    let EdgeLine = 1.0 - smoothstep(EdgeWidth, EdgeWidth * 2.0, Edge);
    let EdgeColour = vec3f(0.24, 0.78, 1.0);

    if (Mode == 2u)
    {
        if (EdgeLine < 0.25)
        {
            discard;
        }
        let Alpha = 0.92;
        return vec4f(EdgeColour * Alpha, Alpha);
    }

    let Surface = ProjectSurfaceSample(Materials[Varying.Family]);
    let Base = mix(Surface.Albedo, vec3f(0.07, 0.48, 0.68), 0.36 + 0.16 * Fresnel);
    let Colour = mix(Base + Fresnel * vec3f(0.08, 0.28, 0.38), EdgeColour, EdgeLine * 0.88);
    let FillAlpha = clamp(Frame.VehicleVisual.y, 0.05, 0.68);
    let Alpha = max(FillAlpha + Fresnel * 0.10, EdgeLine * 0.82);
    return vec4f(Colour * Alpha, Alpha);
}
