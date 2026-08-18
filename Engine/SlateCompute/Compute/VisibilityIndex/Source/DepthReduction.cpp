//============================================================================================================================================
//                                                            DEPTHREDUCTION.CPP
//============================================================================================================================================
// 🧩 Halving a display extent into a level chain, and the integer logarithm that picks the level one partition is tested at.

#include "SlateCompute/Compute/VisibilityIndex/Api/DepthReduction.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> DepthReduction::Construct(std::uint32_t DisplayAlong, std::uint32_t DisplayAcross)
{
    if (DisplayAlong == 0u || DisplayAcross == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a display extent of zero reduces nothing" });

    if (DisplayAlong > DisplayExtentCeiling || DisplayAcross > DisplayExtentCeiling)
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "the display extent is above the declared ceiling" });

    // 📝 Reclaimed first rather than appended to, so a second Construct against a different extent cannot leave the
    //    previous chain's levels behind the new ones. A chain that grew instead of being replaced reports a level
    //    count the display extent never implied, and the selection below then returns a level nothing reduced into.
    Reclaim();

    std::uint32_t LevelAlong  = DisplayAlong;
    std::uint32_t LevelAcross = DisplayAcross;

    for (;;)
    {
        if (Levels.size() >= static_cast<std::size_t>(ReductionLevelCeiling))
        {
            Reclaim();

            return Deliver<bool>::Refuse(
                { RefusalReason::ExtentExhausted, "the chain would carry more levels than the declared ceiling" });
        }

        ReductionLevel Derived;
        Derived.ExtentAlong  = LevelAlong;
        Derived.ExtentAcross = LevelAcross;
        Levels.push_back(Derived);

        if (LevelAlong == 1u && LevelAcross == 1u)
            break;

        // 📐 Rounding up on both ordinates. Nine texels halve to five and not to four: the odd column has depth
        //    recorded in it, and a level that dropped it is one a partition projecting onto the display's last
        //    column is tested against without its own depth ever having reached it.
        LevelAlong  = LevelAlong  > 1u ? (LevelAlong  + 1u) / 2u : 1u;
        LevelAcross = LevelAcross > 1u ? (LevelAcross + 1u) / 2u : 1u;
    }

    DerivedAlong  = DisplayAlong;
    DerivedAcross = DisplayAcross;
    ChainStanding = true;

    return Deliver<bool>::Deliver(true);
}

void DepthReduction::Reclaim()
{
    Levels.clear();

    DerivedAlong  = 0u;
    DerivedAcross = 0u;
    ChainStanding = false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   LEVEL SELECTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<ReductionLevel> DepthReduction::Level(std::uint32_t LevelOrdinal) const
{
    if (LevelOrdinal >= static_cast<std::uint32_t>(Levels.size()))
        return Deliver<ReductionLevel>::Refuse({ RefusalReason::ContentUnsupported, "no such level" });

    return Deliver<ReductionLevel>::Deliver(Levels[LevelOrdinal]);
}

Deliver<std::uint32_t> DepthReduction::LevelOfExtent(std::uint32_t ProjectedAlong, std::uint32_t ProjectedAcross) const
{
    if (!ChainStanding)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no chain is derived" });

    // 📐 The same halving Construct performed, run over the projected extent instead of the display extent. Both
    //    round up, so the count arrived at here is exactly how many texels of that level the extent spans — which
    //    is what makes two by two the right terminator rather than an approximation of one.
    std::uint32_t RemainingAlong  = ProjectedAlong;
    std::uint32_t RemainingAcross = ProjectedAcross;
    std::uint32_t Selected        = 0u;

    const std::uint32_t Coarsest = static_cast<std::uint32_t>(Levels.size()) - 1u;

    while ((RemainingAlong > 2u || RemainingAcross > 2u) && Selected < Coarsest)
    {
        RemainingAlong  = (RemainingAlong  + 1u) / 2u;
        RemainingAcross = (RemainingAcross + 1u) / 2u;
        ++Selected;
    }

    return Deliver<std::uint32_t>::Deliver(Selected);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE READS
//------------------------------------------------------------------------------------------------------------------------

std::uint64_t DepthReduction::ChainTexels() const
{
    std::uint64_t Spanned = 0u;

    for (const ReductionLevel& Counted : Levels)
    {
        Spanned += static_cast<std::uint64_t>(Counted.ExtentAlong)
                 * static_cast<std::uint64_t>(Counted.ExtentAcross);
    }

    return Spanned;
}

std::uint32_t DepthReduction::LevelCount() const
{
    return static_cast<std::uint32_t>(Levels.size());
}

std::uint32_t DepthReduction::DisplayAlong() const
{
    return DerivedAlong;
}

std::uint32_t DepthReduction::DisplayAcross() const
{
    return DerivedAcross;
}

bool DepthReduction::ChainDerived() const
{
    return ChainStanding;
}

}   // namespace Slate
