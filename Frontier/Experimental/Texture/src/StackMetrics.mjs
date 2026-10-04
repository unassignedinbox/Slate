//============================================================================================================================================
// 🧱 StackMetrics.mjs — node --test coverage for the stack: channels, layers, materials, strokes, revisions and export
//============================================================================================================================================
// The GPU trusts these records blindly, so the contract is asserted here instead: channel order matches the shader's
// packing, blend identifiers keep their GLSL index, sanitising a hostile project file yields a renderable stack, and the
// revision queue stays inside its byte budget while still walking edits in order.
//============================================================================================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { TimelineSequence, CreateEvent, EventByKind, EventKinds, ShortHash, EventClock, BranchLimit } from "./TimelineSequence.js";
import { ComposeDocument, ReadDocument, DocumentFormat, DocumentExtension } from "./ExportSequence.js";

import {
    TileNumber,
    TilePlacement,
    TileLabel,
    CreateObject,
    SanitiseObject,
    SceneTiles,
    TileRectangle,
    AssembleScene,
    ObjectAtTriangle,
    ObjectAtCoordinate,
    CoordinateTile,
    FirstTile,
} from "./SceneStructure.js";

import {
    ChannelSpecification,
    ChannelIdentifiers,
    ChannelByIdentifier,
    ChannelTargets,
    DefaultChannelValues,
    DefaultChannelMask,
    BlendOrdering,
    BlendIndex,
    DisplayOrdering,
    DisplayIndex,
    ExportOrdering,
    ResolutionOrdering,
} from "./ChannelSpecification.js";
import { SurfaceDefaults, SurfaceControls, MaterialLibrary, MaterialByIdentifier, EnvironmentOrdering } from "./MaterialSpecification.js";
import { GeneratorOrdering, GeneratorIndex, NormaliseGenerator, DefaultGenerator, GeneratorControls } from "./GeneratorSpecification.js";
import {
    FinishFamilies,
    FinishShelf,
    FinishByIdentifier,
    FinishFamilyByIdentifier,
    FinishDefaults,
    CreateFinish,
    SanitiseFinish,
    FinishFamilyIndex,
    FinishStyleIndex,
    FinishControls,
    FinishColours,
    FinishLabel,
} from "./FinishSpecification.js";
import {
    CreateLayer,
    CloneLayer,
    ExpandMaterial,
    DefaultProject,
    DefaultStack,
    SanitiseProject,
    LayerChannelCount,
    LayerBadge,
    LayerSummary,
    SanitiseLayer,
    MaskKinds,
    ResetLayerCounter,
    CreateMark,
    SanitiseMark,
    MarkLimit,
} from "./LayerSpecification.js";
import { RevisionQueue } from "./RevisionQueue.js";
import { StrokeProjection, BrushDefaults, MirrorVector, ToolOrdering, MarkReach, MarkUnderPoint } from "./StrokeProjection.js";
import { FlipRows, MaterialDescriptor } from "./ExportSequence.js";
import { ExportSlots, SlotByIdentifier } from "./ShadingGlsl.js";

test("channels fit the multiple render targets they are packed into", () =>
{
    assert.equal(ChannelTargets, 4);
    assert.equal(ChannelSpecification.length, ChannelIdentifiers.length);
    assert.ok(ChannelSpecification.length <= ChannelTargets * 4, "more channels than packed components");
    const Occupied = new Set();
    for (const Channel of ChannelSpecification)
    {
        assert.ok(Channel.Target >= 0 && Channel.Target < ChannelTargets, `${Channel.Identifier} has no target`);
        assert.match(Channel.Swizzle, /^(rgb|r|g|b|a)$/, `${Channel.Identifier} has an unusable swizzle`);
        assert.equal(Channel.Kind === "color", Channel.Swizzle === "rgb", `${Channel.Identifier} packs the wrong width`);
        for (const Component of Channel.Swizzle)
        {
            const Slot = `${Channel.Target}.${Component}`;
            assert.ok(!Occupied.has(Slot), `${Channel.Identifier} overlaps ${Slot}`);
            Occupied.add(Slot);
        }
        assert.ok(["srgb", "linear"].includes(Channel.Encoding), `${Channel.Identifier} has no encoding`);
        assert.ok(Channel.Export?.length > 0, `${Channel.Identifier} has no export name`);
    }
    assert.ok(Occupied.size <= ChannelTargets * 4, "the packing overflows its targets");
});

test("channel defaults are in range and every identifier resolves", () =>
{
    const Values = DefaultChannelValues();
    for (const Channel of ChannelSpecification)
    {
        assert.equal(ChannelByIdentifier[Channel.Identifier], Channel);
        const Value = Values[Channel.Identifier];
        if (Channel.Kind === "color")
        {
            assert.equal(Value.length, 3);
            for (const Component of Value) assert.ok(Component >= 0 && Component <= 1, `${Channel.Identifier} out of range`);
            continue;
        }
        assert.equal(typeof Value, "number");
        assert.ok(Value >= 0 && Value <= 1, `${Channel.Identifier} default ${Value} is out of range`);
    }
    const Mask = DefaultChannelMask(["base_color"]);
    assert.equal(Mask.base_color, true);
    assert.equal(Mask.specular_roughness, false);
    assert.equal(Object.keys(Mask).length, ChannelSpecification.length);
});

test("blend, display and generator orderings keep the index the shader switches on", () =>
{
    BlendOrdering.forEach((Blend, Index) => assert.equal(BlendIndex(Blend.Identifier), Index, `${Blend.Identifier} moved`));
    assert.equal(BlendIndex("not-a-blend"), 0, "an unknown blend must fall back to normal");
    DisplayOrdering.forEach((Display, Index) => assert.equal(DisplayIndex(Display.Identifier), Index));
    GeneratorOrdering.forEach((Generator, Index) => assert.equal(GeneratorIndex(Generator.Identifier), Index));
    assert.ok(new Set(BlendOrdering.map((Blend) => Blend.Identifier)).size === BlendOrdering.length);
    assert.ok(ResolutionOrdering.every((Entry) => Number.isInteger(Math.log2(Entry.Value))), "resolutions must be powers of two");
});

