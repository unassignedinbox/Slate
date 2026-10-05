//============================================================================================================================================
// 🎛 ChannelSpecification.js — OpenPBR Surface channel contract, texture packing and blend algebra for the texture stack
//============================================================================================================================================
// Identifiers follow OpenPBR Surface v1.1.1 §5 (base / specular / transmission / coat / fuzz / emission / geometry groups).
// Two authoring channels that OpenPBR does not define are carried alongside them: `height` (displacement in millimetres, the
// source of `geometry_normal`) and `ambient_occlusion` (a shading-only attenuation term). Everything a brush, decal or
// generator can write per texel lives here; everything constant across the surface lives in MaterialSpecification.js.
//============================================================================================================================================

//--------------------------------------------------------------------------------------------------------------------------
// Packing — four RGBA8 render targets, the WebGL2 guaranteed minimum for MRT (gl.MAX_DRAW_BUFFERS ≥ 4).
//--------------------------------------------------------------------------------------------------------------------------
export const ChannelTargets = 4;

export const ChannelSpecification = [
    {
        Identifier: "base_color",
        Label: "Base colour",
        Group: "Base",
        Kind: "color",
        Target: 0,
        Swizzle: "rgb",
        Default: [0.72, 0.72, 0.74],
        Encoding: "srgb",
        Export: "BaseColor",
        Hint: "Diffuse albedo for dielectrics, reflectance for metals.",
    },
    {
        Identifier: "geometry_opacity",
        Label: "Opacity",
        Group: "Geometry",
        Kind: "scalar",
        Target: 0,
        Swizzle: "a",
        Default: 1,
        Encoding: "linear",
        Export: "Opacity",
        Hint: "Geometric coverage. Below 0.5 the surface is cut away in the viewport.",
    },
    {
        Identifier: "specular_roughness",
        Label: "Roughness",
        Group: "Specular",
        Kind: "scalar",
        Target: 1,
        Swizzle: "r",
        Default: 0.42,
        Encoding: "linear",
        Export: "Roughness",
        Hint: "GGX α source. 0 is a mirror, 1 is fully diffuse scattering.",
    },
    {
        Identifier: "base_metalness",
        Label: "Metalness",
        Group: "Base",
        Kind: "scalar",
        Target: 1,
        Swizzle: "g",
        Default: 0,
        Encoding: "linear",
        Export: "Metalness",
        Hint: "Metal ↔ glossy-dielectric mix. Intermediate values are transition texels only.",
    },
    {
        Identifier: "ambient_occlusion",
        Label: "Occlusion",
        Group: "Geometry",
        Kind: "scalar",
        Target: 1,
        Swizzle: "b",
        Default: 1,
        Encoding: "linear",
        Export: "Occlusion",
        Hint: "Authoring channel. Attenuates indirect diffuse and the ambient specular term.",
    },
    {
        Identifier: "height",
        Label: "Height",
        Group: "Geometry",
        Kind: "scalar",
        Target: 1,
        Swizzle: "a",
        Default: 0.5,
        Encoding: "linear",
        Export: "Height",
        Hint: "Signed displacement around 0.5. Differentiated into geometry_normal at shade time.",
    },
    {
        Identifier: "specular_weight",
        Label: "Specular weight",
        Group: "Specular",
        Kind: "scalar",
        Target: 2,
        Swizzle: "r",
        Default: 1,
        Encoding: "linear",
        Export: "SpecularWeight",
        Hint: "Scales the dielectric interface lobe. 0 removes the reflection entirely.",
    },
    {
        Identifier: "coat_weight",
        Label: "Coat weight",
        Group: "Coat",
        Kind: "scalar",
        Target: 2,
        Swizzle: "g",
        Default: 0,
        Encoding: "linear",
        Export: "CoatWeight",
        Hint: "Clear-coat presence. Darkens and re-Fresnels the slab beneath it.",
    },
    {
        Identifier: "coat_roughness",
        Label: "Coat roughness",
        Group: "Coat",
        Kind: "scalar",
        Target: 2,
        Swizzle: "b",
        Default: 0.06,
        Encoding: "linear",
        Export: "CoatRoughness",
        Hint: "Roughness of the coat interface, independent of the base slab.",
    },
    {
        Identifier: "fuzz_weight",
        Label: "Fuzz weight",
        Group: "Fuzz",
        Kind: "scalar",
        Target: 2,
        Swizzle: "a",
        Default: 0,
        Encoding: "linear",
        Export: "FuzzWeight",
        Hint: "Sheen lobe for cloth, velvet and settled dust.",
    },
    {
        Identifier: "emission_color",
        Label: "Emission colour",
        Group: "Emission",
        Kind: "color",
        Target: 3,
        Swizzle: "rgb",
        Default: [0, 0, 0],
        Encoding: "srgb",
        Export: "Emission",
        Hint: "Multiplied by emission_luminance [nit] from the surface material.",
    },
    {
        Identifier: "transmission_weight",
        Label: "Transmission",
        Group: "Transmission",
        Kind: "scalar",
        Target: 3,
        Swizzle: "a",
        Default: 0,
        Encoding: "linear",
        Export: "Transmission",
        Hint: "Refractive transport through the slab, tinted by transmission_color.",
    },
];

