//============================================================================================================================================
//                                                          PARTITIONSTRUCTURE.CPP
//============================================================================================================================================
// 🧩 The growth front that walks `38`'s adjacency, the cone it accumulates, and the identities `42` issues against the result.

#include "SlateCompute/Compute/VisibilityIndex/Api/PartitionStructure.h"

#include <cmath>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   FACE ORIENTATION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📝 The material one face carries. A topology whose source declared no enrollment carries one material for the
//    whole surface, and reading past the end of an undeclared run is how that surface acquires a partition split
//    at every face instead.
std::uint32_t MaterialOfFace(const TopologyStructure& Imported, std::uint32_t FaceOrdinal)
{
    const std::vector<std::uint32_t>& Enrollment = Imported.MaterialEnrollment();

    return FaceOrdinal < static_cast<std::uint32_t>(Enrollment.size()) ? Enrollment[FaceOrdinal] : 0u;
}

// 📝 The fan triangles one face amounts to. `50` §2 ① admits n-gons, so this is the corner count less two and
//    never the constant one — a partition budgeted as though every face were a triangle overruns by the amount
//    the artist's quads and n-gons exceed it, which on a subdivided surface is the whole budget again.
std::uint32_t TrianglesOfFace(const TopologyStructure& Imported, std::uint32_t FaceOrdinal)
{
    const std::uint32_t Corners = Imported.FaceCornerCount(FaceOrdinal);

    return Corners > 2u ? Corners - 2u : 0u;
}

/// 🧩 One face's own orientation, by Newell's summation over its corner run.
/// note  📐 Newell rather than a cross product of the first three corners, because an n-gon's first three corners
///        may be collinear or may sit on a locally concave part of an otherwise well-behaved face. Newell reads
///        every corner and produces the area-weighted orientation of the whole polygon, which is what the cone is
///        supposed to enclose.
/// note  📝 Accumulated at 64 bits and narrowed only at the end. The positions are `mm` in document space and
///        `02` §3.2 keeps them at 64 bits precisely because differencing them at 32 bits is where a distant
///        occupant's geometry turns to noise.
SurfaceDirection OrientationOfFace(const TopologyStructure& Imported, std::uint32_t FaceOrdinal, bool& OrientationDerived)
{
    const std::vector<DocumentPosition>& Positions   = Imported.Positions();
    const std::uint32_t                  FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);
    const std::uint32_t                  CornerRun   = Imported.FaceCornerCount(FaceOrdinal);

    double SummedX = 0.0;
    double SummedY = 0.0;
    double SummedZ = 0.0;

    for (std::uint32_t Step = 0u; Step < CornerRun; ++Step)
    {
        const std::uint32_t ThisCorner = FirstCorner + Step;
        const std::uint32_t NextCorner = FirstCorner + (Step + 1u) % CornerRun;

        const DocumentPosition& Here  = Positions[Imported.CornerVertex(ThisCorner)];
        const DocumentPosition& There = Positions[Imported.CornerVertex(NextCorner)];

        SummedX += (Here.PositionY - There.PositionY) * (Here.PositionZ + There.PositionZ);
        SummedY += (Here.PositionZ - There.PositionZ) * (Here.PositionX + There.PositionX);
        SummedZ += (Here.PositionX - There.PositionX) * (Here.PositionY + There.PositionY);
    }

    const double Magnitude = std::sqrt(SummedX * SummedX + SummedY * SummedY + SummedZ * SummedZ);

    SurfaceDirection Oriented;

    // ⚠️ A face of no area has no orientation, and normalising one produces three quiet infinities that
    //    propagate into the cone axis and reject the whole partition from every direction at once. The
    //    conditioning enrols such a face as `ZeroExtentFace` and the growth steps over it; this guard is what
    //    covers a face that is enrolled under nothing and still sums to nothing.
    OrientationDerived = Magnitude > 0.0;

    if (!OrientationDerived)
        return Oriented;

    Oriented.DirectionX = static_cast<float>(SummedX / Magnitude);
    Oriented.DirectionY = static_cast<float>(SummedY / Magnitude);
    Oriented.DirectionZ = static_cast<float>(SummedZ / Magnitude);

    return Oriented;
}

