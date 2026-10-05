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
    TimelineSequence,
    CreateEvent,
    EventByKind,
    EventKinds,
    ShortHash,
    EventClock,
    BranchLimit,
    SanitisePreview,
    PreviewLimit,
} from "./TimelineSequence.js";
import { ComposeDocument, ReadDocument, DocumentFormat, DocumentExtension, FlipGreen, ExportSizes } from "./ExportSequence.js";
import {
    EncodePng,
    DecodePng,
    EncodeSheet,
    DecodeSheet,
    BytesFromText,
    BlankSheet,
    ResampleSheet,
    CollectSheets,
    ApplySheets,
    SheetTally,
} from "./SheetCodec.js";
import {
    InstrumentFamilies,
    InstrumentByKey,
    InstrumentArtwork,
    InstrumentRecord,
    BrushFromInstrument,
    VisibleControls,
} from "./InstrumentSpecification.js";
import {
    MediaFromInstrument,
    MediaUniforms,
    MediaWidth,
    MediaExtent,
    MediumOrdering,
    PlainMedia,
    Deposit,
    ToothField,
} from "./MediaSolver.js";
import { SliderRow, Fraction, Fixed } from "./ControlSpecification.js";

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
import {
    SurfaceDefaults,
    SurfaceControls,
    MaterialLibrary,
    MaterialByIdentifier,
    MetalArchive,
    MetalByIdentifier,
    MetalPreset,
    EnvironmentOrdering,
} from "./MaterialSpecification.js";
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
    FinishStyles,
    FinishControls,
    FinishColours,
    FinishLabel,
} from "./FinishSpecification.js";
import {
    StrokeModes,
    GradientShapes,
    LineSnaps,
    LineSamples,
    LineSampleLimit,
    SnapLine,
    CurvePresets,
    DefaultCurve,
    SortCurve,
    EvaluateCurve,
    CurveTable,
    CurveIsPlain,
    CurveLimit,
    PlaceCurvePoint,
    LiftCurvePoint,
    WriteSlots,
    WriteKeys,
    DefaultWrites,
    WriteOrdering,
    WritesSummary,
} from "./StrokeSpecification.js";
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
    LayerResolutions,
    SanitiseLayer,
    MaskKinds,
    ResetLayerCounter,
    CreateMark,
    SanitiseMark,
    MarkLimit,
    OrderStack,
    LayerSubtree,
    LayerInside,
    LayerAncestry,
    CanHold,
    CompositeOrdering,
    FolderLimit,
} from "./LayerSpecification.js";
import { RevisionQueue } from "./RevisionQueue.js";
import {
    StrokeProjection,
    BrushDefaults,
    MirrorVector,
    ToolOrdering,
    MarkReach,
    MarkUnderPoint,
    SymmetryTwins,
    SymmetryOrdering,
    SectorLimits,
    PointerIntent,
} from "./StrokeProjection.js";
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

