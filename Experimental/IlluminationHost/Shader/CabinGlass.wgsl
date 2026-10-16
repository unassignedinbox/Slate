//============================================================================================================================================
//                                                            CABINGLASS.WGSL
//============================================================================================================================================
// 🧩 The cabin glazing: the shell's glass facets blended over the resolved frame — see-through, with a sun glint.
//
// 📝 The glass rides the deferred pass nowhere: its facets are filtered out of the body set at bring-up, so the sun
//    streams through the openings onto the dash and the cabin reads through the windscreen. This pass draws the same
//    vertex records (the glass facet set's span) after the antialiasing with the unjittered view, depth-tested
//    against the opaque surfaces: smoked tint, a fresnel sheen and a hard sun glint off the low roughness.

//! include "FrameDescriptor.wgsl"

struct GlassUniform
{
    LocalToWorld : mat4x4f,    // [-] body transform the glazing rides
    Tint         : vec3f,      // [-] smoked glass colour
    TintStrength : f32,        // [-] 0 clear .. 1 smoked
}

@group(0) @binding(1) var<uniform> Glass : GlassUniform;

struct GlassVarying
{
    @builtin(position) Position             : vec4f,
    @location(0) Normal                     : vec3f,
    @location(1) WorldPosition              : vec3f,
}

@vertex
fn GlassVertex(@location(0) Position: vec3f, @location(1) Family: u32, @location(2) Normal: vec3f,
               @location(3) OccupantOffset: u32) -> GlassVarying
{
    let World = Glass.LocalToWorld * vec4f(Position, 1.0);
    var Varying: GlassVarying;
    Varying.Position = Frame.UnjitteredViewProjection * World;
    Varying.Normal = (Glass.LocalToWorld * vec4f(Normal, 0.0)).xyz;
    Varying.WorldPosition = World.xyz;
    return Varying;
}

@fragment
fn GlassFragment(Varying: GlassVarying) -> @location(0) vec4f
{
    var Normal = normalize(Varying.Normal);
    let View = normalize(Frame.CameraPosition - Varying.WorldPosition);
    if (dot(Normal, View) < 0.0)
    {
        Normal = -Normal;
    }
    let Cosine = max(dot(Normal, View), 0.0);
    let Fresnel = 0.04 + 0.96 * pow(1.0 - Cosine, 5.0);
    let Glint = pow(max(dot(reflect(-View, Normal), Frame.SunDirection), 0.0), 800.0)
              * (Frame.SunIlluminance.x + Frame.SunIlluminance.y + Frame.SunIlluminance.z) * 0.004;
    let Colour = Glass.Tint * Glass.TintStrength + vec3f(0.05, 0.06, 0.07) * Fresnel + vec3f(Glint);
    return vec4f(Colour, clamp(0.05 + Fresnel * 0.85, 0.0, 0.9));
}
