//============================================================================================================================================
//                                                       SKETCHBOOLEANINTENT.H
//============================================================================================================================================
// 🧩 What each of the three boolean tiles asks for, and how a two-object selection becomes the ordered pair
//    of operands a boolean is run on.
//
// 🔴 A UNIT OF ITS OWN, AND DELIBERATELY SO. This is the single place a catalogue tile becomes a boolean
//    manner, and the single place a viewport selection of two things becomes a `First`/`Second` operand
//    pair -- and it must be provable without dragging in the recording surface, the camera and the screen
//    picker the host needs. A rule that can only be tested by standing up the whole interface will not be
//    tested. Mirrors `AnnotationIntent`, which does the same for the dimension and constraint tiles.
//
// 📝 Pure data and pure queries. A tool subject in, a manner out; a sketch, its analysis and two selected
//    curves in, an ordered operand pair out. No pointer, no camera, no surface.

#pragma once

#include "SlateShape/World/WorldSketchAnalysis/Api/WorldSketchAnalysis.h"
#include "SlateShape/World/WorldSketchBoolean/Api/WorldSketchBoolean.h"
#include "SlateShape/World/WorldSketchStructure/Api/WorldSketchStructure.h"
#include "SlateUI/Interface/ParametricTools/Api/ParametricToolsSpecification.h"

#include <vector>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     WHICH BOOLEAN
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 What one of the three boolean tiles asks for.
struct SketchBooleanIntent
{
    bool                Standing = false;                     // [-] - whether this tool is a boolean tool at all
    WorldBooleanManner  Manner   = WorldBooleanManner::Union; // [-] - which boolean, when Standing
};

/// 🧩 What a catalogue tile means, resolved once.
/// tag   api, nonthrowing
SketchBooleanIntent ResolveSketchBooleanIntent(ParametricToolSubject Subject);

/// 🧩 Whether a tool is one of the three this arm drives.
inline bool BooleanToolStanding(ParametricToolSubject Subject)
{
    return ResolveSketchBooleanIntent(Subject).Standing;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  SELECTION → OPERANDS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 The outcome of turning a selection into a boolean's two operands.
struct SketchBooleanSelection
{
    bool                 Ready  = false;   // [-] - two operands were resolved and suit the manner
    WorldBooleanOperand  First  = {};      // [-] - the shape the boolean is built on
    WorldBooleanOperand  Second = {};      // [-] - the other shape, or the open curve that cuts the first
};

/// 🧩 Which loop, if any, a curve belongs to.
/// out   Loop  [-] the loop whose traversal names this curve; unassigned when the curve is in no loop
/// note  📝 A curve in more than one loop returns the first that names it; the selection gesture only ever
///        needs "is this an outline of a region", and a shared edge still answers that with a region.
/// tag   api, nonthrowing
WorldLoopName LoopOfCurve(const WorldSketchStructure& Declared, WorldCurveName Curve);

/// 🧩 Turns two selected curves into the ordered operand pair a boolean runs on -- in EITHER order.
/// in    Declared   [-] the sketch the curves live in
/// in    Analysis   [-] its analysis, used to know which loops are closed regions
/// in    Manner     [-] which boolean the artist chose, which decides what an operand is allowed to be
/// in    Selection  [-] the world curves the artist selected, in selection order
/// note  🔴 EITHER ORDER, AND THE MANNER DECIDES THE ROLES. Union and Intersect are symmetric, so the two
///        selected regions become First and Second by loop index and the artist need not care which was
///        clicked first. Cut is NOT symmetric -- it keeps the first and removes the second -- so the rule
///        is: the closed region is First and the other operand (a second region, or an open curve that
///        crosses it) is Second, whichever was selected first. Selecting two regions for a Cut keeps the
///        earlier-selected region as the one that survives.
/// note  🔴 EXACTLY TWO OPERANDS. More or fewer than two distinct operands is not a boolean; the result
///        reports `Ready = false` so the tile declines rather than guessing which two were meant.
/// tag   api, nonthrowing
SketchBooleanSelection ResolveSketchBooleanSelection(const WorldSketchStructure& Declared,
                                                     const WorldSketchAnalysis& Analysis,
                                                     WorldBooleanManner Manner,
                                                     const std::vector<WorldCurveName>& Selection);

} // namespace Slate
