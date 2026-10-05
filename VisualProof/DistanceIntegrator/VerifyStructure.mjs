//============================================================================================================================================
//                                                            VERIFYSTRUCTURE.MJS
//============================================================================================================================================
// 📦 Closed-component connectivity, current-triangle geometry and independent signed-distance reference calculations.

import Assert from 'node:assert/strict';
import Fs from 'node:fs';
import
{
    ConstructScene,
    DeformPosition,
    DomainMinimum,
    DomainMaximum,
    FacetNormal,
    IntersectFacet
}
from '../../Frontier/Experimental/DistanceIntegrator/BodySpecification.js';
export
{
    ConstructScene,
    DeformPosition,
    IntersectFacet
};
const Subtract = (First, Second) => First.slice(0, 3).map((Coordinate, Axis) => Coordinate - Second[Axis]);
const Dot = (First, Second) => First.reduce((Sum, Coordinate, Axis) => Sum + Coordinate * Second[Axis], 0);
const Length = Position => Math.hypot(...Position);
export function TriangleDistance(Point, First, Second, Third)
{
    // 📝 Independent Voronoi-region closest-point algorithm, rather than the GPU plane/edge predicate implementation.
    const Edge = Subtract(Second, First),
        Other = Subtract(Third, First),
        Relative = Subtract(Point, First);
    const FirstDot = Dot(Edge, Relative),
        SecondDot = Dot(Other, Relative);
    if (FirstDot <= 0 && SecondDot <= 0) return Length(Relative);
    const RelativeSecond = Subtract(Point, Second),
        ThirdDot = Dot(Edge, RelativeSecond),
        FourthDot = Dot(Other, RelativeSecond);
    if (ThirdDot >= 0 && FourthDot <= ThirdDot) return Length(RelativeSecond);
    const AreaThird = FirstDot * FourthDot - ThirdDot * SecondDot;
    if (AreaThird <= 0 && FirstDot >= 0 && ThirdDot <= 0)
    {
        const Fraction = FirstDot / (FirstDot - ThirdDot);
        return Length(Relative.map((Coordinate, Axis) => Coordinate - Edge[Axis] * Fraction));
    }
    const RelativeThird = Subtract(Point, Third),
        FifthDot = Dot(Edge, RelativeThird),
        SixthDot = Dot(Other, RelativeThird);
    if (SixthDot >= 0 && FifthDot <= SixthDot) return Length(RelativeThird);
    const AreaSecond = FifthDot * SecondDot - FirstDot * SixthDot;
    if (AreaSecond <= 0 && SecondDot >= 0 && SixthDot <= 0)
    {
        const Fraction = SecondDot / (SecondDot - SixthDot);
        return Length(Relative.map((Coordinate, Axis) => Coordinate - Other[Axis] * Fraction));
    }
    const AreaFirst = ThirdDot * SixthDot - FifthDot * FourthDot;
    if (AreaFirst <= 0 && FourthDot - ThirdDot >= 0 && FifthDot - SixthDot >= 0)
    {
        const Fraction = (FourthDot - ThirdDot) / (FourthDot - ThirdDot + FifthDot - SixthDot);
        return Length(RelativeSecond.map((Coordinate, Axis) => Coordinate - (Third[Axis] - Second[Axis]) * Fraction));
    }
    const Inverse = 1 / (AreaFirst + AreaSecond + AreaThird);
    return Length(Relative.map((Coordinate, Axis) => Coordinate - Edge[Axis] * AreaSecond * Inverse - Other[Axis] *
        AreaThird * Inverse));
}
export function SignedReference(Scene, Vertices, Point)
{
    const Distances = new Array(32).fill(Infinity),
        Parity = new Array(32).fill(false);
    const Direction = [1, .37139, .17321],
        Magnitude = Math.hypot(...Direction);
    const Unit = Direction.map(Coordinate => Coordinate / Magnitude);
    for (const Facet of Scene.Facets)
    {
        const Component = Facet[4];
        if (!Component) continue;
        const Corners = Facet.slice(0, 3).map(Index => Vertices[Index]);
        Distances[Component - 1] = Math.min(Distances[Component - 1], TriangleDistance(Point, ...Corners));
        if (Number.isFinite(IntersectFacet(Point, Unit, ...Corners, 1e-6))) Parity[Component - 1] = !Parity[Component -
            1];
    }
    return Math.min(...Distances.map((Distance, Index) => Parity[Index] ? -Distance : Distance));
}
if (process.argv[1]?.endsWith('VerifyStructure.mjs'))
{
    const Scene = ConstructScene(),
        Destination = process.argv[2] || '_AgentScratch/DistanceProof';
    Fs.mkdirSync(Destination,
    {
        recursive: true
    });
    const Report = {
        Date: '2026-10-05',
        Vertices: Scene.Vertices.length,
        Quads: Scene.Quads.length,
        Triangles: Scene.Facets.length,
        Components: Scene.Parts.length,
        Bounds: Scene.Bounds.length,
        Depth: Scene.MaximumDepth,
        Poses: []
    };
    Assert(Scene.Parts.length <= 32);
    Assert(Scene.MaximumDepth < 31);
    for (const Part of Scene.Parts)
    {
        const Edges = new Map();
        for (const Quad of Scene.Quads.filter(Quad => Quad.Component === Part.Component))
        {
            Assert.equal(new Set(Quad.Corners).size, 4);
            for (let Corner = 0; Corner < 4; Corner++)
            {
                const Key = [Quad.Corners[Corner], Quad.Corners[(Corner + 1) % 4]].sort((First, Second) => First -
                    Second).join('/');
                Edges.set(Key, (Edges.get(Key) || 0) + 1);
            }
        }
        Assert([...Edges.values()].every(Count => Count === 2), Part.Name + ' has an open/nonmanifold edge');
    }
    const Coverage = new Uint32Array(Scene.Facets.length);
    for (const Bound of Scene.Bounds)
        for (let Offset = 0; Offset < Bound.Count; Offset++) Coverage[Bound.Start + Offset]++;
    Assert(Coverage.every(Count => Count === 1));
    for (const Amount of [0, .2, .55, .8, 1])
    {
        const Vertices = Scene.Vertices.map(Position => DeformPosition(Position, Amount));
        let MinimumArea = Infinity,
            MaximumDisplacement = 0;
        for (const Facet of Scene.Facets)
        {
            const [First, Second, Third] = Facet.slice(0, 3).map(Index => Vertices[Index]);
            Assert(FacetNormal(First, Second, Third).every(Number.isFinite));
            const Edge = Subtract(Second, First),
                Other = Subtract(Third, First);
            const Area = Math.hypot(Edge[1] * Other[2] - Edge[2] * Other[1], Edge[2] * Other[0] - Edge[0] * Other[2],
                Edge[0] * Other[1] - Edge[1] * Other[0]) / 2;
            Assert(Area > 1e-8);
            MinimumArea = Math.min(MinimumArea, Area);
        }
        for (let Index = 0; Index < Vertices.length; Index++)
        {
            MaximumDisplacement = Math.max(MaximumDisplacement, Length(Subtract(Vertices[Index], Scene.Vertices[
                Index])));
            if (Vertices[Index][3])
                for (let Axis = 0; Axis < 3; Axis++)
                    Assert(Vertices[Index][Axis] > DomainMinimum[Axis] && Vertices[Index][Axis] < DomainMaximum[Axis]);
        }
        Report.Poses.push(
        {
            Amount,
            MinimumArea,
            MaximumDisplacement
        });
    }
    const Witnesses = [
        [0, 1.08, 1.22],
        [0, 1.85, -1.3],
        [0, .35, -.5],
        [2.5, 2.8, 3]
    ];
    Report.Witnesses = Witnesses.map(Point => (
    {
        Point,
        Distance: SignedReference(Scene, Scene.Vertices, Point)
    }));
    Assert(Report.Witnesses[0].Distance < 0);
    Assert(Report.Witnesses[1].Distance > 0);
    Assert(Report.Witnesses[2].Distance < 0);
    Assert(Report.Witnesses[3].Distance > 0);
    Report.Passed = true;
    Fs.writeFileSync(`${Destination}/Structure.json`, JSON.stringify(Report, null, 2));
    console.log(Report);
}
