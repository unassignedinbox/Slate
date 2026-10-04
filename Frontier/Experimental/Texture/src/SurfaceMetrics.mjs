//============================================================================================================================================
// 📐 SurfaceMetrics.mjs — node --test coverage for the geometry layer: surfaces, the ray index, occlusion and the camera
//============================================================================================================================================
// These assertions guard the invariants the GPU layer silently depends on: unit normals, coordinates inside the island,
// a ray index that agrees with analytic intersections, and a camera whose matrices stay finite under every input.
//============================================================================================================================================

import { test } from "node:test";
import assert from "node:assert/strict";

import { BuildSurface, ParseWavefront, SurfaceIndex, BakeOcclusion, ComputeBounds } from "./SurfaceStructure.js";
import { OrbitProjection } from "./OrbitProjection.js";
import { SurfaceOrdering } from "./LayerSpecification.js";

const Length = (Vector, Offset) =>
    Math.hypot(Vector[Offset], Vector[Offset + 1], Vector[Offset + 2]);

test("every catalogued surface builds with consistent attribute counts", () =>
{
    for (const Entry of SurfaceOrdering)
    {
        if (Entry.Identifier === "custom") continue;
        const Surface = BuildSurface(Entry.Identifier, 1);
        assert.ok(Surface.Vertices > 32, `${Entry.Identifier} produced too few vertices`);
        assert.equal(Surface.Positions.length, Surface.Vertices * 3);
        assert.equal(Surface.Normals.length, Surface.Vertices * 3);
        assert.equal(Surface.Tangents.length, Surface.Vertices * 4);
        assert.equal(Surface.Coordinates.length, Surface.Vertices * 2);
        assert.equal(Surface.Occlusion.length, Surface.Vertices);
        assert.equal(Surface.Indices.length, Surface.Triangles * 3);
        assert.ok(Surface.Indices.every((Index) => Index < Surface.Vertices));
    }
});

test("normals are unit length and coordinates stay inside the island", () =>
{
    const Surface = BuildSurface("shaderball", 1);
    for (let Index = 0; Index < Surface.Vertices; Index += 1)
    {
        assert.ok(Math.abs(Length(Surface.Normals, Index * 3) - 1) < 1e-3, "normal is not unit length");
        const U = Surface.Coordinates[Index * 2];
        const V = Surface.Coordinates[Index * 2 + 1];
        assert.ok(U >= -1e-6 && U <= 1 + 1e-6, `u out of range: ${U}`);
        assert.ok(V >= -1e-6 && V <= 1 + 1e-6, `v out of range: ${V}`);
    }
});

test("tangents are orthogonal to their normal and carry a signed handedness", () =>
{
    const Surface = BuildSurface("cube", 1);
    for (let Index = 0; Index < Surface.Vertices; Index += 1)
    {
        const Dot =
            Surface.Normals[Index * 3] * Surface.Tangents[Index * 4] +
            Surface.Normals[Index * 3 + 1] * Surface.Tangents[Index * 4 + 1] +
            Surface.Normals[Index * 3 + 2] * Surface.Tangents[Index * 4 + 2];
        assert.ok(Math.abs(Dot) < 1e-3, `tangent is not orthogonal: ${Dot}`);
        assert.ok(Math.abs(Surface.Tangents[Index * 4 + 3]) === 1, "handedness must be ±1");
    }
});

test("subdivision raises the triangle count monotonically", () =>
{
    let Previous = 0;
    for (let Detail = 0; Detail <= 3; Detail += 1)
    {
        const Surface = BuildSurface("sphere", Detail);
        assert.ok(Surface.Triangles > Previous, "detail level did not refine the surface");
        Previous = Surface.Triangles;
    }
});

test("bounds enclose every vertex", () =>
{
    const Surface = BuildSurface("cylinder", 1);
    const Bounds = ComputeBounds(Surface.Positions);
    for (let Index = 0; Index < Surface.Vertices; Index += 1)
        for (let Axis = 0; Axis < 3; Axis += 1)
        {
            const Component = Surface.Positions[Index * 3 + Axis];
            assert.ok(Component >= Bounds.Minimum[Axis] - 1e-5, "vertex below the minimum");
            assert.ok(Component <= Bounds.Maximum[Axis] + 1e-5, "vertex above the maximum");
            assert.ok(
                Math.abs(Bounds.Maximum[Axis] - Bounds.Minimum[Axis] - Bounds.Extent[Axis] * 2) < 1e-5,
                "extent is not the half size",
            );
        }
    assert.ok(Bounds.Radius > 0);
});

