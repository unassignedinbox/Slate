//============================================================================================================================================
// 📦 SketcherHost — root coordinator: owns the plot, the solver, the renderer, the docket and the frame loop.
//============================================================================================================================================
// The one place where everything meets. Responsibilities, in order:
//    ① acquire the baked sheet and the shader sources
//    ② grow the plot on the CPU (GrowthSolver) and make it resident on the GPU (FilamentSolver, FoliageProjection)
//    ③ per frame: step the GPU solver, draw the phases, publish telemetry
//    ④ translate pointer and key input into camera, collider and docket intent

import { DeviceExchange, ShaderIndex } from "./DeviceExchange.mjs";
import { FilamentSolver }              from "./FilamentSolver.mjs";
import { FoliageProjection }             from "./FoliageProjection.mjs";
import { GrowthSolver, SeededSequence } from "./GrowthSolver.mjs";
import { OrbitProjection, InvertMatrix } from "./OrbitProjection.mjs";
import { SheetIndex }                  from "./SheetIndex.mjs";
import { DocketPanel }                 from "./DocketPanel.mjs";
import {
    CloneArchetype, DefaultEnvironment, DefaultScatter, SpeciesArchetype
} from "./SpeciesCriteria.mjs";

const FamilyCode = { Broadleaf: 0, Fern: 1, VineLeaf: 2, Tendril: 3, Flower: 4, Grass: 5 };

class SketcherHost
{
    constructor()
    {
        this.Canvas      = document.getElementById("Viewport");
        this.Camera      = new OrbitProjection();
        this.Criteria    = CloneArchetype("CanopyTree");
        this.Scatter     = { ...DefaultScatter, Companions: [...DefaultScatter.Companions] };
        this.Environment = { ...DefaultEnvironment, ShowFoliage: true, ShowBranches: true };
        this.Seed        = 20260908;

        this.ElapsedTime   = 0.0;
        this.FrameMillis   = 0.0;
        this.SolveMillis   = 0.0;
        this.SmoothedFrame = 16.7;
        this.RegrowPending = false;
        this.DrawCount     = 0;

        this.Colliders =
        [
            { Centre: [1.15, -0.55, 0.85], Radius: 0.52, Held: false }
        ];
    }

    //--------------------------------------------------------------------------------------------------------------
    //                                                       BOOT
    //--------------------------------------------------------------------------------------------------------------

