//============================================================================================================================================
// 📦 SpeciesCriteria — the tunable parameter set behind every plant, and the archetypes shipped with the tool.
//============================================================================================================================================
// One flat record describes a plant completely. The docket edits this record, GrowthSolver consumes it, and nothing
//    else in the tool holds plant state — so "save a species" is `JSON.stringify(Criteria)` and the eventual C++ port
//    is a POD struct with the same field names.
//
// Units follow CLAUDE.md §7: metres, seconds, radians. Angles are stored in radians and shown in degrees.

export const Radians = (Degrees) => Degrees * Math.PI / 180.0;
export const Degrees = (Radian)  => Radian * 180.0 / Math.PI;

//------------------------------------------------------------------------------------------------------------------------
//                                                   PARAMETER DECLARATION
//------------------------------------------------------------------------------------------------------------------------
// Declares every editable field: which docket tab owns it, its range, and how it is displayed. The docket is
//    generated from this list, so adding a parameter here is the only step needed to expose it in the UI.

export const ParameterDeclaration =
[
    // ── Growth ───────────────────────────────────────────────────────────────────────────────────────────────────
    { Key: "Height",          Tab: "Growth", Label: "Height",        Unit: "m",   Minimum: 0.25, Maximum: 9.0,  Step: 0.05 },
    { Key: "TrunkRadius",     Tab: "Growth", Label: "Trunk",         Unit: "cm",  Minimum: 0.4,  Maximum: 28.0, Step: 0.1, Scale: 100.0 },
    { Key: "SegmentCount",    Tab: "Growth", Label: "Segments",      Unit: "",    Minimum: 3,    Maximum: 22,   Step: 1,   Integral: true },
    { Key: "OrderCount",      Tab: "Growth", Label: "Orders",        Unit: "",    Minimum: 1,    Maximum: 4,    Step: 1,   Integral: true },
    { Key: "BranchCount",     Tab: "Growth", Label: "Branches",      Unit: "",    Minimum: 0,    Maximum: 8,    Step: 1,   Integral: true },
    { Key: "BranchStart",     Tab: "Growth", Label: "First branch",  Unit: "%",   Minimum: 0.0,  Maximum: 0.95, Step: 0.01, Scale: 100.0 },
    { Key: "BranchAngle",     Tab: "Growth", Label: "Spread",        Unit: "°",   Minimum: 5.0,  Maximum: 92.0, Step: 1.0, Angular: true },
    { Key: "Phyllotaxis",     Tab: "Growth", Label: "Phyllotaxis",   Unit: "°",   Minimum: 0.0,  Maximum: 180.0, Step: 0.5, Angular: true },
    { Key: "TaperExponent",   Tab: "Growth", Label: "Taper",         Unit: "",    Minimum: 0.3,  Maximum: 3.2,  Step: 0.05 },
    { Key: "LengthFalloff",   Tab: "Growth", Label: "Length falloff",Unit: "",    Minimum: 0.25, Maximum: 1.0,  Step: 0.01 },
    { Key: "Gnarl",           Tab: "Growth", Label: "Gnarl",         Unit: "",    Minimum: 0.0,  Maximum: 1.0,  Step: 0.01 },
    { Key: "Droop",           Tab: "Growth", Label: "Droop",         Unit: "",    Minimum: -0.7, Maximum: 1.0,  Step: 0.01 },
    { Key: "Tropism",         Tab: "Growth", Label: "Phototropism",  Unit: "",    Minimum: -0.5, Maximum: 1.0,  Step: 0.01 },

    // ── Foliage ──────────────────────────────────────────────────────────────────────────────────────────────────
    { Key: "LeafScale",       Tab: "Foliage", Label: "Leaf size",    Unit: "cm",  Minimum: 1.0,  Maximum: 90.0, Step: 0.5, Scale: 100.0 },
    { Key: "LeafDensity",     Tab: "Foliage", Label: "Density",      Unit: "",    Minimum: 0.0,  Maximum: 5.0,  Step: 0.05 },
    { Key: "LeafPitch",       Tab: "Foliage", Label: "Pitch",        Unit: "°",   Minimum: -85.0, Maximum: 85.0, Step: 1.0, Angular: true },
    { Key: "LeafJitter",      Tab: "Foliage", Label: "Jitter",       Unit: "",    Minimum: 0.0,  Maximum: 1.0,  Step: 0.01 },
    { Key: "LeafStart",       Tab: "Foliage", Label: "Coverage from",Unit: "%",   Minimum: 0.0,  Maximum: 0.95, Step: 0.01, Scale: 100.0 },
    { Key: "FlowerChance",    Tab: "Foliage", Label: "Flowering",    Unit: "%",   Minimum: 0.0,  Maximum: 1.0,  Step: 0.01, Scale: 100.0 },
    { Key: "TintVariation",   Tab: "Foliage", Label: "Tint variance",Unit: "",    Minimum: 0.0,  Maximum: 0.6,  Step: 0.01 },
    { Key: "Chlorosis",       Tab: "Foliage", Label: "Autumn",       Unit: "",    Minimum: 0.0,  Maximum: 1.0,  Step: 0.01 },

    // ── Physics ──────────────────────────────────────────────────────────────────────────────────────────────────
    { Key: "BendStiffness",   Tab: "Physics", Label: "Stiffness",    Unit: "",    Minimum: 0.02, Maximum: 1.0,  Step: 0.01 },
    { Key: "TipSoftness",     Tab: "Physics", Label: "Tip softness", Unit: "",    Minimum: 0.0,  Maximum: 1.0,  Step: 0.01 },
    { Key: "Drag",            Tab: "Physics", Label: "Damping",      Unit: "",    Minimum: 0.005, Maximum: 0.30, Step: 0.005 },
    { Key: "Mass",            Tab: "Physics", Label: "Mass",         Unit: "kg",  Minimum: 0.05, Maximum: 6.0,  Step: 0.05 },
    { Key: "CollisionRadius", Tab: "Physics", Label: "Thickness",    Unit: "cm",  Minimum: 0.5,  Maximum: 30.0, Step: 0.5, Scale: 100.0 },
    { Key: "WindGain",        Tab: "Physics", Label: "Wind gain",    Unit: "",    Minimum: 0.0,  Maximum: 3.0,  Step: 0.05 },
    { Key: "Recovery",        Tab: "Physics", Label: "Recovery",     Unit: "/s",  Minimum: 0.0,  Maximum: 1.0,  Step: 0.01 },
    { Key: "SelfSupport",     Tab: "Physics", Label: "Self support", Unit: "%",   Minimum: 0.0,  Maximum: 1.0,  Step: 0.01, Scale: 100.0 }
];

