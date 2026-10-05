//============================================================================================================================================
//                                                         VERIFYGRAINWORKFLOW.CJS
//============================================================================================================================================
// 📦 Browser proof of material weathering, palette persistence, picking, cancellation, error recovery and both responsive workspaces.

const Assert=require('node:assert/strict');
const Fs=require('node:fs');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const Chromium=require('@sparticuz/chromium');
const Destination=process.argv[2]||'_AgentScratch/GrainWorkflow';
Fs.mkdirSync(Destination,{recursive:true});
const Hash=Value=>createHash('sha256').update(JSON.stringify(Value)).digest('hex');
const Report={Date:'2026-10-05',Errors:[],Checks:{},Captures:[],SourceHashes:{}};
for(const File of Fs.readdirSync('Frontier/Experimental/CliffSequence').filter(File=>/\.(js|html|css)$/.test(File)))
    Report.SourceHashes[File]=createHash('sha256').update(Fs.readFileSync(`Frontier/Experimental/CliffSequence/${File}`)).digest('hex');
(async()=>
{
    const Browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args,
        env:{...process.env,LD_LIBRARY_PATH:'/tmp/lib'}});
    Report.BrowserVersion=Browser.version();
    try
    {
        const Page=await Browser.newPage({viewport:{width:1600,height:1040},acceptDownloads:true});
        Page.setDefaultTimeout(120000);
        Page.on('pageerror',Error=>Report.Errors.push(Error.message));
        Page.on('console',Message=>{if(Message.type()==='error')Report.Errors.push(Message.text());});
        const Ready=async()=>
        {
            await Page.waitForFunction(()=>!GrainApp.Parameters.Busy);
            Assert.equal(await Page.evaluate(()=>GrainApp.Parameters.Error),null);
            Assert(await Page.evaluate(()=>!!GrainApp.Parameters.Result));
        };
        const Capture=async Name=>
        {
            await Page.evaluate(()=>new Promise(Resolve=>requestAnimationFrame(()=>requestAnimationFrame(Resolve))));
            await Page.screenshot({path:`${Destination}/${Name}.png`});Report.Captures.push(Name);
        };
        const Edit=async(Name,Value)=>Page.evaluate(({Name,Value})=>
        {
            const Input=document.getElementById(Name);Input.value=Value;Input.dispatchEvent(new Event('input',{bubbles:true}));
        },{Name,Value});
        const Load=async Recipe=>
        {
            const Revision=await Page.evaluate(()=>GrainApp.Parameters.Revision);
            await Page.setInputFiles('#GrainFile',{name:'Study.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(Recipe))});
            await Page.waitForFunction(Revision=>GrainApp.Parameters.Revision>Revision,Revision);
        };
        await Page.goto(process.env.CLIFF_URL||'http://127.0.0.1:8080/Frontier/Experimental/CliffSequence/index.html');
        await Page.waitForFunction(()=>window.CliffApp?.State.Result||window.CliffApp?.State.Error);
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Error),null);
        await Capture('01CliffTheme');
        const CliffHash=Hash(await Page.evaluate(()=>CliffApp.State.Result.Stages));
        await Page.click('#MaterialTab');await Ready();
        Assert(await Page.evaluate(()=>Number.isInteger(GrainApp.Parameters.Source?.TriangleIndex)));
        Assert(await Page.evaluate(()=>GrainApp.Parameters.Result.Columns.every(Column=>Column.Attachment)));
        await Capture('02FreshGrains');
        for(let Batch=0;Batch<6;++Batch){await Page.click('#GrainTwenty');await Ready();}
        Report.Checks.Weathered=await Page.evaluate(()=>GrainApp.Parameters.Result.Metrics);
        Assert.equal(Report.Checks.Weathered.Cycle,120);Assert(Report.Checks.Weathered.Removed>0);
        await Capture('03WeatheredGrains');
        await Page.selectOption('#GrainChannel','Clay');await Capture('04ClayPits');
        await Page.locator('#GrainCanvas').click({position:{x:370,y:420}});
        Assert(await Page.evaluate(()=>GrainApp.Parameters.Selected!==null));Report.Checks.Picking=true;
        await Capture('05ParticleInspection');
        for(const Channel of ['Moisture','Bonds','Oxide','Exposure','Weakness','Material'])
        {
            await Page.selectOption('#GrainChannel',Channel);
            Assert.equal(await Page.evaluate(()=>GrainApp.Parameters.Channel),Channel);
        }
        Report.Checks.Channels=true;
        const SurfaceState=()=>({Positions:Array.from(GrainApp.Scene.children.find(Object=>Object.isMesh&&Object.material.vertexColors).geometry.attributes.position.array),
            Colours:Array.from(GrainApp.Scene.children.find(Object=>Object.isMesh&&Object.material.vertexColors).geometry.attributes.color.array)});
        const Before=await Page.evaluate(SurfaceState);
        await Edit('GrainTint0','#e0bca0');await Edit('GrainRain',.3);
        const After=await Page.evaluate(SurfaceState);
        Assert.equal(Hash(Before.Positions),Hash(After.Positions));Assert.notEqual(Hash(Before.Colours),Hash(After.Colours));
        Report.Checks.PaletteDoesNotDisplace=true;
        const DownloadPromise=Page.waitForEvent('download');await Page.click('#SaveActive');
        const Download=await DownloadPromise;await Download.saveAs(`${Destination}/Study.json`);
        const Recipe=JSON.parse(Fs.readFileSync(`${Destination}/Study.json`));
        Assert.equal(Recipe.PendingSpecification.Rain,.3);Assert.equal(Recipe.Palette[0],'#e0bca0');
        const GeometryHash=Hash(await Page.evaluate(()=>GrainApp.Parameters.Result.Boundary));
        await Page.click('#GrainStep');await Ready();Assert.equal(await Page.evaluate(()=>GrainApp.Parameters.Result.Metrics.Cycle),121);
        await Load(Recipe);await Ready();
        Assert.equal(Hash(await Page.evaluate(()=>GrainApp.Parameters.Result.Boundary)),GeometryHash);
        Assert.equal(await Page.inputValue('#GrainRain'),'0.3');Assert.equal(await Page.inputValue('#GrainTint0'),'#e0bca0');
        Report.Checks.SaveOpenExactGeometry=true;Report.Checks.PendingWeatherAndPalette=true;
        await Page.evaluate(()=>{document.getElementById('GrainTint0').closest('details').open=true;document.getElementById('GrainTint0').scrollIntoView();});
        await Capture('06Palette');
        await Page.click('#GrainPaletteReset');Assert.equal(await Page.evaluate(()=>GrainApp.Parameters.Palette),null);
        await Page.click('#GrainPlay');await Page.click('#GrainPlay');await Ready();
        Assert.equal(await Page.evaluate(()=>GrainApp.Parameters.Playing),false);Report.Checks.RunPause=true;
        await Page.click('#GrainTwenty');await Edit('GrainResolution',16);
        Assert(await Page.evaluate(()=>GrainApp.Parameters.Dirty&&!GrainApp.Parameters.Busy));
        Assert(await Page.isDisabled('#GrainStep'));Assert(await Page.isDisabled('#GrainSave'));
        await Page.click('#GrainBuild');await Ready();Assert.equal(await Page.evaluate(()=>GrainApp.Parameters.Result.Columns.length),256);
        Assert.equal(await Page.evaluate(()=>GrainApp.Parameters.Result.Metrics.Cycle),0);Report.Checks.CancelPacking=true;
        await Page.click('#GrainDry');await Ready();Assert.equal(await Page.inputValue('#GrainRain'),'0');
        const BeforeCapture=await Page.evaluate(()=>GrainApp.Parameters.ReadyRevision);
        await Page.click('#GeometryTab');
        const Canvas=await Page.locator('#SceneCanvas').boundingBox();
        await Page.locator('#SceneCanvas').dblclick({position:{x:Canvas.width*.5,y:Canvas.height*.55}});
        const SelectedFace=await Page.evaluate(()=>CliffApp.State.SourceFace);Assert(SelectedFace);
        await Page.click('#MaterialTab');
        await Page.click('#GrainCapture');await Ready();Assert((await Page.evaluate(()=>GrainApp.Parameters.ReadyRevision))>BeforeCapture);
        Assert.equal(await Page.evaluate(()=>GrainApp.Parameters.Source.TriangleIndex),SelectedFace.TriangleIndex);
        Assert.deepEqual(await Page.evaluate(()=>GrainApp.Parameters.Source.Triangle),SelectedFace.Triangle);
        Report.Checks.SourceCapture=true;Report.Checks.DoubleClickSourceTriangle=true;
        await Load({...Recipe,Palette:['invalid']});
        await Page.waitForFunction(()=>!GrainApp.Parameters.Busy);
        Assert.equal(await Page.evaluate(()=>GrainApp.Parameters.Error),'Invalid mineral palette');
        Assert(await Page.isDisabled('#GrainStep'));Assert(await Page.evaluate(()=>GrainApp.Parameters.Result===null));
        await Page.click('#GrainBuild');await Ready();
        await Page.evaluate(()=>
        {
            const Original=window.Worker;window.Worker=function(){throw new Error('Injected worker failure');};
            GrainApp.Send('Build');window.Worker=Original;
        });
        Assert.equal(await Page.evaluate(()=>GrainApp.Parameters.Error),'Injected worker failure');
        await Page.click('#GrainBuild');await Ready();Report.Checks.FailureRecovery=true;
        await Page.click('#GeometryTab');
        Assert.equal(Hash(await Page.evaluate(()=>CliffApp.State.Result.Stages)),CliffHash);
        Assert(await Page.evaluate(()=>CliffApp.Controls.enabled&&!GrainApp.Controls.enabled));
        await Edit('Width',33);await Page.click('#Regenerate');
        await Page.waitForFunction(()=>CliffApp.State.ReadyRevision===CliffApp.State.Revision||CliffApp.State.Error);
        Assert.deepEqual(await Page.evaluate(()=>CliffApp.State.Result.ExecutedStages),[1]);
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Result.Stages.length),1);Report.Checks.StageLocalCliff=true;
        await Page.click('#MaterialTab');await Page.setViewportSize({width:390,height:844});await Page.click('#GrainFrame');
        Assert(await Page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await Capture('07MobileGrains');
        await Page.click('#GeometryTab');await Capture('08MobileCliff');
        Assert(await Page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));Report.Checks.MobileNoOverflow=true;
        Report.Checks.GlErrors=await Page.evaluate(()=>[CliffApp.Renderer.getContext().getError(),GrainApp.Renderer.getContext().getError()]);
        Assert.deepEqual(Report.Checks.GlErrors,[0,0]);
        Assert(await Page.evaluate(()=>GrainApp.Scene.children.filter(Object=>Object.isMesh).every(Object=>!Object.material.map&&!Object.material.normalMap&&!Object.material.displacementMap&&!Object.material.bumpMap)));
        Report.Checks.NoMaterialMaps=true;
        Assert.deepEqual(Report.Errors,[]);Report.Passed=true;
    }
    finally {Fs.writeFileSync(`${Destination}/Workflow.json`,JSON.stringify(Report,null,2));await Browser.close();}
})().catch(Error=>{console.error(Error);process.exitCode=1;});
