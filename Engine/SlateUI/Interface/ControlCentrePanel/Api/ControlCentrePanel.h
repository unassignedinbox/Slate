//============================================================================================================================================
//                                                       CONTROLCENTREPANEL.H
//============================================================================================================================================
// 🧩 The complete north-drawer dashboard, settings, display, theme,
// notification and input presentation.

#pragma once

#include "Contract/DeliveryContract.h"
#include "SlateUI/Interface/AppearanceSpecification/Api/AppearanceSpecification.h"
#include "SlateUI/Interface/ComponentSpecification/Api/ComponentSpecification.h"
#include "SlateUI/Interface/DrawerSpace/Api/DrawerSpace.h"
#include "SlateUI/Interface/InteractionIndex/Api/InteractionIndex.h"
#include "SlateUI/Interface/InterfaceExchange/Api/RecordingSurface.h"
#include "SlateUI/Interface/MotionIntegrator/Api/MotionIntegrator.h"
#include "SlateUI/Interface/ShortcutSpecification/Api/ShortcutSpecification.h"
#include "SlateUI/Interface/ThemeSpecification/Api/ThemeSpecification.h"

#include <cstdint>

namespace Slate
{

enum class ControlCentrePage : std::uint32_t
{
    Dashboard = 0u,
    Settings = 1u,
    Notifications = 2u,
    Display = 3u,
    Input = 4u,
    PageCount = 5u
};

enum class DisplayPreferencePage : std::uint32_t
{
    Display = 0u,
    Fonts = 1u,
    Theme = 2u,
    PageCount = 3u
};

enum class IconAppearance : std::uint32_t
{
    Monotone = 0u,
    Duotone = 1u,
    Coloured = 2u,
    AppearanceCount = 3u
};

struct ControlCentreOrdinates
{
    ControlCentrePage Page = ControlCentrePage::Dashboard;
    DisplayPreferencePage DisplayPage = DisplayPreferencePage::Fonts;
    ThemeSubject Theme = ThemeSubject::Oled;
    ShortcutPreset InputPreset = ShortcutPreset::Blender;
    IconAppearance Icons = IconAppearance::Monotone;
    AccentSubject Primary = AccentSubject::Blue;
    AccentSubject Secondary = AccentSubject::Violet;
    AccentSubject Information = AccentSubject::Cyan;
    AccentSubject Warning = AccentSubject::Amber;
    AccentSubject Alert = AccentSubject::Rose;
    AccentSubject SemanticColours[5] = {AccentSubject::Blue, AccentSubject::Violet, AccentSubject::Cyan,
                                        AccentSubject::Amber, AccentSubject::Rose};
    std::uint32_t Quality = 2u;
    std::uint32_t Antialiasing = 1u;
    std::uint32_t Resolution = 0u;
    std::uint32_t Scaling = 100u;
    std::uint32_t RefreshRate = 0u;
    std::uint32_t MultipleDisplays = 1u;
    std::uint32_t Font = 0u;
    std::uint32_t IconWeight = 1u;
    std::uint32_t IconSize = 24u;
    std::uint32_t Radius = 24u;
    std::uint32_t TypographySize[8] = {24u, 20u, 16u, 14u, 12u, 10u, 14u, 14u};
    std::uint32_t TypographyWeight[8] = {3u, 3u, 2u, 1u, 2u, 1u, 2u, 3u};
    std::uint32_t PointerSpeed = 5u;
    std::uint32_t TouchAction = 0u;
    bool TransparentSidebar = false;
    bool VsyncEnabled = true;
    bool IlluminationEnabled = false;
    bool NotificationsEnabled = true;
    bool DisturbanceWithheld = false;
    bool SoundEnabled = true;
    bool AppNotifications[4] = {true, true, true, false};
    bool NotificationsPresent = true;
    bool InvertScroll = false;
    bool TouchGestures = true;
    bool PressureEnabled = true;
    std::uint32_t ListeningShortcut = 0xFFFFFFFFu;
};

class ControlCentrePanel
{
public:
    static constexpr std::uint32_t ControlCapacity = 192u;

