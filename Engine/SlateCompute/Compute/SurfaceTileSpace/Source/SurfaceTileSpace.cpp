//============================================================================================================================================
//                                                          SURFACETILESPACE.CPP
//============================================================================================================================================
// 🧩 The coarsening walk that never stalls, the revision comparison, and promotion that evicts only what it may.

#include "SlateCompute/Compute/SurfaceTileSpace/Api/SurfaceTileSpace.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    CELL ADDRESSING
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> OrdinalOf(CellAddress Addressed)
{
    if (Addressed.Level >= ReductionLevelCount)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no such reduction level" });

    const std::uint32_t Span = CellsPerEdgeAt(Addressed.Level);

    if (Addressed.Along >= Span || Addressed.Across >= Span)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no such cell at that level" });

    return Deliver<std::uint32_t>::Deliver(LevelBaseOrdinal(Addressed.Level) + Addressed.Across * Span
                                         + Addressed.Along);
}

Deliver<CellAddress> AddressOf(std::uint32_t CellOrdinal)
{
    if (CellOrdinal >= CellOrdinalSpan)
        return Deliver<CellAddress>::Refuse({ RefusalReason::ContentUnsupported, "no such cell" });

    for (std::uint32_t Level = 0u; Level < ReductionLevelCount; ++Level)
    {
        const std::uint32_t Span = CellsPerEdgeAt(Level);
        const std::uint32_t Base = LevelBaseOrdinal(Level);

        if (CellOrdinal >= Base + Span * Span)
            continue;

        CellAddress Addressed;
        Addressed.Level  = Level;
        Addressed.Along  = (CellOrdinal - Base) % Span;
        Addressed.Across = (CellOrdinal - Base) / Span;

        return Deliver<CellAddress>::Deliver(Addressed);
    }

    return Deliver<CellAddress>::Refuse({ RefusalReason::ContentUnsupported, "no such cell" });
}