test("the ray index agrees with an analytic sphere intersection", () =>
{
    const Surface = BuildSurface("sphere", 3);
    const Index = new SurfaceIndex(Surface);
    const Centre = Surface.Bounds.Centre;
    const Radius = Surface.Bounds.Radius;
    let Geometric = 0;
    for (let Vertex = 0; Vertex < Surface.Vertices; Vertex += 1)
        Geometric = Math.max(
            Geometric,
            Math.hypot(
                Surface.Positions[Vertex * 3] - Centre[0],
                Surface.Positions[Vertex * 3 + 1] - Centre[1],
                Surface.Positions[Vertex * 3 + 2] - Centre[2],
            ),
        );
    const Distance = Radius * 6;
    const Origin = [Centre[0], Centre[1], Centre[2] + Distance];
    const Hit = Index.Raycast(Origin, [0, 0, -1]);
    assert.ok(Hit, "the index missed a head-on ray");
    assert.ok(
        Math.abs(Hit.Distance - (Distance - Geometric)) < Geometric * 0.01,
        `unexpected distance ${Hit.Distance}, expected ${(Distance - Geometric).toFixed(4)}`,
    );
    assert.ok(Hit.Normal[2] > 0.9, "the hit normal does not face the ray");
    assert.ok(Math.abs(Math.hypot(...Hit.Normal) - 1) < 1e-5);
    assert.ok(Hit.Coordinate[0] >= 0 && Hit.Coordinate[0] <= 1);
    assert.equal(Index.Raycast([Centre[0] + Radius * 8, Centre[1], Centre[2] + Radius * 8], [0, 0, -1]), null);
});

test("occlusion is bounded and darker inside a crevice than on an open plane", () =>
{
    const Open = BuildSurface("plane", 1);
    BakeOcclusion(Open, new SurfaceIndex(Open), 12);
    for (const Value of Open.Occlusion) assert.ok(Value >= 0 && Value <= 1, `occlusion out of range: ${Value}`);
    const Average = Open.Occlusion.reduce((Total, Value) => Total + Value, 0) / Open.Occlusion.length;
    assert.ok(Average > 0.6, `an open plane should stay bright, measured ${Average.toFixed(3)}`);

    const Closed = BuildSurface("shaderball", 1);
    BakeOcclusion(Closed, new SurfaceIndex(Closed), 12);
    const Shaded = Closed.Occlusion.reduce((Total, Value) => Total + Value, 0) / Closed.Occlusion.length;
    assert.ok(Shaded < Average, "a contact surface should darken relative to an open plane");
});

test("wavefront import reads positions, coordinates and triangulates quads", () =>
{
    const Source = [
        "# two quads",
        "v -1 0 -1",
        "v 1 0 -1",
        "v 1 0 1",
        "v -1 0 1",
        "vt 0 0",
        "vt 1 0",
        "vt 1 1",
        "vt 0 1",
        "vn 0 1 0",
        "f 1/1/1 2/2/1 3/3/1 4/4/1",
    ].join("\n");
    const Surface = ParseWavefront(Source, "slab");
    assert.equal(Surface.Triangles, 2);
    assert.equal(Surface.Label, "slab");
    assert.equal(Surface.Positions.length, Surface.Vertices * 3);
    assert.ok(Surface.Bounds.Radius > 0);
    assert.throws(() => ParseWavefront("# nothing here", "void"), /no triangles/i);
});

test("the camera produces finite matrices and normalised rays", () =>
{
    const Camera = new OrbitProjection();
    Camera.Frame(1.4, [0, 0.2, 0]);
    for (let Step = 0; Step < 120; Step += 1) Camera.Advance(0.016);
    assert.ok(Camera.ViewClip.every(Number.isFinite), "view-clip matrix went non-finite");
    assert.ok(Math.abs(Math.hypot(...Camera.Forward) - 1) < 1e-5);
    const Ray = Camera.Ray(0, 0);
    assert.ok(Math.abs(Math.hypot(...Ray.Direction) - 1) < 1e-5);
    const Toward = [0, 1, 2].map((Axis) => Camera.Centre[Axis] - Camera.Position[Axis]);
    const Alignment =
        (Toward[0] * Ray.Direction[0] + Toward[1] * Ray.Direction[1] + Toward[2] * Ray.Direction[2]) /
        Math.hypot(...Toward);
    assert.ok(Alignment > 0.99, "the centre ray does not point at the orbit centre");
});

test("camera input is clamped and survives a serialise round trip", () =>
{
    const Camera = new OrbitProjection();
    for (let Step = 0; Step < 200; Step += 1)
    {
        Camera.Orbit(400, 400);
        Camera.Zoom(-2000);
        Camera.Advance(0.016);
    }
    for (let Step = 0; Step < 200; Step += 1) Camera.Advance(0.016);
    assert.ok(Camera.Distance >= 0.55 - 1e-9, "distance collapsed through the near limit");
    assert.ok(Camera.Inclination >= 0.1 - 1e-6, "inclination passed the lower pole");
    assert.ok(Camera.Inclination <= Math.PI - 0.1 + 1e-6, "inclination passed the upper pole");
    const Record = Camera.Serialise();
    const Restored = new OrbitProjection();
    Restored.Restitute(Record);
    for (let Step = 0; Step < 200; Step += 1) Restored.Advance(0.016);
    const Near = (First, Second) => Math.abs(First - Second) <= 1e-4 * Math.max(1, Math.abs(Second));
    assert.ok(Near(Restored.Distance, Camera.Distance), "distance did not restore");
    assert.ok(Near(Restored.Azimuth, Camera.Azimuth), "azimuth did not restore");
    assert.ok(Near(Restored.Inclination, Camera.Inclination), "inclination did not restore");
});
