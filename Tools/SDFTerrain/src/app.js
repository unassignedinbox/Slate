//==========================================================================================
// Slate SDF Terrain Studio — application shell.
//
// Boot order matters and is deliberate:
//   device → engine.configure → engine.setTargetSize → compile graph → build pipelines →
//   bake → run.
// Pipelines are built after the first compile so the graph's generated WGSL is what the solver
// actually runs, and the bake that follows writes the initial volume the first frame samples.
// A graph edit re-enters that sequence at "compile", reusing every GPU resource it can.
//==========================================================================================

import { createDevice, attachDeviceDiagnostics } from './kernel/device.js';
import { TerrainEngine } from './kernel/terrainEngine.js';
import { defaultSettings, QUALITY_PRESETS, WORLD_EXTENT } from './kernel/uniforms.js';
import { compileGraph } from './kernel/graph/compiler.js';
import { presetDocument, PRESETS, History, createDocument } from './kernel/graph/doc.js';
import { NODE_LIBRARY, NODE_BY_ID, SOCKET_COLORS } from './kernel/graph/nodes.js';
import { Viewport } from './ui/viewport.js';
import { GraphEditor } from './ui/graph.js';
import { Inspector } from './ui/inspector.js';
import { buildOutliner, buildPresets, updateBalance, pushDiagnostic } from './ui/outliner.js';
import { toast, showDialog, hideDialog, setOverlayBusy, contextMenu, formatNumber, formatModelTime } from './ui/shell.js';

const state = {
    settings: defaultSettings(),
    mode: 'split',
    running: true,
    step: 0,
    sample: 0,
    frames: 0,
    fps: 0,
    lastFrameTime: performance.now(),
    cpuMs: 0,
    gpuMs: 0,
    stats: {},
    diagnostics: [],
    preset: 'canyon',
    pendingBake: false,
    pendingCompile: false,
    busy: false,
    bakeStride: 1,
    visibility: { showTerrain: true, showWater: true, showParticles: true, showSky: true, showGrid: false },
};

let device = null;
let engine = null;
let viewport = null;
let graph = null;
let history = null;
let inspector = null;
let context = null;
let compiled = null;
let cameraMoved = true;
let lastCompileError = null;

