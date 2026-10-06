//============================================================================================================================================
// 🧪 ReadingMetrics.mjs — the bake: what is asked, how finely, and whether the answers mean anything
//============================================================================================================================================
// A bake is the one operation in a painting tool whose output nobody checks until it is too late, so it is checked
// here: that every filter spends all the samples it was given, that a negative lobe survives into the kernel, that a
// map of a known shape has the values that shape should produce, and that padding reaches past the island it came from.
//============================================================================================================================================

import test from "node:test";
import assert from "node:assert/strict";

import { BuildSurface, SurfaceIndex } from "./SurfaceStructure.js";
import { AssembleScene, CreateObject } from "./SceneStructure.js";
import {
    FilterKinds,
    FilterWeight,
    IdentityKinds,
    ReadingDefaults,
    ReadingEstimate,
    ReadingFamilies,
    ReadingOrdering,
    SampleCounts,
    SampleOffsets,
    SanitiseReading,
} from "./ReadingSpecification.js";
import { Dilate, IdentityColour, IdentityImage, SolveReadings } from "./ReadingSolver.js";
import { MeasureBentNormals, MeasureBevelNormals, MeasureSurface, MeasureVisibility } from "./SurfaceSolver.js";

const Scene = () =>
    AssembleScene([
        CreateObject({ Identifier: "block", Name: "Block", Kind: "cube", Subdivision: 1, Tile: 1001 }),
        CreateObject({ Identifier: "ball", Name: "Ball", Kind: "sphere", Subdivision: 1, Scale: 0.6, Tile: 1002, Offset: [1.3, 0.6, 0] }),
    ]);

//--------------------------------------------------------------------------------------------------------------------------
// The catalogue.
//--------------------------------------------------------------------------------------------------------------------------
test("every map belongs to a family, carries a mark and says where it came from", () =>
{
    const Families = new Set(ReadingFamilies.map((Family) => Family.Identifier));
    const Seen = new Set();
    for (const Entry of ReadingOrdering)
    {
        assert.ok(!Seen.has(Entry.Identifier), `${Entry.Identifier} is in the catalogue twice`);
        Seen.add(Entry.Identifier);
        assert.ok(Families.has(Entry.Family), `${Entry.Identifier} belongs to no family`);
        assert.ok(Entry.Glyph && Entry.Label && Entry.Short && Entry.Hint, Entry.Identifier);
        assert.ok(/Substance|Unreal|Blender/.test(Entry.Heritage), `${Entry.Identifier} claims no heritage`);
        assert.ok(Entry.Channels === 1 || Entry.Channels === 3, Entry.Identifier);
    }
    assert.ok(ReadingOrdering.length >= 14, String(ReadingOrdering.length));
    // The three that make this worth building at all.
    for (const Name of ["normal", "bent", "bevel"]) assert.ok(Seen.has(Name), `no ${Name}`);
});

test("an order survives nonsense and keeps what it can", () =>
{
    const Order = SanitiseReading({ Size: "nonsense", Samples: 5, Filter: "smudge", Space: "sideways", Width: 99, Rays: 0, Padding: -4, Wanted: ["curvature", "nonsense"] });
    const Default = ReadingDefaults();
    assert.equal(Order.Size, Default.Size);
    assert.equal(Order.Samples, Default.Samples);
    assert.equal(Order.Filter, Default.Filter);
    assert.equal(Order.Space, Default.Space);
    assert.equal(Order.Width, 0.3);
    assert.equal(Order.Rays, 4);
    assert.equal(Order.Padding, 0);
    assert.deepEqual(Order.Wanted, ["curvature"]);
});

//--------------------------------------------------------------------------------------------------------------------------
// Antialiasing.
//--------------------------------------------------------------------------------------------------------------------------
test("every filter spends every sample it is given", () =>
{
    for (const Filter of FilterKinds)
        for (const Count of SampleCounts)
        {
            const Offsets = SampleOffsets(Count.Value, Filter.Identifier);
            assert.equal(Offsets.length, Count.Value, `${Filter.Identifier} at ${Count.Value} kept ${Offsets.length}`);
            const Total = Offsets.reduce((Sum, Offset) => Sum + Offset.Weight, 0);
            assert.ok(Math.abs(Total - 1) < 1e-9, `${Filter.Identifier} weights sum to ${Total}`);
        }
});

