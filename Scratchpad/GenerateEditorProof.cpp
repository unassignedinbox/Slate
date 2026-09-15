//============================================================================================================================================
// 📦 Frontier/Scratchpad/GenerateEditorProof.cpp — Headless Proof Generator for Editor UI, Dockable Outliner and Viewport Panel
//============================================================================================================================================

#include "../Engine/DisplayPresentation/EditorHost.h"
#include "../Engine/DisplayPresentation/OutlinerPanel.h"
#include "../Engine/DisplayPresentation/ViewportPanel.h"
#include "../Engine/DisplayPresentation/VectorCodec.h"
#include "../Engine/DisplayPresentation/GlyphSpace.h"

#include <imgui.h>
#include <imgui_internal.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#include <stb_image_write.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <vector>
#include <string>

namespace {

constexpr int CanvasWidth  = 1280;
constexpr int CanvasHeight = 720;

//------------------------------------------------------------------------------------------------------------------------
//                                                    SOFTWARE CANVAS
//------------------------------------------------------------------------------------------------------------------------

struct Canvas
{
    std::vector<float> Rgb;
    Canvas() : Rgb(static_cast<size_t>(CanvasWidth) * CanvasHeight * 3u, 0.04f) {}

    void Blend(int X, int Y, float R, float G, float B, float A)
    {
        if (X < 0 || Y < 0 || X >= CanvasWidth || Y >= CanvasHeight || A <= 0.0f) return;
        float* P = &Rgb[(static_cast<size_t>(Y) * CanvasWidth + X) * 3u];
        P[0] = P[0] * (1.0f - A) + R * A;
        P[1] = P[1] * (1.0f - A) + G * A;
        P[2] = P[2] * (1.0f - A) + B * A;
    }
};

void UnpackColor(ImU32 Col, float Out[4])
{
    Out[0] = ((Col >> IM_COL32_R_SHIFT) & 0xFF) / 255.0f;
    Out[1] = ((Col >> IM_COL32_G_SHIFT) & 0xFF) / 255.0f;
    Out[2] = ((Col >> IM_COL32_B_SHIFT) & 0xFF) / 255.0f;
    Out[3] = ((Col >> IM_COL32_A_SHIFT) & 0xFF) / 255.0f;
}

void RasterTriangle(Canvas& C, const ImDrawVert& A, const ImDrawVert& B, const ImDrawVert& D,
                    const unsigned char* Tex, int TexW, int TexH, const ImVec4& Clip)
{
    float MinX = std::max(Clip.x, std::min({ A.pos.x, B.pos.x, D.pos.x }));
    float MaxX = std::min(Clip.z, std::max({ A.pos.x, B.pos.x, D.pos.x }));
    float MinY = std::max(Clip.y, std::min({ A.pos.y, B.pos.y, D.pos.y }));
    float MaxY = std::min(Clip.w, std::max({ A.pos.y, B.pos.y, D.pos.y }));
    if (MinX >= MaxX || MinY >= MaxY) return;

    const float Area = (B.pos.x - A.pos.x) * (D.pos.y - A.pos.y) - (B.pos.y - A.pos.y) * (D.pos.x - A.pos.x);
    if (std::abs(Area) < 1e-5f) return;
    const float InvArea = 1.0f / Area;

    float CA[4], CB[4], CD[4];
    UnpackColor(A.col, CA);
    UnpackColor(B.col, CB);
    UnpackColor(D.col, CD);

    constexpr int SS = 2; // 2x2 subpixel supersampling for crisp anti-aliased font glyphs
    for (int Y = static_cast<int>(MinY); Y < static_cast<int>(MaxY); ++Y)
    {
        for (int X = static_cast<int>(MinX); X < static_cast<int>(MaxX); ++X)
        {
            float AccR = 0.0f, AccG = 0.0f, AccB = 0.0f, AccA = 0.0f;
            int Hits = 0;

            for (int SY = 0; SY < SS; ++SY)
            {
                for (int SX = 0; SX < SS; ++SX)
                {
                    const float PX = static_cast<float>(X) + (static_cast<float>(SX) + 0.5f) / static_cast<float>(SS);
                    const float PY = static_cast<float>(Y) + (static_cast<float>(SY) + 0.5f) / static_cast<float>(SS);

                    float W0 = ((B.pos.x - PX) * (D.pos.y - PY) - (B.pos.y - PY) * (D.pos.x - PX)) * InvArea;
                    float W1 = ((D.pos.x - PX) * (A.pos.y - PY) - (D.pos.y - PY) * (A.pos.x - PX)) * InvArea;
                    float W2 = 1.0f - W0 - W1;
                    if (W0 < 0.0f || W1 < 0.0f || W2 < 0.0f) continue;

                    float R  = W0 * CA[0] + W1 * CB[0] + W2 * CD[0];
                    float G  = W0 * CA[1] + W1 * CB[1] + W2 * CD[1];
                    float Bl = W0 * CA[2] + W1 * CB[2] + W2 * CD[2];
                    float Al = W0 * CA[3] + W1 * CB[3] + W2 * CD[3];

                    if (Tex && TexW > 0 && TexH > 0)
                    {
                        const float U = W0 * A.uv.x + W1 * B.uv.x + W2 * D.uv.x;
                        const float V = W0 * A.uv.y + W1 * B.uv.y + W2 * D.uv.y;
                        const int TX = std::clamp(static_cast<int>(U * TexW), 0, TexW - 1);
                        const int TY = std::clamp(static_cast<int>(V * TexH), 0, TexH - 1);
                        const unsigned char* T = &Tex[(static_cast<size_t>(TY) * TexW + TX) * 4u];
                        Al *= T[3] / 255.0f;
                    }

                    if (Al > 0.001f)
                    {
                        AccR += R * Al;
                        AccG += G * Al;
                        AccB += Bl * Al;
                        AccA += Al;
                        Hits++;
                    }
                }
            }

            if (Hits > 0 && AccA > 0.0f)
            {
                const float Cov = AccA / static_cast<float>(SS * SS);
                C.Blend(X, Y, AccR / AccA, AccG / AccA, AccB / AccA, Cov);
            }
        }
    }
}

void RasterDrawData(Canvas& C, ImDrawData* Data, const unsigned char* Tex, int TexW, int TexH)
{
    for (int L = 0; L < Data->CmdListsCount; ++L)
    {
        const ImDrawList* List = Data->CmdLists[L];
        const ImDrawVert* Vtx  = List->VtxBuffer.Data;
        const ImDrawIdx*  Idx  = List->IdxBuffer.Data;

        for (const ImDrawCmd& Cmd : List->CmdBuffer)
        {
            if (Cmd.UserCallback) continue;
            for (unsigned I = 0; I + 2 < Cmd.ElemCount; I += 3)
            {
                const ImDrawVert& A = Vtx[Cmd.VtxOffset + Idx[Cmd.IdxOffset + I + 0]];
                const ImDrawVert& B = Vtx[Cmd.VtxOffset + Idx[Cmd.IdxOffset + I + 1]];
                const ImDrawVert& D = Vtx[Cmd.VtxOffset + Idx[Cmd.IdxOffset + I + 2]];
                RasterTriangle(C, A, B, D, Tex, TexW, TexH, Cmd.ClipRect);
            }
        }
    }
}

void SavePng(const Canvas& C, const std::string& Path)
{
    std::vector<unsigned char> Bytes(static_cast<size_t>(CanvasWidth) * CanvasHeight * 3u);
    for (size_t I = 0; I < Bytes.size(); ++I)
    {
        Bytes[I] = static_cast<unsigned char>(std::clamp(C.Rgb[I], 0.0f, 1.0f) * 255.0f + 0.5f);
    }
    stbi_write_png(Path.c_str(), CanvasWidth, CanvasHeight, 3, Bytes.data(), CanvasWidth * 3);
    std::printf("[Proof] Wrote %s (%dx%d)\n", Path.c_str(), CanvasWidth, CanvasHeight);
}

} // namespace