test("a conductor carries both ends of its Fresnel, and a preset keeps them", () =>
{
    assert.ok(MetalArchive.length >= 12, "too few metals to be worth calling an archive");
    const Seen = new Set();
    for (const Metal of MetalArchive)
    {
        assert.ok(!Seen.has(Metal.Identifier), `${Metal.Identifier} appears twice`);
        Seen.add(Metal.Identifier);
        assert.equal(MetalByIdentifier[Metal.Identifier], Metal);
        for (const Key of ["Reflectance", "EdgeTint"])
        {
            assert.equal(Metal[Key].length, 3, `${Metal.Identifier}.${Key}`);
            assert.ok(Metal[Key].every((Component) => Component >= 0 && Component <= 1), `${Metal.Identifier}.${Key} is not linear`);
        }
        // 🔴 A conductor is bright. Anything reflecting less than a third at normal incidence is a dielectric wearing
        //    a metal's name, and the F82 dip must sit ABOVE the facing colour — that is the whole point of the form.
        assert.ok(Math.max(...Metal.Reflectance) > 0.33, `${Metal.Identifier} is too dark to be a metal`);
        Metal.EdgeTint.forEach((Component, Index) =>
            assert.ok(Component >= Metal.Reflectance[Index] - 1e-6, `${Metal.Identifier} dips below its facing colour`));
        assert.ok(Metal.Roughness > 0 && Metal.Roughness < 1, `${Metal.Identifier} has no mill finish`);
        assert.ok(Metal.Anisotropy >= 0 && Metal.Anisotropy <= 1);
    }

    // Gold and silver are the two everyone checks, so they are the two worth pinning.
    assert.deepEqual(MetalByIdentifier.gold.Reflectance, [1, 0.766, 0.336]);
    assert.ok(MetalByIdentifier.silver.Reflectance[0] > 0.95, "silver is the brightest metal there is");
    assert.ok(MetalByIdentifier.copper.Reflectance[0] > MetalByIdentifier.copper.Reflectance[2], "copper is not red");

    const Preset = MetalPreset("copper");
    assert.equal(Preset.Identifier, "metal-copper");
    assert.equal(Preset.Category, "metal");
    assert.deepEqual(Preset.Surface.specular_color, MetalByIdentifier.copper.EdgeTint, "the dip was dropped");
    assert.equal(Preset.Layers[0].Channels.base_metalness, 1);
    assert.deepEqual(Preset.Layers[0].Channels.base_color, MetalByIdentifier.copper.Reflectance);
    assert.ok(/^#[0-9a-f]{6}$/.test(Preset.Swatch), Preset.Swatch);
    assert.equal(MetalPreset("nonsense"), null);
    // The swatch is for the eye, so it is the colour after the transfer curve, not the linear one.
    assert.equal(MetalPreset("gold").Swatch, "#ffe29b");

    // And every one of them reached the library the browser reads.
    for (const Metal of MetalArchive)
        assert.ok(MaterialByIdentifier[`metal-${Metal.Identifier}`], `${Metal.Identifier} never reached the shelf`);
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

test("a stack with folders in it is repaired into a tree", () =>
{
    const Make = (Identifier, Kind, Parent = "") => ({ ...CreateLayer(Kind), Identifier, Parent, Name: Identifier });
    const Folder = Make("set", "folder");
    const Inner = Make("inner", "folder", "set");
    const Stack = OrderStack([Make("a", "fill", "inner"), Folder, Inner, Make("b", "fill"), Make("c", "fill", "set")]);
    const Order = Stack.map((Layer) => Layer.Identifier);

    // Children sit behind their folder, so the stack reads top down as folder, contents, folder, contents.
    assert.deepEqual(Order, ["a", "inner", "c", "set", "b"], Order.join(","));
    assert.deepEqual(LayerSubtree(Stack, "set").map((Layer) => Layer.Identifier), ["a", "inner", "c", "set"]);
    assert.deepEqual(LayerInside(Stack, "inner").map((Layer) => Layer.Identifier), ["a"]);
    assert.equal(LayerAncestry(Stack, "a").length, 2, "a sits two folders deep");

    // Nothing may hold itself, or anything that already holds it.
    assert.equal(CanHold(Stack, "set", "a"), false, "a folder was dropped inside itself");
    assert.equal(CanHold(Stack, "set", "set"), false);
    assert.equal(CanHold(Stack, "b", "set"), true);

    // A parent that is not a folder, is missing, or closes a loop is dropped.
    const Broken = OrderStack([
        { ...CreateLayer("fill"), Identifier: "x", Parent: "ghost" },
        { ...CreateLayer("fill"), Identifier: "y", Parent: "x" },
        { ...CreateLayer("folder"), Identifier: "p", Parent: "q" },
        { ...CreateLayer("folder"), Identifier: "q", Parent: "p" },
    ]);
    assert.equal(Broken.find((Layer) => Layer.Identifier === "x").Parent, "", "a missing parent survived");
    assert.equal(Broken.find((Layer) => Layer.Identifier === "y").Parent, "", "a layer parented to a non-folder survived");
    assert.ok(Broken.filter((Layer) => Layer.Parent === "").length >= 3, "a loop survived");
    assert.equal(Broken.length, 4, "the repair lost a layer");

    // Nesting stops at the limit.
    const Deep = [];
    for (let Level = 0; Level <= FolderLimit + 2; Level += 1)
        Deep.push({ ...CreateLayer("folder"), Identifier: `f${Level}`, Parent: Level ? `f${Level - 1}` : "" });
    const Repaired = OrderStack(Deep);
    assert.ok(
        Repaired.every((Layer) => LayerAncestry(Repaired, Layer.Identifier).length <= FolderLimit),
        "the tree nests deeper than the limit",
    );
});

test("a folder weighs what is inside it, and isolation leaves the rest out", () =>
{
    const Make = (Identifier, Kind, Parent = "") => ({ ...CreateLayer(Kind), Identifier, Parent, Name: Identifier });
    const Stack = OrderStack([
        Make("ground", "fill"),
        Make("set", "folder"),
        Make("paint", "stroke", "set"),
        Make("detail", "fill", "set"),
    ]);
    const Named = (Ordering) => Ordering.map((Layer) => Layer.Identifier);
    const Folder = Stack.find((Layer) => Layer.Identifier === "set");
    const Paint = Stack.find((Layer) => Layer.Identifier === "paint");

    // A folder never composites itself; what it holds does, in stack order.
    assert.deepEqual(Named(CompositeOrdering(Stack)), ["ground", "paint", "detail"]);

    Folder.Opacity = 0.5;
    Paint.Opacity = 0.4;
    const Weighed = CompositeOrdering(Stack);
    assert.ok(Math.abs(Weighed.find((Layer) => Layer.Identifier === "paint").Opacity - 0.2) < 1e-6, "the folder did not weigh its contents");
    assert.ok(Math.abs(Weighed.find((Layer) => Layer.Identifier === "ground").Opacity - 1) < 1e-6, "the folder weighed a layer outside it");
    assert.ok(Stack.every((Layer) => Layer.Opacity !== 0.2), "compositing edited the stack instead of copying it");
    Folder.Opacity = 1;
    Paint.Opacity = 1;

    Folder.Visible = false;
    assert.deepEqual(Named(CompositeOrdering(Stack)), ["ground"], "a hidden folder left its contents in the composite");

    // Isolation overrides the folder it is inside, or isolating a layer in a closed folder would show nothing.
    assert.deepEqual(Named(CompositeOrdering(Stack, "paint")), ["paint"]);
    assert.deepEqual(Named(CompositeOrdering(Stack, "set")), ["paint", "detail"]);
    assert.deepEqual(Named(CompositeOrdering(Stack, "ground")), ["ground"]);
    Folder.Visible = true;

    // An isolated layer that is not in the stack at all cannot blank the composite.
    assert.deepEqual(Named(CompositeOrdering(Stack, "gone")), ["ground", "paint", "detail"]);
});

test("a straight line is aimed in screen space, and the angle can be held", () =>
{
    assert.deepEqual(StrokeModes.map((Mode) => Mode.Identifier), ["freehand", "line", "gradient"]);
    assert.deepEqual(GradientShapes.map((Shape) => Shape.Identifier), ["linear", "radial"]);
    assert.ok(LineSnaps.includes(0), "there is no free angle");

    // Samples run end to end, both ends included, at roughly the step asked for.
    const Walk = LineSamples([0, 0], [40, 0], 4);
    assert.equal(Walk.length, 11);
    assert.deepEqual(Walk[0], [0, 0]);
    assert.deepEqual(Walk[Walk.length - 1], [40, 0]);
    assert.equal(LineSamples([0, 0], [0, 0], 4).length, 2, "a line of no length still has its ends");
    assert.ok(LineSamples([0, 0], [1e6, 0], 1).length <= LineSampleLimit + 1, "a long drag asked for every pixel");

    // Snapping holds the ANGLE and keeps the length the hand asked for.
    const Flat = SnapLine([0, 0], [100, 9], 90);
    assert.ok(Math.abs(Flat[1]) < 1e-9, `${Flat[1]}`);
    assert.ok(Math.abs(Math.hypot(Flat[0], Flat[1]) - Math.hypot(100, 9)) < 1e-9, "the snap changed the length");
    assert.deepEqual(SnapLine([0, 0], [100, 9], 0), [100, 9], "a free line was snapped anyway");
    const Diagonal = SnapLine([0, 0], [100, 80], 45);
    assert.ok(Math.abs(Diagonal[0] - Diagonal[1]) < 1e-9, "45° did not come out at 45°");
});

test("a pressure curve stays inside its box and never turns back on itself", () =>
{
    // The ends are pinned, the order is fixed, and two points on one x are nudged apart.
    const Mess = SortCurve([[0.6, 0.4], [0.2, 2], [0.2, -1]]);
    assert.equal(Mess[0][0], 0, "the curve has no answer for no pressure");
    assert.equal(Mess[Mess.length - 1][0], 1, "the curve has no answer for full pressure");
    assert.ok(Mess.every(([Across, Up]) => Across >= 0 && Across <= 1 && Up >= 0 && Up <= 1), "a point left the box");
    for (let Index = 1; Index < Mess.length; Index += 1) assert.ok(Mess[Index][0] > Mess[Index - 1][0], "two points share an x");

    for (const Preset of CurvePresets)
    {
        const Table = CurveTable(Preset.Points, 48);
        assert.ok(Table.every((Value) => Value >= 0 && Value <= 1), `${Preset.Identifier} left the box`);
        const Rising = Preset.Identifier !== "steady";
        if (Rising)
            Table.forEach((Value, Index) =>
            {
                if (Index) assert.ok(Value >= Table[Index - 1] - 1e-9, `${Preset.Identifier} turned back on itself`);
            });
    }

    // Monotone cubic, not Catmull-Rom: a flat shoulder must not bulge above the points that made it.
    const Shoulder = [[0, 0], [0.45, 0.95], [0.55, 0.95], [1, 1]];
    assert.ok(Math.max(...CurveTable(Shoulder, 64)) <= 1 + 1e-9, "the curve overshot its own points");

    assert.equal(EvaluateCurve(DefaultCurve("linear"), 0.5), 0.5);
    assert.equal(EvaluateCurve(DefaultCurve("steady"), 0), 1, "a steady curve should ignore pressure");
    assert.ok(CurveIsPlain(DefaultCurve("linear")), "the curve that does nothing was not recognised");
    assert.ok(!CurveIsPlain(DefaultCurve("soft")));
    assert.equal(EvaluateCurve(DefaultCurve("linear"), -5), 0, "a reading below zero escaped");
    assert.equal(EvaluateCurve(DefaultCurve("linear"), 5), 1, "a reading above one escaped");

    // Points come and go, but never the two that hold the ends.
    const Placed = PlaceCurvePoint(DefaultCurve("linear"), 0.5, 0.2);
    assert.equal(Placed.length, 3);
    assert.equal(LiftCurvePoint(Placed, 1).length, 2);
    assert.equal(LiftCurvePoint(Placed, 0).length, 3, "the first point was lifted");
    assert.equal(LiftCurvePoint(Placed, 2).length, 3, "the last point was lifted");
    let Crowded = DefaultCurve("linear");
    for (let Which = 0; Which < CurveLimit + 4; Which += 1) Crowded = PlaceCurvePoint(Crowded, (Which + 1) / 20, 0.5);
    assert.ok(Crowded.length <= CurveLimit, `${Crowded.length} points`);
});

test("the channels a stroke may write become one colour mask per image", () =>
{
    assert.equal(WriteSlots.length, 4, "coverage and the three painted images");
    assert.equal(WriteKeys.length, 11, "eleven channels a stroke can be aimed at");

    const Everything = WriteOrdering(DefaultWrites());
    assert.ok(Everything.Full, "the default is not the single draw it should be");
    assert.ok(Everything.Slots.every((Slot) => Slot.Mask.length === 4 && Slot.Mask.every(Boolean)));
    assert.equal(WritesSummary(DefaultWrites()), "Every channel");

    // Base colour spreads over three components; the layer's own cover is the fourth and is never masked off.
    const Quiet = WriteOrdering({ ...DefaultWrites(), base_color: false });
    assert.deepEqual(Quiet.Slots[0].Mask, [false, false, false, true], "the layer's cover was masked off with the colour");
    assert.ok(!Quiet.Full);

    const Rough = WriteOrdering({ ...DefaultWrites(), specular_roughness: false, height: false });
    assert.deepEqual(Rough.Slots[1].Mask, [false, true, true, false]);
    assert.deepEqual(Rough.Slots[2].Mask, [true, true, true, true], "a different image was masked");

    // Emission spreads over three as well, and transmission sits beside it.
    const Dark = WriteOrdering({ ...DefaultWrites(), emission_color: false });
    assert.deepEqual(Dark.Slots[3].Mask, [false, false, false, true]);

    const Nothing = WriteOrdering(Object.fromEntries(WriteKeys.map((Key) => [Key, false])));
    assert.deepEqual(Nothing.Slots[1].Mask, [false, false, false, false], "an image with nothing on is still drawn");
    assert.equal(WritesSummary(Object.fromEntries(WriteKeys.map((Key) => [Key, false]))), "Cover only");
    assert.ok(WritesSummary({ ...DefaultWrites(), height: false }).includes("of 11"));

    // An unknown key cannot turn anything off.
    assert.ok(WriteOrdering({ nonsense: false }).Full);
});

test("only the left button paints, and every other button drives the camera", () =>
{
    // The rule the hand depends on: a brush in the toolbar must not mean a brush on the right button, or the camera
    // cannot be moved without leaving a mark on the model.
    for (const Tool of ToolOrdering.map((Entry) => Entry.Identifier))
    {
        const Left = PointerIntent({ Button: 0, Tool });
        assert.equal(Left.Paint, Tool !== "orbit", `the left button with ${Tool} in hand`);
        for (const Button of [1, 2, 3, 4])
        {
            const Other = PointerIntent({ Button, Tool });
            assert.equal(Other.Paint, false, `button ${Button} painted with ${Tool} in hand`);
            assert.equal(Other.Navigate, true, `button ${Button} did not reach the camera`);
        }
    }

    // Orbit is the default camera move, because it is the one wanted mid-stroke. Sliding is asked for by name.
    assert.equal(PointerIntent({ Button: 2, Tool: "brush" }).Orbit, true, "right-drag does not orbit");
    assert.equal(PointerIntent({ Button: 2, Tool: "brush" }).Pan, false, "right-drag pans");
    assert.equal(PointerIntent({ Button: 1, Tool: "brush" }).Pan, true, "middle-drag does not pan");
    assert.equal(PointerIntent({ Button: 2, Tool: "brush", Shift: true }).Pan, true, "shift and right-drag does not pan");
    assert.equal(PointerIntent({ Button: 0, Tool: "brush", Space: true }).Pan, true, "space and left-drag does not pan");
    assert.equal(PointerIntent({ Button: 0, Tool: "brush", Space: true }).Paint, false, "space and left-drag painted");
    assert.equal(PointerIntent({ Button: 0, Tool: "orbit" }).Orbit, true, "the orbit tool does not orbit from the left");
    assert.equal(PointerIntent({ Button: 0, Tool: "brush", Shift: true }).Paint, true, "shift stopped the brush painting");

    // Paint and navigate are opposites, never both and never neither, whatever is handed in.
    for (const Reading of [{}, { Button: 0 }, { Button: 2 }, { Button: 1, Space: true }, { Tool: "orbit", Shift: true }])
    {
        const Intent = PointerIntent(Reading);
        assert.equal(Intent.Paint, !Intent.Navigate, `${JSON.stringify(Reading)} is in two minds`);
        assert.ok(!(Intent.Pan && Intent.Orbit), `${JSON.stringify(Reading)} pans and orbits at once`);
    }
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
        // Seven sliders every family, but the sixth is the family's own: automotive spends it on orange peel, which
        // is the one thing every real car panel has and no other family does, while the rest rotate their field.
        // Automotive carries two more on top, because flake is a physical size and a physical tilt and nothing else
        // in the editor has either.
        const Keys = FinishControls(Family.Identifier).map((Control) => Control.Key);
        const Expected =
            Family.Identifier === "automotive"
                ? ["Scale", "Flake", "Density", "Strength", "Tilt", "Gloss", "Coat", "Peel", "Variation"]
                : ["Scale", "Density", "Strength", "Gloss", "Coat", "Angle", "Variation"];
        assert.deepEqual(Keys, Expected, Family.Identifier);
        for (const Control of FinishControls(Family.Identifier))
            assert.ok(Control.Maximum > Control.Minimum, `${Family.Identifier}.${Control.Key} has an empty range`);
    });
    assert.equal(FinishStyleIndex("fabric", "velvet"), 4);
    // The automotive branch is the one the GLSL switches on by number, so the order is load bearing.
    assert.deepEqual(
        FinishStyles("automotive").map((Style) => Style.Identifier),
        ["solid", "metallic", "pearl", "candy", "matte", "chameleon", "primer"],
        "the automotive styles no longer line up with the shader",
    );
    assert.equal(FinishStyleIndex("fabric", "nonsense"), 0, "an unknown style must fall back rather than throw");
    assert.equal(FinishFamilyIndex("nonsense"), 0);
});

test("flake is a size on the panel, and the shelf chooses one per paint", () =>
{
    const Automotive = FinishShelf.filter((Entry) => Entry.Family === "automotive");
    for (const Entry of Automotive)
    {
        assert.ok(Entry.Settings.Flake >= 0.4 && Entry.Settings.Flake <= 24, `${Entry.Identifier} flake ${Entry.Settings.Flake}`);
        assert.ok(Entry.Settings.Tilt >= 0 && Entry.Settings.Tilt <= 1, Entry.Identifier);
        // A paint with no flake in it must not be given a tilt, and a flake paint must be given one, or the shelf is
        // choosing numbers the user then has to undo.
        const Flaked = ["metallic", "pearl", "candy", "chameleon"].includes(Entry.Style);
        if (!Flaked && Entry.Style !== "matte") assert.equal(Entry.Settings.Tilt, 0, `${Entry.Identifier} tilts nothing`);
        if (Flaked) assert.ok(Entry.Settings.Tilt > 0.2, `${Entry.Identifier} has flake that cannot flare`);
    }

    // The show flake is the coarse one. If that ever stops being true the shelf has lost its range.
    const Coarse = Automotive.find((Entry) => Entry.Identifier === "hot-rod-flake");
    const Fine = Automotive.find((Entry) => Entry.Identifier === "obsidian-black");
    assert.ok(Coarse.Settings.Flake > Fine.Settings.Flake * 4, "the coarse and fine metallics are the same paint");

    const Clamped = SanitiseFinish({ Family: "automotive", Style: "metallic", Flake: 900, Tilt: 7 });
    assert.equal(Clamped.Flake, 24);
    assert.equal(Clamped.Tilt, 1);
    assert.equal(SanitiseFinish({ Flake: -5, Tilt: -5 }).Flake, 0.4);
    assert.equal(SanitiseFinish({ Flake: -5, Tilt: -5 }).Tilt, 0);
    assert.equal(FinishDefaults().Flake, 4, "the default flake moved");
    // 🔴 Two texels is the floor. At the default sheet a texel is about two millimetres of panel, so a flake any
    //    finer than this is a number the sheet cannot keep, however honest the millimetres are.
    assert.ok(FinishDefaults().Flake >= 4, "the default flake is below what a 1024 sheet can hold");
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
        for (const Key of ["ColourA", "ColourB", "Scale", "Density", "Strength", "Gloss", "Coat", "Angle", "Variation"].concat(
            Entry.Family === "automotive" ? ["Peel"] : [],
        ))
            assert.ok(Key in Entry.Settings, `${Entry.Identifier} leaves ${Key} unset`);
    }
    assert.equal(FinishShelf.length, new Set(FinishShelf.map((Entry) => Entry.Identifier)).size, "two finishes share a name");
});

