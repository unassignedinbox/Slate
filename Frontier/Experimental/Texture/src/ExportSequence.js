//============================================================================================================================================
// 📤 ExportSequence.js — texture-set resolve, PNG emission and the OpenPBR material descriptor
//============================================================================================================================================
// Export is a deterministic walk: resolve each requested slot into an RGBA8 image, flip it into image orientation, encode
// it as a PNG, and emit one JSON descriptor naming every file with its OpenPBR identifier. The descriptor is the contract
// the native MaterialCodec reads, so a set authored here lands in the engine without a translation step.
//============================================================================================================================================

import { ExportSlots, SlotByIdentifier } from "./ShadingGlsl.js";
import { ExportOrdering } from "./ChannelSpecification.js";
import { SurfaceDefaults } from "./MaterialSpecification.js";

const Slug = (Text) =>
    String(Text || "surface")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 48) || "surface";

export const FlipRows = (Pixels, Width, Height) =>
{
    const Stride = Width * 4;
    const Flipped = new Uint8ClampedArray(Pixels.length);
    for (let Row = 0; Row < Height; Row += 1)
    {
        const Source = Row * Stride;
        const Destination = (Height - 1 - Row) * Stride;
        Flipped.set(Pixels.subarray(Source, Source + Stride), Destination);
    }
    return Flipped;
};

// A tangent normal is green-up as it leaves the resolve pass. DirectX engines — Unreal among them — read green-down, so
// the one byte that differs between the two conventions is flipped here rather than asked of the artist afterwards.
export const FlipGreen = (Pixels) =>
{
    const Flipped = new Uint8ClampedArray(Pixels);
    for (let Index = 1; Index < Flipped.length; Index += 4) Flipped[Index] = 255 - Flipped[Index];
    return Flipped;
};

export const SlotToCanvas = (Resolved, Size = 0) =>
{
    const Surface = document.createElement("canvas");
    Surface.width = Resolved.Width;
    Surface.height = Resolved.Height;
    const Context = Surface.getContext("2d");
    const Image = new ImageData(FlipRows(Resolved.Pixels, Resolved.Width, Resolved.Height), Resolved.Width, Resolved.Height);
    Context.putImageData(Image, 0, 0);
    if (!Size || Size === Resolved.Width) return Surface;
    // 🔴 Resampling happens on the canvas, after the flip, and never on the texel array. The browser's own filter is the
    //    one the rest of the image stack agrees with, and a hand-rolled box filter here would quietly disagree with the
    //    mip chain the engine builds from the same file.
    const Scaled = document.createElement("canvas");
    Scaled.width = Size;
    Scaled.height = Size;
    const Pen = Scaled.getContext("2d");
    Pen.imageSmoothingEnabled = true;
    Pen.imageSmoothingQuality = "high";
    Pen.drawImage(Surface, 0, 0, Size, Size);
    return Scaled;
};

// The sizes an export is allowed to land on. 0 means "whatever the document is", which is the common case.
export const ExportSizes = [
    { Size: 0, Label: "Document resolution" },
    { Size: 512, Label: "512 × 512" },
    { Size: 1024, Label: "1024 × 1024" },
    { Size: 2048, Label: "2048 × 2048" },
    { Size: 4096, Label: "4096 × 4096" },
];

const Download = (Blob, Name) =>
{
    const Address = URL.createObjectURL(Blob);
    const Anchor = document.createElement("a");
    Anchor.href = Address;
    Anchor.download = Name;
    document.body.append(Anchor);
    Anchor.click();
    Anchor.remove();
    setTimeout(() => URL.revokeObjectURL(Address), 4000);
};

const Encode = (Surface) =>
    new Promise((Resolve) => Surface.toBlob((Blob) => Resolve(Blob), "image/png"));

export const ResolveSet = (Integrator, Project, PresetIdentifier) =>
{
    const Preset = ExportOrdering.find((Entry) => Entry.Identifier === PresetIdentifier) || ExportOrdering[0];
    const Images = [];
    for (const Identifier of Preset.Channels)
    {
        const Slot = SlotByIdentifier[Identifier];
        if (!Slot) continue;
        const Resolved = Integrator.ResolveSlot(Slot.Slot, Project.Material);
        if (!Resolved) continue;
        if (Identifier === "geometry_normal" && Preset.Handedness === "directx")
            Resolved.Pixels = FlipGreen(Resolved.Pixels);
        Images.push({ Identifier, Slot, Resolved });
    }
    return { Preset, Images };
};