//------------------------------------------------------------------------------------------
// Derived quantities. The UI edits human units (mm/h, degrees); the solver wants SI.
//------------------------------------------------------------------------------------------
function deriveSettings()
{
    const settings = state.settings;
    settings.rain = settings.rainMm / 3.6e6;
    settings.evaporation = 2.6e-6 * settings.evapScale;
    settings.wind.direction = settings.wind.windDeg * Math.PI / 180;
    const preset = QUALITY_PRESETS[settings.quality];
    settings.render.renderScale = preset.renderScale;
    const shares = settings.particles.share;
    const total = shares[0] + shares[1] + shares[2] || 1;
    settings.particles.share = [shares[0] / total, shares[1] / total, shares[2] / total];

    const az = settings.render.sunAzimuthDeg * Math.PI / 180;
    const el = settings.render.sunElevationDeg * Math.PI / 180;
    state.sun = [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
    return settings;
}

//------------------------------------------------------------------------------------------
// Boot
//------------------------------------------------------------------------------------------
async function boot()
{
    const canvas = document.getElementById('gpuCanvas');
    try
    {
        const created = await createDevice();
        device = created.device;
        attachDeviceDiagnostics(device, report);
        state.adapter = created.info;
    }
    catch (error)
    {
        showDialog({
            title: 'WebGPU is required',
            text: `${escapeHtml(error.message)}<br><br>This tool runs the erosion solver in compute shaders, so a WebGPU browser is required: Chrome or Edge 121+, Safari 18+, or Firefox 141+ with WebGPU enabled. Hardware acceleration must be on; software rendering is too slow for the solver and is refused rather than silently degrading.`,
            actions: [{ label: 'Close', primary: true }],
        });
        document.getElementById('gpuChip').className = 'chip bad';
        document.getElementById('gpuLabel').textContent = 'no WebGPU';
        return;
    }

    context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    viewport = new Viewport(canvas);
    viewport.renderScale = QUALITY_PRESETS[state.settings.quality].renderScale;

    engine = new TerrainEngine(device, format, report);
    engine.configure({ quality: state.settings.quality, world: state.settings.world });
    engine.setTargetSize(viewport.width, viewport.height);

    graph = new GraphEditor(document.getElementById('graphCanvas'), {
        doc: presetDocument(state.preset),
        onChange: () => {
            state.pendingCompile = true;
        },
        onSelect: (nodeId) => {
            inspector?.setSelection(nodeId);
        },
        contextMenu: (event, items, world) => {
            contextMenu(event.clientX, event.clientY, items);
            void world;
        },
    });
    history = new History(graph.doc);
    graph.setHistory(history);
    applyPresetSettings(state.preset);
    buildLegend();

    inspector = new Inspector(document.getElementById('inspector'), {
        settings: state.settings,
        engine,
        doc: graph.doc,
        selectedNode: null,
        onSettings: () => {
            state.pendingCompile = false;
            state.sample = 0;
        },
        onNodeChange: (node, paramId) => {
            if (paramId === '__duplicate')
            {
                graph.duplicateSelection();
                return;
            }
            if (paramId === '__remove')
            {
                graph.deleteSelection();
                return;
            }
            graph.pushHistory();
            state.pendingCompile = true;
            state.pendingBake = true;
        },
        onRebake: () => {
            state.pendingBake = true;
        },
    });

    wireInterface();
    rebuildOutliner();

    document.getElementById('statVoxels').textContent = `${engine.grid.nx}×${engine.grid.ny}×${engine.grid.nz}`;
    describeScene();
    document.getElementById('statVoxelSize').textContent = `${formatNumber(engine.grid.voxel, 2)} m`;
    const chip = document.getElementById('gpuChip');
    chip.className = 'chip';
    document.getElementById('gpuLabel').textContent = state.adapter.vendor || 'WebGPU';

    // Compile the graph and run the first bake before the loop starts. Without this the compute
    // pipelines do not exist yet, the first step of the first frame has nothing to dispatch, and
    // the viewport stays black with the counter readouts frozen at zero.
    setOverlayBusy('Building the terrain', `compiling the graph, then baking ${engine.grid.nx}×${engine.grid.ny}×${engine.grid.nz} voxels`);
    try
    {
        compileAndBake(1);
    }
    catch (error)
    {
        showFault(`The first bake failed: ${error && error.message ? error.message : error}`, error);
    }
    hideDialog();
    cameraMoved = true;
    requestAnimationFrame(frame);
}

function escapeHtml(text)
{
    return String(text).replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[character]));
}

function report(message, kind = 'warn')
{
    pushDiagnostic(state, message, kind);
    toast(`<b>Engine</b><br>${escapeHtml(message)}`, kind === 'warn' ? 'warn' : 'error', 9000);
    const panel = document.getElementById('inspector');
    if (panel)
    {
        const box = document.createElement('div');
        box.className = 'error-text';
        box.style.marginTop = '8px';
        box.textContent = message;
        panel.prepend(box);
    }
}

