//============================================================================================================================================
// 🔍 ShadingMetrics.mjs — node --test coverage for the device layer, driven through a recording WebGL2 stand-in
//============================================================================================================================================
// There is no GPU in the test runner, so the context is replaced by a stand-in that answers every query the integrator
// makes and records the command stream. That is enough to prove the JavaScript half: programs link against the uniforms
// the shaders really declare, every pass binds a complete set of images, painting survives a resolution change, and the
// resolve path reads back the slots export expects. Shader text itself is validated separately with glslangValidator.
//============================================================================================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import {
    ShadingIntegrator,
    AcquireDevice,
    DescribeDeviceFailure,
    DeviceAttributeSets,
    ProbeAcceleration,
    DeviceReport,
    SoftwareRenderer,
} from "./ShadingIntegrator.js";
import { BuildSurface } from "./SurfaceStructure.js";
import { OrbitProjection } from "./OrbitProjection.js";
import { DefaultStack, DefaultProject, CreateLayer } from "./LayerSpecification.js";
import { ExportSlots, SurfaceFragment, PlaneFragment, CompositeFragment, StampFragment, Chunks } from "./ShadingGlsl.js";
import { DisplayIndex, DisplayOrdering } from "./ChannelSpecification.js";
import { MediaFromInstrument, PlainMedia } from "./MediaSolver.js";
import { InstrumentByKey } from "./InstrumentSpecification.js";

//--------------------------------------------------------------------------------------------------------------------------
// A WebGL2 stand-in. Enumerations are handed out on demand, resources are tagged objects, and the uniform reflection is
// answered from the shader text that was actually uploaded — so a mistyped uniform name fails here exactly as it would on
// a real device.
//--------------------------------------------------------------------------------------------------------------------------
const CreateDevice = () =>
{
    const Enumerations = new Map();
    let NextEnumeration = 0x1000;
    const Calls = [];
    const Sources = new Map();
    const Shaders = new Map();
    let Proxied = null;          // the proxy below answers enumeration reads; the raw object does not
    const Device = {
        Calls,
        Resources: { Textures: 0, Framebuffers: 0, Programs: 0 },
        canvas: { width: 1280, height: 720 },
        drawingBufferWidth: 1280,
        drawingBufferHeight: 720,
        getExtension: (Name) => (Name === "EXT_color_buffer_float" ? {} : null),
        getParameter: (Name) => (Name === Proxied.MAX_DRAW_BUFFERS ? 8 : Name === Proxied.MAX_TEXTURE_SIZE ? 16384 : 1),
        createShader: (Kind) => ({ Kind, Tag: "shader" }),
        shaderSource: (Shader, Source) => Sources.set(Shader, Source),
        compileShader: () => {},
        getShaderParameter: () => true,
        getShaderInfoLog: () => "",
        deleteShader: () => {},
        createProgram: () =>
        {
            Device.Resources.Programs += 1;
            return { Tag: "program", Shaders: [] };
        },
        attachShader: (Program, Shader) =>
        {
            Program.Shaders.push(Shader);
            Shaders.set(Program, Program.Shaders.map((Entry) => Sources.get(Entry) || "").join("\n"));
        },
        linkProgram: (Program) =>
        {
            const Source = Shaders.get(Program) || "";
            Program.Uniforms = [
                ...new Set(
                    [...Source.matchAll(/\buniform\s+(?:highp\s+|mediump\s+|lowp\s+)?\w+\s+([A-Za-z_]\w*)\s*(\[\s*(\d+)\s*\])?/g)].map(
                        (Match) => (Match[2] ? `${Match[1]}[0]` : Match[1]),
                    ),
                ),
            ];
        },
        getProgramParameter: (Program, Name) => (Name === Proxied.ACTIVE_UNIFORMS ? Program.Uniforms.length : true),
        getProgramInfoLog: () => "",
        getActiveUniform: (Program, Index) => ({ name: Program.Uniforms[Index] }),
        getUniformLocation: (Program, Name) =>
            Program.Uniforms.includes(Name) ? { Tag: "location", Name } : null,
        deleteProgram: () => {},
        createTexture: () =>
        {
            Device.Resources.Textures += 1;
            return { Tag: "texture" };
        },
        deleteTexture: () =>
        {
            Device.Resources.Textures -= 1;
        },
        createFramebuffer: () =>
        {
            Device.Resources.Framebuffers += 1;
            return { Tag: "framebuffer" };
        },
        deleteFramebuffer: () =>
        {
            Device.Resources.Framebuffers -= 1;
        },
        checkFramebufferStatus: () => Proxied.FRAMEBUFFER_COMPLETE,
        createVertexArray: () => ({ Tag: "array" }),
        deleteVertexArray: () => {},
        createBuffer: () => ({ Tag: "buffer" }),
        deleteBuffer: () => {},
        readPixels: (X, Y, Width, Height, Format, Kind, Target) =>
        {
            if (Target?.fill) Target.fill(128);
        },
        isContextLost: () => false,
    };

    // Everything else — state setters, draws, uploads — is recorded. Unknown enumerations mint themselves.
    Proxied = new Proxy(Device, {
        get(Target, Property)
        {
            if (Property in Target) return Target[Property];
            if (typeof Property !== "string") return undefined;
            if (/^[A-Z][A-Z0-9_]*$/.test(Property))
            {
                if (!Enumerations.has(Property)) Enumerations.set(Property, (NextEnumeration += 1));
                return Enumerations.get(Property);
            }
            return (...Arguments) =>
            {
                Calls.push({ Name: Property, Arguments });
                return undefined;
            };
        },
    });
    return Proxied;
};

const CreateCanvas = () =>
{
    const Device = CreateDevice();
    return {
        Device,
        width: 1280,
        height: 720,
        style: {},
        getContext: () => Device,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    };
};

const Count = (Device, Name) => Device.Calls.filter((Call) => Call.Name === Name).length;

const Prepare = (Resolution = 256) =>
{
    const Canvas = CreateCanvas();
    const Integrator = new ShadingIntegrator(Canvas);
    assert.equal(Integrator.Failure, "", `the integrator refused the device: ${Integrator.Failure}`);
    Integrator.Configure(Resolution);
    Integrator.SetSurface(BuildSurface("sphere", 0));
    return { Integrator, Device: Canvas.Device, Canvas };
};

