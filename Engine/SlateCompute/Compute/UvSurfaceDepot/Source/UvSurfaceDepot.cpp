//============================================================================================================================================
//                                                           UVSURFACEDEPOT.CPP
//============================================================================================================================================
// 🧩 A Tier A extent test, a rule that chooses among what it admitted, sweeps that converge — and a miss recorded as a miss.

#include "SlateCompute/Compute/UvSurfaceDepot/Api/UvSurfaceDepot.h"

#include "Shared/IntersectionClassifier.slang.h"

#include <cmath>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE DECLARATION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

const char* const TransferOrigin = "24 §4 UvSurfaceDepot";

/// 🧩 One source face's axis-aligned extent and its centre, as the search reads them.
struct FaceExtent
{
    double  LeastX    = 0.0;   // [mm] - the face's own bound, in object space
    double  LeastY    = 0.0;   // [mm]
    double  LeastZ    = 0.0;   // [mm]
    double  GreatestX = 0.0;   // [mm]
    double  GreatestY = 0.0;   // [mm]
    double  GreatestZ = 0.0;   // [mm]
    double  CentreX   = 0.0;   // [mm] - the mean of its corners; what the departure is measured to
    double  CentreY   = 0.0;   // [mm]
    double  CentreZ   = 0.0;   // [mm]
};

// 📐 One face's bound and centre from its corners, in the source's own ordering. Derived per search rather than
//    held, because the source is immutable for the whole run and a second copy of a bound is a second thing that
//    can describe a revision the topology has left.
FaceExtent ExtentOfFace(const TopologyStructure& Source, std::uint32_t FaceOrdinal)
{
    FaceExtent Bounded;

    const std::uint32_t FirstCorner = Source.FaceFirstCorner(FaceOrdinal);
    const std::uint32_t CornerSpan  = Source.FaceCornerCount(FaceOrdinal);

    if (CornerSpan == 0u)
    {
        return Bounded;
    }

    const std::vector<DocumentPosition>& Positions = Source.Positions();

    double AccumulatedX = 0.0;
    double AccumulatedY = 0.0;
    double AccumulatedZ = 0.0;

    for (std::uint32_t Walked = 0u; Walked < CornerSpan; ++Walked)
    {
        const DocumentPosition& Held = Positions[Source.CornerVertex(FirstCorner + Walked)];

        if (Walked == 0u)
        {
            Bounded.LeastX = Bounded.GreatestX = Held.PositionX;
            Bounded.LeastY = Bounded.GreatestY = Held.PositionY;
            Bounded.LeastZ = Bounded.GreatestZ = Held.PositionZ;
        }
        else
        {
            Bounded.LeastX    = Held.PositionX < Bounded.LeastX    ? Held.PositionX : Bounded.LeastX;
            Bounded.LeastY    = Held.PositionY < Bounded.LeastY    ? Held.PositionY : Bounded.LeastY;
            Bounded.LeastZ    = Held.PositionZ < Bounded.LeastZ    ? Held.PositionZ : Bounded.LeastZ;
            Bounded.GreatestX = Held.PositionX > Bounded.GreatestX ? Held.PositionX : Bounded.GreatestX;
            Bounded.GreatestY = Held.PositionY > Bounded.GreatestY ? Held.PositionY : Bounded.GreatestY;
            Bounded.GreatestZ = Held.PositionZ > Bounded.GreatestZ ? Held.PositionZ : Bounded.GreatestZ;
        }

        AccumulatedX += Held.PositionX;
        AccumulatedY += Held.PositionY;
        AccumulatedZ += Held.PositionZ;
    }

    Bounded.CentreX = AccumulatedX / static_cast<double>(CornerSpan);
    Bounded.CentreY = AccumulatedY / static_cast<double>(CornerSpan);
    Bounded.CentreZ = AccumulatedZ / static_cast<double>(CornerSpan);

    return Bounded;
}

