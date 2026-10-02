import { MATERIALS, PRIMITIVES } from "./SceneDefinition.mjs";

const Canvas = document.getElementById("PresentationCanvas");
const ErrorPanel = document.getElementById("CanvasError");
const StatusText = document.getElementById("StatusText");
const DisplayMode = document.getElementById("DisplayMode");
const RayCount = document.getElementById("RayCount");
const RayOutput = document.getElementById("RayOutput");
const GiIntensity = document.getElementById("GiIntensity");
const GiOutput = document.getElementById("GiOutput");
const TraceDistance = document.getElementById("TraceDistance");
const DistanceOutput = document.getElementById("DistanceOutput");
const SunStrength = document.getElementById("SunStrength");
const SunOutput = document.getElementById("SunOutput");
const AnimateSun = document.getElementById("AnimateSun");
const ResetCamera = document.getElementById("ResetCamera");
const RayMetric = document.getElementById("RayMetric");
const NavModes = [...document.querySelectorAll(".NavMode")];

const State = {
    yaw: 0.28,
    pitch: 0.22,
    distance: 18.5,
    target: [0.0, 1.7, -0.25],
    dragging: false,
    pointerX: 0,
    pointerY: 0,
};

function clamp(value, minimum, maximum)
{
    return Math.min(maximum, Math.max(minimum, value));
}

function subtract(a, b)
{
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a, b)
{
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a, b)
{
    return [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ];
}

function normalise(vector)
{
    const length = Math.hypot(vector[0], vector[1], vector[2]);
    return length > 1.0e-8
        ? [vector[0] / length, vector[1] / length, vector[2] / length]
        : [0.0, 1.0, 0.0];
}

function multiplyMatrix(a, b)
{
    const result = new Float32Array(16);
    for (let column = 0; column < 4; ++column)
    {
        for (let row = 0; row < 4; ++row)
        {
            result[column * 4 + row] =
                a[row] * b[column * 4]
                + a[4 + row] * b[column * 4 + 1]
                + a[8 + row] * b[column * 4 + 2]
                + a[12 + row] * b[column * 4 + 3];
        }
    }
    return result;
}

function perspectiveProjection(fieldOfView, aspect, nearDistance, farDistance)
{
    const scale = 1.0 / Math.tan(fieldOfView * 0.5);
    const result = new Float32Array(16);
    result[0] = scale / aspect;
    result[5] = scale;
    result[10] = farDistance / (nearDistance - farDistance);
    result[11] = -1.0;
    result[14] = nearDistance * farDistance / (nearDistance - farDistance);
    return result;
}

function viewMatrix(eye, target, upDirection)
{
    const backward = normalise(subtract(eye, target));
    const right = normalise(cross(upDirection, backward));
    const up = cross(backward, right);
    return new Float32Array([
        right[0], up[0], backward[0], 0.0,
        right[1], up[1], backward[1], 0.0,
        right[2], up[2], backward[2], 0.0,
        -dot(right, eye), -dot(up, eye), -dot(backward, eye), 1.0,
    ]);
}

function cameraEye()
{
    const horizontal = Math.cos(State.pitch) * State.distance;
    return [
        State.target[0] + Math.sin(State.yaw) * horizontal,
        State.target[1] + Math.sin(State.pitch) * State.distance,
        State.target[2] + Math.cos(State.yaw) * horizontal,
    ];
}

function resetCamera()
{
    State.yaw = 0.28;
    State.pitch = 0.22;
    State.distance = 18.5;
    State.target = [0.0, 1.7, -0.25];
}

function pushVertex(vertices, position, normal, material)
{
    vertices.push(
        position[0], position[1], position[2],
        normal[0], normal[1], normal[2],
        material.albedo[0], material.albedo[1], material.albedo[2],
        material.emissive,
    );
}

