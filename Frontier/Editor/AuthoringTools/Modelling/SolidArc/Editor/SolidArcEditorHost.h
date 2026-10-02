//=============================================================================================================================================
// SolidArcEditorHost.h
//=============================================================================================================================================
// ImGui editor shell for SolidArc. It seats the same Frontier outliner and viewport panels used by Project-Zero,
// with SolidArc-specific row mapping supplied by SolidArcOutlinerAdapter. The tab sheet is the game editor's own
// (EditorStyleSpecification.h) and the top Control Centre notch is the same ControlCentreHost Project-Zero pulls.

#pragma once

#include "SolidArcOutlinerAdapter.h"
#include "../../../../../Engine/Editor/ControlPanel.h"
#include "../../../../../Engine/Editor/InspectorPanel.h"
#include "../../../../../Engine/Editor/OutlinerPanel.h"
#include "../../../../../Engine/Editor/ViewportPanel.h"
#include "../../../../../Engine/DisplayPresentation/ControlCentreHost.h"
#include "../../../../../Engine/DisplayPresentation/NotificationQueue.h"
#include "../../../../../Engine/DisplayPresentation/PixelSpace.h"
#include "../../../../../Engine/DeviceExchange/InputExchange.h"

#include <cstdint>
#include <string>

namespace Frontier {

class SolidArcEditorHost
{
public:
    SolidArcEditorHost() noexcept;

    ~SolidArcEditorHost() noexcept;

    SolidArcEditorHost(const SolidArcEditorHost&)            = delete;
    SolidArcEditorHost& operator=(const SolidArcEditorHost&) = delete;

    /// 📦 Seats the game editor's tab sheet and tokens, and the faces. Idempotent; call once the ImGui context exists.
    void ApplyTheme() noexcept;

    /// 📦 Opens the Control Centre notch on a Width x Height display. TickShade and the notch half of Record rest until
    ///    this returns true.
    bool SeatShade(uint32_t Width, uint32_t Height) noexcept;

    /// 📦 Call every tick before ImGui::NewFrame(): hands the pointer contact and the frame interval to the notch.
    void TickShade(float CursorX, float CursorY, bool Down, float Wheel, float DeltaSeconds) noexcept;

    /// 📦 True while the notch or its sheet owns the pointer; the dock columns below must not see the contact.
    [[nodiscard]] bool ShadeCoversPointer() const noexcept;
    [[nodiscard]] bool QueryShadeOpen() const noexcept;
    [[nodiscard]] float QueryNotchX() const noexcept;
    [[nodiscard]] float QueryNotchY() const noexcept;
    [[nodiscard]] float QueryGripX() const noexcept;
    [[nodiscard]] float QueryGripY() const noexcept;
    void OpenShade() noexcept  { ShadeOpen_ = true; }
    void CloseShade() noexcept { ShadeOpen_ = false; }

    void Record(ConsoleHost& Host) noexcept;

    [[nodiscard]] uint32_t QueryPickedFigureIdentity() const noexcept;

    /// 📦 The proof's pick seam: seats the pick on the first row of the role (named Label when it is not null); false when none.
    bool PickRow(const char* Label, SolidArcOutlinerBinding::Role Role) noexcept;
    void ClearPick() noexcept;
    void ReseatLayout() noexcept { LayoutSeated_ = false; }     // the next Record re-splits the dock for the current window
    [[nodiscard]] float    QueryViewWidth() const noexcept { return Viewport_.QueryViewWidth(); }
    [[nodiscard]] float    QueryViewHeight() const noexcept { return Viewport_.QueryViewHeight(); }
    [[nodiscard]] uint32_t QueryRailSelectMask() const noexcept { return Viewport_.QuerySolidArcSelectMask(); }
    [[nodiscard]] uint32_t QueryRailShade() const noexcept { return Viewport_.QuerySolidArcShade(); }
    [[nodiscard]] uint32_t QueryRailGizmo() const noexcept { return Viewport_.QuerySolidArcGizmo(); }

    /// 📦 Places one Construct tile's figure exactly as a click on it does; true when a figure was added. The proof's
    ///    seam: the menu click calls the same path.
    bool PlaceConstruct(ConsoleHost& Host, uint32_t Tile) noexcept;
    [[nodiscard]] static uint32_t QueryConstructTileCount() noexcept;
    [[nodiscard]] const std::string& QueryConstructPlacedName() const noexcept { return ConstructPlacedName_; }
    [[nodiscard]] bool QueryConstructOpen() const noexcept { return Viewport_.QueryConstructOpen(); }
    [[nodiscard]] bool QueryConstructTileCentre(uint32_t Tile, float* X, float* Y) const noexcept { return Viewport_.QueryConstructTileCentre(Tile, X, Y); }
    [[nodiscard]] bool QueryConstructSectionCentre(uint32_t Section, float* X, float* Y) const noexcept { return Viewport_.QueryConstructSectionCentre(Section, X, Y); }

private:
    void ConstructLayout() noexcept;

    ControlPanel Controls_;
    OutlinerPanel Outliner_;
    ViewportPanel Viewport_;
    InspectorPanel Inspector_;

    ControlCentreHost Shade_;           // the original notch and sheet, last: it draws above the dock columns
    InputExchange     ShadeInput_;      // the contact TickShade hands it every tick
    PixelSpace        ShadeSurface_;    // the foreground list its primitives land on
    NotificationQueue Toasts_;          // the toasts a settings change raises
    bool     ShadeSeated_   = false;    // SeatShade has opened the host's springs
    bool     ShadeOpen_     = false;    // shut at boot; shared with the viewport gear
    bool     OpenEcho_      = false;    // the gear's last obeyed figure: only an edge moves the shade
    uint32_t ToastRevision_ = 0u;       // the settings revision the last toast answered

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
    std::vector<std::string> ShutFolders_; // Folder collapse is host-owned: the roster is rebuilt from the document every frame.
    EditorReadout Readout_ = {};
    EditorSheet PickedSheet_ = {};
    RasterImage ViewImage_ = {};
    uint32_t    ConstructPlaced_ = 0u;      // tiles placed so far: the next one takes the next spot on the ring
    std::string ConstructPlacedName_;       // the figure the last placement made
};

} // namespace Frontier
