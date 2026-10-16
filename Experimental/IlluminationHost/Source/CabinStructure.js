//============================================================================================================================================
//                                                           CABINSTRUCTURE.JS
//============================================================================================================================================
// 🧩 The ControlVehicle's cabin: dashboard, steering wheel, seats, lamp and the HMI screens, placed from Project-Drive's cabin layout.
//
// 📝 Frontier's HMI demo (Project-Drive, branch arena/4f07c82a-frontier, Plans/Ongoing/SurfaceDisplayCabinHMI.md) puts a
//    tablet on the centre stack, a cluster ahead of the driver and a lamp in the headliner — but the .blend carries no
//    dashboard, wheel or screen sockets, so DriveCabinLayout.h estimates every fixture from the authored shell. Those
//    estimates are lifted here verbatim (model frame, origin at hub height): the tablet, the four cluster outlines,
//    the driver's eye and the lamp. Added for the exhibit: the dashboard slab the screens stand on, a steering wheel
//    that turns with the road wheels, the column shroud, the console, two seats, and passenger and rear-bench eyes for
//    the interior debug cameras.
//
// 📝 Everything is emitted rebased onto the centre of mass (z − ResolveCoMAuthoredZ()), exactly as ProjectBodyFacets
//    rebases the shell — so the fixtures ride the body occupant transform unchanged, and the steering wheel rides the
//    body transform composed with a spin about its column.

import { CourseMaterial } from "./MaterialSpecification.js";
import { ResolveCoMAuthoredZ } from "./VehicleSpecification.js";
import { ConstructAxisQuaternion, RotateVector, ConstructRigidTransform, MultiplyTransform, NormalizeVector,
         CrossVector, ScaleVector, AddVector, SubtractVector } from "./TransformProjection.js";

//------------------------------------------------------------------------------------------------------------------------
//                                              LAYOUT (MODEL FRAME)
//------------------------------------------------------------------------------------------------------------------------

// 📝 DriveCabinLayout.h, verbatim: cowl (windscreen base) X +1.335 Z +0.735, windscreen top X +0.529 Z +1.322, roof
//    Z +1.35, shell half-width 1.25, left-hand drive (+Y is left, driver at +0.42).
export const CabinFixtures = Object.freeze({
    Tablet:  { Centre: [0.98, 0.00, 0.62], Tilt: 0.42, Width: 0.30, Height: 0.19, Bezel: 0.012, Brightness: 2.2 },
    Cluster: { Centre: [0.86, 0.42, 0.92], Tilt: 0.14, Bezel: 0.010, Brightness: 2.6 }
});

// 📝 ClusterSequence.js outlines: unit polylines over [-1, 1]² shared by the raster clip and the hardware.
export const ClusterOutlines = Object.freeze({
    hexagon:   { Width: 0.34, Height: 0.19,
                 Points: [[-0.62, -1], [0.62, -1], [1, 0], [0.62, 1], [-0.62, 1], [-1, 0]] },
    arc:       { Width: 0.26, Height: 0.26, Points: null },   // 70 % circle, cut at the top (built below)
    trapezoid: { Width: 0.36, Height: 0.17,
                 Points: [[-0.78, -1], [0.78, -1], [1, 1], [-1, 1]] },
    pill:      { Width: 0.40, Height: 0.13, Points: null }    // wide band (built below)
});

function ProjectArcOutline()
{
    const Points = [];
    for (let Index = 0; Index <= 72; ++Index)
    {
        const Angle = Math.PI * 0.8 + Math.PI * 1.4 * Index / 72;
        Points.push([Math.cos(Angle), Math.sin(Angle)]);
    }
    return Points;
}

function ProjectPillOutline()
{
    const Points = [];
    for (let Index = 0; Index <= 24; ++Index)
    {
        const Angle = -Math.PI / 2 + Math.PI * Index / 24;
        Points.push([0.68 + 0.32 * Math.cos(Angle), Math.sin(Angle)]);
    }
    for (let Index = 0; Index <= 24; ++Index)
    {
        const Angle = Math.PI / 2 + Math.PI * Index / 24;
        Points.push([-0.68 + 0.32 * Math.cos(Angle), Math.sin(Angle)]);
    }
    return Points;
}

