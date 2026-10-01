//============================================================================================================================================
//                                                           SURFELINTEGRATOR.JS                                                            //
//============================================================================================================================================
// 📦 WebGPU host for area-weighted placement, persistent radiance integration and the full-resolution ShaderBall.

const GeometryAddress = "../../Assets/ShaderBall/ShaderBall.mesh";
const HierarchyAddress = "../../Assets/ShaderBall/ShaderBall.bvh";
const GeometryMagic = 0x314d4253;
const HashCount = 4096;
const FieldCellSize = 0.58;
const BallRecordCount = 256;
const ShadowResolution = 1536;
const PlacementPositions = [
    [-1.22, -1.18, 0.0],
    [1.22, -1.18, 0.0],
    [-1.22, 1.18, 0.0],
    [1.22, 1.18, 0.0],
];
const PlacementColours = [
    [0.78, 0.18, 0.075],
    [0.08, 0.39, 0.68],
    [0.92, 0.55, 0.12],
    [0.16, 0.64, 0.36],
];

const PresentationCanvas = document.getElementById("PresentationCanvas");
const StatusPanel = document.querySelector(".Status");
const StatusText = document.getElementById("StatusText");
const CanvasError = document.getElementById("CanvasError");
const SurfelVisibility = document.getElementById("SurfelVisibility");
const IndirectVisibility = document.getElementById("IndirectVisibility");
const RayCountControl = document.getElementById("RayCount");
const IndirectGain = document.getElementById("IndirectGain");
const GainOutput = document.getElementById("GainOutput");
const ConvergenceToggle = document.getElementById("ConvergenceToggle");
const ConvergenceRestart = document.getElementById("ConvergenceRestart");
const SurfelMetric = document.getElementById("SurfelMetric");
const AccumulationMetric = document.getElementById("AccumulationMetric");
const TimingMetric = document.getElementById("TimingMetric");

function Align(NumberValue, Alignment)
{
    return Math.ceil(NumberValue / Alignment) * Alignment;
}

function Clamp(NumberValue, Minimum, Maximum)
{
    return Math.min(Maximum, Math.max(Minimum, NumberValue));
}

function Add(Alpha, Beta)
{
    return [Alpha[0] + Beta[0], Alpha[1] + Beta[1], Alpha[2] + Beta[2]];
}

function Subtract(Alpha, Beta)
{
    return [Alpha[0] - Beta[0], Alpha[1] - Beta[1], Alpha[2] - Beta[2]];
}

function Scale(Vector, Factor)
{
    return [Vector[0] * Factor, Vector[1] * Factor, Vector[2] * Factor];
}

function Dot(Alpha, Beta)
{
    return Alpha[0] * Beta[0] + Alpha[1] * Beta[1] + Alpha[2] * Beta[2];
}

function Cross(Alpha, Beta)
{
    return [
        Alpha[1] * Beta[2] - Alpha[2] * Beta[1],
        Alpha[2] * Beta[0] - Alpha[0] * Beta[2],
        Alpha[0] * Beta[1] - Alpha[1] * Beta[0],
    ];
}

function Normalise(Vector)
{
    const Length = Math.hypot(Vector[0], Vector[1], Vector[2]);
    return Length > 1.0e-10 ? Scale(Vector, 1.0 / Length) : [0.0, 0.0, 1.0];
}

function MultiplyMatrix(Alpha, Beta)
{
    const Product = new Float32Array(16);
    for (let Column = 0; Column < 4; ++Column)
    {
        for (let Row = 0; Row < 4; ++Row)
        {
            Product[Column * 4 + Row] =
                Alpha[0 * 4 + Row] * Beta[Column * 4 + 0]
                + Alpha[1 * 4 + Row] * Beta[Column * 4 + 1]
                + Alpha[2 * 4 + Row] * Beta[Column * 4 + 2]
                + Alpha[3 * 4 + Row] * Beta[Column * 4 + 3];
        }
    }
    return Product;
}

function PerspectiveProjection(FieldOfView, Aspect, NearDistance, FarDistance)
{
    const ScaleFactor = 1.0 / Math.tan(FieldOfView * 0.5);
    const Result = new Float32Array(16);
    Result[0] = ScaleFactor / Aspect;
    Result[5] = ScaleFactor;
    Result[10] = FarDistance / (NearDistance - FarDistance);
    Result[11] = -1.0;
    Result[14] = NearDistance * FarDistance / (NearDistance - FarDistance);
    return Result;
}

function OrthographicProjection(Left, Right, Bottom, Top, NearDistance, FarDistance)
{
    const Result = new Float32Array(16);
    Result[0] = 2.0 / (Right - Left);
    Result[5] = 2.0 / (Top - Bottom);
    Result[10] = 1.0 / (NearDistance - FarDistance);
    Result[12] = (Left + Right) / (Left - Right);
    Result[13] = (Bottom + Top) / (Bottom - Top);
    Result[14] = NearDistance / (NearDistance - FarDistance);
    Result[15] = 1.0;
    return Result;
}

