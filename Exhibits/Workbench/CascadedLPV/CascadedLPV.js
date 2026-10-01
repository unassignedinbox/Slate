// WebGPU host for a fully dynamic RSM -> transient surfel -> cascaded LPV -> screen GI demonstration.

const GeometryAddress = "../../Assets/ShaderBall/ShaderBall.mesh";
const GeometryMagic = 0x314d4253;
const RsmResolution = 384;
const RsmWorldSpan = 48.0;
const ShadowResolution = 1024;
const SurfelCount = (RsmResolution / 2) * (RsmResolution / 2);
const OverlayStride = 16;
const VolumeResolution = 40;
const CellsPerCascade = VolumeResolution ** 3;
const VolumeCellCount = CellsPerCascade * 3;
const FrameUniformBytes = 912;

const PresentationCanvas = document.getElementById("PresentationCanvas");
const StatusPanel = document.querySelector(".Status");
const StatusText = document.getElementById("StatusText");
const CanvasError = document.getElementById("CanvasError");
const PanelLabels = document.getElementById("PanelLabels");
const DisplayMode = document.getElementById("DisplayMode");
const AnimateWorld = document.getElementById("AnimateWorld");
const AnimateSun = document.getElementById("AnimateSun");
const BlockerField = document.getElementById("BlockerField");
const ScreenDetail = document.getElementById("ScreenDetail");
const TemporalStability = document.getElementById("TemporalStability");
const ShowSurfels = document.getElementById("ShowSurfels");
const PropagationSteps = document.getElementById("PropagationSteps");
const PropagationOutput = document.getElementById("PropagationOutput");
const IndirectGain = document.getElementById("IndirectGain");
const GainOutput = document.getElementById("GainOutput");
const ScreenRadius = document.getElementById("ScreenRadius");
const RadiusOutput = document.getElementById("RadiusOutput");
const RenderScale = document.getElementById("RenderScale");
const ScaleOutput = document.getElementById("ScaleOutput");
const ShadowFilter = document.getElementById("ShadowFilter");
const PauseButton = document.getElementById("PauseButton");
const ResetButton = document.getElementById("ResetButton");
const TimingMetric = document.getElementById("TimingMetric");
const SurfelMetric = document.getElementById("SurfelMetric");

SurfelMetric.textContent = SurfelCount.toLocaleString();

function Clamp(Value, Minimum, Maximum)
{
    return Math.min(Maximum, Math.max(Minimum, Value));
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
    return Length > 1.0e-9 ? Scale(Vector, 1.0 / Length) : [0.0, 0.0, 1.0];
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

function ViewMatrix(Eye, Target, UpDirection)
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

async function LoadBinary(Address)
{
    const Response = await fetch(Address);
    if (!Response.ok) throw new Error(`Unable to load ${Address}: HTTP ${Response.status}`);
    return Response.arrayBuffer();
}

async function LoadText(Address)
{
    const Response = await fetch(Address, { cache: "no-store" });
    if (!Response.ok) throw new Error(`Unable to load ${Address}: HTTP ${Response.status}`);
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
        const Address = VertexNumber * 8;
        Vertices[Address] = SourceVertices[Address];
        Vertices[Address + 1] = SourceVertices[Address + 1];
        Vertices[Address + 2] = SourceVertices[Address + 2];
        Vertices[Address + 4] = SourceVertices[Address + 3];
        Vertices[Address + 5] = SourceVertices[Address + 4];
        Vertices[Address + 6] = SourceVertices[Address + 5];
    }
    const IndexOffset = 16 + VertexCount * 32;
    const Indices = new Uint32Array(Content.slice(IndexOffset, IndexOffset + IndexCount * 4));
    return { Vertices, Indices, IndexCount };
}

function ConstructCube()
{
    const Faces = [
        { N: [1, 0, 0], P: [[.5,-.5,-.5],[.5,.5,-.5],[.5,-.5,.5],[.5,.5,.5]] },
        { N: [-1, 0, 0], P: [[-.5,.5,-.5],[-.5,-.5,-.5],[-.5,.5,.5],[-.5,-.5,.5]] },
        { N: [0, 1, 0], P: [[-.5,.5,-.5],[-.5,.5,.5],[.5,.5,-.5],[.5,.5,.5]] },
        { N: [0, -1, 0], P: [[.5,-.5,-.5],[.5,-.5,.5],[-.5,-.5,-.5],[-.5,-.5,.5]] },
        { N: [0, 0, 1], P: [[-.5,-.5,.5],[.5,-.5,.5],[-.5,.5,.5],[.5,.5,.5]] },
        { N: [0, 0, -1], P: [[-.5,.5,-.5],[.5,.5,-.5],[-.5,-.5,-.5],[.5,-.5,-.5]] },
    ];
    const VertexValues = [];
    const IndexValues = [];
    for (const Face of Faces)
    {
        const Base = VertexValues.length / 8;
        for (const Position of Face.P)
        {
            VertexValues.push(...Position, 0.0, ...Face.N, 0.0);
        }
        IndexValues.push(Base, Base + 1, Base + 2, Base + 2, Base + 1, Base + 3);
    }
    return { Vertices: new Float32Array(VertexValues), Indices: new Uint32Array(IndexValues) };
}

function CreateBuffer(Device, Label, ContentOrSize, Usage)
{
    const Size = typeof ContentOrSize === "number"
        ? Math.max(4, Math.ceil(ContentOrSize / 4) * 4)
        : Math.max(4, Math.ceil(ContentOrSize.byteLength / 4) * 4);
    const Buffer = Device.createBuffer({ label: Label, size: Size, usage: Usage });
    if (typeof ContentOrSize !== "number") Device.queue.writeBuffer(Buffer, 0, ContentOrSize);
    return Buffer;
}

async function ValidateShader(Shader, Label)
{
    if (typeof Shader.getCompilationInfo !== "function") return;
    const Information = await Shader.getCompilationInfo();
    const Failures = Information.messages.filter((Message) => Message.type === "error");
    if (Failures.length > 0)
    {
        const Diagnostic = Failures.map((Message) =>
        {
            const Location = Message.lineNum ? `${Message.lineNum}:${Message.linePos || 1} ` : "";
            return `${Location}${Message.message}`;
        }).join("\n");
        throw new Error(`${Label}:\n${Diagnostic}`);
    }
}

function PushInstance(Target, Position, Colour, Metalness, ScaleValue, Roughness)
{
    Target.push(
        Position[0], Position[1], Position[2], 0.0,
        Colour[0], Colour[1], Colour[2], Metalness,
        ScaleValue[0], ScaleValue[1], ScaleValue[2], Roughness,
    );
}

