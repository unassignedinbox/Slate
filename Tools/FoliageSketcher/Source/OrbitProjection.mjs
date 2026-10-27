//============================================================================================================================================
// 📦 OrbitProjection — orbit camera and the world ↔ clip transforms, right-handed Z-up (CLAUDE.md §7).
//============================================================================================================================================
// Column-major 4×4 matrices, the layout WebGL's uniformMatrix4fv expects with transpose = false.
//
// One difference from the engine's CameraProjection: WebGL clip space is z ∈ [−1, 1] while Vulkan is z ∈ [0, 1].
//    That single divergence lives in Perspective() and nowhere else, so the port swaps one function.

export function MultiplyMatrix(Left, Right)
{
    const Out = new Float32Array(16);
    for (let Column = 0; Column < 4; ++Column)
        for (let Row = 0; Row < 4; ++Row)
        {
            let Sum = 0.0;
            for (let Inner = 0; Inner < 4; ++Inner) Sum += Left[Inner * 4 + Row] * Right[Column * 4 + Inner];
            Out[Column * 4 + Row] = Sum;
        }
    return Out;
}

export function InvertMatrix(Source)
{
    const M = Source, Out = new Float32Array(16);

    Out[0]  =  M[5]*M[10]*M[15] - M[5]*M[11]*M[14] - M[9]*M[6]*M[15] + M[9]*M[7]*M[14] + M[13]*M[6]*M[11] - M[13]*M[7]*M[10];
    Out[4]  = -M[4]*M[10]*M[15] + M[4]*M[11]*M[14] + M[8]*M[6]*M[15] - M[8]*M[7]*M[14] - M[12]*M[6]*M[11] + M[12]*M[7]*M[10];
    Out[8]  =  M[4]*M[9]*M[15]  - M[4]*M[11]*M[13] - M[8]*M[5]*M[15] + M[8]*M[7]*M[13] + M[12]*M[5]*M[11] - M[12]*M[7]*M[9];
    Out[12] = -M[4]*M[9]*M[14]  + M[4]*M[10]*M[13] + M[8]*M[5]*M[14] - M[8]*M[6]*M[13] - M[12]*M[5]*M[10] + M[12]*M[6]*M[9];
    Out[1]  = -M[1]*M[10]*M[15] + M[1]*M[11]*M[14] + M[9]*M[2]*M[15] - M[9]*M[3]*M[14] - M[13]*M[2]*M[11] + M[13]*M[3]*M[10];
    Out[5]  =  M[0]*M[10]*M[15] - M[0]*M[11]*M[14] - M[8]*M[2]*M[15] + M[8]*M[3]*M[14] + M[12]*M[2]*M[11] - M[12]*M[3]*M[10];
    Out[9]  = -M[0]*M[9]*M[15]  + M[0]*M[11]*M[13] + M[8]*M[1]*M[15] - M[8]*M[3]*M[13] - M[12]*M[1]*M[11] + M[12]*M[3]*M[9];
    Out[13] =  M[0]*M[9]*M[14]  - M[0]*M[10]*M[13] - M[8]*M[1]*M[14] + M[8]*M[2]*M[13] + M[12]*M[1]*M[10] - M[12]*M[2]*M[9];
    Out[2]  =  M[1]*M[6]*M[15]  - M[1]*M[7]*M[14]  - M[5]*M[2]*M[15] + M[5]*M[3]*M[14] + M[13]*M[2]*M[7]  - M[13]*M[3]*M[6];
    Out[6]  = -M[0]*M[6]*M[15]  + M[0]*M[7]*M[14]  + M[4]*M[2]*M[15] - M[4]*M[3]*M[14] - M[12]*M[2]*M[7]  + M[12]*M[3]*M[6];
    Out[10] =  M[0]*M[5]*M[15]  - M[0]*M[7]*M[13]  - M[4]*M[1]*M[15] + M[4]*M[3]*M[13] + M[12]*M[1]*M[7]  - M[12]*M[3]*M[5];
    Out[14] = -M[0]*M[5]*M[14]  + M[0]*M[6]*M[13]  + M[4]*M[1]*M[14] - M[4]*M[2]*M[13] - M[12]*M[1]*M[6]  + M[12]*M[2]*M[5];
    Out[3]  = -M[1]*M[6]*M[11]  + M[1]*M[7]*M[10]  + M[5]*M[2]*M[11] - M[5]*M[3]*M[10] - M[9]*M[2]*M[7]   + M[9]*M[3]*M[6];
    Out[7]  =  M[0]*M[6]*M[11]  - M[0]*M[7]*M[10]  - M[4]*M[2]*M[11] + M[4]*M[3]*M[10] + M[8]*M[2]*M[7]   - M[8]*M[3]*M[6];
    Out[11] = -M[0]*M[5]*M[11]  + M[0]*M[7]*M[9]   + M[4]*M[1]*M[11] - M[4]*M[3]*M[9]  - M[8]*M[1]*M[7]   + M[8]*M[3]*M[5];
    Out[15] =  M[0]*M[5]*M[10]  - M[0]*M[6]*M[9]   - M[4]*M[1]*M[10] + M[4]*M[2]*M[9]  + M[8]*M[1]*M[6]   - M[8]*M[2]*M[5];

    let Determinant = M[0]*Out[0] + M[1]*Out[4] + M[2]*Out[8] + M[3]*Out[12];
    if (Math.abs(Determinant) < 1.0e-12) return Out;

    Determinant = 1.0 / Determinant;
    for (let Index = 0; Index < 16; ++Index) Out[Index] *= Determinant;
    return Out;
}