function ViewProjection(Eye, Target, UpDirection)
{
    const Backward = Normalise(Subtract(Eye, Target));
    const Right = Normalise(Cross(UpDirection, Backward));
    const Up = Cross(Backward, Right);
    const Result = new Float32Array(16);
    Result[0] = Right[0];
    Result[1] = Up[0];
    Result[2] = Backward[0];
    Result[3] = 0.0;
    Result[4] = Right[1];
    Result[5] = Up[1];
    Result[6] = Backward[1];
    Result[7] = 0.0;
    Result[8] = Right[2];
    Result[9] = Up[2];
    Result[10] = Backward[2];
    Result[11] = 0.0;
    Result[12] = -Dot(Right, Eye);
    Result[13] = -Dot(Up, Eye);
    Result[14] = -Dot(Backward, Eye);
    Result[15] = 1.0;
    return Result;
}

function RadicalInverse(NumberValue)
{
    let Bits = NumberValue >>> 0;
    Bits = ((Bits << 16) | (Bits >>> 16)) >>> 0;
    Bits = (((Bits & 0x55555555) << 1) | ((Bits & 0xaaaaaaaa) >>> 1)) >>> 0;
    Bits = (((Bits & 0x33333333) << 2) | ((Bits & 0xcccccccc) >>> 2)) >>> 0;
    Bits = (((Bits & 0x0f0f0f0f) << 4) | ((Bits & 0xf0f0f0f0) >>> 4)) >>> 0;
    Bits = (((Bits & 0x00ff00ff) << 8) | ((Bits & 0xff00ff00) >>> 8)) >>> 0;
    return Bits * 2.3283064365386963e-10;
}

function HashCell(CellX, CellY, CellZ)
{
    const Mixed = (
        Math.imul(CellX + 2048, 73856093)
        ^ Math.imul(CellY + 2048, 19349663)
        ^ Math.imul(CellZ + 2048, 83492791)
    ) >>> 0;
    return Mixed % HashCount;
}

async function LoadBinary(Address)
{
    const Response = await fetch(Address);
    if (!Response.ok)
    {
        throw new Error(`Unable to load ${Address}: HTTP ${Response.status}`);
    }
    return Response.arrayBuffer();
}

async function LoadText(Address)
{
    const Response = await fetch(Address);
    if (!Response.ok)
    {
        throw new Error(`Unable to load ${Address}: HTTP ${Response.status}`);
    }
    return Response.text();
}

function DecodeGeometry(Content)
{
    const Header = new DataView(Content);
    if (Header.byteLength < 16 || Header.getUint32(0, true) !== GeometryMagic)
    {
        throw new Error("ShaderBall geometry is not an SBM1 stream");
    }
    const VertexCount = Header.getUint32(4, true);
    const IndexCount = Header.getUint32(8, true);
    const ExpectedBytes = 16 + VertexCount * 32 + IndexCount * 4;
    if (Header.byteLength !== ExpectedBytes || IndexCount % 3 !== 0)
    {
        throw new Error("ShaderBall geometry has an inconsistent byte count");
    }

    const SourceVertices = new Float32Array(Content, 16, VertexCount * 8);
    const Vertices = new Float32Array(VertexCount * 8);
    for (let VertexNumber = 0; VertexNumber < VertexCount; ++VertexNumber)
    {
        const SourceAddress = VertexNumber * 8;
        const DestinationAddress = VertexNumber * 8;
        Vertices[DestinationAddress] = SourceVertices[SourceAddress];
        Vertices[DestinationAddress + 1] = SourceVertices[SourceAddress + 1];
        Vertices[DestinationAddress + 2] = SourceVertices[SourceAddress + 2];
        Vertices[DestinationAddress + 3] = 0.0;
        Vertices[DestinationAddress + 4] = SourceVertices[SourceAddress + 3];
        Vertices[DestinationAddress + 5] = SourceVertices[SourceAddress + 4];
        Vertices[DestinationAddress + 6] = SourceVertices[SourceAddress + 5];
        Vertices[DestinationAddress + 7] = 0.0;
    }
    const IndexOffset = 16 + VertexCount * 32;
    const Indices = new Uint32Array(Content.slice(IndexOffset, IndexOffset + IndexCount * 4));
    return { Vertices, Indices, VertexCount, IndexCount };
}

function DecodeHierarchy(Content)
{
    const Header = new DataView(Content);
    if (
        Header.byteLength < 16
        || Header.getUint8(0) !== 0x53
        || Header.getUint8(1) !== 0x42
        || Header.getUint8(2) !== 0x48
        || Header.getUint8(3) !== 0x31
    )
    {
        throw new Error("ShaderBall hierarchy is not an SBH1 stream");
    }
    const NodeCount = Header.getUint32(4, true);
    const TriangleCount = Header.getUint32(8, true);
    const NodeBytes = NodeCount * 32;
    const ExpectedBytes = 16 + NodeBytes + TriangleCount * 4;
    if (Header.byteLength !== ExpectedBytes)
    {
        throw new Error("ShaderBall hierarchy has an inconsistent byte count");
    }
    return {
        Nodes: new Uint8Array(Content.slice(16, 16 + NodeBytes)),
        TriangleOrder: new Uint32Array(Content.slice(16 + NodeBytes)),
        NodeCount,
        TriangleCount,
    };
}

