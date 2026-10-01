//============================================================================================================================================
//                                                    WHEELRIMSTRUCTURE.CPP
//============================================================================================================================================
// See WheelRimStructure.h.
//
// Material slots (index = order built below):
//        0 rim_face        ← RimSurfaceSlot::FaceFront   · FaceFinish    (machined / painted / polished spoke tops)
//        1 rim_pocket      ← RimSurfaceSlot::WindowWall  · PocketFinish  (window bevels, plate back, lug tubes)
//        2 rim_lip         ← RimSurfaceSlot::Lip         · LipFinish     (flanges, bead seats, outer barrel)
//        3 rim_barrel      ← RimSurfaceSlot::BarrelBore  · PocketFinish darkened (wheel-side barrel wall)
//        4 rim_hardware    ← RimSurfaceSlot::Hardware    · HardwareFinish (lug nuts)
//        5 rim_centre_cap  ← RimSurfaceSlot::CentreCap   · CapFinish
//        6 studio_floor    (matte EON grey, specular off)
//        7 studio_key, 8 studio_fill   — emissive quads, LAST (luminaire convention)

#include "WheelRimStructure.h"
#include "SceneCodec.h"
#include "../DeviceExchange/OrientationClassifier.h"
#include <cmath>
#include <cstring>

namespace Frontier {

namespace {

// Rim frame (spin axis +Z) ⇒ world (RH, Z up): the wheel stands on its tread, spin axis along +Y, outboard face
//    toward −Y, so a camera sitting at −Y looks straight at the spokes.
struct RimPlacement
{
    bool  Standing = true;
    float Lift     = 0.0f;   // [m] tread radius, so the wheel rests on Z = 0

