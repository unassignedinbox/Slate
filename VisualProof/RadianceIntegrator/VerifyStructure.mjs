//============================================================================================================================================
//                                                            VERIFYSTRUCTURE.MJS
//============================================================================================================================================
// 📦 Independent CPU traversal-versus-brute-force checks, BVH containment, rigid poses, cascade budgets and equal-area direction bounds.

import Assert from 'node:assert/strict';
import
{
    mkdirSync,
    writeFileSync
}
from 'node:fs';
import
{
    ConstructScene,
    Defaults,
    CascadeLayout,
    IntersectTriangle
}
from '../../Frontier/Experimental/RadianceIntegrator/SceneSpecification.js';
const Destination = process.argv[2] || '_AgentScratch/TransportProof';
mkdirSync(Destination,
{
    recursive: true
});
const Scene = ConstructScene();
Assert(Scene.Triangles.length >= 1000);
let Seed = 913;
const Random = () =>
{
    Seed = (Math.imul(1664525, Seed) + 1013904223) >>> 0;
    return Seed / 4294967296;
};
const Queries = Array.from(
{
    length: 256
}, (_, I) =>
{
    const Origin = [(Random() - .5) * 35, Random() * 14, (Random() - .5) * 35],
        Target = [(Random() - .5) * 18, Random() * 7, (Random() - .5) * 18];
    const Difference = Target.map((V, A) => V - Origin[A]),
        Size = Math.hypot(...Difference);
    return {
        Origin,
        Direction: I < 6 ? [0, 1, 2].map(A => A === I % 3 ? (I < 3 ? 1 : -1) : 0) : Difference.map(V => V /
            Size)
    };
});
const Coverage = new Uint32Array(Scene.Triangles.length);
for (let I = 0; I < Scene.Nodes.length; ++I)
{
    const N = Scene.Nodes[I];
    Assert(N.Escape > I && N.Escape <= Scene.Nodes.length);
    Assert(N.Minimum.every((V, A) => V <= N.Maximum[A]));
    if (N.Count)
        for (let J = 0; J < N.Count; J++)
        {
            Coverage[N.Start + J]++;
            const T = Scene.Triangles[N.Start + J];
            for (const P of [T.A, T.B, T.C]) Assert(P.every((V, A) => V >= N.Minimum[A] && V <= N.Maximum[A]));
            Assert(Math.abs(Math.hypot(...T.N) - 1) < 1e-10);
        }
    else
    {
        const Children = [Scene.Nodes[I + 1], Scene.Nodes[Scene.Nodes[I + 1].Escape]];
        for (const Child of Children) Assert(Child.Minimum.every((V, A) => V >= N.Minimum[A] && Child.Maximum[A] <= N
            .Maximum[A]));
    }
}
Assert(Coverage.every(Count => Count === 1));
const Poses = [];
for (const Time of [0, 3.4])
{
    const Origins = [
        [0, 0, 0],
        [0, 1.07, -2],
        [-3.4 + Math.sin(Time * .67) * 2.2, 3.1 + Math.sin(Time * .4) * .7, 1 + Math.cos(Time * .5) * 3.4],
        [3.6 + Math.cos(Time * .53) * 1.6, 4.3, -4 + Math.sin(Time * .62) * 3.2]
    ];
    const Rotate = (P, Angle) => [P[0] * Math.cos(Angle) + P[2] * Math.sin(Angle), P[1], -P[0] * Math.sin(Angle) + P[
        2] * Math.cos(Angle)
    ];
    const ToLocal = (Q, Object) => (
    {
        Origin: Rotate(Q.Origin.map((V, A) => V - Origins[Object][A]), Object === 1 ? -Time * .45 : 0),
        Direction: Rotate(Q.Direction, Object === 1 ? -Time * .45 : 0)
    });
    const Expected = [];
    for (const Q of Queries)
    {
        const Rays = Origins.map((_, Object) => ToLocal(Q, Object));
        let Brute = 80;
        for (const T of Scene.Triangles)
        {
            const R = Rays[T.Instance];
            Brute = IntersectTriangle(R.Origin, R.Direction, T, .02, Brute);
        }
        let Accelerated = 80;
        for (let Object = 0; Object < 4; ++Object)
        {
            const R = Rays[Object];
            let Index = Scene.Instances[Object].Root;
            while (Index < Scene.Instances[Object].End)
            {
                const N = Scene.Nodes[Index];
                let Near = .02,
                    Far = Accelerated;
                for (let A = 0; A < 3; ++A)
                {
                    if (Math.abs(R.Direction[A]) < 1e-12)
                    {
                        if (R.Origin[A] < N.Minimum[A] || R.Origin[A] > N.Maximum[A]) Far = -1;
                        continue;
                    }
                    const X = (N.Minimum[A] - R.Origin[A]) / R.Direction[A],
                        Y = (N.Maximum[A] - R.Origin[A]) / R.Direction[A];
                    Near = Math.max(Near, Math.min(X, Y));
                    Far = Math.min(Far, Math.max(X, Y));
                }
                if (Near > Far)
                {
                    Index = N.Escape;
                    continue;
                }
                if (!N.Count)
                {
                    Index++;
                    continue;
                }
                for (let J = 0; J < N.Count; J++) Accelerated = IntersectTriangle(R.Origin, R.Direction, Scene
                    .Triangles[N.Start + J], .02, Accelerated);
                Index = N.Escape;
            }
        }
        Assert(Math.abs(Brute - Accelerated) < 1e-9);
        Expected.push(Brute);
    }
    Poses.push(
    {
        Time,
        Expected
    });
}
let Layouts = 0;
for (const Width of [128, 320, 960])
    for (const Spacing of [8, 12, 24])
        for (const Directions of [4, 6, 8])
            for (const Cascades of [2, 3, 4, 5])
            {
                const Levels = CascadeLayout(Width, Math.round(Width * .625),
                {
                    ...Defaults,
                    Spacing,
                    Directions,
                    Cascades
                });
                Levels.forEach((L, I) =>
                {
                    Assert(L.Count === L.X * L.Y * L.Directions ** 2);
                    Assert(L.Far > L.Near);
                    if (I) Assert(L.Near === Levels[I - 1].Far);
                    Assert(Math.ceil(L.Count / 64) < 65535);
                });
                Layouts++;
            }
const Report = {
    Date: '2026-10-05',
    Triangles: Scene.Triangles.length,
    Nodes: Scene.Nodes.length,
    MaximumDepth: Scene.MaximumDepth,
    Queries: Queries.length * Poses.length,
    Layouts,
    Passed: true
};
writeFileSync(`${Destination}/Structure.json`, JSON.stringify(Report, null, 2));
writeFileSync(`${Destination}/RayQueries.json`, JSON.stringify(
{
    Queries,
    Poses
}));
console.log(Report);