test("the automotive shelf covers every paint system the branch can evaluate", () =>
{
    const Paints = FinishShelf.filter((Entry) => Entry.Family === "automotive");
    assert.ok(Paints.length >= 16, `only ${Paints.length} automotive finishes on the shelf`);
    for (const Style of FinishStyles("automotive"))
        assert.ok(
            Paints.some((Entry) => Entry.Style === Style.Identifier),
            `nothing on the shelf is a ${Style.Identifier}`,
        );
    for (const Entry of Paints)
    {
        const Finish = SanitiseFinish(CreateFinish(Entry.Identifier));
        assert.equal(Finish.Family, "automotive");
        assert.ok(Finish.Peel >= 0 && Finish.Peel <= 1, `${Entry.Identifier} has no orange peel figure`);
        // Pigment is stored linear while the swatch is sRGB; a preset that forgot the conversion reads far too bright.
        const Swatch = [1, 3, 5].map((At) => parseInt(Entry.Swatch.slice(At, At + 2), 16) / 255);
        const Linear = Swatch.map((Level) => (Level <= 0.04045 ? Level / 12.92 : ((Level + 0.055) / 1.055) ** 2.4));
        if (Entry.Style === "solid" || Entry.Style === "metallic" || Entry.Style === "matte" || Entry.Style === "primer")
            for (let Channel = 0; Channel < 3; Channel += 1)
                assert.ok(
                    Math.abs(Finish.ColourA[Channel] - Linear[Channel]) < 0.02,
                    `${Entry.Identifier} pigment does not match its swatch on channel ${Channel}`,
                );
        // Nothing on the shelf may be a flat mirror or a flat void; both read as a bug rather than as paint.
        assert.ok(Finish.Gloss > 0.05 || Finish.Style === "matte" || Finish.Style === "primer", `${Entry.Identifier} has no gloss`);
    }
    // A clear coat with no peel at all is physically possible but never happens on a panel, so no preset claims it.
    const Coated = Paints.filter((Entry) => Entry.Settings.Coat > 0.5);
    assert.ok(Coated.length >= 10, "almost nothing on the shelf is clear coated");
    assert.ok(Coated.every((Entry) => Entry.Settings.Peel > 0), "a clear coated preset claims to have levelled perfectly");
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
    assert.equal(Hostile.Style, "solid");
    assert.deepEqual(Hostile.ColourA, [0.5, 0.5, 0.5]);
    assert.deepEqual(Hostile.ColourB, [1, 0, 0.5]);
    assert.equal(Hostile.Scale, 4);
    assert.equal(Hostile.Density, 0);
    assert.equal(Hostile.Gloss, 0);
    assert.equal(Hostile.Angle, 180);
    assert.equal(Hostile.Seed, 999);
    assert.equal(FinishLabel(Hostile), "Automotive · Solid · single stage");
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
    assert.deepEqual(Legacy.Sheets, [], "a file with no sheets must read as no paint, never as undefined");
});