test("the integrator links every program and reflects its uniforms", () =>
{
    const { Integrator } = Prepare();
    const Names = Object.keys(Integrator.Programs);
    assert.deepEqual(
        Names.sort(),
        ["Background", "Bake", "Composite", "Curvature", "Dilate", "Mask", "Plane", "Resolve", "Settle", "Shade", "Stamp"].sort(),
    );
    for (const [Name, Program] of Object.entries(Integrator.Programs))
    {
        // The bake pass is driven entirely by attributes, so it is the one program without uniforms.
        if (Name !== "Bake") assert.ok(Program.Uniforms.size > 0, `${Name} reflected no uniforms`);
        for (const Location of Program.Uniforms.values()) assert.ok(Location, `${Name} has a null uniform location`);
    }
    assert.ok(Integrator.Programs.Composite.Uniforms.has("uEnabled"), "an array uniform lost its [0] suffix");
    assert.ok(Integrator.Ready);
});

test("a missing float render target is refused instead of rendering wrongly", () =>
{
    const Canvas = CreateCanvas();
    Canvas.Device.getExtension = () => null;
    const Integrator = new ShadingIntegrator(Canvas);
    assert.equal(Integrator.Ready, false);
    assert.match(Integrator.Failure, /float/i);
});

test("uploading a surface builds the attribute arrays and bakes once", () =>
{
    const { Integrator, Device } = Prepare();
    const Surface = Integrator.Surface;
    assert.equal(Count(Device, "vertexAttribPointer"), 5 + 1, "one quad attribute plus five surface attributes");
    assert.equal(Integrator.Statistics.Triangles, Surface.Triangles);
    const Draws = Device.Calls.filter((Call) => Call.Name === "drawElements");
    assert.ok(Draws.length >= 1, "the surface was never drawn into the bake");
    assert.equal(Draws[0].Arguments[1], Surface.Indices.length);
    // Four dilation passes plus the curvature pass follow the bake.
    assert.ok(Count(Device, "drawArrays") >= 5, "the dilation and curvature passes did not run");
});

test("compositing walks the visible layers and seeds the lower set", () =>
{
    const { Integrator, Device } = Prepare();
    const Project = DefaultProject();
    const Layers = DefaultStack();
    for (const Layer of Layers) if (Layer.Kind === "stroke") Integrator.EnsureCoverage(Layer);
    const Before = Count(Device, "drawArrays");
    Integrator.Composite(Layers, Project.Material);
    const Visible = Layers.filter((Layer) => Layer.Visible && Layer.Opacity > 0.0005).length;
    assert.equal(Count(Device, "drawArrays") - Before, Visible, "one full-screen pass per visible layer");
    assert.equal(Integrator.Statistics.Layers, Visible);
    assert.equal(Integrator.Statistics.Composites, 1);
    assert.ok(Integrator.ChannelImages.length === 4, "the channel set must expose four images");

    const Hidden = Layers.map((Layer) => ({ ...Layer, Visible: false }));
    const Marker = Count(Device, "drawArrays");
    Integrator.Composite(Hidden, Project.Material);
    assert.equal(Count(Device, "drawArrays"), Marker, "hidden layers were still drawn");
    assert.ok(Count(Device, "clearBufferfv") > 0, "the lower set was never seeded with channel defaults");
});

test("painting a stroke layer stamps, and erasing uses a destructive blend", () =>
{
    const { Integrator, Device } = Prepare();
    const Layer = CreateLayer("stroke");
    Integrator.EnsureCoverage(Layer);
    const Options = {
        Target: "coverage",
        Start: [0, 0, 0.8],
        End: [0.1, 0, 0.8],
        Normal: [0, 0, 1],
        Colour: [1, 0.5, 0.25],
        Radius: 0.1,
        Hardness: 0.5,
        Flow: 0.9,
        FacingLimit: 0.2,
        Jitter: 0,
    };
    Integrator.Stamp(Layer, Options);
    assert.equal(Integrator.Statistics.Stamps, 1);
    const Blends = Device.Calls.filter((Call) => Call.Name === "blendFuncSeparate");
    assert.ok(Blends.length > 0, "the stamp never configured blending");
    const Painted = Blends.at(-1).Arguments;
    Integrator.Stamp(Layer, { ...Options, Erase: true });
    const Erased = Device.Calls.filter((Call) => Call.Name === "blendFuncSeparate").at(-1).Arguments;
    assert.notDeepEqual(Erased, Painted, "erasing used the same blend as painting");
    assert.equal(Integrator.Statistics.Stamps, 2);

    // Painting into a mask must allocate the mask image rather than the coverage image.
    const Masked = CreateLayer("fill");
    Masked.Mask.Kind = "stroke";
    Integrator.EnsureMask(Masked);
    Integrator.Stamp(Masked, { ...Options, Target: "mask" });
    const Record = Integrator.LayerImages.get(Masked.Identifier);
    assert.ok(Record.Mask, "the mask image was not created");
    assert.equal(Record.Coverage, undefined, "a mask stroke allocated a coverage image");
});

test("the stamping pass is told which medium it is painting with", () =>
{
    const { Integrator, Device } = Prepare();
    const Layer = CreateLayer("stroke");
    Integrator.EnsureCoverage(Layer);
    const Charcoal = InstrumentByKey["dry-charcoal"];
    const Media = MediaFromInstrument(Charcoal, Charcoal.Settings);
    const Options = {
        Target: "coverage",
        Start: [0, 0, 0.8],
        End: [0.1, 0, 0.8],
        Normal: [0, 0, 1],
        Colour: [1, 1, 1],
        Radius: 0.06,
        Hardness: 0.2,
        Flow: 0.8,
        Media,
        Press: [0.3, 0.9],
        Travel: [0.2, 0.34],
    };
    Integrator.Stamp(Layer, Options);

    const Sent = (Name) => Device.Calls.filter((Call) => Call.Arguments?.[0]?.Name === Name).at(-1)?.Arguments;
    assert.equal(Sent("uMedium")[1], 5, "dry pigment did not reach the pass");
    assert.deepEqual([...Sent("uMediaA")[1]].slice(0, 1), [Media.Grain], "the tooth strength is the first of the A pack");
    assert.ok(Sent("uMediaA")[1][1] > 0, "a tooth frequency of zero is a flat mark");
    assert.equal(Sent("uMediaB")[1].length, 4);
    assert.equal(Sent("uMediaC")[1].length, 4);
    assert.equal(Sent("uMediaD")[1].length, 4);
    assert.deepEqual([...Sent("uStrokePress")[1]], [0.3, 0.9, 0.2, 0.34], "pressure and travel are one vec4");

    // 🔴 The eraser lifts with the plain medium however exotic the instrument in hand is.
    Integrator.Stamp(Layer, { ...Options, Erase: true });
    assert.equal(Sent("uMedium")[1], 0, "erasing kept the charcoal");

    // With no medium at all the pass is handed the plain profile rather than a hole.
    Integrator.Stamp(Layer, { ...Options, Media: null });
    assert.equal(Sent("uMedium")[1], PlainMedia.Index);
    assert.deepEqual([...Sent("uStrokePress")[1]], [0.3, 0.9, 0.2, 0.34]);

    // The flattened view measures in UV, so the paper's frequency is scaled by what a UV unit is worth.
    Integrator.Stamp(Layer, { ...Options, Mode: "plane", StartPlane: [0.2, 0.2], EndPlane: [0.6, 0.3], PlaneRadius: 0.05, Span: 4 });
    assert.ok(Math.abs(Sent("uMediaA")[1][1] - Media.Tooth * 4) < 1e-3, "the plane's paper is the surface's paper");
    assert.ok(Math.abs(Sent("uMediaD")[1][1] - Media.Reach / 4) < 1e-6, "and a reach shrinks by the same number");
});

