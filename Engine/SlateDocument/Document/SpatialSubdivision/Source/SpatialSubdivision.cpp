//============================================================================================================================================
//                                                          SPATIALSUBDIVISION.CPP
//============================================================================================================================================
// 🧩 Octant division, nearest-first descent, exact face classification, and refit without rebuild.

#include "SlateDocument/Document/SpatialSubdivision/Api/SpatialSubdivision.h"

#include "Shared/IntersectionClassifier.slang.h"
#include "Shared/OrientationClassifier.slang.h"

#include <cmath>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    EXTENT HELPERS
//------------------------------------------------------------------------------------------------------------------------

namespace
{

ConditionedExtent EmptyExtent()
{
    ConditionedExtent Empty;
    Empty.Least.PositionX    =  HUGE_VAL;
    Empty.Least.PositionY    =  HUGE_VAL;
    Empty.Least.PositionZ    =  HUGE_VAL;
    Empty.Greatest.PositionX = -HUGE_VAL;
    Empty.Greatest.PositionY = -HUGE_VAL;
    Empty.Greatest.PositionZ = -HUGE_VAL;

    return Empty;
}

void Widen(ConditionedExtent& Widening, const ConditionedExtent& Arriving)
{
    Widening.Least.PositionX    = Arriving.Least.PositionX    < Widening.Least.PositionX
                                ? Arriving.Least.PositionX    : Widening.Least.PositionX;
    Widening.Least.PositionY    = Arriving.Least.PositionY    < Widening.Least.PositionY
                                ? Arriving.Least.PositionY    : Widening.Least.PositionY;
    Widening.Least.PositionZ    = Arriving.Least.PositionZ    < Widening.Least.PositionZ
                                ? Arriving.Least.PositionZ    : Widening.Least.PositionZ;
    Widening.Greatest.PositionX = Arriving.Greatest.PositionX > Widening.Greatest.PositionX
                                ? Arriving.Greatest.PositionX : Widening.Greatest.PositionX;
    Widening.Greatest.PositionY = Arriving.Greatest.PositionY > Widening.Greatest.PositionY
                                ? Arriving.Greatest.PositionY : Widening.Greatest.PositionY;
    Widening.Greatest.PositionZ = Arriving.Greatest.PositionZ > Widening.Greatest.PositionZ
                                ? Arriving.Greatest.PositionZ : Widening.Greatest.PositionZ;
}

bool ExtentOccupied(const ConditionedExtent& Held)
{
    return Held.Greatest.PositionX >= Held.Least.PositionX
        && Held.Greatest.PositionY >= Held.Least.PositionY
        && Held.Greatest.PositionZ >= Held.Least.PositionZ;
}

double ExtentVolume(const ConditionedExtent& Held)
{
    if (!ExtentOccupied(Held))
        return 0.0;

    return (Held.Greatest.PositionX - Held.Least.PositionX)
         * (Held.Greatest.PositionY - Held.Least.PositionY)
         * (Held.Greatest.PositionZ - Held.Least.PositionZ);
}

bool ExtentsOverlap(const ConditionedExtent& Left, const ConditionedExtent& Right)
{
    return ClassifyVolumeOverlap(Left.Least.PositionX,     Left.Least.PositionY,     Left.Least.PositionZ,
                                 Left.Greatest.PositionX,  Left.Greatest.PositionY,  Left.Greatest.PositionZ,
                                 Right.Least.PositionX,    Right.Least.PositionY,    Right.Least.PositionZ,
                                 Right.Greatest.PositionX, Right.Greatest.PositionY, Right.Greatest.PositionZ) >= 0;
}

bool ExtentContains(const ConditionedExtent& Outer, const ConditionedExtent& Inner)
{
    return Outer.Least.PositionX    <= Inner.Least.PositionX
        && Outer.Least.PositionY    <= Inner.Least.PositionY
        && Outer.Least.PositionZ    <= Inner.Least.PositionZ
        && Outer.Greatest.PositionX >= Inner.Greatest.PositionX
        && Outer.Greatest.PositionY >= Inner.Greatest.PositionY
        && Outer.Greatest.PositionZ >= Inner.Greatest.PositionZ;
}

// 📐 The slab test, returning the interval the ray occupies inside the extent. A component of zero direction is
//    handled by the reciprocal becoming infinite and the comparison resolving to the correct side, which is why
//    the reciprocals are taken once by the caller rather than divided per record.
bool SlabInterval(const ConditionedExtent& Held,
                  DocumentPosition         Origin,
                  double ReciprocalX, double ReciprocalY, double ReciprocalZ,
                  double& Entering,   double& Leaving)
{
    double Nearest  = 0.0;
    double Furthest = HUGE_VAL;

    const double LeastAll[3]    = { Held.Least.PositionX,    Held.Least.PositionY,    Held.Least.PositionZ    };
    const double GreatestAll[3] = { Held.Greatest.PositionX, Held.Greatest.PositionY, Held.Greatest.PositionZ };
    const double OriginAll[3]   = { Origin.PositionX,        Origin.PositionY,        Origin.PositionZ        };
    const double Reciprocals[3] = { ReciprocalX,             ReciprocalY,             ReciprocalZ             };

    for (std::uint32_t Axis = 0u; Axis < 3u; ++Axis)
    {
        double Entry = (LeastAll[Axis]    - OriginAll[Axis]) * Reciprocals[Axis];
        double Exit  = (GreatestAll[Axis] - OriginAll[Axis]) * Reciprocals[Axis];

        if (Entry > Exit)
        {
            const double Held_ = Entry;
            Entry              = Exit;
            Exit               = Held_;
        }

        Nearest  = Entry > Nearest  ? Entry : Nearest;
        Furthest = Exit  < Furthest ? Exit  : Furthest;

        if (Furthest < Nearest)
            return false;
    }

    Entering = Nearest;
    Leaving  = Furthest;

    return true;
}

RotationQuaternion Conjugated(RotationQuaternion Subject)
{
    RotationQuaternion Reversed;
    Reversed.ImaginaryX = -Subject.ImaginaryX;
    Reversed.ImaginaryY = -Subject.ImaginaryY;
    Reversed.ImaginaryZ = -Subject.ImaginaryZ;
    Reversed.Real       =  Subject.Real;

    return Reversed;
}

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

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                THE INNER SUBDIVISION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> BoundingStructure::Construct(const TopologyStructure& Imported, const TopologyConditioning& Conditioned)
{
    if (!Imported.Sealed())
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::HostDenied, "an unsealed topology is not immutable for the run" });
    }

    // 🔴 The conditioning must describe this seal. Extents derived from a different one index faces that have
    //    moved, and every intersection resolved against them is confidently wrong rather than merely absent.
    if (Conditioned.ConditionedRevision() != Imported.Revision())
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ExtentExhausted, "the conditioning describes a different topology revision" });
    }

    Positions        = Imported.Positions();
    FaceExtents      = Conditioned.FaceExtents();
    DescribedRevision = Imported.Revision();

    const std::uint32_t FaceSpan = Imported.FaceCount();

    FaceFirstCorners.assign(FaceSpan, 0u);
    FaceCornerCounts.assign(FaceSpan, 0u);

    for (std::uint32_t FaceOrdinal = 0u; FaceOrdinal < FaceSpan; ++FaceOrdinal)
    {
        FaceFirstCorners[FaceOrdinal] = Imported.FaceFirstCorner(FaceOrdinal);
        FaceCornerCounts[FaceOrdinal] = Imported.FaceCornerCount(FaceOrdinal);
    }

    CornerVertices.assign(Imported.CornerCount(), 0u);

    for (std::uint32_t CornerOrdinal = 0u; CornerOrdinal < Imported.CornerCount(); ++CornerOrdinal)
        CornerVertices[CornerOrdinal] = Imported.CornerVertex(CornerOrdinal);

    // 📝 A face enrolled as zero-extent is excluded from the ordering rather than from the arrays. `38` §3
    //    excludes and never renumbers, so the face ordinal a hit reports is still the artist's own.
    FaceOrder.clear();
    FaceOrder.reserve(FaceSpan);

    for (std::uint32_t FaceOrdinal = 0u; FaceOrdinal < FaceSpan; ++FaceOrdinal)
    {
        if (Conditioned.FaceEnrolled(FaceOrdinal, DegeneracySubject::ZeroExtentFace))
            continue;

        FaceOrder.push_back(FaceOrdinal);
    }

    Records.clear();

    BoundingRecord Root;
    Root.FirstFace = 0u;
    Root.FaceCount = static_cast<std::uint32_t>(FaceOrder.size());
    Root.Extent    = EmptyExtent();

    for (const std::uint32_t FaceOrdinal : FaceOrder)
        Widen(Root.Extent, FaceExtents[FaceOrdinal]);

    Records.push_back(Root);

    if (!FaceOrder.empty())
        Divide(0u, 0u);

    StructureBuilt = true;

    return Deliver<bool>::Deliver(true);
}

