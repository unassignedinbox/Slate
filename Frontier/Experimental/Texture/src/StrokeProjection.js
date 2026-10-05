//============================================================================================================================================
// 🖌 StrokeProjection.js — tools, brush configuration, stroke segmentation and decal placement frames
//============================================================================================================================================
// The brush is defined in world units, not in texels: a 2 cm brush stays 2 cm wide wherever the texel density changes, and
// a stroke that crosses a UV seam carries straight over it because the stamp is evaluated against the baked surface. This
// module turns pointer events into the segments the stamp pass consumes, and clicks into decal placement frames.
//============================================================================================================================================

import { PlainMedia, MediaWidth } from "./MediaSolver.js";

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
    Smoothing: 0,        // [-]   how far the mark lags the pointer
    Symmetry: "none",    // none | x | y | z | radial
    Sectors: 6,          // [-]   how many times a radial stroke repeats around the up axis
    Target: "coverage",  // coverage | mask
    Media: PlainMedia,   // [-]   the medium in hand: what the mark is made of
};

export const SymmetryOrdering = [
    { Identifier: "none", Label: "Off" },
    { Identifier: "x", Label: "Mirror X" },
    { Identifier: "y", Label: "Mirror Y" },
    { Identifier: "z", Label: "Mirror Z" },
    { Identifier: "radial", Label: "Radial" },
];

// Radial symmetry turns around the standing axis: a hub cap, a shield boss and a compass rose are all drawn this way.
export const RadialAxis = [0, 1, 0];
export const SectorLimits = { Minimum: 2, Maximum: 16 };

// What the hand on the pointer is asking for. One rule, read by both the press and the drag: the left button is the
// only one that ever puts paint down, every other button drives the camera, and the camera orbits unless something
// asks it to slide — the middle button, Shift, or Space. The orbit tool moves the left button over to the camera too.
export const PointerIntent = ({ Button = 0, Tool = "brush", Space = false, Shift = false } = {}) =>
{
    const Navigate = Button !== 0 || Tool === "orbit" || !!Space;
    const Pan = Navigate && (Button === 1 || !!Space || !!Shift);
    return { Navigate, Paint: !Navigate, Pan, Orbit: Navigate && !Pan };
};

const MirrorAxis = { x: 0, y: 1, z: 2 };

export const MirrorVector = (Vector, Axis) =>
{
    const Index = MirrorAxis[Axis];
    if (Index === undefined) return null;
    const Mirrored = [...Vector];
    Mirrored[Index] = -Mirrored[Index];
    return Mirrored;
};

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Value));

const Dot = (Left, Right) => Left[0] * Right[0] + Left[1] * Right[1] + Left[2] * Right[2];

const Cross = (Left, Right) => [
    Left[1] * Right[2] - Left[2] * Right[1],
    Left[2] * Right[0] - Left[0] * Right[2],
    Left[0] * Right[1] - Left[1] * Right[0],
];

// A direction with the part that points along the normal taken out of it, or nothing when there was no other part.
const Flatten = (Vector, Normal) =>
{
    const Alignment = Dot(Vector, Normal);
    const Flat = Vector.map((Component, Index) => Component - Normal[Index] * Alignment);
    const Length = Math.hypot(...Flat);
    return Length < 1e-4 ? null : Flat.map((Component) => Component / Length);
};

const Turn = (Vector, Axis, Angle) =>
{
    const Cosine = Math.cos(Angle);
    const Sine = Math.sin(Angle);
    const Along = Dot(Vector, Axis);
    const Sideways = Cross(Axis, Vector);
    return [0, 1, 2].map((Index) => Vector[Index] * Cosine + Sideways[Index] * Sine + Axis[Index] * Along * (1 - Cosine));
};

