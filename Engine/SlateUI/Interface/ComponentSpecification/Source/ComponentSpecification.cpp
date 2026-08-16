//============================================================================================================================================
//                                                            COMPONENTSPECIFICATION.CPP
//============================================================================================================================================
// 🧩 The eight controls, arranged and recorded from the sheet's own figures, arbitrated against the ledger's one seizure.

#include "SlateUI/Interface/ComponentSpecification/Api/ComponentSpecification.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                     SHARED ARITHMETIC
//------------------------------------------------------------------------------------------------------------------------

namespace
{

constexpr double RouseDuration    = 200.0;   // [ms] - the sheet's transition-colors on a hover
constexpr double DiscloseDuration = 150.0;   // [ms] - the accordion and the chevron's turn
constexpr double TooltipDuration  = 300.0;   // [ms] - duration-300 on the tooltip's opacity

/// 🧩 Interpolates between two ordinates by a fraction already clamped to the unit interval.
/// cost  ✔️
constexpr float Between(float Departed, float Arriving, float Fraction)
{
    return Departed + (Arriving - Departed) * Fraction;
}

/// 🧩 Blends two inks by a fraction, component by component, in the display-referred encoding they are in.
/// note  ⚠️ Blended where they are declared — display-referred — and not in a linear space. `08` §3.1 places
///       the interface after the tone projection, and a fade that linearised would disagree with the browser
///       the sheet was measured in, which interpolates sRGB ordinates exactly as this does.
/// cost  ✔️
constexpr std::uint8_t BlendOrdinate(std::uint8_t Departed, std::uint8_t Arriving, float Fraction)
{
    return static_cast<std::uint8_t>(
        Between(static_cast<float>(Departed), static_cast<float>(Arriving), Fraction) + 0.5f);
}

constexpr InkOrdinate Blend(InkOrdinate Departed, InkOrdinate Arriving, float Fraction)
{
    const float Held = (Fraction < 0.0f) ? 0.0f : (Fraction > 1.0f) ? 1.0f : Fraction;

    return InkOrdinate{ BlendOrdinate(Departed.Red,     Arriving.Red,     Held),
                        BlendOrdinate(Departed.Green,   Arriving.Green,   Held),
                        BlendOrdinate(Departed.Blue,    Arriving.Blue,    Held),
                        BlendOrdinate(Departed.Opacity, Arriving.Opacity, Held) };
}

/// 🧩 Restates an ink at a fraction of its own coverage — what a fading tooltip records with.
/// cost  ✔️
constexpr InkOrdinate Faded(InkOrdinate Declared, float Fraction)
{
    const float Held = (Fraction < 0.0f) ? 0.0f : (Fraction > 1.0f) ? 1.0f : Fraction;

    InkOrdinate Restated = Declared;
    Restated.Opacity     = static_cast<std::uint8_t>(static_cast<float>(Declared.Opacity) * Held + 0.5f);

    return Restated;
}

/// 🧩 Holds an ordinate inside a stated interval.
/// cost  ✔️
constexpr double Held(double Ordinate, double Least, double Most)
{
    return (Ordinate < Least) ? Least : (Ordinate > Most) ? Most : Ordinate;
}

/// 🧩 The extent one run occupies, centred across a stated extent at its own leading.
/// note  📐 The vendor places a run by its upper edge, and every extent the sheet states is centred within
///        its row. Deriving the upper edge here rather than at nineteen call sites is what keeps a run from
///        sitting a pixel high in one control and correct in the next.
/// cost  ✔️
constexpr float CentredAcross(const PlaneExtent& Extent, float PointSize)
{
    return Extent.LeastAcross + (Extent.SpanAcross() - PointSize) * 0.5f;
}

/// 🧩 Rounds an integral reading to its decimal run, without allocating.
/// in    Staging   [-]  receives the run; at least twelve characters
/// note  Written rather than reached for through a formatting call, because no formatting call in the
///       standard library is both non-allocating and available at this seam.
/// cost  ✔️
void IntegralRun(char* Staging, std::uint32_t StagingExtent, long long Reading)
{
    if (Staging == nullptr || StagingExtent < 2u)
        return;

    char          Reversed[20] = {};
    std::uint32_t Digits       = 0u;
    const bool    Negative     = Reading < 0;

    unsigned long long Magnitude = Negative ? static_cast<unsigned long long>(-(Reading + 1)) + 1ull
                                            : static_cast<unsigned long long>(Reading);

    if (Magnitude == 0ull)
    {
        Reversed[Digits++] = '0';
    }

    while (Magnitude > 0ull && Digits < 19u)
    {
        Reversed[Digits++] = static_cast<char>('0' + (Magnitude % 10ull));
        Magnitude /= 10ull;
    }

    std::uint32_t Written = 0u;

    if (Negative && Written + 1u < StagingExtent)
        Staging[Written++] = '-';

    while (Digits > 0u && Written + 1u < StagingExtent)
        Staging[Written++] = Reversed[--Digits];

    Staging[Written] = '\0';
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE TWO PROJECTIONS
//------------------------------------------------------------------------------------------------------------------------

double MagnitudeFraction(double Ordinate, double Least, double Most)
{
    const double Span = Most - Least;

    if (Span <= 0.0)
        return 0.0;

    return Held((Ordinate - Least) / Span, 0.0, 1.0);
}

double RotationDegrees(double Departed, double TravelAlong, double DegreesPerPixel)
{
    // 📐 The sheet: `rotationValue = startValRot - (deltaX / 10)`. Stated as a rate so that the reduction
    //    factor cannot silently change how far a drag turns the dial.
    return Departed - TravelAlong * DegreesPerPixel;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> ComponentSpecification::Construct(InteractionIndex&              ArrivingLedger,
                                      RecordingSurface&              ArrivingSurface,
                                      const AppearanceSpecification& ArrivingAppearance)
{
    if (Ledger != nullptr)
    {
        return Deliver<bool>::Refuse(Refusal{ RefusalReason::ContentUnsupported,
                                              "ComponentSpecification is already constructed" });
    }

    Ledger     = &ArrivingLedger;
    Surface    = &ArrivingSurface;
    Appearance = &ArrivingAppearance;

    return Deliver<bool>::Deliver(true);
}

void ComponentSpecification::Advance(const PointerCondition& Arriving, double Elapsed)
{
    if (Ledger == nullptr)
        return;

    Arrived       = Arriving;
    DeferredCount = 0u;
    Standing      = RedrawMark::Quiet;

    Ledger->Advance(Arriving, Elapsed);

    ContactHeldByPanel = Arriving.ContactHeld && ContactHeldByPanel;
}

void ComponentSpecification::FoldMark(RedrawMark Arriving)
{
    Standing = Dearer(Standing, Arriving);
}

bool ComponentSpecification::ContactTaken() const
{
    return ContactHeldByPanel;
}

RedrawMark ComponentSpecification::StandingMark() const
{
    return Standing;
}

void ComponentSpecification::Reset()
{
    Ledger             = nullptr;
    Surface            = nullptr;
    Appearance         = nullptr;
    Arrived            = {};
    DeferredCount      = 0u;
    Standing           = RedrawMark::Quiet;
    ContactHeldByPanel = false;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                          THE CARD
//------------------------------------------------------------------------------------------------------------------------

CardArrangement ComponentSpecification::ArrangeCard(float Along, float Across, float ExtentAlong,
                                          const float* RowExtents, std::uint32_t RowCount) const
{
    CardArrangement Arranged;

    if (Appearance == nullptr)
        return Arranged;

    const ControlMetric& Measure = Appearance->ControlMeasure;

    float Interior = 0.0f;

    for (std::uint32_t Ordinal = 0u; Ordinal < RowCount; ++Ordinal)
    {
        if (RowExtents != nullptr)
            Interior += RowExtents[Ordinal];

        if (Ordinal + 1u < RowCount)
            Interior += Measure.CardRowGap;
    }

    Arranged.Enclosure = Spanning(Along, Across, ExtentAlong, Interior + Measure.CardPad * 2.0f);
    Arranged.Interior  = Spanning(Along + Measure.CardPad, Across + Measure.CardPad,
                                  ExtentAlong - Measure.CardPad * 2.0f, Interior);
    Arranged.RowGap    = Measure.CardRowGap;

    return Arranged;
}

void ComponentSpecification::RecordCard(const CardArrangement& Arranged)
{
    if (Surface == nullptr || Appearance == nullptr)
        return;

    const ControlInk&    Ink     = Appearance->Control;
    const ControlMetric& Measure = Appearance->ControlMeasure;

    Surface->Ground(Arranged.Enclosure, Ink.CardGround, Measure.CardRadius, CornerAll);
    Surface->Edge(Arranged.Enclosure, Ink.CardEdge, Measure.CardEdgeWeight, Measure.CardRadius, CornerAll);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE SELECTION FIELD
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ComponentSpecification::SelectionField(ControlIdentity Claimed, const PlaneExtent& Row,
                                            const SelectionDeclaration& Declared, std::uint32_t& TakenOrdinal)
{
    ControlVerdict Reported;

    if (Ledger == nullptr || Surface == nullptr || Appearance == nullptr || !Ledger->Resolves(Claimed))
        return Reported;

    const ControlInk&    Ink     = Appearance->Control;
    const ControlMetric& Measure = Appearance->ControlMeasure;

    // ① The row divides into a leading label and the field that fills what remains.
    const PlaneExtent Label = Spanning(Row.LeastAlong, Row.LeastAcross, Measure.LabelAlong, Row.SpanAcross());
    const float       FieldAlong = Label.MostAlong + Measure.RowGapAlong;
    const PlaneExtent Field = PlaneExtent{ FieldAlong, Row.LeastAcross, Row.MostAlong,
                                           Row.LeastAcross + Measure.FieldAcross };
    const PlaneExtent Cell  = PlaneExtent{ Field.MostAlong - Measure.ChevronCellAlong, Field.LeastAcross,
                                           Field.MostAlong, Field.MostAcross };

    // ② Arbitration. 🔴 The open menu is tested **before** the field, because it is recorded above it: a
    //    contact inside the menu's extent addresses the option under it and never the field it hangs from.
    //    Testing the field first is the defect where taking the last option instead re-toggles the menu.
    const bool OverField = Field.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);
    const bool OverCell  = Cell.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);

    const bool StoodOpen = Ledger->Disclosed(Claimed);
    const PlaneExtent Menu = StoodOpen ? MenuEnclosure(Field, Declared.OptionCount) : PlaneExtent{};
    const bool OverMenu  = StoodOpen && Menu.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);

    if (Ledger->DeclareRoused(Claimed, OverCell, RouseDuration))
        FoldMark(RedrawMark::Recolour);

    if (Arrived.ContactArrived && (OverField || OverMenu))
    {
        if (Ledger->Seize(Claimed, OverMenu  ? ControlPart::Option
                                 : OverCell  ? ControlPart::Chevron
                                             : ControlPart::Body))
            ContactHeldByPanel = true;
    }

    if (Ledger->Released(Claimed))
    {
        if (StoodOpen && OverMenu)
        {
            // ③ An option was taken. The datum is written through the caller's own reference, here, in the
            //    call that presents it — the panel never holds it between two ticks.
            const std::uint32_t Chosen = OptionUnder(Field, Declared.OptionCount);

            if (Chosen < Declared.OptionCount && Chosen != TakenOrdinal)
            {
                TakenOrdinal             = Chosen;
                Reported.OrdinateAltered = true;
            }

            Ledger->Withdraw();
            FoldMark(RedrawMark::Rearrange);
        }
        else if (OverField)
        {
            // 🔴 A tap on the field toggles the menu. Disclosing through the ledger is what closes whichever
            //    other menu stood open, so no call site has to remember to.
            if (StoodOpen)
                Ledger->Withdraw();
            else
                Ledger->Disclose(Claimed);

            FoldMark(RedrawMark::Rearrange);
        }
    }

    // 📝 A contact that arrived outside both the field and its open menu withdraws it — the dismissal every
    //    menu the sheet declares performs, and the reason the test is on arrival rather than on release.
    if (StoodOpen && Arrived.ContactArrived && !OverField && !OverMenu)
    {
        Ledger->Withdraw();
        FoldMark(RedrawMark::Rearrange);
    }

    const bool  Disclosed = Ledger->Disclosed(Claimed);
    const float Roused    = Ledger->RousedFraction(Claimed);

    // ③ The label, then the field's two grounds.
    Surface->TextRun(Label.LeastAlong, CentredAcross(Label, Measure.LabelText), Ink.LabelQuiet,
                     Declared.Caption, Measure.LabelText, 0.0f, false);

    const float Radius = Field.SpanAcross() * 0.5f;

    Surface->Ground(Field, Ink.FieldGround, Radius, CornerAll);
    Surface->Ground(Cell, Blend(Ink.CellGround, Ink.CellGroundRoused, Roused), Radius,
                    CornerTrailingUpper | CornerTrailingLower);
    Surface->Edge(Field, Ink.CardEdge, Measure.CardEdgeWeight, Radius, CornerAll);

    // ④ The taken option's caption, inside the black field.
    const char* Presented = (Declared.Options != nullptr && TakenOrdinal < Declared.OptionCount)
                          ? Declared.Options[TakenOrdinal]
                          : "";

    Surface->TextRunTruncated(Field.LeastAlong + Measure.FieldPadAlong,
                              CentredAcross(Field, Measure.RowText),
                              Cell.LeastAlong - Field.LeastAlong - Measure.FieldPadAlong * 2.0f,
                              Ink.FieldInk, Presented, Measure.RowText, false);

    // ⑤ The chevron, turned a half turn while the menu stands open. The sheet rotates it; the figure roster
    //    holds one chevron, so the turned pose is recorded as the upward figure rather than as a rotation
    //    the recording surface does not offer.
    const PlaneExtent Chevron = Spanning(Cell.LeastAlong + (Cell.SpanAlong() - Measure.ChevronSymbol) * 0.5f,
                                         Cell.LeastAcross + (Cell.SpanAcross() - Measure.ChevronSymbol) * 0.5f,
                                         Measure.ChevronSymbol, Measure.ChevronSymbol);

    Surface->Stroke(SymbolSubject::ChevronDown, Chevron, Ink.CellInk);

    // ⑥ The menu is deferred so that it records above every row beneath it.
    if (Disclosed && Declared.OptionCount > 0u && DeferredCount < DeferredCeiling)
    {
        DeferredRecording& Holding = Deferred[DeferredCount++];

        Holding.Claimed     = Claimed;
        Holding.Anchor      = Field;
        Holding.Options     = Declared.Options;
        Holding.OptionCount = Declared.OptionCount;
        Holding.TakenOption = TakenOrdinal;
        Holding.Menu        = true;
    }

    Reported.ContactTaken = Ledger->Holding(Claimed);
    Reported.Mark         = Standing;

    return Reported;
}

PlaneExtent ComponentSpecification::MenuEnclosure(const PlaneExtent& Field, std::uint32_t OptionCount) const
{
    if (Appearance == nullptr || OptionCount == 0u)
        return PlaneExtent{};

    const ControlMetric& Measure = Appearance->ControlMeasure;

    const float OptionAcross = Measure.RowText * 1.5f + Measure.OptionPadAcross * 2.0f;
    const float Interior     = OptionAcross * static_cast<float>(OptionCount)
                             + Measure.MenuGapAcross * static_cast<float>(OptionCount - 1u);

    return Spanning(Field.LeastAlong, Field.MostAcross + Measure.MenuLift,
                    Field.SpanAlong(), Interior + Measure.MenuPad * 2.0f);
}

std::uint32_t ComponentSpecification::OptionUnder(const PlaneExtent& Field, std::uint32_t OptionCount) const
{
    if (Appearance == nullptr || OptionCount == 0u)
        return OptionCount;

    const ControlMetric& Measure = Appearance->ControlMeasure;
    const PlaneExtent    Menu    = MenuEnclosure(Field, OptionCount);

    const float OptionAcross = Measure.RowText * 1.5f + Measure.OptionPadAcross * 2.0f;
    float       Cursor       = Menu.LeastAcross + Measure.MenuPad;

    for (std::uint32_t Ordinal = 0u; Ordinal < OptionCount; ++Ordinal)
    {
        const PlaneExtent Option = Spanning(Menu.LeastAlong + Measure.MenuPad, Cursor,
                                            Menu.SpanAlong() - Measure.MenuPad * 2.0f, OptionAcross);

        if (Option.Encloses(Arrived.PositionAlong, Arrived.PositionAcross))
            return Ordinal;

        Cursor += OptionAcross + Measure.MenuGapAcross;
    }

    return OptionCount;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE MAGNITUDE ROW
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ComponentSpecification::MagnitudeRow(ControlIdentity Claimed, const PlaneExtent& Row,
                                          const MagnitudeDeclaration& Declared, double& Ordinate)
{
    ControlVerdict Reported;

    if (Ledger == nullptr || Surface == nullptr || Appearance == nullptr || !Ledger->Resolves(Claimed))
        return Reported;

    const ControlInk&    Ink     = Appearance->Control;
    const ControlMetric& Measure = Appearance->ControlMeasure;

    // ① The row is a label, a readout pill, and a slider — the sheet spaces them with one gap each.
    const PlaneExtent Label   = Spanning(Row.LeastAlong, Row.LeastAcross, Measure.LabelAlong, Row.SpanAcross());
    const PlaneExtent Readout = Spanning(Label.MostAlong + Measure.RowGapAlong, Row.LeastAcross,
                                         Measure.ReadoutAlong, Measure.FieldAcross);
    const PlaneExtent UnitCell = PlaneExtent{ Readout.MostAlong - Measure.UnitCellAlong, Readout.LeastAcross,
                                              Readout.MostAlong, Readout.MostAcross };
    const PlaneExtent Track    = Spanning(Row.MostAlong - Measure.SliderAlong,
                                          Row.LeastAcross + (Row.SpanAcross() - Measure.SliderAcross) * 0.5f,
                                          Measure.SliderAlong, Measure.SliderAcross);

    // ② Arbitration. The thumb's centre may travel only between the two ends of the track's inner run, so
    //    the fraction is projected onto that inner run and never onto the track's whole extent.
    const float Radius     = Measure.ThumbExtent * 0.5f;
    const float TravelLeast = Track.LeastAlong + Radius;
    const float TravelMost  = Track.MostAlong  - Radius;
    const float TravelSpan  = (TravelMost > TravelLeast) ? (TravelMost - TravelLeast) : 0.0f;

    const bool OverTrack = Track.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);

    if (Ledger->DeclareRoused(Claimed, OverTrack, RouseDuration))
        FoldMark(RedrawMark::Recolour);

    if (Arrived.ContactArrived && OverTrack)
    {
        if (Ledger->Seize(Claimed, ControlPart::Thumb))
        {
            ContactHeldByPanel = true;
            Ledger->DepartFrom(Claimed, static_cast<float>(Ordinate));
        }
    }

    // 📐 While held, the reading is projected from the pointer's absolute abscissa against the track — not
    //    accumulated from per-tick travel, which drifts by a pixel for every tick the pointer spent outside
    //    the extent and never returns to a round figure at either end.
    if (Ledger->Holding(Claimed) && TravelSpan > 0.0f)
    {
        const double Fraction = Held((static_cast<double>(Arrived.PositionAlong) -
                                      static_cast<double>(TravelLeast)) / static_cast<double>(TravelSpan),
                                     0.0, 1.0);
        const double Projected = Declared.LeastOrdinal +
                                 Fraction * (Declared.MostOrdinal - Declared.LeastOrdinal);

        if (Projected != Ordinate)
        {
            Ordinate                 = Projected;
            Reported.OrdinateAltered = true;
            FoldMark(RedrawMark::Rerecord);
        }
    }

    const double Fraction = MagnitudeFraction(Ordinate, Declared.LeastOrdinal, Declared.MostOrdinal);

    // ③ The label.
    Surface->TextRun(Label.LeastAlong, CentredAcross(Label, Measure.LabelText), Ink.LabelQuiet,
                     Declared.Caption, Measure.LabelText, 0.0f, false);

    // ④ The readout pill — a black value cell and a raised unit cell, rounded at the ends only.
    const float PillRadius = Readout.SpanAcross() * 0.5f;

    Surface->Ground(Readout, Ink.FieldGround, PillRadius, CornerAll);
    Surface->Ground(UnitCell, Ink.CellGround, PillRadius, CornerTrailingUpper | CornerTrailingLower);
    Surface->Edge(Readout, Ink.CardEdge, Measure.CardEdgeWeight, PillRadius, CornerAll);

    char Reading[24] = {};
    IntegralRun(Reading, 24u, static_cast<long long>(Ordinate + (Ordinate < 0.0 ? -0.5 : 0.5)));

    const float ValueAlong = Readout.LeastAlong;
    const float ValueSpan  = UnitCell.LeastAlong - Readout.LeastAlong;
    const float ReadingRun = Surface->MeasureRun(Reading, Measure.ReadoutText, Measure.ReadoutTracking);

    Surface->TextRun(ValueAlong + (ValueSpan - ReadingRun) * 0.5f,
                     CentredAcross(Readout, Measure.ReadoutText),
                     Ink.FieldInk, Reading, Measure.ReadoutText, Measure.ReadoutTracking, true);

    const float UnitRun = Surface->MeasureRun(Declared.UnitGlyph, Measure.UnitText, 0.0f);

    Surface->TextRun(UnitCell.LeastAlong + (UnitCell.SpanAlong() - UnitRun) * 0.5f,
                     CentredAcross(UnitCell, Measure.UnitText),
                     Ink.UnitInk, Declared.UnitGlyph, Measure.UnitText, 0.0f, false);

    // ⑤ The track — taken below the fraction, quiet above it, and the thumb centred on the division.
    const float TrackRadius = Track.SpanAcross() * 0.5f;
    const float Division    = TravelLeast + TravelSpan * static_cast<float>(Fraction);

    Surface->Ground(Track, Ink.TrackQuiet, TrackRadius, CornerAll);

    if (Division > Track.LeastAlong)
    {
        const PlaneExtent Taken = PlaneExtent{ Track.LeastAlong, Track.LeastAcross,
                                               Division, Track.MostAcross };
        Surface->Ground(Taken, Ink.TrackTaken, TrackRadius, CornerLeadingUpper | CornerLeadingLower);
    }

    Surface->Edge(Track, Ink.TrackEdge, Measure.CardEdgeWeight, TrackRadius, CornerAll);
    Surface->Medallion(Division, Track.LeastAcross + Track.SpanAcross() * 0.5f, Radius, Ink.ThumbGround);

    Reported.ContactTaken = Ledger->Holding(Claimed);
    Reported.Mark         = Standing;

    return Reported;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE ROTATION RULER
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ComponentSpecification::RotationRuler(ControlIdentity Claimed, const PlaneExtent& Row,
                                           const RulerDeclaration& Declared, double& Degrees)
{
    ControlVerdict Reported;

    if (Ledger == nullptr || Surface == nullptr || Appearance == nullptr || !Ledger->Resolves(Claimed))
        return Reported;

    const ControlInk&    Ink     = Appearance->Control;
    const ControlMetric& Measure = Appearance->ControlMeasure;

    // ① The ruler stacks: a label and readout above, the tick strip beneath them.
    const PlaneExtent Head    = Spanning(Row.LeastAlong, Row.LeastAcross, Row.SpanAlong(), Measure.FieldAcross);
    const PlaneExtent Label   = Spanning(Head.LeastAlong, Head.LeastAcross, Measure.LabelAlong, Head.SpanAcross());
    const PlaneExtent Readout = Spanning(Head.MostAlong - Measure.ReadoutAlong, Head.LeastAcross,
                                         Measure.ReadoutAlong, Measure.FieldAcross);
    const PlaneExtent UnitCell = PlaneExtent{ Readout.MostAlong - Measure.UnitCellAlong, Readout.LeastAcross,
                                              Readout.MostAlong, Readout.MostAcross };
    const PlaneExtent Strip   = Spanning(Row.LeastAlong, Head.MostAcross + Measure.CardRowGap * 0.5f,
                                         Row.SpanAlong(), Measure.RulerAcross);

    // ② Arbitration. The reading departs from where it stood when the contact arrived, so a drag that
    //    leaves and re-enters the strip resumes from the same origin rather than jumping.
    const bool OverStrip = Strip.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);

    if (Arrived.ContactArrived && OverStrip)
    {
        if (Ledger->Seize(Claimed, ControlPart::Strip))
        {
            ContactHeldByPanel = true;
            Ledger->DepartFrom(Claimed, static_cast<float>(Degrees));
        }
    }

    if (Ledger->Holding(Claimed) && Ledger->HeldPart(Claimed) == ControlPart::Strip)
    {
        const Deliver<float> Departed = Ledger->DepartedOrdinate(Claimed);

        if (Departed.ContentPresent)
        {
            const double Travel   = static_cast<double>(Arrived.PositionAlong) -
                                    static_cast<double>(Ledger->OriginAlong());
            const double Turned   = RotationDegrees(static_cast<double>(Departed.Resolve()), Travel,
                                                    static_cast<double>(Measure.RulerDegreesPerPixel));

            if (Turned != Degrees)
            {
                Degrees                  = Turned;
                Reported.OrdinateAltered = true;
                FoldMark(RedrawMark::Rerecord);
            }
        }
    }

    // ③ The label and the readout pill.
    Surface->TextRun(Label.LeastAlong, CentredAcross(Label, Measure.LabelText), Ink.LabelQuiet,
                     Declared.Caption, Measure.LabelText, 0.0f, false);

    const float PillRadius = Readout.SpanAcross() * 0.5f;

    Surface->Ground(Readout, Ink.FieldGround, PillRadius, CornerAll);
    Surface->Ground(UnitCell, Ink.CellGround, PillRadius, CornerTrailingUpper | CornerTrailingLower);
    Surface->Edge(Readout, Ink.CardEdge, Measure.CardEdgeWeight, PillRadius, CornerAll);

    const long long Rounded = static_cast<long long>(Degrees + (Degrees < 0.0 ? -0.5 : 0.5));

    char Reading[24] = {};
    IntegralRun(Reading, 24u, Rounded);

    const float ValueSpan  = UnitCell.LeastAlong - Readout.LeastAlong;
    const float ReadingRun = Surface->MeasureRun(Reading, Measure.ReadoutText, Measure.ReadoutTracking);

    Surface->TextRun(Readout.LeastAlong + (ValueSpan - ReadingRun) * 0.5f,
                     CentredAcross(Readout, Measure.ReadoutText),
                     Ink.FieldInk, Reading, Measure.ReadoutText, Measure.ReadoutTracking, true);

    const float UnitRun = Surface->MeasureRun(Declared.UnitGlyph, Measure.UnitText, 0.0f);

    Surface->TextRun(UnitCell.LeastAlong + (UnitCell.SpanAlong() - UnitRun) * 0.5f,
                     CentredAcross(UnitCell, Measure.UnitText),
                     Ink.UnitInk, Declared.UnitGlyph, Measure.UnitText, 0.0f, false);

    // ④ The strip's ground, and every tick inside it, confined so nothing escapes the rounded extent.
    Surface->Ground(Strip, Ink.RulerGround, Measure.RulerRadius, CornerAll);
    Surface->Edge(Strip, Ink.CardEdge, Measure.CardEdgeWeight, Measure.RulerRadius, CornerAll);
    Surface->Confine(Strip);

    const float CentreAlong  = Strip.LeastAlong + Strip.SpanAlong() * 0.5f;
    const float CentreAcross = Strip.LeastAcross + Strip.SpanAcross() * 0.5f;
    const long long Centred  = Rounded;

    for (long long Tick = Centred - static_cast<long long>(Measure.TickReach);
         Tick <= Centred + static_cast<long long>(Measure.TickReach); ++Tick)
    {
        // 📐 The sheet places tick i at `i * TICK_SPACING` and then translates the whole strip by
        //    `-rotationValue * TICK_SPACING`. The two compose to this, which is what keeps the strip
        //    continuous while the reading is fractional.
        const float TickAlong = CentreAlong +
                                (static_cast<float>(Tick) - static_cast<float>(Degrees)) * Measure.TickSpacing;

        if (TickAlong < Strip.LeastAlong - Measure.TickWeight ||
            TickAlong > Strip.MostAlong  + Measure.TickWeight)
            continue;

        const long long Absolute = (Tick < 0) ? -Tick : Tick;
        const bool      Major    = (Absolute % 10) == 0;
        const bool      Medium   = !Major && (Absolute % 5) == 0;

        const float       TickAcross = Major ? Measure.TickMajorAcross
                                     : Medium ? Measure.TickMediumAcross
                                              : Measure.TickMinorAcross;
        const InkOrdinate TickInk    = Major ? Ink.TickMajor : Medium ? Ink.TickMedium : Ink.TickMinor;

        const PlaneExtent Mark = Spanning(TickAlong - Measure.TickWeight * 0.5f,
                                          CentreAcross - TickAcross * 0.5f,
                                          Measure.TickWeight, TickAcross);

        Surface->Ground(Mark, TickInk, Measure.TickWeight * 0.5f, CornerAll);

        if (!Major)
            continue;

        char Caption[24] = {};
        IntegralRun(Caption, 22u, Tick);

        // 📝 The degree sign is appended as its own two UTF-8 octets rather than spelled in the literal, so
        //    the run stays ASCII-safe at every call site that measures it.
        std::uint32_t Written = 0u;
        while (Caption[Written] != '\0' && Written < 20u) ++Written;
        Caption[Written++] = '\xC2';
        Caption[Written++] = '\xB0';
        Caption[Written]   = '\0';

        const float CaptionRun = Surface->MeasureRun(Caption, Measure.TickCaptionText, 0.0f);

        Surface->TextRun(TickAlong - CaptionRun * 0.5f, CentreAcross + Measure.TickCaptionLift,
                         Ink.TickCaption, Caption, Measure.TickCaptionText, 0.0f, true);
    }

    // ⑤ The sheet's mask — transparent, opaque at a fifth, opaque to four fifths, transparent. Two Along
    //    scrims over the ruler's own ground reproduce it; the middle three fifths need nothing recorded.
    const InkOrdinate Opaque      = Ink.CardGround;
    const InkOrdinate Transparent = Faded(Ink.CardGround, 0.0f);
    const float       FadeAlong   = Strip.SpanAlong() * 0.2f;

    Surface->Scrim(PlaneExtent{ Strip.LeastAlong, Strip.LeastAcross,
                                Strip.LeastAlong + FadeAlong, Strip.MostAcross },
                   Opaque, Transparent, ScrimAxis::Along);

    Surface->Scrim(PlaneExtent{ Strip.MostAlong - FadeAlong, Strip.LeastAcross,
                                Strip.MostAlong, Strip.MostAcross },
                   Transparent, Opaque, ScrimAxis::Along);

    // ⑥ The fixed centre pointer, recorded last so the fade never touches it.
    const PlaneExtent Pointer = Spanning(CentreAlong - Measure.PointerWeight * 0.5f,
                                         CentreAcross - Measure.PointerAcross * 0.5f,
                                         Measure.PointerWeight, Measure.PointerAcross);

    Surface->Ground(Pointer, Ink.RulerPointer, Measure.PointerWeight * 0.5f, CornerAll);
    Surface->Medallion(CentreAlong, Strip.LeastAcross + Measure.PointerDotLift,
                       Measure.PointerDot * 0.5f, Ink.RulerPointer);

    Surface->Release();

    Reported.ContactTaken = Ledger->Holding(Claimed);
    Reported.Mark         = Standing;

    return Reported;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE TOGGLE ROW
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ComponentSpecification::ToggleRow(ControlIdentity Claimed, const PlaneExtent& Row,
                                       const ToggleDeclaration& Declared, bool& Taken)
{
    ControlVerdict Reported;

    if (Ledger == nullptr || Surface == nullptr || Appearance == nullptr || !Ledger->Resolves(Claimed))
        return Reported;

    const ControlInk&    Ink     = Appearance->Control;
    const ControlMetric& Measure = Appearance->ControlMeasure;

    const bool OverRow = Row.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);

    if (Ledger->DeclareRoused(Claimed, OverRow, RouseDuration))
        FoldMark(RedrawMark::Recolour);

    if (Arrived.ContactArrived && OverRow)
    {
        if (Ledger->Seize(Claimed, ControlPart::Body))
            ContactHeldByPanel = true;
    }

    if (Ledger->Released(Claimed) && OverRow)
    {
        Taken                    = !Taken;
        Reported.OrdinateAltered = true;
        FoldMark(RedrawMark::Rerecord);
    }

    if (Ledger->DeclareTaken(Claimed, Taken, RouseDuration))
        FoldMark(RedrawMark::Recolour);

    const float Roused = Ledger->RousedFraction(Claimed);
    const float Held   = Ledger->TakenFraction(Claimed);

    // ① The ring — quiet, roused, or taken. The sheet fades the border colour and scales the dot.
    const PlaneExtent Ring = Spanning(Row.LeastAlong + Measure.ToggleRowPadAlong,
                                      Row.LeastAcross + (Row.SpanAcross() - Measure.RingExtent) * 0.5f,
                                      Measure.RingExtent, Measure.RingExtent);

    const InkOrdinate Quiet   = Blend(Ink.RingQuiet, Ink.RingRoused, Roused);
    const InkOrdinate RingInk = Blend(Quiet, Ink.RingTaken, Held);

    Surface->Edge(Ring, RingInk, Measure.RingWeight, Measure.RingExtent * 0.5f, CornerAll);

    // ② The dot scales from nothing to its full extent, which is what `scale-0` to `scale-100` states.
    const float DotRadius = Measure.RingDotExtent * 0.5f * Held;

    if (DotRadius > 0.0f)
    {
        Surface->Medallion(Ring.LeastAlong + Ring.SpanAlong() * 0.5f,
                           Ring.LeastAcross + Ring.SpanAcross() * 0.5f,
                           DotRadius, Ink.RingDot);
    }

    // ③ The label, fading between its three declared inks.
    const InkOrdinate QuietLabel = Blend(Ink.LabelQuiet, Ink.LabelRoused, Roused);
    const InkOrdinate LabelInk   = Blend(QuietLabel, Ink.LabelTaken, Held);

    Surface->TextRun(Ring.MostAlong + Measure.ToggleGapAlong, CentredAcross(Row, Measure.RowText),
                     LabelInk, Declared.Caption, Measure.RowText, 0.0f, false);

    Reported.ContactTaken = Ledger->Holding(Claimed);
    Reported.Mark         = Standing;

    return Reported;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE MULTI-SELECT ROW
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ComponentSpecification::SubsetRow(ControlIdentity Claimed, const PlaneExtent& Row,
                                       const SubsetDeclaration& Declared, bool& Enrolled)
{
    ControlVerdict Reported;

    if (Ledger == nullptr || Surface == nullptr || Appearance == nullptr || !Ledger->Resolves(Claimed))
        return Reported;

    const ControlInk&    Ink     = Appearance->Control;
    const ControlMetric& Measure = Appearance->ControlMeasure;

    const bool OverRow = Row.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);

    if (Ledger->DeclareRoused(Claimed, OverRow, RouseDuration))
        FoldMark(RedrawMark::Recolour);

    if (Arrived.ContactArrived && OverRow)
    {
        if (Ledger->Seize(Claimed, ControlPart::Body))
            ContactHeldByPanel = true;
    }

    if (Ledger->Released(Claimed) && OverRow)
    {
        Enrolled                 = !Enrolled;
        Reported.OrdinateAltered = true;
        FoldMark(RedrawMark::Rerecord);
    }

    if (Ledger->DeclareTaken(Claimed, Enrolled, RouseDuration))
        FoldMark(RedrawMark::Recolour);

    const float Roused = Ledger->RousedFraction(Claimed);
    const float Held   = Ledger->TakenFraction(Claimed);

    // ① The ground. The sheet gives a quiet row no ground at all, a roused one #222222, and a taken one
    //    #2a2a2a — and the taken ground wins over the roused one, which is why it is blended last.
    const InkOrdinate QuietGround = Blend(Ink.RowGroundQuiet, Ink.RowGroundRoused, Roused);
    const InkOrdinate RowGround   = Blend(QuietGround, Ink.RowGroundTaken, Held);

    // 🔴 Square corners. The sheet states `rounded-none` on this row and rounds every other control; a
    //    radius here would be the one place the transcription quietly improved on the source.
    Surface->Ground(Row, RowGround, 0.0f, CornerNone);

    // ② The rail, which the sheet grows from nothing along the row's whole extent across.
    const PlaneExtent Rail = Spanning(Row.LeastAlong, Row.LeastAcross, Measure.SubsetRailAlong, Row.SpanAcross());

    Surface->Ground(Rail, Blend(Ink.RowRailQuiet, Ink.RowRailTaken, Held), 0.0f, CornerNone);

    // ③ The label.
    const InkOrdinate LabelInk = Blend(Ink.LabelQuiet, Ink.LabelTaken, Held);

    Surface->TextRun(Row.LeastAlong + Measure.SubsetRowPadAlong, CentredAcross(Row, Measure.RowText),
                     LabelInk, Declared.Caption, Measure.RowText, 0.0f, false);

    Reported.ContactTaken = Ledger->Holding(Claimed);
    Reported.Mark         = Standing;

    return Reported;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE MAGNITUDE STOPS
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ComponentSpecification::MagnitudeStops(ControlIdentity Claimed, const PlaneExtent& Row,
                                            const StopDeclaration& Declared, std::uint32_t& TakenOrdinal)
{
    ControlVerdict Reported;

    if (Ledger == nullptr || Surface == nullptr || Appearance == nullptr || !Ledger->Resolves(Claimed))
        return Reported;

    if (Declared.StopCount < 2u || Declared.StopCount > StopCeiling || Declared.Stops == nullptr)
        return Reported;

    const ControlInk&    Ink     = Appearance->Control;
    const ControlMetric& Measure = Appearance->ControlMeasure;

    const PlaneExtent Label = Spanning(Row.LeastAlong, Row.LeastAcross, Measure.LabelAlong, Row.SpanAcross());
    const float       StripLeast = Label.MostAlong + Measure.RowGapAlong + Measure.StopStripPadLeading;
    const float       StripMost  = Row.MostAlong - Measure.StopStripPadTrailing;
    const float       StripSpan  = (StripMost > StripLeast) ? (StripMost - StripLeast) : 0.0f;
    const float       CentreAcross = Row.LeastAcross + Row.SpanAcross() * 0.5f;

    // 📐 The sheet spaces its stops with `justify-between`, which places the first and the last against the
    //    two ends and divides the remainder evenly. With one stop there is no remainder to divide, which is
    //    why the declaration refuses a count below two rather than dividing by zero here.
    const float Division = StripSpan / static_cast<float>(Declared.StopCount - 1u);

    Surface->TextRun(Label.LeastAlong, CentredAcross(Label, Measure.LabelText), Ink.LabelQuiet,
                     Declared.Caption, Measure.LabelText, 0.0f, false);

    std::uint32_t RousedOrdinal = Declared.StopCount;

    for (std::uint32_t Ordinal = 0u; Ordinal < Declared.StopCount; ++Ordinal)
    {
        const float  StopAlong = StripLeast + Division * static_cast<float>(Ordinal);
        const bool   TakenStop = Ordinal == TakenOrdinal;
        const float  Extent    = TakenStop ? Measure.StopTakenExtent : Measure.StopQuietExtent;
        const float  Reach     = Extent * 0.5f;

        const PlaneExtent Stop = Spanning(StopAlong - Reach, CentreAcross - Reach, Extent, Extent);

        if (Stop.Encloses(Arrived.PositionAlong, Arrived.PositionAcross))
            RousedOrdinal = Ordinal;
    }

    // ① One rouse fade serves the whole strip, because the sheet roues exactly one stop at a time.
    if (Ledger->DeclareRoused(Claimed, RousedOrdinal < Declared.StopCount, RouseDuration))
        FoldMark(RedrawMark::Recolour);

    if (Arrived.ContactArrived && RousedOrdinal < Declared.StopCount)
    {
        if (Ledger->Seize(Claimed, ControlPart::Body))
            ContactHeldByPanel = true;
    }

    if (Ledger->Released(Claimed) && RousedOrdinal < Declared.StopCount && RousedOrdinal != TakenOrdinal)
    {
        TakenOrdinal             = RousedOrdinal;
        Reported.OrdinateAltered = true;
        FoldMark(RedrawMark::Rearrange);
    }

    const float Roused = Ledger->RousedFraction(Claimed);

    // ② Every stop, the taken one grown and carrying its letter.
    for (std::uint32_t Ordinal = 0u; Ordinal < Declared.StopCount; ++Ordinal)
    {
        const float StopAlong = StripLeast + Division * static_cast<float>(Ordinal);
        const bool  TakenStop = Ordinal == TakenOrdinal;
        const float Extent    = TakenStop ? Measure.StopTakenExtent : Measure.StopQuietExtent;

        const InkOrdinate Quiet = (Ordinal == RousedOrdinal) ? Blend(Ink.StopQuiet, Ink.StopRoused, Roused)
                                                             : Ink.StopQuiet;
        const InkOrdinate StopInk = TakenStop ? Ink.StopTaken : Quiet;

        Surface->Medallion(StopAlong, CentreAcross, Extent * 0.5f, StopInk);

        if (!TakenStop)
            continue;

        const char* Letter = Declared.Stops[Ordinal];

        if (Letter == nullptr || Letter[0] == '\0')
            continue;

        const float LetterRun = Surface->MeasureRun(Letter, Measure.RowText, 0.0f);

        Surface->TextRun(StopAlong - LetterRun * 0.5f, CentreAcross - Measure.RowText * 0.5f,
                         Ink.StopTakenInk, Letter, Measure.RowText, 0.0f, true);
    }

    Reported.ContactTaken = Ledger->Holding(Claimed);
    Reported.Mark         = Standing;

    return Reported;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE TOOLTIP TRIGGER
//------------------------------------------------------------------------------------------------------------------------

ControlVerdict ComponentSpecification::TooltipTrigger(ControlIdentity Claimed, const PlaneExtent& Trigger,
                                            const TooltipDeclaration& Declared)
{
    ControlVerdict Reported;

    if (Ledger == nullptr || Surface == nullptr || Appearance == nullptr || !Ledger->Resolves(Claimed))
        return Reported;

    const ControlInk&    Ink     = Appearance->Control;
    const ControlMetric& Measure = Appearance->ControlMeasure;

    const bool Light   = Declared.Appearance == TooltipAppearance::Light;
    const bool OverIt  = Trigger.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);

    // 📝 The card is disclosed by rest rather than by tap — `group-hover` — so this is the one control that
    //    declares its take fade from the pointer's presence and never from a release.
    if (Ledger->DeclareRoused(Claimed, OverIt, RouseDuration))
        FoldMark(RedrawMark::Recolour);

    if (Ledger->DeclareTaken(Claimed, OverIt, TooltipDuration))
        FoldMark(RedrawMark::Recolour);

    if (Arrived.ContactArrived && OverIt)
    {
        if (Ledger->Seize(Claimed, ControlPart::Body))
            ContactHeldByPanel = true;
    }

    const float Roused    = Ledger->RousedFraction(Claimed);
    const float Disclosed = Ledger->TakenFraction(Claimed);
    const bool  Seized    = Ledger->Holding(Claimed);

    // ① The sheet scales the trigger to 1.05 on hover and 0.95 while it is held. Both are recorded as an
    //    inset of the declared extent, because the recording surface places extents and does not transform.
    const float Scaled  = Seized ? 0.95f : Between(1.0f, 1.05f, Roused);
    const float Inset   = Trigger.SpanAlong() * (1.0f - Scaled) * 0.5f;

    const PlaneExtent Grown = PlaneExtent{ Trigger.LeastAlong  + Inset, Trigger.LeastAcross + Inset,
                                           Trigger.MostAlong   - Inset, Trigger.MostAcross  - Inset };

    Surface->Ground(Grown, Light ? Ink.TriggerLightGround : Ink.TriggerDarkGround,
                    Measure.TriggerRadius, CornerAll);

    const PlaneExtent Figure = Spanning(Grown.LeastAlong + (Grown.SpanAlong() - Measure.TriggerSymbol) * 0.5f,
                                        Grown.LeastAcross + (Grown.SpanAcross() - Measure.TriggerSymbol) * 0.5f,
                                        Measure.TriggerSymbol, Measure.TriggerSymbol);

    Surface->Stroke(Declared.Figure, Figure, Light ? Ink.TriggerLightInk : Ink.TriggerDarkInk);

    // ② The card is deferred while any of it is visible, so it records above every later control.
    if (Disclosed > 0.0f && DeferredCount < DeferredCeiling)
    {
        DeferredRecording& Holding = Deferred[DeferredCount++];

        Holding.Claimed    = Claimed;
        Holding.Anchor     = Trigger;
        Holding.Title      = Declared.Title;
        Holding.Body       = Declared.Body;
        Holding.Appearance = Declared.Appearance;
        Holding.Menu       = false;
    }

    Reported.ContactTaken = Seized;
    Reported.Mark         = Standing;

    return Reported;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   THE DEFERRED SWEEP
//------------------------------------------------------------------------------------------------------------------------

void ComponentSpecification::RecordMenu(const DeferredRecording& Holding)
{
    const ControlInk&    Ink     = Appearance->Control;
    const ControlMetric& Measure = Appearance->ControlMeasure;

    const PlaneExtent Menu = MenuEnclosure(Holding.Anchor, Holding.OptionCount);

    Surface->Ground(Menu, Ink.MenuGround, Measure.MenuRadius, CornerAll);
    Surface->Edge(Menu, Ink.MenuEdge, Measure.CardEdgeWeight, Measure.MenuRadius, CornerAll);

    const float OptionAcross = Measure.RowText * 1.5f + Measure.OptionPadAcross * 2.0f;
    float       Cursor       = Menu.LeastAcross + Measure.MenuPad;

    for (std::uint32_t Ordinal = 0u; Ordinal < Holding.OptionCount; ++Ordinal)
    {
        const PlaneExtent Option = Spanning(Menu.LeastAlong + Measure.MenuPad, Cursor,
                                            Menu.SpanAlong() - Measure.MenuPad * 2.0f, OptionAcross);

        const bool Over = Option.Encloses(Arrived.PositionAlong, Arrived.PositionAcross);

        // 📝 The option's rouse is read from the pointer directly rather than from an enrolled fade. Every
        //    option would otherwise need its own identity, and the sheet fades an option in 150 ms — below
        //    the threshold at which the absence of a fade reads as a defect rather than as immediacy.
        if (Over)
        {
            Surface->Ground(Option, Ink.OptionGroundRoused, Option.SpanAcross() * 0.5f, CornerAll);
        }

        const char* Caption = (Holding.Options != nullptr) ? Holding.Options[Ordinal] : "";
        const bool  Taken   = Ordinal == Holding.TakenOption;

        Surface->TextRunTruncated(Option.LeastAlong + Measure.OptionPadAlong,
                                  CentredAcross(Option, Measure.RowText),
                                  Option.SpanAlong() - Measure.OptionPadAlong * 2.0f,
                                  (Over || Taken) ? Ink.OptionInkRoused : Ink.OptionInk,
                                  Caption, Measure.RowText, false);

        Cursor += OptionAcross + Measure.MenuGapAcross;
    }
}

void ComponentSpecification::RecordTooltip(const DeferredRecording& Holding)
{
    const ControlInk&    Ink     = Appearance->Control;
    const ControlMetric& Measure = Appearance->ControlMeasure;

    const float Disclosed = Ledger->TakenFraction(Holding.Claimed);

    if (Disclosed <= 0.0f)
        return;

    const bool Light = Holding.Appearance == TooltipAppearance::Light;

    const InkOrdinate Ground = Faded(Light ? Ink.TooltipLightGround : Ink.TooltipDarkGround, Disclosed);
    const InkOrdinate Title  = Faded(Light ? Ink.TooltipLightTitle  : Ink.TooltipDarkTitle,  Disclosed);
    const InkOrdinate Body   = Faded(Light ? Ink.TooltipLightBody   : Ink.TooltipDarkBody,   Disclosed);

    // ① The body is wrapped first, because the card's extent across follows from how many lines it took.
    const float Interior = Measure.TooltipAlong - Measure.TooltipPad * 2.0f;

    const char*   LineFirst[WrapCeiling] = {};
    std::uint32_t LineExtent[WrapCeiling] = {};
    std::uint32_t Lines = 0u;

    const char* Sweeping = (Holding.Body != nullptr) ? Holding.Body : "";

    while (*Sweeping != '\0' && Lines < WrapCeiling)
    {
        const char*   LineStart = Sweeping;
        const char*   LastBreak = nullptr;
        std::uint32_t Taken     = 0u;

        while (Sweeping[Taken] != '\0')
        {
            if (Sweeping[Taken] == ' ')
            {
                char          Probe[256] = {};
                std::uint32_t Copied     = (Taken < 255u) ? Taken : 255u;

                for (std::uint32_t Ordinal = 0u; Ordinal < Copied; ++Ordinal)
                    Probe[Ordinal] = LineStart[Ordinal];

                Probe[Copied] = '\0';

                if (Surface->MeasureRun(Probe, Measure.TooltipBodyText, 0.0f) > Interior)
                    break;

                LastBreak = Sweeping + Taken;
            }

            ++Taken;
        }

        const char* Breaking = (LastBreak != nullptr && Sweeping[Taken] != '\0') ? LastBreak
                                                                                 : Sweeping + Taken;

        LineFirst[Lines]  = LineStart;
        LineExtent[Lines] = static_cast<std::uint32_t>(Breaking - LineStart);
        ++Lines;

        Sweeping = (*Breaking == ' ') ? Breaking + 1 : Breaking;
    }

    const float BodyAcross  = Measure.TooltipBodyLeading * static_cast<float>(Lines);
    const float CardAcross  = Measure.TooltipPad * 2.0f + Measure.TooltipTitleText * 1.5f
                            + Measure.TooltipTitleGap + BodyAcross;

    // ② The card hangs above its trigger by the declared lift, aligned to the trigger's leading edge.
    const PlaneExtent Card = Spanning(Holding.Anchor.LeastAlong,
                                      Holding.Anchor.LeastAcross - Measure.TooltipLift - CardAcross,
                                      Measure.TooltipAlong, CardAcross);

    Surface->Ground(Card, Ground, Measure.TooltipRadius, CornerAll);

    // ③ The arrow — a square turned a quarter turn, tucked under the card's lower edge. Recorded as four
    //    corners rather than as a rotated ground, because the recording surface places extents and the
    //    sheet's own arrow is a rotated div whose rounded corners are hidden behind the card regardless.
    const float ArrowReach  = Measure.TooltipArrowExtent * 0.5f;
    const float ArrowCentre = Card.LeastAlong + Measure.TooltipArrowAlong;
    const float ArrowAcross = Card.MostAcross - Measure.TooltipArrowSink;

    const float Corners[8] = { ArrowCentre,              ArrowAcross - ArrowReach,
                               ArrowCentre + ArrowReach, ArrowAcross,
                               ArrowCentre,              ArrowAcross + ArrowReach,
                               ArrowCentre - ArrowReach, ArrowAcross };

    Surface->Tongue(Corners, 4u, Ground);

    // ④ The title, then every wrapped line of the body.
    Surface->TextRun(Card.LeastAlong + Measure.TooltipPad, Card.LeastAcross + Measure.TooltipPad,
                     Title, Holding.Title, Measure.TooltipTitleText, 0.0f, true);

    float Cursor = Card.LeastAcross + Measure.TooltipPad + Measure.TooltipTitleText * 1.5f
                 + Measure.TooltipTitleGap;

    for (std::uint32_t Ordinal = 0u; Ordinal < Lines; ++Ordinal)
    {
        char          Staging[256] = {};
        std::uint32_t Copied       = (LineExtent[Ordinal] < 255u) ? LineExtent[Ordinal] : 255u;

        for (std::uint32_t Glyph = 0u; Glyph < Copied; ++Glyph)
            Staging[Glyph] = LineFirst[Ordinal][Glyph];

        Staging[Copied] = '\0';

        Surface->TextRun(Card.LeastAlong + Measure.TooltipPad, Cursor, Body,
                         Staging, Measure.TooltipBodyText, 0.0f, false);

        Cursor += Measure.TooltipBodyLeading;
    }
}

void ComponentSpecification::RecordDeferred()
{
    if (Surface == nullptr || Appearance == nullptr || Ledger == nullptr)
        return;

    for (std::uint32_t Ordinal = 0u; Ordinal < DeferredCount; ++Ordinal)
    {
        const DeferredRecording& Holding = Deferred[Ordinal];

        if (Holding.Menu)
            RecordMenu(Holding);
        else
            RecordTooltip(Holding);
    }

    DeferredCount = 0u;
}

}   // namespace Slate
