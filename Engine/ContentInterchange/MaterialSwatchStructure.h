//============================================================================================================================================
//                                                   MATERIALSWATCHSTRUCTURE.H
//============================================================================================================================================
// 🧩 Project-Zero material grid (`--scene materialswatch`): a 4×4 wall of UV spheres under one area luminaire —
//    one sphere per unique material, so the eight reflectance selections of M1-M5 all live in a single scene:
//    standard dielectrics + metals, clearcoated bonnet plastic, anisotropic brushed aluminium, hazy polymer,
//    cloth (velvet/felt), subsurface (jade/skin), solid glossy clear glass, tinted absorbing glass, an
//    emissive-only panel and an unlit card. Built once in world space (RH Z-up, metres) and exported through
//    SceneCodec::Encode (smooth normals + TEXCOORD_0) to Content/Scenes/MaterialSwatch.gltf and thereafter
//    loaded like any other level, so the file — not this code — is what the renderer sees.

#pragma once

#include "MaterialDescriptor.h"
#include "../DeviceExchange/SwapchainExchange.h"
#include <string>
#include <vector>

namespace Frontier {

class MaterialSwatchStructure
{
public:
    // Fills the world-space soup. Triangles carry UVs; CornerNormals holds 3 smooth normals per triangle (TriangleIndex
    //    has no room for them). The luminaire quad is appended last (luminaire convention shared with the shader ball).
    void Construct() noexcept;

    // Writes MaterialSwatch.gltf at Path (SceneCodec::Encode with smooth normals and texcoords). Error receives the codec message.
    [[nodiscard]] bool Export(const std::string& Path, std::string* Error) const noexcept;

    [[nodiscard]] const std::vector<TriangleIndex>&      QueryTriangles()     const noexcept { return Triangles; }
    [[nodiscard]] const std::vector<Vector3>&            QueryCornerNormals() const noexcept { return CornerNormals; }
    [[nodiscard]] const std::vector<MaterialDescriptor>& QueryMaterials()     const noexcept { return Materials; }

    // The 16 swatch descriptors in wall order (row-major, bottom-left first) — the single source the CPU gallery
    //    sheet driver renders from, so the sheet and the GPU scene are guaranteed to show the same 16 materials.
    static const std::vector<MaterialDescriptor>& QuerySwatchMaterials() noexcept;

    // Object spans: one record per scene object over Triangles, in append order. The scope closes itself when
    //    it dies, so a span covers exactly the Appends in its block — hold one per object in Construct.
    struct SpanScope
    {
        std::vector<TriangleSpanRecord>*     Spans     = nullptr;
        const std::vector<TriangleIndex>*    Triangles = nullptr;
        uint32_t                             Span      = 0u;
        ~SpanScope() noexcept;
    };
    [[nodiscard]] SpanScope                              OpenSpan(const char* Name, bool Dynamic = false) noexcept;
    [[nodiscard]] const std::vector<TriangleSpanRecord>& QuerySpans() const noexcept { return Spans; }

private:
    void AppendSphere(const Vector3& Centre, float Radius, uint32_t Material, uint32_t Rings, uint32_t Segments) noexcept;
    void AppendQuad(const Vector3& A, const Vector3& B, const Vector3& C, const Vector3& D, uint32_t Material, float UvScale) noexcept;
    void AppendTriangle(const Vector3 P[3], const Vector3 N[3], const float Uv[3][2], uint32_t Material) noexcept;

    std::vector<TriangleIndex>      Triangles;
    std::vector<Vector3>            CornerNormals;
    std::vector<MaterialDescriptor> Materials;
    std::vector<TriangleSpanRecord> Spans;
};

} // namespace Frontier
