//============================================================================================================================================
//                                                             MAIN.JS
//============================================================================================================================================
// 🧩 Showcase host: builds the eagle once, then each frame evaluates the active clip (crossfaded with the previous
//    one), adds spring-driven secondary motion, integrates locomotion (speed / turn rate / altitude / bank), poses
//    the skeleton twice (animation pass, then dynamics pass) and submits the skinning matrices to WebGL2.

import { EagleStructure } from "./EagleStructure.js";
import { PoseSpace, BlendPose, MotionLibrary, MotionOrder } from "./MotionSequence.js";
import { DynamicsSolver } from "./DynamicsSolver.js";
import { RenderExchange } from "./RenderExchange.js";
import { CameraProjection } from "./CameraProjection.js";
import { M4, V3, Quat, DEG, clamp, lerp, smoothstep } from "./MathSpecification.js";

const canvas = document.getElementById("viewport");
const renderer = new RenderExchange(canvas);
const camera = new CameraProjection(canvas);

const buildStart = performance.now();
const eagle = new EagleStructure();
const skeleton = eagle.skeleton;
const buildMs = performance.now() - buildStart;
renderer.UploadGeometry(eagle.geometry, skeleton.count);

const standHeight = -skeleton.BindPosition("footL")[1];       // [m] root → foot joint
const rootHeight = standHeight + 0.0165;                      // toe pads rest on y = 0
const context = { standHeight, ruffle: 0 };

const posePrevious = new PoseSpace(skeleton);
const poseCurrent = new PoseSpace(skeleton);
const poseBlended = new PoseSpace(skeleton);
const poseFinal = new PoseSpace(skeleton);
const dynamics = new DynamicsSolver(skeleton);

const worldMatrices = [], skinningMatrices = [];
for (let i = 0; i < skeleton.count; ++i) { worldMatrices.push(new Float32Array(16)); skinningMatrices.push(new Float32Array(16)); }

//------------------------------------------------------------------------------------------------------------------------
//                                                        SHOW STATE
//------------------------------------------------------------------------------------------------------------------------

const show = {
    clip: "flap",
    previousClip: "flap",
    clipTime: 0,
    previousTime: 0,
    blend: 1.0,
    blendRate: 1.0 / 0.55,
    speed: 1.0,
    paused: false,
    showGround: true,
    showSkeleton: false,
    wireframe: false,
    dynamics: true,
    debugView: 0,
};

const locomotion = {
    position: [0, rootHeight, 0],
    heading: 0.0,
    speed: 0.0,
    altitude: 0.0,
    bank: 0.0,
    pitch: 0.0,
};

const sun = {
    direction: V3.normalize([0.42, 0.62, 0.34]),
    radiance: [5.6, 5.1, 4.4],
    sky: [0.34, 0.44, 0.62],
    ground: [0.085, 0.085, 0.065],
    exposure: 1.15,
};