Deliver<std::uint32_t> OrdinalAt(std::uint32_t Level, double PositionAlong, double PositionAcross)
{
    if (Level >= ReductionLevelCount)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no such reduction level" });

    const std::uint32_t Span = CellsPerEdgeAt(Level);
    const double        Edge = static_cast<double>(Span);

    // 📝 Clamped rather than refused. `68` §5 packs every chart strictly inside the domain with an apron's gap,
    //    so a position outside the unit square is an apron read at the domain edge — and the edge cell is what
    //    it should read from.
    double AlongCell  = PositionAlong  * Edge;
    double AcrossCell = PositionAcross * Edge;

    AlongCell  = AlongCell  < 0.0 ? 0.0 : (AlongCell  > Edge - 1.0 ? Edge - 1.0 : AlongCell);
    AcrossCell = AcrossCell < 0.0 ? 0.0 : (AcrossCell > Edge - 1.0 ? Edge - 1.0 : AcrossCell);

    CellAddress Addressed;
    Addressed.Level  = Level;
    Addressed.Along  = static_cast<std::uint32_t>(AlongCell);
    Addressed.Across = static_cast<std::uint32_t>(AcrossCell);

    return OrdinalOf(Addressed);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE CELLS
//------------------------------------------------------------------------------------------------------------------------

void CellSpace::Construct()
{
    CellRecords.assign(CellOrdinalSpan, CellRecord{});
    ResidentCells    = 0u;
    UncommittedCells = 0u;

    // 🔴 The coarsest `PermanentLevelCount` levels are marked here and never unmarked. `20` §3: every sample has
    //    an answer regardless of what is promoted, and that guarantee is a property of the marking rather than
    //    of any eviction policy being careful.
    for (std::uint32_t Level = ReductionLevelCount - PermanentLevelCount; Level < ReductionLevelCount; ++Level)
    {
        const std::uint32_t Span = CellsPerEdgeAt(Level);
        const std::uint32_t Base = LevelBaseOrdinal(Level);

        for (std::uint32_t Ordinal = 0u; Ordinal < Span * Span; ++Ordinal)
            CellRecords[Base + Ordinal].Permanent = true;
    }
}

Deliver<const CellRecord*> CellSpace::Held(std::uint32_t CellOrdinal) const
{
    if (CellOrdinal >= CellRecords.size())
        return Deliver<const CellRecord*>::Refuse({ RefusalReason::ContentUnsupported, "no such cell" });

    return Deliver<const CellRecord*>::Deliver(&CellRecords[CellOrdinal]);
}

Deliver<CellRecord*> CellSpace::Amend(std::uint32_t CellOrdinal)
{
    if (CellOrdinal >= CellRecords.size())
        return Deliver<CellRecord*>::Refuse({ RefusalReason::ContentUnsupported, "no such cell" });

    return Deliver<CellRecord*>::Deliver(&CellRecords[CellOrdinal]);
}

const std::vector<CellRecord>& CellSpace::Records() const { return CellRecords; }

std::uint32_t CellSpace::ResidentCount() const     { return ResidentCells;    }
std::uint32_t CellSpace::UncommittedCount() const  { return UncommittedCells; }

void CellSpace::DeclareResident(std::uint32_t CellOrdinal, std::uint32_t SlotOrdinal, std::uint64_t RecordingOrdinal)
{
    CellRecord& Held_ = CellRecords[CellOrdinal];

    if (!Held_.Resident)
        ++ResidentCells;

    Held_.SlotOrdinal  = SlotOrdinal;
    Held_.Resident     = true;
    Held_.PromotedAt   = RecordingOrdinal;
    Held_.ApronWritten = false;
}

void CellSpace::DeclareAbsent(std::uint32_t CellOrdinal)
{
    CellRecord& Held_ = CellRecords[CellOrdinal];

    if (Held_.Resident && ResidentCells != 0u)
        --ResidentCells;

    Held_.SlotOrdinal      = AbsentTile;
    Held_.Resident         = false;
    Held_.ApronWritten     = false;
    Held_.ResolvedRevision = 0u;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> SurfaceTileSpace::Construct(std::uint32_t SurfaceOrdinal_,
                                          std::uint32_t BytesPerTexel,
                                          std::uint32_t SlotCeiling)
{
    // 📐 The permanent levels' cell count, summed from the marking rule rather than transcribed. Five at the
    //    declared subdivision; transcribing it would be a second representation of `PermanentLevelCount`.
    std::uint32_t PermanentCells = 0u;

    for (std::uint32_t Level = ReductionLevelCount - PermanentLevelCount; Level < ReductionLevelCount; ++Level)
    {
        const std::uint32_t Span = CellsPerEdgeAt(Level);
        PermanentCells += Span * Span;
    }

    if (SlotCeiling < PermanentCells)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ExtentExhausted, "the backing cannot hold the permanently resident levels" });
    }

    const Deliver<bool> Ledger = Tiles_.Construct(SlotCeiling, BytesPerTexel);

    if (!Ledger.ContentPresent)
        return Ledger;

    // 🚧 The depot's ceiling is the backing extent again, which is a placeholder for the discretionary claim
    //    `06` §3 will report. It is declared rather than derived so nothing here consults a device.
    const Deliver<bool> Depoted = Depot_.Construct(Tiles_.BackingBytes());

    if (!Depoted.ContentPresent)
        return Depoted;

    Cells_.Construct();

    Ordinal     = SurfaceOrdinal_;
    Constructed = true;

    // 🔴 The permanent levels are made resident immediately, before anything can sample. Promoting them lazily
    //    would leave the first rotations of a session with no resident level at all, which is exactly the stall
    //    `20` §3's guarantee exists to remove — and it would appear only on the first frame, where nobody looks.
    for (std::uint32_t CellOrdinal = 0u; CellOrdinal < CellOrdinalSpan; ++CellOrdinal)
    {
        if (!Cells_.Records()[CellOrdinal].Permanent)
            continue;

        const Deliver<std::uint32_t> Claimed = Tiles_.Claim();

        if (!Claimed.ContentPresent)
            return Deliver<bool>::Refuse(Claimed.Declined);

        Cells_.DeclareResident(CellOrdinal, Claimed.Resolve(), 0u);
    }

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      SAMPLING
//------------------------------------------------------------------------------------------------------------------------

