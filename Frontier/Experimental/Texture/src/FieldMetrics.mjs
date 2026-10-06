//============================================================================================================================================
// 🧪 FieldMetrics.mjs — what the surface measures to, and what a stack of generators makes of it
//============================================================================================================================================
// The readings are the half of the generator catalogue that can actually be wrong without looking wrong: a curvature
// that answers a different number at a different subdivision, a thickness that calls a solid ball foil, a selection
// that quietly covers the whole sheet. Every check here is against a shape whose answer is known before it is asked.
//============================================================================================================================================

import test from "node:test";
import assert from "node:assert/strict";

import { BuildSurface, SurfaceIndex, BakeOcclusion } from "./SurfaceStructure.js";
import { AssembleScene, CreateObject } from "./SceneStructure.js";
import { MeasureCurvature, MeasureThickness, MeasureIslands, MeasureSurface, SheetSize } from "./SurfaceSolver.js";
import {
    Combine,
    CombineModes,
    DefaultEntry,
    Levels,
    MissingMeasurements,
    NormaliseEntry,
    SheetImage,
    SolveMask,
} from "./MaskSolver.js";
import { GeneratorOrdering, GeneratorNeedsSurface, GeneratorFamily, VertexMaps } from "./GeneratorSpecification.js";

const Mean = (List) => [...List].reduce((Sum, Value) => Sum + Value, 0) / (List.length || 1);
const Lowest = (List) => [...List].reduce((Low, Value) => Math.min(Low, Value), Infinity);
const Highest = (List) => [...List].reduce((High, Value) => Math.max(High, Value), -Infinity);

//--------------------------------------------------------------------------------------------------------------------------
// Curvature.
//--------------------------------------------------------------------------------------------------------------------------
test("a sphere answers the same curvature however finely it is divided", () =>
{
    const Readings = [0, 1, 2].map((Detail) => Mean(MeasureCurvature(BuildSurface("sphere", Detail))));
    // 🔴 The whole point of scaling by the model's radius. Divide by the neighbour distance only, and the number
    //    halves every time the mesh is subdivided — a generator whose strength depends on the tessellation.
    for (const Reading of Readings) assert.ok(Math.abs(Reading - Readings[0]) < 0.01, `${Readings.join(" ")}`);
    assert.ok(Readings[0] < -0.3 && Readings[0] > -0.6, String(Readings[0]));
});

test("a sphere is convex everywhere and a plane is curved nowhere", () =>
{
    const Ball = MeasureCurvature(BuildSurface("sphere", 1));
    assert.ok(Highest(Ball) < 0, "no part of a sphere turns inwards");
    const Flat = MeasureCurvature(BuildSurface("plane", 1));
    assert.ok(Math.abs(Mean(Flat)) < 1e-6 && Math.abs(Highest(Flat)) < 1e-6);
});

test("the bevels of a cube saturate, and there are more of them the finer it gets", () =>
{
    const Counts = [0, 1, 2].map((Detail) => [...MeasureCurvature(BuildSurface("cube", Detail))].filter((Value) => Value < -0.7).length);
    assert.ok(Counts[0] > 0, "a cube with no sharp vertex at all is not a cube");
    assert.ok(Counts[2] > Counts[1] && Counts[1] > Counts[0], Counts.join(" "));
    // The faces between them stay flat, which is what makes an edge mask an edge mask.
    const Bend = [...MeasureCurvature(BuildSurface("cube", 2))];
    assert.ok(Bend.filter((Value) => Math.abs(Value) < 0.05).length > Bend.length * 0.2, "a cube is mostly flat");
});

test("curvature welds by position, because flat shading duplicates every corner", () =>
{
    // A cube's corners are duplicated once per face. Read through the index buffer alone and each copy has no
    // neighbours but its own face, so the sharpest part of the shape reads as the flattest.
    const Surface = BuildSurface("cube", 1);
    const Bend = MeasureCurvature(Surface);
    assert.equal(Bend.length, Surface.Positions.length / 3);
    assert.ok(Lowest(Bend) <= -0.99, String(Lowest(Bend)));
});

//--------------------------------------------------------------------------------------------------------------------------
// Thickness.
//--------------------------------------------------------------------------------------------------------------------------
test("a solid ball is not foil, and a tube is thinner than the ball around it", () =>
{
    const Ball = BuildSurface("sphere", 1);
    const Solid = MeasureThickness(Ball, new SurfaceIndex(Ball), 10);
    assert.ok(Mean(Solid) > 0.25, `a solid sphere read ${Mean(Solid).toFixed(3)} thick`);
    const Ring = BuildSurface("torus", 1);
    const Tube = MeasureThickness(Ring, new SurfaceIndex(Ring), 10);
    assert.ok(Mean(Tube) < Mean(Solid), `${Mean(Tube).toFixed(3)} vs ${Mean(Solid).toFixed(3)}`);
});

