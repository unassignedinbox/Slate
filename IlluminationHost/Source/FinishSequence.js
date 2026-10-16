//============================================================================================================================================
//                                                            FINISHSEQUENCE.JS
//============================================================================================================================================
// 🧩 The HMI finish: the configurator's paint, gloss and rims repainting the car live, and its X-ray ghost view.

// 📝 The interactive-vehicle-hmi-configurator's two tricks, in this renderer:
//
//    • finishes — the Garage tablet (and the inspector's Cabin page) pick a paint, a clear coat and a rim set, and
//      the BodyCoat and Hub material records are rewritten in place (the derez palette's writeBuffer path), so the
//      car, its Garage preview, its mirrors and its derez cubes all take the new finish the same frame;
//    • X-ray — a scan front sweeps the car nose to tail (off / scan / ghost): the surface raster dissolves the
//      vehicle behind it and the ghost raster draws it back as a fresnel hologram with the shell's hard edges.
//
//    The tablet reaches this through CabinSequence (Screen.Finish, a revision counter like the tyre pump); the
//    inspector calls ApplyFinish / AssignGhostMode directly.

import { CourseMaterial } from "./MaterialSpecification.js";
import { ParseColour } from "./EffectSequence.js";
import { VertexStride } from "./FacetStructure.js";
import { SubtractVector, CrossVector, NormalizeVector, DotVector } from "./TransformProjection.js";

// 📝 The configurator's palette (Experimental/interactive-vehicle-hmi-configurator, data/config.ts), shared with the
//    tablet and the inspector so all three offer the same finishes.
export const FinishPaints = Object.freeze([
    { Id: "silver", Name: "Nebula Silver", Hex: "#c2c8d0", Metallic: true },
    { Id: "black",  Name: "Obsidian Black", Hex: "#17191d", Metallic: true },
    { Id: "red",    Name: "Command Red", Hex: "#8a1a1d", Metallic: true },
    { Id: "blue",   Name: "Tactical Blue", Hex: "#1c3f73", Metallic: true },
    { Id: "sand",   Name: "Moab Sand", Hex: "#b2946a", Metallic: false },
    { Id: "green",  Name: "Recon Green", Hex: "#33442f", Metallic: false },
    { Id: "white",  Name: "Arctic White", Hex: "#e7ebef", Metallic: true },
    { Id: "copper", Name: "Copper Bronze", Hex: "#8c5a2e", Metallic: true }
]);

export const FinishRims = Object.freeze([
    { Id: "trail",    Name: "Trail Beadlock", Hex: "#2b2e33", Machined: false },
    { Id: "sport",    Name: "Machined Sport", Hex: "#c9ced4", Machined: true },
    { Id: "blackout", Name: "Blackout Mesh", Hex: "#0e0f11", Machined: false },
    { Id: "bronze",   Name: "Bronze Forged", Hex: "#9a6a2f", Machined: true }
]);

export const GhostModes = Object.freeze({ Off: "off", Scan: "scan", Ghost: "ghost" });

// 📝 The scan cycle mirrors the configurator's: 4.6 s nose to tail, 1.0 s hold, then the hologram fades; 6.6 s round.
const ScanCycleSeconds = 6.6;   // [s]
const ScanSweepSeconds = 4.6;   // [s]
const ScanHoldSeconds  = 1.0;   // [s]
const ScanFrontNose    = 3.3;   // [m] car-body X ahead of the nose
const ScanFrontTail    = -3.4;  // [m] car-body X past the tail
const GhostTint        = "#8fd8f2";
const GhostBrightness  = 2.5;   // [-] in the recombined radiance units
const GhostWireOpacity = 0.55;  // [-]

// 📝 The shell families whose hard edges become the wireframe; glazing, cabin, wheel and lamps that turn or scale with
//    the cockpit are left out, so the edge buffer never disagrees with the deformed shell.
const ShellEdgeFamilies = new Set([CourseMaterial.BodyCoat, CourseMaterial.VehiclePlastic, CourseMaterial.VehicleTrim,
                                   CourseMaterial.VehicleDefault, CourseMaterial.Headlight, CourseMaterial.Taillight]);