// 📐 The face's orientation as the mean of its corners' own, unnormalised. The angular rule compares magnitudes
//    against one another and never against an absolute bound, so the normalisation the mean omits cancels.
SurfaceDirection OrientationOfFace(const TopologyStructure& Source, std::uint32_t FaceOrdinal)
{
    SurfaceDirection Averaged;

    if (!Source.PerpendicularsSupplied())
    {
        return Averaged;
    }

    const std::vector<SurfaceDirection>& Perpendiculars = Source.Perpendiculars();

    const std::uint32_t FirstCorner = Source.FaceFirstCorner(FaceOrdinal);
    const std::uint32_t CornerSpan  = Source.FaceCornerCount(FaceOrdinal);

    for (std::uint32_t Walked = 0u; Walked < CornerSpan; ++Walked)
    {
        const SurfaceDirection& Held = Perpendiculars[Source.CornerVertex(FirstCorner + Walked)];

        Averaged.DirectionX += Held.DirectionX;
        Averaged.DirectionY += Held.DirectionY;
        Averaged.DirectionZ += Held.DirectionZ;
    }

    return Averaged;
}

double DepartureBetween(DocumentPosition Standing, const FaceExtent& Bounded)
{
    const double AlongX = Standing.PositionX - Bounded.CentreX;
    const double AlongY = Standing.PositionY - Bounded.CentreY;
    const double AlongZ = Standing.PositionZ - Bounded.CentreZ;

    return std::sqrt(AlongX * AlongX + AlongY * AlongY + AlongZ * AlongZ);
}

// 📐 How nearly the face lies along the working orientation. Greater is more nearly aligned, and a source with
//    no perpendiculars supplied returns nothing for every face — which leaves the angular rule choosing among
//    equals, so the departure below decides. That is a degradation to the other rule and never a refusal.
double AlignmentBetween(SurfaceDirection Working, SurfaceDirection Faced)
{
    return Working.DirectionX * Faced.DirectionX
         + Working.DirectionY * Faced.DirectionY
         + Working.DirectionZ * Faced.DirectionZ;
}

}   // namespace

Deliver<bool> UvSurfaceDepot::Declare(const TransferSpecification& Transferring_)
{
    if (!(Transferring_.SearchExtent > 0.0))
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "a search extent of nothing corresponds to no source surface" });
    }

    // 🔴 An empty mask transfers nothing while reporting no miss and no resolution, which reads as a transfer
    //    that succeeded. `24` §4 obliges this to report what it missed, and it cannot report a channel it was
    //    never asked for.
    if (Transferring_.ChannelMask == 0u)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "no channel was declared for transfer" });
    }

    if (Transferring_.DomainExtent == 0u)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "a domain extent of nothing writes the result nowhere" });
    }

    if (!(Transferring_.ConvergenceCriterion > 0.0) || Transferring_.ConvergenceCriterion > 1.0)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "the convergence criterion lies outside the unit interval" });
    }

    if (Transferring_.IterationCeiling == 0u)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "an iteration ceiling of nothing admits no sweep at all" });
    }

    if (Transferring_.Correspondence == CorrespondenceSubject::CorrespondenceCount)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "the closed count is not a correspondence rule" });
    }

    Transferring     = Transferring_;
    TransferStanding = true;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE CONTENT KEY
//------------------------------------------------------------------------------------------------------------------------

