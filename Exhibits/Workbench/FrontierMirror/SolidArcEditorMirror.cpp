//=============================================================================================================================================
//                                                SOLIDARCEDITORMIRROR.CPP
//=============================================================================================================================================
// Headless visual proof for the SolidArc authoring editor, driven the way the game editor proof is. It seats the
// REAL SolidArcEditorHost — which reuses the engine's own OutlinerPanel, ViewportPanel and InspectorPanel — loads
// the SAME engine typeface archives and SAME EngineContent/Icons the windowed build loads, builds a multi-category
// CAD scene through the SolidArc console (bodies, surfaces, sketches, a profile, construction geometry, auto dims),
// renders the viewport with the SolidArc software raster at full panel resolution, and rasterises the resulting
// ImDrawData with the same dependency-free CPU path EditorProof.cpp uses. No SVG/mockup fallback is involved.
//
// This mirror lives in Slate; Slate authors no renderer. Every widget, font glyph, icon and viewport pixel is the
// engine's own, produced by the engine's own translation units built and run headless (no Vulkan, no GLFW).

#ifndef FRONTIER_DEVELOPMENT
#error "the SolidArc editor mirror must define FRONTIER_DEVELOPMENT"
#endif

#include <imgui.h>

#include "Editor/SolidArcEditorHost.h"
#include "PngWriteCounterpart.h"
#include "TypefaceRegistry.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <vector>

static_assert(sizeof(ImDrawIdx) == 2u, "the mirror rasteriser walks 16-bit ImGui indices");

