//============================================================================================================================================
// 📐 SurfaceSolver.js — what the model knows about itself, measured once into texture space
//============================================================================================================================================
// A generator that only ever sees a UV coordinate can draw noise and nothing else. Dust has to know which way is up,
// dirt has to know where the crevices are, edge wear has to know which edges there are, and a mask that selects one
// object has to know where that object ended up on the sheet. All of that is the model talking about itself, and none
// of it is in the texture — so it is measured here, once, and read by everything afterwards.
//
// The measurement is a rasterisation of the mesh in UV space. Every triangle is walked over the texels its own UV
// triangle covers, and each texel is handed the interpolated position, normal and occlusion of the surface under it
// along with the identity of what it belongs to: which object, which UDIM tile, which UV island, which triangle.
// Curvature comes afterwards from the position and normal sheets, because curvature is a relationship between
// neighbouring texels rather than a property of any one of them.
//
// 🔴 This runs on the CPU on purpose. The same thing could be rasterised by the device in a fraction of the time, and
//    then it would be a number nobody can read: no test could assert a dust mask sits on the upward faces, and no
//    driver could check that selecting an object selects that object. The sheets are plain arrays, which is what
//    makes every generator built on them answerable.
//============================================================================================================================================

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Value));

const Normalise = (Vector) =>
{
    const Length = Math.hypot(Vector[0], Vector[1], Vector[2]) || 1;
    return [Vector[0] / Length, Vector[1] / Length, Vector[2] / Length];
};

// The sheets are square and no larger than this. A mask is a low-frequency thing — the device samples it bilinearly
// over whatever the document's resolution is — and the measurement is paid for in seconds of somebody's attention.
export const SheetLimit = 1024;

export const SheetSize = (Resolution = 512) => Clamp(Math.round(Resolution), 64, SheetLimit);

//--------------------------------------------------------------------------------------------------------------------------
// UV islands. Two triangles belong to the same island when they share an edge in UV space as well as in the mesh, which
// is what a seam is: an edge where the two sides were cut apart on the sheet.
//--------------------------------------------------------------------------------------------------------------------------
export const MeasureIslands = (Surface) =>
{
    const Triangles = Surface.Indices.length / 3;
    const Island = new Int32Array(Triangles).fill(-1);
    const Edges = new Map();
    const Key = (A, B) =>
    {
        // An edge is named by its two UV corners rounded to the texel, so a seam — where the corners differ — names
        // two different edges and the two sides never meet.
        const Round = (Vertex) =>
            `${Math.round(Surface.Coordinates[Vertex * 2] * 65536)},${Math.round(Surface.Coordinates[Vertex * 2 + 1] * 65536)}`;
        const First = Round(A);
        const Second = Round(B);
        return First < Second ? `${First}|${Second}` : `${Second}|${First}`;
    };
    for (let Triangle = 0; Triangle < Triangles; Triangle += 1)
    {
        const A = Surface.Indices[Triangle * 3];
        const B = Surface.Indices[Triangle * 3 + 1];
        const C = Surface.Indices[Triangle * 3 + 2];
        for (const Edge of [Key(A, B), Key(B, C), Key(C, A)])
        {
            const Found = Edges.get(Edge);
            if (Found) Found.push(Triangle);
            else Edges.set(Edge, [Triangle]);
        }
    }
    const Neighbours = new Map();
    for (const Shared of Edges.values())
    {
        if (Shared.length < 2) continue;
        for (const One of Shared)
            for (const Other of Shared)
            {
                if (One === Other) continue;
                const List = Neighbours.get(One);
                if (List) List.push(Other);
                else Neighbours.set(One, [Other]);
            }
    }
    let Count = 0;
    const Pending = [];
    for (let Seed = 0; Seed < Triangles; Seed += 1)
    {
        if (Island[Seed] >= 0) continue;
        Island[Seed] = Count;
        Pending.length = 0;
        Pending.push(Seed);
        while (Pending.length)
        {
            const Current = Pending.pop();
            for (const Next of Neighbours.get(Current) || [])
                if (Island[Next] < 0)
                {
                    Island[Next] = Count;
                    Pending.push(Next);
                }
        }
        Count += 1;
    }
    return { Island, Count };
};

