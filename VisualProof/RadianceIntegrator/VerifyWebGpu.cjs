//============================================================================================================================================
//                                                              VERIFYWEBGPU.CJS
//============================================================================================================================================
// 📦 Real WebGPU execution, GPU BVH-versus-brute-force rays, interval algebra, off-screen emission, live controls and captured diagnostic views.

const Assert = require('node:assert/strict'),
    Fs = require('node:fs'),
    {
        createHash
    } = require('node:crypto');
const
{
    chromium
} = require('playwright'), Chromium = require('@sparticuz/chromium');
const Destination = process.argv[2] || '_AgentScratch/TransportProof';
Fs.mkdirSync(Destination,
{
    recursive: true
});
const Reference = JSON.parse(Fs.readFileSync(`${Destination}/RayQueries.json`));
const Report = {
    Date: '2026-10-05',
    Errors: [],
    Checks:
    {},
    Captures: [],
    Timings: [],
    SourceHashes:
    {}
};
for (const Name of Fs.readdirSync('Frontier/Experimental/RadianceIntegrator').filter(Name => /\.(js|css|html)$/.test(
        Name)))
    Report.SourceHashes[Name] = createHash('sha256').update(Fs.readFileSync(
        `Frontier/Experimental/RadianceIntegrator/${Name}`)).digest('hex');