    async Begin()
    {
        const Note = document.getElementById("CurtainNote");
        const Report = (Text) => { Note.textContent = Text; };

        try
        {
            this.Sheet  = await SheetIndex.Acquire(Report);

            Report("Compiling shader phases…");
            const Shaders = await ShaderIndex.Acquire([
                "FilamentIntegrate", "FilamentConstrain", "FoliageRaster",
                "BranchRaster", "GroundRaster", "ColliderRaster", "SkyRaster"
            ]);

            this.Device   = new DeviceExchange(this.Canvas);
            this.Solver   = new FilamentSolver(this.Device, Shaders);
            this.Renderer = new FoliageProjection(this.Device, Shaders, this.Sheet);
            this.Growth   = new GrowthSolver(this.Sheet);

            Report("Growing the plot…");
            this.Regrow();

            this.Docket = new DocketPanel(this);
            this.#AttachInput();

            document.getElementById("Curtain").classList.add("gone");
            requestAnimationFrame((Now) => this.#Frame(Now));
        }
        catch (Failure)
        {
            Note.textContent = String(Failure.message ?? Failure);
            Note.classList.add("bad");
            console.error(Failure);
        }
    }

    //--------------------------------------------------------------------------------------------------------------
    //                                                      PLOT
    //--------------------------------------------------------------------------------------------------------------

    Reseed()
    {
        this.Seed = (Math.random() * 0x7FFFFFFF) | 0;
        this.Regrow();
    }

    ResetSpecies()
    {
        this.Criteria = CloneArchetype(this.Criteria.Archetype);
        this.Docket?.Rebuild();
        this.Regrow();
    }

    AssignArchetype(Key)
    {
        this.Criteria = CloneArchetype(Key);
        this.Docket?.Rebuild();
        this.Regrow();
    }

    // Coalesces a burst of slider input into one regrow on the next frame.
    RequestRegrow() { this.RegrowPending = true; }

    Regrow()
    {
        const Started = performance.now();
        const Random  = SeededSequence(this.Seed ^ 0x9E3779B9);

        const Joints = [];
        const Cards  = [];
        const Tubes  = [];

        // ── the hero plant, centred ──────────────────────────────────────────────────────────────────────────────
        this.#Absorb(this.Growth.Grow(this.Criteria, [0, 0, 0], this.Seed, 1.0), Joints, Cards, Tubes);

        // ── the scatter ──────────────────────────────────────────────────────────────────────────────────────────
        const Species = [this.Criteria.Archetype, ...this.Scatter.Companions];
        const Count   = Math.max(0, Math.round(this.Scatter.PlantCount) - 1);

        for (let Index = 0; Index < Count; ++Index)
        {
            // Clustered sunflower distribution: the golden angle gives an even fill, and raising the radius to a
            //    power biased by ClusterBias pulls plants toward the centre so clearings and thickets appear.
            const Angle    = Index * 2.39996323;
            const Spread   = Math.pow((Index + 0.5) / Math.max(1, Count), 0.5 + this.Scatter.ClusterBias * 0.85);
            const Radius   = Spread * this.Scatter.PlotRadius * (0.72 + Random() * 0.45);
            const Jitter   = (Random() - 0.5) * 0.55;
            const Origin   = [
                Math.cos(Angle + Jitter) * Radius,
                Math.sin(Angle + Jitter) * Radius,
                0.0
            ];

            // Keep the hero plant's footprint clear so it stays readable.
            if (Math.hypot(Origin[0], Origin[1]) < 0.55) continue;

            const Key      = Species[Math.floor(Random() * Species.length)];
            const Criteria = Key === this.Criteria.Archetype ? this.Criteria : SpeciesArchetype[Key];
            const Scale    = 1.0 - this.Scatter.ScaleSpread * 0.5 + Random() * this.Scatter.ScaleSpread;

            this.#Absorb(this.Growth.Grow(Criteria, Origin, (this.Seed + Index * 7919) | 0, Scale), Joints, Cards, Tubes);
        }

        // ── child spans ──────────────────────────────────────────────────────────────────────────────────────────
        // Flattened so the constrain phase can walk a joint's children with one (offset, count) pair.
        const ChildSpans = [];
        for (const Joint of Joints)
        {
            Joint.ChildOffset = ChildSpans.length;
            Joint.ChildCount  = Math.min(8, Joint.Children.length);
            for (let Slot = 0; Slot < Joint.ChildCount; ++Slot) ChildSpans.push(Joint.Children[Slot]);
        }

        const Residency = this.Solver.Reside(Joints, ChildSpans);
        this.Renderer.Reside(Cards, Tubes);

        this.RestHeights = Joints.map((Joint) => Joint.Position[2]);
        this.RestJoints  = Joints;          // retained for diagnostics: lets a probe compare GPU state to the grown pose
        this.JointCount = Joints.length;
        this.GrowMillis = performance.now() - Started;
        this.RegrowPending = false;

        this.Docket?.ReportSubtitle(
            `${this.Scatter.PlantCount} plants · ${Residency.LatticeExtent}² lattice`);
        this.#PublishHint();
    }

    // Rebases one grown plant's indices onto the plot-wide joint list.
    #Absorb(Plant, Joints, Cards, Tubes)
    {
        const Offset = Joints.length;
        const TrunkRadius = Plant.Joints[1]?.Tune?.[2] ?? 0.0;

        for (const Joint of Plant.Joints)
        {
            Joints.push({
                Position:    Joint.Position,
                Pose:        Joint.Pose,
                ParentIndex: Joint.ParentIndex < 0 ? -1 : Joint.ParentIndex + Offset,
                RestLength:  Joint.RestLength,
                InverseMass: Joint.InverseMass,
                Children:    Joint.Children.map((Index) => Index + Offset),
                Tune:        Joint.Tune,
                Order:       Joint.Order,
                Along:       Joint.Along,
                // Trunk self-collision is disabled for the scatter: those plants are not centred on the origin,
                //    and the cylindrical test in the constrain phase is expressed about the world axis.
                Stiff:       [Joint.Stiff[0], Joint.Stiff[1], Joint.Stiff[2], 0.0]
            });
        }

        for (const Card of Plant.Cards)
            Cards.push({
                ...Card,
                JointA: Card.JointA + Offset,
                JointB: Card.JointB + Offset,
                FamilyCode: FamilyCode[Card.Family] ?? 0
            });

        for (const Tube of Plant.Tubes)
            Tubes.push({ ...Tube, JointA: Tube.JointA + Offset, JointB: Tube.JointB + Offset });
    }

    // Live physics tuning without a topology rebuild: the docket's Physics tab writes straight into the lattice.
    RefreshTuning()
    {
        if (!this.Solver?.Ready || !this.RestJoints) return;

        // Physics tunables do not change the topology or the grown pose, only how that pose responds — so they are
        //    rewritten straight into the lattice. Regrowing instead would rebuild every card and tube on each
        //    slider frame, which stutters a 2,700-joint plot and needlessly re-randomises it under the user.
        const Criteria = this.Criteria;
        const Woody    = Criteria.Silhouette === "Tree" || Criteria.Silhouette === "Shrub";

        for (const Joint of this.RestJoints)
        {
            const Along    = Joint.Along ?? 0.0;
            const Softness = Criteria.TipSoftness * Along;
            let   Bend     = Math.max(0.005, Criteria.BendStiffness * (1.0 - Softness * 0.92));

            if (Woody)
            {
                const Order = Joint.Order ?? 0;
                Bend = Math.min(0.999, Math.max(0.005,
                    1.0 - (1.0 - Bend) * Math.pow(0.42, Math.max(0, 2 - Order))));
            }

            Joint.Stiff[0] = Bend;
            Joint.Stiff[2] = Criteria.Recovery ?? (Woody ? 0.45 : 0.90);
            Joint.Tune[0]  = Criteria.WindGain;
            Joint.Tune[1]  = Criteria.Drag;
        }

        this.Solver.RefreshTuning(this.RestJoints);
    }

    //--------------------------------------------------------------------------------------------------------------
    //                                                      FRAME
    //--------------------------------------------------------------------------------------------------------------

    #Frame(Now)
    {
        const Delta = Math.min(0.05, (Now - (this.PreviousNow ?? Now)) / 1000.0);
        this.PreviousNow = Now;
        this.ElapsedTime += Delta;

        if (this.RegrowPending) this.Regrow();

        const Started = performance.now();
        this.#Resize();

        const Environment = this.Environment;
        const Width  = this.Canvas.width;
        const Height = this.Canvas.height;
        const Aspect = Width / Math.max(1, Height);

        // ── wind and sun ─────────────────────────────────────────────────────────────────────────────────────────
        const Bearing = Environment.WindBearing;
        const WindDirection = [Math.cos(Bearing), Math.sin(Bearing), -0.06];

        // A slow breathing gust on top of the shader's turbulence, plus the impulse the space bar adds.
        this.GustImpulse = Math.max(0.0, (this.GustImpulse ?? 0.0) - Delta * 1.15);
        const Gust = 0.35 * Math.sin(this.ElapsedTime * 0.41) + 0.22 * Math.sin(this.ElapsedTime * 0.17) + this.GustImpulse;

        const SunElevation = Environment.SunElevation;
        const SunBearing   = Environment.SunBearing;
        const SunDirection = [
            Math.cos(SunElevation) * Math.cos(SunBearing),
            Math.cos(SunElevation) * Math.sin(SunBearing),
            Math.sin(SunElevation)
        ];

        const SunWarmth  = Math.max(0.0, 1.0 - Math.sin(SunElevation));
        const SunRadiance = [
            Environment.SunIntensity * (1.0 + SunWarmth * 0.35),
            Environment.SunIntensity * (1.0 - SunWarmth * 0.12),
            Environment.SunIntensity * (1.0 - SunWarmth * 0.34)
        ];
        const SkyRadiance    = [0.34 * Environment.SkyIntensity, 0.46 * Environment.SkyIntensity, 0.66 * Environment.SkyIntensity];
        const GroundRadiance = [0.16 * Environment.SkyIntensity, 0.15 * Environment.SkyIntensity, 0.10 * Environment.SkyIntensity];

        // ── ① solve ──────────────────────────────────────────────────────────────────────────────────────────────
        const { Packed, Count } = FilamentSolver.PackColliders(Environment.CollisionOn ? this.Colliders : []);

        const SolveMillis = this.Solver.Step({
            DeltaTime:      Delta,
            ElapsedTime:    this.ElapsedTime,
            SubstepCount:   Environment.SubstepCount,
            IterationCount: Environment.IterationCount,
            GravityVector:  [0, 0, -Environment.Gravity],
            WindDirection,
            WindCriteria:   [Environment.WindStrength, Environment.WindTurbulence, Gust, Environment.WindFlutter],
            GroundHeight:    0.0,
            Restitution:     0.55,
            ContactFriction: 0.55,
            UnderRelaxation: Environment.UnderRelaxation,
            SelfSupport:     this.Criteria.SelfSupport ?? 0.95,
            ColliderRecords: Packed,
            ColliderCount:   Count
        });

        // Real GPU elapsed time when the timer extension exists; the readout says so either way.
        this.SolveTimed  = Number.isFinite(SolveMillis) && SolveMillis > 0.0;
        if (this.SolveTimed) this.SolveMillis = this.SolveMillis * 0.9 + SolveMillis * 0.1;

        // ── ② draw ───────────────────────────────────────────────────────────────────────────────────────────────
        const ViewProjection = this.Camera.QueryViewProjection(Aspect);
        this.DrawCount = this.Renderer.Draw({
            Width, Height,
            ViewProjection,
            InverseViewProjection: InvertMatrix(ViewProjection),
            CameraOrigin:   this.Camera.QueryEye(),
            SolvedLattice:  this.Solver.QuerySolved(),
            JointExtent:    this.Solver.QueryExtent(),
            ElapsedTime:    this.ElapsedTime,
            WindCriteria:   [Environment.WindStrength, Environment.WindTurbulence, Gust, Environment.WindFlutter],
            WindDirection,
            SunDirection,
            SunRadiance,
            SkyRadiance,
            GroundRadiance,
            ZenithRadiance:  [0.16 * Environment.SkyIntensity + 0.02, 0.28 * Environment.SkyIntensity + 0.04, 0.52 * Environment.SkyIntensity + 0.08],
            HorizonRadiance: [0.52 * Environment.SkyIntensity + 0.05, 0.58 * Environment.SkyIntensity + 0.06, 0.62 * Environment.SkyIntensity + 0.07],
            AlphaCutoff:     0.42,
            PlaneExtentMetres: Math.max(24.0, this.Scatter.PlotRadius * 5.0),
            GroundHeight:    0.0,
            GroundOn:        Environment.GroundOn,
            ShowFoliage:     Environment.ShowFoliage,
            ShowBranches:    Environment.ShowBranches,
            ShowCollider:    Environment.ShowCollider,
            DebugCategory:   Environment.DebugCategory,
            Colliders:       this.Colliders,
            ColliderCount:   Environment.CollisionOn ? this.Colliders.length : 0
        });

        this.FrameMillis   = performance.now() - Started;
        this.SmoothedFrame = this.SmoothedFrame * 0.92 + Delta * 1000.0 * 0.08;
        this.#PublishTelemetry();

        requestAnimationFrame((Next) => this.#Frame(Next));
    }

    #Resize()
    {
        const Ratio  = Math.min(window.devicePixelRatio || 1.0, 2.0);
        const Width  = Math.round(this.Canvas.clientWidth  * Ratio);
        const Height = Math.round(this.Canvas.clientHeight * Ratio);
        if (this.Canvas.width !== Width || this.Canvas.height !== Height)
        {
            this.Canvas.width  = Width;
            this.Canvas.height = Height;
        }
    }

    #PublishTelemetry()
    {
        const Rate = 1000.0 / Math.max(0.001, this.SmoothedFrame);
        const Frame = document.getElementById("ReadFrame");
        Frame.textContent = `${this.SmoothedFrame.toFixed(1)} ms · ${Rate.toFixed(0)}`;
        Frame.className   = `rv ${Rate >= 55 ? "good" : Rate >= 30 ? "" : "warn"}`;

        document.getElementById("ReadSolve").textContent =
            this.SolveTimed ? `${this.SolveMillis.toFixed(2)} ms` : "not timed";
        document.getElementById("ReadJoints").textContent = this.JointCount.toLocaleString();
        document.getElementById("ReadCards").textContent  = this.Renderer.CardCount.toLocaleString();
        document.getElementById("ReadDraws").textContent  = String(this.DrawCount);
    }

    #PublishHint()
    {
        const Iterations = this.Environment.IterationCount * this.Environment.SubstepCount;
        this.Docket?.ReportHint(
            `${this.JointCount.toLocaleString()} joints · ${this.Renderer.CardCount.toLocaleString()} cards · ` +
            `${Iterations} solver passes · grown in ${this.GrowMillis.toFixed(0)} ms`);
    }

    //--------------------------------------------------------------------------------------------------------------
    //                                                      INPUT
    //--------------------------------------------------------------------------------------------------------------

    #AttachInput()
    {
        const Canvas = this.Canvas;
        let Mode = "none";
        let LastX = 0, LastY = 0;

        const PointerRay = (Event) =>
        {
            const Rect = Canvas.getBoundingClientRect();
            return this.Camera.QueryRay(
                Event.clientX - Rect.left, Event.clientY - Rect.top,
                Rect.width, Rect.height, Rect.width / Math.max(1, Rect.height));
        };

        Canvas.addEventListener("contextmenu", (Event) => Event.preventDefault());

        Canvas.addEventListener("pointerdown", (Event) =>
        {
            Canvas.setPointerCapture(Event.pointerId);
            LastX = Event.clientX; LastY = Event.clientY;

            // Grab the collider if the ray hits its shell.
            if (Event.button === 0 && this.Environment.ShowCollider)
            {
                const Ray = PointerRay(Event);
                const Hit = this.#PickCollider(Ray);
                if (Hit >= 0)
                {
                    Mode = "collider";
                    this.HeldCollider = Hit;
                    this.Colliders[Hit].Held = true;

                    // Drag across the plane through the collider that faces the camera.
                    const Centre = this.Colliders[Hit].Centre;
                    const { Forward } = this.Camera.QueryBasis();
                    this.DragNormal = [-Forward[0], -Forward[1], -Forward[2]];
                    this.DragOffset = [
                        Centre[0] - Ray.Origin[0], Centre[1] - Ray.Origin[1], Centre[2] - Ray.Origin[2]];
                    return;
                }
            }

            Mode = Event.button === 0 ? "orbit" : "pan";
            Canvas.classList.add("dragging");
        });

        Canvas.addEventListener("pointermove", (Event) =>
        {
            const DeltaX = Event.clientX - LastX;
            const DeltaY = Event.clientY - LastY;
            LastX = Event.clientX; LastY = Event.clientY;

            if (Mode === "orbit") this.Camera.Orbit(DeltaX, DeltaY);
            else if (Mode === "pan") this.Camera.Pan(DeltaX, DeltaY);
            else if (Mode === "collider" && this.HeldCollider >= 0)
            {
                const Ray = PointerRay(Event);
                const Collider = this.Colliders[this.HeldCollider];

                // Intersect the view-facing plane that passes through the collider's current centre.
                const Normal = this.DragNormal;
                const Denominator = Ray.Direction[0]*Normal[0] + Ray.Direction[1]*Normal[1] + Ray.Direction[2]*Normal[2];
                if (Math.abs(Denominator) > 1.0e-5)
                {
                    const ToPlane = [
                        Collider.Centre[0] - Ray.Origin[0],
                        Collider.Centre[1] - Ray.Origin[1],
                        Collider.Centre[2] - Ray.Origin[2]];
                    const Along = (ToPlane[0]*Normal[0] + ToPlane[1]*Normal[1] + ToPlane[2]*Normal[2]) / Denominator;
                    Collider.Centre = [
                        Ray.Origin[0] + Ray.Direction[0] * Along,
                        Ray.Origin[1] + Ray.Direction[1] * Along,
                        Math.max(Collider.Radius * 0.35, Ray.Origin[2] + Ray.Direction[2] * Along)
                    ];
                }
            }
        });

        const Release = () =>
        {
            Mode = "none";
            Canvas.classList.remove("dragging");
            if (this.HeldCollider >= 0 && this.Colliders[this.HeldCollider])
                this.Colliders[this.HeldCollider].Held = false;
            this.HeldCollider = -1;
        };
        Canvas.addEventListener("pointerup", Release);
        Canvas.addEventListener("pointercancel", Release);

        Canvas.addEventListener("wheel", (Event) =>
        {
            Event.preventDefault();
            this.Camera.Dolly(Event.deltaY);
        }, { passive: false });

        window.addEventListener("keydown", (Event) =>
        {
            if (Event.code === "Space")   { Event.preventDefault(); this.GustImpulse = 2.2; }
            if (Event.code === "KeyR")    this.Reseed();
            if (Event.code === "KeyF")    { this.Camera.Target = [0, 0, 1.1]; this.Camera.Distance = 7.4; }
        });
    }

    // Console probe for solver tuning: compares the grown rest pose against what the GPU actually settled on.
    QuerySolverState()
    {
        const Solved = this.Solver.ReadSolved();
        if (!Solved) return null;

        let RestMaximum = -Infinity;
        for (const Height of this.RestHeights ?? []) if (Height > RestMaximum) RestMaximum = Height;

        return {
            JointCount:   this.JointCount,
            CardCount:    this.Renderer.CardCount,
            FiniteJoints: Solved.Finite,
            SolvedLow:    Number(Solved.MinimumZ.toFixed(3)),
            SolvedHigh:   Number(Solved.MaximumZ.toFixed(3)),
            RestHigh:     Number(RestMaximum.toFixed(3)),
            Sag:          Number((RestMaximum - Solved.MaximumZ).toFixed(3))
        };
    }

    #PickCollider(Ray)
    {
        let Best = -1, BestAlong = Infinity;
        for (let Index = 0; Index < this.Colliders.length; ++Index)
        {
            const Collider = this.Colliders[Index];
            const Offset = [
                Ray.Origin[0] - Collider.Centre[0],
                Ray.Origin[1] - Collider.Centre[1],
                Ray.Origin[2] - Collider.Centre[2]];

            const B = 2.0 * (Offset[0]*Ray.Direction[0] + Offset[1]*Ray.Direction[1] + Offset[2]*Ray.Direction[2]);
            const C = Offset[0]*Offset[0] + Offset[1]*Offset[1] + Offset[2]*Offset[2] - Collider.Radius * Collider.Radius;
            const Discriminant = B * B - 4.0 * C;
            if (Discriminant < 0.0) continue;

            const Along = (-B - Math.sqrt(Discriminant)) * 0.5;
            if (Along > 0.0 && Along < BestAlong) { BestAlong = Along; Best = Index; }
        }
        return Best;
    }
}

const Host = new SketcherHost();
window.SketcherHost = Host;          // console probe hook (development only)
Host.Begin();