//--------------------------------------------------------------------------------------------------------------------------
// Thickness. How much model is behind each vertex: rays into the surface, the near ones meaning a thin wall. It is the
// measurement behind wax, marble, an ear lit from behind and the dirt that collects where two walls nearly meet.
//--------------------------------------------------------------------------------------------------------------------------
export const MeasureThickness = (Surface, Index, Samples = 12) =>
{
    const Count = Surface.Positions.length / 3;
    const Thickness = new Float32Array(Count).fill(1);
    if (!Index) return Thickness;
    const Radius = Surface.Bounds.Radius * 2;
    const GoldenAngle = Math.PI * (3 - Math.sqrt(5));
    // 🔴 A ray that leaves at a grazing angle hits the neighbouring triangle a thousandth of a unit later and reports
    //    a wall thinner than paper, which is how a solid ball came to read as a sheet of foil. The cone is held off
    //    the tangent plane, and it starts deep enough that the surface it left is behind it.
    const Depth = Math.max(1e-4, Surface.Bounds.Radius * 2e-3);
    for (let Vertex = 0; Vertex < Count; Vertex += 1)
    {
        const Normal = [Surface.Normals[Vertex * 3], Surface.Normals[Vertex * 3 + 1], Surface.Normals[Vertex * 3 + 2]];
        const Origin = [
            Surface.Positions[Vertex * 3] - Normal[0] * Depth,
            Surface.Positions[Vertex * 3 + 1] - Normal[1] * Depth,
            Surface.Positions[Vertex * 3 + 2] - Normal[2] * Depth,
        ];
        const Reference = Math.abs(Normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const TangentX = Normalise([
            Reference[1] * Normal[2] - Reference[2] * Normal[1],
            Reference[2] * Normal[0] - Reference[0] * Normal[2],
            Reference[0] * Normal[1] - Reference[1] * Normal[0],
        ]);
        const TangentY = [
            Normal[1] * TangentX[2] - Normal[2] * TangentX[1],
            Normal[2] * TangentX[0] - Normal[0] * TangentX[2],
            Normal[0] * TangentX[1] - Normal[1] * TangentX[0],
        ];
        let Total = 0;
        let Taken = 0;
        for (let Sample = 0; Sample < Samples; Sample += 1)
        {
            const Fraction = ((Sample + 0.5) / Samples) * 0.72;
            const CosineTheta = Math.sqrt(1 - Fraction);
            const SineTheta = Math.sqrt(Fraction);
            const Angle = Sample * GoldenAngle;
            const Direction = Normalise([
                TangentX[0] * Math.cos(Angle) * SineTheta + TangentY[0] * Math.sin(Angle) * SineTheta - Normal[0] * CosineTheta,
                TangentX[1] * Math.cos(Angle) * SineTheta + TangentY[1] * Math.sin(Angle) * SineTheta - Normal[1] * CosineTheta,
                TangentX[2] * Math.cos(Angle) * SineTheta + TangentY[2] * Math.sin(Angle) * SineTheta - Normal[2] * CosineTheta,
            ]);
            const Hit = Index.Raycast(Origin, Direction, Radius);
            Total += Hit ? Clamp(Hit.Distance / Radius, 0, 1) : 1;
            Taken += 1;
        }
        Thickness[Vertex] = Taken ? Total / Taken : 1;
    }
    return Thickness;
};

//--------------------------------------------------------------------------------------------------------------------------
// The rasterisation. One pass over the triangles, writing every sheet at once.
//--------------------------------------------------------------------------------------------------------------------------
export const MeasureSurface = (Surface, Options = {}) =>
{
    const Size = SheetSize(Options.Size || 512);
    const Texels = Size * Size;
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
        Owners: [],
        Tiles: [],
        Islands: 0,
        Triangles: Surface.Indices.length / 3,
    };
    const Triangles = Sheets.Triangles;
    const { Island, Count } = Options.Islands || MeasureIslands(Surface);
    Sheets.Islands = Count;
    const Thickness = Options.Thickness || null;
    const Bend = Options.Curvature || MeasureCurvature(Surface);

    // Which object and which tile each triangle belongs to, read off the ranges the scene was assembled from.
    const Ranges = Surface.Ranges || [];
    const Owner = new Int32Array(Triangles).fill(-1);
    const Tile = new Int32Array(Triangles).fill(-1);
    Ranges.forEach((Range, Position) =>
    {
        for (let Step = 0; Step < Range.TriangleCount; Step += 1)
        {
            Owner[Range.FirstTriangle + Step] = Position;
            Tile[Range.FirstTriangle + Step] = Range.Tile;
        }
        Sheets.Owners.push({ Identifier: Range.Identifier, Name: Range.Name, Tile: Range.Tile, Index: Position });
        if (!Sheets.Tiles.includes(Range.Tile)) Sheets.Tiles.push(Range.Tile);
    });
    Sheets.Tiles.sort((A, B) => A - B);

    const Lowest = Surface.Bounds.Minimum[1];
    const Span = Math.max(1e-6, Surface.Bounds.Maximum[1] - Lowest);

    RasteriseSurface(Surface, { Size }, (Texel, Triangle, Weight0, Weight1, Weight2, IA, IB, IC) =>
    {
        Sheets.Filled[Texel] = 1;
        Sheets.Face[Texel] = Triangle;
        Sheets.Owner[Texel] = Owner[Triangle];
        Sheets.Tile[Texel] = Tile[Triangle];
        Sheets.Island[Texel] = Island[Triangle];
        for (let Axis = 0; Axis < 3; Axis += 1)
        {
            Sheets.Position[Texel * 3 + Axis] =
                Surface.Positions[IA * 3 + Axis] * Weight0 +
                Surface.Positions[IB * 3 + Axis] * Weight1 +
                Surface.Positions[IC * 3 + Axis] * Weight2;
            Sheets.Normal[Texel * 3 + Axis] =
                Surface.Normals[IA * 3 + Axis] * Weight0 +
                Surface.Normals[IB * 3 + Axis] * Weight1 +
                Surface.Normals[IC * 3 + Axis] * Weight2;
        }
        if (Surface.Occlusion)
            Sheets.Occlusion[Texel] =
                Surface.Occlusion[IA] * Weight0 + Surface.Occlusion[IB] * Weight1 + Surface.Occlusion[IC] * Weight2;
        if (Thickness)
            Sheets.Thickness[Texel] = Thickness[IA] * Weight0 + Thickness[IB] * Weight1 + Thickness[IC] * Weight2;
        Sheets.Curvature[Texel] = Bend[IA] * Weight0 + Bend[IB] * Weight1 + Bend[IC] * Weight2;
        Sheets.Altitude[Texel] = Clamp((Sheets.Position[Texel * 3 + 1] - Lowest) / Span, 0, 1);
    });

    // 🔴 Hand this an index and it traces, which is the only way the occlusion and cavity generators ever see a
    //    crease they can draw dirt in. Without one it falls back to whatever the vertices were told, and a mask
    //    built on vertex occlusion is a mask with the triangles showing through it.
    if (Options.Index)
    {
        const Seen = MeasureVisibility(Surface, Options.Index, Sheets, {
            Rays: Options.Rays || 16,
            Resolution: Options.Resolution || 192,
        });
        Sheets.Occlusion = Seen.Occlusion;
        Sheets.Thickness = Seen.Thickness;
        Sheets.Bent = Seen.Bent;
        Sheets.Traced = Seen.Shot;
    }

    return Sheets;
};

