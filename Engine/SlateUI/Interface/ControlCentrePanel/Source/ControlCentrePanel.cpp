//============================================================================================================================================
//                                                      CONTROLCENTREPANEL.CPP
//============================================================================================================================================
// 🧩 Every rendered route of the notch Control Centre, using the default
// ImGui typeface and placeholder symbol.

#include "SlateUI/Interface/ControlCentrePanel/Api/ControlCentrePanel.h"

#include "SlateUI/Interface/SymbolSpecification/Api/SymbolSpecification.h"

#include <cmath>
#include <cstdio>

namespace Slate
{

namespace
{

constexpr InkOrdinate White = Covering(0xFFFFFFu);
constexpr InkOrdinate Black = Covering(0x000000u);
constexpr InkOrdinate QuietDark = Partial(0xFFFFFFu, .08);
constexpr InkOrdinate QuietLight = Partial(0x000000u, .08);
constexpr float PagePad = 32.0f;
constexpr float HeaderAcross = 64.0f;
constexpr float CardGap = 16.0f;
constexpr float RowAcross = 76.0f;
constexpr float TileAcross = 130.0f;
constexpr float DragDuration = 300.0f;

float CentreText(RecordingSurface &Surface, const PlaneExtent &Extent, const char *Text, float Size)
{
    return Extent.LeastAlong + (Extent.SpanAlong() - Surface.MeasureRun(Text, Size)) * 0.5f;
}

float CentredAcross(const PlaneExtent &Extent, float Size)
{
    return Extent.LeastAcross + (Extent.SpanAcross() - Size) * 0.5f;
}

std::uint32_t WrappedText(RecordingSurface &Surface, const PlaneExtent &Extent, InkOrdinate Ink,
                          const char *Text, float Size, bool Record)
{
    char Line[256] = {};
    std::uint32_t LineLength = 0u;
    std::uint32_t LineCount = 0u;
    std::uint32_t Cursor = 0u;

    while (Text[Cursor] != '\0')
    {
        while (Text[Cursor] == ' ') ++Cursor;
        const std::uint32_t WordBegin = Cursor;
        while (Text[Cursor] != '\0' && Text[Cursor] != ' ') ++Cursor;
        const std::uint32_t WordLength = Cursor - WordBegin;
        if (WordLength == 0u) break;

        char Candidate[256] = {};
        std::uint32_t CandidateLength = 0u;
        for (std::uint32_t Ordinal = 0u; Ordinal < LineLength && CandidateLength + 1u < 256u; ++Ordinal)
            Candidate[CandidateLength++] = Line[Ordinal];
        if (CandidateLength > 0u && CandidateLength + 1u < 256u) Candidate[CandidateLength++] = ' ';
        for (std::uint32_t Ordinal = 0u; Ordinal < WordLength && CandidateLength + 1u < 256u; ++Ordinal)
            Candidate[CandidateLength++] = Text[WordBegin + Ordinal];
        Candidate[CandidateLength] = '\0';

        if (LineLength > 0u && Surface.MeasureRun(Candidate, Size) > Extent.SpanAlong())
        {
            if (Record)
                Surface.TextRunTruncated(Extent.LeastAlong,
                                         Extent.LeastAcross + static_cast<float>(LineCount) * (Size + 4.0f),
                                         Extent.MostAlong, Ink, Line, Size);
            ++LineCount;
            LineLength = 0u;
        }

        if (LineLength > 0u && LineLength + 1u < 256u) Line[LineLength++] = ' ';
        for (std::uint32_t Ordinal = 0u; Ordinal < WordLength && LineLength + 1u < 256u; ++Ordinal)
            Line[LineLength++] = Text[WordBegin + Ordinal];
        Line[LineLength] = '\0';
    }

    if (LineLength > 0u)
    {
        if (Record)
            Surface.TextRunTruncated(Extent.LeastAlong,
                                     Extent.LeastAcross + static_cast<float>(LineCount) * (Size + 4.0f),
                                     Extent.MostAlong, Ink, Line, Size);
        ++LineCount;
    }
    return LineCount;
}

InkOrdinate WithOpacity(InkOrdinate Ink, float Fraction)
{
    Ink.Opacity = static_cast<std::uint8_t>(static_cast<float>(Ink.Opacity) * Fraction + .5f);
    return Ink;
}

InkOrdinate Between(InkOrdinate From, InkOrdinate To, float Fraction)
{
    const auto Mix = [Fraction](std::uint8_t First, std::uint8_t Second)
    {
        return static_cast<std::uint8_t>(static_cast<float>(First) +
                                         (static_cast<float>(Second) - static_cast<float>(First)) * Fraction + .5f);
    };
    return {Mix(From.Red, To.Red), Mix(From.Green, To.Green), Mix(From.Blue, To.Blue), Mix(From.Opacity, To.Opacity)};
}

const char *PageCaption(ControlCentrePage Page)
{
    switch (Page)
    {
    case ControlCentrePage::Settings:
        return "Settings";
    case ControlCentrePage::Notifications:
        return "Apps & Notifications";
    case ControlCentrePage::Display:
        return "Display Settings";
    case ControlCentrePage::Input:
        return "Input Devices";
    default:
        return "Control Center";
    }
}

} // namespace

Deliver<bool> ControlCentrePanel::Construct(MotionIntegrator &ArrivingMotion, RecordingSurface &ArrivingSurface,
                                            const AppearanceSpecification &ArrivingAppearance)
{
    if (Motion != nullptr)
        return Deliver<bool>::Refuse(
            {RefusalReason::ContentUnsupported, "a Control Centre construction already stands"});

    Motion = &ArrivingMotion;
    Surface = &ArrivingSurface;
    Appearance = &ArrivingAppearance;

    if (!Interaction.Construct(ArrivingMotion).ContentPresent)
        return Deliver<bool>::Refuse(
            {RefusalReason::ExtentExhausted, "the Control Centre interaction index was refused"});

    if (!SharedControls.Construct(Interaction, ArrivingSurface, ArrivingAppearance).ContentPresent)
        return Deliver<bool>::Refuse(
            {RefusalReason::ContentUnsupported, "the shared Control Centre controls were refused"});

    for (std::uint32_t Ordinal = 0u; Ordinal < ControlCapacity; ++Ordinal)
    {
        const Deliver<ControlIdentity> Issued = Interaction.Enrol();
        if (!Issued.ContentPresent) return Deliver<bool>::Refuse(Issued.Declined);
        Controls[Ordinal] = Issued.Resolve();
    }

    const Deliver<std::uint32_t> PageIssued = ArrivingMotion.EnrolEased(1.0);
    const Deliver<std::uint32_t> TabIssued = ArrivingMotion.EnrolEased(1.0);
    const Deliver<std::uint32_t> ThemeIssued = ArrivingMotion.EnrolEased(1.0);
    const Deliver<std::uint32_t> FontIssued = ArrivingMotion.EnrolEased(1.0);
    if (!PageIssued.ContentPresent || !TabIssued.ContentPresent || !ThemeIssued.ContentPresent ||
        !FontIssued.ContentPresent)
        return Deliver<bool>::Refuse({RefusalReason::ExtentExhausted, "the Control Centre carousel was refused"});

    PageMotion = PageIssued.Resolve();
    TabMotion = TabIssued.Resolve();
    ThemeMotion = ThemeIssued.Resolve();
    FontMotion = FontIssued.Resolve();

    for (std::uint32_t Ordinal = 0u;
         Ordinal < static_cast<std::uint32_t>(ControlCentrePage::PageCount); ++Ordinal)
    {
        const Deliver<std::uint32_t> ScrollIssued = ArrivingMotion.EnrolEased(1.0);
        if (!ScrollIssued.ContentPresent)
            return Deliver<bool>::Refuse({RefusalReason::ExtentExhausted,
                                          "the Control Centre scroll motion was refused"});
        ScrollMotion[Ordinal] = ScrollIssued.Resolve();
    }

    return Deliver<bool>::Deliver(true);
}

void ControlCentrePanel::Advance(const PointerCondition &Arrived, double Elapsed)
{
    Pointer = Arrived;
    Interaction.Advance(Arrived, Elapsed);
    SharedControls.Sample(Arrived);
}

void ControlCentrePanel::RetainExclusion(const PlaneExtent &Extent)
{
    if (ExclusionCount < ControlCapacity)
        Exclusions[ExclusionCount++] = Extent;
}

void ControlCentrePanel::Exclude(DrawerSpace &Drawers) const
{
    for (std::uint32_t Ordinal = 0u; Ordinal < ExclusionCount; ++Ordinal)
        Drawers.Exclude(DrawerBearing::North, Exclusions[Ordinal]);
}

bool ControlCentrePanel::Pressed(std::uint32_t Ordinal, const PlaneExtent &Extent)
{
    if (Ordinal >= ControlCapacity) return false;

    RetainExclusion(Extent);
    const ControlIdentity Claimed = Controls[Ordinal];
    const bool Roused = Extent.Encloses(Pointer.PositionAlong, Pointer.PositionAcross);
    if (Roused && Pointer.ContactArrived && !Interaction.AnyDisclosed()) Interaction.Seize(Claimed, ControlPart::Body);

    Interaction.DeclareRoused(Claimed, Roused, 130.0);
    const bool Quick = Roused && Pointer.ContactArrived && Pointer.ContactReleased;
    return (Interaction.Released(Claimed) && Roused) || Quick;
}

bool ControlCentrePanel::Slider(std::uint32_t Ordinal, const PlaneExtent &Extent, std::uint32_t Least,
                                std::uint32_t Most, std::uint32_t &Reading, const char *UnitGlyph,
                                InkOrdinate Rail, InkOrdinate Accent)
{
    if (Ordinal >= ControlCapacity || Most <= Least) return false;

    RetainExclusion(Extent);
    MagnitudeDeclaration Declared;
    Declared.Caption = "";
    Declared.UnitGlyph = UnitGlyph;
    Declared.LeastOrdinal = static_cast<double>(Least);
    Declared.MostOrdinal = static_cast<double>(Most);

    double Ordinate = static_cast<double>(Reading);
    const ControlVerdict Verdict = SharedControls.MagnitudeRow(Controls[Ordinal], Extent, Declared, Ordinate, true);
    Reading = static_cast<std::uint32_t>(std::round(Ordinate));
    static_cast<void>(Rail);
    static_cast<void>(Accent);
    return Verdict.OrdinateAltered;
}

void ControlCentrePanel::Toggle(std::uint32_t Ordinal, const PlaneExtent &Extent, bool &Enabled, InkOrdinate Quiet,
                                InkOrdinate Accent)
{
    if (Pressed(Ordinal, Extent)) Enabled = !Enabled;

    Interaction.DeclareTaken(Controls[Ordinal], Enabled, 150.0);
    const float Fraction = Interaction.TakenFraction(Controls[Ordinal]);
    Surface->Ground(Extent, Enabled ? Accent : Quiet, Extent.SpanAcross() * .5f, CornerAll);
    Surface->Medallion(Extent.LeastAlong + 12.0f + (Extent.SpanAlong() - 24.0f) * Fraction,
                       Extent.LeastAcross + Extent.SpanAcross() * .5f, 8.0f, White);
}

void ControlCentrePanel::Symbol(const PlaneExtent &Extent, InkOrdinate Ink)
{
    Surface->Stroke(SymbolSubject::PlaceholderMark, Extent, Ink);
}

void ControlCentrePanel::Navigate(ControlCentrePage Arriving)
{
    if (Arriving == PresentedPage || Motion == nullptr) return;
    DepartedPage = PresentedPage;
    PageForward = static_cast<std::uint32_t>(Arriving) >= static_cast<std::uint32_t>(PresentedPage);
    PresentedPage = Arriving;
    Motion->Eased(PageMotion).Depart(0.0, 1.0, DragDuration, 0.0, EaseCurve::Carousel);
}

Deliver<bool> ControlCentrePanel::Record(const PlaneExtent &Interior, ControlCentreOrdinates &Ordinates)
{
    if (Surface == nullptr || Motion == nullptr)
        return Deliver<bool>::Refuse({RefusalReason::CapabilityAbsent, "no Control Centre construction stands"});

    if (Interior.SpanAlong() <= 0.0f || Interior.SpanAcross() <= 0.0f) return Deliver<bool>::Deliver(true);

    ExclusionCount = 0u;
    if (Ordinates.Page != PresentedPage) Navigate(Ordinates.Page);

    if (Ordinates.Theme != PresentedTheme)
    {
        DepartedTheme = PresentedTheme;
        PresentedTheme = Ordinates.Theme;
        Motion->Eased(ThemeMotion).Depart(0.0, 1.0, 500.0, 0.0, EaseCurve::Standard);
    }

    const ThemeDeclaration &FromTheme = ThemeSpecification::Theme(DepartedTheme);
    const ThemeDeclaration &ToTheme = ThemeSpecification::Theme(PresentedTheme);
    const float ThemeFraction = static_cast<float>(Motion->Eased(ThemeMotion).Standing());
    ThemeDeclaration Theme = ToTheme;
    Theme.Ground = Between(FromTheme.Ground, ToTheme.Ground, ThemeFraction);
    Theme.Panel = Between(FromTheme.Panel, ToTheme.Panel, ThemeFraction);
    Theme.Primary = Between(FromTheme.Primary, ToTheme.Primary, ThemeFraction);
    Theme.Secondary = Between(FromTheme.Secondary, ToTheme.Secondary, ThemeFraction);
    Theme.Edge = Between(FromTheme.Edge, ToTheme.Edge, ThemeFraction);
    Theme.Card = Between(FromTheme.Card, ToTheme.Card, ThemeFraction);
    const InkOrdinate Accent = ThemeSpecification::Accent(Ordinates.Primary).Ink;
    Surface->Ground(Interior, Theme.Panel, 0.0f, CornerNone);

    const PlaneExtent SettingsButton = Spanning(Interior.MostAlong - 68.0f, Interior.LeastAcross + 24.0f, 44.0f, 44.0f);
    Surface->Ground(SettingsButton, Theme.Card, 22.0f, CornerAll);
    Surface->Edge(SettingsButton, Theme.Edge, 1.0f, 22.0f, CornerAll);
    Symbol(Spanning(SettingsButton.LeastAlong + 10.0f, SettingsButton.LeastAcross + 10.0f, 24.0f, 24.0f),
           Theme.Primary);
    if (Pressed(0u, SettingsButton))
    {
        Ordinates.Page = ControlCentrePage::Settings;
        Navigate(Ordinates.Page);
    }

    const PlaneExtent PageExtent = {Interior.LeastAlong + PagePad, Interior.LeastAcross + 88.0f,
                                    Interior.MostAlong - PagePad, Interior.MostAcross - 24.0f};
    const std::uint32_t PageOrdinal = static_cast<std::uint32_t>(PresentedPage);
    const float ScrollCeiling[5] = {120.0f, 80.0f, 260.0f, 1200.0f, 520.0f};
    const float ScrollFraction = static_cast<float>(Motion->Eased(ScrollMotion[PageOrdinal]).Standing());
    Scroll[PageOrdinal] = ScrollDeparted[PageOrdinal] +
                          (ScrollTarget[PageOrdinal] - ScrollDeparted[PageOrdinal]) * ScrollFraction;

    if (PageExtent.Encloses(Pointer.PositionAlong, Pointer.PositionAcross) && Pointer.WheelAcross != 0.0f)
    {
        ScrollDeparted[PageOrdinal] = Scroll[PageOrdinal];
        ScrollTarget[PageOrdinal] -= Pointer.WheelAcross * 72.0f;
        if (ScrollTarget[PageOrdinal] < 0.0f) ScrollTarget[PageOrdinal] = 0.0f;
        if (ScrollTarget[PageOrdinal] > ScrollCeiling[PageOrdinal])
            ScrollTarget[PageOrdinal] = ScrollCeiling[PageOrdinal];
        Motion->Eased(ScrollMotion[PageOrdinal]).Depart(0.0, 1.0, 180.0, 0.0, EaseCurve::CssEase);
    }
    const double Travel = Motion->Eased(PageMotion).Standing();

    auto RenderPage = [&](ControlCentrePage Page, const PlaneExtent &Extent)
    {
        PlaneExtent Scrolled = Extent;
        if (Page != ControlCentrePage::Display)
        {
            const float Offset = Scroll[static_cast<std::uint32_t>(Page)];
            Scrolled.LeastAcross -= Offset;
            Scrolled.MostAcross -= Offset;
        }
        switch (Page)
        {
        case ControlCentrePage::Settings:
            SettingsPage(Scrolled, Ordinates, Theme, Accent);
            break;
        case ControlCentrePage::Notifications:
            NotificationsPage(Scrolled, Ordinates, Theme, Accent);
            break;
        case ControlCentrePage::Display:
            DisplayPage(Scrolled, Ordinates, Theme, Accent);
            break;
        case ControlCentrePage::Input:
            InputPage(Scrolled, Ordinates, Theme, Accent);
            break;
        default:
            DashboardPage(Scrolled, Ordinates, Theme, Accent);
            break;
        }
    };

    Surface->Confine(PageExtent);
    if (!Motion->Eased(PageMotion).Settled)
    {
        const float Direction = PageForward ? 1.0f : -1.0f;
        PlaneExtent Departing = PageExtent;
        PlaneExtent Arriving = PageExtent;
        Departing.LeastAlong -= Direction * static_cast<float>(Travel) * PageExtent.SpanAlong();
        Departing.MostAlong -= Direction * static_cast<float>(Travel) * PageExtent.SpanAlong();
        Arriving.LeastAlong += Direction * static_cast<float>(1.0 - Travel) * PageExtent.SpanAlong();
        Arriving.MostAlong += Direction * static_cast<float>(1.0 - Travel) * PageExtent.SpanAlong();
        RenderPage(DepartedPage, Departing);
        RenderPage(PresentedPage, Arriving);
    }
    else
    {
        RenderPage(PresentedPage, PageExtent);
    }
    Surface->Release();
    return Deliver<bool>::Deliver(true);
}

void ControlCentrePanel::DashboardPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates,
                                       const ThemeDeclaration &Theme, InkOrdinate Accent)
{
    const float ContentAlong = (Extent.SpanAlong() < 1024.0f) ? Extent.SpanAlong() : 1024.0f;
    const float Start = Extent.LeastAlong + (Extent.SpanAlong() - ContentAlong) * .5f;
    const float LeftAlong = ContentAlong / 3.0f - 20.0f;
    const PlaneExtent Left = Spanning(Start, Extent.LeastAcross, LeftAlong, Extent.SpanAcross());
    const PlaneExtent Right =
        Spanning(Start + LeftAlong + 48.0f, Extent.LeastAcross, ContentAlong - LeftAlong - 48.0f, Extent.SpanAcross());
    Surface->TextRun(Left.LeastAlong + 8.0f, Left.LeastAcross, Theme.Primary, "Control Center", 20.0f, 0.0f, true);

    const char *QualityNames[5] = {"Low", "Medium", "High", "Epic", "Cinematic"};
    const char *AntialiasNames[3] = {"TSAA", "Basic", "None"};
    char LabelRuns[5][64] = {};
    std::snprintf(LabelRuns[0], sizeof(LabelRuns[0]), "Quality: %s", QualityNames[Ordinates.Quality % 5u]);
    std::snprintf(LabelRuns[1], sizeof(LabelRuns[1]), "VSync: %s", Ordinates.VsyncEnabled ? "ON" : "OFF");
    std::snprintf(LabelRuns[2], sizeof(LabelRuns[2]), "Global Illumination: %s",
                  Ordinates.IlluminationEnabled ? "ON" : "OFF");
    std::snprintf(LabelRuns[3], sizeof(LabelRuns[3]), "Notifications: %s",
                  Ordinates.NotificationsEnabled ? "ON" : "OFF");
    std::snprintf(LabelRuns[4], sizeof(LabelRuns[4]), "AA: %s", AntialiasNames[Ordinates.Antialiasing % 3u]);
    for (std::uint32_t Ordinal = 0u; Ordinal < 5u; ++Ordinal)
    {
        const float Column = static_cast<float>(Ordinal % 2u);
        const float Row = static_cast<float>(Ordinal / 2u);
        const PlaneExtent Tile =
            Spanning(Left.LeastAlong + Column * (Left.SpanAlong() * .5f + 4.0f),
                     Left.LeastAcross + 42.0f + Row * (TileAcross + 16.0f), Left.SpanAlong() * .5f - 8.0f, TileAcross);
        const bool Active = Ordinal == 0u ||
                            (Ordinal == 1u && Ordinates.VsyncEnabled) ||
                            (Ordinal == 2u && Ordinates.IlluminationEnabled) ||
                            (Ordinal == 3u && Ordinates.NotificationsEnabled) ||
                            (Ordinal == 4u && Ordinates.Antialiasing != 2u);
        Surface->Ground(Tile, Active ? Accent : Theme.Card, static_cast<float>(Ordinates.Radius), CornerAll);
        Surface->Edge(Tile, Theme.Edge, 1.0f, static_cast<float>(Ordinates.Radius), CornerAll);
        Symbol(Spanning(Tile.LeastAlong + Tile.SpanAlong() * .5f - 18.0f, Tile.LeastAcross + 24.0f, 36.0f, 36.0f),
               Active ? White : Theme.Secondary);
        Surface->TextRunTruncated(Tile.LeastAlong + 10.0f, Tile.MostAcross - 32.0f, Tile.MostAlong - 10.0f,
                                  Active ? White : Theme.Secondary, LabelRuns[Ordinal], 12.0f, true);
        if (Pressed(10u + Ordinal, Tile))
        {
            if (Ordinal == 0u) Ordinates.Quality = (Ordinates.Quality + 1u) % 5u;
            if (Ordinal == 1u) Ordinates.VsyncEnabled = !Ordinates.VsyncEnabled;
            if (Ordinal == 2u) Ordinates.IlluminationEnabled = !Ordinates.IlluminationEnabled;
            if (Ordinal == 3u) Ordinates.NotificationsEnabled = !Ordinates.NotificationsEnabled;
            if (Ordinal == 4u) Ordinates.Antialiasing = (Ordinates.Antialiasing + 1u) % 3u;
        }
    }

    const PlaneExtent Monitor =
        Spanning(Left.LeastAlong, Left.LeastAcross + 42.0f + 3.0f * (TileAcross + 16.0f), Left.SpanAlong(), 64.0f);
    Surface->Ground(Monitor, Theme.Card, static_cast<float>(Ordinates.Radius), CornerAll);
    Symbol(Spanning(Monitor.LeastAlong + 22.0f, Monitor.LeastAcross + 22.0f, 20.0f, 20.0f), Theme.Secondary);
    Slider(21u, Spanning(Monitor.LeastAlong + 58.0f, Monitor.LeastAcross + 12.0f,
                         Monitor.SpanAlong() - 76.0f, 40.0f),
           0u, 100u, Ordinates.MonitorLevel, "%", Theme.Edge, Accent);

    Surface->TextRun(Right.LeastAlong + 8.0f, Right.LeastAcross, Theme.Primary, "Notifications", 20.0f, 0.0f, true);
    const PlaneExtent Clear = Spanning(Right.MostAlong - 110.0f, Right.LeastAcross - 4.0f, 110.0f, 30.0f);
    Surface->TextRun(Clear.LeastAlong, CentredAcross(Clear, 12.0f), Accent, "Clear messages", 12.0f);
    if (Pressed(20u, Clear)) Ordinates.NotificationsPresent = false;

    if (!Ordinates.NotificationsPresent)
    {
        Symbol(Spanning(Right.LeastAlong + Right.SpanAlong() * .5f - 24.0f, Right.LeastAcross + 120.0f, 48.0f, 48.0f),
               WithOpacity(Theme.Secondary, .25f));
        Surface->TextRun(CentreText(*Surface, Right, "You're all caught up.", 14.0f), Right.LeastAcross + 184.0f,
                         Theme.Secondary, "You're all caught up.", 14.0f);
        return;
    }

    const char *Titles[4] = {"Storage Almost Full", "High Memory Usage", "System Update", "New Message"};
    const char *Times[4] = {"Just now", "2m ago", "10m ago", "1h ago"};
    const char *Descriptions[4] = {"You have used 95% of your allocated cloud storage. Please upgrade your "
                                   "plan to avoid data loss.",
                                   "System memory is running high. Consider closing unused applications to "
                                   "improve performance.",
                                   "A new software update is available for your workspace. This includes "
                                   "security patches and performance improvements.",
                                   "Hey, are we still on for the design review tomorrow? I have some new "
                                   "mockups to share."};
    float NotificationCursor = Right.LeastAcross + 42.0f;
    for (std::uint32_t Ordinal = 0u; Ordinal < 4u; ++Ordinal)
    {
        const PlaneExtent DescriptionMeasure = {Right.LeastAlong + 76.0f, 0.0f,
                                                Right.MostAlong - 20.0f, 0.0f};
        const std::uint32_t DescriptionLines = WrappedText(*Surface, DescriptionMeasure, Theme.Secondary,
                                                           Descriptions[Ordinal], 13.0f, false);
        const float RequiredHeight = 71.0f + static_cast<float>(DescriptionLines) * 17.0f;
        const float CardHeight = RequiredHeight > 102.0f ? RequiredHeight : 102.0f;
        const PlaneExtent Card = Spanning(Right.LeastAlong, NotificationCursor, Right.SpanAlong(), CardHeight);
        Surface->Ground(Card, Theme.Card, static_cast<float>(Ordinates.Radius), CornerAll);
        Surface->Edge(Card, Theme.Edge, 1.0f, static_cast<float>(Ordinates.Radius), CornerAll);
        Surface->Medallion(Card.LeastAlong + 36.0f, Card.LeastAcross + 38.0f, 24.0f, WithOpacity(Accent, .12f));
        Symbol(Spanning(Card.LeastAlong + 24.0f, Card.LeastAcross + 26.0f, 24.0f, 24.0f), Accent);

        const float TimeAlong = Surface->MeasureRun(Times[Ordinal], 12.0f);
        Surface->TextRunTruncated(Card.LeastAlong + 76.0f, Card.LeastAcross + 18.0f,
                                  Card.MostAlong - TimeAlong - 36.0f,
                                  Ordinal < 3u ? Accent : Theme.Primary, Titles[Ordinal], 16.0f, true);
        Surface->TextRun(Card.MostAlong - TimeAlong - 20.0f, Card.LeastAcross + 20.0f,
                         Theme.Secondary, Times[Ordinal], 12.0f);

        const PlaneExtent DescriptionClip = {Card.LeastAlong + 76.0f, Card.LeastAcross + 51.0f,
                                             Card.MostAlong - 20.0f, Card.MostAcross - 16.0f};
        Surface->Confine(DescriptionClip);
        WrappedText(*Surface, DescriptionClip, Theme.Secondary, Descriptions[Ordinal], 13.0f, true);
        Surface->Release();
        NotificationCursor = Card.MostAcross + 16.0f;
    }
}

