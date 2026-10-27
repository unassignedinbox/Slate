//============================================================================================================================================
// 📦 FilamentIntegrate.glsl — phase ① of the GPU filament solver: Verlet advance of every plant joint, in parallel.
//============================================================================================================================================
// One texel = one skeleton joint. This is the GPU twin of a CPU bone chain: instead of walking a hierarchy on the
//    CPU and uploading matrices, the whole forest's skeleton advances in a single draw with zero readback.
//
//    Verlet form:  xₙ₊₁ = xₙ + (xₙ − xₙ₋₁)·(1 − drag) + a·Δτ²
//    Writing xₙ into the prior attachment keeps velocity implicit, so the constraint phases that follow may move
//    positions freely and the velocity they imply is corrected automatically next step (standard PBD).

//@vertex
#version 300 es

// Attribute-free full-surface triangle.
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
uniform sampler2D PriorSurface;        // xyz = prior position [m]
uniform sampler2D PoseSurface;         // xyz = rest parent direction, w = inverse mass [kg⁻¹]
uniform sampler2D TuneSurface;         // x = wind gain, y = drag, z = collision radius [m], w = height ratio

uniform vec2  JointExtent;             // [px] lattice extent
uniform float DeltaTime;               // [s]
uniform float ElapsedTime;             // [s]
uniform vec3  GravityVector;           // [m/s²]
uniform vec3  WindDirection;           // [-] unit
uniform vec4  WindCriteria;            // x = strength [m/s²], y = turbulence [-], z = gust [-], w = flutter [m/s²]
uniform float GroundHeight;            // [m]
uniform float ContactFriction;         // [-] tangential velocity retained while touching the ground
uniform float SelfSupport;             // [-] fraction of its own weight the plant carries structurally

out vec4 OutCurrent;

void main()
{
    vec2  Texcoord = gl_FragCoord.xy / JointExtent;
    vec3  Current  = texture(CurrentSurface, Texcoord).xyz;
    vec3  Prior    = texture(PriorSurface,   Texcoord).xyz;
    vec4  Pose     = texture(PoseSurface,    Texcoord);
    vec4  Tune     = texture(TuneSurface,    Texcoord);

    float InverseMass = Pose.w;
    if (InverseMass <= 0.0)            // pinned: roots and the base of every stem
    {
        OutCurrent = vec4(Current, 1.0);
        return;
    }

    // ── Wind ─────────────────────────────────────────────────────────────────────────────────────────────────────
    // Height ratio biases exposure: a joint at the crown feels the gust, one at ankle height barely does.
    float Turbulent = WindTurbulence(Current, ElapsedTime);
    float Exposure  = Tune.x * mix(0.35, 1.0, Tune.w);
    float Strength  = WindCriteria.x * (1.0 + WindCriteria.y * Turbulent) * (1.0 + WindCriteria.z);

    // Only the UNSUPPORTED share of gravity is applied. A tree is not a hanging chain that gravity discovers for
    //    the first time at startup — it grew into its silhouette already bearing its own weight, so the grown pose
    //    is the loaded equilibrium, not an unloaded one. Applying the full 9.81 on top of a pose that already
    //    accounts for it makes every plant wilt the moment the first frame runs, which is exactly the "it falls
    //    like string" collapse. The residual keeps limbs feeling heavy and still lets a displaced branch drop.
    vec3 Acceleration = GravityVector * (1.0 - clamp(SelfSupport, 0.0, 1.0))
                      + WindDirection * (Strength * Exposure);

    // Flutter scales WITH the gust. Left ungated it is an independent oscillator, so a plot with the wind slider
    //    at zero would still shiver — and "no wind" must mean a plant that comes to rest.
    float FlutterGain = WindCriteria.w * Exposure * min(1.0, WindCriteria.x * 0.35);
    vec3  Across      = normalize(cross(WindDirection, vec3(0.0, 0.0, 1.0)) + vec3(1.0e-4));
    Acceleration += Across * (FlutterGain * sin(ElapsedTime * 9.3 + Current.x * 3.1 + Current.y * 2.7));
    Acceleration += vec3(0.0, 0.0, 1.0) * (FlutterGain * 0.45 * sin(ElapsedTime * 7.1 + Current.y * 4.3));

    // ── Verlet advance ───────────────────────────────────────────────────────────────────────────────────────────
    vec3 Velocity = (Current - Prior) * (1.0 - clamp(Tune.y, 0.0, 1.0));

    // Contact damping. The constraint phase resolves a ground or collider hit by MOVING the position, and plain
    //    Verlet reads that move as velocity — so a joint pressed into the floor is relaunched next step and the
    //    plot jitters forever with the wind switched off. Bleeding off the velocity of a joint that is sitting on
    //    a contact is what turns that perpetual trampoline into a plant that settles and stays settled.
    float Floor = GroundHeight + Tune.z * 0.5;
    if (Current.z <= Floor + 1.0e-3)
    {
        Velocity.xy *= clamp(ContactFriction, 0.0, 1.0);
        Velocity.z   = max(Velocity.z, 0.0) * 0.25;
    }

    // Clamp per-step travel: a large drag-and-drop of the collider must never launch a filament to infinity.
    float Travel = length(Velocity);
    if (Travel > 0.65) Velocity *= 0.65 / Travel;

    vec3 Advanced = Current + Velocity + Acceleration * (DeltaTime * DeltaTime);

    // A non-finite position never recovers on its own — it spreads to every neighbour through the constraint
    //    phase. Falling back to the last good position keeps one bad joint from dissolving the whole plot.
    if (any(isnan(Advanced)) || any(isinf(Advanced))) Advanced = Current;

    OutCurrent = vec4(Advanced, 1.0);
}
