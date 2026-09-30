//============================================================================================================================================
//                                                    SOLIDARCEDITORHOST.CPP
//============================================================================================================================================

// 📦 The SolidArc CAD editor host — see SolidArcEditorHost.h.

#include "SolidArcEditorHost.h"

#include <imgui_internal.h>

#include <algorithm>

namespace Frontier {

SolidArcEditorHost::SolidArcEditorHost() noexcept
{
    Outliner_.AssignControls(&Controls_);
    Viewport_.AssignControls(&Controls_);
    Inspector_.AssignControls(&Controls_);
    Outliner_.AssignTabOpen(&OutlinerTabOpen_);
    Viewport_.AssignTabOpen(&ViewportTabOpen_);
    Inspector_.AssignTabOpen(&InspectorTabOpen_);
    Outliner_.AssignWindowTitle("SolidArc Outliner");
    Viewport_.AssignWindowTitle("SolidArc Viewport");
    Inspector_.AssignWindowTitle("SolidArc Inspector");
    // SolidArc seats its own CAD narrowing catalogue, not the game's category vocabulary. The tints are the
    //    web editor's KINDS palette: sketch/curve #4fd8e0, body #ffb454, surface #4da3ff, construction
    //    plane #b48cff, dimensions #e5d33a.
    const OutlinerNarrowingEntry SolidArcNarrowings[] =
    {
        { "Lines",        IM_COL32( 79, 216, 224, 255), SolidArcOutlinerNarrowing::Lines },
        { "Profiles",     IM_COL32( 79, 216, 224, 255), SolidArcOutlinerNarrowing::Profiles },
        { "Bodies",       IM_COL32(255, 180,  84, 255), SolidArcOutlinerNarrowing::Bodies },
        { "Surfaces",     IM_COL32( 77, 163, 255, 255), SolidArcOutlinerNarrowing::Surfaces },
        { "Construction", IM_COL32(180, 140, 255, 255), SolidArcOutlinerNarrowing::Construction },
        { "Dimensions",   IM_COL32(229, 211,  58, 255), SolidArcOutlinerNarrowing::Dimensions },
    };
    Outliner_.AssignNarrowingVocabulary(SolidArcNarrowings, static_cast<uint32_t>(sizeof(SolidArcNarrowings) / sizeof(SolidArcNarrowings[0])));
    Viewport_.AssignChrome(ViewportPanelChrome::SolidArcCad);
    Outliner_.AssignReadout(&Readout_);
    Viewport_.AssignReadout(&Readout_);
    Inspector_.AssignReadout(&Readout_);
}

void SolidArcEditorHost::SeatFaces() noexcept
{
    if (FacesSeated_ || ImGui::GetCurrentContext() == nullptr)
        return;
    FacesSeated_ = true;

    // Six faces at the sizes the panels ask for by name: the row ink at 13, the small figures at 12, the
    //    mono readouts at 13 and 11, the panel titles at 20, the census numerals at 28. All from the
    //    default face — the vendor rasterises glyphs on demand at any drawn size, so a face serves every
    //    size it is drawn at, and the standalone tool needs no content folder.
    struct FaceRequest { const char* Name; float Size; };
    const FaceRequest Requests[] =
    {
        { "SolidArc / ui",         13.0f },
        { "SolidArc / small",      12.0f },
        { "SolidArc / mono",       13.0f },
        { "SolidArc / mono small", 11.0f },
        { "SolidArc / title",      20.0f },
        { "SolidArc / display",    28.0f },
    };
    ImFont* Seated[6] = {};
    ImGuiIO& IO = ImGui::GetIO();
    if (IO.Fonts->Fonts.empty())
        IO.Fonts->AddFontDefault();
    Seated[0] = IO.Fonts->Fonts[0];
    for (int I = 1; I < 6; ++I)
    {
        ImFontConfig Config;
        Config.SizePixels = Requests[I].Size;
        std::snprintf(Config.Name, sizeof(Config.Name), "%s", Requests[I].Name);
        Seated[I] = IO.Fonts->AddFontDefault(&Config);
        if (Seated[I] == nullptr)
            Seated[I] = Seated[0];
    }
    Controls_.AssignFonts(Seated[0], Seated[1], Seated[2], Seated[3], Seated[4], Seated[5]);
}

void SolidArcEditorHost::ApplyTheme() noexcept
{
    SeatFaces();
    ImGuiStyle& Style = ImGui::GetStyle();
#ifdef FRONTIER_DEVELOPMENT
    // The trapezoidal, interlocking tab figures the patched vendor draws: the slant is the patch's
    //    TabSlant, the overlap interlocks the slanted edges, and the strip's own paddings seat the band.
    Style.TabSlant                  = 14.0f;
    Style.TabOverlap                = 24.0f;
    Style.TabHeight                 = 24.0f;
    Style.TabStripPadTop            = 4.0f;
    Style.TabMinWidthBase           = 110.0f;
    Style.TabMinWidthShrink         = 110.0f;
    Style.DockingNodeHasCloseButton = false;
    Style.TabRounding               = 0.0f;
    Style.TabBorderSize             = 0.0f;
    Style.TabBarBorderSize          = 0.0f;
    Style.TabButtonRounding         = 1.0f;
#endif
    Style.WindowPadding    = ImVec2(14.0f, 12.0f);
    Style.WindowRounding   = 8.0f;
    Style.ChildRounding    = 12.0f;
    Style.FrameRounding    = 16.0f;
    Style.WindowBorderSize = 1.0f;
    Style.FrameBorderSize  = 1.0f;
    Style.ScrollbarSize    = 8.0f;

    ImVec4* Colours = Style.Colors;
    Colours[ImGuiCol_WindowBg]       = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Colours[ImGuiCol_ChildBg]        = ImVec4(0.000f, 0.000f, 0.000f, 0.0f);
    Colours[ImGuiCol_Border]         = ImVec4(1.000f, 1.000f, 1.000f, 0.05f);
    Colours[ImGuiCol_FrameBg]        = ImVec4(0.000f, 0.000f, 0.000f, 1.0f);
    Colours[ImGuiCol_TitleBg]        = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Colours[ImGuiCol_TitleBgActive]  = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Colours[ImGuiCol_TitleBgCollapsed] = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Colours[ImGuiCol_Button]         = ImVec4(0.133f, 0.133f, 0.133f, 1.0f);
    Colours[ImGuiCol_ButtonHovered]  = ImVec4(0.180f, 0.180f, 0.180f, 1.0f);
    Colours[ImGuiCol_Header]         = ImVec4(0.165f, 0.165f, 0.165f, 1.0f);
    Colours[ImGuiCol_Tab]            = ImVec4(0.149f, 0.149f, 0.173f, 1.0f);
    Colours[ImGuiCol_TabHovered]     = ImVec4(0.196f, 0.196f, 0.227f, 1.0f);
    Colours[ImGuiCol_TabActive]      = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Colours[ImGuiCol_DockingPreview] = ImVec4(1.000f, 1.000f, 1.000f, 0.12f);
}

void SolidArcEditorHost::ConstructLayout() noexcept
{
    const ImGuiID DockId = ImGui::GetID("SolidArcEditorDockSpace");
    if (LayoutSeated_)
        return;
    LayoutSeated_ = true;

    ImGuiViewport* Main = ImGui::GetMainViewport();
    ImGui::DockBuilderRemoveNode(DockId);
    ImGui::DockBuilderAddNode(DockId, ImGuiDockNodeFlags_DockSpace);
    ImGui::DockBuilderSetNodeSize(DockId, Main->Size);

    ImGuiID Left = 0u, CentreAndRight = 0u, Centre = 0u, Right = 0u;
    const float LeftShare = Main->Size.x > 0.0f ? std::clamp(236.0f / Main->Size.x, 0.15f, 0.26f) : 0.18f;
    ImGui::DockBuilderSplitNode(DockId, ImGuiDir_Left, LeftShare, &Left, &CentreAndRight);
    const float RestWidth = std::max(1.0f, Main->Size.x * (1.0f - LeftShare));
    const float RightShare = std::clamp(236.0f / RestWidth, 0.16f, 0.28f);
    ImGui::DockBuilderSplitNode(CentreAndRight, ImGuiDir_Right, RightShare, &Right, &Centre);
    ImGui::DockBuilderDockWindow("SolidArc Outliner", Left);
    ImGui::DockBuilderDockWindow("SolidArc Viewport", Centre);
    ImGui::DockBuilderDockWindow("SolidArc Inspector", Right);
    LeftColumn_ = Left;
    CentreColumn_ = Centre;
    RightColumn_ = Right;
    ImGui::DockBuilderFinish(DockId);
}

void SolidArcEditorHost::Record(ConsoleHost& Host) noexcept
{
    RowCount_ = BuildSolidArcOutliner(Host, Rows_.data(), Counterparts_.data(), kMaxEditorInstances, &Readout_);
    // The viewport stays blank in this milestone: the CAD scene raster (the ConsoleHost's own CPU raster
    //    readback) seats into the panel through this same seam in the next one, so the panel already runs
    //    its blank branch every tick by design.
    Viewport_.AssignView(nullptr, 0u, 0u);

    ImGuiViewport* Main = ImGui::GetMainViewport();
    ImGui::SetNextWindowPos(ImVec2(Main->Pos.x, Main->Pos.y));
    ImGui::SetNextWindowSize(ImVec2(Main->Size.x, Main->Size.y));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    constexpr ImGuiWindowFlags HostFlags = ImGuiWindowFlags_NoTitleBar
                                         | ImGuiWindowFlags_NoResize
                                         | ImGuiWindowFlags_NoMove
                                         | ImGuiWindowFlags_NoScrollbar
                                         | ImGuiWindowFlags_NoScrollWithMouse
                                         | ImGuiWindowFlags_NoSavedSettings
                                         | ImGuiWindowFlags_NoBringToFrontOnFocus
                                         | ImGuiWindowFlags_NoNavFocus;
    if (ImGui::Begin("SolidArcDockHost", nullptr, HostFlags))
    {
        const ImGuiDockNodeFlags DockFlags =
            static_cast<ImGuiDockNodeFlags>(ImGuiDockNodeFlags_NoWindowMenuButton);
        ConstructLayout();
        ImGui::DockSpace(ImGui::GetID("SolidArcEditorDockSpace"), ImVec2(0.0f, 0.0f), DockFlags);
    }
    ImGui::End();
    ImGui::PopStyleVar(2);

    Outliner_.Record(Rows_.data(), RowCount_);
    Viewport_.Record(Rows_.data(), RowCount_);

    const uint32_t Picked = Outliner_.QueryPicked();
    EditorInstance* PickedRow = (Picked < RowCount_) ? &Rows_[Picked] : nullptr;
    // A refused sheet (a stale binding) seats the empty sheet; the inspector's own empty branch draws it.
    static_cast<void>(BuildSolidArcInspectorSheet(Host, PickedRow != nullptr ? Counterparts_[Picked] : SolidArcRowCounterpart{}, &PickedSheet_));
    Inspector_.Record(PickedRow, Picked, &PickedSheet_);

    ApplySolidArcOutlinerVisibility(Host, Rows_.data(), Counterparts_.data(), RowCount_);
    if (Picked < RowCount_)
        ApplySolidArcInspectorSheet(Host, Counterparts_[Picked], PickedSheet_);
}

uint32_t SolidArcEditorHost::QueryPickedFigureIdentity() const noexcept
{
    const uint32_t Picked = Outliner_.QueryPicked();
    if (Picked >= RowCount_ || Counterparts_[Picked].RowRole != SolidArcRowCounterpart::Role::Figure)
        return 0u;
    return Counterparts_[Picked].FigureIdentity;
}

} // namespace Frontier
