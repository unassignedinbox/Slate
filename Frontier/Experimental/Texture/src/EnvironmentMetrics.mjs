//============================================================================================================================================
// 🧪 EnvironmentMetrics.mjs — the sky: what it is made of, where the sun is, and whether the two agree
//============================================================================================================================================
// An environment here is a recipe rather than a photograph, so there is no file to compare against and everything
// has to be checked from the inside: that a map and the shader's lookup agree on which way is up, that the blurrier
// copies do not lose light, that the nine coefficients describe the same sky the texels do, and — the one that
// matters most — that the sun's disc is never written into the map it is also lighting the model with.
//============================================================================================================================================

import test from "node:test";
import assert from "node:assert/strict";

import {
    EnvironmentByIdentifier,
    EnvironmentIndex,
    EnvironmentOrdering,
    LightOrdering,
    LightVector,
    SanitiseSun,
    SunDefaults,
    SunVector,
    WarmthColour,
} from "./EnvironmentSpecification.js";
import { EvaluateHarmonics, PreviewImage, SkyRadiance, SolveEnvironment, TexelDirection } from "./EnvironmentSolver.js";
import { DefaultProject, SanitiseProject } from "./LayerSpecification.js";

const Height = 48;
const Solved = new Map();
const Sky = (Identifier, Sun = null, Size = Height) =>
{
    const Key = `${Identifier}:${Size}:${Sun ? Object.values(Sun).join(",") : "none"}`;
    if (!Solved.has(Key)) Solved.set(Key, SolveEnvironment(Identifier, Sun, { Height: Size }));
    return Solved.get(Key);
};

const Texel = (Map_, Column, Row) =>
{
    const At = (Row * Map_.Width + Column) * 3;
    return [Map_.Values[At], Map_.Values[At + 1], Map_.Values[At + 2]];
};

const Luminance = (Colour) => 0.2126 * Colour[0] + 0.7152 * Colour[1] + 0.0722 * Colour[2];

const Mean = (Values) =>
{
    let Sum = 0;
    for (let Index = 0; Index < Values.length; Index += 1) Sum += Values[Index];
    return Sum / Values.length;
};

//--------------------------------------------------------------------------------------------------------------------------
// The catalogue.
//--------------------------------------------------------------------------------------------------------------------------
test("every environment is complete and nameable", () =>
{
    assert.ok(EnvironmentOrdering.length >= 9, `only ${EnvironmentOrdering.length} environments`);
    const Seen = new Set();
    for (const Entry of EnvironmentOrdering)
    {
        assert.ok(!Seen.has(Entry.Identifier), `${Entry.Identifier} listed twice`);
        Seen.add(Entry.Identifier);
        assert.ok(Entry.Label && Entry.Note, `${Entry.Identifier} has no label or note`);
        assert.ok(Entry.Sky && typeof Entry.Sky.Kind === "string", `${Entry.Identifier} has no recipe`);
        assert.ok(Entry.Scale > 0, `${Entry.Identifier} has no encoding scale`);
        for (const Name of ["Key", "Fill", "Rim"])
            assert.ok(Number.isFinite(Entry[Name]) && Entry[Name] >= 0, `${Entry.Identifier} ${Name} is not a strength`);
        for (const Name of ["Zenith", "Horizon", "Ground"])
            assert.ok(Array.isArray(Entry[Name]) && Entry[Name].length === 3, `${Entry.Identifier} ${Name} is not a colour`);
        assert.deepEqual(SunDefaults(Entry.Identifier), Entry.Sun, `${Entry.Identifier} has no sun of its own`);
        assert.equal(EnvironmentByIdentifier[Entry.Identifier], Entry);
    }
    assert.equal(EnvironmentIndex("nothing-like-this"), 0, "an unknown sky falls back to the first");
});

test("a light in the rig points where its swing and height say", () =>
{
    const Rig = LightOrdering.map((Order, Index) => LightVector({ ...Order, On: true, Strength: 2 }, Index, 0));
    for (const Light of Rig)
    {
        const Length = Math.hypot(...Light.Direction);
        assert.ok(Math.abs(Length - 1) < 1e-6, `direction is ${Length} long`);
        assert.ok(Light.Radiance.every((Part) => Part >= 0));
    }
    const Turned = LightVector({ ...LightOrdering[0], On: true, Strength: 2 }, 0, 90);
    assert.ok(Math.hypot(...Turned.Direction.map((Part, Index) => Part - Rig[0].Direction[Index])) > 0.3, "rotation moves the rig");
});

