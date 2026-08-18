//============================================================================================================================================
//                                                      ACCUMULATIONPROJECTION.SLANG.H
//============================================================================================================================================
// 🧩 The count-derived weight, the four rejection tests, and the saturating ceiling that keeps a still workspace responsive.

#pragma once

#include "Shared/Prelude.slang.h"
#include "Contract/ToleranceContract.h"

// 📐 🔴 `64` §3: the accumulation weight is derived from the **recorded sample count** and never from a constant.
//    A constant weight is an exponential average that never converges and never fully forgets — it leaves a
//    permanent trail behind moving occupants and a permanent floor of residual noise on the ones that stopped.
//    A count-derived weight converges while the workspace is still and resets cleanly when it is not.

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE WEIGHT
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 How much of the arriving sample the accumulation takes.
/// in    HeldCount     [-]  samples already accumulated at this pixel, before this one
/// in    CountCeiling  [-]  the declared saturating ceiling
/// out   Weight        [-]  one on the first sample, falling as the count rises, floored at the ceiling
/// note  🔴 The ceiling is not a refinement. Without it a workspace left untouched accumulates a weight so small
///        that a subsequent change takes seconds to appear, and the artist believes the program has stopped
///        responding — `64` §3.
/// note  📐 A weight of one over the arriving count is the running mean, which converges to the true mean while
///        nothing changes. Saturating the count converts it to an exponential average with a declared time
///        constant, which is what a still-but-editable workspace actually wants.
/// cost  ✔️
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED Real64 ProjectAccumulationWeight(Unsigned32 HeldCount, Unsigned32 CountCeiling)
{
    const Unsigned32 Bounded = HeldCount < CountCeiling ? HeldCount : CountCeiling;

    return 1.0 / Real64(Bounded + 1u);
}

/// 🧩 The count one pixel carries after accumulating one sample.
/// note  📝 Saturating rather than wrapping. A wrapped count returns to one and the pixel restarts its
///        convergence, which reads as the whole image sharpening and softening on a cycle nobody declared.
/// cost  ✔️
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED SLATE_CONSTEXPR Unsigned32 ProjectAccumulatedCount(Unsigned32 HeldCount, Unsigned32 CountCeiling)
{
    return HeldCount < CountCeiling ? HeldCount + 1u : CountCeiling;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE REJECTIONS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Whether a reprojected position lies off the accumulated extent.
/// cost  ✔️
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED SLATE_CONSTEXPR bool ReprojectionOffExtent(Real64 CoordinateAlong, Real64 CoordinateAcross)
{
    return CoordinateAlong < 0.0 || CoordinateAlong >= 1.0
        || CoordinateAcross < 0.0 || CoordinateAcross >= 1.0;
}

/// 🧩 Whether the history describes the same surface as the arriving sample.
/// in    HeldOccupant     [-]  the occupant `16` §4.1 resolved there last rotation
/// in    ArrivingOccupant [-]  the occupant resolved there now
/// out   Same             [-]  an integer comparison; Exact
/// note  🔴 The test reads `16` §4.1's **occupant** resolution and not the partition identity — `64` §4. A
///        partition identity changes when topology is re-partitioned, and re-partitioning would then discard
///        every pixel's history for a change the artist cannot see.
/// cost  ✔️
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED SLATE_CONSTEXPR bool ReprojectionSameOccupant(Unsigned32 HeldOccupant, Unsigned32 ArrivingOccupant)
{
    return HeldOccupant == ArrivingOccupant;
}

/// 🧩 Whether the history's depth still describes the arriving sample's surface.
/// in    HeldDepth      [-]  reversed, as recorded last rotation
/// in    ArrivingDepth  [-]  reversed, as recorded now
/// in    DepthBound     [-]  the declared relative bound
/// out   Refused        [-]  true where the two describe different parts of one occupant
/// note  📐 Relative to the arriving ordinate rather than absolute, so the bound means the same thing at every
///        distance. An absolute bound rejects everything in the distance and accepts everything up close.
/// cost  ✔️
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED bool ReprojectionDepthRefused(Real64 HeldDepth, Real64 ArrivingDepth, Real64 DepthBound)
{
    const Real64 Scale = Magnitude(ArrivingDepth) > 0.0 ? Magnitude(ArrivingDepth) : 1.0;

    return Magnitude(HeldDepth - ArrivingDepth) / Scale > DepthBound;
}

/// 🧩 Bounds one accumulated component against the arriving rotation's local neighbourhood.
/// in    HeldComponent   [-]  the reprojected history
/// in    LeastComponent  [-]  the least value among the arriving neighbourhood
/// in    GreatestComponent [-] the greatest among it
/// out   Bounded         [-]  the history, brought inside the neighbourhood
/// note  🔴 This is what handles illumination that changed without the surface moving — an illuminant
///        brightened, a stroke painted. `22`'s painting invalidates nothing here explicitly; the bound resolves
///        it — `64` §4.
/// note  ⚠️ Bounded rather than refused, because a refusal resets the count and a lighting change that merely
///        brightened a surface does not warrant discarding its whole convergence.
/// cost  ✔️
/// tag   shared, parity, nonallocating, nonthrowing
SLATE_SHARED Real64 BoundNeighbourhood(Real64 HeldComponent, Real64 LeastComponent, Real64 GreatestComponent)
{
    return BoundedMagnitude(HeldComponent, LeastComponent, GreatestComponent);
}

}   // namespace Slate
