//============================================================================================================================================
//                                                   MATERIALGRIDSTRUCTURE.H
//============================================================================================================================================
// Project-Zero material coverage exhibit. Every cell owns a distinct descriptor and material id; the scene is exported
// once to glTF so the normal ContentCodec -> MaterialIndex -> resident GPU path is the thing under test.

#pragma once

#include "MaterialDescriptor.h"
#include "../DeviceExchange/SwapchainExchange.h"
#include <string>
#include <vector>

namespace Frontier {

class MaterialGridStructure
{
public:
    void Construct() noexcept;
    [[nodiscard]] bool Export(const std::string& Path, std::string* Error) const noexcept;

    [[nodiscard]] const std::vector<TriangleIndex>& QueryTriangles() const noexcept { return Triangles; }
    [[nodiscard]] const std::vector<Vector3>& QueryCornerNormals() const noexcept { return CornerNormals; }
    [[nodiscard]] const std::vector<MaterialDescriptor>& QueryMaterials() const noexcept { return Materials; }

private:
    void AppendTriangle(const Vector3 P[3], const Vector3 N[3], const float Uv[3][2], uint32_t Material) noexcept;
    void AppendQuad(const Vector3& A, const Vector3& B, const Vector3& C, const Vector3& D, uint32_t Material, float UvScale) noexcept;
    void AppendSphere(const Vector3& Centre, float Radius, uint32_t Material, uint32_t Rings, uint32_t Segments) noexcept;

    std::vector<TriangleIndex> Triangles;
    std::vector<Vector3> CornerNormals;
    std::vector<MaterialDescriptor> Materials;
};

} // namespace Frontier
