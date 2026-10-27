//============================================================================================================================================
// 📦 FilamentConstrain.glsl — phase ② of the GPU filament solver: distance, bend and collision projection.
//============================================================================================================================================
// Jacobi-style XPBD projection. Every joint reads its parent and its children and applies the correction it is owed
//    by each; because both endpoints of an edge apply the same symmetric correction in the same step, no ordering or
//    graph colouring is needed and the whole forest converges in a handful of iterations.
//
//    ① distance   — edge length to the parent (structural rigidity)
//    ② bend       — restores the rest direction in the parent's current turned basis (stiffness, the thing that makes
//                   a branch a branch and not a rope)
//    ③ collision  — spheres, an infinite ground plane, and per-joint self-thickness against the trunk
//
// The child list is a flat span (offset, count) into ChildSurface so a joint can serve any number of children —
//    a trunk node carrying six branches costs the same code path as a leaf carrying none.

//@vertex
#version 300 es

void main()
{
    vec2 Corner = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(Corner * 2.0 - 1.0, 0.0, 1.0);
}

//@fragment
#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D CurrentSurface;      // xyz = position [m]
uniform sampler2D PoseSurface;         // xyz = rest direction from parent (object space), w = inverse mass
uniform sampler2D ChainSurface;        // x = parent index (−1 = root), y = rest length [m], z = child span offset, w = child span count
uniform sampler2D ChildSurface;        // x = child joint index
uniform sampler2D TuneSurface;         // x = wind gain, y = drag, z = collision radius [m], w = height ratio
uniform sampler2D StiffSurface;        // x = bend stiffness [-], y = distance stiffness [-], z = anchor pull [-], w = trunk radius [m]
uniform sampler2D AnchorSurface;       // xyz = grown rest position [m] — the silhouette the plant returns to

uniform vec2  JointExtent;
uniform vec2  ChildExtent;
uniform vec4  ColliderRecords[8];      // xyz = centre [m], w = radius [m]
uniform int   ColliderCount;
uniform float GroundHeight;            // [m]
uniform float Restitution;             // [-] tangential slide retained on contact
uniform float RelaxationCount;         // [-] total projections per step (iterations × substeps)
uniform float UnderRelaxation;         // [-] Jacobi damping ω ∈ (0,1]
uniform float StepSeconds;             // [s] duration of the whole step, for per-second rates

out vec4 OutCurrent;

//------------------------------------------------------------------------------------------------------------------------
//                                                     PARENT BASIS
//------------------------------------------------------------------------------------------------------------------------
// The bend constraint needs the parent's CURRENT direction to know where "straight ahead" now points. For a root the
//    rest direction is already world space; otherwise it is the parent's own edge direction.

vec3 ParentDirection(float ParentIndex, vec3 ParentLocation)
{
    vec4 ParentChain = texture(ChainSurface, JointTexcoord(ParentIndex, JointExtent));
    float Grandparent = ParentChain.x;
    if (Grandparent < 0.0) return vec3(0.0, 0.0, 1.0);        // trunk base grows up

    vec3 GrandLocation = FetchJoint(CurrentSurface, Grandparent, JointExtent);
    vec3 Edge          = ParentLocation - GrandLocation;
    float Length       = length(Edge);
    return Length > 1.0e-6 ? Edge / Length : vec3(0.0, 0.0, 1.0);
}

