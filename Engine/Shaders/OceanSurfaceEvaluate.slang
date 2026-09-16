//============================================================================================================================================
// Frontier/Engine/Shaders/OceanSurfaceEvaluate.slang — Explicit crest-train surface vertex evaluation
//============================================================================================================================================
// The host uploads the same finite crest trains used by OceanSurfaceSolver. This vertex stage evaluates only the water
// surface geometry. Breaking classification, lifetimes, colour, and particle birth all remain CPU simulation concerns.

#version 460

layout(location = 0) in vec2 InLocalXZ;
layout(location = 0) out vec3 OutNormal;
layout(location = 1) out float OutHeight;

struct OceanWaveGpu
{
    vec4 DirectionAmplitude;             // xy = direction, z = amplitude [m], w = steepness [-]
    vec4 WavelengthPhaseSpeed;           // x = wavelength [m], y = phase [rad], z = speed [m/s], w = unused
};

layout(std140, set = 0, binding = 0) uniform OceanSurfaceConstants
{
    mat4 ViewClip;
    vec4 SurfaceOriginTime;               // xyz = camera-relative origin [m], w = simulation time [s]
    uvec4 WaveCount;
    OceanWaveGpu Waves[9];
};

void main()
{
    vec2 P = InLocalXZ + SurfaceOriginTime.xy;
    float Height = SurfaceOriginTime.z;
    vec2 Slope = vec2(0.0);
    uint Count = min(WaveCount.x, 9u);

    for (uint I = 0u; I < Count; ++I)
    {
        OceanWaveGpu W = Waves[I];
        vec2 Direction = normalize(W.DirectionAmplitude.xy);
        float Wavenumber = 6.28318530718 / max(W.WavelengthPhaseSpeed.x, 0.5);
        float Phase = Wavenumber * (dot(Direction, P) - W.WavelengthPhaseSpeed.z * SurfaceOriginTime.w)
                    + W.WavelengthPhaseSpeed.y;
        float S = sin(Phase);
        float C = cos(Phase);
        float Shape = S + 0.12 * S * abs(S);
        float Derivative = 1.0 + 0.24 * abs(S);
        Height += W.DirectionAmplitude.z * Shape;
        Slope += W.DirectionAmplitude.z * Derivative * Wavenumber * C * Direction;
    }

    vec3 WorldPosition = vec3(P.x, P.y, Height);
    OutNormal = normalize(vec3(-Slope, 1.0));
    OutHeight = Height;
    gl_Position = ViewClip * vec4(WorldPosition, 1.0);
}
