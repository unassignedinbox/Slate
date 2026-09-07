//============================================================================================================================================
//                                                       ATMOSPHEREMODEL.H
//============================================================================================================================================
// 🧩 The atmosphere, on the CPU. A line-for-line port of Engine/Shaders/AtmosphereScattering.slang, in one place
//    that both the engine and the proofs read.
//
//    🔴 WHY IT IS HERE AND NOT IN Scratchpad. It began as part of the atmosphere proof, which was the only thing
//    that needed the model without a device. Adaptive exposure now needs it too — it has to know how much light
//    the sky is actually putting on the scene, and that is an integral over the sky, not something a frame of
//    pixels can be asked for. Copying the port to a second site would have made three descriptions of one
//    atmosphere; the third would have drifted, and the drift would have shown up as an exposure that disagreed
//    with the sky it was exposing for.
//
//    ⚠️ Header-only and inline, deliberately. The shader is the authority and this follows it; keeping them in
//    step is what CheckAtmosphereScattering.sh exists for, and it greps THIS file. A .cpp would add a build
//    entry to every unit that wants a sky number and buy nothing.
//
//    Everything here is float and single-precision to match the shader exactly. Do not "improve" it to double:
//    the proof's job is to reproduce what the GPU computes, including where that loses precision.

#pragma once

#include <cmath>

