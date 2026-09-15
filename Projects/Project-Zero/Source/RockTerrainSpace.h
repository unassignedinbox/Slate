//============================================================================================================================================
// 📦 Project-Zero/Source/RockTerrainSpace.h — Formation-driven signed distance field for sculptable rock terrain
//============================================================================================================================================
// The field is not a material texture and does not repeat in a tile. It is a finite geological history evaluated in
// world space: deposition / cooling, lithologic weakness, fracture events, water and salt weathering, then sculpt strokes.

#pragma once

#include <cstdint>
#include <vector>

namespace Frontier::ProjectZero {

//------------------------------------------------------------------------------------------------------------------------
//                                                    ROCK VECTOR
//------------------------------------------------------------------------------------------------------------------------

struct RockTerrainVector3
{
    float x = 0.0f;
    float y = 0.0f;
    float z = 0.0f;
};

[[nodiscard]] RockTerrainVector3 operator+(RockTerrainVector3 A, RockTerrainVector3 B) noexcept;
[[nodiscard]] RockTerrainVector3 operator-(RockTerrainVector3 A, RockTerrainVector3 B) noexcept;
[[nodiscard]] RockTerrainVector3 operator*(RockTerrainVector3 A, float B) noexcept;
[[nodiscard]] RockTerrainVector3 operator/(RockTerrainVector3 A, float B) noexcept;
[[nodiscard]] float RockTerrainDot(RockTerrainVector3 A, RockTerrainVector3 B) noexcept;
[[nodiscard]] float RockTerrainLength(RockTerrainVector3 A) noexcept;
[[nodiscard]] RockTerrainVector3 RockTerrainNormalize(RockTerrainVector3 A) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                             GEOLOGICAL REGIME
//------------------------------------------------------------------------------------------------------------------------

// These are formation regimes, not cosmetic presets. Each one changes which physical event fields are active.
enum class RockFormationCategory : uint32_t
{
    Granite = 0,       // coarse mineral fabric, unloading sheets, joint-controlled spheroidal weathering
    Sandstone,          // bedding / cross-bedding, cement contrast, salt-driven cavernous weathering
    Basalt,             // cooling-front contraction, polygonal column joints, entablature irregularity
    Chert,              // fine silica fabric, impact cones and conchoidal fracture ripples
    Schist               // anisotropic foliation, sheared weakness and platy break-up
};

enum class RockBrushCategory : uint32_t
{
    AddMass = 0,
    RemoveMass,
    SmoothFormation,
    SharpenFracture
};

//------------------------------------------------------------------------------------------------------------------------
//                                             FIELD CONFIGURATION
//------------------------------------------------------------------------------------------------------------------------

struct RockTerrainConfiguration
{
    uint32_t                Seed                     = 0x71C3A91Du; // [-] deterministic geological history seed
    RockFormationCategory   Formation                = RockFormationCategory::Granite;

    float                   ExtentX                  = 15.0f;        // [m] finite field half-width
    float                   ExtentY                  = 15.0f;        // [m] finite field half-depth
    float                   Bottom                  = -4.0f;        // [m] buried extent
    float                   Height                  = 10.0f;        // [m] nominal exposed height

    float                   MacroErosion            = 0.55f;        // [m] long-time surface recession
    float                   BeddingSpacing          = 1.15f;        // [m] mean depositional bed spacing
    float                   BeddingVariation        = 0.42f;        // [m] bed thickness / dip variation
    float                   GrainScale               = 0.095f;       // [m] mineral grain characteristic scale
    float                   GrainRelief              = 0.018f;       // [m] grain-boundary relief at exposed faces

    float                   JointSpacing             = 2.6f;         // [m] mean stress-joint spacing
    float                   JointAperture            = 0.022f;       // [m] open crack width
    float                   JointDisplacement        = 0.11f;        // [m] occasional shear offset
    float                   ColumnScale              = 1.8f;         // [m] basalt cooling-cell scale

    float                   WaterExposure            = 0.68f;        // [-] wetting / drying access to the surface
    float                   SaltWeathering           = 0.62f;        // [-] crystallisation pressure contribution
    float                   FreezeThaw                = 0.38f;        // [-] frost-wedge contribution
    float                   Insolation                = 0.56f;        // [-] thermal cycling / sheltered-face contrast
    float                   WindAbrasion              = 0.24f;        // [-] directional sand abrasion
    float                   Porosity                  = 0.34f;        // [-] capillary transport potential

    float                   TafoniDensity             = 0.32f;        // [-] event probability, not a repeating hole texture
    float                   ConchoidalDensity         = 0.18f;        // [-] brittle impact / shell-fracture event probability
    float                   SpheroidalWeathering      = 0.44f;        // [-] corner and joint intersection recession
    float                   SurfaceDetail             = 1.0f;         // [-] continuous field detail gain

