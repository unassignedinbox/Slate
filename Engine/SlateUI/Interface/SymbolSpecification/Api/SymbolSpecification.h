//============================================================================================================================================
//                                                         SYMBOLSPECIFICATION.H
//============================================================================================================================================
// 🧩 Stroke figures declared in a 24-unit square, enrolled by discipline — no raster, no store, no vendor library.

#pragma once

#include <cstdint>

namespace Slate
{

//------------------------------------------------------------------------------------------------------------------------
//                                                      THE DISCIPLINES
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 The working discipline a figure belongs to. Every figure is enrolled in exactly one.
/// note  🔴 `Geometry` and not `Modelling`: `Model` is a banned structural word and the ban has no carve-out
///       for the participle. `Assembly` and not `Compositing`, for the same reason.
/// note  The enrolment is a property of the **figure**, not of where it is presented. A magnifier is a
///       navigation figure wherever it is drawn.
/// tag   contract
enum class SymbolDiscipline : std::uint32_t
{
    Workspace            =  0u,   // [-] - the shell itself: folders, arrangements, panels
    Navigation           =  1u,   // [-] - traversal: chevrons, magnifier, crosshair
    Geometry             =  2u,   // [-] - polygonal modelling: vertices, edges, faces, booleans
    ComputerAidedDesign  =  3u,   // [-] - constrained sketching, revolution, fillet, loft
    Sculpting            =  4u,   // [-] - bristles, inflation, relaxation, remesh density
    Texturing            =  5u,   // [-] - unwrap seams, material spheres, channels, stencils
    Illumination         =  6u,   // [-] - directional, point, area and dome emitters
    Rendering            =  7u,   // [-] - aperture, convergence, denoise, exposure
    Animation            =  8u,   // [-] - key ordinates, tangents, scrub, joints
    Simulation           =  9u,   // [-] - cloth, fluid, rigid collision, particles
    Assembly             = 10u,   // [-] - layer merge, alpha masks, colour, junction graphs
    Measurement          = 11u,   // [-] - pulse traces, rulers, histograms, readouts
    DisciplineCount      = 12u    // [-] - the closed count, never a discipline
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE SUBJECTS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 Every figure the interface may ask for, ordered by discipline.
/// note  🚧 Only the seven the source actually draws carry declared artwork. Every other subject resolves to
///       `PlaceholderMark` at the correct extent, so the roster may be filled in later without a single
///       layout moving. That is the whole reason the extents are exact now and the artwork is not.
/// tag   contract
enum class SymbolSubject : std::uint32_t
{
    // Workspace ---------------------------------------------------------------------------------------------
    FolderClosed        =  0u,   // 🟢 lucide `folder`     — the Asset Browser tongue
    LatticeArrangement  =  1u,   // 🟢 lucide `grid-3x3`   — the lattice toggle
    ColumnArrangement   =  2u,   // 🟢 lucide `list`       — the column toggle
    PanelSplit          =  3u,   // 🚧
    PersistDisc         =  4u,   // 🚧
    BulbFilament        =  5u,   // 🟢 lucide `lightbulb`  — the tooltip trigger

    // Navigation --------------------------------------------------------------------------------------------
    ChevronDown         =  6u,   // 🟢 lucide `chevron-down`
    ChevronRight        =  7u,   // 🟢 lucide `chevron-right`
    MagnifierLens       =  8u,   // 🟢 lucide `search`
    ArrowReturn         =  9u,   // 🚧
    CrosshairCentre     = 10u,   // 🚧

    // Geometry ----------------------------------------------------------------------------------------------
    VertexPoint         = 11u,   // 🚧
    EdgeSegment         = 12u,   // 🚧
    FacePlanar          = 13u,   // 🚧
    SubdivisionStep     = 14u,   // 🚧
    ExtrudeSpan         = 15u,   // 🚧
    BevelChamfer        = 16u,   // 🚧
    BooleanUnion        = 17u,   // 🚧
    MirrorAxis          = 18u,   // 🚧

    // Computer-aided design ---------------------------------------------------------------------------------
    SketchPlane         = 19u,   // 🚧
    ConstraintDimension = 20u,   // 🚧
    FilletRadius        = 21u,   // 🚧
    RevolveAxis         = 22u,   // 🚧
    LoftProfile         = 23u,   // 🚧

    // Sculpting ---------------------------------------------------------------------------------------------
    BristleTip          = 24u,   // 🚧
    InflatePush         = 25u,   // 🚧
    SmoothRelax         = 26u,   // 🚧
    MaskStencil         = 27u,   // 🚧
    RemeshDensity       = 28u,   // 🚧

    // Texturing ---------------------------------------------------------------------------------------------
    UnwrapSeam          = 29u,   // 🚧
    PaintBristle        = 30u,   // 🚧
    MaterialSphere      = 31u,   // 🚧
    ChannelSelect       = 32u,   // 🚧
    StencilProjection   = 33u,   // 🚧

    // Illumination ------------------------------------------------------------------------------------------
    SunDirectional      = 34u,   // 🚧
    LampPoint           = 35u,   // 🚧
    AreaEmitter         = 36u,   // 🚧
    SkyDome             = 37u,   // 🚧

    // Rendering ---------------------------------------------------------------------------------------------
    CameraAperture      = 38u,   // 🚧
    SampleConverge      = 39u,   // 🚧
    DenoiseSweep        = 40u,   // 🚧
    ExposureOrdinate    = 41u,   // 🚧

    // Animation ---------------------------------------------------------------------------------------------
    KeyOrdinate         = 42u,   // 🚧
    CurveTangent        = 43u,   // 🚧
    TimelineScrub       = 44u,   // 🚧
    SkeletonJoint       = 45u,   // 🚧

