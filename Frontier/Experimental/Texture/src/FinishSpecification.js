//==========================================================================================================================================
// 🎛 FinishSpecification.js — procedural material finishes: automotive paint, fabric, metal and plastic.
// A finish is not paint. It is a recipe evaluated per texel, so what you edit afterwards are the properties of the material
// itself — flake scale, thread count, grain, brush angle — rather than a flat colour laid into a layer.
// Family and style indices mirror the GLSL in ShadingGlsl.FinishChunk; keep the two in step.
//==========================================================================================================================================

//--------------------------------------------------------------------------------------------------------------------------
// Control descriptors. Every family drives the same eight numbers and two colours; only the names and ranges differ, which
// is what makes one shader able to stand in for sixteen materials.
//--------------------------------------------------------------------------------------------------------------------------
const Control = (Key, Label, Minimum, Maximum, Step, Unit, Hint = "") => ({
    Key,
    Label,
    Minimum,
    Maximum,
    Step,
    Unit,
    Hint,
});

export const FinishFamilies = [
    {
        Identifier: "automotive",
        Badge: "AUTO",
        Index: 0,
        Label: "Automotive",
        Note: "Pigment, flake and clear coat.",
        Accent: "#5aa9ff",
        Styles: [
            { Identifier: "solid", Label: "Solid · single stage", Index: 0 },
            { Identifier: "metallic", Label: "Metallic basecoat", Index: 1 },
            { Identifier: "pearl", Label: "Pearl tri-coat", Index: 2 },
            { Identifier: "candy", Label: "Candy over metallic", Index: 3 },
            { Identifier: "matte", Label: "Matte / satin wrap", Index: 4 },
            { Identifier: "chameleon", Label: "Flip · chameleon", Index: 5 },
            { Identifier: "primer", Label: "Primer", Index: 6 },
        ],
        Colours: [
            { Key: "ColourA", Label: "Pigment" },
            { Key: "ColourB", Label: "Flake / ground" },
        ],
        Controls: [
            Control("Scale", "Pigment scale", 0.1, 4, 0.01, "×", "How wide the drift in the pigment itself runs."),
            Control("Flake", "Flake size", 0.05, 24, 0.05, "mm", "Measured on the panel, not in the unwrap, and resolved per pixel rather than per texel — the sheet is no longer the floor. Below a pixel on screen the leaf merges into roughness instead of fizzing."),
            Control("Density", "Flake density", 0, 1, 0.01, "—", "How much of the base is flake rather than pigment."),
            Control("Strength", "Flake brightness", 0, 1, 0.01, "—"),
            Control("Tilt", "Flake tilt", 0, 1, 0.01, "—", "How far the flakes lie off the panel. Tilt is what makes a metallic flare as you walk past it."),
            Control("Gloss", "Gloss", 0, 1, 0.01, "—", "How far the basecoat is polished under the clear."),
            Control("Coat", "Clear coat", 0, 1, 0.01, "—"),
            Control("Peel", "Orange peel", 0, 1, 0.01, "—", "How far the clear coat failed to level. Every panel has some."),
            Control("Variation", "Pigment variation", 0, 1, 0.01, "—"),
        ],
    },
    {
        Identifier: "fabric",
        Badge: "WEAVE",
        Index: 1,
        Label: "Fabric",
        Note: "Warp over weft, with nap.",
        Accent: "#c98cff",
        Styles: [
            { Identifier: "plain", Label: "Plain weave", Index: 0 },
            { Identifier: "twill", Label: "Twill / denim", Index: 1 },
            { Identifier: "satin", Label: "Satin", Index: 2 },
            { Identifier: "knit", Label: "Knitted rib", Index: 3 },
            { Identifier: "velvet", Label: "Velvet", Index: 4 },
        ],
        Colours: [
            { Key: "ColourA", Label: "Warp thread" },
            { Key: "ColourB", Label: "Weft thread" },
        ],
        Controls: [
            Control("Scale", "Thread count", 0.1, 4, 0.01, "×", "How tight the weave sits in the texture."),
            Control("Density", "Thread spread", 0, 1, 0.01, "—"),
            Control("Strength", "Fuzz", 0, 1, 0.01, "—"),
            Control("Gloss", "Sheen", 0, 1, 0.01, "—"),
            Control("Coat", "Finish coat", 0, 1, 0.01, "—"),
            Control("Angle", "Weave angle", 0, 180, 1, "°"),
            Control("Variation", "Thread variation", 0, 1, 0.01, "—"),
        ],
    },
    {
        Identifier: "metal",
        Badge: "METAL",
        Index: 2,
        Label: "Metal",
        Note: "Worked, cast or plated.",
        Accent: "#dfe6f5",
        Styles: [
            { Identifier: "brushed", Label: "Brushed", Index: 0 },
            { Identifier: "hammered", Label: "Hammered", Index: 1 },
            { Identifier: "cast", Label: "Cast and pitted", Index: 2 },
            { Identifier: "galvanised", Label: "Galvanised spangle", Index: 3 },
        ],
        Colours: [
            { Key: "ColourA", Label: "Metal tint" },
            { Key: "ColourB", Label: "Second tint" },
        ],
        Controls: [
            Control("Scale", "Grain scale", 0.1, 4, 0.01, "×"),
            Control("Density", "Pitting", 0, 1, 0.01, "—"),
            Control("Strength", "Relief", 0, 1, 0.01, "—"),
            Control("Gloss", "Polish", 0, 1, 0.01, "—"),
            Control("Coat", "Lacquer", 0, 1, 0.01, "—"),
            Control("Angle", "Brush angle", 0, 180, 1, "°", "The direction the grain runs."),
            Control("Variation", "Tint variation", 0, 1, 0.01, "—"),
        ],
    },
    {
        Identifier: "plastic",
        Badge: "RESIN",
        Index: 3,
        Label: "Plastic",
        Note: "Moulded, grained or rubberised.",
        Accent: "#34c759",
        Styles: [
            { Identifier: "moulded", Label: "Injection moulded", Index: 0 },
            { Identifier: "pebbled", Label: "Pebbled grain", Index: 1 },
            { Identifier: "soft", Label: "Soft touch", Index: 2 },
            { Identifier: "polycarbonate", Label: "Polycarbonate", Index: 3 },
        ],
        Colours: [
            { Key: "ColourA", Label: "Resin colour" },
            { Key: "ColourB", Label: "Highlight" },
        ],
        Controls: [
            Control("Scale", "Grain scale", 0.1, 4, 0.01, "×"),
            Control("Density", "Grain density", 0, 1, 0.01, "—"),
            Control("Strength", "Grain depth", 0, 1, 0.01, "—"),
            Control("Gloss", "Gloss", 0, 1, 0.01, "—"),
            Control("Coat", "Clear coat", 0, 1, 0.01, "—"),
            Control("Angle", "Grain angle", 0, 180, 1, "°"),
            Control("Variation", "Colour variation", 0, 1, 0.01, "—"),
        ],
    },
];

