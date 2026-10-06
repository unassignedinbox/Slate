//============================================================================================================================================
// 🌫 GeneratorSpecification.js — procedural fields available to generator layers and layer masks
//============================================================================================================================================
// Index order is the contract shared with ShadingGlsl.js (SampleGenerator()), so nothing here is ever reordered and
// anything new is appended. Four families:
//   · noise      — evaluated from the UV coordinate alone (fbm, cells, scratches, weave, wood, checker, gradient).
//   · field      — read out of the measured surface (curvature, cavity, occlusion, up-facing, height, thickness).
//   · weather    — the fields and the noise composed into what a painter actually asks for: dust, grime, wear, drips.
//   · selection  — identity rather than shade: this object, this tile, this island, these faces, this vertex map.
// The last three need the surface measured first — SurfaceSolver.MeasureSurface, which MaskSolver reads.
//
// 🔴 Only the first twelve are drawn by the device, because only those twelve existed when generator layers were
//    written and their indices are the contract. Everything after them is solved on the CPU into a mask sheet and is
//    offered on masks only: Layers false keeps it out of the generator-layer menu rather than letting it render as
//    whatever the shader's else-branch happens to be.
//============================================================================================================================================

export const GeneratorOrdering = [
    {
        Identifier: "fbm",
        Label: "Fractal noise",
        Short: "Fractal",
        Family: "synthetic",
        Glyph: "noise",
        Controls: ["Scale", "Detail", "Contrast", "Balance", "Warp", "Seed"],
        Defaults: { Scale: 8, Detail: 5, Contrast: 0.5, Balance: 0.5, Warp: 0.25, Angle: 0, Seed: 1 },
        Hint: "Five-octave value noise with domain warping. The workhorse for grunge and oxide.",
    },
    {
        Identifier: "cells",
        Label: "Cells",
        Short: "Cells",
        Family: "synthetic",
        Glyph: "cells",
        Controls: ["Scale", "Contrast", "Balance", "Warp", "Seed"],
        Defaults: { Scale: 32, Detail: 1, Contrast: 0.6, Balance: 0.5, Warp: 0.1, Angle: 0, Seed: 3 },
        Hint: "Worley F1 distance. Pebble grain, flake, air pockets and pitting.",
    },
    {
        Identifier: "scratches",
        Label: "Scratches",
        Short: "Scratches",
        Family: "synthetic",
        Glyph: "scratch",
        Controls: ["Scale", "Detail", "Contrast", "Balance", "Angle", "Seed"],
        Defaults: { Scale: 7, Detail: 3, Contrast: 0.7, Balance: 0.55, Warp: 0, Angle: 0, Seed: 7 },
        Hint: "Directional streaks. Mill finishes, brushed metal, wiper marks.",
    },
    {
        Identifier: "weave",
        Label: "Weave",
        Short: "Weave",
        Family: "synthetic",
        Glyph: "weave",
        Controls: ["Scale", "Contrast", "Angle"],
        Defaults: { Scale: 64, Detail: 1, Contrast: 0.6, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Two-over-two twill. Fabric, carbon tow, mesh.",
    },
    {
        Identifier: "wood",
        Label: "Wood grain",
        Short: "Wood",
        Family: "synthetic",
        Glyph: "wood",
        Controls: ["Scale", "Detail", "Contrast", "Warp", "Angle", "Seed"],
        Defaults: { Scale: 9, Detail: 5, Contrast: 0.6, Balance: 0.5, Warp: 0.5, Angle: 90, Seed: 2 },
        Hint: "Ring turbulence along one axis. Quarter-sawn and flat-sawn grain.",
    },
    {
        Identifier: "checker",
        Label: "Checker",
        Short: "Checker",
        Family: "synthetic",
        Glyph: "grid",
        Controls: ["Scale", "Contrast", "Angle"],
        Defaults: { Scale: 8, Detail: 1, Contrast: 1, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Hard UV checker. Useful as a texel-density reference.",
    },
    {
        Identifier: "gradient",
        Label: "Gradient",
        Short: "Gradient",
        Family: "synthetic",
        Glyph: "ramp",
        Controls: ["Contrast", "Balance", "Angle"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.5, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Linear ramp across UV, rotated by Angle.",
    },
    {
        Identifier: "curvature",
        Label: "Curvature · edges",
        Short: "Curvature",
        Family: "baked",
        Glyph: "edge",
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.7, Balance: 0.6, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Convex curvature from the surface bake. Edge wear and polish.",
    },
    {
        Identifier: "cavity",
        Label: "Cavity · crevices",
        Short: "Cavity",
        Family: "baked",
        Glyph: "cavity",
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.7, Balance: 0.55, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Concave curvature from the surface bake. Dirt and patina in the recesses.",
    },
    {
        Identifier: "occlusion",
        Label: "Ambient occlusion",
        Short: "Occlusion",
        Family: "baked",
        Glyph: "occlusion",
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.5, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Ray-traced per-vertex occlusion, interpolated into texture space.",
    },
    {
        Identifier: "inclination",
        Label: "Up-facing",
        Short: "Up-facing",
        Family: "baked",
        Glyph: "up",
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.6, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "World-space normal · +Y. Dust, snow and settling.",
    },
    {
        Identifier: "altitude",
        Label: "World height",
        Short: "Height",
        Family: "baked",
        Glyph: "height",
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.5, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Object-space Y gradient across the bounding box. Water lines and drips.",
    },
    {
        Identifier: "thickness",
        Label: "Thickness",
        Short: "Thickness",
        Family: "field",
        Glyph: "thickness",
        Layers: false,
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.5, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "How much model is behind the texel. Thin walls, fins and the inside of a lip.",
    },
    {
        Identifier: "position",
        Label: "Position",
        Short: "Position",
        Family: "field",
        Glyph: "axis",
        Layers: false,
        Controls: ["Axis", "Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.5, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1, Axis: 1 },
        Hint: "A ramp along one world axis across the model's bounds.",
    },
    {
        Identifier: "facing",
        Label: "Facing",
        Short: "Facing",
        Family: "field",
        Glyph: "sun",
        Layers: false,
        Controls: ["Axis", "Angle", "Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.5, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1, Axis: 1 },
        Hint: "How squarely the surface faces a direction. Light wear, sun bleach, one-sided grime.",
    },
    {
        Identifier: "dust",
        Label: "Dust",
        Short: "Dust",
        Family: "weather",
        Glyph: "dust",
        Layers: false,
        Controls: ["Scale", "Detail", "Contrast", "Balance", "Spread", "Seed"],
        Defaults: { Scale: 24, Detail: 4, Contrast: 0.45, Balance: 0.5, Warp: 0, Angle: 0, Seed: 5, Spread: 0.55 },
        Hint: "Settles on what faces up and stays where nothing disturbs it.",
    },
    {
        Identifier: "grime",
        Label: "Grime",
        Short: "Grime",
        Family: "weather",
        Glyph: "cavity",
        Layers: false,
        Controls: ["Scale", "Detail", "Contrast", "Balance", "Spread", "Seed"],
        Defaults: { Scale: 14, Detail: 5, Contrast: 0.5, Balance: 0.48, Warp: 0.3, Angle: 0, Seed: 9, Spread: 0.6 },
        Hint: "Collects in the crevices and the corners the light cannot reach.",
    },
    {
        Identifier: "wear",
        Label: "Edge wear",
        Short: "Wear",
        Family: "weather",
        Glyph: "edge",
        Layers: false,
        Controls: ["Scale", "Detail", "Contrast", "Balance", "Spread", "Seed"],
        Defaults: { Scale: 36, Detail: 4, Contrast: 0.55, Balance: 0.52, Warp: 0.2, Angle: 0, Seed: 3, Spread: 0.5 },
        Hint: "Rubs through on the convex edges, worse where they stand proud.",
    },
    {
        Identifier: "drips",
        Label: "Drips",
        Short: "Drips",
        Family: "weather",
        Glyph: "drip",
        Layers: false,
        Controls: ["Scale", "Detail", "Contrast", "Balance", "Spread", "Seed"],
        Defaults: { Scale: 60, Detail: 4, Contrast: 0.6, Balance: 0.55, Warp: 0.25, Angle: 0, Seed: 11, Spread: 0.45 },
        Hint: "Runs down from the ledges that catch the water.",
    },
    {
        Identifier: "object",
        Label: "Object",
        Short: "Object",
        Family: "selection",
        Glyph: "box",
        Layers: false,
        Controls: [],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1, Choice: "" },
        Hint: "One whole object out of the scene, enclosed mesh and all.",
    },
    {
        Identifier: "tile",
        Label: "UDIM tile",
        Short: "Tile",
        Family: "selection",
        Glyph: "grid",
        Layers: false,
        Controls: [],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1, Choice: "" },
        Hint: "Everything that landed on one tile of the sheet.",
    },
    {
        Identifier: "island",
        Label: "UV island",
        Short: "Island",
        Family: "selection",
        Glyph: "vector",
        Layers: false,
        Controls: [],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1, Choice: "" },
        Hint: "One UV component — the piece of the sheet the seams cut out.",
    },
    {
        Identifier: "faces",
        Label: "Faces",
        Short: "Faces",
        Family: "selection",
        Glyph: "facet",
        Layers: false,
        Controls: [],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1, Marks: [] },
        Hint: "The faces picked on the model. Click to add, Alt-click to drop, Shift-click to take the island.",
    },
    {
        Identifier: "vertex",
        Label: "Vertex map",
        Short: "Vertex",
        Family: "selection",
        Glyph: "vertex",
        Layers: false,
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.5, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1, Choice: "occlusion" },
        Hint: "A per-vertex reading carried across the triangles.",
    },
];

