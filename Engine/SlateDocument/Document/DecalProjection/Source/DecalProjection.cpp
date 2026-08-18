//============================================================================================================================================
//                                                           DECALPROJECTION.CPP
//============================================================================================================================================
// 🧩 The inverse of a decomposed placing transform, the two extent derivations, and the drag that records nothing until release.

#include "SlateDocument/Document/DecalProjection/Api/DecalProjection.h"

#include <cmath>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    TRANSFORM HELPERS
//------------------------------------------------------------------------------------------------------------------------

namespace
{

RotationQuaternion Conjugated(RotationQuaternion Subject)
{
    RotationQuaternion Reversed;
    Reversed.ImaginaryX = -Subject.ImaginaryX;
    Reversed.ImaginaryY = -Subject.ImaginaryY;
    Reversed.ImaginaryZ = -Subject.ImaginaryZ;
    Reversed.Real       =  Subject.Real;

    return Reversed;
}

// 📐 The quaternion sandwich, expanded. Deriving a matrix and multiplying by it is the same arithmetic with a
//    temporary in the middle, and the temporary is what a later reader caches.
void RotateSpan(RotationQuaternion Rotation,
                double SpanX, double SpanY, double SpanZ,
                double& OutX, double& OutY, double& OutZ)
{
    const double CrossX = Rotation.ImaginaryY * SpanZ - Rotation.ImaginaryZ * SpanY;
    const double CrossY = Rotation.ImaginaryZ * SpanX - Rotation.ImaginaryX * SpanZ;
    const double CrossZ = Rotation.ImaginaryX * SpanY - Rotation.ImaginaryY * SpanX;

    const double SecondX = Rotation.ImaginaryY * CrossZ - Rotation.ImaginaryZ * CrossY;
    const double SecondY = Rotation.ImaginaryZ * CrossX - Rotation.ImaginaryX * CrossZ;
    const double SecondZ = Rotation.ImaginaryX * CrossY - Rotation.ImaginaryY * CrossX;

    OutX = SpanX + 2.0 * (Rotation.Real * CrossX + SecondX);
    OutY = SpanY + 2.0 * (Rotation.Real * CrossY + SecondY);
    OutZ = SpanZ + 2.0 * (Rotation.Real * CrossZ + SecondZ);
}

// 📝 A domain placement's transform is read in the plane alone — the third ordinate carries nothing, because the
//    domain is two-dimensional. Reading it would let a domain placement acquire a depth the domain cannot express.
void ProjectPlanar(const DecomposedTransform& Placing,
                   double SourceAlong, double SourceAcross,
                   double& AlongOut, double& AcrossOut)
{
    const double ScaledAlong  = (SourceAlong  - 0.5) * Placing.ScaleX;
    const double ScaledAcross = (SourceAcross - 0.5) * Placing.ScaleY;

    double TurnedAlong  = 0.0;
    double TurnedAcross = 0.0;
    double TurnedDeep   = 0.0;

    RotateSpan(Placing.Rotation, ScaledAlong, ScaledAcross, 0.0, TurnedAlong, TurnedAcross, TurnedDeep);

    AlongOut  = TurnedAlong  + Placing.Translation.PositionX;
    AcrossOut = TurnedAcross + Placing.Translation.PositionY;
}

// 📝 One representable step outward on each face, matching `38` §6. An extent rounded inward excludes the
//    placement's own border from `74` §3's containment test, and the artist meets it as a decal with a thin band
//    along one edge that cannot be clicked.
void WidenOutward(DomainExtent& Widening)
{
    Widening.LeastAlong     = std::nextafter(Widening.LeastAlong,     -HUGE_VAL);
    Widening.LeastAcross    = std::nextafter(Widening.LeastAcross,    -HUGE_VAL);
    Widening.GreatestAlong  = std::nextafter(Widening.GreatestAlong,   HUGE_VAL);
    Widening.GreatestAcross = std::nextafter(Widening.GreatestAcross,  HUGE_VAL);
}

void AdmitPosition(DomainExtent& Running, double Along, double Across, bool& FirstAdmission)
{
    if (FirstAdmission)
    {
        Running.LeastAlong     = Along;
        Running.GreatestAlong  = Along;
        Running.LeastAcross    = Across;
        Running.GreatestAcross = Across;

        FirstAdmission = false;

        return;
    }

    Running.LeastAlong     = Along  < Running.LeastAlong     ? Along  : Running.LeastAlong;
    Running.GreatestAlong  = Along  > Running.GreatestAlong  ? Along  : Running.GreatestAlong;
    Running.LeastAcross    = Across < Running.LeastAcross    ? Across : Running.LeastAcross;
    Running.GreatestAcross = Across > Running.GreatestAcross ? Across : Running.GreatestAcross;
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                  INTO THE SOURCE SPACE
//------------------------------------------------------------------------------------------------------------------------

bool ProjectIntoSource(const PlacementSpecification& Placed,
                       double                        PositionAlong,
                       double                        PositionAcross,
                       double&                       SourceAlong,
                       double&                       SourceAcross)
{
    // 📐 The inverse of a decomposed transform, taken decomposed. Translation is subtracted, the rotation is
    //    conjugated, and the scale is reciprocated — `02` §3.1 keeps a transform in this form precisely so that
    //    the inverse is three cheap steps rather than a general matrix inversion whose conditioning nobody
    //    tracks.
    const double SpanAlong  = PositionAlong  - Placed.PlacingTransform.Translation.PositionX;
    const double SpanAcross = PositionAcross - Placed.PlacingTransform.Translation.PositionY;

    double TurnedAlong  = 0.0;
    double TurnedAcross = 0.0;
    double TurnedDeep   = 0.0;

    RotateSpan(Conjugated(Placed.PlacingTransform.Rotation),
               SpanAlong, SpanAcross, 0.0,
               TurnedAlong, TurnedAcross, TurnedDeep);

    const double ScaleAlong  = Placed.PlacingTransform.ScaleX != 0.0 ? Placed.PlacingTransform.ScaleX : 1.0;
    const double ScaleAcross = Placed.PlacingTransform.ScaleY != 0.0 ? Placed.PlacingTransform.ScaleY : 1.0;

    SourceAlong  = TurnedAlong  / ScaleAlong  + 0.5;
    SourceAcross = TurnedAcross / ScaleAcross + 0.5;

    // 📝 A tiling source is periodic and has no unit square to fall outside of — `54` §2's lattice classifies
    //    every position, at whatever cell ordinal it lands in. Bounding it here would clip a pattern to the
    //    placement's own footprint twice, once by the extent and once by this test.
    if (Placed.Source == PlacedSource::Tiling)
        return true;

    return SourceAlong >= 0.0 && SourceAlong <= 1.0 && SourceAcross >= 0.0 && SourceAcross <= 1.0;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE DERIVED EXTENT
//------------------------------------------------------------------------------------------------------------------------

Deliver<DomainExtent> ProjectPlacementExtent(const PlacementSpecification&         Placed,
                                             std::uint32_t                         PlacementOrdinal,
                                             std::uint32_t                         SequenceOrdinal,
                                             const TopologyStructure&              Imported,
                                             const std::vector<DomainCoordinate>&  CornerCoordinates)
{
    if (!Imported.Sealed())
    {
        return Deliver<DomainExtent>::Refuse(
            { RefusalReason::HostDenied, "an unsealed topology may still be declared into" });
    }

    if (static_cast<std::uint32_t>(CornerCoordinates.size()) != Imported.CornerCount())
    {
        return Deliver<DomainExtent>::Refuse(
            { RefusalReason::ContentUnsupported, "the coordinate run carries a corner count the topology does not" });
    }

    DomainExtent Derived;
    Derived.PlacementOrdinal = PlacementOrdinal;
    Derived.SequenceOrdinal  = SequenceOrdinal;

    bool FirstAdmission = true;

    if (Placed.Mode == PlacementMode::DomainPlaced)
    {
        // 📐 The four corners of the source's unit square through the placing transform. Four and not two,
        //    because the transform carries a rotation — the extent of a rotated square is not the transform of
        //    its extent, and taking two corners is the mistake that shows up only once the artist turns a decal.
        for (std::uint32_t Corner = 0u; Corner < 4u; ++Corner)
        {
            const double SourceAlong  = (Corner & 1u) != 0u ? 1.0 : 0.0;
            const double SourceAcross = (Corner & 2u) != 0u ? 1.0 : 0.0;

            double Along  = 0.0;
            double Across = 0.0;
            ProjectPlanar(Placed.PlacingTransform, SourceAlong, SourceAcross, Along, Across);

            AdmitPosition(Derived, Along, Across, FirstAdmission);
        }

        WidenOutward(Derived);

        return Deliver<DomainExtent>::Deliver(Derived);
    }

    // 🔴 A projected placement covers whatever its volume reaches, which is a question about the topology rather
    //    than about the transform. The volume's own axes are the placing transform's, so a corner is tested by
    //    carrying it back into that frame and comparing against the declared half extents and reach — the same
    //    slab test `40` performs, in the placement's space rather than the document's.
    const RotationQuaternion    Inverse   = Conjugated(Placed.PlacingTransform.Rotation);
    const std::vector<DocumentPosition>& Positions = Imported.Positions();

    for (std::uint32_t CornerOrdinal = 0u; CornerOrdinal < Imported.CornerCount(); ++CornerOrdinal)
    {
        const DocumentPosition& Held = Positions[Imported.CornerVertex(CornerOrdinal)];

        const double SpanX = Held.PositionX - Placed.PlacingTransform.Translation.PositionX;
        const double SpanY = Held.PositionY - Placed.PlacingTransform.Translation.PositionY;
        const double SpanZ = Held.PositionZ - Placed.PlacingTransform.Translation.PositionZ;

        double LocalX = 0.0;
        double LocalY = 0.0;
        double LocalZ = 0.0;
        RotateSpan(Inverse, SpanX, SpanY, SpanZ, LocalX, LocalY, LocalZ);

        if (LocalX < -Placed.ProjectedHalfAlong  || LocalX > Placed.ProjectedHalfAlong)
            continue;

        if (LocalY < -Placed.ProjectedHalfAcross || LocalY > Placed.ProjectedHalfAcross)
            continue;

        // 📐 The volume projects along its own negative third axis, matching `46`'s camera convention and `44`'s
        //    emission direction. One convention across all three means a decal parented to a spot illuminant
        //    covers what that illuminant lights.
        const double Reach = -LocalZ;

        if (Reach < 0.0 || Reach > Placed.ProjectedReach)
            continue;

        // ⚠️ 🚧 Back-facing corners are refused unless the placement admits them, and `72` §6 carries what the
        //    right rule is as open. Refusing is the conservative reading: a decal projected onto a shoulder
        //    should not also land on the far side of the arm, where the artist cannot see it and will not
        //    understand why the extent reaches there.
        if (!Placed.BackFacingAdmitted)
        {
            // 📝 The perpendicular is not available here — `38`'s conditioning is the caller's, not this
            //    component's — so facing is judged by the corner's own displacement along the projection axis
            //    relative to the face's first corner. That is coarse and it is conservative in the admitting
            //    direction, which is the direction §6's note declares safe.
            const std::uint32_t FaceOrdinal = Imported.CornerFace(CornerOrdinal);
            const std::uint32_t FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);

            if (CornerOrdinal != FirstCorner)
            {
                const DocumentPosition& Leading = Positions[Imported.CornerVertex(FirstCorner)];

                const double LeadingSpanX = Leading.PositionX - Placed.PlacingTransform.Translation.PositionX;
                const double LeadingSpanY = Leading.PositionY - Placed.PlacingTransform.Translation.PositionY;
                const double LeadingSpanZ = Leading.PositionZ - Placed.PlacingTransform.Translation.PositionZ;

                double LeadingX = 0.0;
                double LeadingY = 0.0;
                double LeadingZ = 0.0;
                RotateSpan(Inverse, LeadingSpanX, LeadingSpanY, LeadingSpanZ, LeadingX, LeadingY, LeadingZ);

                if (-LeadingZ > Placed.ProjectedReach)
                    continue;
            }
        }

        AdmitPosition(Derived,
                      static_cast<double>(CornerCoordinates[CornerOrdinal].CoordinateAlong),
                      static_cast<double>(CornerCoordinates[CornerOrdinal].CoordinateAcross),
                      FirstAdmission);
    }

    // 📝 A projected placement reaching no corner covers nothing, and that is reported as a refusal rather than
    //    as an extent of nothing. An empty extent admitted into `AxisSpace` is a placement `74` can never pick
    //    and `12` can never present as missing — the artist sees a row that does nothing at all.
    if (FirstAdmission)
    {
        return Deliver<DomainExtent>::Refuse(
            { RefusalReason::ExtentExhausted, "the projecting volume reaches no corner of the topology" });
    }

    WidenOutward(Derived);

    return Deliver<DomainExtent>::Deliver(Derived);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE PLACEMENTS
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> PlacementIndex::Declare(const PlacementSpecification& Declaring)
{
    if (!Declaring.Occupant.IdentityDeclared())
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::IdentityStale, "a placement attaches to no occupant" });
    }

