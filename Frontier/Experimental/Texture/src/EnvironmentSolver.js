//============================================================================================================================================
// 🩶 EnvironmentSolver.js — a recipe for a sky, turned into the small map that lights the model
//============================================================================================================================================
// Nine skies, none of them a file. Each one is evaluated into a latitude-longitude map two hundred and fifty-six
// across, reduced to a chain of ever blurrier copies, and projected onto nine spherical harmonics. The map is what a
// reflection sees; the chain is what roughness picks a level out of; the harmonics are what the lit side of the model
// gets from every direction at once. Generating all three costs a few milliseconds, which is the entire argument for
// doing it procedurally: the sun can move.
//
// 🔴 The sun's DISC is not baked. A disc a degree across is one texel of this map, so baking it would be a square
//    blob in every mirror and — worse — a second helping of the same light, once in the map and once in the shading
//    loop. The map carries the glow around the sun, which is genuinely part of the sky; the disc is drawn analytically
//    where it can be sharp, and the sun lights the model as a light.
//============================================================================================================================================

import { EnvironmentByIdentifier, EnvironmentOrdering, SanitiseSun, SunVector, WarmthColour } from "./EnvironmentSpecification.js";

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Number.isFinite(Value) ? Value : Low));
const Mix = (Low, High, Fraction) => Low + (High - Low) * Fraction;
const Smooth = (Edge0, Edge1, Value) =>
{
    const Fraction = Clamp((Value - Edge0) / (Edge1 - Edge0 || 1e-6), 0, 1);
    return Fraction * Fraction * (3 - 2 * Fraction);
};

//--------------------------------------------------------------------------------------------------------------------------
// Noise. MediaSolver's is two-dimensional, and a sphere has no two-dimensional parameterisation without a seam running
// down it — so cloud and dapple are sampled in three dimensions off the direction itself, where the sky closes on
// itself the way the sky does.
//--------------------------------------------------------------------------------------------------------------------------
const Hash31 = (X, Y, Z) =>
{
    let Value = Math.sin(X * 127.1 + Y * 311.7 + Z * 74.7) * 43758.5453123;
    Value -= Math.floor(Value);
    return Value;
};

export const Noise3 = (X, Y, Z) =>
{
    const FloorX = Math.floor(X);
    const FloorY = Math.floor(Y);
    const FloorZ = Math.floor(Z);
    const FractionX = X - FloorX;
    const FractionY = Y - FloorY;
    const FractionZ = Z - FloorZ;
    const EaseX = FractionX * FractionX * (3 - 2 * FractionX);
    const EaseY = FractionY * FractionY * (3 - 2 * FractionY);
    const EaseZ = FractionZ * FractionZ * (3 - 2 * FractionZ);
    let Total = 0;
    for (let Corner = 0; Corner < 8; Corner += 1)
    {
        const StepX = Corner & 1;
        const StepY = (Corner >> 1) & 1;
        const StepZ = (Corner >> 2) & 1;
        const Weight =
            (StepX ? EaseX : 1 - EaseX) * (StepY ? EaseY : 1 - EaseY) * (StepZ ? EaseZ : 1 - EaseZ);
        Total += Hash31(FloorX + StepX, FloorY + StepY, FloorZ + StepZ) * Weight;
    }
    return Total;
};

export const Fractal = (X, Y, Z, Octaves = 4, Gain = 0.5) =>
{
    let Sum = 0;
    let Weight = 0;
    let Amplitude = 1;
    let Frequency = 1;
    for (let Octave = 0; Octave < Octaves; Octave += 1)
    {
        Sum += Noise3(X * Frequency, Y * Frequency, Z * Frequency) * Amplitude;
        Weight += Amplitude;
        Amplitude *= Gain;
        Frequency *= 2.03;
    }
    return Sum / Math.max(1e-6, Weight);
};