test("generators normalise unknown input without losing their controls", () =>
{
    const Generator = NormaliseGenerator({ Kind: "nonsense", Scale: 1e9, Seed: "x" });
    assert.ok(GeneratorIndex(Generator.Kind) >= 0);
    for (const [Name, Control] of Object.entries(GeneratorControls))
    {
        assert.ok(Number.isFinite(Generator[Name]), `${Name} is not finite`);
        assert.ok(Generator[Name] >= Control.Minimum && Generator[Name] <= Control.Maximum, `${Name} escaped its range`);
    }
    assert.deepEqual(Object.keys(DefaultGenerator("cells")).sort(), Object.keys(Generator).sort());
});

test("material constants cover every control and every library entry resolves", () =>
{
    for (const Control of SurfaceControls)
        assert.ok(Control.Identifier in SurfaceDefaults, `${Control.Identifier} has no default`);
    for (const Material of MaterialLibrary)
    {
        assert.equal(MaterialByIdentifier[Material.Identifier], Material);
        assert.ok(Material.Layers?.length > 0, `${Material.Identifier} expands to nothing`);
        const Layers = ExpandMaterial(Material);
        assert.equal(Layers.length, Material.Layers.length);
        for (const Layer of Layers)
        {
            assert.ok(Layer.Identifier, "an expanded layer has no identifier");
            assert.equal(Layer.Origin, Material.Identifier);
            assert.ok(LayerChannelCount(Layer) > 0, `${Material.Identifier} wrote no channels`);
        }
        for (const [Identifier, Value] of Object.entries(Material.Surface || {}))
            assert.ok(Identifier in SurfaceDefaults && (typeof Value === "number" || Array.isArray(Value)));
    }
    for (const Environment of EnvironmentOrdering)
        for (const Key of ["Zenith", "Horizon", "Ground", "Key", "Fill", "Rim"])
            assert.ok(Environment[Key], `${Environment.Identifier} is missing ${Key}`);
});

test("layers are created with unique identifiers and clone without sharing records", () =>
{
    ResetLayerCounter(0);
    const Identifiers = new Set();
    for (let Index = 0; Index < 200; Index += 1) Identifiers.add(CreateLayer("stroke").Identifier);
    assert.equal(Identifiers.size, 200, "layer identifiers collided");

    const Layer = CreateLayer("decal", { Name: "Hazard", Decal: { SourceKind: "svg", Library: "hazard" } });
    const Copy = CloneLayer(Layer);
    assert.notEqual(Copy.Identifier, Layer.Identifier);
    assert.equal(Copy.Name, "Hazard copy");
    Copy.Channels.base_color[0] = 0.123;
    Copy.Decal.Transform.Size = 0.99;
    assert.notEqual(Layer.Channels.base_color[0], 0.123, "clone shares its channel record");
    assert.notEqual(Layer.Decal.Transform.Size, 0.99, "clone shares its decal transform");
    assert.ok(LayerBadge(Copy).length > 0);
});

test("the default stack is renderable and writes colour", () =>
{
    const Layers = DefaultStack();
    assert.ok(Layers.length >= 2);
    assert.ok(Layers.some((Layer) => Layer.Enabled.base_color), "nothing writes base colour");
    assert.ok(Layers.every((Layer) => Layer.Opacity >= 0 && Layer.Opacity <= 1));
    assert.ok(Layers.every((Layer) => BlendIndex(Layer.Blend) >= 0));
});

test("sanitising rejects hostile project records and keeps the stack renderable", () =>
{
    const Hostile = {
        Name: { toString: () => "x" },
        Resolution: 99999,
        Surface: { Kind: "teapot", Subdivision: 42 },
        Material: { specular_ior: 99, specular_color: "red", unknown_parameter: 7, emission_luminance: "bright" },
        Layers: [
            { Kind: "nonsense", Opacity: 14, Blend: "glow", Channels: { base_color: [4, -2, "x"], height: 9 } },
            null,
            { Kind: "decal", Decal: { SourceKind: "exe", Svg: "<svg onload='alert(1)'><script>bad()</script></svg>" } },
        ],
        Selection: "missing",
    };
    const Project = SanitiseProject(Hostile);
    assert.ok(ResolutionOrdering.some((Entry) => Entry.Value === Project.Resolution), "resolution was not clamped");
    assert.ok(["shaderball", "sphere", "cube", "cylinder", "torus", "plane", "custom"].includes(Project.Surface.Kind));
    assert.ok(Project.Surface.Subdivision >= 0 && Project.Surface.Subdivision <= 3);
    assert.ok(Project.Layers.length >= 1, "every layer was discarded");
    assert.ok(!("unknown_parameter" in Project.Material), "an unknown material parameter survived");
    assert.ok(!("specular_roughness" in Project.Material), "a painted channel leaked into the material constants");
    assert.ok(Project.Material.specular_ior <= 3, "an out-of-range IOR survived");
    assert.deepEqual(Project.Material.specular_color, [1, 1, 1], "a malformed colour was not replaced");
    assert.equal(Project.Material.emission_luminance, SurfaceDefaults.emission_luminance, "a malformed number was not replaced");
    for (const Layer of Project.Layers)
    {
        assert.ok(Layer.Opacity >= 0 && Layer.Opacity <= 1, "opacity escaped");
        assert.ok(BlendOrdering.some((Blend) => Blend.Identifier === Layer.Blend), "an unknown blend survived");
        for (const Channel of ChannelSpecification)
        {
            const Value = Layer.Channels[Channel.Identifier];
            if (Channel.Kind === "color")
            {
                assert.equal(Value.length, 3);
                for (const Component of Value) assert.ok(Number.isFinite(Component) && Component >= 0 && Component <= 1);
                continue;
            }
            assert.ok(Number.isFinite(Value) && Value >= 0 && Value <= 1, `${Channel.Identifier} escaped its range`);
        }
        if (Layer.Kind === "decal")
        {
            assert.ok(["svg", "text"].includes(Layer.Decal.SourceKind));
            assert.ok(!/<script/i.test(Layer.Decal.Svg || ""), "script markup survived sanitising");
            assert.ok(!/onload/i.test(Layer.Decal.Svg || ""), "an event attribute survived sanitising");
        }
    }
    assert.ok(Project.Layers.some((Layer) => Layer.Identifier === Project.Selection), "selection points nowhere");
    const Empty = SanitiseProject({});
    assert.ok(Empty.Layers.length >= 1, "an empty project must still open");
});