//------------------------------------------------------------------------------------------------------------------------
//                                                      ARCHETYPES
//------------------------------------------------------------------------------------------------------------------------
// Families map onto the cutout families the bake emitted (Broadleaf / Fern / VineLeaf / Tendril / Flower / Grass).

const Shared =
{
    BendStiffness: 0.35, TipSoftness: 0.55, Drag: 0.045, Mass: 1.0, Recovery: 0.70, SelfSupport: 0.96,
    CollisionRadius: 0.06, WindGain: 1.0,
    TintVariation: 0.16, Chlorosis: 0.0, FlowerChance: 0.0,
    LeafJitter: 0.35, LeafStart: 0.25, Tropism: 0.25, Gnarl: 0.3
};

export const SpeciesArchetype =
{
    //  ── Trees ────────────────────────────────────────────────────────────────────────────────────────────────────
    CanopyTree:
    {
        ...Shared,
        DisplayName: "Canopy Tree", Silhouette: "Tree", FoliageFamily: ["Broadleaf"],
        Height: 6.2, TrunkRadius: 0.16, SegmentCount: 9, OrderCount: 3, BranchCount: 5,
        BranchStart: 0.34, BranchAngle: Radians(48), Phyllotaxis: Radians(137.5),
        TaperExponent: 1.55, LengthFalloff: 0.62, Gnarl: 0.34, Droop: 0.16, Tropism: 0.34,
        LeafScale: 0.27, LeafDensity: 3.6, LeafPitch: Radians(-22), LeafStart: 0.26,
        BendStiffness: 0.62, TipSoftness: 0.62, Mass: 1.5, CollisionRadius: 0.09, Drag: 0.16, Recovery: 0.45, SelfSupport: 0.99
    },

    Sapling:
    {
        ...Shared,
        DisplayName: "Sapling", Silhouette: "Tree", FoliageFamily: ["Broadleaf"],
        Height: 2.3, TrunkRadius: 0.045, SegmentCount: 8, OrderCount: 2, BranchCount: 4,
        BranchStart: 0.28, BranchAngle: Radians(54), Phyllotaxis: Radians(137.5),
        TaperExponent: 1.25, LengthFalloff: 0.66, Gnarl: 0.28, Droop: 0.22, Tropism: 0.45,
        LeafScale: 0.23, LeafDensity: 3.2, LeafPitch: Radians(-18), LeafStart: 0.24,
        BendStiffness: 0.30, TipSoftness: 0.78, Mass: 0.55, CollisionRadius: 0.045, WindGain: 1.5
    },

    //  ── Ferns ────────────────────────────────────────────────────────────────────────────────────────────────────
    ShuttlecockFern:
    {
        ...Shared,
        DisplayName: "Shuttlecock Fern", Silhouette: "Rosette", FoliageFamily: ["Fern"],
        Height: 1.05, TrunkRadius: 0.014, SegmentCount: 6, OrderCount: 1, BranchCount: 7,
        BranchStart: 0.0, BranchAngle: Radians(62), Phyllotaxis: Radians(51.4),
        TaperExponent: 1.0, LengthFalloff: 0.9, Gnarl: 0.12, Droop: 0.52, Tropism: 0.5,
        LeafScale: 0.46, LeafDensity: 0.85, LeafPitch: Radians(-8), LeafStart: 0.30, LeafJitter: 0.2,
        BendStiffness: 0.20, TipSoftness: 0.88, Mass: 0.30, CollisionRadius: 0.035, WindGain: 1.7, Drag: 0.10, Recovery: 0.90, SelfSupport: 0.97
    },

    TreeFern:
    {
        ...Shared,
        DisplayName: "Tree Fern", Silhouette: "Rosette", FoliageFamily: ["Fern"],
        Height: 2.9, TrunkRadius: 0.10, SegmentCount: 7, OrderCount: 1, BranchCount: 8,
        BranchStart: 0.82, BranchAngle: Radians(58), Phyllotaxis: Radians(45),
        TaperExponent: 0.7, LengthFalloff: 0.94, Gnarl: 0.08, Droop: 0.58, Tropism: 0.42,
        LeafScale: 0.62, LeafDensity: 0.7, LeafPitch: Radians(-6), LeafStart: 0.22, LeafJitter: 0.16,
        BendStiffness: 0.26, TipSoftness: 0.82, Mass: 0.7, CollisionRadius: 0.05, WindGain: 1.4
    },

    //  ── Vines ────────────────────────────────────────────────────────────────────────────────────────────────────
    CreepingVine:
    {
        ...Shared,
        DisplayName: "Creeping Vine", Silhouette: "Vine", FoliageFamily: ["VineLeaf", "Tendril"],
        Height: 2.7, TrunkRadius: 0.018, SegmentCount: 14, OrderCount: 2, BranchCount: 3,
        BranchStart: 0.18, BranchAngle: Radians(72), Phyllotaxis: Radians(137.5),
        TaperExponent: 0.55, LengthFalloff: 0.82, Gnarl: 0.72, Droop: 0.74, Tropism: 0.18,
        LeafScale: 0.14, LeafDensity: 3.6, LeafPitch: Radians(-34), LeafStart: 0.10, LeafJitter: 0.55,
        BendStiffness: 0.09, TipSoftness: 0.95, Mass: 0.22, CollisionRadius: 0.03, WindGain: 1.9, Drag: 0.05, Recovery: 0.90, SelfSupport: 0.93
    },

    FloweringCreeper:
    {
        ...Shared,
        DisplayName: "Flowering Creeper", Silhouette: "Vine", FoliageFamily: ["VineLeaf", "Flower", "Tendril"],
        Height: 2.4, TrunkRadius: 0.016, SegmentCount: 13, OrderCount: 2, BranchCount: 4,
        BranchStart: 0.14, BranchAngle: Radians(66), Phyllotaxis: Radians(137.5),
        TaperExponent: 0.6, LengthFalloff: 0.84, Gnarl: 0.62, Droop: 0.66, Tropism: 0.22,
        LeafScale: 0.13, LeafDensity: 3.2, LeafPitch: Radians(-30), LeafStart: 0.08, LeafJitter: 0.5,
        FlowerChance: 0.34, BendStiffness: 0.10, TipSoftness: 0.94, Mass: 0.2,
        CollisionRadius: 0.028, WindGain: 1.8
    },

    //  ── Shrubs and ground cover ──────────────────────────────────────────────────────────────────────────────────
    FloweringShrub:
    {
        ...Shared,
        DisplayName: "Flowering Shrub", Silhouette: "Shrub", FoliageFamily: ["Broadleaf", "Flower"],
        Height: 1.35, TrunkRadius: 0.030, SegmentCount: 6, OrderCount: 3, BranchCount: 6,
        BranchStart: 0.05, BranchAngle: Radians(63), Phyllotaxis: Radians(137.5),
        TaperExponent: 1.0, LengthFalloff: 0.70, Gnarl: 0.44, Droop: 0.24, Tropism: 0.35,
        LeafScale: 0.11, LeafDensity: 3.4, LeafPitch: Radians(-22), LeafStart: 0.14, LeafJitter: 0.45,
        FlowerChance: 0.42, BendStiffness: 0.24, TipSoftness: 0.80, Mass: 0.42,
        CollisionRadius: 0.035, WindGain: 1.5
    },

    Undergrowth:
    {
        ...Shared,
        DisplayName: "Undergrowth", Silhouette: "Rosette", FoliageFamily: ["Grass"],
        Height: 0.55, TrunkRadius: 0.008, SegmentCount: 4, OrderCount: 1, BranchCount: 8,
        BranchStart: 0.0, BranchAngle: Radians(46), Phyllotaxis: Radians(77),
        TaperExponent: 0.9, LengthFalloff: 0.95, Gnarl: 0.2, Droop: 0.3, Tropism: 0.6,
        LeafScale: 0.34, LeafDensity: 1.5, LeafPitch: Radians(-4), LeafStart: 0.0, LeafJitter: 0.5,
        BendStiffness: 0.14, TipSoftness: 0.92, Mass: 0.16, CollisionRadius: 0.022, WindGain: 2.1, Drag: 0.05, Recovery: 0.90, SelfSupport: 0.95
    }
};

