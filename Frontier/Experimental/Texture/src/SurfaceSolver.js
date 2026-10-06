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
        const Left = Math.max(0, Math.floor(Math.min(AX, BX, CX) - 0.5));
        const Right = Math.min(Size - 1, Math.ceil(Math.max(AX, BX, CX) + 0.5));
        const Bottom = Math.max(0, Math.floor(Math.min(AY, BY, CY) - 0.5));
        const Top = Math.min(Size - 1, Math.ceil(Math.max(AY, BY, CY) + 0.5));
        for (let Row = Bottom; Row <= Top; Row += 1)
            for (let Column = Left; Column <= Right; Column += 1)
            {
                const X = Column + 0.5;
                const Y = Row + 0.5;
                let Weight0 = ((BX - X) * (CY - Y) - (CX - X) * (BY - Y)) / Area;
                let Weight1 = ((CX - X) * (AY - Y) - (AX - X) * (CY - Y)) / Area;
                let Weight2 = 1 - Weight0 - Weight1;
                const Slack = -0.5 / Math.max(1, Math.abs(Area) ** 0.5);
                if (Weight0 < Slack || Weight1 < Slack || Weight2 < Slack) continue;
                Weight0 = Clamp(Weight0, 0, 1);
                Weight1 = Clamp(Weight1, 0, 1);
                Weight2 = Clamp(Weight2, 0, 1);
                const Total = Weight0 + Weight1 + Weight2 || 1;
                Weight0 /= Total;
                Weight1 /= Total;
                Weight2 /= Total;
                const Texel = Row * Size + Column;
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
            }
    }

    return Sheets;
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
