//=============================================================================================================================================
// SolidArcEditorHost.cpp
//=============================================================================================================================================

#include "SolidArcEditorHost.h"
#include "../../../../../Engine/Editor/SunInspectorPanel.h"
#include "../../../../../Engine/DisplayPresentation/IconPresentation.h"

#include <imgui.h>
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

SolidArcEditorHost::~SolidArcEditorHost() noexcept
{
    ControlCentre_.Terminate();
}

void SolidArcEditorHost::AdvanceControlCentre() noexcept
{
#ifdef FRONTIER_DEVELOPMENT
    ImGuiIO& Input = ImGui::GetIO();
    const ImVec2 Display = Input.DisplaySize;
    if (!ControlCentreSeated_ && Display.x > 0.0f && Display.y > 0.0f)
    {
        ControlCentreSeated_ = ControlCentre_.Initialize(
            static_cast<uint32_t>(Display.x + 0.5f),
            static_cast<uint32_t>(Display.y + 0.5f));
        if (ControlCentreSeated_)
        {
            ControlCentre_.AssignNotchWidth(200.0f);
            ControlCentre_.AssignProjectName("SolidArc");
        }
    }
    if (!ControlCentreSeated_)
        return;

    const float Scale = std::clamp(
        ControlCentre_.QueryAppearance().QueryApplied().InterfaceScale / 100.0f,
        0.5f,
        2.0f);
    ControlCentre_.Resize(
        static_cast<uint32_t>(Display.x / Scale + 0.5f),
        static_cast<uint32_t>(Display.y / Scale + 0.5f));
    ControlInput_.AssignCursorPosition(Input.MousePos.x * Scale, Input.MousePos.y * Scale);
    ControlInput_.AssignMouseButton(MouseButtonCategory::ButtonLeft, Input.MouseDown[0]);
    ControlInput_.ResetMouseScroll();
    if (Input.MouseWheel != 0.0f)
        ControlInput_.AssignMouseScroll(Input.MouseWheel);
    ControlCentre_.AdvanceInteraction(ControlInput_, Input.MousePos.x, Input.MousePos.y);
    ControlCentre_.AdvanceLocomotion(Input.DeltaTime);
#endif
}

void SolidArcEditorHost::RecordControlCentre() noexcept
{
#ifdef FRONTIER_DEVELOPMENT
    if (!ControlCentreSeated_)
        return;

    ImGuiViewport* Main = ImGui::GetMainViewport();
    const float Scale = std::clamp(
        ControlCentre_.QueryAppearance().QueryApplied().InterfaceScale / 100.0f,
        0.5f,
        2.0f);
    if (ControlSurface_.Begin(SurfaceLayer::Above, Main->Size.x, Main->Size.y, Scale))
        ControlCentre_.ConstructControlLayout(ControlSurface_);
#endif
}