function EaseInOutCubic(T)
{
    return T < 0.5 ? 4.0 * T * T * T : 1.0 - Math.pow(-2.0 * T + 2.0, 3.0) / 2.0;
}

function Damp(Current, Target, Rate, Seconds)
{
    return Current + (Target - Current) * (1.0 - Math.exp(-Rate * Seconds));
}

export class FinishSequence
{
    constructor(Exchange, Shaders)
    {
        this.Exchange = Exchange;
        this.Shaders  = Shaders;
        // 📝 The authored finishes, as sRGB: the lime coat ((0.68, 0.80, 0) × 0.78, linear) and the blue rim metal.
        this.Paint   = "#c2cf00";
        this.Metallic = true;
        this.Gloss   = true;
        this.Rim     = "#4581cf";
        this.RimMachined = false;
        this.Mode    = GhostModes.Off;
        this.Clock   = 0.0;
        this.Ramp    = 0.0;
        this.Sweep   = 0.0;
        this.Front   = ScanFrontNose;
        this.Amount  = 0.0;
        this.Records = Exchange.ConstructRecords(32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Ghost record");
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  BRING-UP
    //--------------------------------------------------------------------------------------------------------------------

    async ConstructResources({ FrameRecords, OccupantRecords, VehicleRecords, EffectRecords, MaterialRecords, Materials, Scene })
    {
        this.MaterialRecords = MaterialRecords;
        this.Materials = Materials;
        const Positions = FinishSequence.ExtractShellEdges(Scene.FacetSets[Scene.VehicleBodySet].Facets);
        this.EdgeVertexCount = Positions.length / 3;
        this.EdgeRecords = this.Exchange.ConstructRecordsFrom(Positions, GPUBufferUsage.VERTEX, "Ghost shell edges");
        const Stages = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
        this.Layout = this.Exchange.ConstructDescriptorLayout(["Uniform", "StorageRead", "StorageRead", "Uniform", "Uniform"],
                                                              Stages, "Finish ghost");
        this.Group = this.Exchange.ConstructDescriptorGroup(this.Layout,
            [FrameRecords, OccupantRecords, VehicleRecords, EffectRecords, this.Records]);
        // 📝 Premultiplied over the recombined radiance, like the cabin overlay: the emission adds, (1 − A) dims.
        const Targets = [{ format: "rgba16float", blend: { color: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
                                                                  alpha: { srcFactor: "zero", dstFactor: "one", operation: "add" } } }];
        const Depth = { format: "depth32float", depthWriteEnabled: false, depthCompare: "greater" };
        this.ShellProgram = await this.Shaders.ConstructRasterProgram("GhostRaster.wgsl", {
            VertexEntry: "GhostVertex", FragmentEntry: "GhostFragment",
            VertexLayouts: [{ arrayStride: VertexStride, attributes: [
                { shaderLocation: 0, offset: 0,  format: "float32x3" },
                { shaderLocation: 1, offset: 12, format: "uint32" },
                { shaderLocation: 2, offset: 16, format: "float32x3" },
                { shaderLocation: 3, offset: 28, format: "uint32" }] }],
            Primitive: { topology: "triangle-list", cullMode: "none" },
            DepthStencil: Depth, Targets
        }, [this.Layout]);
        this.EdgeProgram = await this.Shaders.ConstructRasterProgram("GhostRaster.wgsl", {
            VertexEntry: "GhostEdgeVertex", FragmentEntry: "GhostEdgeFragment",
            VertexLayouts: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }] }],
            Primitive: { topology: "line-list" },
            DepthStencil: Depth, Targets
        }, [this.Layout]);
        this.Tint = ParseColour(GhostTint);
        this.EncodeRecord();
    }

    // 📝 Hard edges of the shell: an edge whose two facets meet at more than 14° (the configurator's EdgesGeometry
    //    angle), or that belongs to one facet only. Corners quantised to 0.1 mm, the archive's own resolution order.
    static ExtractShellEdges(Facets)
    {
        const Quantise = (Point) => `${Math.round(Point[0] * 10000)},${Math.round(Point[1] * 10000)},${Math.round(Point[2] * 10000)}`;
        const Edges = new Map();
        for (const Facet of Facets)
        {
            if (!ShellEdgeFamilies.has(Facet.Family))
                continue;
            const [A, B, C] = Facet.Corners;
            const Normal = NormalizeVector(CrossVector(SubtractVector(B, A), SubtractVector(C, A)));
            for (const [P, Q] of [[A, B], [B, C], [C, A]])
            {
                const KP = Quantise(P), KQ = Quantise(Q);
                const Key = KP < KQ ? `${KP}|${KQ}` : `${KQ}|${KP}`;
                let Edge = Edges.get(Key);
                if (!Edge)
                {
                    Edge = { P, Q, Normals: [] };
                    Edges.set(Key, Edge);
                }
                Edge.Normals.push(Normal);
            }
        }
        const CosineLimit = Math.cos(14.0 * Math.PI / 180.0);
        const Positions = [];
        for (const Edge of Edges.values())
        {
            const Keep = Edge.Normals.length !== 2 || DotVector(Edge.Normals[0], Edge.Normals[1]) < CosineLimit;
            if (Keep)
                Positions.push(...Edge.P, ...Edge.Q);
        }
        return new Float32Array(Positions);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  FINISH
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 PaintHex/RimHex are sRGB (#rrggbb); Metallic/Machined/Gloss follow the configurator's roughness/metalness map.
    ApplyFinish(PaintHex, Metallic, Gloss, RimHex, RimMachined)
    {
        this.Paint = PaintHex;
        this.Metallic = !!Metallic;
        this.Gloss = !!Gloss;
        this.Rim = RimHex;
        this.RimMachined = !!RimMachined;
        this.Reapply();
    }

    // 📝 The state's finishes rewritten into the BodyCoat and Hub records (48-byte records, SceneRecords.wgsl).
    Reapply()
    {
        if (!this.MaterialRecords)
            return;
        const Device = this.Exchange.Device;
        const CoatAlbedo = ParseColour(this.Paint);
        const CoatRoughness = this.Gloss ? (this.Metallic ? 0.26 : 0.45) : 0.72;
        const CoatMetalness = this.Metallic ? 0.9 : 0.35;
        const CoatWeight = this.Gloss ? 1.0 : 0.1, CoatClearRoughness = this.Gloss ? 0.03 : 0.65;
        Device.queue.writeBuffer(this.MaterialRecords, CourseMaterial.BodyCoat * 48, new Float32Array(
            [...CoatAlbedo, CoatRoughness, 0.0, 0.0, 0.0, CoatMetalness, CoatWeight, CoatClearRoughness, 0.04, 0.0]));
        Object.assign(this.Materials[CourseMaterial.BodyCoat],
            { Albedo: CoatAlbedo, Roughness: CoatRoughness, Metalness: CoatMetalness, Emission: [0.0, 0.0, 0.0],
              CoatWeight, CoatRoughness: CoatClearRoughness });
        const RimAlbedo = ParseColour(this.Rim);
        const RimRoughness = this.RimMachined ? 0.18 : 0.45;
        const RimMetalness = this.RimMachined ? 0.95 : 0.7;
        const RimEmission = this.Materials[CourseMaterial.Hub].Emission.slice();
        Device.queue.writeBuffer(this.MaterialRecords, CourseMaterial.Hub * 48, new Float32Array(
            [...RimAlbedo, RimRoughness, ...RimEmission, RimMetalness, 0.0, 0.0, 0.04, 0.0]));
        Object.assign(this.Materials[CourseMaterial.Hub],
            { Albedo: RimAlbedo, Roughness: RimRoughness, Metalness: RimMetalness });
    }

    ApplyPaintHex(Hex)
    {
        const Preset = FinishPaints.find((Paint) => Paint.Hex === Hex);
        this.ApplyFinish(Hex, Preset ? Preset.Metallic : this.Metallic, this.Gloss, this.Rim, this.RimMachined);
    }

    ApplyRimHex(Hex)
    {
        const Preset = FinishRims.find((Rim) => Rim.Hex === Hex);
        this.ApplyFinish(this.Paint, this.Metallic, this.Gloss, Hex, Preset ? Preset.Machined : this.RimMachined);
    }

    AssignGhostMode(Mode)
    {
        if (!Object.values(GhostModes).includes(Mode))
            return;
        if (Mode === GhostModes.Scan && this.Mode !== GhostModes.Scan)
            this.Sweep = 0.0;
        this.Mode = Mode;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  FRAME
    //--------------------------------------------------------------------------------------------------------------------

    Advance(Seconds)
    {
        this.Clock += Seconds;
        const Target = this.Mode === GhostModes.Off ? 0.0 : 1.0;
        this.Ramp = Damp(this.Ramp, Target, 3.0, Seconds);
        if (Math.abs(this.Ramp - Target) < 0.002)
            this.Ramp = Target;
        let Cycle = 1.0;
        if (this.Mode === GhostModes.Scan)
        {
            this.Sweep += Seconds;
            const Phase = this.Sweep % ScanCycleSeconds;
            const Travel = Phase < ScanSweepSeconds ? EaseInOutCubic(Phase / ScanSweepSeconds) : 1.0;
            this.Front = ScanFrontNose + (ScanFrontTail - ScanFrontNose) * Travel;
            Cycle = Phase < ScanSweepSeconds + ScanHoldSeconds
                  ? 1.0 : Math.max(0.0, 1.0 - (Phase - ScanSweepSeconds - ScanHoldSeconds)
                                                / (ScanCycleSeconds - ScanSweepSeconds - ScanHoldSeconds));
        }
        else if (this.Mode === GhostModes.Ghost)
        {
            this.Front = -99.0;
        }
        this.Amount = this.Ramp * (this.Mode === GhostModes.Scan ? Cycle : 1.0);
        this.EncodeRecord();
    }

    EncodeRecord()
    {
        const Tint = this.Tint || [0.0, 0.0, 0.0];
        this.Exchange.Device.queue.writeBuffer(this.Records, 0, new Float32Array(
            [this.Front, this.Amount, GhostWireOpacity, this.Clock, ...Tint, GhostBrightness]));
    }

    // 📝 Over the recombined radiance, before the cabin overlay and the antialiasing; the surface depth read only.
    RecordGhost(Encoder, TargetView, DepthView, Scene, VertexRecords)
    {
        if (!this.ShellProgram || this.Amount < 0.003)
            return;
        const Pass = Encoder.beginRenderPass({
            label: "Finish ghost",
            colorAttachments: [{ view: TargetView, loadOp: "load", storeOp: "store" }],
            depthStencilAttachment: { view: DepthView, depthReadOnly: true }
        });
        Pass.setPipeline(this.ShellProgram);
        Pass.setBindGroup(0, this.Group);
        Pass.setVertexBuffer(0, VertexRecords);
        for (const Run of Scene.DrawRuns)
        {
            if (Run.First >= 5)
                continue;
            const Set = Scene.FacetSets[Run.FacetSet];
            Pass.draw(Set.VertexCount, Run.Count, Set.FirstVertex, Run.First);
        }
        if (this.EdgeVertexCount > 0)
        {
            Pass.setPipeline(this.EdgeProgram);
            Pass.setVertexBuffer(0, this.EdgeRecords);
            Pass.draw(this.EdgeVertexCount);
        }
        Pass.end();
    }

    QueryReadout()
    {
        const Paint = FinishPaints.find((Preset) => Preset.Hex === this.Paint);
        const Rim = FinishRims.find((Preset) => Preset.Hex === this.Rim);
        return [`finish ${Paint ? Paint.Name : this.Paint} · ${this.Gloss ? "gloss" : "matte"}`
                + ` · ${Rim ? Rim.Name : this.Rim} · ghost ${this.Mode}`];
    }
}
