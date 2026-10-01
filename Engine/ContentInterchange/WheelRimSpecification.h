//============================================================================================================================================
//                                                    WHEELRIMSPECIFICATION.H
//============================================================================================================================================
// 🧩 Procedural wheel-rim (mag) synthesis — parameters in, one single-shell manifold surface out. No tyre: barrel +
//    face + spokes only, plus optional hardware (lug nuts, centre cap) as their own closed shells.
//
// Topology contract (the whole point of this module): the rim body is ONE connected, closed, orientation-consistent
//    two-manifold. Spokes are not separate solids dropped onto a disc and they are not boolean unions of overlapping
//    primitives — the face is a single swept sheet whose silhouette comes from a smooth-minimum scalar contour, and
//    the barrel is the same sheet continued around the cross-section curve. Windows between spokes are handles cut
//    through that one sheet (front sheet ↔ wall band ↔ back sheet), so every edge is shared by exactly two triangles
//    and `RimSurfaceAudit` reports ShellCount = 1, BoundaryEdges = 0 for the body. Genus is whatever the window /
//    bore / lug-hole count implies; connectivity is always one.
//
// Construction order (all in metres, local frame: rotation axis = +Z, outboard face looks toward +Z, mounting pad on
//    the −Z side; CLAUDE.md §7 RH Z-up — the placement that bolts this onto a hub supplies the lateral rotation):
//        ① SectionContour   — the blank-rim cross-section (r,z) polyline: flange tip ⇒ bead seat ⇒ drop well ⇒
//                             inboard flange, rounded at each knot, resampled by arc length. Fully overridable by
//                             the caller (`SectionKnots`) — this is the "curve for the cross-section of the blank".
//        ② SpokeContour     — signed scalar ϕ(r,θ) over the face: smooth-union of hub disc, outer band and N spoke
//                             bars (taper · sweep · twist · split · weave), smooth-subtract of bore, lug holes and
//                             valve hole. ϕ = 0 is the window silhouette; the smooth-minimum radius is the casting
//                             fillet where a spoke grows out of the hub and into the lip.
//        ③ FaceSheet        — polar lattice over ϕ > 0, boundary vertices snapped onto ϕ = 0, swept to a front and a
//                             back height surface (dish · concavity · crown · pad thickness · back relief pockets).
//        ④ WindowWall       — rounded bevel band stitching front sheet to back sheet along every ϕ = 0 contour.
//        ⑤ BarrelSweep      — ① revolved around +Z, its two open ends welded to the face sheet's outer rings.
//        ⑥ Hardware         — lug nuts (hex / spline, conical · ball · flat seat) and centre cap, each a closed shell.
//
// Units are automotive on the way in (inch diameter, inch width, millimetre offset / PCD / bore) and strictly metres
//    on the way out. Nothing here touches Vulkan, glTF or MaterialDescriptor — `WheelRimStructure` is the engine seam.

#pragma once

#include <cstdint>
#include <string>
#include <vector>

