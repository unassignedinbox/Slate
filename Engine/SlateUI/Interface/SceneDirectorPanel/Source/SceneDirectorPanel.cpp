//============================================================================================================================================
//                                                     SCENEDIRECTORPANEL.CPP
//============================================================================================================================================

#include "SlateUI/Interface/SceneDirectorPanel/Api/SceneDirectorPanel.h"

#include <cstdio>
#include <cstring>
#include <utility>

namespace Slate
{
namespace
{
constexpr InkOrdinate Accent       = Covering(0x4A90E2u);
constexpr InkOrdinate Selection    = Partial(0x1E40AFu, 0.20);
constexpr InkOrdinate Tile         = Covering(0x1D1D21u);
constexpr InkOrdinate TileRoused   = Covering(0x26262Bu);
constexpr InkOrdinate Well         = Covering(0x0A0A0Bu);
constexpr InkOrdinate NumberWell   = Covering(0x131315u);
constexpr InkOrdinate UnitWell     = Covering(0x33333Au);
constexpr InkOrdinate Track        = Covering(0x2F2F33u);
constexpr InkOrdinate TrackFill    = Covering(0x8A8A8Eu);
constexpr InkOrdinate White        = Covering(0xF4F4F5u);
constexpr InkOrdinate Muted        = Covering(0x7B7B82u);
constexpr InkOrdinate Faint        = Covering(0x55555Du);

PlaneExtent Inset(const PlaneExtent& E, float A, float B)
{
    return { E.LeastAlong + A, E.LeastAcross + B, E.MostAlong - A, E.MostAcross - B };
}

InkOrdinate Dimmed(InkOrdinate Ink, bool Dim)
{
    if (Dim)
        Ink.Opacity = static_cast<std::uint8_t>(Ink.Opacity / 2u);
    return Ink;
}
} // namespace

Deliver<bool> SceneDirectorPanel::Construct(RecordingSurface& ArrivingSurface)
{
    if (Surface != nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a scene director construction stands" });

    Surface = &ArrivingSurface;

    Records[0]  = { "Level_01_City",             "level",    0u, 99u, 4u, Covering(0xEAB308u), true,  false };
    Records[1]  = { "Lighting",                  "folder",   1u, 0u,  2u, Covering(0x8A8A8Au), true,  false };
    Records[2]  = { "Directional Light (Sun)",   "light",    2u, 1u,  0u, Covering(0xF59E0Bu), false, false };
    Records[3]  = { "Sky Atmosphere",            "light",    2u, 1u,  0u, Covering(0xF59E0Bu), false, false };
    Records[4]  = { "Player_Start",              "trigger",  1u, 0u,  0u, Covering(0xEF4444u), false, false };
    Records[5]  = { "Main Camera",               "camera",   1u, 0u,  0u, Covering(0xEC4899u), false, false };
    Records[6]  = { "Environment",               "folder",   1u, 0u,  3u, Covering(0x8A8A8Au), true,  false };
    Records[7]  = { "Building_A_Prefab",         "actor",    2u, 6u,  0u, Covering(0x3B82F6u), false, false };
    Records[8]  = { "Building_B_Prefab",         "actor",    2u, 6u,  0u, Covering(0x3B82F6u), false, false };
    Records[9]  = { "Street_Prop_FireHydrant",   "actor",    2u, 6u,  0u, Covering(0x3B82F6u), false, false };
    Records[10] = { "Systems",                   "folder",   1u, 0u,  3u, Covering(0x8A8A8Au), true,  false };
    Records[11] = { "GameManager",               "script",   2u, 10u, 0u, Covering(0x06B6D4u), false, false };
    Records[12] = { "Ambient_City_Noise",        "audio",    2u, 10u, 0u, Covering(0x8B5CF6u), false, false };
    Records[13] = { "Dust_Motes_VFX",            "particle", 2u, 10u, 0u, Covering(0x10B981u), false, false };

    Layers[0] = { "Edge Wear",  "Paint",    "Multiply", 78u,  Covering(0xEAB308u), true,  true,  true,  true };
    Layers[1] = { "Dirt Pass",  "Material", "Overlay",  45u,  Covering(0xEC4899u), true,  false, true,  true };
    Layers[2] = { "Scratches",  "Paint",    "Screen",   60u,  Covering(0x06B6D4u), false, false, false, true };
    Layers[3] = { "Base Metal", "Material", "Normal",   100u, Covering(0x3B82F6u), true,  false, false, true };
    LayerDisclosure[0] = 1.0f;
    return Deliver<bool>::Deliver(true);
}

void SceneDirectorPanel::Advance(const PointerCondition& Arrived, double ElapsedMilliseconds)
{
    Pointer = Arrived;
    Elapsed = ElapsedMilliseconds;
    const float Step = static_cast<float>(ElapsedMilliseconds / 180.0);
    for (std::uint32_t I = 0u; I < LayerCount; ++I)
    {
        const float Target = Layers[I].Expanded ? 1.0f : 0.0f;
        if (LayerDisclosure[I] < Target)
            LayerDisclosure[I] = (LayerDisclosure[I] + Step < Target) ? LayerDisclosure[I] + Step : Target;
        else if (LayerDisclosure[I] > Target)
            LayerDisclosure[I] = (LayerDisclosure[I] - Step > Target) ? LayerDisclosure[I] - Step : Target;
    }
    InspectorArrival = (InspectorArrival + Step < 1.0f) ? InspectorArrival + Step : 1.0f;
}

bool SceneDirectorPanel::Pressed(const PlaneExtent& Extent) const
{
    return Pointer.ContactReleased && Extent.Encloses(Pointer.PositionAlong, Pointer.PositionAcross);
}

bool SceneDirectorPanel::Roused(const PlaneExtent& Extent) const
{
    return Extent.Encloses(Pointer.PositionAlong, Pointer.PositionAcross);
}

void SceneDirectorPanel::Symbol(const PlaneExtent& Extent, InkOrdinate Ink, float Turn)
{
    Surface->Stroke(SymbolSubject::PlaceholderMark, Extent, Ink, Turn);
}

void SceneDirectorPanel::Header(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates,
                                const ThemeDeclaration& Theme)
{
    Surface->Ground(Extent, Theme.Panel);
    Surface->Edge(Extent, Theme.Edge, 1.0f, 0.0f, CornerNone);
    Symbol(Spanning(Extent.LeastAlong + 14.0f, Extent.LeastAcross + 9.0f, 18.0f, 18.0f), Accent);
    Surface->TextRun(42.0f + Extent.LeastAlong, Extent.LeastAcross + 10.0f, Theme.Primary,
                     Ordinates.Presentation == DirectorPresentation::Scene ? "World Editor" : "Texture Paint",
                     12.5f, 0.0f, true);
    Surface->TextRun(142.0f + Extent.LeastAlong, Extent.LeastAcross + 11.0f, Theme.Secondary,
                     Ordinates.Presentation == DirectorPresentation::Scene ? "Level_01_City.map" : "Suzanne.paint",
                     11.0f);

    const float ChoiceAlong = Extent.MostAlong - 430.0f;
    const char* Captions[2] = { "Scene Director", "Texture Paint" };
    for (std::uint32_t I = 0u; I < 2u; ++I)
    {
        const PlaneExtent Choice = Spanning(ChoiceAlong + static_cast<float>(I) * 112.0f,
                                            Extent.LeastAcross + 5.0f, 106.0f, 26.0f);
        const bool Taken = static_cast<std::uint32_t>(Ordinates.Presentation) == I;
        Surface->Ground(Choice, Taken ? Accent : Theme.Card, 7.0f, CornerAll);
        Surface->Edge(Choice, Taken ? Accent : Theme.Edge, 1.0f, 7.0f, CornerAll);
        Surface->TextRun(Choice.LeastAlong + 10.0f, Choice.LeastAcross + 7.0f,
                         Taken ? White : Theme.Secondary, Captions[I], 10.5f, 0.0f, Taken);
        if (Pressed(Choice))
            Ordinates.Presentation = static_cast<DirectorPresentation>(I);
    }

    const PlaneExtent ThemeChoice = Spanning(Extent.MostAlong - 190.0f, Extent.LeastAcross + 5.0f, 176.0f, 26.0f);
    Surface->Ground(ThemeChoice, Theme.Card, 7.0f, CornerAll);
    Surface->Edge(ThemeChoice, Theme.Edge, 1.0f, 7.0f, CornerAll);
    char ThemeRun[64] = {};
    std::snprintf(ThemeRun, sizeof(ThemeRun), "Theme: %s", Theme.Caption);
    Surface->TextRun(ThemeChoice.LeastAlong + 11.0f, ThemeChoice.LeastAcross + 7.0f, Theme.Primary, ThemeRun, 10.5f);
    Symbol(Spanning(ThemeChoice.MostAlong - 20.0f, ThemeChoice.LeastAcross + 7.0f, 12.0f, 12.0f), Theme.Secondary);
    if (Pressed(ThemeChoice))
    {
        const std::uint32_t Next = (static_cast<std::uint32_t>(Ordinates.Theme) + 1u) %
                                   static_cast<std::uint32_t>(ThemeSubject::SubjectCount);
        Ordinates.Theme = static_cast<ThemeSubject>(Next);
    }
}

Deliver<bool> SceneDirectorPanel::Record(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates)
{
    if (Surface == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no scene director construction stands" });

    const ThemeDeclaration& Theme = ThemeSpecification::Theme(Ordinates.Theme);
    if (PresentedRecord != Ordinates.SelectedRecord || PresentedLayer != Ordinates.SelectedLayer)
    {
        PresentedRecord = Ordinates.SelectedRecord;
        PresentedLayer = Ordinates.SelectedLayer;
        InspectorArrival = 0.0f;
    }
    Surface->Ground(Extent, Theme.Ground);
    const PlaneExtent Top = Spanning(Extent.LeastAlong, Extent.LeastAcross, Extent.SpanAlong(), 36.0f);
    Header(Top, Ordinates, Theme);
    const PlaneExtent Body = { Extent.LeastAlong, Top.MostAcross, Extent.MostAlong, Extent.MostAcross };
    if (Ordinates.Presentation == DirectorPresentation::Scene)
        ScenePresentation(Body, Ordinates, Theme);
    else
        TexturePresentation(Body, Ordinates, Theme);
    return Deliver<bool>::Deliver(true);
}

void SceneDirectorPanel::ScenePresentation(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates,
                                           const ThemeDeclaration& Theme)
{
    float OutlineAlong = 350.0f;
    if (Extent.SpanAlong() < 760.0f)
        OutlineAlong = Extent.SpanAlong() * 0.46f;
    Outliner(Spanning(Extent.LeastAlong, Extent.LeastAcross, OutlineAlong, Extent.SpanAcross()), Ordinates, Theme);
    Inspector({ Extent.LeastAlong + OutlineAlong, Extent.LeastAcross, Extent.MostAlong, Extent.MostAcross }, Ordinates, Theme);
}

void SceneDirectorPanel::Outliner(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates,
                                  const ThemeDeclaration& Theme)
{
    Surface->Ground(Extent, Theme.Panel);
    Surface->Edge(Extent, Theme.Edge, 1.0f, 0.0f, CornerNone);
    const PlaneExtent Head = Spanning(Extent.LeastAlong, Extent.LeastAcross, Extent.SpanAlong(), 46.0f);
    Surface->Ground(Head, Theme.Panel);
    Surface->Edge(Head, Theme.Edge, 1.0f, 0.0f, CornerNone);
    const PlaneExtent Badge = Spanning(Head.LeastAlong + 10.0f, Head.LeastAcross + 11.0f, 24.0f, 24.0f);
    Surface->Ground(Badge, Accent, 6.0f, CornerAll);
    Symbol(Inset(Badge, 5.0f, 5.0f), White);
    Surface->TextRun(44.0f + Head.LeastAlong, Head.LeastAcross + 8.0f, Theme.Primary, "World Outliner", 12.5f, 0.0f, true);
    Surface->TextRun(44.0f + Head.LeastAlong, Head.LeastAcross + 27.0f, Theme.Secondary, "Level_01_City", 10.0f);

    const PlaneExtent Search = Spanning(Extent.LeastAlong + 8.0f, Head.MostAcross + 8.0f, Extent.SpanAlong() - 16.0f, 30.0f);
    Surface->Ground(Search, Theme.Card, 6.0f, CornerAll);
    Surface->Edge(Search, Roused(Search) ? Accent : Theme.Edge, 1.0f, 6.0f, CornerAll);
    Symbol(Spanning(Search.LeastAlong + 10.0f, Search.LeastAcross + 8.0f, 14.0f, 14.0f), Theme.Secondary);
    Surface->TextRun(Search.LeastAlong + 32.0f, Search.LeastAcross + 8.0f, Faint, "Filter Entities...", 12.0f);

    float Across = Search.MostAcross + 5.0f;
    for (std::uint32_t I = 0u; I < 14u; ++I)
    {
        bool Visible = true;
        std::uint32_t Enclosing = Records[I].Enclosing;
        while (Enclosing < 14u)
        {
            if (!Records[Enclosing].Expanded)
                Visible = false;
            Enclosing = Records[Enclosing].Enclosing;
        }
        if (!Visible)
            continue;

        const PlaneExtent Row = Spanning(Extent.LeastAlong + 8.0f, Across, Extent.SpanAlong() - 16.0f, 32.0f);
        const bool Taken = Ordinates.SelectedRecord == I;
        if (Taken || Roused(Row))
            Surface->Ground(Row, Taken ? Selection : Partial(0xFFFFFFu, 0.045), 6.0f, CornerAll);
        if (Taken)
            Surface->Ground(Spanning(Row.LeastAlong - 7.0f, Row.LeastAcross + 8.5f, 3.0f, 15.0f), Accent, 1.5f, CornerAll);

        const float Indent = 8.0f + static_cast<float>(Records[I].Depth) * 15.0f;
        if (Records[I].NestedCount > 0u)
        {
            const PlaneExtent Disclosure = Spanning(Row.LeastAlong + Indent, Row.LeastAcross + 9.0f, 14.0f, 14.0f);
            Symbol(Disclosure, Dimmed(Theme.Secondary, Records[I].Hidden), Records[I].Expanded ? 0.0f : -1.5708f);
            if (Pressed(Disclosure))
                Records[I].Expanded = !Records[I].Expanded;
        }
        const PlaneExtent Glyph = Spanning(Row.LeastAlong + Indent + 22.0f, Row.LeastAcross + 7.0f, 18.0f, 18.0f);
        Symbol(Glyph, Dimmed(Records[I].Hue, Records[I].Hidden));
        Surface->TextRunTruncated(Glyph.MostAlong + 7.0f, Row.LeastAcross + 9.0f, Row.MostAlong - 50.0f,
                                  Dimmed(Taken ? Theme.Primary : Theme.Secondary, Records[I].Hidden),
                                  Records[I].Caption, 12.5f, Taken);
        if (Records[I].NestedCount > 0u)
        {
            char Count[8] = {};
            std::snprintf(Count, sizeof(Count), "%u", Records[I].NestedCount);
            Surface->TextRun(Row.MostAlong - 44.0f, Row.LeastAcross + 10.0f, Faint, Count, 10.0f);
        }
        const PlaneExtent Presence = Spanning(Row.MostAlong - 24.0f, Row.LeastAcross + 6.0f, 20.0f, 20.0f);
        if (Records[I].Hidden || Roused(Row))
            Symbol(Inset(Presence, 3.0f, 3.0f), Records[I].Hidden ? Faint : Theme.Secondary);
        if (Pressed(Presence))
        {
            const bool Arriving = !Records[I].Hidden;
            Records[I].Hidden = Arriving;
            for (std::uint32_t J = I + 1u; J < 14u; ++J)
            {
                std::uint32_t Parent = Records[J].Enclosing;
                while (Parent < 14u && Parent != I)
                    Parent = Records[Parent].Enclosing;
                if (Parent == I)
                    Records[J].Hidden = Arriving;
            }
        }
        else if (Pressed(Row))
            Ordinates.SelectedRecord = I;
        Across += 32.0f;
    }

    const PlaneExtent Foot = Spanning(Extent.LeastAlong, Extent.MostAcross - 26.0f, Extent.SpanAlong(), 26.0f);
    Surface->Ground(Foot, Theme.Card);
    Surface->Edge(Foot, Theme.Edge, 1.0f, 0.0f, CornerNone);
    Surface->TextRun(Foot.LeastAlong + 10.0f, Foot.LeastAcross + 8.0f, Theme.Primary, "14", 10.0f, 0.0f, true);
    Surface->TextRun(Foot.LeastAlong + 29.0f, Foot.LeastAcross + 8.0f, Theme.Secondary, "entities", 10.0f);
}

void SceneDirectorPanel::Inspector(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates,
                                   const ThemeDeclaration& Theme)
{
    Surface->Ground(Extent, Theme.Panel);
    const SceneRecord& Selected = Records[Ordinates.SelectedRecord < 14u ? Ordinates.SelectedRecord : 0u];
    const PlaneExtent Head = Spanning(Extent.LeastAlong, Extent.LeastAcross, Extent.SpanAlong(), 46.0f);
    Surface->Ground(Head, Theme.Panel);
    Surface->Edge(Head, Theme.Edge, 1.0f, 0.0f, CornerNone);
    const PlaneExtent Badge = Spanning(Head.LeastAlong + 10.0f, Head.LeastAcross + 11.0f, 24.0f, 24.0f);
    Surface->Ground(Badge, Well, 6.0f, CornerAll);
    Surface->Edge(Badge, Theme.Edge, 1.0f, 6.0f, CornerAll);
    Symbol(Inset(Badge, 5.0f, 5.0f), Selected.Hue);
    Surface->TextRunTruncated(Badge.MostAlong + 8.0f, Head.LeastAcross + 8.0f, Head.MostAlong - 12.0f,
                              Theme.Primary, Selected.Caption, 12.5f, true);
    char Classification[48] = {};
    std::snprintf(Classification, sizeof(Classification), "%s Entity", Selected.Classification);
    Surface->TextRun(Badge.MostAlong + 8.0f, Head.LeastAcross + 27.0f, Selected.Hue, Classification, 10.0f);

    const PlaneExtent Tabs = Spanning(Extent.LeastAlong + 8.0f, Head.MostAcross + 7.0f, Extent.SpanAlong() - 16.0f, 30.0f);
    const char* Names[2] = { "Properties", "History" };
    for (std::uint32_t I = 0u; I < 2u; ++I)
    {
        const PlaneExtent Tab = Spanning(Tabs.LeastAlong + static_cast<float>(I) * Tabs.SpanAlong() * 0.5f,
                                         Tabs.LeastAcross, Tabs.SpanAlong() * 0.5f, Tabs.SpanAcross());
        const bool Taken = static_cast<std::uint32_t>(Ordinates.Inspector) == I;
        Surface->Ground(Tab, Taken ? Tile : Theme.Card, 7.0f, CornerAll);
        Surface->TextRun(Tab.LeastAlong + 12.0f, Tab.LeastAcross + 8.0f, Taken ? Theme.Primary : Theme.Secondary,
                         Names[I], 11.0f, 0.0f, Taken);
        if (Taken)
            Surface->Ground(Spanning(Tab.LeastAlong + 8.0f, Tab.MostAcross - 2.0f, Tab.SpanAlong() - 16.0f, 2.0f), Accent);
        if (Pressed(Tab))
            Ordinates.Inspector = static_cast<DirectorInspector>(I);
    }
    const float ArrivalLift = (1.0f - InspectorArrival) * 8.0f;
    const PlaneExtent Body = { Extent.LeastAlong, Tabs.MostAcross + 6.0f + ArrivalLift,
                               Extent.MostAlong, Extent.MostAcross };
    if (Ordinates.Inspector == DirectorInspector::Properties)
        Properties(Body, Selected, Theme);
    else
        Revisions(Body, Selected, Theme);
}

void SceneDirectorPanel::Field(const PlaneExtent& Extent, const char* Caption, const char* Reading, const char* Unit,
                               const ThemeDeclaration& Theme, float Fraction)
{
    Surface->TextRun(Extent.LeastAlong, Extent.LeastAcross + 10.0f, Theme.Secondary, Caption, 11.5f);
    const PlaneExtent Box = { Extent.LeastAlong + 90.0f, Extent.LeastAcross + 3.0f, Extent.MostAlong, Extent.MostAcross - 3.0f };
    Surface->Ground(Box, Well, 12.0f, CornerAll);
    if (Fraction >= 0.0f)
    {
        const PlaneExtent TrackExtent = Spanning(Box.LeastAlong + 10.0f, Box.LeastAcross + 8.0f,
                                                 Box.SpanAlong() - 80.0f, 8.0f);
        Surface->Ground(TrackExtent, Track, 4.0f, CornerAll);
        Surface->Ground(Spanning(TrackExtent.LeastAlong, TrackExtent.LeastAcross,
                                 TrackExtent.SpanAlong() * Fraction, TrackExtent.SpanAcross()), TrackFill, 4.0f, CornerAll);
        Surface->Medallion(TrackExtent.LeastAlong + TrackExtent.SpanAlong() * Fraction,
                           TrackExtent.LeastAcross + 4.0f, 6.0f, White);
    }
    Surface->TextRun(Box.MostAlong - 72.0f, Box.LeastAcross + 7.0f, Theme.Primary, Reading, 11.0f, 0.0f, true);
    if (Unit != nullptr && Unit[0] != '\0')
    {
        const PlaneExtent UnitExtent = Spanning(Box.MostAlong - 30.0f, Box.LeastAcross, 30.0f, Box.SpanAcross());
        Surface->Ground(UnitExtent, UnitWell, 12.0f, CornerTrailingUpper | CornerTrailingLower);
        Surface->TextRun(UnitExtent.LeastAlong + 7.0f, UnitExtent.LeastAcross + 7.0f, Muted, Unit, 10.0f);
    }
}

void SceneDirectorPanel::Switch(const PlaneExtent& Extent, const char* Caption, bool Taken,
                                const ThemeDeclaration& Theme)
{
    Surface->TextRun(Extent.LeastAlong, Extent.LeastAcross + 8.0f, Theme.Secondary, Caption, 11.5f);
    const PlaneExtent TrackExtent = Spanning(Extent.MostAlong - 42.0f, Extent.LeastAcross + 3.0f, 38.0f, 22.0f);
    Surface->Ground(TrackExtent, Taken ? TrackFill : Well, 11.0f, CornerAll);
    Surface->Medallion(Taken ? TrackExtent.MostAlong - 11.0f : TrackExtent.LeastAlong + 11.0f,
                       TrackExtent.LeastAcross + 11.0f, 8.0f, White);
}

void SceneDirectorPanel::Properties(const PlaneExtent& Extent, const SceneRecord& Record,
                                    const ThemeDeclaration& Theme)
{
    float Cursor = Extent.LeastAcross + 1.0f;
    const auto Card = [&](const char* Caption, std::uint32_t Rows)
    {
        const PlaneExtent Outer = Spanning(Extent.LeastAlong + 7.0f, Cursor, Extent.SpanAlong() - 11.0f,
                                           31.0f + static_cast<float>(Rows) * 38.0f + 12.0f);
        Surface->Ground(Outer, Well, 10.0f, CornerAll);
        Surface->Edge(Outer, Theme.Edge, 1.0f, 10.0f, CornerAll);
        Surface->Ground(Spanning(Outer.LeastAlong, Outer.LeastAcross, Outer.SpanAlong(), 31.0f), Theme.Panel,
                        10.0f, CornerLeadingUpper | CornerTrailingUpper);
        Surface->Edge(Spanning(Outer.LeastAlong, Outer.LeastAcross, Outer.SpanAlong(), 31.0f), Theme.Edge,
                      1.0f, 10.0f, CornerLeadingUpper | CornerTrailingUpper);
        Surface->TextRunCapitalised(Outer.LeastAlong + 10.0f, Outer.LeastAcross + 10.0f,
                                    Theme.Secondary, Caption, 10.5f, 0.04f, true);
        Cursor = Outer.MostAcross + 6.0f;
        return Outer;
    };

    if (Record.Classification != nullptr && std::strcmp(Record.Classification, "level") != 0 &&
        std::strcmp(Record.Classification, "folder") != 0 && std::strcmp(Record.Classification, "script") != 0)
    {
        const PlaneExtent Transform = Card("Transform", 3u);
        const float Left = Transform.LeastAlong + 10.0f;
        const float Right = Transform.MostAlong - 10.0f;
        Field({ Left, Transform.LeastAcross + 37.0f, Right, Transform.LeastAcross + 69.0f }, "Position", "0.00  0.00  0.00", "", Theme);
        Field({ Left, Transform.LeastAcross + 75.0f, Right, Transform.LeastAcross + 107.0f }, "Rotation", "0.00  0.00  0.00", "", Theme);
        Field({ Left, Transform.LeastAcross + 113.0f, Right, Transform.LeastAcross + 145.0f }, "Scale", "1.00  1.00  1.00", "", Theme);
    }

    const PlaneExtent Specific = Card(Record.Classification, 3u);
    const float Left = Specific.LeastAlong + 10.0f;
    const float Right = Specific.MostAlong - 10.0f;
    if (std::strcmp(Record.Classification, "light") == 0)
    {
        Field({ Left, Specific.LeastAcross + 37.0f, Right, Specific.LeastAcross + 69.0f }, "Intensity", "100000", "lm", Theme, 0.67f);
        Switch({ Left, Specific.LeastAcross + 75.0f, Right, Specific.LeastAcross + 103.0f }, "Cast Shadows", true, Theme);
        Surface->TextRun(Left, Specific.LeastAcross + 119.0f, Theme.Secondary, "Light Color", 11.5f);
        Surface->Ground(Spanning(Left + 90.0f, Specific.LeastAcross + 111.0f, Right - Left - 90.0f, 24.0f),
                        Covering(0xFFF0DCu), 6.0f, CornerAll);
    }
    else if (std::strcmp(Record.Classification, "camera") == 0)
    {
        Field({ Left, Specific.LeastAcross + 37.0f, Right, Specific.LeastAcross + 69.0f }, "Projection", "Perspective", "", Theme);
        Field({ Left, Specific.LeastAcross + 75.0f, Right, Specific.LeastAcross + 107.0f }, "Field of View", "90.0", "deg", Theme, 0.50f);
        Field({ Left, Specific.LeastAcross + 113.0f, Right, Specific.LeastAcross + 145.0f }, "Near Clip", "0.10", "m", Theme, 0.10f);
    }
    else
    {
        Field({ Left, Specific.LeastAcross + 37.0f, Right, Specific.LeastAcross + 69.0f }, "Name", Record.Caption, "", Theme);
        Switch({ Left, Specific.LeastAcross + 75.0f, Right, Specific.LeastAcross + 103.0f }, "Visible", !Record.Hidden, Theme);
        Switch({ Left, Specific.LeastAcross + 113.0f, Right, Specific.LeastAcross + 141.0f }, "Editor Only", false, Theme);
    }
}

void SceneDirectorPanel::Revisions(const PlaneExtent& Extent, const SceneRecord& Record,
                                   const ThemeDeclaration& Theme)
{
    const char* Titles[4] = { "Set Parameter", "Translate", "Visibility Changed", "Created" };
    const char* Notes[4] = { "Intensity = 100000 lm", "Moved 4.20 m", "Record shown", "Initial condition" };
    const char* Times[4] = { "10:42", "10:37", "10:34", "10:31" };
    Surface->TextRun(Extent.LeastAlong + 14.0f, Extent.LeastAcross + 11.0f, Theme.Primary, Record.Caption, 12.5f, 0.0f, true);
    Surface->TextRun(Extent.LeastAlong + 14.0f, Extent.LeastAcross + 31.0f, Theme.Secondary,
                     "4 committed changes", 10.5f);
    float Across = Extent.LeastAcross + 56.0f;
    for (std::uint32_t I = 0u; I < 4u; ++I)
    {
        const PlaneExtent Entry = Spanning(Extent.LeastAlong + 12.0f, Across, Extent.SpanAlong() - 24.0f, 66.0f);
        Surface->Ground(Entry, I == 0u ? Selection : Theme.Card, 9.0f, CornerAll);
        Surface->Edge(Entry, I == 0u ? Accent : Theme.Edge, 1.0f, 9.0f, CornerAll);
        Surface->Medallion(Entry.LeastAlong + 20.0f, Entry.LeastAcross + 20.0f, 8.0f, I == 0u ? Accent : Record.Hue);
        Symbol(Spanning(Entry.LeastAlong + 15.0f, Entry.LeastAcross + 15.0f, 10.0f, 10.0f), White);
        Surface->TextRun(Entry.LeastAlong + 38.0f, Entry.LeastAcross + 12.0f, Theme.Primary, Titles[I], 11.5f, 0.0f, true);
        Surface->TextRun(Entry.LeastAlong + 38.0f, Entry.LeastAcross + 34.0f, Theme.Secondary, Notes[I], 10.5f);
        Surface->TextRun(Entry.MostAlong - 44.0f, Entry.LeastAcross + 12.0f, Faint, Times[I], 10.0f);
        Across += 74.0f;
    }
}

void SceneDirectorPanel::TexturePresentation(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates,
                                             const ThemeDeclaration& Theme)
{
    float StackAlong = 470.0f;
    if (Extent.SpanAlong() < 900.0f)
        StackAlong = Extent.SpanAlong() * 0.52f;
    LayerStack(Spanning(Extent.LeastAlong, Extent.LeastAcross, StackAlong, Extent.SpanAcross()), Ordinates, Theme);
    LayerInspector({ Extent.LeastAlong + StackAlong, Extent.LeastAcross, Extent.MostAlong, Extent.MostAcross }, Ordinates, Theme);
}

void SceneDirectorPanel::LayerStack(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates,
                                    const ThemeDeclaration& Theme)
{
    Surface->Ground(Extent, Theme.Ground);
    Surface->Edge(Extent, Theme.Edge, 1.0f, 0.0f, CornerNone);
    const PlaneExtent Head = Spanning(Extent.LeastAlong, Extent.LeastAcross, Extent.SpanAlong(), 46.0f);
    Surface->Ground(Head, Theme.Panel);
    Surface->Edge(Head, Theme.Edge, 1.0f, 0.0f, CornerNone);
    const PlaneExtent Badge = Spanning(Head.LeastAlong + 10.0f, Head.LeastAcross + 11.0f, 24.0f, 24.0f);
    Surface->Ground(Badge, Well, 6.0f, CornerAll);
    Surface->Edge(Badge, Theme.Edge, 1.0f, 6.0f, CornerAll);
    Symbol(Inset(Badge, 5.0f, 5.0f), Muted);
    Surface->TextRun(Head.LeastAlong + 44.0f, Head.LeastAcross + 8.0f, Theme.Primary, "Layer Stack", 12.5f, 0.0f, true);
    Surface->TextRun(Head.LeastAlong + 44.0f, Head.LeastAcross + 27.0f, Muted, "Suzanne - one material + paint", 10.0f);
    char Count[8] = {};
    std::snprintf(Count, sizeof(Count), "%u", LayerCount);
    Surface->Ground(Spanning(Head.MostAlong - 34.0f, Head.LeastAcross + 13.0f, 24.0f, 20.0f), Tile, 10.0f, CornerAll);
    Surface->TextRun(Head.MostAlong - 28.0f, Head.LeastAcross + 18.0f, Muted, Count, 10.0f, 0.0f, true);

    const PlaneExtent Add = Spanning(Extent.LeastAlong + 7.0f, Head.MostAcross + 7.0f, Extent.SpanAlong() - 14.0f, 28.0f);
    Surface->Ground(Add, Theme.Card, 7.0f, CornerAll);
    Surface->Edge(Add, Theme.Edge, 1.0f, 7.0f, CornerAll);
    Symbol(Spanning(Add.LeastAlong + Add.SpanAlong() * 0.5f - 39.0f, Add.LeastAcross + 8.0f, 12.0f, 12.0f), Muted);
    Surface->TextRun(Add.LeastAlong + Add.SpanAlong() * 0.5f - 20.0f, Add.LeastAcross + 8.0f, Theme.Secondary, "Add layer", 11.0f);
    if (Pressed(Add) && LayerCount < 8u)
    {
        Layers[LayerCount] = { "New Layer", "Paint", "Normal", 100u, Covering(0x10B981u), true, false, false, true };
        Ordinates.SelectedLayer = LayerCount;
        ++LayerCount;
    }
    const PlaneExtent Search = Spanning(Extent.LeastAlong + 7.0f, Add.MostAcross + 5.0f, Extent.SpanAlong() - 14.0f, 26.0f);
    if (Roused(Search))
    {
        Surface->Ground(Search, Theme.Panel, 6.0f, CornerAll);
        Surface->Edge(Search, Theme.Edge, 1.0f, 6.0f, CornerAll);
    }
    Symbol(Spanning(Search.LeastAlong + 8.0f, Search.LeastAcross + 7.0f, 12.0f, 12.0f), Faint);
    Surface->TextRun(Search.LeastAlong + 27.0f, Search.LeastAcross + 7.0f, Faint, "Filter layers...", 11.0f);

    float Across = Search.MostAcross + 8.0f;
    for (std::uint32_t I = 0u; I < LayerCount; ++I)
    {
        PaintLayer& Layer = Layers[I];
        const float DisclosureFraction = LayerDisclosure[I];
        const float RowAcross = 52.0f + 40.0f * DisclosureFraction;
        const PlaneExtent Row = Spanning(Extent.LeastAlong + 37.0f, Across, Extent.SpanAlong() - 47.0f, RowAcross - 5.0f);
        if (Pointer.ContactArrived && Row.Encloses(Pointer.PositionAlong, Pointer.PositionAcross))
            DraggedLayer = I;
        if (Pointer.ContactReleased && DraggedLayer < LayerCount && DraggedLayer != I &&
            Row.Encloses(Pointer.PositionAlong, Pointer.PositionAcross))
        {
            std::swap(Layers[DraggedLayer], Layers[I]);
            std::swap(LayerDisclosure[DraggedLayer], LayerDisclosure[I]);
            Ordinates.SelectedLayer = I;
            DraggedLayer = I;
        }
        Surface->Ground(Row, Ordinates.SelectedLayer == I ? Selection : Theme.Card, 8.0f, CornerAll);
        Surface->Edge(Row, Ordinates.SelectedLayer == I ? Accent : Theme.Edge, 1.0f, 8.0f, CornerAll);
        Surface->Ground(Spanning(Extent.LeastAlong + 16.0f, Across, 3.0f, RowAcross), Layer.Shown ? Layer.Tag : Theme.Edge, 2.0f, CornerAll);
        Surface->Medallion(Extent.LeastAlong + 17.5f, Across + 22.0f, 10.0f, Layer.Shown ? Layer.Tag : TileRoused);
        char Ordinal[8] = {};
        std::snprintf(Ordinal, sizeof(Ordinal), "%02u", LayerCount - I);
        Surface->TextRun(Extent.LeastAlong + 11.0f, Across + 18.0f, White, Ordinal, 9.5f, 0.0f, true);

        const PlaneExtent Disclosure = Spanning(Row.LeastAlong + 6.0f, Row.LeastAcross + 15.0f, 14.0f, 14.0f);
        Symbol(Disclosure, Muted, -1.5708f * (1.0f - DisclosureFraction));
        if (Pressed(Disclosure))
            Layer.Expanded = !Layer.Expanded;
        const PlaneExtent Eye = Spanning(Row.LeastAlong + 26.0f, Row.LeastAcross + 14.0f, 16.0f, 16.0f);
        Symbol(Eye, Layer.Shown ? Muted : Faint);
        if (Pressed(Eye))
            Layer.Shown = !Layer.Shown;
        Surface->TextRunTruncated(Row.LeastAlong + 48.0f, Row.LeastAcross + 8.0f, Row.LeastAlong + Row.SpanAlong() * 0.52f,
                                  Dimmed(Theme.Primary, !Layer.Shown), Layer.Caption, 11.5f, true);
        Surface->TextRun(Row.LeastAlong + 48.0f, Row.LeastAcross + 27.0f, Muted, Layer.Content, 10.0f);
        Surface->TextRun(Row.LeastAlong + Row.SpanAlong() * 0.58f, Row.LeastAcross + 8.0f,
                         Layer.MaskEnabled ? Theme.Primary : Muted, Layer.MaskEnabled ? "Mask" : "No Mask", 11.0f, 0.0f, Layer.MaskEnabled);
        Surface->TextRun(Row.LeastAlong + Row.SpanAlong() * 0.58f, Row.LeastAcross + 27.0f, Muted,
                         Layer.MaskEnabled ? "Generator" : "Add mask", 10.0f);
        if (DisclosureFraction > 0.02f)
        {
            Surface->Confine(Row);
            Surface->Edge(Spanning(Row.LeastAlong, Row.LeastAcross + 44.0f, Row.SpanAlong(), 1.0f), Theme.Edge);
            Surface->TextRun(Row.LeastAlong + 10.0f, Row.LeastAcross + 58.0f, Muted, Layer.Blend, 10.5f);
            char Opacity[16] = {};
            std::snprintf(Opacity, sizeof(Opacity), "%u%%", Layer.Opacity);
            Surface->TextRun(Row.MostAlong - 42.0f, Row.LeastAcross + 58.0f, Theme.Secondary, Opacity, 10.5f);
            const PlaneExtent OpacityTrack = Spanning(Row.LeastAlong + 70.0f, Row.LeastAcross + 59.0f,
                                                       Row.SpanAlong() - 130.0f, 8.0f);
            Surface->Ground(OpacityTrack, Track, 4.0f, CornerAll);
            Surface->Ground(Spanning(OpacityTrack.LeastAlong, OpacityTrack.LeastAcross,
                                     OpacityTrack.SpanAlong() * static_cast<float>(Layer.Opacity) / 100.0f,
                                     OpacityTrack.SpanAcross()), TrackFill, 4.0f, CornerAll);
            if (Pointer.ContactHeld && Spanning(OpacityTrack.LeastAlong, OpacityTrack.LeastAcross - 8.0f,
                                                OpacityTrack.SpanAlong(), 24.0f).Encloses(
                                                    Pointer.PositionAlong, Pointer.PositionAcross))
            {
                float Fraction = (Pointer.PositionAlong - OpacityTrack.LeastAlong) / OpacityTrack.SpanAlong();
                Fraction = Fraction < 0.0f ? 0.0f : (Fraction > 1.0f ? 1.0f : Fraction);
                Layer.Opacity = static_cast<std::uint32_t>(Fraction * 100.0f + 0.5f);
            }
            Surface->Release();
        }
        if (Pressed(Row) && !Pressed(Disclosure) && !Pressed(Eye))
        {
            Ordinates.SelectedLayer = I;
            Ordinates.MaskTarget = Pointer.PositionAlong > Row.LeastAlong + Row.SpanAlong() * 0.55f;
        }
        Across += RowAcross;
    }
    if (Pointer.ContactReleased)
        DraggedLayer = 8u;
    const PlaneExtent Foot = Spanning(Extent.LeastAlong, Extent.MostAcross - 26.0f, Extent.SpanAlong(), 26.0f);
    Surface->Ground(Foot, Theme.Panel);
    Surface->Edge(Foot, Theme.Edge, 1.0f, 0.0f, CornerNone);
    std::uint32_t Shown = 0u;
    for (std::uint32_t I = 0u; I < LayerCount; ++I) if (Layers[I].Shown) ++Shown;
    char Summary[48] = {};
    std::snprintf(Summary, sizeof(Summary), "%u layers  -  %u visible", LayerCount, Shown);
    Surface->TextRun(Foot.LeastAlong + 10.0f, Foot.LeastAcross + 8.0f, Muted, Summary, 10.0f);
}

void SceneDirectorPanel::LayerInspector(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates,
                                        const ThemeDeclaration& Theme)
{
    const std::uint32_t Selected = Ordinates.SelectedLayer < LayerCount ? Ordinates.SelectedLayer : 0u;
    PaintLayer& Layer = Layers[Selected];
    Surface->Ground(Extent, Theme.Panel);
    const PlaneExtent Head = Spanning(Extent.LeastAlong, Extent.LeastAcross, Extent.SpanAlong(), 46.0f);
    Surface->Ground(Head, Theme.Panel);
    Surface->Edge(Head, Theme.Edge, 1.0f, 0.0f, CornerNone);
    const PlaneExtent Badge = Spanning(Head.LeastAlong + 10.0f, Head.LeastAcross + 11.0f, 24.0f, 24.0f);
    Surface->Ground(Badge, Well, 6.0f, CornerAll);
    Symbol(Inset(Badge, 5.0f, 5.0f), Layer.Tag);
    Surface->TextRun(Badge.MostAlong + 8.0f, Head.LeastAcross + 8.0f, Theme.Primary,
                     Ordinates.MaskTarget ? "Mask Property" : Layer.Caption, 12.5f, 0.0f, true);
    Surface->TextRun(Badge.MostAlong + 8.0f, Head.LeastAcross + 27.0f, Muted,
                     Ordinates.MaskTarget ? "Grayscale mask" : "Layer Inspector", 10.0f);

    float Cursor = Head.MostAcross + 8.0f;
    const PlaneExtent Target = Spanning(Extent.LeastAlong + 8.0f, Cursor, Extent.SpanAlong() - 16.0f, 30.0f);
    const char* Targets[2] = { "Layer", "Mask" };
    for (std::uint32_t I = 0u; I < 2u; ++I)
    {
        const PlaneExtent Segment = Spanning(Target.LeastAlong + static_cast<float>(I) * Target.SpanAlong() * 0.5f,
                                             Target.LeastAcross, Target.SpanAlong() * 0.5f, 30.0f);
        const bool Taken = Ordinates.MaskTarget == (I == 1u);
        Surface->Ground(Segment, Taken ? White : Tile, 9.0f, CornerAll);
        Surface->TextRun(Segment.LeastAlong + 12.0f, Segment.LeastAcross + 8.0f,
                         Taken ? Well : Muted, Targets[I], 11.0f, 0.0f, Taken);
        if (Pressed(Segment)) Ordinates.MaskTarget = I == 1u;
    }
    Cursor = Target.MostAcross + 8.0f;
    const PlaneExtent Card = Spanning(Extent.LeastAlong + 8.0f, Cursor, Extent.SpanAlong() - 16.0f,
                                      Ordinates.MaskTarget ? 286.0f : 350.0f);
    Surface->Ground(Card, Well, 12.0f, CornerAll);
    Surface->Edge(Card, Theme.Edge, 1.0f, 12.0f, CornerAll);
    Surface->Ground(Spanning(Card.LeastAlong, Card.LeastAcross, Card.SpanAlong(), 34.0f), Theme.Panel,
                    12.0f, CornerLeadingUpper | CornerTrailingUpper);
    Surface->TextRunCapitalised(Card.LeastAlong + 12.0f, Card.LeastAcross + 11.0f, Muted,
                                Ordinates.MaskTarget ? "Mask" : "Layer", 10.5f, 0.04f, true);
    const float Left = Card.LeastAlong + 12.0f;
    const float Right = Card.MostAlong - 12.0f;
    if (Ordinates.MaskTarget)
    {
        Switch({ Left, Card.LeastAcross + 43.0f, Right, Card.LeastAcross + 73.0f }, "Enabled", Layer.MaskEnabled, Theme);
        const PlaneExtent Enabled = { Left, Card.LeastAcross + 43.0f, Right, Card.LeastAcross + 73.0f };
        if (Pressed(Enabled)) Layer.MaskEnabled = !Layer.MaskEnabled;
        Field({ Left, Card.LeastAcross + 81.0f, Right, Card.LeastAcross + 113.0f }, "Base Mask", "White", "", Theme);
        Field({ Left, Card.LeastAcross + 119.0f, Right, Card.LeastAcross + 151.0f }, "Strength", "92", "%", Theme, 0.92f);
        Switch({ Left, Card.LeastAcross + 157.0f, Right, Card.LeastAcross + 187.0f }, "Invert", false, Theme);
        Surface->TextRun(Left, Card.LeastAcross + 207.0f, Muted, "Source", 11.5f);
        const PlaneExtent Source = Spanning(Left + 90.0f, Card.LeastAcross + 198.0f, Right - Left - 90.0f, 32.0f);
        Surface->Ground(Source, Tile, 8.0f, CornerAll);
        Surface->TextRun(Source.LeastAlong + 11.0f, Source.LeastAcross + 9.0f, Theme.Primary, "Generator", 11.0f);
        Surface->TextRun(Left, Card.LeastAcross + 248.0f, Faint, "Material atlas - channel A", 10.5f);
    }
    else
    {
        Field({ Left, Card.LeastAcross + 43.0f, Right, Card.LeastAcross + 75.0f }, "Name", Layer.Caption, "", Theme);
        Field({ Left, Card.LeastAcross + 81.0f, Right, Card.LeastAcross + 113.0f }, "Content", Layer.Content, "", Theme);
        Field({ Left, Card.LeastAcross + 119.0f, Right, Card.LeastAcross + 151.0f }, "Blend Mode", Layer.Blend, "", Theme);
        Field({ Left, Card.LeastAcross + 157.0f, Right, Card.LeastAcross + 189.0f }, "Opacity", "78", "%", Theme,
               static_cast<float>(Layer.Opacity) / 100.0f);
        Switch({ Left, Card.LeastAcross + 195.0f, Right, Card.LeastAcross + 225.0f }, "Visible", Layer.Shown, Theme);
        const PlaneExtent Visible = { Left, Card.LeastAcross + 195.0f, Right, Card.LeastAcross + 225.0f };
        if (Pressed(Visible)) Layer.Shown = !Layer.Shown;
        Surface->TextRunCapitalised(Left, Card.LeastAcross + 247.0f, Muted, "Channels", 10.0f, 0.04f, true);
        const char* Channels[4] = { "Base Color", "Roughness", "Metallic", "Bump" };
        for (std::uint32_t I = 0u; I < 4u; ++I)
        {
            const PlaneExtent Chip = Spanning(Left + static_cast<float>(I % 2u) * 116.0f,
                                              Card.LeastAcross + 267.0f + static_cast<float>(I / 2u) * 30.0f,
                                              108.0f, 24.0f);
            Surface->Ground(Chip, I < 3u ? Selection : Tile, 7.0f, CornerAll);
            Surface->Edge(Chip, I < 3u ? Accent : Theme.Edge, 1.0f, 7.0f, CornerAll);
            Surface->TextRun(Chip.LeastAlong + 9.0f, Chip.LeastAcross + 7.0f,
                             I < 3u ? Theme.Primary : Muted, Channels[I], 10.0f);
        }
    }
}

void SceneDirectorPanel::Reset()
{
    Surface = nullptr;
    Pointer = {};
}

} // namespace Slate