test("a box stays inside its texel and the wide kernels reach past it", () =>
{
    const Reach = (Filter) => Math.max(...SampleOffsets(16, Filter).map((Offset) => Math.hypot(Offset.X, Offset.Y)));
    assert.ok(Reach("box") <= 0.71, String(Reach("box")));
    for (const Filter of ["tent", "gaussian", "mitchell", "catmull", "blackman"])
        assert.ok(Reach(Filter) > 0.75, `${Filter} reaches only ${Reach(Filter)}`);
});

test("Catmull-Rom keeps its negative lobe, because that is what makes an edge look sharp", () =>
{
    const Lowest = (Filter) => Math.min(...SampleOffsets(36, Filter).map((Offset) => Offset.Weight));
    assert.ok(Lowest("catmull") < 0, String(Lowest("catmull")));
    assert.ok(Lowest("mitchell") < 0, String(Lowest("mitchell")));
    for (const Filter of ["box", "tent", "gaussian", "blackman"]) assert.ok(Lowest(Filter) >= 0, Filter);
});

test("a filter is heaviest in the middle and nothing at all past its radius", () =>
{
    for (const Filter of FilterKinds)
    {
        assert.ok(FilterWeight(Filter.Identifier, 0, 0) > 0, Filter.Identifier);
        assert.equal(FilterWeight(Filter.Identifier, Filter.Radius + 0.01, 0), 0, Filter.Identifier);
        if (Filter.Identifier === "box") continue;
        assert.ok(
            FilterWeight(Filter.Identifier, 0, 0) > FilterWeight(Filter.Identifier, Filter.Radius * 0.6, 0),
            `${Filter.Identifier} is not heaviest at its centre`,
        );
    }
});

test("one sample is one sample, whatever filter is on the dialog", () =>
{
    for (const Filter of FilterKinds)
    {
        const Offsets = SampleOffsets(1, Filter.Identifier);
        assert.deepEqual(Offsets, [{ X: 0, Y: 0, Weight: 1 }]);
    }
});

//--------------------------------------------------------------------------------------------------------------------------
// Bent and bevelled normals.
//--------------------------------------------------------------------------------------------------------------------------
test("a bent normal is a unit direction and leans away from what is above it", () =>
{
    const Surface = BuildSurface("sphere", 1);
    const Bent = MeasureBentNormals(Surface, new SurfaceIndex(Surface), 16);
    for (let Vertex = 0; Vertex < Bent.length / 3; Vertex += 1)
    {
        const Length = Math.hypot(Bent[Vertex * 3], Bent[Vertex * 3 + 1], Bent[Vertex * 3 + 2]);
        assert.ok(Math.abs(Length - 1) < 1e-4, `vertex ${Vertex} has length ${Length}`);
    }
    // A convex shape occludes nothing, so every bent normal is its own normal.
    let Worst = 0;
    for (let Vertex = 0; Vertex < Bent.length / 3; Vertex += 1)
    {
        const Dot =
            Bent[Vertex * 3] * Surface.Normals[Vertex * 3] +
            Bent[Vertex * 3 + 1] * Surface.Normals[Vertex * 3 + 1] +
            Bent[Vertex * 3 + 2] * Surface.Normals[Vertex * 3 + 2];
        Worst = Math.max(Worst, 1 - Dot);
    }
    assert.ok(Worst < 0.02, `a sphere bent its own normals by ${Worst}`);
});

test("a bent normal with nowhere to go keeps the normal it had", () =>
{
    const Surface = BuildSurface("cube", 0);
    const Bent = MeasureBentNormals(Surface, null, 8);
    assert.ok([...Bent].every(Number.isFinite), "a bent normal came back as a NaN");
    assert.deepEqual([...Bent].slice(0, 9), [...Surface.Normals].slice(0, 9));
});

