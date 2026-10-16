//============================================================================================================================================
//                                                           DISPLAYPROJECTION.JS
//============================================================================================================================================
// 🧩 Recombination, temporal antialiasing, eye adaptation, the distance-field inspection march and the swapchain present.

export class DisplayProjection
{
    constructor(Exchange, Shaders)
    {
        this.Exchange = Exchange;
        this.Shaders  = Shaders;
    }

    async ConstructPrograms(FrameRecords, MaterialRecords, DistanceLayout, SamplingLayout)
    {
        this.FrameRecords    = FrameRecords;
        this.MaterialRecords = MaterialRecords;
        const Compute = GPUShaderStage.COMPUTE;
        this.RecombineLayout = this.Exchange.ConstructDescriptorLayout(
            ["Uniform", "StorageRead", "Texture2D", "TextureDepth2D", "Texture2D", "Texture2D", "Texture2D", "Texture2D", "Texture2D",
             "Texture2D", "StorageTexture2D:rgba16float", "Texture2D", "Texture2D"], Compute, "Display recombination");
        this.AntialiasLayout = this.Exchange.ConstructDescriptorLayout(
            ["Uniform", "Texture2D", "Texture2D", "Texture2D", "Sampler", "StorageTexture2D:rgba16float"], Compute, "Display antialias");
        this.ExposureLayout = this.Exchange.ConstructDescriptorLayout(["Uniform", "Texture2D", "Storage"], Compute, "Display exposure");
        this.InspectionLayout = this.Exchange.ConstructDescriptorLayout(["Uniform", "StorageTexture2D:rgba16float"], Compute, "Inspection march");
        this.PresentLayout = this.Exchange.ConstructDescriptorLayout(["Uniform", "Texture2D", "StorageRead"],
                                                                     GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, "Display present");
        this.RecombineProgram  = await this.Shaders.ConstructComputeProgram("DisplayRecombination.wgsl", "ResolveRecombination", [this.RecombineLayout]);
        this.AntialiasProgram  = await this.Shaders.ConstructComputeProgram("DisplayAntialias.wgsl", "IntegrateAntialias", [this.AntialiasLayout]);
        this.ExposureProgram   = await this.Shaders.ConstructComputeProgram("DisplayExposure.wgsl", "IntegrateExposure", [this.ExposureLayout]);
        this.InspectionProgram = await this.Shaders.ConstructComputeProgram("InspectionMarch.wgsl", "MarchInspection",
                                                                            [this.InspectionLayout, DistanceLayout, SamplingLayout]);
        this.PresentProgram = await this.Shaders.ConstructRasterProgram("DisplayPresent.wgsl", {
            VertexEntry: "PresentVertex", FragmentEntry: "PresentFragment",
            Primitive: { topology: "triangle-list" },
            Targets: [{ format: `${this.Exchange.CanvasFormat}-srgb` }]
        }, [this.PresentLayout, DistanceLayout]);
        this.LinearClamp = this.Exchange.ConstructSampler({ magFilter: "linear", minFilter: "linear" });
        this.AdaptationRecords = this.Exchange.ConstructRecords(16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
                                                                "Eye adaptation");
    }