Deliver<SampledCell> SurfaceTileSpace::Sample(std::uint32_t Level,
                                              double        PositionAlong,
                                              double        PositionAcross,
                                              std::uint64_t RecordingOrdinal,
                                              RequestQueue& Requesting)
{
    if (!Constructed)
        return Deliver<SampledCell>::Refuse({ RefusalReason::HostDenied, "the residency is not constructed" });

    if (Level >= ReductionLevelCount)
        return Deliver<SampledCell>::Refuse({ RefusalReason::ContentUnsupported, "no such reduction level" });

    SampledCell Resolved;
    Resolved.RequestedLevel = Level;

    // 🔴 The coarsening walk, and the whole of `20` §5's never-stalls gate. It terminates because the coarsest
    //    levels are permanently resident, so the loop cannot fall off the end of the chain.
    for (std::uint32_t Walking = Level; Walking < ReductionLevelCount; ++Walking)
    {
        const Deliver<std::uint32_t> Located = OrdinalAt(Walking, PositionAlong, PositionAcross);

        if (!Located.ContentPresent)
            continue;

        const std::uint32_t CellOrdinal = Located.Resolve();
        CellRecord&         Held_       = *Cells_.Amend(CellOrdinal).Resolve();

        if (Walking == Level)
        {
            // 📝 The demand names the level that was **wanted**, not the level that answered. Demanding the
            //    level that answered would demand a cell that is already resident, and the surface would never
            //    refine past whatever it happened to have.
            Held_.DemandedAt = RecordingOrdinal;

            if (!Held_.Resident)
            {
                Requesting.Demand(Ordinal, CellOrdinal, RecordingOrdinal);
                Resolved.DemandRecorded = true;
            }
        }

        if (!Held_.Resident)
            continue;

        // 📝 The coarser cell that answered is marked demanded too, so the eviction ordering does not take away
        //    the tile that is currently doing the work of the one that is missing.
        Held_.DemandedAt = RecordingOrdinal;

        Resolved.CellOrdinal   = CellOrdinal;
        Resolved.SlotOrdinal   = Held_.SlotOrdinal;
        Resolved.ResolvedLevel = Walking;

        return Deliver<SampledCell>::Deliver(Resolved);
    }

    // 📝 Unreachable while the permanent levels stand, and stated as a refusal rather than as an assumption so
    //    that a future amendment to `PermanentLevelCount` is caught here rather than by an artist.
    return Deliver<SampledCell>::Refuse(
        { RefusalReason::ExtentExhausted, "no resident level answered; the permanence guarantee is broken" });
}

