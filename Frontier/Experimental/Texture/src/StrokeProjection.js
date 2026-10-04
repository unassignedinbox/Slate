//============================================================================================================================================
// 🖌 StrokeProjection.js — tools, brush configuration, stroke segmentation and decal placement frames
//============================================================================================================================================
// The brush is defined in world units, not in texels: a 2 cm brush stays 2 cm wide wherever the texel density changes, and
// a stroke that crosses a UV seam carries straight over it because the stamp is evaluated against the baked surface. This
// module turns pointer events into the segments the stamp pass consumes, and clicks into decal placement frames.
//============================================================================================================================================

export const ToolOrdering = [
    { Identifier: "orbit", Label: "Orbit", Glyph: "orbit", Hint: "Orbit, pan and zoom the surface · 1" },
    { Identifier: "brush", Label: "Brush", Glyph: "brush", Hint: "Paint coverage into the selected layer · 2" },
    { Identifier: "eraser", Label: "Eraser", Glyph: "eraser", Hint: "Remove coverage from the selected layer · 3" },
    { Identifier: "fill", Label: "Flood", Glyph: "fill", Hint: "Flood the layer or its mask · 4" },
    { Identifier: "decal", Label: "Place decal", Glyph: "decal", Hint: "Drop the selected decal onto the surface · 5" },
    { Identifier: "picker", Label: "Pick", Glyph: "picker", Hint: "Sample the composited channels · 6" },
];

export const BrushDefaults = {
    Radius: 0.09,        // [m]   world-space brush radius
    Hardness: 0.45,      // [-]   0 soft, 1 hard-edged
    Flow: 0.85,          // [-]   coverage written per stroke segment
    Spacing: 0.22,       // [-]   fraction of the radius between stamps
    Facing: 72,          // [°]   stop painting past this angle from the surface normal under the cursor
    Jitter: 0,           // [-]   per-texel alpha noise
    Symmetry: "none",    // none | x | y | z
    Target: "coverage",  // coverage | mask
};

export const SymmetryOrdering = [
    { Identifier: "none", Label: "Off" },
    { Identifier: "x", Label: "Mirror X" },
    { Identifier: "y", Label: "Mirror Y" },
    { Identifier: "z", Label: "Mirror Z" },
];

const MirrorAxis = { x: 0, y: 1, z: 2 };

export const MirrorVector = (Vector, Axis) =>
{
    const Index = MirrorAxis[Axis];
    if (Index === undefined) return null;
    const Mirrored = [...Vector];
    Mirrored[Index] = -Mirrored[Index];
    return Mirrored;
};

const Dot = (Left, Right) => Left[0] * Right[0] + Left[1] * Right[1] + Left[2] * Right[2];

const Cross = (Left, Right) => [
    Left[1] * Right[2] - Left[2] * Right[1],
    Left[2] * Right[0] - Left[0] * Right[2],
    Left[0] * Right[1] - Left[1] * Right[0],
];

const Turn = (Vector, Axis, Angle) =>
{
    const Cosine = Math.cos(Angle);
    const Sine = Math.sin(Angle);
    const Along = Dot(Vector, Axis);
    const Sideways = Cross(Axis, Vector);
    return [0, 1, 2].map((Index) => Vector[Index] * Cosine + Sideways[Index] * Sine + Axis[Index] * Along * (1 - Cosine));
};

// How far inside a placement's footprint a point on the surface falls: 0 at its centre, 1 at its edge, null outside it.
// The frame is the one the compositor uses, so what reads as inside here is exactly what is drawn there.
export const MarkReach = (Mark, Position) =>
{
    const Transform = Mark.Transform;
    const Normal = Transform.Normal;
    const Edge = Turn(Transform.Tangent, Normal, (Transform.Rotation * Math.PI) / 180);
    const Across = Cross(Normal, Edge);
    const Delta = [Position[0] - Transform.Position[0], Position[1] - Transform.Position[1], Position[2] - Transform.Position[2]];
    if (Math.abs(Dot(Delta, Normal)) > Math.max(Transform.Depth, 0.001)) return null;
    const Along = Dot(Delta, Edge) / Math.max(Transform.Size, 0.001);
    const Sideways = (Dot(Delta, Across) * Math.max(Transform.Aspect, 0.05)) / Math.max(Transform.Size, 0.001);
    const Reach = Math.max(Math.abs(Along), Math.abs(Sideways)) * 2;
    return Reach <= 1 ? Reach : null;
};

