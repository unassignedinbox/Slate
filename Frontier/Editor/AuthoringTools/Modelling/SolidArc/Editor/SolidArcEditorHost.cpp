//=============================================================================================================================================
// SolidArcEditorHost.cpp
//=============================================================================================================================================

#include "SolidArcEditorHost.h"
#include "../../../../../Engine/Editor/SunInspectorPanel.h"
#include "../../../../../Engine/DisplayPresentation/IconPresentation.h"

#include <imgui.h>
#include <imgui_internal.h>

#include <algorithm>
#include <cstdio>

namespace Frontier {

SolidArcEditorHost::SolidArcEditorHost() noexcept
{
    Outliner_.AssignControls(&Controls_);
    Viewport_.AssignControls(&Controls_);
    Inspector_.AssignControls(&Controls_);
    Viewport_.AssignShadeOpen(&ShadeOpen_);
    Shade_.AssignProjectName("SolidArc");
    Outliner_.AssignTabOpen(&OutlinerTabOpen_);
    Viewport_.AssignTabOpen(&ViewportTabOpen_);
    Inspector_.AssignTabOpen(&InspectorTabOpen_);
    Outliner_.AssignWindowTitle("SolidArc Outliner");
    Viewport_.AssignWindowTitle("SolidArc Viewport");
    Inspector_.AssignWindowTitle("SolidArc Inspector");
    // SolidArc uses its CAD filter catalogue, not Project-Zero's game narrowing labels.
    // Colours match the web editor KINDS palette: curve/sketch #4fd8e0, body #ffb454,
    // surface #4da3ff, construction plane #b48cff and dimensions #e5d33a.
    const OutlinerFilterEntry SolidArcFilters[] =
    {
        { "Lines",        IM_COL32(79, 216, 224, 255), SolidArcOutlinerFilter::Lines },
        { "Profiles",     IM_COL32(79, 216, 224, 255), SolidArcOutlinerFilter::Profiles },
        { "Bodies",       IM_COL32(255, 180, 84, 255), SolidArcOutlinerFilter::Bodies },
        { "Surfaces",     IM_COL32(77, 163, 255, 255), SolidArcOutlinerFilter::Surfaces },
        { "Construction", IM_COL32(180, 140, 255, 255), SolidArcOutlinerFilter::Construction },
        { "Dimensions",   IM_COL32(229, 211, 58, 255), SolidArcOutlinerFilter::Dimensions },
    };
    Outliner_.AssignFilterCatalog(SolidArcFilters, static_cast<uint32_t>(sizeof(SolidArcFilters) / sizeof(SolidArcFilters[0])));
    Viewport_.AssignChrome(ViewportPanelChrome::SolidArcCad);
    Outliner_.AssignReadout(&Readout_);
    Viewport_.AssignReadout(&Readout_);
    Inspector_.AssignReadout(&Readout_);
}

void SolidArcEditorHost::ApplyTheme() noexcept
{
    PrepareSunInspectorFonts();
    IconPresentation::Attach();
    ImGuiStyle& Style = ImGui::GetStyle();
#ifdef FRONTIER_DEVELOPMENT
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
    // Keep this sheet identical to EditorHost::ApplyTheme.  In particular,
    // FramePadding/spacing affect the patched trapezoid's measured contour;
    // omitting them made the SolidArc tabs look like a different widget.
    Style.WindowPadding      = ImVec2(14.0f, 12.0f);
    Style.FramePadding       = ImVec2(13.0f, 9.0f);
    Style.ItemSpacing        = ImVec2(10.0f, 8.0f);
    Style.ItemInnerSpacing   = ImVec2(6.0f, 4.0f);
    Style.WindowRounding     = 8.0f;
    Style.ChildRounding      = 12.0f;
    Style.FrameRounding      = 16.0f;
    Style.PopupRounding      = 18.0f;
    Style.ScrollbarRounding  = 9.0f;
    Style.GrabRounding       = 12.0f;
    Style.WindowBorderSize   = 1.0f;
    Style.ChildBorderSize    = 0.0f;
    Style.FrameBorderSize    = 1.0f;
    Style.PopupBorderSize    = 1.0f;
    Style.ScrollbarSize      = 8.0f;

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
    // Current docking ImGui paints selected/dimmed tabs through these slots.
    // Leaving them at the default style was the source of SolidArc's blue tab.
    Colours[ImGuiCol_TabUnfocused]             = ImVec4(0.149f, 0.149f, 0.173f, 1.0f);
    Colours[ImGuiCol_TabUnfocusedActive]       = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Colours[ImGuiCol_TabDimmed]                 = ImVec4(0.118f, 0.118f, 0.141f, 1.0f);
    Colours[ImGuiCol_TabDimmedSelected]         = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Colours[ImGuiCol_TabSelectedOverline]       = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    Colours[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
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
#ifdef FRONTIER_DEVELOPMENT
    ImGuiIO& IO = ImGui::GetIO();
    if (!ShadeSeated_)
    {
        ShadeSeated_ = Shade_.Initialize(static_cast<uint32_t>(IO.DisplaySize.x + 0.5f),
                                         static_cast<uint32_t>(IO.DisplaySize.y + 0.5f));
        Shade_.AssignNotchWidth(200.0f);
    }
    if (ShadeSeated_)
    {
        Shade_.Resize(static_cast<uint32_t>(IO.DisplaySize.x + 0.5f),
                      static_cast<uint32_t>(IO.DisplaySize.y + 0.5f));
        ShadeInput_.AssignCursorPosition(IO.MousePos.x, IO.MousePos.y);
        ShadeInput_.AssignMouseButton(MouseButtonCategory::ButtonLeft, IO.MouseDown[0]);
        ShadeInput_.ResetMouseScroll();
        if (IO.MouseWheel != 0.0f)
            ShadeInput_.AssignMouseScroll(IO.MouseWheel);
        Shade_.AdvanceInteraction(ShadeInput_, IO.MousePos.x, IO.MousePos.y);
        Shade_.AdvanceLocomotion(IO.DeltaTime);
        if (!Shade_.IsDragging() && ShadeOpen_ != Shade_.IsOpen())
        {
            if (ShadeOpen_) Shade_.OpenNotch(); else Shade_.CloseNotch();
        }
        ShadeOpen_ = Shade_.IsOpen();
    }
#endif
    // Apply viewport navigation on the following frame.  This makes the cube,
    // compass and Views menu drive SolidArc's real camera rather than merely
    // changing an editor-side ornament.
    const ViewportOrbit& Orbit = Viewport_.QueryViewportOrbit();
    if (Orbit.Revision != AppliedOrbitRevision_)
    {
        static const char* Snaps[] = { nullptr, "view front", "view back", "view right",
                                       "view left", "view top", "view bottom" };
        if (Orbit.ViewPoint < 7u && Snaps[Orbit.ViewPoint] != nullptr)
            Host.Execute(Snaps[Orbit.ViewPoint]);
        else
        {
            char Command[96];
            std::snprintf(Command, sizeof(Command), "view orbit %.4f %.4f",
                          static_cast<double>(Orbit.Yaw * 57.2957795f),
                          static_cast<double>(Orbit.Pitch * 57.2957795f));
            Host.Execute(Command);
        }
        if (Orbit.Ortho)
            Host.Execute("view ortho");
        AppliedOrbitRevision_ = Orbit.Revision;
    }
    Host.Render();
    ViewImage_ = Host.Raster().Readback();
    RowCount_ = BuildSolidArcOutliner(Host, Rows_.data(), Bindings_.data(), kMaxEditorInstances, &Readout_);
    if (!ViewImage_.Pixels.empty())
        Viewport_.AssignView(ViewImage_.Pixels.data(), ViewImage_.Width, ViewImage_.Height);
    else
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
    if (PickedRow != nullptr)
        BuildSolidArcInspectorSheet(Host, Bindings_[Picked], &PickedSheet_);
    else
        BuildSolidArcInspectorSheet(Host, SolidArcOutlinerBinding{}, &PickedSheet_);
    Inspector_.Record(PickedRow, Picked, &PickedSheet_);

    ApplySolidArcOutlinerVisibility(Host, Rows_.data(), Bindings_.data(), RowCount_);
    if (Picked < RowCount_)
        ApplySolidArcInspectorSheet(Host, Bindings_[Picked], PickedSheet_);

#ifdef FRONTIER_DEVELOPMENT
    // Foreground recording is deliberately last, matching EditorHost: the
    // control notch must sit above every dock tab in both GPU and CPU paths.
    if (ShadeSeated_ && ShadeSurface_.Begin(SurfaceLayer::Above, Main->Size.x, Main->Size.y, 1.0f))
        Shade_.ConstructControlLayout(ShadeSurface_);
#endif
}

uint32_t SolidArcEditorHost::QueryPickedFigureIdentity() const noexcept
{
    const uint32_t Picked = Outliner_.QueryPicked();
    if (Picked >= RowCount_ || Bindings_[Picked].RowRole != SolidArcOutlinerBinding::Role::Figure)
        return 0u;
    return Bindings_[Picked].FigureIdentity;
}

} // namespace Frontier