// Right-handed look-at with +Z up.
export function LookAt(Eye, Target, Up)
{
    let Forward = [Target[0] - Eye[0], Target[1] - Eye[1], Target[2] - Eye[2]];
    const ForwardLength = Math.hypot(...Forward) || 1.0;
    Forward = Forward.map((Component) => Component / ForwardLength);

    let Right = [
        Forward[1] * Up[2] - Forward[2] * Up[1],
        Forward[2] * Up[0] - Forward[0] * Up[2],
        Forward[0] * Up[1] - Forward[1] * Up[0]
    ];
    const RightLength = Math.hypot(...Right) || 1.0;
    Right = Right.map((Component) => Component / RightLength);

    const Above = [
        Right[1] * Forward[2] - Right[2] * Forward[1],
        Right[2] * Forward[0] - Right[0] * Forward[2],
        Right[0] * Forward[1] - Right[1] * Forward[0]
    ];

    return new Float32Array([
        Right[0], Above[0], -Forward[0], 0,
        Right[1], Above[1], -Forward[1], 0,
        Right[2], Above[2], -Forward[2], 0,
        -(Right[0]*Eye[0] + Right[1]*Eye[1] + Right[2]*Eye[2]),
        -(Above[0]*Eye[0] + Above[1]*Eye[1] + Above[2]*Eye[2]),
          Forward[0]*Eye[0] + Forward[1]*Eye[1] + Forward[2]*Eye[2],
        1
    ]);
}

