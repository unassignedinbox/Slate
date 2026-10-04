//============================================================================================================================================
//                                                      PROJECTOPENINGPANEL.H
//============================================================================================================================================
// 📦 Shared ImGui startup card; emits user requests without owning an operating-system window or project code.

#pragma once
#include <imgui.h>
#include <filesystem>
#include <string>
#include <vector>

namespace Frontier
{
struct ProjectOpeningSpecification
{
    char Directory[4096]{};
    std::vector<std::filesystem::path> Projects, Scenes;
    std::filesystem::path SelectedProject, SelectedScene;
    std::string Refusal;
    int Quality = 2, Rendering = 0, Scale = 2;
    bool Loading = false, Close = false, Scan = false, BrowseDirectory = false, BrowseScene = false;
    bool SelectionChanged = false, Open = false;
    double LoadingSeconds = 0.0;
};

inline std::string OpeningPathText(const std::filesystem::path& Path)
{
    const auto Text = Path.u8string();
    return {reinterpret_cast<const char*>(Text.data()), Text.size()};
}

inline void ApplyProjectOpeningTheme()
{
    ImGui::StyleColorsDark();
    auto& Style = ImGui::GetStyle();
    Style.WindowRounding = 12; Style.ChildRounding = 8; Style.FrameRounding = 5;
    Style.WindowPadding = ImVec2(18, 16);
    Style.FramePadding = ImVec2(10, 7); Style.ItemSpacing = ImVec2(10, 10);
    Style.Colors[ImGuiCol_WindowBg] = ImVec4(.047f, .047f, .047f, 1);
    Style.Colors[ImGuiCol_ChildBg] = ImVec4(.071f, .071f, .071f, 1);
    Style.Colors[ImGuiCol_FrameBg] = ImVec4(.102f, .102f, .102f, 1);
    Style.Colors[ImGuiCol_FrameBgHovered] = ImVec4(.20f, .17f, .13f, 1);
    Style.Colors[ImGuiCol_FrameBgActive] = ImVec4(.25f, .20f, .14f, 1);
    Style.Colors[ImGuiCol_HeaderActive] = ImVec4(.36f, .29f, .19f, 1);
    Style.Colors[ImGuiCol_NavCursor] = ImVec4(.898f, .702f, .412f, 1);
    Style.Colors[ImGuiCol_PopupBg] = ImVec4(.071f, .071f, .071f, 1);
    Style.Colors[ImGuiCol_Button] = ImVec4(.15f, .15f, .15f, 1);
    Style.Colors[ImGuiCol_ButtonHovered] = ImVec4(.28f, .23f, .17f, 1);
    Style.Colors[ImGuiCol_ButtonActive] = ImVec4(.36f, .29f, .19f, 1);
    Style.Colors[ImGuiCol_Header] = ImVec4(.25f, .20f, .14f, 1);
    Style.Colors[ImGuiCol_HeaderHovered] = ImVec4(.28f, .23f, .17f, 1);
    Style.Colors[ImGuiCol_CheckMark] = ImVec4(.898f, .702f, .412f, 1);
}

inline void RecordProjectOpeningPanel(ProjectOpeningSpecification& State)
{
    ImGui::SetNextWindowPos(ImVec2(0, 0)); ImGui::SetNextWindowSize(ImVec2(840, 640));
    ImGui::Begin("Project browser", nullptr, ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings);
    ImGui::TextColored(ImVec4(.90f,.70f,.41f,1), "FRONTIER  /  PROJECT BROWSER");
    ImGui::SameLine(786); if (ImGui::SmallButton("X")) State.Close = true;
    ImGui::Separator();
    ImGui::TextDisabled("Open a project, choose its scene and set the first rendering session.");
    ImGui::BeginDisabled(State.Loading);
    ImGui::SetNextItemWidth(570); ImGui::InputText("##directory", State.Directory, sizeof(State.Directory));
    ImGui::SameLine(); if (ImGui::Button("Browse folder")) State.BrowseDirectory = true;
    ImGui::SameLine(); if (ImGui::Button("Scan")) State.Scan = true;
    ImGui::BeginChild("Projects", ImVec2(296, 380), true);
    ImGui::TextDisabled("PROJECTS");
    for (const auto& Project : State.Projects)
    {
        ImGui::PushID(OpeningPathText(Project).c_str());
        if (ImGui::Selectable(OpeningPathText(Project.stem()).c_str(), Project == State.SelectedProject, 0, ImVec2(0, 32)))
        {
            State.SelectedProject = Project;
            State.SelectionChanged = true;
        }
        if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s", OpeningPathText(Project).c_str());
        ImGui::PopID();
    }
    if (State.Projects.empty()) ImGui::TextWrapped("No .frontier projects here. Browse another directory and scan it.");
    ImGui::EndChild(); ImGui::SameLine();
    ImGui::BeginChild("Opening", ImVec2(0, 380), true);
    ImGui::TextDisabled("SCENE & SESSION");
    ImGui::SetNextItemWidth(-1);
    if (ImGui::BeginCombo("##scene", State.SelectedScene.empty() ? "Select a project first" : OpeningPathText(State.SelectedScene.filename()).c_str()))
    {
        for (const auto& Scene : State.Scenes)
        {
            ImGui::PushID(OpeningPathText(Scene).c_str());
            if (ImGui::Selectable(OpeningPathText(Scene.filename()).c_str(), Scene == State.SelectedScene)) State.SelectedScene = Scene;
            if (ImGui::IsItemHovered()) ImGui::SetTooltip("%s", OpeningPathText(Scene).c_str());
            ImGui::PopID();
        }
        ImGui::EndCombo();
    }
    if (ImGui::Button("Browse scene...")) State.BrowseScene = true;
    ImGui::TextDisabled("Quality"); ImGui::SetNextItemWidth(-1);
    ImGui::Combo("##quality", &State.Quality, "Minimal\0Economy\0Standard\0Ultra\0Reference\0");
    ImGui::TextDisabled("Renderer"); ImGui::SetNextItemWidth(-1);
    ImGui::Combo("##renderer", &State.Rendering, "ReSTIR / Software BVH (testing)\0ReSTIR / Automatic hardware\0Distance Field GI\0Raster / No GI\0");
    ImGui::TextDisabled("Render scale"); ImGui::SetNextItemWidth(-1);
    ImGui::Combo("##scale", &State.Scale, "50%\0" "75%\0" "100%\0");
    ImGui::TextWrapped("Software BVH keeps ReSTIR enabled while disabling hardware ray traversal. These are session overrides.");
    ImGui::EndChild(); ImGui::EndDisabled();
    if (!State.Refusal.empty()) ImGui::TextWrapped("%s", State.Refusal.c_str());
    ImGui::SetCursorPosY(574);
    if (State.Loading)
    {
        ImGui::TextColored(ImVec4(.90f,.70f,.41f,1), "Opening project...  %.0f seconds", State.LoadingSeconds);
        ImGui::TextDisabled("Building renderer resources. Console stays open until the first frame.");
    }
    else
    {
        ImGui::BeginDisabled(State.SelectedProject.empty() || State.SelectedScene.empty());
        if (ImGui::Button("Open project", ImVec2(200, 38))) State.Open = true;
        ImGui::EndDisabled(); ImGui::SameLine();
        ImGui::TextDisabled("No batch file. Host + selected project DLL.");
    }
    ImGui::End();
}
}