test("texture-space painting takes the plane path without touching the bake", () =>
{
    const { Integrator } = Prepare();
    const Layer = CreateLayer("stroke");
    Integrator.EnsureCoverage(Layer);
    Integrator.Stamp(Layer, {
        Target: "coverage",
        Mode: "plane",
        Start: [0, 0, 0],
        End: [0, 0, 0],
        Normal: [0, 1, 0],
        StartPlane: [0.3, 0.3],
        EndPlane: [0.7, 0.62],
        PlaneRadius: 0.08,
        Colour: [1, 1, 1],
        Radius: 0.1,
        Hardness: 0.4,
        Flow: 1,
    });
    assert.equal(Integrator.Statistics.Stamps, 1);
});

test("a snapshot round trip restores the image it was taken from", () =>
{
    const { Integrator, Device } = Prepare(128);
    const Layer = CreateLayer("stroke");
    Integrator.EnsureCoverage(Layer);
    const Snapshot = Integrator.SnapshotLayer(Layer, "coverage");
    assert.equal(Snapshot.Resolution, 128);
    assert.equal(Snapshot.Pixels.length, 128 * 128 * 4);
    const Before = Count(Device, "texSubImage2D");
    Integrator.RestoreLayer(Layer, "coverage", Snapshot);
    assert.equal(Count(Device, "texSubImage2D") - Before, 1, "restoring did not upload the snapshot");
    assert.equal(Integrator.SnapshotLayer(CreateLayer("fill"), "coverage"), null, "a layer with no image produced a snapshot");
});

test("changing resolution rescales the painted images instead of dropping them", () =>
{
    const { Integrator, Device } = Prepare(256);
    const Layer = CreateLayer("stroke");
    Integrator.EnsureCoverage(Layer);
    const Original = Integrator.LayerImages.get(Layer.Identifier).Coverage;
    const Before = Count(Device, "blitFramebuffer");
    Integrator.Configure(512);
    assert.equal(Integrator.Resolution, 512);
    const Rescaled = Integrator.LayerImages.get(Layer.Identifier).Coverage;
    assert.ok(Rescaled, "the painted image was dropped");
    assert.notEqual(Rescaled, Original, "the image was not reallocated at the new resolution");
    assert.ok(Count(Device, "blitFramebuffer") > Before, "nothing was blitted into the new image");
});

test("releasing a layer frees its images and only its images", () =>
{
    const { Integrator } = Prepare();
    const First = CreateLayer("stroke");
    const Second = CreateLayer("stroke");
    Integrator.EnsureCoverage(First);
    Integrator.EnsureCoverage(Second);
    assert.equal(Integrator.LayerImages.size, 2);
    Integrator.ReleaseLayer(First.Identifier);
    assert.equal(Integrator.LayerImages.size, 1);
    assert.ok(Integrator.LayerImages.has(Second.Identifier));
});

test("dropping a mask frees the mask image and leaves the coverage alone", () =>
{
    const { Integrator } = Prepare();
    const Layer = CreateLayer("stroke");
    Integrator.EnsureCoverage(Layer);
    Integrator.EnsureMask(Layer);
    const Record = Integrator.LayerImages.get(Layer.Identifier);
    assert.ok(Record.Mask && Record.MaskTarget, "the mask image was not created");
    Integrator.ReleaseMask(Layer.Identifier);
    assert.equal(Record.Mask, null, "the mask image survived the release");
    assert.equal(Record.MaskTarget, null, "the mask target survived the release");
    assert.ok(Record.Coverage, "releasing the mask took the coverage with it");
    assert.ok(Integrator.LayerImages.has(Layer.Identifier), "the layer record itself was dropped");
    Integrator.EnsureMask(Layer);
    assert.ok(Integrator.LayerImages.get(Layer.Identifier).Mask, "a replacement mask could not be made");
});

test("a layer with no mask of its own inspects as fully revealed", () =>
{
    const { Integrator } = Prepare();
    const Layer = CreateLayer("stroke");
    assert.equal(Integrator.MaskImage(Layer.Identifier), Integrator.WhiteImage(), "a missing mask should read white");
    Integrator.EnsureMask(Layer);
    assert.equal(
        Integrator.MaskImage(Layer.Identifier),
        Integrator.LayerImages.get(Layer.Identifier).Mask,
        "the layer's own mask should be the one inspected",
    );
});

test("the mask inspection is wired to the display mode the shaders switch on", () =>
{
    assert.equal(DisplayIndex("mask"), 14, "the mask view moved away from the GLSL branch that draws it");
    for (const Source of [SurfaceFragment, PlaneFragment])
    {
        assert.match(Source, /uniform sampler2D uMaskPreview;/, "a fragment stage cannot reach the mask image");
        assert.match(Source, /Mode == 14/, "a fragment stage has no branch for the mask view");
    }
    // The pink wash is gone: there is no tint uniform, no branch that reads one, and no display that selects it.
    assert.ok(!DisplayOrdering.some((Entry) => Entry.Identifier === "mask_overlay"), "the overlay is still on offer");
    for (const Source of [SurfaceFragment, PlaneFragment]) assert.doesNotMatch(Source, /uMaskTint/, "a stage still tints a wash");
    assert.match(SurfaceFragment, /if \(uDisplay > 0\.5\)/, "the inspection short-circuit still carries the overlay's escape clause");
    assert.doesNotMatch(PlaneFragment, /Mode == 15/, "texture space still has an overlay branch");
});

