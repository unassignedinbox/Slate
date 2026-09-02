//============================================================================================================================================
//                                                      SKETCHBOOLEANINTENT.CPP
//============================================================================================================================================

#include "SlateWorkspace/Discipline/SketchBooleanIntent/Api/SketchBooleanIntent.h"

#include <vector>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHICH BOOLEAN
//------------------------------------------------------------------------------------------------------------------------

SketchBooleanIntent ResolveSketchBooleanIntent(ParametricToolSubject Subject)
{
    SketchBooleanIntent Intent = {};

    switch (Subject)
    {
        case ParametricToolSubject::Union:
            Intent.Standing = true;
            Intent.Manner = WorldBooleanManner::Union;
            break;

        // 🔴 BooleanCut, NOT Cut. `Cut` (24u) is the Operations band's per-edge trim-style cut -- it
        //    removes the whole edge under the pointer. The boolean cut is a different operation on two
        //    whole regions, so it has its own subject and the two never collide.
        case ParametricToolSubject::BooleanCut:
            Intent.Standing = true;
            Intent.Manner = WorldBooleanManner::Cut;
            break;

        case ParametricToolSubject::Intersect:
            Intent.Standing = true;
            Intent.Manner = WorldBooleanManner::Intersect;
            break;

        default:
            break;
    }

    return Intent;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  SELECTION → OPERANDS
//------------------------------------------------------------------------------------------------------------------------

WorldLoopName LoopOfCurve(const WorldSketchStructure& Declared, WorldCurveName Curve)
{
    if (!Curve.Assigned())
        return {};

    const std::vector<DeclaredWorldLoop>& Loops = Declared.Loops();
    for (std::size_t Index = 0u; Index < Loops.size(); ++Index)
    {
        for (const WorldCurveUse& Use : Loops[Index].Traversal)
        {
            if (Use.TraversedCurve.IssuedIndex == Curve.IssuedIndex)
            {
                WorldLoopName Named = {};
                Named.IssuedIndex = static_cast<std::uint32_t>(Index + 1u);
                return Named;
            }
        }
    }

    return {};
}

namespace
{

/// 🧩 Whether the analysis found this loop to be a closed region -- a shape a boolean can act on.
bool LoopIsRegion(const WorldSketchAnalysis& Analysis, WorldLoopName Loop)
{
    if (!Loop.Assigned())
        return false;
    for (const WorldLoopAnalysisRecord& Record : Analysis.Loops)
        if (Record.Loop.IssuedIndex == Loop.IssuedIndex)
            return Record.Closed && Record.Coplanar;
    return false;
}

/// 🧩 What one selected curve resolves to: the closed region it outlines, or itself as an open curve.
struct ResolvedPick
{
    bool          Valid  = false;
    WorldLoopName Loop   = {};   // [-] - set when the curve belongs to a closed region
    WorldCurveName Curve = {};   // [-] - set when the curve is a lone open curve (a cutter)
};

ResolvedPick ResolvePick(const WorldSketchStructure& Declared,
                         const WorldSketchAnalysis& Analysis,
                         WorldCurveName Curve)
{
    ResolvedPick Pick = {};
    if (!Curve.Assigned())
        return Pick;

    const WorldLoopName Loop = LoopOfCurve(Declared, Curve);
    if (LoopIsRegion(Analysis, Loop))
    {
        Pick.Valid = true;
        Pick.Loop = Loop;
        return Pick;
    }

    // 📝 Not part of any closed region: a lone curve, which can only be a cutter.
    Pick.Valid = true;
    Pick.Curve = Curve;
    return Pick;
}

/// 🧩 Whether two resolved picks are the same operand -- the same loop, or the same lone curve.
/// note  🔴 SELECTING TWO EDGES OF ONE RECTANGLE IS ONE OPERAND, NOT TWO. Both resolve to the same loop,
///        so a boolean has only one thing selected and must decline rather than act on a shape and itself.
bool SamePick(const ResolvedPick& Left, const ResolvedPick& Right)
{
    if (Left.Loop.Assigned() && Right.Loop.Assigned())
        return Left.Loop.IssuedIndex == Right.Loop.IssuedIndex;
    if (Left.Curve.Assigned() && Right.Curve.Assigned())
        return Left.Curve.IssuedIndex == Right.Curve.IssuedIndex;
    return false;
}

WorldBooleanOperand OperandOf(const ResolvedPick& Pick)
{
    WorldBooleanOperand Operand = {};
    Operand.Loop = Pick.Loop;
    Operand.Curve = Pick.Loop.Assigned() ? WorldCurveName{} : Pick.Curve;
    return Operand;
}

} // namespace

SketchBooleanSelection ResolveSketchBooleanSelection(const WorldSketchStructure& Declared,
                                                     const WorldSketchAnalysis& Analysis,
                                                     WorldBooleanManner Manner,
                                                     const std::vector<WorldCurveName>& Selection)
{
    SketchBooleanSelection Result = {};

    // 🔴 GATHER THE DISTINCT OPERANDS IN SELECTION ORDER. Several selected edges of one region collapse to
    //    one operand, so a boolean does not act on a shape and one of its own sides. The order is kept
    //    because Cut needs it -- the earlier-selected region is the one that survives.
    std::vector<ResolvedPick> Operands;
    for (WorldCurveName Curve : Selection)
    {
        const ResolvedPick Pick = ResolvePick(Declared, Analysis, Curve);
        if (!Pick.Valid)
            continue;

        bool Duplicate = false;
        for (const ResolvedPick& Held : Operands)
            if (SamePick(Held, Pick))
            {
                Duplicate = true;
                break;
            }
        if (!Duplicate)
            Operands.push_back(Pick);
    }

    // 🔴 EXACTLY TWO OPERANDS OR NOTHING. A boolean combines two things; anything else is not one.
    if (Operands.size() != 2u)
        return Result;

    const ResolvedPick& A = Operands[0];
    const ResolvedPick& B = Operands[1];

    if (Manner == WorldBooleanManner::Cut)
    {
        // 🔴 CUT IS NOT SYMMETRIC. The closed region is kept (First) and the other operand is removed
        //    (Second). If both are regions, the earlier-selected one survives. An open curve is only ever
        //    the thing that cuts, never the thing kept.
        if (A.Loop.Assigned())
        {
            Result.First = OperandOf(A);
            Result.Second = OperandOf(B);
        }
        else if (B.Loop.Assigned())
        {
            Result.First = OperandOf(B);
            Result.Second = OperandOf(A);
        }
        else
        {
            // 📝 Two open curves cannot cut anything -- neither is a region to keep.
            return Result;
        }
    }
    else
    {
        // 🔴 UNION AND INTERSECT ARE SYMMETRIC, but they still need two regions -- an open curve has no
        //    area to union or intersect.
        if (!A.Loop.Assigned() || !B.Loop.Assigned())
            return Result;
        Result.First = OperandOf(A);
        Result.Second = OperandOf(B);
    }

    Result.Ready = Result.First.Declared() && Result.Second.Declared();
    return Result;
}

} // namespace Slate
