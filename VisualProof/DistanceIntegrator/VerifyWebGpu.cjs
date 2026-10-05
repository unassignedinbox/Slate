//============================================================================================================================================
//                                                              VERIFYWEBGPU.CJS
//============================================================================================================================================
// 📦 Executed mesh-derived SDF oracle checks, raymarch/reference comparisons, no-triangle-GI counters and diagnostic captures.

const Assert = require('node:assert/strict'),
    Fs = require('node:fs'),
    {
        createHash
    } = require('node:crypto');
const
{
    chromium
} = require('playwright'), Chromium = require('@sparticuz/chromium');
const Destination = process.argv[2] || '_AgentScratch/DistanceProof';
Fs.mkdirSync(Destination,
{
    recursive: true
});
const Report = {
    Date: '2026-10-05',
    Errors: [],
    Volumes: [],
    Rays: [],
    Captures: [],
    SourceHashes:
    {}
};
for (const Directory of ['DistanceIntegrator', 'DeformationIntegrator'])
    for (const Name of Fs.readdirSync(`Frontier/Experimental/${Directory}`).filter(Name => /\.(js|html|css)$/.test(
            Name)))
        Report.SourceHashes[`${Directory}/${Name}`] = createHash('sha256').update(Fs.readFileSync(
            `Frontier/Experimental/${Directory}/${Name}`)).digest('hex');