Deliver<SampledCell> SurfaceTileSpace::SampleGuaranteed(double PositionAlong, double PositionAcross) const
{
    if (!Constructed)
        return Deliver<SampledCell>::Refuse({ RefusalReason::HostDenied, "the residency is not constructed" });

    // 🔴 `16` §3.1 ③: the coarsest **guaranteed-resident** level, and never a demand. This walks only the
    //    permanent levels, so it cannot resolve to a tile that a later eviction could take away — and it cannot
    //    record a demand that would put a visibility recording on the promotion path.
    for (std::uint32_t Walking = ReductionLevelCount - PermanentLevelCount; Walking < ReductionLevelCount; ++Walking)
    {
        const Deliver<std::uint32_t> Located = OrdinalAt(Walking, PositionAlong, PositionAcross);

        if (!Located.ContentPresent)
            continue;

        const Deliver<const CellRecord*> Held_ = Cells_.Held(Located.Resolve());

        if (!Held_.ContentPresent || !Held_.Resolve()->Resident)
            continue;

        SampledCell Resolved;
        Resolved.CellOrdinal    = Located.Resolve();
        Resolved.SlotOrdinal    = Held_.Resolve()->SlotOrdinal;
        Resolved.ResolvedLevel  = Walking;
        Resolved.RequestedLevel = Walking;

        return Deliver<SampledCell>::Deliver(Resolved);
    }

    return Deliver<SampledCell>::Refuse(
        { RefusalReason::ExtentExhausted, "no guaranteed level is resident" });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  UNCOMMITTED PAINT
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> SurfaceTileSpace::DeclareUncommitted(std::uint32_t CellOrdinal, bool UncommittedDeclared)
{
    const Deliver<CellRecord*> Amending = Cells_.Amend(CellOrdinal);

    if (!Amending.ContentPresent)
        return Deliver<bool>::Refuse(Amending.Declined);

    CellRecord& Held_ = *Amending.Resolve();

    if (UncommittedDeclared && !Held_.Resident)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::HostDenied, "a cell with no tile cannot hold uncommitted paint" });
    }

    if (Held_.Uncommitted == UncommittedDeclared)
        return Deliver<bool>::Deliver(true);

    Held_.Uncommitted = UncommittedDeclared;

    if (UncommittedDeclared)
        ++Cells_.UncommittedCells;
    else if (Cells_.UncommittedCells != 0u)
        --Cells_.UncommittedCells;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      PROMOTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> SurfaceTileSpace::ClaimOrEvict(PromotionScheduler& Scheduling, std::uint64_t RecordingOrdinal)
{
    const Deliver<std::uint32_t> Claimed = Tiles_.Claim();

    if (Claimed.ContentPresent)
        return Claimed;

    // 📝 The whole span is walked once. It is 5461 entries at the declared subdivision, which is a scan the
    //    promotion of one tile can afford and which needs no second ordering to be kept current — and a second
    //    ordering is a second representation that drifts from the records the moment one is amended.
    const std::vector<CellRecord>& Records = Cells_.Records();

    bool              Found     = false;
    EvictionCandidate Preferred = {};

    for (std::uint32_t CellOrdinal = 0u; CellOrdinal < Records.size(); ++CellOrdinal)
    {
        const CellRecord& Held_ = Records[CellOrdinal];

        // 🔴 The three exclusions, in one place. A permanent cell would break `20` §3's guarantee, an
        //    uncommitted cell would discard the artist's unsealed stroke, and a cell promoted this rotation is
        //    one the caller is about to write into.
        if (!Held_.Resident || Held_.Permanent || Held_.Uncommitted)
            continue;

        if (Held_.PromotedAt == RecordingOrdinal)
            continue;

        const Deliver<CellAddress> Addressed = AddressOf(CellOrdinal);

        EvictionCandidate Candidate;
        Candidate.CellOrdinal = CellOrdinal;
        Candidate.Level       = Addressed.ContentPresent ? Addressed.Resolve().Level : 0u;
        Candidate.DemandedAt  = Held_.DemandedAt;
        Candidate.PromotedAt  = Held_.PromotedAt;

        if (!Found || PrecedesInEviction(Scheduling.Ordering(), Candidate, Preferred))
        {
            Preferred = Candidate;
            Found     = true;
        }
    }

    if (!Found)
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ExtentExhausted, "every resident tile is permanent, uncommitted or newly promoted" });
    }

    const Deliver<bool> Evicted = Evict(Preferred.CellOrdinal, RecordingOrdinal);

    if (!Evicted.ContentPresent)
        return Deliver<std::uint32_t>::Refuse(Evicted.Declined);

    // 🔴 The evicted slot is quarantined, not freed, so the claim below still refuses. Reclaiming it here would
    //    be reclaiming inside the recording slot count, which is the one thing `20` §5 forbids — so the promotion
    //    defers this rotation and takes the freed slot on the rotation after the depth elapses.
    return Tiles_.Claim();
}

