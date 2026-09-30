//============================================================================================================================================
//                                                     SOLIDARCEDITORHOST.H
//============================================================================================================================================

// 📦 The SolidArc CAD editor host — seats the theme, builds the dock columns, and records the three panels
//    over the CAD document feed. The panels are the shared editor panels the game editor uses (OutlinerPanel,
//    ViewportPanel, InspectorPanel); SolidArc's own presence arrives through SolidArcOutlinerInterchange,
//    which speaks the document into EditorInstance rows and EditorSheet cards and writes the panels' edits
//    back into the same document on the same tick.

#pragma once

#include "SolidArcOutlinerInterchange.h"
#include "../../../../../Engine/Editor/ControlPanel.h"
#include "../../../../../Engine/Editor/InspectorPanel.h"
#include "../../../../../Engine/Editor/OutlinerPanel.h"
#include "../../../../../Engine/Editor/ViewportPanel.h"

#include <cstdint>
#include <vector>

#include <imgui.h>

namespace Frontier {

class ConsoleHost;

class SolidArcEditorHost
{
public:
    SolidArcEditorHost() noexcept;

    // Call once after the ImGui context exists — seats the six faces from the default face and the
    //    trapezoidal tab figures over the patched vendor, then the panel colours. Idempotent.
    void ApplyTheme() noexcept;

    // Call every tick between ImGui::NewFrame() and ImGui::Render() — records the fullscreen dock host,
    //    the dockspace, and the three panels over the document's feed. The panels borrow the rows and edit
    //    them in place; the sheet already describes the currently picked figure.
    void Record(ConsoleHost& Host) noexcept;

    // The pick's stable figure identity, or 0 when the pick is a folder, a dimension, a constraint or
    //    nothing. The windowed host and the proof both read the pick through this seam.
    [[nodiscard]] uint32_t QueryPickedFigureIdentity() const noexcept;

    // The viewport's drawn view rect, so a caller sizing a scene raster knows the rect it draws into.
    [[nodiscard]] float QueryViewWidth() const noexcept { return Viewport_.QueryViewWidth(); }
    [[nodiscard]] float QueryViewHeight() const noexcept { return Viewport_.QueryViewHeight(); }

private:
    // Splits the dockspace into outliner / viewport / inspector columns on the first tick, then rests.
    //    Runs with the host window open: the builder addresses the host, and without it there is nothing to
    //    build against.
    void ConstructLayout() noexcept;

    // Seats the six faces the panels draw with, from the default face at six sizes. The engine's own host
    //    loads its faces from EngineContent; the standalone tool carries no content folder, and the 1.92
    //    vendor rasterises glyphs on demand at any drawn size, so one face source serves every size.
    void SeatFaces() noexcept;

    ControlPanel  Controls_;          // first: the panels borrow it
    OutlinerPanel Outliner_;
    ViewportPanel Viewport_;
    InspectorPanel Inspector_;

    bool OutlinerTabOpen_ = true;     // the outliner tab's close mark clears this; the tab bar seats it again
    bool ViewportTabOpen_ = true;     // the viewport tab's close mark clears this
    bool InspectorTabOpen_ = true;    // the inspector tab's close mark clears this
    ImGuiID LeftColumn_   = 0u;       // the left column's address
    ImGuiID CentreColumn_ = 0u;       // the viewport column's address; kept distinct so the view is never the backing canvas
    ImGuiID RightColumn_  = 0u;       // the inspector column's address
    bool LayoutSeated_    = false;    // one canonical seat per run; user drags then survive until close
    bool FacesSeated_     = false;    // ApplyTheme seats the faces once

    std::vector<EditorInstance> Rows_{kMaxEditorInstances};
    std::vector<SolidArcRowCounterpart> Counterparts_{kMaxEditorInstances};
    uint32_t RowCount_ = 0u;
    EditorReadout Readout_ = {};
    EditorSheet PickedSheet_ = {};
};

} // namespace Frontier
