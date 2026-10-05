//============================================================================================================================================
// 🧊 SurfaceStructure.js — authored surfaces, tangent frames, a median-split BVH, occlusion baking and Wavefront import
//============================================================================================================================================
// Every surface arrives as one interleaved record: positions, normals, tangents (xyzw with the bitangent sign), texture
// coordinates, per-vertex occlusion and an index list. UV islands are packed by hand per surface so that nothing overlaps —
// a texture painter cannot share texels between two places on the model. The BVH serves both the brush ray query and the
// occlusion bake; it is a plain median split over centroids, which is ample for the 4 k – 40 k triangles in play here.
//============================================================================================================================================

const Tau = Math.PI * 2;

//--------------------------------------------------------------------------------------------------------------------------
// Builder — accumulates vertices and triangles, then resolves tangents and bounds.
//--------------------------------------------------------------------------------------------------------------------------
class SurfaceBuilder
{
    constructor()
    {
        this.Positions = [];
        this.Normals = [];
        this.Coordinates = [];
        this.Indices = [];
    }

    Vertex(Position, Normal, Coordinate)
    {
        this.Positions.push(Position[0], Position[1], Position[2]);
        this.Normals.push(Normal[0], Normal[1], Normal[2]);
        this.Coordinates.push(Coordinate[0], Coordinate[1]);
        return this.Positions.length / 3 - 1;
    }

    Triangle(A, B, C)
    {
        this.Indices.push(A, B, C);
    }

    Quad(A, B, C, D)
    {
        this.Triangle(A, B, C);
        this.Triangle(A, C, D);
    }

    // A rectangular patch evaluated from a parametric function f(u, v) → { Position, Normal, Coordinate }.
    Patch(Columns, Rows, Evaluate)
    {
        const First = this.Positions.length / 3;
        for (let Row = 0; Row <= Rows; Row += 1)
            for (let Column = 0; Column <= Columns; Column += 1)
            {
                const Sample = Evaluate(Column / Columns, Row / Rows);
                this.Vertex(Sample.Position, Sample.Normal, Sample.Coordinate);
            }
        for (let Row = 0; Row < Rows; Row += 1)
            for (let Column = 0; Column < Columns; Column += 1)
            {
                const A = First + Row * (Columns + 1) + Column;
                const B = A + 1;
                const C = A + Columns + 2;
                const D = A + Columns + 1;
                this.Quad(A, B, C, D);
            }
    }

    Resolve(Label)
    {
        const Positions = new Float32Array(this.Positions);
        const Normals = new Float32Array(this.Normals);
        const Coordinates = new Float32Array(this.Coordinates);
        const Indices = new Uint32Array(this.Indices);
        const Tangents = ComputeTangents(Positions, Normals, Coordinates, Indices);
        const Bounds = ComputeBounds(Positions);
        return {
            Label,
            Positions,
            Normals,
            Tangents,
            Coordinates,
            Indices,
            Occlusion: new Float32Array(Positions.length / 3).fill(1),
            Bounds,
            Triangles: Indices.length / 3,
            Vertices: Positions.length / 3,
        };
    }
}

export const ComputeBounds = (Positions) =>
{
    const Minimum = [Infinity, Infinity, Infinity];
    const Maximum = [-Infinity, -Infinity, -Infinity];
    for (let Index = 0; Index < Positions.length; Index += 3)
        for (let Axis = 0; Axis < 3; Axis += 1)
        {
            const Value = Positions[Index + Axis];
            if (Value < Minimum[Axis]) Minimum[Axis] = Value;
            if (Value > Maximum[Axis]) Maximum[Axis] = Value;
        }
    const Centre = [0, 1, 2].map((Axis) => (Minimum[Axis] + Maximum[Axis]) / 2);
    const Extent = [0, 1, 2].map((Axis) => (Maximum[Axis] - Minimum[Axis]) / 2);
    const Radius = Math.hypot(Extent[0], Extent[1], Extent[2]);
    return { Minimum, Maximum, Centre, Extent, Radius };
};