void main()
{
    float LinearIndex = floor(gl_FragCoord.y) * JointExtent.x + floor(gl_FragCoord.x);
    vec2  Texcoord    = gl_FragCoord.xy / JointExtent;

    vec3  Current = texture(CurrentSurface, Texcoord).xyz;
    vec4  Pose    = texture(PoseSurface,    Texcoord);
    vec4  Chain   = texture(ChainSurface,   Texcoord);
    vec4  Tune    = texture(TuneSurface,    Texcoord);
    vec4  Stiff   = texture(StiffSurface,   Texcoord);

    float InverseMass = Pose.w;
    if (InverseMass <= 0.0)
    {
        OutCurrent = vec4(Current, 1.0);
        return;
    }

    // Jacobi accumulation. Every constraint touching this joint contributes its correction to the sum, and the sum
    //    is DIVIDED by the number of contributors before it is applied. Without that averaging a trunk joint
    //    carrying six branches would receive six full corrections in one step and the solver would diverge — the
    //    positions blow up to infinity within a second. This is the Jacobi equivalent of Gauss-Seidel's sequential
    //    relaxation, and it is what makes an order-free parallel solve stable.
    vec3  Correction     = vec3(0.0);
    float ContributorSum = 0.0;

    float ParentIndex = Chain.x;
    float RestLength  = max(Chain.y, 1.0e-5);

    // The direction of the edge arriving at THIS joint. It is the basis every child's bend constraint is measured
    //    against, so it is computed once here and reused in the child loop below.
    vec3 OwnDirection = vec3(0.0, 0.0, 1.0);
    if (ParentIndex >= 0.0)
    {
        vec3  Incoming = Current - FetchJoint(CurrentSurface, ParentIndex, JointExtent);
        float Reach    = length(Incoming);
        if (Reach > 1.0e-6) OwnDirection = Incoming / Reach;
    }

    // Bend is a MATERIAL property, so it is compensated for the relaxation count (XPBD §3): without this the same
    //    vine behaves like rope at 6 projections and like steel at 36, and the surplus energy shows up as an
    //    oscillation that grows instead of settling.
    // Distance is a HARD geometric constraint — a stem does not stretch — so it is deliberately NOT compensated.
    //    Extra iterations must converge it, not soften it; softening it lets a tall trunk stretch under its own
    //    weight and the whole plant flails.
    float Relaxation   = max(RelaxationCount, 1.0);
    float BendRate     = 1.0 - pow(1.0 - clamp(Stiff.x, 0.0, 0.999), 1.0 / Relaxation);
    float DistanceRate = clamp(Stiff.y, 0.0, 1.0);

    //--------------------------------------------------------------------------------------------------------------
    // ① distance + ② bend, as owed to the parent
    //--------------------------------------------------------------------------------------------------------------
    if (ParentIndex >= 0.0)
    {
        vec3  ParentLocation = FetchJoint(CurrentSurface, ParentIndex, JointExtent);
        float ParentInverse  = texture(PoseSurface, JointTexcoord(ParentIndex, JointExtent)).w;
        float Share          = InverseMass / max(InverseMass + ParentInverse, 1.0e-6);

        vec3  Edge     = Current - ParentLocation;
        float Distance = length(Edge);
        if (Distance > 1.0e-6)
        {
            vec3 Direction = Edge / Distance;
            Correction += Direction * ((Chain.y - Distance) * Share * DistanceRate);
            ContributorSum += 1.0;

            // Bend restores the limb's rest ANGLE, and only the angle. Targeting an absolute position
            //    (parent + rest_direction × rest_length) also encodes a length, so it fights the distance
            //    constraint solved two lines above: one pulls the joint out, the other pulls it back, and the pair
            //    pumps energy into the chain every iteration. Correcting the direction and leaving length alone
            //    makes the two constraints orthogonal, and the correction is bounded by the edge length.
            vec3 Desired = RotateBetween(vec3(0.0, 0.0, 1.0), ParentDirection(ParentIndex, ParentLocation), Pose.xyz);
            Correction += (Desired - Direction) * (Distance * BendRate);
            ContributorSum += 1.0;
        }
    }

    //--------------------------------------------------------------------------------------------------------------
    // ① distance, as owed to every child (the symmetric half — this is what makes Jacobi order-free)
    //--------------------------------------------------------------------------------------------------------------
    float ChildOffset = Chain.z;
    float ChildCount  = Chain.w;
    for (int Slot = 0; Slot < 8; ++Slot)
    {
        if (float(Slot) >= ChildCount) break;

        float ChildIndex = texture(ChildSurface, JointTexcoord(ChildOffset + float(Slot), ChildExtent)).x;
        vec3  ChildPlace = FetchJoint(CurrentSurface, ChildIndex, JointExtent);
        vec4  ChildChain = texture(ChainSurface, JointTexcoord(ChildIndex, JointExtent));
        float ChildInverse = texture(PoseSurface, JointTexcoord(ChildIndex, JointExtent)).w;

        vec3  Edge     = ChildPlace - Current;
        float Distance = length(Edge);
        if (Distance <= 1.0e-6) continue;

        float Share = InverseMass / max(InverseMass + ChildInverse, 1.0e-6);
        Correction -= (Edge / Distance) * ((ChildChain.y - Distance) * Share * DistanceRate);
        ContributorSum += 1.0;

        // Bend reaction. The child's own pass rotates itself toward its rest angle; if this joint does not take
        //    the equal-and-opposite half, the constraint is a one-way force that manufactures angular momentum.
        //    Harmless on a chain, but it compounds through every branch level — measured as 0.13 m of phantom
        //    drift at one order and 9.7 m at three, on a weightless plant that should not move at all. This term
        //    is what makes the pair conservative and the deep skeleton settle.
        vec4 ChildPose = texture(PoseSurface, JointTexcoord(ChildIndex, JointExtent));
        vec3 ChildWant = RotateBetween(vec3(0.0, 0.0, 1.0), OwnDirection, ChildPose.xyz);
        Correction -= (ChildWant - Edge / Distance) * (Distance * BendRate * Share);
        ContributorSum += 1.0;
    }

    // Averaging keeps a joint with several children from being over-corrected, but averaging alone is not
    //    sufficient for stability: on a branching skeleton the rest pose is a fixed point whose feedback gain
    //    still exceeds one, so the solver oscillates around it forever instead of converging onto it. (Measured:
    //    with bend disabled the plot is motionless to the last bit; with bend enabled and ω = 1 a still, weightless
    //    tree thrashes by 9 m.) Under-relaxation multiplies the gain by ω and brings it below one.
    Correction *= UnderRelaxation / max(ContributorSum, 1.0);

    // Travel ceiling: one iteration may never move a joint further than its own rest length. A pathological
    //    parameter set then degrades into a soft plant rather than a numerical explosion.
    float Travel = length(Correction);
    if (Travel > RestLength) Correction *= RestLength / Travel;

    vec3 Projected = Current + Correction;

    //--------------------------------------------------------------------------------------------------------------
    // ③ collision — spheres, ground, trunk self-thickness
    //--------------------------------------------------------------------------------------------------------------
    float Thickness = Tune.z;

    for (int Index = 0; Index < 8; ++Index)
    {
        if (Index >= ColliderCount) break;
        vec4  Collider = ColliderRecords[Index];
        vec3  Offset   = Projected - Collider.xyz;
        float Distance = length(Offset);
        float Wanted   = Collider.w + Thickness;

        if (Distance < Wanted && Distance > 1.0e-6)
        {
            vec3 Normal    = Offset / Distance;
            vec3 Resolved  = Collider.xyz + Normal * Wanted;
            // Keep the tangential component so foliage slides around an obstacle instead of sticking to it.
            vec3 Travel    = Resolved - Projected;
            vec3 Tangent   = Travel - Normal * dot(Travel, Normal);
            Projected      = Projected + Normal * dot(Travel, Normal) + Tangent * Restitution;
        }
    }

    // Trunk self-collision: keeps drooping fronds and vines off the stem they hang from.
    float TrunkRadius = Stiff.w;
    if (TrunkRadius > 0.0 && Projected.z > GroundHeight)
    {
        vec2  Radial   = Projected.xy;
        float Distance = length(Radial);
        float Wanted   = TrunkRadius + Thickness * 0.5;
        if (Distance < Wanted && Distance > 1.0e-5)
            Projected.xy = Radial / Distance * Wanted;
    }

    // ── anchor pull ──────────────────────────────────────────────────────────────────────────────────────────────
    // Bend restores each joint's angle relative to its PARENT, so a plant pushed over as a whole is perfectly
    //    self-consistent in its new leaning shape and has no reason to stand back up. A weak spring toward the
    //    grown pose supplies that reason. It is applied after the contacts so it can never push a joint back
    //    inside a collider, and it is scaled by the height ratio: the base is already pinned, the tips travel most.
    // Stiff.z is a recovery rate PER SECOND, converted here to this iteration's share. Treating it as a per-step
    //    figure is what killed the wind in testing: 0.35 per step is 100 % per second at 60 Hz, which nails every
    //    joint to its rest pose and leaves the gust nothing to move. Expressed per second it is a slow homecoming
    //    the wind can still fight — deflection scales with wind strength again, and a shoved plant still recovers.
    float AnchorRate = clamp(Stiff.z, 0.0, 1.0) * (0.25 + 0.75 * Tune.w);
    if (AnchorRate > 0.0)
    {
        float Share  = 1.0 - pow(1.0 - AnchorRate, StepSeconds / max(RelaxationCount, 1.0));
        vec3  Anchor = texture(AnchorSurface, Texcoord).xyz;
        Projected   += (Anchor - Projected) * Share;
    }

    // Ground plane.
    float Floor = GroundHeight + Thickness * 0.5;
    if (Projected.z < Floor) Projected.z = Floor;

    // Final guard: a NaN reaching the lattice is permanent (it propagates to every neighbour next iteration and
    //    never leaves), so it is cheaper to catch it here than to debug a plant that silently vanished.
    if (any(isnan(Projected)) || any(isinf(Projected))) Projected = Current;

    OutCurrent = vec4(Projected, 1.0);
}