// 📝 The extent one face contributes, folded into a running one. Both corners move outward and neither is
//    rounded in, per `38` §6 — the conditioning already rounded each face outward and taking the extremes of
//    outward extents keeps the result outward.
void AdmitExtent(ConditionedExtent& Running, const ConditionedExtent& Arriving, bool FirstAdmission)
{
    if (FirstAdmission)
    {
        Running = Arriving;
        return;
    }

    Running.Least.PositionX    = Arriving.Least.PositionX    < Running.Least.PositionX    ? Arriving.Least.PositionX    : Running.Least.PositionX;
    Running.Least.PositionY    = Arriving.Least.PositionY    < Running.Least.PositionY    ? Arriving.Least.PositionY    : Running.Least.PositionY;
    Running.Least.PositionZ    = Arriving.Least.PositionZ    < Running.Least.PositionZ    ? Arriving.Least.PositionZ    : Running.Least.PositionZ;
    Running.Greatest.PositionX = Arriving.Greatest.PositionX > Running.Greatest.PositionX ? Arriving.Greatest.PositionX : Running.Greatest.PositionX;
    Running.Greatest.PositionY = Arriving.Greatest.PositionY > Running.Greatest.PositionY ? Arriving.Greatest.PositionY : Running.Greatest.PositionY;
    Running.Greatest.PositionZ = Arriving.Greatest.PositionZ > Running.Greatest.PositionZ ? Arriving.Greatest.PositionZ : Running.Greatest.PositionZ;
}

