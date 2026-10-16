//============================================================================================================================================
//                                                              CABINPASS.JS
//============================================================================================================================================
// 🧩 The cabin forward pass: HMI screens into the recombined radiance, glazing over the resolved frame.

// 📝 Two draws outside the deferred chain. The screens are emissive quads posed on the CPU and composited before the
//    antialiasing, so they settle with the frame; the shell's glass facets (filtered out of the body set at bring-up)
//    blend over the resolved image after it, depth-tested against the opaque depth in both cases. Screen sheets upload
//    from the display sequence's canvases by writeTexture; the cluster sheet is rebuilt when its outline changes.

import { ProjectScreenQuad } from "./CabinStructure.js";
import { VertexStride } from "./FacetStructure.js";
import { TransformPoint } from "./TransformProjection.js";
import { TabletCanvasExtent, ResolveClusterCanvasExtent } from "./CabinDisplaySequence.js";

const ScreenVertexFloats = 6;   // [-] world xyz, uv, screen index
const ScreenVertices     = 12;  // [-] two quads, non-indexed

export class CabinPass
{
    constructor(Exchange, Shaders)
    {
        this.Exchange = Exchange;
        this.Shaders  = Shaders;
        this.ClusterOutline = "";
    }

    async ConstructPrograms(FrameRecords)
    {
        this.FrameRecords = FrameRecords;
        const Visibility = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
        this.ScreenLayout = this.Exchange.ConstructDescriptorLayout(["Uniform", "Uniform", "Texture2D", "Texture2D", "Sampler"],
                                                                    Visibility, "Cabin screens");
        this.GlassLayout = this.Exchange.ConstructDescriptorLayout(["Uniform", "Uniform"], Visibility, "Cabin glass");
        this.ScreenProgram = await this.Shaders.ConstructRasterProgram("CabinScreen.wgsl", {
            VertexEntry: "ScreenVertex", FragmentEntry: "ScreenFragment",
            VertexLayouts: [{ arrayStride: ScreenVertexFloats * 4, attributes: [
                { shaderLocation: 0, offset: 0,  format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "float32x2" },
                { shaderLocation: 2, offset: 20, format: "uint32" }] }],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" },
            Targets: [{ format: "rgba16float", blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
                                                              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }]
        }, [this.ScreenLayout]);
        this.GlassProgram = await this.Shaders.ConstructRasterProgram("CabinGlass.wgsl", {
            VertexEntry: "GlassVertex", FragmentEntry: "GlassFragment",
            VertexLayouts: [{ arrayStride: VertexStride, attributes: [
                { shaderLocation: 0, offset: 0,  format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "uint32" },
                { shaderLocation: 2, offset: 16, format: "float32x3" },
                { shaderLocation: 3, offset: 28, format: "uint32" }] }],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" },
            Targets: [{ format: "rgba16float", blend: { color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
                                                              alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" } } }]
        }, [this.GlassLayout]);
        this.SheetSampler = this.Exchange.ConstructSampler({ magFilter: "linear", minFilter: "linear" });
        this.ScreenVertices = this.Exchange.ConstructRecords(ScreenVertices * ScreenVertexFloats * 4,
                                                             GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, "Cabin screen quads");
        this.ScreenUniforms = this.Exchange.ConstructRecords(16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Cabin screen gains");
        this.GlassUniforms = this.Exchange.ConstructRecords(80, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Cabin glass pose");
        this.TabletTexture = this.ConstructSheet(TabletCanvasExtent, "Tablet sheet");
        this.GlassGroup = this.Exchange.ConstructDescriptorGroup(this.GlassLayout, [FrameRecords, this.GlassUniforms]);
    }

    ConstructSheet([Width, Height], Label)
    {
        const Texture = this.Exchange.ConstructTexture({ label: Label, size: [Width, Height], format: "rgba8unorm-srgb",
                                                         usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
        return { Texture, View: Texture.createView(), Width, Height };
    }

    // 📝 The cluster sheet follows the outline's aspect (a square raster for the 70 % circle); the screen group is
    //    rebuilt with it.
    RebuildClusterSheet(OutlineIdentifier)
    {
        if (OutlineIdentifier === this.ClusterOutline && this.ClusterTexture)
            return false;
        this.ClusterOutline = OutlineIdentifier;
        if (this.ClusterTexture)
            this.ClusterTexture.Texture.destroy();
        this.ClusterTexture = this.ConstructSheet(ResolveClusterCanvasExtent(OutlineIdentifier), "Cluster sheet");
        this.ScreenGroup = this.Exchange.ConstructDescriptorGroup(this.ScreenLayout,
            [this.FrameRecords, this.ScreenUniforms, this.TabletTexture.View, this.ClusterTexture.View, this.SheetSampler]);
        return true;
    }

    UploadSheet(Sheet, Canvas)
    {
        const Context = Canvas.getContext("2d");
        const Pixels = Context.getImageData(0, 0, Canvas.width, Canvas.height);
        this.Exchange.Device.queue.writeTexture({ texture: Sheet.Texture }, Pixels.data,
                                                { bytesPerRow: Canvas.width * 4, rowsPerImage: Canvas.height },
                                                [Canvas.width, Canvas.height]);
    }

    UploadTablet(Canvas)
    {
        if (Canvas.width !== this.TabletTexture.Width || Canvas.height !== this.TabletTexture.Height)
            return;
        this.UploadSheet(this.TabletTexture, Canvas);
    }

    UploadCluster(Canvas, OutlineIdentifier)
    {
        this.RebuildClusterSheet(OutlineIdentifier);
        if (Canvas.width !== this.ClusterTexture.Width || Canvas.height !== this.ClusterTexture.Height)
            return;
        this.UploadSheet(this.ClusterTexture, Canvas);
    }

    // 📝 Poses both quads from the body transform and writes the screen gains; the cluster quad follows its outline.
    PoseScreens(BodyTransform, ClusterOutline, TabletGain, ClusterGain)
    {
        const Quads = [ProjectScreenQuad("tablet"), ProjectScreenQuad("cluster", ClusterOutline)];
        const Scalars = new Float32Array(ScreenVertices * ScreenVertexFloats);
        const Integers = new Uint32Array(Scalars.buffer);
        Quads.forEach((Quad, Screen) =>
        {
            [0, 1, 2, 0, 2, 3].forEach((Corner, Vertex) =>
            {
                const Offset = (Screen * 6 + Vertex) * ScreenVertexFloats;
                Scalars.set(TransformPoint(BodyTransform, Quad.Corners[Corner].Position), Offset);
                Scalars.set(Quad.Corners[Corner].UV, Offset + 3);
                Integers[Offset + 5] = Screen;
            });
        });
        this.Exchange.Device.queue.writeBuffer(this.ScreenVertices, 0, Scalars);
        this.Exchange.Device.queue.writeBuffer(this.ScreenUniforms, 0, new Float32Array([TabletGain, ClusterGain, 0.0, 0.0]));
    }

    PoseGlass(BodyTransform, Tint = [0.012, 0.014, 0.016], Strength = 1.0)
    {
        const Scalars = new Float32Array(20);
        Scalars.set(BodyTransform, 0);
        Scalars.set(Tint, 16);
        Scalars[19] = Strength;
        this.Exchange.Device.queue.writeBuffer(this.GlassUniforms, 0, Scalars);
    }

    RecordScreens(Encoder, Surface, Display)
    {
        const Pass = Encoder.beginRenderPass({
            label: "Cabin screens",
            colorAttachments: [{ view: Display.Views.Recombined, loadOp: "load", storeOp: "store" }],
            depthStencilAttachment: { view: Surface.Views.Depth, depthLoadOp: "load", depthStoreOp: "store" }
        });
        Pass.setPipeline(this.ScreenProgram);
        Pass.setBindGroup(0, this.ScreenGroup);
        Pass.setVertexBuffer(0, this.ScreenVertices);
        Pass.draw(ScreenVertices, 1, 0, 0);
        Pass.end();
    }

    RecordGlass(Encoder, Parity, Scene, Surface, Display, VertexRecords)
    {
        const Set = Scene.FacetSets[Scene.CabinGlassSet];
        if (!Set || Set.VertexCount === 0)
            return;
        const Pass = Encoder.beginRenderPass({
            label: "Cabin glass",
            colorAttachments: [{ view: Display.Views.Resolved[Parity], loadOp: "load", storeOp: "store" }],
            depthStencilAttachment: { view: Surface.Views.Depth, depthLoadOp: "load", depthStoreOp: "store" }
        });
        Pass.setPipeline(this.GlassProgram);
        Pass.setBindGroup(0, this.GlassGroup);
        Pass.setVertexBuffer(0, VertexRecords);
        Pass.draw(Set.VertexCount, 1, Set.FirstVertex, 0);
        Pass.end();
    }
}
