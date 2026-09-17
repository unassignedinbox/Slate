//============================================================================================================================================
//                                                   MATERIALSWATCHSTRUCTURE.CPP
//============================================================================================================================================
// See MaterialSwatchStructure.h. Layout (top view, camera at −Y looking +Y):
//
//        row 3 (Z = 3.15)  clear glossy glass · tinted glass · emitter (EmissiveOnly) · unlit card
//        row 2 (Z = 2.25)  velvet (Cloth) · felt (Cloth) · jade (SSS) · skin (SSS)
//        row 1 (Z = 1.35)  bonnet plastic clearcoat · brushed aluminium (aniso 45°) · copper · haze polymer
//        row 0 (Z = 0.45)  matte plastic · ceramic · polished steel · gold
//                        X = −2.7, −0.9, +0.9, +2.7     spheres r = 0.45 m on the plane Y = 0; the
//                        bottom row rests on Z = 0, rows touch (0.9 m pitch = 2r), wall 6.3 m wide.
//
//    The 8×8 m plane is a mid-grey EON diffuse; the 2.5×2.5 m luminaire sits at Z = 5 on the camera side
//    (Y = −1.5, 120 nit — same order as the shader ball's). Materials are OpenPBR slabs (MaterialSlabDescriptor
//    spec defaults unless set below). The 16 swatches are pairwise distinct and cover the eight reflectance
//    selections in counts 6/1/1/2/2/2/1/1 (Standard / Aniso / Coat / Cloth / SSS / Trans / Emissive / Unlit).

#include "MaterialSwatchStructure.h"
#include "SceneCodec.h"
#include "../DeviceExchange/OrientationClassifier.h"
#include <cmath>
#include <cstdio>
#include <cstring>

