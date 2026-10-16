// Reduced pneumatic shell: 48 circumferential sectors, radial AND axial belt DOFs, fixed beads.
// Backward Euler + bounded coordinate descent of a convex quadratic (not XPBD).
// State lives in a road-aligned frame: spinning a wheel cannot drag its contact patch around the rim.
// The vehicle's implicit unsprung-mass solve supplies hub closure, pressure and lateral force.
export const CarcassNodes = 48;
export const CarcassRecordBytes = 3 * 16 + 2 * CarcassNodes * 4;
export const CarcassSpecification = Object.freeze({
    StepSeconds: 1 / 240, MaximumSteps: 16, Sweeps: 16, ReferencePressure: 220000,
    SectorMass: 0.28, RadialFoundation: 12000, RadialPerPascal: 0.045,
    BeltCoupling: 45000, AxialFoundation: 2200, AxialPerPascal: 0.025,
    AxialCoupling: 9000, Damping: 90, LateralCeiling: 0.065, PinchClearance: 0.022
});
const Tau = 2 * Math.PI;

export class TyreCarcassSolver
{
    constructor(Radius, RimRadius, HalfWidth)
    {
        this.Radius = Radius;
        this.RimRadius = RimRadius;
        this.HalfWidth = HalfWidth;
        this.Wheels = Array.from({ length: 4 }, (_, I) => ({
            Deflection: new Float64Array(CarcassNodes), Velocity: new Float64Array(CarcassNodes),
            Axial: new Float64Array(CarcassNodes), AxialVelocity: new Float64Array(CarcassNodes),
            Floor: new Float64Array(CarcassNodes), RHS: new Float64Array(CarcassNodes),
            DownAngle: -Math.PI / 2, HubDistance: Radius + 1, LateralShift: 0, Bulge: 0,
            Wrinkle: 0, PressureRatio: 1, Pinched: false, PatchNodes: 0, Peak: 0, WavePeak: 0,
            Phase: I * 1.7 + 0.4
        }));
        this.Accumulator = 0;
        this.Bytes = new ArrayBuffer(4 * CarcassRecordBytes);
    }

    Advance(Contacts, Seconds)
    {
        const S = CarcassSpecification;
        this.Accumulator = Math.min(this.Accumulator + Math.max(0, Seconds), S.StepSeconds * S.MaximumSteps);
        const Steps = Math.floor((this.Accumulator + 1e-12) / S.StepSeconds);
        this.Accumulator = Math.max(0, this.Accumulator - Steps * S.StepSeconds);
        for (let I = 0; I < 4; ++I) this.AdvanceWheel(this.Wheels[I], Contacts[I], Steps);
    }

    SolveField(Wheel, X, V, Foundation, Coupling, Force, Radial)
    {
        const S = CarcassSpecification, N = CarcassNodes, H = S.StepSeconds;
        const Inertia = S.SectorMass / (H * H), Drag = S.Damping / H;
        const Diagonal = Inertia + Drag + Foundation + 2 * Coupling;
        const RHS = Wheel.RHS;
        // Reuse velocity storage for old positions after constructing the inertial RHS.
        for (let I = 0; I < N; ++I)
        {
            const Angle = Tau * I / N;
            const Spread = Math.exp(-Math.pow(Math.atan2(Math.sin(Angle), Math.cos(Angle)) / 0.65, 2));
            RHS[I] = (Inertia + Drag) * X[I] + S.SectorMass / H * V[I] + Force * Spread;
            V[I] = X[I];
        }
        const Pinch = this.Radius - this.RimRadius - S.PinchClearance;
        for (let Sweep = 0; Sweep < S.Sweeps; ++Sweep)
            for (let J = 0; J < N; ++J)
            {
                // Alternating sweep avoids a preferred direction around the carcass.
                const I = Sweep & 1 ? N - 1 - J : J;
                let Value = (RHS[I] + Coupling * (X[(I + N - 1) % N] + X[(I + 1) % N])) / Diagonal;
                if (Radial) Value = Math.max(Wheel.Floor[I], Math.min(Pinch, Value));
                else Value = Math.max(-S.LateralCeiling, Math.min(S.LateralCeiling, Value));
                X[I] = Value;
            }
        for (let I = 0; I < N; ++I) V[I] = (X[I] - V[I]) / H;
    }