test("generator and colour masks resolve through a pass of their own", () =>
{
    const { Integrator, Device } = Prepare();
    const Layer = CreateLayer("fill", { Mask: { Kind: "colour", Colour: [0.2, 0.4, 0.6], Tolerance: 0.3, Softness: 0.1 } });
    assert.equal(Integrator.MaskImage(Layer.Identifier), Integrator.WhiteImage(), "an unresolved colour mask should read white");
    const Before = Count(Device, "drawArrays");
    Integrator.RefreshMaskPreview(Layer, DefaultProject().Material);
    assert.equal(Count(Device, "drawArrays") - Before, 1, "the mask preview pass never drew");
    assert.equal(Integrator.MaskPreviewLayer, Layer.Identifier);
    assert.equal(
        Integrator.MaskImage(Layer.Identifier),
        Integrator.MaskPreviewTarget.Images[0],
        "the resolved mask should be the one inspected",
    );
    // A layer carrying no mask leaves the preview alone rather than drawing an empty pass.
    const Marker = Count(Device, "drawArrays");
    Integrator.RefreshMaskPreview(CreateLayer("fill"), DefaultProject().Material);
    assert.equal(Count(Device, "drawArrays"), Marker, "a layer with no mask still ran the preview pass");
    assert.equal(Integrator.MaskPreviewLayer, "");
});

