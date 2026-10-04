//============================================================================================================================================
//                                                             VERIFYBROWSER.CJS
//============================================================================================================================================
// 📦 Real-browser cliff stage, export, cancellation, failure handling, camera and responsive-layout verification.

const {chromium}=require('playwright');
const Assert=require('node:assert/strict');
const Fs=require('node:fs');
const Path=require('node:path');
const {createHash}=require('node:crypto');
const Destination=process.argv[2]||'_AgentScratch/CliffBrowser';
const Url=process.env.CLIFF_URL||'http://127.0.0.1:8080/Frontier/Experimental/CliffSequence/index.html';
Fs.mkdirSync(Destination,{recursive:true});
const Report={Date:'2026-10-05',Url,Errors:[],Checks:{},Captures:[],SourceHashes:{},ViewportReadbacks:{}};
const Source='Frontier/Experimental/CliffSequence';
for (const Name of Fs.readdirSync(Source).filter(Name=>/\.(js|html|css)$/.test(Name)))
    Report.SourceHashes[Name]=createHash('sha256').update(Fs.readFileSync(Path.join(Source,Name))).digest('hex');
(async()=>
{
    const Launch={headless:true};
    if (process.env.CLIFF_SANDBOX_CHROMIUM==='1')
    {
        Launch.executablePath=process.env.CLIFF_CHROMIUM_PATH||'/tmp/chromium';
        Launch.args=[...require('@sparticuz/chromium').default.args,'--enable-webgl'];
        Launch.env={...process.env,LD_LIBRARY_PATH:'/tmp/al2023/lib'};
    }
    const Browser=await chromium.launch(Launch);
    Report.BrowserVersion=Browser.version();
    try
    {
        const Page=await Browser.newPage({viewport:{width:1536,height:1000},deviceScaleFactor:1,acceptDownloads:true});
        Page.on('pageerror',Error=>Report.Errors.push(Error.message));
        Page.on('console',Message=>{if (Message.type()==='error') Report.Errors.push(Message.text());});
        const Ready=async ()=>
        {
            await Page.waitForFunction(()=>window.CliffApp && (CliffApp.State.ReadyRevision===CliffApp.State.Revision || CliffApp.State.Error),{},{timeout:180000});
            const Error=await Page.evaluate(()=>CliffApp.State.Error);
            Assert.equal(Error,null,Error);
        };
        const Settle=()=>Page.evaluate(()=>new Promise(Resolve=>requestAnimationFrame(()=>requestAnimationFrame(Resolve))));
        const Capture=async Name=>
        {
            await Settle();
            const Readback=await Page.evaluate(()=>CliffApp.Renderer.domElement.toDataURL());
            const Pixels=Buffer.from(Readback.split(',')[1],'base64');
            Report.ViewportReadbacks[Name]=createHash('sha256').update(Pixels).digest('hex');
            if (['Escarpment','Amphitheatre'].includes(Name)) Fs.writeFileSync(Path.join(Destination,`${Name}Canvas.png`),Pixels);
            if (process.env.CLIFF_SANDBOX_CHROMIUM==='1')
            {
                await Page.bringToFront();
                // 📝 Resynchronize the headless-shell compositor after worker/scene replacement.
                const Size=Page.viewportSize();
                await Page.setViewportSize({width:Size.width+1,height:Size.height});
                await Page.setViewportSize(Size);
            }
            await Settle();
            await Page.screenshot({path:Path.join(Destination,`${Name}.png`),timeout:60000});
            Report.Captures.push(Name);
        };
        await Page.goto(Url);
        await Ready();
        Report.Default=await Page.evaluate(()=>({Milliseconds:CliffApp.State.Milliseconds,Specification:CliffApp.State.Result.Specification,
            Metrics:CliffApp.State.Result.Stages.map(Stage=>Stage.Metrics)}));
        Assert(Report.Default.Metrics.every(M=>!M.OpenEdges && !M.NonmanifoldEdges && !M.NonmanifoldVertices && !M.WindingErrors && !M.ZeroArea && !M.DuplicateTriangles && !M.ThinTriangles));
        Report.Checks.DefaultTopology=true;
        for (const [Stage,Name] of [[1,'01CliffMass'],[2,'02Bedding'],[3,'03Joints'],[4,'04Spalls'],[5,'05Fissures']])
        {
            await Page.click(`.StageButton[data-stage="${Stage}"]`);
            Assert.equal(await Page.evaluate(()=>CliffApp.State.Stage),Stage);
            await Capture(Name);
        }
        Assert.notEqual(Report.ViewportReadbacks['01CliffMass'],Report.ViewportReadbacks['03Joints']);
        Assert.notEqual(Report.ViewportReadbacks['03Joints'],Report.ViewportReadbacks['04Spalls']);
        Assert.notEqual(Report.ViewportReadbacks['04Spalls'],Report.ViewportReadbacks['05Fissures']);
        Report.Checks.StageNavigation=true;
        await Page.evaluate(()=>
        {
            document.querySelectorAll('.Inspector details').forEach(Details=>{Details.open=Details.querySelector('summary').textContent==='Diagnostics';});
        });
        await Capture('Diagnostics');
        await Page.click('#Wire');
        Assert(await Page.evaluate(()=>CliffApp.BodyGroup.children.every(Body=>Body.children[0].visible)));
        await Capture('TriangleWireframe');
        await Page.click('#Wire');
        await Page.click('#Scars');
        await Capture('CutSurfaces');
        await Page.click('#Clay');
        Report.Checks.TextureFree=await Page.evaluate(()=>CliffApp.BodyGroup.children.every(Body=>!Body.material.map && !Body.material.normalMap && !Body.material.displacementMap && !Body.material.vertexColors));
        Assert(Report.Checks.TextureFree);
        const Digest=await Page.evaluate(()=>CliffApp.ObjText());
        const ObjLines=Digest.trim().split('\n');
        const VertexCount=ObjLines.filter(Line=>Line.startsWith('v ')).length;
        const Faces=ObjLines.filter(Line=>Line.startsWith('f '));
        Assert(Faces.every(Line=>Line.split(' ').length===4 && Line.split(' ').slice(1).every(Index=>Number(Index)>0 && Number(Index)<=VertexCount)));
        Assert.equal(Faces.length,Report.Default.Metrics[4].Triangles);
        const [Download]=await Promise.all([Page.waitForEvent('download',{timeout:60000}),Page.click('#ExportObj')]);
        await Download.saveAs(Path.join(Destination,'Export.obj'));
        Assert.equal(Fs.readFileSync(Path.join(Destination,'Export.obj'),'utf8'),Digest);
        await Page.evaluate(()=>{document.getElementById('Explode').closest('details').open=true;});
        const Explode=Page.locator('#Explode');
        await Explode.check();
        Assert.equal(await Page.evaluate(()=>CliffApp.ObjText()),Digest);
        await Capture('ExplodedBlocks');
        await Explode.uncheck();
        Report.Checks.TriangleObjExport={Vertices:VertexCount,Faces:Faces.length,Filename:Download.suggestedFilename(),IgnoresInspectionTransforms:true};
        await Page.evaluate(()=>{CliffApp.ViewStage(4);CliffApp.FocusSpall();});
        await Capture('LocalSpallAfter');
        await Page.evaluate(()=>CliffApp.ViewStage(3));
        await Capture('LocalSpallBefore');
        await Page.evaluate(()=>CliffApp.ViewStage(5));
        await Page.evaluate(()=>
        {
            const Bodies=CliffApp.BodyGroup.children.filter(Body=>Body.userData.Mesh.Cracks.length);
            Bodies.sort((A,B)=>Math.abs(A.userData.Centre.x)-Math.abs(B.userData.Centre.x));
            const Body=Bodies[0],Crack=Body.userData.Mesh.Cracks[0];
            CliffApp.SelectBody(Body,false);
            const Centre=CliffApp.Controls.target.clone().fromArray(Crack.Centre);
            const Mean=Points=>Points.reduce((Sum,Point)=>Sum.add(Centre.clone().fromArray(Point)),Centre.clone().set(0,0,0)).divideScalar(Points.length);
            const FaceNormal=Mean(Crack.Rim).sub(Mean(Crack.Root)).normalize();
            CliffApp.Controls.target.copy(Centre);
            CliffApp.Camera.position.copy(Centre).addScaledVector(FaceNormal,5).add({x:1,y:.5,z:1});
            CliffApp.Controls.update();
        });
        await Capture('SurfaceFissure');
        await Page.click('#Isolate');
        Assert.equal(await Page.evaluate(()=>CliffApp.BodyGroup.children.filter(Body=>Body.visible).length),1);
        await Page.click('#ShowAll');
        Report.Checks.SelectionIsolation=true;
        const CanvasBox=await Page.locator('#SceneCanvas').boundingBox();
        const BeforeCamera=await Page.evaluate(()=>CliffApp.Camera.position.toArray());
        await Page.mouse.move(CanvasBox.x+CanvasBox.width*.5,CanvasBox.y+CanvasBox.height*.5);
        await Page.mouse.down();
        await Page.mouse.move(CanvasBox.x+CanvasBox.width*.5+100,CanvasBox.y+CanvasBox.height*.5+40,{steps:8});
        await Page.mouse.up();
        const AfterCamera=await Page.evaluate(()=>CliffApp.Camera.position.toArray());
        Assert.notDeepEqual(BeforeCamera,AfterCamera);
        await Page.click('#Frame');
        Report.Checks.OrbitDrag=true;
        await Page.evaluate(()=>
        {
            const Input=document.getElementById('Width');
            Input.value=35;
            Input.dispatchEvent(new Event('input',{bubbles:true}));
        });
        Assert(await Page.locator('#ExportObj').isDisabled());
        Assert(await Page.evaluate(()=>CliffApp.State.Dirty));
        await Page.evaluate(()=>CliffApp.SetSpecification({Width:35,Seed:17}));
        await Page.evaluate(()=>CliffApp.SetSpecification({Width:32,Seed:42}));
        await Ready();
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Result.Specification.Seed),42);
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Result.Specification.Width),32);
        Report.Checks.DirtyExportAndWorkerCancellation=true;
        await Page.evaluate(()=>{CliffApp.State.Specification.Width=NaN;CliffApp.Generate();});
        Assert(await Page.locator('#Failure').isVisible());
        Assert(await Page.locator('#ExportObj').isDisabled());
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Result),null);
        Assert.equal(await Page.evaluate(()=>CliffApp.BodyGroup.children.length),0);
        await Capture('FailureWithoutFallback');
        Report.Checks.NoStaleFallback=true;
        await Page.evaluate(()=>CliffApp.SetSpecification({Width:32}));
        await Ready();
        const [RecipeDownload]=await Promise.all([Page.waitForEvent('download',{timeout:60000}),Page.click('#ExportRecipe')]);
        await RecipeDownload.saveAs(Path.join(Destination,'Recipe.json'));
        const BeforeImport=await Page.evaluate(()=>CliffApp.State.Revision);
        await Page.setInputFiles('#RecipeFile',Path.join(Destination,'Recipe.json'));
        await Page.waitForFunction(Revision=>CliffApp.State.Revision>Revision,BeforeImport);
        await Ready();
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Result.Specification.Width),32);
        Report.Checks.RecipeRoundTrip=true;
        for (const Profile of ['Escarpment','Amphitheatre'])
        {
            await Page.selectOption('#Profile',Profile);
            await Ready();
            Assert.equal(await Page.evaluate(()=>CliffApp.State.Result.Specification.Profile),Profile);
            await Page.evaluate(()=>CliffApp.ViewStage(5));
            await Capture(Profile);
        }
        await Page.evaluate(()=>CliffApp.SetSpecification({Profile:'Headland'}));
        await Ready();
        await Page.setViewportSize({width:390,height:844});
        await Page.evaluate(()=>CliffApp.FrameView());
        await Settle();
        Assert(await Page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await Page.click('#PreviousStage');
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Stage),4);
        await Capture('Mobile');
        Report.Checks.Mobile={Width:390,Height:844,NoOverflow:true,StageButtons:true};
        Report.Renderer=await Page.evaluate(()=>
        {
            const GL=CliffApp.Renderer.getContext();
            return {WebGLVersion:GL.getParameter(GL.VERSION),Renderer:GL.getParameter(GL.RENDERER),Error:GL.getError()};
        });
        Assert.equal(Report.Renderer.Error,0);
        await Page.evaluate(()=>CliffApp.Renderer.getContext().getExtension('WEBGL_lose_context').loseContext());
        await Page.waitForFunction(()=>CliffApp.State.Error?.includes('WebGL context lost'));
        Assert(await Page.locator('#ExportObj').isDisabled());
        Assert(await Page.locator('#Regenerate').isDisabled());
        Assert.equal(await Page.evaluate(()=>CliffApp.BodyGroup.children.length),0);
        Report.Checks.ContextLossDisablesExport=true;
        Assert.deepEqual(Report.Errors,[]);
        Report.Passed=true;
    }
    finally
    {
        Fs.writeFileSync(Path.join(Destination,'Browser.json'),JSON.stringify(Report,null,2));
        await Browser.close();
    }
})().catch(Error=>{console.error(Error);process.exitCode=1;});
