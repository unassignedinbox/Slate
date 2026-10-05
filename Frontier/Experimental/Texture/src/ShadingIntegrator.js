//============================================================================================================================================
// 🖥 ShadingIntegrator.js — the WebGL2 device layer: surface bake, layer compositing, brush stamping and viewport shading
//============================================================================================================================================
// Device memory held per document:
//   · bake targets      — position RGBA16F, normal RGBA16F, field RGBA8 (curvature / cavity / altitude / occlusion)
//   · channel targets   — two sets of four RGBA8 images, ping-ponged while the stack is flattened
//   · per-layer images  — coverage RGBA8 for painted layers, mask RGBA8 for painted masks, decal RGBA8 for placements
// Everything is allocated on demand and released with the layer, so a stack of fills costs nothing beyond the channel set.
//============================================================================================================================================

import {
    QuadVertex,
    BakeVertex,
    BakeFragment,
    DilateFragment,
    CurvatureFragment,
    StampFragment,
    CompositeFragment,
    MaskFragment,
    SurfaceVertex,
    SurfaceFragment,
    BackgroundFragment,
    PlaneFragment,
    ResolveFragment,
    SettleFragment,
    Chunks,
} from "./ShadingGlsl.js";
import {
    ChannelSpecification,
    BlendIndex,
    PaintedImages,
    PaintedSlots,
    PaintedSlotForTarget,
    PaintedVector,
    PaintedVectorsAgree,
} from "./ChannelSpecification.js";
import { GeneratorIndex } from "./GeneratorSpecification.js";
import { FinishFamilyIndex, FinishStyleIndex } from "./FinishSpecification.js";
import { EnvironmentByIdentifier } from "./MaterialSpecification.js";
import { TileRectangle } from "./SceneStructure.js";
import { MediaUniforms, PlainMedia } from "./MediaSolver.js";
import { WriteOrdering, GradientEasings } from "./StrokeSpecification.js";

const MaskKindIndex = (Kind) => ({ stroke: 1, generator: 2, colour: 3 })[Kind] ?? 0;

const Header = "#version 300 es\nprecision highp float;\nprecision highp int;\nprecision highp sampler2D;\n";

const Compile = (Device, Kind, Source) =>
{
    const Shader = Device.createShader(Kind);
    Device.shaderSource(Shader, Source);
    Device.compileShader(Shader);
    if (!Device.getShaderParameter(Shader, Device.COMPILE_STATUS))
    {
        const Report = Device.getShaderInfoLog(Shader) || "unknown";
        const Numbered = Source.split("\n")
            .map((Line, Index) => `${String(Index + 1).padStart(4, " ")} ${Line}`)
            .join("\n");
        Device.deleteShader(Shader);
        throw new Error(`Shader compilation failed: ${Report}\n${Numbered}`);
    }
    return Shader;
};

const Link = (Device, VertexSource, FragmentSource, Requested = []) =>
{
    const Prefix = Requested.map((Name) => Chunks[Name]).join("\n");
    const Vertex = Compile(Device, Device.VERTEX_SHADER, `${Header}${VertexSource}`);
    const Fragment = Compile(Device, Device.FRAGMENT_SHADER, `${Header}${Prefix}\n${FragmentSource}`);
    const Program = Device.createProgram();
    Device.attachShader(Program, Vertex);
    Device.attachShader(Program, Fragment);
    Device.linkProgram(Program);
    Device.deleteShader(Vertex);
    Device.deleteShader(Fragment);
    if (!Device.getProgramParameter(Program, Device.LINK_STATUS))
    {
        const Report = Device.getProgramInfoLog(Program) || "unknown";
        Device.deleteProgram(Program);
        throw new Error(`Program link failed: ${Report}`);
    }
    const Uniforms = new Map();
    const Count = Device.getProgramParameter(Program, Device.ACTIVE_UNIFORMS);
    for (let Index = 0; Index < Count; Index += 1)
    {
        const Record = Device.getActiveUniform(Program, Index);
        const Name = Record.name.replace(/\[0\]$/, "");
        Uniforms.set(Name, Device.getUniformLocation(Program, Record.name));
    }
    return { Program, Uniforms };
};

//--------------------------------------------------------------------------------------------------------------------------
// Context creation is the most fragile step in any browser renderer, and it fails quietly: a pending browser update, a
// driver reset, a disabled acceleration switch or simply too many live contexts all arrive as a null return rather than an
// exception. Ask progressively humbler attribute sets — a discrete GPU request is the usual thing a tired driver refuses —
// and keep every refusal the browser bothered to describe.
//--------------------------------------------------------------------------------------------------------------------------
export const DeviceAttributeSets = [
    { alpha: false, antialias: true, depth: true, preserveDrawingBuffer: false, powerPreference: "high-performance" },
    { alpha: false, antialias: true, depth: true, preserveDrawingBuffer: false },
    { alpha: false, antialias: false, depth: true, preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: false },
    { alpha: true, antialias: false, depth: false },
    {},
];

export const AcquireDevice = (Canvas) =>
{
    const Notes = [];
    const Listen = (Event) =>
    {
        if (Event?.statusMessage) Notes.push(String(Event.statusMessage).trim());
        Event?.preventDefault?.();
    };
    Canvas.addEventListener?.("webglcontextcreationerror", Listen, false);
    let Device = null;
    for (const Attributes of DeviceAttributeSets)
    {
        try
        {
            Device = Canvas.getContext("webgl2", Attributes);
        }
        catch (Error)
        {
            Notes.push(Error?.message || String(Error));
        }
        if (Device) break;
    }
    Canvas.removeEventListener?.("webglcontextcreationerror", Listen, false);
    return { Device, Notes: [...new Set(Notes)] };
};

//--------------------------------------------------------------------------------------------------------------------------
// When every attempt fails, work out which of the three usual worlds we are in — no WebGL at all, WebGL 1 only, or a
// browser that simply ran out of contexts — and answer with steps rather than a shrug.
//--------------------------------------------------------------------------------------------------------------------------
export const DescribeDeviceFailure = (Notes = []) =>
{
    const Spoken = Notes.join(" ");
    const Crowded = /too many|context limit|maximum number/i.test(Spoken);
    // Chromium answers a browser-wide switch-off with GL_VENDOR = Disabled and a BindToCurrentSequence failure. That is a
    // different world from a missing driver: nothing is wrong with the machine, the browser is simply not handing out GPUs.
    const Switched = /GL_VENDOR\s*=\s*Disabled|GL_RENDERER\s*=\s*Disabled|BindToCurrentSequence|GPU access is disabled/i.test(Spoken);
    let Legacy = null;
    let Renderer = "";
    try
    {
        const Probe = document.createElement("canvas");
        Legacy = Probe.getContext("webgl") || Probe.getContext("experimental-webgl");
        if (Legacy)
        {
            const Reflection = Legacy.getExtension("WEBGL_debug_renderer_info");
            Renderer = String(
                (Reflection && Legacy.getParameter(Reflection.UNMASKED_RENDERER_WEBGL)) || Legacy.getParameter(Legacy.RENDERER) || "",
            );
            Legacy.getExtension("WEBGL_lose_context")?.loseContext();
        }
    }
    catch
    {
        Legacy = null;
    }

    if (Crowded)
        return {
            Message: "The browser has run out of WebGL contexts, so this page could not open one.",
            Advice: [
                "Close other tabs that are running 3D or video — each holds a context open.",
                "Reload this page once they are closed.",
            ],
            Detail: Notes,
            Renderer,
        };

    if (Switched)
        return {
            Message:
                "This browser has GPU access switched off for every page, not only this one — it reports its own GL vendor and " +
                "renderer as Disabled. Any WebGL site will fail here in the same way until it is turned back on.",
            Advice: [
                "Chrome or Edge: Settings → System → turn on “Use graphics acceleration when available”, then relaunch the browser.",
                "If that switch is greyed out the browser is managed by policy — open chrome://policy and look for HardwareAccelerationModeEnabled.",
                "Open chrome://gpu: WebGL2 will read Disabled, and “Problems Detected” at the foot of the page names the reason.",
                "Blocklisted driver — common on virtual machines, remote desktops and the Microsoft Basic Render Driver? Set chrome://flags/#ignore-gpu-blocklist to Enabled and relaunch.",
                "Software rendering is no longer automatic: launching the browser with --enable-unsafe-swiftshader gives a slow CPU context that will run this editor.",
            ],
            Detail: Notes,
            Renderer,
        };

    if (Legacy)
        return {
            Message: "This browser offers WebGL 1 but refused a WebGL 2 context, which the editor needs for multiple render targets.",
            Advice: [
                "Update the browser — WebGL 2 has shipped in Chrome, Edge, Firefox and Safari since 2021.",
                "In Chrome or Edge, open chrome://flags and make sure nothing disables WebGL 2 or forces ANGLE to a software backend.",
                "Update the graphics driver, then restart the browser.",
            ],
            Detail: Notes,
            Renderer,
        };

    return {
        Message: "The browser would not create a WebGL context at all, which usually means its GPU process is not running.",
        Advice: [
            "If the browser is waiting to be relaunched for an update, relaunch it — a half-updated browser keeps the GPU process down.",
            "Chrome and Edge: Settings → System → turn on “Use graphics acceleration when available”, then relaunch.",
            "Open chrome://gpu and check that “WebGL2” reads Hardware accelerated.",
            "Try a window without extensions, or another browser profile, to rule out a blocking extension.",
        ],
        Detail: Notes,
        Renderer,
    };
};

//--------------------------------------------------------------------------------------------------------------------------
// Asking a second graphics API separates two very different failures: if WebGPU hands over an adapter then the GPU process
// is alive and well and WebGL alone has been switched off, which is a browser setting rather than a broken machine.
//--------------------------------------------------------------------------------------------------------------------------
export const ProbeAcceleration = async () =>
{
    const Report = { Legacy: false, Modern: false, Adapter: "", Agent: "", Ratio: 1, Address: "", Framed: false, Secure: true };
    try
    {
        Report.Agent = String(navigator?.userAgent || "");
        Report.Ratio = Number(globalThis.devicePixelRatio) || 1;
        Report.Address = String(globalThis.location?.href || "");
        Report.Framed = Boolean(globalThis.top) && globalThis.top !== globalThis.self;
        Report.Secure = globalThis.isSecureContext !== false;
    }
    catch
    {
        Report.Agent = "";
    }
    try
    {
        const Probe = document.createElement("canvas");
        const Legacy = Probe.getContext("webgl") || Probe.getContext("experimental-webgl");
        Report.Legacy = Boolean(Legacy);
        Legacy?.getExtension?.("WEBGL_lose_context")?.loseContext();
    }
    catch
    {
        Report.Legacy = false;
    }
    try
    {
        const Adapter = await navigator?.gpu?.requestAdapter?.();
        if (Adapter)
        {
            Report.Modern = true;
            const Described = Adapter.info || (await Adapter.requestAdapterInfo?.()) || {};
            Report.Adapter =
                [Described.vendor, Described.architecture, Described.device, Described.description].filter(Boolean).join(" ") ||
                "an unnamed adapter";
        }
    }
    catch
    {
        Report.Modern = false;
    }
    return Report;
};

