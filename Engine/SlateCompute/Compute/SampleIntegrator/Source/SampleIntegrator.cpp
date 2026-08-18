//============================================================================================================================================
//                                                          SAMPLEINTEGRATOR.CPP
//============================================================================================================================================
// 🧩 Motion-driven reprojection, the count-derived weight, and the reset that never decays.

#include "SlateCompute/Compute/SampleIntegrator/Api/SampleIntegrator.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE DECLARATION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

const char* const AccumulationRecordingIdentity = "64-SampleIntegrator";

}   // namespace

Deliver<bool> SampleIntegrator::Declare(const RejectionSpecification& Declaring)
{
    if (!(Declaring.DepthBound > 0.0))
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "a depth bound of nothing refuses every history" });
    }

    if (Declaring.CountCeiling == 0u)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "a ceiling of nothing accumulates nothing" });
    }

    Specification = Declaring;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> SampleIntegrator::Contribute(RenderSchedule& Schedule) const
{
    DeclaredRecording Declared;
    Declared.Identity = AccumulationRecordingIdentity;

    Declared.Produces = { SharedTarget::AccumulationSurface };

    // 📝 `MotionSurface` is declared here and by `16` §4.2 as a production, which is what orders the two. The
    //    previous rotation's `AccumulationSurface` is read too and is deliberately **not** declared: it is last
    //    rotation's residue of a target this recording itself produces, and declaring it would close a cycle in
    //    an ordering that has no notion of the rotation an ordinate came from.
    Declared.Reads = { SharedTarget::RadianceSurface,
                       SharedTarget::MotionSurface,
                       SharedTarget::DepthSurface,
                       SharedTarget::VisibilityIndex };

    Declared.Amends             = {};
    Declared.Command            = RecordingCommand::ComputeDispatch;
    Declared.CapabilityRequired = false;
    Declared.Substitution       = "";
    Declared.DisplayReferred    = false;
    Declared.AmendmentOrdinal   = AmendmentOrdinal;

    return Schedule.Contribute(Declared);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE OFFSET
//------------------------------------------------------------------------------------------------------------------------

void SampleIntegrator::OffsetOf(std::uint64_t RecordingOrdinal, double& OffsetX, double& OffsetY) const
{
    // 🔴 `02` §6's sequence and nothing invented here. `46` applies the same offset when it builds the
    //    projection and `82` replays it when it resolves a preview, so all three read one routine — a preview
    //    that converged to a different image than the workspace would be attributed to the preview.
    ProjectSubPixelOffset(static_cast<std::uint32_t>(RecordingOrdinal % SubPixelSequenceLength), OffsetX, OffsetY);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE CLASSIFICATION
//------------------------------------------------------------------------------------------------------------------------

RejectionSubject SampleIntegrator::Classify(double        ReprojectedAlong,
                                            double        ReprojectedAcross,
                                            std::uint32_t HeldOccupant,
                                            std::uint32_t ArrivingOccupant,
                                            double        HeldDepth,
                                            double        ArrivingDepth) const
{
    // 📝 Asked cheapest first, and the extent test is the one that rejects most: a camera in motion moves the
    //    whole image and the leading edge has no history at all.
    if (!HistoryStanding)
        return RejectionSubject::OffExtent;

    if (ReprojectionOffExtent(ReprojectedAlong, ReprojectedAcross))
        return RejectionSubject::OffExtent;

    if (!ReprojectionSameOccupant(HeldOccupant, ArrivingOccupant))
        return RejectionSubject::OccupantDiffers;

    if (ReprojectionDepthRefused(HeldDepth, ArrivingDepth, Specification.DepthBound))
        return RejectionSubject::DepthDiffers;

    return RejectionSubject::Accepted;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE ACCUMULATION
//------------------------------------------------------------------------------------------------------------------------

void SampleIntegrator::Accumulate(AccumulatedSample& Held,
                                  const double       Arriving[3],
                                  RejectionSubject   Refused,
                                  const double       Least[3],
                                  const double       Greatest[3]) const
{
    // 🔴 A refusal writes the arriving sample whole and sets the count to one. Decaying instead leaves a coloured
    //    ghost trailing every moving occupant, and the ghost is more visible than the absence would be.
    if (Refused != RejectionSubject::Accepted)
    {
        for (std::uint32_t Component = 0u; Component < 3u; ++Component)
            Held.Component[Component] = Arriving[Component];

        Held.SampleCount = 1u;

        return;
    }

    const double Weight = ProjectAccumulationWeight(Held.SampleCount, Specification.CountCeiling);

    for (std::uint32_t Component = 0u; Component < 3u; ++Component)
    {
        // 📝 The neighbourhood is widened by the declared factor before the bound is applied, so a sample that
        //    is legitimately outside its neighbours' range — a specular highlight one pixel wide — is not clipped
        //    away every rotation. A bound applied at the neighbours' exact extremes removes exactly the features
        //    the accumulation exists to resolve.
        const double Middle    = (Least[Component] + Greatest[Component]) * 0.5;
        const double HalfSpan  = (Greatest[Component] - Least[Component]) * 0.5
                               * Specification.NeighbourhoodBound;

        const double Bounded = BoundNeighbourhood(Held.Component[Component],
                                                  Middle - HalfSpan,
                                                  Middle + HalfSpan);

        Held.Component[Component] = Bounded + (Arriving[Component] - Bounded) * Weight;
    }

    Held.SampleCount = ProjectAccumulatedCount(Held.SampleCount, Specification.CountCeiling);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE INVALIDATIONS
//------------------------------------------------------------------------------------------------------------------------

void SampleIntegrator::Invalidate()
{
    // 🔴 `64` §8's last gate, as one line. The three moments it covers — bring-up, an extent change and a device
    //    loss — have nothing in common except that no previous result describes anything, and reading one would
    //    reproject a history addressed in pixels that no longer exist.
    HistoryStanding = false;
}

bool SampleIntegrator::HistoryReadable() const { return HistoryStanding; }

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE REPORTING
//------------------------------------------------------------------------------------------------------------------------

void SampleIntegrator::DeclareRotation(std::uint32_t LeastSampleCount,
                                       std::uint32_t GreatestSampleCount,
                                       std::uint32_t RejectedCount,
                                       std::uint32_t AccumulatedCount)
{
    Reported.LeastSampleCount    = LeastSampleCount;
    Reported.GreatestSampleCount = GreatestSampleCount;
    Reported.RejectedCount       = RejectedCount;
    Reported.AccumulatedCount    = AccumulatedCount;

    // 📝 A rotation that accumulated anything at all leaves a history the next one may read. Set here rather
    //    than at Declare, so that a rotation which refused every pixel still leaves the flag standing — the
    //    histories exist, they were simply all rejected, which is a different fact from having none.
    if (AccumulatedCount != 0u)
        HistoryStanding = true;
}

void SampleIntegrator::Report(MeasureIndex& Measured, TickPoint Sampled) const
{
    Measured.DeclareCount("64 §3 SampleIntegrator", "LeastSampleCount", Reported.LeastSampleCount, Sampled);
    Measured.DeclareCount("64 §3 SampleIntegrator", "GreatestSampleCount", Reported.GreatestSampleCount, Sampled);
    Measured.DeclareCount("64 §4 SampleIntegrator", "Rejected", Reported.RejectedCount, Sampled);
    Measured.DeclareCount("64 §3 SampleIntegrator", "Accumulated", Reported.AccumulatedCount, Sampled);
}

const RejectionSpecification& SampleIntegrator::Declared() const { return Specification; }
const ConvergenceMetrics&     SampleIntegrator::Metrics() const  { return Reported;      }

}   // namespace Slate