test("a surface with nothing behind it reads as solid rather than as paper", () =>
{
    const Sheet = BuildSurface("plane", 1);
    const Open = MeasureThickness(Sheet, new SurfaceIndex(Sheet), 8);
    assert.ok(Mean(Open) > 0.99, String(Mean(Open)));
});

//--------------------------------------------------------------------------------------------------------------------------
// Islands, tiles and owners.
//--------------------------------------------------------------------------------------------------------------------------
test("a cube is six UV islands and a sphere is one", () =>
{
    assert.equal(MeasureIslands(BuildSurface("cube", 1)).Count, 6);
    assert.equal(MeasureIslands(BuildSurface("sphere", 1)).Count, 1);
    assert.equal(MeasureIslands(BuildSurface("plane", 1)).Count, 1);
});

test("a measured scene knows which object, tile and island every texel came from", () =>
{
    const Surface = AssembleScene([
        CreateObject({ Identifier: "block", Name: "Block", Kind: "cube", Subdivision: 1, Tile: 1001 }),
        CreateObject({ Identifier: "ball", Name: "Ball", Kind: "sphere", Subdivision: 1, Tile: 1002, Offset: [1.3, 0, 0] }),
    ]);
    const Sheets = MeasureSurface(Surface, { Size: 128 });
    assert.equal(Sheets.Size, 128);
    assert.deepEqual(Sheets.Tiles, [1001, 1002]);
    assert.deepEqual(
        Sheets.Owners.map((Owner) => Owner.Name),
        ["Block", "Ball"],
    );
    assert.equal(Sheets.Islands, 7, "six faces and a ball");
    const Filled = [...Sheets.Filled].filter(Boolean).length;
    assert.ok(Filled > 1000 && Filled < 128 * 128, `${Filled} texels filled`);
    // Nothing may be claimed by an object that is not there, and nothing filled may be owned by nobody.
    for (let Texel = 0; Texel < Sheets.Filled.length; Texel += 1)
    {
        if (!Sheets.Filled[Texel]) continue;
        assert.ok(Sheets.Owner[Texel] === 0 || Sheets.Owner[Texel] === 1, String(Sheets.Owner[Texel]));
        assert.ok(Sheets.Face[Texel] >= 0 && Sheets.Face[Texel] < Sheets.Triangles);
    }
});

test("the two objects do not land on each other, because they are on different tiles", () =>
{
    const Surface = AssembleScene([
        CreateObject({ Identifier: "block", Name: "Block", Kind: "cube", Subdivision: 1, Tile: 1001 }),
        CreateObject({ Identifier: "ball", Name: "Ball", Kind: "sphere", Subdivision: 1, Tile: 1002, Offset: [1.3, 0, 0] }),
    ]);
    const Sheets = MeasureSurface(Surface, { Size: 128 });
    const Block = [...Sheets.Owner].filter((Owner) => Owner === 0).length;
    const Ball = [...Sheets.Owner].filter((Owner) => Owner === 1).length;
    assert.ok(Block > 500 && Ball > 500, `${Block} / ${Ball}`);
});

test("the sheet size is clamped to something a processor can solve", () =>
{
    assert.equal(SheetSize(0), 64);
    assert.equal(SheetSize(1e6), 1024);
    assert.equal(SheetSize(), 512);
});

//--------------------------------------------------------------------------------------------------------------------------
// The stack.
//--------------------------------------------------------------------------------------------------------------------------
test("an empty stack is white, because a mask shaped by nothing is unshaped", () =>
{
    const Solved = SolveMask([], null, { Size: 32 });
    assert.equal(Solved.Entries, 0);
    assert.ok([...Solved.Values].every((Value) => Value === 1));
});

test("every generator in the catalogue solves to a number between nought and one", () =>
{
    const Surface = BuildSurface("cube", 1);
    const Index = new SurfaceIndex(Surface);
    BakeOcclusion(Surface, Index, 6);
    const Sheets = MeasureSurface(Surface, { Size: 48, Thickness: MeasureThickness(Surface, Index, 4) });
    for (const Entry of GeneratorOrdering)
    {
        const Solved = SolveMask([DefaultEntry(Entry.Identifier, { Combine: "overwrite", Marks: [0, 1, 2] })], Sheets, { Size: 48 });
        assert.ok(
            [...Solved.Values].every((Value) => Number.isFinite(Value) && Value >= 0 && Value <= 1),
            `${Entry.Identifier} left the range`,
        );
    }
});

