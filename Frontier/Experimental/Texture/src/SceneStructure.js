//==========================================================================================================================================
// 🧩 SceneStructure.js — several objects in one paintable scene, laid out across UDIM tiles.
// Each object is built on its own, placed by a transform, and its coordinates are pushed into its UDIM tile before every
// object is concatenated into a single surface. One surface means one bake, one spatial index and one stroke that can
// cross from object to object; the tile offsets are what keep their texture space apart.
// Tile numbering follows the UDIM convention: 1001 + Column + Row × 10, so 1001 is the bottom-left tile of the grid.
//==========================================================================================================================================

import { BuildSurface, ComputeBounds, ComputeTangents } from "./SurfaceStructure.js";

export const TileColumns = 10;
export const FirstTile = 1001;

export const TileNumber = (Column, Row) => FirstTile + Column + Row * TileColumns;

export const TilePlacement = (Tile) =>
{
    const Offset = Math.max(0, Math.round(Tile) - FirstTile);
    return { Column: Offset % TileColumns, Row: Math.floor(Offset / TileColumns) };
};

export const TileLabel = (Tile) => `UDIM ${Math.round(Tile)}`;

//--------------------------------------------------------------------------------------------------------------------------
// Object records.
//--------------------------------------------------------------------------------------------------------------------------
let ObjectCounter = 0;

export const ResetObjectCounter = (Value = 0) =>
{
    ObjectCounter = Value;
};

export const NextObjectIdentifier = () =>
{
    ObjectCounter += 1;
    return `object-${ObjectCounter.toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`;
};

export const ObjectDefaults = () => ({
    Identifier: NextObjectIdentifier(),
    Name: "Shader ball",
    Kind: "shaderball",
    Subdivision: 2,
    Scale: 1,
    Offset: [0, 0, 0],
    Rotation: 0,
    Tile: FirstTile,
    Visible: true,
    Locked: false,
});

export const CreateObject = (Overrides = {}) => ({ ...ObjectDefaults(), ...Overrides, Offset: [...(Overrides.Offset || [0, 0, 0])] });

const Clamp = (Value, Low, High) => Math.min(High, Math.max(Low, Number.isFinite(Value) ? Value : Low));

// Kinds BuildSurface can answer for, plus the imported one. Kept here so an object can be sanitised on its own.
export const ObjectKinds = ["shaderball", "sphere", "cube", "cylinder", "torus", "plane", "custom"];

export const SanitiseObject = (Candidate, Surfaces = ObjectKinds.map((Kind) => ({ Identifier: Kind }))) =>
{
    const Object_ = ObjectDefaults();
    if (!Candidate || typeof Candidate !== "object") return Object_;
    if (typeof Candidate.Identifier === "string") Object_.Identifier = Candidate.Identifier;
    if (typeof Candidate.Name === "string") Object_.Name = Candidate.Name.slice(0, 64);
    const Known = (Surfaces || []).some((Surface) => (Surface.Identifier || Surface) === Candidate.Kind);
    Object_.Kind = Known ? Candidate.Kind : "cube";
    Object_.Subdivision = Math.round(Clamp(Candidate.Subdivision ?? 2, 0, 3));
    Object_.Scale = Clamp(Candidate.Scale ?? 1, 0.1, 10);
    Object_.Rotation = Clamp(Candidate.Rotation ?? 0, 0, 360);
    Object_.Offset = Array.isArray(Candidate.Offset)
        ? [0, 1, 2].map((Axis) => (Number.isFinite(Candidate.Offset[Axis]) ? Clamp(Candidate.Offset[Axis], -12, 12) : 0))
        : [0, 0, 0];
    Object_.Tile = Math.round(Clamp(Candidate.Tile ?? FirstTile, FirstTile, FirstTile + 99));
    Object_.Visible = Candidate.Visible !== false;
    Object_.Locked = Boolean(Candidate.Locked);
    return Object_;
};

//--------------------------------------------------------------------------------------------------------------------------
// The tile grid the scene occupies. Only the tiles objects actually sit in are counted, so a single-object scene stays a
// plain 0-1 square and nothing about the old behaviour changes.
//--------------------------------------------------------------------------------------------------------------------------
export const SceneTiles = (Objects) =>
{
    const Used = Objects.filter((Entry) => Entry.Visible !== false).map((Entry) => TilePlacement(Entry.Tile));
    const Columns = Used.reduce((Widest, Place) => Math.max(Widest, Place.Column + 1), 1);
    const Rows = Used.reduce((Tallest, Place) => Math.max(Tallest, Place.Row + 1), 1);
    const Span = Math.max(Columns, Rows);                       // a square canvas keeps texels square in every tile
    return { Columns: Span, Rows: Span };
};

export const TileRectangle = (Tile, Span) =>
{
    const Place = TilePlacement(Tile);
    const Size = 1 / Math.max(Span, 1);
    return { Left: Place.Column * Size, Bottom: Place.Row * Size, Size };
};

//--------------------------------------------------------------------------------------------------------------------------
// Assembly. Every visible object is built, transformed and folded into one surface; the ranges that come back say which
// triangles belong to which object so a hit can be named.
//--------------------------------------------------------------------------------------------------------------------------
const RotateY = (Vector, Degrees) =>
{
    if (!Degrees) return Vector;
    const Angle = (Degrees * Math.PI) / 180;
    const Sine = Math.sin(Angle);
    const Cosine = Math.cos(Angle);
    return [Vector[0] * Cosine + Vector[2] * Sine, Vector[1], -Vector[0] * Sine + Vector[2] * Cosine];
};

