//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/VectorCodec.cpp — Categorized Scalable Vector Graphic (SVG) Path Decoders Implementation
//============================================================================================================================================

#include "VectorCodec.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                           NAVIGATION GLYPH LOOKUP TABLE
//------------------------------------------------------------------------------------------------------------------------

const std::array<VectorGlyphRecord, static_cast<size_t>(NavigationIconCategory::Count)> VectorCodec::NavigationGlyphTable = {
    // 0: ArrowUp
    VectorGlyphRecord{
        "ArrowUp",
        "M12 19V5M5 12l7-7 7 7",
        24, 24, 2.0f
    },
    // 1: ArrowDown
    VectorGlyphRecord{
        "ArrowDown",
        "M12 5v14M19 12l-7 7-7-7",
        24, 24, 2.0f
    },
    // 2: ArrowLeft
    VectorGlyphRecord{
        "ArrowLeft",
        "M19 12H5M12 19l-7-7 7-7",
        24, 24, 2.0f
    },
    // 3: ArrowRight
    VectorGlyphRecord{
        "ArrowRight",
        "M5 12h14M12 5l7 7-7 7",
        24, 24, 2.0f
    },
    // 4: ChevronUp
    VectorGlyphRecord{
        "ChevronUp",
        "M18 15l-6-6-6 6",
        24, 24, 2.0f
    },
    // 5: ChevronDown
    VectorGlyphRecord{
        "ChevronDown",
        "M6 9l6 6 6-6",
        24, 24, 2.0f
    },
    // 6: ChevronLeft
    VectorGlyphRecord{
        "ChevronLeft",
        "M15 18l-6-6 6-6",
        24, 24, 2.0f
    },
    // 7: ChevronRight
    VectorGlyphRecord{
        "ChevronRight",
        "M9 18l6-6-6-6",
        24, 24, 2.0f
    },
    // 8: ChevronsUp
    VectorGlyphRecord{
        "ChevronsUp",
        "M17 11l-5-5-5 5M17 18l-5-5-5 5",
        24, 24, 2.0f
    },
    // 9: ChevronsDown
    VectorGlyphRecord{
        "ChevronsDown",
        "M7 13l5 5 5-5M7 6l5 5 5-5",
        24, 24, 2.0f
    },
    // 10: ChevronsLeft
    VectorGlyphRecord{
        "ChevronsLeft",
        "M11 17l-5-5 5-5M18 17l-5-5 5-5",
        24, 24, 2.0f
    },
    // 11: ChevronsRight
    VectorGlyphRecord{
        "ChevronsRight",
        "M13 17l5-5-5-5M6 17l5-5-5-5",
        24, 24, 2.0f
    },
    // 12: CornerDownRight
    VectorGlyphRecord{
        "CornerDownRight",
        "M15 10l5 5-5 5M4 4v7a4 4 0 0 0 4 4h12",
        24, 24, 2.0f
    },
    // 13: CornerDownLeft
    VectorGlyphRecord{
        "CornerDownLeft",
        "M9 10l-5 5 5 5M20 4v7a4 4 0 0 1-4 4H4",
        24, 24, 2.0f
    },
    // 14: RotateClockwise
    VectorGlyphRecord{
        "RotateClockwise",
        "M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8M21 3v5h-5",
        24, 24, 2.0f
    },
    // 15: RotateCounterClockwise
    VectorGlyphRecord{
        "RotateCounterClockwise",
        "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8M3 3v5h5",
        24, 24, 2.0f
    },
    // 16: ExpandDiagonal
    VectorGlyphRecord{
        "ExpandDiagonal",
        "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
        24, 24, 2.0f
    },
    // 17: CollapseDiagonal
    VectorGlyphRecord{
        "CollapseDiagonal",
        "M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7",
        24, 24, 2.0f
    }
};

//------------------------------------------------------------------------------------------------------------------------
//                                         CONTROL CENTRE GLYPH LOOKUP TABLE
//------------------------------------------------------------------------------------------------------------------------

