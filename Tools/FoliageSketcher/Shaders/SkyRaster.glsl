//============================================================================================================================================
// 📦 SkyRaster.glsl — full-surface gradient sky with a sun disc, drawn behind everything at maximum depth.
//============================================================================================================================================

//@vertex
#version 300 es
precision highp float;

uniform mat4 InverseViewProjection;
uniform vec3 CameraOrigin;

out vec3 VaryRay;

void main()
{
    vec2 Corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    vec2 Ndc    = Corner * 2.0 - 1.0;

    vec4 Near = InverseViewProjection * vec4(Ndc, -1.0, 1.0);
    vec4 Far  = InverseViewProjection * vec4(Ndc,  1.0, 1.0);
    VaryRay   = normalize(Far.xyz / Far.w - Near.xyz / Near.w);

    // z = w places the fragment exactly on the far plane; the depth test keeps it behind all geometry.
    gl_Position = vec4(Ndc, 1.0, 1.0);
}

//@fragment
#version 300 es
precision highp float;

in vec3 VaryRay;

uniform vec3 SunDirection;
uniform vec3 ZenithRadiance;
uniform vec3 HorizonRadiance;
uniform vec3 SunRadiance;

out vec4 OutRadiance;

void main()
{
    vec3  Ray     = normalize(VaryRay);
    float Upward  = clamp(Ray.z * 0.5 + 0.5, 0.0, 1.0);

    vec3 Radiance = mix(HorizonRadiance, ZenithRadiance, pow(Upward, 0.62));

    // Sun disc plus a wide forward-scattering halo.
    float Alignment = max(dot(Ray, SunDirection), 0.0);
    Radiance += SunRadiance * pow(Alignment, 900.0) * 12.0;
    Radiance += SunRadiance * pow(Alignment, 12.0) * 0.16;

    OutRadiance = vec4(LinearToDisplay(AcesApproximation(Radiance)), 1.0);
}
