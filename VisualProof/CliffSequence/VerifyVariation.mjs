//============================================================================================================================================
//                                                            VERIFYVARIATION.MJS
//============================================================================================================================================
// 📦 Preset, seed, noise-family and fracture-family geometry checks with reproducible stage-local generation.

import Assert from 'node:assert/strict';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {GenerateCliff,CliffSequence} from '../../Frontier/Experimental/CliffSequence/FractureSequence.js';
import {CliffDefaults,FormationPresets,NoiseModes,FractureStyles,ReadRecipe} from '../../Frontier/Experimental/CliffSequence/CliffSpecification.js';
const Destination=process.argv[2]||'_AgentScratch/VariationProof';
mkdirSync(Destination,{recursive:true});
const Report={Date:'2026-10-05',Cases:[],Failures:[],Checks:{}};
const Hash=Stage=>createHash('sha256').update(JSON.stringify(Stage.Meshes)).digest('hex');
function Check(Name,Specification,Through)
{
    const Result=GenerateCliff(Specification,()=>{},Through);
    for (const Stage of Result.Stages)
    {
        const Metrics=Stage.Metrics;
        Assert.equal(Metrics.OpenEdges+Metrics.NonmanifoldEdges+Metrics.NonmanifoldVertices+Metrics.WindingErrors+
            Metrics.ZeroArea+Metrics.DuplicateTriangles,0,`${Name} stage ${Stage.Number}`);
        Assert(Stage.Records.every(Record=>Record.Volume>0));
        Assert(Stage.Meshes.every(Mesh=>Mesh.Vertices.flat().every(Number.isFinite) && Mesh.Triangles.every(Triangle=>Triangle.length===3)));
    }
    Report.Cases.push({Name,Specification:Result.Specification,Stages:Result.Stages.map(Stage=>Stage.Metrics),MassHash:Hash(Result.Stages[0])});
    if (Name==='Default'||Name==='Spire42'||Name==='WideWall42'||Name==='Needles42')
        writeFileSync(`${Destination}/${Name}Mesh.json`,JSON.stringify(Result));
    console.log(Name,Result.Stages.map(Stage=>`${Stage.Metrics.Triangles}/${Stage.Metrics.ThinTriangles}`).join(' '));
    return Result;
}
const Cases=[['Default',{},5]];
for (const [Profile,Preset] of Object.entries(FormationPresets)) for (const Seed of [42,913])
    Cases.push([`${Profile}${Seed}`,{...Preset,Profile,Seed},Seed===42&&['Spire','WideWall','Needles'].includes(Profile)?5:2]);
for (const NoiseMode of Object.keys(NoiseModes)) Cases.push([`Noise${NoiseMode}`,{NoiseMode,Seed:73},2]);
for (const FractureStyle of Object.keys(FractureStyles)) Cases.push([`Fractures${FractureStyle}`,{FractureStyle,FractureSeed:17},3]);
Cases.push(['TallLimit',{...FormationPresets.Spire,Profile:'Spire',Height:56,Width:10,Variation:1},2]);
Cases.push(['WideLimit',{...FormationPresets.WideWall,Profile:'WideWall',Width:80,Variation:1},2]);
for (const [Name,Specification,Through] of Cases)
{
    try {Check(Name,Specification,Through);}
    catch(Error) {Report.Failures.push({Name,Error:Error.stack});console.error(Name,Error.message);}
    writeFileSync(`${Destination}/Variation.json`,JSON.stringify(Report,null,2));
}
try
{
    for (const Profile of Object.keys(FormationPresets))
        Assert.notEqual(Report.Cases.find(Case=>Case.Name===`${Profile}42`).MassHash,Report.Cases.find(Case=>Case.Name===`${Profile}913`).MassHash);
    const Original=Report.Cases.find(Case=>Case.Name==='Default');
    const Sequence=new CliffSequence();
    const First=Sequence.Generate({},()=>{},1);
    Assert.equal(Hash(First.Stages[0]),Original.MassHash);
    const Second=Sequence.Generate({},()=>{},2);
    Assert.deepEqual(Second.ExecutedStages,[2]);
    Assert.deepEqual(Second.ReusedStages,[1]);
    const Changed=Sequence.Generate({...CliffDefaults,FractureStyle:'Vertical',FractureSeed:9},()=>{},2);
    Assert.deepEqual(Changed.ExecutedStages,[2]);Assert.equal(Hash(Changed.Stages[0]),Original.MassHash);
    const NewFormation=Sequence.Generate({...CliffDefaults,Seed:913},()=>{},1);
    Assert.deepEqual(NewFormation.ExecutedStages,[1]);Assert.equal(NewFormation.Stages.length,1);
    const Legacy=ReadRecipe({Format:'Frontier.PolygonCliff',Version:1,Specification:{Seed:17}});
    Assert.equal(Legacy.NoiseMode,'None');Assert.equal(Legacy.FractureStyle,'Bedding');Assert.equal(Legacy.FractureSeed,17);
    Assert.deepEqual(ReadRecipe({Format:'Frontier.PolygonCliff',Version:2,Specification:CliffDefaults}),CliffDefaults);
    const Default=JSON.parse(readFileSync(`${Destination}/DefaultMesh.json`));
    const Stepped=new CliffSequence();
    for (let Through=1;Through<=5;++Through) Stepped.Generate({},()=>{},Through);
    Assert.deepEqual(Stepped.Stages.map(Hash),Default.Stages.map(Hash));
    Report.Checks={SeedsChangeAllPresets:true,Reproducible:true,FractureOnlyReusesMass:true,FormationSeedInvalidatesMass:true,
        LegacyRecipeMigration:true,RecipeRoundtrip:true,OneShotEqualsStepped:true};
}
catch(Error) {Report.Failures.push({Name:'Repeatability and checkpoints',Error:Error.stack});}
Report.Passed=Report.Failures.length===0;
writeFileSync(`${Destination}/Variation.json`,JSON.stringify(Report,null,2));
if (!Report.Passed) process.exitCode=1;
