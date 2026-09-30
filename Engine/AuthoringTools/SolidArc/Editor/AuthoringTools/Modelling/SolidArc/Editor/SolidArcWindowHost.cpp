//============================================================================================================================================
//                                                    SOLIDARCWINDOWHOST.CPP
//============================================================================================================================================

// 📦 The windowed SolidArc editor entry point — one GLFW window, the patched vendor ImGui on the OpenGL
//    backend, and the SolidArc editor host recording the docked outliner / viewport / inspector over the
//    live document. Usage:
//
//        SolidArcEditor                          # empty document
//        SolidArcEditor model.arc                # a document seated from a script
//        SolidArcEditor -c "box (0,0,0) (1,1,1)" # inline commands, then the window
//
//    The console host the panels speak through is the same host the command-line tool runs, so every
//    command the console knows seats the same document the editor shows.

#include "Editor/SolidArcEditorHost.h"
#include "Console/ConsoleHost.h"

#include <imgui.h>
#include <backends/imgui_impl_glfw.h>
#include <backends/imgui_impl_opengl3.h>

#ifndef GLFW_INCLUDE_NONE
#define GLFW_INCLUDE_NONE
#endif
#include <GLFW/glfw3.h>

#include <cstdio>
#include <string>
#include <vector>

// The four GL 1.0 entry points the clear uses. The vendor's own loader header is private to
//    imgui_impl_opengl3.cpp by its own header comment, and the host draws nothing else, so the classic
//    library symbols are declared here and resolve from opengl32 / libGL / the macOS framework at link.
extern "C"
{
void glViewport(int X, int Y, int Width, int Height);
void glClearColor(float Red, float Green, float Blue, float Alpha);
void glClear(unsigned int Mask);
}
constexpr unsigned int kGlColourBand = 0x00004000u;   // GL_COLOR_BUFFER_BIT — the clear mask the band carries

int main(int ArgumentCount, char** Arguments)
{
    using namespace Frontier;

    // ① Arguments: scripts seat the document before the window opens; --sample seats a small model so the
    //    outliner and the inspector have live rows to describe from the first tick.
    std::string ProofFolder = SOLIDARC_PROOF_FOLDER;
    std::vector<std::string> Scripts;
    std::vector<std::string> Inline;
    bool Sample = false;
    for (int I = 1; I < ArgumentCount; ++I)
    {
        const std::string Argument = Arguments[I];
        if (Argument == "--proofs" && I + 1 < ArgumentCount)
            ProofFolder = Arguments[++I];
        else if (Argument == "--sample")
            Sample = true;
        else if (Argument == "-c" && I + 1 < ArgumentCount)
            Inline.push_back(Arguments[++I]);
        else if (Argument == "--help")
        {
            std::printf("SolidArcEditor [--proofs DIR] [--sample] [-c \"commands\"] [model.arc ...]\n");
            return 0;
        }
        else
            Scripts.push_back(Argument);
    }

    // ② The window: GLFW carries the OpenGL context the ImGui backend draws through.
    if (glfwInit() == GLFW_FALSE)
    {
        std::fprintf(stderr, "[SolidArcEditor] GLFW refused to initialise\n");
        return 1;
    }
    glfwWindowHint(GLFW_CONTEXT_VERSION_MAJOR, 3);
    glfwWindowHint(GLFW_CONTEXT_VERSION_MINOR, 2);
    glfwWindowHint(GLFW_OPENGL_PROFILE, GLFW_OPENGL_CORE_PROFILE);
    glfwWindowHint(GLFW_OPENGL_FORWARD_COMPAT, GLFW_TRUE);
    GLFWwindow* Window = glfwCreateWindow(1600, 900, "SolidArc", nullptr, nullptr);
    if (Window == nullptr)
    {
        std::fprintf(stderr, "[SolidArcEditor] the window refused to open (an OpenGL 3.2 context is required)\n");
        glfwTerminate();
        return 1;
    }
    glfwMakeContextCurrent(Window);
    glfwSwapInterval(1);

    // ③ The vendor: docking enabled, the editor's theme and faces seated once, the GLFW and OpenGL
    //    backends attached in the vendor's own required order.
    IMGUI_CHECKVERSION();
    ImGui::CreateContext();
    ImGuiIO& IO = ImGui::GetIO();
    IO.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
    IO.IniFilename = "solidarc-editor.ini";
    IO.ConfigDockingWithShift = false;

    float ContentScaleX = 1.0f, ContentScaleY = 1.0f;
    glfwGetWindowContentScale(Window, &ContentScaleX, &ContentScaleY);
    if (ContentScaleX > 1.0f)
        IO.FontGlobalScale = ContentScaleX;

    SolidArcEditorHost Editor;
    Editor.ApplyTheme();

    ImGui_ImplGlfw_InitForOpenGL(Window, true);
    ImGui_ImplOpenGL3_Init("#version 150");

    // ④ The document: the same console host the command-line tool runs.
    ConsoleHost Host(ProofFolder, 1280, 800);
    for (const std::string& Script : Scripts)
        static_cast<void>(Host.RunScript(Script, false));
    for (const std::string& Command : Inline)
        static_cast<void>(Host.Execute(Command));
    if (Sample && Scripts.empty() && Inline.empty())
    {
        static_cast<void>(Host.Execute("box (-1.2,-0.5,0) (1.2,0.5,0.8) --name=Body01"));
        static_cast<void>(Host.Execute("sphere (0.0,0.0,1.15) 0.35 --sheet --name=CanopySheet"));
        static_cast<void>(Host.Execute("line (-1.4,-0.7,0) (1.4,-0.7,0) --name=SketchAxis"));
        static_cast<void>(Host.Execute("line (0.0,-1.0,0) (0.0,1.0,0) --name=AxisRef --construction"));
        static_cast<void>(Host.Execute("select Body01"));
    }

    // ⑤ The loop: the vendor's three-step frame, the editor's one recording pass, the GL clear + draw.
    while (glfwWindowShouldClose(Window) == GLFW_FALSE)
    {
        glfwPollEvents();
        if (glfwGetWindowAttrib(Window, GLFW_ICONIFIED) != 0)
        {
            glfwWaitEvents();
            continue;
        }

        ImGui_ImplOpenGL3_NewFrame();
        ImGui_ImplGlfw_NewFrame();
        ImGui::NewFrame();

        Editor.Record(Host);

        ImGui::Render();
        int DrawWidth = 0, DrawHeight = 0;
        glfwGetFramebufferSize(Window, &DrawWidth, &DrawHeight);
        glViewport(0, 0, DrawWidth, DrawHeight);
        glClearColor(0.020f, 0.020f, 0.020f, 1.0f);
        glClear(kGlColourBand);
        ImGui_ImplOpenGL3_RenderDrawData(ImGui::GetDrawData());
        glfwSwapBuffers(Window);
    }

    // ⑥ The vendor's own required teardown order: backends shut before the context dies.
    ImGui_ImplOpenGL3_Shutdown();
    ImGui_ImplGlfw_Shutdown();
    ImGui::DestroyContext();
    glfwDestroyWindow(Window);
    glfwTerminate();
    return 0;
}