function LocateTriangle(CumulativeArea, Target)
{
    let Lower = 0;
    let Upper = CumulativeArea.length - 1;
    while (Lower < Upper)
    {
        const Middle = (Lower + Upper) >>> 1;
        if (CumulativeArea[Middle] < Target) Lower = Middle + 1;
        else Upper = Middle;
    }
    return Lower;
}

function ConstructField(Geometry)
{
    const TriangleCount = Geometry.IndexCount / 3;
    const CumulativeArea = new Float64Array(TriangleCount);
    let TotalArea = 0.0;
    for (let TriangleNumber = 0; TriangleNumber < TriangleCount; ++TriangleNumber)
    {
        const AlphaNumber = Geometry.Indices[TriangleNumber * 3] * 8;
        const BetaNumber = Geometry.Indices[TriangleNumber * 3 + 1] * 8;
        const GammaNumber = Geometry.Indices[TriangleNumber * 3 + 2] * 8;
        const Alpha = [
            Geometry.Vertices[AlphaNumber],
            Geometry.Vertices[AlphaNumber + 1],
            Geometry.Vertices[AlphaNumber + 2],
        ];
        const Beta = [
            Geometry.Vertices[BetaNumber],
            Geometry.Vertices[BetaNumber + 1],
            Geometry.Vertices[BetaNumber + 2],
        ];
        const Gamma = [
            Geometry.Vertices[GammaNumber],
            Geometry.Vertices[GammaNumber + 1],
            Geometry.Vertices[GammaNumber + 2],
        ];
        TotalArea += 0.5 * Math.hypot(...Cross(Subtract(Beta, Alpha), Subtract(Gamma, Alpha)));
        CumulativeArea[TriangleNumber] = TotalArea;
    }

    const Records = [];
    const Append = (Position, Radius, Normal, Area, Albedo, Identity) =>
    {
        Records.push(
            Position[0], Position[1], Position[2], Radius,
            Normal[0], Normal[1], Normal[2], Area,
            Albedo[0], Albedo[1], Albedo[2], Identity,
            0.0, 0.0, 0.0, 0.0,
        );
    };

    for (let PlacementNumber = 0; PlacementNumber < PlacementPositions.length; ++PlacementNumber)
    {
        const Translation = PlacementPositions[PlacementNumber];
        const Albedo = PlacementColours[PlacementNumber];
        for (let RecordNumber = 0; RecordNumber < BallRecordCount; ++RecordNumber)
        {
            const AreaPosition = ((RecordNumber + 0.5) / BallRecordCount) * TotalArea;
            const TriangleNumber = LocateTriangle(CumulativeArea, AreaPosition);
            const AlphaNumber = Geometry.Indices[TriangleNumber * 3] * 8;
            const BetaNumber = Geometry.Indices[TriangleNumber * 3 + 1] * 8;
            const GammaNumber = Geometry.Indices[TriangleNumber * 3 + 2] * 8;
            const First = (RecordNumber * 0.6180339887498948 + PlacementNumber * 0.127) % 1.0;
            const Second = RadicalInverse(RecordNumber + 1 + PlacementNumber * BallRecordCount);
            const Root = Math.sqrt(First);
            const AlphaWeight = 1.0 - Root;
            const BetaWeight = Root * (1.0 - Second);
            const GammaWeight = Root * Second;
            const Position = [0.0, 0.0, 0.0];
            const Normal = [0.0, 0.0, 0.0];
            for (let Axis = 0; Axis < 3; ++Axis)
            {
                Position[Axis] = Translation[Axis]
                    + Geometry.Vertices[AlphaNumber + Axis] * AlphaWeight
                    + Geometry.Vertices[BetaNumber + Axis] * BetaWeight
                    + Geometry.Vertices[GammaNumber + Axis] * GammaWeight;
                Normal[Axis] =
                    Geometry.Vertices[AlphaNumber + 4 + Axis] * AlphaWeight
                    + Geometry.Vertices[BetaNumber + 4 + Axis] * BetaWeight
                    + Geometry.Vertices[GammaNumber + 4 + Axis] * GammaWeight;
            }
            Append(Position, 0.205, Normalise(Normal), TotalArea / BallRecordCount, Albedo, PlacementNumber);
        }
    }

    const GroundColumns = 19;
    const GroundRows = 16;
    const GroundWidth = 7.42;
    const GroundDepth = 6.32;
    const GroundSpacingX = GroundWidth / GroundColumns;
    const GroundSpacingY = GroundDepth / GroundRows;
    for (let Row = 0; Row < GroundRows; ++Row)
    {
        for (let Column = 0; Column < GroundColumns; ++Column)
        {
            const Sequence = Row * GroundColumns + Column + 1;
            const JitterX = (RadicalInverse(Sequence) - 0.5) * GroundSpacingX * 0.34;
            const JitterY = (((Sequence * 0.754877666) % 1.0) - 0.5) * GroundSpacingY * 0.34;
            const Position = [
                -GroundWidth * 0.5 + (Column + 0.5) * GroundSpacingX + JitterX,
                -GroundDepth * 0.5 + (Row + 0.5) * GroundSpacingY + JitterY,
                -0.014,
            ];
            Append(
                Position,
                0.555,
                [0.0, 0.0, 1.0],
                GroundSpacingX * GroundSpacingY,
                [0.48, 0.50, 0.52],
                4,
            );
        }
    }

    const Field = new Float32Array(Records);
    const RecordCount = Field.length / 16;
    const Links = new Int32Array(HashCount + RecordCount);
    for (let RecordNumber = 0; RecordNumber < RecordCount; ++RecordNumber)
    {
        const Address = RecordNumber * 16;
        const CellX = Math.floor(Field[Address] / FieldCellSize);
        const CellY = Math.floor(Field[Address + 1] / FieldCellSize);
        const CellZ = Math.floor(Field[Address + 2] / FieldCellSize);
        const CellNumber = HashCell(CellX, CellY, CellZ);
        Links[HashCount + RecordNumber] = Links[CellNumber];
        Links[CellNumber] = RecordNumber + 1;
    }
    return { Field, Links, RecordCount, TotalArea };
}

