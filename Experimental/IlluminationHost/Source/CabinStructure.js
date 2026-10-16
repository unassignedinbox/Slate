//============================================================================================================================
//                                                          CABINSTRUCTURE.JS
//============================================================================================================================
// 🧩 The cockpit the driver sits in: the tub and its bulkheads, the dashboard and console, the pillars and roof hoops, two
//    seats, the steering wheel, and the cabin lamp — the inside of the car the HMI demo draws, authored here against
//    DriveCabinLayout.h's fixtures so the exhibit and the C++ engine show the same cabin.

// 📝 The C++ fixtures are quoted in the authored model frame; FacetStructure rebases the body onto the centre of mass
//    (z − 0.11285 m), so every fixture below is quoted already rebased and attaches to the body occupant unchanged. The
//    cabin is one facet set and one dynamic occupant; the steering wheel is a second, because it turns with the rack,
//    and the screens are two more (CabinPanel.js) so their segments can be lit and dimmed by rewriting families.

//! include "FacetStructure.js" for OccupantRole and the transform records.

import { EmitBlockFacets, EmitLatheFacets } from "./YardStructure.js";
import { ConstructIdentityTransform, MultiplyTransform } from "./TransformProjection.js";
import { CourseMaterial } from "./MaterialSpecification.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                        FIXTURES
//------------------------------------------------------------------------------------------------------------------------

// 📐 DriveCabinLayout.h, rebased onto the centre of mass. Model frame → centre of mass: z − 0.11285 m, x and y unchanged.
//    x is forward (the nose at +3.11 m), y is left, z is up; the driver sits on the +y side.
export const CabinFixtures = Object.freeze({
    DriverEye:        [-0.20,  0.42, 1.00715],   // [m] driver's eye point, DriveCabinLayout::DriverEye
    DriverPitch:      0.21,                      // [rad] DOWN from level, DriveCabinLayout::DriverPitch
    DriverFieldOfView: 1.22,                     // [rad] vertical, DriveCabinLayout::DriverFieldOfView
    Cluster:          { Width: 0.34, Height: 0.19, Tilt: 0.44, Luminance: 3.5, Hexagon: 6 },
    Tablet:           { Centre: [0.98, 0.0, 0.50715], Width: 0.30, Height: 0.19, Tilt: 0.42, Luminance: 3.0, Columns: 4, Rows: 3 },
    Lamp:             { Centre: [0.15, 0.0, 1.18715], Radius: 0.045, Luminance: 40.0 },
    Steering:         { Centre: [0.62, 0.42, 0.90], Rake: 0.44, RimRadius: 0.235, TubeRadius: 0.019, HubRadius: 0.055,
                        ColumnLength: 0.30, Ratio: 12.0, Segments: 6, MinMajorSegments: 24, MinMinorSegments: 6 },
    Tub:              { HalfWidth: 0.72, Floor: 0.245, Thickness: 0.020, SillTop: 0.44, Bulkhead: -1.42, Cowl: 1.24, Roof: 1.19 },
    Seats:            { HalfWidth: 0.23, Rows: [0.42, -0.42], Cushion: [-0.78, -0.18, 0.265, 0.40], Backrest: [-0.72, 0.40, -0.50, 0.98] }
});

// 📐 The screen basis DriveCabinLayout::CabinScreenBasis uses: the screens face −x toward the driver, tilted by Tilt so
//    their tops lean away. Right is the car's −y, up is (sin T, 0, cos T), and the face normal is (−cos T, 0, sin T).
export function CabinScreenBasis(Tilt)
{
    return { Right: [0.0, -1.0, 0.0], Up: [Math.sin(Tilt), 0.0, Math.cos(Tilt)], Toward: [-Math.cos(Tilt), 0.0, Math.sin(Tilt)] };
}

