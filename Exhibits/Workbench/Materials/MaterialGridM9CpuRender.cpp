//============================================================================================================================================
//                                      MATERIALGRIDM9CPURENDER.CPP
//============================================================================================================================================
// M9 CPU parity render. This translation unit deliberately includes the proven shaderball CPU exhibit instead of
// re-implementing a second BSDF: MaterialEvaluation.slang, the Slang CPU shim, BVH traversal, NEE/MIS, ACES and the
// PNG writer are the same code used by the existing CPU proof. The scene below mirrors MaterialGridStructure exactly:
// 22 shared descriptors, the 5x4 unique sphere grid, floor, and the downward grid luminaire.
//
// It renders four real image paths from the same scene and deterministic sample stream:
// raw, no-denoise, no-reprojection, and default M9 (reprojection + five-level edge-aware à-trous). The final image
// includes a small CPU-rasterized status strip, which is the UI-facing Project-Zero material-grid presentation.

#define SHADERBALL_PREVIEW_LIB 1
#include "ShaderballExhibit.cpp"
#include "../../../Engine/ContentInterchange/MaterialGridMaterials.h"

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <string>
#include <vector>

namespace
{

using Frontier::MaterialDescriptor;
using Frontier::MaterialReflectance;
using Frontier::MaterialSlabDescriptor;

struct FilmStats
{
    double Mean = 0.0;
    double Energy = 0.0;
    long Bad = 0;
};

void AddGridSphere(const vec3& Centre, float Radius, int Mat, int Rings = 24, int Segments = 48)
{
    const auto Point = [&](int Ring, int Segment, vec3& P, vec3& N)
    {
        const float V = static_cast<float>(Ring) / static_cast<float>(Rings);
        const float U = static_cast<float>(Segment) / static_cast<float>(Segments);
        const float Theta = V * 3.14159265358979323846f;
        const float Phi = U * 2.0f * 3.14159265358979323846f;
        N = vec3(std::sin(Theta) * std::cos(Phi), std::sin(Theta) * std::sin(Phi), std::cos(Theta));
        P = Centre + N * Radius;
    };

    for (int Ring = 0; Ring < Rings; ++Ring)
        for (int Segment = 0; Segment < Segments; ++Segment)
        {
            vec3 P00, P01, P10, P11, N00, N01, N10, N11;
            Point(Ring, Segment, P00, N00);
            Point(Ring, Segment + 1, P01, N01);
            Point(Ring + 1, Segment, P10, N10);
            Point(Ring + 1, Segment + 1, P11, N11);
            if (Ring != 0)
                AddTri(P00, P10, P01, Mat);
            if (Ring + 1 != Rings)
                AddTri(P01, P10, P11, Mat);
            // The CPU tracer interpolates normals only when the source triangle carries them.
            // Replace the flat defaults with the exact sphere corner normals after AddTri.
            const int Added = (Ring != 0 ? 1 : 0) + (Ring + 1 != Rings ? 1 : 0);
            if (Added >= 1)
            {
                size_t Base = g_Tris.size() - static_cast<size_t>(Added);
                if (Ring != 0)
                {
                    g_Tris[Base].Na = N00; g_Tris[Base].Nb = N10; g_Tris[Base].Nc = N01;
                    ++Base;
                }
                if (Ring + 1 != Rings)
                {
                    g_Tris[Base].Na = N01; g_Tris[Base].Nb = N10; g_Tris[Base].Nc = N11;
                }
            }
        }
}

void AddGridQuad(const vec3& A, const vec3& B, const vec3& C, const vec3& D, int Mat)
{
    AddTri(A, B, C, Mat);
    AddTri(A, C, D, Mat);
}

void AddGridLuminaire()
{
    // Exact Project-Zero grid luminaire: 4 x 2.3 at z=5.6, winding downward.
    const vec3 A(-2.0f, 1.65f, 5.6f), B(2.0f, 1.65f, 5.6f);
    const vec3 C(2.0f, -0.65f, 5.6f), D(-2.0f, -0.65f, 5.6f);
    QuadLight L;
    L.Center = vec3(0.0f, 0.5f, 5.6f);
    L.U = vec3(2.0f, 0.0f, 0.0f);
    L.V = vec3(0.0f, 1.15f, 0.0f);
    L.N = vec3(0.0f, 0.0f, -1.0f);
    L.Radiance = vec3(120.0f, 120.0f, 120.0f);
    L.Area = 9.2f;
    const int Id = static_cast<int>(g_Lights.size());
    g_Lights.push_back(L);
    AddTri(A, B, C, 21, Id);
    AddTri(A, C, D, 21, Id);
}

MaterialReflectance DeriveSelection(const MaterialDescriptor& D, const MaterialSlabDescriptor& S)
{
    if ((D.Flags & Frontier::MaterialFlagUnlit) != 0u) return MaterialReflectance::Unlit;
    const bool Reflects = S.BaseWeight > 0.0f || S.SpecularWeight > 0.0f || S.CoatWeight > 0.0f ||
                          S.FuzzWeight > 0.0f || S.TransmissionWeight > 0.0f || S.SubsurfaceWeight > 0.0f ||
                          S.ThinFilmWeight > 0.0f;
    if (S.EmissionLuminance > 0.0f && !Reflects) return MaterialReflectance::EmissiveOnly;
    if (S.TransmissionWeight > 0.0f) return MaterialReflectance::Transmissive;
    if (S.SubsurfaceWeight > 0.0f) return MaterialReflectance::Subsurface;
    if (S.FuzzWeight > 0.0f && S.SpecularWeight == 0.0f && S.CoatWeight == 0.0f && S.BaseMetalness == 0.0f &&
        S.SlateHazinessWeight == 0.0f)
        return MaterialReflectance::Cloth;
    if (S.CoatWeight > 0.0f) return MaterialReflectance::ClearCoated;
    if (S.SpecularRoughnessAnisotropy != 0.0f) return MaterialReflectance::Anisotropic;
    return MaterialReflectance::Standard;
}

ShadingRecord MakeGridRecord(const MaterialDescriptor& D)
{
    const MaterialSlabDescriptor& S = D.Slabs.front();
    ShadingRecord M = StandardMaterial(vec3(S.BaseWeight * S.BaseColor[0], S.BaseWeight * S.BaseColor[1],
                                             S.BaseWeight * S.BaseColor[2]), S.SpecularRoughness);
    M.Metalness = S.BaseMetalness; M.DiffuseRoughness = S.BaseDiffuseRoughness;
    M.SpecularWeight = S.SpecularWeight;
    M.SpecularColor = vec3(S.SpecularColor[0], S.SpecularColor[1], S.SpecularColor[2]);
    M.SpecularRoughness = S.SpecularRoughness;
    M.SpecularAnisotropy = S.SpecularRoughnessAnisotropy;
    M.AnisotropyAngle = S.SlateAnisotropyRotation;
    M.SpecularIor = S.SpecularIor;
    M.ThinFilmWeight = S.ThinFilmWeight; M.ThinFilmThickness = S.ThinFilmThickness; M.ThinFilmIor = S.ThinFilmIor;
    M.HazinessWeight = S.SlateHazinessWeight; M.HazinessRoughness = S.SlateHazinessRoughness;
    M.CoatWeight = S.CoatWeight;
    M.CoatColor = vec3(S.CoatColor[0], S.CoatColor[1], S.CoatColor[2]);
    M.CoatRoughness = S.CoatRoughness; M.CoatAnisotropy = S.CoatRoughnessAnisotropy;
    M.CoatIor = S.CoatIor; M.CoatDarkening = S.CoatDarkening;
    M.FuzzWeight = S.FuzzWeight; M.FuzzColor = vec3(S.FuzzColor[0], S.FuzzColor[1], S.FuzzColor[2]);
    M.FuzzRoughness = S.FuzzRoughness;
    M.Emission = vec3(S.EmissionLuminance * S.EmissionColor[0], S.EmissionLuminance * S.EmissionColor[1],
                      S.EmissionLuminance * S.EmissionColor[2]);
    M.TransmissionWeight = S.TransmissionWeight;
    M.TransmissionColor = vec3(S.TransmissionColor[0], S.TransmissionColor[1], S.TransmissionColor[2]);
    M.TransmissionDepth = S.TransmissionDepth;
    M.TransmissionThickness = 0.0f;
    M.Selection = static_cast<uint>(DeriveSelection(D, S));
    M.SssWeight = S.SubsurfaceWeight;
    M.SssColor = vec3(S.SubsurfaceColor[0], S.SubsurfaceColor[1], S.SubsurfaceColor[2]);
    M.SssRadius = S.SubsurfaceRadius;
    M.SssRadiusScale = vec3(S.SubsurfaceRadiusScale[0], S.SubsurfaceRadiusScale[1], S.SubsurfaceRadiusScale[2]);
    return M;
}

void BuildGridScene()
{
    g_Tris.clear(); g_Nodes.clear(); g_Order.clear(); g_Lights.clear();
    const std::vector<MaterialDescriptor> Materials = Frontier::ConstructMaterialGridMaterials();
    if (Materials.size() != 22u)
    {
        std::fprintf(stderr, "[MaterialGridM9Cpu] expected 22 shared materials, got %zu\n", Materials.size());
        std::exit(2);
    }
    for (size_t I = 0; I < Materials.size(); ++I) g_Mats[I] = MakeGridRecord(Materials[I]);
    std::fill(g_SolidMaterials, g_SolidMaterials + 32, false);
    // glass_glossy is a closed, solid medium; glass_clear is explicitly thin-walled. This preserves both M4 paths.
    g_SolidMaterials[4] = true;

    AddGridQuad(vec3(-7.0f, -3.0f, 0.0f), vec3(7.0f, -3.0f, 0.0f),
                vec3(7.0f, 7.2f, 0.0f), vec3(-7.0f, 7.2f, 0.0f), 0);
    constexpr float Radius = 0.72f;
    constexpr float XStep = 2.40f;
    constexpr float YStep = 2.22f;
    int Material = 1;
    for (int Row = 0; Row < 4; ++Row)
        for (int Column = 0; Column < 5; ++Column, ++Material)
            AddGridSphere(vec3(-4.8f + XStep * Column, -1.45f + YStep * Row, Radius), Radius, Material);
    AddGridLuminaire();

    g_Order.resize(g_Tris.size());
    for (size_t I = 0; I < g_Tris.size(); ++I) g_Order[I] = static_cast<int>(I);
    g_Nodes.emplace_back();
    BuildBvh(0, 0, static_cast<int>(g_Tris.size()));
    std::printf("[MaterialGridM9Cpu] scene: materials=%zu tris=%zu bvh=%zu lights=%zu\n",
                Materials.size(), g_Tris.size(), g_Nodes.size(), g_Lights.size());
}

Camera GridCamera(float XOffset)
{
    Camera C;
    C.O = vec3(9.8f + XOffset, -15.8f + XOffset * 0.15f, 8.1f);
    const vec3 Look(0.0f + XOffset * 0.08f, 2.0f, 1.45f);
    C.F = normalize(Look - C.O);
    C.R = normalize(cross(C.F, vec3(0.0f, 0.0f, 1.0f)));
    C.U = normalize(cross(C.R, C.F));
    C.TanHalf = std::tan(24.0f * 3.14159265358979323846f / 180.0f);
    C.Aspect = 1.0f;
    return C;
}

FilmStats InspectFilm(const std::vector<float>& Film)
{
    FilmStats S;
    for (float V : Film)
    {
        if (!(V >= 0.0f) || !(V <= 1e6f) || !std::isfinite(V)) ++S.Bad;
        S.Mean += V;
        S.Energy += static_cast<double>(V) * static_cast<double>(V);
    }
    if (!Film.empty())
    {
        S.Mean /= static_cast<double>(Film.size());
        S.Energy /= static_cast<double>(Film.size());
    }
    return S;
}

std::vector<float> AtrousDenoise(const std::vector<float>& Input, int Size)
{
    std::vector<float> A = Input, B(Input.size());
    // M9's five enabled levels. The center plus four axial taps is kept deliberately small and deterministic; the
    // luminance gate is the CPU counterpart of the shader's normal/depth edge rejection.
    for (int Level = 0; Level < 5; ++Level)
    {
        const int Step = 1 << Level;
        for (int Y = 0; Y < Size; ++Y)
            for (int X = 0; X < Size; ++X)
            {
                const size_t Center = (static_cast<size_t>(Y) * Size + X) * 3u;
                const float L0 = 0.2126f * A[Center] + 0.7152f * A[Center + 1] + 0.0722f * A[Center + 2];
                float Sum[3] = { A[Center], A[Center + 1], A[Center + 2] };
                float Weight = 1.0f;
                const int Dx[4] = { -Step, Step, 0, 0 };
                const int Dy[4] = { 0, 0, -Step, Step };
                for (int Tap = 0; Tap < 4; ++Tap)
                {
                    const int Tx = X + Dx[Tap], Ty = Y + Dy[Tap];
                    if (Tx < 0 || Tx >= Size || Ty < 0 || Ty >= Size) continue;
                    const size_t I = (static_cast<size_t>(Ty) * Size + Tx) * 3u;
                    const float Lt = 0.2126f * A[I] + 0.7152f * A[I + 1] + 0.0722f * A[I + 2];
                    const float Edge = std::exp(-std::fabs(Lt - L0) / (0.035f + 0.20f * std::fabs(L0)));
                    Sum[0] += A[I] * Edge; Sum[1] += A[I + 1] * Edge; Sum[2] += A[I + 2] * Edge;
                    Weight += Edge;
                }
                B[Center] = Sum[0] / Weight; B[Center + 1] = Sum[1] / Weight; B[Center + 2] = Sum[2] / Weight;
            }
        A.swap(B);
    }
    return A;
}

std::vector<float> Reproject(const std::vector<float>& Current, const std::vector<float>& Previous, int Size,
                             int MotionX, int MotionY, bool Enabled)
{
    if (!Enabled) return Current;
    std::vector<float> Out(Current.size());
    for (int Y = 0; Y < Size; ++Y)
        for (int X = 0; X < Size; ++X)
        {
            const size_t D = (static_cast<size_t>(Y) * Size + X) * 3u;
            const int Px = X - MotionX, Py = Y - MotionY;
            if (Px < 0 || Px >= Size || Py < 0 || Py >= Size)
            {
                Out[D] = Current[D]; Out[D + 1] = Current[D + 1]; Out[D + 2] = Current[D + 2];
                continue;
            }
            const size_t P = (static_cast<size_t>(Py) * Size + Px) * 3u;
            // Running-mean history: this is the same temporal contract as the M9 CPU behavior proof, with a bounded
            // two-sample history for this headless frame pair. The edge is rejected by the bounds test above.
            Out[D] = 0.55f * Current[D] + 0.45f * Previous[P];
            Out[D + 1] = 0.55f * Current[D + 1] + 0.45f * Previous[P + 1];
            Out[D + 2] = 0.55f * Current[D + 2] + 0.45f * Previous[P + 2];
        }
    return Out;
}

float Encode(float X)
{
    const float A = X < 0.0f ? 0.0f : X;
    const float T = (A * (2.51f * A + 0.03f)) / (A * (2.43f * A + 0.59f) + 0.14f);
    return std::pow(std::clamp(T, 0.0f, 1.0f), 1.0f / 2.2f);
}

std::vector<unsigned char> EncodeFilm(const std::vector<float>& Film, int Size, float Exposure = 1.0f)
{
    std::vector<unsigned char> Pixels(static_cast<size_t>(Size) * Size * 3u);
    for (size_t I = 0; I < Film.size(); ++I)
        Pixels[I] = static_cast<unsigned char>(std::clamp(Encode(Film[I] * Exposure) * 255.0f, 0.0f, 255.0f));
    return Pixels;
}

void Glyph(std::vector<unsigned char>& Image, int W, int H, int X, int Y, char Ch, int Scale,
           unsigned char R, unsigned char G, unsigned char B)
{
    static const char* Digits[10] = { "01110|10001|10011|10101|11001|10001|01110", "00100|01100|00100|00100|00100|00100|01110", "01110|10001|00001|00010|00100|01000|11111", "11110|00001|00001|01110|00001|00001|11110", "00010|00110|01010|10010|11111|00010|00010", "11111|10000|10000|11110|00001|00001|11110", "00110|01000|10000|11110|10001|10001|01110", "11111|00001|00010|00100|01000|01000|01000", "01110|10001|10001|01110|10001|10001|01110", "01110|10001|10001|01111|00001|00010|11100" };
    static const char* Letters[26] = { "01110|10001|10001|11111|10001|10001|10001", "11110|10001|10001|11110|10001|10001|11110", "01111|10000|10000|10000|10000|10000|01111", "11110|10001|10001|10001|10001|10001|11110", "11111|10000|10000|11110|10000|10000|11111", "11111|10000|10000|11110|10000|10000|10000", "01111|10000|10000|10111|10001|10001|01111", "10001|10001|10001|11111|10001|10001|10001", "01110|00100|00100|00100|00100|00100|01110", "00111|00010|00010|00010|00010|10010|01100", "10001|10010|10100|11000|10100|10010|10001", "10000|10000|10000|10000|10000|10000|11111", "10001|11011|10101|10101|10001|10001|10001", "10001|11001|10101|10011|10001|10001|10001", "01110|10001|10001|10001|10001|10001|01110", "11110|10001|10001|11110|10000|10000|10000", "01110|10001|10001|10001|10101|10010|01101", "11110|10001|10001|11110|10100|10010|10001", "01111|10000|10000|01110|00001|00001|11110", "11111|00100|00100|00100|00100|00100|00100", "10001|10001|10001|10001|10001|10001|01110", "10001|10001|10001|10001|10001|01010|00100", "10001|10001|10001|10101|10101|11011|10001", "10001|10001|01110|00100|01110|10001|10001", "10001|10001|01110|00100|00100|00100|00100", "11111|00001|00010|00100|01000|10000|11111" };
    const char* Pattern = nullptr;
    if (Ch >= '0' && Ch <= '9') Pattern = Digits[Ch - '0'];
    else if (Ch >= 'A' && Ch <= 'Z') Pattern = Letters[Ch - 'A'];
    if (!Pattern) return;
    int Row = 0, Col = 0;
    for (const char* P = Pattern; *P; ++P)
    {
        if (*P == '|') { ++Row; Col = 0; continue; }
        if (*P == '1')
            for (int Oy = 0; Oy < Scale; ++Oy)
                for (int Ox = 0; Ox < Scale; ++Ox)
                {
                    const int Xp = X + Col * Scale + Ox, Yp = Y + Row * Scale + Oy;
                    if (Xp >= 0 && Xp < W && Yp >= 0 && Yp < H)
                    {
                        const size_t I = (static_cast<size_t>(Yp) * W + Xp) * 3u;
                        Image[I] = R; Image[I + 1] = G; Image[I + 2] = B;
                    }
                }
        ++Col;
    }
}

void Text(std::vector<unsigned char>& Image, int W, int H, int X, int Y, const char* String, int Scale,
          unsigned char R, unsigned char G, unsigned char B)
{
    for (const char* P = String; *P; ++P)
    {
        if (*P != ' ') Glyph(Image, W, H, X, Y, *P, Scale, R, G, B);
        X += 6 * Scale;
    }
}

void WritePng(const std::string& Path, int W, int H, const std::vector<unsigned char>& Image)
{
    if (!PngWriteCounterpart::WritePng(Path.c_str(), W, H, 3, Image.data(), W * 3))
    {
        std::fprintf(stderr, "[MaterialGridM9Cpu] failed to write %s\n", Path.c_str());
        std::exit(3);
    }
}

void WriteUi(const std::string& Path, const std::vector<float>& Film, int Size, bool Denoise, bool Reprojection,
             const FilmStats& Stats)
{
    const int W = Size, H = Size + 72;
    std::vector<unsigned char> Image(static_cast<size_t>(W) * H * 3u, 0u);
    for (int Y = 0; Y < Size; ++Y)
        for (int X = 0; X < Size; ++X)
        {
            const size_t D = (static_cast<size_t>(Y) * W + X) * 3u;
            const size_t S = (static_cast<size_t>(Y) * Size + X) * 3u;
            Image[D] = static_cast<unsigned char>(std::clamp(Encode(Film[S]) * 255.0f, 0.0f, 255.0f));
            Image[D + 1] = static_cast<unsigned char>(std::clamp(Encode(Film[S + 1]) * 255.0f, 0.0f, 255.0f));
            Image[D + 2] = static_cast<unsigned char>(std::clamp(Encode(Film[S + 2]) * 255.0f, 0.0f, 255.0f));
        }
    for (int Y = Size; Y < H; ++Y)
        for (int X = 0; X < W; ++X)
        {
            const size_t I = (static_cast<size_t>(Y) * W + X) * 3u;
            Image[I] = (Y < Size + 36) ? 19u : 12u;
            Image[I + 1] = (Y < Size + 36) ? 24u : 15u;
            Image[I + 2] = (Y < Size + 36) ? 34u : 22u;
        }
    Text(Image, W, H, 16, Size + 9, "PROJECT ZERO  MATERIAL GRID", 1, 220, 230, 242);
    Text(Image, W, H, 16, Size + 45, Denoise ? "DENOISE ON" : "DENOISE OFF", 1,
         Denoise ? 100 : 235, Denoise ? 230 : 125, Denoise ? 150 : 100);
    Text(Image, W, H, 88, Size + 45, Reprojection ? "REPROJECT ON" : "REPROJECT OFF", 1,
         Reprojection ? 100 : 235, Reprojection ? 230 : 125, Reprojection ? 150 : 100);
    char Metric[96];
    std::snprintf(Metric, sizeof(Metric), "M%.3f B%ld", Stats.Mean, Stats.Bad);
    Text(Image, W, H, W - 68, Size + 45, Metric, 1, 170, 185, 200);
    WritePng(Path, W, H, Image);
}

} // namespace

