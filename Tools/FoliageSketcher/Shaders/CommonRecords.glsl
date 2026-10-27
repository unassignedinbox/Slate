//============================================================================================================================================
// 📦 CommonRecords.glsl — shared declarations for every FoliageSketcher phase (include only, prepended by ShaderIndex).
//============================================================================================================================================
// World is right-handed Z-up (CLAUDE.md §7): +X right/east, +Y forward/north, +Z up/zenith. Distances in metres.
//    WebGL clip space is z ∈ [-1, 1] (not Vulkan's [0, 1]); ViewProjection owns that one difference and nothing else
//    in this tool re-derives it.

//------------------------------------------------------------------------------------------------------------------------
//                                                     JOINT ADDRESSING
//------------------------------------------------------------------------------------------------------------------------
// The filament skeleton lives in a square lattice of texels. A joint is addressed by a linear index; these two helpers
//    are the ONLY translation between index and texel and are shared by the solver and every raster phase.

vec2 JointTexcoord(float LinearIndex, vec2 Extent)
{
    float Row    = floor(LinearIndex / Extent.x);
    float Column = LinearIndex - Row * Extent.x;
    return (vec2(Column, Row) + 0.5) / Extent;
}

vec3 FetchJoint(sampler2D Surface, float LinearIndex, vec2 Extent)
{
    return texture(Surface, JointTexcoord(LinearIndex, Extent)).xyz;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   ROTATION BETWEEN AXES
//------------------------------------------------------------------------------------------------------------------------
// Rodrigues rotation carrying unit vector From onto unit vector Onto, applied to Subject. Foliage bones are skinned
//    with this rather than a stored quaternion: one bind axis per card is cheaper than a full frame and never drifts.

vec3 RotateBetween(vec3 From, vec3 Onto, vec3 Subject)
{
    vec3  Axis    = cross(From, Onto);
    float Cosine  = dot(From, Onto);
    float Square  = dot(Axis, Axis);

    if (Square < 1.0e-12)
    {
        // Parallel or antiparallel. Antiparallel needs a 180° turn about any perpendicular axis.
        if (Cosine > 0.0) return Subject;
        vec3 Perpendicular = abs(From.z) < 0.9 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
        vec3 Turn          = normalize(cross(From, Perpendicular));
        return Turn * (2.0 * dot(Turn, Subject)) - Subject;
    }

    float Sine    = sqrt(Square);
    vec3  Unit    = Axis / Sine;
    float Angle   = atan(Sine, Cosine);
    float Cos     = cos(Angle);
    float Sin     = sin(Angle);
    return Subject * Cos + cross(Unit, Subject) * Sin + Unit * dot(Unit, Subject) * (1.0 - Cos);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       WIND FIELD
//------------------------------------------------------------------------------------------------------------------------
// Three octaves of travelling sine — the classic cheap coherent gust field. Identical maths lives in the CPU twin so
//    gameplay code can query the same wind the GPU is applying.

float WindTurbulence(vec3 Location, float Elapsed)
{
    return      sin(dot(Location, vec3(0.41, 0.29, 0.13)) + Elapsed * 1.70)
         + 0.50 * sin(dot(Location, vec3(0.83, -0.57, 0.31)) + Elapsed * 2.90)
         + 0.25 * sin(dot(Location, vec3(1.70, 1.10, -0.70)) + Elapsed * 4.70);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      TONE RESPONSE
//------------------------------------------------------------------------------------------------------------------------

vec3 AcesApproximation(vec3 Radiance)
{
    const float A = 2.51, B = 0.03, C = 2.43, D = 0.59, E = 0.14;
    return clamp((Radiance * (A * Radiance + B)) / (Radiance * (C * Radiance + D) + E), 0.0, 1.0);
}

vec3 LinearToDisplay(vec3 Linear)
{
    return pow(max(Linear, vec3(0.0)), vec3(1.0 / 2.2));
}

vec3 DisplayToLinear(vec3 Encoded)
{
    return pow(max(Encoded, vec3(0.0)), vec3(2.2));
}