namespace {

constexpr int kWidth  = 1280;
constexpr int kHeight = 720;
constexpr unsigned char kGround[3] = { 5u, 5u, 5u };

// The SolidArc software raster the viewport panel displays. Rendered above the on-screen panel size so the panel
//    down-samples rather than up-samples — the up-sample was the whole reason the first sheets read as blurred.
constexpr uint32_t kViewRasterW = 1152u;
constexpr uint32_t kViewRasterH = 760u;

struct Rgba
{
    float R, G, B, A;
};

Rgba UnpackColour(uint32_t Packed) noexcept
{
    return { static_cast<float>(Packed & 0xFFu) / 255.0f,
             static_cast<float>((Packed >> 8) & 0xFFu) / 255.0f,
             static_cast<float>((Packed >> 16) & 0xFFu) / 255.0f,
             static_cast<float>((Packed >> 24) & 0xFFu) / 255.0f };
}

void OverlayPixel(unsigned char* Pixel, Rgba Over) noexcept
{
    const float Keep = 1.0f - Over.A;
    Pixel[0] = static_cast<unsigned char>(Over.R * 255.0f * Over.A + static_cast<float>(Pixel[0]) * Keep + 0.5f);
    Pixel[1] = static_cast<unsigned char>(Over.G * 255.0f * Over.A + static_cast<float>(Pixel[1]) * Keep + 0.5f);
    Pixel[2] = static_cast<unsigned char>(Over.B * 255.0f * Over.A + static_cast<float>(Pixel[2]) * Keep + 0.5f);
}

Rgba SampleSheet(const unsigned char* Sheet, int SheetWidth, int SheetHeight, float U, float V, bool RgbaSheet) noexcept
{
    int X = static_cast<int>(U * static_cast<float>(SheetWidth));
    int Y = static_cast<int>(V * static_cast<float>(SheetHeight));
    if (X < 0) X = 0;
    if (X >= SheetWidth) X = SheetWidth - 1;
    if (Y < 0) Y = 0;
    if (Y >= SheetHeight) Y = SheetHeight - 1;
    const unsigned char* Texel = Sheet + (static_cast<size_t>(Y) * static_cast<size_t>(SheetWidth) + static_cast<size_t>(X)) * 4u;
    return { static_cast<float>(Texel[0]) / 255.0f,
             static_cast<float>(Texel[1]) / 255.0f,
             static_cast<float>(Texel[2]) / 255.0f,
             RgbaSheet ? (static_cast<float>(Texel[3]) / 255.0f) : 1.0f };
}

float EdgeWeight(float Ax, float Ay, float Bx, float By, float Px, float Py) noexcept
{
    return (Px - Ax) * (By - Ay) - (Py - Ay) * (Bx - Ax);
}

const unsigned char* gSolidArcRgba = nullptr;
uint32_t             gSolidArcW    = 0u;
uint32_t             gSolidArcH    = 0u;

void RasterizeList(const ImDrawList* List,
                   const unsigned char* GlyphSheet,
                   int GlyphSheetWidth,
                   int GlyphSheetHeight,
                   unsigned char* Pixels,
                   ImVec2 Origin,
                   ImVec2 PixelScale) noexcept
{
    const ImDrawVert* Corners = List->VtxBuffer.Data;
    const ImDrawIdx*  Order   = List->IdxBuffer.Data;
    for (int Command = 0; Command < List->CmdBuffer.Size; ++Command)
    {
        const ImDrawCmd* Cmd = &List->CmdBuffer[Command];
        const ImTextureID CmdTex = Cmd->TexRef._TexData != nullptr ? static_cast<ImTextureID>(0) : Cmd->TexRef._TexID;
        const bool SolidArcTexture = CmdTex != static_cast<ImTextureID>(0) && gSolidArcRgba != nullptr;
        const unsigned char* Sheet = SolidArcTexture ? gSolidArcRgba : GlyphSheet;
        const int SheetW = SolidArcTexture ? static_cast<int>(gSolidArcW) : GlyphSheetWidth;
        const int SheetH = SolidArcTexture ? static_cast<int>(gSolidArcH) : GlyphSheetHeight;
        const bool RgbaSheet = !SolidArcTexture;

        int ScissorLeft   = static_cast<int>((Cmd->ClipRect.x - Origin.x) * PixelScale.x);
        int ScissorTop    = static_cast<int>((Cmd->ClipRect.y - Origin.y) * PixelScale.y);
        int ScissorRight  = static_cast<int>((Cmd->ClipRect.z - Origin.x) * PixelScale.x);
        int ScissorBottom = static_cast<int>((Cmd->ClipRect.w - Origin.y) * PixelScale.y);
        if (ScissorLeft < 0) ScissorLeft = 0;
        if (ScissorRight > kWidth) ScissorRight = kWidth;
        if (ScissorTop < 0) ScissorTop = 0;
        if (ScissorBottom > kHeight) ScissorBottom = kHeight;

        for (unsigned int I = 0u; I < Cmd->ElemCount; I += 3u)
        {
            const ImDrawVert& A = Corners[Order[Cmd->IdxOffset + I] + Cmd->VtxOffset];
            const ImDrawVert& B = Corners[Order[Cmd->IdxOffset + I + 1u] + Cmd->VtxOffset];
            const ImDrawVert& C = Corners[Order[Cmd->IdxOffset + I + 2u] + Cmd->VtxOffset];
            const float SignedArea = EdgeWeight(A.pos.x, A.pos.y, B.pos.x, B.pos.y, C.pos.x, C.pos.y);
            if (SignedArea == 0.0f)
                continue;

            int LoX = static_cast<int>(std::floor(std::fmin(A.pos.x, std::fmin(B.pos.x, C.pos.x))));
            int HiX = static_cast<int>(std::ceil(std::fmax(A.pos.x, std::fmax(B.pos.x, C.pos.x))));
            int LoY = static_cast<int>(std::floor(std::fmin(A.pos.y, std::fmin(B.pos.y, C.pos.y))));
            int HiY = static_cast<int>(std::ceil(std::fmax(A.pos.y, std::fmax(B.pos.y, C.pos.y))));
            if (LoX < ScissorLeft) LoX = ScissorLeft;
            if (HiX > ScissorRight) HiX = ScissorRight;
            if (LoY < ScissorTop) LoY = ScissorTop;
            if (HiY > ScissorBottom) HiY = ScissorBottom;

            const Rgba TintedA = UnpackColour(A.col);
            const Rgba TintedB = UnpackColour(B.col);
            const Rgba TintedC = UnpackColour(C.col);
            const float InverseArea = 1.0f / SignedArea;
            for (int Y = LoY; Y < HiY; ++Y)
            {
                for (int X = LoX; X < HiX; ++X)
                {
                    const float Px = static_cast<float>(X) + 0.5f;
                    const float Py = static_cast<float>(Y) + 0.5f;
                    const float W0 = EdgeWeight(B.pos.x, B.pos.y, C.pos.x, C.pos.y, Px, Py) * InverseArea;
                    const float W1 = EdgeWeight(C.pos.x, C.pos.y, A.pos.x, A.pos.y, Px, Py) * InverseArea;
                    const float W2 = EdgeWeight(A.pos.x, A.pos.y, B.pos.x, B.pos.y, Px, Py) * InverseArea;
                    if (W0 < 0.0f || W1 < 0.0f || W2 < 0.0f)
                        continue;

                    const float U = W0 * A.uv.x + W1 * B.uv.x + W2 * C.uv.x;
                    const float V = W0 * A.uv.y + W1 * B.uv.y + W2 * C.uv.y;
                    const Rgba Glyph = SampleSheet(Sheet, SheetW, SheetH, U, V, RgbaSheet);
                    const Rgba Tinted = { (W0 * TintedA.R + W1 * TintedB.R + W2 * TintedC.R) * Glyph.R,
                                          (W0 * TintedA.G + W1 * TintedB.G + W2 * TintedC.G) * Glyph.G,
                                          (W0 * TintedA.B + W1 * TintedB.B + W2 * TintedC.B) * Glyph.B,
                                          (W0 * TintedA.A + W1 * TintedB.A + W2 * TintedC.A) * Glyph.A };
                    OverlayPixel(&Pixels[(static_cast<size_t>(Y) * kWidth + static_cast<size_t>(X)) * 3u], Tinted);
                }
            }
        }
    }
}

bool Run(Frontier::ConsoleHost& Host, const char* Command) noexcept
{
    if (!Host.Execute(Command))
    {
        std::fprintf(stderr, "[SolidArcEditorMirror] command failed: %s\n", Command);
        return false;
    }
    return true;
}

// The multi-category CAD scene: every SolidArc outliner folder (Sketches, Bodies, Surfaces, Construction,
//    Dimensions) ends up populated, so the outliner, its CAD filters and the inspector all have real rows to walk.
bool BuildScene(Frontier::ConsoleHost& Host) noexcept
{
    const char* const Script[] = {
        // — Bodies (solid) —
        "box (-3.0,-0.6,0.0) (-1.8,0.6,1.0) --name=Bracket",
        "cylinder (-0.6,0.0,0.0) 0.5 1.2 --name=Hub",
        "cone (0.9,0.0,0.0) 0.6 0.0 1.3 --name=NoseCone",
        "torus (2.6,0.0,0.35) 0.55 0.18 --name=Ring",
        "sphere (4.2,0.0,0.6) 0.55 --name=Ball",
        // — Surfaces (sheet) —
        "sphere (-0.6,2.0,1.0) 0.6 --sheet --name=CanopySheet",
        "cylinder (1.2,1.8,0.0) 0.5 1.1 --sheet --name=ShellSheet",
        // — Sketches / lines —
        "line (-3.2,-1.8,0.0) (4.6,-1.8,0.0) --name=Datum",
        "circle (-1.8,2.2,0.0) 0.5 --name=BoltCircle",
        "rect (2.6,1.6) (3.8,2.6) --name=Slot",
        // — Profile —
        "polygon (3.6,-1.8) 0.45 6 --name=HexProfile",
        // — Construction (a ground datum plane and a vertical front reference plane) —
        "plane (-4.0,-2.6,-0.05) 9 6 --construction --name=BasePlane",
        "plane (-3.6,-1.0,0.0) 1.6 2.2 --u=(1,0,0) --v=(0,0,1) --construction --name=FrontPlane",
        // — Explicit dimensions on two bodies (bodies also auto-emit their own) —
        "dim Hub --along=Z --name=HubHeight",
        "dim Ball --along=X --name=BallSpan",
        // — Per-body studio matcaps, exactly like the windowed editor's material picker —
        "matcap Bracket steel",
        "matcap Hub gold",
        "matcap NoseCone copper",
        "matcap Ring chrome",
        "matcap Ball pearl",
        // — Frame the whole assembly in an isometric view —
        "view iso",
        "view fit",
    };
    for (const char* Command : Script)
        if (!Run(Host, Command))
            return false;
    return true;
}

} // namespace

