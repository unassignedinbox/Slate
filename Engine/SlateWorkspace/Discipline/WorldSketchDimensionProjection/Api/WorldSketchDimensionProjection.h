//============================================================================================================================================
//                                                WORLDSKETCHDIMENSIONPROJECTION.H
//============================================================================================================================================
// 🧩 Draws the dimensions: witness lines, dimension lines, arrowheads and the figure chips, projected from
//    world millimetres into the screen-space CAD packet the GPU pass rasterises.
//
// 🔴 THE LINE WORK GOES IN THE PACKET; THE TEXT COMES BACK OUT. `WorkspaceCadPacket` carries segments,
//    triangles and markers -- it has no glyphs, and teaching it text would mean a font atlas in the shared
//    shader header. So this projection returns the figure chips as screen-space rectangles with their
//    strings already composed, and the caller draws them with the interface's text recorder. The geometry
//    is on the GPU with the rest of the sketch; only the labels ride back.
//
// 🔴 NOTHING IS CACHED BETWEEN FRAMES. Every dimension is re-derived from live geometry through
//    `ResolveDimensionGeometry` on every call, so a dimension cannot survive the edit that invalidated it.
//    This is the same guarantee the geometry layer makes, kept intact by not storing anything here either.
//
// 📝 Arrowheads are drawn as two short strokes rather than filled triangles: the packet's fill list is
//    reserved for shape interiors, and a stroked arrow reads correctly at every zoom without hinting.

#pragma once

#include "Foundation/DeliveryGuarantee.h"
#include "Foundation/MeasureDisplay.h"
#include "Shared/WorkspaceCadPacket.slang.h"
#include "SlateShape/World/WorldSketchDimensionGeometry/Api/WorldSketchDimensionGeometry.h"
#include "SlateShape/World/WorldSketchStructure/Api/WorldSketchStructure.h"
#include "SlateWorkspace/Discipline/ViewportProjection/Api/ViewportProjection.h"

#include <cstdint>
#include <vector>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE STYLE
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 How dimensions are drawn, kept apart from the curve style so annotation never restyles geometry.
/// note  🔴 WHITE, NOT YELLOW. A dimension is annotation laid over the drawing, and it reads as a
///        drafting figure only when it is the neutral white of ink on a plan -- a saturated yellow
///        line is indistinguishable from a highlighted edge and turns a clean dimension into scribble.
///        The selected figure brightens to full opacity rather than changing hue, so selection is
///        legible without the annotation ever stopping being white.
struct WorldDimensionRenderingStyle
{
    Unsigned32 LineColour         = PackWorkspaceCadColour(236u, 240u, 244u, 235u);
    Unsigned32 SelectedLineColour = PackWorkspaceCadColour(255u, 255u, 255u, 255u);
    Unsigned32 WitnessColour      = PackWorkspaceCadColour(236u, 240u, 244u, 150u);
    Real32     LineThickness      = 1.3f;
    Real32     WitnessThickness   = 1.0f;

    /// 🧩 How wide an arrowhead opens, as a fraction of its reach.
    Real32 ArrowSpread = 0.36f;

    //--------------------------------------------------------------------------------------------------------------------
    // 🔴 THE DECORATION IS SIZED IN SCREEN PIXELS, NOT WORLD MILLIMETRES. An arrowhead measured in
    //    millimetres is three millimetres long whether the feature is a metre wide or four millimetres
    //    wide -- and on the small feature the arrowheads are nearly as long as the whole dimension, so
    //    the outward-flip fires and the barbs shoot off both ends into the scribble the bug reports.
    //    Every drafting tool draws its arrows, gaps and leaders at a fixed pixel size so a dimension
    //    reads the same at every zoom; these are those sizes, in framebuffer pixels.
    //--------------------------------------------------------------------------------------------------------------------

    /// 🧩 How long an arrowhead is, along the dimension line, in screen pixels.
    Real32 ArrowScreenLength = 11.0f;

    /// 🧩 How far an arrowhead opens to each side, in screen pixels.
    Real32 ArrowScreenHalfWidth = 3.6f;

    /// 🧩 The small gap CAD drawings leave between an edge and the witness line that measures it.
    Real32 WitnessScreenGap = 5.0f;

    /// 🧩 How far a witness line runs on past the dimension line, in screen pixels.
    Real32 WitnessScreenOvershoot = 7.0f;

    /// 🧩 The radius of the dot drawn at a radial dimension's centre, in screen pixels.
    Real32 CentreDotScreenRadius = 2.6f;

    /// 🧩 Half the size of the chip drawn behind a figure, in screen pixels.
    Real32 ChipPaddingX = 5.0f;
    Real32 ChipPaddingY = 3.0f;

    /// 🧩 Roughly how wide one character of the figure is, in screen pixels.
    /// note  📝 The chip is sized here rather than measured by the font, because this unit must stay
    ///        provable without a device. The caller may re-measure and widen it; it may not shrink it.
    Real32 FigureCharacterWidth = 7.0f;
    Real32 FigureHeight         = 14.0f;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE FIGURES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 How long a composed figure can be, including its prefix, unit and terminator.
constexpr std::uint32_t DimensionFigureLimit = 48u;

/// 🧩 One dimension's figure, already composed and already placed in screen pixels.
struct DimensionFigureChip
{
    /// 🧩 Which dimension this belongs to, so a click on the chip can find it again.
    WorldDimensionName Subject = {};

    /// 🧩 The text, terminated, e.g. "⌀42.00 mm".
    char Figure[DimensionFigureLimit] = {};

    /// 🧩 The chip's rectangle in physical screen pixels.
    PlaneExtent Body = {};

    /// 🧩 Where the text baseline starts inside the chip.
    Real32 TextX = 0.0f;
    Real32 TextY = 0.0f;

    /// 🧩 Whether the dimension is currently selected.
    bool Selected = false;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE PROJECTION
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Projects every dimension in the sketch into the packet, and hands back the figure chips.
/// out   Delivered  [-] gains the witness lines, dimension lines and arrowheads
/// out   Figures    [-] cleared, then filled with one chip per dimension that could be drawn
/// note  🔴 A dimension whose geometry has gone is SKIPPED, not drawn at the origin. Deleting an edge
///        that carried a dimension must not leave a stray figure floating at world zero.
/// note  📝 Appends. The caller resets the packet once for the whole sketch, so dimensions land beside
///        the curves rather than replacing them.
/// cost  🚩
/// tag   api, nonthrowing
Deliver<bool> ProjectWorldSketchDimensions(const WorldSketchStructure& Declared,
                                           const ResolvedCamera& Camera,
                                           const PlaneExtent& PhysicalExtent,
                                           MeasureUnit Unit,
                                           WorkspaceCadPacket& Delivered,
                                           std::vector<DimensionFigureChip>& Figures,
                                           WorldDimensionName Selected = {},
                                           const WorldDimensionRenderingStyle& Style = {});

/// 🧩 The dimension whose figure chip sits under a screen position, if any.
/// note  📝 Double-clicking the chip is how a dimension is edited, so the chips have to be hit-testable.
///        They are tested in reverse order, so the one drawn last -- on top -- is the one found.
/// tag   api, nonthrowing
WorldDimensionName ResolveDimensionFigureAt(const std::vector<DimensionFigureChip>& Figures,
                                            double PositionX,
                                            double PositionY);

} // namespace Slate
