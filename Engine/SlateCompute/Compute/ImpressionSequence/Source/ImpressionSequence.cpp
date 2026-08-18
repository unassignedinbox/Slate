//============================================================================================================================================
//                                                        IMPRESSIONSEQUENCE.CPP
//============================================================================================================================================
// 🧩 Domain resampling from arrival stamps, the deferral that never coarsens, and the accumulation applied once.

#include "SlateCompute/Compute/ImpressionSequence/Api/ImpressionSequence.h"

#include <cmath>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE PAINTING LEVEL
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> PaintingLevelOf(std::uint32_t WorkingExtent)
{
    for (std::uint32_t Candidate = 0u; Candidate < ReductionLevelCount; ++Candidate)
    {
        if (CellsPerEdgeAt(Candidate) * CoverageTileTexels == WorkingExtent)
            return Deliver<std::uint32_t>::Deliver(Candidate);
    }

    return Deliver<std::uint32_t>::Refuse(
        { RefusalReason::ContentUnsupported, "no reduction level carries that working extent" });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  THE SHAPE PROFILE
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📝 The normalisation references the five dynamic axes are expressed against. `58` §4 declares the axes and
//    leaves their normalisation to whoever supplies them, which is here. Read by this unit alone, so `00` §2
//    keeps them here rather than in `Contract/`.
constexpr double SpeedReference        = 2.0;    // [-/s] - crossing the domain twice a second reads as unity
constexpr double PathDistanceReference = 1.0;    // [-]   - one full traverse of the domain reads as unity
constexpr double TiltReference         = 90.0;   // [deg] - flat against the surface reads as unity
constexpr double RotationReference     = 360.0;  // [deg] - one whole barrel turn

// 📐 Coverage as a function of normalised radius. Every profile is unity at the centre and zero at the edge, so
//    a brush that declares one and a brush that declares another differ in how they fall away and in nothing
//    else — which is what lets the artist compare two profiles by painting with them.
double ProfileCoverage(ProfileSubject Declared, double NormalisedRadius)
{
    if (NormalisedRadius >= 1.0)
        return 0.0;

    const double Fraction = 1.0 - (NormalisedRadius < 0.0 ? 0.0 : NormalisedRadius);

    switch (Declared)
    {
        case ProfileSubject::Constant:     return 1.0;
        case ProfileSubject::Linear:       return Fraction;
        case ProfileSubject::Quadratic:    return Fraction * Fraction;

        // 📐 The cubic Hermite step, taken on the complement so the shoulder is at the centre and the toe at the
        //    edge. A profile that eased only at the edge would read as a hard-centred brush with a soft rim.
        case ProfileSubject::Sigmoid:      return Fraction * Fraction * (3.0 - 2.0 * Fraction);
        case ProfileSubject::ProfileCount: break;
    }

    return 0.0;
}

double BoundedUnit(double Magnitude)
{
    return Magnitude < 0.0 ? 0.0 : (Magnitude > 1.0 ? 1.0 : Magnitude);
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                       OPENING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> ImpressionSequence::Open(const StrokeDeclaration& Declaring, const BrushSpecification& Brushed)
{
    if (OpenDeclared)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "a stroke is already open" });

    const Deliver<std::uint32_t> Levelled = PaintingLevelOf(Declaring.WorkingExtent);

    if (!Levelled.ContentPresent)
        return Deliver<bool>::Refuse(Levelled.Declined);

    if (Declaring.ComponentCount == 0u)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "an entry of no component holds nothing" });

    if (!Declaring.Subject.IdentityDeclared())
        return Deliver<bool>::Refuse({ RefusalReason::IdentityStale, "the stroke names no entry to paint into" });

    // 🚧 `58` §3's imagery and outline sources need `50` and `52` intake, which are unbuilt. Refused at Open
    //    rather than substituted, because `58` §8 promises the preview and the committed impression share one
    //    shape — and a substituted profile breaks that promise where the artist is least able to see it coming.
    if (Brushed.Shape().Source != ShapeSource::Analytic)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "only an analytic shape resolves; `50` and `52` intake is unbuilt" });
    }

    if (Brushed.Channels().empty())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the brush writes no channel" });

    // 🔴 Every declared channel must be placed, and every placement must lie inside the entry. A placement that
    //    ran past the components would write into the texel after it, which is the next texel's first channel —
    //    and the defect presents as a one-texel colour fringe rather than as an out-of-range write.
    for (const BrushChannelValue& Writing : Brushed.Channels())
    {
        bool Placed = false;

        for (const ChannelPlacement& Placing : Declaring.Placements)
        {
            if (Placing.Channel != Writing.Channel)
                continue;

            const std::uint32_t Required = Writing.ColourDeclared ? 3u : 1u;

            if (Placing.ComponentSpan != Required)
            {
                return Deliver<bool>::Refuse(
                    { RefusalReason::ContentUnsupported, "the placement's span does not match the channel's measure" });
            }

            if (Placing.ComponentOrdinal + Placing.ComponentSpan > Declaring.ComponentCount)
            {
                return Deliver<bool>::Refuse(
                    { RefusalReason::ContentUnsupported, "the placement runs past the entry's components" });
            }

            Placed = true;
            break;
        }

        if (!Placed)
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::ContentUnsupported, "a declared brush channel carries no placement" });
        }
    }

    Declared    = Declaring;
    Brush       = Brushed;
    Combination = Brushed.Combination();
    Level       = Levelled.Resolve();

    // 🔴 `58` §7: the stroke records the brush's **parameters**, not a reference to it. An artist who edits a
    //    brush and then undoes an old stroke must get that stroke's inverse, not the inverse the current brush
    //    would produce — and `58` §6's seed travels in the same record for the same reason.
    Recorded = RecordBrush(Brushed, Declaring.StrokeSeed);

    Sequenced.clear();
    Accumulated.Construct();

    LastAlong         = 0.0;
    LastAcross        = 0.0;
    LastArrival       = {};
    TravelledDistance = 0.0;
    PendingDistance   = 0.0;
    NextSpacing       = 0.0;
    ResolvedTotal     = 0u;
    OpenDeclared      = true;
    PathBegun         = false;
    PathBroken        = false;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE RESAMPLING
