//============================================================================================================================================
//                                           MATERIALGRIDSTRUCTURE.H
//============================================================================================================================================
// Project-Zero material-channel exhibit. A deterministic, export-once grid with one unique OpenPBR material per ball.
// The scene is intentionally ordinary content after export: Project-Zero imports MaterialGrid.gltf through ContentCodec,
// so the channel coverage visible in the grid is the same path used by authored glTF levels.

#pragma once

#include "MaterialDescriptor.h"
#include "../DeviceExchange/SwapchainExchange.h"
#include <string>
#include <vector>

namespace Frontier {

class MaterialGridStructure
{
public:
    // Builds the world-space exhibit: a 5 × 4 ball grid, matte floor, and one overhead emissive luminaire.
    void Construct() noexcept;

    // Writes a self-contained glTF scene. The output contains one named node per ball and one material per ball.
    [[nodiscard]] bool Export(const std::string& Path, std::string* Error) const noexcept;

    [[nodiscard]] const std::vector<TriangleIndex>&      QueryTriangles()     const noexcept { return Triangles; }
    [[nodiscard]] const std::vector<Vector3>&            QueryCornerNormals() const noexcept { return CornerNormals; }
    [[nodiscard]] const std::vector<MaterialDescriptor>& QueryMaterials()     const noexcept { return Materials; }
    [[nodiscard]] const std::vector<TriangleSpanRecord>& QuerySpans()         const noexcept { return Spans; }

private:
    struct SpanScope
    {
        std::vector<TriangleSpanRecord>*  Spans     = nullptr;
        const std::vector<TriangleIndex>* Triangles = nullptr;
        uint32_t                          Span      = 0u;
        ~SpanScope() noexcept;
    };

    [[nodiscard]] SpanScope OpenSpan(const char* Name, bool Dynamic = false) noexcept;
    void AppendSphere(const Vector3& Centre, float Radius, uint32_t Material, uint32_t Rings, uint32_t Segments) noexcept;
    void AppendQuad(const Vector3& A, const Vector3& B, const Vector3& C, const Vector3& D, uint32_t Material, float UvScale) noexcept;
    void AppendTriangle(const Vector3 P[3], const Vector3 N[3], const float Uv[3][2], uint32_t Material) noexcept;

    std::vector<TriangleIndex>      Triangles;
    std::vector<Vector3>            CornerNormals;
    std::vector<MaterialDescriptor> Materials;
    std::vector<TriangleSpanRecord> Spans;
};

} // namespace Frontier