namespace Frontier {

//------------------------------------------------------------------------------------------------------------------------
//                                                     ENUMERATIONS
//------------------------------------------------------------------------------------------------------------------------

// Silhouette family of the spoke bars. Deliberately no three-pronged "Y" bar: every family is a radial run whose
//    junctions with the hub and the outer band are smooth-minimum fillets, never a bifurcating skeleton.
enum class SpokeContourCategory : uint32_t
{
    Straight = 0,   // single tapered radial bar per sector — forged monoblock look
    Split    = 1,   // one root that opens into two parallel tips (shared root ⇒ still one contour)
    Twisted  = 2,   // straight bar with a constant angular sweep: directional / turbine lean
    Turbine  = 3,   // broad one-sided bar, narrow slot windows, strong lean
    Weave    = 4,   // two counter-swept families crossing at mid radius: mesh / lattice face
    Dished   = 5,   // narrow root fanning into a wide tip that merges along the outer band
};

// Lug seat geometry — matches the countersink milled into the face and the mating surface of the nut.
enum class LugSeatCategory : uint32_t { Conical = 0, Ball = 1, Flat = 2 };

// Lug hardware silhouette.
enum class LugNutCategory : uint32_t { Hex = 0, Spline = 1, Capped = 2 };

// Finish recipes resolved into OpenPBR slab scalars by `QueryFinishRecipe`.
enum class RimFinishCategory : uint32_t
{
    GlossPaint      = 0,   // pigmented base + clear coat
    SatinGraphite   = 1,   // low-gloss dark grey, faint coat
    PolishedAlloy   = 2,   // mirror aluminium
    BrushedAlloy    = 3,   // anisotropic aluminium
    MachinedFace    = 4,   // diamond-cut: bright metal with lathe anisotropy
    Chrome          = 5,
    BronzeAnodised  = 6,
    MatteBlack      = 7,
    GoldAnodised    = 8,
    SteelHardware   = 9,
};

// Whole-wheel starting points. Each one only writes parameters; every field stays individually overridable.
enum class RimPresetCategory : uint32_t
{
    ForgedFiveSpoke   = 0,   // 20×9.5 ET35, five tapered bars, machined face + gloss pockets
    SplitTenSpoke     = 1,   // 19×8.5 ET42, five split roots ⇒ ten tips, satin graphite
    TwentySpokeWeave  = 2,   // 21×10 ET30, counter-swept mesh, polished
    TurbineAero       = 3,   // 18×8 ET45, broad leaning blades, gloss paint
    DeepDishConcave   = 4,   // 20×11 ET15, deep concave dish, polished lip + black face
    HeavyDutySixSpoke = 5,   // 17×8 ET0 truck wheel, six broad bars, matte black, six lugs
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   CROSS-SECTION KNOT
//------------------------------------------------------------------------------------------------------------------------
// One corner of the blank-rim cross-section, in the half-plane (r, z) of the revolution: r = radius from the spin
//    axis, z = axial position (+Z outboard). `Rounding` is the fillet radius inserted at that corner; 0 keeps it
//    sharp. The polyline is open and runs outboard-attachment ⇒ outboard flange ⇒ bead seats ⇒ well ⇒ inboard flange
//    ⇒ inboard-attachment: the two ends are welded to the face sheet, which is what closes the shell.

struct SectionKnot
{
    float Radius    = 0.0f;   // [m]
    float Axial     = 0.0f;   // [m]
    float Rounding  = 0.0f;   // [m] corner fillet radius
    uint8_t Finish  = 0u;     // [idx] 0 = barrel interior, 1 = lip / outer visible, 2 = bead seat & well
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   RIM PARAMETERS
//------------------------------------------------------------------------------------------------------------------------

struct WheelRimParameters
{
    // ── Nominal size (automotive units in, metres out) ───────────────────────────────────────────────────────────
    float DiameterInch              = 20.0f;   // [in]  bead-seat (nominal) diameter
    float WidthInch                 = 9.5f;    // [in]  bead-seat width, flange face to flange face
    float OffsetMillimetre          = 35.0f;   // [mm]  ET: mounting pad relative to the barrel centre plane (+ outboard)
    float FlangeHeightMillimetre    = 17.3f;   // [mm]  J-flange height above the bead seat
    float FlangeThicknessMillimetre = 6.0f;    // [mm]  axial thickness of the flange tip
    float BarrelWallMillimetre      = 5.5f;    // [mm]  barrel wall thickness
    float WellDepthMillimetre       = 24.0f;   // [mm]  drop-well depth below the bead seat
    float WellOffsetFraction        = 0.62f;   // [-]   axial centre of the well, 0 = outboard flange, 1 = inboard
    float WellWidthFraction         = 0.34f;   // [-]   well width as a fraction of the barrel width
    float BeadSeatTaperDegrees      = 5.0f;    // [deg] standard 5° bead seat taper