Deliver<ContentKey> UvSurfaceDepot::KeyOf(const TopologyStructure& Source,
                                          const TopologyStructure& Working,
                                          const ChartPartition&    Partitioning) const
{
    if (!TransferStanding)
    {
        return Deliver<ContentKey>::Refuse(
            { RefusalReason::ContentUnsupported, "no transfer was declared to key" });
    }

    if (!Source.Sealed() || !Working.Sealed())
    {
        return Deliver<ContentKey>::Refuse(
            { RefusalReason::ContentUnsupported, "an unsealed topology carries no revision to key on" });
    }

    // 🔴 `68` §6 and `24` §3: the partition revision moves every domain position with it. A result keyed without
    //    it survives a re-unwrap and is then read at positions that mean something else.
    if (!Partitioning.PartitionStanding())
    {
        return Deliver<ContentKey>::Refuse(
            { RefusalReason::ContentUnsupported, "no partition stands, so no domain position means anything yet" });
    }

    ContentKey Keyed;
    Keyed.SourceRevision       = Source.Revision();
    Keyed.WorkingRevision      = Working.Revision();
    Keyed.PartitionRevision    = Partitioning.Revision();
    Keyed.SpecificationOrdinal = Transferring.SpecificationOrdinal;
    Keyed.ExtentTexels         = Transferring.DomainExtent;
    Keyed.ChannelMask          = Transferring.ChannelMask;

    return Deliver<ContentKey>::Deliver(Keyed);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE CORRESPONDENCE
//------------------------------------------------------------------------------------------------------------------------

Deliver<SourceCorrespondence> UvSurfaceDepot::Correspond(DocumentPosition         WorkingPosition,
                                                         SurfaceDirection         WorkingOrientation,
                                                         const TopologyStructure& Source) const
{
    if (!TransferStanding)
    {
        return Deliver<SourceCorrespondence>::Refuse(
            { RefusalReason::ContentUnsupported, "no transfer was declared to correspond against" });
    }

    const double Extent = Transferring.SearchExtent;

    SourceCorrespondence Chosen;
    Chosen.FaceOrdinal = AbsentCorrespondence;

    double LeastDeparture   = 0.0;
    double GreatestAligning = 0.0;

    const std::uint32_t FaceSpan = Source.FaceCount();

    for (std::uint32_t FaceOrdinal = 0u; FaceOrdinal < FaceSpan; ++FaceOrdinal)
    {
        const FaceExtent Bounded = ExtentOfFace(Source, FaceOrdinal);

        // 🔴 Tier A admission — `24` §2 and §5's second gate. The working position is grown into a volume of the
        //    declared extent and the two volumes are classified by `Shared/`'s own routine, so the host and the
        //    device answer the same question the same way. A comparison written here would be the second
        //    implementation the classifier exists to prevent.
        const Signed32 Overlap = ClassifyVolumeOverlap(
            WorkingPosition.PositionX - Extent, WorkingPosition.PositionY - Extent, WorkingPosition.PositionZ - Extent,
            WorkingPosition.PositionX + Extent, WorkingPosition.PositionY + Extent, WorkingPosition.PositionZ + Extent,
            Bounded.LeastX,    Bounded.LeastY,    Bounded.LeastZ,
            Bounded.GreatestX, Bounded.GreatestY, Bounded.GreatestZ);

        if (Overlap < 0)
        {
            continue;
        }

        const double Departure = DepartureBetween(WorkingPosition, Bounded);

        // 🔴 The extent is a ceiling and nothing samples past it. A face whose bound reaches into the search
        //    volume while its centre stands beyond the extent is rejected here rather than delivered as the
        //    nearest thing found — `24` §2 refuses the fabricated value by name.
        if (Departure > Extent)
        {
            continue;
        }

        const double Aligning = AlignmentBetween(WorkingOrientation, OrientationOfFace(Source, FaceOrdinal));

        bool Preferred = Chosen.FaceOrdinal == AbsentCorrespondence;

        if (!Preferred && Transferring.Correspondence == CorrespondenceSubject::LeastAngularDeparture)
        {
            Preferred = Aligning > GreatestAligning
                    || (Aligning == GreatestAligning && Departure < LeastDeparture);
        }
        else if (!Preferred)
        {
            Preferred = Departure < LeastDeparture;
        }

        if (Preferred)
        {
            Chosen.FaceOrdinal = FaceOrdinal;
            Chosen.Departure   = Departure;
            LeastDeparture     = Departure;
            GreatestAligning   = Aligning;
        }
    }

    if (Chosen.FaceOrdinal == AbsentCorrespondence)
    {
        return Deliver<SourceCorrespondence>::Refuse(
            { RefusalReason::ExtentExhausted, "no source surface stands within the declared search extent" });
    }

    return Deliver<SourceCorrespondence>::Deliver(Chosen);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE TRANSFER
//------------------------------------------------------------------------------------------------------------------------

ConvergentResult<TransferMetrics> UvSurfaceDepot::Transfer(const TopologyStructure&          Source,
                                                           const TopologyStructure&          Working,
                                                           const std::vector<std::uint32_t>& SourceChannelMasks) const
{
    ConvergentResult<TransferMetrics> Produced;

    if (!TransferStanding)
    {
        return Produced;
    }

    const std::uint32_t DomainSpan = Working.VertexCount();

    Produced.Approximation.DomainCount = DomainSpan;

    if (DomainSpan == 0u)
    {
        Produced.Cause = TerminationCause::CriterionSatisfied;
        return Produced;
    }

    const std::vector<DocumentPosition>& WorkingPositions = Working.Positions();
    const std::vector<SurfaceDirection>  NoOrientations;
    const std::vector<SurfaceDirection>& WorkingOrientations = Working.PerpendicularsSupplied()
                                                             ? Working.Perpendiculars()
                                                             : NoOrientations;

    std::vector<std::uint32_t> Corresponded(DomainSpan, AbsentCorrespondence);

    // 📐 The sweep spreads: an unresolved position is retried against the faces its own topology's resolved
    //    positions found, which is what makes the transfer converge rather than terminate at a fixed cost. The
    //    retry passes the same extent test, so propagation never reaches a face the direct search would not.
    for (std::uint32_t Swept = 0u; Swept < Transferring.IterationCeiling; ++Swept)
    {
        std::uint32_t ResolvedThisSweep = 0u;

        for (std::uint32_t VertexOrdinal = 0u; VertexOrdinal < DomainSpan; ++VertexOrdinal)
        {
            if (Corresponded[VertexOrdinal] != AbsentCorrespondence)
            {
                continue;
            }

            SurfaceDirection Orientation;

            if (!WorkingOrientations.empty())
            {
                Orientation = WorkingOrientations[VertexOrdinal];
            }

            const Deliver<SourceCorrespondence> Found =
                Correspond(WorkingPositions[VertexOrdinal], Orientation, Source);

            if (Found.ContentPresent)
            {
                Corresponded[VertexOrdinal] = Found.Resolve().FaceOrdinal;
                ++ResolvedThisSweep;
            }
        }

        Produced.Approximation.SweepCount = Swept + 1u;
        Produced.ResidualNorm             = static_cast<double>(ResolvedThisSweep) / static_cast<double>(DomainSpan);
        Produced.IterationCount           = Swept + 1u;

        // 📐 The residual is the fraction newly resolved. A sweep that resolved nothing further has converged;
        //    one still resolving above the criterion has more to do. Measured as a fraction rather than as a
        //    count so that the criterion means the same thing on a topology of a thousand and of a million.
        if (Produced.ResidualNorm <= Transferring.ConvergenceCriterion)
        {
            Produced.Cause = TerminationCause::CriterionSatisfied;
            break;
        }

        Produced.Cause = TerminationCause::CeilingReached;
    }

    // 🔴 `24` §2: whatever remains unresolved is recorded as a miss — never as zero, never as the nearest value
    //    found beyond the extent. A channel the corresponding source face does not itself carry is a miss too,
    //    for the same reason: it was asked for and not delivered.
    for (std::uint32_t VertexOrdinal = 0u; VertexOrdinal < DomainSpan; ++VertexOrdinal)
    {
        const std::uint32_t FaceOrdinal = Corresponded[VertexOrdinal];

        if (FaceOrdinal != AbsentCorrespondence)
        {
            ++Produced.Approximation.ResolvedCount;
        }

        const std::uint32_t SourceCarries = FaceOrdinal != AbsentCorrespondence
                                         && FaceOrdinal < SourceChannelMasks.size()
                                          ? SourceChannelMasks[FaceOrdinal]
                                          : 0u;

        for (std::uint32_t ChannelOrdinal = 0u;
             ChannelOrdinal < static_cast<std::uint32_t>(ChannelSubject::ChannelCount);
             ++ChannelOrdinal)
        {
            const std::uint32_t ChannelBit = 1u << ChannelOrdinal;

            if ((Transferring.ChannelMask & ChannelBit) == 0u)
            {
                continue;
            }

            if ((SourceCarries & ChannelBit) == 0u)
            {
                ++Produced.Approximation.ChannelMisses[ChannelOrdinal];
            }
        }
    }

    return Produced;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE ADMISSION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> UvSurfaceDepot::Admit(SurfaceDepot&     Depot,
                                    const ContentKey& Keyed,
                                    std::uint64_t     ByteExtent,
                                    std::uint64_t     RecordingOrdinal) const
{
    // 🔴 Declared an analytic resolution, which `56` §3 classifies as reconstructible — so the depot admits it as
    //    evictable. Nothing painted is ever declared here: paint is a layer above the transfer in `56`'s sequence
    //    and stays there, rather than the transfer mutating into authored content underneath it.
    return Depot.Declare(Keyed, LayerContentSource::AnalyticResolution, ByteExtent, RecordingOrdinal);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE REPORTING
//------------------------------------------------------------------------------------------------------------------------

void UvSurfaceDepot::Report(const ConvergentResult<TransferMetrics>& Produced,
                            ReportSequence&                          Reporting,
                            MeasureIndex&                            Measured,
                            TickPoint                                Sampled) const
{
    if (Produced.Cause == TerminationCause::CeilingReached)
    {
        ReportSpecification Terminated;
        Terminated.Origin         = TransferOrigin;
        Terminated.Subject        = "Transfer";
        Terminated.Detail         = "the iteration ceiling terminated the transfer; positions remain unresolved";
        Terminated.SubjectOrdinal = Produced.Approximation.SweepCount;
        Terminated.Disposition    = ReportDisposition::Terminated;
        Terminated.Arrival        = Sampled;

        Reporting.Append(Terminated);
    }

    // 🔴 `24` §4: the miss count is per channel and each missed channel appends its own report. One total says
    //    nothing about which attribute is wrong, and a transfer that missed a tenth of the domain in one channel
    //    looks like one that missed nothing everywhere the transfer succeeded.
    for (std::uint32_t ChannelOrdinal = 0u;
         ChannelOrdinal < static_cast<std::uint32_t>(ChannelSubject::ChannelCount);
         ++ChannelOrdinal)
    {
        if (Produced.Approximation.ChannelMisses[ChannelOrdinal] == 0u)
        {
            continue;
        }

        ReportSpecification Missed;
        Missed.Origin         = TransferOrigin;
        Missed.Subject        = "ChannelMiss";
        Missed.Detail         = "no source surface within the extent carried this channel; the domain position is a miss";
        Missed.SubjectOrdinal = (static_cast<std::uint64_t>(ChannelOrdinal) << 32)
                              | Produced.Approximation.ChannelMisses[ChannelOrdinal];
        Missed.Disposition    = ReportDisposition::Truncated;
        Missed.Arrival        = Sampled;

        Reporting.Append(Missed);
    }

    // 📝 The counts overwrite. A count appended every transfer buries the one channel that missed under readings
    //    nobody asked for — the same line `68`'s reporting draws.
    Measured.DeclareCount(TransferOrigin, "DomainCount",   Produced.Approximation.DomainCount,   Sampled);
    Measured.DeclareCount(TransferOrigin, "ResolvedCount", Produced.Approximation.ResolvedCount, Sampled);
    Measured.DeclareCount(TransferOrigin, "SweepCount",    Produced.Approximation.SweepCount,    Sampled);
    Measured.DeclareMagnitude(TransferOrigin, "Residual", Produced.ResidualNorm, Sampled);
}

const TransferSpecification& UvSurfaceDepot::Specification() const { return Transferring; }

}   // namespace Slate