//--------------------------------------------------------------------------------------------------------------------------
// Painted channel values. A stroke carries the channel values that were in hand when it was laid down, not the layer's —
// paint a rivet at metalness 1, change the inspector, paint a scuff at roughness 0.6, and both keep what they were given.
// That needs somewhere per texel to put them, so a painted layer grows three more images beside its coverage, packed to
// mirror the composite targets. Coverage already holds base colour times alpha in its own alpha, so twelve components
// are left over and twelve is exactly what three RGBA8 images hold. Every value is stored premultiplied by the same
// coverage alpha, which makes the ordinary source-over blend during stamping do the right thing for free.
//
// `geometry_opacity` is the one channel that stays a layer constant: it is a cut-out for the whole material, and a
// stroke's own alpha already says how much of it is there.
//--------------------------------------------------------------------------------------------------------------------------
export const PaintedImages = [
    { Slot: "Surfacing", Target: "surfacing", Channels: ["specular_roughness", "base_metalness", "ambient_occlusion", "height"] },
    { Slot: "Coating", Target: "coating", Channels: ["specular_weight", "coat_weight", "coat_roughness", "fuzz_weight"] },
    { Slot: "Radiance", Target: "radiance", Channels: ["emission_color.r", "emission_color.g", "emission_color.b", "transmission_weight"] },
];

export const PaintedSlots = PaintedImages.map((Image) => Image.Slot);

export const PaintedTargets = PaintedImages.map((Image) => Image.Target);

export const PaintedSlotForTarget = Object.fromEntries(PaintedImages.map((Image) => [Image.Target, Image.Slot]));

// The twelve numbers in packing order, read out of a layer's channel values. One of these is held against the next for
// every dab: identical means the layer is still uniform and needs no images, different means it has to grow them.
export const PaintedVector = (Channels) =>
{
    const Values = new Float32Array(12);
    PaintedImages.forEach((Image, Which) =>
        Image.Channels.forEach((Name, Slot) =>
        {
            const [Identifier, Component] = Name.split(".");
            const Value = Channels?.[Identifier];
            const Number_ = Component ? Value?.[{ r: 0, g: 1, b: 2 }[Component]] : Value;
            Values[Which * 4 + Slot] = Number.isFinite(Number_) ? Number_ : 0;
        }),
    );
    return Values;
};

export const PaintedVectorsAgree = (First, Second) =>
{
    if (!First || !Second) return false;
    for (let Index = 0; Index < 12; Index += 1) if (Math.abs(First[Index] - Second[Index]) > 1 / 512) return false;
    return true;
};

export const ChannelIdentifiers = ChannelSpecification.map((Channel) => Channel.Identifier);

export const ChannelByIdentifier = Object.fromEntries(
    ChannelSpecification.map((Channel) => [Channel.Identifier, Channel]),
);

export const ChannelGroups = [...new Set(ChannelSpecification.map((Channel) => Channel.Group))];

//--------------------------------------------------------------------------------------------------------------------------
// Default channel payload — every layer carries one of these, with `Enabled` selecting which channels it contributes to.
//--------------------------------------------------------------------------------------------------------------------------
export const DefaultChannelValues = () =>
    Object.fromEntries(
        ChannelSpecification.map((Channel) => [
            Channel.Identifier,
            Channel.Kind === "color" ? [...Channel.Default] : Channel.Default,
        ]),
    );

export const DefaultChannelMask = (Enabled = ["base_color", "specular_roughness", "base_metalness"]) =>
    Object.fromEntries(ChannelSpecification.map((Channel) => [Channel.Identifier, Enabled.includes(Channel.Identifier)]));

//--------------------------------------------------------------------------------------------------------------------------
// Blend algebra — index order is the contract shared with the GLSL compositor (ShadingGlsl.js, BlendChannel()).
//--------------------------------------------------------------------------------------------------------------------------
export const BlendOrdering = [
    { Identifier: "normal", Label: "Normal" },
    { Identifier: "multiply", Label: "Multiply" },
    { Identifier: "screen", Label: "Screen" },
    { Identifier: "overlay", Label: "Overlay" },
    { Identifier: "add", Label: "Add" },
    { Identifier: "subtract", Label: "Subtract" },
    { Identifier: "darken", Label: "Darken" },
    { Identifier: "lighten", Label: "Lighten" },
    { Identifier: "difference", Label: "Difference" },
    { Identifier: "linear-burn", Label: "Linear burn" },
];

