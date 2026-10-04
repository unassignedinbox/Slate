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

export const SlotToCanvas = (Resolved) =>
{
    const Surface = document.createElement("canvas");
    Surface.width = Resolved.Width;
    Surface.height = Resolved.Height;
    const Context = Surface.getContext("2d");
    const Image = new ImageData(FlipRows(Resolved.Pixels, Resolved.Width, Resolved.Height), Resolved.Width, Resolved.Height);
    Context.putImageData(Image, 0, 0);
    return Surface;
};

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
        Images.push({ Identifier, Slot, Resolved });
    }
    return { Preset, Images };
};

export const MaterialDescriptor = (Project, Preset, Images) => ({
    specification: "OpenPBR Surface 1.1.1",
    generator: "Frontier Texture 0.1",
    name: Project.Name,
    authored: new Date().toISOString(),
    resolution: Project.Resolution,
    surface: Project.Surface,
    convention: Preset.Identifier,
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

export const EmitTextureSet = async (Integrator, Project, PresetIdentifier, Report = () => {}) =>
{
    const { Preset, Images } = ResolveSet(Integrator, Project, PresetIdentifier);
    const Stem = Slug(Project.Name);
    let Index = 0;
    for (const Entry of Images)
    {
        Index += 1;
        Report(`Writing ${Entry.Slot.Export} · ${Index}/${Images.length + 1}`);
        const Blob = await Encode(SlotToCanvas(Entry.Resolved));
        Download(Blob, `${Stem}_${Entry.Slot.Export}.png`);
        await new Promise((Resolve) => setTimeout(Resolve, 110));
    }
    Report(`Writing descriptor · ${Images.length + 1}/${Images.length + 1}`);
    const Descriptor = MaterialDescriptor(Project, Preset, Images);
    Download(new Blob([JSON.stringify(Descriptor, null, 4)], { type: "application/json" }), `${Stem}.material.json`);
    return { Count: Images.length, Preset: Preset.Label };
};

export const EmitProject = (Project, Camera) =>
{
    const Record = { ...Project, Camera, Version: 1, Generator: "Frontier Texture 0.1" };
    Download(new Blob([JSON.stringify(Record, null, 4)], { type: "application/json" }), `${Slug(Project.Name)}.texture.json`);
};

export const ExportSlotLabels = ExportSlots;
