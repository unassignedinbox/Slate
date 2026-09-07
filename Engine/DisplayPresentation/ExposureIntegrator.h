//============================================================================================================================================
//                                                       EXPOSUREINTEGRATOR.H
//============================================================================================================================================
// 🧩 Adaptive exposure — the eye's response to a scene that now spans eight orders of magnitude.
//
//    A3–A5 made the sky real, and with it the dynamic range: a noon sky is ~8 000 cd/m², a moonlit sky ~0.1, a
//    star ~0.001. One fixed exposure slider cannot serve those. Every later phase is blocked on this — aerial
//    perspective is invisible without a correct mid-tone to compare against, and a night sky under a daylight
//    exposure is a black screen with one blown moon disc.
//
//    Named …Integrator because it advances a differential equation over time (CLAUDE.md §2.7): the adapted
//    luminance chases the measured one, and that chase IS the phenomenon. A Solver would be wrong — nothing
//    here is a constraint to satisfy.
//
//    🔴 The measurement is a LOG mean, never a linear one. A linear average is dominated by whatever is
//    brightest, so the sun disc entering frame would drag the mean up by orders of magnitude and black out the
//    whole image. Human brightness perception is roughly logarithmic, and so is this.
//
//    The adaptation is deliberately ASYMMETRIC. Adapting to bright is fast — the iris closes in under a second,
//    and a viewer expects a bright doorway to resolve almost immediately. Adapting to dark is slow, because
//    that is what it is: walking into a dark room, everything is black and then gradually is not. Symmetric
//    rates feel wrong in both directions at once.

#pragma once

#include <cstdint>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

enum class ExposureModeCategory : uint32_t
{
    Manual   = 0u,   // the fixed slider — reproduces every pre-A6b image exactly
    Adaptive = 1u,   // measured from the frame and eased over time
};

struct ExposureConfiguration
{
    ExposureModeCategory Mode = ExposureModeCategory::Adaptive;

    float ManualExposure   = 1.05f;    // [-]   used in Manual mode; also the value Adaptive starts from
    float KeyValue         = 0.18f;    // [-]   the mid-grey a correctly exposed scene should average to
    float BrightenSeconds  = 0.40f;    // [s]   time constant when the scene gets BRIGHTER (iris closes fast)
    float DarkenSeconds    = 2.20f;    // [s]   and when it gets DARKER (dark adaptation is genuinely slow)

    // Bounds on the exposure itself. Without a ceiling, a nearly black frame drives exposure toward infinity
    //    and amplifies pure noise into a grey blizzard; without a floor, staring at the sun drives it to zero
    //    and the image never recovers.
    //
    // ⚠️ The floor has to be genuinely tiny. A noon sky at 8 000 cd/m² needs 2.25e-5 to expose correctly, and
    //    the sun's own disc at 1.6e9 needs 1.1e-10 — a floor of 0.02 would clamp daylight and render it at 160,
    //    i.e. pure white. These bounds exist to stop divergence on a degenerate frame, not to express taste.
    float MinimumExposure  = 1.0e-10f;   // [-] below what the sun's disc alone would ask for
    float MaximumExposure  = 4000.0f;    // [-] a starlit sky at 0.001 cd/m² asks for 180

    // ⚠️ The floor is a METERING floor, not numerical epsilon, and the difference is enormous. This measures a
    //    LOG mean, so a floor of 1e-5 contributes log(1e-5) = −11.5 for every dark pixel. Half a frame of night
    //    sky then drags the mean down by 5.75, the exposure rises by e^5.75 ≈ 300×, and everything lit blows to
    //    white. That is exactly the reported "the box goes full white unless I stand close to it": walking away
    //    shrinks the box, more of the frame is dark, and the meter runs away.
    //
    //    A real light meter does not average absolute black into its reading. 1e-2 cd/m² is below a moonlit sky
    //    at 0.1 and well below anything a viewer is meant to resolve, while contributing only −4.6 instead of
    //    −11.5 — a quarter of the pull.
    float LuminanceFloor   = 1.0e-2f;  // [cd/m²]

    // ⚠️ And a floor alone is not enough: a frame that is 90 % black still drags the mean. Pixels darker than
    //    this are EXCLUDED from the average rather than clamped into it, which is what a spot or centre-weighted
    //    meter does. Without it, exposure depends on how much empty sky happens to be in shot.
    float MeteringFloor    = 1.0e-2f;  // [cd/m²] below this a pixel is not metered at all
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      INTEGRATOR
//------------------------------------------------------------------------------------------------------------------------

class ExposureIntegrator
{
public:
    void AssignConfiguration(const ExposureConfiguration& Value) noexcept { Config = Value; }
    [[nodiscard]] const ExposureConfiguration& QueryConfiguration() const noexcept { return Config; }

    // The frame's measured average log luminance, as produced by the reduction pass. Supplying it separately
    //    from Advance keeps this testable without a GPU: the whole adaptation curve is exercised by feeding a
    //    sequence of measurements.
    void ObserveLuminance(float AverageLogLuminance) noexcept;

    // Ease the adapted value toward the observed one. Δτ is the frame time.
    void Advance(float DeltaSeconds) noexcept;

    // What the tone map should use this frame. This is the ONLY value the renderer reads, so Manual and
    //    Adaptive cannot diverge into two code paths.
    [[nodiscard]] float QueryExposure() const noexcept;

    // The adapted scene luminance, for display.
    [[nodiscard]] float QueryAdaptedLuminance() const noexcept { return AdaptedLuminance; }

    // Jump straight to the measurement, with no easing. For a camera cut or a scene load, where easing would
    //    show the viewer several seconds of the previous scene's exposure.
    void Snap() noexcept { AdaptedLuminance = ObservedLuminance; }

    // Exposure that would render a scene of the given luminance at the key value.
    [[nodiscard]] static float ExposureForLuminance(float Luminance, const ExposureConfiguration& Config) noexcept;

private:
    ExposureConfiguration Config{};
    float ObservedLuminance = 0.18f;   // [cd/m²] the most recent measurement
    float AdaptedLuminance  = 0.18f;   // [cd/m²] what the eye currently believes
};

} // namespace Frontier
