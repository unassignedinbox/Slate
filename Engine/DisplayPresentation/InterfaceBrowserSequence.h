//============================================================================================================================================
//                                                   INTERFACEBROWSERSEQUENCE.H
//============================================================================================================================================
// 🧩 The World Browser panel: an outliner on one side, the selected row's properties on the other, on ONE page.
//    Replaces the ImGui inspector that used to hold the scene and render settings. The notch Control Centre is a
//    different thing entirely and is untouched.
//
//    One page, three modes. Either side can take the whole card, animated by a single split fraction. There is no
//    separate properties screen to navigate to and back from — the earlier slide made the same content reachable
//    two ways, one of which needed a back button.
//
//    Engine ⇄ project seam. This draws rows, cards, sliders and toggles. It does not know what a sun is, and it
//    holds no scene state: the project supplies the property rows for the selected object each frame through
//    PropertyBuilder, and reads back edits through the same records. Nothing here includes Projects/.
//
//    Property rows are DECLARED, not drawn by the project. The project appends a description — label, kind,
//    range, target pointer — and this decides layout, hit-testing and how a value is committed. That keeps every
//    panel in the build consistent, and keeps the project free of pixel arithmetic.

#pragma once

#include "ControlKit.h"
#include "InterfaceOutlinerSequence.h"
#include "PixelSpace.h"

#include <cstdint>
#include <functional>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                    PROPERTY ROWS
//------------------------------------------------------------------------------------------------------------------------

enum class PropertyKindCategory : uint32_t
{
    Heading = 0,   // a card title; starts a new card
    Slider  = 1,   // label + value pill + kit slider
    Switch  = 2,   // label + 46 × 26 switch
    Vector  = 3,   // label + three axis pills, X / Y / Z
    Readout = 4,   // label + right-aligned static text
    Tint    = 5,   // label + the swatch row (containers only)
    Notes   = 6,   // a full-width multi-line field
};

// One declared row. Targets are raw pointers into the project's own state: the browser writes through them
//    directly, so there is no copy-back step to forget.
struct PropertyRowRecord
{
    PropertyKindCategory Kind    = PropertyKindCategory::Readout;
    const char*          Label   = "";
    const char*          Unit    = "";
    const char*          Text    = "";      // Readout / Heading
    float*               Value   = nullptr; // Slider
    float*               Vector3 = nullptr; // Vector — three consecutive floats
    bool*                Flag    = nullptr; // Switch
    ColorQuad*           Tint    = nullptr; // Tint
    bool*                HasTint = nullptr;
    float                Minimum = 0.0f;
    float                Maximum = 1.0f;
    uint32_t             Decimals = 2u;
    bool                 ReadOnly = false;  // locked rows show values but refuse edits
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       SEQUENCE
//------------------------------------------------------------------------------------------------------------------------

class InterfaceBrowserSequence
{
public:
    // The project fills the row list for whichever outliner row is selected. Called once per frame; the browser
    //    never caches it, so the project can rebuild it freely as selection changes.
    using PropertyBuilder = std::function<void(uint32_t RowOrdinal, std::vector<PropertyRowRecord>& Rows)>;

    [[nodiscard]] InterfaceOutlinerSequence& Outliner() noexcept { return Tree; }

    void AssignTitle(const char* Title, const char* Subtitle) noexcept { HeaderTitle = Title; HeaderSubtitle = Subtitle; }
    void AssignPropertyBuilder(PropertyBuilder Builder) noexcept { Builder_ = std::move(Builder); }

    [[nodiscard]] OutlinerLayoutMode QueryLayoutMode() const noexcept { return Mode; }
    void AssignLayoutMode(OutlinerLayoutMode Value) noexcept { Mode = Value; }

    // Feed one keystroke to whichever text field currently has focus. Returns true when the browser consumed it,
    //    so the host can keep it away from the camera — a WASD fly-through that also types into a rename field is
    //    the classic bug here.
    bool RecordKey(uint32_t Key, bool Shift, bool Control) noexcept;
    bool RecordCharacter(uint32_t Codepoint) noexcept;
    [[nodiscard]] bool EditingText() const noexcept;

    void Advance(float DeltaSeconds) noexcept;
    void Record(PixelSpace& Surface, const PlaneExtent& Extent, const ControlPointer& Pointer, float Opacity = 1.0f) noexcept;

    static constexpr float kHeaderHeight = 56.0f;
    static constexpr float kFooterHeight = 40.0f;
    static constexpr float kSplitSeconds = 0.32f;

private:
    void RecordHeader    (PixelSpace& Surface, const PlaneExtent& Extent, const ControlPointer& Pointer, float Opacity) noexcept;
    void RecordSearchRow (PixelSpace& Surface, const PlaneExtent& Extent, const ControlPointer& Pointer, float Opacity) noexcept;
    void RecordProperties(PixelSpace& Surface, const PlaneExtent& Extent, const ControlPointer& Pointer, float Opacity) noexcept;

    InterfaceOutlinerSequence      Tree;
    std::vector<PropertyRowRecord> Properties;   // rebuilt each frame, capacity retained so the loop never allocates
    PropertyBuilder                Builder_;

    const char* HeaderTitle    = "World Browser";
    const char* HeaderSubtitle = "";

    OutlinerLayoutMode Mode      = OutlinerLayoutMode::Split;
    float              SplitNow  = 0.54f;   // animated toward the mode's target fraction
    bool               MenuOpen  = false;   // the type-filter dropdown
    uint32_t           DragRow   = kOutlinerNoRow;  // slider being dragged, index into Properties
    uint32_t           DragAxis  = 0u;
    float              DoubleClickTimer = 0.0f;
    uint32_t           DoubleClickRow   = kOutlinerNoRow;
};

} // namespace Frontier
