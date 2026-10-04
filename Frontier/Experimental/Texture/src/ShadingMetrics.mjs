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
import { ExportSlots, SurfaceFragment, PlaneFragment } from "./ShadingGlsl.js";
import { DisplayIndex } from "./ChannelSpecification.js";

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
    assert.deepEqual(Names.sort(), ["Background", "Bake", "Composite", "Curvature", "Dilate", "Plane", "Resolve", "Shade", "Stamp"].sort());
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
