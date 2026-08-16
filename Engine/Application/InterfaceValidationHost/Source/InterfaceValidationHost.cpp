//============================================================================================================================================
//                                                     INTERFACEVALIDATIONHOST.CPP
//============================================================================================================================================
// 🧩 Records `References/Controls.html` literally, so every declared control can be compared against the sheet.

#include "Contract/DeliveryContract.h"
#include "SlateMath/Platform/TickSequence/Api/TickSequence.h"
#include "SlateMath/Platform/WindowInterchange/Api/WindowInterchange.h"
#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"
#include "SlateUI/Interface/ControlPanel/Api/ControlPanel.h"
#include "SlateUI/Interface/InteractionIndex/Api/InteractionIndex.h"
#include "SlateUI/Interface/InterfaceExchange/Api/InterfaceExchange.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"
#include "SlateUI/Interface/MotionIntegrator/Api/MotionIntegrator.h"
#include "SlateVulkan/Device/CommandSequence/Api/CommandSequence.h"
#include "SlateVulkan/Device/CycleScheduler/Api/CycleScheduler.h"
#include "SlateVulkan/Device/DiagnosticExtension/Api/DiagnosticExtension.h"
#include "SlateVulkan/Device/DisplayScheduler/Api/DisplayScheduler.h"
#include "SlateVulkan/Device/VendorClassifier/Api/VendorClassifier.h"
#include "SlateVulkan/Device/VulkanExchange/Api/VulkanExchange.h"
#include "SlateVulkan/Device/WindowExchange/Api/WindowExchange.h"

#include <cstdio>

//------------------------------------------------------------------------------------------------------------------------
//                                                          FIGURES
//------------------------------------------------------------------------------------------------------------------------