test("strokes segment by spacing and mirror across the chosen axis", () =>
{
    const Projection = new StrokeProjection();
    Projection.Configure({ Radius: 0.1, Spacing: 0.5 });
    assert.equal(Projection.Brush.Radius, 0.1);
    const Hit = (X) => ({ Position: [X, 0, 0], Normal: [0, 1, 0], Tangent: [1, 0, 0], Coordinate: [0.5, 0.5] });
    const First = Projection.Begin(Hit(0));
    assert.deepEqual(First.Start, [0, 0, 0]);
    assert.equal(Projection.Extend(Hit(0.001)), null, "a sub-spacing move produced a segment");
    const Segment = Projection.Extend(Hit(0.4));
    assert.ok(Segment, "a long move produced no segment");
    assert.deepEqual(Segment.End, [0.4, 0, 0]);
    assert.ok(Math.abs(Math.hypot(...Segment.Normal) - 1) < 1e-9);
    Projection.End();
    assert.equal(Projection.Active, false);
    assert.equal(Projection.Extend(Hit(2)), null, "an ended stroke still extends");

    assert.deepEqual(MirrorVector([1, 2, 3], "x"), [-1, 2, 3]);
    assert.deepEqual(MirrorVector([1, 2, 3], "z"), [1, 2, -3]);
    assert.equal(MirrorVector([1, 2, 3], "none"), null);
    assert.ok(Projection.FacingLimit <= 1 && Projection.FacingLimit >= -1);
    assert.equal(ToolOrdering.length, new Set(ToolOrdering.map((Tool) => Tool.Identifier)).size);
    assert.ok(BrushDefaults.Radius > 0 && BrushDefaults.Spacing > 0);
});

test("a placement frame is orthonormal even when the tangent degenerates", () =>
{
    const Frame = StrokeProjection.PlacementFrame({
        Position: [1, 2, 3],
        Normal: [0, 1, 0],
        Tangent: [0, 1, 0],
        Coordinate: [0.2, 0.3],
    });
    assert.ok(Math.abs(Math.hypot(...Frame.Tangent) - 1) < 1e-6, "tangent is not normalised");
    const Dot = Frame.Tangent[0] * Frame.Normal[0] + Frame.Tangent[1] * Frame.Normal[1] + Frame.Tangent[2] * Frame.Normal[2];
    assert.ok(Math.abs(Dot) < 1e-6, "tangent is not perpendicular to the normal");
    assert.deepEqual(Frame.Position, [1, 2, 3]);
});

test("a click finds the placement it landed on", () =>
{
    const Decal = CreateLayer("decal", { Decal: { Placement: "project" } }).Decal;
    const Mark = Decal.Marks[0];
    Mark.Placed = true;
    Mark.Transform.Position = [0, 0, 0];
    Mark.Transform.Normal = [0, 1, 0];
    Mark.Transform.Tangent = [1, 0, 0];
    Mark.Transform.Size = 0.4;
    Mark.Transform.Aspect = 1;
    Mark.Transform.Depth = 0.2;

    assert.equal(MarkReach(Mark, [0, 0, 0]), 0, "the centre reads as the middle of the footprint");
    assert.ok(Math.abs(MarkReach(Mark, [0.2, 0, 0]) - 1) < 1e-9, "the edge reads as one");
    assert.equal(MarkReach(Mark, [0.26, 0, 0]), null, "past the edge is outside");
    assert.equal(MarkReach(Mark, [0, 0.3, 0]), null, "too far off the surface is outside");

    assert.equal(MarkUnderPoint([Mark], [0.05, 0, 0.05]).Identifier, Mark.Identifier);
    assert.equal(MarkUnderPoint([Mark], [1, 1, 1]), null, "a click on clear surface takes hold of nothing");

    Mark.Visible = false;
    assert.equal(MarkUnderPoint([Mark], [0, 0, 0]), null, "a hidden placement cannot be grabbed");
    Mark.Visible = true;
    Mark.Placed = false;
    assert.equal(MarkUnderPoint([Mark], [0, 0, 0]), null, "nor can one that has never been clicked onto the model");

    Mark.Placed = true;
    const Small = { ...Mark, Identifier: "small", Transform: { ...Mark.Transform, Size: 0.1 } };
    assert.equal(MarkUnderPoint([Mark, Small], [0.01, 0, 0]).Identifier, "small", "the tightest one wins so a decal on a decal is reachable");
});