export const BlendIndex = (Identifier) =>
    Math.max(
        0,
        BlendOrdering.findIndex((Blend) => Blend.Identifier === Identifier),
    );

//--------------------------------------------------------------------------------------------------------------------------
// Authoring resolutions. 4096 is offered but flagged: eight RGBA8 ping-pong targets at 4K cost ≈ 512 MB of device memory.
//--------------------------------------------------------------------------------------------------------------------------
export const ResolutionOrdering = [
    { Value: 512, Label: "512 × 512", Note: "8 MB" },
    { Value: 1024, Label: "1024 × 1024", Note: "32 MB" },
    { Value: 2048, Label: "2048 × 2048", Note: "128 MB" },
    { Value: 4096, Label: "4096 × 4096", Note: "512 MB" },
];

//--------------------------------------------------------------------------------------------------------------------------
// Viewport display channels. `material` is the full OpenPBR evaluation; the rest are raw channel inspections.
//--------------------------------------------------------------------------------------------------------------------------
export const DisplayOrdering = [
    { Identifier: "material", Label: "Material" },
    { Identifier: "base_color", Label: "Base colour" },
    { Identifier: "specular_roughness", Label: "Roughness" },
    { Identifier: "base_metalness", Label: "Metalness" },
    { Identifier: "geometry_normal", Label: "Normal" },
    { Identifier: "height", Label: "Height" },
    { Identifier: "ambient_occlusion", Label: "Occlusion" },
    { Identifier: "emission_color", Label: "Emission" },
    { Identifier: "coat_weight", Label: "Coat" },
    { Identifier: "fuzz_weight", Label: "Fuzz" },
    { Identifier: "transmission_weight", Label: "Transmission" },
    { Identifier: "curvature", Label: "Curvature" },
    { Identifier: "occlusion_bake", Label: "Baked AO" },
    { Identifier: "checker", Label: "UV checker" },
    { Identifier: "mask", Label: "Layer mask" },
];

export const DisplayIndex = (Identifier) =>
    Math.max(
        0,
        DisplayOrdering.findIndex((Display) => Display.Identifier === Identifier),
    );

//--------------------------------------------------------------------------------------------------------------------------
// Export presets — which channels leave the editor, under which interchange convention, and for which renderer.
//
// 🔴 `Handedness` is not decoration. A tangent normal map is green-up in the OpenGL convention and green-down in the
//    DirectX one, and Unreal reads DirectX. Writing the same bytes under both labels is the single most common reason a
//    surface lights inverted after an import, so the preset says which way it wants the green channel and the writer
//    actually flips it.
//--------------------------------------------------------------------------------------------------------------------------
export const ExportOrdering = [
    {
        Identifier: "unreal",
        Label: "Unreal Engine 5",
        Channels: ["base_color", "metallic_roughness", "geometry_normal", "emission_color", "height"],
        Handedness: "directx",
        Note: "ORM packing for the UE material graph — occlusion → R, roughness → G, metalness → B — with a DirectX-handed normal.",
    },
    {
        Identifier: "blender",
        Label: "Blender · Principled BSDF",
        Channels: [
            "base_color",
            "specular_roughness",
            "base_metalness",
            "geometry_normal",
            "emission_color",
            "ambient_occlusion",
            "height",
        ],
        Handedness: "opengl",
        Note: "One image per Principled input. The normal stays OpenGL-handed, which is what Blender's Normal Map node expects.",
    },
    {
        Identifier: "openpbr",
        Label: "OpenPBR channel set",
        Channels: ChannelIdentifiers.filter((Identifier) => Identifier !== "ambient_occlusion").concat([
            "geometry_normal",
            "ambient_occlusion",
        ]),
        Handedness: "opengl",
        Note: "One image per OpenPBR identifier plus the derived tangent normal.",
    },
    {
        Identifier: "gltf",
        Label: "glTF metallic-roughness",
        Channels: ["base_color", "metallic_roughness", "geometry_normal", "emission_color", "ambient_occlusion"],
        Handedness: "opengl",
        Note: "ORM packing: occlusion → R, roughness → G, metalness → B.",
    },
    {
        Identifier: "compact",
        Label: "Compact set",
        Channels: ["base_color", "metallic_roughness", "geometry_normal"],
        Handedness: "opengl",
        Note: "Three images for lightweight previews.",
    },
];
