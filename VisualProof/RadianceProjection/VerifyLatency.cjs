//============================================================================================================================================
//                                                           VERIFYLATENCY.CJS
//============================================================================================================================================
// 📦 Measures actual raster refresh ordering, stationary cache reuse and edit bursts at equal probe budgets.

const {chromium:Chromium}=require('playwright');
const File=require('node:fs'),Path=require('node:path'),Assert=require('node:assert/strict'),Crypto=require('node:crypto');
const Output=Path.join(__dirname,'LatencyCaptures');File.mkdirSync(Output,{recursive:true});
async function Execute()
{
    const Options={headless:true,args:['--enable-webgl','--enable-unsafe-swiftshader']};
    if(process.env.PROBE_LAMBDA_CHROMIUM)
    {
        const Package=require('@sparticuz/chromium').default;
        Options.executablePath=await Package.executablePath();Options.args=[...Package.args,...Options.args];
    }
    const Browser=await Chromium.launch(Options);
    try
    {
        const Page=await Browser.newPage({viewport:{width:1100,height:820}}),Errors=[];
        Page.on('pageerror',Error=>Errors.push(Error.message));
        Page.on('console',Message=>{if(Message.type()==='error')Errors.push(Message.text());});
        await Page.goto(process.env.PROBE_DEMO_URL||'http://localhost:8000/');
        await Page.waitForFunction(()=>window.RadianceDemo?.Ready);
        await Page.click('#Motion');await Page.uncheck('#Burst');
        async function Frames(Count=2)
        {
            await Page.evaluate(Amount=>new Promise(Resolve=>
            {function Next(){if(--Amount<=0)Resolve();else requestAnimationFrame(Next);}requestAnimationFrame(Next);}),Count);
        }
        async function Slider(Name,Amount)
        {
            await Page.locator('#'+Name).evaluate((Input,Value)=>{Input.value=Value;Input.dispatchEvent(new Event('input',{bubbles:true}));},String(Amount));
        }
        async function Idle()
        {
            await Frames();await Page.waitForFunction(()=>RadianceDemo.State.Pending===0,null,{timeout:180000});await Frames();
        }
        async function Pixels()
        {
            await Frames();const Result=await Page.evaluate(()=>RadianceDemo.ReadPixels());Assert.equal(Result.Error,0);return Result.Pixels;
        }
        function Difference(Alpha,Beta)
        {
            let Sum=0,Count=0,Maximum=0;
            for(let Index=0;Index<Alpha.length;++Index)if(Index%4!==3)
            {const Delta=Alpha[Index]-Beta[Index];Sum+=Delta*Delta;++Count;Maximum=Math.max(Maximum,Math.abs(Delta));}
            return {rms:Math.sqrt(Sum/Count),maximum:Maximum};
        }
        console.log('Wait for static cache');await Idle();
        const Held=await Pixels();const IdleFrame=await Page.evaluate(()=>RadianceDemo.State);
        Assert.equal(IdleFrame.Updated.length,0);Assert.equal(IdleFrame.ShadowDrawn,false);
        await Page.screenshot({path:Path.join(Output,'StaticCache.png')});
        await Page.evaluate(()=>RadianceDemo.RequestRefresh(4));await Idle();
        const AdditionalSettling=Difference(Held,await Pixels());
        console.log('Static extra settling',AdditionalSettling);
        Assert(AdditionalSettling.rms<1,'Four settling passes leave excessive static error');
        async function Profile(Mode)
        {
            await Page.selectOption('#ScheduleMode',Mode);await Slider('Position',0);await Idle();
            const Before=await Page.evaluate(()=>RadianceDemo.State.Frame);
            const Start=await Page.locator('#Position').evaluate(Input=>
            {
                const Frame=RadianceDemo.State.Frame;
                Input.value='1.3';Input.dispatchEvent(new Event('input',{bubbles:true}));
                return {Frame,Revision:RadianceDemo.QueryScheduling().Revision};
            });
            await Frames(1);
            const Weights=await Page.evaluate(()=>RadianceDemo.State.Weights);
            const Hot=Weights.map((Weight,Index)=>({Weight,Index})).sort((Alpha,Beta)=>Beta.Weight-Alpha.Weight||Alpha.Index-Beta.Index).slice(0,8).map(Entry=>Entry.Index);
            await Page.waitForFunction(({Hot,Revision})=>Hot.every(Index=>RadianceDemo.QueryScheduling().Records[Index].Revision>=Revision),
                {Hot,Revision:Start.Revision},{timeout:180000});
            const History=await Page.evaluate(()=>RadianceDemo.History);
            const Arrivals=Hot.map(Index=>
            {
                const Entry=History.find(Entry=>Entry.Frame>Start.Frame&&Entry.Revision>=Start.Revision&&Entry.Updated.includes(Index));
                Assert(Entry,'Missing actual capture for important probe '+Index);return Entry.Frame-Start.Frame;
            });
            const Captures=History.filter(Entry=>Entry.Frame>Start.Frame);
            Assert(Captures.every(Entry=>Entry.Updated.length<=4),'Equal-budget comparison exceeded four probes');
            const Result={Mode,Hot,Arrivals,first:Math.min(...Arrivals),last:Math.max(...Arrivals),mean:Arrivals.reduce((Sum,Number)=>Sum+Number,0)/Arrivals.length};
            console.log('Response',Result);await Idle();
            await Page.screenshot({path:Path.join(Output,Mode==='priority'?'PriorityUpdated.png':'RoundRobinUpdated.png')});
            return Result;
        }
        const Priority=await Profile('priority'),Baseline=await Profile('round');
        Assert.deepEqual(Priority.Hot,Baseline.Hot,'A/B comparison used different important probes');
        Assert(Priority.last<Baseline.last,'Prioritization did not improve important-probe response');
        await Page.selectOption('#ScheduleMode','priority');await Idle();
        // Camera movement alone must not invalidate world-space lighting or lose off-screen contributors.
        const Revision=await Page.evaluate(()=>RadianceDemo.QueryScheduling().Revision);
        await Page.click('[data-select=emitter]');await Frames(3);
        Assert.equal(await Page.evaluate(()=>RadianceDemo.QueryScheduling().Revision),Revision);
        Assert.equal(await Page.evaluate(()=>RadianceDemo.State.Updated.length),0);
        await Page.click('#ResetView');await Frames(3);
        // A newly selected distant inspector probe still updates when the entire field is idle.
        await Page.selectOption('#InspectProbe','47');
        await Page.waitForFunction(()=>RadianceDemo.State.Updated.includes(47),null,{timeout:30000});await Idle();
        await Page.check('#Burst');await Slider('Position',-.9);await Frames(1);
        const Burst=await Page.evaluate(()=>RadianceDemo.History.slice(-4));
        Assert(Burst.some(Entry=>Entry.Updated.length===12),'Edit burst failed to use its explicit extra budget');
        Assert(Burst.every(Entry=>Entry.Updated.length<=12),'Edit burst exceeded the cap');await Idle();
        await Page.click('#Freeze');const FrozenCursor=await Page.evaluate(()=>RadianceDemo.State.Cursor);
        await Slider('Position',.6);await Frames(3);Assert.equal(await Page.evaluate(()=>RadianceDemo.State.Cursor),FrozenCursor);
        await Page.click('#Freeze');await Idle();
        await Page.click('#GiToggle');const Direct=await Pixels();await Page.click('#GiToggle');const Lit=await Pixels();
        const GiToggle=Difference(Lit,Direct);Assert(GiToggle.rms>1,'Optimization disabled GI');
        await Page.uncheck('#RibbonVisible');await Page.click('#Motion');await Idle();
        Assert.equal(await Page.evaluate(()=>RadianceDemo.State.Updated.length),0,'Invisible animation invalidated lighting');
        await Page.setViewportSize({width:390,height:844});await Frames();
        Assert.equal(await Page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        Assert.deepEqual(Errors,[]);
        const Root=Path.resolve(__dirname,'../../Frontier/Experimental/RadianceProjection');
        const SourceHashes=Object.fromEntries(['index.html','ProbeIntegrator.js','ProbeScheduler.js'].map(Name=>[Name,
            Crypto.createHash('sha256').update(File.readFileSync(Path.join(Root,Name))).digest('hex')]));
        const Report={date:'2026-10-04',sourceSha256:SourceHashes,Priority,Baseline,IdleFrame:{calls:IdleFrame.Calls,updated:IdleFrame.Updated,shadowDrawn:IdleFrame.ShadowDrawn},
            AdditionalSettling,GiToggle,burstCap:12,baseBudget:4,cameraMovementInvalidates:false,invisibleMotionInvalidates:false,distantInspectorRefresh:true,frozenCursor:true,errors:Errors,
            limitation:'Frame-count response and real WebGL work verified on software graphics; not a GPU-time or complete GI convergence guarantee.'};
        File.writeFileSync(Path.join(Output,'Execution.json'),JSON.stringify(Report,null,2)+'\n');console.log(JSON.stringify(Report,null,2));
    }
    finally{await Browser.close();}
}
Execute().catch(Error=>{console.error(Error);process.exitCode=1;});