export function ResolveClusterOutline(Identifier)
{
    const Outline = ClusterOutlines[Identifier] || ClusterOutlines.hexagon;
    if (Outline.Points)
        return Outline;
    return { ...Outline, Points: Identifier === "arc" ? ProjectArcOutline() : ProjectPillOutline() };
}

// 📝 CabinScreenBasis in DriveCabinLayout.h: Right is the viewer's right (−Y), Up leans back with the tilt, Toward
//    faces the viewer.
export function ProjectScreenBasis(Tilt)
{
    return { Right: [0.0, -1.0, 0.0],
             Up:     [Math.sin(Tilt), 0.0, Math.cos(Tilt)],
             Toward: [-Math.cos(Tilt), 0.0, Math.sin(Tilt)] };
}

// 📝 The driver's eye from CabinDriverEyeFixture, plus a passenger eye mirrored across the centreline and a rear-bench
//    eye for the debug cameras. Position is model frame; PitchDown [rad] and vertical field of view [rad].
export const CabinEyes = Object.freeze({
    driver:    { Position: [-0.20,  0.42, 1.12], PitchDown: 0.21, FieldOfView: 1.22 },
    passenger: { Position: [-0.20, -0.42, 1.12], PitchDown: 0.18, FieldOfView: 1.13 },
    rear:      { Position: [-0.95,  0.00, 1.10], PitchDown: 0.10, FieldOfView: 1.13 }
});

export const CabinEyeOrder = Object.freeze(["driver", "passenger", "rear"]);

// 📝 The headliner lamp (CabinLampFixture): a small downward disc behind the windscreen header.
export const CabinLamp = Object.freeze({ Centre: [0.15, 0.0, 1.30], Radius: 0.045 });

// 📝 The steering wheel: centre ahead of the driver under the cluster, the column running down-forward into the dash.
//    VisualLockTurns: road lock maps to this many turns of the wheel (a GT coupé rack).
export const SteeringWheel = Object.freeze({
    Centre: [0.68, 0.42, 0.88], ColumnBase: [0.98, 0.42, 0.72],
    Radius: 0.185, Tube: 0.021, HubRadius: 0.055, VisualLockTurns: 1.4
});

//------------------------------------------------------------------------------------------------------------------------
//                                              FACET EMISSION
//------------------------------------------------------------------------------------------------------------------------

function Rebased(Point)
{
    return [Point[0], Point[1], Point[2] - ResolveCoMAuthoredZ()];
}

function EmitBox(Centre, Extent, Family)
{
    const [X, Y, Z] = Rebased(Centre);
    const [HX, HY, HZ] = [Extent[0] / 2, Extent[1] / 2, Extent[2] / 2];
    const P = [];
    for (const SZ of [-1, 1])
        for (const SY of [-1, 1])
            for (const SX of [-1, 1])
                P.push([X + SX * HX, Y + SY * HY, Z + SZ * HZ]);
    // 📐 Outward winding per face: [face corners], counter-clockwise seen from outside.
    const Faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    return Faces.flatMap(([A, B, C, D]) => [{ Corners: [P[A], P[B], P[C]], Family }, { Corners: [P[A], P[C], P[D]], Family }]);
}

// 📝 A seat backrest: a box whose top edge is sheared rearward by Recline.
function EmitReclinedBox(Centre, Extent, Recline, Family)
{
    const [X, Y, Z] = Rebased(Centre);
    const [HX, HY, HZ] = [Extent[0] / 2, Extent[1] / 2, Extent[2] / 2];
    const P = [];
    for (const SZ of [-1, 1])
        for (const SY of [-1, 1])
            for (const SX of [-1, 1])
                P.push([X + SX * HX + (SZ > 0 ? Recline : 0.0), Y + SY * HY, Z + SZ * HZ]);
    const Faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    return Faces.flatMap(([A, B, C, D]) => [{ Corners: [P[A], P[B], P[C]], Family }, { Corners: [P[A], P[C], P[D]], Family }]);
}

