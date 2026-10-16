//============================================================================================================================================
//                                                         CABINSTRUCTURE.JS
//============================================================================================================================================
// 🧩 The ControlVehicle's cabin: an inner skin for the shell, the floor, seats and dashboard, a steering wheel, and the camera views
//    that look out of it.

// 📝 Body frame: +X forward, +Y left, +Z up, origin at the centre of mass (ProjectBodyFacets rebases the authored model onto it).
//    The cabin is measured from the body facets: the glazing spans x −0.79..1.26, y ±1.05, z 0.64..1.14. Every position below is
//    an estimate until it has been checked on a GPU, so they are gathered here to be tuned in one place.

import { CourseMaterial } from "./MaterialSpecification.js";
import { ResolveAxleMountLocal } from "./VehicleSpecification.js";
import { AddVector, SubtractVector, ScaleVector, MultiplyAddVector, CrossVector, DotVector, NormalizeVector, LengthVector,
         ConstructAxisQuaternion, MultiplyQuaternion, ConstructRigidTransform, MultiplyTransform,
         TransformPoint, TransformDirection } from "./TransformProjection.js";

export const DriverSide = 1.0;   // [-] +1 puts the driver on +Y (the left); −1 for a right-hand-drive car

export const CabinGeometry = Object.freeze({
    FloorTop:        0.29,                                    // [m] top of the floor pan, body frame z
    InnerSkinInset:  0.035,                                   // [m] the inner skin sits this far inside the shell
    DriverEye:       [0.10, 0.33 * DriverSide, 0.80],         // [m] seated eye point
    WheelHub:        [0.62, 0.30 * DriverSide, 0.64],         // [m] steering-wheel hub
    WheelTilt:       0.45,                                    // [rad] the rim's face tilts back toward the driver
    WheelRadius:     0.185,                                   // [m] radius of the rim's centreline
    WheelTube:       0.017,                                   // [m] radius of the rim section
    WheelSteerRatio: 15.0,                                    // [-] steering-wheel radians per road-wheel radian
    Dashboard:       { Centre: [0.90, 0.0, 0.495], Half: [0.10, 0.62, 0.205] },
    FloorPan:        { Centre: [0.25, 0.0, 0.27], Half: [1.05, 0.90, 0.02] },
    HiddenDepth:     -500.0                                  // [m] where a part is parked while it must not draw
});

//------------------------------------------------------------------------------------------------------------------------
//                                                    PRIMITIVES
//------------------------------------------------------------------------------------------------------------------------

// 📝 A closed box about Centre, with orthonormal axes U, V, W (right-handed) and half extents, wound outward.
//    For each axis k the face pair uses the other two axes p = k+1 and q = k+2, so p × q = axis k and a single
//    corner order gives an outward face for either sign.
function EmitOrientedBox(Centre, Axes, Half, Family)
{
    const Facets = [];
    const Point = (Coordinates) =>
    {
        let Result = Centre.slice();
        for (let Axis = 0; Axis < 3; ++Axis)
            Result = AddVector(Result, ScaleVector(Axes[Axis], Coordinates[Axis]));
        return Result;
    };
    for (let Axis = 0; Axis < 3; ++Axis)
    {
        const P = (Axis + 1) % 3, Q = (Axis + 2) % 3;
        for (const Sign of [1.0, -1.0])
        {
            const Corner = (SignP, SignQ) =>
            {
                const Coordinates = [0.0, 0.0, 0.0];
                Coordinates[Axis] = Sign * Half[Axis];
                Coordinates[P] = SignP * Half[P];
                Coordinates[Q] = SignQ * Half[Q];
                return Point(Coordinates);
            };
            const A = Corner(-1, -1), B = Corner(1, -1), C = Corner(1, 1), D = Corner(-1, 1);
            const Ring = Sign > 0.0 ? [A, B, C, D] : [A, D, C, B];
            Facets.push({ Corners: [Ring[0], Ring[1], Ring[2]], Family });
            Facets.push({ Corners: [Ring[0], Ring[2], Ring[3]], Family });
        }
    }
    return Facets;
}