export const ComputeTangents = (Positions, Normals, Coordinates, Indices) =>
{
    const Count = Positions.length / 3;
    const Accumulated = new Float32Array(Count * 3);
    const Bitangents = new Float32Array(Count * 3);
    for (let Index = 0; Index < Indices.length; Index += 3)
    {
        const [A, B, C] = [Indices[Index], Indices[Index + 1], Indices[Index + 2]];
        const Ax = Positions[A * 3], Ay = Positions[A * 3 + 1], Az = Positions[A * 3 + 2];
        const Edge1 = [Positions[B * 3] - Ax, Positions[B * 3 + 1] - Ay, Positions[B * 3 + 2] - Az];
        const Edge2 = [Positions[C * 3] - Ax, Positions[C * 3 + 1] - Ay, Positions[C * 3 + 2] - Az];
        const Au = Coordinates[A * 2], Av = Coordinates[A * 2 + 1];
        const Delta1 = [Coordinates[B * 2] - Au, Coordinates[B * 2 + 1] - Av];
        const Delta2 = [Coordinates[C * 2] - Au, Coordinates[C * 2 + 1] - Av];
        const Determinant = Delta1[0] * Delta2[1] - Delta2[0] * Delta1[1];
        if (Math.abs(Determinant) < 1e-12) continue;
        const Inverse = 1 / Determinant;
        const Tangent = [
            (Delta2[1] * Edge1[0] - Delta1[1] * Edge2[0]) * Inverse,
            (Delta2[1] * Edge1[1] - Delta1[1] * Edge2[1]) * Inverse,
            (Delta2[1] * Edge1[2] - Delta1[1] * Edge2[2]) * Inverse,
        ];
        const Bitangent = [
            (Delta1[0] * Edge2[0] - Delta2[0] * Edge1[0]) * Inverse,
            (Delta1[0] * Edge2[1] - Delta2[0] * Edge1[1]) * Inverse,
            (Delta1[0] * Edge2[2] - Delta2[0] * Edge1[2]) * Inverse,
        ];
        for (const Vertex of [A, B, C])
            for (let Axis = 0; Axis < 3; Axis += 1)
            {
                Accumulated[Vertex * 3 + Axis] += Tangent[Axis];
                Bitangents[Vertex * 3 + Axis] += Bitangent[Axis];
            }
    }
    const Tangents = new Float32Array(Count * 4);
    for (let Vertex = 0; Vertex < Count; Vertex += 1)
    {
        const Nx = Normals[Vertex * 3], Ny = Normals[Vertex * 3 + 1], Nz = Normals[Vertex * 3 + 2];
        let Tx = Accumulated[Vertex * 3], Ty = Accumulated[Vertex * 3 + 1], Tz = Accumulated[Vertex * 3 + 2];
        if (Tx * Tx + Ty * Ty + Tz * Tz < 1e-16)
        {
            const Reference = Math.abs(Nz) < 0.9 ? [0, 0, 1] : [1, 0, 0];
            Tx = Reference[1] * Nz - Reference[2] * Ny;
            Ty = Reference[2] * Nx - Reference[0] * Nz;
            Tz = Reference[0] * Ny - Reference[1] * Nx;
        }
        const Dot = Tx * Nx + Ty * Ny + Tz * Nz;
        Tx -= Nx * Dot;
        Ty -= Ny * Dot;
        Tz -= Nz * Dot;
        const Length = Math.hypot(Tx, Ty, Tz) || 1;
        Tangents[Vertex * 4] = Tx / Length;
        Tangents[Vertex * 4 + 1] = Ty / Length;
        Tangents[Vertex * 4 + 2] = Tz / Length;
        const Cross = [Ny * Tz - Nz * Ty, Nz * Tx - Nx * Tz, Nx * Ty - Ny * Tx];
        const Handedness =
            Cross[0] * Bitangents[Vertex * 3] + Cross[1] * Bitangents[Vertex * 3 + 1] + Cross[2] * Bitangents[Vertex * 3 + 2];
        Tangents[Vertex * 4 + 3] = Handedness < 0 ? -1 : 1;
    }
    return Tangents;
};

//--------------------------------------------------------------------------------------------------------------------------
// Authored surfaces. UV islands are laid out so that no two places on the model share a texel.
//--------------------------------------------------------------------------------------------------------------------------
const Normalise = (Vector) =>
{
    const Length = Math.hypot(Vector[0], Vector[1], Vector[2]) || 1;
    return [Vector[0] / Length, Vector[1] / Length, Vector[2] / Length];
};

const BuildSphere = (Detail) =>
{
    const Builder = new SurfaceBuilder();
    const Columns = 48 + Detail * 24;
    const Rows = 24 + Detail * 12;
    Builder.Patch(Columns, Rows, (U, V) =>
    {
        const Theta = U * Tau;
        const Phi = V * Math.PI;
        const Normal = [Math.sin(Phi) * Math.cos(Theta), Math.cos(Phi), Math.sin(Phi) * Math.sin(Theta)];
        return { Position: Normal.map((Component) => Component * 0.85), Normal, Coordinate: [U, 1 - V] };
    });
    return Builder.Resolve("Sphere");
};