//------------------------------------------------------------------------------------------
// Graph compilation and baking
//------------------------------------------------------------------------------------------
function compileAndBake(stride)
{
    if (!engine || !graph)
    {
        return;
    }
    const result = compileGraph(graph.doc);
    if (result.errors.length)
    {
        const message = result.errors.join('\n');
        if (message !== lastCompileError)
        {
            lastCompileError = message;
            report(`Graph error: ${message}`, 'error');
        }
        return;
    }
    lastCompileError = null;
    for (const warning of result.warnings)
    {
        pushDiagnostic(state, `Graph warning: ${warning}`, 'warn');
    }

    compiled = result;
    const rebuilt = engine.buildPipelines(result.wgsl, result.signature);
    engine.writeGraphParams(result, collectParamValues());

    // Preview strides: a graph edit bakes at reduced stride so the viewport answers instantly,
    // and the full-resolution bake follows as soon as the interaction stops.
    engine.prepareFrame(deriveSettings(), viewport.describe(), { samples: 1, sun: state.sun });
    engine.bake(stride ?? state.bakeStride);
    state.pendingBake = false;
    if (rebuilt)
    {
        engine.requestCounters();
    }
    // The bake is enqueued, not finished, so the overlay goes up now and comes down when the
    // queue reports back — an interface that lies about being idle is worse than a slow one.
    state.busy = true;
    setOverlayBusy('Baking terrain', `${engine.grid.nx}×${engine.grid.ny}×${engine.grid.nz} volume, `
        + `${engine.poolSize.toLocaleString()} parcels`);
    state.sample = 0;
}

function collectParamValues()
{
    const values = {};
    for (const node of graph.doc.nodes)
    {
        values[node.id] = node.params;
    }
    return values;
}

//------------------------------------------------------------------------------------------
// Frame loop
//------------------------------------------------------------------------------------------
// A fault inside a frame is reported and then tolerated: the interface stays usable, the message
// is on screen, and the loop keeps running so a transient device error can recover. The previous
// version let the exception escape, which stopped the callback chain and left a black viewport
// with a console nobody was looking at.
function frame(now)
{
    try
    {
        renderFrame(now);
    }
    catch (error)
    {
        showFault(`Render loop faulted: ${error && error.message ? error.message : error}`, error);
    }
    requestAnimationFrame(frame);
}

let lastFault = null;

function showFault(message, error)
{
    if (message !== lastFault)
    {
        lastFault = message;
        report(message, 'error');
        const host = document.getElementById('viewport');
        if (host)
        {
            let banner = host.querySelector('.fault');
            if (!banner)
            {
                banner = document.createElement('div');
                banner.className = 'fault';
                host.appendChild(banner);
            }
            banner.textContent = message;
        }
    }
    if (error && error.stack)
    {
        console.error(error);
    }
}

function renderFrame(now)
{
    const start = performance.now();
    const delta = Math.min(0.1, (now - state.lastFrameTime) / 1000) || 0.016;
    state.lastFrameTime = now;
    state.frames += 1;

    const settings = deriveSettings();
    const keys = collectKeys();

    if (viewport.update(delta, keys))
    {
        cameraMoved = true;
    }
    if (viewport.resize(QUALITY_PRESETS[settings.quality].renderScale))
    {
        // Resizing recreates the render targets; the solver resources are untouched.
        engine.setTargetSize(viewport.width, viewport.height);
        engine.buildPipelines(compiled?.wgsl ?? '', compiled?.signature ?? 'none');
        cameraMoved = true;
    }

    if (state.pendingCompile)
    {
        state.pendingCompile = false;
        compileAndBake(state.running ? 4 : 2);
        inspector.setDocument(graph.doc);
    }

    const preset = QUALITY_PRESETS[settings.quality];
    const steps = state.running ? preset.stepsPerFrame : 0;
    const camera = viewport.describe();

    engine.prepareFrame(settings, camera, { samples: 1, sun: state.sun });
    if (state.pendingBake)
    {
        engine.bake(state.bakeStride);
        state.pendingBake = false;
    }

    for (let i = 0; i < steps; i += 1)
    {
        engine.stepSimulation({
            dt: settings.dt,
            fillIterations: settings.fillIterations,
            accumulateIterations: settings.accumulateIterations,
            refineEvery: settings.refineEvery,
            transportIterations: settings.transportIterations,
            windEnabled: settings.wind.enabled,
            particlesEnabled: settings.particles.enabled,
            thermalEnabled: settings.thermal.enabled,
        });
        state.step += 1;
    }

    // Progressive accumulation: only while the camera is still and the solver is idle.
    const accumulating = !state.running && !cameraMoved && state.sample < 96;
    state.sample = accumulating ? state.sample + 1 : 1;
    viewport.nextJitter(state.sample);

    engine.prepareFrame(settings, viewport.describe(), { samples: state.sample, sun: state.sun });

    const view = context.getCurrentTexture().createView();
    engine.renderView({
        target: view,
        showWater: settings.render.showWater,
        showParticles: settings.render.showParticles && settings.particles.enabled,
        poolSize: engine.poolSize,
        samples: state.sample,
        resetAccumulation: !accumulating || state.sample <= 1,
    });
    cameraMoved = false;

    if (state.frames % 24 === 0)
    {
        engine.requestCounters();
    }
    engine.pollCounters().then((stats) => {
        state.stats = stats;
        updateBalance(state);
        if (state.busy)
        {
            state.busy = false;
            hideDialog();
        }
    });

    state.cpuMs = performance.now() - start;
    if (state.frames % 12 === 0)
    {
        updateHud(delta);
    }
}

