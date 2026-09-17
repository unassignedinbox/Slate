//============================================================================================================================================
//                                           MATERIALGRIDSTRUCTURE.CPP
//============================================================================================================================================
// See MaterialGridStructure.h. The grid is a content fixture, not a second shading path: Construct creates ordinary
// MaterialDescriptor records, Export serialises them, and Project-Zero immediately decodes the resulting glTF.

#include "MaterialGridStructure.h"
#include "SceneCodec.h"
#include "../DeviceExchange/OrientationClassifier.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <utility>

namespace Frontier {

namespace {

constexpr float kPi = 3.14159265358979323846f;

MaterialDescriptor MakeMaterial(const char* Name)
{
    MaterialDescriptor D;
    D.Name = Name;
    D.Slabs.emplace_back();
    return D;
}

void SetColor(float* Target, float R, float G, float B) noexcept
{
    Target[0] = R; Target[1] = G; Target[2] = B;
}

} // namespace

MaterialGridStructure::SpanScope::~SpanScope() noexcept
{
    if (Spans == nullptr || Triangles == nullptr || Span >= Spans->size()) return;
    TriangleSpanRecord& S = (*Spans)[Span];
    const uint32_t Now = static_cast<uint32_t>(Triangles->size());
    S.TriangleCount = Now >= S.FirstTriangle ? Now - S.FirstTriangle : 0u;
}

MaterialGridStructure::SpanScope MaterialGridStructure::OpenSpan(const char* Name, bool Dynamic) noexcept
{
    TriangleSpanRecord S;
    S.FirstTriangle = static_cast<uint32_t>(Triangles.size());
    if (Name != nullptr) S.Name = Name;
    S.Dynamic = Dynamic;
    Spans.push_back(std::move(S));

    SpanScope Scope;
    Scope.Spans     = &Spans;
    Scope.Triangles = &Triangles;
    Scope.Span      = static_cast<uint32_t>(Spans.size()) - 1u;
    return Scope;
}

void MaterialGridStructure::Construct() noexcept
{
    Triangles.clear();
    CornerNormals.clear();
    Materials.clear();
    Spans.clear();

    // Material 0 is the neutral floor. Balls start at material 1 and remain one-to-one with the 20 grid cells below.
    {
        MaterialDescriptor D = MakeMaterial("grid_floor");
        SetColor(D.Slabs[0].BaseColor, 0.16f, 0.17f, 0.19f);
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].BaseDiffuseRoughness = 0.75f;
        Materials.push_back(D);
    }

    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    // One descriptor per cell. The names are deliberately stable: they are the material inspector's selection names
    // and the scene census' identity keys. Values exercise the resolved channels, not a palette-only colour swap.
    // ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    {
        MaterialDescriptor D = MakeMaterial("plastic");
        SetColor(D.Slabs[0].BaseColor, 0.035f, 0.18f, 0.72f);
        D.Slabs[0].SpecularRoughness = 0.28f;
        D.Slabs[0].SpecularIor = 1.46f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("bone");
        SetColor(D.Slabs[0].BaseColor, 0.72f, 0.52f, 0.34f);
        D.Slabs[0].SpecularWeight = 0.35f;
        D.Slabs[0].SpecularRoughness = 0.42f;
        D.Slabs[0].SubsurfaceWeight = 0.72f;
        SetColor(D.Slabs[0].SubsurfaceColor, 0.95f, 0.66f, 0.46f);
        D.Slabs[0].SubsurfaceRadius = 0.018f;
        D.Slabs[0].SubsurfaceRadiusScale[0] = 1.0f;
        D.Slabs[0].SubsurfaceRadiusScale[1] = 0.58f;
        D.Slabs[0].SubsurfaceRadiusScale[2] = 0.32f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("clearcoat");
        SetColor(D.Slabs[0].BaseColor, 0.62f, 0.025f, 0.018f);
        D.Slabs[0].SpecularRoughness = 0.34f;
        D.Slabs[0].CoatWeight = 1.0f;
        D.Slabs[0].CoatColor[0] = 1.0f; D.Slabs[0].CoatColor[1] = 0.96f; D.Slabs[0].CoatColor[2] = 0.90f;
        D.Slabs[0].CoatRoughness = 0.045f;
        D.Slabs[0].CoatIor = 1.50f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("glass_glossy");
        SetColor(D.Slabs[0].BaseColor, 0.86f, 0.94f, 1.0f);
        D.Slabs[0].SpecularRoughness = 0.12f;
        D.Slabs[0].SpecularIor = 1.52f;
        D.Slabs[0].TransmissionWeight = 1.0f;
        SetColor(D.Slabs[0].TransmissionColor, 0.82f, 0.94f, 1.0f);
        D.Slabs[0].TransmissionDepth = 0.10f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("glass_clear");
        SetColor(D.Slabs[0].BaseColor, 0.96f, 0.98f, 1.0f);
        D.Slabs[0].SpecularRoughness = 0.015f;
        D.Slabs[0].SpecularIor = 1.50f;
        D.Slabs[0].TransmissionWeight = 1.0f;
        SetColor(D.Slabs[0].TransmissionColor, 1.0f, 1.0f, 1.0f);
        D.Slabs[0].GeometryThinWalled = true;
        D.Flags |= MaterialFlagThinWalled;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("metal_gold");
        SetColor(D.Slabs[0].BaseColor, 1.00f, 0.71f, 0.20f);
        SetColor(D.Slabs[0].SpecularColor, 1.00f, 0.93f, 0.72f);
        D.Slabs[0].BaseMetalness = 1.0f;
        D.Slabs[0].SpecularRoughness = 0.20f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("metal_silver");
        SetColor(D.Slabs[0].BaseColor, 0.88f, 0.90f, 0.94f);
        SetColor(D.Slabs[0].SpecularColor, 1.00f, 1.00f, 1.00f);
        D.Slabs[0].BaseMetalness = 1.0f;
        D.Slabs[0].SpecularRoughness = 0.16f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("metal_copper");
        SetColor(D.Slabs[0].BaseColor, 0.82f, 0.24f, 0.10f);
        SetColor(D.Slabs[0].SpecularColor, 1.00f, 0.72f, 0.56f);
        D.Slabs[0].BaseMetalness = 1.0f;
        D.Slabs[0].SpecularRoughness = 0.27f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("metal_iron");
        SetColor(D.Slabs[0].BaseColor, 0.36f, 0.39f, 0.43f);
        SetColor(D.Slabs[0].SpecularColor, 0.58f, 0.60f, 0.63f);
        D.Slabs[0].BaseMetalness = 1.0f;
        D.Slabs[0].SpecularRoughness = 0.42f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("metal_brushed");
        SetColor(D.Slabs[0].BaseColor, 0.52f, 0.56f, 0.60f);
        SetColor(D.Slabs[0].SpecularColor, 0.82f, 0.86f, 0.90f);
        D.Slabs[0].BaseMetalness = 1.0f;
        D.Slabs[0].SpecularRoughness = 0.24f;
        D.Slabs[0].SpecularRoughnessAnisotropy = -0.82f;
        D.Slabs[0].SlateAnisotropyRotation = 0.55f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("clearcoat_rough");
        SetColor(D.Slabs[0].BaseColor, 0.04f, 0.22f, 0.12f);
        D.Slabs[0].SpecularRoughness = 0.48f;
        D.Slabs[0].CoatWeight = 0.85f;
        D.Slabs[0].CoatRoughness = 0.30f;
        D.Slabs[0].CoatIor = 1.62f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("velvet");
        SetColor(D.Slabs[0].BaseColor, 0.32f, 0.012f, 0.075f);
        SetColor(D.Slabs[0].FuzzColor, 1.0f, 0.82f, 0.86f);
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].FuzzWeight = 1.0f;
        D.Slabs[0].FuzzRoughness = 0.72f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("felt");
        SetColor(D.Slabs[0].BaseColor, 0.16f, 0.20f, 0.24f);
        SetColor(D.Slabs[0].FuzzColor, 0.42f, 0.56f, 0.72f);
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].FuzzWeight = 0.86f;
        D.Slabs[0].FuzzRoughness = 0.92f;
        D.Slabs[0].BaseDiffuseRoughness = 0.82f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("wax");
        SetColor(D.Slabs[0].BaseColor, 0.66f, 0.10f, 0.045f);
        SetColor(D.Slabs[0].SubsurfaceColor, 1.0f, 0.22f, 0.08f);
        D.Slabs[0].SpecularWeight = 0.25f;
        D.Slabs[0].SpecularRoughness = 0.36f;
        D.Slabs[0].SubsurfaceWeight = 0.88f;
        D.Slabs[0].SubsurfaceRadius = 0.030f;
        D.Slabs[0].SubsurfaceRadiusScale[0] = 1.0f;
        D.Slabs[0].SubsurfaceRadiusScale[1] = 0.22f;
        D.Slabs[0].SubsurfaceRadiusScale[2] = 0.08f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("jade");
        SetColor(D.Slabs[0].BaseColor, 0.08f, 0.50f, 0.24f);
        SetColor(D.Slabs[0].SubsurfaceColor, 0.12f, 0.82f, 0.30f);
        D.Slabs[0].SpecularWeight = 0.28f;
        D.Slabs[0].SpecularRoughness = 0.30f;
        D.Slabs[0].SubsurfaceWeight = 0.70f;
        D.Slabs[0].SubsurfaceRadius = 0.022f;
        D.Slabs[0].SubsurfaceRadiusScale[0] = 0.22f;
        D.Slabs[0].SubsurfaceRadiusScale[1] = 1.0f;
        D.Slabs[0].SubsurfaceRadiusScale[2] = 0.34f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("soap_film");
        SetColor(D.Slabs[0].BaseColor, 0.035f, 0.04f, 0.05f);
        D.Slabs[0].SpecularRoughness = 0.08f;
        D.Slabs[0].ThinFilmWeight = 1.0f;
        D.Slabs[0].ThinFilmThickness = 0.34f;
        D.Slabs[0].ThinFilmIor = 1.42f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("emissive");
        D.Slabs[0].BaseWeight = 0.0f;
        D.Slabs[0].BaseColor[0] = 0.0f; D.Slabs[0].BaseColor[1] = 0.0f; D.Slabs[0].BaseColor[2] = 0.0f;
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].EmissionLuminance = 8.0f;
        SetColor(D.Slabs[0].EmissionColor, 1.0f, 0.30f, 0.035f);
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("unlit");
        SetColor(D.Slabs[0].BaseColor, 0.04f, 0.68f, 0.95f);
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Flags |= MaterialFlagUnlit;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("hazy_clear");
        SetColor(D.Slabs[0].BaseColor, 0.18f, 0.20f, 0.23f);
        D.Slabs[0].SpecularRoughness = 0.08f;
        D.Slabs[0].SlateHazinessWeight = 0.78f;
        D.Slabs[0].SlateHazinessRoughness = 0.76f;
        D.Slabs[0].CoatWeight = 0.25f;
        D.Slabs[0].CoatRoughness = 0.20f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("matte_eon");
        SetColor(D.Slabs[0].BaseColor, 0.72f, 0.46f, 0.12f);
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].BaseDiffuseRoughness = 1.0f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("grid_luminaire");
        SetColor(D.Slabs[0].BaseColor, 1.0f, 1.0f, 1.0f);
        D.Slabs[0].BaseWeight = 0.0f;
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].EmissionLuminance = 120.0f;
        Materials.push_back(D);
    }

    // ── Geometry ─────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const SpanScope Floor = OpenSpan("Material Grid Floor");
        (void)Floor;
        AppendQuad(Vector3{ -7.0f, -3.0f, 0.0f }, Vector3{ 7.0f, -3.0f, 0.0f },
                   Vector3{ 7.0f, 7.2f, 0.0f }, Vector3{ -7.0f, 7.2f, 0.0f }, 0u, 0.25f);
    }

    constexpr float Radius = 0.72f;
    constexpr float XStep = 2.40f;
    constexpr float YStep = 2.22f;
    uint32_t Material = 1u;
    for (uint32_t Row = 0u; Row < 4u; ++Row)
        for (uint32_t Column = 0u; Column < 5u; ++Column, ++Material)
        {
            const Vector3 Centre{
                -4.8f + XStep * static_cast<float>(Column),
                -1.45f + YStep * static_cast<float>(Row),
                Radius
            };
            char BallName[96];
            std::snprintf(BallName, sizeof(BallName), "Grid %u,%u · %s", Row + 1u, Column + 1u,
                          Materials[Material].Name.c_str());
            const SpanScope Ball = OpenSpan(BallName, false);
            (void)Ball;
            AppendSphere(Centre, Radius, Material, 24u, 48u);
        }

    // Last span is the emissive source. Its downward normal makes it a luminaire after the glTF round trip.
    {
        const SpanScope Luminaire = OpenSpan("Material Grid Luminaire");
        (void)Luminaire;
        AppendQuad(Vector3{ -2.0f, 1.65f, 5.6f }, Vector3{ 2.0f, 1.65f, 5.6f },
                   Vector3{ 2.0f, -0.65f, 5.6f }, Vector3{ -2.0f, -0.65f, 5.6f }, 21u, 1.0f);
    }
}