//------------------------------------------------------------------------------------------------------------------------

ResolvedAxes ImpressionSequence::ProjectAxes(const PointerSample& Arriving,
                                             double               TangentAlong,
                                             double               TangentAcross,
                                             double               Speed,
                                             double               PathDistance) const
{
    static_cast<void>(TangentAlong);
    static_cast<void>(TangentAcross);

    ResolvedAxes Axes;

    // 🔴 `58` §4 and `04` §3: an absent axis stays absent. A tablet reporting no tilt and a stylus held upright
    //    are different facts, and the dynamic that reads tilt falls back to its declared value for the first and
    //    reads zero for the second. Normalising an unreported axis to zero collapses the two.
    Axes.PressureReported = Arriving.Supplied.PressureReported;
    Axes.TiltReported     = Arriving.Supplied.TiltReported;
    Axes.RotationReported = Arriving.Supplied.RotationReported;

    Axes.Pressure = Arriving.Supplied.PressureReported ? BoundedUnit(Arriving.Pressure) : 0.0;

    if (Arriving.Supplied.TiltReported)
    {
        // 📐 The two reported tilt angles are one departure from the perpendicular, taken as their magnitude
        //    rather than as either alone. A dynamic reading one axis of a two-axis tilt responds to the
        //    direction the artist leans as well as to how far, which nobody expects of a tilt dynamic.
        const double Departure = std::sqrt(Arriving.TiltAlong  * Arriving.TiltAlong
                                         + Arriving.TiltAcross * Arriving.TiltAcross);

        Axes.Tilt = BoundedUnit(Departure / TiltReference);
    }

    if (Arriving.Supplied.RotationReported)
        Axes.Rotation = BoundedUnit(Arriving.Rotation / RotationReference);

    // 🔴 Speed and path distance are **derived** and are never absent — `58` §4. Speed comes from the domain
    //    distance divided by the elapsed **arrival** interval, which is why `04` §3 stamps at arrival: divided
    //    by a consumption interval it would report the display rate rather than the artist's hand.
    Axes.Speed        = BoundedUnit(Speed / SpeedReference);
    Axes.PathDistance = BoundedUnit(PathDistance / PathDistanceReference);

    return Axes;
}

