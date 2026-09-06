//============================================================================================================================================
// 📦 Project-Zero/Source/RayTracingSolver.cpp — Triangle Ray Intersection and Cornell Box Scene Solver Implementation
//============================================================================================================================================

#include "RayTracingSolver.h"
#include <cmath>
#include <limits>
#include <algorithm>

namespace Frontier::ProjectZero {

//------------------------------------------------------------------------------------------------------------------------
//                                                LIFECYCLE IMPLEMENTATION
//------------------------------------------------------------------------------------------------------------------------

RayTracingSolver::RayTracingSolver() noexcept
{
    ConstructCornellBoxScene();
}

//------------------------------------------------------------------------------------------------------------------------
//                                                SCENE GEOMETRY SETUP
//------------------------------------------------------------------------------------------------------------------------

void RayTracingSolver::ConstructCornellBoxScene() noexcept
{
    Triangles.clear();
    Materials.clear();

    // Material 0: White diffuse walls, floor, ceiling
    Materials.push_back(AnalyticalMaterial{ Vector3{ 0.75f, 0.75f, 0.75f }, Vector3{ 0.0f, 0.0f, 0.0f }, 0.5f, 0.0f, 0 });
    // Material 1: Left wall (vibrant red)
    Materials.push_back(AnalyticalMaterial{ Vector3{ 0.85f, 0.12f, 0.12f }, Vector3{ 0.0f, 0.0f, 0.0f }, 0.5f, 0.0f, 1 });
    // Material 2: Right wall (vibrant green)
    Materials.push_back(AnalyticalMaterial{ Vector3{ 0.12f, 0.85f, 0.15f }, Vector3{ 0.0f, 0.0f, 0.0f }, 0.5f, 0.0f, 2 });
    // Material 3: Ceiling Light (bright emissive white)
    Materials.push_back(AnalyticalMaterial{ Vector3{ 1.0f, 1.0f, 1.0f }, Vector3{ 32.0f, 32.0f, 32.0f }, 0.1f, 0.0f, 3 });
    // Material 4: Tall Box (warm white diffuse)
    Materials.push_back(AnalyticalMaterial{ Vector3{ 0.78f, 0.78f, 0.78f }, Vector3{ 0.0f, 0.0f, 0.0f }, 0.4f, 0.0f, 4 });
    // Material 5: Short Box (cool white diffuse)
    Materials.push_back(AnalyticalMaterial{ Vector3{ 0.78f, 0.78f, 0.78f }, Vector3{ 0.0f, 0.0f, 0.0f }, 0.4f, 0.0f, 5 });

    // Cornell Box in the engine's right-handed Z-up world (CLAUDE.md §7):
    //      X ∈ [−2, +2]  right / east       (red wall at X = −2, green wall at X = +2)
    //      Y ∈ [ 0, +4]  forward / north    (open front at Y = 0, back wall at Y = +4)
    //      Z ∈ [ 0, +3]  up / zenith        (floor at Z = 0, ceiling + luminaire at Z = +3)
    //    The camera stands at Y < 0 looking along +Y into the room.
    //
    //    The room is deliberately larger than the classic 2 × 2 × 2 Cornell box: the sky work needs floor area for a
    //    sun shaft to land on and enough height for the shaft to read as a shaft rather than a bright patch.
    //
    //    ⚠️ The emissive quad MUST remain the last geometry appended — the shader addresses light
    //       triangles as the trailing LightTriangleCount entries of the triangle buffer.

    // Room and aperture bounds. Named rather than inlined because the ceiling is built as four strips around the
    //    hole and every strip has to agree with the others on where the opening is.
    constexpr float RoomMinX = -2.0f, RoomMaxX = 2.0f;
    constexpr float RoomMinY =  0.0f, RoomMaxY = 4.0f;
    constexpr float RoomTopZ =  3.0f;
    constexpr float HoleMinX = -0.70f, HoleMaxX = 0.70f;   // 1.4 m × 1.0 m opening, set back from the front wall so
    constexpr float HoleMinY =  2.55f, HoleMaxY = 3.55f;   //    the shaft crosses the floor rather than the far wall

    // Floor (Z = 0, normal +Z)
    AppendQuad(Vector3{ RoomMinX, RoomMinY, 0.0f }, Vector3{ RoomMaxX, RoomMinY, 0.0f }, Vector3{ RoomMaxX, RoomMaxY, 0.0f }, Vector3{ RoomMinX, RoomMaxY, 0.0f }, 0);

    // Ceiling (Z = RoomTopZ, normal −Z) — FOUR strips leaving a rectangular hole open to the sky. The winding
    //    (Xmin,Ymax) → (Xmax,Ymax) → (Xmax,Ymin) → (Xmin,Ymin) is what produces the −Z normal; every strip repeats it.
    //    Until the sky exists the opening reads as black, which is correct: there is genuinely nothing above it yet.
    AppendQuad(Vector3{ RoomMinX, RoomMaxY, RoomTopZ }, Vector3{ RoomMaxX, RoomMaxY, RoomTopZ }, Vector3{ RoomMaxX, HoleMaxY, RoomTopZ }, Vector3{ RoomMinX, HoleMaxY, RoomTopZ }, 0);   // behind the hole
    AppendQuad(Vector3{ RoomMinX, HoleMinY, RoomTopZ }, Vector3{ RoomMaxX, HoleMinY, RoomTopZ }, Vector3{ RoomMaxX, RoomMinY, RoomTopZ }, Vector3{ RoomMinX, RoomMinY, RoomTopZ }, 0);   // in front of it
    AppendQuad(Vector3{ RoomMinX, HoleMaxY, RoomTopZ }, Vector3{ HoleMinX, HoleMaxY, RoomTopZ }, Vector3{ HoleMinX, HoleMinY, RoomTopZ }, Vector3{ RoomMinX, HoleMinY, RoomTopZ }, 0);   // left of it
    AppendQuad(Vector3{ HoleMaxX, HoleMaxY, RoomTopZ }, Vector3{ RoomMaxX, HoleMaxY, RoomTopZ }, Vector3{ RoomMaxX, HoleMinY, RoomTopZ }, Vector3{ HoleMaxX, HoleMinY, RoomTopZ }, 0);   // right of it

    // Back Wall (Y = RoomMaxY, normal −Y)
    AppendQuad(Vector3{ RoomMinX, RoomMaxY, 0.0f }, Vector3{ RoomMaxX, RoomMaxY, 0.0f }, Vector3{ RoomMaxX, RoomMaxY, RoomTopZ }, Vector3{ RoomMinX, RoomMaxY, RoomTopZ }, 0);
    // Left Wall (X = −2, Red, normal +X)
    AppendQuad(Vector3{ RoomMinX, RoomMinY, 0.0f }, Vector3{ RoomMinX, RoomMaxY, 0.0f }, Vector3{ RoomMinX, RoomMaxY, RoomTopZ }, Vector3{ RoomMinX, RoomMinY, RoomTopZ }, 1);
    // Right Wall (X = +2, Green, normal −X)
    AppendQuad(Vector3{ RoomMaxX, RoomMaxY, 0.0f }, Vector3{ RoomMaxX, RoomMinY, 0.0f }, Vector3{ RoomMaxX, RoomMinY, RoomTopZ }, Vector3{ RoomMaxX, RoomMaxY, RoomTopZ }, 2);

    // Tall Box (0.84 × 0.84 footprint, 1.8 m tall, rotated +22° about Z) — rear left, clear of the aperture so it
    //    catches the edge of the shaft and casts a long shadow rather than plugging the hole.
    AppendBox(Vector3{ -0.90f, 2.70f, 0.90f }, Vector3{ 0.42f, 0.42f, 0.90f },  22.0f, 4);
    // Short Box (0.84 × 0.84 footprint, 0.9 m tall, rotated −18° about Z) — front right
    AppendBox(Vector3{  0.85f, 1.50f, 0.45f }, Vector3{ 0.42f, 0.42f, 0.45f }, -18.0f, 5);

    // Ceiling Luminaire (Z = RoomTopZ − 0.005, normal −Z) — LAST, see note above. Kept clear of the aperture in Y so
    //    the two light sources stay visually separable once the sky is contributing through the hole.
    AppendQuad(Vector3{ -0.50f, 1.70f, RoomTopZ - 0.005f }, Vector3{ 0.50f, 1.70f, RoomTopZ - 0.005f }, Vector3{ 0.50f, 0.90f, RoomTopZ - 0.005f }, Vector3{ -0.50f, 0.90f, RoomTopZ - 0.005f }, 3);
}

void RayTracingSolver::AppendTriangle(const Vector3& v0, const Vector3& v1, const Vector3& v2, uint32_t MaterialIdx) noexcept
{
    TriangleGeometry Tri{};
    Tri.VertexAlpha    = v0;
    Tri.VertexBeta     = v1;
    Tri.VertexGamma    = v2;
    Vector3 Edge1      = v1 - v0;
    Vector3 Edge2      = v2 - v0;
    Tri.SurfaceNormal  = OrientationClassifier::CrossProduct(Edge1, Edge2).Normalized();
    Tri.MaterialIndex  = MaterialIdx;
    Tri.TriangleIndex  = static_cast<uint32_t>(Triangles.size());
    Triangles.push_back(Tri);
}

void RayTracingSolver::AppendQuad(const Vector3& v0, const Vector3& v1, const Vector3& v2, const Vector3& v3, uint32_t MaterialIdx) noexcept
{
    // Quad formed of two triangles with CCW outward normal
    AppendTriangle(v0, v1, v2, MaterialIdx);
    AppendTriangle(v0, v2, v3, MaterialIdx);
}

void RayTracingSolver::AppendBox(const Vector3& Center, const Vector3& Extents, float RotationDegrees, uint32_t MaterialIdx) noexcept
{
    // Z-up: the box is rotated about the vertical (+Z) axis; Extents = half-sizes (X, Y, Z).
    float Rad = RotationDegrees * 3.14159265359f / 180.0f;
    float CosAngle = std::cos(Rad);
    float SinAngle = std::sin(Rad);

    auto RotateZ = [CosAngle, SinAngle](const Vector3& p) -> Vector3
    {
        return Vector3{ p.x * CosAngle - p.y * SinAngle, p.x * SinAngle + p.y * CosAngle, p.z };
    };

    float hx = Extents.x;
    float hy = Extents.y;
    float hz = Extents.z;

    Vector3 Corners[8] = {
        Center + RotateZ(Vector3{ -hx, -hy, -hz }), // 0: Bottom-Left-Front   (−X, −Y, −Z)
        Center + RotateZ(Vector3{  hx, -hy, -hz }), // 1: Bottom-Right-Front  (+X, −Y, −Z)
        Center + RotateZ(Vector3{  hx,  hy, -hz }), // 2: Bottom-Right-Back   (+X, +Y, −Z)
        Center + RotateZ(Vector3{ -hx,  hy, -hz }), // 3: Bottom-Left-Back    (−X, +Y, −Z)
        Center + RotateZ(Vector3{ -hx, -hy,  hz }), // 4: Top-Left-Front      (−X, −Y, +Z)
        Center + RotateZ(Vector3{  hx, -hy,  hz }), // 5: Top-Right-Front     (+X, −Y, +Z)
        Center + RotateZ(Vector3{  hx,  hy,  hz }), // 6: Top-Right-Back      (+X, +Y, +Z)
        Center + RotateZ(Vector3{ -hx,  hy,  hz })  // 7: Top-Left-Back       (−X, +Y, +Z)
    };

    // 6 faces, counter-clockwise seen from outside so the geometric normal points outward:
    // Top (+Z)
    AppendQuad(Corners[4], Corners[5], Corners[6], Corners[7], MaterialIdx);
    // Bottom (−Z)
    AppendQuad(Corners[3], Corners[2], Corners[1], Corners[0], MaterialIdx);
    // Front (−Y)
    AppendQuad(Corners[0], Corners[1], Corners[5], Corners[4], MaterialIdx);
    // Back (+Y)
    AppendQuad(Corners[2], Corners[3], Corners[7], Corners[6], MaterialIdx);
    // Left (−X)
    AppendQuad(Corners[3], Corners[0], Corners[4], Corners[7], MaterialIdx);
    // Right (+X)
    AppendQuad(Corners[1], Corners[2], Corners[6], Corners[5], MaterialIdx);
}

//------------------------------------------------------------------------------------------------------------------------
//                                           RAY-TRIANGLE INTERSECTION
//------------------------------------------------------------------------------------------------------------------------

HitIntersection RayTracingSolver::EvaluateIntersection(const RayStructure& Ray) const noexcept
{
    HitIntersection ClosestHit{};
    ClosestHit.RayDistance    = Ray.MaximumDistance;
    ClosestHit.ValidCondition = false;

    constexpr float Epsilon = 1e-7f;

    for (const auto& Tri : Triangles)
    {
        Vector3 Edge1 = Tri.VertexBeta - Tri.VertexAlpha;
        Vector3 Edge2 = Tri.VertexGamma - Tri.VertexAlpha;

        Vector3 PVec = OrientationClassifier::CrossProduct(Ray.RayDirection, Edge2);
        float Det = OrientationClassifier::DotProduct(Edge1, PVec);

        if (std::abs(Det) < Epsilon)
        {
            continue;
        }

        float InvDet = 1.0f / Det;
        Vector3 TVec = Ray.SpatialOrigin - Tri.VertexAlpha;
        float u = OrientationClassifier::DotProduct(TVec, PVec) * InvDet;

        if (u < 0.0f || u > 1.0f)
        {
            continue;
        }

        Vector3 QVec = OrientationClassifier::CrossProduct(TVec, Edge1);
        float v = OrientationClassifier::DotProduct(Ray.RayDirection, QVec) * InvDet;

        if (v < 0.0f || (u + v) > 1.0f)
        {
            continue;
        }

        float t = OrientationClassifier::DotProduct(Edge2, QVec) * InvDet;

        if (t >= Ray.MinimumDistance && t < ClosestHit.RayDistance)
        {
            ClosestHit.RayDistance    = t;
            ClosestHit.HitLocation    = Ray.SpatialOrigin + Ray.RayDirection * t;
            ClosestHit.SurfaceNormal  = Tri.SurfaceNormal;
            ClosestHit.MaterialIndex  = Tri.MaterialIndex;
            ClosestHit.TriangleIndex  = Tri.TriangleIndex;
            ClosestHit.ValidCondition = true;
        }
    }

    return ClosestHit;
}

bool RayTracingSolver::EvaluateOcclusion(const Vector3& PointA, const Vector3& PointB) const noexcept
{
    Vector3 Dir = PointB - PointA;
    float Distance = Dir.Length();
    if (Distance <= 1e-4f)
    {
        return false;
    }

    Vector3 UnitDir = Dir / Distance;
    RayStructure ShadowRay{ PointA + UnitDir * 1e-4f, UnitDir, 1e-4f, Distance - 1e-4f };

    constexpr float Epsilon = 1e-7f;

    for (const auto& Tri : Triangles)
    {
        // Don't let light quad occlude itself
        if (Tri.MaterialIndex == 3)
        {
            continue;
        }

        Vector3 Edge1 = Tri.VertexBeta - Tri.VertexAlpha;
        Vector3 Edge2 = Tri.VertexGamma - Tri.VertexAlpha;

        Vector3 PVec = OrientationClassifier::CrossProduct(ShadowRay.RayDirection, Edge2);
        float Det = OrientationClassifier::DotProduct(Edge1, PVec);

        if (std::abs(Det) < Epsilon)
        {
            continue;
        }

        float InvDet = 1.0f / Det;
        Vector3 TVec = ShadowRay.SpatialOrigin - Tri.VertexAlpha;
        float u = OrientationClassifier::DotProduct(TVec, PVec) * InvDet;

        if (u < 0.0f || u > 1.0f)
        {
            continue;
        }

        Vector3 QVec = OrientationClassifier::CrossProduct(TVec, Edge1);
        float v = OrientationClassifier::DotProduct(ShadowRay.RayDirection, QVec) * InvDet;

        if (v < 0.0f || (u + v) > 1.0f)
        {
            continue;
        }

        float t = OrientationClassifier::DotProduct(Edge2, QVec) * InvDet;

        if (t >= ShadowRay.MinimumDistance && t <= ShadowRay.MaximumDistance)
        {
            return true; // Occluded
        }
    }

    return false;
}

} // namespace Frontier::ProjectZero
