// SLATE — application bootstrap, transport, and the frame loop.
import { GL } from './core/glutil.js';
import { state, applyQuality, QUALITY } from './core/config.js';
import { Volume } from './core/volume.js';
import { Simulation } from './core/sim.js';
import { Renderer } from './core/renderer.js';
import { Camera } from './core/camera.js';
import { Graph, DEFS, makeNode, nextNodeId, defaultParams } from './core/graph.js';
import { FIELD_GLSL } from './core/glsl/common.js';
import { Inspector } from './ui/inspector.js';
import { Outliner } from './ui/outliner.js';
import { GraphEditor } from './ui/grapheditor.js';
import { Menus, buildHelp, Console } from './ui/overlays.js';
import { seg, toast } from './ui/widgets.js';
import { Exporter } from './exporter.js';
import { PRESETS } from './presets.js';

const origError = console.error.bind(console);
console.error = (...args) => { Console.log(args.map(String).join(' ')); origError(...args); };

class App {
  constructor() {
    this.canvas = document.getElementById('gl');
    this.G = new GL(this.canvas);
    this.graph = new Graph();
    this.erosion = { detach: 0.85, hardness: 0.35, deposition: 1.0, capacity: 0.45, attrition: 0.7, maxDetach: 0.35, wetDecay: 0.995 };
    this.playing = false;
    this.speed = 1;
    this.selection = null;
    this.graphOpen = true;
    this.time = 0;
    this.lastStepMs = 0;
    this.fps = 60;
    this.savedWater = null;
    this.build();
  }

  build() {
    this.vol = new Volume(this.G);
    this.cam = new Camera(this.canvas);
    this.sim = new Simulation(this.G, this.vol);
    this.renderer = new Renderer(this.G, this.vol, this.sim, this.cam);
    this.exporter = new Exporter(this);
    this.presets = PRESETS;

    this.inspector = new Inspector(this);
    this.outliner = new Outliner(this);
    this.geditor = new GraphEditor(this);
    this.menus = new Menus(this);
    buildHelp();

    this.wireHeader();
    this.wireKeys();
    this.graph.onChange(() => { this.geditor.sync(); this.outliner.render(); });
    this.loadPreset(PRESETS[0]);
    this.inspector.render();
    this.geditor.show(true);
  }

  // ── graph → GLSL plumbing ─────────────────────────────────
  sceneBody(segOut) {
    return `float scene(vec3 p){\n${segOut.fns}\n  return ${segOut.entry};\n}`;
  }

  rebuild() {
    const c = this.graph.compile();
    this.compiled = c;
    if (!c || !c.order.length) {
      this.vol.bake('float scene(vec3 p){ return 200.0; }', '', null);
      this.sim.reset();
      return;
    }
    this.vol.bake(this.sceneBody({ fns: c.preFns, entry: c.preEntry }), '', null);
    this.sim.reset();
    if (c.hasSim) this.bakePost();
  }

