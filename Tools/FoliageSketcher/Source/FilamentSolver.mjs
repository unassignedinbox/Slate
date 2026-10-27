//============================================================================================================================================
// 📦 FilamentSolver — the GPU skeleton solver: every plant joint in the plot advanced and constrained on the GPU.
//============================================================================================================================================
// What this is, in one paragraph. Classic engine foliage physics runs a bone chain per plant on the CPU: walk the
//    hierarchy, integrate, project constraints, write a matrix palette, upload it. That costs one CPU pass and one
//    upload per plant per frame, and it collapses somewhere around a few hundred interactive plants. Here the
//    skeleton lives in GPU memory as a lattice of float texels — one texel per joint — and the whole plot is
//    advanced by drawing a full-surface triangle. Positions never return to the CPU; the raster phases read the
//    solved lattice directly. Thousands of interactive plants cost the same handful of draws as one.
//
// The step, per substep:
//    ① Integrate  — Verlet advance under gravity, wind and flutter                    (FilamentIntegrate.glsl)
//    ② Constrain  — N Jacobi iterations of distance + bend + collision projection     (FilamentConstrain.glsl)
//
// Double buffering: ① reads Current/Prior and writes into the spare lattice; each ② iteration reads one lattice and
//    writes the other. Prior is refreshed from the pre-integration positions so velocity stays implicit.
//
// Vulkan port note: ① and ② become compute dispatches over a storage record set; the lattice becomes an SSBO and the
//    ping-pong becomes a pair of barriers. The maths in the .glsl files transfers verbatim.

const MaximumColliders = 8;

export class FilamentSolver
{
    constructor(Device, ShaderIndex)
    {
        this.Device = Device;
        this.Shader = ShaderIndex;

        Device.CompileProgram("FilamentIntegrate", ShaderIndex.Query("FilamentIntegrate"));
        Device.CompileProgram("FilamentConstrain", ShaderIndex.Query("FilamentConstrain"));

        this.JointCount  = 0;
        this.JointExtent = [1, 1];
        this.ChildExtent = [1, 1];
        this.Lattices    = [];
        this.Targets     = [];
        this.Ready       = false;

        // GPU timing. Wall-clock around the draw calls measures CPU submission, not GPU work — the driver is
        //    asynchronous, so that number is a fiction. A disjoint timer query measures the real thing; results
        //    arrive a few frames late, which is why the last completed measurement is kept.
        this.Timer         = Device.TimerExtension;
        this.TimerPending  = null;
        this.SolveNanos    = 0;
    }

    BeginTiming()
    {
        if (!this.Timer || this.TimerPending) return;
        const GL = this.Device.Context;
        const Query = GL.createQuery();
        GL.beginQuery(this.Timer.TIME_ELAPSED_EXT, Query);
        this.TimerPending = Query;
        this.TimerActive  = true;
    }

    EndTiming()
    {
        const GL = this.Device.Context;
        if (this.TimerActive)
        {
            GL.endQuery(this.Timer.TIME_ELAPSED_EXT);
            this.TimerActive = false;
        }

        // Collect whichever earlier query has completed.
        if (this.TimerPending)
        {
            const Available = GL.getQueryParameter(this.TimerPending, GL.QUERY_RESULT_AVAILABLE);
            const Disjoint  = GL.getParameter(this.Timer.GPU_DISJOINT_EXT);
            if (Available && !Disjoint)
            {
                this.SolveNanos = GL.getQueryParameter(this.TimerPending, GL.QUERY_RESULT);
                GL.deleteQuery(this.TimerPending);
                this.TimerPending = null;
            }
            else if (Disjoint)
            {
                GL.deleteQuery(this.TimerPending);
                this.TimerPending = null;
            }
        }
        return this.SolveNanos / 1.0e6;      // [ms]
    }

    //--------------------------------------------------------------------------------------------------------------
    //                                                    RESIDENCY
    //--------------------------------------------------------------------------------------------------------------
    // Uploads a whole plot's joints into the lattice. Called once per regrow, never per frame.