    ConstructTargets(ScreenExtent, Surface, Resampling, Diffuse, Glossy, Cards, Plume, Embers)
    {
        for (const Texture of this.Textures || [])
            Texture.destroy();
        const Usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
        // 📝 Recombined and Resolved double as render targets for the cabin forward pass (screens, glazing).
        const CabinUsage = Usage | GPUTextureUsage.RENDER_ATTACHMENT;
        const Construct = (Label, Target = Usage) => this.Exchange.ConstructTexture({ label: Label, size: ScreenExtent, format: "rgba16float", usage: Target });
        const Recombined = Construct("Recombined radiance", CabinUsage);
        const Inspection = Construct("Inspection radiance");
        const Resolved   = [Construct("Resolved radiance A", CabinUsage), Construct("Resolved radiance B", CabinUsage)];
        this.Textures = [Recombined, Inspection, ...Resolved];
        this.ScreenExtent = ScreenExtent;
        this.Views = { Recombined: Recombined.createView(), Inspection: Inspection.createView(), Resolved: Resolved.map((Texture) => Texture.createView()) };
        this.RecombineGroup = this.Exchange.ConstructDescriptorGroup(this.RecombineLayout,
            [this.FrameRecords, this.MaterialRecords, Surface.Views.Attributes, Surface.Views.Depth, Surface.Views.Direct, Diffuse.Views.Screen,
             Glossy.Views.Screen, Resampling.Views.Irradiance, this.Views.Inspection, Cards.Views.Final, this.Views.Recombined, Plume.MarchView, Embers.RadianceView]);
        this.AntialiasGroups = [0, 1].map((Parity) => this.Exchange.ConstructDescriptorGroup(this.AntialiasLayout,
            [this.FrameRecords, this.Views.Recombined, this.Views.Resolved[1 - Parity], Surface.Views.Motion, this.LinearClamp, this.Views.Resolved[Parity]]));
        this.ExposureGroups = [0, 1].map((Parity) => this.Exchange.ConstructDescriptorGroup(this.ExposureLayout,
            [this.FrameRecords, this.Views.Resolved[Parity], this.AdaptationRecords]));
        this.PresentGroups = [0, 1].map((Parity) => this.Exchange.ConstructDescriptorGroup(this.PresentLayout,
            [this.FrameRecords, this.Views.Resolved[Parity], this.AdaptationRecords]));
        this.InspectionGroup = this.Exchange.ConstructDescriptorGroup(this.InspectionLayout, [this.FrameRecords, this.Views.Inspection]);
    }

    RecordInspection(Encoder, DistanceGroup, SamplingGroup)
    {
        const Pass = Encoder.beginComputePass({ label: "Inspection march" });
        Pass.setPipeline(this.InspectionProgram);
        Pass.setBindGroup(0, this.InspectionGroup);
        Pass.setBindGroup(1, DistanceGroup);
        Pass.setBindGroup(2, SamplingGroup);
        Pass.dispatchWorkgroups(Math.ceil(this.ScreenExtent[0] / 8), Math.ceil(this.ScreenExtent[1] / 8));
        Pass.end();
    }

    // 📝 CabinScope ({ Cabin, Scene, Surface, VertexRecords, Screens }) splices the cabin forward pass into the
    //    resolve: screens composite into the recombined radiance before the antialiasing settles it, glazing blends
    //    over the resolved frame after. Null omits the cabin (omit=Cabin).
    RecordResolve(Encoder, Parity, TimestampWrites, CabinScope = null)
    {
        const [Width, Height] = this.ScreenExtent;
        const Pass = Encoder.beginComputePass({ label: "Display resolve", timestampWrites: TimestampWrites });
        Pass.setPipeline(this.RecombineProgram);
        Pass.setBindGroup(0, this.RecombineGroup);
        Pass.dispatchWorkgroups(Math.ceil(Width / 8), Math.ceil(Height / 8));
        Pass.end();
        if (CabinScope && CabinScope.Screens)
            CabinScope.Cabin.RecordScreens(Encoder, CabinScope.Surface, this);
        const Settle = Encoder.beginComputePass({ label: "Display settle" });
        Settle.setPipeline(this.AntialiasProgram);
        Settle.setBindGroup(0, this.AntialiasGroups[Parity]);
        Settle.dispatchWorkgroups(Math.ceil(Width / 8), Math.ceil(Height / 8));
        Settle.setPipeline(this.ExposureProgram);
        Settle.setBindGroup(0, this.ExposureGroups[Parity]);
        Settle.dispatchWorkgroups(1);
        Settle.end();
        if (CabinScope)
            CabinScope.Cabin.RecordGlass(Encoder, Parity, CabinScope.Scene, CabinScope.Surface, this, CabinScope.VertexRecords);
    }

    RecordPresent(Encoder, Parity, TargetView, DistanceGroup)
    {
        const Pass = Encoder.beginRenderPass({
            label: "Display present",
            colorAttachments: [{ view: TargetView, clearValue: [0, 0, 0, 1], loadOp: "clear", storeOp: "store" }]
        });
        Pass.setPipeline(this.PresentProgram);
        Pass.setBindGroup(0, this.PresentGroups[Parity]);
        Pass.setBindGroup(1, DistanceGroup);
        Pass.draw(3);
        Pass.end();
    }
}
