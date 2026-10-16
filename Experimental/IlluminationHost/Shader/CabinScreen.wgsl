//============================================================================================================================================
//                                                           CABINSCREEN.WGSL
//============================================================================================================================================
// 🧩 The cabin HMI screens: the tablet and cluster canvases drawn as emissive quads into the recombined radiance.
//
// 📝 The quads are posed on the CPU (body-local corners through the body transform), so the vertex stage only
//    projects them with the jittered view — the screens reproject with the rest of the frame and the antialiasing
//    settles them. The screen index is flat per vertex, hence non-uniform across the draw, so the sheets sample with
//    explicit level 0. The cluster canvas is transparent outside its outline; the blend carries that.

//! include "FrameDescriptor.wgsl"

struct ScreenUniform
{
    Brightness : vec2f,     // [-] tablet, cluster emission multipliers
}

@group(0) @binding(1) var<uniform> Screens      : ScreenUniform;
@group(0) @binding(2) var TabletSheet           : texture_2d<f32>;
@group(0) @binding(3) var ClusterSheet          : texture_2d<f32>;
@group(0) @binding(4) var SheetSampler          : sampler;

struct ScreenVarying
{
    @builtin(position) Position                 : vec4f,
    @location(0) UV                             : vec2f,
    @location(1) @interpolate(flat) Screen      : u32,
}

@vertex
fn ScreenVertex(@location(0) Position: vec3f, @location(1) UV: vec2f, @location(2) Screen: u32) -> ScreenVarying
{
    var Varying: ScreenVarying;
    Varying.Position = Frame.ViewProjection * vec4f(Position, 1.0);
    Varying.UV = UV;
    Varying.Screen = Screen;
    return Varying;
}

@fragment
fn ScreenFragment(Varying: ScreenVarying) -> @location(0) vec4f
{
    var Sheet: vec4f;
    var Gain: f32;
    if (Varying.Screen == 0u)
    {
        Sheet = textureSampleLevel(TabletSheet, SheetSampler, Varying.UV, 0.0);
        Gain = Screens.Brightness.x;
    }
    else
    {
        Sheet = textureSampleLevel(ClusterSheet, SheetSampler, Varying.UV, 0.0);
        Gain = Screens.Brightness.y;
    }
    return vec4f(Sheet.rgb * Gain, Sheet.a);
}
