#include "PerformanceLog.h"

#include "../DeviceExchange/DiagnosticMetrics.h"

#include <algorithm>
#include <cstdio>
#include <string>

namespace Frontier
{
namespace
{
// Names in binding order, so the loop that accumulates and the loop that prints cannot disagree about which column is
//    which. The summary prints `absent` for a stage whose count is zero — see the header's note on "absent" vs "0.00".
constexpr const char* kStageNames[10] = { "cull", "raster", "HiZ", "resolve", "kernel", "shadow", "restir", "sky", "volume", "post" };

void FormatStages(char* Buffer, size_t Capacity, const float* Sums, const uint32_t* Counts)
{
    // `-` means "no non-zero measurement in this window" — never "measured zero". The summary names the reason for
    //    each stage that reads that way; the per-window line stays short enough to sit in a log.
    std::string Text;
    for (uint32_t I = 0u; I < 10u; ++I)
    {
        char Cell[64];
        if (Counts[I] == 0u)
            std::snprintf(Cell, sizeof(Cell), "%s%s -", I ? " " : "", kStageNames[I]);
        else
            std::snprintf(Cell, sizeof(Cell), "%s%s %.2f", I ? " " : "", kStageNames[I],
                          static_cast<double>(Sums[I] / static_cast<float>(Counts[I])));
        Text += Cell;
    }
    std::snprintf(Buffer, Capacity, "%s", Text.c_str());
}

void Emit(DiagnosticMetrics& Logger, std::string_view Category, const char* Text)
{
    Logger.RecordMessage(DiagnosticSeverity::Information, Category, Text);
}
}   // namespace

FramePerformanceLog::FramePerformanceLog() noexcept { Ring.fill(0.0f); }

void FramePerformanceLog::RecordFrame(float DeltaSeconds, const PerformanceStageTimes& Gpu) noexcept
{
    if (!(DeltaSeconds > 0.0f) || DeltaSeconds > 60.0f) return;   // a stall longer than a minute is not a frame time

    Ring[RingCursor] = DeltaSeconds;
    RingCursor = (RingCursor + 1u) % RingCount;
    RingFilled = std::min(RingFilled + 1u, RingCount);

    ++FrameCount;
    TotalSeconds   += static_cast<double>(DeltaSeconds);
    MaximumSeconds  = std::max(MaximumSeconds, DeltaSeconds);
    MinimumSeconds  = std::min(MinimumSeconds, DeltaSeconds);
    ++Buckets[BucketOf(DeltaSeconds * 1000.0f)];

    ++WindowSamples;
    WindowElapsedSeconds += DeltaSeconds;
    WindowMaxSeconds      = std::max(WindowMaxSeconds, DeltaSeconds);

    if (!Gpu.Valid) return;   // the readback has not landed: nothing to attribute yet
    WindowGpuValid = true;
    const float Stages[10] = { Gpu.Cull, Gpu.Raster, Gpu.HiZ, Gpu.Resolve, Gpu.Kernel,
                               Gpu.Shadow, Gpu.Restir, Gpu.Sky, Gpu.Volume, Gpu.Post };
    for (uint32_t I = 0u; I < 10u; ++I)
    {
        // ⚠️ A zero is ambiguous: the stage may not have run (the shadow stage is never recorded with GI on), or it may
        //    have run and finished below the timestamp resolution. The two cannot be told apart from the number alone,
        //    so the rule is uniform and the LABEL carries the meaning: a stage with no non-zero frame in the whole
        //    window reads as `-` (not measured), never as `0.00` (measured and free), and the run summary says which
        //    reading applies to each stage that came out `-`.
        if (Stages[I] == 0.0f) continue;
        WindowGpuSum[I]   += Stages[I];
        ++WindowGpuCount[I];
        TotalGpuSum[I]    += Stages[I];
        ++TotalGpuCount[I];
    }
}

void FramePerformanceLog::FlushIfDue(DiagnosticMetrics& Logger, uint64_t FrameOrdinal) noexcept
{
    if (WindowSamples == 0u) return;
    if (WindowSamples < WindowFrameCount && WindowElapsedSeconds < WindowDurationSeconds) return;

    const float MeanSeconds = WindowElapsedSeconds / static_cast<float>(WindowSamples);
    char Line[512];

    std::snprintf(Line, sizeof(Line),
                  "%.1f FPS  %.2f ms  p50 %.2f  p95 %.2f  p99 %.2f  max %.2f  (%u frames, frame %llu; percentiles over the last %u)",
                  
                  MeanSeconds > 0.0f ? 1.0f / MeanSeconds : 0.0f, static_cast<double>(MeanSeconds * 1000.0f),
                  static_cast<double>(RingPercentile(0.50f) * 1000.0f),
                  static_cast<double>(RingPercentile(0.95f) * 1000.0f),
                  static_cast<double>(RingPercentile(0.99f) * 1000.0f),
                  static_cast<double>(WindowMaxSeconds * 1000.0f), WindowSamples,
                  static_cast<unsigned long long>(FrameOrdinal), RingFilled);
    Emit(Logger, "Performance", Line);

    FormatStages(Line, sizeof(Line), WindowGpuSum.data(), WindowGpuCount.data());
    std::string GpuLine = "gpu ";
    GpuLine += Line;
    if (!WindowGpuValid)
        GpuLine += "   (no GPU readback yet)";
    Emit(Logger, "Performance", GpuLine.c_str());

    WindowSamples        = 0u;
    WindowElapsedSeconds = 0.0f;
    WindowMaxSeconds     = 0.0f;
    WindowGpuValid       = false;
    WindowGpuSum.fill(0.0f);
    WindowGpuCount.fill(0u);
}

void FramePerformanceLog::WriteSummary(DiagnosticMetrics& Logger) noexcept
{
    if (FrameCount == 0u) return;

    char Line[512];
    const float MeanSeconds = QueryAverageSeconds();
    std::snprintf(Line, sizeof(Line),
                  "Run summary: %llu frames in %.1f s - mean %.2f ms / %.1f FPS, p50 %.2f, p95 %.2f, p99 %.2f, min %.2f, max %.2f.",
                  static_cast<unsigned long long>(FrameCount), TotalSeconds, static_cast<double>(MeanSeconds * 1000.0f),
                  MeanSeconds > 0.0f ? 1.0f / MeanSeconds : 0.0f,
                  static_cast<double>(RingPercentile(0.50f) * 1000.0f),
                  static_cast<double>(RingPercentile(0.95f) * 1000.0f),
                  static_cast<double>(RingPercentile(0.99f) * 1000.0f),
                  static_cast<double>((MinimumSeconds < 1.0e29f ? MinimumSeconds : 0.0f) * 1000.0f),
                  static_cast<double>(MaximumSeconds * 1000.0f));
    Emit(Logger, "Performance", Line);

    // The distribution is over the WHOLE run (buckets), not the ring — this is the line that shows a hitch problem
    //    that the mean hides: 1 800 frames at 12 ms and 40 at 90 ms average to the same number as 1 840 at 14 ms.
    std::snprintf(Line, sizeof(Line),
                  "Frame-time distribution (ms): <4 %llu - 4-8 %llu - 8-16 %llu - 16-33 %llu - 33-66 %llu - 66-133 %llu - 133-266 %llu - 266+ %llu.",
                  static_cast<unsigned long long>(Buckets[0]), static_cast<unsigned long long>(Buckets[1]),
                  static_cast<unsigned long long>(Buckets[2]), static_cast<unsigned long long>(Buckets[3]),
                  static_cast<unsigned long long>(Buckets[4]), static_cast<unsigned long long>(Buckets[5]),
                  static_cast<unsigned long long>(Buckets[6]), static_cast<unsigned long long>(Buckets[7]));
    Emit(Logger, "Performance", Line);

    FormatStages(Line, sizeof(Line), TotalGpuSum.data(), TotalGpuCount.data());
    std::string GpuLine = "GPU means over the run: ";
    GpuLine += Line;
    Emit(Logger, "Performance", GpuLine.c_str());

    // One explanatory line per stage that never ran. Without it, `shadow -` reads as a measurement of zero rather
    //    than as a stage that was never reached — and "no shadows" is precisely the report that line has to answer.
    if (TotalGpuCount[5] == 0u)
        Emit(Logger, "Performance",
             "shadow stage recorded in 0 of the frames this run: shadow maps are the GI-OFF path, so with Global "
             "Illumination ON every sun occluder comes from the kernel's shadow ray instead - a zero here is the "
             "expected reading, not a missing shadow.");
    if (TotalGpuCount[4] == 0u && TotalGpuCount[6] == 0u)
        Emit(Logger, "Performance",
             "the ReSTIR kernel never reported a time this run - the accumulation may never have been dispatched "
             "(inspect the Scene/ReSTIR lines above and whether the level imported at all).");
    if (TotalGpuCount[7] == 0u)
        Emit(Logger, "Performance", "the sky pass never reported a time this run (0 until the pass exists in this build).");
    if (TotalGpuCount[8] == 0u)
        Emit(Logger, "Performance", "the volumetric pass never reported a time this run (0 until the pass exists in this build).");
}

float FramePerformanceLog::RingPercentile(float Quantile) const noexcept
{
    if (RingFilled == 0u) return 0.0f;
    std::array<float, RingCount> Copy{};
    std::copy(Ring.begin(), Ring.begin() + RingFilled, Copy.begin());
    std::sort(Copy.begin(), Copy.begin() + RingFilled);
    const float Clamped = std::clamp(Quantile, 0.0f, 1.0f);
    const uint32_t Index = std::min(RingFilled - 1u, static_cast<uint32_t>(Clamped * static_cast<float>(RingFilled)));
    return Copy[Index];
}

uint32_t FramePerformanceLog::BucketOf(float Milliseconds) const noexcept
{
    if (Milliseconds < 4.0f)   return 0u;
    if (Milliseconds < 8.0f)   return 1u;
    if (Milliseconds < 16.0f)  return 2u;
    if (Milliseconds < 33.0f)  return 3u;
    if (Milliseconds < 66.0f)  return 4u;
    if (Milliseconds < 133.0f) return 5u;
    if (Milliseconds < 266.0f) return 6u;
    return 7u;
}
}   // namespace Frontier