void BoundingStructure::Divide(std::uint32_t RecordOrdinal, std::uint32_t Depth)
{
    if (Depth >= SubdivisionDepthCeiling)
        return;

    if (Records[RecordOrdinal].FaceCount <= SubdivisionLeafCeiling)
        return;

    const ConditionedExtent Held      = Records[RecordOrdinal].Extent;
    const std::uint32_t     FirstFace = Records[RecordOrdinal].FirstFace;
    const std::uint32_t     FaceSpan  = Records[RecordOrdinal].FaceCount;

    const double MiddleX = (Held.Least.PositionX + Held.Greatest.PositionX) * 0.5;
    const double MiddleY = (Held.Least.PositionY + Held.Greatest.PositionY) * 0.5;
    const double MiddleZ = (Held.Least.PositionZ + Held.Greatest.PositionZ) * 0.5;

    // 📝 A face is assigned to the octant its own centre falls in, so every face lands in exactly one child and
    //    the ordering is a partition rather than a duplication. Assigning by overlap would put a face straddling
    //    the middle into eight children at once, and the traversal would test it eight times.
    std::uint32_t OctantCounts[8] = {};

    std::vector<std::uint32_t> Assignment(FaceSpan, 0u);

    for (std::uint32_t Passed = 0u; Passed < FaceSpan; ++Passed)
    {
        const ConditionedExtent& Face = FaceExtents[FaceOrder[FirstFace + Passed]];

        const double CentreX = (Face.Least.PositionX + Face.Greatest.PositionX) * 0.5;
        const double CentreY = (Face.Least.PositionY + Face.Greatest.PositionY) * 0.5;
        const double CentreZ = (Face.Least.PositionZ + Face.Greatest.PositionZ) * 0.5;

        const std::uint32_t Octant = (CentreX >= MiddleX ? 1u : 0u)
                                   | (CentreY >= MiddleY ? 2u : 0u)
                                   | (CentreZ >= MiddleZ ? 4u : 0u);

        Assignment[Passed] = Octant;
        ++OctantCounts[Octant];
    }

    std::uint32_t Occupied = 0u;

    for (std::uint32_t Octant = 0u; Octant < 8u; ++Octant)
    {
        if (OctantCounts[Octant] != 0u)
            ++Occupied;
    }

    // 📝 Every face in one octant means the division separated nothing, which happens where coincident faces
    //    outnumber the leaf ceiling. Dividing again would recurse to the depth ceiling and produce eight records
    //    of which seven are empty.
    if (Occupied <= 1u)
        return;

    std::uint32_t OctantFirst[8] = {};
    std::uint32_t Accumulated    = 0u;

    for (std::uint32_t Octant = 0u; Octant < 8u; ++Octant)
    {
        OctantFirst[Octant] = Accumulated;
        Accumulated        += OctantCounts[Octant];
    }

    std::vector<std::uint32_t> Reordered(FaceSpan, 0u);
    std::uint32_t              OctantWrite[8] = {};

    for (std::uint32_t Passed = 0u; Passed < FaceSpan; ++Passed)
    {
        const std::uint32_t Octant = Assignment[Passed];

        Reordered[OctantFirst[Octant] + OctantWrite[Octant]] = FaceOrder[FirstFace + Passed];
        ++OctantWrite[Octant];
    }

    for (std::uint32_t Passed = 0u; Passed < FaceSpan; ++Passed)
        FaceOrder[FirstFace + Passed] = Reordered[Passed];

    const std::uint32_t FirstDivided = static_cast<std::uint32_t>(Records.size());

    for (std::uint32_t Octant = 0u; Octant < 8u; ++Octant)
    {
        BoundingRecord Dividing;
        Dividing.FirstFace = FirstFace + OctantFirst[Octant];
        Dividing.FaceCount = OctantCounts[Octant];
        Dividing.Extent    = EmptyExtent();

        for (std::uint32_t Passed = 0u; Passed < Dividing.FaceCount; ++Passed)
            Widen(Dividing.Extent, FaceExtents[FaceOrder[Dividing.FirstFace + Passed]]);

        Records.push_back(Dividing);
    }

    Records[RecordOrdinal].FirstDivided = FirstDivided;

    for (std::uint32_t Octant = 0u; Octant < 8u; ++Octant)
    {
        if (Records[FirstDivided + Octant].FaceCount != 0u)
            Divide(FirstDivided + Octant, Depth + 1u);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 FACE CLASSIFICATION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📐 The ray-triangle test, decided by `02` §4's exact orientation predicate rather than by a signed volume in
//    floating point. The three corner positions are projected onto the plane most perpendicular to the ray, the
//    ray's own position on that plane is classified against each edge, and the three signs must agree.
//
// 🔴 `40` §6 requires this to be Exact: a missed face is geometry the artist cannot click, and an approximate
//    test misses along exactly the shared edges dense topology is made of — so the hole is a seam, not a speck.
bool ClassifyRayTriangle(DocumentPosition Alpha, DocumentPosition Beta, DocumentPosition Gamma,
                         DocumentPosition Origin,
                         double DirectionX, double DirectionY, double DirectionZ,
                         double& Distance, double Weights[3])
{
    const double EdgeAX = Beta.PositionX  - Alpha.PositionX;
    const double EdgeAY = Beta.PositionY  - Alpha.PositionY;
    const double EdgeAZ = Beta.PositionZ  - Alpha.PositionZ;
    const double EdgeBX = Gamma.PositionX - Alpha.PositionX;
    const double EdgeBY = Gamma.PositionY - Alpha.PositionY;
    const double EdgeBZ = Gamma.PositionZ - Alpha.PositionZ;

    const double PerpX = EdgeAY * EdgeBZ - EdgeAZ * EdgeBY;
    const double PerpY = EdgeAZ * EdgeBX - EdgeAX * EdgeBZ;
    const double PerpZ = EdgeAX * EdgeBY - EdgeAY * EdgeBX;

    const double Alignment = PerpX * DirectionX + PerpY * DirectionY + PerpZ * DirectionZ;

    if (Alignment == 0.0)
        return false;

    const double OffsetX = Alpha.PositionX - Origin.PositionX;
    const double OffsetY = Alpha.PositionY - Origin.PositionY;
    const double OffsetZ = Alpha.PositionZ - Origin.PositionZ;

    const double Parameter = (PerpX * OffsetX + PerpY * OffsetY + PerpZ * OffsetZ) / Alignment;

    if (Parameter < 0.0)
        return false;

    // 📝 The projection axis is the one the face's perpendicular is most aligned with, so the projected triangle
    //    never degenerates to a segment. Projecting onto a fixed plane collapses every face parallel to it.
    const double MagnitudeX = std::fabs(PerpX);
    const double MagnitudeY = std::fabs(PerpY);
    const double MagnitudeZ = std::fabs(PerpZ);

    std::uint32_t Dominant = 2u;

    if (MagnitudeX >= MagnitudeY && MagnitudeX >= MagnitudeZ)
        Dominant = 0u;
    else if (MagnitudeY >= MagnitudeZ)
        Dominant = 1u;

    const double MeetX = Origin.PositionX + DirectionX * Parameter;
    const double MeetY = Origin.PositionY + DirectionY * Parameter;
    const double MeetZ = Origin.PositionZ + DirectionZ * Parameter;

    double AlphaU = 0.0, AlphaV = 0.0, BetaU = 0.0, BetaV = 0.0, GammaU = 0.0, GammaV = 0.0, MeetU = 0.0, MeetV = 0.0;

    if (Dominant == 0u)
    {
        AlphaU = Alpha.PositionY;  AlphaV = Alpha.PositionZ;
        BetaU  = Beta.PositionY;   BetaV  = Beta.PositionZ;
        GammaU = Gamma.PositionY;  GammaV = Gamma.PositionZ;
        MeetU  = MeetY;            MeetV  = MeetZ;
    }
    else if (Dominant == 1u)
    {
        AlphaU = Alpha.PositionZ;  AlphaV = Alpha.PositionX;
        BetaU  = Beta.PositionZ;   BetaV  = Beta.PositionX;
        GammaU = Gamma.PositionZ;  GammaV = Gamma.PositionX;
        MeetU  = MeetZ;            MeetV  = MeetX;
    }
    else
    {
        AlphaU = Alpha.PositionX;  AlphaV = Alpha.PositionY;
        BetaU  = Beta.PositionX;   BetaV  = Beta.PositionY;
        GammaU = Gamma.PositionX;  GammaV = Gamma.PositionY;
        MeetU  = MeetX;            MeetV  = MeetY;
    }

    const Signed32 AlphaSide = ClassifyOrientation(BetaU,  BetaV,  GammaU, GammaV, MeetU, MeetV);
    const Signed32 BetaSide  = ClassifyOrientation(GammaU, GammaV, AlphaU, AlphaV, MeetU, MeetV);
    const Signed32 GammaSide = ClassifyOrientation(AlphaU, AlphaV, BetaU,  BetaV,  MeetU, MeetV);

    // 📝 A zero is on the edge and is admitted, so a ray meeting a shared edge hits one of the two faces rather
    //    than neither. The signs must otherwise agree; a mixed pair is outside.
    const bool NonNegative = AlphaSide >= 0 && BetaSide >= 0 && GammaSide >= 0;
    const bool NonPositive = AlphaSide <= 0 && BetaSide <= 0 && GammaSide <= 0;

    if (!NonNegative && !NonPositive)
        return false;

    const double DoubledArea = static_cast<double>(AlphaSide) + static_cast<double>(BetaSide)
                             + static_cast<double>(GammaSide);
    static_cast<void>(DoubledArea);

    // 📐 The weights are resolved from the projected areas rather than from the signs, because the signs carry
    //    the classification and not the proportion. This half is Bounded and only the classification above is
    //    Exact, which is exactly the split `40` §6 declares.
    const double AreaWhole = (BetaU - AlphaU) * (GammaV - AlphaV) - (GammaU - AlphaU) * (BetaV - AlphaV);

    if (AreaWhole == 0.0)
        return false;

    const double AreaAlpha = (BetaU  - MeetU) * (GammaV - MeetV) - (GammaU - MeetU) * (BetaV  - MeetV);
    const double AreaBeta  = (GammaU - MeetU) * (AlphaV - MeetV) - (AlphaU - MeetU) * (GammaV - MeetV);

    Weights[0] = AreaAlpha / AreaWhole;
    Weights[1] = AreaBeta  / AreaWhole;
    Weights[2] = 1.0 - Weights[0] - Weights[1];

    Distance = Parameter;

    return true;
}

}   // namespace

void BoundingStructure::Descend(std::uint32_t     RecordOrdinal,
                                DocumentPosition  Origin,
                                double            ReciprocalX,
                                double            ReciprocalY,
                                double            ReciprocalZ,
                                double            DirectionX,
                                double            DirectionY,
                                double            DirectionZ,
                                FaceIntersection& Nearest) const
{
    const BoundingRecord& Held = Records[RecordOrdinal];

    double Entering = 0.0;
    double Leaving  = 0.0;

    if (!SlabInterval(Held.Extent, Origin, ReciprocalX, ReciprocalY, ReciprocalZ, Entering, Leaving))
        return;

    // 🔴 The whole point of the nearest-first ordering: a record whose nearest entry is beyond a confirmed hit
    //    cannot contain a nearer face, so the subtree is abandoned rather than descended.
    if (Nearest.Resolved && Entering > Nearest.Distance)
        return;

    if (Held.FirstDivided == AbsentRecord)
    {
        for (std::uint32_t Passed = 0u; Passed < Held.FaceCount; ++Passed)
        {
            const std::uint32_t FaceOrdinal = FaceOrder[Held.FirstFace + Passed];
            const std::uint32_t FirstCorner = FaceFirstCorners[FaceOrdinal];
            const std::uint32_t CornerSpan  = FaceCornerCounts[FaceOrdinal];

            // 📝 Fan-triangulated from the first corner, matching `38` §4's convention. Two triangulations of one
            //    n-gon classify its interior differently along the diagonal, and picking would then disagree with
            //    the tangent basis about which side of a quad a position is on.
            for (std::uint32_t Fan = 1u; Fan + 1u < CornerSpan; ++Fan)
            {
                const std::uint32_t AlphaCorner = FirstCorner;
                const std::uint32_t BetaCorner  = FirstCorner + Fan;
                const std::uint32_t GammaCorner = FirstCorner + Fan + 1u;

                double Distance   = 0.0;
                double Weights[3] = { 0.0, 0.0, 0.0 };

                if (!ClassifyRayTriangle(Positions[CornerVertices[AlphaCorner]],
                                         Positions[CornerVertices[BetaCorner]],
                                         Positions[CornerVertices[GammaCorner]],
                                         Origin, DirectionX, DirectionY, DirectionZ,
                                         Distance, Weights))
                {
                    continue;
                }

                if (Nearest.Resolved && Distance >= Nearest.Distance)
                    continue;

                Nearest.FaceOrdinal       = FaceOrdinal;
                Nearest.CornerOrdinals[0] = AlphaCorner;
                Nearest.CornerOrdinals[1] = BetaCorner;
                Nearest.CornerOrdinals[2] = GammaCorner;
                Nearest.Weights[0]        = Weights[0];
                Nearest.Weights[1]        = Weights[1];
                Nearest.Weights[2]        = Weights[2];
                Nearest.Distance          = Distance;
                Nearest.Resolved          = true;
            }
        }

        return;
    }

    // 📝 The eight children are visited in order of their own entry parameter, which is what makes the abandon
    //    above fire early rather than after every child has been tested.
    std::uint32_t Order[8]     = { 0u, 1u, 2u, 3u, 4u, 5u, 6u, 7u };
    double        Entries[8]   = {};
    bool          Reachable[8] = {};

    for (std::uint32_t Octant = 0u; Octant < 8u; ++Octant)
    {
        const BoundingRecord& Child = Records[Held.FirstDivided + Octant];

        double ChildEntering = 0.0;
        double ChildLeaving  = 0.0;

        Reachable[Octant] = Child.FaceCount != 0u
                         && SlabInterval(Child.Extent, Origin, ReciprocalX, ReciprocalY, ReciprocalZ,
                                         ChildEntering, ChildLeaving);

        Entries[Octant] = Reachable[Octant] ? ChildEntering : HUGE_VAL;
    }

    for (std::uint32_t Passed = 1u; Passed < 8u; ++Passed)
    {
        const std::uint32_t Held_    = Order[Passed];
        const double        HeldEntry = Entries[Held_];
        std::uint32_t       Placed   = Passed;

        while (Placed != 0u && Entries[Order[Placed - 1u]] > HeldEntry)
        {
            Order[Placed] = Order[Placed - 1u];
            --Placed;
        }

        Order[Placed] = Held_;
    }

    for (std::uint32_t Passed = 0u; Passed < 8u; ++Passed)
    {
        const std::uint32_t Octant = Order[Passed];

        if (!Reachable[Octant])
            continue;

        if (Nearest.Resolved && Entries[Octant] > Nearest.Distance)
            break;

        Descend(Held.FirstDivided + Octant, Origin,
                ReciprocalX, ReciprocalY, ReciprocalZ,
                DirectionX, DirectionY, DirectionZ, Nearest);
    }
}

FaceIntersection BoundingStructure::IntersectRay(DocumentPosition Origin,
                                                 double           DirectionX,
                                                 double           DirectionY,
                                                 double           DirectionZ,
                                                 double           FurthestDistance) const
{
    FaceIntersection Nearest;

    if (!StructureBuilt || Records.empty() || FaceOrder.empty())
        return Nearest;

    // 📝 A zero component produces an infinite reciprocal, and the slab comparison then resolves to the correct
    //    side rather than to a division at each record. Taking the reciprocals once is the whole reason the
    //    descent takes them as parameters.
    const double ReciprocalX = DirectionX != 0.0 ? 1.0 / DirectionX : HUGE_VAL;
    const double ReciprocalY = DirectionY != 0.0 ? 1.0 / DirectionY : HUGE_VAL;
    const double ReciprocalZ = DirectionZ != 0.0 ? 1.0 / DirectionZ : HUGE_VAL;

    Descend(0u, Origin, ReciprocalX, ReciprocalY, ReciprocalZ, DirectionX, DirectionY, DirectionZ, Nearest);

    if (Nearest.Resolved && Nearest.Distance > FurthestDistance)
        return FaceIntersection{};

    return Nearest;
}

ConditionedExtent BoundingStructure::Extent() const
{
    return Records.empty() ? ConditionedExtent{} : Records[0].Extent;
}

std::uint32_t BoundingStructure::RecordCount() const { return static_cast<std::uint32_t>(Records.size());   }
std::uint32_t BoundingStructure::FaceCount() const   { return static_cast<std::uint32_t>(FaceOrder.size()); }
bool          BoundingStructure::Constructed() const { return StructureBuilt; }

//------------------------------------------------------------------------------------------------------------------------
//                                                THE OUTER SUBDIVISION
//------------------------------------------------------------------------------------------------------------------------

std::size_t OctantSpace::Located(OccupantIdentity Subject) const
{
    for (std::size_t Ordinal = 0u; Ordinal < Admitted.size(); ++Ordinal)
    {
        if (Admitted[Ordinal].Occupant == Subject)
            return Ordinal;
    }

    return Admitted.size();
}

Deliver<bool> OctantSpace::Admit(const AdmittedOccupant& Arriving)
{
    if (!Arriving.Occupant.IdentityDeclared())
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "an undeclared identity occupies nothing" });

    const std::size_t Located_ = Located(Arriving.Occupant);

    if (Located_ == Admitted.size())
        Admitted.push_back(Arriving);
    else
        Admitted[Located_] = Arriving;

    BuildOwed = true;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> OctantSpace::Withdraw(OccupantIdentity Subject)
{
    const std::size_t Located_ = Located(Subject);

    if (Located_ == Admitted.size())
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the occupant is not admitted here" });

    Admitted.erase(Admitted.begin() + static_cast<std::ptrdiff_t>(Located_));
    BuildOwed = true;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> OctantSpace::Refit(OccupantIdentity           Subject,
                                 const DecomposedTransform& Composed,
                                 ConditionedExtent          Extent)
{
    const std::size_t Located_ = Located(Subject);

    if (Located_ == Admitted.size())
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the occupant is not admitted here" });

    Admitted[Located_].Composed = Composed;
    Admitted[Located_].Extent   = Extent;

    if (BuildOwed || Records.empty())
        return Deliver<bool>::Deliver(true);

    // 🔴 Refit, not rebuild — `40` §4. Every record on the path to the occupant widens to hold the new extent and
    //    the subdivision's shape is untouched. The widening is accumulated so `RebuildWorthwhile` can measure how
    //    far the shape has drifted from the extents it was built for.
    const double Before = ExtentVolume(Records[0].Extent);

    for (std::size_t RecordOrdinal = 0u; RecordOrdinal < Records.size(); ++RecordOrdinal)
    {
        bool Holds = false;

        for (std::uint32_t Passed = 0u; Passed < Records[RecordOrdinal].EntryCount; ++Passed)
        {
            if (EntryOrder[Records[RecordOrdinal].FirstEntry + Passed] == static_cast<std::uint32_t>(Located_))
            {
                Holds = true;
                break;
            }
        }

        if (Holds)
            Widen(Records[RecordOrdinal].Extent, Extent);
    }

    Widen(Records[0].Extent, Extent);

    const double After = ExtentVolume(Records[0].Extent);

    if (After > Before)
        WidenedVolume += After - Before;

    return Deliver<bool>::Deliver(true);
}

Deliver<AdmittedOccupant> OctantSpace::Standing(OccupantIdentity Subject) const
{
    const std::size_t Located_ = Located(Subject);

    if (Located_ == Admitted.size())
        return Deliver<AdmittedOccupant>::Refuse({ RefusalReason::IdentityStale, "the occupant is not admitted here" });

    return Deliver<AdmittedOccupant>::Deliver(Admitted[Located_]);
}

Deliver<bool> OctantSpace::Construct()
{
    Records.clear();
    EntryOrder.clear();
    EntryOrder.reserve(Admitted.size());

    for (std::uint32_t Ordinal = 0u; Ordinal < Admitted.size(); ++Ordinal)
        EntryOrder.push_back(Ordinal);

    OctantRecord Root;
    Root.FirstEntry = 0u;
    Root.EntryCount = static_cast<std::uint32_t>(EntryOrder.size());
    Root.Extent     = EmptyExtent();

    for (const AdmittedOccupant& Held : Admitted)
        Widen(Root.Extent, Held.Extent);

    Records.push_back(Root);

    if (!EntryOrder.empty())
        Divide(0u, 0u);

    BuiltVolume   = ExtentVolume(Records[0].Extent);
    WidenedVolume = 0.0;
    BuildOwed     = false;

    return Deliver<bool>::Deliver(true);
}

void OctantSpace::Divide(std::uint32_t RecordOrdinal, std::uint32_t Depth)
{
    if (Depth >= SubdivisionDepthCeiling || Records[RecordOrdinal].EntryCount <= SubdivisionLeafCeiling)
        return;

    const ConditionedExtent Held       = Records[RecordOrdinal].Extent;
    const std::uint32_t     FirstEntry = Records[RecordOrdinal].FirstEntry;
    const std::uint32_t     EntrySpan  = Records[RecordOrdinal].EntryCount;

    const double MiddleX = (Held.Least.PositionX + Held.Greatest.PositionX) * 0.5;
    const double MiddleY = (Held.Least.PositionY + Held.Greatest.PositionY) * 0.5;
    const double MiddleZ = (Held.Least.PositionZ + Held.Greatest.PositionZ) * 0.5;

    std::uint32_t              OctantCounts[8] = {};
    std::vector<std::uint32_t> Assignment(EntrySpan, 0u);

    for (std::uint32_t Passed = 0u; Passed < EntrySpan; ++Passed)
    {
        const ConditionedExtent& Extent = Admitted[EntryOrder[FirstEntry + Passed]].Extent;

        const double CentreX = (Extent.Least.PositionX + Extent.Greatest.PositionX) * 0.5;
        const double CentreY = (Extent.Least.PositionY + Extent.Greatest.PositionY) * 0.5;
        const double CentreZ = (Extent.Least.PositionZ + Extent.Greatest.PositionZ) * 0.5;

        const std::uint32_t Octant = (CentreX >= MiddleX ? 1u : 0u)
                                   | (CentreY >= MiddleY ? 2u : 0u)
                                   | (CentreZ >= MiddleZ ? 4u : 0u);

        Assignment[Passed] = Octant;
        ++OctantCounts[Octant];
    }

    std::uint32_t Occupied = 0u;

    for (std::uint32_t Octant = 0u; Octant < 8u; ++Octant)
    {
        if (OctantCounts[Octant] != 0u)
            ++Occupied;
    }

    if (Occupied <= 1u)
        return;

    std::uint32_t OctantFirst[8] = {};
    std::uint32_t Accumulated    = 0u;

    for (std::uint32_t Octant = 0u; Octant < 8u; ++Octant)
    {
        OctantFirst[Octant] = Accumulated;
        Accumulated        += OctantCounts[Octant];
    }

    std::vector<std::uint32_t> Reordered(EntrySpan, 0u);
    std::uint32_t              OctantWrite[8] = {};

    for (std::uint32_t Passed = 0u; Passed < EntrySpan; ++Passed)
    {
        const std::uint32_t Octant = Assignment[Passed];

        Reordered[OctantFirst[Octant] + OctantWrite[Octant]] = EntryOrder[FirstEntry + Passed];
        ++OctantWrite[Octant];
    }

    for (std::uint32_t Passed = 0u; Passed < EntrySpan; ++Passed)
        EntryOrder[FirstEntry + Passed] = Reordered[Passed];

    const std::uint32_t FirstDivided = static_cast<std::uint32_t>(Records.size());

    for (std::uint32_t Octant = 0u; Octant < 8u; ++Octant)
    {
        OctantRecord Dividing;
        Dividing.FirstEntry = FirstEntry + OctantFirst[Octant];
        Dividing.EntryCount = OctantCounts[Octant];
        Dividing.Extent     = EmptyExtent();

        for (std::uint32_t Passed = 0u; Passed < Dividing.EntryCount; ++Passed)
            Widen(Dividing.Extent, Admitted[EntryOrder[Dividing.FirstEntry + Passed]].Extent);

        Records.push_back(Dividing);
    }

    Records[RecordOrdinal].FirstDivided = FirstDivided;

    for (std::uint32_t Octant = 0u; Octant < 8u; ++Octant)
    {
        if (Records[FirstDivided + Octant].EntryCount != 0u)
            Divide(FirstDivided + Octant, Depth + 1u);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   OUTER TRAVERSAL
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 🔴 `40` §3: enrolment exclusion is tested before descent, so an excluded population costs nothing rather than
//    costing a rejected intersection each. Locked occupants and visibility-excluded ones are both untouchable.
bool Traversable(const EnrollmentIndex& Subsets, OccupantIdentity Subject)
{
    return !Subsets.Enrolled(Subject, SubsetSubject::Lock)
        && !Subsets.Enrolled(Subject, SubsetSubject::VisibilityExclusion);
}

}   // namespace

void OctantSpace::Descend(std::uint32_t          RecordOrdinal,
                          DocumentPosition       Origin,
                          double                 DirectionX,
                          double                 DirectionY,
                          double                 DirectionZ,
                          const EnrollmentIndex& Subsets,
                          ResolvedIntersection&  Nearest) const
{
    const OctantRecord& Held = Records[RecordOrdinal];

    const double ReciprocalX = DirectionX != 0.0 ? 1.0 / DirectionX : HUGE_VAL;
    const double ReciprocalY = DirectionY != 0.0 ? 1.0 / DirectionY : HUGE_VAL;
    const double ReciprocalZ = DirectionZ != 0.0 ? 1.0 / DirectionZ : HUGE_VAL;

    double Entering = 0.0;
    double Leaving  = 0.0;

    if (!SlabInterval(Held.Extent, Origin, ReciprocalX, ReciprocalY, ReciprocalZ, Entering, Leaving))
        return;

    if (Nearest.Resolved && Entering > Nearest.Distance)
        return;

    if (Held.FirstDivided == AbsentRecord)
    {
        for (std::uint32_t Passed = 0u; Passed < Held.EntryCount; ++Passed)
        {
            const AdmittedOccupant& Occupying = Admitted[EntryOrder[Held.FirstEntry + Passed]];

            if (Occupying.Inner == nullptr || !Traversable(Subsets, Occupying.Occupant))
                continue;

            double OccupantEntering = 0.0;
            double OccupantLeaving  = 0.0;

            if (!SlabInterval(Occupying.Extent, Origin, ReciprocalX, ReciprocalY, ReciprocalZ,
                              OccupantEntering, OccupantLeaving))
            {
                continue;
            }

            if (Nearest.Resolved && OccupantEntering > Nearest.Distance)
                continue;

            // 🔴 The ray is transformed into object space **once**, at entry, and traversed there — `40` §2. The
            //    inner structure is object-space and invariant under occupant motion, which is the whole reason
            //    the two levels exist rather than one.
            const RotationQuaternion Inverse = Conjugated(Occupying.Composed.Rotation);

            const double SpanX = Origin.PositionX - Occupying.Composed.Translation.PositionX;
            const double SpanY = Origin.PositionY - Occupying.Composed.Translation.PositionY;
            const double SpanZ = Origin.PositionZ - Occupying.Composed.Translation.PositionZ;

            double RotatedOriginX = 0.0, RotatedOriginY = 0.0, RotatedOriginZ = 0.0;
            RotateSpan(Inverse, SpanX, SpanY, SpanZ, RotatedOriginX, RotatedOriginY, RotatedOriginZ);

            double RotatedDirectionX = 0.0, RotatedDirectionY = 0.0, RotatedDirectionZ = 0.0;
            RotateSpan(Inverse, DirectionX, DirectionY, DirectionZ,
                       RotatedDirectionX, RotatedDirectionY, RotatedDirectionZ);

            const double ScaleX = Occupying.Composed.ScaleX != 0.0 ? Occupying.Composed.ScaleX : 1.0;
            const double ScaleY = Occupying.Composed.ScaleY != 0.0 ? Occupying.Composed.ScaleY : 1.0;
            const double ScaleZ = Occupying.Composed.ScaleZ != 0.0 ? Occupying.Composed.ScaleZ : 1.0;

            DocumentPosition ObjectOrigin;
            ObjectOrigin.PositionX = RotatedOriginX / ScaleX;
            ObjectOrigin.PositionY = RotatedOriginY / ScaleY;
            ObjectOrigin.PositionZ = RotatedOriginZ / ScaleZ;

            // 📝 The direction is scaled and deliberately **not** renormalised, so the parameter the inner
            //    structure returns is still a document-space distance. Renormalising here would make a
            //    non-uniformly scaled occupant report distances in its own units, and the nearest-first ordering
            //    across occupants would compare two different measures.
            const double ObjectDirectionX = RotatedDirectionX / ScaleX;
            const double ObjectDirectionY = RotatedDirectionY / ScaleY;
            const double ObjectDirectionZ = RotatedDirectionZ / ScaleZ;

            const double Furthest = Nearest.Resolved ? Nearest.Distance : HUGE_VAL;

            const FaceIntersection Met = Occupying.Inner->IntersectRay(ObjectOrigin,
                                                                       ObjectDirectionX,
                                                                       ObjectDirectionY,
                                                                       ObjectDirectionZ,
                                                                       Furthest);

            if (!Met.Resolved)
                continue;

            if (Nearest.Resolved && Met.Distance >= Nearest.Distance)
                continue;

            Nearest.Occupant          = Occupying.Occupant;
            Nearest.FaceOrdinal       = Met.FaceOrdinal;
            Nearest.CornerOrdinals[0] = Met.CornerOrdinals[0];
            Nearest.CornerOrdinals[1] = Met.CornerOrdinals[1];
            Nearest.CornerOrdinals[2] = Met.CornerOrdinals[2];
            Nearest.Weights[0]        = Met.Weights[0];
            Nearest.Weights[1]        = Met.Weights[1];
            Nearest.Weights[2]        = Met.Weights[2];
            Nearest.Distance          = Met.Distance;
            Nearest.Resolved          = true;

            Nearest.Position.PositionX = Origin.PositionX + DirectionX * Met.Distance;
            Nearest.Position.PositionY = Origin.PositionY + DirectionY * Met.Distance;
            Nearest.Position.PositionZ = Origin.PositionZ + DirectionZ * Met.Distance;
        }

        return;
    }

    std::uint32_t Order[8]     = { 0u, 1u, 2u, 3u, 4u, 5u, 6u, 7u };
    double        Entries[8]   = {};
    bool          Reachable[8] = {};

    for (std::uint32_t Octant = 0u; Octant < 8u; ++Octant)
    {
        const OctantRecord& Child = Records[Held.FirstDivided + Octant];

        double ChildEntering = 0.0;
        double ChildLeaving  = 0.0;

        Reachable[Octant] = Child.EntryCount != 0u
                         && SlabInterval(Child.Extent, Origin, ReciprocalX, ReciprocalY, ReciprocalZ,
                                         ChildEntering, ChildLeaving);

        Entries[Octant] = Reachable[Octant] ? ChildEntering : HUGE_VAL;
    }

    for (std::uint32_t Passed = 1u; Passed < 8u; ++Passed)
    {
        const std::uint32_t Held_     = Order[Passed];
        const double        HeldEntry = Entries[Held_];
        std::uint32_t       Placed    = Passed;

        while (Placed != 0u && Entries[Order[Placed - 1u]] > HeldEntry)
        {
            Order[Placed] = Order[Placed - 1u];
            --Placed;
        }

        Order[Placed] = Held_;
    }

    for (std::uint32_t Passed = 0u; Passed < 8u; ++Passed)
    {
        const std::uint32_t Octant = Order[Passed];

        if (!Reachable[Octant])
            continue;

        if (Nearest.Resolved && Entries[Octant] > Nearest.Distance)
            break;

        Descend(Held.FirstDivided + Octant, Origin, DirectionX, DirectionY, DirectionZ, Subsets, Nearest);
    }
}

ResolvedIntersection OctantSpace::IntersectRay(DocumentPosition       Origin,
                                               double                 DirectionX,
                                               double                 DirectionY,
                                               double                 DirectionZ,
                                               const EnrollmentIndex& Subsets) const
{
    ResolvedIntersection Nearest;

    if (Records.empty() || EntryOrder.empty())
        return Nearest;

    Descend(0u, Origin, DirectionX, DirectionY, DirectionZ, Subsets, Nearest);

    return Nearest;
}

std::vector<OccupantIdentity> OctantSpace::IntersectExtent(ConditionedExtent      Extent,
                                                           bool                   Containment,
                                                           const EnrollmentIndex& Subsets) const
{
    std::vector<OccupantIdentity> Enrolled;

    if (Records.empty())
        return Enrolled;

    // 🔴 One traversal over the extent, never one per position inside it — `74` §4. A marquee over a thousand
    //    occupants is one descent, and the result is one enrolment transaction rather than a thousand.
    std::vector<std::uint32_t> Pending;
    Pending.push_back(0u);

    while (!Pending.empty())
    {
        const std::uint32_t RecordOrdinal = Pending.back();
        Pending.pop_back();

        const OctantRecord& Held = Records[RecordOrdinal];

        if (!ExtentsOverlap(Held.Extent, Extent))
            continue;

        if (Held.FirstDivided == AbsentRecord)
        {
            for (std::uint32_t Passed = 0u; Passed < Held.EntryCount; ++Passed)
            {
                const AdmittedOccupant& Occupying = Admitted[EntryOrder[Held.FirstEntry + Passed]];

                if (!Traversable(Subsets, Occupying.Occupant))
                    continue;

                const bool Enrolls = Containment ? ExtentContains(Extent, Occupying.Extent)
                                                 : ExtentsOverlap(Extent, Occupying.Extent);

                if (Enrolls)
                    Enrolled.push_back(Occupying.Occupant);
            }

            continue;
        }

        for (std::uint32_t Octant = 0u; Octant < 8u; ++Octant)
        {
            if (Records[Held.FirstDivided + Octant].EntryCount != 0u)
                Pending.push_back(Held.FirstDivided + Octant);
        }
    }

    return Enrolled;
}

bool OctantSpace::RebuildWorthwhile() const
{
    if (BuildOwed)
        return true;

    if (BuiltVolume <= 0.0)
        return false;

    // 📝 Measured as accumulated widening against the volume at the last build. A count-driven trigger would
    //    rebuild for a thousand occupants that each moved a millimetre, and never for one that crossed the scene.
    return WidenedVolume > BuiltVolume;
}

std::uint32_t OctantSpace::AdmittedCount() const  { return static_cast<std::uint32_t>(Admitted.size()); }
std::uint32_t OctantSpace::RecordCount() const    { return static_cast<std::uint32_t>(Records.size());  }
bool          OctantSpace::ConstructionOwed() const { return BuildOwed; }

//------------------------------------------------------------------------------------------------------------------------
//                                                THE DOMAIN SUBDIVISION
//------------------------------------------------------------------------------------------------------------------------

void AxisSpace::Construct(const std::vector<DomainExtent>& Declaring)
{
    Extents = Declaring;
}

Deliver<bool> AxisSpace::Refit(std::uint32_t PlacementOrdinal, DomainExtent Amending)
{
    for (DomainExtent& Held : Extents)
    {
        if (Held.PlacementOrdinal != PlacementOrdinal)
            continue;

        Held = Amending;
        Held.PlacementOrdinal = PlacementOrdinal;

        return Deliver<bool>::Deliver(true);
    }

    return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "no placement carries that ordinal" });
}