void ImpressionSequence::Emit(double              PositionAlong,
                              double              PositionAcross,
                              double              TangentAlong,
                              double              TangentAcross,
                              const ResolvedAxes& Axes,
                              double              PathDistance)
{
    ImpressionSample Impressing;
    Impressing.ImpressionOrdinal = static_cast<std::uint32_t>(Sequenced.size());
    Impressing.PathDistance      = PathDistance;

    Impressing.Resolved = Brush.Resolve(Axes, Impressing.ImpressionOrdinal, Declared.StrokeSeed);

    // 🔴 `58` §3.1: path-relative rotation reads the tangent of the **resampled** path and never of the raw
    //    input. Raw input at a low sample rate produces a tangent that jitters at every reported position, and
    //    a shaped brush then flickers along a stroke the artist drew smoothly.
    if (Brush.Shape().Rotated == RotationSubject::PathRelative
     && (TangentAlong != 0.0 || TangentAcross != 0.0))
    {
        Impressing.Resolved.Rotation += std::atan2(TangentAcross, TangentAlong) * 180.0 / Pi;
    }

    // 📝 `58` §6's positional variation displaces the impression about the path. Applied here rather than in
    //    `58` because the path is this document's and the displacement is in domain units of it.
    Impressing.PositionAlong  = PositionAlong  + Impressing.Resolved.DisplacementAlong;
    Impressing.PositionAcross = PositionAcross + Impressing.Resolved.DisplacementAcross;

    Sequenced.push_back(Impressing);

    // 📝 The next impression's spacing is this one's, resolved. `58` §5 floors the relative spacing and `58`
    //    bounds the extent above zero, so the product is strictly positive and the walk below terminates.
    NextSpacing = Impressing.Resolved.Spacing * Impressing.Resolved.Extent;

    if (!(NextSpacing > 0.0))
        NextSpacing = ImpressionSpacingFloor * Brush.Extent();
}

