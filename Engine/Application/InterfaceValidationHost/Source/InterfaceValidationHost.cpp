//============================================================================================================================================
//                                                     INTERFACEVALIDATIONHOST.CPP
//============================================================================================================================================
// 🧩 Records the control sheet and reusable global-interface components for direct visual comparison.

#include "Contract/DeliveryContract.h"
#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"
#include "SlateUI/Interface/ComponentSpecification/Api/ComponentSpecification.h"
#include "SlateUI/Interface/ControlCentrePanel/Api/ControlCentrePanel.h"
#include "SlateUI/Interface/ControlPanel/Api/ControlPanel.h"
#include "SlateUI/Interface/EditorPanel/Api/EditorPanel.h"
#include "SlateUI/Interface/FacetPanel/Api/FacetPanel.h"
#include "SlateUI/Interface/InteractionIndex/Api/InteractionIndex.h"
#include "SlateUI/Interface/InterfaceExchange/Api/InterfaceExchange.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"
#include "SlateUI/Interface/MotionIntegrator/Api/MotionIntegrator.h"
#include "SlateVulkan/Device/HostLifecycle/Api/HostLifecycle.h"

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

// 📝 The sheet's own page ground, #050505, as four unit ordinates. HostLifecycle clears the colour target
//    to this before the host records anything over it.
constexpr float PageGroundInk[4] = { 0.0196f, 0.0196f, 0.0196f, 1.0f };   // [-]

/// 🧩 Copies the device handles across the layer seam into the attachment the interface declares.
/// note  🔴 `SlateVulkan` cannot name `InterfaceAttachment` — it lives one layer above — so `HostLifecycle`
///        offers the same handles as `DeviceOffering` and the host performs the copy.
InterfaceAttachment Attach(const DeviceOffering& Offered)
{
    InterfaceAttachment Arriving = {};

    Arriving.Instance                 = Offered.Instance;
    Arriving.ScoredDevice             = Offered.ScoredDevice;
    Arriving.ActiveDevice             = Offered.ActiveDevice;
    Arriving.GraphicsQueue            = Offered.GraphicsQueue;
    Arriving.GraphicsFamilyOrdinal    = Offered.GraphicsFamilyOrdinal;
    Arriving.ColourTargetFormat       = Offered.ColourTargetFormat;
    Arriving.MinimumDisplayImageCount = Offered.MinimumDisplayImageCount;
    Arriving.DisplayImageCount        = Offered.DisplayImageCount;
    Arriving.NativeWindowSlot         = Offered.NativeWindowSlot;

    return Arriving;
}

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
    std::uint32_t  SizeTaken       = 2u;      // [-]   - the taken stop is L
    bool           InspectorDocked = true;    // [-]   - reference switch begins taken
    std::uint32_t  WorkspaceTaken  = 1u;      // [-]   - Texture Paint
    std::uint32_t  InspectorTaken  = 0u;      // [-]   - Properties
    bool           TransformOpen   = true;    // [-]   - folding property card
    std::uint32_t  ShadingTaken    = 0u;      // [-]   - dropdown selection
    PickerColour   Albedo          = { 214u, 216u, 222u, 255u };   // [-] - HSV colour picker
    bool           OutlineExpanded[5] = { true, true, true, true, true };   // [-] - branch disclosure
    bool           OutlineTaken[5]    = { false, true, true, false, false };   // [-] - additive multi-selection
    bool           OutlinePresent[5]  = { true, true, true, false, true };   // [-] - row presence action
    std::uint32_t  OutlineEnclosure[5] = { 5u, 0u, 1u, 1u, 0u };   // [-] - enclosing record; five is root
    std::uint32_t  OutlineOrder[5]     = { 0u, 0u, 0u, 1u, 1u };   // [-] - sibling position
    bool           FacetEnabled[14]    = { true, true, true, true, true, false, false,
                                           true, true, true, true, false, false, false };   // [-] - active filters
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
    ControlIdentity  TooltipLight  = {};
    ControlIdentity  TooltipDark   = {};
    ControlIdentity  InspectorDock = {};
    ControlIdentity  WorkspaceMode = {};
    ControlIdentity  InspectorTabs = {};
    ControlIdentity  TransformFold = {};
    ControlIdentity  ShadingMenu   = {};
    ControlIdentity  AlbedoPicker       = {};
    ControlIdentity  OutlineRows[5]     = {};
    ControlIdentity  OutlineExpansion[5] = {};
};

