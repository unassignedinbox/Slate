//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/OutlinerPanel.cpp — Dockable World Outliner, Hierarchy Traversal and Immediate Mode Presentation
//============================================================================================================================================

#include "OutlinerPanel.h"
#include "ThemeStructure.h"
#include <imgui.h>
#include <imgui_internal.h>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <cstdio>

namespace Frontier {

namespace {

constexpr float Pi = 3.14159265358979323846f;

inline ImU32 PackColour(ColorQuad Quad) noexcept
{
    return ImGui::ColorConvertFloat4ToU32(ImVec4(Quad.Red, Quad.Green, Quad.Blue, Quad.Alpha));
}

inline ImU32 HexColour(uint32_t Hex, float Alpha = 1.0f) noexcept
{
    const float R = static_cast<float>((Hex >> 16) & 0xFF) / 255.0f;
    const float G = static_cast<float>((Hex >> 8) & 0xFF) / 255.0f;
    const float B = static_cast<float>(Hex & 0xFF) / 255.0f;
    return ImGui::ColorConvertFloat4ToU32(ImVec4(R, G, B, Alpha));
}

} // namespace

//============================================================================================================================================
//                                                        CONSTRUCTOR
//============================================================================================================================================

OutlinerPanel::OutlinerPanel() noexcept
    : Records{}
    , SelectedIdentifier{}
    , ActiveDomains{}
    , SearchBuffer{}
    , CompactCondition(false)
    , CurrentTelemetry{}
    , InitializedCondition(false)
{
    std::memset(SearchBuffer, 0, sizeof(SearchBuffer));
    ResetDefaultWorld();
}

//============================================================================================================================================
//                                                    WORLD REGISTRATION
//============================================================================================================================================

void OutlinerPanel::RegisterRecord(const OutlinerRecord& Record) noexcept
{
    for (size_t I = 0; I < Records.size(); ++I)
    {
        if (Records[I].Identifier == Record.Identifier)
        {
            Records[I] = Record;
            return;
        }
    }
    Records.push_back(Record);
}

void OutlinerPanel::UnregisterRecord(std::string_view Identifier) noexcept
{
    const auto Iter = std::remove_if(Records.begin(), Records.end(),
        [&](const OutlinerRecord& R) { return R.Identifier == Identifier; });
    Records.erase(Iter, Records.end());
}

void OutlinerPanel::ClearRecords() noexcept
{
    Records.clear();
    SelectedIdentifier.clear();
}

void OutlinerPanel::ResetDefaultWorld() noexcept
{
    ClearRecords();

    // 19 canonical world entities + 3 group folders from the celestial reference
    // Domain: Lights (#ffb454), Sky (#5aa9ff), Bodies (#dfe6f5), Geometry (#e2e8f0), Camera (#34c759)

    // ① World Folder (root)
    RegisterRecord(OutlinerRecord{
        "world", "World", "World Root", "",
        OutlinerIconCategory::Globe, ColorQuad{ 0.35f, 0.66f, 1.00f, 1.00f },
        OutlinerDomainCategory::Sky, true, true, true, "",
        OutlinerStatusTone::Success, "All good", ""
    });

    // Subordinates under "world":
    RegisterRecord(OutlinerRecord{
        "atmosphere", "Atmosphere", "Atmosphere", "world",
        OutlinerIconCategory::Atmosphere, ColorQuad{ 0.35f, 0.66f, 1.00f, 1.00f },
        OutlinerDomainCategory::Sky, false, true, true, "AM 1.00",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "sun", "Sun", "Directional Light", "world",
        OutlinerIconCategory::Sun, ColorQuad{ 1.00f, 0.71f, 0.33f, 1.00f },
        OutlinerDomainCategory::Lights, false, true, true, "0.0°",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "sky", "Sky", "Sky Atmosphere", "world",
        OutlinerIconCategory::Sky, ColorQuad{ 0.40f, 0.91f, 0.98f, 1.00f },
        OutlinerDomainCategory::Sky, false, true, true, "3.20 kcd",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "stars", "Stars", "Star Field", "world",
        OutlinerIconCategory::Stars, ColorQuad{ 0.77f, 0.71f, 0.99f, 1.00f },
        OutlinerDomainCategory::Sky, false, true, true, "mag 6.0",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "wind", "Wind", "Wind Field", "world",
        OutlinerIconCategory::Wind, ColorQuad{ 0.65f, 0.95f, 0.82f, 1.00f },
        OutlinerDomainCategory::Sky, false, true, true, "8.0 m/s W",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "fog", "Height Fog", "Volumetrics", "world",
        OutlinerIconCategory::HeightFog, ColorQuad{ 0.62f, 0.69f, 0.75f, 1.00f },
        OutlinerDomainCategory::Sky, false, true, true, "500 m",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "afog", "Atmospheric Fog", "Aerial Perspective", "world",
        OutlinerIconCategory::AtmosphericFog, ColorQuad{ 0.56f, 0.72f, 0.85f, 1.00f },
        OutlinerDomainCategory::Sky, false, true, true, "45 km",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "vfog", "Local Volumetric Fog", "Fog Volume", "world",
        OutlinerIconCategory::VolumetricFog, ColorQuad{ 0.79f, 0.84f, 0.89f, 1.00f },
        OutlinerDomainCategory::Sky, false, true, true, "20×20 m",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "clouds", "Cloud Layer", "Clouds", "world",
        OutlinerIconCategory::Cloud, ColorQuad{ 0.87f, 0.90f, 0.93f, 1.00f },
        OutlinerDomainCategory::Sky, false, true, true, "4/8",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "vclouds", "Clouds", "Volumetric Clouds", "world",
        OutlinerIconCategory::VolumetricClouds, ColorQuad{ 0.95f, 0.96f, 0.98f, 1.00f },
        OutlinerDomainCategory::Sky, false, true, true, "Cumulus · 55%",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "precip", "Precipitation", "Component · Clouds", "vclouds",
        OutlinerIconCategory::Precipitation, ColorQuad{ 0.49f, 0.83f, 0.99f, 1.00f },
        OutlinerDomainCategory::Sky, false, true, true, "Rain 5 mm/h",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "lcloud", "Local Cloud", "Cloud Volume", "world",
        OutlinerIconCategory::LocalCloud, ColorQuad{ 0.91f, 0.93f, 0.96f, 1.00f },
        OutlinerDomainCategory::Sky, false, true, true, "40×40 m",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "moons", "Moons", "Atlas", "world",
        OutlinerIconCategory::Moon, ColorQuad{ 0.87f, 0.90f, 0.96f, 1.00f },
        OutlinerDomainCategory::Bodies, true, true, true, "1/4",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "moon#0", "Luna", "Celestial Body", "moons",
        OutlinerIconCategory::Moon, ColorQuad{ 0.87f, 0.90f, 0.96f, 1.00f },
        OutlinerDomainCategory::Bodies, false, true, true, "50%",
        OutlinerStatusTone::Success, "All good", ""
    });

    // ② Root Geometry entities
    RegisterRecord(OutlinerRecord{
        "plane", "Ground Plane", "Static Mesh", "",
        OutlinerIconCategory::GroundPlane, ColorQuad{ 0.89f, 0.91f, 0.94f, 1.00f },
        OutlinerDomainCategory::Geometry, false, true, true, "1200 m",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "terrain", "Height Field", "Terrain", "",
        OutlinerIconCategory::Globe, ColorQuad{ 0.56f, 0.70f, 0.42f, 1.00f },
        OutlinerDomainCategory::Geometry, false, true, true, "100 m",
        OutlinerStatusTone::Success, "All good", ""
    });

    // ③ Root Lights folder
    RegisterRecord(OutlinerRecord{
        "lights", "Lights", "Lighting Group", "",
        OutlinerIconCategory::PointLight, ColorQuad{ 1.00f, 0.82f, 0.48f, 1.00f },
        OutlinerDomainCategory::Lights, true, true, true, "",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "plight", "Point Light", "Point Light", "lights",
        OutlinerIconCategory::PointLight, ColorQuad{ 1.00f, 0.82f, 0.48f, 1.00f },
        OutlinerDomainCategory::Lights, false, true, true, "1500 cd",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "slight", "Spot Light", "Spot Light", "lights",
        OutlinerIconCategory::SpotLight, ColorQuad{ 0.62f, 0.82f, 1.00f, 1.00f },
        OutlinerDomainCategory::Lights, false, true, true, "45°",
        OutlinerStatusTone::Success, "All good", ""
    });

    // ④ Root Camera entities
    RegisterRecord(OutlinerRecord{
        "camera", "Camera", "Perspective Camera", "",
        OutlinerIconCategory::Camera, ColorQuad{ 0.20f, 0.78f, 0.35f, 1.00f },
        OutlinerDomainCategory::Camera, false, true, true, "75°",
        OutlinerStatusTone::Success, "All good", ""
    });

    RegisterRecord(OutlinerRecord{
        "post", "Post Process", "Component · Camera", "camera",
        OutlinerIconCategory::PostProcess, ColorQuad{ 1.00f, 0.54f, 0.40f, 1.00f },
        OutlinerDomainCategory::Camera, false, true, true, "+0.0 EV",
        OutlinerStatusTone::Success, "All good", "Comp"
    });

    RegisterRecord(OutlinerRecord{
        "cine", "Cine Camera", "Cinematic Camera", "",
        OutlinerIconCategory::CineCamera, ColorQuad{ 0.37f, 0.92f, 0.83f, 1.00f },
        OutlinerDomainCategory::Camera, false, true, true, "50 mm",
        OutlinerStatusTone::Success, "All good", ""
    });

    SelectedIdentifier = "sun";
    InitializedCondition = true;
}

const OutlinerRecord* OutlinerPanel::QueryRecord(std::string_view Identifier) const noexcept
{
    for (const auto& R : Records)
        if (R.Identifier == Identifier) return &R;
    return nullptr;
}

OutlinerRecord* OutlinerPanel::QueryRecord(std::string_view Identifier) noexcept
{
    for (auto& R : Records)
        if (R.Identifier == Identifier) return &R;
    return nullptr;
}

void OutlinerPanel::AssignVisibility(std::string_view Identifier, bool Visible) noexcept
{
    if (OutlinerRecord* R = QueryRecord(Identifier))
    {
        R->VisibleCondition = Visible;
        if (!Visible)
        {
            R->StatusTone = OutlinerStatusTone::Warning;
            R->StatusDescription = "Hidden";
        }
        else
        {
            R->StatusTone = OutlinerStatusTone::Success;
            R->StatusDescription = "All good";
        }
    }
}

void OutlinerPanel::AssignScope(std::string_view Identifier, std::string_view ScopeIdentifier) noexcept
{
    if (Identifier == ScopeIdentifier) return;
    if (HasCycle(Identifier, ScopeIdentifier)) return;

    if (OutlinerRecord* R = QueryRecord(Identifier))
    {
        R->ScopeIdentifier = std::string(ScopeIdentifier);
        if (!ScopeIdentifier.empty())
        {
            if (OutlinerRecord* EnclosingRecord = QueryRecord(ScopeIdentifier))
                EnclosingRecord->OpenCondition = true;
        }
    }
}

void OutlinerPanel::AssignSummary(std::string_view Identifier, std::string_view Summary) noexcept
{
    if (OutlinerRecord* R = QueryRecord(Identifier))
    {
        R->SummaryText = std::string(Summary);
    }
}

void OutlinerPanel::AssignStatus(std::string_view Identifier, OutlinerStatusTone Tone, std::string_view Description) noexcept
{
    if (OutlinerRecord* R = QueryRecord(Identifier))
    {
        R->StatusTone = Tone;
        R->StatusDescription = std::string(Description);
    }
}

OutlinerStatRecord OutlinerPanel::QueryStats() const noexcept
{
    OutlinerStatRecord Stats{};
    for (const auto& R : Records)
    {
        // Only count leaf or non-root-group entities for the scene count matching the web reference (19 total)
        if (R.Identifier != "world" && R.Identifier != "lights")
        {
            Stats.TotalCount++;
            if (R.VisibleCondition) Stats.VisibleCount++;
            else                    Stats.HiddenCount++;
        }
    }
    return Stats;
}

uint32_t OutlinerPanel::QueryTotalCount() const noexcept
{
    return QueryStats().TotalCount;
}

uint32_t OutlinerPanel::QueryVisibleCount() const noexcept
{
    return QueryStats().VisibleCount;
}

uint32_t OutlinerPanel::QueryHiddenCount() const noexcept
{
    return QueryStats().HiddenCount;
}

void OutlinerPanel::AssignSelectedIdentifier(std::string_view Identifier) noexcept
{
    SelectedIdentifier = std::string(Identifier);
}

bool OutlinerPanel::HasCycle(std::string_view SourceIdentifier, std::string_view TargetIdentifier) const noexcept
{
    std::string Current(TargetIdentifier);
    while (!Current.empty())
    {
        if (Current == SourceIdentifier) return true;
        const OutlinerRecord* R = QueryRecord(Current);
        if (!R) break;
        Current = R->ScopeIdentifier;
    }
    return false;
}

bool OutlinerPanel::PassesFilter(const OutlinerRecord& Record) const noexcept
{
    if (!ActiveDomains.empty())
    {
        if (ActiveDomains.find(Record.Domain) == ActiveDomains.end())
            return false;
    }

    if (SearchBuffer[0] != '\0')
    {
        // Case-insensitive substring match
        std::string NameLower = Record.DisplayName;
        std::string QueryLower = SearchBuffer;
        std::transform(NameLower.begin(), NameLower.end(), NameLower.begin(), ::tolower);
        std::transform(QueryLower.begin(), QueryLower.end(), QueryLower.begin(), ::tolower);
        if (NameLower.find(QueryLower) == std::string::npos)
            return false;
    }

    return true;
}

bool OutlinerPanel::HasVisibleDescendant(const OutlinerRecord& Record) const noexcept
{
    for (const auto& Sub : Records)
    {
        if (Sub.ScopeIdentifier == Record.Identifier)
        {
            if (PassesFilter(Sub) || HasVisibleDescendant(Sub))
                return true;
        }
    }
    return false;
}

//============================================================================================================================================
//                                                    SVG VECTOR ICON RASTER
//============================================================================================================================================

void OutlinerPanel::RenderVectorIcon(
    void*                DrawListOpaque,
    OutlinerIconCategory Icon,
    float                ScreenX,
    float                ScreenY,
    float                BoxSize,
    uint32_t             ColorRgba,
    float                StrokeThickness) const noexcept
{
    if (!DrawListOpaque) return;
    ImDrawList* DrawList = static_cast<ImDrawList*>(DrawListOpaque);

    // If moon icon, render realistic celestial sphere
    if (Icon == OutlinerIconCategory::Moon && BoxSize >= 14.0f)
    {
        const float Radius = BoxSize * 0.44f;
        const float CenterX = ScreenX + BoxSize * 0.5f;
        const float CenterY = ScreenY + BoxSize * 0.5f;
        
        // Moon disk dark base
        DrawList->AddCircleFilled(ImVec2(CenterX, CenterY), Radius, HexColour(0x1a202c, 0.95f), 24);
        
        // Crescent illuminated limb
        DrawList->AddCircleFilled(ImVec2(CenterX + Radius * 0.22f, CenterY), Radius * 0.92f, ColorRgba, 24);
        // Moon shadow cutter
        DrawList->AddCircleFilled(ImVec2(CenterX + Radius * 0.48f, CenterY - Radius * 0.1f), Radius * 0.88f, HexColour(0x0f1012, 0.96f), 24);
        DrawList->AddCircle(ImVec2(CenterX, CenterY), Radius, ColorRgba, 24, 1.0f);
        return;
    }

    // Static cache for flattened contours of all 29 icons
    static std::vector<GlyphSpace::Contour> CachedContours[static_cast<size_t>(OutlinerIconCategory::Count)];
    static bool CachedInitialized = false;

    if (!CachedInitialized)
    {
        for (size_t I = 0; I < static_cast<size_t>(OutlinerIconCategory::Count); ++I)
        {
            const std::string_view SvgPath = VectorCodec::QueryOutlinerSvgPath(static_cast<OutlinerIconCategory>(I));
            CachedContours[I] = GlyphSpace::Flatten(SvgPath);
        }
        CachedInitialized = true;
    }

    const size_t IconIndex = static_cast<size_t>(Icon);
    if (IconIndex >= static_cast<size_t>(OutlinerIconCategory::Count)) return;

    constexpr float ViewBoxSize = 24.0f;
    const float Scale = BoxSize / ViewBoxSize;
    const float Thickness = StrokeThickness * Scale;

    const auto& Contours = CachedContours[IconIndex];
    for (const auto& C : Contours)
    {
        if (C.Points.size() < 2u)
        {
            if (C.Points.size() == 1u)
            {
                const float PX = ScreenX + C.Points[0].X * Scale;
                const float PY = ScreenY + C.Points[0].Y * Scale;
                DrawList->AddCircleFilled(ImVec2(PX, PY), Thickness * 0.9f, ColorRgba, 8);
            }
            continue;
        }

        std::vector<ImVec2> ScreenPoints;
        ScreenPoints.reserve(C.Points.size());
        for (const auto& P : C.Points)
        {
            ScreenPoints.push_back(ImVec2(ScreenX + P.X * Scale, ScreenY + P.Y * Scale));
        }

        DrawList->AddPolyline(
            ScreenPoints.data(),
            static_cast<int>(ScreenPoints.size()),
            ColorRgba,
            C.Closed ? ImDrawFlags_Closed : 0,
            Thickness);
    }
}

//============================================================================================================================================
//                                                        PRESENTATION
//============================================================================================================================================

void OutlinerPanel::Present(bool* OpenCondition) noexcept
{
    // Dockable Outliner Window
    const float DesiredWidth = CompactCondition ? 236.0f : 316.0f;
    ImGui::SetNextWindowSize(ImVec2(DesiredWidth, 680.0f), ImGuiCond_FirstUseEver);

    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.059f, 0.063f, 0.071f, 0.88f));   // --glass rgba(15, 16, 18, 0.88)
    ImGui::PushStyleColor(ImGuiCol_Border,   ImVec4(1.0f, 1.0f, 1.0f, 0.08f));          // --stroke rgba(255, 255, 255, 0.08)
    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 16.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));

    constexpr ImGuiWindowFlags WindowFlags = ImGuiWindowFlags_NoScrollbar;

    if (ImGui::Begin("Outliner", OpenCondition, WindowFlags))
    {
        RenderHeader();

        if (!CompactCondition)
        {
            RenderSceneStats();
        }

        RenderSearchBar();
        RenderDomainFilters();
        RenderHierarchyTree();
        RenderFooter();
    }
    ImGui::End();

    ImGui::PopStyleVar(3);
    ImGui::PopStyleColor(2);
}

