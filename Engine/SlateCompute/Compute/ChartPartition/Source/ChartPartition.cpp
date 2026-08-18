//============================================================================================================================================
//                                                          CHARTPARTITION.CPP
//============================================================================================================================================
// 🧩 Seam-bounded flood fill, boundary chaining, exact fold classification, and subdivision that terminates.

#include "SlateCompute/Compute/ChartPartition/Api/ChartPartition.h"

#include "Shared/IntersectionClassifier.slang.h"
#include "Shared/OrientationClassifier.slang.h"

#include <cmath>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      EDGE KEYS
//------------------------------------------------------------------------------------------------------------------------

namespace
{

constexpr std::uint32_t AbsentFace = 0xFFFFFFFFu;   // [-] - no face; never a valid ordinal

// 📝 A welded edge as one ordinal, least position in the high half. Seam matching is over welded positions and
//    not over imported vertices, because a format storing a coordinate per corner has already split every
//    vertex at a coordinate seam — and a seam test that missed those would cut the surface at every one of them.
std::uint64_t EdgeKey(std::uint32_t FirstPosition, std::uint32_t SecondPosition)
{
    const std::uint64_t Least    = FirstPosition < SecondPosition ? FirstPosition  : SecondPosition;
    const std::uint64_t Greatest = FirstPosition < SecondPosition ? SecondPosition : FirstPosition;

    return (Least << 32) | Greatest;
}

bool KeyHeld(const std::vector<std::uint64_t>& Keys, std::uint64_t Sought)
{
    for (const std::uint64_t Held : Keys)
    {
        if (Held == Sought)
            return true;
    }

    return false;
}

// 📝 One chart under consideration. The attempt count bounds the subdivision so a pathological topology cannot
//    make the derivation unbounded; the termination argument below makes the bound a formality rather than a
//    silent truncation.
struct PendingChart
{
    std::vector<std::uint32_t>  Faces    = {};   // [-] - imported face ordinals
    std::uint32_t               Attempts = 0u;   // [-] - subdivisions this lineage has already cost
};

// 📝 One chart's local vertex numbering, its triangulation, and the corners that read it back.
struct ChartLocality
{
    std::vector<DocumentPosition>  Positions       = {};   // [mm] - chart-local
    std::vector<std::uint32_t>     TriangleCorners = {};   // [-]  - three per triangle, chart-local
    std::vector<std::uint32_t>     Corners         = {};   // [-]  - imported corner ordinals
    std::vector<std::uint32_t>     CornerLocals    = {};   // [-]  - parallel; chart-local ordinal per corner
    std::vector<std::uint32_t>     BoundaryLoop    = {};   // [-]  - ordered, chart-local
    std::uint32_t                  LoopCount       = 0u;   // [-]  - boundary loops chained
};

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                    CHART LOCALITY
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📝 Chart-local vertices are keyed by **welded position**, so two corners of one welded position inside one
//    chart share a domain position while the same welded position on the other side of a seam gets its own.
//    That is the entire mechanism by which a seam becomes a discontinuity in the domain and nowhere else.
ChartLocality BuildLocality(const TopologyStructure&           Imported,
                            const TopologyConditioning&        Conditioned,
                            const std::vector<std::uint32_t>&  Faces,
                            const std::vector<std::uint32_t>&  FaceOfEachFace,
                            const std::vector<std::uint64_t>&  SeamKeys,
                            std::vector<std::uint32_t>&        LocalOfWelded,
                            std::vector<std::uint32_t>&        StampOfWelded,
                            std::uint32_t                      Stamp)
{
    ChartLocality Built;

    for (const std::uint32_t FaceOrdinal : Faces)
    {
        const std::uint32_t FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);
        const std::uint32_t CornerSpan  = Imported.FaceCornerCount(FaceOrdinal);

        for (std::uint32_t Passed = 0u; Passed < CornerSpan; ++Passed)
        {
            const std::uint32_t CornerOrdinal = FirstCorner + Passed;
            const std::uint32_t Welded        =
                Conditioned.WeldedPosition(Imported.CornerVertex(CornerOrdinal)).Resolve();

            if (StampOfWelded[Welded] != Stamp)
            {
                StampOfWelded[Welded] = Stamp;
                LocalOfWelded[Welded] = static_cast<std::uint32_t>(Built.Positions.size());
                Built.Positions.push_back(Imported.Positions()[Imported.CornerVertex(CornerOrdinal)]);
            }

            Built.Corners.push_back(CornerOrdinal);
            Built.CornerLocals.push_back(LocalOfWelded[Welded]);
        }
    }

