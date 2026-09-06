//============================================================================================================================================
//                                                      RESTIRINTEGRATOR.H
//============================================================================================================================================
// 🧩 Drives the interim progressive path-tracing kernel (RIS direct lighting + one NEE bounce, running-mean accumulation).
//    🚧 Not yet ReSTIR proper — see the status block at the top of Engine/Shaders/ReSTIRViewport.slang and plan v2.1.

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)
#endif

#include "../DeviceExchange/SwapchainExchange.h"
#include "../ContentInterchange/MaterialDescriptor.h"
#include "../GeometricRaster/CelestialSolver.h"
#include "../../Projects/Project-Zero/Source/RayTracingSolver.h"
#include "../../Projects/Project-Zero/Source/FlyThroughSolver.h"
#include <cstdint>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                           RESTIR INTEGRATOR CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

// A3 sky quality. The view march dominates the cost — the light march runs inside it, so the product is what
//    you pay — and the tiers spend their budget accordingly. Measured on the reference CPU port: Low differs
//    from Ultra by under 2 % in the zenith and under 6 % at the horizon, where the path through the air is
//    longest and the march is least able to resolve it.
enum class SkyQualityCategory : uint32_t
{
    Off    = 0u,   // no sky at all: ray misses stay black, reproducing every pre-A3 image exactly
    Low    = 1u,   // 16 × 4   — a GTX 1650 SUPER at 1080p
    Medium = 2u,   // 32 × 8
    High   = 3u,   // 48 × 12
    Ultra  = 4u,   // 64 × 16  — the offline reference
};

struct SkyStepCounts { uint32_t View; uint32_t Light; };

[[nodiscard]] inline SkyStepCounts QuerySkySteps(SkyQualityCategory Quality) noexcept
{
    switch (Quality)
    {
        case SkyQualityCategory::Low:    return { 16u,  4u };
        case SkyQualityCategory::Medium: return { 32u,  8u };
        case SkyQualityCategory::High:   return { 48u, 12u };
        case SkyQualityCategory::Ultra:  return { 64u, 16u };
        default:                         return {  0u,  0u };
    }
}

struct ReSTIRIntegratorConfiguration
{
    uint32_t    CandidatesPerPixel;         // [-]   primary DI candidates per pixel
    uint32_t    ExtraCandidateCount;      // [-]   extra same-pixel RIS candidates (R6 row 3: renamed; true spatial reuse is the fixed kSpatialTaps cross)
    float       Exposure;                   // [-]   ACES tone-map exposure scalar
    float       AmbientStrength;            // [-]   ambient fallback contribution
    bool        GlobalIllumination = true;  // [-]   secondary bounce on/off
    bool        AntiAliasing       = true;  // [-]   sub-pixel jitter on/off
    bool        AmbientFloor       = false; // [-]   debug fill light (albedo × AmbientStrength); off by default since R0
    bool        TemporalReuse      = true;  // [-]   R6 row 2: temporal reservoir reuse (back-projection + validation)
    bool        SpatialReuse       = true;  // [-]   R6 row 3: spatial neighbour reuse (pairwise MIS)
    bool        AliasPick          = true;  // [-]   R6 row 3: Walker-alias light pick (false = uniform, R0 identity; F5)
    bool        Denoise            = true;  // [-]   R7: edge-avoiding à-trous filter (false = the raw accumulated image)
    bool        TemporalReprojection = true; // [-]   R7a: back-project the running mean through the motion vectors
                                             //       (false = the pre-R7a same-pixel accumulator, kept as an identity switch)

    // A3 sky. Off restores the black background exactly, which is the identity switch for this phase.
    SkyQualityCategory SkyQuality = SkyQualityCategory::Medium;
    float       SunIlluminance   = 120000.0f;   // [lx]  clear midday sun above the atmosphere
    float       CameraAltitude   = 2.0f;        // [m]   observer height above the planet surface
};

//------------------------------------------------------------------------------------------------------------------------
//                                                  RESTIR INTEGRATOR
//------------------------------------------------------------------------------------------------------------------------

class ReSTIRIntegrator
{
public:
    explicit ReSTIRIntegrator(ReSTIRIntegratorConfiguration InitialConfiguration) noexcept;
    ~ReSTIRIntegrator() noexcept = default;

    ReSTIRIntegrator(const ReSTIRIntegrator&)            = delete;
    ReSTIRIntegrator& operator=(const ReSTIRIntegrator&) = delete;

    // Construct the DispatchConfiguration from live camera state and scene counts
    [[nodiscard]] DispatchConfiguration
    BuildDispatch(const ProjectZero::FlyThroughSolver& Camera,
                  uint32_t                             ViewportWidth,
                  uint32_t                             ViewportHeight,
                  uint32_t                             AlphaMaskedMaterialCount,   // R4b: materials flagged MaterialFlagAlphaMask
                  uint32_t                             LuminaireTriangleCount) const noexcept;

    // Count emissive triangles in the scene (used to set LuminaireTriangleCount each frame)
    [[nodiscard]] static uint32_t
    CountLuminaireTriangles(const ProjectZero::RayTracingSolver& Scene) noexcept;

    // Build GPU triangle and material records from the CPU scene
    [[nodiscard]] static std::vector<TriangleIndex>
    BuildTriangleIndex(const ProjectZero::RayTracingSolver& Scene) noexcept;

