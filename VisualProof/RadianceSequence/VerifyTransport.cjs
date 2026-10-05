//============================================================================================================================================
//                                                            VERIFYTRANSPORT.CJS
//============================================================================================================================================
// 📦 Real WebGL 2 radiance-cascade readbacks, independent triangle reference, merge equations and changing-scene proofs.

const Assert=require('node:assert/strict');
const Fs=require('node:fs');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const Chromium=require('@sparticuz/chromium');
const Destination=process.argv[2]||'_AgentScratch/RadianceFinal';
Fs.mkdirSync(Destination,{recursive:true});
const Report={Date:'2026-10-05',Errors:[],Checks:{},Captures:[],SourceHashes:{}};
for (const File of Fs.readdirSync('Frontier/Experimental/RadianceSequence'))
    Report.SourceHashes[File]=createHash('sha256').update(Fs.readFileSync(`Frontier/Experimental/RadianceSequence/${File}`)).digest('hex');
(async()=>
{
    const Browser=await chromium.launch({headless:true,executablePath:process.env.PREVIEW_CHROMIUM||await Chromium.executablePath(),
        args:[...Chromium.args,'--enable-webgl'],env:{...process.env,LD_LIBRARY_PATH:process.env.PREVIEW_LIBRARIES||'/tmp/lib'}});
    Report.BrowserVersion=Browser.version();
    try
    {
        const Page=await Browser.newPage({viewport:{width:1536,height:1000},deviceScaleFactor:1});
        Page.on('pageerror',Error=>Report.Errors.push(Error.message));
        Page.on('console',Message=>{if (Message.type()==='error') Report.Errors.push(Message.text());});
        const Ready=async()=>
        {
            await Page.waitForFunction(()=>window.RadianceApp && (RadianceApp.Context.Ready||RadianceApp.Context.Error),{},{timeout:180000});
            Assert.equal(await Page.evaluate(()=>RadianceApp.Context.Error),null);
        };
        const Capture=async Name=>
        {
            await Page.evaluate(()=>new Promise(Resolve=>requestAnimationFrame(()=>requestAnimationFrame(Resolve))));
            await Page.screenshot({path:`${Destination}/${Name}.png`});
            Report.Captures.push(Name);
        };
        await Page.goto(process.env.RADIANCE_URL||'http://127.0.0.1:8080/Frontier/Experimental/RadianceSequence/index.html');
        await Ready();
        await Capture('01FullGI');
        Report.Checks.Transport=await Page.evaluate(()=>
        {
            const Application=RadianceApp, Transport=Application.Transport;
            const Bounds=Target=>
            {
                const Pixels=Transport.ReadTarget(Target), Minimum=[Infinity,Infinity,Infinity,Infinity],Maximum=[-Infinity,-Infinity,-Infinity,-Infinity];
                for (let Index=0;Index<Pixels.length;++Index)
                {
                    if (!Number.isFinite(Pixels[Index])) throw new Error('Non-finite transport texel');
                    Minimum[Index%4]=Math.min(Minimum[Index%4],Pixels[Index]);
                    Maximum[Index%4]=Math.max(Maximum[Index%4],Pixels[Index]);
                }
                if (Math.min(...Minimum)<-1e-5 || Maximum[3]>1.00002) throw new Error('Radiance or transmittance outside physical bounds');
                if (Math.max(...Maximum.slice(0,3))>Application.Settings.Power+.001) throw new Error('Passive transport gained energy');
                return {Minimum,Maximum};
            };
            window.ReferenceLighting=Array.from(Transport.ReadTarget(Transport.FullLighting));
            window.ReferenceGeometry=Array.from(Application.Surface.geometry.attributes.position.array);
            const Direct=Transport.ReadTarget(Transport.DirectLighting);
            let Bounce=0,DirectSum=0,MinimumDifference=Infinity;
            ReferenceLighting.forEach((Component,Index)=>
            {
                if (Index%4===3) return;
                Bounce+=Component-Direct[Index];DirectSum+=Direct[Index];MinimumDifference=Math.min(MinimumDifference,Component-Direct[Index]);
            });
            if (Bounce<10 || MinimumDifference<-.001) throw new Error('Diffuse transport is absent or violates monotonicity');
            const Uploaded=Transport.Textures[0].image.data;
            const Visible=Application.Surface.geometry.attributes.position.array;
            for (let Index=0;Index<Visible.length;++Index)
                if (Visible[Index]!==Uploaded[Math.floor(Index/3)*4+Index%3]) throw new Error('Raster and traced triangles differ');
            const Extension=Application.Renderer.getContext().getExtension('WEBGL_debug_renderer_info');
            return {Cascades:Transport.Cascades.map(Cascade=>({Level:Cascade.Level,Dimensions:Cascade.Dimensions,
                AngularSpan:Cascade.AngularSpan,Samples:Cascade.Samples,Interval:[Cascade.Start,Cascade.End],
                Local:Bounds(Cascade.Intervals),Merged:Bounds(Cascade.Merged)})),Diffuse:Bounds(Transport.Irradiance[0]),
                Direct:Bounds(Transport.DirectLighting),Full:Bounds(Transport.FullLighting),BounceSum:Bounce,DirectSum,MinimumDifference,
                RasterEqualsTracedTriangles:true,Executed:Transport.Executed,Milliseconds:Transport.Milliseconds,
                Renderer:Extension?Application.Renderer.getContext().getParameter(Extension.UNMASKED_RENDERER_WEBGL):'unavailable'};
        });
        await Page.click('#Direct');await Capture('02DirectOnly');
        await Page.click('#Difference');await Capture('03BounceOnly');
        await Page.click('#Full');
        await Page.click('[data-cascade="2"]');
        await Page.check('#ShowSamples');await Capture('04CascadeTwo');
        await Page.selectOption('#DirectionMode','Visibility');await Capture('05IntervalVisibility');
        Report.Checks.CameraIndependent=await Page.evaluate(()=>
        {
            const Application=RadianceApp;
            Application.Camera.position.set(-13,8,-15);
            Application.Controls.target.set(0,2,0);Application.Controls.update();
            const After=Application.Transport.ReadTarget(Application.Transport.FullLighting);
            return After.every((Component,Index)=>Component===ReferenceLighting[Index]);
        });
        Assert(Report.Checks.CameraIndependent);
        await Capture('06RearView');
        await Page.evaluate(()=>{RadianceApp.FrameView();RadianceApp.Settings.EmitterX=2.6;RadianceApp.Recalculate();});
        await Ready();await Capture('07MovedEmitter');
        Report.Checks.EmitterChange=await Page.evaluate(()=>
        {
            const Pixels=RadianceApp.Transport.ReadTarget(RadianceApp.Transport.FullLighting);
            return Pixels.reduce((Sum,Component,Index)=>Sum+Math.abs(Component-ReferenceLighting[Index]),0);
        });
        Assert(Report.Checks.EmitterChange>30);
        await Page.evaluate(()=>{RadianceApp.Settings.Shear=-.9;RadianceApp.Recalculate();});
        await Ready();await Capture('08DeformedOccluder');
        Report.Checks.Deformation=await Page.evaluate(()=>
        {
            const Application=RadianceApp;
            return {Changed:Application.Surface.geometry.attributes.position.array.reduce((Sum,Component,Index)=>Sum+Math.abs(Component-ReferenceGeometry[Index]),0),
                Completed:Application.Transport.Completed,Revision:Application.Transport.Revision};
        });
        Assert(Report.Checks.Deformation.Changed>10);
        Assert.equal(Report.Checks.Deformation.Completed,Report.Checks.Deformation.Revision);
        await Page.evaluate(()=>{RadianceApp.Settings.Iterations=1;RadianceApp.Recalculate();});
        await Ready();
        Report.Checks.Reference=await Page.evaluate(()=>
        {
            const Application=RadianceApp,Transport=Application.Transport,Geometry=Application.Context.Geometry;
            const Add=(First,Second)=>First.map((Component,Axis)=>Component+Second[Axis]);
            const Subtract=(First,Second)=>First.map((Component,Axis)=>Component-Second[Axis]);
            const Scale=(Vector,Amount)=>Vector.map(Component=>Component*Amount);
            const Dot=(First,Second)=>First.reduce((Sum,Component,Axis)=>Sum+Component*Second[Axis],0);
            const Cross=(First,Second)=>[First[1]*Second[2]-First[2]*Second[1],First[2]*Second[0]-First[0]*Second[2],First[0]*Second[1]-First[1]*Second[0]];
            const Corners=Triangle=>Triangle.map(Point=>Point.map(Math.fround));
            const Triangles=Geometry.Triangles.map(Corners);
            const Inside=Position=>Geometry.Solids.some(Solid=>
            {
                if (Position.some((Coordinate,Axis)=>Coordinate<Solid.Minimum[Axis] || Coordinate>Solid.Maximum[Axis])) return false;
                return Triangles.slice(Solid.FirstTriangle,Solid.FirstTriangle+Solid.TriangleCount).every(([First,Second,Third])=>
                    Dot(Cross(Subtract(Second,First),Subtract(Third,First)),Subtract(Position,First))<=0);
            });
            const Trace=(Origin,Direction,End)=>
            {
                if (Inside(Origin)) return [0,0,0,0];
                let Closest=End,Intersection=-1;
                for (let Index=0;Index<Triangles.length;++Index)
                {
                    const [First,Second,Third]=Triangles[Index],Along=Subtract(Second,First),Across=Subtract(Third,First);
                    const Perpendicular=Cross(Direction,Across),Determinant=Dot(Along,Perpendicular);
                    if (Math.abs(Determinant)<1e-8) continue;
                    const Offset=Subtract(Origin,First),AlongFraction=Dot(Offset,Perpendicular)/Determinant;
                    if (AlongFraction<-.000001 || AlongFraction>1.000001) continue;
                    const Other=Cross(Offset,Along),AcrossFraction=Dot(Direction,Other)/Determinant;
                    if (AcrossFraction<-.000001 || AlongFraction+AcrossFraction>1.000001) continue;
                    const Distance=Dot(Across,Other)/Determinant;
                    if (Distance<.0001 || Distance>=Closest) continue;
                    Closest=Distance;Intersection=Index;
                }
                return Intersection<0?[0,0,0,1]:[...Geometry.Solids.find(Solid=>Intersection>=Solid.FirstTriangle&&Intersection<Solid.FirstTriangle+Solid.TriangleCount).Emission,0];
            };
            const Direction=(Face,Horizontal,Vertical,Span)=>
            {
                const Along=(Horizontal+.5)/Span*2-1,Across=(Vertical+.5)/Span*2-1;
                const Vector=[[1,-Across,-Along],[-1,-Across,Along],[Along,1,Across],[Along,-1,-Across],[Along,-Across,1],[-Along,-Across,-1]][Face];
                return Scale(Vector,1/Math.hypot(...Vector));
            };
            const Primitive=(Horizontal,Vertical)=>Math.atan(Horizontal*Vertical/Math.sqrt(1+Horizontal**2+Vertical**2));
            const Angle=(Horizontal,Vertical,Span)=>
            {
                const Left=Horizontal/Span*2-1,Right=(Horizontal+1)/Span*2-1,Bottom=Vertical/Span*2-1,Top=(Vertical+1)/Span*2-1;
                return Primitive(Right,Top)-Primitive(Left,Top)-Primitive(Right,Bottom)+Primitive(Left,Bottom);
            };
            const Local=Transport.Cascades.map(Cascade=>Transport.ReadTarget(Cascade.Intervals));
            const Merged=Transport.Cascades.map(Cascade=>Transport.ReadTarget(Cascade.Merged));
            let TraceError=0,MergeError=0,Traced=0,MergedCount=0,OpaqueCount=0;
            const Mismatches=[];
            Transport.Cascades.forEach((Cascade,Level)=>
            {
                const Span=Cascade.AngularSpan, Dimensions=Cascade.Dimensions;
                for (let Sample=0;Sample<1024;++Sample)
                {
                    const Index=(Sample*137+71)%Cascade.Samples,Pixel=[Index%Cascade.Width,Math.floor(Index/Cascade.Width)];
                    const Horizontal=Math.floor(Pixel[0]/Span),Vertical=Math.floor(Pixel[1]/Span);
                    const Coordinate=[Horizontal%Dimensions[0],Math.floor(Vertical/6),Math.floor(Horizontal/Dimensions[0])];
                    const Face=Vertical%6,Angular=[Pixel[0]%Span,Pixel[1]%Span];
                    const Ray=Direction(Face,...Angular,Span);
                    const Position=Coordinate.map((Component,Axis)=>[-6,0,-6][Axis]+(Component+.5)/Dimensions[Axis]*[12,6,12][Axis]);
                    const Expected=Trace(Add(Position,Scale(Ray,Cascade.Start)),Ray,Cascade.End-Cascade.Start);
                    const Actual=Array.from(Local[Level].slice(Index*4,Index*4+4));
                    Expected.forEach((Component,Channel)=>{TraceError=Math.max(TraceError,Math.abs(Component-Actual[Channel]));});
                    if (Expected.some((Component,Channel)=>Math.abs(Component-Actual[Channel])>.001)) Mismatches.push({Level,Index,Position,Ray,Expected,Actual,Start:Cascade.Start,End:Cascade.End});
                    ++Traced;
                    let Far=[0,0,0,1];
                    if (Level<3)
                    {
                        Far=[0,0,0,0];
                        const Next=Transport.Cascades[Level+1];
                        const Lattice=Coordinate.map((Component,Axis)=>(Component+.5)/Dimensions[Axis]*Next.Dimensions[Axis]-.5);
                        const Lower=Lattice.map(Math.floor),Fraction=Lattice.map((Component,Axis)=>Component-Lower[Axis]);
                        let Total=0;
                        for (let DirectionIndex=0;DirectionIndex<4;++DirectionIndex)
                        {
                            const Fine=[Angular[0]*2+(DirectionIndex&1),Angular[1]*2+(DirectionIndex>>1)];
                            const Weight=Angle(...Fine,Span*2);Total+=Weight;
                            for (let Corner=0;Corner<8;++Corner)
                            {
                                const Shift=[Corner&1,(Corner>>1)&1,(Corner>>2)&1];
                                const Location=Lower.map((Component,Axis)=>Math.max(0,Math.min(Next.Dimensions[Axis]-1,Component+Shift[Axis])));
                                const Spatial=Shift.reduce((Product,Component,Axis)=>Product*(Component?Fraction[Axis]:1-Fraction[Axis]),1);
                                const Address=((Location[1]*6+Face)*Next.AngularSpan+Fine[1])*Next.Width+
                                    (Location[0]+Next.Dimensions[0]*Location[2])*Next.AngularSpan+Fine[0];
                                Far=Far.map((Component,Channel)=>Component+Merged[Level+1][Address*4+Channel]*Weight*Spatial);
                            }
                        }
                        Far=Far.map(Component=>Component/Total);
                    }
                    const ExpectedMerged=Actual.map((Component,Channel)=>Channel===3?Component*Far[3]:Component+Actual[3]*Far[Channel]);
                    ExpectedMerged.forEach((Component,Channel)=>{MergeError=Math.max(MergeError,Math.abs(Component-Merged[Level][Index*4+Channel]));});
                    if (!Actual[3]) ++OpaqueCount;
                    ++MergedCount;
                }
            });
            return {TraceError,MergeError,Traced,MergedCount,OpaqueCount,Mismatches};
        });
        Assert(Report.Checks.Reference.TraceError<.001,JSON.stringify(Report.Checks.Reference));
        Assert(Report.Checks.Reference.MergeError<.001,JSON.stringify(Report.Checks.Reference));
        Report.Checks.AngularQuadrature=await Page.evaluate(()=>
        {
            const Transport=RadianceApp.Transport, Material=Transport.Integrate;
            const Original=Material.fragmentShader;
            const Start=Original.indexOf('void main()');
            const Results=[];
            for (const Span of [4,8,16,32])
            {
                Material.fragmentShader=Original.slice(0,Start)+`void main(){ivec2 Pixel=ivec2(gl_FragCoord.xy);int Index=Pixel.x+Pixel.y*256;Radiance=vec4(SolidAngle(ivec2(Index%${Span},(Index/${Span})%${Span}),${Span}),0.0,0.0,1.0);}`;
                Material.needsUpdate=true;
                Transport.RenderInto(Material,Transport.Irradiance[1]);
                const Pixels=Transport.ReadTarget(Transport.Irradiance[1]);
                let Sum=0,Minimum=Infinity;
                for (let Index=0;Index<Span*Span;++Index) {Sum+=Pixels[Index*4];Minimum=Math.min(Minimum,Pixels[Index*4]);}
                Results.push({Span,Minimum,FullSphere:Sum*6,Error:Math.abs(Sum*6-4*Math.PI)});
            }
            Material.fragmentShader=Original;Material.needsUpdate=true;
            return Results;
        });
        Assert(Report.Checks.AngularQuadrature.every(Result=>Result.Minimum>0&&Result.Error<.0001));
        await Page.evaluate(()=>{RadianceApp.Settings.Power=0;RadianceApp.Settings.Iterations=4;RadianceApp.Recalculate();});
        await Ready();await Capture('09EmissionOff');
        Report.Checks.ZeroEmission=await Page.evaluate(()=>
        {
            const Pixels=RadianceApp.Transport.ReadTarget(RadianceApp.Transport.FullLighting);
            return Pixels.every((Component,Index)=>Index%4===3||Component===0);
        });
        Assert(Report.Checks.ZeroEmission);
        await Page.click('#Reset');await Ready();
        await Page.setViewportSize({width:390,height:844});
        await Capture('10Mobile');
        Assert(await Page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        Report.Checks.MobileNoOverflow=true;
        Report.Checks.GlError=await Page.evaluate(()=>RadianceApp.Renderer.getContext().getError());
        Assert.equal(Report.Checks.GlError,0);
        Assert.deepEqual(Report.Errors,[]);
        Report.Passed=true;
    }
    finally
    {
        Fs.writeFileSync(`${Destination}/Transport.json`,JSON.stringify(Report,null,2));
        await Browser.close();
    }
})().catch(Error=>{console.error(Error);process.exitCode=1;});
