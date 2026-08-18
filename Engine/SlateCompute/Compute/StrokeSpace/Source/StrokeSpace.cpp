//============================================================================================================================================
//                                                            STROKESPACE.CPP
//============================================================================================================================================
// 🧩 Sparse tile claiming over the dense cell index, and the commutative coverage accumulation.

#include "SlateCompute/Compute/StrokeSpace/Api/StrokeSpace.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

void StrokeSpace::Construct()
{
    TileOfCell.assign(CellOrdinalSpan, AbsentTile);

    ClaimedCells.clear();
    Claimed.clear();

    TouchedTexels = 0u;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CLAIM AND LOCATE
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> StrokeSpace::Claim(std::uint32_t CellOrdinal)
{
    if (TileOfCell.empty())
        Construct();

    if (CellOrdinal >= CellOrdinalSpan)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no such cell" });

    if (TileOfCell[CellOrdinal] != AbsentTile)
        return Deliver<std::uint32_t>::Deliver(TileOfCell[CellOrdinal]);

    if (Claimed.size() >= CoverageTileCeiling)
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ExtentExhausted, "the stroke touched more cells than the accumulation holds" });
    }

    const std::uint32_t TileOrdinal = static_cast<std::uint32_t>(Claimed.size());

    // 📝 Zeroed on claim rather than on reclaim. A stroke that touches four cells and is abandoned pays for four
    //    tiles; zeroing at reclaim would pay for whatever the previous stroke touched as well.
    Claimed.push_back(std::vector<float>(static_cast<std::size_t>(CoverageTileTexels) * CoverageTileTexels, 0.0f));
    ClaimedCells.push_back(CellOrdinal);

    TileOfCell[CellOrdinal] = TileOrdinal;

    return Deliver<std::uint32_t>::Deliver(TileOrdinal);
}

Deliver<std::uint32_t> StrokeSpace::Located(std::uint32_t CellOrdinal) const
{
    if (CellOrdinal >= TileOfCell.size() || TileOfCell[CellOrdinal] == AbsentTile)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ExtentExhausted, "the stroke has not touched it" });

    return Deliver<std::uint32_t>::Deliver(TileOfCell[CellOrdinal]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ACCUMULATION
//------------------------------------------------------------------------------------------------------------------------

void StrokeSpace::Accumulate(std::uint32_t TileOrdinal, std::uint32_t Along, std::uint32_t Across, double Arriving)
{
    if (TileOrdinal >= Claimed.size() || Along >= CoverageTileTexels || Across >= CoverageTileTexels)
        return;

    if (Arriving <= 0.0)
        return;

    const std::size_t Writing = static_cast<std::size_t>(Across) * CoverageTileTexels + Along;

    const double Standing = static_cast<double>(Claimed[TileOrdinal][Writing]);

    if (Standing <= 0.0)
        ++TouchedTexels;

    // 🔴 `22` §3's within-stroke rule, and the one line that decides it. `Over` saturates toward unity and is
    //    symmetric in its operands; addition neither saturates nor stays inside the interval the apply reads.
    const double Combined = CombineCoverage(CombineSpecification::Over,
                                            Standing,
                                            Arriving > 1.0 ? 1.0 : Arriving);

    Claimed[TileOrdinal][Writing] = static_cast<float>(Combined > 1.0 ? 1.0 : Combined);
}

double StrokeSpace::Coverage(std::uint32_t TileOrdinal, std::uint32_t Along, std::uint32_t Across) const
{
    if (TileOrdinal >= Claimed.size() || Along >= CoverageTileTexels || Across >= CoverageTileTexels)
        return 0.0;

    return static_cast<double>(Claimed[TileOrdinal][static_cast<std::size_t>(Across) * CoverageTileTexels + Along]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

const std::vector<std::uint32_t>& StrokeSpace::TouchedCells() const { return ClaimedCells; }

std::uint32_t StrokeSpace::ClaimedCount() const
{
    return static_cast<std::uint32_t>(Claimed.size());
}

std::uint64_t StrokeSpace::TouchedTexelCount() const { return TouchedTexels; }

void StrokeSpace::Reclaim()
{
    for (const std::uint32_t CellOrdinal : ClaimedCells)
    {
        if (CellOrdinal < TileOfCell.size())
            TileOfCell[CellOrdinal] = AbsentTile;
    }

    ClaimedCells.clear();
    Claimed.clear();

    TouchedTexels = 0u;
}

}   // namespace Slate