//--------------------------------------------------------------------------------------------------------------------------
// The paint itself. A sheet leaves the GPU as premultiplied RGBA8 and has to come back byte for byte, because the
// faintest coverage a brush can lay down is one in two hundred and fifty-five and a lossy round trip would erase it.
//--------------------------------------------------------------------------------------------------------------------------
const PaintedSheet = (Size, Seed = 7) =>
{
    const Pixels = new Uint8Array(Size * Size * 4);
    let State = Seed;
    for (let Row = 0; Row < Size; Row += 1)
    {
        for (let Column = 0; Column < Size; Column += 1)
        {
            State = (State * 1664525 + 1013904223) >>> 0;
            const Fall = Math.hypot(Row - Size * 0.5, Column - Size * 0.45) / (Size * 0.42);
            const Alpha = Math.max(0, Math.min(255, Math.round((1 - Fall) * 255 + ((State >>> 24) % 9) - 4)));
            const At = (Row * Size + Column) * 4;
            // Premultiplied, so every colour byte stays inside the alpha it was laid down with.
            Pixels[At] = Math.round(Alpha * 0.82);
            Pixels[At + 1] = Math.round(Alpha * 0.31);
            Pixels[At + 2] = Math.round(Alpha * 0.17);
            Pixels[At + 3] = Alpha;
        }
    }
    return Pixels;
};

