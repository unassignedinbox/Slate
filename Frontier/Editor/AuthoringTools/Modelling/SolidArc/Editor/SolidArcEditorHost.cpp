//=============================================================================================================================================
// SolidArcEditorHost.cpp
//=============================================================================================================================================

#include "SolidArcEditorHost.h"
#include "../../../../../Engine/Editor/SunInspectorPanel.h"
#include "../../../../../Engine/DisplayPresentation/IconPresentation.h"

#include <imgui.h>
#include <imgui_internal.h>

#include <algorithm>
#include <cstring>

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


SolidArcEditorHost::~SolidArcEditorHost() noexcept
{
    Shade_.Terminate();
}

bool SolidArcEditorHost::SeatShade(uint32_t Width, uint32_t Height) noexcept
{
#ifdef FRONTIER_DEVELOPMENT
    ShadeSeated_ = Shade_.Initialize(Width, Height);
    // Match Project-Zero's editor pull: narrow enough to avoid the viewport tab controls, but still the same
    // Notch/Control Centre host and geometry.
    Shade_.AssignNotchWidth(200.0f);
    Shade_.AssignProjectName("SolidArc");
    return ShadeSeated_;
#else
    (void)Width; (void)Height;
    return false;
#endif
}

void SolidArcEditorHost::TickShade(float CursorX, float CursorY, bool Down, float Wheel, float DeltaSeconds) noexcept
{
#ifdef FRONTIER_DEVELOPMENT
    if (!ShadeSeated_)
        return;

    const float Scale = std::clamp(Shade_.QueryAppearance().QueryApplied().InterfaceScale / 100.0f, 0.5f, 2.0f);
    const ImVec2 Display = ImGui::GetIO().DisplaySize;
    Shade_.Resize(static_cast<uint32_t>(Display.x / Scale + 0.5f),
                  static_cast<uint32_t>(Display.y / Scale + 0.5f));
    ShadeInput_.AssignCursorPosition(CursorX * Scale, CursorY * Scale);
    ShadeInput_.AssignMouseButton(MouseButtonCategory::ButtonLeft, Down);
    ShadeInput_.ResetMouseScroll();
    if (Wheel != 0.0f)
        ShadeInput_.AssignMouseScroll(Wheel);
    Shade_.AdvanceInteraction(ShadeInput_, CursorX, CursorY);
    Shade_.AdvanceLocomotion(DeltaSeconds);

    // The SolidArc viewport gear shares the same open bit as Project-Zero. A click on the gear asks for a pose;
    // the shade owns the animated travel and then echoes the settled/opening state back to the gear.
    if (!Shade_.IsDragging() && ShadeOpen_ != OpenEcho_)
    {
        if (ShadeOpen_)
            Shade_.OpenNotch();
        else
            Shade_.CloseNotch();
        OpenEcho_ = ShadeOpen_;
    }
    ShadeOpen_ = Shade_.IsOpen();
    OpenEcho_  = ShadeOpen_;
#else
    (void)CursorX; (void)CursorY; (void)Down; (void)Wheel; (void)DeltaSeconds;
#endif
}

bool SolidArcEditorHost::ShadeCoversPointer() const noexcept
{
#ifdef FRONTIER_DEVELOPMENT
    return ShadeSeated_ && Shade_.CoversPointer();
#else
    return false;
#endif
}

void SolidArcEditorHost::AssignProjectName(const char* Name) noexcept
{
    Shade_.AssignProjectName(Name != nullptr ? Name : "SolidArc");
}