void MaterialGridStructure::AppendTriangle(const Vector3 P[3], const Vector3 N[3], const float Uv[3][2], uint32_t Material) noexcept
{
    TriangleIndex T{};
    T.VertexAlphaX = P[0].x; T.VertexAlphaY = P[0].y; T.VertexAlphaZ = P[0].z;
    T.VertexBetaX  = P[1].x; T.VertexBetaY  = P[1].y; T.VertexBetaZ  = P[1].z;
    T.VertexGammaX = P[2].x; T.VertexGammaY = P[2].y; T.VertexGammaZ = P[2].z;
    std::memcpy(&T.MaterialSlot, &Material, sizeof(Material));
    T.TextureAlphaU = Uv[0][0]; T.TextureAlphaV = Uv[0][1];
    T.TextureBetaU  = Uv[1][0]; T.TextureBetaV  = Uv[1][1];
    T.TextureGammaU = Uv[2][0]; T.TextureGammaV = Uv[2][1];
    Triangles.push_back(T);
    CornerNormals.push_back(N[0]);
    CornerNormals.push_back(N[1]);
    CornerNormals.push_back(N[2]);
}

void MaterialGridStructure::AppendQuad(const Vector3& A, const Vector3& B, const Vector3& C, const Vector3& D,
                                       uint32_t Material, float UvScale) noexcept
{
    const Vector3 Cross = OrientationClassifier::CrossProduct(B - A, C - A);
    const float Len = Cross.Length();
    const Vector3 N = Len > 0.0f ? Cross / Len : Vector3{ 0.0f, 0.0f, 1.0f };
    const Vector3 Ns[3] = { N, N, N };
    const float SizeU = (B - A).Length() * UvScale;
    const float SizeV = (D - A).Length() * UvScale;
    const Vector3 P0[3] = { A, B, C };
    const float U0[3][2] = { { 0.0f, 0.0f }, { SizeU, 0.0f }, { SizeU, SizeV } };
    const Vector3 P1[3] = { A, C, D };
    const float U1[3][2] = { { 0.0f, 0.0f }, { SizeU, SizeV }, { 0.0f, SizeV } };
    AppendTriangle(P0, Ns, U0, Material);
    AppendTriangle(P1, Ns, U1, Material);
}

