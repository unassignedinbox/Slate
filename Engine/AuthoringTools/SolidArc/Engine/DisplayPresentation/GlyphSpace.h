//============================================================================================================================================
//                                                        GLYPHSPACE.H
//============================================================================================================================================

// 📦 SVG path data (lucide 24 × 24 stroke glyphs) → flattened polylines, for the editor's stroke-drawn glyphs.
//
//    Supports the full SVG path command set the glyph tables use: M m L l H h V v C c S s Q q T t A a Z z.
//    Arcs are converted centre-parameterised (SVG F.6.5) and flattened with a fixed angular step; cubics and
//    quadratics are flattened with uniform parameter steps. Precision is more than adequate for 16–24 px
//    stroke icons.
//
//    Coordinate convention: viewBox units, origin top-left, +Y down — the same as the SVG source, so no flip.
//    The engine's overlay host strokes these onto a PixelSpace through the same flattener; the CAD editor's
//    outliner consumes Flatten alone and strokes the contours with its own ImGui draw list, so the surface
//    half of the engine's GlyphSpace stays behind and only the flattener travels with the panels.

#pragma once

#include <cstdint>
#include <string_view>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                      PLANE POINT
//------------------------------------------------------------------------------------------------------------------------

struct PlanePoint
{
    float X = 0.0f;          // [viewBox units]
    float Y = 0.0f;          // [viewBox units]
};

//------------------------------------------------------------------------------------------------------------------------
//                                                      GLYPH SPACE
//------------------------------------------------------------------------------------------------------------------------

class GlyphSpace
{
public:
    // Flatten an SVG path (viewBox units) into sub-path polylines. Each sub-path carries a Closed flag so the
    //    stroke joins its ends (Z) or leaves them open (lucide caps are round; ImGui renders butt caps).
    struct Contour
    {
        std::vector<PlanePoint> Points;   // [viewBox units]
        bool                    Closed = false;
    };

    [[nodiscard]] static std::vector<Contour> Flatten(std::string_view SvgPath) noexcept;

private:
    static constexpr int   CurveSegments = 12;          // per cubic / quadratic
    static constexpr float ArcStepRadians = 0.2618f;    // 15° per arc segment
};

} // namespace Frontier
