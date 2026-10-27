//============================================================================================================================================
// 📦 GrowthSolver — parametric L-system growth: species criteria → filament skeleton + foliage cards + bark tubes.
//============================================================================================================================================
// Pure and deterministic: the same criteria and seed always yield the same plant, which is what lets a level store a
//    two-integer seed instead of a mesh. Nothing here touches WebGL; the output is plain arrays that SketcherHost
//    uploads. That seam is deliberate — the C++/Vulkan port replaces the uploader, not this file.
//
// Skeleton topology
//    Every plant is a set of chains. A chain is a run of joints connected parent → child. Joint 0 of the plant is
//    pinned (inverse mass 0) at the ground; every later joint carries mass and is solved on the GPU. Branches simply
//    attach their first joint to a joint of the parent chain, so the whole plant is one tree of joints in one flat
//    list — which is exactly the layout the solver's lattice wants.

import { Radians } from "./SpeciesCriteria.mjs";

//------------------------------------------------------------------------------------------------------------------------
//                                                    DETERMINISTIC NOISE
//------------------------------------------------------------------------------------------------------------------------

// Mulberry32 — small, fast, well-distributed. Seeded per plant so a plot regenerates identically.
export function SeededSequence(Seed)
{
    let Register = Seed >>> 0;
    return function Next()
    {
        Register |= 0; Register = (Register + 0x6D2B79F5) | 0;
        let Mixed = Math.imul(Register ^ (Register >>> 15), 1 | Register);
        Mixed = (Mixed + Math.imul(Mixed ^ (Mixed >>> 7), 61 | Mixed)) ^ Mixed;
        return ((Mixed ^ (Mixed >>> 14)) >>> 0) / 4294967296;
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     VECTOR HELPERS
//------------------------------------------------------------------------------------------------------------------------

const Add    = (A, B) => [A[0] + B[0], A[1] + B[1], A[2] + B[2]];
const Scale  = (A, S) => [A[0] * S, A[1] * S, A[2] * S];
const Length = (A)    => Math.hypot(A[0], A[1], A[2]);

function Normalise(A)
{
    const L = Length(A) || 1.0;
    return [A[0] / L, A[1] / L, A[2] / L];
}

function Cross(A, B)
{
    return [A[1] * B[2] - A[2] * B[1], A[2] * B[0] - A[0] * B[2], A[0] * B[1] - A[1] * B[0]];
}

// Rodrigues rotation of Subject about unit Axis by Angle — the CPU twin of RotateBetween in CommonRecords.glsl.
function RotateAbout(Subject, Axis, Angle)
{
    const Cos = Math.cos(Angle), Sin = Math.sin(Angle);
    const Dot = Axis[0] * Subject[0] + Axis[1] * Subject[1] + Axis[2] * Subject[2];
    const Perp = Cross(Axis, Subject);
    return [
        Subject[0] * Cos + Perp[0] * Sin + Axis[0] * Dot * (1.0 - Cos),
        Subject[1] * Cos + Perp[1] * Sin + Axis[1] * Dot * (1.0 - Cos),
        Subject[2] * Cos + Perp[2] * Sin + Axis[2] * Dot * (1.0 - Cos)
    ];
}

// Any unit vector perpendicular to Direction.
function Perpendicular(Direction)
{
    const Reference = Math.abs(Direction[2]) > 0.94 ? [0, 1, 0] : [0, 0, 1];
    return Normalise(Cross(Reference, Direction));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     GROWTH SOLVER
//------------------------------------------------------------------------------------------------------------------------

export class GrowthSolver
{
    // SheetIndex: the decoded FoliageSheet.toml — cutouts grouped by family, used to pick a card per attachment.
    constructor(SheetIndex)
    {
        this.SheetIndex = SheetIndex;
    }

    //--------------------------------------------------------------------------------------------------------------
    // Grows one plant. Origin is the world-space root [m]; Scale multiplies every length.
    //--------------------------------------------------------------------------------------------------------------
    Grow(Criteria, Origin, Seed, Scale = 1.0)
    {
        const Random = SeededSequence(Seed);

        const Plant =
        {
            Joints:  [],     // { Position, Pose, ParentIndex, RestLength, InverseMass, Tune, Stiff, Children }
            Cards:   [],     // { JointA, JointB, Along, CardScale, Rect, Yaw, Pitch, Roll, AnchorV, Tint, Family }
            Tubes:   [],     // { JointA, JointB, RadiusA, RadiusB, UvAlong, UvAround, Tint, UvOffset }
            Origin, Seed, Scale
        };

        const Silhouette = Criteria.Silhouette ?? "Tree";
        const Height     = Criteria.Height * Scale;

        // The root joint is pinned: it is the plant's contract with the ground.
        const RootIndex = this.#PushJoint(Plant,
        {
            Position: [...Origin], Pose: [0, 0, 1], ParentIndex: -1, RestLength: 0,
            InverseMass: 0.0, HeightRatio: 0.0, Criteria, Scale
        });

        if (Silhouette === "Rosette")
        {
            // Rosette: no trunk to speak of — every frond springs from the crown of a very short stub.
            const StubTop = this.#GrowChain(Plant, Criteria, RootIndex, [0, 0, 1],
                Math.max(0.04, Height * 0.12), Math.max(2, Math.round(Criteria.SegmentCount * 0.35)),
                1.0, 0, Random, Scale);
            this.#Radiate(Plant, Criteria, StubTop, Height, Random, Scale, 1);
        }
        else if (Silhouette === "Vine")
        {
            // Vine: one long limp chain that flops, with a few side runners. It sets off low and mostly sideways
            //    — a creeper explores along the ground looking for something to climb, it does not launch
            //    vertically. Starting it upright made every runner arc clean over the plot like a dropped cable.
            const Bearing = Random() * Math.PI * 2.0;
            const Tip = this.#GrowChain(Plant, Criteria, RootIndex, Normalise([
                Math.cos(Bearing), Math.sin(Bearing), 0.42 + Random() * 0.5]),
                Height, Criteria.SegmentCount, 1.0, 0, Random, Scale);
            this.#Branch(Plant, Criteria, RootIndex, Tip, Height, Random, Scale, 1);
        }
        else
        {
            // Tree / shrub: a trunk with recursive orders of branches.
            // Height is the height of the PLANT, not of its trunk. Branches leaving the upper trunk at an angle
            //    still carry it upward, so growing a full-height trunk and then adding orders on top overshoots
            //    the target by roughly 2× (measured: 12.57 m for a 6.2 m canopy tree). The trunk is given the
            //    share the crown does not contribute, and the crown makes up the rest.
            const CrownReach = Criteria.LengthFalloff * Math.cos(Criteria.BranchAngle) * (1.0 - Criteria.BranchStart);
            const TrunkShare = 1.0 / (1.0 + Math.max(0.0, CrownReach));

            const Tip = this.#GrowChain(Plant, Criteria, RootIndex, [0, 0, 1],
                Height * TrunkShare, Criteria.SegmentCount, 1.0, 0, Random, Scale);
            this.#Branch(Plant, Criteria, RootIndex, Tip, Height * TrunkShare, Random, Scale, 1);
        }

        // Thickness and bark can only be decided once every branch exists.
        this.#ResolveThickness(Plant, Criteria, Scale);
        this.#EmitTubes(Plant, Criteria);

        return Plant;
    }

    //--------------------------------------------------------------------------------------------------------------
    // One run of joints. Returns the index of the final joint so the caller can keep branching from it.
    //--------------------------------------------------------------------------------------------------------------
    #GrowChain(Plant, Criteria, ParentIndex, Direction, TotalLength, SegmentCount, RadiusFraction, Order, Random, Scale)
    {
        const Count      = Math.max(1, Math.round(SegmentCount));
        const Segment    = TotalLength / Count;

        let Current   = ParentIndex;
        let Heading   = Normalise(Direction);
        let Position  = [...Plant.Joints[ParentIndex].Position];

        // Ring frame, carried along the strand by parallel transport. Letting each segment pick its own reference
        //    axis (the obvious thing) makes consecutive rings disagree about where angle zero is, so the bark
        //    corkscrews between segments and the limb stops reading as one surface. Rotating ONE frame along the
        //    curve keeps every ring in register, which is what makes a swept tube look like a branch.
        //    A child strand inherits its host's frame so the bark runs continuously across the junction instead
        //    of restarting at an arbitrary angle.
        const Inherited = Plant.Joints[ParentIndex].Frame;
        let   Frame     = Inherited ? Orthogonalise(Inherited, Heading) : Perpendicular(Heading);

        // Arc length carried from the host, so bark texture runs unbroken across a junction.
        let Travelled = Plant.Joints[ParentIndex].UvDistance ?? 0.0;

        // One tint per strand. Randomising per joint put a brightness step at every ring.
        const StrandTint = 0.86 + Random() * 0.26;


        for (let Step = 0; Step < Count; ++Step)
        {
            const Along = (Step + 1) / Count;
            const PriorHeading = [...Heading];

            // Gnarl: a small random turn per segment, the thing that stops procedural plants looking like antennae.
            const Wobble = Criteria.Gnarl * 0.42;
            if (Wobble > 0.0)
            {
                const Side = Perpendicular(Heading);
                const Turn = RotateAbout(Side, Heading, Random() * Math.PI * 2.0);
                Heading    = Normalise(Add(Heading, Scale3(Turn, (Random() - 0.5) * Wobble)));
            }

            // Droop pulls the heading down, tropism pulls it back up toward the light. Both strengthen along
            //    the chain so a limb leaves the trunk stiff and ends up nodding.
            const Weight = Math.pow(Along, 1.35);
            Heading = Normalise(Add(Heading, [0, 0, -Criteria.Droop * Weight * 0.55]));
            Heading = Normalise(Add(Heading, [0, 0,  Criteria.Tropism * Weight * 0.30]));

            // A shoot cannot grow into the ground. Droop and gravitropism can aim a long runner straight down,
            //    and nothing stopped it: strands were growing to two metres BELOW the floor, where the solver's
            //    ground clamp then shoved them back up — a five-metre correction the moment the first frame ran,
            //    which read as the plant exploding out of the dirt. A real runner that meets the ground turns and
            //    creeps along it, so that is what the heading does here.
            const Floor = Plant.Origin[2] + 0.015;
            if (Position[2] + Heading[2] * Segment < Floor)
            {
                const Flat = Math.hypot(Heading[0], Heading[1]);
                Heading = Normalise(Flat > 1.0e-4
                    ? [Heading[0] / Flat, Heading[1] / Flat, 0.05]
                    : [Math.cos(Step * 2.4), Math.sin(Step * 2.4), 0.05]);
            }

            // Carry the ring frame through this segment's turn before the heading is consumed below.
            Frame    = TransportFrame(Frame, PriorHeading, Heading);
            Position = Add(Position, Scale3(Heading, Segment));
            if (Position[2] < Floor) Position[2] = Floor;

            // Radius follows the taper exponent; the pose direction is stored in the PARENT's frame so the GPU bend
            //    constraint can restore it after the parent turns.
            const ParentHeading = Current === ParentIndex && Order === 0 && Step === 0
                ? [0, 0, 1]
                : Normalise(SubtractJoint(Plant, Current, ParentIndex, Heading));

            const Index = this.#PushJoint(Plant,
            {
                Position: [...Position],
                Pose: PoseInParentFrame(ParentHeading, Heading),
                ParentIndex: Current,
                RestLength: Segment,
                InverseMass: 1.0 / Math.max(0.02, Criteria.Mass * (1.0 - Along * 0.55)),
                HeightRatio: Math.min(1.0, (Position[2] - Plant.Origin[2]) / Math.max(0.05, Criteria.Height * Scale)),
                Criteria, Scale, Order, Along
            });

            // Radii are NOT decided here. A joint's thickness depends on how much growth it has to carry, which
            //    is not known until every branch above it exists, so it is resolved bottom-up once the topology
            //    is complete (#ResolveThickness). Deciding it per strand is what produced twigs thicker than the
            //    limb they hang off and the abrupt step at every junction.
            const Joint = Plant.Joints[Index];
            Joint.Frame      = [...Frame];
            Joint.StrandBase = (Step === 0);         // first joint of this strand — gets the junction collar
            Joint.Tint       = StrandTint;
            Travelled       += Segment;
            Joint.UvDistance = Travelled;

            this.#Attach(Plant, Criteria, Current, Index, Along, Order, Random, Scale);
            Current = Index;
        }
        return Current;
    }

    //--------------------------------------------------------------------------------------------------------------
    // Recursive branch orders along an existing chain.
    //--------------------------------------------------------------------------------------------------------------
    #Branch(Plant, Criteria, FromIndex, ToIndex, ParentLength, Random, Scale, Order)
    {
        if (Order >= Criteria.OrderCount || Criteria.BranchCount <= 0) return;

        // Collect the joints of the chain we just grew.
        const Chain = [];
        for (let Index = ToIndex; Index > FromIndex; Index = Plant.Joints[Index].ParentIndex) Chain.unshift(Index);
        if (Chain.length === 0) return;

        const Count = Math.round(Criteria.BranchCount);
        for (let Slot = 0; Slot < Count; ++Slot)
        {
            // Distribute attachment points from BranchStart to the tip.
            const Fraction = Criteria.BranchStart + (1.0 - Criteria.BranchStart) * ((Slot + 0.5) / Count);
            const Position = Math.min(Chain.length - 1, Math.floor(Fraction * Chain.length));
            const HostIndex = Chain[Position];
            const Host      = Plant.Joints[HostIndex];

            const HostHeading = Normalise(SubtractPositions(
                Host.Position, Plant.Joints[Math.max(0, Host.ParentIndex)].Position, [0, 0, 1]));

            // Phyllotaxis: the golden angle around the stem is what makes real branching look organic.
            const Spin  = Criteria.Phyllotaxis * (Slot + Order * 2.7) + Random() * 0.22;
            const Side  = RotateAbout(Perpendicular(HostHeading), HostHeading, Spin);
            const Angle = Criteria.BranchAngle * (0.75 + Random() * 0.5);
            const Heading = Normalise(RotateAbout(HostHeading, Normalise(Cross(HostHeading, Side)), Angle));

            const Length = ParentLength * Criteria.LengthFalloff * (0.7 + Random() * 0.5);
            if (Length < 0.05) continue;

            const Segments = Math.max(2, Math.round(Criteria.SegmentCount * (0.55 - Order * 0.08)));
            const Tip = this.#GrowChain(Plant, Criteria, HostIndex, Heading, Length, Segments,
                Math.pow(0.52, Order), Order, Random, Scale);

            this.#Branch(Plant, Criteria, HostIndex, Tip, Length, Random, Scale, Order + 1);
        }
    }

    //--------------------------------------------------------------------------------------------------------------
    // Rosette: fronds radiating from one crown joint.
    //--------------------------------------------------------------------------------------------------------------
    #Radiate(Plant, Criteria, CrownIndex, Height, Random, Scale, Order)
    {
        const Count = Math.max(1, Math.round(Criteria.BranchCount));
        for (let Slot = 0; Slot < Count; ++Slot)
        {
            const Spin    = Criteria.Phyllotaxis * Slot + Random() * 0.3;
            const Tilt    = Criteria.BranchAngle * (0.72 + Random() * 0.55);
            const Side    = RotateAbout([1, 0, 0], [0, 0, 1], Spin);
            const Heading = Normalise(RotateAbout([0, 0, 1], Normalise(Cross([0, 0, 1], Side)), Tilt));

            this.#GrowChain(Plant, Criteria, CrownIndex, Heading,
                Height * (0.72 + Random() * 0.45), Math.max(3, Math.round(Criteria.SegmentCount)),
                0.55, Order, Random, Scale);
        }
    }

    //--------------------------------------------------------------------------------------------------------------
    // Thickness, resolved bottom-up over the finished topology.
    //--------------------------------------------------------------------------------------------------------------
    // Leonardo's rule: the cross-section of a limb equals the summed cross-section of everything it carries, so
    //    r_parent^κ = Σ r_child^κ. Real trees follow it closely (κ ≈ 2.0–2.5), and it is why a fork looks like a
    //    fork: the two arms of a Y are each visibly thinner than the stem below, by exactly the right amount.
    //    Tapering each strand independently from its own base — the obvious approach — cannot do this, because a
    //    strand has no idea what else its host is carrying. That is what produced twigs as thick as the limb they
    //    hang from and a visible step in the silhouette at every junction.

    #ResolveThickness(Plant, Criteria, Scale)
    {
        const Exponent = 2.3;                                       // between area conservation and Murray's law
        // Twigs end in a point, not a dowel. A blunt tip leaves a visible flat cap floating in the canopy.
        const TipRadius = Math.min(0.0042, Math.max(0.0013, Criteria.TrunkRadius * Scale * 0.10));

        // Children always have a higher index than their parent, so one reverse sweep resolves the whole tree.
        for (let Index = Plant.Joints.length - 1; Index >= 0; --Index)
        {
            const Joint = Plant.Joints[Index];

            if (Joint.Children.length === 0)
            {
                Joint.Radius = TipRadius;
                continue;
            }

            let Sum = 0.0;
            for (const Child of Joint.Children) Sum += Math.pow(Plant.Joints[Child].Radius, Exponent);

            // The taper exponent stays available as an artistic dial on top of the structural rule.
            Joint.Radius = Math.pow(Sum, 1.0 / Exponent) * (1.0 + 0.035 * Criteria.TaperExponent);
        }

        // Normalise so the slider still means what it says: the trunk measures TrunkRadius at the ground.
        const Root   = Plant.Joints[0];
        const Wanted = Criteria.TrunkRadius * Scale;
        const Actual = Math.max(1.0e-6, Root.Radius);
        const Gain   = Wanted / Actual;

        for (const Joint of Plant.Joints) Joint.Radius = Math.max(0.0010, Joint.Radius * Gain);
    }

    //--------------------------------------------------------------------------------------------------------------
    // Bark tubes, emitted once the topology and the thickness are both settled.
    //--------------------------------------------------------------------------------------------------------------
    // One tube per parent→joint bone, with radii read from the joints themselves. Because a joint owns a single
    //    radius, the tube arriving at it and every tube leaving it agree by construction — there is no seam to
    //    hide. Where a strand begins, its first ring is flared toward the host's radius: that collar is what turns
    //    a thin cylinder jammed into a fat one into a limb that grows out of its parent.

    #EmitTubes(Plant, Criteria)
    {
        const UvAlong = 1.6 / Math.max(0.08, Criteria.TrunkRadius * 8.0);

        // Horizontal tiling is fixed for the whole plant. Deriving it from each joint's own radius gives
        //    neighbouring rings a different number of texture repeats, and the mismatch shows up as a hard
        //    horizontal seam at every single ring — far more objectionable than slightly stretched texels
        //    out on the twigs.
        const UvAround = Math.max(1.0, Math.round(Criteria.TrunkRadius * 26.0));

        for (let Index = 1; Index < Plant.Joints.length; ++Index)
        {
            const Joint  = Plant.Joints[Index];
            const Parent = Plant.Joints[Joint.ParentIndex];
            if (!Parent) continue;

            let RadiusA = Parent.Radius;

            // Junction collar. A new strand leaves its host at an angle, so a ring of the child's own thickness
            //    would float inside the host with a hard crease around it. Starting the sweep partway toward the
            //    host's radius fills that corner and reads as a fillet.
            if (Joint.StrandBase && Parent.Children.length > 1)
                RadiusA = Joint.Radius + (Parent.Radius - Joint.Radius) * 0.62;

            Plant.Tubes.push({
                JointA: Joint.ParentIndex,
                JointB: Index,
                RadiusA: Math.max(0.0010, RadiusA),
                RadiusB: Math.max(0.0010, Joint.Radius),
                FrameA: Parent.Frame ?? Joint.Frame ?? [1, 0, 0],
                FrameB: Joint.Frame ?? [1, 0, 0],
                // Bark V is the distance travelled along the strand, so the texture runs unbroken from root to
                //    tip. Restarting it per segment is what drew a seam across the trunk at every joint.
                UvA: (Parent.UvDistance ?? 0.0) * UvAlong,
                UvB: (Joint.UvDistance  ?? 0.0) * UvAlong,
                UvAround,
                Tint: Joint.Tint ?? 1.0
            });
        }
    }

    //--------------------------------------------------------------------------------------------------------------
    // Foliage attachment for one segment.
    //--------------------------------------------------------------------------------------------------------------
    #Attach(Plant, Criteria, JointA, JointB, Along, Order, Random, Scale)
    {
        if (Along < Criteria.LeafStart) return;

        // Real trees carry their canopy on the outer orders, not on the trunk. Order 0 of a tree is bare near the
        //    base and only starts leafing out toward its own tip; every later order is fully clothed. Rosettes,
        //    vines and shrubs leaf from their primary chain, so they are exempt.
        let Density = Criteria.LeafDensity;
        if (Criteria.Silhouette === "Tree" && Order === 0)
            Density *= Math.max(0.0, (Along - 0.55) / 0.45) * 0.5;

        // Fractional density is resolved stochastically so 0.4 means "40 % of segments carry one leaf".
        let Count = Math.floor(Density);
        if (Random() < Density - Count) ++Count;

        for (let Slot = 0; Slot < Count; ++Slot)
        {
            const Family = this.#PickFamily(Criteria, Random);
            const Cutout = this.#PickCutout(Family, Random);
            if (!Cutout) continue;

            const Jitter = Criteria.LeafJitter;

            // Leaves are spread ALONG the internode rather than dropped at random points on it. Independent
            //    random placement clusters by birthday paradox — with four leaves on a segment two of them land
            //    nearly on top of each other most of the time, which is what reads as a matted clump instead of
            //    foliage. Stratifying the slots and jittering inside each keeps the scatter organic but even.
            const Lane  = (Slot + 0.5) / Count;
            const Place = 0.12 + (Lane + (Random() - 0.5) * (0.8 / Count)) * 0.82;

            // A real shoot carries its largest leaves at mid-span: the newest growth at the tip has not expanded
            //    yet and the oldest at the base is shaded out. One flat size for every leaf is the single biggest
            //    tell that foliage was generated rather than grown.
            const Span   = 1.0 - 0.26 * Math.abs(Along - 0.55) / 0.55;
            const Twig   = 1.0 - 0.10 * Math.min(2, Order);
            const Spread = 1.0 - Jitter * 0.35 + Random() * Jitter * 0.7;

            // CardScale is the length of the blade [m]; the shader derives the width from the cutout's aspect, so
            //    a slender frond stays slender and the leaf-size slider means one honest thing.
            const CardScale = Criteria.LeafScale * Scale * Span * Twig * Spread
                            * (Family === "Flower" ? 0.70 : 1.0);
            const Aspect = Cutout.Width / Cutout.Height;

            // Phyllotaxis counts leaves on THIS plant, so the spiral is continuous up a shoot. Counting every
            //    card in the plot instead made the angle jump arbitrarily between neighbouring leaves.
            const Ordinal = Plant.LeafOrdinal ?? 0;
            Plant.LeafOrdinal = Ordinal + 1;

            Plant.Cards.push({
                JointA, JointB,
                Along: Place,
                CardScale,
                CardAspect: Aspect,
                Rect: Cutout.Rect,
                Yaw:   Criteria.Phyllotaxis * Ordinal + (Random() - 0.5) * Jitter * 1.1,
                // Leaves lift toward the light near the tip of a shoot and hang lower further back.
                Pitch: Criteria.LeafPitch + (0.5 - Along) * 0.42 + (Random() - 0.5) * Jitter * 0.7,
                Roll:  (Random() - 0.5) * Jitter * 1.2,
                AnchorV: Cutout.AnchorV,
                Tint: this.#Tint(Criteria, Random),
                Family
            });
        }
    }

    #PickFamily(Criteria, Random)
    {
        const Families = Criteria.FoliageFamily;
        if (Families.includes("Flower") && Random() < Criteria.FlowerChance) return "Flower";

        const Foliage = Families.filter((Family) => Family !== "Flower");
        if (Foliage.length === 0) return Families[0];

        // Tendrils are garnish, never the bulk of the canopy.
        if (Foliage.includes("Tendril") && Random() > 0.18)
            return Foliage.filter((Family) => Family !== "Tendril")[0] ?? Foliage[0];

        return Foliage[Math.floor(Random() * Foliage.length)];
    }

    #PickCutout(Family, Random)
    {
        const Group = this.SheetIndex.Grouped[Family];
        if (!Group || Group.length === 0)
        {
            const Fallback = this.SheetIndex.Cutouts;
            return Fallback.length > 0 ? Fallback[Math.floor(Random() * Fallback.length)] : null;
        }
        return Group[Math.floor(Random() * Group.length)];
    }

    // Per-card tint: slight hue drift plus the autumn ramp, so a canopy is never one flat green.
    #Tint(Criteria, Random)
    {
        const Drift = Criteria.TintVariation;
        const Red   = 1.0 + (Random() - 0.5) * Drift * 1.4;
        const Green = 1.0 + (Random() - 0.5) * Drift;
        const Blue  = 1.0 + (Random() - 0.5) * Drift * 1.2;

        const Autumn = Criteria.Chlorosis * Random();
        return [
            Red   * (1.0 + Autumn * 0.85),
            Green * (1.0 - Autumn * 0.22),
            Blue  * (1.0 - Autumn * 0.72)
        ];
    }

    //--------------------------------------------------------------------------------------------------------------
    #PushJoint(Plant, Record)
    {
        const Criteria = Record.Criteria;
        const Along    = Record.Along ?? 0.0;
        const Index    = Plant.Joints.length;

        // Stiffness falls off toward the tip so a limb is rigid at the shoulder and whippy at the end.
        const Softness = Criteria ? Criteria.TipSoftness * Along : 0.0;
        let   Bend     = Criteria ? Math.max(0.005, Criteria.BendStiffness * (1.0 - Softness * 0.92)) : 0.5;

        // Thickness dominates real bending stiffness — a beam resists in proportion to r⁴, which is why a trunk
        //    holds a canopy up while a twig of the same wood nods under one leaf. Without this every order shares
        //    one coefficient, so the trunk is as floppy as a twig and the whole tree folds under its own weight.
        //    Woody silhouettes only: a vine or a frond has no load-bearing trunk, and stiffening one turns a rope
        //    into a rod (measured: 0.29 m → 2.62 m of phantom drift on the vine).
        const Woody = !!Criteria && (Criteria.Silhouette === "Tree" || Criteria.Silhouette === "Shrub");
        if (Woody)
        {
            const Order = Record.Order ?? 0;
            Bend = 1.0 - (1.0 - Bend) * Math.pow(0.42, Math.max(0, 2 - Order));
            Bend = Math.min(0.999, Math.max(0.005, Bend));
        }

        Plant.Joints.push({
            Position:    Record.Position,
            Pose:        Record.Pose,
            ParentIndex: Record.ParentIndex,
            RestLength:  Record.RestLength,
            InverseMass: Record.InverseMass,
            Children:    [],
            Order:       Record.Order ?? 0,
            Along:       Along,
            Tune:
            [
                Criteria ? Criteria.WindGain : 0.0,
                Criteria ? Criteria.Drag : 0.05,
                Criteria ? Criteria.CollisionRadius * (Record.Scale ?? 1.0) : 0.02,
                Record.HeightRatio ?? 0.0
            ],
            Stiff:
            [
                Bend,
                0.92,                                                    // distance stiffness — near rigid
                // Anchor pull. Bend only restores angles relative to the parent, so a plant shoved sideways is
                //    happy to stay shoved; this is the term that walks it home. Woody stems keep their own shape
                //    through stiffness and need almost none, while a soft frond relies on it entirely.
                Criteria ? (Criteria.Recovery ?? (Woody ? 0.45 : 0.90)) : 0.60,
                0.0                                                      // trunk radius, filled by the host
            ]
        });

        if (Record.ParentIndex >= 0) Plant.Joints[Record.ParentIndex].Children.push(Index);
        return Index;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    LOCAL HELPERS
//------------------------------------------------------------------------------------------------------------------------

function Scale3(A, S) { return [A[0] * S, A[1] * S, A[2] * S]; }

function SubtractPositions(A, B, Fallback)
{
    const Delta = [A[0] - B[0], A[1] - B[1], A[2] - B[2]];
    return Math.hypot(Delta[0], Delta[1], Delta[2]) < 1.0e-6 ? Fallback : Delta;
}

function SubtractJoint(Plant, Index, RootIndex, Fallback)
{
    const Joint = Plant.Joints[Index];
    if (!Joint || Joint.ParentIndex < 0) return Fallback;
    return SubtractPositions(Joint.Position, Plant.Joints[Joint.ParentIndex].Position, Fallback);
}

// Removes any component of Reference along Axis and renormalises — the ring frame must be perpendicular to the
//    direction the tube is sweeping, or the ring shears into an ellipse.
function Orthogonalise(Reference, Axis)
{
    const Unit    = Normalise(Axis);
    const Along   = Reference[0] * Unit[0] + Reference[1] * Unit[1] + Reference[2] * Unit[2];
    const Planar  = [Reference[0] - Unit[0] * Along,
                     Reference[1] - Unit[1] * Along,
                     Reference[2] - Unit[2] * Along];

    // Degenerate only when Reference is parallel to Axis, in which case any perpendicular will do.
    return Math.hypot(...Planar) < 1.0e-6 ? Perpendicular(Unit) : Normalise(Planar);
}

// Parallel transport: carries Reference through the minimal rotation taking From onto To. This is what keeps a
//    swept tube from corkscrewing — the frame turns exactly as much as the curve does and not one radian more.
function TransportFrame(Reference, From, To)
{
    const Start = Normalise(From);
    const End   = Normalise(To);
    const Axis  = Cross(Start, End);
    const Sine  = Math.hypot(Axis[0], Axis[1], Axis[2]);

    if (Sine < 1.0e-7) return Orthogonalise(Reference, End);

    const Unit  = [Axis[0] / Sine, Axis[1] / Sine, Axis[2] / Sine];
    const Angle = Math.atan2(Sine, Start[0] * End[0] + Start[1] * End[1] + Start[2] * End[2]);
    return Orthogonalise(RotateAbout(Reference, Unit, Angle), End);
}

// Expresses Heading in the frame whose +Z is ParentHeading — the rest direction the GPU bend constraint restores.
function PoseInParentFrame(ParentHeading, Heading)
{
    const Axis = Normalise(ParentHeading);
    const Up   = [0, 0, 1];

    // Rotation carrying Axis onto +Z, applied to Heading.
    const Cross0 = Cross(Axis, Up);
    const Sine   = Math.hypot(Cross0[0], Cross0[1], Cross0[2]);
    const Cosine = Axis[0] * Up[0] + Axis[1] * Up[1] + Axis[2] * Up[2];

    if (Sine < 1.0e-7) return Cosine > 0.0 ? [...Heading] : [-Heading[0], -Heading[1], Heading[2]];

    const Unit  = [Cross0[0] / Sine, Cross0[1] / Sine, Cross0[2] / Sine];
    const Angle = Math.atan2(Sine, Cosine);
    return RotateAbout(Heading, Unit, Angle);
}