/// 🧩 Closes the cone over the orientations one partition accumulated.
/// note  📐 The axis is the normalised sum of the face orientations and the aperture is the least dot product any
///        one of them takes against it. The sum is unweighted, so a partition of a thousand tiny faces and one
///        large one is centred where the faces are rather than where the area is — which is the direction the
///        aperture then has to enclose, so the two agree.
/// note  🔴 An aperture at or below zero spans a hemisphere or more, and no direction exists from which every
///        face is back-facing. The cone is withheld rather than reported wide, because `16` §2 ① reads only the
///        two numbers and cannot tell a wide cone from a meaningless one.
OrientationCone CloseCone(double SummedX, double SummedY, double SummedZ, double Aperture, bool EveryFaceOriented)
{
    OrientationCone Closed;

    const double Magnitude = std::sqrt(SummedX * SummedX + SummedY * SummedY + SummedZ * SummedZ);

    if (!EveryFaceOriented || Magnitude <= 0.0 || Aperture <= 0.0)
        return Closed;

    Closed.Axis.DirectionX = static_cast<float>(SummedX / Magnitude);
    Closed.Axis.DirectionY = static_cast<float>(SummedY / Magnitude);
    Closed.Axis.DirectionZ = static_cast<float>(SummedZ / Magnitude);
    Closed.ApertureCosine  = static_cast<float>(Aperture);
    Closed.ConeDerived     = true;

    return Closed;
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE DERIVATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<DerivedPartitioning> DerivePartitioning(const TopologyStructure&    Imported,
                                                const TopologyConditioning& Conditioned)
{
    if (!Imported.Sealed())
    {
        return Deliver<DerivedPartitioning>::Refuse(
            { RefusalReason::HostDenied, "an unsealed topology may still be declared into" });
    }

    if (Conditioned.ConditionedRevision() != Imported.Revision())
    {
        return Deliver<DerivedPartitioning>::Refuse(
            { RefusalReason::ContentUnsupported, "the conditioning describes another revision of this topology" });
    }

    const std::uint32_t FaceCeiling = Imported.FaceCount();

    if (FaceCeiling == 0u)
    {
        return Deliver<DerivedPartitioning>::Refuse(
            { RefusalReason::ContentUnsupported, "a topology of no face partitions into nothing" });
    }

    const std::vector<ConditionedExtent>& FaceExtents = Conditioned.FaceExtents();

    if (static_cast<std::uint32_t>(FaceExtents.size()) != FaceCeiling)
    {
        return Deliver<DerivedPartitioning>::Refuse(
            { RefusalReason::ContentUnsupported, "the conditioning carries an extent count the topology does not" });
    }

    DerivedPartitioning Derived;
    Derived.DescribedRevision = Imported.Revision();
    Derived.OrderedFaces.reserve(FaceCeiling);

    // 📝 Two marks and not one. Admitted says the face belongs to a closed partition and is never revisited;
    //    Enqueued says it is standing on a growth front that may yet close before reaching it, and that mark is
    //    lifted at the close so the face seeds or joins the next partition instead of vanishing from the surface.
    std::vector<bool> Admitted(FaceCeiling, false);
    std::vector<bool> Enqueued(FaceCeiling, false);

    std::vector<std::uint32_t> Front;
    Front.reserve(FaceCeiling);

    bool LeastRecorded = false;

    for (std::uint32_t SeedFace = 0u; SeedFace < FaceCeiling; ++SeedFace)
    {
        if (Admitted[SeedFace])
            continue;

        if (Conditioned.FaceEnrolled(SeedFace, DegeneracySubject::ZeroExtentFace))
        {
            // 📝 Counted once, here, rather than at every adjacency that meets it. A face reached from four
            //    neighbours would otherwise be reported four times and `86` would read the exclusion as larger
            //    than the surface it happened on.
            if (!Admitted[SeedFace])
                ++Derived.Metrics.ExcludedFaceCount;

            Admitted[SeedFace] = true;
            continue;
        }

        if (static_cast<std::uint64_t>(Derived.Partitions.size()) + 1u >= static_cast<std::uint64_t>(AbsentPartition))
        {
            return Deliver<DerivedPartitioning>::Refuse(
                { RefusalReason::ExtentExhausted, "the partition count would reach the ordinal reserved for absence" });
        }

        const std::uint32_t SeedMaterial = MaterialOfFace(Imported, SeedFace);

        MicroSurfacePartition Growing;
        Growing.FirstFace       = static_cast<std::uint32_t>(Derived.OrderedFaces.size());
        Growing.MaterialOrdinal = SeedMaterial;

        double SummedX        = 0.0;
        double SummedY        = 0.0;
        double SummedZ        = 0.0;
        double LeastAgreement = 0.0;

        bool AgreementRecorded = false;
        bool EveryFaceOriented = true;
        bool FirstAdmission    = true;

        std::vector<SurfaceDirection> Orientations;

        Front.clear();
        Front.push_back(SeedFace);
        Enqueued[SeedFace] = true;

        std::size_t FrontHead = 0u;

        while (FrontHead < Front.size() && Growing.TriangleCount < PartitionTriangleCeiling)
        {
            const std::uint32_t AdmittedFace = Front[FrontHead];
            ++FrontHead;

            Admitted[AdmittedFace] = true;
            Derived.OrderedFaces.push_back(AdmittedFace);
            ++Growing.FaceCount;
            Growing.TriangleCount += TrianglesOfFace(Imported, AdmittedFace);

            AdmitExtent(Growing.Extent, FaceExtents[AdmittedFace], FirstAdmission);
            FirstAdmission = false;

            bool                   FaceOriented = false;
            const SurfaceDirection Oriented     = OrientationOfFace(Imported, AdmittedFace, FaceOriented);

            if (FaceOriented)
            {
                SummedX += static_cast<double>(Oriented.DirectionX);
                SummedY += static_cast<double>(Oriented.DirectionY);
                SummedZ += static_cast<double>(Oriented.DirectionZ);
                Orientations.push_back(Oriented);
            }
            else
            {
                EveryFaceOriented = false;
            }

            const std::uint32_t FirstCorner = Imported.FaceFirstCorner(AdmittedFace);
            const std::uint32_t CornerRun   = Imported.FaceCornerCount(AdmittedFace);

            for (std::uint32_t Step = 0u; Step < CornerRun; ++Step)
            {
                const Deliver<std::uint32_t> Across = Conditioned.AdjacentCorner(FirstCorner + Step);

                // 📝 🔴 A refusal is where the surface stops, not where the derivation failed. `38` refuses at a
                //    boundary edge and at a non-manifold one rather than choosing among several faces, so the
                //    front simply does not cross here and the count is what `86` reads the partitioning's
                //    fragmentation from.
                if (!Across.ContentPresent)
                {
                    ++Derived.Metrics.BoundaryRefusalCount;
                    continue;
                }

                const std::uint32_t Adjacent = Imported.CornerFace(Across.Resolve());

                if (Adjacent >= FaceCeiling || Admitted[Adjacent] || Enqueued[Adjacent])
                    continue;

                if (Conditioned.FaceEnrolled(Adjacent, DegeneracySubject::ZeroExtentFace))
                    continue;

                // 🔴 Growth stops at an enrollment change. `42`'s resolution carries one material ordinal per
                //    partition, so a partition spanning two resolves to whichever was recorded first and shades
                //    half of its own pixels with the other material's reflectance.
                if (MaterialOfFace(Imported, Adjacent) != SeedMaterial)
                    continue;

                Front.push_back(Adjacent);
                Enqueued[Adjacent] = true;
            }
        }

        // 📝 The front is lifted rather than discarded. Everything still standing on it was reachable and is not
        //    yet admitted, and leaving the mark down is how a partition that closed at its ceiling takes a ring
        //    of its own neighbours out of the surface with it.
        for (std::size_t Standing = FrontHead; Standing < Front.size(); ++Standing)
            Enqueued[Front[Standing]] = false;

        // 📐 Measured against the unnormalised sum and divided once at the end, rather than normalising the axis
        //    and then taking a dot product per face. One square root per partition instead of one per face, and
        //    the ordering of the comparisons is unaffected because the divisor is positive and common to all.
        // ⚠️ Seeded from the first face and not from one, because the products compared here carry the sum's own
        //    magnitude. A seed of one is a cosine, and against a partition of more than one face every real
        //    product exceeds it — the aperture then closes to a cone narrower than the faces occupy and the cull
        //    rejects a partition the artist is looking straight at.
        for (const SurfaceDirection& Compared : Orientations)
        {
            const double Agreement = static_cast<double>(Compared.DirectionX) * SummedX
                                   + static_cast<double>(Compared.DirectionY) * SummedY
                                   + static_cast<double>(Compared.DirectionZ) * SummedZ;

            if (!AgreementRecorded || Agreement < LeastAgreement)
            {
                LeastAgreement    = Agreement;
                AgreementRecorded = true;
            }
        }

        const double AxisMagnitude = std::sqrt(SummedX * SummedX + SummedY * SummedY + SummedZ * SummedZ);
        const double Aperture      = AgreementRecorded && AxisMagnitude > 0.0
                                   ? LeastAgreement / AxisMagnitude
                                   : 0.0;

        Growing.Orientation = CloseCone(SummedX, SummedY, SummedZ, Aperture, EveryFaceOriented);

        if (!Growing.Orientation.ConeDerived)
            ++Derived.Metrics.ConelessCount;

        if (Growing.TriangleCount < PartitionTriangleFloor)
            ++Derived.Metrics.ShortPartitionCount;

        if (!LeastRecorded || Growing.TriangleCount < Derived.Metrics.LeastTriangleCount)
        {
            Derived.Metrics.LeastTriangleCount = Growing.TriangleCount;
            LeastRecorded                      = true;
        }

        if (Growing.TriangleCount > Derived.Metrics.GreatestTriangleCount)
            Derived.Metrics.GreatestTriangleCount = Growing.TriangleCount;

        Derived.Partitions.push_back(Growing);
    }

    Derived.Metrics.PartitionCount = static_cast<std::uint32_t>(Derived.Partitions.size());

    if (Derived.Partitions.empty())
    {
        return Deliver<DerivedPartitioning>::Refuse(
            { RefusalReason::ContentUnsupported, "every face of the topology is enrolled as zero-extent" });
    }

    return Deliver<DerivedPartitioning>::Deliver(Derived);
}

//------------------------------------------------------------------------------------------------------------------------
//                                               ADOPTION AND DECLARATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> PartitionStructure::Adopt(const DerivedPartitioning& Arriving)
{
    if (Arriving.Partitions.empty())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a partitioning of no partition stands for nothing" });

    StandingPartitioning = Arriving;

    // 📝 The identities go with the adoption. They were issued against the partition ordinals of the partitioning
    //    being replaced, and retaining them would let `IdentityOf` hand out an identity naming a partition the
    //    new partitioning numbers differently — which resolves, and resolves to the wrong surface.
    Identities.clear();

    ++AdoptedRevision;
    PartitioningAdopted = true;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> PartitionStructure::Declare(PartitionResolutionIndex& Resolutions, OccupantIdentity Occupant)
{
    if (!PartitioningAdopted)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "no partitioning stands to declare" });

    if (!Occupant.IdentityDeclared())
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the occupant identity names no slot" });

    Identities.clear();
    Identities.reserve(StandingPartitioning.Partitions.size());

    for (const MicroSurfacePartition& Standing : StandingPartitioning.Partitions)
    {
        ResolvedPartition Resolving;
        Resolving.Occupant        = Occupant;
        Resolving.MaterialOrdinal = Standing.MaterialOrdinal;
        Resolving.FirstFace       = Standing.FirstFace;
        Resolving.FaceCount       = Standing.FaceCount;

        const Deliver<PartitionIdentity> Issued = Resolutions.Declare(Resolving);

        if (!Issued.ContentPresent)
        {
            // 📝 The retained identities are dropped on a partial declaration. Half a partitioning declared is
            //    one where `IdentityOf` answers for the low ordinals and refuses for the high ones, and the
            //    caller reads that as a partitioning with a hole rather than as this refusal.
            Identities.clear();

            return Deliver<bool>::Refuse(Issued.Declined);
        }

        Identities.push_back(Issued.Resolve());
    }

    return Deliver<bool>::Deliver(true);
}