test("a reading that needs the model says so when there is no model measured", () =>
{
    const Needing = GeneratorOrdering.filter((Entry) => GeneratorNeedsSurface(Entry.Identifier));
    assert.ok(Needing.length >= 15, String(Needing.length));
    assert.ok(GeneratorOrdering.filter((Entry) => GeneratorFamily(Entry.Identifier) === "noise").every((Entry) => !GeneratorNeedsSurface(Entry.Identifier)));
    const Wanted = MissingMeasurements([DefaultEntry("dust"), DefaultEntry("fbm")], null);
    assert.deepEqual(Wanted, ["Dust"]);
    assert.deepEqual(MissingMeasurements([DefaultEntry("dust")], { Size: 8 }), [], "measured means nothing is missing");
});

test("a weight fades an entry towards what is neutral for its mode, not towards black", () =>
{
    const Sheets = null;
    for (const Mode of CombineModes)
    {
        const Entries = [
            DefaultEntry("checker", { Combine: "overwrite" }),
            DefaultEntry("fbm", { Combine: Mode.Identifier, Weight: 0 }),
        ];
        const Solved = SolveMask(Entries, Sheets, { Size: 24 });
        const Alone = SolveMask([Entries[0]], Sheets, { Size: 24 });
        const Drift = Math.max(...[...Solved.Values].map((Value, Index) => Math.abs(Value - Alone.Values[Index])));
        assert.ok(Drift < 1e-6, `${Mode.Identifier} moved the stack by ${Drift}`);
    }
});

test("the combine modes are the layer list's, by the same names", () =>
{
    assert.equal(Combine("multiply", 0.5, 0.5), 0.25);
    assert.equal(Combine("add", 0.5, 0.25), 0.75);
    assert.equal(Combine("subtract", 0.5, 0.25), 0.25);
    assert.equal(Combine("max", 0.2, 0.7), 0.7);
    assert.equal(Combine("min", 0.2, 0.7), 0.2);
    assert.ok(Math.abs(Combine("screen", 0.5, 0.5) - 0.75) < 1e-9);
    assert.equal(Combine("overwrite", 0.2, 0.7), 0.7);
    assert.equal(Combine("nonsense", 0.2, 0.7), 0.7, "an unknown mode replaces rather than throwing");
});

test("levels hold their ends, and a descending window does not paint everything", () =>
{
    assert.equal(Levels(0, 0.5, 0), 0);
    assert.equal(Levels(1, 0.5, 0), 1);
    assert.ok(Levels(0.5, 0.5, 0.9) > 0.4 && Levels(0.5, 0.5, 0.9) < 0.6);
    // 🔴 The bug this is here for: a smoothstep written as (V - E0) / max(1e-6, E1 - E0) clamps to one for every
    //    descending range, so a generator with its balance high painted the entire sheet solid.
    assert.ok(Levels(0.05, 0.95, 1) < 0.5, String(Levels(0.05, 0.95, 1)));
});

test("a selection covers what it names and nothing else", () =>
{
    const Surface = AssembleScene([
        CreateObject({ Identifier: "block", Name: "Block", Kind: "cube", Subdivision: 1, Tile: 1001 }),
        CreateObject({ Identifier: "ball", Name: "Ball", Kind: "sphere", Subdivision: 1, Tile: 1002, Offset: [1.3, 0, 0] }),
    ]);
    const Sheets = MeasureSurface(Surface, { Size: 96 });
    const Pick = (Overrides) => SolveMask([DefaultEntry(Overrides.Kind, { ...Overrides, Combine: "overwrite" })], Sheets, { Size: 96 });

    const Ball = Pick({ Kind: "object", Choice: "1" });
    for (let Texel = 0; Texel < Ball.Values.length; Texel += 1)
        assert.equal(Ball.Values[Texel], Sheets.Owner[Texel] === 1 && Sheets.Filled[Texel] ? 1 : 0);

    const Tile = Pick({ Kind: "tile", Choice: "1002" });
    assert.ok(Mean(Tile.Values) > 0.05, "a tile that selects nothing is a tile nobody can use");
    const Island = Pick({ Kind: "island", Choice: "0" });
    assert.ok(Mean(Island.Values) > 0 && Mean(Island.Values) < 0.3, String(Mean(Island.Values)));

    const Faces = Pick({ Kind: "faces", Marks: [...new Set([...Sheets.Face].filter((Face) => Face >= 0))].slice(0, 20) });
    assert.ok(Mean(Faces.Values) > 0 && Mean(Faces.Values) < 0.2, String(Mean(Faces.Values)));
    assert.ok(Pick({ Kind: "faces", Marks: [] }).Values.every((Value) => Value === 0), "picking nothing selects nothing");
});

