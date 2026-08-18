//============================================================================================================================================
//                                                           EDITORPANEL.CPP
//============================================================================================================================================
// 🧩 Exact editor chrome and bounded split interaction around skeletal workspace render targets.

#include "SlateUI/Interface/EditorPanel/Api/EditorPanel.h"

#include <cmath>

namespace Slate
{

namespace
{

const char* SubjectTitle(PanelSubject Subject)
{
    switch (Subject)
    {
        case PanelSubject::Viewport:   return "3D Viewport";
        case PanelSubject::Uv:         return "UV Editor";
        case PanelSubject::Outliner:   return "Outliner";
        case PanelSubject::Properties: return "Properties";
        default:                       return "Choose Panel Type";
    }
}

const char* ShadingTitle(PanelShading Shading)
{
    switch (Shading)
    {
        case PanelShading::Wireframe:    return "wireframe";
        case PanelShading::Matcap:       return "matcap";
        case PanelShading::Normal:       return "normal";
        case PanelShading::Metallic:     return "metallic";
        case PanelShading::Illumination: return "gi";
        default:                         return "solid";
    }
}

const char* GizmoTitle(PanelGizmo Gizmo)
{
    return Gizmo == PanelGizmo::Cad ? "cad" : "blender";
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                       CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> EditorPanel::Construct(MotionIntegrator& ArrivingMotion,
                                     RecordingSurface& ArrivingSurface,
                                     const AppearanceSpecification& ArrivingAppearance)
{
    if (Motion != nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "an editor panel construction stands" });

    Motion     = &ArrivingMotion;
    Surface    = &ArrivingSurface;
    Appearance = &ArrivingAppearance;

    if (!Interaction.Construct(ArrivingMotion).ContentPresent)
        return Deliver<bool>::Refuse({ RefusalReason::ExtentExhausted, "editor panel interaction was refused" });

    if (!SharedControls.Construct(Interaction, ArrivingSurface, ArrivingAppearance).ContentPresent)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "shared editor controls were refused" });

    if (!ScenePresentation.Construct(ArrivingSurface, ArrivingAppearance).ContentPresent ||
        !UvPresentation.Construct(ArrivingSurface, ArrivingAppearance).ContentPresent ||
        !OutlinerPresentation.Construct(ArrivingSurface, ArrivingAppearance).ContentPresent ||
        !PropertyPresentation.Construct(ArrivingSurface, ArrivingAppearance).ContentPresent)
    {
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "an editor leaf panel was refused" });
    }

    for (std::uint32_t Ordinal = 0u; Ordinal < ControlCapacity; ++Ordinal)
    {
        const Deliver<ControlIdentity> Issued = Interaction.Enrol();
        if (!Issued.ContentPresent)
            return Deliver<bool>::Refuse(Issued.Declined);

        Controls[Ordinal] = Issued.Resolve();
    }

    return Deliver<bool>::Deliver(true);
}

void EditorPanel::Advance(const PointerCondition& Arrived, double Elapsed)
{
    Pointer = Arrived;
    Interaction.Advance(Arrived, Elapsed);
    SharedControls.Sample(Arrived);
}

std::uint32_t EditorPanel::ControlOrdinal(std::uint32_t RecordOrdinal, ControlRole Role) const
{
    return RecordOrdinal * ControlsPerRecord + static_cast<std::uint32_t>(Role);
}

bool EditorPanel::Pressed(std::uint32_t Ordinal, const PlaneExtent& Extent, bool PopupAction)
{
    if (Ordinal >= ControlCapacity)
        return false;

    const ControlIdentity Claimed = Controls[Ordinal];
    const bool Roused = Extent.Encloses(Pointer.PositionAlong, Pointer.PositionAcross);
    if (Roused && Pointer.ContactArrived && (PopupAction || !Interaction.AnyDisclosed()))
        Interaction.Seize(Claimed, ControlPart::Body);

    Interaction.DeclareRoused(Claimed, Roused, 130.0);
    return Interaction.Released(Claimed) && Roused;
}

void EditorPanel::Symbol(const PlaneExtent& Extent, InkOrdinate Ink)
{
    Surface->Stroke(SymbolSubject::PlaceholderMark, Extent, Ink);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     PARTITION RECORDING
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> EditorPanel::Record(const PlaneExtent& Extent,
                                  PanelStructure& Partition,
                                  EditorPanelOrdinates& Ordinates)
{
    if (Surface == nullptr || Appearance == nullptr || Motion == nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::CapabilityAbsent, "no editor panel construction stands" });

    if (!Partition.Standing(PanelStructure::RootOrdinal).ContentPresent)
        Partition.Construct();

    DeferredAnchor = {};
    DeferredRecord = PanelStructure::RecordCeiling;
    DeferredRole   = ControlRole::RoleCount;

    Surface->Ground(Extent, Appearance->EditorPanel.WindowGround);
    RecordBranch(PanelStructure::RootOrdinal, Extent, Partition, Ordinates);
    RecordDeferred(Partition, Ordinates);

    return Deliver<bool>::Deliver(true);
}

