//============================================================================================================================================
//                                                          TYRECARCASSSOLVER.JS
//============================================================================================================================================
// 🧩 Soft tyres: a flexible-ring carcass per wheel — inflation tension, sidewall support, belt bending, gas volume — against the road, for the vertex shader.

// 📝 XPBD gave a convincing tyre at a cost no frame could carry, and a deformation authored in the material shader is
//    cheap but knows nothing: no pressure, no flat, no wave. Between the two sits the model tyre engineers reduce a
//    carcass to — the flexible ring on an elastic foundation, the belt that FTire and CDTire discretise and that
//    Pacejka reduces analytically (Tyre and Vehicle Dynamics, ch. 9). Per wheel, 96 nodes of belt in the wheel's own
//    frame, each with a radial deflection, governed by
//
//        ρA·ẅ = T(p)·∂²w/∂s² − EI·∂⁴w/∂s⁴ − k(p)·w − c·ẇ ,   s = R·φ
//
//    | Term     | What it is                                    | Pressure                                  |
//    |----------|-----------------------------------------------|-------------------------------------------|
//    | T(p)     | hoop tension of the belt                      | inflation: T = p·R·w, plus the rubber's    |
//    | k(p)     | radial support per metre of belt              | the air column plus the sidewalls' own    |
//    | EI       | bending of the steel belt                     | none                                      |
//
//    The road is a one-sided constraint: a node cannot sit below the ground under the hub, so the belt flattens into
//    a contact patch and the tension and bending carry the deflection out beyond it the way a real tread rolls in and
//    out of the patch. The nodes ride with the rubber (the wheel's frame spins), so nothing has to be advected: the
//    patch walks round the belt as the wheel turns, and at speed — when the tread outruns the belt's wave speed
//    √(T/ρA) — a standing wave trails the patch: about 210 km/h for an inflated tyre, about 55 km/h for a flat.
//
//    | What the ring buys the vehicle                                                        | Where             |
//    |---------------------------------------------------------------------------------------|-------------------|
//    | the radial rate k_tyre(p) = ∂F/∂d, measured by solving this very ring                  | QueryStiffness()  |
//    | the enclosed volume and its rate, so the gas heats when it is squashed and cools back    | QueryVolume()     |
//    | the rolling radius of a lumpy flat tyre, which the contact patch then rides over        | QueryRolling()    |
//    | the collapse, the creases and the folds a deflated tyre falls into                      | EncodeRecords()   |
//
//    The rate is not authored anywhere: Calibrate() solves the static ring at five pressures and reports ΔF/Δd, so
//    the spring the chassis leans on is the same model the vertex shader draws.

export const CarcassNodes      = 96;                            // [-]
export const CarcassHeaderBytes = 64;                           // [B]   four vec4 of header
export const CarcassRecordBytes = CarcassHeaderBytes + CarcassNodes * 4;   // [B]   then the 96 deflections

export const CarcassSpecification = Object.freeze({
    BeltMassPerLength:   8.0,       // [kg/m]  belt and tread per metre of circumference — heavier than real for a stable step
    TensionPerPascal:    0.12,      // [N/Pa]  p·R·w with R 0.5 m and an effective width of 0.24 m
    ResidualTension:     1800.0,    // [N]     the cords and rubber, no air
    FoundationPerPascal: 2.25,      // [N/m²/Pa] radial support of the air column per metre of belt, calibrated
    SidewallFoundation:  7.8e4,     // [N/m²]  the sidewalls' own radial support, calibrated
    BendingStiffness:    4.0,       // [N·m²]  the steel belt
    DampingRatio:        0.55,      // [-]     of the foundation mode
    StepSeconds:         1 / 3600,  // [s]     the highest ring mode at 300 kPa is ~4900 rad/s, the step's limit 7200
    MaximumSteps:        150,       // [-]     per advance
    PinchClearance:      0.022,     // [m]     rubber left between rim flange and road when the tyre is pinched
    BeadClearance:       0.018,     // [m]     the tyre cannot reach inside the rim's own radius by more than this
    LateralStiffness:    6.0e4,     // [N/m]   sidewall lateral stiffness, no air
    LateralPerPascal:    0.6,       // [N/m/Pa]
    LateralCeiling:      0.045,     // [m]
    LateralSpread:       0.65,      // [rad]   half-width of the belt's lateral shift round the patch
    ReferencePressure:   220000.0,  // [Pa]    the pressure the reference rate is quoted at
    ReferenceVolume:     0.045,     // [m³]    enclosed gas at rest — ThermalSpecification.EnclosedVolume
    GasFillFraction:     0.62,      // [-]     torus volume → enclosed gas volume, the rim well and bead seats taken out
    WrinkleScale:        1.0,       // [-]     creases drawn for a deflated tyre
    CreasePerPascal:     0.055      // [m]     extra collapse per 100 kPa of missing pressure, at the patch
});

