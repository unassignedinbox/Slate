//============================================================================================================================================
// 🧪 MaterialSpecification.js — OpenPBR surface constants and the smart-material library that builds layer stacks
//============================================================================================================================================
// Two halves:
//   ① SurfaceDefaults  — the OpenPBR Surface parameters that are constant across the whole surface (IOR, coat colour,
//                        fuzz colour, emission luminance, thin-film, authoring scales). Painted parameters live in
//                        ChannelSpecification.js instead.
//   ② MaterialLibrary  — smart materials. Each entry expands into one or more layers with their own channels, generators
//                        and masks, so applying a material is an edit of the stack rather than a hidden shader switch.
//============================================================================================================================================

//--------------------------------------------------------------------------------------------------------------------------
// ① Surface-wide OpenPBR parameters.
//--------------------------------------------------------------------------------------------------------------------------
export const SurfaceDefaults = {
    base_diffuse_roughness: 0.0,           // [-]    EON rough-diffuse width
    specular_color: [1, 1, 1],             // [-]    dielectric tint / F82 edge tint for metals
    specular_ior: 1.5,                     // [-]    interface index of refraction
    specular_roughness_anisotropy: 0.0,    // [-]    0 isotropic, 1 fully stretched along the tangent
    coat_color: [1, 1, 1],                 // [-]    coat absorption tint
    coat_ior: 1.6,                         // [-]    coat index of refraction
    coat_darkening: 1.0,                   // [-]    base darkening under total internal reflection
    fuzz_color: [1, 1, 1],                 // [-]    sheen tint
    fuzz_roughness: 0.5,                   // [-]    sheen lobe width
    emission_luminance: 0.0,               // [nit]  photometric emission multiplier
    transmission_color: [1, 1, 1],         // [-]    Beer–Lambert transmission tint
    transmission_depth: 0.04,              // [m]    absorption distance
    thin_film_weight: 0.0,                 // [-]    Belcour–Barla iridescence weight
    thin_film_thickness: 0.5,              // [µm]   film thickness
    thin_film_ior: 1.4,                    // [-]    film index of refraction
    geometry_thin_walled: false,           // [-]    thin-sheet transmission
    normal_intensity: 1.0,                 // [-]    authoring: height → geometry_normal gain
    height_scale: 4.0,                     // [mm]   authoring: displacement range mapped onto the height channel
    texture_scale: 1.0,                    // [-]    authoring: UV multiplier for every procedural generator
};

export const SurfaceControls = [
    { Identifier: "base_diffuse_roughness", Label: "Diffuse roughness", Group: "Base", Minimum: 0, Maximum: 1, Step: 0.01, Unit: "—" },
    { Identifier: "specular_color", Label: "Specular colour", Group: "Specular", Kind: "color" },
    { Identifier: "specular_ior", Label: "Specular IOR", Group: "Specular", Minimum: 1, Maximum: 3, Step: 0.01, Unit: "n" },
    { Identifier: "specular_roughness_anisotropy", Label: "Anisotropy", Group: "Specular", Minimum: 0, Maximum: 1, Step: 0.01, Unit: "—" },
    { Identifier: "coat_color", Label: "Coat colour", Group: "Coat", Kind: "color" },
    { Identifier: "coat_ior", Label: "Coat IOR", Group: "Coat", Minimum: 1, Maximum: 2.5, Step: 0.01, Unit: "n" },
    { Identifier: "coat_darkening", Label: "Coat darkening", Group: "Coat", Minimum: 0, Maximum: 1, Step: 0.01, Unit: "—" },
    { Identifier: "fuzz_color", Label: "Fuzz colour", Group: "Fuzz", Kind: "color" },
    { Identifier: "fuzz_roughness", Label: "Fuzz roughness", Group: "Fuzz", Minimum: 0, Maximum: 1, Step: 0.01, Unit: "—" },
    { Identifier: "emission_luminance", Label: "Emission", Group: "Emission", Minimum: 0, Maximum: 40, Step: 0.1, Unit: "nit" },
    { Identifier: "transmission_color", Label: "Transmission tint", Group: "Transmission", Kind: "color" },
    { Identifier: "transmission_depth", Label: "Absorption depth", Group: "Transmission", Minimum: 0.001, Maximum: 0.5, Step: 0.001, Unit: "m" },
    { Identifier: "thin_film_weight", Label: "Thin film", Group: "Thin film", Minimum: 0, Maximum: 1, Step: 0.01, Unit: "—" },
    { Identifier: "thin_film_thickness", Label: "Film thickness", Group: "Thin film", Minimum: 0.1, Maximum: 3, Step: 0.01, Unit: "µm" },
    { Identifier: "thin_film_ior", Label: "Film IOR", Group: "Thin film", Minimum: 1, Maximum: 3, Step: 0.01, Unit: "n" },
    { Identifier: "normal_intensity", Label: "Normal intensity", Group: "Geometry", Minimum: 0, Maximum: 4, Step: 0.01, Unit: "—" },
    { Identifier: "height_scale", Label: "Height range", Group: "Geometry", Minimum: 0, Maximum: 24, Step: 0.1, Unit: "mm" },
    { Identifier: "texture_scale", Label: "Texture scale", Group: "Geometry", Minimum: 0.1, Maximum: 8, Step: 0.05, Unit: "×" },
];

