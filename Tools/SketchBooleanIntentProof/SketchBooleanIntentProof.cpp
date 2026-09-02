// 🧩 Proof for the boolean-tile intent and the two-object selection gesture.
//
// 🔴 THE GESTURE THE ARTIST PERFORMS, MADE INTO CLAIMS. Each of the three tiles resolves to its own
//    boolean; selecting two regions in EITHER order yields the same union or intersection; a Cut keeps the
//    region that was selected first; an open curve can only ever be the cutter; two edges of one shape are
//    one operand, not two; and a selection that is not exactly two operands is refused.

#include "SlateWorkspace/Discipline/SketchBooleanIntent/Api/SketchBooleanIntent.h"

#include <cmath>
#include <cstdio>
#include <vector>

using namespace Slate;

namespace
{

std::uint32_t Claims = 0u;
std::uint32_t Failures = 0u;

void Require(bool Held, const char* Claim)
{
    ++Claims;
    if (!Held)
    {
        ++Failures;
        std::printf("  FAILED  %s\n", Claim);
    }
}

const WorldPlacementFrame Ground = { { 0.0, 0.0, 0.0 }, { 0.0, 1.0, 0.0 }, { 1.0, 0.0, 0.0 } };

WorldLoopName DeclareRectangle(WorldSketchStructure& Sketch,
                               double MinX, double MinZ, double MaxX, double MaxZ)
{
    const WorldCurveName AB = Sketch.DeclareLine({ MinX, 0.0, MinZ }, { MaxX, 0.0, MinZ }, Ground);
    const WorldCurveName BC = Sketch.DeclareLine({ MaxX, 0.0, MinZ }, { MaxX, 0.0, MaxZ }, Ground);
    const WorldCurveName CD = Sketch.DeclareLine({ MaxX, 0.0, MaxZ }, { MinX, 0.0, MaxZ }, Ground);
    const WorldCurveName DA = Sketch.DeclareLine({ MinX, 0.0, MaxZ }, { MinX, 0.0, MinZ }, Ground);
    return Sketch.DeclareLoop({ { { AB, true }, { BC, true }, { CD, true }, { DA, true } } });
}

// 🧩 An open two-segment polyline that does not close, so it names no loop -- a cutter.
WorldCurveName DeclareOpenCurve(WorldSketchStructure& Sketch,
                                const SpatialPoint& Start, const SpatialPoint& End)
{
    return Sketch.DeclareLine(Start, End, Ground);
}

// 🧩 The curves of a loop, as the viewport selection would hand them back.
std::vector<WorldCurveName> CurvesOfLoop(const WorldSketchStructure& Sketch, WorldLoopName Loop)
{
    std::vector<WorldCurveName> Curves;
    const DeclaredWorldLoop* Declared = Sketch.Resolve(Loop);
    if (Declared != nullptr)
        for (const WorldCurveUse& Use : Declared->Traversal)
            Curves.push_back(Use.TraversedCurve);
    return Curves;
}

} // namespace

