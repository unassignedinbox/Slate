//============================================================================================================================================
//                                                  MATERIALGRIDSTRUCTURE.CPP
//============================================================================================================================================
// A compact, deterministic material gallery for Project-Zero. This is intentionally authored in engine coordinates
// (right-handed Z-up, metres), then sent through SceneCodec::Encode exactly like Cornell and ShaderBall.

#include "MaterialGridStructure.h"
#include "SceneCodec.h"
#include "../DeviceExchange/OrientationClassifier.h"
#include <cmath>
#include <cstring>

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

void SetColor(float* C, float R, float G, float B) { C[0] = R; C[1] = G; C[2] = B; }

} // namespace

void MaterialGridStructure::Construct() noexcept
{
    Triangles.clear();
    CornerNormals.clear();
    Materials.clear();

    // 0 is the shared exhibit floor. Cells 1..20 are deliberately not shared: a material census can therefore
    // prove that a change to one archetype never aliases another cell's authoring record.
    {
        MaterialDescriptor D = MakeMaterial("grid_floor");
        SetColor(D.Slabs[0].BaseColor, 0.16f, 0.18f, 0.22f);
        D.Slabs[0].SpecularWeight = 0.25f;
        D.Slabs[0].SpecularRoughness = 0.72f;
        Materials.push_back(D);
    }

    // Row 0 — common dielectrics and coat.
    {
        MaterialDescriptor D = MakeMaterial("plastic");
        SetColor(D.Slabs[0].BaseColor, 0.06f, 0.28f, 0.76f);
        D.Slabs[0].SpecularRoughness = 0.24f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("bone");
        SetColor(D.Slabs[0].BaseColor, 0.72f, 0.57f, 0.36f);
        D.Slabs[0].BaseDiffuseRoughness = 0.55f;
        D.Slabs[0].SpecularRoughness = 0.42f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("clearcoat");
        SetColor(D.Slabs[0].BaseColor, 0.12f, 0.42f, 0.18f);
        D.Slabs[0].SpecularRoughness = 0.46f;
        D.Slabs[0].CoatWeight = 1.0f;
        D.Slabs[0].CoatColor[0] = 0.96f; D.Slabs[0].CoatColor[1] = 0.98f; D.Slabs[0].CoatColor[2] = 1.0f;
        D.Slabs[0].CoatRoughness = 0.08f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("glass_glossy");
        SetColor(D.Slabs[0].BaseColor, 0.92f, 0.97f, 1.0f);
        D.Slabs[0].SpecularRoughness = 0.045f;
        D.Slabs[0].TransmissionWeight = 0.82f;
        D.Slabs[0].TransmissionColor[0] = 0.86f; D.Slabs[0].TransmissionColor[1] = 0.96f; D.Slabs[0].TransmissionColor[2] = 1.0f;
        D.Slabs[0].GeometryThinWalled = true;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("glass_clear");
        SetColor(D.Slabs[0].BaseColor, 1.0f, 1.0f, 1.0f);
        D.Slabs[0].SpecularRoughness = 0.015f;
        D.Slabs[0].TransmissionWeight = 1.0f;
        D.Slabs[0].TransmissionDepth = 0.12f;
        D.Slabs[0].TransmissionColor[0] = 0.96f; D.Slabs[0].TransmissionColor[1] = 0.98f; D.Slabs[0].TransmissionColor[2] = 1.0f;
        D.Slabs[0].SpecularIor = 1.52f;
        Materials.push_back(D);
    }

    // Row 1 — unique metals and anisotropic/brushed variants.
    struct Metal { const char* Name; float Base[3]; float Edge[3]; float Roughness; float Anisotropy; };
    const Metal MetalSet[5] = {
        { "metal_gold",   { 1.000f, 0.766f, 0.336f }, { 1.00f, 0.96f, 0.82f }, 0.20f,  0.00f },
        { "metal_silver", { 0.972f, 0.960f, 0.915f }, { 1.00f, 1.00f, 1.00f }, 0.14f,  0.00f },
        { "metal_copper", { 0.955f, 0.638f, 0.538f }, { 1.00f, 0.95f, 0.90f }, 0.27f,  0.00f },
        { "metal_iron",   { 0.56f, 0.57f, 0.58f }, { 0.50f, 0.50f, 0.50f }, 0.38f, -0.35f },
        { "metal_brushed",{ 0.72f, 0.75f, 0.78f }, { 1.00f, 1.00f, 1.00f }, 0.42f,  0.78f }
    };
    for (const Metal& M : MetalSet)
    {
        MaterialDescriptor D = MakeMaterial(M.Name);
        SetColor(D.Slabs[0].BaseColor, M.Base[0], M.Base[1], M.Base[2]);
        SetColor(D.Slabs[0].SpecularColor, M.Edge[0], M.Edge[1], M.Edge[2]);
        D.Slabs[0].BaseMetalness = 1.0f;
        D.Slabs[0].SpecularRoughness = M.Roughness;
        D.Slabs[0].SpecularRoughnessAnisotropy = M.Anisotropy;
        D.Slabs[0].Texture(MaterialTextureChannel::Anisotropy).Scalar = M.Anisotropy == 0.0f ? 0.0f : 0.35f;
        Materials.push_back(D);
    }

    // Row 2 — fabric, solids, and thin-film.
    {
        MaterialDescriptor D = MakeMaterial("rubber");
        SetColor(D.Slabs[0].BaseColor, 0.025f, 0.03f, 0.035f);
        D.Slabs[0].SpecularWeight = 0.18f;
        D.Slabs[0].SpecularRoughness = 0.72f;
        D.Slabs[0].BaseDiffuseRoughness = 0.8f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("ceramic");
        SetColor(D.Slabs[0].BaseColor, 0.78f, 0.82f, 0.88f);
        D.Slabs[0].SpecularRoughness = 0.18f;
        D.Slabs[0].CoatWeight = 0.35f;
        D.Slabs[0].CoatRoughness = 0.12f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("velvet");
        SetColor(D.Slabs[0].BaseColor, 0.34f, 0.015f, 0.08f);
        D.Slabs[0].SpecularWeight = 0.08f;
        D.Slabs[0].FuzzWeight = 0.92f;
        D.Slabs[0].FuzzColor[0] = 0.9f; D.Slabs[0].FuzzColor[1] = 0.72f; D.Slabs[0].FuzzColor[2] = 0.78f;
        D.Slabs[0].FuzzRoughness = 0.72f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("wax_subsurface");
        SetColor(D.Slabs[0].BaseColor, 0.82f, 0.20f, 0.12f);
        SetColor(D.Slabs[0].SubsurfaceColor, 1.0f, 0.32f, 0.18f);
        D.Slabs[0].SubsurfaceWeight = 0.72f;
        D.Slabs[0].SubsurfaceRadius = 0.018f;
        D.Slabs[0].SubsurfaceRadiusScale[0] = 1.0f; D.Slabs[0].SubsurfaceRadiusScale[1] = 0.45f; D.Slabs[0].SubsurfaceRadiusScale[2] = 0.22f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("skin_subsurface");
        SetColor(D.Slabs[0].BaseColor, 0.58f, 0.16f, 0.10f);
        SetColor(D.Slabs[0].SubsurfaceColor, 0.92f, 0.42f, 0.28f);
        D.Slabs[0].SubsurfaceWeight = 0.55f;
        D.Slabs[0].SubsurfaceRadius = 0.006f;
        Materials.push_back(D);
    }

    // Row 3 — explicit special channels and visibility controls.
    {
        MaterialDescriptor D = MakeMaterial("thin_film");
        SetColor(D.Slabs[0].BaseColor, 0.08f, 0.08f, 0.10f);
        D.Slabs[0].SpecularRoughness = 0.08f;
        D.Slabs[0].ThinFilmWeight = 1.0f;
        D.Slabs[0].ThinFilmThickness = 0.42f;
        D.Slabs[0].ThinFilmIor = 1.45f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("hazy_plastic");
        SetColor(D.Slabs[0].BaseColor, 0.18f, 0.42f, 0.50f);
        D.Slabs[0].SpecularRoughness = 0.12f;
        D.Slabs[0].SlateHazinessWeight = 0.72f;
        D.Slabs[0].SlateHazinessRoughness = 0.72f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("emissive");
        SetColor(D.Slabs[0].BaseColor, 0.02f, 0.02f, 0.02f);
        D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].EmissionLuminance = 10.0f;
        SetColor(D.Slabs[0].EmissionColor, 1.0f, 0.18f, 0.03f);
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("unlit");
        SetColor(D.Slabs[0].BaseColor, 0.06f, 0.72f, 0.92f);
        D.Flags = MaterialFlagUnlit;
        D.Slabs[0].SpecularWeight = 0.0f;
        Materials.push_back(D);
    }
    {
        MaterialDescriptor D = MakeMaterial("alpha_cutout");
        SetColor(D.Slabs[0].BaseColor, 0.90f, 0.76f, 0.08f);
        D.Slabs[0].GeometryOpacity = 0.75f;
        D.Flags = MaterialFlagAlphaMask | MaterialFlagDoubleSided;
        D.AlphaCutoff = 0.5f;
        Materials.push_back(D);
    }

    // Floor plus twenty unique cells. The last cell is a card to keep the alpha material's coverage unambiguous.
    AppendQuad(Vector3{ -5.6f, -3.0f, 0.0f }, Vector3{ 5.6f, -3.0f, 0.0f }, Vector3{ 5.6f, 4.6f, 0.0f }, Vector3{ -5.6f, 4.6f, 0.0f }, 0u, 0.22f);
    constexpr float Radius = 0.55f;
    for (uint32_t Cell = 0u; Cell < 20u; ++Cell)
    {
        const uint32_t Column = Cell % 5u;
        const uint32_t Row = Cell / 5u;
        const Vector3 Centre{ -4.0f + 2.0f * static_cast<float>(Column), -2.0f + 1.72f * static_cast<float>(Row), Radius };
        const uint32_t Material = Cell + 1u;
        if (Cell == 19u)
        {
            AppendQuad(Vector3{ Centre.x - 0.52f, Centre.y, 0.0f }, Vector3{ Centre.x + 0.52f, Centre.y, 0.0f },
                       Vector3{ Centre.x + 0.52f, Centre.y, 1.05f }, Vector3{ Centre.x - 0.52f, Centre.y, 1.05f }, Material, 1.0f);
        }
        else AppendSphere(Centre, Radius, Material, 24u, 48u);
    }

    // Luminaire is intentionally last: the renderer's emissive triangle census treats the trailing emitter as a light.
    AppendQuad(Vector3{ -1.25f, 0.8f, 5.0f }, Vector3{ 1.25f, 0.8f, 5.0f }, Vector3{ 1.25f, -1.7f, 5.0f }, Vector3{ -1.25f, -1.7f, 5.0f }, 21u, 1.0f);
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
    CornerNormals.push_back(N[0]); CornerNormals.push_back(N[1]); CornerNormals.push_back(N[2]);
}