//--------------------------------------------------------------------------------------------------------------------------
// The sun.
//--------------------------------------------------------------------------------------------------------------------------
test("a sun is repaired rather than believed", () =>
{
    const Fixed = SanitiseSun({ On: "yes", Elevation: 900, Swing: -40, Strength: -5, Warmth: 99, Size: 400 }, "daylight");
    assert.equal(Fixed.On, true);
    assert.ok(Fixed.Elevation <= 90 && Fixed.Elevation >= -20, `elevation ${Fixed.Elevation}`);
    assert.ok(Fixed.Swing >= 0 && Fixed.Swing <= 360, `swing ${Fixed.Swing}`);
    assert.ok(Fixed.Strength >= 0, `strength ${Fixed.Strength}`);
    assert.ok(Fixed.Warmth >= 1000, `warmth ${Fixed.Warmth}`);
    assert.ok(Fixed.Size <= 45, `size ${Fixed.Size}`);
    assert.deepEqual(SanitiseSun(undefined, "sunset"), SunDefaults("sunset"));
});

test("warmth is a colour, and the low numbers are the red ones", () =>
{
    const Candle = WarmthColour(1800);
    const Noon = WarmthColour(6500);
    const Shade = WarmthColour(11000);
    assert.ok(Candle[0] - Candle[2] > Noon[0] - Noon[2], "1800K is not warmer than 6500K");
    assert.ok(Shade[2] - Shade[0] > Noon[2] - Noon[0], "11000K is not cooler than 6500K");
    // Normalised on the green, so warmth changes the colour of the light and never the amount of it.
    for (const Colour of [Candle, Noon, Shade])
    {
        assert.ok(Colour.every((Part) => Part >= 0 && Part <= 2), `${Colour} is not a colour`);
        assert.ok(Math.abs(Colour[1] - 1) < 0.01, `green is ${Colour[1]} rather than one`);
    }
});

test("a sun that is off is a light that is off", () =>
{
    const Dark = SunVector({ ...SunDefaults("daylight"), On: false }, 0);
    assert.equal(Dark.On, false);
    assert.deepEqual(Dark.Radiance, [0, 0, 0], "an off sun still throws light");
    const Lit = SunVector({ ...SunDefaults("daylight"), On: true }, 0);
    assert.ok(Lit.Radiance.some((Part) => Part > 0.5), "an on sun throws nothing");
});

test("elevation and swing put the sun where they say", () =>
{
    const High = SunVector({ ...SunDefaults("daylight"), On: true, Elevation: 90, Swing: 0 }, 0);
    assert.ok(High.Direction[1] > 0.999, `overhead sun points at ${High.Direction}`);
    const Flat = SunVector({ ...SunDefaults("daylight"), On: true, Elevation: 0, Swing: 0 }, 0);
    assert.ok(Math.abs(Flat.Direction[1]) < 1e-6, `horizon sun points at ${Flat.Direction}`);
    const Quarter = SunVector({ ...SunDefaults("daylight"), On: true, Elevation: 0, Swing: 90 }, 0);
    assert.ok(Math.abs(Quarter.Direction[0] - 1) < 1e-6, `a quarter turn points at ${Quarter.Direction}`);
    // The environment's own rotation turns the sun with the sky, so a rotated sky is lit from where it looks lit.
    const Turned = SunVector({ ...SunDefaults("daylight"), On: true, Elevation: 0, Swing: 0 }, 90);
    assert.ok(Math.abs(Turned.Direction[0] - Quarter.Direction[0]) < 1e-6, "rotation does not turn the sun");
    assert.ok(Quarter.Cosine > 0.99 && Quarter.Cosine < 1, `a two degree sun has cosine ${Quarter.Cosine}`);
});