    AdvanceWheel(Wheel, Contact, Steps)
    {
        const S = CarcassSpecification, N = CarcassNodes;
        if (Contact.Shredded)
        {
            Wheel.Deflection.fill(0); Wheel.Velocity.fill(0);
            Wheel.Axial.fill(0); Wheel.AxialVelocity.fill(0);
        }
        const InContact = Contact.InContact && !Contact.Shredded;
        const Pressure = Math.max(0, Contact.Pressure);
        const Ratio = Math.min(2, Pressure / S.ReferencePressure);
        Wheel.DownAngle = Contact.DownAngle;
        Wheel.HubDistance = InContact ? Math.max(this.RimRadius + S.PinchClearance, Contact.HubDistance) : this.Radius + 1;
        Wheel.PressureRatio = Ratio;
        Wheel.Bulge = 0.45 + 0.65 * Math.max(0, 1 - Ratio);
        Wheel.Wrinkle = InContact ? 0.009 * Math.pow(Math.max(0, 1 - Ratio / 0.3), 2) : 0;
        const Pinch = this.Radius - this.RimRadius - S.PinchClearance;
        Wheel.Pinched = InContact && Contact.HubDistance < this.RimRadius + S.PinchClearance;
        for (let I = 0; I < N; ++I)
        {
            const Cosine = Math.cos(Tau * I / N);
            Wheel.Floor[I] = InContact && Cosine > 0.05
                ? Math.max(0, Math.min(Pinch, this.Radius - Wheel.HubDistance / Cosine)) : 0;
        }
        // The road fixes the patch closure. The implicit shell spreads it, with pressure-dependent stiffness,
        // damped rebound and sidewall shear from cornering; no allocation and no 3600 Hz explicit steps.
        const Foundation = S.RadialFoundation + S.RadialPerPascal * Pressure;
        const AxialFoundation = S.AxialFoundation + S.AxialPerPascal * Pressure;
        const LateralForce = InContact ? Math.max(-18000, Math.min(18000, Contact.LateralForce || 0)) / 8 : 0;
        for (let Step = 0; Step < Steps; ++Step)
        {
            this.SolveField(Wheel, Wheel.Deflection, Wheel.Velocity, Foundation, S.BeltCoupling, 0, true);
            this.SolveField(Wheel, Wheel.Axial, Wheel.AxialVelocity, AxialFoundation, S.AxialCoupling, LateralForce, false);
        }
        Wheel.Peak = 0; Wheel.PatchNodes = 0; Wheel.WavePeak = 0;
        for (let I = 0; I < N; ++I)
        {
            Wheel.Peak = Math.max(Wheel.Peak, Wheel.Deflection[I]);
            if (Wheel.Floor[I] > 0 && Math.abs(Wheel.Deflection[I] - Wheel.Floor[I]) < 1e-5) ++Wheel.PatchNodes;
            if (!Wheel.Floor[I]) Wheel.WavePeak = Math.max(Wheel.WavePeak, Wheel.Deflection[I]);
        }
        Wheel.LateralShift = Wheel.Axial[0];
    }

    EncodeRecords()
    {
        const Scalars = new Float32Array(this.Bytes);
        this.Wheels.forEach((Wheel, I) => {
            const Offset = I * CarcassRecordBytes / 4;
            Scalars.set([this.Radius, this.RimRadius, this.HalfWidth, Wheel.HubDistance], Offset);
            Scalars.set([Wheel.DownAngle, Wheel.LateralShift, 0.65, Wheel.Bulge], Offset + 4);
            Scalars.set([Wheel.Wrinkle, 9, Wheel.Phase, Wheel.PressureRatio], Offset + 8);
            Scalars.set(Wheel.Deflection, Offset + 12);
            Scalars.set(Wheel.Axial, Offset + 12 + CarcassNodes);
        });
        return this.Bytes;
    }

    Reset()
    {
        this.Accumulator = 0;
        for (const Wheel of this.Wheels)
        {
            for (const Key of ["Deflection", "Velocity", "Axial", "AxialVelocity", "Floor", "RHS"]) Wheel[Key].fill(0);
            Object.assign(Wheel, { DownAngle: -Math.PI / 2, HubDistance: this.Radius + 1, LateralShift: 0,
                Bulge: 0, Wrinkle: 0, PressureRatio: 1, Pinched: false, PatchNodes: 0, Peak: 0, WavePeak: 0 });
        }
    }
}