    Deliver<bool> Construct(MotionIntegrator &Motion, RecordingSurface &Surface,
                            const AppearanceSpecification &Appearance);
    void Advance(const PointerCondition &Arrived, double Elapsed);
    Deliver<bool> Record(const PlaneExtent &Interior, ControlCentreOrdinates &Ordinates);
    void Exclude(DrawerSpace &Drawers) const;
    void Reset();

private:
    void RetainExclusion(const PlaneExtent &Extent);
    bool Pressed(std::uint32_t Ordinal, const PlaneExtent &Extent);
    bool Slider(std::uint32_t Ordinal, const PlaneExtent &Extent, std::uint32_t Least, std::uint32_t Most,
                std::uint32_t &Reading, const char *UnitGlyph, InkOrdinate Rail, InkOrdinate Accent);
    void Toggle(std::uint32_t Ordinal, const PlaneExtent &Extent, bool &Enabled, InkOrdinate Quiet, InkOrdinate Accent);
    void Symbol(const PlaneExtent &Extent, InkOrdinate Ink);
    void DashboardPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates, const ThemeDeclaration &Theme,
                       InkOrdinate Accent);
    void SettingsPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates, const ThemeDeclaration &Theme,
                      InkOrdinate Accent);
    void NotificationsPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates, const ThemeDeclaration &Theme,
                           InkOrdinate Accent);
    void DisplayPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates, const ThemeDeclaration &Theme,
                     InkOrdinate Accent);
    void InputPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates, const ThemeDeclaration &Theme,
                   InkOrdinate Accent);
    void ThemePage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates, const ThemeDeclaration &Theme,
                   InkOrdinate Accent);
    void FontsPage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates, const ThemeDeclaration &Theme,
                   InkOrdinate Accent);
    void DisplayHardwarePage(const PlaneExtent &Extent, ControlCentreOrdinates &Ordinates,
                             const ThemeDeclaration &Theme, InkOrdinate Accent);
    void Navigate(ControlCentrePage Arriving);

    MotionIntegrator *Motion = nullptr;
    RecordingSurface *Surface = nullptr;
    const AppearanceSpecification *Appearance = nullptr;
    InteractionIndex Interaction = {};
    ComponentSpecification SharedControls = {};
    ControlIdentity Controls[ControlCapacity] = {};
    PlaneExtent Exclusions[ControlCapacity] = {};
    std::uint32_t ExclusionCount = 0u;
    PointerCondition Pointer = {};
    ControlCentrePage PresentedPage = ControlCentrePage::Dashboard;
    ControlCentrePage DepartedPage = ControlCentrePage::Dashboard;
    std::uint32_t PageMotion = 0u;
    std::uint32_t TabMotion = 0u;
    std::uint32_t ThemeMotion = 0u;
    std::uint32_t FontMotion = 0u;
    ThemeSubject PresentedTheme = ThemeSubject::Oled;
    ThemeSubject DepartedTheme = ThemeSubject::Oled;
    bool PageForward = true;
    DisplayPreferencePage PresentedTab = DisplayPreferencePage::Fonts;
    DisplayPreferencePage DepartedTab = DisplayPreferencePage::Fonts;
    bool TabForward = true;
    std::uint32_t ScrollMotion[static_cast<std::uint32_t>(ControlCentrePage::PageCount)] = {};
    float Scroll[static_cast<std::uint32_t>(ControlCentrePage::PageCount)] = {};
    float ScrollDeparted[static_cast<std::uint32_t>(ControlCentrePage::PageCount)] = {};
    float ScrollTarget[static_cast<std::uint32_t>(ControlCentrePage::PageCount)] = {};
    float FontScroll = 0.0f;
    float FontDeparted = 0.0f;
    float FontTarget = 0.0f;
    std::uint32_t OpenPalette = 5u;
    bool InputPresetOpen = false;
};

} // namespace Slate