    // Simulation --------------------------------------------------------------------------------------------
    ClothDrape          = 46u,   // 🚧
    FluidStream         = 47u,   // 🚧
    RigidCollide        = 48u,   // 🚧
    ParticleEmit        = 49u,   // 🚧

    // Assembly ----------------------------------------------------------------------------------------------
    LayerMerge          = 50u,   // 🚧
    AlphaMask           = 51u,   // 🚧
    ColourWheel         = 52u,   // 🚧
    GraphJunction       = 53u,   // 🚧

    // Measurement -------------------------------------------------------------------------------------------
    PulseTrace          = 54u,   // 🟢 lucide `activity`   — the Control Center tongue
    RulerSpan           = 55u,   // 🚧
    HistogramProfile    = 56u,   // 🚧
    StatisticReadout    = 57u,   // 🚧

    PlaceholderMark     = 58u,   // 🟢 what every unresolved subject above draws as
    SubjectCount        = 59u    // [-] - the closed count, never a subject
};

//------------------------------------------------------------------------------------------------------------------------
//                                                    THE STROKE STREAM
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 What one step of a figure's stroke stream does.
/// note  `Enclosure` and not the obvious spelling: `Frame` is a banned word.
/// tag   contract
enum class StrokeCommand : std::uint32_t
{
    Origin     = 0u,   // [-] - lifts the pen and places it; ends any open outline
    Segment    = 1u,   // [-] - straight to (Along, Across)
    Curve      = 2u,   // [-] - cubic to (Along, Across) via the two declared controls
    Close      = 3u,   // [-] - joins back to the last Origin and ends the outline
    Disc       = 4u,   // [-] - a circle centred at (Along, Across) of radius FirstAlong
    Enclosure  = 5u    // [-] - a rounded rectangle, (Along, Across) to (First…), corner radius SecondAlong
};

/// 🧩 One step, in the 24-unit declared square Lucide draws in.
/// tag   contract, nonallocating, nonthrowing
struct StrokeStep
{
    StrokeCommand  Command      = StrokeCommand::Origin;   // [-] - what this step does
    float          Along        = 0.0f;                    // [-] - primary abscissa, 0 … 24
    float          Across       = 0.0f;                    // [-] - primary ordinate, 0 … 24, increasing down
    float          FirstAlong   = 0.0f;                    // [-] - control one, or radius, or trailing corner
    float          FirstAcross  = 0.0f;                    // [-] - control one ordinate, or trailing corner
    float          SecondAlong  = 0.0f;                    // [-] - control two, or corner radius
    float          SecondAcross = 0.0f;                    // [-] - control two ordinate
};

//------------------------------------------------------------------------------------------------------------------------
//                                                        THE FIGURE
//------------------------------------------------------------------------------------------------------------------------

// 📐 Lucide draws in a 24 × 24 square at a stroke weight of two, with round caps and round joins. Both
//    numbers travel with the figure rather than sitting at the recording site, because the two tongue symbols
//    are drawn at 2.5 and everything else at 2 — a weight chosen where the figure is drawn is a weight that
//    disagrees with itself across two panels.
inline constexpr float DeclaredSquare      = 24.0f;   // [-] - the square every ordinate above is stated in
inline constexpr float DeclaredWeight      = 2.0f;    // [-] - lucide's default
inline constexpr float TongueWeight        = 2.5f;    // [-] - the two drawer tongues, strokeWidth={2.5}

// 📐 The circle-to-cubic constant, κ = 4(√2 − 1)/3. Every quarter arc in the declared figures below is
//    expressed with it, which is what every vector rasteriser does and is exact to about one part in 10⁴ of
//    the radius — far under a pixel at the 16 px and 20 px extents these are drawn at.
inline constexpr float QuarterArcControl   = 0.5522847498f;   // [-] - κ

/// 🧩 One declared figure — its stroke stream, its enrolment, and the weight it is drawn at.
/// note  Points into static storage. Nothing here ever owns an allocation, and a figure outlives every
///       reference to it by construction.
/// tag   contract, nonallocating, nonthrowing
struct SymbolFigure
{
    const StrokeStep*  Steps       = nullptr;                        // [-] - static; never allocated
    std::uint32_t      StepCount   = 0u;                             // [-]
    SymbolDiscipline   Enrolment   = SymbolDiscipline::Workspace;    // [-]
    float              Weight      = DeclaredWeight;                 // [-] - in declared-square units
    bool               ArtworkHeld = false;                          // [-] - false while it draws as the mark
};

//------------------------------------------------------------------------------------------------------------------------
//                                                       THE LOOKUPS
//------------------------------------------------------------------------------------------------------------------------

/// 🧩 The figure one subject draws as.
/// in    Subject  [-]  a subject with no declared artwork resolves to PlaceholderMark's figure
/// out   Figure   [-]  never empty; a caller never has to test before stroking
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
const SymbolFigure& Figure(SymbolSubject Subject);

/// 🧩 Which discipline a subject is enrolled in, without resolving its artwork.
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
SymbolDiscipline Enrolment(SymbolSubject Subject);

/// 🧩 The subjects enrolled in one discipline, in declared order.
/// in    Discipline  [-]  the discipline to read
/// in    Delivered   [-]  receives a pointer into static storage; untouched when the count is zero
/// out   Count       [-]  how many subjects the discipline holds
/// use   `const SymbolSubject* Held = nullptr; const auto Count = EnrolledIn(Texturing, &Held);`
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
std::uint32_t EnrolledIn(SymbolDiscipline Discipline, const SymbolSubject** Delivered);

/// 🧩 Static text naming a discipline, for the diagnostic overlay and for nothing the artist reads.
/// cost  ✔️
/// tag   api, nonallocating, nonthrowing
const char* DisciplineText(SymbolDiscipline Discipline);

}   // namespace Slate
