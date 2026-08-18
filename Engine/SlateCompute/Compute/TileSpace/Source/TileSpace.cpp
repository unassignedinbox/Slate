//============================================================================================================================================
//                                                              TILESPACE.CPP
//============================================================================================================================================
// 🧩 Claim, release into quarantine, and the reclamation deferred by the recording slot count.

#include "SlateCompute/Compute/TileSpace/Api/TileSpace.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> TileSpace::Construct(std::uint32_t SlotCeiling_, std::uint32_t BytesPerTexel)
{
    if (SlotCeiling_ == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a ledger of no slot backs nothing" });

    if (BytesPerTexel == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a texel of no width stores nothing" });

    Ceiling = SlotCeiling_;

    // 📐 The apron is counted into the stored extent rather than added at the transfer site, because a tile
    //    whose apron is budgeted separately is one whose byte offsets overlap its neighbour's border by four
    //    texels on each side — and the overlap reads as a fringe rather than as an arithmetic error.
    TileBytes = static_cast<std::uint64_t>(StoredTexelsPerEdge)
              * static_cast<std::uint64_t>(StoredTexelsPerEdge)
              * static_cast<std::uint64_t>(BytesPerTexel);

    Standing.assign(Ceiling, SlotStanding::Free);
    ReleasedAt.assign(Ceiling, 0u);

    FreeOrdinals.clear();
    FreeOrdinals.reserve(Ceiling);

    // 📝 Pushed in descending order so the first claim takes slot zero. A ledger that handed out its highest
    //    slot first would be correct and would make every measurement of it read backwards.
    for (std::uint32_t Ordinal = Ceiling; Ordinal-- > 0u;)
        FreeOrdinals.push_back(Ordinal);

    ClaimedSlots     = 0u;
    QuarantinedSlots = 0u;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CLAIM AND RELEASE
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> TileSpace::Claim()
{
    if (FreeOrdinals.empty())
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ExtentExhausted, "every slot is claimed or quarantined" });
    }

    const std::uint32_t Claimed = FreeOrdinals.back();
    FreeOrdinals.pop_back();

    Standing[Claimed] = SlotStanding::Claimed;
    ++ClaimedSlots;

    return Deliver<std::uint32_t>::Deliver(Claimed);
}

Deliver<bool> TileSpace::Release(std::uint32_t SlotOrdinal, std::uint64_t RecordingOrdinal)
{
    if (SlotOrdinal >= Ceiling)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no such slot" });

    if (Standing[SlotOrdinal] != SlotStanding::Claimed)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the slot is not claimed" });

    Standing[SlotOrdinal]   = SlotStanding::Quarantined;
    ReleasedAt[SlotOrdinal] = RecordingOrdinal;

    --ClaimedSlots;
    ++QuarantinedSlots;

    return Deliver<bool>::Deliver(true);
}

std::uint32_t TileSpace::Reclaim(std::uint64_t RecordingOrdinal)
{
    if (QuarantinedSlots == 0u)
        return 0u;

    std::uint32_t Reclaimed = 0u;

    for (std::uint32_t SlotOrdinal = 0u; SlotOrdinal < Ceiling; ++SlotOrdinal)
    {
        if (Standing[SlotOrdinal] != SlotStanding::Quarantined)
            continue;

        // 🔴 `20` §5: reclamation is deferred by the recording slot count. The comparison is written as a subtraction
        //    from the current rotation rather than as an addition to the release, because the release ordinal
        //    plus the depth overflows at the end of the representable range and the current ordinal does not.
        if (RecordingOrdinal < ReleasedAt[SlotOrdinal]
         || RecordingOrdinal - ReleasedAt[SlotOrdinal] < RecordingSlotCount)
        {
            continue;
        }

        Standing[SlotOrdinal] = SlotStanding::Free;
        FreeOrdinals.push_back(SlotOrdinal);

        --QuarantinedSlots;
        ++Reclaimed;
    }

    return Reclaimed;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint64_t> TileSpace::ByteOffsetOf(std::uint32_t SlotOrdinal) const
{
    if (SlotOrdinal >= Ceiling)
        return Deliver<std::uint64_t>::Refuse({ RefusalReason::ContentUnsupported, "no such slot" });

    return Deliver<std::uint64_t>::Deliver(static_cast<std::uint64_t>(SlotOrdinal) * TileBytes);
}

std::uint64_t TileSpace::StoredBytesPerTile() const { return TileBytes; }

std::uint64_t TileSpace::BackingBytes() const
{
    return static_cast<std::uint64_t>(Ceiling) * TileBytes;
}

std::uint32_t TileSpace::SlotCeiling() const       { return Ceiling;          }
std::uint32_t TileSpace::ClaimedCount() const      { return ClaimedSlots;     }
std::uint32_t TileSpace::QuarantinedCount() const  { return QuarantinedSlots; }

std::uint32_t TileSpace::FreeCount() const
{
    return static_cast<std::uint32_t>(FreeOrdinals.size());
}

bool TileSpace::LedgerConsistent() const
{
    std::uint32_t Free = 0u;
    std::uint32_t Held = 0u;
    std::uint32_t Kept = 0u;

    for (const SlotStanding Standing_ : Standing)
    {
        if (Standing_ == SlotStanding::Free)             ++Free;
        else if (Standing_ == SlotStanding::Claimed)     ++Held;
        else                                             ++Kept;
    }

    return Free == FreeOrdinals.size()
        && Held == ClaimedSlots
        && Kept == QuarantinedSlots
        && Free + Held + Kept == Ceiling;
}

}   // namespace Slate