Deliver<bool> ImpressionSequence::Amend(const StrokeArrival& Arriving)
{
    if (!OpenDeclared)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "no stroke is open" });

    // 🔴 The pointer left the surface. The path breaks here and the next resolved arrival begins a new segment
    //    rather than interpolating across the gap — a stroke that leaves an object and returns must not paint a
    //    line between the two places, and the artist cannot undo half a stroke to remove one.
    if (!Arriving.SurfaceResolved)
    {
        PathBroken      = true;
        PendingDistance = 0.0;

        return Deliver<bool>::Deliver(true);
    }

    if (Sequenced.size() >= ImpressionCeiling)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ExtentExhausted, "the stroke reached the declared impression ceiling" });
    }

    if (!PathBegun || PathBroken)
    {
        if (!PathBegun)
        {
            // 📝 The first impression has no preceding segment and therefore no tangent, so a path-relative
            //    rotation reads the brush's fixed angle for it alone. Withholding it until a tangent exists
            //    would mean a tap paints nothing, which is not what a tap means.
            const ResolvedAxes Axes = ProjectAxes(Arriving.Arriving, 0.0, 0.0, 0.0, 0.0);

            Emit(Arriving.PositionAlong, Arriving.PositionAcross, 0.0, 0.0, Axes, 0.0);

            PathBegun = true;
        }

        LastAlong       = Arriving.PositionAlong;
        LastAcross      = Arriving.PositionAcross;
        LastArrival     = Arriving.Arriving.Arrival;
        PendingDistance = 0.0;
        PathBroken      = false;

        return Deliver<bool>::Deliver(true);
    }

    const double SpanAlong  = Arriving.PositionAlong  - LastAlong;
    const double SpanAcross = Arriving.PositionAcross - LastAcross;
    const double SegmentSpan = std::sqrt(SpanAlong * SpanAlong + SpanAcross * SpanAcross);

    if (SegmentSpan <= 0.0)
    {
        // 📝 A stationary arrival advances nothing and is not an error. A stylus held still still reports, and
        //    emitting an impression for each report is how a held brush burns a hole where it rests.
        LastArrival = Arriving.Arriving.Arrival;

        return Deliver<bool>::Deliver(true);
    }

    const double TangentAlong  = SpanAlong  / SegmentSpan;
    const double TangentAcross = SpanAcross / SegmentSpan;

    // 🔴 `TickSequence::Span` reports milliseconds and reports zero for reversed operands, so a sample that
    //    arrived out of order yields no speed rather than a negative one. `04`'s ordering makes that unreachable;
    //    the guard is here because a speed of the wrong sign drives a dynamic off the end of its interval.
    const double ElapsedMilliseconds = TickSequence::Span(LastArrival, Arriving.Arriving.Arrival);
    const double Speed               = ElapsedMilliseconds > 0.0
                                     ? SegmentSpan / (ElapsedMilliseconds * 1.0e-3)
                                     : 0.0;

    double Walked = 0.0;

    // 🔴 The arrival is admitted a tolerance of one spacing, never compared exactly. `PendingDistance` and
    //    `Walked` are both accumulated sums and `NextSpacing` is a product of two resolved reals, so an exact
    //    comparison decides the last impression of the segment on the residue of the additions. A path of four
    //    tenths at a spacing of one fortieth is sixteen spacings by the geometry and 5.6e-17 short of sixteen in
    //    binary, so exactly one impression is withheld — and it is the one at the position the artist released.
    while (Sequenced.size() < ImpressionCeiling
        && PendingDistance + (SegmentSpan - Walked) >= NextSpacing * (1.0 - SpacingArrivalTolerance))
    {
        // 📝 The advance is the full spacing even where the tolerance admitted the step, so `Walked` tracks the
        //    impressions placed and not the tolerance spent. Advancing by the shortfall instead would let the
        //    tolerance accumulate across a long stroke into a real drift of the spacing.
        const double Advance = NextSpacing - PendingDistance;

        Walked += Advance;

        // 📝 The tolerance admits a step whose full advance runs marginally past the arrival, so the fraction is
        //    bounded at the arrival itself. An impression is placed where the artist released, never beyond it.
        const double Fraction = Walked < SegmentSpan ? Walked / SegmentSpan : 1.0;

        const double PositionAlong  = LastAlong  + SpanAlong  * Fraction;
        const double PositionAcross = LastAcross + SpanAcross * Fraction;
        const double PathDistance   = TravelledDistance + Walked;

        const ResolvedAxes Axes = ProjectAxes(Arriving.Arriving, TangentAlong, TangentAcross, Speed, PathDistance);

        Emit(PositionAlong, PositionAcross, TangentAlong, TangentAcross, Axes, PathDistance);

        PendingDistance = 0.0;
    }

    // 📝 Never negative, for the same reason the fraction is bounded — the last step may have consumed marginally
    //    more than the segment carried. A negative residue would advance the next segment's first impression.
    PendingDistance   += Walked < SegmentSpan ? SegmentSpan - Walked : 0.0;
    TravelledDistance += SegmentSpan;

    LastAlong   = Arriving.PositionAlong;
    LastAcross  = Arriving.PositionAcross;
    LastArrival = Arriving.Arriving.Arrival;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 IMPRESSION RESOLUTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> ImpressionSequence::ResolveOne(ImpressionSample& Impressing,
                                             SurfaceTileSpace& Residency,
                                             RequestQueue&     Requesting,
                                             std::uint64_t     RecordingOrdinal)
{
    const std::uint32_t CellsPerEdge  = CellsPerEdgeAt(Level);
    const std::uint32_t WorkingExtent = CellsPerEdge * CoverageTileTexels;

    const double Extent = Impressing.Resolved.Extent;
    const double Edge   = static_cast<double>(WorkingExtent);

    // 📐 The impression's domain extent, clamped into the unit square. `68` §5 packs every chart strictly inside
    //    the domain with a gap, so a clamp at the edge writes into an apron the artist cannot paint on rather
    //    than into a neighbouring chart's content.
    const double LeastAlong    = Impressing.PositionAlong  - Extent;
    const double LeastAcross   = Impressing.PositionAcross - Extent;
    const double GreatestAlong = Impressing.PositionAlong  + Extent;
    const double GreatestAcross = Impressing.PositionAcross + Extent;

    if (GreatestAlong <= 0.0 || GreatestAcross <= 0.0 || LeastAlong >= 1.0 || LeastAcross >= 1.0)
    {
        // 📝 Wholly outside the domain. Resolved rather than deferred, because no promotion will ever bring it
        //    inside and a deferral that can never clear is a stroke that can never seal.
        Impressing.ResolutionOwed = false;

        return Deliver<bool>::Deliver(true);
    }

    const std::uint32_t FirstCellAlong  = LeastAlong  <= 0.0 ? 0u
                                        : static_cast<std::uint32_t>(LeastAlong * CellsPerEdge);
    const std::uint32_t FirstCellAcross = LeastAcross <= 0.0 ? 0u
                                        : static_cast<std::uint32_t>(LeastAcross * CellsPerEdge);

    std::uint32_t LastCellAlong  = static_cast<std::uint32_t>(GreatestAlong  * CellsPerEdge);
    std::uint32_t LastCellAcross = static_cast<std::uint32_t>(GreatestAcross * CellsPerEdge);

    LastCellAlong  = LastCellAlong  >= CellsPerEdge ? CellsPerEdge - 1u : LastCellAlong;
    LastCellAcross = LastCellAcross >= CellsPerEdge ? CellsPerEdge - 1u : LastCellAcross;

    // 🔴 Residency is confirmed over **every** covered cell before a single texel is written. Writing what is
    //    resident and deferring the remainder would apply one impression twice — once now over part of its
    //    footprint and once later over the rest — and `StrokeSpace`'s `Over` accumulation would darken the
    //    overlap, which is the exact defect `22` §3 accumulates once to avoid.
    for (std::uint32_t Across = FirstCellAcross; Across <= LastCellAcross; ++Across)
    {
        for (std::uint32_t Along = FirstCellAlong; Along <= LastCellAlong; ++Along)
        {
            const double SampleAlong  = (static_cast<double>(Along)  + 0.5) / static_cast<double>(CellsPerEdge);
            const double SampleAcross = (static_cast<double>(Across) + 0.5) / static_cast<double>(CellsPerEdge);

            const Deliver<SampledCell> Sampled =
                Residency.Sample(Level, SampleAlong, SampleAcross, RecordingOrdinal, Requesting);

            if (!Sampled.ContentPresent)
                return Deliver<bool>::Refuse(Sampled.Declined);

            // 🔴 `22` §2's rule, and the one comparison that carries it. `Sample` has already recorded the demand
            //    for the level that was wanted; a resolved level coarser than the painting level means the cell
            //    is not resident **here**, and the impression waits rather than painting at the wrong extent.
            // ⚠️ A speculative extent skips the wait entirely — `22` §4.1. Nothing speculative is authored, so
            //    nothing speculative can be permanently wrong, and a preview that waited for residency would
            //    show the artist nothing exactly while they were deciding.
            if (!Declared.Speculative && Sampled.Resolve().ResolvedLevel != Level)
                return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "the cell is not resident here" });
        }
    }

    // 📐 The texel footprint, half-open and clamped. Texel (i, j) centres at ((i + ½)/W, (j + ½)/W), so the
    //    first texel whose centre can fall inside the impression is the floor of its least bound times the
    //    extent, and the last is the ceiling of its greatest.
    std::int64_t FirstTexelAlong  = static_cast<std::int64_t>(std::floor(LeastAlong    * Edge));
    std::int64_t FirstTexelAcross = static_cast<std::int64_t>(std::floor(LeastAcross   * Edge));
    std::int64_t LastTexelAlong   = static_cast<std::int64_t>(std::ceil (GreatestAlong  * Edge));
    std::int64_t LastTexelAcross  = static_cast<std::int64_t>(std::ceil (GreatestAcross * Edge));

    FirstTexelAlong  = FirstTexelAlong  < 0 ? 0 : FirstTexelAlong;
    FirstTexelAcross = FirstTexelAcross < 0 ? 0 : FirstTexelAcross;
    LastTexelAlong   = LastTexelAlong   > static_cast<std::int64_t>(WorkingExtent)
                     ? static_cast<std::int64_t>(WorkingExtent) : LastTexelAlong;
    LastTexelAcross  = LastTexelAcross  > static_cast<std::int64_t>(WorkingExtent)
                     ? static_cast<std::int64_t>(WorkingExtent) : LastTexelAcross;

    const double Reciprocal = Extent > 0.0 ? 1.0 / Extent : 0.0;

    for (std::int64_t Across = FirstTexelAcross; Across < LastTexelAcross; ++Across)
    {
        const double CentreAcross = (static_cast<double>(Across) + 0.5) / Edge;
        const double SpanAcross   = (CentreAcross - Impressing.PositionAcross) * Reciprocal;

        if (SpanAcross <= -1.0 || SpanAcross >= 1.0)
            continue;

        for (std::int64_t Along = FirstTexelAlong; Along < LastTexelAlong; ++Along)
        {
            const double CentreAlong = (static_cast<double>(Along) + 0.5) / Edge;
            const double SpanAlong   = (CentreAlong - Impressing.PositionAlong) * Reciprocal;

            const double RadiusSquared = SpanAlong * SpanAlong + SpanAcross * SpanAcross;

            if (RadiusSquared >= 1.0)
                continue;

            // 📝 An analytic profile is rotationally symmetric, so the impression's resolved rotation is carried
            //    and not read here. It is carried anyway because `58` §3.1 declares it per impression and the
            //    imagery and outline sources will read it the moment `50` and `52` intake exists.
            const double Coverage = ProfileCoverage(Brush.Shape().Profile, std::sqrt(RadiusSquared))
                                  * Impressing.Resolved.CoverageStrength;

            if (Coverage <= 0.0)
                continue;

            const std::uint32_t CellAlong  = static_cast<std::uint32_t>(Along)  / CoverageTileTexels;
            const std::uint32_t CellAcross = static_cast<std::uint32_t>(Across) / CoverageTileTexels;

            CellAddress Addressed;
            Addressed.Level  = Level;
            Addressed.Along  = CellAlong;
            Addressed.Across = CellAcross;

            const Deliver<std::uint32_t> CellOrdinal = OrdinalOf(Addressed);

            if (!CellOrdinal.ContentPresent)
                continue;

            const Deliver<std::uint32_t> TileOrdinal = Accumulated.Claim(CellOrdinal.Resolve());

            if (!TileOrdinal.ContentPresent)
                return Deliver<bool>::Refuse(TileOrdinal.Declined);

            // 🔴 `20` §5's gate, declared per cell as the stroke first touches it and withdrawn at Seal. No tile
            //    holding uncommitted paint is evicted; without it the artist's own stroke is the pressure that
            //    evicts the tile it is being painted into.
            // ⚠️ A speculative extent never declares it — `22` §4.1. A brush preview that pinned every tile the
            //    cursor passed over would exhaust residency while the artist painted nothing.
            if (!Declared.Speculative)
                Disregard(Residency.DeclareUncommitted(CellOrdinal.Resolve(), true));

            Accumulated.Accumulate(TileOrdinal.Resolve(),
                                   static_cast<std::uint32_t>(Along)  % CoverageTileTexels,
                                   static_cast<std::uint32_t>(Across) % CoverageTileTexels,
                                   Coverage);
        }
    }

    Impressing.ResolutionOwed = false;

    return Deliver<bool>::Deliver(true);
}