function EmitOrientedBox(Centre, U, V, W, Family)
{
    const C = Rebased(Centre);
    const P = [];
    for (const SW of [-1, 1])
        for (const SV of [-1, 1])
            for (const SU of [-1, 1])
                P.push(AddVector(C, AddVector(ScaleVector(U, SU), AddVector(ScaleVector(V, SV), ScaleVector(W, SW)))));
    const Faces = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]];
    return Faces.flatMap(([A, B, C, D]) => [{ Corners: [P[A], P[B], P[C]], Family }, { Corners: [P[A], P[C], P[D]], Family }]);
}

function EmitDisc(Centre, Radius, Facing, Family, Segments = 12)
{
    const C = Rebased(Centre);
    const Normal = NormalizeVector(Facing);
    const Helper = Math.abs(Normal[2]) > 0.9 ? [1.0, 0.0, 0.0] : [0.0, 0.0, 1.0];
    const U = NormalizeVector(CrossVector(Normal, Helper));
    const V = CrossVector(Normal, U);
    const Facets = [];
    for (let Segment = 0; Segment < Segments; ++Segment)
    {
        const A0 = 2.0 * Math.PI * Segment / Segments, A1 = 2.0 * Math.PI * (Segment + 1) / Segments;
        const P0 = AddVector(C, AddVector(ScaleVector(U, Radius * Math.cos(A0)), ScaleVector(V, Radius * Math.sin(A0))));
        const P1 = AddVector(C, AddVector(ScaleVector(U, Radius * Math.cos(A1)), ScaleVector(V, Radius * Math.sin(A1))));
        Facets.push({ Corners: [C, P0, P1], Family });
    }
    return Facets;
}

function EmitCylinderAlongAxis(Centre, Axis, Radius, From, To, Family, Segments = 12)
{
    const C = Rebased(Centre);
    const A = NormalizeVector(Axis);
    const Helper = Math.abs(A[2]) > 0.9 ? [1.0, 0.0, 0.0] : [0.0, 0.0, 1.0];
    const U = NormalizeVector(CrossVector(A, Helper));
    const V = CrossVector(A, U);
    const Ring = (S) => AddVector(C, ScaleVector(A, S));
    const Facets = [];
    for (let Segment = 0; Segment < Segments; ++Segment)
    {
        const A0 = 2.0 * Math.PI * Segment / Segments, A1 = 2.0 * Math.PI * (Segment + 1) / Segments;
        const D0 = AddVector(ScaleVector(U, Math.cos(A0)), ScaleVector(V, Math.sin(A0)));
        const D1 = AddVector(ScaleVector(U, Math.cos(A1)), ScaleVector(V, Math.sin(A1)));
        const Q00 = AddVector(Ring(From), ScaleVector(D0, Radius)), Q01 = AddVector(Ring(To), ScaleVector(D0, Radius));
        const Q10 = AddVector(Ring(From), ScaleVector(D1, Radius)), Q11 = AddVector(Ring(To), ScaleVector(D1, Radius));
        Facets.push({ Corners: [Q00, Q10, Q11], Family });
        Facets.push({ Corners: [Q00, Q11, Q01], Family });
        Facets.push({ Corners: [Ring(To), AddVector(Ring(To), ScaleVector(D0, Radius)), AddVector(Ring(To), ScaleVector(D1, Radius))], Family });
        Facets.push({ Corners: [Ring(From), AddVector(Ring(From), ScaleVector(D1, Radius)), AddVector(Ring(From), ScaleVector(D0, Radius))], Family });
    }
    return Facets;
}

