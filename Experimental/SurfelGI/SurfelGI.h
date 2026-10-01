//============================================================================================================================================
// Experimental/SurfelGI/SurfelGI.h
// Software-CWBVH port of W298/SurfelGI's persistent surfel GI resource and frame contract.
// SPDX-License-Identifier: MIT (algorithm / design attribution: see NOTICE.md)
//============================================================================================================================================
#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <limits>
#include <string_view>

namespace Frontier::Experimental::SurfelGI {

// These values intentionally match W298/SurfelGI's initial implementation. Do not lower them in this reference profile.
inline constexpr std::uint32_t kReferenceSurfelLimit       = 150'000u;
inline constexpr std::uint32_t kReferenceRaysPerSurfel     = 64u;
inline constexpr std::uint32_t kReferenceRayBudget         = kReferenceSurfelLimit * kReferenceRaysPerSurfel;
inline constexpr std::uint32_t kReferenceCellDimension     = 250u;
inline constexpr std::uint32_t kReferenceCellCount         = kReferenceCellDimension * kReferenceCellDimension * kReferenceCellDimension;
inline constexpr std::uint32_t kCellsTouchedPerSurfel      = 125u;       // [-2, +2]^3
inline constexpr std::uint32_t kMaxSurfelLife              = 240u;
inline constexpr std::uint32_t kSleepingMaxSurfelLife      = kMaxSurfelLife / 4u;
inline constexpr std::uint32_t kReferenceMinimumRayCount   = 4u;
inline constexpr std::uint32_t kReferenceMaximumRayCount   = 64u;
inline constexpr std::uint32_t kReferenceMaxPathSteps      = 6u;
inline constexpr std::uint32_t kReferenceRayStep           = 3u;
inline constexpr float         kReferenceCellUnit          = 0.05f;
inline constexpr float         kReferenceProjectedArea     = 40'000.0f;
inline constexpr std::uint32_t kReferenceSurfelDepthWidth  = 3840u;
inline constexpr std::uint32_t kReferenceSurfelDepthHeight = 2160u;

enum class Counter : std::uint32_t
{
    ValidSurfel = 0u,
    DirtySurfel,
    FreeSurfel,
    Cell,
    RequestedRay,
    MissBounce,
    Count
};

// Ordering is a real synchronization contract. Every write in a pass becomes visible to the following pass.
enum class Pass : std::uint8_t
{
    Prepare,
    CollectCells,
    PrefixCells,
    ScatterCells,
    TraceSoftwareCwbvh,
    Integrate,
    GenerateAndEvaluate
};

struct Settings
{
    std::uint32_t SurfelLimit             = kReferenceSurfelLimit;
    std::uint32_t RayBudget               = kReferenceRayBudget;
    std::uint32_t CellDimension           = kReferenceCellDimension;
    std::uint32_t CellCapacityPerSurfel   = kCellsTouchedPerSurfel;
    std::uint32_t MinimumRayCount         = kReferenceMinimumRayCount;
    std::uint32_t MaximumRayCount         = kReferenceMaximumRayCount;
    std::uint32_t RayStep                 = kReferenceRayStep;
    std::uint32_t MaximumPathSteps        = kReferenceMaxPathSteps;
    std::uint32_t SurfelTargetArea        = static_cast<std::uint32_t>(kReferenceProjectedArea);
    float         CellUnit                = kReferenceCellUnit;
    float         PlacementThreshold      = 2.0f;
    float         RemovalThreshold        = 4.0f;
    float         SpawnChanceMultiplier   = 0.3f;
    std::uint32_t SpawnChancePower        = 1u;
    std::uint32_t BlendingDelay           = 240u;
    float         VarianceSensitivity     = 40.0f;
    float         ShortMeanWindow         = 0.03f;
    bool          UseSurfelRadiance       = true;
    bool          UseSurfelDepth          = true;
    bool          UseIrradianceSharing    = true;
    bool          UseRayGuiding           = false;
    bool          LimitSurfelSearch       = false;