test("the revision queue walks edits in order and evicts by byte budget", () =>
{
    const Queue = new RevisionQueue();
    assert.equal(Queue.CanUndo, false);
    assert.equal(Queue.Undo(), null);
    Queue.Record({ Kind: "stack", Before: { Layers: [] }, After: { Layers: [1] } });
    Queue.Record({ Kind: "stack", Before: { Layers: [1] }, After: { Layers: [1, 2] } });
    assert.equal(Queue.Depth, 2);
    assert.equal(Queue.Undo().After.Layers.length, 2);
    assert.equal(Queue.Undo().After.Layers.length, 1);
    assert.equal(Queue.CanUndo, false);
    assert.equal(Queue.Redo().After.Layers.length, 1);
    Queue.Record({ Kind: "stack", Before: {}, After: { Layers: [9] } });
    assert.equal(Queue.CanRedo, false, "a new edit must discard the redo tail");
    assert.equal(Queue.Depth, 2);

    const Heavy = new RevisionQueue();
    const Image = () => ({ Pixels: new Uint8Array(32 * 1024 * 1024), Resolution: 2048 });
    for (let Index = 0; Index < 12; Index += 1)
        Heavy.Record({ Kind: "image", Identifier: "layer", Target: "coverage", Before: Image(), After: Image() });
    assert.ok(Heavy.Megabytes <= 192, `the queue kept ${Heavy.Megabytes.toFixed(0)} MB`);
    assert.ok(Heavy.Depth < 12, "nothing was evicted");
    assert.ok(Heavy.CanUndo, "eviction destroyed the cursor");
    Heavy.Clear();
    assert.equal(Heavy.Depth, 0);
    assert.equal(Heavy.Megabytes, 0);
});

test("export presets resolve to real slots and the descriptor names every file", () =>
{
    for (const Preset of ExportOrdering)
    {
        assert.ok(Preset.Channels.length > 0);
        for (const Identifier of Preset.Channels)
            assert.ok(SlotByIdentifier[Identifier], `${Preset.Identifier} wants a slot named ${Identifier}`);
    }
    assert.equal(ExportSlots.length, new Set(ExportSlots.map((Slot) => Slot.Slot)).size, "two slots share an index");

    const Project = { ...DefaultProject(), Layers: DefaultStack(), Name: "Foundry Crate 02" };
    const Preset = ExportOrdering[0];
    const Images = Preset.Channels.map((Identifier) => ({ Identifier, Slot: SlotByIdentifier[Identifier] }));
    const Descriptor = MaterialDescriptor(Project, Preset, Images);
    assert.equal(Descriptor.specification, "OpenPBR Surface 1.1.1");
    assert.equal(Descriptor.layers.length, Project.Layers.length);
    assert.equal(Object.keys(Descriptor.textures).length, Images.length);
    for (const Record of Object.values(Descriptor.textures))
    {
        assert.match(Record.file, /^foundry-crate-02_[A-Za-z0-9]+\.png$/, `unexpected file name ${Record.file}`);
        assert.ok(["srgb", "linear"].includes(Record.encoding));
    }
    for (const Identifier of Object.keys(SurfaceDefaults)) assert.ok(Identifier in Descriptor.constants);
});