    [[nodiscard]] static std::vector<MaterialDescriptor>
    BuildMaterialDescriptors(const ProjectZero::RayTracingSolver& Scene) noexcept;

    // Mutable configuration — updated live by RenderScheduler
    // Any parameter change invalidates the temporal history; the accumulation restarts at index 0.
    void AssignCandidatesPerPixel(uint32_t Count) noexcept { if (ActiveConfiguration.CandidatesPerPixel != Count) { ActiveConfiguration.CandidatesPerPixel = Count; ResetAccumulation(); } }
    void AssignExtraCandidateCount  (uint32_t Count) noexcept { if (ActiveConfiguration.ExtraCandidateCount   != Count) { ActiveConfiguration.ExtraCandidateCount   = Count; ResetAccumulation(); } }
    void AssignExposure          (float    Value) noexcept { if (ActiveConfiguration.Exposure            != Value) { ActiveConfiguration.Exposure            = Value; ResetAccumulation(); } }
    void AssignGlobalIllumination(bool     On)    noexcept { if (ActiveConfiguration.GlobalIllumination  != On)    { ActiveConfiguration.GlobalIllumination  = On;    ResetAccumulation(); } }
    void AssignAntiAliasing      (bool     On)    noexcept { if (ActiveConfiguration.AntiAliasing        != On)    { ActiveConfiguration.AntiAliasing        = On;    ResetAccumulation(); } }
    void AssignTemporalReuse     (bool     On)    noexcept { if (ActiveConfiguration.TemporalReuse       != On)    { ActiveConfiguration.TemporalReuse       = On;    ResetAccumulation(); } }
    void AssignSpatialReuse      (bool     On)    noexcept { if (ActiveConfiguration.SpatialReuse        != On)    { ActiveConfiguration.SpatialReuse        = On;    ResetAccumulation(); } }
    void AssignAliasPick         (bool     On)    noexcept { if (ActiveConfiguration.AliasPick           != On)    { ActiveConfiguration.AliasPick           = On;    ResetAccumulation(); } }
    // R7. Toggling the filter does not change what is SAMPLED, only how the accumulated image is presented, so it
    //    deliberately does NOT reset accumulation — restarting would throw away a converged history to change a
    //    post-process, and the A/B comparison the switch exists for would be impossible.
    void AssignDenoise           (bool     On)    noexcept { ActiveConfiguration.Denoise = On; }
    // Changing the sky changes what every ray-miss pixel resolves to, so the accumulated history is no longer
    //    of the same image and must be discarded — unlike the denoiser, which only re-presents it.
    void AssignSkyQuality  (SkyQualityCategory Q) noexcept { if (ActiveConfiguration.SkyQuality     != Q) { ActiveConfiguration.SkyQuality     = Q; ResetAccumulation(); } }
    void AssignSunIlluminance    (float    Lux)   noexcept { if (ActiveConfiguration.SunIlluminance != Lux) { ActiveConfiguration.SunIlluminance = Lux; ResetAccumulation(); } }

    void ResetAccumulation() noexcept { AccumulationIndex = 0u; }

    // A3. The sky's clock, held by value because it IS the authoritative state — handing out a pointer to
    //    someone else's would invite a second clock to exist and the two would eventually disagree.
    [[nodiscard]] CelestialSolver&       Celestial()       noexcept { return Sky; }
    [[nodiscard]] const CelestialSolver& Celestial() const noexcept { return Sky; }

    // Compares the camera pose against the one used for the running history; a moved or turned camera
    //    (or a resized viewport) restarts accumulation so no stale radiance is blended in.
    void ObserveCamera(const ProjectZero::FlyThroughSolver& Camera, uint32_t ViewportWidth, uint32_t ViewportHeight) noexcept;

    [[nodiscard]] const ReSTIRIntegratorConfiguration& QueryConfiguration() const noexcept
    {
        return ActiveConfiguration;
    }

    void IncrementAccumulationIndex() noexcept { AccumulationIndex++; }
    [[nodiscard]] uint32_t QueryAccumulationIndex() const noexcept { return AccumulationIndex; }

    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    ReSTIRIntegratorConfiguration ActiveConfiguration;  // [-]  live-tunable parameters
    CelestialSolver Sky{};   // A3: the authoritative clock; see CelestialSolver.h
    // The sun direction the accumulated history was rendered under. A moving sun invalidates it exactly as a
    //    moving camera does — see ObserveCamera.
    mutable float   HistorySunX = 0.0f, HistorySunY = 0.0f, HistorySunZ = 0.0f;
    uint32_t                      AccumulationIndex;    // [-]  temporal frame counter (incremented per frame)

    Vector3                       HistoryOrigin;        // [m]   camera position the history was accumulated from
    Vector3                       HistoryForward;       // [-]   camera forward the history was accumulated from
    uint32_t                      HistoryWidth;         // [px]  viewport width of the history
    uint32_t                      HistoryHeight;        // [px]  viewport height of the history
};

template<>
inline uint32_t ReSTIRIntegrator::Convert<uint32_t>() const noexcept
{
    return AccumulationIndex;
}

template<>
inline float ReSTIRIntegrator::Convert<float>() const noexcept
{
    return ActiveConfiguration.Exposure;
}

} // namespace Frontier