    Reside(Joints, ChildSpans)
    {
        const GL    = this.Device.Context;
        const Count = Joints.length;
        this.JointCount = Count;

        // Square-ish lattice: the solver is bandwidth-bound, and a square minimises the wasted tail.
        const Extent = Math.max(1, Math.ceil(Math.sqrt(Count)));
        this.JointExtent = [Extent, Extent];

        const Texels    = Extent * Extent;
        const Current   = new Float32Array(Texels * 4);
        const Pose      = new Float32Array(Texels * 4);
        const Chain     = new Float32Array(Texels * 4);
        const Tune      = new Float32Array(Texels * 4);
        const Stiff     = new Float32Array(Texels * 4);

        for (let Index = 0; Index < Count; ++Index)
        {
            const Joint = Joints[Index];
            const Write = Index * 4;

            Current[Write]     = Joint.Position[0];
            Current[Write + 1] = Joint.Position[1];
            Current[Write + 2] = Joint.Position[2];
            Current[Write + 3] = 1.0;

            Pose[Write]     = Joint.Pose[0];
            Pose[Write + 1] = Joint.Pose[1];
            Pose[Write + 2] = Joint.Pose[2];
            Pose[Write + 3] = Joint.InverseMass;

            Chain[Write]     = Joint.ParentIndex;
            Chain[Write + 1] = Joint.RestLength;
            Chain[Write + 2] = Joint.ChildOffset ?? 0;
            Chain[Write + 3] = Joint.ChildCount ?? 0;

            Tune[Write]     = Joint.Tune[0];
            Tune[Write + 1] = Joint.Tune[1];
            Tune[Write + 2] = Joint.Tune[2];
            Tune[Write + 3] = Joint.Tune[3];

            Stiff[Write]     = Joint.Stiff[0];
            Stiff[Write + 1] = Joint.Stiff[1];
            Stiff[Write + 2] = Joint.Stiff[2];
            Stiff[Write + 3] = Joint.Stiff[3];
        }

        // Child spans: a flat run of child indices, addressed by (offset, count) held in Chain.zw.
        const ChildCount  = Math.max(1, ChildSpans.length);
        const ChildExtent = Math.max(1, Math.ceil(Math.sqrt(ChildCount)));
        this.ChildExtent  = [ChildExtent, ChildExtent];

        const Child = new Float32Array(ChildExtent * ChildExtent * 4);
        for (let Index = 0; Index < ChildSpans.length; ++Index) Child[Index * 4] = ChildSpans[Index];

        this.#Release();

        // Three position lattices: two for the constraint ping-pong, one holding the prior step.
        this.Lattices = [
            this.Device.CreateLattice(Extent, Extent, Current),
            this.Device.CreateLattice(Extent, Extent, Current),
            this.Device.CreateLattice(Extent, Extent, Current)   // prior
        ];
        this.Targets = this.Lattices.map((Lattice) => this.Device.CreateTarget(Lattice));

        this.AnchorSurface = this.Device.CreateLattice(Extent, Extent, Current);
        this.PoseSurface  = this.Device.CreateLattice(Extent, Extent, Pose);
        this.ChainSurface = this.Device.CreateLattice(Extent, Extent, Chain);
        this.TuneSurface  = this.Device.CreateLattice(Extent, Extent, Tune);
        this.StiffSurface = this.Device.CreateLattice(Extent, Extent, Stiff);
        this.ChildSurface = this.Device.CreateLattice(ChildExtent, ChildExtent, Child);

        this.CurrentSlot = 0;
        this.SpareSlot   = 1;
        this.PriorSlot   = 2;
        this.Ready       = true;

        return { JointCount: Count, LatticeExtent: Extent };
    }

    #Release()
    {
        const GL = this.Device.Context;
        for (const Target  of this.Targets)  GL.deleteFramebuffer(Target);
        for (const Lattice of this.Lattices) GL.deleteTexture(Lattice);
        for (const Surface of [this.PoseSurface, this.ChainSurface, this.TuneSurface, this.StiffSurface,
                               this.ChildSurface, this.AnchorSurface])
            if (Surface) GL.deleteTexture(Surface);
        this.Targets = [];
        this.Lattices = [];
    }