function EmitTorus(Centre, Axis, Radius, Tube, Family, RingSegments = 28, TubeSegments = 8)
{
    const C = Rebased(Centre);
    const A = NormalizeVector(Axis);
    const Helper = Math.abs(A[1]) > 0.9 ? [1.0, 0.0, 0.0] : [0.0, 1.0, 0.0];
    const U = NormalizeVector(CrossVector(A, Helper));
    const V = CrossVector(A, U);
    const Point = (θ, φ) =>
    {
        const Ring = AddVector(ScaleVector(U, Radius * Math.cos(θ)), ScaleVector(V, Radius * Math.sin(θ)));
        const Out = NormalizeVector(Ring);
        return AddVector(AddVector(C, Ring), AddVector(ScaleVector(Out, Tube * Math.cos(φ)), ScaleVector(A, Tube * Math.sin(φ))));
    };
    const Facets = [];
    for (let Ring = 0; Ring < RingSegments; ++Ring)
    {
        for (let TubeIndex = 0; TubeIndex < TubeSegments; ++TubeIndex)
        {
            const T0 = 2.0 * Math.PI * Ring / RingSegments, T1 = 2.0 * Math.PI * (Ring + 1) / RingSegments;
            const P0 = 2.0 * Math.PI * TubeIndex / TubeSegments, P1 = 2.0 * Math.PI * (TubeIndex + 1) / TubeSegments;
            const Q00 = Point(T0, P0), Q10 = Point(T1, P0), Q11 = Point(T1, P1), Q01 = Point(T0, P1);
            Facets.push({ Corners: [Q00, Q10, Q11], Family });
            Facets.push({ Corners: [Q00, Q11, Q01], Family });
        }
    }
    return Facets;
}

// 📝 The static cabin: dash, cluster cowl, column shroud, console, seats and the headliner lamp. All VehiclePlastic
//    but the lamp disc, which carries the strip-light emission so the cabin reads at night.
export function EmitCabinFixtureFacets()
{
    const Plastic = CourseMaterial.VehiclePlastic;
    const Facets = [];
    Facets.push(...EmitBox([1.01, 0.00, 0.585], [0.58, 1.36, 0.27], Plastic));            // dashboard slab
    Facets.push(...EmitBox([0.88, 0.42, 1.005], [0.16, 0.38, 0.03], Plastic));            // cluster cowl brow
    Facets.push(...EmitBox([0.88, 0.225, 0.955], [0.16, 0.03, 0.11], Plastic));           // cowl cheek, inner
    Facets.push(...EmitBox([0.88, 0.615, 0.955], [0.16, 0.03, 0.11], Plastic));           // cowl cheek, outer
    Facets.push(...EmitBox([0.82, 0.42, 0.79], [0.30, 0.10, 0.10], Plastic));             // column shroud
    Facets.push(...EmitBox([0.55, 0.00, 0.41], [0.65, 0.24, 0.22], Plastic));             // centre console
    for (const Side of [0.42, -0.42])
    {
        Facets.push(...EmitBox([-0.30, Side, 0.36], [0.50, 0.52, 0.12], Plastic));        // seat base
        Facets.push(...EmitReclinedBox([-0.585, Side, 0.685], [0.12, 0.52, 0.53], -0.10, Plastic)); // backrest
        Facets.push(...EmitBox([-0.66, Side, 1.00], [0.10, 0.24, 0.12], Plastic));        // headrest
    }
    Facets.push(...EmitDisc(CabinLamp.Centre, CabinLamp.Radius, [0.0, 0.0, -1.0], CourseMaterial.StripLight));
    return Facets;
}