export const ArchetypeOrder =
[
    "CanopyTree", "Sapling", "ShuttlecockFern", "TreeFern",
    "CreepingVine", "FloweringCreeper", "FloweringShrub", "Undergrowth"
];

export function CloneArchetype(Key)
{
    const Original = SpeciesArchetype[Key] ?? SpeciesArchetype.CanopyTree;
    return { ...Original, FoliageFamily: [...Original.FoliageFamily], Archetype: Key };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    SCATTER CRITERIA
//------------------------------------------------------------------------------------------------------------------------
// The overgrowth layer: how many plants of which species fill the plot.

export const ScatterDeclaration =
[
    { Key: "PlantCount",   Label: "Plants",      Unit: "",  Minimum: 1,   Maximum: 96,  Step: 1, Integral: true },
    { Key: "PlotRadius",   Label: "Plot radius", Unit: "m", Minimum: 0.5, Maximum: 14.0, Step: 0.25 },
    { Key: "ScaleSpread",  Label: "Size spread", Unit: "",  Minimum: 0.0, Maximum: 0.8, Step: 0.01 },
    { Key: "ClusterBias",  Label: "Clustering",  Unit: "",  Minimum: 0.0, Maximum: 1.0, Step: 0.01 }
];

export const DefaultScatter =
{
    PlantCount: 44,
    PlotRadius: 6.0,
    ScaleSpread: 0.42,
    ClusterBias: 0.5,
    Companions: ["Undergrowth", "ShuttlecockFern", "FloweringShrub", "CreepingVine"]
};

//------------------------------------------------------------------------------------------------------------------------
//                                                   ENVIRONMENT CRITERIA
//------------------------------------------------------------------------------------------------------------------------

export const EnvironmentDeclaration =
[
    { Key: "WindStrength",   Label: "Wind",        Unit: "m/s²", Minimum: 0.0, Maximum: 14.0, Step: 0.1 },
    { Key: "WindTurbulence", Label: "Turbulence",  Unit: "",     Minimum: 0.0, Maximum: 1.6,  Step: 0.01 },
    { Key: "WindFlutter",    Label: "Flutter",     Unit: "",     Minimum: 0.0, Maximum: 8.0,  Step: 0.05 },
    { Key: "WindBearing",    Label: "Bearing",     Unit: "°",    Minimum: 0.0, Maximum: 360.0, Step: 1.0, Angular: true },
    { Key: "SunElevation",   Label: "Sun height",  Unit: "°",    Minimum: 2.0, Maximum: 88.0, Step: 1.0, Angular: true },
    { Key: "SunBearing",     Label: "Sun bearing", Unit: "°",    Minimum: 0.0, Maximum: 360.0, Step: 1.0, Angular: true },
    { Key: "SunIntensity",   Label: "Sun",         Unit: "",     Minimum: 0.0, Maximum: 6.0,  Step: 0.05 },
    { Key: "SkyIntensity",   Label: "Sky fill",    Unit: "",     Minimum: 0.0, Maximum: 2.5,  Step: 0.02 },
    { Key: "Gravity",        Label: "Gravity",     Unit: "m/s²", Minimum: 0.0, Maximum: 20.0, Step: 0.1 }
];

export const DefaultEnvironment =
{
    WindStrength: 2.6,
    WindTurbulence: 0.55,
    WindFlutter: 1.6,
    WindBearing: Radians(38),
    SunElevation: Radians(34),
    SunBearing: Radians(125),
    SunIntensity: 3.1,
    SkyIntensity: 0.85,
    Gravity: 9.81,
    // Measured, not guessed: at 6 iterations a 12 m canopy settles 1.9 m below its rest pose because Jacobi has
    //    not converged; at 12 × 3 the residual sag is ~0.02 m, which is real gravity droop rather than solver error.
    IterationCount: 12,
    SubstepCount: 3,
    // Jacobi damping ω. Branching skeletons oscillate about their rest pose at ω = 1 because each joint is
    //    corrected against neighbours that are moving in the same pass; ω < 1 pulls the feedback gain under one.
    UnderRelaxation: 0.6,
    CollisionOn: true,
    GroundOn: true,
    ShowCollider: true,
    DebugCategory: 0
};