const BuildRoundedCube = (Detail) =>
{
    const Builder = new SurfaceBuilder();
    const Segments = 12 + Detail * 8;
    const Radius = 0.28;
    const Faces = [
        { Axis: [1, 0, 0], Up: [0, 1, 0], Right: [0, 0, -1], Island: [0, 0] },
        { Axis: [-1, 0, 0], Up: [0, 1, 0], Right: [0, 0, 1], Island: [1, 0] },
        // 🔴 The two caps take a left-handed Right so their winding comes out facing the same way as their normals;
        //    with [1, 0, 0] the top and bottom of the cube are built inside out and their islands run mirrored.
        { Axis: [0, 1, 0], Up: [0, 0, 1], Right: [-1, 0, 0], Island: [2, 0] },
        { Axis: [0, -1, 0], Up: [0, 0, -1], Right: [-1, 0, 0], Island: [0, 1] },
        { Axis: [0, 0, 1], Up: [0, 1, 0], Right: [1, 0, 0], Island: [1, 1] },
        { Axis: [0, 0, -1], Up: [0, 1, 0], Right: [-1, 0, 0], Island: [2, 1] },
    ];
    const Margin = 0.006;
    for (const Face of Faces)
        Builder.Patch(Segments, Segments, (U, V) =>
        {
            const X = U * 2 - 1;
            const Y = V * 2 - 1;
            const Point = [0, 1, 2].map((Axis) => Face.Axis[Axis] + Face.Right[Axis] * X + Face.Up[Axis] * Y);
            // Round the cube by pulling the surface towards a sphere near the edges (squircle blend).
            const Folded = Point.map((Component) =>
                Math.sign(Component) * Math.min(1, Math.abs(Component)),
            );
            const Inner = Folded.map((Component) => Math.sign(Component) * Math.max(0, Math.abs(Component) - Radius));
            const Offset = Normalise([
                Folded[0] - Inner[0],
                Folded[1] - Inner[1],
                Folded[2] - Inner[2],
            ]);
            const Position = [0, 1, 2].map((Axis) => (Inner[Axis] + Offset[Axis] * Radius) * 0.72);
            const Normal = Offset;
            const Coordinate = [
                (Face.Island[0] + Margin + U * (1 - Margin * 2)) / 3,
                1 - (Face.Island[1] + Margin + (1 - V) * (1 - Margin * 2)) / 2,
            ];
            return { Position, Normal, Coordinate };
        });
    return Builder.Resolve("Rounded cube");
};

const BuildCylinder = (Detail) =>
{
    const Builder = new SurfaceBuilder();
    const Columns = 48 + Detail * 24;
    const Height = 0.95;
    const Radius = 0.6;
    Builder.Patch(Columns, 8 + Detail * 4, (U, V) =>
    {
        const Theta = U * Tau;
        const Normal = [Math.cos(Theta), 0, Math.sin(Theta)];
        return {
            Position: [Normal[0] * Radius, (0.5 - V) * 2 * Height, Normal[2] * Radius],
            Normal,
            Coordinate: [U, 0.28 + (1 - V) * 0.7],
        };
    });
    for (const Side of [1, -1])
        Builder.Patch(Columns, 8, (U, V) =>
        {
            const Theta = U * Tau;
            const Distance = V * Radius;
            const IslandX = Side > 0 ? 0.0 : 0.5;
            return {
                Position: [Math.cos(Theta) * Distance, Side * Height, Math.sin(Theta) * Distance * Side],
                Normal: [0, Side, 0],
                Coordinate: [
                    IslandX + 0.25 + Math.cos(Theta) * V * 0.23,
                    0.13 + Math.sin(Theta) * V * 0.12,
                ],
            };
        });
    return Builder.Resolve("Cylinder");
};

const BuildTorus = (Detail) =>
{
    const Builder = new SurfaceBuilder();
    const Columns = 64 + Detail * 32;
    const Rows = 24 + Detail * 16;
    const Major = 0.62;
    const Minor = 0.26;
    Builder.Patch(Columns, Rows, (U, V) =>
    {
        const Theta = U * Tau;
        const Phi = (1 - V) * Tau;                                // [rad] walked downward, so the winding faces out
        const Normal = [Math.cos(Phi) * Math.cos(Theta), Math.sin(Phi), Math.cos(Phi) * Math.sin(Theta)];
        const Position = [
            (Major + Minor * Math.cos(Phi)) * Math.cos(Theta),
            Minor * Math.sin(Phi),
            (Major + Minor * Math.cos(Phi)) * Math.sin(Theta),
        ];
        return { Position, Normal, Coordinate: [U, 1 - V] };
    });
    return Builder.Resolve("Torus");
};

const BuildPlane = (Detail) =>
{
    const Builder = new SurfaceBuilder();
    const Segments = 24 + Detail * 24;
    Builder.Patch(Segments, Segments, (U, V) => ({
        Position: [(U - 0.5) * 1.8, 0.0, (0.5 - V) * 1.8],
        Normal: [0, 1, 0],
        Coordinate: [U, 1 - V],
    }));
    return Builder.Resolve("Plane");
};