// Every twin a stroke has under the symmetry in force, as functions from a vector to its copy. Mirroring gives one
// twin, radial gives one per sector less the original; `none` gives an empty list and the paint path simply stamps once.
export const SymmetryTwins = (Symmetry, Sectors = BrushDefaults.Sectors) =>
{
    if (Symmetry === "radial")
    {
        const Count = Math.round(Math.max(SectorLimits.Minimum, Math.min(SectorLimits.Maximum, Sectors || BrushDefaults.Sectors)));
        return Array.from({ length: Count - 1 }, (Ignored, Index) =>
        {
            const Angle = (2 * Math.PI * (Index + 1)) / Count;
            return (Vector) => (Vector ? Turn(Vector, RadialAxis, Angle) : null);
        });
    }
    if (MirrorAxis[Symmetry] === undefined) return [];
    return [(Vector) => MirrorVector(Vector, Symmetry)];
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
    // 📝 The edge belongs to the mark. A corner worked out by MarkCorners lands on exactly 1 in real arithmetic and a
    //    hair over it in floating point, so without this the outline the gizmo draws and the region a click can take
    //    hold of disagree along every edge.
    return Reach <= 1 + 1e-9 ? Reach : null;
};

//--------------------------------------------------------------------------------------------------------------------------
// The frame a placement is held by.
//
// A decal on a surface is a rectangle lying in the plane the click found: a centre, a normal, and a tangent turned by
// the mark's own rotation. Everything the handles do is a change to that rectangle, so the corners are worked out in
// the WORLD and only then projected — which keeps the gizmo honest on a curved panel, where the four corners are not
// coplanar with what the eye reads as the decal.
//
// 📝 The order is the one a rectangle is usually walked in — bottom left, bottom right, top right, top left — because
//    the handles are named by it and an outline drawn in any other order crosses itself.
//--------------------------------------------------------------------------------------------------------------------------
export const MarkBasis = (Mark) =>
{
    const Transform = Mark.Transform;
    const Normal = Transform.Normal;
    const Along = Turn(Transform.Tangent, Normal, (Transform.Rotation * Math.PI) / 180);
    return {
        Centre: [...Transform.Position],
        Normal: [...Normal],
        Along,
        Across: Cross(Normal, Along),
        Half: [Math.max(Transform.Size, 1e-4) / 2, Math.max(Transform.Size, 1e-4) / Math.max(Transform.Aspect, 0.05) / 2],
    };
};

export const MarkCorners = (Mark) =>
{
    const { Centre, Along, Across, Half } = MarkBasis(Mark);
    const At = (Side, Up) =>
        Centre.map((Component, Index) => Component + Along[Index] * Side * Half[0] + Across[Index] * Up * Half[1]);
    return [At(-1, -1), At(1, -1), At(1, 1), At(-1, 1)];
};

// The handle that turns the mark sits off the top edge by a share of the height, so it never lands under the corners
// however thin the decal is squashed.
export const MarkSpindle = (Mark) =>
{
    const { Centre, Across, Half } = MarkBasis(Mark);
    const Reach = Half[1] + Math.max(Half[0], Half[1]) * 0.42;
    return Centre.map((Component, Index) => Component + Across[Index] * Reach);
};

// What a corner drag does. Both measurements are screen distances from the centre, so the mark follows the hand at
// whatever angle the panel is being seen from. Plain is a uniform scale; `Stretch` is the shift key, and it widens
// the mark without touching its height — size and aspect move together, which is what leaves the other axis alone.
export const ResizeMark = (Size, Aspect, Grabbed, Reached, Stretch) =>
{
    const Ratio = Clamp(Math.max(Reached, 1e-4) / Math.max(Grabbed, 1e-4), 0.01, 100);
    return {
        Size: Clamp(Size * Ratio, 0.02, 2.4),
        Aspect: Clamp(Stretch ? Aspect * Ratio : Aspect, 0.2, 5),
    };
};

