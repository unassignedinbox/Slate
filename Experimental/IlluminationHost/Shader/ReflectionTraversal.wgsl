//============================================================================================================================================
//                                                         REFLECTIONTRAVERSAL.WGSL
//============================================================================================================================================
// 🧩 Glossy reflection rays: a GGX visible-normal sample per resampling pixel, traced through the scene distance field.

// 📝 The specular counterpart of the indirect candidate: the reflected ray reads card radiance where it lands and the
//    sky where it escapes. Surfaces rougher than RoughnessCutoff are left to the resolve, which substitutes the
//    diffuse irradiance there exactly as Lumen reuses its diffuse gather for rough reflections.

//! include "CardSampling.wgsl"
//! include "SurfaceReflectance.wgsl"
//! include "PackingCodec.wgsl"
//! include "DiscrepancySequence.wgsl"

@group(0) @binding(1) var<storage, read> Materials : array<MaterialRecord>;
@group(0) @binding(2) var SurfaceAttributes        : texture_2d<f32>;
@group(0) @binding(3) var SurfaceDepth             : texture_depth_2d;
@group(0) @binding(4) var ReflectionTarget         : texture_storage_2d<rgba16float, write>;

const RoughnessCutoff   : f32 = 0.5;
// 📝 The glazing: 4 mm of the laminate DriveSceneAuthor's windscreen is, and the 26–30 % the material's own note quotes,
//    carried as a slightly green tint as real automotive glass is.
const GlassThickness    : f32 = 0.004;
const GlassTransmittance : vec3f = vec3f(0.29, 0.31, 0.30);

// 📐 Heitz 2018, "Sampling the GGX Distribution of Visible Normals"; view in tangent space, α = roughness².
fn ProjectVisibleNormal(View: vec3f, α: f32, Pair: vec2f) -> vec3f
{
    let Stretched = normalize(vec3f(α * View.x, α * View.y, View.z));
    let LengthSquared = Stretched.x * Stretched.x + Stretched.y * Stretched.y;
    let T1 = select(vec3f(1.0, 0.0, 0.0), vec3f(-Stretched.y, Stretched.x, 0.0) * inverseSqrt(LengthSquared), LengthSquared > 0.0);
    let T2 = cross(Stretched, T1);
    let Radius = sqrt(Pair.x);
    let φ = 2.0 * Pi * Pair.y;
    let P1 = Radius * cos(φ);
    let Interpolant = 0.5 * (1.0 + Stretched.z);
    let P2 = mix(sqrt(max(0.0, 1.0 - P1 * P1)), Radius * sin(φ), Interpolant);
    let Hemisphere = P1 * T1 + P2 * T2 + sqrt(max(0.0, 1.0 - P1 * P1 - P2 * P2)) * Stretched;
    return normalize(vec3f(α * Hemisphere.x, α * Hemisphere.y, max(0.0, Hemisphere.z)));
}

@compute @workgroup_size(8, 8)
fn TraverseReflection(@builtin(global_invocation_id) Invocation: vec3u)
{
    let TracePixel = Invocation.xy;
    if (any(vec2f(TracePixel) >= Frame.TraceExtent))
    {
        return;
    }
    let ScreenPixel = min(vec2i(TracePixel * Frame.TraceScale), vec2i(Frame.ScreenExtent) - vec2i(1));
    let Depth = textureLoad(SurfaceDepth, ScreenPixel, 0);
    if (Depth <= 0.0)
    {
        textureStore(ReflectionTarget, vec2i(TracePixel), vec4f(0.0));
        return;
    }
    let Attributes = textureLoad(SurfaceAttributes, ScreenPixel, 0);
    let Surface = ProjectWeatheredSample(Materials[u32(Attributes.z + 0.5)], Attributes.w);
    let Roughness = select(Surface.Roughness, Surface.CoatRoughness, Surface.CoatWeight > 0.0);
    if (Roughness > RoughnessCutoff)
    {
        textureStore(ReflectionTarget, vec2i(TracePixel), vec4f(0.0));
        return;
    }
    let Position = ReconstructWorldPosition(vec2f(ScreenPixel) + 0.5, Depth);
    let Normal = DecodeOctahedral(Attributes.xy);
    let View = normalize(Frame.CameraPosition - Position);
    let Bias = ResolveSurfaceBias(Position);
    // 📐 Glass: this channel carries what came *through* the pane rather than what reflected off it. The ray is bent by
    //    thin-pane refraction (entering glass from air at 1.52) and started at the pane's far face, so it leaves the
    //    glazing behind and the march reads the cabin, the road or the sky beyond it. The pane's own 28 % transmittance
    //    is the only thing standing between the two, which is why smoked glazing reads as a dark window, not a mirror.
    if (FeatureEnabled(Frame, FeatureGlass) && Surface.Transmission > 0.5)
    {
        var Through = refract(-View, Normal, 1.0 / 1.52);
        if (all(Through == vec3f(0.0)))
        {
            Through = reflect(-View, Normal);
        }
        let Chord = GlassThickness / max(abs(dot(Through, Normal)), 1.0e-3);
        let Origin = Position + Through * Chord + Normal * Bias;
        let Behind = TraverseSceneDistance(Origin, Through, 0.5 * Bias, 300.0, 0.02);
        let Radiance = ResolveTraversalRadiance(Behind, Through) * GlassTransmittance;
        textureStore(ReflectionTarget, vec2i(TracePixel), vec4f(min(Radiance, vec3f(200.0)), 1.0));
        return;
    }
    let Frame3 = ConstructTangentFrame(Normal);
    let TangentView = transpose(Frame3) * View;
    let Pair = ProjectTemporalPair(TracePixel, Frame.FrameIndex, 29u);
    let Half = Frame3 * ProjectVisibleNormal(TangentView, Roughness * Roughness, Pair);
    var Direction = reflect(-View, Half);
    if (dot(Direction, Normal) <= 0.0)
    {
        Direction = reflect(-View, Normal);
    }
    let Hit = TraverseSceneDistance(Position + Normal * Bias, Direction, 0.5 * Bias, 300.0, Roughness * 0.05);
    let Radiance = ResolveTraversalRadiance(Hit, Direction);
    textureStore(ReflectionTarget, vec2i(TracePixel), vec4f(min(Radiance, vec3f(200.0)), 1.0));
}
