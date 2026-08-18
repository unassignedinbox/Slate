//============================================================================================================================================
//                                                            EDITORPANEL.H
//============================================================================================================================================
// 🧩 Reusable editor-panel chrome, split interaction and skeletal viewport, UV, outliner and property presentations.

#pragma once

#include "Contract/DeliveryContract.h"
#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"
#include "SlateUI/Interface/ComponentSpecification/Api/ComponentSpecification.h"
#include "SlateUI/Interface/EditorPanel/Api/EditorLeafPanels.h"
#include "SlateUI/Interface/InteractionIndex/Api/InteractionIndex.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"
#include "SlateUI/Interface/MotionIntegrator/Api/MotionIntegrator.h"
#include "SlateUI/Interface/PanelStructure/Api/PanelStructure.h"

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    HOST-OWNED ORDINATES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Lattice presentation selected for viewport and UV panels.
/// tag   contract
enum class PanelLatticePresentation : std::uint32_t
{
    None              = 0u,
    Lines             = 1u,
    Dots              = 2u,
    PresentationCount = 3u
};

/// 🧩 Scene shading selected for a viewport panel.
/// tag   contract
enum class PanelShading : std::uint32_t
{
    Solid        = 0u,
    Wireframe    = 1u,
    Matcap       = 2u,
    Normal       = 3u,
    Metallic     = 4u,
    Illumination = 5u,
    ShadingCount = 6u
};

/// 🧩 Gizmo convention selected for a viewport panel.
/// tag   contract
enum class PanelGizmo : std::uint32_t
{
    Blender    = 0u,
    Cad        = 1u,
    GizmoCount = 2u
};

/// 🧩 Visible stub preferences retained by the host, never by `EditorPanel`.
/// tag   contract, nonallocating, nonthrowing
struct EditorPanelOrdinates
{
    PanelLatticePresentation  Lattice         = PanelLatticePresentation::Lines;   // [-] - lattice presentation
    PanelShading              Shading         = PanelShading::Solid;                // [-] - viewport shading
    PanelGizmo                Gizmo           = PanelGizmo::Blender;                // [-] - gizmo convention
    std::uint32_t             LatticeScale    = 1u;                                 // [-] - skeletal lattice scale
    std::uint32_t             Subdivisions    = 10u;                                // [-] - lattice subdivisions
    bool                      AxisX           = true;                               // [-] - X or U axis visible
    bool                      AxisY           = false;                              // [-] - Y or V axis visible
    bool                      AxisZ           = true;                               // [-] - Z axis visible
    bool                      Perspective     = true;                               // [-] - perspective projection
    bool                      FpsOverlay      = false;                              // [-] - FPS overlay requested
    bool                      StorageOverlay  = false;                              // [-] - storage overlay requested
    bool                      RendererOverlay = false;                              // [-] - renderer overlay requested
};

//------------------------------------------------------------------------------------------------------------------------
//                                                        PRESENTATION
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Presents one host-owned workspace partition and edits it through exact panel chrome controls.
/// note  GPU content is deliberately absent: viewport and UV bodies are render-target placeholders while
///       panel selection, binary division, resizing, withdrawal and reusable footer controls are functional.
/// tag   owning, nonallocating, nonthrowing
class EditorPanel
{
public:

    static constexpr std::uint32_t ControlsPerRecord = 22u;
    static constexpr std::uint32_t ControlCapacity = PanelStructure::RecordCeiling * ControlsPerRecord;

    Deliver<bool> Construct(MotionIntegrator& Motion,
                            RecordingSurface& Surface,
                            const AppearanceSpecification& Appearance);
    void Advance(const PointerCondition& Arrived, double Elapsed);
    Deliver<bool> Record(const PlaneExtent& Extent,
                         PanelStructure& Partition,
                         EditorPanelOrdinates& Ordinates,
                         std::uint32_t PresentationOrdinal = 0u);
    bool PointerCaptured(std::uint32_t PresentationOrdinal) const;
    void WithdrawPresentation(std::uint32_t PresentationOrdinal);
    void Reset();

private:

    static constexpr std::uint32_t AbsentPresentation = 0xFFFFFFFFu;

    enum class ControlRole : std::uint32_t
    {
        SubjectMenu = 0u,
        DivisionMenu,
        Withdrawal,
        DivideLeft,
        DivideRight,
        DivideUpper,
        DivideLower,
        ChooseViewport,
        ChooseUv,
        ChooseOutliner,
        ChooseProperties,
        LatticeMenu,
        CameraMenu,
        OverlayMenu,
        LatticePresentation,
        LatticeScale,
        Subdivisions,
        AxisX,
        AxisY,
        AxisZ,
        Shading,
        Gizmo,
        RoleCount
    };

    std::uint32_t ControlOrdinal(std::uint32_t RecordOrdinal, ControlRole Role) const;
    bool Pressed(std::uint32_t ControlOrdinal, const PlaneExtent& Extent, bool PopupAction = false);
    bool Disclosed(ControlIdentity Claimed) const;
    void Disclose(ControlIdentity Claimed);
    void WithdrawDisclosure();
    void RecordBranch(std::uint32_t RecordOrdinal,
                      const PlaneExtent& Extent,
                      PanelStructure& Partition,
                      EditorPanelOrdinates& Ordinates);
    void RecordLeaf(std::uint32_t RecordOrdinal,
                    const PanelRecord& Declared,
                    const PlaneExtent& Extent,
                    PanelStructure& Partition,
                    EditorPanelOrdinates& Ordinates);
    void RecordHeader(std::uint32_t RecordOrdinal,
                      PanelSubject Subject,
                      const PlaneExtent& Extent,
                      PanelStructure& Partition);
    void RecordFooter(std::uint32_t RecordOrdinal,
                      PanelSubject Subject,
                      const PlaneExtent& Extent,
                      EditorPanelOrdinates& Ordinates);
    void RecordVacant(std::uint32_t RecordOrdinal,
                      const PlaneExtent& Extent,
                      PanelStructure& Partition);
    void RecordDeferred(PanelStructure& Partition, EditorPanelOrdinates& Ordinates);
    void RecordSubjectMenu(std::uint32_t RecordOrdinal,
                           const PlaneExtent& Anchor,
                           PanelStructure& Partition);
    void RecordDivisionMenu(std::uint32_t RecordOrdinal,
                            const PlaneExtent& Anchor,
                            PanelStructure& Partition);
    void RecordLatticeMenu(std::uint32_t RecordOrdinal,
                           const PlaneExtent& Anchor,
                           EditorPanelOrdinates& Ordinates);
    void RecordFooterMenu(std::uint32_t RecordOrdinal,
                          const PlaneExtent& Anchor,
                          ControlRole Role,
                          EditorPanelOrdinates& Ordinates);
    void Symbol(const PlaneExtent& Extent, InkOrdinate Ink);

    MotionIntegrator* Motion = nullptr;
    RecordingSurface* Surface = nullptr;
    const AppearanceSpecification* Appearance = nullptr;
    InteractionIndex Interaction = {};
    ComponentSpecification SharedControls = {};
    ScenePanel ScenePresentation = {};
    UvPanel UvPresentation = {};
    OutlinerPanel OutlinerPresentation = {};
    PropertyPanel PropertyPresentation = {};
    ControlIdentity Controls[ControlCapacity] = {};
    PointerCondition Pointer = {};
    PlaneExtent CurrentLeafExtent = {};
    PlaneExtent DeferredAnchor = {};
    PlaneExtent DeferredBoundary = {};
    std::uint32_t DeferredRecord = PanelStructure::RecordCeiling;
    ControlRole DeferredRole = ControlRole::RoleCount;
    std::uint32_t CurrentPresentation = 0u;
    std::uint32_t CapturedPresentation = AbsentPresentation;
    std::uint32_t DisclosedPresentation = AbsentPresentation;
    std::uint32_t DraggedDivision = PanelStructure::RecordCeiling;
    PlaneExtent DraggedExtent = {};
};

}   // namespace Slate
