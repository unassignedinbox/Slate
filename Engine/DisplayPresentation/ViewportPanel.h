//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/ViewportPanel.h — Dockable Scene Viewport Panel, Render Presentation and Locomotion HUD
//============================================================================================================================================

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)                              // Disable structure padding alignment warning under /WX
#endif

#include "ThemeStructure.h"
#include <cstdint>
#include <string_view>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEWPORT PANEL
//------------------------------------------------------------------------------------------------------------------------

class ViewportPanel
{
public:
    ViewportPanel() noexcept;
    ~ViewportPanel() noexcept = default;

    ViewportPanel(const ViewportPanel&)            = delete;
    ViewportPanel& operator=(const ViewportPanel&) = delete;

    void                    Present(uint32_t DisplayWidth, uint32_t DisplayHeight, void* ViewportTexture = nullptr, bool* OpenCondition = nullptr) noexcept;

    [[nodiscard]] float     QueryFlySpeed() const noexcept { return FlySpeed; }
    void                    AssignFlySpeed(float Speed) noexcept { FlySpeed = Speed; }

    [[nodiscard]] bool      IsFocused() const noexcept { return FocusedCondition; }
    [[nodiscard]] bool      IsHovered() const noexcept { return HoveredCondition; }

    // Single unified conversion operator
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    void                    RenderSimulatedCelestialScene(void* DrawListOpaque, float MinX, float MinY, float Width, float Height) const noexcept;
    void                    RenderLocomotionHud(void* DrawListOpaque, float ViewportMinX, float ViewportMinY, float Width, float Height) const noexcept;

    float                   FlySpeed;                           // [m/s] fly locomotion speed
    bool                    FocusedCondition;                   // [bool] viewport window focused
    bool                    HoveredCondition;                   // [bool] cursor over viewport
};

template<>
inline float ViewportPanel::Convert<float>() const noexcept
{
    return FlySpeed;
}

template<>
inline bool ViewportPanel::Convert<bool>() const noexcept
{
    return FocusedCondition;
}

} // namespace Frontier
