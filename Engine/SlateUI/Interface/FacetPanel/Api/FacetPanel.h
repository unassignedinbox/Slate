//============================================================================================================================================
//                                                             FACETPANEL.H
//============================================================================================================================================
// 🧩 A reusable multi-facet card — active chips, individual removal, clear-all and a shared selection dropdown.

#pragma once

#include "Contract/DeliveryContract.h"
#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"
#include "SlateUI/Interface/ComponentSpecification/Api/ComponentSpecification.h"
#include "SlateUI/Interface/InteractionIndex/Api/InteractionIndex.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"
#include "SlateUI/Interface/MotionIntegrator/Api/MotionIntegrator.h"

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      FACET CONTRACT
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Names every available facet and optionally gives each one a classification ink.
/// note  Options, inks and enabled ordinates remain owned by the caller. The panel borrows them for one tick.
/// tag   contract, nonallocating, nonthrowing
struct FacetDeclaration
{
    const char*         Caption       = "Filters";             // [-] - card heading
    const char* const*  Options       = nullptr;               // [-] - all available facet captions
    const InkOrdinate*  Inks          = nullptr;               // [-] - optional classification inks
    std::uint32_t       OptionCount   = 0u;                    // [-] - options and enabled ordinates
    std::uint32_t       LockedOrdinal = 0xFFFFFFFFu;           // [-] - active facet that cannot be removed
};

//------------------------------------------------------------------------------------------------------------------------
//                                                     FACET PRESENTATION
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Presents and edits a caller-owned active facet set without retaining application content.
/// tag   owning, nonallocating, nonthrowing
class FacetPanel
{
public:

    static constexpr std::uint32_t FacetCapacity = 24u;   // [-] - bounded available facets
    static constexpr std::uint32_t AbsentFacet   = 0xFFFFFFFFu;

    Deliver<bool> Construct(MotionIntegrator& Motion,
                            RecordingSurface& Surface,
                            const AppearanceSpecification& Appearance);
    void Advance(const PointerCondition& Arrived, double Elapsed);
    float MeasureAcross(float ExtentAlong,
                        const FacetDeclaration& Declared,
                        const bool* Enabled) const;
    Deliver<bool> Record(const PlaneExtent& Extent,
                         const FacetDeclaration& Declared,
                         bool* Enabled);
    void RecordDeferred();
    void Reset();

private:

    struct Arrangement
    {
        PlaneExtent Header       = {};   // [px] - heading and count
        PlaneExtent Chips        = {};   // [px] - wrapped active chips
        PlaneExtent Dropdown     = {};   // [px] - shared selection field
        float       TotalAcross  = 0.0f; // [px] - complete card height
    };

    Arrangement Arrange(float Along,
                        float Across,
                        float ExtentAlong,
                        const FacetDeclaration& Declared,
                        const bool* Enabled) const;
    bool Pressed(std::uint32_t Ordinal, const PlaneExtent& Extent);
    InkOrdinate FacetInk(const FacetDeclaration& Declared, std::uint32_t Ordinal) const;

    MotionIntegrator* Motion = nullptr;
    RecordingSurface* Surface = nullptr;
    const AppearanceSpecification* Appearance = nullptr;
    InteractionIndex Interaction = {};
    ComponentSpecification SharedControls = {};
    ControlIdentity Controls[FacetCapacity + 2u] = {};
    PointerCondition Pointer = {};
    const char* AvailableOptions[FacetCapacity + 1u] = {};
    std::uint32_t AvailableOrdinals[FacetCapacity + 1u] = {};
    std::uint32_t AvailableCount = 0u;
    std::uint32_t PendingSelection = 0u;
};

}   // namespace Slate