void MaterialGridStructure::AppendSphere(const Vector3& Centre, float Radius, uint32_t Material,
                                         uint32_t Rings, uint32_t Segments) noexcept
{
    const auto Point = [&](uint32_t Ring, uint32_t Segment, Vector3& P, Vector3& N, float Uv[2])
    {
        const float V = static_cast<float>(Ring) / static_cast<float>(Rings);
        const float U = static_cast<float>(Segment) / static_cast<float>(Segments);
        const float Theta = V * kPi;
        const float Phi = U * 2.0f * kPi;
        N = Vector3{ std::sin(Theta) * std::cos(Phi), std::sin(Theta) * std::sin(Phi), std::cos(Theta) };
        P = Centre + N * Radius;
        Uv[0] = U;
        Uv[1] = V;
    };

    for (uint32_t Ring = 0u; Ring < Rings; ++Ring)
        for (uint32_t Segment = 0u; Segment < Segments; ++Segment)
        {
            Vector3 P00, P01, P10, P11, N00, N01, N10, N11;
            float U00[2], U01[2], U10[2], U11[2];
            Point(Ring, Segment,      P00, N00, U00);
            Point(Ring, Segment + 1u, P01, N01, U01);
            Point(Ring + 1u, Segment,      P10, N10, U10);
            Point(Ring + 1u, Segment + 1u, P11, N11, U11);
            if (Ring != 0u)
            {
                const Vector3 P[3] = { P00, P10, P01 };
                const Vector3 N[3] = { N00, N10, N01 };
                const float Uv[3][2] = { { U00[0], U00[1] }, { U10[0], U10[1] }, { U01[0], U01[1] } };
                AppendTriangle(P, N, Uv, Material);
            }
            if (Ring + 1u != Rings)
            {
                const Vector3 P[3] = { P01, P10, P11 };
                const Vector3 N[3] = { N01, N10, N11 };
                const float Uv[3][2] = { { U01[0], U01[1] }, { U10[0], U10[1] }, { U11[0], U11[1] } };
                AppendTriangle(P, N, Uv, Material);
            }
        }
}

bool MaterialGridStructure::Export(const std::string& Path, std::string* Error) const noexcept
{
    SceneEncodeConfiguration Configuration;
    Configuration.Name = "MaterialGrid";
    Configuration.CornerNormals = &CornerNormals;
    Configuration.WriteTexcoords = true;
    Configuration.Spans = &Spans;
    return SceneCodec::Encode(Path, Triangles, Materials, Error, Configuration);
}

} // namespace Frontier