// 📐 The steering wheel's own frame: local +z points back at the driver along the column, +y is up, +x is the car's right,
//    and the whole thing spins about its own +z with the rack. The matrix is written from the basis directly — Right, Up
//    and Toward as its three columns — so there is no quaternion composition to get backwards.
export function CabinSteeringTransform(SteeringAngle = 0.0)
{
    const Wheel = CabinFixtures.Steering;
    const Basis = CabinScreenBasis(Wheel.Rake);
    const Cos = Math.cos(SteeringAngle), Sin = Math.sin(SteeringAngle);
    const Right = [Basis.Right[0] * Cos + Basis.Up[0] * Sin, Basis.Right[1] * Cos + Basis.Up[1] * Sin, Basis.Right[2] * Cos + Basis.Up[2] * Sin];
    const Up    = [Basis.Up[0] * Cos - Basis.Right[0] * Sin, Basis.Up[1] * Cos - Basis.Right[1] * Sin, Basis.Up[2] * Cos - Basis.Right[2] * Sin];
    const Out = new Float32Array(16);
    Out[0] = Right[0]; Out[1] = Right[1]; Out[2] = Right[2];
    Out[4] = Up[0];    Out[5] = Up[1];    Out[6] = Up[2];
    Out[8] = Basis.Toward[0]; Out[9] = Basis.Toward[1]; Out[10] = Basis.Toward[2];
    Out[12] = Wheel.Centre[0]; Out[13] = Wheel.Centre[1]; Out[14] = Wheel.Centre[2];
    Out[15] = 1.0;
    return Out;
}