//--------------------------------------------------------------------------------------------------------------------------
// One block of text worth pasting into a bug report or a chat window.
//--------------------------------------------------------------------------------------------------------------------------
export const DeviceReport = (Failure, Notes = [], Probe = null) =>
    [
        "Frontier Texture — renderer report",
        `When      : ${new Date().toISOString()}`,
        `Failure   : ${Failure || "none"}`,
        `Browser   : ${Probe?.Agent || "unknown"}`,
        `Address   : ${Probe?.Address || "unknown"}`,
        `Pixel ratio: ${Probe?.Ratio ?? "unknown"}`,
        `Framed    : ${Probe ? (Probe.Framed ? "yes, inside an iframe" : "no, top level") : "not probed"}`,
        `WebGL 1   : ${Probe ? (Probe.Legacy ? "available" : "unavailable") : "not probed"}`,
        `WebGL 2   : unavailable`,
        `WebGPU    : ${Probe ? (Probe.Modern ? `adapter available — ${Probe.Adapter}` : "no adapter") : "not probed"}`,
        `Attempts  : ${DeviceAttributeSets.length} attribute sets`,
        ...(Notes.length ? ["Browser said:", ...Notes.map((Note) => `  ${Note}`)] : ["Browser said: nothing"]),
    ].join("\n");

//--------------------------------------------------------------------------------------------------------------------------
// The names browsers give their CPU rasterisers. SwANGLE is what Chromium reports when it is running SwiftShader behind
// ANGLE, which is what --enable-unsafe-swiftshader turns on.
//--------------------------------------------------------------------------------------------------------------------------
export const SoftwareRenderer = (Renderer) =>
    /swiftshader|swangle|llvmpipe|softpipe|software rasterizer|microsoft basic render|generic renderer|apple paravirtual/i.test(
        String(Renderer || ""),
    );

export class ShadingIntegrator
{
    constructor(Canvas)
    {
        this.Canvas = Canvas;
        this.Failure = "";
        this.Advice = [];
        this.Notes = [];
        this.Renderer = "";
        this.Resolution = 1024;
        this.Surface = null;
        this.Statistics = { Composites: 0, Stamps: 0, CompositeMicroseconds: 0, Layers: 0, Passes: 0, Triangles: 0 };
        this.LayerImages = new Map();
        const { Device: Acquired, Notes } = AcquireDevice(Canvas);
        this.Device = Acquired;
        this.Notes = Notes;
        if (!this.Device)
        {
            const Diagnosis = DescribeDeviceFailure(Notes);
            this.Failure = Diagnosis.Message;
            this.Advice = Diagnosis.Advice;
            this.Renderer = Diagnosis.Renderer;
            return;
        }
        const Device = this.Device;
        const Reflection = Device.getExtension("WEBGL_debug_renderer_info");
        this.Renderer = String(
            (Reflection && Device.getParameter(Reflection.UNMASKED_RENDERER_WEBGL)) || Device.getParameter(Device.RENDERER) || "",
        );
        // A CPU rasteriser answers every call the same way a GPU does, just far slower. Knowing which one we are talking to
        // lets the panel ask for less work rather than crawl.
        this.Software = SoftwareRenderer(this.Renderer);
        // Rendering into RGBA16F needs one of these two. The second is the mobile and software-backend spelling of the first.
        this.FloatRender = Device.getExtension("EXT_color_buffer_float") || Device.getExtension("EXT_color_buffer_half_float");
        this.FloatFilter = Device.getExtension("OES_texture_float_linear");
        if (!this.FloatRender)
        {
            this.Failure = "This WebGL 2 context cannot render into floating-point images, which the surface pass needs.";
            this.Advice = [
                "Update the graphics driver and relaunch the browser.",
                "Open chrome://gpu and check whether the GPU is being emulated in software.",
            ];
            return;
        }
        if (Device.getParameter(Device.MAX_DRAW_BUFFERS) < 4)
        {
            this.Failure = "This device exposes fewer than four draw buffers.";
            return;
        }
        try
        {
            this.CreatePrograms();
            this.CreateGeometry();
            this.Configure(this.Resolution);
        }
        catch (Error)
        {
            this.Failure = Error.message;
        }
    }

