//============================================================================================================================================
// 📦 Frontier/DisplayPresentation/ViewportPanel.cpp — Dockable Scene Viewport Panel, Render Presentation and Locomotion HUD
//============================================================================================================================================

#include "ViewportPanel.h"
#include <imgui.h>
#include <imgui_internal.h>
#include <algorithm>
#include <cmath>
#include <cstdio>

namespace Frontier {

namespace {

inline ImU32 HexColour(uint32_t Hex, float Alpha = 1.0f) noexcept
{
    const float R = static_cast<float>((Hex >> 16) & 0xFF) / 255.0f;
    const float G = static_cast<float>((Hex >> 8) & 0xFF) / 255.0f;
    const float B = static_cast<float>(Hex & 0xFF) / 255.0f;
    return ImGui::ColorConvertFloat4ToU32(ImVec4(R, G, B, Alpha));
}

} // namespace

ViewportPanel::ViewportPanel() noexcept
    : FlySpeed(8.0f)
    , FocusedCondition(false)
    , HoveredCondition(false)
{
}

void ViewportPanel::Present(uint32_t DisplayWidth, uint32_t DisplayHeight, void* ViewportTexture, bool* OpenCondition) noexcept
{
    (void)DisplayWidth;
    (void)DisplayHeight;

    ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0.0f, 0.0f));
    ImGui::PushStyleColor(ImGuiCol_WindowBg, ImVec4(0.02f, 0.02f, 0.03f, 1.0f));

    if (ImGui::Begin("Viewport", OpenCondition, ImGuiWindowFlags_NoScrollbar | ImGuiWindowFlags_NoScrollWithMouse))
    {
        FocusedCondition = ImGui::IsWindowFocused(ImGuiFocusedFlags_RootAndChildWindows);
        HoveredCondition = ImGui::IsWindowHovered(ImGuiHoveredFlags_RootAndChildWindows);

        const ImVec2 ViewportPos = ImGui::GetCursorScreenPos();
        const ImVec2 AvailSize   = ImGui::GetContentRegionAvail();
        const float  Width       = std::max(100.0f, AvailSize.x);
        const float  Height      = std::max(100.0f, AvailSize.y);

        ImDrawList* DrawList = ImGui::GetWindowDrawList();

        if (ViewportTexture != nullptr)
        {
            ImGui::Image(reinterpret_cast<ImTextureID>(ViewportTexture), ImVec2(Width, Height));
        }
        else
        {
            RenderSimulatedCelestialScene(DrawList, ViewportPos.x, ViewportPos.y, Width, Height);
        }

        RenderLocomotionHud(DrawList, ViewportPos.x, ViewportPos.y, Width, Height);
    }
    ImGui::End();

    ImGui::PopStyleColor();
    ImGui::PopStyleVar();
}

void ViewportPanel::RenderSimulatedCelestialScene(void* DrawListOpaque, float MinX, float MinY, float Width, float Height) const noexcept
{
    ImDrawList* DrawList = static_cast<ImDrawList*>(DrawListOpaque);
    const float MaxX = MinX + Width;
    const float MaxY = MinY + Height;
    const float HorizonY = MinY + Height * 0.58f;

    // ① Sky Gradient: deep zenith dusk blue -> warm golden horizon
    const ImU32 ZenithCol   = HexColour(0x0a1020, 1.0f);
    const ImU32 MidSkyCol   = HexColour(0x192e4d, 1.0f);
    const ImU32 HorizonCol  = HexColour(0xff8c42, 1.0f);
    const ImU32 GroundCol   = HexColour(0x101114, 1.0f);

    DrawList->AddRectFilledMultiColor(
        ImVec2(MinX, MinY), ImVec2(MaxX, HorizonY),
        ZenithCol, ZenithCol, HorizonCol, HorizonCol);

    // ② Ground Plane
    DrawList->AddRectFilled(ImVec2(MinX, HorizonY), ImVec2(MaxX, MaxY), GroundCol);

    // Ground perspective checker lines
    const float CenterX = MinX + Width * 0.5f;
    for (int I = -16; I <= 16; ++I)
    {
        const float Spread = static_cast<float>(I) * (Width * 0.08f);
        const ImVec2 P0(CenterX + Spread * 0.1f, HorizonY);
        const ImVec2 P1(CenterX + Spread * 2.2f, MaxY);
        DrawList->AddLine(P0, P1, HexColour(0xffffff, 0.05f), 1.0f);
    }

    for (int J = 1; J <= 8; ++J)
    {
        const float T = static_cast<float>(J) / 8.0f;
        const float Y = HorizonY + (MaxY - HorizonY) * (T * T);
        DrawList->AddLine(ImVec2(MinX, Y), ImVec2(MaxX, Y), HexColour(0xffffff, 0.04f + T * 0.04f), 1.0f);
    }

    // ③ Stars in upper sky
    constexpr struct { float X; float Y; float R; float A; } Stars[] = {
        { 0.12f, 0.10f, 1.2f, 0.8f }, { 0.25f, 0.18f, 0.8f, 0.6f }, { 0.38f, 0.08f, 1.5f, 0.9f },
        { 0.55f, 0.14f, 1.0f, 0.7f }, { 0.68f, 0.09f, 1.3f, 0.8f }, { 0.82f, 0.16f, 0.9f, 0.6f },
        { 0.18f, 0.28f, 1.1f, 0.7f }, { 0.42f, 0.22f, 0.7f, 0.5f }, { 0.74f, 0.26f, 1.4f, 0.9f },
        { 0.88f, 0.32f, 0.8f, 0.6f }, { 0.30f, 0.35f, 1.0f, 0.7f }, { 0.62f, 0.38f, 1.2f, 0.8f }
    };
    for (const auto& S : Stars)
    {
        const float SX = MinX + S.X * Width;
        const float SY = MinY + S.Y * Height;
        DrawList->AddCircleFilled(ImVec2(SX, SY), S.R, HexColour(0xffffff, S.A), 8);
    }

    // ④ Sun disk with atmospheric glow right above horizon
    const ImVec2 SunCenter(CenterX + Width * 0.05f, HorizonY - Height * 0.06f);
    DrawList->AddCircleFilled(SunCenter, 70.0f, HexColour(0xff9933, 0.12f), 32);
    DrawList->AddCircleFilled(SunCenter, 40.0f, HexColour(0xffb84d, 0.25f), 32);
    DrawList->AddCircleFilled(SunCenter, 22.0f, HexColour(0xffe680, 0.55f), 32);
    DrawList->AddCircleFilled(SunCenter, 12.0f, HexColour(0xffffff, 0.98f), 24);
}

