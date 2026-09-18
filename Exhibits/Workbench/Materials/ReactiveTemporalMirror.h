//============================================================================================================================================
//                                               REACTIVETEMPORALMIRROR.H
//============================================================================================================================================
// 🧩 CPU control for the reactive part of ReSTIRViewport.slang's temporal accumulator.
//
// This deliberately models *radiance history*, not exposure. Exposure belongs to tone mapping after accumulation, so
// changing it cannot poison the linear mean. A reprojected sample is reset when its current linear luminance differs
// from the prior mean by more than a relative visibility/luminance threshold plus the prior estimate's standard error.
// The standard-error allowance preserves ordinary Monte-Carlo variation; an abrupt direct-visibility change (moving
// shadow), an animated emitter, or a material response that changes beyond its sampled uncertainty starts new history.
//
// The implementation is header-only because it is a CPU proof fixture, not a production translation unit. Constants and
// operation ordering are intentionally spelled like the shader so DenoiseReprojectionProof's text pins can catch drift.

#pragma once

#include <algorithm>
#include <cmath>

namespace ReactiveTemporalMirror {

constexpr float kTemporalHistoryLengthCap = 32.0f;  // matches ReSTIRViewport.slang
constexpr float kReactiveRelativeThreshold = 0.25f;
constexpr float kReactiveAbsoluteThreshold = 0.02f;
constexpr float kReactiveStandardErrors    = 3.0f;

struct History
{
    float Mean[3]    = { 0.0f, 0.0f, 0.0f };
    float Moments[2] = { 0.0f, 0.0f };             // E[luminance], E[luminance²]
    float Confidence = 0.0f;                        // effective temporal history length, explicitly capped
};

struct Result
{
    History Value{};
    bool Rejected = false;                          // true = reactive change, not geometric disocclusion
};

inline float Luminance(const float Colour[3])
{
    return Colour[0] * 0.2126f + Colour[1] * 0.7152f + Colour[2] * 0.0722f;
}

// The prior moments estimate the error of the *mean*, not the spread of individual path samples. This is deliberately
// conservative for glossy/noisy materials: a bright but statistically plausible sample should not turn every frame into
// a history reset, while a persistent visibility/emission step still exceeds the allowance once the history is stable.
inline bool RejectHistoryForReactiveChange(const History& Previous, const float SampleRadiance[3])
{
    if (Previous.Confidence <= 0.0f) return false;
    const float CurrentLuminance = Luminance(SampleRadiance);
    const float SampleVariance = std::max(Previous.Moments[1] - Previous.Moments[0] * Previous.Moments[0], 0.0f);
    const float StandardError = std::sqrt(SampleVariance / std::max(Previous.Confidence, 1.0f));
    const float Scale = std::max(std::max(std::fabs(CurrentLuminance), std::fabs(Previous.Moments[0])),
                                 kReactiveAbsoluteThreshold);
    const float Allowance = std::max(kReactiveAbsoluteThreshold, kReactiveRelativeThreshold * Scale)
                          + kReactiveStandardErrors * StandardError;
    return std::fabs(CurrentLuminance - Previous.Moments[0]) > Allowance;
}

// `GeometryAccepted` is the normal/depth/object-identity result from ReprojectionMirror / the shader. The reactive
// policy is intentionally only applied after that geometric validation; a geometric disocclusion already means zero
// confidence and does not need a second label.
inline Result Resolve(const History& Previous, const float SampleRadiance[3], bool GeometryAccepted)
{
    Result Out{};
    History Prior = Previous;
    if (!GeometryAccepted) Prior.Confidence = 0.0f;
    Out.Rejected = GeometryAccepted && RejectHistoryForReactiveChange(Prior, SampleRadiance);
    if (Out.Rejected) Prior = History{};

    const float PriorConfidence = std::clamp(Prior.Confidence, 0.0f, kTemporalHistoryLengthCap);
    const float Confidence = std::min(PriorConfidence + 1.0f, kTemporalHistoryLengthCap);
    for (int Channel = 0; Channel < 3; ++Channel)
        Out.Value.Mean[Channel] = Prior.Mean[Channel] + (SampleRadiance[Channel] - Prior.Mean[Channel]) / Confidence;

    const float Luma = Luminance(SampleRadiance);
    Out.Value.Moments[0] = Prior.Moments[0] + (Luma - Prior.Moments[0]) / Confidence;
    Out.Value.Moments[1] = Prior.Moments[1] + (Luma * Luma - Prior.Moments[1]) / Confidence;
    Out.Value.Confidence = Confidence;
    return Out;
}

} // namespace ReactiveTemporalMirror
