//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/EditorHost.cpp — Integrated Development Editor Coordinator, Viewport Docking and Outliner Management
//============================================================================================================================================

#include "EditorHost.h"

#if defined(FRONTIER_DEVELOPMENT) || defined(EDITOR) || defined(FRONTIER_EDITOR) || defined(DEVELOPMENT)

#include <imgui.h>
#include <imgui_internal.h>
#include <algorithm>

namespace Frontier {

EditorHost::EditorHost() noexcept
    : Outliner{}
    , Viewport{}
    , DockLayoutInitialized(false)
    , ShowOutlinerCondition(true)
    , ShowViewportCondition(true)
    , ActiveCondition(true)
{
}

bool EditorHost::Initialize() noexcept
{
    Outliner.ResetDefaultWorld();
    DockLayoutInitialized = false;
    ActiveCondition = true;
    return true;
}

void EditorHost::Present(uint32_t DisplayWidth, uint32_t DisplayHeight, void* ViewportTexture) noexcept
{
    if (!ActiveCondition) return;

    ImGuiIO& IO = ImGui::GetIO();
    IO.ConfigFlags |= ImGuiConfigFlags_DockingEnable;

    const ImGuiViewport* MainViewport = ImGui::GetMainViewport();

    // ── Full-viewport Dockspace Host Window ──────────────────────────────────────────────────────────────────────────
    ImGui::SetNextWindowPos(MainViewport->WorkPos);
    ImGui::SetNextWindowSize(MainViewport->WorkSize);
    ImGui::SetNextWindowViewport(MainViewport->ID);

    constexpr ImGuiWindowFlags DockspaceWindowFlags =
        ImGuiWindowFlags_NoDocking             |
        ImGuiWindowFlags_NoTitleBar            |
        ImGuiWindowFlags_NoCollapse            |
        ImGuiWindowFlags_NoResize              |
        ImGuiWindowFlags_NoMove                |
        ImGuiWindowFlags_NoBringToFrontOnFocus |
        ImGuiWindowFlags_NoNavFocus            |
        ImGuiWindowFlags_NoBackground;

    ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0.0f);
    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));

    ImGui::Begin("FrontierEditorDockSpaceHost", nullptr, DockspaceWindowFlags);
    ImGui::PopStyleVar(3);

    const ImGuiID DockSpaceID = ImGui::GetID("FrontierEditorDockSpace");
    ImGui::DockSpace(DockSpaceID, ImVec2(0.0f, 0.0f), ImGuiDockNodeFlags_PassthruCentralNode);

    // Initial dock layout builder (splits into Left 316px Outliner, Center Viewport)
    if (!DockLayoutInitialized)
    {
        DockLayoutInitialized = true;
        ImGui::DockBuilderRemoveNode(DockSpaceID);
        ImGui::DockBuilderAddNode(DockSpaceID, ImGuiDockNodeFlags_DockSpace);
        ImGui::DockBuilderSetNodeSize(DockSpaceID, MainViewport->WorkSize);

        ImGuiID DockLeft = 0;
        ImGuiID DockRight = 0;
        const float TargetWidth = Outliner.IsCompact() ? 236.0f : 316.0f;
        const float Ratio = TargetWidth / (MainViewport->WorkSize.x > 0.0f ? MainViewport->WorkSize.x : 1280.0f);
        ImGui::DockBuilderSplitNode(DockSpaceID, ImGuiDir_Left, Ratio, &DockLeft, &DockRight);

        ImGui::DockBuilderDockWindow("Outliner", DockLeft);
        ImGui::DockBuilderDockWindow("Viewport", DockRight);
        ImGui::DockBuilderFinish(DockSpaceID);
    }

    ImGui::End();

    // ── Render the 2 Dockable Panels ─────────────────────────────────────────────────────────────────────────────────
    // ① Outliner Panel
    Outliner.Present(&ShowOutlinerCondition);

    // ② Viewport Panel
    Viewport.Present(DisplayWidth, DisplayHeight, ViewportTexture, &ShowViewportCondition);
}

} // namespace Frontier

#endif // FRONTIER_DEVELOPMENT || EDITOR || FRONTIER_EDITOR || DEVELOPMENT