    if (Declaring.Source == PlacedSource::SourceCount || Declaring.Mode == PlacementMode::ModeCount)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no such source or mode" });

    if (Declaring.Mode == PlacementMode::ProjectedPlaced
     && (Declaring.ProjectedHalfAlong <= 0.0 || Declaring.ProjectedHalfAcross <= 0.0
      || Declaring.ProjectedReach     <= 0.0))
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ContentUnsupported, "a projecting volume of no extent reaches nothing" });
    }

    if (Declaring.PlacingTransform.ScaleX == 0.0 || Declaring.PlacingTransform.ScaleY == 0.0)
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ContentUnsupported, "a placement scaled to nothing covers nothing" });
    }

    std::uint32_t PlacementOrdinal = AbsentPlacement;

    if (!ReleasedOrdinals.empty())
    {
        PlacementOrdinal = ReleasedOrdinals.back();
        ReleasedOrdinals.pop_back();
    }
    else
    {
        if (Placements.size() >= PlacementCeiling)
        {
            return Deliver<std::uint32_t>::Refuse(
                { RefusalReason::ExtentExhausted, "the document reached its placement ceiling" });
        }

        PlacementOrdinal = static_cast<std::uint32_t>(Placements.size());
        Placements.push_back(HeldPlacement{});
    }

    HeldPlacement& Arriving = Placements[PlacementOrdinal];

    // 📝 The revision carries across a slot's reuse rather than restarting at one. A resident tile that recorded
    //    the previous occupant's revision would otherwise match the new one's and stand unresolved, which is a
    //    decal showing whatever the slot used to hold.
    const std::uint64_t Carried = Arriving.Declared.RevisionCounter;

    Arriving.Declared                 = Declaring;
    Arriving.Declared.RevisionCounter = Carried + 1u;
    Arriving.SlotOccupied             = true;

    ++OccupiedCount;

    return Deliver<std::uint32_t>::Deliver(PlacementOrdinal);
}