void ControlCentrePanel::SettingsPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates,
                                      const ThemeDeclaration &Theme, InkOrdinate Accent)
{
    const float Width = (Extent.SpanAlong() < 672.0f) ? Extent.SpanAlong() : 672.0f;
    const float Along = Extent.LeastAlong + (Extent.SpanAlong() - Width) * .5f;
    const PlaneExtent Back = Spanning(Along, Extent.LeastAcross, 42.0f, 42.0f);
    Symbol(Spanning(Back.LeastAlong + 9.0f, Back.LeastAcross + 9.0f, 24.0f, 24.0f), Theme.Primary);
    if (Pressed(30u, Back))
    {
        Ordinates.Page = ControlCentrePage::Dashboard;
        Navigate(Ordinates.Page);
    }
    Surface->TextRun(Along + 58.0f, Extent.LeastAcross + 8.0f, Theme.Primary, "Settings", 24.0f, 0.0f, true);

    const PlaneExtent Card = Spanning(Along, Extent.LeastAcross + 74.0f, Width, 5.0f * RowAcross);
    Surface->Ground(Card, Theme.Card, static_cast<float>(Ordinates.Radius < 16u ? 16u : Ordinates.Radius), CornerAll);
    Surface->Edge(Card, Theme.Edge, 1.0f, static_cast<float>(Ordinates.Radius < 16u ? 16u : Ordinates.Radius),
                  CornerAll);
    const char *Titles[5] = {"Display Settings", "Display & Workspace", "Input Devices", "Privacy & Security",
                             "Apps & Notifications"};
    const char *Subs[5] = {"Appearance, theme, fonts, and system colors", "Resolution, scaling, multiple displays",
                           "Keyboard, mouse, and touch settings", "Permissions, camera access, firewall",
                           "Do not disturb, app permissions"};
    for (std::uint32_t Ordinal = 0u; Ordinal < 5u; ++Ordinal)
    {
        const PlaneExtent Row = Spanning(Card.LeastAlong, Card.LeastAcross + RowAcross * static_cast<float>(Ordinal),
                                         Card.SpanAlong(), RowAcross);
        if (Ordinal < 4u)
            Surface->Ground(Spanning(Row.LeastAlong + 20.0f, Row.MostAcross - 1.0f, Row.SpanAlong() - 40.0f, 1.0f),
                            Theme.Edge, 0.0f, CornerNone);
        Surface->Medallion(Row.LeastAlong + 44.0f, Row.LeastAcross + 38.0f, 24.0f, Theme.Ground);
        Symbol(Spanning(Row.LeastAlong + 32.0f, Row.LeastAcross + 26.0f, 24.0f, 24.0f),
               Ordinal == 0u ? Accent : Theme.Secondary);
        Surface->TextRun(Row.LeastAlong + 82.0f, Row.LeastAcross + 18.0f, Theme.Primary, Titles[Ordinal], 16.0f, 0.0f,
                         true);
        Surface->TextRun(Row.LeastAlong + 82.0f, Row.LeastAcross + 43.0f, Theme.Secondary, Subs[Ordinal], 13.0f);
        Symbol(Spanning(Row.MostAlong - 40.0f, Row.LeastAcross + 28.0f, 20.0f, 20.0f),
               WithOpacity(Theme.Secondary, .5f));
        if (Pressed(31u + Ordinal, Row))
        {
            if (Ordinal <= 1u)
            {
                Ordinates.Page = ControlCentrePage::Display;
                Ordinates.DisplayPage = Ordinal == 0u ? DisplayPreferencePage::Theme : DisplayPreferencePage::Display;
            }
            else if (Ordinal == 2u)
                Ordinates.Page = ControlCentrePage::Input;
            else if (Ordinal == 4u)
                Ordinates.Page = ControlCentrePage::Notifications;
            Navigate(Ordinates.Page);
        }
    }
}