void SolidArcEditorHost::ApplyTheme() noexcept
{
    PrepareSunInspectorFonts();
    IconPresentation::Attach();
    ImGuiStyle& Style = ImGui::GetStyle();
#ifdef FRONTIER_DEVELOPMENT
    // Same trapezoid sheet as Project-Zero / Frontier. SolidArc previously set only a subset of the
    // tab colours, leaving the focused/dimmed variants and strip tints on ImGui's blue defaults in the live
    // host and in the CPU mirror. Keep the geometry and the complete colour token set together.
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
    Colours[ImGuiCol_Text]                  = ImVec4(0.941f, 0.941f, 0.941f, 1.0f);
    Colours[ImGuiCol_TextDisabled]          = ImVec4(0.361f, 0.361f, 0.361f, 1.0f);
    Colours[ImGuiCol_WindowBg]              = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Colours[ImGuiCol_ChildBg]               = ImVec4(0.000f, 0.000f, 0.000f, 0.0f);
    Colours[ImGuiCol_PopupBg]               = ImVec4(0.102f, 0.102f, 0.102f, 1.0f);
    Colours[ImGuiCol_Border]                = ImVec4(1.000f, 1.000f, 1.000f, 0.05f);
    Colours[ImGuiCol_BorderShadow]          = ImVec4(0.000f, 0.000f, 0.000f, 0.0f);
    Colours[ImGuiCol_FrameBg]               = ImVec4(0.000f, 0.000f, 0.000f, 1.0f);
    Colours[ImGuiCol_FrameBgHovered]        = ImVec4(0.031f, 0.031f, 0.031f, 1.0f);
    Colours[ImGuiCol_FrameBgActive]         = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Colours[ImGuiCol_MenuBarBg]             = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Colours[ImGuiCol_TitleBg]               = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Colours[ImGuiCol_TitleBgActive]         = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Colours[ImGuiCol_TitleBgCollapsed]      = ImVec4(0.039f, 0.039f, 0.039f, 1.0f);
    Colours[ImGuiCol_ScrollbarBg]           = ImVec4(0.000f, 0.000f, 0.000f, 0.0f);
    Colours[ImGuiCol_ScrollbarGrab]         = ImVec4(0.141f, 0.141f, 0.141f, 1.0f);
    Colours[ImGuiCol_ScrollbarGrabHovered]  = ImVec4(0.180f, 0.180f, 0.180f, 1.0f);
    Colours[ImGuiCol_ScrollbarGrabActive]   = ImVec4(0.200f, 0.200f, 0.200f, 1.0f);
    Colours[ImGuiCol_CheckMark]             = ImVec4(1.000f, 1.000f, 1.000f, 1.0f);
    Colours[ImGuiCol_SliderGrab]            = ImVec4(0.878f, 0.878f, 0.878f, 1.0f);
    Colours[ImGuiCol_SliderGrabActive]      = ImVec4(1.000f, 1.000f, 1.000f, 1.0f);
    Colours[ImGuiCol_Button]                = ImVec4(0.133f, 0.133f, 0.133f, 1.0f);
    Colours[ImGuiCol_ButtonHovered]         = ImVec4(0.180f, 0.180f, 0.180f, 1.0f);
    Colours[ImGuiCol_ButtonActive]          = ImVec4(0.220f, 0.220f, 0.220f, 1.0f);
    Colours[ImGuiCol_Header]                = ImVec4(0.165f, 0.165f, 0.165f, 1.0f);
    Colours[ImGuiCol_HeaderHovered]         = ImVec4(0.110f, 0.110f, 0.110f, 1.0f);
    Colours[ImGuiCol_HeaderActive]          = ImVec4(0.165f, 0.165f, 0.165f, 1.0f);
    Colours[ImGuiCol_Separator]             = ImVec4(0.180f, 0.180f, 0.180f, 1.0f);
    Colours[ImGuiCol_SeparatorHovered]      = ImVec4(0.298f, 0.302f, 1.000f, 1.0f);
    Colours[ImGuiCol_SeparatorActive]       = ImVec4(0.424f, 0.467f, 1.000f, 1.0f);
    Colours[ImGuiCol_ResizeGrip]            = ImVec4(0.180f, 0.180f, 0.180f, 1.0f);
    Colours[ImGuiCol_ResizeGripHovered]     = ImVec4(0.298f, 0.302f, 1.000f, 1.0f);
    Colours[ImGuiCol_ResizeGripActive]      = ImVec4(0.424f, 0.467f, 1.000f, 1.0f);
    Colours[ImGuiCol_Tab]                   = ImVec4(0.149f, 0.149f, 0.173f, 1.0f);
    Colours[ImGuiCol_TabHovered]            = ImVec4(0.196f, 0.196f, 0.227f, 1.0f);
    Colours[ImGuiCol_TabActive]             = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Colours[ImGuiCol_TabUnfocused]          = ImVec4(0.149f, 0.149f, 0.173f, 1.0f);
    Colours[ImGuiCol_TabUnfocusedActive]    = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Colours[ImGuiCol_TabDimmed]             = ImVec4(0.118f, 0.118f, 0.141f, 1.0f);
    Colours[ImGuiCol_TabDimmedSelected]     = ImVec4(0.071f, 0.071f, 0.071f, 1.0f);
    Colours[ImGuiCol_TabSelectedOverline]   = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    Colours[ImGuiCol_TabDimmedSelectedOverline] = ImVec4(0.0f, 0.0f, 0.0f, 0.0f);
    Colours[ImGuiCol_DockingPreview]        = ImVec4(1.000f, 1.000f, 1.000f, 0.12f);
    Colours[ImGuiCol_TextSelectedBg]        = ImVec4(0.424f, 0.467f, 1.000f, 0.35f);
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
    auto ApplyViewportOrbitToCamera = [&]() noexcept
    {
        const ViewportOrbit& Orbit = Viewport_.QueryViewportOrbit();
        CameraProjection& Camera = Host.Camera();
        Camera.Yaw = -static_cast<double>(Orbit.Yaw);
        Camera.Pitch = -static_cast<double>(Orbit.Pitch);
        Camera.Distance = static_cast<double>(Orbit.Distance);
        Camera.Pivot = Vec3{ static_cast<double>(Orbit.Target[0]),
                             static_cast<double>(Orbit.Target[1]),
                             static_cast<double>(Orbit.Target[2]) };
        Camera.Orthographic = Orbit.Ortho;
    };

    if (!OrbitSeated_)
    {
        const CameraProjection& Camera = Host.Camera();
        ViewportOrbit Seated{};
        Seated.Yaw = static_cast<float>(-Camera.Yaw);
        Seated.Pitch = static_cast<float>(-Camera.Pitch);
        Seated.Distance = static_cast<float>(Camera.Distance);
        Seated.Target[0] = static_cast<float>(Camera.Pivot.X);
        Seated.Target[1] = static_cast<float>(Camera.Pivot.Y);
        Seated.Target[2] = static_cast<float>(Camera.Pivot.Z);
        Seated.Ortho = Camera.Orthographic;
        Seated.ViewPoint = 0u;
        Viewport_.SeatViewportOrbit(Seated);
        LastOrbitRevision_ = Seated.Revision;
        OrbitSeated_ = true;
    }
    ApplyViewportOrbitToCamera();

    Host.Render();
    ViewImage_ = Host.Raster().Readback();
    RowCount_ = BuildSolidArcOutliner(Host, Rows_.data(), Bindings_.data(), kMaxEditorInstances, &Readout_);
    if (!ViewImage_.Pixels.empty())
        Viewport_.AssignView(ViewImage_.Pixels.data(), ViewImage_.Width, ViewImage_.Height);
    else
        Viewport_.AssignView(nullptr, 0u, 0u);
    Viewport_.AssignAxisGuide(SolidArcAxisGuideVisible_, SolidArcAxisGuideLength_, SolidArcAxisGuideThickness_);

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
        (void)BuildSolidArcInspectorSheet(Host, Bindings_[Picked], &PickedSheet_);
    else
        (void)BuildSolidArcInspectorSheet(Host, SolidArcOutlinerBinding{}, &PickedSheet_);

    auto SeatAxisGuideProperties = [&]() noexcept
    {
        EditorPropertyGroup* Display = nullptr;
        for (uint32_t G = 0u; G < PickedSheet_.GroupCount; ++G)
        {
            if (std::strcmp(PickedSheet_.Groups[G].Title, "Display") == 0)
            {
                Display = &PickedSheet_.Groups[G];
                break;
            }
        }
        if (Display == nullptr && PickedSheet_.GroupCount < kMaxEditorSheetGroups)
        {
            Display = &PickedSheet_.Groups[PickedSheet_.GroupCount++];
            *Display = EditorPropertyGroup{};
            std::snprintf(Display->Title, sizeof(Display->Title), "Display");
        }
        if (Display == nullptr)
            return;
        auto Add = [&](const char* Label, EditorPropertyCategory Category) noexcept -> EditorProperty*
        {
            if (Display->PropertyCount >= kMaxEditorGroupProps)
                return nullptr;
            EditorProperty& Property = Display->Properties[Display->PropertyCount++];
            Property = EditorProperty{};
            std::snprintf(Property.Label, sizeof(Property.Label), "%s", Label);
            Property.Category = Category;
            return &Property;
        };
        if (EditorProperty* Show = Add("Axis guide", EditorPropertyCategory::Switch))
            Show->On = SolidArcAxisGuideVisible_;
        if (EditorProperty* Length = Add("Axis length", EditorPropertyCategory::Slider))
        {
            Length->Minimum = 18.0f; Length->Maximum = 120.0f; Length->Figure = SolidArcAxisGuideLength_;
            Length->Decimals = 0u; std::snprintf(Length->Unit, sizeof(Length->Unit), "px");
        }
        if (EditorProperty* Thick = Add("Axis thickness", EditorPropertyCategory::Slider))
        {
            Thick->Minimum = 0.5f; Thick->Maximum = 6.0f; Thick->Figure = SolidArcAxisGuideThickness_;
            Thick->Decimals = 2u; std::snprintf(Thick->Unit, sizeof(Thick->Unit), "px");
        }
    };
    SeatAxisGuideProperties();
    Inspector_.Record(PickedRow, Picked, &PickedSheet_);

    for (uint32_t G = 0u; G < PickedSheet_.GroupCount; ++G)
    {
        const EditorPropertyGroup& Group = PickedSheet_.Groups[G];
        for (uint32_t P = 0u; P < Group.PropertyCount; ++P)
        {
            const EditorProperty& Property = Group.Properties[P];
            if (std::strcmp(Property.Label, "Axis guide") == 0 && Property.Category == EditorPropertyCategory::Switch)
                SolidArcAxisGuideVisible_ = Property.On;
            else if (std::strcmp(Property.Label, "Axis length") == 0 && Property.Category == EditorPropertyCategory::Slider)
                SolidArcAxisGuideLength_ = std::clamp(Property.Figure, 18.0f, 120.0f);
            else if (std::strcmp(Property.Label, "Axis thickness") == 0 && Property.Category == EditorPropertyCategory::Slider)
                SolidArcAxisGuideThickness_ = std::clamp(Property.Figure, 0.5f, 6.0f);
        }
    }
    Viewport_.AssignAxisGuide(SolidArcAxisGuideVisible_, SolidArcAxisGuideLength_, SolidArcAxisGuideThickness_);

    ApplySolidArcOutlinerVisibility(Host, Rows_.data(), Bindings_.data(), RowCount_);
    if (Picked < RowCount_)
        ApplySolidArcInspectorSheet(Host, Bindings_[Picked], PickedSheet_);

    const ViewportOrbit& OrbitAfterUi = Viewport_.QueryViewportOrbit();
    if (OrbitAfterUi.Revision != LastOrbitRevision_)
    {
        ApplyViewportOrbitToCamera();
        LastOrbitRevision_ = OrbitAfterUi.Revision;
    }

#ifdef FRONTIER_DEVELOPMENT
    // Record the shared Notch/Control Centre above the dock columns, exactly as the main Frontier editor does.
    if (ShadeSeated_)
    {
        const float UiScale = std::clamp(Shade_.QueryAppearance().QueryApplied().InterfaceScale / 100.0f,
                                         0.5f, 2.0f);
        if (ShadeSurface_.Begin(SurfaceLayer::Above, Main->Size.x, Main->Size.y, UiScale))
            Shade_.ConstructControlLayout(ShadeSurface_);
    }
#endif
}