int main(int Argc, char** Argv)
{
    int Size = 256, Spp = 4;
    bool Denoise = true, Reprojection = true;
    std::string OutDir = "Projects/Project-Zero/Diagnostics";
    for (int I = 1; I < Argc; ++I)
    {
        const std::string A = Argv[I];
        if (A == "--size" && I + 1 < Argc) Size = std::atoi(Argv[++I]);
        else if (A == "--spp" && I + 1 < Argc) Spp = std::atoi(Argv[++I]);
        else if (A == "--out-dir" && I + 1 < Argc) OutDir = Argv[++I];
        else if (A == "--no-denoise") Denoise = false;
        else if (A == "--no-reprojection") Reprojection = false;
    }
    if (Size < 32 || Spp < 1) return 2;
    std::filesystem::create_directories(OutDir);

    Frontier::ShadingTableSet Tables = Frontier::ShadingTableCodec::Bake(1024u);
    g_Tables = &Tables;
    BuildGridScene();

    const Camera Current = GridCamera(0.0f);
    const Camera Previous = GridCamera(-0.18f);
    std::vector<float> Raw;
    std::vector<float> PreviousFilm;
    RenderPanel(Current, 73, Size, Spp, Raw);
    RenderPanel(Previous, 74, Size, Spp, PreviousFilm);
    const std::vector<float> Reprojected = Reproject(Raw, PreviousFilm, Size, 2, 1, true);
    const std::vector<float> Spatial = AtrousDenoise(Raw, Size);
    const std::vector<float> Enabled = AtrousDenoise(Reprojection ? Reprojected : Raw, Size);
    const std::vector<float> NoDenoise = Reprojection ? Reprojected : Raw;
    const std::vector<float> NoReprojection = Spatial;

    const FilmStats RawStats = InspectFilm(Raw);
    const FilmStats EnabledStats = InspectFilm(Enabled);
    if (RawStats.Bad != 0 || EnabledStats.Bad != 0)
    {
        std::fprintf(stderr, "[MaterialGridM9Cpu] RED non-finite film raw=%ld enabled=%ld\n", RawStats.Bad, EnabledStats.Bad);
        return 4;
    }
    std::printf("[MaterialGridM9Cpu] raw mean=%.6f energy=%.6f; enabled mean=%.6f energy=%.6f\n",
                RawStats.Mean, RawStats.Energy, EnabledStats.Mean, EnabledStats.Energy);
    std::printf("[MaterialGridM9Cpu] A/B motion=(2,1) reprojection=%s denoise=%s levels=5\n",
                Reprojection ? "on" : "off", Denoise ? "on" : "off");

    const std::string Prefix = OutDir + "/ProjectZero_MaterialGrid_";
    WritePng(Prefix + "raw.png", Size, Size, EncodeFilm(Raw, Size));
    WritePng(Prefix + "enabled.png", Size, Size, EncodeFilm(Enabled, Size));
    WritePng(Prefix + "no_denoise.png", Size, Size, EncodeFilm(NoDenoise, Size));
    WritePng(Prefix + "no_reprojection.png", Size, Size, EncodeFilm(NoReprojection, Size));
    WriteUi(Prefix + "ui.png", (Denoise ? (Reprojection ? Enabled : NoReprojection) : NoDenoise), Size,
            Denoise, Reprojection, EnabledStats);
    std::printf("[MaterialGridM9Cpu] wrote %s{raw,enabled,no_denoise,no_reprojection,ui}.png\n", Prefix.c_str());
    return 0;
}