Deliver<ResolvedRun> ImpressionSequence::Resolve(SurfaceTileSpace& Residency,
                                                 RequestQueue&     Requesting,
                                                 std::uint64_t     RecordingOrdinal)
{
    if (!OpenDeclared)
        return Deliver<ResolvedRun>::Refuse({ RefusalReason::HostDenied, "no stroke is open" });

    ResolvedRun Ran;

    // 🔴 Walked in stroke order and **not** stopped at the first deferral. `StrokeSpace` accumulates by `Over`,
    //    which is symmetric in its operands, so an impression that resolves two rotations after its neighbours
    //    lands exactly where it would have — and the artist sees most of a stroke immediately rather than none
    //    of it while one leaf tile promotes.
    for (ImpressionSample& Impressing : Sequenced)
    {
        if (!Impressing.ResolutionOwed)
            continue;

        const Deliver<bool> Resolved = ResolveOne(Impressing, Residency, Requesting, RecordingOrdinal);

        if (Resolved.ContentPresent)
        {
            ++Ran.ResolvedCount;
            ++ResolvedTotal;
            continue;
        }

        if (Resolved.Declined.DeclaredReason != RefusalReason::ExtentExhausted)
            return Deliver<ResolvedRun>::Refuse(Resolved.Declined);

        ++Ran.DeferredCount;
        ++Ran.PendingCount;
    }

    return Deliver<ResolvedRun>::Deliver(Ran);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  ABANDON AND RECLAIM
//------------------------------------------------------------------------------------------------------------------------

void ImpressionSequence::Abandon(SurfaceTileSpace& Residency)
{
    if (!OpenDeclared)
        return;

    if (!Declared.Speculative)
    {
        for (const std::uint32_t CellOrdinal : Accumulated.TouchedCells())
            Disregard(Residency.DeclareUncommitted(CellOrdinal, false));
    }

    Accumulated.Reclaim();
    Sequenced.clear();

    OpenDeclared = false;
    PathBegun    = false;
    PathBroken   = false;
}

Deliver<bool> ImpressionSequence::ReclaimSpeculative()
{
    if (!OpenDeclared)
        return Deliver<bool>::Refuse({ RefusalReason::HostDenied, "no stroke is open" });

    if (!Declared.Speculative)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::HostDenied, "a committed stroke's accumulation is the only record of it" });
    }

    Accumulated.Reclaim();

    for (ImpressionSample& Impressing : Sequenced)
        Impressing.ResolutionOwed = true;

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      SEALING
//------------------------------------------------------------------------------------------------------------------------

