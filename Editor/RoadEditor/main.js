//============================================================================================================================================
// 📦 Editor/RoadEditor/main.js — Wiring: one document, one viewport, one worker, one chrome
//============================================================================================================================================
// This file owns no behaviour of its own — it holds the references that the panels, tools and bake loop share, and the input plumbing that decides
//    whether a click belongs to the camera, a running tool, or a pick. Everything with a rule lives in a module that can be tested without a browser:
//    the kernel in Kernel/, the history in Document/, the snap grammar in Interaction/, the packed streams in Presentation/.
'use strict';

import * as THREE from 'three';
import './UI/road-editor.css';
import { SceneDocument } from './Document/SceneDocument.js';
import { UndoSequence } from './Document/UndoSequence.js';
import { Viewport } from './Presentation/Viewport.js';
import { CameraFly } from './Interaction/CameraFly.js';
import { HotkeyChart } from './Interaction/HotkeyChart.js';
import { makeTools } from './Interaction/Tools.js';
import { Chrome } from './UI/Chrome.js';
import { Minimap } from './UI/Minimap.js';
import { Console, installVerbs } from './UI/Console.js';
import { BakeClient } from './Runtime/BakeClient.js';
import BakeWorkerCtor from './Runtime/BakeWorker.js?worker';
import { generateCity, STYLES } from './Generation/CityGenerator.js';
import { DEFAULTS } from './Kernel/SkinSolver.js';
import { PROFILE_IDS } from './Kernel/ProfileSolver.js';
import { MOODS } from './Presentation/Lighting.js';

// Keys avoid the camera's WASDQE block; anything that is genuinely redundant (delete, markings) already has a panel button or the Del key.
const TOOL_KEYS = { r: 'road', n: 'moveNode', k: 'split', v: 'vertex', h: 'hump', j: 'radius', c: 'connect' };