//--------------------------------------------------------------------------------------------------------------------------
// One panel of light, as seen from the middle of the room. Measured in angles rather than metres, because the model is
// always in the middle and a softbox two metres away at forty degrees is a softbox.
//--------------------------------------------------------------------------------------------------------------------------
const PanelLight = (Panel, Azimuth, Elevation) =>
{
    let Across = Azimuth - Panel.Azimuth;
    while (Across > 180) Across -= 360;
    while (Across < -180) Across += 360;
    const Down = Elevation - Panel.Elevation;
    const Half = Math.max(2, Panel.Width) / 2;
    const Tall = Math.max(2, Panel.Height) / 2;
    const Edge = Math.max(0.02, Panel.Softness);
    const Inside =
        Smooth(1, 1 - Edge, Math.abs(Across) / Half) * Smooth(1, 1 - Edge, Math.abs(Down) / Tall);
    return Inside * Panel.Strength;
};

//--------------------------------------------------------------------------------------------------------------------------
// The recipes. Everything here answers one question: looking in this direction, what colour is the sky, and how bright?
//--------------------------------------------------------------------------------------------------------------------------
export const SkyRadiance = (Recipe, Direction, Sun = null) =>
{
    const [X, Y, Z] = Direction;
    const Elevation = (Math.asin(Clamp(Y, -1, 1)) * 180) / Math.PI;
    const Azimuth = ((Math.atan2(X, Z) * 180) / Math.PI + 360) % 360;
    const Above = Smooth(-0.04, 0.06, Y);
    // The ground falls away under you: what is near is in your own shadow, what is far catches the sky. Every
    // outdoor recipe reads its floor through this, which is the difference between a ground plane and a grey card.
    const Underfoot = Mix(1.3, 0.45, Smooth(0, -0.7, Y));
    let Colour = [0, 0, 0];

    if (Recipe.Kind === "room")
    {
        const Up = Smooth(0.1, 0.75, Y);
        const Walls = Recipe.Walls;
        const Floor = Recipe.Floor;
        const Ceiling = Recipe.Ceiling;
        Colour = [0, 1, 2].map((Part) => Mix(Mix(Floor[Part], Walls[Part], Above), Ceiling[Part], Up));
        for (const Panel of Recipe.Panels || [])
        {
            const Strength = PanelLight(Panel, Azimuth, Elevation);
            if (Strength <= 0) continue;
            for (let Part = 0; Part < 3; Part += 1) Colour[Part] += Panel.Tint[Part] * Strength;
        }
    }
    else if (Recipe.Kind === "sky")
    {
        const Height = Clamp(Y, 0, 1) ** 0.55;
        const Sky = [0, 1, 2].map((Part) => Mix(Recipe.Lower[Part], Recipe.Upper[Part], Height));
        const Clouds = Recipe.Clouds;
        if (Clouds && Y > -0.02)
        {
            // Flattened against the dome, so the cloud deck stretches towards the horizon the way a deck does.
            const Flat = 1 / Math.max(0.12, Y + 0.12);
            const Field = Fractal(X * Flat * Clouds.Scale, Y * Clouds.Scale * 0.6 + Clouds.Drift * 3, Z * Flat * Clouds.Scale, 5);
            const Cover = Smooth(1 - Clouds.Cover, 1 - Clouds.Cover + Mix(0.3, 0.04, Clouds.Sharpness), Field);
            const Lit = Mix(0.55, 1.35, Smooth(0.35, 0.8, Field));
            for (let Part = 0; Part < 3; Part += 1)
                Sky[Part] = Mix(Sky[Part], Clouds.Tint[Part] * Lit, Cover * Above);
        }
        const Haze = Recipe.Haze * (1 - Smooth(0, 0.35, Math.abs(Y)));
        for (let Part = 0; Part < 3; Part += 1) Sky[Part] = Mix(Sky[Part], Recipe.Lower[Part] * 1.1, Haze);
        Colour = [0, 1, 2].map((Part) => Mix(Recipe.Floor[Part] * Underfoot, Sky[Part], Above));
    }
    else if (Recipe.Kind === "canopy")
    {
        const Field = Fractal(X * Recipe.Scale, Y * Recipe.Scale, Z * Recipe.Scale, 4, 0.55);
        const Gap = Smooth(Recipe.Density, Recipe.Density + 0.14, Field) * Smooth(0.0, 0.5, Y);
        const Leaf = [0, 1, 2].map((Part) => Mix(Recipe.Leaf[Part], Recipe.Gap[Part] * 2.6, Gap));
        Colour = [0, 1, 2].map((Part) => Mix(Recipe.Floor[Part] * Underfoot, Leaf[Part], Above));
    }
    else if (Recipe.Kind === "city")
    {
        const Height = Clamp(Y, 0, 1) ** 0.7;
        const Sky = [0, 1, 2].map((Part) => Mix(Recipe.Lower[Part], Recipe.Upper[Part], Height));
        const Windows = Recipe.Windows;
        if (Windows && Y > -0.06 && Y < 0.22)
        {
            // A grid of lit squares around the horizon, which is what a city is from the middle of one.
            const Column = Math.floor(((Azimuth / 360) * Windows.Columns) % Windows.Columns);
            const Row = Math.floor(((Elevation + 4) / 16) * Windows.Rows);
            const Seed = Hash31(Column * 1.7, Row * 2.3, 11.1);
            if (Seed < Windows.Chance)
            {
                const AcrossCell = (((Azimuth / 360) * Windows.Columns) % 1) - 0.5;
                const DownCell = ((((Elevation + 4) / 16) * Windows.Rows) % 1) - 0.5;
                const Lit = Smooth(0.42, 0.2, Math.abs(AcrossCell)) * Smooth(0.42, 0.18, Math.abs(DownCell));
                const Brightness = Windows.Strength * Lit * Mix(0.4, 1.6, Hash31(Column * 3.1, Row * 5.9, 2.7));
                for (let Part = 0; Part < 3; Part += 1) Sky[Part] += Windows.Tint[Part] * Brightness;
            }
        }
        if (Recipe.Stars && Y > 0.05)
        {
            const Star = Hash31(Math.round(X * 420), Math.round(Y * 420), Math.round(Z * 420));
            if (Star > 0.9992) for (let Part = 0; Part < 3; Part += 1) Sky[Part] += Recipe.Stars * 2.4 * Smooth(0.05, 0.4, Y);
        }
        Colour = [0, 1, 2].map((Part) => Mix(Recipe.Floor[Part] * Underfoot, Sky[Part], Above));
    }
    else if (Recipe.Kind === "nebula")
    {
        const Field = Fractal(X * Recipe.Scale, Y * Recipe.Scale, Z * Recipe.Scale, 5, 0.58);
        const Second = Fractal(X * Recipe.Scale * 2.3 + 11, Y * Recipe.Scale * 2.3 - 7, Z * Recipe.Scale * 2.3 + 3, 4, 0.5);
        const Warm = Smooth(Recipe.Density, Recipe.Density + 0.22, Field) ** 1.4;
        const Cool = Smooth(Recipe.Density + 0.04, Recipe.Density + 0.3, Second) ** 1.6;
        Colour = [0, 1, 2].map((Part) => Recipe.Deep[Part] + Recipe.Warm[Part] * Warm * 0.55 + Recipe.Cool[Part] * Cool * 0.45);
        const Star = Hash31(Math.round(X * 540), Math.round(Y * 540), Math.round(Z * 540));
        if (Star > 0.9988)
        {
            const Flare = Recipe.Stars * (2 + Hash31(Math.round(X * 97), Math.round(Z * 97), 5.5) * 6);
            for (let Part = 0; Part < 3; Part += 1) Colour[Part] += Flare;
        }
    }

    // The sun's halo, which belongs to the sky: scattered light around it, and a flush along the horizon under it.
    if (Sun && Sun.On && Sun.Strength > 0)
    {
        const Tint = WarmthColour(Sun.Warmth);
        const Angle = Math.acos(Clamp(X * Sun.Direction[0] + Y * Sun.Direction[1] + Z * Sun.Direction[2], -1, 1));
        const Radius = Math.max(0.004, (Sun.Size * 0.5 * Math.PI) / 180);
        // 🔴 The aureole is a few degrees wide whatever size the sun is. Tying its width to the sun's own radius
        //    reads fine for a pinhole and turns a soft eight-degree sun into a glow fifty degrees across, which is
        //    not a sun behind cloud — it is a sky with a torch pointed at it.
        const Tight = Clamp(Radius * 6, 0.012, 0.22);
        const Halo = Math.exp(-((Angle / Tight) ** 1.3)) * 0.55 + Math.exp(-((Angle / 0.9) ** 2)) * 0.12;
        // The flush along the horizon is a low sun's doing — the light is coming the long way through the air. A sun
        // overhead has none of it, which is the difference between a noon sky and a five o'clock one.
        const Low = 1 - Smooth(0.08, 0.45, Sun.Direction[1]);
        const Flush = Recipe.Kind === "sky" ? Math.exp(-((Angle / 1.5) ** 2)) * (1 - Smooth(0, 0.3, Math.abs(Y))) * 0.5 * Low : 0;
        for (let Part = 0; Part < 3; Part += 1) Colour[Part] += Tint[Part] * Sun.Strength * (Halo + Flush);
    }

    // A touch of grain, so a wide flat gradient does not band when it is stretched across a mirror.
    if (Recipe.Grade)
    {
        const Grain = (Hash31(Math.round(X * 180), Math.round(Y * 180), Math.round(Z * 180)) - 0.5) * Recipe.Grade;
        for (let Part = 0; Part < 3; Part += 1) Colour[Part] = Math.max(0, Colour[Part] * (1 + Grain));
    }
    return Colour;
};

