//============================================================================================================================================
// 📦 ColliderRaster.glsl — the draggable interaction sphere, drawn as a translucent shell with a fresnel rim.
//============================================================================================================================================

//@vertex
#version 300 es
precision highp float;

layout(location = 0) in vec3 ShellPosition;       // [-] unit sphere

uniform mat4  ViewProjection;
uniform vec4  ColliderRecord;                     // xyz = centre [m], w = radius [m]

out vec3 VaryWorld;
out vec3 VaryNormal;

void main()
{
    VaryNormal  = normalize(ShellPosition);
    VaryWorld   = ColliderRecord.xyz + ShellPosition * ColliderRecord.w;
    gl_Position = ViewProjection * vec4(VaryWorld, 1.0);
}

//@fragment
#version 300 es
precision highp float;

in vec3 VaryWorld;
in vec3 VaryNormal;

uniform vec3  CameraOrigin;
uniform vec3  SunDirection;
uniform vec4  ShellTint;                          // rgb = colour, a = base opacity

out vec4 OutRadiance;

void main()
{
    vec3  Normal  = normalize(VaryNormal);
    vec3  View    = normalize(CameraOrigin - VaryWorld);
    float Facing  = abs(dot(Normal, View));
    float Fresnel = pow(1.0 - Facing, 2.4);
    float Lambert = max(dot(Normal, SunDirection), 0.0) * 0.5 + 0.5;

    vec3  Colour  = ShellTint.rgb * Lambert + vec3(Fresnel) * 0.55;
    float Opacity = clamp(ShellTint.a + Fresnel * 0.55, 0.0, 1.0);

    OutRadiance = vec4(LinearToDisplay(Colour), Opacity);
}