namespace
{

using namespace Slate;

constexpr std::uint32_t InitialWidth  = 1280u;   // [px]
constexpr std::uint32_t InitialHeight = 900u;    // [px] - the sheet's six cards do not fit in 720

constexpr const char* WindowTitle = "Slate \u2014 Interface Validation";
constexpr const char* HostName    = "InterfaceValidationHost";

// 📐 🔴 The sheet declares `scale-110` on its own column. That is a property of the reference page and not of
//    the controls, so it is **not** folded into AuthoredReduction — it arrives here, as the artist scale, which
//    is exactly the seam a real application would expose to its own preference.
constexpr double SheetColumnScale = 1.10;   // [-] - scale-110

//------------------------------------------------------------------------------------------------------------------------
//                                                    WHAT THE SHEET SEATS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every datum the sheet presents, seated at the value the sheet itself states.
/// note  🔴 The host owns these and the panel does not. `14` §1's gate is visible here as an ordinary struct:
///       every control below is handed a reference into this record and writes through it.
struct ValidationOrdinates
{
    std::uint32_t  SelectionTaken = 0u;      // [-]   - "Entry name"
    double         Degree         = 123.0;   // [deg] - value="123"
    double         Percent        =  85.0;   // [%]   - value="85"
    double         Pixel          = 123.0;   // [px]  - value="123"
    double         Rotation       =   0.0;   // [deg] - rotationValue = 0
    bool           Snapping       = true;    // [-]   - data-checked="true"
    bool           GridLines      = false;   // [-]
    bool           AspectLocked   = false;   // [-]
    bool           EntryOne       = true;    // [-]   - data-checked="true"
    bool           EntryTwo       = false;   // [-]
    bool           EntryThree     = true;    // [-]   - data-checked="true"
    bool           EntryFour      = false;   // [-]
    std::uint32_t  SizeTaken      = 2u;      // [-]   - the taken stop is L
};

/// 🧩 Every identity the sheet's controls are enrolled under, claimed once at bring-up.
struct ValidationIdentities
{
    ControlIdentity  Selection    = {};
    ControlIdentity  Degree       = {};
    ControlIdentity  Percent      = {};
    ControlIdentity  Pixel        = {};
    ControlIdentity  Rotation     = {};
    ControlIdentity  Snapping     = {};
    ControlIdentity  GridLines    = {};
    ControlIdentity  AspectLocked = {};
    ControlIdentity  EntryOne     = {};
    ControlIdentity  EntryTwo     = {};
    ControlIdentity  EntryThree   = {};
    ControlIdentity  EntryFour    = {};
    ControlIdentity  Size         = {};
    ControlIdentity  TooltipLight = {};
    ControlIdentity  TooltipDark  = {};
};

/// 🧩 Claims every identity the sheet needs, refusing in full rather than in part.
/// out   Deliver  [-]  refuses with ExtentExhausted when the ledger declines any one of the fifteen
/// note  🔴 A partial enrolment would leave one control reading another's fade, which draws correctly on the
///       first tick and diverges on the second — the hardest possible shape of defect to attribute.
Deliver<ValidationIdentities> EnrolEvery(InteractionIndex& Ledger)
{
    ValidationIdentities  Claimed;
    ControlIdentity*      Every[] = {
        &Claimed.Selection, &Claimed.Degree,     &Claimed.Percent,    &Claimed.Pixel,
        &Claimed.Rotation,  &Claimed.Snapping,   &Claimed.GridLines,  &Claimed.AspectLocked,
        &Claimed.EntryOne,  &Claimed.EntryTwo,   &Claimed.EntryThree, &Claimed.EntryFour,
        &Claimed.Size,      &Claimed.TooltipLight, &Claimed.TooltipDark
    };

    for (ControlIdentity* Claiming : Every)
    {
        const Deliver<ControlIdentity> Issued = Ledger.Enrol();

        if (!Issued.ContentPresent)
        {
            return Deliver<ValidationIdentities>::Refuse(Issued.Declined);
        }

        *Claiming = Issued.Resolve();
    }

    return Deliver<ValidationIdentities>::Deliver(Claimed);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     THE MEASURE OVERLAY
//------------------------------------------------------------------------------------------------------------------------

#ifdef SLATE_DEBUG

/// 🧩 One control's recorded extent, retained for the overlay to stroke over it.
/// note  🔍 Debug only. Nothing in a shipped build enrols, retains or records any of this.
struct MeasuredExtent
{
    const char*  Naming  = "";   // [-] - static text; never allocated
    PlaneExtent  Where   = {};   // [px] - what the control was handed
    float        Claimed = 0.0f; // [px] - what the sheet declares it should span across, already reduced
};

/// 🧩 Retains what each control was arranged at, so the overlay can compare it against the sheet.
/// note  🔍 The comparison is the point: "exact" is checkable rather than asserted. A control whose extent
///       disagrees with its declared figure by more than half a pixel is reported in the pointer ink.
class MeasureOverlay
{
public:

    static constexpr std::uint32_t MeasuredCeiling = 32u;   // [-] - never allocated

    void Retain(const char* Naming, const PlaneExtent& Where, float Claimed)
    {
        if (MeasuredCount >= MeasuredCeiling)
            return;

        Measured[MeasuredCount].Naming  = Naming;
        Measured[MeasuredCount].Where   = Where;
        Measured[MeasuredCount].Claimed = Claimed;
        ++MeasuredCount;
    }

    void Discard()
    {
        MeasuredCount = 0u;
    }

    /// 🧩 Strokes every retained extent and reports the four factors the appearance was resolved by.
    void Record(RecordingSurface& Surface, const AppearanceSpecification& Appearance,
                double ArtistScale, float ExtentAlong, std::uint32_t Disagreeing) const
    {
        const ControlInk&    Ink     = Appearance.Control;
        const ControlMetric& Measure = Appearance.ControlMeasure;

        for (std::uint32_t Ordinal = 0u; Ordinal < MeasuredCount; ++Ordinal)
        {
            const MeasuredExtent& Held  = Measured[Ordinal];
            const float           Apart = Held.Where.SpanAcross() - Held.Claimed;
            const bool            Agreed = (Apart < 0.5f && Apart > -0.5f);

            Surface.Edge(Held.Where, Agreed ? Ink.RulerPointer : Ink.StopTaken, 1.0f, 0.0f, CornerNone);
        }

        // 📝 The header states every factor separately, so a wrong extent is attributable to which multiplier
        //    produced it without a debugger. A single product would say only that something is wrong.
        char Reading[192] = {};
        std::snprintf(Reading, sizeof(Reading),
                      "reduction %.2f  density %u  artist %.2f  applied %.3f  extent %.0f  measured %u  apart %u",
                      static_cast<double>(AuthoredReduction),
                      static_cast<unsigned>(Measure.Density),
                      ArtistScale,
                      static_cast<double>(Measure.AppliedFactor),
                      static_cast<double>(ExtentAlong),
                      static_cast<unsigned>(MeasuredCount),
                      static_cast<unsigned>(Disagreeing));

        Surface.TextRun(12.0f, 12.0f, Ink.RulerPointer, Reading, Measure.RowText, 0.0f, true);
    }

    /// 🧩 How many retained extents disagree with the figure the sheet declares for them.
    std::uint32_t Disagreeing() const
    {
        std::uint32_t Counted = 0u;

        for (std::uint32_t Ordinal = 0u; Ordinal < MeasuredCount; ++Ordinal)
        {
            const float Apart = Measured[Ordinal].Where.SpanAcross() - Measured[Ordinal].Claimed;

            if (Apart >= 0.5f || Apart <= -0.5f)
                ++Counted;
        }

        return Counted;
    }

private:

    MeasuredExtent  Measured[MeasuredCeiling] = {};   // [-] - never allocated
    std::uint32_t   MeasuredCount             = 0u;   // [-]
};

#endif   // SLATE_DEBUG

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                            MAIN
//------------------------------------------------------------------------------------------------------------------------

int main()
{
    using namespace Slate;

    // ① The timeline — one per process, constructed once.
    TickSequence Timeline;
    TickPoint    PreviousTick = Timeline.Advance();

    // ② The window.
    WindowInterchange Window;

    if (!Window.Open({ InitialWidth, InitialHeight }, WindowTitle).ContentPresent)
    {
        std::printf("%s \u2014 the window system declined\n", HostName);
        return 1;
    }

    // ③ The Vulkan instance.
    VulkanExchange DeviceEdge;

#ifdef SLATE_DEBUG
    const bool DiagnosticRequested = true;
#else
    const bool DiagnosticRequested = false;
#endif

    if (!DeviceEdge.ConstructInstance(DiagnosticRequested).ContentPresent)
    {
        std::printf("%s \u2014 no Vulkan instance could be constructed\n", HostName);
        return 1;
    }

    // ④ The presentation surface.
    const Deliver<VkSurfaceKHR> SurfaceConverted = Convert(DeviceEdge.Instance(), Window.NativeHandle());

    if (!SurfaceConverted.ContentPresent)
    {
        std::printf("%s \u2014 the presentation surface was refused\n", HostName);
        return 1;
    }

    const VkSurfaceKHR PresentationSurface = SurfaceConverted.Resolve();

    // ⑤ The diagnostic extension — attached after the instance, before the device.
    ReportSequence      DiagnosticRegister;
    DiagnosticExtension DiagnosticEdge;

    if (!DiagnosticEdge.Construct(DeviceEdge, DiagnosticRegister, Timeline).ContentPresent)
        std::printf("%s \u2014 the diagnostic extension was not negotiated\n", HostName);

    // ⑥ The device.
    if (!DeviceEdge.ConstructDevice(PresentationSurface).ContentPresent)
    {
        std::printf("%s \u2014 no Vulkan device could be constructed\n", HostName);
        return 1;
    }

    // ⑦ The presentation chain.
    DisplayScheduler DisplayChain;

    if (!DisplayChain.Construct(DeviceEdge, DiagnosticEdge, PresentationSurface,
                                InitialWidth, InitialHeight, LatencyIntent::SteadyPacing).ContentPresent)
    {
        std::printf("%s \u2014 the presentation chain was refused\n", HostName);
        return 1;
    }

    // ⑧ The cyclic recording slots and the command recording sequence.
    CycleScheduler  Cycle;
    CommandSequence Commands;

    if (!Cycle.Construct(DeviceEdge, DiagnosticEdge).ContentPresent ||
        !Commands.Construct(DeviceEdge, DiagnosticEdge).ContentPresent)
    {
        std::printf("%s \u2014 the recording rotation was refused\n", HostName);
        return 1;
    }

    // ⑨ The interface attachment.
    InterfaceAttachment InterfaceArriving = {};
    InterfaceArriving.Instance                 = DeviceEdge.Instance();
    InterfaceArriving.ScoredDevice             = DeviceEdge.ScoredDevice();
    InterfaceArriving.ActiveDevice             = DeviceEdge.ActiveDevice();
    InterfaceArriving.GraphicsQueue            = DeviceEdge.GraphicsQueue();
    InterfaceArriving.GraphicsFamilyOrdinal    = DeviceEdge.Capability().GraphicsFamilyOrdinal;
    InterfaceArriving.ColourTargetFormat       = DisplayChain.Carries();
    InterfaceArriving.MinimumDisplayImageCount = DisplayChain.MinimumChainImageCount();
    InterfaceArriving.DisplayImageCount        = DisplayChain.ChainImageCount();
    InterfaceArriving.NativeWindowSlot         = Window.NativeHandle();

    // ⑩ 🔴 The interface, the integrator, the ledger and the panel — **not** `ViewportSequence`. The sheet
    //    declares no drawers, and constructing two of them to hold both closed forever would be recording
    //    chrome nothing in the reference has, which is the opposite of what a validation host is for.
    InterfaceExchange Interface;

    if (!Interface.Construct(InterfaceArriving).ContentPresent)
    {
        std::printf("%s \u2014 the interface context was refused\n", HostName);
        return 1;
    }

    MotionIntegrator Motion;
    InteractionIndex Ledger;
    RecordingSurface Surface;
    ControlPanel     Panel;

    if (!Ledger.Construct(Motion).ContentPresent)
    {
        std::printf("%s \u2014 the interaction ledger was refused\n", HostName);
        return 1;
    }

    const Deliver<ValidationIdentities> Enrolled = EnrolEvery(Ledger);

    if (!Enrolled.ContentPresent)
    {
        std::printf("%s \u2014 the ledger declined an enrolment: %s\n", HostName, Enrolled.Declined.Detail);
        return 1;
    }

    const ValidationIdentities Claimed = Enrolled.Resolve();

    AppearanceSpecification Appearance = Resolve(1.0, SheetColumnScale, 0.0f);

    if (!Panel.Construct(Ledger, Surface, Appearance).ContentPresent)
    {
        std::printf("%s \u2014 the control panel was refused\n", HostName);
        return 1;
    }

    // What the sheet seats, and the runs it presents — the sole owner of every datum below.
    ValidationOrdinates Seated;

    const char* SelectionOptions[] = { "Entry name", "Second Entry", "Third Entry" };
    const char* SizeStops[]        = { "S", "M", "L", "XL" };

    SelectionDeclaration Selection;
    Selection.Caption     = "Selection";
    Selection.Options     = SelectionOptions;
    Selection.OptionCount = 3u;

    MagnitudeDeclaration Degree;
    Degree.Caption   = "Degree";
    Degree.UnitGlyph = "\u00B0";

    MagnitudeDeclaration Percent;
    Percent.Caption   = "Percent";
    Percent.UnitGlyph = "%";

    MagnitudeDeclaration Pixel;
    Pixel.Caption   = "Pixel";
    Pixel.UnitGlyph = "px";

    RulerDeclaration Rotation;
    Rotation.Caption   = "Rotation";
    Rotation.UnitGlyph = "\u00B0";

    ToggleDeclaration Snapping;     Snapping.Caption     = "Enable Snapping";
    ToggleDeclaration GridLines;    GridLines.Caption    = "Show Grid Lines";
    ToggleDeclaration AspectLocked; AspectLocked.Caption = "Lock Aspect Ratio";

    SubsetDeclaration EntryOne;   EntryOne.Caption   = "Entry one";
    SubsetDeclaration EntryTwo;   EntryTwo.Caption   = "Entry two";
    SubsetDeclaration EntryThree; EntryThree.Caption = "Entry three";
    SubsetDeclaration EntryFour;  EntryFour.Caption  = "Entry four";

    StopDeclaration Size;
    Size.Caption   = "Size";
    Size.Stops     = SizeStops;
    Size.StopCount = 4u;

    constexpr const char* TooltipBody =
        "Try connecting to another server. In case of a repeated error, please wait, "
        "if nothing happens, try to write a letter to the post office.";

    TooltipDeclaration TooltipLight;
    TooltipLight.Title      = "Tooltip";
    TooltipLight.Body       = TooltipBody;
    TooltipLight.Figure     = SymbolSubject::BulbFilament;
    TooltipLight.Appearance = TooltipAppearance::Light;

    TooltipDeclaration TooltipDark = TooltipLight;
    TooltipDark.Appearance         = TooltipAppearance::Dark;

#ifdef SLATE_DEBUG
    MeasureOverlay Overlay;
    bool           OverlayPresented = false;
#endif

    double ArtistScale     = SheetColumnScale;
    float  ResolvedAgainst = 0.0f;

    // 📝 🔴 The sheet is a scrolling page — `py-32` above and below a column that runs past 1000 px at the
    //    reduced scale. A host that recorded it into a fixed window would present the first four cards and
    //    silently lose the last two, which is exactly the kind of disagreement this host exists to catch.
    float ScrollAcross  = 0.0f;   // [px] - how far the column has been carried upward
    float ColumnMeasured = 0.0f;  // [px] - what the previous tick's column actually occupied

    std::printf("%s \u2014 running\n", HostName);

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────
    //                                                       THE TICK LOOP
    // ─────────────────────────────────────────────────────────────────────────────────────────────────────

    while (!Window.ClosureRequested())
    {
        Window.Drain();

        DisplayExtent Extent = Window.CurrentExtent();

        if (Extent.Width == 0u || Extent.Height == 0u)
        {
            Window.Await();
            continue;
        }

        if (Window.ExtentAltered())
        {
            vkDeviceWaitIdle(DeviceEdge.ActiveDevice());
            DisplayChain.Reclaim(Extent.Width, Extent.Height);
            Interface.Renegotiate(DisplayChain.MinimumChainImageCount(), DisplayChain.ChainImageCount());
            Window.AdoptExtent();
        }

        if (!Cycle.Await().ContentPresent)
        {
            std::printf("%s \u2014 the cycle slot was lost\n", HostName);
            break;
        }

        const std::uint32_t      SlotOrdinal = Cycle.StandingOrdinal();
        const Deliver<CycleSlot> Standing    = Cycle.Standing();

        if (!Standing.ContentPresent)
            break;

        const TickPoint TickNow   = Timeline.Advance();
        const double    ElapsedMs = TickSequence::Span(PreviousTick, TickNow);
        PreviousTick = TickNow;

        // ① Open the interface tick and adopt the surface.
        if (!Interface.Advance().ContentPresent)
            continue;

        if (!Surface.Adopt().ContentPresent)
        {
            Interface.Abandon();
            continue;
        }

        const DisplayCondition& Display = Surface.Display();

        // ② 🔴 Re-resolve only when a factor actually moved. Resolved unconditionally, every extent is
        //    recomputed sixty times a second to the same figures, and the density classification steps
        //    while a drag is live.
        if (Display.ExtentAlong != ResolvedAgainst)
        {
            Appearance      = Resolve(Display.DisplayScale, ArtistScale, Display.ExtentAlong);
            ResolvedAgainst = Display.ExtentAlong;
        }

        Motion.Advance(ElapsedMs);
        Panel.Advance(Surface.Pointer(), ElapsedMs);

#ifdef SLATE_DEBUG
        Overlay.Discard();
#endif

        const ControlInk&    Ink     = Appearance.Control;
        const ControlMetric& Measure = Appearance.ControlMeasure;

        // ③ The page ground, then the sheet's own column, centred.
        const PlaneExtent Page = Spanning(0.0f, 0.0f, Display.ExtentAlong, Display.ExtentAcross);

        Surface.Ground(Page, Ink.PageGround, 0.0f, CornerNone);

        const float ColumnAlong  = (Measure.ColumnAlong < Display.ExtentAlong - Measure.PagePad * 2.0f)
                                 ? Measure.ColumnAlong
                                 : Display.ExtentAlong - Measure.PagePad * 2.0f;
        const float ColumnLeast  = (Display.ExtentAlong - ColumnAlong) * 0.5f;

        // 📐 The wheel carries the column, and the travel is held between zero and whatever the column
        //    overruns the display by. Clamped against the **previous** tick's measured extent, because this
        //    tick's is not known until every card has been arranged — and a scroll clamped against a stale
        //    extent by one tick is invisible, where an unclamped one scrolls into empty space forever.
        const float Overrun = (ColumnMeasured > Display.ExtentAcross)
                            ? (ColumnMeasured - Display.ExtentAcross) : 0.0f;

        ScrollAcross -= Surface.Pointer().WheelAcross * Measure.CardGapAcross * 2.0f;
        ScrollAcross  = (ScrollAcross < 0.0f) ? 0.0f
                      : (ScrollAcross > Overrun) ? Overrun : ScrollAcross;

        float Cursor = Measure.PagePad - ScrollAcross;

        // 📝 Every card below is arranged from its own row extents and then recorded, so the arrangement the
        //    overlay measures and the arrangement the control was handed are the same object by construction.
        const auto AdvanceCard = [&](const float* RowExtents, std::uint32_t RowCount) -> CardArrangement
        {
            const CardArrangement Arranged = Panel.ArrangeCard(ColumnLeast, Cursor, ColumnAlong,
                                                               RowExtents, RowCount);
            Panel.RecordCard(Arranged);
            Cursor = Arranged.Enclosure.MostAcross + Measure.CardGapAcross;
            return Arranged;
        };

        const auto RowAt = [&](const CardArrangement& Card, const float* RowExtents,
                               std::uint32_t Ordinal) -> PlaneExtent
        {
            float Along = Card.Interior.LeastAcross;

            for (std::uint32_t Passed = 0u; Passed < Ordinal; ++Passed)
                Along += RowExtents[Passed] + Card.RowGap;

            return Spanning(Card.Interior.LeastAlong, Along, Card.Interior.SpanAlong(), RowExtents[Ordinal]);
        };

        // ④ Card one — the selection field and the three magnitude rows.
        const float TopRows[4] = { Measure.FieldAcross, Measure.FieldAcross,
                                   Measure.FieldAcross, Measure.FieldAcross };
        const CardArrangement TopCard = AdvanceCard(TopRows, 4u);

        const PlaneExtent SelectionRow = RowAt(TopCard, TopRows, 0u);
        const PlaneExtent DegreeRow    = RowAt(TopCard, TopRows, 1u);
        const PlaneExtent PercentRow   = RowAt(TopCard, TopRows, 2u);
        const PlaneExtent PixelRow     = RowAt(TopCard, TopRows, 3u);

        Panel.SelectionField(Claimed.Selection, SelectionRow, Selection, Seated.SelectionTaken);
        Panel.MagnitudeRow(Claimed.Degree,  DegreeRow,  Degree,  Seated.Degree);
        Panel.MagnitudeRow(Claimed.Percent, PercentRow, Percent, Seated.Percent);
        Panel.MagnitudeRow(Claimed.Pixel,   PixelRow,   Pixel,   Seated.Pixel);

        // ⑤ Card two — the two tooltip triggers inside their well.
        const float TooltipRows[1] = { Measure.TooltipWellFloor };
        const CardArrangement TooltipCard = AdvanceCard(TooltipRows, 1u);
        const PlaneExtent     TooltipWell = RowAt(TooltipCard, TooltipRows, 0u);

        Surface.Ground(TooltipWell, Ink.WellGround, Measure.TooltipWellRadius, CornerAll);
        Surface.Edge(TooltipWell, Ink.CardEdge, Measure.CardEdgeWeight, Measure.TooltipWellRadius, CornerAll);

        // 📐 The sheet places its two triggers `items-end` with a gap of 32 units between them, and lifts each
        //    by `ml-8`. Both are seated against the well's lower padding, which is what items-end states.
        const float TriggerAcross = TooltipWell.MostAcross - Measure.TooltipWellPad - Measure.TriggerExtent;
        const float TriggerPair   = Measure.TriggerExtent * 2.0f + Measure.TooltipWellGap;
        const float TriggerLeast  = TooltipWell.LeastAlong + (TooltipWell.SpanAlong() - TriggerPair) * 0.5f;

        const PlaneExtent LightTrigger = Spanning(TriggerLeast + Measure.TriggerLeadAlong, TriggerAcross,
                                                  Measure.TriggerExtent, Measure.TriggerExtent);
        const PlaneExtent DarkTrigger  = Spanning(TriggerLeast + Measure.TriggerExtent + Measure.TooltipWellGap,
                                                  TriggerAcross, Measure.TriggerExtent, Measure.TriggerExtent);

        Panel.TooltipTrigger(Claimed.TooltipLight, LightTrigger, TooltipLight);
        Panel.TooltipTrigger(Claimed.TooltipDark,  DarkTrigger,  TooltipDark);

        // ⑥ Card three — the rotation ruler.
        const float RulerRows[1] = { Measure.FieldAcross + Measure.CardRowGap * 0.5f + Measure.RulerAcross };
        const CardArrangement RulerCard = AdvanceCard(RulerRows, 1u);

        Panel.RotationRuler(Claimed.Rotation, RowAt(RulerCard, RulerRows, 0u), Rotation, Seated.Rotation);

        // ⑦ Card four — the three toggles inside their well.
        const float ToggleWellAcross = Measure.ToggleRowAcross * 3.0f + Measure.WellGapAcross * 2.0f
                                     + Measure.WellPad * 2.0f;
        const float ToggleRows[1] = { ToggleWellAcross };
        const CardArrangement ToggleCard = AdvanceCard(ToggleRows, 1u);
        const PlaneExtent     ToggleWell = RowAt(ToggleCard, ToggleRows, 0u);

        Surface.Ground(ToggleWell, Ink.WellGround, Measure.WellRadius, CornerAll);
        Surface.Edge(ToggleWell, Ink.CardEdge, Measure.CardEdgeWeight, Measure.WellRadius, CornerAll);

        const auto WellRow = [&](const PlaneExtent& Well, float RowAcross, std::uint32_t Ordinal) -> PlaneExtent
        {
            return Spanning(Well.LeastAlong + Measure.WellPad,
                            Well.LeastAcross + Measure.WellPad +
                                static_cast<float>(Ordinal) * (RowAcross + Measure.WellGapAcross),
                            Well.SpanAlong() - Measure.WellPad * 2.0f, RowAcross);
        };

        Panel.ToggleRow(Claimed.Snapping,     WellRow(ToggleWell, Measure.ToggleRowAcross, 0u),
                        Snapping,     Seated.Snapping);
        Panel.ToggleRow(Claimed.GridLines,    WellRow(ToggleWell, Measure.ToggleRowAcross, 1u),
                        GridLines,    Seated.GridLines);
        Panel.ToggleRow(Claimed.AspectLocked, WellRow(ToggleWell, Measure.ToggleRowAcross, 2u),
                        AspectLocked, Seated.AspectLocked);

        // ⑧ Card five — the four multi-select rows inside their well.
        const float SubsetWellAcross = Measure.SubsetRowAcross * 4.0f + Measure.WellGapAcross * 3.0f
                                     + Measure.WellPad * 2.0f;
        const float SubsetRows[1] = { SubsetWellAcross };
        const CardArrangement SubsetCard = AdvanceCard(SubsetRows, 1u);
        const PlaneExtent     SubsetWell = RowAt(SubsetCard, SubsetRows, 0u);

        Surface.Ground(SubsetWell, Ink.WellGround, Measure.WellRadius, CornerAll);
        Surface.Edge(SubsetWell, Ink.CardEdge, Measure.CardEdgeWeight, Measure.WellRadius, CornerAll);

        Panel.SubsetRow(Claimed.EntryOne,   WellRow(SubsetWell, Measure.SubsetRowAcross, 0u),
                        EntryOne,   Seated.EntryOne);
        Panel.SubsetRow(Claimed.EntryTwo,   WellRow(SubsetWell, Measure.SubsetRowAcross, 1u),
                        EntryTwo,   Seated.EntryTwo);
        Panel.SubsetRow(Claimed.EntryThree, WellRow(SubsetWell, Measure.SubsetRowAcross, 2u),
                        EntryThree, Seated.EntryThree);
        Panel.SubsetRow(Claimed.EntryFour,  WellRow(SubsetWell, Measure.SubsetRowAcross, 3u),
                        EntryFour,  Seated.EntryFour);

        // ⑨ Card six — the magnitude stops.
        const float StopRows[1] = { Measure.StopStripAcross };
        const CardArrangement StopCard = AdvanceCard(StopRows, 1u);

        Panel.MagnitudeStops(Claimed.Size, RowAt(StopCard, StopRows, 0u), Size, Seated.SizeTaken);

        // 🔴 The deferred sweep — every menu and every tooltip card, above every row recorded above.
        Panel.RecordDeferred();

        // 📝 What the column actually occupied, for the next tick's scroll to be held against. The sheet's
        //    trailing `py-32` is added so the last card can be carried clear of the lower edge.
        ColumnMeasured = Cursor + ScrollAcross + Measure.PagePadAcross;

#ifdef SLATE_DEBUG
        // 🔍 The overlay retains what the sheet declares each control should span across, and strokes the
        //    disagreement. Recorded last so it sits above even the deferred sweep.
        Overlay.Retain("selection", SelectionRow, Measure.FieldAcross);
        Overlay.Retain("degree",    DegreeRow,    Measure.FieldAcross);
        Overlay.Retain("percent",   PercentRow,   Measure.FieldAcross);
        Overlay.Retain("pixel",     PixelRow,     Measure.FieldAcross);
        Overlay.Retain("light",     LightTrigger, Measure.TriggerExtent);
        Overlay.Retain("dark",      DarkTrigger,  Measure.TriggerExtent);
        Overlay.Retain("toggles",   ToggleWell,   ToggleWellAcross);
        Overlay.Retain("subsets",   SubsetWell,   SubsetWellAcross);

        if (OverlayPresented)
            Overlay.Record(Surface, Appearance, ArtistScale, Display.ExtentAlong, Overlay.Disagreeing());
#endif

        // Seal, then acquire. Nothing between the acquire and the present may return to the top.
        if (!Interface.Seal().ContentPresent)
        {
            Interface.Abandon();
            continue;
        }

        const Deliver<ArrivedImage> Arrived = DisplayChain.Await(Standing.Resolve(), Timeline);

        if (!Arrived.ContentPresent)
        {
            if (Arrived.Declined.DeclaredReason == RefusalReason::DeviceLost)
            {
                std::printf("%s \u2014 the device was lost\n", HostName);
                break;
            }

            continue;
        }

        if (Arrived.Resolve().Reclaimed)
        {
            vkDeviceWaitIdle(DeviceEdge.ActiveDevice());
            DisplayChain.Reclaim(Extent.Width, Extent.Height);
            Interface.Renegotiate(DisplayChain.MinimumChainImageCount(), DisplayChain.ChainImageCount());
            Window.AdoptExtent();
            continue;
        }

        const Deliver<VkCommandBuffer> Recording = Commands.Open(SlotOrdinal);

        if (!Recording.ContentPresent)
        {
            std::printf("%s \u2014 the command recording was refused\n", HostName);
            break;
        }

        const VkCommandBuffer Assembling = Recording.Resolve();

        const VkRenderingAttachmentInfo ColourAttachment = {
            .sType       = VK_STRUCTURE_TYPE_RENDERING_ATTACHMENT_INFO,
            .imageView   = Arrived.Resolve().WholeView,
            .imageLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL,
            .loadOp      = VK_ATTACHMENT_LOAD_OP_CLEAR,
            .storeOp     = VK_ATTACHMENT_STORE_OP_STORE,
            .clearValue  = { .color = { { 0.02f, 0.02f, 0.02f, 1.0f } } }
        };

        const VkRenderingInfo RenderScope = {
            .sType                = VK_STRUCTURE_TYPE_RENDERING_INFO,
            .renderArea           = { { 0, 0 }, { DisplayChain.StandingWidth(), DisplayChain.StandingHeight() } },
            .layerCount           = 1u,
            .colorAttachmentCount = 1u,
            .pColorAttachments    = &ColourAttachment
        };

        vkCmdBeginRendering(Assembling, &RenderScope);
        Interface.Record(Assembling);
        vkCmdEndRendering(Assembling);

        if (!Cycle.Arm().ContentPresent)
            break;

        const Deliver<bool> Surrendered = Commands.Surrender(SlotOrdinal, SurrenderOrdering{
            .Awaited      = Standing.Resolve().ImageArrived,
            .AwaitedStage = VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,
            .Signalled    = Standing.Resolve().RecordingDone,
            .Completion   = Standing.Resolve().Completion
        });

        if (!Surrendered.ContentPresent)
            break;

        if (!DisplayChain.Present(Standing.Resolve(), Arrived.Resolve().ImageOrdinal).ContentPresent)
        {
            vkDeviceWaitIdle(DeviceEdge.ActiveDevice());
            DisplayChain.Reclaim(Extent.Width, Extent.Height);
            Interface.Renegotiate(DisplayChain.MinimumChainImageCount(), DisplayChain.ChainImageCount());
            Window.AdoptExtent();
        }

        Cycle.Advance();
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────
    //                                                      RECLAMATION
    // ─────────────────────────────────────────────────────────────────────────────────────────────────────

    if (DeviceEdge.ActiveDevice() != VK_NULL_HANDLE)
        vkDeviceWaitIdle(DeviceEdge.ActiveDevice());

    Panel.Reset();
    Ledger.Reset();
    Surface.Reset();
    Interface.Reclaim();
    Commands.Reclaim();
    Cycle.Reclaim();
    DisplayChain.Surrender();
    DiagnosticEdge.Reclaim();
    Reclaim(DeviceEdge.Instance(), PresentationSurface);
    DeviceEdge.ReclaimDevice();

    std::printf("%s \u2014 exited cleanly\n", HostName);
    return 0;
}