//============================================================================================================================================
//                                                        HEADER
//============================================================================================================================================

void OutlinerPanel::RenderHeader() noexcept
{
    const OutlinerStatRecord Stats = QueryStats();
    const float WindowWidth = ImGui::GetWindowWidth();

    ImGui::SetCursorPos(ImVec2(18.0f, 16.0f));
    const ImVec2 HeaderPos = ImGui::GetCursorScreenPos();
    ImDrawList* DrawList = ImGui::GetWindowDrawList();

    // Outliner title
    DrawList->AddText(ImGui::GetFont(), 16.0f, ImVec2(HeaderPos.x, HeaderPos.y), HexColour(0xffffff, 0.96f), "Outliner");
    const float TitleWidth = ImGui::CalcTextSize("Outliner").x * (16.0f / ImGui::GetFontSize());

    // Scene count subtitle
    char Subtitle[64];
    std::snprintf(Subtitle, sizeof(Subtitle), "Scene · %u nodes", Stats.TotalCount);
    DrawList->AddText(ImGui::GetFont(), 12.0f, ImVec2(HeaderPos.x + TitleWidth + 8.0f, HeaderPos.y + 3.0f), HexColour(0xffffff, 0.35f), Subtitle);

    // Compact mode button on the far right
    const float BtnX = WindowWidth - 42.0f;
    ImGui::SetCursorPos(ImVec2(BtnX, 12.0f));
    const ImVec2 BtnScreenPos = ImGui::GetCursorScreenPos();

    ImGui::PushID("CompactBtn");
    if (ImGui::InvisibleButton("##cbtn", ImVec2(26.0f, 26.0f)))
    {
        CompactCondition = !CompactCondition;
    }
    const bool Hovered = ImGui::IsItemHovered();

    const ImVec2 BtnCenter(BtnScreenPos.x + 13.0f, BtnScreenPos.y + 13.0f);
    const ImU32 CircleBg = Hovered ? HexColour(0xffffff, 0.12f) : (CompactCondition ? HexColour(0xffffff, 0.10f) : HexColour(0xffffff, 0.04f));
    DrawList->AddCircleFilled(BtnCenter, 13.0f, CircleBg, 16);
    DrawList->AddCircle(BtnCenter, 13.0f, HexColour(0xffffff, 0.10f), 16, 1.0f);

    const ImU32 IconCol = Hovered || CompactCondition ? HexColour(0xffffff, 0.95f) : HexColour(0xffffff, 0.50f);
    RenderVectorIcon(DrawList, OutlinerIconCategory::CompactToggle, BtnCenter.x - 7.0f, BtnCenter.y - 7.0f, 14.0f, IconCol, 1.8f);

    if (Hovered)
    {
        ImGui::SetTooltip("Compact Outliner (Tab)");
    }
    ImGui::PopID();

    ImGui::SetCursorPos(ImVec2(14.0f, 48.0f));
    ImGui::Dummy(ImVec2(WindowWidth - 28.0f, 0.0f));
}