// 📝 The steering wheel in its rest orientation: rim torus, three spokes, hub barrel and horn pad, about the column
//    axis through the wheel centre. The occupant transform spins this about the same axis with the steer angle.
export function EmitSteeringWheelFacets()
{
    const { Centre, ColumnBase, Radius, Tube, HubRadius } = SteeringWheel;
    const Axis = NormalizeVector(SubtractVector(Centre, ColumnBase));
    const Plastic = CourseMaterial.VehiclePlastic, Trim = CourseMaterial.VehicleTrim;
    const Facets = [];
    Facets.push(...EmitTorus(Centre, Axis, Radius, Tube, Plastic));
    const Helper = Math.abs(Axis[1]) > 0.9 ? [1.0, 0.0, 0.0] : [0.0, 1.0, 0.0];
    const U = NormalizeVector(CrossVector(Axis, Helper));
    const V = CrossVector(Axis, U);
    // 📐 Three spokes in the wheel plane: left, right and down (U points down-forward, V across).
    const Inner = HubRadius + 0.01, Outer = Radius - Tube * 0.5;
    for (const Direction of [V, ScaleVector(V, -1.0), U])
    {
        const Middle = AddVector(Centre, ScaleVector(Direction, (Inner + Outer) / 2));
        const Along = ScaleVector(Direction, (Outer - Inner) / 2);
        const Across = ScaleVector(NormalizeVector(CrossVector(Axis, Direction)), 0.023);
        const Thick = ScaleVector(Axis, 0.015);
        Facets.push(...EmitOrientedBox(Middle, Along, Across, Thick, Trim));
    }
    Facets.push(...EmitCylinderAlongAxis(Centre, Axis, HubRadius, -0.03, 0.05, Plastic));
    Facets.push(...EmitCylinderAlongAxis(AddVector(Centre, ScaleVector(Axis, 0.05)), Axis, 0.042, 0.0, 0.02, Trim));
    return { Facets, Axis };
}

//------------------------------------------------------------------------------------------------------------------------
//                                              SCREENS · EYES · STEERING
//------------------------------------------------------------------------------------------------------------------------

// 📝 A screen quad in body-local space: corners with UVs over the canvas (v = 0 is the canvas top), sized to the glass
//    plus its bezel. The cluster quad follows the chosen outline; the tablet is fixed.
export function ProjectScreenQuad(Name, OutlineIdentifier = "hexagon")
{
    const Fixture = Name === "cluster" ? CabinFixtures.Cluster : CabinFixtures.Tablet;
    const Outline = Name === "cluster" ? ResolveClusterOutline(OutlineIdentifier) : { Width: Fixture.Width, Height: Fixture.Height };
    const Basis = ProjectScreenBasis(Fixture.Tilt);
    const HalfU = Outline.Width / 2 + Fixture.Bezel, HalfV = Outline.Height / 2 + Fixture.Bezel;
    const Corner = (SU, SV) => Rebased(AddVector(Fixture.Centre, AddVector(ScaleVector(Basis.Right, SU * HalfU),
                                                                           ScaleVector(Basis.Up, SV * HalfV))));
    return {
        Name, Width: HalfU * 2, Height: HalfV * 2,
        Corners: [{ Position: Corner(-1, -1), UV: [0, 1] }, { Position: Corner(1, -1), UV: [1, 1] },
                  { Position: Corner(1, 1), UV: [1, 0] }, { Position: Corner(-1, 1), UV: [0, 1] }]
    };
}

// 📝 An interior eye in body-local space, for a chassis-rigid debug camera.
export function ProjectCabinEye(Identifier)
{
    const Eye = CabinEyes[Identifier] || CabinEyes.driver;
    return { Position: Rebased(Eye.Position), PitchDown: Eye.PitchDown, FieldOfView: Eye.FieldOfView };
}

// 📝 The steering wheel's occupant transform: body · T(centre) · R(column, θ) · T(−centre), with the road-wheel
//    angle mapped onto the visual lock. Positive steer (left) turns the wheel's top toward +Y, the driver's left.
export function ProjectSteeringTransform(BodyTransform, SteerAngle, MaxSteerAngle)
{
    const { Centre, ColumnBase, VisualLockTurns } = SteeringWheel;
    const Axis = NormalizeVector(SubtractVector(Centre, ColumnBase));
    const θ = (SteerAngle / Math.max(1.0e-4, MaxSteerAngle)) * VisualLockTurns * Math.PI;
    const CentreLocal = Rebased(Centre);
    const Quaternion = ConstructAxisQuaternion(Axis, θ);
    const Rotated = RotateVector(Quaternion, CentreLocal);
    const Local = ConstructRigidTransform(SubtractVector(CentreLocal, Rotated), Quaternion);
    return MultiplyTransform(BodyTransform, Local);
}
