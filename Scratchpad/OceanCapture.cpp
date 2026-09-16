#include "../Engine/VolumetricDynamics/OceanSurfaceSolver.h"
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <string>
#include <vector>

using Frontier::OceanParticleKind;
using Frontier::OceanParticleRecord;
using Frontier::OceanSurfaceSample;
using Frontier::OceanSurfaceSolver;
using Frontier::OceanVector3;

namespace {
struct Colour { float r, g, b; };
struct Image { int w, h; std::vector<uint8_t> px; Image(int W, int H) : w(W), h(H), px(static_cast<size_t>(W * H * 3), 0u) {} };

float Saturate(float x) { return std::clamp(x, 0.0f, 1.0f); }
uint8_t Byte(float x) { return static_cast<uint8_t>(std::round(255.0f * Saturate(x))); }
void Put(Image& image, int x, int y, Colour c, float alpha = 1.0f)
{
    if (x < 0 || y < 0 || x >= image.w || y >= image.h) return;
    const size_t i = static_cast<size_t>((y * image.w + x) * 3);
    image.px[i + 0] = static_cast<uint8_t>(std::round(image.px[i + 0] * (1.0f - alpha) + Byte(c.r) * alpha));
    image.px[i + 1] = static_cast<uint8_t>(std::round(image.px[i + 1] * (1.0f - alpha) + Byte(c.g) * alpha));
    image.px[i + 2] = static_cast<uint8_t>(std::round(image.px[i + 2] * (1.0f - alpha) + Byte(c.b) * alpha));
}
void Circle(Image& image, int cx, int cy, int radius, Colour c, float alpha)
{
    radius = std::max(1, radius);
    for (int y = -radius; y <= radius; ++y) for (int x = -radius; x <= radius; ++x)
    {
        const float d = std::sqrt(static_cast<float>(x * x + y * y)) / static_cast<float>(radius);
        if (d <= 1.0f) Put(image, cx + x, cy + y, c, alpha * (1.0f - d * d));
    }
}
void WritePpm(const Image& image, const std::string& path)
{
    std::ofstream out(path, std::ios::binary);
    out << "P6\n" << image.w << ' ' << image.h << "\n255\n";
    out.write(reinterpret_cast<const char*>(image.px.data()), static_cast<std::streamsize>(image.px.size()));
}
struct View
{
    float x0 = -130.0f, x1 = 130.0f, y0 = -75.0f, y1 = 190.0f;
    int W = 1024, H = 640;
    int ProjectX(float x) const { return static_cast<int>((x - x0) / (x1 - x0) * static_cast<float>(W)); }
    int ProjectY(float y, float z) const { return static_cast<int>(H * 0.82f - (y - y0) / (y1 - y0) * H * 0.68f - z * 2.2f); }
};
Image Render(OceanSurfaceSolver& solver, bool particles, bool diagnostic)
{
    View view;
    if (particles)
    {
        view.x0 = -58.0f;
        view.x1 = 58.0f;
        view.y0 = -18.0f;
        view.y1 = 112.0f;
    }
    Image image(view.W, view.H);
    for (int y = 0; y < view.H; ++y) for (int x = 0; x < view.W; ++x)
    {
        const float worldX = view.x0 + (static_cast<float>(x) + 0.5f) / view.W * (view.x1 - view.x0);
        const float worldY = view.y0 + (0.82f - static_cast<float>(y) / view.H) / 0.68f * (view.y1 - view.y0);
        const OceanSurfaceSample s = solver.SampleSurface(worldX, worldY);
        const float light = Saturate(0.36f + 0.54f * s.Normal.z - 0.10f * s.Normal.x + 0.07f * s.Normal.y);
        const float heightBand = 0.5f + 0.5f * std::tanh(s.Height * 0.09f);
        const Colour c{ 0.025f + 0.035f * heightBand + 0.045f * light,
                        0.19f + 0.18f * light,
                        0.31f + 0.40f * light + 0.05f * heightBand };
        Put(image, x, y, c);
    }
    // A sparse wire overlay makes the displacement readable without inventing a foam texture.
    for (float y = -60.0f; y <= 180.0f; y += 12.0f)
    {
        for (float x = -130.0f; x < 130.0f; x += 2.5f)
        {
            const OceanSurfaceSample s = solver.SampleSurface(x, y);
            Put(image, view.ProjectX(x), view.ProjectY(y, s.Height), diagnostic ? Colour{0.09f, 0.34f, 0.47f} : Colour{0.07f, 0.27f, 0.38f}, 0.28f);
        }
    }
    if (particles)
    {
        const auto& records = solver.QueryParticles();
        for (uint32_t i = 0; i < solver.QueryParticleCount(); ++i)
        {
            const OceanParticleRecord& p = records[i];
            const int px = view.ProjectX(p.Position.x);
            const int py = view.ProjectY(p.Position.y, p.Position.z);
            const float scale = p.Kind == OceanParticleKind::SurfaceFoam ? 23.0f : 15.0f;
            Circle(image, px, py, static_cast<int>(std::clamp(p.Radius * scale, 1.0f, 5.0f)), Colour{p.Tint.x, p.Tint.y, p.Tint.z}, p.Alpha * 0.9f);
        }
    }
    return image;
}
void AdvanceFor(OceanSurfaceSolver& solver, float seconds)
{
    const int count = static_cast<int>(std::ceil(seconds * 60.0f));
    for (int i = 0; i < count; ++i) solver.Advance(1.0f / 60.0f);
}
}

int main()
{
    {
        OceanSurfaceSolver solver;
        solver.AssignInterestOrigin({0.0f, 60.0f, 0.0f});
        AdvanceFor(solver, 1.25f);
        WritePpm(Render(solver, false, true), "Diagnostics/Ocean_SurfaceField.ppm");
    }
    {
        OceanSurfaceSolver solver;
        solver.AssignInterestOrigin({0.0f, 35.0f, 0.0f});
        solver.InjectWake({0.0f, 20.0f, 0.0f}, {1.0f, 0.0f, 0.0f}, 25.0f, 92.0f, 10.0f);
        AdvanceFor(solver, 3.6f);
        WritePpm(Render(solver, true, false), "Diagnostics/Ocean_WakeParticles.ppm");
    }
    {
        OceanSurfaceSolver solver;
        solver.AssignInterestOrigin({0.0f, 32.0f, 0.0f});
        solver.InjectImpact({0.0f, 26.0f, 0.0f}, {2.0f, 0.0f, 8.0f}, 5.5f);
        AdvanceFor(solver, 1.35f);
        WritePpm(Render(solver, true, true), "Diagnostics/Ocean_ImpactSpray.ppm");
    }
    return 0;
}