test("a bevel rounds a hard rim and leaves a flat wall alone", () =>
{
    const Surface = BuildSurface("cylinder", 1);
    const Bevel = MeasureBevelNormals(Surface, 0.05);
    let Widest = 0;
    let Still = 0;
    for (let Vertex = 0; Vertex < Bevel.length / 3; Vertex += 1)
    {
        const Dot = Math.min(
            1,
            Bevel[Vertex * 3] * Surface.Normals[Vertex * 3] +
                Bevel[Vertex * 3 + 1] * Surface.Normals[Vertex * 3 + 1] +
                Bevel[Vertex * 3 + 2] * Surface.Normals[Vertex * 3 + 2],
        );
        Widest = Math.max(Widest, Math.acos(Dot));
        if (Dot > 0.999) Still += 1;
    }
    // A cylinder's cap meets its wall at a right angle, and the two average to forty-five degrees.
    assert.ok(Widest > 0.6 && Widest < 0.9, `the widest turn was ${((Widest * 180) / Math.PI).toFixed(1)} degrees`);
    assert.ok(Still > Bevel.length / 3 / 2, "a bevel moved more of the model than it left alone");
});

test("a wider bevel moves more of the model than a narrow one", () =>
{
    const Surface = BuildSurface("shaderball", 0);
    const Moved = (Width) =>
    {
        const Bevel = MeasureBevelNormals(Surface, Width);
        let Count = 0;
        for (let Vertex = 0; Vertex < Bevel.length / 3; Vertex += 1)
        {
            const Dot =
                Bevel[Vertex * 3] * Surface.Normals[Vertex * 3] +
                Bevel[Vertex * 3 + 1] * Surface.Normals[Vertex * 3 + 1] +
                Bevel[Vertex * 3 + 2] * Surface.Normals[Vertex * 3 + 2];
            if (Dot < 0.999) Count += 1;
        }
        return Count;
    };
    assert.ok(Moved(0.12) > Moved(0.02), "the bevel width does nothing");
});

//--------------------------------------------------------------------------------------------------------------------------
// The bake itself.
//--------------------------------------------------------------------------------------------------------------------------
test("every map in the catalogue bakes to an image of the right size", () =>
{
    const Surface = Scene();
    const Result = SolveReadings(Surface, new SurfaceIndex(Surface), {
        Size: 64,
        Samples: 4,
        Filter: "box",
        Rays: 6,
        Padding: 0,
        Wanted: ReadingOrdering.map((Entry) => Entry.Identifier),
    });
    assert.equal(Result.Maps.length, ReadingOrdering.length);
    for (const Map of Result.Maps)
    {
        assert.equal(Map.Size, 64);
        assert.equal(Map.Pixels.length, 64 * 64 * 4);
        assert.ok([...Map.Pixels].every((Byte) => Number.isFinite(Byte) && Byte >= 0 && Byte <= 255), Map.Identifier);
    }
    assert.equal(Result.Statistics.Objects, 2);
    assert.equal(Result.Statistics.Tiles, 2);
    assert.ok(Result.Statistics.Islands >= 7);
});

test("the bake answers what the shape is, not what it would like to be", () =>
{
    const Surface = Scene();
    const Result = SolveReadings(Surface, new SurfaceIndex(Surface), {
        Size: 96,
        Samples: 4,
        Filter: "gaussian",
        Space: "tangent",
        Rays: 10,
        Padding: 0,
        Wanted: ["normal", "bevel", "face", "occlusion", "height", "coverage", "identity", "coordinate"],
    });
    const Of = (Identifier) => Result.Maps.find((Map) => Map.Identifier === Identifier);
    const Mean = (Map, Channel) =>
    {
        let Sum = 0;
        let Count = 0;
        for (let Texel = 0; Texel < Map.Size ** 2; Texel += 1)
        {
            if (!Result.Coverage[Texel]) continue;
            Sum += Map.Pixels[Texel * 4 + Channel];
            Count += 1;
        }
        return Sum / Math.max(1, Count);
    };

    // 🔴 A tangent-space direction map stands on the FACE, so the flat normal is the one that comes out blue and
    //    the smooth one does not. Standing it on its own smooth normal makes all three of them a flat blue sheet.
    assert.ok(Mean(Of("face"), 2) > 250, `a face normal in its own frame read ${Mean(Of("face"), 2)}`);
    assert.ok(Mean(Of("normal"), 2) > 200 && Mean(Of("normal"), 2) < 253, `a smoothed normal read ${Mean(Of("normal"), 2)}`);
    assert.ok(Mean(Of("bevel"), 2) > 190, String(Mean(Of("bevel"), 2)));

    // Height runs the bounds from black to white, so its average is somewhere in the middle.
    assert.ok(Mean(Of("height"), 0) > 40 && Mean(Of("height"), 0) < 215);
    // Two objects on two tiles, so the identity map holds more than one colour and none of them is black.
    const Colours = new Set();
    for (let Texel = 0; Texel < 96 * 96; Texel += 1)
        if (Result.Coverage[Texel]) Colours.add(Of("identity").Pixels.slice(Texel * 4, Texel * 4 + 3).join(","));
    assert.ok(Colours.size >= 2, `the identity map holds ${Colours.size} colour(s)`);
    // Occlusion on a convex pair is mostly open, and the crease where they meet is not.
    assert.ok(Mean(Of("occlusion"), 0) > 150, String(Mean(Of("occlusion"), 0)));
});

