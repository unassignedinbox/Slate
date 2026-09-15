//============================================================================================================================================
//                                                       RENDERERPANEL.H
//============================================================================================================================================
// 🧩 Immediate-mode ImGui control centre overlay — presents ReSTIR parameters, camera telemetry and scene diagnostics.

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)
#endif

#include "ReSTIRIntegrator.h"
#include "../../Projects/Project-Zero/Source/FlyThroughSolver.h"
#include "../../Projects/Project-Zero/Source/RayTracingSolver.h"
#include "../../Projects/Project-Zero/Source/RockTerrainSpace.h"
#include <cstdint>
#include <functional>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                    RENDERER PANEL
//------------------------------------------------------------------------------------------------------------------------

class RenderScheduler
{
public:
    RenderScheduler() noexcept = default;
    ~RenderScheduler() noexcept = default;

    RenderScheduler(const RenderScheduler&)            = delete;
    RenderScheduler& operator=(const RenderScheduler&) = delete;

    // Call once after ImGui context exists — applies colour scheme and style
    void ApplyTheme() noexcept;

    // Call every frame between ImGui::NewFrame() and ImGui::Render()
    // Mutates integrator parameters directly via its public setters
    // OverlayHook runs between ImGui::NewFrame and ImGui::Render so engine overlays (Control Centre) can
    //    record onto the foreground draw list of the same frame. Pass nullptr / empty for none.
    using OverlayHook = std::function<void()>;

    void Present(ReSTIRIntegrator&                       Integrator,
                 const ProjectZero::FlyThroughSolver&    Camera,
                 const ProjectZero::RayTracingSolver&    Scene,
                 ProjectZero::RockTerrainSpace&           Terrain,
                 uint32_t                                ViewportWidth,
                 uint32_t                                ViewportHeight,
                 const OverlayHook&                      Overlay = {}) noexcept;

    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    bool QuitRequested = false;     // [-]  quit button pressed
    ProjectZero::RockTerrainVector3 SculptCenter{ 0.0f, 0.0f, 2.0f }; // [m]
    float SculptRadius   = 0.8f;    // [m]
    float SculptStrength = 0.35f;   // [m]
    int   SculptCategory = 1;       // [-]  RockBrushCategory

    void SectionCamera  (const ProjectZero::FlyThroughSolver& Camera) noexcept;
    void SectionReSTIR  (ReSTIRIntegrator& Integrator, uint32_t ViewportWidth, uint32_t ViewportHeight) noexcept;
    void SectionScene   (const ProjectZero::RayTracingSolver& Scene) noexcept;
    void SectionRockTerrain(ReSTIRIntegrator& Integrator, ProjectZero::RockTerrainSpace& Terrain) noexcept;
};

template<>
inline bool RenderScheduler::Convert<bool>() const noexcept
{
    return QuitRequested;
}

} // namespace Frontier
