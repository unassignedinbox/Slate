// Editor state: settings, scene ownership, selection, layer visibility, environment.
// Pure data + events; the UI subscribes, the renderer reads.

import { buildScene, assembleScene } from '../road/scene.js';
import { defaultSettings, PRESETS, networkBounds } from '../road/generator.js';
import { solveNetwork } from '../road/junction.js';
import { defaultChannels, ENV_PRESETS } from '../gfx/materials.js';

export class Editor {
  constructor() {
    this.settings = defaultSettings('downtown');
    this.channels = defaultChannels();
    this.envName = 'clear';
    this.env = { ...ENV_PRESETS.clear, markings: true, wearGain: 1, vignette: 0.38, grain: 0.016 };
    this.view = {
      wireframe: false,
      network: true,
      laneGraph: false,
      handles: true,
      gizmo: true,
      stats: true,
      simulate: true,
      timeScale: 1,
    };
    this.hidden = new Set();
    this.selection = null;      // {type:'junction'|'road'|'layer'|'channel', id}
    this.stackTab = 'scene';    // 'scene' | 'texture'
    this.scene = null;
    this.busy = false;
    this._handlers = new Map();
    this.history = [];
  }

  on(evt, fn) {
    if (!this._handlers.has(evt)) this._handlers.set(evt, new Set());
    this._handlers.get(evt).add(fn);
    return () => this._handlers.get(evt).delete(fn);
  }

  emit(evt, payload) {
    const hs = this._handlers.get(evt);
    if (hs) for (const h of hs) h(payload);
  }

  // ---------------------------------------------------------------- build
  generate(overrides = {}) {
    Object.assign(this.settings, overrides);
    const t0 = performance.now();
    this.scene = buildScene(this.settings);
    this.scene.channels = this.channels;
    this.buildMs = performance.now() - t0;
    this.selection = null;
    this.emit('scene', this.scene);
    return this.scene;
  }

  /** Rebuild geometry around the current network (after an intersection move). */
  rebuildGeometry() {
    if (!this.scene) return null;
    const t0 = performance.now();
    const world = { net: this.scene.net, rails: this.scene.rails, subway: this.scene.subway, meta: this.scene.meta };
    const keep = this.selection;
    this.scene = assembleScene(world, this.settings);
    this.scene.channels = this.channels;
    this.buildMs = performance.now() - t0;
    this.selection = keep;
    this.emit('scene', this.scene);
    return this.scene;
  }

  /** Move an intersection and re-solve the junction trims (geometry rebuild is deferred). */
  moveNode(nodeId, x, z) {
    const net = this.scene?.net;
    if (!net) return;
    const node = net.nodes.get(nodeId);
    if (!node || node.locked) return;
    const moved = net.moveNode(nodeId, { x, z });
    if (!moved) return;
    solveNetwork(net);
    this.emit('network', { nodeId });
  }

  setPreset(name) {
    if (!PRESETS[name]) return;
    const seed = this.settings.seed;
    this.settings = defaultSettings(name);
    this.settings.seed = seed;
    this.emit('settings', this.settings);
  }

  setSetting(key, value) {
    this.settings[key] = value;
    this.emit('settings', this.settings);
  }

  setEnv(name) {
    if (!ENV_PRESETS[name]) return;
    this.envName = name;
    const keep = { markings: this.env.markings, wearGain: this.env.wearGain, vignette: this.env.vignette, grain: this.env.grain };
    this.env = { ...ENV_PRESETS[name], ...keep };
    this.emit('env', this.env);
  }

  setEnvValue(key, value) {
    this.env[key] = value;
    this.emit('env', this.env);
  }

  setView(key, value) {
    this.view[key] = value;
    this.emit('view', this.view);
  }

  toggleLayer(id, visible) {
    if (visible === undefined) visible = this.hidden.has(id);
    if (visible) this.hidden.delete(id); else this.hidden.add(id);
    this.emit('layers', this.hidden);
  }

  select(selection) {
    this.selection = selection;
    this.emit('selection', selection);
  }

  channel(id) { return this.channels.find((c) => c.id === id); }

  setChannelValue(id, key, value) {
    const c = this.channel(id);
    if (!c) return;
    c[key] = value;
    this.emit('channels', this.channels);
  }

  get bounds() { return this.scene ? networkBounds(this.scene.net) : { min: { x: -100, z: -100 }, max: { x: 100, z: 100 } }; }
}

export { ENV_PRESETS, PRESETS };