test("antialiasing is the difference between a staircase and an edge", () =>
{
    const Surface = Scene();
    const Index = new SurfaceIndex(Surface);
    const Edge = (Samples, Filter) =>
    {
        const Result = SolveReadings(Surface, Index, { Size: 256, Samples, Filter, Padding: 0, Wanted: ["coverage"] });
        const Map = Result.Maps[0];
        let Between = 0;
        for (let Texel = 0; Texel < 256 * 256; Texel += 1)
        {
            const Value = Map.Pixels[Texel * 4];
            if (Value > 8 && Value < 247) Between += 1;
        }
        return Between;
    };
    // With one sample a texel is either on the island or off it. With sixteen, the rim of every island is a ramp.
    assert.equal(Edge(1, "box"), 0, "one sample produced a soft edge, which it cannot");
    assert.ok(Edge(16, "gaussian") > 50, String(Edge(16, "gaussian")));
    assert.ok(Edge(16, "gaussian") > Edge(4, "gaussian"), "more samples made no more edge");
});

test("padding reaches past the island and stops where it is told", () =>
{
    const Size = 32;
    const Coverage = new Uint8Array(Size * Size);
    const Pixels = new Uint8ClampedArray(Size * Size * 4);
    const Middle = 16 * Size + 16;
    Coverage[Middle] = 1;
    Pixels[Middle * 4] = 200;
    Pixels[Middle * 4 + 3] = 255;
    Dilate(Pixels, Coverage, Size, 2);
    const Lit = [...Coverage].map((Ignored, Texel) => Pixels[Texel * 4] > 0).filter(Boolean).length;
    // Two rings around one texel is a five by five block, less nothing: the corners fill on the second pass.
    assert.ok(Lit >= 9 && Lit <= 25, String(Lit));
    assert.equal(Pixels[(16 * Size + 20) * 4], 0, "padding reached further than it was asked to");
});

test("two parts of a scene never share an identity colour by accident", () =>
{
    const Seen = new Set();
    for (let Index = 0; Index < 64; Index += 1)
    {
        const Colour = IdentityColour(Index);
        assert.ok(Colour.every((Component) => Component >= 0 && Component <= 1));
        const Name = Colour.map((Component) => Math.round(Component * 255)).join(",");
        assert.ok(!Seen.has(Name), `index ${Index} repeats a colour`);
        Seen.add(Name);
    }
    assert.deepEqual(IdentityColour(-1), [0, 0, 0], "nothing is black and black is nothing");
    assert.ok(IdentityKinds.length === 4);
});