void ControlCentrePanel::NotificationsPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates,
                                           const ThemeDeclaration &Theme, InkOrdinate Accent)
{
    const float Width = (Extent.SpanAlong() < 768.0f) ? Extent.SpanAlong() : 768.0f;
    const float Along = Extent.LeastAlong + (Extent.SpanAlong() - Width) * .5f;
    Surface->TextRun(Along, Extent.LeastAcross, Theme.Primary, "Apps & Notifications", 29.0f, 0.0f, true);
    const PlaneExtent Back = Spanning(Along + Width - 44.0f, Extent.LeastAcross, 40.0f, 40.0f);
    Surface->Ground(Back, Theme.Card, 20.0f, CornerAll);
    Surface->Edge(Back, Theme.Edge, 1.0f, 20.0f, CornerAll);
    Symbol(Spanning(Back.LeastAlong + 10.0f, Back.LeastAcross + 10.0f, 20.0f, 20.0f), Theme.Primary);
    if (Pressed(40u, Back))
    {
        Ordinates.Page = ControlCentrePage::Settings;
        Navigate(Ordinates.Page);
    }

    const PlaneExtent Global = Spanning(Along, Extent.LeastAcross + 66.0f, Width, 176.0f);
    Surface->Ground(Global, Theme.Card, static_cast<float>(Ordinates.Radius < 16u ? 16u : Ordinates.Radius), CornerAll);
    Surface->Edge(Global, Theme.Edge, 1.0f, 20.0f, CornerAll);
    const char *Titles[2] = {"Do Not Disturb", "Notification Sounds"};
    const char *Subs[2] = {"Silence all notifications and alerts", "Play sounds for incoming alerts"};
    bool *Conditions[2] = {&Ordinates.DisturbanceWithheld, &Ordinates.SoundEnabled};
    for (std::uint32_t Ordinal = 0u; Ordinal < 2u; ++Ordinal)
    {
        const PlaneExtent Row =
            Spanning(Global.LeastAlong + 24.0f, Global.LeastAcross + 12.0f + 80.0f * static_cast<float>(Ordinal),
                     Global.SpanAlong() - 48.0f, 72.0f);
        Surface->Medallion(Row.LeastAlong + 24.0f, Row.LeastAcross + 36.0f, 20.0f, WithOpacity(Accent, .10f));
        Symbol(Spanning(Row.LeastAlong + 14.0f, Row.LeastAcross + 26.0f, 20.0f, 20.0f), Accent);
        Surface->TextRun(Row.LeastAlong + 62.0f, Row.LeastAcross + 17.0f, Theme.Primary, Titles[Ordinal], 18.0f, 0.0f,
                         true);
        Surface->TextRun(Row.LeastAlong + 62.0f, Row.LeastAcross + 43.0f, Theme.Secondary, Subs[Ordinal], 13.0f);
        Toggle(41u + Ordinal, Spanning(Row.MostAlong - 48.0f, Row.LeastAcross + 24.0f, 48.0f, 24.0f),
               *Conditions[Ordinal], Theme.Edge, Accent);
    }

    Surface->TextRun(Along + 8.0f, Global.MostAcross + 36.0f, Theme.Primary, "App Permissions", 24.0f, 0.0f, true);
    Surface->TextRun(Along + 8.0f, Global.MostAcross + 68.0f, Theme.Secondary,
                     "Choose which apps can send you notifications", 14.0f);
    const PlaneExtent Apps = Spanning(Along, Global.MostAcross + 100.0f, Width, 4.0f * RowAcross);
    Surface->Ground(Apps, Theme.Card, static_cast<float>(Ordinates.Radius < 16u ? 16u : Ordinates.Radius), CornerAll);
    Surface->Edge(Apps, Theme.Edge, 1.0f, 20.0f, CornerAll);
    const char *AppTitles[4] = {"Mail", "Calendar", "Messages", "System Alerts"};
    const char *AppSubs[4] = {"New emails and calendar invites", "Upcoming events and reminders",
                              "Direct messages and mentions", "Critical system and security updates"};
    for (std::uint32_t Ordinal = 0u; Ordinal < 4u; ++Ordinal)
    {
        const PlaneExtent Row =
            Spanning(Apps.LeastAlong + 20.0f, Apps.LeastAcross + RowAcross * static_cast<float>(Ordinal),
                     Apps.SpanAlong() - 40.0f, RowAcross);
        Symbol(Spanning(Row.LeastAlong + 8.0f, Row.LeastAcross + 26.0f, 24.0f, 24.0f), Theme.Secondary);
        Surface->TextRun(Row.LeastAlong + 52.0f, Row.LeastAcross + 17.0f, Theme.Primary, AppTitles[Ordinal], 16.0f,
                         0.0f, true);
        Surface->TextRun(Row.LeastAlong + 52.0f, Row.LeastAcross + 43.0f, Theme.Secondary, AppSubs[Ordinal], 13.0f);
        Toggle(45u + Ordinal, Spanning(Row.MostAlong - 48.0f, Row.LeastAcross + 26.0f, 48.0f, 24.0f),
               Ordinates.AppNotifications[Ordinal], Theme.Edge, Accent);
    }
}

