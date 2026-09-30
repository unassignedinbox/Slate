//============================================================================================================================================
//                                              EDITORSHELLVERIFICATION.CPP
//============================================================================================================================================

// 📦 Headless visual proof for the SolidArc editor host — the same proof discipline the engine's own editor
//    proofs use: drive the REAL SolidArcEditorHost through ImGui docking with no window, no Vulkan and no
//    GLFW, rasterise the resulting draw lists on the CPU, write the sheets with the tool's own PNG writer,
//    and gate every claim so a regression fails loudly. Nothing about the editor is drawn by this proof.

#include "Console/ConsoleHost.h"
#include "Editor/SolidArcEditorHost.h"
#include "Presentation/RasterExchange.h"
#include "VerificationPanel.h"

#include <imgui.h>
#include <imgui_internal.h>   // ImGuiWindow: the docked window rect and DockId queries

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>

using namespace Frontier;

static_assert(sizeof(ImDrawIdx) == 2u, "the proof rasteriser walks 16-bit ImGui indices");

namespace {

constexpr int kWidth  = 1600;
constexpr int kHeight = 900;

//------------------------------------------------------------------------------------------------------------------------
//                                                  CPU RASTERISER
//------------------------------------------------------------------------------------------------------------------------

// One RGBA sample over one RGBA8 sheet pixel. The font atlas arrives as RGBA32 with the glyph coverage in
//    its alpha; every other fill the panels draw is solid geometry that never reaches the sampler.
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
    Pixel[3] = 255u;
}

Rgba SampleSheet(const unsigned char* Sheet, int SheetWidth, int SheetHeight, float U, float V) noexcept
{
    int X = static_cast<int>(U * static_cast<float>(SheetWidth));
    int Y = static_cast<int>(V * static_cast<float>(SheetHeight));
    X = std::clamp(X, 0, SheetWidth - 1);
    Y = std::clamp(Y, 0, SheetHeight - 1);
    const unsigned char* Texel = Sheet + (static_cast<size_t>(Y) * static_cast<size_t>(SheetWidth) + static_cast<size_t>(X)) * 4u;
    return { static_cast<float>(Texel[0]) / 255.0f,
             static_cast<float>(Texel[1]) / 255.0f,
             static_cast<float>(Texel[2]) / 255.0f,
             static_cast<float>(Texel[3]) / 255.0f };
}

float EdgeWeight(float Ax, float Ay, float Bx, float By, float Px, float Py) noexcept
{
    return (Px - Ax) * (By - Ay) - (Py - Ay) * (Bx - Ax);
}

// Rasterises one draw list onto the RGBA8 sheet. Every command must reference the font atlas: the viewport
//    is blank by design in this milestone, so a command carrying its own texture identity is a foreign
//    texture and the caller's gate refuses it.
void RasterizeList(const ImDrawList* List,
                   const unsigned char* TexPixels,
                   int TexWidth,
                   int TexHeight,
                   unsigned char* Pixels,
                   ImVec2 Origin,
                   ImVec2 PixelScale,
                   uint32_t* ForeignTextures) noexcept
{
    const ImDrawVert* Corners = List->VtxBuffer.Data;
    const ImDrawIdx*  Order   = List->IdxBuffer.Data;
    for (int Command = 0; Command < List->CmdBuffer.Size; ++Command)
    {
        const ImDrawCmd* Cmd = &List->CmdBuffer[Command];
        if (Cmd->TexRef._TexData == nullptr)
        {
            ++(*ForeignTextures);
            continue;
        }

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
            LoX = std::clamp(LoX, ScissorLeft, ScissorRight);
            HiX = std::clamp(HiX, ScissorLeft, ScissorRight);
            LoY = std::clamp(LoY, ScissorTop, ScissorBottom);
            HiY = std::clamp(HiY, ScissorTop, ScissorBottom);

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
                    const Rgba Glyph = SampleSheet(TexPixels, TexWidth, TexHeight, U, V);
                    const Rgba Tinted = { (W0 * TintedA.R + W1 * TintedB.R + W2 * TintedC.R) * Glyph.R,
                                          (W0 * TintedA.G + W1 * TintedB.G + W2 * TintedC.G) * Glyph.G,
                                          (W0 * TintedA.B + W1 * TintedB.B + W2 * TintedC.B) * Glyph.B,
                                          (W0 * TintedA.A + W1 * TintedB.A + W2 * TintedC.A) * Glyph.A };
                    OverlayPixel(&Pixels[(static_cast<size_t>(Y) * kWidth + static_cast<size_t>(X)) * 4u], Tinted);
                }
            }
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 SHEET MEASURES
//------------------------------------------------------------------------------------------------------------------------