// Identity as a picture. The view exists so that a selection can be made by clicking the thing rather than by
// guessing which of forty islands "Island 14" is, so what it has to get right is that two neighbours never share a
// colour, that what is already chosen is obvious, and that the number behind a colour is the number the mask keys on.
test("an identity map colours every region and lights the one that is chosen", () =>
{
    const Surface = AssembleScene([
        CreateObject({ Identifier: "block", Name: "Block", Kind: "cube", Subdivision: 1, Tile: 1001 }),
        CreateObject({ Identifier: "ball", Name: "Ball", Kind: "sphere", Subdivision: 1, Tile: 1002, Offset: [1.3, 0, 0] }),
    ]);
    const Sheets = MeasureSurface(Surface, { Size: 96 });
    const Plain = IdentityImage(Sheets, "object");
    assert.equal(Plain.Size, 96);
    assert.equal(Plain.Pixels.length, 96 * 96 * 4);
    const Tint = (Picture, Texel) => [...Picture.Pixels.subarray(Texel * 4, Texel * 4 + 3)].join(",");
    let First = -1;
    let Second = -1;
    for (let Texel = 0; Texel < 96 * 96; Texel += 1)
    {
        if (!Sheets.Filled[Texel]) continue;
        if (Sheets.Owner[Texel] === 0 && First < 0) First = Texel;
        if (Sheets.Owner[Texel] === 1 && Second < 0) Second = Texel;
    }
    assert.ok(First >= 0 && Second >= 0, "the scene should have two objects in the sheet");
    assert.notEqual(Tint(Plain, First), Tint(Plain, Second), "two objects came out the same colour");
    const Empty = [...Sheets.Filled].findIndex((Filled) => !Filled);
    if (Empty >= 0) assert.equal(Tint(Plain, Empty), "0,0,0", "an empty texel should be empty");

    // With a choice made, the chosen object washes towards white and the rest go down, so the view answers both
    // "what can I pick" and "what did I pick" at once.
    const Chosen = IdentityImage(Sheets, "object", "1");
    const Lit = [...Chosen.Pixels.subarray(Second * 4, Second * 4 + 3)].reduce((Sum, Part) => Sum + Part, 0);
    const Dim = [...Chosen.Pixels.subarray(First * 4, First * 4 + 3)].reduce((Sum, Part) => Sum + Part, 0);
    const Was = [...Plain.Pixels.subarray(Second * 4, Second * 4 + 3)].reduce((Sum, Part) => Sum + Part, 0);
    assert.ok(Lit > Was, "the chosen object did not light up");
    assert.ok(Dim < Lit, "the unchosen object is as loud as the chosen one");

    // A UDIM number is 1001 and up. Colouring by it straight hands a four-tile scene four shades of one hue, so the
    // tile's place in the list gets the colour instead.
    const Tiles = IdentityImage(Sheets, "tile");
    assert.notEqual(Tint(Tiles, First), Tint(Tiles, Second), "two tiles came out the same colour");

    // Faces are picked rather than chosen, so the picture is keyed on the set of marks.
    const Face = Sheets.Face[First];
    const Picked = IdentityImage(Sheets, "face", "", new Set([Face]));
    const Bright = [...Picked.Pixels.subarray(First * 4, First * 4 + 3)].reduce((Sum, Part) => Sum + Part, 0);
    const Other = [...Picked.Pixels.subarray(Second * 4, Second * 4 + 3)].reduce((Sum, Part) => Sum + Part, 0);
    assert.ok(Bright > Other, "a picked face should be the loud one");
    assert.equal(IdentityImage(null, "object"), null, "nothing measured is nothing to draw");
});

test("the estimate grows with everything that makes a bake slower", () =>
{
    const Order = ReadingDefaults();
    const Base = ReadingEstimate(Order, 10000);
    assert.ok(ReadingEstimate({ ...Order, Size: 1024 }, 10000).Seconds > Base.Seconds);
    assert.ok(ReadingEstimate({ ...Order, Samples: 16 }, 10000).Seconds > Base.Seconds);
    assert.ok(ReadingEstimate(Order, 40000).Seconds > Base.Seconds, "more triangles, more rays, more time");
    assert.ok(ReadingEstimate({ ...Order, Size: 1024 }, 10000).Megabytes > Base.Megabytes);
});

//--------------------------------------------------------------------------------------------------------------------------
// Visibility. Occlusion, bent normals and thickness used to be answered at the vertices and smeared across the sheet
// by the rasteriser, which is Gouraud shading an occlusion map: a fifteen-thousand-vertex model carries about as much
// detail as a 122×122 image, and every texel of a 512² bake between those vertices was an interpolation of answers
// nobody had measured. The triangles showed. These are the checks that say they no longer do.
//--------------------------------------------------------------------------------------------------------------------------
const Patch = (Surface, Size, Place) =>
{
    const Texels = Size * Size;
    const Sheets = {
        Size,
        Filled: new Uint8Array(Texels).fill(1),
        Position: new Float32Array(Texels * 3),
        Normal: new Float32Array(Texels * 3),
        Island: new Int32Array(Texels),
        Bounds: Surface.Bounds,
    };
    for (let Y = 0; Y < Size; Y += 1)
        for (let X = 0; X < Size; X += 1)
        {
            const Texel = Y * Size + X;
            const { Position, Normal, Island } = Place(X, Y);
            Sheets.Position.set(Position, Texel * 3);
            Sheets.Normal.set(Normal, Texel * 3);
            Sheets.Island[Texel] = Island || 0;
        }
    return Sheets;
};