//--------------------------------------------------------------------------------------------------------------------------
// The walk itself, so everything that reads the model into texture space reads it the same way. The sample point is the
// texel's centre plus an offset, which is the whole of what antialiasing needs from a rasteriser: take the same pass
// again from a slightly different place inside the texel and weigh the answers against each other.
//--------------------------------------------------------------------------------------------------------------------------
export const RasteriseSurface = (Surface, Options, Visit) =>
{
    const Size = Options.Size;
    const OffsetX = Options.Offset ? Options.Offset[0] : 0;
    const OffsetY = Options.Offset ? Options.Offset[1] : 0;
    const Reach = Math.max(0.5, Math.abs(OffsetX), Math.abs(OffsetY)) + 0.5;
    const Triangles = Surface.Indices.length / 3;
    for (let Triangle = 0; Triangle < Triangles; Triangle += 1)
    {
        const IA = Surface.Indices[Triangle * 3];
        const IB = Surface.Indices[Triangle * 3 + 1];
        const IC = Surface.Indices[Triangle * 3 + 2];
        const AX = Surface.Coordinates[IA * 2] * Size;
        const AY = Surface.Coordinates[IA * 2 + 1] * Size;
        const BX = Surface.Coordinates[IB * 2] * Size;
        const BY = Surface.Coordinates[IB * 2 + 1] * Size;
        const CX = Surface.Coordinates[IC * 2] * Size;
        const CY = Surface.Coordinates[IC * 2 + 1] * Size;
        const Area = (BX - AX) * (CY - AY) - (CX - AX) * (BY - AY);
        if (Math.abs(Area) < 1e-9) continue;
        // A half-texel of overdraw, so the seam between two triangles is covered by both rather than by neither.
        const Left = Math.max(0, Math.floor(Math.min(AX, BX, CX) - Reach));
        const Right = Math.min(Size - 1, Math.ceil(Math.max(AX, BX, CX) + Reach));
        const Bottom = Math.max(0, Math.floor(Math.min(AY, BY, CY) - Reach));
        const Top = Math.min(Size - 1, Math.ceil(Math.max(AY, BY, CY) + Reach));
        const Slack = -0.5 / Math.max(1, Math.abs(Area) ** 0.5);
        for (let Row = Bottom; Row <= Top; Row += 1)
            for (let Column = Left; Column <= Right; Column += 1)
            {
                const X = Column + 0.5 + OffsetX;
                const Y = Row + 0.5 + OffsetY;
                let Weight0 = ((BX - X) * (CY - Y) - (CX - X) * (BY - Y)) / Area;
                let Weight1 = ((CX - X) * (AY - Y) - (AX - X) * (CY - Y)) / Area;
                let Weight2 = 1 - Weight0 - Weight1;
                if (Weight0 < Slack || Weight1 < Slack || Weight2 < Slack) continue;
                Weight0 = Clamp(Weight0, 0, 1);
                Weight1 = Clamp(Weight1, 0, 1);
                Weight2 = Clamp(Weight2, 0, 1);
                const Total = Weight0 + Weight1 + Weight2 || 1;
                Visit(Row * Size + Column, Triangle, Weight0 / Total, Weight1 / Total, Weight2 / Total, IA, IB, IC);
            }
    }
};

