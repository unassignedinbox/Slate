//============================================================================================================================================
//                                                             VERIFYWORKFLOW.CJS
//============================================================================================================================================
// 📦 Actual selected-stage browser rebuilds, retained worker checkpoints, explicit dirty inputs and all-sided cliff captures.

const Assert=require('node:assert/strict');
const Fs=require('node:fs');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const Chromium=require('@sparticuz/chromium');
const Destination=process.argv[2]||'_AgentScratch/CliffWorkflow';
Fs.mkdirSync(Destination,{recursive:true});
const Report={Date:'2026-10-05',Errors:[],Checks:{},Rebuilds:[],Captures:[],SourceHashes:{}};
for (const File of Fs.readdirSync('Frontier/Experimental/CliffSequence').filter(File=>/\.(js|html|css)$/.test(File)))
    Report.SourceHashes[File]=createHash('sha256').update(Fs.readFileSync(`Frontier/Experimental/CliffSequence/${File}`)).digest('hex');
(async()=>
{
    const Browser=await chromium.launch({headless:true,executablePath:process.env.PREVIEW_CHROMIUM||await Chromium.executablePath(),
        args:[...Chromium.args,'--enable-webgl'],env:{...process.env,LD_LIBRARY_PATH:process.env.PREVIEW_LIBRARIES||'/tmp/lib'}});
    Report.BrowserVersion=Browser.version();
    try
    {
        const Page=await Browser.newPage({viewport:{width:1536,height:1000},deviceScaleFactor:1,acceptDownloads:true});
        Page.on('pageerror',Error=>Report.Errors.push(Error.message));
        Page.on('console',Message=>{if (Message.type()==='error') Report.Errors.push(Message.text());});
        const Ready=async Expected=>
        {
            await Page.waitForFunction(()=>window.CliffApp&&(CliffApp.State.ReadyRevision===CliffApp.State.Revision||CliffApp.State.Error),{},{timeout:180000});
            const Reading=await Page.evaluate(()=>({Error:CliffApp.State.Error,Executed:CliffApp.State.Result?.ExecutedStages,
                Reused:CliffApp.State.Result?.ReusedStages,Milliseconds:CliffApp.State.Milliseconds}));
            Assert.equal(Reading.Error,null);
            Assert.deepEqual(Reading.Executed,Expected);
            Report.Rebuilds.push(Reading);
        };
        const Capture=async Name=>
        {
            await Page.evaluate(()=>new Promise(Resolve=>requestAnimationFrame(()=>requestAnimationFrame(Resolve))));
            await Page.screenshot({path:`${Destination}/${Name}.png`});
            Report.Captures.push(Name);
        };
        const Edit=async(Name,Value)=>Page.evaluate(({Name,Value})=>
        {
            const Input=document.getElementById(Name);Input.value=Value;
            Input.dispatchEvent(new Event('input',{bubbles:true}));Input.dispatchEvent(new Event('change',{bubbles:true}));
        },{Name,Value});
        await Page.goto(process.env.CLIFF_URL||'http://127.0.0.1:8080/Frontier/Experimental/CliffSequence/index.html',{waitUntil:'domcontentloaded',timeout:120000});
        await Ready([1]);
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Result.Stages.length),1);
        await Page.evaluate(()=>{window.FirstWorker=CliffApp.State.Worker;});
        await Capture('01MassFront');
        await Page.click('#Rear');await Capture('02MassRear');
        await Edit('Width',33);
        Assert(await Page.evaluate(()=>CliffApp.State.Dirty&&document.getElementById('ExportObj').disabled));
        const Revision=await Page.evaluate(()=>CliffApp.State.Revision);
        await Page.waitForTimeout(300);
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Revision),Revision);
        await Page.click('#Regenerate');await Ready([1]);
        await Edit('Width',32);await Page.click('#Regenerate');await Ready([1]);
        await Page.click('[data-stage="2"]');
        Assert(await Page.evaluate(()=>CliffApp.State.DisplayStage===1&&CliffApp.State.Dirty&&document.getElementById('ExportObj').disabled));
        await Capture('03StageTwoInput');
        await Page.click('#Regenerate');await Ready([2]);
        Assert(await Page.evaluate(()=>CliffApp.State.Worker===FirstWorker));
        await Page.click('#Front');await Capture('04ConjugateFractures');
        await Edit('FractureBend',1.2);await Page.click('#Regenerate');await Ready([2]);
        await Edit('FractureBend',1);await Page.click('#Regenerate');await Ready([2]);
        for (const Stage of [3,4,5])
        {
            await Page.click(`[data-stage="${Stage}"]`);await Page.click('#Regenerate');await Ready([Stage]);
            await Page.click('#Frame');await Capture(`0${Stage+2}Stage${Stage}`);
        }
        Assert(await Page.evaluate(()=>CliffApp.State.Worker===FirstWorker));
        Report.Checks.PersistentWorker=true;
        Report.Checks.ManualRebuildOnly=true;
        Report.Checks.SelectedStageStopping=true;
        Report.Checks.UnbuiltInputLabel=true;
        Report.Checks.Metrics=await Page.evaluate(()=>CliffApp.State.Result.Stages.map(Stage=>Stage.Metrics));
        Assert(Report.Checks.Metrics.every(Metrics=>Metrics.OpenEdges+Metrics.NonmanifoldEdges+Metrics.NonmanifoldVertices+
            Metrics.WindingErrors+Metrics.ZeroArea+Metrics.DuplicateTriangles+Metrics.ThinTriangles===0));
        await Page.click('#Rear');await Capture('08FracturedRear');
        await Page.click('#Frame');
        await Page.evaluate(()=>{CliffApp.ViewStage(4);CliffApp.FocusSpall();});await Capture('09LocalSpallAfter');
        await Page.evaluate(()=>CliffApp.ViewStage(3));await Capture('10LocalSpallBefore');
        await Page.evaluate(()=>{CliffApp.ViewStage(5);CliffApp.FrameView();});
        const Obj=await Page.evaluate(()=>CliffApp.ObjText());
        const Faces=Obj.split('\n').filter(Line=>Line.startsWith('f '));
        Assert(Faces.every(Line=>Line.trim().split(/\s+/).length===4));
        Assert.equal(Faces.length,Report.Checks.Metrics[4].Triangles);
        const DownloadPromise=Page.waitForEvent('download');await Page.click('#ExportObj');
        const Download=await DownloadPromise;await Download.saveAs(`${Destination}/Inspection.obj`);
        Assert.equal(Fs.readFileSync(`${Destination}/Inspection.obj`,'utf8'),Obj);
        Fs.unlinkSync(`${Destination}/Inspection.obj`);
        await Page.check('#Explode');Assert.equal(await Page.evaluate(()=>CliffApp.ObjText()),Obj);await Page.uncheck('#Explode');
        Report.Checks.TriangleObjFaces=Faces.length;
        Report.Checks.ExplodePreservesObj=true;
        await Edit('CrackDensity',.35);
        Assert(await Page.evaluate(()=>CliffApp.State.DisplayStage===4&&CliffApp.State.Dirty));
        await Page.click('#Regenerate');await Ready([5]);
        Assert.deepEqual(await Page.evaluate(()=>CliffApp.State.Result.ReusedStages),[1,2,3,4]);
        Report.Checks.LateEditReuse=true;
        await Page.evaluate(()=>
        {
            CliffApp.SetSpecification({Profile:'Escarpment'});
            const Input=document.getElementById('Profile');Input.value='Amphitheatre';Input.dispatchEvent(new Event('input',{bubbles:true}));
            CliffApp.ViewStage(1);CliffApp.Generate();
        });
        await Ready([1]);
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Result.Specification.Profile),'Amphitheatre');
        Assert(await Page.evaluate(()=>CliffApp.State.Worker!==FirstWorker));
        Report.Checks.Cancellation=true;
        await Page.evaluate(()=>{CliffApp.ViewStage(2);CliffApp.SetSpecification({Beds:5,Dip:-5,CrackDensity:.55});});
        await Ready([2]);await Page.click('#Front');await Capture('11UserAmphitheatreBeds');
        await Page.evaluate(()=>{CliffApp.ViewStage(5);CliffApp.Generate();});
        await Ready([3,4,5]);await Page.click('#Frame');await Capture('12UserAmphitheatreFinal');
        Report.Checks.UserRecipe=await Page.evaluate(()=>CliffApp.State.Result.Stages[4].Metrics);
        Fs.writeFileSync(`${Destination}/LegacyRecipe.json`,JSON.stringify({Format:'Frontier.PolygonCliff',Version:1,
            Specification:{Profile:'Amphitheatre',Beds:5,Dip:-5}}));
        await Page.click('[data-stage="3"]');
        const ImportRevision=await Page.evaluate(()=>CliffApp.State.Revision);
        await Page.setInputFiles('#RecipeFile',`${Destination}/LegacyRecipe.json`);
        await Page.waitForFunction(Revision=>CliffApp.State.Revision>Revision,ImportRevision);
        await Ready([1,2,3]);
        Fs.unlinkSync(`${Destination}/LegacyRecipe.json`);
        Report.Checks.LegacyRecipe=await Page.evaluate(()=>CliffApp.State.Result.Stages[2].Metrics);
        Assert.equal(Report.Checks.LegacyRecipe.ThinTriangles,1);
        Assert((await Page.locator('#Status').textContent()).includes('1 narrow-triangle warnings'));
        await Capture('13LegacyTriangleWarning');
        Report.Checks.NarrowAngleWarningVisible=true;
        await Page.evaluate(()=>
        {
            window.OriginalWorker=window.Worker;
            CliffApp.State.Worker.terminate();CliffApp.State.Worker=null;
            window.Worker=function(){throw new Error('Injected worker refusal for verification');};
            CliffApp.Generate();
        });
        Assert(await Page.evaluate(()=>CliffApp.State.Result===null&&CliffApp.BodyGroup.children.length===0&&document.getElementById('ExportObj').disabled));
        Report.Checks.NoFailureFallback=true;
        await Page.evaluate(()=>{window.Worker=OriginalWorker;CliffApp.ViewStage(1);CliffApp.Generate();});await Ready([1]);
        await Page.setViewportSize({width:390,height:844});await Capture('14Mobile');
        Assert(await Page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        Report.Checks.MobileNoOverflow=true;
        Report.Checks.GlError=await Page.evaluate(()=>CliffApp.Renderer.getContext().getError());
        Assert.equal(Report.Checks.GlError,0);
        await Page.evaluate(()=>CliffApp.Renderer.forceContextLoss());
        await Page.waitForFunction(()=>document.getElementById('Regenerate').disabled);
        Assert(await Page.evaluate(()=>CliffApp.State.Result===null&&document.getElementById('ExportObj').disabled));
        Report.Checks.ContextLoss=true;
        Assert.deepEqual(Report.Errors,[]);
        Report.Passed=true;
    }
    finally
    {
        Fs.writeFileSync(`${Destination}/Workflow.json`,JSON.stringify(Report,null,2));
        await Browser.close();
    }
})().catch(Error=>{console.error(Error);process.exitCode=1;});
