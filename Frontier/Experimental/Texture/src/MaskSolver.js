//============================================================================================================================================
// 🩶 MaskSolver.js — the generator stack on a mask, solved into a sheet
//============================================================================================================================================
// A mask here is not one thing. It is a short stack: a dust generator over an edge-wear generator over a selection of
// three faces, each one joined to what is under it by a mode and a weight, the way the layers themselves are. This is
// where that stack becomes a single sheet of numbers the device can multiply a layer by.
//
// The noise is the same noise the shader draws — Hash21 and ValueNoise come from MediaSolver, which holds the twin of
// the shader's noise chunk — so a fractal mask solved here and a fractal generator layer drawn there agree. The fields
// come from SurfaceSolver: position, normal, occlusion, thickness, curvature and the identity sheets. The weathering
// generators are compositions of those, written out rather than hidden behind a parameter, because "dust" is a claim
// about where dust goes and the claim should be legible:
//
//     dust  = faces up · is sheltered · broken by fine noise
//     grime = sits in a crevice · is sheltered · roughened by noise
//     wear  = sits on a convex edge · stands proud · eaten into by noise
//     drips = runs down from a ledge · streaked vertically · gated by what catches the water
//
// 🔴 Solved on the CPU, at a sheet resolution of its own, because a mask is low-frequency and because this way every
//    generator is a function somebody can test. The device samples the result bilinearly over whatever the document's
//    resolution is.
//============================================================================================================================================

import { Hash21, ValueNoise } from "./MediaSolver.js";
import { GeneratorByIdentifier, NormaliseGenerator } from "./GeneratorSpecification.js";

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Value));
const Mix = (A, B, Share) => A + (B - A) * Share;
const Fract = (Value) => Value - Math.floor(Value);

//--------------------------------------------------------------------------------------------------------------------------
// The shader's noise chunk, in JavaScript. Fractal and Cellular are line for line with GeneratorChunk; Levels is the
// one curve every generator ends on, so Contrast and Balance mean the same thing wherever they are turned.
//--------------------------------------------------------------------------------------------------------------------------
export const Fractal = (X, Y, Octaves) =>
{
    let Sum = 0;
    let Amplitude = 0.5;
    let Total = 0;
    let PointX = X;
    let PointY = Y;
    for (let Index = 0; Index < 8; Index += 1)
    {
        if (Index >= Octaves) break;
        Sum += ValueNoise(PointX, PointY) * Amplitude;
        Total += Amplitude;
        PointX *= 2.02;
        PointY *= 2.02;
        Amplitude *= 0.5;
    }
    return Sum / Math.max(Total, 1e-4);
};

export const Cellular = (X, Y) =>
{
    const CellX = Math.floor(X);
    const CellY = Math.floor(Y);
    const LocalX = X - CellX;
    const LocalY = Y - CellY;
    let Closest = 1;
    for (let Row = -1; Row <= 1; Row += 1)
        for (let Column = -1; Column <= 1; Column += 1)
        {
            const SeedX = CellX + Column;
            const SeedY = CellY + Row;
            const PointX = Column + Hash21(SeedX * 127.1 + SeedY * 311.7, SeedY * 269.5 + SeedX * 183.3) - LocalX;
            const PointY = Row + Hash21(SeedX * 269.5 + SeedY * 183.3, SeedY * 127.1 + SeedX * 311.7) - LocalY;
            Closest = Math.min(Closest, Math.hypot(PointX, PointY));
        }
    return Clamp(Closest, 0, 1);
};

export const Levels = (Value, Balance, Contrast) =>
{
    const Width = Math.max(0.012, 1 - Contrast * 0.985);
    const Low = Balance - Width * 0.5;
    const High = Balance + Width * 0.5;
    return Clamp((Value - Low) / Math.max(1e-4, High - Low), 0, 1);
};

const Rotate = (X, Y, Angle) =>
{
    const Sine = Math.sin(Angle);
    const Cosine = Math.cos(Angle);
    return [X * Cosine - Y * Sine, X * Sine + Y * Cosine];
};