//--------------------------------------------------------------------------------------------------------------------------
// Profiles of revolution. A profile is a dense polyline in the (radius, height) half-plane; revolving it gives a closed
// surface whose normals come from the profile's own tangent rather than from a guess, which is what the old shader ball
// got wrong. Walking the outline counter-clockwise puts (dy, -dr) on the outside, at a pole as happily as on a wall.
//--------------------------------------------------------------------------------------------------------------------------
const ProfileLine = (Into, From, To, Steps) =>
{
    for (let Step = 1; Step <= Steps; Step += 1)
    {
        const T = Step / Steps;
        Into.push([From[0] + (To[0] - From[0]) * T, From[1] + (To[1] - From[1]) * T]);
    }
};

const ProfileArc = (Into, Centre, Radius, FromAngle, ToAngle, Steps) =>
{
    for (let Step = 1; Step <= Steps; Step += 1)
    {
        const Angle = FromAngle + (ToAngle - FromAngle) * (Step / Steps);
        Into.push([Centre[0] + Math.cos(Angle) * Radius, Centre[1] + Math.sin(Angle) * Radius]);
    }
};

const ProfileCurve = (Into, A, B, C, D, Steps) =>
{
    for (let Step = 1; Step <= Steps; Step += 1)
    {
        const T = Step / Steps;
        const S = 1 - T;
        Into.push([
            S * S * S * A[0] + 3 * S * S * T * B[0] + 3 * S * T * T * C[0] + T * T * T * D[0],
            S * S * S * A[1] + 3 * S * S * T * B[1] + 3 * S * T * T * C[1] + T * T * T * D[1],
        ]);
    }
};

// Revolves one profile into the builder. The patch is walked from the end of the profile to its start so the winding
// matches the rest of the catalogue — every other builder runs its second parameter downward — while the texture
// coordinate still climbs with the model.
const Revolve = (Builder, Profile, Columns, Bottom, Top) =>
{
    const Count = Profile.length;
    const Lengths = [0];
    for (let Index = 1; Index < Count; Index += 1)
        Lengths.push(Lengths[Index - 1] + Math.hypot(Profile[Index][0] - Profile[Index - 1][0], Profile[Index][1] - Profile[Index - 1][1]));
    const Total = Lengths[Lengths.length - 1] || 1;
    const Rows = Count - 1;
    Builder.Patch(Columns, Rows, (U, V) =>
    {
        const Step = Math.round((1 - V) * Rows);
        const Index = Math.min(Count - 1, Step);
        const Before = Profile[Math.max(0, Index - 1)];
        const After = Profile[Math.min(Count - 1, Index + 1)];
        const Here = Profile[Index];
        const Run = [After[0] - Before[0], After[1] - Before[1]];
        const Length = Math.hypot(Run[0], Run[1]) || 1;
        const Side = [Run[1] / Length, -Run[0] / Length];        // [-]   outward in the (radius, height) half-plane
        const Theta = U * Tau;
        const Along = Lengths[Step] / Total;
        return {
            Position: [Here[0] * Math.cos(Theta), Here[1], Here[0] * Math.sin(Theta)],
            Normal: Normalise([Side[0] * Math.cos(Theta), Side[1], Side[0] * Math.sin(Theta)]),
            Coordinate: [U, Bottom + Along * (Top - Bottom)],
        };
    });
};

//--------------------------------------------------------------------------------------------------------------------------
// The shader ball: one sphere lifted on a waisted stem out of a filleted plinth, revolved from a single profile so the
// model is one closed shell on one UV island. Everything a material has to be judged on is on it — a flat underside, a
// tight convex fillet, a deep concave throat, a hard overhang under the sphere's equator, and the ball itself as a broad
// uninterrupted sweep for a decal. Nothing surrounds the ball: the subject is never hidden behind its own stand.
//--------------------------------------------------------------------------------------------------------------------------
const BuildShaderBall = (Detail) =>
{
    const Builder = new SurfaceBuilder();
    const Columns = 64 + Detail * 24;
    const Fine = 0.7 + Detail * 0.3;
    const Steps = (Count) => Math.max(2, Math.round(Count * Fine));

    const Ball = { Radius: 0.50, Height: 1.00 };
    const Meeting = (150 * Math.PI) / 180;                        // [rad] where the stem's shoulder joins the sphere
    const Joint = [Math.sin(Meeting) * Ball.Radius, Ball.Height + Math.cos(Meeting) * Ball.Radius];
    const Body = [[0, 0]];
    ProfileLine(Body, [0, 0], [0.58, 0], Steps(8));               // flat underside, out to the rim of the plinth
    ProfileArc(Body, [0.58, 0.045], 0.045, -Math.PI / 2, 0, Steps(6));
    ProfileLine(Body, [0.625, 0.045], [0.625, 0.085], Steps(3));  // plinth wall
    ProfileArc(Body, [0.545, 0.085], 0.08, 0, Math.PI / 2, Steps(9));
    ProfileCurve(Body, [0.545, 0.165], [0.36, 0.20], [0.20, 0.21], [0.165, 0.38], Steps(22));
    ProfileCurve(Body, [0.165, 0.38], [0.135, 0.52], [0.16, 0.56], Joint, Steps(12));
    for (let Step = 1; Step <= Steps(40); Step += 1)
    {
        const Angle = Meeting * (1 - Step / Steps(40));
        Body.push([Math.sin(Angle) * Ball.Radius, Ball.Height + Math.cos(Angle) * Ball.Radius]);
    }
    Revolve(Builder, Body, Columns, 0.01, 0.99);

    return Builder.Resolve("Shader ball");
};