void ControlCentrePanel::DisplayPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates,
                                     const ThemeDeclaration &Theme, InkOrdinate Accent)
{
    const PlaneExtent Back = Spanning(Extent.LeastAlong, Extent.LeastAcross, 42.0f, 42.0f);
    Surface->Ground(Back, Theme.Card, 21.0f, CornerAll);
    Surface->Edge(Back, Theme.Edge, 1.0f, 21.0f, CornerAll);
    Symbol(Spanning(Back.LeastAlong + 9.0f, Back.LeastAcross + 9.0f, 24.0f, 24.0f), Theme.Primary);
    if (Pressed(50u, Back))
    {
        Ordinates.Page = ControlCentrePage::Settings;
        Navigate(Ordinates.Page);
    }
    Surface->TextRun(Extent.LeastAlong + 58.0f, Extent.LeastAcross + 3.0f, Theme.Primary, "Display Settings", 29.0f,
                     0.0f, true);
    Surface->TextRun(Extent.LeastAlong + 58.0f, Extent.LeastAcross + 40.0f, Theme.Secondary, "Appearance & typography",
                     14.0f);

    if (Ordinates.DisplayPage != PresentedTab)
    {
        DepartedTab = PresentedTab;
        TabForward = static_cast<std::uint32_t>(Ordinates.DisplayPage) >= static_cast<std::uint32_t>(PresentedTab);
        PresentedTab = Ordinates.DisplayPage;
        Motion->Eased(TabMotion).Depart(0.0, 1.0, 220.0, 0.0, EaseCurve::Carousel);
    }

    const char *Tabs[3] = {"Display", "Fonts", "Theme"};
    float TabAlong = Extent.LeastAlong + 58.0f;
    for (std::uint32_t Ordinal = 0u; Ordinal < 3u; ++Ordinal)
    {
        const float Width = Surface->MeasureRun(Tabs[Ordinal], 24.0f) + 8.0f;
        const PlaneExtent Tab = Spanning(TabAlong, Extent.LeastAcross + 78.0f, Width, 42.0f);
        Surface->TextRun(Tab.LeastAlong + 4.0f, Tab.LeastAcross + 4.0f,
                         Ordinates.DisplayPage == static_cast<DisplayPreferencePage>(Ordinal) ? Theme.Primary
                                                                                              : Theme.Secondary,
                         Tabs[Ordinal], 24.0f, 0.0f, true);
        if (Ordinates.DisplayPage == static_cast<DisplayPreferencePage>(Ordinal))
            Surface->Ground(Spanning(Tab.LeastAlong, Tab.MostAcross - 3.0f, Tab.SpanAlong(), 3.0f), Accent, 1.5f,
                            CornerAll);
        if (Pressed(51u + Ordinal, Tab)) Ordinates.DisplayPage = static_cast<DisplayPreferencePage>(Ordinal);
        TabAlong += Width + 24.0f;
    }

    const PlaneExtent Viewport = {Extent.LeastAlong + 58.0f, Extent.LeastAcross + 136.0f, Extent.MostAlong - 16.0f,
                                  Extent.MostAcross};
    const auto RenderTab = [&](DisplayPreferencePage Page, PlaneExtent Content)
    {
        Content.LeastAcross -= Scroll[static_cast<std::uint32_t>(ControlCentrePage::Display)];
        Content.MostAcross -= Scroll[static_cast<std::uint32_t>(ControlCentrePage::Display)];
        if (Page == DisplayPreferencePage::Display)
            DisplayHardwarePage(Content, Ordinates, Theme, Accent);
        else if (Page == DisplayPreferencePage::Theme)
            ThemePage(Content, Ordinates, Theme, Accent);
        else
            FontsPage(Content, Ordinates, Theme, Accent);
    };

    Surface->Confine(Viewport);
    if (!Motion->Eased(TabMotion).Settled)
    {
        const float Travel = static_cast<float>(Motion->Eased(TabMotion).Standing());
        const float Direction = TabForward ? 1.0f : -1.0f;
        PlaneExtent Departing = Viewport;
        PlaneExtent Arriving = Viewport;
        Departing.LeastAlong -= Direction * Travel * Viewport.SpanAlong();
        Departing.MostAlong -= Direction * Travel * Viewport.SpanAlong();
        Arriving.LeastAlong += Direction * (1.0f - Travel) * Viewport.SpanAlong();
        Arriving.MostAlong += Direction * (1.0f - Travel) * Viewport.SpanAlong();
        RenderTab(DepartedTab, Departing);
        RenderTab(PresentedTab, Arriving);
    }
    else
    {
        RenderTab(PresentedTab, Viewport);
    }
    Surface->Release();
}