    // ── Cross-section override: when non-empty this polyline replaces the derived J-section verbatim ─────────────
    std::vector<SectionKnot> SectionKnots;     // [m]   open (r,z) contour, outboard end first
    uint32_t SectionSamples         = 160u;    // [cnt] arc-length samples taken along the contour
    float    SectionSmoothing       = 0.0f;    // [-]   0 = honour knots, 1 = full Catmull-Rom relaxation of the knots

    // ── Face plate ───────────────────────────────────────────────────────────────────────────────────────────────
    float HubRadiusFraction         = 0.30f;   // [-]   hub disc radius ÷ inner barrel radius
    float OuterBandFraction         = 0.055f;  // [-]   width of the solid band at the lip ÷ inner barrel radius
    float PadThicknessMillimetre    = 18.0f;   // [mm]  hub pad thickness (mounting face ⇒ hub front)
    float SpokeThicknessMillimetre  = 13.0f;   // [mm]  spoke thickness at mid span
    float LipThicknessMillimetre    = 9.0f;    // [mm]  face thickness where it meets the barrel
    float DishMillimetre            = 26.0f;   // [mm]  axial drop from the lip attachment to the hub front (+ = concave)
    float ConcavityPower            = 1.85f;   // [-]   1 = straight cone, >1 = concave sweep, <1 = convex bulge
    float CrownMillimetre           = 2.6f;    // [mm]  convex crown across the spoke width
    float BackReliefMillimetre      = 4.5f;    // [mm]  material removed from the spoke back (casting relief pockets)
    float FilletMillimetre          = 11.0f;   // [mm]  smooth-minimum radius: spoke⇒hub and spoke⇒band junctions
    float BevelMillimetre           = 2.8f;    // [mm]  rounded bevel band along every window edge
    uint32_t BevelBands             = 3u;      // [cnt] rings across that bevel (2 = chamfer, 4+ = soft fillet)

    // ── Spokes ───────────────────────────────────────────────────────────────────────────────────────────────────
    SpokeContourCategory SpokeContour = SpokeContourCategory::Straight;
    uint32_t SpokeCount             = 5u;      // [cnt] bars (Split doubles the tips, Weave doubles the families)
    float SpokeRootWidthMillimetre  = 62.0f;   // [mm]  bar width at the hub
    float SpokeTipWidthMillimetre   = 34.0f;   // [mm]  bar width at the outer band
    float SpokeTaperPower           = 1.4f;    // [-]   >1 holds the root width longer before tapering
    float SpokeSweepDegrees         = 0.0f;    // [deg] total angular lean from root to tip
    float SpokeTwistDegrees         = 0.0f;    // [deg] axial twist of the crown across the span (directional look)
    float SpokeSplitDegrees         = 7.0f;    // [deg] half-angle the Split family opens to at the tip
    float SpokePhaseDegrees         = 0.0f;    // [deg] rotation of the whole spoke set

    // ── Hub, bore, lugs, valve ───────────────────────────────────────────────────────────────────────────────────
    float CentreBoreMillimetre      = 72.6f;   // [mm]  bore diameter
    float BoreChamferMillimetre     = 2.0f;    // [mm]  chamfer at the bore mouth
    uint32_t LugCount               = 5u;      // [cnt] 0 disables lug holes and hardware
    float LugCircleMillimetre       = 114.3f;  // [mm]  PCD
    float LugHoleMillimetre         = 14.2f;   // [mm]  through-hole diameter
    LugSeatCategory LugSeat         = LugSeatCategory::Conical;
    float LugSeatAngleDegrees       = 60.0f;   // [deg] included angle of the conical seat
    float LugSeatDepthMillimetre    = 6.0f;    // [mm]  depth of the countersink
    float LugPhaseDegrees           = 0.0f;    // [deg] rotation of the bolt circle
    bool  ValveHole                 = true;    // [-]   one valve-stem hole through the face
    float ValveHoleMillimetre       = 11.5f;   // [mm]
    float ValveRadiusFraction       = 0.72f;   // [-]   radial placement of the valve hole