uint32_t SolidArcEditorHost::QueryPickedFigureIdentity() const noexcept
{
    const uint32_t Picked = Outliner_.QueryPicked();
    if (Picked >= RowCount_ || Bindings_[Picked].RowRole != SolidArcOutlinerBinding::Role::Figure)
        return 0u;
    return Bindings_[Picked].FigureIdentity;
}

bool SolidArcEditorHost::QueryShadeOpen() const noexcept
{
    return ShadeSeated_ && Shade_.IsOpen();
}

uint32_t SolidArcEditorHost::QueryShadePage() const noexcept
{
    return static_cast<uint32_t>(Shade_.QueryActivePage());
}

float SolidArcEditorHost::QueryNotchX() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryHandleExtent();
    return (Grip.MinimumX + Grip.MaximumX) * 0.5f;
}

float SolidArcEditorHost::QueryNotchY() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryHandleExtent();
    return (Grip.MinimumY + Grip.MaximumY) * 0.5f;
}

float SolidArcEditorHost::QueryGripX() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryGripExtent();
    return (Grip.MinimumX + Grip.MaximumX) * 0.5f;
}

float SolidArcEditorHost::QueryGripY() const noexcept
{
    const PlaneExtent Grip = Shade_.QueryGripExtent();
    return (Grip.MinimumY + Grip.MaximumY) * 0.5f;
}

} // namespace Frontier
