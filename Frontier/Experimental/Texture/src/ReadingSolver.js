//============================================================================================================================================
// 🩶 ReadingSolver.js — the surface, asked every question at once, into texture space
//============================================================================================================================================
// One walk of the triangles answers every map in the order, because the expensive part of a bake is not the arithmetic
// — it is finding out which triangle a texel belongs to and with what weights, and that answer is the same whether it
// is being asked for a normal or for an ambient occlusion. So the rasterisation happens once per antialiasing sample
// and every requested map is accumulated inside it.
//
// The per-vertex work happens before any of that and happens once: curvature off the welded mesh, occlusion and bent
// normals over a hemisphere of rays, thickness into the solid, bevel normals over a radius. Texture space only ever
// interpolates what the vertices already know, which is why doubling the sheet costs nothing in ray time.
//
// 🔴 Weights can be negative. Mitchell and Catmull-Rom both undershoot past their first lobe and that overshoot is
//    what makes an edge read as sharp, so the accumulated weight is divided out rather than assumed to be one, and a
//    texel whose weights cancel is left to the padding pass rather than divided by nothing.
//============================================================================================================================================

import {
    MeasureBevelNormals,
    MeasureCurvature,
    MeasureIslands,
    MeasureVisibility,
    RasteriseSurface,
    SheetSize,
} from "./SurfaceSolver.js";
import { ReadingByIdentifier, SampleOffsets, SanitiseReading, TraceLimit } from "./ReadingSpecification.js";

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Number.isFinite(Value) ? Value : Low));

// A colour per index, spread around the wheel so that two neighbours are never two shades of the same thing — an ID
// map is read by eye as often as it is read by a mask.
export const IdentityColour = (Index) =>
{
    if (Index < 0) return [0, 0, 0];
    const Hue = ((Index * 0.618033988749895) % 1) * 6;
    const Tier = Math.floor(Hue);
    const Fraction = Hue - Tier;
    const Light = 0.55 + ((Index * 0.381966) % 1) * 0.35;
    const Deep = Light * 0.35;
    const Rise = Deep + (Light - Deep) * Fraction;
    const Fall = Light - (Light - Deep) * Fraction;
    if (Tier === 0) return [Light, Rise, Deep];
    if (Tier === 1) return [Fall, Light, Deep];
    if (Tier === 2) return [Deep, Light, Rise];
    if (Tier === 3) return [Deep, Fall, Light];
    if (Tier === 4) return [Rise, Deep, Light];
    return [Light, Deep, Fall];
};

//--------------------------------------------------------------------------------------------------------------------------
// Identity, as a picture rather than as a dropdown.
//
// 🔴 Picking an object, a tile, an island or a handful of faces out of a list is picking blind: the list says
//    "Island 14" and the model says nothing at all. So the same identity the mask keys on is coloured in and put on
//    the surface, and then the click that chooses is a click on the thing itself. What is already chosen is washed
//    towards white and everything else is dimmed, which makes the view answer both questions at once — what can I
//    pick, and what have I picked.
//
// Kind is object, tile, island or faces. Chosen is the value a selection generator carries, as the string the mask
// compares against; Picked is the set of face indices a face generator has collected.
//--------------------------------------------------------------------------------------------------------------------------
export const IdentityImage = (Sheets, Candidate = "object", Chosen = "", Picked = null) =>
{
    if (!Sheets || !Sheets.Size) return null;
    // The bake order says "face" and a selection generator says "faces". They are the same question.
    const Kind = Candidate === "face" ? "faces" : Candidate;
    const Size = Sheets.Size;
    const Pixels = new Uint8Array(Size * Size * 4);
    const Field =
        Kind === "island" ? Sheets.Island : Kind === "tile" ? Sheets.Tile : Kind === "faces" ? Sheets.Face : Sheets.Owner;
    if (!Field) return null;
    const Tiles = Sheets.Tiles || [];
    const Marks = Kind === "faces" && Picked && Picked.size ? Picked : null;
    const Wanted = Marks ? "" : String(Chosen ?? "");
    const Deciding = Boolean(Marks) || Wanted !== "";
    for (let Texel = 0; Texel < Size * Size; Texel += 1)
    {
        const At = Texel * 4;
        Pixels[At + 3] = 255;
        if (!Sheets.Filled[Texel]) continue;
        const Value = Field[Texel];
        if (Value < 0) continue;
        // A UDIM number is 1001 and up, so colouring by it straight would hand a four-tile scene four shades of the
        // same hue. The tile's place in the list is what gets the colour.
        const Index = Kind === "tile" ? Math.max(0, Tiles.indexOf(Value)) : Value;
        const Colour = IdentityColour(Index);
        const Lit = Marks ? Marks.has(Value) : Wanted === "" || String(Value) === Wanted;
        for (let Channel = 0; Channel < 3; Channel += 1)
        {
            // Chosen is the colour pushed most of the way to white, so it is still recognisably the same region.
            const Shade = Lit ? (Deciding ? Colour[Channel] + (1 - Colour[Channel]) * 0.62 : Colour[Channel]) : Colour[Channel] * 0.3;
            Pixels[At + Channel] = Math.max(0, Math.min(255, Math.round(Shade * 255)));
        }
    }
    return { Size, Pixels };
};

