//============================================================================================================================================
// 📦 FoliageProjection — builds the instanced card / tube geometry for a plot and draws every phase of the frame.
//============================================================================================================================================
// Draw order, per frame:
//    ① sky        — full-surface gradient at the far plane
//    ② ground     — the forest floor
//    ③ bark       — opaque tubes, depth write on
//    ④ foliage    — alpha-cutout cards, depth write on, culling off (cards are two-sided)
//    ⑤ collider   — translucent shell, depth write off, blended last
//
// The whole plot is exactly two instanced draws (③ and ④) regardless of plant count, because every plant's geometry
//    is skinned from one shared joint lattice. That is the payoff of solving the skeleton on the GPU.

export class FoliageProjection
{
    constructor(Device, ShaderIndex, SheetIndex)
    {
        this.Device = Device;
        this.Sheet  = SheetIndex;

        Device.CompileProgram("SkyRaster",      ShaderIndex.Query("SkyRaster"));
        Device.CompileProgram("GroundRaster",   ShaderIndex.Query("GroundRaster"));
        Device.CompileProgram("BranchRaster",   ShaderIndex.Query("BranchRaster"));
        Device.CompileProgram("FoliageRaster",  ShaderIndex.Query("FoliageRaster"));
        Device.CompileProgram("ColliderRaster", ShaderIndex.Query("ColliderRaster"));

        this.#CreateSheets();
        this.#CreateGeometry();

        this.CardCount = 0;
        this.TubeCount = 0;
    }

    //--------------------------------------------------------------------------------------------------------------
    //                                                     RESIDENCY
    //--------------------------------------------------------------------------------------------------------------

    #CreateSheets()
    {
        const Device  = this.Device;
        const Imagery = this.Sheet.Imagery;

        this.FoliageAlbedo  = Device.CreateSheet(Imagery.FoliageAlbedo);
        this.FoliageNormal  = Device.CreateSheet(Imagery.FoliageNormal);
        this.FoliageSurface = Device.CreateSheet(Imagery.FoliageSurface);
        this.BarkAlbedo     = Device.CreateSheet(Imagery.BarkAlbedo,   { Repeat: true });
        this.BarkNormal     = Device.CreateSheet(Imagery.BarkNormal,   { Repeat: true });
        this.BarkSurface    = Device.CreateSheet(Imagery.BarkSurface,  { Repeat: true });
        this.GroundAlbedo   = Device.CreateSheet(Imagery.GroundAlbedo, { Repeat: true });
        this.GroundNormal   = Device.CreateSheet(Imagery.GroundNormal, { Repeat: true });
        this.GroundSurface  = Device.CreateSheet(Imagery.GroundSurface,{ Repeat: true });
    }

    #CreateGeometry()
    {
        const GL     = this.Device.Context;
        const Device = this.Device;

        // Unit card: x ∈ [−0.5, 0.5] across the blade, y ∈ [0, 1] along it.
        this.CardCorner = Device.CreateAttribute(new Float32Array([
            -0.5, 0.0,   0.5, 0.0,   0.5, 1.0,
            -0.5, 0.0,   0.5, 1.0,  -0.5, 1.0
        ]));

        // Tube ring: a strip of RingSides quads spanning both ends of the bone. Eleven sides is the point where
        //    a trunk silhouette stops reading as a polygon at close range without doubling the vertex cost.
        const RingSides = 11;
        const Ring = [];
        for (let Side = 0; Side < RingSides; ++Side)
        {
            const Near = Side / RingSides;
            const Far  = (Side + 1) / RingSides;
            Ring.push(Near, 0,  Far, 0,  Far, 1);
            Ring.push(Near, 0,  Far, 1,  Near, 1);
        }
        this.RingCorner    = Device.CreateAttribute(new Float32Array(Ring));
        this.RingVertexCount = Ring.length / 2;

        this.PlaneCorner = Device.CreateAttribute(new Float32Array([
            -1, -1,   1, -1,   1, 1,
            -1, -1,   1, 1,   -1, 1
        ]));

        // Icosphere-ish shell for the collider: a UV sphere is fine and trivially cheap.
        const Stacks = 18, Slices = 28, Shell = [];
        const Point = (Stack, Slice) =>
        {
            const Polar     = Math.PI * (Stack / Stacks);
            const Azimuthal = 2.0 * Math.PI * (Slice / Slices);
            return [Math.sin(Polar) * Math.cos(Azimuthal), Math.sin(Polar) * Math.sin(Azimuthal), Math.cos(Polar)];
        };
        for (let Stack = 0; Stack < Stacks; ++Stack)
            for (let Slice = 0; Slice < Slices; ++Slice)
            {
                const A = Point(Stack, Slice), B = Point(Stack + 1, Slice);
                const C = Point(Stack + 1, Slice + 1), D = Point(Stack, Slice + 1);
                Shell.push(...A, ...B, ...C, ...A, ...C, ...D);
            }
        this.ShellPosition   = Device.CreateAttribute(new Float32Array(Shell));
        this.ShellVertexCount = Shell.length / 3;

        this.CardArray   = GL.createVertexArray();
        this.TubeArray   = GL.createVertexArray();
        this.PlaneArray  = GL.createVertexArray();
        this.ShellArray  = GL.createVertexArray();
        this.EmptyArray  = GL.createVertexArray();

        GL.bindVertexArray(this.PlaneArray);
        GL.bindBuffer(GL.ARRAY_BUFFER, this.PlaneCorner);
        GL.enableVertexAttribArray(0);
        GL.vertexAttribPointer(0, 2, GL.FLOAT, false, 0, 0);

        GL.bindVertexArray(this.ShellArray);
        GL.bindBuffer(GL.ARRAY_BUFFER, this.ShellPosition);
        GL.enableVertexAttribArray(0);
        GL.vertexAttribPointer(0, 3, GL.FLOAT, false, 0, 0);

        GL.bindVertexArray(null);
    }