function ConstructExtent(Device, Label, Content, Usage)
{
    const Extent = Device.createBuffer({
        label: Label,
        size: Align(Content.byteLength, 4),
        usage: Usage,
        mappedAtCreation: true,
    });
    const Destination = new Uint8Array(Extent.getMappedRange());
    Destination.set(new Uint8Array(Content.buffer, Content.byteOffset, Content.byteLength));
    Extent.unmap();
    return Extent;
}

function ConstructUniformExtent(Device, Label, ByteCount)
{
    return Device.createBuffer({
        label: Label,
        size: Align(ByteCount, 16),
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
}

async function ValidateShader(Shader, Label)
{
    if (typeof Shader.getCompilationInfo !== "function") return;
    const Information = await Shader.getCompilationInfo();
    const Failures = Information.messages.filter((Message) => Message.type === "error");
    if (Failures.length > 0)
    {
        throw new Error(`${Label}:\n${Failures.map((Message) => Message.message).join("\n")}`);
    }
}

function ConstructInstanceContent()
{
    const Content = new Float32Array(PlacementPositions.length * 12);
    const Roughness = [0.34, 0.24, 0.17, 0.48];
    const Metalness = [0.0, 0.12, 0.62, 0.0];
    for (let PlacementNumber = 0; PlacementNumber < PlacementPositions.length; ++PlacementNumber)
    {
        const Address = PlacementNumber * 12;
        Content.set([...PlacementPositions[PlacementNumber], 0.0], Address);
        Content.set([...PlacementColours[PlacementNumber], Metalness[PlacementNumber]], Address + 4);
        Content.set([Roughness[PlacementNumber], 1.0, 0.0, 0.0], Address + 8);
    }
    return Content;
}

function ConstructGroundContent()
{
    const Vertices = new Float32Array([
        -3.8, -3.25, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0,
        3.8, -3.25, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0,
        -3.8, 3.25, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0,
        3.8, 3.25, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0,
    ]);
    const Indices = new Uint32Array([0, 1, 2, 2, 1, 3]);
    const Instance = new Float32Array([
        0.0, 0.0, -0.02, 0.0,
        0.48, 0.50, 0.52, 0.0,
        0.82, 1.0, 0.0, 0.0,
    ]);
    return { Vertices, Indices, Instance };
}

async function BringRenderer()
{
    if (!navigator.gpu)
    {
        throw new Error("This browser does not expose navigator.gpu");
    }

    const Adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!Adapter)
    {
        throw new Error("No WebGPU adapter is available");
    }
    const Device = await Adapter.requestDevice();
    const CanvasContext = PresentationCanvas.getContext("webgpu");
    const CanvasFormat = navigator.gpu.getPreferredCanvasFormat();
    CanvasContext.configure({
        device: Device,
        format: CanvasFormat,
        alphaMode: "opaque",
    });

    const [
        GeometryBinary,
        HierarchyBinary,
        IntegrationSource,
        RasterSource,
        PresentationSource,
        OverlaySource,
    ] = await Promise.all([
        LoadBinary(GeometryAddress),
        LoadBinary(HierarchyAddress),
        LoadText("SurfelIntegrate.wgsl"),
        LoadText("SurfelRaster.wgsl"),
        LoadText("SurfelPresent.wgsl"),
        LoadText("SurfelOverlay.wgsl"),
    ]);

    const Geometry = DecodeGeometry(GeometryBinary);
    const Hierarchy = DecodeHierarchy(HierarchyBinary);
    if (Hierarchy.TriangleCount !== Geometry.IndexCount / 3)
    {
        throw new Error("ShaderBall geometry and hierarchy describe different triangle counts");
    }
    const FieldContent = ConstructField(Geometry);
    SurfelMetric.textContent = FieldContent.RecordCount.toLocaleString();

    const IntegrationShader = Device.createShaderModule({ label: "Surfel integration", code: IntegrationSource });
    const RasterShader = Device.createShaderModule({ label: "Visibility raster", code: RasterSource });
    const PresentationShader = Device.createShaderModule({ label: "Surfel presentation", code: PresentationSource });
    const OverlayShader = Device.createShaderModule({ label: "Surfel overlay", code: OverlaySource });
    await Promise.all([
        ValidateShader(IntegrationShader, "SurfelIntegrate.wgsl"),
        ValidateShader(RasterShader, "SurfelRaster.wgsl"),
        ValidateShader(PresentationShader, "SurfelPresent.wgsl"),
        ValidateShader(OverlayShader, "SurfelOverlay.wgsl"),
    ]);

    const VertexUsage = GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const IndexUsage = GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;
    const GeometryVertexExtent = ConstructExtent(Device, "ShaderBall vertices", Geometry.Vertices, VertexUsage);
    const CombinedIndices = new Uint32Array(Geometry.IndexCount + Hierarchy.TriangleOrder.length);
    CombinedIndices.set(Geometry.Indices);
    CombinedIndices.set(Hierarchy.TriangleOrder, Geometry.IndexCount);
    const GeometryIndexExtent = ConstructExtent(Device, "ShaderBall indices and order", CombinedIndices, IndexUsage);
    const HierarchyExtent = ConstructExtent(
        Device,
        "ShaderBall bounding hierarchy",
        Hierarchy.Nodes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const InstanceExtent = ConstructExtent(
        Device,
        "ShaderBall placements",
        ConstructInstanceContent(),
        GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    );

    const Ground = ConstructGroundContent();
    const GroundVertexExtent = ConstructExtent(Device, "Ground vertices", Ground.Vertices, GPUBufferUsage.VERTEX);
    const GroundIndexExtent = ConstructExtent(Device, "Ground indices", Ground.Indices, GPUBufferUsage.INDEX);
    const GroundInstanceExtent = ConstructExtent(Device, "Ground placement", Ground.Instance, GPUBufferUsage.VERTEX);
    const LinkExtent = ConstructExtent(
        Device,
        "Surfel cell links",
        FieldContent.Links,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const FieldExtents = [0, 1].map((NumberValue) => ConstructExtent(
        Device,
        `Surfel field ${NumberValue}`,
        FieldContent.Field,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    ));

    const IntegrationUniformExtent = ConstructUniformExtent(Device, "Integration settings", 160);
    const CameraUniformExtent = ConstructUniformExtent(Device, "Camera projection", 64);
    const LightUniformExtent = ConstructUniformExtent(Device, "Light projection", 64);
    const PresentationUniformExtent = ConstructUniformExtent(Device, "Presentation settings", 208);
    const OverlayUniformExtent = ConstructUniformExtent(Device, "Overlay settings", 80);

    const IntegrationProgram = Device.createComputePipeline({
        label: "Persistent surfel integration",
        layout: "auto",
        compute: { module: IntegrationShader, entryPoint: "IntegrateMain" },
    });

    const GeometryLayout = [
        {
            arrayStride: 32,
            stepMode: "vertex",
            attributes: [
                { shaderLocation: 0, offset: 0, format: "float32x3" },
                { shaderLocation: 1, offset: 16, format: "float32x3" },
            ],
        },
        {
            arrayStride: 48,
            stepMode: "instance",
            attributes: [
                { shaderLocation: 2, offset: 0, format: "float32x4" },
                { shaderLocation: 3, offset: 16, format: "float32x4" },
                { shaderLocation: 4, offset: 32, format: "float32x4" },
            ],
        },
    ];

    const RasterProgram = Device.createRenderPipeline({
        label: "Visibility raster",
        layout: "auto",
        vertex: { module: RasterShader, entryPoint: "RasterVertex", buffers: GeometryLayout },
        fragment: {
            module: RasterShader,
            entryPoint: "RasterFragment",
            targets: [
                { format: "rgba16float" },
                { format: "rgba16float" },
                { format: "rgba8unorm" },
            ],
        },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: true,
            depthCompare: "less",
        },
    });

    const ShadowProgram = Device.createRenderPipeline({
        label: "Sun visibility projection",
        layout: "auto",
        vertex: { module: RasterShader, entryPoint: "ShadowVertex", buffers: GeometryLayout },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: {
            format: "depth32float",
            depthWriteEnabled: true,
            depthCompare: "less",
            depthBias: 1,
            depthBiasSlopeScale: 1.4,
        },
    });

    const PresentationProgram = Device.createRenderPipeline({
        label: "Surfel presentation",
        layout: "auto",
        vertex: { module: PresentationShader, entryPoint: "FullscreenVertex" },
        fragment: {
            module: PresentationShader,
            entryPoint: "PresentFragment",
            targets: [{ format: CanvasFormat }],
        },
        primitive: { topology: "triangle-list" },
    });

    const OverlayProgram = Device.createRenderPipeline({
        label: "Surfel placement overlay",
        layout: "auto",
        vertex: { module: OverlayShader, entryPoint: "OverlayVertex" },
        fragment: {
            module: OverlayShader,
            entryPoint: "OverlayFragment",
            targets: [{
                format: CanvasFormat,
                blend: {
                    color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha" },
                    alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha" },
                },
            }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: {
            format: "depth24plus",
            depthWriteEnabled: false,
            depthCompare: "less-equal",
        },
    });

    const CameraGroup = Device.createBindGroup({
        layout: RasterProgram.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: CameraUniformExtent } }],
    });
    const LightGroup = Device.createBindGroup({
        layout: ShadowProgram.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: LightUniformExtent } }],
    });
    const IntegrationGroups = [0, 1].map((SourceNumber) => Device.createBindGroup({
        label: `Integrate field ${SourceNumber} to ${1 - SourceNumber}`,
        layout: IntegrationProgram.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: IntegrationUniformExtent } },
            { binding: 1, resource: { buffer: FieldExtents[SourceNumber] } },
            { binding: 2, resource: { buffer: FieldExtents[1 - SourceNumber] } },
            { binding: 3, resource: { buffer: LinkExtent } },
            { binding: 4, resource: { buffer: GeometryVertexExtent } },
            { binding: 5, resource: { buffer: GeometryIndexExtent } },
            { binding: 6, resource: { buffer: HierarchyExtent } },
        ],
    }));

    const ShadowImage = Device.createTexture({
        label: "Sun depth image",
        size: [ShadowResolution, ShadowResolution],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const ShadowComparison = Device.createSampler({
        label: "Sun depth comparison",
        compare: "less-equal",
        magFilter: "linear",
        minFilter: "linear",
    });

    const SunDirection = Normalise([-0.38, -0.52, 0.76]);
    const LightTarget = [0.0, 0.0, 0.42];
    const LightEye = Add(LightTarget, Scale(SunDirection, 10.0));
    const LightView = ViewProjection(LightEye, LightTarget, [0.0, 0.0, 1.0]);
    const LightProjection = MultiplyMatrix(
        OrthographicProjection(-5.1, 5.1, -4.8, 4.8, 0.1, 22.0),
        LightView,
    );
    Device.queue.writeBuffer(LightUniformExtent, 0, LightProjection);

    let PositionImage = null;
    let NormalImage = null;
    let AlbedoImage = null;
    let DepthImage = null;
    let PresentationGroups = [];
    let OverlayGroups = [];
    let PresentationWidth = 0;
    let PresentationHeight = 0;
    let ShadowPending = true;
    let PublishedNumber = 0;
    let IntegrationStep = 0;
    let ConvergenceEnabled = true;
    let OrbitYaw = 0.58;
    let OrbitPitch = 0.44;
    let OrbitDistance = 7.0;
    let PointerIdentity = null;
    let PointerPosition = [0, 0];
    let SmoothedEncodeMilliseconds = 0.0;

    function ResizePresentation()
    {
        const PixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        const Width = Math.max(1, Math.round(PresentationCanvas.clientWidth * PixelRatio));
        const Height = Math.max(1, Math.round(PresentationCanvas.clientHeight * PixelRatio));
        if (Width === PresentationWidth && Height === PresentationHeight) return;
        PresentationWidth = Width;
        PresentationHeight = Height;
        PresentationCanvas.width = Width;
        PresentationCanvas.height = Height;

        for (const Image of [PositionImage, NormalImage, AlbedoImage, DepthImage])
        {
            if (Image) Image.destroy();
        }
        const ColourUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
        PositionImage = Device.createTexture({ size: [Width, Height], format: "rgba16float", usage: ColourUsage });
        NormalImage = Device.createTexture({ size: [Width, Height], format: "rgba16float", usage: ColourUsage });
        AlbedoImage = Device.createTexture({ size: [Width, Height], format: "rgba8unorm", usage: ColourUsage });
        DepthImage = Device.createTexture({
            size: [Width, Height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });

        PresentationGroups = [0, 1].map((FieldNumber) => Device.createBindGroup({
            layout: PresentationProgram.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: PresentationUniformExtent } },
                { binding: 1, resource: PositionImage.createView() },
                { binding: 2, resource: NormalImage.createView() },
                { binding: 3, resource: AlbedoImage.createView() },
                { binding: 4, resource: ShadowImage.createView() },
                { binding: 5, resource: ShadowComparison },
                { binding: 6, resource: { buffer: FieldExtents[FieldNumber] } },
                { binding: 7, resource: { buffer: LinkExtent } },
            ],
        }));
        OverlayGroups = [0, 1].map((FieldNumber) => Device.createBindGroup({
            layout: OverlayProgram.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: OverlayUniformExtent } },
                { binding: 1, resource: { buffer: FieldExtents[FieldNumber] } },
            ],
        }));
    }

    function WriteIntegrationUniforms()
    {
        const Content = new Float32Array(40);
        Content.set([...SunDirection, IntegrationStep], 0);
        Content.set([5.5, 5.15, 4.7, Number(RayCountControl.value)], 4);
        Content.set([0.22, 0.29, 0.41, 32.0], 8);
        Content.set([0.055, 0.10, 0.22, 8.0], 12);
        Content.set([
            FieldContent.RecordCount,
            HashCount,
            Geometry.IndexCount,
            Hierarchy.NodeCount,
        ], 16);
        Content.set([FieldCellSize, 4.0, 0.0, 0.0], 20);
        for (let PlacementNumber = 0; PlacementNumber < 4; ++PlacementNumber)
        {
            Content.set([...PlacementPositions[PlacementNumber], 0.0], 24 + PlacementNumber * 4);
        }
        Device.queue.writeBuffer(IntegrationUniformExtent, 0, Content);
    }

    function WritePresentationUniforms(Camera)
    {
        const Content = new Float32Array(52);
        Content.set(LightProjection, 0);
        Content.set([...Camera.Eye, 0.0], 16);
        Content.set([...Camera.Forward, Math.tan(0.82 * 0.5)], 20);
        Content.set([...Camera.Right, PresentationWidth / PresentationHeight], 24);
        Content.set([...Camera.Up, Number(IndirectGain.value)], 28);
        Content.set([...SunDirection, 1.0], 32);
        Content.set([5.5, 5.15, 4.7, IndirectVisibility.checked ? 1.0 : 0.0], 36);
        Content.set([0.22, 0.29, 0.41, 0.0], 40);
        Content.set([0.055, 0.10, 0.22, 0.0], 44);
        Content.set([FieldContent.RecordCount, HashCount, FieldCellSize, 1.08], 48);
        Device.queue.writeBuffer(PresentationUniformExtent, 0, Content);
    }

    function WriteOverlayUniforms(CameraProjection)
    {
        const Content = new Float32Array(20);
        Content.set(CameraProjection, 0);
        Content.set([0.34, 1.15, FieldContent.RecordCount, 0.0], 16);
        Device.queue.writeBuffer(OverlayUniformExtent, 0, Content);
    }

    function CameraProjection()
    {
        const Target = [0.0, 0.0, 0.48];
        const CosinePitch = Math.cos(OrbitPitch);
        const Eye = [
            Target[0] + Math.sin(OrbitYaw) * CosinePitch * OrbitDistance,
            Target[1] - Math.cos(OrbitYaw) * CosinePitch * OrbitDistance,
            Target[2] + Math.sin(OrbitPitch) * OrbitDistance,
        ];
        const Forward = Normalise(Subtract(Target, Eye));
        const Right = Normalise(Cross(Forward, [0.0, 0.0, 1.0]));
        const Up = Normalise(Cross(Right, Forward));
        const View = ViewProjection(Eye, Target, [0.0, 0.0, 1.0]);
        const Projection = PerspectiveProjection(0.82, PresentationWidth / PresentationHeight, 0.05, 40.0);
        return {
            Eye,
            Forward,
            Right,
            Up,
            Projection: MultiplyMatrix(Projection, View),
        };
    }

    function EncodeGeometry(Rendering, Program, Group)
    {
        Rendering.setPipeline(Program);
        Rendering.setBindGroup(0, Group);
        Rendering.setVertexBuffer(0, GeometryVertexExtent);
        Rendering.setVertexBuffer(1, InstanceExtent);
        Rendering.setIndexBuffer(GeometryIndexExtent, "uint32", 0, Geometry.IndexCount * 4);
        Rendering.drawIndexed(Geometry.IndexCount, 4);
        Rendering.setVertexBuffer(0, GroundVertexExtent);
        Rendering.setVertexBuffer(1, GroundInstanceExtent);
        Rendering.setIndexBuffer(GroundIndexExtent, "uint32");
        Rendering.drawIndexed(Ground.Indices.length, 1);
    }

    function Render()
    {
        ResizePresentation();
        const EncodeStart = performance.now();
        const Camera = CameraProjection();
        Device.queue.writeBuffer(CameraUniformExtent, 0, Camera.Projection);
        WritePresentationUniforms(Camera);
        WriteOverlayUniforms(Camera.Projection);

        const Commands = Device.createCommandEncoder({ label: "Surfel demonstration commands" });
        if (ConvergenceEnabled)
        {
            IntegrationStep += 1;
            WriteIntegrationUniforms();
            const Computation = Commands.beginComputePass({ label: "Integrate persistent surfels" });
            Computation.setPipeline(IntegrationProgram);
            Computation.setBindGroup(0, IntegrationGroups[PublishedNumber]);
            Computation.dispatchWorkgroups(Math.ceil(FieldContent.RecordCount / 64));
            Computation.end();
            PublishedNumber = 1 - PublishedNumber;
        }

        if (ShadowPending)
        {
            const ShadowRendering = Commands.beginRenderPass({
                label: "Project sun visibility",
                colorAttachments: [],
                depthStencilAttachment: {
                    view: ShadowImage.createView(),
                    depthClearValue: 1.0,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                },
            });
            EncodeGeometry(ShadowRendering, ShadowProgram, LightGroup);
            ShadowRendering.end();
            ShadowPending = false;
        }

        const VisibilityRendering = Commands.beginRenderPass({
            label: "Project primary visibility",
            colorAttachments: [
                {
                    view: PositionImage.createView(),
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
                    loadOp: "clear",
                    storeOp: "store",
                },
                {
                    view: NormalImage.createView(),
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                    loadOp: "clear",
                    storeOp: "store",
                },
                {
                    view: AlbedoImage.createView(),
                    clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 0.0 },
                    loadOp: "clear",
                    storeOp: "store",
                },
            ],
            depthStencilAttachment: {
                view: DepthImage.createView(),
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });
        EncodeGeometry(VisibilityRendering, RasterProgram, CameraGroup);
        VisibilityRendering.end();

        const CanvasView = CanvasContext.getCurrentTexture().createView();
        const PresentationRendering = Commands.beginRenderPass({
            label: "Resolve surfel lighting",
            colorAttachments: [{
                view: CanvasView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: "clear",
                storeOp: "store",
            }],
        });
        PresentationRendering.setPipeline(PresentationProgram);
        PresentationRendering.setBindGroup(0, PresentationGroups[PublishedNumber]);
        PresentationRendering.draw(3);
        PresentationRendering.end();

        if (SurfelVisibility.checked)
        {
            const OverlayRendering = Commands.beginRenderPass({
                label: "Expose surfel placement",
                colorAttachments: [{
                    view: CanvasView,
                    loadOp: "load",
                    storeOp: "store",
                }],
                depthStencilAttachment: {
                    view: DepthImage.createView(),
                    depthReadOnly: true,
                },
            });
            OverlayRendering.setPipeline(OverlayProgram);
            OverlayRendering.setBindGroup(0, OverlayGroups[PublishedNumber]);
            OverlayRendering.draw(6, FieldContent.RecordCount);
            OverlayRendering.end();
        }

        Device.queue.submit([Commands.finish()]);
        const EncodeMilliseconds = performance.now() - EncodeStart;
        SmoothedEncodeMilliseconds = SmoothedEncodeMilliseconds === 0.0
            ? EncodeMilliseconds
            : SmoothedEncodeMilliseconds * 0.92 + EncodeMilliseconds * 0.08;
        AccumulationMetric.textContent = IntegrationStep.toLocaleString();
        TimingMetric.textContent = `${SmoothedEncodeMilliseconds.toFixed(2)} ms`;
        requestAnimationFrame(Render);
    }

    function RestartConvergence()
    {
        Device.queue.writeBuffer(FieldExtents[0], 0, FieldContent.Field);
        Device.queue.writeBuffer(FieldExtents[1], 0, FieldContent.Field);
        PublishedNumber = 0;
        IntegrationStep = 0;
        AccumulationMetric.textContent = "0";
    }

    ConvergenceToggle.addEventListener("click", () =>
    {
        ConvergenceEnabled = !ConvergenceEnabled;
        ConvergenceToggle.textContent = ConvergenceEnabled ? "Pause convergence" : "Resume convergence";
    });
    ConvergenceRestart.addEventListener("click", RestartConvergence);
    RayCountControl.addEventListener("change", RestartConvergence);
    IndirectGain.addEventListener("input", () =>
    {
        GainOutput.textContent = `${Number(IndirectGain.value).toFixed(2)}×`;
    });

    PresentationCanvas.addEventListener("pointerdown", (Event) =>
    {
        PointerIdentity = Event.pointerId;
        PointerPosition = [Event.clientX, Event.clientY];
        PresentationCanvas.setPointerCapture(Event.pointerId);
    });
    PresentationCanvas.addEventListener("pointermove", (Event) =>
    {
        if (Event.pointerId !== PointerIdentity) return;
        const DeltaX = Event.clientX - PointerPosition[0];
        const DeltaY = Event.clientY - PointerPosition[1];
        PointerPosition = [Event.clientX, Event.clientY];
        OrbitYaw -= DeltaX * 0.006;
        OrbitPitch = Clamp(OrbitPitch + DeltaY * 0.005, 0.10, 1.28);
    });
    const ReleasePointer = (Event) =>
    {
        if (Event.pointerId === PointerIdentity) PointerIdentity = null;
    };
    PresentationCanvas.addEventListener("pointerup", ReleasePointer);
    PresentationCanvas.addEventListener("pointercancel", ReleasePointer);
    PresentationCanvas.addEventListener("wheel", (Event) =>
    {
        Event.preventDefault();
        OrbitDistance = Clamp(OrbitDistance * Math.exp(Event.deltaY * 0.001), 3.4, 12.0);
    }, { passive: false });

    Device.lost.then((Information) =>
    {
        StatusPanel.classList.remove("Ready");
        StatusPanel.classList.add("Failed");
        StatusText.textContent = `WebGPU device lost: ${Information.message || Information.reason}`;
    });

    StatusPanel.classList.add("Ready");
    StatusText.textContent = "WebGPU · world-space field live";
    requestAnimationFrame(Render);
}

BringRenderer().catch((Failure) =>
{
    console.error(Failure);
    StatusPanel.classList.add("Failed");
    StatusText.textContent = "WebGPU could not start";
    CanvasError.hidden = false;
    const Detail = CanvasError.querySelector("span");
    Detail.textContent = Failure instanceof Error ? Failure.message : String(Failure);
});