// 📝 A lathe profile that touches the axis collapses to zero-area facets at the pole, whose winding nothing can tell; the
//    cabin's own lathes stay a few millimetres off it, and this drops anything that still comes out degenerate.
export function DropDegenerateFacets(Facets)
{
    return Facets.filter((Facet) =>
    {
        const [A, B, C] = Facet.Corners;
        const Ux = B[0] - A[0], Uy = B[1] - A[1], Uz = B[2] - A[2];
        const Vx = C[0] - A[0], Vy = C[1] - A[1], Vz = C[2] - A[2];
        const Nx = Uy * Vz - Uz * Vy, Ny = Uz * Vx - Ux * Vz, Nz = Ux * Vy - Uy * Vx;
        return Nx * Nx + Ny * Ny + Nz * Nz > 1.0e-14;
    });
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FACET EMITTERS
//------------------------------------------------------------------------------------------------------------------------

// 📝 A convex profile in (x, z) swept along y, outward-facing: the workhorse for the dash, the bulkheads, the pillars and
//    the seat shells, all of which are plates standing across the car. The profile's winding is normalised so the side
//    quads face away from the axis whichever way the author listed the points.
function NormalizeProfile(Profile)
{
    let Area = 0.0;
    for (let Index = 0; Index < Profile.length; ++Index)
    {
        const [X0, Z0] = Profile[Index], [X1, Z1] = Profile[(Index + 1) % Profile.length];
        Area += X0 * Z1 - X1 * Z0;
    }
    return Area > 0.0 ? [...Profile].reverse() : Profile;
}

export function EmitProfileFacets(Facets, Profile, MinimumY, MaximumY, Family)
{
    const Points = NormalizeProfile(Profile), Count = Points.length;
    for (let Index = 0; Index < Count; ++Index)
    {
        const [X0, Z0] = Points[Index], [X1, Z1] = Points[(Index + 1) % Count];
        Facets.push({ Corners: [[X0, MinimumY, Z0], [X1, MinimumY, Z1], [X1, MaximumY, Z1]], Family });
        Facets.push({ Corners: [[X0, MinimumY, Z0], [X1, MaximumY, Z1], [X0, MaximumY, Z0]], Family });
    }
    for (let Index = 1; Index + 1 < Count; ++Index)
    {
        const [X0, Z0] = Points[0], [X1, Z1] = Points[Index], [X2, Z2] = Points[Index + 1];
        Facets.push({ Corners: [[X0, MaximumY, Z0], [X1, MaximumY, Z1], [X2, MaximumY, Z2]], Family });
        Facets.push({ Corners: [[X0, MinimumY, Z0], [X2, MinimumY, Z2], [X1, MinimumY, Z1]], Family });
    }
    return Facets;
}

// 📝 A tube of revolution about the local +z: the wheel's rim.
export function EmitTorusFacets(Facets, MajorRadius, TubeRadius, MajorSegments, MinorSegments, Family)
{
    const Point = (Major, Minor) =>
    {
        const θ = (2.0 * Math.PI * Major) / MajorSegments, φ = (2.0 * Math.PI * Minor) / MinorSegments;
        const Radius = MajorRadius + TubeRadius * Math.cos(φ);
        return [Radius * Math.cos(θ), Radius * Math.sin(θ), TubeRadius * Math.sin(φ)];
    };
    for (let Major = 0; Major < MajorSegments; ++Major)
    {
        for (let Minor = 0; Minor < MinorSegments; ++Minor)
        {
            const A = Point(Major, Minor), B = Point(Major + 1, Minor), C = Point(Major + 1, Minor + 1), D = Point(Major, Minor + 1);
            Facets.push({ Corners: [A, B, C], Family });
            Facets.push({ Corners: [A, C, D], Family });
        }
    }
    return Facets;
}

// 📐 A quad through the screen basis: the patch every display segment and every display body is cut from.
export function EmitScreenQuad(Facets, Centre, Basis, MinimumU, MinimumV, MaximumU, MaximumV, Family)
{
    const Corner = (U, V) =>
    {
        const Right = Basis.Right, Up = Basis.Up;
        return [Centre[0] + Right[0] * U + Up[0] * V, Centre[1] + Right[1] * U + Up[1] * V, Centre[2] + Right[2] * U + Up[2] * V];
    };
    const A = Corner(MinimumU, MinimumV), B = Corner(MaximumU, MinimumV), C = Corner(MaximumU, MaximumV), D = Corner(MinimumU, MaximumV);
    Facets.push({ Corners: [A, B, C], Family });
    Facets.push({ Corners: [A, C, D], Family });
    return Facets;
}

// 📐 Linear maps in the cabin's own frames: local (x, y, z) → world, used to place the wheel's parts and the screens.
function MapCorners(Facets, Origin, Right, Up, Forward)
{
    const Map = (Corner) =>
    {
        const X = Corner[0], Y = Corner[1], Z = Corner[2];
        return [Origin[0] + Right[0] * X + Up[0] * Y + Forward[0] * Z,
                Origin[1] + Right[1] * X + Up[1] * Y + Forward[1] * Z,
                Origin[2] + Right[2] * X + Up[2] * Y + Forward[2] * Z];
    };
    return Facets.map((Facet) => ({ Corners: Facet.Corners.map(Map), Family: Facet.Family }));
}

function Append(Target, Source, Origin, Right, Up, Forward)
{
    Target.push(...MapCorners(Source, Origin, Right, Up, Forward));
    return Target;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       SHELL
//------------------------------------------------------------------------------------------------------------------------

// 📝 The tub: floor, sills, tunnel, console, the raked firewall under the screen, the rear bulkhead, the dashboard shelf,
//    a knee bolster, the pillars and both hoops, the lamp, and the two seats. Every plate stands inside the body shell —
//    the widest thing here is the sill at |y| = 0.74 m against the shell's 1.25 m — so nothing shows through the paint.
export function EmitCabinFacets()
{
    const Trim = CourseMaterial.CabinTrim, Seat = CourseMaterial.CabinSeat;
    const Tub = CabinFixtures.Tub, Seats = CabinFixtures.Seats;
    const Facets = [];

    // ① floor, sills, tunnel and the rear bulkhead
    EmitBlockFacets(Facets, [-1.40, -Tub.HalfWidth, Tub.Floor - Tub.Thickness], [1.18, Tub.HalfWidth, Tub.Floor], Trim);
    for (const Side of [1.0, -1.0])
    {
        const [Inner, Outer] = Side > 0.0 ? [0.66, 0.74] : [-0.74, -0.66];
        EmitBlockFacets(Facets, [-1.10, Math.min(Inner, Outer), Tub.Floor], [1.05, Math.max(Inner, Outer), Tub.SillTop], Trim);
    }
    EmitBlockFacets(Facets, [-0.60, -0.17, Tub.Floor], [1.06, 0.17, 0.42], Trim);
    EmitBlockFacets(Facets, [-0.34, -0.18, 0.42], [0.72, 0.18, 0.52], Trim);
    EmitBlockFacets(Facets, [Tub.Bulkhead, -Tub.HalfWidth, Tub.Floor], [-1.32, Tub.HalfWidth, 1.02], Trim);

    // ② footwell: the firewall rakes back from the floor to the cowl, and a heel plate closes the front of the tub
    EmitProfileFacets(Facets, [[1.02, Tub.Floor], [1.32, 0.60], [1.20, 0.68], [0.92, Tub.Floor]], -0.70, 0.70, Trim);
    EmitBlockFacets(Facets, [1.10, -0.72, Tub.Floor], [1.30, 0.72, 0.34], Trim);

    // ③ dashboard: a shelf from the cowl back toward the driver, a fascia panel behind the console's tablet, and a knee
    //    bolster. The fascia sits at x ≥ 1.06 m so the tablet's fixture (face at 0.939 m, back at 1.019 m) stands clear
    //    of it, and the shelf's top is 0.62 m against the tablet's 0.594 m crown.
    EmitProfileFacets(Facets, [[0.86, 0.62], [Tub.Cowl, 0.575], [Tub.Cowl, 0.68], [0.86, 0.75]], -0.70, 0.70, Trim);
    EmitProfileFacets(Facets, [[1.06, 0.30], [1.24, 0.30], [1.24, 0.62], [1.06, 0.62]], -0.68, 0.68, Trim);
    EmitBlockFacets(Facets, [0.52, -0.66, 0.30], [0.80, 0.66, 0.36], Trim);

    // ④ the roof: A-pillars raked from the cowl corners to the front hoop, the front hoop itself, and the rear hoop
    for (const Side of [1.0, -1.0])
    {
        const [Inner, Outer] = Side > 0.0 ? [0.58, 0.66] : [-0.66, -0.58];
        EmitProfileFacets(Facets, [[1.22, 0.60], [0.80, Tub.Roof], [0.78, Tub.Roof - 0.02], [1.20, 0.58]], Inner, Outer, Trim);
    }
    EmitProfileFacets(Facets, [[0.78, Tub.Roof - 0.04], [0.94, Tub.Roof], [0.92, Tub.Roof + 0.03], [0.76, Tub.Roof - 0.01]], -0.60, 0.60, Trim);
    EmitProfileFacets(Facets, [[-1.26, 1.00], [-1.10, 1.14], [-1.13, 1.17], [-1.29, 1.03]], -0.60, 0.60, Trim);

    // ⑤ the seats: cushion, backrest and head restraint, mirrored about the tunnel
    for (const Row of Seats.Rows)
    {
        const [Minimum, Maximum] = [Row - Seats.HalfWidth, Row + Seats.HalfWidth];
        EmitBlockFacets(Facets, [Seats.Cushion[0], Minimum, Seats.Cushion[2]], [Seats.Cushion[1], Maximum, Seats.Cushion[3]], Seat);
        EmitProfileFacets(Facets, [[Seats.Backrest[0], Seats.Backrest[1]], [Seats.Backrest[2], Seats.Backrest[3]],
                                   [Seats.Backrest[2] - 0.12, Seats.Backrest[3]], [Seats.Backrest[0] - 0.12, Seats.Backrest[1]]],
                          Minimum, Maximum, Seat);
        EmitBlockFacets(Facets, [Seats.Backrest[2] - 0.02, Row - 0.14, Seats.Backrest[3]], [Seats.Backrest[2] + 0.10, Row + 0.14, Seats.Backrest[3] + 0.14], Seat);
    }

    // ⑥ the cabin lamp, the fixture DriveCabinLayout lights the interior with
    EmitLatheFacets([[0.005, 0.0], [CabinFixtures.Lamp.Radius, 0.012], [CabinFixtures.Lamp.Radius, 0.028], [0.005, 0.04]], 16, CourseMaterial.CabinLamp)
        .forEach((Facet) => Facets.push({ Corners: Facet.Corners.map(([X, Y, Z]) => [CabinFixtures.Lamp.Centre[0] + X, CabinFixtures.Lamp.Centre[1] + Y, CabinFixtures.Lamp.Centre[2] + Z]),
                                          Family: Facet.Family }));
    return Facets;
}

// 📝 The steering wheel in its own frame: the rim, three spokes, the hub and the column that carries it into the dash.
export function EmitSteeringFacets()
{
    const Wheel = CabinFixtures.Steering, Trim = CourseMaterial.CabinTrim;
    const Local = [];
    EmitTorusFacets(Local, Wheel.RimRadius, Wheel.TubeRadius, Wheel.MinMajorSegments, Wheel.MinMinorSegments, Trim);
    for (let Spoke = 0; Spoke < Wheel.Segments / 2; ++Spoke)
    {
        const θ = (2.0 * Math.PI * Spoke) / (Wheel.Segments / 2) + Math.PI * 0.5;
        const Direction = [Math.cos(θ), Math.sin(θ), 0.0], Across = [-Math.sin(θ), Math.cos(θ), 0.0];
        const Scratch = EmitBlockFacets([], [Wheel.HubRadius, -0.026, -0.012], [Wheel.RimRadius - 0.008, 0.026, 0.010], Trim);
        Append(Local, Scratch, [0.0, 0.0, 0.0], Direction, Across, [0.0, 0.0, 1.0]);
    }
    EmitLatheFacets([[0.006, -0.03], [Wheel.HubRadius, -0.03], [Wheel.HubRadius, 0.022], [0.006, 0.035]], 16, Trim)
        .forEach((Facet) => Local.push(Facet));
    EmitLatheFacets([[0.028, -0.02], [0.045, 0.0], [0.045, Wheel.ColumnLength], [0.028, Wheel.ColumnLength]], 12, Trim)
        .forEach((Facet) => Local.push({ Corners: Facet.Corners.map(([X, Y, Z]) => [X, -Y, -Z]), Family: Facet.Family }));

    const Basis = CabinScreenBasis(Wheel.Rake);
    const Right = Basis.Right, Up = Basis.Up, Forward = Basis.Toward;
    return MapCorners(Local, Wheel.Centre, Right, Up, Forward);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       OCCUPANTS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Adds the cabin to the scene and returns the occupants the host drives: the shell and the wheel, both attached to the
//    body. The screens are CabinPanel.js's, which attaches its own two to the same frames.
export function ConstructCabin(Scene, Roles)
{
    const Shell = Scene.ConstructFacetSet("Cabin shell", DropDegenerateFacets(EmitCabinFacets()), 0.03, 40.0);
    const Steering = Scene.ConstructFacetSet("Cabin steering wheel", DropDegenerateFacets(EmitSteeringFacets()), 0.02, 40.0);
    const Identity = ConstructIdentityTransform();
    const Occupant = Scene.ConstructOccupant("Cabin", Shell, Identity, Roles);
    // 📐 The wheel rides on its own transform: the body's, turned by the rack through the steering ratio.
    const SteerOccupant = Scene.ConstructOccupant("Cabin steering wheel", Steering, CabinSteeringTransform(0.0), Roles);
    Scene.ResolveRasterRuns();
    return { Occupant, SteerOccupant, Shell, Steering };
}

// 📐 The wheel's transform this frame: its rest pose in the body frame, spun about the column by SteeringAngle·Ratio.
export function QuerySteeringTransform(BodyTransform, SteeringAngle)
{
    return MultiplyTransform(BodyTransform, CabinSteeringTransform(SteeringAngle * CabinFixtures.Steering.Ratio));
}