Deliver<std::uint32_t> AxisSpace::Resolve(double PositionAlong, double PositionAcross) const
{
    bool          Found    = false;
    std::uint32_t Resolved = 0u;
    std::uint32_t Topmost  = 0u;

    for (const DomainExtent& Held : Extents)
    {
        if (PositionAlong  < Held.LeastAlong  || PositionAlong  > Held.GreatestAlong
         || PositionAcross < Held.LeastAcross || PositionAcross > Held.GreatestAcross)
        {
            continue;
        }

        // 🔴 The topmost containing placement wins, by `56` sequence order. Resolving the first found would make
        //    picking depend on declaration order, and the artist would select whichever decal happened to be
        //    declared first rather than the one they can see.
        if (!Found || Held.SequenceOrdinal >= Topmost)
        {
            Found    = true;
            Topmost  = Held.SequenceOrdinal;
            Resolved = Held.PlacementOrdinal;
        }
    }

    if (!Found)
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ExtentExhausted, "no placement contains the position" });

    return Deliver<std::uint32_t>::Deliver(Resolved);
}

std::vector<std::uint32_t> AxisSpace::Overlapping(DomainExtent Extent) const
{
    std::vector<std::uint32_t> Overlapped;

    for (const DomainExtent& Held : Extents)
    {
        if (ClassifyExtentOverlap(Held.LeastAlong,    Held.LeastAcross,
                                  Held.GreatestAlong, Held.GreatestAcross,
                                  Extent.LeastAlong,    Extent.LeastAcross,
                                  Extent.GreatestAlong, Extent.GreatestAcross) >= 0)
        {
            Overlapped.push_back(Held.PlacementOrdinal);
        }
    }

    return Overlapped;
}

std::uint32_t AxisSpace::DeclaredCount() const
{
    return static_cast<std::uint32_t>(Extents.size());
}

}   // namespace Slate