Deliver<SealedStroke> ImpressionSequence::Seal(SurfaceLayerSequence& Content,
                                               RevisionSequence&     Revised,
                                               SurfaceTileSpace&     Residency,
                                               std::uint64_t         SealedAt)
{
    if (!OpenDeclared)
        return Deliver<SealedStroke>::Refuse({ RefusalReason::HostDenied, "no stroke is open" });

    // 🔴 `22` §4.1: a speculative extent never commits. A Seal that quietly succeeded for one would put a brush
    //    preview into `RevisionSequence`, and the artist would undo a stroke they never made.
    if (Declared.Speculative)
    {
        return Deliver<SealedStroke>::Refuse(
            { RefusalReason::HostDenied, "a speculative extent never enters the revision sequence" });
    }

    const Deliver<PaintedContent*> Amending = Content.AmendPainted(Declared.Subject);

    if (!Amending.ContentPresent)
        return Deliver<SealedStroke>::Refuse(Amending.Declined);

    PaintedContent& Painted = *Amending.Resolve();

    if (Painted.ExtentTexels != Declared.WorkingExtent || Painted.ComponentCount != Declared.ComponentCount)
    {
        return Deliver<SealedStroke>::Refuse(
            { RefusalReason::ContentUnsupported, "the entry's extent no longer matches the stroke's" });
    }

    // 🔴 One transaction, opened here and sealed once — `10` §2.4 and `22` §4. Every channel the brush declared
    //    is written inside it, so `22` §5's multi-channel stroke undoes as the single thing the artist did.
    const Deliver<bool> Opened = Revised.Open("", "PaintStroke");

    if (!Opened.ContentPresent)
        return Deliver<SealedStroke>::Refuse(Opened.Declined);

    SealedStroke Sealing;
    Sealing.TouchedCells    = Accumulated.TouchedCells();
    Sealing.Recorded        = Recorded;
    Sealing.Subject         = Declared.Subject;
    Sealing.PaintingLevel   = Level;
    Sealing.ComponentCount  = Declared.ComponentCount;
    Sealing.ImpressionCount = static_cast<std::uint32_t>(Sequenced.size());

    const std::size_t TileTexels = static_cast<std::size_t>(CoverageTileTexels) * CoverageTileTexels;

    Sealing.PriorTexels.assign(Sealing.TouchedCells.size() * TileTexels * Declared.ComponentCount, 0.0f);

    const std::size_t Stride = static_cast<std::size_t>(Declared.ComponentCount);

    for (std::size_t Passed = 0u; Passed < Sealing.TouchedCells.size(); ++Passed)
    {
        const std::uint32_t CellOrdinal = Sealing.TouchedCells[Passed];

        const Deliver<CellAddress>   Addressed   = AddressOf(CellOrdinal);
        const Deliver<std::uint32_t> TileOrdinal = Accumulated.Located(CellOrdinal);

        if (!Addressed.ContentPresent || !TileOrdinal.ContentPresent)
            continue;

        const std::uint32_t OriginAlong  = Addressed.Resolve().Along  * CoverageTileTexels;
        const std::uint32_t OriginAcross = Addressed.Resolve().Across * CoverageTileTexels;

        for (std::uint32_t Across = 0u; Across < CoverageTileTexels; ++Across)
        {
            for (std::uint32_t Along = 0u; Along < CoverageTileTexels; ++Along)
            {
                const std::size_t Reading = (static_cast<std::size_t>(OriginAcross + Across) * Painted.ExtentTexels
                                           + (OriginAlong + Along)) * Stride;

                const std::size_t Writing = ((Passed * TileTexels)
                                           + static_cast<std::size_t>(Across) * CoverageTileTexels + Along) * Stride;

                // 📝 The prior tile is recorded whole, before anything is written into it. Recording only the
                //    covered texels would need a mask, and at any realistic coverage the mask costs more than
                //    the texels it excludes.
                for (std::size_t Component = 0u; Component < Stride; ++Component)
                    Sealing.PriorTexels[Writing + Component] = Painted.Texels[Reading + Component];

                const double Coverage = Accumulated.Coverage(TileOrdinal.Resolve(), Along, Across);

                if (Coverage <= 0.0)
                    continue;

                // 🔴 The accumulated coverage is applied **once**, with the brush's declared combination — `22`
                //    §3. Applying per impression is what lets two overlapping impressions of one stroke
                //    double-darken at their intersection, which is visible wherever the artist slowed down.
                for (const BrushChannelValue& Writing_ : Brush.Channels())
                {
                    for (const ChannelPlacement& Placing : Declared.Placements)
                    {
                        if (Placing.Channel != Writing_.Channel)
                            continue;

                        if (Writing_.ColourDeclared)
                        {
                            const double Arriving[3] =
                            {
                                Writing_.ColourValue.RedCoordinate,
                                Writing_.ColourValue.GreenCoordinate,
                                Writing_.ColourValue.BlueCoordinate
                            };

                            for (std::uint32_t Component = 0u; Component < 3u; ++Component)
                            {
                                const std::size_t Slot = Reading + Placing.ComponentOrdinal + Component;

                                Painted.Texels[Slot] = static_cast<float>(
                                    CombineValue(Combination,
                                                 static_cast<double>(Painted.Texels[Slot]),
                                                 Arriving[Component],
                                                 Coverage));
                            }
                        }
                        else
                        {
                            const std::size_t Slot = Reading + Placing.ComponentOrdinal;

                            Painted.Texels[Slot] = static_cast<float>(
                                CombineValue(Combination,
                                             static_cast<double>(Painted.Texels[Slot]),
                                             Writing_.ScalarValue,
                                             Coverage));
                        }

                        break;
                    }
                }
            }
        }

        // 🔴 Withdrawn here rather than after the transaction seals. `20` §5: at this point the paint is in `56`
        //    and the tile is a projection of it again, so the tile is evictable and re-resolvable — holding the
        //    gate open past the write would pin tiles for a stroke that has already committed.
        Disregard(Residency.DeclareUncommitted(CellOrdinal, false));
    }

    const Deliver<bool> Committed = Revised.Seal(SealedAt, false);

    if (!Committed.ContentPresent)
        return Deliver<SealedStroke>::Refuse(Committed.Declined);

    Accumulated.Reclaim();
    Sequenced.clear();

    OpenDeclared = false;
    PathBegun    = false;
    PathBroken   = false;

    return Deliver<SealedStroke>::Deliver(Sealing);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE INVERSE
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> Restore(const SealedStroke& Sealed, SurfaceLayerSequence& Content)
{
    const Deliver<PaintedContent*> Amending = Content.AmendPainted(Sealed.Subject);

    if (!Amending.ContentPresent)
        return Deliver<bool>::Refuse(Amending.Declined);

    PaintedContent& Painted = *Amending.Resolve();

    const std::uint32_t WorkingExtent = CellsPerEdgeAt(Sealed.PaintingLevel) * CoverageTileTexels;

    if (Painted.ExtentTexels != WorkingExtent || Painted.ComponentCount != Sealed.ComponentCount)
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::ContentUnsupported, "the entry's extent no longer matches the recorded inverse" });
    }

    const std::size_t TileTexels = static_cast<std::size_t>(CoverageTileTexels) * CoverageTileTexels;
    const std::size_t Stride     = static_cast<std::size_t>(Sealed.ComponentCount);

    if (Sealed.PriorTexels.size() != Sealed.TouchedCells.size() * TileTexels * Stride)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "the recorded inverse is not whole" });

    for (std::size_t Passed = 0u; Passed < Sealed.TouchedCells.size(); ++Passed)
    {
        const Deliver<CellAddress> Addressed = AddressOf(Sealed.TouchedCells[Passed]);

        if (!Addressed.ContentPresent || Addressed.Resolve().Level != Sealed.PaintingLevel)
        {
            return Deliver<bool>::Refuse(
                { RefusalReason::ContentUnsupported, "a recorded cell does not address the recorded level" });
        }

        const std::uint32_t OriginAlong  = Addressed.Resolve().Along  * CoverageTileTexels;
        const std::uint32_t OriginAcross = Addressed.Resolve().Across * CoverageTileTexels;

        for (std::uint32_t Across = 0u; Across < CoverageTileTexels; ++Across)
        {
            for (std::uint32_t Along = 0u; Along < CoverageTileTexels; ++Along)
            {
                const std::size_t Writing = (static_cast<std::size_t>(OriginAcross + Across) * WorkingExtent
                                           + (OriginAlong + Along)) * Stride;

                const std::size_t Reading = ((Passed * TileTexels)
                                           + static_cast<std::size_t>(Across) * CoverageTileTexels + Along) * Stride;

                for (std::size_t Component = 0u; Component < Stride; ++Component)
                    Painted.Texels[Writing + Component] = Sealed.PriorTexels[Reading + Component];
            }
        }
    }

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

const std::vector<ImpressionSample>& ImpressionSequence::Impressions() const  { return Sequenced;   }
const StrokeSpace&                   ImpressionSequence::Accumulation() const { return Accumulated; }

std::uint32_t ImpressionSequence::ImpressionCount() const
{
    return static_cast<std::uint32_t>(Sequenced.size());
}

std::uint32_t ImpressionSequence::PendingCount() const
{
    std::uint32_t Pending = 0u;

    for (const ImpressionSample& Held : Sequenced)
    {
        if (Held.ResolutionOwed)
            ++Pending;
    }

    return Pending;
}

std::uint32_t ImpressionSequence::PaintingLevel() const        { return Level;               }
double        ImpressionSequence::PathLength() const           { return TravelledDistance;   }
bool          ImpressionSequence::StrokeOpen() const           { return OpenDeclared;        }
bool          ImpressionSequence::SpeculativeDeclared() const  { return Declared.Speculative; }

}   // namespace Slate