// Smoothstep, and it has to answer for a descending range as well as a rising one: half the weathering reads
// "the less of this, the more of that", and a range that silently clamps to one is a generator painted everywhere.
const Smooth = (Edge0, Edge1, Value) =>
{
    const Range = Edge1 - Edge0;
    if (Math.abs(Range) < 1e-6) return Value >= Edge1 ? 1 : 0;
    const Share = Clamp((Value - Edge0) / Range, 0, 1);
    return Share * Share * (3 - 2 * Share);
};

// A stable number per part, so "random per object" survives a reload and a re-measure.
const Scatter = (Index, Seed) => Hash21(Index * 12.9898 + Seed * 4.1414, Index * 78.233 - Seed * 1.618);

//--------------------------------------------------------------------------------------------------------------------------
// How an entry joins what is already in the sheet. The modes are BlendScalar's, by the same names the layer stack uses.
//--------------------------------------------------------------------------------------------------------------------------
export const CombineModes = [
    { Identifier: "multiply", Label: "Multiply" },
    { Identifier: "add", Label: "Add" },
    { Identifier: "subtract", Label: "Subtract" },
    { Identifier: "max", Label: "Lighten" },
    { Identifier: "min", Label: "Darken" },
    { Identifier: "screen", Label: "Screen" },
    { Identifier: "overwrite", Label: "Replace" },
];

export const Combine = (Mode, Lower, Upper) =>
{
    if (Mode === "multiply") return Lower * Upper;
    if (Mode === "add") return Lower + Upper;
    if (Mode === "subtract") return Lower - Upper;
    if (Mode === "max") return Math.max(Lower, Upper);
    if (Mode === "min") return Math.min(Lower, Upper);
    if (Mode === "screen") return 1 - (1 - Lower) * (1 - Upper);
    return Upper;
};

//--------------------------------------------------------------------------------------------------------------------------
// One entry of the stack, normalised: a generator plus how it joins the stack.
//--------------------------------------------------------------------------------------------------------------------------
let EntryCounter = 0;

export const NextEntryIdentifier = () =>
{
    EntryCounter += 1;
    return `field-${EntryCounter.toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`;
};

export const DefaultEntry = (Kind = "fbm", Overrides = {}) => ({
    Identifier: NextEntryIdentifier(),
    Enabled: true,
    Combine: "multiply",
    Weight: 1,
    ...NormaliseGenerator({ Kind }),
    ...Overrides,
});

export const NormaliseEntry = (Entry = {}) =>
{
    const Generator = NormaliseGenerator(Entry);
    const Specification = GeneratorByIdentifier[Generator.Kind];
    const Marks = Array.isArray(Entry.Marks)
        ? [...new Set(Entry.Marks.map((Mark) => Math.round(Number(Mark))).filter((Mark) => Number.isFinite(Mark) && Mark >= 0))]
        : [];
    return {
        ...Generator,
        Identifier: typeof Entry.Identifier === "string" && Entry.Identifier ? Entry.Identifier : NextEntryIdentifier(),
        Label: Specification?.Label || Generator.Kind,
        Enabled: Entry.Enabled !== false,
        Combine: CombineModes.some((Mode) => Mode.Identifier === Entry.Combine) ? Entry.Combine : "multiply",
        Weight: Clamp(Number.isFinite(Number(Entry.Weight)) ? Number(Entry.Weight) : 1, 0, 1),
        Choice: Entry.Choice === undefined || Entry.Choice === null ? (Generator.Choice ?? "") : String(Entry.Choice),
        Marks,
    };
};

