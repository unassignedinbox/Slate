// Pneumatic shell/contact law shared by the unsprung-mass solve and carcass reconstruction.
// SI units. This is a calibrated reduced-order tyre, NOT volumetric FEM or a material-only effect.
export const PneumaticSpecification = Object.freeze({
    ReferencePressure: 220000,
    CasingStiffness: 12000,       // N/m, unpressurised rubber/cords
    CasingHardening: 12000,      // N/m, progressively folding sidewall
    FlangeStiffness: 1500000,    // N/m, metal stop after rubber is pinched
    PinchClearance: 0.022,       // m
    RadialDamping: 700,         // N s/m
    ReferenceVolume: 0.045,      // m^3, matches the thermal model
    AtmosphericPressure: 101325
});

export function ResolveTyreVolume(Deflection, Radius, HalfWidth)
{
    const D = Math.max(0, Math.min(Radius * 0.8, Deflection));
    // Volume displaced by the flattened circular segment; lateral bulging recovers 55%.
    const Segment = Radius * Radius * Math.acos((Radius - D) / Radius)
                  - (Radius - D) * Math.sqrt(Math.max(0, 2 * Radius * D - D * D));
    return Math.max(0.6 * PneumaticSpecification.ReferenceVolume,
                    PneumaticSpecification.ReferenceVolume - 0.45 * 2 * HalfWidth * Segment);
}

export function EvaluateTyreContact(Deflection, Pressure, Radius, RimRadius, HalfWidth, Shredded = false)
{
    const S = PneumaticSpecification;
    const D = Math.max(0, Deflection);
    if (Shredded)
        return { Force: S.FlangeStiffness * D, Stiffness: S.FlangeStiffness, Pinched: false };
    const Height = Math.max(0.02, Radius - RimRadius);
    const Pinch = Math.max(0.001, Height - S.PinchClearance);
    const Fold = D / Height;
    // Effective pneumatic support area, calibrated to ~200 kN/m at 220 kPa for the authored tyre.
    // The full geometric patch area is NOT p*A: doing that double-counts belt tension at its edges.
    const Area = 4 * HalfWidth * D * (1 + 0.5 * Fold);
    const Force = S.CasingStiffness * D + S.CasingHardening * D * Fold * Fold
                + Math.max(0, Pressure) * Area + S.FlangeStiffness * Math.max(0, D - Pinch);
    const Stiffness = S.CasingStiffness + 3 * S.CasingHardening * Fold * Fold
                    + Math.max(0, Pressure) * 4 * HalfWidth * (1 + Fold)
                    + (D > Pinch ? S.FlangeStiffness : 0);
    return { Force, Stiffness, Pinched: D > Pinch };
}

// Backward Euler of the wheel's unsprung DOF. Extension is positive toward the road.
// A monotone scalar solve couples strut spring/damper, wheel inertia, tyre support/damping and bump/droop stops.
// Bisection is bounded, independent of ring resolution, and has no XPBD iterations.
export function AdvanceWheelHub(Wheel, Strut, Input, Seconds)
{
    const { StaticLength, TouchLength, Projection, MountNormalVelocity, Pressure, Radius, RimRadius,
            HalfWidth, Mass, Shredded } = Input;
    const S = PneumaticSpecification;
    const Old = Wheel.Length, Velocity = Wheel.ExtensionVelocity || 0;
    const Bump = StaticLength - Strut.BumpTravel;
    const Droop = StaticLength + Strut.DroopTravel;
    const Spring = (Length) => {
        const Compression = Math.max(0, Strut.FreeLength - Length);
        return Strut.Preload + Strut.SpringForce(Compression)
             + 600000 * Math.max(0, Bump - Length) - 600000 * Math.max(0, Length - Droop);
    };
    const Evaluate = (Length) => {
        const Rate = (Length - Old) / Seconds;
        const D = Number.isFinite(TouchLength) ? Math.max(0, (Length - TouchLength) * Projection) : 0;
        const Contact = EvaluateTyreContact(D, Pressure, Radius, RimRadius, HalfWidth, Shredded);
        const TyreForce = D > 0 ? Math.max(0, Contact.Force + S.RadialDamping * (Projection * Rate - MountNormalVelocity)) : 0;
        const StrutForce = Spring(Length) - Strut.DampingRate * Rate;
        const Residual = Mass * (Rate - Velocity) / Seconds - StrutForce - Mass * 9.81 * Projection + TyreForce * Projection;
        return { Residual, Rate, D, TyreForce, StrutForce, Pinched: Contact.Pinched };
    };
    // Expand the bracket for exceptional impacts rather than silently returning a non-root.
    let Low = Math.min(Bump - 0.5, Old - 0.5), High = Math.max(Droop + 0.5, Old + 0.5);
    for (let I = 0; I < 8 && Evaluate(Low).Residual > 0; ++I) Low -= 1;
    for (let I = 0; I < 8 && Evaluate(High).Residual < 0; ++I) High += 1;
    for (let I = 0; I < 28; ++I)
    {
        const Mid = (Low + High) * 0.5;
        if (Evaluate(Mid).Residual > 0) High = Mid; else Low = Mid;
    }
    const Length = (Low + High) * 0.5;
    return { Length, ...Evaluate(Length) };
}