// What a vertex map can be read from: a number that already exists per vertex or per part, interpolated the way a
// vertex colour would be — which is what makes it a vertex map rather than a texture.
export const VertexMaps = [
    { Identifier: "occlusion", Label: "Occlusion" },
    { Identifier: "thickness", Label: "Thickness" },
    { Identifier: "altitude", Label: "Height" },
    { Identifier: "inclination", Label: "Up-facing" },
    { Identifier: "object", Label: "Random per object" },
    { Identifier: "island", Label: "Random per island" },
];

// Label names the generator in a sentence; Short names it under a 19-pixel mark in a shelf four chips wide. Neither
// is the other's abbreviation by rule, because "Ambient occlusion" shortens to "Occlusion" and "Faces" does not shorten.
export const GeneratorFamilies = [
    { Identifier: "noise", Label: "Noise", Hint: "Drawn from the UV coordinate." },
    { Identifier: "field", Label: "Surface", Hint: "Measured off the model." },
    { Identifier: "weather", Label: "Weathering", Hint: "What time does to a surface." },
    { Identifier: "selection", Label: "Selection", Hint: "Identity rather than shade." },
];

// Which family a generator belongs to, for the ones written before families existed.
export const GeneratorFamily = (Identifier) =>
{
    const Found = GeneratorByIdentifier[Identifier];
    if (!Found) return "noise";
    if (Found.Family === "synthetic") return "noise";
    if (Found.Family === "baked") return "field";
    return Found.Family;
};

