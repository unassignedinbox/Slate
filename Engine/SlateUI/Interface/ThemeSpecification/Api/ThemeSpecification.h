//============================================================================================================================================
//                                                        THEMESPECIFICATION.H
//============================================================================================================================================
// 🧩 Six Control Centre appearances and eight semantic accents transcribed
// from the notch reference.

#pragma once

#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"

#include <cstdint>

namespace Slate
{

enum class ThemeSubject : std::uint32_t
{
    Oled = 0u,
    Dark = 1u,
    CleanWhite = 2u,
    DesertSand = 3u,
    Purplish = 4u,
    Bluish = 5u,
    SubjectCount = 6u
};

enum class AccentSubject : std::uint32_t
{
    Blue = 0u,
    Cyan = 1u,
    Teal = 2u,
    Emerald = 3u,
    Amber = 4u,
    Orange = 5u,
    Rose = 6u,
    Violet = 7u,
    SubjectCount = 8u
};

struct ThemeDeclaration
{
    const char *Caption = ""; // [-]
    InkOrdinate Ground = {};
    InkOrdinate Panel = {};
    InkOrdinate Primary = {};
    InkOrdinate Secondary = {};
    InkOrdinate Edge = {};
    InkOrdinate Card = {};
    InkOrdinate PreviewGround = {};
    InkOrdinate PreviewWindow = {};
    InkOrdinate PreviewSidebar = {};
    InkOrdinate PreviewSidebarQuiet = {};
    InkOrdinate PreviewSidebarStrong = {};
    InkOrdinate PreviewQuiet = {};
    InkOrdinate PreviewStrong = {};
};

struct AccentDeclaration
{
    const char *Caption = ""; // [-]
    InkOrdinate Ink = {};
};

class ThemeSpecification
{
public:
    static const ThemeDeclaration &Theme(ThemeSubject Subject);
    static const AccentDeclaration &Accent(AccentSubject Subject);
};

} // namespace Slate