test("rows are flipped into image orientation without reordering components", () =>
{
    const Width = 2;
    const Height = 2;
    const Pixels = new Uint8ClampedArray([
        1, 2, 3, 4, 5, 6, 7, 8,
        9, 10, 11, 12, 13, 14, 15, 16,
    ]);
    const Flipped = FlipRows(Pixels, Width, Height);
    assert.deepEqual([...Flipped.slice(0, 8)], [9, 10, 11, 12, 13, 14, 15, 16]);
    assert.deepEqual([...Flipped.slice(8)], [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.deepEqual([...FlipRows(Flipped, Width, Height)], [...Pixels]);
});

//--------------------------------------------------------------------------------------------------------------------------
// Procedural finishes. The shader reads families and styles by index, so the ordering here is a contract.
//--------------------------------------------------------------------------------------------------------------------------
test("every finish family declares the controls its shader branch reads", () =>
{
    assert.equal(FinishFamilies.length, 4, "the shader only branches on four families");
    FinishFamilies.forEach((Family, Index) =>
    {
        assert.equal(Family.Index, Index, `${Family.Identifier} does not sit at its declared index`);
        assert.equal(FinishFamilyIndex(Family.Identifier), Index);
        assert.ok(Family.Styles.length >= 4, `${Family.Identifier} offers too few styles`);
        Family.Styles.forEach((Style, Position) => assert.equal(Style.Index, Position, `${Style.Identifier} is out of order`));
        assert.equal(FinishColours(Family.Identifier).length, 2, "every family mixes exactly two colours");
        const Keys = FinishControls(Family.Identifier).map((Control) => Control.Key);
        assert.deepEqual(Keys, ["Scale", "Density", "Strength", "Gloss", "Coat", "Angle", "Variation"], Family.Identifier);
        for (const Control of FinishControls(Family.Identifier))
            assert.ok(Control.Maximum > Control.Minimum, `${Family.Identifier}.${Control.Key} has an empty range`);
    });
    assert.equal(FinishStyleIndex("fabric", "velvet"), 4);
    assert.equal(FinishStyleIndex("fabric", "nonsense"), 0, "an unknown style must fall back rather than throw");
    assert.equal(FinishFamilyIndex("nonsense"), 0);
});

test("the shelf only offers finishes the families can actually evaluate", () =>
{
    assert.ok(FinishShelf.length >= 16, "the shelf is thinner than the four families it covers");
    for (const Family of FinishFamilies)
        assert.ok(
            FinishShelf.some((Entry) => Entry.Family === Family.Identifier),
            `${Family.Identifier} has nothing on the shelf`,
        );
    for (const Entry of FinishShelf)
    {
        const Family = FinishFamilyByIdentifier[Entry.Family];
        assert.ok(Family, `${Entry.Identifier} names a family that does not exist`);
        assert.ok(
            Family.Styles.some((Style) => Style.Identifier === Entry.Style),
            `${Entry.Identifier} names a style ${Entry.Style} its family does not have`,
        );
        assert.match(Entry.Swatch, /^#[0-9a-f]{6}$/i, `${Entry.Identifier} has no swatch`);
        for (const Key of ["ColourA", "ColourB", "Scale", "Density", "Strength", "Gloss", "Coat", "Angle", "Variation"])
            assert.ok(Key in Entry.Settings, `${Entry.Identifier} leaves ${Key} unset`);
    }
    assert.equal(FinishShelf.length, new Set(FinishShelf.map((Entry) => Entry.Identifier)).size, "two finishes share a name");
});

test("a finish record survives creation, sanitising and a hostile project file", () =>
{
    const Created = CreateFinish("raw-denim");
    assert.equal(Created.Family, "fabric");
    assert.equal(Created.Style, "twill");
    assert.equal(Created.Scale, FinishByIdentifier["raw-denim"].Settings.Scale);
    assert.equal(FinishLabel(Created), "Raw denim");
    assert.deepEqual(CreateFinish("nothing-like-this"), { ...FinishDefaults() }, "an unknown shelf entry must fall back");

    const Hostile = SanitiseFinish({
        Shelf: "made-up",
        Family: "porcelain",
        Style: "gilded",
        ColourA: "red",
        ColourB: [2, -1, 0.5],
        Scale: 900,
        Density: -4,
        Gloss: Number.NaN,
        Angle: 1000,
        Seed: 10_000,
    });
    assert.equal(Hostile.Shelf, "");
    assert.equal(Hostile.Family, "automotive");
    assert.equal(Hostile.Style, "metallic");
    assert.deepEqual(Hostile.ColourA, [0.5, 0.5, 0.5]);
    assert.deepEqual(Hostile.ColourB, [1, 0, 0.5]);
    assert.equal(Hostile.Scale, 4);
    assert.equal(Hostile.Density, 0);
    assert.equal(Hostile.Gloss, 0);
    assert.equal(Hostile.Angle, 180);
    assert.equal(Hostile.Seed, 999);
    assert.equal(FinishLabel(Hostile), "Automotive · Metallic flake");
});

test("a material layer carries its finish through the stack and a project round trip", () =>
{
    const Layer = CreateLayer("finish", { Finish: CreateFinish("brushed-brass") });
    assert.equal(Layer.Kind, "finish");
    assert.equal(LayerBadge(Layer), "METAL");
    assert.ok(LayerChannelCount(Layer) >= 8, "a finish should write most of the channel set by default");
    const Restored = SanitiseLayer(JSON.parse(JSON.stringify(Layer)));
    assert.equal(Restored.Finish.Family, "metal");
    assert.equal(Restored.Finish.Style, "brushed");
    assert.equal(Restored.Finish.Angle, Layer.Finish.Angle);
    // A project written before finishes existed must still load.
    const Legacy = SanitiseLayer({ Kind: "fill", Name: "Old fill" });
    assert.deepEqual(Legacy.Finish, SanitiseFinish(undefined));
});

test("a colour mask records a key, a tolerance and the wash it draws in the viewport", () =>
{
    const Fresh = CreateLayer("fill");
    assert.equal(Fresh.Mask.Kind, "none");
    assert.equal(Fresh.Mask.Tolerance, 0.25);
    assert.equal(Fresh.Mask.Colour.length, 3);
    assert.equal(Fresh.Mask.Tint.length, 3);
    assert.ok(MaskKinds.some((Kind) => Kind.Identifier === "colour"), "the colour mask is not offered");

    const Keyed = SanitiseLayer({
        Kind: "fill",
        Mask: { Kind: "colour", Colour: [1, 0.5, 0], Tolerance: 4, Softness: -1, Tint: [0, 1, 0], Invert: true },
    });
    assert.equal(Keyed.Mask.Kind, "colour");
    assert.deepEqual(Keyed.Mask.Colour, [1, 0.5, 0]);
    assert.equal(Keyed.Mask.Tolerance, 1, "tolerance is a unit range");
    assert.equal(Keyed.Mask.Softness, 0);
    assert.deepEqual(Keyed.Mask.Tint, [0, 1, 0]);
    assert.equal(Keyed.Mask.Invert, true);
    assert.match(LayerSummary(Keyed), /colour mask/);

    const Nonsense = SanitiseLayer({ Kind: "fill", Mask: { Kind: "spectral" } });
    assert.equal(Nonsense.Mask.Kind, "none", "an unknown mask kind must not reach the shader");
});

//========================================================================================================================
// Scene assembly. Several objects are folded into one surface so a single bake, a single index and a single stroke serve
// the whole scene; the UDIM tile each object is given is what keeps their texels apart.
//========================================================================================================================
test("udim numbers and tile placements are inverses of one another", () =>
{
    assert.equal(FirstTile, 1001);
    assert.equal(TileNumber(0, 0), 1001);
    assert.equal(TileNumber(3, 0), 1004);
    assert.equal(TileNumber(0, 1), 1011);
    assert.equal(TileNumber(9, 2), 1030);
    for (const Tile of [1001, 1004, 1011, 1030, 1099])
    {
        const { Column, Row } = TilePlacement(Tile);
        assert.equal(TileNumber(Column, Row), Tile, `tile ${Tile} did not survive the round trip`);
    }
    assert.match(TileLabel(1012), /1012/);
});

test("an object record is clamped into renderable ranges", () =>
{
    const Loose = SanitiseObject({
        Name: "x".repeat(200),
        Kind: "dodecahedron",
        Subdivision: 9,
        Scale: 400,
        Offset: [99, -99, "nonsense"],
        Rotation: 900,
        Tile: 2500,
        Visible: "yes",
    });
    assert.ok(Loose.Name.length <= 64);
    assert.equal(Loose.Kind, "cube", "an unknown mesh must fall back to something buildable");
    assert.equal(Loose.Subdivision, 3);
    assert.equal(Loose.Scale, 10);
    assert.deepEqual(Loose.Offset, [12, -12, 0]);
    assert.ok(Loose.Rotation >= 0 && Loose.Rotation <= 360);
    assert.ok(Loose.Tile >= 1001 && Loose.Tile <= 1100);
    assert.equal(Loose.Visible, true);
    assert.ok(Loose.Identifier.length > 0);

    const First = CreateObject({ Name: "One" });
    const Second = CreateObject({ Name: "Two" });
    assert.notEqual(First.Identifier, Second.Identifier, "identifiers must not collide");
});

test("the tile sheet stays square so texels stay square", () =>
{
    assert.deepEqual(SceneTiles([{ Tile: 1001 }]), { Columns: 1, Rows: 1 });
    assert.deepEqual(SceneTiles([{ Tile: 1001 }, { Tile: 1002 }]), { Columns: 2, Rows: 2 });
    assert.deepEqual(SceneTiles([{ Tile: 1001 }, { Tile: 1021 }]), { Columns: 3, Rows: 3 });

    const Rectangle = TileRectangle(1012, 2);
    assert.equal(Rectangle.Size, 0.5);
    assert.equal(Rectangle.Left, 0.5);
    assert.equal(Rectangle.Bottom, 0.5);
});

test("one object assembles into the whole zero-to-one square", () =>
{
    const Scene = AssembleScene([CreateObject({ Name: "Ball", Kind: "sphere", Subdivision: 1, Tile: 1001 })]);
    assert.deepEqual(Scene.Tiles, { Columns: 1, Rows: 1 });
    assert.equal(Scene.Ranges.length, 1);
    assert.equal(Scene.Ranges[0].FirstVertex, 0);
    assert.equal(Scene.Ranges[0].TriangleCount, Scene.Triangles);
    let Highest = 0;
    for (const Value of Scene.Coordinates) Highest = Math.max(Highest, Value);
    assert.ok(Highest > 0.9, "a lone object should still fill its tile");
});

test("several objects become one surface with one range each", () =>
{
    const Objects = [
        CreateObject({ Name: "Ball", Kind: "sphere", Subdivision: 1, Tile: 1001 }),
        CreateObject({ Name: "Box", Kind: "cube", Subdivision: 1, Tile: 1002, Offset: [2, 0, 0] }),
        CreateObject({ Name: "Pipe", Kind: "cylinder", Subdivision: 1, Tile: 1011 }),
    ];
    const Scene = AssembleScene(Objects);
    assert.deepEqual(Scene.Tiles, { Columns: 2, Rows: 2 });
    assert.equal(Scene.Ranges.length, 3);
    assert.equal(Scene.Vertices, Scene.Positions.length / 3);
    assert.equal(Scene.Triangles, Scene.Indices.length / 3);
    assert.equal(Scene.Ownership.length, Scene.Vertices, "every vertex must know which object it came from");

    let Running = 0;
    for (const Range of Scene.Ranges)
    {
        assert.equal(Range.FirstVertex, Running, "ranges must be contiguous");
        Running += Range.VertexCount;
    }
    assert.equal(Running, Scene.Vertices);

    for (const Range of Scene.Ranges)
    {
        const { Left, Bottom, Size } = TileRectangle(Range.Tile, Scene.Tiles.Columns);
        for (let Vertex = Range.FirstVertex; Vertex < Range.FirstVertex + Range.VertexCount; Vertex += 1)
        {
            const U = Scene.Coordinates[Vertex * 2];
            const V = Scene.Coordinates[Vertex * 2 + 1];
            assert.ok(U >= Left - 1e-6 && U <= Left + Size + 1e-6, `u ${U} escaped tile ${Range.Tile}`);
            assert.ok(V >= Bottom - 1e-6 && V <= Bottom + Size + 1e-6, `v ${V} escaped tile ${Range.Tile}`);
        }
    }

    // Offsets move geometry without moving texels.
    assert.ok(Scene.Bounds.Maximum[0] > 1.5, "the offset box should push the bounds out");

    const Owner = ObjectAtTriangle(Scene, Scene.Ranges[2].FirstTriangle);
    assert.equal(Owner.Name, "Pipe");
    assert.equal(ObjectAtTriangle(Scene, -1), null);
    assert.equal(ObjectAtCoordinate(Scene, [0.1, 0.1]).Name, "Ball");
    assert.equal(ObjectAtCoordinate(Scene, [0.6, 0.1]).Name, "Box");
    assert.equal(ObjectAtCoordinate(Scene, [0.1, 0.6]).Name, "Pipe");
    assert.equal(ObjectAtCoordinate(Scene, [0.6, 0.6]), null, "an empty tile owns nothing");
    assert.equal(CoordinateTile(Scene, [0.6, 0.6]), 1012);
    assert.equal(CoordinateTile(Scene, [0.1, 0.1]), 1001);
});

test("hidden objects leave the assembly, but an empty scene still renders", () =>
{
    const Objects = [
        CreateObject({ Name: "Ball", Kind: "sphere", Subdivision: 0, Tile: 1001 }),
        CreateObject({ Name: "Box", Kind: "cube", Subdivision: 0, Tile: 1002, Visible: false }),
    ];
    const Visible = AssembleScene(Objects);
    assert.equal(Visible.Ranges.length, 1);
    assert.equal(Visible.Ranges[0].Name, "Ball");

    const Nothing = AssembleScene(Objects.map((Entry) => ({ ...Entry, Visible: false })));
    assert.equal(Nothing.Ranges.length, 1, "with everything hidden the first object still stands in");
    assert.ok(Nothing.Triangles > 0);
});

test("a custom object consumes the imported surface", () =>
{
    const Imported = AssembleScene([CreateObject({ Kind: "cube", Subdivision: 0, Tile: 1001 })]);
    const Scene = AssembleScene([CreateObject({ Name: "Scan", Kind: "custom", Tile: 1001 })], Imported);
    assert.equal(Scene.Triangles, Imported.Triangles);
    assert.equal(Scene.Ranges[0].Name, "Scan");
});

//========================================================================================================================
// Decal marks. One layer holds one piece of artwork and any number of placements of it.
//========================================================================================================================
test("a decal layer opens with one mark and keeps its artwork shared", () =>
{
    const Layer = CreateLayer("decal", { Decal: { Placement: "project" } });
    assert.equal(Layer.Decal.Marks.length, 1);
    assert.equal(Layer.Decal.Selection, Layer.Decal.Marks[0].Identifier);
    assert.equal(Layer.Decal.Marks[0].Mode, "projection");
    assert.ok(Layer.Decal.Marks[0].Transform.Size > 0);

    const Copy = CloneLayer(Layer);
    assert.equal(Copy.Decal.Marks.length, 1);
    Copy.Decal.Marks[0].Transform.Size = 1.4;
    assert.notEqual(Layer.Decal.Marks[0].Transform.Size, 1.4, "a clone must not share mark records");
});

test("marks are sanitised one by one and a legacy decal becomes a single mark", () =>
{
    const Legacy = SanitiseLayer({ Kind: "decal", Decal: { Transform: { Size: 1.1, Rotation: 540 }, Tint: [1, 0, 0] } });
    assert.equal(Legacy.Decal.Marks.length, 1, "an old decal layer must still render");
    assert.equal(Legacy.Decal.Marks[0].Transform.Size, 1.1);
    assert.equal(Legacy.Decal.Marks[0].Transform.Rotation, 360, "rotation is clamped");
    assert.deepEqual(Legacy.Decal.Marks[0].Tint, [1, 0, 0], "the mark inherits the decal colour");

    const Many = SanitiseLayer({
        Kind: "decal",
        Decal: {
            Marks: [
                { Name: "Bonnet", Folder: "Body", Tint: [0, 1, 0], Transform: { Size: 9 } },
                { Name: "Door", Visible: false, Mode: "plane", Plane: { Size: 0.3 } },
            ],
            Selection: "nonsense",
        },
    });
    assert.equal(Many.Decal.Marks.length, 2);
    assert.equal(Many.Decal.Marks[0].Folder, "Body");
    assert.equal(Many.Decal.Marks[0].Transform.Size, 2.4, "size is clamped to the slider range");
    assert.equal(Many.Decal.Marks[1].Visible, false);
    assert.equal(Many.Decal.Marks[1].Mode, "plane");
    assert.equal(Many.Decal.Selection, Many.Decal.Marks[1].Identifier, "a stale selection falls back to the top mark");

    const Hostile = SanitiseLayer({ Kind: "decal", Decal: { Marks: new Array(MarkLimit + 12).fill({ Name: "x" }) } });
    assert.equal(Hostile.Decal.Marks.length, MarkLimit, "the mark count is capped");

    const Fresh = CreateMark(undefined, { Name: "Loose" });
    assert.equal(Fresh.Name, "Loose");
    assert.notEqual(Fresh.Identifier, CreateMark(undefined).Identifier);
    assert.equal(SanitiseMark(undefined, { Mode: "plane", Tint: [0, 0, 1] }).Mode, "plane");
});

test("the layer summary counts marks", () =>
{
    const Layer = CreateLayer("decal", { Decal: { Placement: "project" } });
    Layer.Decal.Marks.push(CreateMark(Layer.Decal));
    assert.match(LayerSummary(Layer), /2 marks/);
    assert.match(LayerSummary(CreateLayer("decal")), /stamped/, "a stamping layer has no marks to count");
});

test("a decal is stamped into the texture or placed on the surface, and the two are kept apart", () =>
{
    const Stamped = CreateLayer("decal");
    assert.equal(Stamped.Decal.Placement, "stamp", "a new decal layer burns its artwork in");
    assert.equal(Stamped.Decal.Marks.length, 0, "nothing is projected until the kind is changed");
    assert.equal(Stamped.Decal.Selection, "");

    const Placed = CreateLayer("decal", { Decal: { Placement: "project" } });
    assert.equal(Placed.Decal.Marks.length, 1);
    assert.equal(Placed.Decal.Marks[0].Placed, false, "the placement waits for the click that puts it on the model");

    const Legacy = SanitiseLayer({ Kind: "decal", Decal: { Transform: { Size: 0.6 } } });
    assert.equal(Legacy.Decal.Placement, "project", "a project written before the two kinds existed still projects");
    assert.equal(Legacy.Decal.Marks.length, 1);

    const Written = SanitiseLayer({ Kind: "decal", Decal: { Placement: "stamp" } });
    assert.equal(Written.Decal.Placement, "stamp");
    assert.equal(Written.Decal.Marks.length, 0, "a stamping layer is read back without inventing a placement");

    const Nonsense = SanitiseLayer({ Kind: "decal", Decal: { Placement: "sideways" } });
    assert.equal(Nonsense.Decal.Placement, "project");
});

//========================================================================================================================
// The timeline. Typed events on branches, a head that steps, and a .pigment document that carries all of it.
//========================================================================================================================
test("every event kind has a badge and an accent the rail can draw", () =>
{
    assert.ok(EventKinds.length >= 6);
    for (const Kind of EventKinds)
    {
        assert.match(Kind.Badge, /^[A-Z]{2,9}$/);
        assert.match(Kind.Accent, /^#[0-9a-f]{6}$/i);
        assert.equal(EventByKind[Kind.Identifier], Kind);
    }
    const Event = CreateEvent({ Kind: "nonsense", Title: "x".repeat(200) });
    assert.equal(Event.Kind, "structure", "an unknown kind must still render");
    assert.ok(Event.Title.length <= 96);
    assert.match(Event.Hash, /^[0-9a-f]{7}$/);
    assert.match(EventClock(Date.UTC(2026, 0, 2, 3, 4, 5)), /^\d{2}:\d{2}:\d{2}$/);
    assert.equal(ShortHash("same"), ShortHash("same"), "the hash is stable");
    assert.notEqual(ShortHash("same"), ShortHash("other"));
});

test("the head steps back and forward over the events", () =>
{
    const Timeline = new TimelineSequence();
    assert.equal(Timeline.Depth, 0);
    assert.equal(Timeline.CanStepBack, false);
    Timeline.Record({ Kind: "document", Title: "Canvas created" });
    Timeline.Record({ Kind: "stroke", Title: "Added stroke (412 points)" });
    Timeline.Record({ Kind: "material", Title: "Create M_CarPaint", Colour: [0.8, 0.1, 0.1] });
    assert.equal(Timeline.Depth, 3);
    assert.equal(Timeline.Head, 3);
    assert.equal(Timeline.CanStepForward, false);

    assert.equal(Timeline.StepBack(), true);
    assert.equal(Timeline.Head, 2);
    assert.equal(Timeline.CanStepForward, true);
    assert.equal(Timeline.StepForward(), true);
    assert.equal(Timeline.Head, 3);
    assert.equal(Timeline.Visit(Timeline.Events[0].Identifier), 1);
    assert.equal(Timeline.Visit("nothing"), -1);
});

test("editing after stepping back forks a branch instead of losing the future", () =>
{
    const Timeline = new TimelineSequence();
    Timeline.Record({ Kind: "document", Title: "Canvas created" });
    Timeline.Record({ Kind: "stroke", Title: "Added stroke" });
    Timeline.Record({ Kind: "generator", Title: "Generator applied" });
    Timeline.StepBack();
    Timeline.StepBack();
    Timeline.Record({ Kind: "material", Title: "Params changed" });

    assert.equal(Timeline.Branches.length, 2, "the edit should have forked");
    assert.equal(Timeline.Depth, 2, "the branch keeps what came before the head");
    assert.equal(Timeline.Branch.Parent, "branch-1");
    assert.equal(Timeline.Branch.Origin, 1);
    assert.equal(Timeline.Branches[0].Events.length, 3, "the first branch is untouched");

    const Named = Timeline.Fork("Experiment");
    assert.equal(Named.Name, "Experiment");
    Timeline.Rename(Named.Identifier, "Varnish study");
    assert.equal(Timeline.Branch.Name, "Varnish study");
    assert.equal(Timeline.Switch("branch-1"), true);
    assert.equal(Timeline.Depth, 3);
    assert.equal(Timeline.Switch("branch-99"), false);
    assert.equal(Timeline.Remove(Named.Identifier), true);
    assert.equal(Timeline.Branches.length, 2);

    while (Timeline.Branches.length < BranchLimit) Timeline.Fork();
    const Capped = Timeline.Branches.length;
    Timeline.Fork();
    assert.equal(Timeline.Branches.length, Capped, "the branch count is capped");
});

test("a timeline survives serialisation, and clearing leaves one seeded branch", () =>
{
    const Timeline = new TimelineSequence();
    Timeline.Record({ Kind: "document", Title: "Canvas created" });
    Timeline.Record({ Kind: "decal", Title: "Placed Mark 2", Colour: [0, 1, 0] });
    Timeline.Fork("Side");
    Timeline.Record({ Kind: "surface", Title: "Tile 1002" });

    const Record = Timeline.Serialise();
    const Copy = new TimelineSequence();
    assert.equal(Copy.Restitute(Record), true);
    assert.equal(Copy.Branches.length, 2);
    assert.equal(Copy.Branch.Name, "Side");
    assert.equal(Copy.Depth, 3);
    assert.deepEqual(Copy.Events[1].Colour, [0, 1, 0]);
    assert.equal(Copy.Restitute({ Branches: [] }), false, "an empty record must not wipe the timeline");

    Copy.Clear({ Kind: "document", Title: "Timeline cleared" });
    assert.equal(Copy.Branches.length, 1);
    assert.equal(Copy.Depth, 1);
    assert.equal(Copy.Head, 1);
});

test("a .pigment document carries the project, the camera and the timeline", () =>
{
    const Timeline = new TimelineSequence();
    Timeline.Record({ Kind: "document", Title: "Canvas created" });
    const Project = DefaultProject();
    const Written = ComposeDocument(Project, { Distance: 3 }, Timeline.Serialise());
    assert.equal(Written.Format, DocumentFormat);
    assert.equal(DocumentExtension, ".pigment");
    assert.equal(Written.Project.Name, Project.Name);
    assert.equal(Written.Timeline.Branches.length, 1);

    const Read = ReadDocument(JSON.stringify(Written));
    assert.equal(Read.Project.Name, Project.Name);
    assert.equal(Read.Camera.Distance, 3);
    assert.equal(Read.Timeline.Branches[0].Events.length, 1);

    // The flat project files earlier builds wrote must still open.
    const Legacy = ReadDocument(JSON.stringify({ ...Project, Camera: { Distance: 5 } }));
    assert.equal(Legacy.Project.Name, Project.Name);
    assert.equal(Legacy.Timeline, null);
    assert.equal(Legacy.Camera.Distance, 5);
});

test("a layer can be scoped to one object", () =>
{
    const Layer = CreateLayer("fill");
    assert.equal(Layer.Object, "", "a new layer belongs to the whole scene");
    const Scoped = SanitiseLayer({ Kind: "fill", Object: "object-7" });
    assert.equal(Scoped.Object, "object-7");
    assert.equal(SanitiseLayer({ Kind: "fill", Object: 42 }).Object, "", "a nonsense scope is dropped");
    assert.ok(SanitiseLayer({ Kind: "fill", Object: "x".repeat(200) }).Object.length <= 64);
});

test("a fresh mark waits for its first click, and an old one does not", () =>
{
    const Layer = CreateLayer("decal", { Decal: { Placement: "project" } });
    assert.equal(Layer.Decal.Marks[0].Placed, false, "a new decal layer has nothing on the model yet");

    const Legacy = SanitiseLayer({ Kind: "decal", Decal: { Transform: { Size: 0.4 } } });
    assert.equal(Legacy.Decal.Marks[0].Placed, true, "a project written before marks existed is already placed");

    const Read = SanitiseLayer({ Kind: "decal", Decal: { Marks: [{ Name: "A" }, { Name: "B", Placed: false }] } });
    assert.equal(Read.Decal.Marks[0].Placed, true, "a saved mark defaults to placed");
    assert.equal(Read.Decal.Marks[1].Placed, false);
});
