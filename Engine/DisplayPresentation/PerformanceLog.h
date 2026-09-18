//============================================================================================================================================
//                                                        PERFORMANCELOG.H
//============================================================================================================================================
// 🧩 Frame-performance and GPU-stage timing, written to the diagnostic log — the numbers the FPS overlay shows, plus the
//    per-stage GPU breakdown the overlay cannot fit, in the place a report can be copied from.
//
//    The overlay answers "is it smooth?". This answers "where did the frame go?", which is the question a bug report
//    about a slow or a visually wrong frame actually needs: a run that reports `restir 0.00 ms` for six thousand frames
//    is a run where the kernel never ran, and one that reports `shadow —` (never recorded) is a run where the shadow
//    stage was never reached — both invisible in a frame rate, both visible in one line.
//
//    Shape of a window line (every 120 frames, or every 4 s on a slow machine):
//
//        [Performance] 61.4 FPS  16.28 ms  p50 15.94  p95 18.71  p99 24.02  max 41.33  (120 frames)
//                      gpu cull 0.11 raster 1.83 HiZ 0.08 resolve 0.29 kernel 9.41 shadow - restir 9.38 sky 0.42 volume - post 0.63
//
//    and at exit, one summary:
//
//        [Performance] Run summary: 3 604 frames in 61.2 s — mean 16.98 ms / 58.9 FPS, p50 16.4, p95 19.8, p99 27.1, max 63.2.
//        [Performance] Frame-time distribution (ms): <4 0 · 4-8 0 · 8-16 1 729 · 16-33 1 802 · 33-66 71 · 66-133 2 · 133+ 0.
//        [Performance] GPU means: cull 0.11 raster 1.82 HiZ 0.08 resolve 0.29 kernel 9.40 shadow absent restir 9.37 sky 0.42 volume absent post 0.62.
//        [Performance] shadow stage recorded in 0 of 3 604 frames — shadow maps are the GI-OFF path; with GI on, sun
//                       occlusion comes from the kernel's shadow ray.
//
//    BOUNDED BY CONSTRUCTION: a ring of the last 256 frame times for the percentile line, running sums and a log2
//    bucket histogram for the whole run. A ten-hour session costs the same memory as a ten-second one.
//
//    ⚠️ "absent" is not the same as "0.00 ms". A stage that was never recorded reads as absent (the device layer's
//    visibility flag), and each stage carries its own explanation in the summary — the one thing a reader must not do
//    is average an absent stage into the total and call the difference a frame.

#pragma once

#include <array>
#include <cstdint>

namespace Frontier
{
class DiagnosticMetrics;

// The GPU stages this log reports, filled by the caller from VisibilityTelemetry. Kept as plain floats rather than the
//    device type so this unit (and its header) stays buildable in the CPU-only configurations, where there is no
//    Vulkan device to ask.
struct PerformanceStageTimes
{
    float Cull      = 0.0f;   // [ms]
    float Raster    = 0.0f;
    float HiZ       = 0.0f;
    float Resolve   = 0.0f;
    float Kernel    = 0.0f;   // post-resolve compute MINUS the restir dispatch and the shadow stage
    float Shadow    = 0.0f;   // the GI-off shadow-map stage
    float Restir    = 0.0f;   // the ReSTIR dispatch alone
    float Sky       = 0.0f;
    float Volume    = 0.0f;
    float Post      = 0.0f;   // à-trous denoise + luminance
    bool  Valid     = false;  // false until the first readback lands: not "zero", "not measured yet"
};

class FramePerformanceLog
{
public:
    // ⚠️ Named apart from the members on purpose: `WindowSeconds` as both a constant and a member makes the constant
    //    unreachable inside every member function, which is a confusing way to fail to compile.
    static constexpr uint32_t WindowFrameCount     = 120u;   // [frames] one line per this many, or per the seconds below
    static constexpr float    WindowDurationSeconds = 4.0f;  // [s]
    static constexpr uint32_t RingCount    = 256u;   // [frames] the percentile window; the run summary keeps sums + buckets

    FramePerformanceLog() noexcept;

    // One frame. `DeltaSeconds` is the same interval the FPS overlay is fed.
    void RecordFrame(float DeltaSeconds, const PerformanceStageTimes& Gpu) noexcept;

    // Emit the window line when due. Called every frame; logs only when a window closes.
    void FlushIfDue(DiagnosticMetrics& Logger, uint64_t FrameOrdinal) noexcept;

    // The run summary — totals, percentiles, the distribution, the GPU means and which stages never ran.
    void WriteSummary(DiagnosticMetrics& Logger) noexcept;

    [[nodiscard]] uint64_t QueryFrameCount() const noexcept { return FrameCount; }
    [[nodiscard]] float    QueryAverageSeconds() const noexcept { return FrameCount ? TotalSeconds / static_cast<float>(FrameCount) : 0.0f; }

private:
    // Percentile of the ring (0..1), nearest-rank on the copied sample. Q <= 0 gives the minimum.
    [[nodiscard]] float RingPercentile(float Quantile) const noexcept;
    [[nodiscard]] uint32_t BucketOf(float Milliseconds) const noexcept;

    std::array<float, RingCount> Ring{};             // [s] last RingCount frame times
    uint32_t RingCursor = 0u;
    uint32_t RingFilled = 0u;

    uint64_t FrameCount     = 0u;
    double   TotalSeconds   = 0.0;
    float    MaximumSeconds = 0.0f;
    float    MinimumSeconds = 1.0e30f;

    // Window accumulators (reset on every flush).
    uint32_t WindowSamples      = 0u;
    float    WindowElapsedSeconds = 0.0f;
    float    WindowMaxSeconds   = 0.0f;
    bool     WindowGpuValid     = false;   // a readback landed during this window
    std::array<float, 10u> WindowGpuSum{};
    std::array<uint32_t, 10u> WindowGpuCount{};      // per stage: frames where the stage was recorded

    // Run accumulators for the GPU stages (never reset).
    std::array<float, 10u> TotalGpuSum{};
    std::array<uint32_t, 10u> TotalGpuCount{};

    // Run frame-time distribution: log2 buckets by millisecond range (see BucketOf).
    static constexpr uint32_t BucketCount = 8u;
    std::array<uint64_t, BucketCount> Buckets{};

    bool WarnedFirstWindow = false;
};
}   // namespace Frontier