export const FinishFamilyByIdentifier = Object.fromEntries(FinishFamilies.map((Family) => [Family.Identifier, Family]));

//--------------------------------------------------------------------------------------------------------------------------
// The shelf. Each entry is a family, a style and a starting point for the controls — the thing a content browser tile adds.
//--------------------------------------------------------------------------------------------------------------------------
const Entry = (Identifier, Label, Family, Style, Note, Swatch, Settings) => ({
    Identifier,
    Label,
    Family,
    Style,
    Note,
    Swatch,
    Settings,
});

export const FinishShelf = [
    // Automotive ----------------------------------------------------------------------------------------------------
    Entry("rosso-corsa", "Rosso corsa", "automotive", "solid", "Single-stage racing red, no flake in it at all.", "#d8010c", {
        ColourA: [0.6867, 0.0003, 0.0037],
        ColourB: [1.0, 1.0, 1.0],
        Scale: 1,
        Flake: 1,
        Tilt: 0,
        Density: 0,
        Strength: 0,
        Gloss: 0.97,
        Coat: 0.92,
        Angle: 0,
        Peel: 0.26,
        Variation: 0.12,
    }),
    Entry("racing-green", "British racing green", "automotive", "solid", "Deep solid green under a heavy clear.", "#11392c", {
        ColourA: [0.0056, 0.0409, 0.0252],
        ColourB: [1.0, 1.0, 1.0],
        Scale: 1,
        Flake: 1,
        Tilt: 0,
        Density: 0,
        Strength: 0,
        Gloss: 0.96,
        Coat: 0.95,
        Angle: 0,
        Peel: 0.3,
        Variation: 0.14,
    }),
    Entry("alpine-white", "Alpine white", "automotive", "solid", "Factory white, the most ordinary paint there is.", "#f2f3f0", {
        ColourA: [0.8879, 0.8963, 0.8714],
        ColourB: [1.0, 1.0, 1.0],
        Scale: 1,
        Flake: 1,
        Tilt: 0,
        Density: 0,
        Strength: 0,
        Gloss: 0.94,
        Coat: 0.9,
        Angle: 0,
        Peel: 0.34,
        Variation: 0.08,
    }),
    Entry("nardo-grey", "Nardo grey", "automotive", "solid", "Flat grey solid with a restrained clear.", "#9b9d9c", {
        ColourA: [0.3278, 0.3372, 0.3325],
        ColourB: [1.0, 1.0, 1.0],
        Scale: 1,
        Flake: 1,
        Tilt: 0,
        Density: 0,
        Strength: 0,
        Gloss: 0.86,
        Coat: 0.72,
        Angle: 0,
        Peel: 0.4,
        Variation: 0.1,
    }),
    Entry("gt-silver", "GT silver metallic", "automotive", "metallic", "Fine aluminium flake — the showroom standard.", "#b7bbbe", {
        ColourA: [0.4735, 0.4969, 0.5149],
        ColourB: [0.8148, 0.8308, 0.8469],
        Scale: 1.0,
        Flake: 3.0,
        Tilt: 0.42,
        Density: 0.8,
        Strength: 0.85,
        Gloss: 0.95,
        Coat: 0.92,
        Angle: 0,
        Peel: 0.28,
        Variation: 0.18,
    }),
    Entry("obsidian-black", "Obsidian black metallic", "automotive", "metallic", "Black base with the barest whisper of flake.", "#0d0f12", {
        ColourA: [0.004, 0.0048, 0.006],
        ColourB: [0.8148, 0.8308, 0.8469],
        Scale: 1.1,
        Flake: 2.6,
        Tilt: 0.3,
        Density: 0.6,
        Strength: 0.6,
        Gloss: 0.98,
        Coat: 0.96,
        Angle: 0,
        Peel: 0.22,
        Variation: 0.2,
    }),
    Entry("ocean-metallic", "Deep ocean metallic", "automotive", "metallic", "Dark blue basecoat, medium flake.", "#10264a", {
        ColourA: [0.0052, 0.0194, 0.0685],
        ColourB: [0.8148, 0.8308, 0.8469],
        Scale: 0.9,
        Flake: 4.0,
        Tilt: 0.5,
        Density: 0.72,
        Strength: 0.8,
        Gloss: 0.95,
        Coat: 0.93,
        Angle: 0,
        Peel: 0.3,
        Variation: 0.24,
    }),
    Entry("hot-rod-flake", "Hot rod metalflake", "automotive", "metallic", "Coarse show flake, the 1960s kind you can count.", "#7a1020", {
        ColourA: [0.1946, 0.0052, 0.0144],
        ColourB: [1.0, 0.6939, 0.5271],
        Scale: 0.34,
        Flake: 12.0,
        Tilt: 0.9,
        Density: 0.4,
        Strength: 1.0,
        Gloss: 0.93,
        Coat: 0.95,
        Angle: 0,
        Peel: 0.45,
        Variation: 0.3,
    }),
    Entry("pearl-white", "Pearl white tri-coat", "automotive", "pearl", "Mica over a white ground; the shift is in the flake.", "#eef0ee", {
        ColourA: [0.855, 0.8714, 0.855],
        ColourB: [0.624, 0.7605, 0.8879],
        Scale: 1.0,
        Flake: 3.6,
        Tilt: 0.4,
        Density: 0.62,
        Strength: 0.68,
        Gloss: 0.96,
        Coat: 0.95,
        Angle: 0,
        Peel: 0.26,
        Variation: 0.16,
    }),
    Entry("mantis-pearl", "Mantis green pearl", "automotive", "pearl", "Yellow-green mica that goes gold at an angle.", "#7cbb2a", {
        ColourA: [0.2016, 0.4969, 0.0232],
        ColourB: [0.8879, 0.7682, 0.1441],
        Scale: 0.95,
        Flake: 4.0,
        Tilt: 0.46,
        Density: 0.6,
        Strength: 0.72,
        Gloss: 0.95,
        Coat: 0.94,
        Angle: 0,
        Peel: 0.3,
        Variation: 0.26,
    }),
    Entry("crystal-red", "Crystal red tri-coat", "automotive", "candy", "Translucent red laid over a bright metallic ground.", "#a3000c", {
        ColourA: [0.3663, 0.0, 0.0037],
        ColourB: [0.6867, 0.552, 0.4969],
        Scale: 1.0,
        Flake: 4.0,
        Tilt: 0.5,
        Density: 0.62,
        Strength: 0.6,
        Gloss: 0.97,
        Coat: 0.96,
        Angle: 0,
        Peel: 0.24,
        Variation: 0.4,
    }),
    Entry("candy-apple", "Candy apple", "automotive", "candy", "Lacquer over silver, deep enough to fall into.", "#b00018", {
        ColourA: [0.4342, 0.0, 0.0091],
        ColourB: [0.8148, 0.8308, 0.8469],
        Scale: 0.9,
        Flake: 5.0,
        Tilt: 0.55,
        Density: 0.66,
        Strength: 0.65,
        Gloss: 0.99,
        Coat: 1,
        Angle: 0,
        Peel: 0.2,
        Variation: 0.45,
    }),
    Entry("candy-tangerine", "Candy tangerine", "automotive", "candy", "Orange over gold, the hot rod answer to red.", "#e2591a", {
        ColourA: [0.7605, 0.0999, 0.0103],
        ColourB: [0.8714, 0.5776, 0.1022],
        Scale: 0.85,
        Flake: 5.5,
        Tilt: 0.58,
        Density: 0.68,
        Strength: 0.66,
        Gloss: 0.98,
        Coat: 1,
        Angle: 0,
        Peel: 0.22,
        Variation: 0.42,
    }),
    Entry("midnight-flip", "Midnight purple flip", "automotive", "chameleon", "Interference pigment: purple, green, gold.", "#3a1d5c", {
        ColourA: [0.0423, 0.0123, 0.107],
        ColourB: [0.0137, 0.159, 0.0685],
        Scale: 0.7,
        Flake: 4.5,
        Tilt: 0.6,
        Density: 0.6,
        Strength: 0.6,
        Gloss: 0.97,
        Coat: 0.96,
        Angle: 0,
        Peel: 0.26,
        Variation: 0.6,
    }),
    Entry("frozen-grey", "Frozen grey matte", "automotive", "matte", "Matte clear over a grey metallic. Fingerprints and all.", "#70737a", {
        ColourA: [0.162, 0.1714, 0.1946],
        ColourB: [0.2664, 0.2789, 0.3095],
        Scale: 1.1,
        Flake: 4.5,
        Tilt: 0.3,
        Density: 0.3,
        Strength: 0.4,
        Gloss: 0.22,
        Coat: 0.3,
        Angle: 0,
        Peel: 0.12,
        Variation: 0.3,
    }),
    Entry("satin-black-wrap", "Satin black wrap", "automotive", "matte", "Vinyl, not paint. No shine to speak of.", "#2b2e31", {
        ColourA: [0.0242, 0.0273, 0.0307],
        ColourB: [0.0423, 0.0482, 0.0545],
        Scale: 1,
        Flake: 1,
        Tilt: 0,
        Density: 0.2,
        Strength: 0.35,
        Gloss: 0.16,
        Coat: 0.25,
        Angle: 0,
        Peel: 0.08,
        Variation: 0.3,
    }),
    Entry("etch-primer", "Grey etch primer", "automotive", "primer", "Chalky grey, ready for colour.", "#8a8b86", {
        ColourA: [0.2542, 0.2582, 0.2384],
        ColourB: [0.159, 0.159, 0.15],
        Scale: 1.1,
        Flake: 1,
        Tilt: 0,
        Density: 0.5,
        Strength: 0.35,
        Gloss: 0.1,
        Coat: 0.05,
        Angle: 0,
        Peel: 0.05,
        Variation: 0.3,
    }),
    Entry("oxide-primer", "Red oxide primer", "automotive", "primer", "The old iron-oxide undercoat.", "#8c4a35", {
        ColourA: [0.2623, 0.0685, 0.0356],
        ColourB: [0.147, 0.0331, 0.0176],
        Scale: 1.1,
        Flake: 1,
        Tilt: 0,
        Density: 0.5,
        Strength: 0.4,
        Gloss: 0.1,
        Coat: 0.05,
        Angle: 0,
        Peel: 0.05,
        Variation: 0.32,
    }),
    // Fabric --------------------------------------------------------------------------------------------------------
    Entry("cotton-canvas", "Cotton canvas", "fabric", "plain", "Tight plain weave, matte thread.", "#c8b89a", {
        ColourA: [0.56, 0.48, 0.36],
        ColourB: [0.48, 0.41, 0.3],
        Scale: 1.4,
        Density: 0.5,
        Strength: 0.3,
        Gloss: 0.12,
        Coat: 0,
        Angle: 0,
        Variation: 0.3,
    }),
    Entry("raw-denim", "Raw denim", "fabric", "twill", "Indigo warp over pale weft.", "#2d4466", {
        ColourA: [0.045, 0.1, 0.24],
        ColourB: [0.56, 0.58, 0.6],
        Scale: 1.7,
        Density: 0.55,
        Strength: 0.35,
        Gloss: 0.16,
        Coat: 0,
        Angle: 30,
        Variation: 0.4,
    }),
    Entry("satin-silk", "Satin silk", "fabric", "satin", "Long floats, bright sheen.", "#b8486b", {
        ColourA: [0.45, 0.06, 0.14],
        ColourB: [0.62, 0.2, 0.28],
        Scale: 2.2,
        Density: 0.4,
        Strength: 0.18,
        Gloss: 0.72,
        Coat: 0.15,
        Angle: 0,
        Variation: 0.2,
    }),
    Entry("rib-knit", "Rib knit", "fabric", "knit", "Vertical ribs, soft hand.", "#6f7a66", {
        ColourA: [0.14, 0.18, 0.12],
        ColourB: [0.2, 0.24, 0.17],
        Scale: 1,
        Density: 0.6,
        Strength: 0.5,
        Gloss: 0.1,
        Coat: 0,
        Angle: 90,
        Variation: 0.35,
    }),
    Entry("crushed-velvet", "Crushed velvet", "fabric", "velvet", "All nap, no visible weave.", "#51215e", {
        ColourA: [0.09, 0.02, 0.14],
        ColourB: [0.3, 0.12, 0.38],
        Scale: 1.2,
        Density: 0.5,
        Strength: 0.8,
        Gloss: 0.3,
        Coat: 0,
        Angle: 0,
        Variation: 0.55,
    }),
    // Metal ---------------------------------------------------------------------------------------------------------
    Entry("brushed-steel", "Brushed steel", "metal", "brushed", "Long grain, workshop polish.", "#9aa1a8", {
        ColourA: [0.55, 0.57, 0.6],
        ColourB: [0.7, 0.72, 0.75],
        Scale: 1,
        Density: 0.2,
        Strength: 0.55,
        Gloss: 0.62,
        Coat: 0,
        Angle: 0,
        Variation: 0.2,
    }),
    Entry("brushed-brass", "Brushed brass", "metal", "brushed", "Warm grain, lacquer on top.", "#b08b3a", {
        ColourA: [0.64, 0.46, 0.15],
        ColourB: [0.78, 0.62, 0.3],
        Scale: 1.2,
        Density: 0.2,
        Strength: 0.45,
        Gloss: 0.7,
        Coat: 0.3,
        Angle: 90,
        Variation: 0.25,
    }),
    Entry("hammered-copper", "Hammered copper", "metal", "hammered", "Dents from the planishing hammer.", "#a9552f", {
        ColourA: [0.58, 0.2, 0.09],
        ColourB: [0.7, 0.35, 0.18],
        Scale: 1,
        Density: 0.35,
        Strength: 0.7,
        Gloss: 0.55,
        Coat: 0.1,
        Angle: 0,
        Variation: 0.3,
    }),
    Entry("cast-iron", "Cast iron", "metal", "cast", "Sand-cast, pitted, unpolished.", "#3f4247", {
        ColourA: [0.1, 0.105, 0.115],
        ColourB: [0.16, 0.16, 0.17],
        Scale: 1.3,
        Density: 0.6,
        Strength: 0.65,
        Gloss: 0.18,
        Coat: 0,
        Angle: 0,
        Variation: 0.3,
    }),
    Entry("galvanised-sheet", "Galvanised sheet", "metal", "galvanised", "Zinc spangle, cool and bright.", "#8e99a4", {
        ColourA: [0.45, 0.49, 0.54],
        ColourB: [0.66, 0.7, 0.74],
        Scale: 1,
        Density: 0.35,
        Strength: 0.5,
        Gloss: 0.5,
        Coat: 0,
        Angle: 0,
        Variation: 0.3,
    }),
    // Plastic -------------------------------------------------------------------------------------------------------
    Entry("abs-moulded", "Moulded ABS", "plastic", "moulded", "Clean injection finish.", "#d8d8d4", {
        ColourA: [0.68, 0.68, 0.66],
        ColourB: [0.78, 0.78, 0.76],
        Scale: 1,
        Density: 0.3,
        Strength: 0.25,
        Gloss: 0.72,
        Coat: 0.45,
        Angle: 0,
        Variation: 0.15,
    }),
    Entry("dash-grain", "Dashboard grain", "plastic", "pebbled", "Pebbled interior trim.", "#35373a", {
        ColourA: [0.035, 0.038, 0.042],
        ColourB: [0.08, 0.082, 0.086],
        Scale: 1.2,
        Density: 0.55,
        Strength: 0.6,
        Gloss: 0.22,
        Coat: 0.15,
        Angle: 0,
        Variation: 0.3,
    }),
    Entry("soft-touch", "Soft touch", "plastic", "soft", "Rubberised, almost no sheen.", "#2a2c2e", {
        ColourA: [0.028, 0.03, 0.033],
        ColourB: [0.05, 0.052, 0.055],
        Scale: 1,
        Density: 0.4,
        Strength: 0.4,
        Gloss: 0.1,
        Coat: 0,
        Angle: 0,
        Variation: 0.2,
    }),
    Entry("polycarbonate", "Polycarbonate", "plastic", "polycarbonate", "Hard, clear, faintly scratched.", "#b9c6cc", {
        ColourA: [0.52, 0.58, 0.62],
        ColourB: [0.82, 0.86, 0.9],
        Scale: 1,
        Density: 0.25,
        Strength: 0.35,
        Gloss: 0.94,
        Coat: 0.7,
        Angle: 15,
        Variation: 0.2,
    }),
];