function updateHud(delta)
{
    state.fps = state.fps * 0.85 + (1 / Math.max(delta, 1e-4)) * 0.15;
    const settings = state.settings;
    const set = (id, text) => {
        const node = document.getElementById(id);
        if (node)
        {
            node.textContent = text;
        }
    };
    set('statFps', state.fps.toFixed(0));
    set('statStep', formatNumber(state.step, 0));
    set('statTime', formatModelTime(engine.time));
    set('statParticles', formatNumber(state.stats.alive || 0, 0));
    set('balCut', formatNumber(state.stats.eroded || 0));
    set('balFill', formatNumber(state.stats.deposited || 0));
    set('balCarry', formatNumber(state.stats.carried || 0));
    set('hudCamera', `pos ${viewport.position.map((v) => v.toFixed(0)).join(' / ')} m\nfov ${viewport.fov.toFixed(0)}°`);
    const voxel = engine.grid.voxel;
    set('hudSim', `${engine.grid.nx}×${engine.grid.ny}×${engine.grid.nz} voxels · ${voxel.toFixed(2)} m\n${engine.poolSize.toLocaleString()} parcels · ${state.cpuMs.toFixed(1)} ms cpu`);
    set('scaleLabel', `${formatNumber(viewport.orbitDistance * 0.25, 0)} m`);
    set('statSpeed', state.running ? (QUALITY_PRESETS[settings.quality].stepsPerFrame > 1 ? 'x2' : '1×') : 'paused');

    const scrub = document.getElementById('scrubFill');
    if (scrub)
    {
        scrub.style.width = `${Math.min(100, (state.step % 400) / 4)}%`;
    }
}

function buildLegend()
{
    const host = document.getElementById('graphLegend');
    if (!host)
    {
        return;
    }
    // The socket colours are the graph's type system, so the legend is generated from the same
    // table the editor draws wires with rather than from a second copy that can drift.
    const labels = {
        sdf: 'field',
        point: 'point',
        mask: 'mask',
        hardness: 'hardness',
        rain: 'rain',
        strata: 'strata',
    };
    host.replaceChildren();
    for (const [kind, color] of Object.entries(SOCKET_COLORS))
    {
        const row = document.createElement('div');
        row.className = 'legend-item';
        const swatch = document.createElement('span');
        swatch.className = 'swatch';
        swatch.style.background = color;
        const text = document.createElement('span');
        text.textContent = labels[kind] || kind;
        row.append(swatch, text);
        host.append(row);
    }
}

function describeScene()
{
    const preset = QUALITY_PRESETS[state.settings.quality];
    const hint = document.getElementById('sceneHint');
    if (!hint || !engine?.grid)
    {
        return;
    }
    hint.textContent = `${preset.label || state.settings.quality} · ${engine.grid.nx}×${engine.grid.ny}×${engine.grid.nz} · `
        + `${formatNumber(engine.grid.world, 0)} m`;
}

