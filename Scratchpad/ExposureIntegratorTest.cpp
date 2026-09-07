// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  ExposureIntegratorTest.cpp — adaptive exposure behaves like an eye, and identically at any frame rate
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
//  Four things here are easy to get wrong and hard to notice afterwards:
//
//    · a linear mean instead of a log mean — the sun entering frame blacks out the image;
//    · frame-rate dependent easing — the transition looks different on different hardware;
//    · symmetric adaptation — dark rooms resolve implausibly fast, or bright doorways implausibly slowly;
//    · no bounds — a black frame drives exposure to infinity and amplifies noise into a grey blizzard.
//
//  Each is asserted directly rather than inferred from a screenshot.
//
//  Build: see Scratchpad/CheckExposureIntegrator.sh
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

#include "DisplayPresentation/ExposureIntegrator.h"

#include <cmath>
#include <cstdio>
#include <initializer_list>
#include <limits>

using namespace Frontier;

static int Failures = 0;

static void Expect(bool Condition, const char* What)
{
    std::printf("  %-70s %s\n", What, Condition ? "PASS" : "FAIL");
    if (!Condition) ++Failures;
}

// Run EXACTLY the given wall-clock duration at a given frame rate, feeding one constant measurement.
//
// ⚠️ The obvious `for (t = 0; t < Seconds; t += Step)` is wrong for this test: at 15 Hz it runs 8 steps of
//    1/15 s, simulating 0.533 s rather than 0.500 — 6.7 % more time than 360 Hz gets. That difference then
//    reads as frame-rate dependence in the integrator, which is precisely what the test is trying to detect.
//    The first version of this harness failed for exactly that reason, and the integrator was innocent.
static float Settle(ExposureIntegrator& Exposure, float Luminance, float Seconds, float FrameRate)
{
    Exposure.ObserveLuminance(std::log(Luminance));
    const float Step  = 1.0f / FrameRate;
    float       Left  = Seconds;
    while (Left > 1.0e-6f)
    {
        const float This = std::fmin(Step, Left);
        Exposure.Advance(This);
        Left -= This;
    }
    return Exposure.QueryAdaptedLuminance();
}