//--------------------------------------------------------------------------------------------------------------------------
// One generator, at one texel. Sheets may be absent — a noise generator needs nothing but the coordinate, and that is
// the whole reason the family exists.
//--------------------------------------------------------------------------------------------------------------------------
export const SolveTexel = (Entry, Context) =>
{
    const { U, V, Sheets, Texel } = Context;
    const Kind = Entry.Kind;
    const Seed = Entry.Seed ?? 1;
    const Scale = Entry.Scale ?? 8;
    const Detail = Math.round(Entry.Detail ?? 4);
    const Warp = Entry.Warp ?? 0;
    const Angle = Entry.Angle ?? 0;
    const Spread = Entry.Spread ?? 0.5;
    const [PlacedX, PlacedY] = Rotate(U - 0.5, V - 0.5, (Angle * Math.PI) / 180);
    const PlaceX = PlacedX + 0.5;
    const PlaceY = PlacedY + 0.5;
    const ScaledX = PlaceX * Scale + Seed * 17.137;
    const ScaledY = PlaceY * Scale + Seed * 17.137;
    const Filled = Sheets ? Sheets.Filled[Texel] === 1 : false;
    const Normal = (Axis) => (Filled ? Sheets.Normal[Texel * 3 + Axis] : Axis === 1 ? 1 : 0);
    const Field = (Name, Fallback = 0) => (Filled ? Sheets[Name][Texel] : Fallback);

    let Value = 0.5;
    if (Kind === "fbm")
    {
        const WarpX = ScaledX + Warp * 2 * (Fractal(ScaledX * 0.5 + 11.3, ScaledY * 0.5 + 11.3, 3) - 0.5);
        const WarpY = ScaledY + Warp * 2 * (Fractal(ScaledX * 0.5 - 7.1, ScaledY * 0.5 - 7.1, 3) - 0.5);
        Value = Fractal(WarpX, WarpY, Detail);
    }
    else if (Kind === "cells")
    {
        const WarpX = ScaledX + Warp * 1.5 * (Fractal(ScaledX * 0.4, ScaledY * 0.4, 3) - 0.5);
        const WarpY = ScaledY + Warp * 1.5 * (Fractal(ScaledX * 0.4 + 5, ScaledY * 0.4 + 5, 3) - 0.5);
        Value = 1 - Cellular(WarpX, WarpY);
    }
    else if (Kind === "scratches")
    {
        const Lines = Fractal(ScaledX * 0.08, ScaledY * 9, Detail);
        const Fine = Fractal(ScaledX * 0.08 * 0.6 + 31.7, ScaledY * 9 * 3.1 + 31.7, 2);
        Value = 1 - Clamp(Math.abs(Lines - 0.5) * 3.4 + Fine * 0.22, 0, 1);
    }
    else if (Kind === "weave")
    {
        const WaveX = Math.sin(ScaledX * Math.PI);
        const WaveY = Math.sin(ScaledY * Math.PI);
        const Twill = 0.5 + 0.5 * Math.sin((ScaledX + ScaledY) * Math.PI * 0.5);
        Value = Clamp(0.5 + 0.5 * WaveX * WaveY * Mix(0.6, 1, Twill), 0, 1);
    }
    else if (Kind === "wood")
    {
        const Along = PlaceY * Scale;
        const Across = PlaceX * Scale;
        const Turbulence = Fractal(Across * 0.35 + Seed, Along * 0.08 + Seed, Detail) - 0.5;
        const Rings = Fract(Along * 0.5 + Turbulence * Warp * 4);
        Value = Math.abs(Rings - 0.5) * 2;
    }
    else if (Kind === "checker") Value = (Math.floor(PlaceX * Scale) + Math.floor(PlaceY * Scale)) % 2 === 0 ? 0 : 1;
    else if (Kind === "gradient") Value = Clamp(PlaceY, 0, 1);
    else if (Kind === "curvature") Value = Clamp(Math.max(0, -Field("Curvature")), 0, 1);
    else if (Kind === "cavity") Value = Clamp(Math.max(0, Field("Curvature")), 0, 1);
    else if (Kind === "occlusion") Value = 1 - Clamp(Field("Occlusion", 1), 0, 1);
    else if (Kind === "inclination") Value = Clamp(Normal(1) * 0.5 + 0.5, 0, 1);
    else if (Kind === "altitude") Value = Clamp(Field("Altitude"), 0, 1);
    else if (Kind === "thickness") Value = 1 - Clamp(Field("Thickness", 1), 0, 1);
    else if (Kind === "position")
    {
        const Axis = Math.round(Entry.Axis ?? 1);
        const Bounds = Sheets?.Bounds;
        const Low = Bounds ? Bounds.Minimum[Axis] : 0;
        const Span = Bounds ? Math.max(1e-6, Bounds.Maximum[Axis] - Low) : 1;
        Value = Filled ? Clamp((Sheets.Position[Texel * 3 + Axis] - Low) / Span, 0, 1) : 0;
    }
    else if (Kind === "facing")
    {
        const Axis = Math.round(Entry.Axis ?? 1);
        const Turn = (Angle * Math.PI) / 180;
        const Direction = Axis === 0 ? [Math.cos(Turn), 0, -Math.sin(Turn)] : Axis === 1 ? [0, 1, 0] : [Math.sin(Turn), 0, Math.cos(Turn)];
        Value = Clamp(
            (Normal(0) * Direction[0] + Normal(1) * Direction[1] + Normal(2) * Direction[2]) * 0.5 + 0.5,
            0,
            1,
        );
    }
    else if (Kind === "dust")
    {
        // Settles on what faces up, stays where nothing has disturbed it, and is never a flat film.
        const Up = Smooth(Mix(0.75, -0.1, Spread), 1, Normal(1));
        const Sheltered = Mix(1, 1 - Clamp(Field("Occlusion", 1), 0, 1) * 0.65, 0.6);
        const Grain = Fractal(ScaledX, ScaledY, Detail);
        Value = Clamp(Up * Sheltered * Mix(0.55, 1, Grain), 0, 1);
    }
    else if (Kind === "grime")
    {
        // Collects where two surfaces meet and where the light does not reach.
        const Crevice = Smooth(Mix(0.45, 0.02, Spread), 1, Math.max(0, Field("Curvature")));
        const Shadowed = Smooth(Mix(0.95, 0.35, Spread), 0.1, Clamp(Field("Occlusion", 1), 0, 1));
        const Grain = Fractal(ScaledX, ScaledY, Detail);
        Value = Clamp(Math.max(Crevice, Shadowed) * Mix(0.45, 1, Grain), 0, 1);
    }
    else if (Kind === "wear")
    {
        // Rubs through on the convex edges, worse the more they stand proud of what is around them.
        const Edge = Smooth(Mix(0.5, 0.04, Spread), 1, Math.max(0, -Field("Curvature")));
        const Proud = Mix(0.65, 1, Clamp(Field("Occlusion", 1), 0, 1));
        const Grain = Fractal(ScaledX, ScaledY, Detail);
        Value = Clamp(Edge * Proud * Mix(0.35, 1.15, Grain), 0, 1);
    }
    else if (Kind === "drips")
    {
        // Runs down. The streaks are stretched along the sheet's vertical, started by what catches the water above.
        const Streak = Fractal(ScaledX, ScaledY * 0.035, Detail);
        const Caught = Smooth(0.15, 0.85, Normal(1) * 0.5 + 0.5);
        const Run = Smooth(Mix(0.75, 0.3, Spread), 1, Streak);
        Value = Clamp(Run * Mix(0.25, 1, Caught) * Mix(1, 1 - Field("Altitude"), 0.35), 0, 1);
    }
    else if (Kind === "object") Value = Filled && String(Sheets.Owner[Texel]) === String(Entry.Choice) ? 1 : 0;
    else if (Kind === "tile") Value = Filled && String(Sheets.Tile[Texel]) === String(Entry.Choice) ? 1 : 0;
    else if (Kind === "island") Value = Filled && String(Sheets.Island[Texel]) === String(Entry.Choice) ? 1 : 0;
    else if (Kind === "faces") Value = Filled && Context.Picked?.has(Sheets.Face[Texel]) ? 1 : 0;
    else if (Kind === "vertex")
    {
        const Map = Entry.Choice || "occlusion";
        if (Map === "thickness") Value = Clamp(Field("Thickness", 1), 0, 1);
        else if (Map === "altitude") Value = Clamp(Field("Altitude"), 0, 1);
        else if (Map === "inclination") Value = Clamp(Normal(1) * 0.5 + 0.5, 0, 1);
        else if (Map === "object") Value = Filled ? Scatter(Sheets.Owner[Texel] + 1, Seed) : 0;
        else if (Map === "island") Value = Filled ? Scatter(Sheets.Island[Texel] + 1, Seed) : 0;
        else Value = Clamp(Field("Occlusion", 1), 0, 1);
    }

    // Selections are already an answer; levelling them would only soften an edge the painter asked to be exact.
    const Family = GeneratorByIdentifier[Kind]?.Family;
    if (Family !== "selection" || Kind === "vertex") Value = Levels(Value, Entry.Balance ?? 0.5, Entry.Contrast ?? 0.5);
    return Entry.Invert ? 1 - Value : Value;
};

