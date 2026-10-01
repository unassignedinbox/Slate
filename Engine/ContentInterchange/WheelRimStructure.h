//============================================================================================================================================
//                                                     WHEELRIMSTRUCTURE.H
//============================================================================================================================================
// 🧩 Engine seam for the procedural rim (`--scene rim`): takes a WheelRimParameters record, runs WheelRimSpecification,
//    turns the single-shell surface into the engine's world-space TriangleIndex soup with smooth corner normals and
//    TEXCOORD_0, resolves every RimSurfaceSlot into an OpenPBR MaterialDescriptor from the finish recipes, and writes
//    Content/Scenes/WheelRim.gltf through SceneCodec::Encode — after which the file, not this code, is what the
//    renderer sees (same contract as ShaderBallStructure).
//
// Placement: WheelRimSpecification works in the rim's own frame (spin axis = +Z). `Construct` stands the wheel up for
//    display — spin axis along +Y (lateral), outboard face toward −Y so the default camera looks at the spokes, and
//    the tread circle resting on Z = 0 — then optionally adds a studio: matte floor and two area luminaires, so the
//    level is lit without an environment map. Set `Studio = false` to emit the bare rim at the origin for asset use.

#pragma once

#include "MaterialDescriptor.h"
#include "WheelRimSpecification.h"
#include "../DeviceExchange/SwapchainExchange.h"
#include <string>
#include <vector>

namespace Frontier {

struct WheelRimSceneConfiguration
{
    WheelRimParameters Parameters;              // the wheel itself
    bool  Studio         = true;                // matte floor + two area luminaires
    bool  Standing       = true;                // rotate the spin axis onto +Y and rest the tread on Z = 0
    float FloorExtent    = 1.6f;                // [m]  half-size of the studio floor
    float KeyLuminance   = 900.0f;              // [nit] front-top key luminaire
    float FillLuminance   = 220.0f;             // [nit] rear-side fill luminaire
};

class WheelRimStructure
{
public:
    // Synthesises the wheel and fills the world-space soup. Triangles carry UVs; CornerNormals holds the three smooth
    //    (crease-limited) normals per triangle. Luminaires are appended last, the Cornell / shader-ball convention.
    void Construct(const WheelRimSceneConfiguration& Configuration = {}) noexcept;

    // Writes WheelRim.gltf at Path (SceneCodec::Encode with smooth normals and texcoords).
    [[nodiscard]] bool Export(const std::string& Path, std::string* Error) const noexcept;

    [[nodiscard]] const std::vector<TriangleIndex>&      QueryTriangles()     const noexcept { return Triangles; }
    [[nodiscard]] const std::vector<Vector3>&            QueryCornerNormals() const noexcept { return CornerNormals; }
    [[nodiscard]] const std::vector<MaterialDescriptor>& QueryMaterials()     const noexcept { return Materials; }
    [[nodiscard]] const RimSurfaceAudit&                 QueryBodyAudit()     const noexcept { return BodyAudit; }
    [[nodiscard]] const std::vector<RimPartSpan>&        QueryParts()         const noexcept { return Parts; }

    // The OpenPBR material one RimSurfaceSlot resolves to, for tools that want the palette without the geometry.
    [[nodiscard]] static MaterialDescriptor ResolveMaterial(const WheelRimParameters& Parameters, RimSurfaceSlot Slot) noexcept;

private:
    std::vector<TriangleIndex>      Triangles;
    std::vector<Vector3>            CornerNormals;
    std::vector<MaterialDescriptor> Materials;
    std::vector<RimPartSpan>        Parts;
    RimSurfaceAudit                 BodyAudit;
};

} // namespace Frontier