    //--------------------------------------------------------------------------------------------------------------
    // Uploads the plot's instanced records. Called once per regrow.
    //--------------------------------------------------------------------------------------------------------------

    Reside(Cards, Tubes)
    {
        const GL     = this.Device.Context;
        const Device = this.Device;

        // ── cards ────────────────────────────────────────────────────────────────────────────────────────────────
        const CardRecord = new Float32Array(Cards.length * 16);
        for (let Index = 0; Index < Cards.length; ++Index)
        {
            const Card  = Cards[Index];
            const Write = Index * 16;

            CardRecord[Write]      = Card.JointA;
            CardRecord[Write + 1]  = Card.JointB;
            CardRecord[Write + 2]  = Card.Along;
            CardRecord[Write + 3]  = Card.CardScale;

            CardRecord[Write + 4]  = Card.Rect[0];
            CardRecord[Write + 5]  = Card.Rect[1];
            CardRecord[Write + 6]  = Card.Rect[2];
            CardRecord[Write + 7]  = Card.Rect[3];

            CardRecord[Write + 8]  = Card.Yaw;
            CardRecord[Write + 9]  = Card.Pitch;
            CardRecord[Write + 10] = Card.Roll;
            CardRecord[Write + 11] = Card.AnchorV;

            CardRecord[Write + 12] = Card.Tint[0];
            CardRecord[Write + 13] = Card.Tint[1];
            CardRecord[Write + 14] = Card.Tint[2];
            CardRecord[Write + 15] = Card.CardAspect ?? 1.0;   // keeps the cutout's proportions
        }

        if (this.CardRecord) GL.deleteBuffer(this.CardRecord);
        this.CardRecord = Device.CreateAttribute(CardRecord, GL.DYNAMIC_DRAW);
        this.CardCount  = Cards.length;

        GL.bindVertexArray(this.CardArray);
        GL.bindBuffer(GL.ARRAY_BUFFER, this.CardCorner);
        GL.enableVertexAttribArray(0);
        GL.vertexAttribPointer(0, 2, GL.FLOAT, false, 0, 0);
        GL.vertexAttribDivisor(0, 0);

        GL.bindBuffer(GL.ARRAY_BUFFER, this.CardRecord);
        for (let Slot = 1; Slot <= 4; ++Slot)
        {
            GL.enableVertexAttribArray(Slot);
            GL.vertexAttribPointer(Slot, 4, GL.FLOAT, false, 64, (Slot - 1) * 16);
            GL.vertexAttribDivisor(Slot, 1);
        }

        // ── tubes ────────────────────────────────────────────────────────────────────────────────────────────────
        // 16 floats: bone, criteria, then the two ring frames that keep consecutive rings in register.
        const TubeRecord = new Float32Array(Tubes.length * 16);
        for (let Index = 0; Index < Tubes.length; ++Index)
        {
            const Tube  = Tubes[Index];
            const Write = Index * 16;
            TubeRecord[Write]     = Tube.JointA;
            TubeRecord[Write + 1] = Tube.JointB;
            TubeRecord[Write + 2] = Tube.RadiusA;
            TubeRecord[Write + 3] = Tube.RadiusB;
            TubeRecord[Write + 4] = Tube.UvAround;
            TubeRecord[Write + 5] = Tube.Tint;
            TubeRecord[Write + 6] = 0.0;
            TubeRecord[Write + 7] = 0.0;
            TubeRecord[Write + 8]  = Tube.FrameA[0];
            TubeRecord[Write + 9]  = Tube.FrameA[1];
            TubeRecord[Write + 10] = Tube.FrameA[2];
            TubeRecord[Write + 11] = Tube.UvA;          // bark V at joint A
            TubeRecord[Write + 12] = Tube.FrameB[0];
            TubeRecord[Write + 13] = Tube.FrameB[1];
            TubeRecord[Write + 14] = Tube.FrameB[2];
            TubeRecord[Write + 15] = Tube.UvB;          // bark V at joint B
        }

        if (this.TubeRecord) GL.deleteBuffer(this.TubeRecord);
        this.TubeRecord = Device.CreateAttribute(TubeRecord, GL.DYNAMIC_DRAW);
        this.TubeCount  = Tubes.length;

        GL.bindVertexArray(this.TubeArray);
        GL.bindBuffer(GL.ARRAY_BUFFER, this.RingCorner);
        GL.enableVertexAttribArray(0);
        GL.vertexAttribPointer(0, 2, GL.FLOAT, false, 0, 0);
        GL.vertexAttribDivisor(0, 0);

        GL.bindBuffer(GL.ARRAY_BUFFER, this.TubeRecord);
        for (let Slot = 1; Slot <= 4; ++Slot)
        {
            GL.enableVertexAttribArray(Slot);
            GL.vertexAttribPointer(Slot, 4, GL.FLOAT, false, 64, (Slot - 1) * 16);
            GL.vertexAttribDivisor(Slot, 1);
        }

        GL.bindVertexArray(null);
    }

