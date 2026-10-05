//============================================================================================================================================
//                                                             VERIFYCAMERAZOOM.CJS
//============================================================================================================================================
// 📦 Actual browser regression for bounded wheel and middle-button dolly at fractional and high device pixel ratios in both cliff views.

const Assert=require('node:assert/strict');
const Fs=require('node:fs');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const Chromium=require('@sparticuz/chromium');
const Destination=process.argv[2]||'_AgentScratch/CameraZoom';
Fs.mkdirSync(Destination,{recursive:true});
const Report={Date:'2026-10-05',Errors:[],Cases:[],Checks:{},SourceHashes:{}};
for(const Name of ['Ocean/lib/addons/OrbitControls.js','CliffSequence/WorkspacePanel.js','CliffSequence/GrainPanel.js'])
    Report.SourceHashes[Name]=createHash('sha256').update(Fs.readFileSync(`Frontier/Experimental/${Name}`)).digest('hex');
(async()=>
{
    const Browser=await chromium.launch({executablePath:await Chromium.executablePath(),args:Chromium.args,
        env:{...process.env,LD_LIBRARY_PATH:process.env.PREVIEW_LIBRARIES||'/tmp/lib'}});
    Report.BrowserVersion=Browser.version();
    try
    {
        const Page=await Browser.newPage({viewport:{width:1536,height:1000},deviceScaleFactor:.8});
        Page.setDefaultTimeout(120000);
        Page.on('pageerror',Error=>Report.Errors.push(Error.message));
        Page.on('console',Message=>{if(Message.type()==='error')Report.Errors.push(Message.text());});
        await Page.goto(process.env.CLIFF_URL||'http://127.0.0.1:8080/Frontier/Experimental/CliffSequence/index.html');
        await Page.waitForFunction(()=>window.CliffApp?.State.Result||window.CliffApp?.State.Error);
        Assert.equal(await Page.evaluate(()=>CliffApp.State.Error),null);
        await Page.click('#MaterialTab');
        await Page.waitForFunction(()=>GrainApp.Parameters.Result||GrainApp.Parameters.Error);
        Assert.equal(await Page.evaluate(()=>GrainApp.Parameters.Error),null);
        const Session=await Page.context().newCDPSession(Page);
        const Frames=async()=>Page.evaluate(()=>new Promise(Resolve=>requestAnimationFrame(()=>requestAnimationFrame(Resolve))));
        const Distance=async()=>Page.evaluate(()=>ZoomApp.Camera.position.distanceTo(ZoomApp.Controls.target));
        const Reset=async()=>{await Page.evaluate(()=>ZoomApp===CliffApp?ZoomApp.FrameView():ZoomApp.Frame());await Frames();};
        for(const DPR of [.5,.8,1,1.25,1.5,2])
        {
            await Session.send('Emulation.setDeviceMetricsOverride',{width:1536,height:1000,deviceScaleFactor:DPR,mobile:false});
            for(const View of ['Geometry','Material'])
            {
                await Page.click(`#${View}Tab`);
                await Page.evaluate(View=>{window.ZoomApp=View==='Geometry'?CliffApp:GrainApp;},View);
                const Row={View,RequestedDPR:DPR,DPR:await Page.evaluate(()=>devicePixelRatio),Wheels:[]};
                for(const [Delta,Mode] of [[-120,0],[120,0],[-.25,0],[.25,0],[-3,1],[3,1],[-1,2],[1,2],[-1e8,0],[1e8,0]])
                {
                    await Reset();
                    const Reading=await Page.evaluate(({Delta,Mode})=>
                    {
                        const {Camera,Controls,Renderer}=ZoomApp,Before=Camera.position.distanceTo(Controls.target);
                        Renderer.domElement.dispatchEvent(new WheelEvent('wheel',{deltaY:Delta,deltaMode:Mode,bubbles:true,cancelable:true}));
                        return {Before,After:Camera.position.distanceTo(Controls.target),Min:Controls.minDistance,Max:Controls.maxDistance,
                            Height:Renderer.domElement.clientHeight};
                    },{Delta,Mode});
                    const Unit=Mode===1?16:Mode===2?Reading.Height:1;
                    const Factor=Math.pow(.95,Math.min(Math.abs(Delta*Unit),200)/100);
                    const Expected=Reading.Before*(Delta<0?Factor:1/Factor);
                    Assert(Math.abs(Reading.After-Expected)<Expected*1e-9);
                    Assert(Reading.After>Reading.Min&&Reading.After<Reading.Max);
                    Row.Wheels.push({Delta,Mode,...Reading});
                }
                await Reset();
                const Canvas=View==='Geometry'?'#SceneCanvas':'#GrainCanvas',Box=await Page.locator(Canvas).boundingBox();
                await Page.mouse.move(Box.x+Box.width*.5,Box.y+Box.height*.5);
                await Page.evaluate(()=>
                {
                    window.ZoomWheel=null;ZoomApp.Renderer.domElement.addEventListener('wheel',Event=>
                        {window.ZoomWheel={Delta:Event.deltaY,Mode:Event.deltaMode};},{once:true,capture:true});
                });
                const Before=await Distance();await Page.mouse.wheel(0,-120);
                await Page.waitForFunction(Before=>Math.abs(ZoomApp.Camera.position.distanceTo(ZoomApp.Controls.target)-Before)>1e-8,Before);
                await Frames();
                const After=await Distance(),Delivered=await Page.evaluate(()=>ZoomWheel);
                Assert.equal(Delivered.Mode,0);Assert(Delivered.Delta<0);
                // 📝 CDP may rescale its injected wheel delta under DPR emulation; verify the actual CSS-pixel event received.
                Assert(Math.abs(After/Before-Math.pow(.95,Math.min(Math.abs(Delivered.Delta),200)/100))<1e-9);
                Row.RealWheel={Before,After,Delivered};
                await Reset();
                const DragBefore=await Distance();
                await Page.mouse.down({button:'middle'});await Page.mouse.move(Box.x+Box.width*.5,Box.y+Box.height*.5+40,{steps:4});
                await Page.mouse.up({button:'middle'});await Frames();
                const DragAfter=await Distance();Assert(Math.abs(DragAfter/DragBefore-Math.pow(.95,-.4))<1e-9);
                Row.MiddleDrag={Before:DragBefore,After:DragAfter};
                Report.Cases.push(Row);
            }
        }
        for(const View of ['Geometry','Material'])
        {
            await Page.click(`#${View}Tab`);await Page.evaluate(View=>{window.ZoomApp=View==='Geometry'?CliffApp:GrainApp;},View);
            await Reset();
            const Result=await Page.evaluate(()=>
            {
                const {Camera,Controls,Renderer}=ZoomApp,Measure=()=>Camera.position.distanceTo(Controls.target);
                for(let Count=0;Count<300;++Count)Renderer.domElement.dispatchEvent(new WheelEvent('wheel',{deltaY:-200,cancelable:true}));
                const Near=Measure();
                for(let Count=0;Count<300;++Count)Renderer.domElement.dispatchEvent(new WheelEvent('wheel',{deltaY:200,cancelable:true}));
                return {Near,Far:Measure(),Min:Controls.minDistance,Max:Controls.maxDistance};
            });
            Assert(Math.abs(Result.Near-Result.Min)<1e-9);Assert(Math.abs(Result.Far-Result.Max)<1e-9);
            Report.Checks[`${View}Limits`]=Result;
            await Reset();
            await Page.evaluate(()=>ZoomApp.Renderer.domElement.dispatchEvent(new WheelEvent('wheel',{deltaY:-120,cancelable:true})));
            await Frames();await Page.screenshot({path:`${Destination}/${View}IncrementalZoom.png`});
        }
        Report.Checks.GlErrors=await Page.evaluate(()=>[CliffApp.Renderer.getContext().getError(),GrainApp.Renderer.getContext().getError()]);
        Assert.deepEqual(Report.Checks.GlErrors,[0,0]);Assert.deepEqual(Report.Errors,[]);Report.Passed=true;
    }
    finally {Fs.writeFileSync(`${Destination}/CameraZoom.json`,JSON.stringify(Report,null,2));await Browser.close();}
})().catch(Error=>{console.error(Error);process.exitCode=1;});