    // The lattice the raster phases must sample this frame.
    QuerySolved() { return this.Lattices[this.CurrentSlot]; }
    QueryExtent() { return this.JointExtent; }

    //--------------------------------------------------------------------------------------------------------------
    //                                                      STEP
    //--------------------------------------------------------------------------------------------------------------

    Step(Criteria)
    {
        if (!this.Ready) return;

        const GL       = this.Device.Context;
        const Device   = this.Device;
        const Extent   = this.JointExtent;
        const Substeps = Math.max(1, Criteria.SubstepCount | 0);
        const Delta    = Criteria.DeltaTime / Substeps;

        GL.disable(GL.DEPTH_TEST);
        GL.disable(GL.BLEND);
        GL.disable(GL.CULL_FACE);
        Device.Viewport(Extent[0], Extent[1]);
        this.BeginTiming();

        for (let Substep = 0; Substep < Substeps; ++Substep)
        {
            // ── ① integrate: Current + Prior → Spare ─────────────────────────────────────────────────────────────
            GL.bindFramebuffer(GL.FRAMEBUFFER, this.Targets[this.SpareSlot]);
            Device.UseProgram("FilamentIntegrate");
            Device.AssignSurface("CurrentSurface", this.Lattices[this.CurrentSlot], 0);
            Device.AssignSurface("PriorSurface",   this.Lattices[this.PriorSlot],   1);
            Device.AssignSurface("PoseSurface",    this.PoseSurface,                2);
            Device.AssignSurface("TuneSurface",    this.TuneSurface,                3);
            Device.Assign("JointExtent",  Extent);
            Device.Assign("DeltaTime",    Delta);
            Device.Assign("ElapsedTime",  Criteria.ElapsedTime + Substep * Delta);
            Device.Assign("GravityVector", Criteria.GravityVector);
            Device.Assign("WindDirection", Criteria.WindDirection);
            Device.Assign("WindCriteria",  Criteria.WindCriteria);
            Device.Assign("GroundHeight",  Criteria.GroundHeight);
            Device.Assign("ContactFriction", Criteria.ContactFriction ?? 0.55);
            Device.Assign("SelfSupport",     Criteria.SelfSupport ?? 0.95);
            GL.drawArrays(GL.TRIANGLES, 0, 3);

            // The positions that were Current before the advance become Prior. Swapping slots is free; copying
            //    would cost a full-lattice blit per substep.
            const WasCurrent = this.CurrentSlot;
            this.CurrentSlot = this.SpareSlot;
            this.SpareSlot   = this.PriorSlot;
            this.PriorSlot   = WasCurrent;

            // ── ② constrain: N Jacobi iterations ─────────────────────────────────────────────────────────────────
            const Iterations = Math.max(1, Criteria.IterationCount | 0);
            for (let Iteration = 0; Iteration < Iterations; ++Iteration)
            {
                GL.bindFramebuffer(GL.FRAMEBUFFER, this.Targets[this.SpareSlot]);
                Device.UseProgram("FilamentConstrain");
                Device.AssignSurface("CurrentSurface", this.Lattices[this.CurrentSlot], 0);
                Device.AssignSurface("PoseSurface",    this.PoseSurface,  1);
                Device.AssignSurface("ChainSurface",   this.ChainSurface, 2);
                Device.AssignSurface("ChildSurface",   this.ChildSurface, 3);
                Device.AssignSurface("TuneSurface",    this.TuneSurface,  4);
                Device.AssignSurface("StiffSurface",   this.StiffSurface, 5);
                Device.AssignSurface("AnchorSurface",  this.AnchorSurface, 6);
                Device.Assign("JointExtent", Extent);
                Device.Assign("ChildExtent", this.ChildExtent);
                Device.Assign("GroundHeight", Criteria.GroundHeight);
                Device.Assign("Restitution",  Criteria.Restitution);
                Device.Assign("RelaxationCount", Iterations * Substeps);
                Device.Assign("UnderRelaxation", Criteria.UnderRelaxation ?? 0.6);
                Device.Assign("StepSeconds",     Criteria.DeltaTime);
                Device.Assign("ColliderRecords", Criteria.ColliderRecords);
                Device.AssignInteger("ColliderCount", Criteria.ColliderCount);
                GL.drawArrays(GL.TRIANGLES, 0, 3);

                const Swap       = this.CurrentSlot;
                this.CurrentSlot = this.SpareSlot;
                this.SpareSlot   = Swap;
            }
        }

        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        return this.EndTiming();
    }