// Everything past the twelve the device draws needs the surface measured before it can answer.
export const GeneratorNeedsSurface = (Identifier) => GeneratorFamily(Identifier) !== "noise";

export const GeneratorIndex = (Identifier) =>
    Math.max(
        0,
        GeneratorOrdering.findIndex((Generator) => Generator.Identifier === Identifier),
    );

export const GeneratorByIdentifier = Object.fromEntries(
    GeneratorOrdering.map((Generator) => [Generator.Identifier, Generator]),
);

export const GeneratorControls = {
    Scale: { Label: "Scale", Minimum: 0.5, Maximum: 256, Step: 0.5, Unit: "×" },
    Detail: { Label: "Detail", Minimum: 1, Maximum: 8, Step: 1, Unit: "oct" },
    Contrast: { Label: "Contrast", Minimum: 0, Maximum: 1, Step: 0.01, Unit: "—" },
    Balance: { Label: "Balance", Minimum: 0, Maximum: 1, Step: 0.01, Unit: "—" },
    Warp: { Label: "Warp", Minimum: 0, Maximum: 1, Step: 0.01, Unit: "—" },
    Angle: { Label: "Angle", Minimum: 0, Maximum: 360, Step: 1, Unit: "°" },
    Seed: { Label: "Seed", Minimum: 1, Maximum: 64, Step: 1, Unit: "#" },
    Spread: { Label: "Spread", Minimum: 0, Maximum: 1, Step: 0.01, Unit: "—" },
    Axis: { Label: "Axis", Minimum: 0, Maximum: 2, Step: 1, Unit: "xyz" },
};

export const DefaultGenerator = (Identifier = "fbm") =>
{
    const Specification = GeneratorByIdentifier[Identifier] || GeneratorByIdentifier.fbm;
    return { Kind: Specification.Identifier, Invert: false, ...Specification.Defaults };
};

export const NormaliseGenerator = (Generator = {}) =>
{
    const Base = DefaultGenerator(Generator.Kind);
    // 🔴 Built from the BASE's keys, never from the candidate's. A record arriving with settings this generator has
    //    no use for — the spread of a dust that is now a checker — must not keep them, or a switch of kind leaves
    //    dead numbers behind that the next switch back would silently pick up again.
    const Normalised = { ...Base, Kind: Base.Kind, Invert: Boolean(Generator.Invert ?? Base.Invert) };
    for (const Name of Object.keys(Base))
        if (Name !== "Kind" && Name !== "Invert" && Generator[Name] !== undefined) Normalised[Name] = Generator[Name];
    for (const [Name, Control] of Object.entries(GeneratorControls))
    {
        // A control the generator never asks for is not its business to carry. Spread means something to dust and
        // nothing to a checker, and a record full of settings that do nothing is how a catalogue stops being read.
        if (!(Name in Base)) continue;
        const Value = Number(Normalised[Name]);
        Normalised[Name] = Number.isFinite(Value)
            ? Math.min(Control.Maximum, Math.max(Control.Minimum, Value))
            : Base[Name];
    }
    return Normalised;
};