int main()
{
    std::printf("[SketchBooleanIntentProof] the boolean tiles and the two-object selection gesture\n");

    //----------------------------------------------------------------------------------------------------
    // 1. Each tile resolves to its own boolean, and nothing else does.
    //----------------------------------------------------------------------------------------------------
    {
        Require(ResolveSketchBooleanIntent(ParametricToolSubject::Union).Standing &&
                ResolveSketchBooleanIntent(ParametricToolSubject::Union).Manner == WorldBooleanManner::Union,
                "the Union tile asks for a union");
        Require(ResolveSketchBooleanIntent(ParametricToolSubject::BooleanCut).Standing &&
                ResolveSketchBooleanIntent(ParametricToolSubject::BooleanCut).Manner == WorldBooleanManner::Cut,
                "the boolean Cut tile asks for a cut");
        // 🔴 The Operations band's per-edge Cut is NOT a boolean tool.
        Require(!ResolveSketchBooleanIntent(ParametricToolSubject::Cut).Standing,
                "the Operations-band edge Cut is not a boolean tool");
        Require(ResolveSketchBooleanIntent(ParametricToolSubject::Intersect).Standing &&
                ResolveSketchBooleanIntent(ParametricToolSubject::Intersect).Manner == WorldBooleanManner::Intersect,
                "the Intersect tile asks for an intersection");
        Require(!ResolveSketchBooleanIntent(ParametricToolSubject::Line).Standing,
                "a drawing tile is not a boolean tool");
        Require(!BooleanToolStanding(ParametricToolSubject::Fillet) &&
                BooleanToolStanding(ParametricToolSubject::Union),
                "BooleanToolStanding answers for exactly the boolean tiles");
    }

    //----------------------------------------------------------------------------------------------------
    // 2. A curve is mapped to the region it outlines.
    //----------------------------------------------------------------------------------------------------
    {
        WorldSketchStructure Sketch;
        const WorldLoopName Rect = DeclareRectangle(Sketch, 0.0, 0.0, 100.0, 100.0);
        const std::vector<WorldCurveName> Edges = CurvesOfLoop(Sketch, Rect);
        Require(!Edges.empty() && LoopOfCurve(Sketch, Edges.front()).IssuedIndex == Rect.IssuedIndex,
                "an edge of a rectangle resolves to the rectangle's loop");
        const WorldCurveName Stray = DeclareOpenCurve(Sketch, { 200.0, 0.0, 0.0 }, { 260.0, 0.0, 0.0 });
        Require(!LoopOfCurve(Sketch, Stray).Assigned(),
                "an open curve belongs to no loop");
    }

    //----------------------------------------------------------------------------------------------------
    // 3. UNION of two regions works in EITHER selection order and yields the same pair of regions.
    //----------------------------------------------------------------------------------------------------
    {
        WorldSketchStructure Sketch;
        const WorldLoopName A = DeclareRectangle(Sketch, 0.0, 0.0, 100.0, 100.0);
        const WorldLoopName B = DeclareRectangle(Sketch, 50.0, 50.0, 150.0, 150.0);
        const WorldSketchAnalysis Analysis = AnalyzeWorldSketch(Sketch, 64u);

        std::vector<WorldCurveName> Forward = CurvesOfLoop(Sketch, A);
        for (const WorldCurveName& C : CurvesOfLoop(Sketch, B)) Forward.push_back(C);
        std::vector<WorldCurveName> Backward = CurvesOfLoop(Sketch, B);
        for (const WorldCurveName& C : CurvesOfLoop(Sketch, A)) Backward.push_back(C);

        const SketchBooleanSelection One =
            ResolveSketchBooleanSelection(Sketch, Analysis, WorldBooleanManner::Union, Forward);
        const SketchBooleanSelection Two =
            ResolveSketchBooleanSelection(Sketch, Analysis, WorldBooleanManner::Union, Backward);

        Require(One.Ready && Two.Ready, "a union of two regions is ready in either selection order");
        Require(One.First.NamesLoop() && One.Second.NamesLoop(),
                "both union operands are closed regions");
        // 🔴 Symmetric: the same two loops are named whichever was clicked first.
        const bool SamePair =
            (One.First.Loop.IssuedIndex == Two.First.Loop.IssuedIndex ||
             One.First.Loop.IssuedIndex == Two.Second.Loop.IssuedIndex) &&
            (One.Second.Loop.IssuedIndex == Two.First.Loop.IssuedIndex ||
             One.Second.Loop.IssuedIndex == Two.Second.Loop.IssuedIndex);
        Require(SamePair, "the union names the same two regions regardless of order");
    }

    //----------------------------------------------------------------------------------------------------
    // 4. CUT is NOT symmetric: the region selected first survives as First.
    //----------------------------------------------------------------------------------------------------
    {
        WorldSketchStructure Sketch;
        const WorldLoopName A = DeclareRectangle(Sketch, 0.0, 0.0, 100.0, 100.0);
        const WorldLoopName B = DeclareRectangle(Sketch, 50.0, 50.0, 150.0, 150.0);
        const WorldSketchAnalysis Analysis = AnalyzeWorldSketch(Sketch, 64u);

        std::vector<WorldCurveName> AthenB = CurvesOfLoop(Sketch, A);
        for (const WorldCurveName& C : CurvesOfLoop(Sketch, B)) AthenB.push_back(C);
        std::vector<WorldCurveName> BthenA = CurvesOfLoop(Sketch, B);
        for (const WorldCurveName& C : CurvesOfLoop(Sketch, A)) BthenA.push_back(C);

        const SketchBooleanSelection First =
            ResolveSketchBooleanSelection(Sketch, Analysis, WorldBooleanManner::Cut, AthenB);
        const SketchBooleanSelection Second =
            ResolveSketchBooleanSelection(Sketch, Analysis, WorldBooleanManner::Cut, BthenA);

        Require(First.Ready && First.First.Loop.IssuedIndex == A.IssuedIndex &&
                First.Second.Loop.IssuedIndex == B.IssuedIndex,
                "selecting A then B cuts B out of A");
        Require(Second.Ready && Second.First.Loop.IssuedIndex == B.IssuedIndex &&
                Second.Second.Loop.IssuedIndex == A.IssuedIndex,
                "selecting B then A cuts A out of B");
    }

    //----------------------------------------------------------------------------------------------------
    // 5. CUT by an OPEN curve: the region is First, the curve is Second, in either order.
    //----------------------------------------------------------------------------------------------------
    {
        WorldSketchStructure Sketch;
        const WorldLoopName Rect = DeclareRectangle(Sketch, 0.0, 0.0, 100.0, 100.0);
        const WorldCurveName Knife = DeclareOpenCurve(Sketch, { -20.0, 0.0, 50.0 }, { 120.0, 0.0, 50.0 });
        const WorldSketchAnalysis Analysis = AnalyzeWorldSketch(Sketch, 64u);

        std::vector<WorldCurveName> ShapeThenKnife = CurvesOfLoop(Sketch, Rect);
        ShapeThenKnife.push_back(Knife);
        std::vector<WorldCurveName> KnifeThenShape;
        KnifeThenShape.push_back(Knife);
        for (const WorldCurveName& C : CurvesOfLoop(Sketch, Rect)) KnifeThenShape.push_back(C);

        const SketchBooleanSelection One =
            ResolveSketchBooleanSelection(Sketch, Analysis, WorldBooleanManner::Cut, ShapeThenKnife);
        const SketchBooleanSelection Two =
            ResolveSketchBooleanSelection(Sketch, Analysis, WorldBooleanManner::Cut, KnifeThenShape);

        Require(One.Ready && One.First.NamesLoop() && One.Second.NamesCurve(),
                "a shape then an open curve cuts: region first, curve second");
        Require(Two.Ready && Two.First.NamesLoop() && Two.Second.NamesCurve(),
                "an open curve then a shape cuts the same way -- region is always kept");
    }

    //----------------------------------------------------------------------------------------------------
    // 6. An open curve cannot union or intersect, and is refused there.
    //----------------------------------------------------------------------------------------------------
    {
        WorldSketchStructure Sketch;
        const WorldLoopName Rect = DeclareRectangle(Sketch, 0.0, 0.0, 100.0, 100.0);
        const WorldCurveName Knife = DeclareOpenCurve(Sketch, { -20.0, 0.0, 50.0 }, { 120.0, 0.0, 50.0 });
        const WorldSketchAnalysis Analysis = AnalyzeWorldSketch(Sketch, 64u);

        std::vector<WorldCurveName> Selection = CurvesOfLoop(Sketch, Rect);
        Selection.push_back(Knife);

        Require(!ResolveSketchBooleanSelection(Sketch, Analysis, WorldBooleanManner::Union, Selection).Ready,
                "a union with an open curve is refused");
        Require(!ResolveSketchBooleanSelection(Sketch, Analysis, WorldBooleanManner::Intersect, Selection).Ready,
                "an intersect with an open curve is refused");
    }

    //----------------------------------------------------------------------------------------------------
    // 7. Two edges of ONE region are one operand, so a boolean on a single shape is refused.
    //----------------------------------------------------------------------------------------------------
    {
        WorldSketchStructure Sketch;
        const WorldLoopName Rect = DeclareRectangle(Sketch, 0.0, 0.0, 100.0, 100.0);
        const WorldSketchAnalysis Analysis = AnalyzeWorldSketch(Sketch, 64u);

        const std::vector<WorldCurveName> Edges = CurvesOfLoop(Sketch, Rect);
        std::vector<WorldCurveName> TwoEdges = { Edges[0], Edges[1] };
        Require(!ResolveSketchBooleanSelection(Sketch, Analysis, WorldBooleanManner::Union, TwoEdges).Ready,
                "two edges of one rectangle are one operand, so the union is refused");

        Require(!ResolveSketchBooleanSelection(Sketch, Analysis, WorldBooleanManner::Union, {}).Ready,
                "an empty selection is refused");
    }

    std::printf("[SketchBooleanIntentProof] %u claims, %u failures\n", Claims, Failures);
    return Failures == 0u ? 0 : 1;
}
