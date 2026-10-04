//============================================================================================================================================
//                                                          PROJECTOPENINGPROOF.CPP
//============================================================================================================================================
// 📦 Executes the production ImGui card and rasterises its actual draw lists on the CPU; no mock browser layout.

#include "../../Frontier/Engine/Host/ProjectOpeningPanel.h"
#include "../../Frontier/Exhibits/Workbench/IconArt/CpuDraw.h"
#include "../../Frontier/Exhibits/Workbench/Editor/PngWriteCounterpart.h"
#include <cassert>
#include <cstdio>
#include <filesystem>
#include <vector>
#include <fstream>
#include <imgui_internal.h>
#include "../../Frontier/Engine/Host/ProjectPreviewCodec.h"
#define STB_IMAGE_IMPLEMENTATION
#include "../../Frontier/ExternalPackages/stb/stb_image.h"

int main(int ArgumentCount, char **Arguments)
{
    assert(ArgumentCount == 2);
    const std::filesystem::path Output(Arguments[1]);
    std::filesystem::create_directories(Output);
    ImGui::CreateContext();
    auto &Io       = ImGui::GetIO();
    Io.DisplaySize = ImVec2(840, 640);
    Io.IniFilename = nullptr;
    Io.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;
    Io.Fonts->AddFontFromFileTTF("Frontier/EngineContent/Fonts/SunReference/DMSans-Regular.ttf", 16.0f);
    Frontier::ApplyProjectOpeningTheme();
    Frontier::ProjectOpeningSpecification State;
    std::snprintf(State.Directory, sizeof(State.Directory), "Projects");
    State.Projects = {"Projects/Project-Drive/ProjectDrive.frontier", "Projects/Project-Zero/ProjectZero.frontier"};
    std::array<ImTextureData, 2> PreviewPixels;
    for (size_t Index = 0; Index < State.Projects.size(); ++Index)
    {
        std::filesystem::path Source;
        std::string           Refusal;
        assert(Frontier::FindProjectPreview(std::filesystem::path("Frontier") / State.Projects[Index], Source, Refusal));
        int   Width = 0, Height = 0, Channels = 0;
        auto *Pixels = stbi_load(Source.string().c_str(), &Width, &Height, &Channels, 4);
        assert(Pixels && Width > 0 && Height > 0);
        PreviewPixels[Index].Create(ImTextureFormat_RGBA32, Width, Height);
        std::memcpy(PreviewPixels[Index].Pixels, Pixels, static_cast<size_t>(Width) * Height * 4);
        stbi_image_free(Pixels);
        PreviewPixels[Index].SetTexID(static_cast<ImTextureID>(100 + Index));
        PreviewPixels[Index].SetStatus(ImTextureStatus_OK);
        auto &Preview   = State.Previews[State.Projects[Index]];
        Preview.Texture = PreviewPixels[Index].GetTexRef();
        Preview.Width   = Width;
        Preview.Height  = Height;
        Preview.Source  = Source;
    }
    const auto MissingProject = Output / "Image discovery/Project.frontier";
    const auto PreviewFolder  = MissingProject.parent_path() / "Preview";
    std::filesystem::remove_all(MissingProject.parent_path());
    std::filesystem::path Found;
    std::string           Refusal;
    assert(!Frontier::FindProjectPreview(MissingProject, Found, Refusal) && !Refusal.empty());
    std::filesystem::create_directories(PreviewFolder);
    std::filesystem::create_directories(PreviewFolder / "Default");
    std::ofstream(PreviewFolder / "Default/Project.png") << "bundled fallback";
    assert(Frontier::FindProjectPreview(MissingProject, Found, Refusal) && Found == PreviewFolder / "Default/Project.png");
    std::ofstream(PreviewFolder / "ignore.txt") << "not an image";
    std::ofstream(PreviewFolder / "zebra.PNG") << "discovery does not decode";
    std::ofstream(PreviewFolder / "alpha.jpg") << "alphabetically first supported file";
    assert(Frontier::FindProjectPreview(MissingProject, Found, Refusal) && Found.filename() == "alpha.jpg");
    std::filesystem::remove(Found);
    assert(Frontier::FindProjectPreview(MissingProject, Found, Refusal) && Found.filename() == "zebra.PNG");
    std::filesystem::remove_all(PreviewFolder);
    assert(!Frontier::FindProjectPreview(MissingProject, Found, Refusal) && Found.empty());
    assert(ImGui::GetStyle().Colors[ImGuiCol_WindowBg].x == 0);
    const auto Frame = [&](float X = -1, float Y = -1, bool Pressed = false)
    {
        Io.DeltaTime = 1.0f / 60.0f;
        Io.AddMousePosEvent(X, Y);
        Io.AddMouseButtonEvent(0, Pressed);
        ImGui::NewFrame();
        Frontier::RecordProjectOpeningPanel(State);
        ImGui::Render();
        FrontierProof::AcknowledgeTextures();
    };
    const auto Click = [&](float X, float Y)
    {
        Frame(X, Y);
        Frame(X, Y, true);
        Frame(X, Y, false);
    };
    const auto Capture = [&](const char *Name)
    {
        Frame();
        std::vector<unsigned char> Pixels(840u * 640u * 3u, 11u);
        const auto                *Draw = ImGui::GetDrawData();
        assert(Draw && Draw->TotalVtxCount > 1000);
        for (int Index = 0; Index < Draw->CmdListsCount; ++Index)
            FrontierProof::Draw(Draw->CmdLists[Index], Pixels.data(), 840, 640, Draw->DisplayPos, Draw->FramebufferScale);
        assert(stbi_write_png((Output / Name).string().c_str(), 840, 640, 3, Pixels.data(), 840 * 3));
    };
    Frame();
    Frame();
    Click(110, 590);
    assert(!State.Open);
    Click(110, 329);
    assert(State.SelectionChanged && !State.SelectedProject.empty());
    State.SelectedScene = "Content/Scenes/DriveCourse.r4.gltf";
    State.Scenes        = {State.SelectedScene};
    Frame();
    assert(State.Rendering == 0 && State.Quality == 2);
    Capture("ProjectBrowser.png");
    assert(State.PreviewRequests.size() == 2);
    const auto Choose = [&](float Position, int Choice)
    {
        Click(500, Position);
        Frame();
        const auto* Popup = ImGui::FindWindowByName("##Combo_00");
        assert(Popup && Popup->Active);
        const ImVec2 Origin = Popup->DC.CursorStartPos;
        Click(Origin.x + 60, Origin.y + Choice * (ImGui::GetFontSize() + ImGui::GetStyle().ItemSpacing.y) + 8);
    };
    Click(500, 295);
    Capture("ProjectDropdown.png");
    Click(600, 540);
    Choose(295, 3);
    assert(State.Quality == 3);
    Choose(363, 2);
    assert(State.Rendering == 2);
    Choose(431, 0);
    assert(State.Scale == 0);
    State.Quality = 2;
    State.Rendering = 0;
    State.Scale = 2;
    State.Scenes.push_back("Content/Scenes/Other scene.glb");
    Choose(187, 1);
    assert(State.SelectedScene == State.Scenes.back());
    State.SelectedScene = State.Scenes.front();
    const auto Preview = State.Previews.at(State.SelectedProject);
    State.Previews.erase(State.SelectedProject);
    Capture("ProjectPreviewAbsent.png");
    State.Previews.emplace(State.SelectedProject, Preview);
    for (int Index = 0; Index < 1000; ++Index)
        State.Projects.emplace_back("Projects/Extra" + std::to_string(Index) + ".frontier");
    Frame();
    assert(State.PreviewRequests.size() <= 8);
    State.Projects.resize(2);
    Frame();
    Click(778, 98);
    assert(State.Scan);
    State.Scan = false;
    Click(110, 590);
    assert(State.Open);
    State.Open           = false;
    State.Loading        = true;
    State.LoadingSeconds = 4.0;
    Click(110, 590);
    assert(!State.Open);
    Capture("ProjectOpening.png");
    State.Loading = false;
    State.Refusal = "The selected scene is missing. Choose an existing scene and try again.";
    Capture("ProjectRefusal.png");
    Click(800, 24);
    assert(State.Close);
    ImGui::DestroyContext();
    std::puts("PASS real ImGui: OLED theme, two actual image textures, deterministic folder discovery/refresh, clipped image requests, all dropdown selections, Scan, selection, "
              "software-BVH default, disabled empty/loading launch, open request, close and rendered error card");
}
