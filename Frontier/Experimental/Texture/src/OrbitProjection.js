//============================================================================================================================================
// 🎥 OrbitProjection.js — damped orbit camera, view/clip matrices and screen → world ray construction
//============================================================================================================================================
// Column-major matrices, right-handed world, +Y up, reverse-free depth. The ray builder is the entry point for every brush
// query, decal placement and eyedropper pick, so it shares exactly the basis the raster pass uses.
//============================================================================================================================================

export class OrbitProjection
{
    constructor()
    {
        this.Azimuth = 0.72;                        // [rad]
        this.Inclination = 1.22;                    // [rad] from +Y
        this.Distance = 3.05;                       // [m]
        this.Centre = [0, 0.38, 0];                 // [m]
        this.FieldOfView = (42 * Math.PI) / 180;    // [rad]
        this.Aspect = 16 / 9;                       // [-]
        this.Near = 0.02;                           // [m]
        this.Far = 40;                              // [m]

        this.TargetAzimuth = this.Azimuth;
        this.TargetInclination = this.Inclination;
        this.TargetDistance = this.Distance;
        this.TargetCentre = [...this.Centre];

        this.Position = [0, 0, 0];
        this.Forward = [0, 0, -1];
        this.Right = [1, 0, 0];
        this.Up = [0, 1, 0];
        this.View = new Float32Array(16);
        this.Clip = new Float32Array(16);
        this.ViewClip = new Float32Array(16);
        this.Advance(1);
    }

    Frame(Radius = 1, Centre = [0, 0.38, 0])
    {
        this.TargetCentre = [...Centre];
        this.TargetDistance = Math.max(0.9, Radius * 2.6);
    }

    Restore()
    {
        this.TargetAzimuth = 0.72;
        this.TargetInclination = 1.22;
        this.TargetDistance = 3.05;
        this.TargetCentre = [0, 0.38, 0];
    }

    Orbit(DeltaX, DeltaY)
    {
        this.TargetAzimuth -= DeltaX * 0.0072;
        this.TargetInclination = Math.max(0.1, Math.min(Math.PI - 0.1, this.TargetInclination - DeltaY * 0.0072));
    }

    Pan(DeltaX, DeltaY)
    {
        const Scale = this.TargetDistance * 0.0013;
        for (let Axis = 0; Axis < 3; Axis += 1)
        {
            this.TargetCentre[Axis] -= this.Right[Axis] * DeltaX * Scale;
            this.TargetCentre[Axis] += this.Up[Axis] * DeltaY * Scale;
        }
    }

    Zoom(Delta)
    {
        this.TargetDistance = Math.max(0.55, Math.min(14, this.TargetDistance * (1 + Delta * 0.0012)));
    }

    Advance(Delta = 0.016)
    {
        const Factor = Math.min(1, Delta * 18);
        this.Azimuth += (this.TargetAzimuth - this.Azimuth) * Factor;
        this.Inclination += (this.TargetInclination - this.Inclination) * Factor;
        this.Distance += (this.TargetDistance - this.Distance) * Factor;
        for (let Axis = 0; Axis < 3; Axis += 1)
            this.Centre[Axis] += (this.TargetCentre[Axis] - this.Centre[Axis]) * Factor;

        const SineInclination = Math.sin(this.Inclination);
        const CosineInclination = Math.cos(this.Inclination);
        this.Position = [
            this.Centre[0] + this.Distance * SineInclination * Math.sin(this.Azimuth),
            this.Centre[1] + this.Distance * CosineInclination,
            this.Centre[2] + this.Distance * SineInclination * Math.cos(this.Azimuth),
        ];
        const Forward = [
            this.Centre[0] - this.Position[0],
            this.Centre[1] - this.Position[1],
            this.Centre[2] - this.Position[2],
        ];
        const Length = Math.hypot(...Forward) || 1;
        this.Forward = Forward.map((Component) => Component / Length);
        const Right = [
            this.Forward[1] * 0 - this.Forward[2] * 1,
            this.Forward[2] * 0 - this.Forward[0] * 0,
            this.Forward[0] * 1 - this.Forward[1] * 0,
        ];
        const RightLength = Math.hypot(...Right) || 1;
        this.Right = Right.map((Component) => Component / RightLength);
        this.Up = [
            this.Right[1] * this.Forward[2] - this.Right[2] * this.Forward[1],
            this.Right[2] * this.Forward[0] - this.Right[0] * this.Forward[2],
            this.Right[0] * this.Forward[1] - this.Right[1] * this.Forward[0],
        ];
        this.Compose();
        return this;
    }

    Compose()
    {
        const [Rx, Ry, Rz] = this.Right;
        const [Ux, Uy, Uz] = this.Up;
        const Bx = -this.Forward[0];
        const By = -this.Forward[1];
        const Bz = -this.Forward[2];
        const [Px, Py, Pz] = this.Position;
        const View = this.View;
        View[0] = Rx; View[4] = Ry; View[8] = Rz; View[12] = -(Rx * Px + Ry * Py + Rz * Pz);
        View[1] = Ux; View[5] = Uy; View[9] = Uz; View[13] = -(Ux * Px + Uy * Py + Uz * Pz);
        View[2] = Bx; View[6] = By; View[10] = Bz; View[14] = -(Bx * Px + By * Py + Bz * Pz);
        View[3] = 0; View[7] = 0; View[11] = 0; View[15] = 1;

        const Focal = 1 / Math.tan(this.FieldOfView / 2);
        const Range = 1 / (this.Near - this.Far);
        const Clip = this.Clip;
        Clip.fill(0);
        Clip[0] = Focal / this.Aspect;
        Clip[5] = Focal;
        Clip[10] = (this.Far + this.Near) * Range;
        Clip[11] = -1;
        Clip[14] = 2 * this.Far * this.Near * Range;

        const Product = this.ViewClip;
        for (let Column = 0; Column < 4; Column += 1)
            for (let Row = 0; Row < 4; Row += 1)
            {
                let Sum = 0;
                for (let Index = 0; Index < 4; Index += 1) Sum += Clip[Index * 4 + Row] * View[Column * 4 + Index];
                Product[Column * 4 + Row] = Sum;
            }
    }

    // Normalised device coordinates in [-1, 1], y up.
    Ray(DeviceX, DeviceY)
    {
        const TangentHalf = Math.tan(this.FieldOfView / 2);
        const PlaneX = DeviceX * this.Aspect * TangentHalf;
        const PlaneY = DeviceY * TangentHalf;
        const Direction = [
            this.Forward[0] + PlaneX * this.Right[0] + PlaneY * this.Up[0],
            this.Forward[1] + PlaneX * this.Right[1] + PlaneY * this.Up[1],
            this.Forward[2] + PlaneX * this.Right[2] + PlaneY * this.Up[2],
        ];
        const Length = Math.hypot(...Direction) || 1;
        return { Origin: [...this.Position], Direction: Direction.map((Component) => Component / Length) };
    }

    Serialise()
    {
        return {
            Azimuth: this.TargetAzimuth,
            Inclination: this.TargetInclination,
            Distance: this.TargetDistance,
            Centre: [...this.TargetCentre],
        };
    }

    Restitute(Record)
    {
        if (!Record) return;
        if (Number.isFinite(Record.Azimuth)) this.TargetAzimuth = Record.Azimuth;
        if (Number.isFinite(Record.Inclination)) this.TargetInclination = Record.Inclination;
        if (Number.isFinite(Record.Distance)) this.TargetDistance = Record.Distance;
        if (Array.isArray(Record.Centre) && Record.Centre.length === 3) this.TargetCentre = [...Record.Centre];
    }
}