test("a painted sheet survives the PNG round trip byte for byte", async () =>
{
    const Size = 48;
    const Pixels = PaintedSheet(Size);
    const Bytes = await EncodePng(Pixels, Size, Size);
    assert.deepEqual(
        Array.from(Bytes.subarray(0, 8)),
        [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
        "the file must open with the PNG signature",
    );
    assert.equal(String.fromCharCode(...Bytes.subarray(12, 16)), "IHDR");
    assert.equal(String.fromCharCode(...Bytes.subarray(Bytes.length - 8, Bytes.length - 4)), "IEND");

    const Read = await DecodePng(Bytes);
    assert.equal(Read.Width, Size);
    assert.equal(Read.Height, Size);
    assert.deepEqual(Array.from(Read.Pixels), Array.from(Pixels), "the decoder must return exactly what was encoded");

    // 🔴 Every filter the writer may choose has to be understood by the reader, so a sheet is built that forces each one
    //    in turn: a flat row, a horizontal ramp, a vertical ramp and a diagonal.
    const Mixed = new Uint8Array(Size * Size * 4);
    for (let Row = 0; Row < Size; Row += 1)
        for (let Column = 0; Column < Size; Column += 1)
        {
            const At = (Row * Size + Column) * 4;
            Mixed[At] = Row % 4 === 1 ? Column * 5 : 0;
            Mixed[At + 1] = Row % 4 === 2 ? Row * 5 : 0;
            Mixed[At + 2] = Row % 4 === 3 ? (Row + Column) * 2 : 0;
            Mixed[At + 3] = 255;
        }
    const Again = await DecodePng(await EncodePng(Mixed, Size, Size));
    assert.deepEqual(Array.from(Again.Pixels), Array.from(Mixed), "a sheet exercising all four filters must round trip");
});

test("a sheet encodes to text the right way up and decodes back the way the device wants it", async () =>
{
    const Size = 16;
    const Pixels = new Uint8Array(Size * Size * 4);
    // One opaque texel on the bottom row as readPixels returns it, which is the top row of the written image.
    Pixels[3] = 255;
    const Text = await EncodeSheet({ Pixels, Resolution: Size });
    assert.equal(typeof Text, "string");
    assert.ok(/^[A-Za-z0-9+/=]+$/.test(Text), "a sheet must be plain base64 so JSON can hold it");

    const Upright = await DecodePng(BytesFromText(Text));
    assert.equal(Upright.Pixels[3], 0, "the written image must not still be upside down");
    assert.equal(Upright.Pixels[(Size - 1) * Size * 4 + 3], 255, "the marked texel belongs on the written image's last row");

    const Back = await DecodeSheet(Text);
    assert.equal(Back.Resolution, Size);
    assert.equal(Back.Pixels[3], 255, "decoding must hand the device back the orientation it read out");
    assert.ok(Back.Pixels instanceof Uint8Array, "texSubImage2D is given a Uint8Array, not a clamped one");
});

test("blank sheets are passed over, painted ones are collected, and the allowance is honoured", async () =>
{
    const Painted = { Pixels: PaintedSheet(24), Resolution: 24 };
    const Blank = { Pixels: new Uint8Array(24 * 24 * 4), Resolution: 24 };
    assert.equal(BlankSheet(Blank.Pixels), true);
    assert.equal(BlankSheet(Painted.Pixels), false);

    const Layers = [
        { Identifier: "layer-a", Name: "Base" },
        { Identifier: "layer-b", Name: "Scratches" },
        { Identifier: "layer-c", Name: "Untouched" },
    ];
    const Held = new Map([
        ["layer-a:coverage", Painted],
        ["layer-a:mask", Blank],
        ["layer-b:coverage", Painted],
        ["layer-b:mask", Painted],
    ]);
    const Device = {
        SnapshotLayer: (Layer, Target) => Held.get(`${Layer.Identifier}:${Target}`) || null,
        LayerResolution: () => 24,
        RestoreLayer: (Layer, Target, Snapshot) => Restored.push({ Layer: Layer.Identifier, Target, Snapshot }),
    };
    const Restored = [];

    const Said = [];
    const Written = await CollectSheets(Device, Layers, { Report: (Text) => Said.push(Text) });
    assert.equal(Written.Sheets.length, 3, "two coverages and one mask hold paint; the blank mask does not");
    assert.deepEqual(
        Written.Sheets.map((Sheet) => `${Sheet.Layer}:${Sheet.Target}`),
        ["layer-a:coverage", "layer-b:coverage", "layer-b:mask"],
    );
    assert.equal(Written.Skipped, 0);
    assert.ok(Written.Bytes > 0 && Written.Bytes === SheetTally(Written.Sheets).Bytes);
    assert.equal(Said.length, 3, "the saver names every sheet it reads");

    // A budget smaller than the second sheet keeps the first and says how many it left behind.
    const Tight = await CollectSheets(Device, Layers, { Allowance: Written.Sheets[0].Image.length + 1 });
    assert.equal(Tight.Sheets.length, 1);
    assert.equal(Tight.Skipped, 2, "the sheets that would not fit are counted, not dropped in silence");

    // And a device that is not running yields nothing rather than throwing.
    assert.deepEqual(await CollectSheets(null, Layers), { Sheets: [], Bytes: 0, Skipped: 0 });

    const Result = await ApplySheets(Device, Layers, Written.Sheets);
    assert.deepEqual(Result, { Restored: 3, Refused: 0 });
    assert.deepEqual(
        Restored.map((Entry) => `${Entry.Layer}:${Entry.Target}`),
        ["layer-a:coverage", "layer-b:coverage", "layer-b:mask"],
    );
    assert.deepEqual(
        Array.from(Restored[0].Snapshot.Pixels),
        Array.from(Painted.Pixels),
        "what the device is handed back must be what it gave up",
    );

    // Nonsense in the file is refused per sheet, and a sheet naming a layer that is gone is simply not placed.
    const Hostile = [
        { Layer: "layer-a", Target: "coverage", Image: "not base64 at all" },
        { Layer: "layer-z", Target: "coverage", Image: Written.Sheets[0].Image },
        { Layer: "layer-a", Target: "decal", Image: Written.Sheets[0].Image },
    ];
    assert.deepEqual(await ApplySheets(Device, Layers, Hostile), { Restored: 0, Refused: 1 });
});

test("a sheet that lands on a layer of another resolution is resampled onto it", async () =>
{
    const Pixels = PaintedSheet(32);
    const Half = ResampleSheet(Pixels, 32, 16);
    assert.equal(Half.length, 16 * 16 * 4);
    assert.ok(Half[(8 * 16 + 7) * 4 + 3] > 200, "the middle of the mark stays covered when it is halved");
    assert.equal(ResampleSheet(Pixels, 32, 32), Pixels, "a sheet already the right size is passed straight through");

    const Layers = [{ Identifier: "layer-a", Name: "Base" }];
    const Landed = [];
    const Device = {
        SnapshotLayer: () => null,
        LayerResolution: () => 64,
        RestoreLayer: (Layer, Target, Snapshot) => Landed.push(Snapshot),
    };
    const Sheet = { Layer: "layer-a", Target: "coverage", Resolution: 32, Image: await EncodeSheet({ Pixels, Resolution: 32 }) };
    await ApplySheets(Device, Layers, [Sheet]);
    assert.equal(Landed[0].Resolution, 64, "the device is handed the size it asked for, not the size the file held");
    assert.equal(Landed[0].Pixels.length, 64 * 64 * 4);
});

test("a .pigment document carries the paint beside the record", async () =>
{
    const Project = DefaultProject();
    const Image = await EncodeSheet({ Pixels: PaintedSheet(8), Resolution: 8 });
    const Sheets = [{ Layer: "layer-a", Target: "coverage", Resolution: 8, Image }];
    const Written = ComposeDocument(Project, { Distance: 3 }, null, Sheets);
    assert.equal(Written.Version, 3, "a document carrying paint is a version 3 document");
    assert.equal(Written.Sheets.length, 1);

    const Read = ReadDocument(JSON.stringify(Written));
    assert.equal(Read.Sheets.length, 1);
    assert.equal(Read.Sheets[0].Image, Sheets[0].Image, "JSON must hand the sheet back unchanged");
    const Back = await DecodeSheet(Read.Sheets[0].Image);
    assert.deepEqual(Array.from(Back.Pixels), Array.from(PaintedSheet(8)), "a document round trip must not touch a texel");

    assert.deepEqual(ComposeDocument(Project, null).Sheets, [], "a document saved with no paint still names the field");
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

test("symmetry hands back one twin per copy a stroke will paint", () =>
{
    assert.equal(SymmetryTwins("none").length, 0, "no symmetry paints once and once only");
    assert.equal(SymmetryTwins("nonsense").length, 0, "an unknown axis is off rather than a crash");
    assert.equal(SymmetryTwins("x").length, 1);
    assert.deepEqual(SymmetryTwins("x")[0]([2, 3, 4]), [-2, 3, 4]);
    assert.deepEqual(SymmetryTwins("z")[0]([2, 3, 4]), [2, 3, -4]);

    const Six = SymmetryTwins("radial", 6);
    assert.equal(Six.length, 5, "six sectors means the original plus five twins");
    const Turned = Six[2]([1, 0, 0]);
    assert.ok(Math.abs(Math.hypot(Turned[0], Turned[2]) - 1) < 1e-9, "a radial twin keeps its distance from the axis");
    assert.ok(Math.abs(Turned[1]) < 1e-9, "and its height");
    assert.ok(Math.abs(Turned[0] + 1) < 1e-9 && Math.abs(Turned[2]) < 1e-9, "three of six sectors is half a turn");

    assert.equal(SymmetryTwins("radial", 500).length, SectorLimits.Maximum - 1, "an absurd sector count is clamped");
    assert.equal(SymmetryTwins("radial", 1).length, SectorLimits.Minimum - 1, "and so is a useless one");
    assert.equal(SymmetryTwins("radial", 0).length, BrushDefaults.Sectors - 1, "a missing count falls back to the default");
    assert.ok(SymmetryOrdering.some((Entry) => Entry.Identifier === "radial"), "radial is offered in the rail");
});

test("the brush clamps its sector count however it is asked", () =>
{
    const Projection = new StrokeProjection();
    assert.equal(Projection.Brush.Sectors, BrushDefaults.Sectors);
    assert.equal(Projection.Twins.length, 0, "a brush starts without symmetry");
    Projection.Configure({ Symmetry: "radial", Sectors: 12 });
    assert.equal(Projection.Twins.length, 11);
    Projection.Configure({ Sectors: 1 });
    assert.equal(Projection.Brush.Sectors, SectorLimits.Minimum);
    Projection.Configure({ Sectors: 64 });
    assert.equal(Projection.Brush.Sectors, SectorLimits.Maximum);
    Projection.Configure({ Sectors: "rubbish" });
    assert.equal(Projection.Brush.Sectors, BrushDefaults.Sectors, "nonsense falls back to the default");
});

test("an event preview keeps the few numbers it needs and refuses the rest", () =>
{
    assert.equal(SanitisePreview(null), null);
    assert.equal(SanitisePreview("stamp"), null);
    assert.equal(SanitisePreview({ Shape: "fictional" }).Shape, "swatch", "an unknown shape still draws something");

    const Stamp = SanitisePreview({ Shape: "stamp", Coordinate: [0.25, 0.75], Size: [0.2, 0.1], Rotation: 395 });
    assert.equal(Stamp.Shape, "stamp");
    assert.deepEqual(Stamp.Coordinate, [0.25, 0.75]);
    assert.equal(Stamp.Rotation, 35, "rotation is wrapped into a single turn");

    const Long = SanitisePreview({ Shape: "path", Points: Array.from({ length: 400 }, (Ignored, Index) => [Index / 400, 0.5]) });
    assert.equal(Long.Points.length, PreviewLimit, "a long stroke keeps only a sampled handful");

    const Hostile = SanitisePreview({ Shape: "path", Points: ["nope", [Number.NaN, 1e9], [0.5, 0.5]] });
    assert.deepEqual(Hostile.Points, [[0.5, 5], [0.5, 0.5]], "nonsense coordinates are clamped rather than trusted");

    const Event = CreateEvent({ Kind: "stroke", Title: "Added stroke", Preview: { Shape: "flood" } });
    assert.equal(Event.Preview.Shape, "flood", "an event carries its preview");
    assert.equal(CreateEvent({ Kind: "stroke", Title: "No preview" }).Preview, null);
});

test("a layer can keep a sheet size of its own", () =>
{
    assert.equal(CreateLayer("stroke").Resolution, 0, "a new layer follows the document");
    assert.ok(LayerResolutions.includes(0) && LayerResolutions.includes(4096));
    assert.equal(SanitiseLayer({ Kind: "stroke", Resolution: 2048 }).Resolution, 2048);
    assert.equal(SanitiseLayer({ Kind: "stroke", Resolution: 999 }).Resolution, 0, "a size nobody ships is refused");
    assert.equal(SanitiseLayer({ Kind: "stroke", Resolution: "big" }).Resolution, 0);
    const Copy = CloneLayer(CreateLayer("stroke", { Resolution: 512 }));
    assert.equal(Copy.Resolution, 512, "a duplicate paints at the same size");
});

test("an instrument folds down onto the brush without inventing settings", () =>
{
    const Brush = InstrumentByKey["brush-round"];
    const Pushed = BrushFromInstrument(Brush, Brush.Settings);
    assert.equal(Pushed.Radius, 0.09, "size is authored in centimetres and the brush works in metres");
    assert.equal(Pushed.Hardness, 0.4);
    // Opacity and flow fold into one deposit strength, because the stamping pass has only the one.
    assert.ok(Math.abs(Pushed.Flow - 0.92 * 0.8) < 1e-9);
    assert.equal(Pushed.Spacing, 0.1);
    assert.equal(Pushed.Smoothing, 0.38, "smoothing is a brush property now, not a label");
    // Grain used to land on the brush's flat alpha jitter. It belongs to the medium, which reads it as paper tooth.
    assert.equal(Pushed.Jitter, 0, "no instrument reaches for the plain brush's jitter");
    assert.equal(Pushed.Media.Index, 1, "a sable round is a bristle medium");

    const Chalk = InstrumentByKey["dry-chalk"];
    const Dust = BrushFromInstrument(Chalk, Chalk.Settings);
    assert.equal(Dust.Media.Index, 5, "a chalk stick is dry pigment");
    assert.ok(Math.abs(Dust.Media.Grain - 0.78) < 1e-9, "and its tooth reaches the medium");
    assert.ok(Dust.Media.Scatter > 0, "as does its scatter");

    const Pen = InstrumentByKey["pen-fineliner"];
    const Ink = BrushFromInstrument(Pen, { ...Pen.Settings, Grain: 90 });
    assert.equal(Ink.Media.Index, 3);
    assert.ok(Ink.Media.Grain < 0.5, "a grain value on a pen is the nib's own skip, not the painter's");

    const Huge = BrushFromInstrument(Brush, { ...Brush.Settings, Size: 900, Opacity: 0, Flow: 0, Spacing: 0 });
    assert.equal(Huge.Radius, 0.6, "radius is clamped to what the brush accepts");
    assert.equal(Huge.Flow, 0.02, "and so is a flow of nothing");
    assert.equal(Huge.Spacing, 0.05);
});

test("a dependent control is hidden rather than ground out", () =>
{
    const Brush = InstrumentByKey["brush-round"];
    const Keys = (Settings) => VisibleControls(Brush, Settings).map((Control) => Control.Key);
    assert.ok(Keys({ ...Brush.Settings, Pressure: true }).includes("Taper"));
    assert.ok(!Keys({ ...Brush.Settings, Pressure: false }).includes("Taper"), "taper belongs to pressure");

    const Record = InstrumentRecord(Brush, { ...Brush.Settings, Pressure: false });
    assert.equal(Record.Key, "brush-round");
    assert.equal(Record.Settings.Head, "Round", "the record keeps what the brush cannot carry");
    assert.ok(Record.Wired.includes("Size") && Record.Wired.includes("Flow"));
    // Every control reaches the pass now, smoothing included, and the card's footnote reads off this same list.
    assert.ok(Record.Wired.includes("Smoothing"), "nothing is claimed as preview only any more");
    assert.equal(Record.Media.Index, 1, "the record carries the medium the settings resolved to");
    assert.ok(/bristle/.test(Record.Summary), Record.Summary);
    Record.Settings.Size = 99;
    assert.notEqual(Brush.Settings.Size, 99, "the record holds a copy, so a later edit cannot rewrite its past");
});

test("every instrument draws at both scales", () =>
{
    assert.equal(InstrumentFamilies.length, 6);
    for (const Family of InstrumentFamilies)
    {
        for (const Type of Family.Types)
        {
            const Full = InstrumentArtwork(Type);
            const Nib = InstrumentArtwork(Type, Family.Crop);
            for (const Drawing of [Full, Nib])
            {
                assert.ok(Drawing.startsWith("<svg"), `${Type.Key} draws`);
                assert.ok(!/undefined|NaN/.test(Drawing), `${Type.Key} has no holes in its geometry`);
                // 🔴 Gradient identifiers must be namespaced per instrument, or tiles borrow each other's colours.
                for (const Match of Drawing.matchAll(/<linearGradient id="([^"]+)"/g))
                    assert.ok(Match[1].startsWith(Type.Key.replace(/[^a-z0-9]/gi, "")), `${Match[1]} is namespaced`);
            }
            assert.equal(Nib.match(/viewBox="([^"]+)"/)[1], Family.Crop, "the tile is the same drawing, cropped");
        }
    }
});

test("an export preset says which way its normals point", () =>
{
    for (const Preset of ExportOrdering) assert.ok(["opengl", "directx"].includes(Preset.Handedness), Preset.Identifier);
    const Unreal = ExportOrdering.find((Preset) => Preset.Identifier === "unreal");
    assert.equal(Unreal.Handedness, "directx", "Unreal reads green-down normals");
    assert.ok(Unreal.Channels.includes("metallic_roughness"), "and wants the packed ORM");
    const Blender = ExportOrdering.find((Preset) => Preset.Identifier === "blender");
    assert.equal(Blender.Handedness, "opengl");
    assert.ok(Blender.Channels.includes("specular_roughness") && Blender.Channels.includes("base_metalness"));

    const Pixels = new Uint8ClampedArray([10, 20, 30, 40, 200, 100, 50, 255]);
    const Flipped = FlipGreen(Pixels);
    assert.deepEqual([...Flipped], [10, 235, 30, 40, 200, 155, 50, 255], "only the green byte moves");
    assert.equal(Pixels[1], 20, "and the original is left alone");

    assert.deepEqual(ExportSizes.map((Entry) => Entry.Size), [0, 512, 1024, 2048, 4096]);
});

//--------------------------------------------------------------------------------------------------------------------------
// The media model.
//
// These are the numbers ShadingGlsl's MediaChunk is written against. A change that breaks one of them is a change that
// has to be made in the shader too, which is the entire reason they are asserted here rather than left to the eye.
//--------------------------------------------------------------------------------------------------------------------------
test("every instrument resolves to a medium the pass can hold", () =>
{
    const Expected = { brush: 1, pencil: 2, pen: 3, marker: 4, dry: 5, wax: 6 };
    assert.equal(MediumOrdering[0].Identifier, "plain", "medium zero must be the plain dab an unset uniform means");
    for (const Family of InstrumentFamilies)
    {
        for (const Type of Family.Types)
        {
            const Media = MediaFromInstrument(Type, Type.Settings);
            assert.equal(Media.Index, Expected[Family.Key], `${Type.Key} resolved to ${Media.Medium}`);
            for (const [Key, Value] of Object.entries(Media))
                if (typeof Value === "number") assert.ok(Number.isFinite(Value), `${Type.Key}.${Key} is ${Value}`);
            assert.ok(Media.Ratio > 0 && Media.Ratio <= 1, `${Type.Key} has a nonsense nib ratio`);
            assert.ok(Media.Reach > 0, `${Type.Key} runs dry before it starts`);
            assert.ok(Media.Grain >= 0 && Media.Grain <= 1);
            const Packed = MediaUniforms(Media);
            assert.deepEqual(
                [Packed.A.length, Packed.B.length, Packed.C.length, Packed.D.length],
                [4, 4, 4, 4],
                `${Type.Key} does not pack into four vec4s`,
            );
            assert.ok(Packed.A.every(Number.isFinite) && Packed.D.every(Number.isFinite));
        }
    }
});

test("a medium lays its own kind of mark", () =>
{
    const Of = (Key, Patch = {}) =>
    {
        const Type = InstrumentByKey[Key];
        return MediaFromInstrument(Type, { ...Type.Settings, ...Patch });
    };
    const Lay = (Media, Sample = {}) =>
        Deposit(Media, { Across: 0.2, Along: 0.01, Press: 1, Hardness: 0.5, Tooth: 0.5, Fibre: 0.5, Speck: 0, ...Sample }).Alpha;

    // Graphite is the paper's decision, not the pencil's.
    const Pencil = Of("pencil-graphite");
    assert.ok(Lay(Pencil, { Tooth: 0.95 }) > Lay(Pencil, { Tooth: 0.05 }), "tooth made no difference to graphite");
    assert.ok(Lay(Pencil, { Press: 1 }) > Lay(Pencil, { Press: 0.25 }), "pressure made no difference to graphite");
    assert.ok(MediaFromInstrument(InstrumentByKey["pencil-charcoal"], InstrumentByKey["pencil-charcoal"].Settings).Darkness >
        Pencil.Darkness, "a 6B is no blacker than an HB");

    // A dry stick sheds, and sheds further than the mark reaches.
    const Chalk = Of("dry-chalk");
    assert.ok(MediaExtent(Chalk) > 1);
    assert.ok(Lay(Chalk, { Across: 1.15, Speck: 1 }) > 0, "no dust landed outside the stick");
    assert.equal(Lay(Chalk, { Across: 1.15, Speck: 0 }), 0, "pigment landed outside the stick with no speck to carry it");

    // Wax bridges the valleys however hard it is pushed, unless it is melted into them.
    const Crayon = Of("wax-crayon");
    assert.ok(Lay(Crayon, { Tooth: 0.1, Press: 1 }) < Lay(Crayon, { Tooth: 0.9, Press: 1 }) - 0.2, "wax ignored the valleys");
    // Tooth at the top is the medium left entirely to the paper, and wax still bridges even at full pressure.
    assert.ok(Lay(Of("wax-crayon", { Grain: 100 }), { Tooth: 0.1, Press: 1 }) < 0.3, "wax filled a valley it should skip");
    assert.ok(Lay(Of("wax-crayon", { Melt: 100 }), { Tooth: 0.1, Press: 1 }) > Lay(Crayon, { Tooth: 0.1, Press: 1 }));

    // A loaded brush carries further than a dry one and combs the paint less.
    const Dry = Of("brush-round", { Wetness: 0 });
    const Wet = Of("brush-round", { Wetness: 100 });
    assert.ok(Wet.Reach > Dry.Reach);
    const Comb = (Media) =>
    {
        let Low = 1;
        let High = 0;
        for (let Step = -60; Step <= 60; Step += 1)
        {
            const Alpha = Deposit(Media, { Across: Step / 200, Along: 0, Press: 1, Hardness: 0.4, Tooth: 0.5, Fibre: 0.5, Speck: 0 }).Alpha;
            Low = Math.min(Low, Alpha);
            High = Math.max(High, Alpha);
        }
        return High - Low;
    };
    assert.ok(Comb(Dry) > Comb(Wet) + 0.1, `a wet brush combed as hard as a dry one: ${Comb(Wet)} vs ${Comb(Dry)}`);
    assert.ok(
        Deposit(Dry, { Across: 0, Along: Dry.Reach, Press: 1, Hardness: 0.4, Tooth: 0.5, Fibre: 0.5, Speck: 0 }).Alpha <
            Deposit(Dry, { Across: 0, Along: 0, Press: 1, Hardness: 0.4, Tooth: 0.5, Fibre: 0.5, Speck: 0 }).Alpha,
        "the brush never ran dry",
    );

    // A marker pools at its rim; that wet edge is the whole look of the medium.
    const Marker = Of("marker-chisel");
    const Rim = Deposit(Marker, { Across: 0.8, Along: 0, Press: 1, Hardness: 0.72, Tooth: 0.5, Fibre: 0.5, Speck: 0 });
    const Middle = Deposit(Marker, { Across: 0, Along: 0, Press: 1, Hardness: 0.72, Tooth: 0.5, Fibre: 0.5, Speck: 0 });
    assert.ok(Rim.Shade < Middle.Shade, "the wet edge is no darker than the middle");

    // And the plain medium is the soft round dab the pass drew before any of this.
    assert.equal(Deposit(PlainMedia, { Across: 0, Hardness: 0.45 }).Alpha, 1);
    assert.equal(Deposit(PlainMedia, { Across: 1, Hardness: 0.45 }).Alpha, 0);
    assert.equal(Deposit(null, { Across: 0.3 }).Shade, 1, "the plain medium tints nothing");
});

test("a nib is as wide as the direction it is dragged in", () =>
{
    const Italic = MediaFromInstrument(InstrumentByKey["pen-italic"], InstrumentByKey["pen-italic"].Settings);
    assert.ok(Italic.Ratio < 0.3, "a 2mm italic has no waist");
    assert.ok(Math.abs(MediaWidth(Italic, Italic.Angle) - Italic.Ratio) < 1e-9, "dragged along its edge it is not thin");
    assert.ok(Math.abs(MediaWidth(Italic, Italic.Angle + Math.PI / 2) - 1) < 1e-9, "dragged across it is not full width");
    assert.ok(Math.abs(MediaWidth(Italic, Italic.Angle + Math.PI) - Italic.Ratio) < 1e-9, "and the other way along is the same");

    const Round = MediaFromInstrument(InstrumentByKey["brush-round"], InstrumentByKey["brush-round"].Settings);
    assert.equal(MediaWidth(Round, 0.4), 1, "a round head draws one width whichever way it moves");
    assert.equal(MediaWidth(Round, Number.NaN), 1, "and a direction nobody could compute is not a zero-width stroke");
});

test("a frequency scales with the view and a reach scales against it", () =>
{
    const Media = MediaFromInstrument(InstrumentByKey["dry-chalk"], InstrumentByKey["dry-chalk"].Settings);
    const Surface = MediaUniforms(Media, 1);
    const Plane = MediaUniforms(Media, 3);
    assert.ok(Math.abs(Plane.A[1] - Surface.A[1] * 3) < 1e-6, "the paper would be three times too fine in the plane view");
    assert.ok(Math.abs(Plane.D[2] - Surface.D[2] * 3) < 1e-6);
    assert.ok(Math.abs(Plane.D[1] - Surface.D[1] / 3) < 1e-6, "and the head would carry three times as far");
    assert.ok(MediaUniforms(null).Medium === 0, "a missing profile is the plain one, not a crash");
});

test("the tooth is a field, not a shuffle", () =>
{
    // Paper does not move. The same point must answer the same way however many times it is asked, or a second stroke
    // over the first would land in different valleys and the grain would read as noise.
    assert.equal(ToothField(1.25, 3.5), ToothField(1.25, 3.5));
    assert.notEqual(ToothField(1.25, 3.5), ToothField(1.26, 3.5));
    let Low = 1;
    let High = 0;
    let Total = 0;
    const Count = 4000;
    for (let Step = 0; Step < Count; Step += 1)
    {
        const Value = ToothField(Step * 0.37, Step * 0.11);
        Low = Math.min(Low, Value);
        High = Math.max(High, Value);
        Total += Value;
    }
    assert.ok(Low >= 0 && High <= 1, `tooth left its range: ${Low}..${High}`);
    assert.ok(Math.abs(Total / Count - 0.5) < 0.06, `tooth is biased: ${Total / Count}`);
});

test("the editor has one slider, and both panels mount it", () =>
{
    const Row = SliderRow({ Label: "Size", Path: "Brush.Radius", Value: 0.5, Minimum: 0, Maximum: 1, Step: 0.01, Unit: "m" });
    assert.ok(Row.includes("property-row slider-row"), "the theme's own row class");
    assert.ok(Row.includes('type="range"') && Row.includes('data-pill="1"'), "both halves of the control");
    assert.ok(Row.includes("--fraction:0.5000"), "the track paints its own fill");
    assert.ok(Row.includes('data-bind="Brush.Radius"'), "the inspector's binding by default");

    // The card asks for the same row under a different attribute, so the inspector's delegated listener cannot see it.
    const Card = SliderRow({ Label: "Size", Path: "instrument-Size", Value: 9, Minimum: 0.4, Maximum: 60, Step: 0.1, Unit: "cm", Bind: "key", Glyph: "<svg></svg>" });
    assert.ok(Card.includes('data-key="instrument-Size"') && !Card.includes("data-bind"), "the card bound into the inspector");
    assert.ok(Card.includes("<svg></svg>"), "the card's glyph was dropped");
    assert.ok(Card.includes(">cm<"), "the unit cell carries the unit");

    assert.equal(Fraction(5, 0, 10), 0.5);
    assert.equal(Fraction(-5, 0, 10), 0, "a value below the floor is not a negative fill");
    assert.equal(Fixed(1.4, 1), "1", "a whole-number step shows no decimals");
    assert.equal(Fixed(0.456, 0.01), "0.46");
});