    // 📝 Fan-triangulated from each face's first corner, matching `38` §4 and `40`'s intersection. Two
    //    triangulations of one n-gon flatten its interior differently along the diagonal, and the tangent basis
    //    and the picking would then disagree about which side of a quad a position is on.
    std::size_t CornerWalk = 0u;

    for (const std::uint32_t FaceOrdinal : Faces)
    {
        const std::uint32_t CornerSpan = Imported.FaceCornerCount(FaceOrdinal);

        for (std::uint32_t Fan = 1u; Fan + 1u < CornerSpan; ++Fan)
        {
            Built.TriangleCorners.push_back(Built.CornerLocals[CornerWalk]);
            Built.TriangleCorners.push_back(Built.CornerLocals[CornerWalk + Fan]);
            Built.TriangleCorners.push_back(Built.CornerLocals[CornerWalk + Fan + 1u]);
        }

        CornerWalk += CornerSpan;
    }

    // 📐 A directed boundary edge is one whose opposite face is absent, sits in another chart, or is cut by a
    //    seam. Chaining the directed edges gives the loops; a chart that is a disc has exactly one.
    std::vector<std::uint32_t> Opening;
    std::vector<std::uint32_t> Closing;

    CornerWalk = 0u;

    for (const std::uint32_t FaceOrdinal : Faces)
    {
        const std::uint32_t FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);
        const std::uint32_t CornerSpan  = Imported.FaceCornerCount(FaceOrdinal);

        for (std::uint32_t Passed = 0u; Passed < CornerSpan; ++Passed)
        {
            const std::uint32_t CornerOrdinal = FirstCorner + Passed;
            const std::uint32_t Following     = FirstCorner + (Passed + 1u) % CornerSpan;

            const std::uint32_t OpeningWelded =
                Conditioned.WeldedPosition(Imported.CornerVertex(CornerOrdinal)).Resolve();
            const std::uint32_t ClosingWelded =
                Conditioned.WeldedPosition(Imported.CornerVertex(Following)).Resolve();

            bool BoundaryHere = KeyHeld(SeamKeys, EdgeKey(OpeningWelded, ClosingWelded));

            if (!BoundaryHere)
            {
                const Deliver<std::uint32_t> Adjacent = Conditioned.AdjacentCorner(CornerOrdinal);

                if (!Adjacent.ContentPresent)
                    BoundaryHere = true;
                else
                    BoundaryHere = FaceOfEachFace[Imported.CornerFace(Adjacent.Resolve())] != FaceOfEachFace[FaceOrdinal];
            }

            if (BoundaryHere)
            {
                Opening.push_back(LocalOfWelded[OpeningWelded]);
                Closing.push_back(LocalOfWelded[ClosingWelded]);
            }
        }

        CornerWalk += CornerSpan;
    }

    std::vector<bool> Walked(Opening.size(), false);

    for (std::size_t Ordinal = 0u; Ordinal < Opening.size(); ++Ordinal)
    {
        if (Walked[Ordinal])
            continue;

        ++Built.LoopCount;

        std::vector<std::uint32_t> Loop;

        std::size_t Walking = Ordinal;

        for (std::size_t Passed = 0u; Passed <= Opening.size(); ++Passed)
        {
            if (Walked[Walking])
                break;

            Walked[Walking] = true;
            Loop.push_back(Opening[Walking]);

            const std::uint32_t Sought = Closing[Walking];

            std::size_t Following = Opening.size();

            for (std::size_t Candidate = 0u; Candidate < Opening.size(); ++Candidate)
            {
                if (!Walked[Candidate] && Opening[Candidate] == Sought)
                {
                    Following = Candidate;
                    break;
                }
            }

            if (Following == Opening.size())
                break;

            Walking = Following;
        }

        // 📝 The longest loop is the outer boundary. A chart with more than one is not a disc and is subdivided
        //    by the caller rather than flattened against whichever loop happened to be chained first.
        if (Loop.size() > Built.BoundaryLoop.size())
            Built.BoundaryLoop = Loop;
    }

    return Built;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FOLD DETECTION
//------------------------------------------------------------------------------------------------------------------------