void ViewportPanel::RenderLocomotionHud(void* DrawListOpaque, float ViewportMinX, float ViewportMinY, float Width, float Height) const noexcept
{
    ImDrawList* DrawList = static_cast<ImDrawList*>(DrawListOpaque);

    // Floating glass pill at bottom center of the viewport
    const float HudWidth  = 460.0f;
    const float HudHeight = 44.0f;
    const float HudX = ViewportMinX + (Width - HudWidth) * 0.5f;
    const float HudY = ViewportMinY + Height - HudHeight - 20.0f;

    const ImVec2 Min(HudX, HudY);
    const ImVec2 Max(HudX + HudWidth, HudY + HudHeight);

    // Glass pill background and border
    DrawList->AddRectFilled(Min, Max, HexColour(0x0f1012, 0.82f), 22.0f);
    DrawList->AddRect(Min, Max, HexColour(0xffffff, 0.10f), 22.0f, 0, 1.0f);

    // Keys badge: [W][A][S][D] [Q][E]
    float KeyX = HudX + 14.0f;
    const float KeyY = HudY + 11.0f;
    static const char* Keys[] = { "W", "A", "S", "D", "Q", "E" };

    for (size_t I = 0; I < 6u; ++I)
    {
        const bool IsActive = (I < 4u); // WASD active, QE dimmed
        const ImVec2 KMin(KeyX, KeyY);
        const ImVec2 KMax(KeyX + 18.0f, KeyY + 20.0f);

        DrawList->AddRectFilled(KMin, KMax, HexColour(0xffffff, IsActive ? 0.12f : 0.04f), 4.0f);
        DrawList->AddRect(KMin, KMax, HexColour(0xffffff, IsActive ? 0.20f : 0.08f), 4.0f, 0, 1.0f);

        const ImU32 TextCol = IsActive ? HexColour(0xffffff, 0.95f) : HexColour(0xffffff, 0.35f);
        DrawList->AddText(ImGui::GetFont(), 11.0f, ImVec2(KeyX + 4.0f, KeyY + 3.0f), TextCol, Keys[I]);
        KeyX += 22.0f;
    }

    // Divider
    KeyX += 6.0f;
    DrawList->AddLine(ImVec2(KeyX, HudY + 10.0f), ImVec2(KeyX, HudY + HudHeight - 10.0f), HexColour(0xffffff, 0.12f), 1.0f);
    KeyX += 12.0f;

    // Fly speed label
    DrawList->AddText(ImGui::GetFont(), 11.0f, ImVec2(KeyX, HudY + 8.0f), HexColour(0xffffff, 0.50f), "Fly");
    char SpeedBuf[32];
    std::snprintf(SpeedBuf, sizeof(SpeedBuf), "%.1f", FlySpeed);
    DrawList->AddText(ImGui::GetFont(), 13.0f, ImVec2(KeyX + 22.0f, HudY + 7.0f), HexColour(0xffffff, 0.95f), SpeedBuf);
    const float NumW = ImGui::CalcTextSize(SpeedBuf).x;
    DrawList->AddText(ImGui::GetFont(), 10.0f, ImVec2(KeyX + 24.0f + NumW, HudY + 9.0f), HexColour(0xffffff, 0.40f), "m/s");

    // Speed bar indicator
    const float BarX = KeyX;
    const float BarY = HudY + 26.0f;
    const float BarW = 90.0f;
    DrawList->AddRectFilled(ImVec2(BarX, BarY), ImVec2(BarX + BarW, BarY + 4.0f), HexColour(0xffffff, 0.10f), 2.0f);
    const float FillW = std::clamp(FlySpeed / 30.0f, 0.05f, 1.0f) * BarW;
    DrawList->AddRectFilled(ImVec2(BarX, BarY), ImVec2(BarX + FillW, BarY + 4.0f), HexColour(0x34c759, 0.90f), 2.0f);

    // Divider 2
    const float Div2X = BarX + BarW + 14.0f;
    DrawList->AddLine(ImVec2(Div2X, HudY + 10.0f), ImVec2(Div2X, HudY + HudHeight - 10.0f), HexColour(0xffffff, 0.12f), 1.0f);

    // Hint text
    const float HintX = Div2X + 12.0f;
    DrawList->AddText(ImGui::GetFont(), 9.5f, ImVec2(HintX, HudY + 8.0f), HexColour(0xffffff, 0.40f), "Drag look · Scroll = speed / FOV");
    DrawList->AddText(ImGui::GetFont(), 9.5f, ImVec2(HintX, HudY + 22.0f), HexColour(0xffffff, 0.40f), "Shift = boost · F = home · G/R/S = gizmo");
}

} // namespace Frontier
