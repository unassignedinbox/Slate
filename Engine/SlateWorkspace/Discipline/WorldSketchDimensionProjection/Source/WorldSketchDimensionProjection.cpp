//============================================================================================================================================
//                                               WORLDSKETCHDIMENSIONPROJECTION.CPP
//============================================================================================================================================

#include "SlateWorkspace/Discipline/WorldSketchDimensionProjection/Api/WorldSketchDimensionProjection.h"

#include "Shared/WorkspaceCadNearClip.slang.h"
#include "SlateWorkspace/Discipline/AnnotationSession/Api/AnnotationSession.h"

#include <algorithm>
#include <cmath>
#include <cstring>

namespace Slate
{

namespace
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    WORLD TO SCREEN
//------------------------------------------------------------------------------------------------------------------------

// 📝 The same projection the curve renderer uses, and deliberately the same arithmetic: a dimension drawn
//    through a different path would drift off its own geometry by a pixel at some zoom levels, which is
//    exactly the staleness the whole design exists to prevent.
WorkspaceCadProjectedPoint ProjectPoint(const ResolvedCamera& Camera,
                                        const PlaneExtent& Extent,
                                        const SpatialPoint& Position)
{
    WorkspaceCadProjectedPoint Point = {};
    if (!Camera.Perspective)
    {
        float ScreenX = 0.0f;
        float ScreenY = 0.0f;
        static_cast<void>(ProjectFromCamera(Camera, Extent, Position, ScreenX, ScreenY));
        Point.X = ScreenX;
        Point.Y = ScreenY;
        Point.W = 1.0f;
        return Point;
    }

    const SpatialDirection EyeToPoint = Difference(Camera.Frame.Eye, Position);
    const double CameraX = Dot(EyeToPoint, Camera.Frame.Right);
    const double CameraY = Dot(EyeToPoint, Camera.Frame.Up);
    const double CameraZ = Dot(EyeToPoint, Camera.Frame.Forward);
    const double TanHalf = std::tan(Camera.FieldOfViewDegrees * 0.5 * ProjectionPi / 180.0);
    const double Focal = (Extent.Height() * 0.5) / (TanHalf > 1.0e-6 ? TanHalf : 1.0e-6);
    const double CentreX = Extent.MinimumX + Extent.Width() * 0.5;
    const double CentreY = Extent.MinimumY + Extent.Height() * 0.5;

    Point.X = static_cast<Real32>(CentreX * CameraZ + Focal * CameraX);
    Point.Y = static_cast<Real32>(CentreY * CameraZ - Focal * CameraY);
    Point.W = static_cast<Real32>(CameraZ);
    return Point;
}

//------------------------------------------------------------------------------------------------------------------------
//                                              A POINT, ALREADY ON THE SCREEN
//------------------------------------------------------------------------------------------------------------------------

// 🔴 THE DECORATION IS BUILT IN SCREEN SPACE, AND THIS IS WHY. An arrowhead, a witness gap and a
//    leader are drafting furniture whose size is about legibility, not about the model -- three
//    millimetres of arrowhead is invisible on a metre-wide plan and swallows a four-millimetre feature
//    whole. Sizing them in world units is exactly the bug the screenshots show: on a small feature the
//    arrows grew as long as the dimension, the short-span "flip" fired, and the barbs shot off the ends
//    into scribble. So every anchor is projected to the screen ONCE, and the furniture is laid out
//    around it in pixels, the way every CAD package draws it.
struct ScreenPoint
{
    double X = 0.0;
    double Y = 0.0;
    bool   Front = true;    // [-] - false when the anchor is behind a perspective eye
};

ScreenPoint ToScreen(const ResolvedCamera& Camera, const PlaneExtent& Extent, const SpatialPoint& World)
{
    const WorkspaceCadProjectedPoint Projected = ProjectPoint(Camera, Extent, World);
    ScreenPoint Screen = {};
    if (Camera.Perspective && Projected.W <= 0.0f)
    {
        Screen.Front = false;
        return Screen;
    }
    const WorkspaceCadScreenPoint Resolved = ResolveWorkspaceCadScreenPoint(Projected);
    Screen.X = Resolved.X;
    Screen.Y = Resolved.Y;
    Screen.Front = true;
    return Screen;
}

struct ScreenVector
{
    double X = 0.0;
    double Y = 0.0;
};

ScreenVector Between(const ScreenPoint& From, const ScreenPoint& To)
{
    return { To.X - From.X, To.Y - From.Y };
}

ScreenVector Unit(const ScreenVector& Vector)
{
    const double Length = std::sqrt(Vector.X * Vector.X + Vector.Y * Vector.Y);
    if (!(Length > 1.0e-9))
        return { 1.0, 0.0 };
    return { Vector.X / Length, Vector.Y / Length };
}

void AddScreenStroke(WorkspaceCadPacket& Delivered,
                     const ScreenPoint& A,
                     const ScreenPoint& B,
                     Unsigned32 Packed,
                     Real32 Thickness)
{
    if (!A.Front || !B.Front)
        return;
    Delivered.AddSegment(static_cast<Real32>(A.X), static_cast<Real32>(A.Y),
                         static_cast<Real32>(B.X), static_cast<Real32>(B.Y),
                         Packed, Thickness);
}

// 🧩 One arrowhead, two barbs, laid out in screen pixels at the tip and pointing along `Facing`.
// note  📝 Two strokes, always: the proof counts a linear dimension's line work down to the barb, and
//        every downstream reader expects an arrowhead to be a pair of barbs rather than a filled glyph
//        the shared packet has no way to carry.
void AddScreenArrow(WorkspaceCadPacket& Delivered,
                    const ScreenPoint& Tip,
                    const ScreenVector& Facing,
                    const WorldDimensionRenderingStyle& Style,
                    Unsigned32 Packed)
{
    if (!Tip.Front)
        return;

    const ScreenVector Along = Unit(Facing);
    const ScreenVector Across = { -Along.Y, Along.X };
    const double Length = static_cast<double>(Style.ArrowScreenLength);
    const double Half = static_cast<double>(Style.ArrowScreenHalfWidth);

    // 📝 The tip is at the point; the two barbs run back along -Facing and out to each side, so the
    //    arrowhead opens away from where it points.
    const ScreenPoint Left = { Tip.X - Along.X * Length + Across.X * Half,
                               Tip.Y - Along.Y * Length + Across.Y * Half, true };
    const ScreenPoint Right = { Tip.X - Along.X * Length - Across.X * Half,
                                Tip.Y - Along.Y * Length - Across.Y * Half, true };

    AddScreenStroke(Delivered, Tip, Left, Packed, Style.LineThickness);
    AddScreenStroke(Delivered, Tip, Right, Packed, Style.LineThickness);
}

// 🧩 The screen point a pixel offset along a screen direction reaches from an anchor.
ScreenPoint Along(const ScreenPoint& From, const ScreenVector& Direction, double Pixels)
{
    const ScreenVector Step = Unit(Direction);
    return { From.X + Step.X * Pixels, From.Y + Step.Y * Pixels, From.Front };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE FIGURE CHIP
//------------------------------------------------------------------------------------------------------------------------

// 🧩 Composes and places the chip for one dimension, at a screen anchor.
bool BuildChip(const WorldSketchStructure& Declared,
               WorldDimensionName Subject,
               MeasureUnit Unit,
               bool IsSelected,
               const ScreenPoint& Anchor,
               const WorldDimensionRenderingStyle& Style,
               DimensionFigureChip& Chip)
{
    if (!Anchor.Front)
        return false;

    Chip = {};
    Chip.Subject = Subject;
    Chip.Selected = IsSelected;
    ComposeDimensionLabel(Declared, Subject, Unit, true, Chip.Figure, DimensionFigureLimit);

    const Real32 Wide = static_cast<Real32>(std::strlen(Chip.Figure)) * Style.FigureCharacterWidth;
    const Real32 HalfWide = Wide * 0.5f + Style.ChipPaddingX;
    const Real32 HalfHigh = Style.FigureHeight * 0.5f + Style.ChipPaddingY;

    Chip.Body = PlaneExtent{ static_cast<Real32>(Anchor.X) - HalfWide,
                             static_cast<Real32>(Anchor.Y) - HalfHigh,
                             static_cast<Real32>(Anchor.X) + HalfWide,
                             static_cast<Real32>(Anchor.Y) + HalfHigh };
    Chip.TextX = static_cast<Real32>(Anchor.X) - Wide * 0.5f;
    Chip.TextY = static_cast<Real32>(Anchor.Y) - Style.FigureHeight * 0.5f;
    return true;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE PROJECTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> ProjectWorldSketchDimensions(const WorldSketchStructure& Declared,
                                           const ResolvedCamera& Camera,
                                           const PlaneExtent& PhysicalExtent,
                                           MeasureUnit Unit,
                                           WorkspaceCadPacket& Delivered,
                                           std::vector<DimensionFigureChip>& Figures,
                                           WorldDimensionName Selected,
                                           const WorldDimensionRenderingStyle& Style)
{
    Figures.clear();

    for (std::uint32_t Index = 1u; Index <= Declared.DimensionCount(); ++Index)
    {
        const WorldDimensionName Subject = { Index };

        // 🔴 RE-DERIVED, NEVER REMEMBERED. This is the frame-by-frame call that makes a dimension track
        //    the geometry it measures. Caching the result across frames would reintroduce, at this
        //    layer, precisely the staleness the geometry layer was written to make impossible.
        const Deliver<DimensionGeometry> Drawn = ResolveDimensionGeometry(Declared, Subject);

        // 🔴 GONE MEANS NOT DRAWN. A dimension whose edge was deleted has nothing to measure; drawing it
        //    at the origin would put a figure in the middle of the model reporting a length that is not
        //    there. Skipping is the honest answer.
        if (!Drawn.Resolved)
            continue;

        const DimensionGeometry& Geometry = Drawn.Delivered;
        const bool IsSelected = Selected.Assigned() && Selected.IssuedIndex == Index;
        const Unsigned32 LineColour = IsSelected ? Style.SelectedLineColour : Style.LineColour;

        DimensionFigureChip Chip = {};
        bool HasChip = false;

        switch (Geometry.Drawing)
        {
            //--------------------------------------------------------------------------------------------
            // ① A LENGTH: two witness lines, a dimension line between them, an arrowhead at each end.
            //--------------------------------------------------------------------------------------------
            case DimensionDrawing::Linear:
            {
                const ScreenPoint MeasuredA = ToScreen(Camera, PhysicalExtent, Geometry.MeasuredStart);
                const ScreenPoint MeasuredB = ToScreen(Camera, PhysicalExtent, Geometry.MeasuredEnd);
                const ScreenPoint LineA = ToScreen(Camera, PhysicalExtent, Geometry.LineStart);
                const ScreenPoint LineB = ToScreen(Camera, PhysicalExtent, Geometry.LineEnd);

                // ── Witness lines, with the small gap CAD drawings leave off the edge and a little
                //    overshoot past the dimension line. Sized in pixels, so they never balloon.
                const ScreenVector OutA = Between(MeasuredA, LineA);
                const ScreenVector OutB = Between(MeasuredB, LineB);
                AddScreenStroke(Delivered,
                                Along(MeasuredA, OutA, Style.WitnessScreenGap),
                                Along(LineA, OutA, Style.WitnessScreenOvershoot),
                                Style.WitnessColour, Style.WitnessThickness);
                AddScreenStroke(Delivered,
                                Along(MeasuredB, OutB, Style.WitnessScreenGap),
                                Along(LineB, OutB, Style.WitnessScreenOvershoot),
                                Style.WitnessColour, Style.WitnessThickness);

                // ── The dimension line and its two arrowheads, pointing outward toward the witnesses.
                AddScreenStroke(Delivered, LineA, LineB, LineColour, Style.LineThickness);
                const ScreenVector AlongLine = Between(LineA, LineB);
                AddScreenArrow(Delivered, LineA, { -AlongLine.X, -AlongLine.Y }, Style, LineColour);
                AddScreenArrow(Delivered, LineB, AlongLine, Style, LineColour);

                const ScreenPoint TextAt = ToScreen(Camera, PhysicalExtent, Geometry.TextAt);
                HasChip = BuildChip(Declared, Subject, Unit, IsSelected, TextAt, Style, Chip);
                break;
            }

            //--------------------------------------------------------------------------------------------
            // ② A DIAMETER: a chord rim-to-rim through the centre, an arrow at each rim, and a short
            //    leader out to the figure.
            //--------------------------------------------------------------------------------------------
            case DimensionDrawing::Diameter:
            {
                const ScreenPoint RimNear = ToScreen(Camera, PhysicalExtent, Geometry.MeasuredStart);
                const ScreenPoint RimFar = ToScreen(Camera, PhysicalExtent, Geometry.MeasuredEnd);
                const ScreenPoint Standoff = ToScreen(Camera, PhysicalExtent, Geometry.LineEnd);

                AddScreenStroke(Delivered, RimNear, RimFar, LineColour, Style.LineThickness);
                const ScreenVector Chord = Between(RimNear, RimFar);
                AddScreenArrow(Delivered, RimNear, { -Chord.X, -Chord.Y }, Style, LineColour);
                AddScreenArrow(Delivered, RimFar, Chord, Style, LineColour);

                // ── The leader from the far rim out to the chip.
                AddScreenStroke(Delivered, RimFar, Standoff, LineColour, Style.LineThickness);

                HasChip = BuildChip(Declared, Subject, Unit, IsSelected,
                                    ToScreen(Camera, PhysicalExtent, Geometry.TextAt), Style, Chip);
                break;
            }

            //--------------------------------------------------------------------------------------------
            // ③ A RADIUS: a leader from the centre to the rim with a single arrow, a dot at the centre,
            //    and a short leader out to the figure.
            //--------------------------------------------------------------------------------------------
            case DimensionDrawing::Radial:
            {
                const ScreenPoint Centre = ToScreen(Camera, PhysicalExtent, Geometry.MeasuredStart);
                const ScreenPoint Rim = ToScreen(Camera, PhysicalExtent, Geometry.MeasuredEnd);
                const ScreenPoint Standoff = ToScreen(Camera, PhysicalExtent, Geometry.LineEnd);

                AddScreenStroke(Delivered, Centre, Rim, LineColour, Style.LineThickness);
                AddScreenArrow(Delivered, Rim, Between(Centre, Rim), Style, LineColour);
                AddScreenStroke(Delivered, Rim, Standoff, LineColour, Style.LineThickness);

                // ── A small cross at the centre, so a radius reads as one even when its rim leader is
                //    short. Drawn in pixels because it is a mark, not a measurement.
                if (Centre.Front)
                {
                    const double Dot = static_cast<double>(Style.CentreDotScreenRadius);
                    AddScreenStroke(Delivered, { Centre.X - Dot, Centre.Y, true },
                                    { Centre.X + Dot, Centre.Y, true }, LineColour, Style.LineThickness);
                    AddScreenStroke(Delivered, { Centre.X, Centre.Y - Dot, true },
                                    { Centre.X, Centre.Y + Dot, true }, LineColour, Style.LineThickness);
                }

                HasChip = BuildChip(Declared, Subject, Unit, IsSelected,
                                    ToScreen(Camera, PhysicalExtent, Geometry.TextAt), Style, Chip);
                break;
            }

            //--------------------------------------------------------------------------------------------
            // ④ AN ANGLE: an arc swept between the two rays from the corner, an arrowhead at each end,
            //    and the figure on the bisector.
            //--------------------------------------------------------------------------------------------
            case DimensionDrawing::Angular:
            {
                const SpatialPoint Vertex = Geometry.AngleVertex;
                const SpatialDirection ToStart = Difference(Vertex, Geometry.MeasuredStart);
                const SpatialDirection ToEnd = Difference(Vertex, Geometry.MeasuredEnd);
                const double Radius = std::sqrt(LengthSquared(ToStart));
                const SpatialDirection AlongStart = Normalize(ToStart);
                const SpatialDirection AlongEnd = Normalize(ToEnd);
                const SpatialDirection Normal = Normalize(Geometry.Frame.Normal);

                // 🔴 THE ARC IS TESSELLATED IN THE PLANE, NOT ON THE SCREEN. Rotating the start ray about
                //    the sketch normal keeps every point of the arc flat in the drawing plane, so the arc
                //    stays a true arc as the camera orbits rather than smearing into screen space.
                const double Sweep = Geometry.Measured;                 // [-] - radians
                const double Turn = Dot(Cross(AlongStart, AlongEnd), Normal) < 0.0 ? -Sweep : Sweep;
                const std::uint32_t Steps =
                    static_cast<std::uint32_t>(std::clamp(std::fabs(Turn) / 0.10, 6.0, 48.0));

                ScreenPoint Previous = ToScreen(Camera, PhysicalExtent,
                                                Added(Vertex, Scaled(AlongStart, Radius)));
                ScreenPoint FirstScreen = Previous;
                ScreenPoint SecondScreen = Previous;
                ScreenPoint LastScreen = Previous;
                ScreenPoint PenultimateScreen = Previous;
                for (std::uint32_t Step = 1u; Step <= Steps; ++Step)
                {
                    const double Fraction = static_cast<double>(Step) / static_cast<double>(Steps);
                    const SpatialDirection Swept = RotateAroundAxis(AlongStart, Normal, Turn * Fraction);
                    const ScreenPoint Here = ToScreen(Camera, PhysicalExtent,
                                                      Added(Vertex, Scaled(Swept, Radius)));
                    AddScreenStroke(Delivered, Previous, Here, LineColour, Style.LineThickness);
                    if (Step == 1u)
                        SecondScreen = Here;
                    PenultimateScreen = Previous;
                    LastScreen = Here;
                    Previous = Here;
                }

                // ── The two rays from the corner out to the arc, drawn faintly so the corner reads.
                const ScreenPoint VertexScreen = ToScreen(Camera, PhysicalExtent, Vertex);
                AddScreenStroke(Delivered, VertexScreen, FirstScreen, Style.WitnessColour,
                                Style.WitnessThickness);
                AddScreenStroke(Delivered, VertexScreen, LastScreen, Style.WitnessColour,
                                Style.WitnessThickness);

                // ── An arrowhead at each end of the arc, pointing along the arc's tangent.
                AddScreenArrow(Delivered, FirstScreen, Between(SecondScreen, FirstScreen),
                               Style, LineColour);
                AddScreenArrow(Delivered, LastScreen, Between(PenultimateScreen, LastScreen),
                               Style, LineColour);

                static_cast<void>(AlongEnd);
                HasChip = BuildChip(Declared, Subject, Unit, IsSelected,
                                    ToScreen(Camera, PhysicalExtent, Geometry.TextAt), Style, Chip);
                break;
            }
        }

        if (HasChip)
            Figures.push_back(Chip);
    }

    return Deliver<bool>::Result(true);
}

//------------------------------------------------------------------------------------------------------------------------

WorldDimensionName ResolveDimensionFigureAt(const std::vector<DimensionFigureChip>& Figures,
                                            double PositionX,
                                            double PositionY)
{
    // 📝 Backwards, so the chip drawn last -- the one on top where they overlap -- is the one hit.
    for (std::size_t Index = Figures.size(); Index-- > 0u;)
    {
        const DimensionFigureChip& Chip = Figures[Index];
        if (Chip.Body.Encloses(static_cast<float>(PositionX), static_cast<float>(PositionY)))
            return Chip.Subject;
    }
    return {};
}

} // namespace Slate