    [[nodiscard]] Vector3 Position(float X, float Y, float Z) const noexcept
    {
        if (!Standing) return Vector3{ X, Y, Z };
        return Vector3{ X, -Z, Y + Lift };
    }
    [[nodiscard]] Vector3 Direction(float X, float Y, float Z) const noexcept
    {
        if (!Standing) return Vector3{ X, Y, Z };
        return Vector3{ X, -Z, Y };
    }
};

void SetColor(float* Target, const float Source[3]) noexcept { Target[0] = Source[0]; Target[1] = Source[1]; Target[2] = Source[2]; }
void SetColor(float* Target, float R, float G, float B) noexcept { Target[0] = R; Target[1] = G; Target[2] = B; }

MaterialDescriptor FromRecipe(const RimFinishRecipe& Recipe, const char* Name, float Darken) noexcept
{
    MaterialDescriptor Descriptor;
    Descriptor.Name = Name;
    Descriptor.Slabs.emplace_back();
    MaterialSlabDescriptor& Slab = Descriptor.Slabs[0];
    SetColor(Slab.BaseColor, Recipe.BaseColor[0] * Darken, Recipe.BaseColor[1] * Darken, Recipe.BaseColor[2] * Darken);
    SetColor(Slab.SpecularColor, Recipe.SpecularColor);
    Slab.BaseMetalness                 = Recipe.Metalness;
    Slab.BaseDiffuseRoughness          = Recipe.DiffuseRoughness;
    Slab.SpecularRoughness             = Recipe.SpecularRoughness;
    Slab.SpecularRoughnessAnisotropy   = Recipe.SpecularAnisotropy;
    Slab.CoatWeight                    = Recipe.CoatWeight;
    Slab.CoatRoughness                 = Recipe.CoatRoughness;
    Slab.SlateHazinessWeight           = Recipe.HazinessWeight;
    Slab.SlateHazinessRoughness        = Recipe.HazinessRoughness;
    return Descriptor;
}

} // namespace

//------------------------------------------------------------------------------------------------------------------------
//                                                      MATERIALS
//------------------------------------------------------------------------------------------------------------------------

MaterialDescriptor WheelRimStructure::ResolveMaterial(const WheelRimParameters& Parameters, RimSurfaceSlot Slot) noexcept
{
    switch (Slot)
    {
        case RimSurfaceSlot::FaceFront:
        {
            MaterialDescriptor D = FromRecipe(QueryFinishRecipe(Parameters.FaceFinish), "rim_face", 1.0f);
            if (Parameters.FaceFinish == RimFinishCategory::GlossPaint || Parameters.FaceFinish == RimFinishCategory::MatteBlack)
                SetColor(D.Slabs[0].BaseColor, Parameters.FacePaint);
            return D;
        }
        case RimSurfaceSlot::WindowWall:
        {
            MaterialDescriptor D = FromRecipe(QueryFinishRecipe(Parameters.PocketFinish), "rim_pocket", 1.0f);
            if (Parameters.PocketFinish == RimFinishCategory::GlossPaint || Parameters.PocketFinish == RimFinishCategory::MatteBlack)
                SetColor(D.Slabs[0].BaseColor, Parameters.PocketPaint);
            return D;
        }
        case RimSurfaceSlot::Lip:        return FromRecipe(QueryFinishRecipe(Parameters.LipFinish),      "rim_lip",        1.0f);
        case RimSurfaceSlot::BarrelBore: return FromRecipe(QueryFinishRecipe(Parameters.PocketFinish),   "rim_barrel",     0.55f);
        case RimSurfaceSlot::Hardware:   return FromRecipe(QueryFinishRecipe(Parameters.HardwareFinish), "rim_hardware",   1.0f);
        case RimSurfaceSlot::CentreCap:  return FromRecipe(QueryFinishRecipe(Parameters.CapFinish),      "rim_centre_cap", 1.0f);
        default:                         return FromRecipe(QueryFinishRecipe(RimFinishCategory::SatinGraphite), "rim_misc", 1.0f);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

void WheelRimStructure::Construct(const WheelRimSceneConfiguration& Configuration) noexcept
{
    Triangles.clear(); CornerNormals.clear(); Materials.clear(); Parts.clear();

    WheelRimParameters Parameters = Configuration.Parameters;
    (void)Parameters.Normalise();

    for (uint32_t Slot = 0u; Slot < static_cast<uint32_t>(RimSurfaceSlot::Count); ++Slot)
        Materials.push_back(ResolveMaterial(Parameters, static_cast<RimSurfaceSlot>(Slot)));

    const uint32_t FloorSlot = static_cast<uint32_t>(Materials.size());
    if (Configuration.Studio)
    {
        MaterialDescriptor Floor; Floor.Name = "studio_floor"; Floor.Slabs.emplace_back();
        SetColor(Floor.Slabs[0].BaseColor, 0.21f, 0.21f, 0.22f);
        Floor.Slabs[0].SpecularWeight = 0.15f; Floor.Slabs[0].SpecularRoughness = 0.55f; Floor.Slabs[0].BaseDiffuseRoughness = 0.8f;
        Materials.push_back(Floor);
    }

    const RimSurface Surface = WheelRimSpecification::Synthesise(Parameters);
    Parts     = Surface.Parts;
    BodyAudit = Surface.Parts.empty() ? Surface.Audit() : Surface.Audit(Surface.Parts[0].FirstTriangle, Surface.Parts[0].TriangleCount);

    RimPlacement Placement;
    Placement.Standing = Configuration.Standing;
    Placement.Lift     = Configuration.Standing ? 0.5f * Parameters.DiameterInch * 0.0254f + Parameters.FlangeHeightMillimetre * 0.001f : 0.0f;

    const uint32_t Faces = Surface.QueryTriangleCount();
    Triangles.reserve(static_cast<size_t>(Faces) + 8u);
    CornerNormals.reserve(static_cast<size_t>(Faces) * 3u + 24u);

    for (uint32_t Face = 0u; Face < Faces; ++Face)
    {
        TriangleIndex Record{};
        const uint32_t Material = Surface.Slots.empty() ? 0u : Surface.Slots[Face];
        std::memcpy(&Record.MaterialSlot, &Material, sizeof(Material));

        const uint32_t A = Surface.Corners[Face * 3u + 0u], B = Surface.Corners[Face * 3u + 1u], C = Surface.Corners[Face * 3u + 2u];
        const float* Pa = &Surface.Positions[A * 3u]; const float* Pb = &Surface.Positions[B * 3u]; const float* Pc = &Surface.Positions[C * 3u];
        const Vector3 Wa = Placement.Position(Pa[0], Pa[1], Pa[2]);
        const Vector3 Wb = Placement.Position(Pb[0], Pb[1], Pb[2]);
        const Vector3 Wc = Placement.Position(Pc[0], Pc[1], Pc[2]);
        Record.VertexAlphaX = Wa.x; Record.VertexAlphaY = Wa.y; Record.VertexAlphaZ = Wa.z;
        Record.VertexBetaX  = Wb.x; Record.VertexBetaY  = Wb.y; Record.VertexBetaZ  = Wb.z;
        Record.VertexGammaX = Wc.x; Record.VertexGammaY = Wc.y; Record.VertexGammaZ = Wc.z;

        Record.TextureAlphaU = Surface.CornerTexcoords[Face * 6u + 0u]; Record.TextureAlphaV = Surface.CornerTexcoords[Face * 6u + 1u];
        Record.TextureBetaU  = Surface.CornerTexcoords[Face * 6u + 2u]; Record.TextureBetaV  = Surface.CornerTexcoords[Face * 6u + 3u];
        Record.TextureGammaU = Surface.CornerTexcoords[Face * 6u + 4u]; Record.TextureGammaV = Surface.CornerTexcoords[Face * 6u + 5u];
        Triangles.push_back(Record);

        for (uint32_t Corner = 0u; Corner < 3u; ++Corner)
        {
            const float* N = &Surface.CornerNormals[Face * 9u + Corner * 3u];
            CornerNormals.push_back(Placement.Direction(N[0], N[1], N[2]));
        }
    }

    if (!Configuration.Studio) return;

    // Floor and two area luminaires, in the same world frame as the wheel.
    const float Extent = Configuration.FloorExtent;
    const auto Quad = [&](const Vector3& Pa, const Vector3& Pb, const Vector3& Pc, const Vector3& Pd, uint32_t Material, float UvScale)
    {
        const Vector3 Cross = OrientationClassifier::CrossProduct(Pb - Pa, Pc - Pa);
        const float   Length = Cross.Length();
        const Vector3 Normal = Length > 0.0f ? Cross / Length : Vector3{ 0.0f, 0.0f, 1.0f };
        const float SizeU = (Pb - Pa).Length() * UvScale, SizeV = (Pd - Pa).Length() * UvScale;
        const Vector3 Corners[2][3] = { { Pa, Pb, Pc }, { Pa, Pc, Pd } };
        const float   Uvs[2][3][2]  = { { { 0.0f, 0.0f }, { SizeU, 0.0f }, { SizeU, SizeV } },
                                        { { 0.0f, 0.0f }, { SizeU, SizeV }, { 0.0f, SizeV } } };
        for (uint32_t Half = 0u; Half < 2u; ++Half)
        {
            TriangleIndex Record{};
            std::memcpy(&Record.MaterialSlot, &Material, sizeof(Material));
            Record.VertexAlphaX = Corners[Half][0].x; Record.VertexAlphaY = Corners[Half][0].y; Record.VertexAlphaZ = Corners[Half][0].z;
            Record.VertexBetaX  = Corners[Half][1].x; Record.VertexBetaY  = Corners[Half][1].y; Record.VertexBetaZ  = Corners[Half][1].z;
            Record.VertexGammaX = Corners[Half][2].x; Record.VertexGammaY = Corners[Half][2].y; Record.VertexGammaZ = Corners[Half][2].z;
            Record.TextureAlphaU = Uvs[Half][0][0]; Record.TextureAlphaV = Uvs[Half][0][1];
            Record.TextureBetaU  = Uvs[Half][1][0]; Record.TextureBetaV  = Uvs[Half][1][1];
            Record.TextureGammaU = Uvs[Half][2][0]; Record.TextureGammaV = Uvs[Half][2][1];
            Triangles.push_back(Record);
            CornerNormals.push_back(Normal); CornerNormals.push_back(Normal); CornerNormals.push_back(Normal);
        }
    };

    Quad(Vector3{ -Extent, -Extent, 0.0f }, Vector3{ Extent, -Extent, 0.0f },
         Vector3{  Extent,  Extent, 0.0f }, Vector3{ -Extent, Extent, 0.0f }, FloorSlot, 0.5f);

    {   // key: 1.2 × 0.8 m panel above and in front of the face, facing down and back
        MaterialDescriptor Key; Key.Name = "studio_key"; Key.Slabs.emplace_back();
        SetColor(Key.Slabs[0].BaseColor, 1.0f, 1.0f, 1.0f);
        Key.Slabs[0].SpecularWeight = 0.0f; Key.Slabs[0].EmissionLuminance = Configuration.KeyLuminance;
        SetColor(Key.Slabs[0].EmissionColor, 1.0f, 0.98f, 0.95f);
        Materials.push_back(Key);
        const uint32_t Slot = static_cast<uint32_t>(Materials.size()) - 1u;
        const float Top = 1.35f, Front = -0.95f;
        Quad(Vector3{ -0.6f, Front,        Top        }, Vector3{ 0.6f, Front,        Top        },
             Vector3{  0.6f, Front + 0.8f, Top + 0.25f }, Vector3{ -0.6f, Front + 0.8f, Top + 0.25f }, Slot, 1.0f);
    }
    {   // fill: narrow rim light from behind and to the side, grazing the lip
        MaterialDescriptor Fill; Fill.Name = "studio_fill"; Fill.Slabs.emplace_back();
        SetColor(Fill.Slabs[0].BaseColor, 1.0f, 1.0f, 1.0f);
        Fill.Slabs[0].SpecularWeight = 0.0f; Fill.Slabs[0].EmissionLuminance = Configuration.FillLuminance;
        SetColor(Fill.Slabs[0].EmissionColor, 0.85f, 0.90f, 1.0f);
        Materials.push_back(Fill);
        const uint32_t Slot = static_cast<uint32_t>(Materials.size()) - 1u;
        Quad(Vector3{ 1.1f, 0.9f, 0.1f }, Vector3{ 1.1f, 0.9f, 1.1f },
             Vector3{ 1.1f, -0.3f, 1.1f }, Vector3{ 1.1f, -0.3f, 0.1f }, Slot, 1.0f);
    }
}

bool WheelRimStructure::Export(const std::string& Path, std::string* Error) const noexcept
{
    SceneEncodeConfiguration Configuration;
    Configuration.Name           = "WheelRim";
    Configuration.CornerNormals  = &CornerNormals;
    Configuration.WriteTexcoords = true;
    return SceneCodec::Encode(Path, Triangles, Materials, Error, Configuration);
}

} // namespace Frontier
