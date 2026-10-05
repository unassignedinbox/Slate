//============================================================================================================================================
//                                                              VERIFYPRESETS.CJS
//============================================================================================================================================
// 📦 Real browser preset selection, seed changes, independent fracture controls, framing and versioned recipe roundtrips.

const Assert=require('node:assert/strict');
const Fs=require('node:fs');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const Chromium=require('@sparticuz/chromium');
const Destination=process.argv[2]||'_AgentScratch/CliffPresets';
Fs.mkdirSync(Destination,{recursive:true});
const Report={Date:'2026-10-05',Errors:[],Checks:{},Rebuilds:[],Captures:[],SourceHashes:{}};
const Hash=Value=>createHash('sha256').update(typeof Value==='string'?Value:JSON.stringify(Value)).digest('hex');
for (const File of Fs.readdirSync('Frontier/Experimental/CliffSequence').filter(File=>/\.(js|html|css)$/.test(File)))
    Report.SourceHashes[File]=Hash(Fs.readFileSync(`Frontier/Experimental/CliffSequence/${File}`,'utf8'));
(async()=>
{
    const Browser=await chromium.launch({headless:true,executablePath:process.env.PREVIEW_CHROMIUM||await Chromium.executablePath(),
        args:[...Chromium.args,'--enable-webgl'],env:{...process.env,LD_LIBRARY_PATH:process.env.PREVIEW_LIBRARIES||'/tmp/lib'}});
    try
    {
        const Page=await Browser.newPage({viewport:{width:1536,height:1000},deviceScaleFactor:1,acceptDownloads:true});
        Page.on('pageerror',Error=>Report.Errors.push(Error.message));
        Page.on('console',Message=>{if (Message.type()==='error') Report.Errors.push(Message.text());});
        const Ready=async Expected=>
        {
            await Page.waitForFunction(()=>window.CliffApp&&(CliffApp.State.ReadyRevision===CliffApp.State.Revision||CliffApp.State.Error),{},{timeout:180000});
            const Reading=await Page.evaluate(()=>({Error:CliffApp.State.Error,Executed:CliffApp.State.Result?.ExecutedStages,
                Reused:CliffApp.State.Result?.ReusedStages,Metrics:CliffApp.State.Result?.Stages[CliffApp.State.Stage-1].Metrics}));
            Assert.equal(Reading.Error,null);Assert.deepEqual(Reading.Executed,Expected);
            Assert.equal(Reading.Metrics.OpenEdges+Reading.Metrics.NonmanifoldEdges+Reading.Metrics.NonmanifoldVertices+
                Reading.Metrics.WindingErrors+Reading.Metrics.ZeroArea+Reading.Metrics.DuplicateTriangles,0);
            Report.Rebuilds.push(Reading);
        };
        const Capture=async Name=>
        {
            await Page.evaluate(()=>new Promise(Resolve=>requestAnimationFrame(()=>requestAnimationFrame(Resolve))));
            await Page.screenshot({path:`${Destination}/${Name}.png`});
            Report.Captures.push({Name,Specification:await Page.evaluate(()=>CliffApp.State.Result.Specification),Stage:await Page.evaluate(()=>CliffApp.State.Stage)});
        };
        const Edit=async(Name,Value)=>Page.evaluate(({Name,Value})=>
        {
            const Input=document.getElementById(Name);Input.value=Value;
            Input.dispatchEvent(new Event('input',{bubbles:true}));
        },{Name,Value});
        const Rebuild=async Expected=>{await Page.click('#Regenerate');await Ready(Expected);};
        const MassHash=async()=>Hash(await Page.evaluate(()=>CliffApp.State.Result.Stages[0].Meshes));
        const FractureHash=async()=>Hash(await Page.evaluate(()=>CliffApp.State.Result.Stages[1].Meshes));
        const Framed=async()=>
        {
            const Bounds=await Page.evaluate(()=>
            {
                const Vector=CliffApp.Controls.target.clone();
                CliffApp.Camera.updateMatrixWorld();
                const Points=CliffApp.BodyGroup.children.flatMap(Body=>Body.userData.Mesh.Vertices).map(Point=>Vector.set(...Point).project(CliffApp.Camera).toArray());
                return Points.reduce((Box,Point)=>[Math.max(Box[0],Math.abs(Point[0])),Math.max(Box[1],Math.abs(Point[1]))],[0,0]);
            });
            Assert(Bounds[0]<.92&&Bounds[1]<.92,`Preset clipped by viewport: ${Bounds}`);
            return Bounds;
        };
        await Page.goto(process.env.CLIFF_URL||'http://127.0.0.1:8080/Frontier/Experimental/CliffSequence/index.html',{waitUntil:'domcontentloaded',timeout:120000});
        await Ready([1]);
        for (const [File,Digest] of Object.entries(Report.SourceHashes))
        {
            const Response=await Page.request.get(new URL(File,Page.url()).href);
            Assert.equal(Hash(await Response.text()),Digest,`Runtime source mismatch: ${File}`);
        }
        const Original=await MassHash();
        await Capture('01HeadlandSeed42');
        await Edit('Seed',913);Assert(await Page.evaluate(()=>CliffApp.State.Dirty&&!CliffApp.State.Busy&&document.getElementById('ExportObj').disabled));
        await Rebuild([1]);Assert.notEqual(await MassHash(),Original);await Capture('02HeadlandSeed913');
        await Edit('Seed',42);await Rebuild([1]);Assert.equal(await MassHash(),Original);
        const Revision=await Page.evaluate(()=>CliffApp.State.Revision);
        await Page.click('#NewSeed');
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Revision),Revision);
        Assert(await Page.evaluate(()=>CliffApp.State.Dirty));await Rebuild([1]);
        Assert.notEqual(await MassHash(),Original);
        Report.Checks.NewSeedChangesMass=true;Report.Checks.NewSeedIsManual=true;Report.Checks.SameSeedReproducesMass=true;
        await Edit('Seed',42);await Rebuild([1]);
        Report.Checks.PresetFraming={};
        let Index=3;
        for (const [Profile,Width,Height,Depth] of [['Spire',16,44,14],['Needles',36,42,13],['WideWall',64,22,16],['Escarpment',42,22,14],['Amphitheatre',36,22,16]])
        {
            await Page.selectOption('#Profile',Profile);await Rebuild([1]);
            Assert.deepEqual(await Page.evaluate(()=>[CliffApp.State.Specification.Width,CliffApp.State.Specification.Height,CliffApp.State.Specification.Depth]),[Width,Height,Depth]);
            Assert.equal(await Page.evaluate(()=>CliffApp.State.Result.Stages.length),1);
            Report.Checks.PresetFraming[Profile]=await Framed();
            await Capture(`${String(Index++).padStart(2,'0')}${Profile}`);
            if (Profile==='Needles')
            {
                const Warnings=await Page.evaluate(()=>CliffApp.State.Result.Stages[0].Metrics.ThinTriangles);
                Assert(Warnings>0);Assert((await Page.locator('#Status').textContent()).includes(`${Warnings} narrow-triangle warnings`));
                Report.Checks.NarrowWarningsVisible=true;
            }
        }
        await Page.selectOption('#Profile','Headland');await Rebuild([1]);
        const NoiseHashes=[];
        for (const NoiseMode of ['Gradient','Cellular','Ridged'])
        {
            await Page.selectOption('#NoiseMode',NoiseMode);await Rebuild([1]);NoiseHashes.push(await MassHash());
        }
        Assert.equal(new Set(NoiseHashes).size,3);Report.Checks.DistinctNoiseFamilies=true;
        await Page.click('[data-stage="2"]');await Rebuild([2]);await Capture('08ConjugateFractures');
        const FirstCuts=await FractureHash();
        await Edit('FractureSeed',17);await Rebuild([2]);Assert.equal(await MassHash(),Original);Assert.notEqual(await FractureHash(),FirstCuts);
        await Edit('FractureSeed',42);await Rebuild([2]);Assert.equal(await FractureHash(),FirstCuts);
        const CutHashes=[FirstCuts];
        Index=9;
        for (const FractureStyle of ['Orthogonal','Vertical','Bedding'])
        {
            await Page.selectOption('#FractureStyle',FractureStyle);await Rebuild([2]);
            Assert.equal(await MassHash(),Original);CutHashes.push(await FractureHash());
            await Capture(`${String(Index++).padStart(2,'0')}${FractureStyle}Fractures`);
        }
        Assert.equal(new Set(CutHashes).size,4);Report.Checks.IndependentFractureSeed=true;Report.Checks.FourFracturePatterns=true;
        await Page.selectOption('#FractureStyle','Conjugate');await Rebuild([2]);
        await Page.click('[data-stage="3"]');await Rebuild([3]);await Capture('12BoundedJoints');
        for (const Stage of [4,5]) {await Page.click(`[data-stage="${Stage}"]`);await Rebuild([Stage]);}
        await Capture('13FinishedHeadland');await Page.click('#Rear');await Capture('14FinishedRear');
        const DownloadPromise=Page.waitForEvent('download');await Page.click('#ExportRecipe');
        const Download=await DownloadPromise;await Download.saveAs(`${Destination}/Roundtrip.json`);
        const Recipe=JSON.parse(Fs.readFileSync(`${Destination}/Roundtrip.json`));
        Assert.equal(Recipe.Version,2);const Geometry=Hash(await Page.evaluate(()=>CliffApp.State.Result.Stages[4].Meshes));
        const ImportRevision=await Page.evaluate(()=>CliffApp.State.Revision);
        await Page.setInputFiles('#RecipeFile',`${Destination}/Roundtrip.json`);
        await Page.waitForFunction(Revision=>CliffApp.State.Revision>Revision,ImportRevision);
        await Ready([]);
        Assert.equal(Hash(await Page.evaluate(()=>CliffApp.State.Result.Stages[4].Meshes)),Geometry);
        Report.Checks.RecipeRoundtrip=true;Fs.unlinkSync(`${Destination}/Roundtrip.json`);
        await Page.click('[data-stage="1"]');await Page.selectOption('#Profile','Spire');await Rebuild([1]);
        await Page.click('[data-stage="3"]');await Rebuild([2,3]);await Page.click('#Frame');await Capture('15FracturedSpire');
        await Page.click('[data-stage="1"]');await Page.selectOption('#Profile','WideWall');await Rebuild([1]);
        await Page.click('[data-stage="3"]');await Rebuild([2,3]);await Page.click('#Frame');await Capture('16FracturedWideWall');
        await Page.setViewportSize({width:390,height:844});await Page.click('#Frame');await Capture('17MobileWideWall');
        Assert(await Page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        Report.Checks.MobileNoOverflow=true;
        Report.Checks.GlError=await Page.evaluate(()=>CliffApp.Renderer.getContext().getError());Assert.equal(Report.Checks.GlError,0);
        Assert.deepEqual(Report.Errors,[]);Report.Passed=true;
    }
    finally
    {
        Fs.writeFileSync(`${Destination}/Presets.json`,JSON.stringify(Report,null,2));
        await Browser.close();
    }
})().catch(Error=>{console.error(Error);process.exitCode=1;});