const Builders = {
    sphere: BuildSphere,
    cube: BuildRoundedCube,
    cylinder: BuildCylinder,
    torus: BuildTorus,
    plane: BuildPlane,
    shaderball: BuildShaderBall,
};

export const BuildSurface = (Kind = "shaderball", Detail = 1) =>
{
    const Builder = Builders[Kind] || Builders.shaderball;
    return Builder(Math.max(0, Math.min(3, Math.round(Detail))));
};

//--------------------------------------------------------------------------------------------------------------------------
// Wavefront OBJ import. Positions are recentred and scaled into the editor's unit volume.
//--------------------------------------------------------------------------------------------------------------------------
export const ParseWavefront = (Text, Label = "Imported mesh") =>
{
    const Positions = [];
    const Coordinates = [];
    const Normals = [];
    const Builder = new SurfaceBuilder();
    const Lookup = new Map();
    const Lines = String(Text).split(/\r?\n/);
    const Resolve = (Token) =>
    {
        if (Lookup.has(Token)) return Lookup.get(Token);
        const Parts = Token.split("/");
        const PositionIndex = Number.parseInt(Parts[0], 10);
        const CoordinateIndex = Parts[1] ? Number.parseInt(Parts[1], 10) : 0;
        const NormalIndex = Parts[2] ? Number.parseInt(Parts[2], 10) : 0;
        const Position = ReadTriple(Positions, PositionIndex, [0, 0, 0]);
        const Coordinate = CoordinateIndex ? ReadPair(Coordinates, CoordinateIndex) : null;
        const Normal = NormalIndex ? ReadTriple(Normals, NormalIndex, [0, 1, 0]) : [0, 0, 0];
        const Index = Builder.Vertex(Position, Normal, Coordinate || [0, 0]);
        Lookup.set(Token, Index);
        return Index;
    };
    let HasCoordinates = false;
    for (const Line of Lines)
    {
        if (!Line || Line[0] === "#") continue;
        const Parts = Line.trim().split(/\s+/);
        const Keyword = Parts[0];
        if (Keyword === "v") Positions.push(Number(Parts[1]), Number(Parts[2]), Number(Parts[3]));
        else if (Keyword === "vt")
        {
            Coordinates.push(Number(Parts[1]), Number(Parts[2]));
            HasCoordinates = true;
        }
        else if (Keyword === "vn") Normals.push(Number(Parts[1]), Number(Parts[2]), Number(Parts[3]));
        else if (Keyword === "f")
        {
            const Corners = Parts.slice(1).map(Resolve);
            for (let Index = 1; Index + 1 < Corners.length; Index += 1)
                Builder.Triangle(Corners[0], Corners[Index], Corners[Index + 1]);
        }
    }
    if (!Builder.Indices.length) throw new Error("No triangles were found in that OBJ.");
    const Surface = Builder.Resolve(Label);
    RecentreSurface(Surface);
    if (!HasCoordinates) ApplySphericalCoordinates(Surface);
    if (!Normals.length) RecomputeNormals(Surface);
    const Rebuilt = ComputeTangents(Surface.Positions, Surface.Normals, Surface.Coordinates, Surface.Indices);
    Surface.Tangents.set(Rebuilt);
    Surface.Bounds = ComputeBounds(Surface.Positions);
    return Surface;
};

const ReadTriple = (Source, Index, Fallback) =>
{
    const Offset = (Index > 0 ? Index - 1 : Source.length / 3 + Index) * 3;
    if (Offset < 0 || Offset + 2 >= Source.length + 1) return Fallback;
    return [Source[Offset] || 0, Source[Offset + 1] || 0, Source[Offset + 2] || 0];
};

const ReadPair = (Source, Index) =>
{
    const Offset = (Index > 0 ? Index - 1 : Source.length / 2 + Index) * 2;
    return [Source[Offset] || 0, Source[Offset + 1] || 0];
};