    //--------------------------------------------------------------------------------------------------------------
    // Live tuning. Rewrites only the two lattices that hold response coefficients, leaving positions and topology
    //    untouched, so a slider drag costs two texture uploads instead of a full regrow.

    RefreshTuning(Joints)
    {
        if (!this.Ready) return;

        const GL      = this.Device.Context;
        const Extent  = this.JointExtent[0];
        const Tune    = new Float32Array(Extent * Extent * 4);
        const Stiff   = new Float32Array(Extent * Extent * 4);

        for (let Index = 0; Index < Joints.length; ++Index)
        {
            const Joint = Joints[Index];
            const Write = Index * 4;

            Tune[Write] = Joint.Tune[0];  Tune[Write + 1] = Joint.Tune[1];
            Tune[Write + 2] = Joint.Tune[2];  Tune[Write + 3] = Joint.Tune[3];

            Stiff[Write] = Joint.Stiff[0];  Stiff[Write + 1] = Joint.Stiff[1];
            Stiff[Write + 2] = Joint.Stiff[2];  Stiff[Write + 3] = Joint.Stiff[3];
        }

        GL.bindTexture(GL.TEXTURE_2D, this.TuneSurface);
        GL.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, Extent, Extent, GL.RGBA, GL.FLOAT, Tune);
        GL.bindTexture(GL.TEXTURE_2D, this.StiffSurface);
        GL.texSubImage2D(GL.TEXTURE_2D, 0, 0, 0, Extent, Extent, GL.RGBA, GL.FLOAT, Stiff);
        GL.bindTexture(GL.TEXTURE_2D, null);
    }

    //--------------------------------------------------------------------------------------------------------------
    //                                                   DIAGNOSTICS
    //--------------------------------------------------------------------------------------------------------------
    // Reads the solved lattice back to the CPU. Deliberately NOT part of the frame loop — a readback stalls the
    //    pipeline — but indispensable when tuning the solver: it answers "is the plant standing up?" with a number
    //    instead of an opinion.

    ReadSolved(JointCount = this.JointCount)
    {
        if (!this.Ready) return null;

        const GL     = this.Device.Context;
        const Extent = this.JointExtent;
        const Texels = new Float32Array(Extent[0] * Extent[1] * 4);

        GL.bindFramebuffer(GL.FRAMEBUFFER, this.Targets[this.CurrentSlot]);
        GL.readPixels(0, 0, Extent[0], Extent[1], GL.RGBA, GL.FLOAT, Texels);
        GL.bindFramebuffer(GL.FRAMEBUFFER, null);

        let MinimumZ = Infinity, MaximumZ = -Infinity, Finite = 0;
        for (let Index = 0; Index < JointCount; ++Index)
        {
            const Height = Texels[Index * 4 + 2];
            if (!Number.isFinite(Height)) continue;
            ++Finite;
            if (Height < MinimumZ) MinimumZ = Height;
            if (Height > MaximumZ) MaximumZ = Height;
        }
        return { Texels, MinimumZ, MaximumZ, Finite, JointCount };
    }

    // Flat vec4 run the constrain phase expects, padded to the declared array length.
    static PackColliders(Colliders)
    {
        const Packed = new Float32Array(MaximumColliders * 4);
        const Count  = Math.min(Colliders.length, MaximumColliders);
        for (let Index = 0; Index < Count; ++Index)
        {
            Packed[Index * 4]     = Colliders[Index].Centre[0];
            Packed[Index * 4 + 1] = Colliders[Index].Centre[1];
            Packed[Index * 4 + 2] = Colliders[Index].Centre[2];
            Packed[Index * 4 + 3] = Colliders[Index].Radius;
        }
        return { Packed, Count };
    }
}