  bakePost() {
    const c = this.compiled;
    if (!c || !c.hasSim) return;
    // skip if post is only collapsed field passthrough
    if (c.postFns === '' || !c.postFns.replace(/float f\d+b\(vec3 p\)\{ return fieldSDF\(p\); \}/g, '').trim()) {
      return;
    }
    const gl = this.G.gl;
    this.vol.bake(this.sceneBody({ fns: c.postFns, entry: c.postEntry }), FIELD_GLSL, (u) => {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.vol.tex());
      gl.uniform1i(u.uField, 0);
    });
  }

  agents() {
    // gather agent params from enabled sim nodes (first of each type wins)
    const a = {
      rain: { on: false, intensity: 0.5, grain: 3, impact: 1, evap: 0.035 },
      river: { on: false, srcX: -30, srcZ: -20, spread: 6, intensity: 0.4, speed: 1.6, brush: 1.1, grain: 5 },
      wind: { on: false, speed: 7, dir: 35, height: 8, spread: 12, abrasion: 1 },
      thermal: { on: false, angle: 38, rate: 0.35 },
    };
    for (const n of this.graph.nodes) {
      if (!n.enabled || !DEFS[n.type].sim) continue;
      const p = n.params;
      if (n.type === 'hydraulic') {
        a.rain = { on: true, intensity: p.intensity, grain: p.grain, impact: p.impact, evap: p.evap };
      } else if (n.type === 'river') {
        a.river = { on: true, srcX: p.srcX, srcZ: p.srcZ, spread: p.spread, intensity: p.intensity, speed: p.speed, brush: p.brush, grain: p.grain };
      } else if (n.type === 'wind') {
        a.wind = { on: true, speed: p.speed, dir: p.dir, height: p.height, spread: p.spread, abrasion: p.abrasion };
      } else if (n.type === 'thermal') {
        a.thermal = { on: true, angle: p.angle, rate: p.rate };
      }
    }
    return a;
  }

  stepSim(dt) {
    const t0 = performance.now();
    this.sim.update(dt, this.erosion, this.agents(), this.agents().thermal);
    this.bakePost();
    this.lastStepMs = this.lastStepMs * 0.85 + (performance.now() - t0) * 0.15;
  }

  // ── app events ────────────────────────────────────────────
  select(id) {
    this.selection = id;
    this.inspector.render();
    this.outliner.render();
    this.geditor.sync();
  }
  onNodeParam(n) {
    if (DEFS[n.type].sim) return;   // sim params are live uniforms — no rebuild
    clearTimeout(this._rb);
    this._rb = setTimeout(() => this.rebuild(), 90);
  }
  onGraphStructure() {
    clearTimeout(this._rb);
    this.rebuild();
    this.geditor.sync();
    this.outliner.render();
    this.inspector.render();
  }
  deleteNode(id) {
    if (this.graph.node(id)?.type === 'output') return;
    this.graph.remove(id);
    if (this.selection === id) this.selection = null;
    this.onGraphStructure();
  }
  duplicateNode(id) {
    const n = this.graph.node(id);
    if (!n || n.type === 'output') return;
    const c = makeNode(n.type, n.x + 40, n.y + 40);
    c.params = { ...n.params };
    this.graph.add(c);
    this.select(c.id);
  }
  togglePlay() {
    this.playing = !this.playing;
    const b = document.getElementById('btnPlay');
    b.classList.toggle('run', this.playing);
    b.classList.toggle('pause', !this.playing);
    document.getElementById('playIco').textContent = this.playing ? '⏸' : '▶';
    document.getElementById('playLbl').textContent = this.playing ? 'Pause' : 'Run';
  }
  stepOnce() {
    this.stepSim(0.032);
    this.sim.countParticles();
  }
  addMenu(x, y, onPick) { this.menus.addMenu(x, y, onPick); }
  toast(msg, err) { toast(msg, err); }
  waterOffLevel() { return state.lo[1] - 1; }
  syncRiverSource() { /* river source is independent of the sea level */ }

  applyQuality(name) {
    applyQuality(name);
    this.vol.buildTextures();
    this.sim = new Simulation(this.G, this.vol);
    this.renderer.sim = this.sim;
    this.renderer.build();
    this.cam.frame();
    this.rebuild();
    this.inspector.render();
    toast(`Quality: ${QUALITY[name].label} — ${state.dim.join('×')} @ ${state.cell.toFixed(2)}m`);
  }

  loadPreset(p) {
    // remap string ids → numeric
    let maxId = 0;
    const map = {};
    this.graph.nodes = [];
    this.graph.links = [];
    p.nodes.forEach(n => {
      const id = nextNodeId();
      maxId = Math.max(maxId, id);
      map[n.id] = id;
      this.graph.nodes.push({ id, type: n.type, x: n.x, y: n.y, params: { ...defaultParams(n.type), ...n.params }, enabled: true });
    });
    p.links.forEach(l => this.graph.links.push({ from: map[l.from], to: map[l.to], toInput: l.toInput }));
    // apply run flags to sim nodes
    this.graph.nodes.forEach(n => {
      const d = DEFS[n.type];
      if (d.sim && p.run) n.enabled = !!p.run[{ hydraulic: 'rain', river: 'river', wind: 'wind', thermal: 'thermal' }[d.sim]];
    });
    this.renderer.opts.waterLevel = p.waterLevel;
    this.renderer.sun.az = p.sunAz * Math.PI / 180;
    this.renderer.sun.el = p.sunEl * Math.PI / 180;
    this.cam.az = p.camera.az;
    this.cam.el = p.camera.el;
    this.cam.frame();
    this.cam.dist *= p.camera.dist;
    this.cam.update();
    this.savedWater = null;
    this.graph.emit();
    this.rebuild();
    this.inspector.render();
    toast(`Preset: ${p.name}`);
  }

  // ── header / keys ─────────────────────────────────────────
  wireHeader() {
    const app = this;
    document.getElementById('btnPlay').addEventListener('click', () => app.togglePlay());
    document.getElementById('btnStep').addEventListener('click', () => app.stepOnce());
    document.getElementById('btnBake').addEventListener('click', () => { app.rebuild(); app.toast('Field rebuilt'); });
    seg(document.getElementById('speedSeg'), [
      { id: 0.5, label: '×½' }, { id: 1, label: '×1' }, { id: 2, label: '×2' }, { id: 4, label: '×4' },
    ], 1, v => app.speed = v, true);

    seg(document.getElementById('modebar'), [
      { id: 0, label: 'Shaded', kbd: '1' },
      { id: 1, label: 'Albedo', kbd: '2' },
      { id: 2, label: 'Normal', kbd: '3' },
      { id: 3, label: 'Occupancy', kbd: '4' },
      { id: 4, label: 'Sed·Wet', kbd: '5' },
      { id: 5, label: 'Flow', kbd: '6' },
    ], 0, v => app.renderer.mode = v);

    document.getElementById('btnHelp').addEventListener('click', () => { document.getElementById('help').hidden = false; });
    document.getElementById('btnAddNode').addEventListener('click', (e) => {
      const r = e.target.getBoundingClientRect();
      app.menus.addMenu(r.left, r.bottom + 6, (type) => {
        const n = makeNode(type, 80 + Math.random() * 200, 60 + Math.random() * 200);
        app.graph.add(n);
        app.select(n.id);
      });
    });
    document.getElementById('btnPreset').addEventListener('click', (e) => {
      const r = e.target.getBoundingClientRect();
      app.menus.presetMenu(r.left, r.bottom + 6, (p) => app.loadPreset(p));
    });
    document.getElementById('btnSaveGraph').addEventListener('click', () => app.exporter.saveGraph());
    document.getElementById('btnLoadGraph').addEventListener('click', () => document.getElementById('fileGraph').click());
    document.getElementById('fileGraph').addEventListener('change', (e) => {
      if (e.target.files[0]) app.exporter.loadGraph(e.target.files[0]);
      e.target.value = '';
    });
    document.getElementById('gdClose').addEventListener('click', () => app.geditor.show(false));
    document.getElementById('gdAuto').addEventListener('click', () => app.geditor.tidy());
    document.getElementById('conClose').addEventListener('click', () => Console.show(false));
  }

  wireKeys() {
    const app = this;
    window.addEventListener('keydown', (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const k = e.key;
      if (k === ' ') { e.preventDefault(); app.togglePlay(); }
      else if (k === 'Tab') { e.preventDefault(); app.geditor.show(!app.graphOpen); }
      else if (k === 'b' || k === 'B') { app.rebuild(); app.toast('Field rebuilt'); }
      else if (k === 'f' || k === 'F') app.cam.frame();
      else if (k === '.') app.stepOnce();
      else if (k === '?') document.getElementById('help').hidden = !document.getElementById('help').hidden;
      else if (k === '`') { e.preventDefault(); Console.show(document.getElementById('consolep').hidden); }
      else if (k >= '1' && k <= '6') app.renderer.mode = parseInt(k) - 1;
      else if (k === 'l' || k === 'L') app.geditor.tidy();
      else if ((e.ctrlKey || e.metaKey) && (k === 'd' || k === 'D')) { e.preventDefault(); if (app.selection) app.duplicateNode(app.selection); }
      else if ((e.ctrlKey || e.metaKey) && (k === 's' || k === 'S')) { e.preventDefault(); app.exporter.saveGraph(); }
      else if (k === 'Backspace' || k === 'Delete') { if (app.selection) app.deleteNode(app.selection); }
      else if (k === 'Escape') {
        document.getElementById('help').hidden = true;
        Console.show(false);
        app.menus.hide();
      }
    });
  }

  // ── frame loop ────────────────────────────────────────────
  loop() {
    const app = this;
    let last = performance.now();
    let acc = 0, frames = 0, statT = 0, countT = 0;
    const frame = (now) => {
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      this.time += dt;
      this.cam.tick();
      if (this.playing) {
        const simDt = Math.min(dt, 1 / 30) * this.speed;
        const t0 = performance.now();
        this.sim.update(simDt, this.erosion, this.agents(), this.agents().thermal);
        this.bakePost();
        this.lastStepMs = this.lastStepMs * 0.9 + (performance.now() - t0) * 0.1;
      }
      this.renderer.render(this.time);
      // stats
      frames++; acc += dt; statT += dt; countT += dt;
      if (statT > 0.5) {
        this.fps = frames / acc;
        document.querySelector('#fpsPill b').textContent = Math.round(this.fps);
        document.getElementById('volPill').textContent = `vol ${state.dim.join('×')}`;
        document.getElementById('caminfo').textContent = this.cam.info();
        if (this.ledgerHook) this.ledgerHook();
        acc = 0; frames = 0; statT = 0;
      }
      if (countT > 1.2) {
        if (this.playing) this.sim.countParticles();
        document.getElementById('parPill').innerHTML = `◆ ${this.sim.alive}`;
        countT = 0;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}

// ── boot ────────────────────────────────────────────────────
try {
  const app = new App();
  window.slate = app;
  app.loop();
} catch (err) {
  console.error(err);
  document.getElementById('fatal').hidden = false;
  document.getElementById('fatalMsg').textContent = String(err.message || err);
}
