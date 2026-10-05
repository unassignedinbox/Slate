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

//--------------------------------------------------------------------------------------------------------------------------
// The ramp: the colours a gradient is made of.
//
// A gradient is a list of colours at places along a fade. Two of them to begin with and as many as eight, because past
// eight the strip is finer than the finger dragging it. The same ramp serves two different acts, which is the whole
// reason it is one record rather than two:
//
//   · the gradient TOOL lays it over the sheet in one pass, between the two points the hand dragged between;
//   · an ordinary STROKE carries it, and the colour a dab goes down in is read off the ramp by where that dab sits.
//
// Where a dab sits is the second question, and there are two honest answers to it. ALONG measures the distance the hand
// has actually travelled, so a stroke that doubles back burns through the ramp twice as fast as one that goes straight.
// ENDS measures where the dab is BETWEEN the two ends of the mark, so the ramp fits the stroke whatever path it took to
// get there. Neither is the right one; they are different instruments.
//--------------------------------------------------------------------------------------------------------------------------

// Eight is not a technical limit, it is a judgement: the shader carries a fixed array and the strip is 240 px wide, so
// a ninth stop would be a colour nobody could grab.
export const RampLimit = 8;

export const RampFits = [
    { Identifier: "along", Label: "Along", Note: "By how far the hand has travelled" },
    { Identifier: "ends", Label: "End to end", Note: "By where the dab falls between the two ends" },
];

export const RampFitIdentifiers = RampFits.map((Fit) => Fit.Identifier);

// Pale to near-black: the pair the gradient tool has always faded between, now stated as what it always was.
export const DefaultRampStops = () => [
    { Position: 0, Colour: [0.93, 0.94, 0.96] },
    { Position: 1, Colour: [0.09, 0.1, 0.12] },
];

export const GradientDefaults = {
    Shape: "linear",
    Easing: "smooth",
    Reverse: false,
    // A gradient dragged across a model usually means the side you are looking at. `Through` lets it wrap all the way
    // round instead, which is what you want for a ground-up dirt pass and never what you want for a logo fade.
    Through: false,
    Softness: 0.5,
    // A gradient normally fades the paint away to nothing, which is what makes it a wash. `Colours` runs it through the
    // ramp instead and lays full coverage the whole way, which is what makes it a fill.
    Colours: false,
    Stops: DefaultRampStops(),
    // Whether an ordinary stroke carries the ramp too, and how it finds its place in it.
    Carry: false,
    Fit: "along",
    Span: 0.6,   // [m] how far the ramp runs before it ends, when it is measured along the mark
    Scale: 1,    // [×] how much of the two ends the ramp covers, when it is fitted between them
    Cycle: false,
};

const SameColour = (Colour) => [0, 1, 2].map((Part) => Clamp(Number(Colour?.[Part]) || 0, 0, 1));

// Put a ramp in order and inside its bounds: positions clamped, stops sorted by where they sit, colours in 0…1, and
// never fewer than two — a gradient of one colour is a fill, and the tool that wants a fill is the fill tool.
export const SortRampStops = (Stops) =>
{
    const Kept = (Array.isArray(Stops) ? Stops : [])
        .filter((Stop) => Stop && Array.isArray(Stop.Colour) && Number.isFinite(Stop.Position))
        .map((Stop) => ({ Position: Clamp(Stop.Position, 0, 1), Colour: SameColour(Stop.Colour) }))
        .sort((Left, Right) => Left.Position - Right.Position)
        .slice(0, RampLimit);
    if (!Kept.length) return DefaultRampStops();
    if (Kept.length === 1) return [{ Position: 0, Colour: Kept[0].Colour }, { Position: 1, Colour: [...Kept[0].Colour] }];
    return Kept;
};