    // ── Hardware ─────────────────────────────────────────────────────────────────────────────────────────────────
    bool  GenerateLugNuts           = true;
    LugNutCategory LugNut           = LugNutCategory::Hex;
    float LugNutFlatsMillimetre     = 19.0f;   // [mm]  across-flats of the hex (or spline tip circle)
    float LugNutHeightMillimetre    = 24.0f;   // [mm]
    float LugNutChamferMillimetre   = 2.2f;    // [mm]  top chamfer
    float LugNutProudMillimetre     = 1.5f;    // [mm]  how far the seat sits proud of the countersink bottom
    bool  GenerateCentreCap         = true;
    float CentreCapRadiusFraction   = 0.56f;   // [-]   cap radius ÷ hub disc radius
    float CentreCapDomeMillimetre   = 6.0f;    // [mm]  dome height above the hub front

    // ── Finishes ─────────────────────────────────────────────────────────────────────────────────────────────────
    RimFinishCategory FaceFinish     = RimFinishCategory::MachinedFace;
    RimFinishCategory PocketFinish   = RimFinishCategory::GlossPaint;     // window walls / back / inner barrel
    RimFinishCategory LipFinish      = RimFinishCategory::PolishedAlloy;  // outer barrel + flange
    RimFinishCategory HardwareFinish = RimFinishCategory::SteelHardware;
    RimFinishCategory CapFinish      = RimFinishCategory::SatinGraphite;
    float FacePaint[3]               = { 0.055f, 0.057f, 0.062f };        // [-] linear Rec.709 tint for pigmented finishes
    float PocketPaint[3]             = { 0.022f, 0.022f, 0.024f };

    // ── Tessellation ─────────────────────────────────────────────────────────────────────────────────────────────
    uint32_t AngularSegments        = 512u;    // [cnt] segments around the spin axis (face lattice and barrel share it)
    uint32_t RadialSegments         = 110u;    // [cnt] rings across the face plate
    uint32_t HardwareSegments       = 48u;     // [cnt] segments around one lug nut / cap
    float    CreaseDegrees          = 38.0f;   // [deg] corner-normal averaging threshold

    // Overwrites every field with a named starting point.
    static WheelRimParameters FromPreset(RimPresetCategory Preset) noexcept;

    // Clamps anything out of range (negative widths, impossible bore vs PCD, zero segments). Returns a human-readable
    //    note when something was adjusted, empty when the record was already sane.
    std::string Normalise() noexcept;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   FINISH RECIPE
//------------------------------------------------------------------------------------------------------------------------
// OpenPBR slab scalars for one finish. `WheelRimStructure` copies these straight into MaterialSlabDescriptor; keeping
//    them here means the generator can be unit-tested, previewed and exported without the engine material stack.

struct RimFinishRecipe
{
    const char* Name                 = "finish";
    float BaseColor[3]               = { 0.8f, 0.8f, 0.8f };
    float Metalness                  = 0.0f;
    float SpecularRoughness          = 0.3f;
    float SpecularAnisotropy         = 0.0f;   // + = tangential (lathe / brush) streaking
    float SpecularColor[3]           = { 1.0f, 1.0f, 1.0f };   // F82 tint for metals
    float CoatWeight                 = 0.0f;
    float CoatRoughness              = 0.03f;
    float DiffuseRoughness           = 0.0f;
    float HazinessWeight             = 0.0f;   // slate_ second specular lobe: orange peel / clear-coat haze
    float HazinessRoughness          = 0.55f;
};

[[nodiscard]] RimFinishRecipe QueryFinishRecipe(RimFinishCategory Finish) noexcept;

//------------------------------------------------------------------------------------------------------------------------
//                                                   SURFACE PAYLOAD
//------------------------------------------------------------------------------------------------------------------------
// Positions are welded (shared between every triangle that touches them) so the manifold audit is meaningful; normals
//    and texcoords are per corner because a crease-aware normal differs per incident triangle at a bevel edge, and
//    because the engine's TriangleIndex soup wants corner attributes anyway.

enum class RimSurfaceSlot : uint32_t
{
    FaceFront  = 0,   // visible spoke / hub tops and the countersinks
    WindowWall = 1,   // window bevels, bore tube, lug tubes, back of the plate
    Lip        = 2,   // outer barrel, flange, bead seats — the polished surfaces
    BarrelBore = 3,   // barrel interior (unseen side of the well)
    Hardware   = 4,   // lug nuts
    CentreCap  = 5,
    Count      = 6,
};

struct RimPartSpan
{
    std::string Name;
    uint32_t    FirstTriangle = 0u;
    uint32_t    TriangleCount = 0u;
};

struct RimSurfaceAudit
{
    uint32_t VertexCount      = 0u;
    uint32_t TriangleCount    = 0u;
    uint32_t ShellCount       = 0u;   // connected components over shared vertices; the body alone must report 1
    uint32_t BoundaryEdges    = 0u;   // edges used once  — must be 0
    uint32_t NonManifoldEdges = 0u;   // edges used > 2   — must be 0
    uint32_t FlippedEdges     = 0u;   // edges whose two uses agree in direction — must be 0
    uint32_t DegenerateFaces  = 0u;
    double   SignedVolume     = 0.0;  // [m³] > 0 ⇒ outward orientation
    double   SurfaceArea      = 0.0;  // [m²]