void PartitionStructure::Reclaim()
{
    StandingPartitioning = {};
    Identities.clear();

    PartitioningAdopted = false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE READS
//------------------------------------------------------------------------------------------------------------------------

const DerivedPartitioning& PartitionStructure::Standing() const
{
    return StandingPartitioning;
}

Deliver<PartitionIdentity> PartitionStructure::IdentityOf(std::uint32_t PartitionOrdinal) const
{
    if (PartitionOrdinal >= static_cast<std::uint32_t>(StandingPartitioning.Partitions.size()))
        return Deliver<PartitionIdentity>::Refuse({ RefusalReason::ContentUnsupported, "no such partition" });

    if (Identities.size() != StandingPartitioning.Partitions.size())
    {
        return Deliver<PartitionIdentity>::Refuse(
            { RefusalReason::IdentityStale, "nothing has been declared since the partitioning was adopted" });
    }

    return Deliver<PartitionIdentity>::Deliver(Identities[PartitionOrdinal]);
}

bool PartitionStructure::PartitioningStanding() const
{
    return PartitioningAdopted;
}

std::uint64_t PartitionStructure::Revision() const
{
    return AdoptedRevision;
}

std::uint64_t PartitionStructure::DescribedRevision() const
{
    return StandingPartitioning.DescribedRevision;
}

std::uint32_t PartitionStructure::PartitionCount() const
{
    return static_cast<std::uint32_t>(StandingPartitioning.Partitions.size());
}

}   // namespace Slate