void ControlCentrePanel::DisplayHardwarePage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates,
                                             const ThemeDeclaration &Theme, InkOrdinate Accent)
{
    const PlaneExtent Card = Spanning(Extent.LeastAlong, Extent.LeastAcross, Extent.SpanAlong(), 440.0f);
    Surface->Ground(Card, Theme.Card, static_cast<float>(Ordinates.Radius < 16u ? 16u : Ordinates.Radius), CornerAll);
    Surface->Edge(Card, Theme.Edge, 1.0f, 20.0f, CornerAll);
    const char *Headings[4] = {"Resolution", "UI Scaling", "Refresh Rate", "Multiple Displays"};
    for (std::uint32_t Ordinal = 0u; Ordinal < 4u; ++Ordinal)
        Surface->TextRun(Card.LeastAlong + 28.0f, Card.LeastAcross + 25.0f + 105.0f * static_cast<float>(Ordinal),
                         Theme.Primary, Headings[Ordinal], 22.0f, 0.0f, true);
    const char *Res[3] = {"1920x1080", "2560x1440", "3840x2160"};
    for (std::uint32_t Ordinal = 0u; Ordinal < 3u; ++Ordinal)
    {
        const PlaneExtent Button = Spanning(Card.LeastAlong + 28.0f + 125.0f * static_cast<float>(Ordinal),
                                            Card.LeastAcross + 58.0f, 114.0f, 38.0f);
        Surface->Ground(Button, Ordinates.Resolution == Ordinal ? Accent : Theme.Panel, 12.0f, CornerAll);
        Surface->Edge(Button, Theme.Edge, 1.0f, 12.0f, CornerAll);
        Surface->TextRun(CentreText(*Surface, Button, Res[Ordinal], 13.0f), CentredAcross(Button, 13.0f),
                         Ordinates.Resolution == Ordinal ? White : Theme.Secondary, Res[Ordinal], 13.0f);
        if (Pressed(60u + Ordinal, Button)) Ordinates.Resolution = Ordinal;
    }
    Slider(63u, Spanning(Card.LeastAlong + 28.0f, Card.LeastAcross + 165.0f, Card.SpanAlong() - 56.0f, 24.0f), 100u,
           200u, Ordinates.Scaling, "%", Theme.Edge, Accent);
    const char *Rates[3] = {"60Hz", "120Hz", "144Hz"};
    const char *Modes[3] = {"Mirror", "Extend", "Second Only"};
    for (std::uint32_t Ordinal = 0u; Ordinal < 3u; ++Ordinal)
    {
        const PlaneExtent Rate = Spanning(Card.LeastAlong + 28.0f + 92.0f * static_cast<float>(Ordinal),
                                          Card.LeastAcross + 270.0f, 82.0f, 38.0f);
        Surface->Ground(Rate, Ordinates.RefreshRate == Ordinal ? QuietDark : Theme.Panel, 12.0f, CornerAll);
        Surface->Edge(Rate, Theme.Edge, 1.0f, 12.0f, CornerAll);
        Surface->TextRun(CentreText(*Surface, Rate, Rates[Ordinal], 13.0f), CentredAcross(Rate, 13.0f), Theme.Primary,
                         Rates[Ordinal], 13.0f);
        if (Pressed(64u + Ordinal, Rate)) Ordinates.RefreshRate = Ordinal;
        const PlaneExtent Mode =
            Spanning(Card.LeastAlong + 28.0f + (Card.SpanAlong() - 56.0f) / 3.0f * static_cast<float>(Ordinal),
                     Card.LeastAcross + 375.0f, (Card.SpanAlong() - 56.0f) / 3.0f, 42.0f);
        Surface->Ground(Mode, Ordinates.MultipleDisplays == Ordinal ? Theme.Card : QuietDark, 12.0f, CornerAll);
        Surface->TextRun(CentreText(*Surface, Mode, Modes[Ordinal], 13.0f), CentredAcross(Mode, 13.0f),
                         Ordinates.MultipleDisplays == Ordinal ? Theme.Primary : Theme.Secondary, Modes[Ordinal],
                         13.0f);
        if (Pressed(67u + Ordinal, Mode)) Ordinates.MultipleDisplays = Ordinal;
    }
}