//------------------------------------------------------------------------------------------
// Interface wiring
//------------------------------------------------------------------------------------------
function wireInterface()
{
    window.addEventListener('error', (event) => {
        showFault(`Uncaught error: ${event.message}`, event.error);
    });
    window.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason && event.reason.message ? event.reason.message : String(event.reason);
        showFault(`Unhandled rejection: ${reason}`, event.reason);
    });

    document.getElementById('modeTabs').addEventListener('click', (event) => {
        const button = event.target.closest('.tab');
        if (!button)
        {
            return;
        }
        setMode(button.dataset.mode);
    });

    document.getElementById('qualitySelect').addEventListener('change', (event) => {
        changeQuality(event.target.value);
    });

    document.getElementById('btnRun').addEventListener('click', () => toggleRun());
    document.getElementById('btnStep').addEventListener('click', () => {
        state.running = false;
        updateRunButton();
        engine.stepSimulation({
            dt: state.settings.dt,
            fillIterations: state.settings.fillIterations,
            accumulateIterations: state.settings.accumulateIterations,
            refineEvery: state.settings.refineEvery,
            transportIterations: state.settings.transportIterations,
            windEnabled: state.settings.wind.enabled,
            particlesEnabled: state.settings.particles.enabled,
            thermalEnabled: state.settings.thermal.enabled,
        });
        state.step += 1;
        state.sample = 0;
    });
    document.getElementById('btnReset').addEventListener('click', resetErosion);
    document.getElementById('btnSnapshot').addEventListener('click', saveProject);
    document.getElementById('btnRestore').addEventListener('click', loadProject);
    document.getElementById('btnSave').addEventListener('click', saveProject);
    document.getElementById('btnLoad').addEventListener('click', loadProject);
    document.getElementById('btnExport').addEventListener('click', (event) => {
        contextMenu(event.clientX, event.clientY, [
            { title: 'Export' },
            { label: 'Render frame (PNG)', hint: 'full res', onClick: exportImage },
            { label: 'Project (JSON)', hint: 'graph + settings', onClick: saveProject },
            { label: 'Generated WGSL', hint: 'graph module', onClick: exportWgsl },
        ]);
    });

    document.getElementById('viewport').addEventListener('dblclick', () => {
        viewport.frame({ center: [0, engine.grid.hi[1] * 0.35, 0], radius: engine.grid.world * 0.5 });
        state.sample = 0;
    });

    window.addEventListener('keydown', (event) => {
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'SELECT')
        {
            return;
        }
        const key = event.key.toLowerCase();
        if (key === ' ' || event.code === 'Space')
        {
            event.preventDefault();
            toggleRun();
            return;
        }
        if (key === 'tab')
        {
            event.preventDefault();
            openAddMenu(window.innerWidth * 0.5, window.innerHeight * 0.5);
            return;
        }
        if (key === 'delete' || key === 'backspace')
        {
            if (state.mode !== 'viewport')
            {
                graph.deleteSelection();
            }
            return;
        }
        if ((event.ctrlKey || event.metaKey) && key === 'd')
        {
            event.preventDefault();
            graph.duplicateSelection();
            return;
        }
        if ((event.ctrlKey || event.metaKey) && key === 'z' && !event.shiftKey)
        {
            event.preventDefault();
            graph.undo();
            state.pendingCompile = true;
            return;
        }
        if ((event.ctrlKey || event.metaKey) && (key === 'y' || (key === 'z' && event.shiftKey)))
        {
            event.preventDefault();
            graph.redo();
            state.pendingCompile = true;
            return;
        }
        if (key === 'f')
        {
            if (state.mode === 'viewport')
            {
                viewport.frame({ center: [0, engine.grid.hi[1] * 0.35, 0], radius: engine.grid.world * 0.5 });
                state.sample = 0;
            }
            else
            {
                graph.fit();
            }
            return;
        }
        if (key >= '1' && key <= '9')
        {
            state.settings.render.debugView = Number(key) - 1;
            inspector.render();
            state.sample = 0;
            return;
        }
        if (key === 'b')
        {
            state.pendingBake = true;
            toast('<b>Bake</b><br>Rebuilding the volume from the graph at full resolution.');
            return;
        }
        if (key === 'c')
        {
            state.settings.render.clipEnabled = !state.settings.render.clipEnabled;
            inspector.render();
            state.sample = 0;
            return;
        }
    });

    window.addEventListener('resize', () => {
        if (viewport.resize(QUALITY_PRESETS[state.settings.quality].renderScale))
        {
            engine.setTargetSize(viewport.width, viewport.height);
        }
    });

    document.querySelectorAll('.group-head').forEach((head) => {
        head.addEventListener('click', () => head.parentElement.classList.toggle('collapsed'));
    });

    // Right-click on the graph background opens the node palette.
    document.getElementById('graphCanvas').addEventListener('contextmenu', (event) => {
        event.preventDefault();
        const rect = event.target.getBoundingClientRect();
        const world = {
            x: (event.clientX - rect.left - graph.pan.x) / graph.zoom,
            y: (event.clientY - rect.top - graph.pan.y) / graph.zoom,
        };
        // A right click on a node belongs to the node's own menu; the palette is for empty space.
        if (graph.pick(world))
        {
            return;
        }
        openAddMenu(event.clientX, event.clientY, world);
    });
}