//--------------------------------------------------------------------------------------------------------------------------
// The direction a texel of a latitude-longitude map looks in. Row nought is straight up, which is the way the shader
// reads it back; get this the wrong way round and every sky in the catalogue is upside down together, which is
// precisely the kind of bug that survives a review.
//--------------------------------------------------------------------------------------------------------------------------
export const TexelDirection = (Column, Row, Width, Height) =>
{
    const Polar = ((Row + 0.5) / Height) * Math.PI;
    const Around = ((Column + 0.5) / Width) * Math.PI * 2 - Math.PI;
    const Flat = Math.sin(Polar);
    return [Math.sin(Around) * Flat, Math.cos(Polar), Math.cos(Around) * Flat];
};

//--------------------------------------------------------------------------------------------------------------------------
// Nine spherical harmonics, the standard irradiance projection. Nine numbers hold every slow change in a sky — which
// is all a diffuse surface can see of one — and evaluating them is nine multiplies instead of a thousand samples.
//--------------------------------------------------------------------------------------------------------------------------
export const ProjectHarmonics = (Values, Width, Height) =>
{
    const Coefficients = new Float32Array(27);
    let Weight = 0;
    for (let Row = 0; Row < Height; Row += 1)
    {
        const Polar = ((Row + 0.5) / Height) * Math.PI;
        // The texels near the poles of a latitude-longitude map cover almost nothing, and counting them equally is
        // how a projected sky ends up with a bright spot on top of it.
        const Solid = ((2 * Math.PI) / Width) * (Math.PI / Height) * Math.sin(Polar);
        for (let Column = 0; Column < Width; Column += 1)
        {
            const [X, Y, Z] = TexelDirection(Column, Row, Width, Height);
            const At = (Row * Width + Column) * 3;
            const Basis = [
                0.282095,
                0.488603 * Y,
                0.488603 * Z,
                0.488603 * X,
                1.092548 * X * Y,
                1.092548 * Y * Z,
                0.315392 * (3 * Z * Z - 1),
                1.092548 * X * Z,
                0.546274 * (X * X - Y * Y),
            ];
            for (let Band = 0; Band < 9; Band += 1)
                for (let Part = 0; Part < 3; Part += 1)
                    Coefficients[Band * 3 + Part] += Values[At + Part] * Basis[Band] * Solid;
            Weight += Solid;
        }
    }
    return { Coefficients, Weight };
};

