//============================================================================================================================================
//                                                          VERIFYBROWSER.CJS
//============================================================================================================================================
// 📦 Exercises real WebGL raster-probe transport and retains unmodified browser readbacks.

const { chromium: Chromium } = require('playwright');
const File = require('node:fs');
const Path = require('node:path');
const Assert = require('node:assert/strict');
const Crypto = require('node:crypto');
const Output = process.env.PROBE_PROOF_OUTPUT || Path.join(__dirname,'Captures');
File.mkdirSync(Output,{recursive:true});
async function Execute()
{
    let Options = {headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--enable-unsafe-swiftshader']};
    if (process.env.PROBE_LAMBDA_CHROMIUM)
    {
        const Package = require('@sparticuz/chromium').default;
        Options.executablePath = await Package.executablePath();
        Options.args.push(...Package.args);
    }
    const Browser = await Chromium.launch(Options);
    try
    {
        const Page = await Browser.newPage({viewport:{width:1100,height:820}}), Errors=[];
        Page.on('pageerror',Error=>Errors.push(Error.message));
        Page.on('console',Message=>{if(Message.type()==='error')Errors.push(Message.text());});
        await Page.goto(process.env.PROBE_DEMO_URL || 'http://localhost:8000/Frontier/Experimental/RadianceProjection/');
        await Page.waitForFunction(()=>window.RadianceDemo?.Ready,null,{timeout:30000});
        async function Frames()
        {
            await Page.evaluate(()=>new Promise(Resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>Resolve()))));
        }
        async function Slider(Name,Value)
        {
            await Page.locator('#'+Name).evaluate((Input,Amount)=>{Input.value=Amount;Input.dispatchEvent(new Event('input',{bubbles:true}));},String(Value));
        }
        async function Warm(Count=3)
        {
            await Frames();
            const Target=await Page.evaluate(Amount=>RadianceDemo.State.Sweeps+Amount,Count);
            console.log("Warm to sweep",Target);
            await Page.waitForFunction(Goal=>RadianceDemo.State.Sweeps>=Goal,Target,{timeout:150000});
        }
        async function Snapshot(Name)
        {
            console.log("Snapshot",Name || "readback");
            await Frames(); const Pixels=await Page.evaluate(()=>RadianceDemo.ReadPixels());
            Assert.equal(Pixels.Error,0,'WebGL error during readback');
            if(Name) await Page.screenshot({path:Path.join(Output,Name+'.png')});
            return Pixels.Pixels;
        }
        function Difference(Alpha,Beta)
        {
            let Sum=0,Count=0,Maximum=0;
            for(let Index=0;Index<Alpha.length;Index++) if(Index%4!==3)
            {const Delta=Alpha[Index]-Beta[Index];Sum+=Delta*Delta;Maximum=Math.max(Maximum,Math.abs(Delta));++Count;}
            return {rms:Math.sqrt(Sum/Count),maximum:Maximum};
        }
        await Page.click('#Motion'); await Slider('Budget',12); await Warm(3);
        await Page.click('#Freeze');
        const Final=await Snapshot('FinalLighting');
        const Cursor=await Page.evaluate(()=>RadianceDemo.State.Cursor);
        await Frames(); Assert.equal(await Page.evaluate(()=>RadianceDemo.State.Cursor),Cursor,'Frozen cache advanced');
        await Page.click('#GiToggle'); const Direct=await Snapshot('DirectOnly');
        const Toggle=Difference(Final,Direct); Assert(Toggle.rms>1,'GI toggle had no material effect');
        await Page.click('#GiToggle');
        await Slider('Sun',0); await Page.click('#Freeze'); await Page.click('#ClearCache'); await Warm(3); await Page.click('#Freeze');
        const Emissive=await Snapshot('EmitterOnly');
        await Page.click('#GiToggle'); const Black=await Snapshot('EmitterGiOff');
        let ReceiverSum=0,ReceiverCount=0;
        for(let Index=0;Index<Black.length;Index+=4) if(Black[Index]+Black[Index+1]+Black[Index+2]===0)
        {ReceiverSum+=Emissive[Index]+Emissive[Index+1]+Emissive[Index+2];ReceiverCount+=3;}
        Assert(ReceiverCount>1000&&ReceiverSum/ReceiverCount>3,'No captured emissive lighting on non-emissive receivers');
        await Page.click('#GiToggle');
        await Slider('Position',1.3); const Stale=await Snapshot('MovedFrozen');
        await Page.click('#Freeze'); await Warm(3); await Page.click('#Freeze');
        const Fresh=await Snapshot('MovedUpdated'), Motion=Difference(Stale,Fresh);
        Assert(Motion.rms>.2,'Moved geometry failed to change refreshed indirect lighting');
        const ShapeBefore=await Page.evaluate(()=>RadianceDemo.GeometryDigest()); await Slider('Amplitude',.78);
        const ShapeAfter=await Page.evaluate(()=>RadianceDemo.GeometryDigest());
        Assert(ShapeBefore.some((Value,Index)=>Math.abs(Value-ShapeAfter[Index])>.01),'Actual vertex positions did not deform');
        await Page.selectOption('#CaptureMode','1'); await Snapshot('DepthCapture');
        await Page.selectOption('#CaptureMode','2'); await Snapshot('IrradianceAtlas');
        await Slider('Emission',0); await Page.click('#Freeze'); await Page.click('#ClearCache'); await Warm(2); await Page.click('#Freeze');
        const Dark=await Snapshot('NoLight');
        await Page.click('#GiToggle'); const DarkDirect=await Snapshot();
        const NoLight=Difference(Dark,DarkDirect); Assert.equal(NoLight.maximum,0,'Unlit scene contains artificial GI');
        await Page.setViewportSize({width:390,height:844}); await Frames();
        Assert.equal(await Page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'Mobile horizontal overflow');
        await Page.screenshot({path:Path.join(Output,'Mobile.png')});
        Assert.deepEqual(Errors,[],'Browser or shader errors');
        const SourceRoot=Path.resolve(__dirname,'../../Frontier/Experimental/RadianceProjection');
        const SourceHashes=Object.fromEntries(['index.html','ProbeIntegrator.js'].map(Name=>[Name,Crypto.createHash('sha256').update(File.readFileSync(Path.join(SourceRoot,Name))).digest('hex')]));
        const Report={date:'2026-10-04',sourceSha256:SourceHashes,method:'Actual WebGL 2 shader execution and framebuffer readback. No replacement lighting equations.',
            giToggle:Toggle,emitterOnlyReceiverMean:ReceiverSum/ReceiverCount,receiverChannels:ReceiverCount,
            refreshedMotion:Motion,unlitGiDifference:NoLight,deformedVertices:ShapeAfter.length/3,
            frozenCachePassed:true,mobileOverflow:false,errors:Errors,
            limitation:'Software-browser execution verifies behavior, not target-GPU performance or native renderer parity.'};
        File.writeFileSync(Path.join(Output,'Execution.json'),JSON.stringify(Report,null,2)+'\n');
        console.log(JSON.stringify(Report,null,2));
    }
    finally {await Browser.close();}
}
Execute().catch(Error=>{console.error(Error);process.exitCode=1;});
