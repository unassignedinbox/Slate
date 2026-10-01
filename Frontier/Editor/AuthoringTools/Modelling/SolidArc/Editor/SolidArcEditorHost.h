//=============================================================================================================================================
// SolidArcEditorHost.h
//=============================================================================================================================================
// ImGui editor shell for SolidArc. It seats the same Frontier outliner and viewport panels used by Project-Zero,
// with SolidArc-specific row mapping supplied by SolidArcOutlinerAdapter.

#pragma once

#include "SolidArcOutlinerAdapter.h"
#include "../../../../../Engine/Editor/ControlPanel.h"
#include "../../../../../Engine/Editor/InspectorPanel.h"
#include "../../../../../Engine/Editor/OutlinerPanel.h"
#include "../../../../../Engine/Editor/ViewportPanel.h"
#include "../../../../../Engine/DisplayPresentation/ControlCentreHost.h"
#include "../../../../../Engine/DisplayPresentation/PixelSpace.h"
#include "../../../../../Engine/DeviceExchange/InputExchange.h"

#include <cstdint>

namespace Frontier {

class SolidArcEditorHost
{
public:
    SolidArcEditorHost() noexcept;
    ~SolidArcEditorHost() noexcept;

    void ApplyTheme() noexcept;

    // Same pull-down Control Centre notch as the main Frontier editor. Runtime callers tick this before
    // ImGui::NewFrame(); the headless proof uses the same seam so the CPU mirror and live UI stay aligned.
    bool SeatShade(uint32_t Width, uint32_t Height) noexcept;
    void TickShade(float CursorX, float CursorY, bool Down, float Wheel, float DeltaSeconds) noexcept;
    [[nodiscard]] bool ShadeCoversPointer() const noexcept;
    void AssignProjectName(const char* Name) noexcept;

    void Record(ConsoleHost& Host) noexcept;

    [[nodiscard]] uint32_t QueryPickedFigureIdentity() const noexcept;
    [[nodiscard]] float    QueryViewWidth() const noexcept { return Viewport_.QueryViewWidth(); }
    [[nodiscard]] float    QueryViewHeight() const noexcept { return Viewport_.QueryViewHeight(); }
    [[nodiscard]] bool     QueryShadeOpen() const noexcept;
    [[nodiscard]] uint32_t QueryShadePage() const noexcept;
    [[nodiscard]] float    QueryNotchX() const noexcept;
    [[nodiscard]] float    QueryNotchY() const noexcept;
    [[nodiscard]] float    QueryGripX() const noexcept;
    [[nodiscard]] float    QueryGripY() const noexcept;

private:
    void ConstructLayout() noexcept;

    ControlPanel Controls_;
    OutlinerPanel Outliner_;
    ViewportPanel Viewport_;
    InspectorPanel Inspector_;

    ControlCentreHost Shade_;
    InputExchange     ShadeInput_;
    PixelSpace        ShadeSurface_;

    bool ShadeOpen_ = false;
    bool OpenEcho_  = false;
    bool ShadeSeated_ = false;
    bool OrbitSeated_ = false;
    uint32_t LastOrbitRevision_ = 0u;
    bool SolidArcAxisGuideVisible_ = true;
    float SolidArcAxisGuideLength_ = 48.0f;
    float SolidArcAxisGuideThickness_ = 1.25f;
    bool OutlinerTabOpen_ = true;
    bool ViewportTabOpen_ = true;
    bool InspectorTabOpen_ = true;
    ImGuiID LeftColumn_   = 0u;
    ImGuiID CentreColumn_ = 0u;
    ImGuiID RightColumn_  = 0u;
    bool LayoutSeated_    = false;

    std::vector<EditorInstance> Rows_{kMaxEditorInstances};
    std::vector<SolidArcOutlinerBinding> Bindings_{kMaxEditorInstances};
    uint32_t RowCount_ = 0u;
    EditorReadout Readout_ = {};
    EditorSheet PickedSheet_ = {};
    RasterImage ViewImage_ = {};
};

} // namespace Frontier