// The irradiance those nine numbers describe, in a direction. Convolved with a cosine lobe and divided by pi, so a
// sky of radiance one gives exactly one back and a white surface under it is white.
export const EvaluateHarmonics = (Coefficients, Direction) =>
{
    const [X, Y, Z] = Direction;
    const A0 = 3.141593;
    const A1 = 2.094395;
    const A2 = 0.785398;
    const Basis = [
        0.282095 * A0,
        0.488603 * Y * A1,
        0.488603 * Z * A1,
        0.488603 * X * A1,
        1.092548 * X * Y * A2,
        1.092548 * Y * Z * A2,
        0.315392 * (3 * Z * Z - 1) * A2,
        1.092548 * X * Z * A2,
        0.546274 * (X * X - Y * Y) * A2,
    ];
    const Colour = [0, 0, 0];
    for (let Band = 0; Band < 9; Band += 1)
        for (let Part = 0; Part < 3; Part += 1) Colour[Part] += Coefficients[Band * 3 + Part] * Basis[Band];
    return Colour.map((Part) => Math.max(0, Part / Math.PI));
};

//--------------------------------------------------------------------------------------------------------------------------
// The whole thing: the map, the chain of blurrier copies, and the harmonics.
//
// 🔴 Encoded as the square root of the radiance over the sky's own range. Eight bits spread linearly over a sky with
//    a hundred to one in it leaves the floor of the room in four of those values and visibly stepped; square-rooting
//    spends the precision where the eye is, and costs one multiply to undo.
//--------------------------------------------------------------------------------------------------------------------------
export const SolveEnvironment = (Identifier, Sun = null, Options = {}) =>
{
    const Preset = EnvironmentByIdentifier[Identifier] || EnvironmentOrdering[0];
    const Height = Clamp(Math.round(Options.Height || 128), 8, 512);
    const Width = Height * 2;
    const Settled = Sun ? SanitiseSun(Sun, Preset.Identifier) : null;
    const Shining = Settled && Settled.On ? { ...Settled, Direction: SunVector({ ...Settled }, 0).Direction } : null;
    const Started = Date.now();

    const Values = new Float32Array(Width * Height * 3);
    for (let Row = 0; Row < Height; Row += 1)
        for (let Column = 0; Column < Width; Column += 1)
        {
            const Colour = SkyRadiance(Preset.Sky, TexelDirection(Column, Row, Width, Height), Shining);
            const At = (Row * Width + Column) * 3;
            Values[At] = Math.max(0, Colour[0]);
            Values[At + 1] = Math.max(0, Colour[1]);
            Values[At + 2] = Math.max(0, Colour[2]);
        }

    const { Coefficients } = ProjectHarmonics(Values, Width, Height);
    const Scale = Math.max(0.01, Preset.Scale || 8);
    const Levels = [];
    let LevelWidth = Width;
    let LevelHeight = Height;
    let Current = Values;
    while (LevelWidth >= 4 && LevelHeight >= 2)
    {
        Levels.push({ Width: LevelWidth, Height: LevelHeight, Bytes: Encode(Current, LevelWidth, LevelHeight, Scale) });
        if (LevelWidth === 4) break;
        Current = Reduce(Current, LevelWidth, LevelHeight);
        LevelWidth = Math.max(4, LevelWidth >> 1);
        LevelHeight = Math.max(2, LevelHeight >> 1);
    }
    return {
        Identifier: Preset.Identifier,
        Width,
        Height,
        Scale,
        Values,
        Levels,
        Harmonics: Coefficients,
        Milliseconds: Date.now() - Started,
    };
};