//--------------------------------------------------------------------------------------------------------------------------
// The map.
//--------------------------------------------------------------------------------------------------------------------------
test("every sky generates, and generates something", () =>
{
    for (const Entry of EnvironmentOrdering)
    {
        const Map_ = Sky(Entry.Identifier);
        assert.equal(Map_.Width, Map_.Height * 2, `${Entry.Identifier} is not two to one`);
        assert.equal(Map_.Values.length, Map_.Width * Map_.Height * 3);
        for (let Index = 0; Index < Map_.Values.length; Index += 1)
        {
            assert.ok(Number.isFinite(Map_.Values[Index]), `${Entry.Identifier} has a value that is not a number`);
            assert.ok(Map_.Values[Index] >= 0, `${Entry.Identifier} has negative light`);
        }
        assert.ok(Mean(Map_.Values) > 0.002, `${Entry.Identifier} came out black`);
        assert.equal(Map_.Harmonics.length, 27, `${Entry.Identifier} has ${Map_.Harmonics.length / 3} coefficients`);
    }
});

test("row zero is the ceiling and the last row is the floor", () =>
{
    const Up = TexelDirection(0, 0, 64, 32);
    const Down = TexelDirection(0, 31, 64, 32);
    assert.ok(Up[1] > 0.99, `the first row points at ${Up}`);
    assert.ok(Down[1] < -0.99, `the last row points at ${Down}`);
    // The shader finds a texel with acos(y)/π and atan(x,z)/2π; every direction the map was built from has to come
    // back to the texel it was built for, or the sky is lit from one side and reflected from the other.
    const Apart = (Difference) =>
    {
        const Round = ((Difference % 64) + 64) % 64;
        return Math.min(Round, 64 - Round);
    };
    for (const [Column, Row] of [[0, 0], [17, 9], [63, 31], [40, 20], [5, 27], [0, 16], [63, 1]])
    {
        const Direction = TexelDirection(Column, Row, 64, 32);
        const U = (Math.atan2(Direction[0], Direction[2]) / (2 * Math.PI) + 0.5) * 64 - 0.5;
        const V = (Math.acos(Math.max(-1, Math.min(1, Direction[1]))) / Math.PI) * 32 - 0.5;
        assert.ok(Math.abs(V - Row) < 1e-3, `row ${Row} came back as ${V}`);
        // The two polar rows are a ring of texels all pointing at the same place, so which column they come back as
        // is meaningless there and only there.
        if (Row === 0 || Row === 31) continue;
        assert.ok(Apart(U - Column) < 1e-3, `column ${Column} came back as ${U}`);
    }
});

test("the encoding survives the round trip it was designed for", () =>
{
    const Map_ = Sky("sunset");
    const Bytes = Map_.Levels[0].Bytes;
    let Worst = 0;
    for (let Texel_ = 0; Texel_ < Map_.Width * Map_.Height; Texel_ += 1)
        for (let Part = 0; Part < 3; Part += 1)
        {
            const Stored = Bytes[Texel_ * 4 + Part] / 255;
            const Back = Stored * Stored * Map_.Scale;
            const Wanted = Math.min(Map_.Values[Texel_ * 3 + Part], Map_.Scale);
            Worst = Math.max(Worst, Math.abs(Back - Wanted) / Math.max(0.05, Wanted));
        }
    assert.ok(Worst < 0.09, `the worst texel is ${(Worst * 100).toFixed(1)}% out`);
    assert.ok(Bytes.every((Part, Index) => Index % 4 !== 3 || Part === 255), "the map is not opaque");
});

test("the blurrier copies hold the same light as the sharp one", () =>
{
    for (const Identifier of ["studio", "daylight", "nebula"])
    {
        const Map_ = Sky(Identifier, null, 64);
        assert.ok(Map_.Levels.length >= 5, `${Identifier} has only ${Map_.Levels.length} levels`);
        let Across = Map_.Width;
        for (const [Index, Level] of Map_.Levels.entries())
        {
            assert.equal(Level.Width, Across, `level ${Index} of ${Identifier} is ${Level.Width} across`);
            assert.equal(Level.Height, Math.max(2, Map_.Height >> Index), `level ${Index} of ${Identifier} is ${Level.Height} down`);
            assert.equal(Level.Bytes.length, Level.Width * Level.Height * 4);
            Across = Math.max(4, Across >> 1);
        }
        // 🔴 Measured in radiance, not in bytes. The encoding is a square root, so the average of the stored values
        //    would agree even if every blurred level had been darkened — which is exactly the bug being looked for.
        const Light = (Level) =>
        {
            let Sum = 0;
            for (let Index = 0; Index < Level.Width * Level.Height; Index += 1)
                for (let Part = 0; Part < 3; Part += 1)
                {
                    const Stored = Level.Bytes[Index * 4 + Part] / 255;
                    Sum += Stored * Stored * Map_.Scale;
                }
            return Sum / (Level.Width * Level.Height * 3);
        };
        const Sharp = Light(Map_.Levels[0]);
        for (const [Index, Level] of Map_.Levels.entries())
        {
            const Held = Light(Level);
            assert.ok(
                Math.abs(Held - Sharp) / Sharp < 0.05,
                `${Identifier} level ${Index} holds ${((Held / Sharp) * 100).toFixed(0)}% of the light level zero does`,
            );
        }
    }
});

