//============================================================================================================================================
// SolidScape — Application entry: viewport / node editor shell composition
//============================================================================================================================================

import { ViewportPresentation, DefaultSky, type CameraScheme } from './viewport';
import { GraphSurface } from './graph';
import { NodeCatalogue, GroupOrder, GroupGlyphs, type NodeSpecification } from './nodeCatalogue';
import { HydrateGlyphs, RenderGlyph } from './icons';

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

const stMode  = Q('#st-mode');
const stPos   = Q('#st-pos');
const stSpeed = Q('#st-speed');
const stSpeedBar = Q('#st-speed-bar');
const stSun   = Q('#st-sun');
const stFps   = Q('#st-fps');

let telemetryGate = 0;
viewport.onTelemetry = (pos, speed, fps) =>
{
    telemetryGate += 1;
    if (telemetryGate % 6 !== 0) return;
    stPos.textContent   = `${pos.x.toFixed(1)}, ${pos.y.toFixed(1)}, ${pos.z.toFixed(1)}`;
    stSpeed.textContent = `${speed.toFixed(1)} m/s`;
    stSpeedBar.style.width = `${Math.min((speed / 60) * 100, 100)}%`;
    stFps.textContent   = `${fps.toFixed(0)} fps`;
};

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
        stMode.textContent = scheme === 'fly' ? 'Fly' : 'Orbit';
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

    // ground tone + toggles + presets
    const extra = document.createElement('div');
    extra.innerHTML = `
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

    const tone = Q<HTMLInputElement>('#ground-tone');
    tone.addEventListener('input', () =>
    {
        viewport.sky.groundTone = tone.value;
        (tone.parentElement as HTMLElement).style.background = tone.value;
        viewport.ApplySky();
    });

    BindSwitch(Q('#opt-grid'),  (on) => { viewport.sky.showGrid  = on; viewport.ApplySky(); });
    BindSwitch(Q('#opt-gizmo'), (on) => { viewport.sky.showGizmo = on; viewport.ApplySky(); });

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
    stSun.textContent = `${viewport.sky.elevation.toFixed(0)}° / ${viewport.sky.azimuth.toFixed(0)}°`;
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

// viewport rail: exclusive active tool, frame-scene shortcut
Q('#viewport').querySelectorAll<HTMLElement>('.rbtn').forEach((b) =>
{
    b.addEventListener('click', () =>
    {
        if (b.title === 'Frame Scene') { viewport.FrameScene(); return; }
        if (b.title === 'Sun Placement' || b.title === 'Sky Preset')
        {
            skyPanel.classList.add('show');
            Q('#sky-toggle').classList.add('active');
            return;
        }
        Q('#viewport').querySelectorAll('.rbtn').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
    });
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
(function SeedGraph()
{
    const start   = graph.AddNode('start',        -60, 120);
    const simplex = graph.AddNode('simplex',       260, -60);
    const ridged  = graph.AddNode('multifractal',  260, 240);
    const union   = graph.AddNode('union',         600,  80);
    const erode   = graph.AddNode('erode',         920,  60);
    const slope   = graph.AddNode('slope-mask',    920, 360);
    const out     = graph.AddNode('terrain-out',  1260, 180);
    void start;

    const Link = (a: typeof simplex, ap: string, b: typeof union, bp: string) =>
    {
        if (!a || !b) return;
        const wid = `w-seed-${Math.random().toString(36).slice(2, 8)}`;
        const type = (a.root.querySelector<HTMLElement>(`.port-dot[data-port="${ap}"][data-side="out"]`)
            ?.dataset.type ?? 'field') as 'field';
        graph.wires.set(wid, { uid: wid, fromNode: a.uid, fromPort: ap, toNode: b.uid, toPort: bp, type });
    };

    Link(simplex, 'height', union, 'a');
    Link(ridged,  'height', union, 'b');
    Link(union,   'sdf',    erode, 'in');
    Link(erode,   'out',    out,   'sdf');
    Link(erode,   'out',    slope, 'in');

    requestAnimationFrame(() => { graph.RedrawWires(); graph.FrameGraph(); });
})();

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

//---------------------------------------------------------------- doc title flourish
Q('#doc-title').addEventListener('click', () => Q('#doc-title').innerHTML = 'SolidScape_01 <em>*</em>');

// glyphs added after dynamic construction
graph.Hydrate();
HydrateGlyphs();

// keep wires aligned when the split pane resizes the editor
new ResizeObserver(() => graph.RedrawWires()).observe(Q('#editor'));

void RenderGlyph;