//============================================================================================================================================
//                                                     SCENE STATS
//============================================================================================================================================

void OutlinerPanel::RenderSceneStats() noexcept
{
    const OutlinerStatRecord Stats = QueryStats();
    const float WindowWidth = ImGui::GetWindowWidth();
    const float MarginX = 14.0f;
    const float CardGap = 8.0f;
    const float CardWidth = (WindowWidth - MarginX * 2.0f - CardGap) * 0.5f;
    const float CardHeight = 62.0f;

    ImDrawList* DrawList = ImGui::GetWindowDrawList();
    const ImVec2 WinPos = ImGui::GetWindowPos();
    const float StartY = ImGui::GetCursorPosY();

    // ── Visible Card ─────────────────────────────────────────────────────────────────────────────────────────────────
    const ImVec2 Card0Min(WinPos.x + MarginX, WinPos.y + StartY);
    const ImVec2 Card0Max(Card0Min.x + CardWidth, Card0Min.y + CardHeight);
    DrawList->AddRectFilled(Card0Min, Card0Max, HexColour(0xffffff, 0.035f), 14.0f);
    DrawList->AddRect(Card0Min, Card0Max, HexColour(0xffffff, 0.07f), 14.0f, 0, 1.0f);

    // Green circular badge
    const ImVec2 Badge0Center(Card0Min.x + 22.0f, Card0Min.y + 22.0f);
    DrawList->AddCircleFilled(Badge0Center, 11.0f, HexColour(0x34c759, 1.0f), 16);
    RenderVectorIcon(DrawList, OutlinerIconCategory::StatusCheck, Badge0Center.x - 6.0f, Badge0Center.y - 6.0f, 12.0f, HexColour(0x0b1a12, 1.0f), 2.2f);

    // Large number "Visible"
    char VisBuf[16];
    std::snprintf(VisBuf, sizeof(VisBuf), "%u", Stats.VisibleCount);
    const ImVec2 Num0Pos(Card0Max.x - 14.0f - ImGui::CalcTextSize(VisBuf).x, Card0Min.y + 12.0f);
    DrawList->AddText(ImGui::GetFont(), 26.0f, Num0Pos, HexColour(0xffffff, 0.95f), VisBuf);

    // Label "Visible"
    const ImVec2 Lab0Pos(Card0Min.x + 12.0f, Card0Max.y - 20.0f);
    DrawList->AddText(ImGui::GetFont(), 12.0f, Lab0Pos, HexColour(0xffffff, 0.56f), "Visible");

    // ── Hidden Card ──────────────────────────────────────────────────────────────────────────────────────────────────
    const ImVec2 Card1Min(Card0Max.x + CardGap, WinPos.y + StartY);
    const ImVec2 Card1Max(Card1Min.x + CardWidth, Card1Min.y + CardHeight);
    DrawList->AddRectFilled(Card1Min, Card1Max, HexColour(0xffffff, 0.035f), 14.0f);
    DrawList->AddRect(Card1Min, Card1Max, HexColour(0xffffff, 0.07f), 14.0f, 0, 1.0f);

    // Warning circular badge
    const ImVec2 Badge1Center(Card1Min.x + 22.0f, Card1Min.y + 22.0f);
    const bool HasHidden = Stats.HiddenCount > 0u;
    const ImU32 Badge1Bg = HasHidden ? HexColour(0xff3b30, 0.18f) : HexColour(0xffffff, 0.06f);
    const ImU32 Badge1Col = HasHidden ? HexColour(0xff3b30, 1.0f) : HexColour(0xffffff, 0.35f);
    DrawList->AddCircleFilled(Badge1Center, 11.0f, Badge1Bg, 16);
    RenderVectorIcon(DrawList, OutlinerIconCategory::StatusWarn, Badge1Center.x - 6.0f, Badge1Center.y - 6.0f, 12.0f, Badge1Col, 1.8f);

    // Large number "Hidden"
    char HidBuf[16];
    std::snprintf(HidBuf, sizeof(HidBuf), "%u", Stats.HiddenCount);
    const ImVec2 Num1Pos(Card1Max.x - 14.0f - ImGui::CalcTextSize(HidBuf).x, Card1Min.y + 12.0f);
    DrawList->AddText(ImGui::GetFont(), 26.0f, Num1Pos, HexColour(0xffffff, 0.95f), HidBuf);

    // Label "Hidden"
    const ImVec2 Lab1Pos(Card1Min.x + 12.0f, Card1Max.y - 20.0f);
    DrawList->AddText(ImGui::GetFont(), 12.0f, Lab1Pos, HexColour(0xffffff, 0.56f), "Hidden");

    ImGui::SetCursorPosX(MarginX);
    ImGui::Dummy(ImVec2(WindowWidth - MarginX * 2.0f, CardHeight + 10.0f));
}

