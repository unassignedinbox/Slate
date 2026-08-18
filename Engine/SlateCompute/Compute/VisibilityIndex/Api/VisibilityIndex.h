//============================================================================================================================================
//                                                            VISIBILITYINDEX.H
//============================================================================================================================================
// 🧩 The mechanism and the target it writes — which partition and which triangle each pixel resolves to, and nothing further.

#pragma once

#include "Contract/DeliveryContract.h"
#include "Contract/PrecisionContract.h"
#include "SlateCompute/Compute/VisibilityIndex/Api/DepthReduction.h"
#include "SlateCompute/Compute/VisibilityIndex/Api/PartitionStructure.h"
#include "SlateVulkan/Device/RenderSchedule/Api/RenderSchedule.h"

#include <cstdint>
#include <memory>
#include <vector>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                 WHAT A PIXEL CARRIES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 What one pixel of the visibility target holds — the two unsigned components of `08` §2's R32G32.
/// note  🔴 `16` §4: depth, identity, coverage and motion, and **no attribute whatsoever**. No perpendicular, no
///        tangent basis, no domain coordinate and no reflectance. Everything else is reconstructed at the pixel
///        from the face this word names, which is the whole reason the target is two integers and not a sheaf
///        of surfaces the display extent is multiplied by.
/// note  🔴 The partition ordinal is written rather than the identity, because a `PartitionIdentity` is two
///        ordinals and the pair would leave no component for the triangle. `Resolve` performs the second hop,
///        and it is an indexed lookup on both — `16` §6's gate that nothing searches for what a pixel names.
/// note  ⚠️ `AbsentPartition` in the first component is an unoccupied pixel. It is a class `16` §5 dispatches
///        rather than a hole downstream shading has to test for.
/// tag   nonallocating, nonthrowing
struct VisibilityWord
{
    std::uint32_t  PartitionOrdinal = AbsentPartition;   // [-] - document-wide, in declaration order
    std::uint32_t  TriangleOrdinal  = 0u;                // [-] - within the partition, never within the document
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHICH RASTER
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Which of `16` §3's two rasterisers a partition is routed to.
/// tag   contract
enum class RasterRoute : std::uint32_t
{
    HardwareRaster = 0u,   // [-] - projected triangles exceed a few pixels
    ComputeRaster  = 1u    // [-] - sub-pixel; a 64-bit atomic maximum, depth in the high half
};

// 📝 🚧 `16` §7 leaves the projected-extent threshold open and says to measure it rather than guess it. Sixteen
//    pixels per edge is the placeholder the routing is written against — below it a hardware triangle costs more
//    in setup and in quad overshading than a compute lane costs outright, and above it the fixed-function path
//    wins on everything. It blocks throughput alone and no gate depends on the number, so it stands here in
//    `SlateCompute` rather than in `Contract/`: nothing else reads it, and moving it would announce an agreement
//    between two units that does not exist.
inline constexpr std::uint32_t ProjectedExtentThreshold = 16u;   // [px] - per edge, below which the compute path runs

/// 🧩 Which rasteriser one projected extent is routed to.
/// in    ProjectedAlong   [px]  the extent the partition projects to, conservative outward
/// in    ProjectedAcross  [px]
/// out   Route            [-]   the compute path below the threshold on **either** ordinate
/// note  📐 Either ordinate and not both. A partition projecting to two pixels by two hundred is a sliver, and a
///        sliver is exactly the shape hardware rasterisation shades a whole quad per covered pixel for.
/// cost  ✔️
/// tag   api, constexpr, nonallocating, nonthrowing
constexpr RasterRoute RouteOfExtent(std::uint32_t ProjectedAlong, std::uint32_t ProjectedAcross)
{
    return ProjectedAlong < ProjectedExtentThreshold || ProjectedAcross < ProjectedExtentThreshold
        ? RasterRoute::ComputeRaster
        : RasterRoute::HardwareRaster;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE MECHANISM
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every enrolled topology's partitioning, the reduction the culling tests against, and the recording that
///     writes the four targets `16` §4 declares.
/// note  🔴 `VisibilityIndex` names both the mechanism and the target it writes. "Visibility buffer" is not
///        usable — `Buffer` is banned — and the two readings never collide because the target is reached through
///        `SharedTarget::VisibilityIndex` and the mechanism through this component.
/// note  🔴 One reduction and not two. `16` §2 tests phase ① against the previous rotation's reduction and phase
///        ③ against this one's, but the level chain derived from a display extent is the same chain both times —
///        only the ordinates recorded into it differ, and those live on the device.
/// note  🔴 The degradation is **declared**, not branched. `08` §5's substitution names hardware rasterisation
///        for every partition when the 64-bit atomic capability was not negotiated, and the recording site reads
///        the ordering it was given rather than testing a capability it would then have to test identically at
///        four further sites.
/// tag   owning
class VisibilityIndex
{
public:

    VisibilityIndex()                                  = default;
    VisibilityIndex(const VisibilityIndex&)            = delete;
    VisibilityIndex& operator=(const VisibilityIndex&) = delete;

    /// 🧩 Derives the reduction chain for one display extent.
    /// in    DisplayAlong   [px]  the display extent this rotation is recorded against
    /// in    DisplayAcross  [px]
    /// out   Deliver        [-]   refuses with whatever `DepthReduction` refused
    /// post  the chain stands; the enrolled partitionings are untouched
    /// note  🔴 A display extent change re-derives the chain and re-derives **nothing else**. The partitionings
    ///        are in object space and `16` §1 forbids rebuilding them per rotation, let alone per resize.
    /// cost  🚩
    /// tag   api, nonthrowing
    Deliver<bool> Construct(std::uint32_t DisplayAlong, std::uint32_t DisplayAcross);

    /// 🧩 Contributes `08` §3 ②'s recording — the one that produces all four targets.
    /// in    Schedule  [-]  the schedule being assembled at bring-up
    /// out   Deliver   [-]  refuses with whatever the schedule refused
    /// note  🔴 Four targets produced by one recording, because `16` §4.2 writes motion here for the reason it
    ///        writes depth here: the previous rotation's projection of this same triangle is in hand at exactly
    ///        this point and is recoverable nowhere downstream. A second recording deriving it from depth alone
    ///        recovers camera motion and never occupant motion.
    /// cost  ✔️
    /// tag   api, nonthrowing
    Deliver<bool> Contribute(RenderSchedule& Schedule) const;

    /// 🧩 Partitions one sealed topology, adopts the result, and declares it into `42`'s resolution.
    /// in    Occupant     [-]  who the topology belongs to
    /// in    Imported     [-]  the sealed topology
    /// in    Conditioned  [-]  its conditioning, at the same revision
    /// in    Resolutions  [-]  the document's resolution; the identities are issued into it
    /// out   Deliver      [-]  the enrolment ordinal, or whatever the derivation or the resolution refused
    /// post  the standing ordinals run contiguously and every one of them resolves
    /// note  🔴 `16` §1: called when the topology changes and at no other time. It is `34` `Background` work —
    ///        the derivation is the expensive half and it reads nothing but its arguments.
    /// cost  🔴
    /// tag   api, nonthrowing
    Deliver<std::uint32_t> Enroll(OccupantIdentity            Occupant,
                                  const TopologyStructure&    Imported,
                                  const TopologyConditioning& Conditioned,
                                  PartitionResolutionIndex&   Resolutions);

    /// 🧩 What one pixel resolves to — the occupant, the material and the face range behind it.
    /// in    Written      [-]  the word read back from the target
    /// in    Resolutions  [-]  the document's resolution
    /// out   Deliver      [-]  refuses with ContentUnsupported for an unoccupied pixel or an ordinal outside the
    ///                         declared count, and with IdentityStale when the resolution was rebuilt since
    /// note  🔴 Two indexed lookups and no search — the ordinal indexes the identities this component declared,
    ///        and the identity indexes `42`'s resolution. `16` §6's gate is that every consumer reads that one
    ///        resolution rather than deriving its own.
    /// cost  ✔️
    /// tag   api, nonthrowing
    Deliver<ResolvedPartition> Resolve(VisibilityWord                  Written,
                                       const PartitionResolutionIndex& Resolutions) const;

    /// 🧩 One enrolled topology's standing partitioning.
    /// out   Deliver  [-]  refuses with ContentUnsupported outside the enrolled count
    /// cost  ✔️
    /// tag   api, nonthrowing
    Deliver<const PartitionStructure*> Enrolled(std::uint32_t EnrolmentOrdinal) const;

    /// 🧩 The reduction chain the culling tests against.
    /// cost  ✔️
    /// tag   api, nonallocating, nonthrowing
    const DepthReduction& Reduction() const;

    /// 🧩 Discards every enrolment and the chain with them.
    /// cost  🚩
    /// tag   api, nonthrowing
    void Reclaim();

    std::uint32_t EnrolledCount() const;
    std::uint32_t DeclaredPartitionCount() const;
    bool          ChainDerived() const;

private:

    // 📝 Held by unique ownership rather than by value because `PartitionStructure` carries a whole partitioning
    //    and the run is appended to as occupants arrive. A vector of values relocates on growth, and the standing
    //    partitioning a caller is reading through `Enrolled` would move out from under it mid-enrolment.
    std::vector<std::unique_ptr<PartitionStructure>>  Enrolments        = {};   // [-] - by enrolment ordinal
    std::vector<PartitionIdentity>                    DeclaredIdentity  = {};   // [-] - by document-wide ordinal
    DepthReduction                                    Reduced           = {};   // [-] - the level chain
    std::uint64_t                                     ResolvedRevision  = 0u;   // [-] - `42`'s at the last declaration
};

// 📐 The routing and the resolution are integer throughout and therefore Exact; the partitioning and the chain
//    carry their own declarations. `00` §3's transitivity rule folds them to the weaker of the two.
SLATE_DECLARES_PRECISION(PrecisionGuarantee::Bounded, PrecisionGuarantee::Bounded, PrecisionGuarantee::Exact);

}   // namespace Slate
