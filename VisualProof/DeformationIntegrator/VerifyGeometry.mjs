//============================================================================================================================================
//                                                             VERIFYGEOMETRY.MJS
//============================================================================================================================================
// 📦 Independent quad connectivity, non-rigid deformation, positive-area and ray-reference verification.

import Assert from 'node:assert/strict';
import Fs from 'node:fs';
import
{
    ConstructScene,
    DeformPosition,
    TyreCount,
    FacetNormal,
    IntersectFacet
}
from '../../Frontier/Experimental/DeformationIntegrator/DeformationSpecification.js';
const Scene = ConstructScene();
const Destination = process.argv[2] || '_AgentScratch/DeformationProof';
Fs.mkdirSync(Destination,
{
    recursive: true
});
const Report = {
    Date: '2026-10-05',
    Quads: Scene.Quads.length,
    Triangles: Scene.Facets.length,
    TyreVertices: TyreCount,
    Vertices: Scene.Vertices.length,
    Bounds: Scene.Bounds.length,
    Depth: Scene.MaximumDepth,
    Poses: []
};
const Edges = new Map();
for (const Quad of Scene.Quads.slice(0, TyreCount))
{
    Assert.equal(new Set(Quad.Corners).size, 4);
    for (let Index = 0; Index < 4; Index++)
    {
        const First = Quad.Corners[Index],
            Second = Quad.Corners[(Index + 1) % 4];
        const Key = [First, Second].sort((Left, Right) => Left - Right).join('/');
        Edges.set(Key, (Edges.get(Key) || 0) + 1);
    }
}
Assert([...Edges.values()].every(Count => Count === 2));
const Coverage = new Uint32Array(Scene.Facets.length);
for (const Extent of Scene.Bounds)
{
    for (let Index = Extent.Start; Index < Extent.Start + Extent.Count; Index++) Coverage[Index]++;
}
Assert(Coverage.every(Count => Count === 1));
for (const Compression of [0, .04, .1, .2, .325, .4, .5, .6, .65])
{
    const Vertices = Scene.Vertices.map(Position => DeformPosition(Position, Compression));
    let MinimumArea = Infinity,
        MaximumDisplacement = 0;
    for (const Facet of Scene.Facets)
    {
        const [First, Second, Third] = Facet.slice(0, 3).map(Index => Vertices[Index]);
        Assert(FacetNormal(First, Second, Third).every(Number.isFinite));
        const Edge = Second.map((Coordinate, Axis) => Coordinate - First[Axis]);
        const Other = Third.map((Coordinate, Axis) => Coordinate - First[Axis]);
        const Area = Math.hypot(Edge[1] * Other[2] - Edge[2] * Other[1], Edge[2] * Other[0] - Edge[0] * Other[2], Edge[
            0] * Other[1] - Edge[1] * Other[0]) / 2;
        MinimumArea = Math.min(MinimumArea, Area);
        Assert(Area > 1e-8);
    }
    for (let Index = 0; Index < TyreCount; Index++) MaximumDisplacement = Math.max(MaximumDisplacement,
        Math.hypot(...Vertices[Index].slice(0, 3).map((Coordinate, Axis) => Coordinate - Scene.Vertices[Index][
            Axis
        ])));
    Assert(Vertices.slice(0, TyreCount).every(Position => Position[1] >= .03));
    Report.Poses.push(
    {
        Compression,
        MinimumArea,
        MaximumDisplacement
    });
}
const Loaded = Scene.Vertices.map(Position => DeformPosition(Position, .65));
let MaximumEdgeChange = 0;
for (const Quad of Scene.Quads.slice(0, TyreCount))
{
    const First = Quad.Corners[0],
        Second = Quad.Corners[1];
    const Distance = Vertices => Math.hypot(...Vertices[First].slice(0, 3).map((Coordinate, Axis) => Coordinate -
        Vertices[Second][Axis]));
    MaximumEdgeChange = Math.max(MaximumEdgeChange, Math.abs(Distance(Loaded) - Distance(Scene.Vertices)));
}
Assert(MaximumEdgeChange > .02);
Report.MaximumEdgeLengthChange = MaximumEdgeChange;
const Rays = [];
let Seed = 7319;
const Random = () =>
{
    Seed = (Math.imul(Seed, 1664525) + 1013904223) >>> 0;
    return Seed / 4294967296;
};
for (let Index = 0; Index < 192; Index++)
{
    const Origin = Index < 128 ? [-1.8 + Random() * 3.6, .04 + Random() * 3.2, 6] : [4.7, 3.05, 7.6];
    const Target = [-1.7 + Random() * 3.4, .04 + Random() * 3.1, 0];
    const Direction = Index < 128 ? [0, 0, -1] : Target.map((Coordinate, Axis) => Coordinate - Origin[Axis]);
    const Length = Math.hypot(...Direction);
    Rays.push(
    {
        Origin,
        Direction: Direction.map(Coordinate => Coordinate / Length)
    });
}
const Reference = Vertices => Rays.map(Ray => Scene.Facets.reduce((Nearest, Facet) =>
    Math.min(Nearest, IntersectFacet(Ray.Origin, Ray.Direction, ...Facet.slice(0, 3).map(Index => Vertices[
        Index]))), 40));
const RestDistances = Reference(Scene.Vertices),
    LoadedDistances = Reference(Loaded);
Report.ChangedRayDistances = RestDistances.filter((Distance, Index) => Math.abs(Distance - LoadedDistances[Index]) >
    .001).length;
Assert(Report.ChangedRayDistances > 30);
Report.Passed = true;
Fs.writeFileSync(`${Destination}/Geometry.json`, JSON.stringify(Report, null, 2));
Fs.writeFileSync(`${Destination}/Rays.json`, JSON.stringify(Rays));
console.log(Report);
