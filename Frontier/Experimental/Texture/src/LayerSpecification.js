//============================================================================================================================================
// 🥞 LayerSpecification.js — the layer stack contract: layer kinds, masks, blend state, project shape and validation
//============================================================================================================================================
// A layer is a (coverage, channel payload) pair. Coverage comes from the layer kind — a fill covers everything, a stroke
// carries a painted coverage texture, a generator evaluates a procedural field, a decal projects an image onto the bake.
// The payload is the OpenPBR channel set from ChannelSpecification.js, gated by `Enabled` so a layer can touch roughness
// without disturbing base colour. Masks multiply coverage and are themselves either painted or procedural.
//============================================================================================================================================

import {
    ChannelIdentifiers,
    ChannelByIdentifier,
    DefaultChannelValues,
    DefaultChannelMask,
    BlendOrdering,
} from "./ChannelSpecification.js";
import { DefaultGenerator, NormaliseGenerator } from "./GeneratorSpecification.js";
import { FinishDefaults, SanitiseFinish, FinishBadge } from "./FinishSpecification.js";
import { CreateObject, SanitiseObject, FirstTile } from "./SceneStructure.js";
import { SurfaceDefaults, SurfaceControls } from "./MaterialSpecification.js";

export const LayerKinds = [
    {
        Identifier: "fill",
        Label: "Fill",
        Badge: "FILL",
        Glyph: "fill",
        Accent: "#dfe6f5",
        Hint: "Uniform coverage over the whole surface. The usual base of a stack.",
    },
    {
        Identifier: "stroke",
        Label: "Hand painted",
        Badge: "PAINT",
        Glyph: "brush",
        Accent: "#ffb454",
        Hint: "Coverage written by the brush, in three dimensions and across UV seams.",
    },
    {
        Identifier: "decal",
        Label: "Decal",
        Badge: "DECAL",
        Glyph: "decal",
        Accent: "#5aa9ff",
        Hint: "An SVG or text image projected onto the surface along a placement frame.",
    },
    {
        Identifier: "generator",
        Label: "Generator",
        Badge: "PROC",
        Glyph: "noise",
        Accent: "#8fd6a0",
        Hint: "A procedural or baked field — noise, cells, curvature, occlusion.",
    },
    {
        Identifier: "finish",
        Label: "Material",
        Badge: "MATL",
        Glyph: "material",
        Accent: "#c98cff",
        Hint: "A procedural finish — car paint, fabric, metal or plastic — with its own material properties.",
    },
    {
        Identifier: "folder",
        Label: "Folder",
        Badge: "SET",
        Glyph: "folder",
        Accent: "#9fb0c4",
        Hint: "A set: the layers inside it hide, fade and move together, and collapse out of the way.",
    },
];

export const LayerKindByIdentifier = Object.fromEntries(LayerKinds.map((Kind) => [Kind.Identifier, Kind]));

export const MaskKinds = [
    { Identifier: "none", Label: "No mask" },
    { Identifier: "stroke", Label: "Painted mask" },
    { Identifier: "generator", Label: "Generator mask" },
    { Identifier: "colour", Label: "Colour mask" },
];

//--------------------------------------------------------------------------------------------------------------------------
// Decal defaults. Projection mode uses the surface bake; UV mode is a plain texture-space placement.
//--------------------------------------------------------------------------------------------------------------------------
export const DecalDefaults = () => ({
    Placement: "stamp",             // stamp burns the artwork into the layer · project keeps it as a movable 3D decal
    Mode: "projection",
    SourceKind: "svg",
    Library: "hazard",
    Svg: "",
    Text: {
        Content: "FRONTIER",
        Family: "DM Sans",
        Weight: 400,
        Size: 180,
        Tracking: 6,
        LineHeight: 1.1,
        Align: "center",
        Outline: 0,
    },
    Tint: [0.92, 0.92, 0.94],
    Colorise: true,
    Softness: 0.06,
    Emboss: 0.35,
    Transform: {
        Position: [0, 0, 1],
        Normal: [0, 0, 1],
        Tangent: [1, 0, 0],
        Size: 0.55,
        Aspect: 1,
        Rotation: 0,
        Depth: 0.45,
        AngleLimit: 78,
    },
    Plane: { Centre: [0.5, 0.5], Size: 0.4, Rotation: 0, Aspect: 1 },
    Marks: [],                      // every placement of this artwork, composited bottom to top
    Selection: "",                  // the mark the inspector is editing
});

//--------------------------------------------------------------------------------------------------------------------------
// Marks. One decal layer holds one piece of artwork and any number of placements of it, each with its own frame, colour
// and folder, composited in order. A placement carries exactly the fields the composite pass reads.
//--------------------------------------------------------------------------------------------------------------------------
export const MarkLimit = 32;

let MarkCounter = 0;