//--------------------------------------------------------------------------------------------------------------------------
// Curvature. How far a vertex's neighbours sit off its own tangent plane: negative on a convex edge, positive in a
// crevice, near zero on anything flat or gently round.
//
// 🔴 Measured on the mesh rather than on the sheet, and the mesh is welded by position first. A cube's corner is three
//    vertices with three normals and its faces are three islands, so neither the index buffer nor the texture knows
//    those three are the same corner — read either of them and every edge of every hard-surface model reads as flat.
//    Welding by position is what lets an edge be an edge.
//--------------------------------------------------------------------------------------------------------------------------
export const MeasureCurvature = (Surface) =>
{
    const Count = Surface.Positions.length / 3;
    const Curvature = new Float32Array(Count);
    const Welded = new Map();
    const Place = (Vertex) =>
        `${Math.round(Surface.Positions[Vertex * 3] * 8192)},${Math.round(Surface.Positions[Vertex * 3 + 1] * 8192)},${Math.round(
            Surface.Positions[Vertex * 3 + 2] * 8192,
        )}`;
    const Corner = new Array(Count);
    for (let Vertex = 0; Vertex < Count; Vertex += 1)
    {
        const Key = Place(Vertex);
        Corner[Vertex] = Key;
        const Found = Welded.get(Key);
        if (Found) Found.push(Vertex);
        else Welded.set(Key, [Vertex]);
    }
    // Neighbours by welded corner, so the ring around a vertex is the ring on the model.
    const Ring = new Map();
    const Join = (One, Other) =>
    {
        const List = Ring.get(One);
        if (List) List.add(Other);
        else Ring.set(One, new Set([Other]));
    };
    for (let Triangle = 0; Triangle < Surface.Indices.length; Triangle += 3)
    {
        const A = Corner[Surface.Indices[Triangle]];
        const B = Corner[Surface.Indices[Triangle + 1]];
        const C = Corner[Surface.Indices[Triangle + 2]];
        Join(A, B);
        Join(B, A);
        Join(B, C);
        Join(C, B);
        Join(C, A);
        Join(A, C);
    }
    const Anchor = new Map();
    for (const [Key, Group] of Welded) Anchor.set(Key, Group[0]);
    // 🔴 The reading is a real curvature — the reciprocal of the radius the surface is turning on — scaled by the
    //    model's own radius so it is a number about the shape rather than a number about the tessellation. A sphere
    //    answers a quarter however finely it is divided; a bevel two percent of the model across saturates.
    const Gain = 0.5 * Math.max(1e-6, Surface.Bounds?.Radius || 1);
    for (let Vertex = 0; Vertex < Count; Vertex += 1)
    {
        const Neighbours = Ring.get(Corner[Vertex]);
        if (!Neighbours || !Neighbours.size) continue;
        const NX = Surface.Normals[Vertex * 3];
        const NY = Surface.Normals[Vertex * 3 + 1];
        const NZ = Surface.Normals[Vertex * 3 + 2];
        const PX = Surface.Positions[Vertex * 3];
        const PY = Surface.Positions[Vertex * 3 + 1];
        const PZ = Surface.Positions[Vertex * 3 + 2];
        let Sum = 0;
        let Taken = 0;
        for (const Key of Neighbours)
        {
            const Other = Anchor.get(Key);
            if (Other === undefined) continue;
            const DX = Surface.Positions[Other * 3] - PX;
            const DY = Surface.Positions[Other * 3 + 1] - PY;
            const DZ = Surface.Positions[Other * 3 + 2] - PZ;
            const Length = Math.hypot(DX, DY, DZ);
            if (Length < 1e-9) continue;
            Sum += (DX * NX + DY * NY + DZ * NZ) / (Length * Length);
            Taken += 1;
        }
        Curvature[Vertex] = Taken ? Clamp((Sum / Taken) * Gain, -1, 1) : 0;
    }
    return Curvature;
};

//--------------------------------------------------------------------------------------------------------------------------
// Bent normals. The same hemisphere the occlusion rays went out over, averaged over the ones that got away: the
// direction the sky actually reaches this point from. On a flat wall it is the normal; in a corner it leans out of the
// corner, which is what makes it worth having over the normal it came from.
//--------------------------------------------------------------------------------------------------------------------------
export const MeasureBentNormals = (Surface, Index, Samples = 24) =>
{
    const Count = Surface.Positions.length / 3;
    const Bent = new Float32Array(Count * 3);
    const Radius = Surface.Bounds.Radius * 1.4;
    const GoldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let Vertex = 0; Vertex < Count; Vertex += 1)
    {
        const NX = Surface.Normals[Vertex * 3];
        const NY = Surface.Normals[Vertex * 3 + 1];
        const NZ = Surface.Normals[Vertex * 3 + 2];
        if (!Index)
        {
            Bent[Vertex * 3] = NX;
            Bent[Vertex * 3 + 1] = NY;
            Bent[Vertex * 3 + 2] = NZ;
            continue;
        }
        const Origin = [
            Surface.Positions[Vertex * 3] + NX * 1e-3,
            Surface.Positions[Vertex * 3 + 1] + NY * 1e-3,
            Surface.Positions[Vertex * 3 + 2] + NZ * 1e-3,
        ];
        const Reference = Math.abs(NY) < 0.9 ? [0, 1, 0] : [1, 0, 0];
        const TangentX = Normalise([
            Reference[1] * NZ - Reference[2] * NY,
            Reference[2] * NX - Reference[0] * NZ,
            Reference[0] * NY - Reference[1] * NX,
        ]);
        const TangentY = [NY * TangentX[2] - NZ * TangentX[1], NZ * TangentX[0] - NX * TangentX[2], NX * TangentX[1] - NY * TangentX[0]];
        let SumX = 0;
        let SumY = 0;
        let SumZ = 0;
        for (let Sample = 0; Sample < Samples; Sample += 1)
        {
            const Fraction = (Sample + 0.5) / Samples;
            const CosineTheta = Math.sqrt(1 - Fraction);
            const SineTheta = Math.sqrt(Fraction);
            const Angle = Sample * GoldenAngle;
            const Cosine = Math.cos(Angle) * SineTheta;
            const Sine = Math.sin(Angle) * SineTheta;
            const Direction = Normalise([
                TangentX[0] * Cosine + TangentY[0] * Sine + NX * CosineTheta,
                TangentX[1] * Cosine + TangentY[1] * Sine + NY * CosineTheta,
                TangentX[2] * Cosine + TangentY[2] * Sine + NZ * CosineTheta,
            ]);
            if (Index.Occluded(Origin, Direction, Radius)) continue;
            SumX += Direction[0];
            SumY += Direction[1];
            SumZ += Direction[2];
        }
        const Length = Math.hypot(SumX, SumY, SumZ);
        // 🔴 A point that sees nothing has no direction to lean in, and normalising zero is a NaN that spreads
        //    through every texel the vertex touches. It keeps its own normal, which is what a sealed crack looks like.
        if (Length < 1e-6)
        {
            Bent[Vertex * 3] = NX;
            Bent[Vertex * 3 + 1] = NY;
            Bent[Vertex * 3 + 2] = NZ;
            continue;
        }
        Bent[Vertex * 3] = SumX / Length;
        Bent[Vertex * 3 + 1] = SumY / Length;
        Bent[Vertex * 3 + 2] = SumZ / Length;
    }
    return Bent;
};