function ConstructSceneInstances(Time)
{
    const Cubes = [];
    PushInstance(Cubes, [0, 0, -0.34], [0.30, 0.34, 0.33], 0.0, [36, 36, 0.68], 0.96);
    PushInstance(Cubes, [0, 0, 0.025], [0.08, 0.105, 0.11], 0.0, [5.2, 34, 0.05], 0.86);
    PushInstance(Cubes, [-6.3, 2.2, 1.65], [0.54, 0.12, 0.075], 0.0, [0.48, 8.4, 3.3], 0.72);
    PushInstance(Cubes, [6.3, 2.2, 1.65], [0.055, 0.25, 0.50], 0.0, [0.48, 8.4, 3.3], 0.62);
    PushInstance(Cubes, [-9.6, 7.5, 2.7], [0.32, 0.37, 0.33], 0.0, [5.4, 4.7, 5.4], 0.86);
    PushInstance(Cubes, [9.8, 8.5, 3.7], [0.39, 0.34, 0.26], 0.0, [5.2, 5.5, 7.4], 0.82);
    PushInstance(Cubes, [-10.8, -8.8, 2.0], [0.22, 0.31, 0.28], 0.0, [4.0, 4.6, 4.0], 0.90);
    PushInstance(Cubes, [10.9, -8.4, 2.9], [0.28, 0.27, 0.36], 0.0, [4.6, 5.1, 5.8], 0.76);
    PushInstance(Cubes, [-3.8, 9.4, 1.0], [0.73, 0.45, 0.10], 0.0, [2.2, 2.2, 2.0], 0.58);
    PushInstance(Cubes, [3.9, 10.2, 1.25], [0.08, 0.46, 0.31], 0.0, [2.5, 2.5, 2.5], 0.55);
    PushInstance(Cubes, [-2.7, -6.5, 1.0], [0.43, 0.45, 0.46], 0.05, [0.7, 0.7, 2.0], 0.38);
    PushInstance(Cubes, [2.7, -6.5, 1.0], [0.43, 0.45, 0.46], 0.05, [0.7, 0.7, 2.0], 0.38);
    PushInstance(Cubes, [0.0, 5.1, 1.2 + Math.sin(Time * 1.15) * 1.05], [0.62, 0.09, 0.07], 0.0, [3.8, 0.42, 2.4], 0.48);
    PushInstance(Cubes, [-4.1 + Math.sin(Time * 0.77) * 2.2, -2.2, 0.75], [0.08, 0.58, 0.42], 0.0, [1.5, 1.5, 1.5], 0.44);
    PushInstance(Cubes, [4.5, -1.4 + Math.cos(Time * 0.61) * 2.7, 0.60], [0.85, 0.48, 0.06], 0.0, [1.2, 1.2, 1.2], 0.36);
    PushInstance(Cubes, [Math.sin(Time * 0.48) * 7.5, 12.7, 0.9], [0.26, 0.55, 0.70], 0.1, [2.4, 1.2, 1.8], 0.28);

    const Balls = [];
    PushInstance(Balls, [-4.0 + Math.sin(Time * 0.72) * 2.0, -0.6, 0.08], [0.82, 0.10, 0.045], 0.0, [1.75, 1.75, 1.75], 0.30);
    PushInstance(Balls, [3.8, 0.2 + Math.cos(Time * 0.66) * 2.0, 0.08], [0.035, 0.34, 0.76], 0.18, [1.75, 1.75, 1.75], 0.20);
    PushInstance(Balls, [-1.8, 7.1, 0.08 + (Math.sin(Time * 1.1) * 0.5 + 0.5) * 0.75], [0.95, 0.50, 0.06], 0.56, [1.72, 1.72, 1.72], 0.15);
    PushInstance(Balls, [2.2 + Math.sin(Time * 0.41) * 1.3, -7.7, 0.08], [0.06, 0.66, 0.37], 0.0, [1.85, 1.85, 1.85], 0.46);
    return {
        Cubes: new Float32Array(Cubes),
        Balls: new Float32Array(Balls),
        CubeCount: Cubes.length / 12,
        BallCount: Balls.length / 12,
    };
}

function ConstructMotionBounds(Time, PreviousTime)
{
    const Positions = (Value) => [
        [[0.0, 5.1, 1.2 + Math.sin(Value * 1.15) * 1.05], [2.15, 0.48, 1.45]],
        [[-4.1 + Math.sin(Value * 0.77) * 2.2, -2.2, 0.75], [1.0, 1.0, 1.0]],
        [[4.5, -1.4 + Math.cos(Value * 0.61) * 2.7, 0.60], [0.85, 0.85, 0.85]],
        [[Math.sin(Value * 0.48) * 7.5, 12.7, 0.9], [1.45, 0.85, 1.15]],
        [[-4.0 + Math.sin(Value * 0.72) * 2.0, -0.6, 1.05], [1.25, 1.25, 1.25]],
        [[3.8, 0.2 + Math.cos(Value * 0.66) * 2.0, 1.05], [1.25, 1.25, 1.25]],
        [[-1.8, 7.1, 1.05 + (Math.sin(Value * 1.1) * 0.5 + 0.5) * 0.75], [1.25, 1.25, 1.25]],
        [[2.2 + Math.sin(Value * 0.41) * 1.3, -7.7, 1.10], [1.35, 1.35, 1.35]],
    ];
    const Current = Positions(Time);
    const Previous = Positions(PreviousTime);
    return Current.map((Entry, Index) =>
    {
        const Position = Entry[0];
        const Half = Entry[1];
        const OldPosition = Previous[Index][0];
        return {
            Minimum: [
                Math.min(Position[0], OldPosition[0]) - Half[0],
                Math.min(Position[1], OldPosition[1]) - Half[1],
                Math.min(Position[2], OldPosition[2]) - Half[2],
                1.0,
            ],
            Maximum: [
                Math.max(Position[0], OldPosition[0]) + Half[0],
                Math.max(Position[1], OldPosition[1]) + Half[1],
                Math.max(Position[2], OldPosition[2]) + Half[2],
                1.0,
            ],
        };
    });
}