const std::array<VectorGlyphRecord, static_cast<size_t>(ControlCentreIconCategory::Count)> VectorCodec::ControlCentreGlyphTable = {
    // 0: SettingsGear
    VectorGlyphRecord{
        "SettingsGear",
        "M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
        24, 24, 2.0f
    },
    // 1: AppearancePalette
    VectorGlyphRecord{
        "AppearancePalette",
        "M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8zM14 6.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zM18 10.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zM7 12.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0zM9 7.5a.5.5 0 1 1-1 0 .5.5 0 0 1 1 0z",
        24, 24, 2.0f
    },
    // 2: DisplayMonitor
    VectorGlyphRecord{
        "DisplayMonitor",
        "M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 21h8M12 17v4",
        24, 24, 2.0f
    },
    // 3: InputDevices
    VectorGlyphRecord{
        "InputDevices",
        "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
        24, 24, 2.0f
    },
    // 4: NotificationsBell
    VectorGlyphRecord{
        "NotificationsBell",
        "M10.268 21a2 2 0 0 0 3.464 0M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326",
        24, 24, 2.0f
    },
    // 5: WirelessSignal
    VectorGlyphRecord{
        "WirelessSignal",
        "M12 20h.01M2 8.82a15 15 0 0 1 20 0M5 12.859a10 10 0 0 1 14 0M8.5 16.429a5 5 0 0 1 7 0",
        24, 24, 2.0f
    },
    // 6: BluetoothSymbol
    VectorGlyphRecord{
        "BluetoothSymbol",
        "M7 7l10 10-5 5V2l5 5L7 17",
        24, 24, 2.0f
    },
    // 7: MoonDisturbance
    VectorGlyphRecord{
        "MoonDisturbance",
        "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
        24, 24, 2.0f
    },
    // 8: VolumeSpeaker
    VectorGlyphRecord{
        "VolumeSpeaker",
        "M11 5L6 9H2v6h4l5 4V5zm8.07-.07a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07",
        24, 24, 2.0f
    },
    // 9: SunIllumination — lucide "sun": circle r4 + 8 rays
    VectorGlyphRecord{
        "SunIllumination",
        "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41",
        24, 24, 2.0f
    },
    // 10: SparklesAntiAliasing — lucide "sparkles"
    VectorGlyphRecord{
        "SparklesAntiAliasing",
        "M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594zM20 2v4M22 4h-4M6 20a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
        24, 24, 2.0f
    },
    // 11: GaugeFrameRate — lucide "gauge"
    VectorGlyphRecord{
        "GaugeFrameRate",
        "m12 14 4-4M3.34 19a10 10 0 1 1 17.32 0",
        24, 24, 2.0f
    },
    // 12: SlidersQuality — lucide "sliders-horizontal"
    VectorGlyphRecord{
        "SlidersQuality",
        "M10 5H3M12 19H3M14 3v4M16 17v4M21 12h-9M21 19h-5M21 5h-7M8 10v4M8 12H3",
        24, 24, 2.0f
    },
    // 13: VideoRenderScale — lucide "video": lens path + rounded rect x2 y6 w14 h12 rx2
    VectorGlyphRecord{
        "VideoRenderScale",
        "m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5M4 6h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",
        24, 24, 2.0f
    },
    // 14: CloseCross — lucide "x"
    VectorGlyphRecord{ "CloseCross", "M18 6 6 18M6 6l12 12", 24, 24, 2.0f },
    // 15: ChevronBack — lucide "chevron-left"
    VectorGlyphRecord{ "ChevronBack", "m15 18-6-6 6-6", 24, 24, 2.0f },
    // 16: ChevronForward — lucide "chevron-right"
    VectorGlyphRecord{ "ChevronForward", "m9 18 6-6-6-6", 24, 24, 2.0f },
    // 17: ShieldInput — lucide "shield"
    VectorGlyphRecord{
        "ShieldInput",
        "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",
        24, 24, 2.0f
    },
    // 18: ChevronDown — lucide "chevron-down"
    VectorGlyphRecord{ "ChevronDown", "m6 9 6 6 6-6", 24, 24, 2.0f },
    // 19: ChevronUp — lucide "chevron-up"
    VectorGlyphRecord{ "ChevronUp", "m18 15-6-6-6 6", 24, 24, 2.0f },
    // 20: TriangleAlert — lucide "triangle-alert"
    VectorGlyphRecord{ "TriangleAlert", "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3ZM12 9v4M12 17h.01", 24, 24, 2.0f },
    // 21: CircleCheck — lucide "circle-check-big"
    VectorGlyphRecord{ "CircleCheck", "M22 11.08V12a10 10 0 1 1-5.93-9.14M9 11l3 3L22 4", 24, 24, 2.0f },
    // 22: CircleInfo — lucide "info"
    VectorGlyphRecord{ "CircleInfo", "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM12 16v-4M12 8h.01", 24, 24, 2.0f },
    // 23: OctagonAlert — lucide "octagon-alert"
    VectorGlyphRecord{ "OctagonAlert", "M12 16h.01M12 8v4M15.312 2a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586l-4.688-4.688A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2z", 24, 24, 2.0f }
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    VECTOR ACCESSORS
//------------------------------------------------------------------------------------------------------------------------

const VectorGlyphRecord& VectorCodec::QueryNavigationIcon(NavigationIconCategory Icon) noexcept
{
    size_t Index = static_cast<size_t>(Icon);
    if (Index < NavigationGlyphTable.size())
    {
        return NavigationGlyphTable[Index];
    }
    return NavigationGlyphTable[0];
}

std::string_view VectorCodec::QueryNavigationSvgPath(NavigationIconCategory Icon) noexcept
{
    return QueryNavigationIcon(Icon).SvgPathString;
}

uint32_t VectorCodec::QueryNavigationIconCount() noexcept
{
    return static_cast<uint32_t>(NavigationGlyphTable.size());
}

const VectorGlyphRecord& VectorCodec::QueryControlCentreIcon(ControlCentreIconCategory Icon) noexcept
{
    size_t Index = static_cast<size_t>(Icon);
    if (Index < ControlCentreGlyphTable.size())
    {
        return ControlCentreGlyphTable[Index];
    }
    return ControlCentreGlyphTable[0];
}

std::string_view VectorCodec::QueryControlCentreSvgPath(ControlCentreIconCategory Icon) noexcept
{
    return QueryControlCentreIcon(Icon).SvgPathString;
}

uint32_t VectorCodec::QueryControlCentreIconCount() noexcept
{
    return static_cast<uint32_t>(ControlCentreGlyphTable.size());
}

//------------------------------------------------------------------------------------------------------------------------
//                                            OUTLINER GLYPH LOOKUP TABLE
//------------------------------------------------------------------------------------------------------------------------

const std::array<VectorGlyphRecord, static_cast<size_t>(OutlinerIconCategory::Count)> VectorCodec::OutlinerGlyphTable = {
    // 0: Globe (World / Terrain)
    VectorGlyphRecord{
        "Globe",
        "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18M3 12h18M12 3a14.5 14.5 0 0 1 0 18M12 3a14.5 14.5 0 0 0 0 18M4.6 7.5h14.8M4.6 16.5h14.8",
        24, 24, 1.8f
    },
    // 1: Sun
    VectorGlyphRecord{
        "Sun",
        "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4",
        24, 24, 1.8f
    },
    // 2: Atmosphere
    VectorGlyphRecord{
        "Atmosphere",
        "M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16",
        24, 24, 1.8f
    },
    // 3: Sky
    VectorGlyphRecord{
        "Sky",
        "M3 16a4 4 0 0 1 4-4 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 18 20H7a4 4 0 0 1-4-4z",
        24, 24, 1.8f
    },
    // 4: Stars
    VectorGlyphRecord{
        "Stars",
        "M12 3l1.8 4.6L18 9l-4.2 1.4L12 15l-1.8-4.6L6 9l4.2-1.4zM19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7zM5 16l.5 1.3 1.3.5-1.3.5L5 19.6l-.5-1.3-1.3-.5 1.3-.5z",
        24, 24, 1.6f
    },
    // 5: Wind
    VectorGlyphRecord{
        "Wind",
        "M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7a2 2 0 1 1-2 2",
        24, 24, 1.8f
    },
    // 6: HeightFog
    VectorGlyphRecord{
        "HeightFog",
        "M4 14h13M6 18h11M8 10h9M7 10a5 5 0 0 1 9.6-1.8A3.5 3.5 0 0 1 17 15",
        24, 24, 1.8f
    },
    // 7: AtmosphericFog
    VectorGlyphRecord{
        "AtmosphericFog",
        "M3 17h18M3 13c3-2 6-2 9 0s6 2 9 0M6 8c2-1.5 4-1.5 6 0s4 1.5 6 0M18 3a2 2 0 1 0 0 4a2 2 0 0 0 0-4",
        24, 24, 1.8f
    },
    // 8: VolumetricFog
    VectorGlyphRecord{
        "VolumetricFog",
        "M4 8l8-4l8 4l-8 4zM4 8v8l8 4l8-4V8M12 12v8M7.5 15.5c1.5-1 3-1 4.5 0s3 1 4.5 0",
        24, 24, 1.8f
    },
    // 9: Cloud
    VectorGlyphRecord{
        "Cloud",
        "M7 18.5h10.5a3.75 3.75 0 0 0 .6-7.45A5.5 5.5 0 0 0 7.6 9.3 4.6 4.6 0 0 0 7 18.5zM13.5 6.2a3.2 3.2 0 0 1 5.3 1.9",
        24, 24, 1.8f
    },
    // 10: VolumetricClouds
    VectorGlyphRecord{
        "VolumetricClouds",
        "M4.5 17.5h11a3.4 3.4 0 0 0 .5-6.77A5 5 0 0 0 6.3 9.6a4 4 0 0 0-1.8 7.9zM17.2 10.6a3 3 0 0 1 3.3 4.7M2.5 21h19M15 17.5h4.5a2.4 2.4 0 0 0 .4-4.76",
        24, 24, 1.8f
    },
    // 11: Precipitation
    VectorGlyphRecord{
        "Precipitation",
        "M7 13.5h9.5a3.3 3.3 0 0 0 .5-6.56A4.8 4.8 0 0 0 7.8 6.3 3.6 3.6 0 0 0 7 13.5zM8 17l-1 3M12 17l-1 3M16 17l-1 3",
        24, 24, 1.8f
    },
    // 12: LocalCloud
    VectorGlyphRecord{
        "LocalCloud",
        "M8 16.5h8.5a3.2 3.2 0 0 0 .5-6.37A4.6 4.6 0 0 0 8.2 8.9 3.9 3.9 0 0 0 8 16.5zM6 3h12a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z",
        24, 24, 1.8f
    },
    // 13: Moon
    VectorGlyphRecord{
        "Moon",
        "M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z",
        24, 24, 1.8f
    },
    // 14: GroundPlane
    VectorGlyphRecord{
        "GroundPlane",
        "M3 15l9-5 9 5-9 5zM7.5 12.5l4.5 2.5 4.5-2.5M12 10v10",
        24, 24, 1.8f
    },
    // 15: PointLight
    VectorGlyphRecord{
        "PointLight",
        "M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z",
        24, 24, 1.8f
    },
    // 16: SpotLight
    VectorGlyphRecord{
        "SpotLight",
        "M12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6M12 2v4M12 18v4M2 12h4M18 12h4M12 4a8 8 0 1 0 0 16a8 8 0 0 0 0-16",
        24, 24, 1.8f
    },
    // 17: Camera
    VectorGlyphRecord{
        "Camera",
        "M5.5 7h8A2.5 2.5 0 0 1 16 9.5v6a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 3 15.5v-6A2.5 2.5 0 0 1 5.5 7zM16 11l5-3v8l-5-3z",
        24, 24, 1.8f
    },
    // 18: CineCamera
    VectorGlyphRecord{
        "CineCamera",
        "M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0-18M14.3 15.5L8.5 5.4M9.7 8.5h11.6M12 12l-5.8 10M9.7 15.5h11.6M14.3 8.5l-5.8 10",
        24, 24, 1.8f
    },
    // 19: PostProcess
    VectorGlyphRecord{
        "PostProcess",
        "M4 20l11-11M14 4l1 2 2 1-2 1-1 2-1-2-2-1 2-1zM19 12l.6 1.4L21 14l-1.4.6L19 16l-.6-1.4L17 14l1.4-.6z",
        24, 24, 1.8f
    },
    // 20: EyeVisible
    VectorGlyphRecord{
        "EyeVisible",
        "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 0 0 0-6",
        24, 24, 1.8f
    },
    // 21: EyeHidden
    VectorGlyphRecord{
        "EyeHidden",
        "M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4M6.2 6.2A17 17 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4-.8",
        24, 24, 1.8f
    },
    // 22: StatusCheck
    VectorGlyphRecord{
        "StatusCheck",
        "M5 12.5l4.5 4.5L19 7.5",
        24, 24, 2.2f
    },
    // 23: StatusWarn
    VectorGlyphRecord{
        "StatusWarn",
        "M12 4l9 16H3zM12 10v4M12 17.5v.5",
        24, 24, 1.8f
    },
    // 24: StatusDot
    VectorGlyphRecord{
        "StatusDot",
        "M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8",
        24, 24, 2.0f
    },
    // 25: ChevronRight
    VectorGlyphRecord{
        "ChevronRight",
        "M9 6l6 6-6 6",
        24, 24, 2.0f
    },
    // 26: ChevronDown
    VectorGlyphRecord{
        "ChevronDown",
        "M6 9l6 6 6-6",
        24, 24, 2.0f
    },
    // 27: Search
    VectorGlyphRecord{
        "Search",
        "M11 4a7 7 0 1 0 0 14a7 7 0 0 0 0-14M20 20l-3.5-3.5",
        24, 24, 1.8f
    },
    // 28: CompactToggle
    VectorGlyphRecord{
        "CompactToggle",
        "M4 8h16M4 16h16",
        24, 24, 2.0f
    }
};

const VectorGlyphRecord& VectorCodec::QueryOutlinerIcon(OutlinerIconCategory Icon) noexcept
{
    const size_t Index = static_cast<size_t>(Icon);
    if (Index < OutlinerGlyphTable.size())
    {
        return OutlinerGlyphTable[Index];
    }
    return OutlinerGlyphTable[0];
}

std::string_view VectorCodec::QueryOutlinerSvgPath(OutlinerIconCategory Icon) noexcept
{
    return QueryOutlinerIcon(Icon).SvgPathString;
}

uint32_t VectorCodec::QueryOutlinerIconCount() noexcept
{
    return static_cast<uint32_t>(OutlinerGlyphTable.size());
}

} // namespace Frontier