//--------------------------------------------------------------------------------------------------------------------------
// The stack, into a sheet. One pass per entry rather than per texel, so a generator's own state is set up once.
//--------------------------------------------------------------------------------------------------------------------------
export const SolveMask = (Entries, Sheets, Options = {}) =>
{
    const Size = Options.Size || Sheets?.Size || 256;
    const Texels = Size * Size;
    const Values = new Float32Array(Texels).fill(1);
    const Live = (Entries || []).map(NormaliseEntry).filter((Entry) => Entry.Enabled);
    if (!Live.length) return { Size, Values, Entries: 0 };

    for (const Entry of Live)
    {
        const Picked = Entry.Kind === "faces" ? new Set(Entry.Marks) : null;
        const Context = { Sheets, Picked, U: 0, V: 0, Texel: 0 };
        for (let Row = 0; Row < Size; Row += 1)
        {
            Context.V = (Row + 0.5) / Size;
            for (let Column = 0; Column < Size; Column += 1)
            {
                const Texel = Row * Size + Column;
                Context.U = (Column + 0.5) / Size;
                Context.Texel = Sheets && Sheets.Size !== Size ? SampleTexel(Sheets.Size, Context.U, Context.V) : Texel;
                const Value = SolveTexel(Entry, Context);
                Values[Texel] = Clamp(Combine(Entry.Combine, Values[Texel], Value * Entry.Weight + (1 - Entry.Weight) * Idle(Entry.Combine)), 0, 1);
            }
        }
    }
    return { Size, Values, Entries: Live.length };
};

