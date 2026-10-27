//============================================================================================================================================
// 📦 FoliageRaster.glsl — instanced leaf / flower / grass cards skinned to the GPU filament skeleton.
//============================================================================================================================================
// Each card is one instanced quad. The vertex phase fetches the two joints its bone spans, rebuilds the bone frame
//    from their CURRENT solved positions, and places the card in that frame — so every card follows the physics
//    without a single byte travelling back to the CPU.
//
// Shading is a two-sided foliage response: Lambert on the lit face plus a wrapped transmission lobe on the far face,
//    driven by the translucency channel the bake wrote. That transmission is what makes overgrown foliage read as
//    living plant matter rather than green cardboard.

//@vertex
#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 CardCorner;          // [-] unit quad, x ∈ [−0.5, 0.5], y ∈ [0, 1]

// Per-instance card record.
layout(location = 1) in vec4 CardBone;            // x = joint A, y = joint B, z = along [-], w = scale [m]
layout(location = 2) in vec4 CardRect;            // xy = sheet origin [uv], zw = sheet size [uv]
layout(location = 3) in vec4 CardOrient;          // x = yaw [rad], y = pitch [rad], z = roll [rad], w = anchor V
layout(location = 4) in vec4 CardTint;            // xyz = tint multiplier, w = aspect (cutout width ÷ height)

uniform sampler2D CurrentSurface;
uniform vec2      JointExtent;
uniform mat4      ViewProjection;
uniform float     ElapsedTime;
uniform vec4      WindCriteria;
uniform vec3      WindDirection;

out vec2  VaryTexcoord;
out vec3  VaryWorld;
out vec3  VaryNormal;
out vec3  VaryTangent;
out vec3  VaryTint;

void main()
{
    vec3 JointA = FetchJoint(CurrentSurface, CardBone.x, JointExtent);
    vec3 JointB = FetchJoint(CurrentSurface, CardBone.y, JointExtent);

    vec3  Along  = JointB - JointA;
    float Span   = length(Along);
    vec3  Growth = Span > 1.0e-6 ? Along / Span : vec3(0.0, 0.0, 1.0);
    vec3  Origin = mix(JointA, JointB, CardBone.z);

    // Bone frame: Growth is the bone axis; Side and Face complete a right-handed basis.
    vec3 Reference = abs(Growth.z) > 0.94 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
    vec3 Side      = normalize(cross(Reference, Growth));
    vec3 Face      = cross(Growth, Side);

    // ── Card frame ───────────────────────────────────────────────────────────────────────────────────────────────
    // yaw spins the petiole around the bone; pitch lifts or droops the blade away from it; roll twists the blade
    //    about its own length. Built as a strict orthonormal triple so the shading normal is exact.
    float SinYaw = sin(CardOrient.x), CosYaw = cos(CardOrient.x);
    vec3  Stem   = Side * CosYaw + Face * SinYaw;                 // ⊥ Growth
    vec3  Across = cross(Growth, Stem);                           // ⊥ the Stem/Growth plane

    float SinPitch = sin(CardOrient.y), CosPitch = cos(CardOrient.y);
    vec3  Blade    = normalize(Stem * CosPitch + Growth * SinPitch);

    float SinRoll = sin(CardOrient.z), CosRoll = cos(CardOrient.z);
    vec3  Normal0 = cross(Blade, Across);
    vec3  Rolled  = normalize(Across * CosRoll + Normal0 * SinRoll);
    vec3  Normal  = normalize(cross(Blade, Rolled));

    // Per-card flutter: nudge the blade so no two cards move in lockstep. Amplitude follows card size, because a
    //    big leaf flaps and a small one merely trembles.
    // Gated on wind strength for the same reason the solver's flutter is: with the wind at zero the viewport must
    //    be perfectly still, otherwise "settled" can never be seen.
    float Phase   = CardBone.x * 0.618 + CardOrient.x * 2.0;
    float Shiver  = WindCriteria.w * 0.055 * (1.0 + WindCriteria.z) * min(1.0, WindCriteria.x * 0.35)
                  * sin(ElapsedTime * 6.2 + Phase) * (0.4 + 0.6 * clamp(CardBone.w * 6.0, 0.0, 1.0));
    vec3  Fluttered = normalize(Blade + Rolled * Shiver + WindDirection * Shiver * 0.35);
    Normal = normalize(cross(Fluttered, Rolled));

    // Anchor V: the bake recorded where the petiole sits, so the card pivots at its stem, not its centre.
    // Aspect keeps the cutout's proportions — CardScale is the length along the blade, width follows from it.
    float Reach  = CardOrient.w;
    float Aspect = max(CardTint.w, 0.05);
    vec2  Local  = vec2(CardCorner.x * Aspect, CardCorner.y - (1.0 - Reach));
    vec3  World  = Origin + Rolled * (Local.x * CardBone.w) + Fluttered * (Local.y * CardBone.w);

    VaryTexcoord = CardRect.xy + vec2(CardCorner.x + 0.5, 1.0 - CardCorner.y) * CardRect.zw;
    VaryWorld    = World;
    VaryNormal   = Normal;
    VaryTangent  = Rolled;
    VaryTint     = CardTint.xyz;

    gl_Position = ViewProjection * vec4(World, 1.0);
}