    uint32_t                ExtractionResolution      = 72u;         // [cells] CPU export / proxy extraction resolution
};

//------------------------------------------------------------------------------------------------------------------------
//                                               FIELD SAMPLE
//------------------------------------------------------------------------------------------------------------------------

struct RockTerrainSample
{
    float Distance                 = 1.0f;   // [m] negative inside solid, positive in air
    float FormationDistance        = 1.0f;   // [m] before sculpt strokes; used by SmoothFormation
    float Hardness                 = 0.5f;   // [-] local resistance to weathering
    float Grain                    = 0.5f;   // [-] mineral-scale structure
    float Bedding                  = 0.0f;   // [-] local depositional fabric
    float Fracture                 = 0.0f;   // [-] proximity to a mechanically weak crack
    float WaterFlux                = 0.0f;   // [-] capillary / runoff access
    float Salt                     = 0.0f;   // [-] salt concentration proxy
    float Oxidation                = 0.0f;   // [-] iron-bearing alteration proxy
    float Debris                   = 0.0f;   // [-] friable material / talus tendency
};

//------------------------------------------------------------------------------------------------------------------------
//                                                SCULPT STROKE
//------------------------------------------------------------------------------------------------------------------------

struct RockBrushStroke
{
    RockTerrainVector3 Center;               // [m] world-space brush centre
    float              Radius       = 0.5f; // [m]
    float              Strength     = 0.25f; // [m] signed displacement at the centre
    float              Hardness     = 0.65f; // [-] edge falloff exponent
    RockBrushCategory  Category     = RockBrushCategory::RemoveMass;
};

//------------------------------------------------------------------------------------------------------------------------
//                                             EXTRACTED SURFACE
//------------------------------------------------------------------------------------------------------------------------

struct RockTerrainVertex
{
    RockTerrainVector3 Position;             // [m]
    RockTerrainVector3 Normal;               // [-]
    float              Hardness = 0.5f;     // [-]
    float              Grain    = 0.5f;     // [-]
    float              Bedding  = 0.0f;     // [-]
    float              Fracture = 0.0f;     // [-]
    float              Salt     = 0.0f;     // [-]
    float              Oxidation = 0.0f;    // [-]
};

//------------------------------------------------------------------------------------------------------------------------
//                                             ROCK TERRAIN SPACE
//------------------------------------------------------------------------------------------------------------------------

class RockTerrainSpace
{
public:
    RockTerrainSpace() noexcept;
    explicit RockTerrainSpace(const RockTerrainConfiguration& InitialConfiguration) noexcept;
    ~RockTerrainSpace() noexcept = default;

    RockTerrainSpace(const RockTerrainSpace&) = delete;
    RockTerrainSpace& operator=(const RockTerrainSpace&) = delete;

    void                            AssignConfiguration(const RockTerrainConfiguration& NewConfiguration) noexcept;
    [[nodiscard]] const RockTerrainConfiguration& QueryConfiguration() const noexcept { return Configuration; }

    // Formation history is continuous and deterministic. No image, UV coordinate or tile period is involved.
    [[nodiscard]] RockTerrainSample Sample(RockTerrainVector3 Position) const noexcept;
    [[nodiscard]] float             Distance(RockTerrainVector3 Position) const noexcept { return Sample(Position).Distance; }

    void                            AddSculptStroke(const RockBrushStroke& Stroke) noexcept;
    [[nodiscard]] bool              UndoSculptStroke() noexcept;
    void                            ClearSculpting() noexcept;
    [[nodiscard]] uint32_t          QuerySculptStrokeCount() const noexcept { return static_cast<uint32_t>(SculptStrokes.size()); }

    // CPU extraction is for collision, export and authoring thumbnails. The live viewport is intended to sphere-trace
    // the same continuous field; extraction therefore never becomes the source of the geological detail.
    void                            ExtractSurface(std::vector<RockTerrainVertex>& Vertices,
                                                   std::vector<uint32_t>& Indices) const;

private:
    struct PocketEvent
    {
        RockTerrainVector3 Center;
        RockTerrainVector3 Axis;
        float              Radius;
        float              Aspect;
        float              Exposure;
        float              CementContrast;
    };

    struct FractureEvent
    {
        RockTerrainVector3 Origin;
        RockTerrainVector3 Normal;
        RockTerrainVector3 Tangent;
        float              HalfLength;
        float              Aperture;
        float              Displacement;
        float              Weakness;
    };

    struct ImpactEvent
    {
        RockTerrainVector3 Center;
        RockTerrainVector3 Normal;
        float              Radius;
        float              Energy;
    };

    RockTerrainConfiguration       Configuration;
    std::vector<PocketEvent>       PocketEvents;
    std::vector<FractureEvent>     FractureEvents;
    std::vector<ImpactEvent>      ImpactEvents;
    std::vector<RockBrushStroke>  SculptStrokes;

    void                            RebuildGeologicalEvents() noexcept;
    [[nodiscard]] RockTerrainSample SampleFormation(RockTerrainVector3 Position) const noexcept;
    [[nodiscard]] RockTerrainSample ApplySculpting(RockTerrainVector3 Position, RockTerrainSample Sample) const noexcept;
};

} // namespace Frontier::ProjectZero
