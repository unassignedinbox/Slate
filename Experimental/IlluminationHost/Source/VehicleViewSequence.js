//============================================================================================================================================
//                                                       VEHICLEVIEWSEQUENCE.JS
//============================================================================================================================================
// 🧩 Alpha-composited ghost and wireframe views of the live vehicle, drawn over the deferred scene before antialiasing.

import { VertexStride } from "./FacetStructure.js";

const VehicleOccupantCount = 5; // body followed by the four wheels

export class VehicleViewSequence
{
    constructor(Exchange, Shaders)
    {
        this.Exchange = Exchange;
        this.Shaders = Shaders;
    }

    async ConstructPrograms(FrameRecords, OccupantRecords, MaterialRecords, VehicleRecords, EffectRecords)
    {
        const Stages = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
        this.Layout = this.Exchange.ConstructDescriptorLayout(
            ["Uniform", "StorageRead", "StorageRead", "StorageRead", "Uniform"], Stages, "Vehicle ghost and wireframe");
        this.Group = this.Exchange.ConstructDescriptorGroup(this.Layout,
            [FrameRecords, OccupantRecords, MaterialRecords, VehicleRecords, EffectRecords]);
        this.Program = await this.Shaders.ConstructRasterProgram("VehicleOverlay.wgsl", {
            VertexEntry: "VehicleViewVertex",
            FragmentEntry: "VehicleViewFragment",
            VertexLayouts: [{ arrayStride: VertexStride, attributes: [
                { shaderLocation: 0, offset: 0,  format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "uint32" },
                { shaderLocation: 2, offset: 16, format: "float32x3" },
                { shaderLocation: 3, offset: 28, format: "uint32" }] }],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" },
            Targets: [{
                format: "rgba16float",
                blend: {
                    color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" }
                }
            }]
        }, [this.Layout]);
    }

    // Draw the same body and wheel facets as the deferred scene. The opaque raster omits them while a view mode is
    // active; this pass depth-tests against the rest of the scene, but does not write depth, so the fill is truly
    // translucent and the wireframe never hides what lies behind the vehicle.
    Record(Encoder, TargetView, DepthView, Scene, VertexRecords)
    {
        if (!this.Program || !Scene || !VertexRecords)
            return;

        const Pass = Encoder.beginRenderPass({
            label: "Vehicle ghost / wireframe",
            colorAttachments: [{ view: TargetView, loadOp: "load", storeOp: "store" }],
            depthStencilAttachment: { view: DepthView, depthReadOnly: true }
        });
        Pass.setPipeline(this.Program);
        Pass.setBindGroup(0, this.Group);
        Pass.setVertexBuffer(0, VertexRecords);

        const Indices = [Scene.VehicleOccupants.Body, ...Scene.VehicleOccupants.Wheels].slice(0, VehicleOccupantCount);
        for (const Index of Indices)
        {
            const Occupant = Scene.Occupants[Index];
            if (!Occupant || Occupant.Inactive)
                continue;
            const Set = Scene.FacetSets[Occupant.FacetSet];
            Pass.draw(Set.VertexCount, 1, Set.FirstVertex, Index);
        }
        Pass.end();
    }
}