void ControlCentrePanel::ThemePage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates,
                                   const ThemeDeclaration &Theme, InkOrdinate Accent)
{
    const PlaneExtent Section = Spanning(Extent.LeastAlong, Extent.LeastAcross, Extent.SpanAlong(), 1340.0f);
    Surface->Ground(Section, WithOpacity(Theme.Card, .72f), static_cast<float>(Ordinates.Radius < 24u ? 24u : Ordinates.Radius), CornerAll);
    Surface->Edge(Section, Theme.Edge, 1.0f, static_cast<float>(Ordinates.Radius < 24u ? 24u : Ordinates.Radius), CornerAll);
    const float Inset = 28.0f;
    const float ContentLeast = Extent.LeastAlong + Inset;
    const float ContentMost = Extent.MostAlong - Inset;
    Surface->TextRun(ContentLeast, Extent.LeastAcross + Inset, Theme.Primary, "Theme", 24.0f, 0.0f, true);
    Surface->TextRun(ContentLeast, Extent.LeastAcross + Inset + 32.0f, Theme.Secondary, "Customize UI colors", 14.0f);
    const float AvailableTileWidth = (ContentMost - ContentLeast - 40.0f) / 3.0f;
    const float TileWidth = AvailableTileWidth < 300.0f ? AvailableTileWidth : 300.0f;
    const float TileHeight = TileWidth * (250.0f / 300.0f);
    const float GridWidth = TileWidth * 3.0f + 40.0f;
    const float GridLeast = ContentLeast + (ContentMost - ContentLeast - GridWidth) * 0.5f;
    const InkOrdinate SelectionInk = Covering(0x7B42F6u);

    for (std::uint32_t Ordinal = 0u; Ordinal < 6u; ++Ordinal)
    {
        const ThemeSubject PreviewSubject = static_cast<ThemeSubject>(Ordinal);
        const ThemeDeclaration &Preview = ThemeSpecification::Theme(PreviewSubject);
        const bool WhitePreview = PreviewSubject == ThemeSubject::CleanWhite;
        const InkOrdinate SidebarQuiet = WhitePreview ? Covering(0xDADAE0u) : Preview.PreviewSidebarQuiet;
        const InkOrdinate SidebarStrong = WhitePreview ? Covering(0xC8C8CEu) : Preview.PreviewSidebarStrong;
        const InkOrdinate MainQuiet = WhitePreview ? Covering(0xF0F0F0u) : Preview.PreviewQuiet;
        const InkOrdinate MainStrong = WhitePreview ? Covering(0xE0E0E0u) : Preview.PreviewStrong;
        const float Column = static_cast<float>(Ordinal % 3u);
        const float Row = static_cast<float>(Ordinal / 3u);
        const PlaneExtent Tile = Spanning(GridLeast + Column * (TileWidth + 20.0f),
                                          Extent.LeastAcross + Inset + 64.0f + Row * (TileHeight + 20.0f),
                                          TileWidth, TileHeight);
        const float AlongScale = TileWidth / 300.0f;
        const float AcrossScale = TileHeight / 250.0f;
        const float OuterRadius = static_cast<float>(Ordinates.Radius) * (18.0f / 24.0f) * AlongScale;
        const bool Selected = Ordinates.Theme == static_cast<ThemeSubject>(Ordinal);
        const PlaneExtent Outer = Spanning(Tile.LeastAlong + 15.0f * AlongScale,
                                           Tile.LeastAcross + 15.0f * AcrossScale,
                                           270.0f * AlongScale, 195.0f * AcrossScale);

        if (Selected)
            Surface->Edge(Outer, WithOpacity(SelectionInk, .25f), 4.0f * AlongScale,
                          OuterRadius, CornerAll);
        Surface->Ground(Outer, Preview.PreviewGround, OuterRadius, CornerAll);
        Surface->Edge(Outer, Selected ? SelectionInk : Preview.Edge,
                      (Selected ? 1.5f : 1.0f) * AlongScale, OuterRadius, CornerAll);

        const PlaneExtent Window = Spanning(Tile.LeastAlong + 45.0f * AlongScale,
                                            Tile.LeastAcross + 40.0f * AcrossScale,
                                            210.0f * AlongScale, 150.0f * AcrossScale);
        const float WindowRadius = static_cast<float>(Ordinates.Radius) * (14.0f / 24.0f) * AlongScale;
        Surface->Ground(Window, Preview.PreviewSidebar, WindowRadius, CornerAll);

        const PlaneExtent RightPanel = Spanning(Tile.LeastAlong + 110.0f * AlongScale,
                                                Tile.LeastAcross + 40.0f * AcrossScale,
                                                145.0f * AlongScale, 150.0f * AcrossScale);
        Surface->Ground(RightPanel, Preview.PreviewWindow, WindowRadius, CornerAll);
        Surface->Edge(Window, Preview.Edge, 1.0f, WindowRadius, CornerAll);

        for (std::uint32_t Dot = 0u; Dot < 3u; ++Dot)
            Surface->Medallion(Tile.LeastAlong + (60.0f + 9.0f * static_cast<float>(Dot)) * AlongScale,
                               Tile.LeastAcross + 55.0f * AcrossScale, 2.5f * AlongScale,
                               SidebarStrong);

        const float SidebarWidths[3] = {40.0f, 28.0f, 18.0f};
        for (std::uint32_t Line = 0u; Line < 3u; ++Line)
            Surface->Ground(Spanning(Tile.LeastAlong + 58.0f * AlongScale,
                                     Tile.LeastAcross + (72.0f + 14.0f * static_cast<float>(Line)) * AcrossScale,
                                     SidebarWidths[Line] * AlongScale, 6.0f * AcrossScale),
                            SidebarQuiet, 3.0f * AlongScale, CornerAll);

        Surface->Medallion(Tile.LeastAlong + 63.0f * AlongScale,
                           Tile.LeastAcross + 175.0f * AcrossScale, 5.0f * AlongScale,
                           SidebarStrong);
        Surface->Ground(Spanning(Tile.LeastAlong + 74.0f * AlongScale,
                                 Tile.LeastAcross + 172.0f * AcrossScale,
                                 16.0f * AlongScale, 6.0f * AcrossScale),
                        SidebarQuiet, 3.0f * AlongScale, CornerAll);

        Surface->Ground(Spanning(Tile.LeastAlong + 123.0f * AlongScale,
                                 Tile.LeastAcross + 60.0f * AcrossScale,
                                 45.0f * AlongScale, 6.0f * AcrossScale),
                        MainStrong, 3.0f * AlongScale, CornerAll);
        Surface->Ground(Spanning(Tile.LeastAlong + 123.0f * AlongScale,
                                 Tile.LeastAcross + 75.0f * AcrossScale,
                                 42.0f * AlongScale, 6.0f * AcrossScale),
                        MainStrong, 3.0f * AlongScale, CornerAll);

        for (std::uint32_t Cell = 0u; Cell < 3u; ++Cell)
            Surface->Ground(Spanning(Tile.LeastAlong + (123.0f + 44.0f * static_cast<float>(Cell)) * AlongScale,
                                     Tile.LeastAcross + 95.0f * AcrossScale,
                                     32.0f * AlongScale, 32.0f * AcrossScale),
                            MainQuiet, 8.0f * AlongScale, CornerAll);

        Surface->Ground(Spanning(Tile.LeastAlong + 123.0f * AlongScale,
                                 Tile.LeastAcross + 172.0f * AcrossScale,
                                 26.0f * AlongScale, 6.0f * AcrossScale),
                        MainStrong, 3.0f * AlongScale, CornerAll);

        Surface->TextRun(CentreText(*Surface, Tile, Preview.Caption, 13.0f * AlongScale),
                         Tile.LeastAcross + 222.0f * AcrossScale,
                         Selected ? Theme.Primary : Theme.Secondary,
                         Preview.Caption, 13.0f * AlongScale, .04f, true);
        if (Pressed(75u + Ordinal, Tile)) Ordinates.Theme = static_cast<ThemeSubject>(Ordinal);
    }

    const float Below = Extent.LeastAcross + Inset + 64.0f + 2.0f * (TileHeight + 20.0f) + 16.0f;
    Surface->TextRun(ContentLeast, Below, Theme.Primary, "Corner Radius", 22.0f, 0.0f, true);
    Slider(82u, Spanning(ContentLeast, Below + 48.0f, ContentMost - ContentLeast, 40.0f), 0u, 48u,
           Ordinates.Radius, "px", Theme.Edge, Accent);
    Surface->TextRun(ContentLeast, Below + 100.0f, Theme.Primary, "Sidebar", 22.0f, 0.0f, true);
    Surface->TextRun(ContentLeast, Below + 130.0f, Theme.Secondary, "Make the sidebar transparent", 14.0f);
    Toggle(83u, Spanning(ContentMost - 48.0f, Below + 104.0f, 48.0f, 24.0f), Ordinates.TransparentSidebar,
           Theme.Edge, Accent);

    const float ColoursTop = Below + 184.0f;
    Surface->TextRun(ContentLeast, ColoursTop, Theme.Primary, "System Colors", 24.0f, 0.0f, true);
    Surface->TextRun(ContentLeast, ColoursTop + 32.0f, Theme.Secondary, "Semantic colors for UI elements", 14.0f);
    const char *Names[5] = {"Primary", "Secondary", "Info", "Warning", "Alert"};
    const char *Descriptions[5] = {"Main interactive elements and accents", "Alternative interactive elements",
                                   "Informational messages and badges", "Non-critical alerts and warnings",
                                   "Critical errors and destructive actions"};
    float Cursor = ColoursTop + 70.0f;
    for (std::uint32_t Ordinal = 0u; Ordinal < 5u; ++Ordinal)
    {
        bool Open = OpenPalette == Ordinal;
        const PlaneExtent Header = Spanning(ContentLeast, Cursor, ContentMost - ContentLeast, 58.0f);
        if (Pressed(84u + Ordinal, Header))
        {
            OpenPalette = Open ? 5u : Ordinal;
            Open = OpenPalette == Ordinal;
        }

        Interaction.DeclareTaken(Controls[84u + Ordinal], Open, 220.0, EaseCurve::CssEase);
        const float Disclosure = Interaction.TakenFraction(Controls[84u + Ordinal]);
        const float Height = 58.0f + 68.0f * Disclosure;
        const PlaneExtent Row = Spanning(ContentLeast, Cursor, ContentMost - ContentLeast, Height);
        Surface->Ground(Row, Theme.Card, Ordinal == 0u || Ordinal == 4u ? 16.0f : 0.0f, CornerAll);
        Surface->TextRun(Header.LeastAlong + 20.0f, Header.LeastAcross + 20.0f, Theme.Primary, Names[Ordinal],
                         14.0f, 0.0f, true);
        Surface->Medallion(Header.MostAlong - 48.0f, Header.LeastAcross + 28.0f, 10.0f,
                           ThemeSpecification::Accent(Ordinates.SemanticColours[Ordinal]).Ink);
        Symbol(Spanning(Header.MostAlong - 26.0f, Header.LeastAcross + 20.0f, 16.0f, 16.0f), Theme.Secondary);

        if (Disclosure > 0.0f)
        {
            const PlaneExtent Revealed = {Row.LeastAlong, Header.MostAcross,
                                          Row.MostAlong, Header.MostAcross + 68.0f * Disclosure};
            Surface->Confine(Revealed);
            Surface->TextRun(Row.LeastAlong + 20.0f, Header.MostAcross + 6.0f, Theme.Secondary,
                             Descriptions[Ordinal], 12.0f);
            for (std::uint32_t Colour = 0u; Colour < 8u; ++Colour)
            {
                const PlaneExtent Swatch = Spanning(Row.LeastAlong + 22.0f + 44.0f * static_cast<float>(Colour),
                                                    Header.MostAcross + 26.0f, 32.0f, 32.0f);
                Surface->Ground(Swatch, ThemeSpecification::Accent(static_cast<AccentSubject>(Colour)).Ink,
                                16.0f, CornerAll);
                if (Ordinates.SemanticColours[Ordinal] == static_cast<AccentSubject>(Colour))
                    Surface->Edge(Spanning(Swatch.LeastAlong - 3.0f, Swatch.LeastAcross - 3.0f, 38.0f, 38.0f),
                                  WithOpacity(White, .55f), 2.0f, 19.0f, CornerAll);
                if (Disclosure > .95f && Pressed(90u + Ordinal * 8u + Colour, Swatch))
                {
                    Ordinates.SemanticColours[Ordinal] = static_cast<AccentSubject>(Colour);
                    if (Ordinal == 0u) Ordinates.Primary = static_cast<AccentSubject>(Colour);
                }
            }
            Surface->Release();
        }
        Cursor += Height;
    }
}

