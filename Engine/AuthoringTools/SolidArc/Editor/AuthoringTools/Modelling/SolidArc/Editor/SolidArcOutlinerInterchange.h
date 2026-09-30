//============================================================================================================================================
//                                              SOLIDARCOUTLINERINTERCHANGE.H
//============================================================================================================================================

// 📦 Maps a SolidArc CAD document onto the shared editor outliner and inspector feed. The panels stay the
//    shared OutlinerPanel and InspectorPanel; this interchange only speaks their EditorInstance rows and
//    EditorSheet cards, so the CAD tool and the game editor present one outliner and one inspector.

#pragma once

#include "Console/ConsoleHost.h"
#include "../../../../../Engine/Editor/EditorInstance.h"

#include <cstdint>

namespace Frontier {

// The CAD narrowing vocabulary: one bit per folder, seated into the outliner's narrowing catalogue.
namespace SolidArcOutlinerNarrowing
{
constexpr uint32_t Lines        = 1u << 0u;
constexpr uint32_t Profiles     = 1u << 1u;
constexpr uint32_t Bodies       = 1u << 2u;
constexpr uint32_t Surfaces     = 1u << 3u;
constexpr uint32_t Construction = 1u << 4u;
constexpr uint32_t Dimensions   = 1u << 5u;
constexpr uint32_t Unlisted     = 1u << 31u;   // matches no vocabulary entry; the row shows only with no narrowing lit
}

struct SolidArcRowCounterpart
{
    enum class Role : uint32_t
    {
        None = 0u,
        Figure,
        Dimension,
        Constraint,
    };

    Role     RowRole        = Role::None;
    uint32_t FigureIdentity = 0u;
    uint32_t DimensionId    = 0u;
    uint32_t ConstraintId   = 0u;
};

[[nodiscard]] uint32_t BuildSolidArcOutliner(const ConsoleHost& Host,
                                             EditorInstance* Rows,
                                             SolidArcRowCounterpart* Counterparts,
                                             uint32_t Capacity,
                                             EditorReadout* Readout) noexcept;

void ApplySolidArcOutlinerVisibility(ConsoleHost& Host,
                                      const EditorInstance* Rows,
                                      const SolidArcRowCounterpart* Counterparts,
                                      uint32_t RowCount) noexcept;

[[nodiscard]] bool BuildSolidArcInspectorSheet(const ConsoleHost& Host,
                                               const SolidArcRowCounterpart& Counterpart,
                                               EditorSheet* Sheet) noexcept;

void ApplySolidArcInspectorSheet(ConsoleHost& Host,
                                 const SolidArcRowCounterpart& Counterpart,
                                 const EditorSheet& Sheet) noexcept;

} // namespace Frontier