namespace Frontier {

namespace {

constexpr float kPi = 3.14159265358979f;

MaterialDescriptor MakeMaterial(const char* Name)
{
    MaterialDescriptor D; D.Name = Name; D.Slabs.emplace_back(); return D;
}

void SetColor(float* Target, float R, float G, float B) { Target[0] = R; Target[1] = G; Target[2] = B; }

// The 16 swatches in wall order (row-major, bottom-left first) — the grid's one material per cell.
std::vector<MaterialDescriptor> BuildSwatchMaterials()
{
    std::vector<MaterialDescriptor> Materials;
    Materials.reserve(16);
    {   // Row 0 (bottom) — Standard: dielectrics + metals
        MaterialDescriptor D = MakeMaterial("matte_plastic");
        SetColor(D.Slabs[0].BaseColor, 0.80f, 0.20f, 0.20f); D.Slabs[0].SpecularRoughness = 0.40f;
        Materials.push_back(D);
        D = MakeMaterial("ceramic");
        SetColor(D.Slabs[0].BaseColor, 0.85f, 0.82f, 0.78f); D.Slabs[0].SpecularRoughness = 0.85f;
        Materials.push_back(D);
        D = MakeMaterial("polished_steel");   // metal: base colour = F0
        SetColor(D.Slabs[0].BaseColor, 0.92f, 0.93f, 0.95f); D.Slabs[0].BaseMetalness = 1.0f; D.Slabs[0].SpecularRoughness = 0.08f;
        Materials.push_back(D);
        D = MakeMaterial("gold");             // metal: base colour = F0, specular colour = F82 tint
        SetColor(D.Slabs[0].BaseColor, 1.000f, 0.766f, 0.336f); SetColor(D.Slabs[0].SpecularColor, 1.00f, 0.96f, 0.82f);
        D.Slabs[0].BaseMetalness = 1.0f; D.Slabs[0].SpecularRoughness = 0.15f;
        Materials.push_back(D);
    }
    {   // Row 1 — M2 sampled channels: coat, anisotropy direction + rotation, haziness
        MaterialDescriptor D = MakeMaterial("bonnet_plastic_clearcoat");   // car paint: blue base under a crisp coat
        SetColor(D.Slabs[0].BaseColor, 0.05f, 0.15f, 0.60f); D.Slabs[0].SpecularRoughness = 0.40f;
        D.Slabs[0].CoatWeight = 1.0f; D.Slabs[0].CoatRoughness = 0.03f; D.Slabs[0].CoatIor = 1.5f;
        Materials.push_back(D);
        D = MakeMaterial("brushed_aluminium");   // anisotropic metal, brushed frame rotated 45°
        SetColor(D.Slabs[0].BaseColor, 0.91f, 0.92f, 0.92f); D.Slabs[0].BaseMetalness = 1.0f; D.Slabs[0].SpecularRoughness = 0.35f;
        D.Slabs[0].SpecularRoughnessAnisotropy = 0.7f; D.Slabs[0].SlateAnisotropyRotation = 0.25f * kPi;
        Materials.push_back(D);
        D = MakeMaterial("copper");
        SetColor(D.Slabs[0].BaseColor, 0.955f, 0.638f, 0.538f); SetColor(D.Slabs[0].SpecularColor, 1.00f, 0.95f, 0.90f);
        D.Slabs[0].BaseMetalness = 1.0f; D.Slabs[0].SpecularRoughness = 0.25f;
        Materials.push_back(D);
        D = MakeMaterial("haze_polymer");        // tight dark GGX + a wide hazy lobe
        SetColor(D.Slabs[0].BaseColor, 0.10f, 0.10f, 0.10f); D.Slabs[0].SpecularRoughness = 0.10f;
        D.Slabs[0].SlateHazinessWeight = 0.7f; D.Slabs[0].SlateHazinessRoughness = 0.6f;
        Materials.push_back(D);
    }
    {   // Row 2 — M3 cloth + M5 subsurface
        MaterialDescriptor D = MakeMaterial("velvet");
        SetColor(D.Slabs[0].BaseColor, 0.35f, 0.02f, 0.08f); D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].FuzzWeight = 1.0f; D.Slabs[0].FuzzRoughness = 0.8f; SetColor(D.Slabs[0].FuzzColor, 1.0f, 0.9f, 0.9f);
        Materials.push_back(D);
        D = MakeMaterial("felt");
        SetColor(D.Slabs[0].BaseColor, 0.50f, 0.50f, 0.48f); D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].FuzzWeight = 1.0f; D.Slabs[0].FuzzRoughness = 0.9f; D.Slabs[0].BaseDiffuseRoughness = 1.0f;
        Materials.push_back(D);
        D = MakeMaterial("jade");                 // short green scatter — mostly opaque, thin rims glow
        SetColor(D.Slabs[0].BaseColor, 0.20f, 0.55f, 0.35f); D.Slabs[0].SpecularRoughness = 0.30f;
        D.Slabs[0].SubsurfaceWeight = 1.0f; SetColor(D.Slabs[0].SubsurfaceColor, 0.35f, 0.85f, 0.45f); D.Slabs[0].SubsurfaceRadius = 0.15f;
        Materials.push_back(D);
        D = MakeMaterial("skin");                 // red-shifted scatter (the (1, 0.37, 0.3) MFP scale IS the skin look)
        SetColor(D.Slabs[0].BaseColor, 0.80f, 0.55f, 0.45f); D.Slabs[0].SpecularRoughness = 0.45f;
        D.Slabs[0].SubsurfaceWeight = 0.65f; SetColor(D.Slabs[0].SubsurfaceColor, 1.0f, 0.42f, 0.30f);
        D.Slabs[0].SubsurfaceRadius = 0.30f; SetColor(D.Slabs[0].SubsurfaceRadiusScale, 1.0f, 0.37f, 0.30f);
        Materials.push_back(D);
    }
    {   // Row 3 (top) — M4 transmission + the two special selections
        MaterialDescriptor D = MakeMaterial("clear_glossy_glass");   // solid (not thin-walled) slab glass
        SetColor(D.Slabs[0].BaseColor, 0.90f, 0.95f, 0.95f); D.Slabs[0].SpecularRoughness = 0.02f;
        D.Slabs[0].SpecularIor = 1.52f; D.Slabs[0].TransmissionWeight = 1.0f; D.Slabs[0].TransmissionDepth = 0.10f;
        Materials.push_back(D);
        D = MakeMaterial("tinted_glass");         // teal Beer–Lambert absorption over a 0.4 m slab
        SetColor(D.Slabs[0].BaseColor, 0.90f, 0.95f, 0.95f); D.Slabs[0].SpecularRoughness = 0.05f;
        D.Slabs[0].SpecularIor = 1.50f; D.Slabs[0].TransmissionWeight = 1.0f;
        SetColor(D.Slabs[0].TransmissionColor, 0.20f, 0.80f, 0.70f); D.Slabs[0].TransmissionDepth = 0.40f;
        Materials.push_back(D);
        D = MakeMaterial("emitter");              // EmissiveOnly: base weight 0 — provably nothing reflective
        SetColor(D.Slabs[0].BaseColor, 0.0f, 0.0f, 0.0f); D.Slabs[0].BaseWeight = 0.0f; D.Slabs[0].SpecularWeight = 0.0f;
        D.Slabs[0].EmissionLuminance = 8.0f; SetColor(D.Slabs[0].EmissionColor, 1.0f, 0.6f, 0.3f);
        Materials.push_back(D);
        D = MakeMaterial("unlit_card");           // KHR_materials_unlit: base colour is the radiance
        SetColor(D.Slabs[0].BaseColor, 0.90f, 0.80f, 0.10f); D.Slabs[0].SpecularWeight = 0.0f;
        D.Flags = MaterialFlagUnlit;
        Materials.push_back(D);
    }
    return Materials;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                        CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

MaterialSwatchStructure::SpanScope::~SpanScope() noexcept
{
    if (Spans == nullptr || Triangles == nullptr || Span >= Spans->size()) return;
    TriangleSpanRecord& S = (*Spans)[Span];
    const uint32_t Now = static_cast<uint32_t>(Triangles->size());
    S.TriangleCount = Now >= S.FirstTriangle ? Now - S.FirstTriangle : 0u;
}

MaterialSwatchStructure::SpanScope MaterialSwatchStructure::OpenSpan(const char* Name, bool Dynamic) noexcept
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

void MaterialSwatchStructure::Construct() noexcept
{
    Triangles.clear(); CornerNormals.clear(); Materials.clear(); Spans.clear();

    // ── Materials: 0 floor · 1..16 the 16 swatches in wall order · 17 luminaire (last) ─────────────────────────
    {
        MaterialDescriptor D = MakeMaterial("floor");
        SetColor(D.Slabs[0].BaseColor, 0.45f, 0.45f, 0.45f); D.Slabs[0].SpecularWeight = 0.0f; D.Slabs[0].SpecularRoughness = 1.0f;
        Materials.push_back(D);
    }
    {
        const std::vector<MaterialDescriptor> Swatches = BuildSwatchMaterials();
        for (const MaterialDescriptor& Swatch : Swatches) Materials.push_back(Swatch);
    }
    {
        MaterialDescriptor D = MakeMaterial("luminaire");
        SetColor(D.Slabs[0].BaseColor, 1.0f, 1.0f, 1.0f); D.Slabs[0].SpecularWeight = 0.0f; D.Slabs[0].EmissionLuminance = 120.0f;
        Materials.push_back(D);
    }

    // ── Geometry ─────────────────────────────────────────────────────────────────────────────────────────────────
    {
        const auto FloorSpan = OpenSpan("Floor");
        AppendQuad(Vector3{ -4.0f, -4.0f, 0.0f }, Vector3{ 4.0f, -4.0f, 0.0f }, Vector3{ 4.0f, 4.0f, 0.0f }, Vector3{ -4.0f, 4.0f, 0.0f }, 0u, 0.25f);
    }

    constexpr float Radius = 0.45f;
    for (int Row = 0; Row < 4; ++Row)
        for (int Column = 0; Column < 4; ++Column)
        {
            const uint32_t Swatch = 1u + static_cast<uint32_t>(Row * 4u + Column);
            const Vector3 Centre{ -2.7f + 1.8f * static_cast<float>(Column), 0.0f, Radius + 0.9f * static_cast<float>(Row) };
            char BallName[80];
            std::snprintf(BallName, sizeof(BallName), "Swatch %02u (%s)", Swatch,
                          Materials[Swatch].Name.c_str());
            const auto BallSpan = OpenSpan(BallName, true);
            AppendSphere(Centre, Radius, Swatch, 24u, 48u);
        }

    // Luminaire: 2.5×2.5 m at Z = 5 on the camera side of the wall, facing down (−Z) — LAST.
    {
        const auto LuminaireSpan = OpenSpan("Luminaire");
        AppendQuad(Vector3{ -1.25f, -0.25f, 5.0f }, Vector3{ 1.25f, -0.25f, 5.0f }, Vector3{ 1.25f, -2.75f, 5.0f }, Vector3{ -1.25f, -2.75f, 5.0f }, 17u, 1.0f);
    }
}

const std::vector<MaterialDescriptor>& MaterialSwatchStructure::QuerySwatchMaterials() noexcept
{
    static const std::vector<MaterialDescriptor> Swatches = BuildSwatchMaterials();
    return Swatches;
}

void MaterialSwatchStructure::AppendTriangle(const Vector3 P[3], const Vector3 N[3], const float Uv[3][2], uint32_t Material) noexcept
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

void MaterialSwatchStructure::AppendQuad(const Vector3& A, const Vector3& B, const Vector3& C, const Vector3& D, uint32_t Material, float UvScale) noexcept
{
    const Vector3 Cross = OrientationClassifier::CrossProduct(B - A, C - A);
    const float   Len   = Cross.Length();
    const Vector3 N     = Len > 0.0f ? Cross / Len : Vector3{ 0.0f, 0.0f, 1.0f };
    const Vector3 Ns[3] = { N, N, N };
    const float   SizeU = (B - A).Length() * UvScale, SizeV = (D - A).Length() * UvScale;
    const Vector3 P0[3] = { A, B, C }; const float U0[3][2] = { { 0.0f, 0.0f }, { SizeU, 0.0f }, { SizeU, SizeV } };
    const Vector3 P1[3] = { A, C, D }; const float U1[3][2] = { { 0.0f, 0.0f }, { SizeU, SizeV }, { 0.0f, SizeV } };
    AppendTriangle(P0, Ns, U0, Material);
    AppendTriangle(P1, Ns, U1, Material);
}

void MaterialSwatchStructure::AppendSphere(const Vector3& Centre, float Radius, uint32_t Material, uint32_t Rings, uint32_t Segments) noexcept
{
    // UV sphere, poles on ±Z, CCW outward winding, u = longitude / 2π, v = latitude from the north pole.
    const auto Point = [&](uint32_t Ring, uint32_t Segment, Vector3& P, Vector3& N, float Uv[2])
    {
        const float V     = static_cast<float>(Ring) / static_cast<float>(Rings);
        const float U     = static_cast<float>(Segment) / static_cast<float>(Segments);
        const float Theta = V * kPi, Phi = U * 2.0f * kPi;
        N  = Vector3{ std::sin(Theta) * std::cos(Phi), std::sin(Theta) * std::sin(Phi), std::cos(Theta) };
        P  = Centre + N * Radius;
        Uv[0] = U; Uv[1] = V;
    };
    for (uint32_t Ring = 0u; Ring < Rings; ++Ring)
        for (uint32_t Segment = 0u; Segment < Segments; ++Segment)
        {
            Vector3 P00, P01, P10, P11, N00, N01, N10, N11; float U00[2], U01[2], U10[2], U11[2];
            Point(Ring,      Segment,      P00, N00, U00);
            Point(Ring,      Segment + 1u, P01, N01, U01);
            Point(Ring + 1u, Segment,      P10, N10, U10);
            Point(Ring + 1u, Segment + 1u, P11, N11, U11);
            if (Ring != 0u)            { const Vector3 P[3] = { P00, P10, P01 }; const Vector3 N[3] = { N00, N10, N01 }; const float Uv[3][2] = { { U00[0], U00[1] }, { U10[0], U10[1] }, { U01[0], U01[1] } }; AppendTriangle(P, N, Uv, Material); }
            if (Ring + 1u != Rings)    { const Vector3 P[3] = { P01, P10, P11 }; const Vector3 N[3] = { N01, N10, N11 }; const float Uv[3][2] = { { U01[0], U01[1] }, { U10[0], U10[1] }, { U11[0], U11[1] } }; AppendTriangle(P, N, Uv, Material); }
        }
}

bool MaterialSwatchStructure::Export(const std::string& Path, std::string* Error) const noexcept
{
    SceneEncodeConfiguration Configuration;
    Configuration.Name = "MaterialSwatch"; Configuration.CornerNormals = &CornerNormals; Configuration.WriteTexcoords = true;
    Configuration.Spans = &Spans;
    return SceneCodec::Encode(Path, Triangles, Materials, Error, Configuration);
}

} // namespace Frontier