const RecentreSurface = (Surface) =>
{
    const Bounds = ComputeBounds(Surface.Positions);
    const Scale = 0.95 / (Bounds.Radius || 1);
    for (let Index = 0; Index < Surface.Positions.length; Index += 3)
    {
        Surface.Positions[Index] = (Surface.Positions[Index] - Bounds.Centre[0]) * Scale;
        Surface.Positions[Index + 1] = (Surface.Positions[Index + 1] - Bounds.Centre[1]) * Scale;
        Surface.Positions[Index + 2] = (Surface.Positions[Index + 2] - Bounds.Centre[2]) * Scale;
    }
    Surface.Bounds = ComputeBounds(Surface.Positions);
};

const ApplySphericalCoordinates = (Surface) =>
{
    for (let Vertex = 0; Vertex < Surface.Positions.length / 3; Vertex += 1)
    {
        const X = Surface.Positions[Vertex * 3];
        const Y = Surface.Positions[Vertex * 3 + 1];
        const Z = Surface.Positions[Vertex * 3 + 2];
        const Length = Math.hypot(X, Y, Z) || 1;
        Surface.Coordinates[Vertex * 2] = 0.5 + Math.atan2(Z, X) / Tau;
        Surface.Coordinates[Vertex * 2 + 1] = 1 - Math.acos(Math.max(-1, Math.min(1, Y / Length))) / Math.PI;
    }
};

const RecomputeNormals = (Surface) =>
{
    Surface.Normals.fill(0);
    for (let Index = 0; Index < Surface.Indices.length; Index += 3)
    {
        const [A, B, C] = [Surface.Indices[Index], Surface.Indices[Index + 1], Surface.Indices[Index + 2]];
        const Edge1 = [0, 1, 2].map((Axis) => Surface.Positions[B * 3 + Axis] - Surface.Positions[A * 3 + Axis]);
        const Edge2 = [0, 1, 2].map((Axis) => Surface.Positions[C * 3 + Axis] - Surface.Positions[A * 3 + Axis]);
        const Face = [
            Edge1[1] * Edge2[2] - Edge1[2] * Edge2[1],
            Edge1[2] * Edge2[0] - Edge1[0] * Edge2[2],
            Edge1[0] * Edge2[1] - Edge1[1] * Edge2[0],
        ];
        for (const Vertex of [A, B, C])
            for (let Axis = 0; Axis < 3; Axis += 1) Surface.Normals[Vertex * 3 + Axis] += Face[Axis];
    }
    for (let Vertex = 0; Vertex < Surface.Normals.length / 3; Vertex += 1)
    {
        const Length =
            Math.hypot(
                Surface.Normals[Vertex * 3],
                Surface.Normals[Vertex * 3 + 1],
                Surface.Normals[Vertex * 3 + 2],
            ) || 1;
        for (let Axis = 0; Axis < 3; Axis += 1) Surface.Normals[Vertex * 3 + Axis] /= Length;
    }
};

//--------------------------------------------------------------------------------------------------------------------------
// BVH — median split over centroids, 4 triangles per leaf. Serves the brush ray query and the occlusion bake.
//--------------------------------------------------------------------------------------------------------------------------
export class SurfaceIndex
{
    constructor(Surface)
    {
        this.Surface = Surface;
        const Count = Surface.Indices.length / 3;
        this.Order = new Uint32Array(Count);
        for (let Index = 0; Index < Count; Index += 1) this.Order[Index] = Index;
        this.Centroids = new Float32Array(Count * 3);
        this.Minimums = new Float32Array(Count * 3);
        this.Maximums = new Float32Array(Count * 3);
        for (let Triangle = 0; Triangle < Count; Triangle += 1)
        {
            const A = Surface.Indices[Triangle * 3] * 3;
            const B = Surface.Indices[Triangle * 3 + 1] * 3;
            const C = Surface.Indices[Triangle * 3 + 2] * 3;
            for (let Axis = 0; Axis < 3; Axis += 1)
            {
                const Pa = Surface.Positions[A + Axis];
                const Pb = Surface.Positions[B + Axis];
                const Pc = Surface.Positions[C + Axis];
                this.Centroids[Triangle * 3 + Axis] = (Pa + Pb + Pc) / 3;
                this.Minimums[Triangle * 3 + Axis] = Math.min(Pa, Pb, Pc);
                this.Maximums[Triangle * 3 + Axis] = Math.max(Pa, Pb, Pc);
            }
        }
        this.NodeMinimum = [];
        this.NodeMaximum = [];
        this.NodeLeft = [];
        this.NodeStart = [];
        this.NodeCount = [];
        this.Build(0, Count);
    }