// The placement a click takes hold of: the smallest one under the point, so a decal sitting on another can still be had.
export const MarkUnderPoint = (Marks, Position) =>
{
    let Taken = null;
    let Tightest = Infinity;
    for (const Mark of Marks || [])
    {
        if (Mark.Visible === false || Mark.Placed === false) continue;
        const Reach = MarkReach(Mark, Position);
        if (Reach === null) continue;
        const Span = Mark.Transform.Size * Mark.Transform.Size;
        if (Span < Tightest)
        {
            Tightest = Span;
            Taken = Mark;
        }
    }
    return Taken;
};

export class StrokeProjection
{
    constructor()
    {
        this.Brush = { ...BrushDefaults };
        this.Tool = "brush";
        this.Active = false;
        this.Previous = null;
        this.PreviousPlane = null;
        this.Travelled = 0;
        this.Segments = 0;
    }

    Configure(Patch)
    {
        Object.assign(this.Brush, Patch);
    }

    // Screen → surface. `Device` is a normalised device coordinate pair in [-1, 1].
    Resolve(Index, Camera, DeviceX, DeviceY)
    {
        if (!Index) return null;
        const { Origin, Direction } = Camera.Ray(DeviceX, DeviceY);
        return Index.Raycast(Origin, Direction);
    }

    Begin(Hit)
    {
        this.Active = true;
        this.Previous = Hit;
        this.Travelled = 0;
        this.Segments = 0;
        return this.Describe(Hit, Hit);
    }

    // Returns a segment when the pointer has travelled far enough, otherwise null.
    Extend(Hit)
    {
        if (!this.Active || !this.Previous) return null;
        const Distance = Math.hypot(
            Hit.Position[0] - this.Previous.Position[0],
            Hit.Position[1] - this.Previous.Position[1],
            Hit.Position[2] - this.Previous.Position[2],
        );
        if (Distance < this.Brush.Radius * this.Brush.Spacing * 0.5) return null;
        const Segment = this.Describe(this.Previous, Hit);
        this.Travelled += Distance;
        this.Segments += 1;
        this.Previous = Hit;
        return Segment;
    }

    End()
    {
        this.Active = false;
        this.Previous = null;
        this.PreviousPlane = null;
    }

    Describe(From, To)
    {
        const Normal = [0, 1, 2].map((Axis) => (From.Normal[Axis] + To.Normal[Axis]) / 2);
        const Length = Math.hypot(...Normal) || 1;
        return {
            Start: From.Position,
            End: To.Position,
            Normal: Normal.map((Component) => Component / Length),
        };
    }

    // Texture-space painting for the flattened view. Radius is expressed as a fraction of the texture.
    BeginPlane(Coordinate)
    {
        this.Active = true;
        this.PreviousPlane = Coordinate;
        return { StartPlane: Coordinate, EndPlane: Coordinate };
    }

    ExtendPlane(Coordinate, PlaneRadius)
    {
        if (!this.Active || !this.PreviousPlane) return null;
        const Distance = Math.hypot(Coordinate[0] - this.PreviousPlane[0], Coordinate[1] - this.PreviousPlane[1]);
        if (Distance < PlaneRadius * this.Brush.Spacing * 0.5) return null;
        const Segment = { StartPlane: this.PreviousPlane, EndPlane: Coordinate };
        this.PreviousPlane = Coordinate;
        return Segment;
    }

    get FacingLimit()
    {
        return Math.cos((this.Brush.Facing * Math.PI) / 180);
    }

    // Placement frame for a decal: the hit point, its normal, and a tangent that follows the surface UV direction.
    static PlacementFrame(Hit)
    {
        const Normal = Hit.Normal;
        let Tangent = Hit.Tangent;
        const Alignment = Tangent[0] * Normal[0] + Tangent[1] * Normal[1] + Tangent[2] * Normal[2];
        Tangent = Tangent.map((Component, Index) => Component - Normal[Index] * Alignment);
        const Length = Math.hypot(...Tangent);
        if (Length < 1e-5)
        {
            const Reference = Math.abs(Normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
            Tangent = [
                Reference[1] * Normal[2] - Reference[2] * Normal[1],
                Reference[2] * Normal[0] - Reference[0] * Normal[2],
                Reference[0] * Normal[1] - Reference[1] * Normal[0],
            ];
        }
        const Scale = Math.hypot(...Tangent) || 1;
        return {
            Position: [...Hit.Position],
            Normal: [...Normal],
            Tangent: Tangent.map((Component) => Component / Scale),
        };
    }
}