    [[nodiscard]] static constexpr Settings Reference() noexcept { return {}; }
    [[nodiscard]] constexpr std::uint64_t CellCount() const noexcept
    {
        return static_cast<std::uint64_t>(CellDimension) * CellDimension * CellDimension;
    }
    [[nodiscard]] constexpr std::uint64_t CellToSurfelEntryCount() const noexcept
    {
        return static_cast<std::uint64_t>(SurfelLimit) * CellCapacityPerSurfel;
    }
    [[nodiscard]] constexpr bool IsValid() const noexcept
    {
        return SurfelLimit > 0u && RayBudget > 0u && CellDimension > 0u && CellUnit > 0.0f &&
               MinimumRayCount > 0u && MinimumRayCount <= MaximumRayCount &&
               MaximumRayCount <= kReferenceRaysPerSurfel && PlacementThreshold < RemovalThreshold;
    }
};

// Byte accounting uses the portable GLSL ABI in Shaders/SurfelTypes.glsl, not the Falcor ABI.
// It excludes the resident scene, CWBVH, visibility front end, swapchain, driver allocation overhead and ImGui.
struct MemoryEstimate
{
    std::uint64_t SurfelBytes            = 0u;
    std::uint64_t SurfelGeometryBytes    = 0u;
    std::uint64_t IndexBytes             = 0u;
    std::uint64_t CellInfoBytes          = 0u;
    std::uint64_t CellToSurfelBytes      = 0u;
    std::uint64_t RayResultBytes         = 0u;
    std::uint64_t RecycleAndCounterBytes = 0u;
    std::uint64_t MomentTextureBytes     = 0u;
    std::uint64_t GuidingTextureBytes    = 0u;

    [[nodiscard]] constexpr std::uint64_t TotalBytes() const noexcept
    {
        return SurfelBytes + SurfelGeometryBytes + IndexBytes + CellInfoBytes + CellToSurfelBytes +
               RayResultBytes + RecycleAndCounterBytes + MomentTextureBytes + GuidingTextureBytes;
    }
    [[nodiscard]] constexpr std::uint64_t TotalMiB() const noexcept { return TotalBytes() / (1024u * 1024u); }
};

struct Counters
{
    std::uint32_t ValidSurfel  = 0u;
    std::uint32_t DirtySurfel  = 0u;
    std::uint32_t FreeSurfel   = kReferenceSurfelLimit;
    std::uint32_t Cell         = 0u;
    std::uint32_t RequestedRay = 0u;
    std::uint32_t MissBounce   = 0u;

    [[nodiscard]] constexpr std::array<std::uint32_t, static_cast<std::size_t>(Counter::Count)> AsArray() const noexcept
    {
        return { ValidSurfel, DirtySurfel, FreeSurfel, Cell, RequestedRay, MissBounce };
    }
};

struct FramePlan
{
    std::array<Pass, 7u> OrderedPasses{
        Pass::Prepare,
        Pass::CollectCells,
        Pass::PrefixCells,
        Pass::ScatterCells,
        Pass::TraceSoftwareCwbvh,
        Pass::Integrate,
        Pass::GenerateAndEvaluate
    };

    [[nodiscard]] static constexpr std::string_view Name(Pass Value) noexcept
    {
        switch (Value)
        {
            case Pass::Prepare:             return "Prepare";
            case Pass::CollectCells:        return "CollectCells";
            case Pass::PrefixCells:         return "PrefixCells";
            case Pass::ScatterCells:        return "ScatterCells";
            case Pass::TraceSoftwareCwbvh:  return "TraceSoftwareCwbvh";
            case Pass::Integrate:           return "Integrate";
            case Pass::GenerateAndEvaluate: return "GenerateAndEvaluate";
        }
        return "Unknown";
    }
};

class Runtime final
{
public:
    explicit Runtime(Settings InitialSettings = Settings::Reference()) noexcept;

    [[nodiscard]] const Settings& QuerySettings() const noexcept { return ActiveSettings; }
    [[nodiscard]] const Counters& QueryCounters() const noexcept { return ActiveCounters; }
    [[nodiscard]] std::uint32_t QueryFrameIndex() const noexcept { return FrameIndex; }
    [[nodiscard]] bool IsLocked() const noexcept { return Locked; }

    // CPU mirrors of the GPU counter transitions. Upload the returned counters before its corresponding GPU pass.
    void Reset() noexcept;
    void BeginFrame() noexcept;                         // SurfelPrepare: valid → dirty, clears per-frame counters.
    void PublishUpdatedSurfels(std::uint32_t Valid, std::uint32_t Free, std::uint32_t FilledCells,
                               std::uint32_t RequestedRays) noexcept;
    void RecordMissBounces(std::uint32_t Count) noexcept;
    void AdvanceFrame() noexcept;
    void AssignLocked(bool Value) noexcept { Locked = Value; }

    [[nodiscard]] static MemoryEstimate EstimateMemory(const Settings& Value) noexcept;
    [[nodiscard]] static std::uint32_t AllocateAdaptiveRayCount(float Variance, bool Sleeping,
                                                                 const Settings& Value) noexcept;

private:
    Settings      ActiveSettings;
    Counters      ActiveCounters;
    std::uint32_t FrameIndex = 0u;
    bool          Locked     = false;
};

} // namespace Frontier::Experimental::SurfelGI