// What an entry has to be worth for the combine to leave the stack alone, so Weight fades it out rather than down.
const Idle = (Mode) => (Mode === "multiply" || Mode === "min" ? 1 : Mode === "overwrite" ? 0.5 : 0);

const SampleTexel = (Size, U, V) =>
{
    const Column = Clamp(Math.floor(U * Size), 0, Size - 1);
    const Row = Clamp(Math.floor(V * Size), 0, Size - 1);
    return Row * Size + Column;
};

// The sheet, as the device wants it: one byte a channel, the value in all four so either a red or an alpha read works.
export const SheetImage = (Solved) =>
{
    const Pixels = new Uint8ClampedArray(Solved.Size * Solved.Size * 4);
    for (let Texel = 0; Texel < Solved.Values.length; Texel += 1)
    {
        const Value = Math.round(Clamp(Solved.Values[Texel], 0, 1) * 255);
        Pixels[Texel * 4] = Value;
        Pixels[Texel * 4 + 1] = Value;
        Pixels[Texel * 4 + 2] = Value;
        Pixels[Texel * 4 + 3] = Value;
    }
    return Pixels;
};

// Which of the stack's entries cannot answer until the surface has been measured, so the panel can say so rather than
// drawing a mask of flat nothing and leaving somebody to wonder.
export const MissingMeasurements = (Entries, Sheets) =>
{
    if (Sheets) return [];
    const Wanted = new Set();
    for (const Entry of Entries || [])
    {
        const Family = GeneratorByIdentifier[Entry.Kind]?.Family;
        if (Family && Family !== "noise" && Family !== "synthetic") Wanted.add(GeneratorByIdentifier[Entry.Kind].Label);
    }
    return [...Wanted];
};