void MaterialGridStructure::AppendQuad(const Vector3& A, const Vector3& B, const Vector3& C, const Vector3& D, uint32_t Material, float UvScale) noexcept
{
    const Vector3 Cross = OrientationClassifier::CrossProduct(B - A, C - A);
    const float Len = Cross.Length();
    const Vector3 N = Len > 0.0f ? Cross / Len : Vector3{ 0.0f, 0.0f, 1.0f };
    const Vector3 Ns[3] = { N, N, N };
    const float SizeU = (B - A).Length() * UvScale, SizeV = (D - A).Length() * UvScale;
    const Vector3 P0[3] = { A, B, C }; const float U0[3][2] = { { 0.0f, 0.0f }, { SizeU, 0.0f }, { SizeU, SizeV } };
    const Vector3 P1[3] = { A, C, D }; const float U1[3][2] = { { 0.0f, 0.0f }, { SizeU, SizeV }, { 0.0f, SizeV } };
    AppendTriangle(P0, Ns, U0, Material); AppendTriangle(P1, Ns, U1, Material);
}

void MaterialGridStructure::AppendSphere(const Vector3& Centre, float Radius, uint32_t Material, uint32_t Rings, uint32_t Segments) noexcept
{
    const auto Point = [&](uint32_t Ring, uint32_t Segment, Vector3& P, Vector3& N, float Uv[2])
    {
        const float V = static_cast<float>(Ring) / static_cast<float>(Rings);
        const float U = static_cast<float>(Segment) / static_cast<float>(Segments);
        const float Theta = V * kPi, Phi = U * 2.0f * kPi;
        N = Vector3{ std::sin(Theta) * std::cos(Phi), std::sin(Theta) * std::sin(Phi), std::cos(Theta) };
        P = Centre + N * Radius;
        Uv[0] = U; Uv[1] = V;
    };
    for (uint32_t Ring = 0u; Ring < Rings; ++Ring)
        for (uint32_t Segment = 0u; Segment < Segments; ++Segment)
        {
            Vector3 P00, P01, P10, P11, N00, N01, N10, N11;
            float U00[2], U01[2], U10[2], U11[2];
            Point(Ring, Segment, P00, N00, U00); Point(Ring, Segment + 1u, P01, N01, U01);
            Point(Ring + 1u, Segment, P10, N10, U10); Point(Ring + 1u, Segment + 1u, P11, N11, U11);
            if (Ring != 0u)
            {
                const Vector3 P[3] = { P00, P10, P01 }; const Vector3 N[3] = { N00, N10, N01 };
                const float Uv[3][2] = { { U00[0], U00[1] }, { U10[0], U10[1] }, { U01[0], U01[1] } };
                AppendTriangle(P, N, Uv, Material);
            }
            if (Ring + 1u != Rings)
            {
                const Vector3 P[3] = { P01, P10, P11 }; const Vector3 N[3] = { N01, N10, N11 };
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
    return SceneCodec::Encode(Path, Triangles, Materials, Error, Configuration);
}

} // namespace Frontier