//============================================================================================================================================
//                                                     SEARCH BAR
//============================================================================================================================================

void OutlinerPanel::RenderSearchBar() noexcept
{
    const float WindowWidth = ImGui::GetWindowWidth();
    const float MarginX = 14.0f;
    const float BarWidth = WindowWidth - MarginX * 2.0f;
    const float BarHeight = 36.0f;

    const float StartY = ImGui::GetCursorPosY();
    const ImVec2 WinPos = ImGui::GetWindowPos();
    ImDrawList* DrawList = ImGui::GetWindowDrawList();

    const ImVec2 BarMin(WinPos.x + MarginX, WinPos.y + StartY);
    const ImVec2 BarMax(BarMin.x + BarWidth, BarMin.y + BarHeight);

    // Pill background & border
    DrawList->AddRectFilled(BarMin, BarMax, HexColour(0xffffff, 0.045f), 18.0f);
    DrawList->AddRect(BarMin, BarMax, HexColour(0xffffff, 0.08f), 18.0f, 0, 1.0f);

    // Magnifying glass SVG icon on left
    RenderVectorIcon(DrawList, OutlinerIconCategory::Search, BarMin.x + 12.0f, BarMin.y + 10.0f, 15.0f, HexColour(0xffffff, 0.35f), 1.8f);

    // Transparent text input
    ImGui::SetCursorPos(ImVec2(MarginX + 34.0f, StartY + 6.0f));
    ImGui::SetNextItemWidth(BarWidth - 44.0f);

    ImGui::PushStyleColor(ImGuiCol_FrameBg, ImVec4(0, 0, 0, 0));
    ImGui::PushStyleColor(ImGuiCol_Border,  ImVec4(0, 0, 0, 0));
    ImGui::PushStyleColor(ImGuiCol_Text,    ImVec4(0.95f, 0.95f, 0.98f, 1.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_FramePadding, ImVec2(0.0f, 2.0f));

    ImGui::InputTextWithHint("##SearchInput", "Search  Ctrl+Shift+F", SearchBuffer, sizeof(SearchBuffer));

    ImGui::PopStyleVar();
    ImGui::PopStyleColor(3);

    ImGui::SetCursorPos(ImVec2(MarginX, StartY + BarHeight + 8.0f));
    ImGui::Dummy(ImVec2(BarWidth, 0.0f));
}

//============================================================================================================================================
//                                                   DOMAIN FILTERS
//============================================================================================================================================

void OutlinerPanel::RenderDomainFilters() noexcept
{
    struct FilterButton
    {
        OutlinerDomainCategory Domain;
        const char*            Label;
        uint32_t               DotColourHex;
    };

    static const FilterButton Buttons[] = {
        { OutlinerDomainCategory::Lights,   "Lights",   0xffb454 },
        { OutlinerDomainCategory::Sky,      "Sky",      0x5aa9ff },
        { OutlinerDomainCategory::Bodies,   "Bodies",   0xdfe6f5 },
        { OutlinerDomainCategory::Geometry, "Geometry", 0xe2e8f0 },
        { OutlinerDomainCategory::Camera,   "Camera",   0x34c759 }
    };

    const float MarginX = 14.0f;
    ImGui::SetCursorPosX(MarginX);

    ImDrawList* DrawList = ImGui::GetWindowDrawList();
    const ImVec2 WinPos = ImGui::GetWindowPos();

    for (size_t I = 0; I < 5u; ++I)
    {
        const auto& B = Buttons[I];
        const bool Active = ActiveDomains.find(B.Domain) != ActiveDomains.end();

        ImGui::PushID(B.Label);
        const ImVec2 LabelSize = ImGui::CalcTextSize(B.Label);
        const float BtnWidth = LabelSize.x + 22.0f;
        const float BtnHeight = 24.0f;

        const ImVec2 CurPos = ImGui::GetCursorPos();
        if (ImGui::InvisibleButton(B.Label, ImVec2(BtnWidth, BtnHeight)))
        {
            if (Active) ActiveDomains.erase(B.Domain);
            else        ActiveDomains.insert(B.Domain);
        }

        const bool Hovered = ImGui::IsItemHovered();
        const ImVec2 Min(WinPos.x + CurPos.x, WinPos.y + CurPos.y);
        const ImVec2 Max(Min.x + BtnWidth, Min.y + BtnHeight);

        const ImU32 BgCol = Active ? HexColour(0xffffff, 0.10f) : (Hovered ? HexColour(0xffffff, 0.05f) : HexColour(0, 0.0f));
        const ImU32 BorderCol = Active ? HexColour(0xffffff, 0.20f) : HexColour(0xffffff, 0.07f);
        DrawList->AddRectFilled(Min, Max, BgCol, 12.0f);
        DrawList->AddRect(Min, Max, BorderCol, 12.0f, 0, 1.0f);

        // Indicator dot
        const ImVec2 DotCenter(Min.x + 9.0f, Min.y + 12.0f);
        DrawList->AddCircleFilled(DotCenter, 3.0f, HexColour(B.DotColourHex, Active ? 1.0f : 0.65f), 12);

        // Text
        const ImU32 TextCol = Active ? HexColour(0xffffff, 0.95f) : HexColour(0xffffff, 0.45f);
        DrawList->AddText(ImGui::GetFont(), 11.0f, ImVec2(Min.x + 16.0f, Min.y + 5.0f), TextCol, B.Label);

        ImGui::PopID();
        if (I + 1u < 5u) ImGui::SameLine(0.0f, 5.0f);
    }

    ImGui::Spacing();
}

//============================================================================================================================================
//                                                  HIERARCHY TREE
//============================================================================================================================================

void OutlinerPanel::RenderHierarchyTree() noexcept
{
    const float WindowHeight = ImGui::GetWindowHeight();
    const float FooterHeight = 52.0f;
    const float StartY = ImGui::GetCursorPosY();
    const float TreeHeight = std::max(60.0f, WindowHeight - StartY - FooterHeight - 4.0f);

    ImGui::PushStyleColor(ImGuiCol_ChildBg, ImVec4(0, 0, 0, 0));
    ImGui::BeginChild("OutlinerTreeArea", ImVec2(0.0f, TreeHeight), false, ImGuiWindowFlags_None);

    // Walk all root records (ScopeIdentifier empty)
    RenderTreeBranch("", 0u);

    ImGui::EndChild();
    ImGui::PopStyleColor();
}

void OutlinerPanel::RenderTreeBranch(std::string_view ScopeId, uint32_t Depth) noexcept
{
    for (auto& R : Records)
    {
        if (R.ScopeIdentifier == ScopeId)
        {
            // Visibility filter check
            const bool DirectMatch = PassesFilter(R);
            const bool HasSub = HasVisibleDescendant(R);

            if (!DirectMatch && !HasSub && SearchBuffer[0] != '\0')
                continue;

            // Check if record has any subordinate records in the database
            bool HasKids = false;
            for (const auto& K : Records)
            {
                if (K.ScopeIdentifier == R.Identifier)
                {
                    HasKids = true;
                    break;
                }
            }

            RenderRow(R, Depth, HasKids);

            if (HasKids && (R.OpenCondition || SearchBuffer[0] != '\0'))
            {
                RenderTreeBranch(R.Identifier, Depth + 1u);
            }
        }
    }
}

void OutlinerPanel::RenderRow(OutlinerRecord& Record, uint32_t Depth, bool HasSubordinates) noexcept
{
    const float RowHeight = CompactCondition ? 30.0f : 36.0f;
    const float WindowWidth = ImGui::GetWindowWidth();
    const float LeftPadding = 8.0f + static_cast<float>(Depth) * 16.0f;

    ImDrawList* DrawList = ImGui::GetWindowDrawList();
    const ImVec2 WinPos = ImGui::GetWindowPos();
    const float StartY = ImGui::GetCursorPosY();

    const ImVec2 RowMin(WinPos.x + 8.0f, WinPos.y + StartY);
    const ImVec2 RowMax(WinPos.x + WindowWidth - 8.0f, RowMin.y + RowHeight);

    ImGui::PushID(Record.Identifier.c_str());

    // Row interaction button
    ImGui::SetCursorPos(ImVec2(8.0f, StartY));
    const bool RowClicked = ImGui::InvisibleButton("##RowSelect", ImVec2(WindowWidth - 16.0f, RowHeight));

    const bool IsSelected = (SelectedIdentifier == Record.Identifier);
    const bool IsHovered = ImGui::IsItemHovered();

    // Drag and drop source for reparenting
    if (!Record.GroupCondition && ImGui::BeginDragDropSource(ImGuiDragDropFlags_None))
    {
        ImGui::SetDragDropPayload("OUTLINER_IDENTIFIER", Record.Identifier.c_str(), Record.Identifier.size() + 1u);
        ImGui::Text("Move %s", Record.DisplayName.c_str());
        ImGui::EndDragDropSource();
    }

    // Drag and drop target (drop onto folders/records to reparent)
    if (ImGui::BeginDragDropTarget())
    {
        if (const ImGuiPayload* Payload = ImGui::AcceptDragDropPayload("OUTLINER_IDENTIFIER"))
        {
            const char* DroppedId = static_cast<const char*>(Payload->Data);
            if (DroppedId && std::string_view(DroppedId) != Record.Identifier)
            {
                AssignScope(DroppedId, Record.GroupCondition ? Record.Identifier : Record.ScopeIdentifier);
            }
        }
        ImGui::EndDragDropTarget();
    }

    // ── Row Background ───────────────────────────────────────────────────────────────────────────────────────────────
    if (IsSelected)
    {
        DrawList->AddRectFilled(RowMin, RowMax, HexColour(0xffffff, 0.09f), 10.0f);
        DrawList->AddRect(RowMin, RowMax, HexColour(0xffffff, 0.12f), 10.0f, 0, 1.0f);

        // Left accent indicator bar (--acc: color)
        const ImU32 AccentCol = PackColour(Record.AccentColour);
        const ImVec2 AccMin(RowMin.x + 2.0f, RowMin.y + 6.0f);
        const ImVec2 AccMax(RowMin.x + 5.0f, RowMax.y - 6.0f);
        DrawList->AddRectFilled(AccMin, AccMax, AccentCol, 2.0f);
    }
    else if (IsHovered)
    {
        DrawList->AddRectFilled(RowMin, RowMax, HexColour(0xffffff, 0.045f), 10.0f);
    }

    const float AlphaFactor = Record.VisibleCondition ? 1.0f : 0.40f;

    // ── Expand/Collapse Chevron ──────────────────────────────────────────────────────────────────────────────────────
    float CursorX = RowMin.x + LeftPadding;
    const ImVec2 ChevMin(CursorX, RowMin.y + (RowHeight - 16.0f) * 0.5f);
    const ImVec2 ChevMax(CursorX + 16.0f, ChevMin.y + 16.0f);

    if (HasSubordinates)
    {
        const ImU32 ChevCol = HexColour(0xffffff, 0.40f);
        const OutlinerIconCategory ChevIcon = Record.OpenCondition ? OutlinerIconCategory::ChevronDown : OutlinerIconCategory::ChevronRight;
        RenderVectorIcon(DrawList, ChevIcon, ChevMin.x, ChevMin.y, 14.0f, ChevCol, 2.0f);
    }
    CursorX += 18.0f;

    // ── Entity Icon ──────────────────────────────────────────────────────────────────────────────────────────────────
    const float IconSize = CompactCondition ? 16.0f : 20.0f;
    const ImVec2 IconPos(CursorX, RowMin.y + (RowHeight - IconSize) * 0.5f);
    ColorQuad ColMod = Record.AccentColour;
    ColMod.Alpha *= AlphaFactor;
    RenderVectorIcon(DrawList, Record.Icon, IconPos.x, IconPos.y, IconSize, PackColour(ColMod), 1.8f);
    CursorX += IconSize + 8.0f;

    // ── Entity Display Name ──────────────────────────────────────────────────────────────────────────────────────────
    const float TextY = RowMin.y + (RowHeight - 14.0f) * 0.5f;
    if (Record.GroupCondition)
    {
        // Uppercase folder name style
        std::string Upper = Record.DisplayName;
        std::transform(Upper.begin(), Upper.end(), Upper.begin(), ::toupper);
        DrawList->AddText(ImGui::GetFont(), 11.0f, ImVec2(CursorX, TextY + 1.0f), HexColour(0xffffff, 0.40f * AlphaFactor), Upper.c_str());
        CursorX += ImGui::CalcTextSize(Upper.c_str()).x + 6.0f;
    }
    else
    {
        DrawList->AddText(ImGui::GetFont(), 13.0f, ImVec2(CursorX, TextY), HexColour(0xffffff, 0.92f * AlphaFactor), Record.DisplayName.c_str());
        CursorX += ImGui::CalcTextSize(Record.DisplayName.c_str()).x + 6.0f;
    }

    // Optional Classification Tag (e.g. "Comp" for post process)
    if (!Record.ClassificationTag.empty())
    {
        const ImVec2 TagSize = ImGui::CalcTextSize(Record.ClassificationTag.c_str());
        const ImVec2 TagMin(CursorX, TextY - 1.0f);
        const ImVec2 TagMax(TagMin.x + TagSize.x + 8.0f, TagMin.y + 16.0f);
        DrawList->AddRectFilled(TagMin, TagMax, HexColour(0xffffff, 0.05f), 8.0f);
        DrawList->AddRect(TagMin, TagMax, HexColour(0xffffff, 0.12f), 8.0f, 0, 1.0f);
        DrawList->AddText(ImGui::GetFont(), 9.0f, ImVec2(TagMin.x + 4.0f, TagMin.y + 2.0f), HexColour(0xffffff, 0.50f), Record.ClassificationTag.c_str());
    }

    // ── Right-Side Affordances (Eye toggle, Status badge, Metadata) ──────────────────────────────────────────────────
    float RightX = RowMax.x - 6.0f;

    // ① Visibility Eye Button (far right)
    RightX -= 22.0f;
    const ImVec2 EyeMin(RightX, RowMin.y + (RowHeight - 22.0f) * 0.5f);
    const ImVec2 EyeMax(RightX + 22.0f, EyeMin.y + 22.0f);

    const ImVec2 MousePos = ImGui::GetIO().MousePos;
    const bool EyeHovered = (MousePos.x >= EyeMin.x && MousePos.x <= EyeMax.x && MousePos.y >= EyeMin.y && MousePos.y <= EyeMax.y);

    const bool ShowEye = EyeHovered || IsSelected || !Record.VisibleCondition;
    if (ShowEye)
    {
        const OutlinerIconCategory EyeIcon = Record.VisibleCondition ? OutlinerIconCategory::EyeVisible : OutlinerIconCategory::EyeHidden;
        const ImU32 EyeCol = Record.VisibleCondition ? HexColour(0xffffff, EyeHovered ? 0.95f : 0.40f) : HexColour(0xff3b30, 0.90f);
        RenderVectorIcon(DrawList, EyeIcon, EyeMin.x + 3.0f, EyeMin.y + 3.0f, 16.0f, EyeCol, 1.8f);
    }

    // ② Status Badge (16x16 circle with checkmark/warning/dot)
    RightX -= 20.0f;
    const ImVec2 StatCenter(RightX + 8.0f, RowMin.y + RowHeight * 0.5f);
    ImU32 StatBg = HexColour(0x34c759, 1.0f);
    ImU32 StatIconCol = HexColour(0x0b1a12, 1.0f);
    OutlinerIconCategory StatIcon = OutlinerIconCategory::StatusCheck;

    if (Record.StatusTone == OutlinerStatusTone::Warning || !Record.VisibleCondition)
    {
        StatBg = HexColour(0xffb454, 0.20f);
        StatIconCol = HexColour(0xffb454, 1.0f);
        StatIcon = OutlinerIconCategory::StatusWarn;
    }
    else if (Record.StatusTone == OutlinerStatusTone::Informational)
    {
        StatBg = HexColour(0xffffff, 0.08f);
        StatIconCol = HexColour(0xffffff, 0.50f);
        StatIcon = OutlinerIconCategory::StatusDot;
    }
    DrawList->AddCircleFilled(StatCenter, 8.0f, StatBg, 16);
    RenderVectorIcon(DrawList, StatIcon, StatCenter.x - 5.0f, StatCenter.y - 5.0f, 10.0f, StatIconCol, 2.0f);

    // ③ Metadata Summary Text (AM 1.00, 0.0°, 3.20 kcd, etc.)
    if (!CompactCondition && !Record.SummaryText.empty())
    {
        const ImVec2 MetaSize = ImGui::CalcTextSize(Record.SummaryText.c_str());
        RightX -= MetaSize.x + 10.0f;
        DrawList->AddText(ImGui::GetFont(), 11.0f, ImVec2(RightX, TextY + 1.0f), HexColour(0xffffff, 0.35f * AlphaFactor), Record.SummaryText.c_str());
    }

    // Handle Clicks
    if (RowClicked)
    {
        if (HasSubordinates && MousePos.x >= ChevMin.x && MousePos.x <= ChevMax.x && MousePos.y >= ChevMin.y && MousePos.y <= ChevMax.y)
        {
            Record.OpenCondition = !Record.OpenCondition;
        }
        else if (MousePos.x >= EyeMin.x && MousePos.x <= EyeMax.x && MousePos.y >= EyeMin.y && MousePos.y <= EyeMax.y)
        {
            AssignVisibility(Record.Identifier, !Record.VisibleCondition);
        }
        else
        {
            SelectedIdentifier = Record.Identifier;
        }
    }

    ImGui::PopID();
}

//============================================================================================================================================
//                                                        FOOTER
//============================================================================================================================================

void OutlinerPanel::RenderFooter() noexcept
{
    const float WindowWidth = ImGui::GetWindowWidth();
    const float WindowHeight = ImGui::GetWindowHeight();
    const float FooterHeight = 50.0f;
    const float StartY = WindowHeight - FooterHeight;

    ImDrawList* DrawList = ImGui::GetWindowDrawList();
    const ImVec2 WinPos = ImGui::GetWindowPos();

    // Top border divider line
    const ImVec2 LineStart(WinPos.x + 14.0f, WinPos.y + StartY);
    const ImVec2 LineEnd(WinPos.x + WindowWidth - 14.0f, WinPos.y + StartY);
    DrawList->AddLine(LineStart, LineEnd, HexColour(0xffffff, 0.07f), 1.0f);

    // 5 metric items: Realtime, Quality, Sun, Moons, Cam
    const float ItemWidth = (WindowWidth - 28.0f) / 5.0f;

    struct MetricSpec
    {
        const char* Label;
        char        Reading[24];
        const char* Unit;
    };

    MetricSpec Metrics[5];
    Metrics[0] = { "REALTIME", {}, "fps" };
    std::snprintf(Metrics[0].Reading, sizeof(Metrics[0].Reading), "%.0f", CurrentTelemetry.FramesPerSecond);

    Metrics[1] = { "QUALITY", {}, "" };
    std::snprintf(Metrics[1].Reading, sizeof(Metrics[1].Reading), "%s", CurrentTelemetry.QualityTierText);

    Metrics[2] = { "SUN", {}, "" };
    std::snprintf(Metrics[2].Reading, sizeof(Metrics[2].Reading), "%.1f°", CurrentTelemetry.SunElevationDegrees);

    Metrics[3] = { "MOONS", {}, "/ 4" };
    std::snprintf(Metrics[3].Reading, sizeof(Metrics[3].Reading), "%u", CurrentTelemetry.MoonsInOrbitCount);

    Metrics[4] = { "CAM", {}, "" };
    std::snprintf(Metrics[4].Reading, sizeof(Metrics[4].Reading), "%.0f, %.0f, %.0f",
                  CurrentTelemetry.CameraPositionX, CurrentTelemetry.CameraPositionY, CurrentTelemetry.CameraPositionZ);

    for (size_t I = 0; I < 5u; ++I)
    {
        const float ItemX = WinPos.x + 14.0f + static_cast<float>(I) * ItemWidth;
        const float LabelY = WinPos.y + StartY + 8.0f;
        const float ValueY = LabelY + 12.0f;

        // Metric label
        DrawList->AddText(ImGui::GetFont(), 9.0f, ImVec2(ItemX, LabelY), HexColour(0xffffff, 0.32f), Metrics[I].Label);

        // Metric reading
        DrawList->AddText(ImGui::GetFont(), 13.0f, ImVec2(ItemX, ValueY), HexColour(0xffffff, 0.92f), Metrics[I].Reading);

        // Unit if present
        if (Metrics[I].Unit[0] != '\0')
        {
            const float ValW = ImGui::CalcTextSize(Metrics[I].Reading).x;
            DrawList->AddText(ImGui::GetFont(), 10.0f, ImVec2(ItemX + ValW + 3.0f, ValueY + 2.0f), HexColour(0xffffff, 0.35f), Metrics[I].Unit);
        }
    }

    ImGui::SetCursorPos(ImVec2(14.0f, StartY));
    ImGui::Dummy(ImVec2(WindowWidth - 28.0f, FooterHeight));
}

} // namespace Frontier