test("a vertex map can be promoted to a mask", () =>
{
    const Surface = BuildSurface("sphere", 1);
    const Index = new SurfaceIndex(Surface);
    BakeOcclusion(Surface, Index, 6);
    const Sheets = MeasureSurface(Surface, { Size: 64, Thickness: MeasureThickness(Surface, Index, 4) });
    for (const Map of VertexMaps)
    {
        const Solved = SolveMask([DefaultEntry("vertex", { Choice: Map.Identifier, Combine: "overwrite" })], Sheets, { Size: 64 });
        assert.ok([...Solved.Values].every((Value) => Value >= 0 && Value <= 1), Map.Identifier);
    }
});

test("the weathering recipes land where their story says they do", () =>
{
    const Surface = BuildSurface("cube", 2);
    const Index = new SurfaceIndex(Surface);
    BakeOcclusion(Surface, Index, 10);
    const Sheets = MeasureSurface(Surface, { Size: 128, Thickness: MeasureThickness(Surface, Index, 6) });
    const Solve = (Kind) => SolveMask([DefaultEntry(Kind, { Combine: "overwrite" })], Sheets, { Size: 128 });

    // Dust is on what faces up. Measured against the sheet's own record of which way each texel points.
    const Dust = Solve("dust");
    let Up = 0;
    let Down = 0;
    let Upward = 0;
    let Downward = 0;
    for (let Texel = 0; Texel < Dust.Values.length; Texel += 1)
    {
        if (!Sheets.Filled[Texel]) continue;
        const Facing = Sheets.Normal[Texel * 3 + 1];
        if (Facing > 0.7) { Up += Dust.Values[Texel]; Upward += 1; }
        if (Facing < -0.7) { Down += Dust.Values[Texel]; Downward += 1; }
    }
    assert.ok(Upward > 50 && Downward > 50, `${Upward} up, ${Downward} down`);
    assert.ok(Up / Upward > (Down / Downward) * 4 + 0.05, `dust: ${(Up / Upward).toFixed(3)} up vs ${(Down / Downward).toFixed(3)} down`);

    // Wear is on the edges. Measured against curvature, which is the thing it is supposed to be built from.
    const Wear = Solve("wear");
    let Sharp = 0;
    let Sharps = 0;
    let Flat = 0;
    let Flats = 0;
    for (let Texel = 0; Texel < Wear.Values.length; Texel += 1)
    {
        if (!Sheets.Filled[Texel]) continue;
        if (Sheets.Curvature[Texel] < -0.6) { Sharp += Wear.Values[Texel]; Sharps += 1; }
        if (Math.abs(Sheets.Curvature[Texel]) < 0.05) { Flat += Wear.Values[Texel]; Flats += 1; }
    }
    assert.ok(Sharps > 20 && Flats > 20, `${Sharps} sharp, ${Flats} flat`);
    assert.ok(Sharp / Sharps > Flat / Flats + 0.05, `wear: ${(Sharp / Sharps).toFixed(3)} sharp vs ${(Flat / Flats).toFixed(3)} flat`);

    // And none of the four may be one flat value, which is what every one of them was at least once on the way here.
    for (const Kind of ["dust", "grime", "wear", "drips"])
    {
        const Values = [...Solve(Kind).Values];
        const Steps = new Set(Values.map((Value) => Math.round(Value * 24)));
        assert.ok(Steps.size > 2, `${Kind} solved to ${Steps.size} distinct value(s)`);
        assert.ok(Mean(Values) < 0.75, `${Kind} covered the whole sheet`);
    }
});

test("an entry survives being normalised out of nonsense", () =>
{
    const Entry = NormaliseEntry({ Kind: "wreckage", Combine: "sideways", Weight: 12, Marks: ["3", -1, 7.4, "x"], Enabled: 0 });
    assert.equal(Entry.Kind, "fbm");
    assert.equal(Entry.Combine, "multiply");
    assert.equal(Entry.Weight, 1);
    assert.ok(Entry.Enabled === true, "only a literal false hides an entry");
    assert.deepEqual(Entry.Marks, [3, 7]);
    assert.ok(Entry.Identifier && Entry.Label);
    assert.notEqual(NormaliseEntry({}).Identifier, NormaliseEntry({}).Identifier, "two entries are never the same entry");
});

test("the solved sheet goes to the device as one byte a channel", () =>
{
    const Solved = SolveMask([DefaultEntry("gradient", { Combine: "overwrite" })], null, { Size: 16 });
    const Pixels = SheetImage(Solved);
    assert.equal(Pixels.length, 16 * 16 * 4);
    for (let Texel = 0; Texel < 16 * 16; Texel += 1)
    {
        const Value = Math.round(Solved.Values[Texel] * 255);
        // Red for the shader, alpha for anything that reads a mask the way a painted one is read.
        assert.equal(Pixels[Texel * 4], Value);
        assert.equal(Pixels[Texel * 4 + 3], Value);
    }
});