//--------------------------------------------------------------------------------------------------------------------------
// The order, answered. Progress is called with a fraction and a line of text, because a bake at sixteen samples on a
// big sheet is long enough that silence reads as a hang.
//--------------------------------------------------------------------------------------------------------------------------
export const SolveReadings = (Surface, Index, Candidate = {}, Progress = null) =>
{
    const Order = SanitiseReading(Candidate);
    const Size = SheetSize(Order.Size);
    const Texels = Size * Size;
    const Started = Date.now();
    const Wanted = Order.Wanted.map((Identifier) => ReadingByIdentifier[Identifier]).filter(Boolean);
    const Asked = new Set(Wanted.map((Entry) => Entry.Identifier));
    const Say = (Fraction, Line) => Progress && Progress(Clamp(Fraction, 0, 1), Line);

    //----------------------------------------------------------------------------------------------------------------------
    // What the vertices know.
    //----------------------------------------------------------------------------------------------------------------------
    Say(0.02, "Welding the mesh and reading its curvature");
    const Bend = MeasureCurvature(Surface);
    const Bevel = Asked.has("bevel") ? (Say(0.08, "Rounding the edges without moving them"), MeasureBevelNormals(Surface, Order.Width)) : null;

    //----------------------------------------------------------------------------------------------------------------------
    // What the triangles know: which part of the scene each one belongs to, which way it faces flat, and how much
    // texture it was given.
    //----------------------------------------------------------------------------------------------------------------------
    const Triangles = Surface.Indices.length / 3;
    const { Island, Count: Islands } = MeasureIslands(Surface);
    const Owner = new Int32Array(Triangles).fill(-1);
    const Tile = new Int32Array(Triangles).fill(-1);
    const Owners = [];
    const Tiles = [];
    for (const [Position, Range] of (Surface.Ranges || []).entries())
    {
        for (let Step = 0; Step < Range.TriangleCount; Step += 1)
        {
            Owner[Range.FirstTriangle + Step] = Position;
            Tile[Range.FirstTriangle + Step] = Range.Tile;
        }
        Owners.push({ Identifier: Range.Identifier, Name: Range.Name, Tile: Range.Tile, Index: Position });
        if (!Tiles.includes(Range.Tile)) Tiles.push(Range.Tile);
    }
    Tiles.sort((A, B) => A - B);

    const Flat = new Float32Array(Triangles * 3);
    const Density = new Float32Array(Triangles);
    let Widest = 0;
    let Spread = 0;
    for (let Triangle = 0; Triangle < Triangles; Triangle += 1)
    {
        const IA = Surface.Indices[Triangle * 3];
        const IB = Surface.Indices[Triangle * 3 + 1];
        const IC = Surface.Indices[Triangle * 3 + 2];
        const EX1 = Surface.Positions[IB * 3] - Surface.Positions[IA * 3];
        const EY1 = Surface.Positions[IB * 3 + 1] - Surface.Positions[IA * 3 + 1];
        const EZ1 = Surface.Positions[IB * 3 + 2] - Surface.Positions[IA * 3 + 2];
        const EX2 = Surface.Positions[IC * 3] - Surface.Positions[IA * 3];
        const EY2 = Surface.Positions[IC * 3 + 1] - Surface.Positions[IA * 3 + 1];
        const EZ2 = Surface.Positions[IC * 3 + 2] - Surface.Positions[IA * 3 + 2];
        const CX = EY1 * EZ2 - EZ1 * EY2;
        const CY = EZ1 * EX2 - EX1 * EZ2;
        const CZ = EX1 * EY2 - EY1 * EX2;
        const Length = Math.hypot(CX, CY, CZ) || 1e-9;
        Flat[Triangle * 3] = CX / Length;
        Flat[Triangle * 3 + 1] = CY / Length;
        Flat[Triangle * 3 + 2] = CZ / Length;
        const UA = Surface.Coordinates[IA * 2];
        const VA = Surface.Coordinates[IA * 2 + 1];
        const Chart = Math.abs(
            (Surface.Coordinates[IB * 2] - UA) * (Surface.Coordinates[IC * 2 + 1] - VA) -
                (Surface.Coordinates[IC * 2] - UA) * (Surface.Coordinates[IB * 2 + 1] - VA),
        );
        // Texels across the triangle against metres across it: the number a texel density read-out actually means.
        Density[Triangle] = Math.sqrt(Chart) / Math.max(1e-9, Math.sqrt(Length));
        Widest += Density[Triangle] * Length;
        Spread += Length;
    }
    // 🔴 Against the AVERAGE, not the widest. One sliver with a ridiculous ratio is enough to push every honest
    //    triangle to black, and the question a density map answers is "is this part getting its share", which only
    //    means anything against the share. Mid grey is the model's own average; white is twice it.
    Widest = Math.max(1e-9, Widest / Math.max(1e-9, Spread)) * 2;

    //----------------------------------------------------------------------------------------------------------------------
    // The sheet the generators read, filled in the same walk. A bake at a thousand square is a better answer for a
    // dust mask than a measurement at two hundred and fifty-six, so the one pays for the other.
    //----------------------------------------------------------------------------------------------------------------------
    const Sheets = {
        Size,
        Filled: new Uint8Array(Texels),
        Position: new Float32Array(Texels * 3),
        Normal: new Float32Array(Texels * 3),
        Occlusion: new Float32Array(Texels).fill(1),
        Thickness: new Float32Array(Texels).fill(1),
        Curvature: new Float32Array(Texels),
        Altitude: new Float32Array(Texels),
        Owner: new Int32Array(Texels).fill(-1),
        Tile: new Int32Array(Texels).fill(-1),
        Island: new Int32Array(Texels).fill(-1),
        Face: new Int32Array(Texels).fill(-1),
        Bounds: Surface.Bounds,
        Owners,
        Tiles,
        Islands,
        Triangles,
    };

    const Store = new Map();
    for (const Entry of Wanted) Store.set(Entry.Identifier, new Float32Array(Texels * Entry.Channels));
    const Weights = new Float32Array(Texels);
    const Coverage = new Uint8Array(Texels);

    const Lowest = Surface.Bounds.Minimum[1];
    const Span = Math.max(1e-6, Surface.Bounds.Maximum[1] - Lowest);
    const Reach = Math.max(1e-6, Surface.Bounds.Radius * 2);
    const Centre = Surface.Bounds.Centre;
    const Offsets = SampleOffsets(Order.Samples, Order.Filter);
    const Tangential = Order.Space === "tangent";
    const Worldly = Order.Space === "world";

    //----------------------------------------------------------------------------------------------------------------------
    // The record the generators read, and the thing the rays are fired from. It gets a pass of its own.
    //
    // 🔴 This used to ride along on the first antialiasing sample, and the first antialiasing sample is a CORNER of
    //    the sample lattice, not the middle of the texel — about two thirds of a texel off in both axes. Everything
    //    downstream that asks the sheet what is under a texel was being answered about somewhere else, and on a
    //    seam or an object boundary that is a different triangle, a different object and a different answer.
    //----------------------------------------------------------------------------------------------------------------------
    Say(0.12, "Finding the surface under every texel");
    RasteriseSurface(Surface, { Size, Offset: [0, 0] }, (Texel, Triangle, W0, W1, W2, IA, IB, IC) =>
    {
        const PX = Surface.Positions[IA * 3] * W0 + Surface.Positions[IB * 3] * W1 + Surface.Positions[IC * 3] * W2;
        const PY = Surface.Positions[IA * 3 + 1] * W0 + Surface.Positions[IB * 3 + 1] * W1 + Surface.Positions[IC * 3 + 1] * W2;
        const PZ = Surface.Positions[IA * 3 + 2] * W0 + Surface.Positions[IB * 3 + 2] * W1 + Surface.Positions[IC * 3 + 2] * W2;
        let NX = Surface.Normals[IA * 3] * W0 + Surface.Normals[IB * 3] * W1 + Surface.Normals[IC * 3] * W2;
        let NY = Surface.Normals[IA * 3 + 1] * W0 + Surface.Normals[IB * 3 + 1] * W1 + Surface.Normals[IC * 3 + 1] * W2;
        let NZ = Surface.Normals[IA * 3 + 2] * W0 + Surface.Normals[IB * 3 + 2] * W1 + Surface.Normals[IC * 3 + 2] * W2;
        const Unit = Math.hypot(NX, NY, NZ) || 1;
        NX /= Unit;
        NY /= Unit;
        NZ /= Unit;
        Sheets.Filled[Texel] = 1;
        Sheets.Face[Texel] = Triangle;
        Sheets.Owner[Texel] = Owner[Triangle];
        Sheets.Tile[Texel] = Tile[Triangle];
        Sheets.Island[Texel] = Island[Triangle];
        Sheets.Position[Texel * 3] = PX;
        Sheets.Position[Texel * 3 + 1] = PY;
        Sheets.Position[Texel * 3 + 2] = PZ;
        Sheets.Normal[Texel * 3] = NX;
        Sheets.Normal[Texel * 3 + 1] = NY;
        Sheets.Normal[Texel * 3 + 2] = NZ;
        Sheets.Curvature[Texel] = Bend[IA] * W0 + Bend[IB] * W1 + Bend[IC] * W2;
        Sheets.Altitude[Texel] = Clamp((PY - Lowest) / Span, 0, 1);
    });

    //----------------------------------------------------------------------------------------------------------------------
    // The rays, fired from the texels the pass above just found.
    //----------------------------------------------------------------------------------------------------------------------
    let Bent = null;
    let Visible = null;
    if (Index)
    {
        Say(0.18, `Tracing ${Order.Rays} rays a texel`);
        Visible = MeasureVisibility(Surface, Index, Sheets, {
            Rays: Order.Rays,
            Resolution: TraceLimit,
            Progress: (Fraction) => Say(0.18 + Fraction * 0.4, `Tracing ${Order.Rays} rays a texel`),
        });
        Sheets.Occlusion = Visible.Occlusion;
        Sheets.Thickness = Visible.Thickness;
        Sheets.Bent = Visible.Bent;
        Bent = Visible.Bent;
    }
    // Nothing to trace against. A bent normal that cannot see anything is the normal it already had, which is what
    // the per-vertex pass used to say too — a black direction map is not an honest answer, it is a missing one.
    else Bent = Sheets.Normal;

    //----------------------------------------------------------------------------------------------------------------------
    // One pass per sample. Everything inside is per texel, so it is written flat and without allocation: a closure
    // that builds three vectors per texel turns a two-second bake into a thirty-second one.
    //----------------------------------------------------------------------------------------------------------------------
    for (const [Pass, Offset] of Offsets.entries())
    {
        Say(0.62 + (0.32 * Pass) / Offsets.length, `Sample ${Pass + 1} of ${Offsets.length}`);
        RasteriseSurface(Surface, { Size, Offset: [Offset.X, Offset.Y] }, (Texel, Triangle, W0, W1, W2, IA, IB, IC) =>
        {
            const Weight = Offset.Weight;
            Weights[Texel] += Weight;
            Coverage[Texel] = 1;

            const PX = Surface.Positions[IA * 3] * W0 + Surface.Positions[IB * 3] * W1 + Surface.Positions[IC * 3] * W2;
            const PY = Surface.Positions[IA * 3 + 1] * W0 + Surface.Positions[IB * 3 + 1] * W1 + Surface.Positions[IC * 3 + 1] * W2;
            const PZ = Surface.Positions[IA * 3 + 2] * W0 + Surface.Positions[IB * 3 + 2] * W1 + Surface.Positions[IC * 3 + 2] * W2;
            let NX = Surface.Normals[IA * 3] * W0 + Surface.Normals[IB * 3] * W1 + Surface.Normals[IC * 3] * W2;
            let NY = Surface.Normals[IA * 3 + 1] * W0 + Surface.Normals[IB * 3 + 1] * W1 + Surface.Normals[IC * 3 + 1] * W2;
            let NZ = Surface.Normals[IA * 3 + 2] * W0 + Surface.Normals[IB * 3 + 2] * W1 + Surface.Normals[IC * 3 + 2] * W2;
            const Unit = Math.hypot(NX, NY, NZ) || 1;
            NX /= Unit;
            NY /= Unit;
            NZ /= Unit;

            // The frame a tangent-space answer is written in. Built here rather than cached because the tangent is
            // interpolated too, and a frame from the nearest vertex puts a crease down the middle of every triangle.
            let TX = 0;
            let TY = 0;
            let TZ = 0;
            let BX = 0;
            let BY = 0;
            let BZ = 0;
            let FX = NX;
            let FY = NY;
            let FZ = NZ;
            if (Tangential)
            {
                // 🔴 The frame stands on the FACE's normal, not on the interpolated one. Against its own smooth
                //    normal every direction map in tangent space is the constant (0, 0, 1) — a flat blue sheet
                //    that is technically correct and worth nothing. Against the flat triangle it is the map you
                //    would have got by baking this model onto a faceted copy of itself: the smoothing, the bevel
                //    and the bent normal all become something you can see.
                FX = Flat[Triangle * 3];
                FY = Flat[Triangle * 3 + 1];
                FZ = Flat[Triangle * 3 + 2];
                TX = Surface.Tangents[IA * 4] * W0 + Surface.Tangents[IB * 4] * W1 + Surface.Tangents[IC * 4] * W2;
                TY = Surface.Tangents[IA * 4 + 1] * W0 + Surface.Tangents[IB * 4 + 1] * W1 + Surface.Tangents[IC * 4 + 1] * W2;
                TZ = Surface.Tangents[IA * 4 + 2] * W0 + Surface.Tangents[IB * 4 + 2] * W1 + Surface.Tangents[IC * 4 + 2] * W2;
                const Hand = Surface.Tangents[IA * 4 + 3] < 0 ? -1 : 1;
                const Along = TX * FX + TY * FY + TZ * FZ;
                TX -= FX * Along;
                TY -= FY * Along;
                TZ -= FZ * Along;
                const Taut = Math.hypot(TX, TY, TZ) || 1;
                TX /= Taut;
                TY /= Taut;
                TZ /= Taut;
                BX = (FY * TZ - FZ * TY) * Hand;
                BY = (FZ * TX - FX * TZ) * Hand;
                BZ = (FX * TY - FY * TX) * Hand;
            }

            const Sheet = Store;
            const Lay = (Identifier, X, Y, Z) =>
            {
                const Into = Sheet.get(Identifier);
                if (!Into) return;
                Into[Texel * 3] += X * Weight;
                Into[Texel * 3 + 1] += Y * Weight;
                Into[Texel * 3 + 2] += Z * Weight;
            };
            const LayDirection = (Identifier, X, Y, Z) =>
            {
                if (!Sheet.has(Identifier)) return;
                if (Tangential) Lay(Identifier, X * TX + Y * TY + Z * TZ, X * BX + Y * BY + Z * BZ, X * FX + Y * FY + Z * FZ);
                else if (Worldly) Lay(Identifier, X, Y, Z);
                else Lay(Identifier, X, Y, Z);
            };
            const LayValue = (Identifier, Value) =>
            {
                const Into = Sheet.get(Identifier);
                if (Into) Into[Texel] += Value * Weight;
            };

            LayDirection("normal", NX, NY, NZ);
            if (Bevel)
                LayDirection(
                    "bevel",
                    Bevel[IA * 3] * W0 + Bevel[IB * 3] * W1 + Bevel[IC * 3] * W2,
                    Bevel[IA * 3 + 1] * W0 + Bevel[IB * 3 + 1] * W1 + Bevel[IC * 3 + 1] * W2,
                    Bevel[IA * 3 + 2] * W0 + Bevel[IB * 3 + 2] * W1 + Bevel[IC * 3 + 2] * W2,
                );
            // 🔴 Read at the texel, not interpolated from the corners — but written through LayDirection, which
            //    is inside this callback because the tangent frame it has to be rotated into is this triangle's.
            if (Bent) LayDirection("bent", Bent[Texel * 3], Bent[Texel * 3 + 1], Bent[Texel * 3 + 2]);
            LayDirection("face", Flat[Triangle * 3], Flat[Triangle * 3 + 1], Flat[Triangle * 3 + 2]);

            const Shade = Sheets.Occlusion[Texel];
            const Curve = Bend[IA] * W0 + Bend[IB] * W1 + Bend[IC] * W2;
            const Deep = Sheets.Thickness[Texel];
            const High = Clamp((PY - Lowest) / Span, 0, 1);
            LayValue("occlusion", Shade);
            LayValue("thickness", Deep);
            // Convex white, concave black, flat the middle grey — the convention every curvature map is read with.
            LayValue("curvature", Clamp(0.5 - Curve * 0.5, 0, 1));
            LayValue("cavity", Clamp(Math.max(0, Curve), 0, 1));
            LayValue("height", High);
            LayValue("density", Clamp(Density[Triangle] / Widest, 0, 1));
            LayValue("coverage", 1);
            Lay("position", (PX - Centre[0]) / Reach + 0.5, (PY - Centre[1]) / Reach + 0.5, (PZ - Centre[2]) / Reach + 0.5);
            Lay(
                "coordinate",
                Surface.Coordinates[IA * 2] * W0 + Surface.Coordinates[IB * 2] * W1 + Surface.Coordinates[IC * 2] * W2,
                Surface.Coordinates[IA * 2 + 1] * W0 + Surface.Coordinates[IB * 2 + 1] * W1 + Surface.Coordinates[IC * 2 + 1] * W2,
                0,
            );
            if (Sheet.has("identity"))
            {
                const Which =
                    Order.Identity === "island"
                        ? Island[Triangle]
                        : Order.Identity === "tile"
                          ? Tiles.indexOf(Tile[Triangle])
                          : Order.Identity === "face"
                            ? Triangle
                            : Owner[Triangle];
                const Colour = IdentityColour(Which);
                Lay("identity", Colour[0], Colour[1], Colour[2]);
            }

        });
    }

    //----------------------------------------------------------------------------------------------------------------------
    // Out of the accumulators and into images.
    //----------------------------------------------------------------------------------------------------------------------
    Say(0.96, "Writing the maps");
    const Maps = Wanted.map((Entry) =>
    {
        const Values = Store.get(Entry.Identifier);
        const Pixels = new Uint8ClampedArray(Texels * 4);
        const Directional = Entry.Family === "direction";
        for (let Texel = 0; Texel < Texels; Texel += 1)
        {
            const Total = Weights[Texel];
            if (!Coverage[Texel] || Math.abs(Total) < 1e-5) continue;
            if (Entry.Channels === 1)
            {
                // Coverage is the one map whose question is about the texel rather than about the surface under it,
                // so it divides by the whole lattice: a texel half off the island reads half, which is the point.
                const Value = Clamp(Values[Texel] / (Entry.Identifier === "coverage" ? 1 : Total), 0, 1);
                const Byte = Math.round(Value * 255);
                Pixels[Texel * 4] = Byte;
                Pixels[Texel * 4 + 1] = Byte;
                Pixels[Texel * 4 + 2] = Byte;
                Pixels[Texel * 4 + 3] = 255;
                continue;
            }
            let X = Values[Texel * 3] / Total;
            let Y = Values[Texel * 3 + 1] / Total;
            let Z = Values[Texel * 3 + 2] / Total;
            if (Directional)
            {
                // 🔴 Renormalised AFTER the filter. Averaging two unit vectors gives something shorter than one, and
                //    an unnormalised normal map is a map of surfaces that are slightly less lit than they should be.
                const Length = Math.hypot(X, Y, Z) || 1;
                X = X / Length / 2 + 0.5;
                Y = Y / Length / 2 + 0.5;
                Z = Z / Length / 2 + 0.5;
            }
            Pixels[Texel * 4] = Math.round(Clamp(X, 0, 1) * 255);
            Pixels[Texel * 4 + 1] = Math.round(Clamp(Y, 0, 1) * 255);
            Pixels[Texel * 4 + 2] = Math.round(Clamp(Z, 0, 1) * 255);
            Pixels[Texel * 4 + 3] = 255;
        }
        if (Order.Padding > 0 && Entry.Identifier !== "coverage") Dilate(Pixels, Coverage, Size, Order.Padding);
        return {
            Identifier: Entry.Identifier,
            Label: Entry.Label,
            Short: Entry.Short,
            Channels: Entry.Channels,
            Glyph: Entry.Glyph,
            Space: Entry.Spaced ? Order.Space : "",
            Size,
            Pixels,
        };
    });

    let Landed = 0;
    for (const Texel of Coverage) Landed += Texel;
    Say(1, "Done");
    return {
        Size,
        Order,
        Maps,
        Sheets,
        Coverage,
        Milliseconds: Date.now() - Started,
        Statistics: {
            Samples: Offsets.length,
            Triangles,
            Islands,
            Tiles: Tiles.length,
            Objects: Owners.length,
            Filled: Landed,
            Occupancy: Landed / Texels,
            Traced: Visible ? Visible.Shot : 0,
            Stride: Visible ? Visible.Stride : 0,
            Rays: Visible ? Visible.Shot * Visible.Rays : 0,
        },
    };
};