async function BringRenderer()
{
    if (!navigator.gpu) throw new Error("This browser does not expose navigator.gpu");
    const Adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!Adapter) throw new Error("No WebGPU adapter is available");
    const Device = await Adapter.requestDevice();
    Device.addEventListener("uncapturederror", (Event) =>
    {
        console.error("WebGPU validation error", Event.error);
        StatusPanel.classList.add("Failed");
        StatusText.textContent = `WebGPU validation: ${Event.error?.message || "unknown error"}`;
    });
    const CanvasContext = PresentationCanvas.getContext("webgpu");
    const CanvasFormat = navigator.gpu.getPreferredCanvasFormat();
    CanvasContext.configure({ device: Device, format: CanvasFormat, alphaMode: "opaque" });

    StatusText.textContent = "Loading scene and transport shaders";
    const [GeometryBinary, RasterSource, ShadowSource, ExtractSource, InjectSource, PropagateSource, ScreenSource, PresentSource, OverlaySource] = await Promise.all([
        LoadBinary(GeometryAddress),
        LoadText("LPVRaster.wgsl?revision=6"),
        LoadText("CSMShadow.wgsl?revision=6"),
        LoadText("LPVExtract.wgsl?revision=6"),
        LoadText("LPVInject.wgsl?revision=6"),
        LoadText("LPVPropagate.wgsl?revision=6"),
        LoadText("LPVSSGI.wgsl?revision=6"),
        LoadText("LPVPresent.wgsl?revision=6"),
        LoadText("LPVOverlay.wgsl?revision=6"),
    ]);
    const Geometry = DecodeGeometry(GeometryBinary);
    const Cube = ConstructCube();

    const RasterShader = Device.createShaderModule({ label: "LPV scene raster", code: RasterSource });
    const ShadowShader = Device.createShaderModule({ label: "Stabilized cascade shadows", code: ShadowSource });
    const ExtractShader = Device.createShaderModule({ label: "RSM surfel extraction", code: ExtractSource });
    const InjectShader = Device.createShaderModule({ label: "LPV scatter injection", code: InjectSource });
    const PropagateShader = Device.createShaderModule({ label: "LPV propagation", code: PropagateSource });
    const ScreenShader = Device.createShaderModule({ label: "Screen GI and GTAO", code: ScreenSource });
    const PresentShader = Device.createShaderModule({ label: "LPV presentation", code: PresentSource });
    const OverlayShader = Device.createShaderModule({ label: "Transient surfel overlay", code: OverlaySource });
    await Promise.all([
        ValidateShader(RasterShader, "LPVRaster.wgsl"),
        ValidateShader(ShadowShader, "CSMShadow.wgsl"),
        ValidateShader(ExtractShader, "LPVExtract.wgsl"),
        ValidateShader(InjectShader, "LPVInject.wgsl"),
        ValidateShader(PropagateShader, "LPVPropagate.wgsl"),
        ValidateShader(ScreenShader, "LPVSSGI.wgsl"),
        ValidateShader(PresentShader, "LPVPresent.wgsl"),
        ValidateShader(OverlayShader, "LPVOverlay.wgsl"),
    ]);

    const VertexLayout = [
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

    const CameraRasterProgram = Device.createRenderPipeline({
        label: "Primary dynamic G-buffer",
        layout: "auto",
        vertex: { module: RasterShader, entryPoint: "CameraVertex", buffers: VertexLayout },
        fragment: {
            module: RasterShader,
            entryPoint: "CameraFragment",
            targets: [{ format: "rgba16float" }, { format: "rgba16float" }, { format: "rgba8unorm" }],
        },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });
    const RsmProgram = Device.createRenderPipeline({
        label: "Reflective shadow map",
        layout: "auto",
        vertex: { module: RasterShader, entryPoint: "RsmVertex", buffers: VertexLayout },
        fragment: {
            module: RasterShader,
            entryPoint: "RsmFragment",
            targets: [{ format: "rgba16float" }, { format: "rgba16float" }, { format: "rgba8unorm" }],
        },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: {
            format: "depth32float",
            depthWriteEnabled: true,
            depthCompare: "less",
            depthBias: 1,
            depthBiasSlopeScale: 1.35,
        },
    });
    const ShadowProgram = Device.createRenderPipeline({
        label: "Three stabilized cascade shadows",
        layout: "auto",
        vertex: { module: ShadowShader, entryPoint: "ShadowVertex", buffers: VertexLayout },
        primitive: { topology: "triangle-list", cullMode: "back", frontFace: "ccw" },
        depthStencil: {
            format: "depth32float",
            depthWriteEnabled: true,
            depthCompare: "less",
            depthBias: 2,
            depthBiasSlopeScale: 1.5,
        },
    });
    const ExtractProgram = Device.createComputePipeline({
        label: "Extract stable blue-noise RSM candidates",
        layout: "auto",
        compute: { module: ExtractShader, entryPoint: "ExtractMain" },
    });
    const ClearReservoirProgram = Device.createComputePipeline({
        label: "Clear stable LPV reservoirs",
        layout: "auto",
        compute: { module: InjectShader, entryPoint: "ClearReservoirs" },
    });
    const ClaimSurfelProgram = Device.createComputePipeline({
        label: "Claim one stable surfel reservoir per LPV cell",
        layout: "auto",
        compute: { module: InjectShader, entryPoint: "ClaimSurfels" },
    });
    const InjectSurfelProgram = Device.createComputePipeline({
        label: "Trilinear selected-surface injection",
        layout: "auto",
        compute: { module: InjectShader, entryPoint: "InjectSelectedSurfels" },
    });
    const InjectCameraProgram = Device.createComputePipeline({
        label: "Inject camera blockers",
        layout: "auto",
        compute: { module: InjectShader, entryPoint: "InjectCameraBlockers" },
    });
    const NormalizeProgram = Device.createComputePipeline({
        label: "Normalize and reproject persistent LPV history",
        layout: "auto",
        compute: { module: InjectShader, entryPoint: "NormalizeMain" },
    });
    const DilateBlockerProgram = Device.createComputePipeline({
        label: "Dilate near-cascade directional blockers",
        layout: "auto",
        compute: { module: InjectShader, entryPoint: "DilateBlockersMain" },
    });
    const PropagateProgram = Device.createComputePipeline({
        label: "Propagate cascaded radiance",
        layout: "auto",
        compute: { module: PropagateShader, entryPoint: "PropagateMain" },
    });
    const ScreenProgram = Device.createComputePipeline({
        label: "Short-range screen GI and GTAO",
        layout: "auto",
        compute: { module: ScreenShader, entryPoint: "ScreenMain" },
    });
    const PresentProgram = Device.createRenderPipeline({
        label: "Resolve dynamic GI",
        layout: "auto",
        vertex: { module: PresentShader, entryPoint: "FullscreenVertex" },
        fragment: { module: PresentShader, entryPoint: "PresentFragment", targets: [{ format: CanvasFormat }] },
        primitive: { topology: "triangle-list" },
    });
    const OverlayProgram = Device.createRenderPipeline({
        label: "Expose transient surfels",
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
        depthStencil: { format: "depth24plus", depthWriteEnabled: false, depthCompare: "less-equal" },
    });

    const FrameUniform = CreateBuffer(
        Device,
        "Dynamic GI frame uniforms",
        FrameUniformBytes,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    );
    const ShadowUniforms = [0, 1, 2].map((Index) => CreateBuffer(
        Device,
        `Shadow cascade ${Index} uniforms`,
        64,
        GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    ));
    const VertexUsage = GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST;
    // Static mesh data is uploaded with queue.writeBuffer, which requires COPY_DST.
    const IndexUsage = GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST;
    const BallVertexBuffer = CreateBuffer(Device, "ShaderBall vertices", Geometry.Vertices, VertexUsage);
    const BallIndexBuffer = CreateBuffer(Device, "ShaderBall indices", Geometry.Indices, IndexUsage);
    const CubeVertexBuffer = CreateBuffer(Device, "World box vertices", Cube.Vertices, VertexUsage);
    const CubeIndexBuffer = CreateBuffer(Device, "World box indices", Cube.Indices, IndexUsage);
    const MaximumCubeInstances = 32;
    const MaximumBallInstances = 8;
    const CubeInstanceBuffer = CreateBuffer(Device, "Dynamic world box instances", MaximumCubeInstances * 48, VertexUsage);
    const BallInstanceBuffer = CreateBuffer(Device, "Dynamic ShaderBall instances", MaximumBallInstances * 48, VertexUsage);

    const SurfelBuffer = CreateBuffer(
        Device,
        "Transient RSM surfels",
        SurfelCount * 64,
        GPUBufferUsage.STORAGE,
    );
    const AtomicBuffer = CreateBuffer(
        Device,
        "LPV fixed-point injection",
        VolumeCellCount * 19 * 4,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const ReservoirBuffer = CreateBuffer(
        Device,
        "Stable per-cell surfel reservoirs",
        VolumeCellCount * 4,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const VolumeBytes = VolumeCellCount * 48;
    const MomentBytes = VolumeCellCount * 8;
    const BlockerVolumeBytes = VolumeCellCount * 32;
    const InjectionVolume = CreateBuffer(
        Device,
        "Temporally filtered LPV source radiance",
        VolumeBytes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const SourceHistoryVolume = CreateBuffer(
        Device,
        "Previous stable LPV source field",
        VolumeBytes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const PreviousSourceMoments = CreateBuffer(
        Device,
        "Previous LPV source moments",
        MomentBytes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const CurrentSourceMoments = CreateBuffer(
        Device,
        "Current LPV source moments",
        MomentBytes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    );
    const RawBlockerVolume = CreateBuffer(Device, "Raw six-face blockers", BlockerVolumeBytes, GPUBufferUsage.STORAGE);
    const BlockerVolume = CreateBuffer(Device, "Dilated six-face blockers", BlockerVolumeBytes, GPUBufferUsage.STORAGE);
    const HistoryVolume = CreateBuffer(
        Device,
        "Persistent reprojected LPV history",
        VolumeBytes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    );
    const PropagationVolumes = [0, 1].map((Index) => CreateBuffer(
        Device,
        `LPV propagation ${Index}`,
        VolumeBytes,
        GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    ));

    const RsmUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
    const RsmPosition = Device.createTexture({
        label: "RSM world positions",
        size: [RsmResolution, RsmResolution],
        format: "rgba16float",
        usage: RsmUsage,
    });
    const RsmNormal = Device.createTexture({
        label: "RSM normals and flux",
        size: [RsmResolution, RsmResolution],
        format: "rgba16float",
        usage: RsmUsage,
    });
    const RsmAlbedo = Device.createTexture({
        label: "RSM materials",
        size: [RsmResolution, RsmResolution],
        format: "rgba8unorm",
        usage: RsmUsage,
    });
    const RsmDepth = Device.createTexture({
        label: "GI-only RSM depth",
        size: [RsmResolution, RsmResolution],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const CsmDepth = Device.createTexture({
        label: "Three stabilized direct-shadow cascades",
        size: [ShadowResolution, ShadowResolution, 3],
        format: "depth32float",
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });
    const CsmArrayView = CsmDepth.createView({ dimension: "2d-array", baseArrayLayer: 0, arrayLayerCount: 3 });
    const CsmLayerViews = [0, 1, 2].map((Layer) => CsmDepth.createView({
        dimension: "2d",
        baseArrayLayer: Layer,
        arrayLayerCount: 1,
    }));
    const ShadowComparison = Device.createSampler({ compare: "less-equal", minFilter: "linear", magFilter: "linear" });
    const LinearSampler = Device.createSampler({ minFilter: "linear", magFilter: "linear" });

    const CameraRasterGroup = Device.createBindGroup({
        layout: CameraRasterProgram.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: FrameUniform } }],
    });
    const RsmGroup = Device.createBindGroup({
        layout: RsmProgram.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: FrameUniform } }],
    });
    const ShadowGroups = ShadowUniforms.map((Uniform, Cascade) => Device.createBindGroup({
        label: `Shadow cascade ${Cascade} group`,
        layout: ShadowProgram.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: Uniform } }],
    }));
    const ExtractGroup = Device.createBindGroup({
        layout: ExtractProgram.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: FrameUniform } },
            { binding: 1, resource: RsmPosition.createView() },
            { binding: 2, resource: RsmNormal.createView() },
            { binding: 3, resource: RsmAlbedo.createView() },
            { binding: 4, resource: { buffer: SurfelBuffer } },
        ],
    });
    const ClearReservoirGroup = Device.createBindGroup({
        layout: ClearReservoirProgram.getBindGroupLayout(0),
        entries: [{ binding: 8, resource: { buffer: ReservoirBuffer } }],
    });
    const ClaimSurfelGroup = Device.createBindGroup({
        layout: ClaimSurfelProgram.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: FrameUniform } },
            { binding: 1, resource: { buffer: SurfelBuffer } },
            { binding: 2, resource: { buffer: AtomicBuffer } },
            { binding: 8, resource: { buffer: ReservoirBuffer } },
        ],
    });
    const InjectSurfelGroup = Device.createBindGroup({
        layout: InjectSurfelProgram.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: FrameUniform } },
            { binding: 1, resource: { buffer: SurfelBuffer } },
            { binding: 2, resource: { buffer: AtomicBuffer } },
            { binding: 8, resource: { buffer: ReservoirBuffer } },
        ],
    });
    const NormalizeGroup = Device.createBindGroup({
        layout: NormalizeProgram.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: FrameUniform } },
            { binding: 2, resource: { buffer: AtomicBuffer } },
            { binding: 5, resource: { buffer: InjectionVolume } },
            { binding: 6, resource: { buffer: RawBlockerVolume } },
            { binding: 7, resource: { buffer: PropagationVolumes[0] } },
            { binding: 9, resource: { buffer: HistoryVolume } },
            { binding: 11, resource: { buffer: SourceHistoryVolume } },
            { binding: 12, resource: { buffer: PreviousSourceMoments } },
            { binding: 13, resource: { buffer: CurrentSourceMoments } },
        ],
    });
    const DilateBlockerGroup = Device.createBindGroup({
        layout: DilateBlockerProgram.getBindGroupLayout(0),
        entries: [
            { binding: 6, resource: { buffer: RawBlockerVolume } },
            { binding: 10, resource: { buffer: BlockerVolume } },
        ],
    });
    const PropagateGroups = [
        Device.createBindGroup({
            layout: PropagateProgram.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: FrameUniform } },
                { binding: 1, resource: { buffer: InjectionVolume } },
                { binding: 2, resource: { buffer: BlockerVolume } },
                { binding: 3, resource: { buffer: PropagationVolumes[0] } },
                { binding: 4, resource: { buffer: PropagationVolumes[1] } },
            ],
        }),
        Device.createBindGroup({
            layout: PropagateProgram.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: FrameUniform } },
                { binding: 1, resource: { buffer: InjectionVolume } },
                { binding: 2, resource: { buffer: BlockerVolume } },
                { binding: 3, resource: { buffer: PropagationVolumes[1] } },
                { binding: 4, resource: { buffer: PropagationVolumes[0] } },
            ],
        }),
    ];
    const OverlayGroup = Device.createBindGroup({
        layout: OverlayProgram.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: FrameUniform } },
            { binding: 1, resource: { buffer: SurfelBuffer } },
        ],
    });

    let PositionImage = null;
    let NormalImage = null;
    let AlbedoImage = null;
    let DepthImage = null;
    let ScreenGIImages = [null, null];
    let HistoryPositionImages = [null, null];
    let InjectCameraGroup = null;
    let ScreenGroups = [null, null];
    let PresentGroups = [[null, null], [null, null]];
    let PresentationWidth = 0;
    let PresentationHeight = 0;
    let HistoryNumber = 0;

    function DestroyPresentationImages()
    {
        for (const Image of [
            PositionImage,
            NormalImage,
            AlbedoImage,
            DepthImage,
            ...ScreenGIImages,
            ...HistoryPositionImages,
        ])
        {
            if (Image) Image.destroy();
        }
        PositionImage = null;
        NormalImage = null;
        AlbedoImage = null;
        DepthImage = null;
        ScreenGIImages = [null, null];
        HistoryPositionImages = [null, null];
    }

    function ResizePresentation()
    {
        const RequestedScale = Number(RenderScale.value) * 0.01;
        const PixelRatio = Math.min((window.devicePixelRatio || 1.0) * RequestedScale, 2.0);
        const Width = Math.max(1, Math.min(1920, Math.round(PresentationCanvas.clientWidth * PixelRatio)));
        const Height = Math.max(1, Math.min(1080, Math.round(PresentationCanvas.clientHeight * PixelRatio)));
        if (Width === PresentationWidth && Height === PresentationHeight) return;
        PresentationWidth = Width;
        PresentationHeight = Height;
        PresentationCanvas.width = Width;
        PresentationCanvas.height = Height;
        DestroyPresentationImages();

        const ColourUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
        PositionImage = Device.createTexture({ label: "Primary positions", size: [Width, Height], format: "rgba16float", usage: ColourUsage });
        NormalImage = Device.createTexture({ label: "Primary normals", size: [Width, Height], format: "rgba16float", usage: ColourUsage });
        AlbedoImage = Device.createTexture({ label: "Primary materials", size: [Width, Height], format: "rgba8unorm", usage: ColourUsage });
        DepthImage = Device.createTexture({
            label: "Primary depth",
            size: [Width, Height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        const HalfWidth = Math.max(1, Math.ceil(Width / 2));
        const HalfHeight = Math.max(1, Math.ceil(Height / 2));
        const HistoryUsage = GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING;
        ScreenGIImages = [0, 1].map((Index) => Device.createTexture({
            label: `Screen GI history ${Index}`,
            size: [HalfWidth, HalfHeight],
            format: "rgba16float",
            usage: HistoryUsage,
        }));
        HistoryPositionImages = [0, 1].map((Index) => Device.createTexture({
            label: `Screen position history ${Index}`,
            size: [HalfWidth, HalfHeight],
            format: "rgba16float",
            usage: HistoryUsage,
        }));
        InjectCameraGroup = Device.createBindGroup({
            layout: InjectCameraProgram.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: FrameUniform } },
                { binding: 2, resource: { buffer: AtomicBuffer } },
                { binding: 3, resource: PositionImage.createView() },
                { binding: 4, resource: NormalImage.createView() },
            ],
        });
        ScreenGroups = [0, 1].map((Previous) =>
        {
            const Current = 1 - Previous;
            return Device.createBindGroup({
                layout: ScreenProgram.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: { buffer: FrameUniform } },
                    { binding: 1, resource: PositionImage.createView() },
                    { binding: 2, resource: NormalImage.createView() },
                    { binding: 3, resource: AlbedoImage.createView() },
                    { binding: 4, resource: CsmArrayView },
                    { binding: 5, resource: ScreenGIImages[Previous].createView() },
                    { binding: 6, resource: HistoryPositionImages[Previous].createView() },
                    { binding: 7, resource: ScreenGIImages[Current].createView() },
                    { binding: 8, resource: HistoryPositionImages[Current].createView() },
                ],
            });
        });
        PresentGroups = [0, 1].map((VolumeNumber) => [0, 1].map((ScreenNumber) => Device.createBindGroup({
            layout: PresentProgram.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: FrameUniform } },
                { binding: 1, resource: PositionImage.createView() },
                { binding: 2, resource: NormalImage.createView() },
                { binding: 3, resource: AlbedoImage.createView() },
                { binding: 4, resource: CsmArrayView },
                { binding: 5, resource: ShadowComparison },
                { binding: 6, resource: ScreenGIImages[ScreenNumber].createView() },
                { binding: 7, resource: LinearSampler },
                { binding: 8, resource: { buffer: PropagationVolumes[VolumeNumber] } },
                { binding: 9, resource: { buffer: BlockerVolume } },
            ],
        })));
        HistoryNumber = 0;
    }

    let CubeCount = 0;
    let BallCount = 0;
    function UpdateScene(Time)
    {
        const Scene = ConstructSceneInstances(Time);
        CubeCount = Scene.CubeCount;
        BallCount = Scene.BallCount;
        Device.queue.writeBuffer(CubeInstanceBuffer, 0, Scene.Cubes);
        Device.queue.writeBuffer(BallInstanceBuffer, 0, Scene.Balls);
    }

    function EncodeScene(Rendering, Program, Group)
    {
        Rendering.setPipeline(Program);
        Rendering.setBindGroup(0, Group);
        Rendering.setVertexBuffer(0, CubeVertexBuffer);
        Rendering.setVertexBuffer(1, CubeInstanceBuffer);
        Rendering.setIndexBuffer(CubeIndexBuffer, "uint32");
        Rendering.drawIndexed(Cube.Indices.length, CubeCount);
        Rendering.setVertexBuffer(0, BallVertexBuffer);
        Rendering.setVertexBuffer(1, BallInstanceBuffer);
        Rendering.setIndexBuffer(BallIndexBuffer, "uint32");
        Rendering.drawIndexed(Geometry.IndexCount, BallCount);
    }

    let OrbitYaw = 0.66;
    let OrbitPitch = 0.40;
    let OrbitDistance = 20.0;
    let PointerIdentity = null;
    let PointerPosition = [0, 0];
    let WorldTime = 0.0;
    let SunTime = 0.72;
    let LastTimestamp = performance.now();
    let FrameNumber = 0;
    let SimulationPaused = false;
    let PreviousCameraProjection = null;
    let PreviousCascadeOrigins = null;
    let PreviousWorldTime = 0.0;
    let SmoothedEncodeMilliseconds = 0.0;

    function CalculateCamera()
    {
        const Target = [0.0, 1.2, 1.35];
        const CosinePitch = Math.cos(OrbitPitch);
        const Eye = [
            Target[0] + Math.sin(OrbitYaw) * CosinePitch * OrbitDistance,
            Target[1] - Math.cos(OrbitYaw) * CosinePitch * OrbitDistance,
            Target[2] + Math.sin(OrbitPitch) * OrbitDistance,
        ];
        const Forward = Normalise(Subtract(Target, Eye));
        const Right = Normalise(Cross(Forward, [0.0, 0.0, 1.0]));
        const Up = Normalise(Cross(Right, Forward));
        const View = ViewMatrix(Eye, Target, [0.0, 0.0, 1.0]);
        const Projection = PerspectiveProjection(0.78, PresentationWidth / PresentationHeight, 0.08, 120.0);
        return { Eye, Target, Forward, Right, Up, Projection: MultiplyMatrix(Projection, View) };
    }

    function SnappedCascadeOrigin(Center, CellSize)
    {
        const HalfSpan = CellSize * VolumeResolution * 0.5;
        return [
            Math.floor((Center[0] - HalfSpan) / CellSize) * CellSize,
            Math.floor((Center[1] - HalfSpan) / CellSize) * CellSize,
            Math.floor((Center[2] - HalfSpan) / CellSize) * CellSize,
            CellSize,
        ];
    }

    function StabilizedShadowProjection(Camera, SunDirection, NearDistance, FarDistance)
    {
        const Tangent = Math.tan(0.78 * 0.5);
        const Aspect = PresentationWidth / PresentationHeight;
        const HalfHeight = Tangent * FarDistance;
        const HalfWidth = HalfHeight * Aspect;
        const HalfDepth = (FarDistance - NearDistance) * 0.5;
        let Radius = Math.sqrt(HalfWidth * HalfWidth + HalfHeight * HalfHeight + HalfDepth * HalfDepth);
        Radius = Math.ceil(Radius * 16.0) / 16.0;
        let Centre = Add(Camera.Eye, Scale(Camera.Forward, (NearDistance + FarDistance) * 0.5));
        const LightRight = Normalise(Cross([0.0, 0.0, 1.0], SunDirection));
        const LightUp = Normalise(Cross(SunDirection, LightRight));
        const TexelSize = (Radius * 2.0) / ShadowResolution;
        const LightX = Dot(Centre, LightRight);
        const LightY = Dot(Centre, LightUp);
        Centre = Add(Centre, Scale(LightRight, Math.floor(LightX / TexelSize) * TexelSize - LightX));
        Centre = Add(Centre, Scale(LightUp, Math.floor(LightY / TexelSize) * TexelSize - LightY));
        const LightEye = Add(Centre, Scale(SunDirection, Radius + 70.0));
        const View = ViewMatrix(LightEye, Centre, [0.0, 0.0, 1.0]);
        return MultiplyMatrix(
            OrthographicProjection(-Radius, Radius, -Radius, Radius, 0.1, Radius * 2.0 + 140.0),
            View,
        );
    }

    function WriteFrameUniforms(Camera)
    {
        const SunElevation = 0.64 + Math.sin(SunTime * 0.63) * 0.12;
        const SunDirection = Normalise([
            Math.cos(SunTime) * 0.62,
            Math.sin(SunTime) * 0.62,
            SunElevation,
        ]);
        const Warmth = Clamp((0.72 - SunElevation) * 1.8, 0.0, 0.45);
        const SunColour = [1.0, 0.92 - Warmth * 0.25, 0.76 - Warmth * 0.38];
        const LightTarget = [0.0, 0.8, 2.0];
        const LightEye = Add(LightTarget, Scale(SunDirection, 60.0));
        const LightView = ViewMatrix(LightEye, LightTarget, [0.0, 0.0, 1.0]);
        const LightProjection = MultiplyMatrix(
            OrthographicProjection(-RsmWorldSpan * 0.5, RsmWorldSpan * 0.5, -RsmWorldSpan * 0.5, RsmWorldSpan * 0.5, 0.1, 120.0),
            LightView,
        );

        const LookAhead = Add(Camera.Eye, Scale(Camera.Forward, Math.min(OrbitDistance * 0.55, 10.0)));
        const CascadeCenter = [LookAhead[0], LookAhead[1], 4.0];
        const Origins = [
            SnappedCascadeOrigin(CascadeCenter, 0.60),
            SnappedCascadeOrigin(CascadeCenter, 1.60),
            SnappedCascadeOrigin(CascadeCenter, 4.00),
        ];
        const PreviousOrigins = PreviousCascadeOrigins || Origins;
        const ShadowSplits = [10.0, 30.0, 90.0];
        const ShadowMatrices = [
            StabilizedShadowProjection(Camera, SunDirection, 0.08, ShadowSplits[0]),
            StabilizedShadowProjection(Camera, SunDirection, ShadowSplits[0], ShadowSplits[1]),
            StabilizedShadowProjection(Camera, SunDirection, ShadowSplits[1], ShadowSplits[2]),
        ];
        const MotionBounds = ConstructMotionBounds(WorldTime, PreviousWorldTime);
        const Content = new Float32Array(FrameUniformBytes / 4);
        Content.set(Camera.Projection, 0);
        Content.set(PreviousCameraProjection || Camera.Projection, 16);
        Content.set(LightProjection, 32);
        Content.set([...Camera.Eye, FrameNumber], 48);
        Content.set([...Camera.Forward, Math.tan(0.78 * 0.5)], 52);
        Content.set([...Camera.Right, PresentationWidth / PresentationHeight], 56);
        Content.set([...Camera.Up, Number(IndirectGain.value)], 60);
        Content.set([...SunDirection, 3.60], 64);
        Content.set([...SunColour, WorldTime], 68);
        Content.set(Origins[0], 72);
        Content.set(Origins[1], 76);
        Content.set(Origins[2], 80);
        Content.set([PresentationWidth, PresentationHeight, RsmResolution, RsmWorldSpan], 84);
        Content.set([
            Number(DisplayMode.value),
            BlockerField.checked ? 1.0 : 0.0,
            ScreenDetail.checked ? 1.0 : 0.0,
            Number(ShadowFilter.value),
        ], 88);
        Content.set([
            0.91,
            Number(ScreenRadius.value) * 0.1,
            TemporalStability.checked ? 1.0 : 0.0,
            1.0,
        ], 92);
        Content.set([VolumeResolution, SurfelCount, Number(PropagationSteps.value), 0.90], 96);
        Content.set(PreviousOrigins[0], 100);
        Content.set(PreviousOrigins[1], 104);
        Content.set(PreviousOrigins[2], 108);
        Content.set(ShadowMatrices[0], 112);
        Content.set(ShadowMatrices[1], 128);
        Content.set(ShadowMatrices[2], 144);
        Content.set([...ShadowSplits, ShadowResolution], 160);
        for (let BoundNumber = 0; BoundNumber < MotionBounds.length; ++BoundNumber)
        {
            Content.set(MotionBounds[BoundNumber].Minimum, 164 + BoundNumber * 8);
            Content.set(MotionBounds[BoundNumber].Maximum, 168 + BoundNumber * 8);
        }
        Device.queue.writeBuffer(FrameUniform, 0, Content);
        for (let Cascade = 0; Cascade < 3; ++Cascade)
        {
            Device.queue.writeBuffer(ShadowUniforms[Cascade], 0, ShadowMatrices[Cascade]);
        }
        return { Origins };
    }

    function Render(Timestamp)
    {
        ResizePresentation();
        const DeltaSeconds = Math.min((Timestamp - LastTimestamp) * 0.001, 0.05);
        LastTimestamp = Timestamp;
        if (!SimulationPaused)
        {
            if (AnimateWorld.checked) WorldTime += DeltaSeconds;
            if (AnimateSun.checked) SunTime += DeltaSeconds * 0.105;
        }
        FrameNumber += 1;
        UpdateScene(WorldTime);
        const Camera = CalculateCamera();
        const FrameInfo = WriteFrameUniforms(Camera);
        const EncodeStart = performance.now();
        const Commands = Device.createCommandEncoder({ label: "Dynamic open-world GI frame" });

        for (let Cascade = 0; Cascade < 3; ++Cascade)
        {
            const ShadowRendering = Commands.beginRenderPass({
                label: `Rasterize stabilized shadow cascade ${Cascade}`,
                colorAttachments: [],
                depthStencilAttachment: {
                    view: CsmLayerViews[Cascade],
                    depthClearValue: 1.0,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                },
            });
            EncodeScene(ShadowRendering, ShadowProgram, ShadowGroups[Cascade]);
            ShadowRendering.end();
        }

        const RsmRendering = Commands.beginRenderPass({
            label: "Rasterize reflective shadow map",
            colorAttachments: [
                { view: RsmPosition.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" },
                { view: RsmNormal.createView(), clearValue: { r: 0, g: 0, b: 1, a: 0 }, loadOp: "clear", storeOp: "store" },
                { view: RsmAlbedo.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" },
            ],
            depthStencilAttachment: {
                view: RsmDepth.createView(),
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });
        EncodeScene(RsmRendering, RsmProgram, RsmGroup);
        RsmRendering.end();

        const VisibilityRendering = Commands.beginRenderPass({
            label: "Rasterize primary dynamic G-buffer",
            colorAttachments: [
                { view: PositionImage.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" },
                { view: NormalImage.createView(), clearValue: { r: 0, g: 0, b: 1, a: 1 }, loadOp: "clear", storeOp: "store" },
                { view: AlbedoImage.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: "clear", storeOp: "store" },
            ],
            depthStencilAttachment: {
                view: DepthImage.createView(),
                depthClearValue: 1.0,
                depthLoadOp: "clear",
                depthStoreOp: "store",
            },
        });
        EncodeScene(VisibilityRendering, CameraRasterProgram, CameraRasterGroup);
        VisibilityRendering.end();

        const ExtractPass = Commands.beginComputePass({ label: "Extract transient RSM surfels" });
        ExtractPass.setPipeline(ExtractProgram);
        ExtractPass.setBindGroup(0, ExtractGroup);
        ExtractPass.dispatchWorkgroups(Math.ceil(SurfelCount / 64));
        ExtractPass.end();

        const ReservoirClearPass = Commands.beginComputePass({ label: "Clear per-cell surfel reservoirs" });
        ReservoirClearPass.setPipeline(ClearReservoirProgram);
        ReservoirClearPass.setBindGroup(0, ClearReservoirGroup);
        ReservoirClearPass.dispatchWorkgroups(Math.ceil(VolumeCellCount / 64));
        ReservoirClearPass.end();

        const SurfelClaimPass = Commands.beginComputePass({ label: "Select stable per-cell surfel reservoirs" });
        SurfelClaimPass.setPipeline(ClaimSurfelProgram);
        SurfelClaimPass.setBindGroup(0, ClaimSurfelGroup);
        SurfelClaimPass.dispatchWorkgroups(Math.ceil(SurfelCount / 64));
        SurfelClaimPass.end();

        const SurfelInjectionPass = Commands.beginComputePass({ label: "Trilinear selected-surface radiance injection" });
        SurfelInjectionPass.setPipeline(InjectSurfelProgram);
        SurfelInjectionPass.setBindGroup(0, InjectSurfelGroup);
        SurfelInjectionPass.dispatchWorkgroups(Math.ceil(SurfelCount / 64));
        SurfelInjectionPass.end();

        const CameraInjectionPass = Commands.beginComputePass({ label: "Scatter camera-visible blockers" });
        CameraInjectionPass.setPipeline(InjectCameraProgram);
        CameraInjectionPass.setBindGroup(0, InjectCameraGroup);
        CameraInjectionPass.dispatchWorkgroups(Math.ceil(PresentationWidth / 32), Math.ceil(PresentationHeight / 32));
        CameraInjectionPass.end();

        const NormalizePass = Commands.beginComputePass({ label: "Normalize LPV injection" });
        NormalizePass.setPipeline(NormalizeProgram);
        NormalizePass.setBindGroup(0, NormalizeGroup);
        NormalizePass.dispatchWorkgroups(Math.ceil(VolumeCellCount / 64));
        NormalizePass.end();

        const DilationPass = Commands.beginComputePass({ label: "Dilate near-cascade directional blockers" });
        DilationPass.setPipeline(DilateBlockerProgram);
        DilationPass.setBindGroup(0, DilateBlockerGroup);
        DilationPass.dispatchWorkgroups(Math.ceil(VolumeCellCount / 64));
        DilationPass.end();

        const StepCount = Number(PropagationSteps.value);
        for (let Step = 0; Step < StepCount; ++Step)
        {
            const PropagationPass = Commands.beginComputePass({ label: `LPV propagation step ${Step + 1}` });
            PropagationPass.setPipeline(PropagateProgram);
            PropagationPass.setBindGroup(0, PropagateGroups[Step % 2]);
            PropagationPass.dispatchWorkgroups(Math.ceil(VolumeCellCount / 64));
            PropagationPass.end();
        }
        const PublishedVolume = StepCount % 2;

        const CurrentHistory = 1 - HistoryNumber;
        const ScreenPass = Commands.beginComputePass({ label: "Resolve half-resolution screen GI and GTAO" });
        ScreenPass.setPipeline(ScreenProgram);
        ScreenPass.setBindGroup(0, ScreenGroups[HistoryNumber]);
        ScreenPass.dispatchWorkgroups(
            Math.ceil(Math.ceil(PresentationWidth / 2) / 8),
            Math.ceil(Math.ceil(PresentationHeight / 2) / 8),
        );
        ScreenPass.end();

        const CanvasView = CanvasContext.getCurrentTexture().createView();
        const PresentationRendering = Commands.beginRenderPass({
            label: "Present dynamic GI",
            colorAttachments: [{
                view: CanvasView,
                clearValue: { r: 0.0, g: 0.0, b: 0.0, a: 1.0 },
                loadOp: "clear",
                storeOp: "store",
            }],
        });
        PresentationRendering.setPipeline(PresentProgram);
        PresentationRendering.setBindGroup(0, PresentGroups[PublishedVolume][CurrentHistory]);
        PresentationRendering.draw(3);
        PresentationRendering.end();

        if (ShowSurfels.checked && Number(DisplayMode.value) === 1)
        {
            const OverlayRendering = Commands.beginRenderPass({
                label: "Expose current RSM surfels",
                colorAttachments: [{ view: CanvasView, loadOp: "load", storeOp: "store" }],
                depthStencilAttachment: { view: DepthImage.createView(), depthReadOnly: true },
            });
            OverlayRendering.setPipeline(OverlayProgram);
            OverlayRendering.setBindGroup(0, OverlayGroup);
            OverlayRendering.draw(6, Math.ceil(SurfelCount / OverlayStride));
            OverlayRendering.end();
        }

        Commands.copyBufferToBuffer(InjectionVolume, 0, SourceHistoryVolume, 0, VolumeBytes);
        Commands.copyBufferToBuffer(CurrentSourceMoments, 0, PreviousSourceMoments, 0, MomentBytes);
        Commands.copyBufferToBuffer(PropagationVolumes[PublishedVolume], 0, HistoryVolume, 0, VolumeBytes);
        Device.queue.submit([Commands.finish()]);
        HistoryNumber = CurrentHistory;
        PreviousCameraProjection = new Float32Array(Camera.Projection);
        PreviousCascadeOrigins = FrameInfo.Origins.map((Origin) => [...Origin]);
        PreviousWorldTime = WorldTime;
        const EncodeMilliseconds = performance.now() - EncodeStart;
        SmoothedEncodeMilliseconds = SmoothedEncodeMilliseconds === 0.0
            ? EncodeMilliseconds
            : SmoothedEncodeMilliseconds * 0.90 + EncodeMilliseconds * 0.10;
        TimingMetric.textContent = `${SmoothedEncodeMilliseconds.toFixed(2)} ms`;
        requestAnimationFrame(Render);
    }

    function UpdateViewLabels()
    {
        PanelLabels.hidden = Number(DisplayMode.value) !== 0;
    }

    DisplayMode.addEventListener("change", UpdateViewLabels);
    ShowSurfels.addEventListener("change", () =>
    {
        if (ShowSurfels.checked && Number(DisplayMode.value) === 0)
        {
            DisplayMode.value = "1";
            UpdateViewLabels();
        }
    });
    PropagationSteps.addEventListener("input", () =>
    {
        const Count = Number(PropagationSteps.value);
        PropagationOutput.textContent = `${Count} ${Count === 1 ? "step" : "steps"}`;
    });
    IndirectGain.addEventListener("input", () =>
    {
        GainOutput.textContent = `${Number(IndirectGain.value).toFixed(2)}×`;
    });
    ScreenRadius.addEventListener("input", () =>
    {
        RadiusOutput.textContent = `${(Number(ScreenRadius.value) * 0.1).toFixed(1)} m`;
    });
    RenderScale.addEventListener("input", () =>
    {
        ScaleOutput.textContent = `${RenderScale.value}%`;
    });
    RenderScale.addEventListener("change", () =>
    {
        PreviousCameraProjection = null;
        PreviousCascadeOrigins = null;
        FrameNumber = 0;
        PresentationWidth = 0;
    });
    PauseButton.addEventListener("click", () =>
    {
        SimulationPaused = !SimulationPaused;
        PauseButton.textContent = SimulationPaused ? "Resume simulation" : "Pause simulation";
    });
    ResetButton.addEventListener("click", () =>
    {
        OrbitYaw = 0.66;
        OrbitPitch = 0.40;
        OrbitDistance = 20.0;
        PreviousCameraProjection = null;
        PreviousCascadeOrigins = null;
        FrameNumber = 0;
        PresentationWidth = 0;
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
        OrbitPitch = Clamp(OrbitPitch + DeltaY * 0.005, 0.08, 1.28);
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
        OrbitDistance = Clamp(OrbitDistance * Math.exp(Event.deltaY * 0.001), 8.0, 34.0);
    }, { passive: false });

    Device.lost.then((Information) =>
    {
        StatusPanel.classList.remove("Ready");
        StatusPanel.classList.add("Failed");
        StatusText.textContent = `WebGPU device lost: ${Information.message || Information.reason}`;
    });

    UpdateViewLabels();
    StatusPanel.classList.add("Ready");
    StatusText.textContent = "WebGPU · stabilized CSM + persistent LPV live";
    requestAnimationFrame(Render);
}

BringRenderer().catch((Failure) =>
{
    console.error(Failure);
    StatusPanel.classList.add("Failed");
    StatusText.textContent = "WebGPU could not start";
    CanvasError.hidden = false;
    CanvasError.querySelector("strong").textContent = "WebGPU startup failed.";
    CanvasError.querySelector("span").textContent = Failure instanceof Error ? Failure.message : String(Failure);
});
