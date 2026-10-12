//============================================================================================================================================
// 🧪 tools/Smoke.js — Boot the real editor against a micro DOM and drive it like a person
//============================================================================================================================================
// Check.js proves the kernel; this proves the wiring: panels building, hotkeys resolving, a tool surviving typing and a click, a session committing a
//    road into the document, the bake landing in the viewport, undo taking it back out. Every assertion is a behaviour a user could notice.
import { register } from 'node:module';
// The hooks must be installed before anything imports a stylesheet or a `?worker`.
register(new URL('./loader.mjs', import.meta.url));

const { installDom } = await import('./dom.mjs');
const THREE = await import('three');
const dom = installDom({ width: 1600, height: 900 });

let fails = 0, checks = 0;
const ok = (cond, label, detail = '') => {
    ++checks;
    if (!cond) { ++fails; console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
    else console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`);
};
const guard = (label, fn) => { try { return fn(); } catch (err) { ++checks; ++fails; console.log(`  ✗ ${label} threw: ${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`); return null; } };

/* The stand-in for the renderer: same public surface as Presentation/Viewport.js, no GL. */
class FakeViewport {
    constructor(canvas) {
        this.canvas = canvas;
        this.camera = new THREE.PerspectiveCamera(52, 16 / 9, 0.5, 40000);
        this.camera.position.set(0, 260, 420);
        this.camera.lookAt(0, 0, 0);
        this.camera.updateMatrixWorld(true);
        this.renderer = { domElement: canvas, setSize() { }, setPixelRatio() { }, get info() { return { render: { triangles: 0, calls: 0 } }; } };
        this.sectors = { setXray() { }, setMood() { }, setTime() { }, setPropsVisible() { }, clear() { }, list: [] };
        this.stats = { fps: 60, tris: 0, calls: 0 };
        this.markings = true;
        this.xray = false;
        this.viewportSize = [1600, 900];
        this.bakes = 0;
        this.lastMsg = null;
        this.selections = 0;
        this.ribbons = 0;
    }
    resize() { }
    dispose() { }
    render() { return { fps: 60, tris: 0, calls: 0, sectors: this.sectors.list.length }; }
    setTime() { }
    setLodScale() { }
    // Unprojecting through the same camera main.js projects with — so a click in the test means the world point it means in the browser.
    groundAt(cx, cy) {
        if (cx == null) return null;
        const v = new THREE.Vector3((cx / 1600) * 2 - 1, -((cy / 900) * 2 - 1), 0.5).unproject(this.camera);
        const dir = v.sub(this.camera.position).normalize();
        const t = -this.camera.position.y / dir.y;
        if (!isFinite(t) || t <= 0) return null;
        const p = this.camera.position.clone().addScaledVector(dir, t);
        return { x: p.x, y: 0, z: p.z };
    }
    applyBake(msg) { ++this.bakes; this.lastMsg = msg; this.stats.tris = msg.stats ? msg.stats.tris : 0; }
    setSelection() { ++this.selections; }
    setMood() { }
    setMarkings(v) { this.markings = v; }
    setXray(v) { this.xray = v; }
    setPropsVisible() { }
    setSpeedScale() { }
    drawToolRibbon() { ++this.ribbons; }
    clearTool() { }
}

globalThis.__slateBooted = true;   // suppress the module's own browser bootstrap
const { boot } = await import('../Editor/RoadEditor/main.js');
const { buildWorld, DEFAULTS } = await import('../Editor/RoadEditor/Kernel/SkinSolver.js');
const app = guard('boot()', () => boot(dom.host, { ViewportCtor: FakeViewport, city: { half: 320, cell: 120, metro: 0, rail: 0, water: 0, seed: 5 } }));
if (!app) { console.log('\n  ✗ boot failed — nothing else can run\n'); process.exit(1); }
const doc = app.doc;

await new Promise((r) => setTimeout(r, 900));   // the generation runs on a timer; the bake is synchronous inline
dom.tick(4);

console.log('\n— boot —');
ok(!!app.chrome.root.querySelector('.record'), 'record bar exists');
ok(app.chrome.leftPanel && app.chrome.rightPanel, 'both side panels mounted');
ok(doc.roads.length > 30, 'generated a city', `${doc.roads.length} roads / ${doc.stats().km.toFixed(2)} km`);
ok(app.viewport.bakes >= 1, 'bake reached the viewport', `${app.viewport.bakes} bakes, ${app.viewport.lastMsg && app.viewport.lastMsg.stats ? app.viewport.lastMsg.stats.tris : 0} tris`);
ok(app.viewport.lastMsg && app.viewport.lastMsg.sectors.length > 0, 'sectors transferred', `${app.viewport.lastMsg ? app.viewport.lastMsg.sectors.length : 0} sectors`);
ok(!/(undefined|NaN|\[object)/.test(app.chrome.record.textContent || ''), 'record bar text is clean', JSON.stringify((app.chrome.record.textContent || '').slice(0, 60)));

console.log('\n— panels —');
const root = app.chrome.root;
const all = (sel) => root.querySelectorAll(sel);
for (const head of all('.cardhead')) guard(`cardhead ${head.textContent.slice(0, 14)}`, () => head.dispatch('click'));
const chips = all('.chip');
for (const chip of chips) guard(`chip ${chip.textContent.slice(0, 12)}`, () => chip.click());
ok(chips.length >= 6, 'style chips rendered', `${chips.length} chips`);
ok(all('.tool').length >= 7, 'tool buttons rendered', `${all('.tool').length} tools`);
guard('profile chip', () => { const p = all('.pchip')[3]; if (p) p.click(); });
ok(app.drawProfile === all('.pchip')[3]?.attrs?.['data-profile'], 'profile chip set the draw section', app.drawProfile);
guard('profile chip with a selection', () => { doc.select([doc.roads[0].id], false); const p = all('.pchip')[5]; if (p) p.click(); doc.select([], false); });
guard('layer toggle', () => { const cb = all('.lay input')[1]; if (cb) { cb.checked = false; cb.dispatch('change', { target: cb }); } });
guard('range drag', () => { const rg = all('.rng')[2]; if (rg) { rg.value = '3'; rg.dispatch('input', { target: rg }); } });
const moodSel = all('.sel').find((n) => n.children.some((o) => o.value === 'night'));
guard('mood change', () => { if (moodSel) { moodSel.value = 'night'; moodSel.dispatch('change', { target: moodSel }); } });
ok(app.mood === 'night', 'mood select drove the lighting', app.mood);
// Style chips can queue a regeneration; let it settle before measuring anything that reads the document.
dom.tick(3);
await new Promise((r) => setTimeout(r, 500));
dom.tick(3);


console.log('\n— tools —');
for (const id of ['road', 'moveNode', 'split', 'vertex', 'hump', 'radius', 'connect', 'mark', 'select', 'remove']) {
    guard(`startTool(${id})`, () => app.startTool(id));
    ok(app.tool === id, `tool ${id} is live`, app.toolLabel);
}
await new Promise((r) => setTimeout(r, 120));
const before = doc.roads.length;
guard('draw a road by hand', () => {
    app.startTool('road');
    const c = app.viewport.canvas;
    const click = (x, y) => { c.dispatch('pointerdown', { clientX: x, clientY: y, button: 0 }); c.dispatch('pointermove', { clientX: x, clientY: y }); c.dispatch('pointerup', { clientX: x, clientY: y, button: 0 }); };
    click(700, 400);
    click(780, 410);
    click(860, 420);
    dom.key('Enter');
});
ok(doc.roads.length > before, 'clicks drew roads into the document', `${before} → ${doc.roads.length}`);
const drawn = doc.roads[doc.roads.length - 1];
ok(drawn && drawn.points.length >= 2, 'the road carries a polyline', drawn ? `${drawn.points.length} pts @ ${drawn.profile}` : 'none');
// History is synchronous, so read it before anything else can land.
const h0 = app.history.undoStack.length;
ok(h0 >= 1, 'history recorded the edit', `${h0} entries: ${app.history.log().map((r) => r.label).join(', ')}`);
const b0 = app.viewport.bakes;
dom.tick(2);
await new Promise((r) => setTimeout(r, 400));
dom.tick(2);
ok(app.viewport.bakes > b0, 'the edit triggered a re-bake', `${b0} → ${app.viewport.bakes} bakes`);

console.log('\n— typed input —');
guard('type a radius', () => {
    const node = Object.values(doc.nodes).find((n) => doc.pick(n.x, n.z, 30)) || Object.values(doc.nodes)[0];
    const v = new THREE.Vector3(node.x, 0, node.z).project(app.viewport.camera);
    const sx = (v.x * 0.5 + 0.5) * 1600, sy = (-v.y * 0.5 + 0.5) * 900;
    app.startTool('radius');
    const c = app.viewport.canvas;
    c.dispatch('pointerdown', { clientX: sx, clientY: sy, button: 0 });
    c.dispatch('pointerup', { clientX: sx, clientY: sy, button: 0 });
    ok(!!app.session, 'the radius session is waiting for a number');
    for (const ch of 'r14') dom.key(ch);
    ok(app.session && app.session.typed === 'r14', 'typed buffer collected the radius', JSON.stringify(app.session && app.session.typed));
    dom.key('Enter');
    const hit = doc.roads.find((r) => Math.abs((r.curbRadius ?? 0) - 14) < 1e-3);
    ok(!!hit, 'typed radius reached the model', hit ? `road ${hit.id} curbRadius=${hit.curbRadius}` : 'nothing set');
});
ok(app.session == null, 'the session retired itself after committing');

console.log('\n— presentation —');
const { SectorManager } = await import('../Editor/RoadEditor/Presentation/SectorManager.js');
const { propTemplates } = await import('../Editor/RoadEditor/Presentation/PropGeometry.js');
const THREE2 = THREE;
const fakeRoadMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
// SectorManager pokes material uniforms; give the stand-in the same knobs so the diff/xray paths are exercised.
fakeRoadMat.uniforms = { uXray: { value: 0 }, uTime: { value: 0 }, uNight: { value: new THREE.Vector3() }, uMarkings: { value: 1 } };
const templates = propTemplates();
for (const [k, v] of Object.entries(templates)) v.key = k;
guard('sector graphs', () => {
    const bake = buildWorld(doc.forBake(), { ...DEFAULTS, ...app.settings, props: 1, sector: 220 });
    const group = new THREE2.Group();
    const sm = new SectorManager({ group, roadMaterial: fakeRoadMat, propMaterial: fakeRoadMat, glowMaterial: fakeRoadMat, templates });
    const st = sm.apply(bake);
    ok(st.tiles === bake.sectors.length, 'every sector became a mesh', `${st.tiles} tiles`);
    ok(group.children.length === st.tiles + st.propDraws, 'mesh count matches tiles + prop draws', `${group.children.length} = ${st.tiles} + ${st.propDraws}`);
    ok(st.propDraws > 0, 'props instanced into the scene', `${st.propDraws} draws`);
    let bad = 0, badProps = 0, nan = 0, noSphere = 0;
    for (const m of group.children) {
        const g = m.geometry;
        const pos = g.getAttribute('position');
        if (m.userData.sector) {
            // Road tiles: an indexed draw whose every index has to sit inside the vertex stream, or the GPU reads past the buffer.
            const idx = g.index;
            if (!pos || !idx) { ++bad; continue; }
            let hi = 0;
            for (let i = 0; i < idx.array.length; ++i) hi = Math.max(hi, idx.array[i]);
            if (hi >= pos.count) ++bad;
        } else if (!g.getAttribute('iPF') || !pos) ++badProps;   // props share a template and carry per-instance streams
        for (let i = 0; i < pos.array.length; ++i) if (!isFinite(pos.array[i])) { ++nan; break; }
        if (!g.boundingSphere || !isFinite(g.boundingSphere.radius) || g.boundingSphere.radius <= 0) ++noSphere;
    }
    ok(bad === 0, 'every road tile indexes inside its own vertex stream');
    ok(badProps === 0, 'every prop draw carries its instance attributes', `${badProps} broken`);
    ok(nan === 0, 'no non-finite vertex positions');
    ok(noSphere === 0, 'every mesh has a usable bounding sphere', `${noSphere} broken`);
    const again = sm.apply(bake);
    ok(again.uploads === 0 && again.reused === again.tiles, 'an unchanged tile is never re-uploaded', `${again.reused}/${again.tiles} reused`);
    const first = doc.roads[0];
    doc.moveNode(first.nodeA, first.points[0].x + 30, first.points[0].z + 12);
    const bake2 = buildWorld(doc.forBake(), { ...DEFAULTS, ...app.settings, props: 1, sector: 220 });
    const part = sm.apply(bake2);
    ok(part.uploads > 0 && part.uploads < part.tiles, 'one edit re-uploads only the tiles it touched', `${part.uploads} of ${part.tiles}`);
    doc.undoStackHack = null; void doc.undoStackHack;
    sm.cull(app.viewport.camera, { lodScale: 1 });
    ok(group.children.some((m) => m.visible) || group.children.length === 0, 'culling ran and left a visible set', `${group.children.filter((m) => m.visible).length} visible`);
    sm.setXray(1); sm.setPropsVisible(false); sm.setTime(0.5); sm.clear();
    ok(group.children.length === 0, 'clear() empties the group', `${group.children.length}`);
});

console.log('\n— hotkeys —');
const keys = ['r', 'n', 'k', 'v', 'h', 'j', 'c', 'Escape', 'Delete', 'b', 'g', 'x', 'p', 'o', 'f', 'Home', '?', '1', '2', '3', '4', '5', 'Tab'];
for (const k of keys) guard(`key ${k}`, () => dom.key(k));
guard('ctrl+z', () => dom.key('z', { ctrlKey: true }));
guard('ctrl+shift+z', () => dom.key('z', { ctrlKey: true, shiftKey: true }));
ok(true, `${keys.length + 2} keys dispatched without an exception`);
guard('hotkey modal', () => app.chrome.showHotkeys());
ok(!!app.chrome.modal, 'hotkey chart rendered in a modal');
guard('close modal', () => app.chrome.closeModal());
ok(!app.chrome.modal, 'modal closes');

console.log('\n— console —');
const verbs = ['help', 'stats', 'sector', 'sectors', 'profiles', 'profile AVE-4', 'style dutch', 'seed 21', 'half 400', 'terrain 8', 'regen',
    'props off', 'props on', 'mood dusk', 'xray on', 'markings off', 'bake', 'fit', 'go 100,100', 'goto -50,20,80', 'select all', 'select none',
    'export', 'save', 'print', 'undo', 'redo', 'history', 'hotkeys', 'speed 90', 'step 4', 'clear', 'nosuchverb'];
for (const v of verbs) {
    const out = guard(`run("${v}")`, () => app.console.run(v));
    void out;
}
await new Promise((r) => setTimeout(r, 700));
ok(app.console.logLines.length > verbs.length, 'console logged every verb', `${app.console.logLines.length} lines / ${verbs.length} verbs`);
ok(/unknown verb/.test(app.console.logLines[app.console.logLines.length - 1]), 'unknown verb rejected', app.console.logLines[app.console.logLines.length - 1]);
const errs = app.console.logLines.filter((l) => l.startsWith('!'));
ok(errs.length === 0, 'no verb threw', errs.slice(0, 3).join(' ~ ') || 'clean');
const unknown = app.console.logLines.filter((l) => l.startsWith('unknown verb'));
ok(unknown.length === 1, 'every listed verb exists', unknown.join(' ~ ') || 'only the deliberate one');

console.log('\n— modes, minimap, history —');
for (const m of ['drive', 'inspect', 'edit']) guard(`mode ${m}`, () => app.setMode(m));
ok(app.mode === 'edit', 'returned to edit mode', app.mode);
guard('minimap click', () => { const mm = app.chrome.root.querySelector('.minimap'); if (mm) mm.dispatch('pointerdown', { clientX: 30, clientY: 30, button: 0 }); });
ok(app.history.undoStack.length === 0, 'a regeneration reset history', `${app.history.undoStack.length} entries`);
guard('undo to empty', () => { for (let i = 0; i < 4; ++i) app.history.undo(); });
guard('redo all', () => { for (let i = 0; i < 4; ++i) app.history.redo(); });
const json = doc.serialize();
ok(json.length > 1000, 'document serialises', `${(json.length / 1024).toFixed(0)} KB`);
guard('reload own json', () => doc.load(json, 'reload'));
ok(doc.roads.length > 30, 'survived a round-trip', `${doc.roads.length} roads`);

dom.tick(3);
await new Promise((r) => setTimeout(r, 200));
console.log(`\n${fails ? '  ✗' : '  ✓'} ${checks - fails}/${checks} smoke checks passed${fails ? ` — ${fails} failed` : ''}\n`);
process.exit(fails ? 1 : 0);