test("the compositor can write a finish without touching the flat channel values", () =>
{
    assert.match(CompositeFragment, /uniform int uFinishFamily;/, "the finish family never reaches the shader");
    assert.match(CompositeFragment, /uKind == 4/, "there is no finish branch in the compositor");
    assert.match(CompositeFragment, /FinishSample Finish = SampleFinish\(/, "the finish is never evaluated");
    for (const Name of ["RoughnessValue", "MetalnessValue", "CoatValue", "FuzzValue", "HeightValue"])
        assert.ok(CompositeFragment.includes(Name), `${Name} is not routed through the blend`);
    assert.match(Chunks.Finish, /float FlakeField\(/, "the flake field went missing");
    assert.match(Chunks.Finish, /float WeaveField\(/, "the weave field went missing");

    // The automotive branch is switched on by number in the GLSL and by identifier in the specification. If the two
    // ever drift, a candy preset silently renders as a primer.
    for (const [Index, Identifier] of [
        [1, "metallic"],
        [2, "pearl"],
        [3, "candy"],
        [4, "matte"],
        [5, "chameleon"],
        [6, "primer"],
    ])
    {
        assert.ok(
            new RegExp(`Style == ${Index}\\)[\\s\\S]{0,900}?${Identifier}`, "i").test(Chunks.Finish),
            `the automotive branch for style ${Index} does not read as ${Identifier}`,
        );
    }
    assert.match(Chunks.Finish, /float PeelAmount = clamp\(Extra\.x/, "orange peel never reaches the finish shader");
    assert.match(CompositeFragment, /uniform vec4 uFinishExtra;/, "the extra finish uniform is not declared");
    assert.match(Chunks.Mask, /Kind == 3/, "the mask chunk has no colour branch");
});

test("the viewport and texture-space passes both draw", () =>
{
    const { Integrator, Device } = Prepare();
    const Project = DefaultProject();
    const Camera = new OrbitProjection();
    Camera.Advance(0.016);
    const Options = {
        Environment: Project.Environment,
        Material: Project.Material,
        Display: DisplayIndex("material"),
        CheckerScale: 16,
        Cursor: { Position: [0, 0, 1], Normal: [0, 0, 1], Radius: 0.1, Hardness: 0.5 },
    };
    const Before = { Arrays: Count(Device, "drawArrays"), Elements: Count(Device, "drawElements") };
    Integrator.RenderViewport(Camera, Options);
    assert.ok(Count(Device, "drawArrays") > Before.Arrays, "the background never drew");
    assert.ok(Count(Device, "drawElements") > Before.Elements, "the surface never drew");
    const Marker = Count(Device, "drawArrays");
    Integrator.RenderPlane({ ...Options, Pan: [0, 0], Zoom: 1, Cursor: [0.5, 0.5, 0.1] });
    assert.ok(Count(Device, "drawArrays") > Marker, "texture space never drew");
});

test("the sky reaches the device as a texture, a sun and nine coefficients", () =>
{
    const { Integrator, Device } = Prepare();
    const Project = DefaultProject();
    const Camera = new OrbitProjection();
    Camera.Advance(0.016);
    const Options = { Environment: Project.Environment, Material: Project.Material, Display: DisplayIndex("material"), CheckerScale: 16 };
    const Sent = (Name) => Device.Calls.filter((Call) => Call.Arguments?.[0]?.Name === Name).at(-1)?.Arguments;
    // The sky is the only texture here with a chain of its own, so a level above zero can only have come from it.
    const Levels = () => Device.Calls.filter((Call) => Call.Name === "texImage2D" && Call.Arguments[1] > 0).length + 1;

    Integrator.RenderViewport(Camera, Options);
    const Built = Levels();
    assert.ok(Built >= 7, `the sky uploaded ${Built} levels`);
    assert.equal(Sent("uSkyLevels")[1], 7, "the shader was not told how many levels it has");
    assert.ok(Sent("uSkyScale")[1] > 0, "the decode scale never arrived");
    assert.equal(Sent("uHarmonics[0]")?.[1].length, 27, "nine coefficients are nine times three floats");
    assert.equal(Sent("uSunOn")[1], 0, "a studio has its sun off");

    // 🔴 The same sky twice is one sky. A rebuild on every frame would be a tenth of a second of arithmetic between
    //    the painter's hand and the screen, so the record has to survive a render that changed nothing.
    Integrator.RenderViewport(Camera, Options);
    assert.equal(Levels(), Built, "the sky was generated again for an identical frame");

    // Moving the sun is a different sky: the glow, the horizon flush and the irradiance all move with it.
    const Lit = { ...Options, Environment: { ...Project.Environment, Sun: { ...Project.Environment.Sun, On: true, Swing: 120 } } };
    Integrator.RenderViewport(Camera, Lit);
    assert.ok(Levels() > Built, "switching the sun on did not rebuild the sky");
    assert.equal(Sent("uSunOn")[1], 1);
    assert.ok([...Sent("uSunRadiance")[1]].some((Part) => Part > 0.1), "a sun that is on throws no light");
    assert.ok([...Sent("uSunDisc")[1]].some((Part) => Part > 0.1), "the sun has no disc to draw");
    assert.ok(Sent("uSunCosine")[1] > 0.99 && Sent("uSunCosine")[1] <= 1, `a two degree sun has cosine ${Sent("uSunCosine")[1]}`);
    const Direction = [...Sent("uSunDirection")[1]];
    assert.ok(Math.abs(Math.hypot(...Direction) - 1) < 1e-5, `the sun points ${Math.hypot(...Direction)} long`);

    // 🔴 The sky is uploaded onto its own unit. Everything the viewport pass bound before it has to still be there
    //    afterwards, or a frame that rebuilt the sky reads the sky where it wanted the mask.
    const Units = Device.Calls.filter((Call) => Call.Name === "activeTexture").map((Call) => Call.Arguments[0]);
    const Sky = Device.Calls.findLastIndex((Call) => Call.Name === "texImage2D" && Call.Arguments[1] > 0);
    const Active = Device.Calls.slice(0, Sky).filter((Call) => Call.Name === "activeTexture").at(-1);
    assert.ok(Units.length > 0 && Active, "nothing ever chose a texture unit");
    assert.equal(Active.Arguments[0], Device.TEXTURE0 + 6, "the sky was uploaded onto somebody else's unit");

    // 🔴 Rotation is a lookup offset and nothing else: dragging it must not touch the texture, or every degree of a
    //    rotation drag would cost a full sky.
    const Marker = Levels();
    Integrator.RenderViewport(Camera, { ...Lit, Environment: { ...Lit.Environment, Rotation: 211 } });
    assert.equal(Levels(), Marker, "turning the sky rebuilt it");
    assert.ok(Math.abs(Sent("uSkyTurn")[1] - (211 * Math.PI) / 180) < 1e-5, "the turn never reached the shader");
});

test("every export slot resolves to an image of the project resolution", () =>
{
    const { Integrator } = Prepare(128);
    const Project = DefaultProject();
    for (const Slot of ExportSlots)
    {
        const Resolved = Integrator.ResolveSlot(Slot.Slot, Project.Material);
        assert.ok(Resolved, `slot ${Slot.Identifier} resolved to nothing`);
        assert.equal(Resolved.Width, 128);
        assert.equal(Resolved.Height, 128);
        assert.equal(Resolved.Pixels.length, 128 * 128 * 4);
    }
});

test("picking a texel reports every channel the inspector shows", () =>
{
    const { Integrator } = Prepare(64);
    const Sample = Integrator.PickTexel([0.5, 0.5]);
    for (const Key of ["BaseColour", "Opacity", "Roughness", "Metalness", "Occlusion", "Height"])
        assert.ok(Key in Sample, `the pick is missing ${Key}`);
    assert.equal(Sample.BaseColour.length, 3);
    for (const Component of Sample.BaseColour) assert.ok(Component >= 0 && Component <= 1);
    const Outside = Integrator.PickTexel([-4, 9]);
    for (const Value of Object.values(Outside).flat()) assert.ok(Number.isFinite(Value), "an out-of-island pick read garbage");
});

test("resizing only reconfigures the canvas when the pixel size changes", () =>
{
    const { Integrator } = Prepare();
    assert.equal(Integrator.Resize(800, 600, 1), true);
    assert.equal(Integrator.Resize(800, 600, 1), false, "an identical resize was not ignored");
    assert.equal(Integrator.Resize(800, 600, 2), true, "a ratio change was ignored");
});

//--------------------------------------------------------------------------------------------------------------------------
// Context acquisition. A browser that refuses a context does so silently, so these cover the retry ladder and the story
// the panel tells a person when every rung fails.
//--------------------------------------------------------------------------------------------------------------------------
const CreateReluctantCanvas = (Refusals, Message = "") =>
{
    const Listeners = [];
    const Canvas = {
        Attempts: [],
        Device: CreateDevice(),
        width: 1280,
        height: 720,
        style: {},
        addEventListener: (Kind, Listener) => Kind === "webglcontextcreationerror" && Listeners.push(Listener),
        removeEventListener: (Kind, Listener) => Listeners.splice(Listeners.indexOf(Listener) >>> 0, 1),
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
        getContext: (Kind, Attributes) =>
        {
            Canvas.Attempts.push(Attributes);
            if (Canvas.Attempts.length <= Refusals)
            {
                for (const Listener of Listeners) Listener({ statusMessage: Message, preventDefault: () => {} });
                return null;
            }
            return Canvas.Device;
        },
    };
    return Canvas;
};

test("a refused context is asked for again with humbler attributes", () =>
{
    const Canvas = CreateReluctantCanvas(2);
    const { Device, Notes } = AcquireDevice(Canvas);
    assert.ok(Device, "the third attempt should have been granted");
    assert.equal(Canvas.Attempts.length, 3);
    assert.equal(Canvas.Attempts[0].powerPreference, "high-performance");
    assert.equal(Canvas.Attempts[1].powerPreference, undefined, "the discrete GPU request should be dropped first");
    assert.equal(Notes.length, 0, "a silent refusal should not invent a note");
});

test("whatever the browser says about a refusal is kept, once", () =>
{
    const Canvas = CreateReluctantCanvas(99, "Could not create a WebGL2 context. GPU process isn't usable.");
    const { Device, Notes } = AcquireDevice(Canvas);
    assert.equal(Device, null);
    assert.equal(Canvas.Attempts.length, DeviceAttributeSets.length, "every attribute set should have been tried");
    assert.deepEqual(Notes, ["Could not create a WebGL2 context. GPU process isn't usable."]);
});

test("a device that never arrives produces a readable failure with steps to take", () =>
{
    const Integrator = new ShadingIntegrator(CreateReluctantCanvas(99, "GPU process isn't usable."));
    assert.equal(Integrator.Ready, false);
    assert.match(Integrator.Failure, /WebGL/i);
    assert.ok(Integrator.Advice.length >= 2, "a failure with no advice is just a shrug");
    assert.ok(Integrator.Notes.includes("GPU process isn't usable."));
});

test("the diagnosis names the context ceiling when that is what the browser hit", () =>
{
    const Diagnosis = DescribeDeviceFailure(["Too many active WebGL contexts. Oldest context will be lost."]);
    assert.match(Diagnosis.Message, /run out of WebGL contexts/i);
    assert.ok(Diagnosis.Advice.some((Entry) => /close other tabs/i.test(Entry)));
});

test("half-float rendering on its own is enough to start", () =>
{
    const Canvas = CreateCanvas();
    Canvas.Device.getExtension = (Name) => (Name === "EXT_color_buffer_half_float" ? {} : null);
    const Integrator = new ShadingIntegrator(Canvas);
    assert.equal(Integrator.Failure, "", "half-float rendering should satisfy the bake targets");
    assert.ok(Integrator.Ready);
});

test("a context with no float rendering at all refuses with advice rather than a blank viewport", () =>
{
    const Canvas = CreateCanvas();
    Canvas.Device.getExtension = () => null;
    const Integrator = new ShadingIntegrator(Canvas);
    assert.equal(Integrator.Ready, false);
    assert.match(Integrator.Failure, /floating-point/i);
    assert.ok(Integrator.Advice.length >= 1);
});

test("a browser with GPU access switched off is told so, not blamed for its driver", () =>
{
    const Spoken =
        "Could not create a WebGL context, VENDOR = 0xffff, DEVICE = 0xffff, GL_VENDOR = Disabled, GL_RENDERER = Disabled, " +
        "Sandboxed = yes, Optimus = no, AMD switchable = no, Reset notification strategy = 0x0000, " +
        "ErrorMessage = BindToCurrentSequence failed: .";
    const Diagnosis = DescribeDeviceFailure([Spoken]);
    assert.match(Diagnosis.Message, /switched off for every page/i);
    assert.ok(Diagnosis.Advice.some((Entry) => /graphics acceleration/i.test(Entry)), "the settings switch is the first fix");
    assert.ok(Diagnosis.Advice.some((Entry) => /chrome:\/\/policy/i.test(Entry)), "a managed browser needs the policy page");
    assert.ok(Diagnosis.Advice.some((Entry) => /ignore-gpu-blocklist/i.test(Entry)), "a blocklisted driver needs the flag");
    assert.ok(Diagnosis.Advice.some((Entry) => /swiftshader/i.test(Entry)), "software rendering is the last resort");
    assert.deepEqual(Diagnosis.Detail, [Spoken], "the browser's own words are kept");
});

test("the switched-off diagnosis wins over the WebGL 1 reading", () =>
{
    const Diagnosis = DescribeDeviceFailure(["ErrorMessage = BindToCurrentSequence failed: ."]);
    assert.match(Diagnosis.Message, /switched off/i);
    assert.ok(!/WebGL 1/.test(Diagnosis.Message));
});

test("the acceleration probe answers even where neither graphics API exists", async () =>
{
    const Probe = await ProbeAcceleration();
    assert.equal(Probe.Legacy, false, "there is no canvas in the test runner");
    assert.equal(Probe.Modern, false);
    assert.equal(typeof Probe.Agent, "string");
});

test("the renderer report carries everything worth pasting into a bug report", () =>
{
    const Text = DeviceReport("No context.", ["GL_VENDOR = Disabled"], {
        Agent: "Mozilla/5.0 Chrome/999",
        Ratio: 1.5,
        Legacy: false,
        Modern: true,
        Adapter: "nvidia ada",
        Address: "https://example.test/index.html",
        Framed: true,
    });
    assert.match(Text, /Failure   : No context\./);
    assert.match(Text, /Chrome\/999/);
    assert.match(Text, /WebGPU    : adapter available — nvidia ada/);
    assert.match(Text, /GL_VENDOR = Disabled/);
    assert.match(Text, /Attempts  : 5 attribute sets/);
    assert.match(Text, /Address   : https:\/\/example\.test\/index\.html/, "the report should say which copy was loaded");
    assert.match(Text, /Framed    : yes, inside an iframe/, "a framed page is worth knowing about");
});

test("a processor-backed renderer is recognised by every name browsers give it", () =>
{
    for (const Name of [
        "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwANGLE driver)",
        "llvmpipe (LLVM 15.0.6, 256 bits)",
        "Microsoft Basic Render Driver",
        "Apple Paravirtual device",
    ])
        assert.equal(SoftwareRenderer(Name), true, `${Name} should read as software`);
    for (const Name of ["ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0)", "Mali-G78", "", null])
        assert.equal(SoftwareRenderer(Name), false, `${Name} should read as hardware`);
});

test("the integrator reports which kind of renderer it got", () =>
{
    const Canvas = CreateCanvas();
    Canvas.Device.getParameter = (Name) => (Name === Canvas.Device.MAX_DRAW_BUFFERS ? 8 : "SwiftShader Device (Subzero)");
    const Integrator = new ShadingIntegrator(Canvas);
    assert.equal(Integrator.Ready, true, Integrator.Failure);
    assert.equal(Integrator.Software, true);
    assert.match(Integrator.Renderer, /SwiftShader/);
});

//--------------------------------------------------------------------------------------------------------------------------
// Per-stroke channel values. The thing being guarded is that two strokes on one layer can disagree about roughness or
// metalness and both keep what they were given, while a layer that never disagrees pays nothing for the privilege.
//--------------------------------------------------------------------------------------------------------------------------
const StrokeOptions = (Overrides = {}) => ({
    Target: "coverage",
    Start: [0, 0, 0.8],
    End: [0.1, 0, 0.8],
    Normal: [0, 0, 1],
    Colour: [1, 0.5, 0.25],
    Radius: 0.1,
    Hardness: 0.5,
    Flow: 0.9,
    FacingLimit: 0.2,
    Jitter: 0,
    ...Overrides,
});

const Uploaded = (Device, Name) =>
    Device.Calls.filter((Call) => Call.Name === "uniform4fv" && Call.Arguments[0]?.Name === Name).map((Call) => [...Call.Arguments[1]]);

test("a layer painted with one set of channel values never grows images for them", () =>
{
    const { Integrator, Device } = Prepare(128);
    const Layer = CreateLayer("stroke");
    Layer.Channels.base_metalness = 1;
    Layer.Channels.specular_roughness = 0;
    Integrator.Stamp(Layer, StrokeOptions());
    const Settled = Device.Resources.Textures;
    Integrator.Stamp(Layer, StrokeOptions({ Start: [0.2, 0, 0.8], End: [0.3, 0, 0.8] }));
    assert.equal(Integrator.PaintedLayer(Layer), false, "the layer grew channel images it did not need");
    assert.equal(Device.Resources.Textures, Settled, "a second agreeing stroke allocated something");

    // The values are remembered against the paint, not read back off the inspector.
    const Record = Integrator.LayerImages.get(Layer.Identifier);
    assert.ok(Record.Uniform, "the layer forgot what it was painted with");
    assert.equal(Record.Uniform[0], 0, "roughness was not recorded");
    assert.equal(Record.Uniform[1], 1, "metalness was not recorded");

    // Moving the inspector afterwards must not change what is already down: the compositor still sends the old set.
    Layer.Channels.base_metalness = 0;
    Layer.Channels.specular_roughness = 0.9;
    Device.Calls.length = 0;
    Integrator.Composite([{ ...Layer, Visible: true, Opacity: 1 }], null);
    const Scalars = Device.Calls.filter((Call) => Call.Name === "uniform1fv" && Call.Arguments[0]?.Name === "uScalar[0]");
    assert.ok(Scalars.length, "the compositor never uploaded the channel scalars");
    assert.equal([...Scalars.at(-1).Arguments[1]][0], 0, "the painted roughness followed the inspector");
    assert.equal([...Scalars.at(-1).Arguments[1]][1], 1, "the painted metalness followed the inspector");
});

test("a second set of channel values promotes the layer and keeps the first stroke's", () =>
{
    const { Integrator, Device } = Prepare(128);
    const Layer = CreateLayer("stroke");
    Layer.Channels.base_metalness = 1;
    Layer.Channels.specular_roughness = 0;
    Integrator.Stamp(Layer, StrokeOptions());

    // The inspector moves, and the next stroke carries the new numbers.
    Layer.Channels.base_metalness = 0.5;
    Layer.Channels.specular_roughness = 0.5;
    Layer.Channels.height = 1;
    Device.Calls.length = 0;
    Integrator.Stamp(Layer, StrokeOptions({ Start: [0.2, 0, 0.8], End: [0.3, 0, 0.8] }));

    assert.ok(Integrator.PaintedLayer(Layer), "the layer did not grow channel images");
    const Record = Integrator.LayerImages.get(Layer.Identifier);
    assert.equal(Record.Uniform, null, "the layer still claims to be uniform");
    for (const Image of ["Surfacing", "Coating", "Radiance"]) assert.ok(Record[Image], `${Image} was never allocated`);

    // The settle pass hands the first stroke the values it was laid down with before the second one lands.
    const Settled = Uploaded(Device, "uSettleSurfacing");
    assert.equal(Settled.length, 1, "the existing paint was not settled exactly once");
    assert.deepEqual(Settled[0].slice(0, 2), [0, 1], "the first stroke was settled with the wrong values");

    // The second stroke writes its own.
    const Carried = Uploaded(Device, "uPaintSurfacing").at(-1);
    assert.deepEqual(Carried.slice(0, 2), [0.5, 0.5], "the second stroke did not carry its own values");
    assert.equal(Carried[3], 1, "the second stroke did not carry its height");

    // And the dab goes to the four-image target, not to the coverage image alone.
    const Bound = Device.Calls.filter((Call) => Call.Name === "bindFramebuffer").at(-2);
    assert.ok(Record.PaintTarget, "the combined paint target was never built");
    assert.ok(Bound, "nothing was bound for the stamp");
});

test("the compositor reads channel values per texel once a layer keeps them that way", () =>
{
    const { Integrator, Device } = Prepare(128);
    const Layer = CreateLayer("stroke");
    Integrator.Stamp(Layer, StrokeOptions());
    Layer.Channels.specular_roughness = 0.25;
    Integrator.Stamp(Layer, StrokeOptions({ Start: [0.3, 0, 0.8], End: [0.4, 0, 0.8] }));

    Device.Calls.length = 0;
    Integrator.Composite([{ ...Layer, Visible: true, Opacity: 1 }], null);
    const Flag = Device.Calls.filter((Call) => Call.Name === "uniform1f" && Call.Arguments[0]?.Name === "uPainted");
    assert.ok(Flag.length, "the compositor never said whether the layer is painted per texel");
    assert.equal(Flag.at(-1).Arguments[1], 1, "a promoted layer was composited as if it were uniform");
    for (const Name of ["uSurfacingMap", "uCoatingMap", "uRadianceMap"])
        assert.ok(
            Device.Calls.some((Call) => Call.Name === "uniform1i" && Call.Arguments[0]?.Name === Name),
            `${Name} was never bound`,
        );
});

test("neither an eraser nor a mask stroke can promote a layer", () =>
{
    const { Integrator } = Prepare(128);
    const Layer = CreateLayer("stroke");
    Layer.Channels.base_metalness = 1;
    Integrator.Stamp(Layer, StrokeOptions());
    Layer.Channels.base_metalness = 0;
    Integrator.Stamp(Layer, StrokeOptions({ Erase: true }));
    assert.equal(Integrator.PaintedLayer(Layer), false, "erasing grew channel images");
    const Record = Integrator.LayerImages.get(Layer.Identifier);
    assert.equal(Record.Uniform[1], 1, "erasing rewrote what the layer was painted with");

    Layer.Mask.Kind = "stroke";
    Integrator.Stamp(Layer, StrokeOptions({ Target: "mask" }));
    assert.equal(Integrator.PaintedLayer(Layer), false, "a mask stroke grew channel images");
});

test("undo puts a stroke's channel values back along with its colour", () =>
{
    const { Integrator } = Prepare(64);
    const Layer = CreateLayer("stroke");
    Layer.Channels.base_metalness = 1;
    Integrator.Stamp(Layer, StrokeOptions());
    const Before = Integrator.SnapshotLayer(Layer, "coverage");
    assert.equal(Before.Paintwork, undefined, "a uniform layer snapshotted images it does not have");
    assert.equal(Before.Uniform[1], 1, "the snapshot did not record what the layer was painted with");

    Layer.Channels.base_metalness = 0;
    Layer.Channels.coat_weight = 1;
    Integrator.Stamp(Layer, StrokeOptions({ Start: [0.4, 0, 0.8], End: [0.5, 0, 0.8] }));
    const After = Integrator.SnapshotLayer(Layer, "coverage");
    assert.equal(After.Paintwork?.length, 3, "a promoted layer did not snapshot its channel images");
    assert.ok(After.Paintwork.every((Image) => Image.Pixels?.length === 64 * 64 * 4), "a channel image came back the wrong size");

    // Stepping back to the first snapshot has to return the layer to being uniform, values and all.
    Integrator.RestoreLayer(Layer, "coverage", Before);
    const Record = Integrator.LayerImages.get(Layer.Identifier);
    assert.equal(Record.Uniform?.[1], 1, "undo did not restore the values the layer was painted with");
});

test("levelling a layer sends every texel back to one set of values", () =>
{
    const { Integrator, Device } = Prepare(64);
    const Layer = CreateLayer("stroke");
    Integrator.Stamp(Layer, StrokeOptions());
    Layer.Channels.specular_roughness = 0.8;
    Integrator.Stamp(Layer, StrokeOptions({ Start: [0.4, 0, 0.8], End: [0.5, 0, 0.8] }));
    assert.ok(Integrator.PaintedLayer(Layer), "the layer should have been promoted first");

    const Textures = Device.Resources.Textures;
    assert.equal(Integrator.LevelLayer(Layer), true, "levelling refused a painted layer");
    assert.equal(Integrator.PaintedLayer(Layer), false, "levelling left the channel images in place");
    assert.equal(Device.Resources.Textures, Textures - 3, "levelling leaked the channel images");
    assert.ok(Math.abs(Integrator.LayerImages.get(Layer.Identifier).Uniform[0] - 0.8) < 1e-6, "levelling used the wrong values");
    assert.equal(Integrator.LevelLayer(CreateLayer("stroke")), false, "levelling an unpainted layer claimed to work");
});

test("a promoted layer survives a change of resolution", () =>
{
    const { Integrator, Device } = Prepare(128);
    const Layer = CreateLayer("stroke");
    Integrator.Stamp(Layer, StrokeOptions());
    Layer.Channels.specular_roughness = 0.6;
    Integrator.Stamp(Layer, StrokeOptions({ Start: [0.4, 0, 0.8], End: [0.5, 0, 0.8] }));
    const Record = Integrator.LayerImages.get(Layer.Identifier);
    const Framebuffers = Device.Resources.Framebuffers;

    Layer.Resolution = 256;
    Integrator.ResampleLayer(Layer);
    assert.equal(Record.CoverageSize, 256);
    for (const Slot of ["Surfacing", "Coating", "Radiance"])
        assert.equal(Record[`${Slot}Size`], 256, `${Slot} did not follow the layer to its new size`);
    assert.equal(Record.PaintTarget, null, "the combined target still names the old images");
    assert.equal(Record.SettleTarget, null, "the settle target still names the old images");
    assert.ok(Device.Resources.Framebuffers <= Framebuffers, "resizing leaked framebuffers");

    // And the next dab rebuilds it rather than throwing.
    Integrator.Stamp(Layer, StrokeOptions({ Start: [0.1, 0, 0.8], End: [0.2, 0, 0.8] }));
    assert.ok(Record.PaintTarget, "the combined target was not rebuilt");
    assert.ok(Integrator.PaintedLayer(Layer), "the layer lost its channel images");
});

test("the medium writes a material and not only a colour", () =>
{
    // The model is written twice — once in MediaSolver.js for the card, the rasteriser and the tests, once in GLSL for
    // the stroke itself. There is no GPU here to run the second copy, so what is checked is that the shader still has
    // the shape the JavaScript twin was written against: four numbers out, two of them the material.
    assert.match(Chunks.Media, /vec4 MediaDeposit\(/, "the medium stopped returning a material");
    assert.match(Chunks.Media, /\(coverage, shade, relief, grit\)/, "the four numbers are not named in the shader");
    const Branches = Chunks.Media.match(/return vec4\(/g) || [];
    assert.ok(Branches.length >= 7, `only ${Branches.length} of the seven media return a vec4`);
    // Medium zero has to leave the authored material exactly as it was, or an unset uniform repaints the surface.
    assert.match(Chunks.Media, /Rim\), 0\.0, 1\.0\), 1\.0, 0\.0, 0\.0\);/, "the plain dab no longer leaves the material alone");
    for (const Name of ["Fan", "Wander", "Burnish", "Melted"])
        assert.ok(Chunks.Media.includes(Name), `${Name} is in the JavaScript twin but not in the shader`);

    // And the stroke has to carry the last two numbers into the channels it writes.
    assert.match(StampFragment, /void Emit\(vec4 Cover, float Alpha, vec2 Grain\)/, "the dab cannot carry a medium's grain");
    assert.match(StampFragment, /Paint\.x = clamp\(Paint\.x \+ Grain\.y/, "the medium's grit never reaches the roughness");
    assert.match(StampFragment, /Paint\.w = clamp\(Paint\.w \+ Grain\.x/, "the medium's relief never reaches the height");
    assert.match(StampFragment, /Emit\([^;]*Media\.zw\);/, "the stroke throws the medium's material away");
    assert.equal((StampFragment.match(/Emit\(.*vec2\(0\.0\)\);/g) || []).length, 3, "a decal or a gradient grew a grain of its own");
});

test("a stroke is a path and not a pile of dabs", () =>
{
    // Segments are stamped a tenth of a radius apart and each one covers a whole capsule, so without an owner every
    // texel is painted by dozens of them. Whatever the medium does to one deposit — the comb of a head, the grain of
    // a stick — is averaged away by the fortieth, which is why the card's ribbon and the surface used to disagree.
    assert.match(StampFragment, /uniform vec4 uStrokeBefore;/, "a dab cannot tell which way the stroke came from");
    assert.match(StampFragment, /uniform float uStrokeCap;/, "a stroke has no way to close its far end");
    assert.match(StampFragment, /bool OwnsTexel\(float Place, float Past\)/, "nothing decides which segment owns a texel");
    assert.match(StampFragment, /if \(uStrokeCap > 0\.5\) return Place > 1\.0;/, "the closing cap claims more than the ground past the end");
    assert.match(StampFragment, /if \(Place > 1\.0\) return false;/, "a segment paints past its own end");
    assert.match(StampFragment, /uStrokeBefore\.w > 0\.5 && Past <= 0\.0/, "the wedge on the outside of a turn has no owner");
    // Both painting views, and only those: a decal, a gradient and a burn return before the stroke's own frame.
    assert.equal((StampFragment.match(/OwnsTexel\(Place,/g) || []).length, 2, "the two painting views do not agree on ownership");

    const { Integrator, Device } = Prepare();
    const Layer = CreateLayer("stroke");
    Integrator.EnsureCoverage(Layer);
    const Sent = (Name) => Device.Calls.filter((Call) => Call.Arguments?.[0]?.Name === Name).at(-1)?.Arguments;
    const Options = {
        Target: "coverage", Start: [0, 0, 0.8], End: [0.1, 0, 0.8], Normal: [0, 0, 1], Colour: [1, 1, 1],
        Radius: 0.05, Hardness: 0.5, Flow: 1,
    };
    Integrator.Stamp(Layer, { ...Options, Before: [1, 0, 0, 1] });
    assert.deepEqual([...Sent("uStrokeBefore")[1]], [1, 0, 0, 1], "the heading never reaches the pass");
    assert.equal(Sent("uStrokeCap")[1], 0, "an ordinary dab went up as a cap");
    Integrator.Stamp(Layer, { ...Options, Cap: true });
    assert.equal(Sent("uStrokeCap")[1], 1, "the closing dab did not go up as a cap");
    assert.deepEqual([...Sent("uStrokeBefore")[1]], [0, 0, 0, 0], "a dab with nothing behind it claimed a predecessor");
});
