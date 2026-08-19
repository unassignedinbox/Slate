//============================================================================================================================================
//                                                       SCENEDIRECTORPANEL.H
//============================================================================================================================================
// Native Scene Director, property/revision inspector and texture-paint layer stack.

#pragma once

#include "Contract/DeliveryContract.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"
#include "SlateUI/Interface/ThemeSpecification/Api/ThemeSpecification.h"

#include <cstdint>

namespace Slate
{

enum class DirectorPresentation : std::uint32_t
{
    Scene = 0u,
    TexturePaint = 1u
};

enum class DirectorInspector : std::uint32_t
{
    Properties = 0u,
    Revisions = 1u
};

struct SceneDirectorOrdinates
{
    ThemeSubject Theme = ThemeSubject::Oled;
    DirectorPresentation Presentation = DirectorPresentation::Scene;
    DirectorInspector Inspector = DirectorInspector::Properties;
    std::uint32_t SelectedRecord = 2u;
    std::uint32_t SelectedLayer = 0u;
    bool MaskTarget = false;
};

/// Presents the standalone native port of remix-remix-global-ui. The caller owns all durable ordinates.
class SceneDirectorPanel
{
public:
    Deliver<bool> Construct(RecordingSurface& ArrivingSurface);
    void Advance(const PointerCondition& Arrived, double ElapsedMilliseconds);
    Deliver<bool> Record(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates);
    void Reset();

private:
    struct SceneRecord
    {
        const char* Caption = "";
        const char* Classification = "";
        std::uint32_t Depth = 0u;
        std::uint32_t Enclosing = 99u;
        std::uint32_t NestedCount = 0u;
        InkOrdinate Hue = {};
        bool Expanded = false;
        bool Hidden = false;
    };

    struct PaintLayer
    {
        const char* Caption = "";
        const char* Content = "";
        const char* Blend = "";
        std::uint32_t Opacity = 100u;
        InkOrdinate Tag = {};
        bool Shown = true;
        bool Expanded = false;
        bool MaskEnabled = false;
        bool MaskShown = true;
    };

    bool Pressed(const PlaneExtent& Extent) const;
    bool Roused(const PlaneExtent& Extent) const;
    void Symbol(const PlaneExtent& Extent, InkOrdinate Ink, float Turn = 0.0f);
    void Header(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates, const ThemeDeclaration& Theme);
    void ScenePresentation(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates, const ThemeDeclaration& Theme);
    void Outliner(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates, const ThemeDeclaration& Theme);
    void Inspector(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates, const ThemeDeclaration& Theme);
    void Properties(const PlaneExtent& Extent, const SceneRecord& Record, const ThemeDeclaration& Theme);
    void Revisions(const PlaneExtent& Extent, const SceneRecord& Record, const ThemeDeclaration& Theme);
    void TexturePresentation(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates, const ThemeDeclaration& Theme);
    void LayerStack(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates, const ThemeDeclaration& Theme);
    void LayerInspector(const PlaneExtent& Extent, SceneDirectorOrdinates& Ordinates, const ThemeDeclaration& Theme);
    void Field(const PlaneExtent& Extent, const char* Caption, const char* Reading, const char* Unit,
               const ThemeDeclaration& Theme, float Fraction = -1.0f);
    void Switch(const PlaneExtent& Extent, const char* Caption, bool Taken, const ThemeDeclaration& Theme);

    RecordingSurface* Surface = nullptr;
    PointerCondition Pointer = {};
    double Elapsed = 0.0;
    std::uint32_t LayerCount = 4u;
    SceneRecord Records[14] = {};
    PaintLayer Layers[8] = {};
    float LayerDisclosure[8] = {};
    float InspectorArrival = 1.0f;
    std::uint32_t PresentedRecord = 2u;
    std::uint32_t PresentedLayer = 0u;
    std::uint32_t DraggedLayer = 8u;
};

} // namespace Slate
