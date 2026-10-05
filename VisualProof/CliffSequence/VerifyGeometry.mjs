//============================================================================================================================================
//                                                             VERIFYGEOMETRY.MJS
//============================================================================================================================================
// 📦 Polygon cliff corpus checks for topology, determinism, bounded joints and localized spall geometry.

import Assert from 'node:assert/strict';
import {writeFileSync, mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {GenerateCliff} from '../../Frontier/Experimental/CliffSequence/FractureSequence.js';
import {InsideMesh, MeshMetrics, Length, Subtract, Dot, Cross} from '../../Frontier/Experimental/CliffSequence/PolyhedronSolver.js';

const Destination=process.argv[2]||'_AgentScratch/CliffVerification';
mkdirSync(Destination,{recursive:true});
const Cases=[
    ['Default',{}],
    ['LegacyDefault',{NoiseMode:'None',Variation:0,FractureStyle:'Bedding'}],
    ['LegacyAmphitheatre',{Profile:'Amphitheatre',NoiseMode:'None',Variation:0,FractureStyle:'Bedding',Beds:5,Dip:-5}],['Headland17',{Seed:17}],['Headland913',{Seed:913}],
    ['Escarpment',{Profile:'Escarpment'}],['Escarpment17',{Profile:'Escarpment',Seed:17}],
    ['Amphitheatre',{Profile:'Amphitheatre'}],['Amphitheatre913',{Profile:'Amphitheatre',Seed:913}],
    ['WideShallow',{Width:48,Height:10,Depth:8,Relief:1.3,Retreat:.65,Beds:10,JointSpacing:3,Penetration:.55}],
    ['TallNarrow',{Width:18,Height:26,Depth:18,Relief:.35,Retreat:.25,Beds:4,Dip:-8,JointSpacing:7,Penetration:.9}],
    ['DeepBay',{Profile:'Amphitheatre',Relief:1.3,Retreat:.65,Dip:8,FaceRecess:1.5,SpallSize:1.3,CrackLength:2.2}],
    ['NoDamage',{SpallDensity:0,CrackDensity:0,FaceRecess:0}],
    ['DenseDamage',{Seed:73,SpallDensity:1,CrackDensity:1,CrackWidth:.22,CrackDepth:.3,TriangleSpan:.8}],
    ['UserAmphitheatre',{Profile:'Amphitheatre',Beds:5,Dip:-5}],
    ['FineCracks',{Seed:2026,CrackDensity:1,CrackWidth:.07,CrackDepth:.06,TriangleSpan:2.2}]
];
const Report={Date:'2026-10-05',Cases:[],Failures:[],DefaultDigest:null};
const Digest=Result=>createHash('sha256').update(JSON.stringify(Result.Stages.map(Stage=>Stage.Meshes))).digest('hex');
for (const [Name,Specification] of Cases)
{
    const Started=performance.now();
    try
    {
        const Result=GenerateCliff(Specification);
        const Checks={Finite:true,TriangleFaces:true,Closed:true,PositiveVolumes:true,BoundedRear:true,SpallEndsPreserved:true};
        for (const Stage of Result.Stages)
        {
            for (const Mesh of Stage.Meshes)
            {
                Assert(Mesh.Vertices.flat().every(Number.isFinite));
                Assert(Mesh.Triangles.every(Triangle=>Triangle.length===3 && Triangle.every(Index=>Number.isInteger(Index) && Index>=0 && Index<Mesh.Vertices.length)));
                const Metrics=MeshMetrics(Mesh);
                Assert.equal(Metrics.OpenEdges+Metrics.NonmanifoldEdges+Metrics.WindingErrors+Metrics.ZeroArea+Metrics.NonmanifoldVertices+Metrics.DuplicateTriangles,0,`${Name} stage ${Stage.Number} ${Mesh.Name}: structural mesh defect`);
                Assert(Metrics.Volume>0,`${Name} stage ${Stage.Number} ${Mesh.Name}: non-positive volume`);
                if (Stage.Number>=3)
                {
                    if (Mesh.Name.endsWith('core'))
                    {
                        const Middle=-Result.Specification.Depth*.48;
                        const Half=Result.Specification.Depth*(1-Result.Specification.Penetration)*.5;
                        Assert(Mesh.Vertices.every(Point=>Math.abs(Point[2]-Middle)<Half+.12 &&
                            Math.abs(Point[0])<Result.Specification.Width*.28+.12),`${Name}: core extends beyond joint termination`);
                    }
                }
                for (const Spall of Mesh.Spalls)
                {
                    const [A,B]=Spall.OriginalEdge;
                    const Δ=Subtract(B,A), Squared=Dot(Δ,Δ);
                    const OnOriginal=Spall.Rim.filter(Point=>Length(Cross(Subtract(Point,A),Δ))/Math.sqrt(Squared)<1e-6);
                    Assert.equal(OnOriginal.length,2);
                    for (const Point of OnOriginal)
                    {
                        const Fraction=Dot(Subtract(Point,A),Δ)/Squared;
                        Assert(Fraction>.01 && Fraction<.99,`${Name}: chip became an entire-edge bevel`);
                    }
                    Assert(Spall.Rim.length===4 || Spall.Rim.length===6);
                }
            }
        }
        if (Name==='Default')
        {
            Report.DefaultDigest=Digest(Result);
            Assert(Result.Stages.every(Stage=>Stage.Metrics.ThinTriangles===0),'Default has triangles below five degrees');
            Assert(Result.Stages[3].Metrics.Spalls>60 && Result.Stages[4].Metrics.Cracks>10);
            writeFileSync(`${Destination}/DefaultMesh.json`,JSON.stringify(Result));
        }
        if (Name==='NoDamage')
        {
            Assert.equal(Result.Stages[3].Metrics.Spalls,0);
            Assert.equal(Result.Stages[4].Metrics.Cracks,0);
            Assert.deepEqual(Result.Stages[2].Meshes.map(Mesh=>Mesh.Triangles),Result.Stages[4].Meshes.map(Mesh=>Mesh.Triangles));
        }
        Report.Cases.push({Name,Specification:Result.Specification,Milliseconds:performance.now()-Started,Checks,Stages:Result.Stages.map(Stage=>Stage.Metrics)});
        console.log(Name,'PASS',Result.Stages.map(Stage=>Stage.Metrics.ThinTriangles).join(','));
    }
    catch (Error)
    {
        Report.Failures.push({Name,Error:Error.stack});
        console.error(Name,'FAIL',Error.message);
    }
    writeFileSync(`${Destination}/Geometry.json`,JSON.stringify(Report,null,2));
}
try
{
    const Repeat=GenerateCliff({});
    Assert.equal(Digest(Repeat),Report.DefaultDigest);
    Report.DeterministicReplay=true;
}
catch(Error)
{
    Report.Failures.push({Name:'DeterministicReplay',Error:Error.stack});
}
writeFileSync(`${Destination}/Geometry.json`,JSON.stringify(Report,null,2));
if (Report.Failures.length) process.exitCode=1;