const Encode = (Values, Width, Height, Scale) =>
{
    const Bytes = new Uint8Array(Width * Height * 4);
    for (let Texel = 0; Texel < Width * Height; Texel += 1)
    {
        for (let Part = 0; Part < 3; Part += 1)
            Bytes[Texel * 4 + Part] = Math.round(Math.sqrt(Clamp(Values[Texel * 3 + Part] / Scale, 0, 1)) * 255);
        Bytes[Texel * 4 + 3] = 255;
    }
    return Bytes;
};

// Halved, in the radiance the sky actually has rather than in the bytes it is stored as — averaging encoded values
// darkens every blur, because the square root of a mean is not the mean of the square roots.
const Reduce = (Values, Width, Height) =>
{
    const Across = Math.max(4, Width >> 1);
    const Down = Math.max(2, Height >> 1);
    const Smaller = new Float32Array(Across * Down * 3);
    for (let Row = 0; Row < Down; Row += 1)
        for (let Column = 0; Column < Across; Column += 1)
        {
            for (let Part = 0; Part < 3; Part += 1)
            {
                let Sum = 0;
                let Taken = 0;
                for (let StepY = 0; StepY < 2; StepY += 1)
                    for (let StepX = 0; StepX < 2; StepX += 1)
                    {
                        const Y = Math.min(Height - 1, Row * 2 + StepY);
                        const X = (Column * 2 + StepX) % Width;
                        Sum += Values[(Y * Width + X) * 3 + Part];
                        Taken += 1;
                    }
                Smaller[(Row * Across + Column) * 3 + Part] = Sum / Taken;
            }
        }
    return Smaller;
};

