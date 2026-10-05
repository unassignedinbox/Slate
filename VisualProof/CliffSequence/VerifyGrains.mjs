//============================================================================================================================================
//                                                               VERIFYGRAINS.MJS
//============================================================================================================================================
// 📦 Grain packing, conserved water/tracer, occupied-volume retreat, source attachment and deterministic study replay.

import Assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {GrainSequence,CaptureGrainSource,RestoreGrainRecipe} from '../../Frontier/Experimental/CliffSequence/GrainSequence.js';
import {ReadGrainSpecification} from '../../Frontier/Experimental/CliffSequence/GrainSpecification.js';
const Destination=process.argv[2]||'_AgentScratch/GrainProof';mkdirSync(Destination,{recursive:true});
const Hash=Content=>createHash('sha256').update(typeof Content==='string'?Content:JSON.stringify(Content)).digest('hex');
const Report={Date:'2026-10-05',Cases:[],Checks:{},Failures:[],SourceHashes:{}};
for(const File of readdirSync('Frontier/Experimental/CliffSequence').filter(File=>/^Grain.*\.js$/.test(File)))
    Report.SourceHashes[File]=Hash(readFileSync(`Frontier/Experimental/CliffSequence/${File}`,'utf8'));
function Valid(Sequence)
{
    const Reading=Sequence.Measure();
    Assert(Object.values(Reading).every(Number.isFinite));
    Assert(Math.abs(Reading.WaterResidual)<1e-12);Assert(Math.abs(Reading.TracerResidual)<1e-14);
    Assert(Reading.Volume>0&&Reading.RemovedVolume>=-1e-12);
    Assert.equal(Reading.Removed,Sequence.Columns.reduce((Sum,Column)=>Sum+Sequence.Specification.Layers-Column.Remaining,0));
    for(const Column of Sequence.Columns)for(const Grain of Column.Grains)
    {
        Assert(Grain.Water>=-1e-15&&Grain.Water<=Grain.Capacity+1e-15);
        Assert(Grain.Solute>=-1e-15&&Grain.Bond>=0&&Grain.Bond<=Grain.InitialBond);
        Assert(Grain.Oxide>=0&&Grain.Oxide<=1);
        Assert.equal(Grain.Alive,Grain.Layer<Column.Remaining);
    }
    const Boundary=Sequence.Boundary();
    Assert(Boundary.Vertices.flat().every(Number.isFinite));
    Assert(Boundary.Triangles.every(Triangle=>Triangle.length===3));
    const Metrics=Boundary.Metrics;
    Assert.equal(Metrics.OpenEdges+Metrics.NonmanifoldEdges+Metrics.NonmanifoldVertices+Metrics.ZeroArea+Metrics.WindingErrors+Metrics.DuplicateTriangles,0);
    Assert(Math.abs(Metrics.Volume-Reading.Volume)<Math.max(1e-12,Reading.Volume*1e-7));
    const MeshVolume=Boundary.Triangles.reduce((Sum,Triangle)=>
    {
        const [A,B,C]=Triangle.map(Index=>Boundary.Vertices[Index]);
        return Sum+(A[0]*(B[1]*C[2]-B[2]*C[1])+A[1]*(B[2]*C[0]-B[0]*C[2])+A[2]*(B[0]*C[1]-B[1]*C[0]))/6;
    },0);
    Assert(Math.abs(MeshVolume-Reading.Volume)<Math.max(1e-12,Reading.Volume*1e-7));
    Assert(Metrics.MinimumArea>=Metrics.AreaTolerance);
    return {Reading,Boundary};
}
const Cases=[['Default',{},120],['Dry',{Resolution:16,Rain:0},160],['NoDissolution',{Resolution:16,Solvent:0},160],
    ['NoOxidation',{Resolution:16,Oxidation:0,Solvent:0},160],['NoTransport',{Resolution:16,Runoff:0},160],
    ['Crystalline',{Resolution:18,Preset:'Crystalline',Seed:17},160],['Laminated',{Resolution:18,Preset:'Laminated',Seed:913},160],
    ['Small',{Resolution:12,Size:.06,Seed:73},120],['Dense',{Resolution:36,Layers:8,Seed:19},60],
    ['FineDense',{Resolution:36,Size:.06,Layers:8,Seed:73},40],['LargeShallow',{Resolution:12,Size:1.2,Layers:2,Seed:999999},120],
    ['Exhausted',{Resolution:12,Layers:2,Solvent:1,Rain:1,Drying:0,BondStrength:.2},1500],
    ['HorizontalSource',{Resolution:12},120,CaptureGrainSource([[-1,3,-1],[0,3,2],[2,3,-1]],'Upward face',1,4)],
    ['SmallSource',{Resolution:36,Layers:2,Seed:999999},40,CaptureGrainSource([[0,0,0],[.07,0,0],[0,.07,0]],'Small face',1,7)]];
