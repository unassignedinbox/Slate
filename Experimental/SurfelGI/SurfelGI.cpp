//============================================================================================================================================
// Experimental/SurfelGI/SurfelGI.cpp
//============================================================================================================================================
#include "SurfelGI.h"

#include <algorithm>
#include <cmath>

namespace Frontier::Experimental::SurfelGI {
namespace {

// Mirrors std430 records declared in Shaders/SurfelTypes.glsl.
constexpr std::uint64_t kGpuSurfelBytes       = 128u;
constexpr std::uint64_t kGeometryBytes         = 16u;  // flat triangle / visibility geometry address
constexpr std::uint64_t kIndexBytes            = 4u;
constexpr std::uint64_t kCellInfoBytes         = 8u;   // count + offset
constexpr std::uint64_t kRayResultBytes        = 48u;
constexpr std::uint64_t kRecycleBytes          = 16u;
constexpr std::uint64_t kCounterBytes          = static_cast<std::uint64_t>(Counter::Count) * 4u;
constexpr std::uint64_t kMomentTexelBytes      = 8u;   // RG32F: mean and squared mean
constexpr std::uint64_t kGuidingTexelBytes     = 4u;   // R32F; allocated even when guiding is disabled to keep the reference layout stable

[[nodiscard]] constexpr std::uint32_t ClampToU32(std::uint64_t Value) noexcept
{
    return Value > std::numeric_limits<std::uint32_t>::max()
        ? std::numeric_limits<std::uint32_t>::max()
        : static_cast<std::uint32_t>(Value);
}

} // namespace

Runtime::Runtime(Settings InitialSettings) noexcept
    : ActiveSettings(InitialSettings.IsValid() ? InitialSettings : Settings::Reference())
{
    Reset();
}

void Runtime::Reset() noexcept
{
    ActiveCounters.ValidSurfel  = 0u;
    ActiveCounters.DirtySurfel  = 0u;
    ActiveCounters.FreeSurfel   = ActiveSettings.SurfelLimit;
    ActiveCounters.Cell         = 0u;
    ActiveCounters.RequestedRay = 0u;
    ActiveCounters.MissBounce   = 0u;
    FrameIndex                  = 0u;
    Locked                      = false;
}

void Runtime::BeginFrame() noexcept
{
    // Exact Prepare-pass intent: process last frame's valid set as dirty this frame, then rebuild the live set.
    ActiveCounters.DirtySurfel  = std::min(ActiveCounters.ValidSurfel, ActiveSettings.SurfelLimit);
    ActiveCounters.ValidSurfel  = 0u;
    ActiveCounters.Cell         = 0u;
    ActiveCounters.RequestedRay = 0u;
    ActiveCounters.MissBounce   = 0u;
    ActiveCounters.FreeSurfel   = std::min(ActiveCounters.FreeSurfel, ActiveSettings.SurfelLimit);
}

void Runtime::PublishUpdatedSurfels(std::uint32_t Valid, std::uint32_t Free, std::uint32_t FilledCells,
                                    std::uint32_t RequestedRays) noexcept
{
    ActiveCounters.ValidSurfel = std::min(Valid, ActiveSettings.SurfelLimit);
    ActiveCounters.FreeSurfel  = std::min(Free, ActiveSettings.SurfelLimit);
    ActiveCounters.Cell        = std::min<std::uint32_t>(
        FilledCells, ClampToU32(ActiveSettings.CellToSurfelEntryCount()));
    ActiveCounters.RequestedRay = std::min(RequestedRays, ActiveSettings.RayBudget);
}

void Runtime::RecordMissBounces(std::uint32_t Count) noexcept
{
    const std::uint64_t Sum = static_cast<std::uint64_t>(ActiveCounters.MissBounce) + Count;
    ActiveCounters.MissBounce = ClampToU32(Sum);
}

void Runtime::AdvanceFrame() noexcept
{
    if (FrameIndex != std::numeric_limits<std::uint32_t>::max()) ++FrameIndex;
}

MemoryEstimate Runtime::EstimateMemory(const Settings& Value) noexcept
{
    if (!Value.IsValid()) return {};

    MemoryEstimate Result{};
    const std::uint64_t SurfelCount = Value.SurfelLimit;
    const std::uint64_t CellCount   = Value.CellCount();
    const std::uint64_t RayCount    = Value.RayBudget;

    Result.SurfelBytes         = SurfelCount * kGpuSurfelBytes;
    Result.SurfelGeometryBytes = SurfelCount * kGeometryBytes;
    // valid + dirty + free indices; original storage has one buffer for each.
    Result.IndexBytes          = SurfelCount * kIndexBytes * 3u;
    Result.CellInfoBytes       = CellCount * kCellInfoBytes;
    Result.CellToSurfelBytes   = Value.CellToSurfelEntryCount() * kIndexBytes;
    Result.RayResultBytes      = RayCount * kRayResultBytes;
    // recycle records + per-cell reservation + surfel reference counters + global six-counter buffer.
    Result.RecycleAndCounterBytes = SurfelCount * (kRecycleBytes + kIndexBytes) + CellCount * kIndexBytes + kCounterBytes;
    Result.MomentTextureBytes  = static_cast<std::uint64_t>(kReferenceSurfelDepthWidth) * kReferenceSurfelDepthHeight * kMomentTexelBytes;
    Result.GuidingTextureBytes = static_cast<std::uint64_t>(kReferenceSurfelDepthWidth) * kReferenceSurfelDepthHeight * kGuidingTexelBytes;
    return Result;
}

std::uint32_t Runtime::AllocateAdaptiveRayCount(float Variance, bool Sleeping, const Settings& Value) noexcept
{
    if (!Value.IsValid()) return 0u;

    // Mirrors `clamp(lerp(lower, upper, length(msme.variance) * varianceSensitivity), lower, upper)`.
    const std::uint32_t Lower = Sleeping ? Value.MinimumRayCount / 4u : Value.MaximumRayCount / 4u;
    const std::uint32_t Upper = Sleeping ? Value.MinimumRayCount : Value.MaximumRayCount;
    const float T = std::clamp(Variance * Value.VarianceSensitivity, 0.0f, 1.0f);
    const float Requested = static_cast<float>(Lower) + (static_cast<float>(Upper - Lower) * T);
    return std::clamp(static_cast<std::uint32_t>(Requested), Lower, Upper);
}

} // namespace Frontier::Experimental::SurfelGI
