//============================================================================================================================================
//                                                            SURFACEDEPOT.CPP
//============================================================================================================================================
// 🧩 The reconstructibility refusal, key resolution, and least-recently-resolved eviction.

#include "SlateCompute/Compute/SurfaceDepot/Api/SurfaceDepot.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> SurfaceDepot::Construct(std::uint64_t ByteCeiling_)
{
    if (ByteCeiling_ == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a depot of no extent holds nothing" });

    Held.clear();
    Ceiling  = ByteCeiling_;
    Occupied = 0u;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     ADMISSION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> SurfaceDepot::Declare(const ContentKey&  Keyed,
                                    LayerContentSource Source,
                                    std::uint64_t      ByteExtent,
                                    std::uint64_t      RecordingOrdinal)
{
    // 🔴 `20` §5's gate, enforced at the one door into the depot. `56` §3's own predicate decides it, so the
    //    classification lives with the document that owns the content rather than with the residency that
    //    can only see texels.
    if (!SourceReconstructible(Source))
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "painted texels are authored content and are never evictable" });
    }

    if (ByteExtent == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "an artefact of no extent" });

    if (ByteExtent > Ceiling)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ExtentExhausted, "the artefact alone exceeds the whole depot" });
    }

    // 📝 A re-declaration of the same key replaces what stood. Two artefacts under one key would both be
    //    resolvable and the resolution would take whichever was admitted first, which is the older of the two.
    for (std::size_t Ordinal = 0u; Ordinal < Held.size(); ++Ordinal)
    {
        if (!KeysAgree(Held[Ordinal].Keyed, Keyed))
            continue;

        Occupied -= Held[Ordinal].ByteExtent;
        Held.erase(Held.begin() + static_cast<std::ptrdiff_t>(Ordinal));
        break;
    }

    if (Occupied + ByteExtent > Ceiling)
        Evict((Occupied + ByteExtent) - Ceiling);

    DepotArtefact Admitting;
    Admitting.Keyed      = Keyed;
    Admitting.Source     = Source;
    Admitting.ByteExtent = ByteExtent;
    Admitting.ResolvedAt = RecordingOrdinal;

    Held.push_back(Admitting);
    Occupied += ByteExtent;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     RESOLUTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<DepotArtefact> SurfaceDepot::Resolve(const ContentKey& Keyed, std::uint64_t RecordingOrdinal)
{
    for (DepotArtefact& Standing : Held)
    {
        if (!KeysAgree(Standing.Keyed, Keyed))
            continue;

        // 📝 Marked here rather than by a separate call, because an artefact resolved and not marked is one the
        //    eviction ordering believes is unused — and the tile being promoted from it right now is the one
        //    that gets evicted.
        Standing.ResolvedAt = RecordingOrdinal;
        ++ResolvedTotal;

        return Deliver<DepotArtefact>::Deliver(Standing);
    }

    return Deliver<DepotArtefact>::Refuse({ RefusalReason::ExtentExhausted, "nothing is held under that key" });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      EVICTION
//------------------------------------------------------------------------------------------------------------------------

std::uint32_t SurfaceDepot::Evict(std::uint64_t ByteExtent)
{
    std::uint32_t Evicted = 0u;
    std::uint64_t Freed   = 0u;

    while (Freed < ByteExtent && !Held.empty())
    {
        // 📝 Least recently resolved. An artefact resolved this rotation is one a promotion is reading now, and
        //    evicting it to make room for the promotion that is reading it is the one ordering that cannot work.
        std::size_t Oldest = 0u;

        for (std::size_t Ordinal = 1u; Ordinal < Held.size(); ++Ordinal)
        {
            if (Held[Ordinal].ResolvedAt < Held[Oldest].ResolvedAt)
                Oldest = Ordinal;
        }

        Freed    += Held[Oldest].ByteExtent;
        Occupied -= Held[Oldest].ByteExtent;

        Held.erase(Held.begin() + static_cast<std::ptrdiff_t>(Oldest));

        ++Evicted;
        ++EvictedTotal;
    }

    return Evicted;
}

std::uint32_t SurfaceDepot::Supersede(std::uint64_t PartitionRevision)
{
    std::uint32_t Discarded = 0u;

    for (std::size_t Ordinal = Held.size(); Ordinal-- > 0u;)
    {
        if (Held[Ordinal].Keyed.PartitionRevision >= PartitionRevision)
            continue;

        Occupied -= Held[Ordinal].ByteExtent;
        Held.erase(Held.begin() + static_cast<std::ptrdiff_t>(Ordinal));

        ++Discarded;
        ++EvictedTotal;
    }

    return Discarded;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

std::uint64_t SurfaceDepot::OccupiedBytes() const { return Occupied;      }
std::uint64_t SurfaceDepot::ByteCeiling() const   { return Ceiling;       }
std::uint64_t SurfaceDepot::ResolvedCount() const { return ResolvedTotal; }
std::uint64_t SurfaceDepot::EvictedCount() const  { return EvictedTotal;  }

std::uint32_t SurfaceDepot::HeldCount() const
{
    return static_cast<std::uint32_t>(Held.size());
}

bool SurfaceDepot::DepotConsistent() const
{
    std::uint64_t Accumulated = 0u;

    for (const DepotArtefact& Standing : Held)
    {
        if (!SourceReconstructible(Standing.Source))
            return false;

        Accumulated += Standing.ByteExtent;
    }

    return Accumulated == Occupied && Occupied <= Ceiling;
}

}   // namespace Slate
