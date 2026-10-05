//============================================================================================================================================
// ✏️ StrokeSpecification.js — how a stroke is laid down: freehand, a straight line or a gradient, and the curves it answers to
//============================================================================================================================================
// Three ways to put the same instrument on the surface. Freehand is the hand: every move extends the stroke. A line is
// two points — press, aim, release — walked in screen space afterwards so it wraps round the model instead of cutting
// through it. A gradient is two points as well, but it is not a stroke at all: it covers the whole sheet in one pass
// and fades along the axis between them.
//
// The curves are the other half. A pen reports pressure, a mouse reports the speed of the hand, and neither of them is
// what the paint should do with it — that is a judgement, and an editable one. Two curves per instrument: pressure to
// size and pressure to flow. Both are monotone cubic through their own points, so dragging one point cannot make the
// curve bulge somewhere else, which is the single thing that makes a curve widget feel untrustworthy.
//
// Nothing here draws or renders. The panel owns the widget, the integrator owns the pass; this file owns the vocabulary
// and the arithmetic, which is what the tests can hold on to.
//============================================================================================================================================

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Value));

//--------------------------------------------------------------------------------------------------------------------------
// What the hand is doing.
//--------------------------------------------------------------------------------------------------------------------------

export const StrokeModes = [
    { Identifier: "freehand", Label: "Freehand", Note: "Paint follows the hand", Glyph: "brush" },
    { Identifier: "line", Label: "Line", Note: "Press, aim, release", Glyph: "vector" },
    { Identifier: "gradient", Label: "Gradient", Note: "Fades along the drag", Glyph: "height" },
];

export const StrokeModeIdentifiers = StrokeModes.map((Mode) => Mode.Identifier);

export const GradientShapes = [
    { Identifier: "linear", Label: "Linear", Note: "Fades along the axis" },
    { Identifier: "radial", Label: "Radial", Note: "Fades out of the first point" },
];

// How the fade runs between the two ends. These are the same four everyone expects, by the names they are expected by.
export const GradientEasings = [
    { Identifier: "linear", Label: "Even" },
    { Identifier: "smooth", Label: "Smooth" },
    { Identifier: "in", Label: "Ease in" },
    { Identifier: "out", Label: "Ease out" },
];

export const GradientDefaults = {
    Shape: "linear",
    Easing: "smooth",
    Reverse: false,
    // A gradient dragged across a model usually means the side you are looking at. `Through` lets it wrap all the way
    // round instead, which is what you want for a ground-up dirt pass and never what you want for a logo fade.
    Through: false,
    Softness: 0.5,
};

// A straight line can be held to an angle. The snap is in degrees; zero is free.
export const LineSnaps = [0, 15, 45, 90];

// Where a straight line's samples land, in screen pixels: dense enough that the dabs overlap at any brush size, capped
// so that a line dragged across a 4K viewport cannot ask for ten thousand raycasts.
export const LineSampleLimit = 420;

export const LineSamples = (From, To, Step = 4) =>
{
    const Span = Math.hypot(To[0] - From[0], To[1] - From[1]);
    const Count = Clamp(Math.ceil(Span / Math.max(1, Step)), 1, LineSampleLimit);
    const Points = [];
    for (let Index = 0; Index <= Count; Index += 1)
    {
        const Fraction = Index / Count;
        Points.push([From[0] + (To[0] - From[0]) * Fraction, From[1] + (To[1] - From[1]) * Fraction]);
    }
    return Points;
};

// Hold a line to the nearest allowed angle. Snapping the ANGLE rather than the end point keeps the length the hand
// asked for, which is what every other editor does and what the hand expects.
export const SnapLine = (From, To, Degrees = 0) =>
{
    if (!Degrees) return To;
    const Delta = [To[0] - From[0], To[1] - From[1]];
    const Span = Math.hypot(Delta[0], Delta[1]);
    if (Span < 1e-6) return To;
    const Step = (Degrees * Math.PI) / 180;
    const Angle = Math.round(Math.atan2(Delta[1], Delta[0]) / Step) * Step;
    return [From[0] + Math.cos(Angle) * Span, From[1] + Math.sin(Angle) * Span];
};

//--------------------------------------------------------------------------------------------------------------------------
// Curves.
//
// A curve is a short list of [x, y] points, both in 0…1, with an x = 0 point and an x = 1 point that cannot be removed.
// Evaluation is monotone cubic Hermite — Fritsch–Carlson tangents — because the alternative, a plain Catmull-Rom, will
// happily overshoot above 1 between two points the user placed below it.
//--------------------------------------------------------------------------------------------------------------------------