    //--------------------------------------------------------------------------------------------------------------
    //                                                       DRAW
    //--------------------------------------------------------------------------------------------------------------

    Draw(Criteria)
    {
        const GL     = this.Device.Context;
        const Device = this.Device;
        let   Draws  = 0;

        GL.bindFramebuffer(GL.FRAMEBUFFER, null);
        Device.Viewport(Criteria.Width, Criteria.Height);
        GL.clearColor(0.02, 0.03, 0.02, 1.0);
        GL.clearDepth(1.0);
        GL.clear(GL.COLOR_BUFFER_BIT | GL.DEPTH_BUFFER_BIT);

        GL.enable(GL.DEPTH_TEST);
        GL.depthFunc(GL.LEQUAL);
        GL.disable(GL.BLEND);

        // ── ① sky ────────────────────────────────────────────────────────────────────────────────────────────────
        GL.depthMask(false);
        Device.UseProgram("SkyRaster");
        Device.Assign("InverseViewProjection", Criteria.InverseViewProjection);
        Device.Assign("CameraOrigin",    Criteria.CameraOrigin);
        Device.Assign("SunDirection",    Criteria.SunDirection);
        Device.Assign("ZenithRadiance",  Criteria.ZenithRadiance);
        Device.Assign("HorizonRadiance", Criteria.HorizonRadiance);
        Device.Assign("SunRadiance",     Criteria.SunRadiance);
        GL.bindVertexArray(this.EmptyArray);
        GL.drawArrays(GL.TRIANGLES, 0, 3);
        ++Draws;
        GL.depthMask(true);

        // ── ② ground ─────────────────────────────────────────────────────────────────────────────────────────────
        if (Criteria.GroundOn)
        {
            GL.disable(GL.CULL_FACE);
            Device.UseProgram("GroundRaster");
            Device.Assign("ViewProjection",    Criteria.ViewProjection);
            Device.Assign("PlaneExtentMetres", Criteria.PlaneExtentMetres);
            Device.Assign("GroundHeight",      Criteria.GroundHeight);
            Device.Assign("CameraOrigin",      Criteria.CameraOrigin);
            Device.Assign("SunDirection",      Criteria.SunDirection);
            Device.Assign("SunRadiance",       Criteria.SunRadiance);
            Device.Assign("SkyRadiance",       Criteria.SkyRadiance);
            Device.Assign("GroundRadiance",    Criteria.GroundRadiance);
            Device.Assign("HorizonRadiance",   Criteria.HorizonRadiance);
            Device.Assign("FadeStartMetres",   Criteria.PlaneExtentMetres * 0.30);
            Device.AssignInteger("DebugCategory", Criteria.DebugCategory);
            Device.AssignSurface("GroundAlbedo",  this.GroundAlbedo,  0);
            Device.AssignSurface("GroundNormal",  this.GroundNormal,  1);
            Device.AssignSurface("GroundSurface", this.GroundSurface, 2);
            GL.bindVertexArray(this.PlaneArray);
            GL.drawArrays(GL.TRIANGLES, 0, 6);
            ++Draws;
        }

        // ── ③ bark ───────────────────────────────────────────────────────────────────────────────────────────────
        if (this.TubeCount > 0 && Criteria.ShowBranches)
        {
            GL.enable(GL.CULL_FACE);
            GL.cullFace(GL.BACK);
            Device.UseProgram("BranchRaster");
            Device.AssignSurface("CurrentSurface", Criteria.SolvedLattice, 0);
            Device.Assign("JointExtent",    Criteria.JointExtent);
            Device.Assign("ViewProjection", Criteria.ViewProjection);
            Device.Assign("CameraOrigin",   Criteria.CameraOrigin);
            Device.Assign("SunDirection",   Criteria.SunDirection);
            Device.Assign("SunRadiance",    Criteria.SunRadiance);
            Device.Assign("SkyRadiance",    Criteria.SkyRadiance);
            Device.Assign("GroundRadiance", Criteria.GroundRadiance);
            Device.AssignInteger("DebugCategory", Criteria.DebugCategory);
            Device.AssignSurface("BarkAlbedo",  this.BarkAlbedo,  1);
            Device.AssignSurface("BarkNormal",  this.BarkNormal,  2);
            Device.AssignSurface("BarkSurface", this.BarkSurface, 3);
            GL.bindVertexArray(this.TubeArray);
            GL.drawArraysInstanced(GL.TRIANGLES, 0, this.RingVertexCount, this.TubeCount);
            ++Draws;
        }

        // ── ④ foliage ────────────────────────────────────────────────────────────────────────────────────────────
        if (this.CardCount > 0 && Criteria.ShowFoliage)
        {
            GL.disable(GL.CULL_FACE);                 // cards are two-sided by definition
            Device.UseProgram("FoliageRaster");
            Device.AssignSurface("CurrentSurface", Criteria.SolvedLattice, 0);
            Device.Assign("JointExtent",    Criteria.JointExtent);
            Device.Assign("ViewProjection", Criteria.ViewProjection);
            Device.Assign("ElapsedTime",    Criteria.ElapsedTime);
            Device.Assign("WindCriteria",   Criteria.WindCriteria);
            Device.Assign("WindDirection",  Criteria.WindDirection);
            Device.Assign("CameraOrigin",   Criteria.CameraOrigin);
            Device.Assign("SunDirection",   Criteria.SunDirection);
            Device.Assign("SunRadiance",    Criteria.SunRadiance);
            Device.Assign("SkyRadiance",    Criteria.SkyRadiance);
            Device.Assign("GroundRadiance", Criteria.GroundRadiance);
            Device.Assign("AlphaCutoff",    Criteria.AlphaCutoff);
            Device.AssignInteger("DebugCategory", Criteria.DebugCategory);
            Device.AssignSurface("AlbedoSheet",  this.FoliageAlbedo,  1);
            Device.AssignSurface("NormalSheet",  this.FoliageNormal,  2);
            Device.AssignSurface("SurfaceSheet", this.FoliageSurface, 3);
            GL.bindVertexArray(this.CardArray);
            GL.drawArraysInstanced(GL.TRIANGLES, 0, 6, this.CardCount);
            ++Draws;
        }

        // ── ⑤ collider ───────────────────────────────────────────────────────────────────────────────────────────
        if (Criteria.ShowCollider && Criteria.ColliderCount > 0)
        {
            GL.enable(GL.BLEND);
            GL.blendFunc(GL.SRC_ALPHA, GL.ONE_MINUS_SRC_ALPHA);
            GL.depthMask(false);
            GL.disable(GL.CULL_FACE);
            Device.UseProgram("ColliderRaster");
            Device.Assign("ViewProjection", Criteria.ViewProjection);
            Device.Assign("CameraOrigin",   Criteria.CameraOrigin);
            Device.Assign("SunDirection",   Criteria.SunDirection);
            GL.bindVertexArray(this.ShellArray);

            for (let Index = 0; Index < Criteria.ColliderCount; ++Index)
            {
                const Record = Criteria.Colliders[Index];
                Device.Assign("ColliderRecord", [Record.Centre[0], Record.Centre[1], Record.Centre[2], Record.Radius]);
                Device.Assign("ShellTint", Record.Held ? [0.42, 0.47, 1.0, 0.20] : [0.55, 0.58, 0.62, 0.11]);
                GL.drawArrays(GL.TRIANGLES, 0, this.ShellVertexCount);
                ++Draws;
            }

            GL.depthMask(true);
            GL.disable(GL.BLEND);
        }

        GL.bindVertexArray(null);
        return Draws;
    }
}