// WebGL depth convention: clip z ∈ [−1, 1].
export function Perspective(VerticalFieldOfView, Aspect, Near, Far)
{
    const Focal = 1.0 / Math.tan(VerticalFieldOfView * 0.5);
    return new Float32Array([
        Focal / Aspect, 0, 0, 0,
        0, Focal, 0, 0,
        0, 0, (Far + Near) / (Near - Far), -1,
        0, 0, (2 * Far * Near) / (Near - Far), 0
    ]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     ORBIT PROJECTION
//------------------------------------------------------------------------------------------------------------------------

export class OrbitProjection
{
    constructor()
    {
        this.Target      = [0.0, 0.0, 1.1];    // [m]
        this.Distance    = 7.4;                // [m]
        this.Azimuth     = -0.72;              // [rad]
        this.Elevation   = 0.30;               // [rad]
        this.FieldOfView = 50.0 * Math.PI / 180.0;
        this.NearPlane   = 0.05;               // [m]
        this.FarPlane    = 400.0;              // [m]
    }

    Orbit(DeltaX, DeltaY)
    {
        this.Azimuth   -= DeltaX * 0.0062;
        this.Elevation  = Math.max(-1.35, Math.min(1.45, this.Elevation + DeltaY * 0.0062));
    }

    Pan(DeltaX, DeltaY)
    {
        const { Right, Above } = this.QueryBasis();
        const Rate = this.Distance * 0.0016;
        for (let Axis = 0; Axis < 3; ++Axis)
            this.Target[Axis] += (-Right[Axis] * DeltaX + Above[Axis] * DeltaY) * Rate;
    }

    Dolly(Notches)
    {
        this.Distance = Math.max(0.45, Math.min(90.0, this.Distance * Math.exp(Notches * 0.0013)));
    }

    QueryEye()
    {
        const Horizontal = Math.cos(this.Elevation) * this.Distance;
        return [
            this.Target[0] + Math.cos(this.Azimuth) * Horizontal,
            this.Target[1] + Math.sin(this.Azimuth) * Horizontal,
            this.Target[2] + Math.sin(this.Elevation) * this.Distance
        ];
    }

    QueryBasis()
    {
        const Eye = this.QueryEye();
        let Forward = [this.Target[0] - Eye[0], this.Target[1] - Eye[1], this.Target[2] - Eye[2]];
        const Length = Math.hypot(...Forward) || 1.0;
        Forward = Forward.map((Component) => Component / Length);

        let Right = [Forward[1], -Forward[0], 0.0];
        const RightLength = Math.hypot(...Right) || 1.0;
        Right = Right.map((Component) => Component / RightLength);

        const Above = [
            Right[1] * Forward[2] - Right[2] * Forward[1],
            Right[2] * Forward[0] - Right[0] * Forward[2],
            Right[0] * Forward[1] - Right[1] * Forward[0]
        ];
        return { Eye, Forward, Right, Above };
    }

    QueryViewProjection(Aspect)
    {
        const Eye  = this.QueryEye();
        const View = LookAt(Eye, this.Target, [0, 0, 1]);
        return MultiplyMatrix(Perspective(this.FieldOfView, Aspect, this.NearPlane, this.FarPlane), View);
    }

    // Screen point → world ray, used to drag the collider across a plane.
    QueryRay(PointerX, PointerY, Width, Height, Aspect)
    {
        const Inverse = InvertMatrix(this.QueryViewProjection(Aspect));
        const NdcX =  (PointerX / Width)  * 2.0 - 1.0;
        const NdcY = -((PointerY / Height) * 2.0 - 1.0);

        const Unproject = (Depth) =>
        {
            const X = Inverse[0]*NdcX + Inverse[4]*NdcY + Inverse[8]*Depth  + Inverse[12];
            const Y = Inverse[1]*NdcX + Inverse[5]*NdcY + Inverse[9]*Depth  + Inverse[13];
            const Z = Inverse[2]*NdcX + Inverse[6]*NdcY + Inverse[10]*Depth + Inverse[14];
            const W = Inverse[3]*NdcX + Inverse[7]*NdcY + Inverse[11]*Depth + Inverse[15];
            return [X / W, Y / W, Z / W];
        };

        const Near = Unproject(-1.0);
        const Far  = Unproject(1.0);
        let Direction = [Far[0] - Near[0], Far[1] - Near[1], Far[2] - Near[2]];
        const Length = Math.hypot(...Direction) || 1.0;
        Direction = Direction.map((Component) => Component / Length);

        return { Origin: this.QueryEye(), Direction };
    }
}