function SelectClip(name)
{
    if (!MotionLibrary[name] || name === show.clip) return;
    show.previousClip = show.clip;
    show.previousTime = show.clipTime;
    show.clip = name;
    show.clipTime = 0;
    show.blend = 0;
    for (const button of document.querySelectorAll("[data-clip]"))
        button.classList.toggle("active", button.dataset.clip === name);
    document.getElementById("clipName").textContent = MotionLibrary[name].name;
    document.getElementById("clipDetail").textContent = MotionLibrary[name].detail;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        FRAME LOOP
//------------------------------------------------------------------------------------------------------------------------

let lastTime = performance.now() * 0.001;
let smoothedFps = 60;
const lineData = new Float32Array(skeleton.count * 12);

function Frame()
{
    const now = performance.now() * 0.001;
    let dt = clamp(now - lastTime, 0.0, 0.1);
    lastTime = now;
    smoothedFps = lerp(smoothedFps, 1.0 / Math.max(dt, 1e-4), 0.08);

    const step = show.paused ? 0.0 : dt * show.speed;
    show.clipTime += step;
    show.previousTime += step;
    show.blend = Math.min(1.0, show.blend + dt * show.blendRate);

    // ── Clip evaluation + crossfade ───────────────────────────────────────────────────────────────────────────────────
    context.ruffle = 0;
    poseCurrent.Reset();
    MotionLibrary[show.clip].Apply(poseCurrent, show.clipTime, context);
    const ruffleCurrent = context.ruffle;

    let active = poseCurrent;
    if (show.blend < 1.0)
    {
        context.ruffle = 0;
        posePrevious.Reset();
        MotionLibrary[show.previousClip].Apply(posePrevious, show.previousTime, context);
        const eased = smoothstep(show.blend);
        BlendPose(posePrevious, poseCurrent, eased, poseBlended);
        active = poseBlended;
        context.ruffle = lerp(context.ruffle, ruffleCurrent, eased);
    }
    else context.ruffle = ruffleCurrent;

    // ── Pass 1: animated pose ─────────────────────────────────────────────────────────────────────────────────────────
    skeleton.Pose(active.rotation, active.translation, worldMatrices, skinningMatrices);

    // ── Pass 2: spring-driven secondary motion layered on top ─────────────────────────────────────────────────────────
    dynamics.enabled = show.dynamics;
    const offsets = dynamics.Solve(worldMatrices, Math.max(step, 1e-4), context.ruffle, show.clipTime);
    for (let i = 0; i < skeleton.count; ++i)
    {
        const base = active.rotation[i];
        const extra = offsets[i];
        poseFinal.rotation[i] = extra ? (base ? Quat.multiply(base, extra) : extra) : base;
        poseFinal.translation[i] = active.translation[i];
    }
    skeleton.Pose(poseFinal.rotation, poseFinal.translation, worldMatrices, skinningMatrices);
    renderer.UploadSkinning(skinningMatrices);

    // ── Locomotion integration ────────────────────────────────────────────────────────────────────────────────────────
    const request = active.locomotion;
    const follow = (current, target, rate) => current + (target - current) * (1.0 - Math.exp(-dt * rate));
    locomotion.speed = follow(locomotion.speed, request.speed, 1.1);
    locomotion.altitude = follow(locomotion.altitude, request.altitude, 0.55);
    locomotion.bank = follow(locomotion.bank, request.bank, 1.6);
    locomotion.pitch = follow(locomotion.pitch, request.pitch, 1.6);
    locomotion.heading += request.turnRate * step;
    const forward = [Math.sin(locomotion.heading), 0, Math.cos(locomotion.heading)];
    locomotion.position[0] += forward[0] * locomotion.speed * step;
    locomotion.position[2] += forward[2] * locomotion.speed * step;
    locomotion.position[1] = rootHeight + locomotion.altitude;

    const orientation = Quat.multiply(
        Quat.multiply(Quat.fromAxisAngle([0, 1, 0], locomotion.heading), Quat.fromAxisAngle([0, 0, 1], locomotion.bank * DEG)),
        Quat.fromAxisAngle([1, 0, 0], locomotion.pitch * DEG));
    const model = M4.compose(locomotion.position, orientation);

    // ── Camera + light ────────────────────────────────────────────────────────────────────────────────────────────────
    const focus = M4.transformPoint(model, [0, 0.18, 0.06]);
    camera.Update(dt, focus);
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const { viewProjection, inverseViewProjection } = camera.Matrices(aspect);

    const shadowExtent = 1.5;
    const lightTarget = focus;
    const lightEye = V3.add(lightTarget, V3.scale(sun.direction, 8.0));
    const lightView = M4.lookAt(lightEye, lightTarget, [0, 1, 0]);
    const lightProjection = M4.orthographic(-shadowExtent, shadowExtent, -shadowExtent, shadowExtent, 0.5, 18.0);
    const lightViewProjection = M4.multiply(lightProjection, lightView);

    if (show.showSkeleton)
    {
        let cursor = 0;
        for (let i = 1; i < skeleton.count; ++i)
        {
            const p = skeleton.parents[i];
            if (p < 0) continue;
            const a = M4.transformPoint(model, [worldMatrices[p][12], worldMatrices[p][13], worldMatrices[p][14]]);
            const b = M4.transformPoint(model, [worldMatrices[i][12], worldMatrices[i][13], worldMatrices[i][14]]);
            const feather = skeleton.names[i].startsWith("primary") || skeleton.names[i].startsWith("secondary")
                || skeleton.names[i].startsWith("rectrix") || skeleton.names[i].startsWith("alulaQuill");
            const colour = feather ? [0.25, 0.55, 0.95] : [1.0, 0.75, 0.15];
            lineData.set([a[0], a[1], a[2], colour[0], colour[1], colour[2], b[0], b[1], b[2], colour[0], colour[1], colour[2]], cursor);
            cursor += 12;
        }
        renderer.UploadLines(lineData.subarray(0, cursor));
    }

    renderer.Render({
        model, viewProjection, inverseViewProjection, lightViewProjection,
        cameraPosition: camera.position,
        sunDirection: sun.direction, sunRadiance: sun.radiance, skyRadiance: sun.sky, groundRadiance: sun.ground,
        exposure: sun.exposure, time: now,
        showGround: show.showGround, showSkeleton: show.showSkeleton, wireframe: show.wireframe,
        debugView: show.debugView,
    });

    document.getElementById("readout").textContent =
        `${smoothedFps.toFixed(0)} fps · ${(eagle.geometry.triangleCount / 1000).toFixed(0)}k triangles · ${skeleton.count} joints`
        + ` · ${locomotion.speed.toFixed(1)} m/s · alt ${locomotion.altitude.toFixed(1)} m`;

    requestAnimationFrame(Frame);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                        UI WIRING
//------------------------------------------------------------------------------------------------------------------------

for (const button of document.querySelectorAll("[data-clip]"))
    button.addEventListener("click", () => SelectClip(button.dataset.clip));

document.addEventListener("keydown", (e) =>
{
    const index = "123456".indexOf(e.key);
    if (index >= 0) SelectClip(MotionOrder[index]);
    if (e.code === "Space") { show.paused = !show.paused; e.preventDefault(); }
    if (e.key === "o" || e.key === "O") camera.autoOrbit = !camera.autoOrbit;
});

const speedSlider = document.getElementById("speed");
speedSlider.addEventListener("input", () =>
{
    show.speed = parseFloat(speedSlider.value);
    document.getElementById("speedValue").textContent = `${show.speed.toFixed(2)}×`;
});

const Toggle = (id, key, onChange) =>
{
    const element = document.getElementById(id);
    element.addEventListener("change", () =>
    {
        show[key] = element.checked;
        if (onChange) onChange(element.checked);
    });
    element.checked = show[key];
};
Toggle("toggleGround", "showGround");
Toggle("toggleSkeleton", "showSkeleton");
Toggle("toggleWireframe", "wireframe");
Toggle("toggleDynamics", "dynamics", () => dynamics.Reset());

document.getElementById("debugView").addEventListener("change", (e) => { show.debugView = parseInt(e.target.value, 10); });
document.getElementById("autoOrbit").addEventListener("change", (e) => { camera.autoOrbit = e.target.checked; });
document.getElementById("frameHead").addEventListener("click", () => camera.Frame(0.55, 2.1, 0.12));
document.getElementById("frameBody").addEventListener("click", () => camera.Frame(2.4, 2.3, 0.16));
document.getElementById("frameWing").addEventListener("click", () => camera.Frame(3.6, 3.14, 0.42));

document.getElementById("buildInfo").textContent =
    `${(eagle.geometry.vertexCount / 1000).toFixed(1)}k vertices · ${(eagle.geometry.triangleCount / 1000).toFixed(0)}k triangles`
    + ` · ${skeleton.count} joints · built procedurally in ${buildMs.toFixed(0)} ms`;

document.getElementById("clipName").textContent = MotionLibrary[show.clip].name;
document.getElementById("clipDetail").textContent = MotionLibrary[show.clip].detail;
document.querySelector(`[data-clip="${show.clip}"]`).classList.add("active");
requestAnimationFrame(Frame);
