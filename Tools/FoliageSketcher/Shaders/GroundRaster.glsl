//============================================================================================================================================
// 📦 GroundRaster.glsl — the forest-floor plane and the draggable collider sphere.
//============================================================================================================================================
// Two tiny phases sharing one file. The ground fades to the sky colour at the horizon so the plane never shows a
//    hard edge; the collider is drawn as a translucent shell so the user can see the plants it is pushing.

//@vertex
#version 300 es
precision highp float;

layout(location = 0) in vec2 PlaneCorner;         // [-] unit quad

uniform mat4  ViewProjection;
uniform float PlaneExtentMetres;
uniform float GroundHeight;

out vec3 VaryWorld;
out vec2 VaryTexcoord;

void main()
{
    vec3 World = vec3(PlaneCorner * PlaneExtentMetres, GroundHeight);
    VaryWorld    = World;
    VaryTexcoord = PlaneCorner * PlaneExtentMetres * 0.35;
    gl_Position  = ViewProjection * vec4(World, 1.0);
}

//@fragment
#version 300 es
precision highp float;
precision highp sampler2D;

in vec3 VaryWorld;
in vec2 VaryTexcoord;

uniform sampler2D GroundAlbedo;
uniform sampler2D GroundNormal;
uniform sampler2D GroundSurface;

uniform vec3  CameraOrigin;
uniform vec3  SunDirection;
uniform vec3  SunRadiance;
uniform vec3  SkyRadiance;
uniform vec3  GroundRadiance;
uniform vec3  HorizonRadiance;
uniform float FadeStartMetres;
uniform int   DebugCategory;

out vec4 OutRadiance;

void main()
{
    vec3 BaseColour = DisplayToLinear(texture(GroundAlbedo, VaryTexcoord).rgb);
    vec3 Surface    = texture(GroundSurface, VaryTexcoord).xyz;
    float Cavity    = Surface.y;

    vec3 Sampled = texture(GroundNormal, VaryTexcoord).xyz * 2.0 - 1.0;
    vec3 Normal  = normalize(vec3(Sampled.x, Sampled.y, max(Sampled.z, 0.2)));

    float Lambert = max(dot(Normal, SunDirection), 0.0);
    vec3  Radiance = BaseColour * SunRadiance * Lambert;
    Radiance += BaseColour * mix(GroundRadiance, SkyRadiance, Normal.z * 0.5 + 0.5) * Cavity;

    // Distance fade into the sky so the finite plane reads as an open forest floor.
    float Distance = length(VaryWorld.xy - CameraOrigin.xy);
    float Fade     = smoothstep(FadeStartMetres, FadeStartMetres * 2.6, Distance);
    vec3  Display  = LinearToDisplay(AcesApproximation(Radiance));
    Display        = mix(Display, LinearToDisplay(HorizonRadiance), Fade);

    if (DebugCategory == 1) { OutRadiance = vec4(LinearToDisplay(BaseColour), 1.0); return; }
    if (DebugCategory == 2) { OutRadiance = vec4(Normal * 0.5 + 0.5, 1.0); return; }
    if (DebugCategory == 3) { OutRadiance = vec4(vec3(0.0), 1.0); return; }
    if (DebugCategory == 5) { OutRadiance = vec4(vec3(Cavity), 1.0); return; }

    OutRadiance = vec4(Display, 1.0);
}