//--------------------------------------------------------------------------------------------------------------------------
// Padding. Every island ends somewhere, and a renderer filtering a texel at the edge of one reaches past it into
// whatever was left there — black, usually, which arrives as a dark seam down the middle of a model. So the edge is
// walked outwards, one ring of texels at a time, each new texel taking the average of the filled neighbours it can see.
//--------------------------------------------------------------------------------------------------------------------------
export const Dilate = (Pixels, Coverage, Size, Rings) =>
{
    let Known = Uint8Array.from(Coverage);
    for (let Ring = 0; Ring < Rings; Ring += 1)
    {
        const Grown = Uint8Array.from(Known);
        let Spread = 0;
        for (let Row = 0; Row < Size; Row += 1)
            for (let Column = 0; Column < Size; Column += 1)
            {
                const Texel = Row * Size + Column;
                if (Known[Texel]) continue;
                let R = 0;
                let G = 0;
                let B = 0;
                let A = 0;
                let Taken = 0;
                for (let StepY = -1; StepY <= 1; StepY += 1)
                    for (let StepX = -1; StepX <= 1; StepX += 1)
                    {
                        const Y = Row + StepY;
                        const X = Column + StepX;
                        if (X < 0 || Y < 0 || X >= Size || Y >= Size) continue;
                        const Near = Y * Size + X;
                        if (!Known[Near]) continue;
                        R += Pixels[Near * 4];
                        G += Pixels[Near * 4 + 1];
                        B += Pixels[Near * 4 + 2];
                        A += Pixels[Near * 4 + 3];
                        Taken += 1;
                    }
                if (!Taken) continue;
                Pixels[Texel * 4] = R / Taken;
                Pixels[Texel * 4 + 1] = G / Taken;
                Pixels[Texel * 4 + 2] = B / Taken;
                Pixels[Texel * 4 + 3] = A / Taken;
                Grown[Texel] = 1;
                Spread += 1;
            }
        Known = Grown;
        if (!Spread) break;
    }
    return Pixels;
};
