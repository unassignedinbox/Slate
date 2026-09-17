//============================================================================================================================================
//                                           MATERIALGRIDSTRUCTURE.CPP
//============================================================================================================================================
// See MaterialGridStructure.h. The grid is a content fixture, not a second shading path: Construct creates ordinary
// MaterialDescriptor records, Export serialises them, and Project-Zero immediately decodes the resulting glTF.

#include "MaterialGridStructure.h"
#include "MaterialGridMaterials.h"
#include "SceneCodec.h"
#include "../DeviceExchange/OrientationClassifier.h"

#include <cmath>
#include <cstdio>
#include <cstring>
#include <utility>

namespace Frontier {

namespace {

constexpr float kPi = 3.14159265358979323846f;

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

    Materials = ConstructMaterialGridMaterials();

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