function collectKeys()
{
    const keys = new Set();
    for (const code of heldKeys)
    {
        keys.add(code);
    }
    return keys;
}

const heldKeys = new Set();
window.addEventListener('keydown', (event) => {
    heldKeys.add(event.key.toLowerCase());
    if (event.key === 'Shift')
    {
        heldKeys.add('shift');
    }
});
window.addEventListener('keyup', (event) => {
    heldKeys.delete(event.key.toLowerCase());
    if (event.key === 'Shift')
    {
        heldKeys.delete('shift');
    }
});

function setMode(mode)
{
    state.mode = mode;
    const graphVisible = mode === 'graph' || mode === 'split';
    document.getElementById('graphWrap').style.display = graphVisible ? '' : 'none';
    document.getElementById('viewport').style.display = mode === 'graph' ? 'none' : '';
    document.querySelectorAll('#modeTabs .tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });
    if (graphVisible)
    {
        graph.fit();
    }
    viewport.resize(QUALITY_PRESETS[state.settings.quality].renderScale);
}

function toggleRun()
{
    state.running = !state.running;
    state.sample = 0;
    updateRunButton();
}

function updateRunButton()
{
    const button = document.getElementById('btnRun');
    button.textContent = state.running ? '❚❚ Pause' : '▶ Run';
    button.classList.toggle('primary', !state.running);
}

function openAddMenu(clientX, clientY, world)
{
    const items = [];
    let lastGroup = null;
    for (const node of NODE_LIBRARY)
    {
        if (node.group !== lastGroup)
        {
            items.push({ title: node.group });
            lastGroup = node.group;
        }
        items.push({
            label: node.title,
            hint: node.sockets.out?.[0]?.type ?? '',
            onClick: () => {
                const at = world ?? graph.screenToWorld(clientX - graph.canvas.getBoundingClientRect().left, clientY - graph.canvas.getBoundingClientRect().top);
                graph.addNode(node.id, at);
            },
        });
    }
    contextMenu(clientX, clientY, items, { search: true, searchPlaceholder: 'Search nodes…' });
}

function rebuildOutliner()
{
    buildOutliner(document.getElementById('outliner'), {
        ...state,
        visibility: state.visibility,
    }, {
        onToggle: (key) => {
            state.visibility[key] = state.visibility[key] === false;
            if (key === 'showWater')
            {
                state.settings.render.showWater = state.visibility[key];
            }
            if (key === 'showParticles')
            {
                state.settings.render.showParticles = state.visibility[key];
            }
            state.sample = 0;
            rebuildOutliner();
        },
        onBake: () => {
            state.pendingBake = true;
        },
        onResetErosion: resetErosion,
    });

    buildPresets(document.getElementById('presetList'), state, {
        onLoadPreset: (id) => {
            state.preset = id;
            graph.setDocument(presetDocument(id));
            history = new History(graph.doc);
            graph.setHistory(history);
            applyPresetSettings(id);
            inspector.setDocument(graph.doc);
            state.pendingCompile = true;
            rebuildOutliner();
            toast(`<b>${PRESETS.find((entry) => entry.id === id).title}</b><br>Recipe loaded; rebaking the volume.`);
        },
    });
}

function applyPresetSettings(id)
{
    const preset = PRESETS.find((entry) => entry.id === id);
    if (!preset?.settings)
    {
        return;
    }
    const settings = state.settings;
    if (preset.settings.biome !== undefined)
    {
        settings.render.biome = preset.settings.biome;
    }
    if (preset.settings.vegetation !== undefined)
    {
        settings.render.vegetation = preset.settings.vegetation;
    }
    if (preset.settings.rain !== undefined)
    {
        settings.rainMm = preset.settings.rain * 3.6e6;
    }
    if (preset.settings.erodibility !== undefined)
    {
        settings.erodibility = preset.settings.erodibility;
    }
    if (preset.settings.wind)
    {
        Object.assign(settings.wind, preset.settings.wind);
        if (settings.wind.direction !== undefined && preset.settings.wind.direction !== undefined)
        {
            settings.wind.windDeg = preset.settings.wind.direction * 180 / Math.PI;
        }
        else
        {
            settings.wind.windDeg = settings.wind.direction * 180 / Math.PI;
        }
    }
    if (preset.settings.thermal)
    {
        Object.assign(settings.thermal, preset.settings.thermal);
    }
    if (preset.settings.climate)
    {
        Object.assign(settings.climate, preset.settings.climate);
    }
    inspector?.render();
}

function changeQuality(quality)
{
    state.settings.quality = quality;
    const preset = QUALITY_PRESETS[quality];
    state.bakeStride = preset.bakeStride ?? 1;
    engine.configure({
        quality,
        world: state.settings.world,
        preset,
    });
    engine.setTargetSize(viewport.width, viewport.height);
    compileAndBake(1);
    document.getElementById('statVoxels').textContent = `${engine.grid.nx}×${engine.grid.ny}×${engine.grid.nz}`;
    document.getElementById('statVoxelSize').textContent = `${formatNumber(engine.grid.voxel, 2)} m`;
    describeScene();
    toast(`<b>${preset.label} preset</b><br>${engine.grid.nx}×${engine.grid.ny}×${engine.grid.nz} volume, ${engine.poolSize.toLocaleString()} parcels, ${preset.marchSteps} march steps.`);
}

function resetErosion()
{
    engine.configure({ quality: state.settings.quality, world: state.settings.world });
    engine.setTargetSize(viewport.width, viewport.height);
    state.step = 0;
    state.sample = 0;
    compileAndBake(1);
    toast('<b>Erosion state cleared</b><br>The volume was rebuilt from the graph, so caves and cliffs are intact.');
}

//------------------------------------------------------------------------------------------
// Project + image export
//------------------------------------------------------------------------------------------
function saveProject()
{
    const payload = {
        tool: 'slate-sdf-terrain',
        version: 1,
        preset: state.preset,
        settings: state.settings,
        graph: graph.doc,
    };
    download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), 'slate-terrain.json');
}

