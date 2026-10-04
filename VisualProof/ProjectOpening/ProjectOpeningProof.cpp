//============================================================================================================================================
//                                                     PROJECTOPENINGPROOF.CPP
//============================================================================================================================================
// 📦 Executes the production ImGui card and rasterises its actual draw lists on the CPU; no mock browser layout.

#include "../../Frontier/Engine/Host/ProjectOpeningPanel.h"
#include "../../Frontier/Exhibits/Workbench/IconArt/CpuDraw.h"
#include "../../Frontier/Exhibits/Workbench/Editor/PngWriteCounterpart.h"
#include <cassert>
#include <cstdio>
#include <filesystem>
#include <vector>

int main(int ArgumentCount, char** Arguments)
{
    assert(ArgumentCount == 2);
    const std::filesystem::path Output(Arguments[1]);
    std::filesystem::create_directories(Output);
    ImGui::CreateContext();
    auto& Io = ImGui::GetIO();
    Io.DisplaySize = ImVec2(840, 640);
    Io.IniFilename = nullptr;
    Io.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;
    Io.Fonts->AddFontFromFileTTF("Frontier/EngineContent/Fonts/SunReference/DMSans-Regular.ttf", 16.0f);
    Frontier::ApplyProjectOpeningTheme();
    Frontier::ProjectOpeningSpecification State;
    std::snprintf(State.Directory, sizeof(State.Directory), "Projects");
    State.Projects = {"Projects/Project-Drive/ProjectDrive.frontier", "Projects/Project-Zero/ProjectZero.frontier"};
    const auto Frame = [&](float X = -1, float Y = -1, bool Pressed = false)
    {
        Io.DeltaTime = 1.0f / 60.0f;
        Io.AddMousePosEvent(X, Y); Io.AddMouseButtonEvent(0, Pressed);
        ImGui::NewFrame(); Frontier::RecordProjectOpeningPanel(State); ImGui::Render();
        FrontierProof::AcknowledgeTextures();
    };
    const auto Click = [&](float X, float Y) { Frame(X,Y); Frame(X,Y,true); Frame(X,Y,false); };
    const auto Capture = [&](const char* Name)
    {
        Frame();
        std::vector<unsigned char> Pixels(840u * 640u * 3u, 11u);
        const auto* Draw = ImGui::GetDrawData();
        assert(Draw && Draw->TotalVtxCount > 1000);
        for (int Index = 0; Index < Draw->CmdListsCount; ++Index)
            FrontierProof::Draw(Draw->CmdLists[Index], Pixels.data(), 840, 640, Draw->DisplayPos, Draw->FramebufferScale);
        assert(stbi_write_png((Output / Name).string().c_str(), 840, 640, 3, Pixels.data(), 840 * 3));
    };
    Frame(); Frame();
    Click(110, 590); assert(!State.Open);
    Click(110, 173); assert(State.SelectionChanged && !State.SelectedProject.empty());
    State.SelectedScene = "Content/Scenes/DriveCourse.r4.gltf";
    State.Scenes = {State.SelectedScene};
    Frame();
    assert(State.Rendering == 0 && State.Quality == 2);
    Capture("ProjectBrowser.png");
    Click(110, 590); assert(State.Open); State.Open = false;
    State.Loading = true; State.LoadingSeconds = 4.0;
    Click(110, 590); assert(!State.Open);
    Capture("ProjectOpening.png");
    State.Loading = false;
    State.Refusal = "The selected scene is missing. Choose an existing scene and try again.";
    Capture("ProjectRefusal.png");
    Click(800, 24); assert(State.Close);
    ImGui::DestroyContext();
    std::puts("PASS real ImGui: selection, software-BVH default, disabled empty/loading launch, open request, close and rendered error card");
}