    Build(Start, Count)
    {
        const NodeIndex = this.NodeLeft.length;
        this.NodeLeft.push(-1);
        this.NodeStart.push(Start);
        this.NodeCount.push(Count);
        const Minimum = [Infinity, Infinity, Infinity];
        const Maximum = [-Infinity, -Infinity, -Infinity];
        for (let Index = Start; Index < Start + Count; Index += 1)
        {
            const Triangle = this.Order[Index];
            for (let Axis = 0; Axis < 3; Axis += 1)
            {
                Minimum[Axis] = Math.min(Minimum[Axis], this.Minimums[Triangle * 3 + Axis]);
                Maximum[Axis] = Math.max(Maximum[Axis], this.Maximums[Triangle * 3 + Axis]);
            }
        }
        this.NodeMinimum.push(Minimum);
        this.NodeMaximum.push(Maximum);
        if (Count <= 4) return NodeIndex;
        let Axis = 0;
        let Widest = -1;
        for (let Candidate = 0; Candidate < 3; Candidate += 1)
        {
            const Extent = Maximum[Candidate] - Minimum[Candidate];
            if (Extent > Widest)
            {
                Widest = Extent;
                Axis = Candidate;
            }
        }
        const Slice = Array.from(this.Order.subarray(Start, Start + Count));
        Slice.sort((Left, Right) => this.Centroids[Left * 3 + Axis] - this.Centroids[Right * 3 + Axis]);
        this.Order.set(Slice, Start);
        const Half = Count >> 1;
        this.NodeCount[NodeIndex] = 0;
        this.Build(Start, Half);
        const Right = this.Build(Start + Half, Count - Half);
        this.NodeLeft[NodeIndex] = Right;
        return NodeIndex;
    }

    // Slab test against a node, returning the near hit distance or Infinity.
    static SlabDistance(Minimum, Maximum, Origin, Inverse, Limit)
    {
        let Near = 0;
        let Far = Limit;
        for (let Axis = 0; Axis < 3; Axis += 1)
        {
            const First = (Minimum[Axis] - Origin[Axis]) * Inverse[Axis];
            const Second = (Maximum[Axis] - Origin[Axis]) * Inverse[Axis];
            const Low = Math.min(First, Second);
            const High = Math.max(First, Second);
            Near = Math.max(Near, Low);
            Far = Math.min(Far, High);
            if (Far < Near) return Infinity;
        }
        return Near;
    }

    Raycast(Origin, Direction, Limit = Infinity)
    {
        const Surface = this.Surface;
        const Inverse = [1 / (Direction[0] || 1e-9), 1 / (Direction[1] || 1e-9), 1 / (Direction[2] || 1e-9)];
        let Closest = Limit;
        let Winner = -1;
        let WinnerU = 0;
        let WinnerV = 0;
        const Stack = [0];
        while (Stack.length)
        {
            const Node = Stack.pop();
            if (SurfaceIndex.SlabDistance(this.NodeMinimum[Node], this.NodeMaximum[Node], Origin, Inverse, Closest) === Infinity)
                continue;
            const Count = this.NodeCount[Node];
            if (Count === 0)
            {
                Stack.push(Node + 1, this.NodeLeft[Node]);
                continue;
            }
            const Start = this.NodeStart[Node];
            for (let Offset = 0; Offset < Count; Offset += 1)
            {
                const Triangle = this.Order[Start + Offset];
                const A = Surface.Indices[Triangle * 3] * 3;
                const B = Surface.Indices[Triangle * 3 + 1] * 3;
                const C = Surface.Indices[Triangle * 3 + 2] * 3;
                const Edge1 = [
                    Surface.Positions[B] - Surface.Positions[A],
                    Surface.Positions[B + 1] - Surface.Positions[A + 1],
                    Surface.Positions[B + 2] - Surface.Positions[A + 2],
                ];
                const Edge2 = [
                    Surface.Positions[C] - Surface.Positions[A],
                    Surface.Positions[C + 1] - Surface.Positions[A + 1],
                    Surface.Positions[C + 2] - Surface.Positions[A + 2],
                ];
                const Perpendicular = [
                    Direction[1] * Edge2[2] - Direction[2] * Edge2[1],
                    Direction[2] * Edge2[0] - Direction[0] * Edge2[2],
                    Direction[0] * Edge2[1] - Direction[1] * Edge2[0],
                ];
                const Determinant = Edge1[0] * Perpendicular[0] + Edge1[1] * Perpendicular[1] + Edge1[2] * Perpendicular[2];
                if (Math.abs(Determinant) < 1e-12) continue;
                const InverseDeterminant = 1 / Determinant;
                const Offsets = [
                    Origin[0] - Surface.Positions[A],
                    Origin[1] - Surface.Positions[A + 1],
                    Origin[2] - Surface.Positions[A + 2],
                ];
                const U =
                    (Offsets[0] * Perpendicular[0] + Offsets[1] * Perpendicular[1] + Offsets[2] * Perpendicular[2]) *
                    InverseDeterminant;
                if (U < -1e-6 || U > 1 + 1e-6) continue;
                const Cross = [
                    Offsets[1] * Edge1[2] - Offsets[2] * Edge1[1],
                    Offsets[2] * Edge1[0] - Offsets[0] * Edge1[2],
                    Offsets[0] * Edge1[1] - Offsets[1] * Edge1[0],
                ];
                const V =
                    (Direction[0] * Cross[0] + Direction[1] * Cross[1] + Direction[2] * Cross[2]) * InverseDeterminant;
                if (V < -1e-6 || U + V > 1 + 1e-6) continue;
                const Distance = (Edge2[0] * Cross[0] + Edge2[1] * Cross[1] + Edge2[2] * Cross[2]) * InverseDeterminant;
                if (Distance <= 1e-5 || Distance >= Closest) continue;
                Closest = Distance;
                Winner = Triangle;
                WinnerU = U;
                WinnerV = V;
            }
        }
        if (Winner < 0) return null;
        return this.Interpolate(Winner, WinnerU, WinnerV, Closest, Origin, Direction);
    }

