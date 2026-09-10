// Inspector — right panel: selected node params · Erosion · Water · Render · Export.
import { DEFS, CAT } from '../core/graph.js';
import { slider, toggle, seg, buttonRow, section, kv, note, el } from './widgets.js';
import { QUALITY, state as cfg } from '../core/config.js';

export class Inspector {
  constructor(app) {
    this.app = app;
    this.tabsEl = document.getElementById('inspTabs');
    this.body = document.getElementById('inspBody');
    this.badge = document.getElementById('inspBadge');
    this.tab = 'node';
    this.tabDefs = [
      { id: 'node', label: 'Node', icon: '◆' },
      { id: 'erosion', label: 'Erosion', icon: '🌧' },
      { id: 'water', label: 'Water', icon: '≈' },
      { id: 'render', label: 'Render', icon: '☀' },
      { id: 'export', label: 'Export', icon: '⇩' },
    ];
    this.seg = seg(this.tabsEl, this.tabDefs, 'node', (id) => { this.tab = id; this.render(); }, true);
    this.controls = [];
  }

  clear() { this.controls.forEach(c => c.destroy && c.destroy()); this.controls = []; this.body.innerHTML = ''; }
  sl(parent, def, value, onChange) {
    const c = slider(parent, { label: def.l, min: def.min, max: def.max, step: def.step, value, unit: def.unit, onChange });
    this.controls.push(c);
    return c;
  }

  render() {
    this.clear();
    const app = this.app;
    this.tabDefs.forEach(t => { /* keep seg in sync */ });
    this.seg.set(this.tab);
    this.badge.textContent = this.tab;
    if (this.tab === 'node') this.renderNode();
    else if (this.tab === 'erosion') this.renderErosion();
    else if (this.tab === 'water') this.renderWater();
    else if (this.tab === 'render') this.renderRender();
    else this.renderExport();
  }

  renderNode() {
    const app = this.app;
    const n = app.graph.node(app.selection);
    if (!n) {
      note(this.body, '<b>No node selected.</b><br>Pick a node in the graph (Tab) or the outliner list. Right-click the graph canvas to add nodes.');
      return;
    }
    const def = DEFS[n.type];
    const s = section(this.body, `${def.icon}  ${def.label}`);
    if (def.desc) note(s.well, def.desc);
    if (def.sim) {
      note(s.well, 'Simulation node — agents run on the volume while the transport plays (Space). Erosion accumulates in realtime; <b>Rebuild</b> resets the field.');
    }
    def.params.forEach(p => {
      this.sl(s.well, p, n.params[p.k], (v) => {
        n.params[p.k] = v;
        app.onNodeParam(n);
      });
    });
    if (def.inputs.length) {
      toggle(s.well, {
        label: 'Enabled', value: n.enabled,
        onChange: (v) => { n.enabled = v; app.onGraphStructure(); },
      });
    }
    if (n.type !== 'output') {
      buttonRow(s.well, [
        { id: 'del', label: 'Delete node', danger: true, onClick: () => { app.deleteNode(n.id); } },
      ]);
    }
  }

  renderErosion() {
    const app = this.app;
    const sims = app.graph.simNodes();
    const s1 = section(this.body, 'Transport');
    note(s1.well, `Space runs the simulation · <b>${app.playing ? 'playing' : 'paused'}</b> · ${app.sim.alive} agents alive · step ${app.sim.step}`);
    buttonRow(s1.well, [
      { id: 'play', label: app.playing ? '⏸ Pause' : '▶ Run', onClick: () => { app.togglePlay(); this.render(); } },
      { id: 'step', label: 'Step', onClick: () => { app.stepOnce(); } },
      { id: 'reset', label: 'Rebuild field', onClick: () => { app.rebuild(); app.toast('Field rebuilt'); } },
    ]);

    const s2 = section(this.body, 'Material response');
    const e = app.erosion;
    this.sl(s2.well, { l: 'Detachment', min: 0, max: 2, step: 0.01, unit: '×' }, e.detach, v => e.detach = v);
    this.sl(s2.well, { l: 'Hardness', min: 0, max: 1, step: 0.01, unit: '' }, e.hardness, v => e.hardness = v);
    this.sl(s2.well, { l: 'Settling', min: 0, max: 2, step: 0.01, unit: '×' }, e.deposition, v => e.deposition = v);
    this.sl(s2.well, { l: 'Carry capacity', min: 0, max: 1, step: 0.01, unit: '' }, e.capacity, v => e.capacity = v);
    this.sl(s2.well, { l: 'Attrition', min: 0, max: 2, step: 0.05, unit: '' }, e.attrition, v => e.attrition = v);
    this.sl(s2.well, { l: 'Cut cap / agent', min: 0.01, max: 2, step: 0.01, unit: 'm³' }, e.maxDetach, v => e.maxDetach = v);

    const s3 = section(this.body, 'Active agents');
    if (!sims.length) {
      note(s3.well, 'No erosion nodes in the graph. Add <b>Hydraulic</b>, <b>River</b>, <b>Wind</b> or <b>Thermal</b> from the graph (right-click).');
    }
    sims.forEach(n => {
      const def = DEFS[n.type];
      toggle(s3.well, {
        label: `${def.icon} ${def.label}`, hint: n.enabled ? 'on' : 'off', value: n.enabled,
        onChange: (v) => { n.enabled = v; app.onGraphStructure(); },
      });
    });

    const s4 = section(this.body, 'Ledger');
    this.kvEl = kv(s4.well, [
      ['agents alive', '—'], ['sim steps', '—'], ['step ms', '—'],
    ]);
    app.ledgerHook = () => {
      this.kvEl.set('agents alive', String(app.sim.alive));
      this.kvEl.set('sim steps', String(app.sim.step));
      this.kvEl.set('step ms', app.lastStepMs.toFixed(1));
    };
  }