int main()
{
    ImGui::CreateContext();
    ImGuiIO& IO = ImGui::GetIO();
    IO.DisplaySize = ImVec2(static_cast<float>(kWidth), static_cast<float>(kHeight));
    IO.DisplayFramebufferScale = ImVec2(1.0f, 1.0f);
    IO.IniFilename = nullptr;
    IO.LogFilename = nullptr;
    IO.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
    IO.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;

    Frontier::SolidArcEditorHost Editor;
    Editor.ApplyTheme();   // seats the faces + attaches EngineContent/Icons before the glyph sheet is baked

    // Load the SAME engine typeface archives the windowed build loads. Without this the proof falls back to the
    //    raster default font, which is the whole reason the earlier sheets read as a different, worse UI.
    static Frontier::TypefaceRegistry Typefaces;
    const uint32_t FamilyCount = Typefaces.Load("EngineContent/FontArchives");
    Frontier::TypefaceRegistry::Install(&Typefaces);
    std::fprintf(stderr, "[SolidArcEditorMirror] typefaces: %u families\n", FamilyCount);
    if (IO.Fonts->Fonts.empty())
        IO.Fonts->AddFontDefault();

    unsigned char* GlyphSheet = nullptr;
    int GlyphSheetWidth = 0, GlyphSheetHeight = 0;
    IO.Fonts->GetTexDataAsRGBA32(&GlyphSheet, &GlyphSheetWidth, &GlyphSheetHeight);

    Frontier::ConsoleHost Host("/tmp/solidarc-editor-mirror", kViewRasterW, kViewRasterH);
    if (!BuildScene(Host))
        return 2;

    Host.Render();
    Frontier::RasterImage Preview = Host.Raster().Readback();
    gSolidArcRgba = Preview.Pixels.empty() ? nullptr : Preview.Pixels.data();
    gSolidArcW = Preview.Width;
    gSolidArcH = Preview.Height;
    std::fprintf(stderr, "[SolidArcEditorMirror] viewport raster: %ux%u\n", gSolidArcW, gSolidArcH);

    std::vector<unsigned char> Pixels(static_cast<size_t>(kWidth) * static_cast<size_t>(kHeight) * 3u);

    auto Tick = [&](float MouseX, float MouseY, bool Down)
    {
        IO.DeltaTime = 1.0f / 60.0f;
        IO.AddMousePosEvent(MouseX, MouseY);
        IO.AddMouseButtonEvent(0, Down);
        ImGui::NewFrame();
        Editor.Record(Host);
        ImGui::Render();
    };
    auto Rest = [&]() { Tick(-1.0f, -1.0f, false); };
    auto Click = [&](float X, float Y)
    {
        Tick(X, Y, false);
        Tick(X, Y, true);
        Tick(X, Y, false);
    };
    auto Rasterise = [&]()
    {
        for (size_t I = 0u; I < Pixels.size(); I += 3u)
        {
            Pixels[I] = kGround[0]; Pixels[I + 1u] = kGround[1]; Pixels[I + 2u] = kGround[2];
        }
        const ImDrawData* Drawings = ImGui::GetDrawData();
        for (int Index = 0; Index < Drawings->CmdListsCount; ++Index)
            RasterizeList(Drawings->CmdLists[Index], GlyphSheet, GlyphSheetWidth, GlyphSheetHeight, Pixels.data(),
                          Drawings->DisplayPos, Drawings->FramebufferScale);
    };
    auto Bright = [&]() -> int
    {
        int Count = 0;
        for (size_t I = 0; I < Pixels.size(); I += 3u)
            if (Pixels[I] > 45u || Pixels[I + 1u] > 45u || Pixels[I + 2u] > 45u)
                ++Count;
        return Count;
    };
    auto WriteSheet = [&](const char* Sheet, int Floor, int FailureCode) -> int
    {
        const int Lit = Bright();
        if (Lit < Floor)
        {
            std::fprintf(stderr, "[SolidArcEditorMirror] [FAIL] %s has only %d bright pixels (< %d)\n", Sheet, Lit, Floor);
            return FailureCode;
        }
        if (stbi_write_png(Sheet, kWidth, kHeight, 3, Pixels.data(), kWidth * 3) == 0)
        {
            std::fprintf(stderr, "[SolidArcEditorMirror] [FAIL] could not write %s\n", Sheet);
            return FailureCode + 1;
        }
        std::fprintf(stderr, "[SolidArcEditorMirror] wrote %s (%d bright pixels)\n", Sheet, Lit);
        return 0;
    };

    // Settle the docking layout, the outliner tree and the viewport raster.
    for (int I = 0; I < 14; ++I)
        Rest();

    // Sheet 1 — overview: the full CAD outliner tree, the framed viewport, and the empty inspector prompt.
    Rasterise();
    if (const int Code = WriteSheet("Exhibits/Gallery/Editor/EditorProof_SolidArc_Overview.png", 60000, 10); Code)
        return Code;

    // Sheet 2 — the CAD filter menu open over the outliner (Lines/Profiles/Bodies/Surfaces/Construction/Dimensions).
    Click(178.0f, 175.0f);
    for (int I = 0; I < 3; ++I)
        Rest();
    Rasterise();
    if (const int Code = WriteSheet("Exhibits/Gallery/Editor/EditorProof_SolidArc_Menu.png", 60000, 12); Code)
        return Code;

    // Narrow to Bodies, then pick the first body row — the CAD inspector seats identity, geometry, bounds.
    Click(160.0f, 281.0f);
    for (int I = 0; I < 4; ++I)
        Rest();
    Click(78.0f, 294.0f);
    for (int I = 0; I < 8; ++I)
        Rest();
    Rasterise();
    if (const int Code = WriteSheet("Exhibits/Gallery/Editor/EditorProof_SolidArc.png", 60000, 14); Code)
        return Code;

    std::fprintf(stderr, "[SolidArcEditorMirror] all sheets written\n");
    ImGui::DestroyContext();
    return 0;
}
