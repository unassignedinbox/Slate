//============================================================================================================================================
// SolidScape — Application entry: viewport / node editor shell composition
//============================================================================================================================================

import { ViewportPresentation, DefaultSky, type CameraScheme } from './viewport';
import { GraphSurface } from './graph';
import { NodeCatalogue, GroupOrder, GroupGlyphs, CatalogueIndex, type NodeSpecification } from './nodeCatalogue';
import { HydrateGlyphs, RenderGlyph } from './icons';
import { CompileField, type StrokeRecord, type ShapeType } from './sdf';
import { FieldPass } from './sdfPass';
import { SculptController, type SculptTool } from './sculpt';
import { BrickPool } from './bricks';
import { ErosionPreview, DefaultErodeSettings, type ErodeSettings } from './erosion';

const Q  = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

HydrateGlyphs();

//--------------------------------------------------------------------------------------------------------------------------
// Split pane
//--------------------------------------------------------------------------------------------------------------------------
(function BindSplitter()
{
    const workspace = Q('#workspace');
    const splitter  = Q('#splitter');
    let dragging = false;

    splitter.addEventListener('pointerdown', (e) =>
    {
        dragging = true;
        splitter.classList.add('dragging');
        splitter.setPointerCapture(e.pointerId);
    });
    splitter.addEventListener('pointermove', (e) =>
    {
        if (!dragging) return;
        const pct = Math.min(Math.max((e.clientX / window.innerWidth) * 100, 20), 80);
        workspace.style.setProperty('--split', `${pct}%`);
    });
    const stop = (e: PointerEvent) =>
    {
        dragging = false;
        splitter.classList.remove('dragging');
        if (splitter.hasPointerCapture(e.pointerId)) splitter.releasePointerCapture(e.pointerId);
    };
    splitter.addEventListener('pointerup', stop);
    splitter.addEventListener('pointercancel', stop);
})();

//--------------------------------------------------------------------------------------------------------------------------
// Viewport
//--------------------------------------------------------------------------------------------------------------------------
const viewport = new ViewportPresentation(Q('#viewport'), Q<HTMLCanvasElement>('#viewport-canvas'));

//---------------------------------------------------------------- SDF field pass (see docs/SDF-Research.md — Phase 1)
const fieldPass = new FieldPass();
viewport.scene.add(fieldPass.mesh);
viewport.onFrame = (time) =>
{
    fieldPass.UpdateFrame(viewport.camera, viewport.SunDirection(), viewport.SunColour(),
        viewport.sky.sunIntensity, viewport.FogColour(), viewport.sky.fogDensity, time);
};

const stFps = Q('#st-fps');
let telemetryGate = 0;
viewport.onTelemetry = (_pos, _speed, fps) =>
{
    telemetryGate += 1;
    if (telemetryGate % 6 !== 0) return;
    stFps.textContent = `${fps.toFixed(0)} fps`;
};

//---------------------------------------------------------------- transient toast
const toast = Q('#vp-toast');
let toastTimer = 0;
function ShowToast(message: string): void
{
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2600);
}

//---------------------------------------------------------------- camera scheme
const HintSets: Record<CameraScheme, [string, string][]> =
{
    fly: [
        ['RMB / LMB', 'look around'],
        ['W A S D', 'move'],
        ['Q · E', 'down · up'],
        ['Shift', 'sprint ×4'],
        ['Ctrl', 'crawl ×0.25'],
        ['Wheel', 'speed while looking'],
    ],
    orbit: [
        ['MMB / LMB', 'orbit'],
        ['Shift + drag', 'pan'],
        ['RMB drag', 'pan'],
        ['Wheel', 'dolly zoom'],
        ['Numpad .', 'frame scene'],
    ],
};

function PaintHints(scheme: CameraScheme): void
{
    Q('#vp-hints').innerHTML = HintSets[scheme]
        .map(([k, v]) => `<div class="hint-row"><span class="kbd">${k}</span><span>${v}</span></div>`)
        .join('');
}
PaintHints('fly');