test("occlusion is measured where the texel is, not where its triangle's corners are", () =>
{
    const Surface = AssembleScene([
        CreateObject({ Identifier: "floor", Name: "Floor", Kind: "plane", Subdivision: 0, Tile: 1001 }),
        CreateObject({ Identifier: "ball", Name: "Ball", Kind: "sphere", Subdivision: 2, Scale: 0.25, Tile: 1002, Offset: [0, 0.3, 0] }),
    ]);
    const Index = new SurfaceIndex(Surface);
    const Size = 64;
    const Sheets = Patch(Surface, Size, (X, Y) => ({
        Position: [(X / (Size - 1)) * 1.2 - 0.6, 0, (Y / (Size - 1)) * 1.2 - 0.6],
        Normal: [0, 1, 0],
    }));
    const Seen = MeasureVisibility(Surface, Index, Sheets, { Rays: 24, Resolution: Size });
    assert.equal(Seen.Stride, 1, "a sheet inside the trace limit is traced at every texel");

    // The same integral again, at the same points, with a ray set twenty times larger and laid out differently.
    // 🔴 This is the point of the whole exercise: twenty-four rays a texel plus the reconstruction has to agree
    //    with five hundred rays a texel, or the map is noise wearing an answer's clothes.
    const Truth = (Texel) =>
    {
        const PX = Sheets.Position[Texel * 3];
        const PZ = Sheets.Position[Texel * 3 + 2];
        let Open = 0;
        for (let Ray = 0; Ray < 512; Ray += 1)
        {
            const Fraction = (Ray + 0.5) / 512;
            const Sine = Math.sqrt(Fraction);
            const Angle = Ray * 2.399963229728653 + 0.7;
            if (!Index.Blocked(PX, 1e-4, PZ, Math.cos(Angle) * Sine, Math.sqrt(1 - Fraction), Math.sin(Angle) * Sine, 4)) Open += 1;
        }
        return Open / 512;
    };
    let Total = 0;
    let Worst = 0;
    let Count = 0;
    for (let Y = 2; Y < Size - 2; Y += 5)
        for (let X = 2; X < Size - 2; X += 5)
        {
            const Texel = Y * Size + X;
            const Apart = Math.abs(Truth(Texel) - Seen.Occlusion[Texel]);
            Total += Apart;
            Worst = Math.max(Worst, Apart);
            Count += 1;
        }
    assert.ok(Total / Count < 0.02, `the measured occlusion is off by ${(Total / Count).toFixed(4)} on average`);
    assert.ok(Worst < 0.06, `the worst texel is off by ${Worst.toFixed(4)}`);

    // And it is a shadow, not a wash: dark under the ball, open at the corner, with the bent normal still a unit
    // direction everywhere.
    const Under = Seen.Occlusion[(Size / 2) * Size + Size / 2];
    const Away = Seen.Occlusion[2 * Size + 2];
    assert.ok(Away - Under > 0.3, `the contact shadow is only ${(Away - Under).toFixed(3)} deep`);
    for (let Texel = 0; Texel < Size * Size; Texel += 1)
    {
        const Length = Math.hypot(Seen.Bent[Texel * 3], Seen.Bent[Texel * 3 + 1], Seen.Bent[Texel * 3 + 2]);
        assert.ok(Math.abs(Length - 1) < 1e-3, `a bent normal came back ${Length.toFixed(4)} long`);
        assert.ok(Seen.Occlusion[Texel] >= 0 && Seen.Occlusion[Texel] <= 1 && Seen.Thickness[Texel] >= 0);
    }
});