//--------------------------------------------------------------------------------------------------------------------------
// A tile for the pod: the same sky, tone-mapped, small, and upright for a canvas rather than for a sampler. Rendered
// from the recipe rather than scaled down from the map, because a thumbnail of a sky is mostly horizon and the
// horizon is where all the detail is.
//--------------------------------------------------------------------------------------------------------------------------
export const PreviewImage = (Identifier, Sun = null, Width = 120, Height = 60, Exposure = 0) =>
{
    const Preset = EnvironmentByIdentifier[Identifier] || EnvironmentOrdering[0];
    const Settled = Sun ? SanitiseSun(Sun, Preset.Identifier) : null;
    const Shining = Settled && Settled.On ? { ...Settled, Direction: SunVector({ ...Settled }, 0).Direction } : null;
    const Pixels = new Uint8ClampedArray(Width * Height * 4);
    const Gain = 2 ** Exposure;
    for (let Row = 0; Row < Height; Row += 1)
        for (let Column = 0; Column < Width; Column += 1)
        {
            const Direction = TexelDirection(Column, Row, Width, Height);
            const Colour = SkyRadiance(Preset.Sky, Direction, Shining);
            // The disc, drawn here only — a preview is the one place the sun is allowed to be a shape in the map.
            if (Shining)
            {
                const Angle = Math.acos(
                    Clamp(
                        Direction[0] * Shining.Direction[0] + Direction[1] * Shining.Direction[1] + Direction[2] * Shining.Direction[2],
                        -1,
                        1,
                    ),
                );
                const Radius = Math.max(0.02, (Shining.Size * 0.5 * Math.PI) / 180);
                const Disc = 1 - Smooth(Radius * 0.7, Radius * 1.6, Angle);
                if (Disc > 0)
                {
                    const Tint = WarmthColour(Shining.Warmth);
                    for (let Part = 0; Part < 3; Part += 1) Colour[Part] += Tint[Part] * Shining.Strength * Disc * 2.2;
                }
            }
            const At = (Row * Width + Column) * 4;
            for (let Part = 0; Part < 3; Part += 1)
            {
                const Mapped = Tone(Colour[Part] * Gain);
                Pixels[At + Part] = Math.round(Mapped ** (1 / 2.2) * 255);
            }
            Pixels[At + 3] = 255;
        }
    return { Pixels, Width, Height };
};

// The viewport's tone curve, so a tile and the viewport behind it agree about what bright looks like.
const Tone = (Value) =>
{
    const A = 2.51;
    const B = 0.03;
    const C = 2.43;
    const D = 0.59;
    const E = 0.14;
    return Clamp((Value * (A * Value + B)) / (Value * (C * Value + D) + E), 0, 1);
};