//--------------------------------------------------------------------------------------------------------------------------
// ② Smart-material library. Values are sRGB triples in 0..1 so that the inspector swatches round-trip exactly.
//--------------------------------------------------------------------------------------------------------------------------
export const MaterialCategories = [
    { Identifier: "all", Label: "All" },
    { Identifier: "metal", Label: "Metal" },
    { Identifier: "mineral", Label: "Mineral" },
    { Identifier: "organic", Label: "Organic" },
    { Identifier: "coated", Label: "Coated" },
    { Identifier: "effect", Label: "Effect" },
];

//--------------------------------------------------------------------------------------------------------------------------
// Conductors.
//
// A metal is not a colour with the metalness slider pushed up. Its reflectance is complex-valued and varies across the
// spectrum, which is why gold looks like gold at a glancing angle as well as head-on — and why a metal rendered with a
// single Schlick term always reads as painted plastic at the silhouette.
//
// OpenPBR takes Kutz's F82-tint form for conductors: the colour at normal incidence, and a second colour at the angle
// where a real conductor dips before it climbs back to white. So every metal here carries BOTH — `Reflectance` is the
// facing colour and `EdgeTint` is the dip, read off the published n and k at 600/550/450 nm. Both are linear light,
// not sRGB, because that is what the shading multiplies by.
//
// `Roughness` is a plausible mill finish for the metal rather than a property of it; `Anisotropy` is how directional
// that finish is, which for a rolled or brushed sheet is most of what tells you which metal you are looking at.
//--------------------------------------------------------------------------------------------------------------------------