test("the reconstruction never reaches through a wall to a texel that is only a sheet neighbour", () =>
{
    // A pea sealed inside a shell. The pea sees nothing at all, the outside of the shell sees everything, and on the
    // sheet they are laid down side by side — which is what a UV layout does all day.
    const Surface = AssembleScene([
        CreateObject({ Identifier: "shell", Name: "Shell", Kind: "sphere", Subdivision: 3, Scale: 3, Tile: 1001 }),
        CreateObject({ Identifier: "pea", Name: "Pea", Kind: "sphere", Subdivision: 2, Scale: 0.4, Tile: 1002 }),
    ]);
    const Index = new SurfaceIndex(Surface);
    const Size = 64;
    const Half = Size / 2;
    const Lay = (X, Y) =>
    {
        const Sealed = X < Half;
        const Across = ((Sealed ? X : X - Half) / (Half - 1)) * 1.2 - 0.6;
        const Down = (Y / (Size - 1)) * 1.2 - 0.6;
        const Length = Math.hypot(Across, Down, 1);
        const Normal = [Across / Length, Down / Length, 1 / Length];
        const Radius = Sealed ? 0.4 : 3;
        return { Position: Normal.map((Part) => Part * Radius), Normal, Island: Sealed ? 0 : 1 };
    };
    const Sheets = Patch(Surface, Size, Lay);
    const Column = (Seen, X) =>
    {
        let Sum = 0;
        for (let Y = 4; Y < Size - 4; Y += 1) Sum += Seen.Occlusion[Y * Size + X];
        return Sum / (Size - 8);
    };
    const Seen = MeasureVisibility(Surface, Index, Sheets, { Rays: 24, Resolution: Size });
    assert.ok(Column(Seen, Half - 1) < 0.02, `the last sealed column read ${Column(Seen, Half - 1).toFixed(4)}`);
    assert.ok(Column(Seen, Half) > 0.98, `the first open column read ${Column(Seen, Half).toFixed(4)}`);

    // 🔴 Now take the island guard away and leave only the world-distance one. The step has to stay exactly as
    //    sharp, because a UV seam is not always an island boundary and the geometry is what decides.
    Sheets.Island.fill(0);
    const Loose = MeasureVisibility(Surface, Index, Sheets, { Rays: 24, Resolution: Size });
    assert.ok(Column(Loose, Half - 1) < 0.02, `without the island guard the last sealed column read ${Column(Loose, Half - 1).toFixed(4)}`);
    assert.ok(Column(Loose, Half) > 0.98, `without the island guard the first open column read ${Column(Loose, Half).toFixed(4)}`);
});

test("the rays follow the model, not the resolution of the sheet", () =>
{
    const Surface = Scene();
    const Index = new SurfaceIndex(Surface);
    const Order = { Samples: 1, Rays: 6, Padding: 0, Wanted: ["occlusion"] };
    const Small = SolveReadings(Surface, Index, { ...Order, Size: 256 });
    const Large = SolveReadings(Surface, Index, { ...Order, Size: 512 });
    assert.equal(Small.Statistics.Stride, 1);
    assert.equal(Large.Statistics.Stride, 2);
    assert.ok(Large.Statistics.Filled > Small.Statistics.Filled * 3.5, "four times the sheet is four times the texels");
    const Ratio = Large.Statistics.Rays / Small.Statistics.Rays;
    assert.ok(Ratio > 0.9 && Ratio < 1.1, `quadrupling the sheet changed the ray count by ${((Ratio - 1) * 100).toFixed(0)}%`);
});

test("what the sheet records does not move when the antialiasing does", () =>
{
    // The record the generators read is a pass of its own now. It used to ride along on the first antialiasing
    // sample, which is a CORNER of the sample lattice — so changing the sample count moved every identity, every
    // position and every normal in the record by two thirds of a texel.
    const Surface = Scene();
    const Index = new SurfaceIndex(Surface);
    const Order = { Size: 96, Rays: 6, Padding: 0, Wanted: ["coverage"] };
    const One = SolveReadings(Surface, Index, { ...Order, Samples: 1 }).Sheets;
    const Nine = SolveReadings(Surface, Index, { ...Order, Samples: 9 }).Sheets;
    assert.deepEqual([...One.Face], [...Nine.Face], "the triangle under a texel is the triangle under a texel");
    assert.deepEqual([...One.Owner], [...Nine.Owner]);
    assert.deepEqual([...One.Island], [...Nine.Island]);
    assert.deepEqual([...One.Filled], [...Nine.Filled]);
    for (let Texel = 0; Texel < 96 * 96; Texel += 1)
        assert.ok(Math.abs(One.Position[Texel * 3] - Nine.Position[Texel * 3]) < 1e-6);
});