(async () =>
{
    const Browser = await chromium.launch(
    {
        executablePath: process.env.PREVIEW_CHROMIUM || await Chromium.executablePath(),
        args: [...Chromium.args.filter(Arg => !['--in-process-gpu', '--single-process'].includes(Arg)),
            '--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader'
        ],
        env:
        {
            ...process.env,
            LD_LIBRARY_PATH: process.env.PREVIEW_LIBRARIES || '/tmp:/tmp/lib',
            VK_ICD_FILENAMES: '/tmp/vk_swiftshader_icd.json'
        }
    });
    Report.Browser = Browser.version();
    try
    {
        const Page = await Browser.newPage(
        {
            viewport:
            {
                width: 1440,
                height: 1000
            },
            deviceScaleFactor: 1
        });
        Page.setDefaultTimeout(180000);
        Page.on('pageerror', Error => Report.Errors.push(Error.message));
        Page.on('console', Message =>
        {
            if (Message.type() === 'error') Report.Errors.push(Message.text());
        });
        const Url = process.env.TRANSPORT_URL ||
            'http://localhost:8080/Frontier/Experimental/RadianceIntegrator/index.html';
        await Page.goto(`${Url}?manual=1&width=640`);
        await Page.waitForFunction(() => window.TransportApp && (TransportApp.State.Error || TransportApp.State
            .Completed > 0));
        Assert.equal(await Page.evaluate(() => TransportApp.State.Error), null);
        Report.Adapter = await Page.evaluate(() => TransportApp.State.Adapter);
        Report.Software = await Page.evaluate(() => TransportApp.State.Software);
        const Step = async (Time = 0, Settings = {}) =>
        {
            await Page.evaluate(async (
            {
                Time,
                Settings
            }) =>
            {
                if (Object.keys(Settings).length) TransportApp.Configure(Settings);
                await TransportApp.Step(Time);
            },
            {
                Time,
                Settings
            });
            await Page.waitForFunction(() => TransportApp.State.Error || TransportApp.State.Metrics
                ?.Frame === TransportApp.State.Frame - 1);
            Assert.equal(await Page.evaluate(() => TransportApp.State.Error), null);
        };
        const Capture = async Name =>
        {
            await Page.evaluate(() => new Promise(Resolve => requestAnimationFrame(() =>
                requestAnimationFrame(Resolve))));
            await Page.screenshot(
            {
                path: `${Destination}/${Name}.png`
            });
            Report.Captures.push(Name);
        };
        const Measure = async Name => Page.evaluate(async Name =>
        {
            const Raw = await TransportApp.Readback(),
                World = await TransportApp.Readback('Position');
            const Decode = Value =>
            {
                const Sign = Value & 32768 ? -1 : 1,
                    Exponent = Value >> 10 & 31,
                    Fraction = Value & 1023;
                return Sign * (Exponent === 0 ? Fraction * 2 ** -24 : Exponent === 31 ?
                    Infinity : (1 + Fraction / 1024) * 2 ** (Exponent - 15));
            };
            let Sum = 0,
                Maximum = 0,
                Count = 0,
                NonFinite = 0,
                Difference = 0,
                History = 0;
            const Pixels = [];
            for (let Y = 0; Y < Raw.Height; Y++)
                for (let X = 0; X < Raw.Width; X++)
                {
                    const Offset = Y * Raw.Pitch / 2 + X * 4;
                    if (World.Values[Offset + 3] === 0) continue;
                    Count++;
                    History += Decode(Raw.Values[Offset + 3]);
                    for (let Channel = 0; Channel < 3; Channel++)
                    {
                        const Value = Decode(Raw.Values[Offset + Channel]);
                        Pixels.push(Value);
                        if (!Number.isFinite(Value)) NonFinite++;
                        Sum += Value;
                        Maximum = Math.max(Maximum, Value);
                    }
                }
            window.Measurements ??=
            {};
            if (Measurements.Full?.length === Pixels.length) Difference = Pixels.reduce((Sum,
                    Value, I) => Sum + Math.abs(Value - Measurements.Full[I]), 0) / Pixels
                .length;
            Measurements[Name] = Pixels;
            return {
                Mean: Sum / (Count * 3),
                Maximum,
                Count,
                NonFinite,
                Difference,
                History: History / Count
            };
        }, Name);
        await Step(0,
        {
            Animate: false,
            History: 0,
            Counters: true
        });
        await Step();
        Report.Checks.Full = await Measure('Full');
        Assert.equal(Report.Checks.Full.NonFinite, 0);
        Assert(Report.Checks.Full.Count > 10000);
        Report.Checks.MeasuredWork = await Page.evaluate(() => TransportApp.State.Metrics);
        Report.Scene = await Page.evaluate(() => (
        {
            Triangles: TransportApp.State.Triangles,
            Nodes: TransportApp.State.Nodes,
            Levels: TransportApp.State.Levels,
            Memory: TransportApp.State.Memory,
            Width: TransportApp.State.Width,
            Height: TransportApp.State.Height
        }));
        Assert(Report.Scene.Triangles >= 1000);
        Assert((await Page.evaluate(() => TransportApp.State.Metrics.Rays)) > 1000);
        await Capture('01FullLighting');
        for (const Mode of [1, 2, 5, 6, 7, 8])
        {
            await Step(0,
            {
                Debug: Mode,
                Level: Mode === 6 || Mode === 7 ? 2 : 0
            });
            await Capture((
            {
                1: '02DirectOnly',
                2: '03IndirectOnly',
                5: '04ProbeTiles',
                6: '05CascadeRadiance',
                7: '06Transmission',
                8: '07TraversalCost'
            })[Mode]);
            if (Mode === 1)
            {
                Report.Checks.Direct = await Measure('Direct');
                Assert.equal(await Page.evaluate(() => TransportApp.State.TraceSlots), 0);
            }
            if (Mode === 2) Report.Checks.Indirect = await Measure('Indirect');
        }
        Assert(Report.Checks.Full.Mean > Report.Checks.Direct.Mean);
        Assert(Report.Checks.Indirect.Mean > 0.0001);
        await Step(0,
        {
            Debug: 0,
            Level: 0,
            Power: 0,
            Sky: 0
        });
        Report.Checks.Dark = await Measure('Dark');
        Assert.equal(Report.Checks.Dark.Maximum, 0);
        await Capture('08EmittersAndSkyOff');
        await Step(3.4,
        {
            Power: 1,
            Sky: .025,
            Motion: true
        });
        Report.Checks.Moved = await Measure('Moved');
        await Capture('09MovingLightsAndGeometry');
        Assert(Report.Checks.Moved.Mean > 0);
        await Step(0);
        Report.Checks.Replay = await Measure('Replay');
        Assert(Report.Checks.Replay.Difference < 1e-8);
        await Step(0,
        {
            History: .85
        });
        // Setting changes deliberately reset history; unchanged consecutive frames must accept valid history.
        await Step(0);
        await Step(0);
        Report.Checks.History = await Measure('History');
        Assert(Report.Checks.History.History > 0);
        await Step(0,
        {
            Debug: 9
        });
        await Step(0);
        await Capture('10HistoryAcceptance');
        const ShadowUpdates = await Page.evaluate(() => TransportApp.State.ShadowUpdates);
        await Step(0);
        Assert.equal(await Page.evaluate(() => TransportApp.State.ShadowUpdates), ShadowUpdates);
        Report.Checks.UnchangedShadowReuse = true;
        await Step(0,
        {
            Debug: 0,
            History: 0,
            Specular: true
        });
        Report.Checks.Specular = await Measure('Specular');
        Assert.equal(Report.Checks.Specular.NonFinite, 0);
        await Capture('11MirrorRay');
        await Step(0,
        {
            Specular: false
        });
        Report.Checks.Cascades = [];
        for (let Level = 0; Level < 4; ++Level)
        {
            const Values = await Page.evaluate(Level => TransportApp.ReadCascade(Level), Level);
            Assert(Values.every(Number.isFinite));
            let Open = 0,
                Blocked = 0;
            for (let I = 3; I < Values.length; I += 4)
            {
                Assert(Values[I] >= 0 && Values[I] <= 1.000001);
                if (Values[I] === 0) Blocked++;
                if (Values[I] > .99) Open++;
            }
            Assert(Open > 0 && Blocked > 0);
            Report.Checks.Cascades.push(
            {
                Level,
                Slots: Values.length / 4,
                Open,
                Blocked
            });
        }
        Report.Checks.GpuRays = [];
        for (const Pose of Reference.Poses)
        {
            await Step(Pose.Time,
            {
                Motion: true
            });
            const Results = await Page.evaluate(async Queries =>
            {
                const
                {
                    Common
                } = await import('./TransportIntegrator.js');
                const
                {
                    Device,
                    SharedLayout,
                    Shared
                } = TransportApp;
                const Code = Common + `struct Query {Origin:vec4f,Direction:vec4f};
                @group(1) @binding(0) var<storage,read> Queries:array<Query>;
                @group(1) @binding(1) var<storage,read_write> Results:array<vec4f>;
                @compute @workgroup_size(64) fn Verify(@builtin(global_invocation_id) Id:vec3u){
                    if(Id.x>=arrayLength(&Queries)){
                        let I=Id.x-arrayLength(&Queries);if(I>=4u){return;}
                        let Far=vec4f(.8,.6,.2,.5);var Near=vec4f(.2,.3,.4,0);
                        if(I==1u){Near=vec4f(0,0,0,1);}if(I==2u){Near=vec4f(.2,.3,.4,1);}if(I==3u){Near.w=.25;}
                        Results[Id.x]=MergeInterval(Near,Far);return;
                    }let Q=Queries[Id.x];
                    let H=Trace(Q.Origin.xyz,Q.Direction.xyz,Q.Origin.w,Q.Direction.w,false);
                    Results[Id.x]=vec4f(H.Distance,f32(H.Index),f32(H.Visits),0);
                }`;
                const Layout = Device.createBindGroupLayout(
                {
                    entries: [
                    {
                        binding: 0,
                        visibility: GPUShaderStage.COMPUTE,
                        buffer:
                        {
                            type: 'read-only-storage'
                        }
                    },
                    {
                        binding: 1,
                        visibility: GPUShaderStage.COMPUTE,
                        buffer:
                        {
                            type: 'storage'
                        }
                    }]
                });
                const Module = Device.createShaderModule(
                {
                    code: Code
                });
                const Pipeline = await Device.createComputePipelineAsync(
                {
                    layout: Device.createPipelineLayout(
                    {
                        bindGroupLayouts: [SharedLayout, Layout]
                    }),
                    compute:
                    {
                        module: Module,
                        entryPoint: 'Verify'
                    }
                });
                const Input = Device.createBuffer(
                {
                    size: Queries.length * 32,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
                });
                const Output = Device.createBuffer(
                {
                    size: (Queries.length + 4) * 16,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });
                const Read = Device.createBuffer(
                {
                    size: (Queries.length + 4) * 16,
                    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
                });
                Device.queue.writeBuffer(Input, 0, new Float32Array(Queries.flatMap(Q => [...Q
                    .Origin, .02, ...Q.Direction, 80
                ])));
                const Group = Device.createBindGroup(
                {
                    layout: Layout,
                    entries: [
                    {
                        binding: 0,
                        resource:
                        {
                            buffer: Input
                        }
                    },
                    {
                        binding: 1,
                        resource:
                        {
                            buffer: Output
                        }
                    }]
                });
                const E = Device.createCommandEncoder(),
                    Pass = E.beginComputePass();
                Pass.setPipeline(Pipeline);
                Pass.setBindGroup(0, Shared);
                Pass.setBindGroup(1, Group);
                Pass.dispatchWorkgroups(Math.ceil((Queries.length + 4) / 64));
                Pass.end();
                E.copyBufferToBuffer(Output, 0, Read, 0, (Queries.length + 4) * 16);
                Device.queue.submit([E.finish()]);
                await Read.mapAsync(GPUMapMode.READ);
                const Values = Array.from(new Float32Array(Read.getMappedRange()));
                Read.unmap();
                for (const B of [Input, Output, Read]) B.destroy();
                return Values;
            }, Reference.Queries);
            const ExpectedIntervals = [
                [.2, .3, .4, 0],
                [.8, .6, .2, .5],
                [1, .9, .6, .5],
                [.4, .45, .45, .125]
            ];
            ExpectedIntervals.flat().forEach((V, I) => Assert(Math.abs(Results[Reference.Queries.length * 4 +
                I] - V) < 1e-6));
            Report.Checks.GpuIntervalAlgebra = true;
            let MaximumError = 0,
                Hits = 0;
            Pose.Expected.forEach((Expected, I) =>
            {
                const Actual = Results[I * 4];
                Assert(Math.abs(Actual - Expected) < .002,
                    `${Pose.Time} ray ${I}: ${Actual} != ${Expected}`);
                MaximumError = Math.max(MaximumError, Math.abs(Actual - Expected));
                if (Expected < 80) Hits++;
            });
            Report.Checks.GpuRays.push(
            {
                Time: Pose.Time,
                Count: Pose.Expected.length,
                Hits,
                MaximumError
            });
        }
        await Page.evaluate(() =>
        {
            TransportApp.Camera.position.set(0, 1.3, 3);
            TransportApp.Controls.target.set(0, .6, -4);
            TransportApp.Camera.fov = 32;
            TransportApp.Camera.updateProjectionMatrix();
            TransportApp.Controls.update();
        });
        await Step(0,
        {
            Analytic: false,
            Sky: 0,
            Debug: 2,
            History: 0
        });
        const Offscreen = await Page.evaluate(() =>
        {
            const A = TransportApp.Camera.projectionMatrix.clone().multiply(TransportApp.Camera
                .matrixWorldInverse).elements;
            const Clip = P => [0, 1, 2, 3].map(Row => A[Row] * P[0] + A[4 + Row] * P[1] + A[8 + Row] *
                P[2] + A[12 + Row]);
            const Emitters = TransportApp.Scene.Triangles.filter(T => T.Emission[0] > 0 && T.Emission[
                3] === 0);
            const Rejected = Emitters.filter(T =>
            {
                const V = [T.A, T.B, T.C].map(Clip);
                return [0, 1, 2, 3, 4, 5].some(Plane => V.every(P => [P[3] + P[0], P[3] - P[0],
                    P[3] + P[1], P[3] - P[1], P[2], P[3] - P[2]
                ][Plane] < 0));
            });
            return {
                Total: Emitters.length,
                Rejected: Rejected.length
            };
        });
        Assert.equal(Offscreen.Total, Offscreen.Rejected);
        Report.Checks.Offscreen = {
            ...Offscreen,
            Reading: await Measure('Offscreen')
        };
        Assert(Report.Checks.Offscreen.Reading.Mean > 0.00001);
        await Capture('12OffscreenTriangleEmission');
        await Step(0,
        {
            Power: 0
        });
        Assert.equal((await Measure('OffscreenOff')).Maximum, 0);
        await Page.evaluate(() =>
        {
            TransportApp.Camera.fov = 48;
            TransportApp.ResetView();
        });
        await Step(0,
        {
            Power: 1,
            Sky: .025,
            Analytic: true,
            Debug: 0,
            History: .65,
            Counters: false
        });
        // Exclude first-use compilation and screenshot delays: timestamps are GPU execution intervals, not screenshot frame rate.
        for (let I = 0; I < 7; I++)
        {
            await Step(I * .12);
            if (I >= 2) Report.Timings.push(await Page.evaluate(() => TransportApp.State.Metrics));
        }
        await Step(0,
        {
            Directions: 8,
            Cascades: 2,
            Interval: .5,
            Visibility: false,
            Shadow: 256
        });
        Assert.equal((await Measure('Extreme')).NonFinite, 0);
        Report.Checks.ExtremeQuality = true;
        await Step(0,
        {
            Directions: 4,
            Cascades: 4,
            Interval: 1.5,
            Visibility: true,
            Shadow: 512
        });
        await Page.selectOption('#Preset', 'Low');
        await Step(0);
        Report.Checks.Low = await Page.evaluate(() => (
        {
            Slots: TransportApp.State.SampleSlots,
            Settings:
            {
                ...TransportApp.Settings
            }
        }));
        await Page.selectOption('#Preset', 'High');
        await Step(0);
        Report.Checks.High = await Page.evaluate(() => (
        {
            Slots: TransportApp.State.SampleSlots,
            Settings:
            {
                ...TransportApp.Settings
            }
        }));
        Assert(Report.Checks.High.Slots > Report.Checks.Low.Slots);
        await Page.selectOption('#Preset', 'Balanced');
        await Step(0);
        const WasAnimating = await Page.evaluate(() => TransportApp.Settings.Animate);
        await Page.click('#Pause');
        Assert.equal(await Page.evaluate(() => TransportApp.Settings.Animate), !WasAnimating);
        await Page.click('#ToggleControls');
        Assert(await Page.isHidden('#Controls'));
        await Capture('13CleanView');
        const Before = await Page.evaluate(() => TransportApp.Camera.position.distanceTo(TransportApp.Controls
            .target));
        await Page.locator('#View').dispatchEvent('wheel',
        {
            deltaY: -120
        });
        await Step(0);
        const After = await Page.evaluate(() => TransportApp.Camera.position.distanceTo(TransportApp.Controls
            .target));
        Assert(After < Before && After > Before * .8);
        await Page.setViewportSize(
        {
            width: 390,
            height: 844
        });
        await Step(0);
        Assert(await Page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await Capture('14Mobile');
        await Page.setViewportSize(
        {
            width: 1440,
            height: 1000
        });
        await Page.goto(`${Url}?manual=1`);
        await Page.waitForFunction(() => TransportApp?.State.Completed > 0 || TransportApp?.State.Error);
        const LargeWidth = await Page.evaluate(() => TransportApp.State.Width);
        await Page.locator('#Scale').evaluate(Input =>
        {
            Input.value = '.35';
            Input.dispatchEvent(new Event('input',
            {
                bubbles: true
            }));
        });
        await Step(0);
        Assert((await Page.evaluate(() => TransportApp.State.Width)) < LargeWidth);
        Report.Checks.RenderScale = true;
        await Page.goto(`${Url}?width=320`);
        await Page.waitForFunction(() => TransportApp?.State.Completed >= 4 || TransportApp?.State.Error);
        Assert.equal(await Page.evaluate(() => TransportApp.State.Error), null);
        Report.Checks.Animation = await Page.evaluate(() => (
        {
            Frames: TransportApp.State.Completed,
            Time: TransportApp.State.Time,
            InFlight: TransportApp.State.InFlight
        }));
        Assert(Report.Checks.Animation.Time > 0);
        Assert(Report.Checks.Animation.InFlight <= 2);
        const Unsupported = await Browser.newPage();
        await Unsupported.addInitScript(() => Object.defineProperty(navigator, 'gpu',
        {
            value: undefined
        }));
        await Unsupported.goto(Url);
        await Unsupported.waitForSelector('#Failure:not([hidden])');
        Assert((await Unsupported.locator('#Failure').textContent()).includes('WebGPU'));
        await Unsupported.close();
        Report.Checks.UnsupportedRefusal = true;
        Assert.deepEqual(Report.Errors, []);
        Report.Passed = true;
    }
    finally
    {
        Fs.writeFileSync(`${Destination}/WebGpu.json`, JSON.stringify(Report, null, 2));
        await Browser.close();
    }
})().catch(Error =>
{
    console.error(Error);
    process.exitCode = 1;
});