export const MetalArchive = [
    { Identifier: "aluminium", Label: "Aluminium", Note: "Rolled 6061 · n 1.35 k 7.47", Reflectance: [0.912, 0.914, 0.92], EdgeTint: [0.97, 0.97, 0.98], Roughness: 0.22, Anisotropy: 0.55 },
    { Identifier: "silver", Label: "Silver", Note: "Sterling · the brightest of them", Reflectance: [0.962, 0.949, 0.922], EdgeTint: [0.999, 0.998, 0.998], Roughness: 0.06, Anisotropy: 0 },
    { Identifier: "chrome", Label: "Chrome", Note: "Plated · faintly blue", Reflectance: [0.55, 0.556, 0.554], EdgeTint: [0.86, 0.9, 0.95], Roughness: 0.04, Anisotropy: 0 },
    { Identifier: "gold", Label: "Gold", Note: "24 ct · n 0.27 k 2.78", Reflectance: [1, 0.766, 0.336], EdgeTint: [1, 0.91, 0.75], Roughness: 0.1, Anisotropy: 0 },
    { Identifier: "copper", Label: "Copper", Note: "Freshly turned", Reflectance: [0.955, 0.638, 0.538], EdgeTint: [0.995, 0.826, 0.762], Roughness: 0.16, Anisotropy: 0.2 },
    { Identifier: "brass", Label: "Brass", Note: "70/30 cartridge", Reflectance: [0.887, 0.789, 0.434], EdgeTint: [0.98, 0.93, 0.78], Roughness: 0.2, Anisotropy: 0.35 },
    { Identifier: "bronze", Label: "Bronze", Note: "Cast, unpatinated", Reflectance: [0.714, 0.428, 0.181], EdgeTint: [0.93, 0.8, 0.62], Roughness: 0.34, Anisotropy: 0.1 },
    { Identifier: "iron", Label: "Iron", Note: "Clean, unoxidised", Reflectance: [0.56, 0.57, 0.58], EdgeTint: [0.82, 0.84, 0.86], Roughness: 0.38, Anisotropy: 0.15 },
    { Identifier: "steel", Label: "Stainless", Note: "304 · 2B mill finish", Reflectance: [0.66, 0.67, 0.68], EdgeTint: [0.9, 0.92, 0.94], Roughness: 0.26, Anisotropy: 0.6 },
    { Identifier: "titanium", Label: "Titanium", Note: "Grade 5 · warm grey", Reflectance: [0.616, 0.582, 0.544], EdgeTint: [0.88, 0.87, 0.86], Roughness: 0.3, Anisotropy: 0.4 },
    { Identifier: "nickel", Label: "Nickel", Note: "Plated · slightly yellow", Reflectance: [0.66, 0.609, 0.526], EdgeTint: [0.9, 0.88, 0.84], Roughness: 0.18, Anisotropy: 0 },
    { Identifier: "platinum", Label: "Platinum", Note: "Neutral, dense", Reflectance: [0.679, 0.642, 0.588], EdgeTint: [0.92, 0.91, 0.9], Roughness: 0.14, Anisotropy: 0 },
    { Identifier: "zinc", Label: "Galvanised zinc", Note: "Hot-dip · spangled", Reflectance: [0.664, 0.824, 0.85], EdgeTint: [0.9, 0.95, 0.96], Roughness: 0.44, Anisotropy: 0 },
    { Identifier: "lead", Label: "Lead", Note: "Soft, dull, blue-grey", Reflectance: [0.632, 0.626, 0.641], EdgeTint: [0.84, 0.85, 0.88], Roughness: 0.52, Anisotropy: 0 },
];

export const MetalByIdentifier = Object.fromEntries(MetalArchive.map((Entry) => [Entry.Identifier, Entry]));

// A conductor as a one-layer material: the facing colour as base, the dip as the material's specular colour, and the
// mill finish it usually comes with. Anything worked into the surface afterwards goes on as layers above it.
export const MetalPreset = (Identifier, Overrides = {}) =>
{
    const Metal = MetalByIdentifier[Identifier];
    if (!Metal) return null;
    const Swatch = Metal.Reflectance
        .map((Component) => Math.round(Math.min(1, Math.max(0, Component)) ** (1 / 2.2) * 255).toString(16).padStart(2, "0"))
        .join("");
    return {
        Identifier: `metal-${Metal.Identifier}`,
        Label: Metal.Label,
        Category: "metal",
        Note: Metal.Note,
        Swatch: `#${Swatch}`,
        Surface: {
            specular_color: [...Metal.EdgeTint],
            specular_roughness_anisotropy: Metal.Anisotropy,
            specular_ior: 2.4,
        },
        Layers: [
            {
                Name: Metal.Label,
                Kind: "fill",
                Channels: {
                    base_color: [...Metal.Reflectance],
                    base_metalness: 1,
                    specular_roughness: Metal.Roughness,
                    specular_weight: 1,
                },
            },
        ],
        ...Overrides,
    };
};