export const NextMarkIdentifier = () =>
{
    MarkCounter += 1;
    return `mark-${MarkCounter.toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
};

export const ResetMarkCounter = () => (MarkCounter = 0);

export const CreateMark = (Decal, Overrides = {}) =>
{
    const Template = Decal || DecalDefaults();
    return {
        Identifier: NextMarkIdentifier(),
        Name: "Mark",
        Folder: "",
        Visible: true,
        Placed: false,              // a mark the surface has never been clicked for still waits for its first click
        Mode: Template.Mode,
        Tint: [...Template.Tint],
        Colorise: Template.Colorise !== false,
        Softness: Template.Softness,
        Emboss: Template.Emboss,
        Transform: { ...Template.Transform, Position: [...Template.Transform.Position], Normal: [...Template.Transform.Normal], Tangent: [...Template.Transform.Tangent] },
        Plane: { ...Template.Plane, Centre: [...Template.Plane.Centre] },
        // The channel values this placement carries. Null means it still follows the layer's; a mark dropped onto the
        // surface takes a copy of whatever the inspector read at that moment, so two marks on one layer can be a matt
        // sticker and a chrome badge.
        Channels: null,
        ...Overrides,
    };
};

export const MaskDefaults = () => ({
    Kind: "none",
    Invert: false,
    Generator: DefaultGenerator("fbm"),
    Colour: [0.82, 0.12, 0.14],     // the key a colour mask selects from the stack beneath the layer
    Tolerance: 0.25,
    Softness: 0.12,
    Tint: [0.95, 0.22, 0.3],        // overlay wash drawn over whatever the mask hides
});

//--------------------------------------------------------------------------------------------------------------------------
// Layer construction.
//--------------------------------------------------------------------------------------------------------------------------
let LayerCounter = 0;

export const ResetLayerCounter = (Value = 0) =>
{
    LayerCounter = Value;
};

export const NextLayerIdentifier = () =>
{
    LayerCounter += 1;
    return `layer-${LayerCounter.toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`;
};

const DefaultEnabledChannels = {
    folder: [],
    fill: ["base_color", "specular_roughness", "base_metalness"],
    stroke: ["base_color", "specular_roughness"],
    decal: ["base_color", "specular_roughness", "height"],
    generator: ["base_color", "specular_roughness", "height"],
    finish: [
        "base_color",
        "specular_roughness",
        "base_metalness",
        "ambient_occlusion",
        "height",
        "specular_weight",
        "coat_weight",
        "coat_roughness",
        "fuzz_weight",
    ],
};

// A layer paints on a sheet of its own size when it wants one: 0 follows the document, the rest are the sizes a
// texture set is normally shipped at. The stroke history is what makes this safe to change after the fact.
export const LayerResolutions = [0, 256, 512, 1024, 2048, 4096];

export const CreateLayer = (Kind = "fill", Overrides = {}) =>
{
    const Descriptor = LayerKindByIdentifier[Kind] ? Kind : "fill";
    const Layer = {
        Identifier: NextLayerIdentifier(),
        Name: LayerKindByIdentifier[Descriptor].Label,
        Kind: Descriptor,
        Object: "",                 // empty is the whole scene; otherwise the object whose tile this layer paints
        Parent: "",                 // empty sits at the root of the stack; otherwise the folder this layer is inside
        Collapsed: false,           // folders only: whether the stack draws what is inside
        Visible: true,
        Locked: false,
        Opacity: 1,
        Blend: "normal",
        Resolution: 0,              // 0 follows the document; otherwise this layer keeps its own sheet size
        Channels: DefaultChannelValues(),
        Enabled: DefaultChannelMask(DefaultEnabledChannels[Descriptor]),
        Mask: MaskDefaults(),
        Target: "coverage",         // coverage | mask: which side of THIS layer the brush is landing in, remembered per layer
        Generator: DefaultGenerator(Descriptor === "generator" ? "fbm" : "fbm"),
        Decal: DecalDefaults(),
        Finish: FinishDefaults(),
    };
    const Built = MergeLayer(Layer, Overrides);
    // A 3D decal layer opens with one placement waiting for the click that puts it on the model. A stamping layer
    // has no placements at all: its artwork is burned into the texture as it is clicked.
    if (Built.Kind === "decal" && Built.Decal.Placement === "project" && !Built.Decal.Marks.length)
    {
        Built.Decal.Marks = [CreateMark(Built.Decal, { Name: "Mark 1" })];
        Built.Decal.Selection = Built.Decal.Marks[0].Identifier;
    }
    return Built;
};

export const MergeLayer = (Layer, Overrides = {}) =>
{
    const Merged = { ...Layer, ...Overrides };
    Merged.Channels = { ...Layer.Channels, ...(Overrides.Channels || {}) };
    Merged.Enabled = { ...Layer.Enabled, ...(Overrides.Enabled || {}) };
    Merged.Mask = { ...Layer.Mask, ...(Overrides.Mask || {}) };
    if (Overrides.Mask?.Generator) Merged.Mask.Generator = NormaliseGenerator(Overrides.Mask.Generator);
    Merged.Finish = { ...Layer.Finish, ...(Overrides.Finish || {}) };
    Merged.Generator = NormaliseGenerator({ ...Layer.Generator, ...(Overrides.Generator || {}) });
    Merged.Decal = {
        ...Layer.Decal,
        ...(Overrides.Decal || {}),
        Marks: (Overrides.Decal?.Marks || Layer.Decal.Marks || []).map((Mark) => structuredClone(Mark)),
        Text: { ...Layer.Decal.Text, ...(Overrides.Decal?.Text || {}) },
        Transform: { ...Layer.Decal.Transform, ...(Overrides.Decal?.Transform || {}) },
        Plane: { ...Layer.Decal.Plane, ...(Overrides.Decal?.Plane || {}) },
    };
    return Merged;
};

export const CloneLayer = (Layer) =>
    MergeLayer(CreateLayer(Layer.Kind), {
        ...structuredClone({ ...Layer, Identifier: undefined }),
        Identifier: NextLayerIdentifier(),
        Name: `${Layer.Name} copy`,
    });

//--------------------------------------------------------------------------------------------------------------------------
// A smart material entry (MaterialSpecification.js) expands into real layers here, so the stack is always the truth.
//--------------------------------------------------------------------------------------------------------------------------
export const ExpandMaterial = (Material) =>
    (Material.Layers || []).map((Descriptor) =>
    {
        const Kind = Descriptor.Kind === "generator" ? "generator" : "fill";
        const Enabled = Object.fromEntries(ChannelIdentifiers.map((Identifier) => [Identifier, false]));
        for (const Identifier of Object.keys(Descriptor.Channels || {}))
            if (ChannelByIdentifier[Identifier]) Enabled[Identifier] = true;
        const Layer = CreateLayer(Kind, {
            Name: Descriptor.Name,
            Blend: Descriptor.Blend || "normal",
            Opacity: Descriptor.Opacity ?? 1,
            Channels: Descriptor.Channels || {},
            Enabled,
            Generator: Descriptor.Generator ? NormaliseGenerator(Descriptor.Generator) : DefaultGenerator("fbm"),
        });
        if (Descriptor.Mask)
            Layer.Mask = {
                Kind: "generator",
                Invert: Boolean(Descriptor.Mask.Invert),
                Generator: NormaliseGenerator(Descriptor.Mask),
            };
        Layer.Origin = Material.Identifier;
        return Layer;
    });

//--------------------------------------------------------------------------------------------------------------------------
// Project shape.
//--------------------------------------------------------------------------------------------------------------------------
export const SurfaceOrdering = [
    { Identifier: "shaderball", Label: "Shader ball", Note: "Sphere, stem and plinth" },
    { Identifier: "sphere", Label: "Sphere", Note: "Spherical UV" },
    { Identifier: "cube", Label: "Rounded cube", Note: "Six UV islands" },
    { Identifier: "cylinder", Label: "Cylinder", Note: "Capped, seam at u = 0" },
    { Identifier: "torus", Label: "Torus", Note: "Toroidal UV" },
    { Identifier: "plane", Label: "Plane", Note: "Flat 1 × 1 patch" },
    { Identifier: "custom", Label: "Imported mesh", Note: "Wavefront OBJ with UVs" },
];

export const DefaultProject = () => ({
    Version: 1,
    Name: "Surface study",
    Surface: { Kind: "shaderball", Subdivision: 2, Scale: 1 },
    Objects: [CreateObject({ Name: "Shader ball", Kind: "shaderball", Subdivision: 2, Tile: FirstTile })],
    Object: "",
    Resolution: 1024,
    Environment: { Identifier: "studio", Rotation: 35, Intensity: 1, Exposure: 0, Background: true, Shadow: true },
    Material: { ...SurfaceDefaults },
    Layers: [],
    Selection: "",
});

export const DefaultStack = () =>
{
    const Base = CreateLayer("fill", {
        Name: "Base surface",
        Channels: {
            base_color: [0.56, 0.57, 0.6],
            specular_roughness: 0.38,
            base_metalness: 0,
            specular_weight: 1,
            height: 0.5,
            ambient_occlusion: 1,
            geometry_opacity: 1,
        },
        Enabled: {
            base_color: true,
            specular_roughness: true,
            base_metalness: true,
            specular_weight: true,
            geometry_opacity: true,
            ambient_occlusion: true,
            height: true,
        },
    });
    const Grime = CreateLayer("generator", {
        Name: "Cavity grime",
        Opacity: 0.55,
        Generator: NormaliseGenerator({ Kind: "cavity", Contrast: 0.65, Balance: 0.5 }),
        Channels: { base_color: [0.16, 0.15, 0.14], specular_roughness: 0.82 },
        Enabled: { base_color: true, specular_roughness: true, height: false },
        Mask: { Kind: "generator", Invert: false, Generator: NormaliseGenerator({ Kind: "fbm", Scale: 9, Contrast: 0.45 }) },
    });
    const Hand = CreateLayer("stroke", {
        Name: "Hand painted",
        Channels: { base_color: [0.86, 0.32, 0.2], specular_roughness: 0.3, height: 0.56 },
        Enabled: { base_color: true, specular_roughness: true, height: true },
    });
    return [Base, Grime, Hand];
};

//--------------------------------------------------------------------------------------------------------------------------
// Validation — anything read from disk or a URL passes through here before it reaches the GPU.
//--------------------------------------------------------------------------------------------------------------------------
const ControlByIdentifier = Object.fromEntries(SurfaceControls.map((Control) => [Control.Identifier, Control]));

const Clamp = (Value, Minimum, Maximum) => Math.min(Maximum, Math.max(Minimum, Number.isFinite(Value) ? Value : Minimum));

const SanitiseVector = (Value, Fallback) =>
    Array.isArray(Value) && Value.length >= 3 && Value.slice(0, 3).every(Number.isFinite)
        ? Value.slice(0, 3).map((Component) => Clamp(Component, -1000, 1000))
        : [...Fallback];

const SanitiseColour = (Value, Fallback) =>
    Array.isArray(Value) && Value.length >= 3 ? Value.slice(0, 3).map((Component) => Clamp(Component, 0, 1)) : [...Fallback];

//--------------------------------------------------------------------------------------------------------------------------
// Markup hygiene — custom SVG arrives from a paste field or a dropped file, so scripts and externals are stripped before
// the record is stored, not merely before it is drawn. DecalSpecification.js re-exports this for the rasteriser.
//--------------------------------------------------------------------------------------------------------------------------
export const SanitiseMarkup = (Markup) =>
    String(Markup || "")
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
        .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
        .replace(/(href|xlink:href)\s*=\s*("|')\s*(javascript:|data:text\/html)[^"']*("|')/gi, "")
        .slice(0, 400000);

const SanitiseDecal = (Decal, Candidate) =>
{
    if (!Candidate || typeof Candidate !== "object") return Decal;
    const Sanitised = {
        ...Decal,
        // A record written before the two kinds existed described a projected decal, so that is what it stays.
        Placement: Candidate.Placement === "stamp" ? "stamp" : "project",
        Mode: Candidate.Mode === "plane" ? "plane" : "projection",
        SourceKind: Candidate.SourceKind === "text" ? "text" : "svg",
        Library: typeof Candidate.Library === "string" ? Candidate.Library.slice(0, 48) : Decal.Library,
        Svg: SanitiseMarkup(Candidate.Svg),
        Tint: SanitiseColour(Candidate.Tint, Decal.Tint),
        Colorise: Candidate.Colorise !== false,
        Softness: Clamp(Candidate.Softness ?? Decal.Softness, 0.002, 0.6),
        Emboss: Clamp(Candidate.Emboss ?? Decal.Emboss, -0.5, 0.5),
        Text: {
            ...Decal.Text,
            Content: typeof Candidate.Text?.Content === "string" ? Candidate.Text.Content.slice(0, 120) : Decal.Text.Content,
            Family: typeof Candidate.Text?.Family === "string" ? Candidate.Text.Family.slice(0, 48) : Decal.Text.Family,
            Weight: Clamp(Number(Candidate.Text?.Weight) || Decal.Text.Weight, 100, 900),
            Size: Clamp(Candidate.Text?.Size ?? Decal.Text.Size, 8, 512),
            Tracking: Clamp(Candidate.Text?.Tracking ?? Decal.Text.Tracking, -20, 80),
            LineHeight: Clamp(Candidate.Text?.LineHeight ?? Decal.Text.LineHeight, 0.7, 2.2),
            Outline: Clamp(Candidate.Text?.Outline ?? Decal.Text.Outline, 0, 24),
        },
        Transform: {
            ...Decal.Transform,
            Position: SanitiseVector(Candidate.Transform?.Position, Decal.Transform.Position),
            Normal: SanitiseVector(Candidate.Transform?.Normal, Decal.Transform.Normal),
            Tangent: SanitiseVector(Candidate.Transform?.Tangent, Decal.Transform.Tangent),
            Size: Clamp(Candidate.Transform?.Size ?? Decal.Transform.Size, 0.02, 2.4),
            Aspect: Clamp(Candidate.Transform?.Aspect ?? Decal.Transform.Aspect, 0.2, 5),
            Rotation: Clamp(Candidate.Transform?.Rotation ?? Decal.Transform.Rotation, 0, 360),
            Depth: Clamp(Candidate.Transform?.Depth ?? Decal.Transform.Depth, 0.01, 2),
            AngleLimit: Clamp(Candidate.Transform?.AngleLimit ?? Decal.Transform.AngleLimit, 10, 180),
        },
        Plane: {
            Centre: [
                Clamp(Candidate.Plane?.Centre?.[0] ?? Decal.Plane.Centre[0], -1, 2),
                Clamp(Candidate.Plane?.Centre?.[1] ?? Decal.Plane.Centre[1], -1, 2),
            ],
            Size: Clamp(Candidate.Plane?.Size ?? Decal.Plane.Size, 0.02, 1.6),
            Rotation: Clamp(Candidate.Plane?.Rotation ?? Decal.Plane.Rotation, 0, 360),
            Aspect: Clamp(Candidate.Plane?.Aspect ?? Decal.Plane.Aspect, 0.2, 5),
        },
    };
    // A project written before marks existed carries exactly one placement: the record itself.
    const Marks = Array.isArray(Candidate.Marks) && Candidate.Marks.length
        ? Candidate.Marks.slice(0, MarkLimit).map((Mark) => SanitiseMark(Sanitised, Mark))
        : Sanitised.Placement === "stamp"
          ? []
          : [CreateMark(Sanitised, { Name: "Mark 1", Placed: true })];
    Sanitised.Marks = Marks;
    Sanitised.Selection = Marks.some((Mark) => Mark.Identifier === Candidate.Selection)
        ? Candidate.Selection
        : Marks[Marks.length - 1]?.Identifier || "";
    return Sanitised;
};

export const SanitiseChannels = (Candidate) =>
{
    const Channels = DefaultChannelValues();
    for (const Identifier of ChannelIdentifiers)
    {
        const Specification = ChannelByIdentifier[Identifier];
        const Incoming = Candidate?.[Identifier];
        Channels[Identifier] =
            Specification.Kind === "color"
                ? SanitiseColour(Incoming, Specification.Default)
                : Clamp(Incoming ?? Specification.Default, 0, 1);      // every channel is stored UNORM8
    }
    return Channels;
};

export const SanitiseMark = (Decal, Candidate) =>
{
    const Mark = CreateMark(Decal);
    if (!Candidate || typeof Candidate !== "object") return Mark;
    if (typeof Candidate.Identifier === "string") Mark.Identifier = Candidate.Identifier.slice(0, 64);
    if (typeof Candidate.Name === "string") Mark.Name = Candidate.Name.slice(0, 48);
    if (typeof Candidate.Folder === "string") Mark.Folder = Candidate.Folder.slice(0, 48);
    Mark.Visible = Candidate.Visible !== false;
    Mark.Placed = Candidate.Placed !== false;
    Mark.Mode = Candidate.Mode === "plane" ? "plane" : "projection";
    Mark.Tint = SanitiseColour(Candidate.Tint, Mark.Tint);
    Mark.Colorise = Candidate.Colorise !== false;
    Mark.Softness = Clamp(Candidate.Softness ?? Mark.Softness, 0.002, 0.6);
    Mark.Emboss = Clamp(Candidate.Emboss ?? Mark.Emboss, -0.5, 0.5);
    Mark.Transform = {
        Position: SanitiseVector(Candidate.Transform?.Position, Mark.Transform.Position),
        Normal: SanitiseVector(Candidate.Transform?.Normal, Mark.Transform.Normal),
        Tangent: SanitiseVector(Candidate.Transform?.Tangent, Mark.Transform.Tangent),
        Size: Clamp(Candidate.Transform?.Size ?? Mark.Transform.Size, 0.02, 2.4),
        Aspect: Clamp(Candidate.Transform?.Aspect ?? Mark.Transform.Aspect, 0.2, 5),
        Rotation: Clamp(Candidate.Transform?.Rotation ?? Mark.Transform.Rotation, 0, 360),
        Depth: Clamp(Candidate.Transform?.Depth ?? Mark.Transform.Depth, 0.01, 2),
        AngleLimit: Clamp(Candidate.Transform?.AngleLimit ?? Mark.Transform.AngleLimit, 10, 180),
    };
    Mark.Channels = Candidate.Channels ? SanitiseChannels(Candidate.Channels) : null;
    Mark.Plane = {
        Centre: [
            Clamp(Candidate.Plane?.Centre?.[0] ?? Mark.Plane.Centre[0], -1, 2),
            Clamp(Candidate.Plane?.Centre?.[1] ?? Mark.Plane.Centre[1], -1, 2),
        ],
        Size: Clamp(Candidate.Plane?.Size ?? Mark.Plane.Size, 0.02, 1.6),
        Rotation: Clamp(Candidate.Plane?.Rotation ?? Mark.Plane.Rotation, 0, 360),
        Aspect: Clamp(Candidate.Plane?.Aspect ?? Mark.Plane.Aspect, 0.2, 5),
    };
    return Mark;
};

export const SanitiseLayer = (Candidate) =>
{
    if (!Candidate || typeof Candidate !== "object") return null;
    const Layer = CreateLayer(LayerKindByIdentifier[Candidate.Kind] ? Candidate.Kind : "fill");
    Layer.Identifier = typeof Candidate.Identifier === "string" ? Candidate.Identifier : Layer.Identifier;
    Layer.Name = typeof Candidate.Name === "string" ? Candidate.Name.slice(0, 64) : Layer.Name;
    Layer.Object = typeof Candidate.Object === "string" ? Candidate.Object.slice(0, 64) : "";
    Layer.Parent = typeof Candidate.Parent === "string" ? Candidate.Parent.slice(0, 64) : "";
    Layer.Collapsed = Boolean(Candidate.Collapsed);
    Layer.Visible = Candidate.Visible !== false;
    Layer.Locked = Boolean(Candidate.Locked);
    Layer.Opacity = Clamp(Candidate.Opacity ?? 1, 0, 1);
    Layer.Blend = BlendOrdering.some((Blend) => Blend.Identifier === Candidate.Blend) ? Candidate.Blend : "normal";
    Layer.Resolution = LayerResolutions.includes(Candidate.Resolution) ? Candidate.Resolution : 0;
    Layer.Channels = SanitiseChannels(Candidate.Channels);
    for (const Identifier of ChannelIdentifiers) Layer.Enabled[Identifier] = Boolean(Candidate.Enabled?.[Identifier]);
    if (Candidate.Mask)
        Layer.Mask = {
            ...MaskDefaults(),
            Kind: MaskKinds.some((Kind) => Kind.Identifier === Candidate.Mask.Kind) ? Candidate.Mask.Kind : "none",
            Invert: Boolean(Candidate.Mask.Invert),
            Generator: NormaliseGenerator(Candidate.Mask.Generator || {}),
            Colour: SanitiseColour(Candidate.Mask.Colour, [0.82, 0.12, 0.14]),
            Tolerance: Clamp(Candidate.Mask.Tolerance ?? 0.25, 0, 1),
            Softness: Clamp(Candidate.Mask.Softness ?? 0.12, 0, 1),
            Tint: SanitiseColour(Candidate.Mask.Tint, [0.95, 0.22, 0.3]),
        };
    // A layer whose mask was left in hand comes back with the mask in hand; one without a mask can only be its content.
    Layer.Target = Candidate.Target === "mask" && Layer.Mask.Kind !== "none" ? "mask" : "coverage";
    Layer.Generator = NormaliseGenerator(Candidate.Generator || {});
    Layer.Finish = SanitiseFinish(Candidate.Finish);
    if (Candidate.Decal) Layer.Decal = SanitiseDecal(Layer.Decal, Candidate.Decal);
    if (typeof Candidate.Coverage === "string") Layer.Coverage = Candidate.Coverage;
    if (typeof Candidate.MaskCoverage === "string") Layer.MaskCoverage = Candidate.MaskCoverage;
    if (typeof Candidate.Origin === "string") Layer.Origin = Candidate.Origin;
    return Layer;
};

export const SanitiseProject = (Candidate) =>
{
    const Project = DefaultProject();
    if (!Candidate || typeof Candidate !== "object") return { ...Project, Layers: DefaultStack() };
    if (typeof Candidate.Name === "string") Project.Name = Candidate.Name.slice(0, 64);
    if (Candidate.Surface && typeof Candidate.Surface === "object")
        Project.Surface = {
            Kind: SurfaceOrdering.some((Surface) => Surface.Identifier === Candidate.Surface.Kind)
                ? Candidate.Surface.Kind
                : "shaderball",
            Subdivision: Math.round(Clamp(Candidate.Surface.Subdivision ?? 2, 0, 3)),
            Scale: Clamp(Candidate.Surface.Scale ?? 1, 0.1, 10),
        };
    // Objects are the scene; a project written before they existed is given one object built from its surface record.
    const Incoming = Array.isArray(Candidate.Objects) ? Candidate.Objects.slice(0, 16) : [];
    Project.Objects = Incoming.length
        ? Incoming.map((Entry) => SanitiseObject(Entry, SurfaceOrdering))
        : [
              CreateObject({
                  Name: SurfaceOrdering.find((Entry) => Entry.Identifier === Project.Surface.Kind)?.Label || "Object",
                  Kind: Project.Surface.Kind,
                  Subdivision: Project.Surface.Subdivision,
                  Scale: Project.Surface.Scale,
              }),
          ];
    Project.Object = Project.Objects.some((Entry) => Entry.Identifier === Candidate.Object)
        ? Candidate.Object
        : Project.Objects[0].Identifier;
    if ([512, 1024, 2048, 4096].includes(Candidate.Resolution)) Project.Resolution = Candidate.Resolution;
    if (Candidate.Environment && typeof Candidate.Environment === "object")
        Project.Environment = {
            Identifier: typeof Candidate.Environment.Identifier === "string" ? Candidate.Environment.Identifier : "studio",
            Rotation: Clamp(Candidate.Environment.Rotation ?? 35, 0, 360),
            Intensity: Clamp(Candidate.Environment.Intensity ?? 1, 0, 6),
            Exposure: Clamp(Candidate.Environment.Exposure ?? 0, -4, 4),
            Background: Candidate.Environment.Background !== false,
            Shadow: Candidate.Environment.Shadow !== false,
        };
    Project.Material = { ...SurfaceDefaults };
    for (const [Identifier, Value] of Object.entries(Candidate.Material || {}))
    {
        if (!(Identifier in SurfaceDefaults)) continue;
        const Fallback = SurfaceDefaults[Identifier];
        if (Array.isArray(Fallback))
        {
            Project.Material[Identifier] = SanitiseColour(Value, Fallback);
            continue;
        }
        if (typeof Fallback === "boolean")
        {
            Project.Material[Identifier] = Boolean(Value);
            continue;
        }
        const Control = ControlByIdentifier[Identifier];
        Project.Material[Identifier] = Number.isFinite(Value)
            ? Clamp(Value, Control ? Control.Minimum : 0, Control ? Control.Maximum : 1000)
            : Fallback;
    }
    const Layers = Array.isArray(Candidate.Layers) ? Candidate.Layers.map(SanitiseLayer).filter(Boolean) : [];
    Project.Layers = Layers.length ? OrderStack(Layers.slice(0, 64)) : DefaultStack();
    Project.Selection = Project.Layers.some((Layer) => Layer.Identifier === Candidate.Selection)
        ? Candidate.Selection
        : Project.Layers[Project.Layers.length - 1].Identifier;
    return Project;
};

//--------------------------------------------------------------------------------------------------------------------------
// Folders. The stack stays one flat array, because that is the order the compositor walks and nothing cheaper exists; a
// folder is a layer, and the layers inside it name it as their parent. Everything below is pure, so the rules a stack
// has to obey — no loops, no orphans, children always behind their folder — are testable without a renderer.
//--------------------------------------------------------------------------------------------------------------------------
export const FolderLimit = 4;                  // [-] how deeply folders may nest

// Repairs a stack into a tree: parents that do not exist or are not folders are dropped, loops and over-deep chains are
// broken at the layer that closes them, and the array is rebuilt so every folder sits directly behind its own children.
// The array runs bottom to top, and the stack is drawn top down, so a folder's row lands above what is inside it.
export const OrderStack = (Layers) =>
{
    const ByIdentifier = new Map(Layers.map((Layer) => [Layer.Identifier, Layer]));
    for (const Layer of Layers)
    {
        const Parent = Layer.Parent ? ByIdentifier.get(Layer.Parent) : null;
        if (Layer.Parent && (!Parent || Parent === Layer || Parent.Kind !== "folder")) Layer.Parent = "";
    }
    for (const Layer of Layers)
    {
        const Walked = new Set([Layer.Identifier]);
        let Chain = Layer.Parent ? ByIdentifier.get(Layer.Parent) : null;
        let Depth = 0;
        while (Chain)
        {
            if (Walked.has(Chain.Identifier) || Depth >= FolderLimit)
            {
                Layer.Parent = "";
                break;
            }
            Walked.add(Chain.Identifier);
            Depth += 1;
            Chain = Chain.Parent ? ByIdentifier.get(Chain.Parent) : null;
        }
    }
    const Ordered = [];
    const Visit = (Parent) =>
    {
        for (const Layer of Layers)
        {
            if ((Layer.Parent || "") !== Parent) continue;
            if (Layer.Kind === "folder") Visit(Layer.Identifier);
            Ordered.push(Layer);
        }
    };
    Visit("");
    return Ordered;
};

// The folders a layer sits inside, outermost first.
export const LayerAncestry = (Layers, Identifier) =>
{
    const ByIdentifier = new Map(Layers.map((Layer) => [Layer.Identifier, Layer]));
    const Chain = [];
    let Walk = ByIdentifier.get(Identifier);
    let Guard = 0;
    while (Walk?.Parent && Guard < FolderLimit + 1)
    {
        const Parent = ByIdentifier.get(Walk.Parent);
        if (!Parent) break;
        Chain.unshift(Parent);
        Walk = Parent;
        Guard += 1;
    }
    return Chain;
};

export const LayerDepth = (Layers, Identifier) => LayerAncestry(Layers, Identifier).length;

// A layer and everything inside it, in stack order. For anything but a folder that is just the layer itself.
// 🔴 The tree is walked through a parent map rather than by sweeping the array: a layer sits *behind* its folder, so a
//    single forward pass meets a grandchild before the folder that would have admitted it, and quietly loses it.
export const LayerSubtree = (Layers, Identifier) =>
{
    const Children = new Map();
    for (const Layer of Layers)
    {
        const Key = Layer.Parent || "";
        if (!Children.has(Key)) Children.set(Key, []);
        Children.get(Key).push(Layer);
    }
    const Held = new Set([Identifier]);
    const Walk = (Key) =>
    {
        for (const Layer of Children.get(Key) || [])
        {
            if (Held.has(Layer.Identifier)) continue;
            Held.add(Layer.Identifier);
            Walk(Layer.Identifier);
        }
    };
    Walk(Identifier);
    return Layers.filter((Layer) => Held.has(Layer.Identifier));
};

export const LayerInside = (Layers, Identifier) => LayerSubtree(Layers, Identifier).filter((Layer) => Layer.Identifier !== Identifier);

// Whether a folder may be dropped onto a target: never into itself, and never into anything it contains.
export const CanHold = (Layers, Identifier, TargetIdentifier) =>
{
    if (!TargetIdentifier || Identifier === TargetIdentifier) return false;
    return !LayerInside(Layers, Identifier).some((Layer) => Layer.Identifier === TargetIdentifier);
};

// The list the compositor is actually handed: folders dissolve into the layers they hold, a hidden or faded folder
// carries that down to its children, and an isolated layer leaves everything outside it out of the pass. Groups are
// pass-through — a child keeps its own blend against the stack below, the folder only weighs it.
export const CompositeOrdering = (Layers, Solo = "") =>
{
    const ByIdentifier = new Map(Layers.map((Layer) => [Layer.Identifier, Layer]));
    const Isolated = Solo && ByIdentifier.has(Solo) ? new Set(LayerSubtree(Layers, Solo).map((Layer) => Layer.Identifier)) : null;
    const Lifted = new Set(Isolated ? [Solo, ...LayerAncestry(Layers, Solo).map((Layer) => Layer.Identifier)] : []);
    const Ordering = [];
    for (const Layer of Layers)
    {
        if (Layer.Kind === "folder") continue;
        if (Isolated && !Isolated.has(Layer.Identifier)) continue;
        let Weight = Lifted.has(Layer.Identifier) || Layer.Visible ? Layer.Opacity : 0;
        let Chain = Layer.Parent ? ByIdentifier.get(Layer.Parent) : null;
        let Guard = 0;
        while (Chain && Guard <= FolderLimit)
        {
            Weight *= Lifted.has(Chain.Identifier) || Chain.Visible ? Chain.Opacity : 0;
            Chain = Chain.Parent ? ByIdentifier.get(Chain.Parent) : null;
            Guard += 1;
        }
        if (Weight <= 0.0005) continue;
        Ordering.push({ ...Layer, Visible: true, Opacity: Weight });
    }
    return Ordering;
};

//--------------------------------------------------------------------------------------------------------------------------
// Presentation helpers shared by the outliner rows and the inspector heading.
//--------------------------------------------------------------------------------------------------------------------------
export const LayerBadge = (Layer) =>
{
    if (Layer.Kind === "generator") return (Layer.Generator?.Kind || "fbm").slice(0, 5).toUpperCase();
    if (Layer.Kind === "decal") return Layer.Decal?.SourceKind === "text" ? "TEXT" : "SVG";
    if (Layer.Kind === "finish") return FinishBadge(Layer.Finish);
    return LayerKindByIdentifier[Layer.Kind]?.Badge || "LAYER";
};

export const LayerChannelCount = (Layer) =>
    ChannelIdentifiers.reduce((Total, Identifier) => Total + (Layer.Enabled[Identifier] ? 1 : 0), 0);

export const LayerSummary = (Layer) =>
{
    if (Layer.Kind === "folder") return "folder";
    const Channels = LayerChannelCount(Layer);
    const Mask =
        Layer.Mask.Kind === "none"
            ? "no mask"
            : Layer.Mask.Kind === "stroke"
              ? "painted mask"
              : Layer.Mask.Kind === "colour"
                ? "colour mask"
                : `${Layer.Mask.Generator.Kind} mask`;
    const Count = Layer.Decal?.Marks?.length || 0;
    const Marks = Layer.Kind === "decal" ? (Layer.Decal.Placement === "stamp" ? "stamped · " : `${Count} mark${Count === 1 ? "" : "s"} · `) : "";
    return `${Marks}${Channels} channel${Channels === 1 ? "" : "s"} · ${Mask} · ${Math.round(Layer.Opacity * 100)}%`;
};
