//============================================================================================================================================
//                                                            CONTROLPANEL.CPP
//============================================================================================================================================
// 🧩 Reference inspector controls recorded from fixed figures and arbitrated through one interaction index.

#include "SlateUI/Interface/ControlPanel/Api/ControlPanel.h"

#include <cmath>
#include <cstdio>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                   REFERENCE APPEARANCE
//------------------------------------------------------------------------------------------------------------------------

namespace
{

constexpr InkOrdinate PanelGround     = Covering(0x101012u);
constexpr InkOrdinate FieldGround     = Covering(0x0A0A0Bu);
constexpr InkOrdinate ValueGround     = Covering(0x232326u);
constexpr InkOrdinate NumberGround    = Covering(0x131315u);
constexpr InkOrdinate UnitGround      = Covering(0x33333Au);
constexpr InkOrdinate TileGround      = Covering(0x1D1D21u);
constexpr InkOrdinate TileRoused      = Covering(0x26262Bu);
constexpr InkOrdinate HairInk         = Partial(0xFFFFFFu, 0.06);
constexpr InkOrdinate StrongHairInk   = Partial(0xFFFFFFu, 0.10);
constexpr InkOrdinate AccentInk       = Covering(0x4A90E2u);
constexpr InkOrdinate AccentSoftInk   = Partial(0xFFFFFFu, 0.12);
constexpr InkOrdinate TrackTakenInk   = Covering(0x8A8A8Eu);
constexpr InkOrdinate PrimaryInk      = Covering(0xECECF0u);
constexpr InkOrdinate MutedInk        = Covering(0x7B7B82u);
constexpr InkOrdinate FaintInk        = Covering(0x55555Du);
constexpr InkOrdinate WhiteInk        = Covering(0xFFFFFFu);
constexpr InkOrdinate AbsentInk       = Covering(0x303036u);

constexpr float ReferenceText         = 12.0f;   // [px] - default ImGui typeface presentation size
constexpr float SmallText             = 10.5f;   // [px] - metadata and counts
constexpr float ControlRadius         = 8.0f;    // [px] - tile and segment corner radius
constexpr double RouseDuration        = 120.0;   // [ms] - reference transition-colors duration
constexpr double TakeDuration         = 160.0;   // [ms] - switch and selection transition duration
constexpr double DiscloseDuration     = 200.0;   // [ms] - card and menu disclosure duration
constexpr double CarouselDuration     = 300.0;   // [ms] - inspector page transition duration
constexpr float FoldHeaderAcross      = 31.0f;   // [px] - folding card header
constexpr float FoldRowAcross         = 30.0f;   // [px] - one disclosed property row
constexpr float DropdownHeadAcross    = 32.0f;   // [px] - selection field
constexpr float DropdownOptionAcross  = 26.0f;   // [px] - one menu option
constexpr float DropdownGapAcross     = 6.0f;    // [px] - field to menu separation
constexpr float ColourHeadAcross      = 40.0f;   // [px] - colour field
constexpr float ColourGapAcross       = 9.0f;    // [px] - field to picker separation
constexpr float ColourPickerAcross    = 269.0f;  // [px] - picker card including its padding
constexpr float SaturationAcross      = 140.0f;  // [px] - saturation and brightness square
constexpr float ColourBarAcross       = 16.0f;   // [px] - hue and opacity rails

constexpr float Between(float Departed, float Arriving, float Fraction)
{
    return Departed + (Arriving - Departed) * Fraction;
}

constexpr double Held(double Ordinate, double Least, double Most)
{
    return (Ordinate < Least) ? Least : (Ordinate > Most) ? Most : Ordinate;
}

constexpr std::uint8_t BlendOrdinate(std::uint8_t Departed, std::uint8_t Arriving, float Fraction)
{
    return static_cast<std::uint8_t>(Between(static_cast<float>(Departed),
                                              static_cast<float>(Arriving), Fraction) + 0.5f);
}

constexpr InkOrdinate Blend(InkOrdinate Departed, InkOrdinate Arriving, float Fraction)
{
    const float HeldFraction = (Fraction < 0.0f) ? 0.0f : (Fraction > 1.0f) ? 1.0f : Fraction;

    return InkOrdinate{ BlendOrdinate(Departed.Red,     Arriving.Red,     HeldFraction),
                        BlendOrdinate(Departed.Green,   Arriving.Green,   HeldFraction),
                        BlendOrdinate(Departed.Blue,    Arriving.Blue,    HeldFraction),
                        BlendOrdinate(Departed.Opacity, Arriving.Opacity, HeldFraction) };
}

constexpr InkOrdinate Faded(InkOrdinate Declared, float Fraction)
{
    const float HeldFraction = (Fraction < 0.0f) ? 0.0f : (Fraction > 1.0f) ? 1.0f : Fraction;
    Declared.Opacity = static_cast<std::uint8_t>(static_cast<float>(Declared.Opacity) * HeldFraction + 0.5f);
    return Declared;
}

struct HsvOrdinate
{
    float  Hue        = 0.0f;   // [deg] - zero through 360
    float  Saturation = 0.0f;   // [-]   - unit interval
    float  Brightness = 0.0f;   // [-]   - unit interval
};

HsvOrdinate ToHsv(const PickerColour& Colour)
{
    const float Red     = static_cast<float>(Colour.Red)   / 255.0f;
    const float Green   = static_cast<float>(Colour.Green) / 255.0f;
    const float Blue    = static_cast<float>(Colour.Blue)  / 255.0f;
    const float Greatest = std::fmax(Red, std::fmax(Green, Blue));
    const float Least    = std::fmin(Red, std::fmin(Green, Blue));
    const float Distance = Greatest - Least;

    HsvOrdinate Converted;
    Converted.Brightness = Greatest;
    Converted.Saturation = (Greatest > 0.0f) ? Distance / Greatest : 0.0f;

    if (Distance > 0.0f)
    {
        if (Greatest == Red)        Converted.Hue = 60.0f * std::fmod((Green - Blue) / Distance, 6.0f);
        else if (Greatest == Green) Converted.Hue = 60.0f * ((Blue - Red) / Distance + 2.0f);
        else                        Converted.Hue = 60.0f * ((Red - Green) / Distance + 4.0f);

        if (Converted.Hue < 0.0f)
            Converted.Hue += 360.0f;
    }

    return Converted;
}

PickerColour FromHsv(const HsvOrdinate& Hsv, std::uint8_t Opacity)
{
    const float Chroma = Hsv.Brightness * Hsv.Saturation;
    const float Intermediate = Chroma * (1.0f - std::fabs(std::fmod(Hsv.Hue / 60.0f, 2.0f) - 1.0f));
    const float Added = Hsv.Brightness - Chroma;
    float Red = 0.0f;
    float Green = 0.0f;
    float Blue = 0.0f;

    if (Hsv.Hue < 60.0f)       { Red = Chroma; Green = Intermediate; }
    else if (Hsv.Hue < 120.0f) { Red = Intermediate; Green = Chroma; }
    else if (Hsv.Hue < 180.0f) { Green = Chroma; Blue = Intermediate; }
    else if (Hsv.Hue < 240.0f) { Green = Intermediate; Blue = Chroma; }
    else if (Hsv.Hue < 300.0f) { Red = Intermediate; Blue = Chroma; }
    else                       { Red = Chroma; Blue = Intermediate; }

    PickerColour Converted;
    Converted.Red     = static_cast<std::uint8_t>(std::round((Red + Added) * 255.0f));
    Converted.Green   = static_cast<std::uint8_t>(std::round((Green + Added) * 255.0f));
    Converted.Blue    = static_cast<std::uint8_t>(std::round((Blue + Added) * 255.0f));
    Converted.Opacity = Opacity;
    return Converted;
}

constexpr float CentredAcross(const PlaneExtent& Extent, float PointSize)
{
    return Extent.LeastAcross + (Extent.SpanAcross() - PointSize) * 0.5f;
}

void UnsignedRun(char* Delivered, std::uint32_t Extent, std::uint32_t Reading)
{
    if (Delivered == nullptr || Extent < 2u)
        return;

    char          Reversed[12] = {};
    std::uint32_t Count        = 0u;

    do
    {
        Reversed[Count++] = static_cast<char>('0' + Reading % 10u);
        Reading /= 10u;
    }
    while (Reading > 0u && Count < 11u);

    std::uint32_t Written = 0u;

    while (Count > 0u && Written + 1u < Extent)
        Delivered[Written++] = Reversed[--Count];

    Delivered[Written] = '\0';
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                       CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> ControlPanel::Construct(InteractionIndex&              ArrivingInteraction,
                                      RecordingSurface&              ArrivingRecording,
                                      const AppearanceSpecification& ArrivingAppearance)
{
    if (Interaction != nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a control panel construction already stands" });

    Interaction = &ArrivingInteraction;
    Recording   = &ArrivingRecording;
    Appearance  = &ArrivingAppearance;

    return Deliver<bool>::Deliver(true);
}

void ControlPanel::Advance(const PointerCondition& Arriving, double Elapsed)
{
    if (Interaction == nullptr)
        return;

    Arrived = Arriving;
    static_cast<void>(Elapsed);
}

ControlVerdict ControlPanel::ResolveTap(ControlIdentity Claimed, const PlaneExtent& Extent, bool& Altered)
{
    ControlVerdict Verdict;

    if (Interaction == nullptr || Recording == nullptr || !Interaction->Resolves(Claimed))
        return Verdict;

    const bool Roused = Extent.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);

    if (Roused && Arrived.ContactArrived && !Interaction->AnyDisclosed())
        Interaction->Seize(Claimed, ControlPart::Body);

    const bool QuickTap = Arrived.ContactArrived && Arrived.ContactReleased && Roused;

    if ((Interaction->Released(Claimed) && Roused) || QuickTap)
    {
        Altered                  = true;
        Verdict.OrdinateAltered = true;
    }

    Interaction->DeclareRoused(Claimed, Roused, RouseDuration);
    Verdict.ContactTaken = Interaction->Holding(Claimed);
    Verdict.Mark         = (Roused || Verdict.ContactTaken) ? RedrawMark::Recolour : RedrawMark::Quiet;

    return Verdict;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          SWITCH
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ControlPanel::SwitchToggle(ControlIdentity Claimed, const PlaneExtent& Extent,
                                          const SwitchDeclaration& Declared, bool& Taken)
{
    bool           Altered = false;
    ControlVerdict Verdict = ResolveTap(Claimed, Extent, Altered);

    if (Altered)
        Taken = !Taken;

    if (Interaction == nullptr || Recording == nullptr)
        return Verdict;

    Interaction->DeclareTaken(Claimed, Taken, TakeDuration);

    const float TakenFraction = Interaction->TakenFraction(Claimed);
    const float RouseFraction = Interaction->RousedFraction(Claimed);
    const float CaptionAlong  = Extent.LeastAlong;
    const float TrackAlong    = Extent.MostAlong - 50.0f;
    const PlaneExtent Track   = Spanning(TrackAlong, Extent.LeastAcross, 50.0f, 32.0f);

    Recording->TextRun(CaptionAlong, CentredAcross(Extent, ReferenceText),
                       Blend(MutedInk, PrimaryInk, RouseFraction), Declared.Caption, ReferenceText);
    Recording->Ground(Track, Blend(FieldGround, TrackTakenInk, TakenFraction), 16.0f, CornerAll);
    Recording->Edge(Track, Blend(HairInk, StrongHairInk, RouseFraction), 1.0f, 16.0f, CornerAll);

    const float NubAlong = Between(Track.LeastAlong + 16.0f, Track.MostAlong - 16.0f, TakenFraction);
    const float NubRadius = Between(11.0f, 12.0f, RouseFraction);
    Recording->Medallion(NubAlong, Track.LeastAcross + 16.0f, NubRadius, WhiteInk);

    return Verdict;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SEGMENTED CHOICE
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ControlPanel::SegmentedChoice(ControlIdentity Claimed, const PlaneExtent& Extent,
                                             const SegmentDeclaration& Declared, std::uint32_t& TakenOrdinal)
{
    ControlVerdict Verdict;

    if (Interaction == nullptr || Recording == nullptr || Declared.Captions == nullptr || Declared.CaptionCount == 0u)
        return Verdict;

    const float SegmentAlong = Extent.SpanAlong() / static_cast<float>(Declared.CaptionCount);
    std::uint32_t RousedOrdinal = Declared.CaptionCount;

    for (std::uint32_t Ordinal = 0u; Ordinal < Declared.CaptionCount; ++Ordinal)
    {
        const PlaneExtent Segment = Spanning(Extent.LeastAlong + SegmentAlong * static_cast<float>(Ordinal),
                                             Extent.LeastAcross, SegmentAlong, Extent.SpanAcross());

        if (Segment.Encloses(Arrived.PositionAlong, Arrived.PositionAcross))
            RousedOrdinal = Ordinal;
    }

    const bool Roused = RousedOrdinal < Declared.CaptionCount;

    if (Roused && Arrived.ContactArrived)
    {
        Interaction->Seize(Claimed, ControlPart::Body);
        Interaction->DepartFrom(Claimed, static_cast<float>(RousedOrdinal));
    }

    if ((Interaction->Released(Claimed) && Roused) ||
        (Arrived.ContactArrived && Arrived.ContactReleased && Roused))
    {
        TakenOrdinal             = RousedOrdinal;
        Verdict.OrdinateAltered = true;
    }

    Interaction->DeclareRoused(Claimed, Roused, RouseDuration);
    Interaction->DeclareTaken(Claimed, TakenOrdinal < Declared.CaptionCount, TakeDuration);

    const float RouseFraction = Interaction->RousedFraction(Claimed);

    Recording->Ground(Extent, FieldGround, ControlRadius, CornerAll);
    Recording->Edge(Extent, HairInk, 1.0f, ControlRadius, CornerAll);

    for (std::uint32_t Ordinal = 0u; Ordinal < Declared.CaptionCount; ++Ordinal)
    {
        const PlaneExtent Segment = Spanning(Extent.LeastAlong + SegmentAlong * static_cast<float>(Ordinal),
                                             Extent.LeastAcross, SegmentAlong, Extent.SpanAcross());
        const bool Taken = Ordinal == TakenOrdinal;
        const PlaneExtent Inset = { Segment.LeastAlong + 3.0f, Segment.LeastAcross + 3.0f,
                                    Segment.MostAlong - 3.0f, Segment.MostAcross - 3.0f };

        if (Ordinal == RousedOrdinal && !Taken)
            Recording->Ground(Inset, Blend(FieldGround, TileRoused, RouseFraction), 6.0f, CornerAll);

        if (Taken)
        {
            Recording->Ground(Inset, AccentSoftInk, 6.0f, CornerAll);
            Recording->Edge(Inset, Blend(StrongHairInk, AccentInk, 0.65f), 1.0f, 6.0f, CornerAll);
        }

        const float RunAlong = Recording->MeasureRun(Declared.Captions[Ordinal], ReferenceText);
        Recording->TextRun(Segment.LeastAlong + (Segment.SpanAlong() - RunAlong) * 0.5f,
                           CentredAcross(Segment, ReferenceText), Taken ? PrimaryInk : MutedInk,
                           Declared.Captions[Ordinal], ReferenceText, 0.0f, Taken);
    }

    Verdict.ContactTaken = Interaction->Holding(Claimed);
    Verdict.Mark         = Roused ? RedrawMark::Recolour : RedrawMark::Quiet;

    return Verdict;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          TAB STRIP
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ControlPanel::TabStrip(ControlIdentity Claimed, const PlaneExtent& Extent,
                                      const TabDeclaration& Declared, std::uint32_t& TakenOrdinal)
{
    ControlVerdict Verdict;

    if (Interaction == nullptr || Recording == nullptr || Declared.Captions == nullptr || Declared.CaptionCount == 0u)
        return Verdict;

    const float TabAlong = Extent.SpanAlong() / static_cast<float>(Declared.CaptionCount);
    std::uint32_t RousedOrdinal = Declared.CaptionCount;

    for (std::uint32_t Ordinal = 0u; Ordinal < Declared.CaptionCount; ++Ordinal)
    {
        const PlaneExtent Tab = Spanning(Extent.LeastAlong + TabAlong * static_cast<float>(Ordinal),
                                         Extent.LeastAcross, TabAlong, Extent.SpanAcross());
        if (Tab.Encloses(Arrived.PositionAlong, Arrived.PositionAcross))
            RousedOrdinal = Ordinal;
    }

    const bool Roused = RousedOrdinal < Declared.CaptionCount;

    if (Roused && Arrived.ContactArrived)
        Interaction->Seize(Claimed, ControlPart::Body);

    if ((Interaction->Released(Claimed) && Roused) ||
        (Arrived.ContactArrived && Arrived.ContactReleased && Roused))
    {
        TakenOrdinal             = RousedOrdinal;
        Verdict.OrdinateAltered = true;
    }

    Interaction->DeclareRoused(Claimed, Roused, RouseDuration);
    const float RouseFraction = Interaction->RousedFraction(Claimed);

    Recording->Ground(Extent, PanelGround, 0.0f, CornerNone);
    Recording->Ground(Spanning(Extent.LeastAlong, Extent.MostAcross - 1.0f, Extent.SpanAlong(), 1.0f), HairInk, 0.0f, CornerNone);

    for (std::uint32_t Ordinal = 0u; Ordinal < Declared.CaptionCount; ++Ordinal)
    {
        const PlaneExtent Tab = Spanning(Extent.LeastAlong + TabAlong * static_cast<float>(Ordinal),
                                         Extent.LeastAcross, TabAlong, Extent.SpanAcross());
        const bool Taken = Ordinal == TakenOrdinal;
        const float RunAlong = Recording->MeasureRun(Declared.Captions[Ordinal], ReferenceText);

        if (Ordinal == RousedOrdinal && !Taken)
            Recording->Ground(Tab, Blend(PanelGround, TileRoused, RouseFraction), 0.0f, CornerNone);

        Recording->TextRun(Tab.LeastAlong + (Tab.SpanAlong() - RunAlong) * 0.5f,
                           CentredAcross(Tab, ReferenceText),
                           Taken ? PrimaryInk : Blend(MutedInk, PrimaryInk,
                                                      (Ordinal == RousedOrdinal) ? RouseFraction : 0.0f),
                           Declared.Captions[Ordinal], ReferenceText, 0.0f, Taken);

        if (Taken)
        {
            const float UnderlineAlong = Tab.SpanAlong() - 12.0f;
            Recording->Ground(Spanning(Tab.LeastAlong + 6.0f, Tab.MostAcross - 2.0f,
                                       UnderlineAlong, 2.0f), AccentInk, 0.0f, CornerNone);
        }
    }

    Verdict.ContactTaken = Interaction->Holding(Claimed);
    Verdict.Mark         = Roused ? RedrawMark::Recolour : RedrawMark::Quiet;

    return Verdict;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     INSPECTOR CAROUSEL
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ControlPanel::CarouselPages(ControlIdentity Claimed, const PlaneExtent& Extent,
                                           const CarouselDeclaration& Declared, std::uint32_t TakenOrdinal)
{
    ControlVerdict Verdict;

    if (Interaction == nullptr || Recording == nullptr)
        return Verdict;

    const bool TrailingTaken = TakenOrdinal == 1u;
    Interaction->DeclareTaken(Claimed, TrailingTaken, CarouselDuration, EaseCurve::Carousel);

    const float Travel = Interaction->TakenFraction(Claimed);
    const float PageAlong = Extent.SpanAlong();
    const float LeadingAlong = Extent.LeastAlong - PageAlong * Travel;
    const float TrailingAlong = Extent.LeastAlong + PageAlong * (1.0f - Travel);

    Recording->Ground(Extent, FieldGround, ControlRadius, CornerAll);
    Recording->Edge(Extent, HairInk, 1.0f, ControlRadius, CornerAll);
    Recording->Confine(Extent);

    const auto RecordLeading = [&](float Along)
    {
        const PlaneExtent Page = Spanning(Along, Extent.LeastAcross, PageAlong, Extent.SpanAcross());
        Recording->TextRunCapitalised(Page.LeastAlong + 10.0f, Page.LeastAcross + 9.0f,
                                      FaintInk, "Property cards", SmallText, 0.08f, true);

        if (Declared.LeadingRuns == nullptr)
            return;

        for (std::uint32_t Ordinal = 0u; Ordinal < Declared.LeadingCount; ++Ordinal)
        {
            const PlaneExtent Card = Spanning(Page.LeastAlong + 8.0f,
                                              Page.LeastAcross + 30.0f + 38.0f * static_cast<float>(Ordinal),
                                              Page.SpanAlong() - 16.0f, 32.0f);
            Recording->Ground(Card, PanelGround, 7.0f, CornerAll);
            Recording->Edge(Card, HairInk, 1.0f, 7.0f, CornerAll);
            Recording->Stroke(SymbolSubject::ChevronRight,
                              Spanning(Card.LeastAlong + 8.0f, Card.LeastAcross + 9.0f, 13.0f, 13.0f), FaintInk);
            Recording->TextRunTruncated(Card.LeastAlong + 29.0f, CentredAcross(Card, ReferenceText),
                                        Card.MostAlong - 10.0f, PrimaryInk,
                                        Declared.LeadingRuns[Ordinal], ReferenceText, true);
        }
    };

    const auto RecordTrailing = [&](float Along)
    {
        const PlaneExtent Page = Spanning(Along, Extent.LeastAcross, PageAlong, Extent.SpanAcross());
        Recording->TextRunCapitalised(Page.LeastAlong + 10.0f, Page.LeastAcross + 9.0f,
                                      FaintInk, "Revision sequence", SmallText, 0.08f, true);

        if (Declared.TrailingRuns == nullptr)
            return;

        const float MarkerAlong = Page.LeastAlong + 18.0f;
        Recording->Ground(Spanning(MarkerAlong - 0.5f, Page.LeastAcross + 30.0f, 1.0f,
                                   38.0f * static_cast<float>(Declared.TrailingCount)), HairInk,
                          0.0f, CornerNone);

        for (std::uint32_t Ordinal = 0u; Ordinal < Declared.TrailingCount; ++Ordinal)
        {
            const float Across = Page.LeastAcross + 30.0f + 38.0f * static_cast<float>(Ordinal);
            Recording->Medallion(MarkerAlong, Across + 16.0f, Ordinal == 0u ? 4.0f : 3.0f,
                                 Ordinal == 0u ? AccentInk : FaintInk);

            const PlaneExtent Card = Spanning(Page.LeastAlong + 31.0f, Across,
                                              Page.SpanAlong() - 39.0f, 32.0f);
            Recording->Ground(Card, Ordinal == 0u ? AccentSoftInk : PanelGround, 7.0f, CornerAll);
            Recording->Edge(Card, Ordinal == 0u ? AccentInk : HairInk, 1.0f, 7.0f, CornerAll);
            Recording->TextRunTruncated(Card.LeastAlong + 9.0f, CentredAcross(Card, ReferenceText),
                                        Card.MostAlong - 9.0f, PrimaryInk,
                                        Declared.TrailingRuns[Ordinal], ReferenceText, Ordinal == 0u);
        }
    };

    RecordLeading(LeadingAlong);
    RecordTrailing(TrailingAlong);
    Recording->Release();

    Verdict.Mark = (Travel > 0.0f && Travel < 1.0f) ? RedrawMark::Rerecord : RedrawMark::Quiet;
    return Verdict;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       FOLDING CARD
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ControlPanel::CollapsibleCard(ControlIdentity Claimed, const PlaneExtent& Extent,
                                             const FoldDeclaration& Declared, bool& ExpansionEnabled)
{
    const PlaneExtent Header = { Extent.LeastAlong, Extent.LeastAcross, Extent.MostAlong,
                                 Extent.LeastAcross + FoldHeaderAcross };
    bool           Altered = false;
    ControlVerdict Verdict = ResolveTap(Claimed, Header, Altered);

    if (Altered)
        ExpansionEnabled = !ExpansionEnabled;

    if (Interaction == nullptr || Recording == nullptr)
        return Verdict;

    Interaction->DeclareTaken(Claimed, ExpansionEnabled, DiscloseDuration);

    const float Disclosure = Interaction->TakenFraction(Claimed);
    const float BodyAcross = FoldRowAcross * static_cast<float>(Declared.BodyCount) + 8.0f;
    const float PresentedAcross = FoldHeaderAcross + BodyAcross * Disclosure;
    const PlaneExtent Presented = { Extent.LeastAlong, Extent.LeastAcross, Extent.MostAlong,
                                    Extent.LeastAcross + PresentedAcross };

    Recording->Ground(Presented, PanelGround, ControlRadius, CornerAll);
    Recording->Edge(Presented, HairInk, 1.0f, ControlRadius, CornerAll);
    Recording->Ground(Spanning(Header.LeastAlong, Header.MostAcross - 1.0f, Header.SpanAlong(),
                               Disclosure), HairInk, 0.0f, CornerNone);

    const PlaneExtent SymbolExtent = Spanning(Header.LeastAlong + 8.0f, Header.LeastAcross + 8.0f, 14.0f, 14.0f);
    Recording->Stroke((Disclosure > 0.5f) ? SymbolSubject::ChevronDown : SymbolSubject::ChevronRight,
                      SymbolExtent, Blend(FaintInk, PrimaryInk, Interaction->RousedFraction(Claimed)));
    Recording->TextRun(Header.LeastAlong + 30.0f, CentredAcross(Header, SmallText), MutedInk,
                       Declared.Caption, SmallText, 0.08f, true);

    char CountRun[12] = {};
    UnsignedRun(CountRun, 12u, Declared.BodyCount);
    const float CountAlong = Recording->MeasureRun(CountRun, SmallText);
    Recording->TextRun(Header.MostAlong - CountAlong - 10.0f, CentredAcross(Header, SmallText),
                       FaintInk, CountRun, SmallText);

    if (Disclosure > 0.0f && Declared.BodyRuns != nullptr)
    {
        const PlaneExtent Revealed = { Extent.LeastAlong, Header.MostAcross,
                                       Extent.MostAlong, Header.MostAcross + BodyAcross * Disclosure };
        Recording->Confine(Revealed);

        for (std::uint32_t Ordinal = 0u; Ordinal < Declared.BodyCount; ++Ordinal)
        {
            const PlaneExtent Row = Spanning(Extent.LeastAlong + 8.0f,
                                             Header.MostAcross + 4.0f + FoldRowAcross * static_cast<float>(Ordinal),
                                             Extent.SpanAlong() - 16.0f, FoldRowAcross - 4.0f);
            Recording->Ground(Row, FieldGround, 7.0f, CornerAll);
            Recording->TextRun(Row.LeastAlong + 10.0f, CentredAcross(Row, ReferenceText), MutedInk,
                               Declared.BodyRuns[Ordinal], ReferenceText);
            Recording->TextRun(Row.MostAlong - 52.0f, CentredAcross(Row, ReferenceText), PrimaryInk,
                               (Ordinal == 0u) ? "0.00" : (Ordinal == 1u) ? "0.0" : "1.00", ReferenceText);
        }

        Recording->Release();
    }

    Verdict.Mark = (Disclosure > 0.0f && Disclosure < 1.0f) ? RedrawMark::Rearrange : Verdict.Mark;
    return Verdict;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       DROPDOWN CARD
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ControlPanel::DropdownCard(ControlIdentity Claimed, const PlaneExtent& Extent,
                                          const DropdownDeclaration& Declared, std::uint32_t& TakenOrdinal)
{
    ControlVerdict Verdict;

    if (Interaction == nullptr || Recording == nullptr || Declared.Options == nullptr || Declared.OptionCount == 0u)
        return Verdict;

    if (TakenOrdinal >= Declared.OptionCount)
        TakenOrdinal = 0u;

    const PlaneExtent Head = { Extent.LeastAlong, Extent.LeastAcross,
                               Extent.MostAlong, Extent.LeastAcross + DropdownHeadAcross };
    const bool Open = Interaction->Disclosed(Claimed);
    const float MenuLeast = Head.MostAcross + DropdownGapAcross;
    std::uint32_t RousedOption = Declared.OptionCount;

    for (std::uint32_t Ordinal = 0u; Ordinal < Declared.OptionCount; ++Ordinal)
    {
        const PlaneExtent Option = Spanning(Extent.LeastAlong, MenuLeast + DropdownOptionAcross * static_cast<float>(Ordinal),
                                            Extent.SpanAlong(), DropdownOptionAcross);
        if (Open && Option.Encloses(Arrived.PositionAlong, Arrived.PositionAcross))
            RousedOption = Ordinal;
    }

    const bool HeadRoused = Head.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);
    const bool MenuRoused = RousedOption < Declared.OptionCount;

    if ((HeadRoused || MenuRoused) && Arrived.ContactArrived)
        Interaction->Seize(Claimed, MenuRoused ? ControlPart::Option : ControlPart::Body);
    else if (Open && Arrived.ContactArrived && !Extent.Encloses(Arrived.PositionAlong, Arrived.PositionAcross))
        Interaction->Withdraw();

    const bool QuickTap = Arrived.ContactArrived && Arrived.ContactReleased && (HeadRoused || MenuRoused);

    if (Interaction->Released(Claimed) || QuickTap)
    {
        if (MenuRoused)
        {
            TakenOrdinal             = RousedOption;
            Verdict.OrdinateAltered = true;
            Interaction->Withdraw();
        }
        else if (HeadRoused)
        {
            if (Open) Interaction->Withdraw();
            else      Interaction->Disclose(Claimed);
        }
    }

    const bool DisclosureOpen = Interaction->Disclosed(Claimed);
    Interaction->DeclareRoused(Claimed, HeadRoused || MenuRoused, RouseDuration);
    Interaction->DeclareTaken(Claimed, DisclosureOpen, DiscloseDuration);

    const float RouseFraction = Interaction->RousedFraction(Claimed);
    const float Disclosure = Interaction->TakenFraction(Claimed);
    const float CaptionAlong = 92.0f;
    const PlaneExtent Field = { Head.LeastAlong + CaptionAlong, Head.LeastAcross, Head.MostAlong, Head.MostAcross };

    Recording->TextRun(Head.LeastAlong, CentredAcross(Head, ReferenceText),
                       Blend(MutedInk, PrimaryInk, HeadRoused ? RouseFraction : 0.0f),
                       Declared.Caption, ReferenceText);
    Recording->Ground(Field, FieldGround, 16.0f, CornerAll);
    Recording->Edge(Field, Blend(HairInk, StrongHairInk, RouseFraction), 1.0f, 16.0f, CornerAll);
    Recording->TextRunTruncated(Field.LeastAlong + 12.0f, CentredAcross(Field, ReferenceText),
                                Field.MostAlong - 35.0f, PrimaryInk,
                                Declared.Options[TakenOrdinal], ReferenceText);
    Recording->Stroke(Disclosure > 0.5f ? SymbolSubject::ChevronDown : SymbolSubject::ChevronRight,
                      Spanning(Field.MostAlong - 25.0f, Field.LeastAcross + 9.0f, 13.0f, 13.0f), MutedInk);

    if (Disclosure > 0.0f)
    {
        const float MenuAcross = DropdownOptionAcross * static_cast<float>(Declared.OptionCount) + 8.0f;
        const PlaneExtent Menu = { Field.LeastAlong, MenuLeast, Field.MostAlong,
                                   MenuLeast + MenuAcross * Disclosure };
        Recording->Ground(Menu, PanelGround, 9.0f, CornerAll);
        Recording->Edge(Menu, StrongHairInk, 1.0f, 9.0f, CornerAll);
        Recording->Confine(Menu);

        for (std::uint32_t Ordinal = 0u; Ordinal < Declared.OptionCount; ++Ordinal)
        {
            const PlaneExtent Option = Spanning(Menu.LeastAlong + 4.0f,
                                                Menu.LeastAcross + 4.0f + DropdownOptionAcross * static_cast<float>(Ordinal),
                                                Menu.SpanAlong() - 8.0f, DropdownOptionAcross);
            const bool Taken = Ordinal == TakenOrdinal;
            const bool Roused = Ordinal == RousedOption;

            if (Roused)
            {
                Recording->Ground(Option, TileRoused, 5.0f, CornerAll);
                Recording->Ground(Spanning(Option.LeastAlong, Option.LeastAcross, 3.0f, Option.SpanAcross()),
                                  AccentInk, 1.0f, CornerAll);
            }

            Recording->TextRunTruncated(Option.LeastAlong + 10.0f, CentredAcross(Option, SmallText),
                                        Option.MostAlong - 26.0f, Taken ? PrimaryInk : MutedInk,
                                        Declared.Options[Ordinal], SmallText, Taken);
            Recording->Medallion(Option.MostAlong - 11.0f,
                                 Option.LeastAcross + Option.SpanAcross() * 0.5f,
                                 Taken ? 4.0f : 3.0f, Taken ? AccentInk : FaintInk);
        }

        Recording->Release();
    }

    Verdict.ContactTaken = Interaction->Holding(Claimed);
    Verdict.Mark = (Disclosure > 0.0f && Disclosure < 1.0f) ? RedrawMark::Rearrange
                                                            : (HeadRoused || MenuRoused) ? RedrawMark::Recolour
                                                                                         : RedrawMark::Quiet;
    return Verdict;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        COLOUR PICKER
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ControlPanel::ColourPicker(ControlIdentity Claimed, const PlaneExtent& Extent,
                                          const ColourPickerDeclaration& Declared, PickerColour& Colour)
{
    ControlVerdict Verdict;

    if (Interaction == nullptr || Recording == nullptr)
        return Verdict;

    const PlaneExtent Head = Spanning(Extent.LeastAlong, Extent.LeastAcross + 23.0f,
                                      Extent.SpanAlong(), ColourHeadAcross);
    const PlaneExtent Caret = { Head.MostAlong - 40.0f, Head.LeastAcross, Head.MostAlong, Head.MostAcross };
    const float PickerLeast = Head.MostAcross + ColourGapAcross;
    const PlaneExtent Picker = Spanning(Extent.LeastAlong, PickerLeast, Extent.SpanAlong(), ColourPickerAcross);
    const PlaneExtent Saturation = Spanning(Picker.LeastAlong + 13.0f, Picker.LeastAcross + 13.0f,
                                            Picker.SpanAlong() - 26.0f, SaturationAcross);
    const PlaneExtent HueRail = Spanning(Saturation.LeastAlong, Saturation.MostAcross + 12.0f,
                                         Saturation.SpanAlong(), ColourBarAcross);
    const PlaneExtent OpacityRail = Spanning(Saturation.LeastAlong, HueRail.MostAcross + 11.0f,
                                             Saturation.SpanAlong(), ColourBarAcross);

    const bool Open = Interaction->Disclosed(Claimed);
    const bool HeadRoused = Head.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);
    const bool SaturationRoused = Open && Saturation.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);
    const bool HueRoused = Open && HueRail.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);
    const bool OpacityRoused = Open && OpacityRail.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);

    if (Arrived.ContactArrived)
    {
        if (HeadRoused)             Interaction->Seize(Claimed, ControlPart::Body);
        else if (SaturationRoused)  Interaction->Seize(Claimed, ControlPart::Track);
        else if (HueRoused)         Interaction->Seize(Claimed, ControlPart::Strip);
        else if (OpacityRoused)     Interaction->Seize(Claimed, ControlPart::Thumb);
        else if (Open && !Picker.Encloses(Arrived.PositionAlong, Arrived.PositionAcross))
            Interaction->Withdraw();
    }

    HsvOrdinate Hsv = ToHsv(Colour);

    if (Interaction->Holding(Claimed))
    {
        const ControlPart Part = Interaction->HeldPart(Claimed);

        if (Part == ControlPart::Track)
        {
            Hsv.Saturation = static_cast<float>(Held((Arrived.PositionAlong - Saturation.LeastAlong) /
                                                     Saturation.SpanAlong(), 0.0, 1.0));
            Hsv.Brightness = static_cast<float>(Held(1.0 - (Arrived.PositionAcross - Saturation.LeastAcross) /
                                                     Saturation.SpanAcross(), 0.0, 1.0));
            Colour = FromHsv(Hsv, Colour.Opacity);
            Verdict.OrdinateAltered = true;
        }
        else if (Part == ControlPart::Strip)
        {
            Hsv.Hue = static_cast<float>(Held((Arrived.PositionAlong - HueRail.LeastAlong) /
                                              HueRail.SpanAlong(), 0.0, 1.0) * 360.0);
            Colour = FromHsv(Hsv, Colour.Opacity);
            Verdict.OrdinateAltered = true;
        }
        else if (Part == ControlPart::Thumb)
        {
            Colour.Opacity = static_cast<std::uint8_t>(std::round(Held(
                (Arrived.PositionAlong - OpacityRail.LeastAlong) / OpacityRail.SpanAlong(), 0.0, 1.0) * 255.0));
            Verdict.OrdinateAltered = true;
        }
    }

    const bool QuickTap = Arrived.ContactArrived && Arrived.ContactReleased && HeadRoused;

    if ((Interaction->Released(Claimed) && HeadRoused) || QuickTap)
    {
        if (Open) Interaction->Withdraw();
        else      Interaction->Disclose(Claimed);
    }

    const bool DisclosureOpen = Interaction->Disclosed(Claimed);
    Interaction->DeclareRoused(Claimed, HeadRoused, RouseDuration);
    Interaction->DeclareTaken(Claimed, DisclosureOpen, DiscloseDuration);

    const float Disclosure = Interaction->TakenFraction(Claimed);
    const float RouseFraction = Interaction->RousedFraction(Claimed);
    Hsv = ToHsv(Colour);

    Recording->TextRun(Extent.LeastAlong, Extent.LeastAcross,
                       Blend(MutedInk, PrimaryInk, RouseFraction), Declared.Caption, ReferenceText);
    Recording->Ground(Head, FieldGround, 20.0f, CornerAll);
    Recording->Ground(Caret, Blend(UnitGround, TileRoused, RouseFraction), 20.0f,
                      CornerTrailingUpper | CornerTrailingLower);

    InkOrdinate CurrentInk{ Colour.Red, Colour.Green, Colour.Blue, Colour.Opacity };
    Recording->Medallion(Head.LeastAlong + 24.0f, Head.LeastAcross + 20.0f, 12.0f, CurrentInk);
    Recording->Edge(Spanning(Head.LeastAlong + 12.0f, Head.LeastAcross + 8.0f, 24.0f, 24.0f),
                    StrongHairInk, 1.0f, 12.0f, CornerAll);

    char RgbaRun[64] = {};
    std::snprintf(RgbaRun, sizeof(RgbaRun), "rgba(%u, %u, %u, %.2f)",
                  static_cast<unsigned>(Colour.Red), static_cast<unsigned>(Colour.Green),
                  static_cast<unsigned>(Colour.Blue), static_cast<double>(Colour.Opacity) / 255.0);
    Recording->TextRunTruncated(Head.LeastAlong + 47.0f, CentredAcross(Head, ReferenceText),
                                Caret.LeastAlong - 8.0f, PrimaryInk, RgbaRun, ReferenceText);
    Recording->Stroke(Disclosure > 0.5f ? SymbolSubject::ChevronDown : SymbolSubject::ChevronRight,
                      Spanning(Caret.LeastAlong + 13.0f, Caret.LeastAcross + 13.0f, 14.0f, 14.0f), MutedInk);

    if (Disclosure > 0.0f)
    {
        const PlaneExtent Revealed = { Picker.LeastAlong, Picker.LeastAcross, Picker.MostAlong,
                                       Picker.LeastAcross + Picker.SpanAcross() * Disclosure };
        Recording->Ground(Revealed, ValueGround, 13.0f, CornerAll);
        Recording->Confine(Revealed);

        HsvOrdinate HueOnly{ Hsv.Hue, 1.0f, 1.0f };
        const PickerColour HueColour = FromHsv(HueOnly, 255u);
        Recording->Ground(Saturation, { HueColour.Red, HueColour.Green, HueColour.Blue, 255u }, 10.0f, CornerAll);
        Recording->Scrim(Saturation, WhiteInk, { 255u, 255u, 255u, 0u }, ScrimAxis::Along);
        Recording->Scrim(Saturation, { 0u, 0u, 0u, 0u }, { 0u, 0u, 0u, 255u }, ScrimAxis::Across);
        Recording->MaskCorners(Saturation, ValueGround, 10.0f);

        const float SaturationAlong = Saturation.LeastAlong + Saturation.SpanAlong() * Hsv.Saturation;
        const float BrightnessAcross = Saturation.LeastAcross + Saturation.SpanAcross() * (1.0f - Hsv.Brightness);
        Recording->Medallion(SaturationAlong, BrightnessAcross, 9.0f, WhiteInk);
        Recording->Medallion(SaturationAlong, BrightnessAcross, 6.0f, CurrentInk);

        constexpr InkOrdinate HueStops[7] = {
            Covering(0xFF0000u), Covering(0xFFFF00u), Covering(0x00FF00u), Covering(0x00FFFFu),
            Covering(0x0000FFu), Covering(0xFF00FFu), Covering(0xFF0000u)
        };
        const float HueSegment = HueRail.SpanAlong() / 6.0f;

        for (std::uint32_t Ordinal = 0u; Ordinal < 6u; ++Ordinal)
        {
            Recording->Scrim(Spanning(HueRail.LeastAlong + HueSegment * static_cast<float>(Ordinal),
                                      HueRail.LeastAcross, HueSegment + 1.0f, HueRail.SpanAcross()),
                             HueStops[Ordinal], HueStops[Ordinal + 1u], ScrimAxis::Along);
        }
        Recording->MaskCorners(HueRail, ValueGround, ColourBarAcross * 0.5f);

        const float HueAlong = HueRail.LeastAlong + HueRail.SpanAlong() * (Hsv.Hue / 360.0f);
        Recording->Medallion(HueAlong, HueRail.LeastAcross + 8.0f, 10.0f, Covering(0x1B1B1Eu));
        Recording->Medallion(HueAlong, HueRail.LeastAcross + 8.0f, 8.0f, WhiteInk);

        constexpr float CheckExtent = 10.0f;
        const std::uint32_t AlongCount = static_cast<std::uint32_t>(
            std::ceil(OpacityRail.SpanAlong() / CheckExtent));
        const std::uint32_t AcrossCount = static_cast<std::uint32_t>(
            std::ceil(OpacityRail.SpanAcross() / CheckExtent));
        Recording->Confine(OpacityRail);

        for (std::uint32_t AcrossOrdinal = 0u; AcrossOrdinal < AcrossCount; ++AcrossOrdinal)
        {
            for (std::uint32_t AlongOrdinal = 0u; AlongOrdinal < AlongCount; ++AlongOrdinal)
            {
                const InkOrdinate CheckInk = ((AlongOrdinal + AcrossOrdinal) % 2u == 0u)
                                            ? Covering(0x808080u) : Covering(0xC0C0C0u);
                Recording->Ground(Spanning(OpacityRail.LeastAlong + CheckExtent * static_cast<float>(AlongOrdinal),
                                           OpacityRail.LeastAcross + CheckExtent * static_cast<float>(AcrossOrdinal),
                                           CheckExtent, CheckExtent), CheckInk, 0.0f, CornerNone);
            }
        }

        Recording->Scrim(OpacityRail, { Colour.Red, Colour.Green, Colour.Blue, 0u },
                          { Colour.Red, Colour.Green, Colour.Blue, 255u }, ScrimAxis::Along);
        Recording->MaskCorners(OpacityRail, ValueGround, ColourBarAcross * 0.5f);
        Recording->Release();
        const float OpacityAlong = OpacityRail.LeastAlong + OpacityRail.SpanAlong() *
                                  (static_cast<float>(Colour.Opacity) / 255.0f);
        Recording->Medallion(OpacityAlong, OpacityRail.LeastAcross + 8.0f, 10.0f, Covering(0x1B1B1Eu));
        Recording->Medallion(OpacityAlong, OpacityRail.LeastAcross + 8.0f, 8.0f, WhiteInk);

        const PlaneExtent HexField = Spanning(Picker.LeastAlong + 13.0f, OpacityRail.MostAcross + 12.0f,
                                              108.0f, 36.0f);
        Recording->Ground(HexField, NumberGround, 9.0f, CornerAll);
        char HexRun[8] = {};
        std::snprintf(HexRun, sizeof(HexRun), "#%02X%02X%02X",
                      static_cast<unsigned>(Colour.Red), static_cast<unsigned>(Colour.Green),
                      static_cast<unsigned>(Colour.Blue));
        Recording->TextRun(HexField.LeastAlong + 10.0f, CentredAcross(HexField, 14.0f),
                           PrimaryInk, HexRun, 14.0f);

        char AlphaRun[16] = {};
        std::snprintf(AlphaRun, sizeof(AlphaRun), "A %u%%",
                      static_cast<unsigned>(std::round(static_cast<double>(Colour.Opacity) / 255.0 * 100.0)));
        const float AlphaAlong = Recording->MeasureRun(AlphaRun, ReferenceText);
        Recording->TextRun(Picker.MostAlong - AlphaAlong - 13.0f, CentredAcross(HexField, ReferenceText),
                           MutedInk, AlphaRun, ReferenceText);
        Recording->Release();
    }

    Verdict.ContactTaken = Interaction->Holding(Claimed);
    Verdict.Mark = (Disclosure > 0.0f && Disclosure < 1.0f) ? RedrawMark::Rearrange
                                                            : Verdict.OrdinateAltered ? RedrawMark::Recolour
                                                                                      : RedrawMark::Quiet;
    return Verdict;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OUTLINE DISCLOSURE
//------------------------------------------------------------------------------------------------------------------------

float ControlPanel::OutlineExpansion(ControlIdentity Claimed, bool ExpansionEnabled, bool AnimationEnabled)
{
    if (Interaction == nullptr || !Interaction->Resolves(Claimed))
        return ExpansionEnabled ? 1.0f : 0.0f;

    if (!AnimationEnabled)
        return ExpansionEnabled ? 1.0f : 0.0f;

    Interaction->DeclareTaken(Claimed, ExpansionEnabled, RouseDuration, EaseCurve::CssEase);
    return Interaction->TakenFraction(Claimed);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        OUTLINE ROW
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ControlPanel::OutlineRow(ControlIdentity Claimed, const PlaneExtent& Extent,
                                        const OutlineDeclaration& Declared, bool SelectionExtended,
                                        float ExpansionFraction, OutlineDropPlacement DropPlacement,
                                        bool& ExpansionEnabled, bool& Selected, bool& PresenceEnabled)
{
    ControlVerdict Verdict;

    if (Interaction == nullptr || Recording == nullptr)
        return Verdict;

    const float Indent = 7.0f + static_cast<float>(Declared.Depth) * 17.0f;
    const PlaneExtent DisclosureExtent = Spanning(Extent.LeastAlong + Indent - 2.0f,
                                                   Extent.LeastAcross + 3.0f, 18.0f, 22.0f);
    const PlaneExtent PresenceExtent = Spanning(Extent.MostAlong - 27.0f, Extent.LeastAcross + 3.0f, 22.0f, 22.0f);
    const bool DisclosureRoused = Declared.EnclosedCount > 0u &&
                                  DisclosureExtent.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);
    const bool PresenceRoused = PresenceExtent.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);
    const bool RowRoused      = Extent.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);
    const float DragAlong     = Arrived.PositionAlong - Interaction->OriginAlong();
    const float DragAcross    = Arrived.PositionAcross - Interaction->OriginAcross();
    const bool BodyHeld       = Interaction->Holding(Claimed) &&
                                Interaction->HeldPart(Claimed) == ControlPart::Body;
    const bool BodyReleased   = Interaction->Released(Claimed) &&
                                Interaction->ReleasedControlPart(Claimed) == ControlPart::Body;
    const bool Dragged        = (BodyHeld || BodyReleased) &&
                                (DragAlong * DragAlong + DragAcross * DragAcross >= 16.0f);

    if (RowRoused && Arrived.ContactArrived)
    {
        Interaction->Seize(Claimed, (PresenceRoused || DisclosureRoused)
                                  ? ControlPart::Chevron : ControlPart::Body);
    }

    if (((Interaction->Released(Claimed) && RowRoused) ||
         (Arrived.ContactArrived && Arrived.ContactReleased && RowRoused)) && !Dragged)
    {
        if (DisclosureRoused)
            ExpansionEnabled = !ExpansionEnabled;
        else if (PresenceRoused)
            PresenceEnabled = !PresenceEnabled;
        else if (SelectionExtended)
            Selected = !Selected;
        else
            Selected = true;

        Verdict.OrdinateAltered = true;
    }

    Interaction->DeclareRoused(Claimed, RowRoused, RouseDuration);
    Interaction->DeclareTaken(Claimed, Selected, TakeDuration);

    const float RouseFraction = Interaction->RousedFraction(Claimed);
    const float SelectionFraction = Interaction->TakenFraction(Claimed);

    if (SelectionFraction > 0.0f)
    {
        Recording->Ground(Extent, Blend(TileGround, AccentSoftInk, SelectionFraction), 5.0f, CornerAll);
        Recording->Ground(Spanning(Extent.LeastAlong, Extent.LeastAcross,
                                   Between(0.0f, 2.0f, SelectionFraction), Extent.SpanAcross()), AccentInk,
                          1.0f, CornerAll);
    }
    else if (RouseFraction > 0.0f)
    {
        Recording->Ground(Extent, Blend(TileGround, TileRoused, RouseFraction), 5.0f, CornerAll);
    }

    if (DropPlacement == OutlineDropPlacement::Before)
    {
        Recording->Ground(Spanning(Extent.LeastAlong, Extent.LeastAcross,
                                   Extent.SpanAlong(), 2.0f), AccentInk, 1.0f, CornerAll);
    }
    else if (DropPlacement == OutlineDropPlacement::After)
    {
        Recording->Ground(Spanning(Extent.LeastAlong, Extent.MostAcross - 2.0f,
                                   Extent.SpanAlong(), 2.0f), AccentInk, 1.0f, CornerAll);
    }
    else if (DropPlacement == OutlineDropPlacement::Enclosed)
    {
        Recording->Ground(Extent, AccentSoftInk, 5.0f, CornerAll);
        Recording->Edge(Extent, AccentInk, 1.0f, 5.0f, CornerAll);
    }

    if (Dragged)
        Recording->Edge(Extent, StrongHairInk, 1.0f, 5.0f, CornerAll);

    if (Declared.EnclosedCount > 0u)
    {
        constexpr float QuarterTurn = 1.5707963268f;   // [rad] - 90 degrees
        const float Turn = -(1.0f - ExpansionFraction) * QuarterTurn;
        Recording->Stroke(SymbolSubject::ChevronDown,
                          Spanning(Extent.LeastAlong + Indent, Extent.LeastAcross + 7.0f, 12.0f, 12.0f),
                          FaintInk, Turn);
    }

    Recording->Stroke(SymbolSubject::PlaceholderMark,
                      Spanning(Extent.LeastAlong + Indent + 17.0f, Extent.LeastAcross + 5.0f, 16.0f, 16.0f),
                      PresenceEnabled ? AccentInk : FaintInk);
    Recording->TextRunTruncated(Extent.LeastAlong + Indent + 39.0f, CentredAcross(Extent, ReferenceText),
                                Extent.MostAlong - 34.0f, PresenceEnabled ? PrimaryInk : FaintInk,
                                Declared.Caption, ReferenceText, Selected);

    Recording->Edge(PresenceExtent, PresenceRoused ? StrongHairInk : HairInk, 1.0f, 5.0f, CornerAll);
    Recording->Medallion(PresenceExtent.LeastAlong + 11.0f, PresenceExtent.LeastAcross + 11.0f,
                         PresenceEnabled ? 3.0f : 1.5f,
                         PresenceEnabled ? MutedInk : AbsentInk);

    Verdict.ContactTaken = Interaction->Holding(Claimed);
    Verdict.Mark         = RowRoused ? RedrawMark::Recolour : RedrawMark::Quiet;

    return Verdict;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      REVISION MARKER
//------------------------------------------------------------------------------------------------------------------------

void ControlPanel::RevisionRow(const PlaneExtent& Extent, const RevisionDeclaration& Declared, bool Taken)
{
    if (Recording == nullptr)
        return;

    const float MarkerAlong = Extent.LeastAlong + 12.0f;
    Recording->Ground(Spanning(MarkerAlong - 0.5f, Extent.LeastAcross, 1.0f, Extent.SpanAcross()), HairInk,
                      0.0f, CornerNone);
    Recording->Medallion(MarkerAlong, Extent.LeastAcross + Extent.SpanAcross() * 0.5f, Taken ? 5.0f : 4.0f,
                         Taken ? AccentInk : FaintInk);

    const PlaneExtent Card = { Extent.LeastAlong + 28.0f, Extent.LeastAcross + 3.0f,
                               Extent.MostAlong, Extent.MostAcross - 3.0f };
    Recording->Ground(Card, Taken ? AccentSoftInk : TileGround, 7.0f, CornerAll);
    Recording->Edge(Card, Taken ? AccentInk : HairInk, 1.0f, 7.0f, CornerAll);
    Recording->TextRunTruncated(Card.LeastAlong + 9.0f, Card.LeastAcross + 7.0f, Card.MostAlong - 58.0f,
                                PrimaryInk, Declared.Description, ReferenceText, true);
    Recording->TextRunTruncated(Card.LeastAlong + 9.0f, Card.LeastAcross + 24.0f, Card.MostAlong - 58.0f,
                                MutedInk, Declared.Secondary, SmallText);

    const float TimeAlong = Recording->MeasureRun(Declared.TimeRun, SmallText);
    Recording->TextRun(Card.MostAlong - TimeAlong - 8.0f, Card.LeastAcross + 7.0f,
                       FaintInk, Declared.TimeRun, SmallText);
}

void ControlPanel::Reset()
{
    Interaction = nullptr;
    Recording   = nullptr;
    Appearance  = nullptr;
    Arrived     = {};
}

}   // namespace Slate