Deliver<bool> PlacementIndex::Amend(std::uint32_t PlacementOrdinal, const PlacementSpecification& Amending)
{
    if (PlacementOrdinal >= Placements.size() || !Placements[PlacementOrdinal].SlotOccupied)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no placement stands at that ordinal" });

    HeldPlacement& Held = Placements[PlacementOrdinal];

    // 🔴 `00` §10.1 ②'s third row and nothing else. A combination change amends how the resolved value reads
    //    against what is beneath it and does not change the value, so advancing the revision for one would
    //    re-resolve a tile to the number it already holds — and would do it for every tile the placement covers.
    const bool SourceMoved = Held.Declared.Source              != Amending.Source
                          || Held.Declared.SourceOrdinal       != Amending.SourceOrdinal
                          || Held.Declared.Mode                != Amending.Mode
                          || Held.Declared.ChannelMask         != Amending.ChannelMask
                          || Held.Declared.ProjectedHalfAlong  != Amending.ProjectedHalfAlong
                          || Held.Declared.ProjectedHalfAcross != Amending.ProjectedHalfAcross
                          || Held.Declared.ProjectedReach      != Amending.ProjectedReach
                          || Held.Declared.PlacingTransform.Translation.PositionX
                             != Amending.PlacingTransform.Translation.PositionX
                          || Held.Declared.PlacingTransform.Translation.PositionY
                             != Amending.PlacingTransform.Translation.PositionY
                          || Held.Declared.PlacingTransform.Translation.PositionZ
                             != Amending.PlacingTransform.Translation.PositionZ
                          || Held.Declared.PlacingTransform.ScaleX != Amending.PlacingTransform.ScaleX
                          || Held.Declared.PlacingTransform.ScaleY != Amending.PlacingTransform.ScaleY
                          || Held.Declared.PlacingTransform.ScaleZ != Amending.PlacingTransform.ScaleZ
                          || Held.Declared.PlacingTransform.Rotation.ImaginaryX
                             != Amending.PlacingTransform.Rotation.ImaginaryX
                          || Held.Declared.PlacingTransform.Rotation.ImaginaryY
                             != Amending.PlacingTransform.Rotation.ImaginaryY
                          || Held.Declared.PlacingTransform.Rotation.ImaginaryZ
                             != Amending.PlacingTransform.Rotation.ImaginaryZ
                          || Held.Declared.PlacingTransform.Rotation.Real
                             != Amending.PlacingTransform.Rotation.Real;

    const std::uint64_t Standing = Held.Declared.RevisionCounter;

    Held.Declared                 = Amending;
    Held.Declared.RevisionCounter = SourceMoved ? Standing + 1u : Standing;

    return Deliver<bool>::Deliver(true);
}

