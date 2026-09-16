//============================================================================================================================================
// Frontier/Engine/Shaders/OceanParticleDraw.frag.slang — Round attribute billboard coverage
//============================================================================================================================================

#version 460

layout(location = 0) in vec2 InBillboardUv;
layout(location = 1) in vec4 InTintAlpha;
layout(location = 0) out vec4 OutColour;

void main()
{
    vec2 Radius = InBillboardUv * 2.0 - 1.0;
    float DistanceSquared = dot(Radius, Radius);
    if (DistanceSquared > 1.0) discard;
    float Edge = 1.0 - smoothstep(0.72, 1.0, DistanceSquared);
    OutColour = vec4(InTintAlpha.rgb, InTintAlpha.a * Edge);
}