export const FinishByIdentifier = Object.fromEntries(FinishShelf.map((Finish) => [Finish.Identifier, Finish]));

//--------------------------------------------------------------------------------------------------------------------------
// Records.
//--------------------------------------------------------------------------------------------------------------------------
export const FinishDefaults = () => ({
    Shelf: "gt-silver",
    Family: "automotive",
    Style: "metallic",
    ColourA: [0.4452, 0.4793, 0.5029],
    ColourB: [0.8069, 0.8324, 0.8469],
    Scale: 1.4,
    Flake: 3.2,
    Density: 0.72,
    Strength: 0.8,
    Tilt: 0.45,
    Gloss: 0.95,
    Coat: 0.9,
    Angle: 0,
    Peel: 0.3,
    Variation: 0.25,
    Seed: 3,
});

export const CreateFinish = (Identifier) =>
{
    const Entryx = FinishByIdentifier[Identifier];
    if (!Entryx) return FinishDefaults();
    return {
        ...FinishDefaults(),
        Shelf: Entryx.Identifier,
        Family: Entryx.Family,
        Style: Entryx.Style,
        ...structuredClone(Entryx.Settings),
        Seed: Math.round(Math.random() * 64),
    };
};

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Number.isFinite(Value) ? Value : Low));

export const SanitiseFinish = (Record) =>
{
    const Finish = { ...FinishDefaults(), ...(Record || {}) };
    const Family = FinishFamilyByIdentifier[Finish.Family] ? Finish.Family : "automotive";
    const Styles = FinishFamilyByIdentifier[Family].Styles;
    const Style = Styles.some((Entryy) => Entryy.Identifier === Finish.Style) ? Finish.Style : Styles[0].Identifier;
    const Colour = (Value, Fallback) =>
        Array.isArray(Value) && Value.length === 3 ? Value.map((Component) => Clamp(Component, 0, 1)) : Fallback;
    return {
        Shelf: FinishByIdentifier[Finish.Shelf] ? Finish.Shelf : "",
        Family,
        Style,
        ColourA: Colour(Finish.ColourA, [0.5, 0.5, 0.5]),
        ColourB: Colour(Finish.ColourB, [0.8, 0.8, 0.8]),
        Scale: Clamp(Finish.Scale, 0.1, 4),
        Flake: Clamp(Finish.Flake, 0.05, 24),
        Tilt: Clamp(Finish.Tilt, 0, 1),
        Density: Clamp(Finish.Density, 0, 1),
        Strength: Clamp(Finish.Strength, 0, 1),
        Gloss: Clamp(Finish.Gloss, 0, 1),
        Coat: Clamp(Finish.Coat, 0, 1),
        Angle: Clamp(Finish.Angle, 0, 180),
        Peel: Clamp(Finish.Peel, 0, 1),
        Variation: Clamp(Finish.Variation, 0, 1),
        Seed: Clamp(Math.round(Finish.Seed), 0, 999),
    };
};