//@fragment
#version 300 es
precision highp float;
precision highp sampler2D;

in vec2  VaryTexcoord;
in vec3  VaryWorld;
in vec3  VaryNormal;
in vec3  VaryTangent;
in vec3  VaryTint;

uniform sampler2D AlbedoSheet;
uniform sampler2D NormalSheet;
uniform sampler2D SurfaceSheet;

uniform vec3  CameraOrigin;
uniform vec3  SunDirection;            // [-] unit, pointing FROM the surface TOWARD the sun
uniform vec3  SunRadiance;             // [-] linear
uniform vec3  SkyRadiance;             // [-] linear
uniform vec3  GroundRadiance;          // [-] linear
uniform float AlphaCutoff;
uniform int   DebugCategory;           // 0 shaded, 1 albedo, 2 normal, 3 translucency, 4 wireframe-ish, 5 AO

out vec4 OutRadiance;

void main()
{
    vec4 Albedo = texture(AlbedoSheet, VaryTexcoord);

    // Alpha-to-coverage would be nicer, but a hard cutoff keeps the depth prepass exact and costs nothing.
    if (Albedo.a < AlphaCutoff) discard;

    vec3  Surface = texture(SurfaceSheet, VaryTexcoord).xyz;
    float Roughness    = Surface.x;
    float Occlusion    = Surface.y;
    float Translucency = Surface.z;

    // Tangent-space normal from the vein relief, folded into the card frame.
    vec3 Sampled  = texture(NormalSheet, VaryTexcoord).xyz * 2.0 - 1.0;
    vec3 Geometric = normalize(VaryNormal);
    vec3 Tangent   = normalize(VaryTangent - Geometric * dot(Geometric, VaryTangent));
    vec3 Bitangent = cross(Geometric, Tangent);
    vec3 Normal    = normalize(Tangent * Sampled.x * 0.6 + Bitangent * Sampled.y * 0.6 + Geometric);

    // Cards are two-sided: flip toward the viewer so back-facing leaves are lit, not black.
    vec3 View = normalize(CameraOrigin - VaryWorld);
    if (dot(Normal, View) < 0.0) Normal = -Normal;

    vec3 BaseColour = DisplayToLinear(Albedo.rgb) * VaryTint;

    // ── Direct ───────────────────────────────────────────────────────────────────────────────────────────────────
    float Lambert = max(dot(Normal, SunDirection), 0.0);

    // Wrapped transmission: light arriving on the far face bleeds through thin lamina. The 1/π-ish normalisation
    //    keeps energy sane; the exponent tightens it toward the sun so back-lit foliage rims hot.
    float Behind      = max(dot(-Normal, SunDirection), 0.0);
    float Through     = pow(max(dot(-View, SunDirection), 0.0), 3.0);
    float Transmitted = (Behind * 0.55 + Through * 0.85) * Translucency;

    // Foliage specular is a broad sheen, not a highlight — Blinn-Phong with a roughness-mapped exponent is plenty.
    vec3  Half      = normalize(SunDirection + View);
    float Sheen     = pow(max(dot(Normal, Half), 0.0), mix(64.0, 6.0, Roughness)) * (1.0 - Roughness) * 0.22;

    vec3 Radiance = BaseColour * SunRadiance * Lambert;
    Radiance += BaseColour * SunRadiance * Transmitted;
    Radiance += SunRadiance * Sheen * Lambert;

    // ── Ambient ──────────────────────────────────────────────────────────────────────────────────────────────────
    // Hemisphere fill: sky above, bounced earth below, weighted by the baked cavity term.
    float Upward = Normal.z * 0.5 + 0.5;
    Radiance += BaseColour * mix(GroundRadiance, SkyRadiance, Upward) * Occlusion;

    if (DebugCategory == 1) { OutRadiance = vec4(LinearToDisplay(BaseColour), 1.0); return; }
    if (DebugCategory == 2) { OutRadiance = vec4(Normal * 0.5 + 0.5, 1.0); return; }
    if (DebugCategory == 3) { OutRadiance = vec4(vec3(Translucency), 1.0); return; }
    if (DebugCategory == 5) { OutRadiance = vec4(vec3(Occlusion), 1.0); return; }

    OutRadiance = vec4(LinearToDisplay(AcesApproximation(Radiance)), 1.0);
}