function loadProject()
{
    const input = document.getElementById('fileInput');
    input.value = '';
    input.onchange = async () => {
        const file = input.files?.[0];
        if (!file)
        {
            return;
        }
        try
        {
            const payload = JSON.parse(await file.text());
            if (!payload.graph?.nodes?.length)
            {
                throw new Error('no graph in that file');
            }
            Object.assign(state.settings, payload.settings ?? {});
            state.preset = payload.preset ?? 'custom';
            graph.setDocument(payload.graph);
            history = new History(graph.doc);
            graph.setHistory(history);
            inspector.setDocument(graph.doc);
            state.pendingCompile = true;
            toast('<b>Project loaded</b><br>Rebaking the volume from the saved graph.');
        }
        catch (error)
        {
            toast(`<b>Could not open project</b><br>${escapeHtml(error.message)}`, 'error');
        }
    };
    input.click();
}

function exportWgsl()
{
    if (!compiled)
    {
        return;
    }
    download(new Blob([compiled.wgsl], { type: 'text/plain' }), 'slate-graph.wgsl');
}

async function exportImage()
{
    // Render one frame at full device resolution into an 8-bit target, then read it back. The
    // accumulation buffer is bypassed so the file is exactly what the viewport shows.
    const width = viewport.canvas.width;
    const height = viewport.canvas.height;
    const texture = device.createTexture({
        label: 'export',
        size: { width, height },
        format: navigator.gpu.getPreferredCanvasFormat(),
        usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
    const buffer = device.createBuffer({
        label: 'exportRead',
        size: bytesPerRow * height,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    // The present pipeline writes straight into the export texture through a one-off bind group
    // that swaps the colour attachment for the export target.
    const group = device.createBindGroup({
        label: 'export',
        layout: engine.renderLayout,
        entries: [
            { binding: 0, resource: { buffer: engine.resources.uniforms, offset: 0, size: 512 } },
            { binding: 1, resource: { buffer: engine.resources.graphParams } },
            { binding: 2, resource: (engine.parity === 0 ? engine.resources.sdfA : engine.resources.sdfB).createView({ dimension: '3d' }) },
            { binding: 3, resource: (engine.parity === 0 ? engine.resources.matA : engine.resources.matB).createView({ dimension: '3d' }) },
            { binding: 4, resource: device.createSampler({ magFilter: 'linear', minFilter: 'linear' }) },
            { binding: 5, resource: engine.resources.waterTex.createView() },
            { binding: 6, resource: engine.resources.waterTex2.createView() },
            { binding: 7, resource: { buffer: engine.resources.grid } },
            { binding: 8, resource: { buffer: engine.resources.particles } },
            { binding: 9, resource: engine.targets.color.createView() },
            { binding: 10, resource: engine.targets.depth.createView() },
            { binding: 11, resource: engine.targets.accum.createView() },
        ],
    });

    const encoder = device.createCommandEncoder({ label: 'export' });
    const pass = encoder.beginRenderPass({
        label: 'export',
        colorAttachments: [{ view: texture.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }],
    });
    pass.setPipeline(engine.renderPipelines.present);
    pass.setBindGroup(0, group, [engine.ring.slot('present') * 512]);
    pass.draw(3);
    pass.end();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, { width, height });
    device.queue.submit([encoder.finish()]);

    await buffer.mapAsync(GPUMapMode.READ);
    const pixels = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap();
    buffer.destroy();
    texture.destroy();

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(width, height);
    const swap = navigator.gpu.getPreferredCanvasFormat() === 'bgra8unorm';
    for (let y = 0; y < height; y += 1)
    {
        for (let x = 0; x < width; x += 1)
        {
            const src = y * bytesPerRow + x * 4;
            const dst = (y * width + x) * 4;
            image.data[dst + 0] = pixels[src + (swap ? 2 : 0)];
            image.data[dst + 1] = pixels[src + 1];
            image.data[dst + 2] = pixels[src + (swap ? 0 : 2)];
            image.data[dst + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    canvas.toBlob((blob) => {
        download(blob, `slate-terrain-${Date.now()}.png`);
        toast('<b>Frame exported</b><br>The image is the raw render, not a screen capture.');
    }, 'image/png');
}

function download(blob, filename)
{
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
}

//------------------------------------------------------------------------------------------
// Entry
//------------------------------------------------------------------------------------------
updateRunButton();
boot();