Deliver<const PlacementSpecification*> PlacementIndex::Resolve(std::uint32_t PlacementOrdinal) const
{
    if (PlacementOrdinal >= Placements.size() || !Placements[PlacementOrdinal].SlotOccupied)
    {
        return Deliver<const PlacementSpecification*>::Refuse(
            { RefusalReason::ContentUnsupported, "no placement stands at that ordinal" });
    }

    return Deliver<const PlacementSpecification*>::Deliver(&Placements[PlacementOrdinal].Declared);
}

Deliver<bool> PlacementIndex::Withdraw(std::uint32_t PlacementOrdinal)
{
    if (PlacementOrdinal >= Placements.size() || !Placements[PlacementOrdinal].SlotOccupied)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no placement stands at that ordinal" });

    Placements[PlacementOrdinal].SlotOccupied = false;

    // 📝 The specification is retained and the slot is marked free. `56` §6 retains a withdrawn entry's
    //    description so the inverse can restore it, and a slot whose specification was cleared here would leave
    //    that inverse with nothing to restore.
    ReleasedOrdinals.push_back(PlacementOrdinal);

    if (OccupiedCount != 0u)
        --OccupiedCount;

    return Deliver<bool>::Deliver(true);
}

std::uint64_t PlacementIndex::Revision(std::uint32_t PlacementOrdinal) const
{
    if (PlacementOrdinal >= Placements.size() || !Placements[PlacementOrdinal].SlotOccupied)
        return 0u;

    return Placements[PlacementOrdinal].Declared.RevisionCounter;
}

