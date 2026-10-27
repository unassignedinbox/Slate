//============================================================================================================================================
// 📦 BranchRaster.glsl — bark tubes swept along the solved filament skeleton.
//============================================================================================================================================
// A branch segment is an instanced tube ring pair. Like the foliage cards, the vertex phase reads the two joints of
//    its bone from the solved surface, so bark bends with the physics rather than being a static trunk with animated
//    leaves stapled on. Radius tapers from the base of the plant to the tip along the same curve the growth used.

//@vertex
#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 RingCorner;          // x = angle fraction [0,1], y = end selector (0 = A, 1 = B)

layout(location = 1) in vec4 TubeBone;            // x = joint A, y = joint B, z = radius A [m], w = radius B [m]
layout(location = 2) in vec4 TubeCriteria;        // x = uv repeats around, y = bark tint, zw = spare
layout(location = 3) in vec4 TubeFrameA;          // xyz = ring reference at joint A, w = bark V at A
layout(location = 4) in vec4 TubeFrameB;          // xyz = ring reference at joint B, w = bark V at B

uniform sampler2D CurrentSurface;
uniform vec2      JointExtent;
uniform mat4      ViewProjection;

out vec2  VaryTexcoord;
out vec3  VaryWorld;
out vec3  VaryNormal;
out vec3  VaryTangent;
out float VaryTint;

const float Tau = 6.28318530718;

void main()
{
    vec3 JointA = FetchJoint(CurrentSurface, TubeBone.x, JointExtent);
    vec3 JointB = FetchJoint(CurrentSurface, TubeBone.y, JointExtent);

    vec3  Along  = JointB - JointA;
    float Span   = length(Along);
    vec3  Growth = Span > 1.0e-6 ? Along / Span : vec3(0.0, 0.0, 1.0);

    // The ring reference comes from the growth pass, where it was parallel-transported along the strand. Picking
    //    an axis here instead — from world up, say — makes every segment choose a different angle zero, so the
    //    bark twists between rings and a limb looks like a stack of loose cans rather than one swept surface.
    //    Interpolating between the two ends keeps the sweep continuous across the bone.
    vec3 Reference = normalize(mix(TubeFrameA.xyz, TubeFrameB.xyz, RingCorner.y));

    // Gram-Schmidt against the CURRENT bone direction: physics has bent the bone since growth, and the ring has
    //    to stay perpendicular to it or it shears into an ellipse.
    vec3 Planar = Reference - Growth * dot(Growth, Reference);
    if (dot(Planar, Planar) < 1.0e-8)
    {
        vec3 Fallback = abs(Growth.z) > 0.94 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
        Planar = Fallback - Growth * dot(Growth, Fallback);
    }

    vec3 Side = normalize(Planar);
    vec3 Face = cross(Growth, Side);

    float Angle  = RingCorner.x * Tau;
    vec3  Radial = Side * cos(Angle) + Face * sin(Angle);

    vec3  Centre = mix(JointA, JointB, RingCorner.y);
    float Radius = mix(TubeBone.z, TubeBone.w, RingCorner.y);
    vec3  World  = Centre + Radial * Radius;

    // V comes from the arc length baked at each joint, so it is continuous across every segment boundary.
    VaryTexcoord = vec2(RingCorner.x * TubeCriteria.x,
                        mix(TubeFrameA.w, TubeFrameB.w, RingCorner.y));
    VaryWorld    = World;
    VaryNormal   = Radial;
    VaryTangent  = Growth;
    VaryTint     = TubeCriteria.y;

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
in float VaryTint;

uniform sampler2D BarkAlbedo;
uniform sampler2D BarkNormal;
uniform sampler2D BarkSurface;

uniform vec3  CameraOrigin;
uniform vec3  SunDirection;
uniform vec3  SunRadiance;
uniform vec3  SkyRadiance;
uniform vec3  GroundRadiance;
uniform int   DebugCategory;

out vec4 OutRadiance;

void main()
{
    vec3 BaseColour = DisplayToLinear(texture(BarkAlbedo, VaryTexcoord).rgb) * VaryTint;
    vec3 Surface    = texture(BarkSurface, VaryTexcoord).xyz;
    float Roughness = Surface.x;
    float Cavity    = Surface.y;

    vec3 Sampled   = texture(BarkNormal, VaryTexcoord).xyz * 2.0 - 1.0;
    vec3 Geometric = normalize(VaryNormal);
    vec3 Tangent   = normalize(VaryTangent - Geometric * dot(Geometric, VaryTangent));
    vec3 Bitangent = cross(Geometric, Tangent);
    vec3 Normal    = normalize(Bitangent * Sampled.x + Tangent * Sampled.y + Geometric * max(Sampled.z, 0.15));

    vec3 View = normalize(CameraOrigin - VaryWorld);

    // Wrapped diffuse. A trunk is a vertical cylinder and the sun is overhead, so the true Lambert term is ~0 on
    //    every side of it and bark renders as a black cutout — which is exactly how it looked. Wrapping the
    //    terminator past the horizon stands in for the bounce a trunk really receives from the canopy and litter
    //    around it, and costs nothing.
    const float Wrap = 0.42;
    float Lambert = max((dot(Normal, SunDirection) + Wrap) / (1.0 + Wrap), 0.0);

    vec3  Half  = normalize(SunDirection + View);
    float Sheen = pow(max(dot(Normal, Half), 0.0), mix(48.0, 4.0, Roughness)) * (1.0 - Roughness) * 0.10;

    vec3 Radiance = BaseColour * SunRadiance * Lambert;
    Radiance += SunRadiance * Sheen * max(dot(Normal, SunDirection), 0.0);

    float Upward = Normal.z * 0.5 + 0.5;
    Radiance += BaseColour * mix(GroundRadiance, SkyRadiance, Upward) * Cavity * 1.45;

    if (DebugCategory == 1) { OutRadiance = vec4(LinearToDisplay(BaseColour), 1.0); return; }
    if (DebugCategory == 2) { OutRadiance = vec4(Normal * 0.5 + 0.5, 1.0); return; }
    if (DebugCategory == 3) { OutRadiance = vec4(vec3(0.0), 1.0); return; }
    if (DebugCategory == 5) { OutRadiance = vec4(vec3(Cavity), 1.0); return; }

    OutRadiance = vec4(LinearToDisplay(AcesApproximation(Radiance)), 1.0);
}