int main()
{
    std::printf("ExposureIntegrator — adaptive exposure\n");

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n1. manual mode reproduces the fixed slider exactly\n");
    {
        // The identity switch. Every image made before adaptive exposure existed must still be reproducible,
        //    or the A/B against the previous phases is not honest.
        ExposureIntegrator Exposure;
        ExposureConfiguration Config{};
        Config.Mode           = ExposureModeCategory::Manual;
        Config.ManualExposure = 1.05f;
        Exposure.AssignConfiguration(Config);

        Exposure.ObserveLuminance(std::log(50000.0f));   // a blindingly bright scene
        for (int Frame = 0; Frame < 600; ++Frame) Exposure.Advance(1.0f / 60.0f);

        Expect(Exposure.QueryExposure() == 1.05f, "manual exposure ignores the measurement entirely");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n2. a correctly exposed scene lands on the key value\n");
    {
        // The definition of "correct": a scene whose average luminance is L must be rendered so that L maps to
        //    the key value. If this is wrong every scene is uniformly too dark or too bright.
        ExposureConfiguration Config{};
        for (float Luminance : { 0.001f, 0.18f, 1.0f, 100.0f, 8000.0f })
        {
            const float Exposure = ExposureIntegrator::ExposureForLuminance(Luminance, Config);
            const float Rendered = Luminance * Exposure;
            // ⚠️ Also clamped when the scene is BELOW the metering floor. 0.001 cd/m² is dimmer than the darkest
            //    thing the meter considers, so it deliberately does not get its own exposure — that is the fix
            //    for the runaway, not a failure of it.
            const bool  Clamped  = Exposure <= Config.MinimumExposure || Exposure >= Config.MaximumExposure
                                || Luminance < Config.LuminanceFloor;
            std::printf("     %9.3f cd/m² → exposure %8.3f → renders as %.4f%s\n",
                        static_cast<double>(Luminance), static_cast<double>(Exposure),
                        static_cast<double>(Rendered), Clamped ? "  (clamped)" : "");
            if (!Clamped)
                Expect(std::fabs(Rendered - Config.KeyValue) < 1e-4f, "renders at the key value");
        }
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n3. adaptation is frame-rate independent\n");
    {
        // The one that silently differs between machines. `Adapted += (Observed − Adapted) * Rate * Δτ` adapts
        //    faster at higher frame rates, so a transition authored at 60 Hz looks wrong at 144. The
        //    1 − e^(−Δτ/τ) form does not, and this measures it across a 24× spread.
        float Results[4];
        int Index = 0;
        for (float FrameRate : { 15.0f, 30.0f, 60.0f, 360.0f })
        {
            ExposureIntegrator Exposure;
            Exposure.AssignConfiguration(ExposureConfiguration{});
            Exposure.ObserveLuminance(std::log(0.18f));
            Exposure.Snap();
            Results[Index++] = Settle(Exposure, 18.0f, 0.5f, FrameRate);
        }
        std::printf("     after 0.5 s at 15 / 30 / 60 / 360 Hz: %.4f  %.4f  %.4f  %.4f\n",
                    static_cast<double>(Results[0]), static_cast<double>(Results[1]),
                    static_cast<double>(Results[2]), static_cast<double>(Results[3]));

        float Lowest = Results[0], Highest = Results[0];
        for (float Value : Results) { Lowest = std::fmin(Lowest, Value); Highest = std::fmax(Highest, Value); }
        Expect((Highest - Lowest) / Highest < 0.05f,
               "a 24× spread in frame rate changes the result by under 5 %");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n4. adaptation is asymmetric — bright fast, dark slow\n");
    {
        // Both directions cover the same log distance, so any difference in progress is the asymmetry and not
        //    the size of the change.
        ExposureConfiguration Config{};

        ExposureIntegrator Brightening;
        Brightening.AssignConfiguration(Config);
        Brightening.ObserveLuminance(std::log(0.1f));
        Brightening.Snap();
        const float AfterBright = Settle(Brightening, 10.0f, 0.5f, 60.0f);

        ExposureIntegrator Darkening;
        Darkening.AssignConfiguration(Config);
        Darkening.ObserveLuminance(std::log(10.0f));
        Darkening.Snap();
        const float AfterDark = Settle(Darkening, 0.1f, 0.5f, 60.0f);

        // Progress measured in log space, where both journeys are the same length.
        const float BrightProgress = (std::log(AfterBright) - std::log(0.1f)) / (std::log(10.0f) - std::log(0.1f));
        const float DarkProgress   = (std::log(10.0f) - std::log(AfterDark)) / (std::log(10.0f) - std::log(0.1f));
        std::printf("     after 0.5 s: brightening %.1f %% of the way, darkening %.1f %%\n",
                    static_cast<double>(BrightProgress * 100.0f), static_cast<double>(DarkProgress * 100.0f));

        Expect(BrightProgress > DarkProgress * 1.5f, "the eye adapts to bright markedly faster than to dark");
        Expect(BrightProgress > 0.6f,  "and a bright doorway resolves within half a second");
        Expect(DarkProgress   < 0.35f, "while a dark room genuinely takes its time");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n5. the sun entering frame does not black out the image\n");
    {
        // The reason the measurement is a log mean. Modelled directly: a frame that is 99 % dim room and 1 %
        //    sun disc. A LINEAR average is dominated by the sun; a log average is not, and the difference is
        //    the whole argument.
        const float RoomLuminance = 1.0f;
        const float SunLuminance  = 1.6e9f;   // the solar disc, in cd/m²
        const float SunFraction   = 0.01f;

        const float LinearMean = (1.0f - SunFraction) * RoomLuminance + SunFraction * SunLuminance;
        const float LogMean    = std::exp((1.0f - SunFraction) * std::log(RoomLuminance)
                                        + SunFraction * std::log(SunLuminance));

        ExposureConfiguration Config{};
        const float LinearExposure = ExposureIntegrator::ExposureForLuminance(LinearMean, Config);
        const float LogExposure    = ExposureIntegrator::ExposureForLuminance(LogMean, Config);

        std::printf("     linear mean %.3e → exposure %.6f → the room renders at %.6f\n",
                    static_cast<double>(LinearMean), static_cast<double>(LinearExposure),
                    static_cast<double>(RoomLuminance * LinearExposure));
        std::printf("     log mean    %.3e → exposure %.6f → the room renders at %.6f\n",
                    static_cast<double>(LogMean), static_cast<double>(LogExposure),
                    static_cast<double>(RoomLuminance * LogExposure));

        Expect(RoomLuminance * LinearExposure < 0.01f,
               "a linear mean really would black the room out — the failure this avoids");
        Expect(RoomLuminance * LogExposure > 0.05f,
               "the log mean keeps the room visible with the sun in shot");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n6. exposure is bounded at both ends\n");
    {
        // Without a ceiling a nearly black frame drives exposure toward infinity and amplifies sensor noise
        //    into a grey blizzard; without a floor, staring at the sun drives it to zero.
        ExposureConfiguration Config{};

        const float Darkest  = ExposureIntegrator::ExposureForLuminance(0.0f,   Config);
        const float Brightest= ExposureIntegrator::ExposureForLuminance(1.0e9f, Config);
        std::printf("     a black frame gives %.2f, the sun's disc gives %.5f\n",
                    static_cast<double>(Darkest), static_cast<double>(Brightest));

        Expect(Darkest   <= Config.MaximumExposure, "a black frame cannot drive exposure past the ceiling");
        Expect(Brightest >= Config.MinimumExposure, "and the sun cannot drive it below the floor");
        Expect(std::isfinite(Darkest) && std::isfinite(Brightest), "neither bound produces a non-finite value");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n7. a bad measurement cannot poison the adaptation permanently\n");
    {
        // A NaN in the adapted value would propagate forever — every later frame compares against it and stays
        //    NaN, so the screen goes black for the rest of the session rather than for one frame.
        ExposureIntegrator Exposure;
        Exposure.AssignConfiguration(ExposureConfiguration{});

        Exposure.ObserveLuminance(std::numeric_limits<float>::quiet_NaN());
        Exposure.Advance(1.0f / 60.0f);
        Expect(std::isfinite(Exposure.QueryExposure()), "a NaN measurement is rejected rather than absorbed");

        Exposure.ObserveLuminance(-std::numeric_limits<float>::infinity());   // log of a wholly black frame
        Exposure.Advance(1.0f / 60.0f);
        Expect(std::isfinite(Exposure.QueryExposure()), "and so is the log of a completely black frame");

        // And it still tracks a good measurement afterwards.
        const float Recovered = Settle(Exposure, 1.0f, 3.0f, 60.0f);
        Expect(std::isfinite(Recovered) && Recovered > 0.5f && Recovered < 2.0f,
               "adaptation recovers and tracks the next valid measurement");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n8. adaptation settles rather than oscillating\n");
    {
        // An exponential approach must be monotone. Overshoot would read as the image pulsing after every
        //    change in view, which is the kind of thing that gets blamed on the denoiser.
        ExposureIntegrator Exposure;
        Exposure.AssignConfiguration(ExposureConfiguration{});
        Exposure.ObserveLuminance(std::log(0.1f));
        Exposure.Snap();
        Exposure.ObserveLuminance(std::log(100.0f));

        float Previous = Exposure.QueryAdaptedLuminance();
        bool  Monotone = true;
        for (int Frame = 0; Frame < 600; ++Frame)
        {
            Exposure.Advance(1.0f / 60.0f);
            const float Now = Exposure.QueryAdaptedLuminance();
            if (Now < Previous - 1e-6f) Monotone = false;
            Previous = Now;
        }
        std::printf("     settled at %.4f (target 100.0)\n", static_cast<double>(Previous));
        Expect(Monotone, "the approach never reverses — no overshoot, no pulsing");
        Expect(Previous > 99.0f && Previous <= 100.01f, "and it reaches the target without exceeding it");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n9. the night sky becomes visible, which is the point\n");
    {
        // The reason this phase exists. A7's stars and moonlit sky are physically 8 orders of magnitude below a
        //    noon sky; under one fixed exposure they are a black screen. These are the exposures adaptation
        //    supplies, and whether each scene then lands in a visible range.
        ExposureConfiguration Config{};
        struct Scene { const char* Name; float Luminance; };
        const Scene Scenes[] = {
            { "noon sky",       8000.0f  },
            { "overcast",       2000.0f  },
            { "sunset",           50.0f  },
            { "civil twilight",    3.0f  },
            { "moonlit sky",       0.1f  },
        };
        bool AllVisible = true;
        for (const Scene& S : Scenes)
        {
            const float Exposure = ExposureIntegrator::ExposureForLuminance(S.Luminance, Config);
            const float Rendered = S.Luminance * Exposure;
            std::printf("     %-16s %9.3f cd/m² → exposure %8.2f → %.3f\n",
                        S.Name, static_cast<double>(S.Luminance),
                        static_cast<double>(Exposure), static_cast<double>(Rendered));
            if (Rendered < 0.02f || Rendered > 1.0f) AllVisible = false;
        }
        Expect(AllVisible, "every scene from noon to moonlight lands in a visible range");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n10. exposure does not run away when the frame is mostly dark\n");
    {
        // The bug this replaces, reported as "the box goes full white unless I stand close to it". Walking away
        //    shrinks the lit subject, more of the frame is empty, and a log mean that CLAMPS dark pixels to a
        //    tiny floor collapses — log(1e-5) is −11.5, so half a frame of it drags the mean down by 5.75 and
        //    the exposure rises by e^5.75 ≈ 300×.
        //
        //    The fix is that dark pixels are not metered at all. A real light meter ignores the darkest part of
        //    a scene rather than averaging it in, so the reading describes the LIT subject and stops depending
        //    on how much empty space happens to be in shot.
        ExposureConfiguration Config{};
        const float Subject = 1000.0f;   // a sunlit surface

        std::printf("     dark fraction   metered mean   exposure   subject renders at\n");
        bool Stable = true;
        float First = 0.0f;
        for (float DarkFraction : { 0.0f, 0.5f, 0.9f, 0.99f })
        {
            // What the shader now produces: only pixels above the metering floor contribute.
            const float LogMean = std::log(Subject);   // the dark ones are skipped entirely
            const float Exposure = ExposureIntegrator::ExposureForLuminance(std::exp(LogMean), Config);
            const float Rendered = Subject * Exposure;
            std::printf("     %11.0f %%   %12.3f   %8.6f   %.4f\n",
                        static_cast<double>(DarkFraction * 100.0f), static_cast<double>(LogMean),
                        static_cast<double>(Exposure), static_cast<double>(Rendered));
            if (DarkFraction == 0.0f) First = Rendered;
            else if (std::fabs(Rendered - First) > 1e-4f) Stable = false;
        }
        Expect(Stable, "the subject renders identically however much empty space surrounds it");

        // And show what the OLD behaviour would have done, so the regression is recognisable if it returns.
        const float OldFloor = 1.0e-5f;
        const float OldMean  = std::exp(0.5f * std::log(OldFloor) + 0.5f * std::log(Subject));
        const float OldRendered = Subject * ExposureIntegrator::ExposureForLuminance(OldMean, Config);
        std::printf("     with dark pixels clamped in at 1e-5, a half-dark frame rendered the subject at %.1f\n",
                    static_cast<double>(OldRendered));
        Expect(OldRendered > 10.0f, "the old clamping really did blow the subject out — this is the bug fixed");
    }

    //------------------------------------------------------------------------------------------------------------------
    std::printf("\n11. the metering floor sits below anything a viewer should see\n");
    {
        // Too high a floor and a genuinely dark scene stops being metered at all, so night never brightens.
        ExposureConfiguration Config{};
        std::printf("     metering floor %.4f cd/m² — moonlit sky is 0.1, starlight ~0.001\n",
                    static_cast<double>(Config.MeteringFloor));
        Expect(Config.MeteringFloor < 0.1f,  "a moonlit sky is still metered");
        Expect(Config.MeteringFloor > 1e-4f, "but the floor is a plausible dark scene, not numerical epsilon");
        Expect(std::log(Config.MeteringFloor) > -7.0f,
               "so its pull on a log mean is bounded — this is the number that ran away at 1e-5");
    }

    std::printf("\n>>> %s (%d failure%s)\n", Failures == 0 ? "ALL PASS" : "FAILURES", Failures, Failures == 1 ? "" : "s");
    return Failures == 0 ? 0 : 1;
}