test("the ground is under the sky and the sky is over the ground", () =>
{
    for (const Identifier of ["daylight", "sunset", "forest", "cityglow"])
    {
        const Map_ = Sky(Identifier);
        const Row = (Index) =>
        {
            let Sum = 0;
            for (let Column = 0; Column < Map_.Width; Column += 1) Sum += Luminance(Texel(Map_, Column, Index));
            return Sum / Map_.Width;
        };
        assert.ok(Row(1) > Row(Map_.Height - 2), `${Identifier} is brighter underfoot than overhead`);
    }
});

//--------------------------------------------------------------------------------------------------------------------------
// The sun and the map, together. This is the contract the shader depends on.
//--------------------------------------------------------------------------------------------------------------------------
test("the sun's disc is never written into the map", () =>
{
    const Base = { ...SunDefaults("daylight"), On: true, Strength: 20, Elevation: 25, Swing: 0 };
    const Peak = (Map_) =>
    {
        let Most = 0;
        for (let Index = 0; Index < Map_.Values.length; Index += 1) Most = Math.max(Most, Map_.Values[Index]);
        return Most;
    };
    const Pin = Peak(Sky("daylight", { ...Base, Size: 0.5 }));
    const Wide = Peak(Sky("daylight", { ...Base, Size: 8 }));
    const Disc = Math.max(...SunVector({ ...Base, Size: 0.5 }, 0).Disc);
    const Direct = Math.max(...SunVector({ ...Base, Size: 0.5 }, 0).Radiance);
    assert.ok(Direct > 15, `a strength of twenty throws only ${Direct.toFixed(1)}`);
    // 🔴 A sun sixteen times narrower is a disc two hundred and fifty times brighter, and if that disc were in the
    //    map the brightest texel would move with it. It does not: the map holds the glow, which is nearly the same
    //    light whatever size the sun is, and the disc is drawn in the shader. Baking it would light the model twice
    //    — once from the map and once from the direct light the same sun already is.
    assert.ok(Pin < Disc * 0.1, `the map peaks at ${Pin.toFixed(1)} against a disc of ${Disc.toFixed(0)}`);
    assert.ok(Pin <= Direct, `the sky is brighter (${Pin.toFixed(1)}) than the sun lighting it (${Direct.toFixed(1)})`);
    // A wider sun scatters more, so its glow is allowed to be brighter — what it is not allowed to be is a disc,
    // and a disc gets brighter as it narrows. These two run the other way round, which is the whole point.
    assert.ok(Wide > Pin, `a pinhole sun glows harder (${Pin.toFixed(1)}) than a wide one (${Wide.toFixed(1)})`);
    assert.ok(Pin > Peak(Sky("daylight", { ...Base, Size: 0.5, On: false })), "switching the sun on changed nothing in the sky");
});

test("the sun pulls the sky towards it", () =>
{
    const Sun = { ...SunDefaults("daylight"), On: true, Elevation: 12, Swing: 0, Strength: 8, Size: 4 };
    const Lit = Sky("daylight", Sun);
    const Dark = Sky("daylight", { ...Sun, On: false });
    const Direction = SunVector(Sun, 0).Direction;
    const Near = SkyRadiance(EnvironmentByIdentifier.daylight.Sky, Direction, { ...Sun, Direction });
    const Away = SkyRadiance(EnvironmentByIdentifier.daylight.Sky, [-Direction[0], Direction[1], -Direction[2]], { ...Sun, Direction });
    assert.ok(Luminance(Near) > Luminance(Away) * 1.5, `towards ${Luminance(Near).toFixed(2)}, away ${Luminance(Away).toFixed(2)}`);
    assert.ok(Mean(Lit.Values) > Mean(Dark.Values), "a lit sky is no brighter than an unlit one");
});

