//============================================================================================================================================
// 🌫 GeneratorSpecification.js — procedural fields available to generator layers and layer masks
//============================================================================================================================================
// Index order is the contract shared with ShadingGlsl.js (SampleGenerator()). Two families:
//   · Synthetic fields  — evaluated from the UV coordinate (fbm, cells, scratches, weave, wood, checker, gradient).
//   · Baked fields      — read out of the surface bake (curvature, cavity, occlusion, inclination, thickness).
// Baked fields are what makes edge wear, crevice dirt and up-facing dust behave like the model rather than like a texture.
//============================================================================================================================================

export const GeneratorOrdering = [
    {
        Identifier: "fbm",
        Label: "Fractal noise",
        Family: "synthetic",
        Controls: ["Scale", "Detail", "Contrast", "Balance", "Warp", "Seed"],
        Defaults: { Scale: 8, Detail: 5, Contrast: 0.5, Balance: 0.5, Warp: 0.25, Angle: 0, Seed: 1 },
        Hint: "Five-octave value noise with domain warping. The workhorse for grunge and oxide.",
    },
    {
        Identifier: "cells",
        Label: "Cells",
        Family: "synthetic",
        Controls: ["Scale", "Contrast", "Balance", "Warp", "Seed"],
        Defaults: { Scale: 32, Detail: 1, Contrast: 0.6, Balance: 0.5, Warp: 0.1, Angle: 0, Seed: 3 },
        Hint: "Worley F1 distance. Pebble grain, flake, air pockets and pitting.",
    },
    {
        Identifier: "scratches",
        Label: "Scratches",
        Family: "synthetic",
        Controls: ["Scale", "Detail", "Contrast", "Balance", "Angle", "Seed"],
        Defaults: { Scale: 7, Detail: 3, Contrast: 0.7, Balance: 0.55, Warp: 0, Angle: 0, Seed: 7 },
        Hint: "Directional streaks. Mill finishes, brushed metal, wiper marks.",
    },
    {
        Identifier: "weave",
        Label: "Weave",
        Family: "synthetic",
        Controls: ["Scale", "Contrast", "Angle"],
        Defaults: { Scale: 64, Detail: 1, Contrast: 0.6, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Two-over-two twill. Fabric, carbon tow, mesh.",
    },
    {
        Identifier: "wood",
        Label: "Wood grain",
        Family: "synthetic",
        Controls: ["Scale", "Detail", "Contrast", "Warp", "Angle", "Seed"],
        Defaults: { Scale: 9, Detail: 5, Contrast: 0.6, Balance: 0.5, Warp: 0.5, Angle: 90, Seed: 2 },
        Hint: "Ring turbulence along one axis. Quarter-sawn and flat-sawn grain.",
    },
    {
        Identifier: "checker",
        Label: "Checker",
        Family: "synthetic",
        Controls: ["Scale", "Contrast", "Angle"],
        Defaults: { Scale: 8, Detail: 1, Contrast: 1, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Hard UV checker. Useful as a texel-density reference.",
    },
    {
        Identifier: "gradient",
        Label: "Gradient",
        Family: "synthetic",
        Controls: ["Contrast", "Balance", "Angle"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.5, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Linear ramp across UV, rotated by Angle.",
    },
    {
        Identifier: "curvature",
        Label: "Curvature · edges",
        Family: "baked",
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.7, Balance: 0.6, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Convex curvature from the surface bake. Edge wear and polish.",
    },
    {
        Identifier: "cavity",
        Label: "Cavity · crevices",
        Family: "baked",
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.7, Balance: 0.55, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Concave curvature from the surface bake. Dirt and patina in the recesses.",
    },
    {
        Identifier: "occlusion",
        Label: "Ambient occlusion",
        Family: "baked",
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.5, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Ray-traced per-vertex occlusion, interpolated into texture space.",
    },
    {
        Identifier: "inclination",
        Label: "Up-facing",
        Family: "baked",
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.6, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "World-space normal · +Y. Dust, snow and settling.",
    },
    {
        Identifier: "altitude",
        Label: "World height",
        Family: "baked",
        Controls: ["Contrast", "Balance"],
        Defaults: { Scale: 1, Detail: 1, Contrast: 0.5, Balance: 0.5, Warp: 0, Angle: 0, Seed: 1 },
        Hint: "Object-space Y gradient across the bounding box. Water lines and drips.",
    },
];

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
};

export const DefaultGenerator = (Identifier = "fbm") =>
{
    const Specification = GeneratorByIdentifier[Identifier] || GeneratorByIdentifier.fbm;
    return { Kind: Specification.Identifier, Invert: false, ...Specification.Defaults };
};

export const NormaliseGenerator = (Generator = {}) =>
{
    const Base = DefaultGenerator(Generator.Kind);
    const Normalised = { ...Base, ...Generator, Kind: Base.Kind, Invert: Boolean(Generator.Invert ?? Base.Invert) };
    for (const [Name, Control] of Object.entries(GeneratorControls))
    {
        const Value = Number(Normalised[Name]);
        Normalised[Name] = Number.isFinite(Value)
            ? Math.min(Control.Maximum, Math.max(Control.Minimum, Value))
            : Base[Name];
    }
    return Normalised;
};
