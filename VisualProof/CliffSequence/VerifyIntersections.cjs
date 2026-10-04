//============================================================================================================================================
//                                                          VERIFYINTERSECTIONS.CJS
//============================================================================================================================================
// 📦 Independent BVH checks for nonadjacent surface intersections and overlaps between cliff fragments.

const Fs=require('node:fs');
const Path=require('node:path');
const Assert=require('node:assert/strict');
const THREE=require('three');
const {MeshBVH,SAH}=require('three-mesh-bvh');
const Input=process.argv[2]||'_AgentScratch/CliffVerification/DefaultMesh.json';
const Output=process.argv[3]||'_AgentScratch/CliffVerification/Intersections.json';
const Result=JSON.parse(Fs.readFileSync(Input,'utf8'));
const Identity=new THREE.Matrix4();
function Intersects(First,Second)
{
    const A=[First.a,First.b,First.c],B=[Second.a,Second.b,Second.c];
    const Edges=Points=>Points.map((Point,Index)=>Points[(Index+1)%3].clone().sub(Point));
    const FirstEdges=Edges(A),SecondEdges=Edges(B);
    const FirstNormal=FirstEdges[0].clone().cross(FirstEdges[1]);
    const SecondNormal=SecondEdges[0].clone().cross(SecondEdges[1]);
    const Axes=[FirstNormal,SecondNormal,...FirstEdges.flatMap(Edge=>SecondEdges.map(Other=>Edge.clone().cross(Other))),
        ...FirstEdges.map(Edge=>Edge.clone().cross(FirstNormal)),...SecondEdges.map(Edge=>Edge.clone().cross(SecondNormal))];
    for (const Axis of Axes)
    {
        const Magnitude=Axis.length();
        if (Magnitude<1e-12) continue;
        Axis.divideScalar(Magnitude);
        const First=A.map(Point=>Point.dot(Axis)),Second=B.map(Point=>Point.dot(Axis));
        if (Math.max(...First)<Math.min(...Second)-1e-8 || Math.max(...Second)<Math.min(...First)-1e-8) return false;
    }
    return true;
}
const Fixture=Points=>new THREE.Triangle(...Points.map(Point=>new THREE.Vector3(...Point)));
const Flat=Fixture([[0,0,0],[2,0,0],[0,2,0]]);
Assert(Intersects(Flat,Fixture([[.5,.5,-1],[.5,.5,1],[1,.5,0]])));
Assert(!Intersects(Flat,Fixture([[0,0,1],[2,0,1],[0,2,1]])));
Assert(Intersects(Flat,Fixture([[.3,.3,0],[1,.3,0],[.3,1,0]])));
Assert(!Intersects(Flat,Fixture([[3,0,0],[5,0,0],[3,2,0]])));
const Report={Date:'2026-10-05',Method:'Indexed double-precision positions; BVH broad phase and double-precision separating-axis triangle tests (1e-8 m tolerance); All triangle pairs, including coplanar tessellation; shared-vertex pairs contracted toward their centroids by 1e-4 to exclude legitimate boundary contact. Cross-body pairs uncontracted.',Stages:[],Hits:[]};
for (const Stage of Result.Stages)
{
    let SelfCandidates=0,BodyCandidates=0,SelfHits=0,BodyHits=0;
    const Bodies=Stage.Meshes.map(Mesh=>
    {
        const Geometry=new THREE.BufferGeometry();
        Geometry.setAttribute('position',new THREE.BufferAttribute(new Float64Array(Mesh.Vertices.flat()),3));
        Geometry.setIndex(Mesh.Triangles.flat());
        const Bvh=new MeshBVH(Geometry,{strategy:SAH,indirect:true});
        const Box=new THREE.Box3().setFromBufferAttribute(Geometry.attributes.position);
        return {Mesh,Geometry,Bvh,Box};
    });
    for (let First=0;First<Bodies.length;++First)
    {
        const A=Bodies[First];
        A.Bvh.bvhcast(A.Bvh,Identity,{intersectsTriangles:(TriangleA,TriangleB,FirstIndex,SecondIndex)=>
        {
            const I=A.Bvh.resolveTriangleIndex(FirstIndex), J=A.Bvh.resolveTriangleIndex(SecondIndex);
            if (I>=J) return false;
            const Shared=A.Mesh.Triangles[I].filter(Index=>A.Mesh.Triangles[J].includes(Index));
            if (Shared.length===3) throw new Error('Duplicate triangle');
            if (Shared.length)
            {
                const Contract=Triangle=>
                {
                    const Middle=Triangle.getMidpoint(new THREE.Vector3());
                    return new THREE.Triangle(...[Triangle.a,Triangle.b,Triangle.c].map(Point=>Point.clone().lerp(Middle,1e-4)));
                };
                TriangleA=Contract(TriangleA);
                TriangleB=Contract(TriangleB);
            }
            ++SelfCandidates;
            if (Intersects(TriangleA,TriangleB))
            {
                ++SelfHits;
                if (Report.Hits.length<40) Report.Hits.push({Stage:Stage.Number,Type:'Self',Body:A.Mesh.Name,I,J,First:[TriangleA.a.toArray(),TriangleA.b.toArray(),TriangleA.c.toArray()],Second:[TriangleB.a.toArray(),TriangleB.b.toArray(),TriangleB.c.toArray()]});
            }
            return false;
        }});
        for (let Second=First+1;Second<Bodies.length;++Second)
        {
            const B=Bodies[Second];
            if (!A.Box.intersectsBox(B.Box)) continue;
            A.Bvh.bvhcast(B.Bvh,Identity,{intersectsTriangles:(TriangleA,TriangleB,I,J)=>
            {
                ++BodyCandidates;
                if (Intersects(TriangleA,TriangleB))
                {
                    ++BodyHits;
                    if (Report.Hits.length<40) Report.Hits.push({Stage:Stage.Number,Type:'BetweenBodies',First:A.Mesh.Name,Second:B.Mesh.Name,I:A.Bvh.resolveTriangleIndex(I),J:B.Bvh.resolveTriangleIndex(J)});
                }
                return false;
            }});
        }
    }
    Report.Stages.push({Stage:Stage.Number,SelfCandidates,BodyCandidates,SelfHits,BodyHits});
    console.log(Report.Stages.at(-1));
}
Fs.writeFileSync(Output,JSON.stringify(Report,null,2));
Assert(Report.Stages.every(Stage=>Stage.SelfHits===0 && Stage.BodyHits===0),'Triangle intersections detected; inspect report.');