void EditorPanel::RecordBranch(std::uint32_t RecordOrdinal,
                               const PlaneExtent& Extent,
                               PanelStructure& Partition,
                               EditorPanelOrdinates& Ordinates)
{
    const Deliver<PanelRecord> Delivered = Partition.Standing(RecordOrdinal);
    if (!Delivered.ContentPresent)
        return;

    const PanelRecord Declared = Delivered.Resolve();
    if (!Declared.Divided)
    {
        RecordLeaf(RecordOrdinal, Declared, Extent, Partition, Ordinates);
        return;
    }

    const EditorPanelMetric& Measure = Appearance->EditorPanelMeasure;
    const EditorPanelInk&    Ink     = Appearance->EditorPanel;
    const bool Along = Declared.Axis == PanelDivisionAxis::Along;
    const float Span = Along ? Extent.SpanAlong() : Extent.SpanAcross();
    const float Available = (Span > Measure.SplitterAcross) ? Span - Measure.SplitterAcross : 0.0f;
    const float LeastSpan = Available * Declared.LeastFraction;

    PlaneExtent LeastExtent = Extent;
    PlaneExtent SplitExtent = Extent;
    PlaneExtent MostExtent  = Extent;

    if (Along)
    {
        LeastExtent.MostAlong = Extent.LeastAlong + LeastSpan;
        SplitExtent.LeastAlong = LeastExtent.MostAlong;
        SplitExtent.MostAlong = SplitExtent.LeastAlong + Measure.SplitterAcross;
        MostExtent.LeastAlong = SplitExtent.MostAlong;
    }
    else
    {
        LeastExtent.MostAcross = Extent.LeastAcross + LeastSpan;
        SplitExtent.LeastAcross = LeastExtent.MostAcross;
        SplitExtent.MostAcross = SplitExtent.LeastAcross + Measure.SplitterAcross;
        MostExtent.LeastAcross = SplitExtent.MostAcross;
    }

    const std::uint32_t SplitControl = ControlOrdinal(RecordOrdinal, ControlRole::DivisionMenu);
    const ControlIdentity Claimed = Controls[SplitControl];
    const bool Roused = SplitExtent.Encloses(Pointer.PositionAlong, Pointer.PositionAcross);
    if (Roused && Pointer.ContactArrived && !Interaction.AnyDisclosed())
    {
        Interaction.Seize(Claimed, ControlPart::Body);
        Interaction.DepartFrom(Claimed, Declared.LeastFraction);
        DraggedDivision = RecordOrdinal;
        DraggedExtent   = Extent;
    }

    Interaction.DeclareRoused(Claimed, Roused || Interaction.Holding(Claimed), 130.0);

    float RequestedFraction = Declared.LeastFraction;
    if (Interaction.Holding(Claimed) || Interaction.Released(Claimed))
    {
        RequestedFraction = Along
                          ? (Pointer.PositionAlong - DraggedExtent.LeastAlong) / DraggedExtent.SpanAlong()
                          : (Pointer.PositionAcross - DraggedExtent.LeastAcross) / DraggedExtent.SpanAcross();
    }

    if (Interaction.Released(Claimed))
    {
        if (RequestedFraction < 0.05f)
        {
            Disregard(Partition.Withdraw(Declared.LeastOrdinal));
            RecordBranch(RecordOrdinal, Extent, Partition, Ordinates);
            return;
        }

        if (RequestedFraction > 0.95f)
        {
            Disregard(Partition.Withdraw(Declared.MostOrdinal));
            RecordBranch(RecordOrdinal, Extent, Partition, Ordinates);
            return;
        }
    }

    if (Interaction.Holding(Claimed))
        Disregard(Partition.Proportion(RecordOrdinal, RequestedFraction));

    Surface->Ground(SplitExtent, Roused || Interaction.Holding(Claimed) ? Ink.Accent : Ink.ChromeGround);
    Surface->Edge(SplitExtent, Ink.Edge, Measure.EdgeWeight);

    RecordBranch(Declared.LeastOrdinal, LeastExtent, Partition, Ordinates);
    RecordBranch(Declared.MostOrdinal, MostExtent, Partition, Ordinates);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        LEAF CHROME
//------------------------------------------------------------------------------------------------------------------------

void EditorPanel::RecordLeaf(std::uint32_t RecordOrdinal,
                             const PanelRecord& Declared,
                             const PlaneExtent& Extent,
                             PanelStructure& Partition,
                             EditorPanelOrdinates& Ordinates)
{
    if (Declared.Subject == PanelSubject::Vacant)
    {
        RecordVacant(RecordOrdinal, Extent, Partition);
        return;
    }

    const EditorPanelMetric& Measure = Appearance->EditorPanelMeasure;
    const PlaneExtent Header = Spanning(Extent.LeastAlong, Extent.LeastAcross,
                                        Extent.SpanAlong(), Measure.HeaderAcross);
    const PlaneExtent Footer = Spanning(Extent.LeastAlong, Extent.MostAcross - Measure.FooterAcross,
                                        Extent.SpanAlong(), Measure.FooterAcross);
    const PlaneExtent Body = { Extent.LeastAlong, Header.MostAcross, Extent.MostAlong, Footer.LeastAcross };

    RecordHeader(RecordOrdinal, Declared.Subject, Header, Partition);

    // 📝 GPU scene and UV rendering are intentionally absent in this skeleton. Each focused panel owns its
    //    render-target body while `EditorPanel` owns only shared chrome and partition interaction.
    switch (Declared.Subject)
    {
        case PanelSubject::Viewport:   ScenePresentation.Record(Body);    break;
        case PanelSubject::Uv:         UvPresentation.Record(Body);       break;
        case PanelSubject::Outliner:   OutlinerPresentation.Record(Body); break;
        case PanelSubject::Properties: PropertyPresentation.Record(Body); break;
        default:                       break;
    }

    RecordFooter(RecordOrdinal, Declared.Subject, Footer, Ordinates);
}

void EditorPanel::RecordHeader(std::uint32_t RecordOrdinal,
                               PanelSubject Subject,
                               const PlaneExtent& Extent,
                               PanelStructure& Partition)
{
    const EditorPanelMetric& Measure = Appearance->EditorPanelMeasure;
    const EditorPanelInk&    Ink     = Appearance->EditorPanel;
    Surface->Ground(Extent, Ink.ChromeGround);
    Surface->Ground(Spanning(Extent.LeastAlong, Extent.MostAcross - Measure.EdgeWeight,
                             Extent.SpanAlong(), Measure.EdgeWeight), Ink.Edge);

    const PlaneExtent SubjectButton = Spanning(Extent.LeastAlong + Measure.HeaderPadAlong,
                                               Extent.LeastAcross + 2.0f,
                                               44.0f,
                                               Measure.HeaderAction);
    const std::uint32_t SubjectControl = ControlOrdinal(RecordOrdinal, ControlRole::SubjectMenu);
    const bool SubjectOpen = Interaction.Disclosed(Controls[SubjectControl]);
    if (SubjectOpen)
        Surface->Ground(SubjectButton, Ink.Roused, 4.0f, CornerAll);

    Symbol(Spanning(SubjectButton.LeastAlong + 2.0f,
                    SubjectButton.LeastAcross + 7.0f,
                    Measure.HeaderSymbol,
                    Measure.HeaderSymbol), Ink.InkQuiet);
    Surface->TextRun(SubjectButton.MostAlong - 10.0f,
                     SubjectButton.LeastAcross + 8.0f,
                     Ink.InkFaint,
                     "v",
                     Measure.TextSmall,
                     0.0f,
                     true);

    if (Pressed(SubjectControl, SubjectButton, true))
    {
        if (SubjectOpen)
            Interaction.Withdraw();
        else
            Interaction.Disclose(Controls[SubjectControl]);
    }

    if (Interaction.Disclosed(Controls[SubjectControl]))
    {
        DeferredAnchor = SubjectButton;
        DeferredRecord = RecordOrdinal;
        DeferredRole   = ControlRole::SubjectMenu;
    }

    Surface->TextRun(SubjectButton.MostAlong + Measure.HeaderTitleGap,
                     Extent.LeastAcross + 10.0f,
                     Ink.InkSecondary,
                     SubjectTitle(Subject),
                     Measure.TextSmall,
                     0.0f,
                     false);

    const bool CanWithdraw = Partition.WithdrawalAdmitted();
    const float ActionCount = CanWithdraw ? 2.0f : 1.0f;
    const PlaneExtent DivisionButton = Spanning(Extent.MostAlong - Measure.HeaderPadAlong -
                                                   Measure.HeaderAction * ActionCount,
                                               Extent.LeastAcross + 2.0f,
                                               Measure.HeaderAction,
                                               Measure.HeaderAction);
    const std::uint32_t DivisionControl = ControlOrdinal(RecordOrdinal, ControlRole::DivisionMenu);
    const bool DivisionOpen = Interaction.Disclosed(Controls[DivisionControl]);
    if (DivisionOpen)
        Surface->Ground(DivisionButton, Ink.Roused, 6.0f, CornerAll);

    Symbol(Spanning(DivisionButton.LeastAlong + 7.0f,
                    DivisionButton.LeastAcross + 7.0f,
                    Measure.HeaderSymbol,
                    Measure.HeaderSymbol), Ink.InkQuiet);

    if (Pressed(DivisionControl, DivisionButton, true))
    {
        if (DivisionOpen)
            Interaction.Withdraw();
        else
            Interaction.Disclose(Controls[DivisionControl]);
    }

    if (Interaction.Disclosed(Controls[DivisionControl]))
    {
        DeferredAnchor = DivisionButton;
        DeferredRecord = RecordOrdinal;
        DeferredRole   = ControlRole::DivisionMenu;
    }

    if (CanWithdraw)
    {
        const PlaneExtent WithdrawalButton = Spanning(DivisionButton.MostAlong,
                                                       DivisionButton.LeastAcross,
                                                       Measure.HeaderAction,
                                                       Measure.HeaderAction);
        Symbol(Spanning(WithdrawalButton.LeastAlong + 7.0f,
                        WithdrawalButton.LeastAcross + 7.0f,
                        Measure.HeaderSymbol,
                        Measure.HeaderSymbol), Ink.InkQuiet);
        if (Pressed(ControlOrdinal(RecordOrdinal, ControlRole::Withdrawal), WithdrawalButton))
            Disregard(Partition.Withdraw(RecordOrdinal));
    }
}

void EditorPanel::RecordFooter(std::uint32_t RecordOrdinal,
                               PanelSubject Subject,
                               const PlaneExtent& Extent,
                               EditorPanelOrdinates& Ordinates)
{
    const EditorPanelMetric& Measure = Appearance->EditorPanelMeasure;
    const EditorPanelInk&    Ink     = Appearance->EditorPanel;
    Surface->Ground(Extent, Ink.ChromeGround);
    Surface->Ground(Spanning(Extent.LeastAlong, Extent.LeastAcross,
                             Extent.SpanAlong(), Measure.EdgeWeight), Ink.Edge);

    if (Subject == PanelSubject::Outliner || Subject == PanelSubject::Properties)
    {
        Surface->TextRun(Extent.LeastAlong + Measure.FooterPadAlong,
                         Extent.LeastAcross + 18.0f,
                         Ink.InkFaint,
                         Subject == PanelSubject::Outliner ? "0 items" : "No active object",
                         Measure.TextSmall,
                         0.0f,
                         false);
        return;
    }

    float Cursor = Extent.LeastAlong + Measure.FooterPadAlong;
    const auto Pill = [&](const char* Caption, float Along) -> PlaneExtent
    {
        const PlaneExtent Button = Spanning(Cursor, Extent.LeastAcross + 10.0f, Along, Measure.PillAcross);
        Surface->Ground(Button, Ink.BodyGround, Measure.PillRadius, CornerAll);
        Surface->Edge(Button, Ink.Edge, Measure.EdgeWeight, Measure.PillRadius, CornerAll);
        Symbol(Spanning(Button.LeastAlong + 10.0f, Button.LeastAcross + 7.0f,
                        Measure.HeaderSymbol, Measure.HeaderSymbol), Ink.InkQuiet);
        Surface->TextRun(Button.LeastAlong + 30.0f, Button.LeastAcross + 8.0f,
                         Ink.InkQuiet, Caption, Measure.TextSmall, 0.0f, false);
        Cursor = Button.MostAlong + Measure.FooterGap;
        return Button;
    };

    if (Subject == PanelSubject::Viewport)
    {
        const PlaneExtent Cameras = Pill("Cameras", 92.0f);
        const std::uint32_t CameraControl = ControlOrdinal(RecordOrdinal, ControlRole::CameraMenu);
        const bool CameraOpen = Interaction.Disclosed(Controls[CameraControl]);
        if (Pressed(CameraControl, Cameras, true))
        {
            if (CameraOpen)
                Interaction.Withdraw();
            else
                Interaction.Disclose(Controls[CameraControl]);
        }
        if (Interaction.Disclosed(Controls[CameraControl]))
        {
            DeferredAnchor = Cameras;
            DeferredRecord = RecordOrdinal;
            DeferredRole   = ControlRole::CameraMenu;
        }
    }

    const PlaneExtent LatticeButton = Pill("Grid", 72.0f);
    const std::uint32_t LatticeControl = ControlOrdinal(RecordOrdinal, ControlRole::LatticeMenu);
    const bool LatticeOpen = Interaction.Disclosed(Controls[LatticeControl]);
    if (Pressed(LatticeControl, LatticeButton, true))
    {
        if (LatticeOpen)
            Interaction.Withdraw();
        else
            Interaction.Disclose(Controls[LatticeControl]);
    }

    if (Interaction.Disclosed(Controls[LatticeControl]))
    {
        DeferredAnchor = LatticeButton;
        DeferredRecord = RecordOrdinal;
        DeferredRole   = ControlRole::LatticeMenu;
    }

    const float TrailingFloor = Cursor + 20.0f;
    float Trailing = Extent.MostAlong - Measure.FooterPadAlong;
    const auto TrailingPill = [&](const char* Caption, float Along, InkOrdinate Accent) -> PlaneExtent
    {
        Trailing -= Along;
        const PlaneExtent Button = Spanning(Trailing, Extent.LeastAcross + 10.0f, Along, Measure.PillAcross);
        Surface->Ground(Button, Ink.BodyGround, Measure.PillRadius, CornerAll);
        Surface->Edge(Button, Accent, Measure.EdgeWeight, Measure.PillRadius, CornerAll);
        Surface->TextRun(Button.LeastAlong + Button.SpanAlong() * 0.5f,
                         Button.LeastAcross + 8.0f,
                         Ink.InkQuiet,
                         Caption,
                         Measure.TextSmall,
                         0.0f,
                         true);
        Trailing = Button.LeastAlong - Measure.FooterGap;
        return Button;
    };

    if (Subject == PanelSubject::Viewport && Trailing > TrailingFloor + 250.0f)
    {
        const PlaneExtent GizmoButton = TrailingPill(GizmoTitle(Ordinates.Gizmo), 78.0f, Ink.Edge);
        const std::uint32_t GizmoControl = ControlOrdinal(RecordOrdinal, ControlRole::Gizmo);
        if (Pressed(GizmoControl, GizmoButton, true))
            Interaction.Disclose(Controls[GizmoControl]);
        if (Interaction.Disclosed(Controls[GizmoControl]))
        {
            DeferredAnchor = GizmoButton;
            DeferredRecord = RecordOrdinal;
            DeferredRole   = ControlRole::Gizmo;
        }

        const PlaneExtent ShadingButton = TrailingPill(ShadingTitle(Ordinates.Shading), 86.0f, Ink.Edge);
        const std::uint32_t ShadingControl = ControlOrdinal(RecordOrdinal, ControlRole::Shading);
        if (Pressed(ShadingControl, ShadingButton, true))
            Interaction.Disclose(Controls[ShadingControl]);
        if (Interaction.Disclosed(Controls[ShadingControl]))
        {
            DeferredAnchor = ShadingButton;
            DeferredRecord = RecordOrdinal;
            DeferredRole   = ControlRole::Shading;
        }

        const PlaneExtent CameraButton = TrailingPill(Ordinates.Perspective ? "Persp" : "Ortho", 64.0f, Ink.Edge);
        if (Pressed(ControlOrdinal(RecordOrdinal, ControlRole::LatticePresentation), CameraButton))
            Ordinates.Perspective = !Ordinates.Perspective;

        const bool OverlaysTaken = Ordinates.FpsOverlay || Ordinates.StorageOverlay || Ordinates.RendererOverlay;
        const PlaneExtent OverlayButton = TrailingPill("Overlays", 80.0f,
                                                       OverlaysTaken ? Ink.Positive : Ink.Edge);
        const std::uint32_t OverlayControl = ControlOrdinal(RecordOrdinal, ControlRole::OverlayMenu);
        if (Pressed(OverlayControl, OverlayButton, true))
            Interaction.Disclose(Controls[OverlayControl]);
        if (Interaction.Disclosed(Controls[OverlayControl]))
        {
            DeferredAnchor = OverlayButton;
            DeferredRecord = RecordOrdinal;
            DeferredRole   = ControlRole::OverlayMenu;
        }
    }
    else if (Subject == PanelSubject::Uv && Trailing > TrailingFloor + 100.0f)
    {
        static_cast<void>(TrailingPill("2D View", 72.0f, Ink.Edge));
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    VACANT PANEL CHOOSER
//------------------------------------------------------------------------------------------------------------------------

void EditorPanel::RecordVacant(std::uint32_t RecordOrdinal,
                               const PlaneExtent& Extent,
                               PanelStructure& Partition)
{
    const EditorPanelMetric& Measure = Appearance->EditorPanelMeasure;
    const EditorPanelInk&    Ink     = Appearance->EditorPanel;
    Surface->Ground(Extent, Ink.WindowGround);

    if (Partition.WithdrawalAdmitted())
    {
        const PlaneExtent Close = Spanning(Extent.MostAlong - 46.0f, Extent.LeastAcross + 16.0f, 30.0f, 30.0f);
        Surface->Ground(Close, Ink.ViewGround, 8.0f, CornerAll);
        Surface->Edge(Close, Ink.Edge, Measure.EdgeWeight, 8.0f, CornerAll);
        Symbol(Spanning(Close.LeastAlong + 7.0f, Close.LeastAcross + 7.0f,
                        16.0f, 16.0f), Ink.InkFaint);
        if (Pressed(ControlOrdinal(RecordOrdinal, ControlRole::Withdrawal), Close))
            Disregard(Partition.Withdraw(RecordOrdinal));
    }

    const float TotalAlong = Measure.ChooserButtonAlong * 4.0f + Measure.ChooserGap * 3.0f;
    const float LeastAlong = Extent.LeastAlong + (Extent.SpanAlong() - TotalAlong) * 0.5f;
    const float ButtonAcross = Extent.LeastAcross + Extent.SpanAcross() * 0.5f - 18.0f;

    Surface->TextRun(Extent.LeastAlong + Extent.SpanAlong() * 0.5f,
                     ButtonAcross - 38.0f,
                     Ink.InkSecondary,
                     "Choose Panel Type",
                     Measure.TextBody,
                     0.0f,
                     true);

    const PanelSubject Subjects[4] = { PanelSubject::Viewport, PanelSubject::Uv,
                                       PanelSubject::Outliner, PanelSubject::Properties };
    const ControlRole Roles[4] = { ControlRole::ChooseViewport, ControlRole::ChooseUv,
                                   ControlRole::ChooseOutliner, ControlRole::ChooseProperties };

    for (std::uint32_t Ordinal = 0u; Ordinal < 4u; ++Ordinal)
    {
        const PlaneExtent Button = Spanning(LeastAlong + static_cast<float>(Ordinal) *
                                                        (Measure.ChooserButtonAlong + Measure.ChooserGap),
                                            ButtonAcross,
                                            Measure.ChooserButtonAlong,
                                            Measure.ChooserButtonAcross);
        Surface->Ground(Button, Ink.BodyGround, Measure.ChooserRadius, CornerAll);
        Surface->Edge(Button, Ink.Edge, Measure.EdgeWeight, Measure.ChooserRadius, CornerAll);
        Symbol(Spanning(Button.LeastAlong + Button.SpanAlong() * 0.5f - 12.0f,
                        Button.LeastAcross + 20.0f,
                        24.0f,
                        24.0f), Ink.InkFaint);
        Surface->TextRun(Button.LeastAlong + Button.SpanAlong() * 0.5f,
                         Button.LeastAcross + 69.0f,
                         Ink.InkQuiet,
                         SubjectTitle(Subjects[Ordinal]),
                         Measure.TextSmall,
                         0.0f,
                         true);

        if (Pressed(ControlOrdinal(RecordOrdinal, Roles[Ordinal]), Button))
            Disregard(Partition.Assign(RecordOrdinal, Subjects[Ordinal]));
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     DEFERRED MENUS
//------------------------------------------------------------------------------------------------------------------------

void EditorPanel::RecordDeferred(PanelStructure& Partition, EditorPanelOrdinates& Ordinates)
{
    if (DeferredRecord >= PanelStructure::RecordCeiling)
        return;

    switch (DeferredRole)
    {
        case ControlRole::SubjectMenu:
            RecordSubjectMenu(DeferredRecord, DeferredAnchor, Partition);
            break;
        case ControlRole::DivisionMenu:
            RecordDivisionMenu(DeferredRecord, DeferredAnchor, Partition);
            break;
        case ControlRole::LatticeMenu:
            RecordLatticeMenu(DeferredRecord, DeferredAnchor, Ordinates);
            break;
        case ControlRole::CameraMenu:
        case ControlRole::OverlayMenu:
        case ControlRole::Shading:
        case ControlRole::Gizmo:
            RecordFooterMenu(DeferredRecord, DeferredAnchor, DeferredRole, Ordinates);
            break;
        default:
            break;
    }
}

void EditorPanel::RecordSubjectMenu(std::uint32_t RecordOrdinal,
                                    const PlaneExtent& Anchor,
                                    PanelStructure& Partition)
{
    const EditorPanelMetric& Measure = Appearance->EditorPanelMeasure;
    const EditorPanelInk&    Ink     = Appearance->EditorPanel;
    const PlaneExtent Menu = Spanning(Anchor.LeastAlong,
                                      Anchor.MostAcross + Measure.MenuLift,
                                      Measure.MenuAlong,
                                      Measure.MenuPadAcross * 2.0f + Measure.MenuRowAcross * 4.0f);
    Surface->Ground(Menu, Ink.ChromeGround, Measure.MenuRadius, CornerAll);
    Surface->Edge(Menu, Ink.Edge, Measure.EdgeWeight, Measure.MenuRadius, CornerAll);

    const PanelSubject Subjects[4] = { PanelSubject::Viewport, PanelSubject::Uv,
                                       PanelSubject::Outliner, PanelSubject::Properties };
    const ControlRole Roles[4] = { ControlRole::ChooseViewport, ControlRole::ChooseUv,
                                   ControlRole::ChooseOutliner, ControlRole::ChooseProperties };

    for (std::uint32_t Ordinal = 0u; Ordinal < 4u; ++Ordinal)
    {
        const PlaneExtent Row = Spanning(Menu.LeastAlong + Measure.MenuPadAcross,
                                         Menu.LeastAcross + Measure.MenuPadAcross +
                                             static_cast<float>(Ordinal) * Measure.MenuRowAcross,
                                         Menu.SpanAlong() - Measure.MenuPadAcross * 2.0f,
                                         Measure.MenuRowAcross);
        Symbol(Spanning(Row.LeastAlong + 8.0f, Row.LeastAcross + 7.0f,
                        Measure.HeaderSymbol, Measure.HeaderSymbol), Ink.InkQuiet);
        Surface->TextRun(Row.LeastAlong + 30.0f, Row.LeastAcross + 7.0f,
                         Ink.InkQuiet, SubjectTitle(Subjects[Ordinal]), Measure.TextBody, 0.0f, false);
        if (Pressed(ControlOrdinal(RecordOrdinal, Roles[Ordinal]), Row, true))
        {
            Disregard(Partition.Assign(RecordOrdinal, Subjects[Ordinal]));
            Interaction.Withdraw();
        }
    }
}

void EditorPanel::RecordDivisionMenu(std::uint32_t RecordOrdinal,
                                     const PlaneExtent& Anchor,
                                     PanelStructure& Partition)
{
    const EditorPanelMetric& Measure = Appearance->EditorPanelMeasure;
    const EditorPanelInk&    Ink     = Appearance->EditorPanel;
    const PlaneExtent Menu = Spanning(Anchor.MostAlong - Measure.SplitMenuAlong,
                                      Anchor.MostAcross + Measure.MenuLift,
                                      Measure.SplitMenuAlong,
                                      Measure.MenuPadAcross * 2.0f + Measure.MenuRowAcross * 4.0f + 1.0f);
    Surface->Ground(Menu, Ink.ChromeGround, Measure.MenuRadius, CornerAll);
    Surface->Edge(Menu, Ink.Edge, Measure.EdgeWeight, Measure.MenuRadius, CornerAll);

    const char* Captions[4] = { "Split Left", "Split Right", "Split Top", "Split Bottom" };
    const ControlRole Roles[4] = { ControlRole::DivideLeft, ControlRole::DivideRight,
                                   ControlRole::DivideUpper, ControlRole::DivideLower };

    for (std::uint32_t Ordinal = 0u; Ordinal < 4u; ++Ordinal)
    {
        const PlaneExtent Row = Spanning(Menu.LeastAlong + Measure.MenuPadAcross,
                                         Menu.LeastAcross + Measure.MenuPadAcross +
                                             static_cast<float>(Ordinal) * Measure.MenuRowAcross,
                                         Menu.SpanAlong() - Measure.MenuPadAcross * 2.0f,
                                         Measure.MenuRowAcross);
        Symbol(Spanning(Row.LeastAlong + 8.0f, Row.LeastAcross + 7.0f,
                        Measure.HeaderSymbol, Measure.HeaderSymbol), Ink.InkQuiet);
        Surface->TextRun(Row.LeastAlong + 30.0f, Row.LeastAcross + 7.0f,
                         Ink.InkQuiet, Captions[Ordinal], Measure.TextBody, 0.0f, false);
        if (Pressed(ControlOrdinal(RecordOrdinal, Roles[Ordinal]), Row, true))
        {
            const PanelDivisionAxis Axis = Ordinal < 2u ? PanelDivisionAxis::Along : PanelDivisionAxis::Across;
            const PanelDivisionSide Side = (Ordinal == 0u || Ordinal == 2u)
                                         ? PanelDivisionSide::Least : PanelDivisionSide::Most;
            Disregard(Partition.Divide(RecordOrdinal, Axis, Side));
            Interaction.Withdraw();
        }
    }
}

void EditorPanel::RecordLatticeMenu(std::uint32_t RecordOrdinal,
                                 const PlaneExtent& Anchor,
                                 EditorPanelOrdinates& Ordinates)
{
    const EditorPanelMetric& Measure = Appearance->EditorPanelMeasure;
    const EditorPanelInk&    Ink     = Appearance->EditorPanel;
    const PlaneExtent Menu = Spanning(Anchor.LeastAlong,
                                      Anchor.LeastAcross - 316.0f,
                                      360.0f,
                                      304.0f);
    Surface->Ground(Menu, Ink.ChromeGround, 12.0f, CornerAll);
    Surface->Edge(Menu, Ink.Edge, Measure.EdgeWeight, 12.0f, CornerAll);
    Surface->TextRun(Menu.LeastAlong + 20.0f, Menu.LeastAcross + 18.0f,
                     Ink.InkPrimary, "Grid settings", Measure.TextBody, 0.0f, false);
    Surface->Ground(Spanning(Menu.LeastAlong + 20.0f, Menu.LeastAcross + 44.0f,
                             Menu.SpanAlong() - 40.0f, 1.0f), Ink.Edge);

    const char* LatticeOptions[3] = { "None", "Lines", "Dotted" };
    SelectionDeclaration LatticeDeclaration;
    LatticeDeclaration.Caption     = "Grid";
    LatticeDeclaration.Options     = LatticeOptions;
    LatticeDeclaration.OptionCount = 3u;
    std::uint32_t LatticeReading = static_cast<std::uint32_t>(Ordinates.Lattice);
    SharedControls.SelectionField(Controls[ControlOrdinal(RecordOrdinal, ControlRole::LatticePresentation)],
                                  Spanning(Menu.LeastAlong + 20.0f, Menu.LeastAcross + 58.0f,
                                           Menu.SpanAlong() - 40.0f, 36.0f),
                                  LatticeDeclaration,
                                  LatticeReading);
    Ordinates.Lattice = static_cast<PanelLatticePresentation>(LatticeReading);

    MagnitudeDeclaration ScaleDeclaration;
    ScaleDeclaration.Caption     = "Scale";
    ScaleDeclaration.UnitGlyph   = "m";
    ScaleDeclaration.LeastOrdinal= 1.0;
    ScaleDeclaration.MostOrdinal = 10.0;
    double ScaleReading = static_cast<double>(Ordinates.LatticeScale);
    SharedControls.MagnitudeRow(Controls[ControlOrdinal(RecordOrdinal, ControlRole::LatticeScale)],
                                Spanning(Menu.LeastAlong + 20.0f, Menu.LeastAcross + 106.0f,
                                         Menu.SpanAlong() - 40.0f, 36.0f),
                                ScaleDeclaration,
                                ScaleReading,
                                true);
    Ordinates.LatticeScale = static_cast<std::uint32_t>(std::round(ScaleReading));

    MagnitudeDeclaration SubdivisionDeclaration;
    SubdivisionDeclaration.Caption      = "Subdivisions";
    SubdivisionDeclaration.UnitGlyph    = "";
    SubdivisionDeclaration.LeastOrdinal = 1.0;
    SubdivisionDeclaration.MostOrdinal  = 100.0;
    double SubdivisionReading = static_cast<double>(Ordinates.Subdivisions);
    SharedControls.MagnitudeRow(Controls[ControlOrdinal(RecordOrdinal, ControlRole::Subdivisions)],
                                Spanning(Menu.LeastAlong + 20.0f, Menu.LeastAcross + 154.0f,
                                         Menu.SpanAlong() - 40.0f, 36.0f),
                                SubdivisionDeclaration,
                                SubdivisionReading,
                                true);
    Ordinates.Subdivisions = static_cast<std::uint32_t>(std::round(SubdivisionReading));

    ToggleDeclaration AxisDeclarations[3];
    AxisDeclarations[0].Caption = "X axis";
    AxisDeclarations[1].Caption = "Y axis";
    AxisDeclarations[2].Caption = "Z axis";
    bool* AxisReadings[3] = { &Ordinates.AxisX, &Ordinates.AxisY, &Ordinates.AxisZ };
    const ControlRole AxisRoles[3] = { ControlRole::AxisX, ControlRole::AxisY, ControlRole::AxisZ };
    for (std::uint32_t Ordinal = 0u; Ordinal < 3u; ++Ordinal)
    {
        SharedControls.ToggleRow(Controls[ControlOrdinal(RecordOrdinal, AxisRoles[Ordinal])],
                                 Spanning(Menu.LeastAlong + 20.0f + static_cast<float>(Ordinal) * 106.0f,
                                          Menu.LeastAcross + 214.0f,
                                          96.0f,
                                          44.0f),
                                 AxisDeclarations[Ordinal],
                                 *AxisReadings[Ordinal]);
    }
}

void EditorPanel::RecordFooterMenu(std::uint32_t RecordOrdinal,
                                   const PlaneExtent& Anchor,
                                   ControlRole Role,
                                   EditorPanelOrdinates& Ordinates)
{
    const EditorPanelMetric& Measure = Appearance->EditorPanelMeasure;
    const EditorPanelInk&    Ink     = Appearance->EditorPanel;

    if (Role == ControlRole::CameraMenu)
    {
        const PlaneExtent Menu = Spanning(Anchor.LeastAlong, Anchor.LeastAcross - 116.0f, 240.0f, 104.0f);
        Surface->Ground(Menu, Ink.ChromeGround, 12.0f, CornerAll);
        Surface->Edge(Menu, Ink.Edge, Measure.EdgeWeight, 12.0f, CornerAll);
        Surface->TextRun(Menu.LeastAlong + 12.0f, Menu.LeastAcross + 14.0f,
                         Ink.InkSecondary, "Saved Cameras", Measure.TextSmall, 0.0f, false);
        Surface->TextRun(Menu.MostAlong - 12.0f, Menu.LeastAcross + 14.0f,
                         Ink.Accent, "+ Save", Measure.TextSmall, 0.0f, true);
        Surface->Ground(Spanning(Menu.LeastAlong + 12.0f, Menu.LeastAcross + 38.0f,
                                 Menu.SpanAlong() - 24.0f, 1.0f), Ink.Edge);
        Surface->TextRun(Menu.LeastAlong + Menu.SpanAlong() * 0.5f, Menu.LeastAcross + 70.0f,
                         Ink.InkFaint, "No saved cameras", Measure.TextSmall, 0.0f, true);
        return;
    }

    if (Role == ControlRole::OverlayMenu)
    {
        const PlaneExtent Menu = Spanning(Anchor.MostAlong - 200.0f, Anchor.LeastAcross - 132.0f, 200.0f, 120.0f);
        Surface->Ground(Menu, Ink.ChromeGround, 12.0f, CornerAll);
        Surface->Edge(Menu, Ink.Edge, Measure.EdgeWeight, 12.0f, CornerAll);

        ToggleDeclaration Declarations[3];
        Declarations[0].Caption = "FPS Monitor";
        Declarations[1].Caption = "Storage Allocation";
        Declarations[2].Caption = "GPU Renderer";
        bool* Readings[3] = { &Ordinates.FpsOverlay, &Ordinates.StorageOverlay, &Ordinates.RendererOverlay };
        const ControlRole Roles[3] = { ControlRole::AxisX, ControlRole::AxisY, ControlRole::AxisZ };
        for (std::uint32_t Ordinal = 0u; Ordinal < 3u; ++Ordinal)
        {
            SharedControls.ToggleRow(Controls[ControlOrdinal(RecordOrdinal, Roles[Ordinal])],
                                     Spanning(Menu.LeastAlong + 8.0f,
                                              Menu.LeastAcross + 6.0f + static_cast<float>(Ordinal) * 36.0f,
                                              Menu.SpanAlong() - 16.0f,
                                              34.0f),
                                     Declarations[Ordinal],
                                     *Readings[Ordinal]);
        }
        return;
    }

    const std::uint32_t OptionCount = Role == ControlRole::Shading ? 6u : 2u;
    const float MenuAlong = Role == ControlRole::Shading ? 160.0f : 130.0f;
    const PlaneExtent Menu = Spanning(Anchor.MostAlong - MenuAlong,
                                      Anchor.LeastAcross - Measure.MenuPadAcross * 2.0f -
                                          Measure.MenuRowAcross * static_cast<float>(OptionCount) - 12.0f,
                                      MenuAlong,
                                      Measure.MenuPadAcross * 2.0f +
                                          Measure.MenuRowAcross * static_cast<float>(OptionCount));
    Surface->Ground(Menu, Ink.ChromeGround, Measure.MenuRadius, CornerAll);
    Surface->Edge(Menu, Ink.Edge, Measure.EdgeWeight, Measure.MenuRadius, CornerAll);

    const char* ShadingOptions[6] = { "solid", "wireframe", "matcap", "normal", "metallic", "gi" };
    const char* GizmoOptions[2] = { "blender", "cad" };
    const ControlRole OptionRoles[6] = { ControlRole::DivideLeft, ControlRole::DivideRight,
                                         ControlRole::DivideUpper, ControlRole::DivideLower,
                                         ControlRole::ChooseViewport, ControlRole::ChooseUv };
    for (std::uint32_t Ordinal = 0u; Ordinal < OptionCount; ++Ordinal)
    {
        const PlaneExtent Row = Spanning(Menu.LeastAlong + Measure.MenuPadAcross,
                                         Menu.LeastAcross + Measure.MenuPadAcross +
                                             static_cast<float>(Ordinal) * Measure.MenuRowAcross,
                                         Menu.SpanAlong() - Measure.MenuPadAcross * 2.0f,
                                         Measure.MenuRowAcross);
        const bool Taken = Role == ControlRole::Shading
                         ? static_cast<std::uint32_t>(Ordinates.Shading) == Ordinal
                         : static_cast<std::uint32_t>(Ordinates.Gizmo) == Ordinal;
        if (Taken)
            Surface->Ground(Row, Ink.Roused, 4.0f, CornerAll);
        Surface->TextRun(Row.LeastAlong + 12.0f, Row.LeastAcross + 7.0f,
                         Taken ? Ink.InkPrimary : Ink.InkQuiet,
                         Role == ControlRole::Shading ? ShadingOptions[Ordinal] : GizmoOptions[Ordinal],
                         Measure.TextBody,
                         0.0f,
                         false);
        if (Pressed(ControlOrdinal(RecordOrdinal, OptionRoles[Ordinal]), Row, true))
        {
            if (Role == ControlRole::Shading)
                Ordinates.Shading = static_cast<PanelShading>(Ordinal);
            else
                Ordinates.Gizmo = static_cast<PanelGizmo>(Ordinal);
            Interaction.Withdraw();
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       RECLAMATION
//------------------------------------------------------------------------------------------------------------------------

void EditorPanel::Reset()
{
    PropertyPresentation.Reset();
    OutlinerPresentation.Reset();
    UvPresentation.Reset();
    ScenePresentation.Reset();
    SharedControls.Reset();
    Interaction.Reset();
    Motion          = nullptr;
    Surface         = nullptr;
    Appearance      = nullptr;
    Pointer         = {};
    DeferredAnchor  = {};
    DeferredRecord  = PanelStructure::RecordCeiling;
    DeferredRole    = ControlRole::RoleCount;
    DraggedDivision = PanelStructure::RecordCeiling;
    DraggedExtent   = {};

    for (std::uint32_t Ordinal = 0u; Ordinal < ControlCapacity; ++Ordinal)
        Controls[Ordinal] = {};
}

}   // namespace Slate