// What the spindle does. The sign comes from the frame as the eye sees it: a decal on the far side of the model has a
// basis that reads mirrored on screen, and without the flip it would turn the wrong way under the hand.
export const SpinMark = (Rotation, FromAngle, ToAngle, Flip, Snap) =>
{
    const Delta = ((ToAngle - FromAngle) * 180) / Math.PI;
    let Turned = Rotation + (Flip ? -Delta : Delta);
    if (Snap) Turned = Math.round(Turned / 15) * 15;
    return ((Turned % 360) + 360) % 360;
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
        this.Raw = null;
        this.PreviousPlane = null;
        this.Travelled = 0;      // [m or uv] along the stroke, in whatever the view is measuring in
        this.Reached = 0;        // [m]       the same walk in metres, which is what the entry taper is written in
        this.Segments = 0;
        this.Press = 1;
        this.Moment = 0;
        // 🔴 The way the last segment ran, carried into the next one. Each dab keeps only the ground between its own
        //    ends, so the wedge on the outside of a turn would belong to nobody; knowing where the stroke came from
        //    is what lets the dab recognise the ground its predecessor could not reach and take that as well.
        this.Heading = [0, 0, 0, 0];
    }

    Configure(Patch)
    {
        Object.assign(this.Brush, Patch);
        if (Patch.Media) this.Brush.Media = Patch.Media;
        if (Patch.Sectors !== undefined)
            this.Brush.Sectors = Math.round(
                Math.max(SectorLimits.Minimum, Math.min(SectorLimits.Maximum, Number(Patch.Sectors) || BrushDefaults.Sectors)),
            );
    }

    // The twins the brush in hand will paint alongside the stroke itself.
    get Twins()
    {
        return SymmetryTwins(this.Brush.Symmetry, this.Brush.Sectors);
    }

    // Screen → surface. `Device` is a normalised device coordinate pair in [-1, 1].
    Resolve(Index, Camera, DeviceX, DeviceY)
    {
        if (!Index) return null;
        const { Origin, Direction } = Camera.Ray(DeviceX, DeviceY);
        return Index.Raycast(Origin, Direction);
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Pressure.
    //
    // A stylus reports its own and is believed. A mouse reports 0.5 and means nothing by it, so the hand's own speed
    // stands in: a flicked stroke is a light stroke, which is true of every instrument in the card and is the one cue a
    // mouse can actually give. On top of either comes the entry ramp — no brush, pencil or nib lands at full weight,
    // and a stroke that starts at its full width is the single clearest tell that a mark was not drawn by hand.
    //
    // 🔴 Only the ENTRY is tapered, never the exit. The exit cannot be tapered live without knowing where the stroke is
    //    about to stop, and re-stamping the tail after the fact would mean the paint changing under a finished stroke.
    //----------------------------------------------------------------------------------------------------------------------
    ReadPressure(Reading, Distance, Elapsed)
    {
        const Media = this.Brush.Media || PlainMedia;
        if (!Media.Pressure) return 1;

        const Stylus = Reading && Reading.Pen && Reading.Pressure > 0 ? Clamp(Reading.Pressure, 0.02, 1) : null;
        let Target = Stylus;
        if (Target === null)
        {
            const Speed = Elapsed > 0 ? Distance / Elapsed : 0;
            const Flick = Clamp(Speed / Math.max(this.Brush.Radius * 14, 1e-5), 0, 1);
            Target = 1 - 0.55 * Flick * (0.35 + 0.65 * Media.Taper);
        }

        const Length = Math.max(this.Brush.Radius * (0.5 + 7 * Media.Taper), 1e-5);
        const Entry = Clamp(this.Reached / Length, 0, 1);
        Target *= 1 - Media.Taper * (1 - Entry) * 0.88;

        // One pole, so pressure can never step: a jump in width reads as a seam in the stroke.
        this.Press += (Clamp(Target, 0.02, 1) - this.Press) * 0.45;
        return Clamp(this.Press, 0.02, 1);
    }

    // Where the stroke is pointing, as an angle in the surface's own frame. A nib is held at a fixed angle to the
    // surface, so this is the whole of what makes a chisel draw thick one way and thin the other.
    SurfaceTurn(Direction, Normal)
    {
        const Length = Math.hypot(...Direction);
        if (Length < 1e-9) return 0;
        const Ahead = Direction.map((Component) => Component / Length);
        const Guide = Math.abs(Normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const Reference = Cross(Normal, Guide);
        const Scale = Math.hypot(...Reference) || 1;
        const Edge = Reference.map((Component) => Component / Scale);
        const Side = Cross(Normal, Edge);
        return Math.atan2(Dot(Ahead, Side), Dot(Ahead, Edge));
    }

    Begin(Hit, Reading)
    {
        this.Active = true;
        this.Previous = Hit;
        this.Raw = Hit;
        this.Travelled = 0;
        this.Reached = 0;
        this.Segments = 0;
        this.Heading = [0, 0, 0, 0];
        this.Moment = Reading?.Time ?? 0;
        // A stroke starts at the weight the taper allows and climbs from there.
        const Media = this.Brush.Media || PlainMedia;
        this.Press = Media.Pressure ? Clamp(1 - Media.Taper * 0.88, 0.02, 1) : 1;
        const Press = this.ReadPressure(Reading, 0, 0);
        return this.Describe(Hit, Hit, [Press, Press], [0, 0]);
    }

    // Returns a segment when the pointer has travelled far enough, otherwise null.
    Extend(Hit, Reading)
    {
        if (!this.Active || !this.Previous) return null;

        // Smoothing is a lag, not a resample: the mark follows the pointer on a spring, which is how a steady line
        // gets drawn with an unsteady hand. The raw hit is still kept, because speed has to be measured on the hand.
        const Pull = 1 - Clamp(this.Brush.Smoothing || 0, 0, 1) * 0.82;
        const Drawn = {
            ...Hit,
            Position: [0, 1, 2].map((Axis) => this.Previous.Position[Axis] + (Hit.Position[Axis] - this.Previous.Position[Axis]) * Pull),
        };

        const Distance = Math.hypot(
            Drawn.Position[0] - this.Previous.Position[0],
            Drawn.Position[1] - this.Previous.Position[1],
            Drawn.Position[2] - this.Previous.Position[2],
        );
        if (Distance < this.Brush.Radius * this.Brush.Spacing * 0.5) return null;

        const Raw = Math.hypot(
            Hit.Position[0] - (this.Raw?.Position[0] ?? Hit.Position[0]),
            Hit.Position[1] - (this.Raw?.Position[1] ?? Hit.Position[1]),
            Hit.Position[2] - (this.Raw?.Position[2] ?? Hit.Position[2]),
        );
        const Elapsed = Reading?.Time !== undefined && this.Moment ? Math.max((Reading.Time - this.Moment) / 1000, 1e-4) : 0.016;
        const Before = this.Press;
        const After = this.ReadPressure(Reading, Raw, Elapsed);

        const Segment = this.Describe(this.Previous, Drawn, [Before, After], [this.Travelled, this.Travelled + Distance]);
        this.Travelled += Distance;
        this.Reached += Distance;
        this.Segments += 1;
        this.Previous = Drawn;
        this.Raw = Hit;
        this.Moment = Reading?.Time ?? this.Moment;
        return Segment;
    }

    End()
    {
        this.Active = false;
        this.Heading = [0, 0, 0, 0];
        this.Previous = null;
        this.Raw = null;
        this.PreviousPlane = null;
        this.Travelled = 0;
        this.Reached = 0;
        this.Press = 1;
    }

    Describe(From, To, Press = [1, 1], Travel = [0, 0])
    {
        const Normal = [0, 1, 2].map((Axis) => (From.Normal[Axis] + To.Normal[Axis]) / 2);
        const Length = Math.hypot(...Normal) || 1;
        const Facing = Normal.map((Component) => Component / Length);
        const Direction = [0, 1, 2].map((Axis) => To.Position[Axis] - From.Position[Axis]);
        const Before = this.Heading;
        const Walk = Math.hypot(...Direction);
        if (Walk > 1e-9) this.Heading = [...Direction.map((Component) => Component / Walk), 1];
        return {
            Start: From.Position,
            End: To.Position,
            Normal: Facing,
            Press,
            Travel,
            Before,
            // A round head answers 1 whichever way it is dragged; a chisel answers its waist.
            Width: MediaWidth(this.Brush.Media, this.SurfaceTurn(Direction, Facing)),
        };
    }

    // Texture-space painting for the flattened view. Radius is expressed as a fraction of the texture.
    BeginPlane(Coordinate, Reading)
    {
        this.Active = true;
        this.PreviousPlane = Coordinate;
        this.Travelled = 0;
        this.Reached = 0;
        this.Segments = 0;
        this.Moment = Reading?.Time ?? 0;
        const Media = this.Brush.Media || PlainMedia;
        this.Press = Media.Pressure ? Clamp(1 - Media.Taper * 0.88, 0.02, 1) : 1;
        const Press = this.ReadPressure(Reading, 0, 0);
        this.Heading = [0, 0, 0, 0];
        return { StartPlane: Coordinate, EndPlane: Coordinate, Press: [Press, Press], Travel: [0, 0], Before: [0, 0, 0, 0], Width: 1 };
    }

    ExtendPlane(Coordinate, PlaneRadius, Reading)
    {
        if (!this.Active || !this.PreviousPlane) return null;
        const Pull = 1 - Clamp(this.Brush.Smoothing || 0, 0, 1) * 0.82;
        const Drawn = [0, 1].map((Axis) => this.PreviousPlane[Axis] + (Coordinate[Axis] - this.PreviousPlane[Axis]) * Pull);
        const Distance = Math.hypot(Drawn[0] - this.PreviousPlane[0], Drawn[1] - this.PreviousPlane[1]);
        if (Distance < PlaneRadius * this.Brush.Spacing * 0.5) return null;

        const Elapsed = Reading?.Time !== undefined && this.Moment ? Math.max((Reading.Time - this.Moment) / 1000, 1e-4) : 0.016;
        const Before = this.Press;
        // The plane measures in UV; pressure wants metres, so the travel is scaled by the brush's own two expressions
        // of its size — the ratio between them is the number of metres a UV unit is worth under this stroke.
        const Scale = PlaneRadius > 1e-6 ? this.Brush.Radius / PlaneRadius : 1;
        const After = this.ReadPressure(Reading, Distance * Scale, Elapsed);
        const Run = [Drawn[0] - this.PreviousPlane[0], Drawn[1] - this.PreviousPlane[1]];
        const Segment = {
            StartPlane: this.PreviousPlane,
            EndPlane: Drawn,
            Press: [Before, After],
            Travel: [this.Travelled, this.Travelled + Distance],
            Before: this.Heading,
            Width: MediaWidth(this.Brush.Media, Math.atan2(Run[1], Run[0])),
        };
        if (Distance > 1e-9) this.Heading = [Run[0] / Distance, Run[1] / Distance, 0, 1];
        this.Travelled += Distance;
        this.Reached += Distance * Scale;
        this.Segments += 1;
        this.PreviousPlane = Drawn;
        this.Moment = Reading?.Time ?? this.Moment;
        return Segment;
    }

    get FacingLimit()
    {
        return Math.cos((this.Brush.Facing * Math.PI) / 180);
    }

    // Placement frame for a decal: the hit point, its normal, and a tangent that follows the surface UV direction.
    // 🔴 The frame's UP is the viewer's up laid flat on the surface, NOT the surface's own V direction. A sign is read
    //    off the screen, so artwork dropped at rotation zero has to stand upright on the screen wherever it lands; a
    //    body of revolution indexed by 1 - V would otherwise hand back a frame that is upside down over half the model,
    //    and the painter would meet a decal that needs turning 180° before it can be read. When the surface faces
    //    straight at the viewer's up — the floor seen from above, the ceiling from below — up gives nothing to lay flat,
    //    and the direction being looked along takes over.
    static PlacementFrame(Hit, Reference = null)
    {
        const Normal = Hit.Normal;
        let Upright = null;
        if (Reference && Reference.Up) Upright = Flatten(Reference.Up, Normal);
        if (!Upright && Reference && Reference.Forward)
        {
            const Facing = Dot(Reference.Up || [0, 1, 0], Normal) >= 0 ? 1 : -1;
            Upright = Flatten(Reference.Forward.map((Component) => Component * Facing), Normal);
        }
        let Tangent = Upright ? Cross(Upright, Normal) : Hit.Tangent;
        if (!Upright)
        {
            const Alignment = Dot(Tangent, Normal);
            Tangent = Tangent.map((Component, Index) => Component - Normal[Index] * Alignment);
        }
        const Length = Math.hypot(...Tangent);
        if (Length < 1e-5)
        {
            const Fallback = Math.abs(Normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
            Tangent = Cross(Fallback, Normal);
        }
        const Scale = Math.hypot(...Tangent) || 1;
        return {
            Position: [...Hit.Position],
            Normal: [...Normal],
            Tangent: Tangent.map((Component) => Component / Scale),
            // Where the click landed on the sheet, so the timeline can draw the placement in texture space.
            Coordinate: Hit.Coordinate ? [...Hit.Coordinate] : null,
        };
    }
}