void SolidArcEditorHost::ApplyTheme() noexcept
{
    PrepareSunInspectorFonts();
    IconPresentation::Attach();
    ImGuiStyle& Applied = ImGui::GetStyle();
#ifdef FRONTIER_DEVELOPMENT
    Applied.TabSlant                  = 14.0f;
    Applied.TabOverlap                = 24.0f;
    Applied.TabHeight                 = 24.0f;
    Applied.TabStripPadTop            = 4.0f;
    Applied.TabMinWidthBase           = 110.0f;
    Applied.TabMinWidthShrink         = 110.0f;
    Applied.DockingNodeHasCloseButton = false;
    Applied.TabRounding               = 0.0f;
    Applied.TabBorderSize             = 0.0f;
    Applied.TabBarBorderSize          = 0.0f;
    Applied.TabButtonRounding         = 1.0f;
#endif
    Applied.WindowPadding     = ImVec2(14.0f, 12.0f);
    Applied.FramePadding      = ImVec2(13.0f, 9.0f);
    Applied.ItemSpacing       = ImVec2(10.0f, 8.0f);
    Applied.ItemInnerSpacing  = ImVec2(6.0f, 4.0f);
    Applied.ScrollbarSize     = 8.0f;
    Applied.WindowRounding    = 8.0f;
    Applied.ChildRounding     = 12.0f;
    Applied.FrameRounding     = 16.0f;
    Applied.PopupRounding     = 18.0f;
    Applied.ScrollbarRounding = 9.0f;
    Applied.GrabRounding      = 12.0f;
    Applied.WindowBorderSize  = 1.0f;
    Applied.ChildBorderSize   = 0.0f;
    Applied.FrameBorderSize   = 1.0f;
    Applied.PopupBorderSize   = 1.0f;

    ImVec4* Tints = Applied.Colors;
    Tints[ImGuiCol_Text]                       = ImVec4(0.941f, 0.941f, 0.941f, 1.0f);
    Tints[ImGuiCol_TextDisabled]               = ImVec4(0.361f, 0.361f, 0.361f, 1.0f);
    Tints[ImGuiCol_WindowBg]                   = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Tints[ImGuiCol_ChildBg]                    = ImVec4(0.000f, 0.000f, 0.000f, 0.0f);
    Tints[ImGuiCol_PopupBg]                    = ImVec4(0.102f, 0.102f, 0.102f, 1.0f);
    Tints[ImGuiCol_Border]                     = ImVec4(1.000f, 1.000f, 1.000f, 0.05f);
    Tints[ImGuiCol_BorderShadow]               = ImVec4(0.000f, 0.000f, 0.000f, 0.0f);
    Tints[ImGuiCol_FrameBg]                    = ImVec4(0.000f, 0.000f, 0.000f, 1.0f);
    Tints[ImGuiCol_FrameBgHovered]             = ImVec4(0.031f, 0.031f, 0.031f, 1.0f);
    Tints[ImGuiCol_FrameBgActive]              = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Tints[ImGuiCol_MenuBarBg]                  = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Tints[ImGuiCol_TitleBg]                    = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Tints[ImGuiCol_TitleBgActive]              = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Tints[ImGuiCol_TitleBgCollapsed]           = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Tints[ImGuiCol_ScrollbarBg]                = ImVec4(0.000f, 0.000f, 0.000f, 0.0f);
    Tints[ImGuiCol_ScrollbarGrab]              = ImVec4(0.141f, 0.141f, 0.141f, 1.0f);
    Tints[ImGuiCol_ScrollbarGrabHovered]       = ImVec4(0.180f, 0.180f, 0.180f, 1.0f);
    Tints[ImGuiCol_ScrollbarGrabActive]        = ImVec4(0.200f, 0.200f, 0.200f, 1.0f);
    Tints[ImGuiCol_CheckMark]                  = ImVec4(1.000f, 1.000f, 1.000f, 1.0f);
    Tints[ImGuiCol_SliderGrab]                 = ImVec4(0.878f, 0.878f, 0.878f, 1.0f);
    Tints[ImGuiCol_SliderGrabActive]           = ImVec4(1.000f, 1.000f, 1.000f, 1.0f);
    Tints[ImGuiCol_Button]                     = ImVec4(0.133f, 0.133f, 0.133f, 1.0f);
    Tints[ImGuiCol_ButtonHovered]              = ImVec4(0.180f, 0.180f, 0.180f, 1.0f);
    Tints[ImGuiCol_ButtonActive]               = ImVec4(0.220f, 0.220f, 0.220f, 1.0f);
    Tints[ImGuiCol_Header]                     = ImVec4(0.165f, 0.165f, 0.165f, 1.0f);
    Tints[ImGuiCol_HeaderHovered]              = ImVec4(0.110f, 0.110f, 0.110f, 1.0f);
    Tints[ImGuiCol_HeaderActive]               = ImVec4(0.165f, 0.165f, 0.165f, 1.0f);
    Tints[ImGuiCol_Separator]                  = ImVec4(0.180f, 0.180f, 0.180f, 1.0f);
    Tints[ImGuiCol_SeparatorHovered]           = ImVec4(0.298f, 0.302f, 1.000f, 1.0f);
    Tints[ImGuiCol_SeparatorActive]            = ImVec4(0.424f, 0.467f, 1.000f, 1.0f);
    Tints[ImGuiCol_ResizeGrip]                 = ImVec4(0.180f, 0.180f, 0.180f, 1.0f);
    Tints[ImGuiCol_ResizeGripHovered]          = ImVec4(0.298f, 0.302f, 1.000f, 1.0f);
    Tints[ImGuiCol_ResizeGripActive]           = ImVec4(0.424f, 0.467f, 1.000f, 1.0f);
    Tints[ImGuiCol_Tab]                        = ImVec4(0.149f, 0.149f, 0.173f, 1.0f);
    Tints[ImGuiCol_TabHovered]                 = ImVec4(0.196f, 0.196f, 0.227f, 1.0f);
    Tints[ImGuiCol_TabSelected]                = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Tints[ImGuiCol_TabDimmed]                  = ImVec4(0.118f, 0.118f, 0.141f, 1.0f);
    Tints[ImGuiCol_TabDimmedSelected]          = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Tints[ImGuiCol_TabSelectedOverline]        = ImVec4(0.000f, 0.000f, 0.000f, 0.0f);
    Tints[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.000f, 0.000f, 0.000f, 0.0f);
    Tints[ImGuiCol_DockingPreview]             = ImVec4(1.000f, 1.000f, 1.000f, 0.12f);
    Tints[ImGuiCol_TextSelectedBg]             = ImVec4(0.424f, 0.467f, 1.000f, 0.35f);
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
    AdvanceControlCentre();
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

    RecordControlCentre();
}

uint32_t SolidArcEditorHost::QueryPickedFigureIdentity() const noexcept
{
    const uint32_t Picked = Outliner_.QueryPicked();
    if (Picked >= RowCount_ || Bindings_[Picked].RowRole != SolidArcOutlinerBinding::Role::Figure)
        return 0u;
    return Bindings_[Picked].FigureIdentity;
}

} // namespace Frontier