void ControlCentrePanel::FontsPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates,
                                   const ThemeDeclaration &Theme, InkOrdinate Accent)
{
    static const char *Fonts[12] = {"Inter",        "General Sans", "JetBrains Mono", "Playfair",
                                    "Merriweather", "Fira Code",    "Roboto",         "Lato",
                                    "Montserrat",   "Nunito",       "Oswald",         "Source Code"};
    const PlaneExtent Section = Spanning(Extent.LeastAlong, Extent.LeastAcross, Extent.SpanAlong(), 1700.0f);
    const float Inset = 28.0f;
    const float ContentLeast = Extent.LeastAlong + Inset;
    const float ContentMost = Extent.MostAlong - Inset;
    Surface->Ground(Section, WithOpacity(Theme.Card, .72f),
                    static_cast<float>(Ordinates.Radius < 24u ? 24u : Ordinates.Radius), CornerAll);
    Surface->Edge(Section, Theme.Edge, 1.0f,
                  static_cast<float>(Ordinates.Radius < 24u ? 24u : Ordinates.Radius), CornerAll);
    Surface->TextRun(ContentLeast, Extent.LeastAcross + Inset, Theme.Primary, "Typography", 24.0f, 0.0f, true);
    Surface->TextRun(ContentLeast, Extent.LeastAcross + Inset + 32.0f, Theme.Secondary, "Typeface & scale", 14.0f);
    const float RailAcross = Extent.LeastAcross + Inset + 64.0f;
    const PlaneExtent Left = Spanning(ContentLeast, RailAcross + 46.0f, 44.0f, 44.0f);
    const PlaneExtent Right = Spanning(ContentMost - 44.0f, RailAcross + 46.0f, 44.0f, 44.0f);
    const PlaneExtent FontRail = {Left.MostAlong + 12.0f, RailAcross,
                                  Right.LeastAlong - 12.0f, RailAcross + 136.0f};

    const float FontFraction = static_cast<float>(Motion->Eased(FontMotion).Standing());
    FontScroll = FontDeparted + (FontTarget - FontDeparted) * FontFraction;
    Surface->Confine(FontRail);
    for (std::uint32_t Ordinal = 0u; Ordinal < 12u; ++Ordinal)
    {
        const PlaneExtent Tile = Spanning(FontRail.LeastAlong + 4.0f +
                                              208.0f * static_cast<float>(Ordinal) - FontScroll,
                                          RailAcross, 192.0f, 132.0f);
        Surface->Ground(Tile, Ordinates.Font == Ordinal ? Theme.Card : Theme.Panel, 16.0f, CornerAll);
        Surface->Edge(Tile, Ordinates.Font == Ordinal ? Theme.Edge : WithOpacity(Theme.Edge, 0.0f), 1.0f,
                      16.0f, CornerAll);
        Surface->TextRun(Tile.LeastAlong + 18.0f, Tile.LeastAcross + 18.0f, Theme.Primary, "Aa", 30.0f);
        Surface->TextRun(Tile.LeastAlong + 18.0f, Tile.LeastAcross + 66.0f, Theme.Primary, Fonts[Ordinal],
                         14.0f, 0.0f, true);
        Surface->TextRun(Tile.LeastAlong + 18.0f, Tile.LeastAcross + 92.0f, Theme.Secondary,
                         "The quick brown fox", 12.0f);
        const PlaneExtent TileContact = {
            Tile.LeastAlong > FontRail.LeastAlong ? Tile.LeastAlong : FontRail.LeastAlong,
            Tile.LeastAcross,
            Tile.MostAlong < FontRail.MostAlong ? Tile.MostAlong : FontRail.MostAlong,
            Tile.MostAcross
        };
        if (TileContact.MostAlong > TileContact.LeastAlong && Pressed(130u + Ordinal, TileContact))
            Ordinates.Font = Ordinal;
    }
    Surface->Release();

    Surface->Ground(Left, Theme.Card, 22.0f, CornerAll);
    Surface->Ground(Right, Theme.Card, 22.0f, CornerAll);
    Surface->Edge(Left, Theme.Edge, 1.0f, 22.0f, CornerAll);
    Surface->Edge(Right, Theme.Edge, 1.0f, 22.0f, CornerAll);
    Surface->TextRun(CentreText(*Surface, Left, "<", 20.0f), CentredAcross(Left, 20.0f),
                     Theme.Primary, "<", 20.0f, 0.0f, true);
    Surface->TextRun(CentreText(*Surface, Right, ">", 20.0f), CentredAcross(Right, 20.0f),
                     Theme.Primary, ">", 20.0f, 0.0f, true);

    const float FontMaximum = 12.0f * 208.0f - FontRail.SpanAlong();
    if (Pressed(142u, Left))
    {
        FontDeparted = FontScroll;
        FontTarget = FontScroll - 250.0f;
        if (FontTarget < 0.0f) FontTarget = 0.0f;
        Motion->Eased(FontMotion).Depart(0.0, 1.0, 250.0, 0.0, EaseCurve::Carousel);
    }
    if (Pressed(143u, Right))
    {
        FontDeparted = FontScroll;
        FontTarget = FontScroll + 250.0f;
        if (FontTarget > FontMaximum) FontTarget = FontMaximum;
        Motion->Eased(FontMotion).Depart(0.0, 1.0, 250.0, 0.0, EaseCurve::Carousel);
    }

    const float SpecimenTop = Extent.LeastAcross + Inset + 230.0f;
    const PlaneExtent Specimen = Spanning(ContentLeast, SpecimenTop, ContentMost - ContentLeast, 176.0f);
    Surface->Ground(Specimen, Theme.Card, static_cast<float>(Ordinates.Radius < 24u ? 24u : Ordinates.Radius),
                    CornerAll);
    Surface->Edge(Specimen, Theme.Edge, 1.0f, 24.0f, CornerAll);
    Surface->TextRun(Specimen.LeastAlong + 32.0f, Specimen.LeastAcross + 25.0f, Theme.Secondary, "TYPEFACE & COLORS",
                     12.0f, .12f);
    Surface->TextRun(Specimen.LeastAlong + 32.0f, Specimen.LeastAcross + 58.0f, Theme.Primary, Fonts[Ordinates.Font],
                     48.0f, 0.0f, true);
    Surface->TextRun(Specimen.MostAlong - 330.0f, Specimen.LeastAcross + 45.0f, Theme.Secondary,
                     "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 13.0f);
    Surface->TextRun(Specimen.MostAlong - 330.0f, Specimen.LeastAcross + 70.0f, Theme.Secondary,
                     "abcdefghijklmnopqrstuvwxyz", 13.0f);
    Surface->TextRun(Specimen.MostAlong - 330.0f, Specimen.LeastAcross + 95.0f, Theme.Secondary, "0123456789", 13.0f);

    static const char *Roles[8] = {"Title", "Header", "Subheader", "Body", "Label", "Caption", "Warning", "Alert"};
    static const std::uint32_t Least[8] = {20u, 16u, 12u, 10u, 8u, 8u, 10u, 10u};
    static const std::uint32_t Most[8] = {64u, 40u, 32u, 24u, 20u, 16u, 24u, 24u};
    float Cursor = Specimen.MostAcross + 30.0f;
    for (std::uint32_t Ordinal = 0u; Ordinal < 8u; ++Ordinal)
    {
        const float PreviewText = static_cast<float>(Ordinates.TypographySize[Ordinal]);
        const float RequiredHeight = PreviewText + 28.0f;
        const float EntryHeight = RequiredHeight > 80.0f ? RequiredHeight : 80.0f;
        const PlaneExtent Entry = Spanning(ContentLeast, Cursor, ContentMost - ContentLeast, EntryHeight);
        Surface->Ground(Entry, Theme.Card, 16.0f, CornerAll);
        Surface->Edge(Entry, Theme.Edge, 1.0f, 16.0f, CornerAll);
        Surface->TextRun(Entry.LeastAlong + 18.0f, Entry.LeastAcross + 12.0f, Theme.Primary,
                         Roles[Ordinal], 16.0f, 0.0f, true);
        Slider(144u + Ordinal,
               Spanning(Entry.LeastAlong + 18.0f, Entry.LeastAcross + Entry.SpanAcross() - 46.0f,
                        420.0f, 40.0f),
               Least[Ordinal], Most[Ordinal], Ordinates.TypographySize[Ordinal], "px", Theme.Edge, Accent);

        const PlaneExtent PreviewClip = {Entry.LeastAlong + 470.0f, Entry.LeastAcross + 10.0f,
                                         Entry.MostAlong - 18.0f, Entry.MostAcross - 10.0f};
        const float PreviewAcross = PreviewClip.LeastAcross +
                                    (PreviewClip.SpanAcross() - PreviewText) * 0.5f;
        Surface->Confine(PreviewClip);
        Surface->TextRunTruncated(PreviewClip.LeastAlong, PreviewAcross, PreviewClip.MostAlong,
                                  Ordinal == 6u   ? ThemeSpecification::Accent(Ordinates.Warning).Ink
                                  : Ordinal == 7u ? ThemeSpecification::Accent(Ordinates.Alert).Ink
                                                  : Theme.Primary,
                                  Ordinal == 4u   ? "METADATA · 10:42 AM · SYSTEM"
                                  : Ordinal == 5u ? "* This is a small caption text"
                                                  : "The quick brown fox jumps over the lazy dog",
                                  PreviewText);
        Surface->Release();
        Cursor = Entry.MostAcross + 12.0f;
    }

    const PlaneExtent IconSection = Spanning(ContentLeast, Cursor - 4.0f,
                                             ContentMost - ContentLeast, 224.0f);
    Surface->Ground(IconSection, Theme.Card, 20.0f, CornerAll);
    Surface->Edge(IconSection, Theme.Edge, 1.0f, 20.0f, CornerAll);
    Surface->TextRun(IconSection.LeastAlong + 20.0f, Cursor + 10.0f, Theme.Primary,
                     "Icon Style", 24.0f, 0.0f, true);
    const char *Styles[3] = {"Monotone", "Duotone", "Coloured"};
    for (std::uint32_t Ordinal = 0u; Ordinal < 3u; ++Ordinal)
    {
        const PlaneExtent B = Spanning(IconSection.LeastAlong + 20.0f +
                                           (IconSection.SpanAlong() - 40.0f) / 3.0f * Ordinal,
                                       Cursor + 52.0f, (IconSection.SpanAlong() - 40.0f) / 3.0f, 42.0f);
        Surface->Ground(B, Ordinates.Icons == static_cast<IconAppearance>(Ordinal) ? Theme.Card : QuietDark, 12.0f,
                        CornerAll);
        Surface->TextRun(CentreText(*Surface, B, Styles[Ordinal], 13.0f), CentredAcross(B, 13.0f), Theme.Primary,
                         Styles[Ordinal], 13.0f);
        if (Pressed(160u + Ordinal, B)) Ordinates.Icons = static_cast<IconAppearance>(Ordinal);
    }
    Cursor += 118.0f;
    Surface->TextRun(IconSection.LeastAlong + 20.0f, Cursor, Theme.Primary, "Icon Font", 24.0f, 0.0f, true);
    Slider(164u, Spanning(IconSection.LeastAlong + 20.0f, Cursor + 40.0f, 420.0f, 40.0f), 16u, 48u,
           Ordinates.IconSize, "px", Theme.Edge, Accent);
    for (std::uint32_t Icon = 0u; Icon < 4u; ++Icon)
        Symbol(Spanning(Extent.MostAlong - 220.0f + 50.0f * Icon, Cursor + 30.0f,
                        static_cast<float>(Ordinates.IconSize), static_cast<float>(Ordinates.IconSize)),
               Theme.Primary);
    Cursor += 124.0f;
    const PlaneExtent AntialiasSection = Spanning(ContentLeast, Cursor - 18.0f,
                                                  ContentMost - ContentLeast, 116.0f);
    Surface->Ground(AntialiasSection, Theme.Card, 20.0f, CornerAll);
    Surface->Edge(AntialiasSection, Theme.Edge, 1.0f, 20.0f, CornerAll);
    Surface->TextRun(AntialiasSection.LeastAlong + 20.0f, Cursor, Theme.Primary,
                     "Font Antialiasing", 24.0f, 0.0f, true);
    const char *Aa[3] = {"Subpixel (Auto)", "Grayscale", "None"};
    for (std::uint32_t Ordinal = 0u; Ordinal < 3u; ++Ordinal)
    {
        const PlaneExtent B = Spanning(AntialiasSection.LeastAlong + 20.0f +
                                           (AntialiasSection.SpanAlong() - 40.0f) / 3.0f * Ordinal,
                                       Cursor + 45.0f, (AntialiasSection.SpanAlong() - 40.0f) / 3.0f, 42.0f);
        Surface->Ground(B, Ordinates.Antialiasing == Ordinal ? Theme.Card : QuietDark, 12.0f, CornerAll);
        Surface->TextRun(CentreText(*Surface, B, Aa[Ordinal], 13.0f), CentredAcross(B, 13.0f), Theme.Primary,
                         Aa[Ordinal], 13.0f);
        if (Pressed(168u + Ordinal, B)) Ordinates.Antialiasing = Ordinal;
    }
}

void ControlCentrePanel::InputPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates,
                                   const ThemeDeclaration &Theme, InkOrdinate Accent)
{
    const float Width = (Extent.SpanAlong() < 768.0f) ? Extent.SpanAlong() : 768.0f;
    const float Along = Extent.LeastAlong + (Extent.SpanAlong() - Width) * .5f;
    Surface->TextRun(Along, Extent.LeastAcross, Theme.Primary, "Input Devices", 29.0f, 0.0f, true);
    Surface->TextRun(Along, Extent.LeastAcross + 38.0f, Theme.Secondary, "Keyboard, mouse, and touch settings", 14.0f);
    const PlaneExtent Back = Spanning(Along + Width - 44.0f, Extent.LeastAcross, 40.0f, 40.0f);
    Surface->Ground(Back, Theme.Card, 20.0f, CornerAll);
    Symbol(Spanning(Back.LeastAlong + 10.0f, Back.LeastAcross + 10.0f, 20.0f, 20.0f), Theme.Primary);
    if (Pressed(172u, Back))
    {
        Ordinates.Page = ControlCentrePage::Settings;
        Navigate(Ordinates.Page);
    }
    const PlaneExtent Hotkeys = Spanning(Along, Extent.LeastAcross + 76.0f, Width, 620.0f);
    Surface->Ground(Hotkeys, Theme.Card, static_cast<float>(Ordinates.Radius < 16u ? 16u : Ordinates.Radius),
                    CornerAll);
    Surface->Edge(Hotkeys, Theme.Edge, 1.0f, 20.0f, CornerAll);
    Surface->TextRun(Hotkeys.LeastAlong + 28.0f, Hotkeys.LeastAcross + 24.0f, Theme.Primary, "Global Hotkeys", 24.0f,
                     0.0f, true);
    const PlaneExtent Preset = Spanning(Hotkeys.MostAlong - 184.0f, Hotkeys.LeastAcross + 19.0f, 156.0f, 34.0f);
    Surface->Ground(Preset, QuietDark, 8.0f, CornerAll);
    Surface->TextRun(Preset.LeastAlong + 12.0f, CentredAcross(Preset, 12.0f), Theme.Primary,
                     ShortcutSpecification::Caption(Ordinates.InputPreset), 12.0f);
    if (Pressed(173u, Preset)) InputPresetOpen = !InputPresetOpen;
    std::uint32_t Count = 0u;
    const ShortcutDeclaration *Shortcuts = ShortcutSpecification::Shortcuts(Ordinates.InputPreset, Count);
    for (std::uint32_t Ordinal = 0u; Ordinal < Count; ++Ordinal)
    {
        const PlaneExtent Row = Spanning(Hotkeys.LeastAlong + 24.0f, Hotkeys.LeastAcross + 76.0f + 62.0f * Ordinal,
                                         Hotkeys.SpanAlong() - 48.0f, 54.0f);
        Surface->Ground(Row, Partial(0xFFFFFFu, .02), 12.0f, CornerAll);
        Surface->Edge(Row, Theme.Edge, 1.0f, 12.0f, CornerAll);
        Surface->TextRun(Row.LeastAlong + 14.0f, Row.LeastAcross + 10.0f, Theme.Primary, Shortcuts[Ordinal].Action,
                         14.0f, 0.0f, true);
        Surface->TextRun(Row.LeastAlong + 14.0f, Row.LeastAcross + 31.0f, Theme.Secondary, Shortcuts[Ordinal].Grouping,
                         11.0f);
        float KeyAlong = Row.MostAlong - 160.0f;
        if (Shortcuts[Ordinal].Chord.ControlEnabled)
        {
            Surface->Ground(Spanning(KeyAlong, Row.LeastAcross + 11.0f, 38.0f, 32.0f), QuietDark, 8.0f, CornerAll);
            Surface->TextRun(KeyAlong + 7.0f, Row.LeastAcross + 21.0f, Theme.Secondary, "Ctrl", 11.0f);
            KeyAlong += 44.0f;
        }
        const PlaneExtent Key = Spanning(KeyAlong, Row.LeastAcross + 11.0f, 96.0f, 32.0f);
        Surface->Ground(Key, QuietDark, 8.0f, CornerAll);
        Surface->Edge(Key, Theme.Edge, 1.0f, 8.0f, CornerAll);
        Surface->TextRun(
            CentreText(*Surface, Key,
                       Ordinates.ListeningShortcut == Ordinal ? "Listening..." : Shortcuts[Ordinal].Chord.Key, 11.0f),
            CentredAcross(Key, 11.0f), Theme.Primary,
            Ordinates.ListeningShortcut == Ordinal ? "Listening..." : Shortcuts[Ordinal].Chord.Key, 11.0f);
        if (!InputPresetOpen && Pressed(174u + Ordinal, Key))
            Ordinates.ListeningShortcut = Ordinates.ListeningShortcut == Ordinal ? 0xFFFFFFFFu : Ordinal;
    }
    const float MouseTop = Hotkeys.MostAcross + 24.0f;
    const PlaneExtent Mouse = Spanning(Along, MouseTop, Width, 150.0f);
    Surface->Ground(Mouse, Theme.Card, 20.0f, CornerAll);
    Surface->TextRun(Mouse.LeastAlong + 28.0f, Mouse.LeastAcross + 24.0f, Theme.Primary, "Mouse Settings", 24.0f, 0.0f,
                     true);
    Surface->TextRun(Mouse.LeastAlong + 28.0f, Mouse.LeastAcross + 72.0f, Theme.Primary, "Invert Scroll Direction",
                     14.0f);
    Toggle(184u, Spanning(Mouse.MostAlong - 76.0f, Mouse.LeastAcross + 64.0f, 48.0f, 24.0f), Ordinates.InvertScroll,
           Theme.Edge, Accent);
    Surface->TextRun(Mouse.LeastAlong + 28.0f, Mouse.LeastAcross + 116.0f, Theme.Primary, "Pointer Speed", 14.0f);
    Slider(185u, Spanning(Mouse.MostAlong - 388.0f, Mouse.LeastAcross + 100.0f, 360.0f, 40.0f), 1u, 10u,
           Ordinates.PointerSpeed, "", Theme.Edge, Accent);
    const PlaneExtent Touch = Spanning(Along, Mouse.MostAcross + 24.0f, Width, 190.0f);
    Surface->Ground(Touch, Theme.Card, 20.0f, CornerAll);
    Surface->TextRun(Touch.LeastAlong + 28.0f, Touch.LeastAcross + 24.0f, Theme.Primary, "Touch & Stylus", 24.0f, 0.0f,
                     true);
    Surface->TextRun(Touch.LeastAlong + 28.0f, Touch.LeastAcross + 72.0f, Theme.Primary, "Enable Touch Gestures",
                     14.0f);
    Toggle(186u, Spanning(Touch.MostAlong - 76.0f, Touch.LeastAcross + 64.0f, 48.0f, 24.0f), Ordinates.TouchGestures,
           Theme.Edge, Accent);
    Surface->TextRun(Touch.LeastAlong + 28.0f, Touch.LeastAcross + 114.0f, Theme.Primary, "Stylus Pressure Sensitivity",
                     14.0f);
    Toggle(187u, Spanning(Touch.MostAlong - 76.0f, Touch.LeastAcross + 106.0f, 48.0f, 24.0f), Ordinates.PressureEnabled,
           Theme.Edge, Accent);
    const char *Actions[3] = {"Orbit", "Pan", "Select"};
    for (std::uint32_t Ordinal = 0u; Ordinal < 3u; ++Ordinal)
    {
        const PlaneExtent B =
            Spanning(Touch.MostAlong - 260.0f + 78.0f * Ordinal, Touch.LeastAcross + 146.0f, 72.0f, 32.0f);
        Surface->Ground(B, Ordinates.TouchAction == Ordinal ? Theme.Card : QuietDark, 8.0f, CornerAll);
        Surface->TextRun(CentreText(*Surface, B, Actions[Ordinal], 11.0f), CentredAcross(B, 11.0f), Theme.Primary,
                         Actions[Ordinal], 11.0f);
        if (Pressed(188u + Ordinal, B)) Ordinates.TouchAction = Ordinal;
    }

    if (InputPresetOpen)
    {
        const PlaneExtent Menu = Spanning(Preset.LeastAlong, Preset.MostAcross + 6.0f, Preset.SpanAlong(), 108.0f);
        Surface->Ground(Menu, Theme.Card, 10.0f, CornerAll);
        Surface->Edge(Menu, Theme.Edge, 1.0f, 10.0f, CornerAll);
        for (std::uint32_t Ordinal = 0u; Ordinal < 3u; ++Ordinal)
        {
            const PlaneExtent Option = Spanning(Menu.LeastAlong + 4.0f, Menu.LeastAcross + 4.0f + 34.0f * Ordinal,
                                                Menu.SpanAlong() - 8.0f, 32.0f);
            if (Ordinates.InputPreset == static_cast<ShortcutPreset>(Ordinal))
                Surface->Ground(Option, QuietDark, 7.0f, CornerAll);
            Surface->TextRun(Option.LeastAlong + 10.0f, CentredAcross(Option, 11.0f), Theme.Primary,
                             ShortcutSpecification::Caption(static_cast<ShortcutPreset>(Ordinal)), 11.0f);
            if (Pressed(120u + Ordinal, Option))
            {
                Ordinates.InputPreset = static_cast<ShortcutPreset>(Ordinal);
                InputPresetOpen = false;
            }
        }
    }
}

void ControlCentrePanel::Reset()
{
    Interaction.Reset();
    Motion = nullptr;
    Surface = nullptr;
    Appearance = nullptr;
    Pointer = {};
    PresentedPage = ControlCentrePage::Dashboard;
    DepartedPage = PresentedPage;
    PageMotion = 0u;
    TabMotion = 0u;
    ThemeMotion = 0u;
    FontMotion = 0u;
    PresentedTheme = ThemeSubject::Oled;
    DepartedTheme = ThemeSubject::Oled;
    for (std::uint32_t Ordinal = 0u;
         Ordinal < static_cast<std::uint32_t>(ControlCentrePage::PageCount); ++Ordinal)
    {
        ScrollMotion[Ordinal] = 0u;
        Scroll[Ordinal] = 0.0f;
        ScrollDeparted[Ordinal] = 0.0f;
        ScrollTarget[Ordinal] = 0.0f;
    }
    FontScroll = 0.0f;
    FontDeparted = 0.0f;
    FontTarget = 0.0f;
    OpenPalette = 5u;
    InputPresetOpen = false;
}

} // namespace Slate