// 🔴 `68` §4.1: a fold maps two topology positions to one domain position, so painting one paints both. It is a
//    **failure** and not a distortion value, which is why it is classified exactly rather than measured.
bool FoldDetected(const ChartLocality& Local, const std::vector<PlanarPosition>& Flattened)
{
    Signed32 Declared = 0;

    const std::size_t TriangleSpan = Local.TriangleCorners.size() / 3u;

    for (std::size_t TriangleOrdinal = 0u; TriangleOrdinal < TriangleSpan; ++TriangleOrdinal)
    {
        const PlanarPosition& Alpha = Flattened[Local.TriangleCorners[TriangleOrdinal * 3u]];
        const PlanarPosition& Beta  = Flattened[Local.TriangleCorners[TriangleOrdinal * 3u + 1u]];
        const PlanarPosition& Gamma = Flattened[Local.TriangleCorners[TriangleOrdinal * 3u + 2u]];

        const Signed32 Winding = ClassifyOrientation(Alpha.PositionX, Alpha.PositionY,
                                                     Beta.PositionX,  Beta.PositionY,
                                                     Gamma.PositionX, Gamma.PositionY);

        if (Winding == 0)
            continue;

        if (Declared == 0)
            Declared = Winding;
        else if (Winding != Declared)
            return true;
    }

    // 📐 Consistent winding does not exclude a boundary that crosses itself, so the boundary is tested too.
    //    `02` §4's exact classification decides it: an approximate overlap test finds folds sometimes, which is
    //    worse than not testing, because the failures that survive are the subtle ones.
    const std::size_t LoopSpan = Local.BoundaryLoop.size();

    for (std::size_t Earlier = 0u; Earlier + 1u < LoopSpan; ++Earlier)
    {
        const PlanarPosition& AlphaFirst  = Flattened[Local.BoundaryLoop[Earlier]];
        const PlanarPosition& AlphaSecond = Flattened[Local.BoundaryLoop[(Earlier + 1u) % LoopSpan]];

        for (std::size_t Later = Earlier + 2u; Later < LoopSpan; ++Later)
        {
            if (Earlier == 0u && Later + 1u == LoopSpan)
                continue;

            const PlanarPosition& BetaFirst  = Flattened[Local.BoundaryLoop[Later]];
            const PlanarPosition& BetaSecond = Flattened[Local.BoundaryLoop[(Later + 1u) % LoopSpan]];

            if (ClassifySegmentIntersection(AlphaFirst.PositionX,  AlphaFirst.PositionY,
                                            AlphaSecond.PositionX, AlphaSecond.PositionY,
                                            BetaFirst.PositionX,   BetaFirst.PositionY,
                                            BetaSecond.PositionX,  BetaSecond.PositionY)
             == SlateIntersectionCrossing)
            {
                return true;
            }
        }
    }

    return false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     SUBDIVISION
//------------------------------------------------------------------------------------------------------------------------

// 📝 The chart is split by the widest spatial axis of its face centroids, at the median. Deterministic, and it
//    strictly reduces the face count on both sides — which is what makes the whole derivation terminate.
void Subdivide(const TopologyStructure&           Imported,
               const std::vector<std::uint32_t>&  Faces,
               std::vector<std::uint32_t>&        FirstHalf,
               std::vector<std::uint32_t>&        SecondHalf)
{
    std::vector<double> CentroidX(Faces.size(), 0.0);
    std::vector<double> CentroidY(Faces.size(), 0.0);
    std::vector<double> CentroidZ(Faces.size(), 0.0);

    double LeastX = 0.0, GreatestX = 0.0, LeastY = 0.0, GreatestY = 0.0, LeastZ = 0.0, GreatestZ = 0.0;

    for (std::size_t Ordinal = 0u; Ordinal < Faces.size(); ++Ordinal)
    {
        const std::uint32_t FaceOrdinal = Faces[Ordinal];
        const std::uint32_t FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);
        const std::uint32_t CornerSpan  = Imported.FaceCornerCount(FaceOrdinal);

        for (std::uint32_t Passed = 0u; Passed < CornerSpan; ++Passed)
        {
            const DocumentPosition& Held = Imported.Positions()[Imported.CornerVertex(FirstCorner + Passed)];

            CentroidX[Ordinal] += Held.PositionX;
            CentroidY[Ordinal] += Held.PositionY;
            CentroidZ[Ordinal] += Held.PositionZ;
        }

        CentroidX[Ordinal] /= static_cast<double>(CornerSpan);
        CentroidY[Ordinal] /= static_cast<double>(CornerSpan);
        CentroidZ[Ordinal] /= static_cast<double>(CornerSpan);

        if (Ordinal == 0u)
        {
            LeastX = GreatestX = CentroidX[0];
            LeastY = GreatestY = CentroidY[0];
            LeastZ = GreatestZ = CentroidZ[0];
            continue;
        }

        LeastX    = CentroidX[Ordinal] < LeastX    ? CentroidX[Ordinal] : LeastX;
        GreatestX = CentroidX[Ordinal] > GreatestX ? CentroidX[Ordinal] : GreatestX;
        LeastY    = CentroidY[Ordinal] < LeastY    ? CentroidY[Ordinal] : LeastY;
        GreatestY = CentroidY[Ordinal] > GreatestY ? CentroidY[Ordinal] : GreatestY;
        LeastZ    = CentroidZ[Ordinal] < LeastZ    ? CentroidZ[Ordinal] : LeastZ;
        GreatestZ = CentroidZ[Ordinal] > GreatestZ ? CentroidZ[Ordinal] : GreatestZ;
    }

    const double SpanX = GreatestX - LeastX;
    const double SpanY = GreatestY - LeastY;
    const double SpanZ = GreatestZ - LeastZ;

    const std::vector<double>* Measured = &CentroidX;
    double                     Middle   = (LeastX + GreatestX) * 0.5;

    if (SpanY >= SpanX && SpanY >= SpanZ)
    {
        Measured = &CentroidY;
        Middle   = (LeastY + GreatestY) * 0.5;
    }
    else if (SpanZ >= SpanX && SpanZ >= SpanY)
    {
        Measured = &CentroidZ;
        Middle   = (LeastZ + GreatestZ) * 0.5;
    }

    for (std::size_t Ordinal = 0u; Ordinal < Faces.size(); ++Ordinal)
    {
        if ((*Measured)[Ordinal] < Middle)
            FirstHalf.push_back(Faces[Ordinal]);
        else
            SecondHalf.push_back(Faces[Ordinal]);
    }

    // 📝 A degenerate split — every centroid on one side — is broken by ordinal so the recursion still shrinks.
    //    Coincident faces are the case that produces it, and they are exactly the case `38` §3 enrols.
    if (FirstHalf.empty() || SecondHalf.empty())
    {
        FirstHalf.clear();
        SecondHalf.clear();

        for (std::size_t Ordinal = 0u; Ordinal < Faces.size(); ++Ordinal)
        {
            if (Ordinal * 2u < Faces.size())
                FirstHalf.push_back(Faces[Ordinal]);
            else
                SecondHalf.push_back(Faces[Ordinal]);
        }
    }
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE DERIVATION
//------------------------------------------------------------------------------------------------------------------------

Deliver<DerivedPartition> Derive(const TopologyStructure&      Imported,
                                 const TopologyConditioning&   Conditioned,
                                 const SeamSpecification&      Seams,
                                 const PartitionSpecification& Declaring,
                                 const WorkCancellation&       Cancellation,
                                 WorkProgress&                 Progressed)
{
    if (!Imported.Sealed())
    {
        return Deliver<DerivedPartition>::Refuse(
            { RefusalReason::HostDenied, "an unsealed topology is not immutable for the run" });
    }

    if (Conditioned.ConditionedRevision() != Imported.Revision())
    {
        return Deliver<DerivedPartition>::Refuse(
            { RefusalReason::ExtentExhausted, "the conditioning describes another topology revision" });
    }

    DerivedPartition Produced;
    Produced.DescribedRevision = Imported.Revision();
    Produced.CornerCoordinates.assign(Imported.CornerCount(), DomainCoordinate{});

    // 📝 The authored seams are translated to welded pairs once. Derived seams extend the same set as they are
    //    added, so a subdivision made on one pass is respected by the flood fill of the next.
    std::vector<std::uint64_t> SeamKeys;

    for (const SeamEdge& Authored : Seams.Authored())
    {
        const Deliver<std::uint32_t> LeastWelded    = Conditioned.WeldedPosition(Authored.LeastVertex);
        const Deliver<std::uint32_t> GreatestWelded = Conditioned.WeldedPosition(Authored.GreatestVertex);

        if (LeastWelded.ContentPresent && GreatestWelded.ContentPresent)
            SeamKeys.push_back(EdgeKey(LeastWelded.Resolve(), GreatestWelded.Resolve()));
    }

    // 📐 Flood fill over faces across non-seam, manifold adjacency. Every polygon lands in exactly one chart,
    //    which is `68` §3's coverage requirement stated as an algorithm rather than as a hope.
    const std::uint32_t FaceSpan = Imported.FaceCount();

    if (FaceSpan == 0u)
        return Deliver<DerivedPartition>::Refuse({ RefusalReason::ExtentExhausted, "the topology carries no face" });

    std::vector<std::uint32_t> ChartOfFace(FaceSpan, AbsentFace);
    std::vector<PendingChart>  Pending;

    for (std::uint32_t Seed = 0u; Seed < FaceSpan; ++Seed)
    {
        if (ChartOfFace[Seed] != AbsentFace)
            continue;

        const std::uint32_t ChartOrdinal = static_cast<std::uint32_t>(Pending.size());

        PendingChart Growing;

        std::vector<std::uint32_t> Frontier;
        Frontier.push_back(Seed);
        ChartOfFace[Seed] = ChartOrdinal;

        while (!Frontier.empty())
        {
            const std::uint32_t FaceOrdinal = Frontier.back();
            Frontier.pop_back();

            Growing.Faces.push_back(FaceOrdinal);

            const std::uint32_t FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);
            const std::uint32_t CornerSpan  = Imported.FaceCornerCount(FaceOrdinal);

            for (std::uint32_t Passed = 0u; Passed < CornerSpan; ++Passed)
            {
                const std::uint32_t CornerOrdinal = FirstCorner + Passed;
                const std::uint32_t Following     = FirstCorner + (Passed + 1u) % CornerSpan;

                const std::uint32_t OpeningWelded =
                    Conditioned.WeldedPosition(Imported.CornerVertex(CornerOrdinal)).Resolve();
                const std::uint32_t ClosingWelded =
                    Conditioned.WeldedPosition(Imported.CornerVertex(Following)).Resolve();

                if (KeyHeld(SeamKeys, EdgeKey(OpeningWelded, ClosingWelded)))
                    continue;

                const Deliver<std::uint32_t> Adjacent = Conditioned.AdjacentCorner(CornerOrdinal);

                if (!Adjacent.ContentPresent)
                    continue;

                const std::uint32_t AdjacentFace = Imported.CornerFace(Adjacent.Resolve());

                if (ChartOfFace[AdjacentFace] != AbsentFace)
                    continue;

                ChartOfFace[AdjacentFace] = ChartOrdinal;
                Frontier.push_back(AdjacentFace);
            }
        }

        Pending.push_back(Growing);
    }

    Progressed.DeclareCount(0u, Pending.size());

    std::vector<std::uint32_t> LocalOfWelded(Conditioned.WeldedCount(), 0u);
    std::vector<std::uint32_t> StampOfWelded(Conditioned.WeldedCount(), 0u);
    std::uint32_t              Stamp = 0u;

    std::vector<Chart>                        Accepted;
    std::vector<std::vector<PlanarPosition>>  AcceptedFlattened;
    std::vector<ChartLocality>                AcceptedLocality;

    std::uint64_t Resolved = 0u;

    while (!Pending.empty())
    {
        // 🔴 `34` §5's cooperative point. A cancelled derivation runs to here and releases; a worker simply
        //    never joined leaks its inputs, proportional to how often the artist changes their mind about a seam.
        if (Cancellation.WithdrawalDeclared())
            return Deliver<DerivedPartition>::Refuse({ RefusalReason::HostDenied, "the derivation was withdrawn" });

        PendingChart Considering = Pending.back();
        Pending.pop_back();

        if (Considering.Faces.empty())
            continue;

        // 📝 The chart identity is the least imported face ordinal it holds — stable where the chart is unchanged.
        std::uint32_t IdentityOrdinal = Considering.Faces[0];

        for (const std::uint32_t FaceOrdinal : Considering.Faces)
            IdentityOrdinal = FaceOrdinal < IdentityOrdinal ? FaceOrdinal : IdentityOrdinal;

        for (const std::uint32_t FaceOrdinal : Considering.Faces)
            ChartOfFace[FaceOrdinal] = IdentityOrdinal;

        ++Stamp;

        ChartLocality Local = BuildLocality(Imported, Conditioned, Considering.Faces, ChartOfFace,
                                            SeamKeys, LocalOfWelded, StampOfWelded, Stamp);

        const bool SubdivisionReachable = Considering.Faces.size() > 1u
                                       && Considering.Attempts < Declaring.SubdivisionCeiling;

        const bool NotADisc = Local.LoopCount != 1u || Local.BoundaryLoop.size() < 3u;

        // 🔴 A chart with no boundary at all — a closed surface — and a chart with several loops are the same
        //    failure: it is not a disc, so no boundary-first parameterisation exists for it. `68` §4.1's
        //    response to a fold is the response here too, one step earlier.
        if (NotADisc && SubdivisionReachable)
        {
            std::vector<std::uint32_t> FirstHalf;
            std::vector<std::uint32_t> SecondHalf;
            Subdivide(Imported, Considering.Faces, FirstHalf, SecondHalf);

            Pending.push_back({ FirstHalf,  Considering.Attempts + 1u });
            Pending.push_back({ SecondHalf, Considering.Attempts + 1u });

            Progressed.DeclareCount(Resolved, Resolved + Pending.size());
            continue;
        }

        UnwrapSpecification Solving;
        Solving.Positions            = Local.Positions;
        Solving.TriangleCorners      = Local.TriangleCorners;
        Solving.BoundaryLoop         = Local.BoundaryLoop;
        Solving.ConvergenceCriterion = Declaring.ConvergenceCriterion;
        Solving.IterationCeiling     = Declaring.IterationCeiling;

        const Deliver<ConvergentResult<std::vector<PlanarPosition>>> Solved = Solve(Solving);

        if (!Solved.ContentPresent)
        {
            if (!SubdivisionReachable)
                return Deliver<DerivedPartition>::Refuse(Solved.Declined);

            std::vector<std::uint32_t> FirstHalf;
            std::vector<std::uint32_t> SecondHalf;
            Subdivide(Imported, Considering.Faces, FirstHalf, SecondHalf);

            Pending.push_back({ FirstHalf,  Considering.Attempts + 1u });
            Pending.push_back({ SecondHalf, Considering.Attempts + 1u });

            Progressed.DeclareCount(Resolved, Resolved + Pending.size());
            continue;
        }

        const std::vector<PlanarPosition>& Flattened = Solved.Resolve().Approximation;

        if (FoldDetected(Local, Flattened) && SubdivisionReachable)
        {
            ++Produced.Metrics.FoldCount;

            std::vector<std::uint32_t> FirstHalf;
            std::vector<std::uint32_t> SecondHalf;
            Subdivide(Imported, Considering.Faces, FirstHalf, SecondHalf);

            Pending.push_back({ FirstHalf,  Considering.Attempts + 1u });
            Pending.push_back({ SecondHalf, Considering.Attempts + 1u });

            Progressed.DeclareCount(Resolved, Resolved + Pending.size());
            continue;
        }

        Chart Accepting;
        Accepting.IdentityOrdinal  = IdentityOrdinal;
        Accepting.Faces            = Considering.Faces;
        Accepting.Cause            = Solved.Resolve().Cause;
        Accepting.ResidualNorm     = Solved.Resolve().ResidualNorm;
        Accepting.IterationCount   = Solved.Resolve().IterationCount;
        Accepting.SubdivisionCount = Considering.Attempts;
        Accepting.Distortion       = Measure(Local.Positions, Local.TriangleCorners, Flattened);

        if (Accepting.Cause == TerminationCause::CeilingReached)
            ++Produced.Metrics.CeilingTerminationCount;

        Accepted.push_back(Accepting);
        AcceptedFlattened.push_back(Flattened);
        AcceptedLocality.push_back(Local);

        ++Resolved;
        Progressed.DeclareCount(Resolved, Resolved + Pending.size());
    }

    // 📝 Every adjacency crossing two accepted charts is a cut. The authored ones are already declared, so what
    //    remains is exactly the set the partitioner added — which is what `86` reports and what `68` §2 requires
    //    to be reported rather than applied silently.
    for (std::uint32_t FaceOrdinal = 0u; FaceOrdinal < FaceSpan; ++FaceOrdinal)
    {
        const std::uint32_t FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);
        const std::uint32_t CornerSpan  = Imported.FaceCornerCount(FaceOrdinal);

        for (std::uint32_t Passed = 0u; Passed < CornerSpan; ++Passed)
        {
            const std::uint32_t CornerOrdinal = FirstCorner + Passed;
            const std::uint32_t Following     = FirstCorner + (Passed + 1u) % CornerSpan;

            const Deliver<std::uint32_t> Adjacent = Conditioned.AdjacentCorner(CornerOrdinal);

            if (!Adjacent.ContentPresent)
                continue;

            const std::uint32_t AdjacentFace = Imported.CornerFace(Adjacent.Resolve());

            if (ChartOfFace[AdjacentFace] == ChartOfFace[FaceOrdinal])
                continue;

            const std::uint32_t OpeningVertex = Imported.CornerVertex(CornerOrdinal);
            const std::uint32_t ClosingVertex = Imported.CornerVertex(Following);

            const std::uint32_t OpeningWelded = Conditioned.WeldedPosition(OpeningVertex).Resolve();
            const std::uint32_t ClosingWelded = Conditioned.WeldedPosition(ClosingVertex).Resolve();

            if (KeyHeld(SeamKeys, EdgeKey(OpeningWelded, ClosingWelded)))
                continue;

            const SeamEdge Derived = DeclareEdge(OpeningVertex, ClosingVertex);

            bool Recorded = false;

            for (const SeamEdge& Held : Produced.DerivedSeams)
            {
                if (Held.LeastVertex == Derived.LeastVertex && Held.GreatestVertex == Derived.GreatestVertex)
                {
                    Recorded = true;
                    break;
                }
            }

            if (!Recorded)
                Produced.DerivedSeams.push_back(Derived);
        }
    }

    // 📐 Each chart's own extent, then one common scale over all of them. `68` §5's default: one texel of domain
    //    covers the same topology area on every chart, so the artist's brush behaves the same everywhere.
    std::vector<ChartExtent> Extents(Accepted.size());
    std::vector<double>      LeastAlong(Accepted.size(), 0.0);
    std::vector<double>      LeastAcross(Accepted.size(), 0.0);

    for (std::size_t Ordinal = 0u; Ordinal < Accepted.size(); ++Ordinal)
    {
        const std::vector<PlanarPosition>& Flattened = AcceptedFlattened[Ordinal];

        double MostAlong  = Flattened[0].PositionX;
        double MostAcross = Flattened[0].PositionY;

        LeastAlong[Ordinal]  = Flattened[0].PositionX;
        LeastAcross[Ordinal] = Flattened[0].PositionY;

        for (const PlanarPosition& Held : Flattened)
        {
            LeastAlong[Ordinal]  = Held.PositionX < LeastAlong[Ordinal]  ? Held.PositionX : LeastAlong[Ordinal];
            LeastAcross[Ordinal] = Held.PositionY < LeastAcross[Ordinal] ? Held.PositionY : LeastAcross[Ordinal];
            MostAlong            = Held.PositionX > MostAlong            ? Held.PositionX : MostAlong;
            MostAcross           = Held.PositionY > MostAcross           ? Held.PositionY : MostAcross;
        }

        Extents[Ordinal].Width        = MostAlong  - LeastAlong[Ordinal];
        Extents[Ordinal].Height       = MostAcross - LeastAcross[Ordinal];
        Extents[Ordinal].ChartOrdinal = Accepted[Ordinal].IdentityOrdinal;
    }

    DomainSpace Arranged;

    const Deliver<bool> Packed = Arranged.Arrange(Extents, Declaring.CommonScaleDeclared);

    if (!Packed.ContentPresent)
        return Deliver<DerivedPartition>::Refuse(Packed.Declined);

    for (std::size_t Ordinal = 0u; Ordinal < Accepted.size(); ++Ordinal)
    {
        const ChartPlacement&              Placement = Arranged.Placements()[Ordinal];
        const ChartLocality&               Local     = AcceptedLocality[Ordinal];
        const std::vector<PlanarPosition>& Flattened = AcceptedFlattened[Ordinal];

        for (std::size_t Passed = 0u; Passed < Local.Corners.size(); ++Passed)
        {
            const PlanarPosition& Held = Flattened[Local.CornerLocals[Passed]];

            DomainCoordinate Writing;
            Writing.CoordinateAlong  = static_cast<float>(Placement.LeastAlong
                                                        + (Held.PositionX - LeastAlong[Ordinal]) * Placement.Scale);
            Writing.CoordinateAcross = static_cast<float>(Placement.LeastAcross
                                                        + (Held.PositionY - LeastAcross[Ordinal]) * Placement.Scale);

            Produced.CornerCoordinates[Local.Corners[Passed]] = Writing;
        }

        if (Accepted[Ordinal].Distortion.MeasureDeclared)
        {
            if (Accepted[Ordinal].Distortion.GreatestAreaRatio > Produced.Metrics.GreatestAreaRatio)
                Produced.Metrics.GreatestAreaRatio = Accepted[Ordinal].Distortion.GreatestAreaRatio;

            if (Accepted[Ordinal].Distortion.GreatestAngleDeviation > Produced.Metrics.GreatestAngleDeviation)
                Produced.Metrics.GreatestAngleDeviation = Accepted[Ordinal].Distortion.GreatestAngleDeviation;
        }
    }

    Produced.Charts                    = Accepted;
    Produced.Metrics.ChartCount        = static_cast<std::uint32_t>(Accepted.size());
    Produced.Metrics.DerivedSeamCount  = static_cast<std::uint32_t>(Produced.DerivedSeams.size());
    Produced.Metrics.Occupancy         = Arranged.Occupancy();

    Progressed.DeclareCount(Resolved, Resolved);

    return Deliver<DerivedPartition>::Deliver(Produced);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 THE STANDING PARTITION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> ChartPartition::Adopt(const DerivedPartition& Arriving)
{
    if (Arriving.Charts.empty())
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a partition carrying no chart" });

    StandingPartition = Arriving;

    // 🔴 Advanced on adoption and never on derivation. `24` §3 keys a transferred result on this revision and
    //    `20` promotes against it, so a revision that advanced while the previous partition still stood would
    //    invalidate artefacts addressed in a domain nothing had yet replaced.
    ++PartitionRevision;

    return Deliver<bool>::Deliver(true);
}

