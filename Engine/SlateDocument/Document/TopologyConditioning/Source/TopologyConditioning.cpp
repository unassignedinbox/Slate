//============================================================================================================================================
//                                                       TOPOLOGYCONDITIONING.CPP
//============================================================================================================================================
// 🧩 Lattice welding, corner adjacency, orientation consistency, and conservative extents.

#include "SlateDocument/Document/TopologyConditioning/Api/TopologyConditioning.h"

#include "Shared/OrientationClassifier.slang.h"
#include "Contract/ToleranceContract.h"

#include <cmath>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE LATTICE
//------------------------------------------------------------------------------------------------------------------------

namespace
{

constexpr std::uint32_t AbsentCorner = 0xFFFFFFFFu;   // [-] - no adjacent corner; never a valid ordinal

// 📝 🔴 Welding is decided on an integer lattice whose spacing is the declared relative tolerance, and the
//    comparison is between integer cells. That is what makes coincidence Exact and deterministic: two positions
//    weld when their lattice displacement is at most one along every axis, which is an integer decision no
//    rounding can reach. Comparing squared distances against a tolerance is the obvious alternative and it is
//    Bounded, so the same file would weld differently on two machines.
// ⚠️ The consequence is that coincidence extends to two lattice spacings in the worst case rather than exactly
//    one tolerance. That is a declared tolerance rather than a discovered one, which is what `38` §2 asks for.
struct LatticeCell
{
    std::int64_t  CellAlong  = 0;   // [-] - lattice ordinal along the first axis
    std::int64_t  CellAcross = 0;   // [-] - along the second
    std::int64_t  CellDeep   = 0;   // [-] - along the third
};

LatticeCell Quantise(DocumentPosition Subject, double Spacing)
{
    LatticeCell Cell;
    Cell.CellAlong  = static_cast<std::int64_t>(std::floor(Subject.PositionX / Spacing));
    Cell.CellAcross = static_cast<std::int64_t>(std::floor(Subject.PositionY / Spacing));
    Cell.CellDeep   = static_cast<std::int64_t>(std::floor(Subject.PositionZ / Spacing));

    return Cell;
}

std::uint64_t CellOrdinal(LatticeCell Cell)
{
    // 📐 A mixing of the three lattice ordinals into one search ordinal. Exact equality of the ordinals is
    //    confirmed after a candidate is found, so a collision costs a comparison and never a wrong weld.
    const std::uint64_t Along  = static_cast<std::uint64_t>(Cell.CellAlong)  * 0x9E3779B97F4A7C15ull;
    const std::uint64_t Across = static_cast<std::uint64_t>(Cell.CellAcross) * 0xC2B2AE3D27D4EB4Full;
    const std::uint64_t Deep   = static_cast<std::uint64_t>(Cell.CellDeep)   * 0x165667B19E3779F9ull;

    return Along ^ Across ^ Deep;
}

double GreatestSpan(const std::vector<DocumentPosition>& Positions)
{
    if (Positions.empty())
        return 1.0;

    DocumentPosition Least    = Positions[0];
    DocumentPosition Greatest = Positions[0];

    for (const DocumentPosition& Held : Positions)
    {
        Least.PositionX    = Held.PositionX < Least.PositionX    ? Held.PositionX : Least.PositionX;
        Least.PositionY    = Held.PositionY < Least.PositionY    ? Held.PositionY : Least.PositionY;
        Least.PositionZ    = Held.PositionZ < Least.PositionZ    ? Held.PositionZ : Least.PositionZ;
        Greatest.PositionX = Held.PositionX > Greatest.PositionX ? Held.PositionX : Greatest.PositionX;
        Greatest.PositionY = Held.PositionY > Greatest.PositionY ? Held.PositionY : Greatest.PositionY;
        Greatest.PositionZ = Held.PositionZ > Greatest.PositionZ ? Held.PositionZ : Greatest.PositionZ;
    }

    const double SpanX = Greatest.PositionX - Least.PositionX;
    const double SpanY = Greatest.PositionY - Least.PositionY;
    const double SpanZ = Greatest.PositionZ - Least.PositionZ;

    double Greatest_ = SpanX > SpanY ? SpanX : SpanY;
    Greatest_        = Greatest_ > SpanZ ? Greatest_ : SpanZ;

    return Greatest_ > 0.0 ? Greatest_ : 1.0;
}

SurfaceDirection Normalise(double DirectionX, double DirectionY, double DirectionZ)
{
    SurfaceDirection Direction;

    const double Length = std::sqrt(DirectionX * DirectionX + DirectionY * DirectionY + DirectionZ * DirectionZ);

    if (Length <= 0.0)
        return Direction;

    Direction.DirectionX = static_cast<float>(DirectionX / Length);
    Direction.DirectionY = static_cast<float>(DirectionY / Length);
    Direction.DirectionZ = static_cast<float>(DirectionZ / Length);

    return Direction;
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                       WELDING
//------------------------------------------------------------------------------------------------------------------------

void TopologyConditioning::DeriveWelding(const TopologyStructure& Imported)
{
    const std::vector<DocumentPosition>& Positions = Imported.Positions();
    const double                         Spacing   = GreatestSpan(Positions) * WeldTolerance;

    WeldedPositionOfVertex.assign(Positions.size(), 0u);
    DistinctPositionCount = 0u;

    // 📝 One search run per mixed ordinal, holding the imported vertices already welded there. A vertex is
    //    compared against the twenty-seven cells around its own, so a position sitting just across a cell
    //    boundary from its twin still finds it.
    // 📝 ⚠️ DeriveWelding scans RunOrdinals linearly for each neighbour cell (quadratic in run count).
    //    Recorded per `38` §5 for large models.
    std::vector<std::uint64_t>                 RunOrdinals;
    std::vector<std::vector<std::uint32_t>>    RunVertices;
    std::vector<LatticeCell>                   CellOfVertex(Positions.size());

    for (std::uint32_t VertexOrdinal = 0u; VertexOrdinal < Positions.size(); ++VertexOrdinal)
    {
        const LatticeCell Cell = Quantise(Positions[VertexOrdinal], Spacing);
        CellOfVertex[VertexOrdinal] = Cell;

        std::uint32_t Welded = AbsentCorner;

        for (std::int64_t Along = -1; Along <= 1 && Welded == AbsentCorner; ++Along)
        {
            for (std::int64_t Across = -1; Across <= 1 && Welded == AbsentCorner; ++Across)
            {
                for (std::int64_t Deep = -1; Deep <= 1 && Welded == AbsentCorner; ++Deep)
                {
                    LatticeCell Sought;
                    Sought.CellAlong  = Cell.CellAlong  + Along;
                    Sought.CellAcross = Cell.CellAcross + Across;
                    Sought.CellDeep   = Cell.CellDeep   + Deep;

                    const std::uint64_t Ordinal = CellOrdinal(Sought);

                    for (std::size_t RunOrdinal = 0u; RunOrdinal < RunOrdinals.size(); ++RunOrdinal)
                    {
                        if (RunOrdinals[RunOrdinal] != Ordinal)
                            continue;

                        for (const std::uint32_t Candidate : RunVertices[RunOrdinal])
                        {
                            const LatticeCell Held = CellOfVertex[Candidate];

                            if (Held.CellAlong  == Sought.CellAlong
                             && Held.CellAcross == Sought.CellAcross
                             && Held.CellDeep   == Sought.CellDeep)
                            {
                                Welded = WeldedPositionOfVertex[Candidate];
                                break;
                            }
                        }

                        break;
                    }
                }
            }
        }

        if (Welded == AbsentCorner)
        {
            Welded = DistinctPositionCount;
            ++DistinctPositionCount;
        }

        WeldedPositionOfVertex[VertexOrdinal] = Welded;

        const std::uint64_t OwnOrdinal = CellOrdinal(Cell);
        std::size_t         Located     = RunOrdinals.size();

        for (std::size_t RunOrdinal = 0u; RunOrdinal < RunOrdinals.size(); ++RunOrdinal)
        {
            if (RunOrdinals[RunOrdinal] == OwnOrdinal)
            {
                Located = RunOrdinal;
                break;
            }
        }

        if (Located == RunOrdinals.size())
        {
            RunOrdinals.push_back(OwnOrdinal);
            RunVertices.push_back({});
        }

        RunVertices[Located].push_back(VertexOrdinal);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      ADJACENCY
//------------------------------------------------------------------------------------------------------------------------

void TopologyConditioning::DeriveAdjacency(const TopologyStructure& Imported)
{
    const std::uint32_t CornerSpan = Imported.CornerCount();

    AdjacentCornerOfCorner.assign(CornerSpan, AbsentCorner);
    FirstCornerOfPosition.assign(DistinctPositionCount, AbsentCorner);
    NextCornerOfPosition.assign(CornerSpan, AbsentCorner);

    // 📝 Incidence is over **welded positions**, not over imported vertices. A traversal that followed imported
    //    vertices would stop at every coordinate seam, which is precisely the discontinuity welding exists to
    //    see through.
    for (std::uint32_t CornerOrdinal = 0u; CornerOrdinal < CornerSpan; ++CornerOrdinal)
    {
        const std::uint32_t Position = WeldedPositionOfVertex[Imported.CornerVertex(CornerOrdinal)];

        NextCornerOfPosition[CornerOrdinal] = FirstCornerOfPosition[Position];
        FirstCornerOfPosition[Position]     = CornerOrdinal;
    }

    std::vector<std::uint32_t> IncidenceCountOfEdge;
    std::vector<std::uint32_t> LeastOfEdge;
    std::vector<std::uint32_t> GreatestOfEdge;
    std::vector<std::uint32_t> FirstCornerOfEdge;
    std::vector<std::uint32_t> SecondCornerOfEdge;

    for (std::uint32_t FaceOrdinal = 0u; FaceOrdinal < Imported.FaceCount(); ++FaceOrdinal)
    {
        const std::uint32_t FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);
        const std::uint32_t CornerSpan_ = Imported.FaceCornerCount(FaceOrdinal);

        for (std::uint32_t Passed = 0u; Passed < CornerSpan_; ++Passed)
        {
            const std::uint32_t CornerOrdinal = FirstCorner + Passed;
            const std::uint32_t Following     = FirstCorner + (Passed + 1u) % CornerSpan_;

            const std::uint32_t Opening = WeldedPositionOfVertex[Imported.CornerVertex(CornerOrdinal)];
            const std::uint32_t Closing = WeldedPositionOfVertex[Imported.CornerVertex(Following)];

            const std::uint32_t Least    = Opening < Closing ? Opening : Closing;
            const std::uint32_t Greatest = Opening < Closing ? Closing : Opening;

            std::size_t Located = LeastOfEdge.size();

            for (std::size_t EdgeOrdinal = 0u; EdgeOrdinal < LeastOfEdge.size(); ++EdgeOrdinal)
            {
                if (LeastOfEdge[EdgeOrdinal] == Least && GreatestOfEdge[EdgeOrdinal] == Greatest)
                {
                    Located = EdgeOrdinal;
                    break;
                }
            }

            if (Located == LeastOfEdge.size())
            {
                LeastOfEdge.push_back(Least);
                GreatestOfEdge.push_back(Greatest);
                IncidenceCountOfEdge.push_back(1u);
                FirstCornerOfEdge.push_back(CornerOrdinal);
                SecondCornerOfEdge.push_back(AbsentCorner);
            }
            else
            {
                ++IncidenceCountOfEdge[Located];

                if (SecondCornerOfEdge[Located] == AbsentCorner)
                    SecondCornerOfEdge[Located] = CornerOrdinal;
            }
        }
    }

    for (std::size_t EdgeOrdinal = 0u; EdgeOrdinal < LeastOfEdge.size(); ++EdgeOrdinal)
    {
        // 🔴 Only an edge with exactly two incidences yields an adjacency. An edge with more is non-manifold and
        //    every face it touches is enrolled, because `68` §4.1 cuts a chart boundary there rather than
        //    choosing one of several continuations arbitrarily.
        if (IncidenceCountOfEdge[EdgeOrdinal] == 2u)
        {
            const std::uint32_t First  = FirstCornerOfEdge[EdgeOrdinal];
            const std::uint32_t Second = SecondCornerOfEdge[EdgeOrdinal];

            AdjacentCornerOfCorner[First]  = Second;
            AdjacentCornerOfCorner[Second] = First;
        }
        else if (IncidenceCountOfEdge[EdgeOrdinal] > 2u)
        {
            EnrolInterval(EnrolledConditions[static_cast<std::size_t>(DegeneracySubject::NonManifoldEdge)],
                          Imported.CornerFace(FirstCornerOfEdge[EdgeOrdinal]));

            if (SecondCornerOfEdge[EdgeOrdinal] != AbsentCorner)
            {
                EnrolInterval(EnrolledConditions[static_cast<std::size_t>(DegeneracySubject::NonManifoldEdge)],
                              Imported.CornerFace(SecondCornerOfEdge[EdgeOrdinal]));
            }
        }
    }

    for (std::uint32_t Position = 0u; Position < DistinctPositionCount; ++Position)
    {
        if (FirstCornerOfPosition[Position] == AbsentCorner)
            EnrolInterval(EnrolledConditions[static_cast<std::size_t>(DegeneracySubject::IsolatedVertex)], Position);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     ORIENTATION
//------------------------------------------------------------------------------------------------------------------------

void TopologyConditioning::DeriveOrientation(const TopologyStructure& Imported)
{
    const std::vector<DocumentPosition>& Positions = Imported.Positions();

    UnorientedFaceCount = 0u;

    for (std::uint32_t FaceOrdinal = 0u; FaceOrdinal < Imported.FaceCount(); ++FaceOrdinal)
    {
        const std::uint32_t FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);
        const std::uint32_t CornerSpan  = Imported.FaceCornerCount(FaceOrdinal);

        // 📐 The Newell accumulation gives the face's own perpendicular without assuming planarity, and its
        //    dominant axis names the plane the face projects onto without degenerating.
        double NewellX = 0.0;
        double NewellY = 0.0;
        double NewellZ = 0.0;

        bool CornerRepeated = false;

        for (std::uint32_t Passed = 0u; Passed < CornerSpan; ++Passed)
        {
            const std::uint32_t Opening   = Imported.CornerVertex(FirstCorner + Passed);
            const std::uint32_t Closing   = Imported.CornerVertex(FirstCorner + (Passed + 1u) % CornerSpan);
            const DocumentPosition& Alpha = Positions[Opening];
            const DocumentPosition& Beta  = Positions[Closing];

            NewellX += (Alpha.PositionY - Beta.PositionY) * (Alpha.PositionZ + Beta.PositionZ);
            NewellY += (Alpha.PositionZ - Beta.PositionZ) * (Alpha.PositionX + Beta.PositionX);
            NewellZ += (Alpha.PositionX - Beta.PositionX) * (Alpha.PositionY + Beta.PositionY);

            for (std::uint32_t Compared = Passed + 1u; Compared < CornerSpan; ++Compared)
            {
                if (WeldedPositionOfVertex[Opening]
                 == WeldedPositionOfVertex[Imported.CornerVertex(FirstCorner + Compared)])
                {
                    CornerRepeated = true;
                }
            }
        }

        if (CornerRepeated)
        {
            EnrolInterval(EnrolledConditions[static_cast<std::size_t>(DegeneracySubject::RepeatedCorner)],
                          FaceOrdinal);
        }

        const double AlongMagnitude  = std::fabs(NewellX);
        const double AcrossMagnitude = std::fabs(NewellY);
        const double DeepMagnitude   = std::fabs(NewellZ);

        std::uint32_t DominantAxis = 2u;

        if (AlongMagnitude >= AcrossMagnitude && AlongMagnitude >= DeepMagnitude)
            DominantAxis = 0u;
        else if (AcrossMagnitude >= DeepMagnitude)
            DominantAxis = 1u;

        // 🔴 The signed area's **sign** is taken from `02` §4's exact predicate over the projected corners, not
        //    from the Newell magnitude. `38` §6: a sign error inverts a face, and a face inverted from one camera
        //    angle is a defect the artist reads as a broken import rather than as arithmetic.
        Signed32 OrientationSignum = 0;

        for (std::uint32_t Passed = 1u; Passed + 1u < CornerSpan && OrientationSignum == 0; ++Passed)
        {
            const DocumentPosition& Alpha = Positions[Imported.CornerVertex(FirstCorner)];
            const DocumentPosition& Beta  = Positions[Imported.CornerVertex(FirstCorner + Passed)];
            const DocumentPosition& Gamma = Positions[Imported.CornerVertex(FirstCorner + Passed + 1u)];

            if (DominantAxis == 0u)
            {
                OrientationSignum = ClassifyOrientation(Alpha.PositionY, Alpha.PositionZ,
                                                        Beta.PositionY,  Beta.PositionZ,
                                                        Gamma.PositionY, Gamma.PositionZ);
            }
            else if (DominantAxis == 1u)
            {
                OrientationSignum = ClassifyOrientation(Alpha.PositionZ, Alpha.PositionX,
                                                        Beta.PositionZ,  Beta.PositionX,
                                                        Gamma.PositionZ, Gamma.PositionX);
            }
            else
            {
                OrientationSignum = ClassifyOrientation(Alpha.PositionX, Alpha.PositionY,
                                                        Beta.PositionX,  Beta.PositionY,
                                                        Gamma.PositionX, Gamma.PositionY);
            }
        }

        if (OrientationSignum == 0)
        {
            EnrolInterval(EnrolledConditions[static_cast<std::size_t>(DegeneracySubject::ZeroExtentFace)],
                          FaceOrdinal);
        }
    }

    // 📝 Consistency is a second pass, because it compares a face against an adjacency the first pass had not
    //    finished deriving. Two faces are consistent when they traverse their shared edge in opposite directions.
    for (std::uint32_t CornerOrdinal = 0u; CornerOrdinal < Imported.CornerCount(); ++CornerOrdinal)
    {
        const std::uint32_t Adjacent = AdjacentCornerOfCorner[CornerOrdinal];

        if (Adjacent == AbsentCorner)
            continue;

        const std::uint32_t FaceOrdinal     = Imported.CornerFace(CornerOrdinal);
        const std::uint32_t AdjacentFace    = Imported.CornerFace(Adjacent);

        const std::uint32_t Opening         = WeldedPositionOfVertex[Imported.CornerVertex(CornerOrdinal)];
        const std::uint32_t AdjacentOpening = WeldedPositionOfVertex[Imported.CornerVertex(Adjacent)];

        if (Opening == AdjacentOpening)
        {
            // 📝 Both faces open the shared edge at the same position, so both traverse it the same way and
            //    their orientations disagree. Enrolled and reported; `38` §3 renders it both-sided rather than
            //    reversing the artist's winding.
            const std::size_t Condition = static_cast<std::size_t>(DegeneracySubject::Unoriented);

            if (EnrolInterval(EnrolledConditions[Condition], FaceOrdinal))
                ++UnorientedFaceCount;

            if (EnrolInterval(EnrolledConditions[Condition], AdjacentFace))
                ++UnorientedFaceCount;
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  DIRECTION DERIVATION
//------------------------------------------------------------------------------------------------------------------------

void TopologyConditioning::DerivePerpendiculars(const TopologyStructure& Imported)
{
    if (Imported.PerpendicularsSupplied())
    {
        // 🔴 A supplied perpendicular is retained. `38` §7: an imported basis is used as supplied, and the same
        //    reasoning binds the perpendicular — reproducing the author's appearance requires reproducing it.
        DerivedPerpendiculars = Imported.Perpendiculars();
        return;
    }

    const std::vector<DocumentPosition>& Positions = Imported.Positions();

    std::vector<double> AccumulatedX(DistinctPositionCount, 0.0);
    std::vector<double> AccumulatedY(DistinctPositionCount, 0.0);
    std::vector<double> AccumulatedZ(DistinctPositionCount, 0.0);

    for (std::uint32_t FaceOrdinal = 0u; FaceOrdinal < Imported.FaceCount(); ++FaceOrdinal)
    {
        if (FaceEnrolled(FaceOrdinal, DegeneracySubject::ZeroExtentFace))
            continue;

        const std::uint32_t FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);
        const std::uint32_t CornerSpan  = Imported.FaceCornerCount(FaceOrdinal);

        double NewellX = 0.0;
        double NewellY = 0.0;
        double NewellZ = 0.0;

        for (std::uint32_t Passed = 0u; Passed < CornerSpan; ++Passed)
        {
            const DocumentPosition& Alpha =
                Positions[Imported.CornerVertex(FirstCorner + Passed)];
            const DocumentPosition& Beta =
                Positions[Imported.CornerVertex(FirstCorner + (Passed + 1u) % CornerSpan)];

            NewellX += (Alpha.PositionY - Beta.PositionY) * (Alpha.PositionZ + Beta.PositionZ);
            NewellY += (Alpha.PositionZ - Beta.PositionZ) * (Alpha.PositionX + Beta.PositionX);
            NewellZ += (Alpha.PositionX - Beta.PositionX) * (Alpha.PositionY + Beta.PositionY);
        }

        // 📐 Accumulated unnormalised, so each face contributes in proportion to its own area. Normalising per
        //    face first would give a sliver the same weight as the face beside it, and the shading tilts toward
        //    whichever slivers the source happened to contain.
        for (std::uint32_t Passed = 0u; Passed < CornerSpan; ++Passed)
        {
            const std::uint32_t Position =
                WeldedPositionOfVertex[Imported.CornerVertex(FirstCorner + Passed)];

            AccumulatedX[Position] += NewellX;
            AccumulatedY[Position] += NewellY;
            AccumulatedZ[Position] += NewellZ;
        }
    }

    DerivedPerpendiculars.assign(Positions.size(), SurfaceDirection{});

    for (std::uint32_t VertexOrdinal = 0u; VertexOrdinal < Positions.size(); ++VertexOrdinal)
    {
        const std::uint32_t Position = WeldedPositionOfVertex[VertexOrdinal];

        DerivedPerpendiculars[VertexOrdinal] = Normalise(AccumulatedX[Position],
                                                         AccumulatedY[Position],
                                                         AccumulatedZ[Position]);
    }
}

void TopologyConditioning::DeriveTangentBases(const TopologyStructure& Imported)
{
    if (Imported.TangentBasesSupplied())
    {
        DerivedTangentBases = Imported.TangentBases();
        BasesRetained       = true;
        return;
    }

    BasesRetained = false;
    DerivedTangentBases.assign(Imported.VertexCount(), TangentBasis{});

    // 🔴 The basis derives from the **domain** parameterisation — `18` §1.1 — which is what makes a perturbation
    //    authored in `22` and one transferred in `24` agree. With no coordinates there is no domain, so the basis
    //    is marked absent rather than substituted: `18` §1.1's rule is that the perturbation channels are then
    //    not sampled at all, and an orthonormalised substitute would be a fabricated value.
    if (!Imported.CoordinatesSupplied())
        return;

    const std::vector<DocumentPosition>& Positions   = Imported.Positions();
    const std::vector<DomainCoordinate>& Coordinates = Imported.Coordinates();

    std::vector<double> AccumulatedX(Imported.VertexCount(), 0.0);
    std::vector<double> AccumulatedY(Imported.VertexCount(), 0.0);
    std::vector<double> AccumulatedZ(Imported.VertexCount(), 0.0);
    std::vector<double> AccumulatedHandedness(Imported.VertexCount(), 0.0);

    for (std::uint32_t FaceOrdinal = 0u; FaceOrdinal < Imported.FaceCount(); ++FaceOrdinal)
    {
        if (FaceEnrolled(FaceOrdinal, DegeneracySubject::ZeroExtentFace))
            continue;

        const std::uint32_t FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);
        const std::uint32_t CornerSpan  = Imported.FaceCornerCount(FaceOrdinal);

        for (std::uint32_t Passed = 1u; Passed + 1u < CornerSpan; ++Passed)
        {
            const std::uint32_t AlphaCorner = FirstCorner;
            const std::uint32_t BetaCorner  = FirstCorner + Passed;
            const std::uint32_t GammaCorner = FirstCorner + Passed + 1u;

            const DocumentPosition& Alpha = Positions[Imported.CornerVertex(AlphaCorner)];
            const DocumentPosition& Beta  = Positions[Imported.CornerVertex(BetaCorner)];
            const DocumentPosition& Gamma = Positions[Imported.CornerVertex(GammaCorner)];

            const double FirstSpanX = Beta.PositionX - Alpha.PositionX;
            const double FirstSpanY = Beta.PositionY - Alpha.PositionY;
            const double FirstSpanZ = Beta.PositionZ - Alpha.PositionZ;

            const double SecondSpanX = Gamma.PositionX - Alpha.PositionX;
            const double SecondSpanY = Gamma.PositionY - Alpha.PositionY;
            const double SecondSpanZ = Gamma.PositionZ - Alpha.PositionZ;

            const double FirstAlong  = static_cast<double>(Coordinates[BetaCorner].CoordinateAlong)
                                     - static_cast<double>(Coordinates[AlphaCorner].CoordinateAlong);
            const double FirstAcross = static_cast<double>(Coordinates[BetaCorner].CoordinateAcross)
                                     - static_cast<double>(Coordinates[AlphaCorner].CoordinateAcross);
            const double SecondAlong  = static_cast<double>(Coordinates[GammaCorner].CoordinateAlong)
                                      - static_cast<double>(Coordinates[AlphaCorner].CoordinateAlong);
            const double SecondAcross = static_cast<double>(Coordinates[GammaCorner].CoordinateAcross)
                                      - static_cast<double>(Coordinates[AlphaCorner].CoordinateAcross);

            const double DomainArea = FirstAlong * SecondAcross - SecondAlong * FirstAcross;

            // 📝 A chart of zero area in the domain contributes nothing rather than a division by it. `18` §1.1
            //    marks the basis absent exactly there, and this is the same condition seen from the derivation.
            if (DomainArea == 0.0)
                continue;

            const double Reciprocal = 1.0 / DomainArea;

            const double TangentX = (SecondAcross * FirstSpanX - FirstAcross * SecondSpanX) * Reciprocal;
            const double TangentY = (SecondAcross * FirstSpanY - FirstAcross * SecondSpanY) * Reciprocal;
            const double TangentZ = (SecondAcross * FirstSpanZ - FirstAcross * SecondSpanZ) * Reciprocal;

            const double AcrossX = (FirstAlong * SecondSpanX - SecondAlong * FirstSpanX) * Reciprocal;
            const double AcrossY = (FirstAlong * SecondSpanY - SecondAlong * FirstSpanY) * Reciprocal;
            const double AcrossZ = (FirstAlong * SecondSpanZ - SecondAlong * FirstSpanZ) * Reciprocal;

            const std::uint32_t Corners[3] = { AlphaCorner, BetaCorner, GammaCorner };

            for (std::uint32_t Ordinal = 0u; Ordinal < 3u; ++Ordinal)
            {
                const std::uint32_t VertexOrdinal = Imported.CornerVertex(Corners[Ordinal]);

                AccumulatedX[VertexOrdinal] += TangentX;
                AccumulatedY[VertexOrdinal] += TangentY;
                AccumulatedZ[VertexOrdinal] += TangentZ;

                // 📐 The handedness is the sign of the across-direction against the perpendicular crossed with
                //    the tangent. It is accumulated and then taken by sign, so a domain that mirrors across a
                //    seam records the inversion on the side it happens rather than averaging the two away.
                const SurfaceDirection& Perpendicular = DerivedPerpendiculars[VertexOrdinal];

                const double CrossX = static_cast<double>(Perpendicular.DirectionY) * TangentZ
                                    - static_cast<double>(Perpendicular.DirectionZ) * TangentY;
                const double CrossY = static_cast<double>(Perpendicular.DirectionZ) * TangentX
                                    - static_cast<double>(Perpendicular.DirectionX) * TangentZ;
                const double CrossZ = static_cast<double>(Perpendicular.DirectionX) * TangentY
                                    - static_cast<double>(Perpendicular.DirectionY) * TangentX;

                AccumulatedHandedness[VertexOrdinal] += CrossX * AcrossX + CrossY * AcrossY + CrossZ * AcrossZ;
            }
        }
    }

    for (std::uint32_t VertexOrdinal = 0u; VertexOrdinal < Imported.VertexCount(); ++VertexOrdinal)
    {
        const SurfaceDirection Tangent = Normalise(AccumulatedX[VertexOrdinal],
                                                   AccumulatedY[VertexOrdinal],
                                                   AccumulatedZ[VertexOrdinal]);

        const bool Degenerate = Tangent.DirectionX == 0.0f
                             && Tangent.DirectionY == 0.0f
                             && Tangent.DirectionZ == 0.0f;

        DerivedTangentBases[VertexOrdinal].Tangent          = Tangent;
        DerivedTangentBases[VertexOrdinal].HandednessSignum =
            AccumulatedHandedness[VertexOrdinal] < 0.0 ? -1.0f : 1.0f;
        DerivedTangentBases[VertexOrdinal].BasisDeclared    = !Degenerate;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       EXTENTS
//------------------------------------------------------------------------------------------------------------------------

void TopologyConditioning::DeriveExtents(const TopologyStructure& Imported)
{
    const std::vector<DocumentPosition>& Positions = Imported.Positions();

    DerivedFaceExtents.assign(Imported.FaceCount(), ConditionedExtent{});

    bool WholeDeclared = false;

    for (std::uint32_t FaceOrdinal = 0u; FaceOrdinal < Imported.FaceCount(); ++FaceOrdinal)
    {
        const std::uint32_t FirstCorner = Imported.FaceFirstCorner(FaceOrdinal);
        const std::uint32_t CornerSpan  = Imported.FaceCornerCount(FaceOrdinal);

        DocumentPosition Least    = Positions[Imported.CornerVertex(FirstCorner)];
        DocumentPosition Greatest = Least;

        for (std::uint32_t Passed = 1u; Passed < CornerSpan; ++Passed)
        {
            const DocumentPosition& Held = Positions[Imported.CornerVertex(FirstCorner + Passed)];

            Least.PositionX    = Held.PositionX < Least.PositionX    ? Held.PositionX : Least.PositionX;
            Least.PositionY    = Held.PositionY < Least.PositionY    ? Held.PositionY : Least.PositionY;
            Least.PositionZ    = Held.PositionZ < Least.PositionZ    ? Held.PositionZ : Least.PositionZ;
            Greatest.PositionX = Held.PositionX > Greatest.PositionX ? Held.PositionX : Greatest.PositionX;
            Greatest.PositionY = Held.PositionY > Greatest.PositionY ? Held.PositionY : Greatest.PositionY;
            Greatest.PositionZ = Held.PositionZ > Greatest.PositionZ ? Held.PositionZ : Greatest.PositionZ;
        }

        // 🔴 Rounded outward by one representable step on every face of the extent. `38` §6: an inward-rounded
        //    extent excludes a face from traversal, and the artist meets it as a surface with a thin band along
        //    one edge that cannot be selected or painted.
        Least.PositionX    = std::nextafter(Least.PositionX,    -HUGE_VAL);
        Least.PositionY    = std::nextafter(Least.PositionY,    -HUGE_VAL);
        Least.PositionZ    = std::nextafter(Least.PositionZ,    -HUGE_VAL);
        Greatest.PositionX = std::nextafter(Greatest.PositionX,  HUGE_VAL);
        Greatest.PositionY = std::nextafter(Greatest.PositionY,  HUGE_VAL);
        Greatest.PositionZ = std::nextafter(Greatest.PositionZ,  HUGE_VAL);

        DerivedFaceExtents[FaceOrdinal].Least    = Least;
        DerivedFaceExtents[FaceOrdinal].Greatest = Greatest;

        if (!WholeDeclared)
        {
            WholeExtent   = DerivedFaceExtents[FaceOrdinal];
            WholeDeclared = true;
            continue;
        }

        WholeExtent.Least.PositionX    = Least.PositionX < WholeExtent.Least.PositionX
                                       ? Least.PositionX : WholeExtent.Least.PositionX;
        WholeExtent.Least.PositionY    = Least.PositionY < WholeExtent.Least.PositionY
                                       ? Least.PositionY : WholeExtent.Least.PositionY;
        WholeExtent.Least.PositionZ    = Least.PositionZ < WholeExtent.Least.PositionZ
                                       ? Least.PositionZ : WholeExtent.Least.PositionZ;
        WholeExtent.Greatest.PositionX = Greatest.PositionX > WholeExtent.Greatest.PositionX
                                       ? Greatest.PositionX : WholeExtent.Greatest.PositionX;
        WholeExtent.Greatest.PositionY = Greatest.PositionY > WholeExtent.Greatest.PositionY
                                       ? Greatest.PositionY : WholeExtent.Greatest.PositionY;
        WholeExtent.Greatest.PositionZ = Greatest.PositionZ > WholeExtent.Greatest.PositionZ
                                       ? Greatest.PositionZ : WholeExtent.Greatest.PositionZ;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE CONDITIONING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> TopologyConditioning::Condition(const TopologyStructure& Imported)
{
    if (!Imported.Sealed())
    {
        return Deliver<bool>::Refuse(
            { RefusalReason::HostDenied, "an unsealed topology is not immutable for the run" });
    }

    for (std::size_t Condition = 0u; Condition < DegeneracySpan; ++Condition)
        EnrolledConditions[Condition].clear();

    // 📝 The order is load-bearing rather than incidental. Welding precedes adjacency because incidence is over
    //    welded positions; adjacency precedes orientation because consistency compares against it; orientation
    //    precedes the perpendiculars so a degenerate face contributes nothing to them; and the perpendiculars
    //    precede the bases because handedness is taken against them.
    DeriveWelding(Imported);
    DeriveAdjacency(Imported);
    DeriveOrientation(Imported);
    DerivePerpendiculars(Imported);
    DeriveTangentBases(Imported);
    DeriveExtents(Imported);

    DescribedRevision = Imported.Revision();

    return Deliver<bool>::Deliver(true);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHAT IS READ
//------------------------------------------------------------------------------------------------------------------------

Deliver<std::uint32_t> TopologyConditioning::WeldedPosition(std::uint32_t VertexOrdinal) const
{
    if (VertexOrdinal >= WeldedPositionOfVertex.size())
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ContentUnsupported, "no such imported vertex" });
    }

    return Deliver<std::uint32_t>::Deliver(WeldedPositionOfVertex[VertexOrdinal]);
}

Deliver<std::uint32_t> TopologyConditioning::AdjacentCorner(std::uint32_t CornerOrdinal) const
{
    if (CornerOrdinal >= AdjacentCornerOfCorner.size())
        return Deliver<std::uint32_t>::Refuse({ RefusalReason::ContentUnsupported, "no such corner" });

    if (AdjacentCornerOfCorner[CornerOrdinal] == AbsentCorner)
    {
        return Deliver<std::uint32_t>::Refuse(
            { RefusalReason::ContentUnsupported, "the edge is a boundary or is non-manifold" });
    }

    return Deliver<std::uint32_t>::Deliver(AdjacentCornerOfCorner[CornerOrdinal]);
}

bool TopologyConditioning::FaceEnrolled(std::uint32_t FaceOrdinal, DegeneracySubject Condition) const
{
    return IntervalEnrolled(EnrolledConditions[static_cast<std::size_t>(Condition)], FaceOrdinal);
}

bool TopologyConditioning::VertexIsolated(std::uint32_t VertexOrdinal) const
{
    if (VertexOrdinal >= WeldedPositionOfVertex.size())
        return false;

    const std::size_t Condition = static_cast<std::size_t>(DegeneracySubject::IsolatedVertex);

    return IntervalEnrolled(EnrolledConditions[Condition], WeldedPositionOfVertex[VertexOrdinal]);
}

const std::vector<EnrolledInterval>& TopologyConditioning::Enrolled(DegeneracySubject Condition) const
{
    return EnrolledConditions[static_cast<std::size_t>(Condition)];
}

const std::vector<SurfaceDirection>&  TopologyConditioning::Perpendiculars() const { return DerivedPerpendiculars; }
const std::vector<TangentBasis>&      TopologyConditioning::TangentBases() const   { return DerivedTangentBases;   }
const std::vector<ConditionedExtent>& TopologyConditioning::FaceExtents() const    { return DerivedFaceExtents;    }

ConditionedExtent TopologyConditioning::TopologyExtent() const     { return WholeExtent;           }
std::uint32_t     TopologyConditioning::WeldedCount() const        { return DistinctPositionCount; }
std::uint64_t     TopologyConditioning::ConditionedRevision() const { return DescribedRevision;    }
bool              TopologyConditioning::TangentBasesRetained() const { return BasesRetained;       }
std::uint32_t     TopologyConditioning::UnorientedCount() const     { return UnorientedFaceCount;  }

}   // namespace Slate