export const AssembleScene = (Objects, Imported = null) =>
{
    const Visible = Objects.filter((Entry) => Entry.Visible);
    const Chosen = Visible.length ? Visible : Objects.slice(0, 1);
    const { Columns, Rows } = SceneTiles(Chosen);
    const Span = Math.max(Columns, Rows);
    const Parts = [];
    for (const Entry of Chosen)
    {
        const Built = Entry.Kind === "custom" && Imported ? Imported : BuildSurface(Entry.Kind, Entry.Subdivision);
        Parts.push({ Entry, Built });
    }
    const VertexTotal = Parts.reduce((Sum, Part) => Sum + Part.Built.Positions.length / 3, 0);
    const IndexTotal = Parts.reduce((Sum, Part) => Sum + Part.Built.Indices.length, 0);
    const Positions = new Float32Array(VertexTotal * 3);
    const Normals = new Float32Array(VertexTotal * 3);
    const Coordinates = new Float32Array(VertexTotal * 2);
    const Occlusion = new Float32Array(VertexTotal).fill(1);
    const Ownership = new Float32Array(VertexTotal);
    const Indices = new Uint32Array(IndexTotal);
    const Ranges = [];
    let VertexCursor = 0;
    let IndexCursor = 0;
    Parts.forEach((Part, Position_) =>
    {
        const { Entry, Built } = Part;
        const Count = Built.Positions.length / 3;
        const Rectangle = TileRectangle(Entry.Tile, Span);
        for (let Index = 0; Index < Count; Index += 1)
        {
            const Local = RotateY(
                [
                    Built.Positions[Index * 3] * Entry.Scale,
                    Built.Positions[Index * 3 + 1] * Entry.Scale,
                    Built.Positions[Index * 3 + 2] * Entry.Scale,
                ],
                Entry.Rotation,
            );
            const Normal = RotateY(
                [Built.Normals[Index * 3], Built.Normals[Index * 3 + 1], Built.Normals[Index * 3 + 2]],
                Entry.Rotation,
            );
            const Target = (VertexCursor + Index) * 3;
            Positions[Target] = Local[0] + Entry.Offset[0];
            Positions[Target + 1] = Local[1] + Entry.Offset[1];
            Positions[Target + 2] = Local[2] + Entry.Offset[2];
            Normals[Target] = Normal[0];
            Normals[Target + 1] = Normal[1];
            Normals[Target + 2] = Normal[2];
            const Pair = (VertexCursor + Index) * 2;
            Coordinates[Pair] = Rectangle.Left + Built.Coordinates[Index * 2] * Rectangle.Size;
            Coordinates[Pair + 1] = Rectangle.Bottom + Built.Coordinates[Index * 2 + 1] * Rectangle.Size;
            Ownership[VertexCursor + Index] = Position_;
        }
        for (let Index = 0; Index < Built.Indices.length; Index += 1) Indices[IndexCursor + Index] = Built.Indices[Index] + VertexCursor;
        Ranges.push({
            Identifier: Entry.Identifier,
            Name: Entry.Name,
            Tile: Entry.Tile,
            FirstVertex: VertexCursor,
            VertexCount: Count,
            FirstTriangle: IndexCursor / 3,
            TriangleCount: Built.Indices.length / 3,
            Bounds: Built.Bounds,
        });
        VertexCursor += Count;
        IndexCursor += Built.Indices.length;
    });
    const Tangents = ComputeTangents(Positions, Normals, Coordinates, Indices);
    const Bounds = ComputeBounds(Positions);
    const Label = Chosen.length === 1 ? Chosen[0].Name : `${Chosen.length} objects`;
    return {
        Label,
        Positions,
        Normals,
        Tangents,
        Coordinates,
        Occlusion,
        Ownership,
        Indices,
        Bounds,
        Ranges,
        Tiles: { Columns: Span, Rows: Span },
        Triangles: Indices.length / 3,
        Vertices: VertexTotal,
    };
};

// Which object a picked triangle belongs to.
export const ObjectAtTriangle = (Surface, Triangle) =>
{
    for (const Range of Surface?.Ranges || [])
        if (Triangle >= Range.FirstTriangle && Triangle < Range.FirstTriangle + Range.TriangleCount) return Range;
    return null;
};

export const ObjectAtCoordinate = (Surface, Coordinate) =>
{
    const Span = Surface?.Tiles?.Columns || 1;
    const Column = Math.floor(Clamp(Coordinate[0], 0, 0.9999) * Span);
    const Row = Math.floor(Clamp(Coordinate[1], 0, 0.9999) * Span);
    const Tile = TileNumber(Column, Row);
    return (Surface?.Ranges || []).find((Range) => Range.Tile === Tile) || null;
};

export const CoordinateTile = (Surface, Coordinate) =>
{
    const Span = Surface?.Tiles?.Columns || 1;
    const Column = Math.floor(Clamp(Coordinate[0], 0, 0.9999) * Span);
    const Row = Math.floor(Clamp(Coordinate[1], 0, 0.9999) * Span);
    return TileNumber(Column, Row);
};