const DerivedPartition& ChartPartition::Standing() const { return StandingPartition; }

Deliver<DomainCoordinate> ChartPartition::Coordinate(std::uint32_t CornerOrdinal) const
{
    if (PartitionRevision == 0u)
    {
        return Deliver<DomainCoordinate>::Refuse(
            { RefusalReason::ContentUnsupported, "no partition stands for this surface" });
    }

    if (CornerOrdinal >= StandingPartition.CornerCoordinates.size())
        return Deliver<DomainCoordinate>::Refuse({ RefusalReason::ExtentExhausted, "no such corner" });

    return Deliver<DomainCoordinate>::Deliver(StandingPartition.CornerCoordinates[CornerOrdinal]);
}

bool          ChartPartition::PartitionStanding() const { return PartitionRevision != 0u; }
std::uint64_t ChartPartition::Revision() const          { return PartitionRevision;       }

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE REPORTING
//------------------------------------------------------------------------------------------------------------------------

void ChartPartition::Report(ReportSequence& Reporting, MeasureIndex& Measured, TickPoint Sampled) const
{
    if (PartitionRevision == 0u)
        return;

    // 📝 One appended entry per derived seam, carrying the chart it cut. `86` §6 coalesces by subject ordinal as
    //    well as by origin, so twelve distinct cuts present as twelve entries rather than as one with a count.
    for (const Chart& Held : StandingPartition.Charts)
    {
        if (Held.Cause != TerminationCause::CeilingReached)
            continue;

        ReportSpecification Terminated;
        Terminated.Origin         = "68 §4 ChartPartition";
        Terminated.Subject        = "Flattening";
        Terminated.Detail         = "the iteration ceiling terminated the solve; the result is the last iterate";
        Terminated.SubjectOrdinal = Held.IdentityOrdinal;
        Terminated.Disposition    = ReportDisposition::Terminated;
        Terminated.Arrival        = Sampled;

        Reporting.Append(Terminated);
    }

    for (const SeamEdge& Held : StandingPartition.DerivedSeams)
    {
        ReportSpecification Amended;
        Amended.Origin         = "68 §2 ChartPartition";
        Amended.Subject        = "DerivedSeam";
        Amended.Detail         = "the authored seams did not admit a flattening; this edge was cut here";
        Amended.SubjectOrdinal = (static_cast<std::uint64_t>(Held.LeastVertex) << 32) | Held.GreatestVertex;
        Amended.Disposition    = ReportDisposition::Amended;
        Amended.Arrival        = Sampled;

        Reporting.Append(Amended);
    }

    // 🔴 Occupancy and distortion overwrite. `86` §2: a measure appended every partition buries the one seam
    //    the artist did not expect under a thousand readings nobody asked for.
    Measured.DeclareMagnitude("68 §5 ChartPartition", "Occupancy", StandingPartition.Metrics.Occupancy, Sampled);
    Measured.DeclareMagnitude("68 §4 ChartPartition", "AreaDistortion",
                              StandingPartition.Metrics.GreatestAreaRatio, Sampled);
    Measured.DeclareMagnitude("68 §4 ChartPartition", "AngleDistortion",
                              StandingPartition.Metrics.GreatestAngleDeviation, Sampled);
    Measured.DeclareCount("68 §3 ChartPartition", "ChartCount",
                          StandingPartition.Metrics.ChartCount, Sampled);
}

}   // namespace Slate