export const MaterialDescriptor = (Project, Preset, Images, Size = 0) => ({
    specification: "OpenPBR Surface 1.1.1",
    generator: "Frontier Texture 0.1",
    name: Project.Name,
    authored: new Date().toISOString(),
    resolution: Size || Project.Resolution,
    surface: Project.Surface,
    convention: Preset.Identifier,
    normals: Preset.Handedness || "opengl",
    constants: Object.fromEntries(
        Object.keys(SurfaceDefaults).map((Identifier) => [Identifier, Project.Material[Identifier]]),
    ),
    textures: Object.fromEntries(
        Images.map(({ Identifier, Slot }) => [
            Identifier,
            { file: `${Slug(Project.Name)}_${Slot.Export}.png`, encoding: Slot.Encoding },
        ]),
    ),
    layers: Project.Layers.map((Layer) => ({
        name: Layer.Name,
        kind: Layer.Kind,
        blend: Layer.Blend,
        opacity: Layer.Opacity,
        visible: Layer.Visible,
        channels: Object.entries(Layer.Enabled)
            .filter(([, Enabled]) => Enabled)
            .map(([Identifier]) => Identifier),
        mask: Layer.Mask.Kind,
        generator: Layer.Kind === "generator" ? Layer.Generator.Kind : undefined,
        decal:
            Layer.Kind === "decal"
                ? { source: Layer.Decal.SourceKind, mark: Layer.Decal.Library, mode: Layer.Decal.Mode }
                : undefined,
    })),
});

export const EmitTextureSet = async (Integrator, Project, PresetIdentifier, Report = () => {}, Size = 0) =>
{
    const { Preset, Images } = ResolveSet(Integrator, Project, PresetIdentifier);
    const Stem = Slug(Project.Name);
    const Written = Size || Project.Resolution;
    let Index = 0;
    for (const Entry of Images)
    {
        Index += 1;
        Report(`Writing ${Entry.Slot.Export} · ${Index}/${Images.length + 1}`);
        const Blob = await Encode(SlotToCanvas(Entry.Resolved, Size));
        Download(Blob, `${Stem}_${Entry.Slot.Export}.png`);
        await new Promise((Resolve) => setTimeout(Resolve, 110));
    }
    Report(`Writing descriptor · ${Images.length + 1}/${Images.length + 1}`);
    const Descriptor = MaterialDescriptor(Project, Preset, Images, Written);
    Download(new Blob([JSON.stringify(Descriptor, null, 4)], { type: "application/json" }), `${Stem}.material.json`);
    return { Count: Images.length, Preset: Preset.Label, Size: Written };
};

// A .pigment document is the whole session in one file: the project record, the camera pose, the branching timeline —
// and, since version 2, the paint itself. Sheets come last so the readable half of the file is still the first screenful.
export const DocumentFormat = "pigment";
export const DocumentVersion = 3;
export const DocumentExtension = ".pigment";

export const ComposeDocument = (Project, Camera, Timeline = null, Sheets = null) => ({
    Format: DocumentFormat,
    Version: DocumentVersion,
    Generator: "Frontier Texture 0.1",
    Written: new Date().toISOString(),
    Project,
    Camera,
    Timeline,
    Sheets: Sheets && Sheets.length ? Sheets : [],
});

export const EmitProject = (Project, Camera, Timeline = null, Sheets = null) =>
{
    const Record = ComposeDocument(Project, Camera, Timeline, Sheets);
    Download(new Blob([JSON.stringify(Record, null, 4)], { type: "application/json" }), `${Slug(Project.Name)}${DocumentExtension}`);
    return Record;
};

// Reading accepts the .pigment document of either version, and the flat project record earlier builds wrote. A version 1
// file simply has no sheets, which is indistinguishable from a version 2 document nobody painted in.
export const ReadDocument = (Text) =>
{
    const Parsed = JSON.parse(Text);
    const Sheets = Array.isArray(Parsed?.Sheets) ? Parsed.Sheets : [];
    if (Parsed && Parsed.Format === DocumentFormat && Parsed.Project)
        return { Project: Parsed.Project, Camera: Parsed.Camera || null, Timeline: Parsed.Timeline || null, Sheets };
    return { Project: Parsed, Camera: Parsed?.Camera || null, Timeline: null, Sheets };
};

export const ExportSlotLabels = ExportSlots;

//--------------------------------------------------------------------------------------------------------------------------
// The readings, written out. Same path as the texture set — one PNG a map, named after what it is — because a bake
// that cannot leave the editor is a bake somebody has to take again in the tool they are actually shipping from.
//--------------------------------------------------------------------------------------------------------------------------
export const EmitReadings = async (Maps, Name = "surface", Report = () => {}) =>
{
    const Stem = Slug(Name);
    let Index = 0;
    for (const Map of Maps)
    {
        Index += 1;
        Report(`Writing ${Map.Identifier} · ${Index}/${Maps.length}`);
        const Surface = document.createElement("canvas");
        Surface.width = Map.Size;
        Surface.height = Map.Size;
        const Context = Surface.getContext("2d");
        const Picture = Context.createImageData(Map.Size, Map.Size);
        // Rows the way an image wants them: texture space counts from the bottom, every file format from the top.
        for (let Row = 0; Row < Map.Size; Row += 1)
        {
            const From = (Map.Size - 1 - Row) * Map.Size * 4;
            Picture.data.set(Map.Pixels.subarray(From, From + Map.Size * 4), Row * Map.Size * 4);
        }
        Context.putImageData(Picture, 0, 0);
        Download(await Encode(Surface), `${Stem}_${Map.Identifier}${Map.Space ? `_${Map.Space}` : ""}.png`);
        await new Promise((Resolve) => setTimeout(Resolve, 90));
    }
    return { Count: Maps.length };
};