uint32_t CountBright(const std::vector<unsigned char>& Pixels, uint32_t Threshold, int X0, int Y0, int X1, int Y1) noexcept
{
    uint32_t Bright = 0u;
    for (int Y = Y0; Y < Y1; ++Y)
        for (int X = X0; X < X1; ++X)
        {
            const size_t At = (static_cast<size_t>(Y) * kWidth + static_cast<size_t>(X)) * 4u;
            if (Pixels[At] > Threshold || Pixels[At + 1u] > Threshold || Pixels[At + 2u] > Threshold)
                ++Bright;
        }
    return Bright;
}

// The widest channel spread inside a region: 0 is a perfectly uniform patch.
unsigned char RegionSpread(const std::vector<unsigned char>& Pixels, int X0, int Y0, int X1, int Y1) noexcept
{
    unsigned char Low[3]  = { 255u, 255u, 255u };
    unsigned char High[3] = { 0u, 0u, 0u };
    for (int Y = Y0; Y < Y1; ++Y)
        for (int X = X0; X < X1; ++X)
        {
            const size_t At = (static_cast<size_t>(Y) * kWidth + static_cast<size_t>(X)) * 4u;
            for (int C = 0; C < 3; ++C)
            {
                if (Pixels[At + C] < Low[C])  Low[C]  = Pixels[At + C];
                if (Pixels[At + C] > High[C]) High[C] = Pixels[At + C];
            }
        }
    unsigned char Spread = 0u;
    for (int C = 0; C < 3; ++C)
        Spread = static_cast<unsigned char>(std::max<int>(Spread, High[C] - Low[C]));
    return Spread;
}

