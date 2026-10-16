// Optional real WebGPU check. Requires Playwright + a Chromium with WebGPU support.
// PLAYWRIGHT_MODULE may point to an external playwright/index.mjs; CHROMIUM_EXECUTABLE_PATH is optional.
// EVIDENCE_DIR writes screenshots outside the source tree. The static exchange must already be running.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const Browser = await chromium.launch({headless:true,
    executablePath:process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
    args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-webgpu','--enable-unsafe-swiftshader',
          '--use-gl=angle','--use-angle=swiftshader','--disable-vulkan-surface']});
const Page = await Browser.newPage({viewport:{width:1440,height:900}});
const Errors=[];
Page.on('pageerror',E=>Errors.push(E.message));
Page.on('console',M=>{if(M.type()==='error') Errors.push(M.text());});
// Use explicit argument ordering below: Playwright waitForFunction(fn, arg, options).
const NextFrames=async()=>{
    const Prior=await Page.evaluate(()=>IlluminationExhibit.FrameIndex);
    await Page.waitForFunction(P=>IlluminationExhibit.FrameIndex>P+1,Prior,{timeout:120000});
};
const Shot=async Name=>{
    if(!process.env.EVIDENCE_DIR)return;
    await mkdir(process.env.EVIDENCE_DIR,{recursive:true});
    await NextFrames();
    const Target=await Page.evaluate(()=>IlluminationExhibit.FrameIndex-1);
    await Page.waitForFunction(F=>IlluminationExhibit.CapturedFrame>=F,Target,{timeout:120000});
    await Page.screenshot({path:`${process.env.EVIDENCE_DIR}/${Name}.png`});
};
try {
    await Page.goto((process.env.EXHIBIT_URL || 'http://localhost:8080/')+'?quality=low&plume=0&scale=0.6&capture=1&camera=driver');
    await Page.waitForFunction(()=>window.IlluminationExhibit?.Ready || !document.querySelector('#failure').classList.contains('hidden'),null,{timeout:120000});
    assert.equal(await Page.evaluate(()=>!!window.IlluminationExhibit?.Ready),true,await Page.locator('#failure').innerText());
    await NextFrames();
    // All debug presets, keyboard and free/chase controls are routed through the same mode setter.
    for(const Mode of ['passenger','centre','driver']) {
        await Page.selectOption('#interior-camera',Mode);
        assert.equal(await Page.evaluate(()=>IlluminationExhibit.CameraMode),Mode);
    }
    await Page.keyboard.press('c');
    assert.equal(await Page.evaluate(()=>IlluminationExhibit.CameraMode),'chase');
    await Page.keyboard.press('c');
    assert.equal(await Page.evaluate(()=>IlluminationExhibit.CameraMode),'driver');
    await Page.click('#camera-mode button[data-mode="free"]');
    assert.equal(await Page.evaluate(()=>IlluminationExhibit.FreeCamera),true);
    await Page.selectOption('#interior-camera','driver');
    // Hide only diagnostics (not the docks), then project an actual launcher hit into the browser viewport.
    await Page.evaluate(()=>{const H=IlluminationExhibit; H.Settings.HudEnabled=false;H.Settings.InsetEnabled=false;H.Panel.ProjectOverlays();});
    await NextFrames();
    const Click=await Page.evaluate(async()=>{
        const H=IlluminationExhibit;
        const {TransformPoint,MultiplyTransform}=await import('/Source/TransformProjection.js');
        const R=H.Cabin.Screen.Regions.find(R=>R.Identifier==='app:tyres');
        const X=((R.Left+R.Width/2)/1200-.5)*.30;
        const Y=(.5-(R.Top+R.Height/2)/750)*.1875;
        const NDC=TransformPoint(MultiplyTransform(H.PreviousUnjittered,H.Cabin.TabletPose),[X,Y,.014]);
        const Rect=H.Canvas.getBoundingClientRect();
        return {x:Rect.left+(NDC[0]+1)*.5*Rect.width,y:Rect.top+(1-NDC[1])*.5*Rect.height};
    });
    await Page.mouse.click(Click.x,Click.y);
    assert.equal(await Page.evaluate(()=>IlluminationExhibit.Cabin.Screen.Application),'tyres','3D tablet ray must activate the tyre app');
    await Shot('cockpit');
    // Pressure burst must retain the rubber mesh; only shredding changes the facet set to a rim.
    const Failure=await Page.evaluate(()=>{
        const H=IlluminationExhibit,V=H.Vehicle,I=H.Scene.VehicleOccupants.Wheels[0];
        const Before=H.Scene.Occupants[I].FacetSet;
        V.PunctureTyre(0,true); H.ResolveVehicleEvents(V.ResolveEvents());
        for(let I=0;I<300;I++)V.Advance({Throttle:0,Brake:0,Steer:0,Handbrake:false},1/60);
        H.AdvanceCarcass(1/60);
        return {meshRetained:Before===H.Scene.Occupants[I].FacetSet,pressure:V.Thermals[0].GaugePressure,
            deflection:V.Wheels[0].TyreDeflection,encodedBytes:H.Carcass.EncodeRecords().byteLength};
    });
    assert.equal(Failure.meshRetained,true);
    assert.ok(Failure.pressure<100&&Failure.deflection>.07);
    assert.equal(Failure.encodedBytes,1728);
    // Exercise the oriented scrape spawner through real device writes, not just vector unit tests.
    await Page.evaluate(async()=>{
        const {ProjectSparkEmitter}=await import('/Source/SparkProjection.js');
        IlluminationExhibit.Embers.Emit([ProjectSparkEmitter({Point:[0,0,.05],Velocity:[-30,0,0],Normal:[0,0,1],Strength:1})],1/30);
    });
    if(process.env.EVIDENCE_DIR) {
        const FrameTyre=async()=>{
            await Page.evaluate(async()=>{
                const H=IlluminationExhibit;
                const {TransformPoint}=await import('/Source/TransformProjection.js');
                H.AssignCameraMode('free');
                H.Settings.PlumeEnabled=false; H.PriorValid=false;
                const P=TransformPoint(H.Vehicle.QueryWheelTransform(0),[0,0,0]);
                H.Flight.AssignFromChase([P[0]+.25,P[1]+1.6,P[2]+.13],[P[0],P[1],P[2]-.03]);
                H.Flight.FieldOfView=48;
            });
        };
        await FrameTyre(); await Shot('tyre-flat');
        await Page.evaluate(()=>{
            const V=IlluminationExhibit.Vehicle;V.InflateTyres(220000,220000);
            for(let I=0;I<240;I++)V.Advance({Throttle:0,Brake:0,Steer:0,Handbrake:false},1/60);
        });
        await FrameTyre(); await Shot('tyre-inflated');
    }
    const Result=await Page.evaluate(()=>({frames:IlluminationExhibit.FrameIndex,
        validationErrors:IlluminationExhibit.Exchange.ReportedErrors,
        cluster:{speed:IlluminationExhibit.Cabin.Cluster.Speed,gear:IlluminationExhibit.Cabin.Cluster.Gear,
            demonstration:IlluminationExhibit.Cabin.Cluster.Demonstration},
        glassTriangles:IlluminationExhibit.Cabin.GlassCount/3}));
    assert.deepEqual(Result.validationErrors,[]);
    assert.deepEqual(Errors,[]);
    assert.equal(Result.cluster.demonstration,false);
    assert.ok(Result.glassTriangles>0);
    console.log(JSON.stringify({pass:true,...Result,blowout:Failure},null,2));
} finally { await Browser.close(); }
