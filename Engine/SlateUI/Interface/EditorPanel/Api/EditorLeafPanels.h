//============================================================================================================================================
//                                                        EDITORLEAFPANELS.H
//============================================================================================================================================
// 🧩 Focused skeletal render targets for scene, UV, outliner and property leaves inside reusable editor chrome.

#pragma once

#include "Contract/DeliveryContract.h"
#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONTENT PRESENTATIONS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Presents the three-dimensional scene render target beneath shared editor chrome.
/// tag   owning, nonallocating, nonthrowing
class ScenePanel
{
public:
    Deliver<bool> Construct(RecordingSurface& Surface, const AppearanceSpecification& Appearance);
    void Record(const PlaneExtent& Extent);
    void Reset();

private:
    RecordingSurface* Surface = nullptr;
    const AppearanceSpecification* Appearance = nullptr;
};

/// 🧩 Presents the selected geometry's UV render target beneath shared editor chrome.
/// tag   owning, nonallocating, nonthrowing
class UvPanel
{
public:
    Deliver<bool> Construct(RecordingSurface& Surface, const AppearanceSpecification& Appearance);
    void Record(const PlaneExtent& Extent);
    void Reset();

private:
    RecordingSurface* Surface = nullptr;
    const AppearanceSpecification* Appearance = nullptr;
};

/// 🧩 Presents the scene outline beneath shared editor chrome.
/// tag   owning, nonallocating, nonthrowing
class OutlinerPanel
{
public:
    Deliver<bool> Construct(RecordingSurface& Surface, const AppearanceSpecification& Appearance);
    void Record(const PlaneExtent& Extent);
    void Reset();

private:
    RecordingSurface* Surface = nullptr;
    const AppearanceSpecification* Appearance = nullptr;
};

/// 🧩 Presents the selected record's properties beneath shared editor chrome.
/// tag   owning, nonallocating, nonthrowing
class PropertyPanel
{
public:
    Deliver<bool> Construct(RecordingSurface& Surface, const AppearanceSpecification& Appearance);
    void Record(const PlaneExtent& Extent);
    void Reset();

private:
    RecordingSurface* Surface = nullptr;
    const AppearanceSpecification* Appearance = nullptr;
};

}   // namespace Slate