    get Ready()
    {
        return Boolean(this.Device) && !this.Failure;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Programs and static geometry.
    //----------------------------------------------------------------------------------------------------------------------
    CreatePrograms()
    {
        const Device = this.Device;
        this.Programs = {
            Bake: Link(Device, BakeVertex, BakeFragment),
            Dilate: Link(Device, QuadVertex, DilateFragment),
            Curvature: Link(Device, QuadVertex, CurvatureFragment),
            Stamp: Link(Device, QuadVertex, StampFragment, ["Noise", "Media"]),
            Composite: Link(Device, QuadVertex, CompositeFragment, ["Noise", "Generator", "Finish", "Mask", "Blend"]),
            Mask: Link(Device, QuadVertex, MaskFragment, ["Noise", "Generator", "Mask"]),
            Shade: Link(Device, SurfaceVertex, SurfaceFragment, ["Environment"]),
            Background: Link(Device, QuadVertex, BackgroundFragment, ["Environment"]),
            Plane: Link(Device, QuadVertex, PlaneFragment),
            Resolve: Link(Device, QuadVertex, ResolveFragment),
            Settle: Link(Device, QuadVertex, SettleFragment),
        };
    }

    CreateGeometry()
    {
        const Device = this.Device;
        this.QuadArray = Device.createVertexArray();
        Device.bindVertexArray(this.QuadArray);
        const Corners = Device.createBuffer();
        Device.bindBuffer(Device.ARRAY_BUFFER, Corners);
        Device.bufferData(Device.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), Device.STATIC_DRAW);
        Device.enableVertexAttribArray(0);
        Device.vertexAttribPointer(0, 2, Device.FLOAT, false, 0, 0);
        Device.bindVertexArray(null);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Texture and target helpers.
    //----------------------------------------------------------------------------------------------------------------------
    CreateImage(Width, Height, Internal, Format, Type, Linear = true)
    {
        const Device = this.Device;
        const Image = Device.createTexture();
        Device.bindTexture(Device.TEXTURE_2D, Image);
        Device.texStorage2D(Device.TEXTURE_2D, 1, Internal, Width, Height);
        const Filter = Linear ? Device.LINEAR : Device.NEAREST;
        Device.texParameteri(Device.TEXTURE_2D, Device.TEXTURE_MIN_FILTER, Filter);
        Device.texParameteri(Device.TEXTURE_2D, Device.TEXTURE_MAG_FILTER, Filter);
        Device.texParameteri(Device.TEXTURE_2D, Device.TEXTURE_WRAP_S, Device.CLAMP_TO_EDGE);
        Device.texParameteri(Device.TEXTURE_2D, Device.TEXTURE_WRAP_T, Device.CLAMP_TO_EDGE);
        Device.bindTexture(Device.TEXTURE_2D, null);
        Image.Width = Width;
        Image.Height = Height;
        Image.Internal = Internal;
        Image.Format = Format;
        Image.Type = Type;
        return Image;
    }

    CreateColourImage(Size, Linear = true)
    {
        const Device = this.Device;
        return this.CreateImage(Size, Size, Device.RGBA8, Device.RGBA, Device.UNSIGNED_BYTE, Linear);
    }

    CreateTarget(Images)
    {
        const Device = this.Device;
        const Target = Device.createFramebuffer();
        Device.bindFramebuffer(Device.FRAMEBUFFER, Target);
        Images.forEach((Image, Index) =>
            Device.framebufferTexture2D(
                Device.FRAMEBUFFER,
                Device.COLOR_ATTACHMENT0 + Index,
                Device.TEXTURE_2D,
                Image,
                0,
            ),
        );
        Device.drawBuffers(Images.map((_, Index) => Device.COLOR_ATTACHMENT0 + Index));
        const Status = Device.checkFramebufferStatus(Device.FRAMEBUFFER);
        Device.bindFramebuffer(Device.FRAMEBUFFER, null);
        if (Status !== Device.FRAMEBUFFER_COMPLETE) throw new Error(`Incomplete render target (0x${Status.toString(16)}).`);
        Target.Images = Images;
        return Target;
    }

    ReleaseTarget(Target)
    {
        if (!Target) return;
        const Device = this.Device;
        for (const Image of Target.Images || []) Device.deleteTexture(Image);
        Device.deleteFramebuffer(Target);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Channel allocation. Called on construction and whenever the authoring resolution changes.
    //----------------------------------------------------------------------------------------------------------------------
    Configure(Resolution)
    {
        const Device = this.Device;
        const Previous = this.Resolution;
        this.Resolution = Resolution;
        this.ReleaseTarget(this.ChannelTargets?.[0]);
        this.ReleaseTarget(this.ChannelTargets?.[1]);
        this.ReleaseTarget(this.BakeTarget);
        this.ReleaseTarget(this.BakeScratch);
        this.ReleaseTarget(this.FieldTarget);
        this.ReleaseTarget(this.MaskPreviewTarget);
        this.ChannelTargets = [0, 1].map(() =>
            this.CreateTarget([0, 1, 2, 3].map(() => this.CreateColourImage(Resolution))),
        );
        this.ChannelIndex = 0;
        this.BakeTarget = this.CreateTarget([
            this.CreateImage(Resolution, Resolution, Device.RGBA16F, Device.RGBA, Device.FLOAT, false),
            this.CreateImage(Resolution, Resolution, Device.RGBA16F, Device.RGBA, Device.FLOAT, false),
        ]);
        this.BakeScratch = this.CreateTarget([
            this.CreateImage(Resolution, Resolution, Device.RGBA16F, Device.RGBA, Device.FLOAT, false),
            this.CreateImage(Resolution, Resolution, Device.RGBA16F, Device.RGBA, Device.FLOAT, false),
        ]);
        this.FieldTarget = this.CreateTarget([this.CreateColourImage(Resolution)]);
        this.MaskPreviewTarget = this.CreateTarget([this.CreateColourImage(Resolution)]);
        this.MaskPreviewLayer = "";
        if (Previous !== Resolution) this.RescaleLayerImages(Previous, Resolution);
        if (this.Surface) this.BakeSurface();
    }

    // Painted coverage survives a resolution change by way of a filtered blit.
    // The document changed size, so every layer that follows the document follows it here. A layer holding its own
    // sheet size is left exactly as it is: that is the point of carrying one.
    RescaleLayerImages(Previous, Resolution)
    {
        for (const Record of this.LayerImages.values()) this.FitLayerImages(Record, Record.Own ? Record.Own : Resolution, Previous);
    }

    // One layer's images moved to a new size, keeping what is painted on them.
    ResampleLayer(Layer)
    {
        const Record = this.LayerImages.get(Layer.Identifier);
        if (!Record) return;
        Record.Own = Layer.Resolution || 0;
        this.FitLayerImages(Record, this.LayerResolution(Layer), this.Resolution);
    }

    FitLayerImages(Record, Size, Fallback)
    {
        for (const Slot of ["Coverage", ...PaintedSlots, "Mask"])
        {
            if (!Record[Slot]) continue;
            if ((Record[`${Slot}Size`] || Fallback) === Size) continue;
            if (!Record[`${Slot}Target`]) Record[`${Slot}Target`] = this.CreateTarget([Record[Slot]]);
            Record[`${Slot}Size`] = Record[`${Slot}Size`] || Fallback;
            this.ResizeLayerImage(Record, Slot, Size);
            // The two combined targets name the images that were just replaced, so they have to go with them.
            if (Slot === "Mask") continue;
            if (Record.PaintTarget) this.Device.deleteFramebuffer(Record.PaintTarget);
            if (Record.SettleTarget) this.Device.deleteFramebuffer(Record.SettleTarget);
            for (const Slice of Record.SliceTargets || []) if (Slice) this.Device.deleteFramebuffer(Slice);
            Record.PaintTarget = null;
            Record.SettleTarget = null;
            Record.SliceTargets = null;
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Surface upload and bake.
    //----------------------------------------------------------------------------------------------------------------------
    SetSurface(Surface)
    {
        const Device = this.Device;
        this.Surface = Surface;
        if (this.SurfaceArray) Device.deleteVertexArray(this.SurfaceArray);
        for (const Buffer of this.SurfaceBuffers || []) Device.deleteBuffer(Buffer);
        this.SurfaceArray = Device.createVertexArray();
        Device.bindVertexArray(this.SurfaceArray);
        const Attributes = [
            { Data: Surface.Positions, Size: 3 },
            { Data: Surface.Normals, Size: 3 },
            { Data: Surface.Tangents, Size: 4 },
            { Data: Surface.Coordinates, Size: 2 },
            { Data: Surface.Occlusion, Size: 1 },
        ];
        this.SurfaceBuffers = Attributes.map((Attribute, Location) =>
        {
            const Buffer = Device.createBuffer();
            Device.bindBuffer(Device.ARRAY_BUFFER, Buffer);
            Device.bufferData(Device.ARRAY_BUFFER, Attribute.Data, Device.STATIC_DRAW);
            Device.enableVertexAttribArray(Location);
            Device.vertexAttribPointer(Location, Attribute.Size, Device.FLOAT, false, 0, 0);
            return Buffer;
        });
        const Indices = Device.createBuffer();
        Device.bindBuffer(Device.ELEMENT_ARRAY_BUFFER, Indices);
        Device.bufferData(Device.ELEMENT_ARRAY_BUFFER, Surface.Indices, Device.STATIC_DRAW);
        this.SurfaceBuffers.push(Indices);
        Device.bindVertexArray(null);
        this.Statistics.Triangles = Surface.Triangles;
        this.BakeSurface();
    }

    UploadOcclusion()
    {
        if (!this.Surface || !this.SurfaceBuffers) return;
        const Device = this.Device;
        Device.bindVertexArray(this.SurfaceArray);
        Device.bindBuffer(Device.ARRAY_BUFFER, this.SurfaceBuffers[4]);
        Device.bufferData(Device.ARRAY_BUFFER, this.Surface.Occlusion, Device.STATIC_DRAW);
        Device.bindVertexArray(null);
        this.BakeSurface();
    }

    BakeSurface()
    {
        if (!this.Surface || !this.SurfaceArray) return;
        const Device = this.Device;
        const Size = this.Resolution;
        Device.bindFramebuffer(Device.FRAMEBUFFER, this.BakeTarget);
        Device.viewport(0, 0, Size, Size);
        Device.disable(Device.BLEND);
        Device.disable(Device.DEPTH_TEST);
        Device.disable(Device.CULL_FACE);
        Device.clearBufferfv(Device.COLOR, 0, new Float32Array([0, 0, 0, 0]));
        Device.clearBufferfv(Device.COLOR, 1, new Float32Array([0, 1, 0, 0]));
        Device.useProgram(this.Programs.Bake.Program);
        Device.bindVertexArray(this.SurfaceArray);
        Device.drawElements(Device.TRIANGLES, this.Surface.Indices.length, Device.UNSIGNED_INT, 0);
        Device.bindVertexArray(null);

        // Island padding: four dilation rings, ping-ponged between the bake target and its scratch twin.
        const Dilate = this.Programs.Dilate;
        Device.useProgram(Dilate.Program);
        Device.bindVertexArray(this.QuadArray);
        let Source = this.BakeTarget;
        let Destination = this.BakeScratch;
        for (let Pass = 0; Pass < 4; Pass += 1)
        {
            Device.bindFramebuffer(Device.FRAMEBUFFER, Destination);
            this.BindImage(Dilate, "uPositionSource", Source.Images[0], 0);
            this.BindImage(Dilate, "uNormalSource", Source.Images[1], 1);
            Device.drawArrays(Device.TRIANGLES, 0, 3);
            const Swap = Source;
            Source = Destination;
            Destination = Swap;
        }
        this.BakeTarget = Source;
        this.BakeScratch = Destination;

        const Curvature = this.Programs.Curvature;
        Device.useProgram(Curvature.Program);
        Device.bindFramebuffer(Device.FRAMEBUFFER, this.FieldTarget);
        this.BindImage(Curvature, "uPositionSource", this.BakeTarget.Images[0], 0);
        this.BindImage(Curvature, "uNormalSource", this.BakeTarget.Images[1], 1);
        Device.uniform3fv(Curvature.Uniforms.get("uBoundsMinimum"), this.Surface.Bounds.Minimum);
        Device.uniform3fv(Curvature.Uniforms.get("uBoundsExtent"), this.Surface.Bounds.Extent);
        Device.drawArrays(Device.TRIANGLES, 0, 3);
        Device.bindVertexArray(null);
        Device.bindFramebuffer(Device.FRAMEBUFFER, null);
    }

    BindImage(Program, Name, Image, Unit)
    {
        const Device = this.Device;
        const Location = Program.Uniforms.get(Name);
        if (Location === undefined) return;
        Device.activeTexture(Device.TEXTURE0 + Unit);
        Device.bindTexture(Device.TEXTURE_2D, Image);
        Device.uniform1i(Location, Unit);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Per-layer images.
    //----------------------------------------------------------------------------------------------------------------------
    LayerRecord(Layer)
    {
        if (!this.LayerImages.has(Layer.Identifier)) this.LayerImages.set(Layer.Identifier, {});
        return this.LayerImages.get(Layer.Identifier);
    }

    // The sheet a layer paints on. Usually the document's, but a layer may carry its own so a decal sheet can be 4K
    // while the base fill stays at 1K; the compositor samples by coordinate, so the sizes never have to agree.
    LayerResolution(Layer)
    {
        return Layer?.Resolution ? Math.min(Layer.Resolution, this.MaximumResolution || 4096) : this.Resolution;
    }

    EnsureCoverage(Layer)
    {
        const Record = this.LayerRecord(Layer);
        const Size = this.LayerResolution(Layer);
        Record.Own = Layer.Resolution || 0;
        if (Record.Coverage && Record.CoverageSize !== Size) this.ResizeLayerImage(Record, "Coverage", Size);
        if (!Record.Coverage)
        {
            Record.Coverage = this.CreateColourImage(Size);
            Record.CoverageTarget = this.CreateTarget([Record.Coverage]);
            Record.CoverageSize = Size;
            this.ClearImage(Record.CoverageTarget, [0, 0, 0, 0]);
        }
        else if (!Record.CoverageTarget) Record.CoverageTarget = this.CreateTarget([Record.Coverage]);
        return Record;
    }

    // A layer that has only ever been painted with one set of channel values does not need images to hold them: the
    // one set is remembered on the record and uploaded as a constant, exactly as before. The moment a second set
    // arrives the layer is promoted — three images are allocated and filled with the values the existing paint was
    // laid down with, so nothing already on the sheet changes appearance, and from then on every dab writes per texel.
    PaintedLayer(Layer)
    {
        const Record = this.LayerImages.get(Layer.Identifier);
        return Boolean(Record && Record.Surfacing);
    }

    EnsurePaintwork(Layer)
    {
        const Record = this.EnsureCoverage(Layer);
        const Size = this.LayerResolution(Layer);
        if (Record.Surfacing && Record.SurfacingSize === Size) return Record;
        for (const Image of PaintedImages)
        {
            if (Record[Image.Slot] && Record[`${Image.Slot}Size`] !== Size) this.ResizeLayerImage(Record, Image.Slot, Size);
            if (Record[Image.Slot]) continue;
            Record[Image.Slot] = this.CreateColourImage(Size);
            Record[`${Image.Slot}Target`] = this.CreateTarget([Record[Image.Slot]]);
            Record[`${Image.Slot}Size`] = Size;
            this.ClearImage(Record[`${Image.Slot}Target`], [0, 0, 0, 0]);
        }
        Record.PaintTarget = null;
        return Record;
    }

    // One framebuffer naming all four painted images, so a single dab writes colour and channels in the same pass.
    PaintTarget(Record)
    {
        if (!Record.PaintTarget)
            Record.PaintTarget = this.CreateTarget([Record.Coverage, ...PaintedImages.map((Image) => Record[Image.Slot])]);
        return Record.PaintTarget;
    }

    // 📝 One image on its own. A colour mask is a piece of global state — it applies to every attachment a draw writes —
    //    so the only way to write roughness without touching base colour is to draw into one attachment at a time.
    SliceTarget(Record, Index)
    {
        if (!Record.SliceTargets) Record.SliceTargets = [];
        if (!Record.SliceTargets[Index])
        {
            const Image = Index === 0 ? Record.Coverage : Record[PaintedImages[Index - 1].Slot];
            Record.SliceTargets[Index] = this.CreateTarget([Image]);
        }
        return Record.SliceTargets[Index];
    }

    // Hands the paint already on the sheet the values it was laid down with. Every texel takes the same numbers, so
    // the pass is a clear rather than a draw: premultiplied by coverage is what the stamp writes, and a clear cannot
    // see the coverage — which is why the images are cleared to the value and then multiplied down by alpha with one
    // blended full-screen pass instead.
    SettlePaintwork(Layer, Values)
    {
        const Device = this.Device;
        const Record = this.EnsurePaintwork(Layer);
        const Program = this.Programs.Settle;
        const Size = (Record.CoverageSize || this.Resolution);
        Device.bindFramebuffer(Device.FRAMEBUFFER, this.SettleTarget(Record));
        Device.viewport(0, 0, Size, Size);
        Device.disable(Device.BLEND);
        Device.useProgram(Program.Program);
        Device.bindVertexArray(this.QuadArray);
        this.BindImage(Program, "uCoverageSource", Record.Coverage, 0);
        Device.uniform4fv(Program.Uniforms.get("uSettleSurfacing"), Values.slice(0, 4));
        Device.uniform4fv(Program.Uniforms.get("uSettleCoating"), Values.slice(4, 8));
        Device.uniform4fv(Program.Uniforms.get("uSettleRadiance"), Values.slice(8, 12));
        Device.drawArrays(Device.TRIANGLES, 0, 3);
        Device.bindVertexArray(null);
        Device.bindFramebuffer(Device.FRAMEBUFFER, null);
        return Record;
    }

    SettleTarget(Record)
    {
        if (!Record.SettleTarget) Record.SettleTarget = this.CreateTarget(PaintedImages.map((Image) => Record[Image.Slot]));
        return Record.SettleTarget;
    }

    // Changing a layer's resolution resamples what is already painted rather than throwing it away.
    ResizeLayerImage(Record, Slot, Size)
    {
        const Device = this.Device;
        const Previous = Record[Slot];
        const PreviousTarget = Record[`${Slot}Target`];
        const PreviousSize = Record[`${Slot}Size`] || this.Resolution;
        const Image = this.CreateColourImage(Size);
        const Target = this.CreateTarget([Image]);
        this.ClearImage(Target, [0, 0, 0, 0]);
        if (PreviousTarget && typeof Device.blitFramebuffer === "function")
        {
            Device.bindFramebuffer(Device.READ_FRAMEBUFFER, PreviousTarget);
            Device.bindFramebuffer(Device.DRAW_FRAMEBUFFER, Target);
            Device.blitFramebuffer(0, 0, PreviousSize, PreviousSize, 0, 0, Size, Size, Device.COLOR_BUFFER_BIT, Device.LINEAR);
            Device.bindFramebuffer(Device.READ_FRAMEBUFFER, null);
            Device.bindFramebuffer(Device.DRAW_FRAMEBUFFER, null);
        }
        if (PreviousTarget) Device.deleteFramebuffer(PreviousTarget);
        if (Previous) Device.deleteTexture(Previous);
        Record[Slot] = Image;
        Record[`${Slot}Target`] = Target;
        Record[`${Slot}Size`] = Size;
    }

    // A thumbnail of what a layer actually holds. Blitted down on the GPU and read back at a size the stack can
    // afford: sixty-four square is sixteen kilobytes a layer, so a deep stack still costs less than one snapshot.
    PreviewLayer(Layer, Target, Size = 64)
    {
        const Device = this.Device;
        if (!this.Ready || typeof Device.blitFramebuffer !== "function") return null;
        const Record = this.LayerImages.get(Layer.Identifier);
        const Surface = Target === "mask" ? Record?.MaskTarget : Record?.CoverageTarget;
        if (!Surface) return null;
        const Source = (Target === "mask" ? Record.MaskSize : Record.CoverageSize) || this.Resolution;
        if (!this.PreviewTarget || this.PreviewSize !== Size)
        {
            if (this.PreviewTarget) Device.deleteFramebuffer(this.PreviewTarget);
            if (this.PreviewImage) Device.deleteTexture(this.PreviewImage);
            this.PreviewImage = this.CreateColourImage(Size);
            this.PreviewTarget = this.CreateTarget([this.PreviewImage]);
            this.PreviewSize = Size;
            this.PreviewPixels = new Uint8Array(Size * Size * 4);
        }
        Device.bindFramebuffer(Device.READ_FRAMEBUFFER, Surface);
        Device.bindFramebuffer(Device.DRAW_FRAMEBUFFER, this.PreviewTarget);
        Device.blitFramebuffer(0, 0, Source, Source, 0, 0, Size, Size, Device.COLOR_BUFFER_BIT, Device.LINEAR);
        Device.bindFramebuffer(Device.DRAW_FRAMEBUFFER, null);
        Device.bindFramebuffer(Device.READ_FRAMEBUFFER, this.PreviewTarget);
        Device.readPixels(0, 0, Size, Size, Device.RGBA, Device.UNSIGNED_BYTE, this.PreviewPixels);
        Device.bindFramebuffer(Device.READ_FRAMEBUFFER, null);
        return { Pixels: this.PreviewPixels, Size };
    }

    EnsureMask(Layer)
    {
        const Record = this.LayerRecord(Layer);
        const Size = this.LayerResolution(Layer);
        Record.Own = Layer.Resolution || 0;
        if (Record.Mask && Record.MaskSize !== Size) this.ResizeLayerImage(Record, "Mask", Size);
        if (!Record.Mask)
        {
            Record.Mask = this.CreateColourImage(Size);
            Record.MaskTarget = this.CreateTarget([Record.Mask]);
            Record.MaskSize = Size;
            this.ClearImage(Record.MaskTarget, [0, 0, 0, 0]);
        }
        else if (!Record.MaskTarget) Record.MaskTarget = this.CreateTarget([Record.Mask]);
        return Record;
    }

    ReleaseLayer(Identifier)
    {
        const Device = this.Device;
        const Record = this.LayerImages.get(Identifier);
        if (!Record) return;
        for (const Slot of ["Coverage", ...PaintedSlots, "Mask", "Decal"]) if (Record[Slot]) Device.deleteTexture(Record[Slot]);
        for (const Slot of ["Coverage", ...PaintedSlots, "Mask"])
            if (Record[`${Slot}Target`]) Device.deleteFramebuffer(Record[`${Slot}Target`]);
        if (Record.PaintTarget) Device.deleteFramebuffer(Record.PaintTarget);
        for (const Slice of Record.SliceTargets || []) if (Slice) Device.deleteFramebuffer(Slice);
        this.LayerImages.delete(Identifier);
    }

    // Dropping a mask frees its image so the next one the layer is given starts from a clean sheet.
    ReleaseMask(Identifier)
    {
        const Record = this.LayerImages.get(Identifier);
        if (!Record) return;
        if (Record.Mask) this.Device.deleteTexture(Record.Mask);
        if (Record.MaskTarget) this.Device.deleteFramebuffer(Record.MaskTarget);
        Record.Mask = null;
        Record.MaskTarget = null;
    }

    ClearImage(Target, Colour)
    {
        const Device = this.Device;
        Device.bindFramebuffer(Device.FRAMEBUFFER, Target);
        Device.viewport(0, 0, this.Resolution, this.Resolution);
        Device.disable(Device.BLEND);
        Device.clearBufferfv(Device.COLOR, 0, new Float32Array(Colour));
        Device.bindFramebuffer(Device.FRAMEBUFFER, null);
    }

    SetDecalImage(Layer, Source)
    {
        const Device = this.Device;
        const Record = this.LayerRecord(Layer);
        if (Record.Decal) Device.deleteTexture(Record.Decal);
        const Image = Device.createTexture();
        Device.bindTexture(Device.TEXTURE_2D, Image);
        // 🔴 Flipped on the way in. The artwork is drawn on a canvas, whose first row is its TOP, and it is sampled in
        //    a frame whose V runs UP — so an unflipped upload hands back every decal mirrored through its own waist.
        Device.pixelStorei(Device.UNPACK_FLIP_Y_WEBGL, true);
        Device.pixelStorei(Device.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        Device.texImage2D(Device.TEXTURE_2D, 0, Device.RGBA8, Device.RGBA, Device.UNSIGNED_BYTE, Source);
        Device.texParameteri(Device.TEXTURE_2D, Device.TEXTURE_MIN_FILTER, Device.LINEAR_MIPMAP_LINEAR);
        Device.texParameteri(Device.TEXTURE_2D, Device.TEXTURE_MAG_FILTER, Device.LINEAR);
        Device.texParameteri(Device.TEXTURE_2D, Device.TEXTURE_WRAP_S, Device.CLAMP_TO_EDGE);
        Device.texParameteri(Device.TEXTURE_2D, Device.TEXTURE_WRAP_T, Device.CLAMP_TO_EDGE);
        Device.generateMipmap(Device.TEXTURE_2D);
        Device.bindTexture(Device.TEXTURE_2D, null);
        // The flip is device state, not texture state, and every other upload here hands over pixels that are already
        // the right way up — a restored undo snapshot among them — so it is put back before anything else can read it.
        Device.pixelStorei(Device.UNPACK_FLIP_Y_WEBGL, false);
        Record.Decal = Image;
        return Image;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Brush stamping.
    //----------------------------------------------------------------------------------------------------------------------
    Stamp(Layer, Options)
    {
        if (!this.Ready) return;
        const Device = this.Device;
        const Masking = Options.Target === "mask";
        // What this dab is carrying. A mask has no channel values of its own, and an eraser takes away whatever was
        // there rather than putting something down, so neither can make a layer grow images.
        const Values = Masking || Options.Erase ? null : PaintedVector(Options.Channels || Layer.Channels);
        let Record = Masking ? this.EnsureMask(Layer) : this.EnsureCoverage(Layer);
        if (Values)
        {
            if (!Record.Uniform && !Record.Surfacing) Record.Uniform = Values;
            else if (!Record.Surfacing && !PaintedVectorsAgree(Record.Uniform, Values))
            {
                // Second set of values on this layer: keep what is already down, then start recording per texel.
                Record = this.SettlePaintwork(Layer, Record.Uniform);
                Record.Uniform = null;
            }
        }
        // Which images this stroke may write. A mask has one image and no channels of its own, so it can honour
        // nothing finer than the stroke itself.
        const Wanted = !Masking && Options.Writes ? WriteOrdering(Options.Writes) : null;
        // 🔴 A layer whose channel values are still one set for the whole sheet cannot hold roughness in one place and
        //    not another, so a stroke that writes only some channels grows the layer's images before it lands. Without
        //    this the channel switches would simply do nothing on a fresh layer, which reads as a broken control.
        if (Wanted && !Wanted.Full && !Options.Erase && !Record.Surfacing)
        {
            Record = this.SettlePaintwork(Layer, Record.Uniform || PaintedVector(Options.Channels || Layer.Channels));
            Record.Uniform = null;
        }
        const Painted = !Masking && Boolean(Record.Surfacing);
        const Target = Masking ? Record.MaskTarget : Painted ? this.PaintTarget(Record) : Record.CoverageTarget;
        const Size = (Masking ? Record.MaskSize : Record.CoverageSize) || this.Resolution;
        const Program = this.Programs.Stamp;
        const Slices = Wanted && !Wanted.Full && Painted ? Wanted.Slots.filter((Slot) => Slot.Mask.some(Boolean)) : null;
        Device.bindFramebuffer(Device.FRAMEBUFFER, Target);
        Device.viewport(0, 0, Size, Size);
        Device.useProgram(Program.Program);
        Device.bindVertexArray(this.QuadArray);
        Device.enable(Device.BLEND);
        Device.blendEquation(Device.FUNC_ADD);
        if (Options.Erase) Device.blendFuncSeparate(Device.ZERO, Device.ONE_MINUS_SRC_ALPHA, Device.ZERO, Device.ONE_MINUS_SRC_ALPHA);
        else Device.blendFuncSeparate(Device.ONE, Device.ONE_MINUS_SRC_ALPHA, Device.ONE, Device.ONE_MINUS_SRC_ALPHA);
        this.BindImage(Program, "uPositionSource", this.BakeTarget.Images[0], 0);
        this.BindImage(Program, "uNormalSource", this.BakeTarget.Images[1], 1);
        const Uniforms = Program.Uniforms;
        Device.uniform3fv(Uniforms.get("uStrokeStart"), Options.Start);
        Device.uniform3fv(Uniforms.get("uStrokeEnd"), Options.End);
        Device.uniform3fv(Uniforms.get("uStrokeNormal"), Options.Normal);
        Device.uniform3fv(Uniforms.get("uStrokeColour"), Options.Colour || [1, 1, 1]);
        Device.uniform2fv(Uniforms.get("uStrokeStartPlane"), Options.StartPlane || [0, 0]);
        Device.uniform2fv(Uniforms.get("uStrokeEndPlane"), Options.EndPlane || [0, 0]);
        Device.uniform1f(Uniforms.get("uRadius"), Options.Radius);
        Device.uniform1f(Uniforms.get("uPlaneRadius"), Options.PlaneRadius || 0.05);
        Device.uniform1f(Uniforms.get("uHardness"), Options.Hardness);
        Device.uniform1f(Uniforms.get("uFlow"), Options.Flow);
        Device.uniform1f(Uniforms.get("uFacingLimit"), Options.FacingLimit ?? 0.1);
        Device.uniform1f(Uniforms.get("uAlphaJitter"), Options.Jitter || 0);
        const Carried = Values || new Float32Array(12);
        Device.uniform4fv(Uniforms.get("uPaintSurfacing"), Carried.slice(0, 4));
        Device.uniform4fv(Uniforms.get("uPaintCoating"), Carried.slice(4, 8));
        Device.uniform4fv(Uniforms.get("uPaintRadiance"), Carried.slice(8, 12));

        // The medium. `Media` is the profile MediaSolver built from the instrument in hand; with none in hand the
        // plain profile goes up instead, which is the soft round dab this pass has always drawn.
        const Media = MediaUniforms(Options.Media || PlainMedia, Options.Mode === "plane" ? Options.Span || 1 : 1);
        Device.uniform1i(Uniforms.get("uMedium"), Options.Erase ? 0 : Media.Medium);
        Device.uniform4fv(Uniforms.get("uMediaA"), Media.A);
        Device.uniform4fv(Uniforms.get("uMediaB"), Media.B);
        Device.uniform4fv(Uniforms.get("uMediaC"), Media.C);
        Device.uniform4fv(Uniforms.get("uMediaD"), Media.D);
        Device.uniform4fv(Uniforms.get("uStrokePress"), [
            Options.Press?.[0] ?? 1,
            Options.Press?.[1] ?? 1,
            Options.Travel?.[0] ?? 0,
            Options.Travel?.[1] ?? 0,
        ]);
        const Burn = Options.Mode === "decal" ? Options.Decal : null;
        const Gradient = Options.Mode === "gradient" ? Options.Gradient || {} : null;
        Device.uniform1i(
            Uniforms.get("uStampMode"),
            Gradient ? 3 : Options.Mode === "plane" ? 1 : Burn ? 2 : 0,
        );
        Device.uniform4fv(Uniforms.get("uGradient"), [
            Gradient?.Shape === "radial" ? 1 : 0,
            Math.max(0, GradientEasings.findIndex((Entry) => Entry.Identifier === (Gradient?.Easing || "smooth"))),
            Gradient?.Reverse ? 1 : 0,
            Gradient?.Through ? 1 : 0,
        ]);
        Device.uniform1f(Uniforms.get("uGradientEdge"), Gradient?.Softness ?? 0.5);
        this.BindImage(Program, "uStampDecal", (Burn && this.LayerImages.get(Burn.Layer)?.Decal) || this.BlankImage(), 2);
        Device.uniform3fv(Uniforms.get("uStampCentre"), Burn?.Position || [0, 0, 0]);
        Device.uniform3fv(Uniforms.get("uStampAxis"), Burn?.Normal || [0, 1, 0]);
        Device.uniform3fv(
            Uniforms.get("uStampEdge"),
            Burn ? RotateAround(Burn.Tangent, Burn.Normal, ((Burn.Rotation || 0) * Math.PI) / 180) : [1, 0, 0],
        );
        Device.uniform2fv(Uniforms.get("uStampSpan"), Burn?.Size || [0.2, 0.2]);
        Device.uniform1f(Uniforms.get("uStampReach"), Burn?.Depth ?? 0.45);
        Device.uniform1f(Uniforms.get("uStampSoftness"), Burn?.Softness ?? 0.06);
        Device.uniform1f(Uniforms.get("uStampColourise"), Burn?.Colorise ? 1 : 0);
        if (Slices)
        {
            // One draw per image the stroke is allowed into, with the components it may touch switched on. The chosen
            // image is routed to location 0, so every draw writes exactly one attachment.
            for (const Slice of Slices)
            {
                Device.bindFramebuffer(Device.FRAMEBUFFER, this.SliceTarget(Record, Slice.Index));
                Device.uniform1i(Uniforms.get("uSlot"), Slice.Index);
                Device.colorMask(...Slice.Mask);
                Device.drawArrays(Device.TRIANGLES, 0, 3);
                this.Statistics.Stamps += 1;
            }
            Device.colorMask(true, true, true, true);
            Device.uniform1i(Uniforms.get("uSlot"), -1);
        }
        else
        {
            Device.uniform1i(Uniforms.get("uSlot"), -1);
            Device.drawArrays(Device.TRIANGLES, 0, 3);
            this.Statistics.Stamps += 1;
        }
        Device.disable(Device.BLEND);
        Device.bindVertexArray(null);
        Device.bindFramebuffer(Device.FRAMEBUFFER, null);
    }

    // A flood is a dab the size of the sheet, so it carries channel values exactly as a stroke does.
    FloodLayer(Layer, Target, Colour, Alpha, Channels = null)
    {
        const Masking = Target === "mask";
        const Values = Masking ? null : PaintedVector(Channels || Layer.Channels);
        let Record = Masking ? this.EnsureMask(Layer) : this.EnsureCoverage(Layer);
        if (Values)
        {
            if (!Record.Uniform && !Record.Surfacing) Record.Uniform = Values;
            else if (!Record.Surfacing && !PaintedVectorsAgree(Record.Uniform, Values))
            {
                Record = this.SettlePaintwork(Layer, Record.Uniform);
                Record.Uniform = null;
            }
        }
        const Surface = Masking ? Record.MaskTarget : Record.CoverageTarget;
        this.ClearImage(Surface, [Colour[0] * Alpha, Colour[1] * Alpha, Colour[2] * Alpha, Alpha]);
        if (Values && Record.Surfacing)
            PaintedImages.forEach((Image, Which) =>
                this.ClearImage(Record[`${Image.Slot}Target`], [
                    Values[Which * 4] * Alpha,
                    Values[Which * 4 + 1] * Alpha,
                    Values[Which * 4 + 2] * Alpha,
                    Values[Which * 4 + 3] * Alpha,
                ]),
            );
    }

    SettledValues(Layer)
    {
        const Record = this.LayerImages.get(Layer?.Identifier);
        return Record?.Coverage && Record.Uniform ? Record.Uniform : null;
    }

    RestoreSettled(Layer, Values)
    {
        const Record = this.LayerRecord(Layer);
        if (Record.Surfacing) return;
        Record.Uniform = Float32Array.from(Values);
    }

    // Hands every texel on the layer the same channel values, which is the way back from per-stroke to one material.
    LevelLayer(Layer, Channels = null)
    {
        const Record = this.LayerImages.get(Layer.Identifier);
        if (!Record?.Coverage) return false;
        this.DropPaintwork(Record);
        Record.Uniform = PaintedVector(Channels || Layer.Channels);
        return true;
    }

    // Lets go of the three channel images, which is how a layer stops being per-texel: on levelling, and on stepping
    // back to a snapshot taken before it was ever promoted.
    DropPaintwork(Record)
    {
        if (!Record?.Surfacing) return false;
        for (const Image of PaintedImages)
        {
            if (Record[Image.Slot]) this.Device.deleteTexture(Record[Image.Slot]);
            if (Record[`${Image.Slot}Target`]) this.Device.deleteFramebuffer(Record[`${Image.Slot}Target`]);
            Record[Image.Slot] = null;
            Record[`${Image.Slot}Target`] = null;
            Record[`${Image.Slot}Size`] = 0;
        }
        if (Record.PaintTarget) this.Device.deleteFramebuffer(Record.PaintTarget);
        if (Record.SettleTarget) this.Device.deleteFramebuffer(Record.SettleTarget);
        Record.PaintTarget = null;
        Record.SettleTarget = null;
        return true;
    }

    // `coverage` and `mask` are the two sheets a document has always carried; the painted channel images answer to
    // their own names so a saved file can hold them too. Reading the coverage also gathers them, because undo has to
    // put a stroke's channel values back along with its colour or the two drift apart.
    SlotForTarget(Target)
    {
        if (Target === "mask") return "Mask";
        return PaintedSlotForTarget[Target] || "Coverage";
    }

    SnapshotLayer(Layer, Target, Gather = true)
    {
        const Device = this.Device;
        const Record = this.LayerImages.get(Layer.Identifier);
        const Slot = this.SlotForTarget(Target);
        const Surface = Record?.[`${Slot}Target`];
        if (!Surface) return null;
        const Size = Record[`${Slot}Size`] || this.Resolution;
        const Pixels = new Uint8Array(Size * Size * 4);
        Device.bindFramebuffer(Device.FRAMEBUFFER, Surface);
        Device.readPixels(0, 0, Size, Size, Device.RGBA, Device.UNSIGNED_BYTE, Pixels);
        Device.bindFramebuffer(Device.FRAMEBUFFER, null);
        const Snapshot = { Pixels, Resolution: Size };
        if (Slot === "Coverage")
        {
            Snapshot.Uniform = Record.Uniform ? Float32Array.from(Record.Uniform) : null;
            if (Gather && Record.Surfacing)
                Snapshot.Paintwork = PaintedImages.map((Image) => ({
                    Slot: Image.Slot,
                    Pixels: this.SnapshotLayer(Layer, Image.Target, false)?.Pixels || null,
                }));
        }
        return Snapshot;
    }

    RestoreLayer(Layer, Target, Snapshot)
    {
        const Device = this.Device;
        const Slot = this.SlotForTarget(Target);
        const Record =
            Slot === "Mask" ? this.EnsureMask(Layer) : Slot === "Coverage" ? this.EnsureCoverage(Layer) : this.EnsurePaintwork(Layer);
        const Size = Record[`${Slot}Size`] || this.Resolution;
        if (!Snapshot || Snapshot.Resolution !== Size) return;
        const Write = (Image, Pixels) =>
        {
            if (!Image || !Pixels) return;
            Device.bindTexture(Device.TEXTURE_2D, Image);
            Device.texSubImage2D(Device.TEXTURE_2D, 0, 0, 0, Size, Size, Device.RGBA, Device.UNSIGNED_BYTE, Pixels);
            Device.bindTexture(Device.TEXTURE_2D, null);
        };
        Write(Record[Slot], Snapshot.Pixels);
        if (Slot !== "Coverage") return;
        if (Snapshot.Paintwork)
        {
            const Grown = this.EnsurePaintwork(Layer);
            for (const Entry of Snapshot.Paintwork) Write(Grown[Entry.Slot], Entry.Pixels);
            Grown.Uniform = null;
        }
        else if (Snapshot.Uniform !== undefined)
        {
            // 🔴 Stepping back past the promotion has to let go of the images as well. Leaving them in place would
            //    leave the compositor reading channel values from a stroke that has just been undone.
            this.DropPaintwork(Record);
            Record.Uniform = Snapshot.Uniform ? Float32Array.from(Snapshot.Uniform) : null;
        }
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Compositing the stack.
    //----------------------------------------------------------------------------------------------------------------------
    Composite(Layers, Material)
    {
        if (!this.Ready || !this.Surface) return;
        const Device = this.Device;
        const Started = performance.now();
        const Program = this.Programs.Composite;
        const Size = this.Resolution;
        Device.viewport(0, 0, Size, Size);
        Device.disable(Device.BLEND);
        Device.disable(Device.DEPTH_TEST);

        // Seed the lower set with the channel defaults so an empty stack still reads as a sane surface.
        const Defaults = [
            [...ChannelDefault("base_color"), ChannelDefault("geometry_opacity")],
            [ChannelDefault("specular_roughness"), ChannelDefault("base_metalness"), ChannelDefault("ambient_occlusion"), ChannelDefault("height")],
            [ChannelDefault("specular_weight"), ChannelDefault("coat_weight"), ChannelDefault("coat_roughness"), ChannelDefault("fuzz_weight")],
            [...ChannelDefault("emission_color"), ChannelDefault("transmission_weight")],
        ];
        let Source = this.ChannelTargets[0];
        let Destination = this.ChannelTargets[1];
        Device.bindFramebuffer(Device.FRAMEBUFFER, Source);
        Defaults.forEach((Values, Index) => Device.clearBufferfv(Device.COLOR, Index, new Float32Array(Values)));

        Device.useProgram(Program.Program);
        Device.bindVertexArray(this.QuadArray);
        const Visible = Layers.filter((Layer) => Layer.Visible && Layer.Opacity > 0.0005);
        // A decal layer is composited once per placement: same artwork, same mask, its own frame and colour.
        const Passes = [];
        for (const Layer of Visible)
        {
            // A mark that has never been clicked onto the model is not composited; the preview shows where it would land.
            const Marks =
                Layer.Kind === "decal"
                    ? (Layer.Decal?.Marks || []).filter((Mark) => Mark.Visible !== false && Mark.Placed !== false)
                    : [];
            // Burned-in decals live in the layer's coverage image and composite like paint, under its projectors.
            if (Layer.Kind === "decal" && this.LayerImages.get(Layer.Identifier)?.Coverage) Passes.push({ Layer, Mark: null, Painted: true });
            if (Marks.length) for (const Mark of Marks) Passes.push({ Layer, Mark });
            else if (Layer.Kind !== "decal") Passes.push({ Layer, Mark: null });
        }
        for (const { Layer, Mark, Painted } of Passes)
        {
            Device.bindFramebuffer(Device.FRAMEBUFFER, Destination);
            this.BindImage(Program, "uLower0", Source.Images[0], 0);
            this.BindImage(Program, "uLower1", Source.Images[1], 1);
            this.BindImage(Program, "uLower2", Source.Images[2], 2);
            this.BindImage(Program, "uLower3", Source.Images[3], 3);
            this.BindImage(Program, "uPositionMap", this.BakeTarget.Images[0], 4);
            this.BindImage(Program, "uNormalMap", this.BakeTarget.Images[1], 5);
            this.BindImage(Program, "uFieldMap", this.FieldTarget.Images[0], 6);
            const Record = this.LayerImages.get(Layer.Identifier) || {};
            this.BindImage(Program, "uCoverageMap", Record.Coverage || this.BlankImage(), 7);
            this.BindImage(Program, "uDecalMap", Record.Decal || this.BlankImage(), 8);
            this.BindImage(Program, "uMaskMap", Record.Mask || this.WhiteImage(), 9);
            this.BindImage(Program, "uSurfacingMap", Record.Surfacing || this.BlankImage(), 10);
            this.BindImage(Program, "uCoatingMap", Record.Coating || this.BlankImage(), 11);
            this.BindImage(Program, "uRadianceMap", Record.Radiance || this.BlankImage(), 12);
            this.UploadLayerUniforms(Program, Layer, Material, Mark, Painted);
            Device.drawArrays(Device.TRIANGLES, 0, 3);
            const Swap = Source;
            Source = Destination;
            Destination = Swap;
        }
        this.ChannelIndex = this.ChannelTargets.indexOf(Source);
        Device.bindVertexArray(null);
        Device.bindFramebuffer(Device.FRAMEBUFFER, null);
        this.Statistics.Composites += 1;
        this.Statistics.Layers = Visible.length;
        this.Statistics.Passes = Passes.length;
        this.Statistics.CompositeMicroseconds = Math.round((performance.now() - Started) * 1000);
    }

    UploadLayerUniforms(Program, Layer, Material, Mark = null, Painted = false)
    {
        const Device = this.Device;
        const Uniforms = Program.Uniforms;
        const KindIndex = Painted ? 1 : ({ fill: 0, stroke: 1, decal: 2, generator: 3, finish: 4 }[Layer.Kind] ?? 0);
        Device.uniform1i(Uniforms.get("uKind"), KindIndex);
        Device.uniform1i(Uniforms.get("uBlend"), BlendIndex(Layer.Blend));
        Device.uniform1f(Uniforms.get("uOpacity"), Layer.Opacity);
        const Enabled = new Float32Array(12);
        ChannelSpecification.forEach((Channel, Index) => (Enabled[Index] = Layer.Enabled[Channel.Identifier] ? 1 : 0));
        Device.uniform1fv(Uniforms.get("uEnabled"), Enabled);

        // A painted layer keeps its channel values with the paint. Where that is one set for the whole layer it is
        // held on the record and sent as constants; where the strokes disagree it is in the images and `uPainted`
        // tells the shader to read them. Either way the inspector's current reading describes the *next* stroke, so
        // it must not be what an already-painted texel is composited with.
        const Record = this.LayerImages.get(Layer.Identifier);
        const Laid = KindIndex === 1 ? Record?.Uniform : null;
        const Channels = Mark?.Channels || Layer.Channels;
        Device.uniform1f(Uniforms.get("uPainted"), KindIndex === 1 && Record?.Surfacing ? 1 : 0);
        Device.uniform3fv(Uniforms.get("uBaseColour"), Channels.base_color);
        Device.uniform3fv(
            Uniforms.get("uEmissionColour"),
            Laid ? [Laid[8], Laid[9], Laid[10]] : Channels.emission_color,
        );
        const Scalars = Laid
            ? new Float32Array([Laid[0], Laid[1], Laid[2], Laid[3], Laid[4], Laid[5], Laid[6], Laid[7], Laid[11], Channels.geometry_opacity])
            : new Float32Array([
                  Channels.specular_roughness,
                  Channels.base_metalness,
                  Channels.ambient_occlusion,
                  Channels.height,
                  Channels.specular_weight,
                  Channels.coat_weight,
                  Channels.coat_roughness,
                  Channels.fuzz_weight,
                  Channels.transmission_weight,
                  Channels.geometry_opacity,
              ]);
        Device.uniform1fv(Uniforms.get("uScalar"), Scalars);

        const Scale = Material?.texture_scale ?? 1;
        const Generator = Layer.Generator;
        Device.uniform1i(Uniforms.get("uGeneratorKind"), GeneratorIndex(Generator.Kind));
        Device.uniform4f(Uniforms.get("uGeneratorA"), Generator.Scale * Scale, Generator.Detail, Generator.Contrast, Generator.Balance);
        Device.uniform4f(Uniforms.get("uGeneratorB"), Generator.Warp, Generator.Angle, Generator.Seed, Generator.Invert ? 1 : 0);

        const Mask = Layer.Mask;
        const MaskKind = MaskKindIndex(Mask.Kind);
        Device.uniform1i(Uniforms.get("uMaskKind"), MaskKind);
        Device.uniform1i(Uniforms.get("uMaskField"), GeneratorIndex(Mask.Generator.Kind));
        Device.uniform4f(
            Uniforms.get("uMaskA"),
            Mask.Generator.Scale * Scale,
            Mask.Generator.Detail,
            Mask.Generator.Contrast,
            Mask.Generator.Balance,
        );
        Device.uniform4f(Uniforms.get("uMaskB"), Mask.Generator.Warp, Mask.Generator.Angle, Mask.Generator.Seed, Mask.Generator.Invert ? 1 : 0);
        Device.uniform1f(Uniforms.get("uMaskInvert"), Mask.Invert ? 1 : 0);
        Device.uniform3fv(Uniforms.get("uMaskColour"), Mask.Colour || [0.82, 0.12, 0.14]);
        Device.uniform1f(Uniforms.get("uMaskTolerance"), Mask.Tolerance ?? 0.25);
        Device.uniform1f(Uniforms.get("uMaskSoftness"), Mask.Softness ?? 0.12);

        const Finish = Layer.Finish;
        if (Finish)
        {
            Device.uniform1i(Uniforms.get("uFinishFamily"), FinishFamilyIndex(Finish.Family));
            Device.uniform1i(Uniforms.get("uFinishStyle"), FinishStyleIndex(Finish.Family, Finish.Style));
            Device.uniform3fv(Uniforms.get("uFinishColourA"), Finish.ColourA);
            Device.uniform3fv(Uniforms.get("uFinishColourB"), Finish.ColourB);
            Device.uniform4f(Uniforms.get("uFinishShape"), Finish.Scale * Scale, Finish.Density, Finish.Strength, Finish.Gloss);
            Device.uniform4f(Uniforms.get("uFinishTrim"), Finish.Coat, Finish.Angle, Finish.Variation, Finish.Seed);
            // The height range travels with the finish: a flake's facet is a slope in millimetres, and the channel it
            // is written into only means millimetres because the material says how many.
            Device.uniform4f(
                Uniforms.get("uFinishExtra"),
                Finish.Peel ?? 0.3,
                Finish.Flake ?? 6,
                Finish.Tilt ?? 0.55,
                Material?.height_scale ?? 4,
            );
        }

        // Layer scope: the UDIM tile of the object the layer belongs to, or the whole sheet when it belongs to the scene.
        const Range = Layer.Object ? (this.Surface?.Ranges || []).find((Entry) => Entry.Identifier === Layer.Object) : null;
        if (Range)
        {
            const Rectangle = TileRectangle(Range.Tile, this.Surface.Tiles?.Columns || 1);
            Device.uniform4f(Uniforms.get("uScope"), Rectangle.Left, Rectangle.Bottom, Rectangle.Size, 1);
        }
        else Device.uniform4f(Uniforms.get("uScope"), 0, 0, 1, 0);

        const Decal = Mark || Layer.Decal;
        const Transform = Decal.Transform;
        Device.uniform1i(Uniforms.get("uDecalMode"), Decal.Mode === "plane" ? 1 : 0);
        Device.uniform3fv(Uniforms.get("uDecalPosition"), Transform.Position);
        Device.uniform3fv(Uniforms.get("uDecalNormal"), Transform.Normal);
        Device.uniform3fv(Uniforms.get("uDecalTangent"), RotateAround(Transform.Tangent, Transform.Normal, (Transform.Rotation * Math.PI) / 180));
        Device.uniform2f(Uniforms.get("uDecalSize"), Transform.Size, Transform.Size / Math.max(Transform.Aspect, 0.05));
        Device.uniform1f(Uniforms.get("uDecalDepth"), Transform.Depth);
        Device.uniform1f(Uniforms.get("uDecalFacing"), Math.cos((Transform.AngleLimit * Math.PI) / 180));
        Device.uniform1f(Uniforms.get("uDecalSoftness"), Decal.Softness);
        Device.uniform4f(Uniforms.get("uDecalPlane"), Decal.Plane.Centre[0], Decal.Plane.Centre[1], Decal.Plane.Size, Decal.Plane.Rotation);
        Device.uniform1f(Uniforms.get("uDecalPlaneAspect"), Decal.Plane.Aspect || 1);
        Device.uniform3fv(Uniforms.get("uDecalTint"), Decal.Tint);
        Device.uniform1f(Uniforms.get("uDecalColorise"), Decal.Colorise ? 1 : 0);
        Device.uniform1f(Uniforms.get("uDecalEmboss"), Decal.Emboss);
    }

    // The mask inspection draws whichever layer is selected. Painted masks live in an image already; generator and colour
    // masks do not exist anywhere until they are evaluated, so this pass resolves whichever kind the layer carries.
    RefreshMaskPreview(Layer, Material)
    {
        if (!this.Ready || !this.MaskPreviewTarget) return;
        if (!Layer || !Layer.Mask || Layer.Mask.Kind === "none")
        {
            this.MaskPreviewLayer = "";
            return;
        }
        const Device = this.Device;
        const Program = this.Programs.Mask;
        const Size = this.Resolution;
        Device.bindFramebuffer(Device.FRAMEBUFFER, this.MaskPreviewTarget);
        Device.viewport(0, 0, Size, Size);
        Device.disable(Device.BLEND);
        Device.disable(Device.DEPTH_TEST);
        Device.useProgram(Program.Program);
        Device.bindVertexArray(this.QuadArray);
        const Record = this.LayerImages.get(Layer.Identifier) || {};
        this.BindImage(Program, "uMaskMap", Record.Mask || this.BlankImage(), 0);
        this.BindImage(Program, "uLower0", this.ChannelImages[0], 1);
        this.BindImage(Program, "uPositionMap", this.BakeTarget.Images[0], 2);
        this.BindImage(Program, "uNormalMap", this.BakeTarget.Images[1], 3);
        this.BindImage(Program, "uFieldMap", this.FieldTarget.Images[0], 4);
        const Uniforms = Program.Uniforms;
        const Mask = Layer.Mask;
        const Scale = Material?.texture_scale ?? 1;
        Device.uniform1i(Uniforms.get("uMaskKind"), MaskKindIndex(Mask.Kind));
        Device.uniform1i(Uniforms.get("uMaskField"), GeneratorIndex(Mask.Generator.Kind));
        Device.uniform4f(
            Uniforms.get("uMaskA"),
            Mask.Generator.Scale * Scale,
            Mask.Generator.Detail,
            Mask.Generator.Contrast,
            Mask.Generator.Balance,
        );
        Device.uniform4f(Uniforms.get("uMaskB"), Mask.Generator.Warp, Mask.Generator.Angle, Mask.Generator.Seed, Mask.Generator.Invert ? 1 : 0);
        Device.uniform1f(Uniforms.get("uMaskInvert"), Mask.Invert ? 1 : 0);
        Device.uniform3fv(Uniforms.get("uMaskColour"), Mask.Colour || [0.82, 0.12, 0.14]);
        Device.uniform1f(Uniforms.get("uMaskTolerance"), Mask.Tolerance ?? 0.25);
        Device.uniform1f(Uniforms.get("uMaskSoftness"), Mask.Softness ?? 0.12);
        Device.drawArrays(Device.TRIANGLES, 0, 3);
        Device.bindVertexArray(null);
        Device.bindFramebuffer(Device.FRAMEBUFFER, null);
        this.MaskPreviewLayer = Layer.Identifier;
    }

    MaskImage(Identifier)
    {
        if (Identifier && this.MaskPreviewLayer === Identifier && this.MaskPreviewTarget) return this.MaskPreviewTarget.Images[0];
        const Record = Identifier ? this.LayerImages.get(Identifier) : null;
        return Record?.Mask || this.WhiteImage();
    }

    BlankImage()
    {
        if (!this.Blank)
        {
            this.Blank = this.CreateColourImage(1);
            const Target = this.CreateTarget([this.Blank]);
            const Device = this.Device;
            Device.bindFramebuffer(Device.FRAMEBUFFER, Target);
            Device.viewport(0, 0, 1, 1);
            Device.clearBufferfv(Device.COLOR, 0, new Float32Array([0, 0, 0, 0]));
            Device.bindFramebuffer(Device.FRAMEBUFFER, null);
            Device.deleteFramebuffer(Target);
        }
        return this.Blank;
    }

    WhiteImage()
    {
        if (!this.White)
        {
            this.White = this.CreateColourImage(1);
            const Target = this.CreateTarget([this.White]);
            const Device = this.Device;
            Device.bindFramebuffer(Device.FRAMEBUFFER, Target);
            Device.viewport(0, 0, 1, 1);
            Device.clearBufferfv(Device.COLOR, 0, new Float32Array([1, 1, 1, 1]));
            Device.bindFramebuffer(Device.FRAMEBUFFER, null);
            Device.deleteFramebuffer(Target);
        }
        return this.White;
    }

    get ChannelImages()
    {
        return this.ChannelTargets[this.ChannelIndex].Images;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Environment and material uniforms shared by the viewport and background programs.
    //----------------------------------------------------------------------------------------------------------------------
    UploadEnvironment(Program, Environment, Material)
    {
        const Device = this.Device;
        const Uniforms = Program.Uniforms;
        const Preset = EnvironmentByIdentifier[Environment.Identifier] || EnvironmentByIdentifier.studio;
        const Rotation = (Environment.Rotation * Math.PI) / 180;
        const Directions = [
            [Math.sin(Rotation + 0.6) * 0.62, 0.72, Math.cos(Rotation + 0.6) * 0.62],
            [Math.sin(Rotation - 1.9) * 0.84, 0.22, Math.cos(Rotation - 1.9) * 0.84],
            [Math.sin(Rotation + 2.7) * 0.72, 0.44, Math.cos(Rotation + 2.7) * 0.72],
        ].map((Direction) =>
        {
            const Length = Math.hypot(...Direction) || 1;
            return Direction.map((Component) => Component / Length);
        });
        const Radiance = [
            [Preset.Key, Preset.Key * 0.97, Preset.Key * 0.92],
            [Preset.Fill * 0.82, Preset.Fill * 0.88, Preset.Fill],
            [Preset.Rim * 0.92, Preset.Rim * 0.95, Preset.Rim],
        ];
        Device.uniform3fv(Uniforms.get("uSkyZenith"), Preset.Zenith);
        Device.uniform3fv(Uniforms.get("uSkyHorizon"), Preset.Horizon);
        Device.uniform3fv(Uniforms.get("uSkyGround"), Preset.Ground);
        Device.uniform3fv(Uniforms.get("uLightDirection"), new Float32Array(Directions.flat()));
        Device.uniform3fv(Uniforms.get("uLightRadiance"), new Float32Array(Radiance.flat()));
        Device.uniform1f(Uniforms.get("uEnvironmentIntensity"), Environment.Intensity);
        Device.uniform1f(Uniforms.get("uExposure"), Environment.Exposure);
    }

    NormalGain(Material)
    {
        const Radius = this.Surface?.Bounds.Radius || 1;
        return ((Material.normal_intensity * Material.height_scale) / 1000) * (this.Resolution / (2 * Radius)) * 1.6;
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Viewport.
    //----------------------------------------------------------------------------------------------------------------------
    RenderViewport(Camera, Options)
    {
        if (!this.Ready || !this.Surface) return;
        const Device = this.Device;
        const Width = this.Canvas.width;
        const Height = this.Canvas.height;
        Device.bindFramebuffer(Device.FRAMEBUFFER, null);
        Device.viewport(0, 0, Width, Height);
        Device.disable(Device.BLEND);

        const Background = this.Programs.Background;
        Device.useProgram(Background.Program);
        Device.bindVertexArray(this.QuadArray);
        Device.disable(Device.DEPTH_TEST);
        Device.depthMask(false);
        this.UploadEnvironment(Background, Options.Environment, Options.Material);
        const TangentHalf = Math.tan(Camera.FieldOfView / 2);
        Device.uniform3fv(Background.Uniforms.get("uRayOrigin"), Camera.Position);
        Device.uniform3fv(Background.Uniforms.get("uRayForward"), Camera.Forward);
        Device.uniform3fv(
            Background.Uniforms.get("uRayRight"),
            Camera.Right.map((Component) => Component * TangentHalf * Camera.Aspect),
        );
        Device.uniform3fv(
            Background.Uniforms.get("uRayUp"),
            Camera.Up.map((Component) => Component * TangentHalf),
        );
        Device.uniform1f(Background.Uniforms.get("uBackgroundVisible"), Options.Environment.Background ? 1 : 0);
        Device.drawArrays(Device.TRIANGLES, 0, 3);

        const Shade = this.Programs.Shade;
        Device.useProgram(Shade.Program);
        Device.enable(Device.DEPTH_TEST);
        Device.depthMask(true);
        Device.depthFunc(Device.LEQUAL);
        Device.clear(Device.DEPTH_BUFFER_BIT);
        Device.bindVertexArray(this.SurfaceArray);
        const Images = this.ChannelImages;
        this.BindImage(Shade, "uChannel0", Images[0], 0);
        this.BindImage(Shade, "uChannel1", Images[1], 1);
        this.BindImage(Shade, "uChannel2", Images[2], 2);
        this.BindImage(Shade, "uChannel3", Images[3], 3);
        this.BindImage(Shade, "uField", this.FieldTarget.Images[0], 4);
        this.BindImage(Shade, "uMaskPreview", this.MaskImage(Options.MaskLayer), 5);
        this.UploadEnvironment(Shade, Options.Environment, Options.Material);
        const Uniforms = Shade.Uniforms;
        Device.uniformMatrix4fv(Uniforms.get("uViewClip"), false, Camera.ViewClip);
        Device.uniform3fv(Uniforms.get("uViewPosition"), Camera.Position);
        Device.uniform1f(Uniforms.get("uNormalGain"), this.NormalGain(Options.Material));
        Device.uniform1f(Uniforms.get("uDisplay"), Options.Display);
        Device.uniform1f(Uniforms.get("uCheckerScale"), Options.CheckerScale || 16);
        Device.uniform3fv(Uniforms.get("uMaskTint"), Options.MaskTint || [0.95, 0.22, 0.3]);
        const Material = Options.Material;
        Device.uniform1f(Uniforms.get("uDiffuseRoughness"), Material.base_diffuse_roughness);
        Device.uniform3fv(Uniforms.get("uSpecularColour"), Material.specular_color);
        Device.uniform1f(Uniforms.get("uSpecularIor"), Material.specular_ior);
        Device.uniform1f(Uniforms.get("uAnisotropy"), Material.specular_roughness_anisotropy);
        Device.uniform3fv(Uniforms.get("uCoatColour"), Material.coat_color);
        Device.uniform1f(Uniforms.get("uCoatIor"), Material.coat_ior);
        Device.uniform1f(Uniforms.get("uCoatDarkening"), Material.coat_darkening);
        Device.uniform3fv(Uniforms.get("uFuzzColour"), Material.fuzz_color);
        Device.uniform1f(Uniforms.get("uFuzzRoughness"), Material.fuzz_roughness);
        Device.uniform1f(Uniforms.get("uEmissionLuminance"), Material.emission_luminance);
        Device.uniform3fv(Uniforms.get("uTransmissionColour"), Material.transmission_color);
        Device.uniform1f(Uniforms.get("uTransmissionDepth"), Material.transmission_depth);
        Device.uniform1f(Uniforms.get("uThinFilmWeight"), Material.thin_film_weight);
        Device.uniform1f(Uniforms.get("uThinFilmThickness"), Material.thin_film_thickness);
        Device.uniform1f(Uniforms.get("uThinFilmIor"), Material.thin_film_ior);
        const Cursor = Options.Cursor;
        Device.uniform1f(Uniforms.get("uBrushVisible"), Cursor ? 1 : 0);
        Device.uniform3fv(Uniforms.get("uBrushCentre"), Cursor ? Cursor.Position : [0, 0, 0]);
        Device.uniform3fv(Uniforms.get("uBrushNormal"), Cursor ? Cursor.Normal : [0, 1, 0]);
        Device.uniform1f(Uniforms.get("uBrushRadius"), Cursor ? Cursor.Radius : 0);
        Device.uniform1f(Uniforms.get("uBrushHardness"), Cursor ? Cursor.Hardness : 0.5);
        Device.uniform3fv(Uniforms.get("uBrushInk"), Cursor?.Ink || [1, 1, 1]);
        Device.uniform1f(Uniforms.get("uBrushPreview"), Cursor?.Preview ?? 0);

        // Symmetry, drawn rather than described: the mirrored cursor and the seam where the plane cuts the model.
        const Radial = Options.Symmetry === "radial";
        const Mirror = Radial ? [0, 1, 0] : { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[Options.Symmetry] || null;
        Device.uniform4f(Uniforms.get("uMirror"), ...(Mirror || [0, 0, 0]), Radial ? 2 : Mirror ? 1 : 0);
        Device.uniform1f(Uniforms.get("uMirrorSpan"), this.Surface?.Bounds?.Radius || 1);
        Device.uniform1f(Uniforms.get("uMirrorSectors"), Math.max(Options.Sectors || 6, 2));

        // Where the decal in hand would land.
        const Place = Options.Placement;
        const PlaceImage = Place ? this.LayerImages.get(Place.Layer)?.Decal : null;
        this.BindImage(Shade, "uDecalPreview", PlaceImage || this.BlankImage(), 6);
        Device.uniform1f(Uniforms.get("uPlaceVisible"), Place && PlaceImage ? 1 : 0);
        Device.uniform3fv(Uniforms.get("uPlacePosition"), Place?.Position || [0, 0, 0]);
        Device.uniform3fv(Uniforms.get("uPlaceNormal"), Place?.Normal || [0, 1, 0]);
        Device.uniform3fv(
            Uniforms.get("uPlaceTangent"),
            Place ? RotateAround(Place.Tangent, Place.Normal, ((Place.Rotation || 0) * Math.PI) / 180) : [1, 0, 0],
        );
        Device.uniform2fv(Uniforms.get("uPlaceSize"), Place?.Size || [0.2, 0.2]);
        Device.uniform3fv(Uniforms.get("uPlaceTint"), Place?.Tint || [1, 1, 1]);
        Device.uniform1f(Uniforms.get("uPlaceColorise"), Place?.Colorise ? 1 : 0);
        Device.drawElements(Device.TRIANGLES, this.Surface.Indices.length, Device.UNSIGNED_INT, 0);
        Device.bindVertexArray(null);
    }

    RenderPlane(Options)
    {
        if (!this.Ready) return;
        const Device = this.Device;
        Device.bindFramebuffer(Device.FRAMEBUFFER, null);
        Device.viewport(0, 0, this.Canvas.width, this.Canvas.height);
        Device.disable(Device.DEPTH_TEST);
        Device.disable(Device.BLEND);
        const Program = this.Programs.Plane;
        Device.useProgram(Program.Program);
        Device.bindVertexArray(this.QuadArray);
        const Images = this.ChannelImages;
        this.BindImage(Program, "uChannel0", Images[0], 0);
        this.BindImage(Program, "uChannel1", Images[1], 1);
        this.BindImage(Program, "uChannel2", Images[2], 2);
        this.BindImage(Program, "uChannel3", Images[3], 3);
        this.BindImage(Program, "uField", this.FieldTarget.Images[0], 4);
        this.BindImage(Program, "uMaskPreview", this.MaskImage(Options.MaskLayer), 5);
        Device.uniform2fv(Program.Uniforms.get("uPan"), Options.Pan);
        Device.uniform1f(Program.Uniforms.get("uZoom"), Options.Zoom);
        Device.uniform1f(Program.Uniforms.get("uAspect"), this.Canvas.width / Math.max(this.Canvas.height, 1));
        Device.uniform1f(Program.Uniforms.get("uDisplay"), Options.Display);
        Device.uniform1f(Program.Uniforms.get("uNormalGain"), this.NormalGain(Options.Material));
        Device.uniform1f(Program.Uniforms.get("uCheckerScale"), Options.CheckerScale || 16);
        Device.uniform3fv(Program.Uniforms.get("uMaskTint"), Options.MaskTint || [0.95, 0.22, 0.3]);
        Device.uniform3fv(Program.Uniforms.get("uCursor"), Options.Cursor || [0, 0, 0]);
        Device.uniform1f(Program.Uniforms.get("uCursorVisible"), Options.Cursor ? 1 : 0);
        Device.uniform3fv(Program.Uniforms.get("uCursorInk"), Options.CursorInk || [1, 1, 1]);
        Device.uniform1f(Program.Uniforms.get("uCursorPreview"), Options.CursorPreview ?? 0);
        Device.drawArrays(Device.TRIANGLES, 0, 3);
        Device.bindVertexArray(null);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Export and picking.
    //----------------------------------------------------------------------------------------------------------------------
    ResolveSlot(Slot, Material)
    {
        if (!this.Ready) return null;
        const Device = this.Device;
        const Size = this.Resolution;
        if (!this.ResolveTarget || this.ResolveTarget.Images[0].Width !== Size)
        {
            this.ReleaseTarget(this.ResolveTarget);
            this.ResolveTarget = this.CreateTarget([this.CreateColourImage(Size, false)]);
        }
        const Program = this.Programs.Resolve;
        Device.bindFramebuffer(Device.FRAMEBUFFER, this.ResolveTarget);
        Device.viewport(0, 0, Size, Size);
        Device.disable(Device.BLEND);
        Device.disable(Device.DEPTH_TEST);
        Device.useProgram(Program.Program);
        Device.bindVertexArray(this.QuadArray);
        const Images = this.ChannelImages;
        this.BindImage(Program, "uChannel0", Images[0], 0);
        this.BindImage(Program, "uChannel1", Images[1], 1);
        this.BindImage(Program, "uChannel2", Images[2], 2);
        this.BindImage(Program, "uChannel3", Images[3], 3);
        this.BindImage(Program, "uField", this.FieldTarget.Images[0], 4);
        Device.uniform1i(Program.Uniforms.get("uSlot"), Slot);
        Device.uniform1f(Program.Uniforms.get("uNormalGain"), this.NormalGain(Material));
        Device.drawArrays(Device.TRIANGLES, 0, 3);
        const Pixels = new Uint8Array(Size * Size * 4);
        Device.readPixels(0, 0, Size, Size, Device.RGBA, Device.UNSIGNED_BYTE, Pixels);
        Device.bindVertexArray(null);
        Device.bindFramebuffer(Device.FRAMEBUFFER, null);
        return { Width: Size, Height: Size, Pixels };
    }

    //----------------------------------------------------------------------------------------------------------------------
    // One composited render target, read straight back.
    //
    // 🔴 Deliberately not ResolveSlot. The resolve pass re-encodes a slot for export — sRGB on the colour channels, a
    //    packed ORM, a tangent normal — and flattening needs the texels in the same space the coverage images are
    //    painted in, so a flattened layer paints back exactly what the stack composited. Round-tripping through the
    //    export encoding would brighten the whole surface by the sRGB curve on the first flatten and again on the next.
    //----------------------------------------------------------------------------------------------------------------------
    ComposedImage(Attachment = 0)
    {
        if (!this.Ready) return null;
        const Device = this.Device;
        const Size = this.Resolution;
        const Target = this.ChannelTargets[this.ChannelIndex];
        const Pixels = new Uint8Array(Size * Size * 4);
        Device.bindFramebuffer(Device.READ_FRAMEBUFFER, Target);
        Device.readBuffer(Device.COLOR_ATTACHMENT0 + Attachment);
        Device.readPixels(0, 0, Size, Size, Device.RGBA, Device.UNSIGNED_BYTE, Pixels);
        Device.readBuffer(Device.COLOR_ATTACHMENT0);
        Device.bindFramebuffer(Device.READ_FRAMEBUFFER, null);
        return { Width: Size, Height: Size, Pixels };
    }

    PickTexel(Coordinate)
    {
        if (!this.Ready) return null;
        const Device = this.Device;
        const X = Math.max(0, Math.min(this.Resolution - 1, Math.round(Coordinate[0] * this.Resolution)));
        const Y = Math.max(0, Math.min(this.Resolution - 1, Math.round(Coordinate[1] * this.Resolution)));
        const Target = this.ChannelTargets[this.ChannelIndex];
        const Pixels = new Uint8Array(4);
        const Second = new Uint8Array(4);
        Device.bindFramebuffer(Device.READ_FRAMEBUFFER, Target);
        Device.readBuffer(Device.COLOR_ATTACHMENT0);
        Device.readPixels(X, Y, 1, 1, Device.RGBA, Device.UNSIGNED_BYTE, Pixels);
        Device.readBuffer(Device.COLOR_ATTACHMENT1);
        Device.readPixels(X, Y, 1, 1, Device.RGBA, Device.UNSIGNED_BYTE, Second);
        Device.readBuffer(Device.COLOR_ATTACHMENT0);
        Device.bindFramebuffer(Device.READ_FRAMEBUFFER, null);
        return {
            BaseColour: [Pixels[0] / 255, Pixels[1] / 255, Pixels[2] / 255],
            Opacity: Pixels[3] / 255,
            Roughness: Second[0] / 255,
            Metalness: Second[1] / 255,
            Occlusion: Second[2] / 255,
            Height: Second[3] / 255,
        };
    }

    Resize(Width, Height, Ratio)
    {
        const Target = Math.max(1, Math.round(Width * Ratio));
        const Vertical = Math.max(1, Math.round(Height * Ratio));
        if (this.Canvas.width === Target && this.Canvas.height === Vertical) return false;
        this.Canvas.width = Target;
        this.Canvas.height = Vertical;
        return true;
    }
}

const ChannelDefault = (Identifier) =>
{
    const Channel = ChannelSpecification.find((Entry) => Entry.Identifier === Identifier);
    return Channel.Kind === "color" ? Channel.Default : Channel.Default;
};

const RotateAround = (Vector, Axis, Angle) =>
{
    const Cosine = Math.cos(Angle);
    const Sine = Math.sin(Angle);
    const Dot = Vector[0] * Axis[0] + Vector[1] * Axis[1] + Vector[2] * Axis[2];
    const Cross = [
        Axis[1] * Vector[2] - Axis[2] * Vector[1],
        Axis[2] * Vector[0] - Axis[0] * Vector[2],
        Axis[0] * Vector[1] - Axis[1] * Vector[0],
    ];
    return [0, 1, 2].map(
        (Index) => Vector[Index] * Cosine + Cross[Index] * Sine + Axis[Index] * Dot * (1 - Cosine),
    );
};