    Occluded(Origin, Direction, Limit)
    {
        return this.Raycast(Origin, Direction, Limit) !== null;
    }

    Interpolate(Triangle, U, V, Distance, Origin, Direction)
    {
        const Surface = this.Surface;
        const W = 1 - U - V;
        const Indices = [Surface.Indices[Triangle * 3], Surface.Indices[Triangle * 3 + 1], Surface.Indices[Triangle * 3 + 2]];
        const Weights = [W, U, V];
        const Position = [0, 0, 0];
        const Normal = [0, 0, 0];
        const Tangent = [0, 0, 0];
        const Coordinate = [0, 0];
        let Handedness = 0;
        for (let Corner = 0; Corner < 3; Corner += 1)
        {
            const Vertex = Indices[Corner];
            const Weight = Weights[Corner];
            for (let Axis = 0; Axis < 3; Axis += 1)
            {
                Position[Axis] += Surface.Positions[Vertex * 3 + Axis] * Weight;
                Normal[Axis] += Surface.Normals[Vertex * 3 + Axis] * Weight;
                Tangent[Axis] += Surface.Tangents[Vertex * 4 + Axis] * Weight;
            }
            Coordinate[0] += Surface.Coordinates[Vertex * 2] * Weight;
            Coordinate[1] += Surface.Coordinates[Vertex * 2 + 1] * Weight;
            Handedness += Surface.Tangents[Vertex * 4 + 3] * Weight;
        }
        return {
            Distance,
            Position: [
                Origin[0] + Direction[0] * Distance,
                Origin[1] + Direction[1] * Distance,
                Origin[2] + Direction[2] * Distance,
            ],
            Smoothed: Position,
            Normal: Normalise(Normal),
            Tangent: Normalise(Tangent),
            Handedness: Handedness < 0 ? -1 : 1,
            Coordinate,
            Triangle,
        };
    }
}

//--------------------------------------------------------------------------------------------------------------------------
// Per-vertex occlusion bake — cosine-weighted hemisphere rays against the BVH, interpolated into texture space later.
//--------------------------------------------------------------------------------------------------------------------------
export const BakeOcclusion = (Surface, Index, Samples = 28) =>
{
    const Count = Surface.Positions.length / 3;
    const Occlusion = Surface.Occlusion;
    const Radius = Surface.Bounds.Radius * 1.4;
    const GoldenAngle = Math.PI * (3 - Math.sqrt(5));
    for (let Vertex = 0; Vertex < Count; Vertex += 1)
    {
        const Normal = [
            Surface.Normals[Vertex * 3],
            Surface.Normals[Vertex * 3 + 1],
            Surface.Normals[Vertex * 3 + 2],
        ];
        const Origin = [
            Surface.Positions[Vertex * 3] + Normal[0] * 1e-3,
            Surface.Positions[Vertex * 3 + 1] + Normal[1] * 1e-3,
            Surface.Positions[Vertex * 3 + 2] + Normal[2] * 1e-3,
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
        let Visible = 0;
        for (let Sample = 0; Sample < Samples; Sample += 1)
        {
            const Fraction = (Sample + 0.5) / Samples;
            const CosineTheta = Math.sqrt(1 - Fraction);
            const SineTheta = Math.sqrt(Fraction);
            const Angle = Sample * GoldenAngle;
            const Direction = [
                TangentX[0] * Math.cos(Angle) * SineTheta + TangentY[0] * Math.sin(Angle) * SineTheta + Normal[0] * CosineTheta,
                TangentX[1] * Math.cos(Angle) * SineTheta + TangentY[1] * Math.sin(Angle) * SineTheta + Normal[1] * CosineTheta,
                TangentX[2] * Math.cos(Angle) * SineTheta + TangentY[2] * Math.sin(Angle) * SineTheta + Normal[2] * CosineTheta,
            ];
            if (!Index.Occluded(Origin, Normalise(Direction), Radius)) Visible += 1;
        }
        Occlusion[Vertex] = Visible / Samples;
    }
    return Occlusion;
};