export const CurveLimit = 8;

export const CurvePresets = [
    { Identifier: "linear", Label: "Even", Points: [[0, 0], [1, 1]] },
    { Identifier: "soft", Label: "Soft", Points: [[0, 0], [0.5, 0.26], [1, 1]] },
    { Identifier: "hard", Label: "Hard", Points: [[0, 0], [0.5, 0.74], [1, 1]] },
    { Identifier: "ess", Label: "S", Points: [[0, 0], [0.3, 0.12], [0.7, 0.88], [1, 1]] },
    { Identifier: "steady", Label: "Steady", Points: [[0, 1], [1, 1]] },
];

export const CurvePresetByIdentifier = Object.fromEntries(CurvePresets.map((Entry) => [Entry.Identifier, Entry]));

export const DefaultCurve = (Identifier = "linear") =>
    (CurvePresetByIdentifier[Identifier] || CurvePresets[0]).Points.map((Point) => [...Point]);

// Put a curve in order and inside its box. Points are sorted by x, the ends are pinned to 0 and 1, and two points that
// land on the same x are nudged apart — a vertical pair has no tangent and would divide by zero below.
export const SortCurve = (Points) =>
{
    const Kept = (Array.isArray(Points) ? Points : [])
        .filter((Point) => Array.isArray(Point) && Number.isFinite(Point[0]) && Number.isFinite(Point[1]))
        .map((Point) => [Clamp(Point[0], 0, 1), Clamp(Point[1], 0, 1)])
        .sort((First, Second) => First[0] - Second[0])
        .slice(0, CurveLimit);
    if (!Kept.length) return DefaultCurve();
    if (Kept[0][0] > 0) Kept.unshift([0, Kept[0][1]]);
    else Kept[0][0] = 0;
    if (Kept[Kept.length - 1][0] < 1) Kept.push([1, Kept[Kept.length - 1][1]]);
    else Kept[Kept.length - 1][0] = 1;
    for (let Index = 1; Index < Kept.length; Index += 1)
        if (Kept[Index][0] - Kept[Index - 1][0] < 1e-4) Kept[Index][0] = Math.min(1, Kept[Index - 1][0] + 1e-4);
    return Kept;
};

export const EvaluateCurve = (Points, X) =>
{
    const Curve = SortCurve(Points);
    const Where = Clamp(Number.isFinite(X) ? X : 0, 0, 1);
    if (Curve.length === 1) return Curve[0][1];
    let Index = 0;
    while (Index < Curve.length - 2 && Where > Curve[Index + 1][0]) Index += 1;
    const [FromX, FromY] = Curve[Index];
    const [ToX, ToY] = Curve[Index + 1];
    const Width = ToX - FromX;
    if (Width <= 1e-9) return ToY;

    // Fritsch–Carlson: every secant's slope, then tangents clipped so no span can turn back on itself.
    const Slope = (A, B) => (Curve[B][1] - Curve[A][1]) / Math.max(1e-9, Curve[B][0] - Curve[A][0]);
    const Here = Slope(Index, Index + 1);
    const Before = Index > 0 ? Slope(Index - 1, Index) : Here;
    const After = Index < Curve.length - 2 ? Slope(Index + 1, Index + 2) : Here;
    const Tangent = (Left, Right) => (Left * Right <= 0 ? 0 : (Left + Right) / 2);
    let Start = Tangent(Before, Here);
    let End = Tangent(Here, After);
    const Reach = 3 * Math.abs(Here);
    if (Math.abs(Start) > Reach) Start = Math.sign(Start) * Reach;
    if (Math.abs(End) > Reach) End = Math.sign(End) * Reach;

    const T = (Where - FromX) / Width;
    const TT = T * T;
    const TTT = TT * T;
    const Value =
        (2 * TTT - 3 * TT + 1) * FromY +
        (TTT - 2 * TT + T) * Width * Start +
        (-2 * TTT + 3 * TT) * ToY +
        (TTT - TT) * Width * End;
    return Clamp(Value, 0, 1);
};

export const CurveTable = (Points, Count = 32) =>
    Array.from({ length: Count }, (_, Index) => EvaluateCurve(Points, Index / (Count - 1)));