(async () =>
{
    const Reference = await import('./VerifyStructure.mjs');
    const
    {
        DomainMinimum,
        DomainMaximum
    } = await import('../../Frontier/Experimental/DistanceIntegrator/BodySpecification.js');
    const Scene = Reference.ConstructScene();
    const Browser = await chromium.launch(
    {
        executablePath: await Chromium.executablePath(),
        args: [...Chromium.args.filter(Argument => !['--in-process-gpu', '--single-process'].includes(
                Argument)), '--enable-unsafe-webgpu', '--enable-features=Vulkan',
            '--use-vulkan=swiftshader'
        ],
        env:
        {
            ...process.env,
            LD_LIBRARY_PATH: '/tmp:/tmp/lib',
            VK_ICD_FILENAMES: '/tmp/vk_swiftshader_icd.json'
        }
    });
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
        Page.setDefaultTimeout(240000);
        Page.on('pageerror', Error => Report.Errors.push(Error.message));
        Page.on('console', Message =>
        {
            if (Message.type() === 'error') Report.Errors.push(Message.text());
        });
        const Url = process.env.DISTANCE_URL ||
            'http://localhost:8080/Frontier/Experimental/DistanceIntegrator/index.html';
        await Page.goto(Url + '?manual=1&width=480');
        await Page.waitForFunction(() => window.DistanceApp?.Metrics.Completed > 0 || window.DistanceApp
            ?.Metrics.Error);
        Assert.equal(await Page.evaluate(() => DistanceApp.Metrics.Error), null);
        Report.Adapter = await Page.evaluate(() => DistanceApp.Metrics.Adapter);
        Report.Browser = Browser.version();
        const Step = async (Amount = .55, Changes = {}) =>
        {
            await Page.evaluate(async (
            {
                Amount,
                Changes
            }) =>
            {
                DistanceApp.Configure(Changes);
                await DistanceApp.Step(Amount);
            },
            {
                Amount,
                Changes
            });
            Assert.equal(await Page.evaluate(() => DistanceApp.Metrics.Error), null);
            return await Page.evaluate(() => (
            {
                ...DistanceApp.Metrics
            }));
        };
        const Capture = async Name =>
        {
            await Page.screenshot(
            {
                path: `${Destination}/${Name}.png`
            });
            Report.Captures.push(Name);
        };
        const VerifyVolume = async (Amount, Count) =>
        {
            const Metrics = await Step(Amount,
            {
                Resolution: Count,
                View: 1,
                Counters: true
            });
            Assert.equal(Metrics.Rasterized, false);
            Assert.equal(Metrics.Work[2], 0);
            Assert(Metrics.Work[0] > 1000);
            const Field = await Page.evaluate(() => DistanceApp.Readback('Field'));
            let Negative = 0,
                NonFinite = 0,
                Minimum = Infinity,
                Maximum = -Infinity;
            const Candidates = {
                Inside: [],
                Near: [],
                Far: []
            };
            for (let Depth = 0; Depth < Count; Depth++)
                for (let Row = 0; Row < Count; Row++)
                    for (let Column = 0; Column < Count; Column++)
                    {
                        const Offset = Depth * Field.Pitch * Count + Row * Field.Pitch + Column * 4;
                        const Signed = Field.Pixels[Offset];
                        if (!Number.isFinite(Signed)) NonFinite++;
                        Minimum = Math.min(Minimum, Signed);
                        Maximum = Math.max(Maximum, Signed);
                        Assert.equal(Field.Pixels[Offset + 3], 1);
                        if (Signed < 0) Negative++;
                        const Bucket = Signed < -.003 ? 'Inside' : Signed < .12 ? 'Near' : 'Far';
                        Candidates[Bucket].push(
                        {
                            Column,
                            Row,
                            Depth,
                            Signed
                        });
                    }
            Assert.equal(NonFinite, 0);
            Assert(Negative > 50);
            Assert(Minimum < 0 && Maximum > 1);
            const Vertices = Scene.Vertices.map(Position => Reference.DeformPosition(Position, Amount));
            const Readings = await Page.evaluate(async () => Array.from(new Float32Array(
                await DistanceApp.ReadResource(DistanceApp.Vertices, DistanceApp.Scene
                    .Vertices.length * 16))));
            let VertexError = 0;
            for (let Index = 0; Index < Vertices.length; Index++)
                for (let Axis = 0; Axis < 3; Axis++) VertexError = Math.max(VertexError, Math.abs(
                    Readings[Index * 4 + Axis] - Vertices[Index][Axis]));
            Assert(VertexError < .0001, `Deformation/trigonometry error ${VertexError}`);
            const ActualVertices = Scene.Vertices.map((_, Index) => Readings.slice(Index * 4, Index * 4 + 4));
            const Checks = [];
            for (const Bucket of Object.values(Candidates))
            {
                for (let Sample = 0; Sample < 8; Sample++)
                {
                    const Choice = Bucket[Math.floor((Sample + .37) / 8 * Bucket.length)];
                    const Point = [Choice.Column, Choice.Row, Choice.Depth].map((Index, Axis) =>
                        DomainMinimum[Axis] + (DomainMaximum[Axis] - DomainMinimum[Axis]) * Index /
                        (Count - 1));
                    const Expected = Reference.SignedReference(Scene, ActualVertices, Point);
                    const Error = Math.abs(Expected - Choice.Signed);
                    Assert(Error < .004, `Signed field mismatch: ${Expected} vs ${Choice.Signed}`);
                    if (Math.abs(Expected) > .003) Assert.equal(Math.sign(Choice.Signed), Math.sign(
                        Expected));
                    Checks.push(
                    {
                        Point,
                        Expected,
                        Actual: Choice.Signed,
                        Error
                    });
                }
            }
            const Reading = {
                Amount,
                Resolution: Count,
                Voxels: Count ** 3,
                Negative,
                NonFinite,
                Minimum,
                Maximum,
                VertexError,
                MaximumDistanceError: Math.max(...Checks.map(Check => Check.Error)),
                Checks,
                Metrics
            };
            Report.Volumes.push(Reading);
            console.log('Volume', Count, Amount, Negative, Reading.MaximumDistanceError);
            return Field;
        };
        const QueryRays = async (Amount, Count) =>
        {
            const Rays = [];
            for (let Row = 0; Row < 12; Row++)
                for (let Column = 0; Column < 20; Column++)
                {
                    const Origin = [6.3, 4.3, 8.9],
                        Target = [-1.9 + (Column + .3) / 20 * 3.8, .25 + (Row + .4) / 12 * 2.5, .5];
                    const Delta = Target.map((Coordinate, Axis) => Coordinate - Origin[Axis]);
                    const Length = Math.hypot(...Delta);
                    Rays.push(
                    {
                        Origin,
                        Direction: Delta.map(Coordinate => Coordinate / Length)
                    });
                }
            const Results = await Page.evaluate(async Rays =>
            {
                const Application = DistanceApp,
                    Device = Application.Device;
                const
                {
                    FieldQueries
                } = await import('./DistanceIntegrator.js');
                const Code = FieldQueries + `
struct Query { Origin:vec4f, Direction:vec4f }
@group(1) @binding(0) var<storage,read> Queries:array<Query>;
@group(1) @binding(1) var<storage,read_write> Results:array<vec4f>;
@compute @workgroup_size(64) fn Compare(@builtin(global_invocation_id) Invocation:vec3u)
{
    if(Invocation.x>=arrayLength(&Queries)){return;}
    let Query=Queries[Invocation.x];
    let Triangle=TriangleRay(Query.Origin.xyz,Query.Direction.xyz,30.0,false);
    let Field=March(Query.Origin.xyz,Query.Direction.xyz,30.0,false);
    Results[Invocation.x*2u]=vec4f(Triangle.Distance,f32(Triangle.Material),Field.Distance,f32(Field.Material));
    Results[Invocation.x*2u+1u]=vec4f(f32(Field.Steps),f32(Field.Exhausted),0,0);
}`;
                const Input = Device.createBuffer(
                {
                    size: Rays.length * 32,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
                });
                Device.queue.writeBuffer(Input, 0, new Float32Array(Rays.flatMap(Ray => [...
                    Ray.Origin, 0, ...Ray.Direction, 0
                ])));
                const Output = Device.createBuffer(
                {
                    size: Rays.length * 32,
                    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
                });
                const Layout = Device.createBindGroupLayout(
                {
                    entries: [0, 1].map(Index => (
                    {
                        binding: Index,
                        visibility: GPUShaderStage.COMPUTE,
                        buffer:
                        {
                            type: Index ? 'storage' :
                                'read-only-storage'
                        }
                    }))
                });
                const Program = Device.createShaderModule(
                {
                    code: Code
                });
                const Pipeline = await Device.createComputePipelineAsync(
                {
                    layout: Device.createPipelineLayout(
                    {
                        bindGroupLayouts: [Application.TraceLayout, Layout,
                            Application.FieldLayout
                        ]
                    }),
                    compute:
                    {
                        module: Program,
                        entryPoint: 'Compare'
                    }
                });
                const Bind = Device.createBindGroup(
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
                const Encoder = Device.createCommandEncoder(),
                    Pass = Encoder.beginComputePass();
                Pass.setPipeline(Pipeline);
                Pass.setBindGroup(0, Application.CurrentBind);
                Pass.setBindGroup(1, Bind);
                Pass.setBindGroup(2, Application.FieldBind);
                Pass.dispatchWorkgroups(Math.ceil(Rays.length / 64));
                Pass.end();
                Device.queue.submit([Encoder.finish()]);
                const Result = Array.from(new Float32Array(await Application.ReadResource(
                    Output, Rays.length * 32)));
                Input.destroy();
                Output.destroy();
                return Result;
            }, Rays);
            const Actual = await Page.evaluate(async () => Array.from(new Float32Array(await DistanceApp.ReadResource(DistanceApp.Vertices, DistanceApp.Scene.Vertices.length * 16))));
            const Vertices = Scene.Vertices.map((_, Index) => Actual.slice(Index * 4, Index * 4 + 4));
            let TriangleError = 0,
                MissingBody = 0,
                ExtraBody = 0,
                Exhausted = 0,
                BodyRays = 0;
            const Errors = [],
                All = [];
            for (let Index = 0; Index < Rays.length; Index++)
            {
                const Ray = Rays[Index],
                    Offset = Index * 8;
                let Nearest = 30;
                for (const Facet of Scene.Facets) Nearest = Math.min(Nearest, Reference.IntersectFacet(
                    Ray.Origin, Ray.Direction, ...Facet.slice(0, 3).map(Corner => Vertices[
                        Corner])));
                const Expected = Nearest === 30 ? -1 : Nearest;
                TriangleError = Math.max(TriangleError, Math.abs(Expected - Results[Offset]));
                const TriangleBody = [0, 1, 2, 6].includes(Results[Offset + 1]),
                    FieldBody = [0, 1, 2, 6].includes(Results[Offset + 3]);
                if (TriangleBody)
                {
                    BodyRays++;
                    if (!FieldBody) MissingBody++;
                    if (FieldBody) Errors.push(Math.abs(Results[Offset + 2] - Results[Offset]));
                }
                else if (FieldBody) ExtraBody++;
                Exhausted += Results[Offset + 5];
                All.push(Results.slice(Offset, Offset + 8));
            }
            Assert(TriangleError < .0002);
            Assert(BodyRays > 30);
            Assert(Errors.length > 10);
            Errors.sort((First, Second) => First - Second);
            const Reading = {
                Amount,
                Resolution: Count,
                Count: Rays.length,
                TriangleError,
                BodyRays,
                MissingBody,
                ExtraBody,
                Exhausted,
                MeanBodyDepthError: Errors.reduce((Sum, Error) => Sum + Error, 0) / Errors.length,
                MedianBodyDepthError: Errors[Math.floor(Errors.length / 2)],
                P95BodyDepthError: Errors[Math.floor(Errors.length * .95)],
                MatchedBodyRays: Errors.length,
                All
            };
            Report.Rays.push(Reading);
            console.log('Rays', Count, 'miss/extra', MissingBody, ExtraBody, 'median', Reading
                .MedianBodyDepthError);
            return Reading;
        };
        await VerifyVolume(.55, 32);
        await QueryRays(.55, 32);
        await Capture('01SdfCoarse32');
        const Field64 = await VerifyVolume(.55, 64);
        await QueryRays(.55, 64);
        await Capture('02SdfOnly64');
        const BuildCount = await Page.evaluate(() => DistanceApp.Metrics.FieldBuilds);
        const Full = await Step(.55,
        {
            View: 0,
            Rays: 4,
            Counters: true
        });
        Assert.equal(Full.Work[2], 0);
        Assert(Full.Work[0] > 1000);
        Assert(Full.Rasterized);
        Assert.equal(Full.FieldBuilds, BuildCount);
        Report.SdfGi = Full;
        await Capture('03RasterSdfGI');
        const Image = await Page.evaluate(() => DistanceApp.Readback());
        await Step(.55,
        {
            View: 6
        });
        const Indirect = await Page.evaluate(() => DistanceApp.Readback());
        await Capture('04SdfIndirect');
        await Step(.55,
        {
            View: 9
        });
        const Direct = await Page.evaluate(() => DistanceApp.Readback());
        const Position = await Page.evaluate(() => DistanceApp.Readback('Position'));
        let MaximumDecomposition = 0,
            IndirectSum = 0,
            Count = 0;
        for (let Row = 0; Row < Image.Height; Row++)
            for (let Column = 0; Column < Image.Width; Column++)
            {
                if (!Position.Pixels[Row * Position.Pitch + Column * 4 + 3]) continue;
                for (let Channel = 0; Channel < 3; Channel++)
                {
                    const Offset = Row * Image.Pitch + Column * 4 + Channel;
                    Assert(Number.isFinite(Image.Pixels[Offset]));
                    MaximumDecomposition = Math.max(MaximumDecomposition, Math.abs(Image.Pixels[Offset] - Direct
                        .Pixels[Offset] - Indirect.Pixels[Offset]));
                    IndirectSum += Indirect.Pixels[Offset];
                    Count++;
                }
            }
        Assert(MaximumDecomposition < .003);
        Assert(IndirectSum / Count > .00001);
        Report.Lighting = {
            MaximumDecomposition,
            MeanIndirectRgb: IndirectSum / Count
        };
        await Step(.55,
        {
            View: 0,
            Power: 0
        });
        const Dark = await Page.evaluate(() => DistanceApp.Readback());
        for (let Row = 0; Row < Dark.Height; Row++)
            for (let Column = 0; Column < Dark.Width; Column++)
                if (Position.Pixels[Row * Position.Pitch + Column * 4 + 3])
                    for (let Channel = 0; Channel < 3; Channel++) Assert.equal(Dark.Pixels[Row * Dark.Pitch +
                        Column * 4 + Channel], 0);
        Report.Lighting.Dark = true;
        const Triangle = await Step(.55,
        {
            View: 7,
            Power: 1
        });
        Assert(Triangle.Work[2] > 1000);
        Assert.equal(Triangle.Work[0], 0);
        Report.TriangleGi = Triangle;
        await Capture('05TriangleReference');
        await Step(.55,
        {
            View: 2
        });
        Assert.equal(await Page.evaluate(() => DistanceApp.Metrics.Rasterized), false);
        await Capture('06SdfNormals');
        await Step(.55,
        {
            View: 3,
            Axis: 1,
            Slice: .37
        });
        await Capture('07SignedSliceY');
        await Step(.55,
        {
            View: 3,
            Axis: 0,
            Slice: .5
        });
        await Capture('08SignedSliceX');
        await Step(.55,
        {
            View: 4
        });
        await Capture('09Error64');
        await Step(.55,
        {
            View: 5
        });
        await Capture('10MarchCost');
        const Frozen = await Step(1,
        {
            View: 0,
            Frozen: true
        });
        Assert(Frozen.Revision !== Frozen.FieldRevision);
        Assert.equal(Frozen.FieldBuilds, BuildCount);
        await Capture('11FrozenFieldWrong');
        const FrozenReading = await Page.evaluate(() => DistanceApp.Readback());
        const FrozenField = await Page.evaluate(() => DistanceApp.Readback('Field'));
        Assert.deepEqual(FrozenField.Pixels, Field64.Pixels);
        await Step(1,
        {
            Frozen: false,
            View: 0
        });
        const Refreshed = await Page.evaluate(() => DistanceApp.Readback());
        let ChangedLighting = 0;
        for (let Index = 0; Index < Refreshed.Pixels.length; Index++) ChangedLighting += Math.abs(Refreshed
            .Pixels[Index] - FrozenReading.Pixels[Index]);
        Assert(ChangedLighting > 1);
        Report.FrozenLightingAbsoluteSum = ChangedLighting;
        await VerifyVolume(1, 64);
        await Capture('12DeformedSdf64');
        await VerifyVolume(.55, 96);
        await QueryRays(.55, 96);
        await Capture('13SdfOnly96');
        await Step(.55,
        {
            View: 4
        });
        await Capture('14Error96');
        await Step(.55,
        {
            View: 8
        });
        await Capture('15CurrentQuadSurface');
        await Page.click('#Toggle');
        await Step(.55,
        {
            View: 1
        });
        await Capture('16CleanSdfView');
        await Page.setViewportSize(
        {
            width: 390,
            height: 844
        });
        await Step(.55,
        {
            View: 3
        });
        Assert(await Page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await Capture('17MobileSlice');
        // Rebuild independently at the same pose: no stale or accumulated pixels may survive.
        await Page.setViewportSize(
        {
            width: 1440,
            height: 1000
        });
        await Step(.55,
        {
            View: 0,
            Resolution: 64
        });
        const Replay = await Page.evaluate(() => DistanceApp.Readback());
        Assert.deepEqual(Replay.Pixels, Image.Pixels);
        Report.Lighting.ExactReplay = true;
        Report.Final = await Page.evaluate(() => (
        {
            ...DistanceApp.Metrics
        }));
        const Unsupported = await Browser.newPage();
        await Unsupported.addInitScript(() => Object.defineProperty(navigator, 'gpu',
        {
            value: undefined
        }));
        await Unsupported.goto(Url);
        await Unsupported.waitForSelector('#Failure:not([hidden])');
        Assert((await Unsupported.locator('#FailureText').textContent()).includes('WebGPU'));
        await Unsupported.close();
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
    process.exit(1);
});
