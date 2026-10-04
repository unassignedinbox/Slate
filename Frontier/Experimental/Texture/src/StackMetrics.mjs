//============================================================================================================================================
// 🧱 StackMetrics.mjs — node --test coverage for the stack: channels, layers, materials, strokes, revisions and export
//============================================================================================================================================
// The GPU trusts these records blindly, so the contract is asserted here instead: channel order matches the shader's
// packing, blend identifiers keep their GLSL index, sanitising a hostile project file yields a renderable stack, and the
// revision queue stays inside its byte budget while still walking edits in order.
//============================================================================================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

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
    CreateLayer,
    CloneLayer,
    ExpandMaterial,
    DefaultProject,
    DefaultStack,
    SanitiseProject,
    LayerChannelCount,
    LayerBadge,
    ResetLayerCounter,
} from "./LayerSpecification.js";
import { RevisionQueue } from "./RevisionQueue.js";
import { StrokeProjection, BrushDefaults, MirrorVector, ToolOrdering } from "./StrokeProjection.js";
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