function appendBox(vertices, indices, primitive, material)
{
    const faces = [
        { normal: [1, 0, 0], corners: [[1,-1,-1],[1,1,-1],[1,-1,1],[1,1,1]] },
        { normal: [-1, 0, 0], corners: [[-1,1,-1],[-1,-1,-1],[-1,1,1],[-1,-1,1]] },
        { normal: [0, 1, 0], corners: [[-1,1,-1],[-1,1,1],[1,1,-1],[1,1,1]] },
        { normal: [0, -1, 0], corners: [[1,-1,-1],[1,-1,1],[-1,-1,-1],[-1,-1,1]] },
        { normal: [0, 0, 1], corners: [[-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1]] },
        { normal: [0, 0, -1], corners: [[-1,1,-1],[1,1,-1],[-1,-1,-1],[1,-1,-1]] },
    ];
    for (const face of faces)
    {
        const base = vertices.length / 10;
        for (const corner of face.corners)
        {
            pushVertex(vertices, [
                primitive.center[0] + corner[0] * primitive.half[0],
                primitive.center[1] + corner[1] * primitive.half[1],
                primitive.center[2] + corner[2] * primitive.half[2],
            ], face.normal, material);
        }
        indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
}

function appendSphere(vertices, indices, primitive, material)
{
    const segments = 32;
    const rings = 20;
    const base = vertices.length / 10;
    for (let ring = 0; ring <= rings; ++ring)
    {
        const theta = ring / rings * Math.PI;
        const y = Math.cos(theta);
        const radial = Math.sin(theta);
        for (let segment = 0; segment <= segments; ++segment)
        {
            const phi = segment / segments * Math.PI * 2.0;
            const normal = [Math.cos(phi) * radial, y, Math.sin(phi) * radial];
            pushVertex(vertices, [
                primitive.center[0] + normal[0] * primitive.radius,
                primitive.center[1] + normal[1] * primitive.radius,
                primitive.center[2] + normal[2] * primitive.radius,
            ], normal, material);
        }
    }
    for (let ring = 0; ring < rings; ++ring)
    {
        for (let segment = 0; segment < segments; ++segment)
        {
            const a = base + ring * (segments + 1) + segment;
            const b = a + segments + 1;
            indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
    }
}

function createSceneGeometry()
{
    const vertices = [];
    const indices = [];
    for (const primitive of PRIMITIVES)
    {
        const material = MATERIALS[primitive.material];
        if (primitive.type === "sphere") appendSphere(vertices, indices, primitive, material);
        else appendBox(vertices, indices, primitive, material);
    }
    return {
        vertices: new Float32Array(vertices),
        indices: new Uint32Array(indices),
    };
}

async function loadText(name)
{
    const response = await fetch(name, { cache: "no-store" });
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.text();
}

async function loadBinary(name)
{
    const response = await fetch(name);
    if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
    return response.arrayBuffer();
}

function decodeGlobalSdf(content)
{
    const view = new DataView(content);
    if (view.byteLength < 64 || view.getUint32(0, true) !== 0x31464453)
        throw new Error("GlobalSDF.bin is not an SDF1 stream");
    if (view.getUint32(4, true) !== 1)
        throw new Error("Unsupported global SDF version");
    const dimensions = [view.getUint32(8, true), view.getUint32(12, true), view.getUint32(16, true)];
    const mipCount = view.getUint32(20, true);
    const minimum = [view.getFloat32(24, true), view.getFloat32(28, true), view.getFloat32(32, true)];
    const maximum = [view.getFloat32(36, true), view.getFloat32(40, true), view.getFloat32(44, true)];
    const materialOffset = view.getUint32(48, true);
    if (view.getUint32(52, true) !== view.byteLength)
        throw new Error("Global SDF byte count is inconsistent");
    const levels = [];
    let offset = 64;
    for (let level = 0; level < mipCount; ++level)
    {
        const levelDimensions = [
            view.getUint32(offset, true),
            view.getUint32(offset + 4, true),
            view.getUint32(offset + 8, true),
        ];
        const byteLength = view.getUint32(offset + 12, true);
        offset += 16;
        levels.push({ dimensions: levelDimensions, bytes: new Uint8Array(content, offset, byteLength) });
        offset += byteLength;
    }
    if (offset !== materialOffset) throw new Error("Global SDF material offset is inconsistent");
    const materialBytes = new Uint8Array(content, materialOffset, dimensions[0] * dimensions[1] * dimensions[2] * 4);
    return { dimensions, mipCount, minimum, maximum, levels, materialBytes };
}

function createBuffer(device, label, contentOrSize, usage)
{
    const byteLength = typeof contentOrSize === "number" ? contentOrSize : contentOrSize.byteLength;
    const buffer = device.createBuffer({ label, size: Math.max(4, Math.ceil(byteLength / 4) * 4), usage });
    if (typeof contentOrSize !== "number") device.queue.writeBuffer(buffer, 0, contentOrSize);
    return buffer;
}

function upload3d(device, texture, bytes, dimensions, mipLevel, bytesPerTexel)
{
    const rowBytes = dimensions[0] * bytesPerTexel;
    const alignedRowBytes = Math.ceil(rowBytes / 256) * 256;
    const packed = new Uint8Array(alignedRowBytes * dimensions[1] * dimensions[2]);
    for (let z = 0; z < dimensions[2]; ++z)
    {
        for (let y = 0; y < dimensions[1]; ++y)
        {
            const source = (z * dimensions[1] + y) * rowBytes;
            const target = (z * dimensions[1] + y) * alignedRowBytes;
            packed.set(bytes.subarray(source, source + rowBytes), target);
        }
    }
    device.queue.writeTexture(
        { texture, mipLevel },
        packed,
        { bytesPerRow: alignedRowBytes, rowsPerImage: dimensions[1] },
        { width: dimensions[0], height: dimensions[1], depthOrArrayLayers: dimensions[2] },
    );
}

async function validateShader(module, label)
{
    if (typeof module.getCompilationInfo !== "function") return;
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((message) => message.type === "error");
    if (errors.length)
    {
        throw new Error(`${label}:\n${errors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`).join("\n")}`);
    }
}

function connectControls()
{
    const syncMode = () =>
    {
        for (const button of NavModes)
            button.classList.toggle("Active", button.dataset.mode === DisplayMode.value);
    };
    const update = () =>
    {
        RayOutput.value = RayCount.value;
        RayMetric.textContent = `${RayCount.value} rays`;
        GiOutput.value = Number(GiIntensity.value).toFixed(2);
        DistanceOutput.value = `${TraceDistance.value} m`;
        SunOutput.value = Number(SunStrength.value).toFixed(1);
    };
    for (const control of [RayCount, GiIntensity, TraceDistance, SunStrength]) control.addEventListener("input", update);
    for (const button of NavModes)
    {
        button.addEventListener("click", () =>
        {
            DisplayMode.value = button.dataset.mode;
            syncMode();
        });
    }
    DisplayMode.addEventListener("change", syncMode);
    ResetCamera.addEventListener("click", resetCamera);
    update();
    syncMode();

    Canvas.addEventListener("pointerdown", (event) =>
    {
        State.dragging = true;
        State.pointerX = event.clientX;
        State.pointerY = event.clientY;
        Canvas.setPointerCapture(event.pointerId);
    });
    Canvas.addEventListener("pointermove", (event) =>
    {
        if (!State.dragging) return;
        const dx = event.clientX - State.pointerX;
        const dy = event.clientY - State.pointerY;
        State.pointerX = event.clientX;
        State.pointerY = event.clientY;
        State.yaw -= dx * 0.006;
        State.pitch = clamp(State.pitch + dy * 0.005, -0.05, 1.15);
    });
    Canvas.addEventListener("pointerup", (event) =>
    {
        State.dragging = false;
        Canvas.releasePointerCapture(event.pointerId);
    });
    Canvas.addEventListener("wheel", (event) =>
    {
        State.distance = clamp(State.distance * Math.exp(event.deltaY * 0.001), 7.0, 31.0);
        event.preventDefault();
    }, { passive: false });
}

async function start()
{
    if (!navigator.gpu) throw new Error("WebGPU is required for the global distance-field demo");
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("No WebGPU adapter is available");
    const device = await adapter.requestDevice();
    const showGpuError = (message) =>
    {
        ErrorPanel.hidden = false;
        ErrorPanel.textContent = message;
    };
    device.addEventListener("uncapturederror", (event) =>
    {
        showGpuError(`WebGPU validation error:\n${event.error?.message || event.error}`);
    });
    device.lost.then((info) =>
    {
        showGpuError(`WebGPU device lost: ${info.message || info.reason}`);
    });

    const context = Canvas.getContext("webgpu");
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format: presentationFormat, alphaMode: "opaque" });

    const [sdfContent, gbufferSource, cacheSource, giSource, presentSource] = await Promise.all([
        loadBinary("GlobalSDF.bin"),
        loadText("GBuffer.wgsl"),
        loadText("RadianceCache.wgsl"),
        loadText("GlobalIllumination.wgsl"),
        loadText("Present.wgsl"),
    ]);
    const sdf = decodeGlobalSdf(sdfContent);
    const geometry = createSceneGeometry();

    const modules = {
        gbuffer: device.createShaderModule({ label: "SDF G-buffer", code: gbufferSource }),
        cache: device.createShaderModule({ label: "Global surface radiance cache", code: cacheSource }),
        gi: device.createShaderModule({ label: "Global SDF GI", code: giSource }),
        present: device.createShaderModule({ label: "SDF GI presentation", code: presentSource }),
    };
    await Promise.all(Object.entries(modules).map(([label, module]) => validateShader(module, label)));

    const vertexBuffer = createBuffer(device, "Static scene vertices", geometry.vertices, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST);
    const indexBuffer = createBuffer(device, "Static scene indices", geometry.indices, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST);
    const cameraBuffer = createBuffer(device, "Camera uniforms", 256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const cacheBuffer = createBuffer(device, "Radiance cache uniforms", 256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const giBuffer = createBuffer(device, "GI uniforms", 256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const presentBuffer = createBuffer(device, "Present uniforms", 256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);

    const distanceTexture = device.createTexture({
        label: "Baked global signed-distance field",
        size: { width: sdf.dimensions[0], height: sdf.dimensions[1], depthOrArrayLayers: sdf.dimensions[2] },
        dimension: "3d",
        format: "r16float",
        mipLevelCount: sdf.mipCount,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    for (let level = 0; level < sdf.levels.length; ++level)
        upload3d(device, distanceTexture, sdf.levels[level].bytes, sdf.levels[level].dimensions, level, 2);

    const materialTexture = device.createTexture({
        label: "Baked global material field",
        size: { width: sdf.dimensions[0], height: sdf.dimensions[1], depthOrArrayLayers: sdf.dimensions[2] },
        dimension: "3d",
        format: "rgba8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    upload3d(device, materialTexture, sdf.materialBytes, sdf.dimensions, 0, 4);

    const surfaceRadianceTexture = device.createTexture({
        label: "Global surface radiance cache",
        size: { width: sdf.dimensions[0], height: sdf.dimensions[1], depthOrArrayLayers: sdf.dimensions[2] },
        dimension: "3d",
        format: "rgba16float",
        usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    const linearSampler = device.createSampler({ minFilter: "linear", magFilter: "linear", mipmapFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", addressModeW: "clamp-to-edge" });
    const nearestSampler = device.createSampler({ minFilter: "nearest", magFilter: "nearest", mipmapFilter: "nearest", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge", addressModeW: "clamp-to-edge" });

    const gbufferPipeline = device.createRenderPipeline({
        label: "Static scene G-buffer",
        layout: "auto",
        vertex: {
            module: modules.gbuffer,
            entryPoint: "VertexMain",
            buffers: [{
                arrayStride: 40,
                attributes: [
                    { shaderLocation: 0, offset: 0, format: "float32x3" },
                    { shaderLocation: 1, offset: 12, format: "float32x3" },
                    { shaderLocation: 2, offset: 24, format: "float32x3" },
                    { shaderLocation: 3, offset: 36, format: "float32" },
                ],
            }],
        },
        fragment: {
            module: modules.gbuffer,
            entryPoint: "FragmentMain",
            targets: [{ format: "rgba16float" }, { format: "rgba16float" }, { format: "rgba8unorm" }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
    });
    const cachePipeline = device.createComputePipeline({ label: "Surface radiance injection", layout: "auto", compute: { module: modules.cache, entryPoint: "ComputeMain" } });
    const giPipeline = device.createComputePipeline({ label: "Global distance-field GI", layout: "auto", compute: { module: modules.gi, entryPoint: "ComputeMain" } });
    const presentPipeline = device.createRenderPipeline({
        label: "SDF GI present",
        layout: "auto",
        vertex: { module: modules.present, entryPoint: "VertexMain" },
        fragment: { module: modules.present, entryPoint: "FragmentMain", targets: [{ format: presentationFormat }] },
        primitive: { topology: "triangle-list" },
    });

    const cameraBindGroup = device.createBindGroup({
        label: "Camera bind group",
        layout: gbufferPipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: cameraBuffer } }],
    });
    const cacheBindGroup = device.createBindGroup({
        label: "Radiance cache bind group",
        layout: cachePipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: cacheBuffer } },
            { binding: 1, resource: distanceTexture.createView() },
            { binding: 2, resource: linearSampler },
            { binding: 3, resource: materialTexture.createView() },
            { binding: 4, resource: nearestSampler },
            { binding: 5, resource: surfaceRadianceTexture.createView() },
        ],
    });

    let width = 0;
    let height = 0;
    let worldPositionTexture;
    let worldNormalTexture;
    let albedoTexture;
    let depthTexture;
    let indirectTexture;
    let giBindGroup;
    let presentBindGroup;

    function resize()
    {
        const pixelRatio = Math.min(globalThis.devicePixelRatio || 1, 1.0);
        const resolutionCap = Math.min(
            1.0,
            1920 / Math.max(1, Canvas.clientWidth * pixelRatio),
            1080 / Math.max(1, Canvas.clientHeight * pixelRatio),
        );
        const nextWidth = Math.max(2, Math.floor(Canvas.clientWidth * pixelRatio * resolutionCap));
        const nextHeight = Math.max(2, Math.floor(Canvas.clientHeight * pixelRatio * resolutionCap));
        if (nextWidth === width && nextHeight === height) return;
        width = nextWidth;
        height = nextHeight;
        Canvas.width = width;
        Canvas.height = height;
        for (const texture of [worldPositionTexture, worldNormalTexture, albedoTexture, depthTexture, indirectTexture]) texture?.destroy();
        const colourUsage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
        worldPositionTexture = device.createTexture({ label: "World position G-buffer", size: [width, height], format: "rgba16float", usage: colourUsage });
        worldNormalTexture = device.createTexture({ label: "World normal G-buffer", size: [width, height], format: "rgba16float", usage: colourUsage });
        albedoTexture = device.createTexture({ label: "Albedo G-buffer", size: [width, height], format: "rgba8unorm", usage: colourUsage });
        depthTexture = device.createTexture({ label: "Scene depth", size: [width, height], format: "depth24plus", usage: GPUTextureUsage.RENDER_ATTACHMENT });
        indirectTexture = device.createTexture({
            label: "Half-resolution SDF indirect",
            size: [Math.ceil(width / 2), Math.ceil(height / 2)],
            format: "rgba16float",
            usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
        });
        giBindGroup = device.createBindGroup({
            label: "SDF GI bind group",
            layout: giPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: giBuffer } },
                { binding: 1, resource: worldPositionTexture.createView() },
                { binding: 2, resource: worldNormalTexture.createView() },
                { binding: 3, resource: distanceTexture.createView() },
                { binding: 4, resource: linearSampler },
                { binding: 5, resource: surfaceRadianceTexture.createView() },
                { binding: 6, resource: indirectTexture.createView() },
            ],
        });
        presentBindGroup = device.createBindGroup({
            label: "Presentation bind group",
            layout: presentPipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: presentBuffer } },
                { binding: 1, resource: worldPositionTexture.createView() },
                { binding: 2, resource: worldNormalTexture.createView() },
                { binding: 3, resource: albedoTexture.createView() },
                { binding: 4, resource: indirectTexture.createView() },
                { binding: 5, resource: linearSampler },
            ],
        });
    }

    const extents = sdf.maximum.map((value, axis) => value - sdf.minimum[axis]);
    const voxelSize = Math.max(...extents.map((value, axis) => value / sdf.dimensions[axis]));
    const startTime = performance.now();
    let lastFrame = startTime;
    let averageMilliseconds = 16.7;
    let statusCounter = 0;

    function render(now)
    {
        resize();
        const elapsed = (now - startTime) * 0.001;
        const eye = cameraEye();
        const projection = perspectiveProjection(Math.PI / 3.05, width / height, 0.08, 70.0);
        const view = viewMatrix(eye, State.target, [0.0, 1.0, 0.0]);
        device.queue.writeBuffer(cameraBuffer, 0, multiplyMatrix(projection, view));

        const sunAngle = AnimateSun.checked ? elapsed * 0.22 : 0.72;
        const lightDirection = normalise([Math.cos(sunAngle) * 0.56, 0.82, Math.sin(sunAngle) * 0.46]);
        const lightColour = [1.0, 0.91, 0.72, 1.0];
        const sunStrength = Number(SunStrength.value);
        const cacheUniforms = new Float32Array(20);
        cacheUniforms.set([...sdf.minimum, 0.0], 0);
        cacheUniforms.set([...sdf.maximum, 0.0], 4);
        cacheUniforms.set([...lightDirection, 0.0], 8);
        cacheUniforms.set(lightColour, 12);
        cacheUniforms.set([sunStrength, 5.5, voxelSize, 0.012], 16);
        device.queue.writeBuffer(cacheBuffer, 0, cacheUniforms);

        const giUniforms = new Float32Array(16);
        giUniforms.set([...sdf.minimum, 0.0], 0);
        giUniforms.set([...sdf.maximum, 0.0], 4);
        giUniforms.set([Number(TraceDistance.value), voxelSize, Number(RayCount.value), 0.0], 8);
        giUniforms.set([0.12, sdf.mipCount - 1, 0.0, 0.0], 12);
        device.queue.writeBuffer(giBuffer, 0, giUniforms);

        const presentUniforms = new Float32Array(16);
        presentUniforms.set([...lightDirection, 0.0], 0);
        presentUniforms.set(lightColour, 4);
        presentUniforms.set([Number(DisplayMode.value), Number(GiIntensity.value), sunStrength, 1.35], 8);
        presentUniforms.set([0.12, 0.025, 5.5, 0.0], 12);
        device.queue.writeBuffer(presentBuffer, 0, presentUniforms);

        const encoder = device.createCommandEncoder({ label: "Global SDF GI frame" });
        const gbufferPass = encoder.beginRenderPass({
            label: "Static scene G-buffer",
            colorAttachments: [
                { view: worldPositionTexture.createView(), clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" },
                { view: worldNormalTexture.createView(), clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" },
                { view: albedoTexture.createView(), clearValue: [0, 0, 0, 0], loadOp: "clear", storeOp: "store" },
            ],
            depthStencilAttachment: { view: depthTexture.createView(), depthClearValue: 1.0, depthLoadOp: "clear", depthStoreOp: "discard" },
        });
        gbufferPass.setPipeline(gbufferPipeline);
        gbufferPass.setBindGroup(0, cameraBindGroup);
        gbufferPass.setVertexBuffer(0, vertexBuffer);
        gbufferPass.setIndexBuffer(indexBuffer, "uint32");
        gbufferPass.drawIndexed(geometry.indices.length);
        gbufferPass.end();

        const cachePass = encoder.beginComputePass({ label: "Inject global surface radiance" });
        cachePass.setPipeline(cachePipeline);
        cachePass.setBindGroup(0, cacheBindGroup);
        cachePass.dispatchWorkgroups(
            Math.ceil(sdf.dimensions[0] / 4),
            Math.ceil(sdf.dimensions[1] / 4),
            Math.ceil(sdf.dimensions[2] / 4),
        );
        cachePass.end();

        const giPass = encoder.beginComputePass({ label: "Trace global SDF indirect" });
        giPass.setPipeline(giPipeline);
        giPass.setBindGroup(0, giBindGroup);
        giPass.dispatchWorkgroups(Math.ceil(Math.ceil(width / 2) / 8), Math.ceil(Math.ceil(height / 2) / 8));
        giPass.end();

        const presentPass = encoder.beginRenderPass({
            label: "Present global SDF GI",
            colorAttachments: [{ view: context.getCurrentTexture().createView(), clearValue: [0.01, 0.015, 0.02, 1], loadOp: "clear", storeOp: "store" }],
        });
        presentPass.setPipeline(presentPipeline);
        presentPass.setBindGroup(0, presentBindGroup);
        presentPass.draw(3);
        presentPass.end();
        device.queue.submit([encoder.finish()]);

        const milliseconds = now - lastFrame;
        lastFrame = now;
        averageMilliseconds += (milliseconds - averageMilliseconds) * 0.08;
        if (++statusCounter % 20 === 0)
        {
            StatusText.textContent = `${averageMilliseconds.toFixed(1)} ms frame · ${Math.ceil(width / 2)}×${Math.ceil(height / 2)} GI · ${geometry.indices.length / 3 | 0} raster triangles`;
        }
        requestAnimationFrame(render);
    }

    connectControls();
    StatusText.textContent = `Loaded ${(sdfContent.byteLength / 1048576).toFixed(2)} MiB baked global field`;
    requestAnimationFrame(render);
}

start().catch((error) =>
{
    console.error(error);
    ErrorPanel.hidden = false;
    ErrorPanel.textContent = error instanceof Error ? error.message : String(error);
});
