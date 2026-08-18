//============================================================================================================================================
//                                                            FACETPANEL.CPP
//============================================================================================================================================
// 🧩 Wrapped active-facet chips and shared dropdown selection inside one reusable validation card.

#include "SlateUI/Interface/FacetPanel/Api/FacetPanel.h"

#include <cstdio>

namespace Slate
{

namespace
{

constexpr float CardRadius       = 12.0f;   // [px] - --r-tile
constexpr float CardPad          = 10.0f;   // [px] - chips-region horizontal padding
constexpr float HeaderAcross     = 22.0f;   // [px] - heading and count line
constexpr float HeaderGap        = 8.0f;    // [px] - heading to chips
constexpr float ChipAcross       = 27.0f;   // [px] - chip and add button height
constexpr float ChipGap          = 6.0f;    // [px] - flex gap
constexpr float ChipPadLeading   = 10.0f;   // [px] - caption leading inset
constexpr float ChipSwatch       = 9.0f;    // [px] - classification dot
constexpr float ChipSwatchGap    = 6.0f;    // [px] - dot to caption
constexpr float ChipRemove       = 17.0f;   // [px] - circular remove action
constexpr float ChipRemoveGap    = 6.0f;    // [px] - caption to remove action
constexpr float ChipPadTrailing  = 5.0f;    // [px] - remove action trailing inset
constexpr float DropdownGap      = 10.0f;   // [px] - chips to dropdown
constexpr float CardTrailingPad  = 10.0f;   // [px] - dropdown to card edge
constexpr float CountAlong       = 24.0f;   // [px] - active count badge floor
constexpr float ClearAlong       = 48.0f;   // [px] - clear-all action

float Scaled(float Figure, const AppearanceSpecification& Appearance)
{
    return Figure * Appearance.Measure.DisplayScale;
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                       CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> FacetPanel::Construct(MotionIntegrator& ArrivingMotion,
                                    RecordingSurface& ArrivingSurface,
                                    const AppearanceSpecification& ArrivingAppearance)
{
    if (Motion != nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a facet panel construction stands" });

    Motion     = &ArrivingMotion;
    Surface    = &ArrivingSurface;
    Appearance = &ArrivingAppearance;

    if (!Interaction.Construct(ArrivingMotion).ContentPresent)
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "facet interaction was refused" });

    if (!SharedControls.Construct(Interaction, ArrivingSurface, ArrivingAppearance).ContentPresent)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "shared facet controls were refused" });

    for (std::uint32_t Ordinal = 0u; Ordinal < FacetCapacity + 2u; ++Ordinal)
    {
        const Deliver<ControlIdentity> Issued = Interaction.Enrol();
        if (!Issued.ContentPresent)
            return Deliver<bool>::Refuse(Issued.Declined);

        Controls[Ordinal] = Issued.Resolve();
    }

    return Deliver<bool>::Deliver(true);
}

