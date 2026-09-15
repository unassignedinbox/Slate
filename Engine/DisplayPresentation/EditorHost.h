//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/EditorHost.h — Integrated Development Editor Coordinator, Viewport Docking and Outliner Management
//============================================================================================================================================

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)                              // Disable structure padding alignment warning under /WX
#endif

#include "OutlinerPanel.h"
#include "ViewportPanel.h"
#include <cstdint>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                     EDITOR HOST
//------------------------------------------------------------------------------------------------------------------------

#if defined(FRONTIER_DEVELOPMENT) || defined(EDITOR) || defined(FRONTIER_EDITOR) || defined(DEVELOPMENT)

class EditorHost
{
public:
    EditorHost() noexcept;
    ~EditorHost() noexcept = default;

    EditorHost(const EditorHost&)            = delete;
    EditorHost& operator=(const EditorHost&) = delete;

    [[nodiscard]] bool      Initialize() noexcept;

    void                    Present(uint32_t DisplayWidth, uint32_t DisplayHeight, void* ViewportTexture = nullptr) noexcept;

    [[nodiscard]] OutlinerPanel&       QueryOutliner() noexcept { return Outliner; }
    [[nodiscard]] const OutlinerPanel& QueryOutliner() const noexcept { return Outliner; }

    [[nodiscard]] ViewportPanel&       QueryViewport() noexcept { return Viewport; }
    [[nodiscard]] const ViewportPanel& QueryViewport() const noexcept { return Viewport; }

    [[nodiscard]] bool      IsActive() const noexcept { return ActiveCondition; }
    void                    AssignActive(bool Active) noexcept { ActiveCondition = Active; }

    // Single unified conversion operator
    template<typename TargetType>
    [[nodiscard]] TargetType Convert() const noexcept;

private:
    OutlinerPanel           Outliner;
    ViewportPanel           Viewport;
    bool                    DockLayoutInitialized;
    bool                    ShowOutlinerCondition;
    bool                    ShowViewportCondition;
    bool                    ActiveCondition;
};

template<>
inline bool EditorHost::Convert<bool>() const noexcept
{
    return ActiveCondition;
}

#endif // FRONTIER_DEVELOPMENT || EDITOR || FRONTIER_EDITOR || DEVELOPMENT

} // namespace Frontier
