//============================================================================================================================================
//                                                       EDITORLEAFPANELS.CPP
//============================================================================================================================================
// 🧩 Skeletal scene, UV, outliner and property bodies, isolated from the shared editor chrome and partition.

#include "SlateUI/Interface/EditorPanel/Api/EditorLeafPanels.h"

namespace Slate
{

namespace
{

void RecordTarget(RecordingSurface& Surface,
                  const AppearanceSpecification& Appearance,
                  const PlaneExtent& Extent,
                  InkOrdinate Ground,
                  const char* Caption,
                  float TextSize)
{
    Surface.Ground(Extent, Ground);
    Surface.TextRun(Extent.LeastAlong + Extent.SpanAlong() * 0.5f,
                    Extent.LeastAcross + Extent.SpanAcross() * 0.5f,
                    Appearance.EditorPanel.InkGhost,
                    Caption,
                    TextSize,
                    0.0f,
                    true);
}

Deliver<bool> Seat(RecordingSurface*& Surface,
                   const AppearanceSpecification*& Appearance,
                   RecordingSurface& ArrivingSurface,
                   const AppearanceSpecification& ArrivingAppearance)
{
    if (Surface != nullptr)
        return Deliver<bool>::Refuse({ RefusalReason::ContentUnsupported, "a leaf panel construction stands" });

    Surface    = &ArrivingSurface;
    Appearance = &ArrivingAppearance;
    return Deliver<bool>::Deliver(true);
}

}   // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                      SCENE TARGET
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> ScenePanel::Construct(RecordingSurface& ArrivingSurface,
                                    const AppearanceSpecification& ArrivingAppearance)
{
    return Seat(Surface, Appearance, ArrivingSurface, ArrivingAppearance);
}

void ScenePanel::Record(const PlaneExtent& Extent)
{
    if (Surface == nullptr || Appearance == nullptr)
        return;

    RecordTarget(*Surface, *Appearance, Extent, Appearance->EditorPanel.ViewGround,
                 "3D VIEWPORT RENDER TARGET", Appearance->EditorPanelMeasure.TextSmall);
}

void ScenePanel::Reset()
{
    Surface    = nullptr;
    Appearance = nullptr;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        UV TARGET
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> UvPanel::Construct(RecordingSurface& ArrivingSurface,
                                 const AppearanceSpecification& ArrivingAppearance)
{
    return Seat(Surface, Appearance, ArrivingSurface, ArrivingAppearance);
}

void UvPanel::Record(const PlaneExtent& Extent)
{
    if (Surface == nullptr || Appearance == nullptr)
        return;

    RecordTarget(*Surface, *Appearance, Extent, Appearance->EditorPanel.ViewGround,
                 "UV EDITOR RENDER TARGET", Appearance->EditorPanelMeasure.TextSmall);
}

void UvPanel::Reset()
{
    Surface    = nullptr;
    Appearance = nullptr;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     OUTLINER TARGET
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> OutlinerPanel::Construct(RecordingSurface& ArrivingSurface,
                                       const AppearanceSpecification& ArrivingAppearance)
{
    return Seat(Surface, Appearance, ArrivingSurface, ArrivingAppearance);
}

void OutlinerPanel::Record(const PlaneExtent& Extent)
{
    if (Surface == nullptr || Appearance == nullptr)
        return;

    RecordTarget(*Surface, *Appearance, Extent, Appearance->EditorPanel.BodyGround,
                 "Empty", Appearance->EditorPanelMeasure.TextBody);
}

void OutlinerPanel::Reset()
{
    Surface    = nullptr;
    Appearance = nullptr;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     PROPERTY TARGET
//------------------------------------------------------------------------------------------------------------------------

Deliver<bool> PropertyPanel::Construct(RecordingSurface& ArrivingSurface,
                                       const AppearanceSpecification& ArrivingAppearance)
{
    return Seat(Surface, Appearance, ArrivingSurface, ArrivingAppearance);
}

void PropertyPanel::Record(const PlaneExtent& Extent)
{
    if (Surface == nullptr || Appearance == nullptr)
        return;

    RecordTarget(*Surface, *Appearance, Extent, Appearance->EditorPanel.BodyGround,
                 "Empty", Appearance->EditorPanelMeasure.TextBody);
}

void PropertyPanel::Reset()
{
    Surface    = nullptr;
    Appearance = nullptr;
}

}   // namespace Slate
