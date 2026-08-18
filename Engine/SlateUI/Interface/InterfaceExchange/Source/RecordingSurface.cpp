//============================================================================================================================================
//                                                          RECORDINGSURFACE.CPP
//============================================================================================================================================
// 🧩 The second and last translation unit that names ImGui.

#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"

#include "imgui.h"

#include <cfloat>
#include <cmath>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     VENDOR CONVERSION
//------------------------------------------------------------------------------------------------------------------------

namespace
{

constexpr std::uint32_t ConfineCeiling  = 16u;   // [-] - nesting depth a scroll extent may reach
constexpr float         EmphaticOffset  = 0.34f; // [px] - the second recording's displacement

ImU32 Vendor(InkOrdinate Ink)
{
    return IM_COL32(Ink.Red, Ink.Green, Ink.Blue, Ink.Opacity);
}

ImDrawFlags VendorCorners(std::uint32_t Corners)
{
    ImDrawFlags Declared = ImDrawFlags_None;

    if ((Corners & CornerLeadingUpper)  != 0u) Declared |= ImDrawFlags_RoundCornersTopLeft;
    if ((Corners & CornerTrailingUpper) != 0u) Declared |= ImDrawFlags_RoundCornersTopRight;
    if ((Corners & CornerTrailingLower) != 0u) Declared |= ImDrawFlags_RoundCornersBottomRight;
    if ((Corners & CornerLeadingLower)  != 0u) Declared |= ImDrawFlags_RoundCornersBottomLeft;

    // 📝 The vendor treats an all-absent mask as "decide for me" rather than as "square", so an explicit
    //    none is spelled here. A card that rounded itself because its mask was empty would be a corner
    //    radius nobody wrote and nobody could find.
    if (Declared == ImDrawFlags_None)
        Declared = ImDrawFlags_RoundCornersNone;

    return Declared;
}

ImDrawList* Commands(void* Slot)
{
    return static_cast<ImDrawList*>(Slot);
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE ADOPTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> RecordingSurface::Adopt(ShellLayer Layer)
{
    if (ImGui::GetCurrentContext() == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no interface context is current" });

    // 📝 A shell list rather than a window's. The shell covers the whole drawable extent and owns no
    //    window, so a window's list would clip the drawers to a region the source does not have.
    // 🔴 The FOREGROUND list for `Above`. Every ImGui window — including a docked workspace filling the
    //    whole body — records between the two, so drawers laid into the background were painted over by
    //    the first workspace that docked full-width.
    CommandSlot = (Layer == ShellLayer::Above)
                ? static_cast<void*>(ImGui::GetForegroundDrawList())
                : static_cast<void*>(ImGui::GetBackgroundDrawList());

    if (CommandSlot == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no command list is open" });

    const ImGuiIO& Arrived = ImGui::GetIO();

    ArrivedPointer.PositionAlong   = Arrived.MousePos.x;
    ArrivedPointer.PositionAcross  = Arrived.MousePos.y;
    ArrivedPointer.TravelAlong     = Arrived.MouseDelta.x;
    ArrivedPointer.TravelAcross    = Arrived.MouseDelta.y;
    ArrivedPointer.WheelAcross     = Arrived.MouseWheel;
    ArrivedPointer.ContactHeld     = ImGui::IsMouseDown(ImGuiMouseButton_Left);
    ArrivedPointer.ContactArrived  = ImGui::IsMouseClicked(ImGuiMouseButton_Left);
    ArrivedPointer.ContactReleased = ImGui::IsMouseReleased(ImGuiMouseButton_Left);
    ArrivedPointer.HeldDuration    = ArrivedPointer.ContactHeld
                                   ? static_cast<double>(Arrived.MouseDownDuration[0]) * 1000.0
                                   : 0.0;

    ArrivedDisplay.ExtentAlong  = Arrived.DisplaySize.x;
    ArrivedDisplay.ExtentAcross = Arrived.DisplaySize.y;
    ArrivedDisplay.Elapsed      = static_cast<double>(Arrived.DeltaTime) * 1000.0;
    ArrivedDisplay.DisplayScale = static_cast<double>(Arrived.DisplayFramebufferScale.x > 0.0f
                                                    ? Arrived.DisplayFramebufferScale.x
                                                    : 1.0f);

    // 🔴 Cleared last, so a refusal above leaves the surface unadopted rather than half-open.
    ConfineDepth = 0u;

    return Deliver<bool>::Deliver(true);
}

Deliver<bool> RecordingSurface::Relayer(ShellLayer Layer)
{
    // 🔴 Refuses rather than adopting. A layer change on an unadopted surface would otherwise open a tick
    //    nothing had asked for, and the caller would record into a list no seal is going to assemble.
    if (CommandSlot == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no tick stands adopted" });

    if (ImGui::GetCurrentContext() == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no interface context is current" });

    // 📝 The destination list and nothing else. The pointer, the display condition, the confine depth and
    //    the tick ordinal all belong to the adoption and are left exactly as the tick found them.
    CommandSlot = (Layer == ShellLayer::Above)
                ? static_cast<void*>(ImGui::GetForegroundDrawList())
                : static_cast<void*>(ImGui::GetBackgroundDrawList());

    if (CommandSlot == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no command list is open" });

    return Deliver<bool>::Deliver(true);
}

void RecordingSurface::Retire()
{
    // 📝 The command list belongs to the vendor and is assembled by the seal; only this surface's claim on
    //    it is dropped. Clearing the slot is what makes every later recording refuse — each of them tests
    //    the slot and nothing else, which is the whole of the mechanism.
    CommandSlot  = nullptr;
    ConfineDepth = 0u;
}

bool RecordingSurface::Recording() const
{
    return CommandSlot != nullptr;
}

void RecordingSurface::Reset()
{
    // 📝 The clip stack belongs to the vendor's own list and is released by the tick that owned it. Only
    //    this surface's reckoning of the depth is dropped here.
    CommandSlot    = nullptr;
    ArrivedPointer = {};
    ArrivedDisplay = {};
    ConfineDepth   = 0u;
}

const PointerCondition& RecordingSurface::Pointer() const
{
    return ArrivedPointer;
}

const DisplayCondition& RecordingSurface::Display() const
{
    return ArrivedDisplay;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    GROUNDS AND EDGES
//------------------------------------------------------------------------------------------------------------------------

void RecordingSurface::Ground(const PlaneExtent& Extent, InkOrdinate Ink, float Radius, std::uint32_t Corners)
{
    if (CommandSlot == nullptr || Ink.Opacity == 0u)
        return;

    Commands(CommandSlot)->AddRectFilled(ImVec2(Extent.LeastAlong,  Extent.LeastAcross),
                                         ImVec2(Extent.MostAlong,   Extent.MostAcross),
                                         Vendor(Ink), Radius, VendorCorners(Corners));
}

void RecordingSurface::Edge(const PlaneExtent& Extent, InkOrdinate Ink, float Weight,
                            float Radius, std::uint32_t Corners)
{
    if (CommandSlot == nullptr || Ink.Opacity == 0u)
        return;

    // 📝 🔴 Inset by half the weight. The vendor centres a stroke on the extent it is given; the source's
    //    border is inside the box, because the whole sheet declares `box-sizing: border-box`. Stroking on the
    //    centre line makes every card a pixel wider than its neighbour's gap, and the lattice drifts.
    const float Inset = Weight * 0.5f;

    Commands(CommandSlot)->AddRect(ImVec2(Extent.LeastAlong  + Inset, Extent.LeastAcross + Inset),
                                   ImVec2(Extent.MostAlong   - Inset, Extent.MostAcross  - Inset),
                                   Vendor(Ink), Radius, VendorCorners(Corners), Weight);
}

void RecordingSurface::Scrim(const PlaneExtent& Extent, InkOrdinate UpperInk, InkOrdinate LowerInk,
                             ScrimAxis Axis)
{
    if (CommandSlot == nullptr)
        return;

    const ImU32 Upper = Vendor(UpperInk);
    const ImU32 Lower = Vendor(LowerInk);

    // 📝 The vendor takes its four inks in winding order from the leading upper corner. An Across ramp
    //    therefore repeats each ink across the pair that shares an ordinate, and an Along ramp across the
    //    pair that shares an abscissa — the same call with two corners exchanged.
    const ImU32 LeadingUpper  = Upper;
    const ImU32 TrailingUpper = (Axis == ScrimAxis::Along) ? Lower : Upper;
    const ImU32 TrailingLower = Lower;
    const ImU32 LeadingLower  = (Axis == ScrimAxis::Along) ? Upper : Lower;

    Commands(CommandSlot)->AddRectFilledMultiColor(ImVec2(Extent.LeastAlong, Extent.LeastAcross),
                                                   ImVec2(Extent.MostAlong,  Extent.MostAcross),
                                                   LeadingUpper, TrailingUpper, TrailingLower, LeadingLower);
}

void RecordingSurface::MaskCorners(const PlaneExtent& Extent, InkOrdinate OutsideInk, float Radius)
{
    if (CommandSlot == nullptr || OutsideInk.Opacity == 0u || Radius <= 0.0f)
        return;

    const float HeldRadius = std::fmin(Radius, std::fmin(Extent.SpanAlong(), Extent.SpanAcross()) * 0.5f);
    constexpr std::uint32_t ArcSteps = 8u;
    constexpr float HalfTurn = 3.1415926536f;
    constexpr float QuarterTurn = HalfTurn * 0.5f;

    const ImVec2 Outer[4] = {
        { Extent.LeastAlong, Extent.LeastAcross }, { Extent.MostAlong, Extent.LeastAcross },
        { Extent.MostAlong, Extent.MostAcross },   { Extent.LeastAlong, Extent.MostAcross }
    };
    const ImVec2 Centre[4] = {
        { Extent.LeastAlong + HeldRadius, Extent.LeastAcross + HeldRadius },
        { Extent.MostAlong - HeldRadius,  Extent.LeastAcross + HeldRadius },
        { Extent.MostAlong - HeldRadius,  Extent.MostAcross - HeldRadius },
        { Extent.LeastAlong + HeldRadius, Extent.MostAcross - HeldRadius }
    };
    const float Start[4] = { -QuarterTurn, -QuarterTurn, 0.0f, QuarterTurn };
    const float Travel[4] = { -QuarterTurn, QuarterTurn, QuarterTurn, QuarterTurn };
    ImDrawList* Target = Commands(CommandSlot);
    const ImU32 CoveringInk = Vendor(OutsideInk);

    for (std::uint32_t CornerOrdinal = 0u; CornerOrdinal < 4u; ++CornerOrdinal)
    {
        for (std::uint32_t StepOrdinal = 0u; StepOrdinal < ArcSteps; ++StepOrdinal)
        {
            const float FirstFraction = static_cast<float>(StepOrdinal) / static_cast<float>(ArcSteps);
            const float SecondFraction = static_cast<float>(StepOrdinal + 1u) / static_cast<float>(ArcSteps);
            const float FirstAngle = Start[CornerOrdinal] + Travel[CornerOrdinal] * FirstFraction;
            const float SecondAngle = Start[CornerOrdinal] + Travel[CornerOrdinal] * SecondFraction;
            const ImVec2 First = { Centre[CornerOrdinal].x + std::cos(FirstAngle) * HeldRadius,
                                   Centre[CornerOrdinal].y + std::sin(FirstAngle) * HeldRadius };
            const ImVec2 Second = { Centre[CornerOrdinal].x + std::cos(SecondAngle) * HeldRadius,
                                    Centre[CornerOrdinal].y + std::sin(SecondAngle) * HeldRadius };
            Target->AddTriangleFilled(Outer[CornerOrdinal], First, Second, CoveringInk);
        }
    }
}

void RecordingSurface::Medallion(float CentreAlong, float CentreAcross, float Radius, InkOrdinate Ink)
{
    if (CommandSlot == nullptr || Ink.Opacity == 0u || Radius <= 0.0f)
        return;

    Commands(CommandSlot)->AddCircleFilled(ImVec2(CentreAlong, CentreAcross), Radius, Vendor(Ink), 0);
}

void RecordingSurface::Tongue(const float* Corners, std::uint32_t CornerCount, InkOrdinate Ink)
{
    if (CommandSlot == nullptr || Corners == nullptr || CornerCount < 3u || CornerCount > 8u)
        return;

    ImVec2 Outline[8];

    for (std::uint32_t CornerOrdinal = 0u; CornerOrdinal < CornerCount; ++CornerOrdinal)
    {
        Outline[CornerOrdinal] = ImVec2(Corners[CornerOrdinal * 2u], Corners[CornerOrdinal * 2u + 1u]);
    }

    Commands(CommandSlot)->AddConvexPolyFilled(Outline, static_cast<int>(CornerCount), Vendor(Ink));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        SYMBOLS
//------------------------------------------------------------------------------------------------------------------------

void RecordingSurface::Stroke(SymbolSubject Subject, const PlaneExtent& SquareExtent, InkOrdinate Ink,
                              float TurnRadians)
{
    if (CommandSlot == nullptr || Ink.Opacity == 0u)
        return;

    const SymbolFigure& Declared = Figure(Subject);

    if (Declared.Steps == nullptr || Declared.StepCount == 0u)
        return;

    const float Scale        = SquareExtent.SpanAlong() / DeclaredSquare;
    const float OriginAlong  = SquareExtent.LeastAlong;
    const float OriginAcross = SquareExtent.LeastAcross;
    const float Weight       = Declared.Weight * Scale;
    const float TurnCosine   = std::cos(TurnRadians);
    const float TurnSine     = std::sin(TurnRadians);
    const ImU32 Vendored     = Vendor(Ink);

    ImDrawList* Target      = Commands(CommandSlot);
    bool        OutlineOpen = false;

    const auto Place = [&](float Along, float Across) -> ImVec2
    {
        const float CentredAlong  = Along  - DeclaredSquare * 0.5f;
        const float CentredAcross = Across - DeclaredSquare * 0.5f;
        const float TurnedAlong   = CentredAlong * TurnCosine - CentredAcross * TurnSine;
        const float TurnedAcross  = CentredAlong * TurnSine   + CentredAcross * TurnCosine;
        return ImVec2(OriginAlong + (TurnedAlong + DeclaredSquare * 0.5f) * Scale,
                      OriginAcross + (TurnedAcross + DeclaredSquare * 0.5f) * Scale);
    };

    const auto Finish = [&](bool Closing)
    {
        if (!OutlineOpen)
            return;

        Target->PathStroke(Vendored, Closing ? ImDrawFlags_Closed : ImDrawFlags_None, Weight);
        OutlineOpen = false;
    };

    for (std::uint32_t StepOrdinal = 0u; StepOrdinal < Declared.StepCount; ++StepOrdinal)
    {
        const StrokeStep& Step = Declared.Steps[StepOrdinal];

        switch (Step.Command)
        {
            case StrokeCommand::Origin:
                Finish(false);
                Target->PathLineTo(Place(Step.Along, Step.Across));
                OutlineOpen = true;
                break;

            case StrokeCommand::Segment:
                Target->PathLineTo(Place(Step.Along, Step.Across));
                break;

            case StrokeCommand::Curve:
                Target->PathBezierCubicCurveTo(Place(Step.FirstAlong,  Step.FirstAcross),
                                               Place(Step.SecondAlong, Step.SecondAcross),
                                               Place(Step.Along,       Step.Across), 0);
                break;

            case StrokeCommand::Close:
                Finish(true);
                break;

            case StrokeCommand::Disc:
                Finish(false);
                Target->AddCircle(Place(Step.Along, Step.Across), Step.FirstAlong * Scale, Vendored, 0, Weight);
                break;

            case StrokeCommand::Enclosure:
                Finish(false);
                Target->AddRect(Place(Step.Along, Step.Across),
                                Place(Step.FirstAlong, Step.FirstAcross),
                                Vendored, Step.SecondAlong * Scale, ImDrawFlags_RoundCornersAll, Weight);
                break;

            default:
                break;
        }
    }

    Finish(false);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          TEXT
//------------------------------------------------------------------------------------------------------------------------

namespace
{

// 📝 The capitalisation and truncation staging extents. Fixed rather than allocated: `00`'s no-allocation
//    rule holds inside an interaction, and no caption or asset name in the source approaches this.
constexpr std::uint32_t StagingCapacity = 512u;

void Capitalise(const char* Text, char* Staging)
{
    std::uint32_t Ordinal = 0u;

    while (Text[Ordinal] != '\0' && Ordinal + 1u < StagingCapacity)
    {
        const char Arrived = Text[Ordinal];
        Staging[Ordinal]   = (Arrived >= 'a' && Arrived <= 'z')
                           ? static_cast<char>(Arrived - ('a' - 'A'))
                           : Arrived;
        ++Ordinal;
    }

    Staging[Ordinal] = '\0';
}

}   // namespace

void RecordingSurface::TextRun(float Along, float Across, InkOrdinate Ink, const char* Text,
                               float PointSize, float Tracking, bool Emphatic)
{
    if (CommandSlot == nullptr || Text == nullptr || Text[0] == '\0' || Ink.Opacity == 0u)
        return;

    ImDrawList*   Target   = Commands(CommandSlot);
    ImFont*       Typeface = const_cast<ImFont*>(ImGui::GetFont());
    const ImU32   Vendored = Vendor(Ink);
    const float   Added    = Tracking * PointSize;

    const auto Emit = [&](float StartAlong, float StartAcross)
    {
        if (Added == 0.0f)
        {
            Target->AddText(Typeface, PointSize, ImVec2(StartAlong, StartAcross), Vendored, Text);
            return;
        }

        // 📝 🔴 Tracking is applied per glyph because the vendor has no letter-spacing. The source declares
        //    0.2em on the LIBRARY caption and 0.05em on two more, and a run recorded without it is thirty per
        //    cent narrower than the source's — which moves everything to its right.
        float       Pen      = StartAlong;
        const char* Sweeping = Text;

        while (*Sweeping != '\0')
        {
            const char Glyph[2] = { *Sweeping, '\0' };

            Target->AddText(Typeface, PointSize, ImVec2(Pen, StartAcross), Vendored, Glyph, Glyph + 1);

            Pen += Typeface->CalcTextSizeA(PointSize, FLT_MAX, 0.0f, Glyph, Glyph + 1).x + Added;
            ++Sweeping;
        }
    };

    Emit(Along, Across);

    if (Emphatic)
        Emit(Along + EmphaticOffset, Across);
}

void RecordingSurface::TextRunCapitalised(float Along, float Across, InkOrdinate Ink, const char* Text,
                                          float PointSize, float Tracking, bool Emphatic)
{
    if (Text == nullptr)
        return;

    char Staging[StagingCapacity];
    Capitalise(Text, Staging);

    TextRun(Along, Across, Ink, Staging, PointSize, Tracking, Emphatic);
}

void RecordingSurface::TextRunTruncated(float Along, float Across, float CeilingAlong, InkOrdinate Ink,
                                        const char* Text, float PointSize, bool Emphatic)
{
    if (CommandSlot == nullptr || Text == nullptr || Text[0] == '\0')
        return;

    if (MeasureRun(Text, PointSize, 0.0f) <= CeilingAlong)
    {
        TextRun(Along, Across, Ink, Text, PointSize, 0.0f, Emphatic);
        return;
    }

    ImFont*       Typeface     = const_cast<ImFont*>(ImGui::GetFont());
    const float   EllipsisSpan = Typeface->CalcTextSizeA(PointSize, FLT_MAX, 0.0f, "...").x;
    const float   Admissible   = CeilingAlong - EllipsisSpan;

    char          Staging[StagingCapacity];
    std::uint32_t Kept = 0u;
    float         Pen  = 0.0f;

    while (Text[Kept] != '\0' && Kept + 4u < StagingCapacity)
    {
        const char Glyph[2] = { Text[Kept], '\0' };
        const float Advance = Typeface->CalcTextSizeA(PointSize, FLT_MAX, 0.0f, Glyph, Glyph + 1).x;

        if (Pen + Advance > Admissible)
            break;

        Staging[Kept] = Text[Kept];
        Pen          += Advance;
        ++Kept;
    }

    Staging[Kept]      = '.';
    Staging[Kept + 1u] = '.';
    Staging[Kept + 2u] = '.';
    Staging[Kept + 3u] = '\0';

    TextRun(Along, Across, Ink, Staging, PointSize, 0.0f, Emphatic);
}

float RecordingSurface::MeasureRun(const char* Text, float PointSize, float Tracking) const
{
    if (Text == nullptr || Text[0] == '\0' || ImGui::GetCurrentContext() == nullptr)
        return 0.0f;

    ImFont*       Typeface = const_cast<ImFont*>(ImGui::GetFont());
    const float   Measured = Typeface->CalcTextSizeA(PointSize, FLT_MAX, 0.0f, Text).x;

    if (Tracking == 0.0f)
        return Measured;

    // 📝 One added advance per glyph, and the trailing one is subtracted back off: the source's letter-spacing
    //    lands after every glyph including the last, but the visible run ends at the last glyph's own edge.
    std::uint32_t GlyphCount = 0u;

    while (Text[GlyphCount] != '\0')
        ++GlyphCount;

    return Measured + Tracking * PointSize * static_cast<float>(GlyphCount) - Tracking * PointSize;
}

float RecordingSurface::RunAcross(float PointSize) const
{
    // 📐 The source's `leading-normal` is 1.5 for body text; the two captions declare `leading-none`, which the
    //    caller states by asking for the point size itself. 1.5 is the figure a run occupies when nothing
    //    overrides it, so it is what this reports.
    return PointSize * 1.5f;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        CLIPPING
//------------------------------------------------------------------------------------------------------------------------

void RecordingSurface::Confine(const PlaneExtent& Extent)
{
    if (CommandSlot == nullptr || ConfineDepth >= ConfineCeiling)
        return;

    Commands(CommandSlot)->PushClipRect(ImVec2(Extent.LeastAlong, Extent.LeastAcross),
                                        ImVec2(Extent.MostAlong,  Extent.MostAcross), true);
    ++ConfineDepth;
}

void RecordingSurface::Release()
{
    if (CommandSlot == nullptr || ConfineDepth == 0u)
        return;

    Commands(CommandSlot)->PopClipRect();
    --ConfineDepth;
}

bool RecordingSurface::Excluded(const PlaneExtent& Extent) const
{
    if (CommandSlot == nullptr)
        return true;

    // 📝 🔴 The previous read took `_ClipRectStack.back()` on a vector the vendor is free to leave empty
    //    between ticks. `back()` on an empty ImVector reads one element before the allocation.
    const ImDrawList* Target = Commands(CommandSlot);

    if (Target->_ClipRectStack.Size == 0)
        return false;

    const ImVec2 Least = Target->GetClipRectMin();
    const ImVec2 Most  = Target->GetClipRectMax();

    return Extent.MostAlong  <= Least.x || Extent.LeastAlong  >= Most.x
        || Extent.MostAcross <= Least.y || Extent.LeastAcross >= Most.y;
}

}   // namespace Slate
