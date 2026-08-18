//============================================================================================================================================
//                                                          OCCLUSIONUNIFORM.SLANG
//============================================================================================================================================
// 🧩 The device halves of `16` §2's three uploaded records, and the two comparisons both culling dispatches read.

#pragma once

// 📐 🔴 Every declaration below is a **mirror**. Its host counterpart carries a static assertion on its width and
//    on its member count, and a member inserted on one side alone shifts every later member of the other by four
//    bytes — which the vendor accepts and the device then reads a triangle ordinal out of a depth ordinate for.
//
// ⚠️ There is no shared declaration to reach for. `Shared/` compiles under both toolchains and this does not:
//    the records below are read through resource declarations the host toolchain has no spelling for. The two
//    are mirrors held in agreement by assertion rather than one declaration read twice, exactly as
//    `VisibilityUniform.slang` and `VisibilityRaster.h` already are.

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE THREE RECORDS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Which level of the chain one reduction dispatch writes.
/// note  🔴 `SourceFromTarget` is declared and never derived from `WrittenLevel` being nought. The derivation
///        holds only while the finest level's extent is the display's, and that is a condition the record cannot
///        see — the chain may have been derived against an extent the display has since been resized past.
struct ReductionUniform
{
    uint  WrittenLevel;       // [-]     - which level the dispatch writes
    uint  WrittenOffset;      // [texel] - where that level begins in the chain span
    uint  WrittenAlong;       // [texel] - its extent
    uint  WrittenAcross;      // [texel]
    uint  SourceOffset;       // [texel] - where the level above begins; unread when the target is read
    uint  SourceAlong;        // [texel] - the source's extent
    uint  SourceAcross;       // [texel]
    uint  SourceFromTarget;   // [-]     - non-zero for the finest level
};

/// 🧩 What the occlusion dispatch reads of the chain and of the run it is testing.
struct OcclusionUniform
{
    uint  ClassifiedCount;   // [-]  - partitions the dispatch tests
    uint  LevelCount;        // [-]  - levels the chain carries
    uint  DisplayAlong;      // [px] - the extent the finest level covers
    uint  DisplayAcross;     // [px]
    uint  TriangleCeiling;   // [-]  - entries the surviving run can hold
    uint  PhaseOrdinal;      // [-]  - nought is ①, one is ③
    uint  Unoccupied1;       // [-]
    uint  Unoccupied2;       // [-]
};

/// 🧩 One classified partition, as the host handed it over.
/// note  🔴 The **triangle run** is carried because the compaction compacts triangles and not partitions. An
///        indirect draw reads corners by a running ordinal, so three corners of a partition are three corners of
///        its first triangle and every other one is unreachable; the survivor writes its own run out instead.
struct TestedPartition
{
    uint   PartitionOrdinal;   // [-]  - within the enrolment
    uint   Standing;           // [-]  - the host's verdict; see the four ordinals below
    uint   FirstTriangle;      // [-]  - into the residency's fanned run
    uint   TriangleCount;      // [-]  - triangles of that run it spans
    uint   OriginAlong;        // [px] - the first display texel it covers
    uint   OriginAcross;       // [px]
    uint   ProjectedAlong;     // [px] - conservative outward
    uint   ProjectedAcross;    // [px]
    float  NearestDepth;       // [-]  - reversed; the greatest ordinate of the eight corners
};

// 📝 `PartitionStanding`'s ordinals, spelled as constants because the host enumeration has no device counterpart.
//    An enumeration declared on both sides is two declarations that must agree; two constants compared by the
//    same integer are one fact written twice at a width the compiler checks.
static const uint PartitionAdmitted            = 0u;
static const uint PartitionFrustumExcluded     = 1u;
static const uint PartitionOrientationExcluded = 2u;
static const uint PartitionDepthOccluded       = 3u;

static const uint PhaseAgainstPrevious = 0u;
static const uint PhaseAgainstCurrent  = 1u;

//------------------------------------------------------------------------------------------------------------------------
//                                                    LEVEL SELECTION
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 The coarsest level at which one projected extent is covered by a two-by-two reading.
/// in    SpannedAlong   [px]  the extent the partition projects to, conservative outward
/// in    SpannedAcross  [px]
/// in    LevelCount     [-]   levels the chain carries
/// out   Level          [-]   below LevelCount
/// note  📐 The walk mirrors `DepthReduction::LevelOfExtent` step for step, halving with **round up** on both
///        ordinates. Rounding down here selects a level one coarser than the host would, and the four texels
///        read then fail to span the extent along whichever axis was odd — a partition rejected on depth it
///        never actually stood behind.
/// note  ⚠️ An extent of nothing resolves to the finest level rather than refusing. A partition projecting to
///        nothing is sub-pixel and belongs to `16` §3's compute route; it is not an error and rejecting it here
///        would drop geometry no other route then draws.
uint SelectLevel(uint SpannedAlong, uint SpannedAcross, uint LevelCount)
{
    uint RemainingAlong  = SpannedAlong;
    uint RemainingAcross = SpannedAcross;
    uint Selected        = 0u;

    const uint Coarsest = LevelCount - 1u;

    while ((RemainingAlong > 2u || RemainingAcross > 2u) && Selected < Coarsest)
    {
        RemainingAlong  = (RemainingAlong  + 1u) / 2u;
        RemainingAcross = (RemainingAcross + 1u) / 2u;

        Selected += 1u;
    }

    return Selected;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE DEPTH COMPARISON
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Whether one partition stands wholly behind what the reduction recorded.
/// in    NearestDepth  [-]  the partition's nearest ordinate; reversed, so the greatest of its eight corners
/// in    ReducedDepth  [-]  the least ordinate the covered region carries; the furthest point recorded there
/// out   Occluded      [-]  true only where nothing of the partition can reach in front of what stands
/// note  📐 Reversed depth throughout — `NearPlaneDepth` is unity and `FarPlaneDepth` nought, per `Contract/`.
///        The conservative reduction is therefore the **minimum**, and a partition is occluded when its nearest
///        ordinate is at or below the furthest ordinate recorded across the region it covers.
/// note  🔴 Written the other way round, this rejects on every silhouette and admits inside every surface — the
///        artist meets it as an object flickering along its own edge rather than as a comparison inverted.
bool DepthOccludes(float NearestDepth, float ReducedDepth)
{
    return NearestDepth <= ReducedDepth;
}