/// 🧩 Claims every identity the sheet needs, refusing in full rather than in part.
/// out   Deliver  [-]  refuses with ExtentExhausted when the ledger declines any requested identity
/// note  🔴 A partial enrolment would leave one control reading another's fade, which draws correctly on the
///       first tick and diverges on the second — the hardest possible shape of defect to attribute.
Deliver<ValidationIdentities> EnrolEvery(InteractionIndex& Ledger)
{
    ValidationIdentities  Claimed;
    ControlIdentity*      Every[] = {
        &Claimed.Selection, &Claimed.Degree,     &Claimed.Percent,    &Claimed.Pixel,
        &Claimed.Rotation,  &Claimed.Snapping,   &Claimed.GridLines,  &Claimed.AspectLocked,
        &Claimed.EntryOne,  &Claimed.EntryTwo,   &Claimed.EntryThree, &Claimed.EntryFour,
        &Claimed.Size,      &Claimed.TooltipLight, &Claimed.TooltipDark,
        &Claimed.InspectorDock, &Claimed.WorkspaceMode, &Claimed.InspectorTabs, &Claimed.TransformFold,
        &Claimed.ShadingMenu, &Claimed.AlbedoPicker,
        &Claimed.OutlineRows[0], &Claimed.OutlineRows[1], &Claimed.OutlineRows[2],
        &Claimed.OutlineRows[3], &Claimed.OutlineRows[4],
        &Claimed.OutlineExpansion[0], &Claimed.OutlineExpansion[1], &Claimed.OutlineExpansion[2],
        &Claimed.OutlineExpansion[3], &Claimed.OutlineExpansion[4]
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

    // ① The five lifetimes — window, instance, surface, diagnostic, device, chain, slots, recordings.
    HostDeclaration Declared;
    Declared.Naming        = HostName;
    Declared.WindowCaption = WindowTitle;
    Declared.InitialWidth  = InitialWidth;
    Declared.InitialHeight = InitialHeight;
    Declared.Pacing        = LatencyIntent::SteadyPacing;

    // 🔴 Requested in EVERY configuration. `Build\Construct.bat` produces Release by default, so gating
    //    this compiled the validation layer out of the binary that is actually run — and every run then
    //    reported itself unwatched, which is the one answer indistinguishable from a clean one.
    Declared.DiagnosticRequested = true;

    HostLifecycle Lifetime;

    if (!Lifetime.Construct(Declared).ContentPresent)
        return 1;

    // ② 🔴 The interface, the integrator, the ledger and the panel — **not** `ViewportSequence`. The sheet
    //    declares no drawers, and constructing two of them to hold both closed forever would be recording
    //    chrome nothing in the reference has, which is the opposite of what a validation host is for.
    InterfaceExchange Interface;

    if (!Interface.Construct(Attach(Lifetime.Offering())).ContentPresent)
    {
        std::printf("%s \u2014 the interface context was refused\n", HostName);
        return 1;
    }

    MotionIntegrator Motion;
    InteractionIndex Ledger;
    RecordingSurface       Surface;
    ComponentSpecification  Panel;
    ControlPanel             ReferenceControls;
    FacetPanel               Facets;
    EditorPanel              EditorPanels;
    PanelStructure           EditorPartition;
    EditorPanelOrdinates     EditorOrdinates;
    ControlCentrePanel       ControlCentre;
    ControlCentreOrdinates   ControlCentreValues;

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

    if (!ReferenceControls.Construct(Ledger, Surface, Appearance).ContentPresent)
    {
        std::printf("%s \u2014 the reference controls were refused\n", HostName);
        return 1;
    }

    if (!Facets.Construct(Motion, Surface, Appearance).ContentPresent)
    {
        std::printf("%s \u2014 the facet panel was refused\n", HostName);
        return 1;
    }

    if (!EditorPanels.Construct(Motion, Surface, Appearance).ContentPresent)
    {
        std::printf("%s \u2014 the editor panels were refused\n", HostName);
        return 1;
    }

    EditorPartition.Construct(PanelSubject::Viewport);

    if (!ControlCentre.Construct(Motion, Surface, Appearance).ContentPresent)
    {
        std::printf("%s \u2014 the Control Centre panel was refused\n", HostName);
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

    const char* WorkspaceCaptions[] = { "Drafting", "Texture Paint", "Game Editor" };
    const char* InspectorCaptions[] = { "Properties", "History" };

    SwitchDeclaration InspectorDock;
    InspectorDock.Caption = "Dock Inspector";

    SegmentDeclaration WorkspaceMode;
    WorkspaceMode.Captions     = WorkspaceCaptions;
    WorkspaceMode.CaptionCount = 3u;

    TabDeclaration InspectorTabs;
    InspectorTabs.Captions     = InspectorCaptions;
    InspectorTabs.CaptionCount = 2u;

    const char* TransformRuns[] = { "Position", "Rotation", "Scale" };
    const char* ShadingOptions[] = { "Smooth", "Faceted", "Flat" };
    const char* PropertyCards[]  = { "Record · 2 fields", "Transform · 3 fields", "Appearance · 4 fields" };
    const char* RevisionCards[]  = { "Set Parameter · 10:42", "Translate SOL_Boss · 10:37", "Created SOL_Boss · 10:31" };

    CarouselDeclaration InspectorCarousel;
    InspectorCarousel.LeadingRuns   = PropertyCards;
    InspectorCarousel.LeadingCount  = 3u;
    InspectorCarousel.TrailingRuns  = RevisionCards;
    InspectorCarousel.TrailingCount = 3u;

    FoldDeclaration TransformFold;
    TransformFold.Caption   = "TRANSFORM";
    TransformFold.BodyRuns  = TransformRuns;
    TransformFold.BodyCount = 3u;

    DropdownDeclaration ShadingMenu;
    ShadingMenu.Caption     = "Shading";
    ShadingMenu.Options     = ShadingOptions;
    ShadingMenu.OptionCount = 3u;

    ColourPickerDeclaration AlbedoPicker;
    AlbedoPicker.Caption = "Albedo";

    const char* FacetOptions[14] = {
        "Base Colour", "Metallic", "Roughness", "Height", "Normal", "Opacity", "Emissive",
        "Ambient Occlusion", "Anisotropy", "Anisotropy Angle", "Clearcoat", "Refraction Index",
        "Sheen", "Subsurface"
    };
    const InkOrdinate FacetInks[14] = {
        Covering(0xB87333u), Covering(0x8B5CF6u), Covering(0x3B82F6u), Covering(0x8A8A8Au),
        Covering(0x10B981u), Covering(0x94A3B8u), Covering(0xF59E0Bu), Covering(0x6B7280u),
        Covering(0x22D3EEu), Covering(0x0EA5E9u), Covering(0xE2E8F0u), Covering(0xA78BFAu),
        Covering(0xF472B6u), Covering(0xFB7185u)
    };
    FacetDeclaration FacetCard;
    FacetCard.Caption       = "Filters";
    FacetCard.Options       = FacetOptions;
    FacetCard.Inks          = FacetInks;
    FacetCard.OptionCount   = 14u;
    FacetCard.LockedOrdinal = 0u;

    OutlineDeclaration OutlineRows[5] = {
        { "Part",         0u, 2u, true,  true  },
        { "Bodies",       1u, 3u, true,  true  },
        { "SOL_Boss",     2u, 0u, true,  true  },
        { "SOL_Rib",      2u, 0u, true,  false },
        { "SOL_Housing",  1u, 0u, true,  true  }
    };

    RevisionDeclaration RevisionRows[3] = {
        { "Set Parameter",  "Radius = 6.25 mm", "10:42" },
        { "Translate SOL_Boss", "Moved 4.20 mm", "10:37" },
        { "Created SOL_Boss", "Initial condition", "10:31" }
    };

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

    while (Lifetime.Standing())
    {
        const TickPass Pass = Lifetime.Await(PageGroundInk);

        if (Pass.Standing == TickStanding::Closed)
            break;

        // 🔴 The DEVICE was rebuilt, so every device handle the interface holds names an object the vendor
        //    has returned. The interface alone is reconstructed: the ledger, the panel and the recording
        //    surface hold no device handle, so retiring them would discard interaction state — the seizure
        //    an artist is mid-drag on — over a rebuild that did not invalidate any of it.
        //    Tested before DisplayRecovered because a device rebuild raises both.
        if (Lifetime.DeviceRecovered())
        {
            Interface.Reclaim();

            if (!Interface.Construct(Attach(Lifetime.Offering())).ContentPresent)
            {
                std::printf("%s \u2014 the interface could not be rebuilt on the recovered device\n", HostName);
                break;
            }

            // 📝 The display recovery this rebuild also raised is consumed here; the reconstruction above
            //    already took the counts the new chain holds.
            static_cast<void>(Lifetime.DisplayRecovered());
        }

        // The chain was re-established; the interface is told the counts it now holds, exactly once.
        else if (Lifetime.DisplayRecovered())
        {
            const DeviceOffering Offered = Lifetime.Offering();
            // 🔴 Read, not discarded. An interface still holding the previous image counts records
            //    against a chain depth that no longer exists, and the vendor reports that as a
            //    descriptor mismatch several ticks later rather than as the resize that caused it.
            if (!Interface.Renegotiate(Offered.MinimumDisplayImageCount, Offered.DisplayImageCount))
            {
                std::printf("%s \u2014 the interface declined the restated image counts\n", HostName);
            }
        }

        if (Pass.Standing != TickStanding::Recording)
            continue;

        const double ElapsedMs = Pass.ElapsedMilliseconds;

        // ① Open the interface tick and adopt the surface. 🔴 A refusal here must NOT return to the top
        //    of the loop: Await has already acquired an image and opened a recording, and only Surrender
        //    closes them. The tick records nothing and the cleared ground is presented instead.
        bool ContentBuilt = Interface.Advance().ContentPresent;

        if (ContentBuilt && !Surface.Adopt().ContentPresent)
        {
            Disregard(Interface.Abandon());
            ContentBuilt = false;
        }

        if (ContentBuilt)
        {

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
        ReferenceControls.Advance(Surface.Pointer(), ElapsedMs);
        Facets.Advance(Surface.Pointer(), ElapsedMs);
        EditorPanels.Advance(Surface.Pointer(), ElapsedMs);
        ControlCentre.Advance(Surface.Pointer(), ElapsedMs);

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

        // ⑩ The general-purpose filter card — wrapped active chips, removal, clear-all, and the shared dropdown.
        const float FacetAcross = Facets.MeasureAcross(ColumnAlong, FacetCard, Seated.FacetEnabled);
        const PlaneExtent FacetExtent = Spanning(ColumnLeast, Cursor, ColumnAlong, FacetAcross);
        Disregard(Facets.Record(FacetExtent, FacetCard, Seated.FacetEnabled));
        Cursor = FacetExtent.MostAcross + Measure.CardGapAcross;

        // ⑪ The global-interface primitives — switch, segmented selector, inspector carousel, fold and dropdown.
        const float ReferenceRows[7] = { 32.0f, 38.0f, 31.0f, 154.0f, 129.0f, 124.0f, 341.0f };
        const CardArrangement ReferenceCard = AdvanceCard(ReferenceRows, 7u);

        ReferenceControls.SwitchToggle(Claimed.InspectorDock, RowAt(ReferenceCard, ReferenceRows, 0u),
                                       InspectorDock, Seated.InspectorDocked);
        ReferenceControls.SegmentedChoice(Claimed.WorkspaceMode, RowAt(ReferenceCard, ReferenceRows, 1u),
                                          WorkspaceMode, Seated.WorkspaceTaken);
        ReferenceControls.TabStrip(Claimed.InspectorTabs, RowAt(ReferenceCard, ReferenceRows, 2u),
                                   InspectorTabs, Seated.InspectorTaken);
        ReferenceControls.CarouselPages(Claimed.InspectorTabs, RowAt(ReferenceCard, ReferenceRows, 3u),
                                        InspectorCarousel, Seated.InspectorTaken);
        ReferenceControls.CollapsibleCard(Claimed.TransformFold, RowAt(ReferenceCard, ReferenceRows, 4u),
                                          TransformFold, Seated.TransformOpen);
        ReferenceControls.DropdownCard(Claimed.ShadingMenu, RowAt(ReferenceCard, ReferenceRows, 5u),
                                       ShadingMenu, Seated.ShadingTaken);
        ReferenceControls.ColourPicker(Claimed.AlbedoPicker, RowAt(ReferenceCard, ReferenceRows, 6u),
                                       AlbedoPicker, Seated.Albedo);

        // ⑫ One identity-backed outline. A drop's destination is declared here; document ownership stays outside
        //     the panel exactly as it does for selection and visibility.
        for (std::uint32_t RecordOrdinal = 0u; RecordOrdinal < 5u; ++RecordOrdinal)
        {
            OutlineRows[RecordOrdinal].EnclosedCount = 0u;
            if (Seated.OutlineEnclosure[RecordOrdinal] < 5u)
                ++OutlineRows[Seated.OutlineEnclosure[RecordOrdinal]].EnclosedCount;
        }

        std::uint32_t PresentedRecords[5] = {};
        std::uint32_t PresentedCount = 0u;
        const auto LinearizeOutline = [&](auto&& Traverse, std::uint32_t Enclosing, std::uint32_t Depth) -> void
        {
            for (std::uint32_t Position = 0u; Position < 5u; ++Position)
            {
                for (std::uint32_t RecordOrdinal = 0u; RecordOrdinal < 5u; ++RecordOrdinal)
                {
                    if (Seated.OutlineEnclosure[RecordOrdinal] != Enclosing ||
                        Seated.OutlineOrder[RecordOrdinal] != Position)
                        continue;

                    OutlineRows[RecordOrdinal].Depth = Depth;
                    PresentedRecords[PresentedCount++] = RecordOrdinal;
                    Traverse(Traverse, RecordOrdinal, Depth + 1u);
                }
            }
        };
        LinearizeOutline(LinearizeOutline, 5u, 0u);

        float OutlineExpansion[5] = {};
        for (std::uint32_t RecordOrdinal = 0u; RecordOrdinal < 5u; ++RecordOrdinal)
        {
            OutlineExpansion[RecordOrdinal] = ReferenceControls.OutlineExpansion(
                Claimed.OutlineExpansion[RecordOrdinal], Seated.OutlineExpanded[RecordOrdinal],
                OutlineRows[RecordOrdinal].AnimationEnabled);
        }

        float RowPresence[5] = {};
        float OutlineAcross = 0.0f;
        for (std::uint32_t PresentedOrdinal = 0u; PresentedOrdinal < PresentedCount; ++PresentedOrdinal)
        {
            const std::uint32_t RecordOrdinal = PresentedRecords[PresentedOrdinal];
            float Presence = 1.0f;
            std::uint32_t Enclosing = Seated.OutlineEnclosure[RecordOrdinal];
            std::uint32_t WalkCount = 0u;

            while (Enclosing < 5u && WalkCount++ < 5u)
            {
                Presence *= OutlineExpansion[Enclosing];
                Enclosing = Seated.OutlineEnclosure[Enclosing];
            }

            RowPresence[PresentedOrdinal] = Presence;
            OutlineAcross += 28.0f * Presence;
        }

        std::uint32_t DragSource = 5u;
        const float DragAlong = Surface.Pointer().PositionAlong - Ledger.OriginAlong();
        const float DragAcross = Surface.Pointer().PositionAcross - Ledger.OriginAcross();
        const bool DragTravelled = DragAlong * DragAlong + DragAcross * DragAcross >= 16.0f;

        if (DragTravelled)
        {
            for (std::uint32_t RecordOrdinal = 0u; RecordOrdinal < 5u; ++RecordOrdinal)
            {
                const bool BodyHeld = Ledger.Holding(Claimed.OutlineRows[RecordOrdinal]) &&
                                      Ledger.HeldPart(Claimed.OutlineRows[RecordOrdinal]) == ControlPart::Body;
                const bool BodyReleased = Ledger.Released(Claimed.OutlineRows[RecordOrdinal]) &&
                                          Ledger.ReleasedControlPart(Claimed.OutlineRows[RecordOrdinal]) == ControlPart::Body;
                if (BodyHeld || BodyReleased)
                    DragSource = RecordOrdinal;
            }
        }

        const float OutlineRowsAcross[1] = { OutlineAcross };
        const CardArrangement OutlineCard = AdvanceCard(OutlineRowsAcross, 1u);
        float OutlineCursor = OutlineCard.Interior.LeastAcross;
        std::uint32_t DropTarget = 5u;
        OutlineDropPlacement DropPlacement = OutlineDropPlacement::Absent;

        for (std::uint32_t PresentedOrdinal = 0u; PresentedOrdinal < PresentedCount; ++PresentedOrdinal)
        {
            const std::uint32_t RecordOrdinal = PresentedRecords[PresentedOrdinal];
            const float Presence = RowPresence[PresentedOrdinal];
            if (Presence <= 0.0f)
                continue;

            const PlaneExtent Row = Spanning(OutlineCard.Interior.LeastAlong, OutlineCursor,
                                             OutlineCard.Interior.SpanAlong(), 28.0f);
            OutlineDropPlacement RowPlacement = OutlineDropPlacement::Absent;

            if (DragSource < 5u && DragSource != RecordOrdinal &&
                Row.Encloses(Surface.Pointer().PositionAlong, Surface.Pointer().PositionAcross))
            {
                const float RowFraction = (Surface.Pointer().PositionAcross - Row.LeastAcross) / Row.SpanAcross();
                RowPlacement = (RowFraction < 0.25f) ? OutlineDropPlacement::Before
                             : (RowFraction > 0.75f) ? OutlineDropPlacement::After
                                                     : OutlineDropPlacement::Enclosed;
                DropTarget = RecordOrdinal;
                DropPlacement = RowPlacement;
            }

            const PlaneExtent Revealed = Spanning(Row.LeastAlong, Row.LeastAcross,
                                                  Row.SpanAlong(), 28.0f * Presence);
            Surface.Confine(Revealed);
            ReferenceControls.OutlineRow(Claimed.OutlineRows[RecordOrdinal], Row, OutlineRows[RecordOrdinal], true,
                                         OutlineExpansion[RecordOrdinal], RowPlacement,
                                         Seated.OutlineExpanded[RecordOrdinal], Seated.OutlineTaken[RecordOrdinal],
                                         Seated.OutlinePresent[RecordOrdinal]);
            Surface.Release();
            OutlineCursor += 28.0f * Presence;
        }

        if (DragSource < 5u && DropTarget < 5u && Ledger.Released(Claimed.OutlineRows[DragSource]))
        {
            const std::uint32_t ProposedEnclosure = (DropPlacement == OutlineDropPlacement::Enclosed)
                                                   ? DropTarget : Seated.OutlineEnclosure[DropTarget];
            bool CycleDeclared = ProposedEnclosure == DragSource;
            std::uint32_t Walking = ProposedEnclosure;
            std::uint32_t WalkCount = 0u;

            while (!CycleDeclared && Walking < 5u && WalkCount++ < 5u)
            {
                CycleDeclared = Walking == DragSource;
                Walking = Seated.OutlineEnclosure[Walking];
            }

            if (!CycleDeclared)
            {
                const std::uint32_t DepartingEnclosure = Seated.OutlineEnclosure[DragSource];
                const std::uint32_t DepartingOrder = Seated.OutlineOrder[DragSource];
                for (std::uint32_t RecordOrdinal = 0u; RecordOrdinal < 5u; ++RecordOrdinal)
                {
                    if (RecordOrdinal != DragSource && Seated.OutlineEnclosure[RecordOrdinal] == DepartingEnclosure &&
                        Seated.OutlineOrder[RecordOrdinal] > DepartingOrder)
                        --Seated.OutlineOrder[RecordOrdinal];
                }

                std::uint32_t ArrivingOrder = 0u;
                if (DropPlacement == OutlineDropPlacement::Enclosed)
                {
                    Seated.OutlineExpanded[DropTarget] = true;
                }
                else
                {
                    ArrivingOrder = Seated.OutlineOrder[DropTarget];
                    if (DropPlacement == OutlineDropPlacement::After)
                        ++ArrivingOrder;
                }

                for (std::uint32_t RecordOrdinal = 0u; RecordOrdinal < 5u; ++RecordOrdinal)
                {
                    if (RecordOrdinal != DragSource && Seated.OutlineEnclosure[RecordOrdinal] == ProposedEnclosure &&
                        Seated.OutlineOrder[RecordOrdinal] >= ArrivingOrder)
                        ++Seated.OutlineOrder[RecordOrdinal];
                }

                Seated.OutlineEnclosure[DragSource] = ProposedEnclosure;
                Seated.OutlineOrder[DragSource] = ArrivingOrder;
            }
        }

        // ⑬ The revision timeline, presented from newest to oldest.
        const float RevisionRowExtents[3] = { 54.0f, 54.0f, 54.0f };
        const CardArrangement RevisionCard = AdvanceCard(RevisionRowExtents, 3u);

        for (std::uint32_t Ordinal = 0u; Ordinal < 3u; ++Ordinal)
        {
            ReferenceControls.RevisionRow(RowAt(RevisionCard, RevisionRowExtents, Ordinal),
                                          RevisionRows[Ordinal], Ordinal == 0u);
        }

        // ⑭ The reusable editor partition stands inside a workspace-sized page. Its leaf headers, footers,
        //     menus, split rails, resizing and withdrawal are live; scene and UV GPU targets remain skeletal.
        const float EditorAlong = (Display.ExtentAlong - 32.0f < 1152.0f)
                                ? Display.ExtentAlong - 32.0f : 1152.0f;
        const float EditorAcross = (Display.ExtentAcross - 48.0f > 600.0f)
                                 ? Display.ExtentAcross - 48.0f : 600.0f;
        const PlaneExtent EditorExtent = Spanning((Display.ExtentAlong - EditorAlong) * 0.5f,
                                                  Cursor,
                                                  EditorAlong,
                                                  EditorAcross);
        Disregard(EditorPanels.Record(EditorExtent, EditorPartition, EditorOrdinates));
        Cursor = EditorExtent.MostAcross + Measure.CardGapAcross;

        // ⑮ The complete notch Control Centre remains the final full display-sized page.
        const PlaneExtent ControlCentreExtent = Spanning(0.0f, Cursor, Display.ExtentAlong, Display.ExtentAcross);
        Disregard(ControlCentre.Record(ControlCentreExtent, ControlCentreValues));
        Cursor = ControlCentreExtent.MostAcross + Measure.CardGapAcross;

        // 🔴 The deferred sweep — every menu and every tooltip card, above every row recorded above.
        Panel.RecordDeferred();
        Facets.RecordDeferred();

        // 📝 What the page sequence actually occupied, for the next tick's scroll to be held against. The
        //    trailing `py-32` is added so the Control Centre page can be carried clear of the lower edge.
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

            // ⑫ Seal the tick and record it into the recording Await opened.
            // 🔴 The surface is retired at the seal. This host records through it directly rather than
            //    through ViewportSequence, so it performs the retirement ViewportSequence would.
            Surface.Retire();

            if (Interface.Seal().ContentPresent)
            {
                // 🔴 Read. A refused Record presents the cleared ground with nothing on it, which is
                //    indistinguishable from a panel that drew nothing, so the refusal is named here.
                if (!Interface.Record(Pass.Recording))
                {
                    std::printf("%s \u2014 the interface content was not recorded\n", HostName);
                }
            }
            else
            {
                Disregard(Interface.Abandon());
            }
        }

        // ⑬ Close the scope, submit, present, advance. A refused present re-establishes the chain rather
        //    than ending the loop, and a tick whose content declined still presents the cleared ground.
        if (!Lifetime.Surrender().ContentPresent)
            break;
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────
    //                                                      RECLAMATION
    // ─────────────────────────────────────────────────────────────────────────────────────────────────────

    // 📝 The interface content is retired before the lifetimes it was constructed over. HostLifecycle idles
    //    the device inside Reclaim, so nothing here needs to.
    // 🔴 Read before Reclaim. The register is Device lifetime, and a reclaimed device has emptied it.
    const std::uint32_t Serious = Lifetime.StateDiagnostics();

    ControlCentre.Reset();
    EditorPanels.Reset();
    EditorPartition.Reset();
    Facets.Reset();
    ReferenceControls.Reset();
    Panel.Reset();
    Ledger.Reset();
    Surface.Reset();
    Interface.Reclaim();
    Lifetime.Reclaim();

    std::printf("%s \u2014 exited cleanly\n", HostName);

    // 🔴 Returned rather than only stated. This is the host a validation run is driven through, so a
    //    serious arrival has to fail the run and not merely appear in it.
    return (Serious == 0u) ? 0 : 1;
}