//--------------------------------------------------------------------------------------------------------------------------
// Bevel normals — Blender's bevel node, which rounds an edge in the shading without rounding it in the geometry. The
// node does it by tracing; here the surface is already a soup of vertices with normals on them, so the normal field is
// averaged over a sphere of the bevel's radius instead. Either way a corner's two faces meet in the middle, and a flat
// wall is left alone because every neighbour inside the radius is already pointing the same way.
//
// 🔴 Gathered by POSITION, not by edge. A hard corner is duplicated once per face and each copy carries its own
//    normal — averaging along the index buffer would average a face with itself and bevel nothing.
//--------------------------------------------------------------------------------------------------------------------------
export const MeasureBevelNormals = (Surface, Width = 0.05) =>
{
    const Count = Surface.Positions.length / 3;
    const Bevel = new Float32Array(Count * 3);
    const Radius = Math.max(1e-5, Width) * Math.max(1e-6, Surface.Bounds.Radius);
    const Cell = Radius;
    const Shelves = new Map();
    const Key = (X, Y, Z) => `${Math.floor(X / Cell)}|${Math.floor(Y / Cell)}|${Math.floor(Z / Cell)}`;
    for (let Vertex = 0; Vertex < Count; Vertex += 1)
    {
        const Name = Key(Surface.Positions[Vertex * 3], Surface.Positions[Vertex * 3 + 1], Surface.Positions[Vertex * 3 + 2]);
        const Shelf = Shelves.get(Name);
        if (Shelf) Shelf.push(Vertex);
        else Shelves.set(Name, [Vertex]);
    }
    for (let Vertex = 0; Vertex < Count; Vertex += 1)
    {
        const PX = Surface.Positions[Vertex * 3];
        const PY = Surface.Positions[Vertex * 3 + 1];
        const PZ = Surface.Positions[Vertex * 3 + 2];
        const CX = Math.floor(PX / Cell);
        const CY = Math.floor(PY / Cell);
        const CZ = Math.floor(PZ / Cell);
        let SumX = 0;
        let SumY = 0;
        let SumZ = 0;
        for (let StepX = -1; StepX <= 1; StepX += 1)
            for (let StepY = -1; StepY <= 1; StepY += 1)
                for (let StepZ = -1; StepZ <= 1; StepZ += 1)
                {
                    const Shelf = Shelves.get(`${CX + StepX}|${CY + StepY}|${CZ + StepZ}`);
                    if (!Shelf) continue;
                    for (const Other of Shelf)
                    {
                        const Distance = Math.hypot(
                            Surface.Positions[Other * 3] - PX,
                            Surface.Positions[Other * 3 + 1] - PY,
                            Surface.Positions[Other * 3 + 2] - PZ,
                        );
                        if (Distance > Radius) continue;
                        // Smooth falloff, so a vertex that drifts in and out of the radius does not snap the shading.
                        const Weight = 1 - (Distance / Radius) ** 2;
                        SumX += Surface.Normals[Other * 3] * Weight;
                        SumY += Surface.Normals[Other * 3 + 1] * Weight;
                        SumZ += Surface.Normals[Other * 3 + 2] * Weight;
                    }
                }
        const Length = Math.hypot(SumX, SumY, SumZ);
        if (Length < 1e-6)
        {
            Bevel[Vertex * 3] = Surface.Normals[Vertex * 3];
            Bevel[Vertex * 3 + 1] = Surface.Normals[Vertex * 3 + 1];
            Bevel[Vertex * 3 + 2] = Surface.Normals[Vertex * 3 + 2];
            continue;
        }
        Bevel[Vertex * 3] = SumX / Length;
        Bevel[Vertex * 3 + 1] = SumY / Length;
        Bevel[Vertex * 3 + 2] = SumZ / Length;
    }
    return Bevel;
};