for(const[Name,Specification,Cycles,Source=null]of Cases)
{
    try
    {
        const Sequence=new GrainSequence(Specification,Source),Initial=Valid(Sequence),Packing=Hash(Sequence.Columns.map(Column=>Column.Loop));
        const InitialParticles=Hash(Sequence.Columns);
        for(let Cycle=0;Cycle<Cycles;++Cycle)
        {
            const Before=Sequence.Removed;Sequence.Step();Assert(Sequence.Removed>=Before);
        }
        const Final=Valid(Sequence);
        Assert.equal(Packing,Hash(Sequence.Columns.map(Column=>Column.Loop)),'Weathering moved packed coordinates');
        Assert.equal(InitialParticles,Hash(new GrainSequence(Specification,Source).Columns));
        if(Name==='Dry'){Assert.equal(Sequence.Removed,0);Assert.equal(Final.Reading.Oxidation,0);Assert.equal(Hash(Initial.Boundary),Hash(Final.Boundary));}
        if(Name==='NoDissolution')Assert.equal(Sequence.Removed,0);
        if(Name==='NoOxidation')Assert.equal(Final.Reading.Oxidation,0);
        if(Name==='Exhausted')Assert.equal(Sequence.Removed,Final.Reading.Grains);
        if(Name==='Default')
        {
            Assert(Sequence.Removed>100);Assert(Final.Reading.Staining>0);Assert(Final.Reading.Oxidation>0);
            Assert.notEqual(Hash(Initial.Boundary),Hash(Final.Boundary));
            const Restored=RestoreGrainRecipe(Sequence.Recipe());
            Assert.equal(Hash(Restored.Columns),Hash(Sequence.Columns));
            Assert.equal(Hash(Restored.Boundary()),Hash(Final.Boundary));
            Report.Checks.ExactBoundaryReplay=true;
            writeFileSync(`${Destination}/DefaultMesh.json`,JSON.stringify({Specification:Sequence.Specification,Stages:[
                {Number:1,Meshes:[Initial.Boundary]},{Number:2,Meshes:[Final.Boundary]}]}));
            const Wet=Final.Reading.Moisture;
            for(let Cycle=0;Cycle<40;++Cycle)Sequence.Step({...Sequence.Specification,Rain:0,Drying:1});
            Assert(Sequence.Measure().Moisture<Wet*.1);
            Assert.equal(Hash(RestoreGrainRecipe(Sequence.Recipe()).Columns),Hash(Sequence.Columns));
            Report.Checks.WetDryReplay=true;
        }
        if(['FineDense','SmallSource'].includes(Name))writeFileSync(`${Destination}/${Name}Mesh.json`,JSON.stringify({Specification:Sequence.Specification,Stages:[{Number:1,Meshes:[Initial.Boundary]},{Number:2,Meshes:[Final.Boundary]}]}));
        Report.Cases.push({Name,Source,Specification:Sequence.InitialSpecification,Cycles,Initial:Initial.Boundary.Metrics,Final:Final.Boundary.Metrics,Metrics:Final.Reading});
        console.log(Name,'PASS',Final.Boundary.Metrics.Triangles,Final.Boundary.Metrics.ThinTriangles);
    }
    catch(Error){Report.Failures.push({Name,Error:Error.stack});console.error(Name,Error.message);}
    writeFileSync(`${Destination}/Grains.json`,JSON.stringify(Report,null,2));
}
try
{
    const Source=CaptureGrainSource([[-1,2,3],[2,2,3],[0,5,3]],'Reference face',1,87);
    const Sequence=new GrainSequence({Resolution:12},Source);
    for(const Column of Sequence.Columns)
    {
        const Coordinates=Column.Attachment.Barycentric;
        Assert.equal(Column.Attachment.TriangleIndex,87);Assert(Coordinates.every(Amount=>Amount>=0&&Amount<=1));Assert(Math.abs(Coordinates.reduce((A,B)=>A+B)-1)<1e-12);
        const Position=[0,1,2].map(Axis=>Source.Triangle.reduce((Sum,Point,Index)=>Sum+Point[Axis]*Coordinates[Index],0));
        const Expected=Source.Origin.map((Coordinate,Axis)=>Coordinate+Column.Centre[0]*Source.U[Axis]+Column.Centre[1]*Source.V[Axis]);
        Assert(Math.hypot(...Position.map((Coordinate,Axis)=>Coordinate-Expected[Axis]))<1e-10);
    }
    Assert.notEqual(Hash(Sequence.Columns),Hash(new GrainSequence({Resolution:12,Seed:17},Source).Columns));
    Assert.throws(()=>ReadGrainSpecification({Rain:NaN}));Assert.throws(()=>ReadGrainSpecification({Preset:'Unknown'}));
    Assert.throws(()=>RestoreGrainRecipe({Format:'Frontier.GrainWeathering',Version:1,Cycles:2001}));
    Assert.throws(()=>Sequence.Step({...Sequence.Specification,Seed:19}));
    Assert.throws(()=>CaptureGrainSource([[0,0,0],[0,0,0],[0,0,0]],'Degenerate',1));
    Report.Checks.SourceAttachment=true;Report.Checks.SeedVariation=true;Report.Checks.InvalidInputsRejected=true;
}
catch(Error){Report.Failures.push({Name:'Attachment and input checks',Error:Error.stack});}
Report.Passed=Report.Failures.length===0;writeFileSync(`${Destination}/Grains.json`,JSON.stringify(Report,null,2));
if(!Report.Passed)process.exitCode=1;