void FacetPanel::Advance(const PointerCondition& Arrived, double Elapsed)
{
    Pointer = Arrived;
    Interaction.Advance(Arrived, Elapsed);
    SharedControls.Sample(Arrived);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        ARRANGEMENT
//------------------------------------------------------------------------------------------------------------------------

FacetPanel::Arrangement FacetPanel::Arrange(float Along,
                                            float Across,
                                            float ExtentAlong,
                                            const FacetDeclaration& Declared,
                                            const bool* Enabled) const
{
    Arrangement Arranged;
    if (Surface == nullptr || Appearance == nullptr || ExtentAlong <= 0.0f)
        return Arranged;

    const float Scale = Appearance->Measure.DisplayScale;
    const float Pad = CardPad * Scale;
    const float InteriorAlong = (ExtentAlong > Pad * 2.0f) ? ExtentAlong - Pad * 2.0f : 0.0f;
    const float TextSize = (Appearance->ControlMeasure.RowText > 11.0f * Scale)
                         ? Appearance->ControlMeasure.RowText : 11.0f * Scale;
    const float ChipHeight = ChipAcross * Scale;
    const float Gap = ChipGap * Scale;
    float ChipAlong = 0.0f;
    float ChipCursorAcross = 0.0f;
    float ChipsAcross = ChipHeight;
    bool ActivePresent = false;

    const std::uint32_t Count = (Declared.OptionCount < FacetCapacity)
                              ? Declared.OptionCount : FacetCapacity;
    for (std::uint32_t Ordinal = 0u; Ordinal < Count; ++Ordinal)
    {
        if (Enabled == nullptr || !Enabled[Ordinal])
            continue;

        ActivePresent = true;
        const char* Caption = (Declared.Options != nullptr && Declared.Options[Ordinal] != nullptr)
                            ? Declared.Options[Ordinal] : "";
        const float CaptionAlong = Surface->MeasureRun(Caption, TextSize);
        const float RequiredAlong = (ChipPadLeading + ChipSwatch + ChipSwatchGap + ChipRemoveGap +
                                     ChipRemove + ChipPadTrailing) * Scale + CaptionAlong;
        if (ChipAlong > 0.0f && ChipAlong + RequiredAlong > InteriorAlong)
        {
            ChipAlong = 0.0f;
            ChipCursorAcross += ChipHeight + Gap;
            ChipsAcross += ChipHeight + Gap;
        }

        ChipAlong += RequiredAlong + Gap;
    }

    if (!ActivePresent)
        ChipsAcross = ChipHeight;

    const float HeaderHeight = HeaderAcross * Scale;
    const float HeaderToChips = HeaderGap * Scale;
    const float ChipsLeast = Across + Pad + HeaderHeight + HeaderToChips;
    const float DropdownLeast = ChipsLeast + ChipsAcross + DropdownGap * Scale;
    const float DropdownAcross = Appearance->ControlMeasure.FieldAcross;

    Arranged.Header = Spanning(Along + Pad, Across + Pad, InteriorAlong, HeaderHeight);
    Arranged.Chips = Spanning(Along + Pad, ChipsLeast, InteriorAlong, ChipsAcross);
    Arranged.Dropdown = Spanning(Along + Pad, DropdownLeast, InteriorAlong, DropdownAcross);
    Arranged.TotalAcross = Pad + HeaderHeight + HeaderToChips + ChipsAcross + DropdownGap * Scale +
                           DropdownAcross + CardTrailingPad * Scale;
    return Arranged;
}

float FacetPanel::MeasureAcross(float ExtentAlong,
                                const FacetDeclaration& Declared,
                                const bool* Enabled) const
{
    return Arrange(0.0f, 0.0f, ExtentAlong, Declared, Enabled).TotalAcross;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        INTERACTION
//------------------------------------------------------------------------------------------------------------------------

bool FacetPanel::Pressed(std::uint32_t Ordinal, const PlaneExtent& Extent)
{
    if (Ordinal >= FacetCapacity + 2u)
        return false;

    const ControlIdentity Claimed = Controls[Ordinal];
    const bool Roused = Extent.Encloses(Pointer.PositionAlong, Pointer.PositionAcross);
    if (Roused && Pointer.ContactArrived && !Interaction.AnyDisclosed())
        Interaction.Seize(Claimed, ControlPart::Body);

    Interaction.DeclareRoused(Claimed, Roused, 130.0);
    return Roused && Interaction.Released(Claimed);
}

InkOrdinate FacetPanel::FacetInk(const FacetDeclaration& Declared, std::uint32_t Ordinal) const
{
    if (Declared.Inks != nullptr && Ordinal < Declared.OptionCount)
        return Declared.Inks[Ordinal];

    return Appearance != nullptr ? Appearance->Control.StopTaken : Covering(0xE8E8E8u);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                         RECORDING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> FacetPanel::Record(const PlaneExtent& Extent,
                                 const FacetDeclaration& Declared,
                                 bool* Enabled)
{
    if (Surface == nullptr || Appearance == nullptr || Motion == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no facet panel construction stands" });

    const std::uint32_t Count = (Declared.OptionCount < FacetCapacity)
                              ? Declared.OptionCount : FacetCapacity;
    const Arrangement Arranged = Arrange(Extent.LeastAlong, Extent.LeastAcross,
                                         Extent.SpanAlong(), Declared, Enabled);
    const ControlInk& Ink = Appearance->Control;
    const float Scale = Appearance->Measure.DisplayScale;
    const float Radius = CardRadius * Scale;
    const float TextSize = (Appearance->ControlMeasure.RowText > 11.0f * Scale)
                         ? Appearance->ControlMeasure.RowText : 11.0f * Scale;

    Surface->Ground(Extent, Ink.CardGround, Radius, CornerAll);
    Surface->Edge(Extent, Ink.CardEdge, Appearance->ControlMeasure.CardEdgeWeight, Radius, CornerAll);

    std::uint32_t ActiveCount = 0u;
    for (std::uint32_t Ordinal = 0u; Ordinal < Count; ++Ordinal)
        if (Enabled != nullptr && Enabled[Ordinal]) ++ActiveCount;

    Surface->TextRunCapitalised(Arranged.Header.LeastAlong,
                                Arranged.Header.LeastAcross + 5.0f * Scale,
                                Ink.LabelQuiet,
                                Declared.Caption,
                                Appearance->ControlMeasure.LabelText,
                                0.08f,
                                false);

    char CountRun[12] = {};
    std::snprintf(CountRun, sizeof(CountRun), "%u", static_cast<unsigned>(ActiveCount));
    const PlaneExtent CountBadge = Spanning(Arranged.Header.LeastAlong +
                                               Surface->MeasureRun(Declared.Caption,
                                                                   Appearance->ControlMeasure.LabelText,
                                                                   0.08f) + 10.0f * Scale,
                                           Arranged.Header.LeastAcross + 2.0f * Scale,
                                           CountAlong * Scale,
                                           18.0f * Scale);
    Surface->Ground(CountBadge, Ink.StopTaken, 9.0f * Scale, CornerAll);
    Surface->TextRun(CountBadge.LeastAlong + CountBadge.SpanAlong() * 0.5f,
                     CountBadge.LeastAcross + 4.0f * Scale,
                     Ink.StopTakenInk,
                     CountRun,
                     Appearance->ControlMeasure.LabelText,
                     0.0f,
                     true);

    const PlaneExtent Clear = Spanning(Arranged.Header.MostAlong - ClearAlong * Scale,
                                       Arranged.Header.LeastAcross,
                                       ClearAlong * Scale,
                                       Arranged.Header.SpanAcross());
    if (ActiveCount > ((Declared.LockedOrdinal < Count && Enabled != nullptr &&
                        Enabled[Declared.LockedOrdinal]) ? 1u : 0u))
    {
        Surface->TextRun(Clear.LeastAlong,
                         Clear.LeastAcross + 5.0f * Scale,
                         Ink.LabelQuiet,
                         "Clear all",
                         Appearance->ControlMeasure.LabelText,
                         0.0f,
                         false);
        if (Pressed(1u, Clear) && Enabled != nullptr)
        {
            for (std::uint32_t Ordinal = 0u; Ordinal < Count; ++Ordinal)
                Enabled[Ordinal] = Ordinal == Declared.LockedOrdinal;
        }
    }

    const float ChipHeight = ChipAcross * Scale;
    const float Gap = ChipGap * Scale;
    float CursorAlong = Arranged.Chips.LeastAlong;
    float CursorAcross = Arranged.Chips.LeastAcross;
    for (std::uint32_t Ordinal = 0u; Ordinal < Count; ++Ordinal)
    {
        if (Enabled == nullptr || !Enabled[Ordinal])
            continue;

        const char* Caption = (Declared.Options != nullptr && Declared.Options[Ordinal] != nullptr)
                            ? Declared.Options[Ordinal] : "";
        const float CaptionAlong = Surface->MeasureRun(Caption, TextSize);
        const float RequiredAlong = (ChipPadLeading + ChipSwatch + ChipSwatchGap + ChipRemoveGap +
                                     ChipRemove + ChipPadTrailing) * Scale + CaptionAlong;
        if (CursorAlong > Arranged.Chips.LeastAlong && CursorAlong + RequiredAlong > Arranged.Chips.MostAlong)
        {
            CursorAlong = Arranged.Chips.LeastAlong;
            CursorAcross += ChipHeight + Gap;
        }

        const PlaneExtent Chip = Spanning(CursorAlong, CursorAcross, RequiredAlong, ChipHeight);
        Surface->Ground(Chip, Ink.FieldGround, ChipHeight * 0.5f, CornerAll);
        Surface->Edge(Chip, Ink.CardEdge, Appearance->ControlMeasure.CardEdgeWeight,
                      ChipHeight * 0.5f, CornerAll);
        Surface->Medallion(Chip.LeastAlong + ChipPadLeading * Scale + ChipSwatch * Scale * 0.5f,
                           Chip.LeastAcross + ChipHeight * 0.5f,
                           ChipSwatch * Scale * 0.5f,
                           FacetInk(Declared, Ordinal));
        const float CaptionLeast = Chip.LeastAlong + (ChipPadLeading + ChipSwatch + ChipSwatchGap) * Scale;
        Surface->TextRun(CaptionLeast,
                         Chip.LeastAcross + (ChipHeight - TextSize) * 0.5f,
                         Ink.FieldInk,
                         Caption,
                         TextSize,
                         0.0f,
                         false);

        const PlaneExtent Remove = Spanning(Chip.MostAlong - (ChipRemove + ChipPadTrailing) * Scale,
                                            Chip.LeastAcross + (ChipHeight - ChipRemove * Scale) * 0.5f,
                                            ChipRemove * Scale,
                                            ChipRemove * Scale);
        Surface->Ground(Remove, Ink.CellGround, Remove.SpanAcross() * 0.5f, CornerAll);
        Surface->Stroke(SymbolSubject::PlaceholderMark, Spanning(Remove.LeastAlong + 4.0f * Scale,
                                                       Remove.LeastAcross + 4.0f * Scale,
                                                       Remove.SpanAlong() - 8.0f * Scale,
                                                       Remove.SpanAcross() - 8.0f * Scale),
                        Ink.CellInk);
        if (Ordinal != Declared.LockedOrdinal && Pressed(Ordinal + 2u, Remove))
            Enabled[Ordinal] = false;

        CursorAlong = Chip.MostAlong + Gap;
    }

    AvailableCount = 1u;
    AvailableOptions[0] = "Choose filter...";
    AvailableOrdinals[0] = AbsentFacet;
    for (std::uint32_t Ordinal = 0u; Ordinal < Count; ++Ordinal)
    {
        if (Enabled != nullptr && Enabled[Ordinal])
            continue;

        AvailableOptions[AvailableCount] = Declared.Options != nullptr ? Declared.Options[Ordinal] : "";
        AvailableOrdinals[AvailableCount] = Ordinal;
        ++AvailableCount;
    }

    SelectionDeclaration Dropdown;
    Dropdown.Caption     = (AvailableCount > 1u) ? "Add filter" : "Filters";
    Dropdown.Options     = AvailableOptions;
    Dropdown.OptionCount = AvailableCount;
    if (PendingSelection >= AvailableCount)
        PendingSelection = 0u;

    const ControlVerdict Selected = SharedControls.SelectionField(Controls[0], Arranged.Dropdown,
                                                                  Dropdown, PendingSelection);
    if (Selected.OrdinateAltered && PendingSelection > 0u && PendingSelection < AvailableCount && Enabled != nullptr)
    {
        const std::uint32_t FacetOrdinal = AvailableOrdinals[PendingSelection];
        if (FacetOrdinal < Count)
            Enabled[FacetOrdinal] = true;
        PendingSelection = 0u;
    }

    return Deliver<bool>::Deliver(true);
}

void FacetPanel::RecordDeferred()
{
    SharedControls.RecordDeferred();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       RECLAMATION
//------------------------------------------------------------------------------------------------------------------------

void FacetPanel::Reset()
{
    SharedControls.Reset();
    Interaction.Reset();
    Motion           = nullptr;
    Surface          = nullptr;
    Appearance       = nullptr;
    Pointer          = {};
    AvailableCount   = 0u;
    PendingSelection = 0u;

    for (std::uint32_t Ordinal = 0u; Ordinal < FacetCapacity + 2u; ++Ordinal)
        Controls[Ordinal] = {};
    for (std::uint32_t Ordinal = 0u; Ordinal < FacetCapacity + 1u; ++Ordinal)
    {
        AvailableOptions[Ordinal] = nullptr;
        AvailableOrdinals[Ordinal] = AbsentFacet;
    }
}

}   // namespace Slate