export const FinishFamilyIndex = (Identifier) => FinishFamilyByIdentifier[Identifier]?.Index ?? 0;

export const FinishStyleIndex = (Family, Style) =>
{
    const Record = FinishFamilyByIdentifier[Family] || FinishFamilies[0];
    return Record.Styles.find((Entryz) => Entryz.Identifier === Style)?.Index ?? 0;
};

export const FinishBadge = (Finish) => FinishFamilyByIdentifier[Finish?.Family]?.Badge || "MATL";

export const FinishControls = (Family) => (FinishFamilyByIdentifier[Family] || FinishFamilies[0]).Controls;

export const FinishColours = (Family) => (FinishFamilyByIdentifier[Family] || FinishFamilies[0]).Colours;

export const FinishStyles = (Family) => (FinishFamilyByIdentifier[Family] || FinishFamilies[0]).Styles;

export const FinishLabel = (Finish) =>
{
    const Shelf = FinishByIdentifier[Finish?.Shelf];
    if (Shelf) return Shelf.Label;
    const Family = FinishFamilyByIdentifier[Finish?.Family];
    const Style = Family?.Styles.find((Record) => Record.Identifier === Finish?.Style);
    return Style ? `${Family.Label} · ${Style.Label}` : "Material";
};

//--------------------------------------------------------------------------------------------------------------------------
// Flake, for the shading pass.
//
// 🔴 A flake is not a texel and cannot be stored as one. Aluminium leaf is tens of microns across and lies at its own
//    angle, so the only honest place to evaluate it is per pixel, at shading time, where the eye and the lights are
//    known — which is also the only place a facet can FLARE. This is what the viewport is handed each frame for the
//    paint that is on top of the stack: everything the shading pass needs to grow the facets itself.
//
// Styles that carry something suspended in the basecoat answer; solid, matte and primer answer with nothing, which is
// what switches the whole pass off.
//--------------------------------------------------------------------------------------------------------------------------
export const FlakeStyles = ["metallic", "pearl", "candy", "chameleon"];

