//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/OutlinerStructure.h — World Record Specification, Domain Classifications and Outliner Topology
//============================================================================================================================================

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)                              // Disable structure padding alignment warning under /WX
#endif

#include "VectorCodec.h"
#include "ThemeStructure.h"
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                              OUTLINER STATUS TONE
//------------------------------------------------------------------------------------------------------------------------

enum class OutlinerStatusTone : uint32_t
{
    Success                             = 0,                    // [ok] green tone / healthy condition
    Warning                             = 1,                    // [warn] amber-orange tone / attention needed
    Informational                       = 2                     // [info] neutral muted tone / descriptive
};

//------------------------------------------------------------------------------------------------------------------------
//                                            OUTLINER DOMAIN CATEGORY
//------------------------------------------------------------------------------------------------------------------------

enum class OutlinerDomainCategory : uint32_t
{
    Lights                              = 0,                    // 💡 luminaires and illuminators
    Sky                                 = 1,                    // ☁️ celestial bodies and atmospheric volumetrics
    Bodies                              = 2,                    // 🌙 orbital moons and satellites
    Geometry                            = 3,                    // ▱ static meshes and height fields
    Camera                              = 4,                    // 🎥 sensors and view projections
    Count                               = 5
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 OUTLINER RECORD
//------------------------------------------------------------------------------------------------------------------------

struct OutlinerRecord
{
    std::string             Identifier;                         // [text] unique record key (e.g. "sun")
    std::string             DisplayName;                        // [text] human visible label (e.g. "Sun")
    std::string             CategoryName;                       // [text] classification (e.g. "Directional Light")
    std::string             ScopeIdentifier;                    // [text] enclosing group key (empty for root)
    OutlinerIconCategory    Icon;                               // [icon] vector glyph identifier
    ColorQuad               AccentColour;                       // [rgba] semantic accent colour quad
    OutlinerDomainCategory  Domain;                             // [domain] filter classification domain
    bool                    GroupCondition      = false;        // [bool] true if expandable group container
    bool                    VisibleCondition    = true;         // [bool] true if world entity is visible
    bool                    OpenCondition       = true;         // [bool] true if group branch is unfolded
    std::string             SummaryText;                        // [text] brief telemetry metadata (e.g. "0.0°")
    OutlinerStatusTone      StatusTone          = OutlinerStatusTone::Success; // [tone] health classification
    std::string             StatusDescription   = "All good";   // [text] tooltip health explanation
    std::string             ClassificationTag;                  // [text] optional badge (e.g. "Comp")
};

//------------------------------------------------------------------------------------------------------------------------
//                                               OUTLINER STAT RECORD
//------------------------------------------------------------------------------------------------------------------------

struct OutlinerStatRecord
{
    uint32_t                TotalCount          = 0u;           // [-] registered record count
    uint32_t                VisibleCount        = 0u;           // [-] visible record count
    uint32_t                HiddenCount         = 0u;           // [-] hidden record count
};

//------------------------------------------------------------------------------------------------------------------------
//                                             OUTLINER TELEMETRY RECORD
//------------------------------------------------------------------------------------------------------------------------

struct OutlinerTelemetryRecord
{
    float                   FramesPerSecond     = 60.0f;        // [Hz] realtime refresh rate
    const char*             QualityTierText     = "Standard";   // [text] rendering fidelity tier
    float                   SunElevationDegrees = 0.0f;         // [deg] solar elevation
    uint32_t                MoonsInOrbitCount   = 1u;           // [-] active moon satellites
    uint32_t                MoonsCapacityCount  = 4u;           // [-] maximum moon capacity
    float                   CameraPositionX     = 0.0f;         // [m] camera translation X
    float                   CameraPositionY     = 2.0f;         // [m] camera translation Y
    float                   CameraPositionZ     = 0.0f;         // [m] camera translation Z
};

} // namespace Frontier