function AxisAlignedAxes()
{
    return [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
}

// 📝 A torus about +Z through the origin: the rim section, wound outward. Each quad is split and each triangle is oriented
//    against the centreline point of its own segment, so the winding never depends on the parametrisation.
function EmitTorus(Radius, Tube, Major, Minor, Family)
{
    const Facets = [];
    const Surface = (I, J) =>
    {
        const Phi = 2.0 * Math.PI * I / Major, Theta = 2.0 * Math.PI * J / Minor;
        const Ring = Radius + Tube * Math.cos(Theta);
        return [Ring * Math.cos(Phi), Ring * Math.sin(Phi), Tube * Math.sin(Theta)];
    };
    const Centreline = (I) =>
    {
        const Phi = 2.0 * Math.PI * I / Major;
        return [Radius * Math.cos(Phi), Radius * Math.sin(Phi), 0.0];
    };
    const Push = (A, B, C, Reference) =>
    {
        const Normal = CrossVector(SubtractVector(B, A), SubtractVector(C, A));
        const Centroid = ScaleVector(AddVector(AddVector(A, B), C), 1.0 / 3.0);
        const Triangle = (DotVector(Normal, SubtractVector(Centroid, Reference)) < 0.0) ? [A, C, B] : [A, B, C];
        Facets.push({ Corners: Triangle, Family });
    };
    for (let I = 0; I < Major; ++I)
    {
        const Reference = Centreline(I + 0.5);
        for (let J = 0; J < Minor; ++J)
        {
            const A = Surface(I, J), B = Surface(I + 1, J), C = Surface(I + 1, J + 1), D = Surface(I, J + 1);
            Push(A, B, C, Reference);
            Push(A, C, D, Reference);
        }
    }
    return Facets;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    CABIN SETS
//------------------------------------------------------------------------------------------------------------------------

// 📝 The shell's inner side: every shell facet pushed inward along its normal and wound the other way, so from inside the
//    cabin the walls, roof and floor are the body seen from within. Glazing is left out by the caller, so the windows
//    are open from the inside and the outside world shows through them.
export function EmitInnerSkinFacets(ShellFacets)
{
    const Facets = [];
    for (const Facet of ShellFacets)
    {
        const [A, B, C] = Facet.Corners;
        const Cross = CrossVector(SubtractVector(B, A), SubtractVector(C, A));
        if (LengthVector(Cross) < 1.0e-12)
            continue;
        const Offset = ScaleVector(NormalizeVector(Cross), -CabinGeometry.InnerSkinInset);
        Facets.push({ Corners: [AddVector(A, Offset), AddVector(C, Offset), AddVector(B, Offset)], Family: CourseMaterial.VehicleTrim });
    }
    return Facets;
}

// 📝 Floor pan, dashboard and the two seats, in the body frame. The driver's seat sits on DriverSide.
export function EmitCabinTrimFacets()
{
    const Axes = AxisAlignedAxes();
    const Facets = [];
    const Trim = CourseMaterial.VehicleTrim;
    Facets.push(...EmitOrientedBox(CabinGeometry.FloorPan.Centre, Axes, CabinGeometry.FloorPan.Half, Trim));
    Facets.push(...EmitOrientedBox(CabinGeometry.Dashboard.Centre, Axes, CabinGeometry.Dashboard.Half, Trim));
    for (const Side of [DriverSide, -DriverSide])
    {
        const Floor = CabinGeometry.FloorTop;
        Facets.push(...EmitOrientedBox([0.02, 0.33 * Side, Floor + 0.08], Axes, [0.24, 0.24, 0.08], Trim));   // cushion
        Facets.push(...EmitOrientedBox([-0.22, 0.33 * Side, Floor + 0.38], Axes, [0.07, 0.24, 0.22], Trim));  // backrest
    }
    return Facets;
}

// 📝 The steering wheel in its own frame: rim in the XY plane with its axis along +Z (toward the driver), three spokes
//    (the top spoke is along +X, the bottom one along −X) and a hub boss. ConstructSteeringTransform places it in the body.
export function EmitSteeringWheelFacets()
{
    const Trim = CourseMaterial.VehicleTrim;
    const Facets = EmitTorus(CabinGeometry.WheelRadius, CabinGeometry.WheelTube, 48, 10, Trim);
    const Inner = 0.05, Outer = CabinGeometry.WheelRadius - 0.01;
    for (const Angle of [Math.PI / 3.0, Math.PI, 5.0 * Math.PI / 3.0])
    {
        const Direction = [Math.cos(Angle), Math.sin(Angle), 0.0];
        const Across = [-Math.sin(Angle), Math.cos(Angle), 0.0];
        const Centre = ScaleVector(Direction, 0.5 * (Inner + Outer));
        Facets.push(...EmitOrientedBox(Centre, [Direction, Across, [0.0, 0.0, 1.0]],
                                       [0.5 * (Outer - Inner), 0.011, 0.011], Trim));
    }
    Facets.push(...EmitOrientedBox([0.0, 0.0, 0.0], AxisAlignedAxes(), [0.05, 0.05, 0.03], CourseMaterial.VehiclePlastic));
    return Facets;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    POSES
//------------------------------------------------------------------------------------------------------------------------

// 📝 The rim's face normal is +Z tilted back toward the driver by WheelTilt. Rotating +Z about −Y by (π/2 − tilt) gives
//    (−cos tilt, 0, sin tilt); the rim's top (+X) lands on (sin tilt, 0, cos tilt).
const WheelFacing = ConstructAxisQuaternion([0.0, -1.0, 0.0], 0.5 * Math.PI - CabinGeometry.WheelTilt);

// 📝 The steering wheel in the body frame: hub at WheelHub, the face tilted back toward the driver, and the steering turn
//    about the wheel's own axis. A positive road-wheel angle (left) turns the wheel counter-clockwise seen by the driver.
export function ConstructSteeringTransform(BodyTransform, RoadWheelAngle)
{
    const Spin = ConstructAxisQuaternion([0.0, 0.0, 1.0], RoadWheelAngle * CabinGeometry.WheelSteerRatio);
    const Local = ConstructRigidTransform(CabinGeometry.WheelHub, MultiplyQuaternion(WheelFacing, Spin));
    return MultiplyTransform(BodyTransform, Local);
}

// 📝 Parked well below the course, so a part that must not draw is clipped away and costs nothing to rasterise.
//    The same convention as a broken prop (ParkedHeight in FacetStructure.js).
export const HiddenTransform = ConstructRigidTransform([0.0, 0.0, CabinGeometry.HiddenDepth], [0.0, 0.0, 0.0, 1.0]);

//------------------------------------------------------------------------------------------------------------------------
//                                                    CAMERA VIEWS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Debug view on the front left axle, from the authored socket so it follows the spec rather than a guess.
const FrontLeftAxle = ResolveAxleMountLocal(0);
const FrontLeftAxleEye = [FrontLeftAxle[0] + 0.9, FrontLeftAxle[1] + 1.6, FrontLeftAxle[2] + 0.5];

// 📝 The views F9 cycles through. Eye and At are body-frame points; Look is a body-frame direction. Interior views hide the
//    glazing, so the windscreen is see-through. The first entry is the chase camera, the default outside view.
export const CabinViews = Object.freeze([
    Object.freeze({ Id: "chase",       Label: "Chase camera",              Interior: false }),
    Object.freeze({ Id: "driver",      Label: "Driver eye",                Interior: true,  Eye: CabinGeometry.DriverEye,
                    Look: [1.0, 0.0, -0.10], FieldOfView: 62.0 }),
    Object.freeze({ Id: "passenger",   Label: "Passenger eye",             Interior: true,  Eye: [0.10, -0.33 * DriverSide, 0.80],
                    Look: [1.0, 0.0, -0.10], FieldOfView: 62.0 }),
    Object.freeze({ Id: "rear",        Label: "Rear seat",                 Interior: true,  Eye: [-0.45, 0.0, 0.85],
                    Look: [1.0, 0.0, -0.10], FieldOfView: 62.0 }),
    Object.freeze({ Id: "wheel",       Label: "Steering wheel close-up",   Interior: true,  Eye: [1.00, 0.12 * DriverSide, 0.92],
                    At: CabinGeometry.WheelHub, FieldOfView: 45.0 }),
    Object.freeze({ Id: "front-left",  Label: "Front left axle (debug)",   Interior: false,
                    Eye: FrontLeftAxleEye, At: FrontLeftAxle, FieldOfView: 45.0 })
]);

// 📝 The camera for a view, riding the body matrix so the cabin pitches and rolls with the car.
export function ResolveCabinCamera(View, BodyTransform)
{
    const Position = TransformPoint(BodyTransform, View.Eye);
    const Target = View.At ? TransformPoint(BodyTransform, View.At)
                           : MultiplyAddVector(Position, NormalizeVector(TransformDirection(BodyTransform, View.Look)), 10.0);
    return { Position, Target };
}
