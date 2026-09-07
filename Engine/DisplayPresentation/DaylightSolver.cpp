//============================================================================================================================================
//                                                       DAYLIGHTSOLVER.CPP
//============================================================================================================================================

#include "DaylightSolver.h"

#include "AtmosphereModel.h"

#include <cmath>

namespace Frontier {

namespace {

using namespace Frontier::AtmosphereModel;

constexpr float kPi = 3.14159265358979f;

// Rec. 709, the same weighting every other luminance in the renderer uses. A different one here would make the
//    exposure disagree with the tone map about what "bright" means.
float Luma(Vec3 C) noexcept { return 0.2126f * C.x + 0.7152f * C.y + 0.0722f * C.z; }

// ⚠️ Ring counts, not a single number of samples. The sky's radiance varies far more steeply with ELEVATION than
//    with azimuth — the whole interesting structure is a bright band a few degrees above the horizon — so the
//    rings are spaced in a way that puts samples where the variation is, and each ring is averaged over azimuth.
constexpr int kElevationRings = 24;
constexpr int kAzimuthSamples = 8;

} // namespace

float DaylightSolver::QueryIlluminance(float SunIlluminance, float SunElevationRadians, float Turbidity) noexcept
{
    // The cache is the reason this can be called every frame. The integral below is a few hundred thousand
    //    operations; the sun moves 0.2° in about fifty seconds of a real day, and far less than the eye can
    //    follow between one frame and the next.
    if (std::fabs(SunElevationRadians - CachedElevation) <= kElevationTolerance
     && std::fabs(Turbidity - CachedTurbidity) <= kTurbidityTolerance
     && std::fabs(SunIlluminance - CachedSun) <= 1.0f)
        return CachedIlluminance;

    CachedElevation = SunElevationRadians;
    CachedTurbidity = Turbidity;
    CachedSun       = SunIlluminance;

    gAerosolTurbidity = Turbidity > 0.0f ? Turbidity : 1.0f;

    const float SinElevation = std::sin(SunElevationRadians);
    const Vec3  SunDirection = Normalize(Vec3{ 0.0f, std::cos(SunElevationRadians), SinElevation });
    const Vec3  Ground{ 0.0f, 0.0f, kPlanetRadius + 2.0f };

    // ── The direct beam ──────────────────────────────────────────────────────────────────────────────────────
    // Illuminance on a HORIZONTAL surface, so the cosine is the sun's own elevation. Below the horizon there is
    //    no direct term at all — everything at twilight comes from the sky.
    CachedDirect = 0.0f;
    if (SinElevation > 0.0f)
        CachedDirect = SunIlluminance * SinElevation * Luma(SunTransmittance(Ground, SunDirection, 32));

    // ── The sky ──────────────────────────────────────────────────────────────────────────────────────────────
    // ∫ L(ω)·cosθ dω over the upper hemisphere. Sampled on rings of equal solid angle in cos θ so the cosine
    //    weighting is carried by the sampling rather than applied afterwards, which keeps the estimator unbiased
    //    without needing more rings near the zenith where nothing happens.
    double Diffuse = 0.0;
    for (int Ring = 0; Ring < kElevationRings; ++Ring)
    {
        // Uniform in sin²θ gives rings of equal cosine-weighted solid angle: the classic cosine-hemisphere
        //    stratification, so every sample carries the same weight and the sum is a plain mean.
        const float U        = (static_cast<float>(Ring) + 0.5f) / static_cast<float>(kElevationRings);
        const float SinTheta = std::sqrt(U);                       // θ from the zenith
        const float CosTheta = std::sqrt(std::fmax(0.0f, 1.0f - SinTheta * SinTheta));

        for (int Step = 0; Step < kAzimuthSamples; ++Step)
        {
            const float Phi = (static_cast<float>(Step) + 0.5f) / static_cast<float>(kAzimuthSamples) * 2.0f * kPi;
            const Vec3  View{ SinTheta * std::sin(Phi), SinTheta * std::cos(Phi), CosTheta };
            Diffuse += static_cast<double>(Luma(SkyRadiance(2.0f, Normalize(View), SunDirection,
                                                            Vec3(SunIlluminance), 24, 8)));
        }
    }
    // Cosine-weighted hemisphere integral of a constant L is πL, and the samples are already cosine
    //    distributed, so the mean times π is the irradiance.
    CachedDiffuse = static_cast<float>(Diffuse / (kElevationRings * kAzimuthSamples)) * kPi;

    gAerosolTurbidity = 1.0f;   // leave the shared model on its reference atmosphere

    CachedIlluminance = CachedDirect + CachedDiffuse;
    return CachedIlluminance;
}

} // namespace Frontier