namespace Frontier::AtmosphereModel {

struct Vec3
{
    float x = 0.0f, y = 0.0f, z = 0.0f;
    Vec3() = default;
    Vec3(float X, float Y, float Z) : x(X), y(Y), z(Z) {}
    explicit Vec3(float S) : x(S), y(S), z(S) {}
};

inline Vec3 operator+(Vec3 a, Vec3 b) { return { a.x + b.x, a.y + b.y, a.z + b.z }; }
inline Vec3 operator-(Vec3 a, Vec3 b) { return { a.x - b.x, a.y - b.y, a.z - b.z }; }
inline Vec3 operator*(Vec3 a, Vec3 b) { return { a.x * b.x, a.y * b.y, a.z * b.z }; }
inline Vec3 operator*(Vec3 a, float s) { return { a.x * s, a.y * s, a.z * s }; }
inline Vec3 operator/(Vec3 a, Vec3 b) { return { a.x / b.x, a.y / b.y, a.z / b.z }; }
inline Vec3& operator+=(Vec3& a, Vec3 b) { a = a + b; return a; }
inline Vec3& operator*=(Vec3& a, Vec3 b) { a = a * b; return a; }
inline float Dot(Vec3 a, Vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline float Length(Vec3 a) { return std::sqrt(Dot(a, a)); }
inline Vec3 Normalize(Vec3 a) { const float L = Length(a); return L > 0.0f ? a * (1.0f / L) : a; }
inline Vec3 Exp(Vec3 a) { return { std::exp(a.x), std::exp(a.y), std::exp(a.z) }; }
inline Vec3 Max(Vec3 a, Vec3 b) { return { std::fmax(a.x, b.x), std::fmax(a.y, b.y), std::fmax(a.z, b.z) }; }

// ── Constants: must match AtmosphereScattering.slang exactly ────────────────────────────────────────────────
constexpr float kPlanetRadius        = 6360000.0f;
constexpr float kAtmosphereThickness =  100000.0f;
constexpr float kAtmosphereRadius    = kPlanetRadius + kAtmosphereThickness;
constexpr float kRayleighScaleHeight = 8000.0f;
constexpr float kMieScaleHeight      = 1200.0f;
inline const     Vec3  kRayleighScattering  { 5.802e-6f, 13.558e-6f, 33.1e-6f };
constexpr float kMieScattering       = 3.996e-6f;   // at turbidity 1
constexpr float kMieExtinction       = 4.440e-6f;   // at turbidity 1
constexpr float kMieAsymmetry        = 0.80f;
inline const     Vec3  kOzoneAbsorption     { 0.650e-6f, 1.881e-6f, 0.085e-6f };
constexpr float kOzoneCentre         = 25000.0f;
constexpr float kOzoneWidth          = 15000.0f;
constexpr float kSunAngularRadius    = 0.004675f;
constexpr float kGroundAlbedo        = 0.10f;      // A7c: the planet has a surface

// A7b turbidity. A mutable global exactly as in the shader, and for the same reason: the alternative is a float
//    threaded through six functions, and the site that gets missed is silent.
inline float gAerosolTurbidity = 1.0f;
inline float MieScattering() { return kMieScattering * gAerosolTurbidity; }
inline float MieExtinction() { return kMieExtinction * gAerosolTurbidity; }

inline Vec3 AtmosphereDensity(float Altitude)
{
    const float Rayleigh = std::exp(-std::fmax(Altitude, 0.0f) / kRayleighScaleHeight);
    const float Mie      = std::exp(-std::fmax(Altitude, 0.0f) / kMieScaleHeight);
    const float Ozone    = std::fmax(0.0f, 1.0f - std::fabs(Altitude - kOzoneCentre) / kOzoneWidth);
    return { Rayleigh, Mie, Ozone };
}

inline float RaySphereNearest(Vec3 Origin, Vec3 Direction, float Radius)
{
    const float b = Dot(Origin, Direction);
    const float c = Dot(Origin, Origin) - Radius * Radius;
    const float Discriminant = b * b - c;
    if (Discriminant < 0.0f) return -1.0f;
    const float Root = std::sqrt(Discriminant);
    const float Near = -b - Root;
    const float Far  = -b + Root;
    if (Far < 0.0f) return -1.0f;
    return Near >= 0.0f ? Near : Far;
}

inline float RayleighPhase(float CosAngle)
{
    return 3.0f / (16.0f * 3.14159265f) * (1.0f + CosAngle * CosAngle);
}

inline float MiePhase(float CosAngle, float g)
{
    const float g2 = g * g;
    const float Numerator   = 3.0f * (1.0f - g2) * (1.0f + CosAngle * CosAngle);
    const float Denominator = 8.0f * 3.14159265f * (2.0f + g2) * std::pow(1.0f + g2 - 2.0f * g * CosAngle, 1.5f);
    return Numerator / std::fmax(Denominator, 1e-9f);
}

inline Vec3 OpticalDepth(Vec3 Origin, Vec3 Direction, float Distance, int Steps)
{
    const float Step = Distance / static_cast<float>(Steps);
    Vec3 Sum{};
    for (int i = 0; i < Steps; ++i)
    {
        const Vec3  Position = Origin + Direction * ((static_cast<float>(i) + 0.5f) * Step);
        const float Altitude = Length(Position) - kPlanetRadius;
        const Vec3  Density  = AtmosphereDensity(Altitude);
        Sum += (kRayleighScattering * Density.x
              + Vec3(MieExtinction()) * Density.y
              + kOzoneAbsorption    * Density.z) * Step;
    }
    return Sum;
}

inline Vec3 SunTransmittance(Vec3 Position, Vec3 SunDirection, int Steps)
{
    if (RaySphereNearest(Position, SunDirection, kPlanetRadius) > 0.0f) return Vec3(0.0f);
    const float ToSpace = RaySphereNearest(Position, SunDirection, kAtmosphereRadius);
    if (ToSpace < 0.0f) return Vec3(1.0f);
    return Exp(OpticalDepth(Position, SunDirection, ToSpace, Steps) * -1.0f);
}

// Lambertian, so the radiance leaving the surface does not depend on where it is viewed from.
inline Vec3 GroundReflection(Vec3 Normal, Vec3 SunDirection, Vec3 SunIlluminance, Vec3 SunSurvival, Vec3 SkyIrradiance)
{
    const float CosSun = std::fmax(Dot(Normal, SunDirection), 0.0f);
    return (SunIlluminance * SunSurvival * CosSun + SkyIrradiance) * (kGroundAlbedo / 3.14159265f);
}

inline Vec3 SkyRadiance(float CameraAltitude, Vec3 ViewDirection, Vec3 SunDirection,
                        Vec3 SunIlluminance, int ViewSteps, int LightSteps)
{
    const Vec3 Origin{ 0.0f, 0.0f, kPlanetRadius + std::fmax(CameraAltitude, 1.0f) };

    float Distance = RaySphereNearest(Origin, ViewDirection, kAtmosphereRadius);
    if (Distance < 0.0f) return Vec3(0.0f);
    const float Ground = RaySphereNearest(Origin, ViewDirection, kPlanetRadius);
    if (Ground > 0.0f) Distance = std::fmin(Distance, Ground);

    const float CosTheta      = Dot(ViewDirection, SunDirection);
    const float PhaseRayleigh = RayleighPhase(CosTheta);
    const float PhaseMie      = MiePhase(CosTheta, kMieAsymmetry);

    const float Step = Distance / static_cast<float>(ViewSteps);
    Vec3 Radiance{};
    Vec3 Transmittance(1.0f);

    const bool HitsGround = Ground > 0.0f;   // A7c: the ray ends on the planet, not in space

    for (int i = 0; i < ViewSteps; ++i)
    {
        const Vec3  Position = Origin + ViewDirection * ((static_cast<float>(i) + 0.5f) * Step);
        const float Altitude = Length(Position) - kPlanetRadius;
        const Vec3  Density  = AtmosphereDensity(Altitude);

        const Vec3 Extinction = kRayleighScattering * Density.x
                              + Vec3(MieExtinction()) * Density.y
                              + kOzoneAbsorption    * Density.z;
        const Vec3 StepTransmittance = Exp(Extinction * -Step);

        const Vec3 ScatteringHere = kRayleighScattering * Density.x * PhaseRayleigh
                                  + Vec3(MieScattering()) * Density.y * PhaseMie;

        const Vec3 SunArriving = SunTransmittance(Position, SunDirection, LightSteps);
        const Vec3 Integrated  = (ScatteringHere - ScatteringHere * StepTransmittance) / Max(Extinction, Vec3(1e-9f));

        Radiance      += Transmittance * SunArriving * Integrated * SunIlluminance;
        Transmittance *= StepTransmittance;
    }

    // A7c — the ground. Single scattering has no sky-irradiance term to offer, so this path lights the surface
    //    with the direct beam alone; the kernel's tabulated path adds the multiple-scattering term.
    if (HitsGround)
    {
        const Vec3 Surface = Origin + ViewDirection * Distance;
        const Vec3 Normal  = Normalize(Surface);
        Radiance += Transmittance * GroundReflection(Normal, SunDirection, SunIlluminance,
                                                     SunTransmittance(Surface, SunDirection, LightSteps),
                                                     Vec3(0.0f));
    }
    return Radiance;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              PORT OF THE A2 LOOKUP TABLES
//------------------------------------------------------------------------------------------------------------------------

constexpr unsigned kTransmittanceWidth  = 256u;
constexpr unsigned kTransmittanceHeight = 64u;
constexpr unsigned kMultiScatterSize    = 32u;

inline void TransmittanceInverse(float U, float V, float& Altitude, float& CosSunZenith)
{
    Altitude     = V * V * kAtmosphereThickness;
    CosSunZenith = U * 2.0f - 1.0f;
}

inline Vec3 ComputeTransmittanceTexel(float U, float V)
{
    float Altitude, CosSunZenith;
    TransmittanceInverse(U, V, Altitude, CosSunZenith);
    const Vec3  Origin{ 0.0f, 0.0f, kPlanetRadius + Altitude };
    const float SinZenith = std::sqrt(std::fmax(0.0f, 1.0f - CosSunZenith * CosSunZenith));
    const Vec3  Direction{ SinZenith, 0.0f, CosSunZenith };
    if (RaySphereNearest(Origin, Direction, kPlanetRadius) > 0.0f) return Vec3(0.0f);
    const float ToSpace = RaySphereNearest(Origin, Direction, kAtmosphereRadius);
    if (ToSpace <= 0.0f) return Vec3(1.0f);
    return Exp(OpticalDepth(Origin, Direction, ToSpace, 64) * -1.0f);
}

inline Vec3 ComputeMultiScatterTexel(float U, float V, int Directions, int Steps)
{
    float Altitude, CosSunZenith;
    TransmittanceInverse(U, V, Altitude, CosSunZenith);
    const Vec3  Origin{ 0.0f, 0.0f, kPlanetRadius + Altitude };
    const float SinZenith = std::sqrt(std::fmax(0.0f, 1.0f - CosSunZenith * CosSunZenith));
    const Vec3  SunDirection{ SinZenith, 0.0f, CosSunZenith };

    Vec3 SecondOrder{}, Transfer{};
    for (int i = 0; i < Directions; ++i)
    {
        const float Fraction = (static_cast<float>(i) + 0.5f) / static_cast<float>(Directions);
        const float CosTheta = 1.0f - 2.0f * Fraction;
        const float SinTheta = std::sqrt(std::fmax(0.0f, 1.0f - CosTheta * CosTheta));
        const float Phi      = static_cast<float>(i) * 2.39996323f;
        const Vec3  Ray{ SinTheta * std::cos(Phi), SinTheta * std::sin(Phi), CosTheta };

        float Distance = RaySphereNearest(Origin, Ray, kAtmosphereRadius);
        const float Ground = RaySphereNearest(Origin, Ray, kPlanetRadius);
        if (Ground > 0.0f) Distance = std::fmin(Distance, Ground);
        if (Distance <= 0.0f) continue;

        const float Step = Distance / static_cast<float>(Steps);
        Vec3 RayTransmittance(1.0f);
        for (int j = 0; j < Steps; ++j)
        {
            const Vec3  Position = Origin + Ray * ((static_cast<float>(j) + 0.5f) * Step);
            const float H        = Length(Position) - kPlanetRadius;
            const Vec3  Density  = AtmosphereDensity(H);
            const Vec3  Extinction = kRayleighScattering * Density.x
                                   + Vec3(MieExtinction()) * Density.y
                                   + kOzoneAbsorption    * Density.z;
            const Vec3  Scattering = kRayleighScattering * Density.x + Vec3(MieScattering()) * Density.y;
            const Vec3  StepTransmittance = Exp(Extinction * -Step);
            const Vec3  Integrated = (Scattering - Scattering * StepTransmittance) / Max(Extinction, Vec3(1e-9f));
            const Vec3  SunArriving = SunTransmittance(Position, SunDirection, 16);
            SecondOrder += RayTransmittance * SunArriving * Integrated * (1.0f / (4.0f * 3.14159265f));
            Transfer    += RayTransmittance * Integrated * (1.0f / (4.0f * 3.14159265f));
            RayTransmittance *= StepTransmittance;
        }
    }
    const float Weight = 4.0f * 3.14159265f / static_cast<float>(Directions);
    SecondOrder = SecondOrder * Weight;
    Transfer    = Transfer * Weight;
    const Vec3 Series = Vec3(1.0f) / Max(Vec3(1.0f) - Vec3(std::fmin(Transfer.x, 0.999f), std::fmin(Transfer.y, 0.999f), std::fmin(Transfer.z, 0.999f)), Vec3(1e-4f));
    return SecondOrder * Series;
}

//------------------------------------------------------------------------------------------------------------------------

// A sun direction at a given elevation, in the engine's Z-up frame. Shared because "where is the sun" is a
//    question the exposure asks as often as the proofs do.
inline Vec3 SunAtElevation(float Degrees)
{
    const float R = Degrees * 3.14159265f / 180.0f;
    return Normalize(Vec3{ 0.0f, std::cos(R), std::sin(R) });
}

inline const Vec3 kZenith{ 0.0f, 0.0f, 1.0f };
constexpr float kSunLux = 120000.0f;
constexpr int   kView = 64, kLight = 16;

} // namespace Frontier::AtmosphereModel