export const MaterialLibrary = [
    {
        Identifier: "brushed-aluminium",
        Label: "Brushed aluminium",
        Category: "metal",
        Note: "Anisotropic mill finish · 6061",
        Swatch: "#b9bcc0",
        Surface: { specular_roughness_anisotropy: 0.65, specular_ior: 1.5 },
        Layers: [
            {
                Name: "Aluminium",
                Kind: "fill",
                Channels: { base_color: [0.68, 0.7, 0.72], base_metalness: 1, specular_roughness: 0.3, specular_weight: 1 },
            },
            {
                Name: "Mill scratches",
                Kind: "generator",
                Blend: "overlay",
                Opacity: 0.55,
                Generator: { Kind: "scratches", Scale: 7, Contrast: 0.7, Angle: 0, Detail: 3 },
                Channels: { specular_roughness: 0.52, height: 0.52 },
            },
        ],
    },
    {
        Identifier: "polished-gold",
        Label: "Polished gold",
        Category: "metal",
        Note: "24 ct · F82 edge tint",
        Swatch: "#d4a24a",
        Surface: { specular_color: [1, 0.86, 0.62] },
        Layers: [
            {
                Name: "Gold",
                Kind: "fill",
                Channels: { base_color: [1, 0.77, 0.34], base_metalness: 1, specular_roughness: 0.08, specular_weight: 1 },
            },
        ],
    },
    {
        Identifier: "rusted-iron",
        Label: "Rusted iron",
        Category: "metal",
        Note: "Pitted oxide over cast iron",
        Swatch: "#7c4a2d",
        Layers: [
            {
                Name: "Cast iron",
                Kind: "fill",
                Channels: { base_color: [0.26, 0.26, 0.27], base_metalness: 1, specular_roughness: 0.42 },
            },
            {
                Name: "Oxide field",
                Kind: "generator",
                Opacity: 0.95,
                Generator: { Kind: "fbm", Scale: 4.5, Detail: 6, Contrast: 0.62, Warp: 0.4, Balance: 0.45 },
                Channels: { base_color: [0.42, 0.18, 0.08], base_metalness: 0, specular_roughness: 0.86, height: 0.57 },
            },
            {
                Name: "Pitting",
                Kind: "generator",
                Opacity: 0.7,
                Generator: { Kind: "cells", Scale: 26, Contrast: 0.78, Balance: 0.62 },
                Channels: { base_color: [0.2, 0.09, 0.04], specular_roughness: 0.95, height: 0.4, ambient_occlusion: 0.55 },
                Mask: { Kind: "fbm", Scale: 3, Contrast: 0.5, Balance: 0.42 },
            },
        ],
    },
    {
        Identifier: "copper-patina",
        Label: "Copper patina",
        Category: "metal",
        Note: "Verdigris in the cavities",
        Swatch: "#6f9c84",
        Layers: [
            {
                Name: "Copper",
                Kind: "fill",
                Channels: { base_color: [0.95, 0.64, 0.54], base_metalness: 1, specular_roughness: 0.26 },
            },
            {
                Name: "Verdigris",
                Kind: "generator",
                Opacity: 0.9,
                Generator: { Kind: "fbm", Scale: 6, Detail: 5, Contrast: 0.55, Warp: 0.65, Balance: 0.52 },
                Channels: { base_color: [0.3, 0.56, 0.47], base_metalness: 0, specular_roughness: 0.78, height: 0.54 },
                Mask: { Kind: "cavity", Contrast: 0.6, Balance: 0.45 },
            },
        ],
    },
    {
        Identifier: "car-coat",
        Label: "Automotive coat",
        Category: "coated",
        Note: "Metallic flake under 2K lacquer",
        Swatch: "#2f4f82",
        Surface: { coat_ior: 1.55, coat_darkening: 0.85 },
        Layers: [
            {
                Name: "Base coat",
                Kind: "fill",
                Channels: {
                    base_color: [0.07, 0.14, 0.32],
                    base_metalness: 0.15,
                    specular_roughness: 0.3,
                    coat_weight: 1,
                    coat_roughness: 0.035,
                },
            },
            {
                Name: "Metallic flake",
                Kind: "generator",
                Blend: "overlay",
                Opacity: 0.45,
                Generator: { Kind: "cells", Scale: 180, Contrast: 0.85, Balance: 0.55 },
                Channels: { base_metalness: 0.9, specular_roughness: 0.18, base_color: [0.55, 0.62, 0.78] },
            },
        ],
    },
    {
        Identifier: "glossy-ceramic",
        Label: "Glazed ceramic",
        Category: "coated",
        Note: "Fired porcelain with a thin glaze",
        Swatch: "#e7e3dc",
        Layers: [
            {
                Name: "Porcelain",
                Kind: "fill",
                Channels: {
                    base_color: [0.92, 0.9, 0.87],
                    base_metalness: 0,
                    specular_roughness: 0.12,
                    coat_weight: 0.6,
                    coat_roughness: 0.04,
                },
            },
            {
                Name: "Glaze pooling",
                Kind: "generator",
                Blend: "multiply",
                Opacity: 0.35,
                Generator: { Kind: "fbm", Scale: 3, Detail: 4, Contrast: 0.35, Warp: 0.2 },
                Channels: { base_color: [0.82, 0.85, 0.88], specular_roughness: 0.2 },
            },
        ],
    },
    {
        Identifier: "matte-polymer",
        Label: "Matte polymer",
        Category: "coated",
        Note: "Injection-moulded ABS, bead blasted",
        Swatch: "#4b4e52",
        Layers: [
            {
                Name: "ABS",
                Kind: "fill",
                Channels: { base_color: [0.19, 0.2, 0.22], base_metalness: 0, specular_roughness: 0.62, specular_weight: 0.75 },
            },
            {
                Name: "Blast texture",
                Kind: "generator",
                Opacity: 0.5,
                Generator: { Kind: "fbm", Scale: 90, Detail: 2, Contrast: 0.5 },
                Channels: { specular_roughness: 0.72, height: 0.52 },
            },
        ],
    },
    {
        Identifier: "oak-plank",
        Label: "Oak plank",
        Category: "organic",
        Note: "Quarter-sawn grain, satin oil",
        Swatch: "#9a6a3c",
        Layers: [
            {
                Name: "Oak",
                Kind: "fill",
                Channels: { base_color: [0.54, 0.36, 0.2], base_metalness: 0, specular_roughness: 0.48 },
            },
            {
                Name: "Grain",
                Kind: "generator",
                Blend: "multiply",
                Opacity: 0.8,
                Generator: { Kind: "wood", Scale: 9, Detail: 5, Contrast: 0.6, Warp: 0.5, Angle: 90 },
                Channels: { base_color: [0.3, 0.17, 0.08], specular_roughness: 0.56, height: 0.46 },
            },
        ],
    },
    {
        Identifier: "worn-leather",
        Label: "Worn leather",
        Category: "organic",
        Note: "Pebble grain with edge polish",
        Swatch: "#6b4530",
        Layers: [
            {
                Name: "Leather",
                Kind: "fill",
                Channels: { base_color: [0.24, 0.14, 0.09], specular_roughness: 0.58, fuzz_weight: 0.18 },
            },
            {
                Name: "Pebble grain",
                Kind: "generator",
                Opacity: 0.75,
                Generator: { Kind: "cells", Scale: 46, Contrast: 0.5, Balance: 0.5 },
                Channels: { height: 0.62, specular_roughness: 0.52, ambient_occlusion: 0.82 },
            },
            {
                Name: "Edge polish",
                Kind: "generator",
                Blend: "screen",
                Opacity: 0.6,
                Generator: { Kind: "curvature", Contrast: 0.7, Balance: 0.55 },
                Channels: { specular_roughness: 0.3, base_color: [0.42, 0.28, 0.18] },
            },
        ],
    },
    {
        Identifier: "woven-fabric",
        Label: "Woven fabric",
        Category: "organic",
        Note: "Twill weave with a fuzz lobe",
        Swatch: "#39506b",
        Surface: { fuzz_roughness: 0.4, fuzz_color: [0.9, 0.93, 1] },
        Layers: [
            {
                Name: "Denim",
                Kind: "fill",
                Channels: { base_color: [0.15, 0.22, 0.34], specular_roughness: 0.88, fuzz_weight: 0.85, specular_weight: 0.4 },
            },
            {
                Name: "Weave",
                Kind: "generator",
                Opacity: 0.85,
                Generator: { Kind: "weave", Scale: 110, Contrast: 0.6 },
                Channels: { height: 0.6, ambient_occlusion: 0.8, base_color: [0.2, 0.28, 0.42] },
            },
        ],
    },
    {
        Identifier: "carbon-weave",
        Label: "Carbon fibre",
        Category: "coated",
        Note: "2 × 2 twill under clear coat",
        Swatch: "#232528",
        Layers: [
            {
                Name: "Resin",
                Kind: "fill",
                Channels: { base_color: [0.04, 0.04, 0.045], base_metalness: 0.1, specular_roughness: 0.22, coat_weight: 1, coat_roughness: 0.03 },
            },
            {
                Name: "Tow",
                Kind: "generator",
                Opacity: 1,
                Generator: { Kind: "weave", Scale: 42, Contrast: 0.85 },
                Channels: { base_color: [0.1, 0.1, 0.11], specular_roughness: 0.3, base_metalness: 0.4, height: 0.56 },
            },
        ],
    },
    {
        Identifier: "cast-concrete",
        Label: "Cast concrete",
        Category: "mineral",
        Note: "Board-formed, air pockets",
        Swatch: "#8a8880",
        Layers: [
            {
                Name: "Concrete",
                Kind: "fill",
                Channels: { base_color: [0.52, 0.51, 0.48], specular_roughness: 0.84, specular_weight: 0.5 },
            },
            {
                Name: "Aggregate",
                Kind: "generator",
                Opacity: 0.6,
                Generator: { Kind: "fbm", Scale: 28, Detail: 5, Contrast: 0.55 },
                Channels: { base_color: [0.4, 0.39, 0.37], height: 0.47, specular_roughness: 0.9 },
            },
            {
                Name: "Air pockets",
                Kind: "generator",
                Opacity: 0.5,
                Generator: { Kind: "cells", Scale: 60, Contrast: 0.9, Balance: 0.78 },
                Channels: { height: 0.34, ambient_occlusion: 0.45, base_color: [0.3, 0.29, 0.28] },
            },
        ],
    },
    {
        Identifier: "frosted-glass",
        Label: "Frosted glass",
        Category: "effect",
        Note: "Acid-etched soda lime",
        Swatch: "#9fb6bd",
        Surface: { transmission_color: [0.86, 0.94, 0.95], transmission_depth: 0.12, specular_ior: 1.52 },
        Layers: [
            {
                Name: "Glass",
                Kind: "fill",
                Channels: {
                    base_color: [0.92, 0.96, 0.97],
                    specular_roughness: 0.18,
                    base_metalness: 0,
                    transmission_weight: 1,
                    specular_weight: 1,
                },
            },
            {
                Name: "Etch",
                Kind: "generator",
                Opacity: 0.7,
                Generator: { Kind: "fbm", Scale: 50, Detail: 3, Contrast: 0.4 },
                Channels: { specular_roughness: 0.46, height: 0.52 },
            },
        ],
    },
    {
        Identifier: "iridescent-film",
        Label: "Iridescent film",
        Category: "effect",
        Note: "Thin-film interference over steel",
        Swatch: "#8f6fae",
        Surface: { thin_film_weight: 1, thin_film_thickness: 0.62, thin_film_ior: 1.45 },
        Layers: [
            {
                Name: "Steel",
                Kind: "fill",
                Channels: { base_color: [0.56, 0.57, 0.58], base_metalness: 1, specular_roughness: 0.16 },
            },
            {
                Name: "Film thickness",
                Kind: "generator",
                Blend: "overlay",
                Opacity: 0.6,
                Generator: { Kind: "fbm", Scale: 5, Detail: 4, Contrast: 0.4, Warp: 0.8 },
                Channels: { specular_roughness: 0.22, base_color: [0.68, 0.6, 0.72] },
            },
        ],
    },
    {
        Identifier: "edge-wear",
        Label: "Edge wear",
        Category: "effect",
        Note: "Modifier · exposes metal on convex edges",
        Swatch: "#cfd2d6",
        Modifier: true,
        Layers: [
            {
                Name: "Edge wear",
                Kind: "generator",
                Opacity: 0.9,
                Generator: { Kind: "curvature", Contrast: 0.75, Balance: 0.62 },
                Channels: { base_color: [0.78, 0.79, 0.8], base_metalness: 1, specular_roughness: 0.22 },
            },
        ],
    },
    {
        Identifier: "settled-dust",
        Label: "Settled dust",
        Category: "effect",
        Note: "Modifier · accumulates on up-facing texels",
        Swatch: "#b3a894",
        Modifier: true,
        Layers: [
            {
                Name: "Settled dust",
                Kind: "generator",
                Opacity: 0.7,
                Generator: { Kind: "occlusion", Contrast: 0.5, Balance: 0.5 },
                Channels: { base_color: [0.62, 0.58, 0.5], specular_roughness: 0.92, base_metalness: 0, fuzz_weight: 0.3 },
                Mask: { Kind: "fbm", Scale: 10, Contrast: 0.4, Balance: 0.4 },
            },
        ],
    },
];

