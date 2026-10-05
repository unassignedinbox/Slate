//============================================================================================================================================
//                                                           VERIFYCHECKPOINTS.MJS
//============================================================================================================================================
// 📦 Selected-stage stopping, deterministic checkpoint reuse, parameter dependency and retained upstream geometry checks.

import Assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {CliffSequence} from '../../Frontier/Experimental/CliffSequence/FractureSequence.js';
import {CliffDefaults,StageProperties,EarliestStage} from '../../Frontier/Experimental/CliffSequence/CliffSpecification.js';
const Destination=process.argv[2]||'_AgentScratch/CliffRevisedFinal';
mkdirSync(Destination,{recursive:true});
const Sequence=new CliffSequence();
const Report={Date:'2026-10-05',Stages:[],Checks:{}};
const Hash=Stages=>createHash('sha256').update(JSON.stringify(Stages.map(Stage=>Stage.Meshes))).digest('hex');
for (let Through=1;Through<=5;++Through)
{
    const Executed=[];
    const Earlier=Hash(Sequence.Stages);
    const Result=Sequence.Generate(CliffDefaults,Stage=>Executed.push(Stage),Through);
    Assert.deepEqual(Executed,[Through]);
    Assert.deepEqual(Result.ExecutedStages,[Through]);
    Assert.deepEqual(Result.ReusedStages,Array.from({length:Through-1},(_,Index)=>Index+1));
    Assert.equal(Result.Stages.length,Through);
    Assert.equal(Hash(Result.Stages.slice(0,-1)),Earlier);
    Report.Stages.push({Through,Executed,Reused:Result.ReusedStages,Milliseconds:Result.Timings[Through]});
}
const OneShot=JSON.parse(readFileSync(`${Destination}/DefaultMesh.json`));
Assert.equal(Hash(Sequence.Stages),Hash(OneShot.Stages));
Report.Checks.OneShotEqualsStepped=true;
for (const [Index,Properties] of StageProperties.entries()) for (const Name of Properties)
{
    const Specification={...CliffDefaults,[Name]:typeof CliffDefaults[Name]==='number'?CliffDefaults[Name]+.01:'Escarpment'};
    Assert.equal(EarliestStage(CliffDefaults,Specification),Index+1,Name);
}
Report.Checks.AllParameterDependencies=true;
const Changed={...CliffDefaults,SpallDensity:.35};
const Result=Sequence.Generate(Changed,()=>{throw new Error('Downstream edit ran while inspecting stage 2');},2);
Assert.deepEqual(Result.ExecutedStages,[]);
Assert.equal(Result.Stages.length,3);
Assert.equal(Hash(Result.Stages),Hash(OneShot.Stages.slice(0,3)));
const Next=Sequence.Generate(Changed,()=>{},4);
Assert.deepEqual(Next.ExecutedStages,[4]);
Assert.equal(Next.Stages.length,4);
const BedChange={...Changed,Dip:-5};
const Upstream=Sequence.Generate(BedChange,()=>{throw new Error('Stage 2 ran during stage 1');},1);
Assert.equal(Upstream.Stages.length,1);
Assert.equal(Hash(Upstream.Stages),Hash(OneShot.Stages.slice(0,1)));
const Rebuilt=Sequence.Generate(BedChange,()=>{},2);
Assert.deepEqual(Rebuilt.ExecutedStages,[2]);
Report.Checks.EarliestAffectedInvalidation=true;
Report.Checks.NoFutureStageExecution=true;
Report.Checks.UpstreamUnchanged=true;
Report.Passed=true;
writeFileSync(`${Destination}/Checkpoints.json`,JSON.stringify(Report,null,2));
console.log(JSON.stringify(Report,null,2));
