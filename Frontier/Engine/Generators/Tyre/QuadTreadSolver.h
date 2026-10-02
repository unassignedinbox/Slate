//============================================================================================================================================
//                                                            QUADTREADSOLVER.H
//============================================================================================================================================
// 📦 Quad tread modelling: one pattern tile traced by a conforming quad grid, aligned to the crown, arrayed per pitch, gaps bridged.

#pragma once

#include <cstdint>

#include "TreadSpecification.h"
#include "TyreMeshStructure.h"

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                      SPECIFICATION
//------------------------------------------------------------------------------------------------------------------------

/// 📦 One tread pattern tile as vector bands: rib, circumferential grooves, chevron lugs, sipes.
/// note  💡 This is the 1:1 port of References/QuadTreadModelling.html. The tread is modelled, never
///       displaced — there is no height map, no raster probe, no boolean stage. The pattern is a set of
///       lateral regions crossed with circumferential bands, and the grid lines sit exactly on the feature
///       edges, so every groove wall is traced by quad edges rather than approximated by them.
/// tag   schema
struct QuadTreadSpecification
{
    float    PitchCount        = 64.0f;   // [-]    - tiles around the wheel; pitch = circumference / this, exact by construction
    float    GapFraction       = 0.30f;   // [-]    - share of one pitch left between tiles, bridged by step 4
    float    ChevronAngle      = 38.0f;   // [deg]  - lateral grooves slant by shearing each column, V pointing forward
    float    RibWidth          = 30.0f;   // [mm]   - continuous centre rib, 0 removes it
    float    GrooveWidth       = 9.0f;    // [mm]   - circumferential groove each side of the rib, 0 removes it
    float    CentreWidth       = 8.0f;    // [mm]   - circumferential groove splitting the rib, 0 removes it
    float    SipeCount         = 1.0f;    // [-]    - thin cuts across each lug block, 0 to 3
    float    SipeWidth         = 1.6f;    // [mm]   - width of one sipe
    float    SipeDepthFraction = 0.6f;    // [-]    - sipe floor as a fraction of tread depth
    float    ShoulderLength    = 14.0f;   // [mm]   - lateral reach of the shoulder roundover
    float    ShoulderDrop      = 4.0f;    // [mm]   - radius lost across the roundover
    bool     Skirt             = true;    // [-]    - wall of quads hanging off the two tread edges

    [[nodiscard]] bool IsValid() const noexcept
    {
        return PitchCount >= 3.0f && GapFraction > 0.0f && GapFraction < 1.0f
            && ChevronAngle >= 0.0f && ChevronAngle < 90.0f
            && RibWidth >= 0.0f && GrooveWidth >= 0.0f && CentreWidth >= 0.0f
            && SipeCount >= 0.0f && SipeWidth > 0.0f
            && SipeDepthFraction > 0.0f && SipeDepthFraction <= 1.0f
            && ShoulderLength >= 0.0f && ShoulderDrop >= 0.0f;
    }
};

/// 📦 Which step of the pipeline to build. The steps are the method, not a debug view: each one is the
///    previous mesh carried further, with identical topology.
/// tag   schema
enum class QuadTreadStage : uint8_t
{
    Trace  = 0,   // one tile, flat: the pattern outline traced by quads
    Align  = 1,   // the same tile bent over the crown bulge and along the circumference
    Array  = 2,   // the tile repeated PitchCount times at exact pitch spacing
    Bridge = 3    // identical boundary loops of neighbouring tiles joined with quads
};

/// 📦 What the solver produced, beyond the mesh itself.
/// tag   schema, diagnostic
struct QuadTreadMetrics
{
    uint32_t TileQuad    = 0u;    // [-]   - quads tracing the tiles themselves
    uint32_t BridgeQuad  = 0u;    // [-]   - quads bridging the gaps between tiles (material group 1)
    uint32_t TileCount   = 0u;    // [-]   - tiles built for the requested stage
    float    PitchLength = 0.0f;  // [mm]  - circumference / PitchCount
};

//------------------------------------------------------------------------------------------------------------------------
//                                                         SOLVER
//------------------------------------------------------------------------------------------------------------------------

/// 📦 Builds the tread band: trace one tile with quads, align it to the crown, array it per pitch, bridge the gaps.
/// in    Carcass   [-]  marked size and crown shaping; Width, Aspect, Rim, TreadDepth, TreadFraction, Crown are read
/// in    Pattern   [-]  the tile description above
/// in    Stage     [-]  how far along the pipeline to build
/// out   Mesh      [-]  cleared and filled; positions welded, every face recorded as a quad
/// out   QuadTreadMetrics  face counts per set and the pitch
/// cost  🚩
/// note  💡 Watertightness is structural, not repaired. Grid columns sit on the lateral feature edges, grid
///       rows sit on the block/sipe/gap edges, each column is sheared by the chevron angle so slanted walls
///       are traced exactly, and walls are split at the sipe depth so every edge loop is conforming. After
///       Bridge the only boundary edges are the two lateral rims — the band is tread only, by design.
/// note  ⚠️ The wrap at θ = 2π is closed by welding, never by index arithmetic, the same discipline as
///       TreadMeshProof: the seam is tested, not assumed.
/// note  Bridge quads are emitted with material group 1, tile quads with group 0, so a viewer can tint the
///       bridging the way the reference page does.
/// tag   api, allocating, nonthrowing
[[nodiscard]] QuadTreadMetrics SolveQuadTread(const TreadSpecification&     Carcass,
                                              const QuadTreadSpecification& Pattern,
                                              QuadTreadStage                Stage,
                                              TyreMeshStructure&            Mesh) noexcept;

}   // namespace Frontier
