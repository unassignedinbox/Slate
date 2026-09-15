//============================================================================================================================================
//                                                      ROCKFORMATIONSPACE.H
//============================================================================================================================================
// 🧩 Formation-aware SDF volume for AAA lithic detail (C++ twin of RockFormation.slang + the Web demo GLSL).
//    One continuous signed-distance field driven by hardcoded lithology presets — no tilable textures, no ad-hoc noise.
//    See GeologicalRockSculpt/Research.md §7 and Design.md §3 for the formation → SDF mapping.
//    Usage: evaluate per-point `Assess(p)` for physics / meshing / shading; sculpt via `ApplyBrush`.

#pragma once

#if defined(_MSC_VER)
    #pragma warning(disable: 4324)
#endif

#include "RockFormationSpecification.h"
#include <cstdint>
#include <vector>
#include <cmath>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                    VECTOR HELPERS (header-only, no Engine deps)
//------------------------------------------------------------------------------------------------------------------------

struct Vector3 { float x, y, z; };
struct Vector2 { float x, y; };
inline Vector3 operator+(Vector3 a, Vector3 b) noexcept { return {a.x+b.x, a.y+b.y, a.z+b.z}; }
inline Vector3 operator-(Vector3 a, Vector3 b) noexcept { return {a.x-b.x, a.y-b.y, a.z-b.z}; }
inline Vector3 operator*(Vector3 a, float s) noexcept { return {a.x*s, a.y*s, a.z*s}; }
inline float   Dot(Vector3 a, Vector3 b) noexcept { return a.x*b.x + a.y*b.y + a.z*b.z; }
inline float   Length(Vector3 a) noexcept { return std::sqrt(Dot(a,a)); }
inline Vector3 Normalise(Vector3 a) noexcept { float L = Length(a); return L>1e-8f ? a*(1.0f/L) : Vector3{0,0,1}; }

//------------------------------------------------------------------------------------------------------------------------
//                                                    FIELD PRIMITIVES (hash / noise / fbm / voronoi)
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] float Hash21(Vector2 p) noexcept;
[[nodiscard]] float Hash33(Vector3 p) noexcept;
[[nodiscard]] float ValueNoise(Vector3 p) noexcept;
[[nodiscard]] float FractalBrownianMotion(Vector3 p) noexcept;          // 5 octaves, lacunarity ~2, no tile
[[nodiscard]] Vector3 DomainWarp(Vector3 p) noexcept;                   // formation fold field W(p), |W|<0.35
struct VoronoiSample { float Distance; float Border; Vector3 CellId; Vector3 Centre; };
[[nodiscard]] VoronoiSample Voronoi(Vector3 p, float Jitter = 1.0f) noexcept;
[[nodiscard]] VoronoiSample HexVoronoi(Vector2 p) noexcept;             // basalt columns on XZ

//------------------------------------------------------------------------------------------------------------------------
//                                                    SDF PRIMITIVES
//------------------------------------------------------------------------------------------------------------------------

[[nodiscard]] float SignedDistanceSphere(Vector3 p, float Radius) noexcept;
[[nodiscard]] float SignedDistanceRoundBox(Vector3 p, Vector3 HalfExtent, float Radius) noexcept;
[[nodiscard]] float SignedDistancePlane(Vector3 p, Vector3 Normal, float Offset) noexcept;
[[nodiscard]] float SignedDistanceSlab(Vector3 p, Vector3 Normal, float Thickness) noexcept;
[[nodiscard]] float SmoothMinimum(float A, float B, float K) noexcept;  // smin, K = blend radius
[[nodiscard]] float SmoothMaximum(float A, float B, float K) noexcept;  // smax
[[nodiscard]] float RoundOperation(float Distance, float Radius) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                    ROCK SAMPLE
//------------------------------------------------------------------------------------------------------------------------

struct RockSample
{
    float   Distance;           // [m] signed distance (negative inside)
    float   Hardness;           // [-] Mohs-scaled 0..1 (for erosion)
    float   Porosity;           // [-] 0..1
    float   BorderDistance;     // [m] distance to nearest Voronoi/joint face (for relief)
    float   Curvature;          // [-] Laplacian estimate
    Vector3 Albedo;             // [-] linear Rec.709
    float   Roughness;          // [-] GGX α = r²
    Vector3 Normal;             // [-] SDF gradient (valid only near surface)
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    BRUSH RECORD
//------------------------------------------------------------------------------------------------------------------------

enum class RockBrushCategory : uint32_t { Add = 0u, Remove = 1u, StrataCut = 2u, Fracture = 3u, Weather = 4u, Karst = 5u, Polish = 6u };

struct RockBrushRecord
{
    Vector3             Centre;             // [m] world centre
    float               Radius;             // [m] sphere radius
    Vector3             Normal;             // [-] hit normal (for planar brushes)
    RockBrushCategory   Category = RockBrushCategory::Remove;
    float               Strength = 1.0f;    // [-] blend / depth
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 ROCK FORMATION SPACE
//------------------------------------------------------------------------------------------------------------------------

class RockFormationSpace
{
public:
    RockFormationSpace() noexcept = default;
    ~RockFormationSpace() noexcept = default;

    void                AssignLithology(LithologyCategory C) noexcept { CurrentLithology = C; }
    [[nodiscard]] LithologyCategory QueryLithology() const noexcept { return CurrentLithology; }

    // Formation-aware signed distance of the hero rock (centred at Origin, extent ~1.2 m) + terrain + scree.
    [[nodiscard]] RockSample Assess(Vector3 PointWorld) const noexcept;
    [[nodiscard]] float      AssessDistance(Vector3 PointWorld) const noexcept { return Assess(PointWorld).Distance; }

    // Gradient / normal via tetrahedron (ε = 6e-4 m) — AAA surface detail needs tight epsilon.
    [[nodiscard]] Vector3    AssessNormal(Vector3 PointWorld) const noexcept;

    // Brush sculpting (circular buffer, 64 max; replayed in Assess). Thread-safe if externally locked.
    void                ApplyBrush(const RockBrushRecord& Brush) noexcept;
    void                ClearBrushes() noexcept { Brushes.clear(); }
    [[nodiscard]] uint32_t BrushCount() const noexcept { return static_cast<uint32_t>(Brushes.size()); }

    // Terrain heightfield: H(p.xy) used by Assess for the ground SDF.
    [[nodiscard]] float AssessTerrainHeight(Vector2 Planar) const noexcept;

private:
    [[nodiscard]] float FormationDistance(Vector3 LocalPoint) const noexcept;
    [[nodiscard]] RockSample FormationSample(Vector3 LocalPoint) const noexcept;
    [[nodiscard]] float TerrainDistance(Vector3 PointWorld) const noexcept;
    [[nodiscard]] float ApplyBrushesToDistance(float BaseDistance, Vector3 PointWorld) const noexcept;

    LithologyCategory           CurrentLithology = LithologyCategory::GraniteCore;
    std::vector<RockBrushRecord> Brushes;               // max 64, oldest discarded
    Vector3                     RockOrigin = {0.0f, 0.0f, 0.62f};  // [m] hero rock sits 0.62 m above terrain datum
    Vector3                     RockHalfExtent = {0.62f, 0.52f, 0.48f};

    static constexpr uint32_t   kMaxBrushCount = 64u;
    static constexpr float      kDomainWarpClamp = 0.35f;
};

} // namespace Frontier