// The colour at one place along the ramp. Interpolated straight in RGB rather than through a colour space with an
// opinion: the stops are what the hand chose, and a midpoint it did not choose should be the obvious average of them.
export const RampColourAt = (Stops, Fraction) =>
{
    const Ramp = SortRampStops(Stops);
    const Where = Clamp(Fraction, 0, 1);
    if (Where <= Ramp[0].Position) return [...Ramp[0].Colour];
    const Last = Ramp[Ramp.length - 1];
    if (Where >= Last.Position) return [...Last.Colour];
    for (let Index = 1; Index < Ramp.length; Index += 1)
    {
        const Low = Ramp[Index - 1];
        const High = Ramp[Index];
        if (Where > High.Position) continue;
        const Spread = High.Position - Low.Position;
        const Share = Spread > 1e-6 ? (Where - Low.Position) / Spread : 1;
        return [0, 1, 2].map((Part) => Low.Colour[Part] + (High.Colour[Part] - Low.Colour[Part]) * Share);
    }
    return [...Last.Colour];
};

// Add a colour. With no colour named it takes the one the ramp already shows there, so a new stop never changes the
// gradient until it is dragged or recoloured — which is what makes clicking the strip safe.
export const PlaceRampStop = (Stops, Position, Colour = null) =>
{
    const Ramp = SortRampStops(Stops);
    const Where = Clamp(Position, 0, 1);
    if (Ramp.length >= RampLimit) return { Stops: Ramp, Index: -1 };
    const Added = { Position: Where, Colour: Colour ? SameColour(Colour) : RampColourAt(Ramp, Where) };
    // Where it lands: after every stop already sitting at or before it, which is where a stable sort would put it.
    const Index = Ramp.filter((Stop) => Stop.Position <= Where).length;
    return { Stops: [...Ramp.slice(0, Index), Added, ...Ramp.slice(Index)], Index };
};

export const RemoveRampStop = (Stops, Index) =>
{
    const Ramp = SortRampStops(Stops);
    if (Ramp.length <= 2 || Index < 0 || Index >= Ramp.length) return { Stops: Ramp, Index: Clamp(Index, 0, Ramp.length - 1) };
    const Kept = Ramp.filter((Ignored, Place) => Place !== Index);
    return { Stops: Kept, Index: Math.min(Index, Kept.length - 1) };
};

// 🔴 Moving a stop can reorder the list — drag the first one past the last and it IS the last one now — so the caller
//    is handed back where its stop ended up. Tracking it by index alone is how a drag jumps to a different colour
//    halfway across the strip.
export const MoveRampStop = (Stops, Index, Position) =>
{
    const Ramp = SortRampStops(Stops);
    if (Index < 0 || Index >= Ramp.length) return { Stops: Ramp, Index: 0 };
    const Held = { Position: Clamp(Position, 0, 1), Colour: [...Ramp[Index].Colour] };
    const Rest = Ramp.filter((Ignored, Place) => Place !== Index);
    const Landed = Rest.filter((Stop) => Stop.Position <= Held.Position).length;
    return { Stops: [...Rest.slice(0, Landed), Held, ...Rest.slice(Landed)], Index: Landed };
};

// The same four shapes of fade the shader runs, in the same order, so the strip on the card and the paint on the
// surface agree about what `smooth` means.
export const RampEase = (Fraction, Easing = "linear") =>
{
    const Share = Clamp(Fraction, 0, 1);
    if (Easing === "smooth") return Share * Share * (3 - 2 * Share);
    if (Easing === "in") return Share * Share;
    if (Easing === "out") return 1 - (1 - Share) * (1 - Share);
    return Share;
};

// A measured distance turned into a place in the ramp. `Cycle` repeats the ramp past its end instead of holding the
// last colour, which is what makes a rope, a cable or a candy stripe out of one stroke.
export const RampWhere = (Distance, Length, { Cycle = false, Reverse = false, Easing = "linear" } = {}) =>
{
    const Span = Math.max(Length, 1e-6);
    let Share = Distance / Span;
    if (Cycle) Share -= Math.floor(Share);
    Share = Clamp(Share, 0, 1);
    return RampEase(Reverse ? 1 - Share : Share, Easing);
};

// The ramp as a CSS gradient, for every strip the card draws. Stops in percent, in the order they sit in.
export const RampCss = (Stops, Angle = "to right") =>
    `linear-gradient(${Angle}, ${SortRampStops(Stops)
        .map(
            (Stop) =>
                `rgb(${Stop.Colour.map((Part) => Math.round(Clamp(Part, 0, 1) * 255)).join(",")}) ${(Stop.Position * 100).toFixed(2)}%`,
        )
        .join(", ")})`;

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