  renderWater() {
    const app = this.app;
    const s = section(this.body, 'Water');
    this.sl(s.well, { l: 'Sea level', min: cfg.lo[1] + 2, max: cfg.hi[1] - 4, step: 0.25, unit: 'm' }, app.renderer.opts.waterLevel, v => { app.renderer.opts.waterLevel = v; app.syncRiverSource(); });
    this.sl(s.well, { l: 'Wave height', min: 0, max: 1.4, step: 0.01, unit: 'm' }, app.renderer.opts.waveHeight, v => app.renderer.opts.waveHeight = v);
    this.sl(s.well, { l: 'Wavelength', min: 2, max: 30, step: 0.5, unit: 'm' }, app.renderer.opts.wavelength, v => app.renderer.opts.wavelength = v);
    this.sl(s.well, { l: 'Foam', min: 0, max: 2, step: 0.05, unit: '×' }, app.renderer.opts.foam, v => app.renderer.opts.foam = v);
    this.sl(s.well, { l: 'Clarity', min: 0.1, max: 2, step: 0.05, unit: '' }, app.renderer.opts.clarity, v => app.renderer.opts.clarity = v);
    note(s.well, 'The shader advects wave phase along the <b>simulated flow map</b> — currents from river agents steer the surface, foam follows speed.');

    const s2 = section(this.body, 'Agents');
    toggle(s2.well, { label: 'Show particles', value: app.renderer.showParticles, onChange: v => { app.renderer.showParticles = v; app.overlays.sync(); } });
    this.sl(s2.well, { l: 'Particle size', min: 0.3, max: 3, step: 0.05, unit: '×' }, app.renderer.particleScale, v => app.renderer.particleScale = v);
  }

  renderRender() {
    const app = this.app;
    const s1 = section(this.body, 'Quality');
    const q = seg(s1.well, Object.entries(QUALITY).map(([id, q]) => ({ id, label: q.label })), cfg.quality, (id) => {
      if (id !== cfg.quality) app.applyQuality(id);
      this.render();
    });
    note(s1.well, `Volume ${cfg.dim.join('×')} · ${cfg.cell.toFixed(2)} m cells. Changing quality rebuilds the field.`);

    const s2 = section(this.body, 'Lighting');
    this.sl(s2.well, { l: 'Sun azimuth', min: 0, max: 360, step: 1, unit: '°' }, app.renderer.sun.az * 180 / Math.PI, v => app.renderer.sun.az = v * Math.PI / 180);
    this.sl(s2.well, { l: 'Sun height', min: 2, max: 88, step: 1, unit: '°' }, app.renderer.sun.el * 180 / Math.PI, v => app.renderer.sun.el = v * Math.PI / 180);
    this.sl(s2.well, { l: 'Exposure', min: 0.4, max: 2.2, step: 0.05, unit: '' }, app.renderer.opts.exposure, v => app.renderer.opts.exposure = v);
    toggle(s2.well, { label: 'Soft shadows', value: app.renderer.opts.shadows > 0, onChange: v => app.renderer.opts.shadows = v ? 1 : 0 });
    toggle(s2.well, { label: 'Ambient occlusion', value: app.renderer.opts.ao > 0, onChange: v => app.renderer.opts.ao = v ? 1 : 0 });
    this.sl(s2.well, { l: 'March budget', min: 0.5, max: 1.6, step: 0.05, unit: '×' }, app.renderer.opts.steps, v => app.renderer.opts.steps = v);

    const s3 = section(this.body, 'Viewport');
    seg(s3.well, [
      { id: 1, label: 'Full res' }, { id: 0.75, label: '75%' }, { id: 0.5, label: '50%' },
    ], app.renderer.scale, v => app.renderer.scale = v);
  }

  renderExport() {
    const app = this.app;
    const s = section(this.body, 'Export');
    buttonRow(s.well, [
      { id: 'shot', label: 'Screenshot PNG', onClick: () => app.exporter.screenshot() },
    ]);
    buttonRow(s.well, [
      { id: 'hmap', label: 'Heightmap 16-bit', onClick: () => app.exporter.heightmap() },
      { id: 'flow', label: 'Flow map PNG', onClick: () => app.exporter.flowmap() },
    ]);
    buttonRow(s.well, [
      { id: 'save', label: 'Save graph .slate', onClick: () => app.exporter.saveGraph() },
      { id: 'load', label: 'Load graph', onClick: () => document.getElementById('fileGraph').click() },
    ]);
    const s2 = section(this.body, 'Scene');
    this.kvEl = kv(s2.well, [
      ['volume', `${cfg.dim.join('×')} @ ${cfg.cell.toFixed(2)}m`],
      ['agents', String(app.sim.alive)],
      ['fps', '—'],
    ]);
    app.ledgerHook = () => this.kvEl.set('agents', String(app.sim.alive));
  }
}