// Every conductor in the archive is a preset in its own right, after the hand-built ones so the shelf opens on those.
MaterialLibrary.push(
    ...MetalArchive.map((Metal) => MetalPreset(Metal.Identifier)).filter(Boolean),
    {
        Identifier: "machined-titanium",
        Label: "Machined titanium",
        Category: "metal",
        Note: "Turned face · concentric tool marks",
        Swatch: "#8f8a84",
        Surface: { specular_color: [0.88, 0.87, 0.86], specular_roughness_anisotropy: 0.78 },
        Layers: [
            {
                Name: "Titanium",
                Kind: "fill",
                Channels: { base_color: [0.616, 0.582, 0.544], base_metalness: 1, specular_roughness: 0.24, specular_weight: 1 },
            },
            {
                Name: "Tool marks",
                Kind: "generator",
                Blend: "overlay",
                Opacity: 0.6,
                Generator: { Kind: "scratches", Scale: 12, Contrast: 0.8, Angle: 90, Detail: 4 },
                Channels: { specular_roughness: 0.44, height: 0.53 },
            },
        ],
    },
    {
        Identifier: "flake-metallic",
        Label: "Metallic basecoat",
        Category: "effect",
        Note: "Aluminium leaf in pigment, under clear",
        Swatch: "#2f4f7a",
        Surface: { coat_ior: 1.5, coat_darkening: 0.6 },
        Layers: [
            {
                Name: "Metallic paint",
                Kind: "finish",
                Finish: { Family: "automotive", Style: "metallic", Flake: 2.4, Tilt: 0.65, Density: 0.5, Strength: 0.7 },
                // The finish decides what these end up as per texel; they are what the layer reads as before it does.
                Channels: { base_color: [0.1, 0.19, 0.34], base_metalness: 0.2, specular_roughness: 0.14, coat_weight: 0.9 },
            },
        ],
    },
);

export const MaterialByIdentifier = Object.fromEntries(
    MaterialLibrary.map((Material) => [Material.Identifier, Material]),
);

//--------------------------------------------------------------------------------------------------------------------------
// The environment moved out. A sky is a recipe now rather than three colours, and a recipe with a sun in it is a file
// of its own — but half the editor reaches for these names through this module, so they keep arriving from here.
//--------------------------------------------------------------------------------------------------------------------------
export {
    EnvironmentOrdering,
    EnvironmentByIdentifier,
    EnvironmentIndex,
    LightOrdering,
    DefaultLights,
    LightVector,
    SunDefaults,
    SanitiseSun,
    SunVector,
    WarmthColour,
} from "./EnvironmentSpecification.js";
