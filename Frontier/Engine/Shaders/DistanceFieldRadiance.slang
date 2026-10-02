//============================================================================================================================================
//                                                     DISTANCEFIELDRADIANCE.SLANG
//============================================================================================================================================
// 📦 Jacobi surface-radiance propagation: separate previous/next buffers, direct light, sky and emissive multi-bounce transport.

#version 460
#extension GL_GOOGLE_include_directive : require
layout(local_size_x=64) in;
#include "DistanceFieldTransport.slang"
void main()
{
    uint Index=gl_GlobalInvocationID.x;
    if (Index>=PC.Counts.x) return;
    DistanceVoxel Voxel=Field[Index];
    vec3 Normal=Voxel.Normal.xyz, Position=Voxel.PositionDistance.xyz;
    float Cosine=max(0.0,dot(Normal,normalize(PC.SunDirectionRadiance.xyz)));
    vec3 Direct=PC.SunColour.xyz*PC.SunDirectionRadiance.w*Cosine*DistanceShadow(Position,Normal)/3.14159265359;
    vec3 Indirect=GatherDistanceRadiance(Position,Normal,false);
    vec3 Radiance=Voxel.Emission.xyz+Voxel.Albedo.xyz*(Direct+Indirect);
    // 📝 Energy-bounded diffuse reflectance and separate read/write buffers prevent in-place bounce feedback.
    float Weight=PC.Tuning.z>0.5 ? 1.0 : 0.25;
    NextRadiance[Index]=vec4(mix(PreviousRadiance[Index].xyz,min(Radiance,vec3(65504.0)),Weight),1.0);
}