// The first column at a scanline whose ink rises above the threshold — the tab strip's ink onset, used to
//    measure the trapezoid's slanted edge against the rectangular one.
int InkOnset(const std::vector<unsigned char>& Pixels, int Y, int X0, int X1, uint32_t Threshold) noexcept
{
    for (int X = X0; X < X1; ++X)
    {
        const size_t At = (static_cast<size_t>(Y) * kWidth + static_cast<size_t>(X)) * 4u;
        if (Pixels[At] > Threshold || Pixels[At + 1u] > Threshold || Pixels[At + 2u] > Threshold)
            return X;
    }
    return X1;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                        ENTRY
//------------------------------------------------------------------------------------------------------------------------

int main(int ArgumentCount, char** Arguments)
{
    const std::string OutputRoot = (ArgumentCount > 1) ? Arguments[1] : SOLIDARC_PROOF_FOLDER;

    VerificationPanel Panel("SolidArc · Editor Shell Verification — outliner / blank viewport / inspector, trapezoidal patched tabs, headless CPU mirror");

    ImGui::CreateContext();
    ImGuiIO& IO = ImGui::GetIO();
    IO.DisplaySize = ImVec2(static_cast<float>(kWidth), static_cast<float>(kHeight));
    IO.DisplayFramebufferScale = ImVec2(1.0f, 1.0f);
    IO.IniFilename = nullptr;
    IO.LogFilename = nullptr;
    IO.ConfigFlags |= ImGuiConfigFlags_DockingEnable;
    // The vendor's lazy texture route — the same pair of backend flags the engine's own headless editor
    //    proofs declare — so glyphs bake into the atlas on demand at every drawn size, exactly as the
    //    windowed backends bake them.
    IO.BackendFlags |= ImGuiBackendFlags_RendererHasTextures | ImGuiBackendFlags_RendererHasVtxOffset;

    SolidArcEditorHost Editor;
    Editor.ApplyTheme();

    //----------------------------------------------------------------------------------------------------------------
    //                                          THE FIVE IMGUI PATCHES
    //----------------------------------------------------------------------------------------------------------------
    // These members exist only on the patched vendor — the proof does not compile against stock ImGui —
    //    and they carry exactly the figures the editor's theme seats.
    Panel.Section("The patched vendor ImGui");
    const ImGuiStyle& Style = ImGui::GetStyle();
    Panel.Expect("Patch A · TabSlant is the seated 14 px trapezoid slant", Style.TabSlant == 14.0f);
    Panel.Expect("Patch B · TabOverlap interlocks the slanted edges at 24 px", Style.TabOverlap == 24.0f);
    Panel.Expect("Patch B · TabHeight and TabStripPadTop carry the strip figures", Style.TabHeight == 24.0f && Style.TabStripPadTop == 4.0f);
    Panel.Expect("Patch C · TabButtonRounding carries the seated radius", Style.TabButtonRounding == 1.0f);

    //----------------------------------------------------------------------------------------------------------------
    //                                          THE SAMPLE DOCUMENT
    //----------------------------------------------------------------------------------------------------------------
    ConsoleHost Host(SOLIDARC_PROOF_FOLDER, 1280, 800);
    const char* const Sample[] =
    {
        "box (-1.2,-0.5,0) (1.2,0.5,0.8) --name=Body01",
        "sphere (0.0,0.0,1.15) 0.35 --sheet --name=CanopySheet",
        "line (-1.4,-0.7,0) (1.4,-0.7,0) --name=SketchAxis",
        "line (0.0,-1.0,0) (0.0,1.0,0) --name=AxisRef --construction",
        "select Body01",
    };
    bool SampleSeated = true;
    for (const char* Command : Sample)
        SampleSeated = Host.Execute(Command) && SampleSeated;
    Panel.Expect("the sample document seats (body, sheet, sketch, construction, pick)", SampleSeated);

    const SceneFigure* BodyFigure = nullptr;
    for (const SceneFigure& Figure : Host.AllFigures())
        if (Figure.Name == "Body01")
            BodyFigure = &Figure;
    Panel.Expect("Body01 stands in the document", BodyFigure != nullptr);
    const uint32_t BodyIdentity = BodyFigure != nullptr ? BodyFigure->Identity : 0u;

    //----------------------------------------------------------------------------------------------------------------
    //                                              THE FRAME HELPERS
    //----------------------------------------------------------------------------------------------------------------
    std::vector<unsigned char> Pixels(static_cast<size_t>(kWidth) * static_cast<size_t>(kHeight) * 4u, 5u);
    uint32_t ForeignTextures = 0u;

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
    // The atlas bakes glyphs on demand at every drawn size, so its pixels are read back after Render, when
    //    the frame's last glyph request has landed, and never cached across ticks.
    auto Rasterise = [&]()
    {
        unsigned char* TexPixels = nullptr;
        int TexWidth = 0, TexHeight = 0;
        IO.Fonts->GetTexDataAsRGBA32(&TexPixels, &TexWidth, &TexHeight);
        for (size_t I = 0u; I < Pixels.size(); I += 4u)
        {
            Pixels[I] = 5u; Pixels[I + 1u] = 5u; Pixels[I + 2u] = 5u; Pixels[I + 3u] = 255u;
        }
        const ImDrawData* Drawings = ImGui::GetDrawData();
        for (int Index = 0; Index < Drawings->CmdListsCount; ++Index)
            RasterizeList(Drawings->CmdLists[Index], TexPixels, TexWidth, TexHeight, Pixels.data(),
                          Drawings->DisplayPos, Drawings->FramebufferScale, &ForeignTextures);
    };
    auto WriteSheet = [&](const char* Name) -> bool
    {
        RasterImage Image;
        Image.Width  = static_cast<uint32_t>(kWidth);
        Image.Height = static_cast<uint32_t>(kHeight);
        Image.Pixels = Pixels;
        const std::string Path = OutputRoot + "/" + Name;
        return WritePng(Path, Image);
    };

    //----------------------------------------------------------------------------------------------------------------
    //                                            THE DOCKED COLUMNS
    //----------------------------------------------------------------------------------------------------------------
    for (int I = 0; I < 12; ++I)
        Rest();

    Panel.Section("The docked editor columns");
    const ImGuiWindow* OutlinerWindow = ImGui::FindWindowByName("SolidArc Outliner");
    const ImGuiWindow* ViewportWindow = ImGui::FindWindowByName("SolidArc Viewport");
    const ImGuiWindow* InspectorWindow = ImGui::FindWindowByName("SolidArc Inspector");
    Panel.Expect("the three editor windows exist", OutlinerWindow != nullptr && ViewportWindow != nullptr && InspectorWindow != nullptr);
    const bool AllDocked = OutlinerWindow != nullptr && ViewportWindow != nullptr && InspectorWindow != nullptr
        && OutlinerWindow->DockId != 0u && ViewportWindow->DockId != 0u && InspectorWindow->DockId != 0u;
    Panel.Expect("outliner, viewport and inspector are all docked, not floating", AllDocked);
    if (OutlinerWindow != nullptr && ViewportWindow != nullptr && InspectorWindow != nullptr)
    {
        Panel.Expect("the outliner holds the left column", OutlinerWindow->Pos.x < 8.0f && OutlinerWindow->Pos.y < 8.0f);
        Panel.Expect("the viewport holds the centre column between its two neighbours",
            ViewportWindow->Pos.x > OutlinerWindow->Pos.x + 100.0f && ViewportWindow->Pos.x < InspectorWindow->Pos.x - 100.0f);
        Panel.Expect("the inspector holds the right column", InspectorWindow->Pos.x > kWidth - 340.0f);
        Panel.Note("outliner [%.0f..%.0f] viewport [%.0f..%.0f] inspector [%.0f..%.0f]",
            OutlinerWindow->Pos.x, OutlinerWindow->Size.x + OutlinerWindow->Pos.x,
            ViewportWindow->Pos.x, ViewportWindow->Size.x + ViewportWindow->Pos.x,
            InspectorWindow->Pos.x, InspectorWindow->Size.x + InspectorWindow->Pos.x);
    }

    //----------------------------------------------------------------------------------------------------------------
    //                                        THE SHELL SHEET · A PICKED BODY
    //----------------------------------------------------------------------------------------------------------------
    // Body01 is the second figure row under the Bodies folder; the click drives the real outliner row hit.
    Click(70.0f, 322.0f);
    for (int I = 0; I < 6; ++I)
        Rest();
    Rasterise();

    Panel.Section("The shell sheet");
    Panel.Expect("clicking the Body01 row picks it", Editor.QueryPickedFigureIdentity() == BodyIdentity && BodyIdentity != 0u);
    Panel.Expect("the outliner column drew its rows", CountBright(Pixels, 60u, 0, 0, 236, kHeight) > 2500u);
    Panel.Expect("the inspector column drew the picked sheet", CountBright(Pixels, 60u, 1368, 0, kWidth, kHeight) > 2500u);
    ForeignTextures = 0u;
    Panel.Expect("no command carries a foreign texture — the viewport is blank, not fed", [&]()
    {
        uint32_t Seen = 0u;
        const ImDrawData* Drawings = ImGui::GetDrawData();
        for (int Index = 0; Index < Drawings->CmdListsCount; ++Index)
            for (int Command = 0; Command < Drawings->CmdLists[Index]->CmdBuffer.Size; ++Command)
                if (Drawings->CmdLists[Index]->CmdBuffer[Command].TexRef._TexData == nullptr)
                    ++Seen;
        return Seen == 0u;
    }());
    if (ViewportWindow != nullptr)
    {
        // A quiet patch of the view body, clear of the toolbar, the compass and the hint lines: the blank
        //    pane is one flat shade, so any spread here is a leak from a scene that was never seated.
        const int PatchX0 = static_cast<int>(ViewportWindow->Pos.x) + 30;
        const int PatchY0 = static_cast<int>(ViewportWindow->Pos.y) + 120;
        Panel.Within("the blank viewport pane is one uniform shade (channel spread)", RegionSpread(Pixels, PatchX0, PatchY0, PatchX0 + 120, PatchY0 + 120), 2.0);
    }
    Panel.Expect("the shell sheet wrote", WriteSheet("SolidArcEditorProof_Docked.png"));

    //----------------------------------------------------------------------------------------------------------------
    //                                      THE NARROWING SHEETS · THE MENU
    //----------------------------------------------------------------------------------------------------------------
    Click(178.0f, 187.0f);   // the narrowing dropdown in the outliner's search row
    for (int I = 0; I < 3; ++I)
        Rest();
    Rasterise();
    bool MenuOpen = false;
    for (ImGuiWindow* Window : ImGui::GetCurrentContext()->Windows)
        if ((Window->Flags & ImGuiWindowFlags_Popup) != 0 && Window->Active)
            MenuOpen = true;
    Panel.Section("The narrowing sheets");
    Panel.Expect("the narrowing dropdown opened its menu", MenuOpen);
    Panel.Expect("the narrowing menu sheet wrote", WriteSheet("SolidArcEditorProof_Narrowing.png"));

    Click(160.0f, 322.0f);   // the Bodies entry in the open menu
    for (int I = 0; I < 4; ++I)
        Rest();
    Rasterise();
    Panel.Expect("the Bodies narrowing sheet wrote", WriteSheet("SolidArcEditorProof_BodiesNarrowed.png"));
    Panel.Expect("the narrowed outliner still drew its column", CountBright(Pixels, 60u, 0, 0, 236, kHeight) > 1200u);

    //----------------------------------------------------------------------------------------------------------------
    //                                      THE EMPTY DOCUMENT SHEET
    //----------------------------------------------------------------------------------------------------------------
    {
        ConsoleHost EmptyHost(SOLIDARC_PROOF_FOLDER, 1280, 800);
        for (int I = 0; I < 12; ++I)
        {
            IO.DeltaTime = 1.0f / 60.0f;
            IO.AddMousePosEvent(-1.0f, -1.0f);
            IO.AddMouseButtonEvent(0, false);
            ImGui::NewFrame();
            Editor.Record(EmptyHost);
            ImGui::Render();
        }
        Rasterise();
        Panel.Section("The empty document sheet");
        Panel.Expect("the empty document's outliner still drew its six folders", CountBright(Pixels, 60u, 0, 0, 236, kHeight) > 2000u);
        Panel.Expect("the empty document's inspector drew the document summary card", CountBright(Pixels, 60u, 1368, 0, kWidth, kHeight) > 2000u);
        Panel.Expect("the empty document sheet wrote", WriteSheet("SolidArcEditorProof_EmptyDocument.png"));
    }

    //----------------------------------------------------------------------------------------------------------------
    //                                     THE TAB STRIP · THE TRAPEZOID
    //----------------------------------------------------------------------------------------------------------------
    // The left column's tab, hovered: the hovered tab's fill rises over the strip's background, and Patch
    //    A's slant shows as the tab's leading edge marching inward from its foot to its top — the outline is
    //    [0,h] [slant,0] [w-slant,0] [w,h]. A rectangular tab (stock ImGui, or a reverted patch) shows no
    //    such shift: both scanlines find the ink at the same column.
    {
        for (int I = 0; I < 4; ++I)
            Tick(30.0f, 16.0f, false);   // hover the outliner's tab, no click
        Rasterise();

        Panel.Section("The trapezoidal tab strip");
        // The hovered tab's fill rides over the strip's background, so its leading edge is measurable:
        //    scanlines near the strip's top and its foot, clear of the label ink and the strip's top rule.
        const int TopOnset  = InkOnset(Pixels, 3, 0, 236, 30u);
        const int FootOnset = InkOnset(Pixels, 17, 0, 236, 30u);
        const int SlantShift = TopOnset - FootOnset;
        Panel.Note("hovered tab ink onset at y=3: %d px, at y=17: %d px, slant shift %d px", TopOnset, FootOnset, SlantShift);
        Panel.Expect("the hovered tab's leading edge was found at both scanlines", TopOnset < 200 && FootOnset < 200);
        Panel.Within("the tab's upper edge is inset by the 14 px slant", std::abs(static_cast<float>(SlantShift) - 14.0f), 6.0);

        RasterImage Crop;
        Crop.Width  = 520u;
        Crop.Height = 150u;
        Crop.Pixels.resize(static_cast<size_t>(520u) * 150u * 4u);
        for (uint32_t Y = 0u; Y < 150u; ++Y)
            for (uint32_t X = 0u; X < 520u; ++X)
            {
                const size_t Source = (static_cast<size_t>(Y) * kWidth + X) * 4u;
                const size_t Target = (static_cast<size_t>(Y) * 520u + X) * 4u;
                Crop.Pixels[Target]      = Pixels[Source];
                Crop.Pixels[Target + 1u] = Pixels[Source + 1u];
                Crop.Pixels[Target + 2u] = Pixels[Source + 2u];
                Crop.Pixels[Target + 3u] = 255u;
            }
        Panel.Expect("the tab strip crop sheet wrote", WritePng(OutputRoot + "/SolidArcEditorProof_TabStrip.png", Crop));
    }

    ImGui::DestroyContext();
    return Panel.Conclude();
}
