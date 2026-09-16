//============================================================================================================================================
// Frontier/Engine/Shaders/OceanParticleDraw.slang — Attribute-only billboard draw for simulated surface particles
//============================================================================================================================================
// This stage never classifies, births, ages, or patterns particles. It consumes CPU-authored positions, radii, colour,
// and alpha. The fragment stage only clips the round billboard and forwards those authored attributes.

#version 460

struct OceanParticleGpu
{
    vec4 PositionRadius;                 // xyz = world position [m], w = radius [m]
    vec4 TintAlpha;                      // rgb = linear tint, a = simulation-authored alpha
};

layout(std140, set = 0, binding = 0) uniform OceanParticleConstants
{
    mat4 ViewClip;
    vec4 CameraRight;
    vec4 CameraUp;
};

layout(std430, set = 0, binding = 1) readonly buffer OceanParticleExtent
{
    OceanParticleGpu Particles[];
};

layout(location = 0) out vec2 OutBillboardUv;
layout(location = 1) out vec4 OutTintAlpha;

void main()
{
    OceanParticleGpu Particle = Particles[uint(gl_InstanceIndex)];
    const vec2 Corners[6] = vec2[6](
        vec2(-1.0, -1.0), vec2(1.0, -1.0), vec2(1.0, 1.0),
        vec2(-1.0, -1.0), vec2(1.0, 1.0), vec2(-1.0, 1.0));
    vec2 Corner = Corners[gl_VertexIndex];
    vec3 World = Particle.PositionRadius.xyz
               + CameraRight.xyz * Corner.x * Particle.PositionRadius.w
               + CameraUp.xyz * Corner.y * Particle.PositionRadius.w;
    OutBillboardUv = Corner * 0.5 + 0.5;
    OutTintAlpha = Particle.TintAlpha;
    gl_Position = ViewClip * vec4(World, 1.0);
}