test("the nine coefficients describe the sky the texels do", () =>
{
    for (const Identifier of ["studio", "overcast", "sunset"])
    {
        const Map_ = Sky(Identifier, null, 32);
        const Up = EvaluateHarmonics(Map_.Harmonics, [0, 1, 0]);
        const Down = EvaluateHarmonics(Map_.Harmonics, [0, -1, 0]);
        assert.ok(Up.every((Part) => Part >= 0) && Down.every((Part) => Part >= 0), `${Identifier} has negative irradiance`);
        assert.ok(Luminance(Up) > Luminance(Down), `${Identifier} is brighter from below`);
        // Against the long way round: the cosine-weighted average of every texel over a hemisphere, which is what
        // the coefficients are a nine-number summary of.
        let Sum = [0, 0, 0];
        let Weight = 0;
        for (let Row = 0; Row < Map_.Height; Row += 1)
            for (let Column = 0; Column < Map_.Width; Column += 1)
            {
                const Direction = TexelDirection(Column, Row, Map_.Width, Map_.Height);
                const Cosine = Direction[1];
                if (Cosine <= 0) continue;
                const Solid = Math.sin(((Row + 0.5) / Map_.Height) * Math.PI);
                const Colour = Texel(Map_, Column, Row);
                for (let Part = 0; Part < 3; Part += 1) Sum[Part] += Colour[Part] * Cosine * Solid;
                Weight += Cosine * Solid;
            }
        const Honest = Sum.map((Part) => Part / Math.max(Weight, 1e-6));
        const Ratio = Luminance(Up) / Math.max(Luminance(Honest), 1e-6);
        assert.ok(Ratio > 0.6 && Ratio < 1.7, `${Identifier} harmonics read ${Ratio.toFixed(2)}× the texels`);
    }
});

//--------------------------------------------------------------------------------------------------------------------------
// The tile in the pod, and the project that keeps the whole thing.
//--------------------------------------------------------------------------------------------------------------------------
test("a preview is a picture, and the sun is in it", () =>
{
    const Sun = { ...SunDefaults("daylight"), On: true, Elevation: 30, Swing: 0, Strength: 6, Size: 8 };
    const Picture = PreviewImage("daylight", Sun, 64, 32, 0);
    assert.equal(Picture.Pixels.length, 64 * 32 * 4);
    assert.ok(Picture.Pixels.every((Part, Index) => Index % 4 !== 3 || Part === 255), "the preview is not opaque");
    let Brightest = { Value: -1, Column: 0, Row: 0 };
    for (let Row = 0; Row < 32; Row += 1)
        for (let Column = 0; Column < 64; Column += 1)
        {
            const At = (Row * 64 + Column) * 4;
            const Value = Picture.Pixels[At] + Picture.Pixels[At + 1] + Picture.Pixels[At + 2];
            if (Value > Brightest.Value) Brightest = { Value, Column, Row };
        }
    // Swing nought looks down +Z, which atan2 puts at the middle column; elevation 30 is a third of the way down.
    assert.ok(Math.abs(Brightest.Column - 32) <= 3, `the sun is at column ${Brightest.Column}`);
    assert.ok(Math.abs(Brightest.Row - 32 / 3) <= 3, `the sun is at row ${Brightest.Row}`);
    const Dim = PreviewImage("daylight", Sun, 64, 32, -3);
    assert.ok(Mean(Dim.Pixels) < Mean(Picture.Pixels), "exposure does nothing to the preview");
});

test("a project carries a sun and repairs a broken one", () =>
{
    const Project = DefaultProject();
    assert.ok(Project.Environment.Sun, "a new project has no sun");
    assert.deepEqual(Project.Environment.Sun, SunDefaults(Project.Environment.Identifier));
    const Repaired = SanitiseProject({
        ...Project,
        Environment: { ...Project.Environment, Identifier: "sunset", Sun: { On: 1, Elevation: "low" } },
    });
    assert.equal(Repaired.Environment.Sun.On, true);
    assert.ok(Number.isFinite(Repaired.Environment.Sun.Elevation), "a broken elevation survived");
    assert.equal(Repaired.Environment.Sun.Warmth, SunDefaults("sunset").Warmth);
});
