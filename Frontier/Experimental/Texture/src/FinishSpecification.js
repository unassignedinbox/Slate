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
            { Identifier: "metallic", Label: "Metallic flake", Index: 0 },
            { Identifier: "candy", Label: "Candy pearl", Index: 1 },
            { Identifier: "matte", Label: "Matte wrap", Index: 2 },
            { Identifier: "primer", Label: "Primer", Index: 3 },
        ],
        Colours: [
            { Key: "ColourA", Label: "Body colour" },
            { Key: "ColourB", Label: "Flake colour" },
        ],
        Controls: [
            Control("Scale", "Flake scale", 0.1, 4, 0.01, "×", "Smaller flakes read as a finer metallic."),
            Control("Density", "Flake density", 0, 1, 0.01, "—"),
            Control("Strength", "Flake brightness", 0, 1, 0.01, "—"),
            Control("Gloss", "Gloss", 0, 1, 0.01, "—"),
            Control("Coat", "Clear coat", 0, 1, 0.01, "—"),
            Control("Angle", "Flake angle", 0, 180, 1, "°"),
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
    Entry("showroom-red", "Showroom red", "automotive", "metallic", "Fine flake under deep clear coat.", "#b1121f", {
        ColourA: [0.42, 0.012, 0.02],
        ColourB: [0.92, 0.72, 0.6],
        Scale: 1.3,
        Density: 0.4,
        Strength: 0.55,
        Gloss: 0.96,
        Coat: 0.9,
        Angle: 0,
        Variation: 0.25,
    }),
    Entry("gunmetal-flake", "Gunmetal flake", "automotive", "metallic", "Coarse silver flake, factory grey.", "#4a4f55", {
        ColourA: [0.055, 0.062, 0.072],
        ColourB: [0.8, 0.84, 0.9],
        Scale: 0.7,
        Density: 0.55,
        Strength: 0.7,
        Gloss: 0.92,
        Coat: 0.85,
        Angle: 0,
        Variation: 0.2,
    }),
    Entry("candy-blue", "Candy blue", "automotive", "candy", "Two pigments shifting under lacquer.", "#1f4fd8", {
        ColourA: [0.02, 0.05, 0.42],
        ColourB: [0.45, 0.12, 0.62],
        Scale: 1.8,
        Density: 0.3,
        Strength: 0.5,
        Gloss: 0.98,
        Coat: 1,
        Angle: 0,
        Variation: 0.5,
    }),
    Entry("satin-wrap", "Satin wrap", "automotive", "matte", "Vinyl wrap, no shine to speak of.", "#2c3034", {
        ColourA: [0.04, 0.045, 0.05],
        ColourB: [0.1, 0.11, 0.12],
        Scale: 1,
        Density: 0.2,
        Strength: 0.4,
        Gloss: 0.18,
        Coat: 0.25,
        Angle: 0,
        Variation: 0.35,
    }),
    Entry("etch-primer", "Etch primer", "automotive", "primer", "Chalky grey, ready for colour.", "#8a8b86", {
        ColourA: [0.26, 0.26, 0.25],
        ColourB: [0.17, 0.17, 0.17],
        Scale: 1.1,
        Density: 0.5,
        Strength: 0.35,
        Gloss: 0.1,
        Coat: 0.05,
        Angle: 0,
        Variation: 0.3,
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
    Shelf: "showroom-red",
    Family: "automotive",
    Style: "metallic",
    ColourA: [0.42, 0.012, 0.02],
    ColourB: [0.92, 0.72, 0.6],
    Scale: 1.3,
    Density: 0.4,
    Strength: 0.55,
    Gloss: 0.96,
    Coat: 0.9,
    Angle: 0,
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
        Density: Clamp(Finish.Density, 0, 1),
        Strength: Clamp(Finish.Strength, 0, 1),
        Gloss: Clamp(Finish.Gloss, 0, 1),
        Coat: Clamp(Finish.Coat, 0, 1),
        Angle: Clamp(Finish.Angle, 0, 180),
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