// 📐 Discrete operator constants per pressure: tension and foundation, both linear in the gauge pressure.
function ResolveOperator(Pressure)
{
    const Specification = CarcassSpecification;
    const Gauge = Math.max(0.0, Pressure);
    return {
        Tension:    Specification.ResidualTension + Specification.TensionPerPascal * Gauge,
        Foundation: Specification.SidewallFoundation + Specification.FoundationPerPascal * Gauge,
        Damping:    2.0 * Specification.DampingRatio * Math.sqrt((Specification.SidewallFoundation + Specification.FoundationPerPascal * Gauge)
                                                                 * Specification.BeltMassPerLength)
    };
}

export class TyreCarcassSolver
{
    constructor(Radius, RimRadius, HalfWidth)
    {
        this.Radius    = Radius;
        this.RimRadius = RimRadius;
        this.HalfWidth = HalfWidth;
        // 📝 The ring is held in one padded buffer per wheel, four slack nodes on either side, so the five-point
        //    stencil and the bending term address neighbours by index arithmetic alone — no modulo in the inner loop.
        const Padded = CarcassNodes + 8;
        this.Wheels = [0, 1, 2, 3].map((Index) => ({
            Deflection: new Float64Array(Padded), Velocity: new Float64Array(Padded), Floor: new Float64Array(Padded),
            DownAngle: -Math.PI / 2, LateralShift: 0.0, Bulge: 0.0, Wrinkle: 0.0, WrinkleCount: 6, PressureRatio: 1.0,
            Pinched: false, PatchNodes: 0, Peak: 0.0, WavePeak: 0.0, ContactLength: 0.0,
            Collapse: 0.0, AxisDrop: 0.0, RollingRadius: Radius, RollingLump: 0.0, Volume: 0.0, VolumeRate: 0.0,
            Unseated: false, LossSeconds: 0.0, Phase: 1.7 * Index + 0.4
        }));
        this.Accumulator = 0.0;
        this.Bytes = new ArrayBuffer(4 * CarcassRecordBytes);
        this.Rates = this.Calibrate();
        this.FrameSeconds = 0.0;
        this.FrameSteps = 0;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                          MEASURED RADIAL RATE
    //--------------------------------------------------------------------------------------------------------------------

    // 📐 The spring the chassis leans on, solved rather than authored: the static ring at each pressure, loaded by a
    //    2 mm and a 4 mm sink of the hub, and the load each carries read off the foundation — F = Σ k·w·Δs over the
    //    nodes, which is the force the air column and the sidewalls hand the road. ΔF/Δd is the rate. Five pressures
    //    are enough: T and k are linear in p, so the rate is a quadratic and a least-squares fit over the five
    //    recovers the two coefficients the vehicle solver interpolates.
    Calibrate()
    {
        const Pressures = [0.0, 60000.0, 120000.0, 220000.0, 305000.0];
        const Probe = new TyreRing(this.Radius, this.RimRadius);
        const Points = Pressures.map((Pressure) => ({ Pressure, Rate: Probe.MeasureRate(Pressure) }));
        // 📐 F/d = a + b·p, least squares over the five probe pressures.
        let SumP = 0.0, SumR = 0.0, SumPP = 0.0, SumPR = 0.0;
        for (const Point of Points)
        {
            SumP += Point.Pressure;
            SumR += Point.Rate;
            SumPP += Point.Pressure * Point.Pressure;
            SumPR += Point.Pressure * Point.Rate;
        }
        const Count = Points.length;
        const Denominator = Count * SumPP - SumP * SumP;
        const b = (Count * SumPR - SumP * SumR) / Denominator;
        const a = (SumR - b * SumP) / Count;
        return { Points, Constant: a, PerPascal: b };
    }

    // 📐 ∂F/∂d for a gauge pressure, from the calibrated line: about 223 kN/m at 220 kPa, 25 kN/m with no air.
    QueryStiffness(Pressure)
    {
        return Math.max(0.0, this.Rates.Constant + this.Rates.PerPascal * Math.max(0.0, Pressure));
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                   ADVANCE
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Contacts: per wheel { InContact, HubDistance [m], DownAngle [rad, wheel frame], Pressure [Pa gauge],
    //    LateralForce [N], Shredded, Unseated, Spin [rad/s] }. Advances the four rings by fixed steps over Seconds.
    Advance(Contacts, Seconds)
    {
        const Specification = CarcassSpecification;
        this.Accumulator = Math.min(this.Accumulator + Math.max(0.0, Seconds), Specification.StepSeconds * Specification.MaximumSteps);
        const Steps = Math.floor(this.Accumulator / Specification.StepSeconds);
        this.Accumulator -= Steps * Specification.StepSeconds;
        this.FrameSteps = Steps;
        this.FrameSeconds = Seconds;
        Contacts.forEach((Contact, Index) => this.AdvanceWheel(this.Wheels[Index], Contact, Steps, Seconds));
    }

    AdvanceWheel(Wheel, Contact, Steps, Seconds)
    {
        const Specification = CarcassSpecification;
        const Pressure = Math.max(0.0, Contact.Pressure);
        const Operator = ResolveOperator(Pressure);
        const Tension = Operator.Tension, Foundation = Operator.Foundation, Damping = Operator.Damping;
        const Mass = Specification.BeltMassPerLength;
        const Arc = this.Radius * 2.0 * Math.PI / CarcassNodes;
        const TensionTerm = Tension / (Arc * Arc), BendingTerm = Specification.BendingStiffness / (Arc * Arc * Arc * Arc);
        const Step = Specification.StepSeconds;
        const Pinch = this.Radius - this.RimRadius - Specification.PinchClearance;
        const W = Wheel.Deflection, V = Wheel.Velocity, Floor = Wheel.Floor;
        const Count = CarcassNodes;
        const Empty = Contact.Shredded || !Contact.InContact || !Number.isFinite(Contact.HubDistance);
        const HubDistance = Empty ? 0.0 : Contact.HubDistance;
        const Unseated = !!Contact.Unseated || !!Contact.Shredded;
        Wheel.DownAngle = Contact.DownAngle;
        Wheel.Pinched = false;
        Wheel.Unseated = Unseated;
        Wheel.PressureRatio = Math.min(1.5, Pressure / Specification.ReferencePressure);

        // ① the road under the hub as a floor: r·cos θ ≤ d, so w ≥ R − d / cos θ. A tyre that has lost its air also
        //    rests on its own rim, whose flange no part of the belt may pass: that is the second floor.
        const RimFloor = Unseated || Pressure < 0.15 * Specification.ReferencePressure
                       ? this.Radius - (this.RimRadius + Specification.BeadClearance) : -Infinity;
        const Ceiling = Unseated ? Pinch + 0.02 : Pinch;
        for (let Node = 0; Node < Count; ++Node)
        {
            let Road = -Infinity;
            if (!Empty)
            {
                let θ = (2.0 * Math.PI * Node) / Count - Contact.DownAngle;
                θ = Math.atan2(Math.sin(θ), Math.cos(θ));
                if (Math.abs(θ) < 1.35)
                    Road = this.Radius - HubDistance / Math.max(Math.cos(θ), 0.25);
            }
            Floor[4 + Node] = Math.max(Road, RimFloor);
        }
        // 📝 The footprint: the chord the hub's height cuts across the tyre, 2·√(2·R·d − d²) long, as Pacejka's
        //    contact length is. Inside it the tread lies on the road — the cord the belt carries cannot be longer than
        //    the flat it has to span — and outside it the ring is free, so the tension and the bending carry the
        //    deflection away tangentially and the tread springs back as it leaves.
        const ChordHalf = HubDistance > 0.0 && HubDistance < this.Radius ? Math.acos(HubDistance / this.Radius) : 0.0;

        Wheel.Deflection[3] = Wheel.Deflection[4 + Count - 1];
        Wheel.Deflection[2] = Wheel.Deflection[4 + Count - 2];
        Wheel.Deflection[1] = Wheel.Deflection[4 + Count - 3];
        Wheel.Deflection[0] = Wheel.Deflection[4 + Count - 4];
        Wheel.Deflection[4 + Count]     = Wheel.Deflection[4];
        Wheel.Deflection[4 + Count + 1] = Wheel.Deflection[5];
        Wheel.Deflection[4 + Count + 2] = Wheel.Deflection[6];
        Wheel.Deflection[4 + Count + 3] = Wheel.Deflection[7];
        Wheel.Velocity[3] = Wheel.Velocity[4 + Count - 1];
        Wheel.Velocity[2] = Wheel.Velocity[4 + Count - 2];
        Wheel.Velocity[1] = Wheel.Velocity[4 + Count - 3];
        Wheel.Velocity[0] = Wheel.Velocity[4 + Count - 4];
        Wheel.Velocity[4 + Count]     = Wheel.Velocity[4];
        Wheel.Velocity[4 + Count + 1] = Wheel.Velocity[5];
        Wheel.Velocity[4 + Count + 2] = Wheel.Velocity[6];
        Wheel.Velocity[4 + Count + 3] = Wheel.Velocity[7];

        // ② semi-implicit steps of the ring, then the contact projection. The belt is drawn by the cord it carries:
        //    inside the footprint it lies on the road (the tread cannot float over a road it is pressed against),
        //    outside it the tension and the bending carry the deflection away tangentially. So the projection runs
        //    from the deepest node outward and snaps the belt to the floor for as long as it keeps meeting it —
        //    the footprint is one interval, its length the chord, its ends where the belt lifts off.
        let Patch = 0;
        for (let Iteration = 0; Iteration < Steps; ++Iteration)
        {
            for (let Node = 4; Node < 4 + Count; ++Node)
            {
                const P2 = W[Node - 2], P1 = W[Node - 1], C = W[Node], N1 = W[Node + 1], N2 = W[Node + 2];
                const Force = TensionTerm * (N1 - 2.0 * C + P1) - BendingTerm * (N2 - 4.0 * N1 + 6.0 * C - 4.0 * P1 + P2)
                            - Foundation * C - Damping * V[Node];
                V[Node] += Force / Mass * Step;
            }
            for (let Node = 4; Node < 4 + Count; ++Node)
            {
                let Value = W[Node] + V[Node] * Step;
                if (Value < Floor[Node])
                {
                    Value = Floor[Node];
                    if (V[Node] < 0.0)
                        V[Node] = 0.0;
                }
                if (Value > Ceiling)
                {
                    Value = Ceiling;
                    if (V[Node] > 0.0)
                        V[Node] = 0.0;
                    if (Floor[Node] > Ceiling)
                        Wheel.Pinched = true;
                }
                W[Node] = Value;
            }
            if (!Empty && ChordHalf > 0.0)
                Patch = this.ConformContact(Wheel, Contact.DownAngle, ChordHalf, CarcassNodes);
        }

        // ③ what the shader reads besides the ring: lateral shift, bulge, folds, collapse, the volume and its rate
        const Ratio = Wheel.PressureRatio;
        const Lateral = Specification.LateralStiffness + Specification.LateralPerPascal * Pressure;
        const Target = Contact.InContact ? Math.max(-Specification.LateralCeiling, Math.min(Specification.LateralCeiling, (Contact.LateralForce || 0.0) / Lateral)) : 0.0;
        Wheel.LateralShift += (Target - Wheel.LateralShift) * Math.min(1.0, 0.35 * Math.max(0.25, Seconds * 60.0));
        Wheel.Bulge = 0.55 + 0.95 * Math.max(0.0, 1.0 - Ratio);
        let Peak = 0.0, Wave = 0.0, Mean = 0.0, Crease = 0.0;
        for (let Node = 4; Node < 4 + Count; ++Node)
        {
            const Value = W[Node];
            Peak = Math.max(Peak, Value);
            Mean += Value;
            if (Floor[Node] === -Infinity)
            {
                Wave = Math.max(Wave, Math.abs(Value));
                // 📐 The creases are what the ring does beyond its own smooth envelope: how far a node stands out of
                //    the neighbourhood's mean. A pressurised belt is smooth to the millimetre; a flat one is not.
                const Neighbourhood = (W[Node - 2] + W[Node - 1] + W[Node + 1] + W[Node + 2]) * 0.25;
                Crease = Math.max(Crease, Math.abs(Value - Neighbourhood));
            }
        }
        Mean /= Count;
        Wheel.Peak = Peak;
        Wheel.PatchNodes = Math.max(Patch, Patch === 0 ? 0 : Patch);
        Wheel.WavePeak = Wave;
        Wheel.ContactLength = Patch * Arc;
        // 📐 Airless collapse: past a third of the reference pressure the belt cannot hold the hub off the rim, and the
        //    tread creeps down onto it — CreasePerPascal per 100 kPa missing, scaled by how hard the tyre is working.
        const Missing = Math.max(0.0, 1.0 - Pressure / (0.33 * Specification.ReferencePressure));
        const Reach = Math.max(0.0, Math.min(1.0, Peak / Math.max(1.0e-4, this.Radius - this.RimRadius - Specification.PinchClearance)));
        Wheel.Collapse = Missing * Reach * Specification.CreasePerPascal;
        Wheel.Wrinkle = Math.min(0.030, (Crease * 1.6 + Missing * 0.010) * Specification.WrinkleScale);
        Wheel.WrinkleCount = 5.0 + Math.round(3.0 * Missing);
        // 📝 A tyre off its bead sits further in on the rim and its tread plane tilts; the shader draws that as an
        //    axial drop, and the squashed tread beats once a revolution as the contact patch reads the creases back.
        const TargetDrop = Unseated ? 0.022 * Math.min(1.0, Missing + 0.25) : 0.0;
        Wheel.AxisDrop += (TargetDrop - Wheel.AxisDrop) * Math.min(1.0, 1.5 * Math.max(0.0, Seconds));

        // ④ the enclosed gas: the cavity the belt and the rim wall off, referred to the volume the thermal model was
        //    calibrated with, so the air heats when the tyre is squashed and cools as it springs back.
        const BeltRadius = Math.max(this.RimRadius, this.Radius - Mean);
        const Cavity = Math.max(0.0, BeltRadius * BeltRadius - this.RimRadius * this.RimRadius);
        const Reference = Math.max(1.0e-6, this.Radius * this.Radius - this.RimRadius * this.RimRadius);
        const Volume = Specification.ReferenceVolume * (Unseated ? 0.55 : 1.0) * Cavity / Reference;
        const Prior = Wheel.Volume || Volume;
        Wheel.VolumeRate = Seconds > 1.0e-6 ? (Volume - Prior) / Seconds : 0.0;
        Wheel.Volume = Volume;

        // ⑤ the rolling radius a flat tyre turns through: the standard R − d/3 of the loaded cord, floored at the rim
        //    so a shredded wheel runs on its own radius, and modulated by the creases at the footprint.
        Wheel.RollingRadius = Math.max(this.RimRadius + 0.01, this.Radius - Peak / 3.0);
        Wheel.RollingLump = Crease * Missing;
    }

    // 📐 Inside the footprint the tread lies on the road: the floor's own offset, node for node, from the node the
    //    road points at outward. The footprint's ends are where the hub's height stops cutting the road — the chord —
    //    and the belt is held there against the ring that would otherwise pull it up. Returns the footprint's nodes.
    ConformContact(Wheel, DownAngle, ChordHalf, Count)
    {
        const Centre = ((Math.round((DownAngle / (2.0 * Math.PI)) * Count) % Count) + Count) % Count;
        const Step = 2.0 * Math.PI / Count;
        let Patch = 0;
        for (const Direction of [1, -1])
        {
            for (let Offset = Direction > 0 ? 0 : -1; Math.abs(Offset) * Step <= ChordHalf + 1.0e-6; Offset += Direction)
            {
                const Node = 4 + (((Centre + Offset) % Count) + Count) % Count;
                if (Wheel.Floor[Node] === -Infinity)
                    break;
                Wheel.Deflection[Node] = Wheel.Floor[Node];
                if (Wheel.Velocity[Node] < 0.0)
                    Wheel.Velocity[Node] = 0.0;
                ++Patch;
            }
        }
        return Math.min(Patch, Count);
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                   RECORDS
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 Four TyreCarcass records (TyreCarcass in SurfaceRaster.wgsl / ShadowRaster.wgsl): shape, pose, folds, state,
    //    then the 96 deflections.
    EncodeRecords()
    {
        const Scalars = new Float32Array(this.Bytes);
        const Stride = CarcassRecordBytes / 4;
        this.Wheels.forEach((Wheel, Index) =>
        {
            const Offset = Index * Stride;
            Scalars.set([this.Radius, this.RimRadius, this.HalfWidth, CarcassNodes], Offset);
            Scalars.set([Wheel.DownAngle, Wheel.LateralShift, CarcassSpecification.LateralSpread, Wheel.Bulge], Offset + 4);
            Scalars.set([Wheel.Wrinkle, Wheel.WrinkleCount, Wheel.Phase, Wheel.PressureRatio], Offset + 8);
            const Flags = (Wheel.Unseated ? 1.0 : 0.0) | (Wheel.Pinched ? 2.0 : 0.0) | (Wheel.PatchNodes > 0 ? 4.0 : 0.0);
            Scalars.set([Wheel.Collapse, Wheel.ContactLength, Wheel.AxisDrop, Flags], Offset + 12);
            for (let Node = 0; Node < CarcassNodes; ++Node)
                Scalars[Offset + 16 + Node] = Wheel.Deflection[4 + Node];
        });
        return this.Bytes;
    }

    // 🔍 What the panel and the tooling read: per wheel the contact patch, the peak deflection, the measured rate.
    QueryState(Index)
    {
        const Wheel = this.Wheels[Index];
        return {
            ContactLength: Wheel.ContactLength, PatchNodes: Wheel.PatchNodes, Peak: Wheel.Peak, WavePeak: Wheel.WavePeak,
            Collapse: Wheel.Collapse, Wrinkle: Wheel.Wrinkle, PressureRatio: Wheel.PressureRatio, Pinched: Wheel.Pinched,
            Unseated: Wheel.Unseated, RollingRadius: Wheel.RollingRadius, RollingLump: Wheel.RollingLump,
            Volume: Wheel.Volume, VolumeRate: Wheel.VolumeRate, LateralShift: Wheel.LateralShift
        };
    }

    QueryStiffnessTable()
    {
        return this.Rates.Points;
    }

    Reset()
    {
        for (const Wheel of this.Wheels)
        {
            Wheel.Deflection.fill(0.0);
            Wheel.Velocity.fill(0.0);
            Wheel.Collapse = 0.0;
            Wheel.AxisDrop = 0.0;
            Wheel.Wrinkle = 0.0;
            Wheel.VolumeRate = 0.0;
        }
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                              STATIC PROBE (CALIBRATION)
//------------------------------------------------------------------------------------------------------------------------

// 📝 The same ring, solved to rest instead of over a frame: the hub sunk by a fixed depth, the nodes relaxed until the
//    velocities die, then the load the foundation hands the road summed round the belt. Used at bring-up to measure
//    the radial rate, and by Tools/CarcassCheck.mjs to print the curve the vehicle solver interpolates.
export class TyreRing
{
    constructor(Radius, RimRadius, Nodes = CarcassNodes)
    {
        this.Radius = Radius;
        this.RimRadius = RimRadius;
        this.Nodes = Nodes;
        this.Arc = Radius * 2.0 * Math.PI / Nodes;
    }

    // 📐 Load carried [N] at a hub sink of Deflection [m] with the given gauge pressure and lateral shift of zero.
    SolveLoad(Pressure, Deflection, Steps = 6000)
    {
        const Specification = CarcassSpecification;
        const Operator = ResolveOperator(Pressure);
        const Mass = Specification.BeltMassPerLength;
        const Step = Specification.StepSeconds;
        const TensionTerm = Operator.Tension / (this.Arc * this.Arc);
        const BendingTerm = Specification.BendingStiffness / (this.Arc ** 4);
        const Pinch = this.Radius - this.RimRadius - Specification.PinchClearance;
        const Count = this.Nodes, Padded = Count + 8;
        const W = new Float64Array(Padded), V = new Float64Array(Padded), Floor = new Float64Array(Padded);
        const HubDistance = Math.max(0.0, this.Radius - Deflection);
        for (let Node = 0; Node < Count; ++Node)
        {
            let θ = (2.0 * Math.PI * Node) / Count + Math.PI / 2;   // the road straight below the hub
            θ = Math.atan2(Math.sin(θ), Math.cos(θ));
            Floor[4 + Node] = Math.abs(θ) < 1.35 ? this.Radius - HubDistance / Math.max(Math.cos(θ), 0.25) : -Infinity;
        }
        for (let Step_ = 0; Step_ < Steps; ++Step_)
        {
            for (let Node = 4; Node < 4 + Count; ++Node)
            {
                const P2 = W[Node - 2], P1 = W[Node - 1], C = W[Node], N1 = W[Node + 1], N2 = W[Node + 2];
                const Force = TensionTerm * (N1 - 2.0 * C + P1) - BendingTerm * (N2 - 4.0 * N1 + 6.0 * C - 4.0 * P1 + P2)
                            - Operator.Foundation * C - Operator.Damping * V[Node];
                V[Node] += Force / Mass * Step;
            }
            for (let Node = 4; Node < 4 + Count; ++Node)
            {
                let Value = W[Node] + V[Node] * Step;
                if (Value < Floor[Node])
                {
                    Value = Floor[Node];
                    V[Node] = 0.0;
                }
                if (Value > Pinch)
                {
                    Value = Math.min(Value, Pinch);
                    V[Node] = 0.0;
                }
                W[Node] = Value;
            }
            // 📝 Close the ring: the four nodes behind the first and the four ahead of the last.
            for (let Padding = 0; Padding < 4; ++Padding)
            {
                W[Padding] = W[Count + Padding];
                V[Padding] = V[Count + Padding];
                W[4 + Count + Padding] = W[4 + Padding];
                V[4 + Count + Padding] = V[4 + Padding];
            }
        }
        // 📐 The load: the foundation's own reaction, k·w per metre of belt, and its vertical share at each node.
        let Load = 0.0;
        for (let Node = 0; Node < Count; ++Node)
        {
            let θ = (2.0 * Math.PI * Node) / Count + Math.PI / 2;
            θ = Math.atan2(Math.sin(θ), Math.cos(θ));
            Load += Operator.Foundation * W[4 + Node] * Math.cos(θ) * this.Arc;
        }
        return { Load, Peak: Math.max(...Array.from(W.subarray(4, 4 + Count))) };
    }

    // 📐 ΔF/Δd over 2 mm and 4 mm of sink — the ring's own radial rate at this pressure.
    MeasureRate(Pressure)
    {
        const Low = this.SolveLoad(Pressure, 0.002, 5000).Load;
        const High = this.SolveLoad(Pressure, 0.004, 5000).Load;
        return Math.max(0.0, (High - Low) / 0.002);
    }
}