int main()
{
    IMGUI_CHECKVERSION();
    ImGuiContext* Ctx = ImGui::CreateContext();
    ImGui::SetCurrentContext(Ctx);

    ImGuiIO& IO = ImGui::GetIO();
    IO.DisplaySize = ImVec2(static_cast<float>(CanvasWidth), static_cast<float>(CanvasHeight));
    IO.DeltaTime   = 1.0f / 60.0f;
    IO.ConfigFlags |= ImGuiConfigFlags_DockingEnable;

    // Load typography: Inter font
    ImFont* PrimaryFont = IO.Fonts->AddFontFromFileTTF("EngineContent/FontArchives/Inter/Inter-Regular.otf", 14.5f);
    if (!PrimaryFont)
    {
        IO.Fonts->AddFontDefault();
    }

    unsigned char* TexData = nullptr;
    int TexWidth = 0, TexHeight = 0;
    IO.Fonts->GetTexDataAsRGBA32(&TexData, &TexWidth, &TexHeight);

    // Apply dark theme styling
    ImGui::StyleColorsDark();
    ImGuiStyle& Style = ImGui::GetStyle();
    Style.WindowRounding    = 16.0f;
    Style.ChildRounding     = 10.0f;
    Style.FrameRounding     = 8.0f;
    Style.PopupRounding     = 10.0f;
    Style.ScrollbarRounding = 9.0f;
    Style.GrabRounding      = 6.0f;
    Style.TabRounding       = 8.0f;
    Style.WindowBorderSize  = 1.0f;
    Style.FrameBorderSize   = 0.0f;
    Style.ItemSpacing       = ImVec2(8.0f, 6.0f);
    Style.WindowPadding     = ImVec2(0.0f, 0.0f);

    Frontier::EditorHost Editor;
    (void)Editor.Initialize();

    // ── PROOF 1: Standard Editor UI (Docked Outliner + Viewport with Render and HUD) ─────────────────────────────────
    // Run several frames to let ImGui docking layout resolve cleanly
    for (int Frame = 0; Frame < 4; ++Frame)
    {
        ImGui::NewFrame();
        Editor.Present(CanvasWidth, CanvasHeight, nullptr);
        ImGui::Render();
    }

    Canvas C1;
    RasterDrawData(C1, ImGui::GetDrawData(), TexData, TexWidth, TexHeight);
    SavePng(C1, "Diagnostics/Editor_Outliner_Proof.png");

    // ── PROOF 2: Compact Outliner Mode ──────────────────────────────────────────────────────────────────────────────
    Editor.QueryOutliner().AssignCompact(true);
    for (int Frame = 0; Frame < 3; ++Frame)
    {
        ImGui::NewFrame();
        Editor.Present(CanvasWidth, CanvasHeight, nullptr);
        ImGui::Render();
    }

    Canvas C2;
    RasterDrawData(C2, ImGui::GetDrawData(), TexData, TexWidth, TexHeight);
    SavePng(C2, "Diagnostics/Editor_Outliner_Compact_Proof.png");

    // ── PROOF 3: Filtered / Search State ────────────────────────────────────────────────────────────────────────────
    Editor.QueryOutliner().AssignCompact(false);
    // Hide Moon and Wind to showcase status tone and hidden counts
    Editor.QueryOutliner().AssignVisibility("wind", false);
    Editor.QueryOutliner().AssignVisibility("moon#0", false);
    for (int Frame = 0; Frame < 3; ++Frame)
    {
        ImGui::NewFrame();
        Editor.Present(CanvasWidth, CanvasHeight, nullptr);
        ImGui::Render();
    }

    Canvas C3;
    RasterDrawData(C3, ImGui::GetDrawData(), TexData, TexWidth, TexHeight);
    SavePng(C3, "Diagnostics/Editor_Outliner_Filtered_Proof.png");

    ImGui::DestroyContext(Ctx);
    return 0;
}