/** @param {Element} host @param {{ViewportCtor?:Function, city?:object}} opts — the seam that lets the whole editor boot inside `node tools/Smoke.js` with a stub viewport. */
export function boot(host = document.getElementById('app'), opts = {}) {
    const canvasEl = document.createElement('canvas');
    canvasEl.id = 'view';
    const doc = new SceneDocument();
    const app = {
        doc,
        canvasEl,
        moods: MOODS,
        mood: 'noon',
        xray: false,
        mode: 'edit',
        tool: 'select',
        toolLabel: 'Select',
        session: null,
        profileIds: PROFILE_IDS,
        lastStats: null,
        drawProfile: 'RES-2',
        genSettings: Object.assign({
            style: 'grid', seed: 3, half: 1250, cell: 120, arterialEvery: 4, collectorEvery: 2, density: 1,
            water: 0.7, rail: 1, metro: 2, ringHWY: 1, bike: 0.8, bus: 0.7, parking: 0.8, humps: 0.4, terrain: 0, lots: 1,
        }, opts.city || {}),
        settings: { ...DEFAULTS, sector: 220, groundGrid: 220, world: 1600 },
    };
    app.viewport = new (opts.ViewportCtor || Viewport)(canvasEl);
    app.camera = new CameraFly(app.viewport.camera, canvasEl);
    app.camera.size = app.viewport.viewportSize;
    app.chart = new HotkeyChart();
    // The chrome reads the tool table while it builds, so the tools have to exist before it mounts.
    app.tools = makeTools({
        doc,
        get viewport() { return app.viewport; },
        get camera() { return app.camera; },
        get settings() { return app.settings; },
        get ui() { return app.chrome; },
        get tool() { return app.tool; },
        project: (x, z, y) => project(x, z, y),
        pickRadius: 6,
        get currentProfile() { return () => app.drawProfile; },
        requestBake: () => requestBake(),
        autoFinish: false,
    });
    app.chrome = new Chrome(app).mount(host);
    app.minimap = new Minimap(app);
    app.chrome.setMinimap(app.minimap.element());
    app.console = installVerbs(new Console(app), app);
    host.append(app.console.element());
    app.history = new UndoSequence(doc);
    app.bake = new BakeClient(app, { WorkerCtor: BakeWorkerCtor });
    app.currentProfile = () => app.drawProfile;
    app.hotkeyFor = (id) => { for (const [k, v] of Object.entries(TOOL_KEYS)) if (v === id) return k; return null; };

    function project(x, z, y) {
        const v = new THREE.Vector3(x, y ?? 0, z).project(app.viewport.camera);
        const [w, h] = app.viewport.viewportSize || [1, 1];
        return [((v.x * 0.5) + 0.5) * w, ((-v.y * 0.5) + 0.5) * h];
    }

    /* ── bake / generate ──────────────────────────────────────────────────────────────────────────────────────────────────────── */
    let bakeQueued = false;
    function requestBake(now) {
        if (now) { app.bake.request(true); return; }
        if (bakeQueued) return;
        bakeQueued = true;
        requestAnimationFrame(() => { bakeQueued = false; app.bake.request(false); });
    }
    app.requestBake = requestBake;
    function requestGenerate(immediate) {
        const g = app.genSettings;
        app.chrome.notify(`generating ${STYLES[g.style] ? STYLES[g.style].label : g.style}…`);
        const run = () => {
            const t0 = performance.now();
            const city = generateCity({ ...g, lots: 1 });
            doc.load(JSON.stringify({ ...city, nodes: Object.values(city.nodes), settings: app.settings }), 'Generate city');
            app.history.undoStack.length = 0; app.history.redoStack.length = 0;
            app.settings.world = Math.ceil(g.half * 1.25);
            app.settings.amp = +g.terrain || 0;
            app.settings.seed = +g.seed || 1;
            app.chrome.rebuild();
            app.minimap.invalidate();
            app.bake.request(!!immediate);
            app.chrome.notify(`generated in ${Math.round(performance.now() - t0)} ms`, 'ok');
        };
        setTimeout(run, 16);
    }
    app.requestGenerate = requestGenerate;
    app.onGenSetting = () => { /* sliders only take effect on the next generate */ };
    app.resetSettings = () => { Object.assign(app.settings, { ...DEFAULTS, sector: 220, groundGrid: 220, world: Math.ceil(app.genSettings.half * 1.25), amp: app.genSettings.terrain, seed: app.genSettings.seed }); requestBake(true); };
    app.setCurrentProfile = (id) => { app.drawProfile = id; app.chrome.notify(`draw section → ${id}`, 'ok'); app.startTool('road'); }
    app.setMood = (m) => { app.mood = m; app.viewport.setMood(m); app.minimap.invalidate(); };
    app.setXray = (on) => { app.xray = !!on; app.viewport.setXray(!!on); };
    app.toggleProps = () => { const on = !app.settings.props; app.settings.props = on ? 1 : 0; app.viewport.setPropsVisible(on); requestBake(true); };
    app.togglePointerLock = () => { const on = app.camera.toggleLock(); app.chrome.notify(on ? 'pointer locked — Esc releases' : 'pointer free'); };
    app.toggleConsole = () => app.console.toggle();
    app.flyHome = () => { app.camera.fit(doc.bbox()); };
    app.save = () => {
        const blob = new Blob([doc.serialize()], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${(doc.meta.name || 'road-city').replace(/[^\w.-]/g, '_')}.roadmap.json`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        app.chrome.notify('saved ' + a.download, 'ok');
    };
    app.openFile = () => {
        const inp = document.createElement('input');
        inp.type = 'file';
        inp.accept = '.json,application/json';
        inp.onchange = () => {
            const f = inp.files && inp.files[0];
            if (!f) return;
            f.text().then((t) => {
                try {
                    doc.load(t, 'Open');
                    app.chrome.rebuild();
                    app.minimap.invalidate();
                    requestBake(true);
                    app.chrome.notify(`opened ${f.name}`, 'ok');
                } catch (err) { app.chrome.notify('bad file: ' + err.message, 'err'); }
            });
        };
        inp.click();
    };

    /* ── tools ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    app.startTool = (id) => {
        if (app.session) { app.session.cancel(); app.session = null; }
        const t = app.tools[id];
        if (!t) return;
        app.tool = id;
        app.toolLabel = t.label;
        if (id !== 'select' && (t.instant || t.start)) {
            if (t.start) openSession(t.start());
        }
        app.chrome.setToolLabel(t.label);
        app.chrome.rebuild();
    };

    /* ── pointer ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    let downAt = null;
    canvasEl.addEventListener('contextmenu', (e) => e.preventDefault());
    canvasEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || app.mode === 'drive') return;
        downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    canvasEl.addEventListener('pointerup', (e) => {
        if (e.button !== 0 || !downAt || app.mode === 'drive') return;
        const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
        const quick = performance.now() - downAt.t < 520;
        downAt = null;
        if (moved > 5 || !quick) return;
        const raw = app.viewport.groundAt(e.clientX, e.clientY, 0);
        if (!raw) return;
        if (app.session) { app.session.move(e.clientX, e.clientY); app.session.click(e.clientX, e.clientY, e.button); if (app.session && !app.session.points.length && !app.session.typed) app.session = null; return; }
        let tool = app.tools[app.tool];
        if (app.mode === 'inspect' && tool !== app.tools.select) tool = app.tools.select;
        const p = { x: raw.x, z: raw.z, y: 0 };
        if (tool && tool.instant) tool.instant(p, { humpWidth: 3.6, humpHeight: app.settings.humpAmp, radius: app.settings.curbRadius });
        else { const hit = doc.pick(p.x, p.z, pickR()); if (hit) doc.select([hit.road.id], e.shiftKey); else doc.select([], false); app.chrome.sync(); }
    });
    canvasEl.addEventListener('pointermove', (e) => {
        if (app.session) app.session.move(e.clientX, e.clientY);
        else {
            const raw = app.viewport.groundAt(e.clientX, e.clientY, 0);
            if (!raw) return;
            const hit = doc.pick(raw.x, raw.z, pickR());
            const id = hit && !doc.selection.has(hit.road.id) ? hit.road.id : null;
            if (id !== app.hoverId) { app.hoverId = id; app.viewport.setSelection(Array.from(doc.selection), null, doc, id); }
        }
    });
    canvasEl.addEventListener('dblclick', () => { if (app.session) app.session.commit(); });
    const pickR = () => Math.max(3.5, app.camera.position.y * 0.035);
    /** A session is only ever live through `app.session`; it retires itself the moment it commits or cancels. */
    function openSession(s) {
        app.session = s;
        s.onDone = () => { if (app.session === s) { app.session = null; app.chrome.setToolLabel(app.toolLabel); app.chrome.rebuild(); } };
        app.chrome.previewTool(s);
        if (s.prompt) app.chrome.notify(`${s.def?.label || app.toolLabel}: ${s.prompt}`, 'warn');
    }

    /* ── keys ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    const actions = new Map();
    const bind = (keys, label, run, group) => { actions.set(label, run); app.chart.bind(keys, { label, run, group }); };
    for (const [k, id] of Object.entries(TOOL_KEYS)) bind(k, 'tool:' + id, () => app.startTool(id), 'Tools');
    bind('escape', 'cancel', () => { if (app.session) { app.session.cancel(); app.session = null; app.chrome.rebuild(); } else if (doc.selection.size) { doc.select([], false); app.chrome.sync(); } else app.viewport.clearTool(); }, 'Tools');
    bind('enter', 'commit', () => { if (app.session) { app.session.commit(); app.session = null; app.chrome.rebuild(); } }, 'Tools');
    bind('ctrl+z,meta+z', 'undo', () => { app.history.undo(); requestBake(true); }, 'Document');
    bind('ctrl+shift+z,ctrl+y,meta+shift+z', 'redo', () => { app.history.redo(); requestBake(true); }, 'Document');
    bind('delete', 'delete selection', () => { if (doc.selection.size) { doc.removeRoads(Array.from(doc.selection)); requestBake(); } }, 'Document');
    bind('b', 're-bake', () => requestBake(true), 'View');
    bind('g', 'grid snap', () => { app.settings.snapGrid = app.settings.snapGrid ? 0 : 10; app.chrome.notify('grid ' + (app.settings.snapGrid || 'off')); }, 'Snap');
    bind('x', 'x-ray', () => { app.setXray(!app.xray); app.chrome.notify('x-ray ' + (app.xray ? 'on' : 'off')); }, 'View');
    bind('p', 'props', () => app.toggleProps(), 'View');
    bind('o', 'markings', () => { const on = !app.viewport.markings; app.viewport.setMarkings(on); app.chrome.notify('markings ' + (on ? 'on' : 'off')); }, 'View');
    bind('f', 'pawn mode', () => app.togglePointerLock(), 'View');
    bind('home', 'fit city', () => app.flyHome(), 'View');
    bind('?', 'hotkeys', () => app.chrome.showHotkeys(), 'View');
    bind('tab', 'cycle mode', () => { const m = ['edit', 'drive', 'inspect']; app.setMode(m[(m.indexOf(app.mode) + 1) % 3]); }, 'View');
    bind('1', 'mood noon', () => app.setMood('noon'), 'View');
    bind('2', 'mood golden', () => app.setMood('golden'), 'View');
    bind('3', 'mood dusk', () => app.setMood('dusk'), 'View');
    bind('4', 'mood night', () => app.setMood('night'), 'View');
    bind('5', 'mood overcast', () => app.setMood('overcast'), 'View');
    app.actions = actions;
    window.addEventListener('keydown', (e) => {
        if (e.key === '`' || (e.key === '~')) { e.preventDefault(); app.toggleConsole(); return; }
        if (app.console.open) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
        // A running tool gets first refusal on every key: this is what makes the typed grammar (`3`, `12,45`, `r8`, `x40`) work.
        if (app.session && app.session.key(e)) { e.preventDefault?.(); app.chrome.sync(); return; }
        app.chart.handle(e);
    });

    app.setMode = (m) => {
        app.mode = m;
        app.chrome.updateModePills(m);
        app.camera.enabled = true;
        if (m === 'drive' && app.session) { app.session.cancel(); app.session = null; }
        if (m === 'drive') app.viewport.setSelection([], null, doc, null);
        app.chrome.notify(m === 'drive' ? 'drive mode — right-drag looks, WASD flies' : m === 'inspect' ? 'inspect mode — click to read a road' : 'edit mode');
    };

    /* ── history plumbing ────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    doc.on('change', () => { app.minimap.invalidate(); requestBake(); app.chrome.sync(); });
    app.history.on(() => app.chrome.sync());
    doc.on('selection', () => { app.viewport.setSelection(Array.from(doc.selection), null, doc, null); app.chrome.rebuild(); });

    /* ── loop ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────── */
    let last = performance.now();
    let acc = 0;
    const loop = () => {
        const t = performance.now();
        const dt = Math.min(0.1, (t - last) / 1000);
        last = t;
        acc += dt;
        app.camera.size = app.viewport.viewportSize;
        app.camera.update(dt);
        const st = app.viewport.render(dt);
        app.fps = st.fps;
        app.minimap.update(dt);
        if (acc > 0.25) { acc = 0; app.chrome.sync(); }
        requestAnimationFrame(loop);
    };
    window.addEventListener('resize', () => { app.viewport.resize(); app.camera.size = app.viewport.viewportSize; });
    document.addEventListener('pointerlockchange', () => { if (!app.camera.locked) app.chrome.notify('pointer free'); });

    app.chrome.rebuild();
    app.viewport.resize();
    requestGenerate(true);
    requestAnimationFrame(loop);
    app.chrome.notify('right-drag to look, WASD to fly, click a road to select · press ~ for the console');
    return app;
}

/** Auto-start in a browser, but stay importable: `tools/Smoke.js` boots the same function with a stub viewport and must not trigger a second app. */
if (typeof document !== 'undefined' && !globalThis.__slateBooted && document.getElementById('app')) {
    globalThis.__slateBooted = true;
    boot();
}
void DEFAULTS;