//--------------------------------------------------------------------------------------------------------------------------
// Visibility — occlusion, bent normals and thickness, traced from the texel instead of from the vertex.
//
// Every one of these three is an integral over the hemisphere above a point, and until now the point was a VERTEX.
// The sheet then got those vertex answers smeared across it by the rasteriser's barycentrics, which is Gouraud
// shading an ambient occlusion map: a 15,000-vertex shader ball carries about as much occlusion detail as a 122×122
// image, so a 512×512 bake spent 99% of its texels interpolating between answers it did not have. That is what the
// triangle facets in the occlusion map were. There is no filter that fixes it, because the detail was never measured.
//
// So the rays start at the texel. Not at every texel — occlusion is a low-frequency signal and a sheet is as big as
// the painter wants it to be, so the trace runs on a lattice of one texel in `Stride` and the rest is reconstructed
// from it. The cost then follows the MODEL rather than the sheet: a 2048² bake traces exactly as many rays as a
// 512² one and simply reconstructs them further.
//
// 🔴 The reconstruction is a joint bilateral gather, not a blur. A traced neighbour only counts for a texel if it
//    sits on the same island, faces the same way and is actually nearby in WORLD space. Two texels can be adjacent on
//    the sheet and be on opposite sides of a wall; blurring the first into the second is how ambient occlusion leaks
//    through solid geometry, and it looks exactly like the facets it replaced.
//--------------------------------------------------------------------------------------------------------------------------
export const MeasureVisibility = (Surface, Index, Sheets, Options = {}) =>
{
    const Size = Sheets.Size;
    const Texels = Size * Size;
    const Rays = Math.max(4, Math.round(Options.Rays ?? 24));
    const Budget = Math.max(32, Math.round(Options.Resolution ?? 256));
    const Stride = Math.max(1, Math.ceil(Size / Budget));
    const Announce = Options.Progress || (() => {});

    const Radius = (Surface.Bounds && Surface.Bounds.Radius) || 1;
    // Two reaches, because the two questions are different ones. Occlusion asks what is nearby and stops at one
    // and two fifths of the model; thickness asks how far it is to the other side and has to be able to cross it.
    const Reach = Radius * 1.4;
    const Through = Radius * 2;
    // 🔴 The bias is a fraction of the MODEL, not a constant. A fixed 1e-3 is a tenth of a millimetre on a metre-wide
    //    model and a third of the whole thing on a centimetre-wide one, where every ray starts outside the surface it
    //    was meant to leave and the occlusion map comes back blank.
    const Lift = Math.max(1e-7, Radius * 2e-4);
    // 🔴 Thickness rays start a hair under the surface, and the hair has to be a hair. The old sink was two
    //    thousandths of the model, which is outside anything thinner than four — a blade, the lip of a plinth —
    //    and a ray that starts outside the solid escapes and reports it as infinitely thick. The rays point inward
    //    anyway, so it is the t-bias and not the origin that keeps them off the triangle they left.
    const Sink = Lift;
    const GoldenAngle = Math.PI * (3 - Math.sqrt(5));

    const Filled = Sheets.Filled;
    const Spots = Sheets.Position;
    const Facing = Sheets.Normal;
    const Island = Sheets.Island || new Int32Array(Texels);

    const Occlusion = new Float32Array(Texels).fill(1);
    const Bent = new Float32Array(Texels * 3);
    const Thickness = new Float32Array(Texels).fill(1);
    const Traced = new Uint8Array(Texels);
    const Sunk = new Uint8Array(Texels);

    // How much of the world one texel covers, measured rather than assumed: the sheet's scale depends entirely on how
    // the model was unwrapped, and the bilateral weights downstream are all in world units.
    let Span = 0;
    let Spans = 0;
    for (let Y = 0; Y < Size; Y += 1)
    {
        for (let X = 0; X < Size - 1; X += 1)
        {
            const Here = Y * Size + X;
            const Next = Here + 1;
            if (!Filled[Here] || !Filled[Next] || Island[Here] !== Island[Next]) continue;
            Span += Math.hypot(
                Spots[Next * 3] - Spots[Here * 3],
                Spots[Next * 3 + 1] - Spots[Here * 3 + 1],
                Spots[Next * 3 + 2] - Spots[Here * 3 + 2]);
            Spans += 1;
        }
    }
    Span = Spans ? Span / Spans : Radius / Size;
    if (!(Span > 0)) Span = Radius / Size;

    // One texel's worth of rays. Returns nothing; writes straight into the sheets.
    const Shoot = (Texel, Thick) =>
    {
        const PX = Spots[Texel * 3];
        const PY = Spots[Texel * 3 + 1];
        const PZ = Spots[Texel * 3 + 2];
        const NX = Facing[Texel * 3];
        const NY = Facing[Texel * 3 + 1];
        const NZ = Facing[Texel * 3 + 2];
        // A frame on the texel's own normal. The branch keeps the cross product away from its degenerate axis.
        const AX = Math.abs(NX) < 0.9 ? 1 : 0;
        const AY = Math.abs(NX) < 0.9 ? 0 : 1;
        let TX = NY * 0 - NZ * AY;
        let TY = NZ * AX - NX * 0;
        let TZ = NX * AY - NY * AX;
        const TL = Math.hypot(TX, TY, TZ) || 1;
        TX /= TL; TY /= TL; TZ /= TL;
        const BX = NY * TZ - NZ * TY;
        const BY = NZ * TX - NX * TZ;
        const BZ = NX * TY - NY * TX;

        // 🔴 Every texel gets its own rotation and its own jitter. One shared ray set is a fixed pattern, and a fixed
        //    pattern in an occlusion map is not noise the eye forgives — it is banding, which is what the eye looks for.
        const Shuffle = Math.sin(Texel * 12.9898 + 78.233) * 43758.5453;
        const Spin = (Shuffle - Math.floor(Shuffle)) * Math.PI * 2;
        const Wobble = Math.sin(Texel * 39.3468 + 11.135) * 24634.6345;
        const Jitter = Wobble - Math.floor(Wobble);

        let Open = 0;
        let SumX = 0;
        let SumY = 0;
        let SumZ = 0;
        const OX = PX + NX * Lift;
        const OY = PY + NY * Lift;
        const OZ = PZ + NZ * Lift;
        for (let Ray = 0; Ray < Rays; Ray += 1)
        {
            // Stratified cosine hemisphere. The radius is stratified over the ray index so the samples cannot clump,
            // and the angle is the golden one so consecutive rays never line up.
            const Fraction = (Ray + Jitter) / Rays;
            const Sine = Math.sqrt(Fraction);
            const Cosine = Math.sqrt(1 - Fraction);
            const Angle = Ray * GoldenAngle + Spin;
            const Across = Math.cos(Angle) * Sine;
            const Along = Math.sin(Angle) * Sine;
            const DX = TX * Across + BX * Along + NX * Cosine;
            const DY = TY * Across + BY * Along + NY * Cosine;
            const DZ = TZ * Across + BZ * Along + NZ * Cosine;
            if (Index.Blocked(OX, OY, OZ, DX, DY, DZ, Reach)) continue;
            Open += 1;
            SumX += DX;
            SumY += DY;
            SumZ += DZ;
        }
        Occlusion[Texel] = Open / Rays;
        const Length = Math.hypot(SumX, SumY, SumZ);
        if (Length < 1e-6)
        {
            Bent[Texel * 3] = NX;
            Bent[Texel * 3 + 1] = NY;
            Bent[Texel * 3 + 2] = NZ;
        }
        else
        {
            Bent[Texel * 3] = SumX / Length;
            Bent[Texel * 3 + 1] = SumY / Length;
            Bent[Texel * 3 + 2] = SumZ / Length;
        }
        Traced[Texel] = 1;
        if (!Thick) return;

        // Thickness looks the other way, from just under the surface, and wants the distance rather than a yes or no.
        const Inside = Math.max(4, Rays >> 1);
        const UX = PX - NX * Sink;
        const UY = PY - NY * Sink;
        const UZ = PZ - NZ * Sink;
        let Total = 0;
        for (let Ray = 0; Ray < Inside; Ray += 1)
        {
            const Fraction = ((Ray + Jitter) / Inside) * 0.72;
            const Sine = Math.sqrt(Fraction);
            const Cosine = Math.sqrt(1 - Fraction);
            const Angle = Ray * GoldenAngle + Spin;
            const Across = Math.cos(Angle) * Sine;
            const Along = Math.sin(Angle) * Sine;
            const DX = TX * Across + BX * Along - NX * Cosine;
            const DY = TY * Across + BY * Along - NY * Cosine;
            const DZ = TZ * Across + BZ * Along - NZ * Cosine;
            const Hit = Index.Travel(UX, UY, UZ, DX, DY, DZ, Through, true, Lift);
            Total += Number.isFinite(Hit) ? Clamp(Hit / Through, 0, 1) : 1;
        }
        Thickness[Texel] = Total / Inside;
        Sunk[Texel] = 1;
    };

    // 🔴 Thickness is traced on half the lattice of the other two. It is the smoothest of the three by a wide margin —
    //    it is the distance to the far side of a solid — and it is the only one that cannot stop at the first hit,
    //    so it is both the cheapest to reconstruct and the dearest to measure. Trace it a quarter as often.
    const Half = Stride >> 1;
    const Deep = Stride * 2;
    let Shot = 0;
    for (let Y = Half; Y < Size; Y += Stride)
    {
        // 🔴 The thickness lattice is every other point of the occlusion lattice, which means it has to be measured
        //    off the same origin. Centring it independently puts it on texels the outer loop never visits, and then
        //    nothing is traced at all and every texel falls through to the slow path — a four-second bake becomes
        //    thirty-one, which is exactly what happened the first time this was written.
        const Thick = (Y - Half) % Deep === 0;
        for (let X = Half; X < Size; X += Stride)
        {
            const Texel = Y * Size + X;
            if (!Filled[Texel]) continue;
            Shoot(Texel, Thick && (X - Half) % Deep === 0);
            Shot += 1;
        }
        Announce(Y / Size);
    }

    // The reconstruction. Each filled texel gathers from the lattice points around it, weighted by how much of the
    // same surface they are standing on. Traced texels are gathered too, which is what turns twenty-four rays of
    // Monte Carlo noise into a clean number — the gather is averaging around a hundred rays by the time it is done.
    const Resolve = (Values, Width, Mark, Step, Offset, Rings) =>
    {
        const Output = new Float32Array(Values.length);
        const Sigma = Span * Step * 2;
        const Falloff = 1 / (Sigma * Sigma);
        const Missing = [];
        for (let Y = 0; Y < Size; Y += 1)
        {
            for (let X = 0; X < Size; X += 1)
            {
                const Texel = Y * Size + X;
                if (!Filled[Texel]) continue;
                const PX = Spots[Texel * 3];
                const PY = Spots[Texel * 3 + 1];
                const PZ = Spots[Texel * 3 + 2];
                const NX = Facing[Texel * 3];
                const NY = Facing[Texel * 3 + 1];
                const NZ = Facing[Texel * 3 + 2];
                const Home = Island[Texel];
                // Walk the lattice itself rather than the texels between it — the lattice is where the answers are.
                const BaseX = Offset + Math.round((X - Offset) / Step) * Step;
                const BaseY = Offset + Math.round((Y - Offset) / Step) * Step;
                let Weight = 0;
                let SumA = 0;
                let SumB = 0;
                let SumC = 0;
                for (let Down = -Rings; Down <= Rings; Down += 1)
                {
                    const AtY = BaseY + Down * Step;
                    if (AtY < 0 || AtY >= Size) continue;
                    for (let Over = -Rings; Over <= Rings; Over += 1)
                    {
                        const AtX = BaseX + Over * Step;
                        if (AtX < 0 || AtX >= Size) continue;
                        const Other = AtY * Size + AtX;
                        if (!Mark[Other]) continue;
                        // 🔴 Island first. Two texels can be neighbours on the sheet and on opposite sides of the
                        //    model; the only thing stopping occlusion from leaking through a wall is this line.
                        if (Island[Other] !== Home) continue;
                        const Agree = NX * Facing[Other * 3] + NY * Facing[Other * 3 + 1] + NZ * Facing[Other * 3 + 2];
                        if (Agree <= 0.1) continue;
                        const DX = Spots[Other * 3] - PX;
                        const DY = Spots[Other * 3 + 1] - PY;
                        const DZ = Spots[Other * 3 + 2] - PZ;
                        const Away = (DX * DX + DY * DY + DZ * DZ) * Falloff;
                        if (Away > 9) continue;
                        const Share = Math.exp(-Away) * Agree * Agree * Agree;
                        Weight += Share;
                        SumA += Values[Other * Width] * Share;
                        if (Width === 3)
                        {
                            SumB += Values[Other * Width + 1] * Share;
                            SumC += Values[Other * Width + 2] * Share;
                        }
                    }
                }
                if (Weight <= 1e-9)
                {
                    Missing.push(Texel);
                    continue;
                }
                Output[Texel * Width] = SumA / Weight;
                if (Width === 3)
                {
                    Output[Texel * Width + 1] = SumB / Weight;
                    Output[Texel * Width + 2] = SumC / Weight;
                }
            }
        }
        return { Output, Missing };
    };

    // 🔴 A texel the lattice cannot reach is traced outright rather than guessed at. An island one texel wide, a
    //    sliver at the edge of a shell, a face steep enough that none of its neighbours agree with it — the gather
    //    finds nothing for any of them, and a nothing written into an occlusion map is a black hole on the model.
    const Missed = new Set();
    const First = Resolve(Occlusion, 1, Traced, Stride, Half, 3);
    for (const Texel of First.Missing) Missed.add(Texel);
    const Second = Resolve(Thickness, 1, Sunk, Deep, Half, 3);
    for (const Texel of Second.Missing) Missed.add(Texel);
    for (const Texel of Missed)
    {
        if (!Traced[Texel] || !Sunk[Texel]) Shoot(Texel, true);
        First.Output[Texel] = Occlusion[Texel];
        Second.Output[Texel] = Thickness[Texel];
        Shot += 1;
    }
    const Third = Resolve(Bent, 3, Traced, Stride, Half, 3);
    for (const Texel of Third.Missing)
    {
        Third.Output[Texel * 3] = Facing[Texel * 3];
        Third.Output[Texel * 3 + 1] = Facing[Texel * 3 + 1];
        Third.Output[Texel * 3 + 2] = Facing[Texel * 3 + 2];
    }
    for (let Texel = 0; Texel < Texels; Texel += 1)
    {
        if (!Filled[Texel]) continue;
        const Length = Math.hypot(Third.Output[Texel * 3], Third.Output[Texel * 3 + 1], Third.Output[Texel * 3 + 2]);
        if (Length < 1e-6) continue;
        Third.Output[Texel * 3] /= Length;
        Third.Output[Texel * 3 + 1] /= Length;
        Third.Output[Texel * 3 + 2] /= Length;
    }
    Announce(1);

    return {
        Occlusion: First.Output,
        Thickness: Second.Output,
        Bent: Third.Output,
        Traced,
        Stride,
        Span,
        Shot,
        Rays,
    };
};