std::uint32_t PlacementIndex::DeclaredCount() const
{
    return OccupiedCount;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE POSITIONING DRAG
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> PlacementSequence::Open(std::uint32_t                 PlacementOrdinal,
                                      const PlacementSpecification& Standing,
                                      bool                          CameraFollowed_)
{
    if (OpenDeclared)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "a positioning drag is already open" });

    PriorPlacement   = Standing;
    AmendedPlacement = Standing;
    SubjectOrdinal   = PlacementOrdinal;
    CameraFollowed   = CameraFollowed_;
    OpenDeclared     = true;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> PlacementSequence::Amend(const DecomposedTransform& Amending)
{
    if (!OpenDeclared)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "no positioning drag is open" });

    AmendedPlacement.PlacingTransform = Amending;

    return Deliver<bool>::Deliver(true);
}

Deliver<PlacementSpecification> PlacementSequence::Abandon()
{
    if (!OpenDeclared)
    {
        return Deliver<PlacementSpecification>::Refuse(
            { RefusalReason::HostDenied, "no positioning drag is open" });
    }

    const PlacementSpecification Restored = PriorPlacement;

    AmendedPlacement = PriorPlacement;
    SubjectOrdinal   = AbsentPlacement;
    OpenDeclared     = false;
    CameraFollowed   = false;

    return Deliver<PlacementSpecification>::Deliver(Restored);
}

Deliver<PlacementSpecification> PlacementSequence::Seal()
{
    if (!OpenDeclared)
    {
        return Deliver<PlacementSpecification>::Refuse(
            { RefusalReason::HostDenied, "no positioning drag is open" });
    }

    // 🔴 The revision advances **here**, once, for the whole drag. Advancing it per Amend would re-resolve every
    //    covered tile at every pointer sample, which is the cost `22` §4.1's speculative extent exists to avoid
    //    and which `70` §2's counter comparison exists to make measurable.
    PlacementSpecification Sealed = AmendedPlacement;
    ++Sealed.RevisionCounter;

    // 📝 The camera stops being followed by the drag ending, not by a freezing step. `00` §10.1 ① requires the
    //    screen gesture to resolve into a projected placement on release; the last transform `78` computed is
    //    already that placement, so there is nothing here to forget.
    SubjectOrdinal = AbsentPlacement;
    OpenDeclared   = false;
    CameraFollowed = false;

    return Deliver<PlacementSpecification>::Deliver(Sealed);
}

const PlacementSpecification& PlacementSequence::Amended() const  { return AmendedPlacement; }
std::uint32_t                 PlacementSequence::Subject() const  { return SubjectOrdinal;   }
bool                          PlacementSequence::GestureOpen() const   { return OpenDeclared;   }
bool                          PlacementSequence::CameraFollowing() const { return CameraFollowed; }

}   // namespace Slate