    [[nodiscard]] bool Watertight() const noexcept { return BoundaryEdges == 0u && NonManifoldEdges == 0u && FlippedEdges == 0u; }
};

struct RimSurface
{
    std::vector<float>    Positions;        // 3 per vertex [m]
    std::vector<uint32_t> Corners;          // 3 per triangle, indices into Positions
    std::vector<float>    CornerNormals;    // 9 per triangle
    std::vector<float>    CornerTexcoords;  // 6 per triangle
    std::vector<uint32_t> Slots;            // 1 per triangle, RimSurfaceSlot
    std::vector<RimPartSpan> Parts;         // "RimBody", "LugNut.0" …

    [[nodiscard]] uint32_t QueryTriangleCount() const noexcept { return static_cast<uint32_t>(Corners.size() / 3u); }
    [[nodiscard]] uint32_t QueryVertexCount()   const noexcept { return static_cast<uint32_t>(Positions.size() / 3u); }

    // Topology report over a triangle range (whole payload when Count = 0xFFFFFFFF).
    [[nodiscard]] RimSurfaceAudit Audit(uint32_t FirstTriangle = 0u, uint32_t Count = 0xFFFFFFFFu) const noexcept;

    // Wavefront OBJ dump (positions + normals + texcoords, one group per part). Diagnostics only.
    [[nodiscard]] bool WriteWavefront(const std::string& Path, std::string* Error) const noexcept;
};

//------------------------------------------------------------------------------------------------------------------------
//                                                 WHEEL RIM SPECIFICATION
//------------------------------------------------------------------------------------------------------------------------

class WheelRimSpecification
{
public:
    // Synthesises the surface. The first part span is always the rim body (one shell); hardware follows.
    [[nodiscard]] static RimSurface Synthesise(const WheelRimParameters& Parameters) noexcept;

    // The resolved cross-section contour actually used by Synthesise — derived J-section, or the caller's knots,
    //    rounded and resampled. Exposed so a tool can draw and edit the curve.
    [[nodiscard]] static std::vector<SectionKnot> ResolveSection(const WheelRimParameters& Parameters) noexcept;

    // Signed face contour ϕ(r,θ) [m] used for the spoke silhouette: > 0 solid, 0 the window edge. Exposed so a tool
    //    can preview the face pattern as a 2D field before tessellating.
    [[nodiscard]] static float SampleFaceContour(const WheelRimParameters& Parameters, float Radius, float Angle) noexcept;
};

} // namespace Frontier