Deliver<PromotionDisposition> SurfaceTileSpace::Promote(std::uint32_t        CellOrdinal,
                                                        const PromotionCost& Costing,
                                                        std::uint64_t        ContentRevision,
                                                        PromotionScheduler&  Scheduling,
                                                        std::uint64_t        RecordingOrdinal)
{
    if (!Constructed)
    {
        return Deliver<PromotionDisposition>::Refuse(
            { RefusalReason::HostDenied, "the residency is not constructed" });
    }

    const Deliver<CellRecord*> Amending = Cells_.Amend(CellOrdinal);

    if (!Amending.ContentPresent)
        return Deliver<PromotionDisposition>::Refuse(Amending.Declined);

    CellRecord& Held_ = *Amending.Resolve();

    // 🔴 `70` §2's comparison, and the reason the whole mechanism is affordable. One integer test at Exact, per
    //    tile, whose answer is almost always "no work": a camera move advances no counter, and an occupant that
    //    moved advances none either, because a placement's transform is stored relative to its surface.
    if (Held_.Resident && Held_.ResolvedRevision == ContentRevision)
        return Deliver<PromotionDisposition>::Deliver(PromotionDisposition::AlreadyResident);

    if (!Scheduling.Admits(Costing))
    {
        Scheduling.DeferOne();
        return Deliver<PromotionDisposition>::Deliver(PromotionDisposition::Deferred);
    }

    // 📝 A resident cell at a stale revision keeps its own slot and is resolved into again. Releasing and
    //    re-claiming would quarantine the slot for the recording slot count and leave the cell absent meanwhile —
    //    so an edited layer would make its own surface go coarse for two rotations at every stroke.
    if (Held_.Resident)
    {
        const Deliver<bool> Charged = Scheduling.Charge(Costing);

        if (!Charged.ContentPresent)
        {
            Scheduling.DeferOne();
            return Deliver<PromotionDisposition>::Deliver(PromotionDisposition::Deferred);
        }

        Held_.ResolvedRevision = ContentRevision;
        Held_.PromotedAt       = RecordingOrdinal;
        Held_.ApronWritten     = false;

        Scheduling.PromoteOne();

        return Deliver<PromotionDisposition>::Deliver(PromotionDisposition::ReResolved);
    }

    const Deliver<std::uint32_t> Claimed = ClaimOrEvict(Scheduling, RecordingOrdinal);

    if (!Claimed.ContentPresent)
    {
        Scheduling.DeferOne();
        return Deliver<PromotionDisposition>::Deliver(PromotionDisposition::Deferred);
    }

    const Deliver<bool> Charged = Scheduling.Charge(Costing);

    if (!Charged.ContentPresent)
    {
        // 📝 The slot is handed straight back rather than held for a promotion that did not happen. It goes into
        //    quarantine like any release, which is correct: nothing was written into it, and the depth costs one
        //    slot for two rotations rather than a rule that has to distinguish an unwritten slot from a written
        //    one.
        Disregard(Tiles_.Release(Claimed.Resolve(), RecordingOrdinal));

        Scheduling.DeferOne();
        return Deliver<PromotionDisposition>::Deliver(PromotionDisposition::Deferred);
    }

    Cells_.DeclareResident(CellOrdinal, Claimed.Resolve(), RecordingOrdinal);
    Held_.ResolvedRevision = ContentRevision;

    Scheduling.PromoteOne();

    return Deliver<PromotionDisposition>::Deliver(PromotionDisposition::Promoted);
}

Deliver<bool> SurfaceTileSpace::DeclareApronWritten(std::uint32_t CellOrdinal)
{
    const Deliver<CellRecord*> Amending = Cells_.Amend(CellOrdinal);

    if (!Amending.ContentPresent)
        return Deliver<bool>::Refuse(Amending.Declined);

    if (!Amending.Resolve()->Resident)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "the cell holds no tile to apron" });

    Amending.Resolve()->ApronWritten = true;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  EVICTION AND RECLAIM
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> SurfaceTileSpace::Evict(std::uint32_t CellOrdinal, std::uint64_t RecordingOrdinal)
{
    const Deliver<CellRecord*> Amending = Cells_.Amend(CellOrdinal);

    if (!Amending.ContentPresent)
        return Deliver<bool>::Refuse(Amending.Declined);

    CellRecord& Held_ = *Amending.Resolve();

    if (!Held_.Resident)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the cell holds no tile" });

    if (Held_.Permanent)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "a permanently resident level is never evicted" });
    }

    if (Held_.Uncommitted)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "the tile holds paint no transaction has sealed" });
    }

    const std::uint32_t SlotOrdinal = Held_.SlotOrdinal;

    Cells_.DeclareAbsent(CellOrdinal);

    return Tiles_.Release(SlotOrdinal, RecordingOrdinal);
}