// Is this curve the one that does nothing? Worth knowing, because the card says so and the stroke can skip the work.
export const CurveIsPlain = (Points) =>
{
    const Curve = SortCurve(Points);
    return Curve.length === 2 && Math.abs(Curve[0][1]) < 1e-6 && Math.abs(Curve[1][1] - 1) < 1e-6;
};

export const PlaceCurvePoint = (Points, X, Y) =>
{
    const Curve = SortCurve(Points);
    if (Curve.length >= CurveLimit) return Curve;
    return SortCurve([...Curve, [Clamp(X, 0, 1), Clamp(Y, 0, 1)]]);
};

// The two ends stay. A curve that can lose its x = 0 point has no answer for a pressure of zero.
export const LiftCurvePoint = (Points, Index) =>
{
    const Curve = SortCurve(Points);
    if (Index <= 0 || Index >= Curve.length - 1) return Curve;
    return SortCurve(Curve.filter((_, Which) => Which !== Index));
};

export const DefaultCurves = () => ({ Size: DefaultCurve("linear"), Flow: DefaultCurve("linear") });

//--------------------------------------------------------------------------------------------------------------------------
// Which channels a stroke is allowed to write.
//
// The twelve painted scalars live four to an image, and an image is what the hardware can mask: the stamping pass draws
// once per image with the components it is allowed to touch switched on. Coverage is the odd one — its alpha is the
// layer's own presence, so a stroke that writes no colour must still write that alpha or the layer would never show the
// roughness it just painted.
//--------------------------------------------------------------------------------------------------------------------------

export const WriteSlots = [
    {
        Slot: "Coverage",
        Label: "Colour",
        Note: "Base colour and the layer's own cover",
        Components: [
            { Key: "base_color", Label: "Base colour", Spread: 3 },
            { Key: "coverage", Label: "Cover", Locked: true },
        ],
    },
    {
        Slot: "Surfacing",
        Label: "Surface",
        Note: "Roughness, metalness, occlusion, height",
        Components: [
            { Key: "specular_roughness", Label: "Roughness" },
            { Key: "base_metalness", Label: "Metalness" },
            { Key: "ambient_occlusion", Label: "Occlusion" },
            { Key: "height", Label: "Height" },
        ],
    },
    {
        Slot: "Coating",
        Label: "Coat",
        Note: "Specular, coat, coat roughness, fuzz",
        Components: [
            { Key: "specular_weight", Label: "Specular" },
            { Key: "coat_weight", Label: "Coat" },
            { Key: "coat_roughness", Label: "Coat rough" },
            { Key: "fuzz_weight", Label: "Fuzz" },
        ],
    },
    {
        Slot: "Radiance",
        Label: "Light",
        Note: "Emission and transmission",
        Components: [
            { Key: "emission_color", Label: "Emission", Spread: 3 },
            { Key: "transmission_weight", Label: "Transmission" },
        ],
    },
];

export const WriteKeys = WriteSlots.flatMap((Entry) => Entry.Components.filter((Part) => !Part.Locked).map((Part) => Part.Key));

export const DefaultWrites = () => Object.fromEntries(WriteKeys.map((Key) => [Key, true]));

// The per-image colour masks the stamping pass needs, in packing order: coverage first, then the three painted images.
// `Full` means every component is allowed, which is the single draw the pass has always made.
export const WriteOrdering = (Writes) =>
{
    const Allowed = { ...DefaultWrites(), ...(Writes || {}) };
    const Slots = WriteSlots.map((Entry, Index) =>
    {
        const Mask = [];
        for (const Part of Entry.Components)
        {
            const On = Part.Locked ? true : Allowed[Part.Key] !== false;
            for (let Spread = 0; Spread < (Part.Spread || 1); Spread += 1) Mask.push(On);
        }
        while (Mask.length < 4) Mask.push(false);
        return { Index, Slot: Entry.Slot, Mask: Mask.slice(0, 4) };
    });
    return { Full: Slots.every((Entry) => Entry.Mask.every(Boolean)), Slots };
};

export const WritesSummary = (Writes) =>
{
    const Allowed = { ...DefaultWrites(), ...(Writes || {}) };
    const On = WriteKeys.filter((Key) => Allowed[Key] !== false);
    if (On.length === WriteKeys.length) return "Every channel";
    if (!On.length) return "Cover only";
    return `${On.length} of ${WriteKeys.length} channels`;
};