// 🔴 What colour a flake is, which is not always the colour of the leaf. A candy is a transparent tint laid over a
//    metallic ground, so what you see of a flake is the ground SEEN THROUGH the colour — hand the shading pass the
//    bare aluminium and every sparkle comes back white, which washes the red out of the one paint whose whole
//    purpose is depth of colour. Beer's law, at the mid thickness the finish shader uses.
const LeafColour = (Finish) =>
{
    const Ground = Array.isArray(Finish.ColourB) ? Finish.ColourB : [0.81, 0.83, 0.85];
    const Pigment = Array.isArray(Finish.ColourA) ? Finish.ColourA : [0.5, 0.5, 0.5];
    if (Finish.Style !== "candy") return Ground;
    return Ground.map((Component, Which) => Component * Math.max(Pigment[Which], 0.004) ** 1.375);
};

export const FlakeFromFinish = (Finish) =>
{
    if (!Finish || Finish.Family !== "automotive") return null;
    if (!FlakeStyles.includes(Finish.Style)) return null;
    const Weight = Clamp(Finish.Strength, 0, 1);
    const Density = Clamp(Finish.Density, 0, 1);
    if (Weight <= 0.001 || Density <= 0.001) return null;
    const Gloss = Clamp(Finish.Gloss, 0, 1);
    // 🔴 How metallic one flake is, and it has to agree with what the finish baked or the near field and the far
    //    field will not describe the same paint. A metallic basecoat writes density × 0.6 × brightness into
    //    metalness and nothing else, so a flake there is worth all of it. Mica is not metal and the pearl branch
    //    halves it; a candy's leaf is a fifth of a ground that is already metal; a flip is somewhere between. These
    //    are the same fractions the automotive branch of the finish shader uses, written once more in one place so
    //    the shading pass can take the leaf's share back out of the map it was given.
    const Metal = Weight * ({ metallic: 1, pearl: 0.5, candy: 0.45, chameleon: 0.6 }[Finish.Style] ?? 1);
    return {
        Weight,
        Metal,
        Density,
        Size: Clamp(Finish.Flake, 0.05, 24) * 0.001,                  // [m] the control is in millimetres on the panel
        Tilt: Clamp(Finish.Tilt, 0, 1),
        // Leaf is polished metal, far smoother than the pigment around it. A satin paint still has bright flakes; it
        // is the clear coat over them that is dulled, which is a different number entirely.
        Roughness: 0.03 + (1 - Gloss) * 0.22,
        // Mica travels with the angle, aluminium does not. Candy sits over an aluminium ground, chameleon over a
        // basecoat that is already travelling, so it only needs a little more from the leaf.
        Travel: Finish.Style === "pearl" ? 1 : Finish.Style === "chameleon" ? 0.55 : 0,
        Colour: LeafColour(Finish),
        Seed: Clamp(Math.round(Finish.Seed), 0, 999),
    };
};