std::uint32_t SurfaceTileSpace::Reconcile(std::uint64_t RecordingOrdinal)
{
    return Tiles_.Reclaim(RecordingOrdinal);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE MEASURES
//------------------------------------------------------------------------------------------------------------------------

void SurfaceTileSpace::Report(MeasureIndex&             Measured,
                              const PromotionScheduler& Scheduling,
                              TickPoint                 Sampled) const
{
    // 🔴 Every one of these **overwrites** — `86` §2. A residency total appended once per rotation buries the
    //    one refusal that mattered under thousands of readings nobody asked for, and `20` appends nothing at all:
    //    it is absent from `86` §4's register precisely because it makes no promise to report.
    Measured.DeclareCount("20 §2 SurfaceTileSpace", "ResidentTiles", Cells_.ResidentCount(), Sampled);
    Measured.DeclareCount("20 §2 SurfaceTileSpace", "QuarantinedTiles", Tiles_.QuarantinedCount(), Sampled);
    Measured.DeclareCount("20 §2 SurfaceTileSpace", "FreeTiles", Tiles_.FreeCount(), Sampled);
    Measured.DeclareCount("20 §2.2 PromotionScheduler", "Promoted", Scheduling.PromotedCount(), Sampled);
    Measured.DeclareCount("20 §2.2 PromotionScheduler", "Deferred", Scheduling.DeferredCount(), Sampled);
    Measured.DeclareCount("20 §2.2 PromotionScheduler", "TransferRemaining",
                          Scheduling.Remaining().TransferBytes, Sampled);
    Measured.DeclareCount("20 §2.2 PromotionScheduler", "EvaluationRemaining",
                          Scheduling.Remaining().EvaluationUnits, Sampled);
    Measured.DeclareCount("20 §4 SurfaceDepot", "OccupiedBytes", Depot_.OccupiedBytes(), Sampled);
    Measured.DeclareCount("20 §4 SurfaceDepot", "HeldArtefacts", Depot_.HeldCount(), Sampled);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

const CellSpace&    SurfaceTileSpace::Cells() const { return Cells_; }
const TileSpace&    SurfaceTileSpace::Tiles() const { return Tiles_; }
SurfaceDepot&       SurfaceTileSpace::Depot()       { return Depot_; }
const SurfaceDepot& SurfaceTileSpace::Depot() const { return Depot_; }

std::uint32_t SurfaceTileSpace::SurfaceOrdinal() const     { return Ordinal;                    }
std::uint64_t SurfaceTileSpace::StoredBytesPerTile() const { return Tiles_.StoredBytesPerTile(); }

bool SurfaceTileSpace::ResidencyValid(std::uint64_t RecordingOrdinal) const
{
    if (!Constructed)
        return false;

    if (!Tiles_.LedgerConsistent() || !Depot_.DepotConsistent())
        return false;

    const std::vector<CellRecord>& Records = Cells_.Records();

    std::vector<bool> SlotHeld(Tiles_.SlotCeiling(), false);

    std::uint32_t Resident = 0u;

    for (const CellRecord& Held_ : Records)
    {
        if (Held_.Permanent && !Held_.Resident)
            return false;

        if (Held_.Uncommitted && !Held_.Resident)
            return false;

        if (!Held_.Resident)
        {
            if (Held_.SlotOrdinal != AbsentTile)
                return false;

            continue;
        }

        ++Resident;

        if (Held_.SlotOrdinal >= SlotHeld.size() || SlotHeld[Held_.SlotOrdinal])
            return false;

        SlotHeld[Held_.SlotOrdinal] = true;

        // 🔴 `20` §5: every resident tile carries a written apron. Checked only for tiles promoted before this
        //    rotation, because a tile promoted this rotation is one the caller has not yet written — and
        //    demanding it here would make the invariant unsatisfiable at exactly the moment it is most useful.
        if (Held_.PromotedAt < RecordingOrdinal && !Held_.ApronWritten)
            return false;
    }

    return Resident == Cells_.ResidentCount() && Resident == Tiles_.ClaimedCount();
}

}   // namespace Slate
