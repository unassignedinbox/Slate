//============================================================================================================================================
//                                                              VERIFYWEBGPU.CJS
//============================================================================================================================================
// 📦 Actual WebGPU deformation/refit readbacks, GPU-versus-brute-force rays, radiance decomposition and captured changing geometry.

const Assert = require('node:assert/strict'),
    Fs = require('node:fs'),
    {
        createHash
    } = require('node:crypto');
const
{
    chromium
} = require('playwright'), Chromium = require('@sparticuz/chromium');
const Destination = process.argv[2] || '_AgentScratch/DeformationProof';
Fs.mkdirSync(Destination,
{
    recursive: true
});
const Report = {
    Date: '2026-10-05',
    Errors: [],
    Geometry: [],
    Lighting:
    {},
    Captures: [],
    SourceHashes:
    {}
};
for (const Name of Fs.readdirSync('Frontier/Experimental/DeformationIntegrator').filter(Name => /\.(js|css|html)$/.test(
        Name)))
    Report.SourceHashes[Name] = createHash('sha256').update(Fs.readFileSync(
        `Frontier/Experimental/DeformationIntegrator/${Name}`)).digest('hex');
(async () =>
{
    const Specification = await import(
        '../../Frontier/Experimental/DeformationIntegrator/DeformationSpecification.js');
    const Scene = Specification.ConstructScene();
    const Rays = JSON.parse(Fs.readFileSync(`${Destination}/Rays.json`));
    const QuerySource = `
struct Ray { Origin:vec4f, Direction:vec4f }
@group(1) @binding(0) var<storage,read> Queries:array<Ray>;
@group(1) @binding(1) var<storage,read_write> Results:array<vec4f>;
@compute @workgroup_size(64) fn Verify(@builtin(global_invocation_id) Invocation:vec3u)
{
    if(Invocation.x>=arrayLength(&Queries)){return;}
    let Query=Queries[Invocation.x];
    let Hit=Trace(Query.Origin.xyz,Query.Direction.xyz,40.0,false);
    Results[Invocation.x]=vec4f(Hit.Distance,f32(Hit.Index),f32(Hit.Visits),0);
}`;
    const Browser = await chromium.launch(
    {
        executablePath: process.env.PREVIEW_CHROMIUM || await Chromium.executablePath(),
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
        const Url = process.env.DEFORMATION_URL ||
            'http://localhost:8080/Frontier/Experimental/DeformationIntegrator/index.html';
        await Page.goto(Url + '?manual=1&width=320');
        await Page.waitForFunction(() => window.DeformationApp?.Metrics.Completed > 0 || window.DeformationApp
            ?.Metrics.Error);
        Assert.equal(await Page.evaluate(() => DeformationApp.Metrics.Error), null);
        Report.Adapter = await Page.evaluate(() => DeformationApp.Metrics.Adapter);
        Report.Browser = Browser.version();
        const Step = async (Compression, Changes = {}, Count = 1) =>
        {
            await Page.evaluate(async (
            {
                Compression,
                Changes,
                Count
            }) =>
            {
                DeformationApp.Configure(
                {
                    Animate: false,
                    ...Changes
                });
                await DeformationApp.Step(Compression, Count);
            },
            {
                Compression,
                Changes,
                Count
            });
            Assert.equal(await Page.evaluate(() => DeformationApp.Metrics.Error), null);
        };
        const Capture = async Name =>
        {
            await Page.screenshot(
            {
                path: `${Destination}/${Name}.png`
            });
            Report.Captures.push(Name);
        };
        const GpuQueries = async Frozen => Page.evaluate(async (
        {
            Rays,
            QuerySource,
            Frozen
        }) =>
        {
            const Application = DeformationApp,
                Device = Application.Device;
            const
            {
                Traversal
            } = await import('./TransportIntegrator.js');
            const Content = new Float32Array(Rays.flatMap(Ray => [...Ray.Origin, 0, ...Ray
                .Direction, 0
            ]));
            const Input = Device.createBuffer(
            {
                size: Content.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            });
            Device.queue.writeBuffer(Input, 0, Content);
            const Output = Device.createBuffer(
            {
                size: Rays.length * 16,
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
                        type: Index ? 'storage' : 'read-only-storage'
                    }
                }))
            });
            const Program = Device.createShaderModule(
            {
                code: Traversal + QuerySource
            });
            const Compilation = await Program.getCompilationInfo();
            if (Compilation.messages.some(Message => Message.type === 'error')) throw new Error(
                JSON.stringify(Compilation.messages));
            const Pipeline = await Device.createComputePipelineAsync(
            {
                layout: Device.createPipelineLayout(
                {
                    bindGroupLayouts: [Application.TraceLayout, Layout]
                }),
                compute:
                {
                    module: Program,
                    entryPoint: 'Verify'
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
            Pass.setBindGroup(0, Frozen ? Application.FrozenBind : Application.CurrentBind);
            Pass.setBindGroup(1, Bind);
            Pass.dispatchWorkgroups(Math.ceil(Rays.length / 64));
            Pass.end();
            Device.queue.submit([Encoder.finish()]);
            const Reading = Array.from(new Float32Array(await Application.ReadResource(Output,
                Rays.length * 16)));
            Input.destroy();
            Output.destroy();
            return Reading;
        },
        {
            Rays,
            QuerySource,
            Frozen
        });
        const VerifyPose = async (Compression, Source, ExpectedVertices, Label) =>
        {
            await Step(Compression,
            {
                Source,
                View: 3,
                Samples: 1
            });
            const Reading = await Page.evaluate(async () =>
            {
                const Application = DeformationApp;
                return {
                    Vertices: Array.from(new Float32Array(await Application.ReadResource(
                        Application.Vertices, Application.Scene.Vertices
                        .length * 16))),
                    Facets: Array.from(new Float32Array(await Application.ReadResource(
                        Application.Facets, Application.Scene.Facets.length *
                        112))),
                    Bounds: Array.from(new Float32Array(await Application.ReadResource(
                        Application.Bounds, Application.Scene.Bounds.length * 48
                    ))),
                    Metrics:
                    {
                        ...Application.Metrics
                    }
                };
            });
            let VertexError = 0,
                NormalError = 0;
            for (let Index = 0; Index < Scene.Vertices.length; Index++)
                for (let Axis = 0; Axis < 3; Axis++)
                {
                    const Actual = Reading.Vertices[Index * 4 + Axis];
                    Assert(Number.isFinite(Actual));
                    VertexError = Math.max(VertexError, Math.abs(Actual - ExpectedVertices[Index][
                        Axis
                    ]));
                }
            Assert(VertexError < .00001, `${Label} position error ${VertexError}`);
            for (let Index = 0; Index < Scene.Facets.length; Index++)
            {
                const Corners = Scene.Facets[Index].slice(0, 3).map(Corner => ExpectedVertices[Corner]);
                const Normal = Specification.FacetNormal(...Corners);
                for (let Axis = 0; Axis < 3; Axis++)
                {
                    Assert(Number.isFinite(Reading.Facets[Index * 28 + 12 + Axis]));
                    NormalError = Math.max(NormalError, Math.abs(Reading.Facets[Index * 28 + 12 +
                        Axis] - Normal[Axis]));
                }
            }
            Assert(NormalError < .001, `${Label} normal error ${NormalError}`);
            for (let Index = 0; Index < Scene.Bounds.length; Index++)
            {
                const Extent = Scene.Bounds[Index],
                    Offset = Index * 12;
                if (Extent.Count)
                {
                    for (let Triangle = Extent.Start; Triangle < Extent.Start + Extent
                        .Count; Triangle++)
                        for (const Corner of Scene.Facets[Triangle].slice(0, 3))
                            for (let Axis = 0; Axis < 3; Axis++)
                            {
                                Assert(Reading.Bounds[Offset + Axis] <= Reading.Vertices[Corner * 4 +
                                    Axis] + 1e-6);
                                Assert(Reading.Bounds[Offset + 4 + Axis] >= Reading.Vertices[Corner *
                                    4 + Axis] - 1e-6);
                            }
                }
                else
                    for (const Address of [Extent.Left, Extent.Right])
                        for (let Axis = 0; Axis < 3; Axis++)
                        {
                            Assert(Reading.Bounds[Offset + Axis] <= Reading.Bounds[Address * 12 +
                                Axis]);
                            Assert(Reading.Bounds[Offset + 4 + Axis] >= Reading.Bounds[Address * 12 +
                                4 + Axis]);
                        }
            }
            const Gpu = await GpuQueries(false);
            const Reference = Rays.map(Ray => Scene.Facets.reduce((Nearest, Facet) => Math.min(Nearest,
                Specification.IntersectFacet(Ray.Origin, Ray.Direction, ...Facet.slice(0, 3)
                    .map(Index => ExpectedVertices[Index]))), 40));
            const MaximumRayError = Math.max(...Reference.map((Distance, Index) => Math.abs(Distance -
                Gpu[Index * 4])));
            Assert(MaximumRayError < .0001, `${Label} ray error ${MaximumRayError}`);
            const Frozen = await GpuQueries(true);
            const StaleDisagreements = Reference.filter((Distance, Index) => Math.abs(Distance - Frozen[
                Index * 4]) > .001).length;
            const Entry = {
                Label,
                Compression,
                Source,
                VertexError,
                NormalError,
                Rays: Rays.length,
                MaximumRayError,
                StaleDisagreements,
                Metrics: Reading.Metrics
            };
            Report.Geometry.push(Entry);
            console.log('Geometry', Label, VertexError, MaximumRayError, StaleDisagreements);
            return Entry;
        };
        for (const Compression of [0, .325, .65])
            await VerifyPose(Compression, 0, Scene.Vertices.map(Position => Specification.DeformPosition(
                Position, Compression)), 'Live ' + Compression);
        Assert(Report.Geometry[2].StaleDisagreements > 30);
        const VatCompression = .373,
            Pose = VatCompression / .65 * 16,
            Lower = Math.floor(Pose),
            Upper = Math.min(16, Lower + 1),
            Fraction = Pose - Lower;
        const VatExpected = Scene.Vertices.map((Position, Index) => Index < Specification.TyreCount ? [0, 1, 2,
                3
            ].map(Axis => Scene.Poses[(Lower * Specification.TyreCount + Index) * 4 + Axis] * (1 -
                    Fraction) + Scene.Poses[(Upper * Specification.TyreCount + Index) * 4 + Axis] *
                Fraction) :
            Specification.DeformPosition(Position, VatCompression));
        await VerifyPose(VatCompression, 1, VatExpected, 'Interpolated VAT');
        const External = Scene.Vertices.map(Position => Specification.DeformPosition(Position, .4));
        for (let Index = 0; Index < Specification.TyreCount; Index++)
        {
            const Position = External[Index];
            Position[2] -= .075 * Math.exp(-Math.pow((Position[0] - .8) / .45, 2) - Math.pow((Position[1] -
                1.2) / .5, 2)) * Math.max(0, Position[2]);
        }
        await Page.evaluate(Positions => DeformationApp.SupplyPositions(Positions), External.slice(0,
            Specification.TyreCount).flat());
        await VerifyPose(.4, 2, External, 'External solver position stream');
        await Page.evaluate(() =>
        {
            let Rejected = false;
            try
            {
                DeformationApp.SupplyPositions([NaN]);
            }
            catch
            {
                Rejected = true;
            }
            if (!Rejected) throw new Error('Invalid external geometry was accepted');
        });
        await Step(.65,
        {
            Source: 0,
            View: 3,
            Power: 1
        });
        await Page.evaluate(() =>
        {
            const Application = DeformationApp;
            for (const Invalid of [NaN, Number.MAX_VALUE])
            {
                const Positions = Application.Scene.Vertices.slice(0, 1536).flat();
                Positions[0] = Invalid;
                let Rejected = false;
                try
                {
                    Application.SupplyPositions(Positions);
                }
                catch
                {
                    Rejected = true;
                }
                if (!Rejected) throw new Error('Invalid float32 solver coordinate accepted');
            }
        });
        const Receivers = [];
        for (let Row = 0; Row < 4; Row++)
            for (let Column = 0; Column < 5; Column++)
                Receivers.push([-2 + Column, 0, -1.5 + Row, 0]);
        const DirectReadings = await Page.evaluate(async Receivers =>
        {
            const Application = DeformationApp,
                Device = Application.Device;
            const
            {
                Integration
            } = await import('./TransportIntegrator.js');
            const Code = Integration + `
@group(2) @binding(0) var<storage,read> Receivers:array<vec4f>;
@group(2) @binding(1) var<storage,read_write> Integrals:array<vec4f>;
@compute @workgroup_size(32) fn Radiometry(@builtin(global_invocation_id) Invocation:vec3u)
{
    if(Invocation.x>=arrayLength(&Receivers)){return;}
    var Sum=vec3f(0);
    for(var Sample=0u;Sample<64u;Sample++)
    {
        var Seed=Invocation.x*1973u+Sample*9277u+89173u;
        Sum+=SampleLight(Receivers[Invocation.x].xyz,vec3f(0,1,0),vec3f(.5,.45,.3),&Seed);
    }
    Integrals[Invocation.x]=vec4f(Sum/64.0,1);
}`;
            const Input = Device.createBuffer(
            {
                size: Receivers.length * 16,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
            });
            Device.queue.writeBuffer(Input, 0, new Float32Array(Receivers.flat()));
            const Output = Device.createBuffer(
            {
                size: Receivers.length * 16,
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
                        type: Index ? 'storage' : 'read-only-storage'
                    }
                }))
            });
            const Empty = Device.createBindGroupLayout(
            {
                entries: []
            });
            const Program = Device.createShaderModule(
            {
                code: Code
            });
            const Pipeline = await Device.createComputePipelineAsync(
            {
                layout: Device.createPipelineLayout(
                {
                    bindGroupLayouts: [Application.TraceLayout, Empty, Layout]
                }),
                compute:
                {
                    module: Program,
                    entryPoint: 'Radiometry'
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
            Pass.setBindGroup(1, Device.createBindGroup(
            {
                layout: Empty,
                entries: []
            }));
            Pass.setBindGroup(2, Bind);
            Pass.dispatchWorkgroups(Math.ceil(Receivers.length / 32));
            Pass.end();
            Device.queue.submit([Encoder.finish()]);
            const Result = Array.from(new Float32Array(await Application.ReadResource(Output,
                Receivers.length * 16)));
            Input.destroy();
            Output.destroy();
            return Result;
        }, Receivers);
        const LoadedVertices = Scene.Vertices.map(Position => Specification.DeformPosition(Position, .65));
        const Sources = Scene.Quads.filter(Quad => Quad.Material >= 6).map(Quad =>
        {
            const Origin = Scene.Vertices[Quad.Corners[0]].slice(0, 3);
            const Edges = [1, 3].map(Corner => Scene.Vertices[Quad.Corners[Corner]].slice(0, 3).map((
                Coordinate, Axis) => Coordinate - Origin[Axis]));
            Edges.sort((First, Second) => Math.hypot(...Second) - Math.hypot(...First));
            const [Long, Short] = Edges;
            const Cross = [Long[1] * Short[2] - Long[2] * Short[1], Long[2] * Short[0] - Long[0] *
                Short[2], Long[0] * Short[1] - Long[1] * Short[0]
            ];
            const Area = Math.hypot(...Cross);
            return {
                Origin,
                Long,
                Short,
                Area,
                Normal: Cross.map(Coordinate => Coordinate / Area),
                Emission: Scene.Emissions[Quad.Material]
            };
        });
        let RadiometryError = 0,
            OccludedSamples = 0;
        for (let Index = 0; Index < Receivers.length; Index++)
        {
            const Sum = [0, 0, 0],
                Position = Receivers[Index].slice(0, 3);
            for (let Sample = 0; Sample < 64; Sample++)
            {
                let Seed = (Index * 1973 + Sample * 9277 + 89173) >>> 0;
                const Random = () =>
                {
                    Seed = (Math.imul(Seed, 747796405) + 2891336453) >>> 0;
                    const Word = Math.imul((Seed >>> ((Seed >>> 28) + 4)) ^ Seed, 277803737) >>> 0;
                    return Math.fround(((Word >>> 22) ^ Word) >>> 0) / 4294967296;
                };
                const Source = Sources[Random() > .5 ? 1 : 0],
                    Horizontal = Random(),
                    Vertical = Random();
                const Point = Source.Origin.map((Coordinate, Axis) => Coordinate + Source.Long[Axis] *
                    Horizontal + Source.Short[Axis] * Vertical);
                const Delta = Point.map((Coordinate, Axis) => Coordinate - Position[Axis]);
                const Distance = Math.hypot(...Delta),
                    Direction = Delta.map(Coordinate => Coordinate / Distance);
                const Origin = [Position[0], .002, Position[2]];
                const Occluded = Scene.Facets.some(Facet => Specification.IntersectFacet(Origin, Direction, ...
                    Facet.slice(0, 3).map(Corner => LoadedVertices[Corner])) < Distance - .005);
                if (Occluded)
                {
                    OccludedSamples++;
                    continue;
                }
                const Cosine = Math.max(0, Direction[1]),
                    LightCosine = Math.abs(Source.Normal.reduce((Total, Coordinate, Axis) => Total -
                        Coordinate * Direction[Axis], 0));
                for (let Channel = 0; Channel < 3; Channel++) Sum[Channel] += [.5, .45, .3][Channel] * Source
                    .Emission[Channel] * Cosine * LightCosine * Source.Area * Sources.length / (Math.PI *
                        Distance * Distance);
            }
            for (let Channel = 0; Channel < 3; Channel++) RadiometryError = Math.max(RadiometryError, Math.abs(
                Sum[Channel] / 64 - DirectReadings[Index * 4 + Channel]));
        }
        Assert(RadiometryError < .00002, `Independent area-light integral error ${RadiometryError}`);
        Assert(OccludedSamples > 0);
        Report.Radiometry = {
            Receivers: Receivers.length,
            SamplesPerReceiver: 64,
            OccludedSamples,
            MaximumAbsoluteError: RadiometryError
        };
        console.log('Independent radiometry', Report.Radiometry);
        const Measure = async Label => Page.evaluate(async Label =>
        {
            const Image = await DeformationApp.Readback(),
                Positions = await DeformationApp.Readback('Position');
            let Sum = 0,
                Maximum = 0,
                NonFinite = 0,
                Count = 0,
                FloorSum = 0,
                FloorCount = 0;
            const Pixels = [];
            for (let Row = 0; Row < Image.Height; Row++)
                for (let Column = 0; Column < Image.Width; Column++)
                {
                    const Offset = Row * Image.Pitch / 4 + Column * 4;
                    if (!Positions.Pixels[Offset + 3]) continue;
                    const Index = Math.round(Positions.Pixels[Offset + 3]) - 1;
                    const Floor = DeformationApp.Scene.Facets[Index][3] % 128 === 2;
                    for (let Channel = 0; Channel < 3; Channel++)
                    {
                        const Reading = Image.Pixels[Offset + Channel];
                        if (!Number.isFinite(Reading)) NonFinite++;
                        Sum += Reading;
                        Maximum = Math.max(Maximum, Reading);
                        Pixels.push(Reading);
                        if (Floor)
                        {
                            FloorSum += Reading;
                            FloorCount++;
                        }
                    }
                    Count++;
                }
            window.Readings ||=
            {};
            Readings[Label] = Pixels;
            return {
                Mean: Sum / (Count * 3),
                Maximum,
                NonFinite,
                Count,
                FloorMean: FloorSum / FloorCount,
                Samples: DeformationApp.Metrics.Samples
            };
        }, Label);
        // 📝 Identical sample indices and all bounce decisions make component comparison independent of Monte Carlo noise.
        for (const [Label, View] of [
                ['Full', 0],
                ['Direct', 1],
                ['Indirect', 2]
            ])
        {
            await Page.evaluate(() => DeformationApp.ResetAccumulation());
            await Step(.65,
            {
                Source: 0,
                View,
                Bounces: 3,
                Samples: 8,
                Frozen: false,
                Power: 1
            }, 2);
            Report.Lighting[Label] = await Measure(Label);
            Assert.equal(Report.Lighting[Label].NonFinite, 0);
        }
        const Decomposition = await Page.evaluate(() => Readings.Full.reduce((Maximum, Reading, Index) => Math
            .max(Maximum, Math.abs(Reading - Readings.Direct[Index] - Readings.Indirect[Index])), 0));
        Assert(Decomposition < .00002);
        Report.Lighting.DecompositionMaximumError = Decomposition;
        Assert(Report.Lighting.Indirect.Mean > .001);
        await Step(.65,
        {
            Power: 0,
            View: 0,
            Samples: 1
        });
        Report.Lighting.Dark = await Measure('Dark');
        Assert.equal(Report.Lighting.Dark.Maximum, 0);
        await Step(.65,
        {
            Power: 1,
            View: 2,
            Bounces: 1
        });
        Assert.equal((await Measure('NoBounce')).Maximum, 0);
        await Step(.65,
        {
            View: 0,
            Bounces: 3,
            Samples: 8
        }, 2);
        const Before = await Measure('Before');
        await Step(.65,
        {
            Frozen: true
        }, 2);
        Report.Lighting.Frozen = await Measure('Frozen');
        const FrozenDifference = await Page.evaluate(() => Readings.Before.reduce((Sum, Reading, Index) => Sum +
            Math.abs(Reading - Readings.Frozen[Index]), 0) / Readings.Before.length);
        Assert(FrozenDifference > .001);
        Report.Lighting.FrozenMeanAbsoluteDifference = FrozenDifference;
        await Capture('04FrozenGeometryWrong');
        await Step(.65,
        {
            View: 2
        }, 2);
        Report.Lighting.FrozenIndirect = await Measure('FrozenIndirect');
        const IndirectDifference = await Page.evaluate(() => Readings.Indirect.reduce((Sum, Reading, Index) =>
            Sum + Math.abs(Reading - Readings.FrozenIndirect[Index]), 0) / Readings.Indirect.length);
        Assert(IndirectDifference > .0001);
        Report.Lighting.FrozenIndirectMeanAbsoluteDifference = IndirectDifference;
        await Step(.65,
        {
            Frozen: false,
            View: 0,
            Samples: 8
        }, 6);
        Report.Lighting.Loaded = await Measure('Loaded');
        await Capture('02LoadedCurrentGI');
        const PreviousSamples = await Page.evaluate(() => DeformationApp.Metrics.Samples);
        await Step(.65,
        {
            Samples: 1
        });
        Assert.equal(await Page.evaluate(() => DeformationApp.Metrics.Samples), PreviousSamples + 1);
        Assert.equal(await Page.evaluate(() => DeformationApp.Metrics.GeometryChanged), false);
        await Step(.4,
        {
            Samples: 1
        });
        Assert.equal(await Page.evaluate(() => DeformationApp.Metrics.Samples), 1);
        Report.Lighting.AccumulationInvalidation = true;
        await Step(0,
        {
            Samples: 8
        }, 6);
        await Capture('01UnloadedCurrentGI');
        await Step(.65,
        {
            View: 2,
            Samples: 8
        }, 4);
        await Capture('03IndirectOnly');
        await Step(.65,
        {
            View: 3,
            Wire: true,
            Samples: 1
        });
        await Capture('05ActualDeformedQuads');
        await Step(VatCompression,
        {
            Source: 1,
            View: 0,
            Wire: false,
            Samples: 8
        }, 4);
        await Capture('06VertexTexture');
        Report.VatPoseError = Math.max(...VatExpected.slice(0, Specification.TyreCount).flatMap((Position,
            Index) => Position.slice(0, 3).map((Coordinate, Axis) => Math.abs(Coordinate -
            Specification.DeformPosition(Scene.Vertices[Index], VatCompression)[Axis]))));
        await Page.click('#Toggle');
        Assert(await Page.isHidden('#Controls'));
        await Capture('07CleanView');
        Report.MovingTimings = [];
        for (const Compression of [.1, .35, .6])
        {
            await Step(Compression,
            {
                Source: 0,
                View: 0,
                Samples: 1
            });
            Report.MovingTimings.push(await Page.evaluate(() => (
            {
                ...DeformationApp.Metrics
            })));
        }
        await Page.setViewportSize(
        {
            width: 390,
            height: 844
        });
        await Step(.65,
        {
            Source: 0,
            Samples: 1,
            View: 3
        });
        Assert(await Page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        await Capture('08Mobile');
        await Page.setViewportSize(
        {
            width: 1440,
            height: 1000
        });
        await Page.goto(Url + '?manual=1');
        await Page.waitForFunction(() => DeformationApp?.Metrics.Completed > 0 || DeformationApp?.Metrics
            .Error);
        await Step(.65,
        {
            View: 3,
            Scale: .3
        });
        const Smaller = await Page.evaluate(() => DeformationApp.Metrics.Width);
        await Step(.65,
        {
            View: 3,
            Scale: .8
        });
        Assert((await Page.evaluate(() => DeformationApp.Metrics.Width)) > Smaller);
        await Page.goto(Url + '?width=128');
        await Page.waitForFunction(() => DeformationApp?.Metrics.Completed >= 3 || DeformationApp?.Metrics
            .Error);
        Assert.equal(await Page.evaluate(() => DeformationApp.Metrics.Error), null);
        await Page.click('#Pause');
        const PausedCompression = await Page.evaluate(() => DeformationApp.Configuration.Compression);
        await Page.waitForFunction(Compression => Math.abs(DeformationApp.Metrics.Compression - Compression) < 1e-8, PausedCompression);
        Assert.equal(await Page.evaluate(() => DeformationApp.Configuration.Animate), false);
        await Page.click('#Pause');
        Assert.equal(await Page.evaluate(() => DeformationApp.Configuration.Animate), true);
        Report.PauseResume = true;
        await Page.evaluate(() => DeformationApp.Stop());
        await Page.waitForFunction(() => !DeformationApp.Metrics.Busy);
        Report.Animation = await Page.evaluate(() => (
        {
            ...DeformationApp.Metrics
        }));
        Assert(Report.Animation.Revision >= 2);
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