Q('#camera-scheme').querySelectorAll('button').forEach((b) =>
{
    b.addEventListener('click', () =>
    {
        Q('#camera-scheme').querySelectorAll('button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        const scheme = b.dataset.scheme as CameraScheme;
        viewport.SetScheme(scheme);
        PaintHints(scheme);
    });
});

//---------------------------------------------------------------- sun & sky panel
interface SkyControl
{
    key: keyof typeof DefaultSky;
    label: string; min: number; max: number; step: number; suffix: string;
}

const SkyControls: (SkyControl | { section: string })[] =
[
    { section: 'Solar Position' },
    { key: 'elevation',    label: 'Elevation', min: -5,    max: 90,   step: 0.5,    suffix: '°' },
    { key: 'azimuth',      label: 'Azimuth',   min: 0,     max: 360,  step: 1,      suffix: '°' },
    { section: 'Atmosphere' },
    { key: 'turbidity',    label: 'Turbidity', min: 1,     max: 20,   step: 0.1,    suffix: '' },
    { key: 'rayleigh',     label: 'Rayleigh',  min: 0,     max: 6,    step: 0.05,   suffix: '' },
    { key: 'mieCoeff',     label: 'Mie',       min: 0,     max: 0.06, step: 0.0005, suffix: '' },
    { key: 'mieDirection', label: 'Mie Dir',   min: 0,     max: 0.999,step: 0.005,  suffix: '' },
    { key: 'fogDensity',   label: 'Fog',       min: 0,     max: 0.02, step: 0.0002, suffix: '' },
    { section: 'Exposure' },
    { key: 'exposure',     label: 'Exposure',  min: 0.05,  max: 2,    step: 0.01,   suffix: '' },
    { key: 'sunIntensity', label: 'Sun',       min: 0,     max: 12,   step: 0.1,    suffix: '' },
];

const SkyPresets: Record<string, Partial<typeof DefaultSky>> =
{
    'Midday':   { elevation: 62, azimuth: 180, turbidity: 3.2, rayleigh: 1.6, exposure: 0.36, fogDensity: 0.0022, sunIntensity: 4.2 },
    'Golden':   { elevation: 8,  azimuth: 255, turbidity: 7.5, rayleigh: 3.1, exposure: 0.55, fogDensity: 0.0048, sunIntensity: 3.0 },
    'Overcast': { elevation: 34, azimuth: 150, turbidity: 16,  rayleigh: 4.0, exposure: 0.40, fogDensity: 0.0090, sunIntensity: 1.1 },
    'Dusk':     { elevation: -1.5, azimuth: 285, turbidity: 9, rayleigh: 3.6, exposure: 0.70, fogDensity: 0.0060, sunIntensity: 0.6 },
};

function BuildSkyPanel(): void
{
    const host = Q('#sky-controls');
    host.innerHTML = '';

    for (const entry of SkyControls)
    {
        if ('section' in entry)
        {
            const label = document.createElement('div');
            label.className = 'sec-label';
            label.textContent = entry.section;
            host.appendChild(label);
            continue;
        }

        const row = document.createElement('div');
        row.className = 'crow';
        row.innerHTML = `
            <div class="clabel">${entry.label}</div>
            <div class="scrub" data-key="${entry.key}">
                <div class="fill"></div><span class="sl">drag</span><span class="sv"></span>
            </div>`;
        host.appendChild(row);

        const scrub = row.querySelector<HTMLElement>('.scrub')!;
        const fill  = scrub.querySelector<HTMLElement>('.fill')!;
        const read  = scrub.querySelector<HTMLElement>('.sv')!;
        const decimals = (String(entry.step).split('.')[1] ?? '').length;

        const paint = () =>
        {
            const v = viewport.sky[entry.key] as number;
            read.textContent = `${v.toFixed(decimals)}${entry.suffix}`;
            fill.style.transform = `scaleX(${(v - entry.min) / (entry.max - entry.min)})`;
        };
        (scrub as HTMLElement & { repaint?: () => void }).repaint = paint;
        paint();

        let dragging = false;
        let lastX = 0;
        scrub.addEventListener('pointerdown', (e) =>
        {
            dragging = true; lastX = e.clientX;
            scrub.classList.add('dragging');
            scrub.setPointerCapture(e.pointerId);
        });
        scrub.addEventListener('pointermove', (e) =>
        {
            if (!dragging) return;
            const dx = e.clientX - lastX;
            lastX = e.clientX;
            const rate = (e.shiftKey ? 0.12 : 1) * (entry.max - entry.min) / 280;
            let v = (viewport.sky[entry.key] as number) + dx * rate;
            v = Math.min(entry.max, Math.max(entry.min, Math.round(v / entry.step) * entry.step));
            (viewport.sky[entry.key] as number) = v;
            paint();
            viewport.ApplySky();
            RefreshSunRead();
        });
        const stop = (e: PointerEvent) =>
        {
            dragging = false;
            scrub.classList.remove('dragging');
            if (scrub.hasPointerCapture(e.pointerId)) scrub.releasePointerCapture(e.pointerId);
        };
        scrub.addEventListener('pointerup', stop);
        scrub.addEventListener('pointercancel', stop);
        scrub.addEventListener('dblclick', () =>
        {
            (viewport.sky[entry.key] as number) = DefaultSky[entry.key] as number;
            paint(); viewport.ApplySky(); RefreshSunRead();
        });
    }

    // document actions + terrain field quality + ground tone + toggles + presets
    const extra = document.createElement('div');
    extra.innerHTML = `
        <div class="sec-label">Document</div>
        <div class="chips" style="margin-top:2px">
            <div class="chip" id="doc-new"><i data-icon="file-plus"></i>&nbsp;New</div>
            <div class="chip" id="doc-save"><i data-icon="save"></i>&nbsp;Save</div>
            <div class="chip" id="doc-load"><i data-icon="folder-open"></i>&nbsp;Load</div>
            <div class="chip" id="doc-undo"><i data-icon="undo"></i>&nbsp;Undo</div>
            <div class="chip" id="doc-redo"><i data-icon="redo"></i>&nbsp;Redo</div>
        </div>
        <div class="sec-label">Terrain Field — Part A</div>
        <div class="crow">
            <div class="clabel">Resolution</div>
            <div class="chips" id="res-chips" style="flex:1">
                <div class="chip" data-scale="0.5">Half</div>
                <div class="chip sel" data-scale="1">Full</div>
                <div class="chip" data-scale="1.5">Super</div>
            </div>
        </div>
        <div class="crow">
            <div class="clabel">March Quality</div>
            <div class="chips" id="march-chips" style="flex:1">
                <div class="chip" data-steps="120">Draft</div>
                <div class="chip sel" data-steps="200">Balanced</div>
                <div class="chip" data-steps="320">Fine</div>
            </div>
        </div>
        <div class="crow">
            <div class="clabel">Tape</div>
            <div class="switch" id="opt-coalesce" data-on="true" title="Coalesce sphere runs into capsules"></div>
            <span id="coalesce-read" class="mono" style="font-size:11px;color:var(--text-faint);margin-left:8px">coalesce on · ×–</span>
        </div>
        <div class="crow">
            <div class="clabel">Bricks</div>
            <span id="brick-read" class="mono" style="font-size:11px;color:var(--text-faint)">0 bricks · 0 dirty/stroke</span>
        </div>
        <div class="sec-label">Reference</div>
        <div class="crow">
            <div class="clabel">Ground</div>
            <div class="swatch" style="background:${viewport.sky.groundTone}">
                <input type="color" id="ground-tone" value="${viewport.sky.groundTone}">
            </div>
            <div class="spacer"></div>
        </div>
        <div class="crow"><div class="clabel">Grid</div><div class="switch" id="opt-grid" data-on="true"></div>
            <div class="clabel" style="width:auto;margin-left:10px">Axes</div><div class="switch" id="opt-gizmo" data-on="true"></div></div>
        <div class="sec-label">Presets</div>
        <div class="chips" id="sky-presets">
            ${Object.keys(SkyPresets).map((k) => `<div class="chip" data-preset="${k}">${k}</div>`).join('')}
        </div>`;
    host.appendChild(extra);

    Q('#doc-new').addEventListener('click',  () => NewDocument());
    Q('#doc-save').addEventListener('click', () => SaveDocument());
    Q('#doc-load').addEventListener('click', () => Q<HTMLInputElement>('#load-file').click());
    Q('#doc-undo').addEventListener('click', () => UndoDoc());
    Q('#doc-redo').addEventListener('click', () => RedoDoc());

    Q('#res-chips').querySelectorAll<HTMLElement>('.chip').forEach((chip) =>
    {
        chip.addEventListener('click', () =>
        {
            Q('#res-chips').querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
            chip.classList.add('sel');
            viewport.SetRenderScale(Number(chip.dataset.scale));
        });
    });
    Q('#march-chips').querySelectorAll<HTMLElement>('.chip').forEach((chip) =>
    {
        chip.addEventListener('click', () =>
        {
            Q('#march-chips').querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
            chip.classList.add('sel');
            fieldPass.SetQuality(Number(chip.dataset.steps));
        });
    });

    const tone = Q<HTMLInputElement>('#ground-tone');
    tone.addEventListener('input', () =>
    {
        viewport.sky.groundTone = tone.value;
        (tone.parentElement as HTMLElement).style.background = tone.value;
        viewport.ApplySky();
    });

    BindSwitch(Q('#opt-grid'),  (on) => { viewport.sky.showGrid  = on; viewport.ApplySky(); });
    BindSwitch(Q('#opt-gizmo'), (on) => { viewport.sky.showGizmo = on; viewport.ApplySky(); });

    // Part-A wiring is bound after sculpt exists — see below (RefreshBrickRead is patched post-sculpt)

    Q('#sky-presets').querySelectorAll<HTMLElement>('.chip').forEach((chip) =>
    {
        chip.addEventListener('click', () =>
        {
            Q('#sky-presets').querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
            chip.classList.add('sel');
            Object.assign(viewport.sky, SkyPresets[chip.dataset.preset!]);
            viewport.ApplySky();
            RepaintSkyScrubs();
            RefreshSunRead();
        });
    });
}

function RepaintSkyScrubs(): void
{
    Q('#sky-controls').querySelectorAll<HTMLElement & { repaint?: () => void }>('.scrub')
        .forEach((s) => s.repaint?.());
}

function RefreshSunRead(): void
{
    // Sun is now only inside the viewport settings panel; the bottom bar is the brush bar.
}

function BindSwitch(el: HTMLElement, onChange: (on: boolean) => void): void
{
    el.addEventListener('click', () =>
    {
        const next = el.dataset.on !== 'true';
        el.dataset.on = String(next);
        onChange(next);
    });
}

BuildSkyPanel();
RefreshSunRead();

const skyPanel = Q('#sky-panel');
Q('#sky-toggle').addEventListener('click', () =>
{
    skyPanel.classList.toggle('show');
    Q('#sky-toggle').classList.toggle('active', skyPanel.classList.contains('show'));
});
Q('#sky-close').addEventListener('click', () =>
{
    skyPanel.classList.remove('show');
    Q('#sky-toggle').classList.remove('active');
});
Q('#sky-reset').addEventListener('click', () =>
{
    Object.assign(viewport.sky, DefaultSky);
    viewport.ApplySky();
    RepaintSkyScrubs();
    RefreshSunRead();
    Q('#sky-presets').querySelectorAll('.chip').forEach((c) => c.classList.remove('sel'));
});



//--------------------------------------------------------------------------------------------------------------------------
// Node graph
//--------------------------------------------------------------------------------------------------------------------------
const graph = new GraphSurface(
    Q('#graph-surface'), Q('#graph-layer'),
    document.querySelector<SVGSVGElement>('#graph-wires')!,
    Q('#graph-background'), Q('#marquee'),
);
graph.SetBackground('dots');

//---------------------------------------------------------------- seed graph
function LinkNodes(a: { uid: string; root: HTMLElement } | null, ap: string,
                   b: { uid: string } | null, bp: string): void
{
    if (!a || !b) return;
    const wid = `w-seed-${Math.random().toString(36).slice(2, 8)}`;
    const type = (a.root.querySelector<HTMLElement>(`.port-dot[data-port="${ap}"][data-side="out"]`)
        ?.dataset.type ?? 'field') as 'field';
    graph.wires.set(wid, { uid: wid, fromNode: a.uid, fromPort: ap, toNode: b.uid, toPort: bp, type });
}

function SeedGraph(): void
{
    const ground = graph.AddNode('sdf-plane',   -40,  -40);
    const sphere = graph.AddNode('sdf-sphere',  -40,  260);
    const union  = graph.AddNode('union',        340,  100);
    const erode  = graph.AddNode('erode',        680,  90);
    const out    = graph.AddNode('terrain-out', 1040, 130);

    LinkNodes(ground, 'sdf', union, 'a');
    LinkNodes(sphere, 'sdf', union, 'b');
    LinkNodes(union,  'sdf', erode, 'in');
    LinkNodes(erode,  'out', out,   'sdf');

    requestAnimationFrame(() => { graph.RedrawWires(); graph.FrameGraph(); });
}
SeedGraph();

//--------------------------------------------------------------------------------------------------------------------------
// Field document: strokes + compiled tape + undo/redo + Part-A brick scaffold
//--------------------------------------------------------------------------------------------------------------------------
let strokes: StrokeRecord[] = [];

type DocAction =
    | { kind: 'stroke'; stroke: StrokeRecord }
    | { kind: 'clear-strokes'; strokes: StrokeRecord[] };

const undoStack: DocAction[] = [];
const redoStack: DocAction[] = [];

const stEdits = Q('#st-edits');
let compiled = CompileField(graph, strokes);
let tapeWarned = false;

// Part-A scaffold — tracks what a sparse 8³ brick cache *would* dirty each stroke.
// Today this is instrumentation only (the analytic raymarcher is still the display path);
// once the volume raymarcher lands, dirty bricks become the incremental rebuild work.
const brickPool = new BrickPool();
let totalRawDabs = 0, totalKeptDabs = 0;

//--------------------------------------------------------------------------------------------------------------------------
// Erosion preview — 1+2 droplet+thermal on 512² tile, toggleable behind Erode node
//--------------------------------------------------------------------------------------------------------------------------
const erosion = new ErosionPreview(viewport.scene, fieldPass);
let erosionDirty = true; void erosionDirty; // bake needed after field changes (manual Run)

function ErodeNode(): { uid: string; params: Record<string, number> } | null
{
    for (const n of graph.nodes.values())
    {
        if (n.specId === 'erode' && !n.muted)
        {
            // must have an incoming field wire to be considered connected
            const hasField = [...graph.wires.values()].some(w => w.toNode === n.uid);
            if (!hasField) continue;
            return { uid: n.uid, params: n.params };
        }
    }
    return null;
}

function ReadErodeSettings(p: Record<string, number>): ErodeSettings
{
    const s: ErodeSettings = { ...DefaultErodeSettings };
    s.tileSize   = p['tileSize']   ?? s.tileSize;
    s.resolution = Math.min(Math.max(Math.round(p['resolution'] ?? s.resolution), 128), 512);
    // snap to 64 for geometry
    s.resolution = Math.round(s.resolution / 64) * 64;
    s.iterations = Math.round(p['iterations'] ?? s.iterations);
    s.droplets   = Math.round(p['droplets'] ?? s.droplets);
    s.erodeRate  = p['erodeRate']  ?? s.erodeRate;
    s.deposit    = p['deposit']    ?? s.deposit;
    s.talus      = p['talus']      ?? s.talus;
    s.thermal    = Math.round(p['thermal'] ?? s.thermal);
    return s;
}

function UpdateErosionHint(): void
{
    const hint = document.getElementById('erosion-hint') as HTMLElement | null;
    const stats = document.getElementById('erosion-stats') as HTMLElement | null;
    if (!hint) return;
    const node = ErodeNode();
    if (!node) { hint.textContent = 'connect Erode node (SDF → Erode → Output)'; if (stats) stats.textContent = 'idle — connect Erode node'; return; }
    const s = ReadErodeSettings(node.params);
    hint.textContent = `${s.resolution}² · tile ${s.tileSize} m · iters ${s.iterations} · drops ${s.droplets}`;
    if (!erosion.HasResult() && stats) stats.textContent = `ready — thermal ${s.thermal}× talus ${s.talus}° · erode ${s.erodeRate.toFixed(2)} deposit ${s.deposit.toFixed(2)}`;
}

function EnsureErosionPanel(): HTMLElement | null
{
    let panel = document.getElementById('erosion-panel') as HTMLElement | null;
    let fab   = document.getElementById('erosion-fab') as HTMLElement | null;
    const viewportEl = document.getElementById('viewport');
    if (!viewportEl) return null;
    // Create panel dynamically if index.html is stale (Arena preview caching)
    if (!panel || !fab)
    {
        // remove stale partials
        panel?.remove(); fab?.remove();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = `
        <div class="erosion-panel" id="erosion-panel">
            <div class="erosion-head">
                <i data-icon="erosion"></i>
                <div>
                    <div class="erosion-title">Erode — 1+2 preview</div>
                    <div class="erosion-sub">512² tile · thermal + droplet · sphere</div>
                </div>
                <div class="spacer"></div>
                <button class="btn ghost icon small" id="erosion-close" data-icon="close" title="Hide"></button>
            </div>
            <div class="erosion-body">
                <div id="erosion-canvas-host" class="erosion-canvas-host"></div>
                <div class="erosion-stats mono" id="erosion-stats">idle — connect Erode node</div>
            </div>
            <div class="erosion-actions">
                <button class="btn small" id="erosion-run">▶ Run 1+2</button>
                <button class="btn small ghost" id="erosion-reset">Reset</button>
                <label class="erosion-toggle"><span>3D</span><div class="switch" id="erosion-3d" data-on="false"></div></label>
                <span class="spacer"></span>
                <span class="hint mono" id="erosion-hint">no bake yet</span>
            </div>
        </div>
        <button class="round-btn erosion-fab" id="erosion-fab" title="Erosion preview (1+2)" data-icon="erosion"></button>`;
        while (wrapper.firstChild) viewportEl.appendChild(wrapper.firstChild);
        HydrateGlyphs(viewportEl);
        panel = document.getElementById('erosion-panel') as HTMLElement;
        fab   = document.getElementById('erosion-fab') as HTMLElement;
    }
    return panel;
}

function InitErosionUI(): void
{
    const panel = EnsureErosionPanel();
    const fab   = document.getElementById('erosion-fab') as HTMLElement | null;
    const host  = document.getElementById('erosion-canvas-host') as HTMLElement | null;
    const close = document.getElementById('erosion-close') as HTMLElement | null;
    const run   = document.getElementById('erosion-run') as HTMLButtonElement | null;
    const reset = document.getElementById('erosion-reset') as HTMLButtonElement | null;
    const sw3d  = document.getElementById('erosion-3d') as HTMLElement | null;
    const stats = document.getElementById('erosion-stats') as HTMLElement | null;
    if (!panel || !fab || !host || !run || !reset || !sw3d) { console.warn('[Erosion] UI missing', {panel:!!panel, fab:!!fab, host:!!host}); return; }

    // mount canvas
    host.innerHTML = ''; host.appendChild(erosion.canvas);
    UpdateErosionHint();
    HydrateGlyphs(panel);

    const togglePanel = (show?: boolean) =>
    {
        const willShow = show ?? !panel.classList.contains('show');
        panel.classList.toggle('show', willShow);
        fab.classList.toggle('active', willShow);
    };
    fab.onclick = () => togglePanel();
    if (close) close.onclick = () => togglePanel(false);

    sw3d.onclick = () =>
    {
        const on = sw3d.dataset.on !== 'true';
        sw3d.dataset.on = String(on);
        erosion.SetVisible(on);
        // SDF erosion toggles inside FieldPass — field mesh always stays visible
        if (on && !erosion.HasResult()) ShowToast('Press Run 1+2 first to generate eroded SDF');
    };
    reset.onclick = () =>
    {
        erosion.Reset();
        sw3d.dataset.on = 'false';
        erosion.SetVisible(false);
        if (stats) stats.textContent = 'reset — original SDF';
        ShowToast('Erosion reset — SDF restored');
    };
    run.onclick = async () =>
    {
        const node = ErodeNode();
        console.log('[Erosion] Run clicked, node:', node);
        if (!node) { ShowToast('Connect SDF → Erode → Terrain Output (field blue) to erode'); togglePanel(true); return; }
        const s = ReadErodeSettings(node.params);
        console.log('[Erosion] settings', s, 'compiled', compiled.count);
        if (compiled.count === 0) { ShowToast('No SDF to erode — add a primitive'); return; }
        run.disabled = true; const prev = run.textContent; run.textContent = '⏳ Baking…'; if (stats) stats.textContent = 'Baking heightfield…';
        try
        {
            await erosion.BakeAndErode(compiled, s, (msg) => { if (stats) stats.textContent = msg; console.log('[Erosion]', msg); });
            const has = erosion.HasResult();
            console.log('[Erosion] done, hasResult', has);
            if (has) {
                sw3d.dataset.on = 'true';
                erosion.SetVisible(true);
                ShowToast(`Eroded ${s.resolution}² — SDF erosion active (toggle 3D off to see original SDF)`);
                togglePanel(true);
            }
            UpdateErosionHint();
        } catch (e) { console.error(e); ShowToast('Erosion failed — see console'); if (stats) stats.textContent = String(e); }
        finally { run.disabled = false; run.textContent = prev ?? '▶ Run 1+2'; }
    };

    // Inject a Run button directly into the Erode node card for discoverability
    const injectNodeButton = () =>
    {
        const node = ErodeNode();
        if (!node) return;
        const card = document.querySelector(`.node[data-uid="${node.uid}"]`) as HTMLElement | null;
        if (!card) return;
        if (card.querySelector('.erode-run-inline')) return;
        const paramsBox = card.querySelector('.node-params') as HTMLElement | null;
        if (!paramsBox) return;
        const btn = document.createElement('button');
        btn.className = 'btn small erode-run-inline';
        btn.textContent = '▶ Erode sphere';
        btn.style.marginTop = '6px'; btn.style.width = '100%';
        btn.title = 'Bakes 512² tile and runs 1+2 (thermal+droplet)';
        btn.onclick = (e) => { e.stopPropagation(); (document.getElementById('erosion-run') as HTMLButtonElement)?.click(); const p = document.getElementById('erosion-panel'); if (p) p.classList.add('show'); const f = document.getElementById('erosion-fab'); if (f) f.classList.add('active'); };
        paramsBox.appendChild(btn);
    };
    // try now and after graph changes
    injectNodeButton();
    const obs = new MutationObserver(() => injectNodeButton());
    obs.observe(document.getElementById('graph-layer')!, { childList: true, subtree: true });

    if (ErodeNode()) togglePanel(true);
    console.log('[Erosion] UI initialised');
}

// initialise after a tick to ensure viewport/graph exist, retry if needed
let erosionInitTries = 0;
function TryInitErosion(): void
{
    try { InitErosionUI(); } catch (e) { console.error('[Erosion] init failed', e); }
    if (!document.getElementById('erosion-fab') && erosionInitTries < 5) { erosionInitTries++; setTimeout(TryInitErosion, 300); }
}
requestAnimationFrame(() => setTimeout(TryInitErosion, 100));
setTimeout(TryInitErosion, 800);


function RebuildField(): void
{
    // drop strokes whose primitive node no longer exists
    strokes = strokes.filter((s) => graph.nodes.has(s.node));

    const live = sculpt.liveStroke;
    compiled = CompileField(graph, live ? [...strokes, live] : strokes);
    fieldPass.UploadTape(compiled.data, compiled.count);
    sculpt.SetField(compiled);
    // EDITS chip shows tape instructions; the tooltip shows raw→coalesced compression when active
    stEdits.textContent = String(compiled.count);
    const eff = totalKeptDabs > 0 ? (totalRawDabs / totalKeptDabs).toFixed(1) : '–';
    stEdits.title = `Tape ${compiled.count} instr · ${totalKeptDabs} dabs stored (×${eff} coalesced) · ${brickPool.bricks.size} bricks touched`;

    if (compiled.truncated && !tapeWarned)
    {
        tapeWarned = true;
        ShowToast('Edit tape full — older detail is being dropped. Brick cache lands in Phase 2.');
    }
    RefreshBrickRead?.();
    // erosion tile is now stale — next Run will re-bake from this compiled field
    erosionDirty = true;
    UpdateErosionHint();
}

let rebuildQueued = false;
function QueueRebuild(): void
{
    if (rebuildQueued) return;
    rebuildQueued = true;
    requestAnimationFrame(() => { rebuildQueued = false; RebuildField(); });
}

function UndoDoc(): void
{
    const action = undoStack.pop();
    if (!action) { ShowToast('Nothing to undo'); return; }
    if (action.kind === 'stroke')
    {
        const i = strokes.lastIndexOf(action.stroke);
        if (i >= 0) strokes.splice(i, 1);
    }
    else strokes = action.strokes;
    redoStack.push(action);
    RebuildField();
}

function RedoDoc(): void
{
    const action = redoStack.pop();
    if (!action) { ShowToast('Nothing to redo'); return; }
    if (action.kind === 'stroke') strokes.push(action.stroke);
    else strokes = [];
    undoStack.push(action);
    RebuildField();
}

//---------------------------------------------------------------- save / load / new
function SerialiseDocument(): string
{
    const nodes = [...graph.nodes.values()].map((n) => ({
        uid: n.uid, spec: n.specId, x: n.x, y: n.y,
        collapsed: n.collapsed, muted: n.muted, params: n.params,
    }));
    const wires = [...graph.wires.values()].map((w) => ({
        from: w.fromNode, fromPort: w.fromPort, to: w.toNode, toPort: w.toPort, type: w.type,
    }));
    return JSON.stringify({ app: 'SolidScape', version: 1, nodes, wires, strokes }, null, 1);
}

function LoadDocument(json: string): void
{
    const doc = JSON.parse(json) as {
        app?: string;
        nodes?: { uid: string; spec: string; x: number; y: number; collapsed?: boolean; muted?: boolean;
                  params?: Record<string, number> }[];
        wires?: { from: string; fromPort: string; to: string; toPort: string; type: string }[];
        strokes?: StrokeRecord[];
    };
    if (doc.app !== 'SolidScape') throw new Error('not a SolidScape document');

    graph.ClearGraph();
    strokes = [];
    undoStack.length = 0;
    redoStack.length = 0;
    brickPool.Reset();
    totalRawDabs = totalKeptDabs = 0;

    const remap = new Map<string, string>();
    for (const n of doc.nodes ?? [])
    {
        if (!CatalogueIndex.has(n.spec)) continue;
        const node = graph.AddNode(n.spec, n.x, n.y);
        if (!node) continue;
        remap.set(n.uid, node.uid);
        if (n.params) Object.assign(node.params, n.params);
        if (n.collapsed) { graph.selection.clear(); graph.selection.add(node.uid); graph.ToggleCollapse(); }
        if (n.muted)     { graph.selection.clear(); graph.selection.add(node.uid); graph.ToggleMute(); }
    }
    graph.selection.clear();

    for (const w of doc.wires ?? [])
    {
        const from = remap.get(w.from);
        const to   = remap.get(w.to);
        if (!from || !to) continue;
        const wid = `w-load-${Math.random().toString(36).slice(2, 8)}`;
        graph.wires.set(wid, { uid: wid, fromNode: from, fromPort: w.fromPort,
                               toNode: to, toPort: w.toPort, type: w.type as 'field' });
    }

    let loadedStored = 0;
    for (const s of doc.strokes ?? [])
    {
        const node = remap.get(s.node);
        if (node) { strokes.push({ node, dabs: s.dabs }); brickPool.MarkDabs(s.dabs); loadedStored += s.dabs.length; }
    }
    if (strokes.length) brickPool.CommitStroke(loadedStored, loadedStored);
    totalRawDabs = loadedStored;
    totalKeptDabs = loadedStored;

    graph.Hydrate();
    graph.RedrawWires();
    graph.FrameGraph();
    RebuildField();
    ShowToast(`Loaded — ${graph.nodes.size} nodes · ${strokes.length} strokes`);
}

function SaveDocument(): void
{
    const blob = new Blob([SerialiseDocument()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'terrain.solidscape';
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
    ShowToast('Document saved');
}

function NewDocument(): void
{
    graph.ClearGraph();
    strokes = [];
    undoStack.length = 0;
    redoStack.length = 0;
    tapeWarned = false;
    brickPool.Reset();
    totalRawDabs = totalKeptDabs = 0;
    SeedGraph();
    RebuildField();
    ShowToast('New terrain');
}

//--------------------------------------------------------------------------------------------------------------------------
// Sculpt controller + Part-A wiring
//--------------------------------------------------------------------------------------------------------------------------
const sculpt = new SculptController(viewport, fieldPass, Q<HTMLCanvasElement>('#viewport-canvas'));

let RefreshBrickRead: (() => void) | null = null;
function InstallPartAReadouts(): void
{
    const brickRead = Q<HTMLElement>('#brick-read');
    const coalesceRead = Q<HTMLElement>('#coalesce-read');
    const sw = Q<HTMLElement>('#opt-coalesce');
    if (!brickRead || !coalesceRead || !sw) return;

    RefreshBrickRead = () =>
    {
        const eff = totalKeptDabs > 0 ? (totalRawDabs / totalKeptDabs).toFixed(1) : '–';
        coalesceRead.textContent = sculpt.coalesceEnabled ? `coalesce on · ×${eff}` : 'coalesce off';
        const last = brickPool.lastDirty ? `${brickPool.lastDirty} dirty last stroke · ` : '';
        brickRead.textContent = `${last}${brickPool.bricks.size} bricks touched`;
        (brickRead as HTMLElement).title = `Brick voxel ${brickPool.voxel.toFixed(2)} m · brick world ${(8 * brickPool.voxel).toFixed(1)} m · adapts with band ${ (6 * brickPool.voxel).toFixed(2)} m`;
    };
    BindSwitch(sw, (on) => { sculpt.coalesceEnabled = on; RefreshBrickRead?.(); });
    RefreshBrickRead();
}
// Install after the panel DOM exists (BuildSkyPanel already ran) — deferred via rAF to guarantee #brick-read exists
requestAnimationFrame(() => InstallPartAReadouts());

sculpt.onStrokeLive = () => QueueRebuild();

sculpt.onStrokeCoalesced = (raw, kept, ratio) =>
{
    void raw; void kept; void ratio;
};

sculpt.onStrokeCommitted = (stroke) =>
{
    // stroke.dabs is already coalesced at this point (sculpt.ts); retrieve coalesce counts by
    // comparing to a synthetic raw that was recorded in onStrokeCoalesced — easiest is to capture
    // there, but to keep sculpt.ts dependency-free we recompute here: the stroke we receive IS the
    // kept set, so we need the raw count from the coalescer side-channel. Store it on the stroke
    // via a temporary property stashed on window is ugly; instead track via lastCommittedRaw below.
    strokes.push(stroke);
    undoStack.push({ kind: 'stroke', stroke });
    redoStack.length = 0;

    const kept = stroke.dabs.length;
    const raw = (stroke as unknown as { __raw?: number }).__raw ?? kept;
    // don't persist the side-channel property in the document
    delete (stroke as unknown as { __raw?: number }).__raw;
    brickPool.MarkDabs(stroke.dabs);
    const metrics = brickPool.CommitStroke(raw, kept);
    totalRawDabs += metrics.rawDabs;
    totalKeptDabs += metrics.keptDabs;
    if (raw !== kept)
        ShowToast(`Stroke ${raw} dabs → ${kept} ${kept === 1 ? 'capsule' : 'capsules/spheres'} (×${metrics.coalesceRatio.toFixed(1)}) · ${metrics.dirtyBricks} bricks dirty`);

    RebuildField();
};

sculpt.onMissedSurface = () =>
{
    if (compiled.count === 0)
        ShowToast('No shapes yet — add an SDF Sphere / Box / Cylinder node to sculpt on');
    else
        ShowToast('Click on a surface to sculpt — strokes bind to the shape under the cursor');
};

graph.onParamChanged = () => { brickPool.InvalidateAll(); erosionDirty = true; UpdateErosionHint(); QueueRebuild(); };

RebuildField();

Q<HTMLInputElement>('#load-file').addEventListener('change', (e) =>
{
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    file.text()
        .then((json) => LoadDocument(json))
        .catch(() => ShowToast('Could not read that file'));
    (e.target as HTMLInputElement).value = '';
});

//---------------------------------------------------------------- sculpt toolbar
const SculptHints: [string, string][] =
[
    ['LMB drag', 'sculpt on surface'],
    ['Ctrl + LMB', 'invert (build ⇄ carve)'],
    ['[ · ]', 'brush radius'],
    ['Ctrl + Wheel', 'brush radius'],
    ['RMB / MMB', 'camera still works'],
    ['1 2 3 4', 'switch tool'],
];

function SetActiveTool(tool: SculptTool): void
{
    sculpt.SetTool(tool);
    Q('#sculpt-toolbar').querySelectorAll<HTMLElement>('.tbtn.tool').forEach((b) =>
        b.classList.toggle('active', b.dataset.tool === tool));
    // dim bottom brush bar when in select mode — mirrors Blender's header dimming
    Q('#vp-status').classList.toggle('brush-off', tool === 'select');

    if (tool === 'select')
    {
        PaintHints(viewport.scheme);
    }
    else
    {
        Q('#vp-hints').innerHTML = SculptHints
            .map(([k, v]) => `<div class="hint-row"><span class="kbd">${k}</span><span>${v}</span></div>`)
            .join('');
    }
}

Q('#sculpt-toolbar').querySelectorAll<HTMLElement>('.tbtn.tool').forEach((b) =>
{
    b.addEventListener('click', () => SetActiveTool(b.dataset.tool as SculptTool));
});

Q('#sculpt-toolbar').querySelectorAll<HTMLElement>('.tbtn.shape').forEach((b) =>
{
    b.addEventListener('click', () =>
    {
        Q('#sculpt-toolbar').querySelectorAll('.tbtn.shape').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        sculpt.brush.shape = Number(b.dataset.shape) as ShapeType;
    });
});

//---------------------------------------------------------------- bottom brush bar — size / intensity / falloff / spacing (ZBrush/Blender-style)
function formatSize(v: number): string
{
    return v >= 10 ? `${v.toFixed(1)} m` : v >= 1 ? `${v.toFixed(2)} m` : `${(v * 100).toFixed(0)} cm`;
}
function formatIntensity(v: number): string { return v.toFixed(2); }
function formatFalloff(v: number): string
{
    if (v < 0.2) return 'Soft';
    if (v < 0.45) return 'Smooth';
    if (v < 0.70) return 'Sharp';
    return 'Hard';
}
function formatSpacing(v: number): string { return `${Math.round(v * 100)}%`; }

type Repaintable = HTMLElement & { repaint?: () => void };
const bottomRepaints: Repaintable[] = [];

function BindBottomScrub(
    id: string, get: () => number, set: (v: number) => void,
    min: number, max: number, format: (v: number) => string): Repaintable
{
    const root = Q<HTMLElement>(id);
    const fill = root.querySelector<HTMLElement>('.fill')!;
    const val  = root.querySelector<HTMLElement>('.val')!;
    const paint = () =>
    {
        const v = get();
        val.textContent = format(v);
        const t = (v - min) / (max - min);
        fill.style.transform = `scaleX(${Math.min(Math.max(t, 0), 1)})`;
        root.title = `${root.querySelector('.st-key')?.textContent ?? ''} — ${val.textContent} · drag, double-click to reset`;
    };
    (root as Repaintable).repaint = paint;
    bottomRepaints.push(root as Repaintable);
    paint();

    let dragging = false;
    let lastX = 0;
    root.addEventListener('pointerdown', (e) =>
    {
        dragging = true; lastX = e.clientX;
        root.classList.add('dragging');
        root.setPointerCapture(e.pointerId);
        e.preventDefault();
    });
    root.addEventListener('pointermove', (e) =>
    {
        if (!dragging) return;
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        const rate = (e.shiftKey ? 0.18 : 1) * (max - min) / 220;
        const next = Math.min(max, Math.max(min, get() + dx * rate));
        set(next);
        paint();
    });
    const stop = (e: PointerEvent) =>
    {
        dragging = false;
        root.classList.remove('dragging');
        if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
    };
    root.addEventListener('pointerup', stop);
    root.addEventListener('pointercancel', stop);
    root.addEventListener('dblclick', () =>
    {
        const defaults: Record<string, number> = { '#vb-size': 2.0, '#vb-intensity': 0.5, '#vb-falloff': 0.5, '#vb-spacing': 0.45 };
        set(defaults[id] ?? (min + max) * 0.5);
        paint();
    });
    return root as Repaintable;
}

BindBottomScrub('#vb-size',      () => sculpt.brush.radius,   (v) => { sculpt.brush.radius = v; },   0.1, 40, formatSize);
BindBottomScrub('#vb-intensity', () => sculpt.brush.strength, (v) => { sculpt.brush.strength = v; }, 0, 1, formatIntensity);
BindBottomScrub('#vb-falloff',   () => sculpt.brush.falloff,  (v) => { sculpt.brush.falloff = v; },  0, 1, formatFalloff);
BindBottomScrub('#vb-spacing',   () => sculpt.brush.spacing,  (v) => { sculpt.brush.spacing = v; },  0.05, 1.0, formatSpacing);

// autosmooth toggle at the end of the brush strip
{
    const tog = Q('#vb-autosmooth');
    const sw  = tog.querySelector<HTMLElement>('.switch')!;
    const sync = () => { sw.dataset.on = String(sculpt.brush.autosmooth); };
    sync();
    const flip = () => { sculpt.brush.autosmooth = !sculpt.brush.autosmooth; sync(); };
    tog.addEventListener('click', flip);
    sw.addEventListener('click', (e) => { e.stopPropagation(); flip(); });
}

sculpt.onBrushChanged = () => bottomRepaints.forEach((r) => r.repaint?.());
sculpt.onToolChanged  = () => bottomRepaints.forEach((r) => r.repaint?.());
Q('#vp-status').classList.add('brush-off');

//---------------------------------------------------------------- selection toolbar
const nodeToolbar = Q('#node-toolbar');
graph.onSelectionChanged = () =>
{
    const bounds = graph.SelectionBounds();
    if (!bounds || graph.selection.size === 0)
    {
        nodeToolbar.classList.remove('show');
        return;
    }
    nodeToolbar.classList.add('show');
    const tw = nodeToolbar.offsetWidth || 240;
    const left = Math.min(Math.max(bounds.left + bounds.width / 2 - tw / 2, 12),
        Q('#editor').clientWidth - tw - 12);
    nodeToolbar.style.left = `${left}px`;
    nodeToolbar.style.top  = `${Math.max(bounds.top - 52, 12)}px`;
};

nodeToolbar.querySelectorAll<HTMLElement>('.ntbtn').forEach((b) =>
{
    b.addEventListener('click', () =>
    {
        switch (b.dataset.act)
        {
            case 'collapse': graph.ToggleCollapse(); break;
            case 'preview':  graph.ToggleMute();     break;
            case 'delete':   graph.DeleteSelection();break;
            default: b.classList.toggle('active');   break;
        }
    });
});

//---------------------------------------------------------------- build status
const bpFill  = Q('#bp-fill');
const bpPct   = Q('#bp-pct');
const bpLabel = Q('#bp-label');

graph.onGraphChanged = () =>
{
    brickPool.InvalidateAll();
    erosionDirty = true;
    UpdateErosionHint();
    QueueRebuild();
    bpLabel.textContent = 'Building';
    bpFill.style.width = '18%';
    bpPct.textContent = '18%';
    window.setTimeout(() =>
    {
        bpFill.style.width = '100%';
        bpPct.textContent = '100%';
        bpLabel.textContent = 'Built';
    }, 320);
};

//---------------------------------------------------------------- graph toolbar
Q('#tool-grid').addEventListener('click', () =>
{
    graph.snapEnabled = !graph.snapEnabled;
    Q('#tool-grid').classList.toggle('active', graph.snapEnabled);
    Q<HTMLElement>('#opt-snap').dataset.on = String(graph.snapEnabled);
});
Q('#tool-tune').addEventListener('click', () => ToggleDropdown());
Q('#tool-build').addEventListener('click', () => graph.onGraphChanged?.());

//---------------------------------------------------------------- settings dropdown
const dropdown = Q('#graph-settings');
function ToggleDropdown(force?: boolean): void
{
    const show = force ?? !dropdown.classList.contains('show');
    dropdown.classList.toggle('show', show);
    Q('#graph-settings-btn').classList.toggle('active', show);
}
Q('#graph-settings-btn').addEventListener('click', (e) => { e.stopPropagation(); ToggleDropdown(); });

const canvasControls = Q('#canvas-controls');
BindSwitch(Q('#opt-canvas-controls'), (on) => canvasControls.classList.toggle('show', on));
BindSwitch(Q('#opt-snap'), (on) =>
{
    graph.snapEnabled = on;
    Q('#tool-grid').classList.toggle('active', on);
});

dropdown.querySelectorAll<HTMLElement>('.dp-opt').forEach((opt) =>
{
    opt.addEventListener('click', () =>
    {
        dropdown.querySelectorAll('.dp-opt').forEach((o) => o.classList.remove('sel'));
        opt.classList.add('sel');
        graph.SetBackground(opt.dataset.bg as 'dots' | 'lines' | 'blank');
    });
});

//---------------------------------------------------------------- zoom cluster
const zoomRead = Q('#zoom-read');
function RefreshZoomRead(): void { zoomRead.textContent = `${Math.round(graph.zoom * 100)}%`; }
Q('#zoom-in').addEventListener('click',  () => { graph.SetZoom(graph.zoom * 1.15); RefreshZoomRead(); });
Q('#zoom-out').addEventListener('click', () => { graph.SetZoom(graph.zoom / 1.15); RefreshZoomRead(); });
Q('#zoom-fit').addEventListener('click', () => { graph.FrameGraph(); RefreshZoomRead(); });
Q('#graph-surface').addEventListener('wheel', () => window.setTimeout(RefreshZoomRead, 0), { passive: true });
RefreshZoomRead();

//--------------------------------------------------------------------------------------------------------------------------
// Node palette
//--------------------------------------------------------------------------------------------------------------------------
const palette      = Q('#palette');
const paletteList  = Q('#palette-list');
const paletteInput = Q<HTMLInputElement>('#palette-input');
let paletteDrop = { x: 120, y: 120 };
let paletteCursor = 0;

function PaletteRows(): HTMLElement[]
{
    return [...paletteList.querySelectorAll<HTMLElement>('.pal-item')];
}

function BuildPalette(query = ''): void
{
    const needle = query.trim().toLowerCase();
    paletteList.innerHTML = '';

    for (const group of GroupOrder)
    {
        const members = NodeCatalogue.filter((n) =>
            n.group === group && n.id !== 'start' &&
            (!needle || n.name.toLowerCase().includes(needle) || n.desc.toLowerCase().includes(needle)));
        if (members.length === 0) continue;

        const head = document.createElement('div');
        head.className = 'pal-group';
        head.innerHTML = `<i data-icon="${GroupGlyphs[group]}"></i><span>${group}</span>
            <i class="caret" data-icon="chevron-down"></i>`;
        paletteList.appendChild(head);

        const body = document.createElement('div');
        body.className = 'pal-body';
        paletteList.appendChild(body);

        head.addEventListener('click', () =>
        {
            head.classList.toggle('closed');
            body.classList.toggle('hidden');
        });

        for (const spec of members)
        {
            const row = document.createElement('div');
            row.className = 'pal-item';
            row.dataset.spec = spec.id;
            row.innerHTML = `
                <div><div class="pi-name">${spec.name}</div><div class="pi-desc">${spec.desc}</div></div>
                <i class="pi-add" data-icon="plus"></i>`;
            row.addEventListener('click', () => SpawnFromPalette(spec));
            body.appendChild(row);
        }
    }

    HydrateGlyphs(paletteList);
    paletteCursor = 0;
    MarkPaletteCursor();
}

function MarkPaletteCursor(): void
{
    const rows = PaletteRows();
    rows.forEach((r, i) => r.classList.toggle('cursor', i === paletteCursor));
    rows[paletteCursor]?.scrollIntoView({ block: 'nearest' });
}

function SpawnFromPalette(spec: NodeSpecification): void
{
    const node = graph.AddNode(spec.id, paletteDrop.x, paletteDrop.y);
    if (node)
    {
        graph.Hydrate();
        graph.selection.clear();
        graph.selection.add(node.uid);
        graph.RefreshSelection();
    }
    ClosePalette();
}

function OpenPalette(clientX: number, clientY: number): void
{
    const editorRect = Q('#editor').getBoundingClientRect();
    const g = graph.ScreenToGraph(clientX, clientY);
    paletteDrop = g;

    palette.classList.add('show');
    const px = Math.min(clientX - editorRect.left, editorRect.width - palette.offsetWidth - 16);
    const py = Math.min(clientY - editorRect.top,  editorRect.height - palette.offsetHeight - 16);
    palette.style.left = `${Math.max(px, 12)}px`;
    palette.style.top  = `${Math.max(py, 12)}px`;

    paletteInput.value = '';
    BuildPalette();
    window.setTimeout(() => paletteInput.focus(), 10);
}

function ClosePalette(): void { palette.classList.remove('show'); }

paletteInput.addEventListener('input', () => BuildPalette(paletteInput.value));
paletteInput.addEventListener('keydown', (e) =>
{
    const rows = PaletteRows();
    if (e.key === 'ArrowDown') { paletteCursor = Math.min(paletteCursor + 1, rows.length - 1); MarkPaletteCursor(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { paletteCursor = Math.max(paletteCursor - 1, 0); MarkPaletteCursor(); e.preventDefault(); }
    else if (e.key === 'Enter')
    {
        const pick = rows[paletteCursor];
        const spec = NodeCatalogue.find((n) => n.id === pick?.dataset.spec);
        if (spec) SpawnFromPalette(spec);
    }
    else if (e.key === 'Escape') ClosePalette();
});
BuildPalette();

//--------------------------------------------------------------------------------------------------------------------------
// Graph context menu
//--------------------------------------------------------------------------------------------------------------------------
const ctx = Q('#graph-ctx');

function OpenContext(clientX: number, clientY: number, overNode: boolean): void
{
    const editorRect = Q('#editor').getBoundingClientRect();
    const count = graph.selection.size;

    const items = overNode
        ? [
            { icon: 'text',     label: 'Rename',      kbd: 'F2',  act: 'rename' },
            { icon: 'copy',     label: 'Duplicate',   kbd: '⌘D',  act: 'duplicate' },
            { icon: 'minus',    label: 'Collapse',    kbd: 'H',   act: 'collapse' },
            { icon: 'eye',      label: 'Mute',        kbd: 'M',   act: 'mute' },
            { sep: true },
            { icon: 'trash',    label: 'Delete',      kbd: '⌫',   act: 'delete', danger: true },
          ]
        : [
            { icon: 'plus',     label: 'Add Node…',   kbd: 'Tab', act: 'add' },
            { icon: 'focus',    label: 'Frame Graph', kbd: 'F',   act: 'frame' },
            { sep: true },
            { icon: 'grid',     label: graph.snapEnabled ? 'Disable Snap' : 'Enable Snap', kbd: '', act: 'snap' },
            { icon: 'sliders',  label: 'Graph Settings', kbd: '', act: 'settings' },
          ];

    ctx.innerHTML = `
        <div class="ctx-header">
            <div class="ph-icon" data-icon="${overNode ? 'cube' : 'grid'}"></div>
            <div>
                <div class="t">${overNode ? (count > 1 ? `${count} Nodes` : 'Node') : 'Graph Canvas'}</div>
                <div class="s">${overNode ? 'SDF operator' : 'SolidScape node graph'}</div>
            </div>
        </div>
        <div class="ctx-body">
            ${items.map((i) => 'sep' in i
                ? '<div class="sep"></div>'
                : `<div class="mi ${'danger' in i && i.danger ? 'danger' : ''}" data-act="${i.act}">
                       <i data-icon="${i.icon}"></i>${i.label}
                       ${i.kbd ? `<span class="kbd">${i.kbd}</span>` : ''}
                   </div>`).join('')}
        </div>`;

    HydrateGlyphs(ctx);
    ctx.classList.add('show');
    const cx = Math.min(clientX - editorRect.left, editorRect.width  - ctx.offsetWidth  - 12);
    const cy = Math.min(clientY - editorRect.top,  editorRect.height - ctx.offsetHeight - 12);
    ctx.style.left = `${Math.max(cx, 8)}px`;
    ctx.style.top  = `${Math.max(cy, 8)}px`;

    ctx.querySelectorAll<HTMLElement>('.mi').forEach((mi) =>
    {
        mi.addEventListener('click', () =>
        {
            switch (mi.dataset.act)
            {
                case 'add':       OpenPalette(clientX, clientY); break;
                case 'frame':     graph.FrameGraph(); RefreshZoomRead(); break;
                case 'snap':      graph.snapEnabled = !graph.snapEnabled;
                                  Q('#tool-grid').classList.toggle('active', graph.snapEnabled);
                                  Q<HTMLElement>('#opt-snap').dataset.on = String(graph.snapEnabled); break;
                case 'settings':  ToggleDropdown(true); break;
                case 'duplicate': graph.DuplicateSelection(); graph.Hydrate(); break;
                case 'collapse':  graph.ToggleCollapse(); break;
                case 'mute':      graph.ToggleMute(); break;
                case 'delete':    graph.DeleteSelection(); break;
            }
            ctx.classList.remove('show');
        });
    });
}

Q('#graph-surface').addEventListener('contextmenu', (e) =>
{
    e.preventDefault();
    const overNode = !!(e.target as HTMLElement).closest('.node');
    if (overNode)
    {
        const uid = (e.target as HTMLElement).closest<HTMLElement>('.node')!.dataset.uid!;
        if (!graph.selection.has(uid))
        {
            graph.selection.clear();
            graph.selection.add(uid);
            graph.RefreshSelection();
        }
    }
    OpenContext(e.clientX, e.clientY, overNode);
});

//--------------------------------------------------------------------------------------------------------------------------
// Global dismissal + shortcuts
//--------------------------------------------------------------------------------------------------------------------------
document.addEventListener('pointerdown', (e) =>
{
    const t = e.target as HTMLElement;
    if (!t.closest('#graph-ctx'))       ctx.classList.remove('show');
    if (!t.closest('#palette'))         ClosePalette();
    if (!t.closest('#graph-settings') && !t.closest('#graph-settings-btn') && !t.closest('#tool-tune'))
        ToggleDropdown(false);
}, true);

document.addEventListener('keydown', (e) =>
{
    const typing = (e.target as HTMLElement).tagName === 'INPUT';
    if (typing) return;

    const overEditor = document.activeElement !== Q('#viewport-canvas');

    //---------------------------------------------------------------- document-wide shortcuts
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey)
    {
        e.preventDefault();
        UndoDoc();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)))
    {
        e.preventDefault();
        RedoDoc();
        return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's')
    {
        e.preventDefault();
        SaveDocument();
        return;
    }

    //---------------------------------------------------------------- sculpt tool switching (viewport side)
    if (!overEditor && !e.ctrlKey && !e.metaKey)
    {
        const toolByKey: Record<string, SculptTool> =
            { Digit1: 'select', Digit2: 'build', Digit3: 'carve', Digit4: 'smooth' };
        const tool = toolByKey[e.code];
        if (tool) { SetActiveTool(tool); return; }
    }

    if (e.key === 'Tab' && overEditor)
    {
        e.preventDefault();
        const r = Q('#editor').getBoundingClientRect();
        OpenPalette(r.left + r.width / 2 - 140, r.top + 150);
    }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && overEditor && graph.selection.size)
    {
        e.preventDefault();
        graph.DeleteSelection();
    }
    else if (e.key.toLowerCase() === 'd' && (e.ctrlKey || e.metaKey) && overEditor)
    {
        e.preventDefault();
        graph.DuplicateSelection();
        graph.Hydrate();
    }
    else if (e.key.toLowerCase() === 'f' && overEditor && !e.ctrlKey && !e.metaKey)
    {
        graph.FrameGraph();
        RefreshZoomRead();
    }
    else if (e.key === 'Escape')
    {
        ClosePalette();
        ctx.classList.remove('show');
        ToggleDropdown(false);
    }
});

// glyphs added after dynamic construction
graph.Hydrate();
HydrateGlyphs();

// keep wires aligned when the split pane resizes the editor
new ResizeObserver(() => graph.RedrawWires()).observe(Q('#editor'));

void RenderGlyph;
